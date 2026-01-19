
'use client';
import React, { useState, useEffect } from 'react';
import {
  collection, getDocs, setDoc, doc, deleteDoc, addDoc, serverTimestamp, query, where
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Device, Hospital, MaintenancePlan, MaintenancePeriodUnit, MaintenanceType } from '@/lib/types';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose
} from '@/components/ui/dialog';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { ScrollArea } from './ui/scroll-area';
import { Calendar, Plus, Trash2, Wrench, FlaskConical, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';

// Periyot birimi etiketleri
const PERIOD_UNIT_LABELS: Record<MaintenancePeriodUnit, string> = {
  hafta: 'Hafta',
  ay: 'Ay',
  yil: 'Yıl',
};

// Yeni bakım planı satırı tipi
type NewPlanRow = {
  id: string;
  taskName: string;
  periodValue: number;
  periodUnit: MaintenancePeriodUnit;
};

interface Props {
  images: string[];
  hospitals: Hospital[];
}

export default function CihazTanimlamaClient({ images, hospitals }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [current, setCurrent] = useState<Partial<Device>>({});
  const [customPath, setCustomPath] = useState('');
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();

  // Periyodik Bakım Planı State'leri
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
  const [maintenanceDevice, setMaintenanceDevice] = useState<Device | null>(null);
  const [existingPlans, setExistingPlans] = useState<MaintenancePlan[]>([]);
  const [maintenanceTab, setMaintenanceTab] = useState<MaintenanceType>('teknik_servis');
  const [newTeknikRows, setNewTeknikRows] = useState<NewPlanRow[]>([]);
  const [newAplikasyonRows, setNewAplikasyonRows] = useState<NewPlanRow[]>([]);
  const [isSavingPlans, setIsSavingPlans] = useState(false);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);

  const fetchDevices = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'devices'));
    setDevices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Device)));
    setLoading(false);
  };
  useEffect(() => { fetchDevices(); }, []);

  const save = async () => {
    const imageUrl = current.imageUrl || customPath.trim();
    if (!current.brand || !current.model || !imageUrl || !current.seriNumarasi || !current.hospitalId || !current.order) {
      toast({
        title: 'Eksik bilgi',
        description: 'Marka, model, seri numarası, laboratuvar, dizilim sırası ve resim seçilmeli veya yol girilmeli.',
        variant: 'destructive'
      });
      return;
    }
    const id = current.id
      ?? `${current.brand}-${current.model}-${current.seriNumarasi}`.toLowerCase().replace(/\s+/g, '-');
      
    await setDoc(doc(db, 'devices', id), { 
      brand: current.brand,
      model: current.model,
      imageUrl,
      cihazAdi: current.cihazAdi,
      seriNumarasi: current.seriNumarasi,
      hospitalId: current.hospitalId,
      order: current.order
    }, { merge: true });

    toast({ title: 'Kaydedildi', description: 'Cihaz tanımı kaydedildi.' });
    setModalOpen(false);
    fetchDevices();
  };

  const remove = async (id: string) => {
    if (confirm('Bu tanımı silmek istediğinize emin misiniz?')) {
      await deleteDoc(doc(db, 'devices', id));
      toast({ title: 'Silindi', description: 'Cihaz tanımı silindi.', variant: 'destructive' });
      fetchDevices();
    }
  };

  // Periyodik Bakım Planı Fonksiyonları
  const openMaintenanceModal = async (device: Device) => {
    setMaintenanceDevice(device);
    setMaintenanceTab('teknik_servis');
    setNewTeknikRows([]);
    setNewAplikasyonRows([]);
    setIsLoadingPlans(true);
    setMaintenanceModalOpen(true);

    try {
      const q = query(
        collection(db, 'maintenancePlans'),
        where('deviceId', '==', device.id)
      );
      const snap = await getDocs(q);
      const plans = snap.docs.map(d => ({ id: d.id, ...d.data() }) as MaintenancePlan);
      setExistingPlans(plans);
    } catch (err) {
      console.error('Bakım planları yüklenemedi:', err);
      toast({ title: 'Hata', description: 'Bakım planları yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoadingPlans(false);
    }
  };

  const addNewRow = (type: MaintenanceType) => {
    const newRow: NewPlanRow = {
      id: crypto.randomUUID(),
      taskName: '',
      periodValue: 1,
      periodUnit: 'ay',
    };

    if (type === 'teknik_servis') {
      setNewTeknikRows(prev => [...prev, newRow]);
    } else {
      setNewAplikasyonRows(prev => [...prev, newRow]);
    }
  };

  const updateNewRow = (type: MaintenanceType, id: string, field: keyof NewPlanRow, value: any) => {
    const setter = type === 'teknik_servis' ? setNewTeknikRows : setNewAplikasyonRows;
    setter(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const removeNewRow = (type: MaintenanceType, id: string) => {
    const setter = type === 'teknik_servis' ? setNewTeknikRows : setNewAplikasyonRows;
    setter(prev => prev.filter(row => row.id !== id));
  };

  const removeExistingPlan = async (planId: string) => {
    if (!confirm('Bu bakım planını silmek istediğinize emin misiniz?')) return;

    try {
      await deleteDoc(doc(db, 'maintenancePlans', planId));
      setExistingPlans(prev => prev.filter(p => p.id !== planId));
      toast({ title: 'Silindi', description: 'Bakım planı silindi.' });
    } catch (err) {
      console.error('Bakım planı silinemedi:', err);
      toast({ title: 'Hata', description: 'Bakım planı silinemedi.', variant: 'destructive' });
    }
  };

  const saveMaintenancePlans = async () => {
    if (!maintenanceDevice) return;

    // Validate new rows
    const allNewRows = [
      ...newTeknikRows.map(r => ({ ...r, type: 'teknik_servis' as MaintenanceType })),
      ...newAplikasyonRows.map(r => ({ ...r, type: 'aplikasyon' as MaintenanceType })),
    ];

    const invalidRow = allNewRows.find(r => !r.taskName.trim());
    if (invalidRow) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm iş adlarını doldurun.', variant: 'destructive' });
      return;
    }

    if (allNewRows.length === 0) {
      setMaintenanceModalOpen(false);
      return;
    }

    setIsSavingPlans(true);

    try {
      for (const row of allNewRows) {
        await addDoc(collection(db, 'maintenancePlans'), {
          deviceId: maintenanceDevice.id,
          taskName: row.taskName.trim(),
          periodValue: row.periodValue,
          periodUnit: row.periodUnit,
          type: row.type,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
      }

      toast({ title: 'Başarılı', description: `${allNewRows.length} bakım planı kaydedildi.` });
      setMaintenanceModalOpen(false);
    } catch (err) {
      console.error('Bakım planları kaydedilemedi:', err);
      toast({ title: 'Hata', description: 'Bakım planları kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSavingPlans(false);
    }
  };

  // Filtrelenmiş planlar
  const teknikPlans = existingPlans.filter(p => p.type === 'teknik_servis');
  const aplikasyonPlans = existingPlans.filter(p => p.type === 'aplikasyon');

  const effectiveImageUrl = current.imageUrl || customPath;

  return (
    <div className="p-8 space-y-6">
      <BackButton fallback="/cihaz-yonetimi-ana"/>
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-headline">Cihaz Tanımlamaları</h1>
        <Button onClick={() => { setCurrent({}); setCustomPath(''); setModalOpen(true); }}>
          + Yeni Cihaz
        </Button>
      </div>

      <ScrollArea className="h-[70vh]">
        <Table>
          <TableHeader>
          <TableRow>
            <TableHead>Marka</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Cihaz Adı</TableHead>
            <TableHead>Seri Numarası</TableHead>
            <TableHead>Laboratuvar</TableHead>
            <TableHead>Sıra</TableHead>
            <TableHead>Resim</TableHead>
            <TableHead>İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && devices.map(dev => (
              <TableRow key={dev.id}>
                <TableCell>{dev.brand}</TableCell>
                <TableCell>{dev.model}</TableCell>
                <TableCell>{dev.cihazAdi}</TableCell>
                <TableCell>{dev.seriNumarasi}</TableCell>
                <TableCell>{hospitals.find(h => h.id === dev.hospitalId)?.name}</TableCell>
                <TableCell>{dev.order}</TableCell>
                <TableCell>
                  {dev.imageUrl ? (
                  <Image
                    src={`/${dev.imageUrl}`}
                    alt={`${dev.brand} ${dev.model}`}
                    width={100}
                    height={100}
                    className="w-24 h-24 object-cover rounded-md"
                  />
                  ) : "Resim Yok"}
                </TableCell>
                <TableCell className="space-x-2">
                  <Button size="sm" variant="outline" onClick={() => openMaintenanceModal(dev)}>
                    <Calendar className="h-4 w-4 mr-1" /> Bakım Planı
                  </Button>
                  <Button size="sm" onClick={() => {
                    setCurrent(dev);
                    setCustomPath('');
                    setModalOpen(true);
                  }}>Düzenle</Button>
                  <Button variant="destructive" size="sm" onClick={() => remove(dev.id)}>
                    Sil
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{current.id ? 'Cihaz Düzenle' : 'Yeni Cihaz'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Marka"
              value={current.brand || ''}
              onChange={e => setCurrent({ ...current, brand: e.target.value })}
            />
            <Input
              placeholder="Model"
              value={current.model || ''}
              onChange={e => setCurrent({ ...current, model: e.target.value })}
            />
            <Input
              placeholder="Cihaz Adı"
              value={current.cihazAdi || ''}
              onChange={e => setCurrent({ ...current, cihazAdi: e.target.value })}
            />
             <Input
              placeholder="Seri Numarası"
              value={current.seriNumarasi || ''}
              onChange={e => setCurrent({ ...current, seriNumarasi: e.target.value })}
            />
            <Select
              value={current.imageUrl || ''}
              onValueChange={val => {
                setCurrent({ ...current, imageUrl: val });
                setCustomPath('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Mevcut Resimlerden Seçin" />
              </SelectTrigger>
              <SelectContent>
                {images.map(img => (
                  <SelectItem key={img} value={img}>{img}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Veya özel resim yolu girin (örn: devices/xyz.png)"
              value={customPath}
              onChange={e => {
                setCustomPath(e.target.value);
                setCurrent({ ...current, imageUrl: undefined });
              }}
            />
            {effectiveImageUrl && (
              <div className="flex justify-center">
                 <Image
                    src={`/${effectiveImageUrl}`}
                    alt="Preview"
                    width={200}
                    height={200}
                    className="w-48 h-48 object-cover rounded-lg"
                  />
              </div>
            )}
             <Select
              value={current.hospitalId || ''}
              onValueChange={val => setCurrent({ ...current, hospitalId: val })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Laboratuvar Seçin" />
              </SelectTrigger>
              <SelectContent>
                {hospitals.map(h => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(current.order || '')}
              onValueChange={val => setCurrent({ ...current, order: Number(val) })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Dizilim Sırası Seçin" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(i => (
                  <SelectItem key={i} value={String(i)}>{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="space-x-2">
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={save}>{current.id ? 'Güncelle' : 'Oluştur'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Periyodik Bakım Planı Modal */}
      <Dialog open={maintenanceModalOpen} onOpenChange={setMaintenanceModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Periyodik Bakım Planı: {maintenanceDevice?.cihazAdi || maintenanceDevice?.model}
            </DialogTitle>
          </DialogHeader>

          {isLoadingPlans ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Tabs value={maintenanceTab} onValueChange={(v) => setMaintenanceTab(v as MaintenanceType)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="teknik_servis" className="flex items-center gap-2">
                  <Wrench className="h-4 w-4" /> Teknik Servis ({teknikPlans.length + newTeknikRows.length})
                </TabsTrigger>
                <TabsTrigger value="aplikasyon" className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4" /> Aplikasyon ({aplikasyonPlans.length + newAplikasyonRows.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="teknik_servis" className="space-y-4 mt-4">
                <ScrollArea className="h-64 border rounded-md p-3">
                  {/* Mevcut planlar */}
                  {teknikPlans.map(plan => (
                    <div key={plan.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md mb-2">
                      <div>
                        <p className="font-medium">{plan.taskName}</p>
                        <p className="text-xs text-muted-foreground">
                          {plan.periodValue} {PERIOD_UNIT_LABELS[plan.periodUnit]}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeExistingPlan(plan.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  {/* Yeni satırlar */}
                  {newTeknikRows.map(row => (
                    <div key={row.id} className="flex items-center gap-2 p-2 border border-dashed rounded-md mb-2">
                      <Input
                        placeholder="İş adı..."
                        value={row.taskName}
                        onChange={(e) => updateNewRow('teknik_servis', row.id, 'taskName', e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        min="1"
                        value={row.periodValue}
                        onChange={(e) => updateNewRow('teknik_servis', row.id, 'periodValue', Number(e.target.value))}
                        className="w-20"
                      />
                      <Select
                        value={row.periodUnit}
                        onValueChange={(v) => updateNewRow('teknik_servis', row.id, 'periodUnit', v)}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hafta">Hafta</SelectItem>
                          <SelectItem value="ay">Ay</SelectItem>
                          <SelectItem value="yil">Yıl</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => removeNewRow('teknik_servis', row.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  {teknikPlans.length === 0 && newTeknikRows.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">
                      Henüz teknik servis bakım planı tanımlanmamış.
                    </p>
                  )}
                </ScrollArea>

                <Button variant="outline" className="w-full" onClick={() => addNewRow('teknik_servis')}>
                  <Plus className="h-4 w-4 mr-2" /> Yeni İş Ekle
                </Button>
              </TabsContent>

              <TabsContent value="aplikasyon" className="space-y-4 mt-4">
                <ScrollArea className="h-64 border rounded-md p-3">
                  {/* Mevcut planlar */}
                  {aplikasyonPlans.map(plan => (
                    <div key={plan.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md mb-2">
                      <div>
                        <p className="font-medium">{plan.taskName}</p>
                        <p className="text-xs text-muted-foreground">
                          {plan.periodValue} {PERIOD_UNIT_LABELS[plan.periodUnit]}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeExistingPlan(plan.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  {/* Yeni satırlar */}
                  {newAplikasyonRows.map(row => (
                    <div key={row.id} className="flex items-center gap-2 p-2 border border-dashed rounded-md mb-2">
                      <Input
                        placeholder="İş adı..."
                        value={row.taskName}
                        onChange={(e) => updateNewRow('aplikasyon', row.id, 'taskName', e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        min="1"
                        value={row.periodValue}
                        onChange={(e) => updateNewRow('aplikasyon', row.id, 'periodValue', Number(e.target.value))}
                        className="w-20"
                      />
                      <Select
                        value={row.periodUnit}
                        onValueChange={(v) => updateNewRow('aplikasyon', row.id, 'periodUnit', v)}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hafta">Hafta</SelectItem>
                          <SelectItem value="ay">Ay</SelectItem>
                          <SelectItem value="yil">Yıl</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => removeNewRow('aplikasyon', row.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  {aplikasyonPlans.length === 0 && newAplikasyonRows.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">
                      Henüz aplikasyon bakım planı tanımlanmamış.
                    </p>
                  )}
                </ScrollArea>

                <Button variant="outline" className="w-full" onClick={() => addNewRow('aplikasyon')}>
                  <Plus className="h-4 w-4 mr-2" /> Yeni İş Ekle
                </Button>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setMaintenanceModalOpen(false)}>Kapat</Button>
            <Button onClick={saveMaintenancePlans} disabled={isSavingPlans || (newTeknikRows.length === 0 && newAplikasyonRows.length === 0)}>
              {isSavingPlans ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
