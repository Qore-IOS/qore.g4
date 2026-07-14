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

// ============================================================================
// Maliyet (cost) count template — the cost-counting screen records TWO
// quantities per product (Stok Adedi + Cihaz Üstü Test) plus an informational
// live stock figure.
//
// Template columns (Turkish, in order):
//   Marka | Stok Kodu | Stok Adı | Mevcut Stok | Stok Adedi | Cihaz Üstü Test
// ============================================================================

export interface MaliyetSayimTemplateRow {
  marka: string;
  stokKodu: string;
  stokAdi: string;
  /** Current live stock for the product (read-only, informational). */
  mevcutStok: number;
}

export interface MaliyetSayimParsedRow {
  stokKodu: string;
  /** null when the "Stok Adedi" column was left blank. */
  stokAdedi: number | null;
  /** null when the "Cihaz Üstü Test" column was left blank. */
  cihazUstuAdedi: number | null;
}

const MALIYET_HEADERS = ['Marka', 'Stok Kodu', 'Stok Adı', 'Mevcut Stok', 'Stok Adedi', 'Cihaz Üstü Test'] as const;

const STOK_ADEDI_ALIASES = ['stok adedi', 'stokadedi', 'stok adet', 'stok miktari'];
const CIHAZ_USTU_ALIASES = ['cihaz ustu test', 'cihazustu test', 'cihaz ustu', 'cihaz ustu adedi', 'cihaz ustu adet', 'cihaz ustu test adedi'];

/**
 * Build and download an .xlsx template for the cost-counting screen, pre-filled
 * with the products in scope. The two count columns ("Stok Adedi" and "Cihaz
 * Üstü Test") are left blank for the user to fill.
 */
export async function downloadMaliyetSayimTemplate(
  rows: MaliyetSayimTemplateRow[],
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

  const ws = workbook.addWorksheet('Maliyet Sayım');
  ws.columns = [
    { key: 'marka', width: 20 },
    { key: 'stokKodu', width: 18 },
    { key: 'stokAdi', width: 44 },
    { key: 'mevcutStok', width: 14 },
    { key: 'stokAdedi', width: 14 },
    { key: 'cihazUstuTest', width: 16 },
  ];

  const thinBorder = {
    top: { style: 'thin' as const },
    left: { style: 'thin' as const },
    bottom: { style: 'thin' as const },
    right: { style: 'thin' as const },
  };

  const headerRow = ws.getRow(1);
  MALIYET_HEADERS.forEach((header, index) => {
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
    r.getCell(4).value = Number.isFinite(row.mevcutStok) ? row.mevcutStok : 0;
    r.getCell(5).value = null; // Stok Adedi — user fills this in
    r.getCell(6).value = null; // Cihaz Üstü Test — user fills this in
    for (let c = 1; c <= 6; c++) {
      const cell = r.getCell(c);
      cell.border = thinBorder;
      cell.alignment = { horizontal: c >= 4 ? 'center' : 'left', vertical: 'middle' };
    }
    // Highlight the two editable columns lightly.
    r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
    r.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
}

/**
 * Parse an uploaded cost-count Excel file into per-product quantities. A row is
 * returned only when at least one of the two count columns holds a value.
 * Column positions are detected from the header row, so reordering columns is
 * safe as long as the header labels are preserved.
 */
export async function parseMaliyetSayimExcel(file: File): Promise<MaliyetSayimParsedRow[]> {
  const ExcelJS = await import('exceljs');
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const ws = workbook.worksheets[0];
  if (!ws) return [];

  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
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
  let stokAdediCol = -1;
  let cihazCol = -1;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    let sk = -1;
    let sa = -1;
    let cu = -1;
    for (let c = 0; c < row.length; c++) {
      const h = normalizeHeader(row[c]);
      if (sk === -1 && STOK_KODU_ALIASES.includes(h)) sk = c;
      if (sa === -1 && STOK_ADEDI_ALIASES.includes(h)) sa = c;
      if (cu === -1 && CIHAZ_USTU_ALIASES.includes(h)) cu = c;
    }
    // Header row must have the stok kodu column and at least one count column.
    if (sk !== -1 && (sa !== -1 || cu !== -1)) {
      headerRowIndex = r;
      stokKoduCol = sk;
      stokAdediCol = sa;
      cihazCol = cu;
      break;
    }
  }

  // Fallback to the documented column order.
  if (headerRowIndex === -1) {
    headerRowIndex = 0;
    stokKoduCol = 1;
    stokAdediCol = 4;
    cihazCol = 5;
  }

  const result: MaliyetSayimParsedRow[] = [];
  const indexByCode = new Map<string, number>();
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const stokKodu = String(row[stokKoduCol] ?? '').trim();
    if (!stokKodu) continue;

    const rawStok = stokAdediCol !== -1 ? row[stokAdediCol] : undefined;
    const rawCihaz = cihazCol !== -1 ? row[cihazCol] : undefined;

    const stokAdedi =
      rawStok === null || rawStok === undefined || String(rawStok).trim() === ''
        ? null
        : parseQuantity(rawStok);
    const cihazUstuAdedi =
      rawCihaz === null || rawCihaz === undefined || String(rawCihaz).trim() === ''
        ? null
        : parseQuantity(rawCihaz);

    // Skip rows where the user entered nothing in either count column.
    if (stokAdedi === null && cihazUstuAdedi === null) continue;

    if (indexByCode.has(stokKodu)) {
      const existing = result[indexByCode.get(stokKodu)!];
      if (stokAdedi !== null) existing.stokAdedi = stokAdedi;
      if (cihazUstuAdedi !== null) existing.cihazUstuAdedi = cihazUstuAdedi;
      continue;
    }
    indexByCode.set(stokKodu, result.length);
    result.push({ stokKodu, stokAdedi, cihazUstuAdedi });
  }

  return result;
}

