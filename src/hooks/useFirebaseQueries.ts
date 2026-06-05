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
import { subDays } from 'date-fns';
import { useAuth } from '@/contexts/auth-context';
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
  User as AppUser,
  DeviceFaultReport,
  PurchasingTask,
  TestDefinitionGlobal,
  EfficiencyPool
} from '@/lib/types';
import { DepotStockCountSession } from '@/lib/mal-kabul/types';
import { SayimSession } from '@/lib/cost-analytics';
import { filterByCompanyScope } from '@/lib/company-scope';
import { getScopedDocs, scopedQuery } from '@/lib/firestore-helpers';

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
 *
 * Legacy-aware: getScopedDocs ensures eski/__legacy__ etiketli ürün kayıtları
 * non-superadmin kullanıcılar için de görünür kalır (barkod çözümlemesi bu
 * koleksiyona bağımlı — bkz. yönetim panelleri için aynı düzeltme: ac34a38).
 */
export function useProductCodes() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['productCodes', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const docs = await getScopedDocs('productCodes', currentCompanyId, isSuperAdmin);
      const items = docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ProductCode));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
    // PERF (Faz 2): refetchOnWindowFocus kaldırıldı → global false miras alınır.
    // Statik master-data; her tab-focus'ta tüm koleksiyonu yeniden çekmeye gerek yok.
  });
}

/**
 * Depots - Used in 12+ places
 */
export function useDepots() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['depots', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin));
      const depots = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Depot));
      return filterByCompanyScope(depots, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    // PERF (Faz 2): refetchOnWindowFocus kaldırıldı → global false miras alınır.
  });
}

/**
 * Hospitals/Laboratories - Used in 10+ places
 */
export function useHospitals() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['hospitals', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin));
      const hospitals = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Hospital));
      return filterByCompanyScope(hospitals, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    // PERF (Faz 2): refetchOnWindowFocus kaldırıldı → global false miras alınır.
  });
}

/**
 * Borc Depots - Used in transfer and payment panels
 */
export function useBorcDepots() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['borcDepots', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('borcDepots', currentCompanyId, isSuperAdmin));
      const depots = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Depot));
      return filterByCompanyScope(depots, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Test Definitions - Global definitions for SUT codes
 */
export function useTestDefinitions() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['testDefinitions', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('testDefinitions', currentCompanyId, isSuperAdmin, orderBy('sutKodu', 'asc')));
      const defs = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as TestDefinitionGlobal));
      return filterByCompanyScope(defs, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Efficiency Pools
 */
export function useEfficiencyPools() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['efficiencyPools', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('efficiencyPools', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc')));
      const pools = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as EfficiencyPool));
      return filterByCompanyScope(pools, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}



/**
 * Devices
 */
export function useDevices() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['devices', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin));
      const devices = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Device));
      return filterByCompanyScope(devices, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Devices scoped to specific hospitals/labs — PERF (Faz 6 mobil).
 *
 * Lab-scoped kullanıcılar (teknik_servis / aplikasyon teknisyenleri) yalnızca
 * atandıkları laboratuvarların cihazlarını çeker; tüm şirket `devices` koleksiyonunu
 * (binlerce doc / birkaç MB) mobilde indirmek yerine. Panel açılışındaki 15+ sn'lik
 * veri beklemesini ortadan kaldırır.
 *
 * `hospitalIds` null/boş → admin/superadmin: tüm (scoped) koleksiyon (eski davranış).
 * Firestore `in` 30 değerle sınırlı → 30'arlı parçalara bölünür, paralel sorgulanır, birleştirilir.
 * (companyId, hospitalId) composite index gerekir; index henüz deploy edilmemişse
 * FAILED_PRECONDITION'da güvenle TAM listeye düşer (davranış bozulmaz, sadece yavaş kalır).
 */
export function useDevicesForLabs(hospitalIds: string[] | null | undefined) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const ids = hospitalIds && hospitalIds.length > 0
    ? Array.from(new Set(hospitalIds)).sort()
    : null;
  return useQuery({
    queryKey: ['devices', 'labScoped', currentCompanyId, isSuperAdmin, ids],
    queryFn: async () => {
      const mapDocs = (snap: Awaited<ReturnType<typeof getDocs>>) =>
        snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Device));
      const fetchAll = async () => {
        const snap = await getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin));
        return filterByCompanyScope(mapDocs(snap), currentCompanyId, isSuperAdmin);
      };
      if (!ids) return fetchAll();
      try {
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
        const snaps = await Promise.all(
          chunks.map(c => getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin, where('hospitalId', 'in', c)))),
        );
        const merged: Device[] = [];
        const seen = new Set<string>();
        for (const snap of snaps) {
          for (const dev of mapDocs(snap)) {
            if (!seen.has(dev.id)) { seen.add(dev.id); merged.push(dev); }
          }
        }
        return filterByCompanyScope(merged, currentCompanyId, isSuperAdmin);
      } catch (err) {
        console.warn('useDevicesForLabs: scoped sorgu başarısız (index eksik olabilir), tam listeye düşülüyor', err);
        return fetchAll();
      }
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Purchasing Tasks - Used in Dashboard and Task Planner
 */
