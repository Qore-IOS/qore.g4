'use client';

/**
 * Optimized Firebase Queries using TanStack Query
 *
 * Bu hook'lar Firebase real-time listener'lar yerine polling + caching kullanarak
 * okuma sayısını dramatik olarak azaltır.
 *
 * Önceki yaklaşım: Her component mount'ta tam collection listener
 * Yeni yaklaşım: Paylaşılan cache + configurable polling
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';
import { useEffect, useRef } from 'react';
import type {
  Hospital,
  Depot,
  ProductCode,
  DepoStokItem,
  ConsumptionRecord,
  DailyConsumptionStats,
  Device,
  Shipment,
  LabPool,
  MinMaxRule,
  BarcodeFormat,
  AddressDefinition,
  User as AppUser
} from '@/lib/types';

// Helper to convert Firestore timestamps
const processTimestamp = (docData: any) => {
  const data = { ...docData };
  Object.keys(data).forEach(key => {
    if (data[key] instanceof Timestamp) {
      data[key] = data[key].toDate();
    }
  });
  return data;
};

// ============================================================================
// STATIC DATA HOOKS - Long cache times (1 hour), rarely change
// ============================================================================

/**
 * Product Codes - Used in 15+ places
 * Cache for 1 hour, refetch on window focus
 */
export function useProductCodes() {
  return useQuery({
    queryKey: ['productCodes'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'productCodes'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ProductCode));
    },
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
    refetchOnWindowFocus: true,
  });
}

/**
 * Depots - Used in 12+ places
 */
