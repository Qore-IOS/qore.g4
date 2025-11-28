
'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, Timestamp, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type {
  Hospital,
  DepoStokItem,
  Device,
  ConsumptionRecord,
  EfficiencyData,
  ProductCode,
  MinMaxRule,
  Shipment,
  Depot,
  LabPool, // Added LabPool
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

const processTimestamp = (docData: any) => {
  const data = { ...docData };
  Object.keys(data).forEach(key => {
    if (data[key] instanceof Timestamp) {
      data[key] = data[key].toDate();
    }
  });
  return data;
};

// This centralizes the data fetching logic for the dashboard and related components.
export function useDashboardData() {
  const [data, setData] = useState({
    hospitals: [] as Hospital[],
    devices: [] as Device[],
    productCodes: [] as ProductCode[],
    depoStok: [] as DepoStokItem[],
    tuketimKayitlari: [] as ConsumptionRecord[],
    efficiencyHistoryRecords: [] as any[], // Changed
    minMaxRulesByLab: {} as Record<string, Record<string, MinMaxRule>>,
    cihazUstuGecmisi: [] as any[],
    kumulatifRaporlar: [] as any[],
    shipments: [] as Shipment[],
    depots: [] as Depot[],
    labPools: [] as LabPool[], // Added labPools
    allMinMaxRules: {} as Record<string, MinMaxRule[]>,
  });
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Using Promise.all for parallel fetching
      const [
        hospitalsSnap,
        devicesSnap,
        productCodesSnap,
        depoStokSnap,
        tuketimKayitlariSnap,
        efficiencyHistorySnap, // Changed
        cihazUstuSnap,
        kumulatifSnap,
        shipmentsSnap,
        depotsSnap,
        labPoolsSnap, // Fetch lab pools
      ] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'devices')),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'depoStok')),
        getDocs(collection(db, 'tuketimKayitlari')),
        getDocs(collection(db, 'efficiencyHistory')), // Changed
        getDocs(collection(db, 'cihazUstuGecmisi')),
        getDocs(query(collection(db, 'kumulatifRaporlar'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'shipments')),
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'labPools')), // Fetch lab pools
      ]);

      const hospitalsData = hospitalsSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Hospital));

      const rulesPromises = hospitalsData.map(h => 
        getDocs(collection(db, 'hospitals', h.id, 'minMaxRules'))
          .then(snap => ({
            labId: h.id,
            rules: snap.docs.map(d => d.data() as MinMaxRule)
          }))
      );
      
      const rulesResults = await Promise.all(rulesPromises);
      const minMaxRulesByLabLegacy = rulesResults.reduce((acc, res) => {
        const rulesMap: Record<string, MinMaxRule> = {};
        res.rules.forEach(rule => { if(rule.stokKodu) rulesMap[rule.stokKodu] = rule });
        acc[res.labId] = rulesMap;
        return acc;
      }, {} as Record<string, Record<string, MinMaxRule>>);

      const allMinMaxRules = rulesResults.reduce((acc, res) => {
        acc[res.labId] = res.rules;
        return acc;
      }, {} as Record<string, MinMaxRule[]>);


      setData({
        hospitals: hospitalsData,
        devices: devicesSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Device)),
        productCodes: productCodesSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ProductCode)),
        depoStok: depoStokSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem)),
        tuketimKayitlari: tuketimKayitlariSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord)),
        efficiencyHistoryRecords: efficiencyHistorySnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) })), // Changed
        cihazUstuGecmisi: cihazUstuSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) })),
        kumulatifRaporlar: kumulatifSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) })),
        shipments: shipmentsSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Shipment)),
        depots: depotsSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Depot)),
        minMaxRulesByLab: minMaxRulesByLabLegacy,
        labPools: labPoolsSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as LabPool)), // Set lab pools
        allMinMaxRules
      });

    } catch (error) {
      console.error("Dashboard data fetch error:", error);
      toast({ title: "Gösterge Paneli Hatası", description: "Veriler yüklenirken bir hata oluştu.", variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, []); // Changed to run only once on mount

  return { ...data, isLoading, refetch: fetchData, toast };
}
