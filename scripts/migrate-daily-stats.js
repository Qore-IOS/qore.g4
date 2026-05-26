/**
 * Multi-tenancy migration script for dailyConsumptionStats — Phase 2-M.
 *
 * Bu script eski `${dateKey}` formatındaki dokümanları yeni
 * `${companyId}_${dateKey}` formatına dönüştürür.
 *
 * Mantık:
 *   1. dailyConsumptionStats koleksiyonunu tara
 *   2. docId 'YYYY-MM-DD' deseninde ise (eski format) → atla veya silmek için
 *      --delete-legacy kullan
 *   3. Aynı tarih için her tenant'a yeni doc üret (companyId-bazlı
 *      tuketimKayitlari'ndan recalc)
 *
 * Güvenli tasarım:
 *   - Default `--dry-run`
 *   - `--apply` ile gerçek yazma
 *   - `--delete-legacy` ile eski docs'ları sil (yeni docs yazıldıktan sonra)
 *
 * Kullanım:
 *   node scripts/migrate-daily-stats.js --days 365              # dry-run
 *   node scripts/migrate-daily-stats.js --days 365 --apply
 *   node scripts/migrate-daily-stats.js --days 365 --apply --delete-legacy
 *
 * Env: GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID
 */
const admin = require('firebase-admin');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { days: 365, apply: false, deleteLegacy: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) out.days = parseInt(args[++i], 10);
    else if (args[i] === '--apply') out.apply = true;
    else if (args[i] === '--delete-legacy') out.deleteLegacy = true;
    else if (args[i] === '--help') {
      console.log(`Usage: node scripts/migrate-daily-stats.js [--days N] [--apply] [--delete-legacy]`);
      process.exit(0);
    }
  }
  return out;
}

function init() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
  return admin.firestore();
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

async function discoverCompanies(db) {
  const snap = await db.collection('users').get();
  const companies = new Set();
  snap.forEach((doc) => {
    const cid = doc.data().companyId;
    if (typeof cid === 'string' && cid.trim()) companies.add(cid.trim());
  });
  return Array.from(companies);
}

async function computeDailyStatsForCompany(db, date, companyId) {
  const dayStart = admin.firestore.Timestamp.fromDate(startOfDay(date));
  const dayEnd = admin.firestore.Timestamp.fromDate(endOfDay(date));

  const snap = await db.collection('tuketimKayitlari')
    .where('companyId', '==', companyId)
    .where('consumptionTimestamp', '>=', dayStart)
    .where('consumptionTimestamp', '<=', dayEnd)
    .get();

  const byLab = {};
  let totalCount = 0;

  snap.docs.forEach((d) => {
    const data = d.data();
    const labId = data.laboratoryId || 'unknown';
    byLab[labId] = (byLab[labId] || 0) + 1;
    totalCount++;
  });

  return { totalCount, byLab };
}

function isLegacyDocId(id) {
  return /^\d{4}-\d{2}-\d{2}$/.test(id);
}

async function main() {
  const opts = parseArgs();
  const db = init();

  console.log(`dailyConsumptionStats migration — ${new Date().toISOString()}`);
  console.log(`Mode: ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Days: ${opts.days}`);
  console.log(`Delete legacy: ${opts.deleteLegacy}\n`);

  if (opts.apply) {
    console.log('⚠️  3 saniye içinde Ctrl+C ile iptal et.\n');
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 1) Discover all tenants
  const companies = await discoverCompanies(db);
  console.log(`Discovered ${companies.length} companies: ${companies.join(', ')}\n`);

  // 2) For each company × date, write new doc
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - opts.days * 24 * 60 * 60 * 1000);

  const counters = { newDocs: 0, written: 0, skipped: 0, error: 0 };

  for (const companyId of companies) {
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateKey = formatDateKey(d);
      const newDocId = `${companyId}_${dateKey}`;
      counters.newDocs++;

      try {
        const stats = await computeDailyStatsForCompany(db, new Date(d), companyId);
        if (stats.totalCount === 0) {
          counters.skipped++;
          continue;
        }

        if (opts.apply) {
          await db.collection('dailyConsumptionStats').doc(newDocId).set({
            date: dateKey,
            companyId,
            totalCount: stats.totalCount,
            byLab: stats.byLab,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        counters.written++;

        if (counters.newDocs % 50 === 0) {
          process.stdout.write(`  ${companyId} ${dateKey} written=${counters.written} skipped=${counters.skipped}\n`);
        }
      } catch (err) {
        counters.error++;
        console.error(`  ${companyId} ${dateKey} ERROR: ${err.message || err}`);
      }
    }
  }

  // 3) Delete legacy docs (sadece --delete-legacy ile)
  if (opts.deleteLegacy && opts.apply) {
    console.log('\nDeleting legacy docs (dateKey-only id)...');
    const allSnap = await db.collection('dailyConsumptionStats').get();
    let deleted = 0;
    for (const doc of allSnap.docs) {
      if (isLegacyDocId(doc.id)) {
        await doc.ref.delete();
        deleted++;
      }
    }
    console.log(`Legacy docs deleted: ${deleted}`);
  }

  console.log('\n=== ÖZET ===');
  console.log(`  Toplam (company × date) kombinasyon : ${counters.newDocs}`);
  console.log(`  ${opts.apply ? 'Yazıldı' : 'Yazılacak'}                     : ${counters.written}`);
  console.log(`  Skipped (0 consumption)             : ${counters.skipped}`);
  console.log(`  Error                               : ${counters.error}`);

  if (!opts.apply) console.log('\nGerçek yazma için --apply ekle.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Hata:', err);
    process.exit(1);
  });
