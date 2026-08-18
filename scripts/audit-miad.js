#!/usr/bin/env node
/**
 * Miad (son kullanma tarihi) çözüm noktalarının denetimi.
 *
 * NEDEN VAR
 *
 * `depoStok.miad` sisteme birden çok kaynaktan, birden çok biçimde giriyor:
 * mal kabul `normalizeMiad` ile `dd.MM.yyyy` METNİ yazıyor, Ceomed senkronu
 * API'nin ham `MIYAT` alanını (ISO veya gün/ay/yıl) taşıyor, elle girilen bazı
 * kayıtlarda yalnızca ay/yıl bulunuyor, bir kısmı Firestore Timestamp.
 *
 * Kod tabanında bu değeri tarihe çeviren EN AZ ALTI ayrı uygulama var ve her
 * biri farklı bir biçim alt kümesini destekliyor. Sonuç: aynı lot, açtığınız
 * ekrana göre farklı miad durumu gösterebiliyor — birinde "3 ay kaldı",
 * ötekinde "miad yok".
 *
 * Ayrıca bir hata sınıfı daha var: `new Date("01.02.2027")` V8'de ABD kuralıyla
 * 2 Ocak 2027 döner (doğrusu 1 Şubat). Miad metni tam olarak bu biçimde
 * saklandığı için, ham `new Date()` ile çözülen her miadın günü 12'den küçükse
 * ayı ile günü yer değiştirir.
 *
 * Bu betik o noktaları sayar ve sınıflandırır. Bugün rapor üretir; yeniden
 * yazım programında `--max-risk` ile mandal hâline gelir (risk sayısı artamaz).
 *
 * KULLANIM
 *   node scripts/audit-miad.js              # okunabilir rapor
 *   node scripts/audit-miad.js --json       # makine çıktısı
 *   node scripts/audit-miad.js --max-risk N # N'den çok riskli nokta varsa çık(1)
 */

const fs = require('node:fs');
const path = require('node:path');

const KOK = path.resolve(__dirname, '..');
const TARANAN = path.join(KOK, 'src');
const UZANTILAR = new Set(['.ts', '.tsx']);

/** Denetimin kendi kaynağı ve tek kaynak modülü rapordan muaftır. */
const MUAF = new Set([
  'src/lib/lojistik/miad.ts', // tek kaynak ayrıştırıcının kendisi
]);

/** Bir ifadenin miad değeri taşıdığını gösteren adlar. */
const MIAD_TOKEN = /\b(miad|Miad|MIAD|miyat|MIYAT|expiry|expiryDate|expirationDate|sonKullanma|sonKullanim)\b/;

/**
 * Sınıflar — ciddiyet sırasına göre.
 *
 * `risk: true` olanlar yeniden yazım kapsamına girer; `risk: false` olanlar
 * halihazırda doğru yoldadır ve yalnızca envanter için sayılır.
 */
const SINIFLAR = {
  HAM_NEW_DATE: {
    etiket: 'Ham new Date(miad)',
    risk: true,
    aciklama: 'V8 "01.02.2027" değerini 2 Ocak olarak okur — gün/ay yer değiştirir.',
  },
  YEREL_PARSER: {
    etiket: 'Yerel ayrıştırıcı',
    risk: true,
    aciklama: 'Dosya kendi tarih çözümünü yazmış; desteklediği biçim alt kümesi diğerlerinden farklı.',
  },
  KATI_FORMAT: {
    etiket: 'Tek biçime sabitlenmiş',
    risk: true,
    aciklama: "date-fns parse(x,'dd.MM.yyyy') — başka biçimde sessizce Invalid Date döner.",
  },
  PAYLASILAN: {
    etiket: 'Paylaşılan yardımcı (@/lib/date)',
    risk: false,
    aciklama: 'dd.MM.yyyy ve ISO doğru; yalnız ay/yıl (MM.yyyy) taşıyan miadları çözemez.',
  },
  SAGLAM: {
    etiket: 'Tek kaynak (lojistik/miad)',
    risk: false,
    aciklama: 'Bilinen tüm miad biçimlerini çözer. Hedef durum.',
  },
};

