/**
 * @fileoverview Mal Kabul (Goods Receiving) Main Panel Component
 * @description Enterprise-grade goods receiving panel with barcode scanning,
 * OCR support, batch processing, and comprehensive inventory management.
 * @module components/ana-panel
 * @version 2.0.0
 */

'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

// Type imports
import type {
  ScannedItem,
  ProductCode,
  DepotStockCountSession
} from '@/lib/types';
import type { IrsaliyeParseResult } from '@/lib/mal-kabul/types';
import type { ParsedGeneric, BarcodeFormat } from '@/lib/barcode';

// Hooks
import { useToast } from "@/hooks/use-toast";
import { useDepots, useProductCodes, useAddressDefinitions, useBarcodeFormatsQuery, useUsers, useDepoStokByDepot, useInvalidateQueries, touchStockMetadata } from '@/hooks/useFirebaseQueries';
import { TrackingMode, resolveDefaultTrackingMode, resolveEffectiveTrackingMode } from '@/lib/tracking';
import useHidScanner from '@/hooks/useHidScanner';
import { useAuth } from '@/contexts/auth-context';
import { useLoading } from '@/contexts/loading-context';

// UI Components
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

// Icons
import { Trash2, CheckSquare, PlusCircle, Loader2, Search, History, Camera, ScanLine, Package, MapPin, FileText, X, Undo2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

// Firebase
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, Timestamp, onSnapshot } from 'firebase/firestore';

// Utilities
import { cn, generateId, playFeedback } from '@/lib/utils';
import { parseAnyBarcode, resolveProductFromParsed } from '@/lib/barcode';
import { normalizeMiad } from '@/components/common/ExpiryDateInput';

// Logging & Validation
import { malKabulLogger, createCorrelationId } from '@/lib/logger';
import { sanitizeBarcode, sanitizeStockCode, securityCheck } from '@/lib/mal-kabul/validation';
import { filterOperationalSourceDepots } from '@/lib/depot-access';

// Child Components
import ManualInlineAdder from '@/components/mal-kabul/ManualInlineAdder';
import IrsaliyeOcrModal from '@/components/mal-kabul/IrsaliyeOcrModal';
import { VirtualizedList } from '@/components/ui/virtualized-list';

// =============================================================================
// DYNAMIC IMPORTS
// =============================================================================

/**
 * Dynamic camera barcode scanner component
 * @description Loaded dynamically to reduce initial bundle size
 */
const DynamicCameraBarcodeScanner = dynamic(
  () => import('@/components/camera-barcode-scanner'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center p-8" role="status" aria-label="Kamera yükleniyor">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="ml-2">Kamera Yükleniyor...</p>
      </div>
    ),
  }
);

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Extended scanned item with grouping support
 * @description Represents a single scanned item or a group of items with the same lot
 */
type ScanRow = ScannedItem & {
  /** Quantity of items (for grouped/lot items) */
  adet?: number;
  /** Whether this row represents a grouped item */
  isGroup?: boolean;
  /** Expected quantity (for verification) */
  expectedAdet?: number;
  /** List of scanned serial numbers in this group */
  scannedSerials?: string[];
  /** Unique key for grouping (stokKodu-lot-miad) */
  key?: string;
  /** Child items for grouped rows */
  items?: ScannedItem[];
};

/**
 * QR transfer item structure
 */
type QrItem = {
  /** Product stock code */
  k: string;
  /** Product name */
  a: string;
  /** Lot number */
  l?: string;
  /** Expiry date */
  m?: string;
  /** Serial number */
  s?: string;
  /** Quantity */
  q: number;
};

/**
 * QR transfer payload structure
 */
type QrPayload = {
  t: 'transfer';
  v: number;
  id: string;
  d: string;
  src: string;
  dst: string;
  cmp: string;
  items: QrItem[];
};

/**
 * Mal Kabul transaction line item
 */
type MalKabulLine = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  adet: number;
  serials: string[];
};

/**
 * Mal Kabul transaction header
 */
type MalKabulHeader = {
  transactionId: string;
  depotId: string;
  depotName: string;
  userId: string;
  userName: string;
  timestamp: Timestamp;
  itemCount: number;
  brands: string[];
  mode: 'verified' | 'unverified';
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Decode URL-safe base64 string
 * @param b64url - URL-safe base64 encoded string
 * @returns Decoded string
 */
function fromB64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = typeof window !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Convert a Date or unknown value to Firestore Timestamp
 * @param d - Date value or undefined
 * @returns Firestore Timestamp
 */
const toFsTimestamp = (d?: Date | unknown): Timestamp => {
  try {
    if (d instanceof Date && !isNaN(d.getTime())) return Timestamp.fromDate(d);
  } catch {
    malKabulLogger.warn('Failed to convert date to Timestamp', { date: String(d) });
  }
  return Timestamp.now();
};

/**
 * Convert value to string safely
 * @param v - Any value
 * @returns String representation or empty string
 */
const safeStr = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/**
 * Convert undefined to null for Firestore compatibility
 * @param v - Value that might be undefined
 * @returns Value or null
 */
const safeNullable = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);

/**
 * Remove undefined values from object recursively
 * @description Firestore doesn't accept undefined values, this strips them
 * @param val - Object or array to clean
 * @returns Cleaned object without undefined values
 */
