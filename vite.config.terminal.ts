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

import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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
 * Web uygulamasının okuduğu `NEXT_PUBLIC_*` değişkenleri.
 *
 * `src/lib/firebase.ts` bunları `process.env` üzerinden okur. Vite'ta
 * `process.env` yoktur, bu yüzden değerler derleme sırasında sabit olarak
 * gömülür. Bunlar Firebase'in istemci anahtarlarıdır — zaten tarayıcıya
 * gönderilirler ve gizli değildirler; erişimi Firestore kuralları belirler.
 */
const PUBLIC_ENV_KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID',
  'NEXT_PUBLIC_FIREBASE_VAPID_KEY',
  'NEXT_PUBLIC_FB_FUNCTION_REGION',
] as const;

/** Electron kabuğunun paketlediği çıktı klasörü. */
const OUT_DIR = path.join(ROOT, 'desktop/renderer-dist');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ROOT, '');

  const missing = PUBLIC_ENV_KEYS.filter(
    key => key.includes('FIREBASE_API_KEY') || key.includes('FIREBASE_PROJECT_ID'),
  ).filter(key => !env[key]);

  if (missing.length > 0) {
    // Sessizce eksik yapılandırmayla paketlemek, sahada "Firebase: Error
    // (auth/invalid-api-key)" olarak ortaya çıkar ve nedeni anlaşılmaz.
    throw new Error(
      `[terminal] Zorunlu ortam değişkenleri eksik: ${missing.join(', ')}.\n` +
        'Bunları .env.local dosyasına (apphosting.yaml ile aynı değerler) ekleyin.',
    );
  }

  const define: Record<string, string> = {
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
    plugins: [react(), copyPdfAssets(OUT_DIR)],
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
      // Kaynak haritaları çevrimdışı hata ayıklamayı gerçekten kolaylaştırır
      // ve paket zaten kullanıcıya değil, kurum içi makinelere gider.
      sourcemap: true,
    },
    server: { port: 9010 },
  };
});
