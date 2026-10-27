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
 *   APP_BASE_URL isteğe bağlıdır; verilmezse `.firebaserc` kullanılır.
 */
const admin = require('./db/script-store.cjs');
const { initAdmin } = require('./lib/database-project');
const { NEVER_SCOPE, discoverCollections } = require('./lib/tenant-collections');
const fs = require('fs');
const path = require('path');

const LEGACY_TAG = '__legacy__';


function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    output: 'audit-report.json',
    collections: null, // null => çalışma anında keşfet
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      out.output = args[++i];
    } else if (args[i] === '--collections' && args[i + 1]) {
      out.collections = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage:
  node scripts/audit-collections.js                          # TÜM koleksiyonlar (keşfedilir)
  node scripts/audit-collections.js --collections a,b,c      # alt küme
  node scripts/audit-collections.js --output reports/x.json  # rapor yolu`);
      process.exit(0);
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
  const { output, collections: requested } = parseArgs();
  const { db, projectId } = init();

  console.log(`Multi-tenancy audit — ${new Date().toISOString()}`);
  console.log(`Project: ${projectId}`);

  const collections = requested || (await discoverCollections(db));
  console.log(
    requested
      ? `Collections: ${collections.length} (--collections ile verildi)`
      : `Collections: ${collections.length} (keşfedildi — tüm kök koleksiyonlar)\n`
  );

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

  // Asıl sorulan soru: companyId'si olmayan kayıt HANGİ koleksiyonlarda?
  // Özet tablonun içinde kaybolmasın diye ayrıca ve sıralı olarak yazılır.
  const needsBackfill = results
    // NEVER_SCOPE hariç: def_* ortak tanım koleksiyonları ve `companies` kiracı
    // kütüğü kasıtlı olarak etiketsizdir. Burada listelenirlerse rapor "backfill
    // gerekiyor" der, backfill ise onlara dokunmaz — çelişkili bir çıktı olurdu.
    .filter((s) => !s.error && !NEVER_SCOPE.has(s.collection) && s.missing + s.empty + s.legacy > 0)
    .map((s) => ({
      collection: s.collection,
      unscoped: s.missing + s.empty + s.legacy,
      total: s.total,
      missing: s.missing,
      empty: s.empty,
      legacy: s.legacy,
    }))
    .sort((a, b) => b.unscoped - a.unscoped);

  console.log('\n=== companyId EKSİK OLAN KOLEKSİYONLAR (backfill gerekenler) ===');
  if (needsBackfill.length === 0) {
    console.log('  (Yok — taranan tüm koleksiyonlarda her belge etiketli.)');
  } else {
    for (const c of needsBackfill) {
      console.log(
        `  ${c.collection.padEnd(32)} ${String(c.unscoped).padStart(6)} / ${String(c.total).padEnd(6)}` +
          ` (missing=${c.missing} empty=${c.empty} legacy=${c.legacy})`
      );
    }
    console.log(`\n  Toplam ${needsBackfill.length} koleksiyon. Yalnızca bunları backfill'lemek için:`);
    console.log(`    --collections ${needsBackfill.map((c) => c.collection).join(',')}`);
  }

  const kastenEtiketsiz = results.filter(
    (s) => !s.error && NEVER_SCOPE.has(s.collection) && s.missing + s.empty + s.legacy > 0
  );
  if (kastenEtiketsiz.length > 0) {
    console.log('\n  Not — bunlar KASITLI olarak etiketsizdir, listeye dahil edilmedi:');
    console.log(`    ${kastenEtiketsiz.map((s) => s.collection).join(', ')}`);
    console.log('    (def_* ortak tanım koleksiyonları ve `companies` kiracı kütüğü)');
  }

  const erroredCollections = results.filter((s) => s.error).map((s) => s.collection);
  if (erroredCollections.length > 0) {
    console.log(`\n  UYARI — taranamayan ${erroredCollections.length} koleksiyon: ${erroredCollections.join(', ')}`);
    console.log('  Bunlar hakkında rapor bir şey söylemiyor; "temiz" anlamına GELMEZ.');
  }

  // JSON çıktı
  const outputPath = path.resolve(output);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const report = {
    generatedAt: new Date().toISOString(),
    projectId,
    grandTotal,
    grandScoped,
    grandUnscoped,
    globalDistribution,
    suggestedDefaultCompanyId: activeCompanies[0] ? activeCompanies[0][0] : null,
    // backfill scripti --from-audit ile bu listeyi okur; böylece kendi sabit
    // listesindeki bir eksik yüzünden koleksiyon atlanmaz.
    collectionsNeedingBackfill: needsBackfill.map((c) => c.collection),
    erroredCollections,
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
