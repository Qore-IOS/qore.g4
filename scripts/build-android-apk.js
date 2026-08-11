#!/usr/bin/env node
/**
 * Tek komutla APK üretir: arayüz paketi → Capacitor eşitleme → Gradle.
 *
 * NEDEN TEK BETİK — masaüstünde öğrenilen ders:
 *
 * `electron-builder` yalnızca paketliyordu; arayüz paketini üretmeyi atlayan
 * bir derleme SESSİZCE eski içeriği taşıyan bir kurulum üretiyordu ve sebebi
 * hiçbir yerde görünmüyordu. Android'de aynı tuzak daha da sinsi: Gradle,
 * `android/app/src/main/assets/public` klasöründe ne varsa onu paketler.
 * `npm run build:terminal:android` ve `cap sync` atlanırsa APK bir önceki
 * derlemenin arayüzüyle çıkar ve "değişikliklerim yok" denir.
 *
 * Bu betik üç adımı ayrılmaz hâle getirir.
 *
 * Kullanım:
 *   node scripts/build-android-apk.js            → hata ayıklama APK'sı
 *   node scripts/build-android-apk.js --release  → imzasız yayın APK'sı
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const ANDROID_DIR = path.join(REPO_ROOT, 'android');
const IS_WINDOWS = process.platform === 'win32';
const RELEASE = process.argv.includes('--release');

function fail(message) {
  console.error(`\n[qore-terminal] ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: IS_WINDOWS,
    ...options,
  });
  if (result.error || result.status !== 0) {
    fail(options.failMessage || `Komut başarısız: ${command} ${args.join(' ')}`);
  }
}

/**
 * Android SDK bulunuyor mu?
 *
 * ÖNCEDEN sorulur: yoksa Gradle 200 satırlık bir yığın izi basar ve gerçek
 * sebep ("SDK location not found") en altta kaybolur.
 */
function assertAndroidSdk() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const localProps = path.join(ANDROID_DIR, 'local.properties');

  if (fromEnv && fs.existsSync(fromEnv)) return;
  if (fs.existsSync(localProps) && /sdk\.dir\s*=/.test(fs.readFileSync(localProps, 'utf8'))) return;

  fail(
    'Android SDK bulunamadı.\n\n' +
      'İki yoldan biri yeterli:\n' +
      '  • Android Studio kurun (SDK ile birlikte gelir), sonra bu komutu tekrar çalıştırın\n' +
      '  • ya da ANDROID_HOME ortam değişkenini SDK klasörüne ayarlayın\n\n' +
      'Kurulum yapmak istemiyorsanız APK\'yı GitHub Actions üretebilir:\n' +
      '  Actions → "Android APK" → Run workflow (bkz. docs/android-terminal.md)',
  );
}

assertAndroidSdk();

// 1) Arayüz paketi. Yayın derlemesinde kaynak haritaları kapalı — APK'nın
//    boyutunun büyük kısmını onlar oluşturuyor.
run(process.execPath, [path.join(__dirname, 'build-terminal-android.js')], {
  env: { ...process.env, TERMINAL_SOURCEMAP: RELEASE ? '0' : '1' },
  failMessage: 'Arayüz paketi üretilemedi; APK derlenmedi.',
});

// 2) Paketi yerel projeye kopyala ve eklenti kayıtlarını tazele.
run(IS_WINDOWS ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android'], {
  failMessage: 'Capacitor eşitlemesi başarısız.',
});

// 3) Gradle.
const gradlew = IS_WINDOWS ? 'gradlew.bat' : './gradlew';
const task = RELEASE ? 'assembleRelease' : 'assembleDebug';

run(gradlew, [task], {
  cwd: ANDROID_DIR,
  failMessage: `Gradle derlemesi başarısız (${task}).`,
});

const outDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', RELEASE ? 'release' : 'debug');
const produced = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter(f => f.endsWith('.apk')) : [];

if (produced.length === 0) {
  fail(`Gradle başarılı göründü ama ${outDir} içinde APK yok.`);
}

console.log('\n[qore-terminal] APK hazır:');
produced.forEach(file => console.log(`  ${path.join(outDir, file)}`));

if (RELEASE) {
  console.log(
    '\nNOT: Yayın APK\'sı İMZASIZ üretildi. Telefona kurulabilmesi için\n' +
      'imzalanması gerekir — adımlar docs/android-terminal.md içinde.\n' +
      'Şirket içi dağıtım için hata ayıklama APK\'sı da yeterlidir.',
  );
}
