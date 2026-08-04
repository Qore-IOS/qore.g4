import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSerialLedgerId,
  canConsumeSerial,
  canReceiveSerial,
  describeSerialBlock,
  isTrackableSerial,
  locationTypeForEvent,
  normalizeLegacyEventType,
  projectEventFields,
  projectLedgerFields,
  statusForEvent,
  type SerialLedgerEntry,
} from '../../src/lib/serial-ledger/core';

const entry = (status: SerialLedgerEntry['status'], locationName = ''): SerialLedgerEntry => ({
  id: 'x',
  companyId: 'c1',
  stokKodu: '08324174190',
  stokAdi: 'Test Kit',
  seriNumarasi: 'SN-1',
  lotNumarasi: 'L1',
  miad: '01.01.2030',
  status,
  locationType: 'none',
  locationId: '',
  locationName,
  lastEventType: 'mal_kabul',
});

test('defter kimliği ürün kodu + seri no çiftine göre tekildir', () => {
  const a = buildSerialLedgerId('c1', 'KOD-A', 'SN-1');
  const b = buildSerialLedgerId('c1', 'KOD-B', 'SN-1');
  assert.notEqual(a, b, 'aynı seri farklı ürünlerde ayrı satır olmalı');
  assert.equal(a, buildSerialLedgerId('c1', 'KOD-A', 'SN-1'), 'aynı çift her zaman aynı kimliği vermeli');
});

test('defter kimliği şirketler arasında çakışmaz', () => {
  assert.notEqual(
    buildSerialLedgerId('c1', 'KOD-A', 'SN-1'),
    buildSerialLedgerId('c2', 'KOD-A', 'SN-1'),
  );
});

test('defter kimliği Firestore için güvenli karakterlere indirgenir', () => {
  const id = buildSerialLedgerId('c/1', 'KOD A', '01)0834/17 21');
  assert.ok(!id.includes('/'), 'belge kimliğinde / bulunamaz');
  assert.ok(/^sl_[A-Za-z0-9._-]+$/.test(id), `beklenmeyen karakter: ${id}`);
});

test('şirket kimliği yoksa legacy kovasına düşer', () => {
  assert.equal(buildSerialLedgerId(null, 'K', 'S'), buildSerialLedgerId('__legacy__', 'K', 'S'));
});

test('sayım yer tutucusu seri numaraları deftere girmez', () => {
  assert.equal(isTrackableSerial('FAZLA-abc123'), false);
  assert.equal(isTrackableSerial('SAYIM-abc123'), false);
  assert.equal(isTrackableSerial('   '), false);
  assert.equal(isTrackableSerial(''), false);
  assert.equal(isTrackableSerial('0834174190'), true);
});

test('olay tipleri doğru duruma çevrilir', () => {
  assert.equal(statusForEvent('mal_kabul'), 'depoda');
  assert.equal(statusForEvent('iade'), 'depoda');
  assert.equal(statusForEvent('transfer'), 'laboratuvarda');
  assert.equal(statusForEvent('siparis_karsilama'), 'laboratuvarda');
  assert.equal(statusForEvent('lab_transfer'), 'laboratuvarda');
  assert.equal(statusForEvent('borc'), 'borcta');
  assert.equal(statusForEvent('tuketim'), 'tuketildi');
  assert.equal(statusForEvent('imha'), 'imha_edildi');
  assert.equal(statusForEvent('sayim_dusum'), 'serbest');
  assert.equal(statusForEvent('duzeltme'), null, 'düzeltme durumu tek başına değiştirmez');
});

test('olay tipinden konum türü türetilir', () => {
  assert.equal(locationTypeForEvent('mal_kabul'), 'depot');
  assert.equal(locationTypeForEvent('transfer'), 'lab');
  assert.equal(locationTypeForEvent('borc'), 'borc');
  assert.equal(locationTypeForEvent('tuketim'), 'none');
  assert.equal(locationTypeForEvent('sayim_dusum'), 'none');
});

test('depo sayımıyla düşülen seri yeniden mal kabul edilebilir', () => {
  assert.equal(canReceiveSerial(entry('serbest')), true);
});

