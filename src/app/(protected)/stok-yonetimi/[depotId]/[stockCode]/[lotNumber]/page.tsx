
'use client';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ListChecks, Check, X, Save, XCircle, Search, ListFilter, Pencil } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, addDoc } from 'firebase/firestore';
import type { DepoStokItem, ConsumptionRecord } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';
import { formatMiad } from "@/lib/date";
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { cn, playFeedback } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { parseBarcode as parseRocheBarcode } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

interface StockGroup {
  id: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  rafAdresi: string;
  expectedQty: number;
  serials: string[];
  items: DepoStokItem[];
}


// Helper: normalize any serial for strict comparison
const normalizeSerial = (s: string | null | undefined): string =>
  (s ?? '').trim().toUpperCase();

// Fallback parser: accept raw serial string when full Roche barcode isn't provided
function parseSerialFlexible(raw: string): { seriNumarasi: string } | null {
  // Try Roche first
  const parsed = parseRocheBarcode(raw);
  if (parsed && parsed.seriNumarasi) {
    return { seriNumarasi: normalizeSerial(parsed.seriNumarasi) };
  }
  // Fallback: raw scanner sent only the serial (commonly 10–20 alnum)
  const candidate = normalizeSerial(raw);
  if (/^[A-Z0-9]{10,20}$/.test(candidate)) {
    return { seriNumarasi: candidate };
  }
  return null;
}

