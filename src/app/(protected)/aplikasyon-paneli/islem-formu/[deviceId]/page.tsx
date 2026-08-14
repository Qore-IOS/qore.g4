'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { db, storage } from '@/lib/firebase';
import { doc, getDoc, collection, addDoc, serverTimestamp, query, getDocs, where, orderBy, updateDoc, Timestamp, writeBatch, setDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { Device, Hospital, ProductCode, User, MaintenancePlan, MaintenanceLog, PersonalStockItem, PeriodicPartChange, PeriodicPartChangeLog, MaintenancePeriodUnit, FaultDefinition, DraftActionLog, PoolWarehouseStockItem, Depot, DeviceLabPool, YedekParcaDepoStokItem } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WizardFormSkeleton } from '@/components/perf/PanelSkeletons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Wrench, ClipboardList, Trash2, Save, History, Search, Plus, FileText, Cog, Camera, ImageIcon, X, Package, AlertTriangle, Clock, PauseCircle, ChevronLeft, Building2, Download, Upload, MessageCircle } from 'lucide-react';
import { ToastAction } from '@/components/ui/toast';
import { Textarea } from '@/components/ui/textarea';
import WizardFormShell, { hapticDouble } from '@/components/islem-formu/WizardFormShell';
import type { WizardHeading } from '@/components/islem-formu/WizardFormShell';
import Image from 'next/image';
import { resolveImageSrc } from '@/lib/image-utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import SignaturePad from '@/components/SignaturePad';
import type { SignaturePadRef } from '@/components/SignaturePad';
import { buildDepotSelectableItems, type DepotSelectableStockItem } from '@/lib/spare-part-depot';
import { filterByCompanyScope } from '@/lib/company-scope';
import { reserveActionFormNumber } from '@/lib/form-number';
import { cariCozAsync, enqueueIrsaliyeGirisAyri } from '@/lib/ceomed/enqueue-irsaliye-giris';
import type { BuildIrsaliyeGirisInput } from '@/lib/ceomed/irsaliye-giris';
import { useQueryClient } from '@tanstack/react-query';
import {
  useProductCodes,
  useUsers,
  useFaultDefinitions,
  useMinMaxRules,
  useMaintenancePlansForDevice,
  useMaintenanceLogsForDevice,
} from '@/hooks/useFirebaseQueries';

// Operation types (Yapılan İşlem)
type OperationType =
  | 'aplikasyon_kontrol'
  | 'kalibrasyon_kontrol'
  | 'qc_materyal_kontrol'
  | 'ornek_sonucu_karsilastirma'
  | 'reaktif_yenileme'
  | 'kalibrator_yenileme'
  | 'qc_yenileme'
  | 'cv_calismasi'
  | 'diger';

// İşlem Türü
type IslemTuru = 'rutin_kurum_ziyareti' | 'periyodik_bakim' | 'ariza' | 'alis' | 'roche_bilgisayar_arizasi' | 'egitim' | 'diger' | '';

// İşlem Türü Labels
const ISLEM_TURU_LABELS: Record<IslemTuru, string> = {
  '': 'Seçiniz',
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  ariza: 'Arıza',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
  egitim: 'Eğitim',
  diger: 'Diğer',
};

// Cihaz Durumu
type CihazDurumu = 'calisiyor' | 'arizali' | 'denemede' | 'diger' | '';

type ActionItem = {
  id: string;
  type: 'part_change' | 'operation' | 'hucre_degisimi';
  action: string;
  productCodeId?: string;
  stokKodu?: string;
  stokAdi?: string;
  anaBirim?: string;
  quantity: number;
  description?: string;
  isManualEntry?: boolean;
  // Personal stock info for part changes
  personalStockId?: string;
  poolStockId?: string;
  depotStockId?: string;
  isDepotSelection?: boolean;
  poolWarehouseId?: string;
  poolWarehouseName?: string;
  serialNumber?: string;
  /** Kaynak stok kaydından taşınan lot numarası — Ceomed irsaliye girişi lot alanı için. */
  lotNumber?: string;
  hucreNumarasi?: string;
  removedHucreNumarasi?: string;
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
  assignedDeviceId?: string;
};

type ActionFormRecord = {
    id: string;
    createdAt: { toDate: () => Date };
    createdByName: string;
    actions: ActionItem[];
    cihazDurumu?: CihazDurumu;
    cihazDurumuAciklama?: string;
    eslikEdenPersonel?: { uid: string; name: string; role: string }[];
    personnelSignature?: string;
    technicianSignature?: string;
};