test('hâlâ stokta / kullanılmış seriler yeniden mal kabul edilemez', () => {
  assert.equal(canReceiveSerial(entry('depoda')), false);
  assert.equal(canReceiveSerial(entry('laboratuvarda')), false);
  assert.equal(canReceiveSerial(entry('borcta')), false);
  assert.equal(canReceiveSerial(entry('tuketildi')), false);
  assert.equal(canReceiveSerial(entry('imha_edildi')), false);
});

test('defterde hiç kaydı olmayan seri serbestçe kabul edilir', () => {
  assert.equal(canReceiveSerial(null), true);
  assert.equal(canReceiveSerial(undefined), true);
});

test('sayımdan düşülüp yeniden kabul edilen birim tüketilebilir', () => {
  // Kullanıcı akışının çekirdeği: sayım → serbest → mal kabul → depoda →
  // transfer → laboratuvarda. Hiçbir adımda tüketim engellenmemeli.
  assert.equal(canConsumeSerial(entry('serbest')), true);
  assert.equal(canConsumeSerial(entry('depoda')), true);
  assert.equal(canConsumeSerial(entry('laboratuvarda')), true);
});

test('tüketilmiş veya imha edilmiş birim yeniden tüketilemez', () => {
  assert.equal(canConsumeSerial(entry('tuketildi')), false);
  assert.equal(canConsumeSerial(entry('imha_edildi')), false);
});

test('engel gerekçesi konumu da içerir', () => {
  assert.match(describeSerialBlock(entry('laboratuvarda', 'Merkez Lab')), /Merkez Lab/);
  assert.match(describeSerialBlock(entry('tuketildi')), /tüketilmiş/);
  assert.match(describeSerialBlock(entry('serbest')), /yeniden işlem görebilir/);
});

test('eski olay sözlüğü yeni sözlüğe çevrilir', () => {
  assert.equal(normalizeLegacyEventType('intake'), 'mal_kabul');
  assert.equal(normalizeLegacyEventType('transfer'), 'transfer');
  assert.equal(normalizeLegacyEventType('depot_to_lab_transfer'), 'transfer');
  assert.equal(normalizeLegacyEventType('inter_lab_transfer'), 'lab_transfer');
  assert.equal(normalizeLegacyEventType('consumption'), 'tuketim');
  assert.equal(normalizeLegacyEventType('sayimdan_dusum'), 'sayim_dusum');
  assert.equal(normalizeLegacyEventType('bilinmeyen'), null);
  assert.equal(normalizeLegacyEventType(undefined), null);
});

test('defter alanları olaydan türetilirken şirket etiketi eklenir', () => {
  const fields = projectLedgerFields({
    type: 'transfer',
    stokKodu: ' KOD ',
    seriNumarasi: ' SN ',
    stokAdi: 'Ürün',
    location: { locationType: 'lab', locationId: 'lab-1', locationName: 'Lab 1' },
  }, 'c1');

  assert.equal(fields.companyId, 'c1');
  assert.equal(fields.stokKodu, 'KOD', 'boşluklar kırpılmalı');
  assert.equal(fields.seriNumarasi, 'SN');
  assert.equal(fields.status, 'laboratuvarda');
  assert.equal(fields.locationId, 'lab-1');
  assert.equal(fields.lastEventType, 'transfer');
});

test('düzeltme olayı defterdeki durumu ezmez', () => {
  const fields = projectLedgerFields({
    type: 'duzeltme',
    stokKodu: 'KOD',
    seriNumarasi: 'SN',
  }, 'c1');
  assert.equal('status' in fields, false, 'durum alanı yazılmamalı ki mevcut durum korunsun');
});

test('olay belgesi boş referansları ayıklar', () => {
  const event = projectEventFields({
    type: 'tuketim',
    stokKodu: 'KOD',
    seriNumarasi: 'SN',
    refs: { consumptionId: 'c-1', depoStokId: undefined, transferId: '   ', orderId: null },
  }, 'c1');

  assert.deepEqual(event.refs, { consumptionId: 'c-1' });
  assert.equal(event.toType, 'none');
  assert.equal(event.companyId, 'c1');
});

test('stok adı verilmezse ürün koduna düşer', () => {
  const fields = projectLedgerFields({ type: 'mal_kabul', stokKodu: 'KOD', seriNumarasi: 'SN' }, null);
  assert.equal(fields.stokAdi, 'KOD');
  assert.equal(fields.companyId, '__legacy__');
});