export function usePurchasingTasks() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['purchasingTasks', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      // Faz 4 güvenlik şapkası: son 365 gün + max 5k kayıt.
      // Tarih bazlı liste için useRecentPurchasingTasks kullanın.
      const sinceTs = Timestamp.fromDate(subDays(new Date(), 365));
      const snap = await getDocs(scopedQuery(
        'purchasingTasks',
        currentCompanyId,
        isSuperAdmin,
        where('date', '>=', sinceTs),
        orderBy('date', 'desc'),
        limit(5000),
      ));
      const tasks = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as PurchasingTask));
      return filterByCompanyScope(tasks, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Expiring Products Count - Used in Dashboard for KPI
 */
export function useExpiringProductsCount() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['expiringProductsCount', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const { getExpiringProductsCountServer } = await import('@/actions/stokActions');
      return getExpiringProductsCountServer(currentCompanyId, isSuperAdmin);
    },
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Device Groups
 */
export function useDeviceGroups() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['deviceGroups', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('deviceGroups', currentCompanyId, isSuperAdmin));
      const groups = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DeviceGroup));
      return filterByCompanyScope(groups, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Min-Max Rules for a specific depot
 */
export function useMinMaxRulesForDepot(depotId: string) {
  return useQuery({
    queryKey: ['minMaxRules', 'depot', depotId],
    queryFn: async () => {
      if (!depotId) return {};
      const snap = await getDocs(collection(db, 'depots', depotId, 'minMaxRules'));
      return snap.docs.reduce<Record<string, MinMaxRule>>((acc, d) => {
        const r = d.data() as MinMaxRule;
        if (r?.stokKodu) acc[r.stokKodu] = { ...r, id: d.id };
        return acc;
      }, {});
    },
    enabled: !!depotId,
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * Min-Max Rules for a specific hospital
 */
export function useMinMaxRulesForHospital(hospitalId: string) {
  return useQuery({
    queryKey: ['minMaxRules', 'hospital', hospitalId],
    queryFn: async () => {
      if (!hospitalId) return {};
      const snap = await getDocs(collection(db, 'hospitals', hospitalId, 'minMaxRules'));
      return snap.docs.reduce<Record<string, MinMaxRule>>((acc, d) => {
        const r = d.data() as MinMaxRule;
        if (r?.stokKodu) acc[r.stokKodu] = { ...r, id: d.id };
        return acc;
      }, {});
    },
    enabled: !!hospitalId,
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * Lab Pools
 */
export function useLabPools() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['labPools', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('labPools', currentCompanyId, isSuperAdmin));
      const labPools = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as LabPool));
      return filterByCompanyScope(labPools, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Barcode Formats - Active only
 *
 * Ürün kullanım panelinde non-superadmin (admin/user) rolleri barkod
 * okuturken "Barkod Ayrıştırma Hatası — Tanımlı formatlarla eşleşmedi"
 * alıyordu: companyId'siz veya `__legacy__` etiketli eski format kayıtları
 * scopedQuery'nin server-side `where('companyId', '==', X)` filtresine
 * takılıp dönmüyor; süperadminde filtre uygulanmadığından sorun gizli kalıyordu.
 * Yönetim panelleri (ac34a38) ile aynı tutarlılık için getScopedDocs kullanıyoruz.
 */
export function useBarcodeFormatsQuery() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['barcodeFormats', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const docs = await getScopedDocs(
        'barcodeFormats', currentCompanyId, isSuperAdmin, where('active', '==', true),
      );
      const items = docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as BarcodeFormat));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Address Definitions
 */
export function useAddressDefinitions() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['addressDefinitions', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('addressDefinitions', currentCompanyId, isSuperAdmin));
      const addresses = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as AddressDefinition));
      return filterByCompanyScope(addresses, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Users
 */
export function useUsers() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['users', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('users', currentCompanyId, isSuperAdmin));
      const users = snap.docs.map(d => ({ uid: d.id, ...processTimestamp(d.data()) } as AppUser));
      return filterByCompanyScope(users, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * Hospital ↔ Device Assignments
 * Used by device management and maintenance panels.
 */
export function useHospitalDeviceAssignments() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['hospitalDeviceAssignments', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('hospitalDeviceAssignments', currentCompanyId, isSuperAdmin));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * Personnel Availability records (office / training windows)
 */
export function usePersonnelAvailability() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['personnelAvailability', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('personnelAvailability', currentCompanyId, isSuperAdmin));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Device Fault Reports (arıza yönetimi)
 * Returns the full collection scoped to the user's company.
 * Cached briefly because faults can be opened/closed frequently throughout the day.
 */
export function useDeviceFaultReports() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['deviceFaultReports', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      // Faz 4 güvenlik şapkası: son 2 yıl + max 10k kayıt. Daha eski/büyük
      // veri için useOpenDeviceFaultReports veya useRecentDeviceFaultReports
      // variant'larını kullanın.
      const sinceTs = Timestamp.fromDate(subDays(new Date(), 730));
      const snap = await getDocs(scopedQuery(
        'deviceFaultReports',
        currentCompanyId,
        isSuperAdmin,
        where('openedAt', '>=', sinceTs),
        orderBy('openedAt', 'desc'),
        limit(10000),
      ));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DeviceFaultReport));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 1000, // 1 minute — faults change frequently
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * Teknik Servis action forms (deviceActionForms collection).
 */
export function useDeviceActionForms() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['deviceActionForms', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      // Faz 4 güvenlik şapkası: son 365 gün + max 5k kayıt.
      const sinceTs = Timestamp.fromDate(subDays(new Date(), 365));
      const snap = await getDocs(scopedQuery(
        'deviceActionForms',
        currentCompanyId,
        isSuperAdmin,
        where('createdAt', '>=', sinceTs),
        orderBy('createdAt', 'desc'),
        limit(5000),
      ));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Aplikasyon action forms (aplikasyonActionForms collection).
 */
export function useAplikasyonActionForms() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['aplikasyonActionForms', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      // Faz 4 güvenlik şapkası: son 365 gün + max 5k kayıt.
      const sinceTs = Timestamp.fromDate(subDays(new Date(), 365));
      const snap = await getDocs(scopedQuery(
        'aplikasyonActionForms',
        currentCompanyId,
        isSuperAdmin,
        where('createdAt', '>=', sinceTs),
        orderBy('createdAt', 'desc'),
        limit(5000),
      ));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

// ============================================================================
// Faz 4: Recent / Active variant'lar — büyüyen koleksiyonlar için
// dashboard/özet panellerde kullanılmak üzere tarih penceresi ya da
// hard limit ile sınırlandırılmış sürümler.
// ============================================================================

/**
 * Son N günün arıza kayıtları. Dashboard widget'ları için.
 * Varsayılan: 90 gün.
 * Composite index: (companyId, openedAt DESC).
 */
export function useRecentDeviceFaultReports(daysWindow: number = 90) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['deviceFaultReports', 'recent', daysWindow, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const sinceTs = Timestamp.fromDate(subDays(new Date(), daysWindow));
      const snap = await getDocs(scopedQuery(
        'deviceFaultReports',
        currentCompanyId,
        isSuperAdmin,
        where('openedAt', '>=', sinceTs),
        orderBy('openedAt', 'desc'),
        limit(2000),
      ));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DeviceFaultReport));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * Sadece açık (closed olmayan) arıza kayıtları. Arıza yönetimi anasayfası
 * için. Composite index: (companyId, status, openedAt DESC).
 */
export function useOpenDeviceFaultReports() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['deviceFaultReports', 'open', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery(
        'deviceFaultReports',
        currentCompanyId,
        isSuperAdmin,
        where('status', '!=', 'closed'),
        orderBy('status'),
        orderBy('openedAt', 'desc'),
        limit(1000),
      ));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DeviceFaultReport));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * Son N günün satın alma görevleri. Dashboard widget'ları için.
 * Composite index: (companyId, date DESC).
 */
export function useRecentPurchasingTasks(daysWindow: number = 90) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['purchasingTasks', 'recent', daysWindow, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const sinceTs = Timestamp.fromDate(subDays(new Date(), daysWindow));
      const snap = await getDocs(scopedQuery(
        'purchasingTasks',
        currentCompanyId,
        isSuperAdmin,
        where('date', '>=', sinceTs),
        orderBy('date', 'desc'),
        limit(1000),
      ));
      const tasks = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as PurchasingTask));
      return filterByCompanyScope(tasks, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Sadece mevcut (sevk edilmemiş) depo stoğu. Dashboard maliyet özetleri
 * ve sipariş hesapları için en sık kullanım. Sevk edilmiş kayıtlar
 * zamanla birikir ama özet için gerekmez.
 * Composite index: (companyId, isShipped, miad ASC).
 */
export function useActiveDepoStok() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['depoStok', 'active', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery(
        'depoStok',
        currentCompanyId,
        isSuperAdmin,
        where('isShipped', '==', false),
      ));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Sadece sevk edilmiş depo stoğu (lab'lardaki). İade panelleri,
 * tüketim doğrulama, lab stok raporları için.
 * Composite index: (companyId, isShipped, hedefKurumId).
 */
export function useShippedDepoStok() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['depoStok', 'shipped', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery(
        'depoStok',
        currentCompanyId,
        isSuperAdmin,
        where('isShipped', '==', true),
      ));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Son N günün tüketim kayıtları. Tüketim trend grafikleri için.
 * Varsayılan: 90 gün.
 */
export function useRecentConsumptionRecords(daysWindow: number = 90) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['tuketimKayitlari', 'recent', daysWindow, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const sinceTs = Timestamp.fromDate(subDays(new Date(), daysWindow));
      const snap = await getDocs(scopedQuery(
        'tuketimKayitlari',
        currentCompanyId,
        isSuperAdmin,
        where('consumptionTimestamp', '>=', sinceTs),
      ));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * Maintenance plans
 */
export function useMaintenancePlans() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['maintenancePlans', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('maintenancePlans', currentCompanyId, isSuperAdmin));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * Maintenance logs
 */
export function useMaintenanceLogs() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['maintenanceLogs', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('maintenanceLogs', currentCompanyId, isSuperAdmin));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Active Device Lab Pools (active == true).
 * Used by teknik-servis and aplikasyon panels.
 */
export function useDeviceLabPools() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['deviceLabPools', 'active', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(
        scopedQuery('deviceLabPools', currentCompanyId, isSuperAdmin, where('active', '==', true)),
      );
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * Fault Definitions, scoped by type ('teknik_servis' | 'aplikasyon').
 * Static catalog — long cache.
 */
export function useFaultDefinitions(type: 'teknik_servis' | 'aplikasyon' | null) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['faultDefinitions', type, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      if (!type) return [];
      const snap = await getDocs(
        scopedQuery('faultDefinitions', currentCompanyId, isSuperAdmin, where('type', '==', type)),
      );
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
    },
    enabled: !!type && (!!currentCompanyId || isSuperAdmin),
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000,
  });
}

/**
 * Maintenance plans for a specific device (optionally filtered by type).
 */
export function useMaintenancePlansForDevice(
  deviceId: string | null,
  planType?: 'teknik_servis' | 'aplikasyon',
) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['maintenancePlans', 'forDevice', deviceId, planType ?? null, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      if (!deviceId) return [];
      const constraints = [where('deviceId', '==', deviceId)];
      if (planType) constraints.push(where('type', '==', planType));
      const snap = await getDocs(scopedQuery('maintenancePlans', currentCompanyId, isSuperAdmin, ...constraints));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
    },
    enabled: !!deviceId && (!!currentCompanyId || isSuperAdmin),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Maintenance logs for a specific device, ordered by completedAt desc.
 */
export function useMaintenanceLogsForDevice(deviceId: string | null) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['maintenanceLogs', 'forDevice', deviceId, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      if (!deviceId) return [];
      const snap = await getDocs(
        scopedQuery(
          'maintenanceLogs',
          currentCompanyId,
          isSuperAdmin,
          where('deviceId', '==', deviceId),
          orderBy('completedAt', 'desc'),
        ),
      );
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
    },
    enabled: !!deviceId && (!!currentCompanyId || isSuperAdmin),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
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
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['depoStok', depotId, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      if (!depotId) return [];
      // Legacy-aware fetch: include __legacy__/untagged depoStok docs so company
      // users see the same stock super-admins do. A plain scopedQuery applies a
      // server-side `where(companyId == X)` that silently drops legacy/untagged
      // docs — e.g. goods received by a super-admin (currentCompanyId null →
      // tagged '__legacy__') or before company tagging existed. Those items then
      // vanish from the direkt-transfer / mal-kabul panels for regular users even
      // though the box is physically in the depot, while super-admins (unscoped
      // query) still see and can transfer them.
      const docs = await getScopedDocs(
        'depoStok', currentCompanyId, isSuperAdmin, where('depotId', '==', depotId),
      );
      const items = docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!depotId && (!!currentCompanyId || isSuperAdmin),
    staleTime: 5 * 60 * 1000, // 5 minutes - no polling, relies on metadata listener
    gcTime: 30 * 60 * 1000,
    // No refetchInterval - cache invalidated by useStockUpdateListener
  });
}

/**
 * Lightweight serial index for a depot (Mal Kabul duplicate detection).
 *
 * Returns a `Map<stokKodu, Set<seriNumarasi>>` built from a compact server-side
 * projection (`getDepotSerialIndex`) instead of downloading the entire depoStok
 * collection. This is what restores instant panel open + <10ms scans — the
 * client no longer ships/parses the full dataset through the Firestore web SDK.
 *
 * Keyed under the `['depoStok', ...]` prefix so it is invalidated by the same
 * `invalidateDepoStok()` calls and the `useStockUpdateListener` metadata
 * listener that refresh the rest of the depot stock data.
 *
 * Pass `{ auto: false }` to make the fetch on-demand only: the query stays
 * disabled (no read on mount / depot change) and the caller triggers it with
 * `refetch()`. Mal kabul uses this so the depot is queried only when the user
 * explicitly presses the "depo seri kontrolü" button — keeping the scan path
 * purely in-memory (in-session duplicate detection), matching direkt-transfer
 * speed.
 */
export function useDepotSerialIndex(
  depotId: string | null,
  options?: { auto?: boolean },
) {
  const auto = options?.auto ?? true;
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['depoStok', 'serialIndex', depotId, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const map = new Map<string, Set<string>>();
      if (!depotId) return map;
      const { getDepotSerialIndex } = await import('@/actions/stokActions');
      const index = await getDepotSerialIndex(depotId, currentCompanyId, isSuperAdmin);
      for (const [stokKodu, serials] of Object.entries(index)) {
        map.set(stokKodu, new Set(serials));
      }
      return map;
    },
    enabled: auto && !!depotId && (!!currentCompanyId || isSuperAdmin),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Server-side paginated grouped depot stock.
 *
 * Calls the `getPaginatedDepotStock` server action so that only the requested
 * page of grouped rows + aggregate metadata travel down the wire. Risk
 * metadata (miadDays, coverageDays, riskyBoxes, severities) is computed on the
 * server using the depot's minMaxRules and the productCodes catalog — clients
 * no longer need to ship the full depoStok dataset just to render the table.
 *
 * Cache key encodes every parameter so navigating between pages / sorts / filters
 * is instant on revisit. After mutating writes (mal kabul, transfer, ürün kullanım)
 * the metadata listener invalidates the `depoStokPaginated` query family.
 */
export function usePaginatedDepotStock(params: {
  depotId: string | null;
  page: number;
  pageSize: number;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  columnFilters?: Record<string, string[]>;
  riskyOnly?: boolean;
}) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const {
    depotId, page, pageSize, sortField, sortDirection, columnFilters, riskyOnly,
  } = params;

  // Stable cache key derived from sorted column filter entries.
  const filterKey = columnFilters
    ? Object.entries(columnFilters)
        .map(([k, v]) => `${k}:${[...v].sort().join('|')}`)
        .sort()
        .join(';')
    : '';

  return useQuery({
    queryKey: [
      'depoStokPaginated', depotId, page, pageSize,
      sortField, sortDirection, filterKey, !!riskyOnly,
      currentCompanyId, isSuperAdmin,
    ],
    queryFn: async () => {
      if (!depotId) {
        return {
          rows: [], totalRows: 0, totalPages: 0, currentPage: 1,
          riskyRowsCount: 0, riskyBoxesTotal: 0,
          columnValues: { stokAdi: [], lotNumarasi: [], miad: [], rafAdresi: [], marka: [] },
        };
      }
      const { getPaginatedDepotStock } = await import('@/actions/stokActions');
      return getPaginatedDepotStock({
        depotId,
        page,
        pageSize,
        sortField,
        sortDirection,
        columnFilters,
        riskyOnly,
        companyId: currentCompanyId,
        isSuperAdmin,
      });
    },
    enabled: !!depotId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

/**
 * Unshipped depot stock - server-side filtered by (depotId, isShipped=false).
 * Used by panels that only operate on un-shipped inventory (e.g., StokYonetimi).
 * Returns ALL un-shipped items for the depot (no client-side cap).
 */
export function useUnshippedDepoStokByDepot(depotId: string | null) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['depoStok', 'unshipped', depotId, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      if (!depotId) return [];
      // Legacy-aware fetch — see useDepoStokByDepot. Keeps __legacy__/untagged
      // depot stock visible to company users instead of being dropped by the
      // server-side companyId filter.
      const docs = await getScopedDocs(
        'depoStok',
        currentCompanyId,
        isSuperAdmin,
        where('depotId', '==', depotId),
        where('isShipped', '==', false),
      );
      const items = docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!depotId && (!!currentCompanyId || isSuperAdmin),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * All Depot Stock - For dashboard summaries and order calculations
 * No polling - invalidated via metadata listener when stock changes
 */
export function useDepoStok() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['depoStok', 'all', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin));
      const items = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));
      return filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
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
  const { currentCompanyId, isSuperAdmin } = useAuth();

  return useQuery({
    queryKey: ['depoStok', 'shipped', labIds.sort().join(','), labNames.sort().join(','), currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      if (labIds.length === 0) return [];
      // We can only use 'in' with up to 30 values
      const ids = labIds.slice(0, 30);
      const names = labNames.slice(0, 30);

      // Query by hedefKurumId
      const idSnap = await getDocs(
        scopedQuery(
          'depoStok',
          currentCompanyId,
          isSuperAdmin,
          where('hedefKurumId', 'in', ids),
          where('isShipped', '==', true),
        ),
      );
      const idResults = idSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem));

      // Also query by hedefKurum (name) for legacy records that may not have hedefKurumId
      let legacyResults: DepoStokItem[] = [];
      if (names.length > 0) {
        const nameSnap = await getDocs(
          scopedQuery(
            'depoStok',
            currentCompanyId,
            isSuperAdmin,
            where('hedefKurum', 'in', names),
            where('isShipped', '==', true),
          ),
        );
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

      return filterByCompanyScope(Array.from(resultMap.values()), currentCompanyId, isSuperAdmin);
    },
    enabled: externalEnabled && labIds.length > 0,
    // PERF (Faz 2): Önceden staleTime:0 + refetchInterval:3000 idi → tüm lab stoğunu
    // HER 3 SANİYEDE bir yeniden indiriyordu (sürekli network + render yükü; "tek en
    // zararlı hook"). useStockUpdateListener zaten stok değişiminde ['depoStok']
    // ailesini invalidate ediyor (bu key'i de kapsar) ve invalidation staleTime'ı
    // ezerek anında refetch eder; tüketim panelinin kendi invalidate'i de tazeler.
    // Bu yüzden 3sn polling kaldırıldı, staleTime modest bir değere çekildi.
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Consumption Records - Recent only (last 500)
 */
export function useRecentConsumption(limitCount = 500) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['tuketimKayitlari', 'recent', limitCount, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(
        scopedQuery(
          'tuketimKayitlari',
          currentCompanyId,
          isSuperAdmin,
          orderBy('consumptionTimestamp', 'desc'),
          limit(limitCount),
        ),
      );
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Daily Consumption Stats - Aggregated daily totals for dashboard KPI.
 * Phase 2-M: docId is `${companyId}_${dateKey}` per-tenant. Query filters
 * by `companyId` so each tenant only sees its own aggregates.
 */
export function useDailyConsumptionStats(startDate: string, endDate: string) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['dailyConsumptionStats', startDate, endDate, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(
        scopedQuery(
          'dailyConsumptionStats',
          currentCompanyId,
          isSuperAdmin,
          where('date', '>=', startDate),
          where('date', '<=', endDate),
          orderBy('date', 'asc'),
        ),
      );
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) })) as Array<{
        id: string;
        date: string;
        totalCount: number;
        byLab: Record<string, number>;
      }>;
    },
    enabled: !!currentCompanyId || isSuperAdmin,
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
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['tuketimKayitlari', 'dateRange', startDate?.toISOString(), endDate?.toISOString(), currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      if (!startDate || !endDate) return [];

      const startTimestamp = Timestamp.fromDate(startDate);
      const endTimestamp = Timestamp.fromDate(endDate);

      const snap = await getDocs(
        scopedQuery(
          'tuketimKayitlari',
          currentCompanyId,
          isSuperAdmin,
          where('consumptionTimestamp', '>=', startTimestamp),
          where('consumptionTimestamp', '<=', endTimestamp),
          orderBy('consumptionTimestamp', 'desc'),
        ),
      );
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
    },
    enabled: enabled && !!startDate && !!endDate && (!!currentCompanyId || isSuperAdmin),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

