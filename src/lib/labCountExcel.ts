'use client';

// ============================================================================
// Lab count Excel template — download a pre-filled template and parse an
// uploaded one back into per-product count quantities.
//
// Template columns (Turkish, in order):
//   Marka | Stok Kodu | Stok Adı | Mevcut Adet | Sayım Adeti
// ============================================================================

export interface LabCountTemplateRow {
  marka: string;
  stokKodu: string;
  stokAdi: string;
  /** Current lab stock for the product (read-only, informational). */
  mevcutAdet: number;
}

export interface LabCountParsedRow {
  stokKodu: string;
  /** Counted quantity entered by the user in the "Sayım Adeti" column. */
  sayimAdeti: number;
}

const HEADERS = ['Marka', 'Stok Kodu', 'Stok Adı', 'Mevcut Adet', 'Sayım Adeti'] as const;

/** Normalize a header cell for tolerant matching (case/space/Turkish-char insensitive). */
function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOK_KODU_ALIASES = ['stok kodu', 'stokkodu', 'stok kod', 'kod'];
const SAYIM_ALIASES = ['sayim adeti', 'sayim adedi', 'sayim', 'sayilan', 'sayim miktari'];

/**
 * Build and download an .xlsx template pre-filled with the products in the
 * count scope. The "Sayım Adeti" column is left blank for the user to fill.
 */
export async function downloadLabCountTemplate(
  rows: LabCountTemplateRow[],
  fileName: string,
): Promise<void> {
  const ExcelJS = await import('exceljs');
  const fileSaverModule = await import('file-saver');
  const saveAs =
    (fileSaverModule as any).saveAs ||
    (fileSaverModule as any).default?.saveAs ||
    (fileSaverModule as any).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QORE';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Sayım');
  ws.columns = [
    { key: 'marka', width: 20 },
    { key: 'stokKodu', width: 18 },
    { key: 'stokAdi', width: 44 },
    { key: 'mevcutAdet', width: 14 },
    { key: 'sayimAdeti', width: 14 },
  ];

  const thinBorder = {
    top: { style: 'thin' as const },
    left: { style: 'thin' as const },
    bottom: { style: 'thin' as const },
    right: { style: 'thin' as const },
  };

  const headerRow = ws.getRow(1);
  HEADERS.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
  });
  headerRow.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  rows.forEach((row, index) => {
    const r = ws.getRow(index + 2);
    r.getCell(1).value = row.marka || '';
    r.getCell(2).value = row.stokKodu || '';
    r.getCell(3).value = row.stokAdi || '';
    r.getCell(4).value = Number.isFinite(row.mevcutAdet) ? row.mevcutAdet : 0;
    r.getCell(5).value = null; // Sayım Adeti — user fills this in
    for (let c = 1; c <= 5; c++) {
      const cell = r.getCell(c);
      cell.border = thinBorder;
      cell.alignment = { horizontal: c >= 4 ? 'center' : 'left', vertical: 'middle' };
    }
    // Highlight the editable "Sayım Adeti" column lightly.
    r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
}

/**
 * Parse an uploaded lab-count Excel file back into { stokKodu, sayimAdeti }
 * rows. Only rows where the "Sayım Adeti" column holds a valid number are
 * returned. Column positions are detected from the header row, so the user can
 * safely reorder columns as long as the header labels are preserved.
 */
export async function parseLabCountExcel(file: File): Promise<LabCountParsedRow[]> {
  const ExcelJS = await import('exceljs');
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const ws = workbook.worksheets[0];
  if (!ws) return [];

  // Collect rows as arrays of cell values.
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
    // exceljs row.values is 1-indexed (index 0 is empty); normalize to 0-based.
    const raw = Array.isArray(row.values) ? row.values : [];
    for (let c = 1; c < raw.length; c++) {
      values[c - 1] = extractCellValue(raw[c]);
    }
    rows.push(values);
  });
  if (rows.length === 0) return [];

  // Find the header row within the first few rows.
  let headerRowIndex = -1;
  let stokKoduCol = -1;
  let sayimCol = -1;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    let sk = -1;
    let sy = -1;
    for (let c = 0; c < row.length; c++) {
      const h = normalizeHeader(row[c]);
      if (sk === -1 && STOK_KODU_ALIASES.includes(h)) sk = c;
      if (sy === -1 && SAYIM_ALIASES.includes(h)) sy = c;
    }
    if (sk !== -1 && sy !== -1) {
      headerRowIndex = r;
      stokKoduCol = sk;
      sayimCol = sy;
      break;
    }
  }

  // Fallback to the documented column order (Stok Kodu = 2nd, Sayım Adeti = 5th).
  if (headerRowIndex === -1) {
    headerRowIndex = 0;
    stokKoduCol = 1;
    sayimCol = 4;
  }

  const result: LabCountParsedRow[] = [];
  const seen = new Set<string>();
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const stokKodu = String(row[stokKoduCol] ?? '').trim();
    if (!stokKodu) continue;

    const rawSayim = row[sayimCol];
    if (rawSayim === null || rawSayim === undefined || String(rawSayim).trim() === '') continue;

    const sayimAdeti = parseQuantity(rawSayim);
    if (sayimAdeti === null) continue;

    // Keep the last value if a stok kodu appears more than once.
    if (seen.has(stokKodu)) {
      const existing = result.find((x) => x.stokKodu === stokKodu);
      if (existing) existing.sayimAdeti = sayimAdeti;
      continue;
    }
    seen.add(stokKodu);
    result.push({ stokKodu, sayimAdeti });
  }

  return result;
}

/** Unwrap exceljs rich-text / hyperlink / formula cell objects into a scalar. */
function extractCellValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('result' in obj) return obj.result; // formula cell
    if ('text' in obj) return obj.text; // hyperlink / rich text
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return obj.richText.map((rt: any) => rt.text ?? '').join('');
    }
  }
  return value;
}

/** Parse a quantity cell (number or Turkish-formatted string) into a non-negative integer. */
function parseQuantity(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
  }
  const cleaned = String(value)
    .replace(/\s+/g, '')
    .replace(/\./g, '') // thousands separator
    .replace(/,/g, '.'); // decimal comma
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.round(num));
}
