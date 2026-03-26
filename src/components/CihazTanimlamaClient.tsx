
'use client';
import React, { useState, useEffect } from 'react';
import {
  collection, getDocs, setDoc, doc, deleteDoc, addDoc, serverTimestamp, query, where, Timestamp
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Device, Hospital, MaintenancePlan, MaintenancePeriodUnit, MaintenanceType, ProductCode, PeriodicPartChange, PeriodicPartResponsibility } from '@/lib/types';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose
} from '@/components/ui/dialog';
import BackButton from '@/components/BackButton';
import { resolveImageSrc } from '@/lib/image-utils';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ScrollArea } from './ui/scroll-area';
import { Calendar, Plus, Trash2, Wrench, FlaskConical, Loader2, Package, ChevronsUpDown, Check as CheckIcon, FileDown, ClipboardList, Building2, Search, Settings, Server } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, exportDevicesToPdf } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import DeviceLabPoolModal from '@/components/DeviceLabPoolModal';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';

// Periyot birimi etiketleri
const PERIOD_UNIT_LABELS: Record<MaintenancePeriodUnit, string> = {
  hafta: 'Hafta',
  ay: 'Ay',
  yil: 'Yıl',
};

// Yeni bakım planı satırı tipi
type NewPlanRow = {
  id: string;
  taskName: string;
  periodValue: number;
  periodUnit: MaintenancePeriodUnit;
};

// Yeni periyodik parça değişimi satırı tipi
type NewPeriodicPartRow = {
  id: string;
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  nextDueDate: string; // YYYY-MM-DD format
  periodDays: string; // Gün bazlı periyot (string input)
  responsibilityType: PeriodicPartResponsibility;
  requiresOutgoingPartInfo: boolean;
  requiresSerialTracking: boolean;
  isPopoverOpen: boolean;
  searchText: string;
};

// Toplu bakım planı - yedek parça satırı tipi
type BulkPeriodicPartRow = {
  id: string;
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  nextDueDate: string; // YYYY-MM-DD format
  periodDays: string; // Gün bazlı periyot (string input)
  responsibilityType: PeriodicPartResponsibility;
  requiresOutgoingPartInfo: boolean;
  requiresSerialTracking: boolean;
  isPopoverOpen: boolean;
  searchText: string;
};

interface Props {
  images: string[];
  hospitals: Hospital[];
}