/**
 * Fetch consumption records by date range - imperative function for on-demand fetching.
 * Caller must pass company context; this function is invoked outside React, so it can't
 * read useAuth() — pass currentCompanyId/isSuperAdmin from the calling component.
 */
export async function fetchConsumptionByDateRange(
  startDate: Date,
  endDate: Date,
  currentCompanyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
): Promise<ConsumptionRecord[]> {
  const startTimestamp = Timestamp.fromDate(startDate);
  const endTimestamp = Timestamp.fromDate(endDate);

  const snap = await getDocs(
    scopedQuery(
      'tuketimKayitlari',
      currentCompanyId,
      isSuperAdmin,
      where('consumptionTimestamp', '>=', startTimestamp),
      where('consumptionTimestamp', '<=', endTimestamp),
      orderBy('consumptionTimestamp', 'desc'),
    ),
  );
  return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
}

/**
 * Shipments - Recent only
 */
export function useRecentShipments(limitCount = 200) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['shipments', 'recent', limitCount, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(
        scopedQuery(
          'shipments',
          currentCompanyId,
          isSuperAdmin,
          orderBy('createdAt', 'desc'),
          limit(limitCount),
        ),
      );
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Shipment));
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Efficiency History - Recent only
 */
export function useEfficiencyHistory(limitCount = 100) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['efficiencyHistory', 'recent', limitCount, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(
        scopedQuery(
          'efficiencyHistory',
          currentCompanyId,
          isSuperAdmin,
          orderBy('timestamp', 'desc'),
          limit(limitCount),
        ),
      );
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
    },
    enabled: !!currentCompanyId || isSuperAdmin,
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
 * Min/Max Rules for a specific depot, returned as a stokKodu → rule map.
 */
