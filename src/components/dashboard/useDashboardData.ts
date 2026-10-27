
'use client';

/**
 * Optimized Dashboard Data Hook - Phase 1 Cleanup
 *
 * Removed KPIs:
 * - Laboratuvar Stok Doluluk Oranları (required: depoStok, minMaxRules)
 * - Açık Arıza Kayıtları (required: devices)
 * - Miadı Yaklaşanlar (required: depoStok)
 *
 * Current KPIs:
 * - Tüketim Trendi (requires: tuketimKayitlari, hospitals)
 * - Verimlilik Oranları (requires: efficiencyHistoryRecords, hospitals, productCodes)
 */

import {
  useHospitals,
  useProductCodes,
  useRecentConsumption,
  useEfficiencyHistory,
  useInvalidateQueries,
} from '@/hooks/useDatabaseQueries';
import { useToast } from '@/hooks/use-toast';

/**
 * Main dashboard data hook - optimized for current KPIs only
 */
export function useDashboardData() {
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateQueries();

  // Static data - hospitals and product codes
  const hospitalsQuery = useHospitals();
  const productsQuery = useProductCodes();

  // Dynamic data - consumption and efficiency
  const consumptionQuery = useRecentConsumption(500);
  const efficiencyQuery = useEfficiencyHistory(100);

  // Compute isLoading state
  const isLoading =
    hospitalsQuery.isLoading ||
    productsQuery.isLoading;

  // Refetch function for manual refresh
  const refetch = () => {
    invalidateAll();
    toast({
      title: 'Veriler Yenileniyor',
      description: 'Tüm veriler arka planda güncelleniyor...',
    });
  };

  return {
    hospitals: hospitalsQuery.data ?? [],
    productCodes: productsQuery.data ?? [],
    tuketimKayitlari: consumptionQuery.data ?? [],
    efficiencyHistoryRecords: efficiencyQuery.data ?? [],
    isLoading,
    refetch,
    toast,
  };
}

/**
 * Lightweight version for components that only need static data
 */
export function useLightDashboardData() {
  const hospitalsQuery = useHospitals();
  const productsQuery = useProductCodes();

  const isLoading =
    hospitalsQuery.isLoading ||
    productsQuery.isLoading;

  return {
    hospitals: hospitalsQuery.data ?? [],
    productCodes: productsQuery.data ?? [],
    isLoading,
  };
}
