'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Trash2, Upload, Camera, Download, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Hospital, Depot, ProductCode, DepoStokItem } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { playFeedback, generateId } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import useHidScanner from '@/hooks/useHidScanner';
import BarcodeFormatSelect, { type FormatValue } from '@/components/BarcodeFormatSelect';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import { TrackingMode, resolveDefaultTrackingMode } from '@/lib/tracking';
import { useAuth } from '@/contexts/auth-context';
import * as XLSX from 'xlsx';
import { serverTimestamp } from 'firebase/firestore';
import { useRouter } from 'next/navigation';

const CameraScanner = dynamic(() => import('@/components/camera-barcode-scanner'), {
    ssr: false,
    loading: () => <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /><span className="ml-2">Kamera Yükleniyor...</span></div>,
});

interface DestroyedItem {
    id: string;
    stokKodu: string;
    stokAdi: string;
    lotNumarasi: string;
    miad: string;
    seriNumarasi: string;
    adet: number;
    depotId?: string;
    depotName?: string;
    laboratoryId?: string;
    laboratoryName?: string;
    sourceType: 'barcode' | 'excel';
    isGroup?: boolean;
    key: string;
}

interface GroupedDestroyedItem {
    key: string;
    stokKodu: string;
    stokAdi: string;
    lotNumarasi: string;
    miad: string;
    adet: number;
    serials: { id: string; seriNumarasi: string }[];
    sourceType: 'barcode' | 'excel';
}

