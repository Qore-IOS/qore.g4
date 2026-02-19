'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Depot, ProductCode, AddressDefinition, Hospital } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, setDoc, deleteDoc, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Edit3, Trash2, SlidersHorizontal, Map, Loader2, Warehouse, MapPin } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import MapDefinitionModal from '@/components/MapDefinitionModal';
import MinMaxSettingsPanel from '@/components/MinMaxSettingsPanel';
import dynamic from 'next/dynamic';

const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full bg-muted rounded-md"><Loader2 className="h-6 w-6 animate-spin" /></div>,
});

export default function DepoYonetimPanel() {
  const { toast } = useToast();
  const [depots, setDepots] = useState<Depot[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [addressDefinitions, setAddressDefinitions] = useState<AddressDefinition[]>([]);
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
      const [depotsSnap, productsSnap, hospitalsSnap, addressesSnap] = await Promise.all([
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'addressDefinitions')),
      ]);
      setDepots(depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)));
      setProductCodes(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
      setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
      setAddressDefinitions(addressesSnap.docs.map(d => ({ id: d.id, ...d.data() } as AddressDefinition)));
    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

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
    setIsLoading(true);
    try {
      const dataToSave: Partial<Depot> = {
        name: currentDepot.name.trim(),
        address: currentDepot.address || '',
        lat: currentDepot.lat ?? null,
        lng: currentDepot.lng ?? null,
        linkedLaboratoryIds: (currentDepot.linkedLaboratoryIds || []).filter(Boolean),
      };

      if (currentDepot.id) {
        await setDoc(doc(db, 'depots', currentDepot.id), dataToSave, { merge: true });
      } else {
        await addDoc(collection(db, 'depots'), dataToSave);
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

  return (
    <>
      <Card className="shadow-lg">
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle className="text-xl font-headline flex items-center">
              <Warehouse className="mr-2 h-6 w-6 text-orange-500" />
              Depo Yönetimi
            </CardTitle>
            <CardDescription>Yeni depolar ekleyin veya mevcutları düzenleyin.</CardDescription>
          </div>
          <Button onClick={openNewDepotModal} size="sm" disabled={isLoading}>
            <PlusCircle className="mr-2 h-4 w-4" />Yeni Depo
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <ScrollArea className="h-[300px] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Depo Adı</TableHead>
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
                        {(d.linkedLaboratoryIds || []).length}
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
        </CardContent>
      </Card>

      <Dialog open={isDepotModalOpen} onOpenChange={setIsDepotModalOpen}>
        <DialogContent className="max-w-3xl">
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
    </>
  );
}
