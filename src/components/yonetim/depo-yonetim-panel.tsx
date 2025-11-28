'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Depot, ProductCode, AddressDefinition } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, setDoc, deleteDoc, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Edit3, Trash2, SlidersHorizontal, Map, Loader2, Warehouse } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import MapDefinitionModal from '@/components/MapDefinitionModal';
import MinMaxSettingsPanel from '@/components/MinMaxSettingsPanel';

export default function DepoYonetimPanel() {
  const { toast } = useToast();
  const [depots, setDepots] = useState<Depot[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
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
      const [depotsSnap, productsSnap, addressesSnap] = await Promise.all([
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'addressDefinitions')),
      ]);
      setDepots(depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)));
      setProductCodes(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
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

  const handleSaveDepot = async () => {
    if (!currentDepot.name) {
      toast({ title: 'Hata', description: 'Depo adı boş olamaz.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      if (currentDepot.id) {
        await setDoc(doc(db, 'depots', currentDepot.id), { name: currentDepot.name }, { merge: true });
      } else {
        await addDoc(collection(db, 'depots'), { name: currentDepot.name });
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
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {depots.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
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
        <DialogContent>
          <DialogHeader><DialogTitle>{currentDepot.id ? 'Depo Düzenle' : 'Yeni Depo'}</DialogTitle></DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Depo Adı"
              value={currentDepot.name || ''}
              onChange={(e) => setCurrentDepot({ ...currentDepot, name: e.target.value })}
            />
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
