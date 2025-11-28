
'use client';

import React, { useCallback, useEffect, useMemo, useState, Suspense, ChangeEvent } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { Depot, DepoStokItem, ProductCode, Hospital, ConsumptionRecord, ManualProductOption } from '@/lib/types';
import type { BarcodeFormat, ParsedGeneric } from '@/lib/barcode';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  writeBatch,
  doc,
  Timestamp,
  addDoc,
  setDoc,
  serverTimestamp,
  type Firestore,
  where,
  onSnapshot,
  limit,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Loader2, Camera, Truck, Plus, CheckCircle2, History, DatabaseZap, ChevronsUpDown, Check, Trash2, AlertTriangle } from 'lucide-react';
import { TrackingMode, resolveDefaultTrackingMode } from '@/lib/tracking';
import useHidScanner from '@/hooks/useHidScanner';
import BarcodeFormatSelect, { type FormatValue } from '@/components/BarcodeFormatSelect';
import { cn, playFeedback, sanitizeGS1, generateId } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { compareAsc, parse as parseDate } from 'date-fns';
import BackButton from '@/components/BackButton';
import ManualInlineAdder from '@/components/direkt-transfer/ManualInlineAdder';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { autoPrintTutanakFromTransferId, isAutoTutanakEnabled } from '@/lib/tutanak-autoprint';
import { emitFefoOverride } from '@/lib/notifications';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { updateHospitalLastTransferDates } from '@/actions/stokActions';


const CameraScanner = dynamic(() => import('@/components/camera-barcode-scanner'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /><span className="ml-2">Kamera Yükleniyor...</span></div>,
});

type TransferRow = DepoStokItem & {
  key: string;
  adet: number;
  isGroup?: boolean;
};

type FefoViolation = {
  scannedItem: DepoStokItem;
  recommendedItem: DepoStokItem;
};


// YENİ EKLENEN YARDIMCI FONKSİYON:
// Tüm depoyu indirmek yerine, sadece listedeki ürünlerin stok kodlarını sorgular.
const checkFefoOptimized = async (itemsToShip: DepoStokItem[], depotId: string): Promise<FefoViolation[]> => {
  const violations: FefoViolation[] = [];
  
  // Transfer listesindeki benzersiz stok kodlarını bul
  const uniqueStokKodlari = Array.from(new Set(itemsToShip.map(i => i.stokKodu)));

  // Her bir stok kodu için paralel sorgu at (Tüm depo yerine parça parça sorgu)
  await Promise.all(uniqueStokKodlari.map(async (kod) => {
    // Bu ürün kodu için depodaki tüm mevcut stoğu çek
    const q = query(
      collection(db, 'depoStok'), 
      where('depotId', '==', depotId), 
      where('stokKodu', '==', kod), 
      where('isShipped', '==', false)
    );
    const snap = await getDocs(q);
    const productStockInDepot = snap.docs.map(d => ({id: d.id, ...d.data()} as DepoStokItem));

    // Bu stok kodu için transfer edilecek item'ları bul
    const shipItemsForThisCode = itemsToShip.filter(i => i.stokKodu === kod);

    // FEFO Kontrol Mantığı (Date-fns ile tarih karşılaştırma)
    for (const item of shipItemsForThisCode) {
      try {
        const itemDate = parseDate(item.miad as string, 'dd.MM.yyyy', new Date());
        
        // Depodaki, transfer listesinde OLMAYAN ve miadı daha eski olan ürünleri bul
        const earlierItems = productStockInDepot.filter(s => {
          // Kendisi veya transfer listesindeki başka bir item olmamalı
          const isBeingShipped = itemsToShip.some(shipped => shipped.id === s.id);
          if (isBeingShipped) return false;

          // Tarih kontrolü
          const stockDate = parseDate(s.miad as string, 'dd.MM.yyyy', new Date());
          // Stoktaki tarih < Transfer edilen tarih ise violation vardır
          return compareAsc(stockDate, itemDate) < 0;
        });

        if (earlierItems.length > 0) {
          // En eski tarihli olanı öneri olarak ekle
          earlierItems.sort((a, b) => compareAsc(
            parseDate(a.miad as string, 'dd.MM.yyyy', new Date()), 
            parseDate(b.miad as string, 'dd.MM.yyyy', new Date())
          ));
          
          violations.push({ scannedItem: item, recommendedItem: earlierItems[0] });
        }
      } catch (e) {
        console.warn("Tarih parslama hatası, FEFO atlanıyor:", item.stokKodu);
      }
    }
  }));

  return violations;
};


