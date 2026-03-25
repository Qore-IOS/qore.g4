
'use client';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital, Depot, ProductCode, MinMaxRule } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Search,
  ScanBarcode,
  Building2,
  TestTube,
  Package,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  ArrowRight,
  Save,
  X,
  ClipboardCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface ProductCountEntry {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  stokAdedi: string;   // string to allow empty
  cihazUstuAdedi: string; // string to allow empty
  counted: boolean;
}

interface BrandProgress {
  brand: string;
  total: number;
  completed: number;
  status: 'idle' | 'in_progress' | 'completed';
}

type LocationType = 'lab' | 'depot';

interface MaliyetSayimPanelProps {
  hospitals: Hospital[];
  depots: Depot[];
  productCodes: ProductCode[];
}

// ============================================================================
// HELPERS
// ============================================================================

function getBrandsFromRules(
  minMaxRules: MinMaxRule[],
  productCodes: ProductCode[]
): string[] {
  if (minMaxRules.length === 0) return [];
  const stokKoduSet = new Set(minMaxRules.map(r => r.stokKodu));
  const brands = new Set<string>();
  productCodes.forEach(p => {
    if (stokKoduSet.has(p.stokKodu) && p.marka) {
      brands.add(p.marka);
    }
  });
  return Array.from(brands).sort((a, b) => a.localeCompare(b, 'tr'));
}

