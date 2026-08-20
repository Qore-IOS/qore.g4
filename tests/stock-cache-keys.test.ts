import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WHOLE_COLLECTION_DEPOSTOK_KEYS,
  isDepoStokKey,
  isWholeCollectionDepoStokKey,
} from '../src/lib/stock-cache-keys';

// Bu testler bir FATURA regresyonunu korur. Stok metadata'sı her değiştiğinde
// açık olan her sekmede depoStok sorguları geçersizleştiriliyor; koleksiyonun
// TAMAMINI okuyan sorgular ucuz olanlarla aynı kefeye konursa tek bir yazma
// tüm sekmelerde tam koleksiyon okumasına yol açar (üretimde 190 yazmaya
// karşılık 4,2 milyon okuma).

test('depo/lab filtreli depoStok sorguları UCUZ sayılır', () => {
  const scoped: readonly unknown[][] = [
    ['depoStok', 'depot-1', 'company-1', false],
    ['depoStok', 'lite', 'depot-1', 'company-1', false],
    ['depoStok', 'serialIndex', 'depot-1', 'company-1', false],
    ['depoStok', 'unshipped', 'depot-1', 'company-1', false],
    // useLabStock — lab filtreli, koleksiyon geneli DEĞİL
    ['depoStok', 'shipped', 'lab-1,lab-2', 'Lab A,Lab B', 'company-1', false],
    ['depoStokPaginated', 'depot-1', 'company-1', false],
  ];
  for (const key of scoped) {
    assert.equal(isDepoStokKey(key), true, `depoStok anahtarı sayılmalı: ${JSON.stringify(key)}`);
    assert.equal(
      isWholeCollectionDepoStokKey(key),
      false,
      `koleksiyon geneli SAYILMAMALI: ${JSON.stringify(key)}`,
    );
  }
});

test('koleksiyonun tamamını okuyan depoStok sorguları PAHALI sayılır', () => {
  for (const marker of WHOLE_COLLECTION_DEPOSTOK_KEYS) {
    const key = ['depoStok', marker, 'company-1', false];
    assert.equal(isDepoStokKey(key), true);
    assert.equal(
      isWholeCollectionDepoStokKey(key),
      true,
      `koleksiyon geneli sayılmalı: ${marker}`,
    );
  }
});

test("useLabStock'un 'shipped' anahtarı koleksiyon geneli 'shipped-all' ile karışmaz", () => {
  // Bu ayrım bilerek yapıldı: ikisi de 'shipped' olsaydı ön ek eşleşmesi
  // lab filtreli ucuz sorguyla koleksiyon genelini birlikte yenilerdi.
  assert.equal(WHOLE_COLLECTION_DEPOSTOK_KEYS.has('shipped'), false);
  assert.equal(WHOLE_COLLECTION_DEPOSTOK_KEYS.has('shipped-all'), true);
});

test('depoStok dışındaki önbellek anahtarları kapsam dışıdır', () => {
  for (const key of [['productCodes'], ['hospitals', 'company-1'], ['tuketimKayitlari', 200], []]) {
    assert.equal(isDepoStokKey(key), false, `kapsam dışı olmalı: ${JSON.stringify(key)}`);
    assert.equal(isWholeCollectionDepoStokKey(key), false);
  }
});

test('ikinci parça dizge değilse koleksiyon geneli sayılmaz', () => {
  // ['depoStok', depotId] biçiminde depotId undefined olabilir; bu durumda
  // sorgu zaten çalışmaz ama sınıflandırma yine de pahalı dememelidir.
  assert.equal(isWholeCollectionDepoStokKey(['depoStok', undefined]), false);
  assert.equal(isWholeCollectionDepoStokKey(['depoStok']), false);
});
