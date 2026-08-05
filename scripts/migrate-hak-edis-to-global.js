/**
 * Eski `hospitals/{labId}/hakEdisDefinitions` subcollection'larını yeni global
 * `testDefinitions` koleksiyonuna taşır.
 *
 * Çakışma kuralı (dedup key): `sutKodu`. Aynı sutKodu farklı lab'larda varsa,
 * `linkedStokKodu`'lar `linkedStokKodlari` array'inde birleştirilir.
 * `sutTestAdi` ve `hakEdisMiktari` ilk gördüğümüz satırdan alınır; sonraki
 * çakışmalarda farklılık varsa konsola uyarı düşülür (manuel inceleme gerekir).
 *
 * Eski subcollection'lar SİLİNMEZ, sadece her belgenin başına
 * `_migrated_to_global: true, _migrated_at: <ISO>` etiketi yazılır;
 * istenirse sonradan `--archive` flag'iyle ayrı koleksiyona taşınır.
 *
 * Kullanım:
 *   node scripts/migrate-hak-edis-to-global.js --dry-run
 *   node scripts/migrate-hak-edis-to-global.js          # gerçek yazım
 *   node scripts/migrate-hak-edis-to-global.js --archive
 *
 * Gerekli env:
 *   GOOGLE_APPLICATION_CREDENTIALS  -> service account JSON path
 *   FIREBASE_PROJECT_ID
 */
const admin = require('firebase-admin');
const { initAdmin } = require('./lib/firebase-project');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ARCHIVE = args.includes('--archive');

// Kimlik bilgisi ve proje kimliği çözümü scripts/lib/firebase-project.js'te
// ortaklaştırıldı: eksik/yanlış GOOGLE_APPLICATION_CREDENTIALS durumunda ham
// ENOENT yerine ne yapılacağını söyleyen bir hata verir, proje kimliğini de
// env yoksa `.firebaserc`'den çözer.
function init() {
  return initAdmin(admin, { quiet: true }).db;
}