function getProductsForBrandFromRules(
  brand: string,
  minMaxRules: MinMaxRule[],
  productCodes: ProductCode[]
): ProductCode[] {
  if (minMaxRules.length === 0) return [];
  const stokKoduSet = new Set(minMaxRules.map(r => r.stokKodu));
  return productCodes
    .filter(p => p.marka === brand && stokKoduSet.has(p.stokKodu))
    .sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr'));
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Brand item in the left sidebar checklist */
function BrandChecklistItem({
  brand,
  isActive,
  onClick,
}: {
  brand: BrandProgress;
  isActive: boolean;
  onClick: () => void;
}) {
  const pct = brand.total > 0 ? Math.round((brand.completed / brand.total) * 100) : 0;

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
      {/* Status icon */}
      <span className="shrink-0">
        {brand.status === 'completed' ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        ) : brand.status === 'in_progress' ? (
          <div className="w-5 h-5 rounded-full border-2 border-amber-500 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
        ) : (
          <Circle className="w-5 h-5 text-[var(--dashboard-muted)]" />
        )}
      </span>

      {/* Brand info */}
      <div className="flex-1 min-w-0">
        <span className={cn(
          'text-sm font-medium block truncate',
          isActive ? 'text-[var(--dashboard-text)]' : 'text-[var(--dashboard-text)]/80'
        )}>
          {brand.brand}
        </span>
        <span className="text-xs text-[var(--dashboard-muted)]">
          {brand.completed} / {brand.total} ürün
        </span>
      </div>

      {/* Mini progress */}
      <div className="shrink-0 w-10 h-10 relative">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="14" fill="none" stroke="var(--dashboard-stroke)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="14" fill="none"
            stroke={brand.status === 'completed' ? '#10b981' : brand.status === 'in_progress' ? '#f59e0b' : 'var(--dashboard-stroke)'}
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

/** Product count card in the right panel */
function ProductCountCard({
  product,
  entry,
  onStokChange,
  onCihazChange,
  onMarkCounted,
  barcodeInputRef,
}: {
  product: ProductCode;
  entry: ProductCountEntry;
  onStokChange: (val: string) => void;
  onCihazChange: (val: string) => void;
  onMarkCounted: () => void;
  barcodeInputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div
      className={cn(
        'cihaz-card p-4 sm:p-5 transition-all duration-200',
        entry.counted && 'ring-1 ring-emerald-500/30 bg-emerald-500/5'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Product info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-[var(--dashboard-text)] leading-snug truncate">
            {product.stokAdi}
          </h4>
          <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
            {product.stokKodu}
            {product.urunGrubu && (
              <span className="ml-2 inline-flex items-center">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {product.urunGrubu === 'kit' ? 'Kit' : product.urunGrubu === 'sarf' ? 'Sarf' : 'Yedek Parça'}
                </Badge>
              </span>
            )}
          </p>
        </div>

        {/* Counted status */}
        <button
          onClick={onMarkCounted}
          className={cn(
            'shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200',
            entry.counted
              ? 'bg-emerald-500 text-white shadow-md'
              : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-accent)]'
          )}
        >
          <Check className="w-4 h-4" />
        </button>
      </div>

      {/* Count inputs */}
      <div className="flex gap-3 mt-3">
        <div className="flex-1">
          <label className="text-[11px] font-medium text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">
            Stok Adedi
          </label>
          <Input
            type="number"
            min="0"
            placeholder=""
            value={entry.stokAdedi}
            onChange={(e) => onStokChange(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="text-[11px] font-medium text-[var(--dashboard-muted)] uppercase tracking-wider mb-1 block">
            Cihaz Üstü Test
          </label>
          <Input
            type="number"
            min="0"
            placeholder=""
            value={entry.cihazUstuAdedi}
            onChange={(e) => onCihazChange(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PANEL
// ============================================================================

export default function MaliyetSayimPanel({ hospitals, depots, productCodes }: MaliyetSayimPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Location selection - initialize from URL params
  const [locationType, setLocationType] = useState<LocationType | null>(() => {
    const t = searchParams.get('type');
    return t === 'lab' || t === 'depot' ? t : null;
  });
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(() => searchParams.get('id'));

  // MinMaxRules fetched from Firestore sub-collection
  const [locationMinMaxRules, setLocationMinMaxRules] = useState<MinMaxRule[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);

  // Brand & product state
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [countData, setCountData] = useState<Record<string, ProductCountEntry>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showOnlyUncounted, setShowOnlyUncounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Completion modal
  const [showFinishModal, setShowFinishModal] = useState(false);

  const barcodeRef = useRef<HTMLInputElement>(null);

  // Fetch minMaxRules from Firestore when location changes
  useEffect(() => {
    if (!selectedLocationId || !locationType) {
      setLocationMinMaxRules([]);
      return;
    }

    const collectionPath = locationType === 'lab'
      ? `hospitals/${selectedLocationId}/minMaxRules`
      : `depots/${selectedLocationId}/minMaxRules`;

    setIsLoadingRules(true);
    getDocs(collection(db, collectionPath))
      .then(snap => {
        setLocationMinMaxRules(snap.docs.map(d => d.data() as MinMaxRule));
      })
      .catch(err => {
        console.error('Error fetching minMaxRules:', err);
        setLocationMinMaxRules([]);
      })
      .finally(() => setIsLoadingRules(false));
  }, [selectedLocationId, locationType]);

  // ---- Derived data ----

  const locationName = useMemo(() => {
    if (!selectedLocationId || !locationType) return '';
    if (locationType === 'lab') {
      return hospitals.find(h => h.id === selectedLocationId)?.name ?? '';
    }
    return depots.find(d => d.id === selectedLocationId)?.name ?? '';
  }, [selectedLocationId, locationType, hospitals, depots]);

  const brands = useMemo(() => {
    if (!selectedLocationId || !locationType) return [];
    return getBrandsFromRules(locationMinMaxRules, productCodes);
  }, [selectedLocationId, locationType, locationMinMaxRules, productCodes]);

  const brandProducts = useMemo(() => {
    if (!activeBrand || !selectedLocationId || !locationType) return [];
    return getProductsForBrandFromRules(activeBrand, locationMinMaxRules, productCodes);
  }, [activeBrand, selectedLocationId, locationType, locationMinMaxRules, productCodes]);

  // Initialize count data when brand products change
  useEffect(() => {
    if (brandProducts.length === 0) return;
    setCountData(prev => {
      const next = { ...prev };
      brandProducts.forEach(p => {
        if (!next[p.stokKodu]) {
          next[p.stokKodu] = {
            stokKodu: p.stokKodu,
            stokAdi: p.stokAdi,
            marka: p.marka ?? '',
            stokAdedi: '',
            cihazUstuAdedi: '',
            counted: false,
          };
        }
      });
      return next;
    });
  }, [brandProducts]);

  // Brand progress
  const brandProgressList = useMemo((): BrandProgress[] => {
    return brands.map(brand => {
      const products = getProductsForBrandFromRules(brand, locationMinMaxRules, productCodes);
      const completed = products.filter(p => countData[p.stokKodu]?.counted).length;
      let status: BrandProgress['status'] = 'idle';
      if (completed > 0 && completed < products.length) status = 'in_progress';
      if (completed === products.length && products.length > 0) status = 'completed';
      return { brand, total: products.length, completed, status };
    });
  }, [brands, countData, locationMinMaxRules, productCodes]);

  const totalBrands = brandProgressList.length;
  const completedBrands = brandProgressList.filter(b => b.status === 'completed').length;
  const totalProducts = brandProgressList.reduce((s, b) => s + b.total, 0);
  const totalCounted = brandProgressList.reduce((s, b) => s + b.completed, 0);
  const overallPct = totalProducts > 0 ? Math.round((totalCounted / totalProducts) * 100) : 0;

  // Filtered products for display
  const filteredProducts = useMemo(() => {
    let list = brandProducts;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.stokAdi.toLowerCase().includes(q) ||
        p.stokKodu.toLowerCase().includes(q)
      );
    }
    if (showOnlyUncounted) {
      list = list.filter(p => !countData[p.stokKodu]?.counted);
    }
    // Sort: uncounted first, then counted
    return list.sort((a, b) => {
      const aCounted = countData[a.stokKodu]?.counted ? 1 : 0;
      const bCounted = countData[b.stokKodu]?.counted ? 1 : 0;
      return aCounted - bCounted;
    });
  }, [brandProducts, searchQuery, showOnlyUncounted, countData]);

  // ---- Handlers ----

  const handleStokChange = useCallback((stokKodu: string, val: string) => {
    setCountData(prev => ({
      ...prev,
      [stokKodu]: { ...prev[stokKodu], stokAdedi: val },
    }));
  }, []);

  const handleCihazChange = useCallback((stokKodu: string, val: string) => {
    setCountData(prev => ({
      ...prev,
      [stokKodu]: { ...prev[stokKodu], cihazUstuAdedi: val },
    }));
  }, []);

  const handleMarkCounted = useCallback((stokKodu: string) => {
    setCountData(prev => ({
      ...prev,
      [stokKodu]: { ...prev[stokKodu], counted: !prev[stokKodu]?.counted },
    }));
  }, []);

  const handleCompleteBrand = useCallback(() => {
    // Mark all products of active brand as counted
    setCountData(prev => {
      const next = { ...prev };
      brandProducts.forEach(p => {
        if (next[p.stokKodu]) {
          next[p.stokKodu] = { ...next[p.stokKodu], counted: true };
        }
      });
      return next;
    });
  }, [brandProducts]);

  const handleNextBrand = useCallback(() => {
    const nextIncomplete = brandProgressList.find(b => b.status !== 'completed' && b.brand !== activeBrand);
    if (nextIncomplete) {
      setActiveBrand(nextIncomplete.brand);
    }
  }, [brandProgressList, activeBrand]);

  const handleBarcodeSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    // Find product by barcode number or stok kodu
    const found = productCodes.find(
      p => p.barcodeNumber === barcodeInput.trim() || p.stokKodu === barcodeInput.trim()
    );

    if (found) {
      // If the product belongs to a different brand, switch brand
      if (found.marka && found.marka !== activeBrand) {
        setActiveBrand(found.marka);
      }
      // Scroll to / highlight the product (via search)
      setSearchQuery(found.stokKodu);
      setTimeout(() => setSearchQuery(''), 3000);
    }

    setBarcodeInput('');
  }, [barcodeInput, productCodes, activeBrand]);

  const handleSelectLocation = useCallback((type: LocationType, id: string) => {
    setLocationType(type);
    setSelectedLocationId(id);
    setActiveBrand(null);
    setCountData({});
    setSearchQuery('');
    router.replace(`/maliyet-sayim?type=${type}&id=${id}`, { scroll: false });
  }, [router]);

  // Auto-select first incomplete brand when brands load
  useEffect(() => {
    if (brands.length > 0 && !activeBrand) {
      setActiveBrand(brands[0]);
    }
  }, [brands, activeBrand]);

  // ---- RENDER: Location Selection ----
  if (!locationType || !selectedLocationId) {
    return (
      <div className="cihaz-shell min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 sm:pt-16 pb-24">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8 sm:mb-12 px-1">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <ClipboardCheck className="h-5 w-5 text-[var(--dashboard-accent)]" />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Maliyet Sayım</h1>
              <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">Sayım yapılacak lokasyonu seçin</p>
            </div>
          </div>

          {/* Location type selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <button
              onClick={() => setLocationType('lab')}
              className={cn(
                'cihaz-action-tile cihaz-focus-ring flex flex-col items-center justify-center gap-3 p-6 sm:p-8 min-h-[160px]',
                locationType === 'lab' && 'ring-2 ring-[var(--dashboard-accent)]'
              )}
            >
              <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
                <TestTube className="h-7 w-7 text-[var(--dashboard-accent)]" />
              </span>
              <span className="text-base font-semibold text-[var(--dashboard-text)]">Laboratuvar</span>
              <span className="text-xs text-[var(--dashboard-muted)]">{hospitals.length} laboratuvar</span>
            </button>

            <button
              onClick={() => setLocationType('depot')}
              className={cn(
                'cihaz-action-tile cihaz-focus-ring flex flex-col items-center justify-center gap-3 p-6 sm:p-8 min-h-[160px]',
                locationType === 'depot' && 'ring-2 ring-[var(--dashboard-accent)]'
              )}
            >
              <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
                <Building2 className="h-7 w-7 text-[var(--dashboard-accent)]" />
              </span>
              <span className="text-base font-semibold text-[var(--dashboard-text)]">Depo</span>
              <span className="text-xs text-[var(--dashboard-muted)]">{depots.length} depo</span>
            </button>
          </div>

          {/* Location list */}
          {locationType && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--dashboard-muted)] uppercase tracking-wider px-1 mb-3">
                {locationType === 'lab' ? 'Laboratuvar Seçin' : 'Depo Seçin'}
              </p>
              {(locationType === 'lab' ? hospitals : depots).map(loc => (
                <button
                  key={loc.id}
                  onClick={() => handleSelectLocation(locationType, loc.id)}
                  className="cihaz-tool-item cihaz-focus-ring flex items-center gap-3 px-4 py-3.5 w-full text-left"
                >
                  <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] shrink-0">
                    {locationType === 'lab' ? (
                      <TestTube className="h-4 w-4 text-[var(--dashboard-accent)]" />
                    ) : (
                      <Building2 className="h-4 w-4 text-[var(--dashboard-accent)]" />
                    )}
                  </span>
                  <span className="text-sm font-medium text-[var(--dashboard-text)] flex-1">{loc.name}</span>
                  <ChevronRight className="h-4 w-4 text-[var(--dashboard-muted)] shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- RENDER: Loading minMaxRules ----
  if (isLoadingRules) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    );
  }

  // ---- RENDER: Main Counting Interface ----

  const activeBrandProgress = brandProgressList.find(b => b.brand === activeBrand);
  const activeBrandPct = activeBrandProgress && activeBrandProgress.total > 0
    ? Math.round((activeBrandProgress.completed / activeBrandProgress.total) * 100)
    : 0;

  return (
    <div className="cihaz-shell min-h-screen flex flex-col">
      {/* ===== TOP STATUS BAR ===== */}
      <div className="sticky top-0 z-[var(--z-sticky)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md border-b border-[var(--dashboard-stroke)]">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
          {/* Back button + Location */}
          <button
            onClick={() => { setSelectedLocationId(null); setLocationType(null); router.replace('/maliyet-sayim', { scroll: false }); }}
            className="shrink-0 flex items-center gap-2 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Geri</span>
          </button>

          <div className="flex items-center gap-2">
            {locationType === 'lab' ? (
              <TestTube className="w-4 h-4 text-[var(--dashboard-accent)]" />
            ) : (
              <Building2 className="w-4 h-4 text-[var(--dashboard-accent)]" />
            )}
            <span className="text-sm font-semibold text-[var(--dashboard-text)]">{locationName}</span>
          </div>

          {/* Progress summary */}
          <div className="flex items-center gap-4 ml-auto text-xs text-[var(--dashboard-muted)]">
            <span>{completedBrands} / {totalBrands} marka</span>
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

          {/* Finish button */}
          {completedBrands === totalBrands && totalBrands > 0 && (
            <Button
              size="sm"
              onClick={() => setShowFinishModal(true)}
              className="ml-2"
            >
              Sayımı Bitir
            </Button>
          )}
        </div>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div className="flex-1 flex overflow-hidden">
        {/* ---- LEFT SIDEBAR: Brand Checklist ---- */}
        <aside
          className={cn(
            'shrink-0 border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)] transition-all duration-300 flex flex-col',
            sidebarOpen ? 'w-[280px] sm:w-[320px]' : 'w-0 overflow-hidden'
          )}
        >
          {/* Sidebar header */}
          <div className="px-4 py-3 border-b border-[var(--dashboard-stroke)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
                Markalar
              </span>
              <div className="flex gap-1 text-xs text-[var(--dashboard-muted)]">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  {completedBrands}
                </span>
                <span>/ {totalBrands}</span>
              </div>
            </div>

            {/* Mini counters */}
            <div className="grid grid-cols-3 gap-2">
              <div className="cihaz-pressed px-2 py-1.5 text-center">
                <div className="text-sm font-bold text-[var(--dashboard-text)]">{totalBrands}</div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Toplam</div>
              </div>
              <div className="cihaz-pressed px-2 py-1.5 text-center">
                <div className="text-sm font-bold text-emerald-500">{completedBrands}</div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Tamam</div>
              </div>
              <div className="cihaz-pressed px-2 py-1.5 text-center">
                <div className="text-sm font-bold text-amber-500">{totalBrands - completedBrands}</div>
                <div className="text-[10px] text-[var(--dashboard-muted)]">Bekleyen</div>
              </div>
            </div>
          </div>

          {/* Brand list */}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {brandProgressList.map(bp => (
                <BrandChecklistItem
                  key={bp.brand}
                  brand={bp}
                  isActive={bp.brand === activeBrand}
                  onClick={() => setActiveBrand(bp.brand)}
                />
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Sidebar toggle (mobile) */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="sm:hidden shrink-0 w-6 flex items-center justify-center border-r border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)] text-[var(--dashboard-muted)]"
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* ---- RIGHT PANEL: Product Counting ---- */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {activeBrand ? (
            <>
              {/* Brand header card */}
              <div className="px-4 sm:px-6 py-4 border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-lg font-bold text-[var(--dashboard-text)]">{activeBrand}</h2>
                    <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
                      {activeBrandProgress?.total ?? 0} ürün
                      {' · '}
                      <span className="text-emerald-500">{activeBrandProgress?.completed ?? 0} tamamlandı</span>
                      {' · '}
                      <span className="text-amber-500">{(activeBrandProgress?.total ?? 0) - (activeBrandProgress?.completed ?? 0)} bekliyor</span>
                    </p>
                  </div>

                  {/* Brand progress bar */}
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          activeBrandPct === 100 ? 'bg-emerald-500' : 'bg-[var(--dashboard-accent)]'
                        )}
                        style={{ width: `${activeBrandPct}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-[var(--dashboard-text)]">%{activeBrandPct}</span>
                  </div>
                </div>

                {/* Action row: search, barcode, filters */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {/* Barcode input */}
                  <form onSubmit={handleBarcodeSubmit} className="flex items-center gap-1.5">
                    <div className="relative">
                      <ScanBarcode className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
                      <Input
                        ref={barcodeRef}
                        type="text"
                        placeholder="Barkod okut / ara"
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value)}
                        className="pl-9 h-9 w-40 sm:w-56 text-sm"
                      />
                    </div>
                  </form>

                  {/* Search */}
                  <div className="relative flex-1 min-w-[120px] max-w-[240px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
                    <Input
                      type="text"
                      placeholder="Ürün ara..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 text-sm"
                    />
                  </div>

                  {/* Filters */}
                  <Button
                    size="sm"
                    variant={showOnlyUncounted ? 'default' : 'outline'}
                    onClick={() => setShowOnlyUncounted(!showOnlyUncounted)}
                    className="h-9 text-xs"
                  >
                    Sadece Sayılmayanlar
                  </Button>

                  {/* Brand actions */}
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCompleteBrand}
                      className="h-9 text-xs"
                    >
                      <Check className="w-3.5 h-3.5 mr-1" />
                      Markayı Tamamla
                    </Button>
                  </div>
                </div>
              </div>

              {/* Product cards list */}
              <ScrollArea className="flex-1">
                <div className="p-4 sm:p-6 space-y-3">
                  {filteredProducts.length > 0 ? (
                    filteredProducts.map(product => (
                      <ProductCountCard
                        key={product.stokKodu}
                        product={product}
                        entry={countData[product.stokKodu] ?? {
                          stokKodu: product.stokKodu,
                          stokAdi: product.stokAdi,
                          marka: product.marka ?? '',
                          stokAdedi: '',
                          cihazUstuAdedi: '',
                          counted: false,
                        }}
                        onStokChange={(val) => handleStokChange(product.stokKodu, val)}
                        onCihazChange={(val) => handleCihazChange(product.stokKodu, val)}
                        onMarkCounted={() => handleMarkCounted(product.stokKodu)}
                      />
                    ))
                  ) : (
                    <div className="text-center py-12 text-sm text-[var(--dashboard-muted)]">
                      {searchQuery ? 'Aramayla eşleşen ürün bulunamadı.' : 'Bu markaya ait ürün bulunamadı.'}
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* ===== BOTTOM STICKY ACTION BAR ===== */}
              <div className="sticky bottom-0 z-[var(--z-sticky)] border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-bg)]/95 backdrop-blur-md px-4 sm:px-6 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-[var(--dashboard-muted)]">
                    <span className="font-medium text-[var(--dashboard-text)]">{activeBrandProgress?.completed ?? 0}</span> / {activeBrandProgress?.total ?? 0} ürün sayıldı
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {/* TODO: save logic */}}
                      className="h-9 text-xs"
                    >
                      <Save className="w-3.5 h-3.5 mr-1" />
                      Kaydet
                    </Button>

                    {activeBrandPct === 100 && (
                      <Button
                        size="sm"
                        onClick={handleNextBrand}
                        className="h-9 text-xs"
                      >
                        Sonraki Marka
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[var(--dashboard-muted)]">
              Sol panelden bir marka seçin
            </div>
          )}
        </main>
      </div>

      {/* ===== FINISH MODAL ===== */}
      <Dialog open={showFinishModal} onOpenChange={setShowFinishModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sayımı Tamamla</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="cihaz-card p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Lokasyon</span>
                <span className="font-medium text-[var(--dashboard-text)]">{locationName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Toplam Marka</span>
                <span className="font-medium text-[var(--dashboard-text)]">{totalBrands}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Tamamlanan Marka</span>
                <span className="font-medium text-emerald-500">{completedBrands}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Sayılan Ürün</span>
                <span className="font-medium text-[var(--dashboard-text)]">{totalCounted}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--dashboard-muted)]">Toplam Ürün</span>
                <span className="font-medium text-[var(--dashboard-text)]">{totalProducts}</span>
              </div>
            </div>

            {completedBrands < totalBrands && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Henüz tamamlanmamış {totalBrands - completedBrands} marka var. Yine de sayımı bitirmek istiyor musunuz?
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowFinishModal(false)}>
              Düzenlemeye Dön
            </Button>
            <Button onClick={() => {
              // TODO: Save count session to Firestore
              setShowFinishModal(false);
            }}>
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Sayımı Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
