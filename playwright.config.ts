import { defineConfig, devices } from '@playwright/test';

/**
 * Uçtan uca test yapılandırması.
 *
 * NASIL KOŞAR
 *
 *   npm run test:e2e
 *     └─ firebase emulators:exec --config firebase.e2e.json
 *          ├─ Firestore + Auth emülatörlerini ayağa kaldırır
 *          ├─ FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST'u ortama yazar
 *          ├─ tests/e2e/seed.js ile temel veriyi tohumlar
 *          └─ playwright test
 *               └─ webServer: next dev (emülatör bayrağıyla)
 *
 * Emülatör kabuğu dışarıda olduğu için hem tohumlama hem uygulama AYNI
 * emülatöre bakar; test bittiğinde emülatör kapanır ve veri kaybolur.
 * Gerçek Firebase projesine hiçbir koşulda dokunulmaz — `seed.js`
 * `FIRESTORE_EMULATOR_HOST` yoksa çalışmayı reddeder.
 */

const PORT = Number(process.env.E2E_PORT || 9002);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e/specs',
  // Paylaşılan tek bir emülatör var; paralel çalışan testler birbirinin
  // stoğunu tüketir ve kararsızlık üretir. Seri koşulur.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    // Panellerin ilk açılışı ağır (bkz. docs/performans-optimizasyon-plani.md);
    // eylem zaman aşımları buna göre geniş tutulur.
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        /**
         * Hazır tarayıcı taşıyan ortamlar için kaçış kapısı.
         *
         * Playwright normalde kendi indirdiği, sürümüne birebir uyan tarayıcı
         * revizyonunu kullanır — CI'da olması gereken budur ve bu değişken
         * orada TANIMSIZDIR. Ama bazı geliştirme/ajan konteynerlerinde tarayıcı
         * imaja önceden gömülür ve revizyonu paket sürümüyle uyuşmaz; orada
         * `playwright install` çalıştırmak yerine hazır ikili gösterilir.
         *
         *   PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
         */
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],

  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // İstemci SDK'sını emülatöre yönlendiren TEK bayrak.
      NEXT_PUBLIC_FIREBASE_EMULATOR: '1',
      NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: '127.0.0.1',
      NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT: '8080',
      NEXT_PUBLIC_AUTH_EMULATOR_PORT: '9099',
      // Auth emülatörü anahtarı doğrulamaz ama SDK boş anahtarla başlamaz.
      NEXT_PUBLIC_FIREBASE_API_KEY: 'e2e-emulator-key',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'qore-e2e.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.E2E_PROJECT_ID || 'qore-e2e',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'qore-e2e.appspot.com',
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '0',
      NEXT_PUBLIC_FIREBASE_APP_ID: '1:0:web:e2e',
      // Sunucu tarafı (Server Action / API route) Admin SDK'sı için.
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
    },
  },
});
