
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
import { collection, getDocs, getDoc, query, where, writeBatch, doc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  PackageSearch, Warehouse, FileSpreadsheet, Loader2,
  SlidersHorizontal, X, Filter, Nfc, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, MoreHorizontal, Eye,
  FileDown, ListChecks, BarChart3, ChevronsUpDown, FileText,
  AlertTriangle, FlaskConical, ShieldCheck, TrendingUp, ArrowRight,
  CheckCircle2, XCircle, Send, ClipboardPlus, History,
} from 'lucide-react';
import { exportDataToExcel } from '@/lib/utils';
import { differenceInDays, parse, isValid, compareAsc } from 'date-fns';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { Badge } from './ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';
import NfcStockQueryModal from './NfcStockQueryModal';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type GroupedStockRow, type PaginatedStockResult } from '@/actions/stokActions';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { resolveDefaultTrackingMode } from '@/lib/tracking';
import { calculateTransferSuggestions, distributeRiskyBoxes, type TransferSuggestion, type LabStockInfo } from '@/lib/rescue-transfer';
import { createNotification } from '@/lib/notifications';
import {
  touchStockMetadata,
  useDepots,
  useProductCodes,
  useHospitals,
  useDepotMinMaxRules,
  usePaginatedDepotStock,
  useUnshippedDepoStokByDepot,
} from '@/hooks/useFirebaseQueries';

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
type ColumnFilterOption = { value: string; secondary?: string };

