
'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type {
  Depot,
  ProductCode,
  DepoStokItem,
  MinMaxRule,
  Hospital,
} from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from './ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  PackageSearch, Warehouse, FileSpreadsheet, Loader2,
  SlidersHorizontal, X, Filter, Nfc, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, MoreHorizontal, Eye,
  FileDown, ListChecks, BarChart3, ChevronsUpDown, FileText,
  AlertTriangle, FlaskConical,
} from 'lucide-react';
import { exportDataToExcel } from '@/lib/utils';
import { differenceInDays, parse, isValid, compareAsc } from 'date-fns';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from './ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';
import NfcStockQueryModal from './NfcStockQueryModal';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type GroupedStockRow, type PaginatedStockResult } from '@/actions/stokActions';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { resolveDefaultTrackingMode } from '@/lib/tracking';

/* ────────────────────────────────────────────
   Filter Dialog (kept for marka/urunGrubu filters)
   ──────────────────────────────────────────── */
interface FilterSpec {
  group: 'marka' | 'urunGrubu';
  value: string;
}

type MiadSeverity = 'normal' | 'notice' | 'caution' | 'warning' | 'critical' | 'expired';

function getMiadInfoFromString(miadStr: string): { days: number; severity: MiadSeverity } {
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

function getCoverageInfoForRow(
  row: GroupedStockRow,
  minMaxRules: Record<string, MinMaxRule>,
  lotTrackedStockCodes: Set<string>,
  sourceRows: GroupedStockRow[]
): { label: string; severity: 'good' | 'warning' | 'critical' | 'unknown'; coverageDays: number; dailyNeed: number } {
  const stokKodu = row.stokKodu;
  const rule = minMaxRules[stokKodu];
  if (!rule || !rule.max || !rule.maxGun) return { label: 'Min/Max tanımsız', severity: 'unknown', coverageDays: 0, dailyNeed: 0 };
  const stockForCoverage = lotTrackedStockCodes.has(stokKodu)
    ? row.quantity
    : sourceRows.reduce((acc, r) => r.stokKodu === stokKodu ? acc + r.quantity : acc, 0);
  const periodDays = Math.floor(rule.maxGun);
  if (periodDays <= 0) return { label: 'Hesaplanamadı', severity: 'unknown', coverageDays: 0, dailyNeed: 0 };
  const dailyNeed = rule.max / periodDays;
  if (dailyNeed <= 0) return { label: 'Hesaplanamadı', severity: 'unknown', coverageDays: 0, dailyNeed: 0 };
  const coverageDays = Math.floor(stockForCoverage / dailyNeed);
  if (coverageDays <= 3) return { label: `${coverageDays} gün`, severity: 'critical', coverageDays, dailyNeed };
  if (coverageDays <= 10) return { label: `${coverageDays} gün`, severity: 'warning', coverageDays, dailyNeed };
  return { label: `${coverageDays} gün yeter`, severity: 'good', coverageDays, dailyNeed };
}

function getRiskyBoxes(miadInfo: { days: number }, coverageInfo: { severity: string; coverageDays: number; dailyNeed: number }) {
  if (coverageInfo.severity === 'unknown' || miadInfo.days === Infinity || miadInfo.days <= 0 || coverageInfo.coverageDays <= miadInfo.days) return 0;
  const riskyDays = coverageInfo.coverageDays - miadInfo.days;
  return Math.max(0, Math.ceil(riskyDays * coverageInfo.dailyNeed));
}

const FiltreDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  availableGroups: Record<string, string[]>;
  onApply: (filters: FilterSpec[]) => void;
}> = ({ isOpen, onClose, availableGroups, onApply }) => {
  const [selectedFilters, setSelectedFilters] = useState<FilterSpec[]>([]);

  const handleDragStart = (e: React.DragEvent, group: 'marka' | 'urunGrubu', value: string) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ group, value }));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('application/json')) as FilterSpec;
    if (!selectedFilters.some(f => f.group === data.group && f.value === data.value)) {
      setSelectedFilters(prev => [...prev, data]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const removeFilter = (filterToRemove: FilterSpec) => {
    setSelectedFilters(prev => prev.filter(f => !(f.group === filterToRemove.group && f.value === filterToRemove.value)));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-headline">Stoğu Filtrele</DialogTitle>
          <DialogDescription>Filtrelemek istediğiniz değerleri sağdaki alandan soldaki kutusuna sürükleyin.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
          <div className="border-2 border-dashed border-muted rounded-lg p-4 min-h-[250px] flex flex-col gap-2" onDrop={handleDrop} onDragOver={handleDragOver}>
            <h3 className="font-semibold">Seçilen Filtreler</h3>
            {selectedFilters.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Filtreleri buraya sürükleyin</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedFilters.map(f => (
                  <div key={`${f.group}-${f.value}`} className="flex items-center bg-primary/10 text-primary-foreground px-3 py-1.5 rounded-full text-sm font-medium">
                    <span>{f.value}</span>
                    <button onClick={() => removeFilter(f)} className="ml-2 rounded-full hover:bg-primary/20 p-0.5"><X className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-4 max-h-[300px] overflow-y-auto p-1 glass-scroll">
            {Object.entries(availableGroups).map(([group, items]: [string, string[]]) => (
              <div key={group}>
                <h3 className="font-semibold mb-2">{group === 'marka' ? 'Marka' : 'Ürün Grubu'}</h3>
                <div className="flex flex-wrap gap-2 mt-2">
                  {items.map((item: string) => (
                    <div key={item} draggable onDragStart={e => handleDragStart(e, group as 'marka' | 'urunGrubu', item)} className="px-3 py-1 bg-background border rounded-md cursor-move text-sm shadow-sm hover:bg-accent hover:text-accent-foreground">{item}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={() => { onApply(selectedFilters); onClose(); }}>Filtreleri Uygula</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ────────────────────────────────────────────
   Excel-Like Column Filter Popover
   ──────────────────────────────────────────── */
function ColumnFilterPopover({
  column,
  label,
  uniqueValues,
  selectedValues,
  onApply,
  sortField,
  sortDirection,
  onSort,
}: {
  column: string;
  label: string;
  uniqueValues: string[];
  selectedValues: string[];
  onApply: (column: string, values: string[]) => void;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  onSort: (field: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState<string[]>(selectedValues);
  const [filterText, setFilterText] = useState('');
  const isActive = selectedValues.length > 0;
  const isSorted = sortField === column;

  useEffect(() => {
    if (open) setLocalSelected(selectedValues);
  }, [open, selectedValues]);

  const filteredValues = filterText
    ? uniqueValues.filter(v => v.toLowerCase().includes(filterText.toLowerCase()))
    : uniqueValues;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          "flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wider transition-colors group",
          isActive ? "text-orange-600" : "text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
        )}>
          {label}
          <span className="flex flex-col items-center ml-0.5">
            {isSorted ? (
              sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronsUpDown className="h-3 w-3 opacity-40 group-hover:opacity-100" />
            )}
          </span>
          {isActive && (
            <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] text-white font-bold">{selectedValues.length}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        {/* Sort buttons */}
        <div className="flex border-b">
          <button
            className={cn("flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs hover:bg-[var(--dashboard-surface-2)]", isSorted && sortDirection === 'asc' && "bg-[var(--dashboard-surface-2)] font-bold")}
            onClick={() => { onSort(column); setOpen(false); }}
          >
            <ChevronUp className="h-3 w-3" /> A→Z
          </button>
          <button
            className={cn("flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs hover:bg-[var(--dashboard-surface-2)]", isSorted && sortDirection === 'desc' && "bg-[var(--dashboard-surface-2)] font-bold")}
            onClick={() => { onSort(column); setOpen(false); }}
          >
            <ChevronDown className="h-3 w-3" /> Z→A
          </button>
        </div>
        {/* Filter search */}
        <div className="p-2 border-b">
          <Input
            placeholder="Filtrele..."
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        {/* Select all / Clear */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b">
          <button className="text-[10px] text-blue-600 hover:underline" onClick={() => setLocalSelected(uniqueValues)}>Tümünü Seç</button>
          <button className="text-[10px] text-red-500 hover:underline" onClick={() => setLocalSelected([])}>Temizle</button>
        </div>
        {/* Values list */}
        <ScrollArea className="max-h-48">
          <div className="p-1">
            {filteredValues.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Sonuç yok</p>
            ) : (
              filteredValues.map(val => (
                <label key={val} className="flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-[var(--dashboard-surface-2)] cursor-pointer">
                  <Checkbox
                    checked={localSelected.includes(val)}
                    onCheckedChange={(checked) => {
                      setLocalSelected(prev => checked ? [...prev, val] : prev.filter(v => v !== val));
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate">{val || '(Boş)'}</span>
                </label>
              ))
            )}
          </div>
        </ScrollArea>
        {/* Apply */}
        <div className="border-t p-2 flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => { onApply(column, []); setOpen(false); }}>Sıfırla</Button>
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => { onApply(column, localSelected); setOpen(false); }}>Uygula</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ────────────────────────────────────────────
   Stok Yonetimi Panel – Main Component
   ──────────────────────────────────────────── */
export default function StokYonetimiPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();

  // Master data
  const [depots, setDepots] = useState<Depot[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [minMaxRules, setMinMaxRules] = useState<Record<string, MinMaxRule>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Client-side pagination state
  const [allGroupedRows, setAllGroupedRows] = useState<GroupedStockRow[]>([]);
  const [columnUniqueValues, setColumnUniqueValues] = useState<PaginatedStockResult['columnValues']>({ stokAdi: [], lotNumarasi: [], miad: [], rafAdresi: [] });
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const rowsPerPageOptions = [20, 30, 50, 100];
  const [sortField, setSortField] = useState('miad');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [isStockLoading, setIsStockLoading] = useState(false);

  // Dialogs
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [isNfcQueryModalOpen, setIsNfcQueryModalOpen] = useState(false);
  const [isLabCountModalOpen, setIsLabCountModalOpen] = useState(false);
  const [selectedLabsForReport, setSelectedLabsForReport] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<FilterSpec[]>([]);
  const [showOnlyRiskyStock, setShowOnlyRiskyStock] = useState(false);
  // Risk stock lab modal
  const [isRiskLabModalOpen, setIsRiskLabModalOpen] = useState(false);
  const [riskLabModalProduct, setRiskLabModalProduct] = useState<{ stokKodu: string; stokAdi: string; riskyBoxes: number } | null>(null);
  const [riskLabModalLoading, setRiskLabModalLoading] = useState(false);
  const [riskLabStockData, setRiskLabStockData] = useState<Array<{ labId: string; labName: string; items: Array<{ lotNumarasi: string; miad: string; miadDays: number; quantity: number }> }>>([]);
  // For NFC modal & exports we may need raw stock
  const [rawDepotStock, setRawDepotStock] = useState<DepoStokItem[]>([]);

  /* ─── Fetch master data ─── */
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const [depotsSnap, productsSnap, hospitalsSnap] = await Promise.all([
          getDocs(collection(db, 'depots')),
          getDocs(collection(db, 'productCodes')),
          getDocs(collection(db, 'hospitals')),
        ]);
        const allDepots = depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
        setDepots(allDepots);
        setProductCodes(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
        setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));

        // Filter out pool warehouses for operational panels
        const operationalDepots = filterOperationalSourceDepots(allDepots, currentUserProfile);
        if (operationalDepots.length > 0 && operationalDepots[0]?.id) {
          setSelectedDepotId(operationalDepots[0].id);
        }
      } catch (e) {
        toast({ title: 'Veri Yükleme Hatası', description: 'Ana veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [toast, currentUserProfile]);

  /* ─── Fetch min/max rules when depot changes ─── */
  useEffect(() => {
    if (!selectedDepotId) return;
    (async () => {
      try {
        const rulesRef = collection(db, "depots", selectedDepotId, "minMaxRules");
        const snapshot = await getDocs(rulesRef);
        const rules: Record<string, MinMaxRule> = {};
        snapshot.forEach(d => {
          const rule = d.data() as MinMaxRule;
          if (rule.stokKodu) rules[rule.stokKodu] = rule;
        });
        setMinMaxRules(rules);
      } catch (e) { console.error("Error fetching min-max rules:", e); }
    })();
  }, [selectedDepotId]);

  /* ─── Fetch depot stock (client-side, once per depot) ─── */
  useEffect(() => {
    if (!selectedDepotId) {
      setAllGroupedRows([]);
      setColumnUniqueValues({ stokAdi: [], lotNumarasi: [], miad: [], rafAdresi: [] });
      setRawDepotStock([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsStockLoading(true);
      try {
        const stockQuery = query(
          collection(db, 'depoStok'),
          where('depotId', '==', selectedDepotId),
          where('isShipped', '==', false)
        );
        const snapshot = await getDocs(stockQuery);
        if (cancelled) return;
        const allItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
        setRawDepotStock(allItems);

        // Group by (stokKodu, lotNumarasi, miad)
        const grouped: Record<string, GroupedStockRow> = {};
        const productMetaByCode = new Map<string, ProductCode>(
          productCodes.filter((p) => p.stokKodu !== undefined).map((p) => [p.stokKodu!, p] as const)
        );
        for (const item of allItems) {
          const lot = item.lotNumarasi || '';
          const miad = typeof item.miad === 'string' ? item.miad : '';
          const gKey = `${item.stokKodu}-${lot}-${miad}`;
          if (!grouped[gKey]) {
            grouped[gKey] = {
              key: gKey,
              stokKodu: item.stokKodu || '',
              stokAdi: item.stokAdi || '',
              lotNumarasi: lot,
              miad,
              anaBirim: productMetaByCode.get(item.stokKodu || '')?.anaBirim || 'Adet',
              rafAdresi: item.rafAdresi || '',
              quantity: 0,
              itemIds: [],
            };
          }
          grouped[gKey].quantity += 1;
          if (item.id) grouped[gKey].itemIds.push(item.id);
        }

        const rows = Object.values(grouped);
        setAllGroupedRows(rows);
        setColumnUniqueValues({
          stokAdi: [...new Set(rows.map(r => r.stokAdi))].sort(),
          lotNumarasi: [...new Set(rows.map(r => r.lotNumarasi).filter(Boolean))].sort(),
          miad: [...new Set(rows.map(r => r.miad).filter(Boolean))].sort(),
          rafAdresi: [...new Set(rows.map(r => r.rafAdresi).filter(Boolean))].sort(),
        });
        setCurrentPage(1);
      } catch (e) {
        console.error('Stock fetch error:', e);
        toast({ title: 'Hata', description: 'Stok verileri yüklenemedi.', variant: 'destructive' });
      } finally {
        if (!cancelled) setIsStockLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDepotId, productCodes, toast]);

  const lotTrackedStockCodes = useMemo(() => {
    const tracked = new Set<string>();
    for (const product of productCodes) {
      if (!product.stokKodu) continue;
      const trackingMode = resolveDefaultTrackingMode(product);
      if (trackingMode === 'serial' || trackingMode === 'lot_barcode' || trackingMode === 'lot_manual') {
        tracked.add(product.stokKodu);
      }
    }
    return tracked;
  }, [productCodes]);


  /* ─── Client-side filtering, sorting, pagination ─── */
  const { rows, totalRows, totalPages, colValues } = useMemo(() => {
    let filtered = [...allGroupedRows];

    // Apply column filters
    for (const [col, values] of Object.entries(columnFilters) as [string, string[]][]) {
      if (values.length === 0) continue;
      filtered = filtered.filter(r => {
        const fieldVal = (r as any)[col];
        return values.includes(String(fieldVal ?? ''));
      });
    }

    if (showOnlyRiskyStock) {
      filtered = filtered.filter((row) => {
        const miadInfo = getMiadInfoFromString(row.miad);
        const coverageInfo = getCoverageInfoForRow(row, minMaxRules, lotTrackedStockCodes, allGroupedRows);
        return getRiskyBoxes(miadInfo, coverageInfo) > 0;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = (a as any)[sortField] ?? '';
      const bVal = (b as any)[sortField] ?? '';

      if (sortField === 'miad') {
        const dateA = parse(String(aVal), 'dd.MM.yyyy', new Date());
        const dateB = parse(String(bVal), 'dd.MM.yyyy', new Date());
        if (isValid(dateA) && isValid(dateB)) {
          return sortDirection === 'asc' ? compareAsc(dateA, dateB) : compareAsc(dateB, dateA);
        }
      }
      if (sortField === 'quantity') {
        return sortDirection === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
      }
      return sortDirection === 'asc'
        ? String(aVal).localeCompare(String(bVal), 'tr')
        : String(bVal).localeCompare(String(aVal), 'tr');
    });

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / rowsPerPage));
    const safePage = Math.min(Math.max(1, currentPage), pages);
    const start = (safePage - 1) * rowsPerPage;
    const pageRows = filtered.slice(start, start + rowsPerPage);

    return { rows: pageRows, totalRows: total, totalPages: pages, colValues: columnUniqueValues };
  }, [allGroupedRows, columnFilters, sortField, sortDirection, currentPage, rowsPerPage, columnUniqueValues, showOnlyRiskyStock, minMaxRules, lotTrackedStockCodes]);

  // Filter out pool warehouses for the depot selector
  const availableDepots = useMemo(
    () => filterOperationalSourceDepots(depots, currentUserProfile),
    [depots, currentUserProfile]
  );
  const depotName = depots.find(d => d.id === selectedDepotId)?.name || '';
  const isPending = isStockLoading;

  /* ─── Sorting handler ─── */
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  /* ─── Column filter handler ─── */
  const handleColumnFilter = (column: string, values: string[]) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (values.length === 0) {
        delete next[column];
      } else {
        next[column] = values;
      }
      return next;
    });
    setCurrentPage(1);
  };

  /* ─── Clear all column filters ─── */
  const clearAllFilters = () => {
    setColumnFilters({});
    setCurrentPage(1);
  };

  const hasActiveColumnFilters = Object.values(columnFilters).some((v: string[]) => v.length > 0);

  const getMiadInfo = getMiadInfoFromString;

  const getCoverageInfo = (row: GroupedStockRow) =>
    getCoverageInfoForRow(row, minMaxRules, lotTrackedStockCodes, allGroupedRows);

  const riskyRows = useMemo(
    () => allGroupedRows.filter((row) => {
      const miadInfo = getMiadInfoFromString(row.miad);
      const coverageInfo = getCoverageInfoForRow(row, minMaxRules, lotTrackedStockCodes, allGroupedRows);
      return getRiskyBoxes(miadInfo, coverageInfo) > 0;
    }),
    [allGroupedRows, minMaxRules, lotTrackedStockCodes]
  );

  const hasRiskyRows = riskyRows.length > 0;

  /* ─── Row color strip ─── */
  const getRowStripeColor = (row: GroupedStockRow): string => {
    const miadInfo = getMiadInfo(row.miad);
    if (miadInfo.severity === 'expired' || miadInfo.severity === 'critical') return 'bg-red-500';
    if (miadInfo.severity === 'warning' || miadInfo.severity === 'caution') return 'bg-amber-500';
    if (miadInfo.severity === 'notice') return 'bg-yellow-400';
    const rule = minMaxRules[row.stokKodu];
    if (rule && rule.min !== undefined && row.quantity <= rule.min) return 'bg-slate-400';
    return 'bg-transparent';
  };

  /* ─── Available filter groups for marka/urunGrubu ─── */
  const availableFilterGroups = useMemo(() => {
    const markaSet = new Set<string>();
    const urunGrubuSet = new Set<'kit' | 'sarf' | 'yedek_parca'>();
    productCodes.forEach(p => {
      if (p.marka) markaSet.add(p.marka);
      if (p.urunGrubu) urunGrubuSet.add(p.urunGrubu);
    });
    return {
      marka: Array.from(markaSet).sort(),
      urunGrubu: Array.from(urunGrubuSet).sort()
    };
  }, [productCodes]);

  /* ─── Export functions ─── */
  const handleExport = async (detailed: boolean) => {
    // Fetch all stock for export
    try {
      const stockQuery = query(
        collection(db, 'depoStok'),
        where('depotId', '==', selectedDepotId),
        where('isShipped', '==', false)
      );
      const snapshot = await getDocs(stockQuery);
      const allItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
      const fileName = `${depotName}_Stok_Raporu_${detailed ? 'Detayli' : 'Ozet'}`;
      const productCodeMap = new Map<string, ProductCode>(
        productCodes.filter(p => p.stokKodu !== undefined).map(p => [p.stokKodu!, p] as const)
      );

      if (detailed) {
        const dataToExport = allItems.map(item => ({
          'Stok Kodu': item.stokKodu || '',
          'Stok Adı': item.stokAdi || '',
          'Lot Numarası': item.lotNumarasi || '',
          'Miad': item.miad || '',
          'Seri Numarası': item.seriNumarasi || '',
          'Raf Adresi': item.rafAdresi || '',
        })).sort((a, b) => (a['Stok Adı'] || '').localeCompare(b['Stok Adı'] || ''));
        exportDataToExcel(dataToExport, fileName, "StokRaporu", toast);
      } else {
        const grouped: Record<string, any[]> = {};
        const groupedItems: Record<string, { stokKodu: string; stokAdi: string; lot: string; miad: string; count: number; birim: string }> = {};
        allItems.forEach(item => {
          const key = `${item.stokKodu}-${item.lotNumarasi}-${item.miad}`;
          if (!groupedItems[key]) {
            groupedItems[key] = { stokKodu: item.stokKodu || '', stokAdi: item.stokAdi || '', lot: item.lotNumarasi || '', miad: String(item.miad || ''), count: 0, birim: productCodeMap.get(item.stokKodu || '')?.anaBirim || 'Kutu' };
          }
          groupedItems[key].count++;
        });
        Object.values(groupedItems).forEach(g => {
          const product = productCodeMap.get(g.stokKodu);
          const brand = product?.marka || 'Diğer';
          if (!grouped[brand]) grouped[brand] = [];
          grouped[brand].push({
            'Stok Kodu': g.stokKodu,
            'Stok Adı': g.stokAdi,
            'Lot Numarası': g.lot,
            'Miad': g.miad,
            'Miktar': g.count,
            'Birim': g.birim,
          });
        });
        for (const brand in grouped) {
          grouped[brand].sort((a, b) => a['Stok Adı'].localeCompare(b['Stok Adı']));
        }
        exportDataToExcel(grouped, fileName, toast);
      }
    } catch {
      toast({ title: 'Hata', description: 'Rapor oluşturulamadı.', variant: 'destructive' });
    }
  };

  const riskyExportRows = useMemo(() => {
    return riskyRows.map((row) => {
      const miadInfo = getMiadInfoFromString(row.miad);
      const coverageInfo = getCoverageInfoForRow(row, minMaxRules, lotTrackedStockCodes, allGroupedRows);
      const riskyBoxes = getRiskyBoxes(miadInfo, coverageInfo);
      return {
        row,
        miadInfo,
        coverageInfo,
        riskyBoxes,
      };
    });
  }, [riskyRows, minMaxRules, lotTrackedStockCodes, allGroupedRows]);

  const handleRiskyExcelExport = () => {
    const data = riskyExportRows.map(({ row, miadInfo, coverageInfo, riskyBoxes }) => ({
      'Stok Adı': row.stokAdi,
      'Stok Kodu': row.stokKodu,
      'Lot': row.lotNumarasi,
      'Miad': row.miad,
      'Kalan Gün': miadInfo.days < 0 ? 'Süresi dolmuş' : `${miadInfo.days} gün`,
      'Adet': `${row.quantity} ${row.anaBirim}`,
      'Yeterlilik': coverageInfo.label,
      'Riskli Adet': `${riskyBoxes} kutu`,
    }));
    exportDataToExcel(data, `${depotName}_Riskli_Stok_Raporu`, 'RiskliStok', toast);
  };

  const loadImageAsDataUrl = async (candidates: string[]): Promise<string | null> => {
    for (const path of candidates) {
      try {
        const response = await fetch(path);
        if (!response.ok) continue;
        const blob = await response.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise<string | null>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
        if (dataUrl) return dataUrl;
      } catch {
        // try next
      }
    }
    return null;
  };

  const handleRiskyPdfExport = async () => {
    try {
      const [jsPDFModule, autoTableModule] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
      ]);
      const jsPDF = jsPDFModule.default;
      const autoTable = autoTableModule.default;
      const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      // Same frame padding as TransferTutanakPDFButton
      const padX = 40;
      const ORANGE: [number, number, number] = [199, 137, 65];
      const FONT = 'helvetica';

      // Sanitize Turkish chars for helvetica rendering (same as other tutanaks)
      const san = (str: string | null | undefined): string => {
        if (!str) return '';
        return str
          .replace(/İ/g, 'I').replace(/ı/g, 'i')
          .replace(/Ş/g, 'S').replace(/ş/g, 's')
          .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
          .replace(/Ü/g, 'U').replace(/ü/g, 'u')
          .replace(/Ö/g, 'O').replace(/ö/g, 'o')
          .replace(/Ç/g, 'C').replace(/ç/g, 'c');
      };

      const [logoLeft, logoRight] = await Promise.all([
        loadImageAsDataUrl(['/blk.png']),
        loadImageAsDataUrl(['/invlogo.png', '/QORE-INV_LOGO.PNG', '/invitrolab_LOGO__-_Kopya__1_-removebg.png']),
      ]);

      const rowsForPdf = riskyExportRows.map(({ row, miadInfo, coverageInfo, riskyBoxes }) => {
        return {
          stokAdi: row.stokAdi,
          stokKodu: row.stokKodu,
          lot: row.lotNumarasi || '-',
          miad: row.miad || '-',
          miadLabel: miadInfo.days < 0 ? 'Suresi dolmus' : `${miadInfo.days} gun kaldi`,
          adet: `${row.quantity}`,
          anaBirim: row.anaBirim || '',
          yeterlilik: coverageInfo.label,
          miadSeverity: miadInfo.severity,
          coverageSeverity: coverageInfo.severity,
          riskyBoxes,
        };
      });

      // Total risky boxes across all rows
      const totalRiskyBoxes = rowsForPdf.reduce((sum, r) => sum + r.riskyBoxes, 0);

      // Header height reserved for title + summary (used for startY and margin.top)
      const headerH = 78;

      // Drawn on every page (frame + title/depot header)
      const drawFrameAndHeader = () => {
        // Orange border — same style as TransferTutanakPDFButton
        doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2]);
        doc.setLineWidth(2);
        doc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);

        // Report name — large & bold, centered
        doc.setFont(FONT, 'bold');
        doc.setFontSize(26);
        doc.setTextColor(17, 24, 39);
        doc.text(san('RISKLI STOK RAPORU'), pageW / 2, padX / 2 + 28, { align: 'center' });

        // Depot name — below report name
        doc.setFontSize(14);
        doc.setFont(FONT, 'bold');
        doc.setTextColor(71, 85, 105);
        doc.text(san(`${depotName || 'Depo'} Deposu`), pageW / 2, padX / 2 + 48, { align: 'center' });

        // Total risky box count — styled summary badge
        const summaryY = padX / 2 + 66;
        doc.setFillColor(254, 243, 199);
        const summaryText = san(`Toplam Riskli Stok: ${totalRiskyBoxes} kutu`);
        const tw = doc.getTextWidth(summaryText);
        const badgePadH = 14;
        const badgePadV = 5;
        doc.roundedRect(pageW / 2 - tw / 2 - badgePadH, summaryY - 9, tw + badgePadH * 2, 14 + badgePadV, 4, 4, 'F');
        doc.setFont(FONT, 'bold');
        doc.setFontSize(10);
        doc.setTextColor(146, 64, 14);
        doc.text(summaryText, pageW / 2, summaryY, { align: 'center' });

        // Timestamp — small, top right
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(new Date().toLocaleString('tr-TR'), pageW - padX / 2 - 6, padX / 2 + 14, { align: 'right' });
      };

      // Available table width = pageW - (padX/2 + 8)*2 ≈ 785pt (landscape A4)
      autoTable(doc, {
        head: [[
          '',
          san('STOK ADI'),
          'LOT',
          san('MIAD'),
          san('ADET'),
          san('YETERLILIK'),
          san('RISKLI ADET'),
        ]],
        body: rowsForPdf.map((item) => [
          '',
          `${san(item.stokAdi)}\n(${san(item.stokKodu)})`,
          san(item.lot),
          `${item.miad}\n${san(item.miadLabel)}`,
          `${item.adet} ${san(item.anaBirim)}`,
          san(item.yeterlilik),
          `${item.riskyBoxes}`,
        ]),
        startY: padX / 2 + headerH,
        theme: 'grid',
        styles: {
          font: FONT,
          fontSize: 9,
          cellPadding: { top: 5, right: 6, bottom: 5, left: 6 },
          textColor: [15, 23, 42],
          valign: 'middle',
          lineColor: [226, 232, 240],
          lineWidth: 0.5,
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [71, 85, 105],
          fontStyle: 'bold',
          fontSize: 8,
          cellPadding: { top: 4, right: 6, bottom: 4, left: 6 },
        },
        margin: { top: padX / 2 + headerH, left: padX / 2 + 8, right: padX / 2 + 8, bottom: 72 },
        columnStyles: {
          0: { cellWidth: 6 },
          1: { cellWidth: 260 },
          2: { cellWidth: 100 },
          3: { cellWidth: 120 },
          4: { cellWidth: 90, halign: 'center' },
          5: { cellWidth: 130, halign: 'center' },
          6: { cellWidth: 79, halign: 'center' },
        },
        didParseCell: (hookData) => {
          if (hookData.section !== 'body') return;
          const item = rowsForPdf[hookData.row.index];
          if (!item) return;

          // Apply whole-row background tint matching UI row colors
          const rowBg: [number, number, number] =
            (item.miadSeverity === 'expired' || item.miadSeverity === 'critical') ? [254, 242, 242] :
            (item.miadSeverity === 'warning' || item.miadSeverity === 'caution') ? [255, 251, 235] :
            [255, 255, 255];
          hookData.cell.styles.fillColor = rowBg;

          // Col 0: left color strip (red / amber / yellow) — matches UI stripe
          if (hookData.column.index === 0) {
            if (item.miadSeverity === 'expired' || item.miadSeverity === 'critical') {
              hookData.cell.styles.fillColor = [239, 68, 68];   // bg-red-500
            } else if (item.miadSeverity === 'warning' || item.miadSeverity === 'caution') {
              hookData.cell.styles.fillColor = [245, 158, 11];  // bg-amber-500
            } else if (item.miadSeverity === 'notice') {
              hookData.cell.styles.fillColor = [250, 204, 21];  // bg-yellow-400
            } else {
              hookData.cell.styles.fillColor = [255, 255, 255];
            }
          }

          // Col 3: MIAD cell — badge-like coloring matching UI miad badges
          if (hookData.column.index === 3) {
            if (item.miadSeverity === 'expired' || item.miadSeverity === 'critical') {
              hookData.cell.styles.fillColor = [254, 202, 202];  // bg-red-100
              hookData.cell.styles.textColor = [153, 27, 27];    // text-red-700
            } else if (item.miadSeverity === 'warning') {
              hookData.cell.styles.fillColor = [255, 237, 213];  // bg-orange-100
              hookData.cell.styles.textColor = [194, 65, 12];    // text-orange-700
            } else if (item.miadSeverity === 'caution') {
              hookData.cell.styles.fillColor = [254, 243, 199];  // bg-amber-100
              hookData.cell.styles.textColor = [180, 83, 9];     // text-amber-700
            } else if (item.miadSeverity === 'notice') {
              hookData.cell.styles.fillColor = [254, 249, 195];  // bg-yellow-100
              hookData.cell.styles.textColor = [161, 98, 7];     // text-yellow-700
            }
            hookData.cell.styles.fontStyle = 'bold';
          }

          // Col 4: ADET — chip/badge style (bg-[dashboard-surface] border)
          if (hookData.column.index === 4) {
            hookData.cell.styles.fillColor = [248, 250, 252];  // slate-50
            hookData.cell.styles.textColor = [30, 41, 59];     // slate-800
            hookData.cell.styles.fontStyle = 'bold';
          }

          // Col 5: YETERLİLİK — coverage badge matching UI rounded-full badges
          if (hookData.column.index === 5) {
            if (item.coverageSeverity === 'good') {
              hookData.cell.styles.fillColor = [209, 250, 229];  // bg-emerald-100
              hookData.cell.styles.textColor = [6, 95, 70];      // text-emerald-700
            } else if (item.coverageSeverity === 'warning') {
              hookData.cell.styles.fillColor = [255, 237, 213];  // bg-orange-100
              hookData.cell.styles.textColor = [194, 65, 12];    // text-orange-700
            } else if (item.coverageSeverity === 'critical') {
              hookData.cell.styles.fillColor = [254, 226, 226];  // bg-red-100
              hookData.cell.styles.textColor = [185, 28, 28];    // text-red-700
            } else {
              hookData.cell.styles.fillColor = [241, 245, 249];  // bg-slate-100
              hookData.cell.styles.textColor = [100, 116, 139];  // text-slate-500
            }
            hookData.cell.styles.fontStyle = 'bold';
          }

          // Col 6: RİSKLİ ADET — amber badge matching UI "⚠ X kutu riskli"
          if (hookData.column.index === 6) {
            hookData.cell.styles.fillColor = [254, 243, 199];  // bg-amber-100
            hookData.cell.styles.textColor = [146, 64, 14];    // text-amber-800
            hookData.cell.styles.fontStyle = 'bold';
          }
        },
        didDrawPage: () => {
          drawFrameAndHeader();
        },
      });

      // Footer logos — on last page only, centered with divider line
      // blk.png is square, invlogo.png is rectangular — preserve natural aspect ratios
      const totalPages = doc.getNumberOfPages();
      doc.setPage(totalPages);

      const logoH = 30;             // Equal height for visual balance
      const blkW = 30;              // Square logo (blk.png)
      const invW = 80;              // Rectangular logo (invlogo.png) — wider
      const dividerGap = 16;
      const centerX = pageW / 2;
      const logoY = pageH - padX / 2 - logoH - 10;

      // Left logo (blk) — right-aligned to center
      const leftLogoX = centerX - dividerGap / 2 - blkW;
      // Right logo (invlogo) — left-aligned from center
      const rightLogoX = centerX + dividerGap / 2;

      // Vertical divider line between the two logos
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(1);
      doc.line(centerX, logoY - 4, centerX, logoY + logoH + 4);

      if (logoLeft) doc.addImage(logoLeft, 'PNG', leftLogoX, logoY, blkW, logoH, undefined, 'FAST');
      if (logoRight) doc.addImage(logoRight, 'PNG', rightLogoX, logoY, invW, logoH, undefined, 'FAST');

      const safeFileName = `${depotName}_Riskli_Stok_Raporu`.replace(/[^a-z0-9_]/gi, '_');
      doc.save(`${safeFileName}.pdf`);
      toast({ title: 'Başarılı', description: 'Riskli stok PDF raporu oluşturuldu.' });
    } catch {
      toast({ title: 'Hata', description: 'Riskli stok PDF raporu oluşturulamadı.', variant: 'destructive' });
    }
  };
  /* ─── Lab count export ─── */
  const handleLabCountExport = async () => {
    if (selectedLabsForReport.length === 0) {
      toast({ title: 'Laboratuvar Seçilmedi', description: 'Lütfen en az bir laboratuvar seçin.', variant: "default" });
      return;
    }
    const labNames = hospitals.filter(h => h.id && selectedLabsForReport.includes(h.id)).map(h => h.name).filter((n): n is string => !!n);
    try {
      const shippedQuery = query(collection(db, 'depoStok'), where('isShipped', '==', true));
      const shippedSnap = await getDocs(shippedQuery);
      const stockForSelectedLabs = shippedSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)).filter(item => item.hedefKurum && labNames.includes(item.hedefKurum));
      const stockSummary: Record<string, { stokAdi: string; quantity: number }> = {};
      stockForSelectedLabs.forEach(item => {
        if (!item.stokKodu) return;
        if (!stockSummary[item.stokKodu]) stockSummary[item.stokKodu] = { stokAdi: productCodes.find(p => p.stokKodu === item.stokKodu)?.stokAdi || item.stokAdi || '', quantity: 0 };
        stockSummary[item.stokKodu].quantity += 1;
      });
      const dataToExport = Object.entries(stockSummary).map(([stokKodu, data]) => ({ 'Stok Kodu': stokKodu, 'Stok Adı': data.stokAdi, 'Toplam Adet': data.quantity })).sort((a, b) => a['Stok Adı'].localeCompare(b['Stok Adı']));
      if (dataToExport.length === 0) { toast({ title: 'Veri Yok', description: 'Seçilen laboratuvarlar için stok bulunamadı.', variant: "default" }); return; }
      exportDataToExcel(dataToExport, `Secili_Lab_Stok_Raporu`, "LabStokRaporu", toast);
      setIsLabCountModalOpen(false);
    } catch {
      toast({ title: 'Hata', description: 'Laboratuvar stoğu yüklenemedi.', variant: 'destructive' });
    }
  };

  /* ─── Risk lab modal handler ─── */
  const handleOpenRiskLabModal = useCallback(async (stokKodu: string, stokAdi: string, riskyBoxes: number) => {
    setRiskLabModalProduct({ stokKodu, stokAdi, riskyBoxes });
    setIsRiskLabModalOpen(true);
    setRiskLabModalLoading(true);
    setRiskLabStockData([]);

    try {
      // Find which hospitals have this product in their minMaxRules
      const labsWithProduct: { labId: string; labName: string }[] = [];
      for (const hospital of hospitals) {
        if (!hospital.id) continue;
        const rulesSnap = await getDocs(collection(db, 'hospitals', hospital.id, 'minMaxRules'));
        const hasProduct = rulesSnap.docs.some(d => {
          const rule = d.data() as MinMaxRule;
          return rule.stokKodu === stokKodu;
        });
        if (hasProduct) {
          labsWithProduct.push({ labId: hospital.id, labName: hospital.name || hospital.id });
        }
      }

      if (labsWithProduct.length === 0) {
        setRiskLabStockData([]);
        setRiskLabModalLoading(false);
        return;
      }

      // Query shipped stock for this product code
      const labNames = labsWithProduct.map(l => l.labName);
      const shippedQuery = query(
        collection(db, 'depoStok'),
        where('stokKodu', '==', stokKodu),
        where('isShipped', '==', true)
      );
      const shippedSnap = await getDocs(shippedQuery);
      const shippedItems = shippedSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));

      // Group by lab → lot → miad
      const labDataMap: Record<string, Array<{ lotNumarasi: string; miad: string; miadDays: number; quantity: number }>> = {};
      for (const lab of labsWithProduct) {
        labDataMap[lab.labId] = [];
      }

      for (const item of shippedItems) {
        const matchedLab = labsWithProduct.find(l => l.labName === item.hedefKurum);
        if (!matchedLab) continue;
        const lot = item.lotNumarasi || '-';
        const miad = typeof item.miad === 'string' ? item.miad : '';
        const existing = labDataMap[matchedLab.labId]?.find(x => x.lotNumarasi === lot && x.miad === miad);
        if (existing) {
          existing.quantity += 1;
        } else {
          const miadInfo = getMiadInfoFromString(miad);
          labDataMap[matchedLab.labId]?.push({ lotNumarasi: lot, miad, miadDays: miadInfo.days, quantity: 1 });
        }
      }

      const result = labsWithProduct.map(lab => ({
        labId: lab.labId,
        labName: lab.labName,
        items: (labDataMap[lab.labId] || []).sort((a, b) => a.miadDays - b.miadDays),
      }));

      setRiskLabStockData(result);
    } catch (e) {
      console.error('Risk lab modal error:', e);
      toast({ title: 'Hata', description: 'Laboratuvar stok bilgisi yüklenemedi.', variant: 'destructive' });
    } finally {
      setRiskLabModalLoading(false);
    }
  }, [hospitals, toast]);

  /* ═════════════════════════ RENDER ═════════════════════════ */
  return (
    <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 min-h-screen">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)] flex items-center gap-2">
            <PackageSearch className="h-5 w-5 text-orange-500" />
            Depo Stoğu
          </h1>
          <p className="text-[11px] sm:text-xs text-[var(--dashboard-muted)] truncate">
            {depotName || 'Depo seçin'} · Depodaki tüm sevk edilmemiş ürünler
          </p>
          {availableDepots.length > 1 && (
            <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
              <SelectTrigger className="w-48 h-8 text-xs mt-1 bg-[var(--dashboard-surface)] border-[var(--dashboard-stroke)]">
                <Warehouse className="h-3.5 w-3.5 mr-1.5 text-orange-500 shrink-0" />
                <SelectValue placeholder="Depo seçin" />
              </SelectTrigger>
              <SelectContent>
                {availableDepots.map(d => (
                  <SelectItem key={d.id} value={d.id!}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Rapor İndir - quick action */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="cihaz-tool-item flex items-center justify-center gap-1.5 px-3 h-9 sm:h-10 text-xs font-medium text-[var(--dashboard-muted)]">
                <FileDown className="h-4 w-4" /> <span className="hidden sm:inline">Rapor</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {showOnlyRiskyStock ? (
                <>
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[var(--dashboard-muted)]">Riskli Stok Raporu</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={handleRiskyExcelExport} disabled={!hasRiskyRows}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" /> Riskli Stok Excel
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleRiskyPdfExport} disabled={!hasRiskyRows}>
                    <FileText className="h-4 w-4 mr-2" /> Riskli Stok PDF (Yatay)
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[var(--dashboard-muted)]">Genel Raporlar</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => handleExport(false)}>
                    <BarChart3 className="h-4 w-4 mr-2" /> Özet Rapor
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleExport(true)}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" /> Detaylı (Seri No) Rapor
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* İşlemler menu - grouped */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="cihaz-tool-item flex items-center justify-center gap-1.5 px-3 h-9 sm:h-10 text-xs font-medium text-[var(--dashboard-muted)]">
                <SlidersHorizontal className="h-4 w-4" /> <span className="hidden sm:inline">İşlemler</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[var(--dashboard-muted)]">Filtre</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setIsFilterDialogOpen(true)}>
                <Filter className="h-4 w-4 mr-2" /> Marka / Ürün Grubu Filtrele
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (!hasRiskyRows) return;
                  setShowOnlyRiskyStock(prev => !prev);
                  setCurrentPage(1);
                }}
                disabled={!hasRiskyRows}
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                {showOnlyRiskyStock ? 'Riskli Stok Gösterimini Kapat' : 'Riskli Stoğu Göster'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[var(--dashboard-muted)]">Operasyon / Sayım</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => router.push('/depo-sayim')}>
                <ListChecks className="h-4 w-4 mr-2" /> Marka Sayımı Başlat
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setIsLabCountModalOpen(true)}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Laboratuvar Sayım Raporu İndir
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[var(--dashboard-muted)]">Araçlar</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setIsNfcQueryModalOpen(true)}>
                <Nfc className="h-4 w-4 mr-2" /> NFC Stok Sorgula
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── ACTIVE FILTER CHIPS ── */}
      {(hasActiveColumnFilters || activeFilters.length > 0 || showOnlyRiskyStock) && (
        <div className="cihaz-card flex flex-wrap items-center gap-2 px-3 py-2">
          {Object.entries(columnFilters).map(([col, vals]: [string, string[]]) =>
            vals.map((v: string) => (
              <span key={`${col}-${v}`} className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 px-2.5 py-0.5 text-[11px] font-medium">
                {v}
                <button onClick={() => handleColumnFilter(col, vals.filter((x: string) => x !== v))} className="hover:bg-orange-200 rounded-full p-0.5"><X className="h-3 w-3" /></button>
              </span>
            ))
          )}
          {activeFilters.map(f => (
            <span key={`${f.group}-${f.value}`} className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2.5 py-0.5 text-[11px] font-medium">
              {f.value}
            </span>
          ))}
          {showOnlyRiskyStock && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-[11px] font-medium">
              ⚠ Riskli stoklar
            </span>
          )}
          <button onClick={() => { clearAllFilters(); setShowOnlyRiskyStock(false); }} className="text-[11px] text-red-500 hover:underline ml-auto">Temizle ✕</button>
        </div>
      )}

      {/* ── TABLE CARD ── */}
      <div className="cihaz-card-strong overflow-hidden">
        {/* Sticky toolbar with summary */}
        <div className="sticky top-0 z-20 bg-[var(--dashboard-surface)] border-b border-[var(--dashboard-stroke)] px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-[var(--dashboard-muted)]">
            <span className="font-medium">Toplam: <span className="text-[var(--dashboard-text)] font-bold">{showOnlyRiskyStock ? riskyRows.length : totalRows}</span> kayıt</span>
            {totalPages > 1 && <span>Sayfa <span className="text-[var(--dashboard-text)] font-bold">{currentPage}</span>/{totalPages}</span>}
          </div>
          <div className="flex items-center gap-3">
            {/* Miad legend */}
            <div className="hidden sm:flex items-center gap-3 text-[10px] text-[var(--dashboard-muted)]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> &lt;45 gün</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> &lt;60 gün</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400" /> Min. Stok</span>
            </div>
          </div>
        </div>

        {/* Table */}
        {(isLoading || isPending) ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--dashboard-muted)]">
            <Loader2 className="h-8 w-8 animate-spin mb-3 text-orange-400" />
            <p className="text-sm">{isLoading ? 'Veriler yükleniyor...' : 'Stok yükleniyor...'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="z-10">
                <tr className="bg-[var(--dashboard-surface-2)]">
                  {/* Color strip spacer */}
                  <th className="w-1.5" />
                  <th className="text-left px-3 py-2.5 sticky left-0 z-20 bg-[var(--dashboard-surface-2)]">
                    <ColumnFilterPopover
                      column="stokAdi" label="Stok Adı" uniqueValues={colValues.stokAdi}
                      selectedValues={columnFilters['stokAdi'] ?? []} onApply={handleColumnFilter}
                      sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
                    />
                  </th>
                  <th className="text-left px-3 py-2.5">
                    <ColumnFilterPopover
                      column="lotNumarasi" label="Lot" uniqueValues={colValues.lotNumarasi}
                      selectedValues={columnFilters['lotNumarasi'] ?? []} onApply={handleColumnFilter}
                      sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
                    />
                  </th>
                  <th className="text-left px-3 py-2.5">
                    <ColumnFilterPopover
                      column="miad" label="Miad" uniqueValues={colValues.miad}
                      selectedValues={columnFilters['miad'] ?? []} onApply={handleColumnFilter}
                      sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
                    />
                  </th>
                  <th className="text-center px-3 py-2.5">
                    <button
                      className="text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-1 mx-auto"
                      onClick={() => handleSort('quantity')}
                    >
                      Adet
                      {sortField === 'quantity' ? (
                        sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  </th>
                  <th className="text-left px-3 py-2.5">
                    <ColumnFilterPopover
                      column="rafAdresi" label="Raf" uniqueValues={colValues.rafAdresi}
                      selectedValues={columnFilters['rafAdresi'] ?? []} onApply={handleColumnFilter}
                      sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
                    />
                  </th>
                  <th className="text-left px-3 py-2.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Yeterlilik</span>
                  </th>
                  <th className="text-right px-3 py-2.5 sticky right-0 z-20 bg-[var(--dashboard-surface-2)]">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">İşlem</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-16 text-[var(--dashboard-muted)]">
                      <PackageSearch className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p>Sonuç bulunamadı.</p>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const miadInfo = getMiadInfo(row.miad);
                    const coverageInfo = getCoverageInfo(row);
                    const stripeColor = getRowStripeColor(row);

                    return (
                      <tr
                        key={row.key}
                        className={cn(
                          "border-b border-[var(--dashboard-stroke)] hover:bg-[var(--dashboard-surface-2)]/50 transition-colors",
                          miadInfo.severity === 'critical' || miadInfo.severity === 'expired' ? 'bg-red-500/[0.04]' : '',
                          miadInfo.severity === 'caution' ? 'bg-amber-500/[0.04]' : '',
                        )}
                      >
                        {/* Color strip */}
                        <td className="w-1.5 p-0">
                          <div className={cn("w-1 h-full min-h-[56px] rounded-r", stripeColor)} />
                        </td>

                        {/* Stok Adı - primary */}
                        <td className="px-3 py-3 sticky left-0 bg-inherit z-10">
                          <div className="font-medium text-[var(--dashboard-text)] leading-tight">{row.stokAdi}</div>
                          <span className="text-[10px] text-[var(--dashboard-muted)] font-mono">({row.stokKodu})</span>
                        </td>

                        {/* Lot - secondary */}
                        <td className="px-3 py-3 text-[var(--dashboard-muted)] text-xs">{row.lotNumarasi}</td>

                        {/* Miad with badge */}
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-[var(--dashboard-text)]">{row.miad}</span>
                            {miadInfo.severity !== 'normal' && miadInfo.days !== Infinity && (
                              <span className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold w-fit",
                                miadInfo.severity === 'expired' && 'bg-red-100 text-red-700',
                                miadInfo.severity === 'critical' && 'bg-red-100 text-red-700',
                                miadInfo.severity === 'warning' && 'bg-orange-100 text-orange-700',
                                miadInfo.severity === 'caution' && 'bg-amber-100 text-amber-700',
                                miadInfo.severity === 'notice' && 'bg-yellow-100 text-yellow-700',
                              )}>
                                {miadInfo.days < 0 ? 'Süresi dolmuş' : `${miadInfo.days} gün kaldı`}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Adet - chip/badge */}
                        <td className="px-3 py-3 text-center">
                          <span className="inline-flex items-center justify-center min-w-[48px] px-2 py-1 rounded-lg bg-[var(--dashboard-surface)] border border-[var(--dashboard-stroke)] shadow-sm text-xs font-bold text-[var(--dashboard-text)]">
                            {row.quantity} {row.anaBirim}
                          </span>
                        </td>

                        {/* Raf */}
                        <td className="px-3 py-3 text-xs text-[var(--dashboard-muted)]">{row.rafAdresi}</td>

                        {/* Stok Yeterlilik - colored badge + risky box count */}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold",
                              coverageInfo.severity === 'good' && 'bg-emerald-100 text-emerald-700',
                              coverageInfo.severity === 'warning' && 'bg-orange-100 text-orange-700',
                              coverageInfo.severity === 'critical' && 'bg-red-100 text-red-700',
                              coverageInfo.severity === 'unknown' && 'bg-slate-100 text-slate-500',
                            )}>
                              {coverageInfo.label}
                            </span>
                            {(() => {
                              const riskyBoxes = getRiskyBoxes(miadInfo, coverageInfo);
                              if (riskyBoxes <= 0) return null;
                              const riskyDays = coverageInfo.coverageDays - miadInfo.days;
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleOpenRiskLabModal(row.stokKodu, row.stokAdi, riskyBoxes); }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 hover:shadow-sm active:scale-95 transition-all cursor-pointer"
                                  title={`Miad ${miadInfo.days} gün sonra dolacak, ${riskyDays} günlük stok (${riskyBoxes} kutu) risk altında — Laboratuvar detayı için tıklayın`}
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  {riskyBoxes} kutu riskli
                                </button>
                              );
                            })()}
                          </div>
                        </td>

                        {/* İşlemler - sticky right */}
                        <td className="px-3 py-3 text-right sticky right-0 bg-inherit z-10">
                          <button
                            className="cihaz-tool-item inline-flex items-center justify-center gap-1 px-2.5 h-8 text-[11px] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
                            onClick={() => router.push(`/stok-yonetimi/${selectedDepotId}/${encodeURIComponent(row.stokKodu)}/${encodeURIComponent(row.lotNumarasi || '')}`)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span className="hidden md:inline">Detay</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── PAGINATION BAR ── */}
        {totalRows > 0 && (
          <div className="sticky bottom-0 bg-[var(--dashboard-surface)] border-t border-[var(--dashboard-stroke)] px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-[var(--dashboard-muted)]">
              <span>Sayfa başına:</span>
              <Select value={String(rowsPerPage)} onValueChange={v => { setRowsPerPage(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-16 h-7 text-xs bg-[var(--dashboard-surface)] border-[var(--dashboard-stroke)]"><SelectValue /></SelectTrigger>
                <SelectContent>{rowsPerPageOptions.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                className="cihaz-tool-item flex items-center justify-center w-8 h-8 disabled:opacity-40"
                onClick={() => setCurrentPage(p => p - 1)}
                disabled={currentPage <= 1 || isPending}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-[var(--dashboard-muted)] px-2">
                <span className="text-[var(--dashboard-text)] font-bold">{currentPage}</span> / {totalPages}
              </span>
              <button
                className="cihaz-tool-item flex items-center justify-center w-8 h-8 disabled:opacity-40"
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage >= totalPages || isPending}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── DIALOGS ── */}
      <FiltreDialog
        isOpen={isFilterDialogOpen}
        onClose={() => setIsFilterDialogOpen(false)}
        availableGroups={availableFilterGroups}
        onApply={setActiveFilters}
      />
      <NfcStockQueryModal
        isOpen={isNfcQueryModalOpen}
        onClose={() => setIsNfcQueryModalOpen(false)}
        productCodes={productCodes}
        deviceGroups={[]}
        allStock={rawDepotStock}
      />
      <Dialog open={isLabCountModalOpen} onOpenChange={setIsLabCountModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Laboratuvar Sayım Raporu</DialogTitle>
            <DialogDescription>Stoklarını birleşik olarak görmek istediğiniz laboratuvarları seçin.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ScrollArea className="h-64 border rounded-md p-2">
              {hospitals.filter(lab => lab.id !== undefined).map(lab => (
                <div key={lab.id} className="flex items-center space-x-2 p-1">
                  <Checkbox
                    id={`lab-select-${lab.id}`}
                    checked={lab.id ? selectedLabsForReport.includes(lab.id) : false}
                    onCheckedChange={(checked) => {
                      if (!lab.id) return;
                      setSelectedLabsForReport(prev => checked ? [...prev, lab.id!] : prev.filter(id => id !== lab.id));
                    }}
                  />
                  <Label htmlFor={`lab-select-${lab.id}`}>{lab.name}</Label>
                </div>
              ))}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLabCountModalOpen(false)}>İptal</Button>
            <Button onClick={handleLabCountExport} disabled={selectedLabsForReport.length === 0}>Rapor Oluştur</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── RISK LAB STOCK MODAL ── */}
      <Dialog open={isRiskLabModalOpen} onOpenChange={setIsRiskLabModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Riskli Stok — Laboratuvar Dağılımı
            </DialogTitle>
            {riskLabModalProduct && (
              <DialogDescription>
                <span className="font-semibold text-[var(--dashboard-text)]">{riskLabModalProduct.stokAdi}</span>
                <span className="text-[var(--dashboard-muted)] ml-1">({riskLabModalProduct.stokKodu})</span>
                <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                  <AlertTriangle className="h-3 w-3" />
                  {riskLabModalProduct.riskyBoxes} kutu riskli
                </span>
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-auto py-3 space-y-3">
            {riskLabModalLoading ? (
              <div className="flex items-center justify-center py-12 text-[var(--dashboard-muted)]">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Laboratuvar stokları yükleniyor...
              </div>
            ) : riskLabStockData.length === 0 ? (
              <div className="text-center py-12 text-[var(--dashboard-muted)]">
                <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Bu ürün herhangi bir laboratuvara tanımlı değil.</p>
              </div>
            ) : (
              riskLabStockData.map((lab) => {
                const totalQty = lab.items.reduce((s, i) => s + i.quantity, 0);
                return (
                  <div key={lab.labId} className="rounded-lg border border-[var(--dashboard-stroke)] overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-[var(--dashboard-surface-2)]">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-3.5 w-3.5 text-[var(--dashboard-muted)]" />
                        <span className="text-sm font-semibold text-[var(--dashboard-text)]">{lab.labName}</span>
                      </div>
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold",
                        totalQty > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                      )}>
                        {totalQty > 0 ? `${totalQty} kutu` : 'Stok yok'}
                      </span>
                    </div>
                    {lab.items.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[var(--dashboard-stroke)] text-[var(--dashboard-muted)]">
                            <th className="px-3 py-1.5 text-left font-medium">Lot</th>
                            <th className="px-3 py-1.5 text-left font-medium">Miad</th>
                            <th className="px-3 py-1.5 text-center font-medium">Adet</th>
                            <th className="px-3 py-1.5 text-right font-medium">Durum</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lab.items.map((item, idx) => {
                            const itemMiadInfo = getMiadInfoFromString(item.miad);
                            return (
                              <tr key={`${item.lotNumarasi}-${item.miad}-${idx}`} className="border-b border-[var(--dashboard-stroke)] last:border-0">
                                <td className="px-3 py-1.5 font-mono text-[var(--dashboard-muted)]">{item.lotNumarasi}</td>
                                <td className="px-3 py-1.5 text-[var(--dashboard-text)]">{item.miad || '-'}</td>
                                <td className="px-3 py-1.5 text-center font-bold text-[var(--dashboard-text)]">{item.quantity}</td>
                                <td className="px-3 py-1.5 text-right">
                                  <span className={cn(
                                    "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold",
                                    itemMiadInfo.severity === 'expired' && 'bg-red-100 text-red-700',
                                    itemMiadInfo.severity === 'critical' && 'bg-red-100 text-red-700',
                                    itemMiadInfo.severity === 'warning' && 'bg-orange-100 text-orange-700',
                                    itemMiadInfo.severity === 'caution' && 'bg-amber-100 text-amber-700',
                                    itemMiadInfo.severity === 'notice' && 'bg-yellow-100 text-yellow-700',
                                    itemMiadInfo.severity === 'normal' && 'bg-emerald-100 text-emerald-700',
                                  )}>
                                    {itemMiadInfo.days < 0 ? 'Süresi dolmuş' : itemMiadInfo.days === Infinity ? '-' : `${itemMiadInfo.days} gün`}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="px-3 py-3 text-center text-[var(--dashboard-muted)] text-xs">
                        Bu laboratuvarda stok bulunmuyor
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRiskLabModalOpen(false)}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
