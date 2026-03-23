'use client';

/**
 * Optimized Firebase Queries using TanStack Query
 *
 * Bu hook'lar Firebase real-time listener'lar yerine polling + caching kullanarak
 * okuma sayısını dramatik olarak azaltır.
 *
 * Şirket Bazlı Filtreleme:
 * - Legacy kullanıcılar: Filtre yok, tüm veriler görünür (geçiş hissedilmez)
 * - Şirket kullanıcıları: where('companyId', '==', id) filtresi uygulanır
 * - Paylaşılan koleksiyonlar (productCodes, barcodeFormats): Filtre yok
 *
 * Composite Index: Firestore bazı sorgular için composite index gerektirebilir.
 * İndex URL'leri otomatik olarak tarayıcı konsoluna loglanır.
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
import { useAuth } from '@/contexts/auth-context';
import { companyQuery, addCompanyFilter } from '@/lib/company-filter';

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
 * SHARED: Tüm şirketler için ortak, filtre uygulanmaz
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
 * COMPANY FILTERED
 */
export function useDepots() {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['depots', currentCompanyId],
    queryFn: async () => {
      const snap = await getDocs(companyQuery(db, 'depots', currentCompanyId));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Depot));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hospitals/Laboratories - Used in 10+ places
 * COMPANY FILTERED
 */
export function useHospitals() {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['hospitals', currentCompanyId],
    queryFn: async () => {
      const snap = await getDocs(companyQuery(db, 'hospitals', currentCompanyId));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Hospital));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Devices
 * COMPANY FILTERED
 */
export function useDevices() {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['devices', currentCompanyId],
    queryFn: async () => {
      const snap = await getDocs(companyQuery(db, 'devices', currentCompanyId));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Device));
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Lab Pools
 * COMPANY FILTERED
 */
export function useLabPools() {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['labPools', currentCompanyId],
    queryFn: async () => {
      const snap = await getDocs(companyQuery(db, 'labPools', currentCompanyId));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as LabPool));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Barcode Formats - Active only
 * SHARED: Tüm şirketler için ortak, filtre uygulanmaz
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
 * COMPANY FILTERED
 */
export function useAddressDefinitions() {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['addressDefinitions', currentCompanyId],
    queryFn: async () => {
      const snap = await getDocs(companyQuery(db, 'addressDefinitions', currentCompanyId));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as AddressDefinition));
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Users
 * COMPANY FILTERED
 */
