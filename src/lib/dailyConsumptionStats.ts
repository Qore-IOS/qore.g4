/**
 * Daily Consumption Stats - Aggregated daily consumption data for dashboard KPI
 *
 * Multi-tenancy: docId is `${companyId}_${dateKey}` (Phase 2-M).
 * Each tenant has its own daily aggregate per date. Earlier versions used
 * `dateKey` only — those legacy docs are visible to no tenant under strict
 * Rules; a migration script (scripts/migrate-daily-stats.js) rewrites them
 * to the new ID format with the appropriate companyId.
 *
 * All functions require a `companyId` parameter. Pass `currentCompanyId`
 * from useAuth().
 */

import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { getDocsResilient, getDocResilient } from '@/lib/firestore-network-recovery';
import { format, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { normalizeCompanyId } from '@/lib/company-scope';
import type { DailyConsumptionStats, ConsumptionRecord } from '@/lib/types';

const COLLECTION_NAME = 'dailyConsumptionStats';

/**
 * Format date to YYYY-MM-DD string.
 */
export function formatDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Build the per-tenant docId for a date.
 * Format: `${companyId}_${YYYY-MM-DD}`.
 */
export function buildStatsDocId(
  companyId: string | null | undefined,
  date: Date | string,
): string {
  const dateKey = typeof date === 'string' ? date : formatDateKey(date);
  return `${normalizeCompanyId(companyId)}_${dateKey}`;
}

/**
 * Calculate daily consumption stats for a specific date, scoped to a tenant.
 * Reads tuketimKayitlari with companyId filter so cross-tenant rows aren't aggregated.
 */
export async function calculateDailyStats(
  date: Date,
  companyId: string | null | undefined,
): Promise<Omit<DailyConsumptionStats, 'id'>> {
  const dateKey = formatDateKey(date);
  const dayStart = Timestamp.fromDate(startOfDay(date));
  const dayEnd = Timestamp.fromDate(endOfDay(date));
  const normalizedCompany = normalizeCompanyId(companyId);

  const q = query(
    collection(db, 'tuketimKayitlari'),
    where('companyId', '==', normalizedCompany),
    where('consumptionTimestamp', '>=', dayStart),
    where('consumptionTimestamp', '<=', dayEnd),
    orderBy('consumptionTimestamp', 'asc'),
  );

  const snap = await getDocsResilient(q);

  const byLab: Record<string, number> = {};
  let totalCount = 0;

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() as ConsumptionRecord;
    const labId = data.laboratoryId || 'unknown';
    byLab[labId] = (byLab[labId] || 0) + 1;
    totalCount++;
  });

  return {
    date: dateKey,
    totalCount,
    byLab,
    updatedAt: Timestamp.now(),
  };
}

/**
 * Save daily consumption stats to Firestore under the tenant-scoped docId.
 */
export async function saveDailyStats(
  date: Date,
  companyId: string | null | undefined,
): Promise<DailyConsumptionStats> {
  const dateKey = formatDateKey(date);
  const docId = buildStatsDocId(companyId, dateKey);
  const stats = await calculateDailyStats(date, companyId);

  const docRef = doc(db, COLLECTION_NAME, docId);
  await setDoc(
    docRef,
    {
      ...stats,
      companyId: normalizeCompanyId(companyId),
      createdAt: Timestamp.now(),
    },
    { merge: true },
  );

  return { id: docId, ...stats };
}

/**
 * Get daily stats for a specific date. Returns null if not found.
 */
export async function getDailyStats(
  date: Date,
  companyId: string | null | undefined,
): Promise<DailyConsumptionStats | null> {
  const docId = buildStatsDocId(companyId, date);
  const docRef = doc(db, COLLECTION_NAME, docId);
  const docSnap = await getDocResilient(docRef);

  if (!docSnap.exists()) return null;
  return { id: docSnap.id, ...docSnap.data() } as DailyConsumptionStats;
}

/**
 * Migrate historical consumption data to dailyConsumptionStats for a tenant.
 */
export async function migrateHistoricalData(
  startDate: Date,
  endDate: Date,
  companyId: string | null | undefined,
  onProgress?: (current: number, total: number, date: string) => void,
): Promise<{ success: number; failed: number }> {
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  let success = 0;
  let failed = 0;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const dateKey = formatDateKey(day);

    try {
      await saveDailyStats(day, companyId);
      success++;
      onProgress?.(i + 1, days.length, dateKey);
    } catch (error) {
      console.error(`Failed to migrate ${dateKey}:`, error);
      failed++;
    }
  }

  return { success, failed };
}

/**
 * Update today's stats incrementally. Call after each consumption.
 */
export async function incrementTodayStats(
  labId: string,
  companyId: string | null | undefined,
): Promise<void> {
  const today = new Date();
  const dateKey = formatDateKey(today);
  const docId = buildStatsDocId(companyId, dateKey);
  const docRef = doc(db, COLLECTION_NAME, docId);
  const normalizedCompany = normalizeCompanyId(companyId);

  const docSnap = await getDocResilient(docRef);

  if (docSnap.exists()) {
    const data = docSnap.data() as DailyConsumptionStats;
    await setDoc(
      docRef,
      {
        ...data,
        companyId: normalizedCompany,
        totalCount: (data.totalCount || 0) + 1,
        byLab: {
          ...data.byLab,
          [labId]: ((data.byLab || {})[labId] || 0) + 1,
        },
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } else {
    await setDoc(docRef, {
      date: dateKey,
      companyId: normalizedCompany,
      totalCount: 1,
      byLab: { [labId]: 1 },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }
}

/**
 * Get stats for a date range, calculating missing days on-demand for the tenant.
 */
export async function getStatsForRange(
  startDate: Date,
  endDate: Date,
  companyId: string | null | undefined,
): Promise<DailyConsumptionStats[]> {
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const results: DailyConsumptionStats[] = [];

  const startKey = formatDateKey(startDate);
  const endKey = formatDateKey(endDate);
  const normalizedCompany = normalizeCompanyId(companyId);

  const q = query(
    collection(db, COLLECTION_NAME),
    where('companyId', '==', normalizedCompany),
    where('date', '>=', startKey),
    where('date', '<=', endKey),
    orderBy('date', 'asc'),
  );

  const snap = await getDocsResilient(q);
  const existingStats = new Map<string, DailyConsumptionStats>();

  snap.docs.forEach((docSnap) => {
    const data = { id: docSnap.id, ...docSnap.data() } as DailyConsumptionStats;
    existingStats.set(data.date, data);
  });

  for (const day of days) {
    const dateKey = formatDateKey(day);

    if (existingStats.has(dateKey)) {
      results.push(existingStats.get(dateKey)!);
    } else {
      try {
        const stats = await saveDailyStats(day, companyId);
        results.push(stats);
      } catch (error) {
        console.error(`Failed to calculate stats for ${dateKey}:`, error);
        results.push({
          id: buildStatsDocId(companyId, dateKey),
          date: dateKey,
          totalCount: 0,
          byLab: {},
        });
      }
    }
  }

  return results;
}
