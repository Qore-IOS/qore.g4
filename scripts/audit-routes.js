#!/usr/bin/env node
/**
 * Rota erişilebilirlik denetimi.
 *
 * NEDEN VAR
 *
 * Sistemde 190'ın üzerinde App Router sayfası var ve hepsinin hâlâ kullanıldığı
 * varsayılıyor. Yeniden yazım programında bu varsayım pahalıdır: kullanılmayan
 * bir ekranı yeniden yazmak, silmek yerine taşımak demektir. Faz 0 envanterinin
 * işi bu ayrımı yapmak.
 *
 * NE ÖLÇER — VE NE ÖLÇMEZ
 *
 * Bu betik STATİK ERİŞİLEBİLİRLİK ölçer, KULLANIM değil. İlişki tek yönlüdür
 * ama işe yarar:
 *
 *   hiçbir yerden erişilemeyen rota  →  kesinlikle kullanılmıyor
 *   erişilebilen rota                →  kullanılıyor OLABİLİR
 *
 * Yani "YETİM" listesi, üretim analitiği olmadan da güvenle silinebilecek
 * kodun ALT SINIRIDIR. Üst sınır için gerçek kullanım verisi gerekir.
 *
 * NASIL ÖLÇER — GEÇİŞLİ KAPANIŞ
 *
 * Naif yaklaşım ("bu rotaya herhangi bir yerden bağlantı var mı") yanıltıcıdır:
 * birbirine bağlanan ölü sayfalar kümesi hep birlikte "erişilebilir" görünür.
 * Bu yüzden gerçek import grafiği kurulur ve sabit noktaya kadar yinelenir:
 *
 *   1. KÖK   = navigasyon kayıtlarından (dock, başlat menüsü, kestirme
 *              kataloğu) ve kök layout'lardan doğrudan verilen rotalar.
 *   2. Erişilebilir bir sayfanın import ettiği her dosya erişilebilirdir
 *              (geçişli).
 *   3. Erişilebilir bir dosyadan bağlantı verilen her rota erişilebilirdir.
 *   4. Yeni rota eklendikçe 2'ye dön.
 *
 * Böylece yalnızca ölü sayfalardan bağlantı alan bir rota YETİM kalır.
 *
 * KULLANIM
 *   node scripts/audit-routes.js            # rapor
 *   node scripts/audit-routes.js --json     # makine çıktısı
 *   node scripts/audit-routes.js --orphans  # yalnız yetim listesi
 */

const fs = require('node:fs');
const path = require('node:path');

const KOK = path.resolve(__dirname, '..');
const SRC = path.join(KOK, 'src');
const APP = path.join(SRC, 'app');

/**
 * Navigasyon kayıtları ve uygulama kabuğu — geçişli kapanışın KÖKÜ.
 *
 * Bunlar hiçbir sayfadan import edilmeseler bile erişilebilir kabul edilir;
 * kullanıcının menüden ulaşabildiği her şey buradan başlar.
 */
const KOK_DOSYALAR = [
  'src/hooks/use-dock.ts',
  'src/components/dock.tsx',
  'src/lib/shortcuts/catalog.ts',
  'src/components/start-menu/data.ts',
  'src/components/start-menu/StartMenu.tsx',
  'src/components/qore-technic-shell.tsx',
  'src/app/layout.tsx',
  'src/app/(protected)/layout.tsx',
  'src/app/page.tsx',
];

/** Menü kaydı sayılanlar — sınıflandırmada "MENÜ" etiketi için. */
const MENU_KAYNAKLARI = new Set([
  'src/hooks/use-dock.ts',
  'src/components/dock.tsx',
  'src/lib/shortcuts/catalog.ts',
  'src/components/start-menu/data.ts',
  'src/components/start-menu/StartMenu.tsx',
]);

const HARIC_DIZIN = new Set(['api']);

/**
 * Next.js'in dosya adıyla çağırdığı, çerçeve tarafından KOŞULSUZ çalıştırılan
 * özel dosyalar. Hiçbir yerden import edilmezler ama ölü sayılamazlar.
 *
 * `page.tsx` ve `layout.tsx` BİLEREK dışarıda: onlar rotaya bağlıdır. Kök
 * kümesine alınırlarsa her sayfa kendiliğinden erişilebilir olur, geçişli
 * analiz anlamsızlaşır ve birbirine bağlanan ölü sayfa kümeleri canlı görünür —
 * bu betiğin tam olarak yakalamak için yazıldığı durum.
 */
const NEXT_OZEL = /(^|\/)(route|template|loading|error|global-error|not-found|default|middleware|instrumentation|opengraph-image|icon|apple-icon|sitemap|robots|manifest)\.(ts|tsx)$/;

