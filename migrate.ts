/**
 * Multi-tenancy migration script
 * Tüm Firestore dokümanlarına companyId: "ISLAB2" ekler
 *
 * Çalıştır: npx tsx migrate.ts
 */

import * as admin from 'firebase-admin';

const LEGACY_COMPANY_ID = 'ISLAB2';
const BATCH_SIZE = 400;

const TENANT_COLLECTIONS = [
  'hospitals', 'depots', 'depoStok', 'devices', 'deviceFaultReports',
  'tuketimKayitlari', 'orders', 'shipments', 'transfers', 'borcTransfers',
  'borcDepots', 'labPools', 'deviceLabPools', 'personalStock',
  'poolWarehouseStock', 'consumableRequests', 'purchasingTasks',
  'purchasingTaskDefinitions', 'stockCounts', 'depotCountSessions',
  'depotBrandCountSessions', 'addressDefinitions', 'deviceActionForms',
  'teknikServisActionForms', 'aplikasyonActionForms', 'ejectedKitRecords',
  'destroyedKitsReports', 'trashBinRecords', 'effecticiencyHistory',
  'totalEfficiencyRecords', 'cihazUstuGecmisi', 'yedekParcaDepoStok',
  'yedek_parca', 'partChanges', 'periodicPartChangeLogs', 'draftActionForms',
  'minMaxHistory', 'archiveRacks', 'faultDefinitions', 'assetCategories',
  'assets', 'assetHistory', 'config_hospitals', 'def_brands',
  'def_deviceGroups', 'def_labGroups', 'def_mainUnits', 'def_productGroups',
  'def_testGroups', 'overtimeRequests', 'dutyShifts', 'shiftSchedules',
  'personnelAvailability', 'personnelHistoryLogs', 'personelGruplari',
  'routes', 'notificationLogs', 'pushTokens', 'users', 'notifications',
];

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const db = admin.firestore();

async function migrate() {
  console.log('=== Multi-tenancy Migration Başlıyor ===\n');

  // ISLAB2 şirketini oluştur
  const companyRef = db.doc(`companies/${LEGACY_COMPANY_ID}`);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) {
    await companyRef.set({
      id: LEGACY_COMPANY_ID,
      name: LEGACY_COMPANY_ID,
      displayName: 'ISLAB Tıbbi Sistemler',
      isLegacy: true,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'migration_script',
      description: 'Sistemin kuruluş şirketi - migration ile oluşturuldu',
    });
    console.log('✓ ISLAB2 şirketi oluşturuldu\n');
  } else {
    console.log('✓ ISLAB2 şirketi zaten var\n');
  }

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const collectionName of TENANT_COLLECTIONS) {
    const snap = await db.collection(collectionName).get();

    if (snap.empty) {
      console.log(`  ${collectionName}: boş, atlandı`);
      continue;
    }

    let batch = db.batch();
    let batchCount = 0;
    let updated = 0;
    let skipped = 0;

    for (const doc of snap.docs) {
      if (doc.data().companyId) {
        skipped++;
        continue;
      }
      batch.update(doc.ref, { companyId: LEGACY_COMPANY_ID });
      batchCount++;
      updated++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();

    totalUpdated += updated;
    totalSkipped += skipped;
    console.log(`  ${collectionName}: ${updated} güncellendi, ${skipped} atlandı`);
  }

  console.log('\n=== Migration Tamamlandı ===');
  console.log(`Toplam güncellenen: ${totalUpdated}`);
  console.log(`Toplam atlanan:     ${totalSkipped}`);
}

migrate().catch(err => {
  console.error('HATA:', err.message);
  process.exit(1);
});
