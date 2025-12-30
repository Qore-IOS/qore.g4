
'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle, Loader2, Wrench, FilePenLine, FlaskConical } from 'lucide-react';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  getDocs,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital, Device, DeviceFaultReport } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';


export default function TeknikServisDetayPage() {
  const params = useParams();
  const hospitalId = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);
  const router = useRouter();
  const { toast } = useToast();

  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [devicesByHospital, setDevicesByHospital] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [faultIdForSelectedDevice, setFaultIdForSelectedDevice] = useState<string | null>(null);
  const [selectedDeviceFaultType, setSelectedDeviceFaultType] = useState<string | null>(null);


  // --- Fetch hospital once ---
  useEffect(() => {
    if (!hospitalId) {
      router.push('/teknik-servis');
      return;
    }
    const unsub = onSnapshot(doc(db, 'hospitals', hospitalId), (doc) => {
        if(doc.exists()) {
            setHospital({ id: doc.id, ...(doc.data() as any) });
        }
    });
    return () => unsub();
  }, [hospitalId, router]);

  // --- Live devices for this hospital ---
  useEffect(() => {
    if (!hospitalId) {
      setDevicesByHospital([]);
      return;
    }
    setLoading(true);
    const qDevices = query(collection(db, 'devices'), where('hospitalId', '==', hospitalId));
    const unsub = onSnapshot(
      qDevices,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Device))
          .sort((a, b) => (String(a.order ?? 99)).localeCompare(String(b.order ?? 99)));
        setDevicesByHospital(list);
        setLoading(false);
      },
      (err) => {
        console.error('devices listen error', err);
        toast({ title: 'Hata', description: 'Cihazlar yüklenemedi.', variant: 'destructive' });
        setDevicesByHospital([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [hospitalId, toast]);
  
  const handleDeviceClick = async (device: Device) => {
    // For teknik servis panel:
    // - If device has teknik_servis fault, show modal with options
    // - If device has aplikasyon fault, show info that it's an aplikasyon fault (can't manage)
    // - If no fault, go directly to islem-formu
    if (device.arizaDurumu && device.arizaDurumu !== 'yok') {
      setSelectedDevice(device);
      setSelectedDeviceFaultType(device.arizaDurumu);
      // Find the open fault report for this device
      try {
        const q = query(
          collection(db, 'deviceFaultReports'),
          where('deviceId', '==', device.id),
          where('status', '==', 'open'),
          limit(1)
        );
        const faultSnap = await getDocs(q);
        if (!faultSnap.empty) {
          setFaultIdForSelectedDevice(faultSnap.docs[0].id);
        } else {
          setFaultIdForSelectedDevice(null); // No open fault found
        }
      } catch (error) {
        console.error("Error finding open fault report:", error);
        setFaultIdForSelectedDevice(null);
      }
      setIsModalOpen(true);
    } else {
      router.push(`/teknik-servis/islem-formu/${device.id}`);
    }
  };

  const navigateToAction = (path: string) => {
    setIsModalOpen(false);
    router.push(path);
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="ml-4 text-lg">Yükleniyor...</p>
      </div>
    );
  }

  if (!hospital) {
    return <div className="text-center p-8">Hastane bulunamadı.</div>;
  }

  return (
    <>
      <div className="space-y-6 p-4 sm:p-6">
        <BackButton fallback="/teknik-servis" />
        <CardHeader className="px-0 sm:px-6">
          <CardTitle className="text-2xl font-headline text-primary">
            {hospital.name} - Cihaz Durumları
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {devicesByHospital.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Bu hastane için tanımlı cihaz bulunmuyor.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {devicesByHospital.map((device) => {
                // For teknik servis panel: show red for teknik_servis faults, amber for aplikasyon faults
                const isTeknikServisFaulty = device.arizaDurumu === 'teknik_servis';
                const isAplikasyonFaulty = device.arizaDurumu === 'aplikasyon';
                const isFaulty = isTeknikServisFaulty || isAplikasyonFaulty;

                return (
                  <button
                    key={device.id}
                    className="flex flex-col items-center group text-center cursor-pointer"
                    onClick={() => handleDeviceClick(device)}
                  >
                    <div className="mb-2">
                      <p className="font-semibold text-sm truncate" title={device.cihazAdi || device.model}>
                        {device.cihazAdi || device.model}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {device.seriNumarasi || 'SN yok'}
                      </p>
                    </div>
                    <div className="relative w-full aspect-square">
                      {device.imageUrl ? (
                        <Image
                          src={`/${device.imageUrl}`}
                          alt={device.cihazAdi || device.model || ''}
                          width={1024}
                          height={1024}
                          className="object-contain"
                          priority
                        />
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground rounded-md">
                          Görsel Yok
                        </div>
                      )}
                    </div>
                    <div
                        className={cn(
                            "w-full h-4 animate-pulse mt-1",
                            isTeknikServisFaulty ? 'bg-red-500/50' : isAplikasyonFaulty ? 'bg-amber-500/50' : 'bg-green-500/50'
                        )}
                        style={{ filter: 'blur(12px)' }}
                    />
                    <div className="mt-2 h-10">
                      {isTeknikServisFaulty ? (
                        <>
                          <p className="text-xs text-red-500 font-semibold flex items-center justify-center">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Arızalı (Teknik Servis)
                          </p>
                          {device.arizaAciklamasi && (
                            <p className="text-xs text-muted-foreground truncate" title={device.arizaAciklamasi}>
                              {device.arizaAciklamasi}
                            </p>
                          )}
                        </>
                      ) : isAplikasyonFaulty ? (
                        <>
                          <p className="text-xs text-amber-600 font-semibold flex items-center justify-center">
                            <FlaskConical className="h-3 w-3 mr-1" />
                            Arızalı (Aplikasyon)
                          </p>
                          {device.arizaAciklamasi && (
                            <p className="text-xs text-muted-foreground truncate" title={device.arizaAciklamasi}>
                              {device.arizaAciklamasi}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-green-600 font-semibold flex items-center justify-center">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Sağlıklı
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDeviceFaultType === 'teknik_servis'
                ? `Teknik Servis Arızası: ${selectedDevice?.cihazAdi}`
                : `Aplikasyon Arızası: ${selectedDevice?.cihazAdi}`}
            </DialogTitle>
            <DialogDescription>
              {selectedDeviceFaultType === 'teknik_servis'
                ? 'Bu cihaz için bir teknik servis arıza kaydı bulunmaktadır. Yapmak istediğiniz işlemi seçin.'
                : 'Bu cihaz için bir aplikasyon arıza kaydı bulunmaktadır. Bu arızayı yalnızca aplikasyon personeli yönetebilir.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-col sm:space-x-0 gap-2 pt-4">
              {selectedDeviceFaultType === 'teknik_servis' ? (
                <>
                  <Button
                    onClick={() => faultIdForSelectedDevice && navigateToAction(`/ariza-yonetimi/${faultIdForSelectedDevice}`)}
                    disabled={!faultIdForSelectedDevice}
                  >
                    <Wrench className="mr-2 h-4 w-4" /> Arıza Kaydını Yönet
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => selectedDevice?.id && navigateToAction(`/teknik-servis/islem-formu/${selectedDevice.id}`)}
                  >
                    <FilePenLine className="mr-2 h-4 w-4" /> Yeni Servis İşlemi Oluştur
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => faultIdForSelectedDevice && navigateToAction(`/ariza-yonetimi/${faultIdForSelectedDevice}`)}
                    disabled={!faultIdForSelectedDevice}
                  >
                    <FlaskConical className="mr-2 h-4 w-4" /> Arıza Kaydını Görüntüle (Salt Okunur)
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setIsModalOpen(false)}
                  >
                    Kapat
                  </Button>
                </>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
