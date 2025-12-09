
'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, ChangeEvent, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type {
  ScannedItem,
  ProductCode,
  AddressDefinition,
  DepoStokItem,
  VerificationReportItem,
  Shipment,
  Depot,
  MinMaxRule,
  User as AppUser,
  DepotStockCountSession
} from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Barcode, Trash2, CheckSquare, PlusCircle, AlertTriangle, Loader2, Search, CheckCircle, XCircle, History, Upload, Download, FileText, Warehouse, Building, Camera, Users, Play, LogOut, ChevronDown, ScanLine } from 'lucide-react';
import { Switch } from "@/components/ui/switch";
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, Timestamp, orderBy, limit, getDoc, addDoc, onSnapshot, updateDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { useDepots, useProductCodes, useAddressDefinitions, useBarcodeFormatsQuery, useUsers, useDepoStokByDepot, useInvalidateQueries } from '@/hooks/useFirebaseQueries';
import { cn, generateId, readExcelData, exportDataToExcel, playFeedback, sanitizeGS1 } from '@/lib/utils';
import { format as formatDate, differenceInDays, parse as parseDate, getMonth, getYear, isValid, subMonths } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';
import { TrackingMode, resolveDefaultTrackingMode } from '@/lib/tracking';
import useHidScanner from '@/hooks/useHidScanner';
import BarcodeFormatPicker from '@/components/BarcodeFormatPicker';
import { parseAnyBarcode, resolveProductFromParsed } from '@/lib/barcode';
import type { ParsedGeneric, BarcodeFormat } from '@/lib/barcode';
import ManualInlineAdder from '@/components/mal-kabul/ManualInlineAdder';
import { normalizeMiad } from '@/components/common/ExpiryDateInput';
import { useAuth } from '@/contexts/auth-context';
import IrsaliyeOcrModal from '@/components/mal-kabul/IrsaliyeOcrModal';

// IrsaliyeOcrModal'dan dönen sonuç tipi
interface IrsaliyeParseResult {
  stokKodu: string;
  lot?: string;
  miad?: string;
  quantity: number;
}

const DynamicCameraBarcodeScanner = dynamic(() => import('@/components/camera-barcode-scanner'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Kamera Yükleniyor...</p></div>,
});


type ScanRow = ScannedItem & {
  adet?: number;
  isGroup?: boolean;
  expectedAdet?: number;
  scannedSerials?: string[];
  key?: string; // Add a key for grouped items
  items?: ScannedItem[]; // For grouped rows
};

// URL-safe base64 decode
function fromB64Url(b64url: string): string {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const bin = typeof window !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

type QrItem = { k: string; a: string; l?: string; m?: string; s?: string; q: number };
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


const toFsTimestamp = (d?: any): Timestamp => {
  try {
    if (d instanceof Date && !isNaN(d.getTime())) return Timestamp.fromDate(d);
  } catch {}
  return Timestamp.now();
};
const safeStr = (v: any): string => (v === undefined || v === null ? '' : String(v));
const safeNullable = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);

