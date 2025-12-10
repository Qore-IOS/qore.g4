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
  Timestamp
} from 'firebase/firestore';
import type {
  Hospital,
  Depot,
  ProductCode,
  DepoStokItem,
  ConsumptionRecord,
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
 * Shorter stale time since this changes more frequently
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
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000,
    refetchInterval: 60 * 1000, // Poll every minute
  });
}

/**
 * All Depot Stock - For dashboard summaries
 * Uses longer polling interval to reduce reads
 */
export function useAllDepoStok() {
  return useQuery({
    queryKey: ['depoStok', 'all'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'depoStok'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes
  });
}

/**
 * Shipped stock for a specific lab (or pool of labs)
 * Supports both hedefKurumId (ID-based) and hedefKurum (name-based) lookups
 * for backwards compatibility with older records that may not have hedefKurumId
 */
export function useLabStock(labIds: string[], labNames: string[] = []) {
  return useQuery({
    queryKey: ['depoStok', 'shipped', labIds.sort().join(','), labNames.sort().join(',')],
    queryFn: async () => {
      if (labIds.length === 0 && labNames.length === 0) return [];

      const results: DepoStokItem[] = [];
      const seenIds = new Set<string>();

      // Query 1: By hedefKurumId (primary, for newer records)
      if (labIds.length > 0) {
        const ids = labIds.slice(0, 30);
        const qById = query(
          collection(db, 'depoStok'),
          where('hedefKurumId', 'in', ids),
          where('isShipped', '==', true)
        );
        const snapById = await getDocs(qById);
        snapById.docs.forEach(d => {
          seenIds.add(d.id);
          results.push({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem);
        });
      }

      // Query 2: By hedefKurum name (fallback, for older records without hedefKurumId)
      if (labNames.length > 0) {
        const names = labNames.slice(0, 30);
        const qByName = query(
          collection(db, 'depoStok'),
          where('hedefKurum', 'in', names),
          where('isShipped', '==', true)
        );
        const snapByName = await getDocs(qByName);
        snapByName.docs.forEach(d => {
          // Avoid duplicates (some records may have both hedefKurumId and hedefKurum)
          if (!seenIds.has(d.id)) {
            seenIds.add(d.id);
            results.push({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem);
          }
        });
      }

      return results;
    },
    enabled: labIds.length > 0 || labNames.length > 0,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 60 * 1000,
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