export default function DirektTransferPanel() {
  const { toast } = useToast();
  const { currentUser, currentUserProfile } = useAuth();
  const router = useRouter();

  const [depots, setDepots] = useState<Depot[]>([]);
  const [products, setProducts] = useState<ProductCode[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [borcDepots, setBorcDepots] = useState<Depot[]>([]);
  const [prereqsLoading, setPrereqsLoading] = useState(true);

  const { formats: barcodeFormats, loading: formatsLoading } = useSafeBarcodeFormats();
  const { parseAnyBarcode, resolveProductFromParsed } = useBarcodeParser();
  
  const [productTracking, setProductTracking] = useState<Record<string, TrackingMode>>({});
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [isBorcMode, setIsBorcMode] = useState<boolean>(false);
  const [selectedBorcDepotId, setSelectedBorcDepotId] = useState<string>('');
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [directTransferItems, setDirectTransferItems] = useState<TransferRow[]>([]);
  const [shipmentLoading, setShipmentLoading] = useState<boolean>(false);
  const [lastTransferCount, setLastTransferCount] = useState<number>(0);

  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [isBatchScanning, setIsBatchScanning] = useState(false);
  const [showManualInline, setShowManualInline] = useState(false);
  
  const [selectedFormatId, setSelectedFormatId] = useState<FormatValue>('__auto__');
  const [isLabPopoverOpen, setIsLabPopoverOpen] = useState(false);
  
  const [fefoViolations, setFefoViolations] = useState<FefoViolation[]>([]);
  
  const selectedLabName = useMemo(() => hospitals.find(l => l.id === selectedLabId)?.name || '', [hospitals, selectedLabId]);
  
  const fetchPrerequisites = useCallback(async () => {
    setPrereqsLoading(true);
    try {
      const [depotSnap, productSnap, hospitalSnap, borcSnap] = await Promise.all([
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'borcDepots')),
      ]);

      const depotList = depotSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
      setDepots(depotList);
      setProducts(productSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
      setHospitals(hospitalSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
      setBorcDepots(borcSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)));

      if (depotList.length > 0 && !selectedDepotId) {
          setSelectedDepotId(depotList[0].id);
      }

    } catch (e: any) {
      console.error('[DirektTransfer] Prereqs failed:', e);
      toast({ title: "Veri Hatası", description: `Ön veriler yüklenemedi: ${e.message}`, variant: "destructive" });
    } finally {
      setPrereqsLoading(false);
    }
  }, [selectedDepotId, toast]);

  useEffect(() => {
    fetchPrerequisites();
  }, [fetchPrerequisites]);


  useEffect(() => {
    const trackingMap: Record<string, TrackingMode> = {};
    const nameMap: Record<string, string> = {};
    products.forEach(p => {
      if (p.stokKodu) {
          nameMap[p.stokKodu] = p.stokAdi || p.stokKodu;
          if ((p as any).trackingMode) trackingMap[p.stokKodu] = (p as any).trackingMode as TrackingMode;
      }
    });
    setProductTracking(trackingMap);
    setProductNames(nameMap);
  }, [products]);
  
  const upsertGroupedRow = useCallback((partial: Partial<TransferRow>, inc = 1) => {
    const k = `${partial.stokKodu}__${partial.lotNumarasi || ''}`;
    setDirectTransferItems(prev => {
      const i = prev.findIndex(r => r.key === k);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], adet: copy[i].adet + inc };
        return copy;
      }
      const row: TransferRow = {
        key: k,
        stokKodu: partial.stokKodu!,
        stokAdi: partial.stokAdi!,
        lotNumarasi: partial.lotNumarasi || '',
        miad: partial.miad || '',
        seriNumarasi: partial.seriNumarasi || '',
        adet: inc,
        isGroup: true,
      } as TransferRow;
      return [row, ...prev];
    });
  }, []);

  const addDirectTransferItem = useCallback((itemToAdd: DepoStokItem) => {
    setDirectTransferItems(prevItems => {
        if (prevItems.some(item => item.id === itemToAdd.id)) {
            toast({ title: 'Uyarı', description: 'Bu seri numarası zaten listeye eklendi.', variant: 'default' });
            return prevItems;
        }
        return [{...itemToAdd, adet: 1, key: itemToAdd.id, isGroup: false}, ...prevItems];
    });
    toast({ title: "Ürün Eklendi", description: `${itemToAdd.stokAdi} transfer listesine eklendi.`});
  }, [toast]);

  const depotName = useMemo(() => depots.find(d => d.id === selectedDepotId)?.name || '', [depots, selectedDepotId]);

  const countStockBySerial = useCallback(async (serial: string): Promise<DepoStokItem[]> => {
      if (!selectedDepotId) return [];
      const q = query(collection(db, 'depoStok'), where('depotId', '==', selectedDepotId), where('isShipped', '==', false), where('seriNumarasi', '==', serial));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({id: d.id, ...d.data()} as DepoStokItem));
  }, [selectedDepotId]);

  const countStockByLot = useCallback(async (stokKodu: string, lot: string): Promise<DepoStokItem[]> => {
      if (!selectedDepotId) return [];
      const q = query(collection(db, 'depoStok'), where('depotId', '==', selectedDepotId), where('isShipped', '==', false), where('stokKodu', '==', stokKodu), where('lotNumarasi', '==', lot));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({id: d.id, ...d.data()} as DepoStokItem));
  }, [selectedDepotId]);

  const countStockByCode = useCallback(async (stokKodu: string): Promise<DepoStokItem[]> => {
      if (!selectedDepotId) return [];
      const q = query(collection(db, 'depoStok'), where('depotId', '==', selectedDepotId), where('isShipped', '==', false), where('stokKodu', '==', stokKodu));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({id: d.id, ...d.data()} as DepoStokItem));
  }, [selectedDepotId]);

  const alreadyQueued = useCallback((stokKodu: string, lot?: string, seri?: string) => {
    return directTransferItems
      .filter(r => r.stokKodu === stokKodu && (lot ? r.lotNumarasi === lot : !r.lotNumarasi) && (seri ? r.seriNumarasi === seri : true))
      .reduce((n, r) => n + (r.adet ?? 1), 0);
  }, [directTransferItems]);
  
  const handleScan = useCallback(
    async (raw: string, source: 'hid' | 'camera' | 'manual' = 'hid') => {
      if (!raw) return;
      
      let parsed: ParsedGeneric | null = null;
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
      
      if (parsed.seriNumarasi && directTransferItems.some(item => item.seriNumarasi === parsed.seriNumarasi)) {
          playFeedback(true);
          toast({ title: 'Uyarı', description: 'Bu seri numarası zaten listeye eklendi.', variant: 'default' });
          return;
      }

      const resolved = resolveProductFromParsed(parsed, products);
      if (!resolved.product || !resolved.stokKodu) {
        playFeedback(true);
        toast({ title: 'Ürün Bulunamadı', description: 'Barkoddan bir ürün çözümlenemedi.', variant: 'destructive' });
        return;
      }
      const { product } = resolved;
      const stokKodu = product.stokKodu!;
      const stokAdi = product.stokAdi!;
      const lot = resolved.lotNumarasi || '';
      const miad = resolved.miadFormatted || '';
      const seri = resolved.seriNumarasi || '';

      const mode: TrackingMode = resolveDefaultTrackingMode(product as any);

      if (mode === 'serial') {
        if (!seri) {
          playFeedback(true);
          toast({ title: 'Seri Eksik', description: 'Seri no takipli üründe barkod seri içermiyor.', variant: 'destructive' });
          return;
        }
        const items = await countStockBySerial(seri);
        if (items.length === 0) {
          playFeedback(true);
          toast({ title: 'Depoda Bulunamadı', description: `Seri No ${seri} bu depoda yok.`, variant: 'destructive' });
          return;
        }
        if (alreadyQueued(stokKodu, undefined, seri) >= items.length) {
          playFeedback(true);
          toast({ title: 'Yetersiz Stok', description: `Seri No ${seri} için yeterli stok yok.`, variant: 'destructive' });
          return;
        }
        addDirectTransferItem(items[0]);
        playFeedback();
        return;
      }

      if (mode === 'lot_barcode') {
        if (!lot) {
          playFeedback(true);
          toast({ title: 'Lot Eksik', description: 'Lot barkodu gerekli fakat bulunamadı.', variant: 'destructive' });
          return;
        }
        const items = await countStockByLot(stokKodu, lot);
        if (items.length === 0) {
          playFeedback(true);
          toast({ title: 'Depoda Bulunamadı', description: `${stokKodu} (Lot: ${lot}) bu depoda yok.`, variant: 'destructive' });
          return;
        }
        const queued = alreadyQueued(stokKodu, lot);
        if (queued >= items.length) {
          playFeedback(true);
          toast({ title: 'Yetersiz Stok', description: `${stokKodu} (Lot: ${lot}) için en fazla ${items.length} gönderilebilir.`, variant: 'destructive' });
          return;
        }
        upsertGroupedRow(
          { stokKodu, stokAdi, lotNumarasi: lot, miad },
          1
        );
        playFeedback();
        return;
      }

      const items = await countStockByCode(stokKodu);
      if (items.length === 0) {
        playFeedback(true);
        toast({ title: 'Depoda Bulunamadı', description: `${stokKodu} bu depoda yok.`, variant: 'destructive' });
        return;
      }
      const queued = alreadyQueued(stokKodu);
      if (queued >= items.length) {
        playFeedback(true);
        toast({ title: 'Yetersiz Stok', description: `${stokKodu} için en fazla ${items.length} gönderilebilir.`, variant: 'destructive' });
        return;
      }
      upsertGroupedRow(
        { stokKodu, stokAdi },
        1
      );
      playFeedback();
    },
    [selectedFormatId, barcodeFormats, products, toast, addDirectTransferItem, upsertGroupedRow, countStockBySerial, countStockByLot, countStockByCode, alreadyQueued, resolveProductFromParsed, parseAnyBarcode, directTransferItems]
  );
  
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

  const allocateDocsForGroup = useCallback(async (row: TransferRow): Promise<DepoStokItem[] | null> => {
    const alreadyAllocatedIds = new Set(
        directTransferItems
            .filter(item => !item.isGroup)
            .map(item => item.id)
    );

    const constraints = [
        where('depotId', '==', selectedDepotId),
        where('stokKodu', '==', row.stokKodu),
        where('isShipped', '==', false),
    ];
    if (row.lotNumarasi) {
        constraints.push(where('lotNumarasi', '==', row.lotNumarasi));
    }
    
    const q = query(collection(db, 'depoStok'), ...constraints);
    const snap = await getDocs(q);

    let pool = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as DepoStokItem))
        .filter(s => !alreadyAllocatedIds.has(s.id));
    
    pool.sort((a,b) => {
      try {
        const ad = parseDate(a.miad as string, 'dd.MM.yyyy', new Date());
        const bd = parseDate(b.miad as string, 'dd.MM.yyyy', new Date());
        return compareAsc(ad, bd);
      } catch { return 0; }
    });
    
    const need = Math.max(1, row.adet ?? 1);
    if (pool.length < need) return null;
    return pool.slice(0, need);
  }, [directTransferItems, selectedDepotId]);

  const processTransfer = useCallback(async (confirmedViolations: FefoViolation[] = []) => {
    if (!currentUser || !currentUserProfile) return;
    setShipmentLoading(true);
    setFefoViolations([]);

    const targetLab = isBorcMode ? null : hospitals.find(l => l.id === selectedLabId);
    const targetName = isBorcMode 
      ? (borcDepots.find(d => d.id === selectedBorcDepotId)?.name || 'Borç') 
      : (targetLab?.name || '');
    
    const targetId = isBorcMode ? null : selectedLabId;

    const transferRef = doc(collection(db, 'transfers'));
    const batch = writeBatch(db);

    const itemsToShip: DepoStokItem[] = [];
    let allocationError = false;

    for (const row of directTransferItems) {
      const picks = row.isGroup ? await allocateDocsForGroup(row) : [row];
      if (!picks) {
        toast({ title: 'Yetersiz Stok', description: `${row.stokAdi} ${row.lotNumarasi ? `(Lot: ${row.lotNumarasi})` : ''} için depoda yeterli adet (${row.adet}) yok.`, variant: 'destructive' });
        allocationError = true;
        break;
      }
      itemsToShip.push(...picks);
    }
    
    if (allocationError) {
      setShipmentLoading(false);
      return;
    }

    const trackingDisabled = !isBorcMode && targetLab?.consumptionTrackingEnabled === false;

    itemsToShip.forEach(item => {
      const stokRef = doc(db, 'depoStok', item.id);
      if (trackingDisabled) {
        batch.delete(stokRef);
        const consumptionRecord: Omit<ConsumptionRecord, 'id'> = {
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          lotNumarasi: item.lotNumarasi,
          miad: item.miad,
          seriNumarasi: item.seriNumarasi,
          laboratoryId: selectedLabId,
          laboratoryName: targetName,
          consumptionTimestamp: new Date(),
          consumptionType: 'normal_kullanim' as const,
          userId: currentUser?.uid || 'unknown',
          userName: currentUserProfile?.name || currentUser?.email || 'Unknown User',
        };
        batch.set(doc(collection(db, 'tuketimKayitlari')), consumptionRecord);
      } else {
        batch.set(stokRef, {
          isShipped: true, sevkTarihi: Timestamp.now(), hedefKurum: targetName,
          hedefKurumId: targetId || null, transferId: transferRef.id,
          sourceDepotId: selectedDepotId, sourceDepotName: depotName,
        }, { merge: true });
      }

      if (isBorcMode) {
        const borcRef = doc(collection(db, 'borcTransfers'));
        batch.set(borcRef, {
          fromDepotId: selectedDepotId, toBorcDepotId: selectedBorcDepotId,
          company: selectedCompany, stokKodu: item.stokKodu, stokAdi: item.stokAdi,
          lot: item.lotNumarasi, miad: item.miad, seriNumarasi: item.seriNumarasi,
          isReturned: false, timestamp: Timestamp.now(),
        });
      }

      if (item.seriNumarasi) {
        const histRef = doc(collection(db, `serialHistory/${item.seriNumarasi}/events`));
        batch.set(histRef, { type: 'transfer', transferId: transferRef.id, details: { sourceDepotId: selectedDepotId, sourceDepotName: depotName, targetName, targetHospitalId: targetId || null, stokKodu: item.stokKodu, stokAdi: item.stokAdi, lotNumarasi: item.lotNumarasi, miad: item.miad }, timestamp: Timestamp.now() });
      }
      const itemRef = doc(db, 'transfers', transferRef.id, 'items', item.id);
      batch.set(itemRef, { stokKodu: item.stokKodu, stokAdi: item.stokAdi, lotNumarasi: item.lotNumarasi || '', miad: item.miad || '', seriNumarasi: item.seriNumarasi || '' });
    });

    batch.set(transferRef, {
      id: transferRef.id, timestamp: serverTimestamp(), sourceDepotId: selectedDepotId,
      sourceDepotName: depotName, targetName, targetHospitalId: targetId || null,
      mode: isBorcMode ? 'borc' : 'lab', company: isBorcMode ? selectedCompany : null,
      itemCount: itemsToShip.length, createdByUid: currentUser.uid || '',
      createdByName: currentUserProfile.name || currentUser.email || '',
    });

    try {
      await batch.commit();
      toast({ title: 'Transfer Tamamlandı', description: `${itemsToShip.length} ürün transfer edildi.` });
      setLastTransferCount(itemsToShip.length);
      
      confirmedViolations.forEach(v => {
        emitFefoOverride({
            actor: { uid: currentUserProfile.uid, name: currentUserProfile.name || 'Bilinmeyen' },
            action: 'direct_transfer',
            product: { 
                stokKodu: v.scannedItem.stokKodu,
                stokAdi: v.scannedItem.stokAdi,
                lot: v.scannedItem.lotNumarasi,
                miad: v.scannedItem.miad as string,
            },
            shipmentId: transferRef.id,
            depotId: selectedDepotId,
        });
      });

      await autoPrintTutanakFromTransferId(db, transferRef.id, targetLab, currentUserProfile?.name || currentUser?.email || '');
      
      if (targetId) {
        await updateHospitalLastTransferDates(targetId, itemsToShip);
      }

      setDirectTransferItems([]);
    } catch (err) {
      console.error('Transfer commit error:', err);
      toast({ title: 'Veritabanı Hatası', description: 'Transfer sırasında hata oluştu.', variant: 'destructive' });
    } finally {
      setShipmentLoading(false);
    }
  }, [currentUser, currentUserProfile, isBorcMode, selectedLabId, hospitals, borcDepots, selectedBorcDepotId, selectedDepotId, depotName, directTransferItems, allocateDocsForGroup, toast, selectedCompany]);


  const handleCompleteDirectTransfer = async () => {
    if (directTransferItems.length === 0) return;
    
    setShipmentLoading(true);

    const itemsToShip: DepoStokItem[] = [];
    
    // 1. Adım: Gruplanmış ürünler için stok tahsisi (Allocation)
    for (const row of directTransferItems) {
      const picks = row.isGroup ? await allocateDocsForGroup(row) : [row];
      if (!picks) {
        toast({ title: 'Yetersiz Stok', description: `${row.stokAdi} için yeterli stok bulunmuyor veya başkası tarafından rezerve edilmiş.`, variant: 'destructive' });
        setShipmentLoading(false);
        return;
      }
      itemsToShip.push(...picks);
    }
    
    // YENİ KOD (OPTİMİZE EDİLMİŞ):
    // Sadece ilgili ürünler için FEFO kontrolü yap
    const violations = await checkFefoOptimized(itemsToShip, selectedDepotId);
    
    setShipmentLoading(false);

    if (violations.length > 0) {
      // Benzersiz violationları filtrele (aynı ürün için birden fazla uyarı vermemek için opsiyonel)
      const uniqueViolations = violations.filter((v, i, a) => a.findIndex(t => t.scannedItem.id === v.scannedItem.id) === i);
      setFefoViolations(uniqueViolations);
    } else {
      processTransfer();
    }
  };

  const manualProducts = useMemo(() => {
    const opts: { code: string; name: string; tracking: TrackingMode }[] = [];
    products.forEach(p => {
        if (!p.stokKodu) return;
        const tracking = productTracking[p.stokKodu] || resolveDefaultTrackingMode(p as any);
        if (tracking === 'lot_manual' || tracking === 'qty_manual') {
            opts.push({ code: p.stokKodu, name: productNames[p.stokKodu] || p.stokKodu, tracking });
        }
    });
    return opts.sort((a,b) => a.name.localeCompare(b.name));
  }, [products, productTracking, productNames]);
  
  const handleAddAllStock = async () => {
    if (!selectedDepotId) return;
    const q = query(collection(db, 'depoStok'), where('depotId', '==', selectedDepotId), where('isShipped', '==', false));
    const snap = await getDocs(q);
    const items = snap.docs.map(d => ({
        ...d.data(),
        id: d.id,
        adet: 1,
        key: d.id,
        isGroup: false,
    } as TransferRow));

    setDirectTransferItems(items);
    toast({
        title: 'Tüm Stok Eklendi',
        description: `${items.length} adet ürün transfer listesine eklendi.`
    });
  };
  
  const groupedTransferItems = useMemo(() => {
    const groups: Record<string, {
      key: string,
      stokKodu: string;
      stokAdi: string;
      lotNumarasi: string;
      miad: string;
      adet: number;
      isGroup: boolean;
      serials: { id: string; seriNumarasi: string }[]
    }> = {};
  
    directTransferItems.forEach(item => {
      const groupKey = `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: groupKey,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          lotNumarasi: item.lotNumarasi || '',
          miad: item.miad as string || '',
          adet: 0,
          isGroup: true,
          serials: [],
        };
      }
      groups[groupKey].adet += item.adet;
      if (!item.isGroup && item.seriNumarasi) {
        groups[groupKey].serials.push({ id: item.id, seriNumarasi: item.seriNumarasi });
      }
    });
    return Object.values(groups).sort((a,b) => a.stokAdi.localeCompare(b.stokAdi));
  }, [directTransferItems]);

  const removeTransferItem = (itemId: string, isGroup: boolean | undefined) => {
    if (isGroup) {
      setDirectTransferItems(prev => prev.filter(item => item.key !== itemId));
    } else {
      setDirectTransferItems(prev => prev.filter(item => item.id !== itemId));
    }
  };

  const handleGroupAdetChange = (groupKey: string, newAdetStr: string) => {
    const newAdet = parseInt(newAdetStr, 10);
    if (isNaN(newAdet) || newAdet < 0) return;

    setDirectTransferItems(prev => {
        const groupItems = prev.filter(item => item.key === groupKey);
        if (groupItems.length > 0 && groupItems[0].isGroup) {
            const updatedGroup = { ...groupItems[0], adet: newAdet };
            return [updatedGroup, ...prev.filter(item => item.key !== groupKey)];
        }
        return prev;
    });
  };

  return (
    <>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <BackButton fallback="/siparisler" />
          <div className="flex items-center gap-2">
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={!selectedDepotId}>
                        <DatabaseZap className="mr-2 h-4 w-4"/> Tüm Stoğu Ekle
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu işlem, "{depotName}" deposundaki sevk edilmemiş tüm ürünleri transfer listesine ekleyecektir.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleAddAllStock}>Evet, Tümünü Ekle</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" onClick={() => router.push(`/transfer-gecmis?depotId=${selectedDepotId}`)} disabled={!selectedDepotId}>
                <History className="mr-2 h-4 w-4" /> Transfer Geçmişi
            </Button>
          </div>
        </div>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <CardTitle><Truck className="inline mr-2" />Direkt Transfer</CardTitle>
            <CardDescription>Depodan doğrudan ürünleri laboratuvara veya firmaya sevk edin.</CardDescription>
          </div>
          <Button onClick={handleCompleteDirectTransfer} disabled={directTransferItems.length === 0 || shipmentLoading}>
            {shipmentLoading ? <Loader2 className="animate-spin mr-2" /> : <CheckCircle2 className="mr-2" />}
            {directTransferItems.reduce((sum, item) => sum + (item.adet ?? 1), 0)} Ürünü Transfer Et
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
            <div className="space-y-1">
                <Label>Kaynak depo seçin</Label>
                <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={prereqsLoading}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Kaynak depo seçin" /></SelectTrigger>
                <SelectContent> {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)} </SelectContent>
                </Select>
            </div>
            <div className="space-y-1">
              <Label>Hedef Laboratuvar</Label>
              <Popover open={isLabPopoverOpen} onOpenChange={setIsLabPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={isLabPopoverOpen} className="w-full justify-between font-normal" disabled={isBorcMode || hospitals.length === 0}>
                    {selectedLabName || "Laboratuvar seçin."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                  <Command>
                    <CommandInput placeholder="Laboratuvar ara..." />
                    <CommandList>
                      <CommandEmpty>Laboratuvar bulunamadı.</CommandEmpty>
                      <CommandGroup>
                        {hospitals.sort((a,b) => (a.name || '').localeCompare(b.name || '')).map((lab) => (
                          <CommandItem
                            key={lab.id}
                            value={lab.name}
                            onSelect={() => {
                              setSelectedLabId(lab.id);
                              setIsLabPopoverOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedLabId === lab.id ? "opacity-100" : "opacity-0")} />
                            {lab.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center space-x-2 pt-6">
              <Switch checked={isBorcMode} onCheckedChange={setIsBorcMode} id="borc-mode" />
              <Label htmlFor="borc-mode" className="font-semibold">Borç Modu</Label>
              <Button variant="outline" size="icon" onClick={() => { setIsBatchScanning(false); setIsCameraScannerOpen(true); }} disabled={shipmentLoading || (!isBorcMode && !selectedLabId) || (isBorcMode && !selectedCompany)} title="Tekli Tara"><Camera /></Button>
              <Button variant="default" size="icon" onClick={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }} disabled={shipmentLoading || (!isBorcMode && !selectedLabId) || (isBorcMode && !selectedCompany)} title="Seri Tarama"><Camera /></Button>
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setShowManualInline(v => !v)} title="Manuel Ürün Ekle"><Plus className="mr-2 h-4 w-4" /> Manuel Ürün</Button>
            </div>
          </div>
          
          {showManualInline &&
             <div>
                <ManualInlineAdder
                  visible={showManualInline}
                  onClose={() => setShowManualInline(false)}
                  depotName={depotName}
                  stockPool={[]} 
                  transferRows={directTransferItems}
                  products={manualProducts}
                  onAddLot={({ code, name, lot, miad, qty }) => {
                    upsertGroupedRow({ stokKodu: code, stokAdi: name, lotNumarasi: lot, miad: miad }, qty);
                  }}
                  onAddQty={({ code, name, qty }) => {
                    upsertGroupedRow({ stokKodu: code, stokAdi: name }, qty);
                  }}
                />
             </div>
          }

          {isBorcMode ? (
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Borç Depo</Label><Select value={selectedBorcDepotId} onValueChange={setSelectedBorcDepotId}><SelectTrigger><SelectValue placeholder="Depo" /></SelectTrigger><SelectContent>{borcDepots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Firma</Label><Select value={selectedCompany} onValueChange={setSelectedCompany}><SelectTrigger><SelectValue placeholder="Firma" /></SelectTrigger><SelectContent>{borcDepots.find(d => d.id === selectedBorcDepotId)?.companies?.map(c =><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
            </div>
          ) : (
            null
          )}
          
          <hr />

          <BarcodeFormatSelect
            value={selectedFormatId || '__auto__'}
            onChange={v => setSelectedFormatId(v)}
            disabled={formatsLoading}
          />

          {directTransferItems.length > 0 && (
              <ScrollArea className="h-64 border rounded-md p-2">
                <Accordion type="multiple" className="w-full">
                  {groupedTransferItems.map(group => (
                    <AccordionItem value={group.key} key={group.key}>
                      <AccordionTrigger>
                        <div className="flex-1 text-left font-medium">{group.stokAdi} <span className="text-xs text-muted-foreground">({group.stokKodu})</span></div>
                        <div className="flex-1 text-left text-sm">Lot: {group.lotNumarasi || '-'}</div>
                        <div className="flex-1 text-left text-sm">Miad: {group.miad || '-'}</div>
                        <div className="font-bold flex items-center gap-2">
                           {group.isGroup ? (
                                <Input type="number" value={group.adet} onChange={(e) => handleGroupAdetChange(group.key, e.target.value)} onClick={(e) => e.stopPropagation()} className="w-20 h-7" />
                           ) : (
                                <span>{group.adet} Adet</span>
                           )}
                           <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); removeTransferItem(group.key, true); }}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="p-2 bg-muted/50">
                        {group.serials.length > 0 ? (
                          <ul className="space-y-1">
                            {group.serials.map(serial => (
                              <li key={serial.id} className="flex justify-between items-center text-xs font-mono">
                                {serial.seriNumarasi}
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeTransferItem(serial.id, false)}>
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
          )}

          <Dialog open={isCameraScannerOpen} onOpenChange={setIsCameraScannerOpen}>
            <DialogContent className="max-w-md p-0"><DialogHeader className="p-4"><DialogTitle>Kamera ile Tara</DialogTitle>{isBatchScanning && (<DialogDescription className="px-4">Seri tarama açık. Bitince pencereyi kapatın.</DialogDescription>)}</DialogHeader>{isCameraScannerOpen && <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /><p>Kamera...</p></div>}><CameraScanner onScanSuccess={handleCameraScan} onClose={() => setIsCameraScannerOpen(false)} /></Suspense>}</DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
    
      <AlertDialog open={fefoViolations.length > 0} onOpenChange={(open) => !open && setFefoViolations([])}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="text-amber-500"/>
                    FEFO Uyarısı
                </AlertDialogTitle>
                <AlertDialogDescription>
                    Transfer listesinde, depoda daha erken miadlı alternatifi olan ürünler var. Yine de devam etmek istiyor musunuz? Onaylarsanız bu durum kaydedilecektir.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <ScrollArea className="max-h-60 mt-4 border rounded-md p-2">
                {fefoViolations.map((v, i) => (
                    <div key={i} className="text-sm p-2 mb-2 bg-background rounded">
                        <p><strong>{v.scannedItem.stokAdi}</strong></p>
                        <p>Okutulan Lot: {v.scannedItem.lotNumarasi} (Miad: {v.scannedItem.miad as string})</p>
                        <p className="text-green-600">Önerilen Lot: {v.recommendedItem.lotNumarasi} (Miad: {v.recommendedItem.miad as string})</p>
                    </div>
                ))}
            </ScrollArea>
            <AlertDialogFooter>
                <AlertDialogCancel>İptal</AlertDialogCancel>
                <AlertDialogAction onClick={() => processTransfer(fefoViolations)}>
                    Yine de Transfer Et
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