/**
 * `src/` dışından import edilen dosyalar da canlıdır: testler, Cloud Functions
 * ve betikler uygulama modüllerini kullanır. Bu ağaçlar taranıp bağımlılıkları
 * köke eklenir.
 */
const DIS_TUKETICILER = ['tests', 'functions/src', 'scripts', 'terminal-app', 'desktop'];

// ── dosya toplama ───────────────────────────────────────────────────────────

function* dosyalar(dizin, filtre) {
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) {
      if (girdi.name === 'node_modules' || girdi.name.startsWith('.')) continue;
      yield* dosyalar(tam, filtre);
    } else if (filtre(girdi.name)) {
      yield tam;
    }
  }
}

const goreliYol = mutlak => path.relative(KOK, mutlak).split(path.sep).join('/');

/** `src/app/(protected)/foo/[id]/page.tsx` → `/foo/[id]` */
function dosyadanRota(mutlak) {
  const parcalar = path.relative(APP, mutlak).split(path.sep);
  parcalar.pop();
  const temiz = parcalar.filter(p => !(p.startsWith('(') && p.endsWith(')')));
  return '/' + temiz.join('/');
}

// ── import grafiği ──────────────────────────────────────────────────────────

/**
 * Uzantı deneme sırası — Next.js/webpack ile AYNI olmak zorundadır.
 *
 * webpack `resolve.extensions` sırası `.tsx` → `.ts`'dir. Bu sıra ters
 * yazılırsa, aynı adı hem `.ts` hem `.tsx` ile taşıyan bir modülde denetim
 * CANLI dosyayı ölü, ÖLÜ dosyayı canlı gösterir — silinmemesi gereken kod
 * silinir. (Depoda tam olarak bu durum vardı: `useScanPerformance`.)
 *
 * Not: TypeScript'in kendi çözümlemesi `.ts`'i önceler, yani böyle bir çiftte
 * derleyici ile çalışma zamanı FARKLI dosyaya bakar. Bu, gölgelenen dosyanın
 * silinmesi için ayrıca bir sebeptir.
 */
const UZANTILAR = ['.tsx', '.ts', '/index.tsx', '/index.ts'];

/** Bir import belirtecini depo içindeki gerçek dosyaya çözer; harici ise null. */
function importCoz(kaynakDosya, belirtec) {
  let temel;
  if (belirtec.startsWith('@/')) temel = path.join(SRC, belirtec.slice(2));
  else if (belirtec.startsWith('.')) temel = path.resolve(path.dirname(kaynakDosya), belirtec);
  else return null; // node_modules

  // Testler TypeScript kaynağını `.js` uzantısıyla import eder
  // (`'../../src/lib/x/validation.js'`) — ESM çözümlemesinin gereği. Uzantı
  // soyulmazsa bu modüller "hiç import edilmemiş" görünür ve test edilmiş
  // kod ölü listesine düşer.
  const adaylar = [temel];
  if (temel.endsWith('.js')) adaylar.push(temel.slice(0, -3));
  if (temel.endsWith('.jsx')) adaylar.push(temel.slice(0, -4));

  for (const kok of adaylar) {
    for (const ek of ['', ...UZANTILAR]) {
      const aday = kok + ek;
      if (fs.existsSync(aday) && fs.statSync(aday).isFile()) return aday;
    }
  }
  return null;
}

const IMPORT_KALIBI = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

// ── rota referansı arama ────────────────────────────────────────────────────

const kacir = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Bir rotanın aranacak metin kalıpları.
 *
 * Dinamik segmentler şablon ifadeleriyle kurulur (`` `/teknik-servis/${id}` ``),
 * o yüzden segmentten önceki sabit önek aranır. Sabit rotalarda tam eşleşme
 * aranır; `/siparisler` ararken `/siparisler/[orderId]/toplama` referansının
 * sayılmaması için sınır kontrolü yapılır — aksi hâlde her üst rota otomatik
 * erişilebilir görünürdü.
 */
function aramaKaliplari(rota) {
  const dinamik = rota.indexOf('/[');
  if (dinamik >= 0) {
    const onek = kacir(rota.slice(0, dinamik));
    return [new RegExp(`${onek}/(?:\\$\\{|['"\`]\\s*\\+)`), new RegExp(`${onek}/\\[`)];
  }
  return [new RegExp(`['"\`]${kacir(rota)}(?:[?#]|['"\`]|\\$\\{)`)];
}

// ── denetim ─────────────────────────────────────────────────────────────────

