import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

const { buildLabStockDocs, transferIdFor, normalizeMiad, isSerialTracked } = require(
  path.resolve(process.cwd(), 'scripts/ceomed-sync/lib/stockDocs.js'),
);

const lab = { id: 'lab-1', name: 'Merkez Lab' };
const companyId = 'acme';

const products = new Map<string, any>([
  ['SER-1', { stokKodu: 'SER-1', stokAdi: 'Seri Kit', trackingMode: 'serial', urunGrubu: 'kit', ambalajDegeri: 100 }],
  ['LOT-1', { stokKodu: 'LOT-1', stokAdi: 'Lot Ürün', trackingMode: 'lot_barcode', urunGrubu: 'sarf' }],
]);

const irsaliye = (items: any[]) => ({
  ceomedId: 4711,
  irsaliyeNo: 'IRS-001',
  cariKodu: 'M51001',
  sevkAdresi: 'A Blok',
  items,
});

function build(items: any[]) {
  const irs = irsaliye(items);
  return buildLabStockDocs({
    irsaliye: irs,
    lab,
    productsByCode: products,
    companyId,
    transferId: transferIdFor(irs),
    sourceDepot: { id: 'depo-1', name: 'Merkez Depo' },
  });
}

test('seri takipli ürün için her birim ayrı belge ve adet 1 olur', () => {
  const r = build([
    { STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-A', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 },
    { STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-B', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 },
  ]);
  assert.equal(r.stockDocs.length, 2);
  assert.equal(r.totalUnits, 2);
  r.stockDocs.forEach((d: any) => assert.equal(d.data.adet, 1));
  assert.deepEqual(r.stockDocs.map((d: any) => d.data.seriNumarasi).sort(), ['SN-A', 'SN-B']);
});

test('seri takipli üründe MIKTAR>1 gelse bile tek birim yazılır', () => {
  // Aksi hâlde aynı seri numarası birden çok fiziksel birimi temsil eder ve
  // seri defteri ile stok tutarsız kalır.
  const r = build([{ STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-A', LOT: 'L1', MIYAT: '261231', MIKTAR: 5 }]);
  assert.equal(r.stockDocs.length, 1);
  assert.equal(r.stockDocs[0].data.adet, 1);
  assert.equal(r.totalUnits, 1);
});

test('lot takipli ürün tek belgede adet ile yazılır', () => {
  const r = build([{ STOK_KODU: 'LOT-1', BARKOD_SERI: '', LOT: 'L9', MIYAT: '270101', MIKTAR: 12 }]);
  assert.equal(r.stockDocs.length, 1);
  assert.equal(r.stockDocs[0].data.adet, 12);
  assert.equal(r.totalUnits, 12);
});

test('stok belgeleri laboratuvar stoğu olarak işaretlenir', () => {
  const r = build([{ STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-A', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 }]);
  const d = r.stockDocs[0].data;
  // Qore modelinde laboratuvar stoğu = isShipped true + hedefKurumId dolu.
  assert.equal(d.isShipped, true);
  assert.equal(d.hedefKurumId, 'lab-1');
  assert.equal(d.hedefKurum, 'Merkez Lab');
  assert.equal(d.companyId, 'acme');
  assert.equal(d.source, 'ceomed-auto');
  assert.equal(d.ceomedIrsaliyeId, 4711);
  assert.equal(d.irsaliyeNumarasi, 'IRS-001');
});

test('ürün kataloğu bilgileri stok satırına taşınır', () => {
  const r = build([{ STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-A', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 }]);
  const d = r.stockDocs[0].data;
  assert.equal(d.stokAdi, 'Seri Kit');
  assert.equal(d.urunGrubu, 'kit');
  assert.equal(d.ambalajDegeri, 100);
});

test('miad panellerin beklediği dd.MM.yyyy biçimine çevrilir', () => {
  // ERP'nin 6 haneli miadı YYMMDD'dir; uygulamanın normalizeMiad'ı da böyle
  // okur. Watcher aynı dönüşümü kullanır ki elle aktarımla aynı sonucu versin.
  const r = build([{ STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-A', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 }]);
  assert.equal(r.stockDocs[0].data.miad, '31.12.2026');
});

test('belge kimlikleri deterministiktir — aynı irsaliye iki kez işlenirse mükerrer stok olmaz', () => {
  const items = [
    { STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-A', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 },
    { STOK_KODU: 'LOT-1', BARKOD_SERI: '', LOT: 'L9', MIYAT: '270101', MIKTAR: 3 },
  ];
  const ilk = build(items);
  const ikinci = build(items);
  assert.deepEqual(
    ilk.stockDocs.map((d: any) => d.id),
    ikinci.stockDocs.map((d: any) => d.id),
  );
});

test('farklı seriler farklı belge kimliği üretir', () => {
  const r = build([
    { STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-A', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 },
    { STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-B', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 },
  ]);
  assert.equal(new Set(r.stockDocs.map((d: any) => d.id)).size, 2);
});

test('belge kimliği Firestore için güvenli karakterlere indirgenir', () => {
  const r = build([{ STOK_KODU: 'SER-1', BARKOD_SERI: '01)08/34 17', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 }]);
  assert.ok(!r.stockDocs[0].id.includes('/'), 'belge kimliğinde / bulunamaz');
  assert.ok(/^[A-Za-z0-9._-]+$/.test(r.stockDocs[0].id));
});

test('kataloğu olmayan ürün yazılmaz, gerekçesiyle raporlanır', () => {
  const r = build([{ STOK_KODU: 'BILINMEYEN', BARKOD_SERI: 'SN-X', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 }]);
  assert.equal(r.stockDocs.length, 0);
  assert.deepEqual(r.skipped, [{ stokKodu: 'BILINMEYEN', reason: 'urun_kodu_tanimsiz' }]);
});

test('stok kodu boş satır atlanır', () => {
  const r = build([{ STOK_KODU: '', BARKOD_SERI: 'SN-X', MIKTAR: 1 }]);
  assert.equal(r.stockDocs.length, 0);
  assert.equal(r.skipped[0].reason, 'stok_kodu_yok');
});

test('transfer satırları stok belgeleriyle birebir eşleşir', () => {
  const r = build([
    { STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-A', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 },
    { STOK_KODU: 'LOT-1', BARKOD_SERI: '', LOT: 'L9', MIYAT: '270101', MIKTAR: 3 },
  ]);
  assert.equal(r.transferItems.length, r.stockDocs.length);
  assert.deepEqual(
    r.transferItems.map((i: any) => i.id).sort(),
    r.stockDocs.map((d: any) => d.id).sort(),
  );
});

test('özet satırlar ürün+lot+miad bazında toplanır', () => {
  const r = build([
    { STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-A', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 },
    { STOK_KODU: 'SER-1', BARKOD_SERI: 'SN-B', LOT: 'L1', MIYAT: '261231', MIKTAR: 1 },
  ]);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].adet, 2);
  assert.deepEqual(r.lines[0].serials.sort(), ['SN-A', 'SN-B']);
});

test('boş irsaliye güvenle ele alınır', () => {
  const r = build([]);
  assert.equal(r.stockDocs.length, 0);
  assert.equal(r.totalUnits, 0);
});

test('transfer kimliği irsaliye başına deterministiktir', () => {
  assert.equal(transferIdFor({ ceomedId: 4711 }), 'ceomed-4711');
  assert.equal(transferIdFor({ ceomedId: 4711 }), transferIdFor({ ceomedId: 4711 }));
});

test('miad normalizasyonu src/lib/date.ts ile birebir aynı davranır', () => {
  // 6 hane = YYMMDD (gün değil YIL başta). Bu kural uygulamanın her yerinde
  // geçerli; watcher farklı yorumlarsa aynı ürün elle ve otomatik aktarımda
  // farklı miadla stoğa girer.
  assert.equal(normalizeMiad('261231'), '31.12.2026');
  assert.equal(normalizeMiad('270101'), '01.01.2027');
  assert.equal(normalizeMiad('1.2.2027'), '01.02.2027');
  assert.equal(normalizeMiad('01/02/27'), '01.02.2027');
  assert.equal(normalizeMiad('01-02-2027'), '01.02.2027');
  assert.equal(normalizeMiad(''), '');
  assert.equal(normalizeMiad('serbest metin'), 'serbest metin');
});

test('takip modu ürün tanımından okunur, Roche varsayılanı korunur', () => {
  assert.equal(isSerialTracked({ trackingMode: 'serial' }), true);
  assert.equal(isSerialTracked({ trackingMode: 'lot_barcode' }), false);
  assert.equal(isSerialTracked({ marka: 'Roche Diagnostics' }), true);
  assert.equal(isSerialTracked({ marka: 'Diğer' }), false);
  assert.equal(isSerialTracked(null), false);
});
