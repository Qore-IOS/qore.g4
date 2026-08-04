import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

// Ceomed watcher'ı düz Node (JS) olarak çalışır; testler derlenmiş dizinden
// koştuğu için modül depo kökünden çözülür.
const { matchLab } = require(path.resolve(process.cwd(), 'scripts/ceomed-sync/lib/labMatcher.js'));

const labs = [
  { id: 'lab-merkez', name: 'Merkez Lab', ceomedCariKodu: 'M51001', sevkAdresi: 'A Blok Zemin' },
  { id: 'lab-ek', name: 'Ek Hizmet Lab', ceomedCariKodu: 'M51001', sevkAdresi: 'B Blok 2. Kat' },
  { id: 'lab-tek', name: 'Tekil Lab', ceomedCariKodu: 'M52002', sevkAdresi: '' },
  { id: 'lab-kodsuz', name: 'Kodsuz Lab' },
];

test('tek eşleşen cari kodu doğrudan laboratuvarı bulur', () => {
  const r = matchLab({ cariKodu: 'M52002' }, labs);
  assert.equal(r.matched, true);
  assert.equal(r.lab.id, 'lab-tek');
});

test('cari kodu karşılaştırması boşluk ve kasa duyarsızdır', () => {
  const r = matchLab({ cariKodu: '  m52002 ' }, labs);
  assert.equal(r.matched, true);
  assert.equal(r.lab.id, 'lab-tek');
});

test('aynı cari koduna bağlı iki lab sevk adresiyle ayrışır', () => {
  const r = matchLab({ cariKodu: 'M51001', sevkAdresi: 'B Blok 2. Kat' }, labs);
  assert.equal(r.matched, true);
  assert.equal(r.lab.id, 'lab-ek');
});

test('sevk adresi eşleşmesi de boşluk/kasa duyarsızdır', () => {
  const r = matchLab({ cariKodu: 'M51001', sevkAdresi: 'a blok   zemin' }, labs);
  assert.equal(r.matched, true);
  assert.equal(r.lab.id, 'lab-merkez');
});

test('cari kodu hiçbir laboratuvarla eşleşmezse aktarım yapılmaz', () => {
  const r = matchLab({ cariKodu: 'YOK-999' }, labs);
  assert.equal(r.matched, false);
  assert.equal(r.reason, 'cari_kodu_eslesmedi');
  assert.match(r.detail, /YOK-999/);
});

test('irsaliyede cari kodu yoksa aktarım yapılmaz', () => {
  const r = matchLab({ cariKodu: '' }, labs);
  assert.equal(r.matched, false);
  assert.equal(r.reason, 'irsaliyede_cari_kodu_yok');
});

test('çok adaylı cari koduda sevk adresi yoksa TAHMİN EDİLMEZ', () => {
  // Yanlış laboratuvara sessizce stok yazmak, elle aktarımdan çok daha pahalı
  // bir hatadır: düzeltmek için lab stoğundan tek tek silmek gerekir.
  const r = matchLab({ cariKodu: 'M51001' }, labs);
  assert.equal(r.matched, false);
  assert.equal(r.reason, 'sevk_adresi_yok');
  assert.deepEqual(r.candidates.sort(), ['lab-ek', 'lab-merkez']);
});

test('sevk adresi hiçbir adayla eşleşmezse aktarım yapılmaz', () => {
  const r = matchLab({ cariKodu: 'M51001', sevkAdresi: 'C Blok' }, labs);
  assert.equal(r.matched, false);
  assert.equal(r.reason, 'sevk_adresi_eslesmedi');
  assert.equal(r.candidates.length, 2);
});

test('aynı cari + aynı adres birden çok laba tanımlıysa aktarım yapılmaz', () => {
  const ikizler = [
    { id: 'a', name: 'A', ceomedCariKodu: 'X1', sevkAdresi: 'Aynı Adres' },
    { id: 'b', name: 'B', ceomedCariKodu: 'X1', sevkAdresi: 'Aynı Adres' },
  ];
  const r = matchLab({ cariKodu: 'X1', sevkAdresi: 'Aynı Adres' }, ikizler);
  assert.equal(r.matched, false);
  assert.equal(r.reason, 'birden_cok_aday');
});

test('cari kodu tanımsız laboratuvarlar hiçbir zaman eşleşmez', () => {
  const r = matchLab({ cariKodu: '' }, [{ id: 'lab-kodsuz', name: 'Kodsuz Lab' }]);
  assert.equal(r.matched, false);
});

test('boş laboratuvar listesi güvenle ele alınır', () => {
  const r = matchLab({ cariKodu: 'M51001' }, []);
  assert.equal(r.matched, false);
  assert.equal(r.reason, 'cari_kodu_eslesmedi');
});
