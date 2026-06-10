/**
 * Marka görsellerinden küçük, sayfa yüküne uygun türevler üretir.
 *
 * Neden: public/ altındaki logo kaynakları 1024×1024 / 0.7–1.5MB ve
 * <link rel="icon">, apple-touch-icon, manifest ve 32–80px'lik UI
 * logoları bu ham dosyaları indiriyordu (HAR ölçümünde sayfa başına
 * ~3MB gereksiz görsel transferi). Bu script alan-ortalamalı (box)
 * downsample ile küçük PNG'ler üretir; orijinaller değiştirilmez.
 *
 * Çalıştırma: node scripts/optimize-brand-assets.mjs
 * (pngjs, qrcode'un transitive bağımlılığı olarak zaten kuruludur.)
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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

/** Alfa-ağırlıklı alan ortalaması ile downsample (koyu kenar saçağı önler). */
function resize(src, targetW, targetH) {
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

const jobs = [
  // [kaynak, hedef, boyut]
  ['A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG', 'icon-192.png', 192],
  ['A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG', 'icon-512.png', 512],
  ['A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG', 'apple-touch-icon.png', 180],
  ['newlogowh.png', 'newlogowh-160.png', 160],
  ['newlogoblk.png', 'newlogoblk-160.png', 160],
];

for (const [srcName, dstName, size] of jobs) {
  const srcPath = join(root, 'public', srcName);
  const dstPath = join(root, 'public', dstName);
  const png = PNG.sync.read(readFileSync(srcPath));
  const out = resize(png, size, size);
  const buf = PNG.sync.write(out, { deflateLevel: 9 });
  writeFileSync(dstPath, buf);
  console.log(`${dstName}: ${size}×${size}, ${(buf.length / 1024).toFixed(1)} KB (kaynak ${(readFileSync(srcPath).length / 1024 / 1024).toFixed(2)} MB)`);
}
