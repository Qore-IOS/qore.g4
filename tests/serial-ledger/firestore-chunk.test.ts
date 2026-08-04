import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkForIn, FIRESTORE_IN_LIMIT } from '../../src/lib/firestore-chunk';

test('30 üyeye kadar tek parti üretilir', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `lab-${i}`);
  const chunks = chunkForIn(ids);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 30);
});

test('30 üyeden fazlası kırpılmaz, partilere bölünür', () => {
  // Bu davranış stok tutarsızlığının doğrudan kaynağıydı: eski kod
  // `labIds.slice(0, 30)` diyor ve 31. laboratuvardan itibaren havuz stoğunu
  // hiç okumuyordu.
  const ids = Array.from({ length: 74 }, (_, i) => `lab-${i}`);
  const chunks = chunkForIn(ids);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.flat().sort(), [...ids].sort(), 'hiçbir üye kaybolmamalı');
});

test('boş girdi hiç sorgu kurulmaması için boş dizi döndürür', () => {
  assert.deepEqual(chunkForIn([]), []);
  assert.deepEqual(chunkForIn(['', null as any, undefined as any]), []);
});

test('tekrarlı değerler tekilleştirilir', () => {
  assert.deepEqual(chunkForIn(['a', 'a', 'b', 'b', 'a']), [['a', 'b']]);
});

test('parti boyu özelleştirilebilir', () => {
  assert.deepEqual(chunkForIn(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
});

test('geçersiz parti boyu hata verir', () => {
  assert.throws(() => chunkForIn(['a'], 0), RangeError);
});

test('Firestore in sınırı 30 olarak sabitlenmiştir', () => {
  assert.equal(FIRESTORE_IN_LIMIT, 30);
});