export function useDepotMinMaxRules(depotId: string | null) {
  return useQuery({
    queryKey: ['depotMinMaxRules', depotId],
    queryFn: async () => {
      const map: Record<string, MinMaxRule> = {};
      if (!depotId) return map;
      const snap = await getDocs(collection(db, 'depots', depotId, 'minMaxRules'));
      snap.forEach((d) => {
        const rule = d.data() as MinMaxRule;
        if (rule.stokKodu) map[rule.stokKodu] = rule;
      });
      return map;
    },
    enabled: !!depotId,
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
          queryClient.invalidateQueries({ queryKey: ['depoStokPaginated'] });
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
 * Considers startTime/endTime fields for accurate time-based filtering
 */
export function useActiveDutyShifts() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['dutyShifts', 'active', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const now = new Date();
      const snap = await getDocs(
        scopedQuery('dutyShifts', currentCompanyId, isSuperAdmin, where('status', '==', 'active')),
      );
      // Filter to only include shifts where current datetime is within range (including startTime/endTime)
      return filterByCompanyScope(
        snap.docs
        .map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift))
        .filter(shift => {
          const startDate = shift.startDate instanceof Date ? shift.startDate : new Date(shift.startDate as any);
          const endDate = shift.endDate instanceof Date ? shift.endDate : new Date(shift.endDate as any);

          // Build effective start datetime using startTime field
          const effectiveStart = new Date(startDate);
          if (shift.startTime) {
            const [h, m] = shift.startTime.split(':').map(Number);
            if (!isNaN(h) && !isNaN(m)) {
              effectiveStart.setHours(h, m, 0, 0);
            }
          }

          // Build effective end datetime using endTime field
          const effectiveEnd = new Date(endDate);
          if (shift.endTime) {
            const [h, m] = shift.endTime.split(':').map(Number);
            if (!isNaN(h) && !isNaN(m)) {
              effectiveEnd.setHours(h, m, 59, 999);
            }
          }

          return now >= effectiveStart && now <= effectiveEnd;
        }),
        currentCompanyId,
        isSuperAdmin
      );
    },
    enabled: !!currentCompanyId || isSuperAdmin,
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
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['dutyShifts', 'upcoming30', labId, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      if (!labId) return [];
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const thirtyDaysLater = new Date(now);
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
      thirtyDaysLater.setHours(23, 59, 59, 999);

      const snap = await getDocs(
        scopedQuery('dutyShifts', currentCompanyId, isSuperAdmin, where('status', '==', 'active')),
      );
      return filterByCompanyScope(
        snap.docs
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
        }),
        currentCompanyId,
        isSuperAdmin
      );
    },
    enabled: !!labId && (!!currentCompanyId || isSuperAdmin),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Get all duty shifts (for admin view)
 */
