#!/usr/bin/env node
/**
 * Android uygulama simgelerini üretir.
 *
 * NEDEN VAR: Capacitor'ın ürettiği proje kendi varsayılan simgesiyle gelir.
 * Telefonun ana ekranında jenerik bir Capacitor logosu duran uygulama
 * "yarım kalmış" görünür ve depoda iki kurumsal uygulama arasından doğru
 * olanı seçmeyi de zorlaştırır.
 *
 * NEDEN HAZIR BİR PNG DEĞİL: Depodaki `public/invlogo.png` geniş bir yazı
 * markası — kare bir simgeye sığdırıldığında okunmaz hâle geliyor. Buradaki
 * çizim, o logonun KARE olan tek parçasını (atom küresi ve yörüngeleri)
 * terminalin kendi koyu zemininde yeniden üretiyor.
 *
 * NEDEN DIŞ BAĞIMLILIK YOK: `sharp`/ImageMagick eklemek, yılda belki bir kez
 * çalışacak bir betik için kalıcı bir bağımlılık demekti. PNG kodlayıcı
 * (zlib + CRC32) burada 60 satır; çizim de basit geometri.
 *
 * Kullanım:
 *   node scripts/generate-android-icons.js
 *
 * Simgeyi değiştirmek isterseniz aşağıdaki PALETTE ve `drawMark()` yeter;
 * betiği yeniden çalıştırmak tüm yoğunlukları tazeler.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const RES_DIR = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

/** Terminalin koyu zemini + INVITROLAB logosundaki kırmızı küre ve gri yörüngeler. */
const PALETTE = {
  background: [0x09, 0x09, 0x0b],
  sphereCore: [0xd4, 0x2a, 0x1e],
  sphereHighlight: [0xff, 0x9a, 0x86],
  orbit: [0xb9, 0xbf, 0xc6],
};

/** Kenar yumuşatma: her piksel bu kat sayıda örneklenip ortalanır. */
const SUPERSAMPLE = 4;

// ---------------------------------------------------------------------------
// PNG yazıcı
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** RGBA tamponunu PNG'ye çevirir (8 bit, renk tipi 6, filtre yok). */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtre baytı
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Çizim
// ---------------------------------------------------------------------------

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Markayı tek bir örnek noktası için değerlendirir.
 *
 * @param nx,ny Merkeze göre normalize koordinat (-0.5 … 0.5)
 * @param extent Markanın en dış yarıçapı (aynı ölçekte)
 * @returns [r,g,b,a] ya da null (boş)
 */
function sampleMark(nx, ny, extent) {
  // Oranlar logodaki atomdan alındı: yörüngenin büyük ekseni küre çapının
  // yaklaşık iki katı, çizgiler ince. Kalın çizgi küreyi yutuyor ve simge
  // küçük boyutlarda lekeye dönüşüyordu.
  const ORBIT_A = 1.9; // yarı-büyük eksen / küre yarıçapı
  const ORBIT_B = 0.66; // yarı-küçük eksen / küre yarıçapı
  const ORBIT_STROKE = 0.055; // çizgi kalınlığı / küre yarıçapı

  const r = extent / ORBIT_A;

  // Yörüngeler — logodaki elipsler gibi ±30° eğik.
  for (const angle of [Math.PI / 6, -Math.PI / 6]) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = nx * cos + ny * sin;
    const ry = -nx * sin + ny * cos;

    const a = r * ORBIT_A;
    const b = r * ORBIT_B;
    const d = Math.sqrt((rx / a) ** 2 + (ry / b) ** 2);

    // Çizgi kalınlığı elipsin normalize uzayında sabit değil; en dar eksene
    // göre ölçeklenirse çizgi her yerde yaklaşık aynı görünür.
    const halfWidth = (r * ORBIT_STROKE) / b;
    if (Math.abs(d - 1) < halfWidth) return [...PALETTE.orbit, 255];
  }

  // Küre — sol üstte ışık alan radyal geçiş.
  const dist = Math.sqrt(nx * nx + ny * ny);
  if (dist <= r) {
    const hx = nx + r * 0.32;
    const hy = ny + r * 0.32;
    const t = Math.min(1, Math.sqrt(hx * hx + hy * hy) / (r * 1.5));
    return [...mix(PALETTE.sphereHighlight, PALETTE.sphereCore, t), 255];
  }

  return null;
}

