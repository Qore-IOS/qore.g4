
'use client';
import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useParams } from 'next/navigation';
import type { Laboratory, DepoStokItem, ConsumptionRecord, Device, ProductCode, BarcodeFormat, LabPool, DeviceGroup, TrashBinRecord } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Barcode, AlertTriangle, CheckCircle, PackageMinus, TrendingUp, Info, Clock, Camera, Loader2, Wrench, XCircle, ClipboardPlus, ChevronsUpDown, Check, Pencil, Play, Trash2 } from 'lucide-react';
import { playFeedback, sanitizeGS1 } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { collection, writeBatch, doc, getDocs, query, where, Timestamp, onSnapshot, addDoc, updateDoc, orderBy } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { compareAsc, parse as parseDate } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
import Image from 'next/image';
import { Label } from '@/components/ui/label';
import { useUsageRouteSync } from '@/hooks/useUsageRouteSync';
import { parseAnyBarcode, resolveProductFromParsed } from '@/lib/barcode';
import { TrackingMode } from '@/lib/tracking';
import { emitFaultOpened, emitFefoOverride } from '@/lib/notifications';
import { Input } from './ui/input';
import { openDeviceFaultReport } from '@/lib/faults';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useLightDashboardData } from './dashboard/useDashboardData';
import { useBarcodeFormatsQuery, useLabStock, useRecentConsumption, useSubPoints, useInvalidateQueries, useMinMaxRules } from '@/hooks/useFirebaseQueries';

const DynamicCameraBarcodeScanner = dynamic(() => import('@/components/camera-barcode-scanner'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Kamera Yükleniyor...</p></div>,
});

const logSerialHistory = async (seriNo: string, type: string, details: any) => {
    if (!seriNo) {
        console.warn("Attempted to log history for an empty serial number.");
        return;
    }
    const historyRef = collection(db, `serialHistory/${seriNo}/events`);
    await addDoc(historyRef, {
        type,
        details,
        timestamp: Timestamp.now(),
    });
};

