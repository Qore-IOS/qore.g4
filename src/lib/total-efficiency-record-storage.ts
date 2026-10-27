import { collection, doc, getDocs, orderBy, query, setDoc, type DocumentData } from './data/client';
import { db } from './data/client';

const MAX_INLINE_ROWS_JSON_BYTES = 850_000;
const ROW_CHUNK_SIZE = 250;

type RecordWithRows<Row> = DocumentData & {
  rows?: Row[];
  rowsChunked?: boolean;
  rowsChunkCount?: number;
};

const estimateJsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const chunkRows = <Row>(rows: Row[], chunkSize = ROW_CHUNK_SIZE): Row[][] => {
  const chunks: Row[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
};

export const saveTotalEfficiencyRecord = async <Row>(recordId: string, data: RecordWithRows<Row>) => {
  const rows = data.rows || [];
  const shouldChunkRows = rows.length > 0 && estimateJsonBytes(rows) > MAX_INLINE_ROWS_JSON_BYTES;
  const recordRef = doc(db, 'totalEfficiencyRecords', recordId);

  if (!shouldChunkRows) {
    await setDoc(recordRef, {
      ...data,
      rows,
      rowsChunked: false,
      rowsChunkCount: 0,
    }, { merge: true });
    return;
  }

  const chunks = chunkRows(rows);
  const { rows: _rows, ...metadata } = data;

  await Promise.all(chunks.map((chunk, index) => setDoc(
    doc(db, 'totalEfficiencyRecords', recordId, 'rowChunks', String(index).padStart(4, '0')),
    { index, rows: chunk },
  )));

  await setDoc(recordRef, {
    ...metadata,
    rows: [],
    rowsChunked: true,
    rowsChunkCount: chunks.length,
  }, { merge: true });
};

export const loadTotalEfficiencyRows = async <Row>(recordId: string, data: RecordWithRows<Row>): Promise<Row[]> => {
  if (!data.rowsChunked) {
    return (data.rows || []) as Row[];
  }

  const chunksSnap = await getDocs(query(
    collection(db, 'totalEfficiencyRecords', recordId, 'rowChunks'),
    orderBy('index', 'asc'),
  ));

  return chunksSnap.docs.flatMap(chunkDoc => (chunkDoc.data().rows || []) as Row[]);
};
