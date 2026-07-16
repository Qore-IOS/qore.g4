'use client';

// ============================================================================
// Maliyet Gözlem — Stok Maliyeti Excel çıktısı.
//
// Manuel hazırlanan "Genel maliyet tablosu" şablonunun daha düzenli bir
// sürümünü üretir:
//   • 1. sayfa: Genel Tablo — marka bazında toplam stok maliyeti (TL)
//   • Sonraki sayfalar: her marka için Marka–Kurum dağılımı (lab kodlarıyla)
// Tüm tutarlar TL'ye çevrilerek yazılır.
// ============================================================================

import {
  getLatestByLocation,
  getProductCostInCurrency,
  type SayimSession,
} from '@/lib/cost-analytics';
import type { Currency, ProductCode } from '@/lib/types';

export interface StokExportLocationInfo {
  name: string;
  kod?: string;
  type: 'lab' | 'depot';
}

interface ExportLocationRow {
  locationId: string;
  locationName: string;
  kod: string;
  type: 'lab' | 'depot';
  costTL: number;
  productCount: number;
}

interface ExportBrand {
  marka: string;
  totalTL: number;
  productCount: number;
  locations: ExportLocationRow[];
}

export interface StokExportModel {
  periodLabel: string;
  generatedAt: Date;
  brands: ExportBrand[];
  grandTotalTL: number;
  locationCount: number;
}

/**
 * Panel verisinden (sayım oturumları) TL bazlı ihracat modeli kurar. Panelde
 * gösterilen değerlerle birebir aynı motoru (getLatestByLocation +
 * getProductCostInCurrency) kullanır; yalnız para birimi her zaman TRY'dir.
 */
export function buildStokMaliyetModel(params: {
  sessions: SayimSession[];
  productMap: Map<string, ProductCode>;
  rates: Record<Currency, number>;
  locationInfo: Map<string, StokExportLocationInfo>;
  periodLabel: string;
}): StokExportModel {
  const { sessions, productMap, rates, locationInfo, periodLabel } = params;

  // marka → locationId → { costTL, products }
  const brandMap = new Map<string, Map<string, { costTL: number; products: Set<string>; name: string; type: 'lab' | 'depot' }>>();
  const locationIds = new Set<string>();

  Array.from(getLatestByLocation(sessions).values()).forEach((session) => {
    session.items.forEach((item) => {
      const marka = item.marka || 'Diğer';
      const costTL = getProductCostInCurrency(
        item.stokKodu,
        item.stokAdedi,
        item.cihazUstuAdedi,
        productMap,
        rates,
        'TRY',
        item,
      );
      let locs = brandMap.get(marka);
      if (!locs) {
        locs = new Map();
        brandMap.set(marka, locs);
      }
      const info = locationInfo.get(session.locationId);
      let cell = locs.get(session.locationId);
      if (!cell) {
        cell = {
          costTL: 0,
          products: new Set(),
          name: info?.name || session.locationName || session.locationId,
          type: info?.type || (session.locationType === 'depot' ? 'depot' : 'lab'),
        };
        locs.set(session.locationId, cell);
      }
      cell.costTL += costTL;
      cell.products.add(item.stokKodu);
      locationIds.add(session.locationId);
    });
  });

  const brands: ExportBrand[] = Array.from(brandMap.entries())
    .map(([marka, locs]) => {
      const locations: ExportLocationRow[] = Array.from(locs.entries())
        .map(([locationId, cell]) => ({
          locationId,
          locationName: cell.name,
          kod: locationInfo.get(locationId)?.kod || '',
          type: cell.type,
          costTL: cell.costTL,
          productCount: cell.products.size,
        }))
        .sort((a, b) => b.costTL - a.costTL);
      const productSet = new Set<string>();
      locs.forEach((cell) => cell.products.forEach((p) => productSet.add(p)));
      const totalTL = locations.reduce((s, l) => s + l.costTL, 0);
      return { marka, totalTL, productCount: productSet.size, locations };
    })
    .filter((b) => b.totalTL > 0 || b.locations.length > 0)
    .sort((a, b) => b.totalTL - a.totalTL);

  const grandTotalTL = brands.reduce((s, b) => s + b.totalTL, 0);

  return { periodLabel, generatedAt: new Date(), brands, grandTotalTL, locationCount: locationIds.size };
}