const CIHAZ_DURUMU_LABELS: Record<CihazDurumu, string> = {
  '': 'Seçiniz',
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

const OPERATION_LABELS: Record<OperationType, string> = {
  aplikasyon_kontrol: 'Aplikasyon Kontrol',
  kalibrasyon_kontrol: 'Kalibrasyon Kontrol',
  qc_materyal_kontrol: 'QC Materyal Kontrol',
  ornek_sonucu_karsilastirma: 'Örnek Sonucu Karşılaştırma',
  reaktif_yenileme: 'Reaktif Yenileme',
  kalibrator_yenileme: 'Kalibratör Yenileme',
  qc_yenileme: 'QC Yenileme',
  cv_calismasi: 'CV Çalışması',
  diger: 'Diğer',
};

const ALL_OPERATIONS: OperationType[] = [
  'aplikasyon_kontrol',
  'kalibrasyon_kontrol',
  'qc_materyal_kontrol',
  'ornek_sonucu_karsilastirma',
  'reaktif_yenileme',
  'kalibrator_yenileme',
  'qc_yenileme',
  'cv_calismasi',
  'diger',
];

type ExcelImportRow = {
  baslangicTarihi: string;
  baslangicSaati: string;
  bitisTarihi: string;
  bitisSaati: string;
  islemTuru: IslemTuru;
  aciklama: string;
  cihazDurumu: CihazDurumu;
  cihazDurumuAciklama: string;
  yapilanIslemler: string[];
  selectedFaultName: string;
  yedekParcaKodu: string;
  yedekParcaAdi: string;
  yedekParcaSeriNo: string;
  yedekParcaAdet: number;
  cikanParcaKodu: string;
  cikanParcaAdi: string;
  cikanParcaSeriNo: string;
};

export default function AplikasyonIslemFormuPage() {
  const params = useParams();
  const rawDeviceId = params ? (Array.isArray(params.deviceId) ? params.deviceId[0] : params.deviceId as string) : '';
  const isLabMode = rawDeviceId.startsWith('lab-');
  const actualDeviceId = isLabMode ? '' : rawDeviceId;
  const hospitalIdFromLab = isLabMode ? rawDeviceId.replace('lab-', '') : null;
  const deviceId = rawDeviceId; // For backward compatibility with existing code
  
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdFromUrl = searchParams?.get('draftId') || null;
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [device, setDevice] = useState<Device | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [draftActionLogs, setDraftActionLogs] = useState<DraftActionLog[]>([]);
  const [aciklama, setAciklama] = useState('');
  const [islemTuru, setIslemTuru] = useState<IslemTuru>('');
  const [devicesByLab, setDevicesByLab] = useState<Device[]>([]);
  const [isLabLoading, setIsLabLoading] = useState(false);

  // Başlangıç ve Bitiş Saatleri/Tarihleri (Zorunlu)
  const [baslangicSaati, setBaslangicSaati] = useState<string>('');
  const [bitisSaati, setBitisSaati] = useState<string>('');
  const [baslangicTarihi, setBaslangicTarihi] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [bitisTarihi, setBitisTarihi] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Tarih/saat seçiminde henüz gelmemiş (gelecek) bir zaman seçilmesini engelle.
  // "max" attribute'u ileri günleri, aşağıdaki handler'lar ise ileri saatleri engeller.
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');

  const isFutureDateTime = (dateStr: string, timeStr: string): boolean => {
    if (!dateStr) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return false;
    let hh = 0;
    let mm = 0;
    if (timeStr) {
      const [h, min] = timeStr.split(':').map(Number);
      hh = Number.isFinite(h) ? h : 0;
      mm = Number.isFinite(min) ? min : 0;
    }
    const selected = new Date(y, m - 1, d, hh, mm, 0, 0);
    return selected.getTime() > Date.now();
  };

  const handleDateChange = (field: 'baslangic' | 'bitis', value: string) => {
    const timeStr = field === 'baslangic' ? baslangicSaati : bitisSaati;
    if (isFutureDateTime(value, timeStr)) {
      toast({ title: 'Geçersiz Tarih', description: 'İleri bir tarih seçilemez. Henüz gelmemiş bir tarih seçtiniz.', variant: 'destructive' });
      return;
    }
    if (field === 'baslangic') setBaslangicTarihi(value);
    else setBitisTarihi(value);
  };

  const handleTimeChange = (field: 'baslangic' | 'bitis', value: string) => {
    const dateStr = field === 'baslangic' ? baslangicTarihi : bitisTarihi;
    if (isFutureDateTime(dateStr, value)) {
      toast({ title: 'Geçersiz Saat', description: 'İleri bir saat seçilemez. Henüz gelmemiş bir saat seçtiniz.', variant: 'destructive' });
      return;
    }
    if (field === 'baslangic') setBaslangicSaati(value);
    else setBitisSaati(value);
  };


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
  const [personelSearchQuery, setPersonelSearchQuery] = useState('');

  // ─── Cached master data (TanStack Query) ───
  // Shared cache with other panels. After successful form submit we invalidate
  // device-scoped queries so the next mount/visit shows the freshly written logs.
  const queryClient = useQueryClient();
  const usersQueryHook = useUsers();
  const faultDefinitionsQuery = useFaultDefinitions('aplikasyon');
  const productCodesQueryForTests = useProductCodes();

  // Operation selection modal
  const [isOperationModalOpen, setIsOperationModalOpen] = useState(false);
  const [selectedOperations, setSelectedOperations] = useState<OperationType[]>([]);
  const [digerAciklama, setDigerAciklama] = useState('');

  // Part selection modal - now using personal stock
  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [partAssignedDeviceId, setPartAssignedDeviceId] = useState<string>('');
  const [personalStock, setPersonalStock] = useState<PersonalStockItem[]>([]);
  const [poolStockItems, setPoolStockItems] = useState<PoolWarehouseStockItem[]>([]);
  const [depotStockItems, setDepotStockItems] = useState<YedekParcaDepoStokItem[]>([]);
  const [selectedPoolStockItem, setSelectedPoolStockItem] = useState<PoolWarehouseStockItem | null>(null);
  const [selectedDepotStockItem, setSelectedDepotStockItem] = useState<DepotSelectableStockItem | null>(null);
  const [pendingDepotStockItem, setPendingDepotStockItem] = useState<DepotSelectableStockItem | null>(null);
  const [depotRequestedQuantity, setDepotRequestedQuantity] = useState(1);
  const [isDepotQuantityDialogOpen, setIsDepotQuantityDialogOpen] = useState(false);
  const [stockSourceTab, setStockSourceTab] = useState<'personal' | 'pool' | 'depot'>('personal');
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const [selectedStockItem, setSelectedStockItem] = useState<PersonalStockItem | null>(null);
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

  // Maintenance plans for periyodik bakım — sourced from TanStack Query.
  const maintenancePlansQuery = useMaintenancePlansForDevice(deviceId || null, 'aplikasyon');
  const maintenanceLogsQuery = useMaintenanceLogsForDevice(deviceId || null);
  const minMaxRulesQuery = useMinMaxRules(device?.hospitalId || null);
  const [selectedMaintenanceTasks, setSelectedMaintenanceTasks] = useState<string[]>([]);

  // Periodic part changes for periyodik bakım — kept as raw fetches (see comment
  // in teknik-servis form for rationale).
  const [periodicPartChanges, setPeriodicPartChanges] = useState<PeriodicPartChange[]>([]);
  const [periodicPartChangeLogs, setPeriodicPartChangeLogs] = useState<PeriodicPartChangeLog[]>([]);
  const [selectedPeriodicParts, setSelectedPeriodicParts] = useState<string[]>([]);
  const [pendingPeriodicPartChangeId, setPendingPeriodicPartChangeId] = useState<string | null>(null);
  const [isAutoStockConfirmOpen, setIsAutoStockConfirmOpen] = useState(false);
  const [autoStockPendingPartId, setAutoStockPendingPartId] = useState<string | null>(null);
  const [isAutoStockCreating, setIsAutoStockCreating] = useState(false);

  // Fault definitions, users, maintenance plans/logs and availableTests are all
  // derived from cached queries (see useMemo blocks below). Variable names are
  // preserved so the rest of the form continues to compile unchanged.
  const [selectedFaultId, setSelectedFaultId] = useState<string>('');
  const [customFaultName, setCustomFaultName] = useState<string>('');

  // Test selection for arıza
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  // Eğitim fields (optional; shown when islemTuru === 'egitim')
  const [egitimIcerigi, setEgitimIcerigi] = useState<string>('');
  const [egitimKatilanlar, setEgitimKatilanlar] = useState<{ uid: string; name: string; role: string }[]>([]);
  const [egitimKatilanSearch, setEgitimKatilanSearch] = useState<string>('');

  useEffect(() => {
    if (!rawDeviceId) return;
    setLoading(true);
    (async () => {
      try {
        if (isLabMode && hospitalIdFromLab) {
          // Lab Mode: Fetch all devices for this hospital
          const q = scopedQuery('devices', currentCompanyId, isSuperAdmin, where('hospitalId', '==', hospitalIdFromLab));
          const snap = await getDocs(q);
          const devices = snap.docs.map(d => ({ id: d.id, ...d.data() } as Device));
          setDevicesByLab(devices);

          const hospitalSnap = await getDoc(doc(db, 'hospitals', hospitalIdFromLab));
          if (hospitalSnap.exists()) {
            setHospital({ id: hospitalSnap.id, ...hospitalSnap.data() } as Hospital);
          }
          if (devices.length > 0) setDevice(devices[0]);
          setLoading(false);
          return;
        }

        const deviceSnap = await getDoc(doc(db, 'devices', rawDeviceId));
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
      } catch (err) {
        console.error("Error fetching device/hospital data:", err);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    })();
  }, [rawDeviceId, isLabMode, hospitalIdFromLab, router, toast]);

  // Load draft if draftId is in URL
  useEffect(() => {
    if (!draftIdFromUrl || !rawDeviceId) return;
    (async () => {
      try {
        const draftSnap = await getDoc(doc(db, 'draftActionForms', draftIdFromUrl));
        if (draftSnap.exists()) {
          const draftData = draftSnap.data();
          setCurrentDraftId(draftIdFromUrl);
          if (draftData.actions) setActions(draftData.actions);
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
  }, [draftIdFromUrl, rawDeviceId, currentUserProfile?.uid, currentUserProfile?.name, toast]);

  // Fetch personal stock for current user
  useEffect(() => {
    if (!currentUserProfile?.uid) return;
    (async () => {
      try {
        const q = query(
          scopedQuery('personalStock', currentCompanyId, isSuperAdmin),
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
        const snap = await getDocs(scopedQuery('yedekParcaDepoStok', currentCompanyId, isSuperAdmin));
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
    if (!rawDeviceId) return;
    (async () => {
      try {
        const deviceSnap = isLabMode ? null : await getDoc(doc(db, 'devices', rawDeviceId));
        const hospitalId = isLabMode ? hospitalIdFromLab : deviceSnap?.data()?.hospitalId;
        if (!hospitalId) return;

        const poolsSnap = await getDocs(scopedQuery('deviceLabPools', currentCompanyId, isSuperAdmin));
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

        const depotsSnap = await getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin));
        const poolWarehouseIds: string[] = [];
        const companyScopedDepots = filterByCompanyScope(
          depotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Depot),
          currentCompanyId,
          isSuperAdmin
        );
        companyScopedDepots.forEach((depot: any) => {
          if (depot.isPoolWarehouse && depot.linkedDeviceLabPoolIds?.some((id: string) => matchingPoolIds.includes(id))) {
            poolWarehouseIds.push(depot.id);
          }
        });
        if (poolWarehouseIds.length === 0) return;

        const allPoolStock: PoolWarehouseStockItem[] = [];
        for (const pwId of poolWarehouseIds) {
          const stockQ = scopedQuery(
            'poolWarehouseStock',
            currentCompanyId,
            isSuperAdmin,
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

  // ─── Derivations from cached queries (TanStack Query) ───
  // These replace previous getDocs useEffect blocks. Cache is shared with the
  // teknik-servis form; first-render is instant on subsequent mounts.

  const allUsers = useMemo<User[]>(() => {
    const users = (usersQueryHook.data ?? []) as User[];
    return users.filter((u) => u.role === 'teknik_servis' || u.role === 'aplikasyon');
  }, [usersQueryHook.data]);

  const maintenancePlans = useMemo(
    () => (maintenancePlansQuery.data ?? []) as MaintenancePlan[],
    [maintenancePlansQuery.data],
  );

  const maintenanceLogs = useMemo<MaintenanceLog[]>(() => {
    const raw = (maintenanceLogsQuery.data ?? []) as Array<Record<string, any>>;
    return raw.map((data) => ({
      ...data,
      id: data.id,
      completedAt: data.completedAt instanceof Date
        ? data.completedAt
        : (data.completedAt?.toDate ? data.completedAt.toDate() : new Date(data.completedAt)),
      nextDueDate: data.nextDueDate instanceof Date
        ? data.nextDueDate
        : (data.nextDueDate?.toDate ? data.nextDueDate.toDate() : new Date(data.nextDueDate)),
    } as MaintenanceLog));
  }, [maintenanceLogsQuery.data]);

  // Fetch periodic part changes and logs for this device
  useEffect(() => {
    if (!rawDeviceId || isLabMode) return;
    (async () => {
      try {
        // Fetch periodic part changes for aplikasyon or both
        const partsQuery = scopedQuery(
          'periodicPartChanges',
          currentCompanyId,
          isSuperAdmin,
          where('deviceId', '==', deviceId)
        );
        const partsSnap = await getDocs(partsQuery);
        const allParts = partsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PeriodicPartChange);
        // Filter for aplikasyon or both responsibility
        const filteredParts = allParts.filter(p => p.responsibilityType === 'aplikasyon' || p.responsibilityType === 'both');
        setPeriodicPartChanges(filteredParts);

        // Fetch periodic part change logs for this device
        const logsQuery = scopedQuery(
          'periodicPartChangeLogs',
          currentCompanyId,
          isSuperAdmin,
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

  const faultDefinitions = useMemo(
    () => (faultDefinitionsQuery.data ?? []) as FaultDefinition[],
    [faultDefinitionsQuery.data],
  );

  const availableTests = useMemo<string[]>(() => {
    const rules = (minMaxRulesQuery.data ?? []) as Array<{ stokKodu?: string }>;
    const products = (productCodesQueryForTests.data ?? []) as Array<{ stokKodu?: string; testAdi?: string }>;
    if (!device?.hospitalId || rules.length === 0 || products.length === 0) return [];
    const stokSet = new Set(rules.map((r) => r.stokKodu).filter(Boolean));
    const testNames = new Set<string>();
    products.forEach((p) => {
      if (p.stokKodu && stokSet.has(p.stokKodu) && p.testAdi) testNames.add(p.testAdi);
    });
    return Array.from(testNames).sort();
  }, [device?.hospitalId, minMaxRulesQuery.data, productCodesQueryForTests.data]);

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

  const getDepotSelectionKey = (item: DepotSelectableStockItem) =>
    item.id || `group:${[...item.sourceEntryIds].sort().join('|')}`;

  const filteredDepotStock = useMemo(() => {
    const consumedByKey = new Map<string, number>();
    actions.forEach((action) => {
      if (action.type !== 'part_change' || !action.isDepotSelection || !action.depotStockId) return;
      const consumed = consumedByKey.get(action.depotStockId) || 0;
      consumedByKey.set(action.depotStockId, consumed + Math.max(1, action.quantity || 1));
    });

    const available = selectableDepotStock
      .map((item) => {
        const key = getDepotSelectionKey(item);
        const consumed = consumedByKey.get(key) || 0;
        const remainingQty = item.isGrouped ? Math.max(0, item.totalQuantity - consumed) : item.totalQuantity;
        return { ...item, totalQuantity: remainingQty };
      })
      .filter((item) => item.totalQuantity > 0);

    if (!partSearchQuery) return available;
    const q = partSearchQuery.toLowerCase();
    return available.filter((item) =>
      item.stokKodu.toLowerCase().includes(q) ||
      item.stokAdi.toLowerCase().includes(q) ||
      (item.serialNumber || '').toLowerCase().includes(q) ||
      (item.hucreNumarasi || '').toLowerCase().includes(q)
    );
  }, [actions, partSearchQuery, selectableDepotStock]);

  const selectedDepotStockKey = selectedDepotStockItem ? getDepotSelectionKey(selectedDepotStockItem) : null;

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
    batch.set(depotStockRef, withCompanyScope({
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
    }, currentCompanyId));

    const depoInLogRef = doc(collection(db, 'yedekParcaDepoLog'));
    batch.set(depoInLogRef, withCompanyScope({
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
    }, currentCompanyId));

    batch.delete(depotStockRef);

    const personalStockRef = doc(collection(db, 'personalStock'));
    batch.set(personalStockRef, withCompanyScope({
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
    }, currentCompanyId));

    const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
    batch.set(transferLogRef, withCompanyScope({
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
    }, currentCompanyId));

    const depoOutLogRef = doc(collection(db, 'yedekParcaDepoLog'));
    batch.set(depoOutLogRef, withCompanyScope({
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
    }, currentCompanyId));

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
        lotNumber: matchingStockItem.lotNumber,
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
    if (isLabMode && !partAssignedDeviceId) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen önce işlem yapılacak cihazı seçin.', variant: 'destructive' });
      return;
    }
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
    if (isLabMode && !partAssignedDeviceId) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen önce işlem yapılacak cihazı seçin.', variant: 'destructive' });
      return;
    }
    setSelectedStockItem(item);
    setSelectedPoolStockItem(null);
    setSelectedDepotStockItem(null);
    setPendingDepotStockItem(null);
    setIsDepotQuantityDialogOpen(false);
  };

  const selectPoolStockItem = (item: PoolWarehouseStockItem) => {
    if (isLabMode && !partAssignedDeviceId) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen önce işlem yapılacak cihazı seçin.', variant: 'destructive' });
      return;
    }
    setSelectedPoolStockItem(item);
    setSelectedStockItem(null);
    setSelectedDepotStockItem(null);
    setPendingDepotStockItem(null);
    setIsDepotQuantityDialogOpen(false);
  };

  const activateManualEntry = () => {
    if (isLabMode && !partAssignedDeviceId) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen önce işlem yapılacak cihazı seçin.', variant: 'destructive' });
      return;
    }
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
    const snap = await getDocs(scopedQuery('yedekParcaDepoStok', currentCompanyId, isSuperAdmin));
    const items = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
      } as YedekParcaDepoStokItem;
    });
    setDepotStockItems(filterByCompanyScope(items, currentCompanyId, isSuperAdmin));
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



  const toggleEslikEdenPersonel = (user: User) => {
    setEslikEdenPersonel(prev => {
      const exists = prev.find(p => p.uid === user.uid);
      if (exists) {
        return prev.filter(p => p.uid !== user.uid);
      }
      return [...prev, { uid: user.uid, name: user.name || user.email || '', role: user.role }];
    });
  };

  const addSelectedOperations = () => {
    const now = new Date();
    const newItems: ActionItem[] = selectedOperations.map(op => ({
      id: crypto.randomUUID(),
      type: 'operation',
      action: op,
      stokAdi: OPERATION_LABELS[op],
      quantity: 1,
      description: op === 'diger' ? digerAciklama : undefined,
      assignedDeviceId: isLabMode ? partAssignedDeviceId || undefined : undefined
    }));

    setActions(prev => [...prev, ...newItems]);
    setIsOperationModalOpen(false);
    setSelectedOperations([]);
    setDigerAciklama('');
  };

  const uploadRemovedPartImage = async () => {
    if (!removedPartImageFile) return null;
    setIsUploadingImage(true);
    try {
      const storageRef = ref(storage, `removedParts/${Date.now()}_${removedPartImageFile.name}`);
      const snapshot = await uploadBytes(storageRef, removedPartImageFile);
      const url = await getDownloadURL(snapshot.ref);
      return url;
    } catch (err) {
      console.error("Error uploading removed part image:", err);
      toast({ title: 'Hata', description: 'Görsel yüklenemedi.', variant: 'destructive' });
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  };

  const uploadUsedPartImage = async () => {
    if (!usedPartImageFile) return null;
    setIsUploadingImage(true);
    try {
      const storageRef = ref(storage, `partImages/${Date.now()}_${usedPartImageFile.name}`);
      const snapshot = await uploadBytes(storageRef, usedPartImageFile);
      const url = await getDownloadURL(snapshot.ref);
      return url;
    } catch (err) {
      console.error("Error uploading used part image:", err);
      toast({ title: 'Hata', description: 'Görsel yüklenemedi.', variant: 'destructive' });
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  };

  const addSelectedPart = async () => {
    // Basic validation
    let needsSerialTracking = false;
    if (selectedStockItem) needsSerialTracking = !!selectedStockItem.serialNumber;
    else if (selectedPoolStockItem) needsSerialTracking = !!selectedPoolStockItem.serialNumber;
    else if (selectedDepotStockItem) needsSerialTracking = !!selectedDepotStockItem.serialNumber;
    else if (showManualEntry) needsSerialTracking = true;

    if (isLabMode && !partAssignedDeviceId) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen parçanın takıldığı cihazı seçin.', variant: 'destructive' });
      return;
    }

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
        periodicPartChangeId: matchingPeriodic?.id,
        isPeriodicPartChange: !!matchingPeriodic,
        assignedDeviceId: isLabMode ? partAssignedDeviceId : undefined,
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
        anaBirim: (selectedStockItem as any).anaBirim || 'Adet',
        serialNumber: selectedStockItem.serialNumber,
        lotNumber: selectedStockItem.lotNumber,
        personalStockId: selectedStockItem.id,
        quantity: 1, // Personal stock items are individual
        removedPartStokKodu: matchingPeriodic?.stokKodu || '',
        removedPartStokAdi: matchingPeriodic?.stokAdi || '',
        removedPartSerialNumber: removedPartSerialNumber.trim(),
        removedPartImageUrl,
        usedPartImageUrl,
        periodicPartChangeId: matchingPeriodic?.id,
        isPeriodicPartChange: !!matchingPeriodic,
        assignedDeviceId: isLabMode ? partAssignedDeviceId : undefined,
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
        anaBirim: (selectedPoolStockItem as any).anaBirim || 'Adet',
        serialNumber: selectedPoolStockItem.serialNumber,
        lotNumber: selectedPoolStockItem.lotNumber,
        poolStockId: selectedPoolStockItem.id,
        poolWarehouseId: selectedPoolStockItem.poolWarehouseId,
        poolWarehouseName: selectedPoolStockItem.poolWarehouseName,
        quantity: 1,
        removedPartStokKodu: matchingPeriodic?.stokKodu || '',
        removedPartStokAdi: matchingPeriodic?.stokAdi || '',
        removedPartSerialNumber: removedPartSerialNumber.trim(),
        removedPartImageUrl,
        usedPartImageUrl,
        periodicPartChangeId: matchingPeriodic?.id,
        isPeriodicPartChange: !!matchingPeriodic,
        assignedDeviceId: isLabMode ? partAssignedDeviceId : undefined,
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
        lotNumber: selectedDepotStockItem.lotNumber,
        hucreNumarasi: selectedDepotStockItem.hucreNumarasi,
        depotStockId: getDepotSelectionKey(selectedDepotStockItem),
        isDepotSelection: true,
        quantity: selectedDepotStockItem.isGrouped ? partQuantity : 1,
        removedPartStokKodu: matchingPeriodic?.stokKodu || '',
        removedPartStokAdi: matchingPeriodic?.stokAdi || '',
        removedPartSerialNumber: removedPartSerialNumber.trim(),
        removedPartImageUrl,
        usedPartImageUrl,
        periodicPartChangeId: matchingPeriodic?.id,
        isPeriodicPartChange: !!matchingPeriodic,
        assignedDeviceId: isLabMode ? partAssignedDeviceId : undefined,
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
    setPartAssignedDeviceId('');
    setIsPartModalOpen(false);
  };

  const updateAction = (id: string, field: keyof ActionItem, value: any) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const removeActionRow = (id: string) => {
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    try {
      const now = new Date();
      const draftId = currentDraftId || doc(collection(db, 'draftActionForms')).id;

      const newLog: DraftActionLog = {
        personnelUid: currentUserProfile?.uid || '',
        personnelName: currentUserProfile?.name || 'Bilinmeyen',
        timestamp: now,
        logType: 'draft_created',
        description: `${currentUserProfile?.name || 'Bilinmeyen'} ara kayıt oluşturdu`,
      };

      const updatedLogs = [...draftActionLogs, newLog];

      const draftData: any = {
        deviceId: actualDeviceId || hospitalIdFromLab || '',
        hospitalId: hospital?.id || hospitalIdFromLab || '',
        formType: 'aplikasyon',
        actions,
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

      await setDoc(doc(db, 'draftActionForms', draftId), withCompanyScope(draftData, currentCompanyId), { merge: true });
      setCurrentDraftId(draftId);
      setDraftActionLogs(updatedLogs);

      hapticDouble();
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

    // Henüz gelmemiş (gelecek) bir tarih/saat seçilemez.
    if (isFutureDateTime(baslangicTarihi, baslangicSaati)) {
      toast({ title: 'Geçersiz Tarih', description: 'Başlangıç tarihi/saati ileri bir zaman olamaz.', variant: 'destructive' });
      return;
    }
    if (isFutureDateTime(bitisTarihi, bitisSaati)) {
      toast({ title: 'Geçersiz Tarih', description: 'Bitiş tarihi/saati ileri bir zaman olamaz.', variant: 'destructive' });
      return;
    }

    // Validate açıklama (zorunlu)
    if (!aciklama.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen açıklama alanını doldurun.', variant: 'destructive' });
      return;
    }

    // Validate fault selection when ariza is selected
    if (islemTuru === 'ariza' && !selectedFaultId) {
      toast({ title: 'Eksik Bilgi', description: 'Arıza işlem türü seçildiğinde arıza türünü belirtmeniz zorunludur.', variant: 'destructive' });
      return;
    }
    if (islemTuru === 'ariza' && selectedFaultId === 'diger' && !customFaultName.trim()) {
      toast({ title: 'Eksik Bilgi', description: '"Diğer" arıza seçeneği için açıklama zorunludur.', variant: 'destructive' });
      return;
    }

    // Validate part changes have quantity
    const invalidPart = actions.find(a => a.type === 'part_change' && a.quantity <= 0);
    if (invalidPart) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm parça değişimlerinde geçerli bir adet girin.', variant: 'destructive' });
      return;
    }

    // Validate "diger" operation has description
    const invalidDiger = actions.find(a => a.action === 'diger' && !a.description?.trim());
    if (invalidDiger) {
      toast({ title: 'Eksik Bilgi', description: '"Diğer" işlemi için açıklama zorunludur.', variant: 'destructive' });
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
    const isGroupedDepotKey = String(partChange.depotStockId || '').startsWith('group:');
    const groupedSourceIds = isGroupedDepotKey
      ? String(partChange.depotStockId).replace('group:', '').split('|').filter(Boolean)
      : [];

    // Case 1: Direct ID provided (Serial or Cell tracked item)
    if (partChange.depotStockId && !isGroupedDepotKey) {
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

    if (remainingToConsume > 0 && groupedSourceIds.length > 0) {
      for (const sourceId of groupedSourceIds) {
        if (remainingToConsume <= 0) break;
        const sourceRef = doc(db, 'yedekParcaDepoStok', sourceId);
        const sourceSnap = await getDoc(sourceRef);
        if (!sourceSnap.exists()) continue;
        const sourceData = sourceSnap.data();
        const available = sourceData.quantity || 0;
        if (available <= 0) continue;
        const toTake = Math.min(available, remainingToConsume);
        if (toTake === available) {
          batch.delete(sourceRef);
        } else {
          batch.update(sourceRef, { quantity: available - toTake });
        }
        consumedEntries.push({ ...sourceData, id: sourceSnap.id, consumedQuantity: toTake } as any);
        remainingToConsume -= toTake;
      }
    }

    // Case 2: No ID or remaining quantity for grouped items (Quantity tracked)
    if (remainingToConsume > 0 && !isGroupedDepotKey) {
      const q = query(
        scopedQuery('yedekParcaDepoStok', currentCompanyId, isSuperAdmin),
        where('stokKodu', '==', partChange.stokKodu)
      );
      const snapshot = await getDocs(q);

      const docsSorted = [...snapshot.docs].sort((a, b) => {
        const aTs = (a.data().createdAt?.toDate?.() || new Date(0)).getTime();
        const bTs = (b.data().createdAt?.toDate?.() || new Date(0)).getTime();
        return aTs - bTs;
      });

      for (const docSnap of docsSorted) {
        if (remainingToConsume <= 0) break;
        // Don't double-process the same doc if it was already handled by Case 1
        if (partChange.depotStockId === docSnap.id) continue;
        if (groupedSourceIds.includes(docSnap.id)) continue;

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

    return consumedEntries[0]; // Return the first one for the main record, or refactor to handle multiple
  };

  const createDepotBorrowRecord = (partChange: ActionItem, depotEntry: YedekParcaDepoStokItem, batch: any, currentDevice: Device, formId: string, now: Date) => {
    const borrowedRef = doc(collection(db, 'borrowedSpareParts'));
    batch.set(borrowedRef, withCompanyScope({
      productCodeId: partChange.productCodeId || depotEntry.productCodeId || '',
      stokKodu: partChange.stokKodu,
      stokAdi: partChange.stokAdi,
      anaBirim: partChange.anaBirim || depotEntry.anaBirim || 'Adet',
      serialNumber: partChange.serialNumber || depotEntry.serialNumber || '',
      hucreNumarasi: partChange.hucreNumarasi || depotEntry.hucreNumarasi || '',
      quantity: Math.max(1, partChange.quantity || 1),
      sourceType: 'depot',
      sourceActionType: partChange.type,
      depotStockId: depotEntry.id,
      deviceId: currentDevice.id,
      deviceName: currentDevice.cihazAdi || currentDevice.model || '',
      hospitalId: hospital?.id || '',
      labName: hospital?.name || '',
      formId: formId,
      formType: 'aplikasyon',
      borrowedByUid: currentUserProfile?.uid || '',
      borrowedByName: currentUserProfile?.name || '',
      borrowedAt: Timestamp.fromDate(now),
      status: 'pending',
    }, currentCompanyId));
  };


  const returnRemovedHucreToDepot = (hucreChange: ActionItem, batch: any, currentDevice: Device, formId: string, now: Date) => {
    const removedHucre = String(hucreChange.removedHucreNumarasi || '').trim().toUpperCase();
    const installedHucre = String(hucreChange.hucreNumarasi || '').trim().toUpperCase();
    if (!removedHucre || removedHucre === installedHucre) return;

    const depotRef = doc(collection(db, 'yedekParcaDepoStok'));
    batch.set(depotRef, withCompanyScope({
      productCodeId: hucreChange.productCodeId || '',
      stokKodu: hucreChange.removedPartStokKodu || hucreChange.stokKodu || '',
      stokAdi: hucreChange.removedPartStokAdi || hucreChange.stokAdi || '',
      anaBirim: hucreChange.anaBirim || 'Adet',
      serialNumber: '',
      hucreNumarasi: removedHucre,
      quantity: 1,
      source: 'device_removed_cell',
      sourceDeviceId: currentDevice.id,
      sourceDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
      sourceFormId: formId,
      sourceFormType: 'aplikasyon',
      createdAt: Timestamp.fromDate(now),
      createdByUid: currentUserProfile?.uid || '',
      createdByName: currentUserProfile?.name || '',
    }, currentCompanyId));

    batch.set(doc(collection(db, 'yedekParcaDepoLog')), withCompanyScope({
      action: 'hucre_iade_giris',
      productCodeId: hucreChange.productCodeId || '',
      stokKodu: hucreChange.removedPartStokKodu || hucreChange.stokKodu || '',
      stokAdi: hucreChange.removedPartStokAdi || hucreChange.stokAdi || '',
      anaBirim: hucreChange.anaBirim || 'Adet',
      serialNumber: '',
      hucreNumarasi: removedHucre,
      quantity: 1,
      relatedDeviceId: currentDevice.id,
      relatedDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
      relatedPersonnelUid: currentUserProfile?.uid || '',
      relatedPersonnelName: currentUserProfile?.name || '',
      formId,
      formType: 'aplikasyon',
      notes: `Hücre değişimi: çıkan hücre ${removedHucre} depoya iade edildi, takılan hücre ${installedHucre || '-'} cihazda kullanıldı.`,
      createdAt: Timestamp.fromDate(now),
      createdByUid: currentUserProfile?.uid || '',
      createdByName: currentUserProfile?.name || '',
    }, currentCompanyId));
  };

  const logPersonalHucreUsage = (hucreChange: ActionItem, batch: any, currentDevice: Device, formId: string, now: Date) => {
    if (!hucreChange.personalStockId) return;

    batch.set(doc(collection(db, 'sparePartTransferLogs')), withCompanyScope({
      action: 'use_on_device',
      personalStockId: hucreChange.personalStockId,
      productCodeId: hucreChange.productCodeId || '',
      stokKodu: hucreChange.stokKodu,
      stokAdi: hucreChange.stokAdi,
      anaBirim: hucreChange.anaBirim || 'Adet',
      serialNumber: hucreChange.serialNumber || '',
      hucreNumarasi: hucreChange.hucreNumarasi || '',
      removedHucreNumarasi: hucreChange.removedHucreNumarasi || '',
      quantity: 1,
      deviceId: currentDevice.id,
      deviceName: currentDevice.cihazAdi || currentDevice.model || '',
      labName: hospital?.name || '',
      formId,
      formType: 'aplikasyon',
      createdAt: Timestamp.fromDate(now),
      createdByUid: currentUserProfile?.uid || '',
      createdByName: currentUserProfile?.name || '',
    }, currentCompanyId));
  };

  const handleSaveSignaturesAndFinish = (finalSignatures: { personnel?: string; technician?: string }, finalTechnicianName?: string) => {
    // --- OPTIMISTIC UI BACKUP ---
    const previousActions = [...actions];
    const previousIslemTuru = islemTuru;
    const previousAciklama = aciklama;
    const previousSignatures = { ...signatures };
    const previousTechnicianName = technicianName;
    const previousSelectedFaultId = selectedFaultId;
    const previousCustomFaultName = customFaultName;
    const previousSelectedTests = [...selectedTests];
    const previousEslikEdenPersonel = [...eslikEdenPersonel];
    const previousCihazDurumu = cihazDurumu;
    const previousCihazDurumuAciklama = cihazDurumuAciklama;
    const previousSelectedMaintenanceTasks = [...selectedMaintenanceTasks];
    const previousEgitimIcerigi = egitimIcerigi;
    const previousEgitimKatilanlar = [...egitimKatilanlar];
    const previousSelectedPeriodicParts = [...selectedPeriodicParts];

    // --- IMMEDIATE UI UPDATE ---
    setIsSaving(true);
    setIsSignatureModalOpen(false);
    
    // Clear form immediately
    setActions([]);
    setIslemTuru('');
    setAciklama('');
    setSelectedMaintenanceTasks([]);
    setSelectedFaultId('');
    setCustomFaultName('');
    setSelectedTests([]);
    setEslikEdenPersonel([]);
    setCihazDurumu('');
    setCihazDurumuAciklama('');
    setEgitimIcerigi('');
    setEgitimKatilanlar([]);
    setSelectedPeriodicParts([]);

    toast({
      title: 'İşlem Kaydediliyor...',
      description: 'Form verileri ve PDF arka planda hazırlanıyor.',
      duration: 3000
    });

    // --- BACKGROUND PROCESS ---
    (async () => {
      try {
        const now = new Date();
        const batch = writeBatch(db);

        let devicesToProcess = isLabMode ? [...devicesByLab] : [device];
        if (isLabMode) {
            const assignedIds = Array.from(new Set(
                previousActions
                  .filter((a) => a.type !== 'operation')
                  .map((a) => a.assignedDeviceId)
                  .filter((id): id is string => !!id)
            ));

            const hasGlobalOnlyActions = assignedIds.length === 0 && previousActions.some((a) => a.type === 'operation');
            if (!hasGlobalOnlyActions && assignedIds.length > 0) {
                const existingMap = new Map(devicesToProcess.filter(Boolean).map((d) => [d.id, d] as const));
                const resolvedDevices: Device[] = [];
                for (const id of assignedIds) {
                    if (existingMap.has(id)) {
                        resolvedDevices.push(existingMap.get(id)!);
                        continue;
                    }
                    const extraSnap = await getDoc(doc(db, 'devices', id));
                    if (extraSnap.exists()) {
                        resolvedDevices.push({ id: extraSnap.id, ...extraSnap.data() } as Device);
                    }
                }
                devicesToProcess = resolvedDevices;
            }
        }

        const createdFormIds: string[] = [];
        const labDeviceActionSummaries: Array<{
            deviceId: string;
            cihazAdi: string;
            seriNumarasi: string;
            partAndHucreActions: ActionItem[];
        }> = [];
        const labMasterFormRef = isLabMode ? doc(collection(db, 'aplikasyonActionForms')) : null;
        const createdFormsData: any[] = [];
        // Ceomed irsaliye işleri BATCH'E YAZILMAZ; commit'ten sonra ayrı yazılır.
        // Aynı batch'te yazmak, kuyruk tarafındaki bir sorunda formun tamamını
        // düşürüyordu (bkz. enqueue-irsaliye-giris.ts).
        const irsaliyeGirisleri: BuildIrsaliyeGirisInput[] = [];

        for (const currentDevice of devicesToProcess) {
            if (!currentDevice) continue;
            const deviceSpecificActions = previousActions.filter(action => {
                if (!action.assignedDeviceId) return true;
                return action.assignedDeviceId === currentDevice.id;
            });
            if (isLabMode && deviceSpecificActions.length === 0) continue;
            if (isLabMode) {
                labDeviceActionSummaries.push({
                    deviceId: currentDevice.id,
                    cihazAdi: currentDevice.cihazAdi || currentDevice.model || '',
                    seriNumarasi: currentDevice.seriNumarasi || '',
                    partAndHucreActions: deviceSpecificActions.filter((a) => a.type === 'part_change' || a.type === 'hucre_degisimi'),
                });
            }

            const selectedMaintenancePlanDetails = maintenancePlans
              .filter(p => previousSelectedMaintenanceTasks.includes(p.id))
              .map(p => ({ id: p.id, taskName: p.taskName }));

            const isCustomFault = previousSelectedFaultId === 'diger';
            const selectedFault = previousIslemTuru === 'ariza' && !isCustomFault ? faultDefinitions.find(f => f.id === previousSelectedFaultId) : null;
            const resolvedFaultName = isCustomFault ? previousCustomFaultName.trim() : (selectedFault?.name || null);
            const resolvedFaultId = isCustomFault ? null : (selectedFault?.id || null);

            const formRef = isLabMode
              ? doc(collection(db, 'deviceActionForms'))
              : doc(collection(db, 'aplikasyonActionForms'));
            const formNo = await reserveActionFormNumber({
              db,
              companyId: currentCompanyId,
              userUid: currentUserProfile?.uid || 'unknown',
              userName: currentUserProfile?.name || currentUserProfile?.displayName || '',
              formTypeLetter: 'A',
            });
            const formData = {
                deviceId: currentDevice.id,
                cihazAdi: currentDevice.cihazAdi || currentDevice.model,
                seriNumarasi: currentDevice.seriNumarasi,
                hospitalId: hospital?.id,
                labName: hospital?.name,
                actions: deviceSpecificActions,
                islemTuru: previousIslemTuru || null,
                aciklama: previousAciklama.trim(),
                baslangicSaati,
                bitisSaati,
                baslangicTarihi,
                bitisTarihi,
                cihazDurumu: previousCihazDurumu,
                cihazDurumuAciklama: previousCihazDurumu === 'diger' ? previousCihazDurumuAciklama : null,
                eslikEdenPersonel: previousEslikEdenPersonel.length > 0 ? previousEslikEdenPersonel : null,
                personnelSignature: finalSignatures.personnel || null,
                technicianSignature: finalSignatures.technician || null,
                technicianName: finalTechnicianName || null,
                createdAt: Timestamp.fromDate(now),
                formNo,
                createdByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
                createdByUid: currentUserProfile?.uid,
                companyId: currentCompanyId || null,
                formType: 'aplikasyon',
                selectedMaintenanceTasks: previousIslemTuru === 'periyodik_bakim' ? selectedMaintenancePlanDetails : null,
                faultDefinitionId: resolvedFaultId,
                faultName: resolvedFaultName,
                isCustomFault: isCustomFault || false,
                selectedTests: previousIslemTuru === 'ariza' && previousSelectedTests.length > 0 ? previousSelectedTests : null,
                egitimIcerigi: previousIslemTuru === 'egitim' && previousEgitimIcerigi.trim() ? previousEgitimIcerigi.trim() : null,
                egitimKatilanlar: previousIslemTuru === 'egitim' && previousEgitimKatilanlar.length > 0 ? previousEgitimKatilanlar : null,
                isBulkLabForm: isLabMode,
                isLabDeviceChild: isLabMode ? true : undefined,
                labMasterFormId: isLabMode ? labMasterFormRef?.id : undefined,
            };
            batch.set(formRef, formData);
            
            createdFormsData.push({
                device: currentDevice,
                hospital: hospital,
                actionRecord: { id: formRef.id, ...formData }
            });

            // Yedek parça kullanıldıysa Ceomed muhasebe irsaliyesini kuyruğa almak
            // üzere biriktir. Yazım commit'ten SONRA yapılır.
            irsaliyeGirisleri.push({
                formId: formRef.id,
                formNo,
                formType: 'aplikasyon',
                tarih: baslangicTarihi,
                hospitalId: hospital?.id || currentDevice.hospitalId || '',
                cariKodu: hospital?.ceomedCariKodu,
                labName: hospital?.name,
                deviceId: currentDevice.id,
                cihazAdi: currentDevice.cihazAdi || currentDevice.model,
                seriNumarasi: currentDevice.seriNumarasi,
                personnelName: currentUserProfile?.name,
                personnelUid: currentUserProfile?.uid,
                companyId: currentCompanyId,
                actions: deviceSpecificActions,
            });

            if (!isLabMode) createdFormIds.push(formRef.id);

            if (!isLabMode) {
                const deviceActionFormRef = doc(collection(db, 'deviceActionForms'), formRef.id);
                batch.set(deviceActionFormRef, {
                    ...formData,
                    formId: formRef.id,
                });
            }

            if (previousIslemTuru === 'ariza' && (selectedFault || isCustomFault)) {
                const [startYear, startMonth, startDay] = baslangicTarihi.split('-').map(Number);
                const [startHour, startMinute] = baslangicSaati.split(':').map(Number);
                const [endYear, endMonth, endDay] = bitisTarihi.split('-').map(Number);
                const [endHour, endMinute] = bitisSaati.split(':').map(Number);
                const startTime = new Date(startYear, startMonth - 1, startDay, startHour, startMinute);
                const endTime = new Date(endYear, endMonth - 1, endDay, endHour, endMinute);
                const cozumSuresi = endTime.getTime() - startTime.getTime();
                const supportPerson = previousEslikEdenPersonel.length > 0 ? previousEslikEdenPersonel[0] : null;

                const faultReportRef = doc(collection(db, 'deviceFaultReports'));
                batch.set(faultReportRef, withCompanyScope({
                    deviceId: currentDevice.id,
                    hospitalId: hospital?.id,
                    labName: hospital?.name,
                    model: currentDevice.cihazAdi || currentDevice.model,
                    serial: currentDevice.seriNumarasi,
                    faultType: 'aplikasyon',
                    faultDefinitionId: resolvedFaultId,
                    faultName: resolvedFaultName,
                    description: previousAciklama.trim(),
                    status: 'cozuldu',
                    openedAt: Timestamp.fromDate(startTime),
                    closedAt: Timestamp.fromDate(endTime),
                    openedByUid: currentUserProfile?.uid,
                    openedByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
                    closedByUid: currentUserProfile?.uid,
                    closedByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
                    closeDescription: previousAciklama.trim(),
                    assignedToUid: currentUserProfile?.uid,
                    assignedToName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
                    assignedAt: Timestamp.fromDate(startTime),
                    interventionStartedAt: Timestamp.fromDate(startTime),
                    interventionType: 'kurum_ziyaret',
                    cozumSuresi,
                    toplamCozumSuresi: cozumSuresi,
                    resolvedFromFormId: formRef.id,
                    resolvedFromFormType: 'aplikasyon',
                    eslikEdenPersonel: previousEslikEdenPersonel.length > 0 ? previousEslikEdenPersonel : null,
                    supportPersonnelUid: supportPerson?.uid || null,
                    supportPersonnelName: supportPerson?.name || null,
                    relatedTests: previousSelectedTests.length > 0 ? previousSelectedTests : null,
                    isCustomFault: isCustomFault || false,
                    createdFromActionForm: true,
                }, currentCompanyId));

                const historyOpenedRef = doc(collection(db, 'deviceFaultReports', faultReportRef.id, 'history'));
                batch.set(historyOpenedRef, {
                    type: 'opened',
                    actorUid: currentUserProfile?.uid,
                    actorName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
                    description: previousAciklama.trim(),
                    timestamp: Timestamp.fromDate(startTime),
                });
                const historyClosedRef = doc(collection(db, 'deviceFaultReports', faultReportRef.id, 'history'));
                batch.set(historyClosedRef, {
                    type: 'closed',
                    actorUid: currentUserProfile?.uid,
                    actorName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
                    description: supportPerson ? `${previousAciklama.trim()} (Destek: ${supportPerson.name})` : previousAciklama.trim(),
                    timestamp: Timestamp.fromDate(endTime),
                    supportPersonnelUid: supportPerson?.uid || null,
                    supportPersonnelName: supportPerson?.name || null,
                });
            }

            const partChanges = deviceSpecificActions.filter(a => a.type === 'part_change');
            for (const partChange of partChanges) {
                let removedStockRefId: string | null = null;
                const removedSerial = String(partChange.removedPartSerialNumber || '').trim();
                const installedSerial = String(partChange.serialNumber || '').trim();
                const removedStokKodu = partChange.removedPartStokKodu || partChange.stokKodu || '';

                if (removedSerial && removedSerial !== installedSerial) {
                    const duplicateRemovedPartSnap = await getDocs(query(
                        scopedQuery('yedekParcaDepoStok', currentCompanyId, isSuperAdmin),
                        where('stokKodu', '==', removedStokKodu),
                        where('serialNumber', '==', removedSerial)
                    ));

                    if (duplicateRemovedPartSnap.empty) {
                        const removedStockRef = doc(collection(db, 'yedekParcaDepoStok'));
                        removedStockRefId = removedStockRef.id;
                        batch.set(removedStockRef, withCompanyScope({
                            productCodeId: partChange.productCodeId || '',
                            stokKodu: removedStokKodu,
                            stokAdi: partChange.removedPartStokAdi || partChange.stokAdi || '',
                            anaBirim: partChange.anaBirim || 'Adet',
                            serialNumber: removedSerial,
                            imageUrl: partChange.removedPartImageUrl || null,
                            address: '',
                            quantity: 1,
                            partCondition: 'cihazdan_cikan',
                            partConditionNote: `Cihazdan çıkan parça: ${currentDevice.cihazAdi || currentDevice.model || currentDevice.id || ''}`.trim(),
                            sourceType: 'device_removed',
                            sourceDeviceId: currentDevice.id,
                            sourceDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
                            sourceFormId: formRef.id,
                            sourceFormType: 'aplikasyon',
                            createdAt: Timestamp.fromDate(now),
                            createdByUid: currentUserProfile?.uid || '',
                            createdByName: currentUserProfile?.name || '',
                            replacedPartId: partChange.personalStockId || partChange.poolStockId || null,
                        }, currentCompanyId));
                    }
                }

                if (partChange.personalStockId) {
                    const stockRef = doc(db, 'personalStock', partChange.personalStockId);
                    batch.update(stockRef, {
                      status: 'used',
                      usedAt: Timestamp.fromDate(now),
                      usedOnDeviceId: currentDevice.id,
                      usedOnDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
                      usedOnFormId: formRef.id,
                      usedOnFormType: 'aplikasyon',
                      replacedPartId: removedStockRefId,
                    });

                    const useLogRef = doc(collection(db, 'sparePartTransferLogs'));
                    batch.set(useLogRef, withCompanyScope({
                      action: 'use_on_device',
                      personalStockId: partChange.personalStockId,
                      stokKodu: partChange.stokKodu,
                      stokAdi: partChange.stokAdi,
                      serialNumber: partChange.serialNumber,
                      deviceId: currentDevice.id,
                      deviceName: currentDevice.cihazAdi || currentDevice.model || '',
                      labName: hospital?.name || '',
                      formId: formRef.id,
                      formType: 'aplikasyon',
                      createdAt: Timestamp.fromDate(now),
                      createdByUid: currentUserProfile?.uid || '',
                      createdByName: currentUserProfile?.name || '',
                      usageImageUrl: partChange.usedPartImageUrl || null,
                    }, currentCompanyId));
                }

                if (partChange.poolStockId) {
                    const poolStockRef = doc(db, 'poolWarehouseStock', partChange.poolStockId);
                    batch.update(poolStockRef, {
                      status: 'used',
                      usedAt: Timestamp.fromDate(now),
                      usedByUid: currentUserProfile?.uid || '',
                      usedByName: currentUserProfile?.name || '',
                      usedOnDeviceId: currentDevice.id,
                      usedOnDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
                      usedOnFormId: formRef.id,
                      usedOnFormType: 'aplikasyon',
                      usedOnLabId: hospital?.id || '',
                      usedOnLabName: hospital?.name || '',
                    });
                }

                if (partChange.isDepotSelection) {
                    const depotEntry = await consumeDepotSelection(partChange, batch);
                    createDepotBorrowRecord(partChange, depotEntry, batch, currentDevice, formRef.id, now);
                }

                if (partChange.isManualEntry) {
                    const borrowedRef = doc(collection(db, 'borrowedSpareParts'));
                    batch.set(borrowedRef, withCompanyScope({
                        stokKodu: partChange.stokKodu,
                        stokAdi: partChange.stokAdi,
                        serialNumber: partChange.serialNumber,
                        deviceId: currentDevice.id,
                        deviceName: currentDevice.cihazAdi || currentDevice.model || '',
                        hospitalId: hospital?.id || '',
                        labName: hospital?.name || '',
                        formId: formRef.id,
                        formType: 'aplikasyon',
                        borrowedByUid: currentUserProfile?.uid || '',
                        borrowedByName: currentUserProfile?.name || '',
                        borrowedAt: Timestamp.fromDate(now),
                        status: 'pending',
                    }, currentCompanyId));
                }
            }

            const hucreChanges = deviceSpecificActions.filter(a => a.type === 'hucre_degisimi');
            for (const hucreChange of hucreChanges) {
                if (hucreChange.personalStockId) {
                    const stockRef = doc(db, 'personalStock', hucreChange.personalStockId);
                    batch.update(stockRef, {
                        status: 'used',
                        usedAt: Timestamp.fromDate(now),
                        usedOnDeviceId: currentDevice.id,
                        usedOnDeviceName: currentDevice.cihazAdi || currentDevice.model || '',
                        usedOnFormId: formRef.id,
                        usedOnFormType: 'aplikasyon',
                    });
                    logPersonalHucreUsage(hucreChange, batch, currentDevice, formRef.id, now);
                }
                if (hucreChange.isDepotSelection) {
                    const depotEntry = await consumeDepotSelection(hucreChange, batch);
                    createDepotBorrowRecord(hucreChange, depotEntry, batch, currentDevice, formRef.id, now);
                }
                returnRemovedHucreToDepot(hucreChange, batch, currentDevice, formRef.id, now);
            }

            if (previousIslemTuru === 'periyodik_bakim' && previousSelectedMaintenanceTasks.length > 0) {
                for (const planId of previousSelectedMaintenanceTasks) {
                    const plan = maintenancePlans.find(p => p.id === planId);
                    if (plan) {
                        const nextDueDate = new Date(now);
                        nextDueDate.setMonth(nextDueDate.getMonth() + 1); 
                        
                        const maintenanceLogRef = doc(collection(db, 'maintenanceLogs'));
                        batch.set(maintenanceLogRef, {
                            deviceId: currentDevice.id,
                            planId: plan.id,
                            taskName: plan.taskName,
                            completedAt: Timestamp.fromDate(now),
                            completedByUid: currentUserProfile?.uid || '',
                            completedByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
                            nextDueDate: Timestamp.fromDate(nextDueDate),
                            formId: formRef.id,
                            formType: 'aplikasyon',
                        });
                    }
                }
            }
        }

        if (isLabMode && labMasterFormRef) {
            const labMasterFormNo = await reserveActionFormNumber({
                db,
                companyId: currentCompanyId,
                userUid: currentUserProfile?.uid || 'unknown',
                userName: currentUserProfile?.name || currentUserProfile?.displayName || '',
                formTypeLetter: 'A',
            });
            batch.set(labMasterFormRef, {
                deviceId: `lab-${hospital?.id || hospitalIdFromLab || 'GENEL'}`,
                cihazAdi: `${hospital?.name || 'Laboratuvar'} (Lab Geneli)`,
                seriNumarasi: `LAB-${(hospital?.id || hospitalIdFromLab || 'GENEL').slice(0, 8)}`,
                hospitalId: hospital?.id || hospitalIdFromLab,
                labName: hospital?.name,
                actions: previousActions,
                islemTuru: previousIslemTuru || null,
                aciklama: previousAciklama.trim(),
                baslangicSaati,
                bitisSaati,
                baslangicTarihi,
                bitisTarihi,
                cihazDurumu: previousCihazDurumu,
                cihazDurumuAciklama: previousCihazDurumu === 'diger' ? previousCihazDurumuAciklama : null,
                eslikEdenPersonel: previousEslikEdenPersonel.length > 0 ? previousEslikEdenPersonel : null,
                personnelSignature: finalSignatures.personnel || null,
                technicianSignature: finalSignatures.technician || null,
                technicianName: finalTechnicianName || null,
                createdAt: Timestamp.fromDate(now),
                formNo: labMasterFormNo,
                createdByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
                createdByUid: currentUserProfile?.uid,
                companyId: currentCompanyId || null,
                formType: 'aplikasyon',
                selectedMaintenanceTasks: null,
                faultDefinitionId: null,
                faultName: null,
                isCustomFault: false,
                selectedTests: previousIslemTuru === 'ariza' && previousSelectedTests.length > 0 ? previousSelectedTests : null,
                egitimIcerigi: previousIslemTuru === 'egitim' && previousEgitimIcerigi.trim() ? previousEgitimIcerigi.trim() : null,
                egitimKatilanlar: previousIslemTuru === 'egitim' && previousEgitimKatilanlar.length > 0 ? previousEgitimKatilanlar : null,
                isBulkLabForm: true,
                isLabDeviceChild: false,
                labDeviceActionSummaries,
            });
            createdFormIds.push(labMasterFormRef.id);
        }

        if (createdFormIds.length === 0) {
            throw new Error('Kaydedilecek cihaz aksiyonu bulunamadı.');
        }

        // İşlem formunu kaydet. (Otomatik PDF açma kaldırıldı — formlar zaten WhatsApp'a
        // otomatik iletiliyor; her kayıtta PDF üretip yeni sekmede açmaya gerek yok.)
        await batch.commit();

        queryClient.invalidateQueries({ queryKey: ['maintenanceLogs', 'forDevice', deviceId] });

        // Form KAYDEDİLDİ. Ceomed irsaliyesi buradan sonra, ayrı yazımlarla
        // kuyruğa alınır; buradaki bir hata formu etkilemez.
        if (irsaliyeGirisleri.length > 0) {
          const bekleyenler: string[] = [];
          const yazilamayanlar: string[] = [];
          for (const girdi of irsaliyeGirisleri) {
            // Cari kodu ve sevk adresi BURADA çözülüyor, commit'ten sonra:
            // ana lab araması bir sorgu ve sorgular form kaydetme yolunda
            // üretimi durdurmuştu. Ek hizmet binasıysa cari ana labdan,
            // sevk adresi kendi tanımından gelir.
            const cari = await cariCozAsync(db, girdi.hospitalId);
            const sonuc = await enqueueIrsaliyeGirisAyri(db, {
              ...girdi,
              cariKodu: cari.cariKodu || girdi.cariKodu,
              sevkAdresi: cari.sevkAdresi,
              cariKaynagi: cari.kaynak,
              cariHatasi: cari.hata,
            });
            // `=== true/false` kasıtlı: tsconfig'de strictNullChecks kapalı ve
            // bu modda `!sonuc.enqueued` ayrımlı birleşimi daraltmıyor.
            if (sonuc.enqueued === true && sonuc.status === 'blocked') {
              bekleyenler.push(sonuc.blockedDetail || 'Ceomed irsaliyesi eksik veri nedeniyle bekliyor.');
            } else if (sonuc.enqueued === false && sonuc.reason === 'yazilamadi') {
              yazilamayanlar.push(sonuc.hata || 'bilinmeyen hata');
            }
          }
          // Sessizce geçmek, eksiğin haftalar sonra fark edilmesi demek.
          if (bekleyenler.length > 0) {
            toast({
              title: 'Ceomed irsaliyesi beklemede',
              description: Array.from(new Set(bekleyenler)).join(' '),
              variant: 'destructive',
              duration: 12000,
            });
          }
          if (yazilamayanlar.length > 0) {
            toast({
              title: 'Ceomed irsaliyesi kuyruğa alınamadı',
              description:
                'Form kaydedildi. Ancak muhasebe irsaliyesi otomatik ' +
                'oluşturulmayacak; Ceomed’de elle kesilmesi gerekiyor. Sebep: ' +
                Array.from(new Set(yazilamayanlar)).join(' '),
              variant: 'destructive',
              duration: 15000,
            });
          }
        }
        queryClient.invalidateQueries({ queryKey: ['maintenancePlans', 'forDevice', deviceId] });
        queryClient.invalidateQueries({ queryKey: ['aplikasyonActionForms'] });
        queryClient.invalidateQueries({ queryKey: ['deviceFaultReports'] });

        hapticDouble();
        const firstForm = createdFormsData[0];
        const waText = encodeURIComponent(
          `🚀 *Aplikasyon İşlemi Tamamlandı*\n\n` +
          `🏥 *Kurum:* ${firstForm.hospital?.name || '-'}\n` +
          `🔬 *Cihaz:* ${firstForm.device.cihazAdi || firstForm.device.model || '-'}\n` +
          `📋 *Form No:* ${firstForm.actionRecord.formNo || '-'}\n` +
          `👩‍🔬 *Uzman:* ${currentUserProfile?.name || '-'}\n\n` +
          `QORE Sistemi üzerinden detaylara ulaşabilirsiniz.`
        );
        toast({
          title: 'Başarılı',
          description: isLabMode ? 'Laboratuvar geneli form oluşturuldu.' : 'İşlem formu kaydedildi.',
          action: (
            <ToastAction altText="WhatsApp" onClick={() => window.open(`https://wa.me/?text=${waText}`, '_blank')}>
              <div className="flex items-center gap-1.5">
                <MessageCircle className="h-4 w-4" />
                <span>WhatsApp</span>
              </div>
            </ToastAction>
          )
        });

    } catch(err) {
        console.error("Error saving action form (Optimistic):", err);
        // --- ROLLBACK ---
        setActions(previousActions);
        setIslemTuru(previousIslemTuru);
        setAciklama(previousAciklama);
        setSignatures(previousSignatures);
        setTechnicianName(previousTechnicianName);
        setSelectedFaultId(previousSelectedFaultId);
        setCustomFaultName(previousCustomFaultName);
        setSelectedTests(previousSelectedTests);
        setEslikEdenPersonel(previousEslikEdenPersonel);
        setCihazDurumu(previousCihazDurumu);
        setCihazDurumuAciklama(previousCihazDurumuAciklama);
        setSelectedMaintenanceTasks(previousSelectedMaintenanceTasks);
        setEgitimIcerigi(previousEgitimIcerigi);
        setEgitimKatilanlar(previousEgitimKatilanlar);
        setSelectedPeriodicParts(previousSelectedPeriodicParts);

        toast({ title: 'Hata (Veriler Geri Yüklendi)', description: 'Kayıt sırasında bir hata oluştu: ' + (err as Error).message, variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
    })();
  };


  const getActionLabel = (item: ActionItem): string => {
    if (item.type === 'part_change') {
      return item.stokAdi || item.action;
    }
    return OPERATION_LABELS[item.action as OperationType] || item.action;
  };

  const downloadExcelTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const today = new Date();
      const rows = [[
        'Başlangıç Tarihi', 'Başlangıç Saati', 'Bitiş Tarihi', 'Bitiş Saati',
        'İşlem Türü', 'Yapılan İşlemler (virgülle)', 'Açıklama',
        'Cihaz Durumu', 'Cihaz Durumu Açıklama', 'Arıza Adı (opsiyonel)',
        'Yedek Parça Kodu', 'Yedek Parça Adı', 'Yedek Parça Seri No (opsiyonel)', 'Yedek Parça Adet',
        'Çıkan Parça Kodu', 'Çıkan Parça Adı', 'Çıkan Parça Seri No',
      ], [
        today, '09:00', today, '10:00',
        'rutin_kurum_ziyareti', 'aplikasyon_kontrol', 'Excel ile geçmiş aplikasyon form girişi',
        'calisiyor', '', '',
        'SERBEST-KOD', 'Serbest Yedek Parça', '', 1, '', '', '',
      ]];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['A2'].z = 'yyyy-mm-dd';
      ws['C2'].z = 'yyyy-mm-dd';
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'AplikasyonForm');
      const optionsRows = [
        ['Alan', 'Kod', 'Görünen Ad'],
        ...(['rutin_kurum_ziyareti', 'periyodik_bakim', 'ariza', 'alis', 'roche_bilgisayar_arizasi', 'diger'] as IslemTuru[]).map((v) => ['İşlem Türü', v, ISLEM_TURU_LABELS[v]]),
        ...ALL_OPERATIONS.map((v) => ['Yapılan İşlem', v, OPERATION_LABELS[v]]),
        ...(['calisiyor', 'arizali', 'denemede', 'diger'] as CihazDurumu[]).map((v) => ['Cihaz Durumu', v, CIHAZ_DURUMU_LABELS[v]]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(optionsRows), 'Secenekler');
      XLSX.writeFile(wb, `aplikasyon_form_sablon_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
      toast({ title: 'Şablon indirildi', description: 'Aplikasyon Excel şablonu indirildi.' });
    } catch (err) {
      console.error('Error creating excel template:', err);
      toast({ title: 'Hata', description: 'Excel şablonu oluşturulamadı.', variant: 'destructive' });
    }
  };

  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false });
      if (rows.length === 0) {
        toast({ title: 'Uyarı', description: 'Excel dosyasında satır bulunamadı.', variant: 'default' });
        return;
      }
      const batch = writeBatch(db);
      let successCount = 0;
      let failCount = 0;
      for (const row of rows) {
        const islemTur = String(row['İşlem Türü'] ?? '').trim() as IslemTuru;
        const cihazDur = String(row['Cihaz Durumu'] ?? '').trim() as CihazDurumu;
        if (!islemTur || !cihazDur || !String(row['Başlangıç Tarihi'] ?? '').trim() || !String(row['Bitiş Tarihi'] ?? '').trim()) {
          failCount += 1;
          continue;
        }
        const formRef = doc(collection(db, 'aplikasyonActionForms'));
        const formNo = await reserveActionFormNumber({
          db,
          companyId: currentCompanyId,
          userUid: currentUserProfile?.uid || 'unknown',
          userName: currentUserProfile?.name || currentUserProfile?.displayName || '',
          formTypeLetter: 'A',
        });
        const actionsFromExcel: ActionItem[] = String(row['Yapılan İşlemler (virgülle)'] ?? '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
          .map((operation) => ({
            id: `excel_op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'operation',
            action: operation,
            quantity: 1,
            isManualEntry: true,
          }));
        if (String(row['Yedek Parça Kodu'] ?? '').trim() || String(row['Yedek Parça Adı'] ?? '').trim()) {
          actionsFromExcel.push({
            id: `excel_part_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'part_change',
            action: 'parca_degisimi',
            stokKodu: String(row['Yedek Parça Kodu'] ?? '').trim(),
            stokAdi: String(row['Yedek Parça Adı'] ?? '').trim(),
            serialNumber: String(row['Yedek Parça Seri No (opsiyonel)'] ?? '').trim() || undefined,
            quantity: Math.max(1, Number(row['Yedek Parça Adet'] ?? 1) || 1),
            isManualEntry: true,
            removedPartStokKodu: String(row['Çıkan Parça Kodu'] ?? '').trim() || undefined,
            removedPartStokAdi: String(row['Çıkan Parça Adı'] ?? '').trim() || undefined,
            removedPartSerialNumber: String(row['Çıkan Parça Seri No'] ?? '').trim() || undefined,
          });
        }
        const payload = {
          deviceId: device?.id || actualDeviceId,
          cihazAdi: device?.cihazAdi || device?.model,
          seriNumarasi: device?.seriNumarasi,
          hospitalId: device?.hospitalId,
          labName: hospital?.name,
          actions: actionsFromExcel,
          islemTuru: islemTur,
          aciklama: String(row['Açıklama'] ?? '').trim(),
          baslangicSaati: String(row['Başlangıç Saati'] ?? '').trim(),
          bitisSaati: String(row['Bitiş Saati'] ?? '').trim(),
          baslangicTarihi: String(row['Başlangıç Tarihi'] ?? '').trim(),
          bitisTarihi: String(row['Bitiş Tarihi'] ?? '').trim(),
          cihazDurumu: cihazDur,
          cihazDurumuAciklama: cihazDur === 'diger' ? String(row['Cihaz Durumu Açıklama'] ?? '').trim() : null,
          selectedFaultName: String(row['Arıza Adı (opsiyonel)'] ?? '').trim() || null,
          selectedFaultId: null,
          isCustomFault: !!String(row['Arıza Adı (opsiyonel)'] ?? '').trim(),
          createdAt: serverTimestamp(),
          formNo,
          createdByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
          createdByUid: currentUserProfile?.uid || null,
          companyId: currentCompanyId || null,
          formType: 'aplikasyon',
          importedFromExcel: true,
        };
        batch.set(formRef, payload);
        batch.set(doc(collection(db, 'deviceActionForms'), formRef.id), payload);
        successCount += 1;
      }
      if (successCount > 0) await batch.commit();
      toast({ title: 'Excel içe aktarma tamamlandı', description: `Başarılı satır: ${successCount} • Başarısız satır: ${failCount}` });
    } catch (err) {
      console.error('Error importing excel forms:', err);
      toast({ title: 'Hata', description: 'Excel yüklenirken hata oluştu.', variant: 'destructive' });
    }
  };

  const updateActionQuantity = (id: string, quantity: number) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, quantity } : a));
  };

  // Wizard heading definitions with completion tracking (must be before conditional returns)
  const wizardHeadings: WizardHeading[] = useMemo(() => [
    {
      id: 'islem_turu',
      label: 'İŞLEM TÜRÜ',
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
  ], [islemTuru, baslangicTarihi, baslangicSaati, bitisTarihi, bitisSaati, actions, aciklama]);

  if (loading) {
    // PERF (Faz 6 mobil): Spinner yerine form-layout skeleton → mobilde anında yapı.
    return <WizardFormSkeleton />;
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
            {(['rutin_kurum_ziyareti', 'periyodik_bakim', 'ariza', 'alis', 'roche_bilgisayar_arizasi', 'egitim', 'diger'] as IslemTuru[]).map(tur => {
              const hasSubFields = tur === 'ariza' || tur === 'periyodik_bakim' || tur === 'egitim';
              return (
                <React.Fragment key={tur}>
                  <button
                    className={`wizard-option-item ${islemTuru === tur ? 'selected' : ''}`}
                    onClick={() => {
                      setIslemTuru(tur);
                      if (tur !== 'ariza') setSelectedFaultId('');
                    }}
                  >
                    {ISLEM_TURU_LABELS[tur]}
                  </button>

                  {/* Arıza sub-fields shown inline below the arıza option */}
                  {tur === 'ariza' && islemTuru === 'ariza' && (
                    <div className="wizard-fault-section" style={{ margin: '8px 24px 16px' }}>
                      <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '12px' }}>
                        <AlertTriangle className="h-4 w-4 inline mr-2" style={{ color: '#ef4444' }} />
                        Arıza Türü *
                      </label>
                      <Select value={selectedFaultId} onValueChange={(v) => { setSelectedFaultId(v); if (v !== 'diger') setCustomFaultName(''); }}>
                        <SelectTrigger className="wizard-dark-select bg-white/10 border-white/20 text-white">
                          <SelectValue placeholder="Tespit edilen arızayı seçin..." />
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

                  {/* Diğer sub-field shown inline below the diğer option */}
                  {tur === 'diger' && islemTuru === 'diger' && (
                    <div style={{ margin: '8px 24px 16px' }}>
                      <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '12px' }}>
                        Diğer İşlem Açıklaması *
                      </label>
                      <Textarea
                        placeholder="Diğer işlem türü için açıklama girin..."
                        value={aciklama}
                        onChange={(e) => setAciklama(e.target.value)}
                        className="wizard-dark-select bg-white/10 border-white/20 text-white min-h-[96px]"
                      />
                    </div>
                  )}

                  {/* Eğitim sub-fields shown inline below the eğitim option */}
                  {tur === 'egitim' && islemTuru === 'egitim' && (
                    <div style={{ margin: '8px 24px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div>
                        <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                          Eğitim İçeriği (Opsiyonel)
                        </label>
                        <Textarea
                          placeholder="Verilen eğitimin konusu, kapsamı ve notları..."
                          value={egitimIcerigi}
                          onChange={(e) => setEgitimIcerigi(e.target.value)}
                          className="wizard-dark-select bg-white/10 border-white/20 text-white min-h-[96px]"
                        />
                      </div>
                      <div>
                        <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                          Eğitime Katılan Personeller (Opsiyonel)
                        </label>
                        <div style={{ position: 'relative', marginBottom: '8px' }}>
                          <Search style={{ position: 'absolute', left: '12px', top: '10px', width: '16px', height: '16px', color: 'var(--wz-text-secondary)' }} />
                          <input
                            type="text"
                            placeholder="Personel ara..."
                            value={egitimKatilanSearch}
                            onChange={(e) => setEgitimKatilanSearch(e.target.value)}
                            style={{ paddingLeft: '36px', background: 'var(--wz-input-bg)', border: '1px solid var(--wz-input-border)', color: 'var(--wz-text)', borderRadius: '12px', padding: '8px 14px 8px 36px', fontSize: '14px', width: '100%', outline: 'none' }}
                          />
                        </div>
                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--wz-border)', borderRadius: '12px' }}>
                          {allUsers
                            .filter(u => u.uid !== currentUserProfile?.uid)
                            .filter(u => {
                              const q = egitimKatilanSearch.trim().toLowerCase();
                              if (!q) return true;
                              return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
                            })
                            .map(user => {
                              const selected = egitimKatilanlar.some(p => p.uid === user.uid);
                              return (
                                <div
                                  key={user.uid}
                                  onClick={() => {
                                    setEgitimKatilanlar(prev =>
                                      prev.some(p => p.uid === user.uid)
                                        ? prev.filter(p => p.uid !== user.uid)
                                        : [...prev, { uid: user.uid, name: user.name || '', role: user.role || '' }]
                                    );
                                  }}
                                  style={{
                                    padding: '10px 12px', cursor: 'pointer',
                                    borderBottom: '1px solid var(--wz-table-border)',
                                    background: selected ? 'var(--wz-selected-bg)' : 'transparent',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  }}
                                >
                                  <div>
                                    <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--wz-text)' }}>{user.name}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--wz-text-secondary)' }}>{user.email} · {user.role}</div>
                                  </div>
                                  {selected && (
                                    <span style={{ fontSize: '11px', color: 'var(--wz-accent)', fontWeight: 600 }}>Seçildi</span>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                        {egitimKatilanlar.length > 0 && (
                          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--wz-text-secondary)' }}>
                            Seçilen: {egitimKatilanlar.map(p => p.name).join(', ')}
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
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
              <button className="wizard-btn wizard-btn-primary" style={{ width: '100%', padding: '14px', fontSize: '16px' }} onClick={goBack}>Onayla ve Devam Et</button>
            </div>
          </div>
        );

      case 'tarih_saat':
        return (
          <div style={{ padding: '8px 0' }}>
            <div className="wizard-datetime-grid">
              <div>
                <label>Başlangıç Tarihi *</label>
                <input type="date" max={todayDateStr} value={baslangicTarihi} onChange={(e) => handleDateChange('baslangic', e.target.value)} />
              </div>
              <div>
                <label>Başlangıç Saati *</label>
                <input type="time" value={baslangicSaati} onChange={(e) => handleTimeChange('baslangic', e.target.value)} />
              </div>
              <div>
                <label>Bitiş Tarihi *</label>
                <input type="date" max={todayDateStr} value={bitisTarihi} onChange={(e) => handleDateChange('bitis', e.target.value)} />
              </div>
              <div>
                <label>Bitiş Saati *</label>
                <input type="time" value={bitisSaati} onChange={(e) => handleTimeChange('bitis', e.target.value)} />
              </div>
            </div>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '12px' }}>
              İşleme başladığınız ve bitirdiğiniz tarih ve saatleri giriniz.
            </p>
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
              <button className="wizard-btn wizard-btn-primary" style={{ width: '100%', padding: '14px', fontSize: '16px' }} onClick={goBack}>Tarihleri Onayla</button>
            </div>
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

              {isLabMode && (
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--wz-text-secondary)', display: 'block', marginBottom: '6px' }}>
                    İşlem Yapılan Cihazı Seçin <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {devicesByLab.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setPartAssignedDeviceId(d.id)}
                        className={`flex flex-col items-center p-2 rounded-xl border transition-all ${
                          partAssignedDeviceId === d.id
                            ? 'bg-[var(--dashboard-accent)]/10 border-[var(--dashboard-accent)] text-[var(--dashboard-accent)]'
                            : 'bg-[var(--dashboard-surface)] border-[var(--dashboard-stroke)] hover:bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]'
                        }`}
                      >
                        <span className="text-[11px] font-bold truncate w-full text-center">{d.cihazAdi || d.model || 'Cihaz'}</span>
                        <span className="text-[9px] opacity-70 truncate w-full text-center">Model: {d.model || '-'}</span>
                        <span className="text-[9px] opacity-70 truncate w-full text-center">SN: {d.seriNumarasi || '-'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                          key={getDepotSelectionKey(item)}
                          onClick={() => {
                            handleDepotItemSelect(item);
                            setRemovedPartSerialNumber('');
                            setRemovedPartImageFile(null); setRemovedPartImagePreview(null);
                            setUsedPartImageFile(null); setUsedPartImagePreview(null);
                          }}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                            padding: '12px 14px', borderBottom: '1px solid var(--wz-table-border)', cursor: 'pointer',
                            background: selectedDepotStockKey === getDepotSelectionKey(item) ? 'var(--wz-selected-bg)' : 'transparent',
                            borderLeft: selectedDepotStockKey === getDepotSelectionKey(item) ? '3px solid #f97316' : '3px solid transparent',
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

            {/* Confirm & return — available once at least one part has been added */}
            {actions.some(a => a.type === 'part_change') && (
              <button
                className="wizard-btn wizard-btn-primary"
                onClick={goBack}
                style={{ width: '100%', marginTop: '10px' }}
              >
                Onayla
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
          setHucreDegisimiRows(prev => [...prev, {
            id: `hucre_row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            stockSourceTab: 'personal',
            selectedPersonalItem: null,
            selectedDepotItem: null,
            searchQuery: '',
            removedHucreNumarasi: '',
            description: '',
          }]);
        };
        const saveHucreDegisimiRows = () => {
          if (!hucreDegisimiRows.length) return;
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
            newActions.push({
              id: `hucre_${Date.now()}_${i}`,
              type: 'hucre_degisimi',
              action: `Hücre Değişimi: ${selectedItem.hucreNumarasi}`,
              productCodeId: (selectedItem as any).productCodeId || '',
              stokKodu: selectedItem.stokKodu,
              stokAdi: selectedItem.stokAdi,
              anaBirim: selectedItem.anaBirim,
              quantity: 1,
              personalStockId: row.stockSourceTab === 'personal' ? selectedItem.id : undefined,
              depotStockId: row.stockSourceTab === 'depot' ? selectedItem.id : undefined,
              isDepotSelection: row.stockSourceTab === 'depot',
              serialNumber: selectedItem.serialNumber,
              lotNumber: (selectedItem as any).lotNumber,
              hucreNumarasi: selectedItem.hucreNumarasi || '',
              removedHucreNumarasi: removedHn,
              channelSelections: row.selectedChannel ? [row.selectedChannel] : [],
              removedPartStokKodu: selectedItem.stokKodu,
              removedPartStokAdi: selectedItem.stokAdi,
              description: row.description.trim() || '',
              assignedDeviceId: isLabMode ? row.assignedDeviceId : undefined,
            });
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
                      <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--wz-border)', borderRadius: '12px', marginBottom: '8px' }}>
                        {(row.stockSourceTab === 'personal' ? personalCandidates : depotCandidates).map(item => (
                          <div key={item.id || `${item.stokKodu}-${item.hucreNumarasi}`} onClick={() => updateRow(row.id, r => r.stockSourceTab === 'personal' ? { ...r, selectedPersonalItem: item as PersonalStockItem } : { ...r, selectedDepotItem: item as DepotSelectableStockItem })} style={{ padding: '10px 12px', borderBottom: '1px solid var(--wz-table-border)', cursor: 'pointer', background: selectedItem?.id === item.id ? 'var(--wz-selected-bg)' : 'transparent' }}>
                            <div style={{ fontWeight: 600 }}>{item.stokAdi}</div>
                            <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>{item.stokKodu} · H:{item.hucreNumarasi}</div>
                          </div>
                        ))}
                      </div>
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
                          {isLabMode && (
                            <div style={{ marginBottom: '8px' }}>
                              <label style={{ display: 'block', fontSize: '13px', color: 'var(--wz-text-secondary)', marginBottom: '4px' }}>Cihaz Seçin *</label>
                              <Select value={row.assignedDeviceId} onValueChange={(v) => updateRow(row.id, r => ({ ...r, assignedDeviceId: v }))}>
                                <SelectTrigger className="bg-white/10 border-white/20 text-white h-9">
                                  <SelectValue placeholder="Cihaz seçin..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {devicesByLab.map(d => (
                                    <SelectItem key={d.id} value={d.id}>{d.cihazAdi || d.model} ({d.seriNumarasi})</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
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

            {/* Confirm & return — available once at least one hücre change has been saved */}
            {actions.some(a => a.type === 'hucre_degisimi') && (
              <button
                className="wizard-btn wizard-btn-primary"
                onClick={goBack}
                style={{ width: '100%', marginTop: '10px' }}
              >
                Onayla
              </button>
            )}
          </div>
        );
      }

      case 'yapilan_islem':
        return (
          <div>
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
                        setActions(prev => prev.filter(a => !(a.type === 'operation' && a.action === op)));
                      } else {
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
                    {op === 'diger' && alreadyAdded && (
                      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginLeft: '8px' }}>
                        {digerAciklama ? `(${digerAciklama})` : ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
              <button className="wizard-btn wizard-btn-primary" style={{ width: '100%', padding: '14px', fontSize: '16px' }} onClick={goBack}>İşlemleri Onayla</button>
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
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
              <button className="wizard-btn wizard-btn-primary" style={{ width: '100%', padding: '14px', fontSize: '16px' }} onClick={goBack}>Açıklamayı Onayla</button>
            </div>
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
      {islemTuru === 'egitim' && (egitimIcerigi.trim() || egitimKatilanlar.length > 0) && (
        <div className="wizard-save-summary-item">
          <span className="label">Eğitim</span>
          <span className="value">
            {egitimKatilanlar.length > 0 ? `${egitimKatilanlar.length} katılımcı` : ''}
            {egitimKatilanlar.length > 0 && egitimIcerigi.trim() ? ' · ' : ''}
            {egitimIcerigi.trim() ? (egitimIcerigi.trim().length > 40 ? egitimIcerigi.trim().substring(0, 40) + '…' : egitimIcerigi.trim()) : ''}
          </span>
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
          disabled={isSaving || (islemTuru !== 'egitim' && actions.length === 0)}
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
            onClick={() => { if (window.history.length > 2) router.back(); else router.push(`/aplikasyon-paneli/${device.hospitalId}`); }}
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
              <div className="wizard-header-title">Aplikasyon İşlem Formu</div>
            </div>
            <div className="wizard-header-device">{device.cihazAdi} <span className="wizard-header-sn">Seri No: {device.seriNumarasi}</span></div>
            <div className="wizard-header-meta">
              <span className="wizard-header-meta-tag"><strong>Lab:</strong> {hospital?.name || '-'}</span>
              <span className="wizard-header-meta-tag"><strong>İşlemi Yapan:</strong> {currentUserProfile?.name || '-'}</span>
              <span className="wizard-header-meta-tag"><strong>Tarih:</strong> {format(new Date(), 'dd.MM.yyyy HH:mm', { locale: tr })}</span>
            </div>
          </div>
          <button
            className="wizard-icon-btn"
            onClick={() => router.push(`/aplikasyon-paneli/gecmis/${deviceId}`)}
            aria-label="Geçmiş"
          >
            <History size={16} />
          </button>
        </header>
        <div className="px-3 pt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="wizard-btn wizard-btn-secondary !py-2 !px-3 !text-xs"
            onClick={downloadExcelTemplate}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Aplikasyon Excel Şablonu
          </button>
          <label className="wizard-btn wizard-btn-secondary !py-2 !px-3 !text-xs cursor-pointer">
            <Upload className="h-3.5 w-3.5 mr-1" />
            Excel'den Form Yükle
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
          </label>
        </div>

        {/* Wizard Form Body */}
        <WizardFormShell
          headings={wizardHeadings}
          renderDetail={renderWizardDetail}
          renderSaveConfirm={renderWizardSaveConfirm}
          onSaveDraft={handleSaveDraft}
          onSave={startSaveProcess}
          isSaving={isSaving}
          isSavingDraft={isSavingDraft}
          saveDisabled={isSaving || (islemTuru !== 'egitim' && actions.length === 0)}
          useGrid={true}
          title={isLabMode ? "Laboratuvar Geneli Form Girişi" : "İşlem Formu"}
          deviceName={isLabMode ? `${devicesByLab.length} Cihaz Seçili` : `${device.cihazAdi || device.model} / ${device.seriNumarasi}`}
          hospitalName={hospital?.name || ''}
          icon={isLabMode ? <Building2 className="h-5 w-5" /> : <ClipboardList className="h-5 w-5" />}
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
              <div key={op} className="flex items-start space-x-3">
                <Checkbox
                  id={op}
                  checked={selectedOperations.includes(op)}
                  onCheckedChange={() => toggleOperation(op)}
                />
                <div className="flex flex-col">
                  <Label htmlFor={op} className="cursor-pointer font-medium">
                    {OPERATION_LABELS[op]}
                  </Label>
                  {op === 'diger' && selectedOperations.includes('diger') && (
                    <Input
                      className="mt-2 w-full"
                      placeholder="Açıklama (zorunlu)"
                      value={digerAciklama}
                      onChange={(e) => setDigerAciklama(e.target.value)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOperationModalOpen(false)}>İptal</Button>
            <Button onClick={addSelectedOperations} disabled={selectedOperations.length === 0}>
              Ekle ({selectedOperations.length})
            </Button>
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
          <DialogHeader className="px-4 sm:px-6 py-4 border-b">
            <DialogTitle className="text-lg font-semibold tracking-tight">Yedek Parça Değişimi</DialogTitle>
          </DialogHeader>
          <div className="flex-1 px-4 sm:px-6 py-4 space-y-4 overflow-y-auto">
            {/* Section 1: Select part from personal stock or pool stock */}
            <div className="p-4 border border-border rounded-lg bg-background space-y-3">
              <Label className="font-semibold text-sm">1. Parça Seçin</Label>

              {/* Stock source tabs */}
              {!showManualEntry && (
                <div className="flex gap-1 p-1 rounded-lg bg-muted/40 border border-border">
                  <button
                    onClick={() => { setStockSourceTab('personal'); setSelectedPoolStockItem(null); setSelectedDepotStockItem(null); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${stockSourceTab === 'personal' ? 'bg-background shadow-sm' : ''}`}
                  >
                    <Package className="h-3 w-3 inline mr-1" />
                    Şahsi Stok ({personalStock.filter(p => !usedPersonalStockIds.has(p.id)).length})
                  </button>
                  {poolStockItems.length > 0 && (
                    <button
                      onClick={() => { setStockSourceTab('pool'); setSelectedStockItem(null); setSelectedDepotStockItem(null); }}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${stockSourceTab === 'pool' ? 'bg-background shadow-sm' : ''}`}
                    >
                      <Package className="h-3 w-3 inline mr-1" />
                      Havuz Stok ({poolStockItems.filter(p => !usedPoolStockIds.has(p.id)).length})
                    </button>
                  )}
                  <button
                    onClick={() => { setStockSourceTab('depot'); setSelectedStockItem(null); setSelectedPoolStockItem(null); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${stockSourceTab === 'depot' ? 'bg-background shadow-sm' : ''}`}
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
                  <ScrollArea className="h-44 border border-border rounded-lg bg-background">
                    {filteredStock.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
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
                            className={`w-full text-left p-3 rounded-lg transition-colors ${
                              selectedStockItem?.id === item.id
                                ? 'bg-primary/10 border border-primary/40'
                                : 'hover:bg-muted/60 border border-transparent'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{item.stokAdi}</p>
                                <p className="text-xs text-muted-foreground font-mono">{item.stokKodu}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono">{item.serialNumber}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.source === 'depot' ? 'Depodan' : 'Cihazdan'}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={activateManualEntry}
                    className="w-full text-xs"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Stokta yok, manuel ekle
                  </Button>
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
                  <ScrollArea className="h-44 border border-border rounded-lg bg-background">
                    {filteredPoolStock.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
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
                            className={`w-full text-left p-3 rounded-lg transition-colors ${
                              selectedPoolStockItem?.id === item.id
                                ? 'bg-purple-500/10 border border-purple-500/40'
                                : 'hover:bg-muted/60 border border-transparent'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{item.stokAdi}</p>
                                <p className="text-xs text-muted-foreground font-mono">{item.stokKodu}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono">{item.serialNumber || '—'}</p>
                                <p className="text-xs text-purple-600 font-medium">{item.poolWarehouseName}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={activateManualEntry}
                    className="w-full text-xs"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Stokta yok, manuel ekle
                  </Button>
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
                  <ScrollArea className="h-44 border border-border rounded-lg bg-background">
                    {filteredDepotStock.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        {selectableDepotStock.length === 0
                          ? 'Depoda eklenebilir yedek parça bulunmuyor.'
                          : 'Sonuç bulunamadı.'}
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredDepotStock.map(item => (
                          <button
                            key={getDepotSelectionKey(item)}
                            onClick={() => handleDepotItemSelect(item)}
                            className={`w-full text-left p-3 rounded-lg transition-colors ${
                              selectedDepotStockKey === getDepotSelectionKey(item)
                                ? 'bg-orange-500/10 border border-orange-500/40'
                                : 'hover:bg-muted/60 border border-transparent'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{item.stokAdi}</p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {item.stokKodu}
                                  {item.serialNumber ? ` · SN:${item.serialNumber}` : ''}
                                  {item.hucreNumarasi ? ` · H:${item.hucreNumarasi}` : ''}
                                  {!item.serialNumber && !item.hucreNumarasi ? ` · ${item.totalQuantity} adet` : ''}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono">{item.serialNumber || item.hucreNumarasi || `${item.totalQuantity} adet`}</p>
                                <p className="text-xs text-orange-600 font-medium">{item.address || 'Depo'}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={activateManualEntry}
                    className="w-full text-xs"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Stokta yok, manuel ekle
                  </Button>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowManualEntry(false)}
                    className="text-xs"
                  >
                    Stoktan seç
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Section 2: Removed part info (from device) */}
            <div className={`p-4 border rounded-lg space-y-3 ${(!pendingPeriodicPartChangeId || periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)?.requiresOutgoingPartInfo) ? 'border-amber-200/70 bg-amber-50/70 dark:bg-amber-950/20 dark:border-amber-800/60' : 'border-border bg-background'}`}>
              <Label className="font-semibold text-sm flex items-center gap-2">
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
              <div className="space-y-3 pt-2 border-t border-amber-200 dark:border-amber-800">
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
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => {
                          setRemovedPartImageFile(null);
                          setRemovedPartImagePreview(null);
                          if (removedPartImageInputRef.current) {
                            removedPartImageInputRef.current.value = '';
                          }
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full h-16 border-dashed flex flex-col gap-1"
                      onClick={() => removedPartImageInputRef.current?.click()}
                    >
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Çıkan parça fotoğrafı (Kamera/Galeri)</span>
                    </Button>
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
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => {
                          setUsedPartImageFile(null);
                          setUsedPartImagePreview(null);
                          if (usedPartImageInputRef.current) {
                            usedPartImageInputRef.current.value = '';
                          }
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full h-16 border-dashed flex flex-col gap-1"
                      onClick={() => usedPartImageInputRef.current?.click()}
                    >
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Takılan parça fotoğrafı (Kamera/Galeri)</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Selected item summary */}
            {(selectedStockItem || selectedPoolStockItem || (showManualEntry && manualPartCode && manualSerialNumber)) && (
              <div className={`p-3 rounded-lg text-sm ${selectedPoolStockItem ? 'bg-purple-50 dark:bg-purple-950/20' : 'bg-green-50 dark:bg-green-950/20'}`}>
                <p className={`font-medium ${selectedPoolStockItem ? 'text-purple-800 dark:text-purple-200' : 'text-green-800 dark:text-green-200'}`}>
                  Takılacak: {selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || manualPartName} ({selectedStockItem?.serialNumber || selectedPoolStockItem?.serialNumber || manualSerialNumber})
                  {selectedPoolStockItem && <span className="ml-1 text-xs text-purple-600">(Havuz: {selectedPoolStockItem.poolWarehouseName})</span>}
                </p>
                <p className={selectedPoolStockItem ? 'text-purple-700 dark:text-purple-300' : 'text-green-700 dark:text-green-300'}>
                  Çıkacak: {removedPartStokAdi || selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || manualPartName} ({removedPartSerialNumber || 'Seri No Yok'})
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="px-4 sm:px-6 py-3 sm:py-4 border-t bg-background grid grid-cols-2 gap-2 sm:flex sm:justify-end sm:gap-2">
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => setIsPartModalOpen(false)}>İptal</Button>
            <Button
              className="w-full sm:w-auto"
              onClick={addSelectedPart}
              disabled={
                (!selectedStockItem && !selectedPoolStockItem && !(showManualEntry && manualPartCode && manualPartName && (!pendingPeriodicPartChangeId || periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)?.requiresSerialTracking !== false ? manualSerialNumber : true)))
                || isUploadingImage
              }
            >
              {isUploadingImage ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Yükleniyor...</> : 'Ekle'}
            </Button>
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
            <Button variant="outline" onClick={() => { setIsDepotQuantityDialogOpen(false); setPendingDepotStockItem(null); }}>İptal</Button>
            <Button onClick={confirmDepotQuantitySelection}>Seçimi Onayla</Button>
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
                  {(Object.keys(CIHAZ_DURUMU_LABELS) as CihazDurumu[])
                    .filter(k => k !== '')
                    .map(key => (
                      <div key={key} className="flex items-center space-x-2">
                        <RadioGroupItem value={key} id={`durumu-${key}`} />
                        <Label htmlFor={`durumu-${key}`} style={{ color: 'var(--wz-text)' }}>
                          {CIHAZ_DURUMU_LABELS[key]}
                        </Label>
                      </div>
                    ))}
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
                  {filteredUsers
                    .filter(u => u.uid !== currentUserProfile?.uid)
                    .map(user => (
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
            <p className="text-sm text-muted-foreground mb-4">
              Arızayla ilişkili testleri seçin. Bu bilgi arıza istatistiklerine yansıtılacaktır.
            </p>
            <ScrollArea className="h-64 border rounded-md">
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
                    className={`w-full text-left p-2 rounded-md transition-colors flex items-center justify-between ${
                      selectedTests.includes(test)
                        ? 'bg-primary/10 border-primary border'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <span className="font-medium">{test}</span>
                    {selectedTests.includes(test) && (
                      <span className="text-primary text-sm">Seçildi</span>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTestModalOpen(false)}>Kapat</Button>
            <Button onClick={() => setIsTestModalOpen(false)}>
              Tamam ({selectedTests.length} test)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
