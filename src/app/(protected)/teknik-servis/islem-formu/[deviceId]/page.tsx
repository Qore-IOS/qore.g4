'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, addDoc, serverTimestamp, query, getDocs, where, orderBy, updateDoc, Timestamp, writeBatch, setDoc, deleteDoc } from 'firebase/firestore';
import type { Device, Hospital, ProductCode, User, MaintenancePlan, MaintenanceLog, PersonalStockItem, PeriodicPartChange, PeriodicPartChangeLog, MaintenancePeriodUnit, FaultDefinition, DraftActionLog, PoolWarehouseStockItem, Depot, DeviceLabPool, YedekParcaDepoStokItem } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Wrench, ClipboardList, Trash2, Save, History, Search, Plus, Settings, Cog, FileText, Camera, ImageIcon, X, Package, AlertTriangle, Clock, PauseCircle, ChevronLeft, Building2 } from 'lucide-react';
import Image from 'next/image';
import { resolveImageSrc } from '@/lib/image-utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import TeknikServisTutanakPDFButton from '@/components/exports/TeknikServisTutanakPDFButton';
import SignaturePad from '@/components/SignaturePad';
import type { SignaturePadRef } from '@/components/SignaturePad';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Textarea } from '@/components/ui/textarea';
import WizardFormShell, { haptic } from '@/components/islem-formu/WizardFormShell';
import type { WizardHeading } from '@/components/islem-formu/WizardFormShell';
import { buildDepotSelectableItems, type DepotSelectableStockItem } from '@/lib/spare-part-depot';
import { filterByCompanyScope } from '@/lib/company-scope';

// Operation types (Yapılan İşlem)
type OperationType =
  | 'genel_temizlik_yaglama'
  | 'temel_fonksiyon_testleri'
  | 'mekanik_ayarlar_kontrol'
  | 'optik_ayarlar_kontrol'
  | 'pipetleme_transfer_ayarlari';

// İşlem Tipi
type IslemTipi = 'cihaz' | 'ups' | 'su_sistemi' | '';

// İşlem Türü
type IslemTuru = 'rutin_kurum_ziyareti' | 'periyodik_bakim' | 'cihaz_kurulumu' | 'ariza' | 'sw_update' | 'alis' | 'roche_bilgisayar_arizasi' | '';

// Cihaz Durumu
type CihazDurumu = 'calisiyor' | 'arizali' | 'denemede' | 'diger' | '';

type ActionItem = {
  id: string;
  type: 'part_change' | 'operation' | 'hucre_degisimi';
  action: string;
  stokKodu?: string;
  stokAdi?: string;
  anaBirim?: string;
  quantity: number;
  description?: string;
  isManualEntry?: boolean;
  // Personal stock info for part changes
  personalStockId?: string;
  poolStockId?: string; // Pool warehouse stock item ID (if from pool)
  depotStockId?: string;
  assignedDeviceId?: string; // For lab mode: Which device is this assigned to
  isDepotSelection?: boolean;
  poolWarehouseId?: string;
  poolWarehouseName?: string;
  serialNumber?: string;
  hucreNumarasi?: string;           // Hücre numarası (takılan)
  removedHucreNumarasi?: string;    // Çıkan hücre numarası
  channelSelections?: ('CH1' | 'CH2')[];
  // Removed/replaced part info (from device)
  removedPartStokKodu?: string;
  removedPartStokAdi?: string;
  removedPartSerialNumber?: string;
  removedPartImageUrl?: string;
  usedPartImageUrl?: string;
  // Periodic part change info
  periodicPartChangeId?: string;
  isPeriodicPartChange?: boolean;
};

type HucreDegisimiDraftRow = {
  id: string;
  stockSourceTab: 'personal' | 'depot';
  selectedPersonalItem: PersonalStockItem | null;
  selectedDepotItem: DepotSelectableStockItem | null;
  searchQuery: string;
  removedHucreNumarasi: string;
  description: string;
  selectedChannel?: 'CH1' | 'CH2';
  assignedDeviceId?: string; // For lab mode
};

type ActionFormRecord = {
    id: string;
    createdAt: { toDate: () => Date };
    createdByName: string;
    actions: ActionItem[];
    islemTipi?: IslemTipi;
    islemTuru?: IslemTuru;
    cihazDurumu?: CihazDurumu;
    cihazDurumuAciklama?: string;
    eslikEdenPersonel?: { uid: string; name: string; role: string }[];
    personnelSignature?: string;
    technicianSignature?: string;
};

const OPERATION_LABELS: Record<OperationType, string> = {
  genel_temizlik_yaglama: 'Genel Temizlik & Yağlama',
  temel_fonksiyon_testleri: 'Temel Fonksiyon Testleri',
  mekanik_ayarlar_kontrol: 'Mekanik Ayarlar & Kontrol',
  optik_ayarlar_kontrol: 'Optik Ayarlar & Kontrol',
  pipetleme_transfer_ayarlari: 'Pipetleme / Transfer Ayarları & Kontrol',
};

const ALL_OPERATIONS: OperationType[] = [
  'genel_temizlik_yaglama',
  'temel_fonksiyon_testleri',
  'mekanik_ayarlar_kontrol',
  'optik_ayarlar_kontrol',
  'pipetleme_transfer_ayarlari',
];

const ISLEM_TIPI_LABELS: Record<IslemTipi, string> = {
  '': 'Seçiniz',
  cihaz: 'Cihaz',
  ups: 'UPS',
  su_sistemi: 'Su Sistemi',
};

const ISLEM_TURU_LABELS: Record<IslemTuru, string> = {
  '': 'Seçiniz',
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  cihaz_kurulumu: 'Cihaz Kurulumu',
  ariza: 'Arıza',
  sw_update: 'SW Update',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};

