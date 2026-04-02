'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Depot, Hospital, ProductCode, AddressDefinition, LabPool, DepoStokItem, EfficiencyPool } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, setDoc, deleteDoc, doc, writeBatch, Timestamp, query, orderBy, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Edit3, Trash2, SlidersHorizontal, Map, Loader2, Warehouse, Network, Plus, X, FlaskConical, Users, Star, FileSpreadsheet, BarChart3, ListOrdered, Mail, Upload, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import MinMaxSettingsPanel from '@/components/MinMaxSettingsPanel';
import BackButton from '@/components/BackButton';
import dynamic from 'next/dynamic';
import SharedLabPoolModal from '@/components/SharedLabPoolModal';
import EfficiencyPoolModal from '@/components/EfficiencyPoolModal';
import ProductOrderModal from '@/components/ProductOrderModal';
import { exportDataToExcel, readExcelData } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';


const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full bg-muted rounded-md"><Loader2 className="h-6 w-6 animate-spin" /></div>,
});


export default function LaboratuvarPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [addressDefinitions, setAddressDefinitions] = useState<AddressDefinition[]>([]);
  const [depoStok, setDepoStok] = useState<DepoStokItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentHospital, setCurrentHospital] = useState<Partial<Hospital>>({});
  const [responsibleEmailsInput, setResponsibleEmailsInput] = useState('');
  const [isMinMaxPanelOpen, setIsMinMaxPanelOpen] = useState(false);
  const [minMaxTarget, setMinMaxTarget] = useState<Hospital | null>(null);

  const [hospitalSubPoints, setHospitalSubPoints] = useState<{ id?: string; name: string; isActive?: boolean }[]>([]);
  const [newSubPointName, setNewSubPointName] = useState('');
  const [isSavingSubPoint, setIsSavingSubPoint] = useState(false);
  const [isEditingHospital, setIsEditingHospital] = useState(false);

  const [isPoolModalOpen, setIsPoolModalOpen] = useState(false);
  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [isPoolListModalOpen, setIsPoolListModalOpen] = useState(false);
  const [poolDetailsModal, setPoolDetailsModal] = useState<{ open: boolean; pool: LabPool | null }>({ open: false, pool: null });

  // Verimlilik Havuzu State
  const [isEfficiencyPoolModalOpen, setIsEfficiencyPoolModalOpen] = useState(false);
  const [isEfficiencyPoolListOpen, setIsEfficiencyPoolListOpen] = useState(false);
  const [efficiencyPools, setEfficiencyPools] = useState<EfficiencyPool[]>([]);
  const [efficiencyPoolDetailsModal, setEfficiencyPoolDetailsModal] = useState<{ open: boolean; pool: EfficiencyPool | null }>({ open: false, pool: null });

  // Özel Sıralama Modal State
  const [isProductOrderModalOpen, setIsProductOrderModalOpen] = useState(false);
  const [productOrderTarget, setProductOrderTarget] = useState<Hospital | null>(null);

  // Excel İçe Aktarma State
  const [isExcelImportModalOpen, setIsExcelImportModalOpen] = useState(false);
  const [excelImportData, setExcelImportData] = useState<any[]>([]);
  const [excelImportSelected, setExcelImportSelected] = useState<Set<number>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; skipped: number; errors: string[] } | null>(null);
  const excelFileInputRef = React.useRef<HTMLInputElement>(null);

  const parseResponsibleEmails = (value: unknown): string[] => {
    const rawList = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/[,\n;]+/)
        : [];

    const seen = new Set<string>();
    return rawList
      .map((mail) => String(mail || '').trim())
      .filter((mail) => {
        if (!mail) return false;
        const normalized = mail.toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
  };

  const getResponsibleEmails = (hospitalLike: Partial<Hospital>): string[] => {
    const multi = parseResponsibleEmails((hospitalLike as any).sorumluEmails);
    if (multi.length > 0) return multi;
    return parseResponsibleEmails((hospitalLike as any).sorumluEmail);
  };


  const fetchHospitalsAndProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const [hSnap, pSnap, addrSnap, poolsSnap, stokSnap, effPoolsSnap] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'addressDefinitions')),
        getDocs(query(collection(db, 'labPools'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'depoStok')),
        getDocs(query(collection(db, 'efficiencyPools'), orderBy('createdAt', 'desc'))),
      ]);
      setHospitals(filterByCompanyScope(hSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)), currentCompanyId, isSuperAdmin));
      setProductCodes(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
      setAddressDefinitions(filterByCompanyScope(addrSnap.docs.map(d => ({ id: d.id, ...d.data() } as AddressDefinition)), currentCompanyId, isSuperAdmin));
      setLabPools(filterByCompanyScope(poolsSnap.docs.map(d => ({ id: d.id, ...d.data() } as LabPool)), currentCompanyId, isSuperAdmin));
      setDepoStok(filterByCompanyScope(stokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)), currentCompanyId, isSuperAdmin));
      setEfficiencyPools(filterByCompanyScope(effPoolsSnap.docs.map(d => ({ id: d.id, ...d.data() } as EfficiencyPool)), currentCompanyId, isSuperAdmin));

    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    fetchHospitalsAndProducts();
  }, [fetchHospitalsAndProducts]);

  const openModal = (hospital?: Hospital) => {
    if (hospital && hospital.id) {
        setCurrentHospital(hospital);
        setResponsibleEmailsInput(getResponsibleEmails(hospital).join(', '));
        setIsEditingHospital(true);
        setIsModalOpen(true);
        
        (async () => {
          try {
            const snap = await getDocs(query(collection(db, 'hospitals', hospital.id!, 'subPoints'), orderBy('name', 'asc')));
            const items = snap.docs.map(d => {
              const data = d.data() as any;
              return { id: d.id, name: data.name, isActive: data.isActive ?? true };
            });
            setHospitalSubPoints(items);
          } catch (e) {
            console.error('SubPoints fetch error', e);
            toast({ title: 'Alt Nokta', description: 'Alt tüketim noktaları yüklenemedi.', variant: 'destructive' });
          }
        })();

    } else {
        setCurrentHospital({ consumptionTrackingEnabled: true, isConsumablesHospital: false, manualDeductionEnabled: false, fefoEnabled: true, kod: '' }); // Default FEFO to ON for new labs
        setResponsibleEmailsInput('');
        setIsEditingHospital(false);
        setIsModalOpen(true);
        setHospitalSubPoints([]);
        setNewSubPointName('');
    }
  };
  
  const handleAddressInputChange = (value: string) => {
    const coordsMatch = value.match(/^([-]?\d{1,2}\.\d+),\s*([-]?\d{1,3}\.\d+)$/);
    if (coordsMatch) {
      const lat = parseFloat(coordsMatch[1]);
      const lng = parseFloat(coordsMatch[2]);
      setCurrentHospital(prev => ({ ...prev, address: value, lat, lng }));
    } else {
      setCurrentHospital(prev => ({ ...prev, address: value }));
    }
  };

  const handleSave = async () => {
    if (!currentHospital.name) {
      toast({ title: 'Hata', description: 'Laboratuvar adı boş olamaz.', variant: 'destructive' });
      return;
    }
    
    setIsLoading(true);
    try {
      const responsibleEmails = parseResponsibleEmails(responsibleEmailsInput);
      const dataToSave: Partial<Hospital> = {
        name: currentHospital.name.trim(),
        kod: (currentHospital.kod || '').trim().toUpperCase(),
        address: currentHospital.address || '',
        lat: currentHospital.lat || null,
        lng: currentHospital.lng || null,
        consumptionTrackingEnabled: currentHospital.consumptionTrackingEnabled ?? true,
        isConsumablesHospital: currentHospital.isConsumablesHospital ?? false,
        manualDeductionEnabled: currentHospital.manualDeductionEnabled ?? false,
        fefoEnabled: currentHospital.fefoEnabled ?? true,
        autoTutanak: (currentHospital as any).autoTutanak ?? false,
        sorumluEmails: responsibleEmails,
        sorumluEmail: responsibleEmails[0] || '',
        updatedAt: new Date(),
      };

      if (currentHospital.id && isEditingHospital) {
        await setDoc(doc(db, 'hospitals', currentHospital.id), withCompanyScope(dataToSave, currentUserProfile?.companyId), { merge: true });
        toast({ title: 'Başarılı', description: 'Laboratuvar güncellendi.' });
      } else {
        const newRef = doc(collection(db, 'hospitals'));
        await setDoc(newRef, withCompanyScope({ ...dataToSave, createdAt: new Date() }, currentUserProfile?.companyId));
        
        if (hospitalSubPoints.length > 0) {
            const batch = writeBatch(db);
            hospitalSubPoints.forEach(sp => {
                const spRef = doc(collection(db, 'hospitals', newRef.id, 'subPoints'));
                batch.set(spRef, withCompanyScope({
                    name: sp.name,
                    isActive: true,
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                }, currentUserProfile?.companyId));
            });
            await batch.commit();
        }
        toast({ title: 'Başarılı', description: 'Laboratuvar ve alt tüketim noktaları oluşturuldu.' });
      }
      
      fetchHospitalsAndProducts();
      setIsModalOpen(false);
      setCurrentHospital({});
      setResponsibleEmailsInput('');
      setHospitalSubPoints([]);

    } catch (error) {
      toast({ title: 'Hata', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu laboratuvarı silmek istediğinizden emin misiniz?')) {
      await deleteDoc(doc(db, 'hospitals', id));
      toast({ title: 'Silindi', description: 'Laboratuvar silindi.', variant: 'destructive' });
      fetchHospitalsAndProducts();
    }
  };

  const openMinMaxPanel = (hospital: Hospital) => {
    setMinMaxTarget(hospital);
    setIsMinMaxPanelOpen(true);
  };
  
  const handleAddSubPointInline = async () => {
    const name = newSubPointName.trim();
    if (!name) return;

    if (isEditingHospital && currentHospital?.id) {
        setIsSavingSubPoint(true);
        try {
            const newDocRef = await addDoc(collection(db, 'hospitals', currentHospital.id, 'subPoints'), withCompanyScope({
                name,
                isActive: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            }, currentUserProfile?.companyId));
            setHospitalSubPoints(prev => [...prev, { id: newDocRef.id, name, isActive: true }].sort((a,b)=>a.name.localeCompare(b.name)));
            setNewSubPointName('');
            toast({ title: 'Alt Nokta', description: 'Alt tüketim noktası eklendi.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Hata', description: 'Alt tüketim noktası eklenemedi.', variant: 'destructive' });
        } finally {
            setIsSavingSubPoint(false);
        }
    } else {
        setHospitalSubPoints(prev => [...prev, { name }].sort((a,b)=>a.name.localeCompare(b.name)));
        setNewSubPointName('');
    }
  };

  const handleRemoveSubPoint = async (sp: { id?: string; name: string }) => {
    if (isEditingHospital && currentHospital?.id && sp.id) {
        setIsSavingSubPoint(true);
        try {
            await deleteDoc(doc(db, 'hospitals', currentHospital.id!, 'subPoints', sp.id));
            setHospitalSubPoints(prev => prev.filter(x => x.id !== sp.id));
            toast({ title: 'Alt Nokta', description: 'Silindi.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Hata', description: 'Alt nokta silinemedi.', variant: 'destructive' });
        } finally {
            setIsSavingSubPoint(false);
        }
    } else {
        setHospitalSubPoints(prev => prev.filter(x => x.name !== sp.name));
    }
  };
  
  const handleSetMainLab = async (pool: LabPool, mainLabId: string) => {
    setIsLoading(true);
    try {
        await updateDoc(doc(db, 'labPools', pool.id), { mainLabId });
        setPoolDetailsModal({ open: true, pool: { ...pool, mainLabId }});
        fetchHospitalsAndProducts(); // Refresh list to show change immediately
        toast({ title: "Başarılı", description: "Ana laboratuvar güncellendi." });
    } catch (e) {
        toast({ title: 'Hata', description: 'Ana laboratuvar güncellenemedi.', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  };

  const handleDeleteEfficiencyPool = async (poolId: string) => {
    if (confirm('Bu verimlilik havuzunu silmek istediğinizden emin misiniz?')) {
      setIsLoading(true);
      try {
        await deleteDoc(doc(db, 'efficiencyPools', poolId));
        toast({ title: 'Silindi', description: 'Verimlilik havuzu silindi.' });
        setEfficiencyPoolDetailsModal({ open: false, pool: null });
        fetchHospitalsAndProducts();
      } catch (error) {
        toast({ title: 'Hata', description: 'Havuz silinemedi.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handlePoolStockExport = async (pool: LabPool | null) => {
    if (!pool) return;
    const labNamesInPool = new Set(
      hospitals
        .filter(h => pool.memberIds.includes(h.id))
        .map(h => h.name)
    );

    const stockInPool = depoStok.filter(
      item => item.isShipped && item.hedefKurum && labNamesInPool.has(item.hedefKurum)
    );

    const stockSummary: Record<string, { stokAdi: string, quantity: number }> = {};

    stockInPool.forEach(item => {
      if (!stockSummary[item.stokKodu]) {
        stockSummary[item.stokKodu] = {
          stokAdi: productCodes.find(p => p.stokKodu === item.stokKodu)?.stokAdi || item.stokAdi,
          quantity: 0
        };
      }
      stockSummary[item.stokKodu].quantity += 1;
    });

    const dataToExport = Object.entries(stockSummary).map(([stokKodu, data]) => ({
      'Stok Kodu': stokKodu,
      'Stok Adı': data.stokAdi,
      'Toplam Adet': data.quantity
    })).sort((a,b) => a['Stok Adı'].localeCompare(b['Stok Adı']));

    if (dataToExport.length === 0) {
      toast({ title: 'Veri Yok', description: 'Bu havuz için dışa aktarılacak stok verisi bulunamadı.', variant: 'default' });
      return;
    }

    exportDataToExcel(dataToExport, `Havuz_Stok_Raporu_${pool.name}`, "HavuzStok", toast);
  };

  const handleExcelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const data = await readExcelData(file, toast);
      if (!data || data.length === 0) {
        toast({ title: 'Boş Dosya', description: 'Excel dosyasında veri bulunamadı.', variant: 'destructive' });
        return;
      }

      const mapped = data.map((row: any) => ({
        name: (row['Laboratuvar Adı'] || row['Ad'] || row['name'] || '').toString().trim(),
        kod: (row['Kod'] || row['kod'] || row['Laboratuvar Kodu'] || '').toString().trim().toUpperCase(),
        address: (row['Adres'] || row['address'] || '').toString().trim(),
        sorumluEmails: parseResponsibleEmails(row['E-posta'] || row['Email'] || row['sorumluEmails'] || row['sorumluEmail'] || ''),
        consumptionTrackingEnabled: parseExcelBoolean(row['Tüketim Takibi'] ?? row['consumptionTrackingEnabled'], true),
        fefoEnabled: parseExcelBoolean(row['FEFO'] ?? row['fefoEnabled'], true),
        manualDeductionEnabled: parseExcelBoolean(row['Manuel Düşüm'] ?? row['manualDeductionEnabled'], false),
        isConsumablesHospital: parseExcelBoolean(row['Hastane Sarf'] ?? row['isConsumablesHospital'], false),
        autoTutanak: parseExcelBoolean(row['Otomatik Tutanak'] ?? row['autoTutanak'], false),
      }));

      const validRows = mapped.filter((r: any) => r.name);
      if (validRows.length === 0) {
        toast({ title: 'Geçersiz Veri', description: "Excel'de 'Laboratuvar Adı' veya 'Ad' sütunu bulunamadı veya tüm satırlar boş.", variant: 'destructive' });
        return;
      }

      setExcelImportData(validRows);
      setExcelImportSelected(new Set(validRows.map((_: any, i: number) => i)));
      setImportResult(null);
      setIsExcelImportModalOpen(true);
    } catch (err) {
      console.error('Excel parse error:', err);
    }
  };

  const parseExcelBoolean = (value: any, defaultVal: boolean): boolean => {
    if (value === undefined || value === null || value === '') return defaultVal;
    const str = value.toString().toLowerCase().trim();
    if (['evet', 'yes', 'true', '1', 'aktif', 'açık'].includes(str)) return true;
    if (['hayır', 'hayir', 'no', 'false', '0', 'pasif', 'kapalı', 'kapali'].includes(str)) return false;
    return defaultVal;
  };

  const handleExcelImport = async () => {
    const selectedRows = excelImportData.filter((_, i) => excelImportSelected.has(i));
    if (selectedRows.length === 0) {
      toast({ title: 'Seçim Yok', description: 'Lütfen en az bir laboratuvar seçin.', variant: 'destructive' });
      return;
    }

    setIsImporting(true);
    const errors: string[] = [];
    let success = 0;
    let skipped = 0;

    const existingNames = new Set(hospitals.map(h => h.name.toLowerCase().trim()));
    const existingKods = new Set(hospitals.filter(h => h.kod).map(h => h.kod!.toLowerCase().trim()));

    for (const row of selectedRows) {
      try {
        if (existingNames.has(row.name.toLowerCase())) {
          skipped++;
          errors.push(`"${row.name}" - zaten mevcut (ad eşleşmesi)`);
          continue;
        }
        if (row.kod && existingKods.has(row.kod.toLowerCase())) {
          skipped++;
          errors.push(`"${row.name}" (${row.kod}) - bu kod zaten kullanılıyor`);
          continue;
        }

        const dataToSave: Partial<Hospital> = {
          name: row.name,
          kod: row.kod || '',
          address: row.address || '',
          sorumluEmails: row.sorumluEmails || [],
          sorumluEmail: row.sorumluEmails?.[0] || '',
          consumptionTrackingEnabled: row.consumptionTrackingEnabled,
          fefoEnabled: row.fefoEnabled,
          manualDeductionEnabled: row.manualDeductionEnabled,
          isConsumablesHospital: row.isConsumablesHospital,
          autoTutanak: row.autoTutanak,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const newRef = doc(collection(db, 'hospitals'));
        await setDoc(newRef, withCompanyScope(dataToSave, currentUserProfile?.companyId));
        success++;
        existingNames.add(row.name.toLowerCase());
        if (row.kod) existingKods.add(row.kod.toLowerCase());
      } catch (err: any) {
        errors.push(`"${row.name}" - kayıt hatası: ${err.message}`);
      }
    }

    setImportResult({ success, skipped, errors });
    setIsImporting(false);

    if (success > 0) {
      toast({ title: 'İçe Aktarma Tamamlandı', description: `${success} laboratuvar başarıyla eklendi.` });
      fetchHospitalsAndProducts();
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Laboratuvar Adı': 'Örnek Laboratuvar 1',
        'Kod': 'OL1',
        'Adres': 'Örnek Mah. 123. Sk.',
        'E-posta': 'sorumlu1@lab.com, sorumlu2@lab.com',
        'Tüketim Takibi': 'Evet',
        'FEFO': 'Evet',
        'Manuel Düşüm': 'Hayır',
        'Hastane Sarf': 'Hayır',
        'Otomatik Tutanak': 'Hayır',
      },
      {
        'Laboratuvar Adı': 'Örnek Laboratuvar 2',
        'Kod': 'OL2',
        'Adres': '',
        'E-posta': '',
        'Tüketim Takibi': 'Evet',
        'FEFO': 'Evet',
        'Manuel Düşüm': 'Hayır',
        'Hastane Sarf': 'Hayır',
        'Otomatik Tutanak': 'Hayır',
      },
    ];
    exportDataToExcel(templateData, 'Laboratuvar_Sablonu', 'Laboratuvarlar', toast);
  };

  const toggleExcelSelectAll = () => {
    if (excelImportSelected.size === excelImportData.length) {
      setExcelImportSelected(new Set());
    } else {
      setExcelImportSelected(new Set(excelImportData.map((_, i) => i)));
    }
  };

  const toggleExcelSelect = (idx: number) => {
    setExcelImportSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <>
      <div className="p-4 space-y-4">
        <BackButton fallback="/yonetim" />
        <Card className="shadow-lg">
          <CardHeader className="flex flex-row justify-between items-center">
            <div>
              <CardTitle className="text-xl font-headline flex items-center">
                <FlaskConical className="mr-2 h-6 w-6 text-green-500" />
                Laboratuvar Yönetimi
              </CardTitle>
              <CardDescription>Yeni laboratuvarlar ekleyin veya mevcutları düzenleyin.</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setIsEfficiencyPoolListOpen(true)} size="sm" disabled={isLoading}>
                <BarChart3 className="mr-2 h-4 w-4" />
                Verimlilik Havuzları
              </Button>
              <Button variant="secondary" onClick={() => setIsEfficiencyPoolModalOpen(true)} size="sm" disabled={isLoading}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Verimlilik Havuzu Oluştur
              </Button>
              <Button variant="secondary" onClick={() => setIsPoolListModalOpen(true)} size="sm" disabled={isLoading}>
                  Ortak Laboratuvarları Göster
              </Button>
              <Button onClick={() => setIsPoolModalOpen(true)} size="sm" disabled={isLoading}>
                Ortak Laboratuvar Oluştur
              </Button>
              <Button variant="outline" onClick={handleDownloadTemplate} size="sm" disabled={isLoading}>
                <Download className="mr-2 h-4 w-4" />
                Şablon İndir
              </Button>
              <Button variant="outline" onClick={() => excelFileInputRef.current?.click()} size="sm" disabled={isLoading}>
                <Upload className="mr-2 h-4 w-4" />
                Excel ile İçe Aktar
              </Button>
              <input
                ref={excelFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleExcelFileSelect}
              />
              <Button onClick={() => openModal()} size="sm" disabled={isLoading}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Yeni Laboratuvar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <ScrollArea className="h-[300px] border rounded-md">
                <Table>
                  <TableHeader><TableRow><TableHead>Adı</TableHead><TableHead>Kod</TableHead><TableHead>Adres</TableHead><TableHead className="text-right">İşlemler</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {hospitals.map(h => (
                      <TableRow key={h.id}>
                        <TableCell className="font-medium">{h.name}</TableCell>
                        <TableCell className="font-mono text-xs">{h.kod}</TableCell>
                        <TableCell>{h.address}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => openMinMaxPanel(h)} title="Min-Max Ayarları"><SlidersHorizontal className="h-4 w-4 text-primary" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { setProductOrderTarget(h); setIsProductOrderModalOpen(true); }} title="Özel Sıralama"><ListOrdered className="h-4 w-4 text-amber-500" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => openModal(h)} title="Düzenle"><Edit3 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(h.id)} title="Sil"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{currentHospital.id ? 'Laboratuvar Düzenle' : 'Yeni Laboratuvar'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-4">
              <Input placeholder="Laboratuvar Adı" value={currentHospital.name || ''} onChange={(e) => setCurrentHospital({ ...currentHospital, name: e.target.value })} />
              <Input placeholder="Laboratuvar Kodu (Max 3 Karakter)" value={currentHospital.kod || ''} onChange={(e) => setCurrentHospital({ ...currentHospital, kod: e.target.value.toUpperCase() })} maxLength={3} />
              <Input placeholder="Adres" value={currentHospital.address || ''} onChange={(e) => handleAddressInputChange(e.target.value)} />
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Sorumlu E-postaları (virgül ile)"
                  value={responsibleEmailsInput}
                  onChange={(e) => setResponsibleEmailsInput(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                    id="fefo-enabled-switch"
                    checked={currentHospital.fefoEnabled ?? true}
                    onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, fefoEnabled: checked })}
                    />
                    <Label htmlFor="fefo-enabled-switch">
                        FEFO Takibi Aktif
                        <p className="text-xs text-muted-foreground">
                            Kapalıysa, ürün kullanımında miad kontrolü yapılmaz.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                    id="consumption-tracking-switch"
                    checked={currentHospital.consumptionTrackingEnabled ?? true}
                    onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, consumptionTrackingEnabled: checked })}
                    />
                    <Label htmlFor="consumption-tracking-switch">
                        Tüketim Takibi Aktif
                        <p className="text-xs text-muted-foreground">
                            Kapalıysa, sevk edilen ürünler direkt tüketilmiş sayılır.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                        id="manual-deduction-switch"
                        checked={currentHospital.manualDeductionEnabled ?? false}
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, manualDeductionEnabled: checked })}
                    />
                    <Label htmlFor="manual-deduction-switch">
                        Manuel Düşüme İzin Ver
                        <p className="text-xs text-muted-foreground">
                            Aktifse, Ürün Kullanım panelinde manuel düşüm butonu görünür.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                        id="auto-tutanak-switch"
                        checked={(currentHospital as any).autoTutanak ?? false}
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, autoTutanak: checked })}
                    />
                    <Label htmlFor="auto-tutanak-switch">
                        Otomatik Tutanak
                        <p className="text-xs text-muted-foreground">
                            Bu özellik etkinleştirildiğinde ilgili işlemler için otomatik tutanak oluşturulur.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                        id="is-consumables-hospital-switch"
                        checked={currentHospital.isConsumablesHospital ?? false}
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, isConsumablesHospital: checked })}
                    />
                    <Label htmlFor="is-consumables-hospital-switch">
                        Hastane Sarf Kategorisi
                        <p className="text-xs text-muted-foreground">
                            Aktifse, bu laboratuvar sadece Sarf Dağıtım panelinde görünür.
                        </p>
                    </Label>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-background/40 p-3">
                <div className="flex items-center gap-2 mb-2">
                    <Network className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Alt Tüketim Noktaları</span>
                </div>
                <div className="flex gap-2">
                    <Input
                    placeholder="Örn. X-1"
                    value={newSubPointName}
                    onChange={(e) => setNewSubPointName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSubPointInline()}
                    className="flex-1"
                    />
                    <Button onClick={handleAddSubPointInline} disabled={!newSubPointName.trim() || isSavingSubPoint}>
                    {isSavingSubPoint ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                    Ekle
                    </Button>
                </div>
                {hospitalSubPoints.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                    {hospitalSubPoints.map((sp, idx) => (
                        <span key={`${sp.id ?? 'tmp'}-${idx}`} className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-muted text-muted-foreground">
                        <span className="text-sm">{sp.name}</span>
                        <button
                            type="button"
                            onClick={() => handleRemoveSubPoint(sp)}
                            className="hover:text-destructive transition-colors"
                            title="Kaldır"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                        </span>
                    ))}
                    </div>
                ) : (
                    <p className="mt-2 text-xs text-muted-foreground">Henüz alt tüketim noktası eklenmedi.</p>
                )}
                {isEditingHospital ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Not: Düzenleme modunda eklenen/silinen alt noktalar anında kaydedilir.
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Not: Yeni laboratuvar kaydedildikten sonra alt noktalar oluşturulacaktır.
                  </p>
                )}
              </div>
            </div>
            <div className="h-96 rounded-md overflow-hidden">
                <LocationPicker
                    initialPosition={[currentHospital.lat || 41.015137, currentHospital.lng || 28.979530]}
                    markerPosition={currentHospital.lat ? [currentHospital.lat, currentHospital.lng!] : undefined}
                    onSelect={(lat, lng) => setCurrentHospital(prev => ({...prev, lat, lng}))}
                />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSave} disabled={isLoading}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {isMinMaxPanelOpen && minMaxTarget && (
        <MinMaxSettingsPanel
          isOpen={isMinMaxPanelOpen}
          onClose={() => setIsMinMaxPanelOpen(false)}
          target={minMaxTarget}
          targetType="hospital"
          productCodes={productCodes}
          toast={toast}
        />
      )}

      <SharedLabPoolModal open={isPoolModalOpen} onOpenChange={setIsPoolModalOpen} />
      
      <Dialog open={isPoolListModalOpen} onOpenChange={setIsPoolListModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mevcut Ortak Havuzlar</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-72 mt-4">
            <div className="space-y-3">
              {labPools.length === 0 ? <p className="text-sm text-muted-foreground">Ortak havuz bulunamadı.</p>
                : labPools.map(pool => (
                  <div key={pool.id} className="p-3 border rounded-md flex justify-between items-center cursor-pointer hover:bg-muted/50" onClick={() => setPoolDetailsModal({ open: true, pool })}>
                    <div>
                        <p className="font-semibold">{pool.name}</p>
                        <p className="text-xs text-muted-foreground">{pool.memberIds.length} üye</p>
                    </div>
                    <Button variant="ghost" size="icon"><Edit3 className="h-4 w-4"/></Button>
                  </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={poolDetailsModal.open} onOpenChange={(open) => !open && setPoolDetailsModal({open: false, pool: null})}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Havuz Detayları: {poolDetailsModal.pool?.name}</DialogTitle>
              <Button variant="outline" size="sm" onClick={() => handlePoolStockExport(poolDetailsModal.pool)}>
                <FileSpreadsheet className="h-4 w-4 mr-2"/>
                Havuz Stok Raporu
              </Button>
            </div>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <h4 className="font-medium">Üye Laboratuvarlar</h4>
            <div className="space-y-2">
            {poolDetailsModal.pool?.memberIds.map(labId => {
                const lab = hospitals.find(h => h.id === labId);
                const isMain = poolDetailsModal.pool?.mainLabId === labId;
                return (
                    <div key={labId} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                        <span className="text-sm flex items-center gap-2">
                           {isMain && <Star className="h-4 w-4 text-amber-500 fill-amber-400" />}
                           {lab?.name || 'Bilinmeyen Lab'}
                        </span>
                        {!isMain && (
                          <Button size="sm" variant="outline" onClick={() => handleSetMainLab(poolDetailsModal.pool!, labId)}>Ana Olarak Ayarla</Button>
                        )}
                    </div>
                );
            })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Verimlilik Havuzu Modalları */}
      <EfficiencyPoolModal
        open={isEfficiencyPoolModalOpen}
        onOpenChange={setIsEfficiencyPoolModalOpen}
        onPoolCreated={fetchHospitalsAndProducts}
      />

      <Dialog open={isEfficiencyPoolListOpen} onOpenChange={setIsEfficiencyPoolListOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Verimlilik Havuzları
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-72 mt-4">
            <div className="space-y-3">
              {efficiencyPools.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Henüz verimlilik havuzu oluşturulmadı.
                </p>
              ) : (
                efficiencyPools.map(pool => (
                  <div
                    key={pool.id}
                    className="p-3 border rounded-md flex justify-between items-center cursor-pointer hover:bg-muted/50"
                    onClick={() => setEfficiencyPoolDetailsModal({ open: true, pool })}
                  >
                    <div>
                      <p className="font-semibold">{pool.name}</p>
                      <p className="text-xs text-muted-foreground">{pool.memberIds.length} laboratuvar</p>
                    </div>
                    <Button variant="ghost" size="icon"><Edit3 className="h-4 w-4" /></Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={efficiencyPoolDetailsModal.open} onOpenChange={(open) => !open && setEfficiencyPoolDetailsModal({ open: false, pool: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verimlilik Havuzu: {efficiencyPoolDetailsModal.pool?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <h4 className="font-medium">Dahil Laboratuvarlar</h4>
            <ScrollArea className="h-48">
              <div className="space-y-2">
                {efficiencyPoolDetailsModal.pool?.memberIds.map(labId => {
                  const lab = hospitals.find(h => h.id === labId);
                  return (
                    <div key={labId} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                      <span className="text-sm flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-green-500" />
                        {lab?.name || 'Bilinmeyen Lab'}
                        {lab?.kod && <span className="text-xs font-mono text-muted-foreground">({lab.kod})</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => efficiencyPoolDetailsModal.pool && handleDeleteEfficiencyPool(efficiencyPoolDetailsModal.pool.id)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Havuzu Sil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Özel Sıralama Modal */}
      {productOrderTarget && (
        <ProductOrderModal
          open={isProductOrderModalOpen}
          onOpenChange={(open) => {
            setIsProductOrderModalOpen(open);
            if (!open) setProductOrderTarget(null);
          }}
          hospital={productOrderTarget}
          productCodes={productCodes}
          onSaved={fetchHospitalsAndProducts}
        />
      )}

      {/* Excel İçe Aktarma Modal */}
      <Dialog open={isExcelImportModalOpen} onOpenChange={(open) => {
        if (!open) {
          setIsExcelImportModalOpen(false);
          setExcelImportData([]);
          setExcelImportSelected(new Set());
          setImportResult(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-green-500" />
              Excel ile Laboratuvar İçe Aktarma
            </DialogTitle>
          </DialogHeader>

          {importResult ? (
            <div className="py-6 space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <div>
                  <p className="font-semibold text-lg">{importResult.success} laboratuvar başarıyla eklendi</p>
                  {importResult.skipped > 0 && (
                    <p className="text-sm text-muted-foreground">{importResult.skipped} kayıt atlandı (zaten mevcut)</p>
                  )}
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium flex items-center gap-1">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    Detaylar
                  </p>
                  <ScrollArea className="h-40 border rounded-md p-3">
                    {importResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-muted-foreground py-0.5">{err}</p>
                    ))}
                  </ScrollArea>
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => {
                  setIsExcelImportModalOpen(false);
                  setExcelImportData([]);
                  setExcelImportSelected(new Set());
                  setImportResult(null);
                }}>Kapat</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground mb-2">
                Toplam {excelImportData.length} satır bulundu. Eklemek istediğiniz laboratuvarları seçin.
              </div>
              <ScrollArea className="flex-1 border rounded-md min-h-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={excelImportSelected.size === excelImportData.length && excelImportData.length > 0}
                          onCheckedChange={toggleExcelSelectAll}
                        />
                      </TableHead>
                      <TableHead>Laboratuvar Adı</TableHead>
                      <TableHead>Kod</TableHead>
                      <TableHead>Adres</TableHead>
                      <TableHead>E-posta</TableHead>
                      <TableHead className="text-center">FEFO</TableHead>
                      <TableHead className="text-center">Tüketim</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {excelImportData.map((row, idx) => {
                      const isDuplicate = hospitals.some(h => h.name.toLowerCase().trim() === row.name.toLowerCase());
                      return (
                        <TableRow key={idx} className={isDuplicate ? 'opacity-50' : ''}>
                          <TableCell>
                            <Checkbox
                              checked={excelImportSelected.has(idx)}
                              onCheckedChange={() => toggleExcelSelect(idx)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {row.name}
                            {isDuplicate && (
                              <span className="ml-2 text-xs text-amber-500">(mevcut)</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.kod}</TableCell>
                          <TableCell className="text-xs">{row.address}</TableCell>
                          <TableCell className="text-xs">{(row.sorumluEmails || []).join(', ')}</TableCell>
                          <TableCell className="text-center text-xs">{row.fefoEnabled ? 'Evet' : 'Hayır'}</TableCell>
                          <TableCell className="text-center text-xs">{row.consumptionTrackingEnabled ? 'Evet' : 'Hayır'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
              <DialogFooter className="mt-4">
                <div className="flex items-center gap-2 mr-auto text-sm text-muted-foreground">
                  {excelImportSelected.size} / {excelImportData.length} seçili
                </div>
                <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
                <Button onClick={handleExcelImport} disabled={isImporting || excelImportSelected.size === 0}>
                  {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  {isImporting ? 'İçe Aktarılıyor...' : `${excelImportSelected.size} Laboratuvar Ekle`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