async function main() {
  const db = init();
  const nowIso = new Date().toISOString();

  console.log(`[migration] mode: ${DRY_RUN ? 'DRY-RUN' : 'WRITE'}${ARCHIVE ? ' + ARCHIVE' : ''}`);

  // 1) Tüm hospitals altındaki hakEdisDefinitions belgelerini topla
  const hospitalsSnap = await db.collection('hospitals').get();
  console.log(`[migration] ${hospitalsSnap.size} hastane/lab taranacak`);

  /**
   * dedupMap: sutKodu -> {
   *   sutKodu, sutTestAdi, hakEdisMiktari, currency,
   *   linkedStokKodlari: Set<string>, sources: [{labId, docId}], companyIds: Set
   * }
   */
  const dedupMap = new Map();
  const sourceDocs = []; // [{labId, docId, data}]

  for (const labDoc of hospitalsSnap.docs) {
    const labId = labDoc.id;
    const subSnap = await labDoc.ref.collection('hakEdisDefinitions').get();
    if (subSnap.empty) continue;
    console.log(`  - ${labId}: ${subSnap.size} tanım`);

    for (const d of subSnap.docs) {
      const data = d.data() || {};
      sourceDocs.push({ labId, docId: d.id, data });

      const sutKodu = String(data.sutKodu || '').trim();
      const sutTestAdi = String(data.sutTestAdi || '').trim();
      const linkedStokKodu = String(data.linkedStokKodu || '').trim();
      const hakEdisMiktari = Number(data.hakEdisMiktari) || 0;
      const currency = data.currency || 'TRY';
      const companyId = data.companyId || null;

      if (!sutKodu || !linkedStokKodu || hakEdisMiktari <= 0) {
        console.warn(`    [skip] ${labId}/${d.id}: eksik alan (${JSON.stringify(data)})`);
        continue;
      }

      let entry = dedupMap.get(sutKodu);
      if (!entry) {
        entry = {
          sutKodu,
          sutTestAdi,
          hakEdisMiktari,
          currency,
          linkedStokKodlari: new Set(),
          sources: [],
          companyIds: new Set(),
        };
        dedupMap.set(sutKodu, entry);
      } else {
        // Çakışma uyarıları
        if (entry.sutTestAdi !== sutTestAdi) {
          console.warn(
            `    [warn] ${sutKodu}: sutTestAdi farkı ("${entry.sutTestAdi}" vs "${sutTestAdi}") — ilk değer korunuyor`,
          );
        }
        if (entry.hakEdisMiktari !== hakEdisMiktari) {
          console.warn(
            `    [warn] ${sutKodu}: hakEdisMiktari farkı (${entry.hakEdisMiktari} vs ${hakEdisMiktari}) — ilk değer korunuyor`,
          );
        }
      }

      entry.linkedStokKodlari.add(linkedStokKodu);
      entry.sources.push({ labId, docId: d.id });
      if (companyId) entry.companyIds.add(companyId);
    }
  }

  console.log(`[migration] dedup sonrası ${dedupMap.size} unique testDefinition oluştu`);

  // 2) Yeni `testDefinitions` koleksiyonunda zaten var olan sutKodu'ları kontrol et
  const existingSnap = await db.collection('testDefinitions').get();
  const existingByKey = new Map();
  existingSnap.docs.forEach((d) => existingByKey.set(d.data().sutKodu, { id: d.id, data: d.data() }));
  console.log(`[migration] hedef koleksiyonda halen ${existingSnap.size} kayıt var`);

  // 3) Yazım planı
  const toCreate = [];
  const toMerge = [];
  for (const entry of dedupMap.values()) {
    const existing = existingByKey.get(entry.sutKodu);
    if (existing) {
      const existingSet = new Set(existing.data.linkedStokKodlari || []);
      const newKodlar = Array.from(entry.linkedStokKodlari).filter((k) => !existingSet.has(k));
      if (newKodlar.length === 0) {
        console.log(`  [skip] ${entry.sutKodu} zaten mevcut ve ürün listesi aynı`);
        continue;
      }
      toMerge.push({ id: existing.id, addStokKodlari: newKodlar, entry });
    } else {
      toCreate.push(entry);
    }
  }
  console.log(`[migration] ${toCreate.length} yeni, ${toMerge.length} merge planlandı`);

  if (DRY_RUN) {
    console.log('[migration] DRY-RUN — değişiklik yazılmadı');
    return;
  }

  // 4) Yaz
  let batch = db.batch();
  let batchCount = 0;
  const flushBatch = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  for (const entry of toCreate) {
    const ref = db.collection('testDefinitions').doc();
    const data = {
      sutKodu: entry.sutKodu,
      sutTestAdi: entry.sutTestAdi,
      linkedStokKodlari: Array.from(entry.linkedStokKodlari),
      hakEdisMiktari: entry.hakEdisMiktari,
      currency: entry.currency || 'TRY',
      aktif: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: null,
      createdByName: 'migration-script',
      companyId: entry.companyIds.size === 1 ? Array.from(entry.companyIds)[0] : null,
      migratedFromLabs: entry.sources.map((s) => s.labId),
    };
    batch.set(ref, data);
    batchCount++;
    if (batchCount >= 450) await flushBatch();
  }

  for (const m of toMerge) {
    const ref = db.collection('testDefinitions').doc(m.id);
    batch.update(ref, {
      linkedStokKodlari: admin.firestore.FieldValue.arrayUnion(...m.addStokKodlari),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batchCount++;
    if (batchCount >= 450) await flushBatch();
  }
  await flushBatch();

  console.log(`[migration] yazım tamamlandı (${toCreate.length} yeni, ${toMerge.length} merge)`);

  // 5) Source belgeleri etiketle
  let tagBatch = db.batch();
  let tagCount = 0;
  for (const s of sourceDocs) {
    const ref = db.collection('hospitals').doc(s.labId).collection('hakEdisDefinitions').doc(s.docId);
    tagBatch.update(ref, { _migrated_to_global: true, _migrated_at: nowIso });
    tagCount++;
    if (tagCount >= 450) {
      await tagBatch.commit();
      tagBatch = db.batch();
      tagCount = 0;
    }
  }
  if (tagCount > 0) await tagBatch.commit();
  console.log(`[migration] ${sourceDocs.length} kaynak doküman etiketlendi`);

  // 6) (Opsiyonel) arşive taşı
  if (ARCHIVE) {
    let arBatch = db.batch();
    let arCount = 0;
    for (const s of sourceDocs) {
      const fromRef = db.collection('hospitals').doc(s.labId).collection('hakEdisDefinitions').doc(s.docId);
      const toRef = db
        .collection('hospitals')
        .doc(s.labId)
        .collection('_archive_hakEdisDefinitions')
        .doc(s.docId);
      arBatch.set(toRef, { ...s.data, _archived_at: nowIso });
      arBatch.delete(fromRef);
      arCount++;
      if (arCount >= 200) {
        // 200 ops × 2 ≈ 400 batch ops
        await arBatch.commit();
        arBatch = db.batch();
        arCount = 0;
      }
    }
    if (arCount > 0) await arBatch.commit();
    console.log(`[migration] ${sourceDocs.length} kaynak doküman arşive taşındı`);
  }
}

main()
  .then(() => {
    console.log('[migration] DONE');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[migration] FAILED', e);
    process.exit(1);
  });