function denetle() {
  // 1) Tüm kaynak dosyaları oku, import kenarlarını çıkar.
  const metin = new Map();   // goreli → kaynak metni
  const kenarlar = new Map(); // goreli → goreli[]

  for (const tam of dosyalar(SRC, ad => /\.(ts|tsx)$/.test(ad))) {
    const goreli = goreliYol(tam);
    const kaynak = fs.readFileSync(tam, 'utf8');
    metin.set(goreli, kaynak);

    const hedefler = [];
    for (const m of kaynak.matchAll(IMPORT_KALIBI)) {
      const cozulen = importCoz(tam, m[1]);
      if (cozulen) hedefler.push(goreliYol(cozulen));
    }
    kenarlar.set(goreli, hedefler);
  }

  // 2) Rotaları topla.
  const rotalar = [];
  for (const tam of dosyalar(APP, ad => ad === 'page.tsx')) {
    if (path.relative(APP, tam).split(path.sep).some(p => HARIC_DIZIN.has(p))) continue;
    const goreli = goreliYol(tam);
    rotalar.push({
      rota: dosyadanRota(tam),
      dosya: goreli,
      satir: (metin.get(goreli) || '').split('\n').length,
      kaliplar: aramaKaliplari(dosyadanRota(tam)),
      referanslar: [],
    });
  }

  // Layout'lar rotaya bağlıdır: ancak altında erişilebilir bir sayfa varsa
  // çalışırlar. Kök layout'lar (`src/app/layout.tsx`, `(protected)/layout.tsx`)
  // KOK_DOSYALAR içinde ayrıca verilmiştir.
  const layoutlar = [...dosyalar(APP, ad => ad === 'layout.tsx')].map(goreliYol);
  const layoutDizini = new Map(layoutlar.map(l => [l, path.posix.dirname(l)]));

  // 3) Sabit noktaya kadar yinele.
  const erisilebilirDosya = new Set();
  const erisilebilirRota = new Set();
  const kuyruk = [];

  const dosyaEkle = goreli => {
    if (!metin.has(goreli) || erisilebilirDosya.has(goreli)) return;
    erisilebilirDosya.add(goreli);
    kuyruk.push(goreli);
  };

  KOK_DOSYALAR.forEach(dosyaEkle);

  // Next.js'in kendi çağırdığı özel dosyalar (route.ts, not-found.tsx, …).
  for (const goreli of metin.keys()) {
    if (NEXT_OZEL.test(goreli)) dosyaEkle(goreli);
  }

  // `src/` dışındaki tüketicilerin (test, functions, script) import ettikleri.
  for (const agac of DIS_TUKETICILER) {
    const mutlakAgac = path.join(KOK, agac);
    if (!fs.existsSync(mutlakAgac)) continue;
    for (const tam of dosyalar(mutlakAgac, ad => /\.(ts|tsx|js)$/.test(ad))) {
      const kaynak = fs.readFileSync(tam, 'utf8');
      for (const m of kaynak.matchAll(IMPORT_KALIBI)) {
        const cozulen = importCoz(tam, m[1]);
        if (cozulen) dosyaEkle(goreliYol(cozulen));
      }
    }
  }

  let degisti = true;
  while (degisti) {
    degisti = false;

    // 3a) Import kapanışı.
    while (kuyruk.length > 0) {
      const su = kuyruk.pop();
      for (const hedef of kenarlar.get(su) || []) dosyaEkle(hedef);
    }

    // 3b) Erişilebilir dosyalardan bağlantı verilen rotaları aç.
    for (const r of rotalar) {
      if (erisilebilirRota.has(r.rota)) continue;
      for (const dosya of erisilebilirDosya) {
        if (dosya === r.dosya) continue;
        const kaynak = metin.get(dosya);
        if (r.kaliplar.some(k => k.test(kaynak))) {
          r.referanslar.push(dosya);
          erisilebilirRota.add(r.rota);
          dosyaEkle(r.dosya);
          // Sayfa canlıysa onu saran layout zinciri de canlıdır.
          for (const [layout, dizin] of layoutDizini) {
            if (r.dosya.startsWith(dizin + '/')) dosyaEkle(layout);
          }
          degisti = true;
          break;
        }
      }
    }
  }

  // 4) Sınıflandır.
  for (const r of rotalar) {
    if (r.referanslar.some(y => MENU_KAYNAKLARI.has(y))) r.sinif = 'MENU';
    else if (r.referanslar.length > 0) r.sinif = 'KOD';
    else {
      const ust = ustRotalar(r.rota).find(u => erisilebilirRota.has(u));
      r.sinif = ust ? 'ALT-ROTA' : 'YETIM';
      r.ust = ust;
    }
    delete r.kaliplar;
  }

  // 5) Ölü modüller: hiçbir erişilebilir dosyadan ulaşılamayanlar.
  //
  // `.d.ts` bildirim dosyaları hiçbir zaman import edilmez — TypeScript onları
  // ortam tipleri olarak yükler. Ölü sayılamazlar.
  const oluModuller = [];
  for (const [goreli, kaynak] of metin) {
    if (erisilebilirDosya.has(goreli)) continue;
    if (goreli.endsWith('.d.ts')) continue;
    oluModuller.push({ dosya: goreli, satir: kaynak.split('\n').length });
  }
  oluModuller.sort((a, b) => b.satir - a.satir);

  return { rotalar, oluModuller };
}

