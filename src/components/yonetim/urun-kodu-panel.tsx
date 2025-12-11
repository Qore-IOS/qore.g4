
'use client';
import React, { useState, useEffect, useCallback, ChangeEvent, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { PlusCircle, Edit3, Trash2, Loader2, Barcode, Download, Upload, BookText, Search, Filter, X, Type } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { collection, getDocs, deleteDoc, doc, writeBatch, setDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { ProductCode } from '@/lib/types';
import { ProductFormatModal } from '@/components/ProductFormatModal';
import { readExcelDataSmart } from '@/lib/utils';
import { trackingModeFromExcel, trackingModeToExcel, TRACKING_MODE_LABEL, TrackingMode } from '@/lib/tracking';
import * as XLSX from 'xlsx';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent as FilterDialogContent, DialogHeader as FilterDialogHeader, DialogTitle as FilterDialogTitle, DialogFooter as FilterDialogFooter, DialogDescription as FilterDialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import debounce from 'lodash.debounce';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';


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
        <FilterDialogContent className="max-w-3xl">
            <FilterDialogHeader>
                <FilterDialogTitle className="text-xl font-headline">Stoğu Filtrele</FilterDialogTitle>
                <FilterDialogDescription>Filtrelemek istediğiniz değerleri sağdaki alandan soldaki "Seçilen Filtreler" kutusuna sürükleyin.</FilterDialogDescription>
            </FilterDialogHeader>
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
            <FilterDialogFooter>
                <Button variant="outline" onClick={onClose}>İptal</Button>
                <Button onClick={() => { onApply(selectedFilters); onClose(); }}>Filtreleri Uygula</Button>
            </FilterDialogFooter>
        </FilterDialogContent>
    </Dialog>
  );
};

