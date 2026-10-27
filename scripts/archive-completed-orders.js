/**
 * Tamamlanan siparişleri arşive taşıma backfill'i.
 *
 * `orders` koleksiyonundaki status === 'completed' dokümanları tek seferlik
 * olarak `ordersArchive` koleksiyonuna taşır (kopyala + sil). Uygulama kodu
 * artık yeni tamamlananları doğrudan arşive yazıyor; bu script mevcut (eski)
 * tamamlanmış siparişleri de oraya taşıyarak canlı `orders`'ı sadeleştirir.
 *
 * GÜVENLİK:
 *   - Varsayılan mod `--dry-run` (sadece sayar/raporlar, yazmaz).
 *   - Yazma için `--apply` flag'i şart.
 *   - Firestore batched writes; her sipariş 2 işlem (set + delete) olduğundan
 *     batch başına en fazla 200 sipariş işlenir (≤ 400 işlem, 500 limitinin altı).
 *   - Arşive yazılan dokümana `archivedAt` damgası eklenir; orijinal alanlar
 *     (id alanı dahil) aynen korunur.
 *
 * Kullanım:
 *   node scripts/archive-completed-orders.js                 # dry-run
 *   node scripts/archive-completed-orders.js --apply         # taşı
 *   node scripts/archive-completed-orders.js --company <ID>  # tek şirket
 *   node scripts/archive-completed-orders.js --company <ID> --apply
 *
 * Ortam:
 *   Firebase Studio / Cloud Shell / Compute Engine'de HİÇBİR ŞEY ayarlamayın —
 *   kimlik bilgisi ortamdan gelir, proje kimliği `.firebaserc`'den çözülür.
 *
 *   Yalnızca kendi makinenizde çalışıyorsanız bir anahtar gerekir:
 *     GOOGLE_APPLICATION_CREDENTIALS -> service account JSON'un GERÇEK yolu
 *   Var olmayan bir yol verilirse script ne yapılacağını söyleyerek durur.
 *
 *   APP_BASE_URL isteğe bağlıdır; verilmezse `.firebaserc` kullanılır.
 */
const admin = require('./db/script-store.cjs');
const { initAdmin } = require('./lib/database-project');

const ORDERS_COLLECTION = 'orders';
const ORDERS_ARCHIVE_COLLECTION = 'ordersArchive';
// Her sipariş 2 yazma işlemi (set + delete) ürettiği için batch başına 200.
const ORDERS_PER_BATCH = 200;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { apply: false, company: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--company' && args[i + 1]) out.company = args[++i].trim();
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/archive-completed-orders.js [--company <ID>] [--apply]');
      process.exit(0);
    }
  }
  return out;
}

// Kimlik bilgisi ve proje kimliği çözümü scripts/lib/firebase-project.js'te
// ortaklaştırıldı: eksik/yanlış GOOGLE_APPLICATION_CREDENTIALS durumunda ham
// ENOENT yerine ne yapılacağını söyleyen bir hata verir, proje kimliğini de
// env yoksa `.firebaserc`'den çözer.
function getDb() {
  return initAdmin(admin, { quiet: true }).db;
}

async function main() {
  const { apply, company } = parseArgs();
  const db = getDb();

  let query = db.collection(ORDERS_COLLECTION).where('status', '==', 'completed');
  if (company) query = query.where('companyId', '==', company);

  console.log(`\n[archive-completed-orders] mod: ${apply ? 'APPLY (yazar)' : 'DRY-RUN (yazmaz)'}` +
    `${company ? `, şirket: ${company}` : ', tüm şirketler'}`);

  const snap = await query.get();
  const docs = snap.docs;
  console.log(`[archive-completed-orders] taşınacak tamamlanmış sipariş: ${docs.length}`);

  if (docs.length === 0) {
    console.log('[archive-completed-orders] taşınacak kayıt yok.');
    return;
  }

  if (!apply) {
    const sample = docs.slice(0, 5).map((d) => d.id);
    console.log('[archive-completed-orders] DRY-RUN — örnek id\'ler:', sample);
    console.log('[archive-completed-orders] Taşımak için --apply ekleyin.');
    return;
  }

  let moved = 0;
  for (let i = 0; i < docs.length; i += ORDERS_PER_BATCH) {
    const slice = docs.slice(i, i + ORDERS_PER_BATCH);
    const batch = db.batch();
    for (const d of slice) {
      const data = d.data();
      batch.set(db.collection(ORDERS_ARCHIVE_COLLECTION).doc(d.id), {
        ...data,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batch.delete(db.collection(ORDERS_COLLECTION).doc(d.id));
    }
    await batch.commit();
    moved += slice.length;
    console.log(`[archive-completed-orders] taşındı: ${moved}/${docs.length}`);
  }

  console.log(`[archive-completed-orders] TAMAM — ${moved} sipariş ordersArchive'a taşındı.`);
}

main().catch((err) => {
  console.error('[archive-completed-orders] HATA:', err);
  process.exit(1);
});
