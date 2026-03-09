
'use client';
import React, { useState, useEffect, useCallback, useRef, Suspense, ChangeEvent, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ScannedItem,
  ProductCode,
  Depot,
  Hospital,
  DepoStokItem
} from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Barcode, Trash2, CheckCircle, Loader2, Search, AlertTriangle, Undo, Info, History } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, serverTimestamp, addDoc, onSnapshot } from 'firebase/firestore';
import { cn, generateId, playFeedback } from '@/lib/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import useHidScanner from '@/hooks/useHidScanner';
import type { ParsedGeneric, BarcodeFormat } from '@/lib/barcode';
import BackButton from '@/components/BackButton';
import { useAuth } from '@/contexts/auth-context';
import { resolveDefaultTrackingMode, TrackingMode } from '@/lib/tracking';


type ScanRow = DepoStokItem & {
  adet?: number;
  isGroup?: boolean;
};

export default function UrunIadePanel() {
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();
  const { parseAndResolveBarcode, formats: barcodeFormats } = useBarcodeParser();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [shippedStock, setShippedStock] = useState<DepoStokItem[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  
  const [selectedDepotId, setSelectedDepotId] = useState('');
  const [selectedLabId, setSelectedLabId] = useState('');

  const [returnItems, setReturnItems] = useState<ScanRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [returnBarcode, setReturnBarcode] = useState('');

  const depotName = useMemo(() => depots.find(d => d.id === selectedDepotId)?.name || '', [depots, selectedDepotId]);
  const selectedLabName = useMemo(() => hospitals.find(l => l.id === selectedLabId)?.name || '', [hospitals, selectedLabId]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [depotsSnap, hospitalsSnap, productsSnap] = await Promise.all([
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'productCodes')),
      ]);
      const depotList = depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
      setDepots(depotList);
      setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
      setProductCodes(productsSnap.docs.map(p => ({ id: p.id, ...p.data() } as ProductCode)));

      if (depotList.length > 0 && !selectedDepotId && depotList[0].id) {
        setSelectedDepotId(depotList[0].id);
      }
    } catch (error) {
      toast({ title: 'Hata', description: 'Gerekli veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, selectedDepotId]);

  useEffect(() => {
    fetchData();

    const q = query(collection(db, 'depoStok'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const stockItems = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DepoStokItem));
        setShippedStock(stockItems);
    }, (error) => {
        console.error("Error listening to stock:", error);
        toast({ title: "Stok Hatası", description: "Stok verileri dinlenirken bir hata oluştu.", variant: "destructive" });
    });

    return () => unsubscribe();
  }, [fetchData, toast]);

  const handleScan = useCallback((barcode: string) => {
    if (!barcode) return;
    if (!selectedLabId) {
        toast({ title: 'Laboratuvar Seçilmedi', description: 'Lütfen önce ürünlerin iade alınacağı laboratuvarı seçin.', variant: 'destructive' });
        return;
    }
    setProcessing(true);

    const resolveResult = parseAndResolveBarcode(barcode, barcodeFormats, productCodes as any);
    if (!resolveResult || !resolveResult.parsed) {
        toast({ title: 'Geçersiz Barkod', description: 'Barkod formatı tanınamadı.', variant: 'destructive'});
        setProcessing(false);
        return;
    }

    const { product } = resolveResult;
    const { stokKodu, seriNumarasi, lotNumarasi } = resolveResult.parsed;
    if (!product) {
        toast({ title: 'Ürün Bulunamadı', description: 'Barkodla eşleşen bir ürün tanımı bulunamadı.', variant: 'destructive'});
        setProcessing(false);
        return;
    }

    const trackingMode = resolveDefaultTrackingMode(product);
    
    let existingItem: DepoStokItem | undefined;

    if (trackingMode === 'serial' && seriNumarasi) {
        existingItem = shippedStock.find(item => item.isShipped && item.hedefKurumId === selectedLabId && item.seriNumarasi === seriNumarasi);
    } else { // Lot or Quantity tracked
        const lotToFind = lotNumarasi || '';
        const availableItemsInLot = shippedStock.filter(item => 
            item.isShipped && 
            item.hedefKurumId === selectedLabId && 
            item.stokKodu === stokKodu && 
            (item.lotNumarasi || '') === lotToFind
        );
        
        const alreadyReturnedSerialsInThisBatch = new Set(
          returnItems.filter(ri => ri.stokKodu === stokKodu && ri.lotNumarasi === lotToFind).map(ri => ri.seriNumarasi)
        );

        existingItem = availableItemsInLot.find(item => !alreadyReturnedSerialsInThisBatch.has(item.seriNumarasi));
    }


    if (existingItem) {
        if (returnItems.some(item => item.id === existingItem!.id)) {
            toast({ title: 'Zaten Listede', description: 'Bu ürün iade listesinde zaten mevcut.', variant: 'default' });
        } else {
            const isGrouped = trackingMode !== 'serial';
            
            if (isGrouped) {
                const groupKey = `${existingItem.stokKodu}-${existingItem.lotNumarasi || ''}-${existingItem.miad || ''}`;
                setReturnItems(prev => {
                    const groupIndex = prev.findIndex(item => item.isGroup && item.key === groupKey);
                    if (groupIndex > -1) {
                        const newItems = [...prev];
                        newItems[groupIndex] = { ...newItems[groupIndex], adet: (newItems[groupIndex].adet || 0) + 1 };
                        return newItems;
                    } else {
                        const newItem: ScanRow = {
                            ...existingItem,
                            adet: 1,
                            isGroup: true,
                            key: groupKey,
                        };
                        return [newItem, ...prev];
                    }
                });
            } else {
                const newItem: ScanRow = { ...existingItem, adet: 1, isGroup: false };
                setReturnItems(prev => [newItem, ...prev]);
            }

            toast({ title: 'Ürün Bulundu', description: `${existingItem.stokAdi} iade listesine eklendi.` });
        }
    } else {
        toast({ title: 'Ürün Bulunamadı', description: `Okutulan ürün seçili laboratuvarın stoklarında bulunamadı veya hepsi zaten iade listesinde.`, variant: 'destructive' });
    }

    setReturnBarcode('');
    setProcessing(false);
  }, [shippedStock, returnItems, barcodeFormats, toast, selectedLabId, parseAndResolveBarcode, productCodes]);


  useHidScanner({
    onScan: ({ raw }) => handleScan(raw),
    enabled: !processing,
  });

  const removeItem = (id: string, isGroup: boolean, key?: string) => {
    if(isGroup && key) {
      setReturnItems(prev => prev.filter(item => item.key !== key));
    } else {
      setReturnItems(prev => prev.filter(item => item.id !== id));
    }
  };
  
  const processReturn = async () => {
    if (returnItems.length === 0) return;
    if (!selectedDepotId) {
        toast({ title: 'Depo Seçilmedi', description: 'Lütfen ürünlerin iade edileceği depoyu seçin.', variant: 'destructive' });
        return;
    }

    setProcessing(true);
    const batch = writeBatch(db);
    
    const itemsToProcess: DepoStokItem[] = [];
    returnItems.forEach(row => {
      if (row.isGroup) {
        const itemsOfLot = shippedStock.filter(
          (item) => item.isShipped && item.hedefKurumId === selectedLabId && item.stokKodu === row.stokKodu && item.lotNumarasi === row.lotNumarasi
        );
        itemsToProcess.push(...itemsOfLot.slice(0, row.adet));
      } else {
        itemsToProcess.push(row);
      }
    });
    
    if (itemsToProcess.length === 0) {
        toast({title: 'Hata', description: 'İade edilecek geçerli ürün bulunamadı.', variant: 'destructive'});
        setProcessing(false);
        return;
    }

    const returnRecordRef = doc(collection(db, 'productReturns'));
    batch.set(returnRecordRef, {
        returnId: returnRecordRef.id,
        itemCount: itemsToProcess.length,
        returnedToDepotId: selectedDepotId,
        returnedToDepotName: depotName,
        returnedByUid: currentUserProfile?.uid || 'system',
        returnedByName: currentUserProfile?.name || 'System',
        returnedAt: serverTimestamp(),
        items: itemsToProcess.map(item => ({
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            seriNumarasi: item.seriNumarasi,
            lotNumarasi: item.lotNumarasi,
            returnedFrom: item.hedefKurum || 'Bilinmeyen'
        }))
    });

    itemsToProcess.filter(item => item.id).forEach(item => {
      const itemRef = doc(db, 'depoStok', item.id!);
      batch.update(itemRef, {
        isShipped: false,
        depotId: selectedDepotId,
        depotName: depotName,
        hedefKurum: null,
        hedefKurumId: null,
        sevkTarihi: null,
        rafAdresi: 'IADE' 
      });
    });

    try {
      await batch.commit();
      toast({ title: 'İade Başarılı', description: `${itemsToProcess.length} ürün depoya geri alındı.` });
      setReturnItems([]);
    } catch (e) {
      console.error("Return process failed:", e);
      toast({ title: 'Hata', description: 'İade işlemi sırasında bir hata oluştu.', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
        <div className="flex justify-between items-center">
            <BackButton fallback="/siparisler" />
            <Button variant="outline" onClick={() => router.push('/urun-iade/gecmis')}>
                <History className="mr-2 h-4 w-4" /> İade Geçmişi
            </Button>
        </div>
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Undo className="h-6 w-6 text-primary" />
                    Ürün İade Paneli
                </CardTitle>
                <CardDescription>
                    Laboratuvardan depoya ürün iadesi yapın. Barkod okuyucu aktiftir.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1 max-w-sm">
                        <Label className="block text-sm font-medium mb-1">İade Edilecek Depo</Label>
                        <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={isLoading}>
                            <SelectTrigger><SelectValue placeholder="Depo seçin..." /></SelectTrigger>
                            <SelectContent>
                                {depots.map(d => <SelectItem key={d.id!} value={d.id!}>{d.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                     <div className="flex-1 max-w-sm">
                        <Label className="block text-sm font-medium mb-1">Kaynak Laboratuvar</Label>
                        <Select value={selectedLabId} onValueChange={setSelectedLabId} disabled={isLoading}>
                            <SelectTrigger><SelectValue placeholder="Laboratuvar seçin..." /></SelectTrigger>
                            <SelectContent>
                                {hospitals.map(l => <SelectItem key={l.id!} value={l.id!}>{l.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardContent>
        </Card>
        
        <Card className="flex-1 flex flex-col">
            <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle className="text-lg">İade Edilecek Ürünler ({returnItems.reduce((acc, item) => acc + (item.adet || 0), 0)})</CardTitle>
                    {returnItems.length > 0 && (
                        <Button variant="outline" size="sm" onClick={() => setReturnItems([])}>
                            <Trash2 className="mr-2 h-4 w-4" /> Listeyi Temizle
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="flex-1 p-0">
                <ScrollArea className="h-[45vh] border rounded-md">
                     {isLoading ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin"/></div>
                     ) : returnItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4 text-center">
                           <Info className="h-10 w-10 mb-2 opacity-50" />
                           <p>İade edilecek ürünleri okutmaya başlayın.</p>
                        </div>
                     ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Ürün Adı</TableHead>
                                    <TableHead>Seri/Lot No</TableHead>
                                    <TableHead>İade Alınan Yer</TableHead>
                                    <TableHead className="text-right">Adet</TableHead>
                                    <TableHead className="text-right w-[50px]">Sil</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {returnItems.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell>{item.stokAdi}</TableCell>
                                        <TableCell className="font-mono text-xs">{item.isGroup ? item.lotNumarasi : item.seriNumarasi}</TableCell>
                                        <TableCell className="text-muted-foreground">{item.hedefKurum}</TableCell>
                                        <TableCell className="text-right font-bold">{item.adet}</TableCell>
                                        <TableCell className="text-right">
                                            <Button size="icon" variant="ghost" onClick={() => removeItem(item.id || '', item.isGroup ?? false, item.key as string | undefined)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                     )}
                </ScrollArea>
            </CardContent>
            <CardFooter className="mt-4">
                <Button onClick={processReturn} disabled={processing || returnItems.length === 0} className="w-full">
                    {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                    Seçili Ürünleri İade Al
                </Button>
            </CardFooter>
        </Card>
    </div>
  );
}
