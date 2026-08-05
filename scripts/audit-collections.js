/**
 * Multi-tenancy audit script.
 *
 * Hedef koleksiyonlardaki dokümanların `companyId` durumunu sayar. Hiçbir
 * yazma yapmaz; sadece okur ve rapor çıkarır.
 *
 * Çıktı:
 *   - Konsola özet tablo (her koleksiyon için: total, scoped, missing, empty, legacy)
 *   - JSON raporu (default: audit-report.json) — Faz 1 backfill scripti bunu
 *     girdi olarak kullanabilir.
 *
 * Default-company-id önerisi: Aktif (legacy olmayan) companyId'ler arasında
 * en çok dokümana sahip olan ID önerilir. Bu öneri OTOMATİK olarak kullanılmaz;
 * Faz 1 PR'ında manuel onayla seçilir.
 *
 * Kullanım:
 *   node scripts/audit-collections.js
 *   node scripts/audit-collections.js --output reports/audit-2026-05-23.json
 *   node scripts/audit-collections.js --collections devices,depots  # subset
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
const { initAdmin } = require('./lib/firebase-project');
const fs = require('fs');
const path = require('path');

const LEGACY_TAG = '__legacy__';

const DEFAULT_COLLECTIONS = [
  // Tier 1 — kritik
  'devices',
  'depots',
  'hospitals',
  'users',
  'depoStok',
  'hospitalDeviceAssignments',
  // Tier 2 — yüksek hacim
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
  // Tier 3 — filtresiz olanlar (raporda kırmızı işaretlenmiş)
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
    output: 'audit-report.json',
    collections: DEFAULT_COLLECTIONS,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      out.output = args[++i];
    } else if (args[i] === '--collections' && args[i + 1]) {
      out.collections = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return out;
}

// Kimlik bilgisi ve proje kimliği çözümü scripts/lib/firebase-project.js'te
// ortaklaştırıldı: eksik/yanlış GOOGLE_APPLICATION_CREDENTIALS durumunda ham
// ENOENT yerine ne yapılacağını söyleyen bir hata verir, proje kimliğini de
// env yoksa `.firebaserc`'den çözer.
function init() {
  return initAdmin(admin, { quiet: true });
}

function classifyCompanyId(raw) {
  if (raw === undefined || raw === null) return { kind: 'missing' };
  const trimmed = String(raw).trim();
  if (!trimmed) return { kind: 'empty' };
  if (trimmed === LEGACY_TAG) return { kind: 'legacy', value: LEGACY_TAG };
  return { kind: 'scoped', value: trimmed };
}

async function auditCollection(db, name) {
  const stats = {
    collection: name,
    total: 0,
    scoped: 0,
    missing: 0,
    empty: 0,
    legacy: 0,
    distribution: {},
    error: null,
  };

  try {
    const snap = await db.collection(name).get();
    stats.total = snap.size;
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const raw = data.companyId !== undefined ? data.companyId : data.company;
      const cls = classifyCompanyId(raw);
      if (cls.kind === 'missing') stats.missing++;
      else if (cls.kind === 'empty') stats.empty++;
      else if (cls.kind === 'legacy') {
        stats.legacy++;
        stats.distribution[LEGACY_TAG] = (stats.distribution[LEGACY_TAG] || 0) + 1;
      } else {
        stats.scoped++;
        stats.distribution[cls.value] = (stats.distribution[cls.value] || 0) + 1;
      }
    });
  } catch (err) {
    stats.error = err && err.message ? err.message : String(err);
  }

  return stats;
}

function pct(part, total) {
  if (!total) return '0.0';
  return ((part / total) * 100).toFixed(1);
}

function formatRow(s) {
  if (s.error) {
    return `  ${s.collection.padEnd(32)} ERROR: ${s.error}`;
  }
  const unscoped = s.missing + s.empty + s.legacy;
  return (
    `  ${s.collection.padEnd(32)}` +
    ` total=${String(s.total).padStart(6)}` +
    ` scoped=${String(s.scoped).padStart(6)}` +
    ` missing=${String(s.missing).padStart(5)}` +
    ` empty=${String(s.empty).padStart(5)}` +
    ` legacy=${String(s.legacy).padStart(5)}` +
    ` unscoped%=${pct(unscoped, s.total).padStart(5)}`
  );
}

async function main() {
  const { output, collections } = parseArgs();
  const { db, projectId } = init();

  console.log(`Multi-tenancy audit — ${new Date().toISOString()}`);
  console.log(`Project: ${projectId}`);
  console.log(`Collections: ${collections.length}\n`);

  const results = [];
  for (const c of collections) {
    process.stdout.write(`  scanning ${c}... `);
    const stats = await auditCollection(db, c);
    results.push(stats);
    if (stats.error) {
      process.stdout.write(`ERROR (${stats.error})\n`);
    } else {
      const unscoped = stats.missing + stats.empty + stats.legacy;
      process.stdout.write(`total=${stats.total} unscoped=${unscoped} (${pct(unscoped, stats.total)}%)\n`);
    }
  }

  console.log('\n=== DETAY ===');
  for (const s of results) console.log(formatRow(s));

  // Global özet
  const globalDistribution = {};
  let grandTotal = 0;
  let grandUnscoped = 0;
  let grandScoped = 0;
  for (const s of results) {
    if (s.error) continue;
    grandTotal += s.total;
    grandScoped += s.scoped;
    grandUnscoped += s.missing + s.empty + s.legacy;
    for (const [k, v] of Object.entries(s.distribution)) {
      globalDistribution[k] = (globalDistribution[k] || 0) + v;
    }
  }

  console.log('\n=== ÖZET ===');
  console.log(`  Toplam doküman      : ${grandTotal}`);
  console.log(`  Scoped (companyId+) : ${grandScoped} (${pct(grandScoped, grandTotal)}%)`);
  console.log(`  Unscoped            : ${grandUnscoped} (${pct(grandUnscoped, grandTotal)}%)`);

  const activeCompanies = Object.entries(globalDistribution)
    .filter(([id]) => id !== LEGACY_TAG)
    .sort(([, a], [, b]) => b - a);

  console.log('\n=== AKTİF ŞİRKETLER (doc sayısına göre) ===');
  if (activeCompanies.length === 0) {
    console.log('  (Hiç aktif companyId bulunamadı — default-company manuel oluşturulmalı)');
  } else {
    for (const [id, count] of activeCompanies) {
      console.log(`  ${id.padEnd(40)} ${count}`);
    }
    console.log(`\nÖneri: Faz 1 backfill'inde default-company-id olarak en çok dokümana sahip olan kullanılabilir:`);
    console.log(`  → ${activeCompanies[0][0]} (${activeCompanies[0][1]} doc)`);
    console.log(`  (Bu yalnızca bir öneridir; Faz 1 PR'ında manuel onayla seçilmelidir.)`);
  }

  // JSON çıktı
  const outputPath = path.resolve(output);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const report = {
    generatedAt: new Date().toISOString(),
    projectId: process.env.FIREBASE_PROJECT_ID || null,
    grandTotal,
    grandScoped,
    grandUnscoped,
    globalDistribution,
    suggestedDefaultCompanyId: activeCompanies[0] ? activeCompanies[0][0] : null,
    results,
  };
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nRapor kaydedildi: ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Hata:', err);
    process.exit(1);
  });
