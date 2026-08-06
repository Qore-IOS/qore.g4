/**
 * `awaiting_review` durumundaki işleri serbest bırakır.
 *
 * NEDEN GEREKLİ: `ORACLE_FILL_ONLY=1` modunda worker bir formu doldurduktan
 * sonra işi `awaiting_review` damgalar ve operatör panelden "Testi tamamla"
 * diyene kadar SIRADAKİ İŞİ ALMAZ. Bu kasıtlı — iki iş üst üste yazmasın diye —
 * ama peş peşe test yaparken her seferinde panele gitmek akışı kesiyor.
 *
 * Bu betik aynı işi komut satırından yapar: durumu `previewed`e çeker, worker
 * kuyruğa devam eder.
 *
 * Kullanım:
 *   release-review.bat            # bekleyenleri listeler ve serbest bırakır
 *   release-review.bat --listele  # yalnızca listeler, dokunmaz
 *
 * Gerçek gönderim modunda (`ORACLE_FILL_ONLY=0`) bu durum hiç oluşmaz.
 */
const admin = require('firebase-admin');

const COLLECTION = 'ceomedIrsaliyeGirisJobs';

const tirnaksiz = (v) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return /^(".*"|'.*')$/.test(t) ? t.slice(1, -1) : v;
};

async function main() {
  const projectId = tirnaksiz(process.env.FIREBASE_PROJECT_ID);
  const companyId = tirnaksiz(process.env.CEOMED_COMPANY_ID);
  const yalnizcaListele = process.argv.includes('--listele');

  if (!projectId) throw new Error('FIREBASE_PROJECT_ID tanımsız.');

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });
  const db = admin.firestore();

  let q = db.collection(COLLECTION).where('status', '==', 'awaiting_review');
  if (companyId) q = q.where('companyId', '==', companyId);
  const snap = await q.get();

  if (snap.empty) {
    console.log('İncelemede bekleyen iş yok — kuyruk zaten açık.');
    console.log('Form hâlâ dolmuyorsa worker loguna bakın; sebep başka.');
    return 0;
  }

  console.log(`İncelemede bekleyen ${snap.size} iş:\n`);
  snap.forEach((d) => {
    const v = d.data();
    console.log(`  ${d.id}`);
    console.log(`    İrsaliye No : ${v.irsaliyeNo || '(yok)'}`);
    console.log(`    Cari Kodu   : ${v.cariKodu || '(yok)'}`);
    console.log(`    Satır       : ${Array.isArray(v.satirlar) ? v.satirlar.length : 0}`);
    if (v.test) console.log('    (test kaydı)');
    if (v.screenshotPath) console.log(`    Görüntü     : ${v.screenshotPath}`);
    console.log('');
  });

  if (yalnizcaListele) {
    console.log('--listele verildi; hiçbir şey değiştirilmedi.');
    return 0;
  }

  // Toplu yazma: hepsi ya geçer ya hiçbiri. Yarım bırakılmış bir serbest
  // bırakma, kuyruğun neden tıkalı olduğunu anlamayı zorlaştırırdı.
  const batch = db.batch();
  snap.forEach((d) => {
    batch.update(d.ref, {
      status: 'previewed',
      reviewCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  console.log(`${snap.size} iş serbest bırakıldı (previewed).`);
  console.log('Worker sıradaki işi alacak. Ceomed formunu sürücü F6 ile kendisi temizler.');
  return 0;
}

main()
  .then((k) => process.exit(k))
  .catch((e) => {
    console.error(`[HATA] ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
