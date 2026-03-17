/**
 * POST /api/admin/migrate-to-multitenancy
 *
 * Bu endpoint, mevcut tüm Firestore dokümanlarına companyId: "ISLAB2" ekler
 * ve ISLAB2 adında bir legacy şirket oluşturur.
 *
 * SADECE BİR KEZ ÇALIŞTIRILMALI! Migration tamamlandıktan sonra
 * tekrar çalıştırmayın.
 *
 * Güvenlik: Firebase Admin SDK ile sadece backend'den erişilebilir.
 * Request body'de adminSecret gönderin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const LEGACY_COMPANY_ID = 'ISLAB2';
const BATCH_SIZE = 400; // Firestore batch limit is 500, keep margin

// Collections that get companyId: ISLAB2
// NOTE: productCodes and barcodeFormats are SHARED - do NOT add companyId to them
const TENANT_COLLECTIONS = [
  'hospitals',
  'depots',
  'depoStok',
  'devices',
  'deviceFaultReports',
  'tuketimKayitlari',
  'orders',
  'shipments',
  'transfers',
  'borcTransfers',
  'borcDepots',
  'labPools',
  'deviceLabPools',
  'personalStock',
  'poolWarehouseStock',
  'consumableRequests',
  'purchasingTasks',
  'purchasingTaskDefinitions',
  'stockCounts',
  'depotCountSessions',
  'depotBrandCountSessions',
  'addressDefinitions',
  'deviceActionForms',
  'teknikServisActionForms',
  'aplikasyonActionForms',
  'ejectedKitRecords',
  'destroyedKitsReports',
  'trashBinRecords',
  'effecticiencyHistory',
  'totalEfficiencyRecords',
  'cihazUstuGecmisi',
  'yedekParcaDepoStok',
  'yedek_parca',
  'partChanges',
  'periodicPartChangeLogs',
  'draftActionForms',
  'minMaxHistory',
  'archiveRacks',
  'faultDefinitions',
  'assetCategories',
  'assets',
  'assetHistory',
  'config_hospitals',
  'def_brands',
  'def_deviceGroups',
  'def_labGroups',
  'def_mainUnits',
  'def_productGroups',
  'def_testGroups',
  'overtimeRequests',
  'dutyShifts',
  'shiftSchedules',
  'personnelAvailability',
  'personnelHistoryLogs',
  'personelGruplari',
  'routes',
  'notificationLogs',
  'pushTokens',
  'users',
  // notification collections
  'notifications',
];

async function migrateCollection(
  collectionName: string,
  results: { collection: string; updated: number; skipped: number; errors: string[] }
) {
  const collRef = adminDb.collection(collectionName);
  const snap = await collRef.get();

  if (snap.empty) {
    results.skipped++;
    return;
  }

  const docs = snap.docs;
  let batchCount = 0;
  let batch = adminDb.batch();

  for (const docSnap of docs) {
    const data = docSnap.data();

    // Skip if already has companyId
    if (data.companyId) {
      results.skipped++;
      continue;
    }

    batch.update(docSnap.ref, { companyId: LEGACY_COMPANY_ID });
    batchCount++;
    results.updated++;

    // Commit batch when reaching limit
    if (batchCount >= BATCH_SIZE) {
      await batch.commit();
      batch = adminDb.batch();
      batchCount = 0;
    }
  }

  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
  }
}

export async function POST(request: NextRequest) {
  try {
    // Security check: require admin secret
    const body = await request.json().catch(() => ({}));
    const adminSecret = body.adminSecret || request.headers.get('x-admin-secret');

    if (!adminSecret || adminSecret !== process.env.MIGRATION_ADMIN_SECRET) {
      return NextResponse.json(
        { error: 'Unauthorized. Provide valid adminSecret.' },
        { status: 401 }
      );
    }

    const dryRun = body.dryRun === true;
    const collectionsToProcess = body.collections || TENANT_COLLECTIONS;

    const summary: {
      collection: string;
      updated: number;
      skipped: number;
      errors: string[];
    }[] = [];

    // Step 1: Create ISLAB2 company document (if not exists)
    if (!dryRun) {
      const companyRef = adminDb.doc(`companies/${LEGACY_COMPANY_ID}`);
      const companySnap = await companyRef.get();

      if (!companySnap.exists) {
        await companyRef.set({
          id: LEGACY_COMPANY_ID,
          name: LEGACY_COMPANY_ID,
          displayName: 'ISLAB Tıbbi Sistemler',
          isLegacy: true,
          isActive: true,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'migration_system',
          description: 'Sistemin kuruluş şirketi - migration ile oluşturuldu',
        });
      }
    }

    // Step 2: Add companyId to all tenant documents
    for (const collectionName of collectionsToProcess) {
      const result = {
        collection: collectionName,
        updated: 0,
        skipped: 0,
        errors: [] as string[],
      };

      if (dryRun) {
        // Just count what would be updated
        try {
          const snap = await adminDb.collection(collectionName).get();
          for (const d of snap.docs) {
            if (d.data().companyId) {
              result.skipped++;
            } else {
              result.updated++;
            }
          }
        } catch (err: any) {
          result.errors.push(err.message);
        }
      } else {
        try {
          await migrateCollection(collectionName, result);
        } catch (err: any) {
          result.errors.push(`${collectionName}: ${err.message}`);
        }
      }

      summary.push(result);
    }

    const totalUpdated = summary.reduce((acc, s) => acc + s.updated, 0);
    const totalSkipped = summary.reduce((acc, s) => acc + s.skipped, 0);
    const totalErrors = summary.flatMap(s => s.errors);

    return NextResponse.json({
      success: true,
      dryRun,
      legacyCompanyId: LEGACY_COMPANY_ID,
      totalUpdated,
      totalSkipped,
      totalErrors,
      summary,
      message: dryRun
        ? `DRY RUN: ${totalUpdated} döküman güncellenecek, ${totalSkipped} döküman zaten companyId'ye sahip.`
        : `Migration tamamlandı. ${totalUpdated} döküman güncellendi, ${totalSkipped} döküman atlandı.`,
    });
  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: error.message || 'Migration failed' },
      { status: 500 }
    );
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    endpoint: 'migrate-to-multitenancy',
    legacyCompanyId: LEGACY_COMPANY_ID,
    collectionsCount: TENANT_COLLECTIONS.length,
    usage: 'POST with { adminSecret, dryRun?: boolean, collections?: string[] }',
    warning: 'Bu işlemi sadece bir kez çalıştırın!',
  });
}
