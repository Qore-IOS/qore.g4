
'use client';
import React, { useState, useEffect, useCallback, ChangeEvent, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { PlusCircle, Edit3, Trash2, Loader2, Barcode, Download, Upload, Search, Filter, X, Type, Save, Calendar, MoreHorizontal, Copy, GitBranch, ChevronDown, ChevronRight, Eye, EyeOff, FileSpreadsheet } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { collection, getDocs, deleteDoc, doc, writeBatch, setDoc, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { ProductCode } from '@/lib/types';
import { ProductFormatModal } from '@/components/ProductFormatModal';
import { readExcelDataSmart } from '@/lib/utils';
import { trackingModeFromExcel, trackingModeToExcel, TRACKING_MODE_LABEL, TrackingMode } from '@/lib/tracking';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';
import debounce from 'lodash.debounce';
import { Badge } from '../ui/badge';
import { useAuth } from '@/contexts/auth-context';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' })
}));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

type Definitions = {
  brands: string[];
  labGroups: string[];
  testGroups: string[];
  deviceGroups: string[];
  productGroups: string[];
  mainUnits: string[];
};

const normalizeKey = (s: string) =>
  (s || '')
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) =>
      ({ ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' } as any)[ch]
    )
    .toLowerCase()
    .replace(/[\s._-]+/g, '');

const parseNum = (v: any): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

interface Filter {
  group: 'marka' | 'urunGrubu';
  value: string;
}

/* ─────────────────────────────────────────────
 * Filter Modal - Checkbox + Search approach
 * ───────────────────────────────────────────── */
const FiltreDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  availableGroups: Record<string, string[]>;
  onApply: (filters: Filter[]) => void;
  currentFilters: Filter[];
}> = ({ isOpen, onClose, availableGroups, onApply, currentFilters }) => {
  const [draftFilters, setDraftFilters] = useState<Filter[]>(currentFilters);
  const [filterSearch, setFilterSearch] = useState('');

  useEffect(() => {
    if (isOpen) setDraftFilters(currentFilters);
  }, [isOpen, currentFilters]);

  const toggleFilter = (group: 'marka' | 'urunGrubu', value: string) => {
    setDraftFilters(prev => {
      const exists = prev.some(f => f.group === group && f.value === value);
      if (exists) return prev.filter(f => !(f.group === group && f.value === value));
      return [...prev, { group, value }];
    });
  };

  const clearAll = () => setDraftFilters([]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl mx-4 glass-card rounded-3xl overflow-hidden shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-3 border-b border-[var(--dashboard-stroke)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--dashboard-text)]">Filtrele</h2>
            <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">Marka ve ürün grubuna göre filtreleyin</p>
          </div>
          <button onClick={onClose} className="neu-btn-universal w-9 h-9 rounded-xl flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Selected Filters */}
          {draftFilters.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">Seçilen Filtreler ({draftFilters.length})</span>
                <button onClick={clearAll} className="text-xs font-medium text-[var(--device-danger)] hover:underline">Temizle</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {draftFilters.map(f => (
                  <span
                    key={`${f.group}-${f.value}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--device-accent)] text-white"
                  >
                    {f.value}
                    <button onClick={() => toggleFilter(f.group, f.value)} className="hover:bg-white/20 rounded-full p-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--dashboard-muted)]" />
            <input
              type="text"
              placeholder="Marka veya grup ara..."
              value={filterSearch}
              onChange={e => setFilterSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-none outline-none text-sm text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)]"
            />
          </div>

          {/* Filter Groups */}
          {Object.entries(availableGroups).map(([group, items]) => {
            const filteredItems = filterSearch
              ? items.filter(item => item.toLowerCase().includes(filterSearch.toLowerCase()))
              : items;
            if (filteredItems.length === 0) return null;
            return (
              <div key={group}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] mb-2">
                  {group === 'marka' ? 'Marka' : 'Ürün Grubu'}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {filteredItems.map(item => {
                    const isSelected = draftFilters.some(f => f.group === group && f.value === item);
                    return (
                      <button
                        key={item}
                        onClick={() => toggleFilter(group as 'marka' | 'urunGrubu', item)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all text-left",
                          isSelected
                            ? "bg-[var(--device-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                            : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)] shadow-[var(--dashboard-pressed)] hover:shadow-[var(--dashboard-raised-soft)]"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                          isSelected ? "border-white bg-white/20" : "border-[var(--dashboard-muted)]"
                        )}>
                          {isSelected && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                        </div>
                        <span className="truncate">{item}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer - Sticky */}
        <div className="flex items-center justify-between p-5 pt-3 border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
          <button onClick={onClose} className="neu-btn-universal px-5 py-2.5 rounded-xl text-sm font-semibold">
            İptal
          </button>
          <button
            onClick={() => { onApply(draftFilters); onClose(); }}
            className="neu-btn-universal neu-text-primary px-5 py-2.5 rounded-xl text-sm font-semibold"
          >
            Filtreleri Uygula ({draftFilters.length})
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
 * Row Actions Menu
 * ───────────────────────────────────────────── */
const RowActionsMenu: React.FC<{
  product: ProductCode;
  onEdit: (p: ProductCode) => void;
  onDelete: (id: string) => void;
  onDuplicate: (p: ProductCode) => void;
}> = ({ product, onEdit, onDelete, onDuplicate }) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="neu-btn-universal w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <MoreHorizontal className="h-4 w-4 text-[var(--dashboard-muted)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => onEdit(product)}>
          <Edit3 className="h-4 w-4 mr-2" /> Düzenle
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDuplicate(product)}>
          <Copy className="h-4 w-4 mr-2" /> Kopyala
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onDelete(product.id)} className="text-[var(--device-danger)] focus:text-[var(--device-danger)]">
          <Trash2 className="h-4 w-4 mr-2" /> Sil
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/* ─────────────────────────────────────────────
 * Mobile Product Card
 * ───────────────────────────────────────────── */
const ProductCard: React.FC<{
  product: ProductCode;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  onEdit: (p: ProductCode) => void;
  onDelete: (id: string) => void;
  onDuplicate: (p: ProductCode) => void;
  barcodeFormats: any[];
}> = ({ product, isSelected, onSelect, onEdit, onDelete, onDuplicate, barcodeFormats }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      "cihaz-card p-3 space-y-2 transition-all",
      isSelected && "ring-2 ring-[var(--device-accent)]"
    )}>
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Checkbox checked={isSelected} onCheckedChange={onSelect} />
        </div>
        <div className="flex-1 min-w-0" onClick={() => setExpanded(!expanded)}>
          <p className="font-semibold text-sm text-[var(--dashboard-text)] truncate">{product.stokAdi}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="font-mono text-xs text-[var(--dashboard-muted)]">{product.stokKodu}</span>
            {product.marka && (
              <span className="px-2 py-0.5 rounded-full bg-[var(--device-accent-weak)] text-[var(--device-accent)] text-[10px] font-bold">
                {product.marka}
              </span>
            )}
            <span className="text-xs text-[var(--dashboard-muted)]">{product.urunGrubu}</span>
          </div>
        </div>
        <RowActionsMenu product={product} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} />
      </div>

      {expanded && (
        <div className="pl-8 pt-2 border-t border-[var(--dashboard-stroke)] space-y-1.5 text-xs text-[var(--dashboard-muted)]">
          {product.testGrubu && <p><span className="font-medium">Test Grubu:</span> {product.testGrubu}</p>}
          {product.cihazGrubu && <p><span className="font-medium">Cihaz Grubu:</span> {product.cihazGrubu}</p>}
          {product.laboratuvarGrubu && <p><span className="font-medium">Lab Grubu:</span> {product.laboratuvarGrubu}</p>}
          {(() => {
            const formatIds = (product as any).barcodeFormatIds;
            if (Array.isArray(formatIds) && formatIds.length > 0) {
              return (
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="font-medium">Barkod:</span>
                  {formatIds.map((fmtId: string) => {
                    const fmt = barcodeFormats.find((f: any) => f.id === fmtId);
                    return fmt ? <Badge key={fmtId} variant="secondary" className="text-[10px]">{fmt.name}</Badge> : null;
                  })}
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────
 * Main Panel
 * ───────────────────────────────────────────── */
export default function UrunKoduPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { formats: barcodeFormats } = useSafeBarcodeFormats();
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);

  // Active tab: 'products' | 'checkpoint'
  const [activeTab, setActiveTab] = useState<'products' | 'checkpoint'>('products');

  // Cost Checkpoint State
  const [costCheckpoints, setCostCheckpoints] = useState<{ id: string; year: number; month: number; productCount: number; createdAt: Date }[]>([]);
  const [selectedCheckpointMonth, setSelectedCheckpointMonth] = useState<number>(new Date().getMonth());
  const [selectedCheckpointYear, setSelectedCheckpointYear] = useState<number>(new Date().getFullYear());
  const [isSavingCheckpoint, setIsSavingCheckpoint] = useState(false);
  const [checkpointExpanded, setCheckpointExpanded] = useState(false);

  const [definitions, setDefinitions] = useState<Definitions>({
    brands: [], labGroups: [], testGroups: [], deviceGroups: [], productGroups: [], mainUnits: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Partial<ProductCode>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Filter[]>([]);
  const [selectedBrandTab, setSelectedBrandTab] = useState<string>('ALL');
  const [versionHistoryProduct, setVersionHistoryProduct] = useState<ProductCode | null>(null);

  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [bulkTrackingMode, setBulkTrackingMode] = useState<TrackingMode>('serial');

  // View mode: 'compact' | 'comfortable'
  const [viewMode, setViewMode] = useState<'compact' | 'comfortable'>('comfortable');

  const addFileRef = useRef<HTMLInputElement>(null);
  const updateFileRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useCallback(debounce((term) => setDebouncedSearchTerm(term), 300), []);
  useEffect(() => { debouncedSearch(searchTerm); }, [searchTerm, debouncedSearch]);

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [productsSnap, brandsSnap, labGroupsSnap, testGroupsSnap, deviceGroupsSnap, productGroupsSnap, mainUnitsSnap] = await Promise.all([
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'def_brands')),
        getDocs(collection(db, 'def_labGroups')),
        getDocs(collection(db, 'def_testGroups')),
        getDocs(collection(db, 'def_deviceGroups')),
        getDocs(collection(db, 'def_productGroups')),
        getDocs(collection(db, 'def_mainUnits')),
      ]);
      setProductCodes(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
      setDefinitions({
        brands: brandsSnap.docs.map(d => d.data().name as string).sort(),
        labGroups: labGroupsSnap.docs.map(d => d.data().name as string).sort(),
        testGroups: testGroupsSnap.docs.map(d => d.data().name as string).sort(),
        deviceGroups: deviceGroupsSnap.docs.map(d => d.data().name as string).sort(),
        productGroups: productGroupsSnap.docs.map(d => d.data().name as string).sort(),
        mainUnits: mainUnitsSnap.docs.map(d => d.data().name as string).sort(),
      });
    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  // Fetch cost checkpoints
  useEffect(() => {
    const fetchCostCheckpoints = async () => {
      try {
        const checkpointsSnap = await getDocs(
          query(collection(db, 'costCheckpoints'), orderBy('year', 'desc'), orderBy('month', 'desc'))
        );
        const checkpointsList = checkpointsSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            year: data.year as number,
            month: data.month as number,
            productCount: data.productCount as number || 0,
            createdAt: data.createdAt?.toDate() || new Date(),
          };
        });
        setCostCheckpoints(checkpointsList);
      } catch (error) {
        console.error('Error fetching cost checkpoints:', error);
      }
    };
    fetchCostCheckpoints();
  }, []);

  // Save cost checkpoint
  const handleSaveCostCheckpoint = async () => {
    if (productCodes.length === 0) {
      toast({ title: 'Hata', description: 'Önce ürün kodları yüklenmelidir.', variant: 'destructive' });
      return;
    }
    setIsSavingCheckpoint(true);
    try {
      const costs: Record<string, { cost: number; currency: 'EUR' | 'USD' | 'TRY' }> = {};
      productCodes.forEach(product => {
        if (product.cost && product.cost > 0) {
          costs[product.stokKodu] = {
            cost: product.cost,
            currency: (product.currency as 'EUR' | 'USD' | 'TRY') || 'EUR',
          };
        }
      });
      const docId = `${selectedCheckpointYear}-${String(selectedCheckpointMonth).padStart(2, '0')}`;
      const checkpointData = {
        year: selectedCheckpointYear,
        month: selectedCheckpointMonth,
        costs,
        productCount: Object.keys(costs).length,
        createdAt: Timestamp.now(),
        createdByUid: currentUser?.uid || '',
        createdByName: (currentUser as any)?.name || currentUser?.email || '',
      };
      await setDoc(doc(db, 'costCheckpoints', docId), checkpointData);
      const newCheckpoint = {
        id: docId,
        year: selectedCheckpointYear,
        month: selectedCheckpointMonth,
        productCount: Object.keys(costs).length,
        createdAt: new Date(),
      };
      setCostCheckpoints(prev => {
        const filtered = prev.filter(c => c.id !== docId);
        return [newCheckpoint, ...filtered].sort((a, b) => {
          if (b.year !== a.year) return b.year - a.year;
          return b.month - a.month;
        });
      });
      toast({
        title: 'Maliyet Checkpoint Kaydedildi',
        description: `${MONTHS[selectedCheckpointMonth]?.label} ${selectedCheckpointYear} - ${Object.keys(costs).length} ürün maliyeti kaydedildi.`,
      });
    } catch (error) {
      console.error('Error saving cost checkpoint:', error);
      toast({ title: 'Hata', description: 'Maliyet checkpoint kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSavingCheckpoint(false);
    }
  };

  const openModal = (product?: ProductCode) => {
    setSelectedProduct(product || {});
    setIsModalOpen(true);
  };

  const handleDuplicate = (product: ProductCode) => {
    const { id, stokKodu, ...rest } = product;
    setSelectedProduct({ ...rest, stokKodu: '' });
    setIsModalOpen(true);
  };

  const handleSave = (product: ProductCode) => {
    if (product.id && !productCodes.some(p => p.id === product.id)) {
      setProductCodes(prev => [...prev, product]);
    } else {
      setProductCodes(prev => prev.map(p => p.id === product.id ? product : p));
    }
    fetchAllData();
  };

  const handleSetActiveVersion = async (versionId: string) => {
    const next = productCodes.find((p) => p.id === versionId);
    if (!next) return;
    const groupId = getVersionGroupId(next);
    const groupVersions = versionsByGroup.get(groupId) || [];
    const batch = writeBatch(db);
    groupVersions.forEach((v) => {
      batch.update(doc(db, 'productCodes', v.id), { isActiveVersion: v.id === versionId });
    });
    await batch.commit();
    toast({ title: 'Başarılı', description: 'Aktif versiyon güncellendi.' });
    setSelectedProduct(next);
    fetchAllData();
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu ürünü silmek istediğinizden emin misiniz?')) {
      await deleteDoc(doc(db, 'productCodes', id));
      toast({ title: 'Silindi', description: 'Ürün silindi.', variant: 'destructive' });
      fetchAllData();
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedProductIds.size === 0) return;
    if (confirm(`${selectedProductIds.size} adet ürünü silmek istediğinizden emin misiniz?`)) {
      setIsLoading(true);
      const batch = writeBatch(db);
      selectedProductIds.forEach(id => {
        batch.delete(doc(db, 'productCodes', id));
      });
      await batch.commit();
      toast({ title: 'Silindi', description: `${selectedProductIds.size} ürün silindi.` });
      setSelectedProductIds(new Set());
      fetchAllData();
    }
  };

  const handleBulkUpdateTrackingMode = async () => {
    if (selectedProductIds.size === 0) {
      toast({ title: 'Uyarı', description: 'Önce ürün seçmelisiniz.', variant: 'default' });
      return;
    }
    if (confirm(`${selectedProductIds.size} adet ürünün takip türünü "${TRACKING_MODE_LABEL[bulkTrackingMode]}" olarak ayarlamak istediğinizden emin misiniz?`)) {
      setIsLoading(true);
      const batch = writeBatch(db);
      selectedProductIds.forEach(id => {
        batch.update(doc(db, 'productCodes', id), { trackingMode: bulkTrackingMode });
      });
      try {
        await batch.commit();
        toast({ title: 'Başarılı', description: `${selectedProductIds.size} ürünün takip türü güncellendi.` });
        setSelectedProductIds(new Set());
        fetchAllData();
      } catch (e) {
        toast({ title: 'Hata', description: 'Toplu güncelleme sırasında bir hata oluştu.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const createReferenceSheet = () => {
    const trackingModes = Object.entries(TRACKING_MODE_LABEL).map(([key, label]) => ({ TakipTuru_Kodu: key, Aciklama: label }));
    const maxLength = Math.max(
      definitions.brands.length, definitions.labGroups.length, definitions.testGroups.length,
      definitions.deviceGroups.length, definitions.productGroups.length, definitions.mainUnits.length,
      trackingModes.length
    );
    const sheetData: any[] = [];
    for (let i = 0; i < maxLength; i++) {
      sheetData.push({
        'Markalar': definitions.brands[i] || '',
        'Laboratuvar Gruplari': definitions.labGroups[i] || '',
        'Test Gruplari': definitions.testGroups[i] || '',
        'Cihaz Gruplari': definitions.deviceGroups[i] || '',
        'Urun Gruplari': definitions.productGroups[i] || '',
        'Ana Birimler': definitions.mainUnits[i] || '',
        'Takip Turu Kodu': trackingModes[i]?.TakipTuru_Kodu || '',
        'Takip Turu Aciklama': trackingModes[i]?.Aciklama || '',
      });
    }
    return XLSX.utils.json_to_sheet(sheetData);
  };

  const handleDownloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const templateSheet = XLSX.utils.json_to_sheet([
      {
        stokKodu: '', stokAdi: '', urunGrubu: 'kit', ambalajDegeri: '', anaBirim: 'Kutu', cost: '', currency: 'EUR', marka: '', laboratuvarGrubu: '', testGrubu: '', cihazGrubu: '', testAdi: '', trackingMode: 'serial', barcodeNumber: '', barcodeFormatId: ''
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, templateSheet, 'Urunler');
    const refSheet = createReferenceSheet();
    XLSX.utils.book_append_sheet(workbook, refSheet, 'Tanim_Referanslari');
    XLSX.writeFile(workbook, 'Urun_Ekleme_Sablonu.xlsx');
  };

  const handleExport = () => {
    const dataToExport = productCodes.map(p => ({
      stokKodu: p.stokKodu,
      stokAdi: p.stokAdi,
      urunGrubu: p.urunGrubu,
      ambalajDegeri: p.ambalajDegeri,
      anaBirim: p.anaBirim,
      cost: p.cost,
      currency: p.currency,
      marka: p.marka,
      laboratuvarGrubu: p.laboratuvarGrubu,
      testGrubu: p.testGrubu,
      cihazGrubu: p.cihazGrubu,
      testAdi: p.testAdi ?? '',
      trackingMode: trackingModeToExcel((p as any).trackingMode),
      barcodeNumber: (p as any).barcodeNumber ?? '',
      barcodeFormatId: (p as any).barcodeFormatId ?? '',
      barcodeFormatIds: Array.isArray((p as any).barcodeFormatIds) ? (p as any).barcodeFormatIds.join(',') : '',
    }));
    const workbook = XLSX.utils.book_new();
    const productSheet = XLSX.utils.json_to_sheet(dataToExport);
    XLSX.utils.book_append_sheet(workbook, productSheet, 'Urunler');
    const refSheet = createReferenceSheet();
    XLSX.utils.book_append_sheet(workbook, refSheet, 'Tanim_Referanslari');
    XLSX.writeFile(workbook, 'Urun_Kodlari_Listesi.xlsx');
    toast({ title: 'Başarılı', description: 'Ürün listesi referanslarla birlikte dışa aktarıldı.' });
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>, mode: 'update' | 'add') => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    try {
      const jsonData = await readExcelDataSmart(file, 'product', toast);
      const batch = writeBatch(db);
      let successCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      for (const rawRow of jsonData) {
        const row = Object.keys(rawRow).reduce((acc, key) => {
          acc[normalizeKey(key)] = (rawRow as any)[key];
          return acc;
        }, {} as Record<string, any>);
        const stokKodu = String(row['stokkodu'] || '').trim();
        if (!stokKodu) { errorCount++; continue; }
        const stokAdi = String(row['stokadi'] || row['stokadı'] || '').trim();
        const urunGrubuRaw = String(row['urungrubu'] || row['ürüngrubu'] || 'kit').toLowerCase();
        const urunGrubu: 'kit' | 'sarf' | 'yedek_parca' = urunGrubuRaw.includes('yedek') || urunGrubuRaw.includes('parca') ? 'yedek_parca' : (urunGrubuRaw.includes('sarf') ? 'sarf' : 'kit');
        const ambalajDegeri = parseNum(row['ambalajdegeri'] ?? row['ambalajdeğeri']);
        if (urunGrubu === 'kit' && mode === 'add' && (!ambalajDegeri || ambalajDegeri <= 0)) {
          toast({ title: "Uyarı", description: `Kit ${stokKodu} için geçersiz ambalaj değeri. Satır atlandı.`, variant: "default" });
          errorCount++; continue;
        }
        const productData: Partial<ProductCode> = {
          stokKodu,
          stokAdi: stokAdi || undefined,
          urunGrubu,
          ambalajDegeri: urunGrubu === 'kit' ? ambalajDegeri : undefined,
          anaBirim: (row['anabirim'] as ProductCode['anaBirim']) || 'Kutu',
          cost: parseNum(row['maliyet'] ?? row['cost']),
          currency: (String(row['parabirimi'] ?? row['currency'] ?? 'EUR').toUpperCase() as ProductCode['currency']) || undefined,
          marka: row['marka'] || undefined,
          laboratuvarGrubu: row['laboratuvargrubu'] || undefined,
          testGrubu: row['testgrubu'] || undefined,
          cihazGrubu: row['cihazgrubu'] || undefined,
          testAdi: row['testadi'] || row['testadı'] || undefined,
          trackingMode: trackingModeFromExcel(row['trackingmode']),
          barcodeNumber: row['barcodenumber'] ?? null,
          barcodeFormatId: row['barcodeformatid'] || null,
          barcodeFormatIds: row['barcodeformatids']
            ? String(row['barcodeformatids']).split(',').map(s => s.trim()).filter(Boolean)
            : undefined,
        };
        const cleanedProductData = Object.fromEntries(
          Object.entries(productData).filter(([, value]) => value !== undefined)
        );
        const existing = productCodes.find(p => p.stokKodu === stokKodu);
        if (mode === 'update') {
          if (existing) { batch.set(doc(db, 'productCodes', existing.id), cleanedProductData, { merge: true }); updatedCount++; }
          else { skippedCount++; }
        } else {
          if (existing) { skippedCount++; }
          else { batch.set(doc(collection(db, 'productCodes')), cleanedProductData); successCount++; }
        }
      }
      if (successCount > 0 || updatedCount > 0) await batch.commit();
      toast({ title: "Yükleme Tamamlandı", description: `${successCount} kayıt eklendi, ${updatedCount} kayıt güncellendi. ${skippedCount} satır atlandı. ${errorCount} satır hatalı.` });
      if (successCount > 0 || updatedCount > 0) fetchAllData();
    } catch (error) {
      toast({ title: "Excel Yükleme Hatası", description: "Dosya işlenirken hata oluştu.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      if (event.target) (event.target as HTMLInputElement).value = '';
    }
  };

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

  const filteredProductCodes = useMemo(() => {
    let items = productCodes;
    if (selectedBrandTab !== 'ALL') {
      if (selectedBrandTab === 'Diğer') {
        items = items.filter(p => !p.marka);
      } else {
        items = items.filter(p => p.marka === selectedBrandTab);
      }
    }
    if (activeFilters.length > 0) {
      items = items.filter(p => {
        return activeFilters.every(filter => {
          if (filter.group === 'marka') return p.marka === filter.value;
          if (filter.group === 'urunGrubu') return p.urunGrubu === filter.value;
          return true;
        });
      });
    }
    if (debouncedSearchTerm) {
      const lowercasedTerm = debouncedSearchTerm.toLowerCase();
      items = items.filter(p =>
        p.stokKodu.toLowerCase().includes(lowercasedTerm) ||
        p.stokAdi.toLowerCase().includes(lowercasedTerm)
      );
    }
    return items;
  }, [productCodes, debouncedSearchTerm, activeFilters, selectedBrandTab]);

  const brandTabOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    productCodes.forEach(p => {
      const brand = p.marka || 'Diğer';
      counts[brand] = (counts[brand] || 0) + 1;
    });
    const items = Object.entries(counts)
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => a.brand.localeCompare(b.brand, 'tr'));
    const total = productCodes.length;
    return { total, items };
  }, [productCodes]);

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedProductIds(new Set(filteredProductCodes.map(p => p.id)));
    } else {
      setSelectedProductIds(new Set());
    }
  };

  const handleRowSelect = (id: string, checked: boolean) => {
    setSelectedProductIds(prev => {
      const newSet = new Set(prev);
      if (checked) newSet.add(id);
      else newSet.delete(id);
      return newSet;
    });
  };

  const allSelected = filteredProductCodes.length > 0 && selectedProductIds.size === filteredProductCodes.length;
  const someSelected = selectedProductIds.size > 0 && selectedProductIds.size < filteredProductCodes.length;

  const renderBarcodeFormats = (p: ProductCode) => {
    const formatIds = (p as any).barcodeFormatIds;
    if (Array.isArray(formatIds) && formatIds.length > 0) {
      return (
        <div className="flex flex-wrap gap-1">
          {formatIds.map((fmtId: string) => {
            const fmt = barcodeFormats.find(f => f.id === fmtId);
            return fmt ? (
              <span key={fmtId} className="px-1.5 py-0.5 rounded-md bg-[var(--dashboard-surface-2)] text-[10px] font-medium text-[var(--dashboard-text)]">
                {fmt.name}
              </span>
            ) : null;
          })}
        </div>
      );
    }
    const singleFormatId = (p as any).barcodeFormatId;
    if (singleFormatId && singleFormatId !== '__auto__') {
      const fmt = barcodeFormats.find(f => f.id === singleFormatId);
      return fmt ? (
        <span className="px-1.5 py-0.5 rounded-md bg-[var(--dashboard-surface-2)] text-[10px] font-medium">{fmt.name}</span>
      ) : (
        <span className="text-xs text-[var(--dashboard-muted)]">{singleFormatId}</span>
      );
    }
    return <span className="text-xs text-[var(--dashboard-muted)]">{singleFormatId === '__auto__' ? 'Otomatik' : '—'}</span>;
  };

  return (
    <>
      <input ref={addFileRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={(e) => handleImport(e, 'add')} />
      <input ref={updateFileRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={(e) => handleImport(e, 'update')} />

      {/* ═══════════════ HEADER ═══════════════ */}
      <div className="cihaz-card-strong p-4 sm:p-5 space-y-4">
        {/* Title + Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)] flex items-center gap-2">
              <Barcode className="h-6 w-6 text-[var(--device-accent)]" />
              Ürün Kodu Yönetimi
            </h1>
            <p className="text-xs sm:text-sm text-[var(--dashboard-muted)] mt-0.5">
              {productCodes.length} ürün kayıtlı
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Import/Export Group */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="neu-btn-universal px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-[var(--dashboard-muted)]" />
                  <span className="hidden sm:inline">Aktarım</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={handleExport}>
                  <Download className="h-4 w-4 mr-2" /> Dışa Aktar (Excel)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => updateFileRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" /> Güncelle (Excel)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadTemplate}>
                  <Download className="h-4 w-4 mr-2" /> Excel Şablonu İndir
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addFileRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" /> Excel ile İçe Aktar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* New Product */}
            <button
              onClick={() => openModal()}
              className="neu-btn-universal neu-text-primary px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2"
            >
              <PlusCircle className="h-4 w-4" />
              Yeni Ürün
            </button>
          </div>
        </div>

        {/* Tab Switcher: Products / Checkpoint */}
        <div className="flex rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-1 gap-1">
          <button
            onClick={() => setActiveTab('products')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all",
              activeTab === 'products'
                ? "bg-[var(--dashboard-surface)] shadow-[var(--dashboard-raised-soft)] text-[var(--dashboard-text)]"
                : "text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
            )}
          >
            <Barcode className="h-4 w-4" />
            Ürün Kataloğu
          </button>
          <button
            onClick={() => setActiveTab('checkpoint')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all",
              activeTab === 'checkpoint'
                ? "bg-[var(--dashboard-surface)] shadow-[var(--dashboard-raised-soft)] text-[var(--dashboard-text)]"
                : "text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
            )}
          >
            <Calendar className="h-4 w-4" />
            Maliyet Snapshot
            {costCheckpoints.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md bg-[var(--device-accent)] text-white text-[10px] font-bold">
                {costCheckpoints.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ═══════════════ PRODUCTS TAB ═══════════════ */}
      {activeTab === 'products' && (
        <div className="space-y-3">
          {/* ── Toolbar ── */}
          <div className="cihaz-card p-3 sm:p-4 space-y-3">
            {/* Search + Filter + View */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--dashboard-muted)]" />
                <input
                  type="text"
                  placeholder="Stok adı veya kodu ile ara..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-none outline-none text-sm text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)]"
                />
                {searchTerm && (
                  <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="h-4 w-4 text-[var(--dashboard-muted)]" />
                  </button>
                )}
              </div>

              {/* Filter Button */}
              <button
                onClick={() => setIsFilterDialogOpen(true)}
                className={cn(
                  "neu-btn-universal px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2",
                  activeFilters.length > 0 && "ring-2 ring-[var(--device-accent)]"
                )}
              >
                <Filter className="h-4 w-4" />
                <span className="hidden sm:inline">Filtrele</span>
                {activeFilters.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md bg-[var(--device-accent)] text-white text-[10px] font-bold">{activeFilters.length}</span>
                )}
              </button>

              {/* View Toggle */}
              <button
                onClick={() => setViewMode(v => v === 'compact' ? 'comfortable' : 'compact')}
                className="neu-btn-universal px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"
                title={viewMode === 'compact' ? 'Rahat Görünüm' : 'Kompakt Görünüm'}
              >
                {viewMode === 'compact' ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                <span className="hidden sm:inline">{viewMode === 'compact' ? 'Rahat' : 'Kompakt'}</span>
              </button>
            </div>

            {/* Active Filters Display */}
            {activeFilters.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[var(--dashboard-muted)]">Aktif:</span>
                {activeFilters.map(f => (
                  <span key={`${f.group}-${f.value}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--device-accent-weak)] text-[var(--device-accent)] text-xs font-semibold">
                    {f.value}
                    <button onClick={() => setActiveFilters(prev => prev.filter(pf => !(pf.group === f.group && pf.value === f.value)))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button onClick={() => setActiveFilters([])} className="text-xs text-[var(--device-danger)] font-medium hover:underline">Temizle</button>
              </div>
            )}

            {/* Bulk Actions Bar */}
            {selectedProductIds.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-xl bg-[var(--device-accent-weak)] border border-[var(--device-accent)]/20">
                <span className="text-xs font-semibold text-[var(--device-accent)]">{selectedProductIds.size} ürün seçili</span>
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  <Select value={bulkTrackingMode} onValueChange={(v) => setBulkTrackingMode(v as TrackingMode)}>
                    <SelectTrigger className="w-[160px] h-8 text-xs bg-white/80 border-[var(--dashboard-stroke)] rounded-lg">
                      <SelectValue placeholder="Takip Türü" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TRACKING_MODE_LABEL).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button onClick={handleBulkUpdateTrackingMode} className="neu-btn-universal neu-text-primary px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1">
                    <Type className="h-3.5 w-3.5" /> Ata
                  </button>
                  <button onClick={handleDeleteSelected} className="neu-btn-universal neu-text-destructive px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1">
                    <Trash2 className="h-3.5 w-3.5" /> Sil
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Brand Chips ── */}
          <div className="w-full overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-1.5 pb-1 min-w-max px-1">
              <button
                onClick={() => setSelectedBrandTab('ALL')}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                  selectedBrandTab === 'ALL'
                    ? "bg-[var(--device-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                    : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] hover:shadow-[var(--dashboard-raised-soft)]"
                )}
              >
                Tümü <span className="ml-0.5 opacity-80">{brandTabOptions.total}</span>
              </button>
              {brandTabOptions.items.map(({ brand, count }) => (
                <button
                  key={brand}
                  onClick={() => setSelectedBrandTab(brand)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                    selectedBrandTab === brand
                      ? "bg-[var(--device-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                      : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] hover:shadow-[var(--dashboard-raised-soft)]"
                  )}
                >
                  {brand} <span className="ml-0.5 opacity-80">{count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Table (Desktop) ── */}
          {isLoading ? (
            <div className="cihaz-card flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--device-accent)]" />
              <span className="ml-2 text-sm text-[var(--dashboard-muted)]">Yükleniyor...</span>
            </div>
          ) : filteredProductCodes.length === 0 ? (
            <div className="cihaz-card flex flex-col items-center justify-center py-16 text-center px-4">
              <Barcode className="h-12 w-12 text-[var(--dashboard-muted)] opacity-30 mb-3" />
              <p className="text-sm font-semibold text-[var(--dashboard-text)]">Ürün bulunamadı</p>
              <p className="text-xs text-[var(--dashboard-muted)] mt-1">Arama veya filtre kriterlerinizi değiştirin</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block cihaz-card overflow-hidden" style={{ paddingBottom: '80px' }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="sticky top-0 z-10 bg-[var(--dashboard-surface)] backdrop-blur-sm">
                        <th className="w-10 px-3 py-3 text-left">
                          <Checkbox
                            checked={allSelected ? true : (someSelected ? 'indeterminate' : false)}
                            onCheckedChange={handleSelectAll}
                          />
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] sticky left-0 bg-[var(--dashboard-surface)]">Stok Kodu</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">Stok Adı</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">Ürün Grubu</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">Marka</th>
                        {viewMode === 'comfortable' && (
                          <>
                            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">Barkod</th>
                            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">Test Grubu</th>
                            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">Cihaz Grubu</th>
                          </>
                        )}
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] w-14"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--dashboard-stroke)]">
                      {filteredProductCodes.map(p => (
                        <tr
                          key={p.id}
                          className={cn(
                            "group transition-colors hover:bg-[var(--dashboard-surface-2)]/50",
                            selectedProductIds.has(p.id) && "bg-[var(--device-accent-weak)]",
                            viewMode === 'compact' ? "h-10" : "h-14"
                          )}
                        >
                          <td className="px-3">
                            <Checkbox
                              checked={selectedProductIds.has(p.id)}
                              onCheckedChange={(checked) => handleRowSelect(p.id, !!checked)}
                            />
                          </td>
                          <td className="px-3 font-mono text-xs text-[var(--dashboard-text)] sticky left-0 bg-inherit">{p.stokKodu}</td>
                          <td className="px-3 font-medium text-[var(--dashboard-text)] max-w-[280px] truncate">{p.stokAdi}</td>
                          <td className="px-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                              p.urunGrubu === 'kit' && "bg-blue-100 text-blue-700",
                              p.urunGrubu === 'sarf' && "bg-emerald-100 text-emerald-700",
                              p.urunGrubu === 'yedek_parca' && "bg-violet-100 text-violet-700",
                            )}>
                              {p.urunGrubu === 'yedek_parca' ? 'yedek parça' : p.urunGrubu}
                            </span>
                          </td>
                          <td className="px-3 text-[var(--dashboard-text)] text-xs">{p.marka || '—'}</td>
                          {viewMode === 'comfortable' && (
                            <>
                              <td className="px-3">{renderBarcodeFormats(p)}</td>
                              <td className="px-3 text-xs text-[var(--dashboard-muted)]">{p.testGrubu || '—'}</td>
                              <td className="px-3 text-xs text-[var(--dashboard-muted)]">{p.cihazGrubu || '—'}</td>
                            </>
                          )}
                          <td className="px-3 text-right">
                            <RowActionsMenu
                              product={p}
                              onEdit={openModal}
                              onDelete={handleDelete}
                              onDuplicate={handleDuplicate}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Results count */}
                <div className="px-4 py-2.5 border-t border-[var(--dashboard-stroke)] text-xs text-[var(--dashboard-muted)]">
                  {filteredProductCodes.length} / {productCodes.length} ürün gösteriliyor
                </div>
              </div>

              {/* Mobile Card List */}
              <div className="md:hidden space-y-2" style={{ paddingBottom: '80px' }}>
                {/* Select All */}
                <div className="flex items-center gap-2 px-1">
                  <Checkbox
                    checked={allSelected ? true : (someSelected ? 'indeterminate' : false)}
                    onCheckedChange={handleSelectAll}
                  />
                  <span className="text-xs text-[var(--dashboard-muted)]">
                    {filteredProductCodes.length} ürün
                  </span>
                </div>
                {filteredProductCodes.map(p => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    isSelected={selectedProductIds.has(p.id)}
                    onSelect={(checked) => handleRowSelect(p.id, !!checked)}
                    onEdit={openModal}
                    onDelete={handleDelete}
                    onDuplicate={handleDuplicate}
                    barcodeFormats={barcodeFormats}
                  />
                ))}
                <div className="text-xs text-center text-[var(--dashboard-muted)] py-2">
                  {filteredProductCodes.length} / {productCodes.length} ürün
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ CHECKPOINT TAB ═══════════════ */}
      {activeTab === 'checkpoint' && (
        <div className="space-y-4">
          {/* Checkpoint Save Card */}
          <div className="cihaz-card-strong p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[var(--dashboard-text)] flex items-center gap-2">
                <Calendar className="h-5 w-5 text-[var(--device-accent)]" />
                Maliyet Checkpoint Kaydet
              </h2>
              <p className="text-xs text-[var(--dashboard-muted)] mt-1">
                Aylık maliyet snapshot'ları alarak verimlilik hesaplamalarında tarihsel maliyet verilerini kullanın.
              </p>
            </div>

            {/* Info banner */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <div className="w-10 h-10 rounded-xl bg-[var(--device-accent-weak)] flex items-center justify-center flex-shrink-0">
                <Save className="h-5 w-5 text-[var(--device-accent)]" />
              </div>
              <div className="text-xs text-[var(--dashboard-text)]">
                <p className="font-semibold">{productCodes.filter(p => p.cost && p.cost > 0).length} ürünün maliyeti tanımlı</p>
                <p className="text-[var(--dashboard-muted)] mt-0.5">Toplam {productCodes.length} kayıtlı ürün</p>
              </div>
            </div>

            {/* Period Selectors */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] block mb-1.5">Dönem Ayı</label>
                <Select value={String(selectedCheckpointMonth)} onValueChange={v => setSelectedCheckpointMonth(Number(v))}>
                  <SelectTrigger className="bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i} value={String(i)}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] block mb-1.5">Dönem Yılı</label>
                <Select value={String(selectedCheckpointYear)} onValueChange={v => setSelectedCheckpointYear(Number(v))}>
                  <SelectTrigger className="bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <button
                  onClick={handleSaveCostCheckpoint}
                  disabled={isSavingCheckpoint || productCodes.length === 0}
                  className="neu-btn-universal neu-text-primary w-full px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSavingCheckpoint ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {MONTHS[selectedCheckpointMonth]?.label} {selectedCheckpointYear} Kaydet
                </button>
              </div>
            </div>
          </div>

          {/* Checkpoint History */}
          <div className="cihaz-card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--dashboard-stroke)]">
              <h3 className="text-sm font-bold text-[var(--dashboard-text)]">Kayıtlı Checkpoint'ler ({costCheckpoints.length})</h3>
            </div>
            {costCheckpoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Calendar className="h-10 w-10 text-[var(--dashboard-muted)] opacity-30 mb-3" />
                <p className="text-sm text-[var(--dashboard-muted)]">Henüz maliyet checkpoint'i kaydedilmemiş.</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--dashboard-stroke)]">
                {costCheckpoints.map(cp => (
                  <div key={cp.id} className="flex items-center justify-between px-4 py-3 hover:bg-[var(--dashboard-surface-2)]/50 transition-colors">
                    <div>
                      <p className="text-sm font-semibold text-[var(--dashboard-text)]">
                        {MONTHS[cp.month]?.label} {cp.year}
                      </p>
                      <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
                        {cp.createdAt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                      {cp.productCount} ürün
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════ MODALS ═══════════════ */}
      {isModalOpen && (
        <ProductFormatModal
          open={isModalOpen}
          initial={selectedProduct}
          onSave={handleSave}
          onClose={() => setIsModalOpen(false)}
          productCodes={productCodes}
          definitions={definitions}
          versions={versionsByGroup.get(getVersionGroupId(selectedProduct)) || []}
          onSetActiveVersion={handleSetActiveVersion}
        />
      )}
      <FiltreDialog
        isOpen={isFilterDialogOpen}
        onClose={() => setIsFilterDialogOpen(false)}
        availableGroups={availableFilterGroups}
        onApply={setActiveFilters}
        currentFilters={activeFilters}
      />
    </>
  );
}