export function useAllDutyShifts() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['dutyShifts', 'all', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(scopedQuery('dutyShifts', currentCompanyId, isSuperAdmin));
      const shifts = filterByCompanyScope(
        snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift)),
        currentCompanyId,
        isSuperAdmin
      );
      // Sort client-side by startDate descending to avoid composite index requirement
      shifts.sort((a, b) => {
        const aTime = a.startDate instanceof Date ? a.startDate.getTime() : new Date(a.startDate as any).getTime();
        const bTime = b.startDate instanceof Date ? b.startDate.getTime() : new Date(b.startDate as any).getTime();
        return bTime - aTime;
      });
      return shifts;
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Get duty shifts by status
 */
export function useDutyShiftsByStatus(status: 'active' | 'completed' | 'cancelled') {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['dutyShifts', status, currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(
        scopedQuery('dutyShifts', currentCompanyId, isSuperAdmin, where('status', '==', status)),
      );
      const shifts = filterByCompanyScope(
        snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DutyShift)),
        currentCompanyId,
        isSuperAdmin
      );
      // Sort client-side by startDate descending to avoid composite index requirement
      shifts.sort((a, b) => {
        const aTime = a.startDate instanceof Date ? a.startDate.getTime() : new Date(a.startDate as any).getTime();
        const bTime = b.startDate instanceof Date ? b.startDate.getTime() : new Date(b.startDate as any).getTime();
        return bTime - aTime;
      });
      return shifts;
    },
    enabled: !!currentCompanyId || isSuperAdmin,
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
    invalidateDepoStok: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['depoStok'] }),
      queryClient.invalidateQueries({ queryKey: ['depoStokPaginated'] }),
    ]),
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

