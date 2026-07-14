
'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef, ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Loader2, Filter, Search, Eye, Pencil, ChevronLeft, Package, ChevronDown, Upload, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, addDoc, deleteDoc, doc, query, where, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import type { Hospital, Depot, Asset } from '@/lib/types';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn, readExcelDataSmart, exportDataToExcel } from '@/lib/utils';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import NextImage from 'next/image';
import { useIconMappings, getIconSrc } from '@/hooks/useIconMappings';

type FilterableColumn = keyof Pick<Asset, 'demirbasNo' | 'urunKodu' | 'urunAdi' | 'marka' | 'model' | 'seriNumarasi' | 'durum' | 'konum' | 'teslimEdilenPersonel' | 'manuelKonum' | 'category' | 'mulkiyet'>;

const OWNERSHIP_OPTIONS = {
  satin_alma: 'Satılık',
  kira: 'Kiralık',
} as const;

const formatTry = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('tr-TR')} ₺`
    : '-';

const getOwnershipLabel = (asset: Partial<Asset>) =>
  OWNERSHIP_OPTIONS[asset.mulkiyet || 'satin_alma'];

const getCostLabel = (asset: Partial<Asset>) => {
  if (asset.mulkiyet === 'kira') {
    const amount = formatTry(asset.kiraTutari);
    const period = asset.kiraDonemi === 'yillik' ? 'yıl' : 'ay';
    return amount === '-' ? '-' : `${amount} / ${period}`;
  }
  return formatTry(asset.alimFiyatiTl);
};

const FilterPopover: React.FC<{
  column: FilterableColumn;
  title: string;
  options: string[];
  selectedValues: Set<string>;
  onSelectionChange: (column: FilterableColumn, newSelection: Set<string>) => void;
}> = ({ column, title, options, selectedValues, onSelectionChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isAllSelected = options.length > 0 && selectedValues.size === options.length;
  const hasFilter = selectedValues.size > 0;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors">
          {title}
          <Filter className={cn("w-3 h-3", hasFilter && "text-[var(--dashboard-accent)]")} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Ara..." />
          <CommandList>
            <CommandEmpty>Sonuç bulunamadı.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onSelectionChange(column, isAllSelected ? new Set() : new Set(options))} className="cursor-pointer">
                <Checkbox checked={isAllSelected} className="mr-2" />
                Tümünü Seç
              </CommandItem>
              {options.map(option => (
                <CommandItem
                  key={option}
                  onSelect={() => {
                    const ns = new Set(selectedValues);
                    ns.has(option) ? ns.delete(option) : ns.add(option);
                    onSelectionChange(column, ns);
                  }}
                  className="cursor-pointer"
                >
                  <Checkbox checked={selectedValues.has(option)} className="mr-2" />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// Labeled input for cihaz-* styled forms
function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full h-9 px-3 rounded-xl text-sm bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/30";

export default function AssetCategoryPage() {
  const params = useParams();
  const router = useRouter();
  const categoryName = decodeURIComponent(Array.isArray(params.category) ? params.category[0] : params.category || '');
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const iconData = useIconMappings();
  const envanterIcons = iconData?.mappings?.envanter || {};

  const [assets, setAssets] = useState<Asset[]>([]);
  const [locations, setLocations] = useState<{ value: string; label: string }[]>([]);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Partial<Asset>>({});
  const [manualLocation, setManualLocation] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const excelFileInputRef = useRef<HTMLInputElement>(null);

  const [filters, setFilters] = useState<Record<FilterableColumn, Set<string>>>({
    demirbasNo: new Set(), urunKodu: new Set(), urunAdi: new Set(),
    marka: new Set(), model: new Set(), seriNumarasi: new Set(),
    durum: new Set(), konum: new Set(), teslimEdilenPersonel: new Set(),
    manuelKonum: new Set(), category: new Set(), mulkiyet: new Set(),
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [labsSnap, depotsSnap, categoriesSnap] = await Promise.all([
        getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('assetCategories', currentCompanyId, isSuperAdmin)),
      ]);
      const labLocations = filterByCompanyScope(
        labsSnap.docs.map(doc => ({ value: (doc.data() as Hospital).name, label: `Lab: ${(doc.data() as Hospital).name}`, companyId: (doc.data() as any).companyId })),
        currentCompanyId, isSuperAdmin
      ).map(({ value, label }) => ({ value, label }));
      const depotLocations = filterByCompanyScope(
        depotsSnap.docs.map(doc => ({ value: (doc.data() as Depot).name, label: `Depo: ${(doc.data() as Depot).name}`, companyId: (doc.data() as any).companyId })),
        currentCompanyId, isSuperAdmin
      ).map(({ value, label }) => ({ value, label }));
      setLocations([...labLocations, ...depotLocations, { value: 'Diğer', label: 'Diğer (Manuel Giriş)' }].sort((a, b) => a.label.localeCompare(b.label)));
      setAllCategories(categoriesSnap.docs.map(d => (d.data() as any).name as string).filter(Boolean).sort());

      const assetsSnap = await getDocs(scopedQuery('assets', currentCompanyId, isSuperAdmin, where('category', '==', categoryName)));
      setAssets(filterByCompanyScope(
        assetsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Asset)),
        currentCompanyId, isSuperAdmin
      ));
    } catch {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [categoryName, toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    if (!editingAsset.demirbasNo) {
      toast({ title: 'Eksik Bilgi', description: 'Demirbaş No alanı zorunludur.', variant: 'destructive' });
      return;
    }
    const finalKonum = editingAsset.konum === 'Diğer' ? manualLocation.trim() : editingAsset.konum;
    if (!finalKonum) {
      toast({ title: 'Eksik Bilgi', description: 'Konum alanı zorunludur.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    const dataToSave: Partial<Asset> = {
      ...editingAsset,
      konum: finalKonum,
      category: categoryName,
      bolum: String(editingAsset.bolum || '').trim(),
      manuelKonum: editingAsset.konum === 'Diğer' ? manualLocation.trim() : undefined,
    };
    try {
      if (editingAsset.id) {
        await setDoc(doc(db, 'assets', editingAsset.id), withCompanyScope(dataToSave as Record<string, any>, currentCompanyId), { merge: true });
      } else {
        await addDoc(collection(db, 'assets'), withCompanyScope(dataToSave as Record<string, any>, currentCompanyId));
      }
      toast({ title: 'Başarılı', description: 'Envanter kalemi kaydedildi.' });
      setIsModalOpen(false);
      fetchData();
    } catch {
      toast({ title: 'Hata', description: 'Kayıt sırasında bir hata oluştu.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu kaydı silmek istediğinizden emin misiniz?')) {
      setLoading(true);
      try {
        await deleteDoc(doc(db, 'assets', id));
        toast({ title: 'Silindi', description: 'Envanter kaydı silindi.', variant: 'destructive' });
        fetchData();
      } catch {
        toast({ title: 'Hata', description: 'Silme işlemi başarısız oldu.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    }
  };

  const handleOpenModal = (asset?: Asset) => {
    setEditingAsset(asset || {});
    const isPredefined = locations.some(l => l.value === asset?.konum);
    if (asset?.konum && !isPredefined) {
      setEditingAsset(prev => ({ ...prev, konum: 'Diğer' }));
      setManualLocation(asset.konum);
    } else {
      setManualLocation('');
    }
    setShowAdvanced(false);
    setIsModalOpen(true);
  };

  const handleFilterChange = (column: FilterableColumn, newSelection: Set<string>) => {
    setFilters(prev => ({ ...prev, [column]: newSelection }));
  };

  const uniqueFilterOptions = useMemo(() => {
    const opts: Record<FilterableColumn, Set<string>> = {
      demirbasNo: new Set(), urunKodu: new Set(), urunAdi: new Set(),
      marka: new Set(), model: new Set(), seriNumarasi: new Set(),
      durum: new Set(), konum: new Set(), teslimEdilenPersonel: new Set(),
      manuelKonum: new Set(), category: new Set(), mulkiyet: new Set(),
    };
    assets.forEach(a => {
      (Object.keys(opts) as FilterableColumn[]).forEach(k => {
        const value = k === 'mulkiyet' ? getOwnershipLabel(a) : a[k];
        if (value) opts[k].add(String(value));
      });
    });
    const out: Record<string, string[]> = {};
    (Object.keys(opts) as string[]).forEach(k => { out[k] = Array.from((opts as any)[k]).sort(); });
    return out as Record<FilterableColumn, string[]>;
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const activeKeys = (Object.keys(filters) as FilterableColumn[]).filter(k => filters[k].size > 0);
    let scoped = assets;
    if (globalSearch.trim()) {
      const q = globalSearch.toLocaleLowerCase('tr').trim();
      scoped = scoped.filter(a =>
        `${a.urunAdi || ''} ${a.demirbasNo || ''} ${a.konum || ''} ${a.bolum || ''} ${a.marka || ''}`.toLocaleLowerCase('tr').includes(q)
      );
    }
    if (activeKeys.length === 0) return scoped;
    return scoped.filter(a => activeKeys.every(k => {
      const value = k === 'mulkiyet' ? getOwnershipLabel(a) : a[k];
      return filters[k].has(String(value));
    }));
  }, [assets, filters, globalSearch]);

  const statusColors: Record<string, string> = {
    iyi: 'bg-emerald-500/10 text-emerald-600',
    orta: 'bg-amber-500/10 text-amber-600',
    kötü: 'bg-rose-500/10 text-rose-600',
    'çok kötü': 'bg-rose-500/20 text-rose-700',
  };

  const stats = useMemo(() => ({
    total: assets.length,
    assigned: assets.filter(a => Boolean(a.zimmetliKisi || a.teslimEdilenPersonel)).length,
    unassigned: assets.filter(a => !a.zimmetliKisi && !a.teslimEdilenPersonel).length,
    totalCost: assets.reduce((sum, a) => {
      if (a.mulkiyet === 'kira') {
        const rent = Number(a.kiraTutari) || 0;
        return sum + (a.kiraDonemi === 'yillik' ? rent : rent * 12);
      }
      return sum + (Number(a.alimFiyatiTl) || 0);
    }, 0),
  }), [assets]);

  const set = (field: string, value: any) => setEditingAsset(prev => ({ ...prev, [field]: value }));
  const categoryIcon = envanterIcons[categoryName];

  // --- Excel Template Download ---
  const handleDownloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const templateSheet = XLSX.utils.json_to_sheet([
      {
        'Demirbaş No': '',
        'Ürün Adı': '',
        'Seri Numarası': '',
        Durum: 'iyi',
        Marka: '',
        Model: '',
        Konum: '',
        'Bölüm': '',
        'Teslim Edilen Personel': '',
        'Mülkiyet Tipi': 'Satılık',
        'Alım Fiyatı (TL)': '',
        'Satın Alma Tarihi': '',
        'Kira Tutarı (TL)': '',
        'Kira Dönemi': 'Aylık',
        'Kira Bitiş Tarihi': '',
        'Garanti Bitiş Tarihi': '',
        'Planlı Kullanım Ömrü (Yıl)': '',
        'Amortisman Yöntemi': 'dogrusal',
        'Amortisman Başlangıç Tarihi': '',
        'Hurda Tarihi': '',
        'İmha Tarihi': '',
        'Satış Tarihi': '',
        'Son Bakım Tarihi': '',
        'Sonraki Bakım Tarihi': '',
        'Son Kalibrasyon Tarihi': '',
        'Sonraki Kalibrasyon Tarihi': '',
        'Bakım Maliyeti (TL)': '',
        'Zimmetli Kişi': '',
        'Check-Out Tarihi': '',
        'Check-In Tarihi': '',
        'Dijital İmza': '',
        'Zimmet Fiş No': '',
        Açıklama: '',
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, templateSheet, 'Envanter Şablonu');

    // Reference sheet with all definitions
    const locationNames = locations.filter(l => l.value !== 'Diğer').map(l => l.value);
    const durumOptions = ['iyi', 'orta', 'kötü', 'çok kötü'];
    const amortismanOptions = ['dogrusal', 'azalan_bakiye'];
    const mulkiyetOptions = ['Satılık', 'Kiralık'];
    const kiraDonemiOptions = ['Aylık', 'Yıllık'];
    const maxLen = Math.max(allCategories.length, locationNames.length, durumOptions.length, amortismanOptions.length, mulkiyetOptions.length, kiraDonemiOptions.length);
    const refData: any[] = [];
    for (let i = 0; i < maxLen; i++) {
      refData.push({
        'Kategoriler': allCategories[i] || '',
        'Konumlar': locationNames[i] || '',
        'Durum Seçenekleri': durumOptions[i] || '',
        'Amortisman Yöntemleri': amortismanOptions[i] || '',
        'Mülkiyet Tipleri': mulkiyetOptions[i] || '',
        'Kira Dönemleri': kiraDonemiOptions[i] || '',
        'Aktif Kategori': i === 0 ? categoryName : '',
      });
    }
    const refSheet = XLSX.utils.json_to_sheet(refData);
    XLSX.utils.book_append_sheet(workbook, refSheet, 'Referans Tanımlar');

    XLSX.writeFile(workbook, `${categoryName}_Envanter_Sablonu.xlsx`);
    toast({ title: 'Şablon İndirildi', description: `${categoryName} kategorisi için şablon indirildi. 2. sayfada referans tanımlar mevcuttur.` });
  };

  // --- Excel Current Inventory Download ---
  const handleDownloadCurrentList = () => {
    if (assets.length === 0) {
      toast({ title: 'Veri Yok', description: 'İndirilecek envanter kaydı bulunamadı.', variant: 'default' });
      return;
    }
    const data = assets.map((asset) => ({
      'Demirbaş No': asset.demirbasNo || '',
      'Ürün Adı': asset.urunAdi || '',
      'Seri Numarası': asset.seriNumarasi || '',
      Durum: asset.durum || '',
      Marka: asset.marka || '',
      Model: asset.model || '',
      Konum: asset.konum || '',
      'Bölüm': asset.bolum || '',
      'Teslim Edilen Personel': asset.teslimEdilenPersonel || '',
      'Mülkiyet Tipi': getOwnershipLabel(asset),
      'Alım Fiyatı (TL)': typeof asset.alimFiyatiTl === 'number' ? asset.alimFiyatiTl : '',
      'Satın Alma Tarihi': asset.satinAlmaTarihi || '',
      'Kira Tutarı (TL)': typeof asset.kiraTutari === 'number' ? asset.kiraTutari : '',
      'Kira Dönemi': asset.kiraDonemi === 'yillik' ? 'Yıllık' : 'Aylık',
      'Kira Bitiş Tarihi': asset.kiraBitisTarihi || '',
      'Garanti Bitiş Tarihi': asset.garantiBitisTarihi || '',
      'Planlı Kullanım Ömrü (Yıl)': asset.planliKullanimOmruYil ?? '',
      'Amortisman Yöntemi': asset.amortismanYontemi || '',
      'Zimmetli Kişi': asset.zimmetliKisi || '',
      Açıklama: asset.aciklama || '',
    }));
    exportDataToExcel(data, `${categoryName}_Envanter`, categoryName, toast);
  };

  // --- Excel Import / Update ---
  const handleExcelImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const data = await readExcelDataSmart(file, 'product', toast);
      if (!data || data.length === 0) {
        toast({ title: 'Boş Dosya', description: 'Excel dosyasında veri bulunamadı.', variant: 'default' });
        setLoading(false);
        return;
      }

      const batch = writeBatch(db);
      let newCount = 0, updatedCount = 0;

      for (const row of data) {
        const demirbasNo = String(row['Demirbaş No'] || row['demirbasno'] || '').trim();
        if (!demirbasNo) continue;

        const locationNames = locations.filter(l => l.value !== 'Diğer').map(l => l.value);
        const konumVal = String(row['Konum'] || row['konum'] || '').trim();

        const assetData: Partial<Asset> = {
          category: categoryName,
          demirbasNo,
          urunAdi: String(row['Ürün Adı'] || row['urunadi'] || '').trim(),
          seriNumarasi: String(row['Seri Numarası'] || row['serinumarasi'] || '').trim(),
          durum: String(row['Durum'] || row['durum'] || 'iyi').trim() as any,
          marka: String(row['Marka'] || row['marka'] || '').trim(),
          model: String(row['Model'] || row['model'] || '').trim(),
          konum: konumVal,
          bolum: String(row['Bölüm'] || row['Bolum'] || row['bölüm'] || row['bolum'] || '').trim(),
          teslimEdilenPersonel: String(row['Teslim Edilen Personel'] || row['teslimedilenpersonel'] || '').trim(),
          mulkiyet: String(row['Mülkiyet Tipi'] || row['mulkiyettipi'] || row['Mülkiyet'] || row['mulkiyet'] || '').toLocaleLowerCase('tr').includes('kira') ? 'kira' : 'satin_alma',
          alimFiyatiTl: Number(row['Alım Fiyatı (TL)'] || row['alimfiyatitl'] || 0) || 0,
          satinAlmaTarihi: String(row['Satın Alma Tarihi'] || row['satinalmatarihi'] || '').trim(),
          kiraTutari: Number(row['Kira Tutarı (TL)'] || row['kiratutaritl'] || row['Kira Tutarı'] || row['kiratutari'] || 0) || 0,
          kiraDonemi: String(row['Kira Dönemi'] || row['kiradonemi'] || '').toLocaleLowerCase('tr').includes('yıl') ? 'yillik' : 'aylik',
          kiraBitisTarihi: String(row['Kira Bitiş Tarihi'] || row['kirabitistarihi'] || '').trim(),
          garantiBitisTarihi: String(row['Garanti Bitiş Tarihi'] || row['garantibitistarihi'] || '').trim(),
          planliKullanimOmruYil: Number(row['Planlı Kullanım Ömrü (Yıl)'] || row['planlikullanimomruyil'] || 0) || 0,
          amortismanYontemi: String(row['Amortisman Yöntemi'] || row['amortismanyontemi'] || 'dogrusal').trim() as 'dogrusal' | 'azalan_bakiye',
          amortismanBaslangicTarihi: String(row['Amortisman Başlangıç Tarihi'] || row['amortismanbaslangictarihi'] || '').trim(),
          hurdaTarihi: String(row['Hurda Tarihi'] || row['hurdatarihi'] || '').trim(),
          imhaTarihi: String(row['İmha Tarihi'] || row['imhatarihi'] || '').trim(),
          satisTarihi: String(row['Satış Tarihi'] || row['satistarihi'] || '').trim(),
          sonBakimTarihi: String(row['Son Bakım Tarihi'] || row['sonbakimtarihi'] || '').trim(),
          sonrakiBakimTarihi: String(row['Sonraki Bakım Tarihi'] || row['sonrakibakimtarihi'] || '').trim(),
          sonKalibrasyonTarihi: String(row['Son Kalibrasyon Tarihi'] || row['sonkalibrasyontarihi'] || '').trim(),
          sonrakiKalibrasyonTarihi: String(row['Sonraki Kalibrasyon Tarihi'] || row['sonrakikalibrasyontarihi'] || '').trim(),
          bakimMaliyetiTl: Number(row['Bakım Maliyeti (TL)'] || row['bakimmaliyetitl'] || 0) || 0,
          zimmetliKisi: String(row['Zimmetli Kişi'] || row['zimmetlikisi'] || '').trim(),
          checkOutTarihi: String(row['Check-Out Tarihi'] || row['checkOutTarihi'] || '').trim(),
          checkInTarihi: String(row['Check-In Tarihi'] || row['checkInTarihi'] || '').trim(),
          dijitalImza: String(row['Dijital İmza'] || row['dijitalimza'] || '').trim(),
          zimmetFisNo: String(row['Zimmet Fiş No'] || row['zimmetfisno'] || '').trim(),
          aciklama: String(row['Açıklama'] || row['aciklama'] || '').trim(),
          manuelKonum: locationNames.some(l => l === konumVal) ? undefined : konumVal,
        };

        const existingAsset = assets.find(a => a.demirbasNo === demirbasNo);

        if (existingAsset) {
          batch.set(doc(db, 'assets', existingAsset.id), withCompanyScope(assetData as Record<string, any>, currentCompanyId), { merge: true });
          updatedCount++;
        } else {
          batch.set(doc(collection(db, 'assets')), withCompanyScope(assetData, currentCompanyId));
          newCount++;
        }
      }

      if (newCount > 0 || updatedCount > 0) {
        await batch.commit();
      }
      toast({ title: 'İçe Aktarma Başarılı', description: `${newCount} yeni kayıt eklendi, ${updatedCount} kayıt güncellendi.` });
      fetchData();
    } catch (err) {
      toast({ title: 'Hata', description: 'Excel işlenirken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  return (
    <>
      <input type="file" ref={excelFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleExcelImport} />
      <div className="cihaz-shell min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24">

          {/* HEADER */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <Link
                href="/yonetim/envanter-yonetimi"
                className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </Link>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="relative pl-32 min-h-[120px] flex flex-col justify-center">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-28 h-28 flex items-center justify-center overflow-visible">
                  {categoryIcon ? (
                    <NextImage src={getIconSrc(categoryIcon)} alt="" width={116} height={116} className="object-contain" />
                  ) : (
                    <Package className="w-16 h-16 text-[var(--dashboard-muted)]" />
                  )}
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)] capitalize text-center">{categoryName}</h1>
                <p className="text-xs sm:text-sm text-[var(--dashboard-muted)] text-center">Bu kategoriye ait demirbaş envanteri</p>
              </div>
            </div>
            <button
              onClick={() => handleOpenModal()}
              disabled={loading}
              className="h-9 px-3 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Yeni Ürün
            </button>
          </div>

          {/* STATS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Toplam', value: stats.total },
              { label: 'Zimmetli', value: stats.assigned, color: 'text-sky-500' },
              { label: 'Boşta', value: stats.unassigned, color: 'text-amber-500' },
              { label: 'Maliyet', value: `${stats.totalCost.toLocaleString('tr-TR')} ₺`, color: 'text-[var(--dashboard-accent)]' },
            ].map((s, i) => (
              <div key={i} className="cihaz-pressed px-4 py-3 flex items-center gap-3">
                <span className={cn("text-lg font-bold", s.color || "text-[var(--dashboard-text)]")}>{s.value}</span>
                <span className="text-[11px] text-[var(--dashboard-muted)]">{s.label}</span>
              </div>
            ))}
          </div>

          {/* ===== BULK EXCEL OPERATIONS ===== */}
          <div className="cihaz-card p-4 mb-6">
            <p className="text-xs font-semibold text-[var(--dashboard-text)] mb-3 uppercase tracking-wider">Toplu İşlemler — {categoryName}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => excelFileInputRef.current?.click()}
                className="cihaz-tool-item h-9 px-3 text-xs font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" /> Excel Yükle / Güncelle
              </button>
              <button
                onClick={handleDownloadTemplate}
                className="cihaz-tool-item h-9 px-3 text-xs font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Şablon İndir
              </button>
              <button
                onClick={handleDownloadCurrentList}
                className="cihaz-tool-item h-9 px-3 text-xs font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Mevcut Listeyi İndir
              </button>
            </div>
            <p className="text-[11px] mt-2 text-[var(--dashboard-muted)]">
              Aynı <strong>Demirbaş No</strong> ile yüklenen satırlar mevcut ürünü günceller, yeni Demirbaş No olan satırlar yeni kayıt olarak eklenir. Tüm kayıtlar <strong>{categoryName}</strong> kategorisine atanır.
            </p>
          </div>

          {/* TABLE CARD */}
          <div className="cihaz-card-strong p-5 sm:p-6">
            {/* Search */}
            <div className="relative w-full sm:w-72 mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
              <input
                type="text"
                placeholder="Ürün, marka veya konum ara..."
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                className={cn(inputClass, "pl-9")}
              />
            </div>

            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
              </div>
            ) : (
              <ScrollArea className="h-[60vh]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--dashboard-stroke)]">
                      <th className="text-left py-2 px-3"><FilterPopover column="demirbasNo" title="Demirbaş No" options={uniqueFilterOptions.demirbasNo} selectedValues={filters.demirbasNo} onSelectionChange={handleFilterChange} /></th>
                      <th className="text-left py-2 px-3"><FilterPopover column="seriNumarasi" title="Seri No" options={uniqueFilterOptions.seriNumarasi} selectedValues={filters.seriNumarasi} onSelectionChange={handleFilterChange} /></th>
                      <th className="text-left py-2 px-3"><FilterPopover column="durum" title="Durum" options={uniqueFilterOptions.durum} selectedValues={filters.durum} onSelectionChange={handleFilterChange} /></th>
                      <th className="text-left py-2 px-3"><FilterPopover column="marka" title="Marka" options={uniqueFilterOptions.marka} selectedValues={filters.marka} onSelectionChange={handleFilterChange} /></th>
                      <th className="text-left py-2 px-3"><FilterPopover column="konum" title="Konum" options={uniqueFilterOptions.konum} selectedValues={filters.konum} onSelectionChange={handleFilterChange} /></th>
                      <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Bölüm</th>
                      <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Personel</th>
                      <th className="text-left py-2 px-3"><FilterPopover column="mulkiyet" title="Tip" options={uniqueFilterOptions.mulkiyet} selectedValues={filters.mulkiyet} onSelectionChange={handleFilterChange} /></th>
                      <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Maliyet</th>
                      <th className="text-right py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.length === 0 ? (
                      <tr><td colSpan={10} className="text-center py-12 text-sm text-[var(--dashboard-muted)]">Kayıtlı ürün yok veya filtre ile eşleşmiyor.</td></tr>
                    ) : filteredAssets.map(asset => (
                      <tr
                        key={asset.id}
                        onClick={() => router.push(`/yonetim/envanter-yonetimi/${categoryName}/${asset.id}`)}
                        className="border-b border-[var(--dashboard-stroke)]/50 cursor-pointer hover:bg-[var(--dashboard-surface-2)]/50 transition-colors"
                      >
                        <td className="py-2.5 px-3 font-mono text-xs">{asset.demirbasNo}</td>
                        <td className="py-2.5 px-3 font-mono text-xs text-[var(--dashboard-muted)]">{asset.seriNumarasi || '-'}</td>
                        <td className="py-2.5 px-3">
                          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-lg capitalize", statusColors[(asset.durum || '').toLowerCase()] || 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]')}>
                            {asset.durum || '-'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[var(--dashboard-text)]">{asset.marka || '-'}</td>
                        <td className="py-2.5 px-3 text-[var(--dashboard-text)]">{asset.konum || '-'}</td>
                        <td className="py-2.5 px-3 text-[var(--dashboard-text)]">{asset.bolum || '-'}</td>
                        <td className="py-2.5 px-3 text-[var(--dashboard-muted)]">{asset.zimmetliKisi || asset.teslimEdilenPersonel || '-'}</td>
                        <td className="py-2.5 px-3">
                          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-lg", asset.mulkiyet === 'kira' ? 'bg-sky-500/10 text-sky-600' : 'bg-emerald-500/10 text-emerald-600')}>
                            {getOwnershipLabel(asset)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[var(--dashboard-accent)] font-medium">{getCostLabel(asset)}</td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <button onClick={e => { e.stopPropagation(); router.push(`/yonetim/envanter-yonetimi/${categoryName}/${asset.id}`); }} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--dashboard-surface-2)] transition-colors">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={e => { e.stopPropagation(); handleOpenModal(asset); }} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--dashboard-surface-2)] transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={e => { e.stopPropagation(); handleDelete(asset.id); }} className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400 hover:text-red-500 hover:bg-red-500/10 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </div>
        </div>
      </div>

      {/* ===== ADD/EDIT MODAL ===== */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-lg cihaz-card-strong !rounded-3xl !p-0 !gap-0 border-0">
          <div className="px-6 pt-6 pb-4 border-b border-[var(--dashboard-stroke)] sticky top-0 z-10 bg-[var(--dashboard-surface)]" style={{ borderTopLeftRadius: '1.5rem', borderTopRightRadius: '1.5rem' }}>
            <DialogTitle className="text-base font-bold text-[var(--dashboard-text)]">
              {editingAsset.id ? 'Ürün Düzenle' : `Yeni ${categoryName} Ekle`}
            </DialogTitle>
          </div>

          <div>
            <div className="px-6 py-5 space-y-4">
              {/* === TEMEL BİLGİLER === */}
              <p className="text-[11px] font-semibold text-[var(--dashboard-accent)] uppercase tracking-wider">Temel Bilgiler</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Demirbaş No *">
                  <input className={inputClass} placeholder="DB-001" value={editingAsset.demirbasNo || ''} onChange={e => set('demirbasNo', e.target.value)} />
                </FormField>
                <FormField label="Ürün Adı">
                  <input className={inputClass} placeholder="Ürün adı" value={editingAsset.urunAdi || ''} onChange={e => set('urunAdi', e.target.value)} />
                </FormField>
                <FormField label="Seri Numarası">
                  <input className={inputClass} placeholder="SN-XXX" value={editingAsset.seriNumarasi || ''} onChange={e => set('seriNumarasi', e.target.value)} />
                </FormField>
                <FormField label="Durum">
                  <Select value={editingAsset.durum || ''} onValueChange={v => set('durum', v)}>
                    <SelectTrigger className="h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-0"><SelectValue placeholder="Seçin" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="iyi">İyi</SelectItem>
                      <SelectItem value="orta">Orta</SelectItem>
                      <SelectItem value="kötü">Kötü</SelectItem>
                      <SelectItem value="çok kötü">Çok Kötü</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Marka">
                  <input className={inputClass} placeholder="Marka" value={editingAsset.marka || ''} onChange={e => set('marka', e.target.value)} />
                </FormField>
                <FormField label="Model">
                  <input className={inputClass} placeholder="Model" value={editingAsset.model || ''} onChange={e => set('model', e.target.value)} />
                </FormField>
              </div>

              {/* === KONUM & PERSONEL === */}
              <p className="text-[11px] font-semibold text-[var(--dashboard-accent)] uppercase tracking-wider pt-2">Konum & Personel</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Konum *">
                  <Select value={editingAsset.konum || ''} onValueChange={v => set('konum', v)}>
                    <SelectTrigger className="h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-0"><SelectValue placeholder="Seçin" /></SelectTrigger>
                    <SelectContent>
                      {locations.map(loc => <SelectItem key={loc.value} value={loc.value}>{loc.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Personel">
                  <input className={inputClass} placeholder="Ad Soyad" value={editingAsset.teslimEdilenPersonel || ''} onChange={e => set('teslimEdilenPersonel', e.target.value)} />
                </FormField>
              </div>
              <FormField label="Bölüm">
                <input className={inputClass} placeholder="Örn. Biyokimya, Hematoloji, Acil" value={editingAsset.bolum || ''} onChange={e => set('bolum', e.target.value)} />
              </FormField>
              {editingAsset.konum === 'Diğer' && (
                <FormField label="Manuel Konum">
                  <input className={inputClass} placeholder="Konum girin" value={manualLocation} onChange={e => setManualLocation(e.target.value)} />
                </FormField>
              )}

              {/* === MALİ BİLGİLER === */}
              <p className="text-[11px] font-semibold text-[var(--dashboard-accent)] uppercase tracking-wider pt-2">Mali Bilgiler</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Mülkiyet Tipi">
                  <Select value={editingAsset.mulkiyet || 'satin_alma'} onValueChange={v => set('mulkiyet', v)}>
                    <SelectTrigger className="h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="satin_alma">Satılık</SelectItem>
                      <SelectItem value="kira">Kiralık</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                {editingAsset.mulkiyet === 'kira' ? (
                  <>
                    <FormField label="Kira Tutarı (₺)">
                      <input className={inputClass} type="number" min={0} step="0.01" placeholder="0" value={editingAsset.kiraTutari ?? ''} onChange={e => set('kiraTutari', Number(e.target.value) || 0)} />
                    </FormField>
                    <FormField label="Kira Dönemi">
                      <Select value={editingAsset.kiraDonemi || 'aylik'} onValueChange={v => set('kiraDonemi', v)}>
                        <SelectTrigger className="h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-0"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="aylik">Aylık</SelectItem>
                          <SelectItem value="yillik">Yıllık</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label="Kira Bitiş Tarihi">
                      <input className={inputClass} type="date" value={editingAsset.kiraBitisTarihi || ''} onChange={e => set('kiraBitisTarihi', e.target.value)} />
                    </FormField>
                  </>
                ) : (
                  <>
                    <FormField label="Alım Fiyatı (₺)">
                      <input className={inputClass} type="number" min={0} step="0.01" placeholder="0" value={editingAsset.alimFiyatiTl ?? ''} onChange={e => set('alimFiyatiTl', Number(e.target.value) || 0)} />
                    </FormField>
                    <FormField label="Satın Alma Tarihi">
                      <input className={inputClass} type="date" value={editingAsset.satinAlmaTarihi || ''} onChange={e => set('satinAlmaTarihi', e.target.value)} />
                    </FormField>
                  </>
                )}
                <FormField label="Garanti Bitiş">
                  <input className={inputClass} type="date" value={editingAsset.garantiBitisTarihi || ''} onChange={e => set('garantiBitisTarihi', e.target.value)} />
                </FormField>
                <FormField label="Planlı Ömür (Yıl)">
                  <input className={inputClass} type="number" min={0} placeholder="0" value={editingAsset.planliKullanimOmruYil ?? ''} onChange={e => set('planliKullanimOmruYil', Number(e.target.value) || 0)} />
                </FormField>
              </div>

              {/* === GELİŞMİŞ (Collapsible) === */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--dashboard-surface-2)]/50 text-xs font-semibold text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
              >
                <span>Gelişmiş Alanlar (Amortisman, Bakım, Kalibrasyon...)</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform", showAdvanced && "rotate-180")} />
              </button>

              {showAdvanced && (
                <div className="space-y-4 pl-1">
                  <p className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Amortisman</p>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Yöntem">
                      <Select value={editingAsset.amortismanYontemi || 'dogrusal'} onValueChange={v => set('amortismanYontemi', v)}>
                        <SelectTrigger className="h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-0"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dogrusal">Doğrusal</SelectItem>
                          <SelectItem value="azalan_bakiye">Azalan Bakiye</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label="Başlangıç Tarihi">
                      <input className={inputClass} type="date" value={editingAsset.amortismanBaslangicTarihi || ''} onChange={e => set('amortismanBaslangicTarihi', e.target.value)} />
                    </FormField>
                  </div>

                  <p className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Bakım & Kalibrasyon</p>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Son Bakım">
                      <input className={inputClass} type="date" value={editingAsset.sonBakimTarihi || ''} onChange={e => set('sonBakimTarihi', e.target.value)} />
                    </FormField>
                    <FormField label="Sonraki Bakım">
                      <input className={inputClass} type="date" value={editingAsset.sonrakiBakimTarihi || ''} onChange={e => set('sonrakiBakimTarihi', e.target.value)} />
                    </FormField>
                    <FormField label="Son Kalibrasyon">
                      <input className={inputClass} type="date" value={editingAsset.sonKalibrasyonTarihi || ''} onChange={e => set('sonKalibrasyonTarihi', e.target.value)} />
                    </FormField>
                    <FormField label="Sonraki Kalibrasyon">
                      <input className={inputClass} type="date" value={editingAsset.sonrakiKalibrasyonTarihi || ''} onChange={e => set('sonrakiKalibrasyonTarihi', e.target.value)} />
                    </FormField>
                    <FormField label="Bakım Maliyeti (₺)">
                      <input className={inputClass} type="number" min={0} step="0.01" placeholder="0" value={editingAsset.bakimMaliyetiTl ?? ''} onChange={e => set('bakimMaliyetiTl', Number(e.target.value) || 0)} />
                    </FormField>
                  </div>

                  <p className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Yaşam Döngüsü</p>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Hurda Tarihi">
                      <input className={inputClass} type="date" value={editingAsset.hurdaTarihi || ''} onChange={e => set('hurdaTarihi', e.target.value)} />
                    </FormField>
                    <FormField label="İmha Tarihi">
                      <input className={inputClass} type="date" value={editingAsset.imhaTarihi || ''} onChange={e => set('imhaTarihi', e.target.value)} />
                    </FormField>
                    <FormField label="Satış Tarihi">
                      <input className={inputClass} type="date" value={editingAsset.satisTarihi || ''} onChange={e => set('satisTarihi', e.target.value)} />
                    </FormField>
                  </div>
                </div>
              )}

              {/* AÇIKLAMA */}
              <FormField label="Açıklama">
                <textarea
                  className={cn(inputClass, "h-20 py-2 resize-none")}
                  placeholder="Opsiyonel not..."
                  value={editingAsset.aciklama || ''}
                  onChange={e => set('aciklama', e.target.value)}
                />
              </FormField>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-[var(--dashboard-stroke)] flex items-center justify-end gap-2 sticky bottom-0 z-10 bg-[var(--dashboard-surface)]" style={{ borderBottomLeftRadius: '1.5rem', borderBottomRightRadius: '1.5rem' }}>
            <button onClick={() => setIsModalOpen(false)} className="h-9 px-4 rounded-xl text-xs font-semibold bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors">
              İptal
            </button>
            <button onClick={handleSave} disabled={loading} className="h-9 px-4 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 transition-all flex items-center gap-1.5 disabled:opacity-50">
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Kaydet
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
