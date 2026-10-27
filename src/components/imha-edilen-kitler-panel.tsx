'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense, useRef } from 'react';
import dynamic from 'next/dynamic';
import { db } from '../lib/data/client';
import { collection, getDocs, query, where, writeBatch, doc, orderBy, limit, Timestamp, serverTimestamp } from '../lib/data/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Trash2, Upload, Camera, Download, History, ScanLine, FileSpreadsheet, Package, AlertTriangle, ShieldAlert, ClipboardList, Info, X, ChevronDown } from 'lucide-react';
import type { Hospital, Depot, ProductCode, DepoStokItem, DestroyedKitRecord } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { playFeedback, generateId } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LabSelector } from '@/components/common/LabSelector';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import useHidScanner from '@/hooks/useHidScanner';
import BarcodeFormatSelect, { type FormatValue } from '@/components/BarcodeFormatSelect';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import { TrackingMode, resolveDefaultTrackingMode, resolveEffectiveTrackingMode } from '@/lib/tracking';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { appendSerialEvents } from '@/lib/serial-ledger/client';
import type { SerialEventInput } from '@/lib/serial-ledger/core';
import { scopedQuery } from '@/lib/document-helpers';
import * as XLSX from 'xlsx';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

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
    remainingTests?: number;
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
    remainingTests?: number;
    serials: { id: string; seriNumarasi: string; remainingTests?: number }[];
    sourceType: 'barcode' | 'excel';
}