export default function UrunKoduPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
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

  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [bulkTrackingMode, setBulkTrackingMode] = useState<TrackingMode>('serial');


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

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const openModal = (product?: ProductCode) => {
    setSelectedProduct(product || {});
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
        fetchAllData(); // Veriyi yenile
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
        definitions.brands.length,
        definitions.labGroups.length,
        definitions.testGroups.length,
        definitions.deviceGroups.length,
        definitions.productGroups.length,
        definitions.mainUnits.length,
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
          if (!stokKodu) {
            errorCount++;
            continue;
          }
  
          const stokAdi = String(row['stokadi'] || row['stokadı'] || '').trim();
          const urunGrubu: 'kit' | 'sarf' = String(row['urungrubu'] || row['ürüngrubu'] || 'kit').toLowerCase().includes('sarf') ? 'sarf' : 'kit';
          const ambalajDegeri = parseNum(row['ambalajdegeri'] ?? row['ambalajdeğeri']);
          
          if (urunGrubu === 'kit' && mode === 'add' && (!ambalajDegeri || ambalajDegeri <= 0)) {
            toast({ title: "Uyarı", description: `Kit ${stokKodu} için geçersiz ambalaj değeri. Satır atlandı.`, variant: "default" });
            errorCount++;
            continue;
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
          };
          
          const cleanedProductData = Object.fromEntries(
            Object.entries(productData).filter(([, value]) => value !== undefined)
          );

          const existing = productCodes.find(p => p.stokKodu === stokKodu);
  
          if (mode === 'update') {
            if (existing) {
              batch.set(doc(db, 'productCodes', existing.id), cleanedProductData, { merge: true });
              updatedCount++;
            } else { skippedCount++; }
          } else { // add mode
            if (existing) { skippedCount++; } 
            else {
              batch.set(doc(collection(db, 'productCodes')), cleanedProductData);
              successCount++;
            }
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

  const filteredProductCodes = useMemo(() => {
    let items = productCodes;
    
    // Brand Tab Filter
    if (selectedBrandTab !== 'ALL') {
        if (selectedBrandTab === 'Diğer') {
            items = items.filter(p => !p.marka);
        } else {
            items = items.filter(p => p.marka === selectedBrandTab);
        }
    }
    
    // General Filters
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

  return (
    <>
        <Card className="shadow-lg">
          <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center">
            <div>
              <CardTitle className="text-xl font-headline flex items-center">
                <Barcode className="mr-2 h-6 w-6 text-blue-500" />
                Ürün Kodu Yönetimi
              </CardTitle>
              <CardDescription>Yeni ürünler ekleyin, mevcutları düzenleyin veya silin.</CardDescription>
            </div>

            <input
              ref={addFileRef}
              id="product-excel-add"
              type="file"
              className="hidden"
              accept=".xlsx,.xls"
              onChange={(e) => handleImport(e, 'add')}
            />
            <input
              ref={updateFileRef}
              id="product-excel-update"
              type="file"
              className="hidden"
              accept=".xlsx,.xls"
              onChange={(e) => handleImport(e, 'update')}
            />

            <div className="flex gap-2 mt-2 sm:mt-0">
                <Button onClick={handleExport} size="sm" variant="outline" disabled={isLoading}><Download className="mr-2 h-4 w-4"/>Dışa Aktar</Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateFileRef.current?.click()}
                  disabled={isLoading}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Güncelle
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="sm"><PlusCircle className="mr-2 h-4 w-4"/>Yeni Ürün</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => openModal()}>Manuel Ekle</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={handleDownloadTemplate}>Excel Şablonu İndir</DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={(e) => {
                            addFileRef.current?.click();
                          }}
                        >
                            Excel ile İçe Aktar
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <div className="relative flex-grow">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Stok adı veya kodu ile ara..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-full max-w-sm"
                />
              </div>
              <Button variant="outline" onClick={() => setIsFilterDialogOpen(true)}>
                <Filter className="mr-2 h-4 w-4" /> Filtrele ({activeFilters.length})
              </Button>
               {selectedProductIds.size > 0 && (
                <>
                  <Button variant="destructive" onClick={handleDeleteSelected}>
                      <Trash2 className="mr-2 h-4 w-4" /> Seçili ({selectedProductIds.size}) Ürünü Sil
                  </Button>
                  <div className="flex items-center gap-2 border-l pl-4">
                    <Select value={bulkTrackingMode} onValueChange={(v) => setBulkTrackingMode(v as TrackingMode)}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Takip Türü Seçin" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TRACKING_MODE_LABEL).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={handleBulkUpdateTrackingMode}>
                      <Type className="mr-2 h-4 w-4" /> Ata
                    </Button>
                  </div>
                </>
                )}
            </div>
             <div className="w-full -mt-2 mb-2 overflow-x-auto">
                <div className="flex items-center gap-2 pb-2 min-w-max">
                    <Button
                    size="sm"
                    variant={selectedBrandTab === 'ALL' ? 'default' : 'outline'}
                    className="rounded-2xl"
                    onClick={() => setSelectedBrandTab('ALL')}
                    >
                    Tümü <span className="ml-1 text-xs opacity-80">({brandTabOptions.total})</span>
                    </Button>

                    {brandTabOptions.items.map(({ brand, count }) => (
                    <Button
                        key={brand}
                        size="sm"
                        variant={selectedBrandTab === brand ? 'default' : 'outline'}
                        className="rounded-2xl whitespace-nowrap"
                        onClick={() => setSelectedBrandTab(brand)}
                    >
                        {brand} <span className="ml-1 text-xs opacity-80">({count})</span>
                    </Button>
                    ))}
                </div>
            </div>
             {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <ScrollArea className="h-[60vh] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                            checked={allSelected ? true : (someSelected ? 'indeterminate' : false)}
                            onCheckedChange={handleSelectAll}
                            aria-label="Tümünü seç"
                        />
                      </TableHead>
                      <TableHead>Stok Kodu</TableHead>
                      <TableHead>Stok Adı</TableHead>
                      <TableHead>Ürün Grubu</TableHead>
                      <TableHead>Marka</TableHead>
                      <TableHead>Test Grubu</TableHead>
                      <TableHead>Cihaz Grubu</TableHead>
                      <TableHead className="text-right">İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProductCodes.map(p => (
                      <TableRow key={p.id} data-state={selectedProductIds.has(p.id) ? 'selected' : ''}>
                        <TableCell>
                            <Checkbox
                                checked={selectedProductIds.has(p.id)}
                                onCheckedChange={(checked) => handleRowSelect(p.id, !!checked)}
                                aria-label={`Select ${p.stokAdi}`}
                            />
                        </TableCell>
                        <TableCell className="font-mono">{p.stokKodu}</TableCell>
                        <TableCell className="font-medium">{p.stokAdi}</TableCell>
                        <TableCell>{p.urunGrubu}</TableCell>
                        <TableCell>{p.marka}</TableCell>
                        <TableCell>{p.testGrubu}</TableCell>
                        <TableCell>{p.cihazGrubu}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => openModal(p)}><Edit3 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      {isModalOpen && (
        <ProductFormatModal
          open={isModalOpen}
          initial={selectedProduct}
          onSave={handleSave}
          onClose={() => setIsModalOpen(false)}
          productCodes={productCodes}
          definitions={definitions}
        />
      )}
      <FiltreDialog 
        isOpen={isFilterDialogOpen}
        onClose={() => setIsFilterDialogOpen(false)}
        availableGroups={availableFilterGroups}
        onApply={setActiveFilters}
      />
    </>
  );
}

