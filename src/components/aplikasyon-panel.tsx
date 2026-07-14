'use client';
import React, { useState, useMemo, useEffect } from 'react';
import type { Hospital, Device, AssignedDevice, CihazYonetimiSubView, LabPool } from '@/lib/types';
import { Button as UiButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FlaskConical, ArrowLeft, Layers, ChevronRight, FileText, Package, Loader2, Map as MapIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import BackButton from './BackButton';
import { useRouter } from 'next/navigation';
import AplikasyonTutanakPDFButton from '@/components/exports/AplikasyonTutanakPDFButton';
import { useRealtimeOpenDeviceFaultReports } from '@/hooks/useRealtimeDeviceFaults';
import { getFaultyDeviceIds } from '@/lib/device-faults';



type ActionFormRecord = {
  id: string;
  deviceId: string;
  cihazAdi?: string;
  seriNumarasi?: string;
  hospitalId?: string;
  labName?: string;
  createdByName?: string;
  createdAt?: { toDate?: () => Date };
  islemTuru?: string;
  islemTipi?: string;
  cihazDurumu?: string;
  baslangicSaati?: string;
  bitisSaati?: string;
  selectedFaultName?: string;
  faultName?: string;
  selectedTests?: string[];
  aciklama?: string;
  actions?: Array<{ id?: string; action?: string; type?: string; stokKodu?: string; stokAdi?: string; quantity?: number; description?: string; serialNumber?: string; removedPartStokKodu?: string; removedPartStokAdi?: string; removedPartSerialNumber?: string; poolWarehouseName?: string }>;
  selectedMaintenanceTasks?: Array<{ id?: string; taskName?: string }>;
};





interface AplikasyonPanelProps {
  hospitals: Hospital[];
  devices: Device[];
  setDevices: React.Dispatch<React.SetStateAction<Device[]>>;
  hospitalDeviceAssignments: AssignedDevice[];
  labPools?: LabPool[];
  userAssignedLabs?: string[];
  userRole?: string;
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
  setSubView: (view: CihazYonetimiSubView) => void;
  fetchAllApplicationData: () => Promise<void>;
}

export default function AplikasyonPanel({
  hospitals, devices, hospitalDeviceAssignments, labPools = [], userAssignedLabs = [], userRole = '', toast
}: AplikasyonPanelProps) {
  const router = useRouter();
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null);

  // Open fault reports - deviceIds with active faults
  const openFaults = useRealtimeOpenDeviceFaultReports();

  // Her iki arıza türü de cihazı arızalı yapar; panel türü yalnızca yönetim yetkisini belirler.
  const faultyDeviceIds = useMemo(() => getFaultyDeviceIds(openFaults), [openFaults]);

  // Pre-group devices by hospital once per `devices` change so each card does an
  // O(1) map lookup instead of re-filtering + re-sorting the full device list
  // for every hospital/pool card on every render (including each realtime
  // open-fault snapshot). Groups are pre-sorted by display order.
  const devicesByHospitalId = useMemo(() => {
    const map = new Map<string, Device[]>();
    for (const d of devices) {
      const hid = (d as any).hospitalId as string | undefined;
      if (!hid) continue;
      const group = map.get(hid);
      if (group) group.push(d); else map.set(hid, [d]);
    }
    for (const group of map.values()) {
      group.sort((a, b) => (Number(a.order ?? 99)) - (Number(b.order ?? 99)));
    }
    return map;
  }, [devices]);

  const getDevicesForHospital = (hospitalId: string): Device[] =>
    devicesByHospitalId.get(hospitalId) ?? [];

  // Get devices for multiple hospitals (for pool summary)
  const getDevicesForHospitals = (hospitalIds: string[]): Device[] => {
    const out: Device[] = [];
    for (const id of hospitalIds) {
      const group = devicesByHospitalId.get(id);
      if (group) out.push(...group);
    }
    return out.sort((a, b) => (Number(a.order ?? 99)) - (Number(b.order ?? 99)));
  };

  // Filter hospitals based on user's assigned laboratories
  // Admin users see all labs
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';
  const filteredHospitals = useMemo(() => {
    if (isAdmin || userAssignedLabs.length === 0) {
      return hospitals;
    }
    return hospitals.filter(h => userAssignedLabs.includes(h.id));
  }, [hospitals, userAssignedLabs, isAdmin]);

  // Organize hospitals into pools and standalone
  const { poolGroups, standaloneLabs } = useMemo(() => {
    const poolGroups: { pool: LabPool; mainLab: Hospital; memberLabs: Hospital[] }[] = [];
    const labsInPools = new Set<string>();

    // Process each pool
    for (const pool of labPools) {
      // Get member labs that the user has access to
      const accessibleMembers = pool.memberIds.filter(id =>
        isAdmin || userAssignedLabs.length === 0 || userAssignedLabs.includes(id)
      );

      if (accessibleMembers.length === 0) continue;

      // Determine main lab - prefer mainLabId, otherwise use first accessible member
      const mainLabId = pool.mainLabId && accessibleMembers.includes(pool.mainLabId)
        ? pool.mainLabId
        : accessibleMembers[0];

      const mainLab = filteredHospitals.find(h => h.id === mainLabId);
      if (!mainLab) continue;

      const memberLabs = accessibleMembers
        .map(id => filteredHospitals.find(h => h.id === id))
        .filter((h): h is Hospital => h !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

      if (memberLabs.length > 0) {
        poolGroups.push({ pool, mainLab, memberLabs });
        accessibleMembers.forEach(id => labsInPools.add(id));
      }
    }

    // Standalone labs are those not in any pool
    const standaloneLabs = filteredHospitals.filter(h => !labsInPools.has(h.id));

    return { poolGroups, standaloneLabs };
  }, [filteredHospitals, labPools, userAssignedLabs, isAdmin]);

  // Helper: is device faulty? Use live open fault reports.
  const isDeviceFaulty = (d: Device) => faultyDeviceIds.has(d.id);

  // Calculate device stats for a hospital
  const getHospitalStats = (hospitalId: string) => {
    const hospitalDevices = getDevicesForHospital(hospitalId);
    const arizaSayisi = hospitalDevices.filter(isDeviceFaulty).length;
    return {
      cihazSayisi: hospitalDevices.length,
      arizaSayisi,
      devices: hospitalDevices
    };
  };

  // Calculate combined stats for a pool
  const getPoolStats = (memberIds: string[]) => {
    const poolDevices = getDevicesForHospitals(memberIds);
    const arizaSayisi = poolDevices.filter(isDeviceFaulty).length;
    return {
      cihazSayisi: poolDevices.length,
      arizaSayisi,
      devices: poolDevices
    };
  };

  // Reusable device dot indicators
  const DeviceDots = ({ devices: devs }: { devices: Device[] }) => {
    if (devs.length === 0) return null;
    const faultyCount = devs.filter((device) => isDeviceFaulty(device)).length;
    const healthyCount = devs.length - faultyCount;

    return (
      <div className="mt-3 pt-3 border-t border-[var(--dashboard-stroke)] space-y-2">
        <div className="flex items-center justify-between text-xs text-[var(--dashboard-muted)]">
          <span>Toplam {devs.length} cihaz</span>
          <span className="text-red-600">{faultyCount} arızalı</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-700">
            <span className="h-2 w-2 rounded-full bg-red-500" />Arızalı: {faultyCount}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />Sağlıklı: {healthyCount}
          </span>
        </div>
      </div>
    );
  };

  // If a pool is expanded, show labs in that pool
  if (expandedPoolId) {
    const poolGroup = poolGroups.find(pg => pg.pool.id === expandedPoolId);
    if (!poolGroup) {
      setExpandedPoolId(null);
      return null;
    }

    return (
      <div className={"device-module-page space-y-6 p-4 sm:p-6"}>
        <Card className="cihaz-card-strong border-0 bg-white/40 backdrop-blur-md border border-white/50 shadow-sm relative">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl sm:text-2xl font-headline flex items-center text-[var(--dashboard-text)]">
                <Layers className="mr-3 h-7 w-7" />
                {poolGroup.pool.name || poolGroup.mainLab.name}
              </CardTitle>
            </div>
            <CardDescription>
              Bu havuzdaki laboratuvarlar ({poolGroup.memberLabs.length} laboratuvar)
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="overflow-y-auto max-h-[calc(100vh-20rem)] p-2 sm:p-4 -m-2 sm:-m-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {poolGroup.memberLabs.map(hospital => {
              const stats = getHospitalStats(hospital.id);
              return (
                <Card
                  key={hospital.id}
                  onClick={() => router.push(`/aplikasyon-paneli/${hospital.id}`)}
                  className={cn(
                    "cihaz-card cihaz-focus-ring cursor-pointer transition-all hover:-translate-y-0.5 bg-white/40 backdrop-blur-sm border border-white/40 shadow-sm"
                  )}
                >
                  <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-sm sm:text-base font-headline text-[var(--dashboard-text)] truncate" title={hospital.name}>
                      {hospital.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-4">
                    <DeviceDots devices={stats.devices} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Main view - show pools and standalone labs
  return (
    <div className={"cihaz-shell space-y-4 sm:space-y-6 p-4 sm:p-6"}>
      <Card className="cihaz-card-strong border-0 bg-white/40 backdrop-blur-md border border-white/50 shadow-sm relative">
        <CardHeader>
          {/* Harita button top-right */}
          <div className="absolute top-4 right-4 animate-in fade-in slide-in-from-right-2 duration-500">
            <UiButton 
              variant="outline" 
              onClick={() => router.push('/aplikasyon-harita')} 
              className="px-3 py-1.5 h-auto text-xs sm:text-sm bg-white/50 hover:bg-white/80 border-white/40"
            >
              <MapIcon className="mr-2 h-4 w-4 text-[var(--dashboard-accent)]" />
              <span className="hidden sm:inline">Harita</span>
            </UiButton>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center pr-24 sm:pr-0">
            <CardTitle className="text-xl sm:text-2xl font-headline flex items-center text-[var(--dashboard-text)]">
              <FlaskConical className="mr-3 h-7 w-7 text-[var(--dashboard-accent)]" />
              Aplikasyon Paneli
            </CardTitle>
          </div>
          <CardDescription>Hastanelerdeki cihazların aplikasyon durumlarını görüntüleyin.</CardDescription>
        </CardHeader>
      </Card>

      <div className="overflow-y-auto max-h-[calc(100vh-20rem)] p-2 sm:p-4 -m-2 sm:-m-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {/* Group cards */}
          {poolGroups.map(({ pool, mainLab, memberLabs }) => {
            const stats = getPoolStats(memberLabs.map(l => l.id));
            return (
              <Card
                key={pool.id}
                onClick={() => setExpandedPoolId(pool.id)}
                className={cn(
                  "cihaz-card cihaz-focus-ring cursor-pointer transition-all hover:-translate-y-0.5 bg-white/30 backdrop-blur-sm border border-white/40 shadow-sm"
                )}
              >
                <CardHeader className="pb-1 pt-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm sm:text-base font-headline text-[var(--dashboard-text)] truncate" title={pool.name || mainLab.name}>
                      {pool.name || mainLab.name}
                    </CardTitle>
                    <div className="flex items-center text-muted-foreground">
                      <Layers className="h-4 w-4 mr-1" />
                      <span className="text-xs">{memberLabs.length}</span>
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <DeviceDots devices={stats.devices} />
                </CardContent>
              </Card>
            );
          })}

          {/* Standalone lab cards */}
          {standaloneLabs.map(hospital => {
            const stats = getHospitalStats(hospital.id);
            return (
              <Card
                key={hospital.id}
                onClick={() => router.push(`/aplikasyon-paneli/${hospital.id}`)}
                className={cn(
                  "cihaz-card cihaz-focus-ring cursor-pointer border-0 transition-all hover:-translate-y-0.5"
                )}
              >
                <CardHeader className="pb-1 pt-3">
                  <CardTitle className="text-sm sm:text-base font-headline text-[var(--dashboard-text)] truncate" title={hospital.name}>{hospital.name}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <DeviceDots devices={stats.devices} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

    </div>
  );
}
