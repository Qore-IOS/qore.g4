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
} from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

type Hospital = {
  id: string;
  name: string;
};

type Device = {
  id: string;
  brand?: string;
  model?: string;
  name?: string;
  serialNumber?: string;
  serial?: string;
  imageUrl?: string; 
};

type DeviceGroupSlot = {
  order?: number;
  deviceId?: string | null;
  name?: string;     
  serial?: string;   
};

type DeviceGroup = {
  id: string;
  name: string;
  order?: number;
  slots?: DeviceGroupSlot[];
};

type EnrichedSlot = {
  key: string;
  order: number;
  imageUrl?: string;
  title: string;
  subtitle: string;
  deviceId?: string | null;
};

type EnrichedGroup = DeviceGroup & { slots: EnrichedSlot[] };

export function DeviceGroupsStrip({
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

  // Fault modal
  const [openFault, setOpenFault] = useState(false);
  const [faultGroup, setFaultGroup] = useState<EnrichedGroup | null>(null);
  const [faultDesc, setFaultDesc] = useState('');
  const [saving, setSaving] = useState(false);

  // live-read groups under hospitals/{labId}/deviceGroups
  useEffect(() => {
    if (!selectedHospitalId) {
      setGroups([]);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'hospitals', selectedHospitalId, 'deviceGroups'),
      orderBy('order', 'asc')
    );
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
              const subtitle = s.serial?.trim() || dev?.serialNumber || dev?.serial || '-';
              return {
                key: `${d.id}-${idx}-${s.deviceId ?? 'none'}`,
                order: s.order ?? idx,
                imageUrl: dev?.imageUrl ? `/${dev.imageUrl}` : undefined,
                title,
                subtitle,
                deviceId: s.deviceId,
              };
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

  const labName = useMemo(
    () => hospitals.find((h) => h.id === selectedHospitalId)?.name ?? '-',
    [hospitals, selectedHospitalId]
  );

  const saveFault = useCallback(async () => {
    if (!faultGroup || !selectedHospitalId) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'deviceFaultReports'), {
        groupId: faultGroup.id,
        groupName: faultGroup.name,
        labId: selectedHospitalId,
        labName,
        devices: faultGroup.slots.map((s) => ({
          order: s.order,
          deviceId: s.deviceId ?? null,
          model: s.title ?? null,
          serial: s.subtitle ?? null,
        })),
        description: faultDesc?.trim() || null,
        status: 'open',
        openedAt: serverTimestamp(),
        openedBy: currentUserId ?? null,
        openedByName: currentUserName ?? null,
        source: 'urun-kullanim',
      });
      toast({ title: 'Arıza bildirildi', description: `${faultGroup.name} kaydedildi.` });
      setOpenFault(false);
      setFaultGroup(null);
      setFaultDesc('');
    } catch (e) {
      console.error(e);
      toast({ title: 'Kayıt hatası', description: 'Arıza kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [faultGroup, faultDesc, selectedHospitalId, labName, currentUserId, currentUserName, toast]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Cihaz Grupları ve Arıza Kaydı</CardTitle>
            <CardDescription>Seçili laboratuvardaki cihaz grupları için arıza bildiriminde bulunun.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!selectedHospitalId && <div className="text-sm text-muted-foreground">Önce bir laboratuvar seçin.</div>}

        {selectedHospitalId && (
          <>
            {loading && (
              <div className="flex items-center gap-2 p-3">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Gruplar yükleniyor…</span>
              </div>
            )}

            {!loading && groups.length === 0 && (
              <div className="text-sm text-muted-foreground">Bu laboratuvara ait grup bulunamadı.</div>
            )}

            {!loading && groups.length > 0 && (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {groups.map((g) => (
                  <Card
                    key={g.id}
                    className={cn(
                      'border border-white/10 bg-gradient-to-br from-background via-background to-background/60 hover:shadow-xl transition cursor-pointer'
                    )}
                    onClick={() => {
                      setFaultGroup(g);
                      setOpenFault(true);
                    }}
                  >
                    <CardHeader className="pb-1">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold">{g.name}</CardTitle>
                        <Wrench className="h-4 w-4 opacity-70" />
                      </div>
                      <CardDescription>Laboratuvar: {labName}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {g.slots.map((s) => (
                          <div
                            key={s.key}
                            className="rounded-xl border border-white/10 p-2 bg-background/60 hover:bg-background/80 transition"
                          >
                            <div className="relative w-full h-28">
                              {s.imageUrl ? (
                                <Image
                                  src={s.imageUrl}
                                  alt={s.title}
                                  fill
                                  className="object-contain"
                                  sizes="(max-width: 640px) 50vw, 33vw"
                                  priority={false}
                                />
                              ) : (
                                <div className="w-full h-full rounded-md bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">
                                  Görsel yok
                                </div>
                              )}
                            </div>
                            <div className="mt-2">
                              <div className="text-sm font-medium truncate">{s.title}</div>
                              <div className="text-xs text-muted-foreground truncate">{s.subtitle}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                    <CardFooter className="pt-1">
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFaultGroup(g);
                          setOpenFault(true);
                        }}
                      >
                        <Wrench className="mr-2 h-4 w-4" />
                        Arıza Bildir
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={openFault} onOpenChange={(o) => setOpenFault(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Arıza Kaydı</DialogTitle>
            <DialogDescription>
              {faultGroup ? `${labName} / ${faultGroup.name}` : 'Grup seçilmedi'}
            </DialogDescription>
          </DialogHeader>
          {faultGroup && (
            <div className="space-y-4">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground mb-1">Grup İçeriği</div>
                <div className="grid grid-cols-2 gap-2">
                  {faultGroup.slots.map((s) => (
                    <div key={`modal-${s.key}`} className="text-xs">
                      <div className="font-medium truncate">{s.title}</div>
                      <div className="text-muted-foreground truncate">{s.subtitle}</div>
                    </div>
                  ))}
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
            <Button onClick={saveFault} disabled={!faultGroup || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kaydı Oluştur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
