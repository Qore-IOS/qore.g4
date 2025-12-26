/**
 * Daily Consumption Stats - Aggregated daily consumption data for dashboard KPI
 *
 * This module provides functions to:
 * 1. Calculate and save daily consumption summaries
 * 2. Migrate historical data from tuketimKayitlari collection
 *
 * The dailyConsumptionStats collection stores pre-computed daily totals,
 * significantly reducing reads when displaying historical consumption trends.
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
  writeBatch
} from 'firebase/firestore';
import { format, startOfDay, endOfDay, eachDayOfInterval, subDays } from 'date-fns';
import type { DailyConsumptionStats, ConsumptionRecord } from '@/lib/types';

const COLLECTION_NAME = 'dailyConsumptionStats';

/**
 * Format date to YYYY-MM-DD string (used as document ID)
 */
export function formatDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Calculate daily consumption stats for a specific date
 * Queries tuketimKayitlari and aggregates by laboratory
 */
export async function calculateDailyStats(date: Date): Promise<Omit<DailyConsumptionStats, 'id'>> {
  const dateKey = formatDateKey(date);
  const dayStart = Timestamp.fromDate(startOfDay(date));
  const dayEnd = Timestamp.fromDate(endOfDay(date));

  // Query consumption records for this day
  const q = query(
    collection(db, 'tuketimKayitlari'),
    where('consumptionTimestamp', '>=', dayStart),
    where('consumptionTimestamp', '<=', dayEnd),
    orderBy('consumptionTimestamp', 'asc')
  );

  const snap = await getDocs(q);

  // Aggregate by laboratory
  const byLab: Record<string, number> = {};
  let totalCount = 0;

  snap.docs.forEach(docSnap => {
    const data = docSnap.data() as ConsumptionRecord;
    const labId = data.laboratoryId || 'unknown';

    byLab[labId] = (byLab[labId] || 0) + 1;
    totalCount++;
  });

  return {
    date: dateKey,
    totalCount,
    byLab,
    updatedAt: Timestamp.now()
  };
}

/**
 * Save daily consumption stats to Firestore
 */
export async function saveDailyStats(date: Date): Promise<DailyConsumptionStats> {
  const dateKey = formatDateKey(date);
  const stats = await calculateDailyStats(date);

  const docRef = doc(db, COLLECTION_NAME, dateKey);
  await setDoc(docRef, {
    ...stats,
    createdAt: Timestamp.now()
  }, { merge: true });

  return { id: dateKey, ...stats };
}

/**
 * Get daily stats for a specific date
 * Returns null if not found
 */
export async function getDailyStats(date: Date): Promise<DailyConsumptionStats | null> {
  const dateKey = formatDateKey(date);
  const docRef = doc(db, COLLECTION_NAME, dateKey);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return { id: docSnap.id, ...docSnap.data() } as DailyConsumptionStats;
}

/**
 * Migrate historical consumption data to dailyConsumptionStats
 * Use this to backfill data for existing consumption records
 *
 * @param startDate - Start date for migration
 * @param endDate - End date for migration
 * @param onProgress - Optional callback for progress updates
 */
export async function migrateHistoricalData(
  startDate: Date,
  endDate: Date,
  onProgress?: (current: number, total: number, date: string) => void
): Promise<{ success: number; failed: number }> {
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  let success = 0;
  let failed = 0;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const dateKey = formatDateKey(day);

    try {
      await saveDailyStats(day);
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
 * Update today's stats incrementally
 * Call this after each consumption to keep stats fresh
 */
export async function incrementTodayStats(labId: string): Promise<void> {
  const today = new Date();
  const dateKey = formatDateKey(today);
  const docRef = doc(db, COLLECTION_NAME, dateKey);

  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    const data = docSnap.data() as DailyConsumptionStats;
    await setDoc(docRef, {
      ...data,
      totalCount: (data.totalCount || 0) + 1,
      byLab: {
        ...data.byLab,
        [labId]: ((data.byLab || {})[labId] || 0) + 1
      },
      updatedAt: Timestamp.now()
    }, { merge: true });
  } else {
    // First consumption of the day
    await setDoc(docRef, {
      date: dateKey,
      totalCount: 1,
      byLab: { [labId]: 1 },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
  }
}

/**
 * Get stats for a date range, calculating missing days on-demand
 * For days without pre-computed stats, calculate and save them
 */
export async function getStatsForRange(
  startDate: Date,
  endDate: Date
): Promise<DailyConsumptionStats[]> {
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const results: DailyConsumptionStats[] = [];

  // First, try to get all existing stats
  const startKey = formatDateKey(startDate);
  const endKey = formatDateKey(endDate);

  const q = query(
    collection(db, COLLECTION_NAME),
    where('date', '>=', startKey),
    where('date', '<=', endKey),
    orderBy('date', 'asc')
  );

  const snap = await getDocs(q);
  const existingStats = new Map<string, DailyConsumptionStats>();

  snap.docs.forEach(docSnap => {
    const data = { id: docSnap.id, ...docSnap.data() } as DailyConsumptionStats;
    existingStats.set(data.date, data);
  });

  // For each day, use existing stats or calculate new ones
  for (const day of days) {
    const dateKey = formatDateKey(day);

    if (existingStats.has(dateKey)) {
      results.push(existingStats.get(dateKey)!);
    } else {
      // Calculate and save stats for missing day
      try {
        const stats = await saveDailyStats(day);
        results.push(stats);
      } catch (error) {
        console.error(`Failed to calculate stats for ${dateKey}:`, error);
        // Add empty stats for this day
        results.push({
          id: dateKey,
          date: dateKey,
          totalCount: 0,
          byLab: {}
        });
      }
    }
  }

  return results;
}
