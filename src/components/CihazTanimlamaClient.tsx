
'use client';
import React, { useState, useEffect } from 'react';
import {
  collection, getDocs, setDoc, doc, deleteDoc, addDoc, serverTimestamp, query, where
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Device, Hospital, MaintenancePlan, MaintenancePeriodUnit, MaintenanceType, ProductCode, PeriodicPartChange, PeriodicPartResponsibility } from '@/lib/types';
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
import { Calendar, Plus, Trash2, Wrench, FlaskConical, Loader2, Package, ChevronsUpDown, Check as CheckIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
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

// Yeni periyodik parça değişimi satırı tipi
type NewPeriodicPartRow = {
  id: string;
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  periodValue: number;
  periodUnit: MaintenancePeriodUnit;
  responsibilityType: PeriodicPartResponsibility;
  requiresOutgoingPartInfo: boolean;
  requiresSerialTracking: boolean;
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

  // Periyodik Parça Değişimi State'leri
  const [existingPeriodicParts, setExistingPeriodicParts] = useState<PeriodicPartChange[]>([]);
  const [newPeriodicPartRows, setNewPeriodicPartRows] = useState<NewPeriodicPartRow[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [showPeriodicPartSection, setShowPeriodicPartSection] = useState(false);

  const fetchDevices = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'devices'));
    setDevices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Device)));
    setLoading(false);
  };
  useEffect(() => { fetchDevices(); }, []);

  // Yedek parça ürünlerini getir
  useEffect(() => {
    const fetchProductCodes = async () => {
      try {
        const q = query(collection(db, 'productCodes'), where('urunGrubu', '==', 'yedek_parca'));
        const snap = await getDocs(q);
        setProductCodes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode));
      } catch (err) {
        console.error('Error fetching product codes:', err);
      }
    };
    fetchProductCodes();
  }, []);

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
    setNewPeriodicPartRows([]);
    setShowPeriodicPartSection(false);
    setIsLoadingPlans(true);
    setMaintenanceModalOpen(true);

    try {
      // Bakım planlarını getir
      const plansQuery = query(
        collection(db, 'maintenancePlans'),
        where('deviceId', '==', device.id)
      );
      const plansSnap = await getDocs(plansQuery);
      const plans = plansSnap.docs.map(d => ({ id: d.id, ...d.data() }) as MaintenancePlan);
      setExistingPlans(plans);

      // Periyodik parça değişimlerini getir
      const partsQuery = query(
        collection(db, 'periodicPartChanges'),
        where('deviceId', '==', device.id)
      );
      const partsSnap = await getDocs(partsQuery);
      const parts = partsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PeriodicPartChange);
      setExistingPeriodicParts(parts);
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

  // Periyodik Parça Değişimi Fonksiyonları
  const addNewPeriodicPartRow = () => {
    const newRow: NewPeriodicPartRow = {
      id: crypto.randomUUID(),
      productCodeId: '',
      stokKodu: '',
      stokAdi: '',
      periodValue: 1,
      periodUnit: 'ay',
      responsibilityType: 'teknik_servis',
      requiresOutgoingPartInfo: false,
      requiresSerialTracking: true,
    };
    setNewPeriodicPartRows(prev => [...prev, newRow]);
  };

  const updatePeriodicPartRow = (id: string, field: keyof NewPeriodicPartRow, value: any) => {
    setNewPeriodicPartRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const selectProductForRow = (rowId: string, product: ProductCode) => {
    setNewPeriodicPartRows(prev => prev.map(row =>
      row.id === rowId
        ? { ...row, productCodeId: product.id, stokKodu: product.stokKodu, stokAdi: product.stokAdi }
        : row
    ));
  };

  const removePeriodicPartRow = (id: string) => {
    setNewPeriodicPartRows(prev => prev.filter(row => row.id !== id));
  };

  const removeExistingPeriodicPart = async (partId: string) => {
    if (!confirm('Bu periyodik parça değişimini silmek istediğinize emin misiniz?')) return;

    try {
      await deleteDoc(doc(db, 'periodicPartChanges', partId));
      setExistingPeriodicParts(prev => prev.filter(p => p.id !== partId));
      toast({ title: 'Silindi', description: 'Periyodik parça değişimi silindi.' });
    } catch (err) {
      console.error('Periyodik parça değişimi silinemedi:', err);
      toast({ title: 'Hata', description: 'Periyodik parça değişimi silinemedi.', variant: 'destructive' });
    }
  };

  // Sorumluluk tipi etiketleri
  const RESPONSIBILITY_LABELS: Record<PeriodicPartResponsibility, string> = {
    teknik_servis: 'Teknik Servis',
    aplikasyon: 'Aplikasyon',
    both: 'Her İkisi',
  };

  const saveMaintenancePlans = async () => {
    if (!maintenanceDevice) return;

    // Validate new maintenance plan rows
    const allNewRows = [
      ...newTeknikRows.map(r => ({ ...r, type: 'teknik_servis' as MaintenanceType })),
      ...newAplikasyonRows.map(r => ({ ...r, type: 'aplikasyon' as MaintenanceType })),
    ];

    const invalidRow = allNewRows.find(r => !r.taskName.trim());
    if (invalidRow) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm iş adlarını doldurun.', variant: 'destructive' });
      return;
    }

    // Validate periodic part change rows
    const invalidPartRow = newPeriodicPartRows.find(r => !r.productCodeId);
    if (invalidPartRow) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm periyodik parça değişimlerinde ürün seçin.', variant: 'destructive' });
      return;
    }

    if (allNewRows.length === 0 && newPeriodicPartRows.length === 0) {
      setMaintenanceModalOpen(false);
      return;
    }

    setIsSavingPlans(true);

    try {
      // Bakım planlarını kaydet
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

      // Periyodik parça değişimlerini kaydet
      for (const row of newPeriodicPartRows) {
        await addDoc(collection(db, 'periodicPartChanges'), {
          deviceId: maintenanceDevice.id,
          productCodeId: row.productCodeId,
          stokKodu: row.stokKodu,
          stokAdi: row.stokAdi,
          periodValue: row.periodValue,
          periodUnit: row.periodUnit,
          responsibilityType: row.responsibilityType,
          requiresOutgoingPartInfo: row.requiresOutgoingPartInfo,
          requiresSerialTracking: row.requiresSerialTracking,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
      }

      const totalSaved = allNewRows.length + newPeriodicPartRows.length;
      toast({ title: 'Başarılı', description: `${totalSaved} kayıt eklendi.` });
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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

          {/* Periyodik Parça Değişimi Bölümü */}
          {!isLoadingPlans && (
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center justify-between mb-4">
                <Label className="flex items-center gap-2 font-semibold">
                  <Package className="h-4 w-4" />
                  Periyodik Parça Değişimleri ({existingPeriodicParts.length + newPeriodicPartRows.length})
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPeriodicPartSection(!showPeriodicPartSection)}
                >
                  {showPeriodicPartSection ? 'Gizle' : 'Göster'}
                </Button>
              </div>

              {showPeriodicPartSection && (
                <div className="space-y-4">
                  <ScrollArea className="max-h-64 border rounded-md p-3">
                    {/* Mevcut periyodik parça değişimleri */}
                    {existingPeriodicParts.map(part => (
                      <div key={part.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md mb-2">
                        <div className="flex-1">
                          <p className="font-medium text-sm">{part.stokAdi}</p>
                          <p className="text-xs text-muted-foreground font-mono">{part.stokKodu}</p>
                          <div className="flex gap-2 mt-1">
                            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {part.periodValue} {PERIOD_UNIT_LABELS[part.periodUnit]}
                            </span>
                            <span className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                              {RESPONSIBILITY_LABELS[part.responsibilityType]}
                            </span>
                            {part.requiresSerialTracking && (
                              <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                Seri No
                              </span>
                            )}
                            {part.requiresOutgoingPartInfo && (
                              <span className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 px-1.5 py-0.5 rounded">
                                Çıkan Parça
                              </span>
                            )}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeExistingPeriodicPart(part.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}

                    {/* Yeni periyodik parça değişimi satırları */}
                    {newPeriodicPartRows.map(row => (
                      <div key={row.id} className="border border-dashed rounded-md p-3 mb-2 space-y-3">
                        {/* İlk satır: Ürün seçici ve periyot */}
                        <div className="flex items-center gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" role="combobox" className="flex-1 justify-between">
                                {row.stokAdi ? (
                                  <span className="truncate">{row.stokKodu} - {row.stokAdi.substring(0, 30)}...</span>
                                ) : (
                                  <span className="text-muted-foreground">Ürün seçin...</span>
                                )}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0">
                              <Command>
                                <CommandInput placeholder="Ürün kodu veya adı ara..." />
                                <CommandList>
                                  <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                                  <CommandGroup>
                                    {productCodes.slice(0, 50).map(product => (
                                      <CommandItem
                                        key={product.id}
                                        value={`${product.stokKodu} ${product.stokAdi}`}
                                        onSelect={() => selectProductForRow(row.id, product)}
                                      >
                                        <CheckIcon className={cn("mr-2 h-4 w-4", row.productCodeId === product.id ? "opacity-100" : "opacity-0")} />
                                        <div className="flex flex-col">
                                          <span className="font-medium">{product.stokKodu}</span>
                                          <span className="text-sm text-muted-foreground truncate">{product.stokAdi}</span>
                                        </div>
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          <Input
                            type="number"
                            min="1"
                            value={row.periodValue}
                            onChange={(e) => updatePeriodicPartRow(row.id, 'periodValue', Number(e.target.value))}
                            className="w-16"
                          />
                          <Select
                            value={row.periodUnit}
                            onValueChange={(v) => updatePeriodicPartRow(row.id, 'periodUnit', v as MaintenancePeriodUnit)}
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
                          <Button variant="ghost" size="icon" onClick={() => removePeriodicPartRow(row.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>

                        {/* İkinci satır: Sorumluluk ve takip seçenekleri */}
                        <div className="flex flex-wrap items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground">Sorumluluk:</Label>
                            <Select
                              value={row.responsibilityType}
                              onValueChange={(v) => updatePeriodicPartRow(row.id, 'responsibilityType', v as PeriodicPartResponsibility)}
                            >
                              <SelectTrigger className="w-32 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="teknik_servis">Teknik Servis</SelectItem>
                                <SelectItem value="aplikasyon">Aplikasyon</SelectItem>
                                <SelectItem value="both">Her İkisi</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`serial-${row.id}`}
                              checked={row.requiresSerialTracking}
                              onCheckedChange={(checked) => updatePeriodicPartRow(row.id, 'requiresSerialTracking', checked)}
                            />
                            <Label htmlFor={`serial-${row.id}`} className="text-xs cursor-pointer">
                              Seri No Takibi
                            </Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`outgoing-${row.id}`}
                              checked={row.requiresOutgoingPartInfo}
                              onCheckedChange={(checked) => updatePeriodicPartRow(row.id, 'requiresOutgoingPartInfo', checked)}
                            />
                            <Label htmlFor={`outgoing-${row.id}`} className="text-xs cursor-pointer">
                              Çıkan Parça Bilgisi
                            </Label>
                          </div>
                        </div>
                      </div>
                    ))}

                    {existingPeriodicParts.length === 0 && newPeriodicPartRows.length === 0 && (
                      <p className="text-center text-muted-foreground py-4">
                        Henüz periyodik parça değişimi tanımlanmamış.
                      </p>
                    )}
                  </ScrollArea>

                  <Button variant="outline" className="w-full" onClick={addNewPeriodicPartRow}>
                    <Plus className="h-4 w-4 mr-2" /> Periyodik Parça Değişimi Ekle
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setMaintenanceModalOpen(false)}>Kapat</Button>
            <Button onClick={saveMaintenancePlans} disabled={isSavingPlans || (newTeknikRows.length === 0 && newAplikasyonRows.length === 0 && newPeriodicPartRows.length === 0)}>
              {isSavingPlans ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
