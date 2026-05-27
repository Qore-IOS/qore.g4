
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
  LabPool,
  AssignedDevice, 
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, filterByAssignedLabs } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';

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
    hospitalDeviceAssignments: [] as AssignedDevice[],
    productCodes: [] as ProductCode[],
    depoStok: [] as DepoStokItem[],
    tuketimKayitlari: [] as ConsumptionRecord[],
    efficiencyDataRecords: [] as any[], // Changed
    minMaxRulesByLab: {} as Record<string, Record<string, MinMaxRule>>,
    cihazUstuGecmisi: [] as any[],
    kumulatifRaporlar: [] as any[],
    shipments: [] as Shipment[],
    depots: [] as Depot[],
    labPools: [] as LabPool[],
    allMinMaxRules: {} as Record<string, MinMaxRule[]>,
  });
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();
  const assignedLabs = currentUserProfile?.assignedLaboratories;

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
        efficiencyHistorySnap,
        cihazUstuSnap,
        kumulatifSnap,
        shipmentsSnap,
        depotsSnap,
        labPoolsSnap,
        assignmentsSnap,
      ] = await Promise.all([
        getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('tuketimKayitlari', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('efficiencyHistory', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('cihazUstuGecmisi', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('kumulatifRaporlar', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc'))),
        getDocs(scopedQuery('shipments', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('labPools', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('hospitalDeviceAssignments', currentCompanyId, isSuperAdmin)),
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


      const hospitalsScoped = filterByCompanyScope(hospitalsData, currentCompanyId, isSuperAdmin);
      const hospitalsForUser = filterByAssignedLabs(hospitalsScoped, assignedLabs, {
        labIdFields: ['id'],
        isSuperAdmin,
      });
      const devicesAll = devicesSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Device));
      const devicesScoped = filterByCompanyScope(devicesAll, currentCompanyId, isSuperAdmin);
      const devicesForUser = filterByAssignedLabs(devicesScoped, assignedLabs, { isSuperAdmin });

      const assignmentsAll = assignmentsSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as AssignedDevice));
      const assignmentsScoped = filterByCompanyScope(assignmentsAll, currentCompanyId, isSuperAdmin);
      const assignmentsForUser = filterByAssignedLabs(assignmentsScoped, assignedLabs, { isSuperAdmin });

      const tuketimAll = tuketimKayitlariSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ConsumptionRecord));
      const tuketimScoped = filterByCompanyScope(tuketimAll, currentCompanyId, isSuperAdmin);
      const tuketimForUser = filterByAssignedLabs(tuketimScoped, assignedLabs, { isSuperAdmin });

      const efficiencyAll = efficiencyHistorySnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      const efficiencyScoped = filterByCompanyScope(efficiencyAll, currentCompanyId, isSuperAdmin);
      const efficiencyForUser = filterByAssignedLabs(efficiencyScoped, assignedLabs, { isSuperAdmin });

      const cihazUstuAll = cihazUstuSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      const cihazUstuScoped = filterByCompanyScope(cihazUstuAll, currentCompanyId, isSuperAdmin);
      const cihazUstuForUser = filterByAssignedLabs(cihazUstuScoped, assignedLabs, { isSuperAdmin });

      const kumulatifAll = kumulatifSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) }));
      const kumulatifScoped = filterByCompanyScope(kumulatifAll, currentCompanyId, isSuperAdmin);
      const kumulatifForUser = filterByAssignedLabs(kumulatifScoped, assignedLabs, { isSuperAdmin });

      const shipmentsAll = shipmentsSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Shipment));
      const shipmentsScoped = filterByCompanyScope(shipmentsAll, currentCompanyId, isSuperAdmin);

      const depotsAll = depotsSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as Depot));
      const depotsScoped = filterByCompanyScope(depotsAll, currentCompanyId, isSuperAdmin);

      const labPoolsAll = labPoolsSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as LabPool));
      const labPoolsScoped = filterByCompanyScope(labPoolsAll, currentCompanyId, isSuperAdmin);

      setData({
        hospitals: hospitalsForUser,
        devices: devicesForUser,
        hospitalDeviceAssignments: assignmentsForUser,
        productCodes: productCodesSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as ProductCode)),
        depoStok: filterByCompanyScope(
          depoStokSnap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem)),
          currentCompanyId,
          isSuperAdmin,
        ),
        tuketimKayitlari: tuketimForUser,
        efficiencyDataRecords: efficiencyForUser,
        cihazUstuGecmisi: cihazUstuForUser,
        kumulatifRaporlar: kumulatifForUser,
        shipments: shipmentsScoped,
        depots: depotsScoped,
        minMaxRulesByLab: minMaxRulesByLabLegacy,
        labPools: labPoolsScoped,
        allMinMaxRules
      });

    } catch (error) {
      console.error("Dashboard data fetch error:", error);
      toast({ title: "Gösterge Paneli Hatası", description: "Veriler yüklenirken bir hata oluştu.", variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin, assignedLabs]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { ...data, isLoading, refetch: fetchData };
}
