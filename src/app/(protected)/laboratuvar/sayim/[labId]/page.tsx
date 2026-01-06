
// File: /app/(protected)/laboratuvar/sayim/[labId]/page.tsx
'use client';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection, doc, getDocs, where, query, Timestamp, writeBatch, getDoc,
} from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Check, X, Loader2, ListFilter } from 'lucide-react';
import { cn, playFeedback } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { useLabCountMissingStock } from '@/hooks/useLabCountMissingStock';
import type { ProductCode, DepoStokItem, ConsumptionRecord, LabPool, Laboratory } from '@/lib/types';
import type { BarcodeFormat } from '@/lib/barcode';
import { Progress } from '@/components/ui/progress';
import { TrackingMode, resolveDefaultTrackingMode } from '@/lib/tracking';
import { saveLabCountSession } from '@/lib/labCount';

interface StockGroup {
  id: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  expectedQty: number;
  serials: string[];
  trackingMode: TrackingMode; // Added tracking mode
  countedQty: number; // Added for non-serial items
}

export default function LaboratuvarSayimPage() {
  const params = useParams();
  const labId = Array.isArray(params?.labId) ? params.labId[0] : (params?.labId as string);
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();

  const [labName, setLabName] = useState<string>('');
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [barcodeFormats, setBarcodeFormats] = useState<BarcodeFormat[]>([]);
  const [rawStock, setRawStock] = useState<DepoStokItem[]>([]);
  const [rows, setRows] = useState<StockGroup[]>([]);
  const [scanned, setScanned] = useState<Record<string, Set<string>>>({});
  const [countedQuantities, setCountedQuantities] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showOnlyUnverified, setShowOnlyUnverified] = useState(false);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);


  const saveSession = async () => {
    if (!labId || !currentUserProfile) return;
    setIsLoading(true);

    try {
        // 0. First, commit any new items that were staged but not yet persisted (from unknown products)
        const newItemsCommitted = await commitNewItems();
        if (newItemsCommitted > 0) {
            console.log(`Committed ${newItemsCommitted} new items from counting`);
        }

        const batch = writeBatch(db);

        // 1. Build a set of all scanned serial numbers
        const scannedSerialsSet = new Set(Object.values(scanned).flatMap(s => Array.from(s)));

        // 2. Process each group to identify items to remove AND items to add
        const itemsToRemove: DepoStokItem[] = [];
        let itemsToAdd = 0;
        let itemsRemoved = 0;

        allItemsForCount.forEach(group => {
            const isSerialTracked = group.trackingMode === 'serial';

            if (isSerialTracked) {
                // For serial-tracked items: remove items with unscanned serials
                // CRITICAL FIX: Normalize null/undefined to empty string for comparison
                const groupItems = rawStock.filter(item =>
                    item.stokKodu === group.stokKodu &&
                    (item.lotNumarasi || '') === group.lotNumarasi &&
                    (item.miad || '') === group.miad
                );

                groupItems.forEach(item => {
                    if (item.seriNumarasi && !scannedSerialsSet.has(item.seriNumarasi)) {
                        itemsToRemove.push(item);
                    }
                });
            } else {
                // For lot/qty tracked items: calculate how many to remove or add based on count
                // CRITICAL FIX: Normalize null/undefined to empty string for comparison
                const groupItems = rawStock.filter(item =>
                    item.stokKodu === group.stokKodu &&
                    (item.lotNumarasi || '') === group.lotNumarasi &&
                    (item.miad || '') === group.miad
                );

                // Use the latest counted quantity from state
                const countedQty = countedQuantities[group.id] || 0;
                const expectedQty = group.expectedQty;
                const qtyDifference = expectedQty - countedQty;

                if (qtyDifference > 0) {
                    // Remove the excess items (items that weren't counted = consumed/missing)
                    const itemsToDelete = groupItems.slice(0, qtyDifference);
                    itemsToRemove.push(...itemsToDelete);
                } else if (qtyDifference < 0) {
                    // STOCK INCREASE: Add new items for the surplus count
                    const qtyToAdd = Math.abs(qtyDifference);
                    const templateItem = groupItems[0] || {
                        stokKodu: group.stokKodu,
                        stokAdi: group.stokAdi,
                        lotNumarasi: group.lotNumarasi,
                        miad: group.miad,
                    };

                    for (let i = 0; i < qtyToAdd; i++) {
                        const newStockRef = doc(collection(db, 'depoStok'));
                        batch.set(newStockRef, {
                            stokKodu: templateItem.stokKodu,
                            stokAdi: templateItem.stokAdi || group.stokAdi,
                            lotNumarasi: templateItem.lotNumarasi || group.lotNumarasi,
                            miad: templateItem.miad || group.miad,
                            seriNumarasi: '', // No serial for lot/qty tracked items
                            isShipped: true,
                            hedefKurumId: labId,
                            hedefKurum: labName,
                            eklenmeTarihi: new Date(),
                            ekleyenKullanici: currentUserProfile.name || currentUserProfile.email || 'System',
                            eklemeSebebi: 'sayim_fazlasi', // Added from inventory count surplus
                        });
                        itemsToAdd++;
                    }
                }
            }
        });

        // 3. Delete unverified items from stock and create consumption records
        itemsToRemove.forEach(item => {
            // Delete from depoStok
            if (!item.id) return; // Skip items without id
            const stockDocRef = doc(db, 'depoStok', item.id);
            batch.delete(stockDocRef);
            itemsRemoved++;

            // Create a consumption record for the discrepancy
            const consumptionRecord: Omit<ConsumptionRecord, 'id'> = {
                stokKodu: item.stokKodu,
                stokAdi: item.stokAdi,
                lotNumarasi: item.lotNumarasi || '',
                miad: item.miad as string || '',
                seriNumarasi: item.seriNumarasi || '',
                laboratoryId: labId,
                laboratoryName: labName,
                consumptionTimestamp: new Date(),
                consumptionType: 'sayimdan_dusum', // Type for count discrepancy
                userId: currentUserProfile.uid,
                userName: currentUserProfile.name || 'System',
            };
            const consumptionDocRef = doc(collection(db, 'tuketimKayitlari'));
            batch.set(consumptionDocRef, consumptionRecord);
        });

        // 4. Save the history record of the count session
        await saveLabCountSession({
            laboratoryId: labId,
            laboratoryName: labName,
            user: { id: currentUserProfile.uid || '', name: currentUserProfile.name || currentUserProfile.email || 'Bilinmeyen' },
            stockItemsForLab: rawStock.filter(item => item.id).map(item => ({
                id: item.id!,
                stokKodu: item.stokKodu || '',
                stokAdi: item.stokAdi || '',
                lotNumarasi: item.lotNumarasi || '',
                miad: (item.miad as string) || '',
                seriNumarasi: item.seriNumarasi || '',
                hedefKurum: item.hedefKurum,
                marka: (item.marka as string | undefined),
            })),
            scannedSerials: scannedSerialsSet,
        });

        // 5. Commit all database operations
        await batch.commit();

        // Build result message
        const messages: string[] = [];
        if (itemsRemoved > 0) messages.push(`${itemsRemoved} eksik ürün stoktan düşüldü`);
        if (itemsToAdd > 0) messages.push(`${itemsToAdd} fazla ürün stoğa eklendi`);
        const resultMsg = messages.length > 0 ? messages.join(', ') : 'Stok değişikliği yok';

        toast({ title: 'Başarılı', description: `Sayım kaydedildi. ${resultMsg}.` });
        router.push(`/laboratuvar/sayim/${labId}/history`);

    } catch(err) {
        console.error('Save session error:', err);
        toast({ title: 'Hata', description: 'Sayım kaydedilirken hata oluştu.', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  };


  useEffect(() => {
    getDocs(collection(db, 'productCodes')).then(snap => {
      setProductCodes(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
    });
    getDocs(collection(db, 'barcodeFormats')).then(snap => {
      setBarcodeFormats(snap.docs.map(d => ({ id: d.id, ...d.data() } as BarcodeFormat)));
    });
    getDocs(collection(db, 'labPools')).then(snap => {
      setLabPools(snap.docs.map(d => ({ id: d.id, ...d.data() } as LabPool)));
    });
    getDocs(collection(db, 'hospitals')).then(snap => {
      setLaboratories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Laboratory)));
    });
  }, []);

  useEffect(() => {
    if (!labId) return;
    setIsLoading(true);
    (async () => {
      try {
        const labRef = doc(db, 'hospitals', labId as string);
        const labSnap = await getDoc(labRef);
        if (!labSnap.exists()) {
          toast({ title: 'Hata', description: 'Laboratuvar bulunamadı.', variant: 'destructive' });
          return;
        }
        const { name } = labSnap.data() as any;
        setLabName(name);

        const stockRef = collection(db, 'depoStok');
        // CRITICAL FIX: Only load items that are shipped AND belong to this lab
        // Use hedefKurumId for accurate filtering, fallback to hedefKurum for legacy records
        const stockQuery = query(
          stockRef,
          where('isShipped', '==', true),
          where('hedefKurumId', '==', labId)
        );
        const snap = await getDocs(stockQuery);
        let docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));

        // Also fetch legacy records that might only have hedefKurum (name) set
        const legacyQuery = query(
          stockRef,
          where('isShipped', '==', true),
          where('hedefKurum', '==', name)
        );
        const legacySnap = await getDocs(legacyQuery);
        const legacyDocs = legacySnap.docs
          .map(d => ({ id: d.id, ...d.data() } as DepoStokItem))
          .filter(item => !item.hedefKurumId); // Only include items without hedefKurumId to avoid duplicates

        docs = [...docs, ...legacyDocs];
        setRawStock(docs);
      } catch (error) {
        console.error('Error loading lab stock:', error);
        toast({ title: 'Veri Hatası', description: 'Sayım verileri yüklenemedi.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [labId, toast]);

  const existingLabSerials = useMemo(() => new Set(rawStock.map(s => s.seriNumarasi || '').filter(Boolean)), [rawStock]);

  // Compute pool member IDs and names for inter-lab transfers
  const { poolMemberIds, poolMemberNames } = useMemo(() => {
    const pool = labPools.find(p => p.memberIds?.includes(labId));
    if (!pool) return { poolMemberIds: [], poolMemberNames: [] };

    const ids = pool.memberIds.filter(id => id !== labId); // Exclude current lab
    const names = ids.map(id => laboratories.find(l => l.id === id)?.name).filter((n): n is string => !!n);
    return { poolMemberIds: ids, poolMemberNames: names };
  }, [labPools, labId, laboratories]);

  const {
    onScanAndStageIfMissing,
    commitNewItems,
    groupRowClass,
    serialTextClass,
    newFromCount,
    isNewSerial,
    isPoolTransferSerial,
  } = useLabCountMissingStock({
    labId,
    labName,
    existingLabSerials,
    productCodes,
    barcodeFormats,
    toast,
    poolMemberIds,
    poolMemberNames,
  });

  const allItemsForCount = useMemo(() => {
    const raw = rawStock.map(s => ({
      stokKodu: s.stokKodu,
      stokAdi: s.stokAdi,
      lotNumarasi: s.lotNumarasi,
      miad: s.miad,
      seriNumarasi: s.seriNumarasi || '',
    }));

    // Build sets for checking existing items
    const rawSerials = new Set(raw.filter(r => r.seriNumarasi).map(r => r.seriNumarasi));
    const rawLotKeys = new Set(raw.filter(r => !r.seriNumarasi).map(r => `${r.stokKodu}-${r.lotNumarasi || ''}-${r.miad || ''}`));

    // Filter staged items that are not yet in raw stock
    const stagedButNotPersisted = newFromCount.filter(n => {
      // For serial-tracked items, check if serial exists in rawSerials
      if (n.seriNumarasi) {
        return !rawSerials.has(n.seriNumarasi);
      }
      // For lot-tracked items, check if stokKodu+lot+miad combination exists
      const lotKey = `${n.stokKodu}-${n.lotNumarasi || ''}-${n.miad || ''}`;
      return !rawLotKeys.has(lotKey);
    });

    const all = [...raw, ...stagedButNotPersisted];

    const grouped = all.reduce((acc: Record<string, StockGroup>, item: any) => {
      // CRITICAL FIX: Ensure consistent key format by handling undefined/null values
      const key = `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;
      if (!acc[key]) {
         const product = productCodes.find(p => p.stokKodu === item.stokKodu);
        acc[key] = {
          id: key,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          lotNumarasi: item.lotNumarasi || '',
          miad: item.miad || '',
          expectedQty: 0,
          serials: [],
          trackingMode: product ? resolveDefaultTrackingMode(product as any) : 'serial',
          countedQty: countedQuantities[key] || 0,
        };
      }
      acc[key].expectedQty++;
      if (item.seriNumarasi) {
        acc[key].serials.push(item.seriNumarasi);
      }
      return acc;
    }, {});
    return Object.values(grouped);
  }, [rawStock, newFromCount, productCodes, countedQuantities]);
  
  const displayedItems = useMemo(() => {
    if (!showOnlyUnverified) return allItemsForCount;
    return allItemsForCount.filter(group => {
      const isSerialTracked = group.trackingMode === 'serial';
      const count = isSerialTracked ? (scanned[group.id] || new Set()).size : group.countedQty;
      return count < group.expectedQty;
    });
  }, [allItemsForCount, showOnlyUnverified, scanned]);


  const buffer = useRef('');
  const timeout = useRef<NodeJS.Timeout>();

  const handleScan = useCallback(async (code: string) => {
    const res = await onScanAndStageIfMissing(code);
    const parsed = res?.parsed;
    if (!parsed?.stokKodu) {
        playFeedback(true);
        return;
    }
    
    if (res?.createdLabDoc) {
      setRawStock(prev => [...prev, res.createdLabDoc]);
    }
    
    const serial = parsed.seriNumarasi || '';
    let foundAndUpdated = false;

    for (const group of allItemsForCount) {
        const isSerialTracked = group.trackingMode === 'serial';
        // CRITICAL FIX: Match lot number for ALL tracking types, not just serial
        const matchesGroup = group.stokKodu === parsed.stokKodu &&
                           (group.lotNumarasi || '') === (parsed.lotNumarasi || '');

        if (matchesGroup) {
            if (isSerialTracked) {
                if (group.serials.includes(serial)) {
                    const alreadyScanned = (scanned[group.id] || new Set()).has(serial);
                    if (alreadyScanned) {
                        toast({ title: 'Tekrar', description: `Seri no ${serial} zaten okutuldu.` });
                        playFeedback(true);
                        return;
                    }
                    setScanned(prev => {
                        const setFor = new Set(prev[group.id] || []);
                        setFor.add(serial);
                        return { ...prev, [group.id]: setFor };
                    });
                    toast({ title: 'Doğrulandı', description: `${group.stokAdi} - ${serial}` });
                    playFeedback();
                    foundAndUpdated = true;
                    break;
                }
            } else { // Not serial tracked (lot/qty tracking)
                // CRITICAL FIX: Allow counting beyond expected quantity for stock increases
                // Get current count from state (use functional update pattern for accuracy)
                const currentCount = countedQuantities[group.id] || 0;

                setCountedQuantities(prev => ({
                    ...prev,
                    [group.id]: (prev[group.id] || 0) + 1
                }));

                const newCount = currentCount + 1;
                if (newCount <= group.expectedQty) {
                    toast({ title: 'Adet Artırıldı', description: `${group.stokAdi} (${group.lotNumarasi}): ${newCount}/${group.expectedQty}` });
                } else {
                    // Stock increase scenario - scanned more than expected
                    toast({ title: 'Stok Artışı', description: `${group.stokAdi} (${group.lotNumarasi}): ${newCount}/${group.expectedQty} - Fazla ürün tespit edildi` });
                }
                playFeedback();
                foundAndUpdated = true;
                break;
            }
        }
    }
    
    // CRITICAL FIX: Handle newly transferred items (both serial and lot/qty tracked)
    if (!foundAndUpdated && res?.stagedNew) {
        const groupKey = `${parsed.stokKodu}-${parsed.lotNumarasi || ''}-${parsed.miadFormatted || ''}`;

        if (serial) {
            // Serial tracked - add to scanned serials
            setScanned(prev => {
                const setFor = new Set(prev[groupKey] || []);
                setFor.add(serial);
                return { ...prev, [groupKey]: setFor };
            });
            toast({ title: 'Yeni Ürün Doğrulandı', description: `${parsed.stokKodu} - ${serial}` });
        } else {
            // Lot/qty tracked - increment count
            setCountedQuantities(prev => ({
                ...prev,
                [groupKey]: (prev[groupKey] || 0) + 1
            }));
            toast({ title: 'Yeni Ürün Sayıldı', description: `${parsed.stokKodu} ${parsed.lotNumarasi ? `(Lot: ${parsed.lotNumarasi})` : ''}` });
        }
        playFeedback();
        foundAndUpdated = true;
    }

    if (!foundAndUpdated) {
        toast({ title: 'Bulunamadı', description: `Okutulan ürün listede bulunamadı veya eşleşmedi.` });
        playFeedback(true);
    }
  }, [allItemsForCount, onScanAndStageIfMissing, scanned, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleScan(buffer.current);
        buffer.current = '';
        if (timeout.current) clearTimeout(timeout.current);
      } else if (e.key.length === 1 && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        buffer.current += e.key;
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = setTimeout(() => { buffer.current = ''; }, 100);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [handleScan]);
  
  const { totalItems, verifiedItems, progress } = useMemo(() => {
    let total = 0;
    let verified = 0;
    allItemsForCount.forEach(group => {
      total += group.expectedQty;
      const isSerialTracked = group.trackingMode === 'serial';
      verified += isSerialTracked ? (scanned[group.id] || new Set()).size : group.countedQty;
    });
    const progressPercentage = total > 0 ? (verified / total) * 100 : 0;
    return {
      totalItems: total,
      verifiedItems: verified,
      progress: progressPercentage
    };
  }, [allItemsForCount, scanned]);

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/laboratuvar-yonetimi" />
      <Card>
        <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>Sayım Oturumu: {labName}</CardTitle>
                <CardDescription>
                  Okutulan yeşil, okutulmayan kırmızı. Depodan eklenenler mavi, havuzdan eklenenler mor renkte gösterilir.
                </CardDescription>
              </div>
              <Button onClick={() => setShowOnlyUnverified(v => !v)} variant="outline">
                <ListFilter className="mr-2 h-4 w-4"/>
                {showOnlyUnverified ? 'Tümünü Göster' : 'Doğrulanmayanları Göster'}
              </Button>
            </div>
            <div className="pt-4 space-y-2">
                <Progress value={progress} className="h-3" indicatorClassName={progress === 100 ? 'bg-green-500' : 'bg-primary'} />
                <div className="flex justify-between text-sm font-medium">
                    <span className="text-muted-foreground">Toplam Ürün: {totalItems}</span>
                    <span className="text-primary">Doğrulanan: {verifiedItems}</span>
                </div>
            </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
            <ScrollArea className="h-[60vh] border rounded p-2">
              <Accordion type="multiple" defaultValue={displayedItems.map(i => i.id)}>
                {displayedItems.map(group => {
                  const isSerialTracked = group.trackingMode === 'serial';
                  const count = isSerialTracked ? (scanned[group.id] || new Set()).size : group.countedQty;
                  const complete = count === group.expectedQty;

                  const triggerContent = (
                    <div className="flex-1 text-left flex justify-between items-center w-full">
                        <div className="flex-1 text-left">{group.stokAdi} ({group.stokKodu})</div>
                        <div className="flex-1 text-left">Lot: {group.lotNumarasi}</div>
                        <div className="flex-1 text-left">Miad: {group.miad}</div>
                        <div className="font-bold">{count}/{group.expectedQty}</div>
                    </div>
                  );
                  
                  if (!isSerialTracked) {
                    return (
                        <div key={group.id} className={cn('p-2 rounded-lg flex items-center', complete ? 'bg-green-100 dark:bg-green-900/30' : 'bg-background', groupRowClass(group.stokKodu, group.lotNumarasi, group.miad))}>
                            {triggerContent}
                        </div>
                    );
                  }

                  return (
                    <AccordionItem
                      key={group.id}
                      value={group.id}
                      className={cn(groupRowClass(group.stokKodu, group.lotNumarasi, group.miad))}
                    >
                      <AccordionTrigger className={cn('p-2 rounded-lg', complete && 'bg-green-100 dark:bg-green-900/30')}>
                        {triggerContent}
                      </AccordionTrigger>
                      <AccordionContent>
                        <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 p-2 font-mono text-xs">
                          {group.serials.map(s => (
                            <li key={s}
                              className={cn(
                                'p-1 rounded flex items-center gap-2',
                                (scanned[group.id] || new Set()).has(s) ? 'bg-green-200' : 'bg-red-200',
                                isPoolTransferSerial(s) && 'bg-purple-200 dark:bg-purple-700',
                                isNewSerial(s) && !isPoolTransferSerial(s) && 'bg-blue-200'
                              )}
                            >
                              {(scanned[group.id] || new Set()).has(s) || isNewSerial(s) ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                              <span className={cn(serialTextClass(s))}>{s || '(no-serial)'}</span>
                            </li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </ScrollArea>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={saveSession} disabled={isLoading || allItemsForCount.length === 0}>
            {isLoading && <Loader2 className="animate-spin mr-2" />} Sayımı Tamamla ve Kaydet
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
