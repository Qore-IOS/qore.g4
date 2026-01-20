'use client';
import React, { useState, useMemo } from 'react';
import type { Hospital, Device, AssignedDevice, CihazYonetimiSubView, LabPool } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FlaskConical, ArrowLeft, Layers, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import BackButton from './BackButton';
import { useRouter } from 'next/navigation';

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
  hospitals, devices, hospitalDeviceAssignments, labPools = [], userAssignedLabs = [], userRole = ''
}: AplikasyonPanelProps) {
  const router = useRouter();
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null);

  const getDevicesForHospital = (hospitalId: string): (AssignedDevice & {device: Device})[] => {
    const assignments = hospitalDeviceAssignments.filter(hda => hda.hastaneId === hospitalId);
    return assignments.map(a => {
        const deviceDef = devices.find(d => d.id === a.deviceId)!;
        return { ...a, device: deviceDef };
    }).filter(d => d.device);
  };

  // Get devices for multiple hospitals (for pool summary)
  const getDevicesForHospitals = (hospitalIds: string[]): (AssignedDevice & {device: Device})[] => {
    const assignments = hospitalDeviceAssignments.filter(hda => hospitalIds.includes(hda.hastaneId));
    return assignments.map(a => {
        const deviceDef = devices.find(d => d.id === a.deviceId)!;
        return { ...a, device: deviceDef };
    }).filter(d => d.device);
  };

  // Filter hospitals based on user's assigned laboratories
  // Admin users see all labs
  const isAdmin = userRole === 'admin';
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
        .filter((h): h is Hospital => h !== undefined);

      if (memberLabs.length > 0) {
        poolGroups.push({ pool, mainLab, memberLabs });
        accessibleMembers.forEach(id => labsInPools.add(id));
      }
    }

    // Standalone labs are those not in any pool
    const standaloneLabs = filteredHospitals.filter(h => !labsInPools.has(h.id));

    return { poolGroups, standaloneLabs };
  }, [filteredHospitals, labPools, userAssignedLabs, isAdmin]);

  // Calculate device stats for a hospital
  const getHospitalStats = (hospitalId: string) => {
    const hospitalDevices = getDevicesForHospital(hospitalId);
    const arizaSayisi = hospitalDevices.filter(d => d.device.arizaDurumu === 'aplikasyon').length;
    return {
      cihazSayisi: hospitalDevices.length,
      arizaSayisi,
      devices: hospitalDevices
    };
  };

  // Calculate combined stats for a pool
  const getPoolStats = (memberIds: string[]) => {
    const poolDevices = getDevicesForHospitals(memberIds);
    const arizaSayisi = poolDevices.filter(d => d.device.arizaDurumu === 'aplikasyon').length;
    return {
      cihazSayisi: poolDevices.length,
      arizaSayisi,
      devices: poolDevices
    };
  };

  // If a pool is expanded, show labs in that pool
  if (expandedPoolId) {
    const poolGroup = poolGroups.find(pg => pg.pool.id === expandedPoolId);
    if (!poolGroup) {
      setExpandedPoolId(null);
      return null;
    }

    return (
      <div className={"space-y-6 p-4 sm:p-6"}>
        <Button variant="ghost" onClick={() => setExpandedPoolId(null)} className="mb-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Geri
        </Button>
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-2xl font-headline flex items-center text-primary">
                <Layers className="mr-3 h-7 w-7" />
                {poolGroup.pool.name || poolGroup.mainLab.name}
              </CardTitle>
            </div>
            <CardDescription>
              Bu havuzdaki laboratuvarlar ({poolGroup.memberLabs.length} laboratuvar)
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="overflow-y-auto max-h-[calc(100vh-20rem)] p-4 -m-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {poolGroup.memberLabs.map(hospital => {
              const stats = getHospitalStats(hospital.id);
              return (
                <Card
                  key={hospital.id}
                  onClick={() => router.push(`/aplikasyon-paneli/${hospital.id}`)}
                  className={cn(
                    "cursor-pointer hover:shadow-lg transition-shadow"
                  )}
                >
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-base font-headline text-primary truncate" title={hospital.name}>
                      {hospital.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-4">
                    <div className="flex items-center mt-2">
                      {stats.devices.slice(0, 10).map((assigned) => {
                         const isAplikasyonFaulty = assigned.device.arizaDurumu === 'aplikasyon';
                         return (
                            <span
                                key={assigned.id}
                                className={cn(
                                    "h-3 w-3 rounded-full mr-1 border",
                                    isAplikasyonFaulty ? 'bg-red-500' : 'bg-green-500'
                                )}
                                title={isAplikasyonFaulty ? 'Aplikasyon Arızası' : 'Sağlıklı'}
                            ></span>
                         );
                      })}
                      {stats.cihazSayisi > 10 && <span className="text-xs text-muted-foreground ml-1">+{stats.cihazSayisi - 10}</span>}
                    </div>
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
    <div className={"space-y-6 p-4 sm:p-6"}>
      <BackButton fallback="/cihaz-yonetimi-ana" />
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-2xl font-headline flex items-center text-primary"><FlaskConical className="mr-3 h-7 w-7" />Aplikasyon Paneli</CardTitle>
          </div>
          <CardDescription>Hastanelerdeki cihazların aplikasyon durumlarını görüntüleyin.</CardDescription>
        </CardHeader>
      </Card>

      <div className="overflow-y-auto max-h-[calc(100vh-20rem)] p-4 -m-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Pool cards - show main lab as representative */}
          {poolGroups.map(({ pool, mainLab, memberLabs }) => {
            const stats = getPoolStats(memberLabs.map(l => l.id));
            return (
              <Card
                key={pool.id}
                onClick={() => setExpandedPoolId(pool.id)}
                className={cn(
                  "cursor-pointer hover:shadow-lg transition-shadow border-2 border-primary/20"
                )}
              >
                <CardHeader className="pb-2 pt-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-headline text-primary truncate" title={mainLab.name}>
                      {mainLab.name}
                    </CardTitle>
                    <div className="flex items-center text-muted-foreground">
                      <Layers className="h-4 w-4 mr-1" />
                      <span className="text-xs">{memberLabs.length}</span>
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </div>
                  </div>
                  {pool.name && pool.name !== mainLab.name && (
                    <p className="text-xs text-muted-foreground">{pool.name}</p>
                  )}
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <div className="flex items-center mt-2">
                    {stats.devices.slice(0, 10).map((assigned) => {
                       const isAplikasyonFaulty = assigned.device.arizaDurumu === 'aplikasyon';
                       return (
                          <span
                              key={assigned.id}
                              className={cn(
                                  "h-3 w-3 rounded-full mr-1 border",
                                  isAplikasyonFaulty ? 'bg-red-500' : 'bg-green-500'
                              )}
                              title={isAplikasyonFaulty ? 'Aplikasyon Arızası' : 'Sağlıklı'}
                          ></span>
                       );
                    })}
                    {stats.cihazSayisi > 10 && <span className="text-xs text-muted-foreground ml-1">+{stats.cihazSayisi - 10}</span>}
                  </div>
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
                  "cursor-pointer hover:shadow-lg transition-shadow"
                )}
              >
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-base font-headline text-primary truncate" title={hospital.name}>{hospital.name}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <div className="flex items-center mt-2">
                    {stats.devices.slice(0, 10).map((assigned) => {
                       const isAplikasyonFaulty = assigned.device.arizaDurumu === 'aplikasyon';
                       return (
                          <span
                              key={assigned.id}
                              className={cn(
                                  "h-3 w-3 rounded-full mr-1 border",
                                  isAplikasyonFaulty ? 'bg-red-500' : 'bg-green-500'
                              )}
                              title={isAplikasyonFaulty ? 'Aplikasyon Arızası' : 'Sağlıklı'}
                          ></span>
                       );
                    })}
                    {stats.cihazSayisi > 10 && <span className="text-xs text-muted-foreground ml-1">+{stats.cihazSayisi - 10}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
