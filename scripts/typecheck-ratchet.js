#!/usr/bin/env node
/**
 * Tip kontrolü mandalı (ratchet).
 *
 * Bu deponun `tsc --noEmit` çıktısında bugün 700'ün üzerinde hata var; hepsini
 * tek seferde düzeltmek gerçekçi değil. Ama kontrolü tamamen kapalı tutmak da
 * bedelsiz değil: `tsconfig.json` içindeki geçersiz `ignoreDeprecations: "6.0"`
 * derlemeyi TS5103 ile hiçbir dosya kontrol edilmeden durduruyordu, yani
 * `npm run typecheck` aylarca tek bir hata bile bulamadı ve tanımsız değişken
 * kullanan gerçek bir çalışma-anı hatası bu yüzden yayına çıktı.
 *
 * Mandal ikisinin arasını bulur: mevcut hatalar bir referans dosyasında
 * dondurulur, kontrol yalnızca **yeni** hatalarda kırmızıya döner. Bir hata
 * düzeltildiğinde referans daralır ve geri gelmesi artık hata sayılır.
 *
 * Kullanım:
 *   node scripts/typecheck-ratchet.js            # yeni hata var mı
 *   node scripts/typecheck-ratchet.js --update   # referansı güncelle
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASELINE = path.join(__dirname, '..', 'typecheck-baseline.json');
const guncelle = process.argv.includes('--update');

/**
 * Hata satırını "dosya + kod + mesaj" anahtarına indirger.
 *
 * Satır/sütun bilerek dışarıda bırakıldı: alakasız bir düzenleme dosyayı
 * kaydırdığında referans bozulmasın, mandal gürültü üretmesin.
 */
function anahtar(satir) {
  const m = satir.match(/^(.+?)\((\d+),(\d+)\): (error TS\d+): (.*)$/);
  if (!m) return null;
  const [, dosya, , , kod, mesaj] = m;
  return `${dosya.replace(/\\/g, '/')} | ${kod} | ${mesaj.trim()}`;
}

function tscCalistir() {
  const sonuc = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '--noEmit', '--pretty', 'false'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const cikti = `${sonuc.stdout || ''}${sonuc.stderr || ''}`;

  // TS5103/TS6046 gibi yapılandırma hataları derlemeyi hiçbir dosya
  // kontrol edilmeden durdurur; bunu "hata yok" sanmak tam olarak bu
  // mandalın önlemek istediği şey.
  const yapilandirmaHatasi = cikti.match(/error TS(5\d{3}|6\d{3}):.*/g);
  if (yapilandirmaHatasi) {
    console.error('tsconfig geçersiz — derleme hiçbir dosyayı kontrol edemedi:');
    yapilandirmaHatasi.forEach(h => console.error(`  ${h}`));
    process.exit(2);
  }

  const hatalar = new Map();
  cikti.split('\n').forEach(satir => {
    const a = anahtar(satir);
    if (!a) return;
    hatalar.set(a, (hatalar.get(a) || 0) + 1);
  });
  return hatalar;
}

function referansOku() {
  if (!fs.existsSync(BASELINE)) return new Map();
  try {
    const ham = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    return new Map(Object.entries(ham.hatalar || {}));
  } catch (err) {
    console.error(`Referans dosyası okunamadı: ${err.message}`);
    process.exit(2);
  }
}

function referansYaz(hatalar) {
  const sirali = Object.fromEntries([...hatalar.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const toplam = [...hatalar.values()].reduce((s, n) => s + n, 0);
  fs.writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        aciklama:
          'Tip kontrolü referansı. Yalnızca yeni hatalar kontrolü kırar; bkz. scripts/typecheck-ratchet.js. Güncellemek için: npm run typecheck:update',
        toplamHata: toplam,
        benzersizHata: hatalar.size,
        hatalar: sirali,
      },
      null,
      2,
    )}\n`,
  );
  return toplam;
}

const mevcut = tscCalistir();

if (guncelle) {
  const toplam = referansYaz(mevcut);
  console.log(`Referans güncellendi: ${mevcut.size} benzersiz, ${toplam} toplam hata.`);
  process.exit(0);
}

const referans = referansOku();
const yeni = [];
const duzelen = [];

mevcut.forEach((adet, a) => {
  const oncekiAdet = referans.get(a) || 0;
  if (adet > oncekiAdet) yeni.push({ hata: a, adet: adet - oncekiAdet });
});
referans.forEach((adet, a) => {
  const simdikiAdet = mevcut.get(a) || 0;
  if (simdikiAdet < adet) duzelen.push({ hata: a, adet: adet - simdikiAdet });
});

const mevcutToplam = [...mevcut.values()].reduce((s, n) => s + n, 0);
const referansToplam = [...referans.values()].reduce((s, n) => s + n, 0);
console.log(`Tip hatası: ${mevcutToplam} (referans: ${referansToplam})`);

if (duzelen.length > 0) {
  console.log(`\n${duzelen.length} hata düzeltilmiş. Referansı daraltın:`);
  console.log('  npm run typecheck:update');
}

if (yeni.length === 0) {
  console.log('\nYeni tip hatası yok.');
  process.exit(0);
}

console.error(`\n${yeni.length} YENİ tip hatası:`);
yeni.forEach(({ hata, adet }) => {
  console.error(`  ${hata}${adet > 1 ? ` (${adet}x)` : ''}`);
});
console.error(
  '\nBunlar referansta yok, yani bu değişiklikle geldi. Düzeltin ya da bilerek\n' +
    'kabul ediyorsanız `npm run typecheck:update` ile referansa ekleyin.',
);
process.exit(1);
