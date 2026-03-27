'use client';
import React, { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  PlusCircle, Computer, Server, Barcode, Printer, BookCopy, Loader2, Edit3, Trash2, MapPin, Upload, Download,
  Fan, Beaker, FlaskConical, Archive, QrCode, Car
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, addDoc, doc, setDoc, deleteDoc, orderBy, query, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BackButton from '@/components/BackButton';
import { readExcelDataSmart, exportDataToExcel } from '@/lib/utils';
import * as XLSX from 'xlsx';
import type { Asset, Depot, Hospital } from '@/lib/types';
import LabelPrinter from '@/components/yonetim/LabelPrinter';


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
  
  const assetFileInputRef = useRef<HTMLInputElement>(null);
  const categoryFileInputRef = useRef<HTMLInputElement>(null);


  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
        const [categoriesSnap, assetsSnap, hospitalsSnap, depotsSnap, vehiclesSnap] = await Promise.all([
            getDocs(query(collection(db, 'assetCategories'), orderBy('name'))),
            getDocs(collection(db, 'assets')),
            getDocs(collection(db, 'hospitals')),
            getDocs(collection(db, 'depots')),
            getDocs(collection(db, 'vehicles')),
        ]);
        setCategories(filterByCompanyScope(
          categoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), name: doc.data().name } as AssetCategory)),
          currentCompanyId,
          isSuperAdmin
        ));
        setAssets(filterByCompanyScope(
          assetsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Asset)),
          currentCompanyId,
          isSuperAdmin
        ));
        const scopedVehicles = filterByCompanyScope(
          vehiclesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
          currentCompanyId,
          isSuperAdmin
        );
        setVehicleCount(scopedVehicles.length);

        const hospitalLocations = filterByCompanyScope(
          hospitalsSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), name: (doc.data() as Hospital).name as string })),
          currentCompanyId,
          isSuperAdmin
        );
        const depotLocations = filterByCompanyScope(
          depotsSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), name: (doc.data() as Depot).name as string })),
          currentCompanyId,
          isSuperAdmin
        );
        setLocations([...hospitalLocations, ...depotLocations].sort((a, b) => a.name.localeCompare(b.name)));

    } catch (e) {
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
        setLoading(false);
    }
  }, [toast, currentCompanyId]);

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
      if(asset.konum) {
        counts[asset.konum] = (counts[asset.konum] || 0) + 1;
      }
    }
    return counts;
  }, [assets]);

  const totalInventoryCost = React.useMemo(
    () => assets.reduce((sum, asset) => sum + (Number(asset.alimFiyatiTl) || 0), 0),
    [assets]
  );

  const costByCategory = React.useMemo(() => {
    const costs: Record<string, number> = {};
    for (const asset of assets) {
      const key = asset.category || 'Diğer';
      costs[key] = (costs[key] || 0) + (Number(asset.alimFiyatiTl) || 0);
    }
    return costs;
  }, [assets]);

  const costByLocation = React.useMemo(() => {
    const costs: Record<string, number> = {};
    for (const asset of assets) {
      const key = asset.konum || 'Bilinmeyen Konum';
      costs[key] = (costs[key] || 0) + (Number(asset.alimFiyatiTl) || 0);
    }
    return costs;
  }, [assets]);

  const formatCurrencyTry = (value: number) =>
    value.toLocaleString('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const includesSearch = (value: string, q: string) => value.toLocaleLowerCase('tr').includes(q);

  const filteredCategoryCards = React.useMemo(() => {
    const q = categorySearch.trim().toLocaleLowerCase('tr');
    if (!q) return categories;
    return categories.filter((category) => {
      const categoryMatches = includesSearch(category.name, q);
      const relatedAssets = assets.filter((asset) => asset.category === category.name);
      const productMatches = relatedAssets.some((asset) => includesSearch(`${asset.urunAdi || ''} ${asset.demirbasNo || ''}`, q));
      const locationMatches = relatedAssets.some((asset) => includesSearch(asset.konum || '', q));
      return categoryMatches || productMatches || locationMatches;
    });
  }, [assets, categories, categorySearch]);

  const filteredLocationCards = React.useMemo(() => {
    const q = locationSearch.trim().toLocaleLowerCase('tr');
    if (!q) return locations;
    return locations.filter((location) => {
      const locationMatches = includesSearch(location.name, q);
      const relatedAssets = assets.filter((asset) => asset.konum === location.name);
      const productMatches = relatedAssets.some((asset) => includesSearch(`${asset.urunAdi || ''} ${asset.demirbasNo || ''}`, q));
      const categoryMatches = relatedAssets.some((asset) => includesSearch(asset.category || '', q));
      return locationMatches || productMatches || categoryMatches;
    });
  }, [assets, locations, locationSearch]);

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
    const data: Record<string, unknown> = withCompanyScope({ name: categoryName }, currentCompanyId);
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
        await addDoc(collection(db, 'assetCategories'), withCompanyScope(data, currentCompanyId));
      }
      toast({ title: 'Başarılı', description: 'Kategori kaydedildi.' });
      setIsModalOpen(false);
      fetchData();
    } catch(e) {
      toast({ title: 'Hata', description: 'Kayıt sırasında bir hata oluştu.', variant: 'destructive' });
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

    const refs = {
        Kategoriler: categories.map(c => c.name),
        Konumlar: locations.map(l => l.name)
    };
    const refData: any[] = [];
    const maxLen = Math.max(refs.Kategoriler.length, refs.Konumlar.length);
    for(let i=0; i < maxLen; i++) {
        refData.push({
            'Kategoriler': refs.Kategoriler[i] || '',
            'Konumlar': refs.Konumlar[i] || ''
        });
    }
    const refSheet = XLSX.utils.json_to_sheet(refData);
    XLSX.utils.book_append_sheet(workbook, refSheet, 'Referans Tanımlar');

    XLSX.writeFile(workbook, 'Envanter_Giris_Sablonu.xlsx');
  };

  const handleDownloadCurrentInventory = () => {
    const data = assets.map((asset) => ({
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
    }));
    exportDataToExcel(data, 'Mevcut_Envanter', 'Envanter', toast);
  };

  const handleDownloadCategoryTemplate = () => {
    const templateData = [{ 'Kategori Adı': '' }];
    exportDataToExcel(templateData, 'Kategori_Giris_Sablonu', 'Kategoriler', toast);
  };
  
  const handleAssetImport = async (e: ChangeEvent<HTMLInputElement>) => {
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
          batch.set(doc(db, 'assets', existingAsset.id), assetData, { merge: true });
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
    } catch(err) {
      toast({ title: 'Hata', description: 'Excel işlenirken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const generateCategoryIcon = async (category: AssetCategory) => {
    if (category.iconSvg) return;
    setIconGeneratingId(category.id);
    try {
      const res = await fetch('/api/envanter/category-icon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryName: category.name }),
      });
      if (!res.ok) {
        throw new Error('İkon üretim servisi hata verdi.');
      }
      const data = await res.json();
      await setDoc(doc(db, 'assetCategories', category.id), withCompanyScope({ iconSvg: data.iconSvg }, currentCompanyId), { merge: true });
      toast({ title: 'Başarılı', description: `"${category.name}" için ikon oluşturuldu.` });
      fetchData();
    } catch (error) {
      toast({ title: 'Hata', description: `"${category.name}" için ikon üretilemedi.`, variant: 'destructive' });
    } finally {
      setIconGeneratingId(null);
    }
  };

  const handleGenerateAllCategoryIcons = async () => {
    const pendingCategories = categories.filter((category) => !category.iconSvg);
    if (pendingCategories.length === 0) {
      toast({ title: 'Bilgi', description: 'Tüm kategorilerde kayıtlı ikon zaten mevcut.' });
      return;
    }
    setBulkGeneratingIcons(true);
    try {
      for (const category of pendingCategories) {
        // eslint-disable-next-line no-await-in-loop
        await generateCategoryIcon(category);
      }
    } finally {
      setBulkGeneratingIcons(false);
    }
  };
  
  const handleCategoryImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
        const data = await readExcelDataSmart(file, 'product', toast);
        const existingCategoryNames = new Set(categories.map(c => c.name.toLowerCase()));
        const batch = writeBatch(db);
        let newCount = 0;
        
        for (const row of data) {
            const categoryName = String(row['Kategori Adı'] || Object.values(row)[0] || '').trim();
            if (categoryName && !existingCategoryNames.has(categoryName.toLowerCase())) {
                const newDocRef = doc(collection(db, 'assetCategories'));
                batch.set(newDocRef, withCompanyScope({ name: categoryName }, currentCompanyId));
                existingCategoryNames.add(categoryName.toLowerCase());
                newCount++;
            }
        }
        
        if (newCount > 0) {
            await batch.commit();
            toast({ title: 'Başarılı', description: `${newCount} yeni kategori eklendi.` });
            fetchData();
        } else {
            toast({ title: 'Değişiklik Yok', description: 'Excel dosyasında yeni bir kategori bulunamadı.', variant: 'default' });
        }
    } catch(err) {
        toast({ title: 'Hata', description: 'Kategori Excel\'i işlenirken bir sorun oluştu.', variant: 'destructive' });
    } finally {
        setLoading(false);
        if (e.target) e.target.value = '';
    }
  };

  return (
    <>
      <input type="file" ref={assetFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleAssetImport} />
      <input type="file" ref={categoryFileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleCategoryImport} />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <BackButton fallback="/yonetim" />
          <div className="flex items-center gap-2">
            <Button onClick={() => handleOpenModal()} size="sm" disabled={loading}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Yeni Kategori
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsLabelModalOpen(true)}
              title="Etiket Yazdır"
            >
              <QrCode className="w-4 h-4 mr-2" />
              Etiket Yazdır
            </Button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Envanter Toplu İşlemleri</CardTitle>
                    <CardDescription>
                      Toplam Envanter Maliyeti: <span className="font-semibold">{formatCurrencyTry(totalInventoryCost)}</span>
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                    <Button onClick={() => assetFileInputRef.current?.click()} size="sm" variant="outline"><Upload className="mr-2 h-4 w-4"/>Envanter Yükle</Button>
                    <Button onClick={handleDownloadAssetTemplate} size="sm" variant="outline"><Download className="mr-2 h-4 w-4"/>Envanter Şablonu</Button>
                    <Button onClick={handleDownloadCurrentInventory} size="sm" variant="outline"><Download className="mr-2 h-4 w-4"/>Mevcut Envanteri İndir</Button>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Kategori Toplu İşlemleri</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                    <Button onClick={() => categoryFileInputRef.current?.click()} size="sm" variant="outline"><Upload className="mr-2 h-4 w-4"/>Kategori Yükle</Button>
                    <Button onClick={handleDownloadCategoryTemplate} size="sm" variant="outline"><Download className="mr-2 h-4 w-4"/>Kategori Şablonu</Button>
                </CardContent>
            </Card>
        </div>

        <Tabs defaultValue="category">
            <TabsList className="mb-4">
                <TabsTrigger value="category">Kategori Görünümü</TabsTrigger>
                <TabsTrigger value="location">Konum Görünümü</TabsTrigger>
            </TabsList>

            <TabsContent value="category">
                <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle className="text-2xl font-headline">Kategoriye Göre Envanter</CardTitle>
                    <CardDescription>
                      Şirkete ait demirbaş malların (bilgisayar, dolap vb.) kategorilerini yönetin.
                    </CardDescription>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        placeholder="Kategori, ürün veya konum ara..."
                        value={categorySearch}
                        onChange={(e) => setCategorySearch(e.target.value)}
                        className="max-w-md"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleGenerateAllCategoryIcons}
                        disabled={bulkGeneratingIcons || loading}
                      >
                        {(bulkGeneratingIcons || loading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Gemini ile İkonları Oluştur
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {/* Araçlar - Özel Kategori */}
                        <Card className="group relative bg-gradient-to-br from-blue-500/10 to-cyan-500/10 hover:from-blue-500/20 hover:to-cyan-500/20 border-blue-500/20 hover:shadow-xl transition-all duration-200 ease-in-out transform hover:-translate-y-1">
                          <Link href="/yonetim/envanter-yonetimi/araclar" className="block cursor-pointer">
                            <CardContent className="flex flex-col items-center justify-center p-6 text-center">
                              <Car className="h-10 w-10 mb-3 text-blue-500" />
                              <CardTitle className="text-base font-semibold">Araçlar</CardTitle>
                            </CardContent>
                          </Link>
                          <Badge variant="default" className="absolute top-2 right-2 bg-blue-500">{vehicleCount}</Badge>
                        </Card>

                        {filteredCategoryCards.map((category) => {
                          const Icon = getIconForCategory(category.name);
                          const count = assetCountsByCategory[category.name] || 0;
                          const categoryCost = costByCategory[category.name] || 0;
                          return (
                            <Card
                              key={category.id}
                              className="group relative bg-card/60 hover:bg-accent/10 hover:shadow-xl transition-all duration-200 ease-in-out transform hover:-translate-y-1"
                            >
                              <Link href={`/yonetim/envanter-yonetimi/${encodeURIComponent(category.name)}`} className="block cursor-pointer">
                                  <CardContent className="flex flex-col items-center justify-center p-6 text-center">
                                  {category.iconSvg ? (
                                    <div className="h-10 w-10 mb-3 text-primary" dangerouslySetInnerHTML={{ __html: category.iconSvg }} />
                                  ) : (
                                    <Icon className="h-10 w-10 mb-3 text-primary" />
                                  )}
                                  <CardTitle className="text-base font-semibold">{category.name}</CardTitle>
                                  <p className="mt-2 text-xs text-muted-foreground font-medium">{formatCurrencyTry(categoryCost)}</p>
                                  </CardContent>
                              </Link>
                              <Badge variant="secondary" className="absolute top-2 right-2">{count}</Badge>
                              <div className="absolute top-2 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); generateCategoryIcon(category); }} disabled={iconGeneratingId === category.id}>
                                  {iconGeneratingId === category.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleOpenModal(category); }}>
                                  <Edit3 className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                     <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                     </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        "{category.name}" kategorisini silmek, ilişkili tüm envanter kalemlerini silmez, sadece kategoriyi kaldırır. Devam etmek istiyor musunuz?
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>İptal</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeleteCategory(category.id)} className="bg-destructive hover:bg-destructive/90">
                                        Evet, Sil
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </Card>
                          );
                        })}
                        {filteredCategoryCards.length === 0 && !loading && (
                            <p className="col-span-full text-center text-muted-foreground">Henüz kategori oluşturulmadı.</p>
                        )}
                        </div>
                    )}
                  </CardContent>
                </Card>
            </TabsContent>
            
            <TabsContent value="location">
                 <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle className="text-2xl font-headline">Konuma Göre Envanter</CardTitle>
                    <CardDescription>
                        Varlıkların fiziksel konumlarına göre gruplanmış hali.
                    </CardDescription>
                    <Input
                      placeholder="Ürün, konum veya kategori ara..."
                      value={locationSearch}
                      onChange={(e) => setLocationSearch(e.target.value)}
                      className="max-w-md"
                    />
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredLocationCards.map((location) => {
                          const Icon = getIconForCategory(location.name);
                          const count = assetCountsByLocation[location.name] || 0;
                          const locationCost = costByLocation[location.name] || 0;
                          return (
                            <Card
                              key={location.id}
                              className="group relative bg-card/60 hover:bg-accent/10 hover:shadow-xl transition-all duration-200 ease-in-out transform hover:-translate-y-1"
                            >
                              <Link href={`/yonetim/envanter-yonetimi/konum/${encodeURIComponent(location.name)}`} className="block cursor-pointer">
                                  <CardContent className="flex flex-col items-center justify-center p-6 text-center">
                                  <Icon className="h-10 w-10 mb-3 text-primary" />
                                  <CardTitle className="text-base font-semibold">{location.name}</CardTitle>
                                  <p className="mt-2 text-xs text-muted-foreground font-medium">{formatCurrencyTry(locationCost)}</p>
                                  </CardContent>
                              </Link>
                              <Badge variant="secondary" className="absolute top-2 right-2">{count}</Badge>
                            </Card>
                          );
                        })}
                        {filteredLocationCards.length === 0 && !loading && (
                            <p className="col-span-full text-center text-muted-foreground">Konum bulunamadı.</p>
                        )}
                        </div>
                    )}
                  </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCategory.id ? 'Kategoriyi Düzenle' : 'Yeni Kategori'}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Kategori adı"
              value={editingCategory.name || ''}
              onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>İptal</Button>
            <Button onClick={handleSaveCategory} disabled={loading}>{loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Kaydet</Button>
          </DialogFooter>
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
