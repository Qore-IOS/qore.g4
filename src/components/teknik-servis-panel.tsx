'use client';
import React, { useState } from 'react';
import type { Hospital, Device, AssignedDevice, CihazYonetimiSubView } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Wrench, AlertTriangle, CheckCircle, ArrowLeft, Map } from 'lucide-react';
import { cn } from '@/lib/utils';
import BackButton from './BackButton';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

interface TeknikServisPanelProps {
  hospitals: Hospital[];
  devices: Device[];
  setDevices: React.Dispatch<React.SetStateAction<Device[]>>;
  hospitalDeviceAssignments: AssignedDevice[];
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
  setSubView: (view: CihazYonetimiSubView) => void;
  fetchAllApplicationData: () => Promise<void>;
}

export default function TeknikServisPanel({
  hospitals, devices, hospitalDeviceAssignments, toast, setSubView
}: TeknikServisPanelProps) {
  const router = useRouter();

  const getDevicesForHospital = (hospitalId: string): (AssignedDevice & {device: Device})[] => {
    const assignments = hospitalDeviceAssignments.filter(hda => hda.hastaneId === hospitalId);
    return assignments.map(a => {
        const deviceDef = devices.find(d => d.id === a.deviceId)!;
        return { ...a, device: deviceDef };
    }).filter(d => d.device); // filter out if definition is missing
  };

  const hospitalDeviceStatuses = hospitals.map(hospital => {
    const hospitalDevices = getDevicesForHospital(hospital.id);
    // Count only teknik_servis faults for this panel
    const arizaSayisi = hospitalDevices.filter(d => d.device.arizaDurumu === 'teknik_servis').length;
    return {
      ...hospital,
      cihazSayisi: hospitalDevices.length,
      arizaSayisi,
      devices: hospitalDevices
    };
  });
  
  return (
    <div className={"space-y-6 p-4 sm:p-6"}>
      <BackButton fallback="/cihaz-yonetimi-ana" />
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-2xl font-headline flex items-center text-primary"><Wrench className="mr-3 h-7 w-7" />Teknik Servis Paneli</CardTitle>
          </div>
          <CardDescription>Hastanelerdeki cihazların arıza durumlarını görüntüleyin.</CardDescription>
        </CardHeader>
      </Card>

      <div className="overflow-y-auto max-h-[calc(100vh-20rem)] p-4 -m-4"> 
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {hospitalDeviceStatuses.map(hospital => (
            <Card 
              key={hospital.id} 
              onClick={() => router.push(`/teknik-servis/${hospital.id}`)}
              className={cn(
                "cursor-pointer hover:shadow-lg transition-shadow"
              )}
            >
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-base font-headline text-primary truncate" title={hospital.name}>{hospital.name}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="flex items-center mt-2">
                  {hospital.devices.slice(0, 10).map((assigned) => {
                     // For teknik servis panel: red for teknik_servis faults, amber for aplikasyon faults, green for healthy
                     const isTeknikServisFaulty = assigned.device.arizaDurumu === 'teknik_servis';
                     const isAplikasyonFaulty = assigned.device.arizaDurumu === 'aplikasyon';
                     return (
                        <span
                            key={assigned.id}
                            className={cn(
                                "h-3 w-3 rounded-full mr-1 border",
                                isTeknikServisFaulty ? 'bg-red-500' : isAplikasyonFaulty ? 'bg-amber-500' : 'bg-green-500'
                            )}
                            title={isTeknikServisFaulty ? 'Teknik Servis Arızası' : isAplikasyonFaulty ? 'Aplikasyon Arızası' : 'Sağlıklı'}
                        ></span>
                     );
                  })}
                  {hospital.cihazSayisi > 10 && <span className="text-xs text-muted-foreground ml-1">+{hospital.cihazSayisi - 10}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
