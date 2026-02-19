
'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense, ChangeEvent } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type {
  Depot,
  ProductCode,
  DepoStokItem,
  MinMaxRule,
  AddressDefinition,
  ConsumptionRecord,
  Hospital,
} from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
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
import { collection, getDocs, query, where, writeBatch, doc, addDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AlertTriangle, PackageSearch, Search, Warehouse, Trash2, FileSpreadsheet, Loader2, Map as MapIcon, SlidersHorizontal, X, Building, ShoppingCart, Truck, ChevronUp, ChevronDown, History, Pencil, Save, XCircle, Filter, Nfc, ListChecks, Undo } from 'lucide-react';
import { exportDataToExcel } from '@/lib/utils';
import { differenceInDays, parse, compareAsc, isValid } from 'date-fns';
import BorcDepotPanel from './BorcDepotPanel';
import debounce from 'lodash.debounce';
import { useAuth } from '@/contexts/auth-context';
import { saveManualChangeSnapshot } from '@/lib/depotCountHistory';
import { Badge } from './ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';
import MinMaxSettingsPanel from './MinMaxSettingsPanel';
import MapDefinitionModal from './MapDefinitionModal';
import NfcStockQueryModal from './NfcStockQueryModal';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { generateId } from '@/lib/utils';

interface GroupedStock {
  [key: string]: {
    stokAdi: string;
    stokKodu: string;
    lotNumarasi: string;
    miad: string;
    anaBirim: string;
    rafAdresi: string;
    items: DepoStokItem[];
  };
}

interface Filter {
  group: 'marka' | 'urunGrubu';
  value: string;
}

const FiltreDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  availableGroups: Record<string, string[]>;
  onApply: (filters: Filter[]) => void;
}> = ({ isOpen, onClose, availableGroups, onApply }) => {
  const [selectedFilters, setSelectedFilters] = useState<Filter[]>([]);

  const handleDragStart = (e: React.DragEvent, group: 'marka' | 'urunGrubu', value: string) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ group, value }));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('application/json')) as Filter;
    if (!selectedFilters.some(f => f.group === data.group && f.value === data.value)) {
      setSelectedFilters(prev => [...prev, data]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const removeFilter = (filterToRemove: Filter) => {
    setSelectedFilters(prev => prev.filter(f => !(f.group === filterToRemove.group && f.value === filterToRemove.value)));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl">
            <DialogHeader>
                <DialogTitle className="text-xl font-headline">Stoğu Filtrele</DialogTitle>
                <DialogDescription>Filtrelemek istediğiniz değerleri sağdaki alandan soldaki "Seçilen Filtreler" kutusuna sürükleyin.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                <div
                    className="border-2 border-dashed border-muted rounded-lg p-4 min-h-[250px] flex flex-col gap-2"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                >
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
                                    <button onClick={() => removeFilter(f)} className="ml-2 rounded-full hover:bg-primary/20 p-0.5">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="space-y-4 max-h-[300px] overflow-y-auto p-1 glass-scroll">
                    {Object.entries(availableGroups).map(([group, items]) => (
                        <div key={group}>
                          <h3 className="font-semibold mb-2">{group === 'marka' ? 'Marka' : 'Ürün Grubu'}</h3>
                          <div className="flex flex-wrap gap-2 mt-2">
                              {items.map(item => (
                                  <div
                                      key={item}
                                      draggable
                                      onDragStart={e => handleDragStart(e, group as 'marka' | 'urunGrubu', item)}
                                      className="px-3 py-1 bg-background border rounded-md cursor-move text-sm shadow-sm hover:bg-accent hover:text-accent-foreground"
                                  >
                                      {item}
                                  </div>
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


export default function StokYonetimiPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [depots, setDepots] = useState<Depot[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [addressDefinitions, setAddressDefinitions] = useState<AddressDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStockLoading, setIsStockLoading] = useState(false);
  const [depotStock, setDepotStock] = useState<DepoStokItem[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [minMaxRules, setMinMaxRules] = useState<Record<string, MinMaxRule>>({});
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Filter[]>([]);
  const [sortBy, setSortBy] = useState<keyof DepoStokItem>('miad');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const rowsPerPageOptions = [20, 30, 50, 100];
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editingQuantity, setEditingQuantity] = useState<number | string>('');
  const [colorFilter, setColorFilter] = useState<'none' | 'nearMin' | 'expiringSoon' | 'expiringVerySoon'>('none');
  const [isNfcQueryModalOpen, setIsNfcQueryModalOpen] = useState(false);
  const [isLabCountModalOpen, setIsLabCountModalOpen] = useState(false);
  const [selectedLabsForReport, setSelectedLabsForReport] = useState<string[]>([]);

  const debouncedSearch = useCallback(debounce((term) => setDebouncedSearchTerm(term), 300), []);
  useEffect(() => { debouncedSearch(searchTerm); }, [searchTerm, debouncedSearch]);

  // Fetch master data (depots, products, addresses, hospitals) - runs once
  const fetchMasterData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [depotsSnap, productsSnap, addressesSnap, hospitalsSnap] = await Promise.all([
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'addressDefinitions')),
        getDocs(collection(db, 'hospitals')),
      ]);
      const depotList = depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
      setDepots(depotList);
      setProductCodes(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
      setAddressDefinitions(addressesSnap.docs.map(d => ({ id: d.id, ...d.data() } as AddressDefinition)));
      setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));

      if (depotList.length > 0 && !selectedDepotId && depotList[0]?.id) {
        setSelectedDepotId(depotList[0].id);
      }
    } catch (e) {
      toast({ title: 'Veri Yükleme Hatası', description: 'Gerekli ana veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, selectedDepotId]);

  useEffect(() => {
    fetchMasterData();
  }, [fetchMasterData]);

  /**
   * Fetch depot stock with server-side filtering
   * Uses composite index: depotId + isShipped
   */
  const fetchDepotStock = useCallback(async (depotId: string) => {
    if (!depotId) {
      setDepotStock([]);
      return;
    }
    setIsStockLoading(true);
    try {
      // Server-side query: only fetch unshipped items for selected depot
      const stockQuery = query(
        collection(db, 'depoStok'),
        where('depotId', '==', depotId),
        where('isShipped', '==', false)
      );
      const snapshot = await getDocs(stockQuery);
      const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
      setDepotStock(items);
    } catch (e) {
      console.error('Depo stoğu yüklenemedi:', e);
      toast({ title: 'Hata', description: 'Depo stoğu yüklenemedi.', variant: 'destructive' });
      setDepotStock([]);
    } finally {
      setIsStockLoading(false);
    }
  }, [toast]);

  // Fetch depot stock when depot changes
  useEffect(() => {
    if (selectedDepotId) {
      fetchDepotStock(selectedDepotId);
    }
  }, [selectedDepotId, fetchDepotStock]);

  useEffect(() => {
    if (!selectedDepotId) return;
    const fetchRules = async () => {
      const rules: Record<string, MinMaxRule> = {};
      try {
        const rulesRef = collection(db, "depots", selectedDepotId, "minMaxRules");
        const snapshot = await getDocs(rulesRef);
        snapshot.forEach(doc => {
          const rule = doc.data() as MinMaxRule;
          if (rule.stokKodu) rules[rule.stokKodu] = rule;
        });
        setMinMaxRules(rules);
      } catch (e) { console.error("Error fetching depot min-max rules:", e); }
    };
    fetchRules();
  }, [selectedDepotId]);

  const handleStartEditing = (group: (typeof sortedAndGroupedStock)[0]) => {
    setEditingRowKey(group.key);
    setEditingQuantity(group.items.length);
  };

  const handleCancelEditing = () => {
    setEditingRowKey(null);
    setEditingQuantity('');
  };

  const depotName = depots.find(d => d.id === selectedDepotId)?.name || '';

  const handleQuantityChange = async (group: (typeof sortedAndGroupedStock)[0]) => {
    const newQuantity = typeof editingQuantity === 'string' ? parseInt(editingQuantity, 10) : editingQuantity;
    if (newQuantity < 0 || !Number.isInteger(newQuantity)) {
      toast({ title: "Hata", description: "Geçersiz adet.", variant: "destructive" });
      return;
    }
    const currentQuantity = group.items.length;
    const diff = newQuantity - currentQuantity;
    if (diff === 0) {
      handleCancelEditing();
      return;
    }
    setIsLoading(true);
    const batch = writeBatch(db);
    try {
      if (diff > 0) { // Add items
        const newItemTemplate: Omit<DepoStokItem, 'id'> = {
          depotId: selectedDepotId,
          depotName: depotName,
          stokKodu: group.stokKodu,
          stokAdi: group.stokAdi,
          lotNumarasi: group.lotNumarasi,
          miad: group.miad,
          rafAdresi: group.rafAdresi,
          seriNumarasi: '',
          eklenmeTarihi: new Date(),
          irsaliyeNumarasi: group.items[0]?.irsaliyeNumarasi || `MANUEL_EKLEME_${new Date().toISOString()}`,
          isShipped: false,
        };
        for (let i = 0; i < diff; i++) {
          const newDocRef = doc(collection(db, 'depoStok'));
          batch.set(newDocRef, { ...newItemTemplate, seriNumarasi: `MANUEL-${generateId()}` });
        }
      } else { // Remove items
        const itemsToRemove = group.items.slice(0, Math.abs(diff));
        itemsToRemove.forEach(item => {
          if (item.id) {
            batch.delete(doc(db, 'depoStok', item.id));
          }
        });
      }
      await batch.commit();

      await saveManualChangeSnapshot({
        depotId: selectedDepotId,
        depotName,
        user: { id: currentUserProfile?.uid || 'system', name: currentUserProfile?.name || 'Sistem' },
        item: {
          stokKodu: group.stokKodu,
          stokAdi: group.stokAdi,
          lotNumarasi: group.lotNumarasi,
          miad: group.miad,
          previousQuantity: currentQuantity,
          newQuantity,
        }
      });
      toast({ title: 'Başarılı', description: `${group.stokAdi} adedi güncellendi.` });
      await fetchDepotStock(selectedDepotId); // Refetch to get the latest state
    } catch (error) {
      toast({ title: "Hata", description: "Adet güncellenirken hata oluştu.", variant: "destructive" });
      console.error(error);
    } finally {
      setIsLoading(false);
      handleCancelEditing();
    }
  };


  const handleSort = (column: keyof DepoStokItem) => {
    if (sortBy === column) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const availableFilterGroups = useMemo(() => {
    const markaSet = new Set<string>();
    const urunGrubuSet = new Set<'kit' | 'sarf'>();
    productCodes.forEach(p => {
        if(p.marka) markaSet.add(p.marka);
        if(p.urunGrubu) urunGrubuSet.add(p.urunGrubu);
    });
    return {
        marka: Array.from(markaSet).sort(),
        urunGrubu: Array.from(urunGrubuSet).sort()
    };
  }, [productCodes]);

  const filteredStock = useMemo(() => {
    // depotStock is already filtered by depotId and isShipped on server-side
    let items = depotStock;
    if (activeFilters.length > 0) {
      const productCodeMap = new Map<string, ProductCode>(
        productCodes
          .filter(p => p.stokKodu !== undefined)
          .map(p => [p.stokKodu!, p] as const)
      );
      items = items.filter(item => {
        if (!item.stokKodu) return false;
        const product = productCodeMap.get(item.stokKodu);
        if (!product) return false;
        return activeFilters.every(filter => {
          if (filter.group === 'marka') return product.marka === filter.value;
          if (filter.group === 'urunGrubu') return product.urunGrubu === filter.value;
          return true;
        });
      });
    }
    if (debouncedSearchTerm) {
      const term = debouncedSearchTerm.toLowerCase();
      items = items.filter(item =>
        item.stokKodu?.toLowerCase().includes(term) ||
        item.stokAdi?.toLowerCase().includes(term) ||
        item.rafAdresi?.toLowerCase().includes(term) ||
        item.lotNumarasi?.toLowerCase().includes(term) ||
        item.seriNumarasi?.toLowerCase().includes(term)
      );
    }
    return items;
  }, [depotStock, activeFilters, debouncedSearchTerm, productCodes]);

  const sortedStock = useMemo(() => {
    return [...filteredStock].sort((a, b) => {
      const aIsEmpty = !a.lotNumarasi && !a.miad;
      const bIsEmpty = !b.lotNumarasi && !b.miad;
      if (aIsEmpty && !bIsEmpty) return 1;
      if (!aIsEmpty && bIsEmpty) return -1;
      const valA = a[sortBy] ?? '';
      const valB = b[sortBy] ?? '';
      if (sortBy === 'miad') {
        try {
          const dateA = parse(String(valA), 'dd.MM.yyyy', new Date());
          const dateB = parse(String(valB), 'dd.MM.yyyy', new Date());
          if (isValid(dateA) && isValid(dateB)) {
            return sortOrder === 'asc' ? compareAsc(dateA, dateB) : compareAsc(dateB, dateA);
          }
        } catch { /* fallback to string compare */ }
      }
      return sortOrder === 'asc' ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
    });
  }, [filteredStock, sortBy, sortOrder]);

  const groupedStock = useMemo(() => {
    return sortedStock.reduce((acc: GroupedStock, item) => {
      const key = `${item.stokKodu}-${item.lotNumarasi}-${item.miad}`;
      if (!acc[key]) {
        const productInfo = productCodes.find(p => p.stokKodu === item.stokKodu);
        acc[key] = {
          stokKodu: item.stokKodu || '',
          stokAdi: item.stokAdi || '',
          lotNumarasi: item.lotNumarasi || '',
          miad: (item.miad as string) || '',
          anaBirim: productInfo?.anaBirim || 'Kutu',
          rafAdresi: item.rafAdresi || '',
          items: [],
        };
      }
      acc[key].items.push(item);
      return acc;
    }, {});
  }, [sortedStock, productCodes]);

  const totalStockByProductCode = useMemo(() => {
    return depotStock.reduce<Record<string, number>>((acc, item) => {
      if (!item.stokKodu) return acc;
      acc[item.stokKodu] = (acc[item.stokKodu] || 0) + 1;
      return acc;
    }, {});
  }, [depotStock]);

  const getCoverageDaysLabel = useCallback((stokKodu: string): string => {
    const rule = minMaxRules[stokKodu];
    if (!rule || !rule.max || !rule.maxGun) return '-';

    const totalProductStock = totalStockByProductCode[stokKodu] || 0;
    const periodDays = Math.floor(rule.maxGun);
    if (periodDays <= 0) return '-';

    const today = new Date();
    const businessDays = Array.from({ length: periodDays }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() + index + 1);
      const day = date.getDay();
      return day !== 0 && day !== 6;
    }).filter(Boolean).length;

    if (businessDays <= 0) return '-';

    const dailyNeed = rule.max / businessDays;
    if (dailyNeed <= 0) return '-';

    const coverageDays = Math.floor(totalProductStock / dailyNeed);
    return `${coverageDays} gün`;
  }, [minMaxRules, totalStockByProductCode]);

  const sortedAndGroupedStock = useMemo(() => {
    let baseList = Object.values(groupedStock).map(g => ({ ...g, key: `${g.stokKodu}-${g.lotNumarasi}-${g.miad}` }));
    if (colorFilter !== 'none') {
      baseList = baseList.filter(group => {
        const rule = minMaxRules[group.stokKodu];
        const miadDate = parse(group.miad || '', 'dd.MM.yyyy', new Date());
        const days = isValid(miadDate) ? differenceInDays(miadDate, new Date()) : Infinity;
        const nearMin = rule && rule.min !== undefined && group.items.length <= rule.min;
        if (colorFilter === 'nearMin' && nearMin) return true;
        if (colorFilter === 'expiringSoon' && days >= 45 && days < 60) return true;
        if (colorFilter === 'expiringVerySoon' && days < 45) return true;
        return false;
      });
    }
    return baseList;
  }, [groupedStock, colorFilter, minMaxRules]);

  const totalPages = Math.ceil(sortedAndGroupedStock.length / rowsPerPage);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return sortedAndGroupedStock.slice(start, start + rowsPerPage);
  }, [sortedAndGroupedStock, currentPage, rowsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [rowsPerPage, debouncedSearchTerm, activeFilters, sortBy, sortOrder]);
  
  const handleLabCountExport = async () => {
    if (selectedLabsForReport.length === 0) {
      toast({ title: 'Laboratuvar Seçilmedi', description: 'Lütfen rapor için en az bir laboratuvar seçin.', variant: "default" });
      return;
    }

    const labNames = hospitals
      .filter(h => h.id && selectedLabsForReport.includes(h.id))
      .map(h => h.name)
      .filter((name): name is string => name !== undefined);

    // Fetch shipped stock for selected labs (server-side query)
    let stockForSelectedLabs: DepoStokItem[] = [];
    try {
      const shippedQuery = query(
        collection(db, 'depoStok'),
        where('isShipped', '==', true)
      );
      const shippedSnap = await getDocs(shippedQuery);
      stockForSelectedLabs = shippedSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as DepoStokItem))
        .filter(item => item.hedefKurum && labNames.includes(item.hedefKurum));
    } catch (e) {
      toast({ title: 'Hata', description: 'Laboratuvar stoğu yüklenemedi.', variant: 'destructive' });
      return;
    }
    const stockSummary: Record<string, { stokAdi: string, quantity: number }> = {};

    stockForSelectedLabs.forEach(item => {
      const stokKodu = item.stokKodu;
      if (!stokKodu) return;
      if (!stockSummary[stokKodu]) {
        stockSummary[stokKodu] = {
          stokAdi: productCodes.find(p => p.stokKodu === item.stokKodu)?.stokAdi || item.stokAdi || '',
          quantity: 0
        };
      }
      stockSummary[stokKodu].quantity += 1;
    });
  
    const dataToExport = Object.entries(stockSummary).map(([stokKodu, data]) => ({
      'Stok Kodu': stokKodu,
      'Stok Adı': data.stokAdi,
      'Toplam Adet': data.quantity
    })).sort((a,b) => a['Stok Adı'].localeCompare(b['Stok Adı']));
  
    if (dataToExport.length === 0) {
      toast({ title: 'Veri Yok', description: 'Seçilen laboratuvarlar için stok bulunamadı.', variant: "default" });
      return;
    }
  
    exportDataToExcel(dataToExport, `Secili_Lab_Stok_Raporu`, "LabStokRaporu", toast);
    setIsLabCountModalOpen(false);
  };
  
  const handleExport = (detailed: boolean) => {
    const dataToExportSource = Object.values(groupedStock);
    if (dataToExportSource.length === 0) {
      toast({ title: "Veri Yok", description: "Dışa aktarılacak stok verisi bulunamadı.", variant: "default" });
      return;
    }
    const fileName = `${depotName}_Stok_Raporu_${detailed ? 'Detayli' : 'Ozet'}`;
    const productCodeMap = new Map<string, ProductCode>(
      productCodes
        .filter(p => p.stokKodu !== undefined)
        .map(p => [p.stokKodu!, p] as const)
    );
    if (detailed) {
      const dataToExport = dataToExportSource.flatMap(group => group.items)
        .map(item => ({
          'Stok Kodu': item.stokKodu || '',
          'Stok Adı': item.stokAdi || '',
          'Lot Numarası': item.lotNumarasi || '',
          'Miad': item.miad || '',
          'Seri Numarası': item.seriNumarasi || '',
          'Raf Adresi': item.rafAdresi || '',
        }))
        .sort((a, b) => (a['Stok Adı'] || '').localeCompare(b['Stok Adı'] || ''));
      exportDataToExcel(dataToExport, fileName, "StokRaporu", toast);
    } else {
      const sheets: Record<string, any[]> = {};
      dataToExportSource.forEach(group => {
        const product = productCodeMap.get(group.stokKodu);
        const brand = product?.marka || 'Diğer';
        if (!sheets[brand]) {
          sheets[brand] = [];
        }
        sheets[brand].push({
          'Stok Kodu': group.stokKodu,
          'Stok Adı': group.stokAdi,
          'Lot Numarası': group.lotNumarasi,
          'Miad': group.miad,
          'Miktar': group.items.length,
          'Birim': group.anaBirim,
        });
      });
      for (const brand in sheets) {
        sheets[brand].sort((a, b) => a['Stok Adı'].localeCompare(b['Stok Adı']));
      }
      exportDataToExcel(sheets, fileName, toast);
    }
  };

  const getRowClass = (group: (typeof sortedAndGroupedStock)[0]): string => {
    const rule = minMaxRules[group.stokKodu];
    const miadDate = parse(group.miad || '', 'dd.MM.yyyy', new Date());
    if (!isValid(miadDate)) return '';
    const days = differenceInDays(miadDate, new Date());
    if (days < 45) return 'bg-red-500/10 text-red-700 dark:text-red-300';
    if (days < 60) return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
    if (rule && rule.min !== undefined && group.items.length <= rule.min) return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
    return '';
  };

  const ColorLegend = () => (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <div onClick={() => setColorFilter(colorFilter === 'expiringVerySoon' ? 'none' : 'expiringVerySoon')} className={cn("flex items-center gap-1 cursor-pointer", colorFilter === 'expiringVerySoon' && 'font-bold text-foreground')}>
        <div className="w-3 h-3 rounded-full bg-red-300/50 border border-red-500" /> Miad &lt; 45 gün
      </div>
      <div onClick={() => setColorFilter(colorFilter === 'expiringSoon' ? 'none' : 'expiringSoon')} className={cn("flex items-center gap-1 cursor-pointer", colorFilter === 'expiringSoon' && 'font-bold text-foreground')}>
        <div className="w-3 h-3 rounded-full bg-yellow-300/50 border border-yellow-500" /> Miad &lt; 60 gün
      </div>
      <div onClick={() => setColorFilter(colorFilter === 'nearMin' ? 'none' : 'nearMin')} className={cn("flex items-center gap-1 cursor-pointer", colorFilter === 'nearMin' && 'font-bold text-foreground')}>
        <div className="w-3 h-3 rounded-full bg-gray-300/50 border border-gray-500" /> Min. Stok Yakın
      </div>
      {colorFilter !== 'none' && <Button variant="ghost" size="sm" onClick={() => setColorFilter('none')} className="text-xs h-auto py-0">Filtreyi Temizle</Button>}
    </div>
  );

  return (
    <>
      <Card className="shadow-lg">
        <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center">
          <div>
            <CardTitle className="text-xl font-headline flex items-center"><PackageSearch className="mr-2 h-7 w-7 text-primary" />Depo Stoğu ({depotName})</CardTitle>
            <CardDescription>Depodaki tüm sevk edilmemiş ürünler.</CardDescription>
          </div>
          <div className="flex gap-2 mt-2 sm:mt-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><SlidersHorizontal className="mr-2 h-4 w-4" />İşlemler</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setIsFilterDialogOpen(true)}>Filtrele</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push('/depo-sayim')}>Marka Sayımı Yap</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsLabCountModalOpen(true)}>Laboratuvar Sayımı İndir</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Rapor İndir</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => handleExport(false)}>Özet Rapor</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExport(true)}>Detaylı (Seri No) Rapor</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="icon" onClick={() => setIsNfcQueryModalOpen(true)}><Nfc className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4 items-end mb-4">
            <div>
              <Label>Ara</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Stok adı, kodu, raf, lot veya seri no ile ara..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="flex items-end justify-between">
              <ColorLegend />
            </div>
          </div>

          {(isLoading || isStockLoading) ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-10 w-10 animate-spin mb-2" />
              <p>{isLoading ? 'Veriler yükleniyor...' : 'Depo stoğu yükleniyor...'}</p>
            </div>
          ) : (
            <div className="q-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stok Adı</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Miad</TableHead>
                    <TableHead>Adet</TableHead>
                    <TableHead>Raf Adresi</TableHead>
                    <TableHead>Stok Yeterlilik</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10">
                        Sonuç bulunamadı.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedData.map((g) => (
                      <TableRow key={g.key} className={getRowClass(g)}>
                        <TableCell data-label="Stok Adı" data-primary="true">
                          {g.stokAdi}
                          <span className="block text-xs text-muted-foreground font-mono">
                            ({g.stokKodu})
                          </span>
                        </TableCell>
                        <TableCell data-label="Lot">{g.lotNumarasi}</TableCell>
                        <TableCell data-label="Miad">{g.miad}</TableCell>
                        <TableCell data-label="Adet">
                          {editingRowKey === g.key ? (
                            <Input
                              type="number"
                              value={editingQuantity}
                              onChange={(e) => setEditingQuantity(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-20 h-8"
                            />
                          ) : (
                            <Badge variant="outline" className="font-bold text-foreground dark:text-white bg-background">{g.items.length} {g.anaBirim}</Badge>
                          )}
                        </TableCell>
                        <TableCell data-label="Raf">{g.rafAdresi}</TableCell>
                        <TableCell data-label="Stok Yeterlilik">{getCoverageDaysLabel(g.stokKodu)}</TableCell>
                        <TableCell data-label="İşlemler" className="text-right">
                          <div className="flex gap-1 justify-end">
                            {editingRowKey === g.key ? (
                              <>
                                <Button size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleQuantityChange(g); }}>
                                  <Save className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleCancelEditing(); }}>
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); router.push(`/stok-yonetimi/${selectedDepotId}/${encodeURIComponent(g.stokKodu)}/${encodeURIComponent(g.lotNumarasi || '')}`); }}>
                                  Detay
                                </Button>
                                <Button size="icon" className="h-8 w-8" variant="ghost" onClick={(e) => { e.stopPropagation(); handleStartEditing(g); }}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <div className="flex items-center space-x-2 text-sm">
              <span>Sayfa başına:</span>
              <Select value={String(rowsPerPage)} onValueChange={v => { setRowsPerPage(Number(v)); setCurrentPage(1);}}>
                  <SelectTrigger className="w-20"><SelectValue/></SelectTrigger>
                  <SelectContent>{rowsPerPageOptions.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
          </div>
          <div className="flex items-center space-x-2">
              <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage <= 1}>Önceki</Button>
              <span className="text-sm">Sayfa {currentPage} / {totalPages}</span>
              <Button size="sm" variant="outline" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage >= totalPages}>Sonraki</Button>
          </div>
        </CardFooter>
      </Card>
      
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
        allStock={depotStock}
      />
       <Dialog open={isLabCountModalOpen} onOpenChange={setIsLabCountModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Laboratuvar Sayım Raporu</DialogTitle>
            <DialogDescription>
              Stoklarını birleşik olarak görmek istediğiniz laboratuvarları seçin.
            </DialogDescription>
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
                      setSelectedLabsForReport(prev =>
                        checked ? [...prev, lab.id!] : prev.filter(id => id !== lab.id)
                      );
                    }}
                  />
                  <Label htmlFor={`lab-select-${lab.id}`}>{lab.name}</Label>
                </div>
              ))}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLabCountModalOpen(false)}>İptal</Button>
            <Button onClick={handleLabCountExport} disabled={selectedLabsForReport.length === 0}>
              Rapor Oluştur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