export function useUsers() {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['users', currentCompanyId],
    queryFn: async () => {
      const snap = await getDocs(companyQuery(db, 'users', currentCompanyId));
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
 * COMPANY FILTERED + DEPOT FILTERED
 * Composite Index gerekebilir: companyId + depotId
 */
export function useDepoStokByDepot(depotId: string | null) {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['depoStok', depotId, currentCompanyId],
    queryFn: async () => {
      if (!depotId) return [];
      const snap = await getDocs(companyQuery(db, 'depoStok', currentCompanyId, where('depotId', '==', depotId)));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
    },
    enabled: !!depotId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * All Depot Stock - For dashboard summaries
 * COMPANY FILTERED
 */
export function useAllDepoStok() {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['depoStok', 'all', currentCompanyId],
    queryFn: async () => {
      const snap = await getDocs(companyQuery(db, 'depoStok', currentCompanyId));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Shipped stock for a specific lab (or pool of labs)
 * COMPANY FILTERED
 * Composite Index gerekebilir: companyId + hedefKurumId + isShipped
 */
export function useLabStock(
  labIds: string[],
  labNames: string[] = [],
  options: { enabled?: boolean } = {}
) {
  const { currentCompanyId } = useAuth();
  const { enabled: externalEnabled = true } = options;

  return useQuery({
    queryKey: ['depoStok', 'shipped', labIds.sort().join(','), labNames.sort().join(','), currentCompanyId],
    queryFn: async () => {
      if (labIds.length === 0) return [];
      const ids = labIds.slice(0, 30);
      const names = labNames.slice(0, 30);

      // Query by hedefKurumId
      const idQ = query(
        collection(db, 'depoStok'),
        ...([
          where('hedefKurumId', 'in', ids),
          where('isShipped', '==', true),
        ])
      );
      const idSnap = await getDocs(addCompanyFilter(idQ, currentCompanyId, 'depoStok'));
      const idResults = idSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));

      // Also query by hedefKurum (name) for legacy records
      let legacyResults: DepoStokItem[] = [];
      if (names.length > 0) {
        const nameQ = query(
          collection(db, 'depoStok'),
          ...([
            where('hedefKurum', 'in', names),
            where('isShipped', '==', true),
          ])
        );
        const nameSnap = await getDocs(addCompanyFilter(nameQ, currentCompanyId, 'depoStok'));
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
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 3 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Consumption Records - Recent only (last 500)
 * COMPANY FILTERED
 * Composite Index gerekebilir: companyId + consumptionTimestamp
 */
export function useRecentConsumption(limitCount = 500) {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['tuketimKayitlari', 'recent', limitCount, currentCompanyId],
    queryFn: async () => {
      const baseQ = query(
        collection(db, 'tuketimKayitlari'),
        orderBy('consumptionTimestamp', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(addCompanyFilter(baseQ, currentCompanyId, 'tuketimKayitlari'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Daily Consumption Stats
 * COMPANY FILTERED
 * Composite Index gerekebilir: companyId + date
 */
export function useDailyConsumptionStats(startDate: string, endDate: string) {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['dailyConsumptionStats', startDate, endDate, currentCompanyId],
    queryFn: async () => {
      const baseQ = query(
        collection(db, 'dailyConsumptionStats'),
        where('date', '>=', startDate),
        where('date', '<=', endDate),
        orderBy('date', 'asc')
      );
      const snap = await getDocs(addCompanyFilter(baseQ, currentCompanyId, 'dailyConsumptionStats'));
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
 * COMPANY FILTERED
 */
export function useConsumptionByDateRange(
  startDate: Date | null,
  endDate: Date | null,
  enabled = false
) {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['tuketimKayitlari', 'dateRange', startDate?.toISOString(), endDate?.toISOString(), currentCompanyId],
    queryFn: async () => {
      if (!startDate || !endDate) return [];

      const startTimestamp = Timestamp.fromDate(startDate);
      const endTimestamp = Timestamp.fromDate(endDate);

      const baseQ = query(
        collection(db, 'tuketimKayitlari'),
        where('consumptionTimestamp', '>=', startTimestamp),
        where('consumptionTimestamp', '<=', endTimestamp),
        orderBy('consumptionTimestamp', 'desc')
      );
      const snap = await getDocs(addCompanyFilter(baseQ, currentCompanyId, 'tuketimKayitlari'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

/**
 * Fetch consumption records by date range - imperative function
 * companyId parametresi iletilmelidir (React hook dışı kullanım)
 */
export async function fetchConsumptionByDateRange(
  startDate: Date,
  endDate: Date,
  companyId?: string
): Promise<ConsumptionRecord[]> {
  const startTimestamp = Timestamp.fromDate(startDate);
  const endTimestamp = Timestamp.fromDate(endDate);

  const baseQ = query(
    collection(db, 'tuketimKayitlari'),
    where('consumptionTimestamp', '>=', startTimestamp),
    where('consumptionTimestamp', '<=', endTimestamp),
    orderBy('consumptionTimestamp', 'desc')
  );
  const finalQ = companyId ? addCompanyFilter(baseQ, companyId, 'tuketimKayitlari') : baseQ;
  const snap = await getDocs(finalQ);
  return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
}

/**
 * Shipments - Recent only
 * COMPANY FILTERED
 * Composite Index gerekebilir: companyId + createdAt
 */
export function useRecentShipments(limitCount = 200) {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['shipments', 'recent', limitCount, currentCompanyId],
    queryFn: async () => {
      const baseQ = query(
        collection(db, 'shipments'),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(addCompanyFilter(baseQ, currentCompanyId, 'shipments'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Shipment));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Efficiency History - Recent only
 * COMPANY FILTERED
 */
export function useEfficiencyHistory(limitCount = 100) {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['efficiencyHistory', 'recent', limitCount, currentCompanyId],
    queryFn: async () => {
      const baseQ = query(
        collection(db, 'efficiencyHistory'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(addCompanyFilter(baseQ, currentCompanyId, 'efficiencyHistory'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

/**
 * Min/Max Rules for a specific hospital
 * Subcollection - parent zaten company-filtered
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
 * Subcollection - parent zaten company-filtered
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
 * Subcollection - parent zaten company-filtered
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

const STOCK_METADATA_DOC = 'metadata/stockLastUpdated';

export async function touchStockMetadata() {
  try {
    await setDoc(doc(db, STOCK_METADATA_DOC), {
      lastUpdated: serverTimestamp(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to touch stock metadata:', error);
  }
}

export function useStockUpdateListener() {
  const queryClient = useQueryClient();
  const isFirstLoad = useRef(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, STOCK_METADATA_DOC),
      (snapshot) => {
        if (isFirstLoad.current) {
          isFirstLoad.current = false;
          return;
        }
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
 * Get all active duty shifts
 * COMPANY FILTERED
 */
export function useActiveDutyShifts() {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['dutyShifts', 'active', currentCompanyId],
    queryFn: async () => {
      const now = new Date();
      const snap = await getDocs(
        companyQuery(db, 'dutyShifts', currentCompanyId, where('status', '==', 'active'))
      );
      return snap.docs
        .map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift))
        .filter(shift => {
          const startDate = shift.startDate instanceof Date ? shift.startDate : new Date(shift.startDate as any);
          const endDate = shift.endDate instanceof Date ? shift.endDate : new Date(shift.endDate as any);

          const effectiveStart = new Date(startDate);
          if (shift.startTime) {
            const [h, m] = shift.startTime.split(':').map(Number);
            if (!isNaN(h) && !isNaN(m)) {
              effectiveStart.setHours(h, m, 0, 0);
            }
          }

          const effectiveEnd = new Date(endDate);
          if (shift.endTime) {
            const [h, m] = shift.endTime.split(':').map(Number);
            if (!isNaN(h) && !isNaN(m)) {
              effectiveEnd.setHours(h, m, 59, 999);
            }
          }

          return now >= effectiveStart && now <= effectiveEnd;
        });
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Get upcoming duty shifts for the next 30 days for a specific lab
 * COMPANY FILTERED
 */
export function useUpcomingDutyShifts(labId: string | null) {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['dutyShifts', 'upcoming30', labId, currentCompanyId],
    queryFn: async () => {
      if (!labId) return [];
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const thirtyDaysLater = new Date(now);
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
      thirtyDaysLater.setHours(23, 59, 59, 999);

      const snap = await getDocs(
        companyQuery(db, 'dutyShifts', currentCompanyId, where('status', '==', 'active'))
      );
      return snap.docs
        .map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift))
        .filter(shift => {
          const startDate = shift.startDate instanceof Date ? shift.startDate : new Date(shift.startDate as any);
          const endDate = shift.endDate instanceof Date ? shift.endDate : new Date(shift.endDate as any);
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
 * COMPANY FILTERED
 */
export function useAllDutyShifts() {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['dutyShifts', 'all', currentCompanyId],
    queryFn: async () => {
      const snap = await getDocs(companyQuery(db, 'dutyShifts', currentCompanyId));
      const shifts = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift));
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
 * COMPANY FILTERED
 */
export function useDutyShiftsByStatus(status: 'active' | 'completed' | 'cancelled') {
  const { currentCompanyId } = useAuth();
  return useQuery({
    queryKey: ['dutyShifts', status, currentCompanyId],
    queryFn: async () => {
      const snap = await getDocs(
        companyQuery(db, 'dutyShifts', currentCompanyId, where('status', '==', status))
      );
      const shifts = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift));
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
// COMBINED DATA HOOK
// ============================================================================

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
