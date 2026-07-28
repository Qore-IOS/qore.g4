import assert from 'node:assert/strict';
import test from 'node:test';
import { miadaKalanGun, parseMiad } from '../../src/lib/lojistik/miad';

const gun = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;

test('Türkçe gün.ay.yıl biçimini çözer', () => {
  assert.equal(gun(parseMiad('31.12.2027')), '2027-12-31');
  assert.equal(gun(parseMiad('1.3.2027')), '2027-03-01');
});

test('eğik çizgi ve tire ayraçlı gün-önce biçimleri çözülür', () => {
  assert.equal(gun(parseMiad('31/12/2027')), '2027-12-31');
  assert.equal(gun(parseMiad('05-06-2027')), '2027-06-05');
});

test('ISO (yıl-önce) biçimi çözülür', () => {
  assert.equal(gun(parseMiad('2027-12-31')), '2027-12-31');
  assert.equal(gun(parseMiad('2027.12.31')), '2027-12-31');
});

test('saat eki tarihi bozmaz', () => {
  assert.equal(gun(parseMiad('2027-12-31T00:00:00.000Z')), '2027-12-31');
  assert.equal(gun(parseMiad('31.12.2027 00:00:00')), '2027-12-31');
});

test('yalnızca ay/yıl verilirse ayın son günü alınır', () => {
  assert.equal(gun(parseMiad('12.2027')), '2027-12-31');
  assert.equal(gun(parseMiad('02.2028')), '2028-02-29', 'artık yıl');
  assert.equal(gun(parseMiad('2027-11')), '2027-11-30');
});

test('iki haneli yıl 2000li yıllara taşınır', () => {
  assert.equal(gun(parseMiad('31.12.27')), '2027-12-31');
});

test('Date ve Timestamp benzeri değerler doğrudan kabul edilir', () => {
  const d = new Date(2027, 11, 31);
  assert.equal(gun(parseMiad(d)), '2027-12-31');
  assert.equal(gun(parseMiad({ toDate: () => d })), '2027-12-31');
});

test('çözülemeyen değerler null döner', () => {
  assert.equal(parseMiad(''), null);
  assert.equal(parseMiad(null), null);
  assert.equal(parseMiad(undefined), null);
  assert.equal(parseMiad('LOT123'), null);
  assert.equal(parseMiad('31.13.2027'), null, 'geçersiz ay');
  assert.equal(parseMiad('32.12.2027'), null, 'geçersiz gün');
  assert.equal(parseMiad('30.02.2027'), null, 'şubat 30 yok');
});

test('miada kalan gün takvim günü olarak hesaplanır', () => {
  const bugun = new Date(2026, 6, 28, 23, 30);
  assert.equal(miadaKalanGun('31.07.2026', bugun), 3);
  assert.equal(miadaKalanGun('28.07.2026', bugun), 0, 'bugün dolan miad 0 gün');
  assert.equal(miadaKalanGun('23.07.2026', bugun), -5, 'geçmiş miad negatif');
});

test('çözülemeyen miad için kalan gün null döner', () => {
  assert.equal(miadaKalanGun('bilinmiyor'), null);
});