/**
 * Depot Stock Count Sessions (Mal Kabul)
 */
export function useDepotCountSessions(depotId: string | null) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['depotCountSessions', currentCompanyId, isSuperAdmin, depotId],
    queryFn: async () => {
      if (!depotId) return [];
      const snap = await getDocs(
        scopedQuery(
          'depotStockCountSessions',
          currentCompanyId,
          isSuperAdmin,
          where('depotId', '==', depotId),
          orderBy('createdAt', 'desc'),
        ),
      );
      const sessions = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as unknown as DepotStockCountSession));
      return filterByCompanyScope(sessions, currentCompanyId, isSuperAdmin);
    },
    enabled: !!depotId && (!!currentCompanyId || isSuperAdmin),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Scanned Items (Mal Kabul)
 */
export function useScannedItems(sessionId: string | null) {
  return useQuery({
    queryKey: ['scannedItems', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const snap = await getDocs(collection(db, 'depotStockCountSessions', sessionId, 'scannedItems'));
      return snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
    },
    enabled: !!sessionId,
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Irsaliye Files (Mal Kabul)
 */
export function useIrsaliyeFiles(depotId: string | null) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['irsaliyeFiles', currentCompanyId, isSuperAdmin, depotId],
    queryFn: async () => {
      if (!depotId) return [];
      const snap = await getDocs(
        scopedQuery(
          'irsaliyeFiles',
          currentCompanyId,
          isSuperAdmin,
          where('depotId', '==', depotId),
        ),
      );
      const files = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      return filterByCompanyScope(files, currentCompanyId, isSuperAdmin);
    },
    enabled: !!depotId && (!!currentCompanyId || isSuperAdmin),
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

/**
 * Maliyet Sayım Sessions (Dashboard)
 */
export function useMaliyetSayimSessions() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ['maliyetSayimSessions', currentCompanyId, isSuperAdmin],
    queryFn: async () => {
      const snap = await getDocs(
        scopedQuery(
          'maliyetSayimSessions',
          currentCompanyId,
          isSuperAdmin,
          orderBy('createdAt', 'desc'),
        ),
      );
      const sessions = snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as unknown as SayimSession));
      return filterByCompanyScope(sessions, currentCompanyId, isSuperAdmin);
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 1000 * 60 * 30, // 30 minutes
  });
}

/**
 * Exchange Rates
 */
export function useExchangeRates() {
  return useQuery({
    queryKey: ['exchangeRates'],
    queryFn: async () => {
      const { getExchangeRates } = await import('@/lib/exchange-rates');
      return getExchangeRates({ cacheStrategy: 'daily' });
    },
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
