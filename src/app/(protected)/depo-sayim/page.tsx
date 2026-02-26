'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, History, ListChecks, Check, Search, Plus, PackagePlus, AlertTriangle, Pencil, Eye, CircleCheck, CircleAlert, ArrowUpCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, writeBatch, doc, Timestamp, setDoc, serverTimestamp, addDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Depot, ProductCode, DepoStokItem, ConsumptionRecord, DepotStockCountSession } from '@/lib/types';
import type { MalKabulHeader, MalKabulLine } from '@/lib/mal-kabul/types';
import BackButton from '@/components/BackButton';
import useHidScanner from '@/hooks/useHidScanner';
import { playFeedback } from '@/lib/utils';
import { nanoid } from 'nanoid';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';

import { TrackingMode, resolveDefaultTrackingMode } from '@/lib/tracking';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import { Badge } from '@/components/ui/badge';

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
  isNewFound?: boolean; // Sayımda yeni bulunan ürün grubu
};

// Sayımda bulunan yeni ürün (listeye eklenmek üzere bekleyen)
type PendingNewItem = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  adet: number;
  seriNumarasi?: string;
  trackingMode: TrackingMode;
  isUnknownProduct: boolean; // productCodes'da tanımlı değil
  rawBarcode?: string;
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
    const [categoryForCount, setCategoryForCount] = useState<'kit' | 'sarf' | ''>('');
    const [brandCountItems, setBrandCountItems] = useState<CountGroup[]>([]);
    const [isCounting, setIsCounting] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showOnlyOpen, setShowOnlyOpen] = useState(true);

    // Yeni ürün ekleme dialog state'leri
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [pendingNewItem, setPendingNewItem] = useState<PendingNewItem | null>(null);
    const [newItemForm, setNewItemForm] = useState({
        stokKodu: '',
        stokAdi: '',
        lotNumarasi: '',
        miad: '',
        adet: 1,
        seriNumarasi: '',
    });

    // Manuel düzenleme dialog state'leri
    const [isManualEditOpen, setIsManualEditOpen] = useState(false);
    const [manualEditGroupId, setManualEditGroupId] = useState<string | null>(null);
    const [manualEditAdet, setManualEditAdet] = useState<number>(0);

    const [draftSessionId, setDraftSessionId] = useState<string | null>(null);

    const serializeCountGroups = useCallback((groups: CountGroup[]) => {
        return groups.map(group => ({
            id: group.id,
            stokKodu: group.stokKodu,
            stokAdi: group.stokAdi,
            lotNumarasi: group.lotNumarasi,
            miad: group.miad,
            trackingMode: group.trackingMode,
            expectedSerials: group.expectedSerials,
            expectedAdet: group.expectedAdet,
            scannedSerials: Array.from(group.scannedSerials),
            scannedAdet: group.scannedAdet,
            isNewFound: !!group.isNewFound,
        }));
    }, []);

    const saveDraftSession = useCallback(async (groups: CountGroup[]) => {
        if (!draftSessionId || !selectedDepotId || !brandForCount || !currentUserProfile) return;
        try {
            await setDoc(doc(db, 'depotBrandCountSessions', draftSessionId), {
                depotId: selectedDepotId,
                depotName: depots.find(d => d.id === selectedDepotId)?.name || '',
                brand: brandForCount,
                category: categoryForCount || null,
                status: 'draft',
                createdBy: currentUserProfile.uid,
                createdByName: currentUserProfile.name || '',
                startedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                draftItems: serializeCountGroups(groups),
            }, { merge: true });
        } catch (error) {
            console.error('saveDraftSession error:', error);
        }
    }, [brandForCount, categoryForCount, currentUserProfile, depots, draftSessionId, selectedDepotId, serializeCountGroups]);

    const availableBrands = useMemo(() => {
        const brands = new Set(productCodes.map(p => p.marka).filter(Boolean) as string[]);
        return Array.from(brands).sort();
    }, [productCodes]);

    const availableCategories = useMemo(() => {
        const categories = new Set(productCodes.map(p => p.urunGrubu).filter(Boolean) as string[]);
        return Array.from(categories).sort();
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

    useEffect(() => {
        if (!isCounting || !draftSessionId) return;
        const timeout = setTimeout(() => {
            saveDraftSession(brandCountItems);
        }, 1500);

        return () => clearTimeout(timeout);
    }, [brandCountItems, draftSessionId, isCounting, saveDraftSession]);

    const startBrandCount = async () => {
        if (!brandForCount || !selectedDepotId) {
          toast({ title: 'Eksik Seçim', description: 'Lütfen sayım yapılacak depo ve markayı seçin.', variant: 'destructive' });
          return;
        }
        const items = fullDepotStok.filter(item => {
          const product = productCodes.find(p => p.stokKodu === item.stokKodu);
          if (!product?.marka || product.marka !== brandForCount) return false;
          if (!item.depotId || item.depotId !== selectedDepotId) return false;
          if (item.isShipped) return false;
          // Kategori seçildiyse, sadece o kategorideki ürünleri filtrele
          if (categoryForCount && product.urunGrubu !== categoryForCount) return false;
          return true;
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
        
        const groupedItems = Object.values(grouped).sort((a, b) => a.stokAdi.localeCompare(b.stokAdi));
        const nextDraftId = draftSessionId || doc(collection(db, 'depotBrandCountSessions')).id;
        setDraftSessionId(nextDraftId);
        setBrandCountItems(groupedItems);
        setIsCounting(true);
        await saveDraftSession(groupedItems);
    };
    
    // Yeni ürün ekleme dialog'unu aç
    const openAddDialog = useCallback((item: PendingNewItem) => {
        setPendingNewItem(item);
        setNewItemForm({
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            lotNumarasi: item.lotNumarasi,
            miad: item.miad,
            adet: 1,
            seriNumarasi: item.seriNumarasi || '',
        });
        setIsAddDialogOpen(true);
    }, []);

    // Yeni ürünü listeye ekle
    const handleAddNewItem = useCallback(() => {
        if (!pendingNewItem) return;

        const { stokKodu, stokAdi, lotNumarasi, miad, adet, seriNumarasi } = newItemForm;

        if (!stokKodu || !stokAdi) {
            toast({ title: 'Eksik Bilgi', description: 'Stok kodu ve adı zorunludur.', variant: 'destructive' });
            return;
        }

        const key = `${stokKodu}-${lotNumarasi || ''}-${miad || ''}`;

        setBrandCountItems(prev => {
            // Aynı grup var mı kontrol et
            const existingIndex = prev.findIndex(g => g.id === key);

            if (existingIndex !== -1) {
                // Varsa, scannedAdet'i artır
                const newItems = [...prev];
                const group = { ...newItems[existingIndex] };

                if (group.trackingMode === 'serial' && seriNumarasi) {
                    group.scannedSerials = new Set(group.scannedSerials).add(seriNumarasi);
                    group.scannedAdet = group.scannedSerials.size;
                } else {
                    group.scannedAdet += adet;
                }

                newItems[existingIndex] = group;
                return newItems;
            }

            // Yoksa yeni grup oluştur
            const newGroup: CountGroup = {
                id: key,
                stokKodu,
                stokAdi,
                lotNumarasi: lotNumarasi || '',
                miad: miad || '',
                trackingMode: pendingNewItem.trackingMode,
                expectedSerials: [],
                expectedAdet: 0, // Sistemde yok, beklenen 0
                scannedSerials: seriNumarasi ? new Set([seriNumarasi]) : new Set(),
                scannedAdet: pendingNewItem.trackingMode === 'serial' ? (seriNumarasi ? 1 : 0) : adet,
                items: [],
                isNewFound: true,
            };

            return [...prev, newGroup].sort((a, b) => a.stokAdi.localeCompare(b.stokAdi));
        });

        playFeedback();
        toast({
            title: 'Ürün Eklendi',
            description: `${stokAdi} sayım listesine eklendi.${pendingNewItem.isUnknownProduct ? ' (Sistemde tanımlı değil)' : ''}`
        });

        setIsAddDialogOpen(false);
        setPendingNewItem(null);
    }, [pendingNewItem, newItemForm, toast]);

    const handleScan = useCallback((barcode: string) => {
        const parsed = parseAuto(barcode, productCodes);

        // Sistemde tanımlı olmayan ürün
        if (!parsed || !parsed.product) {
            playFeedback(true);
            // Dialog aç ve kullanıcıya ekleme seçeneği sun
            openAddDialog({
                stokKodu: parsed?.stokKodu || '',
                stokAdi: '',
                lotNumarasi: parsed?.lotNumarasi || '',
                miad: parsed?.miad || '',
                adet: 1,
                seriNumarasi: parsed?.seriNumarasi || '',
                trackingMode: 'lot_miad',
                isUnknownProduct: true,
                rawBarcode: barcode,
            });
            toast({
                title: 'Bilinmeyen Ürün',
                description: 'Bu ürün sistemde tanımlı değil. Bilgileri girerek ekleyebilirsiniz.'
            });
            return;
        }

        const groupIndex = brandCountItems.findIndex(g =>
            g.stokKodu === parsed.stokKodu &&
            (g.trackingMode.startsWith('qty_') || g.trackingMode.startsWith('lot_') || g.lotNumarasi === (parsed.lotNumarasi || ''))
        );

        // Ürün tanımlı ama sayım listesinde yok
        if (groupIndex === -1) {
            const product = parsed.product as ProductCode;

            // Marka kontrolü - sadece seçilen markaya ait ürünler eklenebilir
            if (product.marka !== brandForCount) {
                playFeedback(true);
                toast({
                    title: 'Farklı Marka',
                    description: `Bu ürün ${product.marka} markasına ait. Sadece ${brandForCount} markasındaki ürünler eklenebilir.`,
                    variant: 'destructive'
                });
                return;
            }

            // Kategori kontrolü (opsiyonel - eğer kategori seçildiyse)
            if (categoryForCount && product.urunGrubu !== categoryForCount) {
                playFeedback(true);
                toast({
                    title: 'Farklı Kategori',
                    description: `Bu ürün ${product.urunGrubu === 'kit' ? 'Kit' : 'Sarf'} kategorisine ait. Sadece ${categoryForCount === 'kit' ? 'Kit' : 'Sarf'} kategorisindeki ürünler eklenebilir.`,
                    variant: 'destructive'
                });
                return;
            }

            // Otomatik olarak listeye ekle (dialog olmadan)
            const key = `${parsed.stokKodu}-${parsed.lotNumarasi || ''}-${parsed.miad || ''}`;
            const trackingMode = resolveDefaultTrackingMode(product as any);

            setBrandCountItems(prev => {
                // Aynı grup var mı kontrol et (aynı lot farklı okutma olabilir)
                const existingIndex = prev.findIndex(g => g.id === key);

                if (existingIndex !== -1) {
                    // Varsa, scannedAdet'i artır
                    const newItems = [...prev];
                    const group = { ...newItems[existingIndex] };

                    if (trackingMode === 'serial' && parsed.seriNumarasi) {
                        if (group.scannedSerials.has(parsed.seriNumarasi)) {
                            playFeedback(true);
                            toast({ title: 'Tekrar', description: 'Bu seri numarası zaten okutuldu.', variant: 'default' });
                            return prev;
                        }
                        group.scannedSerials = new Set(group.scannedSerials).add(parsed.seriNumarasi);
                        group.scannedAdet = group.scannedSerials.size;
                    } else {
                        group.scannedAdet++;
                    }

                    newItems[existingIndex] = group;
                    return newItems;
                }

                // Yoksa yeni grup oluştur
                const newGroup: CountGroup = {
                    id: key,
                    stokKodu: parsed.stokKodu || '',
                    stokAdi: product.stokAdi || '',
                    lotNumarasi: parsed.lotNumarasi || '',
                    miad: parsed.miad || '',
                    trackingMode,
                    expectedSerials: [],
                    expectedAdet: 0, // Sistemde yok, beklenen 0
                    scannedSerials: parsed.seriNumarasi ? new Set([parsed.seriNumarasi]) : new Set(),
                    scannedAdet: trackingMode === 'serial' ? (parsed.seriNumarasi ? 1 : 0) : 1,
                    items: [],
                    isNewFound: true,
                };

                return [...prev, newGroup].sort((a, b) => a.stokAdi.localeCompare(b.stokAdi));
            });

            playFeedback();
            toast({
                title: 'Yeni Ürün Eklendi',
                description: `${product.stokAdi} (${parsed.lotNumarasi || 'Lot yok'}) sayım listesine otomatik eklendi.`
            });
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

    }, [brandCountItems, productCodes, parseAuto, toast, categoryForCount, brandForCount, openAddDialog]);
    
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

    // Manuel düzenleme dialog'unu aç
    const openManualEdit = useCallback((group: CountGroup) => {
        const currentScanned = group.trackingMode === 'serial' ? group.scannedSerials.size : group.scannedAdet;
        setManualEditGroupId(group.id);
        setManualEditAdet(currentScanned);
        setIsManualEditOpen(true);
    }, []);

    // Manuel düzenlemeyi kaydet
    const handleSaveManualEdit = useCallback(() => {
        if (!manualEditGroupId) return;

        setBrandCountItems(prevItems => {
            const newItems = [...prevItems];
            const groupIndex = newItems.findIndex(g => g.id === manualEditGroupId);
            if (groupIndex === -1) return prevItems;

            const group = { ...newItems[groupIndex] };
            group.scannedAdet = manualEditAdet;

            newItems[groupIndex] = group;
            toast({ title: 'Adet Güncellendi', description: `${group.stokAdi} (${group.lotNumarasi}) sayılan adet: ${manualEditAdet}` });
            return newItems;
        });

        setIsManualEditOpen(false);
        setManualEditGroupId(null);
    }, [manualEditGroupId, manualEditAdet, toast]);

    // Manuel düzenlemeyi iptal et
    const handleCancelManualEdit = useCallback(() => {
        setIsManualEditOpen(false);
        setManualEditGroupId(null);
    }, []);

    // Manuel düzenleme veya dialog açıkken barkod dinleyici durdurulmalı
    useHidScanner({
        enabled: isCounting && !isManualEditOpen && !isAddDialogOpen,
        onScan: ({ raw }) => handleScan(raw)
    });
    
    const finishBrandCount = async () => {
        if (!currentUserProfile) return;

        const existingChanges: { group: CountGroup; diff: number }[] = [];
        const newFoundItems: CountGroup[] = [];

        let totalExpected = 0;
        let totalScanned = 0;

        brandCountItems.forEach(group => {
            const scanned = group.trackingMode === 'serial' ? group.scannedSerials.size : group.scannedAdet;
            const diff = scanned - group.expectedAdet;

            totalExpected += group.expectedAdet;
            totalScanned += scanned;

            if (group.isNewFound && scanned > 0) {
                newFoundItems.push(group);
            } else if (diff !== 0) {
                existingChanges.push({ group, diff });
            }
        });

        const existingChangeSummary = existingChanges.map(c =>
            `${c.group.stokAdi} (${c.group.lotNumarasi}): ${c.diff > 0 ? `+${c.diff}` : c.diff}`
        ).join('\n');

        const newFoundSummary = newFoundItems.map(g => {
            const adet = g.trackingMode === 'serial' ? g.scannedSerials.size : g.scannedAdet;
            return `[YENİ] ${g.stokAdi} (${g.lotNumarasi}): +${adet}`;
        }).join('\n');

        const fullSummary = [existingChangeSummary, newFoundSummary].filter(Boolean).join('\n');
        const hasChanges = existingChanges.length > 0 || newFoundItems.length > 0;

        if (!hasChanges) {
            const confirmNoChange = confirm('Tüm ürünler doğrulandı, stokta değişiklik yok. Sayım kaydedilsin mi?');
            if (!confirmNoChange) return;
        } else {
            const confirmMsg = newFoundItems.length > 0
                ? `Aşağıdaki stok değişiklikleri uygulanacak:

${fullSummary}

⚠️ Yeni bulunan ürünler için mal kabul kaydı oluşturulacak.

Devam edilsin mi?`
                : `Aşağıdaki stok değişiklikleri uygulanacak:

${fullSummary}

Devam edilsin mi?`;
            if (!confirm(confirmMsg)) return;
            if (!confirm('Bu işlem geri alınamaz. Kesin olarak farkları kaydetmek istiyor musunuz?')) return;
        }

        setIsLoading(true);
        const depotName = depots.find(d => d.id === selectedDepotId)?.name || '';
        let malKabulTransactionId: string | null = null;
        const sessionRef = doc(collection(db, 'depotBrandCountSessions'));
        const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

        for (const { group, diff } of existingChanges) {
            if (diff < 0) {
                const itemsToDelete = group.trackingMode === 'serial'
                    ? group.items.filter(item => !group.scannedSerials.has(item.seriNumarasi || ''))
                    : group.items.slice(0, Math.abs(diff));

                itemsToDelete.forEach(item => {
                    operations.push((batch) => batch.delete(doc(db, 'depoStok', item.id!)));
                    const consumptionRecord: Omit<ConsumptionRecord, 'id'> = {
                        stokKodu: item.stokKodu, stokAdi: item.stokAdi, lotNumarasi: item.lotNumarasi ?? '',
                        miad: item.miad as string, seriNumarasi: item.seriNumarasi ?? '', consumptionTimestamp: new Date(),
                        consumptionType: 'sayimdan_dusum', userId: currentUserProfile.uid, userName: currentUserProfile.name || '',
                        laboratoryName: depotName, laboratoryId: selectedDepotId,
                    };
                    operations.push((batch) => batch.set(doc(collection(db, 'tuketimKayitlari')), consumptionRecord));
                });
            } else {
                for (let i = 0; i < diff; i++) {
                    const generatedSerial = `FAZLA-${nanoid(6)}`;
                    const newEntry: Omit<DepoStokItem, 'id'> = {
                        depotId: selectedDepotId, depotName, stokKodu: group.stokKodu, stokAdi: group.stokAdi,
                        lotNumarasi: group.lotNumarasi, miad: group.miad, eklenmeTarihi: new Date(), isShipped: false,
                        irsaliyeNumarasi: 'SAYIMDAN_FAZLA', createdByName: currentUserProfile.name, seriNumarasi: generatedSerial,
                    };
                    const additionRecord: Omit<ConsumptionRecord, 'id'> = {
                        stokKodu: group.stokKodu, stokAdi: group.stokAdi, lotNumarasi: group.lotNumarasi,
                        miad: group.miad, seriNumarasi: generatedSerial, consumptionTimestamp: new Date(),
                        consumptionType: 'sayimdan_fazla', userId: currentUserProfile.uid, userName: currentUserProfile.name || '',
                        laboratoryName: depotName, laboratoryId: selectedDepotId,
                    };
                    operations.push((batch) => batch.set(doc(collection(db, 'depoStok')), newEntry));
                    operations.push((batch) => batch.set(doc(collection(db, 'tuketimKayitlari')), additionRecord));
                }
            }
        }

        if (newFoundItems.length > 0) {
            malKabulTransactionId = `MK-SAYIM-${nanoid(8)}`;
            const malKabulRef = doc(collection(db, 'malKabulTransactions'));
            const malKabulHeader: MalKabulHeader = {
                transactionId: malKabulTransactionId,
                depotId: selectedDepotId,
                depotName,
                userId: currentUserProfile.uid,
                userName: currentUserProfile.name || '',
                timestamp: Timestamp.now(),
                itemCount: newFoundItems.reduce((sum, g) => sum + (g.trackingMode === 'serial' ? g.scannedSerials.size : g.scannedAdet), 0),
                brands: [...new Set(newFoundItems.map(() => brandForCount))],
                mode: 'unverified',
            };
            operations.push((batch) => batch.set(malKabulRef, malKabulHeader));

            for (const group of newFoundItems) {
                const adet = group.trackingMode === 'serial' ? group.scannedSerials.size : group.scannedAdet;
                const serials = group.trackingMode === 'serial' ? Array.from(group.scannedSerials) : [];

                const lineRef = doc(collection(db, 'malKabulTransactions', malKabulRef.id, 'lines'));
                const malKabulLine: MalKabulLine = {
                    stokKodu: group.stokKodu,
                    stokAdi: group.stokAdi,
                    lotNumarasi: group.lotNumarasi,
                    miad: group.miad,
                    adet,
                    serials,
                };
                operations.push((batch) => batch.set(lineRef, malKabulLine));

                if (group.trackingMode === 'serial') {
                    for (const seri of serials) {
                        const stockEntry: Omit<DepoStokItem, 'id'> = {
                            depotId: selectedDepotId,
                            depotName,
                            stokKodu: group.stokKodu,
                            stokAdi: group.stokAdi,
                            lotNumarasi: group.lotNumarasi,
                            miad: group.miad,
                            seriNumarasi: seri,
                            eklenmeTarihi: new Date(),
                            isShipped: false,
                            irsaliyeNumarasi: malKabulTransactionId,
                            createdByName: currentUserProfile.name,
                        };
                        operations.push((batch) => batch.set(doc(collection(db, 'depoStok')), stockEntry));
                    }
                } else {
                    for (let i = 0; i < adet; i++) {
                        const stockEntry: Omit<DepoStokItem, 'id'> = {
                            depotId: selectedDepotId,
                            depotName,
                            stokKodu: group.stokKodu,
                            stokAdi: group.stokAdi,
                            lotNumarasi: group.lotNumarasi,
                            miad: group.miad,
                            seriNumarasi: `SAYIM-${nanoid(6)}`,
                            eklenmeTarihi: new Date(),
                            isShipped: false,
                            irsaliyeNumarasi: malKabulTransactionId,
                            createdByName: currentUserProfile.name,
                        };
                        operations.push((batch) => batch.set(doc(collection(db, 'depoStok')), stockEntry));
                    }
                }

                const newFoundRecord: Omit<ConsumptionRecord, 'id'> = {
                    stokKodu: group.stokKodu, stokAdi: group.stokAdi, lotNumarasi: group.lotNumarasi,
                    miad: group.miad, seriNumarasi: serials.join(', ') || '', consumptionTimestamp: new Date(),
                    consumptionType: 'sayimdan_fazla', userId: currentUserProfile.uid, userName: currentUserProfile.name || '',
                    laboratoryName: depotName, laboratoryId: selectedDepotId,
                    irsaliyeNumarasi: malKabulTransactionId || undefined,
                };
                operations.push((batch) => batch.set(doc(collection(db, 'tuketimKayitlari')), newFoundRecord));
            }
        }

        const missingCount = existingChanges.filter(c => c.diff < 0).reduce((sum, c) => sum + Math.abs(c.diff), 0);
        const extraCount = existingChanges.filter(c => c.diff > 0).reduce((sum, c) => sum + c.diff, 0);
        const newFoundCount = newFoundItems.reduce((sum, g) => sum + (g.trackingMode === 'serial' ? g.scannedSerials.size : g.scannedAdet), 0);

        const sessionData: Omit<DepotStockCountSession, 'id'> = {
            depotId: selectedDepotId,
            depotName,
            brand: brandForCount,
            startedAt: Timestamp.now(),
            closedAt: Timestamp.now(),
            createdBy: currentUserProfile.uid,
            createdByName: currentUserProfile.name || '',
            status: 'completed',
            itemCount: totalExpected,
            scannedCount: totalScanned,
            missingCount,
            category: categoryForCount || undefined,
            extraCount,
            newFoundCount,
        };
        operations.push((batch) => batch.set(sessionRef, sessionData));

        try {
            const chunkSize = 450;
            for (let i = 0; i < operations.length; i += chunkSize) {
                const batch = writeBatch(db);
                operations.slice(i, i + chunkSize).forEach(op => op(batch));
                await batch.commit();
            }

            const scopedQuery = query(
                collection(db, 'depoStok'),
                where('depotId', '==', selectedDepotId)
            );
            const scopedSnap = await getDocs(scopedQuery);
            const expectedByGroup = new Map<string, number>();

            brandCountItems.forEach(group => {
                const product = productCodes.find(p => p.stokKodu === group.stokKodu);
                if (!product || product.marka !== brandForCount) return;
                if (categoryForCount && product.urunGrubu !== categoryForCount) return;
                const counted = group.trackingMode === 'serial' ? group.scannedSerials.size : group.scannedAdet;
                expectedByGroup.set(group.id, counted);
            });

            const actualByGroup = new Map<string, number>();
            scopedSnap.docs.forEach(stockDoc => {
                const item = stockDoc.data() as DepoStokItem;
                if (item.isShipped) return;
                const product = productCodes.find(p => p.stokKodu === item.stokKodu);
                if (!product || product.marka !== brandForCount) return;
                if (categoryForCount && product.urunGrubu !== categoryForCount) return;
                const key = `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;
                actualByGroup.set(key, (actualByGroup.get(key) || 0) + 1);
            });

            const mismatches = Array.from(expectedByGroup.entries())
                .map(([key, expected]) => ({ key, expected, actual: actualByGroup.get(key) || 0 }))
                .filter(m => m.expected !== m.actual);

            await addDoc(collection(db, 'depotBrandCountValidationLogs'), {
                sessionId: sessionRef.id,
                depotId: selectedDepotId,
                brand: brandForCount,
                category: categoryForCount || null,
                expectedTotal: Array.from(expectedByGroup.values()).reduce((sum, v) => sum + v, 0),
                actualTotal: Array.from(actualByGroup.values()).reduce((sum, v) => sum + v, 0),
                mismatchCount: mismatches.length,
                mismatches,
                operationCount: operations.length,
                createdAt: serverTimestamp(),
                createdBy: currentUserProfile.uid,
            });

            if (mismatches.length > 0) {
                toast({ title: 'Uyarı', description: `Sayım kaydedildi fakat ${mismatches.length} satırda doğrulama farkı var. Loglara işlendi.`, variant: 'destructive' });
            } else {
                const message = malKabulTransactionId
                    ? `Stok farkları kaydedildi ve doğrulandı. Mal Kabul No: ${malKabulTransactionId}`
                    : hasChanges
                        ? 'Stok farkları başarıyla kaydedildi ve doğrulandı.'
                        : 'Sayım başarıyla kaydedildi ve doğrulandı.';
                toast({ title: 'Başarılı', description: message });
            }

            await setDoc(doc(db, 'depotBrandCountSessions', sessionRef.id), { validationCompletedAt: serverTimestamp(), mismatchCount: mismatches.length }, { merge: true });
            await fetchData();
            setDraftSessionId(null);
        } catch (e) {
            toast({ title: 'Hata', description: 'Stok güncellenirken bir hata oluştu.', variant: 'destructive' });
            console.error('finishBrandCount error:', e);
        } finally {
            setIsLoading(false);
            setIsCounting(false);
            setBrandCountItems([]);
        }
    };

    const filteredBrandCountItems = useMemo(() => {
        let items = brandCountItems;

        if (showOnlyOpen) {
            items = items.filter((group) => {
                if (group.isNewFound) return true;
                const scanned = group.trackingMode === 'serial' ? group.scannedSerials.size : group.scannedAdet;
                return scanned !== group.expectedAdet;
            });
        }

        if (!searchTerm) return items;
        const lowerSearch = searchTerm.toLowerCase();
        return items.filter(item => 
            item.stokAdi.toLowerCase().includes(lowerSearch) ||
            item.stokKodu.toLowerCase().includes(lowerSearch) ||
            item.lotNumarasi.toLowerCase().includes(lowerSearch)
        );
    }, [brandCountItems, searchTerm, showOnlyOpen]);

    const countSummary = useMemo(() => {
        return brandCountItems.reduce((acc, group) => {
            const scanned = group.trackingMode === 'serial' ? group.scannedSerials.size : group.scannedAdet;
            acc.total += 1;

            if (group.isNewFound) {
                acc.extra += 1;
                acc.open += 1;
                return acc;
            }

            if (scanned === group.expectedAdet) {
                acc.completed += 1;
            } else if (scanned > group.expectedAdet) {
                acc.extra += 1;
                acc.open += 1;
            } else {
                acc.missing += 1;
                acc.open += 1;
            }
            return acc;
        }, { total: 0, completed: 0, open: 0, missing: 0, extra: 0 });
    }, [brandCountItems]);

    const getGroupStatus = (group: CountGroup, scannedCount: number) => {
        if (group.isNewFound) return { label: 'Fazla', style: 'text-amber-700 bg-amber-50 border-amber-200', Icon: ArrowUpCircle };
        if (scannedCount === group.expectedAdet) return { label: 'Tam', style: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CircleCheck };
        if (scannedCount > group.expectedAdet) return { label: 'Fazla', style: 'text-amber-700 bg-amber-50 border-amber-200', Icon: ArrowUpCircle };
        return { label: 'Eksik', style: 'text-rose-700 bg-rose-50 border-rose-200', Icon: CircleAlert };
    };



    const handleScopeChangeWithConfirm = async (field: 'depot' | 'brand' | 'category', value: string) => {
        if (!isCounting) {
            if (field === 'depot') setSelectedDepotId(value);
            if (field === 'brand') setBrandForCount(value);
            if (field === 'category') setCategoryForCount((value === '__all__' ? '' : value) as 'kit' | 'sarf' | '');
            return;
        }

        const shouldSaveDraft = confirm('Sayım kapsamı değişiyor. Mevcut taslak kaydedilip sayımdan çıkılsın mı?');
        if (!shouldSaveDraft) return;

        await saveDraftSession(brandCountItems);
        setIsCounting(false);
        setBrandCountItems([]);

        if (field === 'depot') setSelectedDepotId(value);
        if (field === 'brand') setBrandForCount(value);
        if (field === 'category') setCategoryForCount((value === '__all__' ? '' : value) as 'kit' | 'sarf' | '');

        toast({ title: 'Taslak Kaydedildi', description: 'Mevcut sayım taslağı kaydedildi. Yeni kapsamı başlatabilirsiniz.' });
    };

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
                        Belirli bir markaya ve opsiyonel olarak ürün kategorisine (Kit/Sarf) ait ürünlerin depo sayımını yapmak için depo, marka ve kategori seçin.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <Label>Depo</Label>
                            <Select value={selectedDepotId} onValueChange={(v) => void handleScopeChangeWithConfirm('depot', v)}>
                                <SelectTrigger><SelectValue placeholder="Depo Seçin..." /></SelectTrigger>
                                <SelectContent>{depots.map(d => <SelectItem key={d.id} value={d.id!}>{d.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Marka</Label>
                            <Select value={brandForCount} onValueChange={(v) => void handleScopeChangeWithConfirm('brand', v)}>
                                <SelectTrigger><SelectValue placeholder="Marka Seçin..." /></SelectTrigger>
                                <SelectContent>{availableBrands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Ürün Kategorisi</Label>
                            <Select
                                value={categoryForCount || '__all__'}
                                onValueChange={(v) => void handleScopeChangeWithConfirm('category', v)}
                            >
                                <SelectTrigger><SelectValue placeholder="Kategori Seçin (Opsiyonel)..." /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">Tümü</SelectItem>
                                    {availableCategories.map(c => (
                                        <SelectItem key={c} value={c}>{c === 'kit' ? 'Kit' : 'Sarf'}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {isCounting && (
                        <div className="flex flex-wrap gap-2 text-sm">
                            <Badge variant="secondary">Toplam ürün: {countSummary.total}</Badge>
                            <Badge variant="secondary">Açık ürün: {countSummary.open}</Badge>
                            <Badge variant="secondary">Tamamlanan: {countSummary.completed}</Badge>
                        </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                        <Button onClick={startBrandCount} disabled={isCounting || !selectedDepotId || !brandForCount}>Sayımı Başlat</Button>
                        {isCounting && (
                            <div className="flex flex-wrap gap-2">
                                <Button onClick={finishBrandCount} variant="destructive">Bitir & Farkları Kaydet</Button>
                                <Button onClick={() => { setIsCounting(false); setBrandCountItems([]); }} variant="outline">Sayımı Askıya Al / Çık</Button>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {isCounting && (
                 <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle>Sayım: {brandForCount}{categoryForCount ? ` - ${categoryForCount === 'kit' ? 'Kit' : 'Sarf'}` : ''}</CardTitle>
                    <CardDescription>Sayım odak ekranı: açık ürünleri filtreleyin, barkod okutup durumu doğrulayın, satır bazlı düzeltme ve onay verin.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Ürün adı / stok kodu / lot / seri ara..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <div className="mb-3 flex items-center justify-between">
                      <Button variant={showOnlyOpen ? 'default' : 'outline'} size="sm" onClick={() => setShowOnlyOpen(prev => !prev)}>
                        {showOnlyOpen ? 'Sadece Açıklar' : 'Tüm Satırlar'}
                      </Button>
                      <p className="text-xs text-muted-foreground">Açık: {countSummary.open} • Tam: {countSummary.completed}</p>
                    </div>
                    <ScrollArea className="h-[60vh]">
                      <Accordion type="multiple" defaultValue={filteredBrandCountItems.map(g => g.id)}>
                        {filteredBrandCountItems.map((group) => {
                          const scannedCount = group.trackingMode === 'serial' ? group.scannedSerials.size : group.scannedAdet;
                          const isNewFound = group.isNewFound;
                          const status = getGroupStatus(group, scannedCount);
                          const progress = group.expectedAdet > 0 ? Math.min(100, Math.round((scannedCount / group.expectedAdet) * 100)) : 100;
                          return (
                            <AccordionItem key={group.id} value={group.id} className={cn(
                              "border-b border-l-4",
                              status.label === 'Tam' && 'border-l-emerald-400',
                              status.label === 'Eksik' && 'border-l-rose-400',
                              status.label === 'Fazla' && 'border-l-amber-400'
                            )}>
                              <AccordionTrigger className="hover:no-underline">
                                <div className="flex-1 text-left space-y-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{group.stokAdi} ({group.stokKodu}) - Lot: {group.lotNumarasi || '-'}</span>
                                    <Badge variant="outline" className={cn('text-xs', status.style)}>
                                      <status.Icon className="h-3.5 w-3.5 mr-1" />
                                      {status.label}
                                    </Badge>
                                    {group.trackingMode === 'serial' ? (
                                      <Badge variant="secondary" className="text-xs">Seri Takipli</Badge>
                                    ) : (
                                      <Badge variant="secondary" className="text-xs">Adet Takipli</Badge>
                                    )}
                                    {isNewFound && (
                                      <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs">
                                        <PackagePlus className="h-3 w-3 mr-1" />
                                        YENİ
                                      </Badge>
                                    )}
                                  </div>
                                  {!isNewFound && (
                                    <div className="space-y-1 pr-6">
                                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                        <div className={cn('h-full rounded-full', status.label === 'Tam' ? 'bg-emerald-500' : status.label === 'Eksik' ? 'bg-rose-500' : 'bg-amber-500')} style={{ width: `${progress}%` }} />
                                      </div>
                                      <p className="text-xs text-muted-foreground">Okutulan {scannedCount} / Beklenen {group.expectedAdet}</p>
                                    </div>
                                  )}
                                </div>
                                <div className="ml-2 flex items-center gap-2">
                                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Detay">
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openManualEdit(group);
                                    }}
                                    className="h-8 w-8 hover:bg-blue-500/20"
                                    title="Düzelt"
                                  >
                                    <Pencil className="h-4 w-4 text-blue-600" />
                                  </Button>
                                  {!isNewFound && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleManualVerifyGroup(group.id);
                                      }}
                                      className="h-8 w-8 hover:bg-green-500/20"
                                      title="Onayla"
                                    >
                                      <Check className="h-5 w-5 text-green-600" />
                                    </Button>
                                  )}
                                </div>
                              </AccordionTrigger>
                              <AccordionContent>
                                {isNewFound ? (
                                  <div className="p-2 text-sm">
                                    <p className="text-blue-600 font-medium mb-1">Sayımda yeni bulunan ürün</p>
                                    <p className="text-muted-foreground">
                                      Bu ürün sistemde kayıtlı değildi. Sayım bittiğinde mal kabul kaydı oluşturularak stoğa eklenecek.
                                    </p>
                                    {group.trackingMode === 'serial' && group.scannedSerials.size > 0 && (
                                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                                        {Array.from(group.scannedSerials).map((serial) => (
                                          <div key={serial} className="p-1 text-xs rounded font-mono bg-blue-200">
                                            {serial}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ) : group.trackingMode === 'serial' ? (
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-2">
                                    {group.expectedSerials.map((serial: string, index: number) => (
                                        <div key={`${serial}-${index}`} className={cn("p-1.5 text-xs rounded font-mono border", group.scannedSerials.has(serial) ? 'border-emerald-300 text-emerald-700' : 'border-rose-300 text-rose-700')}>
                                        {serial}
                                        </div>
                                    ))}
                                    </div>
                                ) : (
                                    <div className="p-2 text-sm text-muted-foreground space-y-2">
                                      <p>Bu ürün adet ile takip ediliyor.</p>
                                      <p className="text-xs">Hızlı düzeltme için düzenle butonundan okutulan adedi +1 / -1 mantığında güncelleyebilirsiniz.</p>
                                    </div>
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

            {/* Yeni Ürün Ekleme Dialog'u */}
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <PackagePlus className="h-5 w-5 text-blue-600" />
                            {pendingNewItem?.isUnknownProduct ? 'Bilinmeyen Ürün Ekle' : 'Yeni Ürün Ekle'}
                        </DialogTitle>
                        <DialogDescription>
                            {pendingNewItem?.isUnknownProduct
                                ? 'Bu ürün sistemde tanımlı değil. Bilgilerini girerek sayım listesine ekleyebilirsiniz.'
                                : 'Bu ürün sayım listesinde yok. Depoda bulunuyorsa aşağıdaki bilgilerle ekleyebilirsiniz.'}
                        </DialogDescription>
                    </DialogHeader>

                    {pendingNewItem?.isUnknownProduct && (
                        <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-md text-sm">
                            <AlertTriangle className="h-4 w-4 text-yellow-600" />
                            <span className="text-yellow-700">Bu ürün sistemde tanımlı değil. Sayım bittiğinde mal kabul kaydı oluşturulacak.</span>
                        </div>
                    )}

                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Stok Kodu *</Label>
                                <Input
                                    value={newItemForm.stokKodu}
                                    onChange={(e) => setNewItemForm(prev => ({ ...prev, stokKodu: e.target.value }))}
                                    placeholder="Stok kodu..."
                                    disabled={!pendingNewItem?.isUnknownProduct && !!pendingNewItem?.stokKodu}
                                />
                            </div>
                            <div>
                                <Label>Stok Adı *</Label>
                                <Input
                                    value={newItemForm.stokAdi}
                                    onChange={(e) => setNewItemForm(prev => ({ ...prev, stokAdi: e.target.value }))}
                                    placeholder="Ürün adı..."
                                    disabled={!pendingNewItem?.isUnknownProduct && !!pendingNewItem?.stokAdi}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Lot Numarası</Label>
                                <Input
                                    value={newItemForm.lotNumarasi}
                                    onChange={(e) => setNewItemForm(prev => ({ ...prev, lotNumarasi: e.target.value }))}
                                    placeholder="Lot no..."
                                />
                            </div>
                            <div>
                                <Label>Miad (SKT)</Label>
                                <Input
                                    value={newItemForm.miad}
                                    onChange={(e) => setNewItemForm(prev => ({ ...prev, miad: e.target.value }))}
                                    placeholder="dd.MM.yyyy"
                                />
                            </div>
                        </div>

                        {pendingNewItem?.trackingMode === 'serial' ? (
                            <div>
                                <Label>Seri Numarası</Label>
                                <Input
                                    value={newItemForm.seriNumarasi}
                                    onChange={(e) => setNewItemForm(prev => ({ ...prev, seriNumarasi: e.target.value }))}
                                    placeholder="Seri numarası..."
                                />
                            </div>
                        ) : (
                            <div>
                                <Label>Adet</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={newItemForm.adet}
                                    onChange={(e) => setNewItemForm(prev => ({ ...prev, adet: parseInt(e.target.value) || 1 }))}
                                />
                            </div>
                        )}

                        {pendingNewItem?.rawBarcode && (
                            <div className="text-xs text-muted-foreground">
                                <span className="font-medium">Okunan Barkod:</span> {pendingNewItem.rawBarcode}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setIsAddDialogOpen(false); setPendingNewItem(null); }}>
                            İptal
                        </Button>
                        <Button onClick={handleAddNewItem} disabled={!newItemForm.stokKodu || !newItemForm.stokAdi}>
                            <Plus className="h-4 w-4 mr-2" />
                            Listeye Ekle
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Manuel Düzenleme Dialog'u */}
            <Dialog open={isManualEditOpen} onOpenChange={(open) => { if (!open) handleCancelManualEdit(); }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="h-5 w-5 text-blue-600" />
                            Manuel Adet Düzenleme
                        </DialogTitle>
                        <DialogDescription>
                            {(() => {
                                const group = brandCountItems.find(g => g.id === manualEditGroupId);
                                if (!group) return 'Sayılan adeti manuel olarak düzenleyin.';
                                return `${group.stokAdi} (${group.lotNumarasi}) - Beklenen: ${group.expectedAdet}`;
                            })()}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-4">
                        <Label>Sayılan Adet</Label>
                        <Input
                            type="number"
                            min={0}
                            value={manualEditAdet}
                            onChange={(e) => setManualEditAdet(Math.max(0, parseInt(e.target.value) || 0))}
                            autoFocus
                            className="text-lg font-bold text-center"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                            Barkod dinleyici bu pencere açıkken duraklatılmıştır.
                        </p>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={handleCancelManualEdit}>
                            İptal
                        </Button>
                        <Button onClick={handleSaveManualEdit}>
                            <Check className="h-4 w-4 mr-2" />
                            Kaydet
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
    

    