// ============================================================================
// Bulk (toplu) maliyet count template — one flat list covering MULTIPLE
// locations (hospital by hospital), used by the bulk count entry screen.
//
// Template columns (Turkish, in order):
//   Laboratuvar | Marka | Stok Kodu | Stok Adı | Stok Adedi | Cihaz Üstü Test
// ============================================================================

export interface TopluMaliyetTemplateRow {
  /** Location (lab/depot) display name. */
  lokasyon: string;
  marka: string;
  stokKodu: string;
  stokAdi: string;
}

export interface TopluMaliyetParsedRow {
  /** Location name as written in the sheet (matched case/space-insensitively). */
  lokasyon: string;
  stokKodu: string;
  stokAdedi: number | null;
  cihazUstuAdedi: number | null;
}

const TOPLU_HEADERS = ['Laboratuvar', 'Marka', 'Stok Kodu', 'Stok Adı', 'Stok Adedi', 'Cihaz Üstü Test'] as const;

const LOKASYON_ALIASES = ['laboratuvar', 'lab', 'hastane', 'depo', 'lokasyon', 'kurum'];

/** Normalize a location name for tolerant matching between sheet and app data. */
export function normalizeLokasyonAdi(value: string): string {
  return normalizeHeader(value);
}

/**
 * Build and download a bulk .xlsx template listing every location's products
 * sequentially in a single sheet (hospital by hospital). The two count columns
 * are left blank; location blocks are visually separated by a tinted location
 * column.
 */
export async function downloadTopluMaliyetSayimTemplate(
  rows: TopluMaliyetTemplateRow[],
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

  const ws = workbook.addWorksheet('Toplu Sayım');
  ws.columns = [
    { key: 'lokasyon', width: 28 },
    { key: 'marka', width: 20 },
    { key: 'stokKodu', width: 18 },
    { key: 'stokAdi', width: 44 },
    { key: 'stokAdedi', width: 14 },
    { key: 'cihazUstuTest', width: 16 },
  ];

  const thinBorder = {
    top: { style: 'thin' as const },
    left: { style: 'thin' as const },
    bottom: { style: 'thin' as const },
    right: { style: 'thin' as const },
  };

  const headerRow = ws.getRow(1);
  TOPLU_HEADERS.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
  });
  headerRow.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Alternate a light tint per location block so boundaries are easy to see.
  const locationTints = ['FFEFF6FF', 'FFF0FDF4'];
  let tintIndex = -1;
  let prevLokasyon: string | null = null;

  rows.forEach((row, index) => {
    if (row.lokasyon !== prevLokasyon) {
      prevLokasyon = row.lokasyon;
      tintIndex = (tintIndex + 1) % locationTints.length;
    }
    const r = ws.getRow(index + 2);
    r.getCell(1).value = row.lokasyon || '';
    r.getCell(2).value = row.marka || '';
    r.getCell(3).value = row.stokKodu || '';
    r.getCell(4).value = row.stokAdi || '';
    r.getCell(5).value = null; // Stok Adedi — user fills this in
    r.getCell(6).value = null; // Cihaz Üstü Test — user fills this in
    for (let c = 1; c <= 6; c++) {
      const cell = r.getCell(c);
      cell.border = thinBorder;
      cell.alignment = { horizontal: c >= 5 ? 'center' : 'left', vertical: 'middle' };
    }
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: locationTints[tintIndex] } };
    r.getCell(1).font = { bold: true };
    r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
    r.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
}

