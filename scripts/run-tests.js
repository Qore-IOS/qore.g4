#!/usr/bin/env node
/**
 * Test koşucusu.
 *
 * Önceden `npm test` şuydu:
 *   rimraf .test-dist && tsc -p tsconfig.tests.json && node --test ...
 *
 * `&&` zinciri yüzünden tsc'nin bulduğu HERHANGİ bir tip hatası tüm testleri
 * çalıştırılamaz hale getiriyordu — tek bir tip uyuşmazlığı yüzünden 600
 * testin hiçbiri koşmuyordu. Tip hataları zaten `npm run typecheck`
 * mandalının işi; testin işi testleri koşturmak.
 *
 * Bu yüzden burada tip hataları rapor edilir ama testleri engellemez.
 * Derlemenin gerçekten kırıldığı durum (hiç çıktı üretilmemesi) yine hatadır —
 * aksi halde "0 test geçti" yeşil görünürdü.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
/** `--only <ad>` verilirse yalnızca o dosya koşulur (ör. kural testleri). */
const yalnizcaIndex = argv.indexOf('--only');
const yalnizca = yalnizcaIndex >= 0 ? argv[yalnizcaIndex + 1] : null;

const KOK = path.join(__dirname, '..');
const CIKTI = path.join(KOK, '.test-dist');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function calistir(komut, argv, opts = {}) {
  return spawnSync(komut, argv, { cwd: KOK, stdio: 'inherit', ...opts });
}

/** Derlenmiş test dosyalarını toplar (node --test glob'a güvenmesin). */
function testDosyalari(dizin) {
  if (!fs.existsSync(dizin)) return [];
  return fs.readdirSync(dizin, { withFileTypes: true }).flatMap(girdi => {
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) return testDosyalari(tam);
    return girdi.name.endsWith('.test.js') ? [tam] : [];
  });
}

fs.rmSync(CIKTI, { recursive: true, force: true });

const derleme = spawnSync(npx, ['tsc', '-p', 'tsconfig.tests.json', '--pretty', 'false'], {
  cwd: KOK,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const derlemeCiktisi = `${derleme.stdout || ''}${derleme.stderr || ''}`;

// Yapılandırma hataları hiçbir dosya derlenmeden çıkar — bunu tip hatası
// sanıp geçmek, testlerin sessizce hiç koşmaması demektir.
const yapilandirmaHatasi = derlemeCiktisi.match(/error TS(5\d{3}|6\d{3}):.*/g);
if (yapilandirmaHatasi) {
  console.error('tsconfig.tests.json geçersiz:');
  yapilandirmaHatasi.forEach(h => console.error(`  ${h}`));
  process.exit(2);
}

const tipHatalari = derlemeCiktisi.split('\n').filter(s => /error TS\d+:/.test(s));
if (tipHatalari.length > 0) {
  console.warn(`\n${tipHatalari.length} tip hatası (testler yine de koşulacak):`);
  tipHatalari.slice(0, 20).forEach(h => console.warn(`  ${h}`));
  if (tipHatalari.length > 20) console.warn(`  … ve ${tipHatalari.length - 20} tane daha`);
  console.warn('Tip hataları için: npm run typecheck\n');
}

/**
 * Firestore kural testleri emülatör ister; emülatörsüz her zaman kırmızıdır.
 * Kendi komutları var (`npm run test:rules:emulated`), varsayılan koşudan
 * çıkarılır — aksi halde "20 test başarısız" kalıcı gürültüye dönüşür ve
 * gerçek bir kırılma fark edilmez.
 */
const EMULATOR_GEREKTIRENLER = ['firestore-rules.test.js'];

const tumu = testDosyalari(path.join(CIKTI, 'tests'));
const dosyalar = yalnizca
  ? tumu.filter(d => path.basename(d) === yalnizca)
  : tumu.filter(d => !EMULATOR_GEREKTIRENLER.includes(path.basename(d)));

if (dosyalar.length === 0) {
  console.error(
    yalnizca
      ? `"${yalnizca}" derlenmiş testler arasında bulunamadı.`
      : 'Derleme test çıktısı üretmedi — testler koşulamıyor.',
  );
  process.exit(2);
}

const sonuc = calistir(process.execPath, ['--test', ...dosyalar]);
process.exit(sonuc.status ?? 1);