/**
 * Simgeyi çizer.
 *
 * @param size Kenar uzunluğu (piksel)
 * @param options.background Zemin rengi ya da null (saydam)
 * @param options.round Dairesel maske uygulansın mı
 * @param options.extentRatio Markanın en dış yarıçapı / kenar uzunluğu
 */
function drawIcon(size, { background, round = false, extentRatio }) {
  const ss = SUPERSAMPLE;
  const out = Buffer.alloc(size * size * 4);
  const extent = extentRatio * size;
  const center = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;

          // Dairesel maskenin dışı tamamen boş.
          if (round && Math.hypot(px - center, py - center) > center) continue;

          let color = background ? [...background, 255] : null;
          const mark = sampleMark(px - center, py - center, extent);
          if (mark) color = mark;
          if (!color) continue;

          r += color[0];
          g += color[1];
          b += color[2];
          a += color[3];
        }
      }

      const samples = ss * ss;
      const i = (y * size + x) * 4;
      // Alfa ile ağırlıklandırma yok: renkler zaten opak, yalnızca kapsama
      // oranı yumuşatılıyor.
      const coverage = a / (samples * 255);
      out[i] = coverage > 0 ? Math.round(r / (a / 255)) : 0;
      out[i + 1] = coverage > 0 ? Math.round(g / (a / 255)) : 0;
      out[i + 2] = coverage > 0 ? Math.round(b / (a / 255)) : 0;
      out[i + 3] = Math.round(coverage * 255);
    }
  }

  return encodePng(size, size, out);
}

// ---------------------------------------------------------------------------
// Üretim
// ---------------------------------------------------------------------------

/** Android yoğunlukları: klasör → ölçek. */
const DENSITIES = [
  ['mipmap-mdpi', 1],
  ['mipmap-hdpi', 1.5],
  ['mipmap-xhdpi', 2],
  ['mipmap-xxhdpi', 3],
  ['mipmap-xxxhdpi', 4],
];

let written = 0;

for (const [dir, scale] of DENSITIES) {
  const target = path.join(RES_DIR, dir);
  fs.mkdirSync(target, { recursive: true });

  // Eski (API 25 ve öncesi) simgeler: zemin dâhil, tam kare.
  const legacySize = Math.round(48 * scale);
  fs.writeFileSync(
    path.join(target, 'ic_launcher.png'),
    drawIcon(legacySize, { background: PALETTE.background, extentRatio: 0.42 }),
  );
  fs.writeFileSync(
    path.join(target, 'ic_launcher_round.png'),
    drawIcon(legacySize, { background: PALETTE.background, round: true, extentRatio: 0.42 }),
  );

  /**
   * Uyarlanabilir simge ön planı (API 26+): 108dp tuval, zemin ayrı katman.
   *
   * Marka 108dp'nin ortasındaki güvenli alanda kalmalı — köşeler sistem
   * maskesiyle (daire, kare, sıkıştırılmış daire…) kırpılıyor. Android'in
   * garanti ettiği güvenli daire 66dp çapında; `0.30` oranı markayı 65dp
   * çapına oturtur, yani yörüngelerin uçları en agresif maskede bile kesilmez.
   */
  fs.writeFileSync(
    path.join(target, 'ic_launcher_foreground.png'),
    drawIcon(Math.round(108 * scale), { background: null, extentRatio: 0.3 }),
  );

  written += 3;
}

// Uyarlanabilir simgenin zemini: terminalin kendi koyu rengi.
const hex = PALETTE.background.map(v => v.toString(16).padStart(2, '0')).join('');
fs.writeFileSync(
  path.join(RES_DIR, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#${hex.toUpperCase()}</color>\n</resources>\n`,
);

console.log(`[qore-terminal] ${written} simge + zemin rengi yazıldı: android/app/src/main/res`);