export function useDepots() {
  return useQuery({
    queryKey: ['depots'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'depots'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Depot));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hospitals/Laboratories - Used in 10+ places
 */
export function useHospitals() {
  return useQuery({
    queryKey: ['hospitals'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'hospitals'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Hospital));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Devices
 */
export function useDevices() {
  return useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'devices'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Device));
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Lab Pools
 */
export function useLabPools() {
  return useQuery({
    queryKey: ['labPools'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'labPools'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as LabPool));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Barcode Formats - Active only
 */
export function useBarcodeFormatsQuery() {
  return useQuery({
    queryKey: ['barcodeFormats'],
    queryFn: async () => {
      const q = query(collection(db, 'barcodeFormats'), where('active', '==', true));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as BarcodeFormat));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Address Definitions
 */
export function useAddressDefinitions() {
  return useQuery({
    queryKey: ['addressDefinitions'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'addressDefinitions'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as AddressDefinition));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Users
 */
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'users'));
      return snap.docs.map(d => ({ uid: d.id, ...processTimestamp(d.data()) } as AppUser));
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

// ============================================================================
// DYNAMIC DATA HOOKS - Shorter cache times, more frequent updates
// ============================================================================

/**
 * Depot Stock - Filtered by depot
 * No polling - invalidated via metadata listener when stock changes
 */
export function useDepoStokByDepot(depotId: string | null) {
  return useQuery({
    queryKey: ['depoStok', depotId],
    queryFn: async () => {
      if (!depotId) return [];
      const q = query(collection(db, 'depoStok'), where('depotId', '==', depotId));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
    },
    enabled: !!depotId,
    staleTime: 5 * 60 * 1000, // 5 minutes - no polling, relies on metadata listener
    gcTime: 30 * 60 * 1000,
    // No refetchInterval - cache invalidated by useStockUpdateListener
  });
}

/**
 * All Depot Stock - For dashboard summaries
 * No polling - invalidated via metadata listener when stock changes
 */
export function useAllDepoStok() {
  return useQuery({
    queryKey: ['depoStok', 'all'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'depoStok'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000,
    // No refetchInterval - cache invalidated by useStockUpdateListener
  });
}

/**
 * Shipped stock for a specific lab (or pool of labs)
 * Now also queries by hedefKurum (name) for legacy records that may not have hedefKurumId
 * @param labIds - Array of lab IDs to query
 * @param labNames - Array of lab names for legacy record support
 * @param options - Optional configuration: { enabled?: boolean }
 */
export function useLabStock(
  labIds: string[],
  labNames: string[] = [],
  options: { enabled?: boolean } = {}
) {
  const { enabled: externalEnabled = true } = options;

  return useQuery({
    queryKey: ['depoStok', 'shipped', labIds.sort().join(','), labNames.sort().join(',')],
    queryFn: async () => {
      if (labIds.length === 0) return [];
      // We can only use 'in' with up to 30 values
      const ids = labIds.slice(0, 30);
      const names = labNames.slice(0, 30);

      // Query by hedefKurumId
      const idQuery = query(
        collection(db, 'depoStok'),
        where('hedefKurumId', 'in', ids),
        where('isShipped', '==', true)
      );
      const idSnap = await getDocs(idQuery);
      const idResults = idSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));

      // Also query by hedefKurum (name) for legacy records that may not have hedefKurumId
      let legacyResults: DepoStokItem[] = [];
      if (names.length > 0) {
        const nameQuery = query(
          collection(db, 'depoStok'),
          where('hedefKurum', 'in', names),
          where('isShipped', '==', true)
        );
        const nameSnap = await getDocs(nameQuery);
        legacyResults = nameSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
      }

      // Merge results, avoiding duplicates
      const resultMap = new Map<string, DepoStokItem>();
      idResults.forEach(item => resultMap.set(item.id, item));
      legacyResults.forEach(item => {
        if (!resultMap.has(item.id)) {
          resultMap.set(item.id, item);
        }
      });

      return Array.from(resultMap.values());
    },
    enabled: externalEnabled && labIds.length > 0,
    staleTime: 0, // Always stale - allows metadata listener to trigger refetch immediately
    gcTime: 10 * 60 * 1000,
    refetchInterval: 3 * 1000, // Poll every 3 seconds for real-time updates
    refetchOnWindowFocus: true,
  });
}

/**
 * Consumption Records - Recent only (last 500)
 */
export function useRecentConsumption(limitCount = 500) {
  return useQuery({
    queryKey: ['tuketimKayitlari', 'recent', limitCount],
    queryFn: async () => {
      const q = query(
        collection(db, 'tuketimKayitlari'),
        orderBy('consumptionTimestamp', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Daily Consumption Stats - Aggregated daily totals for dashboard KPI
 * Fetches pre-computed daily consumption counts instead of all consumption records
 */
export function useDailyConsumptionStats(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['dailyConsumptionStats', startDate, endDate],
    queryFn: async () => {
      const q = query(
        collection(db, 'dailyConsumptionStats'),
        where('date', '>=', startDate),
        where('date', '<=', endDate),
        orderBy('date', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) })) as Array<{
        id: string;
        date: string;
        totalCount: number;
        byLab: Record<string, number>;
      }>;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Consumption Records - By date range
 * Fetches all consumption records within a specified date range.
 * This is used when user selects a specific date range or "Show All" in the statistics panel.
 */
export function useConsumptionByDateRange(
  startDate: Date | null,
  endDate: Date | null,
  enabled = false
) {
  return useQuery({
    queryKey: ['tuketimKayitlari', 'dateRange', startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      if (!startDate || !endDate) return [];

      const startTimestamp = Timestamp.fromDate(startDate);
      const endTimestamp = Timestamp.fromDate(endDate);

      const q = query(
        collection(db, 'tuketimKayitlari'),
        where('consumptionTimestamp', '>=', startTimestamp),
        where('consumptionTimestamp', '<=', endTimestamp),
        orderBy('consumptionTimestamp', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

/**
 * Fetch consumption records by date range - imperative function for on-demand fetching
 */
export async function fetchConsumptionByDateRange(
  startDate: Date,
  endDate: Date
): Promise<ConsumptionRecord[]> {
  const startTimestamp = Timestamp.fromDate(startDate);
  const endTimestamp = Timestamp.fromDate(endDate);

  const q = query(
    collection(db, 'tuketimKayitlari'),
    where('consumptionTimestamp', '>=', startTimestamp),
    where('consumptionTimestamp', '<=', endTimestamp),
    orderBy('consumptionTimestamp', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
}

/**
 * Shipments - Recent only
 */
export function useRecentShipments(limitCount = 200) {
  return useQuery({
    queryKey: ['shipments', 'recent', limitCount],
    queryFn: async () => {
      const q = query(
        collection(db, 'shipments'),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Shipment));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Efficiency History - Recent only
 */
export function useEfficiencyHistory(limitCount = 100) {
  return useQuery({
    queryKey: ['efficiencyHistory', 'recent', limitCount],
    queryFn: async () => {
      const q = query(
        collection(db, 'efficiencyHistory'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

/**
 * Min/Max Rules for a specific hospital
 */
export function useMinMaxRules(hospitalId: string | null) {
  return useQuery({
    queryKey: ['minMaxRules', hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const snap = await getDocs(collection(db, 'hospitals', hospitalId, 'minMaxRules'));
      return snap.docs.map(d => d.data() as MinMaxRule);
    },
    enabled: !!hospitalId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * All Min/Max Rules for all hospitals
 */
export function useAllMinMaxRules(hospitalIds: string[]) {
  return useQuery({
    queryKey: ['minMaxRules', 'all', hospitalIds.sort().join(',')],
    queryFn: async () => {
      const result: Record<string, MinMaxRule[]> = {};
      await Promise.all(
        hospitalIds.map(async (id) => {
          const snap = await getDocs(collection(db, 'hospitals', id, 'minMaxRules'));
          result[id] = snap.docs.map(d => d.data() as MinMaxRule);
        })
      );
      return result;
    },
    enabled: hospitalIds.length > 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * SubPoints for a specific hospital
 */
export function useSubPoints(hospitalId: string | null) {
  return useQuery({
    queryKey: ['subPoints', hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const q = query(
        collection(db, 'hospitals', hospitalId, 'subPoints'),
        orderBy('name', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; name: string; isActive?: boolean }));
    },
    enabled: !!hospitalId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

// ============================================================================
// STOCK UPDATE METADATA LISTENER - Event-based cache invalidation
// ============================================================================

/**
 * Metadata document path for stock updates
 * Single document that gets touched whenever stock changes (mal kabul, transfer)
 */
const STOCK_METADATA_DOC = 'metadata/stockLastUpdated';

/**
 * Touch the stock metadata document to signal a stock change
 * Call this after mal kabul or transfer operations
 */
export async function touchStockMetadata() {
  try {
    await setDoc(doc(db, STOCK_METADATA_DOC), {
      lastUpdated: serverTimestamp(),
      updatedAt: new Date().toISOString(), // Fallback for offline
    });
  } catch (error) {
    console.error('Failed to touch stock metadata:', error);
  }
}

/**
 * Hook that listens to stock metadata changes and invalidates cache
 * Uses Firestore onSnapshot for real-time updates (single document = very cheap)
 *
 * Usage: Call this hook once in a high-level component (e.g., layout or provider)
 */
export function useStockUpdateListener() {
  const queryClient = useQueryClient();
  const isFirstLoad = useRef(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, STOCK_METADATA_DOC),
      (snapshot) => {
        // Skip invalidation on first load (initial fetch)
        if (isFirstLoad.current) {
          isFirstLoad.current = false;
          return;
        }

        // Invalidate all depoStok queries when metadata changes
        if (snapshot.exists()) {
          queryClient.invalidateQueries({ queryKey: ['depoStok'] });
        }
      },
      (error) => {
        console.error('Stock metadata listener error:', error);
      }
    );

    return () => unsubscribe();
  }, [queryClient]);
}

// ============================================================================
// DUTY SHIFTS HOOKS
// ============================================================================

import type { DutyShift } from '@/lib/types';

/**
 * Get all active duty shifts (current date is within shift period)
 * Used in DutyInfo component
 */
export function useActiveDutyShifts() {
  return useQuery({
    queryKey: ['dutyShifts', 'active'],
    queryFn: async () => {
      const now = new Date();
      const snap = await getDocs(
        query(
          collection(db, 'dutyShifts'),
          where('status', '==', 'active')
        )
      );
      // Filter to only include shifts where current date is within range
      return snap.docs
        .map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift))
        .filter(shift => {
          const startDate = shift.startDate instanceof Date ? shift.startDate : new Date(shift.startDate as any);
          const endDate = shift.endDate instanceof Date ? shift.endDate : new Date(shift.endDate as any);
          return now >= startDate && now <= endDate;
        });
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: true,
  });
}

/**
 * Get upcoming duty shifts for the next 30 days for a specific lab
 * Used in DutyScheduleModal component
 */
export function useUpcomingDutyShifts(labId: string | null) {
  return useQuery({
    queryKey: ['dutyShifts', 'upcoming30', labId],
    queryFn: async () => {
      if (!labId) return [];
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const thirtyDaysLater = new Date(now);
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
      thirtyDaysLater.setHours(23, 59, 59, 999);

      const snap = await getDocs(
        query(
          collection(db, 'dutyShifts'),
          where('status', '==', 'active')
        )
      );
      return snap.docs
        .map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift))
        .filter(shift => {
          const startDate = shift.startDate instanceof Date ? shift.startDate : new Date(shift.startDate as any);
          const endDate = shift.endDate instanceof Date ? shift.endDate : new Date(shift.endDate as any);
          // Shift overlaps with the next 30 days AND includes this lab
          return shift.laboratoryIds.includes(labId) &&
            startDate <= thirtyDaysLater && endDate >= now;
        })
        .sort((a, b) => {
          const aStart = a.startDate instanceof Date ? a.startDate : new Date(a.startDate as any);
          const bStart = b.startDate instanceof Date ? b.startDate : new Date(b.startDate as any);
          return aStart.getTime() - bStart.getTime();
        });
    },
    enabled: !!labId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Get all duty shifts (for admin view)
 */
export function useAllDutyShifts() {
  return useQuery({
    queryKey: ['dutyShifts', 'all'],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, 'dutyShifts')
        )
      );
      const shifts = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift));
      // Sort client-side by startDate descending to avoid composite index requirement
      shifts.sort((a, b) => {
        const aTime = a.startDate instanceof Date ? a.startDate.getTime() : new Date(a.startDate as any).getTime();
        const bTime = b.startDate instanceof Date ? b.startDate.getTime() : new Date(b.startDate as any).getTime();
        return bTime - aTime;
      });
      return shifts;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Get duty shifts by status
 */
export function useDutyShiftsByStatus(status: 'active' | 'completed' | 'cancelled') {
  return useQuery({
    queryKey: ['dutyShifts', status],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, 'dutyShifts'),
          where('status', '==', status)
        )
      );
      const shifts = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift));
      // Sort client-side by startDate descending to avoid composite index requirement
      shifts.sort((a, b) => {
        const aTime = a.startDate instanceof Date ? a.startDate.getTime() : new Date(a.startDate as any).getTime();
        const bTime = b.startDate instanceof Date ? b.startDate.getTime() : new Date(b.startDate as any).getTime();
        return bTime - aTime;
      });
      return shifts;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

// ============================================================================
// CACHE INVALIDATION HELPERS
// ============================================================================

/**
 * Hook to get query client for cache invalidation
 */
export function useInvalidateQueries() {
  const queryClient = useQueryClient();

  return {
    invalidateDepoStok: () => queryClient.invalidateQueries({ queryKey: ['depoStok'] }),
    invalidateConsumption: () => queryClient.invalidateQueries({ queryKey: ['tuketimKayitlari'] }),
    invalidateShipments: () => queryClient.invalidateQueries({ queryKey: ['shipments'] }),
    invalidateProductCodes: () => queryClient.invalidateQueries({ queryKey: ['productCodes'] }),
    invalidateHospitals: () => queryClient.invalidateQueries({ queryKey: ['hospitals'] }),
    invalidateDepots: () => queryClient.invalidateQueries({ queryKey: ['depots'] }),
    invalidateAll: () => queryClient.invalidateQueries(),
  };
}

// ============================================================================
// COMBINED DATA HOOK - Replaces useDashboardData for most use cases
// ============================================================================

/**
 * Lightweight dashboard data hook
 * Only fetches what's needed, uses caching aggressively
 */
export function useLightweightDashboardData() {
  const hospitalsQuery = useHospitals();
  const depotsQuery = useDepots();
  const productsQuery = useProductCodes();
  const devicesQuery = useDevices();
  const labPoolsQuery = useLabPools();

  const isLoading =
    hospitalsQuery.isLoading ||
    depotsQuery.isLoading ||
    productsQuery.isLoading ||
    devicesQuery.isLoading ||
    labPoolsQuery.isLoading;

  return {
    hospitals: hospitalsQuery.data ?? [],
    depots: depotsQuery.data ?? [],
    productCodes: productsQuery.data ?? [],
    devices: devicesQuery.data ?? [],
    labPools: labPoolsQuery.data ?? [],
    isLoading,
    refetch: () => {
      hospitalsQuery.refetch();
      depotsQuery.refetch();
      productsQuery.refetch();
      devicesQuery.refetch();
      labPoolsQuery.refetch();
    },
  };
}
