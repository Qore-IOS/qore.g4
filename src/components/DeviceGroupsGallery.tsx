// components/DeviceGroupsGallery.tsx
// UPDATE: enforce 5-per-row, side-by-side, large proportional images without backgrounds.
'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Wrench } from 'lucide-react';
import type { Hospital, Device, DeviceGroup, DeviceGroupSlot as DeviceGroupSlotType } from '@/lib/types';
import { emitFaultOpened } from '@/lib/notifications';
import { openDeviceFaultReport } from '@/lib/faults'; // NEW IMPORT

type DeviceGroupSlot = DeviceGroupSlotType & { serial?: string };
type EnrichedSlot = {
  key: string;
  order: number;
  deviceId: string | null;
  title: string;
  serial: string;
  imageSrc?: string;
};
type EnrichedGroup = DeviceGroup & { slots: EnrichedSlot[] };

export function DeviceGroupsGallery({
  selectedHospitalId,
  hospitals,
  allDevices,
  currentUserId,
  currentUserName,
}: {
  selectedHospitalId: string;
  hospitals: Hospital[];
  allDevices: Device[];
  currentUserId?: string | null;
  currentUserName?: string | null;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<EnrichedGroup[]>([]);

  const [openFault, setOpenFault] = useState(false);
  const [faultTarget, setFaultTarget] = useState<{
    groupId: string;
    groupName: string;
    deviceId: string | null;
    title: string;
    serial: string;
    order: number;
  } | null>(null);
  const [faultDesc, setFaultDesc] = useState('');
  const [faultType, setFaultType] = useState<'teknik_servis' | 'aplikasyon' | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedHospitalId) {
      setGroups([]);
      return;
    }
    setLoading(true);
    const q = query(collection(db, 'hospitals', selectedHospitalId, 'deviceGroups'), orderBy('order', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: EnrichedGroup[] = snap.docs.map((d) => {
          const raw = { id: d.id, ...(d.data() as any) } as DeviceGroup;
          const slots: EnrichedSlot[] = (raw.slots ?? [])
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((s, idx) => {
              const dev = s.deviceId ? allDevices.find((x) => x.id === s.deviceId) : undefined;
              const title = s.name?.trim() || [dev?.brand, dev?.model].filter(Boolean).join(' ') || dev?.name || 'Cihaz';
              const serial = s.serial?.trim() || dev?.seriNumarasi || (dev as any)?.serial || '-';
              const img = dev?.imageUrl ? (dev.imageUrl.startsWith('/') ? dev.imageUrl : `/${dev.imageUrl}`) : undefined;
              return { key: `${d.id}-${idx}-${s.deviceId ?? 'none'}`, order: s.order ?? idx, deviceId: s.deviceId ?? null, title, serial, imageSrc: img };
            });
          return { ...raw, slots };
        });
        setGroups(rows);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast({ title: 'Cihaz grupları okunamadı', description: 'Lütfen tekrar deneyin.', variant: 'destructive' });
        setLoading(false);
      }
    );
    return () => unsub();
  }, [selectedHospitalId, allDevices, toast]);

  const labName = useMemo(() => hospitals.find((h) => h.id === selectedHospitalId)?.name ?? '-', [hospitals, selectedHospitalId]);

  const openDeviceFault = useCallback((g: EnrichedGroup, s: EnrichedSlot) => {
    setFaultTarget({ groupId: g.id, groupName: g.name, deviceId: s.deviceId, title: s.title, serial: s.serial, order: s.order });
    setOpenFault(true);
  }, []);

  const handleStopClick = async (e: React.MouseEvent, g: EnrichedGroup, s: EnrichedSlot) => {
    e.stopPropagation(); // Prevent opening the regular fault modal
    if (!s.deviceId) {
      toast({ title: 'Cihaz ID Eksik', description: 'Bu yuvada atanmış bir cihaz bulunmuyor.', variant: 'destructive' });
      return;
    }
    
    setSaving(true);
    try {
      await openDeviceFaultReport({
        hospitalId: selectedHospitalId,
        labName: labName,
        deviceId: s.deviceId,
        model: s.title,
        serial: s.serial,
        faultType: 'teknik_servis',
        openedByUid: currentUserId || 'system',
        openedByName: currentUserName || 'System',
        openDescription: `Cihaz Adı: ${s.title}, Seri No: ${s.serial}, Arıza: STOP`,
        title: `ACİL STOP: ${s.title}`,
      });
      toast({ title: 'ACİL STOP Bildirildi', description: `${s.title} için teknik servis arıza kaydı oluşturuldu.` });
    } catch (err) {
      console.error(err);
      toast({ title: 'Kayıt Hatası', description: 'STOP arıza kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };


  const saveFault = useCallback(async () => {
    if (!faultTarget || !selectedHospitalId || !faultType) return;
    setSaving(true);
    try {
      if (faultTarget.deviceId) {
        await openDeviceFaultReport({
          hospitalId: selectedHospitalId,
          labName: labName,
          deviceId: faultTarget.deviceId,
          model: faultTarget.title,
          serial: faultTarget.serial,
          faultType,
          openedByUid: currentUserId || 'system',
          openedByName: currentUserName || 'System',
          openDescription: faultDesc?.trim() || null,
        });
      }

      toast({ title: 'Arıza bildirildi', description: `${faultTarget.title} (${faultTarget.serial})` });
      setOpenFault(false);
      setFaultTarget(null);
      setFaultDesc('');
      setFaultType(null);
    } catch (e) {
      console.error(e);
      toast({ title: 'Kayıt hatası', description: 'Arıza kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [faultTarget, faultType, selectedHospitalId, labName, faultDesc, currentUserId, currentUserName, toast]);

  return (
    <div className="space-y-8">
      {!selectedHospitalId && <div className="text-sm text-muted-foreground">Önce bir laboratuvar seçin.</div>}

      {selectedHospitalId && (
        <>
          {loading && (
            <div className="flex items-center gap-2 p-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Gruplar yükleniyor…</span>
            </div>
          )}

          {!loading &&
            groups.map((g) => (
              <section key={g.id} className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-base font-semibold">{g.name}</h3>
                  <span className="text-xs text-muted-foreground">Laboratuvar: {labName}</span>
                </div>

                <div className="grid grid-cols-5 gap-6 w-full">
                  {g.slots.map((s) => (
                    <div key={s.key} className="group w-full outline-none focus-visible:ring-2 focus-visible:ring-primary/50 flex flex-col items-center">
                        <div className="relative w-full" style={{ aspectRatio: '1 / 1' }}>
                            {s.imageSrc ? (
                            <Image
                                src={s.imageSrc}
                                alt={s.title}
                                width={1024}
                                height={1024}
                                className="object-contain select-none"
                                sizes="(max-width: 1600px) 20vw, 320px"
                                priority={false}
                            />
                            ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                                Görsel yok
                            </div>
                            )}
                        </div>

                        <div className="btn-wrapper mt-2" style={{ '--hue': '0deg' } as React.CSSProperties}>
                            <button className="btn" onClick={(e) => handleStopClick(e, g, s)}>
                                <span className="btn-txt">STOP</span>
                            </button>
                            <div className="dot pulse"></div>
                        </div>

                        <div className="mt-2 text-center">
                            <div className="text-sm font-medium leading-tight truncate">{s.title}</div>
                            <div className="text-xs text-muted-foreground leading-tight truncate">{s.serial}</div>
                        </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}

          <Dialog open={openFault} onOpenChange={setOpenFault}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Arıza Kaydı</DialogTitle>
                <DialogDescription>
                  {faultTarget ? `${labName} / ${faultTarget.groupName} / ${faultTarget.title} (${faultTarget.serial})` : 'Cihaz seçilmedi'}
                </DialogDescription>
              </DialogHeader>

              {faultTarget && (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Arıza Tipi</label>
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant={faultType === 'teknik_servis' ? 'default' : 'outline'} onClick={() => setFaultType('teknik_servis')}>Teknik Servis</Button>
                        <Button variant={faultType === 'aplikasyon' ? 'default' : 'outline'} onClick={() => setFaultType('aplikasyon')}>Aplikasyon</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Açıklama</label>
                    <textarea
                      className="w-full rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                      rows={3}
                      value={faultDesc}
                      onChange={(e) => setFaultDesc(e.target.value)}
                      placeholder="Arıza detayını girin…"
                    />
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button variant="ghost" onClick={() => setOpenFault(false)}>İptal</Button>
                <Button onClick={saveFault} disabled={!faultTarget || !faultType || saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Kaydı Oluştur
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
