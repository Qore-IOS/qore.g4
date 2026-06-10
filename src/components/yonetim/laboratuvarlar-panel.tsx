'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Depot, Hospital, ProductCode, AddressDefinition, LabPool, DepoStokItem, EfficiencyPool } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, setDoc, deleteDoc, doc, writeBatch, Timestamp, query, orderBy, updateDoc, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { YonetimShell, YonetimHeader, YonetimCard } from '@/components/yonetim-ui/YonetimHub';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Edit3, Trash2, SlidersHorizontal, Map, Loader2, Warehouse, Network, Plus, X, FlaskConical, Users, Star, FileSpreadsheet, BarChart3, ListOrdered, Mail, Upload, Download, CheckCircle2, AlertCircle, Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { useHospitals, useProductCodes, useAddressDefinitions, useLabPools, useEfficiencyPools, useDepots } from '@/hooks/useFirebaseQueries';


const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full bg-muted rounded-md"><Loader2 className="h-6 w-6 animate-spin" /></div>,
});


export default function LaboratuvarPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();
  const { data: hospitals = [], isLoading: isLoadingHospitals, refetch: refetchHospitals } = useHospitals();
  const { data: productCodes = [], isLoading: isLoadingProducts, refetch: refetchProducts } = useProductCodes();
  const { data: addressDefinitions = [], isLoading: isLoadingAddress, refetch: refetchAddress } = useAddressDefinitions();
  const { data: depots = [], isLoading: isLoadingDepots, refetch: refetchDepots } = useDepots();
  const { data: labPools = [], isLoading: isLoadingLabPools, refetch: refetchLabPools } = useLabPools();
  const { data: efficiencyPools = [], isLoading: isLoadingEfficiencyPools, refetch: refetchEfficiencyPools } = useEfficiencyPools();

  const handleRefreshData = () => {
    refetchHospitals();
    refetchProducts();
    refetchAddress();
    refetchDepots();
    refetchLabPools();
    refetchEfficiencyPools();
  };

  // Kaydet/sil gibi mutasyonlar için yerel meşguliyet durumu (sorgu yüklenmesinden bağımsız).
  const [isMutating, setIsMutating] = useState(false);
  const isLoading = isLoadingHospitals || isLoadingProducts || isLoadingAddress || isLoadingDepots || isLoadingLabPools || isLoadingEfficiencyPools || isMutating;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentHospital, setCurrentHospital] = useState<Partial<Hospital>>({});
  const [responsibleEmailsInput, setResponsibleEmailsInput] = useState('');
  const [isMinMaxPanelOpen, setIsMinMaxPanelOpen] = useState(false);
  const [minMaxTarget, setMinMaxTarget] = useState<Hospital | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [sortField, setSortField] = useState<keyof Hospital | 'sorumluEmails'>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const [hospitalSubPoints, setHospitalSubPoints] = useState<{ id?: string; name: string; isActive?: boolean }[]>([]);
  const [newSubPointName, setNewSubPointName] = useState('');
  const [isSavingSubPoint, setIsSavingSubPoint] = useState(false);
  const [isEditingHospital, setIsEditingHospital] = useState(false);

  const [isPoolModalOpen, setIsPoolModalOpen] = useState(false);
  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [isPoolListModalOpen, setIsPoolListModalOpen] = useState(false);
  const [poolDetailsModal, setPoolDetailsModal] = useState<{ open: boolean; pool: LabPool | null }>({ open: false, pool: null });
  
  // Verimlilik Havuzu State
  const [isEfficiencyPoolModalOpen, setIsEfficiencyPoolModalOpen] = useState(false);
  const [isEfficiencyPoolListOpen, setIsEfficiencyPoolListOpen] = useState(false);
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
        ? value.split(/\r?\n/)
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




  const filteredHospitals = useMemo(() => {
    if (!searchQuery) return hospitals;
    const q = searchQuery.toLowerCase();
    return hospitals.filter(h => 
      h.name?.toLowerCase().includes(q) ||
      h.kod?.toLowerCase().includes(q) ||
      h.address?.toLowerCase().includes(q) ||
      h.sorumluEmails?.some(email => email.toLowerCase().includes(q))
    );
  }, [hospitals, searchQuery]);

  const sortedHospitals = useMemo(() => {
    return [...filteredHospitals].sort((a, b) => {
      let valA: any = a[sortField as keyof Hospital];
      let valB: any = b[sortField as keyof Hospital];

      if (sortField === 'sorumluEmails') {
        valA = a.sorumluEmails?.[0] || '';
        valB = b.sorumluEmails?.[0] || '';
      }

      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();

      let cmp = valA.localeCompare(valB, 'tr');
      return sortAsc ? cmp : -cmp;
    });
  }, [filteredHospitals, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(sortedHospitals.length / rowsPerPage));
  const paginatedHospitals = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return sortedHospitals.slice(start, start + rowsPerPage);
  }, [sortedHospitals, currentPage, rowsPerPage]);

  const onSortClick = (field: keyof Hospital | 'sorumluEmails') => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
    setCurrentPage(1);
  };

  const openModal = (hospital?: Hospital) => {
    if (hospital && hospital.id) {
        setCurrentHospital(hospital);
        setResponsibleEmailsInput(getResponsibleEmails(hospital).join('\n'));
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
        setCurrentHospital({ consumptionTrackingEnabled: true, isConsumablesHospital: false, manualDeductionEnabled: false, visualDeductionEnabled: false, fefoEnabled: true, perifer: false, kod: '' }); // Default FEFO to ON for new labs
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
    
    setIsMutating(true);
    try {
      const responsibleEmails = parseResponsibleEmails(responsibleEmailsInput);
      const dataToSave: Partial<Hospital> = {
        name: currentHospital.name.trim(),
        kod: (currentHospital.kod || '').trim().toUpperCase(),
        ceomedCariKodu: (currentHospital.ceomedCariKodu || '').trim().toUpperCase() || null,
        mahalKodu: (currentHospital.mahalKodu || '').trim().toUpperCase() || null,
        ekHizmetLabIds: currentHospital.ekHizmetLabIds || [],
        address: currentHospital.address || '',
        lat: currentHospital.lat || null,
        lng: currentHospital.lng || null,
        consumptionTrackingEnabled: currentHospital.consumptionTrackingEnabled ?? true,
        isConsumablesHospital: currentHospital.isConsumablesHospital ?? false,
        manualDeductionEnabled: currentHospital.manualDeductionEnabled ?? false,
        visualDeductionEnabled: (currentHospital.manualDeductionEnabled ?? false) ? (currentHospital.visualDeductionEnabled ?? false) : false,
        fefoEnabled: currentHospital.fefoEnabled ?? true,
        perifer: currentHospital.perifer ?? false,
        defaultDepotId: currentHospital.defaultDepotId || null,
        defaultDepotName: currentHospital.defaultDepotId ? (depots.find(d => d.id === currentHospital.defaultDepotId)?.name || null) : null,
        acilStatusu: (currentHospital as any).acilStatusu ?? false,
        calismaSaatleri: (currentHospital as any).acilStatusu ? null : ((currentHospital as any).calismaSaatleri || null),
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
      
      handleRefreshData();
      setIsModalOpen(false);
      setCurrentHospital({});
      setResponsibleEmailsInput('');
      setHospitalSubPoints([]);

    } catch (error) {
      toast({ title: 'Hata', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu laboratuvarı silmek istediğinizden emin misiniz?')) {
      await deleteDoc(doc(db, 'hospitals', id));
      toast({ title: 'Silindi', description: 'Laboratuvar silindi.', variant: 'destructive' });
      handleRefreshData();
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
    setIsMutating(true);
    try {
        await updateDoc(doc(db, 'labPools', pool.id), { mainLabId });
        setPoolDetailsModal({ open: true, pool: { ...pool, mainLabId }});
        handleRefreshData(); // Refresh list to show change immediately
        toast({ title: "Başarılı", description: "Ana laboratuvar güncellendi." });
    } catch (e) {
        toast({ title: 'Hata', description: 'Ana laboratuvar güncellenemedi.', variant: 'destructive' });
    } finally {
        setIsMutating(false);
    }
  };

  const handleDeleteEfficiencyPool = async (poolId: string) => {
    if (confirm('Bu verimlilik havuzunu silmek istediğinizden emin misiniz?')) {
      setIsMutating(true);
      try {
        await deleteDoc(doc(db, 'efficiencyPools', poolId));
        toast({ title: 'Silindi', description: 'Verimlilik havuzu silindi.' });
        setEfficiencyPoolDetailsModal({ open: false, pool: null });
        handleRefreshData();
      } catch (error) {
        toast({ title: 'Hata', description: 'Havuz silinemedi.', variant: 'destructive' });
      } finally {
        setIsMutating(false);
      }
    }
  };

  const handlePoolStockExport = async (pool: LabPool | null) => {
    if (!pool) return;
    
    // We shouldn't use a global state to track local loading for this button to avoid page freezing UI
    const loadingToast = toast({ title: 'Rapor Hazırlanıyor', description: 'Stok verileri çekiliyor...', duration: 5000 });
    
    try {
      const labNamesInPool = new Set(
        hospitals
          .filter(h => pool.memberIds.includes(h.id))
          .map(h => h.name)
      );

      // Sadece sevk edilmiş stoğu anlık çekiyoruz
      const stokSnap = await getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('isShipped', '==', true)));
      const allShippedStock = filterByCompanyScope(stokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)), currentCompanyId, isSuperAdmin);

      const stockInPool = allShippedStock.filter(
        item => item.hedefKurum && labNamesInPool.has(item.hedefKurum)
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
    } catch (e) {
      toast({ title: 'Hata', description: 'Stok raporu alınırken bir hata oluştu.', variant: 'destructive' });
    }
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
        // Hastane Sarf statüsündeki lablar mahal kodu, diğerleri Ceomed cari kodu kullanır.
        mahalKodu: (row['Mahal Kodu'] || row['mahalKodu'] || '').toString().trim().toUpperCase(),
        ceomedCariKodu: (row['Cari Kodu'] || row['Ceomed Cari Kodu'] || row['ceomedCariKodu'] || '').toString().trim().toUpperCase(),
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
          // Form ile aynı kural: Hastane Sarf statüsünde mahal kodu, diğerlerinde cari kodu geçerlidir.
          mahalKodu: (row.isConsumablesHospital ? row.mahalKodu : '') || null,
          ceomedCariKodu: (!row.isConsumablesHospital ? row.ceomedCariKodu : '') || null,
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
      handleRefreshData();
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Laboratuvar Adı': 'Örnek Laboratuvar 1',
        'Kod': 'OL1',
        'Adres': 'Örnek Mah. 123. Sk.',
        'E-posta': 'sorumlu1@lab.com\nsorumlu2@lab.com',
        'Tüketim Takibi': 'Evet',
        'FEFO': 'Evet',
        'Manuel Düşüm': 'Hayır',
        'Hastane Sarf': 'Hayır',
        'Otomatik Tutanak': 'Hayır',
        'Cari Kodu': 'M51001',
        'Mahal Kodu': '',
      },
      {
        'Laboratuvar Adı': 'Örnek Sarf Polikliniği',
        'Kod': 'OS1',
        'Adres': '',
        'E-posta': '',
        'Tüketim Takibi': 'Evet',
        'FEFO': 'Evet',
        'Manuel Düşüm': 'Hayır',
        'Hastane Sarf': 'Evet',
        'Otomatik Tutanak': 'Hayır',
        'Cari Kodu': '',
        'Mahal Kodu': '152.06.A.001',
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
    <YonetimShell>
      <YonetimHeader
        title="Laboratuvar Yönetimi"
        description="Yeni laboratuvarlar ekleyin veya mevcutları düzenleyin."
        backHref="/yonetim/tanimlar"
      />
      <YonetimCard>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              <FlaskConical className="inline-block mr-2 h-4 w-4 text-emerald-500" />
              Kayıtlar
            </div>
          </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button className="cihaz-action-tile text-xs" variant="outline" onClick={() => setIsEfficiencyPoolListOpen(true)} size="sm" disabled={isLoading}>
                <BarChart3 className="mr-2 h-4 w-4" />
                Verimlilik Havuzları
              </Button>
              <Button className="cihaz-action-tile text-xs" variant="secondary" onClick={() => setIsEfficiencyPoolModalOpen(true)} size="sm" disabled={isLoading}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Verimlilik Havuzu Oluştur
              </Button>
              <Button className="cihaz-action-tile text-xs" variant="secondary" onClick={() => setIsPoolListModalOpen(true)} size="sm" disabled={isLoading}>
                  Ortak Laboratuvarları Göster
              </Button>
              <Button className="cihaz-action-tile text-xs" onClick={() => setIsPoolModalOpen(true)} size="sm" disabled={isLoading}>
                Ortak Laboratuvar Oluştur
              </Button>
              <Button className="cihaz-action-tile text-xs" variant="outline" onClick={handleDownloadTemplate} size="sm" disabled={isLoading}>
                <Download className="mr-2 h-4 w-4" />
                Şablon İndir
              </Button>
              <Button className="cihaz-action-tile text-xs" variant="outline" onClick={() => excelFileInputRef.current?.click()} size="sm" disabled={isLoading}>
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
              <Button className="cihaz-action-tile text-xs" onClick={() => openModal()} size="sm" disabled={isLoading}>
                <PlusCircle className="mr-2 h-4 w-4 text-green-500" />
                Yeni Laboratuvar
              </Button>
            </div>
        </div>

        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 max-w-sm">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Laboratuvar Adı, Kodu veya Adresi ile ara..."
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                        className="pl-9"
                    />
                </div>
            </div>

            {isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
              <ScrollArea className="h-[400px] border rounded-md bg-white/50 dark:bg-black/20">
                <Table>
                  <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm z-10 shadow-sm">
                    <TableRow>
                        <TableHead onClick={() => onSortClick('name')} className="cursor-pointer hover:bg-muted/50 transition-colors">
                            <div className="flex items-center">
                                Adı
                                {sortField === 'name' && (sortAsc ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />)}
                            </div>
                        </TableHead>
                        <TableHead onClick={() => onSortClick('kod')} className="cursor-pointer hover:bg-muted/50 transition-colors">
                            <div className="flex items-center">
                                Kod
                                {sortField === 'kod' && (sortAsc ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />)}
                            </div>
                        </TableHead>
                        <TableHead onClick={() => onSortClick('address')} className="cursor-pointer hover:bg-muted/50 transition-colors">
                            <div className="flex items-center">
                                Adres
                                {sortField === 'address' && (sortAsc ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />)}
                            </div>
                        </TableHead>
                        <TableHead onClick={() => onSortClick('sorumluEmails')} className="cursor-pointer hover:bg-muted/50 transition-colors">
                            <div className="flex items-center">
                                E-posta
                                {sortField === 'sorumluEmails' && (sortAsc ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />)}
                            </div>
                        </TableHead>
                        <TableHead className="text-right">İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedHospitals.map(h => (
                      <TableRow key={h.id} className="hover:bg-muted/50 transition-colors group">
                        <TableCell className="font-medium">{h.name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{h.kod || '-'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]" title={h.address}>{h.address || '-'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]" title={(h.sorumluEmails || []).join(', ')}>
                            {h.sorumluEmails?.[0] || '-'}
                            {h.sorumluEmails && h.sorumluEmails.length > 1 && ` (+${h.sorumluEmails.length - 1})`}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => openMinMaxPanel(h)} title={h.isConsumablesHospital ? 'Otomatik Transfer Listesi' : 'Min-Max Ayarları'}><SlidersHorizontal className="h-4 w-4 text-primary" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { setProductOrderTarget(h); setIsProductOrderModalOpen(true); }} title="Özel Sıralama"><ListOrdered className="h-4 w-4 text-amber-500" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => openModal(h)} title="Düzenle"><Edit3 className="h-4 w-4 text-muted-foreground group-hover:text-foreground" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(h.id!)} title="Sil"><Trash2 className="h-4 w-4 text-destructive/70 group-hover:text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {paginatedHospitals.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                Laboratuvar bulunamadı.
                            </TableCell>
                        </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
              
              <div className="flex flex-col sm:flex-row items-center justify-between py-2 gap-4">
                  <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                    <span>Satır / sayfa:</span>
                    <Select value={String(rowsPerPage)} onValueChange={val => { setRowsPerPage(Number(val)); setCurrentPage(1); }}>
                        <SelectTrigger className="w-20 h-8">
                        <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                        {[10, 20, 50, 100].map(n => (
                            <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium text-muted-foreground min-w-[3rem] text-center">
                        {currentPage} / {pageCount}
                    </span>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0"
                        disabled={currentPage === pageCount || pageCount === 0}
                        onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
              </div>
              </>
            )}
        </div>
      </YonetimCard>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{currentHospital.id ? 'Laboratuvar Düzenle' : 'Yeni Laboratuvar'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-4">
              <Input placeholder="Laboratuvar Adı" value={currentHospital.name || ''} onChange={(e) => setCurrentHospital({ ...currentHospital, name: e.target.value })} />
              <Input placeholder="Laboratuvar Kodu (Max 3 Karakter)" value={currentHospital.kod || ''} onChange={(e) => setCurrentHospital({ ...currentHospital, kod: e.target.value.toUpperCase() })} maxLength={3} />
              {currentHospital.isConsumablesHospital ? (
                <Input placeholder="Mahal Kodu (örn. 152.06.A.001)" value={currentHospital.mahalKodu || ''} onChange={(e) => setCurrentHospital({ ...currentHospital, mahalKodu: e.target.value.trim().toUpperCase() })} />
              ) : (
                <Input placeholder="Ceomed Cari Kodu (örn. M51001)" value={currentHospital.ceomedCariKodu || ''} onChange={(e) => setCurrentHospital({ ...currentHospital, ceomedCariKodu: e.target.value.trim().toUpperCase() })} />
              )}
              <Input placeholder="Adres" value={currentHospital.address || ''} onChange={(e) => handleAddressInputChange(e.target.value)} />
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Textarea
                  rows={4}
                  placeholder={'Her satıra bir e-posta yazın\nornek1@lab.com\nornek2@lab.com'}
                  value={responsibleEmailsInput}
                  onChange={(e) => setResponsibleEmailsInput(e.target.value)}
                  className="pl-9 min-h-[96px]"
                />
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-sm font-medium">Ek Hizmet Laboratuvarları</Label>
                <p className="text-xs text-muted-foreground">
                  Bu ana laboratuvara bağlı alt/ek hizmet labları. Ceomed irsaliyelerinde ana laboratuvar üzerinden gelen ürünler buralara yönlendirilebilir.
                </p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {hospitals
                    .filter((h) => h.id !== currentHospital.id)
                    .map((h) => {
                      const checked = (currentHospital.ekHizmetLabIds || []).includes(h.id);
                      return (
                        <label key={h.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const cur = currentHospital.ekHizmetLabIds || [];
                              const next = e.target.checked ? [...cur, h.id] : cur.filter((id) => id !== h.id);
                              setCurrentHospital({ ...currentHospital, ekHizmetLabIds: next });
                            }}
                          />
                          <span className="font-mono text-xs text-muted-foreground">{h.kod || '—'}</span>
                          <span>{h.name}</span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="space-y-4">
                {/* Çalışma Saatleri + Acil Statüsü — kapasite/atıl maliyet hesabı için */}
                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="acil-status-switch"
                      checked={!!(currentHospital as any).acilStatusu}
                      onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, acilStatusu: checked })}
                    />
                    <Label htmlFor="acil-status-switch">
                      Acil Statüsü (7/24)
                      <p className="text-xs text-muted-foreground">
                        Aktifse lab 7/24 çalışır kabul edilir (720 saat/ay), çalışma saatleri yok sayılır.
                      </p>
                    </Label>
                  </div>
                  {!(currentHospital as any).acilStatusu && (
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                      <div>
                        <Label className="text-xs font-semibold uppercase tracking-wider">Haftaiçi (Pzt-Cum)</Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            type="time"
                            value={(currentHospital as any).calismaSaatleri?.haftaIciStart || '08:00'}
                            onChange={(e) => setCurrentHospital({
                              ...currentHospital,
                              calismaSaatleri: { ...(currentHospital as any).calismaSaatleri, haftaIciStart: e.target.value },
                            })}
                          />
                          <span className="text-xs text-muted-foreground">→</span>
                          <Input
                            type="time"
                            value={(currentHospital as any).calismaSaatleri?.haftaIciEnd || '17:00'}
                            onChange={(e) => setCurrentHospital({
                              ...currentHospital,
                              calismaSaatleri: { ...(currentHospital as any).calismaSaatleri, haftaIciEnd: e.target.value },
                            })}
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs font-semibold uppercase tracking-wider">Haftasonu (Cmt-Pzr)</Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            type="time"
                            value={(currentHospital as any).calismaSaatleri?.haftaSonuStart || ''}
                            onChange={(e) => setCurrentHospital({
                              ...currentHospital,
                              calismaSaatleri: { ...(currentHospital as any).calismaSaatleri, haftaSonuStart: e.target.value },
                            })}
                          />
                          <span className="text-xs text-muted-foreground">→</span>
                          <Input
                            type="time"
                            value={(currentHospital as any).calismaSaatleri?.haftaSonuEnd || ''}
                            onChange={(e) => setCurrentHospital({
                              ...currentHospital,
                              calismaSaatleri: { ...(currentHospital as any).calismaSaatleri, haftaSonuEnd: e.target.value },
                            })}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">Kapalıysa her ikisini de boş bırakın.</p>
                      </div>
                    </div>
                  )}
                </div>

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
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, manualDeductionEnabled: checked, visualDeductionEnabled: checked ? (currentHospital.visualDeductionEnabled ?? false) : false })}
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
                        id="visual-deduction-switch"
                        checked={currentHospital.visualDeductionEnabled ?? false}
                        disabled={!(currentHospital.manualDeductionEnabled ?? false)}
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, visualDeductionEnabled: checked })}
                    />
                    <Label htmlFor="visual-deduction-switch">
                        Görsel Düşüm
                        <p className="text-xs text-muted-foreground">
                            Manuel düşüm aktifken, ürün kullanım ekranında ana birim 3D modelleriyle büyük kartlar gösterilir.
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
                            Aktifse, bu laboratuvar sadece Sarf Dağıtım panelinde görünür; mahal kodu tanımlanır ve Min-Max paneli otomatik transfer listesine dönüşür.
                        </p>
                    </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Switch
                        id="perifer-switch"
                        checked={currentHospital.perifer ?? false}
                        onCheckedChange={(checked) => setCurrentHospital({ ...currentHospital, perifer: checked })}
                    />
                    <Label htmlFor="perifer-switch">
                        Perifer Laboratuvar
                        <p className="text-xs text-muted-foreground">
                            Aktifse, bu laboratuvardan açılan siparişler depo toplama yerine ofis lojistik panelinde (Siparişi Gör) yönetilir.
                        </p>
                    </Label>
                </div>

                {!(currentHospital.perifer) && (
                  <div className="rounded-md border p-3 space-y-2 bg-amber-50/30 dark:bg-amber-900/10">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Warehouse className="h-4 w-4 text-amber-500" />
                        Varsayılan Depo (Otomatik Yönlendirme)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {currentHospital.isConsumablesHospital
                          ? 'Hastane Sarf mahallerinde stok sorguları, transferler ve teslimatta stok düşümü atanan bu depodan yapılır.'
                          : 'Bu laboratuvar için bir depo atandığında, ürün talebi oluştururken depo seçme adımı atlanır ve talepler otomatik olarak bu depoya yönlendirilir.'}
                      </p>
                      <Select 
                        value={currentHospital.defaultDepotId || "none"} 
                        onValueChange={(val) => setCurrentHospital({ ...currentHospital, defaultDepotId: val === "none" ? undefined : val })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Depo Seçin (Opsiyonel)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Seçilmedi (Manuel Seçim)</SelectItem>
                          {depots.map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                  </div>
                )}
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
        onPoolCreated={handleRefreshData}
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
          onSaved={handleRefreshData}
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
                      <TableHead className="text-center">Hastane Sarf</TableHead>
                      <TableHead>Mahal/Cari Kodu</TableHead>
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
                          <TableCell className="text-center text-xs">{row.isConsumablesHospital ? 'Evet' : 'Hayır'}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.isConsumablesHospital ? (row.mahalKodu || '-') : (row.ceomedCariKodu || '-')}
                          </TableCell>
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
    </YonetimShell>
  );
}
