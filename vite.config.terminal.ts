/**
 * @fileoverview Masaüstü terminal paketinin Vite yapılandırması.
 *
 * Bu paket, web uygulamasının `src/` ağacını OLDUĞU GİBİ kullanır; ekranlar,
 * hook'lar ve yazma modülleri kopyalanmaz. Next'e özgü üç bağımlılık burada
 * kesilir:
 *
 *   1. `next/navigation`      → hash tabanlı router shim'i
 *   2. `@/actions/stokActions`→ Web SDK karşılıkları (firebase-admin gelmesin)
 *   3. `process.env.NEXT_PUBLIC_*` → derleme zamanında sabit değerler
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// CommonJS yardımcı: `.env.local` yokken anahtarların yedek kaynağı.


const ROOT = path.resolve(__dirname);
const TERMINAL_ROOT = path.join(ROOT, 'terminal-app');

/**
 * Tutanak PDF'inin ihtiyaç duyduğu varlıklar.
 *
 * `loadClayKit()` bunları çalışma anında `/fonts/...`, `/invlogo.png` gibi
 * MUTLAK yollardan çeker. Paket çevrimdışı çalıştığı için dosyaların
 * uygulamayla birlikte gelmesi gerekir; aksi hâlde jsPDF Helvetica'ya düşer
 * ve Türkçe karakterler bozulur.
 *
 * `public/` klasörünün TAMAMI kopyalanmaz — orası 175 MB ve içinde terminalin
 * kullanmadığı görseller/videolar var.
 */
const PDF_ASSETS = [
  'fonts/Nunito-SemiBold.ttf',
  'fonts/Nunito-ExtraBold.ttf',
  'fonts/Nunito-Black.ttf',
  'invlogo.png',
  'blk.png',
];

/** Yalnızca gerekli public varlıklarını çıktı klasörüne kopyalar. */
function copyPdfAssets(outDir: string): Plugin {
  return {
    name: 'qore-terminal-pdf-assets',
    apply: 'build',
    closeBundle() {
      PDF_ASSETS.forEach(rel => {
        const from = path.join(ROOT, 'public', rel);
        const to = path.join(outDir, rel);
        if (!fs.existsSync(from)) {
          this.warn(`[terminal] PDF varlığı bulunamadı: public/${rel}`);
          return;
        }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      });
    },
  };
}

/**
 * `index.html` içindeki `<!-- qore:csp -->` işaretini hedefe uygun politikayla
 * değiştirir.
 *
 * Terminal hiçbir uzak betik yüklemez; ağa çıktığı tek yer Firebase'dir. Bu
 * yüzden politika `default-src 'self'` üzerine kurulu ve `connect-src` bir
 * beyaz listedir.
 *
 * ANDROID'DEKİ TEK FARK — `script-src` içindeki `'unsafe-inline'`:
 * Capacitor, yerel köprüsünü (`native-bridge.js`, plugin kayıtları) sunucu
 * tarafında SATIR İÇİ bir `<script>` olarak `<head>`in hemen ardına enjekte
 * eder (bkz. JSInjector.java). Bu betik bizim meta etiketimizden ÖNCE geldiği
 * için ayrıştırıcıya göre politikaya takılmayabilir — ama bu, WebView
 * sürümüne bağlı bir ayrıntıdır ve tutmadığında uygulama köprüsüz açılır:
 * geri tuşu, tutanak kaydı, durum çubuğu çalışmaz. Uygulamanın açılmasını
 * ayrıştırıcı sırasına bağlamak yerine kuralı açıkça gevşetiyoruz; paketin
 * içinde bizim yazmadığımız betik zaten yok.
 */
