'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, addDoc, serverTimestamp, query, getDocs, where, orderBy, updateDoc, Timestamp, writeBatch, setDoc, deleteDoc } from 'firebase/firestore';
import type { Device, Hospital, ProductCode, User, MaintenancePlan, MaintenanceLog, PersonalStockItem, PeriodicPartChange, PeriodicPartChangeLog, MaintenancePeriodUnit, FaultDefinition, DraftActionLog } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Wrench, ClipboardList, Trash2, Save, History, Search, Plus, FileText, Cog, Camera, ImageIcon, X, Package, AlertTriangle, Clock, PauseCircle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { resolveImageSrc } from '@/lib/image-utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import SignaturePad from '@/components/SignaturePad';
import type { SignaturePadRef } from '@/components/SignaturePad';
import AplikasyonTutanakPDFButton from '@/components/exports/AplikasyonTutanakPDFButton';

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
type IslemTuru = 'rutin_kurum_ziyareti' | 'periyodik_bakim' | 'ariza' | 'alis' | 'roche_bilgisayar_arizasi' | '';

// İşlem Türü Labels
const ISLEM_TURU_LABELS: Record<IslemTuru, string> = {
  '': 'Seçiniz',
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  ariza: 'Arıza',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};

// Cihaz Durumu
type CihazDurumu = 'calisiyor' | 'arizali' | 'denemede' | 'diger' | '';