/**
 * Parse an uploaded bulk count Excel file into per-location, per-product
 * quantities. A row is returned when at least one of the two count columns
 * holds a value — an explicit 0 counts as an entry.
 */
export async function parseTopluMaliyetSayimExcel(file: File): Promise<TopluMaliyetParsedRow[]> {
  const ExcelJS = await import('exceljs');
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const ws = workbook.worksheets[0];
  if (!ws) return [];

  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: unknown[] = [];
    const raw = Array.isArray(row.values) ? row.values : [];
    for (let c = 1; c < raw.length; c++) {
      values[c - 1] = extractCellValue(raw[c]);
    }
    rows.push(values);
  });
  if (rows.length === 0) return [];

  // Find the header row within the first few rows.
  let headerRowIndex = -1;
  let lokasyonCol = -1;
  let stokKoduCol = -1;
  let stokAdediCol = -1;
  let cihazCol = -1;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    let lo = -1;
    let sk = -1;
    let sa = -1;
    let cu = -1;
    for (let c = 0; c < row.length; c++) {
      const h = normalizeHeader(row[c]);
      if (lo === -1 && LOKASYON_ALIASES.includes(h)) lo = c;
      if (sk === -1 && STOK_KODU_ALIASES.includes(h)) sk = c;
      if (sa === -1 && STOK_ADEDI_ALIASES.includes(h)) sa = c;
      if (cu === -1 && CIHAZ_USTU_ALIASES.includes(h)) cu = c;
    }
    if (lo !== -1 && sk !== -1 && (sa !== -1 || cu !== -1)) {
      headerRowIndex = r;
      lokasyonCol = lo;
      stokKoduCol = sk;
      stokAdediCol = sa;
      cihazCol = cu;
      break;
    }
  }

  // Fallback to the documented column order.
  if (headerRowIndex === -1) {
    headerRowIndex = 0;
    lokasyonCol = 0;
    stokKoduCol = 2;
    stokAdediCol = 4;
    cihazCol = 5;
  }

  const result: TopluMaliyetParsedRow[] = [];
  const indexByKey = new Map<string, number>();
  // Rows may omit the location on continuation lines; carry the last seen one.
  let lastLokasyon = '';
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const lokasyonRaw = String(row[lokasyonCol] ?? '').trim();
    if (lokasyonRaw) lastLokasyon = lokasyonRaw;
    const lokasyon = lokasyonRaw || lastLokasyon;

    const stokKodu = String(row[stokKoduCol] ?? '').trim();
    if (!stokKodu || !lokasyon) continue;

    const rawStok = stokAdediCol !== -1 ? row[stokAdediCol] : undefined;
    const rawCihaz = cihazCol !== -1 ? row[cihazCol] : undefined;

    const stokAdedi =
      rawStok === null || rawStok === undefined || String(rawStok).trim() === ''
        ? null
        : parseQuantity(rawStok);
    const cihazUstuAdedi =
      rawCihaz === null || rawCihaz === undefined || String(rawCihaz).trim() === ''
        ? null
        : parseQuantity(rawCihaz);

    // Skip rows where the user entered nothing in either count column.
    if (stokAdedi === null && cihazUstuAdedi === null) continue;

    const key = `${normalizeLokasyonAdi(lokasyon)}|${stokKodu}`;
    if (indexByKey.has(key)) {
      const existing = result[indexByKey.get(key)!];
      if (stokAdedi !== null) existing.stokAdedi = stokAdedi;
      if (cihazUstuAdedi !== null) existing.cihazUstuAdedi = cihazUstuAdedi;
      continue;
    }
    indexByKey.set(key, result.length);
    result.push({ lokasyon, stokKodu, stokAdedi, cihazUstuAdedi });
  }

  return result;
}