export default function ImhaEdilenKitlerPanel() {
    const { toast } = useToast();
    const { currentUser, currentUserProfile } = useAuth();
    const router = useRouter();

    // Master Data
    const [hospitals, setHospitals] = useState<Hospital[]>([]);
    const [depots, setDepots] = useState<Depot[]>([]);
    const [products, setProducts] = useState<ProductCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    // Selection State
    const [selectedSourceType, setSelectedSourceType] = useState<'depot' | 'laboratory'>('laboratory');
    const [selectedDepotId, setSelectedDepotId] = useState<string>('');
    const [selectedLabId, setSelectedLabId] = useState<string>('');

    // Destroyed Items List (local state before saving)
    const [destroyedItems, setDestroyedItems] = useState<DestroyedItem[]>([]);

    // Barcode scanning
    const { formats: barcodeFormats, loading: formatsLoading } = useSafeBarcodeFormats();
    const { parseAnyBarcode, resolveProductFromParsed } = useBarcodeParser();
    const [selectedFormatId, setSelectedFormatId] = useState<FormatValue>('__auto__');
    const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);

    // Fetch master data
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [hospitalsSnap, depotsSnap, productsSnap] = await Promise.all([
                    getDocs(collection(db, 'hospitals')),
                    getDocs(collection(db, 'depots')),
                    getDocs(collection(db, 'productCodes')),
                ]);

                setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
                setDepots(depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)));
                setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
            } catch (error) {
                console.error("Error fetching master data:", error);
                toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [toast]);

    // Get selected source name
    const selectedSourceName = useMemo(() => {
        if (selectedSourceType === 'depot') {
            return depots.find(d => d.id === selectedDepotId)?.name || '';
        } else {
            return hospitals.find(h => h.id === selectedLabId)?.name || '';
        }
    }, [selectedSourceType, selectedDepotId, selectedLabId, depots, hospitals]);

    // Count stock by serial
    const countStockBySerial = useCallback(async (stokKodu: string, serial: string, sourceId: string, sourceType: 'depot' | 'laboratory'): Promise<DepoStokItem[]> => {
        const collectionName = sourceType === 'depot' ? 'depoStok' : 'labStock';
        const idField = sourceType === 'depot' ? 'depotId' : 'laboratoryId';

        const q = query(
            collection(db, collectionName),
            where(idField, '==', sourceId),
            where('stokKodu', '==', stokKodu),
            where('seriNumarasi', '==', serial),
            ...(sourceType === 'depot' ? [where('isShipped', '==', false)] : [])
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
    }, []);

    // Count stock by lot
    const countStockByLot = useCallback(async (stokKodu: string, lot: string, sourceId: string, sourceType: 'depot' | 'laboratory'): Promise<DepoStokItem[]> => {
        const collectionName = sourceType === 'depot' ? 'depoStok' : 'labStock';
        const idField = sourceType === 'depot' ? 'depotId' : 'laboratoryId';

        const q = query(
            collection(db, collectionName),
            where(idField, '==', sourceId),
            where('stokKodu', '==', stokKodu),
            where('lotNumarasi', '==', lot),
            ...(sourceType === 'depot' ? [where('isShipped', '==', false)] : [])
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
    }, []);

    // Handle barcode scan
    const handleScan = useCallback(async (raw: string, source: 'hid' | 'camera' = 'hid') => {
        if (!raw) return;

        const sourceId = selectedSourceType === 'depot' ? selectedDepotId : selectedLabId;
        if (!sourceId) {
            playFeedback(true);
            toast({ title: 'Uyarı', description: 'Önce bir depo veya laboratuvar seçin.', variant: 'destructive' });
            return;
        }

        let parsed = null;
        if (selectedFormatId && selectedFormatId !== '__auto__') {
            const fmt = barcodeFormats.find(f => f.id === selectedFormatId);
            if (fmt) parsed = parseAnyBarcode(raw, [fmt]);
        }
        if (!parsed) {
            parsed = parseAnyBarcode(raw, barcodeFormats);
        }

        if (!parsed) {
            playFeedback(true);
            toast({ title: 'Ayrıştırma Hatası', description: 'Barkod tanımlı formatlarla eşleşmiyor.', variant: 'destructive' });
            return;
        }

        const resolved = resolveProductFromParsed(parsed, products);
        if (!resolved.product || !resolved.stokKodu) {
            playFeedback(true);
            toast({ title: 'Ürün Bulunamadı', description: 'Barkoddan bir ürün çözümlenemedi.', variant: 'destructive' });
            return;
        }

        const { product } = resolved;
        const stokKodu = product.stokKodu ?? '';
        const stokAdi = product.stokAdi ?? '';
        const lot = resolved.lotNumarasi || '';
        const miad = resolved.miadFormatted || '';
        const seri = resolved.seriNumarasi || '';

        // Check for duplicate serial
        if (seri && destroyedItems.some(item => item.stokKodu === stokKodu && item.seriNumarasi === seri)) {
            playFeedback(true);
            toast({ title: 'Mükerrer Seri No', description: 'Bu seri no zaten listeye eklendi.', variant: 'default' });
            return;
        }

        const mode: TrackingMode = resolveDefaultTrackingMode(product as any);

        if (mode === 'serial') {
            if (!seri) {
                playFeedback(true);
                toast({ title: 'Seri Eksik', description: 'Seri no takipli üründe barkod seri içermiyor.', variant: 'destructive' });
                return;
            }

            // Check stock
            const items = await countStockBySerial(stokKodu, seri, sourceId, selectedSourceType);
            if (items.length === 0) {
                toast({
                    title: 'Stok Bulunamadı',
                    description: `Seri No ${seri} seçilen ${selectedSourceType === 'depot' ? 'depoda' : 'laboratuvarda'} bulunamadı. Yine de eklenecek.`,
                    variant: 'default'
                });
            }

            // Add to list
            const newItem: DestroyedItem = {
                id: generateId(),
                stokKodu,
                stokAdi,
                lotNumarasi: lot,
                miad,
                seriNumarasi: seri,
                adet: 1,
                sourceType: 'barcode',
                key: generateId(),
                isGroup: false,
                ...(selectedSourceType === 'depot'
                    ? { depotId: selectedDepotId, depotName: selectedSourceName }
                    : { laboratoryId: selectedLabId, laboratoryName: selectedSourceName }
                )
            };

            setDestroyedItems(prev => [newItem, ...prev]);
            playFeedback();
            toast({ title: 'Ürün Eklendi', description: `${stokAdi} imha listesine eklendi.` });
            return;
        }

        if (mode === 'lot_barcode' || mode === 'lot_manual') {
            if (!lot) {
                playFeedback(true);
                toast({ title: 'Lot Eksik', description: 'Lot bilgisi gerekli fakat bulunamadı.', variant: 'destructive' });
                return;
            }

            // Check stock
            const items = await countStockByLot(stokKodu, lot, sourceId, selectedSourceType);
            if (items.length === 0) {
                toast({
                    title: 'Stok Bulunamadı',
                    description: `Lot ${lot} seçilen ${selectedSourceType === 'depot' ? 'depoda' : 'laboratuvarda'} bulunamadı. Yine de eklenecek.`,
                    variant: 'default'
                });
            }

            // Add or increment group
            const key = `${stokKodu}__${lot}`;
            setDestroyedItems(prev => {
                const existing = prev.find(item => item.key === key && item.isGroup);
                if (existing) {
                    return prev.map(item => item.key === key ? { ...item, adet: item.adet + 1 } : item);
                }

                const newItem: DestroyedItem = {
                    id: generateId(),
                    stokKodu,
                    stokAdi,
                    lotNumarasi: lot,
                    miad,
                    seriNumarasi: '',
                    adet: 1,
                    sourceType: 'barcode',
                    key,
                    isGroup: true,
                    ...(selectedSourceType === 'depot'
                        ? { depotId: selectedDepotId, depotName: selectedSourceName }
                        : { laboratoryId: selectedLabId, laboratoryName: selectedSourceName }
                    )
                };

                return [newItem, ...prev];
            });

            playFeedback();
            toast({ title: 'Ürün Eklendi', description: `${stokAdi} (Lot: ${lot}) imha listesine eklendi.` });
            return;
        }

        // Quantity only mode
        const key = stokKodu;
        setDestroyedItems(prev => {
            const existing = prev.find(item => item.key === key && item.isGroup);
            if (existing) {
                return prev.map(item => item.key === key ? { ...item, adet: item.adet + 1 } : item);
            }

            const newItem: DestroyedItem = {
                id: generateId(),
                stokKodu,
                stokAdi,
                lotNumarasi: '',
                miad: '',
                seriNumarasi: '',
                adet: 1,
                sourceType: 'barcode',
                key,
                isGroup: true,
                ...(selectedSourceType === 'depot'
                    ? { depotId: selectedDepotId, depotName: selectedSourceName }
                    : { laboratoryId: selectedLabId, laboratoryName: selectedSourceName }
                )
            };

            return [newItem, ...prev];
        });

        playFeedback();
        toast({ title: 'Ürün Eklendi', description: `${stokAdi} imha listesine eklendi.` });
    }, [selectedSourceType, selectedDepotId, selectedLabId, selectedFormatId, barcodeFormats, products, destroyedItems, parseAnyBarcode, resolveProductFromParsed, toast, selectedSourceName, countStockBySerial, countStockByLot]);

    useHidScanner({
        enabled: true,
        onScan: ({ raw }) => {
            if (raw) handleScan(raw.trim(), 'hid');
        },
    });

    const handleCameraScan = (raw: string) => {
        if (raw?.trim()) handleScan(raw.trim(), 'camera');
        if (isCameraScannerOpen) setIsCameraScannerOpen(false);
    };

    // Handle excel upload
    const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const sourceId = selectedSourceType === 'depot' ? selectedDepotId : selectedLabId;
        if (!sourceId) {
            toast({ title: 'Uyarı', description: 'Önce bir depo veya laboratuvar seçin.', variant: 'destructive' });
            return;
        }

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

            // Expected columns: stok kodu, lot, miad, seri no
            let addedCount = 0;
            for (const row of jsonData) {
                const stokKodu = row['stok kodu'] || row['Stok Kodu'] || row['STOK KODU'];
                const lot = row['lot'] || row['Lot'] || row['LOT'] || '';
                const miad = row['miad'] || row['Miad'] || row['MIAD'] || '';
                const seri = row['seri no'] || row['Seri No'] || row['SERI NO'] || '';

                if (!stokKodu) continue;

                const product = products.find(p => p.stokKodu === stokKodu);
                if (!product) {
                    console.warn(`Ürün bulunamadı: ${stokKodu}`);
                    continue;
                }

                const stokAdi = product.stokAdi ?? '';

                // Check for duplicate serial
                if (seri && destroyedItems.some(item => item.stokKodu === stokKodu && item.seriNumarasi === seri)) {
                    continue; // Skip duplicate
                }

                const newItem: DestroyedItem = {
                    id: generateId(),
                    stokKodu,
                    stokAdi,
                    lotNumarasi: lot,
                    miad,
                    seriNumarasi: seri,
                    adet: 1,
                    sourceType: 'excel',
                    key: seri ? generateId() : `${stokKodu}__${lot}`,
                    isGroup: !seri,
                    ...(selectedSourceType === 'depot'
                        ? { depotId: selectedDepotId, depotName: selectedSourceName }
                        : { laboratoryId: selectedLabId, laboratoryName: selectedSourceName }
                    )
                };

                setDestroyedItems(prev => {
                    if (!seri && lot) {
                        // Group by lot
                        const existing = prev.find(item => item.key === newItem.key && item.isGroup);
                        if (existing) {
                            return prev.map(item => item.key === newItem.key ? { ...item, adet: item.adet + 1 } : item);
                        }
                    }
                    return [newItem, ...prev];
                });

                addedCount++;
            }

            toast({ title: 'Excel Yüklendi', description: `${addedCount} ürün imha listesine eklendi.` });
        } catch (error) {
            console.error('Excel parse error:', error);
            toast({ title: 'Hata', description: 'Excel dosyası okunamadı.', variant: 'destructive' });
        }
    };

    // Download excel template
    const handleDownloadTemplate = () => {
        const template = [
            { 'stok kodu': '', 'lot': '', 'miad': '', 'seri no': '' }
        ];
        const ws = XLSX.utils.json_to_sheet(template);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'İmha Listesi');
        XLSX.writeFile(wb, 'imha_listesi_sablonu.xlsx');
    };

    // Submit destroyed items
    const handleSubmit = async () => {
        if (destroyedItems.length === 0) {
            toast({ title: 'Liste Boş', description: 'İmha edilecek ürün eklemediniz.', variant: 'destructive' });
            return;
        }

        setSubmitting(true);
        try {
            // STEP 1: Group items by source and collection
            const sourceGroups: Record<string, DestroyedItem[]> = {};
            destroyedItems.forEach(item => {
                const sourceId = item.depotId || item.laboratoryId;
                const sourceType = item.depotId ? 'depot' : 'laboratory';
                const key = `${sourceType}-${sourceId}`;
                if (!sourceGroups[key]) sourceGroups[key] = [];
                sourceGroups[key].push(item);
            });

            // STEP 2: Fetch all stocks in parallel (one query per source)
            const stockQueries = Object.entries(sourceGroups).map(async ([key, items]) => {
                const sourceType = key.startsWith('depot') ? 'depot' : 'laboratory';
                const sourceId = items[0].depotId || items[0].laboratoryId;
                const collectionName = sourceType === 'depot' ? 'depoStok' : 'labStock';
                const idField = sourceType === 'depot' ? 'depotId' : 'laboratoryId';

                // Get unique stock codes for this source
                const uniqueStockCodes = Array.from(new Set(items.map(i => i.stokKodu)));

                // Fetch all relevant stock items for all products
                // Note: Firestore 'in' operator supports max 10 values
                const stockPromises = [];
                for (let i = 0; i < uniqueStockCodes.length; i += 10) {
                    const chunk = uniqueStockCodes.slice(i, i + 10);
                    const q = query(
                        collection(db, collectionName),
                        where(idField, '==', sourceId),
                        where('stokKodu', 'in', chunk),
                        ...(sourceType === 'depot' ? [where('isShipped', '==', false)] : [])
                    );
                    stockPromises.push(getDocs(q));
                }

                const snapshots = await Promise.all(stockPromises);
                const allStockItems = snapshots.flatMap(snap =>
                    snap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem))
                );

                return { key, items, stockItems: allStockItems, sourceType, collectionName };
            });

            const stockResults = await Promise.all(stockQueries);

            // STEP 3: Process deletions and create records
            const batches: any[] = [writeBatch(db)];
            let currentBatchIndex = 0;
            let operationCount = 0;

            for (const { items, stockItems, sourceType, collectionName } of stockResults) {
                for (const item of items) {
                    // Check if we need a new batch (Firestore limit: 500 operations)
                    if (operationCount >= 450) { // Leave some margin
                        currentBatchIndex++;
                        batches.push(writeBatch(db));
                        operationCount = 0;
                    }

                    const currentBatch = batches[currentBatchIndex];

                    // Find matching stock items
                    let toDelete: DepoStokItem[] = [];

                    if (item.seriNumarasi) {
                        // Match by serial
                        toDelete = stockItems.filter(s =>
                            s.stokKodu === item.stokKodu &&
                            s.seriNumarasi === item.seriNumarasi
                        );
                    } else if (item.lotNumarasi && item.isGroup) {
                        // Match by lot
                        const matched = stockItems.filter(s =>
                            s.stokKodu === item.stokKodu &&
                            s.lotNumarasi === item.lotNumarasi
                        );
                        toDelete = matched.slice(0, item.adet);
                    }

                    // Delete stock items
                    toDelete.forEach(stockItem => {
                        currentBatch.delete(doc(db, collectionName, stockItem.id));
                        operationCount++;
                    });

                    // Create destroyed kit record
                    const destroyedKitRef = doc(collection(db, 'destroyedKitsReports'));
                    currentBatch.set(destroyedKitRef, {
                        id: destroyedKitRef.id,
                        ejectedKitRecordId: null,
                        faultReportId: null,
                        laboratoryId: item.laboratoryId || null,
                        laboratoryName: item.laboratoryName || '',
                        depotId: item.depotId || null,
                        depotName: item.depotName || '',
                        deviceId: null,
                        deviceModel: 'Manuel İmha',
                        stokKodu: item.stokKodu,
                        stokAdi: item.stokAdi,
                        lotNumarasi: item.lotNumarasi,
                        miad: item.miad,
                        seriNumarasi: item.seriNumarasi,
                        testCount: item.adet,
                        aciklama: `${item.sourceType === 'barcode' ? 'Barkod ile' : 'Excel ile'} manuel olarak eklendi.`,
                        resolvedAt: serverTimestamp(),
                        resolvedByUid: currentUser?.uid || '',
                        resolvedByName: currentUserProfile?.name || '',
                        sourceType: item.sourceType,
                    });
                    operationCount++;
                }
            }

            // STEP 4: Commit all batches in parallel
            await Promise.all(batches.map(b => b.commit()));

            toast({
                title: 'İmha Tamamlandı',
                description: `${destroyedItems.length} ürün imha edildi ve stoktan düşüldü. (${batches.length} batch işlem)`
            });
            setDestroyedItems([]);
        } catch (error) {
            console.error('Submit error:', error);
            toast({ title: 'Hata', description: 'İmha işlemi sırasında hata oluştu.', variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    };

    // Group destroyed items
    const groupedDestroyedItems = useMemo(() => {
        const groups: Record<string, GroupedDestroyedItem> = {};

        destroyedItems.forEach(item => {
            const groupKey = `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    key: groupKey,
                    stokKodu: item.stokKodu,
                    stokAdi: item.stokAdi,
                    lotNumarasi: item.lotNumarasi || '',
                    miad: item.miad || '',
                    adet: 0,
                    serials: [],
                    sourceType: item.sourceType,
                };
            }
            groups[groupKey].adet += item.adet;
            if (!item.isGroup && item.seriNumarasi) {
                groups[groupKey].serials.push({ id: item.id, seriNumarasi: item.seriNumarasi });
            }
        });

        return Object.values(groups).sort((a, b) => a.stokAdi.localeCompare(b.stokAdi));
    }, [destroyedItems]);

    // Remove item
    const removeDestroyedItem = (itemId: string, isGroup: boolean | undefined) => {
        if (isGroup) {
            setDestroyedItems(prev => prev.filter(item => item.key !== itemId));
        } else {
            setDestroyedItems(prev => prev.filter(item => item.id !== itemId));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="p-4 space-y-4">
            <BackButton fallback="/raporlama" />
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Trash2 className="h-6 w-6 text-destructive" />
                            İmha Edilen Kitler - Giriş
                        </CardTitle>
                        <CardDescription>
                            Barkod okutarak veya excel ile yükleyerek imha işlemlerini gerçekleştirin.
                        </CardDescription>
                    </div>
                    <Button variant="outline" onClick={() => router.push('/raporlama/imha-edilen-kitler/liste')}>
                        <Eye className="mr-2 h-4 w-4" />
                        İmha Olan Kitleri Göster
                    </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Source Selection */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Kaynak Tipi</Label>
                            <Select value={selectedSourceType} onValueChange={(v) => setSelectedSourceType(v as 'depot' | 'laboratory')}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="laboratory">Laboratuvar</SelectItem>
                                    <SelectItem value="depot">Depo</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {selectedSourceType === 'laboratory' && (
                            <div className="space-y-2">
                                <Label>Laboratuvar</Label>
                                <Select value={selectedLabId} onValueChange={setSelectedLabId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Laboratuvar seçin" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {hospitals.map(h => (
                                            <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {selectedSourceType === 'depot' && (
                            <div className="space-y-2">
                                <Label>Depo</Label>
                                <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Depo seçin" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {depots.map(d => (
                                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="flex items-end gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setIsCameraScannerOpen(true)}
                                disabled={!selectedSourceName}
                            >
                                <Camera className="mr-2 h-4 w-4" />
                                Kamera ile Tara
                            </Button>
                        </div>
                    </div>

                    {/* Barcode Format Selection */}
                    <BarcodeFormatSelect
                        value={selectedFormatId || '__auto__'}
                        onChange={v => setSelectedFormatId(v)}
                        disabled={formatsLoading}
                    />

                    {/* Excel Upload */}
                    <div className="space-y-2">
                        <Label>Excel ile Yükleme</Label>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={handleDownloadTemplate}>
                                <Download className="mr-2 h-4 w-4" />
                                Şablon İndir
                            </Button>
                            <label htmlFor="excel-upload">
                                <Button variant="outline" disabled={!selectedSourceName} asChild>
                                    <span>
                                        <Upload className="mr-2 h-4 w-4" />
                                        Excel Yükle
                                    </span>
                                </Button>
                            </label>
                            <input
                                id="excel-upload"
                                type="file"
                                accept=".xlsx,.xls"
                                className="hidden"
                                onChange={handleExcelUpload}
                            />
                        </div>
                    </div>

                    {/* Destroyed Items List */}
                    {destroyedItems.length > 0 && (
                        <>
                            <div className="flex justify-between items-center">
                                <Label>İmha Edilecek Ürünler ({destroyedItems.reduce((sum, item) => sum + item.adet, 0)} Adet)</Label>
                                <Button onClick={handleSubmit} disabled={submitting}>
                                    {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    İmha Et ve Stoktan Düş
                                </Button>
                            </div>

                            <ScrollArea className="h-96 border rounded-md p-2">
                                <Accordion type="multiple" className="w-full">
                                    {groupedDestroyedItems.map(group => (
                                        <AccordionItem value={group.key} key={group.key}>
                                            <AccordionTrigger>
                                                <div className="flex-1 text-left font-medium">
                                                    {group.stokAdi} <span className="text-xs text-muted-foreground">({group.stokKodu})</span>
                                                </div>
                                                <div className="flex-1 text-left text-sm">Lot: {group.lotNumarasi || '-'}</div>
                                                <div className="flex-1 text-left text-sm">Miad: {group.miad || '-'}</div>
                                                <div className="font-bold flex items-center gap-2">
                                                    <span>{group.adet} Adet</span>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeDestroyedItem(group.key, true);
                                                        }}
                                                    >
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </div>
                                            </AccordionTrigger>
                                            <AccordionContent className="p-2 bg-muted/50">
                                                {group.serials.length > 0 ? (
                                                    <ul className="space-y-1">
                                                        {group.serials.map(serial => (
                                                            <li key={serial.id} className="flex justify-between items-center text-xs font-mono">
                                                                {serial.seriNumarasi}
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-6 w-6"
                                                                    onClick={() => removeDestroyedItem(serial.id, false)}
                                                                >
                                                                    <Trash2 className="h-3 w-3 text-destructive" />
                                                                </Button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="text-xs text-muted-foreground">Bu grup manuel olarak eklendi, seri numarası detayı yok.</p>
                                                )}
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </ScrollArea>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Camera Scanner Dialog */}
            <Dialog open={isCameraScannerOpen} onOpenChange={setIsCameraScannerOpen}>
                <DialogContent className="max-w-md p-0">
                    <DialogHeader className="p-4">
                        <DialogTitle>Kamera ile Tara</DialogTitle>
                        <DialogDescription>Barkodu kameranın önüne tutun</DialogDescription>
                    </DialogHeader>
                    {isCameraScannerOpen && (
                        <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /><p>Kamera...</p></div>}>
                            <CameraScanner onScanSuccess={handleCameraScan} onClose={() => setIsCameraScannerOpen(false)} />
                        </Suspense>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