export default function UrunKullanimPanel() {
  const { currentUser, currentUserProfile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();

  const slug = params.slug as string[] | undefined;
  const labIdFromUrl = slug?.[0] || '';
  const pointIdFromUrl = slug?.[1] || '';

  // State must be defined before using in hooks
  const [selectedLabId, setSelectedLabId] = useState(labIdFromUrl);
  const [selectedSubPointId, setSelectedSubPointId] = useState(pointIdFromUrl);

  // Use lightweight dashboard data (no heavy collections like depoStok, tuketimKayitlari)
  const {
      hospitals: laboratories,
      devices,
      productCodes: products,
      labPools,
      isLoading,
  } = useLightDashboardData();

  // Use TanStack Query for barcode formats with caching
  const { data: barcodeFormats = [] } = useBarcodeFormatsQuery();
  const { invalidateConsumption, invalidateDepoStok } = useInvalidateQueries();

  // Fetch min/max rules for selected lab (for trash bin product filtering)
  const { data: minMaxRules = [] } = useMinMaxRules(selectedLabId);

  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([]);

  // Use TanStack Query for subPoints of selected lab only (not all labs!)
  const { data: selectedLabSubPoints = [] } = useSubPoints(selectedLabId);
  
  const { onHospitalSelect, onPointSelect } = useUsageRouteSync(
    selectedLabId,
    setSelectedLabId,
    selectedSubPointId,
    setSelectedSubPointId
  );

  const [lastScannedProduct, setLastScannedProduct] = useState<ConsumptionRecord | null>(null);
  const [lastScannedDeviceGroupImage, setLastScannedDeviceGroupImage] = useState<string | null>(null);
  const [sessionHistory, setSessionHistory] = useState<ConsumptionRecord[]>([]);
  const [scanStatus, setScanStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  
  const [isExpiryWarningModalOpen, setIsExpiryWarningModalOpen] = useState(false);
  const [lotReplaceTarget, setLotReplaceTarget] = useState<{ scanned: DepoStokItem, recommended: DepoStokItem } | null>(null);
  
  const selectedLab = useMemo(() => laboratories.find(l => l.id === selectedLabId) || null, [laboratories, selectedLabId]);
  
  const [faultModalOpen, setFaultModalOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [faultDescription, setFaultDescription] = useState('');
  const [isSavingFault, setIsSavingFault] = useState(false);
  
  const [isLabPopoverOpen, setIsLabPopoverOpen] = useState(false);
  const [isManualDeductionOpen, setIsManualDeductionOpen] = useState(false);
  const [manualProductCode, setManualProductCode] = useState('');
  const [manualLotKey, setManualLotKey] = useState('');
  const [manualQuantity, setManualQuantity] = useState(1);
  const [isSessionActive, setIsSessionActive] = useState(false);

  // Trash bin modal states
  const [isTrashBinModalOpen, setIsTrashBinModalOpen] = useState(false);
  const [selectedTrashDevice, setSelectedTrashDevice] = useState<Device | null>(null);
  const [trashItems, setTrashItems] = useState<Array<{
    id: string;
    productCode: string;
    productName: string;
    remainingTests: number;
  }>>([]);
  const [selectedTrashProduct, setSelectedTrashProduct] = useState('');
  const [trashRemainingTests, setTrashRemainingTests] = useState<number>(0);

  useEffect(() => {
    const handleOpenFaultModal = (event: CustomEvent<Device>) => {
      setSelectedDevice(event.detail);
      setFaultDescription((event.detail as any).arizaAciklamasi || '');
      setFaultModalOpen(true);
    };

    window.addEventListener('openDeviceFaultModal', handleOpenFaultModal as EventListener);
    return () => {
      window.removeEventListener('openDeviceFaultModal', handleOpenFaultModal as EventListener);
    };
  }, []);

  // Fetch device groups (small collection, rarely changes)
  useEffect(() => {
    const fetchDeviceGroups = async () => {
      try {
        const dgsnap = await getDocs(collection(db, 'def_deviceGroups'));
        setDeviceGroups(dgsnap.docs.map(d => ({id: d.id, ...d.data()} as DeviceGroup)));
      } catch (e) {
        toast({title: 'Hata', description: 'Cihaz grupları yüklenemedi.', variant: 'destructive'});
      }
    };
    fetchDeviceGroups();
  }, [toast]);

  // Compute productTracking and productNames from products (useMemo instead of useEffect+state)
  const { productTracking, productNames } = useMemo(() => {
    const t: Record<string, TrackingMode> = {};
    const names: Record<string, string> = {};
    products.forEach(p => {
      if (p.stokKodu) {
        names[p.stokKodu] = p.stokAdi || p.stokKodu;
        if ((p as any).trackingMode) t[p.stokKodu] = (p as any).trackingMode as TrackingMode;
      }
    });
    return { productTracking: t, productNames: names };
  }, [products]);

  // REMOVED: Listeners for ALL laboratories' subPoints - was causing N listeners!
  // Now using useSubPoints(selectedLabId) which only fetches for selected lab

  const assignedLaboratories = useMemo(() => {
    const allLabs = laboratories.filter(l => !l.isConsumablesHospital); 
    if (currentUserProfile?.role === 'admin') return allLabs;
    if (currentUserProfile?.assignedLaboratories && currentUserProfile.assignedLaboratories.length > 0) {
      return allLabs.filter(h => currentUserProfile?.assignedLaboratories?.includes(h.id));
    }
    return [];
  }, [currentUserProfile, laboratories]);

  useEffect(() => {
    if (assignedLaboratories.length === 1 && !selectedLabId) {
      onHospitalSelect(assignedLaboratories[0].id);
    }
  }, [assignedLaboratories, selectedLabId, onHospitalSelect]);

  const selectedLabName = laboratories.find(h => h.id === selectedLabId)?.name || '';
  const selectedSubPoint = useMemo(
    () => selectedLabSubPoints.find(sp => sp.id === selectedSubPointId),
    [selectedLabSubPoints, selectedSubPointId]
  );

  // Compute pool member IDs and names for lab stock
  const { poolMemberIds, poolMemberNames } = useMemo(() => {
    const pool = labPools.find(p => p.memberIds.includes(selectedLabId));
    const ids = pool?.memberIds || (selectedLabId ? [selectedLabId] : []);
    // Get names for legacy record support
    const names = ids.map(id => laboratories.find(l => l.id === id)?.name).filter((n): n is string => !!n);
    return { poolMemberIds: ids, poolMemberNames: names };
  }, [labPools, selectedLabId, laboratories]);

  // Use TanStack Query for lab stock - much more efficient than full depoStok
  // Now also passes lab names to support legacy records without hedefKurumId
  const { data: labStock = [] } = useLabStock(poolMemberIds, poolMemberNames);

  // Use TanStack Query for recent consumption (for duplicate check)
  const { data: tuketimKayitlari = [] } = useRecentConsumption(200);
  
  const devicesToDisplay = useMemo(() => {
    if (!selectedLabId || !devices) return [];
    return devices
      .filter(d => {
        const deviceLabId = d.hospitalId || (d as any).hastaneId;
        return deviceLabId?.toString() === selectedLabId.toString();
      })
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }, [devices, selectedLabId]);

  const recordConsumption = useCallback(async (itemToConsume: DepoStokItem) => {
    if (!selectedLab) return null;
  
    const ownerId = itemToConsume.hedefKurumId || laboratories.find(l => l.name === itemToConsume.hedefKurum)?.id || selectedLab.id;
    const ownerName = laboratories.find(l => l.id === ownerId)?.name || itemToConsume.hedefKurum || selectedLab.name || '';
  
    const newTuketimDocRef = doc(collection(db, 'tuketimKayitlari'));
    
    const newRec: Omit<ConsumptionRecord, 'id'> & {
      usageLabId: string; usageLabName: string;
      deductedFromLabId: string; deductedFromLabName: string;
    } = {
      stokKodu: itemToConsume.stokKodu,
      stokAdi: itemToConsume.stokAdi,
      lotNumarasi: itemToConsume.lotNumarasi || '',
      miad: itemToConsume.miad ?? '',
      seriNumarasi: itemToConsume.seriNumarasi || '',
      laboratoryId: selectedLab.id,
      laboratoryName: selectedLab.name || '',
      usageLabId: selectedLab.id,
      usageLabName: selectedLab.name || '',
      deductedFromLabId: ownerId,
      deductedFromLabName: ownerName,
      consumptionTimestamp: Timestamp.now(),
      userId: currentUserProfile?.uid || '',
      userName: currentUserProfile?.name || currentUserProfile?.email || '—',
      consumptionType: 'normal_kullanim',
      rafAdresi: (itemToConsume as any).rafAdresi || '',
      irsaliyeNumarasi: (itemToConsume as any).irsaliyeNumarasi || '',
      subPointId: selectedSubPoint?.id || '',
      subPointName: selectedSubPoint?.name || '',
    };
  
    const depoStokDocRef = doc(db, 'depoStok', itemToConsume.id);
  
    const batch = writeBatch(db);
    batch.set(newTuketimDocRef, newRec);
    batch.delete(depoStokDocRef);
  
    try {
      await batch.commit();

      // Invalidate caches so data refreshes
      invalidateDepoStok();
      invalidateConsumption();

      await logSerialHistory(itemToConsume.seriNumarasi || '', 'consumption', {
        stokKodu: itemToConsume.stokKodu,
        usageLabId: selectedLab.id,
        deductedFromLabId: ownerId,
        subPointId: selectedSubPoint?.id || '',
        subPointName: selectedSubPoint?.name || '',
      });
  
      const finalRecord = {...newRec, id: newTuketimDocRef.id, consumptionTimestamp: new Date()};
      setLastScannedProduct(finalRecord as any);
      setSessionHistory(prev => [finalRecord, ...prev].slice(0, 10)); // Update local history
      
      setLastScannedDeviceGroupImage(null);
      setTimeout(() => {
        const productInfo = products.find(p => p.stokKodu === itemToConsume.stokKodu);
        const imageUrl = productInfo?.cihazGrubu ? deviceGroups.find(dg => dg.name === productInfo.cihazGrubu)?.imageUrl || null : null;
        setLastScannedDeviceGroupImage(imageUrl);
      }, 50);

      setScanStatus('success');
      playFeedback();
      toast({ title: "Başarılı", description: `${itemToConsume.seriNumarasi} seri numaralı ürün ${ownerName} stoğundan düşüldü.` });
      setTimeout(() => setScanStatus('idle'), 3000);

      return newTuketimDocRef.id;
    } catch (err) {
      console.error("Consumption write error: ", err);
      setScanStatus('error');
      toast({ title: "Veritabanı Hatası", description: "Tüketim kaydedilirken hata oluştu.", variant: 'destructive'});
      setTimeout(() => setScanStatus('idle'), 3000);
      return null;
    }
  }, [currentUserProfile, selectedLab, laboratories, toast, selectedSubPoint, products, deviceGroups, invalidateDepoStok, invalidateConsumption]);
  
  const pickEarliest = (items: DepoStokItem[]) => {
    return items
      .map(i => ({ item: i, d: parseDate(i.miad ?? '', 'dd.MM.yyyy', new Date()) }))
      .sort((a, b) => compareAsc(a.d, b.d))[0]?.item;
  };

  const findBySerial = (stokKodu: string, seri: string) =>
    labStock.find(i => i.stokKodu === stokKodu && i.seriNumarasi === seri && i.isShipped);

  const findByLot = (stokKodu: string, lot: string) => {
    const pool = labStock.filter(i => i.stokKodu === stokKodu && i.lotNumarasi === lot && i.isShipped);
    return pickEarliest(pool);
  };

  const findByRefOnly = (stokKodu: string) => {
    const pool = labStock.filter(i => i.stokKodu === stokKodu && i.isShipped);
    return pickEarliest(pool);
  };

  const consumeByParsed = useCallback(async (rawInput: string) => {
    if (!selectedLabId) {
      toast({ title: 'Hata', description: 'Lütfen kullanım yapılacak laboratuvarı seçin.', variant: 'destructive' });
      return;
    }
    
    const candidate = sanitizeGS1(rawInput) || rawInput;
    const parsed = parseAnyBarcode(candidate, barcodeFormats);

    if (!parsed) {
      toast({ title: 'Barkod Ayrıştırma Hatası', description: 'Tanımlı formatlarla eşleşmedi.', variant: 'destructive' });
      return;
    }

    const resolved = resolveProductFromParsed(parsed, products);
    if (!resolved.product || !resolved.stokKodu) {
      toast({ title: 'Ürün Bulunamadı', description: 'Barkoddan bir ürün çözümlenemedi.', variant: 'destructive' });
      return;
    }
    
    const stokKodu = resolved.stokKodu!;
    const lot = resolved.lotNumarasi || '';
    const seri = resolved.seriNumarasi || '';
    const mode = productTracking[stokKodu] ?? 'serial';

    let item: DepoStokItem | undefined;

    if (mode === 'serial') {
        if (!seri) {
          toast({ title: 'Ayrıştırma Hatası', description: `${stokKodu} seri takipli, ancak barkod seri no içermiyor.`, variant: 'destructive' });
          return;
        }
        item = findBySerial(stokKodu, seri);
        if (!item) {
          toast({ title: 'Depoda Bulunamadı', description: `Seri No ${seri} bu laboratuvar stoğunda yok.`, variant: 'destructive' });
          return;
        }
    } else if (mode === 'lot_barcode') {
        if (!lot) {
          toast({ title: 'Ayrıştırma Hatası', description: `${stokKodu} lot takipli, ancak barkod lot içermiyor.`, variant: 'destructive' });
          return;
        }
        item = findByLot(stokKodu, lot);
        if (!item) {
          toast({ title: 'Depoda Bulunamadı', description: `${stokKodu} (Lot: ${lot}) için stok yok.`, variant: 'destructive' });
          return;
        }
    } else { 
        item = findByRefOnly(stokKodu);
        if (!item) {
          toast({ title: 'Depoda Bulunamadı', description: `${stokKodu} için stok yok.`, variant: 'destructive' });
          return;
        }
    }

    if (item.irsaliyeNumarasi !== 'İSTİSNA GİRİŞİ' && item.seriNumarasi) {
        // Check by both stokKodu AND seriNumarasi since same serial can exist for different products
        const alreadyConsumed = tuketimKayitlari.some(c => c.stokKodu === stokKodu && c.seriNumarasi === item!.seriNumarasi);
        if (alreadyConsumed) {
            toast({ title: 'Zaten Tüketilmiş', description: `${stokKodu} - Seri No ${item.seriNumarasi} daha önce stoktan düşülmüş.`, variant: 'destructive' });
            playFeedback(true);
            setScanStatus('error');
            setTimeout(() => setScanStatus('idle'), 3000);
            return;
        }
    }

    await recordConsumption(item!);

  }, [selectedLabId, barcodeFormats, products, productTracking, labStock, toast, findBySerial, findByLot, findByRefOnly, recordConsumption, tuketimKayitlari]);
  
  const onProcess = useCallback((barcode: string) => {
    if (isExpiryWarningModalOpen && lotReplaceTarget) {
        const parsed = parseAnyBarcode(barcode, barcodeFormats);
        if (!parsed || !parsed.seriNumarasi) {
          toast({ title: 'Geçersiz Barkod', description: 'Barkod ayrıştırılamadı.', variant: 'destructive' });
          return;
        }
        if (parsed.lotNumarasi !== lotReplaceTarget.recommended.lotNumarasi) {
          toast({ title: 'Yanlış Lot', description: `Lütfen ${lotReplaceTarget.recommended.lotNumarasi} lotundan bir seri okutun.`, variant: 'destructive' });
          return;
        }
        // Use stokKodu from the recommended item to ensure we find the correct product
        const targetStokKodu = lotReplaceTarget.recommended.stokKodu;
        const newItem = findBySerial(targetStokKodu, parsed.seriNumarasi);
        if (!newItem) {
          toast({ title: 'Depoda Bulunamadı', description: 'Bu seri lotta bulunamadı.', variant: 'destructive' });
          return;
        }
        recordConsumption(newItem);
        setIsExpiryWarningModalOpen(false);
        setLotReplaceTarget(null);
        return;
    }
    consumeByParsed(barcode);
  }, [consumeByParsed, isExpiryWarningModalOpen, lotReplaceTarget, barcodeFormats, toast, findBySerial, recordConsumption]);
  
  useHidScanner({
    enabled: !isCameraScannerOpen && !isExpiryWarningModalOpen && !faultModalOpen && !isManualDeductionOpen,
    onScan: ({ raw }) => onProcess(raw)
  });

  const handleCameraScanSuccess = (rawCode: string) => {
    onProcess(rawCode);
    setIsCameraScannerOpen(false);
  };
  
  const safeName = useCallback(
    (code: string, fallback: string) => productNames[code] || fallback || code,
    [productNames]
  );
  
  const handleFaultReport = useCallback(async (faultType: 'teknik_servis' | 'aplikasyon') => {
    if (!selectedDevice) return;
    setIsSavingFault(true);
    try {
      await openDeviceFaultReport({
        hospitalId: selectedLabId ?? '',
        labName: selectedLabName ?? '',
        deviceId: selectedDevice.id,
        model: selectedDevice.cihazAdi || selectedDevice.name || '',
        serial: selectedDevice.seriNumarasi || '',
        faultType,
        openedByUid: currentUser?.uid || '',
        openedByName: currentUserProfile?.name || '',
        openDescription: faultDescription,
      });

      await emitFaultOpened({
        actor: { uid: currentUser?.uid || '', name: currentUserProfile?.name || '' },
        assignedDeviceId: selectedDevice.id,
        deviceName: selectedDevice.cihazAdi || selectedDevice.name || '',
        faultType: faultType,
        hospitalId: selectedLabId ?? '',
        hospitalName: selectedLabName ?? '',
      });
  
      toast({ title: 'Arıza Kaydı Oluşturuldu', description: `${selectedDevice.cihazAdi} için arıza bildirildi.` });
      setFaultModalOpen(false);
      setFaultDescription('');
      setSelectedDevice(null);
    } catch (err) {
      console.error('Failed to report fault:', err);
      toast({ title: 'Hata', description: 'Arıza kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsSavingFault(false);
    }
  }, [selectedDevice, faultDescription, currentUser, currentUserProfile, selectedLabId, selectedLabName, toast]);

  const manualDeductionAvailableProducts = useMemo(() => {
    return Array.from(new Set(labStock.map(item => item.stokKodu)))
        .map(code => products.find(p => p.stokKodu === code))
        .filter((p): p is ProductCode => !!p)
        .sort((a,b) => (a.stokAdi || '').localeCompare(b.stokAdi || ''));
  }, [labStock, products]);
  
  const manualDeductionLotOptions = useMemo(() => {
    if (!manualProductCode) return [];
    const lots = new Map<string, { miad: string; count: number }>();
    labStock
      .filter(item => item.stokKodu === manualProductCode)
      .forEach(item => {
        const key = `${item.lotNumarasi || 'N/A'}|${item.miad || 'N/A'}`;
        const current = lots.get(key) || { miad: item.miad ?? 'N/A', count: 0 };
        current.count += 1;
        lots.set(key, current);
      });
    return Array.from(lots.entries()).map(([key, data]) => ({ key, label: `${key.split('|')[0]} / ${data.miad}`, count: data.count }));
  }, [labStock, manualProductCode]);

  const handleTrashBinSubmit = useCallback(async () => {
    if (!selectedTrashDevice || trashItems.length === 0 || !selectedLab) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen cihaz seçin ve en az bir ürün ekleyin.', variant: 'destructive' });
      return;
    }

    try {
      const batch = writeBatch(db);

      trashItems.forEach((item) => {
        const trashBinRef = doc(collection(db, 'trashBinRecords'));
        const trashBinRecord: Omit<TrashBinRecord, 'id'> & { id: string } = {
          id: trashBinRef.id,
          laboratoryId: selectedLab.id,
          laboratoryName: selectedLab.name || '',
          deviceId: selectedTrashDevice.id,
          deviceModel: selectedTrashDevice.cihazAdi || selectedTrashDevice.model || '',
          deviceSerialNumber: selectedTrashDevice.seriNumarasi || '',
          stokKodu: item.productCode,
          stokAdi: item.productName,
          remainingTests: item.remainingTests,
          createdAt: Timestamp.now(),
          createdByUid: currentUser?.uid || '',
          createdByName: currentUserProfile?.name || currentUserProfile?.email || '',
          sourceType: 'manual',
        };

        batch.set(trashBinRef, trashBinRecord);
      });

      await batch.commit();

      toast({
        title: 'Çöpe Gönderildi',
        description: `${trashItems.length} ürün çöp kutusuna eklendi.`,
      });

      // Reset state
      setIsTrashBinModalOpen(false);
      setSelectedTrashDevice(null);
      setTrashItems([]);
      setSelectedTrashProduct('');
      setTrashRemainingTests(0);
    } catch (error) {
      console.error('Trash bin submit error:', error);
      toast({
        title: 'Hata',
        description: 'Ürünler çöp kutusuna eklenirken bir hata oluştu.',
        variant: 'destructive',
      });
    }
  }, [selectedTrashDevice, trashItems, selectedLab, currentUser, currentUserProfile, toast]);

  const handleManualDeduction = async () => {
    if (!manualProductCode || !manualLotKey || manualQuantity <= 0) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen ürün, lot ve geçerli bir adet girin.', variant: 'destructive' });
      return;
    }
    const [lot, miad] = manualLotKey.split('|');
    const itemsToConsume = labStock.filter(item =>
        item.stokKodu === manualProductCode &&
        item.lotNumarasi === (lot === 'N/A' ? '' : lot) &&
        item.miad === (miad === 'N/A' ? '' : miad)
    ).slice(0, manualQuantity);

    if (itemsToConsume.length < manualQuantity) {
        toast({ title: 'Yetersiz Stok', description: `Seçilen lot için sadece ${itemsToConsume.length} adet ürün mevcut.`, variant: 'destructive' });
        return;
    }

    try {
        for (const item of itemsToConsume) {
            await recordConsumption(item);
        }
        toast({ title: 'Başarılı', description: `${manualQuantity} adet ürün manuel olarak düşüldü.` });
        setIsManualDeductionOpen(false);
        setManualProductCode('');
        setManualLotKey('');
        setManualQuantity(1);
    } catch (error) {
        toast({ title: 'Hata', description: 'Manuel düşüm sırasında bir hata oluştu.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
       <div className="p-4 sm:p-6 pb-0">
          <h2 className="text-2xl font-bold font-headline text-gradient-primary">{currentUserProfile?.name || 'Kullanıcı'}</h2>
          <p className="text-sm text-muted-foreground">{selectedLabName || 'Laboratuvar seçilmedi'}</p>
        </div>
      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-xl font-headline flex items-center"><PackageMinus className="mr-2 h-6 w-6 text-primary" />Ürün Kullanım Kaydı</CardTitle>
              <CardDescription>Laboratuvar seçerek kullanılan ürünlerin barkodlarını okutup stoktan düşün.</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsTrashBinModalOpen(true)}
              disabled={!selectedLabId}
              className="ml-4"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Çöp Kutusu
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
              <div className="w-full flex items-center justify-center">
                <Image
                  src="/ChatGPT%20Image%206%20A%C4%9Fu%202025%2009_10_30.png"
                  alt="Merkez Laboratuvar dioraması"
                  width={1080}
                  height={1080}
                  data-ai-hint="laboratory illustration"
                  className="w-full h-auto object-contain"
                  priority
                />
              </div>

              <div className="w-full space-y-4">
                  <div className="flex items-end gap-2">
                    <div className="flex-grow">
                      <Label className="block text-sm font-medium mb-1">Laboratuvar Seçin</Label>
                      <Popover open={isLabPopoverOpen} onOpenChange={setIsLabPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={isLabPopoverOpen}
                            className="w-full justify-between font-normal"
                            disabled={isLoading || (assignedLaboratories.length <= 1 && currentUserProfile?.role !== 'admin')}
                          >
                            {selectedLabId
                              ? assignedLaboratories.find((lab) => lab.id === selectedLabId)?.name
                              : "Laboratuvar seçin..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                          <Command>
                            <CommandInput placeholder="Laboratuvar ara..." />
                            <CommandList>
                              {isLoading ? <div className="p-4 text-sm text-center">Yükleniyor...</div> : 
                               <CommandEmpty>Laboratuvar bulunamadı.</CommandEmpty>
                              }
                              <CommandGroup>
                                {assignedLaboratories.sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((lab) => (
                                  <CommandItem
                                    key={lab.id}
                                    value={lab.name}
                                    onSelect={() => {
                                      onHospitalSelect(lab.id);
                                      setIsLabPopoverOpen(false);
                                    }}
                                  >
                                    <Check className={cn("mr-2 h-4 w-4", selectedLabId === lab.id ? "opacity-100" : "opacity-0")} />
                                    {lab.name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <Button onClick={() => setIsCameraScannerOpen(true)} variant="outline" size="icon" className="h-10 w-10" title="Kamera ile Tara" disabled={!selectedLabId}>
                      <Camera className="h-5 w-5" />
                    </Button>
                     {selectedLab?.manualDeductionEnabled && (
                      <Button variant="outline" size="icon" className="h-10 w-10" title="Manuel Düşüm" disabled={!selectedLabId} onClick={() => setIsManualDeductionOpen(true)}>
                          <Pencil className="h-5 w-5" />
                      </Button>
                    )}
                  </div>

                  <p className="text-sm text-muted-foreground text-center">
                      <Info className="inline h-4 w-4 mr-1 text-primary"/>
                      Barkod okuyucu bu alanda aktiftir. Okutulan ürünler stoktan düşecektir.
                  </p>

                  <Card className={cn("w-full transition-colors relative overflow-hidden", scanStatus === 'success' && 'border-green-500', scanStatus === 'error' && 'border-destructive')}>
                      <div className="flex">
                          <div className="flex-1 p-4">
                              <CardHeader className="p-0 mb-2">
                                <div className={cn("flex items-center gap-2", scanStatus === 'success' && 'text-green-500', scanStatus === 'error' && 'text-destructive')}>
                                  {scanStatus === 'success' ? <CheckCircle className="w-6 w-6" /> : scanStatus === 'error' ? <XCircle className="w-6 w-6" /> : <Barcode className="w-6 w-6" />}
                                  <span className="font-semibold">Son Okutulan Ürün</span>
                                </div>
                              </CardHeader>
                              <CardContent className="p-0">
                                {lastScannedProduct ? (
                                  <div className="space-y-1">
                                    <p className="text-lg font-semibold">{safeName(lastScannedProduct.stokKodu, lastScannedProduct.stokAdi ?? '')}</p>
                                    <p className="text-sm text-muted-foreground">Seri No: <span className="font-mono">{lastScannedProduct.seriNumarasi}</span></p>
                                    <p className="text-sm text-muted-foreground">Lot: {lastScannedProduct.lotNumarasi} | Miad: {lastScannedProduct.miad ?? ''}</p>
                                    {lastScannedProduct.subPointName ? (
                                      <p className="text-sm text-muted-foreground">Tüketim Noktası: {lastScannedProduct.subPointName}</p>
                                    ) : null}
                                    {scanStatus === 'success' && <p className="text-green-500 text-sm font-medium mt-2">Stoktan Düşüldü!</p>}
                                  </div>
                                ) : (
                                  <p className="text-muted-foreground text-sm">Henüz ürün okutulmadı.</p>
                                )}
                              </CardContent>
                          </div>
                          {lastScannedDeviceGroupImage && (
                              <div className="w-2/5 p-2 flex items-center justify-center">
                                  <Image
                                      src={`/${lastScannedDeviceGroupImage}`}
                                      alt="Cihaz Grubu"
                                      width={150}
                                      height={150}
                                      className="object-contain max-h-full"
                                  />
                              </div>
                          )}
                      </div>
                  </Card>

                  <Card className="w-full">
                      <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                              <Clock className="w-4 h-4 text-muted-foreground"/>
                              Son 10 Tüketim
                          </CardTitle>
                      </CardHeader>
                      <CardContent>
                          <ScrollArea className="h-32">
                              {sessionHistory.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">Henüz tüketim kaydı yok.</p>
                              ) : (
                                  <ul className="text-sm space-y-1">
                                      {sessionHistory.map((item, index) => (
                                          <li key={index} className="flex justify-between items-center text-xs p-1 rounded-md hover:bg-muted/50">
                                              <div className="truncate">
                                                  <span className="font-semibold">{safeName(item.stokKodu, item.stokAdi ?? '')}</span>
                                                  <span className="text-muted-foreground ml-2">({item.lotNumarasi})</span>
                                              </div>
                                              <span className="font-mono text-muted-foreground flex-shrink-0">{item.seriNumarasi}</span>
                                          </li>
                                      ))}
                                  </ul>
                              )}
                          </ScrollArea>
                      </CardContent>
                  </Card>
              </div>
            </div>
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => router.push(`/urun-talep`)} className="w-full sm:w-auto">
              <ClipboardPlus className="mr-2 h-4 w-4" /> Ürün Talep
            </Button>
            <Button variant="outline" onClick={() => router.push('/tuketim-istatistikleri')} className="w-full sm:w-auto">
                <TrendingUp className="mr-2 h-4 w-4"/> Tüketim İstatistikleri
            </Button>
        </CardFooter>
      </Card>
      
      <Card className="bg-gradient-to-br from-slate-900/40 to-black/20 border-white/10">
        <CardContent className="pt-6">
          {selectedLabId && (
            devicesToDisplay.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6 w-full">
                {devicesToDisplay.map((c) => (
                  <button
                    key={c.id}
                    className="group relative w-full outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-center transition-transform hover:scale-105"
                    onClick={() => {
                      const event = new CustomEvent('openDeviceFaultModal', { detail: c });
                      window.dispatchEvent(event);
                    }}
                    title={`${c.cihazAdi || c.model || ''} • ${c.seriNumarasi || ''}`}
                  >
                    <div className="text-center mb-2">
                      <div className="text-sm font-medium leading-tight truncate px-1">{c.cihazAdi || c.model}</div>
                      <div className="text-xs text-white/60 font-mono truncate">{c.seriNumarasi || '-'}</div>
                    </div>
                    <div className="relative w-full aspect-square bg-white/5 rounded-lg flex items-center justify-center overflow-hidden border border-white/5 group-hover:border-primary/30">
                      <Image
                        src={c.imageUrl ? (c.imageUrl.startsWith('/') ? c.imageUrl : `/${c.imageUrl}`) : '/lab_diorama.png'}
                        alt={c.cihazAdi || c.model || 'Device'}
                        fill
                        className="object-contain p-2"
                        sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 20vw"
                        priority={false}
                        onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.srcset = '/lab_diorama.png'; 
                            target.src = '/lab_diorama.png';
                        }}
                      />
                      <div
                        className={cn(
                          "absolute bottom-0 w-full h-1",
                          (c.arizaDurumu !== 'yok') ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]'
                        )}
                      />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-white/40 space-y-2">
                <Info className="w-10 h-10 mb-2 opacity-20" />
                <p>Bu laboratuvara tanımlı cihaz bulunamadı.</p>
                <p className="text-xs">Cihaz Yönetimi panelinden cihaz ekleyebilirsiniz.</p>
              </div>
            )
          )}
        </CardContent>
      </Card>
      
      <Dialog open={isCameraScannerOpen} onOpenChange={setIsCameraScannerOpen}>
        <DialogContent className="max-w-xl p-0">
          <DialogHeader className="p-4 pb-0"><DialogTitle>Kamera ile Ürün Kullanımı Tara</DialogTitle></DialogHeader>
          {isCameraScannerOpen && (
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Kamera Yükleniyor...</p></div>}>
              <DynamicCameraBarcodeScanner
                onScanSuccess={handleCameraScanSuccess}
                onClose={() => setIsCameraScannerOpen(false)}
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
      
      <Dialog open={faultModalOpen} onOpenChange={setFaultModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arıza Kaydı: {selectedDevice?.cihazAdi}</DialogTitle>
            <DialogDescription>SN: {selectedDevice?.seriNumarasi}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <Input
              placeholder="Arıza açıklaması (opsiyonel)"
              value={faultDescription}
              onChange={(e) => setFaultDescription(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-4">
              <Button variant="outline" onClick={() => handleFaultReport('teknik_servis')} disabled={isSavingFault}>{isSavingFault ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}<span className="ml-2">Teknik Servis</span></Button>
              <Button variant="outline" onClick={() => handleFaultReport('aplikasyon')} disabled={isSavingFault}>{isSavingFault ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}<span className="ml-2">Aplikasyon</span></Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isTrashBinModalOpen} onOpenChange={setIsTrashBinModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Trash2 className="mr-2 h-5 w-5 text-destructive" />
              Çöp Kutusu - Ürün Ekleme
            </DialogTitle>
            <DialogDescription>
              Çöpe atılacak ürünleri cihaz seçerek veya manuel olarak ekleyin.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-6">
            {/* Device selection */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Cihaz Seçin</Label>
              <p className="text-xs text-muted-foreground mb-3">
                Ürün eklemek için önce bir cihaz seçin
              </p>
              {devicesToDisplay.length > 0 ? (
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                  {devicesToDisplay.map((device) => (
                    <button
                      key={device.id}
                      type="button"
                      onClick={() => setSelectedTrashDevice(device)}
                      className={cn(
                        "group relative w-full outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-center transition-all",
                        selectedTrashDevice?.id === device.id
                          ? "scale-105 ring-2 ring-primary"
                          : "hover:scale-105"
                      )}
                    >
                      <div className="text-center mb-1">
                        <div className="text-xs font-medium leading-tight truncate px-1">
                          {device.cihazAdi || device.model}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {device.seriNumarasi || '-'}
                        </div>
                      </div>
                      <div className={cn(
                        "relative w-full aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden border-2 transition-colors",
                        selectedTrashDevice?.id === device.id
                          ? "border-primary bg-primary/10"
                          : "border-border group-hover:border-primary/30"
                      )}>
                        <Image
                          src={device.imageUrl ? (device.imageUrl.startsWith('/') ? device.imageUrl : `/${device.imageUrl}`) : '/lab_diorama.png'}
                          alt={device.cihazAdi || device.model || 'Device'}
                          fill
                          className="object-contain p-1"
                          sizes="(max-width: 768px) 33vw, 20vw"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.srcset = '/lab_diorama.png';
                            target.src = '/lab_diorama.png';
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-6 bg-muted rounded-lg">
                  <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Bu laboratuvara tanımlı cihaz bulunamadı.</p>
                </div>
              )}
            </div>

            {/* Product selection form - shown after device selection */}
            {selectedTrashDevice && (
              <div className="border-t pt-6 space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium">
                      Seçilen Cihaz: {selectedTrashDevice.cihazAdi || selectedTrashDevice.model}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      SN: {selectedTrashDevice.seriNumarasi}
                    </p>
                  </div>
                </div>

                {/* Manuel product selection */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium mb-2 block">Ürün Seçin</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between font-normal"
                        >
                          {selectedTrashProduct
                            ? products.find((p) => p.stokKodu === selectedTrashProduct)?.stokAdi
                            : "Ürün seçin..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0">
                        <Command>
                          <CommandInput placeholder="Ürün ara..." />
                          <CommandList>
                            <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                            <CommandGroup>
                              {(() => {
                                const filtered = products.filter(p => {
                                  // Filter products with min/max stock levels defined in lab management
                                  const rule = minMaxRules.find(r => r.stokKodu === p.stokKodu);
                                  // Only show products with min/max values defined (check for both null and undefined)
                                  return rule && (rule.minStock != null || rule.maxStock != null);
                                });
                                console.log('🗑️ Çöp Kutusu Debug:', {
                                  selectedLabId,
                                  totalProducts: products.length,
                                  totalMinMaxRules: minMaxRules.length,
                                  minMaxRulesWithValues: minMaxRules.filter(r => r.minStock != null || r.maxStock != null).length,
                                  filteredProducts: filtered.length,
                                  sampleRule: minMaxRules[0]
                                });
                                return filtered;
                              })()
                                .sort((a, b) => (a.stokAdi || '').localeCompare(b.stokAdi || ''))
                                .map((product) => (
                                  <CommandItem
                                    key={product.id}
                                    value={product.stokAdi || ''}
                                    onSelect={() => {
                                      setSelectedTrashProduct(product.stokKodu || '');
                                      // Set default remaining tests to package quantity
                                      setTrashRemainingTests(product.ambalajDegeri || 0);
                                    }}
                                  >
                                    <Check className={cn("mr-2 h-4 w-4", selectedTrashProduct === product.stokKodu ? "opacity-100" : "opacity-0")} />
                                    <div className="flex flex-col">
                                      <span>{product.stokAdi}</span>
                                      <span className="text-xs text-muted-foreground">{product.stokKodu}</span>
                                    </div>
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {selectedTrashProduct && (
                    <div>
                      <Label htmlFor="remaining-tests" className="text-sm font-medium mb-2 block">
                        Kalan Test Adeti
                      </Label>
                      <Input
                        id="remaining-tests"
                        type="number"
                        min="0"
                        value={trashRemainingTests}
                        onChange={(e) => setTrashRemainingTests(Number(e.target.value))}
                        placeholder="Kalan test adedini girin"
                      />
                    </div>
                  )}

                  {selectedTrashProduct && (
                    <Button
                      onClick={() => {
                        const product = products.find(p => p.stokKodu === selectedTrashProduct);
                        if (product) {
                          setTrashItems(prev => [...prev, {
                            id: Math.random().toString(36).substr(2, 9),
                            productCode: product.stokKodu || '',
                            productName: product.stokAdi || '',
                            remainingTests: trashRemainingTests,
                          }]);
                          setSelectedTrashProduct('');
                          setTrashRemainingTests(0);
                        }
                      }}
                      className="w-full"
                    >
                      <ClipboardPlus className="h-4 w-4 mr-2" />
                      Listeye Ekle
                    </Button>
                  )}

                  {/* Display added items */}
                  {trashItems.length > 0 && (
                    <div className="border rounded-lg p-4 space-y-2">
                      <Label className="text-sm font-medium">Eklenecek Ürünler ({trashItems.length})</Label>
                      <ScrollArea className="h-32">
                        <div className="space-y-2">
                          {trashItems.map((item) => (
                            <div key={item.id} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                              <div className="flex-1">
                                <p className="font-medium">{item.productName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.productCode} • Kalan Test: {item.remainingTests}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setTrashItems(prev => prev.filter(i => i.id !== item.id))}
                              >
                                <XCircle className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsTrashBinModalOpen(false);
              setSelectedTrashDevice(null);
              setTrashItems([]);
              setSelectedTrashProduct('');
              setTrashRemainingTests(0);
            }}>
              İptal
            </Button>
            {trashItems.length > 0 && (
              <Button onClick={handleTrashBinSubmit}>
                <Trash2 className="h-4 w-4 mr-2" />
                Çöpe Gönder ({trashItems.length})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isManualDeductionOpen} onOpenChange={setIsManualDeductionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manuel Stok Düşüm</DialogTitle>
            <DialogDescription>Listeden ürün seçerek stoktan düşün.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
              <div>
                <Label>Ürün</Label>
                <Select value={manualProductCode} onValueChange={setManualProductCode}>
                    <SelectTrigger><SelectValue placeholder="Ürün seçin..." /></SelectTrigger>
                    <SelectContent>{manualDeductionAvailableProducts.map(p => (<SelectItem key={p.id} value={p.stokKodu ?? ''}>{p.stokAdi}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Lot / Miad</Label>
                <Select value={manualLotKey} onValueChange={setManualLotKey} disabled={!manualProductCode}>
                    <SelectTrigger><SelectValue placeholder="Lot seçin..." /></SelectTrigger>
                    <SelectContent>{manualDeductionLotOptions.map(opt => (<SelectItem key={opt.key} value={opt.key}>{opt.label} ({opt.count})</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div>
                  <Label>Adet</Label>
                  <Input type="number" value={manualQuantity} onChange={e => setManualQuantity(Number(e.target.value))} min={1}/>
              </div>
          </div>
          <DialogFooter>
            <Button onClick={handleManualDeduction}>Düşüm Yap</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