export default function StockDetailPage() {
  const params = useParams();
  const router = useRouter();
  const depotId = Array.isArray(params?.depotId) ? params.depotId[0] : params?.depotId;
  const stockCode = Array.isArray(params?.stockCode) ? params.stockCode[0] : params?.stockCode;
  const lotNumber = Array.isArray(params?.lotNumber) ? params.lotNumber[0] : params?.lotNumber;
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();

  const [items, setItems] = useState<DepoStokItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [isCounting, setIsCounting] = useState(false);
  const [scannedSerials, setScannedSerials] = useState<Record<string, Set<string>>>({});
  const [showOnlyUnverified, setShowOnlyUnverified] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editingQuantity, setEditingQuantity] = useState<number | string>('');

  const fetchItems = useCallback(async () => {
    if (!depotId || !stockCode || !lotNumber) {
        setLoading(false);
        return;
    }
    setLoading(true);
    try {
      const q = query(
        collection(db, 'depoStok'),
        where('depotId', '==', depotId),
        where('stokKodu', '==', decodeURIComponent(stockCode as string)),
        where('lotNumarasi', '==', decodeURIComponent(lotNumber as string)),
        where('isShipped', '==', false)
      );
      const snap = await getDocs(q);
      const fetchedItems = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DepoStokItem));
      setItems(fetchedItems);
    } catch (err) {
      console.error("Error fetching stock details:", err);
      toast({ title: 'Hata', description: 'Stok detayları yüklenemedi.', variant: 'destructive'});
    } finally {
      setLoading(false);
    }
  }, [depotId, stockCode, lotNumber, toast]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);
  
  const stockList: StockGroup[] = useMemo(() => {
    const groups: Record<string, StockGroup> = {};
    items.forEach(item => {
      const key = `${item.stokKodu}-${item.lotNumarasi}-${formatMiad(item.miad)}`;
      if (!groups[key]) {
        groups[key] = {
          id: key,
          stokKodu: item.stokKodu || '',
          stokAdi: item.stokAdi || '',
          lotNumarasi: item.lotNumarasi || '',
          miad: formatMiad(item.miad),
          rafAdresi: item.rafAdresi || '',
          expectedQty: 0,
          serials: [],
          items: []
        };
      }
      groups[key].expectedQty++;
      groups[key].items.push(item);
      if (item.seriNumarasi) groups[key].serials.push(normalizeSerial(item.seriNumarasi));
    });
    return Object.values(groups);
  }, [items]);

  const handleBarcodeScan = useCallback((barcode: string) => {
    if (!isCounting) return;
    
    const parsed = parseSerialFlexible(barcode);
    if (!parsed) {
        playFeedback(true);
        toast({ title: 'Hata', description: 'Geçersiz barkod/seri formatı.', variant: 'destructive' });
        return;
    }
    const serial = parsed.seriNumarasi; 

    let itemFoundInAnyLot = false;

    for (const group of stockList) {
        if (group.serials.some(s => normalizeSerial(s) === serial)) {
            itemFoundInAnyLot = true;
            setScannedSerials(prev => {
                const lotId = group.id;
                const setForLot = new Set(prev[lotId] || []);
                if (!setForLot.has(serial)) {
                    setForLot.add(serial);
                    playFeedback();
                    toast({ title: 'Okundu', description: `${serial} doğrulandı.` });
                    return { ...prev, [lotId]: setForLot };
                } else {
                    playFeedback(true);
                    toast({ title: 'Uyarı', description: 'Bu seri zaten doğrulandı.' });
                    return prev;
                }
            });
            break; 
        }
    }

    if (!itemFoundInAnyLot) {
        playFeedback(true);
        toast({ title: 'Bulunamadı', description: 'Okutulan seri no bu lot listesinde yok.', variant: 'destructive' });
    }
  }, [isCounting, stockList, toast]);

  const scanBuffer = useRef('');
  const scanTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isCounting) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      if (e.key === 'Enter') {
        const len = scanBuffer.current.length;
        const isRoche = len === 61;
        const isRawSerial = len >= 10 && len <= 20;
        if (isRoche || isRawSerial) {
          handleBarcodeScan(scanBuffer.current);
        }
        scanBuffer.current = '';
        if (scanTimeout.current) clearTimeout(scanTimeout.current);
        return;
      }

      if (e.key.length > 1) return;
      scanBuffer.current += e.key;
      if (scanTimeout.current) clearTimeout(scanTimeout.current);
      scanTimeout.current = setTimeout(() => { scanBuffer.current = ''; }, 250);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCounting, handleBarcodeScan]);
  
  const startCounting = () => {
    setIsCounting(true);
    setScannedSerials({});
    setShowOnlyUnverified(false);
    toast({ title: 'Sayım Başladı', description: 'Lütfen ürün seri numaralarını okutun.' });
  };
  
  const cancelCounting = () => {
      setIsCounting(false);
      setScannedSerials({});
      setShowOnlyUnverified(false);
  };
  
  const handleStartEditing = (group: (typeof sortedAndGroupedStock)[0]) => {
    setEditingRowKey(group.id);
    setEditingQuantity(group.items.length);
  };
  
  const handleCancelEditing = () => {
    setEditingRowKey(null);
    setEditingQuantity('');
  };

  const depotName = useMemo(() => items.length > 0 ? items[0].depotName || depotId : depotId, [items, depotId]);

  const handleQuantityChange = async (group: (typeof sortedAndGroupedStock)[0]) => {
    const newQuantity = typeof editingQuantity === 'string' ? parseInt(editingQuantity, 10) : editingQuantity;
    if (newQuantity < 0 || !Number.isInteger(newQuantity)) {
      toast({ title: "Hata", description: "Geçersiz adet.", variant: "destructive" });
      return;
    }
    const currentQuantity = group.items.length;
    const diff = newQuantity - currentQuantity;
    if (diff === 0) {
      handleCancelEditing();
      return;
    }
    setLoading(true);
    const batch = writeBatch(db);
    try {
      if (diff > 0) { // Add items
        const newItemTemplate: Omit<DepoStokItem, 'id'> = {
          depotId: depotId,
          depotName: depotName,
          stokKodu: group.stokKodu,
          stokAdi: group.stokAdi,
          lotNumarasi: group.lotNumarasi,
          miad: group.miad,
          rafAdresi: group.rafAdresi,
          seriNumarasi: '',
          eklenmeTarihi: new Date(),
          isShipped: false,
        };
        for (let i = 0; i < diff; i++) {
          const newDocRef = doc(collection(db, 'depoStok'));
          batch.set(newDocRef, { ...newItemTemplate, seriNumarasi: `MANUEL-${nanoid(6)}` });
        }
      } else { // Remove items
        const itemsToRemove = group.items.slice(0, Math.abs(diff));
        itemsToRemove.filter(item => item.id).forEach(item => {
          batch.delete(doc(db, 'depoStok', item.id!));
        });
      }
      await batch.commit();

      // This function call was removed as the function does not exist.
      // await saveManualChangeSnapshot(...)
      
      toast({ title: 'Başarılı', description: `${group.stokAdi} adedi güncellendi.` });
      await fetchItems(); // Refetch to get the latest state
    } catch (error) {
      toast({ title: "Hata", description: "Adet güncellenirken hata oluştu.", variant: "destructive" });
      console.error(error);
    } finally {
      setLoading(false);
      handleCancelEditing();
    }
  };


  const saveCount = async () => {
    if (!currentUserProfile) return;

    const allSerialsInList = new Set(stockList.flatMap(g => g.serials));
    const allScannedSerials = new Set(Object.values(scannedSerials).flatMap(s => Array.from(s)));

    const unscannedSerials = Array.from(allSerialsInList).filter(s => !allScannedSerials.has(s));
    
    if (unscannedSerials.length === 0) {
      toast({ title: 'İşlem Yok', description: 'Stoktan düşülecek ürün bulunmuyor. Tüm ürünler okutuldu.' });
      setIsCounting(false);
      return;
    }

    if (!confirm(`${unscannedSerials.length} adet ürün stoktan düşülecek. Devam etmek istiyor musunuz?`)) return;

    setIsSaving(true);
    const batch = writeBatch(db);
    
    const itemsToDeduct = items.filter(item => unscannedSerials.includes(normalizeSerial(item.seriNumarasi)));

    itemsToDeduct.filter(item => item.id).forEach(item => {
        const consumptionRecord: Omit<ConsumptionRecord, 'id'> = {
            stokKodu: item.stokKodu || '',
            stokAdi: item.stokAdi || '',
            lotNumarasi: item.lotNumarasi ?? '',
            miad: formatMiad(item.miad),
            seriNumarasi: item.seriNumarasi ?? '',
            consumptionTimestamp: new Date(),
            consumptionType: 'sayimdan_dusum',
            userId: currentUserProfile?.uid || '',
            userName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
            laboratoryName: depotName,
            laboratoryId: depotId,
        };
        batch.delete(doc(db, 'depoStok', item.id!));
        batch.set(doc(collection(db, 'tuketimKayitlari')), consumptionRecord);
    });

    try {
        await batch.commit();
        
        toast({ title: 'Başarılı', description: `${unscannedSerials.length} adet ürün stoktan düşüldü ve tüketim olarak kaydedildi.` });
        await fetchItems();
        setIsCounting(false);
    } catch(err) {
        console.error("Error saving count:", err);
        toast({ title: 'Hata', description: 'Sayım kaydedilirken bir hata oluştu.', variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
  };

  const filteredGroups = useMemo(() => {
    let list = stockList;
    if (isCounting && showOnlyUnverified) {
      list = list.filter(group => {
        const scannedCount = (scannedSerials[group.id] || new Set()).size;
        return scannedCount < group.expectedQty;
      });
    }
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      list = list.filter(group => 
        group.stokAdi.toLowerCase().includes(lowerSearch) ||
        group.lotNumarasi.toLowerCase().includes(lowerSearch) ||
        group.serials.some(s => s.toLowerCase().includes(lowerSearch))
      );
    }
    return list;
  }, [stockList, isCounting, showOnlyUnverified, searchTerm, scannedSerials]);
  
  const { totalItems, verifiedItems, progress } = useMemo(() => {
    const total = stockList.reduce((sum, g) => sum + g.expectedQty, 0);
    const verified = Object.values(scannedSerials).reduce((sum, set) => sum + set.size, 0);
    const progressPercentage = total > 0 ? (verified / total) * 100 : 0;
    return {
      totalItems: total,
      verifiedItems: verified,
      progress: progressPercentage
    };
  }, [stockList, scannedSerials]);

  const sortedAndGroupedStock = stockList; // This variable seems to be what you intended to use for editing

  const firstItem = items[0];

  if (loading && items.length === 0) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary"/></div>;
  }
  
  if (!depotId || !stockCode || !lotNumber) {
    return (
        <div className="flex h-full items-center justify-center text-destructive">
            Gerekli rota parametreleri eksik. Lütfen geri dönün.
        </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/stok-yonetimi" />
      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-start">
            <div>
                <CardTitle className="truncate max-w-full">{firstItem?.stokAdi || 'Yükleniyor...'}</CardTitle>
                <CardDescription>
                    Stok Kodu: {decodeURIComponent(stockCode as string)} | Lot Numarası: {decodeURIComponent(lotNumber as string)}
                </CardDescription>
            </div>
            <div className="flex items-center gap-2 mt-2 sm:mt-0">
              {!isCounting ? (
                  <Button onClick={startCounting} disabled={loading || items.length === 0}>
                      <ListChecks className="mr-2 h-4 w-4" /> Lot Sayımı Başlat
                  </Button>
              ) : (
                  <div className="flex gap-2">
                      <Button onClick={saveCount} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4" />}
                        Sayımı Tamamla ve Kaydet
                      </Button>
                      <Button onClick={cancelCounting} variant="outline" disabled={isSaving}>İptal</Button>
                  </div>
              )}
            </div>
        </CardHeader>

        {isCounting && (
          <CardContent className="border-t pt-4">
            <div className="flex justify-between items-center mb-2">
              <div className="relative">
                 <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                 <Input
                    placeholder="Seri no ara..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                 />
              </div>
              <Button onClick={() => setShowOnlyUnverified(v => !v)} variant="outline">
                <ListFilter className="mr-2 h-4 w-4"/>
                {showOnlyUnverified ? 'Tümünü Göster' : 'Doğrulanmayanları Göster'}
              </Button>
            </div>
            <div className="pt-2 space-y-2">
              <Progress value={progress} className="h-3" indicatorClassName={progress === 100 ? 'bg-green-500' : 'bg-primary'} />
              <div className="flex justify-between text-sm font-medium">
                  <span className="text-muted-foreground">Toplam Ürün: {totalItems}</span>
                  <span className="text-primary">Doğrulanan: {verifiedItems}</span>
              </div>
            </div>
          </CardContent>
        )}

        <CardContent>
          {items.length === 0 && !loading ? (
            <p className="text-center text-muted-foreground py-8">Bu lot için stok bulunamadı.</p>
          ) : !isCounting ? (
             <ScrollArea className="h-[70vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seri Numarası</TableHead>
                    <TableHead>Raf Adresi</TableHead>
                    <TableHead>Miad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.seriNumarasi}</TableCell>
                      <TableCell>{item.rafAdresi}</TableCell>
                      <TableCell>{formatMiad(item.miad)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
             <Accordion type="multiple" defaultValue={filteredGroups.map(g => g.id)} className="w-full">
              {filteredGroups.map(group => {
                const scannedInGroup = scannedSerials[group.id] || new Set();
                const isComplete = scannedInGroup.size === group.expectedQty;
                return (
                  <AccordionItem key={group.id} value={group.id}>
                    <AccordionTrigger>
                      <div className="flex w-full justify-between items-center pr-4">
                        <span>{group.stokAdi} - Lot: {group.lotNumarasi} - Miad: {group.miad}</span>
                        <Badge variant={isComplete ? "default" : "secondary"}>
                          {scannedInGroup.size} / {group.expectedQty}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ScrollArea className="h-64">
                        <ul className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
                          {group.serials.map(s => {
                            const isScanned = scannedInGroup.has(s);
                            const matchesSearch = searchTerm && s.toLowerCase().includes(searchTerm.toLowerCase());
                            return (
                              <li key={s}
                                className={cn(
                                  'p-1 rounded flex items-center gap-2 text-xs font-mono',
                                  isScanned ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30',
                                  matchesSearch && 'ring-2 ring-primary'
                                )}
                              >
                                {isScanned ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-red-600" />}
                                <span>{s || '(no-serial)'}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </ScrollArea>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
             </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
