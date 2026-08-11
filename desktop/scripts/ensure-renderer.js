#!/usr/bin/env node
/**
 * Paketleme öncesi arayüz paketini üretir.
 *
 * NEDEN VAR — SESSİZ YANLIŞIN ÖNÜNE GEÇMEK İÇİN
 *
 * `electron-builder` yalnızca paketler; arayüzü üretmez. `pnpm build:terminal`
 * atlanırsa `renderer-dist/` hiç oluşmaz, kurulan uygulama gömülü paketi
 * bulamaz ve UZAK KİPE düşer: yayındaki (çoğu zaman daha eski) siteyi açar.
 *
 * Sahada tam olarak bu yaşandı — kullanıcı uygulamayı kaldırıp yeniden
 * derledi, yine "eski görünüm" gördü ve sebebi hiçbir yerde yazmıyordu.
 * Hata mesajı bile çıkmıyordu, çünkü teknik olarak her şey "çalışıyordu".
 *
 * Bu betik zinciri kapatır: `dist` çalıştırıldığında arayüz HER ZAMAN
 * yeniden üretilir. Üretilemezse paketleme durur — eksik paketli bir `.exe`
 * üretmektense hata vermek yeğdir.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DESKTOP_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.join(DESKTOP_DIR, '..');
const RENDERER_INDEX = path.join(DESKTOP_DIR, 'renderer-dist', 'index.html');

/** Windows'ta `pnpm`/`npm` .cmd uzantılıdır; shell ile çalıştırmak gerekir. */
const IS_WINDOWS = process.platform === 'win32';

function run(command, args) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: IS_WINDOWS,
  });
}

function fail(message) {
  console.error(`\n[qore-terminal] ${message}\n`);
  process.exit(1);
}

/**
 * Bir paket yöneticisi bu makinede kurulu mu?
 *
 * ÖNCEDEN sorulur, çünkü kurulu olmayan `pnpm`'i doğrudan çalıştırmak
 * PowerShell'de "The term 'pnpm' is not recognized…" diye korkutucu bir
 * hata bloğu basıyor. Betik zaten npm'e düşecek olsa bile kullanıcı bunu
 * derlemenin çöktüğü sanıyor.
 */
function isAvailable(command) {
  const probe = spawnSync(command, ['--version'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    shell: IS_WINDOWS,
  });
  return !probe.error && probe.status === 0;
}

/**
 * Uzak kip açıkça istenmişse arayüz paketi gereksizdir.
 *
 * `QORE_TERMINAL_URL` verildiğinde uygulama zaten yayındaki siteyi yükler;
 * burada 8 saniyelik bir derleme çalıştırmak boşuna olurdu ve `.env.local`
 * yoksa geliştiriciyi gereksiz yere bloke ederdi.
 */
if (process.env.QORE_TERMINAL_URL) {
  console.log('[qore-terminal] QORE_TERMINAL_URL tanımlı — uzak kip, arayüz paketi atlanıyor.');
  process.exit(0);
}

// Depo pnpm ile yönetiliyor ama zorunlu değil: `build:terminal` betiği
// kökteki package.json'da tanımlı ve npm ile de aynı işi yapar.
const manager = isAvailable('pnpm') ? 'pnpm' : 'npm';
const managerArgs = manager === 'pnpm' ? ['build:terminal'] : ['run', 'build:terminal'];

console.log(`[qore-terminal] Arayüz paketi üretiliyor (${manager} build:terminal)…`);

const result = run(manager, managerArgs);

if (result.error || result.status !== 0) {
  fail(
    'Arayüz paketi üretilemedi.\n\n' +
      'Repo kökünde şunu elle çalıştırıp hatayı görün:\n' +
      `  ${manager === 'pnpm' ? 'pnpm build:terminal' : 'npm run build:terminal'}\n\n` +
      'En sık iki sebep:\n' +
      // Paket yöneticisi ADI İLE söyleniyor: pnpm ile yönetilen bir çalışma
      // kopyasında "npm install" demek, iki yöneticinin node_modules'ünü
      // karıştırıp "modül çözümlenemedi" hatalarına yol açıyor. Sahada tam
      // olarak bu yaşandı: yeni bağımlılıklar pnpm-lock.yaml'a girmemişti ve
      // mesaj yanlış komutu öneriyordu.
      `  • Bağımlılıklar güncel değil → repo kökünde \`${manager} install\`\n` +
      '  • Firebase anahtarları okunamıyor → `node scripts/env-from-apphosting.js`\n' +
      '    (anahtarlar normalde apphosting.yaml içinden otomatik alınır)',
  );
}

if (!fs.existsSync(RENDERER_INDEX)) {
  fail(
    'Derleme başarılı göründü ama desktop/renderer-dist/index.html yok.\n' +
      'Paketlemeye devam edilmiyor: bu hâliyle üretilecek .exe gömülü arayüzü\n' +
      'bulamaz ve sessizce yayındaki eski siteyi açardı.',
  );
}

console.log('[qore-terminal] Arayüz paketi hazır: desktop/renderer-dist');