function ustRotalar(rota) {
  const parcalar = rota.split('/').filter(Boolean);
  const out = [];
  for (let i = parcalar.length - 1; i > 0; i--) out.push('/' + parcalar.slice(0, i).join('/'));
  return out;
}

// ── çıktı ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const { rotalar, oluModuller } = denetle();

const sayim = rotalar.reduce((a, r) => ({ ...a, [r.sinif]: (a[r.sinif] || 0) + 1 }), {});
const yetimler = rotalar.filter(r => r.sinif === 'YETIM').sort((a, b) => b.satir - a.satir);
const yetimSatir = yetimler.reduce((t, r) => t + r.satir, 0);
const toplamSatir = rotalar.reduce((t, r) => t + r.satir, 0);
const oluSatir = oluModuller.reduce((t, m) => t + m.satir, 0);

if (argv.includes('--json')) {
  console.log(JSON.stringify({ sayim, toplamSatir, yetimSatir, oluSatir, rotalar, oluModuller }, null, 2));
} else if (argv.includes('--orphans')) {
  yetimler.forEach(r => console.log(`${String(r.satir).padStart(5)}  ${r.rota}`));
} else if (argv.includes('--dead')) {
  oluModuller.forEach(m => console.log(`${String(m.satir).padStart(5)}  ${m.dosya}`));
} else {
  console.log('\nROTA ERİŞİLEBİLİRLİK DENETİMİ');
  console.log('═'.repeat(78));
  console.log(`${rotalar.length} rota · ${toplamSatir.toLocaleString('tr-TR')} satır (yalnız page.tsx)\n`);

  const etiket = {
    MENU: 'Menüden erişilebilir (dock / başlat / kestirme)',
    KOD: 'Kod içinden erişilebilir — geçişli olarak menüye bağlı',
    'ALT-ROTA': 'Alt rota — üst rotası erişilebilir',
    YETIM: 'YETİM — erişilebilir hiçbir dosyadan bağlantı yok',
  };
  for (const k of ['MENU', 'KOD', 'ALT-ROTA', 'YETIM']) {
    console.log(`  ${String(sayim[k] || 0).padStart(4)}  ${etiket[k]}`);
  }

  console.log('\n' + '─'.repeat(78));
  console.log(`YETİM ROTALAR — ${yetimler.length} adet, ${yetimSatir.toLocaleString('tr-TR')} satır\n`);
  console.log(`${'Satır'.padStart(6)}  Rota`);
  for (const r of yetimler) console.log(`${String(r.satir).padStart(6)}  ${r.rota}`);

  console.log('\n' + '═'.repeat(78));
  console.log(`ÖLÜ MODÜLLER — ${oluModuller.length} dosya, ${oluSatir.toLocaleString('tr-TR')} satır`);
  console.log('Aynı grafik üzerinden: erişilebilir hiçbir dosyadan import edilmeyen');
  console.log('modüller. Next.js özel dosyaları, testlerin/functions/betiklerin');
  console.log('kullandıkları ve layout ağacı hariç tutuldu.\n');

  console.log(`${'Satır'.padStart(6)}  Dosya`);
  for (const m of oluModuller.slice(0, 40)) {
    console.log(`${String(m.satir).padStart(6)}  ${m.dosya}`);
  }
  if (oluModuller.length > 40) console.log(`         … ve ${oluModuller.length - 40} dosya daha (--dead ile tamamı)`);

  console.log('\n' + '─'.repeat(78));
  console.log('Bu betik "kullanılıyor mu" değil, "erişilebilir mi" ölçer. Erişilebilir');
  console.log('bir rota da kullanılmıyor olabilir; ayırmak için üretim analitiği');
  console.log('gerekir. Yetim ve ölü listeleri ise analitiksiz de güvenlidir —');
  console.log('yalnız dinamik/değişken yollu import\'lar gözden kaçabilir, silmeden');
  console.log('önce her aday tek tek doğrulanmalıdır.');
}

// Mandal: ölü modül sayısı ARTAMAZ. Yeniden yazım ilerledikçe tavan düşürülür.
const tavanIndex = argv.indexOf('--max-dead');
if (tavanIndex >= 0) {
  const tavan = Number(argv[tavanIndex + 1]);
  if (Number.isFinite(tavan) && oluModuller.length > tavan) {
    console.error(`\nÖlü modül sayısı ${oluModuller.length} — tavan ${tavan}.`);
    console.error('Erişilemeyen yeni dosya eklenmiş olabilir; bağlayın ya da silin.');
    process.exit(1);
  }
  console.log(`Ölü modül mandalı: ${oluModuller.length}/${tavan} — geçti.`);
}
