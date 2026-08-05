/**
 * Multi-tenancy backfill script (Faz 1).
 *
 * companyId alanı eksik / boş / '__legacy__' olan dokümanlara
 * `--default-company-id` ile verilen tek bir şirket ID'sini atar.
 *
 * GÜVENLİK:
 *   - Default mode `--dry-run` (sadece raporlar, yazmaz).
 *   - Yazma için `--apply` flag'i şart.
 *   - Firestore batched writes (500/batch).
 *
 * Kullanım:
 *   node scripts/backfill-company-id.js --default-company-id <ID>
 *   node scripts/backfill-company-id.js --default-company-id <ID> --apply
 *   node scripts/backfill-company-id.js --from-audit reports/audit.json
 *   node scripts/backfill-company-id.js --from-audit reports/audit.json --apply
 *   node scripts/backfill-company-id.js --default-company-id <ID> \
 *     --collections devices,depots --apply
 *
 * Ortam:
 *   Firebase Studio / Cloud Shell / Compute Engine'de HİÇBİR ŞEY ayarlamayın —
 *   kimlik bilgisi ortamdan gelir, proje kimliği `.firebaserc`'den çözülür.
 *
 *   Yalnızca kendi makinenizde çalışıyorsanız bir anahtar gerekir:
 *     GOOGLE_APPLICATION_CREDENTIALS -> service account JSON'un GERÇEK yolu
 *   Var olmayan bir yol verilirse script ne yapılacağını söyleyerek durur.
 *
 *   FIREBASE_PROJECT_ID isteğe bağlıdır; verilmezse `.firebaserc` kullanılır.
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { initAdmin } = require('./lib/firebase-project');

const LEGACY_TAG = '__legacy__';
const BATCH_SIZE = 500;

const DEFAULT_COLLECTIONS = [
  // Tier 1
  'devices',
  'depots',
  'hospitals',
  'users',
  'depoStok',
  'hospitalDeviceAssignments',
  // Tier 2
  'purchasingTasks',
  'deviceGroups',
  'labPools',
  'addressDefinitions',
  'personnelAvailability',
  'deviceFaultReports',
  'deviceActionForms',
  'aplikasyonActionForms',
  'maintenancePlans',
  'maintenanceLogs',
  'deviceLabPools',
  // Tier 3 — filtresizler
  'tuketimKayitlari',
  'dailyConsumptionStats',
  'shipments',
  'efficiencyHistory',
  'productCodes',
  'barcodeFormats',
  'faultDefinitions',
  // Tier 4
  'depotStockCountSessions',
  'maliyetSayimSessions',
  'dutyShifts',
  'borcDepots',
  'notifications',
  'irsaliyeFiles',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    defaultCompanyId: null,
    fromAudit: null,
    apply: false,
    collections: DEFAULT_COLLECTIONS,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--default-company-id' && args[i + 1]) {
      out.defaultCompanyId = args[++i].trim();
    } else if (a === '--from-audit' && args[i + 1]) {
      out.fromAudit = args[++i];
    } else if (a === '--apply') {
      out.apply = true;
    } else if (a === '--dry-run') {
      out.apply = false;
    } else if (a === '--collections' && args[i + 1]) {
      out.collections = args[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/backfill-company-id.js --default-company-id <ID> [--apply]
  node scripts/backfill-company-id.js --from-audit <path> [--apply]
  node scripts/backfill-company-id.js --default-company-id <ID> --collections devices,depots [--apply]

Flags:
  --default-company-id <ID>   Legacy/missing docs bu şirkete atanır
  --from-audit <path>         audit-report.json'dan suggestedDefaultCompanyId okur
  --apply                     Gerçek yazma yapar (default: dry-run)
  --collections <a,b,c>       Koleksiyon alt kümesi
  --help                      Bu yardımı göster`);
}

// Kimlik bilgisi ve proje kimliği çözümü scripts/lib/firebase-project.js'te
// ortaklaştırıldı: eksik/yanlış GOOGLE_APPLICATION_CREDENTIALS durumunda ham
// ENOENT yerine ne yapılacağını söyleyen bir hata verir, proje kimliğini de
// env yoksa `.firebaserc`'den çözer.
function init() {
  return initAdmin(admin, { quiet: true });
}

function classify(raw) {
  if (raw === undefined || raw === null) return 'missing';
  const trimmed = String(raw).trim();
  if (!trimmed) return 'empty';
  if (trimmed === LEGACY_TAG) return 'legacy';
  return 'scoped';
}

function loadDefaultFromAudit(auditPath) {
  const abs = path.resolve(auditPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Audit dosyası bulunamadı: ${abs}`);
  }
  const data = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  if (!data || !data.suggestedDefaultCompanyId) {
    throw new Error(`Audit raporunda suggestedDefaultCompanyId yok: ${abs}`);
  }
  return data.suggestedDefaultCompanyId;
}

async function backfillCollection(db, name, defaultCompanyId, apply) {
  const stats = {
    collection: name,
    total: 0,
    skipped: 0, // zaten scoped olanlar
    updated: 0, // backfill'lenenler (apply=false ise "would be updated")
    error: null,
  };

  try {
    const snap = await db.collection(name).get();
    stats.total = snap.size;

    let batch = db.batch();
    let pending = 0;

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const raw = data.companyId !== undefined ? data.companyId : data.company;
      const cls = classify(raw);

      if (cls === 'scoped') {
        stats.skipped++;
        continue;
      }

      stats.updated++;

      if (!apply) continue; // dry-run: sayım yap, yazma

      batch.update(doc.ref, { companyId: defaultCompanyId });
      pending++;

      if (pending >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (apply && pending > 0) {
      await batch.commit();
    }
  } catch (err) {
    stats.error = err && err.message ? err.message : String(err);
  }

  return stats;
}

function fmt(s, apply) {
  if (s.error) return `  ${s.collection.padEnd(32)} ERROR: ${s.error}`;
  const verb = apply ? 'updated' : 'would-update';
  return (
    `  ${s.collection.padEnd(32)}` +
    ` total=${String(s.total).padStart(6)}` +
    ` ${verb}=${String(s.updated).padStart(6)}` +
    ` skipped=${String(s.skipped).padStart(6)}`
  );
}

async function main() {
  const opts = parseArgs();

  if (!opts.defaultCompanyId && opts.fromAudit) {
    opts.defaultCompanyId = loadDefaultFromAudit(opts.fromAudit);
    console.log(`Audit raporundan defaultCompanyId: ${opts.defaultCompanyId}`);
  }
  if (!opts.defaultCompanyId) {
    console.error('HATA: --default-company-id veya --from-audit gerekli.');
    printUsage();
    process.exit(1);
  }
  if (opts.defaultCompanyId === LEGACY_TAG) {
    console.error(`HATA: defaultCompanyId '${LEGACY_TAG}' olamaz.`);
    process.exit(1);
  }

  const { db, projectId } = init();
  const mode = opts.apply ? 'APPLY (gerçek yazma)' : 'DRY-RUN (yazma yok)';

  console.log(`Multi-tenancy backfill — ${new Date().toISOString()}`);
  console.log(`Project           : ${projectId}`);
  console.log(`Mode              : ${mode}`);
  console.log(`Default companyId : ${opts.defaultCompanyId}`);
  console.log(`Collections       : ${opts.collections.length}\n`);

  if (opts.apply) {
    console.log('⚠️  APPLY modu — Firestore yazılacak. 3 saniye içinde Ctrl+C ile iptal et.\n');
    await new Promise((r) => setTimeout(r, 3000));
  }

  const results = [];
  for (const c of opts.collections) {
    process.stdout.write(`  backfilling ${c}... `);
    const s = await backfillCollection(db, c, opts.defaultCompanyId, opts.apply);
    results.push(s);
    if (s.error) {
      process.stdout.write(`ERROR (${s.error})\n`);
    } else {
      process.stdout.write(
        `total=${s.total} ${opts.apply ? 'updated' : 'would-update'}=${s.updated} skipped=${s.skipped}\n`
      );
    }
  }

  console.log('\n=== DETAY ===');
  for (const s of results) console.log(fmt(s, opts.apply));

  let grandTotal = 0;
  let grandUpdated = 0;
  let grandSkipped = 0;
  for (const s of results) {
    if (s.error) continue;
    grandTotal += s.total;
    grandUpdated += s.updated;
    grandSkipped += s.skipped;
  }

  console.log('\n=== ÖZET ===');
  console.log(`  Toplam doküman             : ${grandTotal}`);
  console.log(`  Zaten scoped (atlandı)     : ${grandSkipped}`);
  console.log(`  ${opts.apply ? 'Güncellendi' : 'Güncellenecek (dry-run)'}    : ${grandUpdated}`);

  if (!opts.apply) {
    console.log('\nGerçek yazma için --apply ekle.');
  } else {
    console.log('\nBackfill tamamlandı. Faz 2 (custom claims) için hazır.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Hata:', err);
    process.exit(1);
  });