function ColumnFilterPopover({
  column,
  label,
  uniqueValues,
  selectedValues,
  onApply,
  sortField,
  sortDirection,
  onSort,
  searchPlaceholder,
  triggerStyle = 'header',
}: {
  column: string;
  label: string;
  /** Accepts plain strings or `{value, secondary}` objects. The `secondary`
   *  field (e.g. stok kodu) is rendered beside the value and is searchable. */
  uniqueValues: ReadonlyArray<string | ColumnFilterOption>;
  selectedValues: string[];
  onApply: (column: string, values: string[]) => void;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  onSort: (field: string) => void;
  searchPlaceholder?: string;
  /** `header` renders the trigger as an uppercase column header with sort
   *  indicators (default). `pill` renders a small toolbar button. */
  triggerStyle?: 'header' | 'pill';
}) {
  const [open, setOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState<string[]>(selectedValues);
  const [filterText, setFilterText] = useState('');
  const isActive = selectedValues.length > 0;
  const isSorted = sortField === column;

  useEffect(() => {
    if (open) {
      setLocalSelected(selectedValues);
      setFilterText('');
    }
  }, [open, selectedValues]);

  // Normalize the incoming options to a uniform shape so the rest of the
  // component does not need to branch on the input type.
  const options = useMemo<ColumnFilterOption[]>(
    () =>
      uniqueValues.map((v) =>
        typeof v === 'string' ? { value: v } : { value: v.value, secondary: v.secondary },
      ),
    [uniqueValues],
  );

  const normalizedFilter = filterText.trim().toLocaleLowerCase('tr');
  const filteredOptions = normalizedFilter
    ? options.filter((o) => {
        const inValue = o.value.toLocaleLowerCase('tr').includes(normalizedFilter);
        const inSecondary = o.secondary
          ? o.secondary.toLocaleLowerCase('tr').includes(normalizedFilter)
          : false;
        return inValue || inSecondary;
      })
    : options;

  // Excel-like behavior: "Select All" / "Clear" affect only the currently
  // visible (filtered) items, preserving selections outside the filter.
  const filteredValuesSet = useMemo(
    () => new Set(filteredOptions.map((o) => o.value)),
    [filteredOptions],
  );
  const selectAllFiltered = () => {
    setLocalSelected((prev) => {
      const next = new Set(prev);
      filteredOptions.forEach((o) => next.add(o.value));
      return Array.from(next);
    });
  };
  const clearFiltered = () => {
    setLocalSelected((prev) => prev.filter((v) => !filteredValuesSet.has(v)));
  };

  const filteredSelectedCount = filteredOptions.reduce(
    (acc, o) => acc + (localSelected.includes(o.value) ? 1 : 0),
    0,
  );
  const allFilteredSelected =
    filteredOptions.length > 0 && filteredSelectedCount === filteredOptions.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {triggerStyle === 'pill' ? (
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              isActive
                ? "bg-orange-500/15 border-orange-500/40 text-orange-600 hover:bg-orange-500/25"
                : "bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--dashboard-surface)]",
            )}
          >
            <Filter className="h-3 w-3" />
            {label}
            {isActive && (
              <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] text-white font-bold">
                {selectedValues.length}
              </span>
            )}
          </button>
        ) : (
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
        )}
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0 bg-[var(--dashboard-surface)] border border-[var(--dashboard-stroke)] text-[var(--dashboard-text)] shadow-lg"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Sort buttons (omitted when the filter is not bound to a sortable column) */}
        {triggerStyle === 'header' && (
          <div className="flex border-b border-[var(--dashboard-stroke)]">
            <button
              type="button"
              className={cn(
                "flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs transition-colors hover:bg-[var(--dashboard-surface-2)]",
                isSorted && sortDirection === 'asc' && "bg-[var(--dashboard-surface-2)] font-semibold text-orange-600",
              )}
              onClick={() => { onSort(column); setOpen(false); }}
            >
              <ChevronUp className="h-3 w-3" /> A→Z
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs transition-colors border-l border-[var(--dashboard-stroke)] hover:bg-[var(--dashboard-surface-2)]",
                isSorted && sortDirection === 'desc' && "bg-[var(--dashboard-surface-2)] font-semibold text-orange-600",
              )}
              onClick={() => { onSort(column); setOpen(false); }}
            >
              <ChevronDown className="h-3 w-3" /> Z→A
            </button>
          </div>
        )}
        {/* Filter search */}
        <div className="p-2 border-b border-[var(--dashboard-stroke)]">
          <Input
            placeholder={searchPlaceholder ?? 'Filtrele...'}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="h-7 text-xs bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)]"
          />
        </div>
        {/* Select all / Clear (applies to the filtered subset) */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--dashboard-stroke)]">
          <label
            className={cn(
              "flex items-center gap-2 text-[10px] font-medium cursor-pointer select-none",
              filteredOptions.length === 0
                ? "text-[var(--dashboard-muted)] opacity-50 cursor-not-allowed"
                : "text-[var(--dashboard-text)]",
            )}
          >
            <Checkbox
              checked={
                allFilteredSelected
                  ? true
                  : filteredSelectedCount > 0
                    ? 'indeterminate'
                    : false
              }
              onCheckedChange={(checked) => {
                if (filteredOptions.length === 0) return;
                if (checked) selectAllFiltered();
                else clearFiltered();
              }}
              disabled={filteredOptions.length === 0}
              className="h-3.5 w-3.5"
            />
            Tümünü Seç
            {normalizedFilter && filteredOptions.length > 0 && (
              <span className="text-[var(--dashboard-muted)]">({filteredOptions.length})</span>
            )}
          </label>
          <button
            type="button"
            className="text-[10px] text-red-500 hover:underline disabled:opacity-50 disabled:no-underline"
            onClick={clearFiltered}
            disabled={filteredSelectedCount === 0}
          >
            Temizle
          </button>
        </div>
        {/* Values list — native scroll for reliable wheel events inside the Popover */}
        <div
          className="max-h-56 overflow-y-auto overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="p-1">
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-3 text-xs text-[var(--dashboard-muted)] text-center">Sonuç yok</p>
            ) : (
              filteredOptions.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--dashboard-surface-2)] cursor-pointer"
                >
                  <Checkbox
                    checked={localSelected.includes(opt.value)}
                    onCheckedChange={(checked) => {
                      setLocalSelected((prev) =>
                        checked ? [...prev, opt.value] : prev.filter((v) => v !== opt.value),
                      );
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[var(--dashboard-text)]">
                      {opt.value || '(Boş)'}
                    </div>
                    {opt.secondary && (
                      <div className="truncate font-mono text-[9px] text-[var(--dashboard-muted)]">
                        {opt.secondary}
                      </div>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
        </div>
        {/* Apply */}
        <div className="border-t border-[var(--dashboard-stroke)] p-2 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-xs"
            onClick={() => { onApply(column, []); setOpen(false); }}
          >
            Sıfırla
          </Button>
          <Button
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={() => { onApply(column, localSelected); setOpen(false); }}
          >
            Uygula
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ────────────────────────────────────────────
   Severity Quick-Filter Chip
   Renders the miad-coverage legend as a clickable toggle that drives the
   `miadSeverity` / `belowMin` server filter. Active state mirrors the row
   stripe colour so the legend stays self-describing.
   ──────────────────────────────────────────── */
function SeverityChip({
  color,
  label,
  active,
  onClick,
}: {
  color: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
        active
          ? "bg-orange-500/15 border-orange-500/40 text-orange-600 shadow-sm"
          : "bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--dashboard-surface)]",
      )}
    >
      <span className={cn("w-2 h-2 rounded-full", color)} />
      {label}
    </button>
  );
}

/* ────────────────────────────────────────────
   Active filter chip labels
   The active filter row consumes `columnFilters` directly. Most keys hold
   plain values that are fine to show as-is, but `miadSeverity` and
   `belowMin` carry technical strings (e.g. "expired", "true") that need
   friendly Turkish labels and a clearable group chip.
   ──────────────────────────────────────────── */
const MIAD_SEVERITY_CHIP_LABEL: Record<string, string> = {
  expired: 'Süresi Geçmiş',
  critical: 'Kritik (≤3 gün)',
  warning: 'Uyarı (≤10 gün)',
  caution: 'Dikkat (<45 gün)',
  notice: 'Bilgi (<60 gün)',
};

function renderActiveFilterChips(
  col: string,
  vals: string[],
  handleColumnFilter: (col: string, values: string[]) => void,
) {
  // belowMin renders as a single boolean chip rather than per-value chips.
  if (col === 'belowMin') {
    if (!vals.includes('true')) return null;
    return (
      <span
        key="belowMin"
        className="inline-flex items-center gap-1 rounded-full bg-slate-200 text-slate-700 px-2.5 py-0.5 text-[11px] font-medium"
      >
        Min. Stok
        <button
          onClick={() => handleColumnFilter('belowMin', [])}
          className="hover:bg-slate-300 rounded-full p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return vals.map((v: string) => {
    const label =
      col === 'miadSeverity' ? (MIAD_SEVERITY_CHIP_LABEL[v] ?? v) : v;
    return (
      <span
        key={`${col}-${v}`}
        className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 px-2.5 py-0.5 text-[11px] font-medium"
      >
        {label}
        <button
          onClick={() =>
            handleColumnFilter(
              col,
              vals.filter((x: string) => x !== v),
            )
          }
          className="hover:bg-orange-200 rounded-full p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  });
}

/* ────────────────────────────────────────────
   Stok Yonetimi Panel – Main Component
   ──────────────────────────────────────────── */
export default function StokYonetimiPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  // Master data — TanStack Query backed (cache shared across panels & navigations)
  const depotsQuery = useDepots();
  const productCodesQuery = useProductCodes();
  const hospitalsQuery = useHospitals();
  const depots = useMemo(() => depotsQuery.data ?? [], [depotsQuery.data]);
  const productCodes = useMemo(() => productCodesQuery.data ?? [], [productCodesQuery.data]);
  const hospitals = useMemo(() => hospitalsQuery.data ?? [], [hospitalsQuery.data]);
  const isLoading =
    depotsQuery.isLoading || productCodesQuery.isLoading || hospitalsQuery.isLoading;

  const [selectedDepotId, setSelectedDepotId] = useState<string>('');

  // Min/max rules for the selected depot — cached, keyed by depotId
  const minMaxRulesQuery = useDepotMinMaxRules(selectedDepotId || null);
  const minMaxRules = useMemo(() => minMaxRulesQuery.data ?? {}, [minMaxRulesQuery.data]);

  // Server-side pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const rowsPerPageOptions = [20, 30, 50, 100];
  const [sortField, setSortField] = useState('miad');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});

  // Dialogs
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [isNfcQueryModalOpen, setIsNfcQueryModalOpen] = useState(false);
  const [isLabCountModalOpen, setIsLabCountModalOpen] = useState(false);
  const [selectedLabsForReport, setSelectedLabsForReport] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<FilterSpec[]>([]);
  const [showOnlyRiskyStock, setShowOnlyRiskyStock] = useState(false);
  // Rescue transfer modal
  const [isRescueModalOpen, setIsRescueModalOpen] = useState(false);
  const [rescueProduct, setRescueProduct] = useState<{ stokKodu: string; stokAdi: string; riskyBoxes: number; miadDays: number; miad: string } | null>(null);
  const [rescueLoading, setRescueLoading] = useState(false);
  const [rescueSuggestions, setRescueSuggestions] = useState<TransferSuggestion[]>([]);
  const [rescueTransferring, setRescueTransferring] = useState(false);
  // Bulk rescue modal
  const [isBulkRescueModalOpen, setIsBulkRescueModalOpen] = useState(false);
  const [bulkRescueLoading, setBulkRescueLoading] = useState(false);
  const [bulkRescuePlans, setBulkRescuePlans] = useState<Array<{ stokKodu: string; stokAdi: string; riskyBoxes: number; miadDays: number; miad: string; rescuable: number; suggestions: TransferSuggestion[] }>>([]);

  // ─── Server-side paginated table data ───
  // Only the rows for the active page travel down the wire (full payload was
  // previously the depot's entire un-shipped stock = potentially 100K+ docs).
  // Risk metadata (miadDays, coverageDays, riskyBoxes, severities) is computed
  // server-side; the client just paints the cells.
  const paginatedQuery = usePaginatedDepotStock({
    depotId: selectedDepotId || null,
    page: currentPage,
    pageSize: rowsPerPage,
    sortField,
    sortDirection,
    columnFilters,
    riskyOnly: showOnlyRiskyStock,
  });

  // Ceomed entegre depo seçilince son senkronizasyon diff'ini toast olarak göster.
  useEffect(() => {
    if (!selectedDepotId) return;
    const depot = depots.find((d) => d.id === selectedDepotId) as any;
    if (!depot?.ceomedEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const { doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('@/lib/firebase');
        const snap = await getDoc(doc(db, 'ceomedDepoStok', selectedDepotId));
        if (cancelled || !snap.exists()) return;
        const data = snap.data() as any;
        const diff = (data.lastDiff || []) as Array<{ change: number }>;
        const seenKey = `ceomedDiffSeen:${selectedDepotId}:${data.syncedAt?.seconds || ''}`;
        if (diff.length === 0 || typeof window === 'undefined' || sessionStorage.getItem(seenKey)) return;
        const inc = diff.filter((d) => d.change > 0);
        const dec = diff.filter((d) => d.change < 0);
        const totalIn = inc.reduce((s, d) => s + d.change, 0);
        const totalOut = dec.reduce((s, d) => s + Math.abs(d.change), 0);
        toast({
          title: 'Ceomed güncellemesi',
          description: `${diff.length} hareket: +${inc.length} kalem (${totalIn} adet giriş), -${dec.length} kalem (${totalOut} adet çıkış).`,
        });
        sessionStorage.setItem(seenKey, '1');
      } catch (e) {
        console.error('ceomed diff toast error', e);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDepotId, depots, toast]);

  const paginatedRows = useMemo(
    () => (paginatedQuery.data?.rows ?? []) as GroupedStockRow[],
    [paginatedQuery.data],
  );
  const paginatedTotalRows = paginatedQuery.data?.totalRows ?? 0;
  const paginatedTotalPages = paginatedQuery.data?.totalPages ?? 1;
  const paginatedColumnValues: PaginatedStockResult['columnValues'] =
    paginatedQuery.data?.columnValues ?? { stokAdi: [], lotNumarasi: [], miad: [], rafAdresi: [], marka: [] };
  const riskyRowsCount = paginatedQuery.data?.riskyRowsCount ?? 0;

  // ─── Lazy full-stock fetch (on-demand) ───
  // Required for NFC modal, bulk rescue and lab-stock report which scan the
  // entire depot. Disabled by default; enabled only when the consumer opens.
  // Single shared cache key — cost is paid at most once per depot/session.
  const needsFullStock = isNfcQueryModalOpen || isBulkRescueModalOpen || isLabCountModalOpen;
  const depotStockQuery = useUnshippedDepoStokByDepot(needsFullStock ? (selectedDepotId || null) : null);
  const rawDepotStock = useMemo(() => depotStockQuery.data ?? [], [depotStockQuery.data]);
  const isStockLoading = !!selectedDepotId && paginatedQuery.isLoading;

  // Auto-pick first operational depot once depots are available
  useEffect(() => {
    if (selectedDepotId) return;
    if (depots.length === 0) return;
    const operationalDepots = filterOperationalSourceDepots(depots, currentUserProfile);
    if (operationalDepots.length > 0 && operationalDepots[0]?.id) {
      setSelectedDepotId(operationalDepots[0].id);
    }
  }, [depots, selectedDepotId, currentUserProfile]);

  // Surface fetch errors via toast (TanStack Query handles retry; we just notify on final error).
  useEffect(() => {
    if (depotsQuery.isError || productCodesQuery.isError || hospitalsQuery.isError) {
      toast({ title: 'Veri Yükleme Hatası', description: 'Ana veriler yüklenemedi.', variant: 'destructive' });
    }
  }, [depotsQuery.isError, productCodesQuery.isError, hospitalsQuery.isError, toast]);

  useEffect(() => {
    if (paginatedQuery.isError) {
      toast({ title: 'Hata', description: 'Stok verileri yüklenemedi.', variant: 'destructive' });
    }
  }, [paginatedQuery.isError, toast]);

  // Lazy-loaded full-stock surface (only when NFC / bulk rescue / lab-count modals open)
  useEffect(() => {
    if (depotStockQuery.isError) {
      toast({ title: 'Hata', description: 'Tam stok verisi yüklenemedi.', variant: 'destructive' });
    }
  }, [depotStockQuery.isError, toast]);

  // Reset to page 1 when the active depot changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDepotId]);


  /* ─── Server-side filtering, sorting and pagination outputs ───
     The server action does the heavy lifting (group + filter + risky + sort +
     paginate). We just unpack the response into the variable names the rest of
     the component already references. */
  const rows = paginatedRows;
  const totalRows = paginatedTotalRows;
  const totalPages = paginatedTotalPages;
  const colValues = paginatedColumnValues;

  // Adapt the server's {value, code} payload to the ColumnFilterPopover's
  // {value, secondary} option shape. The stok kodu is rendered beside the
  // product name and is included in the search match.
  const stokAdiOptionsForFilter = useMemo(
    () => colValues.stokAdi.map((o) => ({ value: o.value, secondary: o.code })),
    [colValues.stokAdi],
  );

  // Filter out pool warehouses for the depot selector
  const availableDepots = useMemo(
    () => filterOperationalSourceDepots(depots, currentUserProfile),
    [depots, currentUserProfile]
  );
  const depotName = depots.find(d => d.id === selectedDepotId)?.name || '';
  const isPending = isStockLoading || paginatedQuery.isFetching;

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

  /* ─── Severity chip filters (legend → clickable filters) ───
     Each chip toggles a coherent group of `miadSeverity` values (or the
     `belowMin` flag) in the column filter state, so chips compose with the
     existing column-header filters and the active-filter chip row. */
  const SEVERITY_GROUPS = {
    expired: ['expired'] as const,
    urgent: ['critical', 'warning', 'caution'] as const, // < 45 days (excluding already expired)
    soon: ['notice'] as const,                            // 45–60 days
  };

  const toggleMiadSeverityGroup = (group: keyof typeof SEVERITY_GROUPS) => {
    const severities = SEVERITY_GROUPS[group] as readonly string[];
    setColumnFilters((prev) => {
      const next = { ...prev };
      const current = next['miadSeverity'] ?? [];
      const allActive = severities.every((s) => current.includes(s));
      const remaining = current.filter((s) => !severities.includes(s));
      const merged = allActive
        ? remaining
        : Array.from(new Set([...remaining, ...severities]));
      if (merged.length === 0) delete next['miadSeverity'];
      else next['miadSeverity'] = merged;
      return next;
    });
    setCurrentPage(1);
  };

  const toggleBelowMin = () => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      const isOn = (next['belowMin'] ?? []).includes('true');
      if (isOn) delete next['belowMin'];
      else next['belowMin'] = ['true'];
      return next;
    });
    setCurrentPage(1);
  };

  const isMiadSeverityGroupActive = (group: keyof typeof SEVERITY_GROUPS) => {
    const severities = SEVERITY_GROUPS[group] as readonly string[];
    const current = columnFilters['miadSeverity'] ?? [];
    return severities.every((s) => current.includes(s));
  };
  const isBelowMinActive = (columnFilters['belowMin'] ?? []).includes('true');

  /* ─── Risk metadata accessors ───
     Prefer server-computed metadata on the row; fall back to client-side
     calculation for surfaces (NFC modal, rescue) that still ship raw rows. */
  const getMiadInfo = (rowOrStr: GroupedStockRow | string): { days: number; severity: MiadSeverity } => {
    if (typeof rowOrStr === 'string') return getMiadInfoFromString(rowOrStr);
    if (rowOrStr.miadSeverity !== undefined) {
      return {
        days: rowOrStr.miadDays ?? Number.POSITIVE_INFINITY,
        severity: rowOrStr.miadSeverity,
      };
    }
    return getMiadInfoFromString(rowOrStr.miad);
  };

  const getCoverageInfo = (row: GroupedStockRow): { label: string; severity: 'good' | 'warning' | 'critical' | 'unknown'; coverageDays: number; dailyNeed: number } => {
    if (row.coverageSeverity !== undefined) {
      return {
        label: row.coverageLabel ?? 'Hesaplanamadı',
        severity: row.coverageSeverity,
        coverageDays: row.coverageDays ?? 0,
        dailyNeed: row.dailyNeed ?? 0,
      };
    }
    return getCoverageInfoForRow(row, minMaxRules, lotTrackedStockCodes, []);
  };

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

  /** True when at least one grouped row in the depot has riskyBoxes > 0.
   *  Sourced from the server action so we don't need the full dataset client-side. */
  const hasRiskyRows = riskyRowsCount > 0;

  /* ─── Row color strip ─── */
  const getRowStripeColor = (row: GroupedStockRow): string => {
    const miadInfo = getMiadInfo(row);
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
      const allItems = filterByCompanyScope(
        snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
        currentCompanyId,
        isSuperAdmin,
      );
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

  /**
   * Pull every risky row for the current depot from the server in a single
   * call. Used by the Excel/PDF export and bulk rescue handlers — none of
   * which can rely on the paginated table view.
   */
  const fetchAllRiskyRows = useCallback(async (): Promise<Array<{
    row: GroupedStockRow;
    miadInfo: { days: number; severity: MiadSeverity };
    coverageInfo: { label: string; severity: 'good' | 'warning' | 'critical' | 'unknown'; coverageDays: number; dailyNeed: number };
    riskyBoxes: number;
  }>> => {
    if (!selectedDepotId) return [];
    const { getPaginatedDepotStock } = await import('@/actions/stokActions');
    const result = await getPaginatedDepotStock({
      depotId: selectedDepotId,
      page: 1,
      pageSize: 1_000_000,
      sortField: 'miad',
      sortDirection: 'asc',
      riskyOnly: true,
      companyId: currentCompanyId,
      isSuperAdmin,
    });
    return result.rows.map((row) => ({
      row,
      miadInfo: {
        days: row.miadDays ?? Number.POSITIVE_INFINITY,
        severity: (row.miadSeverity ?? 'normal') as MiadSeverity,
      },
      coverageInfo: {
        label: row.coverageLabel ?? '',
        severity: (row.coverageSeverity ?? 'unknown') as 'good' | 'warning' | 'critical' | 'unknown',
        coverageDays: row.coverageDays ?? 0,
        dailyNeed: row.dailyNeed ?? 0,
      },
      riskyBoxes: row.riskyBoxes ?? 0,
    }));
  }, [selectedDepotId, currentCompanyId, isSuperAdmin]);

  const handleRiskyExcelExport = async () => {
    const riskyExportRows = await fetchAllRiskyRows();
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
      const riskyExportRows = await fetchAllRiskyRows();
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
      // Sadece seçili labların stoğunu çek — Firestore `in` query (max 30 lab/seferinde).
      // Composite index: (companyId, isShipped, hedefKurumId).
      const labIdChunks: string[][] = [];
      for (let i = 0; i < selectedLabsForReport.length; i += 30) {
        labIdChunks.push(selectedLabsForReport.slice(i, i + 30));
      }
      const stockForSelectedLabsRaw: DepoStokItem[] = [];
      for (const chunk of labIdChunks) {
        const q = scopedQuery(
          'depoStok',
          currentCompanyId,
          isSuperAdmin,
          where('isShipped', '==', true),
          where('hedefKurumId', 'in', chunk),
        );
        const snap = await getDocs(q);
        snap.docs.forEach(d => stockForSelectedLabsRaw.push({ id: d.id, ...d.data() } as DepoStokItem));
      }
      // Legacy (hedefKurumId yoksa hedefKurum adı ile eşleşenler).
      if (labNames.length > 0) {
        const nameChunks: string[][] = [];
        for (let i = 0; i < labNames.length; i += 30) {
          nameChunks.push(labNames.slice(i, i + 30));
        }
        for (const chunk of nameChunks) {
          const q = scopedQuery(
            'depoStok',
            currentCompanyId,
            isSuperAdmin,
            where('isShipped', '==', true),
            where('hedefKurum', 'in', chunk),
          );
          const snap = await getDocs(q);
          snap.docs.forEach(d => {
            const data = d.data() as DepoStokItem;
            // hedefKurumId varsa zaten ilk chunk'tan geldi; sadece legacy doc'ları dahil et.
            if (!data.hedefKurumId) {
              stockForSelectedLabsRaw.push({ id: d.id, ...data });
            }
          });
        }
      }
      const stockForSelectedLabs = filterByCompanyScope(stockForSelectedLabsRaw, currentCompanyId, isSuperAdmin);
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

  /* ─── Fetch lab stock info for a product ─── */
  const fetchLabStockInfoForProduct = useCallback(async (stokKodu: string): Promise<LabStockInfo[]> => {
    const labStocks: LabStockInfo[] = [];

    // Find which hospitals have this product in their minMaxRules
    const labRulesPromises = hospitals.filter(h => h.id).map(async (hospital) => {
      const rulesSnap = await getDocs(collection(db, 'hospitals', hospital.id, 'minMaxRules'));
      const rule = rulesSnap.docs.find(d => (d.data() as MinMaxRule).stokKodu === stokKodu);
      if (rule) {
        return { labId: hospital.id, labName: hospital.name || hospital.id, rule: rule.data() as MinMaxRule };
      }
      return null;
    });

    const labRulesResults = (await Promise.all(labRulesPromises)).filter(Boolean) as Array<{ labId: string; labName: string; rule: MinMaxRule }>;

    if (labRulesResults.length === 0) return [];

    // Query shipped stock for this product
    const shippedQuery = query(
      collection(db, 'depoStok'),
      where('stokKodu', '==', stokKodu),
      where('isShipped', '==', true)
    );
    const shippedSnap = await getDocs(shippedQuery);
    const shippedItems = filterByCompanyScope(
      shippedSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
      currentCompanyId,
      isSuperAdmin,
    );

    for (const labRule of labRulesResults) {
      const labItems = shippedItems.filter(item =>
        item.hedefKurum === labRule.labName || item.hedefKurumId === labRule.labId
      );

      // Group by lot+miad
      const entries: Array<{ lotNumarasi: string; miad: string; miadDays: number; quantity: number }> = [];
      for (const item of labItems) {
        const lot = item.lotNumarasi || '-';
        const miad = typeof item.miad === 'string' ? item.miad : '';
        const existing = entries.find(x => x.lotNumarasi === lot && x.miad === miad);
        if (existing) {
          existing.quantity += 1;
        } else {
          entries.push({ lotNumarasi: lot, miad, miadDays: getMiadInfoFromString(miad).days, quantity: 1 });
        }
      }

      const currentStock = labItems.length;
      const maxStock = labRule.rule.max || 0;
      const maxGun = labRule.rule.maxGun || 0;
      const dailyNeed = maxGun > 0 ? maxStock / maxGun : 0;
      const minMiadDays = entries.length > 0
        ? Math.min(...entries.map(e => e.miadDays))
        : Infinity;

      // Ort. tüketim süresini gün cinsine çevir (saat ise /24)
      const rawSuresi = labRule.rule.ortalamaTuketimSuresi;
      const birim = labRule.rule.tuketimSuresiBirimi ?? 'gun';
      const avgConsumptionDays = rawSuresi && rawSuresi > 0
        ? (birim === 'saat' ? rawSuresi / 24 : rawSuresi)
        : undefined;

      labStocks.push({
        labId: labRule.labId,
        labName: labRule.labName,
        currentStock,
        maxStock,
        maxGun,
        dailyNeed,
        deficit: Math.max(0, maxStock - currentStock),
        minMiadDays,
        items: entries.sort((a, b) => a.miadDays - b.miadDays),
        avgConsumptionDays,
      });
    }

    return labStocks;
  }, [hospitals, currentCompanyId, isSuperAdmin]);

  /* ─── Open rescue modal for a single product ─── */
  const handleOpenRescueModal = useCallback(async (stokKodu: string, stokAdi: string, riskyBoxes: number, miadDays: number, miad: string) => {
    setRescueProduct({ stokKodu, stokAdi, riskyBoxes, miadDays, miad });
    setIsRescueModalOpen(true);
    setRescueLoading(true);
    setRescueSuggestions([]);

    try {
      const labStocks = await fetchLabStockInfoForProduct(stokKodu);

      if (labStocks.length === 0) {
        setRescueSuggestions([]);
      } else {
        const suggestions = calculateTransferSuggestions(riskyBoxes, miadDays, labStocks);
        const distributed = distributeRiskyBoxes(riskyBoxes, suggestions);
        setRescueSuggestions(distributed);
      }
    } catch (e) {
      console.error('Rescue modal error:', e);
      toast({ title: 'Hata', description: 'Laboratuvar stok bilgisi yüklenemedi.', variant: 'destructive' });
    } finally {
      setRescueLoading(false);
    }
  }, [fetchLabStockInfoForProduct, toast]);

  /* ─── Execute rescue transfer ─── */
  const handleExecuteRescueTransfer = useCallback(async (suggestion: TransferSuggestion) => {
    if (!rescueProduct || !currentUserProfile || suggestion.safeTransfer <= 0) return;

    setRescueTransferring(true);
    try {
      const { stokKodu, stokAdi } = rescueProduct;

      // Find available items in depot for this product (FEFO order)
      const stockQuery = query(
        collection(db, 'depoStok'),
        where('depotId', '==', selectedDepotId),
        where('stokKodu', '==', stokKodu),
        where('isShipped', '==', false)
      );
      const stockSnap = await getDocs(stockQuery);
      const available = filterByCompanyScope(
        stockSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
        currentCompanyId,
        isSuperAdmin,
      )
        .sort((a, b) => {
          const aDays = getMiadInfoFromString(typeof a.miad === 'string' ? a.miad : '').days;
          const bDays = getMiadInfoFromString(typeof b.miad === 'string' ? b.miad : '').days;
          return aDays - bDays; // FEFO: shortest expiry first
        });

      const itemsToTransfer = available.slice(0, suggestion.safeTransfer);
      if (itemsToTransfer.length === 0) {
        toast({ title: 'Yetersiz Stok', description: 'Depoda transfer edilecek stok bulunamadı.', variant: 'destructive' });
        return;
      }

      const selectedDepot = depots.find(d => d.id === selectedDepotId);
      const depotName = selectedDepot?.name || '';
      const transferRef = doc(collection(db, 'transfers'));
      const batch = writeBatch(db);

      for (const item of itemsToTransfer) {
        const stokRef = doc(db, 'depoStok', item.id);
        batch.set(stokRef, {
          isShipped: true,
          sevkTarihi: Timestamp.now(),
          hedefKurum: suggestion.labName,
          hedefKurumId: suggestion.labId,
          transferId: transferRef.id,
          sourceDepotId: selectedDepotId,
          sourceDepotName: depotName,
          rescueTransfer: true, // Mark as rescue operation
        }, { merge: true });

        const itemRef = doc(db, 'transfers', transferRef.id, 'items', item.id);
        batch.set(itemRef, {
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi || stokAdi,
          lotNumarasi: item.lotNumarasi || '',
          miad: item.miad || '',
          seriNumarasi: item.seriNumarasi || '',
        });
      }

      batch.set(transferRef, withCompanyScope({
        id: transferRef.id,
        timestamp: serverTimestamp(),
        sourceDepotId: selectedDepotId,
        sourceDepotName: depotName,
        targetName: suggestion.labName,
        targetHospitalId: suggestion.labId,
        mode: 'lab',
        company: null,
        itemCount: itemsToTransfer.length,
        createdByUid: currentUserProfile.uid ?? '',
        createdByName: currentUserProfile.name ?? '',
        rescueTransfer: true,
      }, currentCompanyId));

      await batch.commit();
      await touchStockMetadata();

      // Emit notification
      await createNotification({
        type: 'transfer_to_lab',
        title: 'Kurtarma Transferi Tamamlandı',
        message: `${stokAdi} — ${itemsToTransfer.length} kutu riskli stok ${suggestion.labName} laboratuvarına transfer edildi (imhadan kurtarma).`,
        resource: { type: 'transfer', id: transferRef.id },
        actor: { uid: currentUserProfile.uid ?? '', name: currentUserProfile.name ?? '' },
        targets: [`lab:${suggestion.labId}`, 'view:stok-yonetimi', 'role:admin'],
        meta: {
          stokKodu,
          stokAdi,
          labId: suggestion.labId,
          depotId: selectedDepotId,
          rescueTransfer: true,
          rescuedBoxes: itemsToTransfer.length,
        },
      });

      toast({
        title: 'Kurtarma Transferi Başarılı',
        description: `${itemsToTransfer.length} kutu ${suggestion.labName} laboratuvarına transfer edildi.`,
      });

      // Refresh suggestions
      const updatedLabStocks = await fetchLabStockInfoForProduct(stokKodu);
      const newRiskyBoxes = Math.max(0, rescueProduct.riskyBoxes - itemsToTransfer.length);
      setRescueProduct(prev => prev ? { ...prev, riskyBoxes: newRiskyBoxes } : null);

      if (newRiskyBoxes > 0 && updatedLabStocks.length > 0) {
        const newSuggestions = calculateTransferSuggestions(newRiskyBoxes, rescueProduct.miadDays, updatedLabStocks);
        setRescueSuggestions(distributeRiskyBoxes(newRiskyBoxes, newSuggestions));
      } else {
        setRescueSuggestions([]);
      }
    } catch (e) {
      console.error('Rescue transfer error:', e);
      toast({ title: 'Transfer Hatası', description: 'Kurtarma transferi sırasında hata oluştu.', variant: 'destructive' });
    } finally {
      setRescueTransferring(false);
    }
  }, [rescueProduct, currentUserProfile, selectedDepotId, depots, fetchLabStockInfoForProduct, toast, currentCompanyId, isSuperAdmin]);

  /* ─── Bulk rescue plan ─── */
  const handleBulkRescuePlan = useCallback(async () => {
    setIsBulkRescueModalOpen(true);
    setBulkRescueLoading(true);
    setBulkRescuePlans([]);

    try {
      // Pull every risky row in one server call (already grouped + risk-scored).
      const riskyAll = await fetchAllRiskyRows();
      const riskyRows: Array<{ stokKodu: string; stokAdi: string; riskyBoxes: number; miadDays: number; miad: string }> = [];
      const seenProducts = new Set<string>();
      for (const { row, miadInfo, riskyBoxes } of riskyAll) {
        if (riskyBoxes > 0 && !seenProducts.has(row.stokKodu)) {
          seenProducts.add(row.stokKodu);
          riskyRows.push({
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            riskyBoxes,
            miadDays: miadInfo.days,
            miad: row.miad,
          });
        }
      }

      const plans: typeof bulkRescuePlans = [];

      for (const risky of riskyRows) {
        const labStocks = await fetchLabStockInfoForProduct(risky.stokKodu);
        if (labStocks.length === 0) {
          plans.push({ ...risky, rescuable: 0, suggestions: [] });
          continue;
        }
        const suggestions = calculateTransferSuggestions(risky.riskyBoxes, risky.miadDays, labStocks);
        const distributed = distributeRiskyBoxes(risky.riskyBoxes, suggestions);
        const rescuable = distributed.reduce((s, d) => s + d.safeTransfer, 0);
        plans.push({ ...risky, rescuable, suggestions: distributed });
      }

      setBulkRescuePlans(plans);
    } catch (e) {
      console.error('Bulk rescue plan error:', e);
      toast({ title: 'Hata', description: 'Toplu kurtarma planı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setBulkRescueLoading(false);
    }
  }, [fetchAllRiskyRows, fetchLabStockInfoForProduct, toast]);

  /* ═════════════════════════ RENDER ═════════════════════════ */
  return (
    <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 min-h-screen">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="sr-only">Depo Stoğu</h1>
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


          {/* Ürün Talep - quick action */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="cihaz-tool-item flex items-center justify-center gap-1.5 px-3 h-9 sm:h-10 text-xs font-medium text-[var(--dashboard-muted)]" disabled={!selectedDepotId}>
                <ClipboardPlus className="h-4 w-4" /> <span className="hidden sm:inline">Ürün Talep</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => router.push(`/urun-talep/depo/${selectedDepotId}`)} disabled={!selectedDepotId}>
                <ClipboardPlus className="h-4 w-4 mr-2" /> Talep Oluştur
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push(`/urun-talep/gecmis?depotId=${selectedDepotId}`)} disabled={!selectedDepotId}>
                <History className="h-4 w-4 mr-2" /> Talep Geçmişi
              </DropdownMenuItem>
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
              <DropdownMenuItem
                onSelect={handleBulkRescuePlan}
                disabled={!hasRiskyRows}
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                Kurtarma Planı Oluştur
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
            renderActiveFilterChips(col, vals, handleColumnFilter)
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
            <span className="font-medium">Toplam: <span className="text-[var(--dashboard-text)] font-bold">{totalRows}</span> kayıt</span>
            {totalPages > 1 && <span>Sayfa <span className="text-[var(--dashboard-text)] font-bold">{currentPage}</span>/{totalPages}</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Severity quick-filter chips — clicking toggles a server-side miad
                severity filter for matching rows. Doubles as a colour legend. */}
            <div className="hidden sm:flex items-center gap-1.5">
              <SeverityChip
                color="bg-red-700"
                label="Süresi Geçmiş"
                active={isMiadSeverityGroupActive('expired')}
                onClick={() => toggleMiadSeverityGroup('expired')}
              />
              <SeverityChip
                color="bg-red-500"
                label="<45 gün"
                active={isMiadSeverityGroupActive('urgent')}
                onClick={() => toggleMiadSeverityGroup('urgent')}
              />
              <SeverityChip
                color="bg-amber-500"
                label="<60 gün"
                active={isMiadSeverityGroupActive('soon')}
                onClick={() => toggleMiadSeverityGroup('soon')}
              />
              <SeverityChip
                color="bg-slate-400"
                label="Min. Stok"
                active={isBelowMinActive}
                onClick={toggleBelowMin}
              />
            </div>
            {/* Marka filter (Excel-style popover) */}
            {colValues.marka.length > 0 && (
              <ColumnFilterPopover
                column="marka"
                label="Marka"
                triggerStyle="pill"
                uniqueValues={colValues.marka}
                selectedValues={columnFilters['marka'] ?? []}
                onApply={handleColumnFilter}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
                searchPlaceholder="Marka filtrele..."
              />
            )}
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
                      column="stokAdi" label="Stok Adı"
                      uniqueValues={stokAdiOptionsForFilter}
                      selectedValues={columnFilters['stokAdi'] ?? []} onApply={handleColumnFilter}
                      sortField={sortField} sortDirection={sortDirection} onSort={handleSort}
                      searchPlaceholder="Ad veya stok kodu ile filtrele..."
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
                                  onClick={(e) => { e.stopPropagation(); handleOpenRescueModal(row.stokKodu, row.stokAdi, riskyBoxes, miadInfo.days, row.miad); }}
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

      {/* ── RESCUE TRANSFER MODAL ── */}
      <Dialog open={isRescueModalOpen} onOpenChange={setIsRescueModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              İmhadan Kurtarma — Transfer Önerileri
            </DialogTitle>
            {rescueProduct && (
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="font-semibold text-[var(--dashboard-text)]">{rescueProduct.stokAdi}</span>
                  <span className="text-[var(--dashboard-muted)]">({rescueProduct.stokKodu})</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                    <AlertTriangle className="h-3 w-3" />
                    {rescueProduct.riskyBoxes} kutu riskli
                  </span>
                  <span className="text-[10px] text-[var(--dashboard-muted)]">
                    Miad: {rescueProduct.miad} ({rescueProduct.miadDays} gün)
                  </span>
                </div>
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-auto py-3 space-y-3">
            {rescueLoading ? (
              <div className="flex items-center justify-center py-12 text-[var(--dashboard-muted)]">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Laboratuvar stokları analiz ediliyor...
              </div>
            ) : rescueSuggestions.length === 0 ? (
              <div className="text-center py-12 text-[var(--dashboard-muted)]">
                <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Bu ürün herhangi bir laboratuvara tanımlı değil veya uygun lab bulunamadı.</p>
              </div>
            ) : (
              <>
                {/* Summary bar */}
                {(() => {
                  const totalRescuable = rescueSuggestions.reduce((s, d) => s + d.safeTransfer, 0);
                  const unrescuable = (rescueProduct?.riskyBoxes ?? 0) - totalRescuable;
                  return (
                    <div className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg border text-xs",
                      unrescuable > 0
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    )}>
                      {unrescuable > 0 ? (
                        <>
                          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                          <span>
                            {rescueProduct?.riskyBoxes} riskli kutudan <strong>{totalRescuable}</strong> tanesi kurtarılabilir.
                            <strong className="text-red-700 ml-1">{unrescuable} kutu</strong> için uygun laboratuvar bulunamadı — imha riski devam ediyor.
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                          <span>
                            Tüm <strong>{rescueProduct?.riskyBoxes}</strong> riskli kutu kurtarılabilir!
                          </span>
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Suggestions */}
                {rescueSuggestions.map((s) => (
                  <div key={s.labId} className={cn(
                    "rounded-lg border overflow-hidden",
                    s.status === 'recommended' && "border-emerald-200",
                    s.status === 'possible' && "border-amber-200",
                    s.status === 'not_suitable' && "border-[var(--dashboard-stroke)] opacity-60",
                  )}>
                    {/* Lab header */}
                    <div className={cn(
                      "flex items-center justify-between px-3 py-2",
                      s.status === 'recommended' && "bg-emerald-50",
                      s.status === 'possible' && "bg-amber-50",
                      s.status === 'not_suitable' && "bg-[var(--dashboard-surface-2)]",
                    )}>
                      <div className="flex items-center gap-2">
                        {s.status === 'recommended' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                        {s.status === 'possible' && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                        {s.status === 'not_suitable' && <XCircle className="h-3.5 w-3.5 text-slate-400" />}
                        <span className="text-sm font-semibold text-[var(--dashboard-text)]">{s.labName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Confidence bar */}
                        {s.status !== 'not_suitable' && (
                          <div className="flex items-center gap-1.5">
                            <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  s.confidenceScore >= 70 ? "bg-emerald-500" : s.confidenceScore >= 40 ? "bg-amber-500" : "bg-red-500"
                                )}
                                style={{ width: `${s.confidenceScore}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-bold text-[var(--dashboard-muted)]">%{s.confidenceScore}</span>
                          </div>
                        )}
                        {s.safeTransfer > 0 && (
                          <Button
                            size="sm"
                            variant={s.status === 'recommended' ? 'default' : 'outline'}
                            className="h-7 text-[11px] gap-1"
                            disabled={rescueTransferring}
                            onClick={() => handleExecuteRescueTransfer(s)}
                          >
                            {rescueTransferring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                            {s.safeTransfer} kutu transfer
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Lab details */}
                    <div className="px-3 py-2 space-y-2">
                      {/* Metrics row */}
                      <div className={cn("grid gap-2 text-[10px]", s.avgConsumptionDays ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4")}>
                        <div className="flex flex-col">
                          <span className="text-[var(--dashboard-muted)]">Mevcut / Max</span>
                          <span className="font-bold text-[var(--dashboard-text)]">{s.currentStock} / {s.maxStock}
                            <span className="text-[var(--dashboard-muted)] font-normal ml-1">({s.deficit} açık)</span>
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[var(--dashboard-muted)]">Günlük Tüketim</span>
                          <span className="font-bold text-[var(--dashboard-text)]">{s.dailyNeed.toFixed(1)} kutu/gün</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[var(--dashboard-muted)]">Tüketim Süresi</span>
                          <span className={cn(
                            "font-bold",
                            s.daysToConsume !== Infinity && s.daysToConsume <= (rescueProduct?.miadDays ?? 0) ? "text-emerald-700" : "text-red-700"
                          )}>
                            {s.daysToConsume === Infinity ? 'Hesaplanamadı' : `${s.daysToConsume} gün`}
                            {s.daysToConsume !== Infinity && s.daysToConsume <= (rescueProduct?.miadDays ?? 0) && ' ✓'}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[var(--dashboard-muted)]">FEFO Uyumu</span>
                          <span className={cn("font-bold", s.fefoCompatible ? "text-emerald-700" : "text-amber-700")}>
                            {s.fefoCompatible ? 'Uyumlu ✓' : 'Uyarı ⚠'}
                          </span>
                        </div>
                        {s.avgConsumptionDays != null && s.avgConsumptionDays > 0 && (
                          <div className="flex flex-col">
                            <span className="text-[var(--dashboard-muted)]">Ort. Tüketim</span>
                            <span className="font-bold text-blue-700">
                              {s.avgConsumptionDays < 1
                                ? `${Math.round(s.avgConsumptionDays * 24)} saat/kutu`
                                : `${s.avgConsumptionDays} gün/kutu`}
                            </span>
                            {s.estimatedConsumptionDays != null && s.safeTransfer > 0 && (
                              <span className={cn(
                                "text-[9px] mt-0.5",
                                s.estimatedConsumptionDays <= (rescueProduct?.miadDays ?? 0) ? "text-emerald-600" : "text-red-600"
                              )}>
                                {s.safeTransfer} kutu → ~{s.estimatedConsumptionDays} günde tüketilir
                                {s.estimatedConsumptionDays <= (rescueProduct?.miadDays ?? 0) ? ' ✓' : ' ✗'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Status reason */}
                      <div className={cn(
                        "text-[10px] px-2 py-1 rounded",
                        s.status === 'recommended' && "bg-emerald-50 text-emerald-700",
                        s.status === 'possible' && "bg-amber-50 text-amber-700",
                        s.status === 'not_suitable' && "bg-slate-50 text-slate-500",
                      )}>
                        {s.statusReason}
                      </div>

                      {/* Lab stock table */}
                      {s.labItems.length > 0 && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] text-[10px]">
                            Labdaki mevcut stok ({s.labItems.reduce((sum, i) => sum + i.quantity, 0)} kutu)
                          </summary>
                          <table className="w-full mt-1">
                            <thead>
                              <tr className="border-b border-[var(--dashboard-stroke)] text-[var(--dashboard-muted)]">
                                <th className="px-2 py-1 text-left font-medium text-[10px]">Lot</th>
                                <th className="px-2 py-1 text-left font-medium text-[10px]">Miad</th>
                                <th className="px-2 py-1 text-center font-medium text-[10px]">Adet</th>
                                <th className="px-2 py-1 text-right font-medium text-[10px]">Durum</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.labItems.map((item, idx) => {
                                const itemMiadInfo = getMiadInfoFromString(item.miad);
                                return (
                                  <tr key={`${item.lotNumarasi}-${item.miad}-${idx}`} className="border-b border-[var(--dashboard-stroke)] last:border-0">
                                    <td className="px-2 py-1 font-mono text-[var(--dashboard-muted)]">{item.lotNumarasi}</td>
                                    <td className="px-2 py-1 text-[var(--dashboard-text)]">{item.miad || '-'}</td>
                                    <td className="px-2 py-1 text-center font-bold">{item.quantity}</td>
                                    <td className="px-2 py-1 text-right">
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
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRescueModalOpen(false)}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── BULK RESCUE PLAN MODAL ── */}
      <Dialog open={isBulkRescueModalOpen} onOpenChange={setIsBulkRescueModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Toplu Kurtarma Planı
            </DialogTitle>
            <DialogDescription>
              Tüm riskli ürünler için laboratuvar bazlı transfer önerilerinin özeti.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto py-3 space-y-3">
            {bulkRescueLoading ? (
              <div className="flex items-center justify-center py-12 text-[var(--dashboard-muted)]">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Tüm riskli ürünler analiz ediliyor...
              </div>
            ) : bulkRescuePlans.length === 0 ? (
              <div className="text-center py-12 text-[var(--dashboard-muted)]">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Riskli stok bulunamadı — tüm stoklar güvende!</p>
              </div>
            ) : (
              <>
                {/* Overall summary */}
                {(() => {
                  const totalRisky = bulkRescuePlans.reduce((s, p) => s + p.riskyBoxes, 0);
                  const totalRescuable = bulkRescuePlans.reduce((s, p) => s + p.rescuable, 0);
                  const totalUnrescuable = totalRisky - totalRescuable;
                  return (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center">
                        <div className="text-lg font-bold text-amber-800">{totalRisky}</div>
                        <div className="text-[10px] text-amber-600">Toplam Riskli Kutu</div>
                      </div>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
                        <div className="text-lg font-bold text-emerald-800">{totalRescuable}</div>
                        <div className="text-[10px] text-emerald-600">Kurtarılabilir</div>
                      </div>
                      <div className={cn(
                        "rounded-lg border px-3 py-2 text-center",
                        totalUnrescuable > 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"
                      )}>
                        <div className={cn("text-lg font-bold", totalUnrescuable > 0 ? "text-red-800" : "text-emerald-800")}>{totalUnrescuable}</div>
                        <div className={cn("text-[10px]", totalUnrescuable > 0 ? "text-red-600" : "text-emerald-600")}>İmha Riski</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Per-product plans */}
                {bulkRescuePlans.map((plan) => (
                  <div key={plan.stokKodu} className="rounded-lg border border-[var(--dashboard-stroke)] overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-[var(--dashboard-surface-2)]">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[var(--dashboard-text)] truncate">{plan.stokAdi}</div>
                        <div className="text-[10px] text-[var(--dashboard-muted)] font-mono">({plan.stokKodu}) — Miad: {plan.miad} ({plan.miadDays} gün)</div>
                      </div>
                      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                          <AlertTriangle className="h-3 w-3" />
                          {plan.riskyBoxes} riskli
                        </span>
                        {plan.rescuable > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            {plan.rescuable} kurtarılabilir
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px] gap-1"
                          onClick={() => {
                            setIsBulkRescueModalOpen(false);
                            handleOpenRescueModal(plan.stokKodu, plan.stokAdi, plan.riskyBoxes, plan.miadDays, plan.miad);
                          }}
                        >
                          <ArrowRight className="h-3 w-3" />
                          Detay
                        </Button>
                      </div>
                    </div>

                    {/* Brief suggestion list */}
                    {plan.suggestions.filter(s => s.safeTransfer > 0).length > 0 && (
                      <div className="px-3 py-1.5 space-y-1">
                        {plan.suggestions.filter(s => s.safeTransfer > 0).map(s => (
                          <div key={s.labId} className="flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-1.5">
                              {s.status === 'recommended' ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}
                              <span className="text-[var(--dashboard-text)]">{s.labName}</span>
                              {s.estimatedConsumptionDays != null && (
                                <span className={cn(
                                  "px-1 py-0.5 rounded text-[9px]",
                                  s.estimatedConsumptionDays <= plan.miadDays ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700"
                                )}>
                                  ~{s.estimatedConsumptionDays}g tüketim
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[var(--dashboard-muted)]">{s.currentStock}/{s.maxStock}</span>
                              <span className="font-bold text-[var(--dashboard-text)]">→ {s.safeTransfer} kutu</span>
                              <div className="w-10 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full", s.confidenceScore >= 70 ? "bg-emerald-500" : "bg-amber-500")}
                                  style={{ width: `${s.confidenceScore}%` }}
                                />
                              </div>
                              <span className="text-[var(--dashboard-muted)] w-6 text-right">%{s.confidenceScore}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {plan.suggestions.filter(s => s.safeTransfer > 0).length === 0 && (
                      <div className="px-3 py-2 text-[10px] text-red-600">
                        <XCircle className="h-3 w-3 inline mr-1" />
                        Uygun laboratuvar bulunamadı — {plan.riskyBoxes} kutu imha riski altında
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkRescueModalOpen(false)}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
