/**
 * useCompanyStats — Faz 5 pre-aggregated dashboard özet hook'u.
 *
 * `companyStats/{companyId}` dokümanını okur. Bu doküman Cloud Functions
 * tarafından depoStok, tuketimKayitlari, shipments, deviceFaultReports
 * koleksiyonlarına yazıldığında otomatik güncellenir.
 *
 * Avantajı: Dashboard sayfa açılışında 10+ koleksiyon scan'i yerine
 * tek bir doc okuması (~50ms). 100 firmaya hizmet veren bir kurulumda
 * bu fark milyon read/gün'ü binler seviyesine düşürür.
 *
 * Kullanım:
 *   const { data: stats } = useCompanyStats();
 *   stats?.stock?.activeCount       // Aktif depo stok sayısı
 *   stats?.consumption?.todayCount  // Bugünkü tüketim adedi
 *   stats?.faults?.openCount        // Açık arıza sayısı
 *
 * SuperAdmin: tüm firmaların özetlerini görmek için ayrı bir
 * `useAllCompaniesStats` variant'ı eklenebilir.
 */
'use client';

import { useQuery } from '@tanstack/react-query';
import { doc, getDoc, onSnapshot } from '../lib/data/client';
import { useEffect } from 'react';
import { db } from '../lib/data/client';
import { useAuth } from '@/contexts/auth-context';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeCompanyId } from '@/lib/company-scope';

export interface CompanyStats {
  companyId: string;
  updatedAt?: { toDate: () => Date } | Date;
  stock?: {
    activeCount?: number;
    shippedCount?: number;
  };
  consumption?: {
    todayCount?: number;
    last30DaysCount?: number;
  };
  shipments?: {
    todayCount?: number;
    last30DaysCount?: number;
  };
  faults?: {
    openCount?: number;
    last30DaysTotal?: number;
  };
}

/**
 * Tek dashboard özetini (firma için) gerçek zamanlı okur.
 * Cloud Function trigger güncellediği anda re-render olur.
 */
export function useCompanyStats() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const normalizedId = normalizeCompanyId(currentCompanyId);
  const queryKey = ['companyStats', normalizedId];

  // İlk yükleme — cache'ten oku.
  const query = useQuery<CompanyStats | null>({
    queryKey,
    queryFn: async () => {
      if (!currentCompanyId && !isSuperAdmin) return null;
      // SuperAdmin için tek bir özet anlamlı değil; null döndür.
      if (isSuperAdmin && !currentCompanyId) return null;
      const ref = doc(db, 'companyStats', normalizedId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return { companyId: normalizedId, ...snap.data() } as CompanyStats;
    },
    enabled: !!currentCompanyId || isSuperAdmin,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  // Realtime listener — Cloud Function yazdığı anda cache'i güncelle.
  useEffect(() => {
    if (!currentCompanyId && !isSuperAdmin) return;
    if (!normalizedId || normalizedId === '__legacy__') return;
    const ref = doc(db, 'companyStats', normalizedId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const next: CompanyStats | null = snap.exists()
          ? ({ companyId: normalizedId, ...snap.data() } as CompanyStats)
          : null;
        queryClient.setQueryData(queryKey, next);
      },
      (err) => {
        // Sessiz geç — query.refetch zaten fallback sağlar.
        console.warn('[useCompanyStats] subscription error:', err);
      },
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedId, currentCompanyId, isSuperAdmin]);

  return query;
}
