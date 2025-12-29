'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Loader2, Trash2, History, ListChecks, Check, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, query, writeBatch, doc, addDoc, serverTimestamp, setDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Depot, ProductCode, DepoStokItem, ConsumptionRecord, DepotStockCountSession } from '@/lib/types';
import BackButton from '@/components/BackButton';
import useHidScanner from '@/hooks/useHidScanner';
import { playFeedback, generateId } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { parseAnyBarcode, resolveProductFromParsed } from '@/lib/barcode';
import { TrackingMode, resolveDefaultTrackingMode } from '@/lib/tracking';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';

type CountGroup = {
  id: string; // stokKodu-lot-miad
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  trackingMode: TrackingMode;
  expectedSerials: string[];
  expectedAdet: number;
  scannedSerials: Set<string>;
  scannedAdet: number;
  items: DepoStokItem[]; // Added to access original items
};

export default function DepoSayimPage() {
    const { toast } = useToast();
    const router = useRouter();
    const { currentUserProfile } = useAuth();
    const { parseAuto } = useBarcodeParser();
    
    const [isLoading, setIsLoading] = useState(true);
    const [depots, setDepots] = useState<Depot[]>([]);
    const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
    const [fullDepotStok, setFullDepotStok] = useState<DepoStokItem[]>([]);
    
    const [selectedDepotId, setSelectedDepotId] = useState('');
    const [brandForCount, setBrandForCount] = useState('');
    const [brandCountItems, setBrandCountItems] = useState<CountGroup[]>([]);
    const [isCounting, setIsCounting] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    
    const availableBrands = useMemo(() => {
        const brands = new Set(productCodes.map(p => p.marka).filter(Boolean) as string[]);
        return Array.from(brands).sort();
    }, [productCodes]);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [depotsSnap, productsSnap, stockSnap] = await Promise.all([
                getDocs(collection(db, 'depots')),
                getDocs(collection(db, 'productCodes')),
                getDocs(collection(db, 'depoStok')),
            ]);
            const depotList = depotsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Depot));
            setDepots(depotList);
            setProductCodes(productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductCode)));
            setFullDepotStok(stockSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DepoStokItem)));

            if(depotList.length > 0 && depotList[0].id && !selectedDepotId) {
                setSelectedDepotId(depotList[0].id);
            }
        } catch (e) {
            toast({ title: 'Veri Yükleme Hatası', description: 'Gerekli ana veriler yüklenemedi.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast, selectedDepotId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const startBrandCount = () => {
        if (!brandForCount || !selectedDepotId) {
          toast({ title: 'Eksik Seçim', description: 'Lütfen sayım yapılacak depo ve markayı seçin.', variant: 'destructive' });
          return;
        }
        const items = fullDepotStok.filter(item => {
          const product = productCodes.find(p => p.stokKodu === item.stokKodu);
          return product?.marka === brandForCount && !item.isShipped && item.depotId === selectedDepotId;
        });

        const grouped = items.reduce((acc, item) => {
          const key = `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;
          if (!acc[key]) {
            const product = productCodes.find(p => p.stokKodu === item.stokKodu);
            acc[key] = {
              id: key,
              stokKodu: item.stokKodu || '',
              stokAdi: item.stokAdi || '',
              lotNumarasi: item.lotNumarasi || '',
              miad: item.miad as string || '',
              trackingMode: product ? resolveDefaultTrackingMode(product as any) : 'serial',
              expectedSerials: [],
              expectedAdet: 0,
              scannedSerials: new Set(),
              scannedAdet: 0,
              items: []
            };
          }
          acc[key].expectedAdet++;
          acc[key].items.push(item);
          if (item.seriNumarasi) acc[key].expectedSerials.push(item.seriNumarasi);
          return acc;
        }, {} as Record<string, CountGroup>);
        
        setBrandCountItems(Object.values(grouped).sort((a, b) => a.stokAdi.localeCompare(b.stokAdi)));
        setIsCounting(true);
    };
    
    const handleScan = useCallback((barcode: string) => {
        const parsed = parseAuto(barcode, productCodes);
    
        if (!parsed || !parsed.product) {
            playFeedback(true);
            toast({ title: 'Bilinmeyen Barkod', description: 'Okutulan barkod herhangi bir ürünle eşleşmedi.' });
            return;
        }
    
        const groupIndex = brandCountItems.findIndex(g =>
            g.stokKodu === parsed.stokKodu &&
            (g.trackingMode.startsWith('qty_') || g.trackingMode.startsWith('lot_') || g.lotNumarasi === (parsed.lotNumarasi || ''))
        );
    
        if (groupIndex === -1) {
            playFeedback(true);
            toast({ title: 'Listede Yok', description: 'Okutulan ürün bu markanın sayım listesinde bulunmuyor.', variant: 'destructive' });
            return;
        }
    
        setBrandCountItems(prevItems => {
            const newItems = [...prevItems];
            const group = { ...newItems[groupIndex] };
    
            if (group.trackingMode === 'serial') {
                if (!parsed.seriNumarasi) {
                    playFeedback(true);
                    toast({ title: 'Seri No Eksik', description: 'Bu ürün seri numarası ile takip ediliyor, barkod seri no içermiyor.', variant: 'destructive' });
                    return prevItems;
                }
                const seriNo = parsed.seriNumarasi as string;
                if (group.scannedSerials.has(seriNo)) {
                    playFeedback(true);
                    toast({ title: 'Tekrar', description: 'Bu seri numarası zaten okutuldu.', variant: 'default' });
                    return prevItems;
                }
                group.scannedSerials = new Set(group.scannedSerials).add(seriNo);
                // For serial tracked, scannedAdet is the size of the set
                group.scannedAdet = group.scannedSerials.size;
            } else {
                 group.scannedAdet++; // For lot/qty tracking, just increment
            }
            
            newItems[groupIndex] = group;
            playFeedback();
            toast({ title: 'Doğrulandı', description: `${group.stokAdi} (${group.lotNumarasi}) - Adet: ${group.scannedAdet}` });
            return newItems;
        });
    
    }, [brandCountItems, productCodes, parseAuto, toast]);
    
    const handleManualVerifyGroup = useCallback((groupId: string) => {
        setBrandCountItems(prevItems => {
            const newItems = [...prevItems];
            const groupIndex = newItems.findIndex(g => g.id === groupId);
            if (groupIndex === -1) return prevItems;

            const group = { ...newItems[groupIndex] };
            group.scannedAdet = group.expectedAdet;
            if (group.trackingMode === 'serial') {
                group.scannedSerials = new Set(group.expectedSerials);
            }

            newItems[groupIndex] = group;
            toast({ title: 'Manuel Doğrulandı', description: `${group.stokAdi} (${group.lotNumarasi}) adedi eşitlendi.` });
            return newItems;
        });
    }, [toast]);

    useHidScanner({
        enabled: isCounting,
        onScan: ({ raw }) => handleScan(raw)
    });
    
    const finishBrandCount = async () => {
        if (!currentUserProfile) return;
        
        const changes: { group: CountGroup; diff: number }[] = [];
        brandCountItems.forEach(group => {
            const scanned = group.trackingMode === 'serial' ? group.scannedSerials.size : group.scannedAdet;
            const diff = scanned - group.expectedAdet;
            if (diff !== 0) changes.push({ group, diff });
        });
        
        const changeSummary = changes.map(c => 
            `${c.group.stokAdi} (${c.group.lotNumarasi}): ${c.diff > 0 ? `+${c.diff}` : c.diff}`
        ).join('\n');

        if (changes.length === 0) {
            toast({ title: 'Tamamlandı', description: 'Tüm ürünler doğrulandı, stokta değişiklik yok.' });
            setIsCounting(false);
            setBrandCountItems([]);
            return;
        }
    
        if (!confirm(`Aşağıdaki stok değişiklikleri uygulanacak:\n\n${changeSummary}\n\nOnaylıyor musunuz?`)) return;
    
        setIsLoading(true);
        const batch = writeBatch(db);
        const depotName = depots.find(d => d.id === selectedDepotId)?.name || '';
    
        for (const { group, diff } of changes) {
            if (diff < 0) { // Items are missing
                const itemsToDelete = group.trackingMode === 'serial'
                    ? group.items.filter(item => !group.scannedSerials.has(item.seriNumarasi!))
                    : group.items.slice(0, Math.abs(diff));
                
                itemsToDelete.forEach(item => {
                    batch.delete(doc(db, 'depoStok', item.id!));
                    const consumptionRecord: Omit<ConsumptionRecord, 'id'> = {
                        stokKodu: item.stokKodu, stokAdi: item.stokAdi, lotNumarasi: item.lotNumarasi ?? '',
                        miad: item.miad as string, seriNumarasi: item.seriNumarasi ?? '', consumptionTimestamp: new Date(),
                        consumptionType: 'sayimdan_dusum', userId: currentUserProfile.uid, userName: currentUserProfile.name || '',
                        laboratoryName: depotName, laboratoryId: selectedDepotId,
                    };
                    batch.set(doc(collection(db, 'tuketimKayitlari')), consumptionRecord);
                });
            } else { // Items are extra
                for (let i = 0; i < diff; i++) {
                    const newDocRef = doc(collection(db, 'depoStok'));
                    const newEntry: Omit<DepoStokItem, 'id'> = {
                        depotId: selectedDepotId, depotName, stokKodu: group.stokKodu, stokAdi: group.stokAdi,
                        lotNumarasi: group.lotNumarasi, miad: group.miad, eklenmeTarihi: new Date(), isShipped: false,
                        irsaliyeNumarasi: 'SAYIMDAN_FAZLA', createdByName: currentUserProfile.name, seriNumarasi: `FAZLA-${generateId(6)}`,
                    };
                    batch.set(newDocRef, newEntry);
                }
            }
        }
        
        try {
          await batch.commit();
          toast({ title: 'Başarılı', description: 'Stok farkları başarıyla kaydedildi.' });
          await fetchData();
        } catch(e) {
          toast({ title: 'Hata', description: 'Stok güncellenirken bir hata oluştu.', variant: 'destructive' });
        } finally {
          setIsLoading(false);
          setIsCounting(false);
          setBrandCountItems([]);
        }
    };
    
    const filteredBrandCountItems = useMemo(() => {
        if (!searchTerm) return brandCountItems;
        const lowerSearch = searchTerm.toLowerCase();
        return brandCountItems.filter(item => 
            item.stokAdi.toLowerCase().includes(lowerSearch) ||
            item.stokKodu.toLowerCase().includes(lowerSearch) ||
            item.lotNumarasi.toLowerCase().includes(lowerSearch)
        );
    }, [brandCountItems, searchTerm]);


    if (isLoading && depots.length === 0) {
        return (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-2">Yükleniyor...</span>
          </div>
        );
    }
    
    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex items-center justify-between">
                <BackButton fallback="/stok-yonetimi" />
                <Button variant="outline" onClick={() => router.push('/depo-sayim/gecmis')}>
                    <History className="mr-2 h-4 w-4" /> Sayım Geçmişi
                </Button>
            </div>
            
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ListChecks className="w-6 h-6 text-primary" />
                        Depo Sayımı
                    </CardTitle>
                    <CardDescription>
                        Belirli bir markaya ait ürünlerin depo sayımını yapmak için depo ve marka seçin.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <Label>Depo</Label>
                            <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={isCounting}>
                                <SelectTrigger><SelectValue placeholder="Depo Seçin..." /></SelectTrigger>
                                <SelectContent>{depots.map(d => <SelectItem key={d.id} value={d.id!}>{d.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Marka</Label>
                            <Select value={brandForCount} onValueChange={setBrandForCount} disabled={isCounting}>
                                <SelectTrigger><SelectValue placeholder="Marka Seçin..." /></SelectTrigger>
                                <SelectContent>{availableBrands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
                <CardFooter>
                    {isCounting ? (
                        <div className="flex gap-2">
                            <Button onClick={finishBrandCount} variant="destructive">Sayımı Bitir ve Farkları Kaydet</Button>
                            <Button onClick={() => { setIsCounting(false); setBrandCountItems([]); }} variant="ghost">Sayımdan Çık</Button>
                        </div>
                    ) : (
                        <Button onClick={startBrandCount} disabled={!selectedDepotId || !brandForCount}>Sayımı Başlat</Button>
                    )}
                </CardFooter>
            </Card>

            {isCounting && (
                 <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle>Marka Sayımı: {brandForCount}</CardTitle>
                    <CardDescription>Okutulan ürünler yeşil, kalanlar kırmızı ile gösterilir. Tümünü doğrulamak için satır yanındaki tik butonunu kullanın.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Ürün adı, kodu veya lot ile ara..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <ScrollArea className="h-[60vh]">
                      <Accordion type="multiple" defaultValue={filteredBrandCountItems.map(g => g.id)}>
                        {filteredBrandCountItems.map((group) => {
                          const scannedCount = group.trackingMode === 'serial' ? group.scannedSerials.size : group.scannedAdet;
                          const isComplete = scannedCount >= group.expectedAdet;
                          return (
                            <AccordionItem key={group.id} value={group.id} className={cn("border-b", isComplete && 'bg-green-500/10')}>
                              <AccordionTrigger>
                                <div className="flex-1 text-left">{group.stokAdi} ({group.stokKodu}) - Lot: {group.lotNumarasi}</div>
                                <div className="text-right font-bold pr-4">{scannedCount} / {group.expectedAdet}</div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleManualVerifyGroup(group.id);
                                    }}
                                    className="h-8 w-8 ml-2 hover:bg-green-500/20"
                                    title="Tümünü doğrula"
                                >
                                    <Check className="h-5 w-5 text-green-600" />
                                </Button>
                              </AccordionTrigger>
                              <AccordionContent>
                                {group.trackingMode === 'serial' ? (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
                                    {group.expectedSerials.map((serial: any) => (
                                        <div key={serial} className={cn("p-1 text-xs rounded font-mono", group.scannedSerials.has(serial) ? 'bg-green-200' : 'bg-red-200')}>
                                        {serial}
                                        </div>
                                    ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground p-2">Bu ürün adet ile takip ediliyor.</p>
                                )}
                              </AccordionContent>
                            </AccordionItem>
                          );
                        })}
                      </Accordion>
                    </ScrollArea>
                  </CardContent>
                </Card>
            )}
        </div>
    )
}
    

    