// ── Biçimlendirme yardımcıları ──────────────────────────────────────────────

const TL_FMT = '#,##0.00" ₺"';
const HEADER_FILL = 'FF1F4E79'; // koyu mavi
const HEADER_FONT = 'FFFFFFFF';
const TITLE_FILL = 'FFFFF2CC'; // açık sarı (manuel şablon başlığı gibi)
const TOTAL_FILL = 'FFFCE4A6'; // sarı toplam satırı
const ALT_ROW_FILL = 'FFF3F7FC'; // hafif mavi zebra

const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function styleHeaderCell(cell: any) {
  cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 11 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = BORDER;
}

/** Sütun genişliklerini içerik uzunluğuna göre otomatik ayarlar (autofit). */
function autofitColumns(ws: any, headers: string[], rows: (string | number)[][], min = 10, max = 48) {
  headers.forEach((h, i) => {
    let w = String(h).length + 2;
    rows.forEach((r) => {
      const v = r[i];
      const len = v == null ? 0 : (typeof v === 'number' ? v.toLocaleString('tr-TR', { minimumFractionDigits: 2 }).length + 2 : String(v).length);
      if (len + 2 > w) w = len + 2;
    });
    ws.getColumn(i + 1).width = Math.min(Math.max(w, min), max);
  });
}

/**
 * Modeli çok sayfalı, biçimli bir .xlsx olarak indirir.
 */
