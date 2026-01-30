import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import * as XLSX from 'xlsx';

// Collections to export with their field configurations
const COLLECTIONS_CONFIG = [
  { name: 'users', displayName: 'Kullanıcılar' },
  { name: 'hospitals', displayName: 'Hastaneler' },
  { name: 'depots', displayName: 'Depolar' },
  { name: 'borcDepots', displayName: 'Borç Depoları' },
  { name: 'devices', displayName: 'Cihazlar' },
  { name: 'hospitalDeviceAssignments', displayName: 'Cihaz Atamaları' },
  { name: 'productCodes', displayName: 'Ürün Kodları' },
  { name: 'addressDefinitions', displayName: 'Adres Tanımları' },
  { name: 'depoStok', displayName: 'Depo Stok' },
  { name: 'orders', displayName: 'Siparişler' },
  { name: 'shipments', displayName: 'Sevkiyatlar' },
  { name: 'transfers', displayName: 'Transferler' },
  { name: 'tuketimKayitlari', displayName: 'Tüketim Kayıtları' },
  { name: 'efficiencyDataRecords', displayName: 'Verimlilik Verileri' },
  { name: 'depotStockCountSessions', displayName: 'Depo Sayım Oturumları' },
  { name: 'laboratoryStockCountSessions', displayName: 'Lab Sayım Oturumları' },
  { name: 'kumulatifRaporlar', displayName: 'Kümülatif Raporlar' },
];

// Firestore Timestamp to ISO string converter
function serializeFirestoreData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle Firestore Timestamp
  if (data && typeof data === 'object' && data._seconds !== undefined) {
    return new Date(data._seconds * 1000).toISOString();
  }

  // Handle Firestore Timestamp with toDate method
  if (data && typeof data.toDate === 'function') {
    return data.toDate().toISOString();
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => serializeFirestoreData(item));
  }

  // Handle objects
  if (typeof data === 'object') {
    const serialized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      serialized[key] = serializeFirestoreData(value);
    }
    return serialized;
  }

  return data;
}

// Fetch collection data with pagination for large datasets
async function fetchCollectionData(collectionName: string, batchSize: number = 1000): Promise<any[]> {
  const results: any[] = [];
  let lastDoc: any = null;

  while (true) {
    let query = adminDb.collection(collectionName).limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    snapshot.docs.forEach(doc => {
      results.push({
        id: doc.id,
        ...serializeFirestoreData(doc.data())
      });
    });

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    // If we got less than batchSize, we've reached the end
    if (snapshot.docs.length < batchSize) {
      break;
    }
  }

  return results;
}

// Flatten nested objects for Excel compatibility
function flattenObject(obj: any, prefix = ''): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      result[newKey] = '';
    } else if (Array.isArray(value)) {
      // Convert arrays to JSON string for Excel
      result[newKey] = JSON.stringify(value);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // Recursively flatten nested objects (max 2 levels)
      if (!prefix) {
        Object.assign(result, flattenObject(value, newKey));
      } else {
        result[newKey] = JSON.stringify(value);
      }
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

// Convert data to Excel workbook buffer
function convertToExcel(data: Record<string, any[]>): Buffer {
  const workbook = XLSX.utils.book_new();

  for (const [collectionName, records] of Object.entries(data)) {
    if (records.length === 0) continue;

    // Flatten all records
    const flattenedData = records.map(record => flattenObject(record));

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(flattenedData);

    // Truncate sheet name to 31 chars (Excel limit)
    const sheetName = collectionName.substring(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }

  // Write workbook to buffer
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

// Convert data to CSV format
function convertToCSV(data: Record<string, any[]>): string {
  const sheets: string[] = [];

  for (const [collectionName, records] of Object.entries(data)) {
    if (records.length === 0) continue;

    // Get all unique keys from records
    const allKeys = new Set<string>();
    records.forEach(record => {
      Object.keys(record).forEach(key => allKeys.add(key));
    });
    const headers = Array.from(allKeys);

    // Create CSV content
    const csvRows: string[] = [];
    csvRows.push(`--- ${collectionName} ---`);
    csvRows.push(headers.join(','));

    records.forEach(record => {
      const row = headers.map(header => {
        const value = record[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value).replace(/,/g, ';');
        return String(value).replace(/,/g, ';').replace(/\n/g, ' ');
      });
      csvRows.push(row.join(','));
    });

    sheets.push(csvRows.join('\n'));
  }

  return sheets.join('\n\n');
}

// GET handler - fetch export metadata/status
export async function GET(request: NextRequest) {
  try {
    const collectionStats: Record<string, number> = {};

    // Get document counts for each collection
    const countPromises = COLLECTIONS_CONFIG.map(async ({ name }) => {
      try {
        // Use a count aggregation query if available, otherwise estimate
        const snapshot = await adminDb.collection(name).count().get();
        return { name, count: snapshot.data().count };
      } catch {
        // Fallback: get first doc to check if collection exists
        const snapshot = await adminDb.collection(name).limit(1).get();
        return { name, count: snapshot.empty ? 0 : -1 }; // -1 means "unknown"
      }
    });

    const counts = await Promise.all(countPromises);
    counts.forEach(({ name, count }) => {
      collectionStats[name] = count;
    });

    return NextResponse.json({
      success: true,
      collections: COLLECTIONS_CONFIG.map(c => ({
        ...c,
        documentCount: collectionStats[c.name] ?? 0
      })),
      totalCollections: COLLECTIONS_CONFIG.length
    });
  } catch (error: any) {
    console.error('Export metadata error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Veri bilgileri alınamadı' },
      { status: 500 }
    );
  }
}

// POST handler - perform export
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { format = 'json', collections: requestedCollections } = body;

    // Validate format
    if (!['json', 'csv', 'xlsx'].includes(format)) {
      return NextResponse.json(
        { success: false, error: 'Geçersiz format. json, csv veya xlsx kullanın.' },
        { status: 400 }
      );
    }

    // Determine which collections to export
    const collectionsToExport = requestedCollections && Array.isArray(requestedCollections)
      ? COLLECTIONS_CONFIG.filter(c => requestedCollections.includes(c.name))
      : COLLECTIONS_CONFIG;

    if (collectionsToExport.length === 0) {
      return NextResponse.json(
        { success: false, error: 'En az bir koleksiyon seçilmelidir.' },
        { status: 400 }
      );
    }

    // Fetch all collection data in parallel
    const fetchPromises = collectionsToExport.map(async ({ name }) => {
      const data = await fetchCollectionData(name);
      return { name, data };
    });

    const results = await Promise.all(fetchPromises);

    // Build result object
    const exportData: Record<string, any[]> = {};
    let totalDocuments = 0;

    results.forEach(({ name, data }) => {
      exportData[name] = data;
      totalDocuments += data.length;
    });

    // Return based on format
    if (format === 'xlsx') {
      const excelBuffer = convertToExcel(exportData);

      return new NextResponse(excelBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="invitrolab_export_${new Date().toISOString().split('T')[0]}.xlsx"`,
        },
      });
    }

    if (format === 'csv') {
      const csvContent = convertToCSV(exportData);

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="invitrolab_export_${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // JSON format
    return NextResponse.json({
      success: true,
      exportDate: new Date().toISOString(),
      totalDocuments,
      collectionsExported: collectionsToExport.map(c => c.name),
      data: exportData
    });

  } catch (error: any) {
    console.error('Export error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Veriler dışa aktarılırken bir hata oluştu' },
      { status: 500 }
    );
  }
}
