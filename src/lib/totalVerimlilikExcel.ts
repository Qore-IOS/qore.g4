'use client';

/**
 * Total Verimlilik "ilgili dönem tablosu" için özelleştirilmiş Excel çıktısı.
 *
 * Özellikler:
 *  - Başlık satırı + Laboratuvar / Lab Kodu / (Stok Kodu) / Ürün Adı sütunları donuk (freeze).
 *  - Tüm sütunlar içerik genişliğine göre (autofit), tüm metinler ortalı, tüm hücrelerde kenarlık.
 *  - Başlıklar kalın font.
 *  - Kaldırılan sütunlar: Göztepe Sevkiyat (Kutu), Kurumlar Arası Sevk (Kutu), Kaynak Lab,
 *    Lojistik Ara Transfer (Kutu).
 *  - Yeni sütun: "Kalması Gereken Stok" = Sevkiyatlar Sonrası Total Test − Kümülatif Total (Test),
 *    "Dönem Sonu Toplam Test" sütununun hemen soluna eklenir (mavi).
 *  - Sarı: Sevkiyatlar Sonrası Total Test, Kümülatif Total (Test).
 *  - Mavi: Kalması Gereken Stok, Dönem Sonu Toplam Test.
 *  - Yeşil: Stok Doğruluk Fark (Test), Stok Doğruluk Durum, Kutu Kayıp.
 *  - Kutu Kayıp > 1,5 olan satırlar komple kırmızıya boyanır (sütun renklerini geçersiz kılar).
 */

type Fill = 'yellow' | 'blue' | 'green' | null;

interface ColDef {
  label: string;
  key?: string;          // kaynak veri objesindeki alan adı (başlık adıyla aynı)
  computed?: 'kalmasi';  // türetilmiş sütun
  fill?: Fill;
}

// Çıktı sütun sırası (kaldırılanlar hariç, "Kalması Gereken Stok" eklenmiş).
const COLUMNS: ColDef[] = [
  { label: 'Laboratuvar', key: 'Laboratuvar' },
  { label: 'Lab Kodu', key: 'Lab Kodu' },
  { label: 'Stok Kodu', key: 'Stok Kodu' },
  { label: 'Ürün Adı', key: 'Ürün Adı' },
  { label: 'Test Adı', key: 'Test Adı' },
  { label: 'Ambalaj Miktarı', key: 'Ambalaj Miktarı' },
  { label: 'Cihaz Grubu', key: 'Cihaz Grubu' },
  { label: 'Başlangıç Stoğu (Kutu)', key: 'Başlangıç Stoğu (Kutu)' },
  { label: 'Ay Başı Cihaz Üstü (Test)', key: 'Ay Başı Cihaz Üstü (Test)' },
  { label: 'Total Ay Başı Stok (Test)', key: 'Total Ay Başı Stok (Test)' },
  { label: 'Ay Başı Sevkiyat (Kutu)', key: 'Ay Başı Sevkiyat (Kutu)' },
  { label: 'Ay Başı Sevkiyat (Test)', key: 'Ay Başı Sevkiyat (Test)' },
  { label: 'Sevkiyatlar Sonrası Total Test', key: 'Sevkiyatlar Sonrası Total Test', fill: 'yellow' },
  { label: 'Kümülatif Total (Test)', key: 'Kümülatif Total (Test)', fill: 'yellow' },
  { label: 'Kümülatif Kalibrasyon (Ham)', key: 'Kümülatif Kalibrasyon (Ham)' },
  { label: 'Kümülatif Kontrol (Ham)', key: 'Kümülatif Kontrol (Ham)' },
  { label: 'Dönem Sonu Stok (Kutu)', key: 'Dönem Sonu Stok (Kutu)' },
  { label: 'Dönem Sonu Cihaz Üstü (Test)', key: 'Dönem Sonu Cihaz Üstü (Test)' },
  { label: 'Kalması Gereken Stok', computed: 'kalmasi', fill: 'blue' },
  { label: 'Dönem Sonu Toplam Test', key: 'Dönem Sonu Toplam Test', fill: 'blue' },
  { label: 'Arızalı Kitler (Test)', key: 'Arızalı Kitler (Test)' },
  { label: 'Beklenen Test (Test)', key: 'Beklenen Test (Test)' },
  { label: 'Rutin (Test)', key: 'Rutin (Test)' },
  { label: 'Stok Doğruluk Fark (Test)', key: 'Stok Doğruluk Fark (Test)', fill: 'green' },
  { label: 'Stok Doğruluk Durum', key: 'Stok Doğruluk Durum', fill: 'green' },
  { label: 'Kutu Kayıp', key: 'Kutu Kayıp', fill: 'green' },
  { label: 'Kit Verimlilik Fark (Test)', key: 'Kit Verimlilik Fark (Test)' },
  { label: 'Stok Doğruluk Sapma (%)', key: 'Stok Doğruluk Sapma (%)' },
  { label: 'Kit Verimlilik Sapma (%)', key: 'Kit Verimlilik Sapma (%)' },
];