const stripUndefined = (val: unknown): unknown => {
  if (Array.isArray(val)) return val.map(stripUndefined).filter(v => v !== undefined);
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    Object.keys(val).forEach(k => {
      const v = stripUndefined((val as Record<string, unknown>)[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  return val === undefined ? undefined : val;
};

// =============================================================================
// GROUPED ROW MANAGEMENT
// =============================================================================

/**
 * Upsert a grouped row in the scanned items list
 * @description If a matching row exists, increments its quantity. Otherwise creates a new row.
 * @param setScannedItems - State setter for scanned items
 * @param base - Base product information
 * @param match - Function to match existing rows
 * @param delta - Quantity to add (default: 1)
 */
function upsertGroupedRow(
  setScannedItems: React.Dispatch<React.SetStateAction<ScanRow[]>>,
  base: { stokKodu: string; stokAdi: string; lot?: string; miad?: string; barkod?: string },
  match: (r: ScanRow) => boolean,
  delta = 1
) {
  setScannedItems((prev): ScanRow[] => {
    const idx = prev.findIndex(match);
    if (idx >= 0) {
      const copy = [...prev];
      const existingItem = { ...copy[idx] };
      existingItem.adet = (existingItem.adet ?? 1) + delta;
      existingItem.timestamp = new Date();
      copy[idx] = existingItem;
      return copy;
    }
    
    // If no match found, create a new item
    const key = `${base.stokKodu}-${base.lot || ''}-${base.miad || ''}`;
    const row: ScanRow = {
      id: generateId(),
      barkod: base.barkod || 'MANUAL',
      stokKodu: base.stokKodu,
      stokAdi: base.stokAdi,
      lotNumarasi: base.lot || '',
      miad: base.miad || '',
      seriNumarasi: '',
      rafAdresi: '',
      irsaliyeNumarasi: '',
      isSelected: false,
      timestamp: new Date(),
      isProcessed: false,
      adet: delta,
      isGroup: true,
      key: key,
    };
    return [row, ...prev];
  });
}


interface AnaPanelProps {}

interface PreCheckWarning {
  shortShelfLife: ScannedItem[];
  maxOverload: { name: string; current: number; max: number; incoming: number }[];
  usageRisk: (ScanRow & { monthlyUsage: number; monthsLeft: number })[];
}

class BatchQueue {
  private db: typeof db;
  private chunkSize: number;
  private _batch = writeBatch(db);
  private _opCount = 0;
  private _commits = 0;
  private onProgress?: (info: { commits: number; pending: number }) => void;
  constructor(opts: { chunkSize?: number; onProgress?: (info: { commits: number; pending: number }) => void } = {}) {
    this.db = db;
    this.chunkSize = opts.chunkSize ?? 450;
    this.onProgress = opts.onProgress;
  }
  get opCount() { return this._opCount; }
  get commits() { return this._commits; }
  async set(ref: ReturnType<typeof doc>, data: any) {
    this._batch.set(ref, data);
    this._opCount += 1;
    if (this._opCount >= this.chunkSize) {
      await this.commit();
    }
  }
  async delete(ref: ReturnType<typeof doc>) {
    this._batch.delete(ref);
    this._opCount += 1;
    if (this._opCount >= this.chunkSize) {
      await this.commit();
    }
  }
  async commit() {
    if (this._opCount === 0) return;
    await this._batch.commit();
    this._commits += 1;
    this._batch = writeBatch(this.db);
    this._opCount = 0;
    this.onProgress?.({ commits: this._commits, pending: this._opCount });
  }
  async flush() {
    await this.commit();
  }
}

const enqueueSerialHistory = (
  q: BatchQueue,
  seriNo: string,
  type: string,
  details: any
) => {
  if (!seriNo) return;
  const ref = doc(collection(db, `serialHistory/${seriNo}/events`));
  return q.set(ref, {
    type,
    details,
    timestamp: Timestamp.now(),
  });
};


export default function AnaPanel(props: AnaPanelProps) {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser, currentUserProfile } = useAuth();
  const { suppressGlobalLoading } = useLoading();

  // Suppress global loading overlay for this panel - it interferes with barcode scanning
  useEffect(() => {
    const unsuppress = suppressGlobalLoading();
    return unsuppress;
  }, [suppressGlobalLoading]);

  // Use TanStack Query for static data - shared cache, 1 hour stale time
  const { data: depots = [], isLoading: depotsLoading } = useDepots();
  const { data: productCodes = [], isLoading: productsLoading } = useProductCodes();
  const { data: addressDefinitions = [] } = useAddressDefinitions();
  const { data: barcodeFormats = [] } = useBarcodeFormatsQuery();
  const { data: users = [] } = useUsers();
  const { invalidateDepoStok } = useInvalidateQueries();

  const [selectedDepotId, setSelectedDepotId] = useState<string>('');

  // Use TanStack Query for depot stock with polling
  const { data: depotStockData = [] } = useDepoStokByDepot(selectedDepotId);

  const isLoading = depotsLoading || productsLoading;
  const [isProcessingScan, setIsProcessingScan] = useState(false);

  const [scannedItems, setScannedItems] = useState<ScanRow[]>([]);
  const [lastScannedProduct, setLastScannedProduct] = useState<ScanRow | null>(null);
  const [scanStatus, setScanStatus] = useState<'idle'|'success'|'error'>('idle');
  const [isPreCheckModalOpen, setIsPreCheckModalOpen] = useState(false);
  const [preCheckWarnings, setPreCheckWarnings] = useState<PreCheckWarning>({ shortShelfLife: [], maxOverload: [], usageRisk: [] });
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [isBatchScanning, setIsBatchScanning] = useState(false);
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);

  const [showManualInline, setShowManualInline] = useState(false);
  
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [availableSessions, setAvailableSessions] = useState<DepotStockCountSession[]>([]);
  const [activeSession, setActiveSession] = useState<DepotStockCountSession | null>(null);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [joining, setJoining] = useState(false);

  const [showUnverified, setShowUnverified] = useState(false);
  const [commitInfo, setCommitInfo] = useState<{ commits: number; pending: number } | null>(null);
  
  // Map: stokKodu -> Set<seriNumarasi> - oturum içi mükerrer kontrolü ürün bazında
  const scannedSerialsRef = useRef(new Map<string, Set<string>>());


  const incomingQuantities = useMemo(() => {
    return scannedItems
      .filter(i => !i.isProcessed)
      .reduce((acc, item) => {
        const add = item.adet ?? 1;
        const code = (item.stokKodu ?? '') as string;
        if (code) {
          acc[code] = (acc[code] || 0) + add;
        }
        return acc;
      }, {} as Record<string, number>);
  }, [scannedItems]);

  // Compute productTracking and productNames from productCodes (TanStack Query data)
  const sourceDepots = useMemo(() => filterOperationalSourceDepots(depots, currentUserProfile), [depots, currentUserProfile]);

  const { productTracking, productNames } = useMemo(() => {
    const t: Record<string, TrackingMode> = {};
    const names: Record<string, string> = {};
    productCodes.forEach(p => {
      const code = p.stokKodu || '';
      if (!code) return;
      names[code] = p.stokAdi || code;
      if ((p as any).trackingMode) t[code] = (p as any).trackingMode as TrackingMode;
    });
    return { productTracking: t, productNames: names };
  }, [productCodes]);

  // Auto-select first depot when loaded
  useEffect(() => {
    if (sourceDepots.length > 0 && !selectedDepotId && sourceDepots[0].id) {
      setSelectedDepotId(sourceDepots[0].id);
    }
  }, [sourceDepots, selectedDepotId]);

  // Build existing serials map from TanStack Query data (polling instead of real-time listener)
  // This reduces Firestore reads dramatically
  const existingDepotSerials = useMemo(() => {
    const serialsByProduct = new Map<string, Set<string>>();
    depotStockData.forEach(item => {
      const serial = item.seriNumarasi;
      const stokKodu = item.stokKodu;
      if (serial && stokKodu) {
        if (!serialsByProduct.has(stokKodu)) {
          serialsByProduct.set(stokKodu, new Set());
        }
        serialsByProduct.get(stokKodu)!.add(serial);
      }
    });
    return serialsByProduct;
  }, [depotStockData]);
  
  useEffect(() => {
    if (!selectedDepotId) {
      setAvailableSessions([]);
      if (activeSession) setActiveSession(null);
      return;
    }
    const q = query(collection(db, 'depotCountSessions'), where('depotId', '==', selectedDepotId), where('status', '==', 'active'));
    const unsub = onSnapshot(q, snap => {
      const sessions = snap.docs.map(d => ({ id: d.id, ...d.data() } as DepotStockCountSession));
      setAvailableSessions(sessions);

      if (activeSession) {
        const updatedSession = sessions.find(s => s.id === activeSession.id);
        if (!updatedSession) { // Session ended or deleted
          setActiveSession(null);
          setScannedItems([]); // Clear local items
          toast({ title: "Oturum Sona Erdi", description: "Mevcut sayım oturumu kapatıldı." });
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepotId]);

  useEffect(() => {
    if (!activeSession || !activeSession.id) return;
    const unsub = onSnapshot(collection(db, 'depotCountSessions', activeSession.id, 'scannedItems'), (snapshot) => {
        const sessionItems = snapshot.docs.map(d => ({...d.data(), id: d.id}) as ScanRow);
        setScannedItems(sessionItems.sort((a,b) => {
          const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : (a.timestamp as any)?.toDate?.()?.getTime?.() || 0;
          const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : (b.timestamp as any)?.toDate?.()?.getTime?.() || 0;
          return bTime - aTime;
        }));
    });
    return () => unsub();
  }, [activeSession]);

  const processScan = useCallback(async (barcodeData: string, source = 'barcode') => {
    setIsProcessingScan(true);
    try {
        if (barcodeData.includes('/qr/transfer?d=')) {
            const url = new URL(barcodeData);
            const dataParam = url.searchParams.get('d');
            if (dataParam) {
                const json = fromB64Url(dataParam);
                const payload = JSON.parse(json) as QrPayload;
            }
        }

        const parsed: ParsedGeneric | null = parseAnyBarcode(barcodeData, barcodeFormats);
        if (!parsed) throw new Error('Barkod tanımlı formatlarla eşleşmiyor.');

        const resolved = resolveProductFromParsed(parsed, productCodes as any);
        if (!resolved.product) throw new Error(`Barkod numarası/referans herhangi bir ürünle eşleşmedi.`);

        const { lotNumarasi, miadFormatted, seriNumarasi, stokKodu } = resolved;
        if (!stokKodu) throw new Error('Stok kodu bulunamadı.');

        const matchedProduct = resolved.product;

        // Determine tracking mode based on what the barcode contains
        const matchedFormat = parsed.matchedFormatId
          ? barcodeFormats.find(f => f.id === parsed.matchedFormatId)
          : undefined;
        const staticTrackingMode = productTracking[stokKodu] || resolveDefaultTrackingMode(matchedProduct as any);
        const mode = (staticTrackingMode === 'qty_manual' || staticTrackingMode === 'qty_barcode')
          ? 'qty_barcode'
          : resolveEffectiveTrackingMode(resolved, matchedFormat, matchedProduct as any);

        const isLotOnlyBarcode = (mode === 'serial') && !!lotNumarasi && !seriNumarasi;

        if ((mode === 'serial') && !isLotOnlyBarcode) {
            if (!seriNumarasi) throw new Error('Bu ürün seri numarası ile takip edilir, barkod seri içermiyor.');

            // Mükerrer kontrolü: aynı ürün için aynı seri numarası kontrol edilir
            const sessionSerials = scannedSerialsRef.current.get(stokKodu);
            const depotSerials = existingDepotSerials.get(stokKodu);
            const isInSession = sessionSerials?.has(seriNumarasi) ?? false;
            const isInDepot = depotSerials?.has(seriNumarasi) ?? false;

            if (isInSession || isInDepot) {
              playFeedback(true);
              const location = isInSession ? 'bu oturumda' : 'depoda';
              toast({ title: 'Uyarı', description: `Seri numarası ${seriNumarasi} (${matchedProduct.stokAdi}) ${location} zaten mevcut.`, variant: 'default'});
              if (source === 'barcode') { setScanStatus('error'); setTimeout(() => setScanStatus('idle'), 3000); }
              setIsProcessingScan(false);
              return;
            }

            const newItem: ScanRow = {
              id: generateId(), barkod: barcodeData, stokKodu: stokKodu, stokAdi: matchedProduct.stokAdi,
              lotNumarasi: lotNumarasi || '', miad: miadFormatted || '', seriNumarasi: seriNumarasi || '',
              rafAdresi: '', irsaliyeNumarasi: '', isSelected: false, timestamp: new Date(), isProcessed: false,
              adet: 1, isGroup: false
            };
            newItem.key = `${newItem.stokKodu}-${newItem.lotNumarasi}-${newItem.miad}`;
            // Oturum içi mükerrer takibi: stokKodu -> Set<seriNumarasi>
            if (!scannedSerialsRef.current.has(stokKodu)) {
              scannedSerialsRef.current.set(stokKodu, new Set());
            }
            scannedSerialsRef.current.get(stokKodu)!.add(seriNumarasi);
            setScannedItems(prev => [newItem, ...prev]);
            if (source === 'barcode') setLastScannedProduct(newItem);

        } else {
          // It's a lot-based or quantity-based item
          upsertGroupedRow(
            setScannedItems,
            { stokKodu: stokKodu, stokAdi: matchedProduct.stokAdi, lot: lotNumarasi, miad: miadFormatted, barkod: barcodeData },
            (r) => !!(r.isGroup && r.stokKodu === stokKodu && r.lotNumarasi === (lotNumarasi || '') && r.miad === (miadFormatted || '')),
            1
          );
          if (source === 'barcode') {
            const newItem = { stokKodu, stokAdi: matchedProduct.stokAdi, lotNumarasi, miad: miadFormatted, seriNumarasi: '' } as ScanRow;
            setLastScannedProduct(newItem);
          }
        }
        
        playFeedback();
        if (source === 'barcode') {
          setScanStatus('success');
          toast({ title: `Okuma Başarılı`, description: `${matchedProduct.stokAdi} listeye eklendi.` });
          setTimeout(() => setScanStatus('idle'), 3000);
        }

    } catch (err: any) {
      playFeedback(true);
      toast({ title: 'Ayrıştırma Hatası', description: err.message || 'Barkod işlenemedi.', variant: 'destructive' });
      if (source === 'barcode') {
        setScanStatus('error');
        setTimeout(() => setScanStatus('idle'), 3000);
      }
    } finally {
      setIsProcessingScan(false);
    }
  }, [toast, productCodes, barcodeFormats, existingDepotSerials]);

  useHidScanner({
    enabled: !isPreCheckModalOpen && !isProcessingScan && !isCameraScannerOpen && !showManualInline,
    onScan: ({ raw }) => {
      if (raw) processScan(raw, 'barcode');
    },
  });

  const handleCameraScanSuccess = (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (trimmed) {
      processScan(trimmed, 'barcode');
    } else {
      toast({ title: 'Kamera Tarama Hatası', description: 'Okunan veri boş görünüyor.', variant: 'destructive' });
    }
    if (!isBatchScanning) {
      setIsCameraScannerOpen(false);
    }
  };
  
  const handleOcrResults = (results: IrsaliyeParseResult[]) => {
    results.forEach(res => {
        const product = productCodes.find(p => p.stokKodu === res.stokKodu);
        if (!product) return;

        upsertGroupedRow(
            setScannedItems,
            { stokKodu: res.stokKodu, stokAdi: product.stokAdi || '', lot: res.lot, miad: res.miad },
            (r) => !!(r.isGroup && r.stokKodu === res.stokKodu && r.lotNumarasi === (res.lot || '') && r.miad === (res.miad || '')),
            res.quantity
        );
    });
  };

  const lotCount = useMemo(() => {
    if (!lastScannedProduct) return 0;
    return scannedItems
      .filter(item => item.stokKodu === lastScannedProduct.stokKodu && item.lotNumarasi === lastScannedProduct.lotNumarasi)
      .reduce((n, it) => n + (it.adet ?? 1), 0);
  }, [scannedItems, lastScannedProduct]);

  const totalCountForProduct = useMemo(() => {
    if (!lastScannedProduct) return 0;
    return scannedItems
      .filter(item => item.stokKodu === lastScannedProduct.stokKodu)
      .reduce((n, it) => n + (it.adet ?? 1), 0);
  }, [scannedItems, lastScannedProduct]);

  const groupedScannedItems = useMemo(() => {
    const grouped: Record<string, ScanRow> = {};
    scannedItems.forEach(item => {
      const key = item.key ?? `${item.stokKodu}-${item.lotNumarasi}-${item.miad}`;
      if (!grouped[key]) {
        grouped[key] = {
          ...item,
          items: [item],
          adet: item.isGroup ? (item.adet ?? 1) : 1,
          isGroup: true,
          key,
          isSelected: item.isSelected,
        };
      } else {
        if (!item.isGroup) {
          grouped[key].items?.push(item);
        }
        grouped[key].adet = (grouped[key].adet ?? 0) + (item.isGroup ? (item.adet ?? 1) : 1);
        if (item.isSelected) {
          grouped[key].isSelected = true;
        }
      }
    });
    return Object.values(grouped).sort((a, b) => {
      const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : (a.timestamp as any)?.toDate?.()?.getTime?.() || 0;
      const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : (b.timestamp as any)?.toDate?.()?.getTime?.() || 0;
      return bTime - aTime;
    });
  }, [scannedItems]);
  
  const toggleGroupSelection = (groupKey: string | undefined) => {
    if (!groupKey) return;
    const isCurrentlySelected = groupedScannedItems.find(g => g.key === groupKey)?.isSelected ?? false;
    setScannedItems(prev =>
      prev.map(item =>
        item.key === groupKey && !item.isProcessed
          ? { ...item, isSelected: !isCurrentlySelected }
          : item
      )
    );
  };
  
  const deleteGroup = (groupKey: string | undefined) => {
    if (!groupKey) return;
    setScannedItems(prev => {
        const itemsToRemove = prev.filter(item => item.key === groupKey);
        itemsToRemove.forEach(item => {
            if(item.seriNumarasi && item.stokKodu) {
                const productSerials = scannedSerialsRef.current.get(item.stokKodu);
                productSerials?.delete(item.seriNumarasi);
            }
        });
        return prev.filter(item => item.key !== groupKey);
    });
    toast({ title: 'Grup Silindi', description: 'Grup ve içindeki tüm ürünler listeden kaldırıldı.' });
  };

  const clearAllScannedItems = async () => {
    if (scannedItems.length === 0) return;
    setScannedItems([]);
    scannedSerialsRef.current.clear();
    setLastScannedProduct(null);
    setScanStatus('idle');
    toast({ title: 'Temizlendi', description: 'Tüm okutulan ürünler kaldırıldı.' });
  };

  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [isIrsaliyeModalOpen, setIsIrsaliyeModalOpen] = useState(false);
  const [selectedAddressBarcode, setSelectedAddressBarcode] = useState<string>('');
  const [addressAssignmentInput, setAddressAssignmentInput] = useState<string>('');
  const [irsaliyeNoInput, setIrsaliyeNoInput] = useState<string>('');
  const [malKabulIsLoading, setMalKabulIsLoading] = useState(false);

  const selectedItemsCount = useMemo(() => {
    return scannedItems.filter(i => i.isSelected && !i.isProcessed).length;
  }, [scannedItems]);
  
  const unprocessedScannedItems = scannedItems.filter(i => !i.isProcessed).length;
  
  const getBrandFor = (stockCode: string, name: string) => {
    const p = productCodes.find(p => p.stokKodu === stockCode) as any;
    return (p?.marka || p?.brand || name.split(' ')[0] || '').toString();
  };

  const buildTransactionLines = (rows: ScanRow[]): MalKabulLine[] => {
    const map = new Map<string, MalKabulLine>();
    for (const r of rows) {
      const key = `${r.stokKodu}||${r.lotNumarasi || ''}||${r.miad || ''}`;
      
      if (!map.has(key)) {
        map.set(key, {
          stokKodu: r.stokKodu || '',
          stokAdi: r.stokAdi || '',
          lotNumarasi: r.lotNumarasi || '',
          miad: r.miad || '',
          adet: 0,
          serials: [],
        });
      }
      
      const entry = map.get(key)!;
      entry.adet += (r.adet || 1);
      if (!r.isGroup && r.seriNumarasi) {
        entry.serials.push(r.seriNumarasi);
      }
    }
    return Array.from(map.values()).map(l => ({
      ...l,
      serials: Array.from(new Set(l.serials || [])).filter(Boolean),
    }));
  };

  const recordMalKabulTransaction = async (
    rows: ScanRow[],
    mode: 'verified' | 'unverified'
  ): Promise<string> => {
    const transactionId = `MK-${generateId()}`;
    const depotName = sourceDepots.find(d => d.id === selectedDepotId)?.name || 'Bilinmeyen Depo';
    const header: MalKabulHeader = {
      transactionId,
      depotId: selectedDepotId,
      depotName,
      userId: currentUser?.uid || '',
      userName: currentUserProfile?.name || currentUser?.email || 'Unknown',
      timestamp: Timestamp.now(),
      itemCount: rows.reduce((n, r) => n + Math.max(1, r.adet ?? 1), 0),
      brands: Array.from(new Set(rows.map(r => getBrandFor(r.stokKodu || '', r.stokAdi || '')).filter(Boolean))),
      mode
    };

    try {
      const txRef = doc(db, 'malKabulTransactions', transactionId);
      const batch = writeBatch(db);

      batch.set(txRef, stripUndefined(header));

      const lines = buildTransactionLines(rows);
      for (const line of lines) {
        const lineRef = doc(collection(txRef, 'lines'));
        const cleanLine = stripUndefined({
          stokKodu: line.stokKodu,
          stokAdi: line.stokAdi,
          lotNumarasi: line.lotNumarasi || '',
          miad: line.miad || '',
          adet: line.adet ?? 0,
          serials: Array.isArray(line.serials) ? (line.serials as string[]).filter(Boolean) : [],
        });
        batch.set(lineRef, cleanLine);
      }

      await batch.commit();
      return transactionId;
    } catch (e: any) {
      console.error('İşlem geçmişi yazılamadı:', e);
      throw e;
    }
  };

  const handleOpenAddressModal = () => {
    const hasSelection = scannedItems.some(i => i.isSelected && !i.isProcessed);
    if (!hasSelection) {
      toast({ title: 'Uyarı', description: 'Lütfen adres atanacak ürünleri seçin.' });
      return;
    }
    setIsAddressModalOpen(true);
  };
  
  const handleAssignAddress = () => {
    const address = (addressDefinitions || []).find(ad => ad.addressBarcode === selectedAddressBarcode);
    if (!address && addressAssignmentInput.trim() === '') {
      toast({ title: 'Hata', description: 'Lütfen geçerli bir adres barkodu seçin veya manuel adres girin.', variant: 'destructive' });
      return;
    }
    const targetAddressName = address ? address.addressName : addressAssignmentInput.trim();

    setScannedItems(prev =>
      prev.map(item =>
        item.isSelected && !item.isProcessed
          ? { ...item, rafAdresi: targetAddressName, isSelected: false }
          : item
      )
    );
    toast({ title: 'Başarılı', description: `Seçili ürünlere "${targetAddressName}" adresi atandı.` });
    setSelectedAddressBarcode('');
    setAddressAssignmentInput('');
    setIsAddressModalOpen(false);
  };

  const handleOpenIrsaliyeModal = () => {
    const hasSelection = scannedItems.some(i => i.isSelected && !i.isProcessed);
    if (!hasSelection) {
      toast({ title: 'Uyarı', description: 'Lütfen irsaliye no atanacak ürünleri seçin.' });
      return;
    }
    setIsIrsaliyeModalOpen(true);
  };
  
  const handleAssignIrsaliyeNo = () => {
    if (irsaliyeNoInput.trim() === '') {
      toast({ title: 'Hata', description: 'İrsaliye numarası boş olamaz.', variant: 'destructive' });
      return;
    }
    setScannedItems(prev =>
      prev.map(item =>
        item.isSelected && !item.isProcessed
          ? { ...item, irsaliyeNumarasi: irsaliyeNoInput.trim(), isSelected: false }
          : item
      )
    );
    toast({ title: 'Başarılı', description: `Seçili ürünlere "${irsaliyeNoInput.trim()}" irsaliye no atandı.` });
    setIrsaliyeNoInput('');
    setIsIrsaliyeModalOpen(false);
  };

  const performGoodsReceipt = async (itemsToProcess: ScanRow[]) => {
    setMalKabulIsLoading(true);
    setCommitInfo(null);
    const processedIds = new Set<string>();
    const depotName = sourceDepots.find(d => d.id === selectedDepotId)?.name || 'Bilinmeyen Depo';

    const queue = new BatchQueue({
      chunkSize: 450,
      onProgress: (info) => setCommitInfo(info),
    });

    try {
      // OPTIMIZED: Parallel serial verification with Promise.all
      const serialsToVerify = itemsToProcess.map(i => i.seriNumarasi).filter(Boolean) as string[];
      const existingSerialsInDb = new Set<string>();

      if (serialsToVerify.length > 0) {
        // Create chunks and query them in parallel (max 5 concurrent queries to avoid rate limiting)
        const chunks: string[][] = [];
        for (let i = 0; i < serialsToVerify.length; i += 30) {
          chunks.push(serialsToVerify.slice(i, i + 30));
        }

        // Process chunks in parallel batches of 5
        for (let i = 0; i < chunks.length; i += 5) {
          const batchChunks = chunks.slice(i, i + 5);
          const results = await Promise.all(
            batchChunks.map(async (chunk) => {
              const q = query(collection(db, 'depoStok'), where('seriNumarasi', 'in', chunk));
              const snap = await getDocs(q);
              return snap.docs.map(doc => doc.data().seriNumarasi as string);
            })
          );
          results.flat().forEach(serial => existingSerialsInDb.add(serial));
        }
      }

      // Pre-compute all doc data to batch them efficiently
      const docsToCreate: Array<{ ref: ReturnType<typeof doc>; data: any; serial?: string; item: ScanRow }> = [];

      for (const item of itemsToProcess) {
        // Mükerrer kontrolü: aynı stokKodu için aynı seri numarası kontrol edilir
        const depotProductSerials = item.stokKodu ? existingDepotSerials.get(item.stokKodu) : undefined;
        if(item.seriNumarasi && depotProductSerials?.has(item.seriNumarasi)) {
          continue;
        }

        const serialsToProcess = item.isGroup ? (item.scannedSerials || []) : [item.seriNumarasi];

        const createDocData = (serial = '') => ({
          depotId: selectedDepotId,
          depotName,
          stokKodu: item.stokKodu || '',
          stokAdi: item.stokAdi || '',
          lotNumarasi: item.lotNumarasi || '',
          miad: item.miad ? normalizeMiad(item.miad) : '',
          seriNumarasi: serial,
          rafAdresi: item.rafAdresi || '',
          irsaliyeNumarasi: item.irsaliyeNumarasi || '',
          eklenmeTarihi: toFsTimestamp(item.timestamp),
          isShipped: false,
          createdByName: currentUserProfile?.name || currentUser?.email || 'Unknown',
          createdByUid: currentUser?.uid || null,
        });

        if (item.isGroup && serialsToProcess.length === 0) {
          const adet = Math.max(1, item.adet ?? 1);
          for (let i = 0; i < adet; i++) {
            docsToCreate.push({
              ref: doc(collection(db, 'depoStok')),
              data: createDocData(),
              item,
            });
          }
        } else {
          for (const serial of (serialsToProcess.filter(Boolean) as string[])) {
            docsToCreate.push({
              ref: doc(collection(db, 'depoStok')),
              data: createDocData(serial),
              serial,
              item,
            });
          }
        }
        if (item.id) processedIds.add(item.id);
      }

      // OPTIMIZED: Batch all writes together
      for (const docInfo of docsToCreate) {
        await queue.set(docInfo.ref, docInfo.data);

        if (docInfo.serial) {
          await enqueueSerialHistory(queue, docInfo.serial, 'intake', {
            stokKodu: docInfo.item.stokKodu || '',
            stokAdi: docInfo.item.stokAdi || '',
            depotId: selectedDepotId,
            depotName,
            rafAdresi: docInfo.item.rafAdresi || '',
            irsaliyeNumarasi: docInfo.item.irsaliyeNumarasi || '',
          });
        }
      }

      await queue.flush();

      // Signal stock change to all listeners (other users/tabs)
      await touchStockMetadata();

      // Invalidate depoStok cache so it refetches fresh data
      invalidateDepoStok();

      const txId = await recordMalKabulTransaction(itemsToProcess, 'unverified');
      toast({
        title: 'Kabul tamamlandı',
        description: `${itemsToProcess.length} kalem için geçmiş kaydı oluşturuldu. ID: ${txId}`,
        action: (
          <Button variant="default" onClick={() => router.push(`/mal-kabul/gecmis?open=${encodeURIComponent(txId)}`)}>
            Geçmişte Aç
          </Button>
        ),
      });

      setScannedItems(prev => prev.filter(i => i.id && !processedIds.has(i.id)));
      // Map'i temizle ve kalan öğeleri yeniden ekle
      scannedSerialsRef.current.clear();
      scannedItems.forEach(item => {
        if (item.id && !processedIds.has(item.id) && item.seriNumarasi && item.stokKodu) {
          if (!scannedSerialsRef.current.has(item.stokKodu)) {
            scannedSerialsRef.current.set(item.stokKodu, new Set());
          }
          scannedSerialsRef.current.get(item.stokKodu)!.add(item.seriNumarasi);
        }
      });

    } catch (error: any) {
      console.error("Mal kabul hatası:", error);
      toast({ title: "Veritabanı Hatası", description: safeStr(error?.message) || 'Ürünler stoğa eklenirken bir hata oluştu.', variant: "destructive" });
    } finally {
      setCommitInfo(null);
      setMalKabulIsLoading(false);
      setIsPreCheckModalOpen(false);
    }
  };

  const handlePreCheckAndDogrulamasizMalKabul = async () => {
    if (!selectedDepotId) {
      toast({ title: 'Hata', description: 'Ön kontrol için önce bir depo seçilmelidir.', variant: 'destructive' });
      return;
    }
  
    const itemsToProcess = scannedItems.filter(i => !i.isProcessed && !!i.rafAdresi && !!i.irsaliyeNumarasi);
    if (itemsToProcess.length === 0) {
      toast({ title: 'Bilgi', description: 'İşlenecek yeni ürün yok (adres ve irsaliye atanmamış olabilir).', variant: "default" });
      return;
    }
    
    performGoodsReceipt(itemsToProcess);
  };
  
  // Barkodsuz giriş için tüm non-serial ürünleri listele (lot_manual, qty_manual, lot_barcode, qty_barcode)
  const allNonSerialProducts = useMemo(() => {
    const opts: { code: string; name: string; tracking: TrackingMode }[] = [];
    productCodes.forEach(p => {
        if (!p.stokKodu) return;
        const tracking = productTracking[p.stokKodu] || resolveDefaultTrackingMode(p as any);
        // Seri takipli ürünleri hariç tut, diğer tüm takip modlarını dahil et
        if (tracking !== 'serial') {
            opts.push({ code: p.stokKodu, name: productNames[p.stokKodu] || p.stokKodu, tracking });
        }
    });
    return opts.sort((a,b) => a.name.localeCompare(b.name));
  }, [productCodes, productTracking, productNames]);
  
  const handleAdetChange = (groupKey: string | undefined, newAdetStr: string) => {
    if (!groupKey) return;
    const newAdet = parseInt(newAdetStr, 10);
    if (isNaN(newAdet) || newAdet < 0) return;

    setScannedItems(prev =>
      prev.map(item => {
        if (item.key === groupKey && item.isGroup) {
          return { ...item, adet: newAdet };
        }
        return item;
      })
    );
  };

  // Stepper progress: compute which steps are complete
  const stepperState = useMemo(() => {
    const hasDepot = !!selectedDepotId;
    const hasItems = unprocessedScannedItems > 0;
    const itemsWithMeta = scannedItems.filter(i => !i.isProcessed && !!i.rafAdresi && !!i.irsaliyeNumarasi).length;
    const hasMeta = itemsWithMeta > 0;
    return { hasDepot, hasItems, hasMeta, readyCount: itemsWithMeta };
  }, [selectedDepotId, unprocessedScannedItems, scannedItems]);

  // Selection mode state
  const isSelectionMode = selectedItemsCount > 0;

  return (
    <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 sm:space-y-5 min-h-screen">

      {/* ── STEP 1: Header – Depo Seçimi ── */}
      <header className="cihaz-card-strong px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* Stepper indicator */}
          <div className="flex items-center gap-2 mr-2">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
              stepperState.hasDepot
                ? "bg-[var(--dashboard-accent)] text-white"
                : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)]"
            )}>1</div>
            <div className={cn("w-6 h-0.5 rounded", stepperState.hasItems ? "bg-[var(--dashboard-accent)]" : "bg-[var(--dashboard-surface-2)]")} />
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
              stepperState.hasItems
                ? "bg-[var(--dashboard-accent)] text-white"
                : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)]"
            )}>2</div>
            <div className={cn("w-6 h-0.5 rounded", stepperState.hasMeta ? "bg-[var(--dashboard-accent)]" : "bg-[var(--dashboard-surface-2)]")} />
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
              stepperState.hasMeta
                ? "bg-[var(--dashboard-accent)] text-white"
                : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)]"
            )}>3</div>
          </div>

          <div className="flex-1 w-full sm:max-w-xs">
            <Label className="text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Çalışma Deposu</Label>
            <Select value={selectedDepotId} onValueChange={(v: string) => setSelectedDepotId(v)}>
              <SelectTrigger className="w-full mt-1 bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl">
                <SelectValue placeholder="Depo seçin..." />
              </SelectTrigger>
              <SelectContent>
                {sourceDepots.filter(d => !!d.id).map(dep => (
                  <SelectItem key={dep.id!} value={dep.id!}>{dep.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <button
            onClick={() => router.push('/mal-kabul/gecmis')}
            className="cihaz-tool-item flex items-center gap-2 px-4 py-2.5 text-sm font-medium self-start sm:self-center sm:ml-auto"
          >
            <History className="h-4 w-4" />
            <span>Geçmiş</span>
          </button>
        </div>
      </header>

      {/* ── KPI Row – 3 metric cards ── */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {/* KPI 1: Son Okutulan */}
        <div className="cihaz-card px-3 py-3 sm:px-4 sm:py-4">
          <p className="cihaz-overline text-[10px] sm:text-xs mb-2">Son Okutulan</p>
          {lastScannedProduct ? (
            <div className="space-y-0.5">
              <p className="text-sm sm:text-base font-semibold text-[var(--dashboard-text)] truncate">{lastScannedProduct.stokAdi || ''}</p>
              <p className="text-[10px] sm:text-xs text-[var(--dashboard-muted)] font-mono truncate">
                {lastScannedProduct.seriNumarasi ? `SN: ${lastScannedProduct.seriNumarasi}` : `Lot: ${lastScannedProduct.lotNumarasi || '-'}`}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[var(--dashboard-muted)]">-</p>
          )}
        </div>

        {/* KPI 2: Bu Lot / Ürün */}
        <div className="cihaz-card px-3 py-3 sm:px-4 sm:py-4">
          <p className="cihaz-overline text-[10px] sm:text-xs mb-2">Okuma Adetleri</p>
          <div className="flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-bold text-[var(--dashboard-accent)]">{lotCount}</span>
            <span className="text-[10px] sm:text-xs text-[var(--dashboard-muted)]">lot</span>
          </div>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-sm sm:text-base font-semibold text-[var(--dashboard-text)]">{totalCountForProduct}</span>
            <span className="text-[10px] sm:text-xs text-[var(--dashboard-muted)]">ürün</span>
          </div>
        </div>

        {/* KPI 3: Toplam */}
        <div className="cihaz-card px-3 py-3 sm:px-4 sm:py-4">
          <p className="cihaz-overline text-[10px] sm:text-xs mb-2">Toplam</p>
          <div className="flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-bold text-[var(--dashboard-accent)]">{scannedItems.reduce((n, it) => n + (it.adet ?? 1), 0)}</span>
            <span className="text-[10px] sm:text-xs text-[var(--dashboard-muted)]">adet</span>
          </div>
          <p className="text-[10px] sm:text-xs text-[var(--dashboard-muted)] mt-0.5">
            {groupedScannedItems.length} grup
          </p>
        </div>
      </div>

      {/* ── STEP 2: İşlemler (Ürün Ekle) + Son Okutulan Detay ── */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3 sm:gap-4">
        {/* Left: Action tiles 2x2 */}
        <div className="cihaz-card-strong px-4 py-4 sm:px-5 sm:py-5">
          <p className="cihaz-overline text-xs mb-3">Ürün Ekle</p>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            <button
              onClick={() => { setIsBatchScanning(false); setIsCameraScannerOpen(true); }}
              className="cihaz-action-tile flex flex-col items-center justify-center gap-1.5 py-3 sm:py-4 text-center"
            >
              <Camera className="h-5 w-5 text-[var(--dashboard-accent)]" />
              <span className="text-xs sm:text-sm font-medium text-[var(--dashboard-text)]">Tekli Tara</span>
            </button>
            <button
              onClick={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }}
              className="cihaz-action-tile flex flex-col items-center justify-center gap-1.5 py-3 sm:py-4 text-center"
              style={{ background: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)', color: '#fff', border: 'none' }}
            >
              <Camera className="h-5 w-5" />
              <span className="text-xs sm:text-sm font-medium">Seri Tarama</span>
            </button>
            <button
              onClick={() => setShowManualInline(v => !v)}
              className={cn("cihaz-action-tile flex flex-col items-center justify-center gap-1.5 py-3 sm:py-4 text-center", showManualInline && "cihaz-pressed")}
            >
              <PlusCircle className="h-5 w-5 text-[var(--dashboard-accent)]" />
              <span className="text-xs sm:text-sm font-medium text-[var(--dashboard-text)]">Manuel Ekle</span>
            </button>
            <button
              onClick={() => setIsOcrModalOpen(true)}
              className="cihaz-action-tile flex flex-col items-center justify-center gap-1.5 py-3 sm:py-4 text-center"
            >
              <ScanLine className="h-5 w-5 text-[var(--dashboard-accent)]" />
              <span className="text-xs sm:text-sm font-medium text-[var(--dashboard-text)]">İrsaliye Tara</span>
            </button>
          </div>
        </div>

        {/* Right: Last scanned detail + undo */}
        <div className="cihaz-card-strong px-4 py-4 sm:px-5 sm:py-5">
          <p className="cihaz-overline text-xs mb-3">Son Okutulan Detay</p>
          {lastScannedProduct ? (
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
                <p className="font-semibold text-sm text-[var(--dashboard-text)]">{lastScannedProduct.stokAdi || ''}</p>
                <p className="text-xs text-[var(--dashboard-muted)] font-mono mt-1">{lastScannedProduct.stokKodu}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {lastScannedProduct.seriNumarasi && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800">
                      SN: {lastScannedProduct.seriNumarasi}
                    </span>
                  )}
                  {lastScannedProduct.lotNumarasi && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-800">
                      Lot: {lastScannedProduct.lotNumarasi}
                    </span>
                  )}
                  {lastScannedProduct.miad && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800">
                      SKT: {lastScannedProduct.miad}
                    </span>
                  )}
                </div>
              </div>
              {/* Scan status indicator */}
              {scanStatus !== 'idle' && (
                <div className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all",
                  scanStatus === 'success' && "bg-green-100 text-green-800",
                  scanStatus === 'error' && "bg-red-100 text-red-800"
                )}>
                  {scanStatus === 'success' ? <Package className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {scanStatus === 'success' ? 'Okuma başarılı' : 'Okuma hatası'}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-3">
                <Package className="h-5 w-5 text-[var(--dashboard-muted)]" />
              </div>
              <p className="text-xs text-[var(--dashboard-muted)]">Barkod okutun veya manuel ürün ekleyin</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Manuel Giriş Paneli (collapsible drawer) ── */}
      {showManualInline && (
        <div className="cihaz-card-strong px-4 py-4 sm:px-5 sm:py-5 relative">
          <div className="flex items-center justify-between mb-3">
            <p className="cihaz-overline text-xs">Manuel Ürün Girişi</p>
            <button
              onClick={() => setShowManualInline(false)}
              className="cihaz-tool-item p-1.5 rounded-lg"
              title="Manuel Girişi Gizle"
            >
              <X className="h-4 w-4 text-[var(--dashboard-muted)]" />
            </button>
          </div>
          <ManualInlineAdder
            visible={showManualInline}
            onClose={() => setShowManualInline(false)}
            manualProducts={allNonSerialProducts.filter(p => p.tracking === 'lot_manual' || p.tracking === 'qty_manual')}
            barcodeProducts={allNonSerialProducts.filter(p => p.tracking === 'lot_barcode' || p.tracking === 'qty_barcode')}
            onAddLot={({ code, name, lot, miad, qty }) => {
              upsertGroupedRow(
                setScannedItems,
                { stokKodu: code, stokAdi: name, lot, miad, barkod: 'MANUAL' },
                (r) => !!(r.isGroup && r.stokKodu === code && r.lotNumarasi === lot && r.miad === miad),
                qty
              );
            }}
            onAddQty={({ code, name, qty }) => {
              upsertGroupedRow(
                setScannedItems,
                { stokKodu: code, stokAdi: name, barkod: 'MANUAL' },
                (r) => !!(r.isGroup && r.stokKodu === code && !r.lotNumarasi),
                qty
              );
            }}
          />
        </div>
      )}

      {/* ── STEP 3: Okutulan Ürünler Tablosu ── */}
      <div className="cihaz-card-strong flex-1 flex flex-col overflow-hidden">
        {/* ── Selection mode sticky bar ── */}
        {isSelectionMode && (
          <div className="sticky top-0 z-10 flex items-center gap-2 sm:gap-3 px-4 py-2.5 bg-[var(--dashboard-accent)] text-white rounded-t-[18px]">
            <span className="text-sm font-semibold">{selectedItemsCount} seçildi</span>
            <div className="flex-1" />
            <button
              onClick={handleOpenAddressModal}
              disabled={malKabulIsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-xs sm:text-sm font-medium transition-colors disabled:opacity-50"
            >
              <MapPin className="h-3.5 w-3.5" />
              Adres Ata
            </button>
            <button
              onClick={handleOpenIrsaliyeModal}
              disabled={malKabulIsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-xs sm:text-sm font-medium transition-colors disabled:opacity-50"
            >
              <FileText className="h-3.5 w-3.5" />
              İrsaliye Ata
            </button>
            <button
              onClick={() => setScannedItems(prev => prev.map(item => ({ ...item, isSelected: false })))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-xs sm:text-sm font-medium transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Seçimi Temizle</span>
            </button>
          </div>
        )}

        {/* ── Table toolbar ── */}
        <div className={cn(
          "flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 sm:px-5 border-b border-[var(--dashboard-stroke)]",
          isSelectionMode && "rounded-t-none"
        )}>
          <div className="flex-shrink-0">
            <h2 className="text-sm sm:text-base font-semibold text-[var(--dashboard-text)]">
              Okutulan Ürünler
              <span className="ml-1.5 text-[var(--dashboard-muted)]">({scannedItems.length})</span>
            </h2>
            <p className="text-[10px] sm:text-xs text-[var(--dashboard-muted)]">Stoğa eklenecek ürünlerin listesi</p>
          </div>
          <div className="flex-1" />
          {/* Non-selection mode toolbar */}
          {!isSelectionMode && (
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              <button
                onClick={() => {
                  const anySelected = scannedItems.some(i => !i.isProcessed && i.isSelected);
                  setScannedItems(prev => prev.map(item => (!item.isProcessed ? { ...item, isSelected: !anySelected } : item)));
                }}
                disabled={malKabulIsLoading || unprocessedScannedItems === 0}
                className="cihaz-tool-item flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                title={unprocessedScannedItems === 0 ? 'Önce ürün ekleyin' : undefined}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Seç ({unprocessedScannedItems})</span>
                <span className="sm:hidden">{unprocessedScannedItems}</span>
              </button>
              <button
                onClick={clearAllScannedItems}
                disabled={malKabulIsLoading || scannedItems.length === 0}
                className="cihaz-tool-item flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                title={scannedItems.length === 0 ? 'Liste boş' : undefined}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Temizle</span>
              </button>
            </div>
          )}
        </div>

        {/* ── Table header (desktop) ── */}
        {scannedItems.length > 0 && (
          <div className="hidden sm:grid grid-cols-[40px_2fr_1fr_1fr_1fr_1fr_80px_40px] gap-1 px-4 sm:px-5 py-2 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)]">
            <span></span>
            <span>Ürün</span>
            <span>Lot</span>
            <span>Miad</span>
            <span>Adres</span>
            <span>İrsaliye</span>
            <span className="text-right">Adet</span>
            <span></span>
          </div>
        )}

        {/* ── Table body ── */}
        <div className="flex-1 overflow-hidden">
          {scannedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[35vh] sm:h-[40vh] text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                <Search className="h-6 w-6 text-[var(--dashboard-muted)]" />
              </div>
              <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Okutulmuş ürün bulunmuyor</p>
              <p className="text-xs text-[var(--dashboard-muted)] mb-4">Başlamak için bir yöntem seçin:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }}
                  className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium"
                >
                  <Camera className="h-3.5 w-3.5 text-[var(--dashboard-accent)]" />
                  Seri Tarama Başlat
                </button>
                <button
                  onClick={() => setIsOcrModalOpen(true)}
                  className="cihaz-tool-item flex items-center gap-1.5 px-3 py-2 text-xs font-medium"
                >
                  <ScanLine className="h-3.5 w-3.5 text-[var(--dashboard-accent)]" />
                  PDF İrsaliye Yükle
                </button>
              </div>
            </div>
          ) : (
            <VirtualizedList<ScanRow>
              items={groupedScannedItems}
              height="40vh"
              estimateSize={72}
              overscan={10}
              getItemKey={(item: ScanRow) => item.key || item.id}
              className=""
              renderItem={(group: ScanRow, groupIndex: number) => {
                const trackingMode = (group.stokKodu && productTracking[group.stokKodu]) || resolveDefaultTrackingMode({stokAdi: group.stokAdi} as any);
                const hasSerials = trackingMode === 'serial';
                const missingAddress = !group.rafAdresi;
                const missingIrsaliye = !group.irsaliyeNumarasi;
                const hasWarnings = missingAddress || missingIrsaliye;

                return (
                  <div className={cn(
                    "border-b border-[var(--dashboard-stroke)] transition-colors",
                    group.isSelected && "bg-[var(--dashboard-accent)]/5"
                  )}>
                    {/* Desktop row */}
                    <div className="hidden sm:grid grid-cols-[40px_2fr_1fr_1fr_1fr_1fr_80px_40px] gap-1 items-center px-4 sm:px-5 py-2.5 cursor-pointer hover:bg-[var(--dashboard-surface-2)]/60">
                      <div>
                        <Checkbox
                          checked={group.isSelected}
                          onCheckedChange={() => toggleGroupSelection(group.key)}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--dashboard-text)] truncate">{group.stokAdi}</p>
                        <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">{group.stokKodu}</p>
                      </div>
                      <p className="text-xs text-[var(--dashboard-text)] truncate">{group.lotNumarasi || <span className="text-[var(--dashboard-muted)]">-</span>}</p>
                      <p className="text-xs text-[var(--dashboard-text)] truncate">{group.miad || <span className="text-[var(--dashboard-muted)]">-</span>}</p>
                      <div>
                        {group.rafAdresi ? (
                          <p className="text-xs text-[var(--dashboard-text)] truncate">{group.rafAdresi}</p>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Adres yok
                          </span>
                        )}
                      </div>
                      <div>
                        {group.irsaliyeNumarasi ? (
                          <p className="text-xs text-[var(--dashboard-text)] truncate">{group.irsaliyeNumarasi}</p>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            İrsaliye yok
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        {hasSerials ? (
                          <span className="text-sm font-bold text-[var(--dashboard-text)]">{group.adet}</span>
                        ) : (
                          <Input
                            type="number"
                            value={group.adet}
                            onChange={(e) => handleAdetChange(group.key, e.target.value)}
                            className="h-7 w-16 text-center font-bold text-sm bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-lg ml-auto"
                            min="1"
                          />
                        )}
                      </div>
                      <div className="text-center">
                        <button
                          onClick={() => deleteGroup(group.key)}
                          className="p-1 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </button>
                      </div>
                    </div>

                    {/* Mobile row (card layout with column structure) */}
                    <div className="sm:hidden px-3 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <Checkbox
                          checked={group.isSelected}
                          onCheckedChange={() => toggleGroupSelection(group.key)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-[var(--dashboard-text)] truncate">{group.stokAdi}</p>
                              <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">{group.stokKodu}</p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {hasSerials ? (
                                <span className="text-base font-bold text-[var(--dashboard-accent)]">{group.adet}</span>
                              ) : (
                                <Input
                                  type="number"
                                  value={group.adet}
                                  onChange={(e) => handleAdetChange(group.key, e.target.value)}
                                  className="h-7 w-14 text-center font-bold text-sm bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-lg"
                                  min="1"
                                />
                              )}
                              <button onClick={() => deleteGroup(group.key)} className="p-1">
                                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                              </button>
                            </div>
                          </div>
                          {/* Mobile meta row with label+value pairs */}
                          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px]">
                            {group.lotNumarasi && (
                              <span className="text-[var(--dashboard-muted)]">Lot: <strong className="text-[var(--dashboard-text)]">{group.lotNumarasi}</strong></span>
                            )}
                            {group.miad && (
                              <span className="text-[var(--dashboard-muted)]">SKT: <strong className="text-[var(--dashboard-text)]">{group.miad}</strong></span>
                            )}
                            {group.rafAdresi ? (
                              <span className="text-[var(--dashboard-muted)]">Adres: <strong className="text-[var(--dashboard-text)]">{group.rafAdresi}</strong></span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                                <AlertTriangle className="h-2.5 w-2.5" /> Adres yok
                              </span>
                            )}
                            {group.irsaliyeNumarasi ? (
                              <span className="text-[var(--dashboard-muted)]">İrs: <strong className="text-[var(--dashboard-text)]">{group.irsaliyeNumarasi}</strong></span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                                <AlertTriangle className="h-2.5 w-2.5" /> İrsaliye yok
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Serial number expansion */}
                    {hasSerials && group.items && group.items.length > 0 && (
                      <div className="px-5 sm:px-10 py-2 bg-[var(--dashboard-surface-2)] border-t border-[var(--dashboard-stroke)]">
                        <div className="text-[10px] font-mono grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-0.5 text-[var(--dashboard-muted)]">
                          {group.items.slice(0, 100).map(item => (
                            <span key={item.id} className="truncate">{item.seriNumarasi}</span>
                          ))}
                          {group.items.length > 100 && (
                            <span>+{group.items.length - 100} daha...</span>
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

        {/* ── Primary CTA: Kabul Et ve Stoğa Ekle ── */}
        {unprocessedScannedItems > 0 && (
          <div className="px-4 py-3 sm:px-5 sm:py-4 border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
            <div className="flex items-center justify-between gap-3">
              {/* Info text */}
              <p className="text-xs text-[var(--dashboard-muted)] hidden sm:block">
                {stepperState.readyCount > 0
                  ? `${stepperState.readyCount} / ${unprocessedScannedItems} ürün kabule hazır (adres + irsaliye atanmış)`
                  : 'Kabul için ürünlere adres ve irsaliye atayın.'
                }
              </p>
              {commitInfo && (
                <div className="flex items-center gap-2 text-xs text-[var(--dashboard-muted)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Yazılıyor... ({commitInfo.commits} batch)</span>
                </div>
              )}
              <button
                onClick={handlePreCheckAndDogrulamasizMalKabul}
                disabled={malKabulIsLoading || isLoading || unprocessedScannedItems === 0 || stepperState.readyCount === 0}
                className={cn(
                  "flex items-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-2xl text-sm sm:text-base font-semibold transition-all",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
                  stepperState.readyCount > 0
                    ? "bg-green-600 hover:bg-green-700 active:bg-green-800 text-white shadow-lg shadow-green-600/30 hover:shadow-xl hover:shadow-green-600/40"
                    : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)]"
                )}
                title={stepperState.readyCount === 0 ? 'Önce ürünlere adres ve irsaliye atayın' : undefined}
              >
                {(malKabulIsLoading || isLoading) && <Loader2 className="h-4 w-4 animate-spin" />}
                <Package className="h-4 w-4" />
                {selectedItemsCount > 0
                  ? `Seçilenleri Kabul Et (${selectedItemsCount})`
                  : `Kabul Et ve Stoğa Ekle (${stepperState.readyCount})`
                }
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════ MODALS ══════════════════════ */}

      {/* Camera Scanner */}
      <Dialog open={isCameraScannerOpen} onOpenChange={(open: boolean) => {
        if (!open && isBatchScanning) setIsBatchScanning(false);
        setIsCameraScannerOpen(open);
      }}>
        <DialogContent className="max-w-xl p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Kamera ile Barkod Tara</DialogTitle>
            {isBatchScanning && (
              <DialogDescription className="px-4">
                Seri tarama modu aktif. Tarayıcı her okumadan sonra açık kalacaktır. Bitirdiğinizde bu pencereyi kapatın.
              </DialogDescription>
            )}
          </DialogHeader>
          <Suspense fallback={
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
              <p className="ml-2 text-[var(--dashboard-muted)]">Kamera Yükleniyor...</p>
            </div>
          }>
            <DynamicCameraBarcodeScanner
              onScanSuccess={handleCameraScanSuccess}
              onClose={() => isBatchScanning ? setIsBatchScanning(false) : setIsCameraScannerOpen(false)}
            />
          </Suspense>
        </DialogContent>
      </Dialog>

      {/* Address Assignment Modal */}
      <Dialog open={isAddressModalOpen} onOpenChange={setIsAddressModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[var(--dashboard-accent)]" />
              Adres Ata
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <Label className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wide">Tanımlı Adresler</Label>
              <Select value={selectedAddressBarcode} onValueChange={setSelectedAddressBarcode}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Adres seçin..." /></SelectTrigger>
                <SelectContent>
                  {addressDefinitions.map(ad => <SelectItem key={ad.id} value={ad.addressBarcode || ''}>{ad.addressName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wide">Manuel Adres</Label>
              <Input value={addressAssignmentInput} onChange={e => setAddressAssignmentInput(e.target.value)} placeholder="Veya manuel adres girin" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleAssignAddress}>Ata</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* İrsaliye No Assignment Modal */}
      <Dialog open={isIrsaliyeModalOpen} onOpenChange={setIsIrsaliyeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[var(--dashboard-accent)]" />
              İrsaliye No Ata
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wide">İrsaliye Numarası</Label>
            <Input value={irsaliyeNoInput} onChange={e => setIrsaliyeNoInput(e.target.value)} placeholder="İrsaliye numarasını girin" className="mt-1" />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleAssignIrsaliyeNo}>Ata</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OCR Modal */}
      {isOcrModalOpen && (
        <IrsaliyeOcrModal
          isOpen={isOcrModalOpen}
          onClose={() => setIsOcrModalOpen(false)}
          productCodes={productCodes}
          onResults={handleOcrResults}
        />
      )}
    </div>
  );
}
