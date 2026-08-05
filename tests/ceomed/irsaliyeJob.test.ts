import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

// Worker düz Node (JS) olarak çalışır; testler derlenmiş dizinden koştuğu için
// modül depo kökünden çözülür (labMatcher.test.ts ile aynı desen).
const { validateJob, toKeystrokePlan, formatTarih, describeJob } =
  require(path.resolve(process.cwd(), 'scripts/ceomed-sync/lib/irsaliyeJob.js'));

const gecerliIs = () => ({
  irsaliyeNo: 'BT-T0042',
  cariKodu: 'M51001',
  tarih: '2026-08-05',
  islemTipi: '35',
  depo: '10',
  aciklama: 'Ahmet Yılmaz',
  satirlar: [
    { stokKodu: 'YP-100', stokAdi: 'Pompa', miktar: 1, lot: 'SER-1', miad: '' },
    { stokKodu: 'YP-200', stokAdi: 'Filtre', miktar: 3, lot: 'LOT-7', miad: '01.01.2027' },
  ],
});

test('geçerli iş doğrulamayı geçer', () => {
  assert.deepEqual(validateJob(gecerliIs()), { ok: true });
});

test('boş iş dokümanı reddedilir', () => {
  const r = validateJob(null);
  assert.equal(r.ok, false);
});

test('zorunlu başlık alanları eksikse reddedilir', () => {
  for (const alan of ['irsaliyeNo', 'cariKodu', 'aciklama']) {
    const job = gecerliIs();
    (job as any)[alan] = '';
    const r = validateJob(job);
    assert.equal(r.ok, false, `${alan} boşken geçmemeliydi`);
  }
});

test('işlem tipi 35 değilse yazma engellenir', () => {
  const job = { ...gecerliIs(), islemTipi: '30' };
  const r = validateJob(job);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /islemTipi/);
});

test('depo 10 değilse yazma engellenir', () => {
  const job = { ...gecerliIs(), depo: '01' };
  const r = validateJob(job);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /depo/);
});

test('satırsız iş reddedilir', () => {
  const job = { ...gecerliIs(), satirlar: [] };
  const r = validateJob(job);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /satır/i);
});

test('stok kodu boş satır reddedilir', () => {
  const job = gecerliIs();
  job.satirlar[1].stokKodu = '';
  const r = validateJob(job);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /2\. satırda stokKodu/);
});

test('geçersiz miktar reddedilir', () => {
  for (const miktar of [0, -2, Number.NaN, 'iki']) {
    const job = gecerliIs();
    (job.satirlar[0] as any).miktar = miktar;
    const r = validateJob(job);
    assert.equal(r.ok, false, `miktar=${miktar} geçmemeliydi`);
  }
});

test('ISO olmayan tarih reddedilir', () => {
  const job = { ...gecerliIs(), tarih: '05/08/2026' };
  const r = validateJob(job);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /tarih/);
});

test('tarih Ceomed maskesine çevrilir', () => {
  assert.equal(formatTarih('2026-08-05'), '05/08/2026');
  assert.equal(formatTarih('2026-08-05', '.'), '05.08.2026');
  assert.equal(formatTarih('bozuk'), null);
});

test('tuş planı sabitleri işten değil koddan alır', () => {
  // İş dokümanı elle bozulsa bile plan sabitleri doğru üretir; ama validateJob
  // zaten böyle bir işi yazmaya bırakmaz. İki katman birlikte çalışır.
  const plan = toKeystrokePlan({ ...gecerliIs(), islemTipi: '99', depo: '99' });
  assert.equal(plan.header.islemTipi, '35');
  assert.equal(plan.header.depo, '10');
});

test('tuş planı satırları biçimlendirir', () => {
  const plan = toKeystrokePlan(gecerliIs());
  assert.equal(plan.header.tarih, '05/08/2026');
  assert.equal(plan.aciklama, 'Ahmet Yılmaz');
  assert.deepEqual(plan.rows, [
    { stokKodu: 'YP-100', stokAdi: 'Pompa', miktar: 1, lot: 'SER-1', miad: '' },
    { stokKodu: 'YP-200', stokAdi: 'Filtre', miktar: 3, lot: 'LOT-7', miad: '01.01.2027' },
  ]);
});

test('iş özeti log için okunur bir satır üretir', () => {
  assert.equal(describeJob(gecerliIs()), 'BT-T0042 → M51001 • 2 satır');
});