function injectCsp(target: 'desktop' | 'android'): Plugin {
  const scriptSrc = target === 'android' ? "'self' 'unsafe-inline'" : "'self'";
  const policy = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    // Kamera önizlemesi: `<video>` MediaStream ile beslenir.
    "media-src 'self' blob:",
    "connect-src 'self' https:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');

  return {
    name: 'qore-terminal-csp',
    transformIndexHtml(html) {
      if (!html.includes('<!-- qore:csp -->')) {
        throw new Error('[terminal] index.html içinde `<!-- qore:csp -->` işareti yok.');
      }
      return html.replace(
        '<!-- qore:csp -->',
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

/**
 * Web uygulamasının okuduğu `NEXT_PUBLIC_*` değişkenleri.
 *
 * `src/lib/firebase.ts` bunları `process.env` üzerinden okur. Vite'ta
 * `process.env` yoktur, bu yüzden değerler derleme sırasında sabit olarak
 * gömülür. Bunlar Firebase'in istemci anahtarlarıdır — zaten tarayıcıya
 * gönderilirler ve gizli değildirler; erişimi Firestore kuralları belirler.
 */
const PUBLIC_ENV_KEYS = [
 'NEXT_PUBLIC_API_BASE_URL',
] as const;

/**
 * Paketin yazılacağı klasör.
 *
 * AYNI paket iki kabuk tarafından kullanılır:
 *
 *   - Electron  → `desktop/renderer-dist` (varsayılan)
 *   - Capacitor → `android-app/www`       (`TERMINAL_OUT_DIR` ile)
 *
 * Android için ayrı bir arayüz paketi ÜRETİLMEZ; ekranlar, yazma mantığı ve
 * çevrimdışı davranış birebir aynıdır. Değişen tek şey kabuğun paketi nereden
 * okuduğudur.
 */
const OUT_DIR = process.env.TERMINAL_OUT_DIR
  ? path.resolve(ROOT, process.env.TERMINAL_OUT_DIR)
  : path.join(ROOT, 'desktop/renderer-dist');

/**
 * Hedef kabuk. Yalnızca kabuğa özgü İKİ ayrıntıyı belirler: CSP ve gövde
 * arka planı. Ekran kodu bu değeri görmez.
 */
const TARGET = process.env.TERMINAL_TARGET === 'android' ? 'android' : 'desktop';

/**
 * Kısa git revizyonu — paket damgası için.
 *
 * Git yoksa (ör. kaynak arşivinden derleme) damga yalnızca zaman bilgisiyle
 * gösterilir; derlemeyi bunun için durdurmak anlamsız olurdu.
 */
function gitRevision(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

export default defineConfig(({ mode }) => {
  /**
   * Değer sırası: `.env.local` / gerçek ortam değişkenleri ÖNCE, sonra
   * `apphosting.yaml`.
   *
   * NEDEN YEDEK VAR: Taze bir klonda `.env.local` yoktur ve derleme
   * "Zorunlu ortam değişkenleri eksik" diyerek duruyordu. Oysa aranan
   * değerler zaten depoda, `apphosting.yaml` içinde açık hâlde duruyor —
   * bunlar Firebase'in İSTEMCİ anahtarları; erişimi `firestore.rules`
   * belirler, anahtarın gizliliği değil. Web uygulaması yayında tam olarak
   * o değerlerle çalışıyor.
   *
   * Kendi ortamını (ör. ayrı bir Firebase projesi) tanımlayan biri hâlâ
   * kazanır: dolu bir `.env.local` değeri yedeği ezer.
   *
   * Birleştirme anahtar anahtar ve BOŞ DEĞERLERİ ATLAYARAK yapılır. Sahada
   * görülen hâl tam olarak buydu: `.env.local` vardı ama Firebase
   * anahtarlarını içermiyordu. Toptan bir `{...yedek, ...loadEnv()}` da
   * yeterdi ama `KEY=` gibi boş bir satır yedeği boş dizeyle ezip aynı
   * hatayı geri getirirdi.
   */
  const fileEnv = loadEnv(mode, ROOT, '');
  const env: Record<string, string> = { ...fileEnv };
  if (!env.NEXT_PUBLIC_API_BASE_URL) throw new Error('NEXT_PUBLIC_API_BASE_URL is required for a packaged terminal.');

  const define: Record<string, string> = {
    // Paket damgası: kurulu uygulamanın hangi derleme olduğu ekranda görünsün.
    __TERMINAL_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __TERMINAL_BUILD_REV__: JSON.stringify(gitRevision()),
    __TERMINAL_TARGET__: JSON.stringify(TARGET),
    // `src/lib/firebase.ts` ve birkaç modül `process.env.NODE_ENV` de okur.
    'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production'),
  };
  PUBLIC_ENV_KEYS.forEach(key => {
    define[`process.env.${key}`] = JSON.stringify(env[key] ?? '');
  });

  return {
    root: TERMINAL_ROOT,
    // Varlıklar `app://` özel protokolünden göreli yollarla yüklenir; kök
    // ('/') tabanı orada 404 verir.
    base: './',
    plugins: [react(), injectCsp(TARGET), copyPdfAssets(OUT_DIR)],
    define,
    resolve: {
      alias: [
        {
          find: 'next/navigation',
          replacement: path.join(TERMINAL_ROOT, 'shims/next-navigation.tsx'),
        },
        {
          find: '@/actions/stokActions',
          replacement: path.join(TERMINAL_ROOT, 'shims/stok-actions.ts'),
        },
        // Genel `@` alias'ı EN SONA: yukarıdaki daha özel kurallar önce
        // eşleşmezse `@/actions/stokActions` de buraya düşer ve
        // firebase-admin paketlenmeye çalışılır.
        { find: /^@\//, replacement: `${path.join(ROOT, 'src')}/` },
      ],
    },
    build: {
      // Electron kabuğu bu klasörü paketler.
      outDir: OUT_DIR,
      emptyOutDir: true,
      /**
       * Kaynak haritaları çevrimdışı hata ayıklamayı gerçekten kolaylaştırır
       * ve paket zaten kullanıcıya değil, kurum içi makinelere gider.
       *
       * Android'de bir istisna var: haritalar APK'nın İÇİNE giriyor ve 8,5
       * MB'lık bir hata ayıklama APK'sının 7 MB'ını tek başlarına kaplıyorlar
       * (ölçüldü). Telefona indirilecek yayın paketinde bunun bedeli var,
       * hata ayıklama paketinde yok — bu yüzden yalnızca yayın derlemesinde
       * `TERMINAL_SOURCEMAP=0` ile kapatılıyor.
       */
      sourcemap: TARGET === 'android' ? process.env.TERMINAL_SOURCEMAP !== '0' : true,
    },
    server: { port: 9010 },
  };
});
