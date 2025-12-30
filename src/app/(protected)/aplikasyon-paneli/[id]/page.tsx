'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle, Loader2, FlaskConical, FilePenLine, Wrench } from 'lucide-react';
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  getDocs,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital, Device } from '@/lib/types';
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


export default function AplikasyonPaneliDetayPage() {
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
      router.push('/aplikasyon-paneli');
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
    // For aplikasyon panel:
    // - If device has aplikasyon fault, show modal with options
    // - If device has teknik_servis fault, show info that it's a teknik servis fault (can't manage)
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
          setFaultIdForSelectedDevice(null);
        }
      } catch (error) {
        console.error("Error finding open fault report:", error);
        setFaultIdForSelectedDevice(null);
      }
      setIsModalOpen(true);
    } else {
      // No fault, go directly to operation form
      router.push(`/aplikasyon-paneli/islem-formu/${device.id}`);
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
        <BackButton fallback="/aplikasyon-paneli" />
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
                // For aplikasyon panel: show red only for aplikasyon faults
                const isAplikasyonFaulty = device.arizaDurumu === 'aplikasyon';
                const isTeknikServisFaulty = device.arizaDurumu === 'teknik_servis';
                const isFaulty = isAplikasyonFaulty || isTeknikServisFaulty;

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
                            isAplikasyonFaulty ? 'bg-red-500/50' : isTeknikServisFaulty ? 'bg-amber-500/50' : 'bg-green-500/50'
                        )}
                        style={{ filter: 'blur(12px)' }}
                    />
                    <div className="mt-2 h-10">
                      {isAplikasyonFaulty ? (
                        <>
                          <p className="text-xs text-red-500 font-semibold flex items-center justify-center">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Arızalı (Aplikasyon)
                          </p>
                          {device.arizaAciklamasi && (
                            <p className="text-xs text-muted-foreground truncate" title={device.arizaAciklamasi}>
                              {device.arizaAciklamasi}
                            </p>
                          )}
                        </>
                      ) : isTeknikServisFaulty ? (
                        <>
                          <p className="text-xs text-amber-600 font-semibold flex items-center justify-center">
                            <Wrench className="h-3 w-3 mr-1" />
                            Arızalı (Teknik Servis)
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
              {selectedDeviceFaultType === 'aplikasyon'
                ? `Aplikasyon Arızası: ${selectedDevice?.cihazAdi}`
                : `Teknik Servis Arızası: ${selectedDevice?.cihazAdi}`}
            </DialogTitle>
            <DialogDescription>
              {selectedDeviceFaultType === 'aplikasyon'
                ? 'Bu cihaz için bir aplikasyon arıza kaydı bulunmaktadır. Yapmak istediğiniz işlemi seçin.'
                : 'Bu cihaz için bir teknik servis arıza kaydı bulunmaktadır. Bu arızayı yalnızca teknik servis personeli yönetebilir.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-col sm:space-x-0 gap-2 pt-4">
              {selectedDeviceFaultType === 'aplikasyon' ? (
                <>
                  <Button
                    onClick={() => faultIdForSelectedDevice && navigateToAction(`/ariza-yonetimi/${faultIdForSelectedDevice}`)}
                    disabled={!faultIdForSelectedDevice}
                  >
                    <FlaskConical className="mr-2 h-4 w-4" /> Arıza Kaydını Yönet
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => selectedDevice?.id && navigateToAction(`/aplikasyon-paneli/islem-formu/${selectedDevice.id}`)}
                  >
                    <FilePenLine className="mr-2 h-4 w-4" /> Yeni İşlem Oluştur
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => faultIdForSelectedDevice && navigateToAction(`/ariza-yonetimi/${faultIdForSelectedDevice}`)}
                    disabled={!faultIdForSelectedDevice}
                  >
                    <Wrench className="mr-2 h-4 w-4" /> Arıza Kaydını Görüntüle (Salt Okunur)
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
