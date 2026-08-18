/**
 * Direkt transfer FEFO indeksi, tahsisi ve uyarı taraması.
 *
 * Testlerin ağırlığı, panelde bulunan üç somut hatanın bir daha dönmemesi
 * üzerinedir:
 *  1. `dd.MM.yyyy` miadların gün/ay yer değiştirmesi,
 *  2. bir belgeden kısmen alındığında kalanın havuzda kalmaması,
 *  3. transferin tamamını tükettiği belgenin yine de "önerilen" gösterilmesi.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BILINMEYEN_MIAD,
  allocateGroupRows,
  buildStockSnapshot,
  findFefoViolations,
  lotKey,
  miadMillis,
} from '../../src/lib/direkt-transfer/fefo.js';
import type { DepoStokItem } from '@/lib/types';
import type { TransferRow } from '@/lib/direkt-transfer/types';

// ── yardımcılar ──────────────────────────────────────────────────────────────

let sayac = 0;
function stok(over: Partial<DepoStokItem> = {}): DepoStokItem {
  sayac += 1;
  return {
    id: over.id ?? `doc-${sayac}`,
    stokKodu: 'KIT-1',
    stokAdi: 'Test Kiti',
    miad: '31.12.2027',
    adet: 1,
    ...over,
  } as DepoStokItem;
}

function satir(over: Partial<TransferRow> = {}): TransferRow {
  return {
    id: over.key ?? 'row',
    key: over.key ?? 'row',
    stokKodu: 'KIT-1',
    stokAdi: 'Test Kiti',
    miad: '',
    adet: 1,
    isGroup: true,
    ...over,
  } as TransferRow;
}

const gun = (d: Date | null) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null);
const millisGunu = (ms: number) => gun(new Date(ms));

const lotTakipli = () => false;
const adetTakipli = () => true;

// ── miad çözümü ──────────────────────────────────────────────────────────────

describe('miadMillis', () => {
  it('dd.MM.yyyy metnini TR kuralıyla okur (gün önde)', () => {
    // Regresyon: `new Date("01.02.2027")` V8'de 2 Ocak 2027 verir. Doğrusu
    // 1 Şubat 2027 — günü 12'den küçük her lot bu hatadan etkileniyordu.
    assert.equal(millisGunu(miadMillis({ miad: '01.02.2027' })), '2027-2-1');
    assert.equal(millisGunu(miadMillis({ miad: '05.11.2026' })), '2026-11-5');
    assert.equal(millisGunu(miadMillis({ miad: '31.12.2027' })), '2027-12-31');
  });

  it('ISO, tireli ve tek haneli biçimleri de çözer', () => {
    assert.equal(millisGunu(miadMillis({ miad: '2027-12-31' })), '2027-12-31');
    assert.equal(millisGunu(miadMillis({ miad: '01-02-2027' })), '2027-2-1');
    assert.equal(millisGunu(miadMillis({ miad: '1.2.2027' })), '2027-2-1');
  });

  it('yalnız ay/yıl verilmişse ayın son gününü kullanır', () => {
    assert.equal(millisGunu(miadMillis({ miad: '02.2027' })), '2027-2-28');
  });

  it('Date ve Firestore Timestamp benzeri değerleri kabul eder', () => {
    const d = new Date(2027, 1, 1);
    assert.equal(miadMillis({ miad: d }), d.getTime());
    assert.equal(millisGunu(miadMillis({ miad: { toDate: () => d } })), '2027-2-1');
  });

  it('çözülemeyen miadı sonsuz sayar (FEFO sırasının sonuna gider)', () => {
    assert.equal(miadMillis({ miad: '' }), BILINMEYEN_MIAD);
    assert.equal(miadMillis({ miad: 'yok' }), BILINMEYEN_MIAD);
    assert.equal(miadMillis({}), BILINMEYEN_MIAD);
    assert.equal(miadMillis(null), BILINMEYEN_MIAD);
  });
});

// ── indeks ───────────────────────────────────────────────────────────────────

describe('buildStockSnapshot', () => {
  it('miada göre sıralar, bilinmeyen miadı sona atar', () => {
    const a = stok({ id: 'a', miad: '31.12.2027' });
    const b = stok({ id: 'b', miad: '01.02.2027' }); // 1 Şubat — en erken
    const c = stok({ id: 'c', miad: '' });
    const snapshot = buildStockSnapshot([a, c, b]);

    assert.deepEqual(snapshot.byCode.get('KIT-1')?.map(i => i.id), ['b', 'a', 'c']);
    assert.equal(snapshot.expiryById.get('c'), BILINMEYEN_MIAD);
  });

  it('sevk edilmiş belgeleri ve mükerrer kimlikleri dışarıda bırakır', () => {
    const snapshot = buildStockSnapshot([
      stok({ id: 'a' }),
      stok({ id: 'a' }),
      stok({ id: 'b', isShipped: true }),
      stok({ id: 'c', isShipped: false }),
    ]);
    assert.deepEqual(snapshot.byCode.get('KIT-1')?.map(i => i.id), ['a', 'c']);
    assert.equal(snapshot.quantityById.has('b'), false);
  });

  it('lot havuzunu ayrı indeksler', () => {
    const snapshot = buildStockSnapshot([
      stok({ id: 'a', lotNumarasi: 'L1' }),
      stok({ id: 'b', lotNumarasi: 'L2' }),
    ]);
    assert.deepEqual(snapshot.byCodeAndLot.get(lotKey('KIT-1', 'L1'))?.map(i => i.id), ['a']);
    assert.deepEqual(snapshot.byCodeAndLot.get(lotKey('KIT-1', 'L2'))?.map(i => i.id), ['b']);
  });

  it('eşit miadda kararlı (belge kimliğine göre) sıra üretir', () => {
    const items = [stok({ id: 'z' }), stok({ id: 'm' }), stok({ id: 'a' })];
    const bir = buildStockSnapshot(items).byCode.get('KIT-1')?.map(i => i.id);
    const iki = buildStockSnapshot([...items].reverse()).byCode.get('KIT-1')?.map(i => i.id);
    assert.deepEqual(bir, ['a', 'm', 'z']);
    assert.deepEqual(iki, bir);
  });
});

// ── tahsis ───────────────────────────────────────────────────────────────────

describe('allocateGroupRows', () => {
  it('miadı en erken belgeden başlayarak karşılar', () => {
    const snapshot = buildStockSnapshot([
      stok({ id: 'gec', lotNumarasi: 'L1', miad: '31.12.2027', adet: 10 }),
      stok({ id: 'erken', lotNumarasi: 'L1', miad: '01.02.2027', adet: 10 }),
    ]);
    const row = satir({ key: 'r1', lotNumarasi: 'L1', adet: 3 });

    const { allocations, error } = allocateGroupRows({
      groupRows: [row], snapshot, isQuantityTracked: lotTakipli,
    });

    assert.equal(error, null);
    assert.deepEqual(allocations.get('r1'), [{ ...snapshot.byCode.get('KIT-1')![0], transferAdet: 3 }]);
    assert.equal(allocations.get('r1')![0].id, 'erken');
  });

  it('bir belgeden kısmen alındığında kalanı sonraki satıra bırakır', () => {
    // Regresyon: eski kod belgeyi ancak TAMAMI alındığında "kullanıldı"
    // sayıyordu; 10'luk bir belgeden 3 alındıktan sonra ikinci satır aynı
    // belgeyi yine 10 adetmiş gibi görüyor ve depoda olmayan stok tahsis
    // ediliyordu.
    const snapshot = buildStockSnapshot([stok({ id: 'tek', lotNumarasi: 'L1', adet: 10 })]);
    const rows = [
      satir({ key: 'r1', lotNumarasi: 'L1', adet: 6 }),
      satir({ key: 'r2', lotNumarasi: 'L1', adet: 4 }),
    ];

    const { allocations, error } = allocateGroupRows({
      groupRows: rows, snapshot, isQuantityTracked: lotTakipli,
    });

    assert.equal(error, null);
    assert.equal(allocations.get('r1')![0].transferAdet, 6);
    assert.equal(allocations.get('r2')![0].transferAdet, 4);
  });

  it('havuz tükendiğinde stoğu yetmeyen satırı bildirir', () => {
    const snapshot = buildStockSnapshot([stok({ id: 'tek', lotNumarasi: 'L1', adet: 10 })]);
    const rows = [
      satir({ key: 'r1', lotNumarasi: 'L1', adet: 6 }),
      satir({ key: 'r2', lotNumarasi: 'L1', adet: 5 }),
    ];

    const { allocations, error } = allocateGroupRows({
      groupRows: rows, snapshot, isQuantityTracked: lotTakipli,
    });

    assert.equal(error?.key, 'r2');
    assert.equal(allocations.size, 0);
  });

  it('tekil satır olarak rezerve edilmiş belgeyi havuzdan düşer', () => {
    const snapshot = buildStockSnapshot([
      stok({ id: 'rezerve', lotNumarasi: 'L1', miad: '01.02.2027', adet: 5 }),
      stok({ id: 'serbest', lotNumarasi: 'L1', miad: '31.12.2027', adet: 5 }),
    ]);

    const { allocations, error } = allocateGroupRows({
      groupRows: [satir({ key: 'r1', lotNumarasi: 'L1', adet: 5 })],
      snapshot,
      reservedIds: ['rezerve'],
      isQuantityTracked: lotTakipli,
    });

    assert.equal(error, null);
    assert.deepEqual(allocations.get('r1')!.map(p => p.id), ['serbest']);
  });

  it('adet takipli ve lotsuz satırı ürün kodunun tamamından karşılar', () => {
    const snapshot = buildStockSnapshot([
      stok({ id: 'l1', lotNumarasi: 'L1', miad: '01.02.2027', adet: 2 }),
      stok({ id: 'l2', lotNumarasi: 'L2', miad: '05.03.2027', adet: 2 }),
    ]);

    const { allocations, error } = allocateGroupRows({
      groupRows: [satir({ key: 'r1', lotNumarasi: '', adet: 3 })],
      snapshot,
      isQuantityTracked: adetTakipli,
    });

    assert.equal(error, null);
    assert.deepEqual(allocations.get('r1')!.map(p => [p.id, p.transferAdet]), [['l1', 2], ['l2', 1]]);
  });
});

// ── FEFO uyarısı ─────────────────────────────────────────────────────────────

describe('findFefoViolations', () => {
  it('depoda duran daha erken miadlı lotu önerir', () => {
    const erken = stok({ id: 'erken', lotNumarasi: 'L1', miad: '01.02.2027', adet: 5 });
    const gec = stok({ id: 'gec', lotNumarasi: 'L2', miad: '31.12.2027', adet: 5 });
    const snapshot = buildStockSnapshot([erken, gec]);

    const violations = findFefoViolations([gec], snapshot);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].scannedItem.id, 'gec');
    assert.equal(violations[0].recommendedItem.id, 'erken');
  });

  it('gün/ay karışıklığı yüzünden yanlış lotu önermez', () => {
    // "01.02.2027" 1 Şubat, "05.01.2027" 5 Ocak'tır. Eski ayrıştırma ikisini de
    // ABD kuralıyla okuyup (2 Ocak / 1 Mayıs) sıralamayı ters çeviriyordu.
    const ocak = stok({ id: 'ocak', lotNumarasi: 'L1', miad: '05.01.2027' });
    const subat = stok({ id: 'subat', lotNumarasi: 'L2', miad: '01.02.2027' });
    const snapshot = buildStockSnapshot([ocak, subat]);

    const violations = findFefoViolations([subat], snapshot);
    assert.equal(violations[0]?.recommendedItem.id, 'ocak');

    // Ters yön: en erken lot zaten sevk ediliyorsa uyarı çıkmaz.
    assert.equal(findFefoViolations([ocak], snapshot).length, 0);
  });

  it('transferin tamamını tükettiği belgeyi önermez', () => {
    // Regresyon: eski kod yalnızca belge kimliğine bakıyordu ama kısmi
    // kullanımı hesaba katmıyordu; burada erken lotun TAMAMI zaten bu
    // transferde, geriye önerilecek bir şey kalmıyor.
    const erken = stok({ id: 'erken', lotNumarasi: 'L1', miad: '01.02.2027', adet: 4 });
    const gec = stok({ id: 'gec', lotNumarasi: 'L2', miad: '31.12.2027', adet: 4 });
    const snapshot = buildStockSnapshot([erken, gec]);

    const violations = findFefoViolations(
      [{ ...erken, transferAdet: 4 }, { ...gec, transferAdet: 4 }],
      snapshot,
    );

    assert.deepEqual(violations, []);
  });

  it('erken lottan kısmen alınmışsa kalan birim için uyarır', () => {
    const erken = stok({ id: 'erken', lotNumarasi: 'L1', miad: '01.02.2027', adet: 10 });
    const gec = stok({ id: 'gec', lotNumarasi: 'L2', miad: '31.12.2027', adet: 10 });
    const snapshot = buildStockSnapshot([erken, gec]);

    const violations = findFefoViolations(
      [{ ...erken, transferAdet: 3 }, { ...gec, transferAdet: 5 }],
      snapshot,
    );

    assert.equal(violations.length, 1);
    assert.equal(violations[0].scannedItem.id, 'gec');
    assert.equal(violations[0].recommendedItem.id, 'erken');
  });

  it('sevk edilmiş (depoda olmayan) kaydı önermez', () => {
    const sevkEdilmis = stok({ id: 'sevk', miad: '01.02.2027', isShipped: true });
    const gec = stok({ id: 'gec', miad: '31.12.2027' });
    const snapshot = buildStockSnapshot([sevkEdilmis, gec]);

    assert.deepEqual(findFefoViolations([gec], snapshot), []);
  });

  it('başka ürün kodundaki erken lotu karıştırmaz', () => {
    const baskaUrun = stok({ id: 'baska', stokKodu: 'KIT-2', miad: '01.02.2027' });
    const gec = stok({ id: 'gec', stokKodu: 'KIT-1', miad: '31.12.2027' });
    const snapshot = buildStockSnapshot([baskaUrun, gec]);

    assert.deepEqual(findFefoViolations([gec], snapshot), []);
  });

  it('miadı bilinmeyen kalem için uyarı üretmez ve bilinmeyeni önermez', () => {
    const bilinmeyen = stok({ id: 'bilinmeyen', miad: '' });
    const gec = stok({ id: 'gec', miad: '31.12.2027' });
    const snapshot = buildStockSnapshot([bilinmeyen, gec]);

    // Sıralanamayan kalem uyarı üretmez…
    assert.deepEqual(findFefoViolations([bilinmeyen], snapshot), []);
    // …ve bilinmeyen miad hiçbir zaman "daha erken" sayılmaz.
    assert.deepEqual(findFefoViolations([gec], snapshot), []);
  });

  it('aynı miadı ihlal saymaz', () => {
    const a = stok({ id: 'a', lotNumarasi: 'L1', miad: '01.02.2027' });
    const b = stok({ id: 'b', lotNumarasi: 'L2', miad: '01.02.2027' });
    const snapshot = buildStockSnapshot([a, b]);

    assert.deepEqual(findFefoViolations([b], snapshot), []);
  });

  it('kalem başına tek uyarı döndürür', () => {
    const erken = stok({ id: 'erken', miad: '01.02.2027', adet: 50 });
    const gec = stok({ id: 'gec', miad: '31.12.2027', adet: 5 });
    const snapshot = buildStockSnapshot([erken, gec]);

    const violations = findFefoViolations([gec, gec, gec], snapshot);
    assert.equal(violations.length, 1);
  });

  it('boş sevk listesinde iş yapmaz', () => {
    assert.deepEqual(findFefoViolations([], buildStockSnapshot([stok()])), []);
  });
});

// ── uçtan uca: tahsis + uyarı aynı görüntüyü paylaşır ────────────────────────

describe('tahsis ve uyarı aynı anlık görüntüyü paylaşır', () => {
  it('FEFO ile tahsis edilen grup satırı uyarı üretmez', () => {
    const snapshot = buildStockSnapshot([
      stok({ id: 'erken', lotNumarasi: 'L1', miad: '01.02.2027', adet: 4 }),
      stok({ id: 'orta', lotNumarasi: 'L2', miad: '05.06.2027', adet: 4 }),
      stok({ id: 'gec', lotNumarasi: 'L3', miad: '31.12.2027', adet: 4 }),
    ]);

    const { allocations, error } = allocateGroupRows({
      groupRows: [satir({ key: 'r1', lotNumarasi: '', adet: 8 })],
      snapshot,
      isQuantityTracked: adetTakipli,
    });

    assert.equal(error, null);
    const itemsToShip = allocations.get('r1')!;
    assert.deepEqual(itemsToShip.map(i => i.id), ['erken', 'orta']);
    assert.deepEqual(findFefoViolations(itemsToShip, snapshot), []);
  });

  it('lotu elle sabitlenmiş satır için uyarı üretilir', () => {
    const snapshot = buildStockSnapshot([
      stok({ id: 'erken', lotNumarasi: 'L1', miad: '01.02.2027', adet: 4 }),
      stok({ id: 'gec', lotNumarasi: 'L3', miad: '31.12.2027', adet: 4 }),
    ]);

    const { allocations } = allocateGroupRows({
      groupRows: [satir({ key: 'r1', lotNumarasi: 'L3', adet: 2 })],
      snapshot,
      isQuantityTracked: lotTakipli,
    });

    const violations = findFefoViolations(allocations.get('r1')!, snapshot);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].recommendedItem.id, 'erken');
  });
});