/** Kaynak dosyayı satır satır tarayıp sınıflandırılmış bulgular döndürür. */
function dosyayiTara(goreliYol, kaynak) {
  const bulgular = [];
  const satirlar = kaynak.split('\n');

  const tekKaynakKullaniyor = /from\s+['"][^'"]*lojistik\/miad['"]/.test(kaynak);
  const paylasilanKullaniyor = /from\s+['"](@\/lib\/date|\.{1,2}(\/[\w-]+)*\/date)['"]/.test(kaynak);

  if (tekKaynakKullaniyor) bulgular.push({ sinif: 'SAGLAM', satir: 0, kod: 'import lojistik/miad' });
  if (paylasilanKullaniyor) bulgular.push({ sinif: 'PAYLASILAN', satir: 0, kod: 'import @/lib/date' });

  satirlar.forEach((ham, i) => {
    const satir = ham.trim();
    const no = i + 1;
    if (satir.startsWith('//') || satir.startsWith('*')) return;

    // Elle doğrulanmış noktalar gerekçeyle muaf tutulabilir. Statik tarama
    // değişken TİPİNİ bilemez; örneğin zaten `Date` olan bir değeri kopyalayan
    // `new Date(x)` çağrısı güvenlidir ama regex bunu ayırt edemez. Gerekçe
    // ZORUNLUDUR — gerekçesiz muafiyet, sessizce biriken borçtur.
    const oncekiSatir = i > 0 ? satirlar[i - 1] : '';
    if (/audit-miad:\s*guvenli\s*—\s*\S/.test(oncekiSatir) || /audit-miad:\s*guvenli\s*—\s*\S/.test(satir)) return;

    // 1) new Date(<tek argüman, içinde miad geçen>) — çok argümanlı
    //    new Date(yil, ay, gun) biçimi kasıtlıdır, riskli değildir.
    //
    //    Gün/ay takası yalnızca argüman HAM metin olduğunda oluşur. Çağrı bir
    //    biçim koruması altındaysa (`/^\d{2}\.\d{2}\.\d{4}$/` testi, ISO'ya
    //    çeviren şablon, `includes('-')` dalı) takas olmaz — orada sorun
    //    ayrıştırmanın yanlışlığı değil, KOPYA olmasıdır. İkisini aynı sınıfa
    //    koymak raporu yanıltır, o yüzden ayrıştırılır.
    const oncekiler = satirlar.slice(Math.max(0, i - 6), i).join(' ');
    const bicimKorumasi =
      /\\d\{1,?2\}\s*\\?\.\s*\\d\{1,?2\}/.test(oncekiler) ||   // TR tarih regex'i
      /includes\(\s*['"]-['"]\s*\)/.test(oncekiler) ||          // ISO dalı
      /\/\^\\d\{4\}/.test(oncekiler);                           // ISO regex'i

    for (const eslesme of satir.matchAll(/new Date\(\s*([^();]*?)\s*\)/g)) {
      const arg = eslesme[1];
      if (!arg || arg.includes(',')) continue;
      if (!MIAD_TOKEN.test(arg)) continue;
      // Şablon içinde ISO kuruluyorsa (`${miad}-01`) takas riski yok.
      const isoSablon = /`[^`]*\$\{[^}]*\}[^`]*-\d/.test(arg);
      bulgular.push({
        sinif: bicimKorumasi || isoSablon ? 'YEREL_PARSER' : 'HAM_NEW_DATE',
        satir: no,
        kod: satir.slice(0, 120),
      });
    }

    // 2) Miad değeri üzerinde elle split — dosyaya özel ayrıştırıcı.
    if (MIAD_TOKEN.test(satir) && /\.split\(\s*['"][./-]['"]\s*\)/.test(satir)) {
      bulgular.push({ sinif: 'YEREL_PARSER', satir: no, kod: satir.slice(0, 120) });
    }

    // 3) date-fns parse ile tek biçime sabitleme.
    if (/\bparse(Date)?\(\s*[^,]*,\s*['"]dd\.MM\.yyyy['"]/.test(satir)) {
      bulgular.push({ sinif: 'KATI_FORMAT', satir: no, kod: satir.slice(0, 120) });
    }
  });

  // Aynı dosyada kendi miad çözüm FONKSİYONUNU tanımlayanlar: yerel parser.
  //
  // Ad listesi dar tutulur ve tanımın gerçekten bir fonksiyon olması aranır.
  // Daha gevşek bir kalıp (ör. yalın `toDate`) `const toDate = resolveDate(...)`
  // gibi sıradan değişkenleri yakalayıp raporu gürültüye boğuyordu — güvenilmez
  // bir denetim, denetim olmamasından kötüdür.
  const YEREL_ADLAR = [
    'normDate', 'parseMiad', 'normalizeMiad', 'parseExpiry', 'miadToDate',
    'parseStockExpiryDate', 'parseDdMmYyyy', 'getRemainingDays', 'validateExpiryDate',
    'getMiadInfo\\w*', 'getMiadStatus\\w*', 'getMiadDurum\\w*',
  ].join('|');
  const yerelTanim = new RegExp(
    `(?:function\\s+(?:${YEREL_ADLAR})\\s*\\(|const\\s+(?:${YEREL_ADLAR})\\s*=\\s*(?:function|\\(|async))`,
    'g',
  );
  for (const eslesme of kaynak.matchAll(yerelTanim)) {
    if (goreliYol === 'src/lib/date.ts') break; // paylaşılan yardımcının kendisi
    const no = kaynak.slice(0, eslesme.index).split('\n').length;
    bulgular.push({ sinif: 'YEREL_PARSER', satir: no, kod: eslesme[0].trim() });
  }

  return bulgular;
}

function* dosyalar(dizin) {
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) {
      if (girdi.name === 'node_modules' || girdi.name.startsWith('.')) continue;
      yield* dosyalar(tam);
    } else if (UZANTILAR.has(path.extname(girdi.name))) {
      yield tam;
    }
  }
}

function denetle() {
  const rapor = new Map(); // goreliYol -> bulgular[]
  /** Miad'a dokunan ama tarihe çevirmeyen dosyalar (yalnız taşıyor/gösteriyor). */
  let tasiyanDosya = 0;

  for (const tam of dosyalar(TARANAN)) {
    const goreli = path.relative(KOK, tam).split(path.sep).join('/');
    if (MUAF.has(goreli)) continue;

    const kaynak = fs.readFileSync(tam, 'utf8');
    if (!MIAD_TOKEN.test(kaynak)) continue;

    const bulgular = dosyayiTara(goreli, kaynak);
    if (bulgular.length > 0) rapor.set(goreli, bulgular);
    else tasiyanDosya += 1;
  }

  return { rapor, tasiyanDosya };
}

function ozet(rapor) {
  const sayim = Object.fromEntries(Object.keys(SINIFLAR).map(k => [k, 0]));
  const riskliDosyalar = new Set();

  for (const [dosya, bulgular] of rapor) {
    for (const b of bulgular) {
      sayim[b.sinif] += 1;
      if (SINIFLAR[b.sinif].risk) riskliDosyalar.add(dosya);
    }
  }

  const riskliNokta = Object.entries(sayim)
    .filter(([k]) => SINIFLAR[k].risk)
    .reduce((t, [, v]) => t + v, 0);

  return { sayim, riskliNokta, riskliDosyaSayisi: riskliDosyalar.size, dosyaSayisi: rapor.size };
}

// ── çıktı ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const { rapor, tasiyanDosya } = denetle();
const o = { ...ozet(rapor), tasiyanDosya };

if (argv.includes('--json')) {
  console.log(JSON.stringify({
    ozet: o,
    dosyalar: Object.fromEntries(rapor),
  }, null, 2));
} else {
  console.log('\nMİAD ÇÖZÜM NOKTALARI DENETİMİ');
  console.log('═'.repeat(74));
  console.log(`${o.dosyaSayisi} dosya miadı TARİHE ÇEVİRİYOR · ${o.riskliDosyaSayisi} dosyada ${o.riskliNokta} riskli nokta`);
  console.log(`${tasiyanDosya} dosya miadı yalnızca taşıyor/gösteriyor — çözüm yapmıyor, risk taşımıyor\n`);

  for (const [anahtar, meta] of Object.entries(SINIFLAR)) {
    const n = o.sayim[anahtar];
    const isaret = meta.risk ? (n > 0 ? '!' : ' ') : '·';
    console.log(`${isaret} ${String(n).padStart(4)}  ${meta.etiket}`);
    console.log(`        ${meta.aciklama}`);
  }

  console.log('\n' + '─'.repeat(74));
  console.log('RİSKLİ NOKTALAR — dosya bazında\n');

  const riskli = [...rapor.entries()]
    .map(([dosya, bulgular]) => [dosya, bulgular.filter(b => SINIFLAR[b.sinif].risk)])
    .filter(([, bulgular]) => bulgular.length > 0)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [dosya, bulgular] of riskli) {
    console.log(`${dosya}  (${bulgular.length})`);
    for (const b of bulgular) {
      console.log(`   ${String(b.satir).padStart(5)}  ${SINIFLAR[b.sinif].etiket.padEnd(28)} ${b.kod}`);
    }
    console.log('');
  }
}

const maxIndex = argv.indexOf('--max-risk');
if (maxIndex >= 0) {
  const tavan = Number(argv[maxIndex + 1]);
  if (Number.isFinite(tavan) && o.riskliNokta > tavan) {
    console.error(`\nRiskli miad noktası ${o.riskliNokta} — tavan ${tavan}. Yeni nokta eklenmiş olabilir.`);
    process.exit(1);
  }
}