type ActionItem = {
  id: string;
  type: 'part_change' | 'operation';
  action: string;
  stokKodu?: string;
  stokAdi?: string;
  quantity: number;
  description?: string;
  isManualEntry?: boolean;
  // Personal stock info for part changes
  personalStockId?: string;
  serialNumber?: string;
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

export default function AplikasyonIslemFormuPage() {
  const params = useParams();
  const deviceId = params ? (Array.isArray(params.deviceId) ? params.deviceId[0] : params.deviceId as string) : '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdFromUrl = searchParams?.get('draftId') || null;
  const { currentUserProfile } = useAuth();
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

  // Başlangıç ve Bitiş Saatleri/Tarihleri (Zorunlu)
  const [baslangicSaati, setBaslangicSaati] = useState<string>('');
  const [bitisSaati, setBitisSaati] = useState<string>('');
  const [baslangicTarihi, setBaslangicTarihi] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [bitisTarihi, setBitisTarihi] = useState<string>(format(new Date(), 'yyyy-MM-dd'));


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
  const [digerAciklama, setDigerAciklama] = useState('');

  // Part selection modal - now using personal stock
  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [personalStock, setPersonalStock] = useState<PersonalStockItem[]>([]);
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

  // Fault definitions for arıza işlem türü
  const [faultDefinitions, setFaultDefinitions] = useState<FaultDefinition[]>([]);
  const [selectedFaultId, setSelectedFaultId] = useState<string>('');
  const [customFaultName, setCustomFaultName] = useState<string>('');

  // Test selection for arıza
  const [availableTests, setAvailableTests] = useState<string[]>([]);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  useEffect(() => {
    if (!deviceId) return;
    setLoading(true);
    (async () => {
      try {
        const deviceSnap = await getDoc(doc(db, 'devices', deviceId));
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
  }, [deviceId, router, toast]);

  // Load draft if draftId is in URL
  useEffect(() => {
    if (!draftIdFromUrl || !deviceId) return;
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
  }, [draftIdFromUrl, deviceId, currentUserProfile?.uid, currentUserProfile?.name, toast]);

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

  // Fetch users for accompanying personnel
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }) as User);
        // Aplikasyon formu için sadece aplikasyon personelini göster
        setAllUsers(users.filter(u => u.role === 'aplikasyon'));
      } catch (err) {
        console.error("Error fetching users:", err);
      }
    })();
  }, []);

  // Fetch maintenance plans and logs for this device (aplikasyon type)
  useEffect(() => {
    if (!deviceId) return;
    (async () => {
      try {
        // Fetch aplikasyon maintenance plans for this device
        const plansQuery = query(
          collection(db, 'maintenancePlans'),
          where('deviceId', '==', deviceId),
          where('type', '==', 'aplikasyon')
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
        // Fetch periodic part changes for aplikasyon or both
        const partsQuery = query(
          collection(db, 'periodicPartChanges'),
          where('deviceId', '==', deviceId)
        );
        const partsSnap = await getDocs(partsQuery);
        const allParts = partsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PeriodicPartChange);
        // Filter for aplikasyon or both responsibility
        const filteredParts = allParts.filter(p => p.responsibilityType === 'aplikasyon' || p.responsibilityType === 'both');
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

  // Fetch fault definitions for aplikasyon type
  useEffect(() => {
    (async () => {
      try {
        const q = query(
          collection(db, 'faultDefinitions'),
          where('type', '==', 'aplikasyon')
        );
        const snap = await getDocs(q);
        const faults = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.() || null,
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

  // Filtered personal stock
  const filteredStock = useMemo(() => {
    if (!partSearchQuery) return personalStock;
    const q = partSearchQuery.toLowerCase();
    return personalStock.filter(p =>
      p.stokKodu.toLowerCase().includes(q) ||
      p.stokAdi.toLowerCase().includes(q) ||
      p.serialNumber.toLowerCase().includes(q)
    );
  }, [personalStock, partSearchQuery]);

  const installedPartDefaults = useMemo(() => ({
    stokKodu: showManualEntry ? manualPartCode.trim() : (selectedStockItem?.stokKodu || ''),
    stokAdi: showManualEntry ? manualPartName.trim() : (selectedStockItem?.stokAdi || ''),
  }), [showManualEntry, manualPartCode, manualPartName, selectedStockItem]);

  useEffect(() => {
    if (!isPartModalOpen) return;
    setRemovedPartStokKodu(installedPartDefaults.stokKodu);
    setRemovedPartStokAdi(installedPartDefaults.stokAdi);
  }, [isPartModalOpen, installedPartDefaults]);

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

  const openPartModal = () => {
    setPartSearchQuery('');
    setSelectedStockItem(null);
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
    setIsPartModalOpen(true);
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
        removedPartStokKodu: installedPartDefaults.stokKodu,
        removedPartStokAdi: installedPartDefaults.stokAdi,
        removedPartSerialNumber: removedPartSerialNumber.trim(),
        removedPartImageUrl,
        usedPartImageUrl,
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
      // Check if this stock item is already in the actions list
      if (actions.some(a => a.personalStockId === selectedStockItem.id)) {
        toast({ title: 'Uyarı', description: 'Bu parça zaten listeye eklendi.', variant: 'default' });
        return;
      }

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
        serialNumber: selectedStockItem.serialNumber,
        personalStockId: selectedStockItem.id,
        quantity: 1, // Personal stock items are individual
        removedPartStokKodu: installedPartDefaults.stokKodu,
        removedPartStokAdi: installedPartDefaults.stokAdi,
        removedPartSerialNumber: removedPartSerialNumber.trim(),
        removedPartImageUrl,
        usedPartImageUrl,
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
    } else {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen şahsi stokunuzdan bir parça seçin.', variant: 'destructive' });
      return;
    }
    setPendingPeriodicPartChangeId(null);
    setIsPartModalOpen(false);
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

  const openOperationModal = () => {
    setSelectedOperations([]);
    setDigerAciklama('');
    setIsOperationModalOpen(true);
  };

  const toggleOperation = (op: OperationType) => {
    setSelectedOperations(prev =>
      prev.includes(op) ? prev.filter(o => o !== op) : [...prev, op]
    );
  };

  const addSelectedOperations = () => {
    // Validate "diger" requires description
    if (selectedOperations.includes('diger') && !digerAciklama.trim()) {
      toast({ title: 'Eksik Bilgi', description: '"Diğer" seçeneği için açıklama zorunludur.', variant: 'destructive' });
      return;
    }

    const newItems: ActionItem[] = selectedOperations.map(op => ({
      id: crypto.randomUUID(),
      type: 'operation' as const,
      action: op,
      quantity: 1,
      description: op === 'diger' ? digerAciklama : '',
    }));

    setActions(prev => [...prev, ...newItems]);
    setIsOperationModalOpen(false);
    setSelectedOperations([]);
    setDigerAciklama('');
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
        deviceId,
        hospitalId: device?.hospitalId || '',
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

  const handleSaveSignaturesAndFinish = async (finalSignatures: { personnel?: string; technician?: string }, finalTechnicianName?: string) => {
    setIsSaving(true);
    setIsSignatureModalOpen(false);

    try {
        const now = new Date();
        const batch = writeBatch(db);

        // Get selected maintenance plan details for saving
        const selectedMaintenancePlanDetails = maintenancePlans
          .filter(p => selectedMaintenanceTasks.includes(p.id))
          .map(p => ({ id: p.id, taskName: p.taskName }));

        // Get selected fault for ariza type
        const isCustomFault = selectedFaultId === 'diger';
        const selectedFault = islemTuru === 'ariza' && !isCustomFault ? faultDefinitions.find(f => f.id === selectedFaultId) : null;
        const resolvedFaultName = isCustomFault ? customFaultName.trim() : (selectedFault?.name || null);
        const resolvedFaultId = isCustomFault ? null : (selectedFault?.id || null);

        // Create form document
        const formRef = doc(collection(db, 'aplikasyonActionForms'));
        batch.set(formRef, {
            deviceId,
            cihazAdi: device?.cihazAdi || device?.model,
            seriNumarasi: device?.seriNumarasi,
            hospitalId: device?.hospitalId,
            labName: hospital?.name,
            actions,
            islemTuru: islemTuru || null,
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
            formType: 'aplikasyon',
            selectedMaintenanceTasks: islemTuru === 'periyodik_bakim' ? selectedMaintenancePlanDetails : null,
            // Fault info for ariza type
            faultDefinitionId: resolvedFaultId,
            faultName: resolvedFaultName,
            isCustomFault: isCustomFault || false,
            selectedTests: islemTuru === 'ariza' && selectedTests.length > 0 ? selectedTests : null,
            // Draft continuation logs (personnel attribution)
            draftActionLogs: draftActionLogs.length > 0 ? draftActionLogs.map(log => ({
              ...log,
              timestamp: log.timestamp instanceof Date ? Timestamp.fromDate(log.timestamp) : log.timestamp,
            })) : null,
            continuedFromDraft: !!currentDraftId,
        });

        // Mirror form to deviceActionForms for device history page
        const deviceFormRef = doc(collection(db, 'deviceActionForms'), formRef.id);
        batch.set(deviceFormRef, {
            deviceId,
            cihazAdi: device?.cihazAdi || device?.model,
            seriNumarasi: device?.seriNumarasi,
            hospitalId: device?.hospitalId,
            labName: hospital?.name,
            actions,
            islemTuru: islemTuru || null,
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
            formType: 'aplikasyon',
            selectedMaintenanceTasks: islemTuru === 'periyodik_bakim' ? selectedMaintenancePlanDetails : null,
            faultDefinitionId: resolvedFaultId,
            faultName: resolvedFaultName,
            isCustomFault: isCustomFault || false,
            selectedTests: islemTuru === 'ariza' && selectedTests.length > 0 ? selectedTests : null,
        });

        // Create closed fault report when ariza is selected
        if (islemTuru === 'ariza' && (selectedFault || isCustomFault)) {
          // Parse başlangıç ve bitiş tarih/saatlerini oluştur
          const [startYear, startMonth, startDay] = baslangicTarihi.split('-').map(Number);
          const [startHour, startMinute] = baslangicSaati.split(':').map(Number);
          const [endYear, endMonth, endDay] = bitisTarihi.split('-').map(Number);
          const [endHour, endMinute] = bitisSaati.split(':').map(Number);

          const startTime = new Date(startYear, startMonth - 1, startDay, startHour, startMinute);
          const endTime = new Date(endYear, endMonth - 1, endDay, endHour, endMinute);

          // Çözüm süresi hesapla (milisaniye)
          const cozumSuresi = endTime.getTime() - startTime.getTime();
          const toplamCozumSuresi = cozumSuresi;

          // İlk eşlik eden personeli destek personeli olarak ata (performans puanı için)
          const supportPerson = eslikEdenPersonel.length > 0 ? eslikEdenPersonel[0] : null;

          const faultReportRef = doc(collection(db, 'deviceFaultReports'));
          batch.set(faultReportRef, {
            deviceId,
            hospitalId: device?.hospitalId,
            labName: hospital?.name,
            model: device?.cihazAdi || device?.model,
            serial: device?.seriNumarasi,
            faultType: 'aplikasyon',
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
            toplamCozumSuresi,
            resolvedFromFormId: formRef.id,
            resolvedFromFormType: 'aplikasyon',
            eslikEdenPersonel: eslikEdenPersonel.length > 0 ? eslikEdenPersonel : null,
            // Destek personeli bilgisi (performans hesaplaması için)
            supportPersonnelUid: supportPerson?.uid || null,
            supportPersonnelName: supportPerson?.name || null,
            relatedTests: selectedTests.length > 0 ? selectedTests : null,
            isCustomFault: isCustomFault || false,
            // Arıza kaydı işlem formundan açıldığı için bildirim gönderilmeyecek
            createdFromActionForm: true,
          });

          // Arıza geçmişine "opened" kaydı ekle
          const historyOpenedRef = doc(collection(db, 'deviceFaultReports', faultReportRef.id, 'history'));
          batch.set(historyOpenedRef, {
            type: 'opened',
            actorUid: currentUserProfile?.uid,
            actorName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
            description: aciklama.trim(),
            timestamp: Timestamp.fromDate(startTime),
          });

          // Arıza geçmişine "closed" kaydı ekle
          const historyClosedRef = doc(collection(db, 'deviceFaultReports', faultReportRef.id, 'history'));
          batch.set(historyClosedRef, {
            type: 'closed',
            actorUid: currentUserProfile?.uid,
            actorName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
            description: supportPerson
              ? `${aciklama.trim()} (Destek: ${supportPerson.name})`
              : aciklama.trim(),
            timestamp: Timestamp.fromDate(endTime),
            supportPersonnelUid: supportPerson?.uid || null,
            supportPersonnelName: supportPerson?.name || null,
          });
        }

        // Process part changes - update personal stock and create removed part entries
        // Deduplicate: if a periodic part was auto-added AND manually added, keep only the more detailed one
        const allPartChanges = actions.filter(a => a.type === 'part_change');
        const partChanges: typeof allPartChanges = [];
        const processedPersonalStockIds = new Set<string>();
        const processedPeriodicIds = new Set<string>();

        for (const pc of allPartChanges) {
          if (pc.personalStockId && processedPersonalStockIds.has(pc.personalStockId)) continue;
          if (pc.periodicPartChangeId && processedPeriodicIds.has(pc.periodicPartChangeId)) {
            const existingIdx = partChanges.findIndex(e => e.periodicPartChangeId === pc.periodicPartChangeId);
            if (existingIdx >= 0) {
              const existing = partChanges[existingIdx];
              const pcHasDetails = !!(pc.personalStockId || pc.removedPartSerialNumber);
              const existingHasDetails = !!(existing.personalStockId || existing.removedPartSerialNumber);
              if (pcHasDetails && !existingHasDetails) {
                partChanges[existingIdx] = pc;
              }
            }
            continue;
          }
          partChanges.push(pc);
          if (pc.personalStockId) processedPersonalStockIds.add(pc.personalStockId);
          if (pc.periodicPartChangeId) processedPeriodicIds.add(pc.periodicPartChangeId);
        }

        for (const partChange of partChanges) {
          let removedStockRefId: string | null = null;

          // Create new personal stock entry for removed part (from device) first
          if (partChange.removedPartSerialNumber) {
            const removedStockRef = doc(collection(db, 'personalStock'));
            removedStockRefId = removedStockRef.id;
            batch.set(removedStockRef, {
              ownerUid: currentUserProfile?.uid || '',
              ownerName: currentUserProfile?.name || '',
              productCodeId: partChange.personalStockId ? partChange.action : null,
              stokKodu: partChange.removedPartStokKodu || partChange.stokKodu,
              stokAdi: partChange.removedPartStokAdi || partChange.stokAdi,
              serialNumber: partChange.removedPartSerialNumber,
              imageUrl: partChange.removedPartImageUrl || null,
              source: 'device',
              sourceDeviceId: deviceId,
              sourceDeviceName: device?.cihazAdi || device?.model || '',
              status: 'in_stock',
              createdAt: Timestamp.fromDate(now),
              replacedPartId: partChange.personalStockId || null,
            });
          }

          // If this is from personal stock, mark as used (single update with all fields)
          if (partChange.personalStockId) {
            const stockRef = doc(db, 'personalStock', partChange.personalStockId);
            batch.update(stockRef, {
              status: 'used',
              usedAt: Timestamp.fromDate(now),
              usedOnDeviceId: deviceId,
              usedOnDeviceName: device?.cihazAdi || device?.model || '',
              usedOnFormId: formRef.id,
              usedOnFormType: 'aplikasyon',
              replacedPartId: removedStockRefId,
              usedPartImageUrl: partChange.usedPartImageUrl || null,
            });

            // Create log for using the part
            const useLogRef = doc(collection(db, 'sparePartTransferLogs'));
            batch.set(useLogRef, {
              action: 'use_on_device',
              personalStockId: partChange.personalStockId,
              stokKodu: partChange.stokKodu,
              stokAdi: partChange.stokAdi,
              serialNumber: partChange.serialNumber,
              deviceId,
              deviceName: device?.cihazAdi || device?.model || '',
              labName: hospital?.name || '',
              formId: formRef.id,
              formType: 'aplikasyon',
              createdAt: Timestamp.fromDate(now),
              createdByUid: currentUserProfile?.uid || '',
              createdByName: currentUserProfile?.name || '',
              usageImageUrl: partChange.usedPartImageUrl || null,
            });
          }

          // If this is a manual entry (borrowed part), create a borrowed spare part record
          if (partChange.isManualEntry) {
            const borrowedRef = doc(collection(db, 'borrowedSpareParts'));
            batch.set(borrowedRef, {
              stokKodu: partChange.stokKodu,
              stokAdi: partChange.stokAdi,
              serialNumber: partChange.serialNumber,
              deviceId,
              deviceName: device?.cihazAdi || device?.model || '',
              hospitalId: device?.hospitalId || '',
              labName: hospital?.name || '',
              formId: formRef.id,
              formType: 'aplikasyon',
              borrowedByUid: currentUserProfile?.uid || '',
              borrowedByName: currentUserProfile?.name || '',
              borrowedAt: Timestamp.fromDate(now),
              status: 'pending', // pending, approved, rejected
              approvedByUid: null,
              approvedByName: null,
              approvedAt: null,
            });

            // Create log for borrowed part
            const borrowLogRef = doc(collection(db, 'sparePartTransferLogs'));
            batch.set(borrowLogRef, {
              action: 'borrowed_part',
              stokKodu: partChange.stokKodu,
              stokAdi: partChange.stokAdi,
              serialNumber: partChange.serialNumber,
              deviceId,
              deviceName: device?.cihazAdi || device?.model || '',
              formId: formRef.id,
              formType: 'aplikasyon',
              createdAt: Timestamp.fromDate(now),
              createdByUid: currentUserProfile?.uid || '',
              createdByName: currentUserProfile?.name || '',
              usageImageUrl: partChange.usedPartImageUrl || null,
            });
          }
        }

        // Create maintenance logs for each selected maintenance task
        if (islemTuru === 'periyodik_bakim' && selectedMaintenanceTasks.length > 0) {
          for (const planId of selectedMaintenanceTasks) {
            const plan = maintenancePlans.find(p => p.id === planId);
            if (plan) {
              // Calculate next due date: use nextDueDate-based monthly recurrence if available
              let nextDueDate: Date;
              if (plan.nextDueDate) {
                const currentDue = plan.nextDueDate?.toDate ? plan.nextDueDate.toDate() : new Date(plan.nextDueDate);
                const latestPlanLog = maintenanceLogs.find((l: any) => l.maintenancePlanId === plan.id);
                const baseDue = latestPlanLog?.nextDueDate ? (latestPlanLog.nextDueDate instanceof Date ? latestPlanLog.nextDueDate : latestPlanLog.nextDueDate.toDate()) : currentDue;
                nextDueDate = new Date(baseDue);
                nextDueDate.setMonth(nextDueDate.getMonth() + 1);
              } else {
                nextDueDate = new Date(now);
                switch (plan.periodUnit) {
                  case 'hafta':
                    nextDueDate.setDate(nextDueDate.getDate() + (plan.periodValue * 7));
                    break;
                  case 'ay':
                    nextDueDate.setMonth(nextDueDate.getMonth() + plan.periodValue);
                    break;
                  case 'yil':
                    nextDueDate.setFullYear(nextDueDate.getFullYear() + plan.periodValue);
                    break;
                }
              }

              const maintenanceLogRef = doc(collection(db, 'maintenanceLogs'));
              batch.set(maintenanceLogRef, {
                deviceId,
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

        // Create periodic part change logs for each part change (both selected periodic parts and matching parts)
        const periodicPartChangeIds = new Set<string>();

        // Add selected periodic parts
        selectedPeriodicParts.forEach(id => periodicPartChangeIds.add(id));

        // Also check if any part change matches a periodic part (even if not explicitly selected)
        for (const partChange of partChanges) {
          if (partChange.periodicPartChangeId) {
            periodicPartChangeIds.add(partChange.periodicPartChangeId);
          } else {
            // Check if this part matches any periodic part change by stokKodu
            const matchingPeriodic = periodicPartChanges.find(p => p.stokKodu === partChange.stokKodu);
            if (matchingPeriodic) {
              periodicPartChangeIds.add(matchingPeriodic.id);
            }
          }
        }

        // Create logs for all identified periodic part changes
        for (const periodicId of periodicPartChangeIds) {
          const periodic = periodicPartChanges.find(p => p.id === periodicId);
          if (periodic) {
            const periodicDays = periodic.periodDays && periodic.periodDays > 0 ? periodic.periodDays : null;
            const latestPeriodicLog = periodicPartChangeLogs.find(l => l.periodicPartChangeId === periodic.id);
            const lastCompletedAt = latestPeriodicLog?.completedAt
              ? (latestPeriodicLog.completedAt instanceof Date ? latestPeriodicLog.completedAt : latestPeriodicLog.completedAt.toDate())
              : (periodic.nextDueDate?.toDate ? periodic.nextDueDate.toDate() : (periodic.nextDueDate ? new Date(periodic.nextDueDate) : now));

            const effectivePeriodDays = periodicDays ?? Math.max(
              1,
              Math.round((periodic.periodUnit === 'hafta' ? periodic.periodValue * 7 : periodic.periodUnit === 'ay' ? periodic.periodValue * 30 : periodic.periodUnit === 'yil' ? periodic.periodValue * 365 : periodic.periodValue))
            );

            const actualDays = Math.max(
              1,
              Math.round((now.getTime() - lastCompletedAt.getTime()) / (1000 * 60 * 60 * 24))
            );
            const nextPeriodDays = actualDays < effectivePeriodDays ? actualDays : effectivePeriodDays;

            const nextDueDate = new Date(now);
            nextDueDate.setDate(nextDueDate.getDate() + nextPeriodDays);

            // Find the matching part change in actions
            const matchingPartChange = partChanges.find(p =>
              p.periodicPartChangeId === periodicId || p.stokKodu === periodic.stokKodu
            );

            const periodicLogRef = doc(collection(db, 'periodicPartChangeLogs'));
            batch.set(periodicLogRef, {
              deviceId,
              periodicPartChangeId: periodic.id,
              stokKodu: periodic.stokKodu,
              stokAdi: periodic.stokAdi,
              completedAt: Timestamp.fromDate(now),
              completedByUid: currentUserProfile?.uid || '',
              completedByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
              nextDueDate: Timestamp.fromDate(nextDueDate),
              formId: formRef.id,
              formType: 'aplikasyon',
              installedPartSerialNumber: matchingPartChange?.serialNumber || null,
              installedPartFromStock: !!matchingPartChange?.personalStockId,
              removedPartSerialNumber: matchingPartChange?.removedPartSerialNumber || null,
              removedPartImageUrl: matchingPartChange?.removedPartImageUrl || null,
              periodDaysUsed: nextPeriodDays,
            });

            await updateDoc(doc(db, 'periodicPartChanges', periodic.id), {
              periodDays: nextPeriodDays,
            });
          }
        }

        await batch.commit();

        // Delete draft if exists
        if (currentDraftId) {
          try {
            await deleteDoc(doc(db, 'draftActionForms', currentDraftId));
          } catch (e) {
            console.error('Error deleting draft:', e);
          }
          setCurrentDraftId(null);
        }

        toast({title: 'Başarılı', description: `İşlem formu #${formRef.id.substring(0,6)}... kaydedildi.`});
        setActions([]);
        setAciklama('');
        setBaslangicSaati('');
        setBitisSaati('');
        setIslemTuru('');
        setSelectedMaintenanceTasks([]);
        setSelectedPeriodicParts([]);
        setSelectedFaultId('');
        setSelectedTests([]);

        // Refresh personal stock
        const q = query(
          collection(db, 'personalStock'),
          where('ownerUid', '==', currentUserProfile?.uid),
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
    } catch(err) {
        console.error("Error saving action form:", err);
        toast({ title: 'Hata', description: 'Form kaydedilemedi.', variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
  };


  const getActionLabel = (item: ActionItem): string => {
    if (item.type === 'part_change') {
      return item.stokAdi || item.action;
    }
    return OPERATION_LABELS[item.action as OperationType] || item.action;
  };

  const updateActionQuantity = (id: string, quantity: number) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, quantity } : a));
  };

  if (loading) {
    return (
      <div className="cihaz-shell flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
          <p className="text-sm text-[var(--dashboard-muted)]">Yükleniyor...</p>
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

  return (
    <>
      <div className="cihaz-shell px-4 py-6 sm:px-6 sm:py-8 space-y-6">
        <BackButton fallback={`/aplikasyon-paneli/${device.hospitalId}`} />

        {/* Header */}
        <header className="cihaz-card-strong px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {device.imageUrl && (
                <div className="w-28 h-28 flex-shrink-0 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-2">
                  <Image src={resolveImageSrc(device.imageUrl)} alt={device.cihazAdi || ''} width={128} height={128} className="object-contain w-full h-full" />
                </div>
              )}
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-[var(--dashboard-text)]">
                  Aplikasyon İşlem Formu
                </h1>
                <p className="text-base font-medium text-[var(--dashboard-accent)]">{device.cihazAdi}</p>
                <p className="text-xs text-[var(--dashboard-muted)] font-mono mt-1">Seri No: {device.seriNumarasi}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-[var(--dashboard-muted)]">
                  <span><strong className="text-[var(--dashboard-text)]">Lab:</strong> {hospital?.name || '-'}</span>
                  <span><strong className="text-[var(--dashboard-text)]">İşlemi Yapan:</strong> {currentUserProfile?.name || '-'}</span>
                  <span><strong className="text-[var(--dashboard-text)]">Tarih:</strong> {format(new Date(), 'dd.MM.yyyy HH:mm', { locale: tr })}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => router.push(`/aplikasyon-paneli/gecmis/${deviceId}`)}
              className="cihaz-tool-item flex items-center gap-2 px-3 py-2 text-sm font-medium self-start"
            >
              <History className="h-4 w-4" />
              <span>Geçmiş</span>
            </button>
          </div>
        </header>

        {/* Form Body */}
        <div className="cihaz-card-strong px-5 py-5 sm:px-7 sm:py-6 space-y-6">
            {/* İşlem Türü Seçici */}
            <div className="p-4 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-[var(--dashboard-text)]">
                  <Cog className="h-4 w-4 text-[var(--dashboard-accent)]" />
                  İşlem Türü
                </Label>
                <Select value={islemTuru} onValueChange={(v) => {
                  setIslemTuru(v as IslemTuru);
                  if (v !== 'ariza') setSelectedFaultId('');
                }}>
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue placeholder="İşlem türü seçin (opsiyonel)..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rutin_kurum_ziyareti">Rutin Kurum Ziyareti</SelectItem>
                    <SelectItem value="periyodik_bakim">Periyodik Bakım</SelectItem>
                    <SelectItem value="ariza">Arıza</SelectItem>
                    <SelectItem value="alis">ALIS</SelectItem>
                    <SelectItem value="roche_bilgisayar_arizasi">Roche Bilgisayar Arızası</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--dashboard-muted)]">
                  İşlem türünü belirtmek opsiyoneldir.
                </p>
              </div>
            </div>

            {/* Arıza Seçimi - only when ariza selected */}
            {islemTuru === 'ariza' && (
              <div className="p-4 rounded-2xl bg-red-50/80 border border-red-200/60 space-y-4">
                <div>
                  <Label className="flex items-center gap-2 mb-4 text-[var(--dashboard-text)]">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    Arıza Türü <span className="text-red-500">*</span>
                  </Label>
                  <Select value={selectedFaultId} onValueChange={(v) => { setSelectedFaultId(v); if (v !== 'diger') setCustomFaultName(''); }}>
                    <SelectTrigger>
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
                    <div className="mt-2">
                      <Input
                        placeholder="Arıza açıklamasını girin... (zorunlu)"
                        value={customFaultName}
                        onChange={(e) => setCustomFaultName(e.target.value)}
                        className="border-red-300"
                      />
                    </div>
                  )}
                </div>

                {/* İlişkili Test Seçimi */}
                <div className="pt-3 border-t border-red-200/60">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm text-[var(--dashboard-text)]">İlişkili Testler (Opsiyonel)</Label>
                    <button
                      type="button"
                      onClick={() => setIsTestModalOpen(true)}
                      disabled={availableTests.length === 0}
                      className="cihaz-tool-item flex items-center gap-1 px-3 py-1.5 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Test Seç
                    </button>
                  </div>
                  {availableTests.length === 0 ? (
                    <p className="text-xs text-[var(--dashboard-muted)]">
                      Bu laboratuvara tanımlı test bulunamadı.
                    </p>
                  ) : selectedTests.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedTests.map(test => (
                        <span
                          key={test}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-red-100/80 text-red-800 text-xs rounded-full"
                        >
                          {test}
                          <button
                            type="button"
                            onClick={() => setSelectedTests(prev => prev.filter(t => t !== test))}
                            className="hover:text-red-600"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--dashboard-muted)]">
                      Arızayla ilişkili test seçilmedi.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Periyodik Bakım İş Listesi - only when periyodik_bakim selected */}
            {islemTuru === 'periyodik_bakim' && (
              <div className="p-4 border rounded-lg bg-muted/30">
                <Label className="flex items-center gap-2 mb-4">
                  <ClipboardList className="h-4 w-4" />
                  Periyodik Bakım İş Listesi
                </Label>
                {maintenanceTasksWithStatus.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Bu cihaz için tanımlı aplikasyon periyodik bakım planı bulunmuyor.
                    Cihaz tanımlama panelinden bakım planı ekleyebilirsiniz.
                  </p>
                ) : (
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>İş Adı</TableHead>
                          <TableHead className="w-24 text-center">Periyot</TableHead>
                          <TableHead className="w-32 text-center">Kalan Gün</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {maintenanceTasksWithStatus.map(({ plan, daysRemaining, isOverdue, periodLabel }) => (
                          <TableRow key={plan.id} className="cursor-pointer hover:bg-muted/50" onClick={() => toggleMaintenanceTask(plan.id)}>
                            <TableCell>
                              <Checkbox
                                checked={selectedMaintenanceTasks.includes(plan.id)}
                                onCheckedChange={() => toggleMaintenanceTask(plan.id)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{plan.taskName}</TableCell>
                            <TableCell className="text-center text-sm text-muted-foreground">{periodLabel}</TableCell>
                            <TableCell className="text-center">
                              {daysRemaining === null ? (
                                <span className="text-xs text-muted-foreground italic">Henüz yapılmadı</span>
                              ) : isOverdue ? (
                                <span className="text-xs font-medium text-red-600 dark:text-red-400">
                                  {Math.abs(daysRemaining)} gün gecikmiş
                                </span>
                              ) : (
                                <span className={`text-xs font-medium ${daysRemaining <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                                  {daysRemaining} gün
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {selectedMaintenanceTasks.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {selectedMaintenanceTasks.length} bakım işi seçildi
                  </p>
                )}
              </div>
            )}

            {/* Periyodik Parça Değişimi Listesi - only when periyodik_bakim selected */}
            {islemTuru === 'periyodik_bakim' && periodicPartChangesWithStatus.length > 0 && (
              <div className="p-4 border rounded-lg bg-muted/30">
                <Label className="flex items-center gap-2 mb-4">
                  <Package className="h-4 w-4" />
                  Periyodik Parça Değişimleri
                </Label>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Ürün</TableHead>
                        <TableHead className="w-24 text-center">Periyot</TableHead>
                        <TableHead className="w-36 text-center">Kalan Gün</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {periodicPartChangesWithStatus.map(({ partChange, daysRemaining, isOverdue, periodLabel }) => (
                        <TableRow
                          key={partChange.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => togglePeriodicPart(partChange.id)}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedPeriodicParts.includes(partChange.id)}
                              onCheckedChange={() => togglePeriodicPart(partChange.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{partChange.stokAdi}</p>
                              <p className="text-xs text-muted-foreground font-mono">{partChange.stokKodu}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-center text-sm text-muted-foreground">{periodLabel}</TableCell>
                          <TableCell className="text-center">
                            {daysRemaining === null ? (
                              <span className="text-xs text-muted-foreground italic">Henüz değişilmedi</span>
                            ) : isOverdue ? (
                              <span className="text-xs font-medium text-red-600 dark:text-red-400 flex items-center justify-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {Math.abs(daysRemaining)} gün gecikmiş
                              </span>
                            ) : (
                              <span className={`text-xs font-medium ${daysRemaining <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                                {daysRemaining} gün kaldı
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {selectedPeriodicParts.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {selectedPeriodicParts.length} periyodik parça değişimi seçildi (otomatik olarak değişen parçalar listesine eklendi)
                  </p>
                )}
              </div>
            )}

            {/* Başlangıç ve Bitiş Tarihleri/Saatleri (Zorunlu) */}
            <div className="p-4 border rounded-lg bg-blue-50/50 dark:bg-blue-950/20">
              <Label className="flex items-center gap-2 mb-4">
                <Clock className="h-4 w-4" />
                İşlem Tarihi ve Saatleri <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="baslangicTarihi" className="text-sm">Başlangıç Tarihi <span className="text-destructive">*</span></Label>
                  <Input
                    id="baslangicTarihi"
                    type="date"
                    value={baslangicTarihi}
                    onChange={(e) => setBaslangicTarihi(e.target.value)}
                    className={!baslangicTarihi ? 'border-amber-500/50' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="baslangicSaati" className="text-sm">Başlangıç Saati <span className="text-destructive">*</span></Label>
                  <Input
                    id="baslangicSaati"
                    type="time"
                    value={baslangicSaati}
                    onChange={(e) => setBaslangicSaati(e.target.value)}
                    className={!baslangicSaati ? 'border-amber-500/50' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bitisTarihi" className="text-sm">Bitiş Tarihi <span className="text-destructive">*</span></Label>
                  <Input
                    id="bitisTarihi"
                    type="date"
                    value={bitisTarihi}
                    onChange={(e) => setBitisTarihi(e.target.value)}
                    className={!bitisTarihi ? 'border-amber-500/50' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bitisSaati" className="text-sm">Bitiş Saati <span className="text-destructive">*</span></Label>
                  <Input
                    id="bitisSaati"
                    type="time"
                    value={bitisSaati}
                    onChange={(e) => setBitisSaati(e.target.value)}
                    className={!bitisSaati ? 'border-amber-500/50' : ''}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                İşleme başladığınız ve bitirdiğiniz tarih ve saatleri giriniz. Bu alanlar zorunludur.
              </p>
            </div>

            {/* Açıklama Alanı (Zorunlu) */}
            <div className="p-4 border rounded-lg bg-muted/30">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Açıklama <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  placeholder="Yapılan işlem hakkında açıklama yazın... (zorunlu)"
                  value={aciklama}
                  onChange={(e) => setAciklama(e.target.value)}
                  rows={3}
                  className={!aciklama.trim() ? 'border-amber-500/50' : ''}
                />
                <p className="text-xs text-muted-foreground">
                  Bu alan zorunludur. Yapılan işlemi detaylı şekilde açıklayınız.
                </p>
              </div>
            </div>

            {/* Butonlar */}
            <div className="flex flex-wrap gap-2">
              <Button onClick={openPartModal} variant="outline">
                <Wrench className="mr-2 h-4 w-4" /> Değişen Parça Ekle
              </Button>
              <Button onClick={openOperationModal} variant="outline">
                <ClipboardList className="mr-2 h-4 w-4" /> Yapılan İşlemi Seç
              </Button>
            </div>
            <ScrollArea className="h-72 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Tür</TableHead>
                    <TableHead>İşlem/Parça</TableHead>
                    <TableHead className="w-28">Kod</TableHead>
                    <TableHead className="w-28">Seri No</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actions.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">Henüz işlem eklenmedi. Yukarıdaki butonları kullanarak parça değişimi veya işlem ekleyin.</TableCell></TableRow>
                  ) : (
                    actions.map(item => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className={`text-xs font-medium px-2 py-1 rounded ${item.type === 'part_change' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}`}>
                            {item.type === 'part_change' ? 'Parça' : 'İşlem'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div>
                            <span className="font-medium">{getActionLabel(item)}</span>
                            {item.isManualEntry && <span className="ml-2 text-xs text-muted-foreground">(Manuel)</span>}
                            {item.type === 'part_change' && item.removedPartSerialNumber && (
                              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                Çıkan: {item.removedPartStokAdi || item.stokAdi} ({item.removedPartSerialNumber})
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.type === 'part_change' ? (
                            <span className="font-mono text-xs">{item.stokKodu || '-'}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.type === 'part_change' ? (
                            <span className="font-mono text-xs">{item.serialNumber || '-'}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeActionRow(item.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>

            {/* Save Buttons */}
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={handleSaveDraft} disabled={isSavingDraft || isSaving}>
                {isSavingDraft ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PauseCircle className="h-4 w-4 mr-2" />}
                Ara Kayıt
              </Button>
              <Button onClick={startSaveProcess} disabled={isSaving || actions.length === 0}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Kaydet
              </Button>
            </div>
        </div>
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
            {/* Section 1: Select part from personal stock */}
            <div className="p-4 border border-border rounded-lg bg-background space-y-3">
              <Label className="font-semibold text-sm">1. Şahsi Stokunuzdan Parça Seçin</Label>
              {!showManualEntry ? (
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
                        {personalStock.length === 0
                          ? 'Şahsi stokunuzda yedek parça bulunmuyor.'
                          : 'Sonuç bulunamadı.'}
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredStock.map(item => (
                          <button
                            key={item.id}
                            onClick={() => setSelectedStockItem(item)}
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
                    onClick={() => setShowManualEntry(true)}
                    className="w-full text-xs"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Stokta yok, manuel ekle
                  </Button>
                </>
              ) : (
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
              )}
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
            {(selectedStockItem || (showManualEntry && manualPartCode && manualSerialNumber)) && (
              <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-sm">
                <p className="font-medium text-green-800 dark:text-green-200">
                  Takılacak: {selectedStockItem?.stokAdi || manualPartName} ({selectedStockItem?.serialNumber || manualSerialNumber})
                </p>
                <p className="text-green-700 dark:text-green-300">
                  Çıkacak: {removedPartStokAdi || selectedStockItem?.stokAdi || manualPartName} ({removedPartSerialNumber || 'Seri No Yok'})
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
                (!selectedStockItem && !(showManualEntry && manualPartCode && manualPartName && (!pendingPeriodicPartChangeId || periodicPartChanges.find(p => p.id === pendingPeriodicPartChangeId)?.requiresSerialTracking !== false ? manualSerialNumber : true)))
                || isUploadingImage
              }
            >
              {isUploadingImage ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Yükleniyor...</> : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Signature Modal */}
      <Dialog open={isSignatureModalOpen} onOpenChange={setIsSignatureModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {signatureStep === 'pre_questions' ? 'Cihaz Durumu ve Eşlik Eden Personel' : 'İmza'}
            </DialogTitle>
          </DialogHeader>

          {/* Pre-questions step */}
          {signatureStep === 'pre_questions' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Cihaz Durumu <span className="text-destructive">*</span></Label>
                <RadioGroup
                  value={cihazDurumu}
                  onValueChange={(val) => setCihazDurumu(val as CihazDurumu)}
                  className="grid grid-cols-2 gap-2"
                >
                  {(Object.keys(CIHAZ_DURUMU_LABELS) as CihazDurumu[])
                    .filter(k => k !== '')
                    .map(key => (
                      <div key={key} className="flex items-center space-x-2">
                        <RadioGroupItem value={key} id={`durumu-${key}`} />
                        <Label htmlFor={`durumu-${key}`} className="cursor-pointer">
                          {CIHAZ_DURUMU_LABELS[key]}
                        </Label>
                      </div>
                    ))}
                </RadioGroup>
                {cihazDurumu === 'diger' && (
                  <Input
                    placeholder="Diğer durumu açıklayın..."
                    value={cihazDurumuAciklama}
                    onChange={(e) => setCihazDurumuAciklama(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Eşlik Eden Personel (Opsiyonel)</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Personel ara..."
                    value={personelSearchQuery}
                    onChange={(e) => setPersonelSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <ScrollArea className="h-32 border rounded-md">
                  <div className="p-2 space-y-1">
                    {filteredUsers
                      .filter(u => u.uid !== currentUserProfile?.uid)
                      .map(user => (
                        <button
                          key={user.uid}
                          onClick={() => toggleEslikEdenPersonel(user)}
                          className={`w-full text-left p-2 rounded-md transition-colors flex justify-between items-center ${
                            eslikEdenPersonel.find(p => p.uid === user.uid)
                              ? 'bg-primary/10 border-primary border'
                              : 'hover:bg-muted'
                          }`}
                        >
                          <div>
                            <p className="font-medium">{user.name || user.email}</p>
                            <p className="text-xs text-muted-foreground">
                              {user.role === 'aplikasyon' ? 'Aplikasyon' : 'Teknik Servis'}
                            </p>
                          </div>
                          {eslikEdenPersonel.find(p => p.uid === user.uid) && (
                            <span className="text-primary text-sm">Seçildi</span>
                          )}
                        </button>
                      ))}
                  </div>
                </ScrollArea>
                {eslikEdenPersonel.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {eslikEdenPersonel.map(p => (
                      <span key={p.uid} className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <DialogFooter className="mt-4 gap-2">
                <Button variant="outline" onClick={() => setIsSignatureModalOpen(false)}>İptal</Button>
                <Button onClick={proceedToSignature}>Devam Et</Button>
              </DialogFooter>
            </div>
          )}

          {/* Personnel signature step */}
          {signatureStep === 'personnel' && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">İşlemi Yapan Personel</p>
              <SignaturePad ref={personnelSignatureRef} />
              <DialogFooter className="mt-4 gap-2">
                <Button variant="outline" onClick={() => { personnelSignatureRef.current?.clear(); }}>Temizle</Button>
                <Button variant="secondary" onClick={() => setSignatureStep('pre_questions')}>Geri</Button>
                <Button onClick={() => handleSaveSignaturesAndFinish({})}>Atla</Button>
                <Button onClick={() => {
                  const sig = personnelSignatureRef.current?.getSignature();
                  if (sig) {
                    setSignatures({ personnel: sig });
                    setSignatureStep('technician');
                  } else {
                    setSignatureStep('technician');
                  }
                }}>
                  Devam Et
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Technician signature step */}
          {signatureStep === 'technician' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Teknisyen Adı Soyadı</label>
                <Input
                  value={technicianName}
                  onChange={(e) => setTechnicianName(e.target.value)}
                  placeholder="Ad Soyad giriniz..."
                  className="mb-4"
                />
              </div>
              <div>
                <p className="mb-2 text-sm text-muted-foreground">İmza</p>
                <SignaturePad ref={technicianSignatureRef} />
              </div>
              <DialogFooter className="mt-4 gap-2">
                <Button variant="outline" onClick={() => { technicianSignatureRef.current?.clear(); }}>Temizle</Button>
                <Button onClick={() => handleSaveSignaturesAndFinish(signatures, technicianName)}>Bu Adımı Atla</Button>
                <Button variant="secondary" onClick={() => setSignatureStep('personnel')}>Geri</Button>
                <Button onClick={() => {
                  const techSig = technicianSignatureRef.current?.getSignature();
                  handleSaveSignaturesAndFinish({ ...signatures, technician: techSig }, technicianName);
                }}>
                  Tamamla ve Kaydet
                </Button>
              </DialogFooter>
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
