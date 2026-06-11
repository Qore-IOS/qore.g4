/**
 * public/icons altındaki dock/mobil/envanter ikonlarının küçük türevlerini
 * üretir (Faz 6 — görsel hijyeni).
 *
 * Neden: ikonlar UI'da 34–40px'te gösterilirken kaynak dosyalar 1.5–1.9MB /
 * 1024px ham PNG'ler. Dock'un tek açılışı 15MB+ transfer üretebiliyordu.
 * Bu script her PNG için 96px (34px@2x + pay) türev üretir ve üretilen dosya
 * adlarını src/lib/generated/icon-thumbs.json manifestine yazar; getIconSrc
 * manifestte bulunan ikonları otomatik küçük türevden servis eder. Manifest
 * dışında kalanlar (ör. runtime'da eklenen ikonlar) bugünkü gibi ham yoldan
 * yüklenmeye devam eder — davranış kırılmaz.
 *
 * Ayrıca zaman-bazlı duvar kağıtlarının (dayclear / night clear) 1600px
 * türevlerini üretir.
 *
 * Çalıştırma: node scripts/optimize-public-icons.mjs
 * Yeni ikon eklendiğinde yeniden çalıştırılması yeterlidir.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadPngjs() {
  try {
    return require('pngjs');
  } catch {
    const store = join(root, 'node_modules', '.pnpm');
    const hit = readdirSync(store).find((d) => d.startsWith('pngjs@'));
    if (!hit) throw new Error('pngjs bulunamadı — pnpm install çalıştırın');
    return require(join(store, hit, 'node_modules', 'pngjs'));
  }
}

const { PNG } = loadPngjs();

/** Alfa-ağırlıklı alan ortalaması ile en-boy korumalı downsample. */
function resizeToFit(src, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (scale >= 1) return null; // zaten yeterince küçük
  const targetW = Math.max(1, Math.round(src.width * scale));
  const targetH = Math.max(1, Math.round(src.height * scale));
  const dst = new PNG({ width: targetW, height: targetH });
  const sx = src.width / targetW;
  const sy = src.height / targetH;
  for (let y = 0; y < targetH; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(src.height, Math.ceil((y + 1) * sy));
    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(src.width, Math.ceil((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          const alpha = src.data[i + 3];
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (y * targetW + x) * 4;
      dst.data[o] = a ? Math.round(r / a) : 0;
      dst.data[o + 1] = a ? Math.round(g / a) : 0;
      dst.data[o + 2] = a ? Math.round(b / a) : 0;
      dst.data[o + 3] = Math.round(a / n);
    }
  }
  return dst;
}

// --- 1) Dock/mobil/envanter ikonları → 96px ---
const ICONS_DIR = join(root, 'public', 'icons');
const THUMBS_DIR = join(ICONS_DIR, '_96');
mkdirSync(THUMBS_DIR, { recursive: true });

const manifest = [];
let savedBytes = 0;
for (const name of readdirSync(ICONS_DIR).sort()) {
  if (!name.toLowerCase().endsWith('.png')) continue;
  const srcPath = join(ICONS_DIR, name);
  if (!statSync(srcPath).isFile()) continue;
  try {
    const png = PNG.sync.read(readFileSync(srcPath));
    const small = resizeToFit(png, 96);
    const buf = small
      ? PNG.sync.write(small, { deflateLevel: 9 })
      : readFileSync(srcPath);
    writeFileSync(join(THUMBS_DIR, name), buf);
    manifest.push(name);
    savedBytes += statSync(srcPath).size - buf.length;
  } catch (err) {
    console.warn(`atlandı: ${name} (${err.message})`);
  }
}

const MANIFEST_PATH = join(root, 'src', 'lib', 'generated', 'icon-thumbs.json');
mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`ikon: ${manifest.length} türev üretildi, kazanç ~${(savedBytes / 1048576).toFixed(1)} MB`);

// --- 2) Zaman-bazlı duvar kağıtları → 1600px ---
for (const name of ['dayclear.png', 'night clear.png']) {
  try {
    const srcPath = join(root, 'public', name);
    const png = PNG.sync.read(readFileSync(srcPath));
    const small = resizeToFit(png, 1600);
    if (!small) { console.log(`${name}: zaten ≤1600px, atlandı`); continue; }
    const outName = name.replace(/\.png$/i, '-1600.png');
    const buf = PNG.sync.write(small, { deflateLevel: 9 });
    writeFileSync(join(root, 'public', outName), buf);
    console.log(`${outName}: ${small.width}x${small.height}, ${(buf.length / 1048576).toFixed(2)} MB (kaynak ${(statSync(srcPath).size / 1048576).toFixed(2)} MB)`);
  } catch (err) {
    console.warn(`duvar kağıdı atlandı: ${name} (${err.message})`);
  }
}
