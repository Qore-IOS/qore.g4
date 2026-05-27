// File: /app/(protected)/laboratuvar/sayim/[labId]/page.tsx
'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection, doc, getDocs, where, query, Timestamp, writeBatch, getDoc,
} from 'firebase/firestore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  Save,
  ScanBarcode,
  Search,
  TestTube,
  X,
  PackageX,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProductCode, DepoStokItem, ConsumptionRecord, MinMaxRule } from '@/lib/types';
import { saveLabCountSession } from '@/lib/labCount';
import { formatMiad } from '@/lib/date';
import { differenceInDays, parse, isValid } from 'date-fns';
import useHidScanner from '@/hooks/useHidScanner';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import { parseAndResolveBarcode } from '@/lib/barcode';

// ============================================================================
// TYPES
// ============================================================================

type FilterMode = 'marka' | 'urunGrubu';

interface ExistingLot {
  lot: string;
  miad: string;
  count: number;
  itemIds: string[]; // depoStok doc ids in this group
}

interface ProductCountEntry {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  urunGrubu: string;
  laboratuvarGrubu: string;
  existingTotal: number;
  existingLots: ExistingLot[];
  /** Manual override quantity (string to allow empty input) */
  enteredQty: string;
  /** True if user confirmed the existing/entered count */
  counted: boolean;
}

interface GroupProgress {
  key: string;
  total: number;
  completed: number;
  status: 'idle' | 'in_progress' | 'completed';
}

// ============================================================================
// HELPERS
// ============================================================================

type MiadSeverity = 'normal' | 'notice' | 'caution' | 'warning' | 'critical' | 'expired';

function getMiadInfo(miadStr: string): { days: number; severity: MiadSeverity } {
  if (!miadStr) return { days: Infinity, severity: 'normal' };
  const miadDate = parse(miadStr, 'dd.MM.yyyy', new Date());
  if (!isValid(miadDate)) return { days: Infinity, severity: 'normal' };
  const days = differenceInDays(miadDate, new Date());
  if (days < 0) return { days, severity: 'expired' };
  if (days <= 3) return { days, severity: 'critical' };
  if (days <= 10) return { days, severity: 'warning' };
  if (days < 45) return { days, severity: 'caution' };
  if (days < 60) return { days, severity: 'notice' };
  return { days, severity: 'normal' };
}

function miadBadgeClass(severity: MiadSeverity): string {
  if (severity === 'expired' || severity === 'critical') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (severity === 'warning') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
  if (severity === 'caution') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (severity === 'notice') return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
  return '';
}

function formatUrunGrubu(g?: string): string {
  if (!g) return '';
  if (g === 'kit') return 'Kit';
  if (g === 'sarf') return 'Sarf';
  if (g === 'yedek_parca') return 'Yedek Parça';
  return g;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface SidebarChecklistItemProps {
  label: string;
  group: GroupProgress;
  isActive: boolean;
  onClick: () => void;
}

function SidebarChecklistItem({ label, group, isActive, onClick }: SidebarChecklistItemProps) {
  const pct = group.total > 0 ? Math.round((group.completed / group.total) * 100) : 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-200',
        isActive
          ? 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-l-[3px] border-l-[var(--dashboard-accent)]'
          : 'hover:bg-[var(--dashboard-surface-2)]/50',
      )}
    >
      <span className="shrink-0">
        {group.status === 'completed' ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        ) : group.status === 'in_progress' ? (
          <div className="w-5 h-5 rounded-full border-2 border-amber-500 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
        ) : (
          <Circle className="w-5 h-5 text-[var(--dashboard-muted)]" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <span className={cn('text-sm font-medium block truncate', isActive ? 'text-[var(--dashboard-text)]' : 'text-[var(--dashboard-text)]/80')}>
          {label}
        </span>
        <span className="text-xs text-[var(--dashboard-muted)]">
          {group.completed} / {group.total} ürün
        </span>
      </div>
      <div className="shrink-0 w-10 h-10 relative">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="14" fill="none" stroke="var(--dashboard-stroke)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="14" fill="none"
            stroke={group.status === 'completed' ? '#10b981' : group.status === 'in_progress' ? '#f59e0b' : 'var(--dashboard-stroke)'}
            strokeWidth="3"
            strokeDasharray={`${pct * 0.88} 88`}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[var(--dashboard-muted)]">
          {pct}
        </span>
      </div>
    </button>
  );
}

