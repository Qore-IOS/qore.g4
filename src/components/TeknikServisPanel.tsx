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

  const getDevicesForHospital = (hospitalId: string): Device[] => {
    return devices
      .filter(d => (d as any).hospitalId === hospitalId)
      .sort((a, b) => (Number(a.order ?? 99)) - (Number(b.order ?? 99)));
  };

  const hospitalDeviceStatuses = hospitals.map(hospital => {
    const hospitalDevices = getDevicesForHospital(hospital.id);
    const arizaSayisi = hospitalDevices.filter(d => d.arizaDurumu !== 'yok' && d.arizaDurumu !== undefined).length;
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
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-headline text-primary truncate" title={hospital.name}>{hospital.name}</CardTitle>
              </CardHeader>
              <CardContent>
                {hospital.arizaSayisi > 0 ? (
                  <p className="text-sm text-red-500 font-semibold flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-1" /> {hospital.arizaSayisi} Cihaz Arızalı
                  </p>
                ) : (
                   hospital.cihazSayisi > 0 ? (
                    <p className="text-sm text-green-600 font-semibold flex items-center">
                        <CheckCircle className="h-4 w-4 mr-1" /> Tüm Cihazlar Sağlıklı
                    </p>
                   ) : (
                    <p className="text-sm text-muted-foreground font-medium flex items-center">
                        Cihaz Yok
                    </p>
                   )
                )}
                {hospital.devices.length > 0 && (
                  <div className="flex items-center justify-center flex-wrap gap-1.5 mt-3 pt-3 border-t">
                    {hospital.devices.map((device) => {
                       const isFaulty = device.arizaDurumu !== 'yok' && device.arizaDurumu !== undefined;
                       return (
                          <span
                              key={device.id}
                              className={cn(
                                  "h-2.5 w-2.5 rounded-full transition-all",
                                  isFaulty
                                    ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]'
                                    : 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                              )}
                              title={`${device.cihazAdi || device.model} - ${isFaulty ? 'Arızalı' : 'Sağlıklı'}`}
                          ></span>
                       );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
