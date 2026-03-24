
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ScannedItem,
  ProductCode,
  Depot,
} from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Barcode, Trash2, CheckSquare, Loader2, Search, AlertTriangle } from 'lucide-react';
import { Switch } from "@/components/ui/switch";
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query } from 'firebase/firestore';
import { cn, generateId, playFeedback } from '@/lib/utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import useHidScanner from '@/hooks/useHidScanner';
import { parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode } from '@/lib/barcode';
import type { ParsedGeneric, BarcodeFormat } from '@/lib/barcode';
import BackButton from '@/components/BackButton';
import { useAuth } from '@/contexts/auth-context';
import { companyQuery } from '@/lib/company-filter';

type ScanRow = ScannedItem & {
  adet?: number;
  isGroup?: boolean;
};

export default function IstisnaUrunlerPanel() {
  const { toast } = useToast();
  const { currentCompanyId } = useAuth();

  const [barcodeFormats, setBarcodeFormats] = useState<BarcodeFormat[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [depots, setDepots] = useState<Depot[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingScan, setIsProcessingScan] = useState(false);

  const [scannedItems, setScannedItems] = useState<ScanRow[]>([]);
  const [lastScannedProduct, setLastScannedProduct] = useState<ScannedItem | null>(null);
  const [malKabulIsLoading, setMalKabulIsLoading] = useState(false);

  const depotName = depots.find(d => d.id === selectedDepotId)?.name || '';

  const fetchPrerequisites = useCallback(async () => {
    setIsLoading(true);
    try {
      const [depotsSnap, productsSnap, formatsSnap] = await Promise.all([
        getDocs(companyQuery(db, 'depots', currentCompanyId)),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'barcodeFormats')),
      ]);
      const depotList = depotsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Depot));
      setDepots(depotList);
      setProductCodes(productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductCode)));
      setBarcodeFormats(formatsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BarcodeFormat)));

      if (depotList.length > 0 && !selectedDepotId) {
        setSelectedDepotId(depotList[0].id);
      }

    } catch (e) {
      console.error("Error fetching data:", e);
      toast({ title: 'Veri Hatası', description: 'Gerekli veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [selectedDepotId, toast, currentCompanyId]);

  useEffect(() => {
    fetchPrerequisites();
  }, [fetchPrerequisites]);
  

  const processScan = useCallback(async (barcodeData: string) => {
    if (!selectedDepotId) {
        toast({ title: 'Hata', description: 'Lütfen işlem yapılacak depoyu seçin.', variant: 'destructive' });
        return;
    }
    setIsProcessingScan(true);

    try {
        const resolveResult = parseAndResolveBarcode(barcodeData, barcodeFormats, productCodes);

        if (!resolveResult || !resolveResult.parsed) {
          throw new Error('Barkod tanımlı formatlarla eşleşmiyor.');
        }

        if (!resolveResult.product) {
          throw new Error(`Barkod numarası/referans herhangi bir ürünle eşleşmedi.`);
        }

        const { lotNumarasi, miadFormatted, seriNumarasi } = resolveResult.parsed;
        const matchedProduct = resolveResult.product;
        
        const newItem: ScanRow = {
          id: generateId(), 
          barkod: barcodeData, 
          stokKodu: matchedProduct.stokKodu, 
          stokAdi: matchedProduct.stokAdi,
          lotNumarasi: lotNumarasi || '', 
          miad: miadFormatted || '', 
          seriNumarasi: seriNumarasi || '',
          rafAdresi: 'İSTİSNA GİRİŞİ', 
          irsaliyeNumarasi: 'İSTİSNA GİRİŞİ', 
          isSelected: false, 
          timestamp: new Date(), 
          isProcessed: false,
          adet: 1, 
          isGroup: false
        };
        
        setScannedItems(prev => [newItem, ...prev]);
        playFeedback();
        setLastScannedProduct(newItem);
        toast({ title: `Okuma Başarılı`, description: `${newItem.stokAdi} listeye eklendi.` });

    } catch(err: any) {
        toast({ title: 'Ayrıştırma Hatası', description: err.message || 'Barkod işlenemedi.', variant: 'destructive' });
    } finally {
        setIsProcessingScan(false);
    }
  }, [toast, productCodes, barcodeFormats, selectedDepotId]);
  
  useHidScanner({
    enabled: !malKabulIsLoading && !isProcessingScan,
    onScan: ({ raw }) => {
      if (raw) processScan(raw);
    },
  });

  const deleteScannedItem = (id: string) => {
    setScannedItems(prev => prev.filter(item => item.id !== id));
    toast({ title: 'Silindi', description: 'Ürün kaldırıldı.' });
  };
  
  const performGoodsReceipt = async () => {
    if (scannedItems.length === 0) {
      toast({ title: 'Liste Boş', description: 'Stoğa eklenecek ürün bulunmuyor.', variant: 'default' });
      return;
    }

    setMalKabulIsLoading(true);
    const batch = writeBatch(db);
    let totalItemsWritten = 0;

    try {
      scannedItems.forEach(item => {
          totalItemsWritten++;
          const newDocRef = doc(collection(db, 'depoStok'));
          const newDepoStokItem: Omit<DepoStokItem, 'id'> = {
            depotId: selectedDepotId,
            depotName: depotName,
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            lotNumarasi: item.lotNumarasi || '',
            miad: item.miad,
            seriNumarasi: item.seriNumarasi,
            rafAdresi: item.rafAdresi,
            irsaliyeNumarasi: item.irsaliyeNumarasi,
            eklenmeTarihi: item.timestamp,
            isShipped: false,
          };
          batch.set(newDocRef, newDepoStokItem);
      });

      await batch.commit();
      
      setScannedItems([]);
      setLastScannedProduct(null);
      
      toast({ title: 'Başarılı', description: `${totalItemsWritten} istisna ürün başarıyla ${depotName} deposuna eklendi.` });
    } catch (error) {
      console.error("İstisna mal kabul hatası:", error);
      toast({ title: "Veritabanı Hatası", description: "Ürünler stoğa eklenirken bir hata oluştu.", variant: "destructive" });
    } finally {
      setMalKabulIsLoading(false);
    }
  };


  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Veri Yükleniyor...</p></div>;
  }
  
  return (
    <div className="flex flex-col h-full space-y-4 p-4">
      <BackButton fallback="/yonetim" />
      <Card className="flex-shrink-0">
        <CardHeader className="flex flex-row items-center space-x-4">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <div>
            <CardTitle>İstisna Ürün Girişi</CardTitle>
            <CardDescription>
              Bu panel, sistemde daha önce kaydı bulunan seri numaralı ürünlerin stoğa yeniden eklenmesini sağlar. Lütfen dikkatli kullanın.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
             <div className="flex-1">
                <Label className="block text-sm font-medium mb-1">Hedef Depo</Label>
                <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
                <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder="Hedef Depo seçin" />
                </SelectTrigger>
                <SelectContent>
                    {depots.map(dep => (
                    <SelectItem key={dep.id} value={dep.id}>{dep.name}</SelectItem>
                    ))}
                </SelectContent>
                </Select>
            </div>
            <div className="flex-1">
                <Label className="block text-sm font-medium mb-1">Barkod Okut</Label>
                <div className="relative">
                    <Barcode className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Barkod okutun veya manuel girin..."
                        onKeyDown={(e) => { if (e.key === 'Enter') { processScan(e.currentTarget.value); e.currentTarget.value = ''; } }}
                        className="pl-8"
                        disabled={!selectedDepotId || isProcessingScan}
                    />
                </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="flex-1 flex flex-col">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg font-headline">İstisna Listesi ({scannedItems.length} ürün)</CardTitle>
            <Button onClick={() => setScannedItems([])} variant="destructive" size="sm" disabled={scannedItems.length === 0}><Trash2 className="mr-2 h-4 w-4"/>Listeyi Temizle</Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[40vh]">
            {scannedItems.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground p-4">
                <Search className="mr-2 h-6 w-6" /> Okutulmuş ürün bulunmuyor.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Stok Adı</TableHead>
                      <TableHead>Seri No</TableHead>
                      <TableHead>Lot</TableHead>
                      <TableHead>Miad</TableHead>
                      <TableHead className="w-[50px]">Sil</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scannedItems.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs">
                          {item.stokAdi}
                          <br />
                          <span className="text-muted-foreground font-mono">{item.stokKodu}</span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.seriNumarasi}</TableCell>
                        <TableCell>{item.lotNumarasi}</TableCell>
                        <TableCell>{item.miad}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteScannedItem(item.id)}
                            disabled={malKabulIsLoading}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </ScrollArea>
        </CardContent>
         <CardFooter>
            <Button onClick={performGoodsReceipt} className="w-full bg-amber-600 hover:bg-amber-700" disabled={malKabulIsLoading || isLoading || scannedItems.length === 0}>
                {malKabulIsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Seçili Ürünleri Stoğa Ekle
            </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

