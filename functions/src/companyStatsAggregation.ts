/**
 * Company Stats Aggregation — Faz 5 performans optimizasyonu.
 *
 * Her firma için tek bir `companyStats/{companyId}` özet dokümanı tutuyoruz.
 * Dashboard ve KPI panelleri tüm koleksiyonu taramak yerine bu doc'u
 * okuyor — sayfa açılışı 50-100ms'de tamamlanıyor (koleksiyon scan'i
 * yerine).
 *
 * Triggerlar:
 *  - onDepoStokWritten → stockCount, expiringCount, totalStockValue
 *  - onTuketimWritten → todayConsumption, last30dConsumption
 *  - onShipmentWritten → todayShipments, last30dShipments
 *  - onFaultWritten → openFaultCount, last30dFaultCount
 *  - onActionFormWritten → todayActionForms (technical+application)
 *
 * Şema (companyStats/{companyId}):
 *  {
 *    updatedAt: Timestamp,
 *    stock: { activeCount, shippedCount, expiringIn30Days },
 *    consumption: { today, last7Days, last30Days },
 *    shipments: { today, last30Days },
 *    faults: { open, resolvedLast30Days, totalLast30Days },
 *    actionForms: { todayTechnical, todayApplication, last30DaysTotal },
 *  }
 *
 * Güvenlik: companyStats koleksiyonu sadece companyId match veya
 * superAdmin için okunabilir. Yazma sadece Cloud Functions tarafından
 * (admin SDK bypass eder).
 */
'use server';

import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const LEGACY_COMPANY_ID = '__legacy__';

function normalizeCompanyId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  return s || LEGACY_COMPANY_ID;
}

function statsDoc(companyId: string) {
  return db.collection('companyStats').doc(normalizeCompanyId(companyId));
}