export async function downloadStokMaliyetExcel(model: StokExportModel, fileName: string): Promise<void> {
  const ExcelJS = await import('exceljs');
  const fileSaverModule = await import('file-saver');
  const saveAs =
    (fileSaverModule as any).saveAs ||
    (fileSaverModule as any).default?.saveAs ||
    (fileSaverModule as any).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QORE';
  workbook.created = new Date();

  // ── 1) Genel Tablo ────────────────────────────────────────────────────────
  const genel = workbook.addWorksheet('Genel Tablo', { views: [{ state: 'frozen', ySplit: 3 }] });

  // Başlık bandı
  genel.mergeCells('A1:D1');
  const titleCell = genel.getCell('A1');
  titleCell.value = 'STOK MALİYET TABLOSU';
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
  genel.getRow(1).height = 26;

  genel.mergeCells('A2:D2');
  const subCell = genel.getCell('A2');
  subCell.value = `Dönem: ${model.periodLabel}  ·  ${model.locationCount} lokasyon  ·  ${model.brands.length} marka  ·  Oluşturma: ${model.generatedAt.toLocaleString('tr-TR')}  ·  Tüm tutarlar ₺`;
  subCell.font = { italic: true, size: 10, color: { argb: 'FF595959' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const genelHeaders = ['Marka', 'Toplam Stok Maliyeti', 'Ürün Sayısı', 'Lokasyon Sayısı'];
  const headerRow = genel.getRow(3);
  genelHeaders.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    styleHeaderCell(cell);
  });
  headerRow.height = 22;

  const genelBodyRows: (string | number)[][] = [];
  model.brands.forEach((b, idx) => {
    const r = genel.getRow(4 + idx);
    r.getCell(1).value = b.marka;
    r.getCell(2).value = b.totalTL;
    r.getCell(2).numFmt = TL_FMT;
    r.getCell(3).value = b.productCount;
    r.getCell(4).value = b.locations.length;
    for (let c = 1; c <= 4; c++) {
      const cell = r.getCell(c);
      cell.border = BORDER;
      cell.alignment = { horizontal: c === 1 ? 'left' : c === 2 ? 'right' : 'center', vertical: 'middle' };
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_ROW_FILL } };
    }
    genelBodyRows.push([b.marka, b.totalTL, b.productCount, b.locations.length]);
  });

  // Genel toplam satırı
  const totalRowIdx = 4 + model.brands.length;
  const totalRow = genel.getRow(totalRowIdx);
  totalRow.getCell(1).value = 'GENEL TOPLAM';
  totalRow.getCell(2).value = model.grandTotalTL;
  totalRow.getCell(2).numFmt = TL_FMT;
  for (let c = 1; c <= 4; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
    cell.border = BORDER;
    cell.alignment = { horizontal: c === 1 ? 'left' : c === 2 ? 'right' : 'center', vertical: 'middle' };
  }

  autofitColumns(genel, genelHeaders, [...genelBodyRows, ['GENEL TOPLAM', model.grandTotalTL, '', '']], 14, 42);

  // ── 2) Marka başına Marka–Kurum dağılımı ─────────────────────────────────
  const usedNames = new Set<string>(['Genel Tablo']);
  const sanitizeSheetName = (name: string): string => {
    let base = name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Marka';
    let candidate = base;
    let i = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${base.slice(0, 26)} ${i++}`;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };

  model.brands.forEach((brand) => {
    const ws = workbook.addWorksheet(sanitizeSheetName(brand.marka), { views: [{ state: 'frozen', ySplit: 3 }] });

    ws.mergeCells('A1:E1');
    const t = ws.getCell('A1');
    t.value = `${brand.marka} — Kurum Dağılımı`;
    t.font = { bold: true, size: 13, color: { argb: 'FF1F4E79' } };
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
    ws.getRow(1).height = 24;

    ws.mergeCells('A2:E2');
    const s = ws.getCell('A2');
    s.value = `Dönem: ${model.periodLabel}  ·  Toplam: ${brand.totalTL.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺  ·  Tüm tutarlar ₺`;
    s.font = { italic: true, size: 10, color: { argb: 'FF595959' } };
    s.alignment = { horizontal: 'center', vertical: 'middle' };

    const headers = ['Kurum', 'Lab Kodu', 'Tip', 'Stok Maliyeti', 'Ürün Sayısı'];
    const hr = ws.getRow(3);
    headers.forEach((h, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = h;
      styleHeaderCell(cell);
    });
    hr.height = 22;

    const bodyRows: (string | number)[][] = [];
    brand.locations.forEach((loc, idx) => {
      const r = ws.getRow(4 + idx);
      r.getCell(1).value = loc.locationName;
      r.getCell(2).value = loc.kod || '';
      r.getCell(3).value = loc.type === 'lab' ? 'Lab' : 'Depo';
      r.getCell(4).value = loc.costTL;
      r.getCell(4).numFmt = TL_FMT;
      r.getCell(5).value = loc.productCount;
      for (let c = 1; c <= 5; c++) {
        const cell = r.getCell(c);
        cell.border = BORDER;
        cell.alignment = { horizontal: c === 4 ? 'right' : c === 1 ? 'left' : 'center', vertical: 'middle' };
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_ROW_FILL } };
      }
      bodyRows.push([loc.locationName, loc.kod || '', loc.type === 'lab' ? 'Lab' : 'Depo', loc.costTL, loc.productCount]);
    });

    const tr = ws.getRow(4 + brand.locations.length);
    tr.getCell(1).value = 'TOPLAM';
    tr.getCell(4).value = brand.totalTL;
    tr.getCell(4).numFmt = TL_FMT;
    for (let c = 1; c <= 5; c++) {
      const cell = tr.getCell(c);
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
      cell.border = BORDER;
      cell.alignment = { horizontal: c === 4 ? 'right' : c === 1 ? 'left' : 'center', vertical: 'middle' };
    }

    autofitColumns(ws, headers, [...bodyRows, ['TOPLAM', '', '', brand.totalTL, '']], 10, 46);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}
