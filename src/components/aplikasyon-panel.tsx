'use client';
import React from 'react';
import type { Hospital, Device, AssignedDevice, CihazYonetimiSubView } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FlaskConical, AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import BackButton from './BackButton';
import { useRouter } from 'next/navigation';

interface AplikasyonPanelProps {
  hospitals: Hospital[];
  devices: Device[];
  setDevices: React.Dispatch<React.SetStateAction<Device[]>>;
  hospitalDeviceAssignments: AssignedDevice[];
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
  setSubView: (view: CihazYonetimiSubView) => void;
  fetchAllApplicationData: () => Promise<void>;
}

export default function AplikasyonPanel({
  hospitals, devices, hospitalDeviceAssignments
}: AplikasyonPanelProps) {
  const router = useRouter();

  const getDevicesForHospital = (hospitalId: string): (AssignedDevice & {device: Device})[] => {
    const assignments = hospitalDeviceAssignments.filter(hda => hda.hastaneId === hospitalId);
    return assignments.map(a => {
        const deviceDef = devices.find(d => d.id === a.deviceId)!;
        return { ...a, device: deviceDef };
    }).filter(d => d.device);
  };

  const hospitalDeviceStatuses = hospitals.map(hospital => {
    const hospitalDevices = getDevicesForHospital(hospital.id);
    // Only count aplikasyon faults for this panel
    const arizaSayisi = hospitalDevices.filter(d => d.device.arizaDurumu === 'aplikasyon').length;
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
            <CardTitle className="text-2xl font-headline flex items-center text-primary"><FlaskConical className="mr-3 h-7 w-7" />Aplikasyon Paneli</CardTitle>
          </div>
          <CardDescription>Hastanelerdeki cihazların aplikasyon durumlarını görüntüleyin.</CardDescription>
        </CardHeader>
      </Card>

      <div className="overflow-y-auto max-h-[calc(100vh-20rem)] p-4 -m-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {hospitalDeviceStatuses.map(hospital => (
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
                  {hospital.devices.slice(0, 10).map((assigned) => {
                     // For aplikasyon panel, show red only for aplikasyon faults
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
