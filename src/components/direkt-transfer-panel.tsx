/**
 * @fileoverview Direct Transfer Panel Component
 * @description Enterprise-grade direct transfer panel for inventory transfers between
 * depots and laboratories with barcode scanning, FEFO validation, and batch processing.
 * @module components/direkt-transfer-panel
 * @version 2.0.0
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense, ChangeEvent } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { Depot, DepoStokItem, ProductCode, Hospital, ConsumptionRecord, ManualProductOption, TransferTemplate } from '@/lib/types';
import type { BarcodeFormat, ParsedGeneric } from '@/lib/barcode';
import { decodeBulkSerialQrPayload } from '@/lib/barcode';

// Type imports from direkt-transfer module
import type { TransferRow, FefoViolation, ScanSource } from '@/lib/direkt-transfer/types';

// Logging integration
import { direktTransferLogger } from '@/lib/logger';
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
import { useDepoStokByDepot, touchStockMetadata, useDepots, useProductCodes, useHospitals, useBorcDepots, useInvalidateQueries } from '@/hooks/useFirebaseQueries';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, Camera, Truck, Plus, CheckCircle2, History, DatabaseZap, ChevronsUpDown, Check, Trash2, AlertTriangle, Package, FileText, ListChecks, ArrowRight, Minus, MoreHorizontal, X, ChevronDown, ChevronUp, Search, QrCode } from 'lucide-react';
import { TrackingMode, resolveDefaultTrackingMode, resolveEffectiveTrackingMode } from '@/lib/tracking';
import useHidScanner from '@/hooks/useHidScanner';
import BarcodeFormatSelect, { type FormatValue } from '@/components/BarcodeFormatSelect';
import { cn, playFeedback, sanitizeGS1, generateId } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, matchesCompanyScope } from '@/lib/company-scope';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { compareAsc, parse as parseDate } from 'date-fns';
import { formatMiad } from '@/lib/date';
import BackButton from '@/components/BackButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
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
import { VirtualizedList } from '@/components/ui/virtualized-list';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { formatUnitMultiplier, normalizeUnitLabel, formatQuantityWithUnit } from '@/lib/product-unit';


const CameraScanner = dynamic(() => import('@/components/camera-barcode-scanner'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /><span className="ml-2">Kamera Yükleniyor...</span></div>,
});

const TemplateSelector = dynamic(() => import('@/components/direkt-transfer/TemplateSelector'), {
  ssr: false,
  loading: () => <div className="h-20 animate-pulse bg-muted rounded-md" />
});

const ManualInlineAdder = dynamic(() => import('@/components/direkt-transfer/ManualInlineAdder'), {
  ssr: false,
  loading: () => <div className="h-10 animate-pulse bg-muted rounded-md" />
});

function DirektTransferSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 animate-pulse">
      <div className="h-12 w-32 bg-muted rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-48 bg-muted rounded-xl" />
        <div className="h-48 bg-muted rounded-xl" />
      </div>
      <div className="h-24 bg-muted rounded-xl mt-4" />
      <div className="flex-1 bg-muted rounded-xl mt-4" style={{ minHeight: '400px' }} />
    </div>
  );
}


// OPTIMIZED FEFO CHECK:
// Uses batch queries with Firestore 'in' clause (max 30 values) to reduce round trips
const checkFefoOptimized = async (
  itemsToShip: DepoStokItem[],
  depotId: string,
  currentCompanyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<FefoViolation[]> => {
  const violations: FefoViolation[] = [];

  // Transfer listesindeki benzersiz stok kodlarını bul
  const uniqueStokKodlari = Array.from(new Set(itemsToShip.map(i => i.stokKodu)));

  if (uniqueStokKodlari.length === 0) return violations;

  // OPTIMIZED: Batch queries using 'in' clause (max 30 values per query)
  // This reduces N queries to ceil(N/30) queries
  const allProductStock: DepoStokItem[] = [];

  // Process in batches of 30 (Firestore 'in' clause limit)
  const batchSize = 30;
  for (let i = 0; i < uniqueStokKodlari.length; i += batchSize) {
    const batchCodes = uniqueStokKodlari.slice(i, i + batchSize);

    const q = query(
      collection(db, 'depoStok'),
      where('depotId', '==', depotId),
      where('stokKodu', 'in', batchCodes),
      where('isShipped', '==', false)
    );
    const snap = await getDocs(q);
    snap.docs.forEach(d => {
      const data = d.data();
      if (!matchesCompanyScope(data as any, currentCompanyId, isSuperAdmin)) return;
      allProductStock.push({ id: d.id, ...data } as DepoStokItem);
    });
  }

  // Group stock by stokKodu for efficient lookups
  const stockByCode = new Map<string, DepoStokItem[]>();
  allProductStock.forEach(item => {
    const existing = stockByCode.get(item.stokKodu) || [];
    existing.push(item);
    stockByCode.set(item.stokKodu, existing);
  });

  // Create a Set of item IDs being shipped for O(1) lookup
  const shippingIds = new Set(itemsToShip.map(i => i.id));

  // FEFO check for each item being shipped
  for (const item of itemsToShip) {
    try {
      const itemMiadStr = formatMiad(item.miad, '');
      const itemDate = parseDate(itemMiadStr, 'dd.MM.yyyy', new Date());

      const productStockInDepot = stockByCode.get(item.stokKodu) || [];

      // Depodaki, transfer listesinde OLMAYAN ve miadı daha eski olan ürünleri bul
      const earlierItems = productStockInDepot.filter(s => {
        // Kendisi veya transfer listesindeki başka bir item olmamalı
        if (shippingIds.has(s.id)) return false;

        // Tarih kontrolü
        try {
          const sMiadStr = formatMiad(s.miad, '');
          const stockDate = parseDate(sMiadStr, 'dd.MM.yyyy', new Date());
          // Stoktaki tarih < Transfer edilen tarih ise violation vardır
          return compareAsc(stockDate, itemDate) < 0;
        } catch {
          return false;
        }
      });

      if (earlierItems.length > 0) {
        // En eski tarihli olanı öneri olarak ekle
        earlierItems.sort((a, b) => {
          try {
            return compareAsc(
              parseDate(formatMiad(a.miad, ''), 'dd.MM.yyyy', new Date()),
              parseDate(formatMiad(b.miad, ''), 'dd.MM.yyyy', new Date())
            );
          } catch {
            return 0;
          }
        });

        violations.push({ scannedItem: item, recommendedItem: earlierItems[0] });
      }
    } catch (e) {
      direktTransferLogger.warn('Tarih parslama hatası, FEFO kontrolü atlanıyor', {
        stokKodu: item.stokKodu,
        miad: item.miad,
      });
    }
  }

  return violations;
};


export default function DirektTransferPanel() {
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const router = useRouter();
  const { invalidateDepoStok } = useInvalidateQueries();

  // Optimized fetching with TanStack Query
  const { data: allDepots = [], isLoading: depotsLoading } = useDepots();
  const { data: products = [], isLoading: productsLoading } = useProductCodes();
  const { data: hospitals = [], isLoading: hospitalsLoading } = useHospitals();
  const { data: borcDepots = [], isLoading: borcLoading } = useBorcDepots();

  const depots = useMemo(() => filterOperationalSourceDepots(allDepots, currentUserProfile), [allDepots, currentUserProfile]);
  const prereqsLoading = depotsLoading || productsLoading || hospitalsLoading || borcLoading;

  const { formats: barcodeFormats, loading: formatsLoading, parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode } = useBarcodeParser();
  

  
  const productMetaByCode = useMemo(() => {
    const map = new Map<string, ProductCode>();
    products.forEach((p) => {
      if (p.stokKodu) map.set(p.stokKodu, p);
    });
    return map;
  }, [products]);
  
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');

  // Pre-load depot stock for instant barcode lookups (eliminates 200-500ms per scan)
  const { data: depotStockData = [] } = useDepoStokByDepot(selectedDepotId);

  // Create lookup maps for O(1) stock queries - DRAMATIC performance improvement
  const depotStockLookups = useMemo(() => {
    const bySerial = new Map<string, DepoStokItem[]>(); // key: stokKodu__serial
    const byLot = new Map<string, DepoStokItem[]>();    // key: stokKodu__lot
    const byCode = new Map<string, DepoStokItem[]>();   // key: stokKodu

    const unshipped = depotStockData.filter(item => !item.isShipped);

    for (const item of unshipped) {
      const code = item.stokKodu || '';

      // Index by stock code
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code)!.push(item);

      // Index by serial (only if has serial)
      if (item.seriNumarasi) {
        const serialKey = `${code}__${item.seriNumarasi}`;
        if (!bySerial.has(serialKey)) bySerial.set(serialKey, []);
        bySerial.get(serialKey)!.push(item);
      }

      // Index by lot (only for non-serial items)
      if (item.lotNumarasi && (!item.seriNumarasi || item.seriNumarasi.trim() === '')) {
        const lotKey = `${code}__${item.lotNumarasi}`;
        if (!byLot.has(lotKey)) byLot.set(lotKey, []);
        byLot.get(lotKey)!.push(item);
      }
    }

    return { bySerial, byLot, byCode };
  }, [depotStockData]);

  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [isBorcMode, setIsBorcMode] = useState<boolean>(false);
  const [selectedBorcDepotId, setSelectedBorcDepotId] = useState<string>('');
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [directTransferItems, setDirectTransferItems] = useState<TransferRow[]>([]);
  const [shipmentLoading, setShipmentLoading] = useState<boolean>(false);
  const [lastTransferCount, setLastTransferCount] = useState<number>(0);

  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [isBatchScanning, setIsBatchScanning] = useState(false);
  const [isBulkScanMode, setIsBulkScanMode] = useState(false);
  const [showManualInline, setShowManualInline] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [templates, setTemplates] = useState<TransferTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const [selectedFormatId, setSelectedFormatId] = useState<FormatValue>('__auto__');
  const [isLabPopoverOpen, setIsLabPopoverOpen] = useState(false);
  
  const [fefoViolations, setFefoViolations] = useState<FefoViolation[]>([]);

  // Last scanned product tracking for UI feedback
  const [lastScannedProduct, setLastScannedProduct] = useState<{
    stokKodu: string;
    stokAdi: string;
    lotNumarasi?: string;
    miad?: string;
    seriNumarasi?: string;
  } | null>(null);

  // Scan feedback: flash green/red on son okutulan area
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const scanFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashScanFeedback = useCallback((type: 'success' | 'error', message: string) => {
    if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
    setScanFeedback({ type, message });
    scanFeedbackTimer.current = setTimeout(() => setScanFeedback(null), 2500);
  }, []);

  const selectedLabName = useMemo(() => hospitals.find(l => l.id === selectedLabId)?.name || '', [hospitals, selectedLabId]);

  // Computed counts for last scanned product
  const lotCount = useMemo(() => {
    if (!lastScannedProduct) return 0;
    return directTransferItems
      .filter(item => item.stokKodu === lastScannedProduct.stokKodu && item.lotNumarasi === lastScannedProduct.lotNumarasi)
      .reduce((n, it) => n + (it.adet ?? 1), 0);
  }, [directTransferItems, lastScannedProduct]);

  const totalCountForProduct = useMemo(() => {
    if (!lastScannedProduct) return 0;
    return directTransferItems
      .filter(item => item.stokKodu === lastScannedProduct.stokKodu)
      .reduce((n, it) => n + (it.adet ?? 1), 0);
  }, [directTransferItems, lastScannedProduct]);
  
  // Auto-select first depot
  useEffect(() => {
    if (depots.length > 0 && !selectedDepotId) {
      setSelectedDepotId(depots[0].id);
    }
  }, [depots, selectedDepotId]);

  // Fetch templates when template selector is opened
  const fetchTemplates = useCallback(async () => {
    if (templates.length > 0) return; // Already loaded
    setTemplatesLoading(true);
    try {
      const snap = await getDocs(collection(db, 'transferTemplates'));
      const templateList = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate?.() || null,
        updatedAt: d.data().updatedAt?.toDate?.() || null,
      })) as TransferTemplate[];
      setTemplates(templateList.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    } catch (err) {
      console.error('Error fetching templates:', err);
      toast({ title: 'Hata', description: 'Şablonlar yüklenemedi.', variant: 'destructive' });
    } finally {
      setTemplatesLoading(false);
    }
  }, [templates.length, toast]);

  const { productTracking, productNames } = useMemo(() => {
    const trackingMap: Record<string, TrackingMode> = {};
    const nameMap: Record<string, string> = {};
    products.forEach(p => {
      const stokKodu = p.stokKodu ?? '';
      if (stokKodu) {
          nameMap[stokKodu] = p.stokAdi ?? stokKodu;
          if ((p as any).trackingMode) trackingMap[stokKodu] = (p as any).trackingMode as TrackingMode;
      }
    });
    return { productTracking: trackingMap, productNames: nameMap };
  }, [products]);
  
  const upsertGroupedRow = useCallback((partial: Partial<TransferRow>, inc = 1) => {
    const k = `${partial.stokKodu ?? ''}__${partial.lotNumarasi || ''}`;
    setDirectTransferItems(prev => {
      const i = prev.findIndex(r => r.key === k);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], adet: copy[i].adet + inc };
        return copy;
      }
      const row: TransferRow = {
        key: k,
        stokKodu: partial.stokKodu ?? '',
        stokAdi: partial.stokAdi ?? '',
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
            return prevItems;
        }
        return [{...itemToAdd, adet: 1, key: itemToAdd.id, isGroup: false}, ...prevItems];
    });
  }, []);

  const depotName = useMemo(() => depots.find(d => d.id === selectedDepotId)?.name || '', [depots, selectedDepotId]);

  // OPTIMIZED: Synchronous in-memory lookups instead of async Firestore queries
  // This reduces barcode scan time from 1.5-2s to <50ms
  const countStockBySerial = useCallback((stokKodu: string, serial: string): DepoStokItem[] => {
      const key = `${stokKodu}__${serial}`;
      return depotStockLookups.bySerial.get(key) || [];
  }, [depotStockLookups]);

  const countStockByLot = useCallback((stokKodu: string, lot: string): DepoStokItem[] => {
      const key = `${stokKodu}__${lot}`;
      return depotStockLookups.byLot.get(key) || [];
  }, [depotStockLookups]);

  const countStockByCode = useCallback((stokKodu: string): DepoStokItem[] => {
      return depotStockLookups.byCode.get(stokKodu) || [];
  }, [depotStockLookups]);

  // Lot-tracked items are stored as a single document with `adet: N`; serial-tracked
  // items are one-document-per-unit (adet: 1). Available units = sum of adet, not doc count.
  const sumStockAdet = useCallback((items: DepoStokItem[]): number => {
      return items.reduce((sum, item) => sum + ((item as any).adet ?? 1), 0);
  }, []);

  const alreadyQueued = useCallback((stokKodu: string, lot?: string, seri?: string) => {
    return directTransferItems
      .filter(r => r.stokKodu === stokKodu && (lot ? r.lotNumarasi === lot : !r.lotNumarasi) && (seri ? r.seriNumarasi === seri : true))
      .reduce((n, r) => n + (r.adet ?? 1), 0);
  }, [directTransferItems]);
  
  const handleScan = useCallback(
    async (raw: string, source: 'hid' | 'camera' | 'manual' | 'bulk_item' = 'hid') => {
      if (!raw) return;

      const trimmedRaw = raw.trim();
      if (!trimmedRaw) return;

      const decodedBulk = decodeBulkSerialQrPayload(trimmedRaw);
      if (decodedBulk) {
        for (const serial of decodedBulk) {
          await handleScan(serial, 'bulk_item');
        }
        setIsBulkScanMode(false);
        flashScanFeedback('success', `${decodedBulk.length} barkod transfer listesine işlendi.`);
        return;
      }

      if (isBulkScanMode && source !== 'bulk_item') {
        playFeedback(true);
        flashScanFeedback('error', 'Bu modda sadece toplu barkodlar okunabilir.');
        return;
      }
      
      let resolveResult: ReturnType<typeof parseAndResolveBarcode> = null;
      if (selectedFormatId && selectedFormatId !== '__auto__') {
          const fmt = barcodeFormats.find(f => f.id === selectedFormatId);
          if (fmt) {
            const parsed = parseAnyBarcode(trimmedRaw, [fmt]);
            if (parsed) {
              const resolved = resolveProductFromParsed(parsed, products);
              resolveResult = { parsed: resolved, product: resolved.product };
            }
          }
      }
      if (!resolveResult || !resolveResult.product) {
          resolveResult = parseAndResolveBarcode(trimmedRaw, barcodeFormats, products);
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

      // Check for duplicate - must match both stokKodu AND seriNumarasi since same serial can exist for different products
      if (seri && directTransferItems.some(item => item.stokKodu === stokKodu && item.seriNumarasi === seri)) {
          playFeedback(true);
          flashScanFeedback('error', 'Bu ürün zaten listeye eklendi.');
          return;
      }

      // Determine tracking mode based on what the barcode contains
      const matchedFormat = resolved.matchedFormatId
        ? barcodeFormats.find(f => f.id === resolved.matchedFormatId)
        : undefined;
      const staticTrackingMode = productTracking[stokKodu] || resolveDefaultTrackingMode(product as any);
      const mode: TrackingMode = (staticTrackingMode === 'qty_manual' || staticTrackingMode === 'qty_barcode')
        ? 'qty_barcode'
        : resolveEffectiveTrackingMode(resolved, matchedFormat, product as any);

      if (mode === 'serial') {
        if (!seri) {
          playFeedback(true);
          flashScanFeedback('error', `${stokAdi}: Seri no takipli üründe barkod seri içermiyor.`);
          return;
        }
        const items = countStockBySerial(stokKodu, seri);
        if (items.length === 0) {
          playFeedback(true);
          flashScanFeedback('error', `Seri No ${seri} bu depoda bulunamadı.`);
          return;
        }
        const serialAvailable = sumStockAdet(items);
        if (alreadyQueued(stokKodu, undefined, seri) >= serialAvailable) {
          playFeedback(true);
          flashScanFeedback('error', `Seri No ${seri} için yeterli stok yok.`);
          return;
        }
        addDirectTransferItem(items[0]);
        setLastScannedProduct({ stokKodu, stokAdi, lotNumarasi: lot, miad, seriNumarasi: seri });
        flashScanFeedback('success', `${stokAdi} eklendi.`);
        playFeedback();
        return;
      }

      if (mode === 'lot_barcode') {
        if (!lot) {
          playFeedback(true);
          flashScanFeedback('error', `${stokAdi}: Lot barkodu gerekli fakat bulunamadı.`);
          return;
        }
        const items = countStockByLot(stokKodu, lot);
        if (items.length === 0) {
          playFeedback(true);
          flashScanFeedback('error', `${stokKodu} (Lot: ${lot}) bu depoda bulunamadı.`);
          return;
        }
        const lotAvailable = sumStockAdet(items);
        const queued = alreadyQueued(stokKodu, lot);
        if (queued >= lotAvailable) {
          playFeedback(true);
          flashScanFeedback('error', `${stokKodu} (Lot: ${lot}) için en fazla ${lotAvailable} gönderilebilir.`);
          return;
        }
        upsertGroupedRow(
          { stokKodu, stokAdi, lotNumarasi: lot, miad },
          1
        );
        setLastScannedProduct({ stokKodu, stokAdi, lotNumarasi: lot, miad });
        flashScanFeedback('success', `${stokAdi} eklendi.`);
        playFeedback();
        return;
      }

      const items = countStockByCode(stokKodu);
      if (items.length === 0) {
        playFeedback(true);
        flashScanFeedback('error', `${stokKodu} bu depoda bulunamadı.`);
        return;
      }
      const codeAvailable = sumStockAdet(items);
      const queued = alreadyQueued(stokKodu);
      if (queued >= codeAvailable) {
        playFeedback(true);
        flashScanFeedback('error', `${stokKodu} için en fazla ${codeAvailable} gönderilebilir.`);
        return;
      }
      upsertGroupedRow(
        { stokKodu, stokAdi },
        1
      );
      setLastScannedProduct({ stokKodu, stokAdi });
      flashScanFeedback('success', `${stokAdi} eklendi.`);
      playFeedback();
    },
    [selectedFormatId, barcodeFormats, products, toast, addDirectTransferItem, upsertGroupedRow, countStockBySerial, countStockByLot, countStockByCode, sumStockAdet, alreadyQueued, resolveProductFromParsed, parseAnyBarcode, parseAndResolveBarcode, directTransferItems, isBulkScanMode, flashScanFeedback]
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

  // OPTIMIZED: Batch allocate all groups at once instead of one query per group
  const batchAllocateForGroups = useCallback(async (groupRows: TransferRow[]): Promise<{ allocations: Map<string, DepoStokItem[]>; error: TransferRow | null }> => {
    const alreadyAllocatedIds = new Set(
      directTransferItems
        .filter(item => !item.isGroup)
        .map(item => item.id)
    );

    // Collect unique stokKodu values from all groups
    const uniqueStokKodlari = Array.from(new Set(groupRows.map(r => r.stokKodu)));

    if (uniqueStokKodlari.length === 0) {
      return { allocations: new Map(), error: null };
    }

    // Batch query all stock codes at once
    const allStock: DepoStokItem[] = [];
    const batchSize = 30;

    for (let i = 0; i < uniqueStokKodlari.length; i += batchSize) {
      const batchCodes = uniqueStokKodlari.slice(i, i + batchSize);
      const q = query(
        collection(db, 'depoStok'),
        where('depotId', '==', selectedDepotId),
        where('stokKodu', 'in', batchCodes),
        where('isShipped', '==', false)
      );
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        const data = d.data();
        if (!matchesCompanyScope(data as any, currentCompanyId, isSuperAdmin)) return;
        allStock.push({ id: d.id, ...data } as DepoStokItem);
      });
    }

    // Group stock by stokKodu and lotNumarasi for efficient allocation
    const stockByCodeAndLot = new Map<string, DepoStokItem[]>();
    const stockByCode = new Map<string, DepoStokItem[]>();
    allStock.forEach(item => {
      const key = `${item.stokKodu}__${item.lotNumarasi || ''}`;
      const existing = stockByCodeAndLot.get(key) || [];
      existing.push(item);
      stockByCodeAndLot.set(key, existing);

      const codeExisting = stockByCode.get(item.stokKodu) || [];
      codeExisting.push(item);
      stockByCode.set(item.stokKodu, codeExisting);
    });

    // Sort each group by FEFO (earliest expiry first)
    stockByCodeAndLot.forEach((items, key) => {
      items.sort((a, b) => {
        try {
          const ad = parseDate(formatMiad(a.miad, ''), 'dd.MM.yyyy', new Date());
          const bd = parseDate(formatMiad(b.miad, ''), 'dd.MM.yyyy', new Date());
          return compareAsc(ad, bd);
        } catch {
          return 0;
        }
      });
    });
    stockByCode.forEach((items, key) => {
      items.sort((a, b) => {
        try {
          const ad = parseDate(formatMiad(a.miad, ''), 'dd.MM.yyyy', new Date());
          const bd = parseDate(formatMiad(b.miad, ''), 'dd.MM.yyyy', new Date());
          return compareAsc(ad, bd);
        } catch {
          return 0;
        }
      });
    });

    // Allocate for each group
    const allocations = new Map<string, (DepoStokItem & { transferAdet?: number })[]>();
    const usedIds = new Set<string>(alreadyAllocatedIds);

    for (const row of groupRows) {
      const trackingMode = productTracking[row.stokKodu] || resolveDefaultTrackingMode({ stokAdi: row.stokAdi } as any);
      const isQuantityTracked = trackingMode === 'qty_manual' || trackingMode === 'qty_barcode';

      const key = `${row.stokKodu}__${row.lotNumarasi || ''}`;
      const sourcePool = isQuantityTracked && !row.lotNumarasi
        ? (stockByCode.get(row.stokKodu) || [])
        : (stockByCodeAndLot.get(key) || []);
      
      const pool = sourcePool.filter(s => !usedIds.has(s.id));

      const need = Math.max(1, row.adet ?? 1);
      let accumulated = 0;
      const picks: (DepoStokItem & { transferAdet?: number })[] = [];

      for (const docItem of pool) {
        if (accumulated >= need) break;

        const docQty = docItem.adet ?? 1;
        const remainingToNeed = need - accumulated;
        const take = Math.min(docQty, remainingToNeed);

        picks.push({ ...docItem, transferAdet: take });
        accumulated += take;
        
        // If we took EVERYTHING from this document, mark it as used
        if (take === docQty) {
          usedIds.add(docItem.id);
        }
        // If we only took PART of it, we don't mark it as fully used 
        // because another pick might take the rest, but for simplicity in memory
        // we'll track it in a more refined way if needed. For now, usedIds works for full takes.
      }

      if (accumulated < need) {
        return { allocations: new Map(), error: row };
      }
      allocations.set(row.key, picks);
    }

    return { allocations, error: null };
  }, [directTransferItems, selectedDepotId, productTracking, currentCompanyId, isSuperAdmin]);

  // Legacy function kept for compatibility
  const allocateDocsForGroup = useCallback(async (row: TransferRow): Promise<DepoStokItem[] | null> => {
    const { allocations, error } = await batchAllocateForGroups([row]);
    if (error) return null;
    return allocations.get(row.key) || null;
  }, [batchAllocateForGroups]);

  const processTransfer = useCallback(async (confirmedViolations: FefoViolation[] = []) => {
    if (!currentUser || !currentUserProfile) return;

    if (!isBorcMode && !selectedLabId) {
      toast({ title: 'Hedef Seçilmedi', description: 'Lütfen transfer için bir hedef laboratuvar seçin.', variant: 'destructive' });
      return;
    }

    setShipmentLoading(true);
    setFefoViolations([]);

    const targetLab = isBorcMode ? null : hospitals.find(l => l.id === selectedLabId);
    const targetName = isBorcMode
      ? (borcDepots.find(d => d.id === selectedBorcDepotId)?.name || 'Borç')
      : (targetLab?.name || '');
    const targetId = isBorcMode ? null : selectedLabId;

    const itemsToShip: DepoStokItem[] = [];
    let allocationError = false;

    // Ağ çağrısı gerektiren ön tahsis işlemini yapalım (bu çok hızlıdır, 0.5s sürer)
    for (const row of directTransferItems) {
      const picks = row.isGroup ? await allocateDocsForGroup(row) : [row];
      if (!picks) {
        toast({ title: 'Yetersiz Stok', description: `${row.stokAdi} ${row.lotNumarasi ? `(Lot: ${row.lotNumarasi})` : ''} için depoda yeterli adet (${row.adet}) yok.`, variant: 'destructive' });
        allocationError = true;
        break;
      }
      itemsToShip.push(...(picks as DepoStokItem[]));
    }
    
    if (allocationError) {
      setShipmentLoading(false);
      return;
    }

    // --- OPTIMISTIC UI: Durumu Yedekle ve Ekranı Temizle ---
    const previousDirectTransferItems = [...directTransferItems];
    setDirectTransferItems([]);
    setShipmentLoading(false);

    toast({
      title: 'İşlem Kaydediliyor...',
      description: `${itemsToShip.length} ürün arka planda transfer ediliyor. Çıkış yapmayınız.`,
      duration: 3000
    });

    // --- ARKA PLAN İŞLEMİ (Fire and Forget) ---
    (async () => {
      try {
        const transferRef = doc(collection(db, 'transfers'));
        const batch = writeBatch(db);
        const trackingDisabled = !isBorcMode && targetLab?.consumptionTrackingEnabled === false;

        const targetHospitalId = isBorcMode ? null : selectedLabId;

        itemsToShip.forEach((item: DepoStokItem & { transferAdet?: number }) => {
          const transferQty = item.transferAdet ?? (item.adet || 1);
          const originalQty = item.adet || 1;
          const isPartial = transferQty < originalQty;

          // Target Reference (If partial, we need a new ID for the target document)
          const targetRef = isPartial ? doc(collection(db, 'depoStok')) : doc(db, 'depoStok', item.id);
          const targetDocId = targetRef.id;

          if (isPartial) {
            // 1. UPDATE SOURCE: Subtract quantity
            const sourceRef = doc(db, 'depoStok', item.id);
            batch.update(sourceRef, {
              adet: originalQty - transferQty
            });

            // 2. CREATE TARGET: New document for shipped portion
            const targetData = {
              ...item,
              id: targetDocId,
              adet: transferQty,
              isShipped: true,
              sevkTarihi: Timestamp.now(),
              hedefKurum: targetName,
              hedefKurumId: targetHospitalId,
              transferId: transferRef.id,
              sourceDepotId: selectedDepotId,
              sourceDepotName: depotName,
            };
            delete (targetData as any).transferAdet;
            
            if (trackingDisabled) {
              // If tracking is disabled at target, just record consumption
              const consumptionRecord: Omit<ConsumptionRecord, 'id'> = {
                stokKodu: item.stokKodu,
                stokAdi: item.stokAdi,
                lotNumarasi: item.lotNumarasi || '',
                miad: item.miad as any,
                seriNumarasi: item.seriNumarasi || '',
                laboratoryId: selectedLabId || '',
                laboratoryName: targetName,
                consumptionTimestamp: new Date(),
                consumptionType: 'normal_kullanim' as const,
                userId: currentUser.uid ?? 'unknown',
                userName: currentUserProfile.name ?? currentUser.email ?? 'Unknown User',
              };
              batch.set(doc(collection(db, 'tuketimKayitlari')), consumptionRecord);
            } else {
              batch.set(targetRef, targetData);
            }
          } else {
            // FULL TRANSFER: Just update existing doc
            if (trackingDisabled) {
              batch.delete(targetRef);
              const consumptionRecord: Omit<ConsumptionRecord, 'id'> = {
                stokKodu: item.stokKodu,
                stokAdi: item.stokAdi,
                lotNumarasi: item.lotNumarasi || '',
                miad: item.miad as any,
                seriNumarasi: item.seriNumarasi || '',
                laboratoryId: selectedLabId || '',
                laboratoryName: targetName,
                consumptionTimestamp: new Date(),
                consumptionType: 'normal_kullanim' as const,
                userId: currentUser.uid ?? 'unknown',
                userName: currentUserProfile.name ?? currentUser.email ?? 'Unknown User',
              };
              batch.set(doc(collection(db, 'tuketimKayitlari')), consumptionRecord);
            } else {
              batch.set(targetRef, {
                isShipped: true, 
                sevkTarihi: Timestamp.now(), 
                hedefKurum: targetName,
                hedefKurumId: targetHospitalId,
                transferId: transferRef.id,
                sourceDepotId: selectedDepotId, 
                sourceDepotName: depotName,
              }, { merge: true });
            }
          }

          if (isBorcMode) {
            const borcRef = doc(collection(db, 'borcTransfers'));
            batch.set(borcRef, {
              fromDepotId: selectedDepotId, toBorcDepotId: selectedBorcDepotId,
              company: selectedCompany, stokKodu: item.stokKodu, stokAdi: item.stokAdi,
              lot: item.lotNumarasi, miad: item.miad, seriNumarasi: item.seriNumarasi,
              isReturned: false, timestamp: Timestamp.now(),
              adet: transferQty
            });
          }

          if (item.seriNumarasi) {
            const histRef = doc(collection(db, `serialHistory/${item.seriNumarasi}/events`));
            batch.set(histRef, { type: 'transfer', transferId: transferRef.id, details: { sourceDepotId: selectedDepotId, sourceDepotName: depotName, targetName, targetHospitalId, stokKodu: item.stokKodu, stokAdi: item.stokAdi, lotNumarasi: item.lotNumarasi, miad: item.miad, adet: transferQty }, timestamp: Timestamp.now() });
          }
          
          const itemRef = doc(db, 'transfers', transferRef.id, 'items', targetDocId);
          batch.set(itemRef, { 
            stokKodu: item.stokKodu, 
            stokAdi: item.stokAdi, 
            lotNumarasi: item.lotNumarasi || '', 
            miad: item.miad || '', 
            seriNumarasi: item.seriNumarasi || '', 
            adet: transferQty,
            anaBirim: productMetaByCode.get(item.stokKodu || '')?.anaBirim || 'Adet', 
            ambalajDegeri: productMetaByCode.get(item.stokKodu || '')?.ambalajDegeri ?? null 
          });
        });

        batch.set(transferRef, {
          id: transferRef.id, timestamp: serverTimestamp(), sourceDepotId: selectedDepotId,
          sourceDepotName: depotName, targetName, targetHospitalId: targetId || null,
          mode: isBorcMode ? 'borc' : 'lab', company: isBorcMode ? selectedCompany : null,
          itemCount: itemsToShip.length, createdByUid: currentUser.uid ?? '',
          createdByName: currentUserProfile.name ?? currentUser.email ?? '',
        });

        await batch.commit();

        await touchStockMetadata();

        toast({ title: 'Transfer Tamamlandı', description: `${itemsToShip.length} ürün başarıyla transfer edildi.` });
        setLastTransferCount(itemsToShip.length);
        
        confirmedViolations.forEach(v => {
          emitFefoOverride({
              actor: { uid: currentUserProfile.uid ?? '', name: currentUserProfile.name ?? 'Bilinmeyen' },
              action: 'direct_transfer',
              product: {
                  stokKodu: v.scannedItem.stokKodu,
                  stokAdi: v.scannedItem.stokAdi,
                  lot: v.scannedItem.lotNumarasi,
                  miad: v.scannedItem.miad ?? '',
              },
              shipmentId: transferRef.id,
              depotId: selectedDepotId,
          });
        });

        await autoPrintTutanakFromTransferId(db, transferRef.id, targetLab, currentUserProfile.name ?? currentUser.email ?? '');
        
        if (targetId && selectedDepotId) {
          try {
            const labTransferDocId = `${targetId}_${selectedDepotId}`;
            const labTransferRef = doc(db, 'labTransferDates', labTransferDocId);
            const now = new Date();
            const userName = currentUserProfile?.name || currentUser?.email || '';

            const transfersUpdate: Record<string, any> = {};
            itemsToShip.forEach((item) => {
              if (item.stokKodu) {
                transfersUpdate[item.stokKodu] = {
                  lastTransferDate: Timestamp.fromDate(now),
                  lastTransferBy: userName,
                };
              }
            });

            await setDoc(labTransferRef, {
              labId: targetId,
              depotId: selectedDepotId,
              labName: targetName,
              depotName: depotName,
              transfers: transfersUpdate,
              updatedAt: serverTimestamp(),
            }, { merge: true });

            direktTransferLogger.debug('labTransferDates güncellendi', { docId: labTransferDocId, updates: Object.keys(transfersUpdate) });
          } catch (transferError) {
            direktTransferLogger.error('labTransferDates güncellenemedi', transferError, { labId: targetId, depotId: selectedDepotId });
          }
        }

        direktTransferLogger.info('Transfer başarıyla tamamlandı', { transferId: transferRef.id, itemCount: itemsToShip.length, targetName, mode: isBorcMode ? 'borc' : 'lab' });
      } catch (err) {
        direktTransferLogger.error('Transfer commit hatası', err, { depotId: selectedDepotId, targetId, itemCount: itemsToShip.length });
        
        // --- ROLLBACK ---
        setDirectTransferItems(previousDirectTransferItems);
        toast({ title: 'İşlem İptal Edildi (Rollback)', description: 'Transfer sırasında bir hata oluştu, veriler eski haline getirildi.', variant: 'destructive' });
      }
    })();
  }, [currentUser, currentUserProfile, isBorcMode, selectedLabId, hospitals, borcDepots, selectedBorcDepotId, selectedDepotId, depotName, directTransferItems, allocateDocsForGroup, toast, selectedCompany, invalidateDepoStok, productMetaByCode]);


  const handleCompleteDirectTransfer = async () => {
    if (directTransferItems.length === 0) return;

    setShipmentLoading(true);

    const itemsToShip: DepoStokItem[] = [];

    // OPTIMIZED: Use batch allocation for all groups at once
    const groupRows = directTransferItems.filter(row => row.isGroup);
    const nonGroupRows = directTransferItems.filter(row => !row.isGroup);

    // Add non-group items directly (already allocated)
    itemsToShip.push(...nonGroupRows as DepoStokItem[]);

    // Batch allocate all groups in one query
    if (groupRows.length > 0) {
      const { allocations, error } = await batchAllocateForGroups(groupRows);

      if (error) {
        toast({
          title: 'Yetersiz Stok',
          description: `${error.stokAdi} ${error.lotNumarasi ? `(Lot: ${error.lotNumarasi})` : ''} için yeterli stok bulunmuyor.`,
          variant: 'destructive'
        });
        setShipmentLoading(false);
        return;
      }

      // Collect all allocated items
      groupRows.forEach(row => {
        const picks = allocations.get(row.key);
        if (picks) {
          itemsToShip.push(...picks);
        }
      });
    }

    // OPTIMIZED FEFO CHECK: Sadece ilgili ürünler için FEFO kontrolü yap
    const violations = await checkFefoOptimized(itemsToShip, selectedDepotId, currentCompanyId, isSuperAdmin);

    setShipmentLoading(false);

    if (violations.length > 0) {
      // Benzersiz violationları filtrele
      const uniqueViolations = violations.filter((v, i, a) =>
        a.findIndex(t => t.scannedItem.id === v.scannedItem.id) === i
      );
      setFefoViolations(uniqueViolations);
    } else {
      processTransfer();
    }
  };

  // Barkodsuz giriş için tüm non-serial ürünleri listele (lot_manual, qty_manual, lot_barcode, qty_barcode)
  const allNonSerialProducts = useMemo(() => {
    const opts: { code: string; name: string; tracking: TrackingMode }[] = [];
    products.forEach(p => {
        const stokKodu = p.stokKodu ?? '';
        if (!stokKodu) return;
        const tracking = productTracking[stokKodu] || resolveDefaultTrackingMode(p as any);
        // Seri takipli ürünleri hariç tut, diğer tüm takip modlarını dahil et
        if (tracking !== 'serial') {
            opts.push({ code: stokKodu, name: productNames[stokKodu] || stokKodu, tracking });
        }
    });
    return opts.sort((a,b) => a.name.localeCompare(b.name));
  }, [products, productTracking, productNames]);
  
  const handleAddAllStock = async () => {
    if (!selectedDepotId) return;
    const q = query(collection(db, 'depoStok'), where('depotId', '==', selectedDepotId), where('isShipped', '==', false));
    const snap = await getDocs(q);
    // Lot/adet takipli ürünler `adet: N` taşıyan tek bir doküman; seri takipli
    // ürünler doküman başına `adet: 1`. Her ikisinde de dokümandaki gerçek
    // adet kullanılmalı — yoksa lot dokümanları listede 1 birim olarak görünür.
    const items = filterByCompanyScope(
        snap.docs.map(d => {
            const data = d.data() as any;
            const docAdet = Number(data.adet);
            const safeAdet = Number.isFinite(docAdet) && docAdet > 0 ? Math.max(1, Math.floor(docAdet)) : 1;
            return {
                ...data,
                id: d.id,
                adet: safeAdet,
                key: d.id,
                isGroup: false,
            } as TransferRow;
        }),
        currentCompanyId,
        isSuperAdmin,
    );

    setDirectTransferItems(items);
    const totalAdet = items.reduce((sum, it) => sum + (it.adet ?? 1), 0);
    flashScanFeedback('success', `${items.length} kalem (${totalAdet} adet) transfer listesine eklendi.`);
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
          miad: item.miad ?? '',
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
      // itemId is a composite group key: stokKodu-lotNumarasi-miad
      // Match against the same composite key logic used in groupedTransferItems
      setDirectTransferItems(prev => prev.filter(item => {
        const compositeKey = `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;
        return compositeKey !== itemId;
      }));
    } else {
      setDirectTransferItems(prev => prev.filter(item => item.id !== itemId));
    }
  };

  const removeSerialFromGroup = (serialId: string) => {
    setDirectTransferItems(prev => prev.filter(item => item.id !== serialId));
  };

  const handleGroupAdetChange = (groupKey: string, newAdetStr: string) => {
    const newAdet = parseInt(newAdetStr, 10);
    if (isNaN(newAdet) || newAdet < 0) return;

    const makeCompositeKey = (item: TransferRow) => `${item.stokKodu}-${item.lotNumarasi || ''}-${item.miad || ''}`;

    setDirectTransferItems(prev => {
        const groupItems = prev.filter(item => item.isGroup && makeCompositeKey(item) === groupKey);
        if (groupItems.length > 0) {
            const updatedGroup = { ...groupItems[0], adet: newAdet };
            return [updatedGroup, ...prev.filter(item => !(item.isGroup && makeCompositeKey(item) === groupKey))];
        }
        // For non-group items (serial-tracked), we can't change adet individually
        return prev;
    });
  };

  // ── Computed: stepper state ──
  const stepperState = useMemo(() => {
    const hasSource = !!selectedDepotId;
    const hasTarget = isBorcMode ? (!!selectedBorcDepotId && !!selectedCompany) : !!selectedLabId;
    const hasItems = directTransferItems.length > 0;
    const totalAdet = directTransferItems.reduce((sum, item) => sum + (item.adet ?? 1), 0);
    const totalKalem = groupedTransferItems.length;
    return { hasSource, hasTarget, hasItems, totalAdet, totalKalem };
  }, [selectedDepotId, selectedLabId, isBorcMode, selectedBorcDepotId, selectedCompany, directTransferItems, groupedTransferItems]);

  // ── Computed: availability map for inline warnings ──
  const availabilityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of groupedTransferItems) {
      const key = group.lotNumarasi ? `${group.stokKodu}__${group.lotNumarasi}` : group.stokKodu;
      const stockItems = group.lotNumarasi
        ? (depotStockLookups.byLot.get(`${group.stokKodu}__${group.lotNumarasi}`) || [])
        : (depotStockLookups.byCode.get(group.stokKodu) || []);
      // Sum the `adet` field — lot-tracked items are stored as a single doc with adet:N,
      // so counting docs would under-report stock (root cause of the "1 adet okutabilirsiniz" bug).
      const available = stockItems.reduce((sum, item) => sum + ((item as any).adet ?? 1), 0);
      map.set(key, available);
    }
    return map;
  }, [groupedTransferItems, depotStockLookups]);

  // ── Computed: transfer readiness ──
  const isTransferReady = stepperState.hasSource && stepperState.hasTarget && stepperState.hasItems;

  // ── More menu state ──
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  return (
    <>
      <div
        className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 sm:space-y-5 min-h-screen"
        role="main"
        aria-label="Direkt transfer paneli"
      >
        {/* ══════════════════════ HEADER ══════════════════════ */}
        <div className="flex items-center gap-3">
          <BackButton fallback="/siparisler" aria-label="Geri dön" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)] flex items-center gap-2">
              <Truck className="h-5 w-5 text-[var(--dashboard-accent)]" />
              Direkt Transfer
            </h1>
            <p className="text-[11px] sm:text-xs text-[var(--dashboard-muted)] truncate">
              {depotName ? `${depotName}` : 'Depo seçin'}{' '}
              {selectedLabName ? `→ ${selectedLabName}` : isBorcMode && selectedCompany ? `→ ${selectedCompany} (Borç)` : ''}
            </p>
          </div>
          {/* Secondary actions */}
          <div className="flex items-center gap-1.5">
            {(currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'lojistik_sorumlusu' || currentUserProfile?.role === 'teknik_lojistik') && (
              <button
                onClick={() => router.push('/direkt-transfer/yedek-parca-transfer')}
                className="cihaz-tool-item hidden sm:flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700"
              >
                <Package className="h-3.5 w-3.5" />
                Yedek Parça
              </button>
            )}
            <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
              <PopoverTrigger asChild>
                <button className="cihaz-tool-item flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10">
                  <MoreHorizontal className="h-4 w-4 text-[var(--dashboard-muted)]" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="end">
                {(currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'lojistik_sorumlusu' || currentUserProfile?.role === 'teknik_lojistik') && (
                  <button onClick={() => { router.push('/direkt-transfer/yedek-parca-transfer'); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)] sm:hidden">
                    <Package className="h-4 w-4 text-emerald-600" /> Yedek Parça Transfer
                  </button>
                )}
                <button onClick={() => { router.push(`/transfer-gecmis?depotId=${selectedDepotId}`); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]" disabled={!selectedDepotId}>
                  <History className="h-4 w-4 text-[var(--dashboard-muted)]" /> Transfer Geçmişi
                </button>
                <button onClick={() => { router.push('/transfer-sablonlari'); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]">
                  <FileText className="h-4 w-4 text-[var(--dashboard-muted)]" /> Transfer Şablonları
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* ══════════════════════ STEPPER INDICATOR ══════════════════════ */}
        <div className="flex items-center justify-center gap-0 px-2">
          {[
            { label: 'Bağlam', done: stepperState.hasSource && stepperState.hasTarget, num: 1 },
            { label: 'Ürün Ekle', done: stepperState.hasItems, num: 2 },
            { label: 'Transfer', done: false, num: 3 },
          ].map((step, i) => (
            <React.Fragment key={step.num}>
              {i > 0 && (
                <div className={cn(
                  "flex-1 h-[2px] max-w-[60px] sm:max-w-[80px] transition-colors",
                  step.done || (i === 1 && stepperState.hasSource && stepperState.hasTarget)
                    ? "bg-[var(--dashboard-accent)]"
                    : "bg-[var(--dashboard-stroke)]"
                )} />
              )}
              <div className="flex flex-col items-center gap-1">
                <div className={cn(
                  "w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-all",
                  step.done
                    ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                    : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)]"
                )}>
                  {step.done ? <Check className="h-4 w-4" /> : step.num}
                </div>
                <span className="text-[10px] sm:text-xs font-medium text-[var(--dashboard-muted)]">{step.label}</span>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* ══════════════════════ 2-COL LAYOUT ══════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 sm:gap-5">
          {/* ── LEFT COLUMN: Context + Add Methods ── */}
          <div className="space-y-4">
            {/* ─── Context Card ─── */}
            <div className="cihaz-card-strong p-4 sm:p-5 space-y-3">
              <p className="cihaz-section-label">Kaynak & Hedef</p>

              {/* Source Depot */}
              <div className="space-y-1">
                <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Kaynak Depo</label>
                <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={prereqsLoading}>
                  <SelectTrigger className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10">
                    <SelectValue placeholder="Kaynak depo seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Target */}
              {!isBorcMode ? (
                <div className="space-y-1">
                  <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Hedef Laboratuvar</label>
                  <Popover open={isLabPopoverOpen} onOpenChange={setIsLabPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "w-full flex items-center justify-between px-3 h-10 rounded-xl text-sm transition-all",
                          selectedLabId
                            ? "bg-[var(--dashboard-surface)] border border-[var(--dashboard-stroke)] shadow-[var(--dashboard-raised-soft)] font-medium text-[var(--dashboard-text)]"
                            : "bg-[var(--dashboard-surface-2)] border border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)]"
                        )}
                        disabled={hospitals.length === 0}
                      >
                        <span className="truncate">{selectedLabName || 'Laboratuvar seçin'}</span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command>
                        <CommandInput placeholder="Laboratuvar ara..." />
                        <CommandList>
                          <CommandEmpty>Laboratuvar bulunamadı.</CommandEmpty>
                          <CommandGroup>
                            {hospitals.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')).map((lab) => (
                              <CommandItem key={lab.id} value={lab.name ?? ''} onSelect={() => { setSelectedLabId(lab.id); setIsLabPopoverOpen(false); }}>
                                <Check className={cn("mr-2 h-4 w-4", selectedLabId === lab.id ? "opacity-100" : "opacity-0")} />
                                {lab.name ?? ''}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              ) : null}

              {/* Borç Mode Toggle */}
              <div className="flex items-center justify-between pt-1">
                <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Borç Modu</label>
                <Switch checked={isBorcMode} onCheckedChange={setIsBorcMode} id="borc-mode" />
              </div>

              {/* Borç Fields */}
              {isBorcMode && (
                <div className="space-y-2 pt-1 border-t border-[var(--dashboard-stroke)]">
                  <div className="space-y-1">
                    <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Borç Depo <span className="text-red-500">*</span></label>
                    <Select value={selectedBorcDepotId} onValueChange={setSelectedBorcDepotId}>
                      <SelectTrigger className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10">
                        <SelectValue placeholder="Depo seçin" />
                      </SelectTrigger>
                      <SelectContent>{borcDepots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Firma <span className="text-red-500">*</span></label>
                    <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                      <SelectTrigger className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10">
                        <SelectValue placeholder="Firma seçin" />
                      </SelectTrigger>
                      <SelectContent>{borcDepots.find(d => d.id === selectedBorcDepotId)?.companies?.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Barcode Format */}
              <div className="pt-1 border-t border-[var(--dashboard-stroke)]">
                <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Barkod Formatı</label>
                <BarcodeFormatSelect
                  value={selectedFormatId || '__auto__'}
                  onChange={v => setSelectedFormatId(v)}
                  disabled={formatsLoading}
                />
              </div>
            </div>

            {/* ─── Add Methods Card ─── */}
            <div className="cihaz-card p-4 sm:p-5 space-y-3">
              {/* Last scanned feedback - at top of Ürün Ekle card */}
              {(lastScannedProduct || scanFeedback) && (
                <div className={cn(
                  "p-3 space-y-1 -mt-1 mb-1 rounded-xl transition-all duration-300",
                  scanFeedback?.type === 'success'
                    ? "ring-2 ring-green-500/60 bg-green-50/60 dark:bg-green-950/20"
                    : scanFeedback?.type === 'error'
                    ? "ring-2 ring-red-500/60 bg-red-50/60 dark:bg-red-950/20"
                    : "cihaz-pressed"
                )}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Son Okutulan</p>
                    {scanFeedback && (
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-wide",
                        scanFeedback.type === 'success' ? "text-green-600" : "text-red-600"
                      )}>
                        {scanFeedback.type === 'success' ? '✓ Başarılı' : '✗ Hata'}
                      </span>
                    )}
                  </div>
                  {scanFeedback?.type === 'error' && !lastScannedProduct ? (
                    <p className="text-sm font-bold text-red-600 truncate">{scanFeedback.message}</p>
                  ) : (
                    <>
                      <p className={cn(
                        "text-sm font-bold truncate",
                        scanFeedback?.type === 'error' ? "text-red-600" : "text-[var(--dashboard-text)]"
                      )}>
                        {scanFeedback?.type === 'error' ? scanFeedback.message : lastScannedProduct?.stokAdi}
                      </p>
                      {lastScannedProduct && scanFeedback?.type !== 'error' && (
                        <>
                          <p className="text-[11px] text-[var(--dashboard-muted)]">
                            {lastScannedProduct.lotNumarasi && `Lot: ${lastScannedProduct.lotNumarasi}`}
                            {lastScannedProduct.miad && ` · Miad: ${lastScannedProduct.miad}`}
                            {lastScannedProduct.seriNumarasi && ` · Seri: ${lastScannedProduct.seriNumarasi}`}
                          </p>
                          <div className="flex gap-4 pt-1">
                            <div>
                              <span className="text-lg font-bold text-[var(--dashboard-accent)]">{lotCount}</span>
                              <span className="text-[10px] text-[var(--dashboard-muted)] ml-1">Bu Lot</span>
                            </div>
                            <div>
                              <span className="text-lg font-bold text-[var(--dashboard-accent)]">{totalCountForProduct}</span>
                              <span className="text-[10px] text-[var(--dashboard-muted)] ml-1">Toplam</span>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
              <p className="cihaz-section-label">Ürün Ekle</p>

              {/* Scan buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setIsBatchScanning(false); setIsCameraScannerOpen(true); }}
                  disabled={shipmentLoading || (!isBorcMode && !selectedLabId) || (isBorcMode && !selectedCompany)}
                  className="cihaz-action-tile flex flex-col items-center gap-1.5 py-3 px-2 text-center disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
                >
                  <Camera className="h-5 w-5 text-[var(--dashboard-accent)]" />
                  <span className="text-xs font-semibold text-[var(--dashboard-text)]">Tekli Tara</span>
                </button>
                <button
                  onClick={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }}
                  disabled={shipmentLoading || (!isBorcMode && !selectedLabId) || (isBorcMode && !selectedCompany)}
                  className="cihaz-action-tile flex flex-col items-center gap-1.5 py-3 px-2 text-center disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
                >
                  <Camera className="h-5 w-5 text-[var(--dashboard-accent)]" />
                  <span className="text-xs font-semibold text-[var(--dashboard-text)]">Seri Tara</span>
                </button>
              </div>
              <button
                onClick={() => {
                  const next = !isBulkScanMode;
                  setIsBulkScanMode(next);
                  flashScanFeedback(
                    next ? 'success' : 'success',
                    next ? 'Toplu barkod modu açık' : 'Normal barkod okuma moduna dönüldü.'
                  );
                }}
                disabled={shipmentLoading || (!isBorcMode && !selectedLabId) || (isBorcMode && !selectedCompany)}
                className={cn(
                  "cihaz-tool-item w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none",
                  isBulkScanMode && "bg-[var(--dashboard-accent)] text-white"
                )}
              >
                <QrCode className="h-4 w-4" />
                Toplu Barkod Oku
              </button>

              {/* Secondary add methods */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setShowManualInline(v => !v)}
                  className={cn(
                    "cihaz-tool-item flex flex-col items-center gap-1 py-2.5 px-2 text-center",
                    showManualInline && "shadow-[var(--dashboard-pressed)] bg-[var(--dashboard-surface-2)]"
                  )}
                >
                  <Plus className="h-4 w-4 text-[var(--dashboard-muted)]" />
                  <span className="text-[10px] sm:text-xs font-medium text-[var(--dashboard-text)]">Manuel</span>
                </button>
                <button
                  onClick={() => { setShowTemplateSelector(v => !v); fetchTemplates(); }}
                  className={cn(
                    "cihaz-tool-item flex flex-col items-center gap-1 py-2.5 px-2 text-center",
                    showTemplateSelector && "shadow-[var(--dashboard-pressed)] bg-[var(--dashboard-surface-2)]"
                  )}
                >
                  <ListChecks className="h-4 w-4 text-[var(--dashboard-muted)]" />
                  <span className="text-[10px] sm:text-xs font-medium text-[var(--dashboard-text)]">Şablon</span>
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      disabled={!selectedDepotId}
                      className="cihaz-tool-item flex flex-col items-center gap-1 py-2.5 px-2 text-center disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      <DatabaseZap className="h-4 w-4 text-[var(--dashboard-muted)]" />
                      <span className="text-[10px] sm:text-xs font-medium text-[var(--dashboard-text)]">Tüm Stok</span>
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Bu işlem, &quot;{depotName}&quot; deposundaki sevk edilmemiş tüm ürünleri transfer listesine ekleyecektir.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>İptal</AlertDialogCancel>
                      <AlertDialogAction onClick={handleAddAllStock}>Evet, Tümünü Ekle</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

            </div>

            {/* ─── Manual Adder (collapsible drawer) ─── */}
            {showManualInline && (
              <div className="cihaz-card p-4 sm:p-5 relative">
                <button
                  onClick={() => setShowManualInline(false)}
                  className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors"
                >
                  <X className="h-3.5 w-3.5 text-[var(--dashboard-muted)]" />
                </button>
                <ManualInlineAdder
                  visible={showManualInline}
                  onClose={() => setShowManualInline(false)}
                  depotName={depotName}
                  stockPool={depotStockData}
                  transferRows={directTransferItems}
                  products={allNonSerialProducts}
                  onAddLot={({ code, name, lot, miad, qty }) => {
                    upsertGroupedRow({ stokKodu: code, stokAdi: name, lotNumarasi: lot, miad: miad ?? '' }, qty);
                  }}
                  onAddQty={({ code, name, qty }) => {
                    upsertGroupedRow({ stokKodu: code, stokAdi: name }, qty);
                  }}
                />
              </div>
            )}

            {/* ─── Template Selector (collapsible drawer) ─── */}
            {showTemplateSelector && (
              <div className="cihaz-card p-4 sm:p-5">
                <TemplateSelector
                  visible={showTemplateSelector}
                  onClose={() => setShowTemplateSelector(false)}
                  templates={templates}
                  templatesLoading={templatesLoading}
                  stockPool={depotStockData}
                  transferRows={directTransferItems}
                  onAddLot={({ code, name, lot, miad, qty }) => {
                    upsertGroupedRow({ stokKodu: code, stokAdi: name, lotNumarasi: lot, miad: miad ?? '' }, qty);
                  }}
                  onAddQty={({ code, name, qty }) => {
                    upsertGroupedRow({ stokKodu: code, stokAdi: name }, qty);
                  }}
                />
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN: Product List + Validate + Submit ── */}
          <div className="cihaz-card-strong flex flex-col overflow-hidden">
            {/* ── List toolbar ── */}
            <div className="flex items-center gap-2 sm:gap-3 px-4 py-3 sm:px-5 border-b border-[var(--dashboard-stroke)]">
              <div className="flex-shrink-0">
                <h2 className="text-sm sm:text-base font-semibold text-[var(--dashboard-text)]">
                  Transfer Listesi
                  <span className="ml-1.5 text-[var(--dashboard-muted)]">({stepperState.totalKalem})</span>
                </h2>
                <p className="text-[10px] sm:text-xs text-[var(--dashboard-muted)]">
                  {stepperState.totalAdet} adet ürün transfer edilecek
                </p>
              </div>
              <div className="flex-1" />
              {directTransferItems.length > 0 && (
                <button
                  onClick={() => setDirectTransferItems([])}
                  className="cihaz-tool-item flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Temizle</span>
                </button>
              )}
              {stepperState.totalAdet > 0 && (
                <div className="flex items-baseline gap-1.5 ml-1">
                  <span className="text-2xl sm:text-3xl font-extrabold tabular-nums text-[var(--dashboard-text)]">{stepperState.totalAdet}</span>
                  <span className="text-xs font-medium text-[var(--dashboard-muted)]">adet</span>
                </div>
              )}
              <button
                onClick={handleCompleteDirectTransfer}
                disabled={!isTransferReady || shipmentLoading}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-2xl text-sm font-bold transition-all",
                  isTransferReady && !shipmentLoading
                    ? "bg-green-600 text-white shadow-[var(--dashboard-raised)] hover:shadow-[var(--dashboard-raised-soft)] active:shadow-[var(--dashboard-pressed)] hover:-translate-y-0.5 active:translate-y-0"
                    : "cihaz-pressed text-[var(--dashboard-muted)] cursor-not-allowed"
                )}
              >
                {shipmentLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Truck className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Transfer Et</span>
              </button>
            </div>

            {/* ── Table header (desktop) ── */}
            {directTransferItems.length > 0 && (
              <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_80px_90px_40px] gap-1 px-4 sm:px-5 py-2 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)]">
                <span>Ürün</span>
                <span>Lot / Miad</span>
                <span>Depoda</span>
                <span className="text-center">Adet</span>
                <span className="text-center">Birim</span>
                <span></span>
              </div>
            )}

            {/* ── Table body ── */}
            <div className="flex-1 overflow-hidden">
              {directTransferItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[35vh] sm:h-[45vh] text-center px-4">
                  <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                    <Search className="h-6 w-6 text-[var(--dashboard-muted)]" />
                  </div>
                  <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Henüz ürün eklenmedi</p>
                  <p className="text-xs text-[var(--dashboard-muted)] mb-4">Barkod okutun veya sol panelden bir yöntem seçin</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    <button
                      onClick={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }}
                      disabled={!stepperState.hasSource || !stepperState.hasTarget}
                      className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      <Camera className="h-3.5 w-3.5 text-[var(--dashboard-accent)]" />
                      Seri Tarama Başlat
                    </button>
                    <button
                      onClick={() => setShowManualInline(true)}
                      className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium"
                    >
                      <Plus className="h-3.5 w-3.5 text-[var(--dashboard-accent)]" />
                      Manuel Ekle
                    </button>
                  </div>
                </div>
              ) : (
                <VirtualizedList<typeof groupedTransferItems[number]>
                  items={groupedTransferItems}
                  height="calc(100vh - 380px)"
                  estimateSize={72}
                  overscan={5}
                  getItemKey={(item: typeof groupedTransferItems[number]) => item.key}
                  renderItem={(group: typeof groupedTransferItems[number]) => {
                    const stockKey = group.lotNumarasi ? `${group.stokKodu}__${group.lotNumarasi}` : group.stokKodu;
                    const available = availabilityMap.get(stockKey) ?? 0;
                    const isOverStock = group.adet > available && available > 0;
                    const noStock = available === 0;
                    const meta = productMetaByCode.get(group.stokKodu || '');
                    const multiplier = formatUnitMultiplier(meta);

                    return (
                      <div className={cn(
                        "border-b border-[var(--dashboard-stroke)] last:border-b-0",
                        isOverStock && "bg-red-50/50",
                        noStock && "bg-amber-50/30"
                      )}>
                        {/* Desktop row */}
                        <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_80px_90px_40px] gap-1 items-center px-4 sm:px-5 py-2.5">
                          {/* Product */}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate">{group.stokAdi}</p>
                            <p className="text-[11px] text-[var(--dashboard-muted)]">{group.stokKodu}</p>
                            <p className="text-[10px] text-[var(--dashboard-muted)]">{normalizeUnitLabel(meta?.anaBirim)}{multiplier ? ` (${multiplier})` : ''}</p>
                          </div>
                          {/* Lot / Miad chips */}
                          <div className="flex flex-wrap gap-1">
                            {group.lotNumarasi && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[var(--dashboard-surface-2)] text-[10px] font-medium text-[var(--dashboard-text)]">
                                {group.lotNumarasi}
                              </span>
                            )}
                            {group.miad && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[var(--dashboard-surface-2)] text-[10px] font-medium text-[var(--dashboard-muted)]">
                                {group.miad}
                              </span>
                            )}
                            {!group.lotNumarasi && !group.miad && (
                              <span className="text-[10px] text-[var(--dashboard-muted)]">-</span>
                            )}
                          </div>
                          {/* Depot stock */}
                          <div>
                            <span className={cn(
                              "text-xs font-semibold",
                              noStock ? "text-amber-600" : isOverStock ? "text-red-600" : "text-[var(--dashboard-text)]"
                            )}>
                              {available > 0 ? available : '?'}
                            </span>
                            <span className="text-[10px] text-[var(--dashboard-muted)] ml-1">{normalizeUnitLabel(meta?.anaBirim)}</span>
                          </div>
                          {/* Quantity stepper */}
                          <div className="flex items-center justify-center">
                            {group.isGroup ? (
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={() => handleGroupAdetChange(group.key, String(Math.max(1, group.adet - 1)))}
                                  className="w-6 h-6 rounded-md bg-[var(--dashboard-surface-2)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <Input
                                  type="number"
                                  value={group.adet}
                                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleGroupAdetChange(group.key, e.target.value)}
                                  className="w-12 h-7 text-center text-xs font-bold border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] rounded-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  min="1"
                                />
                                <button
                                  onClick={() => handleGroupAdetChange(group.key, String(group.adet + 1))}
                                  className="w-6 h-6 rounded-md bg-[var(--dashboard-surface-2)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-sm font-bold text-[var(--dashboard-text)]">{formatQuantityWithUnit(group.adet, meta, { showMultiplier: true })}</span>
                            )}
                          </div>
                          {/* Unit */}
                          <div className="flex justify-center">
                            <span className="text-[11px] text-[var(--dashboard-muted)]">
                              {normalizeUnitLabel(meta?.anaBirim)}{multiplier ? ` (${multiplier})` : ''}
                            </span>
                          </div>
                          {/* Delete */}
                          <div className="flex justify-center">
                            <button
                              onClick={() => removeTransferItem(group.key, true)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-100 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          </div>
                        </div>
                        {/* Mobile row */}
                        <div className="sm:hidden px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate">{group.stokAdi}</p>
                              <p className="text-[11px] text-[var(--dashboard-muted)]">{group.stokKodu}</p>
                              <p className="text-[10px] text-[var(--dashboard-muted)]">{normalizeUnitLabel(meta?.anaBirim)}{multiplier ? ` (${multiplier})` : ''}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {group.lotNumarasi && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[var(--dashboard-surface-2)] text-[10px] font-medium">{group.lotNumarasi}</span>
                                )}
                                {group.miad && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[var(--dashboard-surface-2)] text-[10px] font-medium text-[var(--dashboard-muted)]">{group.miad}</span>
                                )}
                                <span className={cn(
                                  "inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium",
                                  noStock ? "bg-amber-100 text-amber-700" : isOverStock ? "bg-red-100 text-red-700" : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)]"
                                )}>
                                  Stok: {available > 0 ? `${available} ${normalizeUnitLabel(meta?.anaBirim)}` : '?'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {group.isGroup ? (
                                <div className="flex items-center gap-0.5">
                                  <button onClick={() => handleGroupAdetChange(group.key, String(Math.max(1, group.adet - 1)))} className="w-7 h-7 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center">
                                    <Minus className="h-3 w-3" />
                                  </button>
                                  <Input
                                    type="number"
                                    value={group.adet}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleGroupAdetChange(group.key, e.target.value)}
                                    className="w-10 h-7 text-center text-xs font-bold border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] rounded-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    min="1"
                                  />
                                  <button onClick={() => handleGroupAdetChange(group.key, String(group.adet + 1))} className="w-7 h-7 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center">
                                    <Plus className="h-3 w-3" />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-sm font-bold mr-1">{formatQuantityWithUnit(group.adet, meta, { showMultiplier: true })}</span>
                              )}
                              <span className="text-[10px] text-[var(--dashboard-muted)] mr-1">{normalizeUnitLabel(meta?.anaBirim)}{multiplier ? ` (${multiplier})` : ''}</span>
                              <button onClick={() => removeTransferItem(group.key, true)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-100 ml-1">
                                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                              </button>
                            </div>
                          </div>
                          {/* Inline warning */}
                          {isOverStock && (
                            <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> Maksimum: {available} (Depoda kalan)
                            </p>
                          )}
                        </div>
                        {/* Desktop inline warning */}
                        {isOverStock && (
                          <div className="hidden sm:flex items-center gap-1.5 px-5 pb-2 text-[10px] text-red-600">
                            <AlertTriangle className="h-3 w-3" /> Maksimum: {available} adet (Depoda kalan stok)
                          </div>
                        )}
                        {/* Serials sub-list with deletable chips */}
                        {group.serials.length > 0 && (
                          <div className="px-4 sm:px-5 py-2 bg-[var(--dashboard-surface-2)]/50">
                            <div className="flex flex-wrap gap-1.5">
                              {group.serials.slice(0, 50).map(serial => (
                                <span
                                  key={serial.id}
                                  className="group/chip inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--dashboard-surface)] border border-[var(--dashboard-stroke)] text-[10px] font-mono text-[var(--dashboard-muted)] hover:border-red-300 transition-colors"
                                >
                                  <span className="truncate max-w-[120px]">{serial.seriNumarasi}</span>
                                  <button
                                    onClick={() => removeSerialFromGroup(serial.id)}
                                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-40 hover:opacity-100 hover:bg-red-100 hover:text-red-600 transition-all"
                                    title="Seri numarasını kaldır"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              ))}
                              {group.serials.length > 50 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--dashboard-surface-2)] text-[10px] text-[var(--dashboard-muted)]">
                                  +{group.serials.length - 50} daha...
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
              )}
            </div>

            {/* ── Mini summary bar ── */}
            <div className="border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] px-4 sm:px-5 py-2.5 flex items-center gap-3 text-xs">
              <div>
                <span className="text-[var(--dashboard-muted)]">Kalem</span>
                <span className="ml-1 font-bold text-[var(--dashboard-text)]">{stepperState.totalKalem}</span>
              </div>
              <div>
                <span className="text-[var(--dashboard-muted)]">Adet</span>
                <span className="ml-1 font-bold text-[var(--dashboard-text)]">{stepperState.totalAdet}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════ MODALS ══════════════════════ */}

      {/* Camera Scanner */}
      <Dialog open={isCameraScannerOpen} onOpenChange={setIsCameraScannerOpen}>
        <DialogContent className="max-w-md p-0">
          <DialogHeader className="p-4">
            <DialogTitle>Kamera ile Tara</DialogTitle>
            {isBatchScanning && (
              <DialogDescription className="px-4">Seri tarama açık. Bitince pencereyi kapatın.</DialogDescription>
            )}
          </DialogHeader>
          {isCameraScannerOpen && (
            <Suspense fallback={
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
                <p className="ml-2 text-[var(--dashboard-muted)]">Kamera...</p>
              </div>
            }>
              <CameraScanner onScanSuccess={handleCameraScan} onClose={() => setIsCameraScannerOpen(false)} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>

      {/* FEFO Violation Dialog */}
      <AlertDialog open={fefoViolations.length > 0} onOpenChange={(open) => !open && setFefoViolations([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-amber-500" />
              FEFO Uyarısı
            </AlertDialogTitle>
            <AlertDialogDescription>
              Transfer listesinde, depoda daha erken miadlı alternatifi olan ürünler var. Yine de devam etmek istiyor musunuz? Onaylarsanız bu durum kaydedilecektir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ScrollArea className="max-h-60 mt-4 border rounded-md p-2">
            {fefoViolations.map((v, i) => (
              <div key={i} className="text-sm p-3 mb-2 bg-[var(--dashboard-surface-2)] rounded-xl">
                <p className="font-semibold text-[var(--dashboard-text)]">{v.scannedItem.stokAdi}</p>
                <p className="text-[var(--dashboard-muted)] text-xs mt-1">
                  Okutulan: {v.scannedItem.lotNumarasi} (Miad: {v.scannedItem.miad ?? ''})
                </p>
                <p className="text-green-600 text-xs">
                  Önerilen: {v.recommendedItem.lotNumarasi} (Miad: {v.recommendedItem.miad ?? ''})
                </p>
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