export default function CihazTanimlamaClient({ images, hospitals }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [current, setCurrent] = useState<Partial<Device>>({});
  const [customPath, setCustomPath] = useState('');
  const { toast } = useToast();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const router = useRouter();

  // Cihaz Laboratuvar Gruplandırma State
  const [deviceLabPoolModalOpen, setDeviceLabPoolModalOpen] = useState(false);

  // Periyodik Bakım Planı State'leri
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
  const [maintenanceDevice, setMaintenanceDevice] = useState<Device | null>(null);
  const [existingPlans, setExistingPlans] = useState<MaintenancePlan[]>([]);
  const [maintenanceTab, setMaintenanceTab] = useState<MaintenanceType>('teknik_servis');
  const [newTeknikRows, setNewTeknikRows] = useState<NewPlanRow[]>([]);
  const [newAplikasyonRows, setNewAplikasyonRows] = useState<NewPlanRow[]>([]);
  const [isSavingPlans, setIsSavingPlans] = useState(false);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);

  // Periyodik Parça Değişimi State'leri
  const [existingPeriodicParts, setExistingPeriodicParts] = useState<PeriodicPartChange[]>([]);
  const [newPeriodicPartRows, setNewPeriodicPartRows] = useState<NewPeriodicPartRow[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [showPeriodicPartSection, setShowPeriodicPartSection] = useState(false);
  const [exportPdfLoading, setExportPdfLoading] = useState(false);

  // Toplu Bakım Planı State'leri
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkMaintenanceTab, setBulkMaintenanceTab] = useState<MaintenanceType>('teknik_servis');
  const [bulkTeknikRows, setBulkTeknikRows] = useState<NewPlanRow[]>([]);
  const [bulkAplikasyonRows, setBulkAplikasyonRows] = useState<NewPlanRow[]>([]);
  const [bulkPeriodicPartRows, setBulkPeriodicPartRows] = useState<BulkPeriodicPartRow[]>([]);
  const [bulkShowPeriodicParts, setBulkShowPeriodicParts] = useState(false);
  const [isSavingBulk, setIsSavingBulk] = useState(false);

  // Laboratuvar ve cihaz seçimi state'leri
  const [labSelectionModalOpen, setLabSelectionModalOpen] = useState(false);
  const [selectedLabIds, setSelectedLabIds] = useState<string[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [labsWithDevices, setLabsWithDevices] = useState<Hospital[]>([]);
  const [selectionMode, setSelectionMode] = useState<'lab' | 'device'>('lab');
  const [deviceSearchQuery, setDeviceSearchQuery] = useState('');

  const fetchDevices = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'devices'));
    setDevices(filterByCompanyScope(
      snap.docs.map(d => ({ id: d.id, ...d.data() } as Device)),
      currentCompanyId,
      isSuperAdmin
    ));
    setLoading(false);
  };
  useEffect(() => { fetchDevices(); }, [currentCompanyId, isSuperAdmin]);

  // Yedek parça ürünlerini getir
  useEffect(() => {
    const fetchProductCodes = async () => {
      try {
        // Fetch all products and filter for yedek_parca client-side
        const snap = await getDocs(collection(db, 'productCodes'));
        const allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode);
        // Filter for yedek_parca products - only show products that are explicitly marked as spare parts
        const spareParts = allProducts.filter(p => p.urunGrubu === 'yedek_parca');
        // Always use spare parts only, don't fall back to all products
        setProductCodes(spareParts);
        console.log(`Loaded ${spareParts.length} spare parts from ${allProducts.length} total products`);
      } catch (err) {
        console.error('Error fetching product codes:', err);
      }
    };
    fetchProductCodes();
  }, []);

  const save = async () => {
    const imageUrl = current.imageUrl || customPath.trim();
    if (!current.brand || !current.model || !imageUrl || !current.seriNumarasi || !current.hospitalId || !current.order) {
      toast({
        title: 'Eksik bilgi',
        description: 'Marka, model, seri numarası, laboratuvar, dizilim sırası ve resim seçilmeli veya yol girilmeli.',
        variant: 'destructive'
      });
      return;
    }
    const id = current.id
      ?? `${current.brand}-${current.model}-${current.seriNumarasi}`.toLowerCase().replace(/\s+/g, '-');
      
    await setDoc(doc(db, 'devices', id), withCompanyScope({ 
      brand: current.brand,
      model: current.model,
      imageUrl,
      cihazAdi: current.cihazAdi,
      seriNumarasi: current.seriNumarasi,
      hospitalId: current.hospitalId,
      order: current.order
    }, currentUserProfile?.companyId), { merge: true });

    toast({ title: 'Kaydedildi', description: 'Cihaz tanımı kaydedildi.' });
    setModalOpen(false);
    fetchDevices();
  };

  const remove = async (id: string) => {
    if (confirm('Bu tanımı silmek istediğinize emin misiniz?')) {
      await deleteDoc(doc(db, 'devices', id));
      toast({ title: 'Silindi', description: 'Cihaz tanımı silindi.', variant: 'destructive' });
      fetchDevices();
    }
  };

  // Periyodik Bakım Planı Fonksiyonları
  const openMaintenanceModal = async (device: Device) => {
    setMaintenanceDevice(device);
    setMaintenanceTab('teknik_servis');
    setNewTeknikRows([]);
    setNewAplikasyonRows([]);
    setNewPeriodicPartRows([]);
    setShowPeriodicPartSection(false);
    setIsLoadingPlans(true);
    setMaintenanceModalOpen(true);

    try {
      // Bakım planlarını getir
      const plansQuery = query(
        collection(db, 'maintenancePlans'),
        where('deviceId', '==', device.id)
      );
      const plansSnap = await getDocs(plansQuery);
      const plans = filterByCompanyScope(
        plansSnap.docs.map(d => ({ id: d.id, ...d.data() }) as MaintenancePlan),
        currentCompanyId,
        isSuperAdmin
      );
      setExistingPlans(plans);

      // Periyodik parça değişimlerini getir
      const partsQuery = query(
        collection(db, 'periodicPartChanges'),
        where('deviceId', '==', device.id)
      );
      const partsSnap = await getDocs(partsQuery);
      const parts = filterByCompanyScope(
        partsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PeriodicPartChange),
        currentCompanyId,
        isSuperAdmin
      );
      setExistingPeriodicParts(parts);
    } catch (err) {
      console.error('Bakım planları yüklenemedi:', err);
      toast({ title: 'Hata', description: 'Bakım planları yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoadingPlans(false);
    }
  };

  const addNewRow = (type: MaintenanceType) => {
    const newRow: NewPlanRow = {
      id: crypto.randomUUID(),
      taskName: '',
      periodValue: 1,
      periodUnit: 'ay',
    };

    if (type === 'teknik_servis') {
      setNewTeknikRows(prev => [...prev, newRow]);
    } else {
      setNewAplikasyonRows(prev => [...prev, newRow]);
    }
  };

  const updateNewRow = (type: MaintenanceType, id: string, field: keyof NewPlanRow, value: any) => {
    const setter = type === 'teknik_servis' ? setNewTeknikRows : setNewAplikasyonRows;
    setter(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const removeNewRow = (type: MaintenanceType, id: string) => {
    const setter = type === 'teknik_servis' ? setNewTeknikRows : setNewAplikasyonRows;
    setter(prev => prev.filter(row => row.id !== id));
  };

  const removeExistingPlan = async (planId: string) => {
    if (!confirm('Bu bakım planını silmek istediğinize emin misiniz?')) return;

    try {
      await deleteDoc(doc(db, 'maintenancePlans', planId));
      setExistingPlans(prev => prev.filter(p => p.id !== planId));
      toast({ title: 'Silindi', description: 'Bakım planı silindi.' });
    } catch (err) {
      console.error('Bakım planı silinemedi:', err);
      toast({ title: 'Hata', description: 'Bakım planı silinemedi.', variant: 'destructive' });
    }
  };

  // Periyodik Parça Değişimi Fonksiyonları
  const addNewPeriodicPartRow = () => {
    const newRow: NewPeriodicPartRow = {
      id: crypto.randomUUID(),
      productCodeId: '',
      stokKodu: '',
      stokAdi: '',
      nextDueDate: '',
      periodDays: '',
      responsibilityType: 'teknik_servis',
      requiresOutgoingPartInfo: false,
      requiresSerialTracking: true,
      isPopoverOpen: false,
      searchText: '',
    };
    setNewPeriodicPartRows(prev => [...prev, newRow]);
  };

  const updatePeriodicPartRow = (id: string, field: keyof NewPeriodicPartRow, value: any) => {
    setNewPeriodicPartRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const selectProductForRow = (rowId: string, product: ProductCode) => {
    setNewPeriodicPartRows(prev => prev.map(row =>
      row.id === rowId
        ? { ...row, productCodeId: product.id, stokKodu: product.stokKodu, stokAdi: product.stokAdi, isPopoverOpen: false, searchText: '' }
        : row
    ));
  };

  const removePeriodicPartRow = (id: string) => {
    setNewPeriodicPartRows(prev => prev.filter(row => row.id !== id));
  };

  const removeExistingPeriodicPart = async (partId: string) => {
    if (!confirm('Bu periyodik parça değişimini silmek istediğinize emin misiniz?')) return;

    try {
      await deleteDoc(doc(db, 'periodicPartChanges', partId));
      setExistingPeriodicParts(prev => prev.filter(p => p.id !== partId));
      toast({ title: 'Silindi', description: 'Periyodik parça değişimi silindi.' });
    } catch (err) {
      console.error('Periyodik parça değişimi silinemedi:', err);
      toast({ title: 'Hata', description: 'Periyodik parça değişimi silinemedi.', variant: 'destructive' });
    }
  };

  // Sorumluluk tipi etiketleri
  const RESPONSIBILITY_LABELS: Record<PeriodicPartResponsibility, string> = {
    teknik_servis: 'Teknik Servis',
    aplikasyon: 'Aplikasyon',
    both: 'Her İkisi',
  };

  // Toplu Bakım Planı Fonksiyonları
  const openBulkModal = () => {
    setBulkMaintenanceTab('teknik_servis');
    setBulkTeknikRows([]);
    setBulkAplikasyonRows([]);
    setBulkPeriodicPartRows([]);
    setBulkShowPeriodicParts(false);
    setBulkModalOpen(true);
  };

  const addBulkRow = (type: MaintenanceType) => {
    const newRow: NewPlanRow = {
      id: crypto.randomUUID(),
      taskName: '',
      periodValue: 1,
      periodUnit: 'ay',
    };
    if (type === 'teknik_servis') {
      setBulkTeknikRows(prev => [...prev, newRow]);
    } else {
      setBulkAplikasyonRows(prev => [...prev, newRow]);
    }
  };

  const updateBulkRow = (type: MaintenanceType, id: string, field: keyof NewPlanRow, value: any) => {
    const setter = type === 'teknik_servis' ? setBulkTeknikRows : setBulkAplikasyonRows;
    setter(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const removeBulkRow = (type: MaintenanceType, id: string) => {
    const setter = type === 'teknik_servis' ? setBulkTeknikRows : setBulkAplikasyonRows;
    setter(prev => prev.filter(row => row.id !== id));
  };

  const addBulkPeriodicPartRow = () => {
    const newRow: BulkPeriodicPartRow = {
      id: crypto.randomUUID(),
      productCodeId: '',
      stokKodu: '',
      stokAdi: '',
      nextDueDate: '',
      periodDays: '',
      responsibilityType: 'teknik_servis',
      requiresOutgoingPartInfo: false,
      requiresSerialTracking: true,
      isPopoverOpen: false,
      searchText: '',
    };
    setBulkPeriodicPartRows(prev => [...prev, newRow]);
  };

  const updateBulkPeriodicPartRow = (id: string, field: keyof BulkPeriodicPartRow, value: any) => {
    setBulkPeriodicPartRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  };

  const selectBulkProductForRow = (rowId: string, product: ProductCode) => {
    setBulkPeriodicPartRows(prev => prev.map(row =>
      row.id === rowId
        ? { ...row, productCodeId: product.id, stokKodu: product.stokKodu, stokAdi: product.stokAdi, isPopoverOpen: false, searchText: '' }
        : row
    ));
  };

  const removeBulkPeriodicPartRow = (id: string) => {
    setBulkPeriodicPartRows(prev => prev.filter(row => row.id !== id));
  };

  // Toplu bakım planı kaydetme - 1. adım: doğrulama ve lab seçimine geç
  const handleBulkSaveClick = () => {
    const allBulkRows = [
      ...bulkTeknikRows.map(r => ({ ...r, type: 'teknik_servis' as MaintenanceType })),
      ...bulkAplikasyonRows.map(r => ({ ...r, type: 'aplikasyon' as MaintenanceType })),
    ];

    const invalidRow = allBulkRows.find(r => !r.taskName.trim());
    if (invalidRow) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm iş adlarını doldurun.', variant: 'destructive' });
      return;
    }

    const invalidPartRow = bulkPeriodicPartRows.find(r => !r.productCodeId || !r.nextDueDate || !r.periodDays || Number(r.periodDays) <= 0);
    if (invalidPartRow) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm periyodik parça değişimlerinde ürün, tarih ve geçerli gün periyodu girin.', variant: 'destructive' });
      return;
    }

    if (allBulkRows.length === 0 && bulkPeriodicPartRows.length === 0) {
      toast({ title: 'Boş Plan', description: 'Lütfen en az bir iş veya yedek parça ekleyin.', variant: 'destructive' });
      return;
    }

    // Cihazı olan laboratuvarları bul
    const labIdsWithDevices = new Set(devices.map(d => d.hospitalId).filter(Boolean));
    const filteredLabs = hospitals.filter(h => labIdsWithDevices.has(h.id));
    setLabsWithDevices(filteredLabs);
    setSelectedLabIds([]);
    setSelectedDeviceIds([]);
    setSelectionMode('lab');
    setDeviceSearchQuery('');
    setLabSelectionModalOpen(true);
  };

  // Toplu bakım planı kaydetme - 2. adım: seçilen laboratuvar veya cihazlara kaydet
  const saveBulkMaintenancePlans = async () => {
    if (selectionMode === 'lab' && selectedLabIds.length === 0) {
      toast({ title: 'Laboratuvar Seçin', description: 'Lütfen en az bir laboratuvar seçin.', variant: 'destructive' });
      return;
    }
    if (selectionMode === 'device' && selectedDeviceIds.length === 0) {
      toast({ title: 'Cihaz Seçin', description: 'Lütfen en az bir cihaz seçin.', variant: 'destructive' });
      return;
    }

    setIsSavingBulk(true);

    try {
      // Seçilen laboratuvarlardaki veya doğrudan seçilen cihazları bul
      const targetDevices = selectionMode === 'lab'
        ? devices.filter(d => selectedLabIds.includes(d.hospitalId || ''))
        : devices.filter(d => selectedDeviceIds.includes(d.id));

      if (targetDevices.length === 0) {
        toast({ title: 'Cihaz Bulunamadı', description: 'Seçilen laboratuvarlarda cihaz bulunamadı.', variant: 'destructive' });
        setIsSavingBulk(false);
        return;
      }

      const allBulkRows = [
        ...bulkTeknikRows.map(r => ({ ...r, type: 'teknik_servis' as MaintenanceType })),
        ...bulkAplikasyonRows.map(r => ({ ...r, type: 'aplikasyon' as MaintenanceType })),
      ];

      let totalSaved = 0;

      for (const device of targetDevices) {
        // Bakım planlarını kaydet
        for (const row of allBulkRows) {
          await addDoc(collection(db, 'maintenancePlans'), withCompanyScope({
            deviceId: device.id,
            taskName: row.taskName.trim(),
            periodValue: row.periodValue,
            periodUnit: row.periodUnit,
            type: row.type,
            createdAt: serverTimestamp(),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          }, currentUserProfile?.companyId));
          totalSaved++;
        }

        // Periyodik parça değişimlerini kaydet
        for (const row of bulkPeriodicPartRows) {
          await addDoc(collection(db, 'periodicPartChanges'), withCompanyScope({
            deviceId: device.id,
            productCodeId: row.productCodeId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            periodValue: 1,
            periodUnit: 'ay',
            periodDays: Number(row.periodDays),
            nextDueDate: row.nextDueDate ? Timestamp.fromDate(new Date(row.nextDueDate + 'T00:00:00')) : null,
            responsibilityType: row.responsibilityType,
            requiresOutgoingPartInfo: row.requiresOutgoingPartInfo,
            requiresSerialTracking: row.requiresSerialTracking,
            createdAt: serverTimestamp(),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          }, currentUserProfile?.companyId));
          totalSaved++;
        }
      }

      toast({
        title: 'Başarılı',
        description: `${targetDevices.length} cihaza toplam ${totalSaved} kayıt eklendi.`,
      });
      setLabSelectionModalOpen(false);
      setBulkModalOpen(false);
    } catch (err) {
      console.error('Toplu bakım planı kaydedilemedi:', err);
      toast({ title: 'Hata', description: 'Toplu bakım planı kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSavingBulk(false);
    }
  };

  const toggleLabSelection = (labId: string) => {
    setSelectedLabIds(prev =>
      prev.includes(labId) ? prev.filter(id => id !== labId) : [...prev, labId]
    );
  };

  const toggleAllLabs = () => {
    if (selectedLabIds.length === labsWithDevices.length) {
      setSelectedLabIds([]);
    } else {
      setSelectedLabIds(labsWithDevices.map(l => l.id));
    }
  };

  const toggleDeviceSelection = (deviceId: string) => {
    setSelectedDeviceIds(prev =>
      prev.includes(deviceId) ? prev.filter(id => id !== deviceId) : [...prev, deviceId]
    );
  };

  const toggleAllDevices = () => {
    const filteredDevices = deviceSearchQuery.trim()
      ? devices.filter(d => {
          const q = deviceSearchQuery.toLowerCase();
          const hospitalName = hospitals.find(h => h.id === d.hospitalId)?.name || '';
          return (d.cihazAdi || d.model || '').toLowerCase().includes(q) ||
            (d.brand || '').toLowerCase().includes(q) ||
            (d.seriNumarasi || '').toLowerCase().includes(q) ||
            hospitalName.toLowerCase().includes(q);
        })
      : devices;
    if (selectedDeviceIds.length === filteredDevices.length) {
      setSelectedDeviceIds([]);
    } else {
      setSelectedDeviceIds(filteredDevices.map(d => d.id));
    }
  };

  const saveMaintenancePlans = async () => {
    if (!maintenanceDevice) return;

    // Validate new maintenance plan rows
    const allNewRows = [
      ...newTeknikRows.map(r => ({ ...r, type: 'teknik_servis' as MaintenanceType })),
      ...newAplikasyonRows.map(r => ({ ...r, type: 'aplikasyon' as MaintenanceType })),
    ];

    const invalidRow = allNewRows.find(r => !r.taskName.trim());
    if (invalidRow) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm iş adlarını doldurun.', variant: 'destructive' });
      return;
    }

    // Validate periodic part change rows
    const invalidPartRow = newPeriodicPartRows.find(r => !r.productCodeId || !r.nextDueDate || !r.periodDays || Number(r.periodDays) <= 0);
    if (invalidPartRow) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm periyodik parça değişimlerinde ürün, tarih ve geçerli gün periyodu girin.', variant: 'destructive' });
      return;
    }

    if (allNewRows.length === 0 && newPeriodicPartRows.length === 0) {
      setMaintenanceModalOpen(false);
      return;
    }

    setIsSavingPlans(true);

    try {
      // Bakım planlarını kaydet
      for (const row of allNewRows) {
        await addDoc(collection(db, 'maintenancePlans'), withCompanyScope({
          deviceId: maintenanceDevice.id,
          taskName: row.taskName.trim(),
          periodValue: row.periodValue,
          periodUnit: row.periodUnit,
          type: row.type,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentUserProfile?.companyId));
      }

      // Periyodik parça değişimlerini kaydet
      for (const row of newPeriodicPartRows) {
        await addDoc(collection(db, 'periodicPartChanges'), withCompanyScope({
          deviceId: maintenanceDevice.id,
          productCodeId: row.productCodeId,
          stokKodu: row.stokKodu,
          stokAdi: row.stokAdi,
          periodValue: 1,
          periodUnit: 'ay',
          periodDays: Number(row.periodDays),
          nextDueDate: row.nextDueDate ? Timestamp.fromDate(new Date(row.nextDueDate + 'T00:00:00')) : null,
          responsibilityType: row.responsibilityType,
          requiresOutgoingPartInfo: row.requiresOutgoingPartInfo,
          requiresSerialTracking: row.requiresSerialTracking,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        }, currentUserProfile?.companyId));
      }

      const totalSaved = allNewRows.length + newPeriodicPartRows.length;
      toast({ title: 'Başarılı', description: `${totalSaved} kayıt eklendi.` });
      setMaintenanceModalOpen(false);
    } catch (err) {
      console.error('Bakım planları kaydedilemedi:', err);
      toast({ title: 'Hata', description: 'Bakım planları kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSavingPlans(false);
    }
  };

  // Filtrelenmiş planlar
  const teknikPlans = existingPlans.filter(p => p.type === 'teknik_servis');
  const aplikasyonPlans = existingPlans.filter(p => p.type === 'aplikasyon');

  const handleExportDevicesPdf = async () => {
    if (devices.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak cihaz verisi yok.', variant: 'default' });
      return;
    }
    setExportPdfLoading(true);
    try {
      // Fetch all maintenance plans and periodic parts for all devices
      const [allPlansSnap, allPartsSnap] = await Promise.all([
        getDocs(collection(db, 'maintenancePlans')),
        getDocs(collection(db, 'periodicPartChanges')),
      ]);
      const allPlans = filterByCompanyScope(
        allPlansSnap.docs.map(d => ({ id: d.id, ...d.data() }) as MaintenancePlan),
        currentCompanyId,
        isSuperAdmin
      );
      const allParts = filterByCompanyScope(
        allPartsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PeriodicPartChange),
        currentCompanyId,
        isSuperAdmin
      );

      const devicesData = devices.map(dev => {
        const hospitalName = hospitals.find(h => h.id === dev.hospitalId)?.name || '';
        const devicePlans = allPlans.filter(p => p.deviceId === dev.id);
        const deviceParts = allParts.filter(p => p.deviceId === dev.id);

        return {
          name: `${dev.brand} ${dev.model}${dev.cihazAdi ? ` - ${dev.cihazAdi}` : ''}`,
          info: [
            { label: 'Marka', value: dev.brand || '' },
            { label: 'Model', value: dev.model || '' },
            { label: 'Cihaz Adı', value: dev.cihazAdi || '' },
            { label: 'Seri Numarası', value: dev.seriNumarasi || '' },
            { label: 'Laboratuvar', value: hospitalName },
            { label: 'Dizilim Sırası', value: String(dev.order || '') },
          ],
          maintenancePlans: devicePlans.map(p => ({
            taskName: p.taskName,
            period: `${p.periodValue} ${PERIOD_UNIT_LABELS[p.periodUnit]}`,
            type: p.type === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon',
          })),
          periodicParts: deviceParts.map(p => ({
            partName: p.stokAdi,
            partCode: p.stokKodu,
            period: p.periodDays ? `${p.periodDays} gün` : (p.nextDueDate?.toDate ? new Date(p.nextDueDate.toDate()).toLocaleDateString('tr-TR') : `${p.periodValue} ${PERIOD_UNIT_LABELS[p.periodUnit]}`),
            responsibility: RESPONSIBILITY_LABELS[p.responsibilityType],
          })),
        };
      });

      await exportDevicesToPdf(devicesData, 'Cihaz_Tanimlamalari', 'Cihaz Tanımlamaları Raporu', toast);
    } catch (err) {
      console.error('PDF export error:', err);
      toast({ title: 'Hata', description: 'PDF oluşturulurken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setExportPdfLoading(false);
    }
  };

  const effectiveImageUrl = current.imageUrl || customPath;

  return (
    <div className="p-8 space-y-6">
      <BackButton fallback="/cihaz-yonetimi-ana"/>
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-headline">Cihaz Tanımlamaları</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setDeviceLabPoolModalOpen(true)}
          >
            <Server className="h-4 w-4 mr-2" />
            Gruplandırma
          </Button>
          <Button
            variant="secondary"
            onClick={() => router.push('/cihaz-tanimlamalari/periyodik-bakim-yonetimi')}
          >
            <Settings className="h-4 w-4 mr-2" />
            Periyodik Bakım Yönetimi
          </Button>
          <Button
            variant="secondary"
            onClick={openBulkModal}
          >
            <ClipboardList className="h-4 w-4 mr-2" />
            Toplu Bakım Planı Ata
          </Button>
          <Button
            variant="secondary"
            onClick={handleExportDevicesPdf}
            disabled={exportPdfLoading || devices.length === 0}
          >
            {exportPdfLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            PDF Döküm
          </Button>
          <Button onClick={() => { setCurrent({}); setCustomPath(''); setModalOpen(true); }}>
            + Yeni Cihaz
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[70vh]">
        <Table>
          <TableHeader>
          <TableRow>
            <TableHead>Marka</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Cihaz Adı</TableHead>
            <TableHead>Seri Numarası</TableHead>
            <TableHead>Laboratuvar</TableHead>
            <TableHead>Sıra</TableHead>
            <TableHead>Resim</TableHead>
            <TableHead>İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && devices.map(dev => (
              <TableRow key={dev.id}>
                <TableCell>{dev.brand}</TableCell>
                <TableCell>{dev.model}</TableCell>
                <TableCell>{dev.cihazAdi}</TableCell>
                <TableCell>{dev.seriNumarasi}</TableCell>
                <TableCell>{hospitals.find(h => h.id === dev.hospitalId)?.name}</TableCell>
                <TableCell>{dev.order}</TableCell>
                <TableCell>
                  {dev.imageUrl ? (
                  <Image
                    src={resolveImageSrc(dev.imageUrl)}
                    alt={`${dev.brand} ${dev.model}`}
                    width={100}
                    height={100}
                    className="w-24 h-24 object-cover rounded-md"
                  />
                  ) : "Resim Yok"}
                </TableCell>
                <TableCell className="space-x-2">
                  <Button size="sm" variant="outline" onClick={() => openMaintenanceModal(dev)}>
                    <Calendar className="h-4 w-4 mr-1" /> Bakım Planı
                  </Button>
                  <Button size="sm" onClick={() => {
                    setCurrent(dev);
                    setCustomPath('');
                    setModalOpen(true);
                  }}>Düzenle</Button>
                  <Button variant="destructive" size="sm" onClick={() => remove(dev.id)}>
                    Sil
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{current.id ? 'Cihaz Düzenle' : 'Yeni Cihaz'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Marka"
              value={current.brand || ''}
              onChange={e => setCurrent({ ...current, brand: e.target.value })}
            />
            <Input
              placeholder="Model"
              value={current.model || ''}
              onChange={e => setCurrent({ ...current, model: e.target.value })}
            />
            <Input
              placeholder="Cihaz Adı"
              value={current.cihazAdi || ''}
              onChange={e => setCurrent({ ...current, cihazAdi: e.target.value })}
            />
             <Input
              placeholder="Seri Numarası"
              value={current.seriNumarasi || ''}
              onChange={e => setCurrent({ ...current, seriNumarasi: e.target.value })}
            />
            <Select
              value={current.imageUrl || ''}
              onValueChange={val => {
                setCurrent({ ...current, imageUrl: val });
                setCustomPath('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Mevcut Resimlerden Seçin" />
              </SelectTrigger>
              <SelectContent>
                {images.map(img => (
                  <SelectItem key={img} value={img}>{img}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Veya özel resim yolu girin (örn: devices/xyz.png)"
              value={customPath}
              onChange={e => {
                setCustomPath(e.target.value);
                setCurrent({ ...current, imageUrl: undefined });
              }}
            />
            {effectiveImageUrl && (
              <div className="flex justify-center">
                 <Image
                    src={resolveImageSrc(effectiveImageUrl)}
                    alt="Preview"
                    width={200}
                    height={200}
                    className="w-48 h-48 object-cover rounded-lg"
                  />
              </div>
            )}
             <Select
              value={current.hospitalId || ''}
              onValueChange={val => setCurrent({ ...current, hospitalId: val })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Laboratuvar Seçin" />
              </SelectTrigger>
              <SelectContent>
                {hospitals.map(h => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(current.order || '')}
              onValueChange={val => setCurrent({ ...current, order: Number(val) })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Dizilim Sırası Seçin" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(i => (
                  <SelectItem key={i} value={String(i)}>{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="space-x-2">
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={save}>{current.id ? 'Güncelle' : 'Oluştur'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Periyodik Bakım Planı Modal */}
      <Dialog open={maintenanceModalOpen} onOpenChange={setMaintenanceModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Periyodik Bakım Planı: {maintenanceDevice?.cihazAdi || maintenanceDevice?.model}
            </DialogTitle>
          </DialogHeader>

          {isLoadingPlans ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Tabs value={maintenanceTab} onValueChange={(v) => setMaintenanceTab(v as MaintenanceType)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="teknik_servis" className="flex items-center gap-2">
                  <Wrench className="h-4 w-4" /> Teknik Servis ({teknikPlans.length + newTeknikRows.length})
                </TabsTrigger>
                <TabsTrigger value="aplikasyon" className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4" /> Aplikasyon ({aplikasyonPlans.length + newAplikasyonRows.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="teknik_servis" className="space-y-4 mt-4">
                <ScrollArea className="h-64 border rounded-md p-3">
                  {/* Mevcut planlar */}
                  {teknikPlans.map(plan => (
                    <div key={plan.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md mb-2">
                      <div>
                        <p className="font-medium">{plan.taskName}</p>
                        <p className="text-xs text-muted-foreground">
                          {plan.periodValue} {PERIOD_UNIT_LABELS[plan.periodUnit]}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeExistingPlan(plan.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  {/* Yeni satırlar */}
                  {newTeknikRows.map(row => (
                    <div key={row.id} className="flex items-center gap-2 p-2 border border-dashed rounded-md mb-2">
                      <Input
                        placeholder="İş adı..."
                        value={row.taskName}
                        onChange={(e) => updateNewRow('teknik_servis', row.id, 'taskName', e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        min="1"
                        value={row.periodValue}
                        onChange={(e) => updateNewRow('teknik_servis', row.id, 'periodValue', Number(e.target.value))}
                        className="w-20"
                      />
                      <Select
                        value={row.periodUnit}
                        onValueChange={(v) => updateNewRow('teknik_servis', row.id, 'periodUnit', v)}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hafta">Hafta</SelectItem>
                          <SelectItem value="ay">Ay</SelectItem>
                          <SelectItem value="yil">Yıl</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => removeNewRow('teknik_servis', row.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  {teknikPlans.length === 0 && newTeknikRows.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">
                      Henüz teknik servis bakım planı tanımlanmamış.
                    </p>
                  )}
                </ScrollArea>

                <Button variant="outline" className="w-full" onClick={() => addNewRow('teknik_servis')}>
                  <Plus className="h-4 w-4 mr-2" /> Yeni İş Ekle
                </Button>
              </TabsContent>

              <TabsContent value="aplikasyon" className="space-y-4 mt-4">
                <ScrollArea className="h-64 border rounded-md p-3">
                  {/* Mevcut planlar */}
                  {aplikasyonPlans.map(plan => (
                    <div key={plan.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md mb-2">
                      <div>
                        <p className="font-medium">{plan.taskName}</p>
                        <p className="text-xs text-muted-foreground">
                          {plan.periodValue} {PERIOD_UNIT_LABELS[plan.periodUnit]}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeExistingPlan(plan.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  {/* Yeni satırlar */}
                  {newAplikasyonRows.map(row => (
                    <div key={row.id} className="flex items-center gap-2 p-2 border border-dashed rounded-md mb-2">
                      <Input
                        placeholder="İş adı..."
                        value={row.taskName}
                        onChange={(e) => updateNewRow('aplikasyon', row.id, 'taskName', e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        min="1"
                        value={row.periodValue}
                        onChange={(e) => updateNewRow('aplikasyon', row.id, 'periodValue', Number(e.target.value))}
                        className="w-20"
                      />
                      <Select
                        value={row.periodUnit}
                        onValueChange={(v) => updateNewRow('aplikasyon', row.id, 'periodUnit', v)}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hafta">Hafta</SelectItem>
                          <SelectItem value="ay">Ay</SelectItem>
                          <SelectItem value="yil">Yıl</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => removeNewRow('aplikasyon', row.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  {aplikasyonPlans.length === 0 && newAplikasyonRows.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">
                      Henüz aplikasyon bakım planı tanımlanmamış.
                    </p>
                  )}
                </ScrollArea>

                <Button variant="outline" className="w-full" onClick={() => addNewRow('aplikasyon')}>
                  <Plus className="h-4 w-4 mr-2" /> Yeni İş Ekle
                </Button>
              </TabsContent>
            </Tabs>
          )}

          {/* Periyodik Parça Değişimi Bölümü */}
          {!isLoadingPlans && (
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center justify-between mb-4">
                <Label className="flex items-center gap-2 font-semibold">
                  <Package className="h-4 w-4" />
                  Periyodik Parça Değişimleri ({existingPeriodicParts.length + newPeriodicPartRows.length})
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPeriodicPartSection(!showPeriodicPartSection)}
                >
                  {showPeriodicPartSection ? 'Gizle' : 'Göster'}
                </Button>
              </div>

              {showPeriodicPartSection && (
                <div className="space-y-4">
                  <ScrollArea className="max-h-64 border rounded-md p-3">
                    {/* Mevcut periyodik parça değişimleri */}
                    {existingPeriodicParts.map(part => (
                      <div key={part.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md mb-2">
                        <div className="flex-1">
                          <p className="font-medium text-sm">{part.stokAdi}</p>
                          <p className="text-xs text-muted-foreground font-mono">{part.stokKodu}</p>
                          <div className="flex gap-2 mt-1">
                            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {part.periodDays ? `${part.periodDays} gün` : (part.nextDueDate?.toDate ? new Date(part.nextDueDate.toDate()).toLocaleDateString('tr-TR') : `${part.periodValue} ${PERIOD_UNIT_LABELS[part.periodUnit]}`)}
                            </span>
                            <span className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                              {RESPONSIBILITY_LABELS[part.responsibilityType]}
                            </span>
                            {part.requiresSerialTracking && (
                              <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                Seri No
                              </span>
                            )}
                            {part.requiresOutgoingPartInfo && (
                              <span className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 px-1.5 py-0.5 rounded">
                                Çıkan Parça
                              </span>
                            )}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeExistingPeriodicPart(part.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}

                    {/* Yeni periyodik parça değişimi satırları */}
                    {newPeriodicPartRows.map(row => (
                      <div key={row.id} className="border border-dashed rounded-md p-3 mb-2 space-y-3">
                        {/* İlk satır: Ürün seçici ve periyot */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 relative">
                            <Button
                              variant="outline"
                              className="w-full justify-between"
                              onClick={() => updatePeriodicPartRow(row.id, 'isPopoverOpen', !row.isPopoverOpen)}
                            >
                              {row.stokAdi ? (
                                <span className="truncate">{row.stokKodu} - {row.stokAdi.substring(0, 30)}...</span>
                              ) : (
                                <span className="text-muted-foreground">Ürün seçin...</span>
                              )}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                            {row.isPopoverOpen && (
                              <div className="absolute left-0 top-full mt-1 w-full min-w-[400px] bg-popover border rounded-md shadow-lg z-50">
                                <div className="flex items-center border-b px-3">
                                  <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                                  <input
                                    type="text"
                                    className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                                    placeholder="Ürün kodu veya adı ara..."
                                    value={row.searchText}
                                    onChange={(e) => updatePeriodicPartRow(row.id, 'searchText', e.target.value)}
                                    autoFocus
                                  />
                                </div>
                                <div className="max-h-[200px] overflow-y-auto p-1">
                                  {(() => {
                                    const searchLower = row.searchText.toLowerCase();
                                    const filtered = productCodes.filter(p =>
                                      !searchLower || p.stokKodu.toLowerCase().includes(searchLower) || p.stokAdi.toLowerCase().includes(searchLower)
                                    );
                                    if (filtered.length === 0) {
                                      return <p className="py-6 text-center text-sm text-muted-foreground">Ürün bulunamadı.</p>;
                                    }
                                    return filtered.map(product => (
                                      <div
                                        key={product.id}
                                        className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                                        onClick={() => selectProductForRow(row.id, product)}
                                      >
                                        <CheckIcon className={cn("mr-2 h-4 w-4", row.productCodeId === product.id ? "opacity-100" : "opacity-0")} />
                                        <div className="flex flex-col">
                                          <span className="font-medium">{product.stokKodu}</span>
                                          <span className="text-sm text-muted-foreground truncate">{product.stokAdi}</span>
                                        </div>
                                      </div>
                                    ));
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                          <Input
                            type="date"
                            value={row.nextDueDate}
                            onChange={(e) => updatePeriodicPartRow(row.id, 'nextDueDate', e.target.value)}
                            className="w-40"
                            placeholder="Tarih seçin"
                          />
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={row.periodDays}
                              onChange={(e) => updatePeriodicPartRow(row.id, 'periodDays', e.target.value.replace(/[^0-9]/g, ''))}
                              className="w-24"
                              placeholder="Gün"
                            />
                            <span className="text-xs text-muted-foreground">gün</span>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removePeriodicPartRow(row.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>

                        {/* İkinci satır: Sorumluluk ve takip seçenekleri */}
                        <div className="flex flex-wrap items-center gap-4">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground">Sorumluluk:</Label>
                            <Select
                              value={row.responsibilityType}
                              onValueChange={(v) => updatePeriodicPartRow(row.id, 'responsibilityType', v as PeriodicPartResponsibility)}
                            >
                              <SelectTrigger className="w-32 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="teknik_servis">Teknik Servis</SelectItem>
                                <SelectItem value="aplikasyon">Aplikasyon</SelectItem>
                                <SelectItem value="both">Her İkisi</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`serial-${row.id}`}
                              checked={row.requiresSerialTracking}
                              onCheckedChange={(checked) => updatePeriodicPartRow(row.id, 'requiresSerialTracking', checked)}
                            />
                            <Label htmlFor={`serial-${row.id}`} className="text-xs cursor-pointer">
                              Seri No Takibi
                            </Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`outgoing-${row.id}`}
                              checked={row.requiresOutgoingPartInfo}
                              onCheckedChange={(checked) => updatePeriodicPartRow(row.id, 'requiresOutgoingPartInfo', checked)}
                            />
                            <Label htmlFor={`outgoing-${row.id}`} className="text-xs cursor-pointer">
                              Çıkan Parça Bilgisi
                            </Label>
                          </div>
                        </div>
                      </div>
                    ))}

                    {existingPeriodicParts.length === 0 && newPeriodicPartRows.length === 0 && (
                      <p className="text-center text-muted-foreground py-4">
                        Henüz periyodik parça değişimi tanımlanmamış.
                      </p>
                    )}
                  </ScrollArea>

                  <Button variant="outline" className="w-full" onClick={addNewPeriodicPartRow}>
                    <Plus className="h-4 w-4 mr-2" /> Periyodik Parça Değişimi Ekle
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setMaintenanceModalOpen(false)}>Kapat</Button>
            <Button onClick={saveMaintenancePlans} disabled={isSavingPlans || (newTeknikRows.length === 0 && newAplikasyonRows.length === 0 && newPeriodicPartRows.length === 0)}>
              {isSavingPlans ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toplu Bakım Planı Modal */}
      <Dialog open={bulkModalOpen} onOpenChange={setBulkModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Toplu Bakım Planı Ata
            </DialogTitle>
          </DialogHeader>

          <Tabs value={bulkMaintenanceTab} onValueChange={(v) => setBulkMaintenanceTab(v as MaintenanceType)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="teknik_servis" className="flex items-center gap-2">
                <Wrench className="h-4 w-4" /> Teknik Servis ({bulkTeknikRows.length})
              </TabsTrigger>
              <TabsTrigger value="aplikasyon" className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4" /> Aplikasyon ({bulkAplikasyonRows.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="teknik_servis" className="space-y-4 mt-4">
              <ScrollArea className="h-64 border rounded-md p-3">
                {bulkTeknikRows.map(row => (
                  <div key={row.id} className="flex items-center gap-2 p-2 border border-dashed rounded-md mb-2">
                    <Input
                      placeholder="İş adı..."
                      value={row.taskName}
                      onChange={(e) => updateBulkRow('teknik_servis', row.id, 'taskName', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min="1"
                      value={row.periodValue}
                      onChange={(e) => updateBulkRow('teknik_servis', row.id, 'periodValue', Number(e.target.value))}
                      className="w-20"
                    />
                    <Select
                      value={row.periodUnit}
                      onValueChange={(v) => updateBulkRow('teknik_servis', row.id, 'periodUnit', v)}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hafta">Hafta</SelectItem>
                        <SelectItem value="ay">Ay</SelectItem>
                        <SelectItem value="yil">Yıl</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => removeBulkRow('teknik_servis', row.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                {bulkTeknikRows.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    Henüz teknik servis bakım planı eklenmemiş.
                  </p>
                )}
              </ScrollArea>
              <Button variant="outline" className="w-full" onClick={() => addBulkRow('teknik_servis')}>
                <Plus className="h-4 w-4 mr-2" /> Yeni İş Ekle
              </Button>
            </TabsContent>

            <TabsContent value="aplikasyon" className="space-y-4 mt-4">
              <ScrollArea className="h-64 border rounded-md p-3">
                {bulkAplikasyonRows.map(row => (
                  <div key={row.id} className="flex items-center gap-2 p-2 border border-dashed rounded-md mb-2">
                    <Input
                      placeholder="İş adı..."
                      value={row.taskName}
                      onChange={(e) => updateBulkRow('aplikasyon', row.id, 'taskName', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min="1"
                      value={row.periodValue}
                      onChange={(e) => updateBulkRow('aplikasyon', row.id, 'periodValue', Number(e.target.value))}
                      className="w-20"
                    />
                    <Select
                      value={row.periodUnit}
                      onValueChange={(v) => updateBulkRow('aplikasyon', row.id, 'periodUnit', v)}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hafta">Hafta</SelectItem>
                        <SelectItem value="ay">Ay</SelectItem>
                        <SelectItem value="yil">Yıl</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => removeBulkRow('aplikasyon', row.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                {bulkAplikasyonRows.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    Henüz aplikasyon bakım planı eklenmemiş.
                  </p>
                )}
              </ScrollArea>
              <Button variant="outline" className="w-full" onClick={() => addBulkRow('aplikasyon')}>
                <Plus className="h-4 w-4 mr-2" /> Yeni İş Ekle
              </Button>
            </TabsContent>
          </Tabs>

          {/* Yedek Parça Değişimi Bölümü */}
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center justify-between mb-4">
              <Label className="flex items-center gap-2 font-semibold">
                <Package className="h-4 w-4" />
                Yedek Parça Değişimleri ({bulkPeriodicPartRows.length})
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkShowPeriodicParts(!bulkShowPeriodicParts)}
              >
                {bulkShowPeriodicParts ? 'Gizle' : 'Göster'}
              </Button>
            </div>

            {bulkShowPeriodicParts && (
              <div className="space-y-4">
                <ScrollArea className="max-h-80 border rounded-md p-3">
                  {bulkPeriodicPartRows.map(row => (
                    <div key={row.id} className="border border-dashed rounded-md p-3 mb-3 space-y-3">
                      {/* Ürün seçici */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 relative">
                          <Button
                            variant="outline"
                            className="w-full justify-between"
                            onClick={() => updateBulkPeriodicPartRow(row.id, 'isPopoverOpen', !row.isPopoverOpen)}
                          >
                            {row.stokAdi ? (
                              <span className="truncate">{row.stokKodu} - {row.stokAdi.substring(0, 30)}...</span>
                            ) : (
                              <span className="text-muted-foreground">Ürün seçin...</span>
                            )}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                          {row.isPopoverOpen && (
                            <div className="absolute left-0 top-full mt-1 w-full min-w-[400px] bg-popover border rounded-md shadow-lg z-50">
                              <div className="flex items-center border-b px-3">
                                <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                                <input
                                  type="text"
                                  className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                                  placeholder="Ürün kodu veya adı ara..."
                                  value={row.searchText}
                                  onChange={(e) => updateBulkPeriodicPartRow(row.id, 'searchText', e.target.value)}
                                  autoFocus
                                />
                              </div>
                              <div className="max-h-[200px] overflow-y-auto p-1">
                                {(() => {
                                  const searchLower = row.searchText.toLowerCase();
                                  const filtered = productCodes.filter(p =>
                                    !searchLower || p.stokKodu.toLowerCase().includes(searchLower) || p.stokAdi.toLowerCase().includes(searchLower)
                                  );
                                  if (filtered.length === 0) {
                                    return <p className="py-6 text-center text-sm text-muted-foreground">Ürün bulunamadı.</p>;
                                  }
                                  return filtered.map(product => (
                                    <div
                                      key={product.id}
                                      className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                                      onClick={() => selectBulkProductForRow(row.id, product)}
                                    >
                                      <CheckIcon className={cn("mr-2 h-4 w-4", row.productCodeId === product.id ? "opacity-100" : "opacity-0")} />
                                      <div className="flex flex-col">
                                        <span className="font-medium">{product.stokKodu}</span>
                                        <span className="text-sm text-muted-foreground truncate">{product.stokAdi}</span>
                                      </div>
                                    </div>
                                  ));
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeBulkPeriodicPartRow(row.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>

                      {/* Tarih seçimi */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Label className="text-xs text-muted-foreground">İlk Değişim Tarihi:</Label>
                        <Input
                          type="date"
                          value={row.nextDueDate}
                          onChange={(e) => updateBulkPeriodicPartRow(row.id, 'nextDueDate', e.target.value)}
                          className="w-40"
                        />
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            value={row.periodDays}
                            onChange={(e) => updateBulkPeriodicPartRow(row.id, 'periodDays', e.target.value.replace(/[^0-9]/g, ''))}
                            className="w-24"
                            placeholder="Gün"
                          />
                          <span className="text-xs text-muted-foreground">gün</span>
                        </div>
                      </div>

                      {row.nextDueDate && (
                        <p className="text-xs text-muted-foreground italic">
                          {new Date(row.nextDueDate + 'T00:00:00').toLocaleDateString('tr-TR')} tarihinden itibaren her {row.periodDays || '?'} günde bir değişmeli
                        </p>
                      )}

                      {/* Sorumluluk ve takip seçenekleri */}
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs text-muted-foreground">Sorumluluk:</Label>
                          <Select
                            value={row.responsibilityType}
                            onValueChange={(v) => updateBulkPeriodicPartRow(row.id, 'responsibilityType', v as PeriodicPartResponsibility)}
                          >
                            <SelectTrigger className="w-32 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="teknik_servis">Teknik Servis</SelectItem>
                              <SelectItem value="aplikasyon">Aplikasyon</SelectItem>
                              <SelectItem value="both">Her İkisi</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`bulk-serial-${row.id}`}
                            checked={row.requiresSerialTracking}
                            onCheckedChange={(checked) => updateBulkPeriodicPartRow(row.id, 'requiresSerialTracking', checked)}
                          />
                          <Label htmlFor={`bulk-serial-${row.id}`} className="text-xs cursor-pointer">
                            Seri No Takibi
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`bulk-outgoing-${row.id}`}
                            checked={row.requiresOutgoingPartInfo}
                            onCheckedChange={(checked) => updateBulkPeriodicPartRow(row.id, 'requiresOutgoingPartInfo', checked)}
                          />
                          <Label htmlFor={`bulk-outgoing-${row.id}`} className="text-xs cursor-pointer">
                            Çıkan Parça Bilgisi
                          </Label>
                        </div>
                      </div>
                    </div>
                  ))}

                  {bulkPeriodicPartRows.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">
                      Henüz yedek parça değişimi eklenmemiş.
                    </p>
                  )}
                </ScrollArea>

                <Button variant="outline" className="w-full" onClick={addBulkPeriodicPartRow}>
                  <Plus className="h-4 w-4 mr-2" /> Yedek Parça Değişimi Ekle
                </Button>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setBulkModalOpen(false)}>Kapat</Button>
            <Button
              onClick={handleBulkSaveClick}
              disabled={bulkTeknikRows.length === 0 && bulkAplikasyonRows.length === 0 && bulkPeriodicPartRows.length === 0}
            >
              Kaydet ve Laboratuvar Seç
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Laboratuvar / Cihaz Seçimi Modal */}
      <Dialog open={labSelectionModalOpen} onOpenChange={setLabSelectionModalOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Hedef Seçimi
            </DialogTitle>
          </DialogHeader>

          {/* Selection Mode Toggle */}
          <div className="flex gap-2 border-b pb-3">
            <Button
              variant={selectionMode === 'lab' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setSelectionMode('lab'); setSelectedDeviceIds([]); }}
            >
              <Building2 className="h-4 w-4 mr-1" />
              Laboratuvar Seçimi
            </Button>
            <Button
              variant={selectionMode === 'device' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setSelectionMode('device'); setSelectedLabIds([]); }}
            >
              <Wrench className="h-4 w-4 mr-1" />
              Cihaz Seçimi
            </Button>
          </div>

          {selectionMode === 'lab' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Bakım planının atanacağı laboratuvarları seçin. Seçilen laboratuvarlardaki tüm cihazlara plan kaydedilecektir.
              </p>

              <div className="flex items-center gap-2 border-b pb-3 mb-3">
                <Checkbox
                  id="select-all-labs"
                  checked={selectedLabIds.length === labsWithDevices.length && labsWithDevices.length > 0}
                  onCheckedChange={toggleAllLabs}
                />
                <Label htmlFor="select-all-labs" className="text-sm font-medium cursor-pointer">
                  Tümünü Seç ({labsWithDevices.length} laboratuvar)
                </Label>
              </div>

              <ScrollArea className="max-h-[40vh]">
                <div className="space-y-2">
                  {labsWithDevices.map(lab => {
                    const deviceCount = devices.filter(d => d.hospitalId === lab.id).length;
                    return (
                      <div
                        key={lab.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors",
                          selectedLabIds.includes(lab.id) ? "bg-primary/10 border-primary" : "hover:bg-muted/50"
                        )}
                        onClick={() => toggleLabSelection(lab.id)}
                      >
                        <Checkbox
                          checked={selectedLabIds.includes(lab.id)}
                          onCheckedChange={() => toggleLabSelection(lab.id)}
                        />
                        <div className="flex-1">
                          <p className="font-medium text-sm">{lab.name}</p>
                          <p className="text-xs text-muted-foreground">{deviceCount} cihaz</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              {selectedLabIds.length > 0 && (
                <div className="bg-muted/50 rounded-md p-3 text-sm">
                  <p className="font-medium">Özet:</p>
                  <p className="text-muted-foreground">
                    {selectedLabIds.length} laboratuvar seçildi &middot;{' '}
                    {devices.filter(d => selectedLabIds.includes(d.hospitalId || '')).length} cihaza uygulanacak
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Bakım planının atanacağı cihazları tek tek seçin.
              </p>

              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cihaz adı, marka, seri no veya lab ara..."
                  value={deviceSearchQuery}
                  onChange={(e) => setDeviceSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="flex items-center gap-2 border-b pb-3 mb-3">
                <Checkbox
                  id="select-all-devices"
                  checked={selectedDeviceIds.length === (deviceSearchQuery.trim() ? devices.filter(d => {
                    const q = deviceSearchQuery.toLowerCase();
                    const hospitalName = hospitals.find(h => h.id === d.hospitalId)?.name || '';
                    return (d.cihazAdi || d.model || '').toLowerCase().includes(q) ||
                      (d.brand || '').toLowerCase().includes(q) ||
                      (d.seriNumarasi || '').toLowerCase().includes(q) ||
                      hospitalName.toLowerCase().includes(q);
                  }).length : devices.length) && devices.length > 0}
                  onCheckedChange={toggleAllDevices}
                />
                <Label htmlFor="select-all-devices" className="text-sm font-medium cursor-pointer">
                  Tümünü Seç ({devices.length} cihaz)
                </Label>
              </div>

              <ScrollArea className="max-h-[40vh]">
                <div className="space-y-2">
                  {devices
                    .filter(d => {
                      if (!deviceSearchQuery.trim()) return true;
                      const q = deviceSearchQuery.toLowerCase();
                      const hospitalName = hospitals.find(h => h.id === d.hospitalId)?.name || '';
                      return (d.cihazAdi || d.model || '').toLowerCase().includes(q) ||
                        (d.brand || '').toLowerCase().includes(q) ||
                        (d.seriNumarasi || '').toLowerCase().includes(q) ||
                        hospitalName.toLowerCase().includes(q);
                    })
                    .map(device => {
                      const hospitalName = hospitals.find(h => h.id === device.hospitalId)?.name || '';
                      return (
                        <div
                          key={device.id}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors",
                            selectedDeviceIds.includes(device.id) ? "bg-primary/10 border-primary" : "hover:bg-muted/50"
                          )}
                          onClick={() => toggleDeviceSelection(device.id)}
                        >
                          <Checkbox
                            checked={selectedDeviceIds.includes(device.id)}
                            onCheckedChange={() => toggleDeviceSelection(device.id)}
                          />
                          <div className="flex-1">
                            <p className="font-medium text-sm">{device.cihazAdi || device.model || `${device.brand} ${device.model}`}</p>
                            <p className="text-xs text-muted-foreground">
                              {hospitalName} &middot; SN: {device.seriNumarasi || '-'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </ScrollArea>

              {selectedDeviceIds.length > 0 && (
                <div className="bg-muted/50 rounded-md p-3 text-sm">
                  <p className="font-medium">Özet:</p>
                  <p className="text-muted-foreground">
                    {selectedDeviceIds.length} cihaz seçildi
                  </p>
                </div>
              )}
            </>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setLabSelectionModalOpen(false)}>Geri</Button>
            <Button
              onClick={saveBulkMaintenancePlans}
              disabled={isSavingBulk || (selectionMode === 'lab' ? selectedLabIds.length === 0 : selectedDeviceIds.length === 0)}
            >
              {isSavingBulk ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Kaydet ({selectionMode === 'lab' ? `${selectedLabIds.length} laboratuvar` : `${selectedDeviceIds.length} cihaz`})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cihaz Laboratuvar Gruplandırma Modal */}
      <DeviceLabPoolModal
        open={deviceLabPoolModalOpen}
        onOpenChange={setDeviceLabPoolModalOpen}
        hospitals={hospitals}
        devices={devices}
      />
    </div>
  );
}
