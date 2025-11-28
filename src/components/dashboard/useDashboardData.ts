
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection,
  getDocs,
  Timestamp,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  Hospital,
  DepoStokItem,
  Device,
  ConsumptionRecord,
  ProductCode,
  MinMaxRule,
  Shipment,
  Depot,
  LabPool,
  AssignedDevice, 
} from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { trackListener } from "@/lib/listener-monitor";

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
    efficiencyHistoryRecords: [] as any[],
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

  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const fetchData = useCallback(async () => {
    trackListener("useDashboardData", "create");
    setIsLoading(true);
    let allUnsubs: (()=>void)[] = [];
    try {
      // Fetch smaller, essential collections once
      const [
        hospitalsSnap,
        devicesSnap,
        productCodesSnap,
        depotsSnap,
        labPoolsSnap,
      ] = await Promise.all([
        getDocs(collection(db, "hospitals")),
        getDocs(collection(db, "devices")),
        getDocs(collection(db, "productCodes")),
        getDocs(collection(db, "depots")),
        getDocs(collection(db, "labPools")),
      ]);

      const hospitalsData = hospitalsSnap.docs.map(
        (d) => ({ id: d.id, ...processTimestamp(d.data()) } as Hospital)
      );

      const rulesPromises = hospitalsData.map(h => 
        getDocs(collection(db, "hospitals", h.id, "minMaxRules")).then(
          (snap) => ({
            labId: h.id,
            rules: snap.docs.map((d) => d.data() as MinMaxRule)
          })
        )
      );
      
      const rulesResults = await Promise.all(rulesPromises);
      const minMaxRulesByLabLegacy = rulesResults.reduce((acc, res) => {
        const rulesMap: Record<string, MinMaxRule> = {};
        res.rules.forEach((rule) => {
          if (rule.stokKodu) rulesMap[rule.stokKodu] = rule;
        });
        acc[res.labId] = rulesMap;
        return acc;
      }, {} as Record<string, Record<string, MinMaxRule>>);

      const allMinMaxRules = rulesResults.reduce((acc, res) => {
        acc[res.labId] = res.rules;
        return acc;
      }, {} as Record<string, MinMaxRule[]>);

      setData((prev) => ({
        ...prev,
        hospitals: hospitalsData,
        devices: devicesSnap.docs.map(
          (d) => ({ id: d.id, ...processTimestamp(d.data()) } as Device)
        ),
        productCodes: productCodesSnap.docs.map(
          (d) => ({ id: d.id, ...processTimestamp(d.data()) } as ProductCode)
        ),
        depots: depotsSnap.docs.map(
          (d) => ({ id: d.id, ...processTimestamp(d.data()) } as Depot)
        ),
        labPools: labPoolsSnap.docs.map(
          (d) => ({ id: d.id, ...processTimestamp(d.data()) } as LabPool)
        ),
        minMaxRulesByLab: minMaxRulesByLabLegacy,
        allMinMaxRules,
      }));

      // Now set up listeners for large/changing collections
      const unsubDepoStok = onSnapshot(collection(db, "depoStok"), (snap) => {
        setData((prev) => ({
          ...prev,
          depoStok: snap.docs.map(
            (d) => ({ id: d.id, ...processTimestamp(d.data()) } as DepoStokItem)
          ),
        }));
      });

      const unsubTuketim = onSnapshot(
        query(collection(db, "tuketimKayitlari"), orderBy('consumptionTimestamp', 'desc')),
        (snap) => {
          setData((prev) => ({
            ...prev,
            tuketimKayitlari: snap.docs.map(
              (d) =>
                ({
                  id: d.id,
                  ...processTimestamp(d.data()),
                } as ConsumptionRecord)
            ),
          }));
        }
      );

      const unsubEfficiency = onSnapshot(
        collection(db, "efficiencyHistory"),
        (snap) => {
          setData((prev) => ({
            ...prev,
            efficiencyHistoryRecords: snap.docs.map((d) => ({
              id: d.id,
              ...processTimestamp(d.data()),
            })),
          }));
        }
      );

      const unsubShipments = onSnapshot(collection(db, "shipments"), (snap) => {
        setData((prev) => ({
          ...prev,
          shipments: snap.docs.map(
            (d) => ({ id: d.id, ...processTimestamp(d.data()) } as Shipment)
          ),
        }));
      });
      
      const unsubCihazUstu = onSnapshot(collection(db, 'cihazUstuGecmisi'), (snap) => {
        setData((prev) => ({ ...prev, cihazUstuGecmisi: snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) })) }));
      });
      
      const unsubKumulatif = onSnapshot(query(collection(db, 'kumulatifRaporlar'), orderBy('createdAt', 'desc')), (snap) => {
        setData((prev) => ({ ...prev, kumulatifRaporlar: snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) })) }));
      });

      const unsubAssignments = onSnapshot(collection(db, 'hospitalDeviceAssignments'), (snap) => {
        setData(prev => ({ ...prev, hospitalDeviceAssignments: snap.docs.map(d => ({ id: d.id, ...processTimestamp(d.data()) } as AssignedDevice))}));
      });

      allUnsubs = [unsubDepoStok, unsubTuketim, unsubEfficiency, unsubShipments, unsubCihazUstu, unsubKumulatif, unsubAssignments];
      
      // After all initial data is loaded and listeners are set up
      setIsLoading(false);

      // Return a cleanup function for all listeners
      return () => {
        trackListener("useDashboardData", "cleanup");
        allUnsubs.forEach(unsub => unsub());
      };
    } catch (error) {
      console.error("Dashboard data fetch error:", error);
      toastRef.current({
        title: "Gösterge Paneli Hatası",
        description: "Veriler yüklenirken bir hata oluştu.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  }, []); 

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    fetchData().then((cleanupFn) => {
      if (cleanupFn) {
        cleanup = cleanupFn;
      }
    });
    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [fetchData]);

  return { ...data, isLoading, refetch: fetchData, toast };
}