const FILL_ARGB: Record<Exclude<Fill, null>, string> = {
  yellow: 'FFFFEB9C',
  blue: 'FFBDD7EE',
  green: 'FFC6EFCE',
};
const HEADER_NEUTRAL = 'FFEDEDED';
const RED_ROW = 'FFFFC7CE';
const KUTU_KAYIP_THRESHOLD = 1.5;
// Freeze: başlık satırı + ilk 4 sütun (Laboratuvar, Lab Kodu, Stok Kodu, Ürün Adı)
const FREEZE_COLS = 4;

const KALMASI_LABEL = 'Kalması Gereken Stok';
const KUTU_KAYIP_LABEL = 'Kutu Kayıp';

function computeValue(col: ColDef, row: Record<string, any>): string | number {
  if (col.computed === 'kalmasi') {
    const q = Number(row['Sevkiyatlar Sonrası Total Test']) || 0;
    const kum = Number(row['Kümülatif Total (Test)']) || 0;
    return Math.round(q - kum);
  }
  const v = row[col.key as string];
  return v === undefined || v === null ? '' : (v as string | number);
}

/** Özelleştirilmiş, biçimlendirilmiş Total Verimlilik Excel'ini üretip indirir. */
export async function exportTotalVerimlilikStyledExcel(
  data: Record<string, any>[],
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
  const ws = workbook.addWorksheet('Veriler', { views: [{ state: 'frozen', xSplit: FREEZE_COLS, ySplit: 1 }] });

  const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: false };

  // başlık satırı
  const headerRow = ws.getRow(1);
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: 'FF1F2937' } };
    cell.alignment = center;
    cell.border = border;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.fill ? FILL_ARGB[col.fill] : HEADER_NEUTRAL } };
  });
  headerRow.height = 30;

  // veri satırları
  data.forEach((row, ri) => {
    const r = ws.getRow(ri + 2);
    const kutuKayip = Number(row[KUTU_KAYIP_LABEL]) || 0;
    const isRed = kutuKayip > KUTU_KAYIP_THRESHOLD;
    COLUMNS.forEach((col, ci) => {
      const cell = r.getCell(ci + 1);
      cell.value = computeValue(col, row);
      cell.alignment = center;
      cell.border = border;
      const fillArgb = isRed ? RED_ROW : (col.fill ? FILL_ARGB[col.fill] : null);
      if (fillArgb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
      if (isRed) cell.font = { bold: true };
    });
  });

  // autofit — her sütunu içerik uzunluğuna göre
  COLUMNS.forEach((col, ci) => {
    let maxLen = col.label.length;
    data.forEach((row) => {
      const v = computeValue(col, row);
      const s = typeof v === 'number' ? v.toLocaleString('tr-TR') : String(v ?? '');
      if (s.length > maxLen) maxLen = s.length;
    });
    ws.getColumn(ci + 1).width = Math.min(48, Math.max(10, maxLen + 2));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`,
  );
}
