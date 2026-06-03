'use client';
import React, { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  PlusCircle, Computer, Server, Barcode, Printer, BookCopy, Loader2, Edit3, Trash2, MapPin, Upload, Download,
  Fan, Beaker, FlaskConical, Archive, QrCode, Car, Search, ChevronLeft, Package, Grid3x3, LayoutList
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, addDoc, doc, setDoc, deleteDoc, orderBy, query, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { readExcelDataSmart, exportDataToExcel } from '@/lib/utils';
import * as XLSX from 'xlsx';
import type { Asset, Depot, Hospital } from '@/lib/types';
import LabelPrinter from '@/components/yonetim/LabelPrinter';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import { useIconMappings, getIconSrc } from '@/hooks/useIconMappings';

const iconMap: Record<string, React.ElementType> = {
  bilgisayar: Computer,
  monitor: Computer,
  dolap: Archive,
  server: Server,
  rack: Server,
  barkod: Barcode,
  tarayıcı: Barcode,
  yazıcı: Printer,
  printer: Printer,
  klima: Fan,
  fan: Fan,
  cihaz: Beaker,
  mikroskop: FlaskConical,
  default: BookCopy,
  hastane: MapPin,
  depo: MapPin,
};

const getIconForCategory = (name: string): React.ElementType => {
  const lowerName = name.toLowerCase();
  for (const key in iconMap) {
    if (key !== 'default' && lowerName.includes(key)) {
      return iconMap[key];
    }
  }
  return iconMap.default;
};

interface AssetCategory {
  id: string;
  name: string;
  iconSvg?: string;
}

interface Location {
  id: string;
  name: string;
}

export default function EnvanterYonetimiPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [categorySearch, setCategorySearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [iconGeneratingId, setIconGeneratingId] = useState<string | null>(null);
  const [bulkGeneratingIcons, setBulkGeneratingIcons] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Partial<AssetCategory>>({});
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'category' | 'location'>('category');
  const [searchQuery, setSearchQuery] = useState('');
  const iconData = useIconMappings();
  const envanterIcons = iconData?.mappings?.envanter || {};

  const assetFileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [categoriesSnap, assetsSnap, hospitalsSnap, depotsSnap, vehiclesSnap] = await Promise.all([
        getDocs(scopedQuery('assetCategories', currentCompanyId, isSuperAdmin, orderBy('name'))),
        getDocs(scopedQuery('assets', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('vehicles', currentCompanyId, isSuperAdmin)),
      ]);
      setCategories(categoriesSnap.docs.map(doc => ({ id: doc.id, name: doc.data().name, iconSvg: doc.data().iconSvg } as AssetCategory)));
      setAssets(filterByCompanyScope(
        assetsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Asset)),
        currentCompanyId, isSuperAdmin
      ));
      setVehicleCount(filterByCompanyScope(
        vehiclesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        currentCompanyId, isSuperAdmin
      ).length);

      const hospitalLocations = filterByCompanyScope(
        hospitalsSnap.docs.map(doc => ({ id: doc.id, name: (doc.data() as Hospital).name as string, companyId: (doc.data() as any).companyId })),
        currentCompanyId, isSuperAdmin
      ).map(({ id, name }) => ({ id, name }));
      const depotLocations = filterByCompanyScope(
        depotsSnap.docs.map(doc => ({ id: doc.id, name: (doc.data() as Depot).name as string, companyId: (doc.data() as any).companyId })),
        currentCompanyId, isSuperAdmin
      ).map(({ id, name }) => ({ id, name }));
      setLocations([...hospitalLocations, ...depotLocations].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const assetCountsByCategory = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const asset of assets) {
      counts[asset.category] = (counts[asset.category] || 0) + 1;
    }
    return counts;
  }, [assets]);

  const assetCountsByLocation = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const asset of assets) {
      if (asset.konum) {
        counts[asset.konum] = (counts[asset.konum] || 0) + 1;
      }
    }
    return counts;
  }, [assets]);

  const totalAssets = assets.length;
  const totalCategories = categories.length;
  const totalLocations = locations.length;

  const handleOpenModal = (category?: AssetCategory) => {
    setEditingCategory(category || {});
    setIsModalOpen(true);
  };

  const handleSaveCategory = async () => {
    if (!editingCategory.name) {
      toast({ title: 'Hata', description: 'Kategori adı boş olamaz.', variant: 'destructive' });
      return;
    }
    const categoryName = editingCategory.name.trim();
    const data: Record<string, unknown> = { name: categoryName };
    try {
      if (editingCategory.id) {
        await setDoc(doc(db, 'assetCategories', editingCategory.id), data, { merge: true });
      } else {
        const iconRes = await fetch('/api/envanter/category-icon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryName }),
        });
        if (iconRes.ok) {
          const iconData = await iconRes.json();
          data.iconSvg = iconData.iconSvg;
        }
        await addDoc(collection(db, 'assetCategories'), data);
      }
      toast({ title: 'Basarili', description: 'Kategori kaydedildi.' });
      setIsModalOpen(false);
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Kayit sirasinda bir hata olustu.', variant: 'destructive' });
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'assetCategories', categoryId));
      toast({ title: 'Silindi', description: 'Kategori silindi.', variant: 'destructive' });
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Kategori silinemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadAssetTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const templateSheet = XLSX.utils.json_to_sheet([
      {
        Kategori: '',
        'Demirbaş No': '',
        'Ürün Adı': '',
        'Seri Numarası': '',
        Durum: 'iyi',
        Marka: '',
        Model: '',
        Konum: '',
        'Teslim Edilen Personel': '',
        'Alım Fiyatı (TL)': '',
        'Satın Alma Tarihi': '',
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

    const categoryNames = categories.map(c => c.name);
    const locationNames = locations.map(l => l.name);
    const durumOptions = ['iyi', 'orta', 'kötü', 'çok kötü'];
    const amortismanOptions = ['dogrusal', 'azalan_bakiye'];
    const refData: any[] = [];
    const maxLen = Math.max(categoryNames.length, locationNames.length, durumOptions.length, amortismanOptions.length);
    for (let i = 0; i < maxLen; i++) {
      refData.push({
        'Kategoriler': categoryNames[i] || '',
        'Konumlar': locationNames[i] || '',
        'Durum Seçenekleri': durumOptions[i] || '',
        'Amortisman Yöntemleri': amortismanOptions[i] || '',
      });
    }
    const refSheet = XLSX.utils.json_to_sheet(refData);
    XLSX.utils.book_append_sheet(workbook, refSheet, 'Referans Tanımlar');

    XLSX.writeFile(workbook, 'Envanter_Giris_Sablonu.xlsx');
    toast({ title: 'Şablon İndirildi', description: 'Envanter giriş şablonu indirildi. 2. sayfada tüm referans tanımlar mevcuttur.' });
  };

  const handleDownloadCurrentInventory = () => {
    const mappedAssetKeys = new Set([
      'category', 'demirbasNo', 'urunAdi', 'seriNumarasi', 'durum', 'marka', 'model', 'konum',
      'teslimEdilenPersonel', 'alimFiyatiTl', 'satinAlmaTarihi', 'garantiBitisTarihi',
      'planliKullanimOmruYil', 'amortismanYontemi', 'amortismanBaslangicTarihi', 'hurdaTarihi',
      'imhaTarihi', 'satisTarihi', 'sonBakimTarihi', 'sonrakiBakimTarihi', 'sonKalibrasyonTarihi',
      'sonrakiKalibrasyonTarihi', 'bakimMaliyetiTl', 'zimmetliKisi', 'checkOutTarihi', 'checkInTarihi',
      'dijitalImza', 'zimmetFisNo', 'aciklama', 'id'
    ]);

    const data = assets.map((asset) => {
      const row: Record<string, unknown> = {
        Kategori: asset.category || '',
        'Demirbaş No': asset.demirbasNo || '',
        'Ürün Adı': asset.urunAdi || '',
        'Seri Numarası': asset.seriNumarasi || '',
        Durum: asset.durum || '',
        Marka: asset.marka || '',
        Model: asset.model || '',
        Konum: asset.konum || '',
        'Teslim Edilen Personel': asset.teslimEdilenPersonel || '',
        'Alım Fiyatı (TL)': typeof asset.alimFiyatiTl === 'number' ? asset.alimFiyatiTl : '',
        'Satın Alma Tarihi': asset.satinAlmaTarihi || '',
        'Garanti Bitiş Tarihi': asset.garantiBitisTarihi || '',
        'Planlı Kullanım Ömrü (Yıl)': asset.planliKullanimOmruYil ?? '',
        'Amortisman Yöntemi': asset.amortismanYontemi || '',
        'Amortisman Başlangıç Tarihi': asset.amortismanBaslangicTarihi || '',
        'Hurda Tarihi': asset.hurdaTarihi || '',
        'İmha Tarihi': asset.imhaTarihi || '',
        'Satış Tarihi': asset.satisTarihi || '',
        'Son Bakım Tarihi': asset.sonBakimTarihi || '',
        'Sonraki Bakım Tarihi': asset.sonrakiBakimTarihi || '',
        'Son Kalibrasyon Tarihi': asset.sonKalibrasyonTarihi || '',
        'Sonraki Kalibrasyon Tarihi': asset.sonrakiKalibrasyonTarihi || '',
        'Bakım Maliyeti (TL)': asset.bakimMaliyetiTl ?? '',
        'Zimmetli Kişi': asset.zimmetliKisi || '',
        'Check-Out Tarihi': asset.checkOutTarihi || '',
        'Check-In Tarihi': asset.checkInTarihi || '',
        'Dijital İmza': asset.dijitalImza || '',
        'Zimmet Fiş No': asset.zimmetFisNo || '',
        Açıklama: asset.aciklama || '',
      };

      Object.entries(asset as Record<string, unknown>).forEach(([key, value]) => {
        if (mappedAssetKeys.has(key)) return;
        row[`Ek Alan: ${key}`] = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value;
      });

      return row;
    });

    exportDataToExcel(data, 'Tum_Envanter_Detaylari', 'TumEnvanter', toast);
  };

  const handleAssetImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const data = await readExcelDataSmart(file, 'product', toast);
      if (!data || data.length === 0) {
        toast({ title: 'Bos Dosya', description: 'Excel dosyasinda veri bulunamadi.', variant: 'default' });
        setLoading(false);
        return;
      }

      const batch = writeBatch(db);
      let newCount = 0, updatedCount = 0;

      for (const row of data) {
        const demirbasNo = String(row['Demirbaş No'] || row['demirbasno'] || '').trim();
        if (!demirbasNo) continue;

        const assetData: Partial<Asset> = {
          category: String(row['Kategori'] || row['kategori'] || '').trim(),
          demirbasNo,
          urunAdi: String(row['Ürün Adı'] || row['urunadi'] || '').trim(),
          seriNumarasi: String(row['Seri Numarası'] || row['serinumarasi'] || '').trim(),
          durum: String(row['Durum'] || row['durum'] || 'iyi').trim() as any,
          marka: String(row['Marka'] || row['marka'] || '').trim(),
          model: String(row['Model'] || row['model'] || '').trim(),
          konum: String(row['Konum'] || row['konum'] || '').trim(),
          teslimEdilenPersonel: String(row['Teslim Edilen Personel'] || row['teslimedilenpersonel'] || '').trim(),
          alimFiyatiTl: Number(row['Alım Fiyatı (TL)'] || row['Alim Fiyati (TL)'] || row['alimfiyatitl'] || row['alim_fiyati_tl'] || 0) || 0,
          satinAlmaTarihi: String(row['Satın Alma Tarihi'] || row['Satin Alma Tarihi'] || row['satinalmatarihi'] || '').trim(),
          garantiBitisTarihi: String(row['Garanti Bitiş Tarihi'] || row['Garanti Bitis Tarihi'] || row['garantibitistarihi'] || '').trim(),
          planliKullanimOmruYil: Number(row['Planlı Kullanım Ömrü (Yıl)'] || row['Planli Kullanim Omru (Yil)'] || row['planlikullanimomruyil'] || 0) || 0,
          amortismanYontemi: String(row['Amortisman Yöntemi'] || row['Amortisman Yontemi'] || row['amortismanyontemi'] || 'dogrusal').trim() as 'dogrusal' | 'azalan_bakiye',
          amortismanBaslangicTarihi: String(row['Amortisman Başlangıç Tarihi'] || row['Amortisman Baslangic Tarihi'] || row['amortismanbaslangictarihi'] || '').trim(),
          hurdaTarihi: String(row['Hurda Tarihi'] || row['hurdatarihi'] || '').trim(),
          imhaTarihi: String(row['İmha Tarihi'] || row['Imha Tarihi'] || row['imhatarihi'] || '').trim(),
          satisTarihi: String(row['Satış Tarihi'] || row['Satis Tarihi'] || row['satistarihi'] || '').trim(),
          sonBakimTarihi: String(row['Son Bakım Tarihi'] || row['Son Bakim Tarihi'] || row['sonbakimtarihi'] || '').trim(),
          sonrakiBakimTarihi: String(row['Sonraki Bakım Tarihi'] || row['Sonraki Bakim Tarihi'] || row['sonrakibakimtarihi'] || '').trim(),
          sonKalibrasyonTarihi: String(row['Son Kalibrasyon Tarihi'] || row['Son Kalibrasyon Tarihi'] || row['sonkalibrasyontarihi'] || '').trim(),
          sonrakiKalibrasyonTarihi: String(row['Sonraki Kalibrasyon Tarihi'] || row['Sonraki Kalibrasyon Tarihi'] || row['sonrakikalibrasyontarihi'] || '').trim(),
          bakimMaliyetiTl: Number(row['Bakım Maliyeti (TL)'] || row['Bakim Maliyeti (TL)'] || row['bakimmaliyetitl'] || 0) || 0,
          zimmetliKisi: String(row['Zimmetli Kişi'] || row['Zimmetli Kisi'] || row['zimmetlikisi'] || '').trim(),
          checkOutTarihi: String(row['Check-Out Tarihi'] || row['checkOutTarihi'] || '').trim(),
          checkInTarihi: String(row['Check-In Tarihi'] || row['checkInTarihi'] || '').trim(),
          dijitalImza: String(row['Dijital İmza'] || row['Dijital Imza'] || row['dijitalimza'] || '').trim(),
          zimmetFisNo: String(row['Zimmet Fiş No'] || row['Zimmet Fis No'] || row['zimmetfisno'] || '').trim(),
          aciklama: String(row['Açıklama'] || row['aciklama'] || '').trim(),
          manuelKonum: locations.some(l => l.name === String(row['Konum'] || '').trim()) ? undefined : String(row['Konum'] || '').trim(),
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
      toast({ title: 'Ice Aktarma Basarili', description: `${newCount} yeni kayit eklendi, ${updatedCount} kayit guncellendi.` });
      fetchData();
    } catch (err) {
      toast({ title: 'Hata', description: 'Excel islenirken bir sorun olustu.', variant: 'destructive' });
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  // Filter items by search
  const filteredCategories = categories.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredLocations = locations.filter(l =>
    l.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <input type="file" ref={assetFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleAssetImport} />

      <div className="cihaz-shell min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24">

          {/* ===== HEADER ===== */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <Link
                href="/yonetim"
                className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Envanter Yonetimi</h1>
                <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">Demirbaş ve varlık takibi</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsLabelModalOpen(true)}
                className="h-9 px-3 rounded-xl text-xs font-semibold bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors flex items-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Etiket Yazdir</span>
              </button>
              <button
                onClick={() => handleOpenModal()}
                disabled={loading}
                className="h-9 px-3 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 transition-all flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Yeni Kategori
              </button>
            </div>
          </div>

          {/* ===== STATS ROW ===== */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: 'Toplam Varlik', value: totalAssets + vehicleCount },
              { label: 'Kategori', value: totalCategories + 1 },
              { label: 'Konum', value: totalLocations },
            ].map((s, i) => (
              <div key={i} className="cihaz-pressed px-4 py-3 flex items-center gap-3">
                <span className="text-lg font-bold text-[var(--dashboard-text)]">{s.value}</span>
                <span className="text-[11px] text-[var(--dashboard-muted)]">{s.label}</span>
              </div>
            ))}
          </div>

          {/* ===== BULK OPERATIONS ===== */}
          <div className="grid grid-cols-1 gap-3 mb-6">
            <div className="cihaz-card p-4">
              <p className="text-xs font-semibold text-[var(--dashboard-text)] mb-3 uppercase tracking-wider">Envanter Toplu Islemleri</p>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => assetFileInputRef.current?.click()}
                  className="cihaz-tool-item h-9 px-3 text-xs font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" /> Excel Yukle / Guncelle
                </button>
                <button
                  onClick={handleDownloadAssetTemplate}
                  className="cihaz-tool-item h-9 px-3 text-xs font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Sablon
                </button>
                <button
                  onClick={handleDownloadCurrentInventory}
                  className="cihaz-tool-item h-9 px-3 text-xs font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Tumunu Excel'e Aktar
                </button>
              </div>
              <p className="text-[11px] mt-2 text-[var(--dashboard-muted)]">
                Ayni <strong>Demirbaş No</strong> ile yuklenen satirlar mevcut urunu gunceller, yeni Demirbaş No olan satirlar yeni kayit olarak eklenir.
              </p>
            </div>
          </div>

          {/* ===== SEARCH + TAB SWITCHER ===== */}
          <div className="cihaz-card-strong p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5">
              {/* Tab switcher */}
              <div className="flex items-center gap-1.5">
                {([
                  { key: 'category' as const, label: 'Kategori', icon: Grid3x3 },
                  { key: 'location' as const, label: 'Konum', icon: LayoutList },
                ]).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      'px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 flex items-center gap-1.5',
                      activeTab === tab.key
                        ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                        : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
                    )}
                  >
                    <tab.icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
                <input
                  type="text"
                  placeholder={activeTab === 'category' ? 'Kategori ara...' : 'Konum ara...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 rounded-xl text-sm bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/30"
                />
              </div>
            </div>

            {/* ===== CONTENT ===== */}
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
              </div>
            ) : activeTab === 'category' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {/* Araclar - special card */}
                <Link href="/yonetim/envanter-yonetimi/araclar" className="block">
                  <div className="cihaz-action-tile relative p-5 flex flex-col items-center text-center min-h-[130px] justify-center">
                    <div className="w-11 h-11 rounded-2xl bg-[var(--dashboard-accent)]/10 flex items-center justify-center mb-3">
                      <Car className="w-5 h-5 text-[var(--dashboard-accent)]" />
                    </div>
                    <p className="text-sm font-semibold text-[var(--dashboard-text)] leading-tight">Araclar</p>
                    <span className="absolute top-2.5 right-2.5 min-w-[22px] h-[22px] rounded-full bg-[var(--dashboard-accent)] text-white text-[10px] font-bold flex items-center justify-center px-1.5">
                      {vehicleCount}
                    </span>
                  </div>
                </Link>

                {filteredCategories.map((category) => {
                  const Icon = getIconForCategory(category.name);
                  const count = assetCountsByCategory[category.name] || 0;
                  return (
                    <div key={category.id} className="group relative">
                      <Link href={`/yonetim/envanter-yonetimi/${encodeURIComponent(category.name)}`} className="block">
                        <div className="cihaz-action-tile relative p-5 pt-12 flex flex-col items-center text-center min-h-[150px] justify-center overflow-visible">
                          <div className="absolute -top-5 -left-4 w-20 h-20 flex items-center justify-center overflow-visible">
                            {envanterIcons[category.name] ? (
                              <NextImage src={getIconSrc(envanterIcons[category.name])} alt="" width={72} height={72} className="object-contain" />
                            ) : (
                              <Icon className="w-10 h-10 text-[var(--dashboard-muted)]" />
                            )}
                          </div>
                          <p className="text-sm font-semibold text-[var(--dashboard-text)] leading-tight line-clamp-2">{category.name}</p>
                          <p className="text-[10px] text-[var(--dashboard-muted)] mt-1">{count} urun</p>
                          <span className="absolute top-2.5 right-2.5 min-w-[22px] h-[22px] rounded-full bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)] text-[10px] font-bold flex items-center justify-center px-1.5 shadow-sm">
                            {count}
                          </span>
                        </div>
                      </Link>
                      {/* Edit / Delete on hover */}
                      <div className="absolute top-8 right-2 flex flex-col items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleOpenModal(category); }}
                          className="w-7 h-7 rounded-lg bg-[var(--dashboard-surface)] shadow-sm flex items-center justify-center text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="w-7 h-7 rounded-lg bg-[var(--dashboard-surface)] shadow-sm flex items-center justify-center text-red-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                              <AlertDialogDescription>
                                &quot;{category.name}&quot; kategorisini silmek, iliskili tum envanter kalemlerini silmez, sadece kategoriyi kaldirir. Devam etmek istiyor musunuz?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Iptal</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteCategory(category.id)} className="bg-destructive hover:bg-destructive/90">
                                Evet, Sil
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  );
                })}

                {filteredCategories.length === 0 && !loading && (
                  <div className="col-span-full text-center py-12 text-sm text-[var(--dashboard-muted)]">
                    {searchQuery ? 'Aramayla eslesen kategori bulunamadi.' : 'Henuz kategori olusturulmadi.'}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredLocations.map((location) => {
                  const count = assetCountsByLocation[location.name] || 0;
                  return (
                    <Link key={location.id} href={`/yonetim/envanter-yonetimi/konum/${encodeURIComponent(location.name)}`} className="block">
                      <div className="cihaz-action-tile relative p-5 flex flex-col items-center text-center min-h-[130px] justify-center">
                        <div className="w-11 h-11 rounded-2xl bg-[var(--dashboard-surface-2)] flex items-center justify-center mb-3">
                          <MapPin className="w-5 h-5 text-[var(--dashboard-muted)]" />
                        </div>
                        <p className="text-sm font-semibold text-[var(--dashboard-text)] leading-tight line-clamp-2">{location.name}</p>
                        <p className="text-[10px] text-[var(--dashboard-muted)] mt-1">{count} varlik</p>
                        <span className="absolute top-2.5 right-2.5 min-w-[22px] h-[22px] rounded-full bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)] text-[10px] font-bold flex items-center justify-center px-1.5 shadow-sm">
                          {count}
                        </span>
                      </div>
                    </Link>
                  );
                })}

                {filteredLocations.length === 0 && !loading && (
                  <div className="col-span-full text-center py-12 text-sm text-[var(--dashboard-muted)]">
                    {searchQuery ? 'Aramayla eslesen konum bulunamadi.' : 'Konum bulunamadi.'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== CATEGORY MODAL ===== */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md cihaz-card-strong !rounded-3xl !p-0 !gap-0 border-0">
          <div className="px-6 pt-6 pb-4 border-b border-[var(--dashboard-stroke)]">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-[var(--dashboard-text)]">
                {editingCategory.id ? 'Kategoriyi Duzenle' : 'Yeni Kategori'}
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="px-6 py-5">
            <input
              type="text"
              placeholder="Kategori adi"
              value={editingCategory.name || ''}
              onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
              className="w-full h-10 px-4 rounded-xl text-sm bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/30"
            />
          </div>
          <div className="px-6 py-4 border-t border-[var(--dashboard-stroke)] flex items-center justify-end gap-2">
            <button
              onClick={() => setIsModalOpen(false)}
              className="h-9 px-4 rounded-xl text-xs font-semibold bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
            >
              Iptal
            </button>
            <button
              onClick={handleSaveCategory}
              disabled={loading}
              className="h-9 px-4 rounded-xl text-xs font-semibold bg-[var(--dashboard-accent)] text-white shadow-md hover:opacity-90 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Kaydet
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <LabelPrinter
        open={isLabelModalOpen}
        onOpenChange={setIsLabelModalOpen}
        assetDetailBasePath="/yonetim/envanter-yonetimi"
      />
    </>
  );
}