const stripUndefined = (val: any): any => {
  if (Array.isArray(val)) return val.map(stripUndefined).filter(v => v !== undefined);
  if (val && typeof val === 'object') {
    const out: any = {};
    Object.keys(val).forEach(k => {
      const v = stripUndefined((val as any)[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  return val === undefined ? undefined : val;
};

type MalKabulLine = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  adet: number;
  serials: string[];
};

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
    if (depots.length > 0 && !selectedDepotId && depots[0].id) {
      setSelectedDepotId(depots[0].id);
    }
  }, [depots, selectedDepotId]);

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
        const mode = resolveDefaultTrackingMode(matchedProduct as any);

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
    const depotName = depots.find(d => d.id === selectedDepotId)?.name || 'Bilinmeyen Depo';
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
    const depotName = depots.find(d => d.id === selectedDepotId)?.name || 'Bilinmeyen Depo';
  
    const queue = new BatchQueue({
      chunkSize: 450,
      onProgress: (info) => setCommitInfo(info),
    });
  
    try {
      const serialsToVerify = itemsToProcess.map(i => i.seriNumarasi).filter(Boolean) as string[];
      const existingSerialsInDb = new Set<string>();

      if (serialsToVerify.length > 0) {
        for (let i = 0; i < serialsToVerify.length; i += 30) {
            const chunk = serialsToVerify.slice(i, i + 30);
            const q = query(collection(db, 'depoStok'), where('seriNumarasi', 'in', chunk));
            const snap = await getDocs(q);
            snap.forEach(doc => existingSerialsInDb.add(doc.data().seriNumarasi));
        }
      }

      for (const item of itemsToProcess) {
        // Mükerrer kontrolü: aynı stokKodu için aynı seri numarası kontrol edilir
        const depotProductSerials = item.stokKodu ? existingDepotSerials.get(item.stokKodu) : undefined;
        if(item.seriNumarasi && depotProductSerials?.has(item.seriNumarasi)) {
            // Already checked on scan, this is a double-check.
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
            const stokRef = doc(collection(db, 'depoStok'));
            await queue.set(stokRef, createDocData());
          }
        } else {
          for (const serial of (serialsToProcess.filter(Boolean) as string[])) {
            const stokRef = doc(collection(db, 'depoStok'));
            await queue.set(stokRef, createDocData(serial));
            
            await enqueueSerialHistory(queue, serial, 'intake', {
              stokKodu: item.stokKodu || '',
              stokAdi: item.stokAdi || '',
              depotId: selectedDepotId,
              depotName,
              rafAdresi: item.rafAdresi || '',
              irsaliyeNumarasi: item.irsaliyeNumarasi || '',
            });
          }
        }
        if (item.id) processedIds.add(item.id);
      }
  
      await queue.flush();

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
  
  const manualProducts = useMemo(() => {
    const opts: { code: string; name: string; tracking: TrackingMode }[] = [];
    productCodes.forEach(p => {
        if (!p.stokKodu) return;
        const tracking = productTracking[p.stokKodu] || resolveDefaultTrackingMode(p as any);
        if (tracking === 'lot_manual' || tracking === 'qty_manual') {
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

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
            <Label className="text-sm font-medium">Çalışma Deposu</Label>
            <Select value={selectedDepotId} onValueChange={(v: string) => setSelectedDepotId(v)}>
              <SelectTrigger className="w-full mt-1">
                <SelectValue placeholder="Çalışma Deposu seçin" />
              </SelectTrigger>
              <SelectContent>
                {depots.filter(d => !!d.id).map(dep => (
                  <SelectItem key={dep.id!} value={dep.id!}>{dep.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
        </div>
        <Button onClick={() => router.push('/mal-kabul/gecmis')} variant="outline" className="self-end">
            <History className="mr-2 h-4 w-4" /> Geçmiş
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card>
            <CardHeader>
                <CardTitle>Son Okutulan Ürün</CardTitle>
                 <CardDescription>Toplam Okutulan: {scannedItems.length}</CardDescription>
            </CardHeader>
            <CardContent>
                {lastScannedProduct ? (
                <div className="space-y-1 text-sm">
                    <p><strong>{lastScannedProduct.stokAdi || ''}</strong></p>
                    <p className="text-muted-foreground">Seri: <span className="font-mono">{lastScannedProduct.seriNumarasi || ''}</span></p>
                    <p className="text-muted-foreground">Lot: {lastScannedProduct.lotNumarasi || ''} | Miad: {lastScannedProduct.miad || ''}</p>
                </div>
                ) : (
                <p className="text-muted-foreground">Henüz ürün okutulmadı.</p>
                )}
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle>Okuma Adetleri</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-lg">
                <p className="font-medium">Bu Lottan: <span className="font-bold text-primary">{lotCount}</span></p>
                <p className="font-medium">Ürün Toplamı: <span className="font-bold text-primary">{totalCountForProduct}</span></p>
            </CardContent>
        </Card>

        <Card>
            <CardHeader><CardTitle>İşlemler</CardTitle></CardHeader>
            <CardContent className="space-y-2">
                <div className="flex gap-2">
                    <Button onClick={() => { setIsBatchScanning(false); setIsCameraScannerOpen(true); }} variant="outline" size="sm" className="flex-1"><Camera className="mr-2 h-4 w-4"/>Tekli Tara</Button>
                    <Button onClick={() => { setIsBatchScanning(true); setIsCameraScannerOpen(true); }} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white" size="sm"><Camera className="mr-2 h-4 w-4"/>Seri Tarama</Button>
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => setShowManualInline(v => !v)} variant="outline" size="sm" className="flex-1">
                        <PlusCircle className="mr-2 h-4 w-4"/> Manuel Ürün
                    </Button>
                    <Button onClick={() => setIsOcrModalOpen(true)} variant="outline" size="sm" className="flex-1">
                        <ScanLine className="mr-2 h-4 w-4" /> İrsaliye Tara (OCR)
                    </Button>
                </div>
            </CardContent>
        </Card>
      </div>

      {showManualInline && (
        <ManualInlineAdder
            visible={showManualInline}
            onClose={() => setShowManualInline(false)}
            manualProducts={manualProducts.filter(p => p.tracking === 'lot_manual' || p.tracking === 'qty_manual')}
            barcodeProducts={manualProducts.filter(p => p.tracking === 'lot_barcode' || p.tracking === 'qty_barcode')}
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
      )}

      <Card className="flex-1 flex flex-col">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-lg font-headline">Okutulan Ürünler ({scannedItems.length})</CardTitle>
               <CardDescription>Stoğa eklenecek ürünlerin listesi.</CardDescription>
            </div>
            <div className="flex items-center space-x-4">
              <Button onClick={handleOpenAddressModal} variant="outline" disabled={malKabulIsLoading || selectedItemsCount === 0}>Adres Ata ({selectedItemsCount})</Button>
              <Button onClick={handleOpenIrsaliyeModal} variant="outline" disabled={malKabulIsLoading || selectedItemsCount === 0}>İrsaliye No Ata ({selectedItemsCount})</Button>
              <Button onClick={() => {
                  const anySelected = scannedItems.some(i => !i.isProcessed && i.isSelected);
                  setScannedItems(prev => prev.map(item => (!item.isProcessed ? { ...item, isSelected: !anySelected } : item)));
              }} variant="outline" disabled={malKabulIsLoading || unprocessedScannedItems === 0}>
                  {scannedItems.some(i => !i.isProcessed && i.isSelected) ? 'Tüm Seçimi Kaldır' : `İşlenmemişleri Seç (${unprocessedScannedItems})`}
              </Button>
              <Button onClick={clearAllScannedItems} variant="destructive" disabled={malKabulIsLoading || scannedItems.length === 0}>
                  <Trash2 className="mr-2 h-4 w-4" /> Tüm Listeyi Temizle
              </Button>
              <Button onClick={handlePreCheckAndDogrulamasizMalKabul} className="bg-green-600 hover:bg-green-700 text-white" disabled={malKabulIsLoading || isLoading || unprocessedScannedItems === 0}>
                  {(malKabulIsLoading || isLoading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Kabul Et ve Stoğa Ekle
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[40vh]">
            {scannedItems.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground p-4">
                <Search className="mr-2 h-6 w-6" /> Okutulmuş ürün bulunmuyor.
              </div>
            ) : (
              <Accordion type="multiple" className="w-full">
                {groupedScannedItems.map((group, groupIndex) => {
                  const trackingMode = (group.stokKodu && productTracking[group.stokKodu]) || resolveDefaultTrackingMode({stokAdi: group.stokAdi} as any);
                  const hasSerials = trackingMode === 'serial';
                  return (
                    <AccordionItem value={`group-${groupIndex}`} key={group.key}>
                      <AccordionTrigger className="flex items-center p-2 cursor-pointer hover:bg-muted/50 w-full text-left">
                           <div className="px-2">
                             <Checkbox checked={group.isSelected} onCheckedChange={() => toggleGroupSelection(group.key)} onClick={e => e.stopPropagation()} />
                           </div>
                           <div className="flex-1">
                             {group.stokAdi}<span className="block text-xs text-muted-foreground">{group.stokKodu}</span>
                           </div>
                           <div className="flex-1">{group.lotNumarasi || '-'}</div>
                           <div className="flex-1">{group.miad || '-'}</div>
                           <div className="flex-1">{group.rafAdresi || '-'}</div>
                           <div className="flex-1">{group.irsaliyeNumarasi || '-'}</div>
                           <div className="font-bold text-lg text-right w-24">
                           {hasSerials ? (
                               <span>{group.adet} ADET</span>
                           ) : (
                               <Input
                                   type="number"
                                   value={group.adet}
                                   onChange={(e) => handleAdetChange(group.key, e.target.value)}
                                   onClick={(e) => e.stopPropagation()}
                                   className="h-8 w-20 text-center font-bold text-lg"
                                   min="1"
                               />
                           )}
                           </div>
                           <div className="w-20 text-right">
                               <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteGroup(group.key); }}>
                                   <Trash2 className="h-4 w-4 text-destructive" />
                               </Button>
                           </div>
                      </AccordionTrigger>
                        {hasSerials && (
                        <AccordionContent>
                            <div className="px-6 py-2 bg-muted/50 max-h-40 overflow-y-auto">
                                <ul className="list-disc pl-5 text-xs font-mono grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1">
                                    {group.items?.map(item => (
                                        <li key={item.id}>{item.seriNumarasi}</li>
                                    ))}
                                </ul>
                            </div>
                        </AccordionContent>
                        )}
                      </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
      
      <Dialog open={isCameraScannerOpen} onOpenChange={(open: boolean) => {
          if (!open && isBatchScanning) setIsBatchScanning(false);
          setIsCameraScannerOpen(open);
        }}>
        <DialogContent className="max-w-xl p-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Kamera ile Barkod Tara</DialogTitle>
             {isBatchScanning && <DialogDescription className="px-4">Seri tarama modu aktif. Tarayıcı her okumadan sonra açık kalacaktır. Bitirdiğinizde bu pencereyi kapatın.</DialogDescription>}
          </DialogHeader>
          <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Kamera Yükleniyor...</p></div>}>
              <DynamicCameraBarcodeScanner
                  onScanSuccess={handleCameraScanSuccess}
                  onClose={() => isBatchScanning ? setIsBatchScanning(false) : setIsCameraScannerOpen(false)}
              />
          </Suspense>
        </DialogContent>
      </Dialog>
      <Dialog open={isAddressModalOpen} onOpenChange={setIsAddressModalOpen}>
        <DialogContent>
            <DialogHeader><DialogTitle>Adres Ata</DialogTitle></DialogHeader>
            <div className="py-4 space-y-4">
                <Select value={selectedAddressBarcode} onValueChange={setSelectedAddressBarcode}>
                    <SelectTrigger><SelectValue placeholder="Tanımlı Adres Seçin..." /></SelectTrigger>
                    <SelectContent>
                        {addressDefinitions.map(ad => <SelectItem key={ad.id} value={ad.addressBarcode || ''}>{ad.addressName}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Input value={addressAssignmentInput} onChange={e => setAddressAssignmentInput(e.target.value)} placeholder="Veya manuel adres girin"/>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
                <Button onClick={handleAssignAddress}>Ata</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <Dialog open={isIrsaliyeModalOpen} onOpenChange={setIsIrsaliyeModalOpen}>
        <DialogContent>
            <DialogHeader><DialogTitle>İrsaliye No Ata</DialogTitle></DialogHeader>
            <div className="py-4">
                <Input value={irsaliyeNoInput} onChange={e => setIrsaliyeNoInput(e.target.value)} placeholder="İrsaliye Numarası"/>
            </div>
            <DialogFooter>
                <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
                <Button onClick={handleAssignIrsaliyeNo}>Ata</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
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
