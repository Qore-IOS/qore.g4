import test from 'node:test';
import assert from 'node:assert/strict';
import { getStockItemQuantity, sumStockItemQuantities } from '../src/lib/stock-quantity';

test('getStockItemQuantity falls back to one for legacy or invalid stock docs', () => {
  assert.equal(getStockItemQuantity({}), 1);
  assert.equal(getStockItemQuantity({ adet: 0 } as any), 1);
  assert.equal(getStockItemQuantity({ adet: -4 } as any), 1);
  assert.equal(getStockItemQuantity({ adet: 'not-a-number' } as any), 1);
});

test('getStockItemQuantity returns document quantity for lot/quantity tracked stock docs', () => {
  assert.equal(getStockItemQuantity({ adet: 20 } as any), 20);
  assert.equal(getStockItemQuantity({ adet: '26' } as any), 26);
});

test('sumStockItemQuantities sums units instead of stock document count', () => {
  const docs = [
    { adet: 20 },
    { adet: 6 },
    {},
  ] as any[];

  assert.equal(docs.length, 3);
  assert.equal(sumStockItemQuantities(docs), 27);
});
