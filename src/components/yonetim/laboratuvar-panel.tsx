
'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Depot, Hospital, ProductCode, AddressDefinition, LabPool } from '@/lib/types';
import { db } from '../../lib/data/client';
import { collection, getDocs, addDoc, setDoc, deleteDoc, doc, writeBatch, Timestamp, query, orderBy, updateDoc } from '../../lib/data/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/document-helpers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Edit3, Trash2, SlidersHorizontal, Map, Loader2, Warehouse, Network, Plus, X, FlaskConical, Users, Star, Mail } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import MinMaxSettingsPanel from '@/components/MinMaxSettingsPanel';
import BackButton from '@/components/BackButton';
import dynamic from 'next/dynamic';
import SharedLabPoolModal from '@/components/SharedLabPoolModal';

const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full bg-muted rounded-md"><Loader2 className="h-6 w-6 animate-spin" /></div>,
});


export default function LaboratuvarPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [addressDefinitions, setAddressDefinitions] = useState<AddressDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentHospital, setCurrentHospital] = useState<Partial<Hospital>>({});
  const [isMinMaxPanelOpen, setIsMinMaxPanelOpen] = useState(false);
  const [minMaxTarget, setMinMaxTarget] = useState<Hospital | null>(null);

  const [hospitalSubPoints, setHospitalSubPoints] = useState<{ id?: string; name: string; isActive?: boolean }[]>([]);
  const [newSubPointName, setNewSubPointName] = useState('');
  const [isSavingSubPoint, setIsSavingSubPoint] = useState(false);
  const [isEditingHospital, setIsEditingHospital] = useState(false);

  const [isPoolModalOpen, setIsPoolModalOpen] = useState(false);
  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [isPoolListModalOpen, setIsPoolListModalOpen] = useState(false);
  const [poolDetailsModal, setPoolDetailsModal] = useState<{ open: boolean; pool: LabPool | null }>({ open: false, pool: null });


  const fetchHospitalsAndProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const [hSnap, pSnap, addrSnap, poolsSnap] = await Promise.all([
        getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('addressDefinitions', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('labPools', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc'))),
      ]);
      setHospitals(hSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
      setProductCodes(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
      setAddressDefinitions(addrSnap.docs.map(d => ({ id: d.id, ...d.data() } as AddressDefinition)));
      setLabPools(poolsSnap.docs.map(d => ({ id: d.id, ...d.data() } as LabPool)));
    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchHospitalsAndProducts();
  }, [fetchHospitalsAndProducts]);

  const openModal = (hospital?: Hospital) => {
    if (hospital && hospital.id) {
        setCurrentHospital(hospital);
        setIsEditingHospital(true);
        setIsModalOpen(true);
        
        (async () => {
          try {
            const snap = await getDocs(query(collection(db, 'hospitals', hospital.id!, 'subPoints'), orderBy('name', 'asc')));
            const items = snap.docs.map(d => {
              const data = d.data() as any;
              return { id: d.id, name: data.name, isActive: data.isActive ?? true };
            });
            setHospitalSubPoints(items);
          } catch (e) {
            console.error('SubPoints fetch error', e);
            toast({ title: 'Alt Nokta', description: 'Alt tüketim noktaları yüklenemedi.', variant: 'destructive' });
          }
        })();

    } else {
        setCurrentHospital({ consumptionTrackingEnabled: true, isConsumablesHospital: false, manualDeductionEnabled: false, visualDeductionEnabled: false, fefoEnabled: true, kod: '' }); // Default FEFO to ON for new labs
        setIsEditingHospital(false);
        setIsModalOpen(true);
        setHospitalSubPoints([]);
        setNewSubPointName('');
    }
  };
  
  const handleAddressInputChange = (value: string) => {
    const coordsMatch = value.match(/^([-]?\d{1,2}\.\d+),\s*([-]?\d{1,3}\.\d+)$/);
    if (coordsMatch) {
      const lat = parseFloat(coordsMatch[1]);
      const lng = parseFloat(coordsMatch[2]);
      setCurrentHospital(prev => ({ ...prev, address: value, lat, lng }));
    } else {
      setCurrentHospital(prev => ({ ...prev, address: value }));
    }
  };

  const handleSave = async () => {
    if (!currentHospital.name) {
      toast({ title: 'Hata', description: 'Laboratuvar adı boş olamaz.', variant: 'destructive' });
      return;
    }
    
    setIsLoading(true);
    try {
      const dataToSave: Partial<Hospital> = {
        name: currentHospital.name.trim(),
        kod: (currentHospital.kod || '').trim().toUpperCase(),
        address: currentHospital.address || '',
        lat: currentHospital.lat || null,
        lng: currentHospital.lng || null,
        consumptionTrackingEnabled: currentHospital.consumptionTrackingEnabled ?? true,
        isConsumablesHospital: currentHospital.isConsumablesHospital ?? false,
        manualDeductionEnabled: currentHospital.manualDeductionEnabled ?? false,
        visualDeductionEnabled: (currentHospital.manualDeductionEnabled ?? false) ? (currentHospital.visualDeductionEnabled ?? false) : false,
        fefoEnabled: currentHospital.fefoEnabled ?? true,
        autoTutanak: (currentHospital as any).autoTutanak ?? false,
        sorumluEmail: ((currentHospital as any).sorumluEmail || '').trim(),
        updatedAt: new Date(),
      };

      if (currentHospital.id && isEditingHospital) {
        await setDoc(doc(db, 'hospitals', currentHospital.id), dataToSave, { merge: true });
        toast({ title: 'Başarılı', description: 'Laboratuvar güncellendi.' });
      } else {
        const newRef = doc(collection(db, 'hospitals'));
        await setDoc(newRef, { ...dataToSave, createdAt: new Date() });
        
        if (hospitalSubPoints.length > 0) {
            const batch = writeBatch(db);
            hospitalSubPoints.forEach(sp => {
                const spRef = doc(collection(db, 'hospitals', newRef.id, 'subPoints'));
                batch.set(spRef, {
                    name: sp.name,
                    isActive: true,
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                });
            });
            await batch.commit();
        }
        toast({ title: 'Başarılı', description: 'Laboratuvar ve alt tüketim noktaları oluşturuldu.' });
      }
      
      fetchHospitalsAndProducts();
      setIsModalOpen(false);
      setCurrentHospital({});
      setHospitalSubPoints([]);

    } catch (error) {
      toast({ title: 'Hata', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu laboratuvarı silmek istediğinizden emin misiniz?')) {
      await deleteDoc(doc(db, 'hospitals', id));
      toast({ title: 'Silindi', description: 'Laboratuvar silindi.', variant: 'destructive' });
      fetchHospitalsAndProducts();
    }
  };

  const openMinMaxPanel = (hospital: Hospital) => {
    setMinMaxTarget(hospital);
    setIsMinMaxPanelOpen(true);
  };
  
  const handleAddSubPointInline = async () => {
    const name = newSubPointName.trim();
    if (!name) return;

    if (isEditingHospital && currentHospital?.id) {
        setIsSavingSubPoint(true);
        try {
            const newDocRef = await addDoc(collection(db, 'hospitals', currentHospital.id, 'subPoints'), {
                name,
                isActive: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });
            setHospitalSubPoints(prev => [...prev, { id: newDocRef.id, name, isActive: true }].sort((a,b)=>a.name.localeCompare(b.name)));
            setNewSubPointName('');
            toast({ title: 'Alt Nokta', description: 'Alt tüketim noktası eklendi.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Hata', description: 'Alt tüketim noktası eklenemedi.', variant: 'destructive' });
        } finally {
            setIsSavingSubPoint(false);
        }
    } else {
        setHospitalSubPoints(prev => [...prev, { name }].sort((a,b)=>a.name.localeCompare(b.name)));
        setNewSubPointName('');
    }
  };

  const handleRemoveSubPoint = async (sp: { id?: string; name: string }) => {
    if (isEditingHospital && currentHospital?.id && sp.id) {
        setIsSavingSubPoint(true);
        try {
            await deleteDoc(doc(db, 'hospitals', currentHospital.id!, 'subPoints', sp.id));
            setHospitalSubPoints(prev => prev.filter(x => x.id !== sp.id));
            toast({ title: 'Alt Nokta', description: 'Silindi.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Hata', description: 'Alt nokta silinemedi.', variant: 'destructive' });
        } finally {
            setIsSavingSubPoint(false);
        }
    } else {
        setHospitalSubPoints(prev => prev.filter(x => x.name !== sp.name));
    }
  };
  
  const handleSetMainLab = async (pool: LabPool, mainLabId: string) => {
    setIsLoading(true);
    try {
        await updateDoc(doc(db, 'labPools', pool.id), { mainLabId });
        setPoolDetailsModal({ open: true, pool: { ...pool, mainLabId }});
        fetchHospitalsAndProducts(); // Refresh list to show change immediately
        toast({ title: "Başarılı", description: "Ana laboratuvar güncellendi." });
    } catch (e) {
        toast({ title: 'Hata', description: 'Ana laboratuvar güncellenemedi.', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  };


  return (
    <>
      <div className="p-4 space-y-4">
        <BackButton fallback="/yonetim" />
        <Card className="shadow-lg">
          <CardHeader className="flex flex-row justify-between items-center">
            <div>
              <CardTitle className="text-xl font-headline flex items-center">
                <FlaskConical className="mr-2 h-6 w-6 text-green-500" />
                Laboratuvar Yönetimi
              </CardTitle>
              <CardDescription>Yeni laboratuvarlar ekleyin veya mevcutları düzenleyin.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setIsPoolListModalOpen(true)} size="sm" disabled={isLoading}>
                  Ortak Laboratuvarları Göster
              </Button>
              <Button onClick={() => setIsPoolModalOpen(true)} size="sm" disabled={isLoading}>
                Ortak Laboratuvar Oluştur
              </Button>
              <Button onClick={() => openModal()} size="sm" disabled={isLoading}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Yeni Laboratuvar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <ScrollArea className="h-[300px] border rounded-md">
                <Table>
                  <TableHeader><TableRow><TableHead>Adı</TableHead><TableHead>Kod</TableHead><TableHead>Adres</TableHead><TableHead>Sorumlu E-posta</TableHead><TableHead className="text-right">İşlemler</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {hospitals.map(h => (
                      <TableRow key={h.id}>
                        <TableCell className="font-medium">{h.name}</TableCell>
                        <TableCell className="font-mono text-xs">{h.kod}</TableCell>
                        <TableCell>{h.address}</TableCell>
                        <TableCell className="text-xs">{(h as any).sorumluEmail || '-'}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => openMinMaxPanel(h)}><SlidersHorizontal className="h-4 w-4 text-primary" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => openModal(h)}><Edit3 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(h.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{currentHospital.id ? 'Laboratuvar Düzenle' : 'Yeni Laboratuvar'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-4">
              <Input placeholder="Laboratuvar Adı" value={currentHospital.name || ''} onChange={(e) => setCurrentHospital({ ...currentHospital, name: e.target.value })} />
              <Input placeholder="Laboratuvar Kodu (Max 3 Karakter)" value={currentHospital.kod || ''} onChange={(e) => setCurrentHospital({ ...currentHospital, kod: e.target.value.toUpperCase() })} maxLength={3} />
              <Input placeholder="Adres" value={currentHospital.address || ''} onChange={(e) => handleAddressInputChange(e.target.value)} />
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="Sorumlu İletişim E-postası"
                  value={(currentHospital as any).sorumluEmail || ''}
                  onChange={(e) => setCurrentHospital({ ...currentHospital, sorumluEmail: e.target.value })}
                  className="pl-9"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                    id="fefo-enabled-switch"
                    checked={currentHospital.fefoEnabled ?? true}
                    onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, fefoEnabled: checked })}
                    />
                    <Label htmlFor="fefo-enabled-switch">
                        FEFO Takibi Aktif
                        <p className="text-xs text-muted-foreground">
                            Kapalıysa, ürün kullanımında miad kontrolü yapılmaz.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                    id="consumption-tracking-switch"
                    checked={currentHospital.consumptionTrackingEnabled ?? true}
                    onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, consumptionTrackingEnabled: checked })}
                    />
                    <Label htmlFor="consumption-tracking-switch">
                        Tüketim Takibi Aktif
                        <p className="text-xs text-muted-foreground">
                            Kapalıysa, sevk edilen ürünler direkt tüketilmiş sayılır.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                        id="manual-deduction-switch"
                        checked={currentHospital.manualDeductionEnabled ?? false}
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, manualDeductionEnabled: checked, visualDeductionEnabled: checked ? (currentHospital.visualDeductionEnabled ?? false) : false })}
                    />
                    <Label htmlFor="manual-deduction-switch">
                        Manuel Düşüme İzin Ver
                        <p className="text-xs text-muted-foreground">
                            Aktifse, Ürün Kullanım panelinde manuel düşüm butonu görünür.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                        id="visual-deduction-switch"
                        checked={currentHospital.visualDeductionEnabled ?? false}
                        disabled={!(currentHospital.manualDeductionEnabled ?? false)}
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, visualDeductionEnabled: checked })}
                    />
                    <Label htmlFor="visual-deduction-switch">
                        Görsel Düşüm
                        <p className="text-xs text-muted-foreground">
                            Manuel düşüm aktifken, ürün kullanım ekranında ana birim 3D modelleriyle büyük kartlar gösterilir.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                        id="auto-tutanak-switch"
                        checked={(currentHospital as any).autoTutanak ?? false}
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, autoTutanak: checked })}
                    />
                    <Label htmlFor="auto-tutanak-switch">
                        Otomatik Tutanak
                        <p className="text-xs text-muted-foreground">
                            Bu özellik etkinleştirildiğinde ilgili işlemler için otomatik tutanak oluşturulur.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                        id="is-consumables-hospital-switch"
                        checked={currentHospital.isConsumablesHospital ?? false}
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, isConsumablesHospital: checked })}
                    />
                    <Label htmlFor="is-consumables-hospital-switch">
                        Hastane Sarf Kategorisi
                        <p className="text-xs text-muted-foreground">
                            Aktifse, bu laboratuvar sadece Sarf Dağıtım panelinde görünür.
                        </p>
                    </Label>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-background/40 p-3">
                <div className="flex items-center gap-2 mb-2">
                    <Network className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Alt Tüketim Noktaları</span>
                </div>
                <div className="flex gap-2">
                    <Input
                    placeholder="Örn. X-1"
                    value={newSubPointName}
                    onChange={(e) => setNewSubPointName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSubPointInline()}
                    className="flex-1"
                    />
                    <Button onClick={handleAddSubPointInline} disabled={!newSubPointName.trim() || isSavingSubPoint}>
                    {isSavingSubPoint ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                    Ekle
                    </Button>
                </div>
                {hospitalSubPoints.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                    {hospitalSubPoints.map((sp, idx) => (
                        <span key={`${sp.id ?? 'tmp'}-${idx}`} className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-muted text-muted-foreground">
                        <span className="text-sm">{sp.name}</span>
                        <button
                            type="button"
                            onClick={() => handleRemoveSubPoint(sp)}
                            className="hover:text-destructive transition-colors"
                            title="Kaldır"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                        </span>
                    ))}
                    </div>
                ) : (
                    <p className="mt-2 text-xs text-muted-foreground">Henüz alt tüketim noktası eklenmedi.</p>
                )}
                {isEditingHospital ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Not: Düzenleme modunda eklenen/silinen alt noktalar anında kaydedilir.
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Not: Yeni laboratuvar kaydedildikten sonra alt noktalar oluşturulacaktır.
                  </p>
                )}
              </div>
            </div>
            <div className="h-96 rounded-md overflow-hidden">
                <LocationPicker
                    initialPosition={[currentHospital.lat || 41.015137, currentHospital.lng || 28.979530]}
                    markerPosition={currentHospital.lat ? [currentHospital.lat, currentHospital.lng!] : undefined}
                    onSelect={(lat, lng) => setCurrentHospital(prev => ({...prev, lat, lng}))}
                />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSave} disabled={isLoading}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {isMinMaxPanelOpen && minMaxTarget && (
        <MinMaxSettingsPanel
          isOpen={isMinMaxPanelOpen}
          onClose={() => setIsMinMaxPanelOpen(false)}
          target={minMaxTarget}
          targetType="hospital"
          productCodes={productCodes}
          toast={toast}
        />
      )}

      <SharedLabPoolModal open={isPoolModalOpen} onOpenChange={setIsPoolModalOpen} />
      
      <Dialog open={isPoolListModalOpen} onOpenChange={setIsPoolListModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mevcut Ortak Havuzlar</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-72 mt-4">
            <div className="space-y-3">
              {labPools.length === 0 ? <p className="text-sm text-muted-foreground">Ortak havuz bulunamadı.</p>
                : labPools.map(pool => (
                  <div key={pool.id} className="p-3 border rounded-md flex justify-between items-center cursor-pointer hover:bg-muted/50" onClick={() => setPoolDetailsModal({ open: true, pool })}>
                    <div>
                        <p className="font-semibold">{pool.name}</p>
                        <p className="text-xs text-muted-foreground">{pool.memberIds.length} üye</p>
                    </div>
                    <Button variant="ghost" size="icon"><Edit3 className="h-4 w-4"/></Button>
                  </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={poolDetailsModal.open} onOpenChange={(open) => !open && setPoolDetailsModal({open: false, pool: null})}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Havuz Detayları: {poolDetailsModal.pool?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <h4 className="font-medium">Üye Laboratuvarlar</h4>
            <div className="space-y-2">
            {poolDetailsModal.pool?.memberIds.map(labId => {
                const lab = hospitals.find(h => h.id === labId);
                const isMain = poolDetailsModal.pool?.mainLabId === labId;
                return (
                    <div key={labId} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                        <span className="text-sm flex items-center gap-2">
                           {isMain && <Star className="h-4 w-4 text-amber-500 fill-amber-400" />}
                           {lab?.name || 'Bilinmeyen Lab'}
                        </span>
                        {!isMain && (
                          <Button size="sm" variant="outline" onClick={() => handleSetMainLab(poolDetailsModal.pool!, labId)}>Ana Olarak Ayarla</Button>
                        )}
                    </div>
                );
            })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
