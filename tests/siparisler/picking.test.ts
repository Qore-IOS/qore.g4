import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateOrderItemsByProduct,
  decodeLotPickingIdentifier,
  encodeLotPickingIdentifier,
  findAvailableStockForQuantityScan,
} from '../../src/lib/siparisler/picking';

test('aynı ürünün sipariş kalemlerini tek satırda toplar', () => {
  const result = aggregateOrderItemsByProduct([
    { stokKodu: 'ABC', stokAdi: 'Ürün', adet: 3 },
    { stokKodu: 'ABC', stokAdi: 'Ürün', adet: 2 },
    { stokKodu: 'XYZ', stokAdi: 'Diğer', adet: 1 },
  ]);

  assert.deepEqual(result.map(item => [item.stokKodu, item.adet]), [['ABC', 5], ['XYZ', 1]]);
});

test('lot identifier gerçek lotu tire ve özel karakterlerle kayıpsız taşır', () => {
  const identifier = encodeLotPickingIdentifier('LOT-2026/06 A', 2);
  assert.equal(decodeLotPickingIdentifier(identifier), 'LOT-2026/06 A');
});

test('bir lot dolunca sıradaki FEFO lotundan toplamaya devam eder', () => {
  const stock = [
    { id: 'lot-a', stokKodu: 'ABC', lotNumarasi: 'LOT-A', miad: '01.07.2026', adet: 2 },
    { id: 'lot-b', stokKodu: 'ABC', lotNumarasi: 'LOT-B', miad: '01.08.2026', adet: 3 },
  ];
  const scanned = [encodeLotPickingIdentifier('LOT-A', 1), encodeLotPickingIdentifier('LOT-A', 2)];

  assert.equal(findAvailableStockForQuantityScan(stock, scanned)?.lotNumarasi, 'LOT-B');
  assert.equal(findAvailableStockForQuantityScan(stock, scanned, 'LOT-A'), undefined);
});
