/**
 * Tek seferlik backfill: mevcut pendingCeomedIrsaliye + ceomedDepoStok
 * dokümanlarına companyId tag'i yazar.
 *
 * Multi-tenancy migrasyonundan ÖNCE Ceomed sync tarafından yazılmış
 * kayıtlar companyId taşımıyor; bu yüzden non-superadmin panel
 * sorguları (scopedQuery — where('companyId', '==', X)) onları
 * göstermiyordu. Bu script eski kayıtları doğru tenant'a tag'ler;
 * çalıştırıldıktan sonra panel hiçbir client-side legacy uyarısı
 * olmaksızın eski + yeni tüm irsaliyeleri görür.
 *
 * Kullanım:
 *   set -a; source .env; set +a
 *   node backfillCompanyId.js
 *
 * Gerekli env:
 *   GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID
 *   CEOMED_COMPANY_ID  (pendingCeomedIrsaliye için bu env kullanılır)
 *
 * ceomedDepoStok: her doküman bir depot.id ile eşleştiği için companyId
 * önce depot dokümanından okunur, yoksa CEOMED_COMPANY_ID fallback olur.
 *
 * Idempotent: companyId zaten yazılmış kayıtlar atlanır.
 */
const admin = require('firebase-admin');

function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  return admin.firestore();
}

async function backfillPendingIrsaliye(db, companyId) {
  const snap = await db.collection('pendingCeomedIrsaliye').get();
  let tagged = 0;
  let skipped = 0;
  let conflicts = 0;
  const batchSize = 400;
  let batch = db.batch();
  let pending = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const existingTag = (data.companyId || '').trim();
    if (existingTag && existingTag !== '__legacy__') {
      if (existingTag === companyId) {
        skipped++;
      } else {
        conflicts++;
        console.warn(
          `  CONFLICT ${docSnap.id} (${data.irsaliyeNo || '-'}): companyId=${existingTag} (env=${companyId}) — atlandı.`
        );
      }
      continue;
    }
    batch.update(docSnap.ref, { companyId });
    tagged++;
    pending++;
    if (pending >= batchSize) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  console.log(
    `pendingCeomedIrsaliye: ${tagged} tag'lendi, ${skipped} zaten doğru tag'liydi, ${conflicts} farklı firmaya ait (atlandı).`
  );
}

async function backfillCeomedDepoStok(db, fallbackCompanyId) {
  const depotsSnap = await db.collection('depots').get();
  const depotCompanyMap = new Map();
  for (const d of depotsSnap.docs) {
    const cid = (d.data().companyId || '').trim();
    if (cid && cid !== '__legacy__') depotCompanyMap.set(d.id, cid);
  }

  const stokSnap = await db.collection('ceomedDepoStok').get();
  let tagged = 0;
  let skipped = 0;
  let unresolved = 0;
  let conflicts = 0;
  const batchSize = 400;
  let batch = db.batch();
  let pending = 0;

  for (const docSnap of stokSnap.docs) {
    const data = docSnap.data();
    const existingTag = (data.companyId || '').trim();
    const depotId = data.depotId || docSnap.id;
    const expectedTag = depotCompanyMap.get(depotId) || fallbackCompanyId;

    if (!expectedTag) {
      unresolved++;
      console.warn(
        `  UNRESOLVED ${docSnap.id}: depot.companyId yok ve CEOMED_COMPANY_ID env boş — atlandı.`
      );
      continue;
    }

    if (existingTag && existingTag !== '__legacy__') {
      if (existingTag === expectedTag) {
        skipped++;
      } else {
        conflicts++;
        console.warn(
          `  CONFLICT ${docSnap.id}: companyId=${existingTag} (beklenen=${expectedTag}) — atlandı.`
        );
      }
      continue;
    }

    batch.update(docSnap.ref, { companyId: expectedTag });
    tagged++;
    pending++;
    if (pending >= batchSize) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  console.log(
    `ceomedDepoStok: ${tagged} tag'lendi, ${skipped} zaten doğru tag'liydi, ${conflicts} çakışma, ${unresolved} çözülemedi.`
  );
}

async function run() {
  const companyId = (process.env.CEOMED_COMPANY_ID || '').trim();
  if (!companyId) {
    throw new Error(
      'CEOMED_COMPANY_ID env değişkeni zorunlu — pendingCeomedIrsaliye için bu tag yazılır.'
    );
  }

  const db = initFirestore();
  console.log(`Backfill başlıyor (companyId=${companyId})...`);
  await backfillPendingIrsaliye(db, companyId);
  await backfillCeomedDepoStok(db, companyId);
  console.log('Backfill tamamlandı.');
}

if (require.main === module) {
  run().catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
  });
}

module.exports = { run };