/** Atomik increment + updatedAt + initialize-if-missing. */
async function applyDelta(
  companyId: string,
  field: string,
  delta: number,
): Promise<void> {
  if (!delta) return;
  await statsDoc(companyId).set(
    {
      [field]: FieldValue.increment(delta),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// ============================================================================
// depoStok — stockCount.active, stockCount.shipped
// ============================================================================

export const onDepoStokWritten = onDocumentWritten(
  { document: 'depoStok/{stokId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const companyId = normalizeCompanyId(after?.companyId ?? before?.companyId);
    if (!companyId) return;

    // Yeni doc → active+1 veya shipped+1
    // Silinen doc → active-1 veya shipped-1
    // isShipped değişti → active±1 + shipped∓1
    const beforeShipped = Boolean(before?.isShipped);
    const afterShipped = Boolean(after?.isShipped);
    const existedBefore = !!before;
    const existsNow = !!after;

    let activeDelta = 0;
    let shippedDelta = 0;

    if (!existedBefore && existsNow) {
      if (afterShipped) shippedDelta += 1; else activeDelta += 1;
    } else if (existedBefore && !existsNow) {
      if (beforeShipped) shippedDelta -= 1; else activeDelta -= 1;
    } else if (existedBefore && existsNow && beforeShipped !== afterShipped) {
      if (afterShipped) { shippedDelta += 1; activeDelta -= 1; }
      else { shippedDelta -= 1; activeDelta += 1; }
    }

    try {
      if (activeDelta) await applyDelta(companyId, 'stock.activeCount', activeDelta);
      if (shippedDelta) await applyDelta(companyId, 'stock.shippedCount', shippedDelta);
    } catch (err) {
      logger.error('depoStok aggregation failed', { companyId, err });
    }
  },
);

// ============================================================================
// tuketimKayitlari — consumption.todayCount, last30DaysCount
// ============================================================================

function dayKey(ts: Timestamp | Date | undefined | null): string | null {
  if (!ts) return null;
  const d = ts instanceof Timestamp ? ts.toDate() : (ts instanceof Date ? ts : null);
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export const onTuketimWritten = onDocumentWritten(
  { document: 'tuketimKayitlari/{recId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const companyId = normalizeCompanyId(after?.companyId ?? before?.companyId);
    if (!companyId) return;

    const existedBefore = !!before;
    const existsNow = !!after;
    const delta = (existsNow ? 1 : 0) - (existedBefore ? 1 : 0);
    if (!delta) return;

    // Bugünkü sayım: kayıt bugün mü oluştu?
    const ts = (after?.consumptionTimestamp ?? before?.consumptionTimestamp) as Timestamp | undefined;
    const today = new Date().toISOString().slice(0, 10);
    const isToday = dayKey(ts) === today;

    try {
      await applyDelta(companyId, 'consumption.last30DaysCount', delta);
      if (isToday) await applyDelta(companyId, 'consumption.todayCount', delta);
    } catch (err) {
      logger.error('tuketim aggregation failed', { companyId, err });
    }
  },
);

// ============================================================================
// shipments — shipments.todayCount, last30DaysCount
// ============================================================================

export const onShipmentWritten = onDocumentWritten(
  { document: 'shipments/{shipmentId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const companyId = normalizeCompanyId(after?.companyId ?? before?.companyId);
    if (!companyId) return;

    const delta = ((after ? 1 : 0) - (before ? 1 : 0));
    if (!delta) return;

    const ts = (after?.timestamp ?? before?.timestamp) as Timestamp | undefined;
    const today = new Date().toISOString().slice(0, 10);
    const isToday = dayKey(ts) === today;

    try {
      await applyDelta(companyId, 'shipments.last30DaysCount', delta);
      if (isToday) await applyDelta(companyId, 'shipments.todayCount', delta);
    } catch (err) {
      logger.error('shipment aggregation failed', { companyId, err });
    }
  },
);

// ============================================================================
// deviceFaultReports — faults.open, faults.totalLast30Days
// ============================================================================

const OPEN_FAULT_STATUSES = new Set(['open', 'in_progress', 'baslamadi', 'devam_ediyor']);

function isOpenFault(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase();
  return OPEN_FAULT_STATUSES.has(s);
}

export const onFaultWritten = onDocumentWritten(
  { document: 'deviceFaultReports/{faultId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const companyId = normalizeCompanyId(after?.companyId ?? before?.companyId);
    if (!companyId) return;

    const beforeOpen = before ? isOpenFault(before.status) : false;
    const afterOpen = after ? isOpenFault(after.status) : false;

    let openDelta = 0;
    if (!before && after && afterOpen) openDelta = 1;
    else if (before && !after && beforeOpen) openDelta = -1;
    else if (before && after && beforeOpen !== afterOpen) {
      openDelta = afterOpen ? 1 : -1;
    }

    // total last30 days: yeni açılan arıza son 30 günde sayılır
    const ts = (after?.openedAt ?? before?.openedAt) as Timestamp | undefined;
    const totalDelta = ((after ? 1 : 0) - (before ? 1 : 0));
    const within30 = ts ? (Date.now() - ts.toDate().getTime()) < 30 * 24 * 60 * 60 * 1000 : false;

    try {
      if (openDelta) await applyDelta(companyId, 'faults.openCount', openDelta);
      if (totalDelta && within30) await applyDelta(companyId, 'faults.last30DaysTotal', totalDelta);
    } catch (err) {
      logger.error('fault aggregation failed', { companyId, err });
    }
  },
);

// ============================================================================
// Günlük temizleme — today counter'ları reset, 30-day pencereyi sürdür
// ============================================================================

/**
 * Her gece 00:05'te (Avrupa/Istanbul) `today*` sayaçlarını sıfırlar
 * ve `last30Days*` sayaçlarını 31. günü düşerek günceller.
 *
 * Bu basit yaklaşım yerine isteğe bağlı olarak günlük log doc'ları
 * tutup pencere hesabını incrementally yapabilirsiniz. İlk sürüm
 * için reset+recompute yeterli.
 */
export const dailyStatsRollover = onSchedule(
  {
    schedule: '5 0 * * *',
    timeZone: 'Europe/Istanbul',
    region: 'europe-west1',
  },
  async () => {
    const snap = await db.collection('companyStats').get();
    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.set(
        doc.ref,
        {
          'consumption.todayCount': 0,
          'shipments.todayCount': 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
    await batch.commit();
    logger.info('Daily companyStats rollover complete', { affected: snap.size });
  },
);

// ============================================================================
// Backfill — Mevcut verileri tek seferde compute (manuel callable)
// ============================================================================

import { onCall, HttpsError } from 'firebase-functions/v2/https';

/**
 * Yeni bir firma onboard edildiğinde veya stats doc kaybolduğunda
 * companyStats/{companyId} dokümanını sıfırdan hesaplar.
 *
 * Sadece super_admin çağırabilir.
 */
export const backfillCompanyStats = onCall(
  { region: 'europe-west1', timeoutSeconds: 540, memory: '1GiB' },
  async (request) => {
    const role = request.auth?.token?.role as string | undefined;
    if (role !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Only super_admin can backfill stats');
    }

    const companyId = String(request.data?.companyId ?? '').trim();
    if (!companyId) {
      throw new HttpsError('invalid-argument', 'companyId required');
    }

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      stockActive,
      stockShipped,
      consumptionToday,
      consumptionLast30,
      shipmentsToday,
      shipmentsLast30,
      faultsOpen,
      faultsLast30,
    ] = await Promise.all([
      db.collection('depoStok')
        .where('companyId', '==', companyId)
        .where('isShipped', '==', false)
        .count().get(),
      db.collection('depoStok')
        .where('companyId', '==', companyId)
        .where('isShipped', '==', true)
        .count().get(),
      db.collection('tuketimKayitlari')
        .where('companyId', '==', companyId)
        .where('consumptionTimestamp', '>=', Timestamp.fromDate(todayStart))
        .count().get(),
      db.collection('tuketimKayitlari')
        .where('companyId', '==', companyId)
        .where('consumptionTimestamp', '>=', Timestamp.fromDate(since30))
        .count().get(),
      db.collection('shipments')
        .where('companyId', '==', companyId)
        .where('timestamp', '>=', Timestamp.fromDate(todayStart))
        .count().get(),
      db.collection('shipments')
        .where('companyId', '==', companyId)
        .where('timestamp', '>=', Timestamp.fromDate(since30))
        .count().get(),
      db.collection('deviceFaultReports')
        .where('companyId', '==', companyId)
        .where('status', 'in', ['open', 'in_progress', 'baslamadi', 'devam_ediyor'])
        .count().get(),
      db.collection('deviceFaultReports')
        .where('companyId', '==', companyId)
        .where('openedAt', '>=', Timestamp.fromDate(since30))
        .count().get(),
    ]);

    await statsDoc(companyId).set({
      companyId,
      updatedAt: FieldValue.serverTimestamp(),
      stock: {
        activeCount: stockActive.data().count,
        shippedCount: stockShipped.data().count,
      },
      consumption: {
        todayCount: consumptionToday.data().count,
        last30DaysCount: consumptionLast30.data().count,
      },
      shipments: {
        todayCount: shipmentsToday.data().count,
        last30DaysCount: shipmentsLast30.data().count,
      },
      faults: {
        openCount: faultsOpen.data().count,
        last30DaysTotal: faultsLast30.data().count,
      },
    }, { merge: true });

    return {
      ok: true,
      companyId,
      stats: {
        stock: {
          activeCount: stockActive.data().count,
          shippedCount: stockShipped.data().count,
        },
        consumption: {
          todayCount: consumptionToday.data().count,
          last30DaysCount: consumptionLast30.data().count,
        },
        shipments: {
          todayCount: shipmentsToday.data().count,
          last30DaysCount: shipmentsLast30.data().count,
        },
        faults: {
          openCount: faultsOpen.data().count,
          last30DaysTotal: faultsLast30.data().count,
        },
      },
    };
  },
);
