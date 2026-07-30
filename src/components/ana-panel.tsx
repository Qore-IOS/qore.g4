/**
 * @fileoverview Mal Kabul (Goods Receiving) Main Panel Component
 * @description Enterprise-grade goods receiving panel with barcode scanning,
 * OCR support, batch processing, and comprehensive inventory management.
 * @module components/ana-panel
 * @version 2.0.0
 */

'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo, useDeferredValue, useTransition } from 'react';
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
import { useDepots, useProductCodes, useAddressDefinitions, useBarcodeFormatsQuery, useUsers, useDepotSerialIndex, useInvalidateQueries, touchStockMetadata, useDepotCountSessions, useScannedItems, useIrsaliyeFiles } from '@/hooks/useFirebaseQueries';
import { TrackingMode, resolveDefaultTrackingMode, resolveEffectiveTrackingMode } from '@/lib/tracking';
import useHidScanner from '@/hooks/useHidScanner';
import { ScanCommitProbe, ScanPerformanceBadge, useScanPerformance } from '@/hooks/useScanPerformance';
import { LedStripGlow } from '@/components/ui/led-strip-glow';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';

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
import { Switch } from '@/components/ui/switch';
import { VirtualizedList } from '@/components/ui/virtualized-list';

// Icons
import { Trash2, CheckSquare, PlusCircle, Plus, Minus, Loader2, Search, History, Camera, ScanLine, Package, MapPin, FileText, X, Undo2, AlertTriangle, QrCode, Download, Sparkles, CheckCircle2, Clock, RefreshCw, Zap } from 'lucide-react';

// Firebase
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, Timestamp, onSnapshot, orderBy, limit, increment, arrayUnion } from 'firebase/firestore';
import { flushSync } from 'react-dom';
import { scheduleIdle, cancelIdle, sanitizeFsId, type IdleHandle } from '@/lib/sync/idle-scheduler';

// Utilities
import { cn, generateId, playFeedback } from '@/lib/utils';
import { parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode, decodeBulkSerialQrPayload, encodeBulkSerialQrPayload } from '@/lib/barcode';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import { normalizeMiad } from '@/components/common/ExpiryDateInput';

// Logging & Validation
import { malKabulLogger, createCorrelationId } from '@/lib/logger';
import { sanitizeBarcode, sanitizeStockCode, securityCheck } from '@/lib/mal-kabul/validation';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { formatQuantityWithUnit, formatUnitMultiplier, normalizeUnitLabel } from '@/lib/product-unit';
import { matchesCompanyScope, normalizeCompanyId, withCompanyScope } from '@/lib/company-scope';
import BekleyenIrsaliyelerPanel from '@/components/lab/BekleyenIrsaliyelerPanel';
import {
  MK_C, MkClayStyles, MkTopStepper, MkSoftBtn, MkReadinessCard, MkAddPanel,
  MkChipBtn, MkAcceptBtn, MkWarnChip, MkGoodChip, MkEmptyState, MkWaybillCard,
  type MkLastItem,
} from '@/components/mal-kabul/clay-kit';

// Child Components
const ManualInlineAdder = dynamic(() => import('@/components/mal-kabul/ManualInlineAdder'), {
  ssr: false,
  loading: () => <div className="h-10 animate-pulse bg-muted rounded-md" />
});

const IrsaliyeOcrModal = dynamic(() => import('@/components/mal-kabul/IrsaliyeOcrModal'), {
  ssr: false,
});

const BulkBarcodeScanModal = dynamic(() => import('@/components/mal-kabul/BulkBarcodeScanModal'), {
  ssr: false,
});

const ExcelStokGirisModal = dynamic(() => import('@/components/mal-kabul/ExcelStokGirisModal'), {
  ssr: false,
});

function AnaPanelSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6 animate-pulse">
      <div className="flex justify-between items-center mb-4">
        <div className="h-10 w-48 bg-muted rounded" />
        <div className="h-10 w-64 bg-muted rounded" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-64 bg-muted rounded-xl" />
          <div className="h-96 bg-muted rounded-xl" />
        </div>
        <div className="space-y-6">
          <div className="h-80 bg-muted rounded-xl" />
          <div className="h-40 bg-muted rounded-xl" />
        </div>
      </div>
    </div>
  );
}

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
 * Oto Kabul (arka plan artımlı yazma) için satır senkron durumu.
 * - `pending`    : kuyrukta, henüz yazılmadı
 * - `processing` : worker tarafından kilitlendi, Firestore yazımı sürüyor
 * - `confirmed`  : stoğa yazıldı (sunucu onayı / yerel kalıcı kuyruğa alındı)
 * - `failed`     : yazılamadı veya geçmişte işlem görmüş seri (atlandı)
 */
type SyncStatus = 'pending' | 'processing' | 'confirmed' | 'failed';

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
  /** Whether item already included in a bulk serial QR assignment */
  bulkQrAssigned?: boolean;
  /** Oto Kabul: arka plan yazma durumu (sadece oto kabul açıkken set edilir) */
  syncStatus?: SyncStatus;
  /** Oto Kabul: başarısızlık nedeni (UI'da gösterilir) */
  syncError?: string;
  /** Oto Kabul: geçici hatalarda otomatik yeniden deneme sayacı */
  syncRetries?: number;
  /** Oto Kabul: yazılan depoStok belge kimliği (idempotency + izlenebilirlik) */
  serverDocId?: string;
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

type CeomedItem = {
  BARKOD_SERI: string;
  STOK_KODU: string;
  LOT: string;
  MIYAT: string;
  MIKTAR: number;
};

type PendingCeomedIrsaliye = {
  id: string;
  ceomedId: number;
  irsaliyeNo: string;
  tarih: string;
  cariKodu: string;
  cariUnvan: string;
  durumAciklama: string;
  status: 'pending' | 'approved' | 'rejected' | 'deleted';
  items: CeomedItem[];
};
type PendingCeomedLine = {
  key: string;
  stokKodu: string;
  stokAdi: string;
  marka: string;
  lot: string;
  miad: string;
  adet: number;
  serials: string[];
};
type CeomedVerifyLine = PendingCeomedLine & { verifiedSerials: Set<string> };

const PENDING_CEOMED_DURUM_SET = new Set([
  'IRSALIYE YAZDIRILABILIR',
  'IRSALIYE YAZDIRILDI',
  'KURUMA SEVK EDILDI',
]);

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

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
  base: { stokKodu: string; stokAdi: string; lot?: string; miad?: string; barkod?: string; syncStatus?: SyncStatus },
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
      bulkQrAssigned: false,
      ...(base.syncStatus ? { syncStatus: base.syncStatus } : {}),
    };
    return [row, ...prev];
  });
}

// Oto Kabul: bir satırın arka plan worker'ı tarafından kilitli (yeniden işlenmemesi
// gereken) olup olmadığını söyler. Kilitli satırlar yeni okutmalarla GRUPLANMAZ;
// böylece worker yazarken gelen okutmalar yeni bir "pending" gruba düşer ve adet
// kaybı yaşanmaz.
const isRowSyncLocked = (r: ScanRow): boolean =>
  !!r.isProcessed || r.syncStatus === 'processing' || r.syncStatus === 'confirmed' || r.syncStatus === 'failed';


const turkishFold = (value: string) =>
  (value || '')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C');

const parseDateLike = (raw: string | undefined): string => {
  if (!raw) return '';
  const normalized = raw.replace(/[^\d./-]/g, '');
  const compact = normalized.replace(/[./-]/g, '');
  if (/^\d{8}$/.test(compact)) {
    const day = compact.slice(0, 2);
    const month = compact.slice(2, 4);
    const year = compact.slice(4, 8);
    return normalizeMiad(`${day}.${month}.${year}`);
  }
  return normalizeMiad(normalized);
};