export default function ImhaEdilenKitlerPanel() {
    const { toast } = useToast();
    const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
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

    // Destroyed Items List
    const [destroyedItems, setDestroyedItems] = useState<DestroyedItem[]>([]);

    // Barcode scanning
    const { formats: barcodeFormats, loading: formatsLoading } = useSafeBarcodeFormats();
    const { parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode } = useBarcodeParser();
    const [selectedFormatId, setSelectedFormatId] = useState<FormatValue>('__auto__');
    const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);

    // Remaining tests dialog
    const [isRemainingTestsDialogOpen, setIsRemainingTestsDialogOpen] = useState(false);
    const [pendingItem, setPendingItem] = useState<DestroyedItem | null>(null);
    const [remainingTestsInput, setRemainingTestsInput] = useState<string>('');

    // Scan feedback
    const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const scanFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashScanFeedback = useCallback((type: 'success' | 'error', message: string) => {
        if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
        setScanFeedback({ type, message });
        scanFeedbackTimer.current = setTimeout(() => setScanFeedback(null), 2500);
    }, []);

    // Recent records
    const [recentRecords, setRecentRecords] = useState<DestroyedKitRecord[]>([]);

    // Active input method
    const [activeMethod, setActiveMethod] = useState<'barcode' | 'camera' | 'excel'>('barcode');

    // Excel upload state
    const [excelFileName, setExcelFileName] = useState<string>('');
    const [excelRowCount, setExcelRowCount] = useState<number>(0);

    // Expanded items in list
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

    // Fetch master data + recent records
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [hospitalsSnap, depotsSnap, productsSnap, recentSnap] = await Promise.all([
                    getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
                    getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
                    getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
                    getDocs(scopedQuery('destroyedKitsReports', currentCompanyId, isSuperAdmin, orderBy('resolvedAt', 'desc'), limit(5))),
                ]);

                setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
                setDepots(depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)));
                setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
                setRecentRecords(recentSnap.docs.map(d => {
                    const data = d.data();
                    return { id: d.id, ...data, resolvedAt: (data.resolvedAt as Timestamp)?.toDate() } as DestroyedKitRecord;
                }));
            } catch (error) {
                console.error("Error fetching master data:", error);
                toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [toast]);

    const selectedSourceName = useMemo(() => {
        if (selectedSourceType === 'depot') return depots.find(d => d.id === selectedDepotId)?.name || '';
        return hospitals.find(h => h.id === selectedLabId)?.name || '';
    }, [selectedSourceType, selectedDepotId, selectedLabId, depots, hospitals]);

    const selectedSourceId = selectedSourceType === 'depot' ? selectedDepotId : selectedLabId;

    // Handle remaining tests dialog confirmation
    const handleRemainingTestsConfirm = () => {
        if (!pendingItem) return;

        const remainingTests = remainingTestsInput ? parseInt(remainingTestsInput, 10) : undefined;
        const itemWithRemainingTests = { ...pendingItem, remainingTests };

        if (pendingItem.isGroup) {
            setDestroyedItems(prev => {
                const existing = prev.find(item => item.key === pendingItem.key && item.isGroup);
                if (existing) {
                    return prev.map(item =>
                        item.key === pendingItem.key ? { ...item, adet: item.adet + 1 } : item
                    );
                }
                return [itemWithRemainingTests, ...prev];
            });
        } else {
            setDestroyedItems(prev => [itemWithRemainingTests, ...prev]);
        }

        playFeedback();
        flashScanFeedback('success', `${pendingItem.stokAdi} imha listesine eklendi.`);

        setIsRemainingTestsDialogOpen(false);
        setPendingItem(null);
        setRemainingTestsInput('');
    };

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
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
        return sourceType === 'depot'
            ? filterByCompanyScope(items, currentCompanyId, isSuperAdmin)
            : items;
    }, [currentCompanyId, isSuperAdmin]);

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
        const allItemsRaw = snap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
        const allItems = sourceType === 'depot'
            ? filterByCompanyScope(allItemsRaw, currentCompanyId, isSuperAdmin)
            : allItemsRaw;
        return allItems.filter(item => !item.seriNumarasi || item.seriNumarasi.trim() === '');
    }, [currentCompanyId, isSuperAdmin]);

    // Handle barcode scan
    const handleScan = useCallback(async (raw: string, source: 'hid' | 'camera' = 'hid') => {
        if (!raw) return;

        if (!selectedSourceId) {
            playFeedback(true);
            flashScanFeedback('error', 'Önce bir depo veya laboratuvar seçin.');
            return;
        }

        let resolveResult: ReturnType<typeof parseAndResolveBarcode> = null;
        if (selectedFormatId && selectedFormatId !== '__auto__') {
            const fmt = barcodeFormats.find(f => f.id === selectedFormatId);
            if (fmt) {
              const parsed = parseAnyBarcode(raw, [fmt]);
              if (parsed) {
                const resolved = resolveProductFromParsed(parsed, products);
                resolveResult = { parsed: resolved, product: resolved.product };
              }
            }
        }
        if (!resolveResult || !resolveResult.product) {
            resolveResult = parseAndResolveBarcode(raw, barcodeFormats, products);
        }

        if (!resolveResult || !resolveResult.parsed) {
            playFeedback(true);
            flashScanFeedback('error', 'Barkod tanımlı formatlarla eşleşmiyor.');
            return;
        }

        const resolved = resolveResult.parsed;
        if (!resolveResult.product || !resolved.stokKodu) {
            playFeedback(true);
            flashScanFeedback('error', 'Barkoddan bir ürün çözümlenemedi.');
            return;
        }

        const product = resolveResult.product;
        const stokKodu = product.stokKodu ?? '';
        const stokAdi = product.stokAdi ?? '';
        const lot = resolved.lotNumarasi || '';
        const miad = resolved.miadFormatted || '';
        const seri = resolved.seriNumarasi || '';

        // Check for duplicate serial
        if (seri && destroyedItems.some(item => item.stokKodu === stokKodu && item.seriNumarasi === seri)) {
            playFeedback(true);
            flashScanFeedback('error', `SN ${seri} zaten listeye eklendi.`);
            return;
        }

        const matchedFormat = resolved.matchedFormatId
            ? barcodeFormats.find(f => f.id === resolved.matchedFormatId)
            : undefined;
        const mode: TrackingMode = resolveEffectiveTrackingMode(resolved, matchedFormat, product as any);

        if (mode === 'serial') {
            if (!seri) {
                playFeedback(true);
                flashScanFeedback('error', 'Seri no takipli üründe barkod seri içermiyor.');
                return;
            }

            const items = await countStockBySerial(stokKodu, seri, selectedSourceId, selectedSourceType);
            if (items.length === 0) {
                flashScanFeedback('error', `SN ${seri} stokta bulunamadı. Yine de eklenecek.`);
            }

            const newItem: DestroyedItem = {
                id: generateId(), stokKodu, stokAdi, lotNumarasi: lot, miad, seriNumarasi: seri,
                adet: 1, sourceType: 'barcode', key: generateId(), isGroup: false,
                ...(selectedSourceType === 'depot'
                    ? { depotId: selectedDepotId, depotName: selectedSourceName }
                    : { laboratoryId: selectedLabId, laboratoryName: selectedSourceName })
            };

            const defaultRemainingTests = product.ambalajDegeri || 1;
            setPendingItem(newItem);
            setRemainingTestsInput(String(defaultRemainingTests));
            setIsRemainingTestsDialogOpen(true);
            return;
        }

        if (mode === 'lot_barcode' || mode === 'lot_manual') {
            if (!lot) {
                playFeedback(true);
                flashScanFeedback('error', 'Lot bilgisi gerekli fakat bulunamadı.');
                return;
            }

            const items = await countStockByLot(stokKodu, lot, selectedSourceId, selectedSourceType);
            if (items.length === 0) {
                flashScanFeedback('error', `Lot ${lot} stokta bulunamadı. Yine de eklenecek.`);
            }

            const key = `${stokKodu}__${lot}`;
            const existing = destroyedItems.find(item => item.key === key && item.isGroup);

            if (existing) {
                setDestroyedItems(prev =>
                    prev.map(item => item.key === key ? { ...item, adet: item.adet + 1 } : item)
                );
                playFeedback();
                flashScanFeedback('success', `${stokAdi} (Lot: ${lot}) eklendi.`);
                return;
            }

            const newItem: DestroyedItem = {
                id: generateId(), stokKodu, stokAdi, lotNumarasi: lot, miad, seriNumarasi: '',
                adet: 1, sourceType: 'barcode', key, isGroup: true,
                ...(selectedSourceType === 'depot'
                    ? { depotId: selectedDepotId, depotName: selectedSourceName }
                    : { laboratoryId: selectedLabId, laboratoryName: selectedSourceName })
            };

            const defaultRemainingTests = product.ambalajDegeri || 1;
            setPendingItem(newItem);
            setRemainingTestsInput(String(defaultRemainingTests));
            setIsRemainingTestsDialogOpen(true);
            return;
        }

        // Quantity only mode
        const key = stokKodu;
        const existing = destroyedItems.find(item => item.key === key && item.isGroup);

        if (existing) {
            setDestroyedItems(prev =>
                prev.map(item => item.key === key ? { ...item, adet: item.adet + 1 } : item)
            );
            playFeedback();
            flashScanFeedback('success', `${stokAdi} eklendi.`);
            return;
        }

        const newItem: DestroyedItem = {
            id: generateId(), stokKodu, stokAdi, lotNumarasi: '', miad: '', seriNumarasi: '',
            adet: 1, sourceType: 'barcode', key, isGroup: true,
            ...(selectedSourceType === 'depot'
                ? { depotId: selectedDepotId, depotName: selectedSourceName }
                : { laboratoryId: selectedLabId, laboratoryName: selectedSourceName })
        };

        const defaultRemainingTests = product.ambalajDegeri || 1;
        setPendingItem(newItem);
        setRemainingTestsInput(String(defaultRemainingTests));
        setIsRemainingTestsDialogOpen(true);
    }, [selectedSourceType, selectedDepotId, selectedLabId, selectedSourceId, selectedFormatId, barcodeFormats, products, destroyedItems, parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode, selectedSourceName, countStockBySerial, countStockByLot, flashScanFeedback]);

    useHidScanner({
        enabled: !isRemainingTestsDialogOpen && !isCameraScannerOpen,
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

        if (!selectedSourceId) {
            toast({ title: 'Uyarı', description: 'Önce bir depo veya laboratuvar seçin.', variant: 'destructive' });
            return;
        }

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

            let addedCount = 0;
            for (const row of jsonData) {
                const stokKodu = row['stok kodu'] || row['Stok Kodu'] || row['STOK KODU'];
                const lot = row['lot'] || row['Lot'] || row['LOT'] || '';
                const miad = row['miad'] || row['Miad'] || row['MIAD'] || '';
                const seri = row['seri no'] || row['Seri No'] || row['SERI NO'] || '';
                const kalanTest = row['kalan test'] || row['Kalan Test'] || row['KALAN TEST'] || '';

                if (!stokKodu) continue;

                const product = products.find(p => p.stokKodu === stokKodu);
                if (!product) continue;

                const stokAdi = product.stokAdi ?? '';

                if (seri && destroyedItems.some(item => item.stokKodu === stokKodu && item.seriNumarasi === seri)) continue;

                let remainingTests: number | undefined;
                if (kalanTest) {
                    const parsed = parseInt(String(kalanTest), 10);
                    if (!isNaN(parsed)) remainingTests = parsed;
                } else {
                    remainingTests = product.ambalajDegeri || 1;
                }

                const newItem: DestroyedItem = {
                    id: generateId(), stokKodu, stokAdi, lotNumarasi: lot, miad, seriNumarasi: seri,
                    adet: 1, remainingTests, sourceType: 'excel',
                    key: seri ? generateId() : `${stokKodu}__${lot}`,
                    isGroup: !seri,
                    ...(selectedSourceType === 'depot'
                        ? { depotId: selectedDepotId, depotName: selectedSourceName }
                        : { laboratoryId: selectedLabId, laboratoryName: selectedSourceName })
                };

                setDestroyedItems(prev => {
                    if (!seri && lot) {
                        const existing = prev.find(item => item.key === newItem.key && item.isGroup);
                        if (existing) {
                            return prev.map(item => item.key === newItem.key ? { ...item, adet: item.adet + 1 } : item);
                        }
                    }
                    return [newItem, ...prev];
                });

                addedCount++;
            }

            setExcelFileName(file.name);
            setExcelRowCount(addedCount);
            flashScanFeedback('success', `${addedCount} ürün excel'den eklendi.`);
        } catch (error) {
            console.error('Excel parse error:', error);
            toast({ title: 'Hata', description: 'Excel dosyası okunamadı.', variant: 'destructive' });
        }

        // Reset file input
        event.target.value = '';
    };

    const handleDownloadTemplate = () => {
        const template = [
            { 'stok kodu': 'ÖRNEK-001', 'lot': '123456', 'miad': '31.12.2026', 'seri no': 'SN001', 'kalan test': '100' },
            { 'stok kodu': '', 'lot': '', 'miad': '', 'seri no': '', 'kalan test': '' }
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
            const sourceGroups: Record<string, DestroyedItem[]> = {};
            destroyedItems.forEach(item => {
                const sourceId = item.depotId || item.laboratoryId;
                const sourceType = item.depotId ? 'depot' : 'laboratory';
                const key = `${sourceType}-${sourceId}`;
                if (!sourceGroups[key]) sourceGroups[key] = [];
                sourceGroups[key].push(item);
            });

            const stockQueries = Object.entries(sourceGroups).map(async ([key, items]) => {
                const sourceType = key.startsWith('depot') ? 'depot' : 'laboratory';
                const sourceId = items[0].depotId || items[0].laboratoryId;
                const collectionName = sourceType === 'depot' ? 'depoStok' : 'labStock';
                const idField = sourceType === 'depot' ? 'depotId' : 'laboratoryId';

                const uniqueStockCodes = Array.from(new Set(items.map(i => i.stokKodu)));

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
                const rawStockItems = snapshots.flatMap(snap =>
                    snap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem))
                );
                const allStockItems = sourceType === 'depot'
                    ? filterByCompanyScope(rawStockItems, currentCompanyId, isSuperAdmin)
                    : rawStockItems;

                return { key, items, stockItems: allStockItems, sourceType, collectionName };
            });

            const stockResults = await Promise.all(stockQueries);

            const batches: any[] = [writeBatch(db)];
            let currentBatchIndex = 0;
            let operationCount = 0;
            /** Seri No Defteri olayları — stok yazımından sonra parçalı yazılır. */
            const ledgerEvents: SerialEventInput[] = [];

            for (const { items, stockItems, sourceType, collectionName } of stockResults) {
                for (const item of items) {
                    if (operationCount >= 450) {
                        currentBatchIndex++;
                        batches.push(writeBatch(db));
                        operationCount = 0;
                    }

                    const currentBatch = batches[currentBatchIndex];
                    let toDelete: DepoStokItem[] = [];

                    if (item.seriNumarasi) {
                        toDelete = stockItems.filter(s =>
                            s.stokKodu === item.stokKodu && s.seriNumarasi === item.seriNumarasi
                        );
                    } else if (item.lotNumarasi && item.isGroup) {
                        const matched = stockItems.filter(s =>
                            s.stokKodu === item.stokKodu && s.lotNumarasi === item.lotNumarasi
                        );
                        toDelete = matched.slice(0, item.adet);
                    }

                    toDelete.forEach(stockItem => {
                        currentBatch.delete(doc(db, collectionName, stockItem.id));
                        operationCount++;
                    });

                    const destroyedKitRef = doc(collection(db, 'destroyedKitsReports'));
                    currentBatch.set(destroyedKitRef, withCompanyScope({
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
                        remainingTests: item.remainingTests,
                        aciklama: `${item.sourceType === 'barcode' ? 'Barkod ile' : 'Excel ile'} manuel olarak eklendi.`,
                        resolvedAt: serverTimestamp(),
                        resolvedByUid: currentUser?.uid || '',
                        resolvedByName: currentUserProfile?.name || '',
                        sourceType: item.sourceType,
                    }, currentCompanyId));
                    operationCount++;

                    // Seri No Defteri: imha, birimin son işlemidir. Aynı seri
                    // numarası sayımla serbest bırakılmadıkça yeniden mal kabul
                    // edilemez. Olaylar stok yazımından sonra parçalı yazılır ki
                    // toplu imhada 500 işlem sınırı aşılmasın.
                    if (item.seriNumarasi) {
                        ledgerEvents.push({
                            type: 'imha',
                            stokKodu: item.stokKodu,
                            stokAdi: item.stokAdi,
                            seriNumarasi: item.seriNumarasi,
                            lotNumarasi: item.lotNumarasi || '',
                            miad: typeof item.miad === 'string' ? item.miad : '',
                            source: sourceType === 'depot'
                                ? { locationType: 'depot', locationId: item.depotId || '', locationName: item.depotName || '' }
                                : { locationType: 'lab', locationId: item.laboratoryId || '', locationName: item.laboratoryName || '' },
                            refs: { destroyedKitReportId: destroyedKitRef.id },
                            actorUid: currentUser?.uid || null,
                            actorName: currentUserProfile?.name || null,
                            details: { remainingTests: item.remainingTests, sourceType: item.sourceType },
                        });
                    }
                }
            }

            await Promise.all(batches.map(b => b.commit()));

            // Defter yazımı imha yazımından sonra gelir; hata hâlinde imha geri
            // alınmaz. Defter türetilmiş bir dizindir ve yönetim panelindeki
            // doldurma aracıyla yeniden kurulabilir.
            try {
                await appendSerialEvents(ledgerEvents, currentCompanyId);
            } catch (ledgerError) {
                console.error('[İmha] Seri No Defteri güncellenemedi:', ledgerError);
            }

            toast({
                title: 'İmha Tamamlandı',
                description: `${destroyedItems.reduce((s, i) => s + i.adet, 0)} adet ürün imha edildi ve stoktan düşüldü.`
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
                    key: groupKey, stokKodu: item.stokKodu, stokAdi: item.stokAdi,
                    lotNumarasi: item.lotNumarasi || '', miad: item.miad || '',
                    adet: 0, remainingTests: item.remainingTests,
                    serials: [], sourceType: item.sourceType,
                };
            }
            groups[groupKey].adet += item.adet;
            if (!item.isGroup && item.seriNumarasi) {
                groups[groupKey].serials.push({
                    id: item.id, seriNumarasi: item.seriNumarasi, remainingTests: item.remainingTests
                });
            }
        });
        return Object.values(groups).sort((a, b) => a.stokAdi.localeCompare(b.stokAdi));
    }, [destroyedItems]);

    const totalItemCount = destroyedItems.reduce((sum, item) => sum + item.adet, 0);

    const removeDestroyedItem = (itemId: string, isGroup: boolean | undefined) => {
        if (isGroup) {
            setDestroyedItems(prev => prev.filter(item => item.key !== itemId));
        } else {
            setDestroyedItems(prev => prev.filter(item => item.id !== itemId));
        }
    };

    const toggleExpand = (key: string) => {
        setExpandedItems(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    if (loading) {
        return (
            <div className="cihaz-shell flex items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
            </div>
        );
    }

    return (
        <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 sm:space-y-5 min-h-screen">
            {/* ══════════════════════ HEADER ══════════════════════ */}
            <div className="flex items-center gap-3">
                <BackButton fallback="/raporlama" aria-label="Geri dön" />
                <div className="flex-1 min-w-0">
                    <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)] flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-red-500" />
                        İmha Kaydı
                    </h1>
                    <p className="text-[11px] sm:text-xs text-[var(--dashboard-muted)] truncate">
                        {selectedSourceName ? `${selectedSourceName}` : 'Kaynak seçin'} · Kritik işlem · Log tutulur · Stoktan düşülür
                    </p>
                </div>
                <button
                    onClick={() => router.push('/raporlama/imha-edilen-kitler/liste')}
                    className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium"
                >
                    <History className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">İmha Geçmişi</span>
                </button>
            </div>

            {/* ══════════════════════ MAIN CONTENT ══════════════════════ */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
                {/* ── LEFT COLUMN: İşlem Ayarları + Yöntem ── */}
                <div className="space-y-4">
                    {/* İşlem Ayarları Card */}
                    <div className="cihaz-card p-4 sm:p-5 space-y-4">
                        <p className="cihaz-overline text-[10px] sm:text-xs">İşlem Ayarları</p>

                        {/* Kaynak Tipi */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Kaynak Tipi</label>
                            <Select value={selectedSourceType} onValueChange={(v) => setSelectedSourceType(v as 'depot' | 'laboratory')}>
                                <SelectTrigger className="cihaz-pressed border-none h-10">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="laboratory">Laboratuvar</SelectItem>
                                    <SelectItem value="depot">Depo</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Kaynak Seçimi */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">
                                {selectedSourceType === 'laboratory' ? 'Laboratuvar' : 'Depo'}
                            </label>
                            {selectedSourceType === 'laboratory' ? (
                                <LabSelector
                                    labs={hospitals.map(h => ({ id: h.id, name: h.name, kod: h.kod }))}
                                    value={selectedLabId}
                                    onChange={setSelectedLabId}
                                    placeholder="Laboratuvar seçin"
                                />
                            ) : (
                                <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
                                    <SelectTrigger className="cihaz-pressed border-none h-10">
                                        <SelectValue placeholder="Depo seçin" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        {/* Barkod Formatı */}
                        <div className="space-y-1.5">
                            <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Barkod Formatı</label>
                            <BarcodeFormatSelect
                                value={selectedFormatId || '__auto__'}
                                onChange={v => setSelectedFormatId(v)}
                                disabled={formatsLoading}
                            />
                            <p className="text-[10px] text-[var(--dashboard-muted)]">Okutulan barkod aktif format tanımlarına göre otomatik çözülür.</p>
                        </div>
                    </div>

                    {/* Giriş Yöntemi Card */}
                    <div className="cihaz-card-strong p-4 sm:p-5 space-y-3">
                        <p className="cihaz-overline text-[10px] sm:text-xs">Giriş Yöntemi</p>

                        <div className="grid grid-cols-3 gap-2">
                            <button
                                onClick={() => setActiveMethod('barcode')}
                                className={cn(
                                    "cihaz-action-tile flex flex-col items-center justify-center gap-1.5 py-3 text-center",
                                    activeMethod === 'barcode' && "ring-2 ring-[var(--dashboard-accent)]"
                                )}
                            >
                                <ScanLine className="h-5 w-5 text-[var(--dashboard-accent)]" />
                                <span className="text-[10px] sm:text-xs font-medium text-[var(--dashboard-text)]">Barkod</span>
                            </button>
                            <button
                                onClick={() => { setActiveMethod('camera'); setIsCameraScannerOpen(true); }}
                                className={cn(
                                    "cihaz-action-tile flex flex-col items-center justify-center gap-1.5 py-3 text-center",
                                    activeMethod === 'camera' && "ring-2 ring-[var(--dashboard-accent)]"
                                )}
                            >
                                <Camera className="h-5 w-5 text-[var(--dashboard-accent)]" />
                                <span className="text-[10px] sm:text-xs font-medium text-[var(--dashboard-text)]">Kamera</span>
                            </button>
                            <button
                                onClick={() => setActiveMethod('excel')}
                                className={cn(
                                    "cihaz-action-tile flex flex-col items-center justify-center gap-1.5 py-3 text-center",
                                    activeMethod === 'excel' && "ring-2 ring-[var(--dashboard-accent)]"
                                )}
                            >
                                <FileSpreadsheet className="h-5 w-5 text-[var(--dashboard-accent)]" />
                                <span className="text-[10px] sm:text-xs font-medium text-[var(--dashboard-text)]">Excel</span>
                            </button>
                        </div>

                        {/* Dynamic content based on method */}
                        {activeMethod === 'barcode' && (
                            <div className={cn(
                                "p-3 rounded-xl transition-all duration-300",
                                scanFeedback?.type === 'success' ? "ring-2 ring-green-500/60 bg-green-50/60 dark:bg-green-950/20"
                                : scanFeedback?.type === 'error' ? "ring-2 ring-red-500/60 bg-red-50/60 dark:bg-red-950/20"
                                : "cihaz-pressed"
                            )}>
                                <div className="flex items-center justify-between mb-1">
                                    <p className="text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Barkod Okutun</p>
                                    {scanFeedback && (
                                        <span className={cn(
                                            "text-[10px] font-bold uppercase tracking-wide",
                                            scanFeedback.type === 'success' ? "text-green-600" : "text-red-600"
                                        )}>
                                            {scanFeedback.type === 'success' ? '✓ Başarılı' : '✗ Hata'}
                                        </span>
                                    )}
                                </div>
                                {scanFeedback ? (
                                    <p className={cn(
                                        "text-sm font-semibold truncate",
                                        scanFeedback.type === 'success' ? "text-green-700 dark:text-green-400" : "text-red-600"
                                    )}>
                                        {scanFeedback.message}
                                    </p>
                                ) : (
                                    <p className="text-xs text-[var(--dashboard-muted)]">
                                        {selectedSourceId ? 'HID tarayıcı ile barkod okutun...' : 'Önce kaynak seçin'}
                                    </p>
                                )}
                            </div>
                        )}

                        {activeMethod === 'excel' && (
                            <div className="space-y-3">
                                <div className="cihaz-pressed p-3 rounded-xl space-y-2">
                                    <p className="text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Toplu İmha Girişi</p>
                                    <p className="text-xs text-[var(--dashboard-muted)]">Excel ile birden fazla ürünü tek seferde imha kaydı olarak ekleyin.</p>
                                    <div className="flex gap-2 pt-1">
                                        <button onClick={handleDownloadTemplate} className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium">
                                            <Download className="h-3.5 w-3.5" />
                                            Şablon İndir
                                        </button>
                                        <label htmlFor="excel-upload-redesign">
                                            <span className={cn(
                                                "cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer",
                                                !selectedSourceId && "opacity-40 cursor-not-allowed"
                                            )}>
                                                <Upload className="h-3.5 w-3.5" />
                                                Dosya Seç
                                            </span>
                                        </label>
                                        <input
                                            id="excel-upload-redesign"
                                            type="file"
                                            accept=".xlsx,.xls"
                                            className="hidden"
                                            onChange={handleExcelUpload}
                                            disabled={!selectedSourceId}
                                        />
                                    </div>
                                </div>
                                {excelFileName && (
                                    <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 text-xs">
                                        <FileSpreadsheet className="h-3.5 w-3.5" />
                                        <span className="font-medium">{excelFileName}</span>
                                        <span className="text-[var(--dashboard-muted)]">· {excelRowCount} satır eklendi</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeMethod === 'camera' && (
                            <div className="cihaz-pressed p-3 rounded-xl">
                                <p className="text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Kamera Tarama</p>
                                <p className="text-xs text-[var(--dashboard-muted)] mt-1">Kamera tarayıcı penceresini açmak için yukarıdaki butona tıklayın.</p>
                                <button
                                    onClick={() => setIsCameraScannerOpen(true)}
                                    disabled={!selectedSourceId}
                                    className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium mt-2 disabled:opacity-40"
                                >
                                    <Camera className="h-3.5 w-3.5" />
                                    Kamerayı Aç
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Son İşlemler - Mini Panel */}
                    {recentRecords.length > 0 && (
                        <div className="cihaz-card p-4 sm:p-5 space-y-3">
                            <p className="cihaz-overline text-[10px] sm:text-xs">Son 5 İmha İşlemi</p>
                            <div className="space-y-2">
                                {recentRecords.map((r, idx) => {
                                    const resolvedDate = r.resolvedAt instanceof Date ? r.resolvedAt : new Date(r.resolvedAt);
                                    return (
                                        <div key={r.id || idx} className="flex items-center gap-3 py-1.5 border-b border-[var(--dashboard-stroke)] last:border-0">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium text-[var(--dashboard-text)] truncate">{r.stokAdi}</p>
                                                <p className="text-[10px] text-[var(--dashboard-muted)]">
                                                    {r.laboratoryName || r.depotName || '-'} · {r.sourceType === 'fault' ? 'Arıza' : 'Manuel'}
                                                </p>
                                            </div>
                                            <span className="text-xs font-semibold text-[var(--dashboard-accent)]">{r.testCount}</span>
                                            <span className="text-[10px] text-[var(--dashboard-muted)] whitespace-nowrap">
                                                {resolvedDate ? format(resolvedDate, 'dd.MM HH:mm', { locale: tr }) : '-'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── RIGHT COLUMN: İmha Listesi ── */}
                <div className="cihaz-card-strong flex flex-col overflow-hidden">
                    {/* List Header */}
                    <div className="flex items-center gap-3 px-4 py-3 sm:px-5 border-b border-[var(--dashboard-stroke)]">
                        <div className="flex-1 min-w-0">
                            <h2 className="text-sm sm:text-base font-semibold text-[var(--dashboard-text)]">
                                İmha Listesi
                            </h2>
                            <p className="text-[10px] text-[var(--dashboard-muted)]">Stoktan düşülecek ürünler</p>
                        </div>
                        {totalItemCount > 0 && (
                            <div className="flex items-center gap-3">
                                <div className="text-right">
                                    <span className="text-2xl font-bold text-[var(--dashboard-accent)]">{totalItemCount}</span>
                                    <span className="text-xs text-[var(--dashboard-muted)] ml-1">adet</span>
                                </div>
                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || totalItemCount === 0}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all",
                                        "disabled:opacity-40 disabled:cursor-not-allowed",
                                        "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-lg shadow-red-600/30"
                                    )}
                                >
                                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                                    <ShieldAlert className="h-4 w-4" />
                                    İmha Et
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Table header */}
                    {groupedDestroyedItems.length > 0 && (
                        <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_80px_80px_40px] gap-1 px-4 sm:px-5 py-2 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)]">
                            <span>Ürün</span>
                            <span>Lot</span>
                            <span>Miad</span>
                            <span className="text-right">Kalan Test</span>
                            <span className="text-right">Adet</span>
                            <span></span>
                        </div>
                    )}

                    {/* List body */}
                    <div className="flex-1 overflow-y-auto" style={{ maxHeight: '60vh' }}>
                        {groupedDestroyedItems.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[40vh] text-center px-4">
                                <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                                    <Package className="h-6 w-6 text-[var(--dashboard-muted)]" />
                                </div>
                                <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">İmha listesi boş</p>
                                <p className="text-xs text-[var(--dashboard-muted)]">Barkod okutun, kamera ile tarayın veya Excel yükleyin</p>
                            </div>
                        ) : (
                            <div>
                                {groupedDestroyedItems.map(group => (
                                    <div key={group.key} className="border-b border-[var(--dashboard-stroke)] last:border-0">
                                        {/* Desktop row */}
                                        <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_80px_80px_40px] gap-1 items-center px-4 sm:px-5 py-2.5 hover:bg-[var(--dashboard-surface-2)] transition-colors">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-[var(--dashboard-text)] truncate">{group.stokAdi}</p>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-[var(--dashboard-muted)] font-mono">{group.stokKodu}</span>
                                                    <span className={cn(
                                                        "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium",
                                                        group.sourceType === 'excel' ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                    )}>
                                                        {group.sourceType === 'excel' ? 'Excel' : 'Barkod'}
                                                    </span>
                                                </div>
                                            </div>
                                            <span className="text-xs text-[var(--dashboard-text)]">{group.lotNumarasi || '-'}</span>
                                            <span className="text-xs text-[var(--dashboard-text)]">{group.miad || '-'}</span>
                                            <span className="text-xs text-right text-[var(--dashboard-muted)]">
                                                {group.remainingTests !== undefined ? group.remainingTests : '-'}
                                            </span>
                                            <span className="text-sm font-bold text-right text-[var(--dashboard-accent)]">{group.adet}</span>
                                            <div className="flex justify-end">
                                                <button
                                                    onClick={() => removeDestroyedItem(group.key, true)}
                                                    className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Mobile row */}
                                        <div className="sm:hidden px-4 py-3">
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-[var(--dashboard-text)] truncate">{group.stokAdi}</p>
                                                    <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">{group.stokKodu}</p>
                                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                                        {group.lotNumarasi && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-800">
                                                                Lot: {group.lotNumarasi}
                                                            </span>
                                                        )}
                                                        {group.miad && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800">
                                                                SKT: {group.miad}
                                                            </span>
                                                        )}
                                                        <span className={cn(
                                                            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
                                                            group.sourceType === 'excel' ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                                                        )}>
                                                            {group.sourceType === 'excel' ? 'Excel' : 'Barkod'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg font-bold text-[var(--dashboard-accent)]">{group.adet}</span>
                                                    <button
                                                        onClick={() => removeDestroyedItem(group.key, true)}
                                                        className="p-1.5 rounded-lg hover:bg-red-100"
                                                    >
                                                        <Trash2 className="h-4 w-4 text-red-500" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Expandable serial details */}
                                        {group.serials.length > 0 && (
                                            <>
                                                <button
                                                    onClick={() => toggleExpand(group.key)}
                                                    className="w-full px-5 py-1 text-[10px] text-[var(--dashboard-muted)] hover:bg-[var(--dashboard-surface-2)] flex items-center gap-1"
                                                >
                                                    <ChevronDown className={cn("h-3 w-3 transition-transform", expandedItems.has(group.key) && "rotate-180")} />
                                                    {group.serials.length} seri no
                                                </button>
                                                {expandedItems.has(group.key) && (
                                                    <div className="px-5 pb-2 space-y-1">
                                                        {group.serials.map(serial => (
                                                            <div key={serial.id} className="flex items-center justify-between py-1 px-2 rounded-lg bg-[var(--dashboard-surface-2)] text-xs">
                                                                <span className="font-mono text-[var(--dashboard-text)]">
                                                                    {serial.seriNumarasi}
                                                                    {serial.remainingTests !== undefined && (
                                                                        <span className="ml-2 text-[var(--dashboard-muted)]">({serial.remainingTests} test)</span>
                                                                    )}
                                                                </span>
                                                                <button onClick={() => removeDestroyedItem(serial.id, false)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30">
                                                                    <Trash2 className="h-3 w-3 text-red-500" />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ══════════════════════ MODALS ══════════════════════ */}

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

            {/* Remaining Tests Dialog */}
            <Dialog open={isRemainingTestsDialogOpen} onOpenChange={setIsRemainingTestsDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Kalan Test Adeti</DialogTitle>
                        <DialogDescription>
                            {pendingItem?.stokAdi} için kalan test adedini girin
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {pendingItem && (
                            <div className="p-3 rounded-xl bg-[var(--dashboard-surface-2)] text-xs space-y-1">
                                <p className="font-medium text-[var(--dashboard-text)]">{pendingItem.stokAdi}</p>
                                {pendingItem.lotNumarasi && <p className="text-[var(--dashboard-muted)]">Lot: {pendingItem.lotNumarasi}</p>}
                                {pendingItem.seriNumarasi && <p className="text-[var(--dashboard-muted)]">Seri: {pendingItem.seriNumarasi}</p>}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-[var(--dashboard-text)]">Kalan Test Adeti</label>
                            <Input
                                type="number"
                                min="0"
                                value={remainingTestsInput}
                                onChange={(e) => setRemainingTestsInput(e.target.value)}
                                placeholder="Test adedini girin"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); handleRemainingTestsConfirm(); }
                                }}
                                autoFocus
                                className="h-10"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => {
                            setIsRemainingTestsDialogOpen(false);
                            setPendingItem(null);
                            setRemainingTestsInput('');
                        }}>
                            İptal
                        </Button>
                        <Button onClick={handleRemainingTestsConfirm} className="bg-red-600 hover:bg-red-700 text-white">
                            Onayla ve Ekle
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