const CIHAZ_DURUMU_LABELS: Record<CihazDurumu, string> = {
  '': 'Seçiniz',
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

export default function IslemFormuPage() {
  const params = useParams();
  const routeDeviceId = params ? (Array.isArray(params.deviceId) ? params.deviceId[0] : params.deviceId as string) : '';
  const isLabModeRoute = routeDeviceId.startsWith('lab-');
  const actualDeviceId = isLabModeRoute ? '' : routeDeviceId;
  const labHospitalId = isLabModeRoute ? routeDeviceId.replace('lab-', '') : '';
  const deviceId = routeDeviceId;

  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdFromUrl = searchParams?.get('draftId') || null;
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [isLabMode, setIsLabMode] = useState(isLabModeRoute);
  const [devicesByLab, setDevicesByLab] = useState<Device[]>([]); // Added for lab mode
  const [device, setDevice] = useState<Device | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [draftActionLogs, setDraftActionLogs] = useState<DraftActionLog[]>([]);

  // İşlem Tipi ve Türü
  const [islemTipi, setIslemTipi] = useState<IslemTipi>('');
  const [islemTuru, setIslemTuru] = useState<IslemTuru>('');
  const [aciklama, setAciklama] = useState('');

  // Başlangıç ve Bitiş Saatleri/Tarihleri (Zorunlu)
  const [baslangicSaati, setBaslangicSaati] = useState<string>('');
  const [bitisSaati, setBitisSaati] = useState<string>('');
  const [baslangicTarihi, setBaslangicTarihi] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [bitisTarihi, setBitisTarihi] = useState<string>(format(new Date(), 'yyyy-MM-dd'));


  // Signature modal
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [signatureStep, setSignatureStep] = useState<'pre_questions' | 'personnel' | 'technician'>('pre_questions');
  const personnelSignatureRef = useRef<SignaturePadRef>(null);
  const technicianSignatureRef = useRef<SignaturePadRef>(null);
  const [signatures, setSignatures] = useState<{ personnel?: string; technician?: string }>({});
  const [technicianName, setTechnicianName] = useState('');

  // Pre-signature questions
  const [cihazDurumu, setCihazDurumu] = useState<CihazDurumu>('');
  const [cihazDurumuAciklama, setCihazDurumuAciklama] = useState('');
  const [eslikEdenPersonel, setEslikEdenPersonel] = useState<{ uid: string; name: string; role: string }[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [personelSearchQuery, setPersonelSearchQuery] = useState('');

  // Operation selection modal
  const [isOperationModalOpen, setIsOperationModalOpen] = useState(false);
  const [selectedOperations, setSelectedOperations] = useState<OperationType[]>([]);

  // Part selection modal - now using personal stock + pool stock
  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [partAssignedDeviceId, setPartAssignedDeviceId] = useState<string>('');
  const [personalStock, setPersonalStock] = useState<PersonalStockItem[]>([]);
  const [poolStockItems, setPoolStockItems] = useState<PoolWarehouseStockItem[]>([]);
  const [depotStockItems, setDepotStockItems] = useState<YedekParcaDepoStokItem[]>([]);
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const [selectedStockItem, setSelectedStockItem] = useState<PersonalStockItem | null>(null);
  const [selectedPoolStockItem, setSelectedPoolStockItem] = useState<PoolWarehouseStockItem | null>(null);
  const [selectedDepotStockItem, setSelectedDepotStockItem] = useState<DepotSelectableStockItem | null>(null);
  const [pendingDepotStockItem, setPendingDepotStockItem] = useState<DepotSelectableStockItem | null>(null);
  const [depotRequestedQuantity, setDepotRequestedQuantity] = useState(1);
  const [isDepotQuantityDialogOpen, setIsDepotQuantityDialogOpen] = useState(false);
  const [stockSourceTab, setStockSourceTab] = useState<'personal' | 'pool' | 'depot'>('personal');
  const [manualPartCode, setManualPartCode] = useState('');
  const [manualPartName, setManualPartName] = useState('');
  const [manualSerialNumber, setManualSerialNumber] = useState('');
  const [partQuantity, setPartQuantity] = useState(1);
  const [showManualEntry, setShowManualEntry] = useState(false);
  // Removed part info (cihazdan çıkan parça)
  const [removedPartStokKodu, setRemovedPartStokKodu] = useState('');
  const [removedPartStokAdi, setRemovedPartStokAdi] = useState('');
  const [removedPartSerialNumber, setRemovedPartSerialNumber] = useState('');
  // Removed part image
  const [removedPartImageFile, setRemovedPartImageFile] = useState<File | null>(null);
  const [removedPartImagePreview, setRemovedPartImagePreview] = useState<string | null>(null);
  // Used part image
  const [usedPartImageFile, setUsedPartImageFile] = useState<File | null>(null);
  const [usedPartImagePreview, setUsedPartImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const removedPartImageInputRef = useRef<HTMLInputElement>(null);
  const usedPartImageInputRef = useRef<HTMLInputElement>(null);

  // Hücre değişimi state
  const [isHucreDegisimiModalOpen, setIsHucreDegisimiModalOpen] = useState(false);
  const [showHucreDegisimiInIslemTuru, setShowHucreDegisimiInIslemTuru] = useState(false);
  const [hucreDegisimiRows, setHucreDegisimiRows] = useState<HucreDegisimiDraftRow[]>([
    {
      id: `hucre_row_${Date.now()}`,
      stockSourceTab: 'personal',
      selectedPersonalItem: null,
      selectedDepotItem: null,
      searchQuery: '',
      removedHucreNumarasi: '',
      description: '',
    },
  ]);

  // Maintenance plans for periyodik bakım
  const [maintenancePlans, setMaintenancePlans] = useState<MaintenancePlan[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);
  const [selectedMaintenanceTasks, setSelectedMaintenanceTasks] = useState<string[]>([]);

  // Periodic part changes for periyodik bakım
  const [periodicPartChanges, setPeriodicPartChanges] = useState<PeriodicPartChange[]>([]);
  const [periodicPartChangeLogs, setPeriodicPartChangeLogs] = useState<PeriodicPartChangeLog[]>([]);
  const [selectedPeriodicParts, setSelectedPeriodicParts] = useState<string[]>([]);
  const [pendingPeriodicPartChangeId, setPendingPeriodicPartChangeId] = useState<string | null>(null);
  const [isAutoStockConfirmOpen, setIsAutoStockConfirmOpen] = useState(false);
  const [autoStockPendingPartId, setAutoStockPendingPartId] = useState<string | null>(null);
  const [isAutoStockCreating, setIsAutoStockCreating] = useState(false);

  // Fault definitions for arıza
  const [faultDefinitions, setFaultDefinitions] = useState<FaultDefinition[]>([]);
  const [selectedFaultId, setSelectedFaultId] = useState<string>('');
  const [customFaultName, setCustomFaultName] = useState<string>('');

  // Test selection for arıza
  const [availableTests, setAvailableTests] = useState<string[]>([]);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  // Fetch device and hospital
  useEffect(() => {
    if (!actualDeviceId && !labHospitalId) return;
    setLoading(true);
    (async () => {
      try {
        if (isLabMode && labHospitalId) {
          const hospitalSnap = await getDoc(doc(db, 'hospitals', labHospitalId));
          if (hospitalSnap.exists()) {
             setHospital({ id: hospitalSnap.id, ...hospitalSnap.data() } as Hospital);
          } else {
             toast({ title: 'Hata', description: 'Hastane bulunamadı.', variant: 'destructive' });
             router.back();
             return;
          }

          // Fetch all devices for this hospital
          const qDevices = query(collection(db, 'devices'), where('hospitalId', '==', labHospitalId));
          const devicesSnap = await getDocs(qDevices);
          const list = devicesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Device));
          const sortedList = list.sort((a, b) => (String(a.order ?? 99)).localeCompare(String(b.order ?? 99)));
          setDevicesByLab(sortedList);
          if (sortedList.length > 0) {
            setDevice(sortedList[0]);
          }

        } else if (actualDeviceId) {
          const deviceSnap = await getDoc(doc(db, 'devices', actualDeviceId));
          if (!deviceSnap.exists()) {
            toast({ title: 'Hata', description: 'Cihaz bulunamadı.', variant: 'destructive' });
            router.back();
            return;
          }
          const deviceData = { id: deviceSnap.id, ...deviceSnap.data() } as Device;
          setDevice(deviceData);
  
          if (deviceData.hospitalId) {
            const hospitalSnap = await getDoc(doc(db, 'hospitals', deviceData.hospitalId));
            if (hospitalSnap.exists()) {
              setHospital({ id: hospitalSnap.id, ...hospitalSnap.data() } as Hospital);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching data:", err);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    })();
  }, [actualDeviceId, labHospitalId, isLabMode, router, toast]);

  // Load draft if draftId is in URL
  useEffect(() => {
    if (!draftIdFromUrl) return;
    if (!actualDeviceId && !labHospitalId) return;
    (async () => {
      try {
        const draftSnap = await getDoc(doc(db, 'draftActionForms', draftIdFromUrl));
        if (draftSnap.exists()) {
          const draftData = draftSnap.data();
          setCurrentDraftId(draftIdFromUrl);
          if (draftData.actions) setActions(draftData.actions);
          if (draftData.islemTipi) setIslemTipi(draftData.islemTipi);
          if (draftData.islemTuru) setIslemTuru(draftData.islemTuru as IslemTuru);
          if (draftData.aciklama) setAciklama(draftData.aciklama);
          if (draftData.baslangicSaati) setBaslangicSaati(draftData.baslangicSaati);
          if (draftData.bitisSaati) setBitisSaati(draftData.bitisSaati);
          if (draftData.baslangicTarihi) setBaslangicTarihi(draftData.baslangicTarihi);
          if (draftData.bitisTarihi) setBitisTarihi(draftData.bitisTarihi);
          if (draftData.selectedMaintenanceTasks) setSelectedMaintenanceTasks(draftData.selectedMaintenanceTasks);
          if (draftData.selectedPeriodicParts) setSelectedPeriodicParts(draftData.selectedPeriodicParts);
          if (draftData.selectedFaultId) setSelectedFaultId(draftData.selectedFaultId);
          if (draftData.selectedTests) setSelectedTests(draftData.selectedTests);
          if (draftData.actionLogs) setDraftActionLogs(draftData.actionLogs);

          // Add continuation log
          const continuationLog: DraftActionLog = {
            personnelUid: currentUserProfile?.uid || '',
            personnelName: currentUserProfile?.name || 'Bilinmeyen',
            timestamp: new Date(),
            logType: 'draft_continued',
            description: `${currentUserProfile?.name || 'Bilinmeyen'} ara kayıttan devam etti (önceki kayıt: ${draftData.createdByName})`,
          };
          setDraftActionLogs(prev => [...prev, continuationLog]);

          toast({ title: 'Ara Kayıt Yüklendi', description: `${draftData.createdByName} tarafından oluşturulan ara kayıt yüklendi.` });
        }
      } catch (err) {
        console.error('Error loading draft:', err);
      }
    })();
  }, [draftIdFromUrl, routeDeviceId, currentUserProfile?.uid, currentUserProfile?.name, toast]);


  // Fetch personal stock for current user
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    (async () => {
      try {
        const q = query(
          collection(db, 'personalStock'),
          where('ownerUid', '==', currentUserProfile.uid),
          where('status', '==', 'in_stock')
        );
        const snap = await getDocs(q);
        const items = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
          } as PersonalStockItem;
        });
        setPersonalStock(items);
      } catch (err) {
        console.error("Error fetching personal stock:", err);
      }
    })();
  }, [currentUserProfile?.uid]);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'yedekParcaDepoStok'));
        const items = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          } as YedekParcaDepoStokItem;
        });
        setDepotStockItems(filterByCompanyScope(items, currentCompanyId, isSuperAdmin));
      } catch (err) {
        console.error('Error fetching depot stock:', err);
      }
    })();
  }, [currentCompanyId, isSuperAdmin]);

  // Fetch pool warehouse stock for lab groups connected to this device's hospital
  useEffect(() => {
    if (!routeDeviceId && !labHospitalId) return;
    (async () => {
      try {
        // 1. Get hospitalId
        const hospitalId = isLabMode ? labHospitalId : (await getDoc(doc(db, 'devices', actualDeviceId))).data()?.hospitalId;
        if (!hospitalId) return;

        // 2. Get all device lab pools that include this hospital
        const poolsSnap = await getDocs(collection(db, 'deviceLabPools'));
        const matchingPoolIds: string[] = [];
        const companyScopedPools = filterByCompanyScope(
          poolsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as DeviceLabPool),
          currentCompanyId,
          isSuperAdmin
        );
        companyScopedPools.forEach((pool) => {
          if (pool.memberIds?.includes(hospitalId)) {
            matchingPoolIds.push(pool.id);
          }
        });
        if (matchingPoolIds.length === 0) return;

        // 3. Get pool warehouses linked to these lab groups
        const depotsSnap = await getDocs(collection(db, 'depots'));
        const poolWarehouseIds: string[] = [];
        const companyScopedDepots = filterByCompanyScope(
          depotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Depot),
          currentCompanyId,
          isSuperAdmin
        );
        companyScopedDepots.forEach((depot) => {
          if (depot.isPoolWarehouse && depot.linkedDeviceLabPoolIds?.some(id => matchingPoolIds.includes(id))) {
            poolWarehouseIds.push(depot.id);
          }
        });
        if (poolWarehouseIds.length === 0) return;

        // 4. Fetch pool stock from these warehouses
        const allPoolStock: PoolWarehouseStockItem[] = [];
        for (const pwId of poolWarehouseIds) {
          const stockQ = query(
            collection(db, 'poolWarehouseStock'),
            where('poolWarehouseId', '==', pwId),
            where('status', '==', 'in_stock')
          );
          const stockSnap = await getDocs(stockQ);
          stockSnap.docs.forEach(d => {
            const data = d.data();
            allPoolStock.push({
              id: d.id,
              ...data,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
            } as PoolWarehouseStockItem);
          });
        }
        setPoolStockItems(filterByCompanyScope(allPoolStock, currentCompanyId, isSuperAdmin));
      } catch (err) {
        console.error("Error fetching pool stock:", err);
      }
    })();
  }, [deviceId, currentCompanyId, isSuperAdmin]);

  // Fetch fault definitions for teknik servis
  useEffect(() => {
    (async () => {
      try {
        const q = query(
          collection(db, 'faultDefinitions'),
          where('type', '==', 'teknik_servis')
        );
        const snap = await getDocs(q);
        const faults = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
        })) as FaultDefinition[];
        setFaultDefinitions(faults);
      } catch (err) {
        console.error("Error fetching fault definitions:", err);
      }
    })();
  }, []);

  // Fetch available tests from hospital minMaxRules + productCodes
  useEffect(() => {
    if (!device?.hospitalId) return;
    (async () => {
      try {
        // Get minMaxRules for this hospital
        const minMaxSnap = await getDocs(
          collection(db, 'hospitals', device.hospitalId, 'minMaxRules')
        );
        const stokKodulari = minMaxSnap.docs.map(d => d.id);

        // Get all ProductCodes
        const productCodesSnap = await getDocs(collection(db, 'productCodes'));
        const testNames = new Set<string>();

        // Match products with rules and extract testAdi
        productCodesSnap.docs.forEach(d => {
          const data = d.data();
          if (stokKodulari.includes(data.stokKodu) && data.testAdi) {
            testNames.add(data.testAdi);
          }
        });

        setAvailableTests(Array.from(testNames).sort());
      } catch (err) {
        console.error("Error fetching available tests:", err);
      }
    })();
  }, [device?.hospitalId]);

  // Fetch users for accompanying personnel
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const users = filterByCompanyScope(
          snap.docs.map(d => ({ uid: d.id, ...d.data() }) as User),
          currentCompanyId,
          isSuperAdmin
        );
        // Teknik/Aplikasyon personellerinin tamamını göster
        setAllUsers(users.filter(u => u.role === 'teknik_servis' || u.role === 'aplikasyon'));
      } catch (err) {
        console.error("Error fetching users:", err);
      }
    })();
  }, [currentCompanyId, isSuperAdmin]);

  // Fetch maintenance plans and logs for this device
  useEffect(() => {
    if (!deviceId) return;
    (async () => {
      try {
        // Fetch teknik_servis maintenance plans for this device
        const plansQuery = query(
          collection(db, 'maintenancePlans'),
          where('deviceId', '==', deviceId),
          where('type', '==', 'teknik_servis')
        );
        const plansSnap = await getDocs(plansQuery);
        const plans = plansSnap.docs.map(d => ({ id: d.id, ...d.data() }) as MaintenancePlan);
        setMaintenancePlans(plans);

        // Fetch maintenance logs for this device
        const logsQuery = query(
          collection(db, 'maintenanceLogs'),
          where('deviceId', '==', deviceId),
          orderBy('completedAt', 'desc')
        );
        const logsSnap = await getDocs(logsQuery);
        const logs = logsSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : new Date(data.completedAt),
            nextDueDate: data.nextDueDate?.toDate ? data.nextDueDate.toDate() : new Date(data.nextDueDate),
          } as MaintenanceLog;
        });
        setMaintenanceLogs(logs);
      } catch (err) {
        console.error("Error fetching maintenance plans/logs:", err);
      }
    })();
  }, [deviceId]);

  // Fetch periodic part changes and logs for this device
  useEffect(() => {
    if (!deviceId) return;
    (async () => {
      try {
        // Fetch periodic part changes for teknik_servis or both
        const partsQuery = query(
          collection(db, 'periodicPartChanges'),
          where('deviceId', '==', deviceId)
        );
        const partsSnap = await getDocs(partsQuery);
        const allParts = partsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PeriodicPartChange);
        // Filter for teknik_servis or both responsibility
        const filteredParts = allParts.filter(p => p.responsibilityType === 'teknik_servis' || p.responsibilityType === 'both');
        setPeriodicPartChanges(filteredParts);

        // Fetch periodic part change logs for this device
        const logsQuery = query(
          collection(db, 'periodicPartChangeLogs'),
          where('deviceId', '==', deviceId)
        );
        const logsSnap = await getDocs(logsQuery);
        const logs = logsSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : new Date(data.completedAt),
            nextDueDate: data.nextDueDate?.toDate ? data.nextDueDate.toDate() : new Date(data.nextDueDate),
          } as PeriodicPartChangeLog;
        });
        setPeriodicPartChangeLogs(logs);
      } catch (err) {
        console.error("Error fetching periodic part changes:", err);
      }
    })();
  }, [deviceId]);

  // Sorted users based on current user's role
  const sortedUsers = useMemo(() => {
    const currentRole = currentUserProfile?.role;
    return [...allUsers].sort((a, b) => {
      // Current user's role type first
      if (currentRole === 'aplikasyon') {
        if (a.role === 'aplikasyon' && b.role !== 'aplikasyon') return -1;
        if (a.role !== 'aplikasyon' && b.role === 'aplikasyon') return 1;
      } else {
        if (a.role === 'teknik_servis' && b.role !== 'teknik_servis') return -1;
        if (a.role !== 'teknik_servis' && b.role === 'teknik_servis') return 1;
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [allUsers, currentUserProfile?.role]);

  // Filtered users for search
  const filteredUsers = useMemo(() => {
    if (!personelSearchQuery) return sortedUsers;
    const q = personelSearchQuery.toLowerCase();
    return sortedUsers.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  }, [sortedUsers, personelSearchQuery]);

  // IDs of stock items already used in current actions (to prevent duplicate adds)
  const usedPersonalStockIds = useMemo(() => {
    const ids = new Set<string>();
    actions.forEach(a => { if (a.personalStockId) ids.add(a.personalStockId); });
    return ids;
  }, [actions]);

  const usedPoolStockIds = useMemo(() => {
    const ids = new Set<string>();
    actions.forEach(a => { if (a.poolStockId) ids.add(a.poolStockId); });
    return ids;
  }, [actions]);

  // Filtered personal stock (excludes already-used items)
  const filteredStock = useMemo(() => {
    const available = personalStock.filter(p => !usedPersonalStockIds.has(p.id));
    if (!partSearchQuery) return available;
    const q = partSearchQuery.toLowerCase();
    return available.filter(p =>
      p.stokKodu.toLowerCase().includes(q) ||
      p.stokAdi.toLowerCase().includes(q) ||
      p.serialNumber.toLowerCase().includes(q)
    );
  }, [personalStock, partSearchQuery, usedPersonalStockIds]);

  const filteredPoolStock = useMemo(() => {
    const available = poolStockItems.filter(p => !usedPoolStockIds.has(p.id));
    if (!partSearchQuery) return available;
    const q = partSearchQuery.toLowerCase();
    return available.filter(p =>
      p.stokKodu.toLowerCase().includes(q) ||
      p.stokAdi.toLowerCase().includes(q) ||
      p.serialNumber.toLowerCase().includes(q)
    );
  }, [poolStockItems, partSearchQuery, usedPoolStockIds]);

  const selectableDepotStock = useMemo(
    () => buildDepotSelectableItems(depotStockItems),
    [depotStockItems]
  );

  const filteredDepotStock = useMemo(() => {
    const usedIds = new Set(actions.map((action) => action.depotStockId).filter(Boolean));
    const available = selectableDepotStock.filter((item) =>
      item.isGrouped ? true : !usedIds.has(item.id)
    );
    if (!partSearchQuery) return available;
    const q = partSearchQuery.toLowerCase();
    return available.filter((item) =>
      item.stokKodu.toLowerCase().includes(q) ||
      item.stokAdi.toLowerCase().includes(q) ||
      (item.serialNumber || '').toLowerCase().includes(q) ||
      (item.hucreNumarasi || '').toLowerCase().includes(q)
    );
  }, [actions, partSearchQuery, selectableDepotStock]);

  const selectableDepotHucreStock = useMemo(
    () => buildDepotSelectableItems(depotStockItems, { cellsOnly: true }),
    [depotStockItems]
  );

  const installedPartDefaults = useMemo(() => ({
    stokKodu: showManualEntry ? manualPartCode.trim() : (selectedStockItem?.stokKodu || selectedPoolStockItem?.stokKodu || selectedDepotStockItem?.stokKodu || ''),
    stokAdi: showManualEntry ? manualPartName.trim() : (selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || selectedDepotStockItem?.stokAdi || ''),
  }), [showManualEntry, manualPartCode, manualPartName, selectedStockItem, selectedPoolStockItem, selectedDepotStockItem]);

  useEffect(() => {
    setRemovedPartStokKodu(installedPartDefaults.stokKodu);
    setRemovedPartStokAdi(installedPartDefaults.stokAdi);
  }, [installedPartDefaults]);

  // Calculate maintenance status with remaining days
  const maintenanceTasksWithStatus = useMemo(() => {
    const periodUnitLabels: Record<string, string> = {
      hafta: 'hafta',
      ay: 'ay',
      yil: 'yıl',
    };

    return maintenancePlans.map(plan => {
      // Find the latest log for this plan
      const latestLog = maintenanceLogs.find(log => log.planId === plan.id);

      let daysRemaining: number | null = null;
      let isOverdue = false;
      let nextDueDate: Date | null = null;

      if (latestLog && latestLog.nextDueDate) {
        nextDueDate = latestLog.nextDueDate;
        const now = new Date();
        const diffTime = nextDueDate.getTime() - now.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isOverdue = daysRemaining < 0;
      }

      const periodLabel = `${plan.periodValue} ${periodUnitLabels[plan.periodUnit] || plan.periodUnit}`;

      return {
        plan,
        latestLog,
        daysRemaining,
        isOverdue,
        nextDueDate,
        periodLabel,
      };
    });
  }, [maintenancePlans, maintenanceLogs]);

  // Calculate periodic part change status with remaining days
  const periodicPartChangesWithStatus = useMemo(() => {
    const periodUnitLabels: Record<string, string> = {
      hafta: 'hafta',
      ay: 'ay',
      yil: 'yıl',
    };

    return periodicPartChanges.map(partChange => {
      // Find the latest log for this part change
      const latestLog = periodicPartChangeLogs.find(log => log.periodicPartChangeId === partChange.id);

      let daysRemaining: number | null = null;
      let isOverdue = false;
      let nextDueDate: Date | null = null;

      if (latestLog && latestLog.nextDueDate) {
        nextDueDate = latestLog.nextDueDate;
        const now = new Date();
        const diffTime = nextDueDate.getTime() - now.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isOverdue = daysRemaining < 0;
      } else if (partChange.nextDueDate) {
        // Use initial nextDueDate from part change definition when no log exists yet
        nextDueDate = partChange.nextDueDate?.toDate ? partChange.nextDueDate.toDate() : new Date(partChange.nextDueDate);
        const now = new Date();
        const diffTime = nextDueDate.getTime() - now.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isOverdue = daysRemaining < 0;
      }

      const periodLabel = partChange.periodDays
        ? `${partChange.periodDays} gün`
        : `${partChange.periodValue} ${periodUnitLabels[partChange.periodUnit] || partChange.periodUnit}`;

      return {
        partChange,
        latestLog,
        daysRemaining,
        isOverdue,
        nextDueDate,
        periodLabel,
      };
    });
  }, [periodicPartChanges, periodicPartChangeLogs]);

  // Toggle maintenance task selection
  const toggleMaintenanceTask = (planId: string) => {
    setSelectedMaintenanceTasks(prev =>
      prev.includes(planId) ? prev.filter(id => id !== planId) : [...prev, planId]
    );
  };


  const createAutoStockForPeriodicPart = async (partChange: PeriodicPartChange): Promise<PersonalStockItem | null> => {
  if (!currentUserProfile?.uid) {
    toast({ title: 'Hata', description: 'Kullanıcı bilgisi bulunamadı.', variant: 'destructive' });
    return null;
  }

  try {
    const now = new Date();
    const batch = writeBatch(db);

    const depotStockRef = doc(collection(db, 'yedekParcaDepoStok'));
    batch.set(depotStockRef, {
      productCodeId: partChange.productCodeId || '',
      stokKodu: partChange.stokKodu,
      stokAdi: partChange.stokAdi,
      anaBirim: partChange.anaBirim || 'Adet',
      serialNumber: '',
      quantity: 1,
      address: '',
      cihazGrubu: '',
      createdAt: Timestamp.fromDate(now),
      createdByUid: currentUserProfile.uid,
      createdByName: currentUserProfile.name || '',
    });

    const depoInLogRef = doc(collection(db, 'yedekParcaDepoLog'));
    batch.set(depoInLogRef, {
      action: 'stok_giris',
      productCodeId: partChange.productCodeId || '',
      stokKodu: partChange.stokKodu,
      stokAdi: partChange.stokAdi,
      anaBirim: partChange.anaBirim || 'Adet',
      serialNumber: '',
      quantity: 1,
      notes: `Periyodik parça değişimine istinaden otomatik stok girişi (${device?.cihazAdi || device?.model || ''})`,
      createdAt: Timestamp.fromDate(now),
      createdByUid: currentUserProfile.uid,
      createdByName: currentUserProfile.name || '',
    });

    batch.delete(depotStockRef);

    const personalStockRef = doc(collection(db, 'personalStock'));
    batch.set(personalStockRef, {
      ownerUid: currentUserProfile.uid,
      ownerName: currentUserProfile.name || '',
      productCodeId: partChange.productCodeId || '',
      stokKodu: partChange.stokKodu,
      stokAdi: partChange.stokAdi,
      anaBirim: partChange.anaBirim || 'Adet',
      serialNumber: '',
      source: 'depot',
      status: 'in_stock',
      createdAt: Timestamp.fromDate(now),
      transferredByUid: currentUserProfile.uid,
      transferredByName: currentUserProfile.name || '',
    });

    const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
    batch.set(transferLogRef, {
      action: 'transfer_to_personnel',
      personalStockId: personalStockRef.id,
      productCodeId: partChange.productCodeId || '',
      stokKodu: partChange.stokKodu,
      stokAdi: partChange.stokAdi,
      anaBirim: partChange.anaBirim || 'Adet',
      serialNumber: '',
      toUid: currentUserProfile.uid,
      toName: currentUserProfile.name || '',
      quantity: 1,
      createdAt: Timestamp.fromDate(now),
      createdByUid: currentUserProfile.uid,
      createdByName: currentUserProfile.name || '',
      notes: `Periyodik parça değişimine istinaden otomatik transfer (${device?.cihazAdi || device?.model || ''})`,
    });

    const depoOutLogRef = doc(collection(db, 'yedekParcaDepoLog'));
    batch.set(depoOutLogRef, {
      action: 'transfer_cikis',
      productCodeId: partChange.productCodeId || '',
      stokKodu: partChange.stokKodu,
      stokAdi: partChange.stokAdi,
      anaBirim: partChange.anaBirim || 'Adet',
      serialNumber: '',
      quantity: 1,
      relatedPersonnelUid: currentUserProfile.uid,
      relatedPersonnelName: currentUserProfile.name || '',
      notes: 'Periyodik parça değişimine istinaden otomatik transfer',
      createdAt: Timestamp.fromDate(now),
      createdByUid: currentUserProfile.uid,
      createdByName: currentUserProfile.name || '',
    });

    await batch.commit();

    const createdStock: PersonalStockItem = {
      id: personalStockRef.id,
      ownerUid: currentUserProfile.uid,
      ownerName: currentUserProfile.name || '',
      productCodeId: partChange.productCodeId || '',
      stokKodu: partChange.stokKodu,
      stokAdi: partChange.stokAdi,
      anaBirim: partChange.anaBirim || 'Adet',
      serialNumber: '',
      source: 'depot',
      status: 'in_stock',
      createdAt: now,
      transferredByUid: currentUserProfile.uid,
      transferredByName: currentUserProfile.name || '',
    };

    setPersonalStock(prev => [createdStock, ...prev]);
    return createdStock;
  } catch (err) {
    console.error('Error creating automatic stock for periodic part:', err);
    toast({ title: 'Hata', description: 'Otomatik stok girişi/transfer işlemi başarısız oldu.', variant: 'destructive' });
    return null;
  }
  };

  const findMatchingPersonalStockForPeriodicPart = (partChange: PeriodicPartChange): PersonalStockItem | undefined => {
    const normalize = (value?: string) => (value || '').trim().toLowerCase();
    const partCode = normalize(partChange.stokKodu);
    const partName = normalize(partChange.stokAdi);

    return personalStock.find(item => {
      if (item.status !== 'in_stock') return false;
      if (partChange.productCodeId && item.productCodeId && partChange.productCodeId === item.productCodeId) return true;
      if (normalize(item.stokKodu) === partCode) return true;
      return !!partName && normalize(item.stokAdi) === partName;
    });
  };

  const applyPeriodicPartSelectionWithStock = (
    partChangeId: string,
    partChange: PeriodicPartChange,
    matchingStockItem: PersonalStockItem
  ) => {
    if (!partChange.requiresSerialTracking && !partChange.requiresOutgoingPartInfo) {
      const newItem: ActionItem = {
        id: crypto.randomUUID(),
        type: 'part_change',
        action: matchingStockItem.productCodeId,
        stokKodu: matchingStockItem.stokKodu,
        stokAdi: matchingStockItem.stokAdi,
        serialNumber: matchingStockItem.serialNumber,
        personalStockId: matchingStockItem.id,
        quantity: 1,
        periodicPartChangeId: partChangeId,
        isPeriodicPartChange: true,
      };
      setActions(prev => [newItem, ...prev]);
      toast({ title: 'Parça Eklendi', description: `${matchingStockItem.stokAdi} değişen parçalar listesine otomatik eklendi.` });
      return;
    }

    setPendingPeriodicPartChangeId(partChangeId);
    setPartSearchQuery('');
    setManualPartCode('');
    setManualPartName('');
    setManualSerialNumber('');
    setPartQuantity(1);
    setRemovedPartStokKodu(partChange.stokKodu);
    setRemovedPartStokAdi(partChange.stokAdi);
    setRemovedPartSerialNumber('');
    setRemovedPartImageFile(null);
    setRemovedPartImagePreview(null);
    setUsedPartImageFile(null);
    setUsedPartImagePreview(null);
    setSelectedStockItem(matchingStockItem);
    setShowManualEntry(false);
    setPartSearchQuery(matchingStockItem.stokAdi);
    setIsPartModalOpen(true);
  };

  const handleAutoStockConfirm = async (confirmCreate: boolean) => {
    const pendingPartId = autoStockPendingPartId;
    const pendingPart = pendingPartId ? periodicPartChanges.find(p => p.id === pendingPartId) : null;
    if (!pendingPartId || !pendingPart) {
      setIsAutoStockConfirmOpen(false);
      setAutoStockPendingPartId(null);
      return;
    }

    if (!confirmCreate) {
      setSelectedPeriodicParts(prev => prev.filter(id => id !== pendingPartId));
      setIsAutoStockConfirmOpen(false);
      setAutoStockPendingPartId(null);
      toast({ title: 'İptal Edildi', description: 'Periyodik parça değişimi için stok oluşturma iptal edildi.' });
      return;
    }

    setIsAutoStockCreating(true);
    const autoCreatedStock = await createAutoStockForPeriodicPart(pendingPart);
    setIsAutoStockCreating(false);
    setIsAutoStockConfirmOpen(false);
    setAutoStockPendingPartId(null);

    if (!autoCreatedStock) {
      setSelectedPeriodicParts(prev => prev.filter(id => id !== pendingPartId));
      return;
    }

    toast({
      title: 'Stok Otomatik Eklendi',
      description: `${pendingPart.stokAdi} için depo giriş ve personel transfer kaydı otomatik oluşturuldu.`,
    });
    applyPeriodicPartSelectionWithStock(pendingPartId, pendingPart, autoCreatedStock);
  };

  // Toggle periodic part selection and add to actions
  const togglePeriodicPart = async (partChangeId: string) => {
    const isCurrentlySelected = selectedPeriodicParts.includes(partChangeId);

    if (isCurrentlySelected) {
      setSelectedPeriodicParts(prev => prev.filter(id => id !== partChangeId));
      setActions(prev => prev.filter(a => a.periodicPartChangeId !== partChangeId));
      return;
    }

    const partChange = periodicPartChanges.find(p => p.id === partChangeId);
    if (!partChange) return;

    const alreadyInActions = actions.some(a =>
      a.periodicPartChangeId === partChangeId ||
      (a.stokKodu === partChange.stokKodu && a.type === 'part_change')
    );

    setSelectedPeriodicParts(prev => [...prev, partChangeId]);
    if (alreadyInActions) return;

    const matchingStockItem = findMatchingPersonalStockForPeriodicPart(partChange);
    if (matchingStockItem) {
      applyPeriodicPartSelectionWithStock(partChangeId, partChange, matchingStockItem);
      return;
    }

    setAutoStockPendingPartId(partChangeId);
    setIsAutoStockConfirmOpen(true);
  };

  const openOperationModal = () => {
    setSelectedOperations([]);
    setIsOperationModalOpen(true);
  };

  const toggleOperation = (op: OperationType) => {
    setSelectedOperations(prev =>
      prev.includes(op) ? prev.filter(o => o !== op) : [...prev, op]
    );
  };

  const addSelectedOperations = () => {
    const newItems: ActionItem[] = selectedOperations.map(op => ({
      id: crypto.randomUUID(),
      type: 'operation' as const,
      action: op,
      quantity: 1,
    }));
    // Add to top of list
    setActions(prev => [...newItems, ...prev]);
    setIsOperationModalOpen(false);
    setSelectedOperations([]);
  };

  const openPartModal = () => {
    setPartSearchQuery('');
    setSelectedStockItem(null);
    setSelectedPoolStockItem(null);
    setSelectedDepotStockItem(null);
    setPendingDepotStockItem(null);
    setDepotRequestedQuantity(1);
    setIsDepotQuantityDialogOpen(false);
    setStockSourceTab('personal');
    setManualPartCode('');
    setManualPartName('');
    setManualSerialNumber('');
    setPartQuantity(1);
    setShowManualEntry(false);
    setRemovedPartStokKodu('');
    setRemovedPartStokAdi('');
    setRemovedPartSerialNumber('');
    setRemovedPartImageFile(null);
    setRemovedPartImagePreview(null);
    setPartAssignedDeviceId(actualDeviceId || '');
    setIsPartModalOpen(true);
  };

  const handleDepotItemSelect = (item: DepotSelectableStockItem) => {
    if (item.isGrouped && item.totalQuantity > 1) {
      setPendingDepotStockItem(item);
      setDepotRequestedQuantity(1);
      setIsDepotQuantityDialogOpen(true);
      return;
    }
    setPartQuantity(1);
    setSelectedDepotStockItem(item);
    setSelectedStockItem(null);
    setSelectedPoolStockItem(null);
  };

  const selectPersonalStockItem = (item: PersonalStockItem) => {
    setSelectedStockItem(item);
    setSelectedPoolStockItem(null);
    setSelectedDepotStockItem(null);
    setPendingDepotStockItem(null);
    setIsDepotQuantityDialogOpen(false);
  };

  const selectPoolStockItem = (item: PoolWarehouseStockItem) => {
    setSelectedPoolStockItem(item);
    setSelectedStockItem(null);
    setSelectedDepotStockItem(null);
    setPendingDepotStockItem(null);
    setIsDepotQuantityDialogOpen(false);
  };

  const activateManualEntry = () => {
    setShowManualEntry(true);
    setSelectedStockItem(null);
    setSelectedPoolStockItem(null);
    setSelectedDepotStockItem(null);
    setPendingDepotStockItem(null);
    setIsDepotQuantityDialogOpen(false);
  };

  const confirmDepotQuantitySelection = () => {
    if (!pendingDepotStockItem) return;
    const requestedQuantity = Math.max(1, Math.min(pendingDepotStockItem.totalQuantity, depotRequestedQuantity || 1));
    setPartQuantity(requestedQuantity);
    setSelectedDepotStockItem({ ...pendingDepotStockItem, totalQuantity: requestedQuantity });
    setSelectedStockItem(null);
    setSelectedPoolStockItem(null);
    setPendingDepotStockItem(null);
    setIsDepotQuantityDialogOpen(false);
  };

  const refreshDepotStock = async () => {
    const snap = await getDocs(collection(db, 'yedekParcaDepoStok'));
    const items = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
      } as YedekParcaDepoStokItem;
    });
    setDepotStockItems(items);
  };

  // Handle removed part image selection
  const handleRemovedPartImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRemovedPartImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setRemovedPartImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUsedPartImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUsedPartImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setUsedPartImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Upload removed part image to Firebase Storage with timeout
  const uploadPartImage = async (file: File, pathPrefix: 'removed-parts' | 'used-parts'): Promise<string | null> => {
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', pathPrefix);
      formData.append('deviceId', deviceId || 'unknown-device');

      const response = await fetch('/api/storage/upload-image', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Resim yüklenemedi.');
      }

      return payload.url as string;
    } catch (err: any) {
      console.error('Error uploading image:', err);
      const errorMessage = err?.message || 'Resim yüklenemedi.';
      toast({ title: 'Hata', description: errorMessage, variant: 'destructive' });
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  };

  const uploadRemovedPartImage = async (): Promise<string | null> => {
    if (!removedPartImageFile) return null;
    return uploadPartImage(removedPartImageFile, 'removed-parts');
  };

  const uploadUsedPartImage = async (): Promise<string | null> => {
    if (!usedPartImageFile) return null;
    return uploadPartImage(usedPartImageFile, 'used-parts');
  };

  const addSelectedPart = async () => {
    // Determine if this is for a periodic part with reduced requirements
    const pendingPeriodic = pendingPeriodicPartChangeId
      ? periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)
      : null;
    const needsSerialTracking = pendingPeriodic ? pendingPeriodic.requiresSerialTracking : true;

    // Upload images if provided
    let removedPartImageUrl: string | undefined = undefined;
    if (removedPartImageFile) {
      const uploadedUrl = await uploadRemovedPartImage();
      if (uploadedUrl) {
        removedPartImageUrl = uploadedUrl;
      }
    }

    let usedPartImageUrl: string | undefined = undefined;
    if (usedPartImageFile) {
      const uploadedUrl = await uploadUsedPartImage();
      if (uploadedUrl) {
        usedPartImageUrl = uploadedUrl;
      }
    }

    if (showManualEntry) {
      if (!manualPartCode.trim() || !manualPartName.trim()) {
        toast({ title: 'Eksik Bilgi', description: 'Lütfen parça kodu ve adını girin.', variant: 'destructive' });
        return;
      }
      if (needsSerialTracking && !manualSerialNumber.trim()) {
        toast({ title: 'Eksik Bilgi', description: 'Lütfen parça seri numarasını girin.', variant: 'destructive' });
        return;
      }

      // Check if this matches a periodic part change
      const matchingPeriodic = pendingPeriodicPartChangeId
        ? periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)
        : periodicPartChanges.find(p => p.stokKodu === manualPartCode.trim());

      const newItem: ActionItem = {
        id: crypto.randomUUID(),
        type: 'part_change',
        action: 'manual_part',
        stokKodu: manualPartCode.trim(),
        stokAdi: manualPartName.trim(),
        serialNumber: manualSerialNumber.trim(),
        quantity: partQuantity,
        isManualEntry: true,
        removedPartStokKodu: matchingPeriodic?.stokKodu || '',
        removedPartStokAdi: matchingPeriodic?.stokAdi || '',
        removedPartSerialNumber: removedPartSerialNumber.trim(),
        removedPartImageUrl,
        usedPartImageUrl,
        assignedDeviceId: isLabMode ? partAssignedDeviceId : actualDeviceId,
        periodicPartChangeId: matchingPeriodic?.id,
        isPeriodicPartChange: !!matchingPeriodic,
      };
      setActions(prev => [newItem, ...prev]);

      // If it matches a periodic part, add to selected periodic parts
      if (matchingPeriodic && !selectedPeriodicParts.includes(matchingPeriodic.id)) {
        setSelectedPeriodicParts(prev => [...prev, matchingPeriodic.id]);
        toast({
          title: 'Periyodik Değişim Algılandı',
          description: `${matchingPeriodic.stokAdi} periyodik değişim olarak kaydedilecek.`,
        });
      }
    } else if (selectedStockItem) {
      // Check if this matches a periodic part change
      const matchingPeriodic = pendingPeriodicPartChangeId
        ? periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)
        : periodicPartChanges.find(p => p.stokKodu === selectedStockItem.stokKodu);

      const newItem: ActionItem = {
        id: crypto.randomUUID(),
        type: 'part_change',
        action: selectedStockItem.productCodeId,
        stokKodu: selectedStockItem.stokKodu,
        stokAdi: selectedStockItem.stokAdi,
        anaBirim: selectedStockItem.anaBirim || 'Adet',
        serialNumber: selectedStockItem.serialNumber,
        personalStockId: selectedStockItem.id,
        quantity: 1, // Personal stock items are individual
        removedPartStokKodu: installedPartDefaults.stokKodu,
        removedPartStokAdi: installedPartDefaults.stokAdi,
        removedPartSerialNumber: removedPartSerialNumber.trim(),
        removedPartImageUrl,
        usedPartImageUrl,
        assignedDeviceId: isLabMode ? partAssignedDeviceId : actualDeviceId,
        periodicPartChangeId: matchingPeriodic?.id,
        isPeriodicPartChange: !!matchingPeriodic,
      };
      setActions(prev => [newItem, ...prev]);

      // If it matches a periodic part, add to selected periodic parts
      if (matchingPeriodic && !selectedPeriodicParts.includes(matchingPeriodic.id)) {
        setSelectedPeriodicParts(prev => [...prev, matchingPeriodic.id]);
        toast({
          title: 'Periyodik Değişim Algılandı',
          description: `${matchingPeriodic.stokAdi} periyodik değişim olarak kaydedilecek.`,
        });
      }
    } else if (selectedPoolStockItem) {
      const matchingPeriodic = pendingPeriodicPartChangeId
        ? periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)
        : periodicPartChanges.find(p => p.stokKodu === selectedPoolStockItem.stokKodu);

      const newItem: ActionItem = {
        id: crypto.randomUUID(),
        type: 'part_change',
        action: selectedPoolStockItem.productCodeId,
        stokKodu: selectedPoolStockItem.stokKodu,
        stokAdi: selectedPoolStockItem.stokAdi,
        anaBirim: selectedPoolStockItem.anaBirim || 'Adet',
        serialNumber: selectedPoolStockItem.serialNumber,
        poolStockId: selectedPoolStockItem.id,
        poolWarehouseId: selectedPoolStockItem.poolWarehouseId,
        poolWarehouseName: selectedPoolStockItem.poolWarehouseName,
        quantity: 1,
        removedPartStokKodu: installedPartDefaults.stokKodu,
        removedPartStokAdi: installedPartDefaults.stokAdi,
        removedPartSerialNumber: removedPartSerialNumber.trim(),
        removedPartImageUrl,
        usedPartImageUrl,
        assignedDeviceId: isLabMode ? partAssignedDeviceId : actualDeviceId,
        periodicPartChangeId: matchingPeriodic?.id,
        isPeriodicPartChange: !!matchingPeriodic,
      };
      setActions(prev => [newItem, ...prev]);

      if (matchingPeriodic && !selectedPeriodicParts.includes(matchingPeriodic.id)) {
        setSelectedPeriodicParts(prev => [...prev, matchingPeriodic.id]);
        toast({
          title: 'Periyodik Değişim Algılandı',
          description: `${matchingPeriodic.stokAdi} periyodik değişim olarak kaydedilecek.`,
        });
      }
    } else if (selectedDepotStockItem) {
      const matchingPeriodic = pendingPeriodicPartChangeId
        ? periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)
        : periodicPartChanges.find(p => p.stokKodu === selectedDepotStockItem.stokKodu);

      const newItem: ActionItem = {
        id: crypto.randomUUID(),
        type: 'part_change',
        action: selectedDepotStockItem.productCodeId,
        stokKodu: selectedDepotStockItem.stokKodu,
        stokAdi: selectedDepotStockItem.stokAdi,
        anaBirim: selectedDepotStockItem.anaBirim || 'Adet',
        serialNumber: selectedDepotStockItem.serialNumber,
        hucreNumarasi: selectedDepotStockItem.hucreNumarasi,
        depotStockId: selectedDepotStockItem.id,
        isDepotSelection: true,
        quantity: selectedDepotStockItem.isGrouped ? partQuantity : 1,
        removedPartStokKodu: matchingPeriodic?.stokKodu || '',
        removedPartStokAdi: matchingPeriodic?.stokAdi || '',
        removedPartSerialNumber: removedPartSerialNumber.trim(),
        removedPartImageUrl,
        usedPartImageUrl,
        assignedDeviceId: isLabMode ? partAssignedDeviceId : (actualDeviceId || ''),
        periodicPartChangeId: matchingPeriodic?.id,
        isPeriodicPartChange: !!matchingPeriodic,
      };
      setActions(prev => [newItem, ...prev]);

      if (matchingPeriodic && !selectedPeriodicParts.includes(matchingPeriodic.id)) {
        setSelectedPeriodicParts(prev => [...prev, matchingPeriodic.id]);
        toast({
          title: 'Periyodik Değişim Algılandı',
          description: `${matchingPeriodic.stokAdi} periyodik değişim olarak kaydedilecek.`,
        });
      }
    } else {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen şahsi stok, havuz stok veya depo stoktan bir parça seçin.', variant: 'destructive' });
      return;
    }
    setPendingPeriodicPartChangeId(null);
    setSelectedPoolStockItem(null);
    setSelectedStockItem(null);
    setSelectedDepotStockItem(null);
    setShowManualEntry(false);
    setManualPartCode(''); setManualPartName(''); setManualSerialNumber('');
    setRemovedPartSerialNumber('');
    setRemovedPartImageFile(null); setRemovedPartImagePreview(null);
    setUsedPartImageFile(null); setUsedPartImagePreview(null);
    setPartSearchQuery('');
    setIsPartModalOpen(false);
  };

  const removeActionRow = (id: string) => {
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const updateActionQuantity = (id: string, quantity: number) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, quantity } : a));
  };

  const toggleEslikEdenPersonel = (user: User) => {
    setEslikEdenPersonel(prev => {
      const exists = prev.find(p => p.uid === user.uid);
      if (exists) {
        return prev.filter(p => p.uid !== user.uid);
      }
      return [...prev, { uid: user.uid, name: user.name || user.email || '', role: user.role }];
    });
  };

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    try {
      const now = new Date();
      const draftId = currentDraftId || doc(collection(db, 'draftActionForms')).id;

      // Create action log for this draft save
      const newLog: DraftActionLog = {
        personnelUid: currentUserProfile?.uid || '',
        personnelName: currentUserProfile?.name || 'Bilinmeyen',
        timestamp: now,
        logType: 'draft_created',
        description: `${currentUserProfile?.name || 'Bilinmeyen'} ara kayıt oluşturdu`,
      };

      const updatedLogs = [...draftActionLogs, newLog];

      const draftData: any = {
        deviceId,
        hospitalId: device?.hospitalId || '',
        formType: 'teknik_servis',
        actions,
        islemTipi,
        islemTuru,
        aciklama: aciklama.trim(),
        baslangicSaati,
        bitisSaati,
        baslangicTarihi,
        bitisTarihi,
        selectedMaintenanceTasks,
        selectedPeriodicParts,
        selectedFaultId,
        selectedTests,
        actionLogs: updatedLogs.map(log => ({
          ...log,
          timestamp: Timestamp.fromDate(log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp)),
        })),
        updatedAt: Timestamp.fromDate(now),
        updatedByUid: currentUserProfile?.uid || '',
        updatedByName: currentUserProfile?.name || '',
      };

      if (!currentDraftId) {
        draftData.createdAt = Timestamp.fromDate(now);
        draftData.createdByUid = currentUserProfile?.uid || '';
        draftData.createdByName = currentUserProfile?.name || '';
      }

      await setDoc(doc(db, 'draftActionForms', draftId), draftData, { merge: true });
      setCurrentDraftId(draftId);
      setDraftActionLogs(updatedLogs);

      toast({ title: 'Ara Kayıt Kaydedildi', description: 'Form ara kayıt olarak kaydedildi. Daha sonra devam edebilirsiniz.' });
    } catch (err) {
      console.error('Error saving draft:', err);
      toast({ title: 'Hata', description: 'Ara kayıt kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const startSaveProcess = () => {
    // Validate başlangıç ve bitiş tarihleri ve saatleri (zorunlu)
    if (!baslangicTarihi) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen başlangıç tarihini seçin.', variant: 'destructive' });
      return;
    }
    if (!baslangicSaati) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen başlangıç saatini seçin.', variant: 'destructive' });
      return;
    }
    if (!bitisTarihi) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen bitiş tarihini seçin.', variant: 'destructive' });
      return;
    }
    if (!bitisSaati) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen bitiş saatini seçin.', variant: 'destructive' });
      return;
    }

    // Validate işlem tipi and türü
    if (!islemTipi) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen işlem tipini seçin.', variant: 'destructive' });
      return;
    }
    if (!islemTuru) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen işlem türünü seçin.', variant: 'destructive' });
      return;
    }

    // Validate fault selection when ariza is selected
    if (islemTuru === 'ariza' && !selectedFaultId) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tespit edilen arızayı seçin.', variant: 'destructive' });
      return;
    }
    if (islemTuru === 'ariza' && selectedFaultId === 'diger' && !customFaultName.trim()) {
      toast({ title: 'Eksik Bilgi', description: '"Diğer" arıza seçeneği için açıklama zorunludur.', variant: 'destructive' });
      return;
    }

    // Validate açıklama (zorunlu)
    if (!aciklama.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen açıklama alanını doldurun.', variant: 'destructive' });
      return;
    }

    // Validate part changes have quantity
    const invalidPart = actions.find(a => a.type === 'part_change' && a.quantity <= 0);
    if (invalidPart) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm parça değişimlerinde geçerli bir adet girin.', variant: 'destructive' });
      return;
    }

    // Reset pre-signature state
    setCihazDurumu('');
    setCihazDurumuAciklama('');
    setEslikEdenPersonel([]);
    setPersonelSearchQuery('');
    setSignatures({});
    setSignatureStep('pre_questions');
    setIsSignatureModalOpen(true);
  };

  const proceedToSignature = () => {
    // Validate cihaz durumu
    if (!cihazDurumu) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen cihaz durumunu seçin.', variant: 'destructive' });
      return;
    }
    if (cihazDurumu === 'diger' && !cihazDurumuAciklama.trim()) {
      toast({ title: 'Eksik Bilgi', description: '"Diğer" seçeneği için açıklama zorunludur.', variant: 'destructive' });
      return;
    }
    setSignatureStep('personnel');
  };


  const consumeDepotSelection = async (partChange: ActionItem, batch: any) => {
    const requestedQuantity = Math.max(1, partChange.quantity || 1);
    const consumedEntries: YedekParcaDepoStokItem[] = [];
    let remainingToConsume = requestedQuantity;

    if (partChange.depotStockId) {
      const depotRef = doc(db, 'yedekParcaDepoStok', partChange.depotStockId);
      const depotSnap = await getDoc(depotRef);
      if (depotSnap.exists()) {
        const depotData = depotSnap.data();
        const currentQty = depotData.quantity || 1;
        if (currentQty <= remainingToConsume) {
          batch.delete(depotRef);
          remainingToConsume -= currentQty;
        } else {
          batch.update(depotRef, { quantity: currentQty - remainingToConsume });
          remainingToConsume = 0;
        }
        consumedEntries.push({ id: depotSnap.id, ...depotData } as YedekParcaDepoStokItem);
      }
    }

    if (remainingToConsume > 0) {
      const q = query(
        collection(db, 'yedekParcaDepoStok'),
        where('stokKodu', '==', partChange.stokKodu),
        where('partCondition', '==', 'iyi'),
        orderBy('createdAt', 'asc')
      );
      const snapshot = await getDocs(q);
      for (const docSnap of snapshot.docs) {
        if (remainingToConsume <= 0) break;
        if (partChange.depotStockId === docSnap.id) continue;
        const data = docSnap.data();
        const available = data.quantity || 0;
        const toTake = Math.min(available, remainingToConsume);
        if (toTake > 0) {
          if (available === toTake) {
            batch.delete(docSnap.ref);
          } else {
            batch.update(docSnap.ref, { quantity: available - toTake });
          }
          consumedEntries.push({ ...data, id: docSnap.id, consumedQuantity: toTake } as any);
          remainingToConsume -= toTake;
        }
      }
    }

    if (consumedEntries.length === 0) {
      throw new Error(`${partChange.stokAdi} (${partChange.stokKodu}) için yeterli depo stoğu bulunamadı.`);
    }
    return consumedEntries[0];
  };

  const createDepotBorrowRecord = (partChange: ActionItem, depotEntry: YedekParcaDepoStokItem, batch: any, currentDevice: Device, formId: string, now: Date) => {
    const borrowedRef = doc(collection(db, 'borrowedSpareParts'));
    batch.set(borrowedRef, {
      productCodeId: partChange.action || depotEntry.productCodeId || '',
      stokKodu: partChange.stokKodu,
      stokAdi: partChange.stokAdi,
      anaBirim: partChange.anaBirim || depotEntry.anaBirim || 'Adet',
      serialNumber: partChange.serialNumber || depotEntry.serialNumber || '',
      hucreNumarasi: partChange.hucreNumarasi || depotEntry.hucreNumarasi || '',
      quantity: Math.max(1, partChange.quantity || 1),
      sourceType: 'depot',
      sourceActionType: partChange.type || 'part_change',
      depotStockId: depotEntry.id,
      deviceId: currentDevice.id,
      deviceName: currentDevice.cihazAdi || currentDevice.model || '',
      hospitalId: currentDevice.hospitalId || '',
      labName: hospital?.name || '',
      formId: formId,
      formType: 'teknik_servis',
      borrowedByUid: currentUserProfile?.uid || '',
      borrowedByName: currentUserProfile?.name || '',
      borrowedAt: Timestamp.fromDate(now),
      status: 'pending',
    });
  };

  const handleSaveSignaturesAndFinish = async (finalSignatures: { personnel?: string; technician?: string }, finalTechnicianName?: string) => {
    setIsSaving(true);
    setIsSignatureModalOpen(false);

    try {
        const now = new Date();
        const batch = writeBatch(db);
        const targetDevices = isLabMode ? devicesByLab : (device ? [device] : []);

        if (targetDevices.length === 0) {
          throw new Error('İşlem yapılacak cihaz bulunamadı.');
        }

        // Global side-effect tracking to avoid double updates in the same batch
        const processedPersonalStockIdsGlobal = new Set<string>();
        const processedPoolStockIdsGlobal = new Set<string>();

        // We'll collect all form IDs to show in the success toast
        const createdFormIds: string[] = [];

        for (const currentDevice of targetDevices) {
          const currentDeviceId = currentDevice.id;
          
          // Filter actions for this specific device
          // 'operation' types apply to all, others only if assigned to this device
          const deviceActions = actions.filter(a => 
            a.type === 'operation' || 
            a.assignedDeviceId === currentDeviceId ||
            (!isLabMode && a.type !== 'operation') // Fallback for single mode
          );

          // If lab mode and no actions for this device, skip creating a form for it
          // EXCEPT if it's a general maintenance/checkup where 'operation' items exist
          if (isLabMode && deviceActions.length === 0) continue;

          // Get selected maintenance plan details for this device
          // In lab mode, maintenance tasks are tricky because they are per plan ID of the initial device.
          // For now, if lab mode, we only apply maintenance tasks to the primary device or match by taskName if possible.
          // IMPROVEMENT: Fetch maintenance plans for each device in devicesByLab if needed.
          // For this first version, we'll only handle maintenance for the 'actualDeviceId' if in lab mode,
          // or we can skip it for others to avoid mismatching plan IDs.
          const isPrimaryDevice = currentDeviceId === actualDeviceId;
          const currentMaintenancePlans = isPrimaryDevice ? maintenancePlans : []; // Simplified for now
          
          const selectedMaintenancePlanDetails = currentMaintenancePlans
            .filter(p => selectedMaintenanceTasks.includes(p.id))
            .map(p => ({ id: p.id, taskName: p.taskName }));

          // Fault info
          const isCustomFault = selectedFaultId === 'diger';
          const selectedFault = islemTuru === 'ariza' && !isCustomFault ? faultDefinitions.find(f => f.id === selectedFaultId) : null;
          const resolvedFaultName = isCustomFault ? customFaultName.trim() : (selectedFault?.name || null);
          const resolvedFaultId = isCustomFault ? null : (selectedFault?.id || null);

          // Create form document
          const formRef = doc(collection(db, 'teknikServisActionForms'));
          createdFormIds.push(formRef.id);

          const formEntries = {
              deviceId: currentDeviceId,
              cihazAdi: currentDevice.cihazAdi || currentDevice.model,
              seriNumarasi: currentDevice.seriNumarasi,
              hospitalId: currentDevice.hospitalId,
              labName: hospital?.name,
              actions: deviceActions,
              islemTipi,
              islemTuru,
              aciklama: aciklama.trim(),
              baslangicSaati,
              bitisSaati,
              baslangicTarihi,
              bitisTarihi,
              cihazDurumu,
              cihazDurumuAciklama: cihazDurumu === 'diger' ? cihazDurumuAciklama : null,
              eslikEdenPersonel: eslikEdenPersonel.length > 0 ? eslikEdenPersonel : null,
              personnelSignature: finalSignatures.personnel || null,
              technicianSignature: finalSignatures.technician || null,
              technicianName: finalTechnicianName || null,
              createdAt: Timestamp.fromDate(now),
              createdByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
              createdByUid: currentUserProfile?.uid,
              formType: 'teknik_servis',
              selectedMaintenanceTasks: islemTuru === 'periyodik_bakim' ? selectedMaintenancePlanDetails : null,
              selectedFaultId: resolvedFaultId,
              selectedFaultName: resolvedFaultName,
              isCustomFault: isCustomFault || false,
              selectedTests: islemTuru === 'ariza' && selectedTests.length > 0 ? selectedTests : null,
              draftActionLogs: draftActionLogs.length > 0 ? draftActionLogs.map(log => ({
                ...log,
                timestamp: log.timestamp instanceof Date ? Timestamp.fromDate(log.timestamp) : log.timestamp,
              })) : null,
              continuedFromDraft: !!currentDraftId,
              isBulkLabForm: isLabMode,
          };

          batch.set(formRef, formEntries);

          // Mirror to deviceActionForms
          const deviceFormRef = doc(collection(db, 'deviceActionForms'), formRef.id);
          batch.set(deviceFormRef, formEntries);

          // Create closed fault report if ariza
          if (islemTuru === 'ariza' && (selectedFault || isCustomFault)) {
            const [startYear, startMonth, startDay] = baslangicTarihi.split('-').map(Number);
            const [startHour, startMinute] = baslangicSaati.split(':').map(Number);
            const [endYear, endMonth, endDay] = bitisTarihi.split('-').map(Number);
            const [endHour, endMinute] = bitisSaati.split(':').map(Number);
            const startTime = new Date(startYear, startMonth - 1, startDay, startHour, startMinute);
            const endTime = new Date(endYear, endMonth - 1, endDay, endHour, endMinute);
            const cozumSuresi = endTime.getTime() - startTime.getTime();
            const supportPerson = eslikEdenPersonel.length > 0 ? eslikEdenPersonel[0] : null;

            const faultReportRef = doc(collection(db, 'deviceFaultReports'));
            batch.set(faultReportRef, {
              deviceId: currentDeviceId,
              hospitalId: currentDevice.hospitalId,
              labName: hospital?.name,
              model: currentDevice.cihazAdi || currentDevice.model,
              serial: currentDevice.seriNumarasi,
              faultType: 'teknik_servis',
              faultDefinitionId: resolvedFaultId,
              faultName: resolvedFaultName,
              description: aciklama.trim(),
              status: 'cozuldu',
              openedAt: Timestamp.fromDate(startTime),
              closedAt: Timestamp.fromDate(endTime),
              openedByUid: currentUserProfile?.uid,
              openedByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
              closedByUid: currentUserProfile?.uid,
              closedByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
              closeDescription: aciklama.trim(),
              assignedToUid: currentUserProfile?.uid,
              assignedToName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
              assignedAt: Timestamp.fromDate(startTime),
              interventionStartedAt: Timestamp.fromDate(startTime),
              interventionType: 'kurum_ziyaret',
              cozumSuresi,
              toplamCozumSuresi: cozumSuresi,
              resolvedFromFormId: formRef.id,
              resolvedFromFormType: 'teknik_servis',
              eslikEdenPersonel: eslikEdenPersonel.length > 0 ? eslikEdenPersonel : null,
              supportPersonnelUid: supportPerson?.uid || null,
              supportPersonnelName: supportPerson?.name || null,
              relatedTests: selectedTests.length > 0 ? selectedTests : null,
              isCustomFault: isCustomFault || false,
              createdFromActionForm: true,
            });

            const historyOpenedRef = doc(collection(db, 'deviceFaultReports', faultReportRef.id, 'history'));
            batch.set(historyOpenedRef, {
              type: 'opened',
              actorUid: currentUserProfile?.uid,
              actorName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
              description: aciklama.trim(),
              timestamp: Timestamp.fromDate(startTime),
            });

            const historyClosedRef = doc(collection(db, 'deviceFaultReports', faultReportRef.id, 'history'));
            batch.set(historyClosedRef, {
              type: 'closed',
              actorUid: currentUserProfile?.uid,
              actorName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
              description: supportPerson ? `${aciklama.trim()} (Destek: ${supportPerson.name})` : aciklama.trim(),
              timestamp: Timestamp.fromDate(endTime),
            });
          }

          // Process device-specific part/cell changes
          const devicePartChanges = deviceActions.filter(a => a.type === 'part_change');
          for (const partChange of devicePartChanges) {
            let removedStockRefId: string | null = null;
            const removedSerial = String(partChange.removedPartSerialNumber || '').trim();
            const installedSerial = String(partChange.serialNumber || '').trim();
            const removedStokKodu = partChange.removedPartStokKodu || partChange.stokKodu;

            if (removedSerial && removedSerial !== installedSerial) {
              const removedStockRef = doc(collection(db, 'personalStock'));
              removedStockRefId = removedStockRef.id;
              batch.set(removedStockRef, {
                ownerUid: currentUserProfile?.uid || '',
                ownerName: currentUserProfile?.name || '',
                productCodeId: partChange.personalStockId ? partChange.action : null,
                stokKodu: removedStokKodu,
                stokAdi: partChange.removedPartStokAdi || partChange.stokAdi,
                serialNumber: removedSerial,
                imageUrl: partChange.removedPartImageUrl || null,
                source: 'device',
                sourceDeviceId: currentDeviceId,
                sourceDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
                status: 'in_stock',
                createdAt: Timestamp.fromDate(now),
                replacedPartId: partChange.personalStockId || null,
              });
            }

            if (partChange.personalStockId && !processedPersonalStockIdsGlobal.has(partChange.personalStockId)) {
              processedPersonalStockIdsGlobal.add(partChange.personalStockId);
              batch.update(doc(db, 'personalStock', partChange.personalStockId), {
                status: 'used',
                usedAt: Timestamp.fromDate(now),
                usedOnDeviceId: currentDeviceId,
                usedOnDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
                usedOnFormId: formRef.id,
                usedOnFormType: 'teknik_servis',
                replacedPartId: removedStockRefId,
                usedPartImageUrl: partChange.usedPartImageUrl || null,
              });
            }

            if (partChange.poolStockId && !processedPoolStockIdsGlobal.has(partChange.poolStockId)) {
              processedPoolStockIdsGlobal.add(partChange.poolStockId);
              batch.update(doc(db, 'poolWarehouseStock', partChange.poolStockId), {
                status: 'used',
                usedAt: Timestamp.fromDate(now),
                usedByUid: currentUserProfile?.uid || '',
                usedByName: currentUserProfile?.name || '',
                usedOnDeviceId: currentDeviceId,
                usedOnDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
                usedOnFormId: formRef.id,
                usedOnFormType: 'teknik_servis',
              });
            }

            if (partChange.isDepotSelection) {
              // Note: Depot selection consumption logic usually involves decrementing quantity
              // For simplicity in lab mode, we execute this once per part change.
              const depotEntry = await consumeDepotSelection(partChange, batch);
              createDepotBorrowRecord(partChange, depotEntry, batch, currentDevice, formRef.id, now);
            }

            if (partChange.isManualEntry) {
              const borrowedRef = doc(collection(db, 'borrowedSpareParts'));
              batch.set(borrowedRef, {
                stokKodu: partChange.stokKodu,
                stokAdi: partChange.stokAdi,
                serialNumber: partChange.serialNumber,
                deviceId: currentDeviceId,
                deviceName: currentDevice.cihazAdi || currentDevice.model || '',
                hospitalId: currentDevice.hospitalId,
                labName: hospital?.name || '',
                formId: formRef.id,
                formType: 'teknik_servis',
                borrowedByUid: currentUserProfile?.uid || '',
                borrowedByName: currentUserProfile?.name || '',
                borrowedAt: Timestamp.fromDate(now),
                status: 'pending',
              });
            }
          }

          const deviceHucreChanges = deviceActions.filter(a => a.type === 'hucre_degisimi');
          for (const hucreChange of deviceHucreChanges) {
            if (hucreChange.personalStockId && !processedPersonalStockIdsGlobal.has(hucreChange.personalStockId)) {
              processedPersonalStockIdsGlobal.add(hucreChange.personalStockId);
              batch.update(doc(db, 'personalStock', hucreChange.personalStockId), {
                status: 'used',
                usedAt: Timestamp.fromDate(now),
                usedOnDeviceId: currentDeviceId,
                usedOnDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
                usedOnFormId: formRef.id,
                usedOnFormType: 'teknik_servis',
              });
            }
            if (hucreChange.isDepotSelection) {
              const depotEntry = await consumeDepotSelection(hucreChange, batch);
              createDepotBorrowRecord(hucreChange, depotEntry, batch, currentDevice, formRef.id, now);
            }
          }

          // Maintenance Logs (only if primary device for now to avoid ID mismatch, or if we had plans for all)
          if (islemTuru === 'periyodik_bakim' && selectedMaintenanceTasks.length > 0 && isPrimaryDevice) {
            for (const planId of selectedMaintenanceTasks) {
              const plan = maintenancePlans.find(p => p.id === planId);
              if (plan) {
                const maintenanceLogRef = doc(collection(db, 'maintenanceLogs'));
                batch.set(maintenanceLogRef, {
                  deviceId: currentDeviceId,
                  planId: plan.id,
                  taskName: plan.taskName,
                  completedAt: Timestamp.fromDate(now),
                  completedByUid: currentUserProfile?.uid || '',
                  completedByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
                  nextDueDate: Timestamp.fromDate(now), // Simplified calculation for now
                  formId: formRef.id,
                  formType: 'teknik_servis',
                });
              }
            }
          }
        }

        await batch.commit();

        if (currentDraftId) await deleteDoc(doc(db, 'draftActionForms', currentDraftId));

        toast({
          title: 'Başarılı', 
          description: isLabMode 
            ? `Laboratuvar genelinde ${targetDevices.length} cihaz için işlem formu oluşturuldu.` 
            : `İşlem formu #${createdFormIds[0]?.substring(0,6)}... kaydedildi.`
        });
        
        setActions([]);
        setIslemTipi('');
        setIslemTuru('');
        setAciklama('');
        setIsSignatureModalOpen(false);
        router.back();

    } catch(err) {
        console.error("Error saving action form:", err);
        toast({ title: 'Hata', description: 'Form kaydedilemedi: ' + (err as Error).message, variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
  };


  const getActionLabel = (item: ActionItem): string => {
    if (item.type === 'operation') {
      return OPERATION_LABELS[item.action as OperationType] || item.action;
    }
    return item.stokAdi || item.action;
  };

  // Wizard heading definitions with completion tracking (must be before conditional returns)
  const wizardHeadings: WizardHeading[] = useMemo(() => [
    {
      id: 'islem_tipi',
      label: 'İŞLEM TİPİ',
      inline: true,
      isComplete: !!islemTipi,
      completedSublabel: islemTipi ? ISLEM_TIPI_LABELS[islemTipi] : undefined,
    },
    {
      id: 'islem_turu',
      label: 'İŞLEM TÜRÜ',
      inline: true,
      isComplete: !!islemTuru,
      completedSublabel: islemTuru ? ISLEM_TURU_LABELS[islemTuru] : undefined,
    },
    {
      id: 'tarih_saat',
      label: 'TARİH / SAAT',
      isComplete: !!(baslangicTarihi && baslangicSaati && bitisTarihi && bitisSaati),
      completedSublabel: baslangicSaati && bitisSaati ? `${baslangicSaati} - ${bitisSaati}` : undefined,
    },
    {
      id: 'degisen_parca',
      label: 'DEĞİŞEN PARÇA',
      isComplete: actions.some(a => a.type === 'part_change'),
      completedSublabel: actions.filter(a => a.type === 'part_change').length > 0
        ? `${actions.filter(a => a.type === 'part_change').length} parça`
        : undefined,
    },
    {
      id: 'yapilan_islem',
      label: 'YAPILAN İŞLEM',
      isComplete: actions.some(a => a.type === 'operation'),
      completedSublabel: actions.filter(a => a.type === 'operation').length > 0
        ? `${actions.filter(a => a.type === 'operation').length} işlem`
        : undefined,
    },
    {
      id: 'aciklama',
      label: 'AÇIKLAMA',
      isComplete: !!aciklama.trim(),
      completedSublabel: aciklama.trim() ? (aciklama.trim().length > 40 ? aciklama.trim().substring(0, 40) + '...' : aciklama.trim()) : undefined,
    },
  ], [islemTipi, islemTuru, baslangicTarihi, baslangicSaati, bitisTarihi, bitisSaati, actions, aciklama]);

  if (loading) {
    return (
      <div className="cihaz-shell flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
          <p className="text-sm text-[var(--dashboard-muted)]">Yükleniyor…</p>
        </div>
      </div>
    );
  }
  if (!device) {
    return (
      <div className="cihaz-shell flex items-center justify-center min-h-screen">
        <p className="text-[var(--dashboard-muted)]">Cihaz bilgileri yüklenemedi.</p>
      </div>
    );
  }

  // Render wizard detail content for each heading
  const renderWizardDetail = (headingId: string, goBack: () => void) => {
    switch (headingId) {
      case 'islem_tipi':
        return (
          <div className="wizard-option-list">
            {(['cihaz', 'ups', 'su_sistemi'] as IslemTipi[]).map(tip => (
              <button
                key={tip}
                className={`wizard-option-item ${islemTipi === tip ? 'selected' : ''}`}
                onClick={() => { setIslemTipi(tip); goBack(); }}
              >
                {ISLEM_TIPI_LABELS[tip]}
              </button>
            ))}
          </div>
        );

      case 'islem_turu':
        if (showHucreDegisimiInIslemTuru) {
          return (
            <div>
              <button
                type="button"
                className="wizard-btn wizard-btn-secondary"
                style={{ marginBottom: '12px' }}
                onClick={() => setShowHucreDegisimiInIslemTuru(false)}
              >
                ← İşlem Türüne Dön
              </button>
              {renderWizardDetail('hucre_degisimi', () => setShowHucreDegisimiInIslemTuru(false))}
            </div>
          );
        }
        return (
          <div className="wizard-option-list">
            {(['rutin_kurum_ziyareti', 'periyodik_bakim', 'cihaz_kurulumu', 'ariza', 'sw_update', 'alis', 'roche_bilgisayar_arizasi'] as IslemTuru[]).map(tur => {
              const hasSubFields = tur === 'ariza' || tur === 'periyodik_bakim';
              return (
                <React.Fragment key={tur}>
                  <button
                    className={`wizard-option-item ${islemTuru === tur ? 'selected' : ''}`}
                    onClick={() => { setIslemTuru(tur); if (!hasSubFields) goBack(); }}
                  >
                    {ISLEM_TURU_LABELS[tur]}
                  </button>

                  {/* Arıza sub-fields shown inline below the arıza option */}
                  {tur === 'ariza' && islemTuru === 'ariza' && (
                    <div className="wizard-fault-section" style={{ margin: '8px 24px 16px' }}>
                      <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '12px' }}>
                        <AlertTriangle className="h-4 w-4 inline mr-2" style={{ color: '#ef4444' }} />
                        Tespit Edilen Arıza *
                      </label>
                      <Select value={selectedFaultId} onValueChange={(v) => { setSelectedFaultId(v); if (v !== 'diger') setCustomFaultName(''); }}>
                        <SelectTrigger className="wizard-dark-select bg-white/10 border-white/20 text-white">
                          <SelectValue placeholder="Arıza seçin..." />
                        </SelectTrigger>
                        <SelectContent>
                          {faultDefinitions.map(fault => (
                            <SelectItem key={fault.id} value={fault.id}>{fault.name}</SelectItem>
                          ))}
                          <SelectItem value="diger">Diğer (Özel Arıza)</SelectItem>
                        </SelectContent>
                      </Select>
                      {selectedFaultId === 'diger' && (
                        <input
                          type="text"
                          placeholder="Arıza açıklamasını girin... (zorunlu)"
                          value={customFaultName}
                          onChange={(e) => setCustomFaultName(e.target.value)}
                          style={{ marginTop: '8px' }}
                        />
                      )}
                      {/* İlişkili Testler */}
                      <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(239,68,68,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <label style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>İlişkili Testler (Opsiyonel)</label>
                          <button
                            type="button"
                            onClick={() => setIsTestModalOpen(true)}
                            disabled={availableTests.length === 0}
                            className="wizard-add-button"
                            style={{ width: 'auto', padding: '6px 12px', fontSize: '12px', marginTop: 0 }}
                          >
                            <Plus className="h-3 w-3" /> Test Seç
                          </button>
                        </div>
                        {selectedTests.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {selectedTests.map(test => (
                              <span key={test} className="wizard-chip">
                                {test}
                                <button className="wizard-chip-delete" onClick={() => setSelectedTests(prev => prev.filter(t => t !== test))}>
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Periyodik Bakım sub-fields shown inline below the periyodik_bakim option */}
                  {tur === 'periyodik_bakim' && islemTuru === 'periyodik_bakim' && (
                    <div style={{ margin: '8px 24px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {maintenanceTasksWithStatus.length > 0 && (
                        <div style={{ borderRadius: '12px', overflow: 'hidden' }}>
                          <table>
                            <thead>
                              <tr>
                                <th style={{ width: '36px' }}></th>
                                <th>İş Adı</th>
                                <th style={{ width: '80px', textAlign: 'center' }}>Periyot</th>
                                <th style={{ width: '100px', textAlign: 'center' }}>Kalan Gün</th>
                              </tr>
                            </thead>
                            <tbody>
                              {maintenanceTasksWithStatus.map(({ plan, daysRemaining, isOverdue, periodLabel }) => (
                                <tr key={plan.id} style={{ cursor: 'pointer' }} onClick={() => toggleMaintenanceTask(plan.id)}>
                                  <td>
                                    <Checkbox
                                      checked={selectedMaintenanceTasks.includes(plan.id)}
                                      onCheckedChange={() => toggleMaintenanceTask(plan.id)}
                                    />
                                  </td>
                                  <td style={{ fontWeight: 500 }}>{plan.taskName}</td>
                                  <td style={{ textAlign: 'center', fontSize: '13px' }}>{periodLabel}</td>
                                  <td style={{ textAlign: 'center' }}>
                                    {daysRemaining === null ? (
                                      <span style={{ fontSize: '12px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)' }}>Henüz yapılmadı</span>
                                    ) : isOverdue ? (
                                      <span style={{ fontSize: '12px', fontWeight: 500, color: '#ef4444' }}>{Math.abs(daysRemaining)} gün gecikmiş</span>
                                    ) : (
                                      <span style={{ fontSize: '12px', fontWeight: 500, color: daysRemaining <= 7 ? '#f59e0b' : '#22c55e' }}>{daysRemaining} gün</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {periodicPartChangesWithStatus.length > 0 && (
                        <div style={{ borderRadius: '12px', overflow: 'hidden' }}>
                          <label style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', display: 'block', marginBottom: '8px' }}>Periyodik Parça Değişimleri</label>
                          <table>
                            <thead>
                              <tr>
                                <th style={{ width: '36px' }}></th>
                                <th>Ürün</th>
                                <th style={{ width: '80px', textAlign: 'center' }}>Periyot</th>
                                <th style={{ width: '100px', textAlign: 'center' }}>Kalan Gün</th>
                              </tr>
                            </thead>
                            <tbody>
                              {periodicPartChangesWithStatus.map(({ partChange, daysRemaining, isOverdue, periodLabel }) => (
                                <tr key={partChange.id} style={{ cursor: 'pointer' }} onClick={() => togglePeriodicPart(partChange.id)}>
                                  <td>
                                    <Checkbox
                                      checked={selectedPeriodicParts.includes(partChange.id)}
                                      onCheckedChange={() => togglePeriodicPart(partChange.id)}
                                    />
                                  </td>
                                  <td>
                                    <div>
                                      <p style={{ fontWeight: 500 }}>{partChange.stokAdi}</p>
                                      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{partChange.stokKodu}</p>
                                    </div>
                                  </td>
                                  <td style={{ textAlign: 'center', fontSize: '13px' }}>{periodLabel}</td>
                                  <td style={{ textAlign: 'center' }}>
                                    {daysRemaining === null ? (
                                      <span style={{ fontSize: '12px', fontStyle: 'italic', color: 'rgba(255,255,255,0.4)' }}>Henüz değişilmedi</span>
                                    ) : isOverdue ? (
                                      <span style={{ fontSize: '12px', fontWeight: 500, color: '#ef4444' }}>{Math.abs(daysRemaining)} gün gecikmiş</span>
                                    ) : (
                                      <span style={{ fontSize: '12px', fontWeight: 500, color: daysRemaining <= 7 ? '#f59e0b' : '#22c55e' }}>{daysRemaining} gün kaldı</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            <button
              className={`wizard-option-item ${actions.some(a => a.type === 'hucre_degisimi') ? 'selected' : ''}`}
              onClick={() => setShowHucreDegisimiInIslemTuru(true)}
            >
              HÜCRE DEĞİŞİMİ
            </button>
          </div>
        );

      case 'tarih_saat':
        return (
          <div style={{ padding: '8px 0' }}>
            <div className="wizard-datetime-grid">
              <div>
                <label>Başlangıç Tarihi *</label>
                <input type="date" value={baslangicTarihi} onChange={(e) => setBaslangicTarihi(e.target.value)} />
              </div>
              <div>
                <label>Başlangıç Saati *</label>
                <input type="time" value={baslangicSaati} onChange={(e) => setBaslangicSaati(e.target.value)} />
              </div>
              <div>
                <label>Bitiş Tarihi *</label>
                <input type="date" value={bitisTarihi} onChange={(e) => setBitisTarihi(e.target.value)} />
              </div>
              <div>
                <label>Bitiş Saati *</label>
                <input type="time" value={bitisSaati} onChange={(e) => setBitisSaati(e.target.value)} />
              </div>
            </div>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '12px' }}>
              İşleme başladığınız ve bitirdiğiniz tarih ve saatleri giriniz.
            </p>
          </div>
        );

      case 'degisen_parca':
        return (
          <div>
            {/* Existing part changes list */}
            {actions.filter(a => a.type === 'part_change').length > 0 && (
              <div className="wizard-action-list" style={{ marginBottom: '16px' }}>
                {actions.filter(a => a.type === 'part_change').map(item => (
                  <div key={item.id} className="wizard-action-item">
                    <div>
                      <div className="wizard-action-item-label">{item.stokAdi || item.action}</div>
                      <div className="wizard-action-item-sub">
                        {item.stokKodu} {item.serialNumber ? `/ SN: ${item.serialNumber}` : ''} {item.anaBirim ? `· ${item.anaBirim.toLocaleLowerCase('tr-TR')}` : ''}
                        {item.isManualEntry && ' (Manuel)'}
                        {item.isPeriodicPartChange && ' (Periyodik)'}
                      </div>
                    </div>
                    <button className="wizard-action-item-delete" onClick={() => removeActionRow(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 1. Part Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: 'var(--wz-text)', marginBottom: '12px' }}>
                1. Parça Seçin
              </label>

              {/* Stock source tabs */}
              <div className="wizard-sub-tabs" style={{ paddingLeft: 0, marginBottom: '8px' }}>
                <button
                  className={`wizard-sub-tab ${!showManualEntry && stockSourceTab === 'personal' ? 'active' : ''}`}
                  onClick={() => { setStockSourceTab('personal'); setShowManualEntry(false); setSelectedPoolStockItem(null); setSelectedDepotStockItem(null); }}
                >
                  ŞAHSİ STOK
                </button>
                {poolStockItems.length > 0 && (
                  <button
                    className={`wizard-sub-tab ${!showManualEntry && stockSourceTab === 'pool' ? 'active' : ''}`}
                    onClick={() => { setStockSourceTab('pool'); setShowManualEntry(false); setSelectedStockItem(null); setSelectedDepotStockItem(null); }}
                  >
                    HAVUZ STOK
                  </button>
                )}
                <button
                  className={`wizard-sub-tab ${!showManualEntry && stockSourceTab === 'depot' ? 'active' : ''}`}
                  onClick={() => { setStockSourceTab('depot'); setShowManualEntry(false); setSelectedStockItem(null); setSelectedPoolStockItem(null); }}
                >
                  DEPO STOK
                </button>
              </div>

              {!showManualEntry ? (
                <>
                  <div style={{ position: 'relative', marginBottom: '8px' }}>
                    <Search style={{ position: 'absolute', left: '12px', top: '12px', width: '16px', height: '16px', color: 'var(--wz-text-secondary)' }} />
                    <input
                      type="text"
                      placeholder={stockSourceTab === 'personal' ? 'Şahsi stokta ara...' : stockSourceTab === 'pool' ? 'Havuz stokta ara...' : 'Depo stokta ara...'}
                      value={partSearchQuery}
                      onChange={(e) => setPartSearchQuery(e.target.value)}
                      style={{ paddingLeft: '36px', background: 'var(--wz-input-bg)', border: '1px solid var(--wz-input-border)', color: 'var(--wz-text)', borderRadius: '12px', padding: '10px 14px 10px 36px', fontSize: '15px', width: '100%', outline: 'none' }}
                    />
                  </div>
                  {stockSourceTab === 'personal' ? (
                    <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--wz-border)', borderRadius: '12px' }}>
                      {filteredStock.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--wz-text-secondary)', fontSize: '14px' }}>
                          {personalStock.filter(p => !usedPersonalStockIds.has(p.id)).length === 0 ? 'Şahsi stokunuzda eklenebilir yedek parça bulunmuyor.' : 'Sonuç bulunamadı.'}
                        </div>
                      ) : filteredStock.map(item => (
                        <div
                          key={item.id}
                          onClick={() => {
                            selectPersonalStockItem(item);
                            setRemovedPartSerialNumber('');
                            setRemovedPartImageFile(null); setRemovedPartImagePreview(null);
                            setUsedPartImageFile(null); setUsedPartImagePreview(null);
                          }}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                            padding: '12px 14px', borderBottom: '1px solid var(--wz-table-border)', cursor: 'pointer',
                            background: selectedStockItem?.id === item.id ? 'var(--wz-selected-bg)' : 'transparent',
                            borderLeft: selectedStockItem?.id === item.id ? '3px solid var(--wz-accent)' : '3px solid transparent',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--wz-text)' }}>{item.stokAdi}</div>
                            <div style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', fontFamily: 'monospace' }}>{item.stokKodu} {item.anaBirim ? `· ${item.anaBirim.toLocaleLowerCase('tr-TR')}` : ''}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--wz-text)' }}>{item.serialNumber}</div>
                            <div style={{ fontSize: '11px', color: 'var(--wz-text-secondary)' }}>{item.source === 'depot' ? 'Depodan' : 'Cihazdan'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : stockSourceTab === 'pool' ? (
                    <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--wz-border)', borderRadius: '12px' }}>
                      {filteredPoolStock.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--wz-text-secondary)', fontSize: '14px' }}>
                          {poolStockItems.filter(p => !usedPoolStockIds.has(p.id)).length === 0 ? 'Havuz depoda eklenebilir yedek parça bulunmuyor.' : 'Sonuç bulunamadı.'}
                        </div>
                      ) : filteredPoolStock.map(item => (
                        <div
                          key={item.id}
                          onClick={() => {
                            selectPoolStockItem(item);
                            setRemovedPartSerialNumber('');
                            setRemovedPartImageFile(null); setRemovedPartImagePreview(null);
                            setUsedPartImageFile(null); setUsedPartImagePreview(null);
                          }}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                            padding: '12px 14px', borderBottom: '1px solid var(--wz-table-border)', cursor: 'pointer',
                            background: selectedPoolStockItem?.id === item.id ? 'var(--wz-selected-bg)' : 'transparent',
                            borderLeft: selectedPoolStockItem?.id === item.id ? '3px solid #a855f7' : '3px solid transparent',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--wz-text)' }}>{item.stokAdi}</div>
                            <div style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', fontFamily: 'monospace' }}>{item.stokKodu} {item.anaBirim ? `· ${item.anaBirim.toLocaleLowerCase('tr-TR')}` : ''}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--wz-text)' }}>{item.serialNumber || '—'}</div>
                            <div style={{ fontSize: '11px', color: '#a855f7', fontWeight: 500 }}>{item.poolWarehouseName}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--wz-border)', borderRadius: '12px' }}>
                      {filteredDepotStock.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--wz-text-secondary)', fontSize: '14px' }}>
                          {selectableDepotStock.length === 0 ? 'Depoda eklenebilir yedek parça bulunmuyor.' : 'Sonuç bulunamadı.'}
                        </div>
                      ) : filteredDepotStock.map(item => (
                        <div
                          key={`${item.id || item.stokKodu}-${item.hucreNumarasi || item.serialNumber || 'qty'}`}
                          onClick={() => {
                            handleDepotItemSelect(item);
                            setRemovedPartSerialNumber('');
                            setRemovedPartImageFile(null); setRemovedPartImagePreview(null);
                            setUsedPartImageFile(null); setUsedPartImagePreview(null);
                          }}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                            padding: '12px 14px', borderBottom: '1px solid var(--wz-table-border)', cursor: 'pointer',
                            background: selectedDepotStockItem?.id === item.id && selectedDepotStockItem?.stokKodu === item.stokKodu ? 'var(--wz-selected-bg)' : 'transparent',
                            borderLeft: selectedDepotStockItem?.id === item.id && selectedDepotStockItem?.stokKodu === item.stokKodu ? '3px solid #f97316' : '3px solid transparent',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--wz-text)' }}>{item.stokAdi}</div>
                            <div style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', fontFamily: 'monospace' }}>
                              {item.stokKodu}
                              {item.serialNumber ? ` · SN:${item.serialNumber}` : ''}
                              {item.hucreNumarasi ? ` · H:${item.hucreNumarasi}` : ''}
                              {!item.serialNumber && !item.hucreNumarasi ? ` · ${item.totalQuantity} adet` : ''}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--wz-text)' }}>
                              {item.serialNumber || item.hucreNumarasi || `${item.totalQuantity} adet`}
                            </div>
                            <div style={{ fontSize: '11px', color: '#f97316', fontWeight: 500 }}>{item.address || 'Depo'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={activateManualEntry}
                    style={{ width: '100%', marginTop: '8px', padding: '10px', fontSize: '13px', fontWeight: 500, color: 'var(--wz-accent)', background: 'none', border: '1px dashed var(--wz-border)', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    <Plus size={14} /> Stokta yok, manuel ekle
                  </button>
                </>
              ) : (
                /* Manual entry form */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', display: 'block', marginBottom: '4px' }}>Parça Kodu <span style={{ color: '#ef4444' }}>*</span></label>
                      <input type="text" placeholder="Kod..." value={manualPartCode} onChange={(e) => setManualPartCode(e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', display: 'block', marginBottom: '4px' }}>
                        Seri No {(!pendingPeriodicPartChangeId || periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)?.requiresSerialTracking) && <span style={{ color: '#ef4444' }}>*</span>}
                      </label>
                      <input type="text" placeholder="Seri No..." value={manualSerialNumber} onChange={(e) => setManualSerialNumber(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', display: 'block', marginBottom: '4px' }}>Parça Adı <span style={{ color: '#ef4444' }}>*</span></label>
                    <input type="text" placeholder="Parça adını girin..." value={manualPartName} onChange={(e) => setManualPartName(e.target.value)} />
                  </div>
                  <button
                    onClick={() => setShowManualEntry(false)}
                    style={{ fontSize: '13px', color: 'var(--wz-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', textAlign: 'left', fontWeight: 500 }}
                  >
                    Stoktan seç
                  </button>
                </div>
              )}
            </div>

            {/* 2. Removed part info (auto-filled) */}
            {(selectedStockItem || selectedPoolStockItem || selectedDepotStockItem || showManualEntry) && (
              <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '12px', border: '1px solid var(--wz-border)', background: 'var(--wz-input-bg)' }}>
                <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: 'var(--wz-text)', marginBottom: '12px' }}>
                  2. Cihazdan Çıkan Parça Bilgisi
                  <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--wz-text-secondary)', marginLeft: '8px' }}>
                    {(!pendingPeriodicPartChangeId || periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)?.requiresOutgoingPartInfo) ? '(zorunlu)' : '(opsiyonel)'}
                  </span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', display: 'block', marginBottom: '4px' }}>Parça Kodu</label>
                    <input type="text" value={removedPartStokKodu} readOnly style={{ opacity: 0.7, cursor: 'default' }} />
                    <p style={{ fontSize: '11px', color: 'var(--wz-text-secondary)', marginTop: '2px' }}>Takılan parçanın kodundan otomatik alınır.</p>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', display: 'block', marginBottom: '4px' }}>Seri No (Opsiyonel)</label>
                    <input type="text" placeholder="Çıkan parça seri no..." value={removedPartSerialNumber} onChange={(e) => setRemovedPartSerialNumber(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', display: 'block', marginBottom: '4px' }}>Parça Adı</label>
                  <input type="text" value={removedPartStokAdi} readOnly style={{ opacity: 0.7, cursor: 'default' }} />
                  <p style={{ fontSize: '11px', color: 'var(--wz-text-secondary)', marginTop: '2px' }}>Takılan parçanın adından otomatik alınır.</p>
                </div>

                {/* Photo uploads */}
                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--wz-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Removed part image */}
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                      <Camera size={12} /> Çıkan Parça Fotoğrafı (Opsiyonel)
                    </label>
                    <input type="file" accept="image/*" ref={removedPartImageInputRef} onChange={handleRemovedPartImageSelect} className="hidden" />
                    {removedPartImagePreview ? (
                      <div style={{ position: 'relative' }}>
                        <img src={removedPartImagePreview} alt="Çıkan parça" style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--wz-border)' }} />
                        <button
                          onClick={() => { setRemovedPartImageFile(null); setRemovedPartImagePreview(null); if (removedPartImageInputRef.current) removedPartImageInputRef.current.value = ''; }}
                          style={{ position: 'absolute', top: '4px', right: '4px', width: '24px', height: '24px', borderRadius: '50%', background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => removedPartImageInputRef.current?.click()}
                        style={{ width: '100%', height: '56px', border: '1px dashed var(--wz-border)', borderRadius: '12px', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', color: 'var(--wz-text-secondary)', fontSize: '12px' }}
                      >
                        <ImageIcon size={18} />
                        Çıkan parça fotoğrafı
                      </button>
                    )}
                  </div>
                  {/* Used/installed part image */}
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                      <Camera size={12} /> Takılan Parça Fotoğrafı (Opsiyonel)
                    </label>
                    <input type="file" accept="image/*" ref={usedPartImageInputRef} onChange={handleUsedPartImageSelect} className="hidden" />
                    {usedPartImagePreview ? (
                      <div style={{ position: 'relative' }}>
                        <img src={usedPartImagePreview} alt="Takılan parça" style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--wz-border)' }} />
                        <button
                          onClick={() => { setUsedPartImageFile(null); setUsedPartImagePreview(null); if (usedPartImageInputRef.current) usedPartImageInputRef.current.value = ''; }}
                          style={{ position: 'absolute', top: '4px', right: '4px', width: '24px', height: '24px', borderRadius: '50%', background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => usedPartImageInputRef.current?.click()}
                        style={{ width: '100%', height: '56px', border: '1px dashed var(--wz-border)', borderRadius: '12px', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', color: 'var(--wz-text-secondary)', fontSize: '12px' }}
                      >
                        <ImageIcon size={18} />
                        Takılan parça fotoğrafı
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Add button */}
            {(selectedStockItem || selectedPoolStockItem || selectedDepotStockItem || (showManualEntry && manualPartCode && manualPartName)) && (
              <button
                onClick={addSelectedPart}
                disabled={isUploadingImage}
                style={{
                  width: '100%', padding: '14px', fontSize: '15px', fontWeight: 600,
                  background: 'var(--wz-accent)', color: '#fff', border: 'none', borderRadius: '12px',
                  cursor: isUploadingImage ? 'not-allowed' : 'pointer', opacity: isUploadingImage ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
              >
                {isUploadingImage ? <><Loader2 className="h-4 w-4 animate-spin" />Yükleniyor...</> : 'EKLE'}
              </button>
            )}
          </div>
        );

      case 'hucre_degisimi': {
        const validateHucreFormat = (v: string) => /^[A-Za-z]\d{4}$/.test(v);
        const getSelectedItem = (row: HucreDegisimiDraftRow) => row.stockSourceTab === 'depot' ? row.selectedDepotItem : row.selectedPersonalItem;
        const getLockedChannelForRow = (rowIndex: number): 'CH1' | 'CH2' | undefined => {
          if (rowIndex === 1) {
            const first = hucreDegisimiRows[0]?.selectedChannel;
            if (first === 'CH1') return 'CH2';
            if (first === 'CH2') return 'CH1';
          }
          return undefined;
        };

        const updateRow = (rowId: string, updater: (row: HucreDegisimiDraftRow) => HucreDegisimiDraftRow) => {
          setHucreDegisimiRows(prev => prev.map(row => (row.id === rowId ? updater(row) : row)));
        };

        const addHucreRow = () => {
          setHucreDegisimiRows(prev => [
            ...prev,
            {
              id: `hucre_row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              stockSourceTab: 'personal',
              selectedPersonalItem: null,
              selectedDepotItem: null,
              searchQuery: '',
              removedHucreNumarasi: '',
              description: '',
              assignedDeviceId: actualDeviceId || '',
            },
          ]);
        };

        const saveHucreDegisimiRows = () => {
          if (hucreDegisimiRows.length === 0) return;
          const activeRows = hucreDegisimiRows.filter((row) => (
            !!getSelectedItem(row)
            || !!row.removedHucreNumarasi.trim()
            || !!row.description.trim()
            || !!row.selectedChannel
          ));
          if (activeRows.length === 0) {
            toast({ title: 'Eksik Bilgi', description: 'Kaydedilecek en az bir hücre değişimi satırı doldurun.', variant: 'destructive' });
            return;
          }
          const newActions: ActionItem[] = [];
          const seenPersonalIds = new Set<string>();
          const seenDepotIds = new Set<string>();
          for (let i = 0; i < activeRows.length; i++) {
            const row = activeRows[i];
            const selectedItem = getSelectedItem(row);
            if (!selectedItem) {
              toast({ title: 'Eksik Bilgi', description: `${i + 1}. satır için takılacak hücre seçin.`, variant: 'destructive' });
              return;
            }
            if (row.stockSourceTab === 'personal') {
              if (seenPersonalIds.has(selectedItem.id)) {
                toast({ title: 'Mükerrer Seçim', description: `${i + 1}. satırda aynı şahsi stok hücresi tekrar seçilemez.`, variant: 'destructive' });
                return;
              }
              seenPersonalIds.add(selectedItem.id);
            } else if (row.stockSourceTab === 'depot') {
              if (seenDepotIds.has(selectedItem.id)) {
                toast({ title: 'Mükerrer Seçim', description: `${i + 1}. satırda aynı depo stok hücresi tekrar seçilemez.`, variant: 'destructive' });
                return;
              }
              seenDepotIds.add(selectedItem.id);
            }
            const removedHn = row.removedHucreNumarasi.trim().toUpperCase();
            if (!validateHucreFormat(removedHn)) {
              toast({ title: 'Geçersiz Format', description: `${i + 1}. satırdaki çıkan hücre numarası hatalı.`, variant: 'destructive' });
              return;
            }
            if (i < 2 && !row.selectedChannel) {
              toast({ title: 'Eksik Bilgi', description: `${i + 1}. satır için kanal seçimi zorunludur.`, variant: 'destructive' });
              return;
            }
            const action: ActionItem = {
              id: `hucre_${Date.now()}_${i}`,
              type: 'hucre_degisimi',
              action: `Hücre Değişimi: ${selectedItem.hucreNumarasi}`,
              stokKodu: selectedItem.stokKodu,
              stokAdi: selectedItem.stokAdi,
              anaBirim: selectedItem.anaBirim,
              quantity: 1,
              personalStockId: row.stockSourceTab === 'personal' ? selectedItem.id : undefined,
              depotStockId: row.stockSourceTab === 'depot' ? selectedItem.id : undefined,
              isDepotSelection: row.stockSourceTab === 'depot',
              serialNumber: selectedItem.serialNumber,
              hucreNumarasi: selectedItem.hucreNumarasi || '',
              removedHucreNumarasi: removedHn,
              channelSelections: row.selectedChannel ? [row.selectedChannel] : [],
              removedPartStokKodu: selectedItem.stokKodu,
              removedPartStokAdi: selectedItem.stokAdi,
              description: row.description.trim() || '',
              assignedDeviceId: isLabMode ? row.assignedDeviceId : actualDeviceId,
            };
            newActions.push(action);
          }
          setActions(prev => [...prev, ...newActions]);
          setHucreDegisimiRows([{
            id: `hucre_row_${Date.now()}`,
            stockSourceTab: 'personal',
            selectedPersonalItem: null,
            selectedDepotItem: null,
            searchQuery: '',
            removedHucreNumarasi: '',
            description: '',
          }]);
          toast({ title: 'Hücre Değişimleri Kaydedildi', description: `${newActions.length} satır hücre değişimi eklendi.` });
        };

        return (
          <div>
            {actions.filter(a => a.type === 'hucre_degisimi').length > 0 && (
              <div className="wizard-action-list" style={{ marginBottom: '16px' }}>
                {actions.filter(a => a.type === 'hucre_degisimi').map(item => (
                  <div key={item.id} className="wizard-action-item">
                    <div>
                      <div className="wizard-action-item-label">{item.stokAdi}</div>
                      <div className="wizard-action-item-sub">
                        Takılan: H:{item.hucreNumarasi} {item.removedHucreNumarasi ? `· Çıkan: H:${item.removedHucreNumarasi}` : ''}
                        {item.channelSelections?.length ? ` · Kanal: ${item.channelSelections.join(', ')}` : ''}
                        {item.description ? ` · ${item.description}` : ''}
                      </div>
                    </div>
                    <button className="wizard-action-item-delete" onClick={() => removeActionRow(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {hucreDegisimiRows.map((row, rowIndex) => {
                const selectedPersonalIdsInOtherRows = new Set(
                  hucreDegisimiRows
                    .filter(r => r.id !== row.id)
                    .map(r => r.selectedPersonalItem?.id)
                    .filter(Boolean) as string[]
                );
                const selectedDepotIdsInOtherRows = new Set(
                  hucreDegisimiRows
                    .filter(r => r.id !== row.id)
                    .map(r => r.selectedDepotItem?.id)
                    .filter(Boolean) as string[]
                );
                const personalCandidates = personalStock
                  .filter(p => !usedPersonalStockIds.has(p.id) && (p as any).hucreNumarasi && p.status === 'in_stock')
                  .filter(p => !selectedPersonalIdsInOtherRows.has(p.id) || row.selectedPersonalItem?.id === p.id)
                  .filter(p => {
                    if (!row.searchQuery.trim()) return true;
                    const q = row.searchQuery.trim().toLowerCase();
                    return p.stokKodu.toLowerCase().includes(q) || p.stokAdi.toLowerCase().includes(q) || ((p as any).hucreNumarasi || '').toLowerCase().includes(q);
                  });
                const depotCandidates = selectableDepotHucreStock.filter(item => {
                  if (selectedDepotIdsInOtherRows.has(item.id) && row.selectedDepotItem?.id !== item.id) return false;
                  if (!row.searchQuery.trim()) return true;
                  const q = row.searchQuery.trim().toLowerCase();
                  return item.stokKodu.toLowerCase().includes(q) || item.stokAdi.toLowerCase().includes(q) || (item.hucreNumarasi || '').toLowerCase().includes(q);
                });
                const selectedItem = getSelectedItem(row);
                const lockedChannel = getLockedChannelForRow(rowIndex);
                return (
                  <details key={row.id} open style={{ border: '1px solid var(--wz-border)', borderRadius: '12px', padding: '10px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{rowIndex + 1}. Hücre Değişimi Satırı</summary>
                    <div style={{ marginTop: '10px' }}>
                      <div className="wizard-sub-tabs" style={{ paddingLeft: 0, marginBottom: '8px' }}>
                        <button className={`wizard-sub-tab ${row.stockSourceTab === 'personal' ? 'active' : ''}`} onClick={() => updateRow(row.id, r => ({ ...r, stockSourceTab: 'personal', selectedDepotItem: null }))}>ŞAHSİ STOK</button>
                        <button className={`wizard-sub-tab ${row.stockSourceTab === 'depot' ? 'active' : ''}`} onClick={() => updateRow(row.id, r => ({ ...r, stockSourceTab: 'depot', selectedPersonalItem: null }))}>DEPO STOK</button>
                      </div>
                      <div style={{ position: 'relative', marginBottom: '8px' }}>
                        <Search style={{ position: 'absolute', left: '12px', top: '12px', width: '16px', height: '16px', color: 'var(--wz-text-secondary)' }} />
                        <input type="text" placeholder="Hücre no veya ürün ara..." value={row.searchQuery} onChange={(e) => updateRow(row.id, r => ({ ...r, searchQuery: e.target.value }))} style={{ paddingLeft: '36px', background: 'var(--wz-input-bg)', border: '1px solid var(--wz-input-border)', color: 'var(--wz-text)', borderRadius: '12px', padding: '10px 14px 10px 36px', fontSize: '15px', width: '100%', outline: 'none' }} />
                      </div>
                      {isLabMode && (
                        <div style={{ marginBottom: '12px' }}>
                          <label style={{ fontSize: '13px', color: 'var(--wz-text-secondary)', display: 'block', marginBottom: '6px' }}>Bu Hücre Hangi Cihaza Takıldı? *</label>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {devicesByLab.map(d => (
                              <button
                                key={d.id}
                                onClick={() => updateRow(row.id, r => ({ ...r, assignedDeviceId: d.id }))}
                                className={`flex flex-col items-center p-2 rounded-xl border transition-all ${
                                  row.assignedDeviceId === d.id 
                                    ? 'bg-[var(--dashboard-accent)]/10 border-[var(--dashboard-accent)] text-[var(--dashboard-accent)]' 
                                    : 'bg-[var(--dashboard-surface)] border-[var(--dashboard-stroke)] hover:bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]'
                                }`}
                              >
                                <span className="text-[10px] font-bold truncate w-full text-center">{d.cihazAdi || d.model}</span>
                                <span className="text-[9px] opacity-70 truncate w-full text-center">SN: {d.seriNumarasi}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedItem && (
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <input type="text" value={selectedItem.stokKodu || ''} readOnly style={{ opacity: 0.7 }} />
                          <input type="text" value={selectedItem.stokAdi || ''} readOnly style={{ opacity: 0.7 }} />
                          <input type="text" placeholder="Çıkan hücre no (örn: A1234)" value={row.removedHucreNumarasi} onChange={(e) => updateRow(row.id, r => ({ ...r, removedHucreNumarasi: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) }))} />
                          {rowIndex < 2 && (
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <span style={{ fontSize: '13px' }}>Kanal:</span>
                              {(['CH1', 'CH2'] as const).map(ch => (
                                <label key={ch} style={{ opacity: lockedChannel && lockedChannel !== ch ? 0.4 : 1 }}>
                                  <input type="radio" name={`channel_${row.id}`} disabled={!!lockedChannel && lockedChannel !== ch} checked={row.selectedChannel === ch} onChange={() => updateRow(row.id, r => ({ ...r, selectedChannel: ch }))} /> {ch}
                                </label>
                              ))}
                            </div>
                          )}
                          {rowIndex >= 2 && <p style={{ fontSize: '12px', color: 'var(--wz-text-secondary)' }}>3. satır ve sonrası için kanal seçimi istenmez.</p>}
                          <textarea placeholder="Açıklama (opsiyonel)" value={row.description} onChange={(e) => updateRow(row.id, r => ({ ...r, description: e.target.value }))} rows={2} />
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button className="wizard-btn-main" onClick={addHucreRow} style={{ marginTop: 0 }}>+ Satır Ekle</button>
              <button className="wizard-btn-main" onClick={saveHucreDegisimiRows} style={{ marginTop: 0 }}>Hücre Değişim Bilgilerini Kaydet</button>
            </div>
          </div>
        );
      }

      case 'yapilan_islem':
        return (
          <div>
            {/* Existing operations list */}
            {actions.filter(a => a.type === 'operation').length > 0 ? (
              <div className="wizard-action-list">
                {actions.filter(a => a.type === 'operation').map(item => (
                  <div key={item.id} className="wizard-action-item">
                    <div className="wizard-action-item-label">{getActionLabel(item)}</div>
                    <button className="wizard-action-item-delete" onClick={() => removeActionRow(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="wizard-empty-state">Henüz işlem eklenmedi.</div>
            )}

            {/* Operation options as clickable list */}
            <div className="wizard-option-list" style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px' }}>
              {ALL_OPERATIONS.map(op => {
                const alreadyAdded = actions.some(a => a.type === 'operation' && a.action === op);
                return (
                  <button
                    key={op}
                    className={`wizard-option-item ${alreadyAdded ? 'selected' : ''}`}
                    style={{ fontSize: '18px', padding: '14px 24px' }}
                    onClick={() => {
                      if (alreadyAdded) {
                        // Remove it
                        setActions(prev => prev.filter(a => !(a.type === 'operation' && a.action === op)));
                      } else {
                        // Add it
                        const newItem: ActionItem = {
                          id: crypto.randomUUID(),
                          type: 'operation',
                          action: op,
                          quantity: 1,
                        };
                        setActions(prev => [newItem, ...prev]);
                      }
                    }}
                  >
                    {alreadyAdded && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="#4CAF50" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px', marginRight: '12px', flexShrink: 0 }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {OPERATION_LABELS[op]}
                  </button>
                );
              })}
            </div>
          </div>
        );

      case 'aciklama':
        return (
          <div style={{ padding: '8px 0' }}>
            <label>Açıklama *</label>
            <textarea
              placeholder="Yapılan işlem hakkında açıklama yazın... (zorunlu)"
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              rows={5}
              style={{ minHeight: '140px', resize: 'vertical' }}
            />
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '8px' }}>
              Bu alan zorunludur. Yapılan işlemi detaylı şekilde açıklayınız.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  // Render save confirmation inside wizard
  const renderWizardSaveConfirm = (goBack: () => void) => (
    <div className="wizard-save-summary">
      <h3>Form Özeti</h3>
      <div className="wizard-save-summary-item">
        <span className="label">İşlem Tipi</span>
        <span className="value">{islemTipi ? ISLEM_TIPI_LABELS[islemTipi] : '—'}</span>
      </div>
      <div className="wizard-save-summary-item">
        <span className="label">İşlem Türü</span>
        <span className="value">{islemTuru ? ISLEM_TURU_LABELS[islemTuru] : '—'}</span>
      </div>
      <div className="wizard-save-summary-item">
        <span className="label">Tarih / Saat</span>
        <span className="value">{baslangicSaati && bitisSaati ? `${baslangicTarihi} ${baslangicSaati} — ${bitisTarihi} ${bitisSaati}` : '—'}</span>
      </div>
      <div className="wizard-save-summary-item">
        <span className="label">Değişen Parça</span>
        <span className="value">{actions.filter(a => a.type === 'part_change').length} parça</span>
      </div>
      {actions.filter(a => a.type === 'hucre_degisimi').length > 0 && (
        <div className="wizard-save-summary-item">
          <span className="label">Hücre Değişimi</span>
          <span className="value">{actions.filter(a => a.type === 'hucre_degisimi').length} hücre</span>
        </div>
      )}
      <div className="wizard-save-summary-item">
        <span className="label">Yapılan İşlem</span>
        <span className="value">{actions.filter(a => a.type === 'operation').length} işlem</span>
      </div>
      <div className="wizard-save-summary-item">
        <span className="label">Açıklama</span>
        <span className="value">{aciklama.trim() ? (aciklama.trim().length > 60 ? aciklama.trim().substring(0, 60) + '...' : aciklama.trim()) : '—'}</span>
      </div>
      <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
        <button className="wizard-btn wizard-btn-secondary" onClick={goBack}>Geri</button>
        <button
          className="wizard-btn wizard-btn-primary"
          onClick={startSaveProcess}
          disabled={isSaving || actions.length === 0}
        >
          {isSaving ? 'Kaydediliyor...' : 'Onayla ve Kaydet'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="wizard-page-wrapper">
        {/* Compact Device Info Header */}
        <header className="wizard-compact-header sticky top-0 z-30">
          <button
            className="wizard-icon-btn"
            onClick={() => { if (window.history.length > 2) router.back(); else router.push(`/teknik-servis/${device.hospitalId}`); }}
            aria-label="Geri Dön"
          >
            <ChevronLeft size={18} />
          </button>
          {device.imageUrl && (
            <div className="wizard-header-image">
              <Image src={resolveImageSrc(device.imageUrl)} alt={device.cihazAdi || ''} width={40} height={40} />
            </div>
          )}
          <div className="wizard-header-info">
            <div className="wizard-header-title-row">
              <div className="wizard-header-title">{isLabMode ? 'Laboratuvar Geneli İşlem Formu' : 'Teknik Servis İşlem Formu'}</div>
            </div>
            <div className="wizard-header-device">
              {isLabMode ? (
                <span className="flex items-center gap-2">
                  <Building2 size={14} className="text-[var(--dashboard-accent)]" />
                  {hospital?.name || 'Tüm Cihazlar'} ({devicesByLab.length} Cihaz)
                </span>
              ) : (
                <>
                  {device.cihazAdi} <span className="wizard-header-sn">Seri No: {device.seriNumarasi}</span>
                </>
              )}
            </div>
            <div className="wizard-header-meta">
              <span className="wizard-header-meta-tag"><strong>Lab:</strong> {hospital?.name || '-'}</span>
              <span className="wizard-header-meta-tag"><strong>İşlemi Yapan:</strong> {currentUserProfile?.name || '-'}</span>
              <span className="wizard-header-meta-tag"><strong>Tarih:</strong> {format(new Date(), 'dd.MM.yyyy HH:mm', { locale: tr })}</span>
            </div>
          </div>
          <button
            className="wizard-icon-btn"
            onClick={() => router.push(`/teknik-servis/gecmis/${deviceId}`)}
            aria-label="Geçmiş"
          >
            <History size={16} />
          </button>
        </header>

        {/* Wizard Form Body */}
        <WizardFormShell
          headings={wizardHeadings}
          renderDetail={renderWizardDetail}
          renderSaveConfirm={renderWizardSaveConfirm}
          onSaveDraft={handleSaveDraft}
          onSave={startSaveProcess}
          isSaving={isSaving}
          isSavingDraft={isSavingDraft}
          saveDisabled={isSaving || actions.length === 0}
          useGrid={true}
        />
      </div>


      <Dialog open={isAutoStockConfirmOpen} onOpenChange={(open) => {
        setIsAutoStockConfirmOpen(open);
        if (!open && !isAutoStockCreating) {
          setAutoStockPendingPartId(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Periyodik Parça İçin Otomatik Stok Oluştur</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Seçilen periyodik parça şahsi stoğunuzda bulunamadı. Bu parça için otomatik depo stok girişi,
            personel transfer kaydı ve şahsi stok kaydı oluşturulsun mu?
          </p>
          <DialogFooter className="gap-2">
            <button
              onClick={() => handleAutoStockConfirm(false)}
              disabled={isAutoStockCreating}
              className="cihaz-tool-item px-4 py-2.5 text-sm font-medium"
            >
              İptal
            </button>
            <button
              onClick={() => handleAutoStockConfirm(true)}
              disabled={isAutoStockCreating}
              className="cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-accent)] text-white disabled:opacity-50"
            >
              {isAutoStockCreating ? 'Oluşturuluyor...' : 'Otomatik Oluştur'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Operation Selection Modal */}
      <Dialog open={isOperationModalOpen} onOpenChange={setIsOperationModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yapılan İşlemi Seç</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            {ALL_OPERATIONS.map(op => (
              <div key={op} className="flex items-center space-x-3">
                <Checkbox
                  id={op}
                  checked={selectedOperations.includes(op)}
                  onCheckedChange={() => toggleOperation(op)}
                />
                <Label htmlFor={op} className="cursor-pointer font-medium text-[var(--dashboard-text)]">
                  {OPERATION_LABELS[op]}
                </Label>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <button onClick={() => setIsOperationModalOpen(false)} className="cihaz-tool-item px-4 py-2.5 text-sm font-medium">İptal</button>
            <button
              onClick={addSelectedOperations}
              disabled={selectedOperations.length === 0}
              className="cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Ekle ({selectedOperations.length})
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Part Selection Modal - Personal Stock */}
      <Dialog open={isPartModalOpen} onOpenChange={(open) => {
        if (!open && pendingPeriodicPartChangeId) {
          setSelectedPeriodicParts(prev => prev.filter(id => id !== pendingPeriodicPartChangeId));
          setPendingPeriodicPartChangeId(null);
        }
        setIsPartModalOpen(open);
      }}>
        <DialogContent className="left-0 right-0 top-auto bottom-0 translate-x-0 translate-y-0 w-screen max-w-none h-[100dvh] max-h-[100dvh] rounded-none border-0 bg-background p-0 shadow-none overflow-hidden sm:left-[50%] sm:right-auto sm:top-[50%] sm:bottom-auto sm:w-full sm:max-w-2xl sm:h-auto sm:max-h-[90vh] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border sm:shadow-lg">
          <DialogHeader className="px-4 sm:px-6 py-4 border-b border-[var(--dashboard-stroke)]">
            <DialogTitle className="text-lg font-semibold tracking-tight text-[var(--dashboard-text)]">Yedek Parça Değişimi</DialogTitle>
          </DialogHeader>
          <div className="flex-1 px-4 sm:px-6 py-4 space-y-4 overflow-y-auto">
            {/* Lab Mode: Device Selection */}
            {isLabMode && (
              <div className="p-4 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] space-y-3">
                <Label className="font-semibold text-sm text-[var(--dashboard-text)] flex items-center gap-2">
                  <Cog className="h-4 w-4 text-[var(--dashboard-accent)]" />
                  İşlem Yapılan Cihazı Seçin <span style={{ color: '#ef4444' }}>*</span>
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {devicesByLab.map(d => (
                    <button
                      key={d.id}
                      onClick={() => setPartAssignedDeviceId(d.id)}
                      className={`flex flex-col items-center p-2 rounded-xl border transition-all ${
                        partAssignedDeviceId === d.id 
                          ? 'bg-[var(--dashboard-accent)]/10 border-[var(--dashboard-accent)] text-[var(--dashboard-accent)]' 
                          : 'bg-[var(--dashboard-surface)] border-[var(--dashboard-stroke)] hover:bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]'
                      }`}
                    >
                      {d.imageUrl && (
                        <div className="w-10 h-10 mb-2 rounded-lg overflow-hidden relative border border-white/10">
                          <Image src={resolveImageSrc(d.imageUrl)} alt={d.cihazAdi || ''} fill className="object-cover" />
                        </div>
                      )}
                      <span className="text-[11px] font-bold truncate w-full text-center">{d.cihazAdi || d.model}</span>
                      <span className="text-[9px] opacity-70 truncate w-full text-center">SN: {d.seriNumarasi}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Section 1: Select part from personal stock or pool stock */}
            <div className="p-4 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] space-y-3">
              <Label className="font-semibold text-sm text-[var(--dashboard-text)]">1. Parça Seçin</Label>

              {/* Stock source tabs */}
              {!showManualEntry && (
                <div className="flex gap-1 p-1 rounded-xl bg-[var(--dashboard-surface)]" style={{ border: '1px solid var(--dashboard-stroke)' }}>
                  <button
                    onClick={() => { setStockSourceTab('personal'); setSelectedPoolStockItem(null); setSelectedDepotStockItem(null); }}
                    className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                    style={{
                      background: stockSourceTab === 'personal' ? 'var(--dashboard-surface-2)' : 'transparent',
                      color: stockSourceTab === 'personal' ? 'var(--dashboard-text)' : 'var(--dashboard-muted)',
                      boxShadow: stockSourceTab === 'personal' ? 'var(--dashboard-raised-soft)' : 'none',
                    }}
                  >
                    <Package className="h-3 w-3 inline mr-1" />
                    Şahsi Stok ({personalStock.filter(p => !usedPersonalStockIds.has(p.id)).length})
                  </button>
                  <button
                    onClick={() => { setStockSourceTab('pool'); setSelectedStockItem(null); setSelectedDepotStockItem(null); }}
                    className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                    style={{
                      background: stockSourceTab === 'pool' ? 'var(--dashboard-surface-2)' : 'transparent',
                      color: stockSourceTab === 'pool' ? 'var(--dashboard-text)' : 'var(--dashboard-muted)',
                      boxShadow: stockSourceTab === 'pool' ? 'var(--dashboard-raised-soft)' : 'none',
                    }}
                  >
                    <Package className="h-3 w-3 inline mr-1" />
                    Havuz Stok ({poolStockItems.filter(p => !usedPoolStockIds.has(p.id)).length})
                  </button>
                  <button
                    onClick={() => { setStockSourceTab('depot'); setSelectedStockItem(null); setSelectedPoolStockItem(null); }}
                    className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                    style={{
                      background: stockSourceTab === 'depot' ? 'var(--dashboard-surface-2)' : 'transparent',
                      color: stockSourceTab === 'depot' ? 'var(--dashboard-text)' : 'var(--dashboard-muted)',
                      boxShadow: stockSourceTab === 'depot' ? 'var(--dashboard-raised-soft)' : 'none',
                    }}
                  >
                    <Package className="h-3 w-3 inline mr-1" />
                    Depo Stok ({selectableDepotStock.length})
                  </button>
                </div>
              )}

              {!showManualEntry && stockSourceTab === 'personal' ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Parça kodu, adı veya seri no ile arayın..."
                      value={partSearchQuery}
                      onChange={(e) => setPartSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <ScrollArea className="h-44 rounded-xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
                    {filteredStock.length === 0 ? (
                      <div className="p-4 text-center text-[var(--dashboard-muted)]">
                        {personalStock.filter(p => !usedPersonalStockIds.has(p.id)).length === 0
                          ? 'Şahsi stokunuzda eklenebilir yedek parça bulunmuyor.'
                          : 'Sonuç bulunamadı.'}
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredStock.map(item => (
                          <button
                            key={item.id}
                            onClick={() => selectPersonalStockItem(item)}
                            className={`w-full text-left p-3 rounded-xl transition-colors ${
                              selectedStockItem?.id === item.id
                                ? 'bg-[var(--dashboard-accent)]/10 border border-[var(--dashboard-accent)]/40'
                                : 'hover:bg-[var(--dashboard-surface-2)] border border-transparent'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-[var(--dashboard-text)]">{item.stokAdi}</p>
                                <p className="text-xs text-[var(--dashboard-muted)] font-mono">{item.stokKodu} {item.anaBirim ? `· ${item.anaBirim.toLocaleLowerCase('tr-TR')}` : ''}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono text-[var(--dashboard-text)]">{item.serialNumber}</p>
                                <p className="text-xs text-[var(--dashboard-muted)]">
                                  {item.source === 'depot' ? 'Depodan' : 'Cihazdan'}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <button
                    onClick={activateManualEntry}
                    className="w-full text-xs text-[var(--dashboard-accent)] hover:text-[var(--dashboard-accent)]/80 flex items-center justify-center gap-2 py-2 font-medium transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Stokta yok, manuel ekle
                  </button>
                </>
              ) : !showManualEntry && stockSourceTab === 'pool' ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Havuz stokta ara..."
                      value={partSearchQuery}
                      onChange={(e) => setPartSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <ScrollArea className="h-44 rounded-xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
                    {filteredPoolStock.length === 0 ? (
                      <div className="p-4 text-center text-[var(--dashboard-muted)]">
                        {poolStockItems.filter(p => !usedPoolStockIds.has(p.id)).length === 0
                          ? 'Havuz depoda eklenebilir yedek parça bulunmuyor.'
                          : 'Sonuç bulunamadı.'}
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredPoolStock.map(item => (
                          <button
                            key={item.id}
                            onClick={() => selectPoolStockItem(item)}
                            className={`w-full text-left p-3 rounded-xl transition-colors ${
                              selectedPoolStockItem?.id === item.id
                                ? 'bg-purple-500/10 border border-purple-500/40'
                                : 'hover:bg-[var(--dashboard-surface-2)] border border-transparent'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-[var(--dashboard-text)]">{item.stokAdi}</p>
                                <p className="text-xs text-[var(--dashboard-muted)] font-mono">{item.stokKodu} {item.anaBirim ? `· ${item.anaBirim.toLocaleLowerCase('tr-TR')}` : ''}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono text-[var(--dashboard-text)]">{item.serialNumber || '—'}</p>
                                <p className="text-xs text-purple-600 font-medium">{item.poolWarehouseName}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <button
                    onClick={activateManualEntry}
                    className="w-full text-xs text-[var(--dashboard-accent)] hover:text-[var(--dashboard-accent)]/80 flex items-center justify-center gap-2 py-2 font-medium transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Stokta yok, manuel ekle
                  </button>
                </>
              ) : !showManualEntry && stockSourceTab === 'depot' ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Depo stokta ara..."
                      value={partSearchQuery}
                      onChange={(e) => setPartSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <ScrollArea className="h-44 rounded-xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
                    {filteredDepotStock.length === 0 ? (
                      <div className="p-4 text-center text-[var(--dashboard-muted)]">
                        {selectableDepotStock.length === 0 ? 'Depoda eklenebilir yedek parça bulunmuyor.' : 'Sonuç bulunamadı.'}
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredDepotStock.map(item => (
                          <button
                            key={`${item.id || item.stokKodu}-${item.hucreNumarasi || item.serialNumber || 'qty'}`}
                            onClick={() => { handleDepotItemSelect(item); }}
                            className={`w-full text-left p-3 rounded-xl transition-colors ${
                              selectedDepotStockItem?.id === item.id && selectedDepotStockItem?.stokKodu === item.stokKodu
                                ? 'bg-orange-500/10 border border-orange-500/40'
                                : 'hover:bg-[var(--dashboard-surface-2)] border border-transparent'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-[var(--dashboard-text)]">{item.stokAdi}</p>
                                <p className="text-xs text-[var(--dashboard-muted)] font-mono">
                                  {item.stokKodu}
                                  {item.serialNumber ? ` · SN:${item.serialNumber}` : ''}
                                  {item.hucreNumarasi ? ` · H:${item.hucreNumarasi}` : ''}
                                  {!item.serialNumber && !item.hucreNumarasi ? ` · ${item.totalQuantity} adet` : ''}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono text-[var(--dashboard-text)]">{item.serialNumber || item.hucreNumarasi || `${item.totalQuantity} adet`}</p>
                                <p className="text-xs text-orange-600 font-medium">{item.address || 'Depo'}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <button
                    onClick={activateManualEntry}
                    className="w-full text-xs text-[var(--dashboard-accent)] hover:text-[var(--dashboard-accent)]/80 flex items-center justify-center gap-2 py-2 font-medium transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Stokta yok, manuel ekle
                  </button>
                </>
              ) : showManualEntry ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Parça Kodu <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="Kod..."
                        value={manualPartCode}
                        onChange={(e) => setManualPartCode(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Seri No {(!pendingPeriodicPartChangeId || periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)?.requiresSerialTracking) && <span className="text-destructive">*</span>}</Label>
                      <Input
                        placeholder="Seri No..."
                        value={manualSerialNumber}
                        onChange={(e) => setManualSerialNumber(e.target.value)}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Parça Adı <span className="text-destructive">*</span></Label>
                    <Input
                      placeholder="Parça adını girin..."
                      value={manualPartName}
                      onChange={(e) => setManualPartName(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <button
                    onClick={() => setShowManualEntry(false)}
                    className="text-xs text-[var(--dashboard-accent)] hover:text-[var(--dashboard-accent)]/80 font-medium transition-colors"
                  >
                    Stoktan seç
                  </button>
                </div>
              ) : null}
            </div>

            {/* Section 2: Removed part info (from device) */}
            <div className={`p-4 rounded-2xl space-y-3 ${(!pendingPeriodicPartChangeId || periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)?.requiresOutgoingPartInfo) ? 'border border-amber-200/60 bg-amber-50/60' : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]'}`}>
              <Label className="font-semibold text-sm flex items-center gap-2 text-[var(--dashboard-text)]">
                2. Cihazdan Çıkan Parça Bilgisi
                {(!pendingPeriodicPartChangeId || periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)?.requiresOutgoingPartInfo)
                  ? <span className="text-xs font-normal text-muted-foreground">(zorunlu)</span>
                  : <span className="text-xs font-normal text-muted-foreground">(opsiyonel)</span>
                }
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Parça Kodu</Label>
                  <Input
                    placeholder="Takılan parçadan otomatik doldurulur"
                    value={removedPartStokKodu}
                    readOnly
                    className="h-9 bg-muted/50"
                  />
                  <p className="text-xs text-muted-foreground">Takılan parçanın kodundan otomatik alınır.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Seri No <span className="text-muted-foreground">(Opsiyonel)</span></Label>
                  <Input
                    placeholder="Çıkan parça seri no..."
                    value={removedPartSerialNumber}
                    onChange={(e) => setRemovedPartSerialNumber(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Parça Adı</Label>
                <Input
                  placeholder="Takılan parçadan otomatik doldurulur"
                  value={removedPartStokAdi}
                  readOnly
                  className="h-9 bg-muted/50"
                />
                <p className="text-xs text-muted-foreground">Takılan parçanın adından otomatik alınır.</p>
              </div>
              {/* Removed/used part image upload */}
              <div className="space-y-3 pt-2 border-t border-amber-200/50">
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    Çıkan Parça Fotoğrafı (Opsiyonel)
                  </Label>
                  <input
                    type="file"
                    accept="image/*"
                    ref={removedPartImageInputRef}
                    onChange={handleRemovedPartImageSelect}
                    className="hidden"
                  />
                  {removedPartImagePreview ? (
                    <div className="relative">
                      <img
                        src={removedPartImagePreview}
                        alt="Çıkan parça"
                        className="w-full h-32 object-cover rounded-md border"
                      />
                      <button
                        type="button"
                        className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
                        onClick={() => {
                          setRemovedPartImageFile(null);
                          setRemovedPartImagePreview(null);
                          if (removedPartImageInputRef.current) {
                            removedPartImageInputRef.current.value = '';
                          }
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-full h-16 border border-dashed border-[var(--dashboard-stroke)] rounded-xl flex flex-col items-center justify-center gap-1 hover:bg-[var(--dashboard-surface-2)] transition-colors"
                      onClick={() => removedPartImageInputRef.current?.click()}
                    >
                      <ImageIcon className="h-5 w-5 text-[var(--dashboard-muted)]" />
                      <span className="text-xs text-[var(--dashboard-muted)]">Çıkan parça fotoğrafı (Kamera/Galeri)</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    Takılan/Kullanılan Parça Fotoğrafı (Opsiyonel)
                  </Label>
                  <input
                    type="file"
                    accept="image/*"
                    ref={usedPartImageInputRef}
                    onChange={handleUsedPartImageSelect}
                    className="hidden"
                  />
                  {usedPartImagePreview ? (
                    <div className="relative">
                      <img
                        src={usedPartImagePreview}
                        alt="Takılan parça"
                        className="w-full h-32 object-cover rounded-md border"
                      />
                      <button
                        type="button"
                        className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
                        onClick={() => {
                          setUsedPartImageFile(null);
                          setUsedPartImagePreview(null);
                          if (usedPartImageInputRef.current) {
                            usedPartImageInputRef.current.value = '';
                          }
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-full h-16 border border-dashed border-[var(--dashboard-stroke)] rounded-xl flex flex-col items-center justify-center gap-1 hover:bg-[var(--dashboard-surface-2)] transition-colors"
                      onClick={() => usedPartImageInputRef.current?.click()}
                    >
                      <ImageIcon className="h-5 w-5 text-[var(--dashboard-muted)]" />
                      <span className="text-xs text-[var(--dashboard-muted)]">Takılan parça fotoğrafı (Kamera/Galeri)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Selected item summary */}
            {(selectedStockItem || selectedPoolStockItem || selectedDepotStockItem || (showManualEntry && manualPartCode && manualSerialNumber)) && (
              <div className={`p-3 border rounded-xl text-sm ${selectedPoolStockItem ? 'bg-purple-50/80 border-purple-200/60' : selectedDepotStockItem ? 'bg-orange-50/80 border-orange-200/60' : 'bg-emerald-50/80 border-emerald-200/60'}`}>
                <p className={`font-medium ${selectedPoolStockItem ? 'text-purple-800' : selectedDepotStockItem ? 'text-orange-800' : 'text-emerald-800'}`}>
                  Takılacak: {selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || selectedDepotStockItem?.stokAdi || manualPartName} ({selectedStockItem?.serialNumber || selectedPoolStockItem?.serialNumber || selectedDepotStockItem?.serialNumber || selectedDepotStockItem?.hucreNumarasi || manualSerialNumber || `${partQuantity} adet`})
                  {selectedPoolStockItem && <span className="ml-1 text-xs text-purple-600">(Havuz: {selectedPoolStockItem.poolWarehouseName})</span>}
                  {selectedDepotStockItem && <span className="ml-1 text-xs text-orange-600">(Depo)</span>}
                </p>
                <p className={selectedPoolStockItem ? 'text-purple-700' : selectedDepotStockItem ? 'text-orange-700' : 'text-emerald-700'}>
                  Çıkacak: {removedPartStokAdi || selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || selectedDepotStockItem?.stokAdi || manualPartName} ({removedPartSerialNumber || 'Seri No Yok'})
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="px-4 sm:px-6 py-3 sm:py-4 border-t border-[var(--dashboard-stroke)] grid grid-cols-2 gap-2 sm:flex sm:justify-end sm:gap-2">
            <button className="w-full sm:w-auto cihaz-tool-item px-4 py-2.5 text-sm font-medium" onClick={() => setIsPartModalOpen(false)}>İptal</button>
            <button
              className="w-full sm:w-auto cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              onClick={addSelectedPart}
              disabled={
                (!selectedStockItem && !selectedPoolStockItem && !selectedDepotStockItem && !(showManualEntry && manualPartCode && manualPartName && (!pendingPeriodicPartChangeId || periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)?.requiresSerialTracking !== false ? manualSerialNumber : true)))
                || isUploadingImage
              }
            >
              {isUploadingImage ? <><Loader2 className="h-4 w-4 animate-spin" />Yükleniyor...</> : 'Ekle'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDepotQuantityDialogOpen} onOpenChange={setIsDepotQuantityDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Depo Adet Seçimi</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {pendingDepotStockItem?.stokAdi} için depoda toplam <strong>{pendingDepotStockItem?.totalQuantity || 0}</strong> adet mevcut.
            </p>
            <div className="space-y-1">
              <Label>Kaç adet kullanılacak?</Label>
              <Input
                type="number"
                min={1}
                max={pendingDepotStockItem?.totalQuantity || 1}
                value={depotRequestedQuantity}
                onChange={(e) => setDepotRequestedQuantity(Math.max(1, Math.min(pendingDepotStockItem?.totalQuantity || 1, parseInt(e.target.value, 10) || 1)))}
              />
            </div>
          </div>
          <DialogFooter>
            <button className="cihaz-tool-item px-4 py-2.5 text-sm font-medium" onClick={() => { setIsDepotQuantityDialogOpen(false); setPendingDepotStockItem(null); }}>İptal</button>
            <button className="cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-accent)] text-white" onClick={confirmDepotQuantitySelection}>Seçimi Onayla</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Pre-Signature & Signature Modal */}
      <Dialog open={isSignatureModalOpen} onOpenChange={setIsSignatureModalOpen}>
        <DialogContent className="wizard-modal">
          <div className="wizard-modal-title">
            {signatureStep === 'pre_questions' ? 'Form Bilgileri' : 'İmza'}
          </div>

          {/* Pre-Signature Questions */}
          {signatureStep === 'pre_questions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Cihaz Durumu */}
              <div>
                <label className="wizard-modal-label" style={{ display: 'block', marginBottom: '10px', fontSize: '15px' }}>
                  Cihaz Durumu <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <RadioGroup value={cihazDurumu} onValueChange={(v) => setCihazDurumu(v as CihazDurumu)}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="calisiyor" id="calisiyor" />
                    <Label htmlFor="calisiyor" style={{ color: 'var(--wz-text)' }}>Çalışıyor</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="arizali" id="arizali" />
                    <Label htmlFor="arizali" style={{ color: 'var(--wz-text)' }}>Arızalı</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="denemede" id="denemede" />
                    <Label htmlFor="denemede" style={{ color: 'var(--wz-text)' }}>Denemede</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="diger" id="diger" />
                    <Label htmlFor="diger" style={{ color: 'var(--wz-text)' }}>Diğer</Label>
                  </div>
                </RadioGroup>
                {cihazDurumu === 'diger' && (
                  <input
                    type="text"
                    placeholder="Açıklama (zorunlu)"
                    value={cihazDurumuAciklama}
                    onChange={(e) => setCihazDurumuAciklama(e.target.value)}
                    style={{ marginTop: '8px' }}
                  />
                )}
              </div>

              {/* Eşlik Eden Personel */}
              <div>
                <label className="wizard-modal-label" style={{ display: 'block', marginBottom: '6px', fontSize: '15px' }}>
                  Eşlik Eden Personel <span className="wizard-modal-sublabel">(Opsiyonel)</span>
                </label>
                <div style={{ position: 'relative', marginBottom: '8px' }}>
                  <Search style={{ position: 'absolute', left: '12px', top: '12px', width: '16px', height: '16px', color: 'var(--wz-text-secondary)' }} />
                  <input
                    type="text"
                    placeholder="Personel ara..."
                    value={personelSearchQuery}
                    onChange={(e) => setPersonelSearchQuery(e.target.value)}
                    style={{ paddingLeft: '36px' }}
                  />
                </div>
                <div className="wizard-personel-list">
                  {filteredUsers.map(user => (
                    <div
                      key={user.uid}
                      className={`wizard-personel-item ${eslikEdenPersonel.find(p => p.uid === user.uid) ? 'selected' : ''}`}
                      onClick={() => toggleEslikEdenPersonel(user)}
                    >
                      <div>
                        <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--wz-text)' }}>{user.name || user.email}</div>
                        <div style={{ fontSize: '12px', color: 'var(--wz-text-secondary)', textTransform: 'capitalize' }}>{user.role?.replace('_', ' ')}</div>
                      </div>
                      {eslikEdenPersonel.find(p => p.uid === user.uid) && (
                        <span style={{ color: 'var(--wz-accent)', fontSize: '12px', fontWeight: 600 }}>Seçildi</span>
                      )}
                    </div>
                  ))}
                </div>
                {eslikEdenPersonel.length > 0 && (
                  <p style={{ fontSize: '13px', color: 'var(--wz-text-secondary)', marginTop: '8px' }}>
                    Seçilen: {eslikEdenPersonel.map(p => p.name).join(', ')}
                  </p>
                )}
              </div>

              <div className="wizard-modal-footer">
                <button className="wizard-modal-btn wizard-modal-btn-ghost" onClick={() => setIsSignatureModalOpen(false)}>İptal</button>
                <button className="wizard-modal-btn wizard-modal-btn-primary" onClick={proceedToSignature}>İmzaya Geç</button>
              </div>
            </div>
          )}

          {/* Personnel Signature */}
          {signatureStep === 'personnel' && (
            <div>
              <p style={{ marginBottom: '8px', fontSize: '14px', color: 'var(--wz-text-secondary)' }}>İşlemi Yapan Personel</p>
              <div className="wizard-sig-area">
                <SignaturePad ref={personnelSignatureRef} />
              </div>
              <div className="wizard-modal-footer">
                <button className="wizard-modal-btn wizard-modal-btn-ghost" onClick={() => { personnelSignatureRef.current?.clear(); }}>Temizle</button>
                <button className="wizard-modal-btn wizard-modal-btn-ghost" onClick={() => setSignatureStep('pre_questions')}>Geri</button>
                <button className="wizard-modal-btn wizard-modal-btn-ghost" onClick={() => handleSaveSignaturesAndFinish({})}>Atla</button>
                <button className="wizard-modal-btn wizard-modal-btn-primary" onClick={() => {
                  const sig = personnelSignatureRef.current?.getSignature();
                  if (sig) {
                    setSignatures({ personnel: sig });
                    setSignatureStep('technician');
                  } else {
                    setSignatureStep('technician');
                  }
                }}>Devam Et</button>
              </div>
            </div>
          )}

          {/* Technician Signature */}
          {signatureStep === 'technician' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="wizard-modal-label" style={{ display: 'block', marginBottom: '6px', fontSize: '14px' }}>Teknisyen Adı Soyadı</label>
                <input
                  type="text"
                  value={technicianName}
                  onChange={(e) => setTechnicianName(e.target.value)}
                  placeholder="Ad Soyad giriniz..."
                />
              </div>
              <div>
                <p style={{ marginBottom: '8px', fontSize: '14px', color: 'var(--wz-text-secondary)' }}>İmza</p>
                <div className="wizard-sig-area">
                  <SignaturePad ref={technicianSignatureRef} />
                </div>
              </div>
              <div className="wizard-modal-footer">
                <button className="wizard-modal-btn wizard-modal-btn-ghost" onClick={() => { technicianSignatureRef.current?.clear(); }}>Temizle</button>
                <button className="wizard-modal-btn wizard-modal-btn-ghost" onClick={() => setSignatureStep('personnel')}>Geri</button>
                <button className="wizard-modal-btn wizard-modal-btn-ghost" onClick={() => handleSaveSignaturesAndFinish(signatures, technicianName)}>Atla</button>
                <button className="wizard-modal-btn wizard-modal-btn-primary" onClick={() => {
                  const techSig = technicianSignatureRef.current?.getSignature();
                  handleSaveSignaturesAndFinish({ ...signatures, technician: techSig }, technicianName);
                }}>Tamamla ve Kaydet</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Test Selection Modal */}
      <Dialog open={isTestModalOpen} onOpenChange={setIsTestModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>İlişkili Test Seç</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[var(--dashboard-muted)] mb-4">
              Arızayla ilişkili testleri seçin. Bu bilgi arıza istatistiklerine yansıtılacaktır.
            </p>
            <ScrollArea className="h-64 rounded-xl border border-[var(--dashboard-stroke)]">
              <div className="p-2 space-y-1">
                {availableTests.map(test => (
                  <button
                    key={test}
                    onClick={() => {
                      setSelectedTests(prev =>
                        prev.includes(test)
                          ? prev.filter(t => t !== test)
                          : [...prev, test]
                      );
                    }}
                    className={`w-full text-left p-2 rounded-xl transition-colors flex items-center justify-between ${
                      selectedTests.includes(test)
                        ? 'bg-[var(--dashboard-accent)]/10 border border-[var(--dashboard-accent)]/40'
                        : 'hover:bg-[var(--dashboard-surface-2)] border border-transparent'
                    }`}
                  >
                    <span className="font-medium text-[var(--dashboard-text)]">{test}</span>
                    {selectedTests.includes(test) && (
                      <span className="text-[var(--dashboard-accent)] text-sm font-medium">Seçildi</span>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter className="gap-2">
            <button onClick={() => setIsTestModalOpen(false)} className="cihaz-tool-item px-4 py-2.5 text-sm font-medium">Kapat</button>
            <button onClick={() => setIsTestModalOpen(false)} className="cihaz-tool-item px-4 py-2.5 text-sm font-medium bg-[var(--dashboard-accent)] text-white">
              Tamam ({selectedTests.length} test)
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
