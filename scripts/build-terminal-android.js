#!/usr/bin/env node
/**
 * Android kabuğu için arayüz paketini üretir.
 *
 * Masaüstüyle AYNI Vite yapılandırmasını çalıştırır; tek fark iki ortam
 * değişkenidir:
 *
 *   TERMINAL_OUT_DIR=android-app/www  → Capacitor'ın `webDir`i
 *   TERMINAL_TARGET=android           → CSP'nin Android sürümü
 *
 * Neden ayrı bir betik: `TERMINAL_OUT_DIR=... vite build` yazımı Windows
 * PowerShell'de çalışmaz ve bu depo Windows'ta derleniyor. Değişkenleri
 * Node tarafında koymak platform farkını tamamen ortadan kaldırır.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'android-app', 'www');

const result = spawnSync(
  process.execPath,
  [path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.config.terminal.ts'],
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      TERMINAL_OUT_DIR: 'android-app/www',
      TERMINAL_TARGET: 'android',
      // Yayın derlemesi bunu '0' yapar; bkz. vite.config.terminal.ts.
      TERMINAL_SOURCEMAP: process.env.TERMINAL_SOURCEMAP ?? '1',
    },
  },
);

if (result.error || result.status !== 0) {
  console.error(
    '\n[qore-terminal] Android arayüz paketi üretilemedi.\n\n' +
      'En sık iki sebep:\n' +
      '  • Kökte bağımlılıklar kurulu değil → önce `npm install`\n' +
      '  • .env.local dosyasında Firebase anahtarları eksik\n' +
      '    (apphosting.yaml içindekilerle aynı NEXT_PUBLIC_FIREBASE_* değerleri)\n',
  );
  process.exit(1);
}

if (!fs.existsSync(path.join(OUT_DIR, 'index.html'))) {
  // Masaüstünde tam olarak bu sessiz yanlış yaşandı: derleme "başarılı"
  // görünüp paket üretilmeyince kabuk eski içeriği açmıştı. Burada da
  // APK'ya boş bir `www` gömmektense durmak yeğdir.
  console.error('\n[qore-terminal] Derleme başarılı göründü ama android-app/www/index.html yok.\n');
  process.exit(1);
}

console.log('[qore-terminal] Android arayüz paketi hazır: android-app/www');