function parseLabelText(
  text: string,
  productCodes: ProductCode[]
): { stokKodu: string; stokAdi: string; lotNumarasi: string; miad: string } | null {
  const normalizedText = turkishFold(text);
  const textByLines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const byCode = productCodes.find((p) => {
    const code = turkishFold((p.stokKodu || '').trim());
    if (!code) return false;
    const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapedCode}\\b`).test(normalizedText);
  });

  const byName = !byCode
    ? productCodes
        .map((p) => ({
          product: p,
          foldedName: turkishFold((p.stokAdi || '').trim()).replace(/[^A-Z0-9 ]/g, ' '),
        }))
        .filter(({ foldedName }) => foldedName.length >= 4)
        .find(({ foldedName }) => normalizedText.includes(foldedName))?.product
    : null;

  const product = byCode || byName;
  if (!product?.stokKodu) return null;

  let lotNumarasi = '';
  const lotKeywordMatch = normalizedText.match(/(?:^|\s)LOT(?:\s*NO|\s*NUMARASI)?\s*[:\-]?\s*([A-Z0-9\-/.]{3,})/i);
  if (lotKeywordMatch?.[1]) {
    lotNumarasi = lotKeywordMatch[1].replace(/[^A-Z0-9\-/.]/g, '');
  } else {
    const lineWithLot = textByLines.find((line) => line.includes('LOT'));
    if (lineWithLot) {
      const fallback = lineWithLot.match(/([A-Z0-9\-/.]{4,})/g)?.pop();
      if (fallback) lotNumarasi = fallback;
    }
  }

  let miad = '';
  const miadKeywordMatch = normalizedText.match(/(?:MIAD|SKT|STT|SON\s*TUKETIM(?:\s*TARIHI)?)\s*[:\-]?\s*([0-9./-]{6,12})/i);
  if (miadKeywordMatch?.[1]) {
    miad = parseDateLike(miadKeywordMatch[1]);
  } else {
    const anyDate = normalizedText.match(/\b([0-3]?\d[./-][01]?\d[./-](?:\d{2}|\d{4}))\b/);
    if (anyDate?.[1]) {
      miad = parseDateLike(anyDate[1]);
    }
  }

  return {
    stokKodu: product.stokKodu,
    stokAdi: product.stokAdi || '',
    lotNumarasi: lotNumarasi || '',
    miad: miad || '',
  };
}

const pickGeminiCandidates = (ocrText: string, productCodes: ProductCode[]): ProductCode[] => {
  const normalizedText = turkishFold(ocrText || '');
  if (!normalizedText.trim()) return productCodes.slice(0, 500);

  const candidates = productCodes.filter((p) => {
    const code = turkishFold((p.stokKodu || '').trim());
    const name = turkishFold((p.stokAdi || '').trim()).replace(/[^A-Z0-9 ]/g, ' ');
    if (!code && !name) return false;
    return (code && normalizedText.includes(code)) || (name.length >= 4 && normalizedText.includes(name));
  });

  if (candidates.length > 0) return candidates.slice(0, 500);
  return productCodes.slice(0, 500);
};

async function parseLabelWithGemini(
  imageBlob: Blob,
  ocrText: string,
  productCodes: ProductCode[]
): Promise<{ stokKodu: string; stokAdi: string; lotNumarasi: string; miad: string } | null> {
  const candidates = pickGeminiCandidates(ocrText, productCodes);
  if (candidates.length === 0) return null;

  const formData = new FormData();
  formData.append('image', imageBlob, 'label-capture.jpg');
  formData.append('ocrText', ocrText || '');
  formData.append(
    'products',
    JSON.stringify(
      candidates.map((p) => ({
        stokKodu: p.stokKodu || '',
        stokAdi: p.stokAdi || '',
      }))
    )
  );

  const response = await fetch('/api/ai/label-scan', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Etiket AI servisine erişilemedi');
  }

  const data = await response.json();
  const parsed = data?.parsed;
  if (!parsed?.stokKodu) return null;

  return {
    stokKodu: String(parsed.stokKodu || '').trim(),
    stokAdi: String(parsed.stokAdi || '').trim(),
    lotNumarasi: String(parsed.lotNumarasi || '').trim(),
    miad: parseDateLike(String(parsed.miad || '').trim()),
  };
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

// Tek bir depoStok belgesinin gövdesini üretir. Hem manuel "Mal Kabul" akışı hem
// de Oto Kabul arka plan worker'ı bu fonksiyonu kullanır; böylece iki yolda da
// belge şeması birebir aynıdır (companyId çağıran tarafça eklenir).
type DepoStokDocContext = {
  depotId: string;
  depotName: string;
  createdByName: string;
  createdByUid: string | null;
};
const buildDepoStokDocData = (item: ScanRow, serial: string, ctx: DepoStokDocContext) => ({
  depotId: ctx.depotId,
  depotName: ctx.depotName,
  stokKodu: item.stokKodu || '',
  stokAdi: item.stokAdi || '',
  lotNumarasi: item.lotNumarasi || '',
  miad: item.miad ? normalizeMiad(item.miad) : '',
  seriNumarasi: serial,
  rafAdresi: item.rafAdresi || '',
  irsaliyeNumarasi: item.irsaliyeNumarasi || '',
  eklenmeTarihi: toFsTimestamp(item.timestamp),
  isShipped: false,
  createdByName: ctx.createdByName,
  createdByUid: ctx.createdByUid,
});


// Stable empty reference for the depot serial index so that, while the query is
// loading (data === undefined), the fallback doesn't allocate a new Map every
// render and retrigger memos/callbacks that depend on `existingDepotSerials`.
const EMPTY_SERIAL_INDEX: ReadonlyMap<string, Set<string>> = new Map();

export default function AnaPanel(props: AnaPanelProps) {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  // Use TanStack Query for static data - shared cache, 1 hour stale time
  // isPending: veri hiç cache'de yoksa true. isLoading: isPending && isFetching.
  // Prefetch (AppLayout) sayesinde cache'de veri varsa isPending bile false döner → anında açılır.
  const { data: depots = [], isPending: depotsPending } = useDepots();
  const { data: productCodes = [], isPending: productsPending } = useProductCodes();
  const { data: addressDefinitions = [] } = useAddressDefinitions();
  const { data: barcodeFormats = [], isPending: barcodeFormatsPending } = useBarcodeFormatsQuery();
  const { data: users = [] } = useUsers();
  const { invalidateDepoStok } = useInvalidateQueries();

  const [selectedDepotId, setSelectedDepotId] = useState<string>('');

  // Depo seri indeksi ARTIK otomatik yüklenmiyor (auto: false). Okutma yolu
  // tamamen bellek-içi kalsın diye depo sorgusu yalnızca kullanıcı "Depoda
  // Kontrol Et" butonuna bastığında (refetch) yapılır. Oturum içi mükerrer
  // kontrolü ise sorgu gerektirmediği için her zaman aktiftir (scannedSerialsRef).
  const depotSerialIndexQuery = useDepotSerialIndex(selectedDepotId, { auto: false });
  const existingDepotSerials = depotSerialIndexQuery.data ?? EMPTY_SERIAL_INDEX;
  const [isCheckingDepotSerials, setIsCheckingDepotSerials] = useState(false);

  // Skeleton yalnızca veri gerçekten hiç cache'de yoksa (isPending) gösterilir.
  // Arka planda yenileme (isFetching) sırasında UI bloke edilmez.
  const isLoading = depotsPending || productsPending || barcodeFormatsPending;
  const masterDataProgress = useMemo(() => {
    const completedSources = Number(!productsPending) + Number(!barcodeFormatsPending);
    return Math.round((completedSources / 2) * 100);
  }, [productsPending, barcodeFormatsPending]);
  const isMasterDataLoading = masterDataProgress < 100;

  const [scannedItems, setScannedItems] = useState<ScanRow[]>([]);
  // Ölçülebilir uygulama maliyeti: senkron JS ve React'in acil UI commit süresi.
  const { startScanMeasurement, controller: scanPerformanceController } = useScanPerformance();
  const [, startTransition] = useTransition();

  // ── Oto Kabul (arka plan artımlı stoğa yazma) ───────────────────────────────
  // Switch açıkken okutulan her ürün, tarama hot-path'ine dokunmadan, tarayıcı
  // boş anlarında (idle) küçük partiler halinde depoStok'a yazılır ve satır
  // "Stokta" olarak işaretlenir. Okutma yine tamamen bellek-içi kalır (<10ms);
  // yalnızca yeni satıra `syncStatus: 'pending'` damgası eklenir.
  const [otoKabul, setOtoKabul] = useState(false);
  const otoKabulRef = useRef(false);
  useEffect(() => { otoKabulRef.current = otoKabul; }, [otoKabul]);
  const [autoStats, setAutoStats] = useState<{ confirmed: number; failed: number }>({ confirmed: 0, failed: 0 });
  const [autoTxId, setAutoTxId] = useState<string | null>(null);
  const autoRunningRef = useRef(false);
  const autoIdleHandleRef = useRef<IdleHandle | null>(null);
  const autoTxRef = useRef<{ id: string; ref: ReturnType<typeof doc>; depotId: string } | null>(null);

  // A scan must stay on the urgent input path. Grouping and sorting thousands of
  // rows synchronously here used to block the next HID/keyboard event for a few
  // milliseconds on every read. React may now coalesce this deferred snapshot
  // during rapid scanning while counters and duplicate detection keep using the
  // authoritative, up-to-date array above.
  const deferredScannedItems = useDeferredValue(scannedItems);

  const [lastScannedProduct, setLastScannedProduct] = useState<ScanRow | null>(null);
  const [scanStatus, setScanStatus] = useState<'idle'|'success'|'error'>('idle');

  // Scan feedback: flash green/red on son okutulan area (replaces toast for scan events)
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const scanFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashScanFeedback = useCallback((type: 'success' | 'error', message: string) => {
    if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
    setScanFeedback({ type, message });
    scanFeedbackTimer.current = setTimeout(() => setScanFeedback(null), 2500);
  }, []);
  const [isPreCheckModalOpen, setIsPreCheckModalOpen] = useState(false);
  const [preCheckWarnings, setPreCheckWarnings] = useState<PreCheckWarning>({ shortShelfLife: [], maxOverload: [], usageRisk: [] });
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [isBatchScanning, setIsBatchScanning] = useState(false);
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);
  const [pendingIrsaliyeCount, setPendingIrsaliyeCount] = useState(0);
  const [pendingCeomedIrsaliye, setPendingCeomedIrsaliye] = useState<PendingCeomedIrsaliye[]>([]);
  const [pendingFileIrsaliyeCount, setPendingFileIrsaliyeCount] = useState(0);
  const [isPendingCeomedModalOpen, setIsPendingCeomedModalOpen] = useState(false);
  const [ceomedApprovingId, setCeomedApprovingId] = useState<string | null>(null);
  const [selectedPendingIrs, setSelectedPendingIrs] = useState<PendingCeomedIrsaliye | null>(null);
  const [ceomedVerifyMap, setCeomedVerifyMap] = useState<Record<string, CeomedVerifyLine>>({});
  const [isBulkBarcodeScanOpen, setIsBulkBarcodeScanOpen] = useState(false);
  const [isBulkScanMode, setIsBulkScanMode] = useState(false);
  const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);

  const [showManualInline, setShowManualInline] = useState(false);
  
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<DepotStockCountSession | null>(null);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [joining, setJoining] = useState(false);

  const [showUnverified, setShowUnverified] = useState(false);
  const [commitInfo, setCommitInfo] = useState<{ commits: number; pending: number } | null>(null);
  
  // Map: stokKodu -> Set<seriNumarasi> - oturum içi mükerrer kontrolü sadece ürün bazında
  // Seri numarası aynı ürün için lot fark etmeksizin benzersiz olmalıdır.
  const scannedSerialsRef = useRef(new Map<string, Set<string>>());
  const serialProductKey = useCallback((stokKodu?: string) => stokKodu || '', []);


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

  const productMetaByCode = useMemo(() => {
    const map = new Map<string, ProductCode>();
    productCodes.forEach((p) => {
      if (p.stokKodu) map.set(p.stokKodu, p);
    });
    return map;
  }, [productCodes]);

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

  // --- Optimized Data Fetching Hooks ---
  const sessionsQuery = useDepotCountSessions(selectedDepotId);
  const scannedItemsQuery = useScannedItems(activeSession?.id ?? null);
  const irsaliyeQuery = useIrsaliyeFiles(selectedDepotId);
  const selectedDepot = useMemo(() => sourceDepots.find(d => d.id === selectedDepotId), [sourceDepots, selectedDepotId]);

  // Derive state from queries
  const availableSessions = useMemo(() => 
    (sessionsQuery.data ?? []).filter(s => s.status === 'active'),
    [sessionsQuery.data]
  );

  useEffect(() => {
    if (activeSession && sessionsQuery.data) {
      const stillExists = sessionsQuery.data.some(s => s.id === activeSession.id && s.status === 'active');
      if (!stillExists) {
        setActiveSession(null);
        setScannedItems([]);
        toast({ title: "Oturum Sona Erdi", description: "Mevcut sayım oturumu kapatıldı." });
      }
    }
  }, [sessionsQuery.data, activeSession, toast]);

  useEffect(() => {
    if (scannedItemsQuery.data) {
      const sessionItems = (scannedItemsQuery.data as any[]).map(d => ({...d, id: d.id}) as ScanRow);
      setScannedItems(sessionItems.sort((a,b) => {
        const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : (a.timestamp as any)?.toDate?.()?.getTime?.() || 0;
        const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : (b.timestamp as any)?.toDate?.()?.getTime?.() || 0;
        return bTime - aTime;
      }));
    }
  }, [scannedItemsQuery.data]);

  useEffect(() => {
    if (irsaliyeQuery.data) {
      const files = irsaliyeQuery.data ?? [];
      const count = files.filter(f => {
        const expiresAt = (f as any)?.expiresAt;
        if (!expiresAt) return false;
        const expiryTime = expiresAt instanceof Date ? expiresAt.getTime() : (expiresAt.toDate?.()?.getTime() || 0);
        const notExpired = expiryTime > Date.now();
        const depotMatch = (f as any)?.locationType === 'depot' && (f as any)?.locationId === selectedDepotId;
        return notExpired && depotMatch;
      }).length;
      setPendingIrsaliyeCount(count);
    }
  }, [irsaliyeQuery.data, selectedDepotId]);

  useEffect(() => {
    if (!selectedDepotId) {
      setPendingFileIrsaliyeCount(0);
      return;
    }
    const pendingFilesQuery = scopedQuery('bekleyenIrsaliyeler', currentCompanyId, isSuperAdmin, orderBy('scannedAt', 'desc'));
    const unsubscribe = onSnapshot(pendingFilesQuery, (snapshot) => {
      const count = snapshot.docs.reduce((total, document) => {
        const data = document.data() as any;
        if (!matchesCompanyScope(data, currentCompanyId, isSuperAdmin)) return total;
        const belongsToDepot = data.locationType === 'depot' && data.locationId === selectedDepotId;
        return total + Number(data.status === 'pending' && belongsToDepot);
      }, 0);
      setPendingFileIrsaliyeCount(count);
    }, () => setPendingFileIrsaliyeCount(0));
    return () => unsubscribe();
  }, [selectedDepotId, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    const cari = ((selectedDepot as any)?.ceomedCariKodu || '').toString().trim().toUpperCase();
    if (!cari) {
      setPendingCeomedIrsaliye([]);
      return;
    }
    const q = scopedQuery('pendingCeomedIrsaliye', currentCompanyId, isSuperAdmin, where('status', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PendingCeomedIrsaliye[];
      const filtered = rows.filter((r) =>
        (r.cariKodu || '').trim().toUpperCase() === cari &&
        PENDING_CEOMED_DURUM_SET.has((r.durumAciklama || '').trim().toUpperCase())
      );
      setPendingCeomedIrsaliye(filtered);
    }, () => setPendingCeomedIrsaliye([]));
    return () => unsub();
  }, [selectedDepot]);

  // Kullanıcı "Depoda Kontrol Et" butonuna bastığında depo seri indeksini çeker
  // ve listedeki serileri depoyla karşılaştırır. Depoda zaten mevcut serileri
  // listeden çıkarır ve özet gösterir. Buton bir kez kullanıldığında indeks
  // cache'e gireceğinden, sonraki okutmalar da ekstra sorgu olmadan depo
  // mükerrerini anında yakalar (processScan içindeki `existingDepotSerials`).
  const handleDepotSerialCheck = useCallback(async () => {
    if (!selectedDepotId) {
      toast({ title: 'Depo seçili değil', description: 'Önce bir depo seçin.', variant: 'destructive' });
      return;
    }
    setIsCheckingDepotSerials(true);
    try {
      const res = await depotSerialIndexQuery.refetch();
      const index = res.data ?? new Map<string, Set<string>>();
      // Listedeki seri-takipli (gruplanmamış) satırlar
      const dupRows = scannedItems.filter(r =>
        !r.isProcessed && !r.isGroup && r.seriNumarasi && r.stokKodu &&
        (index.get(serialProductKey(r.stokKodu)) as Set<string> | undefined)?.has(r.seriNumarasi)
      );
      if (dupRows.length === 0) {
        flashScanFeedback('success', 'Listedeki seriler depoda mevcut değil — temiz.');
        toast({ title: 'Depo Kontrolü', description: 'Listedeki hiçbir seri depoda bulunmuyor.' });
        return;
      }
      const dupIds = new Set(dupRows.map(r => r.id));
      setScannedItems(prev => prev.filter(r => !dupIds.has(r.id)));
      // Oturum içi mükerrer takibinden de düş
      dupRows.forEach(r => {
        scannedSerialsRef.current.get(serialProductKey(r.stokKodu))?.delete(r.seriNumarasi!);
      });
      flashScanFeedback('error', `${dupRows.length} seri zaten depoda mevcut — listeden çıkarıldı.`);
      toast({
        title: 'Depo Kontrolü',
        description: `${dupRows.length} seri depoda zaten mevcut olduğu için listeden çıkarıldı.`,
        variant: 'destructive',
      });
    } catch (e) {
      malKabulLogger.error('Depo seri kontrolü başarısız', e);
      toast({ title: 'Depo Kontrolü Hatası', description: 'Depo serileri sorgulanamadı.', variant: 'destructive' });
    } finally {
      setIsCheckingDepotSerials(false);
    }
  }, [selectedDepotId, scannedItems, depotSerialIndexQuery, serialProductKey, toast, flashScanFeedback]);

  const processScan = useCallback(async (barcodeData: string, source: 'barcode' | 'bulk_item' = 'barcode') => {
    const scanCorrelationId = createCorrelationId();
    // Toplu QR içindeki alt okutmalar ana okutmanın ölçümünü ezmesin.
    if (source === 'barcode') startScanMeasurement();
    const trimmedData = (barcodeData || '').trim();
    if (!trimmedData) {
      malKabulLogger.warn('Scan ignored: empty payload', { source, isBulkScanMode }, { correlationId: scanCorrelationId });
      return;
    }

    const isBulkItem = source === 'bulk_item';
    // PERFORMANS: Okutma hot-path'indeki bilgi logları `debug` seviyesinde —
    // production'da (minLevel: 'info') bastırılır, böylece her okutmada gereksiz
    // JSON.stringify + console maliyeti olmaz (direkt transfer paneliyle aynı
    // hafiflik). Uyarı/hata logları korunur.
    malKabulLogger.debug('Scan received', {
      source,
      isBulkItem,
      isBulkScanMode,
      payloadLength: trimmedData.length,
      hasBulkHeader: trimmedData.includes('QORE_SERIAL_BULK_V1|'),
      payloadPreview: trimmedData.slice(0, 120),
    }, { correlationId: scanCorrelationId });

    const bulkBarcodes = decodeBulkSerialQrPayload(trimmedData);
    malKabulLogger.debug('Bulk decode result', {
      source,
      isBulkMode: isBulkScanMode,
      decodedCount: bulkBarcodes?.length || 0,
      decodedPreview: (bulkBarcodes || []).slice(0, 5),
    }, { correlationId: scanCorrelationId });

    if (bulkBarcodes) {
      for (const serialBarcode of bulkBarcodes) {
        await processScan(serialBarcode, 'bulk_item');
      }
      setIsBulkScanMode(false);
      malKabulLogger.debug('Bulk scan processed successfully', {
        itemCount: bulkBarcodes.length,
      }, { correlationId: scanCorrelationId });
      flashScanFeedback('success', `${bulkBarcodes.length} ürün tek seferde işlendi.`);
      return;
    }

    if (isBulkScanMode && !isBulkItem) {
      malKabulLogger.warn('Bulk mode reject: payload is not recognized as bulk format', {
        payloadLength: trimmedData.length,
        payloadPreview: trimmedData.slice(0, 160),
      }, { correlationId: scanCorrelationId });
      flashScanFeedback('error', 'Bu modda sadece toplu barkodlar okutulabilir.');
      return;
    }

    try {
        const resolveResult = parseAndResolveBarcode(trimmedData, barcodeFormats, productCodes as any);
        if (!resolveResult || !resolveResult.parsed) {
          malKabulLogger.warn('Single barcode parse failed', {
            source,
            payloadPreview: trimmedData.slice(0, 160),
          }, { correlationId: scanCorrelationId });
          throw new Error('Barkod tanımlı formatlarla eşleşmiyor.');
        }

        const resolved = resolveResult.parsed;
        if (!resolveResult.product) throw new Error(`Barkod numarası/referans herhangi bir ürünle eşleşmedi.`);

        const { lotNumarasi, miadFormatted, seriNumarasi, stokKodu } = resolved;
        if (!stokKodu) throw new Error('Stok kodu bulunamadı.');

        const matchedProduct = resolveResult.product;

        // Determine tracking mode based on what the barcode contains
        const matchedFormat = resolved.matchedFormatId
          ? barcodeFormats.find(f => f.id === resolved.matchedFormatId)
          : undefined;
        const staticTrackingMode = productTracking[stokKodu] || resolveDefaultTrackingMode(matchedProduct as any);
        const mode = (staticTrackingMode === 'qty_manual' || staticTrackingMode === 'qty_barcode')
          ? 'qty_barcode'
          : resolveEffectiveTrackingMode(resolved, matchedFormat, matchedProduct as any);
        const isLotOnlyBarcode = (mode === 'serial') && !!lotNumarasi && !seriNumarasi;

        if ((mode === 'serial') && !isLotOnlyBarcode) {
            if (!seriNumarasi) throw new Error('Bu ürün seri numarası ile takip edilir, barkod seri içermiyor.');

            // Mükerrer kontrolü: aynı ürün + seri no eşleşmesi (lot fark etmez)
            const serialKey = serialProductKey(stokKodu);
            const sessionSerials = scannedSerialsRef.current.get(serialKey);
            const depotSerials = existingDepotSerials.get(serialKey);
            const isInSession = sessionSerials?.has(seriNumarasi) ?? false;
            const isInDepot = depotSerials?.has(seriNumarasi) ?? false;

            if (isInSession || isInDepot) {
              playFeedback(true);
              const location = isInSession ? 'bu oturumda' : 'depoda';
              // Structured log: hata mesajı tekrar görüldüğünde stokKodu+seri eşleşmesini
              // konsoldan doğrulamak için. Yanlış pozitif geliyorsa burada görülür.
              malKabulLogger.warn('Mükerrer seri tespit edildi', {
                stokKodu,
                stokAdi: matchedProduct.stokAdi,
                seriNumarasi,
                isInSession,
                isInDepot,
                sessionSerialCount: sessionSerials?.size ?? 0,
                depotSerialCount: depotSerials?.size ?? 0,
              }, { correlationId: scanCorrelationId });
              flashScanFeedback('error', `SN ${seriNumarasi} (${matchedProduct.stokAdi}) ${location} zaten mevcut.`);
              if (source === 'barcode') { setScanStatus('error'); setTimeout(() => setScanStatus('idle'), 3000); }
              return;
            }

            const newItem: ScanRow = {
              id: generateId(), barkod: trimmedData, stokKodu: stokKodu, stokAdi: matchedProduct.stokAdi,
              lotNumarasi: lotNumarasi || '', miad: miadFormatted || '', seriNumarasi: seriNumarasi || '',
              rafAdresi: '', irsaliyeNumarasi: selectedPendingIrs?.irsaliyeNo || '', isSelected: false, timestamp: new Date(), isProcessed: false,
              adet: 1, isGroup: false, bulkQrAssigned: false,
              ...(otoKabulRef.current ? { syncStatus: 'pending' as const } : {}),
            };
            newItem.key = `${newItem.stokKodu}-${newItem.lotNumarasi}-${newItem.miad}`;
            // Oturum içi mükerrer takibi: stokKodu -> Set<seriNumarasi> (lot dahil değil)
            if (!scannedSerialsRef.current.has(serialKey)) {
              scannedSerialsRef.current.set(serialKey, new Set());
            }
            scannedSerialsRef.current.get(serialKey)!.add(seriNumarasi);
            
            startTransition(() => {
              setScannedItems(prev => [newItem, ...prev]);
              if (selectedPendingIrs) {
                const verifyKey = `${stokKodu}||${lotNumarasi || ''}||${miadFormatted || ''}`;
                setCeomedVerifyMap((prev) => {
                  const v = prev[verifyKey];
                  if (!v) return prev;
                  const nextSet = new Set(v.verifiedSerials);
                  nextSet.add(seriNumarasi);
                  return { ...prev, [verifyKey]: { ...v, verifiedSerials: nextSet } };
                });
              }
            });
            if (source === 'barcode') setLastScannedProduct(newItem);

            // PERFORMANS: Geçmişte tüketilmiş/işlem görmüş seri kontrolü artık her
            // okutmada Firestore'a sorgu atmıyor. Eskiden burada her seri için
            // `getDocs(serialHistory/{seri}/events)` çağrısı yapılıyordu; "fire and
            // forget" olsa bile her okutmada Firestore IndexedDB persistence katmanını
            // ve ağı tetikliyordu. Hızlı okutmalarda bu sorgular birikip ana iş
            // parçacığını boğuyor, her tuşa basıştan sonra boyamayı (paint) geciktiriyordu
            // (INP "keyboard" ~1.2sn). Aynı kontrol zaten "Mal Kabul" anında
            // (commit) TÜM seriler için tek bir batch halinde yapılıyor ve tüketilmiş
            // seriler yazımdan önce eleniyor — dolayısıyla doğruluk kaybı yok, sadece
            // uyarı okutma anı yerine kayıt anında görünür. Bu sayede okutma yolu
            // tamamen bellek-içi (in-memory) kalır ve <10ms hedefine ulaşır.

        } else {
          // It's a lot-based or quantity-based item
          startTransition(() => upsertGroupedRow(
            setScannedItems,
            { stokKodu: stokKodu, stokAdi: matchedProduct.stokAdi, lot: lotNumarasi, miad: miadFormatted, barkod: trimmedData, syncStatus: otoKabulRef.current ? 'pending' : undefined },
            (r) => !!(r.isGroup && r.stokKodu === stokKodu && r.lotNumarasi === (lotNumarasi || '') && r.miad === (miadFormatted || '') && !isRowSyncLocked(r)),
            1
          ));
          if (source === 'barcode') {
            const newItem = { stokKodu, stokAdi: matchedProduct.stokAdi, lotNumarasi, miad: miadFormatted, seriNumarasi: '' } as ScanRow;
            setLastScannedProduct(newItem);
          }
        }
        
        playFeedback();
        if (source === 'barcode') {
          setScanStatus('success');
          flashScanFeedback('success', `${matchedProduct.stokAdi} listeye eklendi.`);
          setTimeout(() => setScanStatus('idle'), 3000);
        }

    } catch (err: any) {
      malKabulLogger.error('Scan processing failed', err, {
        source,
        isBulkMode: isBulkScanMode,
        payloadPreview: trimmedData.slice(0, 160),
      }, { correlationId: scanCorrelationId });
      playFeedback(true);
      flashScanFeedback('error', err.message || 'Barkod işlenemedi.');
      if (source === 'barcode') {
        setScanStatus('error');
        setTimeout(() => setScanStatus('idle'), 3000);
      }
    }
  }, [flashScanFeedback, productCodes, barcodeFormats, existingDepotSerials, productTracking, isBulkScanMode, startScanMeasurement]);

  // Direkt transfer paneliyle aynı davranış: tarayıcı yalnızca modal/kamera/manuel
  // giriş açıkken devre dışı. Eskiden buradaki `!isProcessingScan` koşulu HER
  // okutmada window keydown dinleyicisini söküp yeniden ekliyordu (re-subscribe
  // churn) ve okutma işlenirken tarayıcıyı kapatıyordu. Okutma yolu artık tamamen
  // bellek-içi olduğundan (per-scan Firestore sorgusu kaldırıldı) bu kapıya gerek
  // yok; kaldırılması anlık, kesintisiz okutma sağlar.
  useHidScanner({
    enabled: !isPreCheckModalOpen && !isCameraScannerOpen && !showManualInline,
    onScan: ({ raw }) => {
      if (raw) processScan(raw, 'barcode');
    },
  });

  const handleCameraScanSuccess = (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (trimmed) {
      processScan(trimmed, 'barcode');
    } else {
      flashScanFeedback('error', 'Okunan veri boş görünüyor.');
    }
    if (!isBatchScanning) {
      setIsCameraScannerOpen(false);
    }
  };

  const handleCameraOcrLabelScan = useCallback(async ({ imageBlob, ocrText }: { imageBlob: Blob; ocrText: string }) => {
    let parsed: { stokKodu: string; stokAdi: string; lotNumarasi: string; miad: string } | null = null;
    try {
      parsed = await parseLabelWithGemini(imageBlob, ocrText, productCodes);
    } catch (error) {
      malKabulLogger.warn('Gemini label parsing failed, falling back to OCR text parser', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!parsed) {
      parsed = parseLabelText(ocrText, productCodes);
    }
    if (!parsed) {
      flashScanFeedback('error', 'Etiketten ürün kodu/adı tespit edilemedi.');
      playFeedback(true);
      return;
    }

    upsertGroupedRow(
      setScannedItems,
      {
        stokKodu: parsed.stokKodu,
        stokAdi: parsed.stokAdi,
        lot: parsed.lotNumarasi,
        miad: parsed.miad,
        barkod: `OCR_LABEL:${parsed.stokKodu}:${Date.now()}`,
      },
      (r) =>
        !!(
          r.isGroup &&
          r.stokKodu === parsed.stokKodu &&
          r.lotNumarasi === parsed.lotNumarasi &&
          r.miad === parsed.miad
        ),
      1
    );

    setLastScannedProduct({
      stokKodu: parsed.stokKodu,
      stokAdi: parsed.stokAdi,
      lotNumarasi: parsed.lotNumarasi,
      miad: parsed.miad,
      seriNumarasi: '',
    } as ScanRow);
    playFeedback();
    flashScanFeedback('success', `${parsed.stokAdi || parsed.stokKodu} etiketten listeye eklendi.`);
    if (!isBatchScanning) {
      setIsCameraScannerOpen(false);
    }
  }, [flashScanFeedback, productCodes, isBatchScanning]);
  
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

  const handleBulkBarcodeResults = (items: BulkScanResultItem[]) => {
    let addedSerial = 0;
    let addedLot = 0;
    let addedAdet = 0;
    let skipped = 0;

    items.forEach((item) => {
      // Use matched product or try to find by katalogNo
      const product = item.matchedProduct || productCodes.find(
        (p) => p.stokKodu === item.katalogNo || (p as any).barcodeNumber === item.katalogNo
      );
      if (!product) {
        skipped++;
        return;
      }

      const stokKodu = product.stokKodu;
      const stokAdi = product.stokAdi || item.urunAdi || '';
      const lotNumarasi = item.lotNo || '';
      const miad = item.skt || '';
      const seriNumarasi = item.seriNo || '';
      const adet = item.adet || 1;

      // If serial number exists, add as individual serial-tracked item
      if (seriNumarasi) {
        // Duplicate check: stokKodu + seriNumarasi (lot fark etmez)
        const serialKey = serialProductKey(stokKodu);
        const sessionSerials = scannedSerialsRef.current.get(serialKey);
        const depotSerials = existingDepotSerials.get(serialKey);
        if (sessionSerials?.has(seriNumarasi) || depotSerials?.has(seriNumarasi)) {
          skipped++;
          return;
        }

        const newItem: ScanRow = {
          id: generateId(),
          barkod: item.barkodVerisi || item.katalogNo || 'AI_BULK_SCAN',
          stokKodu,
          stokAdi,
          lotNumarasi,
          miad,
          seriNumarasi,
          rafAdresi: '',
          irsaliyeNumarasi: '',
          isSelected: false,
          timestamp: new Date(),
          isProcessed: false,
          adet: 1,
          isGroup: false,
          key: `${stokKodu}-${lotNumarasi}-${miad}`,
          bulkQrAssigned: false,
        };

        if (!scannedSerialsRef.current.has(serialKey)) {
          scannedSerialsRef.current.set(serialKey, new Set());
        }
        scannedSerialsRef.current.get(serialKey)!.add(seriNumarasi);
        setScannedItems((prev) => [newItem, ...prev]);
        addedSerial++;
        addedAdet++;
      } else {
        // No serial - add as lot/quantity grouped item with the detected quantity
        upsertGroupedRow(
          setScannedItems,
          { stokKodu, stokAdi, lot: lotNumarasi, miad, barkod: item.barkodVerisi || 'AI_BULK_SCAN' },
          (r) => !!(r.isGroup && r.stokKodu === stokKodu && r.lotNumarasi === lotNumarasi && r.miad === miad),
          adet
        );
        addedLot++;
        addedAdet += adet;
      }
    });

    if (addedAdet > 0) {
      playFeedback();
      flashScanFeedback(
        'success',
        `AI Toplu Tarama: ${addedAdet} adet urun eklendi (${addedSerial} seri + ${addedLot} grup)${skipped > 0 ? `, ${skipped} atlandı` : ''}.`
      );
    } else {
      flashScanFeedback('error', 'Hicbir urun eslenemedi.');
    }
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

  const totalScannedQuantity = useMemo(() => {
    return scannedItems
      .filter(item => !item.isProcessed)
      .reduce((n, item) => n + (item.isGroup ? (item.adet ?? 1) : 1), 0);
  }, [scannedItems]);

  const groupedScannedItems = useMemo(() => {
    const grouped: Record<string, ScanRow> = {};
    deferredScannedItems.forEach(item => {
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
  }, [deferredScannedItems]);
  
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
                const productSerials = scannedSerialsRef.current.get(serialProductKey(item.stokKodu));
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
  const addressInputRef = useRef<HTMLInputElement>(null);
  const irsaliyeInputRef = useRef<HTMLInputElement>(null);
  const [malKabulIsLoading, setMalKabulIsLoading] = useState(false);
  const [isGeneratingBulkQr, setIsGeneratingBulkQr] = useState(false);

  const selectedItemsCount = useMemo(() => {
    return scannedItems.filter(i => i.isSelected && !i.isProcessed).length;
  }, [scannedItems]);
  
  const unprocessedScannedItems = scannedItems.filter(i => !i.isProcessed).length;

  const selectedItemsForBulkQr = useMemo(() => {
    return scannedItems.filter(i => i.isSelected && !i.isProcessed);
  }, [scannedItems]);

  const selectedItemsAreSerialTracked = useMemo(() => {
    if (selectedItemsForBulkQr.length === 0) return false;
    return selectedItemsForBulkQr.every(i => {
      const stokKodu = i.stokKodu || '';
      const trackingMode = (stokKodu && productTracking[stokKodu]) || resolveDefaultTrackingMode({ stokAdi: i.stokAdi } as any);
      return trackingMode === 'serial';
    });
  }, [selectedItemsForBulkQr, productTracking]);

  const selectedSerialItemsForBulkQr = useMemo(() => {
    return selectedItemsForBulkQr.filter(i => !i.bulkQrAssigned && !!i.seriNumarasi && !!i.barkod);
  }, [selectedItemsForBulkQr]);

  const canAssignBulkQr = selectedItemsAreSerialTracked && selectedSerialItemsForBulkQr.length > 0;
  
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

      batch.set(txRef, withCompanyScope(stripUndefined(header), currentCompanyId));

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
        batch.set(lineRef, withCompanyScope(cleanLine, currentCompanyId));
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
    const manualVal = addressInputRef.current?.value || '';
    const address = addressDefinitions.find(ad => ad.addressBarcode === selectedAddressBarcode);
    if (!address && manualVal.trim() === '') {
      toast({ title: 'Hata', description: 'Lütfen listeden bir adres seçin veya manuel girin', variant: 'destructive' });
      return;
    }
    const targetAddressName = address ? address.addressName : manualVal.trim();
    setScannedItems(prev =>
      prev.map(item =>
        item.isSelected && !item.isProcessed
          ? { ...item, rafAdresi: targetAddressName, isSelected: false }
          : item
      )
    );
    toast({ title: 'Başarılı', description: `Seçili ürünlere adres atandı.` });
    setSelectedAddressBarcode('');
    if (addressInputRef.current) addressInputRef.current.value = '';
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
    const val = irsaliyeInputRef.current?.value || '';
    if (val.trim() === '') {
      toast({ title: 'Hata', description: 'Lütfen irsaliye numarası girin', variant: 'destructive' });
      return;
    }
    setScannedItems(prev =>
      prev.map(item =>
        item.isSelected && !item.isProcessed
          ? { ...item, irsaliyeNumarasi: val.trim(), isSelected: false }
          : item
      )
    );
    toast({ title: 'Başarılı', description: `Seçili ürünlere "${val.trim()}" irsaliye no atandı.` });
    if (irsaliyeInputRef.current) irsaliyeInputRef.current.value = '';
    setIsIrsaliyeModalOpen(false);
  };

  const handleAssignBulkSerialQr = async () => {
    if (selectedItemsForBulkQr.length === 0) {
      toast({ title: 'Uyarı', description: 'Lütfen barkod atanacak ürünleri seçin.' });
      return;
    }

    if (!canAssignBulkQr) {
      toast({
        title: 'Geçersiz seçim',
        description: 'Toplu barkod atama için tüm seçim seri takipli olmalı ve en az bir ürüne daha önce barkod atanmamış olmalıdır.',
        variant: 'destructive',
      });
      return;
    }

    const barcodeValues = selectedSerialItemsForBulkQr.map(item => (item.barkod || '').trim()).filter(Boolean);
    if (barcodeValues.length === 0) {
      toast({ title: 'Hata', description: 'Seçili ürünlerde barkod bulunamadı.', variant: 'destructive' });
      return;
    }

    setIsGeneratingBulkQr(true);
    try {
      const encodedUrl = encodeBulkSerialQrPayload(barcodeValues);
      malKabulLogger.info('Bulk QR payload generated', {
        barcodeCount: barcodeValues.length,
        encodedLength: encodedUrl.length,
        encodedPreview: encodedUrl.slice(0, 180),
      });
      const qrDataUrl = await QRCode.toDataURL(encodedUrl, {
        errorCorrectionLevel: 'M',
        width: 512,
        margin: 1,
      });

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      pdf.setFontSize(14);
      pdf.text('Toplu Seri Barkod', 15, 18);
      pdf.setFontSize(10);
      pdf.text(`Toplam ürün: ${barcodeValues.length}`, 15, 24);
      pdf.text(`Tarih: ${new Date().toLocaleString('tr-TR')}`, 15, 29);
      pdf.addImage(qrDataUrl, 'PNG', 15, 35, 80, 80);
      pdf.setFontSize(8);
      const previewLines = barcodeValues.slice(0, 25).map((barcode, index) => `${index + 1}. ${barcode}`);
      pdf.text(previewLines, 100, 40);
      if (barcodeValues.length > 25) {
        pdf.text(`... (+${barcodeValues.length - 25} barkod)`, 100, 40 + (25 * 4));
      }
      const fileName = `toplu-seri-barkod-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pdf`;
      pdf.save(fileName);

      const selectedIds = new Set(selectedSerialItemsForBulkQr.map(i => i.id));
      setScannedItems(prev => prev.map(item =>
        selectedIds.has(item.id)
          ? { ...item, bulkQrAssigned: true, isSelected: false }
          : item
      ));

      toast({ title: 'Başarılı', description: `${barcodeValues.length} ürün için toplu barkod oluşturuldu ve PDF indirildi.` });
    } catch (error: any) {
      toast({ title: 'Barkod üretilemedi', description: safeStr(error?.message) || 'Toplu barkod oluşturulurken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsGeneratingBulkQr(false);
    }
  };

  const performGoodsReceipt = (itemsToProcess: ScanRow[]) => {
    // 1. Durumu Yedekle (Rollback için)
    const previousScannedItems = [...scannedItems];
    const processedIds = new Set(itemsToProcess.map(i => i.id).filter(Boolean) as string[]);
    const depotName = sourceDepots.find(d => d.id === selectedDepotId)?.name || 'Bilinmeyen Depo';

    // 2. Optimistic UI - Anında Ekranı Güncelle (0 ms tepki)
    setIsPreCheckModalOpen(false);
    setScannedItems(prev => prev.filter(i => i.id && !processedIds.has(i.id)));
    
    // Geçici olarak map'i temizle ve kalan öğeleri yeniden ekle
    scannedSerialsRef.current.clear();
    scannedItems.forEach(item => {
        if (item.id && !processedIds.has(item.id) && item.seriNumarasi && item.stokKodu) {
        const serialKey = serialProductKey(item.stokKodu);
        if (!scannedSerialsRef.current.has(serialKey)) {
          scannedSerialsRef.current.set(serialKey, new Set());
        }
        scannedSerialsRef.current.get(serialKey)!.add(item.seriNumarasi);
      }
    });

    toast({
      title: 'İşlem Kaydediliyor...',
      description: `${itemsToProcess.length} kalem arka planda işleniyor. Çıkış yapmayınız.`,
      duration: 3000
    });

    // 3. Arka Plan İşlemi (Fire and Forget)
    (async () => {
      setCommitInfo(null);
      const queue = new BatchQueue({
        chunkSize: 450,
        onProgress: (info) => setCommitInfo(info),
      });

      try {
        // NOTE: Mükerrer seri kontrolü artık tamamen `existingDepotSerials`
        // üzerinden yapılıyor — `Map<stokKodu, Set<seriNumarasi>>` formatında,
        // dolayısıyla farklı ürünler aynı seri numarasını paylaşabiliyor.
        // Eski versiyonda burada `where('seriNumarasi', 'in', ...)` ile stokKodu
        // filtresiz bir Firestore sorgusu vardı; sonucu hiçbir yerde
        // okunmuyordu (ölü kod) ve çağrı başına gereksiz okuma üretiyordu.

        // Check history of all serials to process to avoid duplicates of consumed/processed serials
        const serialsToCheck: { serial: string; stokKodu: string }[] = [];
        itemsToProcess.forEach(item => {
          if (!item.isGroup && item.seriNumarasi && item.stokKodu) {
            serialsToCheck.push({ serial: item.seriNumarasi, stokKodu: item.stokKodu });
          } else if (item.isGroup && item.scannedSerials && item.stokKodu) {
            item.scannedSerials.forEach(s => {
              if (s) {
                serialsToCheck.push({ serial: s, stokKodu: item.stokKodu! });
              }
            });
          }
        });

        const consumedSerials = new Set<string>();
        if (serialsToCheck.length > 0) {
          await Promise.all(
            serialsToCheck.map(async ({ serial, stokKodu }) => {
              try {
                const historySnap = await getDocs(
                  query(
                    collection(db, `serialHistory/${serial}/events`),
                    limit(1)
                  )
                );
                if (!historySnap.empty) {
                  const matchedEvent = historySnap.docs.some(doc => doc.data().details?.stokKodu === stokKodu);
                  if (matchedEvent) {
                    consumedSerials.add(`${stokKodu}||${serial}`);
                  }
                }
              } catch (e) {
                console.error("Error checking history in commit", e);
              }
            })
          );
        }

        const docsToCreate: Array<{ ref: ReturnType<typeof doc>; data: any; serial?: string; item: ScanRow }> = [];
        // Okutma anındaki Firestore sorgusu kaldırıldığı için, geçmişte tüketilmiş
        // serileri burada (commit) eleyip kullanıcıya kaç tanesinin atlandığını bildiriyoruz.
        let skippedConsumed = 0;

        for (const item of itemsToProcess) {
          const depotProductSerials = item.stokKodu ? existingDepotSerials.get(serialProductKey(item.stokKodu)) : undefined;
          if (item.seriNumarasi && (depotProductSerials?.has(item.seriNumarasi) || consumedSerials.has(`${item.stokKodu}||${item.seriNumarasi}`))) {
            if (consumedSerials.has(`${item.stokKodu}||${item.seriNumarasi}`)) skippedConsumed++;
            continue;
          }

          const serialsToProcess = item.isGroup ? (item.scannedSerials || []) : [item.seriNumarasi];
          const filteredSerials = (serialsToProcess.filter(Boolean) as string[]).filter(serial => {
            const isConsumed = consumedSerials.has(`${item.stokKodu}||${serial}`);
            if (isConsumed) skippedConsumed++;
            return !isConsumed;
          });

          const createDocData = (serial = '') => buildDepoStokDocData(item, serial, {
            depotId: selectedDepotId,
            depotName,
            createdByName: currentUserProfile?.name || currentUser?.email || 'Unknown',
            createdByUid: currentUser?.uid || null,
          });

          if (item.isGroup && filteredSerials.length === 0) {
            // OPTIMIZED: Create ONE document with 'adet' instead of 1000 separate ones
            docsToCreate.push({
              ref: doc(collection(db, 'depoStok')),
              data: withCompanyScope({ 
                ...createDocData(), 
                adet: Math.max(1, item.adet ?? 1) 
              }, currentCompanyId),
              item,
            });
          } else {
            for (const serial of filteredSerials) {
              docsToCreate.push({
                ref: doc(collection(db, 'depoStok')),
                data: withCompanyScope({ 
                  ...createDocData(serial),
                  adet: 1 // Serial items always have adet: 1
                }, currentCompanyId),
                serial,
                item,
              });
            }
          }
        }

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
        await touchStockMetadata();
        invalidateDepoStok();

        const txId = await recordMalKabulTransaction(itemsToProcess, 'unverified');
        toast({
          title: 'Kabul Tamamlandı',
          description: `${itemsToProcess.length} kalem işlem başarıyla kaydedildi.${skippedConsumed > 0 ? ` ${skippedConsumed} seri geçmişte işlem görmüş/tüketilmiş olduğu için atlandı.` : ''}`,
          action: (
            <Button variant="default" onClick={() => router.push(`/mal-kabul/gecmis?depotId=${encodeURIComponent(selectedDepotId)}&open=${encodeURIComponent(txId)}`)}>
              Geçmişte Aç
            </Button>
          ),
        });

      } catch (error: any) {
        console.error("Mal kabul hatası:", error);
        // 4. ROLLBACK (Geri Alma)
        setScannedItems(previousScannedItems);
        scannedSerialsRef.current.clear();
        previousScannedItems.forEach(item => {
          if (item.seriNumarasi && item.stokKodu) {
            const serialKey = serialLotKey(item.stokKodu, item.lotNumarasi || '');
            if (!scannedSerialsRef.current.has(serialKey)) {
              scannedSerialsRef.current.set(serialKey, new Set());
            }
            scannedSerialsRef.current.get(serialKey)!.add(item.seriNumarasi);
          }
        });
        toast({ 
          title: "İşlem İptal Edildi (Rollback)", 
          description: safeStr(error?.message) || 'Kayıt sırasında bir hata oluştu, liste eski haline döndürüldü.', 
          variant: "destructive" 
        });
      } finally {
        setCommitInfo(null);
      }
    })();
  };

  // ── Oto Kabul arka plan worker'ı ────────────────────────────────────────────
  // Tek bir mikro-partiyi (≤ AUTO_BATCH_SIZE pending satır) idempotent biçimde
  // stoğa yazar: depoStok + serialHistory + (oturum başına tek) malKabulTransactions
  // başlığı/satırları. Deterministik belge kimlikleri sayesinde yeniden denemeler
  // çift kayıt oluşturmaz. Geçmişte işlem görmüş seriler manuel akışla birebir aynı
  // şekilde elenir.
  const AUTO_BATCH_SIZE = 20;

  const commitAutoAcceptBatch = async (
    picked: ScanRow[]
  ): Promise<{ confirmed: Map<string, string>; failed: Map<string, string> }> => {
    const confirmed = new Map<string, string>();
    const failed = new Map<string, string>();
    const depotName = sourceDepots.find(d => d.id === selectedDepotId)?.name || 'Bilinmeyen Depo';
    const ctx: DepoStokDocContext = {
      depotId: selectedDepotId,
      depotName,
      createdByName: currentUserProfile?.name || currentUser?.email || 'Unknown',
      createdByUid: currentUser?.uid || null,
    };

    // 1) Geçmişte işlem görmüş serileri tespit et (arka planda, okutma dışı).
    const serialChecks: { serial: string; stokKodu: string }[] = [];
    picked.forEach(item => {
      if (!item.isGroup && item.seriNumarasi && item.stokKodu) {
        serialChecks.push({ serial: item.seriNumarasi, stokKodu: item.stokKodu });
      } else if (item.isGroup && item.scannedSerials && item.stokKodu) {
        item.scannedSerials.forEach(s => { if (s) serialChecks.push({ serial: s, stokKodu: item.stokKodu! }); });
      }
    });
    const consumed = new Set<string>();
    if (serialChecks.length > 0) {
      await Promise.all(serialChecks.map(async ({ serial, stokKodu }) => {
        try {
          const snap = await getDocs(query(collection(db, `serialHistory/${serial}/events`), limit(1)));
          if (!snap.empty && snap.docs.some(d => d.data().details?.stokKodu === stokKodu)) {
            consumed.add(`${stokKodu}||${serial}`);
          }
        } catch { /* okuma hatasında yazım yine denenir */ }
      }));
    }

    // 2) depoStok + serialHistory tek writeBatch (parti küçük; 500 op limiti uzak).
    const batch = writeBatch(db);
    const writtenRows: ScanRow[] = [];

    for (const item of picked) {
      const depotProductSerials = item.stokKodu ? existingDepotSerials.get(serialProductKey(item.stokKodu)) : undefined;
      if (!item.isGroup && item.seriNumarasi &&
          (depotProductSerials?.has(item.seriNumarasi) || consumed.has(`${item.stokKodu}||${item.seriNumarasi}`))) {
        failed.set(item.id, 'Bu seri depoda mevcut veya geçmişte işlem görmüş.');
        continue;
      }

      const serialsToProcess = item.isGroup ? (item.scannedSerials || []) : [item.seriNumarasi];
      const filteredSerials = (serialsToProcess.filter(Boolean) as string[])
        .filter(s => !consumed.has(`${item.stokKodu}||${s}`));

      if (item.isGroup && filteredSerials.length === 0) {
        // Lot/adet grubu → tek belge + adet. Deterministik id: satıra bağlı.
        const ref = doc(db, 'depoStok', `mkrow-${sanitizeFsId(item.id)}`);
        batch.set(ref, withCompanyScope({ ...buildDepoStokDocData(item, '', ctx), adet: Math.max(1, item.adet ?? 1) }, currentCompanyId));
        confirmed.set(item.id, ref.id);
        writtenRows.push(item);
      } else {
        if (filteredSerials.length === 0) {
          failed.set(item.id, 'Seri(ler) geçmişte işlem görmüş.');
          continue;
        }
        let firstId = '';
        for (const serial of filteredSerials) {
          // Deterministik id (companyId+depot+stok+seri) → tekrar denemeler tek belge.
          const ref = doc(db, 'depoStok', `mk-${sanitizeFsId(currentCompanyId || 'nc')}-${sanitizeFsId(selectedDepotId)}-${sanitizeFsId(item.stokKodu || '')}-${sanitizeFsId(serial)}`);
          batch.set(ref, withCompanyScope({ ...buildDepoStokDocData(item, serial, ctx), adet: 1 }, currentCompanyId));
          const histRef = doc(collection(db, `serialHistory/${serial}/events`));
          batch.set(histRef, {
            type: 'intake',
            details: { stokKodu: item.stokKodu || '', stokAdi: item.stokAdi || '', depotId: selectedDepotId, depotName, rafAdresi: item.rafAdresi || '', irsaliyeNumarasi: item.irsaliyeNumarasi || '' },
            timestamp: Timestamp.now(),
          });
          if (!firstId) firstId = ref.id;
        }
        confirmed.set(item.id, firstId);
        writtenRows.push(item);
      }
    }

    // 3) malKabulTransactions: oturum başına tek başlık (lazy), satırlar artımlı.
    if (writtenRows.length > 0) {
      if (autoTxRef.current && autoTxRef.current.depotId !== selectedDepotId) autoTxRef.current = null;
      const addedCount = writtenRows.reduce((n, r) => n + Math.max(1, r.adet ?? 1), 0);
      const brands = Array.from(new Set(writtenRows.map(r => getBrandFor(r.stokKodu || '', r.stokAdi || '')).filter(Boolean)));

      if (!autoTxRef.current) {
        const transactionId = `MK-${generateId()}`;
        const txRef = doc(db, 'malKabulTransactions', transactionId);
        const header: MalKabulHeader = {
          transactionId, depotId: selectedDepotId, depotName,
          userId: currentUser?.uid || '', userName: currentUserProfile?.name || currentUser?.email || 'Unknown',
          timestamp: Timestamp.now(), itemCount: addedCount, brands, mode: 'unverified',
        };
        batch.set(txRef, withCompanyScope(stripUndefined(header), currentCompanyId));
        autoTxRef.current = { id: transactionId, ref: txRef, depotId: selectedDepotId };
      } else {
        const upd: Record<string, unknown> = { itemCount: increment(addedCount) };
        if (brands.length) upd.brands = arrayUnion(...brands);
        batch.update(autoTxRef.current.ref, upd);
      }

      const txRef = autoTxRef.current.ref;
      for (const line of buildTransactionLines(writtenRows)) {
        const lineRef = doc(collection(txRef, 'lines'));
        batch.set(lineRef, withCompanyScope(stripUndefined({
          stokKodu: line.stokKodu, stokAdi: line.stokAdi, lotNumarasi: line.lotNumarasi || '', miad: line.miad || '',
          adet: line.adet ?? 0, serials: Array.isArray(line.serials) ? (line.serials as string[]).filter(Boolean) : [],
        }), currentCompanyId));
      }
    }

    await batch.commit();
    return { confirmed, failed };
  };

  // Tek tur drenaj: pending satırları atomik kilitle (flushSync ile snapshot al),
  // yaz, sonucu işaretle. Dönen değer: daha işlenecek pending kaldıysa true.
  const drainAutoAcceptOnce = async (): Promise<boolean> => {
    let picked: ScanRow[] = [];
    // flushSync: kilit+snapshot'ı senkron uygula → adet kaybı/yarış olmadan
    // `picked`'i güvenle dışarı al. Tarama duraklamasında (idle) çalıştığı için
    // okutma gecikmesini etkilemez.
    flushSync(() => {
      setScannedItems(prev => {
        picked = [];
        let changed = false;
        const next = prev.map(it => {
          if (picked.length >= AUTO_BATCH_SIZE) return it;
          if (it.syncStatus !== 'pending' || !it.stokKodu) return it;
          const locked: ScanRow = { ...it, syncStatus: 'processing' };
          picked.push(locked);
          changed = true;
          return locked;
        });
        return changed ? next : prev;
      });
    });
    if (picked.length === 0) return false;

    try {
      const { confirmed, failed } = await commitAutoAcceptBatch(picked);
      setScannedItems(prev => prev.map(it => {
        if (confirmed.has(it.id)) return { ...it, isProcessed: true, isSelected: false, syncStatus: 'confirmed', serverDocId: confirmed.get(it.id) };
        if (failed.has(it.id)) return { ...it, syncStatus: 'failed', syncError: failed.get(it.id) };
        return it;
      }));
      if (confirmed.size || failed.size) {
        setAutoStats(s => ({ confirmed: s.confirmed + confirmed.size, failed: s.failed + failed.size }));
      }
      if (autoTxRef.current) setAutoTxId(autoTxRef.current.id);
      await touchStockMetadata();
      invalidateDepoStok();
      return true;
    } catch (e: any) {
      const msg = safeStr(e?.message) || 'Stoğa yazılamadı.';
      const pickedIds = new Set(picked.map(p => p.id));
      setScannedItems(prev => prev.map(it => {
        if (!pickedIds.has(it.id)) return it;
        const retries = (it.syncRetries ?? 0) + 1;
        // Kalıcı hatada (3 deneme) failed; geçici hatada pending → otomatik retry.
        if (retries >= 3) return { ...it, syncStatus: 'failed', syncError: msg, syncRetries: retries };
        return { ...it, syncStatus: 'pending', syncRetries: retries };
      }));
      return false;
    }
  };

  // drainRef her render'da en güncel closure ile yenilenir; zamanlayıcı efekti
  // yalnızca bu ref'i çağırır (stale-closure / dep churn yok).
  const drainAutoAcceptRef = useRef<() => Promise<void>>(async () => {});
  drainAutoAcceptRef.current = async () => {
    if (autoRunningRef.current || !otoKabulRef.current) return;
    autoRunningRef.current = true;
    try {
      let more = true;
      while (more && otoKabulRef.current) {
        more = await drainAutoAcceptOnce();
      }
    } finally {
      autoRunningRef.current = false;
    }
  };

  // Oto kabul açık ve pending satır varken, tarama duraklamasında drenajı planla.
  // Her okutmada efekt yeniden kurulur ve önceki idle görevi iptal edilir →
  // hızlı okutma sırasında drenaj ertelenir, okutma bitince devreye girer.
  useEffect(() => {
    if (!otoKabul) return;
    if (!scannedItems.some(i => i.syncStatus === 'pending')) return;
    const handle = scheduleIdle(() => { void drainAutoAcceptRef.current(); });
    autoIdleHandleRef.current = handle;
    return () => { cancelIdle(handle); autoIdleHandleRef.current = null; };
  }, [otoKabul, scannedItems]);

  const handleToggleOtoKabul = (next: boolean) => {
    if (next && !selectedDepotId) {
      toast({ title: 'Depo Seçilmedi', description: 'Oto kabul için önce bir depo seçin.', variant: 'destructive' });
      return;
    }
    setOtoKabul(next);
    otoKabulRef.current = next;
    if (next) {
      setAutoStats({ confirmed: 0, failed: 0 });
      setAutoTxId(null);
      autoTxRef.current = null;
      // Açılmadan önce okutulmuş, henüz işlenmemiş satırları da kuyruğa al.
      setScannedItems(prev => prev.map(it =>
        (!it.isProcessed && it.syncStatus !== 'confirmed' && it.syncStatus !== 'processing')
          ? { ...it, syncStatus: 'pending', syncRetries: 0, syncError: undefined }
          : it
      ));
      toast({ title: 'Oto Kabul Açık', description: 'Okutulan ürünler arka planda otomatik stoğa eklenecek.' });
    } else {
      if (autoIdleHandleRef.current != null) { cancelIdle(autoIdleHandleRef.current); autoIdleHandleRef.current = null; }
      autoTxRef.current = null;
      // Kuyrukta bekleyen (henüz yazılmamış) satırları normal listeye döndür.
      setScannedItems(prev => prev.map(it => it.syncStatus === 'pending' ? { ...it, syncStatus: undefined } : it));
      toast({ title: 'Oto Kabul Kapalı', description: 'Yeni okutmalar elle "Kabul Et" ile kaydedilecek.' });
    }
  };

  const retryAutoGroup = (group: ScanRow) => {
    const ids = new Set((group.items && group.items.length ? group.items : [group]).map(i => i.id));
    setScannedItems(prev => prev.map(it =>
      ids.has(it.id) && it.syncStatus === 'failed'
        ? { ...it, syncStatus: 'pending', syncRetries: 0, syncError: undefined }
        : it
    ));
  };

  const handlePreCheckAndDogrulamasizMalKabul = async () => {
    if (!selectedDepotId) {
      toast({ title: 'Hata', description: 'Ön kontrol için önce bir depo seçilmelidir.', variant: 'destructive' });
      return;
    }
  
    const expectedSerials = new Set(
      Object.values(ceomedVerifyMap).flatMap((v) => v.serials.map((s) => `${v.stokKodu}||${v.lot || ''}||${v.miad || ''}||${s}`))
    );
    const verifiedSerials = new Set(
      Object.values(ceomedVerifyMap).flatMap((v) => Array.from(v.verifiedSerials).map((s) => `${v.stokKodu}||${v.lot || ''}||${v.miad || ''}||${s}`))
    );
    const itemsToProcess = scannedItems.filter(i => {
      if (i.isProcessed || !i.rafAdresi) return false;
      const hasIrs = !!i.irsaliyeNumarasi || !!selectedPendingIrs;
      if (!hasIrs) return false;
      if (!i.seriNumarasi) return true;
      const key = `${i.stokKodu || ''}||${i.lotNumarasi || ''}||${i.miad || ''}||${i.seriNumarasi || ''}`;
      if (!expectedSerials.has(key)) return true; // irsaliyede olmayan ama okutulanlar da stoğa eklensin
      return verifiedSerials.has(key); // irsaliyede olup doğrulanmayanlar eklenmesin
    }).map(i => ({ ...i, irsaliyeNumarasi: i.irsaliyeNumarasi || selectedPendingIrs?.irsaliyeNo || '' }));
    if (itemsToProcess.length === 0) {
      toast({ title: 'Bilgi', description: 'İşlenecek yeni ürün yok (adres ve irsaliye atanmamış olabilir).', variant: "default" });
      return;
    }
    
    performGoodsReceipt(itemsToProcess);
  };

  const handleApproveCeomedToDepot = async (irs: PendingCeomedIrsaliye) => {
    if (!selectedDepotId || !selectedDepot) return;
    setCeomedApprovingId(irs.id);
    try {
      const batch = writeBatch(db);
      let added = 0;
      const lineMap = new Map<string, MalKabulLine>();

      for (const item of (irs.items || [])) {
        const product = productCodes.find((p) => (p.stokKodu || '').trim() === (item.STOK_KODU || '').trim());
        if (!product || ((product as any).trackingMode !== 'serial')) continue;
        const qty = Math.max(1, Number(item.MIKTAR) || 1);
        for (let i = 0; i < qty; i++) {
          const ref = doc(collection(db, 'depoStok'));
          batch.set(ref, withCompanyScope({
            depotId: selectedDepotId,
            depotName: selectedDepot.name || '',
            stokKodu: item.STOK_KODU,
            stokAdi: product.stokAdi || '',
            lotNumarasi: item.LOT || '',
            miad: item.MIYAT ? normalizeMiad(item.MIYAT) : '',
            seriNumarasi: item.BARKOD_SERI || '',
            rafAdresi: '',
            irsaliyeNumarasi: irs.irsaliyeNo,
            eklenmeTarihi: Timestamp.now(),
            isShipped: false,
            hedefKurumId: '',
            hedefKurum: '',
            createdByName: currentUserProfile?.name || currentUser?.email || 'Ceomed Sync',
            createdByUid: currentUser?.uid || null,
            source: 'ceomed',
            ceomedIrsaliyeId: irs.ceomedId,
          }, currentCompanyId));
          added++;
        }
        const key = `${item.STOK_KODU}||${item.LOT || ''}||${item.MIYAT || ''}`;
        const prev = lineMap.get(key) || { stokKodu: item.STOK_KODU, stokAdi: product.stokAdi || '', lotNumarasi: item.LOT || '', miad: item.MIYAT ? normalizeMiad(item.MIYAT) : '', adet: 0, serials: [] };
        prev.adet += qty;
        if (item.BARKOD_SERI) prev.serials.push(item.BARKOD_SERI);
        lineMap.set(key, prev);
      }
      await batch.commit();

      const txRef = doc(db, 'malKabulTransactions', `MK-CEOMED-${irs.ceomedId}`);
      const lineBatch = writeBatch(db);
      lineBatch.set(txRef, withCompanyScope({
        transactionId: `MK-CEOMED-${irs.ceomedId}`,
        depotId: selectedDepotId,
        depotName: selectedDepot.name || '',
        userId: currentUser?.uid || '',
        userName: currentUserProfile?.name || currentUser?.email || 'Ceomed Sync',
        timestamp: Timestamp.now(),
        irsaliyeNo: irs.irsaliyeNo,
        itemCount: added,
        mode: 'verified',
        source: 'ceomed',
        ceomedIrsaliyeId: irs.ceomedId,
      }, currentCompanyId));
      for (const line of lineMap.values()) lineBatch.set(doc(collection(txRef, 'lines')), withCompanyScope(line, currentCompanyId));
      lineBatch.set(doc(db, 'pendingCeomedIrsaliye', irs.id), {
        status: 'approved',
        approvedAt: Timestamp.now(),
        approvedBy: currentUser?.uid || null,
        approvedByName: currentUserProfile?.name || currentUser?.email || '',
        depotId: selectedDepotId,
        depotName: selectedDepot.name || '',
      }, { merge: true });
      await lineBatch.commit();
      await touchStockMetadata();
      invalidateDepoStok();
      toast({ title: 'İrsaliye stoğa aktarıldı', description: `${irs.irsaliyeNo} için ${added} kayıt depoya eklendi.` });
    } catch (e: any) {
      toast({ title: 'Hata', description: e?.message || 'Ceomed aktarım hatası', variant: 'destructive' });
    } finally {
      setCeomedApprovingId(null);
    }
  };

  const buildPendingLines = useCallback((irs: PendingCeomedIrsaliye | null): PendingCeomedLine[] => {
    if (!irs) return [];
    const grouped = new Map<string, PendingCeomedLine>();
    for (const it of (irs.items || [])) {
      const key = `${it.STOK_KODU}||${it.LOT || ''}||${it.MIYAT || ''}`;
      const p = productCodes.find((x) => (x.stokKodu || '').trim() === (it.STOK_KODU || '').trim());
      const prev = grouped.get(key) || {
        key,
        stokKodu: it.STOK_KODU,
        lot: it.LOT || '',
        miad: it.MIYAT ? normalizeMiad(it.MIYAT) : '',
        stokAdi: p?.stokAdi || '',
        marka: (p as any)?.marka || '',
        adet: 0,
        serials: [],
      };
      prev.adet += Math.max(1, Number(it.MIKTAR) || 1);
      if (it.BARKOD_SERI) prev.serials.push(it.BARKOD_SERI);
      grouped.set(key, prev);
    }
    return Array.from(grouped.values());
  }, [productCodes]);

  const handleStartVerifiedCeomedReceipt = (irs: PendingCeomedIrsaliye) => {
    const lines = buildPendingLines(irs);
    const rows: ScanRow[] = [];
    for (const line of lines) {
      if (line.serials.length > 0) {
        for (const s of line.serials) {
          rows.push({
            id: generateId(),
            barkod: s,
            stokKodu: line.stokKodu,
            stokAdi: line.stokAdi || line.stokKodu,
            lotNumarasi: line.lot,
            miad: line.miad,
            seriNumarasi: s,
            rafAdresi: '',
            irsaliyeNumarasi: irs.irsaliyeNo,
            isSelected: false,
            timestamp: new Date(),
            isProcessed: false,
            adet: 1,
            isGroup: false,
            bulkQrAssigned: false,
            key: `${line.stokKodu}-${line.lot}-${line.miad}`,
          } as ScanRow);
        }
      }
    }
    setScannedItems((prev) => [...rows, ...prev]);
    setSelectedPendingIrs(irs);
    const verify: Record<string, CeomedVerifyLine> = {};
    for (const line of lines) {
      if (line.serials.length > 0) verify[line.key] = { ...line, verifiedSerials: new Set<string>() };
    }
    setCeomedVerifyMap(verify);
    setIsPendingCeomedModalOpen(false);
    toast({ title: 'Doğrulamalı moda aktarıldı', description: `${irs.irsaliyeNo} seri numaraları mal kabul listesine eklendi. Adres ataması yapıp doğrulayarak devam edin.` });
  };

  const markVerifyLineComplete = (group: ScanRow) => {
    const key = `${group.stokKodu}||${group.lotNumarasi || ''}||${group.miad || ''}`;
    setCeomedVerifyMap((prev) => {
      const v = prev[key];
      if (v) {
        const nextSet = new Set(v.serials);
        return { ...prev, [key]: { ...v, verifiedSerials: nextSet } };
      }
      // fallback: map key bulunamazsa satırdaki seriallardan doğrulama satırı oluştur
      const rowSerials = Array.from(new Set((group.items || []).map(i => i.seriNumarasi).filter(Boolean) as string[]));
      if (rowSerials.length === 0) return prev;
      const normalizedKey = `${group.stokKodu || ''}||${group.lotNumarasi || ''}||${group.miad ? normalizeMiad(group.miad) : ''}`;
      return {
        ...prev,
        [normalizedKey]: {
          key: normalizedKey,
          stokKodu: group.stokKodu || '',
          stokAdi: group.stokAdi || '',
          marka: '',
          lot: group.lotNumarasi || '',
          miad: group.miad || '',
          adet: rowSerials.length,
          serials: rowSerials,
          verifiedSerials: new Set(rowSerials),
        },
      };
    });
  };

  const getVerifyLineForGroup = (group: ScanRow): CeomedVerifyLine | null => {
    const raw = `${group.stokKodu || ''}||${group.lotNumarasi || ''}||${group.miad || ''}`;
    if (ceomedVerifyMap[raw]) return ceomedVerifyMap[raw];
    const normalized = `${group.stokKodu || ''}||${group.lotNumarasi || ''}||${group.miad ? normalizeMiad(group.miad) : ''}`;
    if (ceomedVerifyMap[normalized]) return ceomedVerifyMap[normalized];
    // Fallback: doğrulamalı modda map key tutarsızlığı olsa bile satırdaki seriallardan üret
    if (selectedPendingIrs && group.items && group.items.length > 0) {
      const serials = Array.from(new Set(group.items.map((it) => it.seriNumarasi).filter(Boolean) as string[]));
      if (serials.length > 0) {
        const verifiedSerials = new Set(
          group.items
            .filter((it) => !!it.seriNumarasi)
            .map((it) => it.seriNumarasi as string)
            .filter((s) => {
              const k = `${group.stokKodu || ''}||${group.lotNumarasi || ''}||${group.miad || ''}`;
              return ceomedVerifyMap[k]?.verifiedSerials.has(s) || ceomedVerifyMap[normalized]?.verifiedSerials.has(s);
            })
        );
        return {
          key: normalized,
          stokKodu: group.stokKodu || '',
          stokAdi: group.stokAdi || '',
          marka: '',
          lot: group.lotNumarasi || '',
          miad: group.miad || '',
          adet: serials.length,
          serials,
          verifiedSerials,
        };
      }
    }
    return null;
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

  // Total item count: sums adet for all items (correct for lot/qty grouped items)
  const totalItemCount = useMemo(() =>
    scannedItems.reduce((n, it) => n + (it.adet ?? 1), 0),
    [scannedItems]
  );

  // Skeleton kaldırıldı: panel artık anında açılır.
  // Prefetch (AppLayout) sayesinde cache doluysa depolar anında gelir;
  // cache boşsa depo dropdown'ı birkaç 100ms sonra dolar — kullanıcı bekleme ekranı görmez.

  // ── Readiness (gerçek veri yüklemesine bağlı 3 adım) ──
  // 1) Barkod formatları  2) Stok & adres verileri  3) İrsaliye eşleştirme
  const readinessStage = useMemo(() => {
    const fmtReady = !barcodeFormatsPending && barcodeFormats.length > 0;
    const stockReady = !productsPending && productCodes.length > 0;
    const irsReady = Boolean(selectedDepotId);
    if (fmtReady && stockReady && irsReady) return 3;
    if (fmtReady && stockReady) return 2;
    if (fmtReady) return 1;
    return 0;
  }, [barcodeFormatsPending, barcodeFormats.length, productsPending, productCodes.length, selectedDepotId]);
  const systemReady = readinessStage >= 3;
  const readinessPct = Math.round((readinessStage / 3) * 100);

  // Distinct lot count across the scanned list (for the KPI "lot" figure).
  const distinctLotCount = useMemo(
    () => new Set(scannedItems.filter(i => i.lotNumarasi).map(i => i.lotNumarasi)).size,
    [scannedItems]
  );

  // Last scanned product, mapped to the readiness card shape.
  const readinessLastItem: MkLastItem = useMemo(() => {
    if (!lastScannedProduct) return null;
    const meta = productMetaByCode.get(lastScannedProduct.stokKodu || '');
    return {
      stokAdi: lastScannedProduct.stokAdi || '',
      stokKodu: lastScannedProduct.stokKodu || '',
      seriNumarasi: lastScannedProduct.seriNumarasi || '',
      lotNumarasi: lastScannedProduct.lotNumarasi || '',
      miad: (lastScannedProduct.miad as string) || '',
      qty: totalCountForProduct,
      unit: meta?.anaBirim || 'adet',
    };
  }, [lastScannedProduct, totalCountForProduct, productMetaByCode]);

  // Top stepper position: Depo → Okut → Kabul.
  const topStepperActive = stepperState.hasItems ? (stepperState.hasMeta ? 2 : 1) : 0;
  const pendingIrsaliyeTotal = pendingCeomedIrsaliye.length + pendingFileIrsaliyeCount;

  return (
    <>
      {/* Full-bleed cream backdrop — paneli çevreleyen gri tema zeminini örter */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, background: 'linear-gradient(120deg, #F6F2EA 0%, transparent 55%), linear-gradient(225deg, #E8E1D2 0%, transparent 55%), #EFEAE0', zIndex: 0 }} />
    <div className="mk-shell px-3 py-4 sm:px-6 sm:py-5 space-y-4 min-h-screen" style={{ maxWidth: 1720, margin: '0 auto', position: 'relative', zIndex: 1 }}>
      <MkClayStyles />
      <ScanCommitProbe controller={scanPerformanceController} />

      {/* ── TOP CONTEXT BAR: stepper + depo + geçmiş + bekleyen ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '16px 22px', borderRadius: MK_C.radius, background: `linear-gradient(180deg, ${MK_C.surface} 0%, ${MK_C.surface2} 100%)`, boxShadow: MK_C.clay, flexWrap: 'wrap', animation: 'mkRise 420ms cubic-bezier(0.34,1.56,0.64,1) both' }}>
        <MkTopStepper active={topStepperActive} />
        <div style={{ width: 1, height: 38, background: MK_C.line }} className="hidden sm:block" />
        <div style={{ minWidth: 230 }} className="flex-1 sm:flex-none">
          <div style={{ fontSize: 10.5, fontWeight: 700, color: MK_C.ink3, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>Çalışma Deposu</div>
          <Select value={selectedDepotId} onValueChange={(v: string) => setSelectedDepotId(v)}>
            <SelectTrigger className="w-full border-0" style={{ background: MK_C.surface2, boxShadow: MK_C.clayInset, borderRadius: MK_C.radiusSm, height: 44 }}>
              <SelectValue placeholder="Depo seçin..." />
            </SelectTrigger>
            <SelectContent>
              {sourceDepots.filter(d => !!d.id).map(dep => (
                <SelectItem key={dep.id!} value={dep.id!}>{dep.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div style={{ flex: 1 }} className="hidden sm:block" />
        <MkSoftBtn icon={<History size={17} />} onClick={() => router.push(selectedDepotId ? `/mal-kabul/gecmis?depotId=${encodeURIComponent(selectedDepotId)}` : '/mal-kabul/gecmis')}>
          Geçmiş
        </MkSoftBtn>
        <MkSoftBtn icon={<FileText size={17} />} onClick={() => setIsPendingCeomedModalOpen(true)} disabled={!selectedDepotId} badge={pendingIrsaliyeTotal}>
          Bekleyen İrsaliyeler
        </MkSoftBtn>
      </div>

      {/* ── KPI ROW: readiness + add panel ── */}
      <div className="mk-grid-kpi" style={{ animation: 'mkRise 460ms cubic-bezier(0.34,1.56,0.64,1) 60ms both' }}>
        <MkReadinessCard
          stage={readinessStage}
          ready={systemReady}
          pct={readinessPct}
          lastItem={readinessLastItem}
          lotCount={distinctLotCount}
          unitCount={totalScannedQuantity}
          pulse={scanFeedback?.type === 'success'}
          feedback={scanFeedback}
          onReload={() => window.location.reload()}
        />
        <MkAddPanel
          ready={systemReady}
          onTekli={() => { setIsBatchScanning(false); setIsCameraScannerOpen(true); }}
          onSeri={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }}
          onManual={() => setShowManualInline(v => !v)}
          onIrsaliye={() => setIsOcrModalOpen(true)}
          onDepoda={handleDepotSerialCheck}
          onExcel={() => setIsExcelImportOpen(true)}
          manualActive={showManualInline}
          irsaliyeBadge={pendingIrsaliyeCount}
          depodaDisabled={isCheckingDepotSerials || !selectedDepotId}
          depodaLoading={isCheckingDepotSerials}
        />
      </div>

      {/* ── Manuel Giriş Paneli (collapsible drawer) ── */}
      {showManualInline && (
        <div style={{ padding: '16px 20px', borderRadius: MK_C.radius, background: `linear-gradient(180deg, ${MK_C.surface} 0%, ${MK_C.surface2} 100%)`, boxShadow: MK_C.clay, position: 'relative' }}>
          <div className="flex items-center justify-between mb-3">
            <p style={{ fontSize: 11.5, fontWeight: 700, color: MK_C.ink3, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Manuel Ürün Girişi</p>
            <button onClick={() => setShowManualInline(false)} title="Manuel Girişi Gizle" style={{ all: 'unset', cursor: 'pointer', width: 30, height: 30, borderRadius: 8, background: MK_C.surface2, display: 'grid', placeItems: 'center', color: MK_C.ink3 }}>
              <X className="h-4 w-4" />
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
      <div style={{ borderRadius: MK_C.radiusLg, background: `linear-gradient(180deg, ${MK_C.surface} 0%, ${MK_C.surface2} 100%)`, boxShadow: MK_C.clay, overflow: 'hidden', minHeight: 460, display: 'flex', flexDirection: 'column', animation: 'mkRise 500ms cubic-bezier(0.34,1.56,0.64,1) 130ms both' }}>
        {/* ── Selection mode sticky bar ── */}
        {isSelectionMode && (
          <div className="sticky top-0 z-10 flex items-center gap-2 sm:gap-3 px-4 py-2.5 text-white" style={{ background: `linear-gradient(180deg, ${MK_C.accent2}, ${MK_C.accent})` }}>
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
              onClick={handleAssignBulkSerialQr}
              disabled={malKabulIsLoading || isGeneratingBulkQr || !canAssignBulkQr}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-xs sm:text-sm font-medium transition-colors disabled:opacity-50"
              title={!canAssignBulkQr ? 'Yalnızca seri takipli seçimlerde, barkod atanmamış ürünler için kullanılabilir' : undefined}
            >
              {isGeneratingBulkQr ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
              Barkod Ata ({selectedSerialItemsForBulkQr.length})
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
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-4 sm:px-6" style={{ borderBottom: `1px solid ${MK_C.line}` }}>
          <div className="flex items-baseline gap-2.5 flex-shrink-0">
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: MK_C.ink1, whiteSpace: 'nowrap' }}>Okutulan Ürünler</h2>
            <span style={{ fontSize: 18, fontWeight: 800, color: MK_C.accent }}>({scannedItems.length})</span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1, padding: '4px 14px', borderRadius: MK_C.radiusSm, background: MK_C.surface2, boxShadow: MK_C.clayInset }} className="ml-2">
              <span style={{ fontSize: 10, fontWeight: 700, color: MK_C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Toplam Okutulan</span>
              <span key={totalScannedQuantity} style={{ fontSize: 22, fontWeight: 800, color: MK_C.accent, animation: 'mkCountPop 400ms ease' }}>{totalScannedQuantity}</span>
            </div>
            {commitInfo && <span style={{ fontSize: 11, color: MK_C.ink3 }}>Yazılıyor... ({commitInfo.commits} batch)</span>}
          </div>
          <div className="flex-1" />
          {!isSelectionMode && (
            <div className="flex flex-wrap items-center gap-2">
              <MkChipBtn
                icon={<CheckSquare className="h-4 w-4" />}
                onClick={() => {
                  const anySelected = scannedItems.some(i => !i.isProcessed && i.isSelected);
                  setScannedItems(prev => prev.map(item => (!item.isProcessed ? { ...item, isSelected: !anySelected } : item)));
                }}
                disabled={malKabulIsLoading || unprocessedScannedItems === 0}
                title={unprocessedScannedItems === 0 ? 'Önce ürün ekleyin' : undefined}
              >
                Seç {unprocessedScannedItems > 0 ? `(${unprocessedScannedItems})` : ''}
              </MkChipBtn>
              <MkChipBtn
                icon={<QrCode className="h-4 w-4" />}
                onClick={() => {
                  const next = !isBulkScanMode;
                  setIsBulkScanMode(next);
                  flashScanFeedback('success', next ? 'Toplu barkod modu açık' : 'Normal barkod okuma moduna dönüldü.');
                }}
                disabled={malKabulIsLoading}
                active={isBulkScanMode}
                title="Sadece toplu barkod okutma modunu aç/kapat"
              >
                Toplu Barkod Oku
              </MkChipBtn>
              <MkChipBtn icon={<Sparkles className="h-4 w-4" style={{ color: MK_C.accent }} />} onClick={() => setIsBulkBarcodeScanOpen(true)} disabled={malKabulIsLoading} title="AI ile toplu barkod tarama">
                AI Toplu Tara
              </MkChipBtn>
              <MkChipBtn icon={<Trash2 className="h-4 w-4" />} onClick={clearAllScannedItems} disabled={malKabulIsLoading || scannedItems.length === 0} danger title={scannedItems.length === 0 ? 'Liste boş' : undefined}>
                Temizle
              </MkChipBtn>
              {/* Oto Kabul: açıkken okutulanlar arka planda anında stoğa eklenir */}
              <label
                title={!selectedDepotId ? 'Önce depo seçin' : 'Açıkken okutulan her ürün arka planda otomatik stoğa eklenir'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, cursor: selectedDepotId ? 'pointer' : 'not-allowed',
                  padding: '6px 12px', borderRadius: MK_C.radiusPill,
                  background: otoKabul ? 'rgba(111,181,133,0.16)' : MK_C.surface2,
                  boxShadow: otoKabul ? `0 0 0 1.5px ${MK_C.accent}55` : MK_C.clayInset,
                  opacity: selectedDepotId ? 1 : 0.55,
                }}
              >
                <Zap className="h-3.5 w-3.5" style={{ color: otoKabul ? MK_C.accent : MK_C.ink3 }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: otoKabul ? MK_C.waterDeep : MK_C.ink2 }}>Oto Kabul</span>
                <Switch checked={otoKabul} onCheckedChange={handleToggleOtoKabul} disabled={!selectedDepotId} />
                {otoKabul && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700 }}>
                    <span style={{ color: MK_C.waterDeep }}>{autoStats.confirmed} eklendi</span>
                    {autoStats.failed > 0 && <span style={{ color: MK_C.danger }}>· {autoStats.failed} hata</span>}
                    {autoTxId && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); router.push(`/mal-kabul/gecmis?depotId=${encodeURIComponent(selectedDepotId)}&open=${encodeURIComponent(autoTxId)}`); }}
                        style={{ all: 'unset', cursor: 'pointer', color: MK_C.accent, textDecoration: 'underline' }}
                      >
                        Geçmiş
                      </button>
                    )}
                  </span>
                )}
              </label>
              <MkAcceptBtn
                count={stepperState.readyCount}
                onClick={handlePreCheckAndDogrulamasizMalKabul}
                disabled={isLoading || unprocessedScannedItems === 0}
                loading={malKabulIsLoading || isLoading}
                label={selectedItemsCount > 0 ? `Seçilenleri Kabul Et (${selectedItemsCount})` : `Kabul Et ve Stoğa Ekle (${stepperState.readyCount})`}
              />
            </div>
          )}
        </div>

        {/* ── Table header (desktop) ── */}
        {scannedItems.length > 0 && (
          <div className="hidden sm:grid grid-cols-[40px_46px_2fr_1fr_1fr_1fr_1fr_80px_90px_40px] gap-1 px-4 sm:px-6 py-3" style={{ borderBottom: `1px solid ${MK_C.line}` }}>
            {['', '', 'Ürün', 'Lot', 'Miad', 'Adres', 'İrsaliye', 'Adet', 'Birim', ''].map((h, i) => (
              <span key={i} style={{ fontSize: 11, fontWeight: 700, color: MK_C.ink3, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: i === 7 ? 'right' : i === 8 ? 'center' : 'left' }}>{h}</span>
            ))}
          </div>
        )}

        {/* ── Table body ── */}
        <div className="flex-1 overflow-hidden" style={{ padding: scannedItems.length === 0 ? 0 : '12px 14px' }}>
          {scannedItems.length === 0 ? (
            <MkEmptyState
              ready={systemReady}
              onSerial={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }}
              onIrsaliye={() => setIsOcrModalOpen(true)}
              onAI={() => setIsBulkBarcodeScanOpen(true)}
              irsaliyeBadge={pendingIrsaliyeCount}
            />
          ) : (
            <VirtualizedList<ScanRow>
              items={groupedScannedItems}
              height="44vh"
              estimateSize={84}
              overscan={10}
              getItemKey={(item: ScanRow) => item.key || item.id}
              className=""
              renderItem={(group: ScanRow, groupIndex: number) => {
                const trackingMode = (group.stokKodu && productTracking[group.stokKodu]) || resolveDefaultTrackingMode({stokAdi: group.stokAdi} as any);
                const hasSerials = trackingMode === 'serial';
                const meta = productMetaByCode.get(group.stokKodu || '');
                const verifyLine = getVerifyLineForGroup(group);
                const multiplier = formatUnitMultiplier(meta);
                const unitLabel = `${normalizeUnitLabel(meta?.anaBirim)}${multiplier ? ` (${multiplier})` : ''}`;
                const adet = group.adet ?? 0;

                // ── Oto Kabul: grup içi senkron durum özeti ──
                const subRows = (group.items && group.items.length ? group.items : [group]) as ScanRow[];
                const sConfirmed = subRows.filter(i => i.syncStatus === 'confirmed').length;
                const sProcessing = subRows.filter(i => i.syncStatus === 'processing').length;
                const sPending = subRows.filter(i => i.syncStatus === 'pending').length;
                const sFailed = subRows.filter(i => i.syncStatus === 'failed').length;
                const syncFailReason = subRows.find(i => i.syncStatus === 'failed')?.syncError;
                let syncBadge: React.ReactNode = null;
                if (sFailed > 0) {
                  syncBadge = (
                    <button
                      type="button"
                      onClick={() => retryAutoGroup(group)}
                      title={syncFailReason || 'Yeniden dene'}
                      style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, background: 'rgba(220,80,80,0.14)', color: MK_C.danger, fontSize: 10, fontWeight: 700 }}
                    >
                      <RefreshCw className="h-2.5 w-2.5" /> Hata · Tekrar
                    </button>
                  );
                } else if (sProcessing > 0) {
                  syncBadge = (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, background: 'rgba(120,150,210,0.16)', color: MK_C.waterDeep, fontSize: 10, fontWeight: 700 }}>
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Ekleniyor
                    </span>
                  );
                } else if (sPending > 0) {
                  syncBadge = (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, background: MK_C.surface2, color: MK_C.ink3, fontSize: 10, fontWeight: 700 }}>
                      <Clock className="h-2.5 w-2.5" /> Sırada
                    </span>
                  );
                } else if (sConfirmed > 0) {
                  syncBadge = (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, background: 'rgba(111,181,133,0.16)', color: MK_C.waterDeep, fontSize: 10, fontWeight: 700 }}>
                      <CheckCircle2 className="h-2.5 w-2.5" /> Stokta
                    </span>
                  );
                }

                const checkbox = (
                  <Checkbox checked={group.isSelected} onCheckedChange={() => toggleGroupSelection(group.key)} />
                );
                const qtyControl = hasSerials ? (
                  <span style={{ fontSize: 15, fontWeight: 800, color: MK_C.ink1 }}>{formatQuantityWithUnit(adet, meta, { showMultiplier: true })}</span>
                ) : (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: 5, borderRadius: MK_C.radiusPill, background: MK_C.surface2, boxShadow: MK_C.clayInset }}>
                    <button onClick={() => handleAdetChange(group.key, String(Math.max(1, adet - 1)))} style={{ all: 'unset', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: `linear-gradient(180deg, ${MK_C.surfaceHi}, ${MK_C.surface2})`, boxShadow: MK_C.clayFlat, color: MK_C.ink2 }}><Minus className="h-3.5 w-3.5" /></button>
                    <input value={adet} onChange={(e) => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); handleAdetChange(group.key, String(isNaN(v) ? 1 : v)); }} style={{ width: 40, textAlign: 'center', border: 'none', background: 'transparent', fontSize: 15, fontWeight: 800, color: MK_C.accent, fontFamily: 'inherit', outline: 'none' }} />
                    <button onClick={() => handleAdetChange(group.key, String(adet + 1))} style={{ all: 'unset', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: `radial-gradient(120% 120% at 30% 25%, ${MK_C.accent2}, ${MK_C.accent})`, boxShadow: `0 5px 11px -4px ${MK_C.accentGlow}`, color: '#fff' }}><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                );
                const actions = (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    {(verifyLine || (selectedPendingIrs && hasSerials)) && (
                      <button onClick={() => markVerifyLineComplete(group)} title="Bu satırdaki tüm seri numaralarını okutulmuş say" style={{ all: 'unset', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', color: MK_C.waterDeep, background: MK_C.surface2, boxShadow: MK_C.clayFlat }}>
                        <CheckSquare className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => deleteGroup(group.key)} aria-label="Sil" style={{ all: 'unset', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', color: MK_C.danger, background: MK_C.surface2, boxShadow: MK_C.clayFlat }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );

                return (
                  <div style={{ paddingBottom: 10, animation: 'mkPopIn 280ms ease' }}>
                    <div style={{ borderRadius: MK_C.radius, background: MK_C.surfaceHi, boxShadow: group.isSelected ? `${MK_C.clayFlat}, 0 0 0 1.5px ${MK_C.accent}66` : MK_C.clayFlat, overflow: 'hidden' }}>
                      {/* Desktop row */}
                      <div className="hidden sm:grid grid-cols-[40px_46px_2fr_1fr_1fr_1fr_1fr_80px_90px_40px] gap-1 items-center" style={{ padding: '13px 18px' }}>
                        <div>{checkbox}</div>
                        <div style={{
                          width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center',
                          background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF 0%, #ECE4D4 82%)',
                          boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.9), inset 0 -4px 7px rgba(178,160,128,0.22), 0 4px 10px -5px rgba(150,128,96,0.28)',
                          color: MK_C.accent,
                        }}>
                          <Package className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 700, color: MK_C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.stokAdi}</div>
                          <div className="flex items-center gap-1.5" style={{ marginTop: 2 }}>
                            <span style={{ fontSize: 11.5, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace' }}>{group.stokKodu}</span>
                            {group.bulkQrAssigned && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, background: 'rgba(111,181,133,0.14)', color: MK_C.waterDeep, fontSize: 10, fontWeight: 700 }}>
                                <Download className="h-2.5 w-2.5" /> Barkod atandı
                              </span>
                            )}
                            {syncBadge}
                          </div>
                        </div>
                        <div style={{ fontSize: 12.5, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.lotNumarasi || '—'}</div>
                        <div style={{ fontSize: 12.5, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.miad || '—'}</div>
                        <div style={{ textAlign: 'center' }}>
                          {group.rafAdresi ? <MkGoodChip mono><MapPin className="h-3 w-3" /> {group.rafAdresi}</MkGoodChip> : <MkWarnChip><AlertTriangle className="h-3 w-3" /> Adres yok</MkWarnChip>}
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          {group.irsaliyeNumarasi ? <MkGoodChip mono>{group.irsaliyeNumarasi}</MkGoodChip> : <MkWarnChip><AlertTriangle className="h-3 w-3" /> İrsaliye yok</MkWarnChip>}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>{qtyControl}</div>
                        <div style={{ textAlign: 'center', fontSize: 12, color: MK_C.ink2, fontWeight: 600 }}>{unitLabel}</div>
                        {actions}
                      </div>

                      {/* Mobile row */}
                      <div className="sm:hidden" style={{ padding: '13px 15px' }}>
                        <div className="flex items-start gap-2.5">
                          <div className="mt-1">{checkbox}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div style={{ fontSize: 14.5, fontWeight: 700, color: MK_C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.stokAdi}</div>
                                <div style={{ fontSize: 11.5, color: MK_C.ink2, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{group.stokKodu} · {unitLabel}</div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {qtyControl}
                                {actions}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 items-center" style={{ marginTop: 8 }}>
                              {group.lotNumarasi && <MkGoodChip mono>Lot {group.lotNumarasi}</MkGoodChip>}
                              {group.miad && <MkGoodChip mono>SKT {group.miad}</MkGoodChip>}
                              {group.rafAdresi ? <MkGoodChip mono><MapPin className="h-3 w-3" /> {group.rafAdresi}</MkGoodChip> : <MkWarnChip><AlertTriangle className="h-3 w-3" /> Adres yok</MkWarnChip>}
                              {group.irsaliyeNumarasi ? <MkGoodChip mono>{group.irsaliyeNumarasi}</MkGoodChip> : <MkWarnChip><AlertTriangle className="h-3 w-3" /> İrsaliye yok</MkWarnChip>}
                              {syncBadge}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Serial number expansion */}
                      {hasSerials && group.items && group.items.length > 0 && (
                        <div style={{ padding: '10px 18px', background: MK_C.surface2, borderTop: `1px solid ${MK_C.line}` }}>
                          {verifyLine && (
                            <div className="flex items-center justify-between mb-2">
                              <div style={{ fontSize: 12, color: MK_C.ink2 }}>Okutulan {verifyLine.verifiedSerials.size} / Beklenen {verifyLine.serials.length}</div>
                              <Button size="sm" variant="outline" onClick={() => markVerifyLineComplete(group)}>✓ Tümü Okutuldu</Button>
                            </div>
                          )}
                          <div className="text-[10px] font-mono grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1">
                            {group.items.slice(0, 100).map(item => {
                              const key = `${group.stokKodu}||${group.lotNumarasi || ''}||${group.miad || ''}`;
                              const vm = ceomedVerifyMap[key];
                              const verified = !!(vm && item.seriNumarasi && vm.verifiedSerials.has(item.seriNumarasi));
                              return (
                                <span key={item.id} className="truncate" style={{ padding: '2px 8px', borderRadius: 8, border: `1px solid ${verified ? 'rgba(111,181,133,0.5)' : 'rgba(192,121,106,0.4)'}`, color: verified ? MK_C.waterDeep : MK_C.danger }}>{item.seriNumarasi}</span>
                              );
                            })}
                            {group.items.length > 100 && <span style={{ color: MK_C.ink3 }}>+{group.items.length - 100} daha...</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
          )}
        </div>

        {/* ── Footer summary ── */}
        {scannedItems.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 26px', borderTop: `1px solid ${MK_C.line}` }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: MK_C.radiusPill, background: MK_C.surface2, boxShadow: MK_C.clayInset, fontSize: 13, fontWeight: 700, color: MK_C.ink1 }}>
              <span style={{ fontSize: 10.5, color: MK_C.ink3, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Kalem</span>
              <strong>{groupedScannedItems.length}</strong>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: MK_C.radiusPill, background: MK_C.surface2, boxShadow: MK_C.clayInset, fontSize: 13, fontWeight: 700, color: MK_C.ink1 }}>
              <span style={{ fontSize: 10.5, color: MK_C.ink3, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Lot</span>
              <strong>{distinctLotCount}</strong>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: MK_C.radiusPill, background: MK_C.surface2, boxShadow: MK_C.clayInset, fontSize: 13, fontWeight: 700, color: MK_C.ink1 }}>
              <span style={{ fontSize: 10.5, color: MK_C.ink3, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Toplam</span>
              <strong style={{ color: MK_C.accent }}>{totalScannedQuantity}</strong>
            </span>
            {scannedItems.some(i => !i.isProcessed && (!i.rafAdresi || !i.irsaliyeNumarasi)) && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: MK_C.radiusPill, background: MK_C.amberSoft, fontSize: 13, fontWeight: 700, color: '#9A6F1E' }}>
                <AlertTriangle className="h-3.5 w-3.5" /> Bazı ürünlerde adres / irsaliye eksik
              </span>
            )}
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
              enableOcrLabelScan
              onOcrLabelScan={handleCameraOcrLabelScan}
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
              <Input ref={addressInputRef} placeholder="Veya manuel adres girin" className="mt-1" />
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
            <Input ref={irsaliyeInputRef} placeholder="İrsaliye numarasını girin" className="mt-1" />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleAssignIrsaliyeNo}>Ata</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CEOMED ve dosya yönetimi kaynaklı bekleyen irsaliyeler */}
      <Dialog open={isPendingCeomedModalOpen} onOpenChange={setIsPendingCeomedModalOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden flex flex-col p-0" style={{ background: `linear-gradient(180deg, ${MK_C.surface} 0%, ${MK_C.surface2} 100%)`, borderRadius: MK_C.radiusLg, border: 'none' }}>
          <MkClayStyles />
          <DialogHeader className="px-6 pt-6 pb-4" style={{ borderBottom: `1px solid ${MK_C.line}` }}>
            <div className="flex items-start gap-3">
              <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: MK_C.accent, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: MK_C.clayFlat }}><FileText className="h-5 w-5" /></span>
              <div>
                <DialogTitle style={{ fontSize: 20, fontWeight: 800, color: MK_C.ink1 }}>Bekleyen İrsaliyeler</DialogTitle>
                <DialogDescription style={{ color: MK_C.ink2, marginTop: 4 }}>
                  CEOMED entegrasyonundan ve dosya yönetiminde taranan PDF&apos;lerden gelen kayıtları tek alandan yönetin.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-6 px-6 py-5">
            <section className="space-y-3">
              <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                <span style={{ color: MK_C.accent, display: 'inline-flex' }}><FileText className="h-4 w-4" /></span>
                <span style={{ fontSize: 14.5, fontWeight: 800, color: MK_C.ink1 }}>CEOMED Entegrasyonu</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: MK_C.ink3 }}>({pendingCeomedIrsaliye.length})</span>
              </div>
              {!((selectedDepot as any)?.ceomedCariKodu) ? (
                <div style={{ borderRadius: MK_C.radiusSm, background: MK_C.surface2, boxShadow: MK_C.clayInset, padding: '24px 16px', textAlign: 'center', fontSize: 13.5, color: MK_C.ink2 }}>
                  Seçili depo için CEOMED cari kodu tanımlı değil.
                </div>
              ) : pendingCeomedIrsaliye.length === 0 ? (
                <div style={{ borderRadius: MK_C.radiusSm, background: MK_C.surface2, boxShadow: MK_C.clayInset, padding: '24px 16px', textAlign: 'center', fontSize: 13.5, color: MK_C.ink2 }}>Bekleyen CEOMED irsaliyesi bulunamadı.</div>
              ) : pendingCeomedIrsaliye.map((irs) => {
                const lines = buildPendingLines(irs);
                const brands = Array.from(new Set(lines.map(l => l.marka).filter(Boolean)));
                const totalKalem = lines.length;
                const isSelected = selectedPendingIrs?.id === irs.id;
                return (
                  <MkWaybillCard
                    key={irs.id}
                    title={irs.irsaliyeNo}
                    subtitle={`${brands.length ? `Markalar: ${brands.join(', ')}` : 'Marka bilgisi yok'} · ${totalKalem} kalem`}
                    code={irs.cariKodu}
                    selected={isSelected}
                    onClick={() => setSelectedPendingIrs(isSelected ? null : irs)}
                  >
                    {isSelected && (
                      <div className="space-y-2" style={{ borderTop: `1px solid ${MK_C.line}`, paddingTop: 12 }}>
                        {lines.map((g, idx) => (
                          <Accordion key={`${g.stokKodu}-${g.lot}-${idx}`} type="single" collapsible>
                            <AccordionItem value="s">
                              <AccordionTrigger>
                                <div className="flex w-full justify-between pr-2 text-sm" style={{ color: MK_C.ink1 }}>
                                  <span>{g.stokKodu} - {g.stokAdi} • Lot: {g.lot || '-'} • SKT: {g.miad || '-'}</span>
                                  <span className="font-semibold">Adet: {g.adet}</span>
                                </div>
                              </AccordionTrigger>
                              <AccordionContent>
                                <div className="text-xs grid grid-cols-2 md:grid-cols-4 gap-1 font-mono">
                                  {g.serials.length ? g.serials.map((serial, index) => <span key={`${serial}-${index}`} style={{ padding: '4px 8px', borderRadius: 8, border: `1px solid rgba(192,121,106,0.4)`, color: MK_C.danger }}>{serial}</span>) : <span style={{ color: MK_C.ink3 }}>Seri yok</span>}
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        ))}
                        <div className="flex justify-end gap-2 pt-1">
                          <Button variant="outline" onClick={() => handleStartVerifiedCeomedReceipt(irs)}>Doğrulamalı Stoğa Aktar</Button>
                          <Button onClick={() => handleApproveCeomedToDepot(irs)} disabled={ceomedApprovingId === irs.id} style={{ background: `linear-gradient(180deg, ${MK_C.accent2}, ${MK_C.accent})`, color: '#fff' }}>
                            {ceomedApprovingId === irs.id ? 'Aktarılıyor...' : 'Stoğa Aktar'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </MkWaybillCard>
                );
              })}
            </section>

            <section style={{ borderTop: `1px solid ${MK_C.line}`, paddingTop: 20 }}>
              {selectedDepotId && selectedDepot && (
                <BekleyenIrsaliyelerPanel
                  locationType="depot"
                  locationId={selectedDepotId}
                  locationName={selectedDepot.name || ''}
                />
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      {isOcrModalOpen && (
        <IrsaliyeOcrModal
          isOpen={isOcrModalOpen}
          onClose={() => setIsOcrModalOpen(false)}
          productCodes={productCodes}
          onResults={handleOcrResults}
          locationType="depot"
          locationId={selectedDepotId}
        />
      )}

      {/* AI Bulk Barcode Scan Modal */}
      {isBulkBarcodeScanOpen && (
        <BulkBarcodeScanModal
          isOpen={isBulkBarcodeScanOpen}
          onClose={() => setIsBulkBarcodeScanOpen(false)}
          productCodes={productCodes}
          onResults={handleBulkBarcodeResults}
        />
      )}

      {/* Excel ile Stok Girişi */}
      {isExcelImportOpen && (
        <ExcelStokGirisModal
          isOpen={isExcelImportOpen}
          onClose={() => setIsExcelImportOpen(false)}
          productCodes={productCodes}
          productTracking={productTracking}
          onResults={handleBulkBarcodeResults}
        />
      )}
    </div>
    </>
  );
}