interface ProductRowProps {
  product: ProductCode;
  entry: ProductCountEntry;
  isOutOfStock: boolean;
  onEnteredChange: (val: string) => void;
  onConfirmExisting: () => void;
  onToggleCounted: () => void;
}

function ProductRow({ product, entry, isOutOfStock, onEnteredChange, onConfirmExisting, onToggleCounted }: ProductRowProps) {
  const enteredNum = entry.enteredQty.trim() === '' ? null : parseInt(entry.enteredQty, 10);
  const effectiveCount = enteredNum != null && !isNaN(enteredNum) ? enteredNum : entry.existingTotal;
  const delta = effectiveCount - entry.existingTotal;

  return (
    <div
      className={cn(
        'w-full px-4 sm:px-5 py-3 border-b border-[var(--dashboard-stroke)] last:border-b-0 transition-all',
        entry.counted && 'bg-emerald-500/5',
        isOutOfStock && !entry.counted && 'bg-slate-500/5',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Product info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate">
            {product.stokAdi}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-[var(--dashboard-muted)]">{product.stokKodu}</span>
            {product.urunGrubu && (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] px-1.5 py-0.5 rounded">
                {formatUrunGrubu(product.urunGrubu)}
              </span>
            )}
            {product.marka && (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] px-1.5 py-0.5 rounded">
                {product.marka}
              </span>
            )}
            {isOutOfStock && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                <PackageX className="w-2.5 h-2.5" />
                Stokta Yok
              </span>
            )}
          </div>
        </div>

        {/* Counted tick */}
        <button
          onClick={onToggleCounted}
          title={entry.counted ? 'Onayı kaldır' : 'Sayımı onayla'}
          className={cn(
            'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200',
            entry.counted
              ? 'bg-emerald-500 text-white shadow-md'
              : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-accent)]',
          )}
        >
          <Check className="w-4 h-4" />
        </button>
      </div>

      {/* Existing lots */}
      {!isOutOfStock && entry.existingLots.length > 0 && (
        <div className="mt-2 space-y-1">
          {entry.existingLots.map((lot, i) => {
            const info = getMiadInfo(lot.miad);
            return (
              <div
                key={`${lot.lot}-${lot.miad}-${i}`}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--dashboard-surface)] border border-[var(--dashboard-stroke)] text-xs"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-mono text-[var(--dashboard-text)] truncate">
                    {lot.lot ? `Lot: ${lot.lot}` : 'Lot: —'}
                  </span>
                  {lot.miad && (
                    <span className="text-[var(--dashboard-muted)]">{lot.miad}</span>
                  )}
                  {lot.miad && info.severity !== 'normal' && info.days !== Infinity && (
                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold', miadBadgeClass(info.severity))}>
                      {info.days < 0 ? 'geçmiş' : `${info.days}g`}
                    </span>
                  )}
                </div>
                <span className="font-bold text-[var(--dashboard-text)] shrink-0">
                  {lot.count}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Inputs row */}
      <div className="mt-2 flex items-center gap-2">
        {/* Existing total + confirm button */}
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'text-[11px] font-semibold px-2 py-1 rounded-md',
              isOutOfStock
                ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
            )}
            title="Mevcut lab stoğu"
          >
            Stok: {entry.existingTotal}
          </span>
          {!isOutOfStock && (
            <button
              type="button"
              onClick={onConfirmExisting}
              className="h-7 px-2 rounded-md text-[10px] font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-200 transition-colors flex items-center gap-1"
              title="Stoktaki adedi sayım olarak onayla"
            >
              <Check className="w-3 h-3" />
              Stoğu Onayla
            </button>
          )}
        </div>

        {/* Manual entry input */}
        <div className="flex-1 flex items-center gap-1.5">
          <label className="text-[10px] font-medium text-[var(--dashboard-muted)] uppercase tracking-wider shrink-0">
            Sayım
          </label>
          <Input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder={String(entry.existingTotal)}
            value={entry.enteredQty}
            onChange={(e) => onEnteredChange(e.target.value)}
            className="h-8 text-sm w-24"
          />
          {enteredNum != null && !isNaN(enteredNum) && delta !== 0 && (
            <span
              className={cn(
                'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                delta > 0
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
              )}
            >
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function LaboratuvarSayimPage() {
  const params = useParams();
  const labId = Array.isArray(params?.labId) ? params.labId[0] : (params?.labId as string);
  const router = useRouter();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [labName, setLabName] = useState<string>('');
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [rawStock, setRawStock] = useState<DepoStokItem[]>([]);
  const [minMaxRules, setMinMaxRules] = useState<MinMaxRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [filterMode, setFilterMode] = useState<FilterMode>('marka');
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyUncounted, setShowOnlyUncounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Barcode scanning
  const [scannerActive, setScannerActive] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const scanFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { formats: barcodeFormats } = useSafeBarcodeFormats();

  // Per-product count state
  const [countData, setCountData] = useState<Record<string, { enteredQty: string; counted: boolean }>>({});

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!labId) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const labRef = doc(db, 'hospitals', labId as string);
        const [labSnap, productsSnap, rulesSnap] = await Promise.all([
          getDoc(labRef),
          getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
          getDocs(collection(db, 'hospitals', labId as string, 'minMaxRules')),
        ]);

        if (!labSnap.exists()) {
          if (!cancelled) toast({ title: 'Hata', description: 'Laboratuvar bulunamadı.', variant: 'destructive' });
          return;
        }

        const { name } = labSnap.data() as any;
        if (!cancelled) {
          setLabName(name);
          setProductCodes(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
          setMinMaxRules(rulesSnap.docs.map(d => d.data() as MinMaxRule));
        }

        // Load lab stock — match by hedefKurumId, plus legacy by name
        const [byIdSnap, legacySnap] = await Promise.all([
          getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('isShipped', '==', true), where('hedefKurumId', '==', labId))),
          getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('isShipped', '==', true), where('hedefKurum', '==', name))),
        ]);

        const byId = byIdSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
        const legacy = legacySnap.docs
          .map(d => ({ id: d.id, ...d.data() } as DepoStokItem))
          .filter(item => !item.hedefKurumId);
        const all = filterByCompanyScope([...byId, ...legacy], currentCompanyId, isSuperAdmin);

        if (!cancelled) setRawStock(all);
      } catch (err) {
        console.error('Error loading lab counting data:', err);
        if (!cancelled) toast({ title: 'Veri Hatası', description: 'Sayım verileri yüklenemedi.', variant: 'destructive' });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [labId, currentCompanyId, isSuperAdmin, toast]);

  // ------------------------------------------------------------------
  // Derived data
  // ------------------------------------------------------------------

  // All stokKodu values that are part of the count scope (have min/max rules OR have stock)
  const scopeStokKodus = useMemo(() => {
    const set = new Set<string>();
    minMaxRules.forEach(r => set.add(r.stokKodu));
    rawStock.forEach(s => set.add(s.stokKodu));
    return set;
  }, [minMaxRules, rawStock]);

  // Product list within the scope (only known products)
  const scopeProducts = useMemo(() => {
    return productCodes.filter(p => scopeStokKodus.has(p.stokKodu));
  }, [productCodes, scopeStokKodus]);

  // Build per-product entries (existing lots + total)
  const productEntries = useMemo<Record<string, ProductCountEntry>>(() => {
    const map: Record<string, ProductCountEntry> = {};

    // Initialize entries for all in-scope products
    scopeProducts.forEach(p => {
      map[p.stokKodu] = {
        stokKodu: p.stokKodu,
        stokAdi: p.stokAdi,
        marka: p.marka || '',
        urunGrubu: formatUrunGrubu(p.urunGrubu),
        laboratuvarGrubu: p.laboratuvarGrubu || '',
        existingTotal: 0,
        existingLots: [],
        enteredQty: countData[p.stokKodu]?.enteredQty ?? '',
        counted: countData[p.stokKodu]?.counted ?? false,
      };
    });

    // Group raw stock by stokKodu / lot / miad
    const lotMap = new Map<string, ExistingLot>();
    rawStock.forEach(item => {
      if (!map[item.stokKodu]) {
        // Stock for an unknown product (no productCode + no min/max rule).
        // Add a synthetic entry so it still shows up.
        map[item.stokKodu] = {
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi || item.stokKodu,
          marka: (item as any).marka || '',
          urunGrubu: '',
          laboratuvarGrubu: '',
          existingTotal: 0,
          existingLots: [],
          enteredQty: countData[item.stokKodu]?.enteredQty ?? '',
          counted: countData[item.stokKodu]?.counted ?? false,
        };
      }
      const lotKey = `${item.stokKodu}|${item.lotNumarasi || ''}|${formatMiad(item.miad as any) || ''}`;
      let lot = lotMap.get(lotKey);
      if (!lot) {
        lot = {
          lot: item.lotNumarasi || '',
          miad: formatMiad(item.miad as any) || '',
          count: 0,
          itemIds: [],
        };
        lotMap.set(lotKey, lot);
        map[item.stokKodu].existingLots.push(lot);
      }
      lot.count++;
      if (item.id) lot.itemIds.push(item.id);
      map[item.stokKodu].existingTotal++;
    });

    // Sort lots within each product (closest miad first)
    Object.values(map).forEach(entry => {
      entry.existingLots.sort((a, b) => {
        const ai = getMiadInfo(a.miad).days;
        const bi = getMiadInfo(b.miad).days;
        return ai - bi;
      });
    });

    return map;
  }, [scopeProducts, rawStock, countData]);

  // Available filter values (markas or product groups)
  const filterValues = useMemo<string[]>(() => {
    const set = new Set<string>();
    scopeProducts.forEach(p => {
      if (filterMode === 'marka') {
        if (p.marka) set.add(p.marka);
      } else {
        if (p.urunGrubu) set.add(p.urunGrubu);
      }
    });
    const list = Array.from(set);
    list.sort((a, b) => a.localeCompare(b, 'tr'));
    return list;
  }, [scopeProducts, filterMode]);

  // Build a label for a filter key (turn 'kit' -> 'Kit' etc.)
  const filterLabel = useCallback(
    (key: string) => (filterMode === 'urunGrubu' ? formatUrunGrubu(key) : key),
    [filterMode],
  );

  // Group progress per filter value
  const groupProgress = useMemo<GroupProgress[]>(() => {
    return filterValues.map(key => {
      const products = scopeProducts.filter(p =>
        filterMode === 'marka' ? p.marka === key : p.urunGrubu === key,
      );
      const completed = products.filter(p => productEntries[p.stokKodu]?.counted).length;
      let status: GroupProgress['status'] = 'idle';
      if (completed > 0 && completed < products.length) status = 'in_progress';
      if (completed === products.length && products.length > 0) status = 'completed';
      return { key, total: products.length, completed, status };
    });
  }, [filterValues, scopeProducts, productEntries, filterMode]);

  // Auto-select first group on load / filter change
  useEffect(() => {
    if (!activeGroup && filterValues.length > 0) {
      setActiveGroup(filterValues[0]);
    } else if (activeGroup && !filterValues.includes(activeGroup)) {
      setActiveGroup(filterValues[0] ?? null);
    }
  }, [filterValues, activeGroup]);

  // Reset active group when filter mode changes
  useEffect(() => {
    setActiveGroup(filterValues[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode]);

  // Products in the active group, with stockless ones at the bottom
  const activeProducts = useMemo<ProductCode[]>(() => {
    if (!activeGroup) return [];
    const list = scopeProducts.filter(p =>
      filterMode === 'marka' ? p.marka === activeGroup : p.urunGrubu === activeGroup,
    );

    let filtered = list;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = list.filter(p =>
        p.stokAdi.toLowerCase().includes(q) ||
        p.stokKodu.toLowerCase().includes(q),
      );
    }
    if (showOnlyUncounted) {
      filtered = filtered.filter(p => !productEntries[p.stokKodu]?.counted);
    }

    return filtered.sort((a, b) => {
      const aOos = (productEntries[a.stokKodu]?.existingTotal ?? 0) === 0;
      const bOos = (productEntries[b.stokKodu]?.existingTotal ?? 0) === 0;
      if (aOos !== bOos) return aOos ? 1 : -1; // out-of-stock at the bottom
      const aDone = productEntries[a.stokKodu]?.counted ? 1 : 0;
      const bDone = productEntries[b.stokKodu]?.counted ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone; // uncounted first
      return a.stokAdi.localeCompare(b.stokAdi, 'tr');
    });
  }, [activeGroup, scopeProducts, filterMode, searchQuery, showOnlyUncounted, productEntries]);

  // Overall progress
  const { totalProducts, totalCounted, overallPct } = useMemo(() => {
    const total = scopeProducts.length;
    const done = scopeProducts.filter(p => productEntries[p.stokKodu]?.counted).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { totalProducts: total, totalCounted: done, overallPct: pct };
  }, [scopeProducts, productEntries]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  const setEntry = useCallback((stokKodu: string, patch: Partial<{ enteredQty: string; counted: boolean }>) => {
    setCountData(prev => {
      const cur = prev[stokKodu] ?? { enteredQty: '', counted: false };
      return { ...prev, [stokKodu]: { ...cur, ...patch } };
    });
  }, []);

  const handleEnteredChange = useCallback((stokKodu: string, val: string) => {
    setEntry(stokKodu, { enteredQty: val, counted: true });
  }, [setEntry]);

  const handleConfirmExisting = useCallback((stokKodu: string) => {
    const existing = productEntries[stokKodu]?.existingTotal ?? 0;
    setEntry(stokKodu, { enteredQty: String(existing), counted: true });
  }, [productEntries, setEntry]);

  const handleToggleCounted = useCallback((stokKodu: string) => {
    setCountData(prev => {
      const cur = prev[stokKodu] ?? { enteredQty: '', counted: false };
      const nextCounted = !cur.counted;
      // If user is confirming an out-of-stock product, default the entered qty to 0
      const existing = productEntries[stokKodu]?.existingTotal ?? 0;
      const nextEntered =
        nextCounted && cur.enteredQty.trim() === ''
          ? String(existing)
          : cur.enteredQty;
      return { ...prev, [stokKodu]: { enteredQty: nextEntered, counted: nextCounted } };
    });
  }, [productEntries]);

  const handleCompleteGroup = useCallback(() => {
    if (!activeGroup) return;
    setCountData(prev => {
      const next = { ...prev };
      activeProducts.forEach(p => {
        const existing = productEntries[p.stokKodu]?.existingTotal ?? 0;
        const cur = next[p.stokKodu] ?? { enteredQty: '', counted: false };
        next[p.stokKodu] = {
          enteredQty: cur.enteredQty.trim() === '' ? String(existing) : cur.enteredQty,
          counted: true,
        };
      });
      return next;
    });
  }, [activeGroup, activeProducts, productEntries]);

  const handleNextGroup = useCallback(() => {
    const next = groupProgress.find(g => g.status !== 'completed' && g.key !== activeGroup);
    if (next) setActiveGroup(next.key);
  }, [groupProgress, activeGroup]);

  // ------------------------------------------------------------------
  // Barcode scanning
  // ------------------------------------------------------------------
  const flashFeedback = useCallback((type: 'success' | 'error', message: string) => {
    if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
    setScanFeedback({ type, message });
    scanFeedbackTimer.current = setTimeout(() => setScanFeedback(null), 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (scanFeedbackTimer.current) clearTimeout(scanFeedbackTimer.current);
    };
  }, []);

  const handleScan = useCallback(({ raw }: { raw: string }) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    const result = parseAndResolveBarcode(trimmed, barcodeFormats, productCodes);
    let found = result?.product;
    if (!found) {
      found = productCodes.find(p => p.barcodeNumber === trimmed || p.stokKodu === trimmed);
    }

    if (!found) {
      flashFeedback('error', 'Ürün bulunamadı');
      return;
    }

    // Check the product is in the count scope (has min/max defined OR has stock).
    if (!scopeStokKodus.has(found.stokKodu)) {
      flashFeedback('error', `${found.stokAdi} bu laboratuvarda tanımlı değil`);
      return;
    }

    // Switch active group if the scanned product belongs to a different one.
    const targetGroup = filterMode === 'marka' ? (found.marka ?? '') : (found.urunGrubu ?? '');
    if (targetGroup && targetGroup !== activeGroup) {
      setActiveGroup(targetGroup);
    }

    // Increment the entered quantity by 1 and mark as counted.
    setCountData(prev => {
      const cur = prev[found!.stokKodu] ?? { enteredQty: '', counted: false };
      const baseStr = cur.enteredQty.trim();
      const baseNum = baseStr === '' ? 0 : (parseInt(baseStr, 10) || 0);
      return {
        ...prev,
        [found!.stokKodu]: {
          enteredQty: String(baseNum + 1),
          counted: true,
        },
      };
    });

    flashFeedback('success', `${found.stokAdi} +1`);
  }, [barcodeFormats, productCodes, scopeStokKodus, filterMode, activeGroup, flashFeedback]);

  useHidScanner({
    enabled: scannerActive,
    allowDuringInputs: false,
    onScan: handleScan,
  });

  // ------------------------------------------------------------------
  // Save: update lab stock based on counts + persist count session
  // ------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!labId || !currentUserProfile || isSaving) return;

    const allCountedEntries = Object.values(productEntries).filter(e => e.counted);
    if (allCountedEntries.length === 0) {
      toast({ title: 'Sayım yok', description: 'Kaydedilecek onaylı ürün bulunamadı.' });
      return;
    }

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      let itemsRemoved = 0;
      let itemsAdded = 0;

      for (const entry of allCountedEntries) {
        const enteredNum = entry.enteredQty.trim() === '' ? null : parseInt(entry.enteredQty, 10);
        const counted = enteredNum != null && !isNaN(enteredNum) ? enteredNum : entry.existingTotal;
        const diff = counted - entry.existingTotal;

        if (diff === 0) continue;

        if (diff < 0) {
          // Stock decreased: remove |diff| items, write consumption records
          const toRemove = Math.abs(diff);
          // Flatten lots into individual stock items, prefer earliest expiry first
          const flat: { id: string; lot: string; miad: string }[] = [];
          entry.existingLots.forEach(lot => {
            lot.itemIds.forEach(id => flat.push({ id, lot: lot.lot, miad: lot.miad }));
          });
          flat.sort((a, b) => getMiadInfo(a.miad).days - getMiadInfo(b.miad).days);

          const slice = flat.slice(0, toRemove);
          for (const it of slice) {
            const stockRef = doc(db, 'depoStok', it.id);
            batch.delete(stockRef);
            itemsRemoved++;

            const consRef = doc(collection(db, 'tuketimKayitlari'));
            const consumption: Omit<ConsumptionRecord, 'id'> = {
              stokKodu: entry.stokKodu,
              stokAdi: entry.stokAdi,
              lotNumarasi: it.lot || '',
              miad: it.miad || '',
              seriNumarasi: '',
              laboratoryId: labId,
              laboratoryName: labName,
              consumptionTimestamp: new Date(),
              consumptionType: 'sayimdan_dusum',
              userId: currentUserProfile.uid,
              userName: currentUserProfile.name || currentUserProfile.email || 'System',
            };
            batch.set(consRef, consumption);
          }
        } else {
          // Stock increased: add |diff| items
          const template = entry.existingLots[0] ?? { lot: '', miad: '' };
          for (let i = 0; i < diff; i++) {
            const newRef = doc(collection(db, 'depoStok'));
            batch.set(newRef, withCompanyScope({
              stokKodu: entry.stokKodu,
              stokAdi: entry.stokAdi,
              lotNumarasi: template.lot || '',
              miad: template.miad || '',
              seriNumarasi: '',
              isShipped: true,
              hedefKurumId: labId,
              hedefKurum: labName,
              eklenmeTarihi: Timestamp.now(),
              ekleyenKullanici: currentUserProfile.name || currentUserProfile.email || 'System',
              eklemeSebebi: 'sayim_fazlasi',
            }, currentCompanyId));
            itemsAdded++;
          }
        }
      }

      // Persist a count history record
      await saveLabCountSession({
        laboratoryId: labId,
        laboratoryName: labName,
        user: { id: currentUserProfile.uid || '', name: currentUserProfile.name || currentUserProfile.email || 'Bilinmeyen' },
        items: allCountedEntries.map(entry => {
          const enteredNum = entry.enteredQty.trim() === '' ? null : parseInt(entry.enteredQty, 10);
          const counted = enteredNum != null && !isNaN(enteredNum) ? enteredNum : entry.existingTotal;
          return {
            stokKodu: entry.stokKodu,
            stokAdi: entry.stokAdi,
            lotNumarasi: entry.existingLots[0]?.lot ?? '',
            miad: entry.existingLots[0]?.miad ?? '',
            marka: entry.marka || null,
            expected: entry.existingTotal,
            counted,
            verifiedSerials: [],
            unscannedSerials: [],
          };
        }),
      });

      await batch.commit();

      const messages: string[] = [];
      if (itemsRemoved > 0) messages.push(`${itemsRemoved} ürün düşüldü`);
      if (itemsAdded > 0) messages.push(`${itemsAdded} ürün eklendi`);
      const result = messages.length > 0 ? messages.join(', ') : 'Stok değişikliği yok';

      toast({ title: 'Sayım Kaydedildi', description: `${labName} — ${result}.` });
      router.push(`/laboratuvar/sayim/${labId}/history`);
    } catch (err) {
      console.error('Save lab count error:', err);
      toast({ title: 'Hata', description: 'Sayım kaydedilirken hata oluştu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [labId, labName, currentUserProfile, currentCompanyId, productEntries, isSaving, router, toast]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    );
  }

  const activeGroupProgress = groupProgress.find(g => g.key === activeGroup);
  const activePct =
    activeGroupProgress && activeGroupProgress.total > 0
      ? Math.round((activeGroupProgress.completed / activeGroupProgress.total) * 100)
      : 0;

  return (
    <div className="cihaz-shell min-h-screen flex flex-col">
      {/* TOP STATUS BAR */}
      <div className="sticky top-0 z-[var(--z-sticky)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md border-b border-[var(--dashboard-stroke)]">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
          <button
            onClick={() => router.push('/laboratuvar-yonetimi')}
            className="shrink-0 flex items-center gap-2 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Geri</span>
          </button>

          <div className="flex items-center gap-2">
            <TestTube className="w-4 h-4 text-[var(--dashboard-accent)]" />
            <span className="text-sm font-semibold text-[var(--dashboard-text)]">{labName}</span>

            <button
              onClick={() => setScannerActive(prev => !prev)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-200',
                scannerActive
                  ? 'bg-emerald-500 text-white shadow-md animate-pulse'
                  : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]',
              )}
            >
              <ScanBarcode className="w-4 h-4" />
              {scannerActive ? 'Okuyucu Aktif' : 'Barkod'}
            </button>

            {scanFeedback && (
              <span
                className={cn(
                  'text-xs font-medium px-2 py-1 rounded-lg animate-in fade-in slide-in-from-left-2',
                  scanFeedback.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-red-500/10 text-red-600',
                )}
              >
                {scanFeedback.message}
              </span>
            )}
          </div>

          {/* Filter mode toggle */}
          <div className="flex items-center gap-1 ml-2 cihaz-pressed rounded-xl p-1">
            <button
              onClick={() => setFilterMode('marka')}
              className={cn(
                'px-3 py-1 rounded-lg text-xs font-semibold transition-colors',
                filterMode === 'marka'
                  ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                  : 'text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]',
              )}
            >
              Marka
            </button>
            <button
              onClick={() => setFilterMode('urunGrubu')}
              className={cn(
                'px-3 py-1 rounded-lg text-xs font-semibold transition-colors',
                filterMode === 'urunGrubu'
                  ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                  : 'text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]',
              )}
            >
              Ürün Grubu
            </button>
          </div>

          {/* Progress summary */}
          <div className="flex items-center gap-4 ml-auto text-xs text-[var(--dashboard-muted)]">
            <span>{totalCounted} / {totalProducts} ürün</span>
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-24 h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--dashboard-accent)] transition-all duration-500"
                  style={{ width: `${overallPct}%` }}
                />
              </div>
              <span className="font-semibold text-[var(--dashboard-text)]">%{overallPct}</span>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR */}
        <aside
          className={cn(
            'shrink-0 border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)] transition-all duration-300 flex flex-col',
            sidebarOpen ? 'w-[280px] sm:w-[320px]' : 'w-0 overflow-hidden',
          )}
        >
          <div className="px-4 py-3 border-b border-[var(--dashboard-stroke)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
                {filterMode === 'marka' ? 'Markalar' : 'Ürün Grupları'}
              </span>
              <span className="text-xs text-[var(--dashboard-muted)]">
                {groupProgress.filter(g => g.status === 'completed').length} / {groupProgress.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="cihaz-pressed px-2 py-1.5 text-center rounded-lg">
                <div className="text-sm font-bold text-[var(--dashboard-text)]">{groupProgress.length}</div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Toplam</div>
              </div>
              <div className="cihaz-pressed px-2 py-1.5 text-center rounded-lg">
                <div className="text-sm font-bold text-emerald-500">
                  {groupProgress.filter(g => g.status === 'completed').length}
                </div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Tamam</div>
              </div>
              <div className="cihaz-pressed px-2 py-1.5 text-center rounded-lg">
                <div className="text-sm font-bold text-amber-500">
                  {groupProgress.length - groupProgress.filter(g => g.status === 'completed').length}
                </div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Bekleyen</div>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {groupProgress.length === 0 ? (
                <div className="text-center py-6 text-xs text-[var(--dashboard-muted)]">
                  Bu laboratuvarda tanımlı ürün yok.
                </div>
              ) : (
                groupProgress.map(g => (
                  <SidebarChecklistItem
                    key={g.key}
                    label={filterLabel(g.key)}
                    group={g}
                    isActive={g.key === activeGroup}
                    onClick={() => setActiveGroup(g.key)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </aside>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="sm:hidden shrink-0 w-6 flex items-center justify-center border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)] text-[var(--dashboard-muted)]"
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* RIGHT PANEL */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {activeGroup ? (
            <>
              {/* Group header */}
              <div className="px-4 sm:px-6 py-4 border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-lg font-bold text-[var(--dashboard-text)]">{filterLabel(activeGroup)}</h2>
                    <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
                      {activeGroupProgress?.total ?? 0} ürün
                      {' · '}
                      <span className="text-emerald-500">{activeGroupProgress?.completed ?? 0} tamamlandı</span>
                      {' · '}
                      <span className="text-amber-500">
                        {(activeGroupProgress?.total ?? 0) - (activeGroupProgress?.completed ?? 0)} bekliyor
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          activePct === 100 ? 'bg-emerald-500' : 'bg-[var(--dashboard-accent)]',
                        )}
                        style={{ width: `${activePct}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-[var(--dashboard-text)]">%{activePct}</span>
                  </div>
                </div>

                {/* Search + filters */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <div className="relative flex-1 min-w-[120px] max-w-[280px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
                    <Input
                      type="text"
                      placeholder="Ürün ara..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 text-sm"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant={showOnlyUncounted ? 'default' : 'outline'}
                    onClick={() => setShowOnlyUncounted(v => !v)}
                    className="h-9 text-xs"
                  >
                    Sadece Sayılmayanlar
                  </Button>

                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCompleteGroup}
                      className="h-9 text-xs"
                    >
                      <Check className="w-3.5 h-3.5 mr-1" />
                      Grubu Tamamla
                    </Button>
                  </div>
                </div>
              </div>

              {/* Product list */}
              <ScrollArea className="flex-1">
                <div className="cihaz-card-strong m-4 sm:m-6 overflow-hidden">
                  {activeProducts.length > 0 ? (
                    activeProducts.map(product => {
                      const entry = productEntries[product.stokKodu];
                      if (!entry) return null;
                      const isOutOfStock = entry.existingTotal === 0;
                      return (
                        <ProductRow
                          key={product.stokKodu}
                          product={product}
                          entry={entry}
                          isOutOfStock={isOutOfStock}
                          onEnteredChange={(val) => handleEnteredChange(product.stokKodu, val)}
                          onConfirmExisting={() => handleConfirmExisting(product.stokKodu)}
                          onToggleCounted={() => handleToggleCounted(product.stokKodu)}
                        />
                      );
                    })
                  ) : (
                    <div className="text-center py-12 text-sm text-[var(--dashboard-muted)]">
                      {searchQuery ? 'Aramayla eşleşen ürün bulunamadı.' : 'Bu grupta ürün bulunamadı.'}
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Bottom action bar */}
              <div className="sticky bottom-0 z-[var(--z-sticky)] border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md px-4 sm:px-6 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-[var(--dashboard-muted)]">
                    <span className="font-medium text-[var(--dashboard-text)]">
                      {activeGroupProgress?.completed ?? 0}
                    </span>{' '}
                    / {activeGroupProgress?.total ?? 0} ürün sayıldı
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={isSaving || totalCounted === 0}
                      className="h-9 text-xs"
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                      Sayımı Kaydet
                    </Button>

                    {activePct === 100 && groupProgress.some(g => g.status !== 'completed') && (
                      <Button size="sm" variant="outline" onClick={handleNextGroup} className="h-9 text-xs">
                        Sonraki
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[var(--dashboard-muted)]">
              {filterMode === 'marka' ? 'Sol panelden bir marka seçin' : 'Sol panelden bir ürün grubu seçin'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
