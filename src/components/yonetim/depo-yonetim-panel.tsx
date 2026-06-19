'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Depot, ProductCode, AddressDefinition, Hospital, DeviceLabPool } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, addDoc, setDoc, deleteDoc, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { YonetimShell, YonetimHeader, YonetimCard } from '@/components/yonetim-ui/YonetimHub';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Edit3, Trash2, SlidersHorizontal, Map, Loader2, Warehouse, MapPin, Database } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import MapDefinitionModal from '@/components/MapDefinitionModal';
import MinMaxSettingsPanel from '@/components/MinMaxSettingsPanel';
import dynamic from 'next/dynamic';
import { useAuth } from '@/contexts/auth-context';
import { getScopedDocs } from '@/lib/firestore-helpers';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';

const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full bg-muted rounded-md"><Loader2 className="h-6 w-6 animate-spin" /></div>,
});

export default function DepoYonetimPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();
  const [depots, setDepots] = useState<Depot[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [addressDefinitions, setAddressDefinitions] = useState<AddressDefinition[]>([]);
  const [deviceLabPools, setDeviceLabPools] = useState<DeviceLabPool[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isDepotModalOpen, setIsDepotModalOpen] = useState(false);
  const [currentDepot, setCurrentDepot] = useState<Partial<Depot>>({});

  const [isMinMaxPanelOpen, setIsMinMaxPanelOpen] = useState(false);
  const [minMaxTarget, setMinMaxTarget] = useState<Depot | null>(null);

  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [mapEditorTarget, setMapEditorTarget] = useState<Depot | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [depotsSnap, productsSnap, hospitalsSnap, addressesSnap, poolsSnap] = await Promise.all([
        getScopedDocs('depots', currentCompanyId, isSuperAdmin),
        getScopedDocs('productCodes', currentCompanyId, isSuperAdmin),
        getScopedDocs('hospitals', currentCompanyId, isSuperAdmin),
        getScopedDocs('addressDefinitions', currentCompanyId, isSuperAdmin),
        getScopedDocs('deviceLabPools', currentCompanyId, isSuperAdmin),
      ]);
      setDepots(filterByCompanyScope(depotsSnap.map(d => ({ id: d.id, ...d.data() } as Depot)), currentCompanyId, isSuperAdmin));
      setProductCodes(productsSnap.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
      setHospitals(filterByCompanyScope(hospitalsSnap.map(d => ({ id: d.id, ...d.data() } as Hospital)), currentCompanyId, isSuperAdmin));
      setAddressDefinitions(filterByCompanyScope(addressesSnap.map(d => ({ id: d.id, ...d.data() } as AddressDefinition)), currentCompanyId, isSuperAdmin));
      setDeviceLabPools(filterByCompanyScope(poolsSnap.map(d => ({ id: d.id, ...d.data() } as DeviceLabPool)), currentCompanyId, isSuperAdmin).sort((a, b) => {
        const aMs = (a as any).createdAt?.toMillis?.() ?? (a as any).createdAt?.toDate?.()?.getTime?.() ?? 0;
        const bMs = (b as any).createdAt?.toMillis?.() ?? (b as any).createdAt?.toDate?.()?.getTime?.() ?? 0;
        return bMs - aMs;
      }));
    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openNewDepotModal = () => {
    setCurrentDepot({});
    setIsDepotModalOpen(true);
  };

  const openEditDepotModal = (depot: Depot) => {
    setCurrentDepot(depot);
    setIsDepotModalOpen(true);
  };

  const handleAddressInputChange = (value: string) => {
    const coordsMatch = value.match(/^([-]?\d{1,2}\.\d+),\s*([-]?\d{1,3}\.\d+)$/);
    if (coordsMatch) {
      const lat = parseFloat(coordsMatch[1]);
      const lng = parseFloat(coordsMatch[2]);
      setCurrentDepot(prev => ({ ...prev, address: value, lat, lng }));
    } else {
      setCurrentDepot(prev => ({ ...prev, address: value }));
    }
  };

  const handleSaveDepot = async () => {
    if (!currentDepot.name) {
      toast({ title: 'Hata', description: 'Depo adı boş olamaz.', variant: 'destructive' });
      return;
    }
    if (currentDepot.isPoolWarehouse && (!currentDepot.linkedDeviceLabPoolIds || currentDepot.linkedDeviceLabPoolIds.length === 0)) {
      toast({ title: 'Hata', description: 'Havuz depo için en az bir Cihaz Laboratuvar Grubu seçmelisiniz.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const dataToSave: Partial<Depot> = {
        name: currentDepot.name.trim(),
        address: currentDepot.address || '',
        lat: currentDepot.lat ?? null,
        lng: currentDepot.lng ?? null,
        linkedLaboratoryIds: (currentDepot.linkedLaboratoryIds || []).filter(Boolean),
        isPoolWarehouse: currentDepot.isPoolWarehouse || false,
        linkedDeviceLabPoolIds: currentDepot.isPoolWarehouse ? (currentDepot.linkedDeviceLabPoolIds || []).filter(Boolean) : [],
        ceomedEnabled: currentDepot.ceomedEnabled || false,
        ceomedDepoKodu: currentDepot.ceomedEnabled ? (currentDepot.ceomedDepoKodu || '').toString().trim() : '',
        ceomedCariKodu: (currentDepot.ceomedCariKodu || '').toString().trim().toUpperCase(),
        orderLimitEnabled: currentDepot.orderLimitEnabled ?? false,
      };

      if (currentDepot.id) {
        await setDoc(doc(db, 'depots', currentDepot.id), dataToSave, { merge: true });
      } else {
        await addDoc(collection(db, 'depots'), withCompanyScope(dataToSave, currentUserProfile?.companyId));
      }
      toast({ title: 'Başarılı', description: 'Depo kaydedildi.' });
      fetchData();
      setIsDepotModalOpen(false);
    } catch (error) {
      toast({ title: 'Hata', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteDepot = async (id: string) => {
    if (confirm('Bu depoyu silmek istediğinizden emin misiniz?')) {
      await deleteDoc(doc(db, 'depots', id));
      toast({ title: 'Silindi', description: 'Depo silindi.', variant: 'destructive' });
      fetchData();
    }
  };

  const handleSaveMap = async (mapDefinition: any) => {
    if (!mapEditorTarget) return;
    try {
      await setDoc(doc(db, 'depots', mapEditorTarget.id), { mapDefinition }, { merge: true });
      toast({ title: 'Başarılı', description: 'Harita tanımı kaydedildi.' });
      fetchData();
      setIsMapEditorOpen(false);
    } catch (e) {
      toast({ title: 'Hata', description: 'Harita kaydedilemedi.', variant: 'destructive' });
    }
  };

  const getPoolNames = (depot: Depot) => {
    if (!depot.linkedDeviceLabPoolIds?.length) return '';
    return depot.linkedDeviceLabPoolIds
      .map(id => deviceLabPools.find(p => p.id === id)?.name)
      .filter(Boolean)
      .join(', ');
  };

  return (
    <YonetimShell>
      <YonetimHeader
        title="Depo Yönetimi"
        description="Yeni depolar ekleyin veya mevcutları düzenleyin."
        backHref="/yonetim/tanimlar"
        rightAction={
          <Button onClick={openNewDepotModal} size="sm" disabled={isLoading} style={{ background: 'var(--mg-accent)', color: '#0a0a0c', border: 'none', fontWeight: 700 }}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Yeni Depo
          </Button>
        }
      />
      <YonetimCard>
          {isLoading ? (
            <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <ScrollArea className="h-[300px] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Depo Adı</TableHead>
                    <TableHead>Tip</TableHead>
                    <TableHead>Adres</TableHead>
                    <TableHead>Konum</TableHead>
                    <TableHead>Bağlı Lab</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {depots.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell>
                        {d.isPoolWarehouse ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                            <Database className="h-3 w-3" />
                            Havuz
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Standart</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{d.address || '-'}</TableCell>
                      <TableCell>
                        {d.lat && d.lng ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600">
                            <MapPin className="h-3 w-3" />
                            Tanımlı
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {d.isPoolWarehouse ? (
                          <span className="text-xs text-muted-foreground" title={getPoolNames(d)}>
                            {(d.linkedDeviceLabPoolIds || []).length} grup
                          </span>
                        ) : (
                          (d.linkedLaboratoryIds || []).length
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="icon" onClick={() => { setMinMaxTarget(d); setIsMinMaxPanelOpen(true); }}><SlidersHorizontal className="h-4 w-4 text-primary" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { setMapEditorTarget(d); setIsMapEditorOpen(true);}}><Map className="h-4 w-4 text-indigo-500" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEditDepotModal(d)}><Edit3 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteDepot(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
      </YonetimCard>

      <Dialog open={isDepotModalOpen} onOpenChange={setIsDepotModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{currentDepot.id ? 'Depo Düzenle' : 'Yeni Depo'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">Depo Adı</label>
                <Input
                  placeholder="Örn. Ana Depo"
                  value={currentDepot.name || ''}
                  onChange={(e) => setCurrentDepot({ ...currentDepot, name: e.target.value })}
                  className="mt-1"
                />
              </div>

              {/* Havuz Depo Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Database className="h-4 w-4 text-purple-600" />
                    Havuz Depo
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Personel haricinde paylaşılan havuz stok deposu olarak tanımla.
                  </p>
                </div>
                <Switch
                  checked={currentDepot.isPoolWarehouse || false}
                  onCheckedChange={(checked) => setCurrentDepot({ ...currentDepot, isPoolWarehouse: checked })}
                />
              </div>

              {/* Ceomed entegrasyonu */}
              <div className="flex items-start justify-between gap-3 p-3 border rounded-md">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Ceomed Entegrasyonu</label>
                  <p className="text-xs text-muted-foreground">
                    Bu depo Ceomed ERP'den günlük olarak senkronize edilir. Stok hareketleri ERP üzerinden yapılır.
                  </p>
                </div>
                <Switch
                  checked={currentDepot.ceomedEnabled || false}
                  onCheckedChange={(checked) => setCurrentDepot({ ...currentDepot, ceomedEnabled: checked })}
                />
              </div>
              {currentDepot.ceomedEnabled && (
                <>
                <div>
                  <label className="text-sm text-muted-foreground">Ceomed Depo Kodu *</label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Ceomed'deki depo numarası (örn. 77). selectMerkezDepoListesi yanıtındaki "DEPO{'{kod}'}" alanı okunur.
                  </p>
                  <Input
                    value={currentDepot.ceomedDepoKodu || ''}
                    onChange={(e) => setCurrentDepot({ ...currentDepot, ceomedDepoKodu: e.target.value.replace(/\D/g, '') })}
                    placeholder="77"
                    className="mt-1"
                  />
                </div>
                </>
              )}

              <div className="flex items-start justify-between gap-3 p-3 border rounded-md">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Sipariş Kısıtlaması</label>
                  <p className="text-xs text-muted-foreground">
                    Aktifse manuel depo ürün talebinde, mevcut depo stoğu + talep adedi tanımlı max adedi aşamaz.
                  </p>
                </div>
                <Switch
                  checked={currentDepot.orderLimitEnabled || false}
                  onCheckedChange={(checked) => setCurrentDepot({ ...currentDepot, orderLimitEnabled: checked })}
                />
              </div>

              <div>
                <label className="text-sm text-muted-foreground">Ceomed Cari Kodu</label>
                <p className="text-xs text-muted-foreground mb-1">
                  Ceomed irsaliye eşleştirmesi için cari kodu (örn. M51001). Ceomed entegrasyon toggle'ından bağımsızdır.
                </p>
                <Input
                  value={currentDepot.ceomedCariKodu || ''}
                  onChange={(e) => setCurrentDepot({ ...currentDepot, ceomedCariKodu: e.target.value.trim().toUpperCase() })}
                  placeholder="M51001"
                  className="mt-1"
                />
              </div>

              {/* Cihaz Laboratuvar Grubu seçimi - Sadece havuz depo seçiliyken */}
              {currentDepot.isPoolWarehouse && (
                <div>
                  <label className="text-sm text-muted-foreground">Bağlı Cihaz Laboratuvar Grupları *</label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Bu havuz deposunun hizmet vereceği laboratuvar gruplarını seçin.
                  </p>
                  <ScrollArea className="h-40 border rounded-md p-2 mt-1">
                    <div className="space-y-2">
                      {deviceLabPools.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">
                          Henüz Cihaz Laboratuvar Grubu tanımlanmamış. Önce Cihaz Tanımlamaları panelinden grup oluşturun.
                        </p>
                      ) : deviceLabPools.map(pool => {
                        const selected = (currentDepot.linkedDeviceLabPoolIds || []).includes(pool.id);
                        return (
                          <label key={pool.id} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-muted/50">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => {
                                const prev = currentDepot.linkedDeviceLabPoolIds || [];
                                const next = e.target.checked ? [...prev, pool.id] : prev.filter(id => id !== pool.id);
                                setCurrentDepot({ ...currentDepot, linkedDeviceLabPoolIds: next });
                              }}
                            />
                            <div>
                              <span className="font-medium">{pool.name}</span>
                              <span className="text-xs text-muted-foreground ml-2">({pool.memberIds.length} lab)</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <div>
                <label className="text-sm text-muted-foreground">Adres / Koordinat</label>
                <Input
                  placeholder="Adres veya 41.0082, 28.9784 formatında koordinat"
                  value={currentDepot.address || ''}
                  onChange={(e) => handleAddressInputChange(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Koordinat girmek için &quot;41.0082, 28.9784&quot; formatını kullanın veya haritadan seçin.
                </p>
              </div>
              {currentDepot.lat && currentDepot.lng && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                  <div className="flex items-center gap-2 text-green-600">
                    <MapPin className="h-4 w-4" />
                    <span className="text-sm font-medium">Konum Tanımlı</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {currentDepot.lat.toFixed(6)}, {currentDepot.lng.toFixed(6)}
                  </p>
                </div>
              )}

              {!currentDepot.isPoolWarehouse && (
                <div>
                  <label className="text-sm text-muted-foreground">Depoya Bağlı Laboratuvarlar (Toplu Sipariş için)</label>
                  <ScrollArea className="h-40 border rounded-md p-2 mt-1">
                    <div className="space-y-2">
                      {hospitals.map(h => {
                        const selected = (currentDepot.linkedLaboratoryIds || []).includes(h.id);
                        return (
                          <label key={h.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => {
                                const prev = currentDepot.linkedLaboratoryIds || [];
                                const next = e.target.checked ? [...prev, h.id] : prev.filter(id => id !== h.id);
                                setCurrentDepot({ ...currentDepot, linkedLaboratoryIds: next });
                              }}
                            />
                            <span>{h.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </ScrollArea>
                  <p className="text-xs text-muted-foreground mt-1">Bu seçim yalnızca Merkez/Toplu Sipariş hesaplarında kullanılır.</p>
                </div>
              )}
            </div>
            <div className="h-80 rounded-md overflow-hidden border">
              <LocationPicker
                initialPosition={[currentDepot.lat || 41.015137, currentDepot.lng || 28.979530]}
                markerPosition={currentDepot.lat ? [currentDepot.lat, currentDepot.lng!] : undefined}
                onSelect={(lat, lng) => setCurrentDepot(prev => ({ ...prev, lat, lng }))}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSaveDepot} disabled={isLoading}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isMinMaxPanelOpen && minMaxTarget && (
        <MinMaxSettingsPanel
          isOpen={isMinMaxPanelOpen}
          onClose={() => setIsMinMaxPanelOpen(false)}
          target={minMaxTarget}
          targetType="depot"
          productCodes={productCodes}
          toast={toast}
        />
      )}

      {isMapEditorOpen && mapEditorTarget && (
        <MapDefinitionModal
          depot={mapEditorTarget}
          initialMap={mapEditorTarget.mapDefinition}
          addresses={addressDefinitions}
          products={productCodes}
          onSave={handleSaveMap}
          onClose={() => setIsMapEditorOpen(false)}
        />
      )}
    </YonetimShell>
  );
}
