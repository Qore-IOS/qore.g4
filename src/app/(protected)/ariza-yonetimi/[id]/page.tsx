

'use client';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, orderBy, onSnapshot, updateDoc, serverTimestamp, getDocs, where, addDoc, Timestamp, writeBatch, arrayUnion } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle, ArrowLeft, Clock, FileDown, Share2, Edit3, Loader2, MoreVertical, Sun, Moon, Recycle, CornerDownRight, UserPlus, Phone, MapPin, Wrench, Navigation, X, Search, Plus, Camera, ImageIcon, Package, Trash2, Sparkles, Lock, ArrowRightLeft } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format, differenceInMinutes, formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { resolveImageSrc } from '@/lib/image-utils';
import { useToast } from '@/hooks/use-toast';
import { closeDeviceFaultReport, resolveEjectedKitFault, assignFaultToSelf, startIntervention, transferFaultToOtherUnit, verifyLocationForIntervention } from '@/lib/faults';
import { emitExternalStockUsage } from '@/lib/notifications';
import { useAuth } from '@/contexts/auth-context';
import type { Device, DeviceFaultReport, DeviceFaultStatus, InterventionType, ProductCode, User, PersonalStockItem, PoolWarehouseStockItem, Depot, DeviceLabPool, YedekParcaDepoStokItem } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from 'next-themes';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { buildDepotSelectableItems, type DepotSelectableStockItem } from '@/lib/spare-part-depot';

type FaultPartChange = {
  id: string;
  stokKodu?: string;
  stokAdi?: string;
  serialNumber?: string;
  personalStockId?: string;
  depotStockId?: string;
  isDepotSelection?: boolean;
  quantity?: number;
  isManualEntry?: boolean;
  removedPartStokKodu?: string;
  removedPartStokAdi?: string;
  removedPartSerialNumber?: string;
  removedPartImageUrl?: string;
  usedPartImageUrl?: string;
  addedAt: Date;
  addedByUid: string;
  addedByName: string;
};

type FaultHucreDegisimi = {
  id: string;
  stokKodu: string;
  stokAdi: string;
  personalStockId: string;
  depotStockId?: string;
  isDepotSelection?: boolean;
  hucreNumarasi: string;        // Takılan hücre
  removedHucreNumarasi?: string; // Çıkan hücre
  description?: string;
  addedAt: Date;
  addedByUid: string;
  addedByName: string;
};

// Status config - liste sayfasıyla tutarlı
const STATUS_CONFIG: Record<DeviceFaultStatus, { label: string; variant: 'destructive' | 'default' | 'secondary' | 'outline'; icon: React.ReactNode; className?: string }> = {
  'atama_bekliyor': {
    label: 'Atama Bekliyor',
    variant: 'destructive',
    icon: <UserPlus className="h-3 w-3" />,
    className: 'bg-red-600/15 text-red-700 dark:text-red-400 border-red-600/20',
  },
  'mudahale_bekliyor': {
    label: 'Müdahale Bekliyor',
    variant: 'default',
    icon: <Clock className="h-3 w-3" />,
    className: 'bg-amber-600/15 text-amber-700 dark:text-amber-400 border-amber-600/20',
  },
  'mudahale_ediliyor': {
    label: 'Müdahale Ediliyor',
    variant: 'default',
    icon: <Wrench className="h-3 w-3" />,
    className: 'bg-blue-600/15 text-blue-700 dark:text-blue-400 border-blue-600/20',
  },
  'cozuldu': {
    label: 'Çözüldü',
    variant: 'secondary',
    icon: <CheckCircle className="h-3 w-3" />,
    className: 'bg-green-600/10 text-green-700 dark:text-green-400 border border-green-600/20',
  },
  'open': {
    label: 'Açık',
    variant: 'destructive',
    icon: <AlertTriangle className="h-3 w-3" />,
    className: '',
  },
  'closed': {
    label: 'Giderildi',
    variant: 'secondary',
    icon: <CheckCircle className="h-3 w-3" />,
    className: 'bg-green-600/10 text-green-700 dark:text-green-400 border border-green-600/20',
  },
};

function normalizeStatus(status: string): DeviceFaultStatus {
  if (status === 'open') return 'atama_bekliyor';
  if (status === 'closed') return 'cozuldu';
  return status as DeviceFaultStatus;
}


type FaultDoc = DeviceFaultReport;

type StockSourceTab = 'personal' | 'pool' | 'depot';


type AiSuggestion = {
  summary?: string;
  probableCauses?: string[];
  suggestedActions?: string[];
  chronicInsight?: string;
  resolutionAssessment?: string;
  evidenceBasedRecommendation?: string;
  confidence?: number;
  debug?: string;
  similarFaultStats?: {
    total: number;
    sameModelCount: number;
    sameTitleCategoryCount: number;
    resolvedCount: number;
  };
  resolutionStats?: {
    kalici: number;
    gecici: number;
    belirsiz: number;
  };
};

type HistoryEvent = {
  id: string;
  type: 'opened' | 'note' | 'status_change' | 'closed';
  actorUid?: string;
  actorName?: string;
  description?: string;
  timestamp?: Date | null;
};

export default function FaultDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, isAdmin } = useAuth();
  const { theme, setTheme } = useTheme();

  const [fault, setFault] = useState<FaultDoc | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [closeDescription, setCloseDescription] = useState('');

  const [isEditHistoryModalOpen, setIsEditHistoryModalOpen] = useState(false);
  const [editingHistoryItem, setEditingHistoryItem] = useState<HistoryEvent | null>(null);
  const [editingDescription, setEditingDescription] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Çözülmüş arıza düzenleme state'leri
  const [isEditResolvedOpen, setIsEditResolvedOpen] = useState(false);
  const [editCloseDescription, setEditCloseDescription] = useState('');
  const [editSupportPersonnelUids, setEditSupportPersonnelUids] = useState<string[]>([]);
  const [editPersonnelSearchQuery, setEditPersonnelSearchQuery] = useState('');
  const [isSavingResolved, setIsSavingResolved] = useState(false);

  // Yeni atama sistemi state'leri
  const [isAssigning, setIsAssigning] = useState(false);
  const [isTransferringUnit, setIsTransferringUnit] = useState(false);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [isStartingIntervention, setIsStartingIntervention] = useState(false);
  const [isVerifyingLocation, setIsVerifyingLocation] = useState(false);
  const [locationVerified, setLocationVerified] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Test seçimi state'leri
  const [availableTests, setAvailableTests] = useState<string[]>([]);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);
  const [pendingInterventionType, setPendingInterventionType] = useState<InterventionType | null>(null);

  // Kit arızası için ürüne bağlı test bilgisi
  const [productTestInfo, setProductTestInfo] = useState<string | null>(null);
  const [isProductTestDialogOpen, setIsProductTestDialogOpen] = useState(false);

  // Destek personeli seçimi (arıza kapatılırken)
  const [allPersonnel, setAllPersonnel] = useState<User[]>([]);
  const [selectedSupportPersonnelUids, setSelectedSupportPersonnelUids] = useState<string[]>([]);
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState('');

  // Yedek parça değişim state'leri
  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [personalStock, setPersonalStock] = useState<PersonalStockItem[]>([]);
  const [poolStockItems, setPoolStockItems] = useState<PoolWarehouseStockItem[]>([]);
  const [depotStockItems, setDepotStockItems] = useState<YedekParcaDepoStokItem[]>([]);
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const [selectedStockItem, setSelectedStockItem] = useState<PersonalStockItem | null>(null);
  const [stockSourceTab, setStockSourceTab] = useState<StockSourceTab>('personal');
  const [selectedPoolStockItem, setSelectedPoolStockItem] = useState<PoolWarehouseStockItem | null>(null);
  const [selectedDepotStockItem, setSelectedDepotStockItem] = useState<DepotSelectableStockItem | null>(null);
  const [pendingDepotStockItem, setPendingDepotStockItem] = useState<DepotSelectableStockItem | null>(null);
  const [depotRequestedQuantity, setDepotRequestedQuantity] = useState(1);
  const [isDepotQuantityDialogOpen, setIsDepotQuantityDialogOpen] = useState(false);
  const [manualPartCode, setManualPartCode] = useState('');
  const [manualPartName, setManualPartName] = useState('');
  const [manualSerialNumber, setManualSerialNumber] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [removedPartStokKodu, setRemovedPartStokKodu] = useState('');
  const [removedPartStokAdi, setRemovedPartStokAdi] = useState('');
  const [removedPartSerialNumber, setRemovedPartSerialNumber] = useState('');
  const [removedPartImageFile, setRemovedPartImageFile] = useState<File | null>(null);
  const [removedPartImagePreview, setRemovedPartImagePreview] = useState<string | null>(null);
  const [usedPartImageFile, setUsedPartImageFile] = useState<File | null>(null);
  const [usedPartImagePreview, setUsedPartImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const removedPartImageInputRef = useRef<HTMLInputElement>(null);
  const usedPartImageInputRef = useRef<HTMLInputElement>(null);
  const [faultPartChanges, setFaultPartChanges] = useState<FaultPartChange[]>([]);

  // Hücre değişimi state
  const [faultHucreDegisimleri, setFaultHucreDegisimleri] = useState<FaultHucreDegisimi[]>([]);
  const [isHucreDegisimiModalOpen, setIsHucreDegisimiModalOpen] = useState(false);
  const [hucreDegisimiSelectedItem, setHucreDegisimiSelectedItem] = useState<PersonalStockItem | null>(null);
  const [hucreDegisimiSelectedDepotItem, setHucreDegisimiSelectedDepotItem] = useState<DepotSelectableStockItem | null>(null);
  const [hucreStockSourceTab, setHucreStockSourceTab] = useState<'personal' | 'depot'>('personal');
  const [hucreDegisimiRemovedHucre, setHucreDegisimiRemovedHucre] = useState('');
  const [hucreDegisimiDescription, setHucreDegisimiDescription] = useState('');
  const [hucreDegisimiSearchQuery, setHucreDegisimiSearchQuery] = useState('');
  const [isSavingHucre, setIsSavingHucre] = useState(false);
  const [isSavingPart, setIsSavingPart] = useState(false);

  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);


  useEffect(() => {
    if (!params?.id) return;
    const ref = doc(db, 'deviceFaultReports', params.id);
    const unsubFault = onSnapshot(ref, async (snap) => {
      if (!snap.exists()) {
        toast({ title: 'Kayıt Bulunamadı', description: `Arıza #${params.id} bulunamadı.`, variant: 'destructive' });
        router.back();
        return;
      }
      const d = snap.data() as any;
      const faultData = {
        id: snap.id,
        ...d,
        openedAt: d.openedAt?.toDate ? d.openedAt.toDate() : null,
        closedAt: d.closedAt?.toDate ? d.closedAt.toDate() : null,
      };
      setFault(faultData);

      if (faultData.deviceId) {
        const deviceRef = doc(db, 'devices', faultData.deviceId);
        const deviceSnap = await getDoc(deviceRef);
        if (deviceSnap.exists()) {
          setDevice({ id: deviceSnap.id, ...(deviceSnap.data() as any) });
        }
      }
      setLoading(false);
    });

    const q = query(collection(db, 'deviceFaultReports', params.id, 'history'), orderBy('timestamp', 'asc'));
    const unsubHistory = onSnapshot(q, (ss) => {
      const list = ss.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          ...x,
          timestamp: x.timestamp?.toDate ? x.timestamp.toDate() : null,
        } as HistoryEvent;
      });
      setHistory(list);
    });
    return () => {
      unsubFault();
      unsubHistory();
    };
  }, [params?.id, router, toast]);

  // Laboratuvara ait test listesini çek
  useEffect(() => {
    const fetchTests = async () => {
      if (!fault?.hospitalId) return;

      try {
        // Laboratuvara tanımlı minMaxRules'dan ürünlerin testAdi'lerini al
        const minMaxSnap = await getDocs(collection(db, 'hospitals', fault.hospitalId, 'minMaxRules'));
        const stokKodulari = minMaxSnap.docs.map(d => d.id);

        if (stokKodulari.length === 0) {
          setAvailableTests([]);
          return;
        }

        // ProductCodes'dan testAdi'leri al
        const productCodesSnap = await getDocs(collection(db, 'productCodes'));
        const testNames = new Set<string>();

        productCodesSnap.docs.forEach(d => {
          const data = d.data();
          if (stokKodulari.includes(data.stokKodu) && data.testAdi) {
            testNames.add(data.testAdi);
          }
        });

        setAvailableTests(Array.from(testNames).sort());
      } catch (e) {
        console.error('Test listesi alınamadı:', e);
      }
    };

    fetchTests();
  }, [fault?.hospitalId]);

  // Kit arızası için ürünün testAdi bilgisini çek
  useEffect(() => {
    const fetchProductTestInfo = async () => {
      if (!fault?.isEjectedKitFault || !fault?.productStokKodu) {
        setProductTestInfo(null);
        return;
      }

      try {
        // ProductCodes'dan stokKodu ile eşleşen ürünü bul
        const productCodesSnap = await getDocs(
          query(collection(db, 'productCodes'), where('stokKodu', '==', fault.productStokKodu))
        );

        if (!productCodesSnap.empty) {
          const productData = productCodesSnap.docs[0].data();
          if (productData.testAdi) {
            setProductTestInfo(productData.testAdi);
          } else {
            setProductTestInfo(null);
          }
        } else {
          setProductTestInfo(null);
        }
      } catch (e) {
        console.error('Ürün test bilgisi alınamadı:', e);
        setProductTestInfo(null);
      }
    };

    fetchProductTestInfo();
  }, [fault?.isEjectedKitFault, fault?.productStokKodu]);

  // Fetch personnel for support personnel selector
  useEffect(() => {
    (async () => {
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as User));
        // Filter to teknik_servis and aplikasyon roles
        const personnel = users.filter(u => u.role === 'teknik_servis' || u.role === 'aplikasyon');
        setAllPersonnel(personnel);
      } catch (e) {
        console.error('Personel listesi alınamadı:', e);
      }
    })();
  }, []);

  // Şahsi stok verilerini çek
  useEffect(() => {
    if (!currentUser) return;
    const fetchPersonalStock = async () => {
      try {
        const stockSnap = await getDocs(
          query(
            collection(db, 'personalStock'),
            where('ownerUid', '==', currentUser.uid),
            where('status', '==', 'in_stock')
          )
        );
        setPersonalStock(stockSnap.docs.map(d => ({ id: d.id, ...d.data() } as PersonalStockItem)));
      } catch (e) {
        console.error('Şahsi stok alınamadı:', e);
      }
    };
    fetchPersonalStock();
  }, [currentUser]);

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
        setDepotStockItems(items);
      } catch (err) {
        console.error('Depo stok alınamadı:', err);
      }
    })();
  }, []);

  // Havuz stok verilerini çek
  useEffect(() => {
    if (!fault?.deviceId) return;
    (async () => {
      try {
        const deviceSnap = await getDoc(doc(db, 'devices', fault.deviceId));
        if (!deviceSnap.exists()) return;
        const deviceData = deviceSnap.data();
        const hospitalId = deviceData.hospitalId;
        if (!hospitalId) return;

        const poolsSnap = await getDocs(collection(db, 'deviceLabPools'));
        const matchingPoolIds: string[] = [];
        poolsSnap.docs.forEach(d => {
          const pool = d.data() as DeviceLabPool;
          if (pool.memberIds?.includes(hospitalId)) {
            matchingPoolIds.push(d.id);
          }
        });
        if (matchingPoolIds.length === 0) return;

        const depotsSnap = await getDocs(collection(db, 'depots'));
        const poolWarehouseIds: string[] = [];
        depotsSnap.docs.forEach(d => {
          const depot = d.data() as Depot;
          if (depot.isPoolWarehouse && depot.linkedDeviceLabPoolIds?.some(id => matchingPoolIds.includes(id))) {
            poolWarehouseIds.push(d.id);
          }
        });
        if (poolWarehouseIds.length === 0) return;

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
        setPoolStockItems(allPoolStock);
      } catch (err) {
        console.error("Error fetching pool stock:", err);
      }
    })();
  }, [fault?.deviceId]);

  // Arızaya eklenen parça değişimlerini çek
  useEffect(() => {
    if (!params?.id) return;
    const q = query(collection(db, 'deviceFaultReports', params.id, 'partChanges'), orderBy('addedAt', 'asc'));
    const unsub = onSnapshot(q, (ss) => {
      setFaultPartChanges(ss.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          ...data,
          addedAt: data.addedAt?.toDate ? data.addedAt.toDate() : new Date(),
        } as FaultPartChange;
      }));
    });
    return () => unsub();
  }, [params?.id]);

  // Arızaya eklenen hücre değişimlerini çek
  useEffect(() => {
    if (!params?.id) return;
    const q2 = query(collection(db, 'deviceFaultReports', params.id, 'hucreDegisimleri'), orderBy('addedAt', 'asc'));
    const unsub2 = onSnapshot(q2, (ss) => {
      setFaultHucreDegisimleri(ss.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          ...data,
          addedAt: data.addedAt?.toDate ? data.addedAt.toDate() : new Date(),
        } as FaultHucreDegisimi;
      }));
    });
    return () => unsub2();
  }, [params?.id]);

  // Konum doğrulama durumunu kontrol et
  useEffect(() => {
    if (fault?.locationVerifiedAt) {
      setLocationVerified(true);
    }
  }, [fault?.locationVerifiedAt]);

  // Kilit mekanizması: Arıza bir personele atandıysa, sadece o personel (veya admin) işlem yapabilir
  const isLockedByOther = useMemo(() => {
    if (!fault || !currentUser) return false;
    const normalized = normalizeStatus(fault.status);
    // Sadece müdahale_bekliyor ve müdahale_ediliyor durumlarında kilit aktif
    if (normalized !== 'mudahale_bekliyor' && normalized !== 'mudahale_ediliyor') return false;
    // Atanmış personel yoksa kilit yok
    if (!fault.assignedToUid) return false;
    // Admin her zaman erişebilir
    if (isAdmin) return false;
    // Atanmış kişi mevcut kullanıcıysa kilit yok
    return fault.assignedToUid !== currentUser.uid;
  }, [fault, currentUser, isAdmin]);

  const resolutionTime = useMemo(() => {
    const normalized = normalizeStatus(fault?.status || 'open');
    if (normalized === 'cozuldu' && fault?.toplamCozumSuresi) {
      return Math.round(fault.toplamCozumSuresi / 60000);
    }
    if (normalized === 'cozuldu' && fault?.openedAt && fault?.closedAt) {
      return differenceInMinutes(fault.closedAt, fault.openedAt);
    }
    return null;
  }, [fault]);

  const statusBadge = useMemo(() => {
    if (!fault) return null;
    const normalized = normalizeStatus(fault.status);
    const config = STATUS_CONFIG[normalized];

    return (
      <div className="flex items-center gap-2">
        <Badge variant={config.variant} className={`flex items-center gap-1 ${config.className}`}>
          {config.icon} {config.label}
        </Badge>
        {normalized === 'cozuldu' && resolutionTime !== null && (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {resolutionTime} dk
          </Badge>
        )}
      </div>
    );
  }, [fault, resolutionTime]);

  // Arızayı üzerine al
  const handleAssignToSelf = useCallback(async () => {
    if (!fault || !currentUser) return;
    setIsAssigning(true);
    try {
      await assignFaultToSelf(fault.id, {
        uid: currentUser.uid,
        name: currentUserProfile?.name || 'Bilinmeyen',
      });
      toast({ title: 'Başarılı', description: 'Arıza üzerinize atandı.' });
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Hata', description: e.message || 'Arıza atanamadı.', variant: 'destructive' });
    } finally {
      setIsAssigning(false);
    }
  }, [fault, currentUser, currentUserProfile, toast]);


  const handleTransferToOtherUnit = useCallback(async () => {
    if (!fault || !currentUser) return;

    setIsTransferringUnit(true);
    try {
      await transferFaultToOtherUnit(fault.id, {
        uid: currentUser.uid,
        name: currentUserProfile?.name || 'Bilinmeyen',
      });

      const targetUnitLabel = fault.faultType === 'teknik_servis' ? 'Aplikasyon' : 'Teknik Servis';
      toast({
        title: 'Arıza Aktarıldı',
        description: `Arıza ${targetUnitLabel} birimine aktarıldı.`,
      });
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Hata', description: e.message || 'Arıza diğer birime aktarılamadı.', variant: 'destructive' });
    } finally {
      setIsTransferringUnit(false);
    }
  }, [fault, currentUser, currentUserProfile, toast]);

  // Auto-assign from push notification action button (?action=assign)
  const autoAssignTriggered = useRef(false);
  useEffect(() => {
    if (autoAssignTriggered.current) return;
    const action = searchParams.get('action');
    if (action !== 'assign') return;
    if (!fault || !currentUser || !currentUserProfile || loading) return;
    // Only auto-assign if fault is still waiting for assignment
    const normalized = fault.status === 'open' ? 'atama_bekliyor' : fault.status;
    if (normalized !== 'atama_bekliyor') {
      toast({ title: 'Arıza Zaten Atanmış', description: 'Bu arıza zaten bir personel tarafından üzerine alınmış.', variant: 'destructive' });
      autoAssignTriggered.current = true;
      // Clean up URL
      router.replace(`/ariza-yonetimi/${params.id}`);
      return;
    }
    // Check role match
    const userRole = currentUserProfile.role;
    const faultType = fault.faultType;
    const canAssign = isAdmin || (faultType === 'teknik_servis' && userRole === 'teknik_servis') || (faultType === 'aplikasyon' && userRole === 'aplikasyon');
    if (!canAssign) {
      toast({ title: 'Yetki Hatası', description: 'Bu arızayı üzerinize alma yetkiniz yok.', variant: 'destructive' });
      autoAssignTriggered.current = true;
      router.replace(`/ariza-yonetimi/${params.id}`);
      return;
    }
    autoAssignTriggered.current = true;
    // Trigger auto-assign
    handleAssignToSelf();
    router.replace(`/ariza-yonetimi/${params.id}`);
  }, [searchParams, fault, currentUser, currentUserProfile, loading, isAdmin, handleAssignToSelf, toast, router, params.id]);

  // Müdahale başlat - test seçimi sonrası
  const handleStartIntervention = useCallback(async (interventionType: InterventionType) => {
    if (!fault || !currentUser) return;

    // Kurum ziyareti için konum doğrulaması gerekli
    if (interventionType === 'kurum_ziyaret' && !locationVerified) {
      toast({ title: 'Konum Doğrulaması Gerekli', description: 'Kurumda müdahale için önce konumunuzu doğrulamanız gerekiyor.', variant: 'destructive' });
      return;
    }

    setIsStartingIntervention(true);
    try {
      await startIntervention(fault.id, {
        uid: currentUser.uid,
        name: currentUserProfile?.name || 'Bilinmeyen',
      }, interventionType, selectedTests.length > 0 ? selectedTests : undefined);

      toast({
        title: 'Müdahale Başlatıldı',
        description: interventionType === 'telefon' ? 'Telefonla destek başlatıldı.' : 'Kurumda müdahale başlatıldı.',
      });
      setIsTestDialogOpen(false);
      setIsProductTestDialogOpen(false);
      setSelectedTests([]);
      setPendingInterventionType(null);
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Hata', description: e.message || 'Müdahale başlatılamadı.', variant: 'destructive' });
    } finally {
      setIsStartingIntervention(false);
    }
  }, [fault, currentUser, currentUserProfile, toast, selectedTests, locationVerified]);

  // Konum doğrulama
  const handleVerifyLocation = useCallback(async () => {
    if (!fault || !currentUser) return;

    setIsVerifyingLocation(true);
    setLocationError(null);

    try {
      // Konum izni al
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });

      const userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      const result = await verifyLocationForIntervention(fault.id, {
        uid: currentUser.uid,
        name: currentUserProfile?.name || 'Bilinmeyen',
      }, userLocation);

      if (result.success) {
        setLocationVerified(true);
        toast({ title: 'Konum Doğrulandı', description: result.message });
      } else {
        setLocationError(result.message);
        toast({ title: 'Konum Doğrulanamadı', description: result.message, variant: 'destructive' });
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage = e.code === 1
        ? 'Konum izni reddedildi. Lütfen konum iznini etkinleştirin.'
        : e.message || 'Konum alınamadı.';
      setLocationError(errorMessage);
      toast({ title: 'Hata', description: errorMessage, variant: 'destructive' });
    } finally {
      setIsVerifyingLocation(false);
    }
  }, [fault, currentUser, currentUserProfile, toast]);

  // Müdahale tipi seçimini aç
  const openInterventionDialog = (type: InterventionType) => {
    setPendingInterventionType(type);

    // Kit arızası için ürüne bağlı test bilgisi modalını aç
    if (fault?.isEjectedKitFault) {
      setIsProductTestDialogOpen(true);
      // Kit arızasında test bilgisi otomatik seçili olacak
      if (productTestInfo) {
        setSelectedTests([productTestInfo]);
      }
    } else if (availableTests.length > 0) {
      setIsTestDialogOpen(true);
    } else {
      // Test yoksa direkt müdahale başlat
      handleStartIntervention(type);
    }
  };

  const handleClose = useCallback(async () => {
    if (!fault) return;
    if (isLockedByOther) {
      toast({ title: 'Erişim Engellendi', description: 'Bu arıza başka bir personel tarafından üzerinde çalışılıyor.', variant: 'destructive' });
      return;
    }
    try {
      const supportPersonnels = allPersonnel
        .filter((p) => selectedSupportPersonnelUids.includes(p.uid))
        .map((p) => ({ uid: p.uid, name: p.name || '' }));

      await closeDeviceFaultReport(fault.id, {
        closedByUid: currentUser?.uid || '',
        closedByName: currentUserProfile?.name || '',
        closeDescription,
        supportPersonnels,
      });
      setIsCloseDialogOpen(false);
      setCloseDescription('');
      setSelectedSupportPersonnelUids([]);
      toast({ title: 'Arıza Kapatıldı', description: `#${fault.id} kapatıldı.` });
    } catch (e) {
      console.error(e);
      toast({ title: 'Hata', description: 'Arıza kapatılamadı.', variant: 'destructive' });
    }
  }, [fault, closeDescription, currentUser, currentUserProfile, toast, selectedSupportPersonnelUids, allPersonnel, isLockedByOther]);

  const handleKitResolution = async (resolution: 'imha' | 'tekrar_kullanim') => {
    if (!fault) return;
    try {
        await resolveEjectedKitFault(fault.id, resolution, {
            uid: currentUser?.uid || '',
            name: currentUserProfile?.name || ''
        }, closeDescription);
        setIsCloseDialogOpen(false);
        setCloseDescription('');
        toast({ title: 'Arıza Çözüldü', description: `Kit durumu "${resolution === 'imha' ? 'imha' : 'tekrar kullanım'}" olarak güncellendi.` });
    } catch (e) {
        console.error(e);
        toast({ title: 'Hata', description: 'Kit arızası çözümlenirken hata oluştu.', variant: 'destructive' });
    }
  };

  // Yedek parça değişim fonksiyonları
  const filteredStock = useMemo(() => {
    if (!partSearchQuery) return personalStock;
    const q = partSearchQuery.toLowerCase();
    return personalStock.filter(p =>
      p.stokKodu?.toLowerCase().includes(q) ||
      p.stokAdi?.toLowerCase().includes(q) ||
      p.serialNumber?.toLowerCase().includes(q)
    );
  }, [personalStock, partSearchQuery]);

  const filteredPoolStock = useMemo(() => {
    if (!partSearchQuery) return poolStockItems;
    const q = partSearchQuery.toLowerCase();
    return poolStockItems.filter(p =>
      p.stokKodu?.toLowerCase().includes(q) ||
      p.stokAdi?.toLowerCase().includes(q) ||
      p.serialNumber?.toLowerCase().includes(q)
    );
  }, [poolStockItems, partSearchQuery]);

  const selectableDepotStock = useMemo(
    () => buildDepotSelectableItems(depotStockItems),
    [depotStockItems]
  );

  const filteredDepotStock = useMemo(() => {
    if (!partSearchQuery) return selectableDepotStock;
    const q = partSearchQuery.toLowerCase();
    return selectableDepotStock.filter((item) =>
      item.stokKodu.toLowerCase().includes(q) ||
      item.stokAdi.toLowerCase().includes(q) ||
      (item.serialNumber || '').toLowerCase().includes(q) ||
      (item.hucreNumarasi || '').toLowerCase().includes(q)
    );
  }, [partSearchQuery, selectableDepotStock]);

  const selectableDepotHucreStock = useMemo(
    () => buildDepotSelectableItems(depotStockItems, { cellsOnly: true }),
    [depotStockItems]
  );

  const handleRemovedPartImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRemovedPartImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setRemovedPartImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleUsedPartImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUsedPartImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setUsedPartImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const uploadPartImage = async (file: File, pathPrefix: 'removed-parts' | 'used-parts'): Promise<string | null> => {
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', pathPrefix);
      formData.append('deviceId', fault?.deviceId || 'unknown-device');

      const response = await fetch('/api/storage/upload-image', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Resim yüklenemedi.');
      }
      return payload.url;
    } catch (e: any) {
      console.error('Image upload error:', e);
      toast({ title: 'Resim Yükleme Hatası', description: e.message || 'Resim yüklenemedi.', variant: 'destructive' });
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  };

  const resetPartModalState = () => {
    setSelectedStockItem(null);
    setSelectedPoolStockItem(null);
    setSelectedDepotStockItem(null);
    setPendingDepotStockItem(null);
    setDepotRequestedQuantity(1);
    setIsDepotQuantityDialogOpen(false);
    setStockSourceTab('personal');
    setPartSearchQuery('');
    setManualPartCode('');
    setManualPartName('');
    setManualSerialNumber('');
    setShowManualEntry(false);
    setRemovedPartStokKodu('');
    setRemovedPartStokAdi('');
    setRemovedPartSerialNumber('');
    setRemovedPartImageFile(null);
    setRemovedPartImagePreview(null);
    setUsedPartImageFile(null);
    setUsedPartImagePreview(null);
  };

  const openPartModal = () => {
    resetPartModalState();
    setIsPartModalOpen(true);
  };

  const handleDepotItemSelect = (item: DepotSelectableStockItem) => {
    if (item.isGrouped && item.totalQuantity > 1) {
      setPendingDepotStockItem(item);
      setDepotRequestedQuantity(1);
      setIsDepotQuantityDialogOpen(true);
      return;
    }
    setSelectedDepotStockItem({ ...item, totalQuantity: 1 });
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
    setSelectedDepotStockItem({ ...pendingDepotStockItem, totalQuantity: requestedQuantity });
    setSelectedStockItem(null);
    setSelectedPoolStockItem(null);
    setPendingDepotStockItem(null);
    setIsDepotQuantityDialogOpen(false);
  };

  const addFaultHucreDegisimi = async () => {
    const selectedHucreItem = hucreStockSourceTab === 'depot' ? hucreDegisimiSelectedDepotItem : hucreDegisimiSelectedItem;
    if (!fault || !currentUser || !selectedHucreItem) return;
    const hn = selectedHucreItem.hucreNumarasi || '';
    const removedHn = hucreDegisimiRemovedHucre.trim().toUpperCase();
    if (removedHn && !/^[A-Za-z]\d{4}$/.test(removedHn)) {
      toast({ title: 'Geçersiz Format', description: 'Çıkan hücre numarası 1 harf + 4 rakamdan oluşmalıdır.', variant: 'destructive' });
      return;
    }
    setIsSavingHucre(true);
    try {
      const item = selectedHucreItem;
      const batch = writeBatch(db);
      const now = new Date();
      let restoredDepotEntry: YedekParcaDepoStokItem | null = null;

      if (hucreStockSourceTab === 'depot') {
        const depotEntry = depotStockItems.find((stock) => stock.id === item.id);
        if (!depotEntry) throw new Error('Seçilen depo hücre stoğu bulunamadı.');
        restoredDepotEntry = depotEntry;
        batch.delete(doc(db, 'yedekParcaDepoStok', depotEntry.id));

        const borrowedRef = doc(collection(db, 'borrowedSpareParts'));
        batch.set(borrowedRef, {
          productCodeId: depotEntry.productCodeId || '',
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          anaBirim: item.anaBirim || 'Adet',
          serialNumber: item.serialNumber || '',
          hucreNumarasi: hn,
          quantity: 1,
          sourceType: 'depot',
          sourceActionType: 'hucre_degisimi',
          depotStockId: depotEntry.id,
          depotAddress: depotEntry.address || '',
          deviceId: fault.deviceId,
          deviceName: fault.model || '',
          hospitalId: fault.hospitalId || '',
          labName: fault.labName || '',
          formId: fault.id,
          formType: 'ariza_yonetimi',
          borrowedByUid: currentUser.uid,
          borrowedByName: currentUserProfile?.name || '',
          borrowedAt: Timestamp.fromDate(now),
          status: 'pending',
        });

        const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
        batch.set(transferLogRef, {
          action: 'borrowed_part',
          borrowedPartId: borrowedRef.id,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          anaBirim: item.anaBirim || 'Adet',
          serialNumber: item.serialNumber || '',
          hucreNumarasi: hn,
          quantity: 1,
          approvalStatus: 'pending',
          sourceType: 'depot',
          deviceId: fault.deviceId,
          deviceName: fault.model || '',
          labName: fault.labName || '',
          formId: fault.id,
          formType: 'ariza_yonetimi',
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUser.uid,
          createdByName: currentUserProfile?.name || '',
        });
      }
      const hucreRef = doc(collection(db, 'deviceFaultReports', fault.id, 'hucreDegisimleri'));
      batch.set(hucreRef, {
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        personalStockId: hucreStockSourceTab === 'personal' ? item.id : '',
        depotStockId: hucreStockSourceTab === 'depot' ? item.id : '',
        isDepotSelection: hucreStockSourceTab === 'depot',
        hucreNumarasi: hn,
        removedHucreNumarasi: removedHn || '',
        description: hucreDegisimiDescription.trim() || '',
        addedAt: Timestamp.fromDate(now),
        addedByUid: currentUser.uid,
        addedByName: currentUserProfile?.name || 'Bilinmeyen',
      });
      // Log to history
      const historyRef = doc(collection(db, 'deviceFaultReports', fault.id, 'history'));
      batch.set(historyRef, {
        type: 'note',
        actorUid: currentUser.uid,
        actorName: currentUserProfile?.name || 'Bilinmeyen',
        description: `Hücre değişimi eklendi: ${item.stokAdi} (Takılan: H:${hn}${removedHn ? `, Çıkan: H:${removedHn}` : ''})${hucreDegisimiDescription.trim() ? ` - ${hucreDegisimiDescription.trim()}` : ''}${hucreStockSourceTab === 'depot' ? ' [Depo stoktan, borç onayı bekliyor]' : ''}`,
        timestamp: Timestamp.fromDate(now),
      });
      await batch.commit();

      if (hucreStockSourceTab === 'depot') {
        emitExternalStockUsage({
          actor: { uid: currentUser.uid, name: currentUserProfile?.name || 'Bilinmeyen' },
          sourceType: 'depot',
          sourceName: 'Depo',
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          serialNumber: hn,
          quantity: 1,
          deviceName: fault.model || '',
          hospitalName: fault.labName || '',
        }).catch(err => console.error("Error sending external stock notification:", err));
      }
      toast({ title: 'Hücre Değişimi Eklendi' });
      setIsHucreDegisimiModalOpen(false);
      setHucreDegisimiSelectedItem(null);
      setHucreDegisimiSelectedDepotItem(null);
      setHucreDegisimiRemovedHucre('');
      setHucreDegisimiDescription('');
      setHucreDegisimiSearchQuery('');
    } catch (err) {
      console.error('Error adding hücre değişimi:', err);
      toast({ title: 'Hata', description: 'Hücre değişimi eklenemedi.', variant: 'destructive' });
    } finally {
      setIsSavingHucre(false);
    }
  };

  const addFaultPartChange = async () => {
    if (!fault || !currentUser) return;

    // Validate selection
    if (!selectedStockItem && !selectedPoolStockItem && !selectedDepotStockItem && !(showManualEntry && manualPartCode && manualPartName)) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen stokunuzdan, havuz stoktan, depo stoktan bir parça seçin veya manuel girin.', variant: 'destructive' });
      return;
    }

    setIsSavingPart(true);

    try {
      // Upload images if present
      let removedImgUrl: string | undefined = undefined;
      let usedImgUrl: string | undefined = undefined;

      if (removedPartImageFile) {
        const url = await uploadPartImage(removedPartImageFile, 'removed-parts');
        if (url) removedImgUrl = url;
      }
      if (usedPartImageFile) {
        const url = await uploadPartImage(usedPartImageFile, 'used-parts');
        if (url) usedImgUrl = url;
      }

      const batch = writeBatch(db);
      const now = new Date();
      const normalized = normalizeStatus(fault.status);
      const isPostClosure = normalized === 'cozuldu';

      const resolvedStokKodu = selectedStockItem?.stokKodu || selectedPoolStockItem?.stokKodu || selectedDepotStockItem?.stokKodu || manualPartCode.trim();
      const resolvedStokAdi = selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || selectedDepotStockItem?.stokAdi || manualPartName.trim();
      const resolvedSerialNumber = selectedStockItem?.serialNumber || selectedPoolStockItem?.serialNumber || selectedDepotStockItem?.serialNumber || manualSerialNumber.trim();
      const resolvedQuantity = selectedDepotStockItem?.isGrouped ? Math.max(1, selectedDepotStockItem.totalQuantity || 1) : 1;

      const partChangeData: any = {
        stokKodu: resolvedStokKodu,
        stokAdi: resolvedStokAdi,
        serialNumber: resolvedSerialNumber,
        personalStockId: selectedStockItem?.id || null,
        depotStockId: selectedDepotStockItem?.id || null,
        isDepotSelection: !!selectedDepotStockItem,
        poolStockId: selectedPoolStockItem?.id || null,
        poolWarehouseId: selectedPoolStockItem?.poolWarehouseId || null,
        poolWarehouseName: selectedPoolStockItem?.poolWarehouseName || null,
        isManualEntry: !selectedStockItem && !selectedPoolStockItem && !selectedDepotStockItem,
        quantity: resolvedQuantity,
        removedPartStokKodu: removedPartStokKodu.trim() || resolvedStokKodu,
        removedPartStokAdi: removedPartStokAdi.trim() || resolvedStokAdi,
        removedPartSerialNumber: removedPartSerialNumber.trim() || null,
        removedPartImageUrl: removedImgUrl || null,
        usedPartImageUrl: usedImgUrl || null,
        addedAt: Timestamp.fromDate(now),
        addedByUid: currentUser.uid,
        addedByName: currentUserProfile?.name || 'Bilinmeyen',
        isPostClosure: isPostClosure,
      };

      // Add to fault's partChanges subcollection
      const partRef = doc(collection(db, 'deviceFaultReports', fault.id, 'partChanges'));
      batch.set(partRef, partChangeData);

      // If from personal stock, mark stock item as used
      if (selectedStockItem?.id) {
        const stockRef = doc(db, 'personalStock', selectedStockItem.id);
        batch.update(stockRef, {
          status: 'used',
          usedAt: Timestamp.fromDate(now),
          usedOnDeviceId: fault.deviceId,
          usedOnFormId: fault.id,
          usedOnFormType: 'ariza_yonetimi',
          usedPartImageUrl: usedImgUrl || null,
        });
      }

      // If from pool stock, mark pool stock item as used
      if (selectedPoolStockItem?.id) {
        const poolStockRef = doc(db, 'poolWarehouseStock', selectedPoolStockItem.id);
        batch.update(poolStockRef, {
          status: 'used',
          usedAt: Timestamp.fromDate(now),
          usedByUid: currentUser.uid,
          usedByName: currentUserProfile?.name || '',
          usedOnDeviceId: fault.deviceId,
          usedOnDeviceName: fault.model || '',
          usedOnFormId: fault.id,
          usedOnFormType: 'ariza_yonetimi',
          usedOnLabId: fault.labId || null,
          usedOnLabName: fault.labName || null,
        });
      }

      if (selectedDepotStockItem) {
        const requestedQuantity = Math.max(1, selectedDepotStockItem.isGrouped ? selectedDepotStockItem.totalQuantity : 1);
        const fallbackEntry = selectedDepotStockItem.id
          ? depotStockItems.find((item) => item.id === selectedDepotStockItem.id)
          : depotStockItems
              .filter((item) => item.stokKodu === selectedDepotStockItem.stokKodu && !item.serialNumber && !item.hucreNumarasi)
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

        if (!fallbackEntry) {
          throw new Error('Seçilen depo stok kaydı bulunamadı.');
        }

        if ((fallbackEntry.quantity || 1) <= requestedQuantity) {
          batch.delete(doc(db, 'yedekParcaDepoStok', fallbackEntry.id));
        } else {
          batch.update(doc(db, 'yedekParcaDepoStok', fallbackEntry.id), {
            quantity: (fallbackEntry.quantity || 1) - requestedQuantity,
          });
        }

        const borrowedRef = doc(collection(db, 'borrowedSpareParts'));
        batch.set(borrowedRef, {
          productCodeId: fallbackEntry.productCodeId || '',
          stokKodu: resolvedStokKodu,
          stokAdi: resolvedStokAdi,
          anaBirim: selectedDepotStockItem.anaBirim || 'Adet',
          serialNumber: resolvedSerialNumber || '',
          quantity: requestedQuantity,
          sourceType: 'depot',
          sourceActionType: 'part_change',
          depotStockId: fallbackEntry.id,
          depotAddress: fallbackEntry.address || '',
          deviceId: fault.deviceId,
          deviceName: fault.model || '',
          hospitalId: fault.hospitalId || '',
          labName: fault.labName || '',
          formId: fault.id,
          formType: 'ariza_yonetimi',
          borrowedByUid: currentUser.uid,
          borrowedByName: currentUserProfile?.name || '',
          borrowedAt: Timestamp.fromDate(now),
          status: 'pending',
          usedPartImageUrl: usedImgUrl || null,
        });

        const transferLogRef = doc(collection(db, 'sparePartTransferLogs'));
        batch.set(transferLogRef, {
          action: 'borrowed_part',
          borrowedPartId: borrowedRef.id,
          stokKodu: resolvedStokKodu,
          stokAdi: resolvedStokAdi,
          anaBirim: selectedDepotStockItem.anaBirim || 'Adet',
          serialNumber: resolvedSerialNumber || '',
          quantity: requestedQuantity,
          approvalStatus: 'pending',
          sourceType: 'depot',
          deviceId: fault.deviceId,
          deviceName: fault.model || '',
          labName: fault.labName || '',
          formId: fault.id,
          formType: 'ariza_yonetimi',
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUser.uid,
          createdByName: currentUserProfile?.name || '',
          usageImageUrl: usedImgUrl || null,
        });
      }

      // If removed part has serial number, create personal stock entry for removed part.
      // Guardrails:
      // 1) Do not re-add when removed serial equals installed serial.
      // 2) Do not create duplicate active stock for same owner + stokKodu + serial.
      const removedSerial = removedPartSerialNumber.trim();
      const removedStokKoduValue = removedPartStokKodu.trim() || resolvedStokKodu;
      const isReusableStockStatus = (status: unknown) => {
        const normalized = String(status || '').trim().toLowerCase();
        return normalized === 'in_stock' || normalized === 'pending_approval';
      };

      if (removedSerial && removedSerial !== (resolvedSerialNumber || '').trim()) {
        const duplicateSnap = await getDocs(query(
          collection(db, 'personalStock'),
          where('ownerUid', '==', currentUser.uid),
          where('serialNumber', '==', removedSerial)
        ));
        const hasActiveDuplicate = duplicateSnap.docs.some((docSnap) => {
          const data = docSnap.data();
          return data.stokKodu === removedStokKoduValue && isReusableStockStatus(data.status);
        });

        if (!hasActiveDuplicate) {
          const removedStockRef = doc(collection(db, 'personalStock'));
          batch.set(removedStockRef, {
            ownerUid: currentUser.uid,
            ownerName: currentUserProfile?.name || '',
            productCodeId: null,
            stokKodu: removedStokKoduValue,
            stokAdi: removedPartStokAdi.trim() || resolvedStokAdi,
            serialNumber: removedSerial,
            imageUrl: removedImgUrl || null,
            source: 'device',
            sourceDeviceId: fault.deviceId,
            sourceDeviceName: fault.model || '',
            status: 'in_stock',
            createdAt: Timestamp.fromDate(now),
            replacedPartId: selectedStockItem?.id || selectedPoolStockItem?.id || null,
          });
        }
      }

      // Add history entry for part change (with post-closure flag)
      const historyRef = doc(collection(db, 'deviceFaultReports', fault.id, 'history'));
      const historyDescription = `${isPostClosure ? '[Sonradan Eklendi] ' : ''}Parça değişimi: ${partChangeData.stokAdi} (${resolvedSerialNumber || (resolvedQuantity > 1 ? `${resolvedQuantity} adet` : 'Seri No Yok')})${removedPartSerialNumber.trim() ? ` → Çıkan: ${partChangeData.removedPartStokAdi} (${removedPartSerialNumber.trim()})` : ''}${selectedPoolStockItem ? ` [Havuz Stok: ${selectedPoolStockItem.poolWarehouseName}]` : ''}${selectedDepotStockItem ? ` [Depo Stok · ${resolvedQuantity} adet · Borç onayı bekliyor]` : ''}`;
      batch.set(historyRef, {
        type: 'note',
        actorUid: currentUser.uid,
        actorName: currentUserProfile?.name || 'Bilinmeyen',
        description: historyDescription,
        timestamp: Timestamp.fromDate(now),
        isPostClosure: isPostClosure,
      });

      // Log post-closure part change to dedicated collection for audit trail
      if (isPostClosure) {
        const logRef = doc(collection(db, 'postClosurePartChangeLogs'));
        batch.set(logRef, {
          faultReportId: fault.id,
          deviceId: fault.deviceId,
          model: fault.model,
          serial: fault.serial,
          labName: fault.labName,
          faultType: fault.faultType,
          stokKodu: resolvedStokKodu,
          stokAdi: resolvedStokAdi,
          serialNumber: resolvedSerialNumber,
          removedPartStokKodu: removedPartStokKodu.trim() || resolvedStokKodu,
          removedPartStokAdi: removedPartStokAdi.trim() || resolvedStokAdi,
          removedPartSerialNumber: removedPartSerialNumber.trim() || null,
          personalStockId: selectedStockItem?.id || null,
          depotStockId: selectedDepotStockItem?.id || null,
          poolStockId: selectedPoolStockItem?.id || null,
          poolWarehouseId: selectedPoolStockItem?.poolWarehouseId || null,
          poolWarehouseName: selectedPoolStockItem?.poolWarehouseName || null,
          isManualEntry: !selectedStockItem && !selectedPoolStockItem && !selectedDepotStockItem,
          addedByUid: currentUser.uid,
          addedByName: currentUserProfile?.name || 'Bilinmeyen',
          addedAt: Timestamp.fromDate(now),
          sourceType: 'ariza_yonetimi',
        });
      }

      await batch.commit();

      if (selectedPoolStockItem || selectedDepotStockItem) {
        emitExternalStockUsage({
          actor: { uid: currentUser.uid, name: currentUserProfile?.name || 'Bilinmeyen' },
          sourceType: selectedPoolStockItem ? 'pool' : 'depot',
          sourceName: selectedPoolStockItem ? (selectedPoolStockItem.poolWarehouseName || 'Havuz') : 'Depo',
          stokKodu: resolvedStokKodu,
          stokAdi: resolvedStokAdi,
          serialNumber: resolvedSerialNumber,
          quantity: resolvedQuantity,
          deviceName: fault.model || '',
          hospitalName: fault.labName || '',
        }).catch(err => console.error("Error sending external stock notification:", err));
      }

      toast({ title: 'Başarılı', description: isPostClosure ? 'Parça değişimi sonradan eklendi ve loglandı.' : 'Parça değişimi eklendi.' });
      resetPartModalState();
      setIsPartModalOpen(false);
    } catch (e: any) {
      console.error('Part change error:', e);
      toast({ title: 'Hata', description: e.message || 'Parça değişimi eklenemedi.', variant: 'destructive' });
    } finally {
      setIsSavingPart(false);
    }
  };


  const fetchAiSuggestion = useCallback(async (forceRefresh = false) => {
    if (!fault?.id) return;

    setIsAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/ariza-yonetimi/ai-oneri?reportId=${fault.id}${forceRefresh ? '&force=1' : ''}`);
      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'AI önerisi alınamadı.');
      }
      setAiSuggestion(payload.data || null);
    } catch (e: any) {
      setAiError(e?.message || 'AI önerisi alınamadı.');
      setAiSuggestion(null);
    } finally {
      setIsAiLoading(false);
    }
  }, [fault?.id]);

  useEffect(() => {
    if (!fault?.id) return;
    fetchAiSuggestion();
  }, [fault?.id, fetchAiSuggestion]);



  const handleShare = async () => {
    if (!fault) return;
    const shareText = `Arıza Raporu: #${fault.id}\nLaboratuvar: ${fault.labName}\nCihaz: ${fault.model} (SN: ${fault.serial})\nAçan: ${fault.openedByName}\nAçılış: ${fault.openedAt ? format(fault.openedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : 'Bilinmiyor'}`;
    const shareUrl = window.location.href;
    const shareTitle = fault.title || `Arıza Raporu: #${fault.id}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
      } catch (error) {
        console.error('Paylaşım hatası:', error);
        toast({ title: 'Paylaşım Başarısız', description: 'Arıza detayı paylaşılamadı.', variant: 'destructive' });
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\nLink: ${shareUrl}`);
        toast({ title: 'Panoya Kopyalandı', description: 'Arıza detayı panoya kopyalandı.' });
      } catch (error) {
        console.error('Kopyalama hatası:', error);
        toast({ title: 'Kopyalama Başarısız', description: 'Arıza detayı kopyalanamadı.', variant: 'destructive' });
      }
    }
  };

  const generatePdf = async () => {
    if (!fault) return;

    // Turkish font loading (same approach as Teknik Servis Formu)
    let turkishFontBase64: string | null = null;
    try {
      const fontUrl = 'https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf';
      const fontResp = await fetch(fontUrl);
      if (fontResp.ok) {
        const fontBlob = await fontResp.blob();
        turkishFontBase64 = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(fontBlob);
        });
      }
    } catch (e) {
      console.error('Could not load Turkish font:', e);
    }

    const pdfDoc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = pdfDoc.internal.pageSize.getWidth();
    const pageH = pdfDoc.internal.pageSize.getHeight();
    const padX = 40;

    let useTurkish = false;
    if (turkishFontBase64) {
      try {
        pdfDoc.addFileToVFS('NotoSans-Regular.ttf', turkishFontBase64);
        pdfDoc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
        useTurkish = true;
      } catch (e) {
        console.error('Could not setup Turkish font:', e);
      }
    }
    const FONT = useTurkish ? 'NotoSans' : 'helvetica';
    const txt = (str: string | null | undefined): string => {
      if (!str) return '';
      if (useTurkish) return str;
      return str
        .replace(/İ/g, 'I').replace(/ı/g, 'i')
        .replace(/Ş/g, 'S').replace(/ş/g, 's')
        .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
        .replace(/Ü/g, 'U').replace(/ü/g, 'u')
        .replace(/Ö/g, 'O').replace(/ö/g, 'o')
        .replace(/Ç/g, 'C').replace(/ç/g, 'c');
    };

    pdfDoc.setFont(FONT);

    const ORANGE = { r: 199, g: 137, b: 65 };
    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.setLineWidth(2);
    pdfDoc.rect(padX / 2, padX / 2, pageW - padX, pageH - padX);

    // --- HEADER: Title (left), Logo (center), QR Code (right) ---
    const headerY = 30;

    pdfDoc.setTextColor(0, 0, 0);
    pdfDoc.setFontSize(14);
    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.text(txt('Arıza Raporu'), padX, headerY + 20);

    // Logo in center
    try {
      let logoResponse = await fetch('/invlogo.png');
      if (!logoResponse.ok) {
        logoResponse = await fetch('/invitrolab_LOGO__-_Kopya__1_-removebg.png');
      }
      if (logoResponse.ok) {
        const logoBlob = await logoResponse.blob();
        const logoData = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(logoBlob);
        });
        const logoWidth = 132;
        const logoHeight = 40;
        const logoX = (pageW / 2) - (logoWidth / 2);
        pdfDoc.addImage(logoData, 'PNG', logoX, headerY + 5, logoWidth, logoHeight, undefined, 'FAST');
      }
    } catch (e) {
      console.error('Could not load header logo:', e);
    }

    // QR Code on right with orange rounded border
    const recordUrl = `${window.location.origin}/ariza-yonetimi/${fault.id}`;
    const qrDataUrl = await QRCode.toDataURL(recordUrl, { errorCorrectionLevel: 'M', margin: 0, scale: 4 });

    const qrSize = 60;
    const qrX = pageW - padX - qrSize - 10;
    const qrY = headerY;

    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.setFillColor(255, 255, 255);
    pdfDoc.setLineWidth(2);
    pdfDoc.roundedRect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10, 5, 5, 'FD');
    pdfDoc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'FAST');

    // System logo below QR
    try {
      const sysLogoResponse = await fetch('/newlogoblk.png');
      if (sysLogoResponse.ok) {
        const sysLogoBlob = await sysLogoResponse.blob();
        const sysLogoData = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(sysLogoBlob);
        });
        const sysLogoSize = 28;
        const sysLogoX = qrX + (qrSize / 2) - (sysLogoSize / 2);
        pdfDoc.addImage(sysLogoData, 'PNG', sysLogoX, qrY + qrSize + 5, sysLogoSize, sysLogoSize, undefined, 'FAST');
      }
    } catch (e) {
      console.error('Could not load system logo:', e);
    }

    // --- FORM INFO SECTION ---
    pdfDoc.setFontSize(10);
    pdfDoc.setFont(FONT, 'normal');
    let currentY = 100;

    // Resolve pool main lab name
    let labDisplayName = fault.labName || '';
    const hospitalId = fault.hospitalId || fault.labId;
    if (hospitalId) {
      try {
        const poolsSnap = await getDocs(collection(db, 'labPools'));
        const allPools = poolsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const matchingPool = allPools.find((p: any) => p.active && p.memberIds?.includes(hospitalId));
        if (matchingPool) {
          const pool = matchingPool as any;
          if (pool.mainLabId && pool.mainLabId !== hospitalId) {
            const mainLabDoc = await getDoc(doc(db, 'hospitals', pool.mainLabId));
            if (mainLabDoc.exists()) {
              labDisplayName = `${mainLabDoc.data().name} - ${fault.labName || ''}`;
            }
          }
        }
      } catch (e) {
        console.error('Could not resolve pool main lab:', e);
      }
    }

    const normalized = normalizeStatus(fault.status);
    const statusLabel = STATUS_CONFIG[normalized]?.label || fault.status;
    const faultTypeLabel = fault.faultType === 'teknik_servis' ? 'Teknik Servis' : fault.faultType === 'aplikasyon' ? 'Aplikasyon' : (fault.faultType || '-');

    const info: string[][] = [
      [txt('Arıza No:'), fault.id],
      [txt('Laboratuvar:'), txt(labDisplayName)],
      [txt('Cihaz:'), txt(`${fault.model} (SN: ${fault.serial})`)],
      [txt('Arıza Tipi:'), txt(faultTypeLabel)],
      ['Durum:', txt(statusLabel)],
      [txt('Açan:'), txt(`${fault.openedByName}${((fault as any).supportPersonnelNames?.length ? ` (Eşlik Eden: ${(fault as any).supportPersonnelNames.join(', ')})` : fault.supportPersonnelName ? ` (Eşlik Eden: ${fault.supportPersonnelName})` : '')}`)],
      [txt('Başlangıç:'), fault.openedAt ? format(fault.openedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'],
      [txt('Bitiş:'), fault.closedAt ? format(fault.closedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'],
    ];

    autoTable(pdfDoc, {
      body: info,
      startY: currentY,
      theme: 'plain',
      styles: { font: FONT, fontSize: 10, cellPadding: { top: 4, bottom: 4 } },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
    });

    currentY = (pdfDoc as any).lastAutoTable.finalY + 15;

    // --- ACIKLAMA SECTION ---
    if (fault.description?.trim()) {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('Açıklama'), padX, currentY + 12);
      currentY += 18;

      autoTable(pdfDoc, {
        body: [[txt(fault.description)]],
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT, fontSize: 10, cellPadding: { top: 6, bottom: 6 } },
        margin: { left: padX, right: padX },
      });

      currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
    }

    // --- COZUM BILGILERI SECTION (when resolved) ---
    if (normalized === 'cozuldu') {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('Çözüm Bilgileri'), padX, currentY + 12);
      currentY += 18;

      const cozumRows: string[][] = [];
      if (fault.closedByName) {
        cozumRows.push([txt('Kapatan:'), txt(fault.closedByName)]);
      }
      if (fault.closedAt) {
        cozumRows.push([txt('Kapanış Tarihi:'), format(fault.closedAt, 'dd.MM.yyyy HH:mm', { locale: tr })]);
      }
      if (resolutionTime !== null) {
        cozumRows.push([txt('Çözüm Süresi:'), `${resolutionTime} dk`]);
      }
      if (fault.closeDescription) {
        cozumRows.push([txt('Çözüm Açıklaması:'), txt(fault.closeDescription)]);
      }

      if (cozumRows.length > 0) {
        autoTable(pdfDoc, {
          body: cozumRows,
          startY: currentY,
          theme: 'plain',
          styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 120 } },
          margin: { left: padX, right: padX },
        });
        currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
      }
    }

    // --- DEGISEN PARCALAR SECTION ---
    if (faultPartChanges.length > 0) {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('Değişen Parçalar'), padX, currentY + 12);
      currentY += 18;

      autoTable(pdfDoc, {
        head: [[txt('Parça'), 'Kod', txt('Seri No'), 'Adet']],
        body: faultPartChanges.map(part => [
          txt(part.stokAdi || '-'),
          txt(part.stokKodu || '-'),
          txt(part.serialNumber || '-'),
          String(part.quantity || 1),
        ]),
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT, fontSize: 10 },
        headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: padX, right: padX },
      });

      currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
    }

    // --- HUCRE DEGISIMLERI SECTION ---
    if (faultHucreDegisimleri.length > 0) {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('Hücre Değişimleri'), padX, currentY + 12);
      currentY += 18;

      autoTable(pdfDoc, {
        head: [[txt('Parça'), txt('Takılan Hücre'), txt('Çıkan Hücre'), txt('Açıklama')]],
        body: faultHucreDegisimleri.map(h => [
          txt(h.stokAdi || '-'),
          txt(h.hucreNumarasi || '-'),
          txt(h.removedHucreNumarasi || '-'),
          txt(h.description || '-'),
        ]),
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT, fontSize: 10 },
        headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: padX, right: padX },
      });

      currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
    }

    // --- CIHAZ DURUMU SECTION ---
    pdfDoc.setFont(FONT, 'bold');
    pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
    pdfDoc.line(padX, currentY, pageW - padX, currentY);
    pdfDoc.text('Cihaz Durumu', padX, currentY + 12);
    currentY += 18;

    autoTable(pdfDoc, {
      body: [
        ['Durum:', txt(statusLabel)],
      ],
      startY: currentY,
      theme: 'plain',
      styles: { font: FONT, fontSize: 10, cellPadding: { top: 3, bottom: 3 } },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100 } },
      margin: { left: padX, right: padX },
    });

    currentY = (pdfDoc as any).lastAutoTable.finalY + 15;

    // --- ARIZA GECMISI TABLE ---
    if (history.length > 0) {
      pdfDoc.setFont(FONT, 'bold');
      pdfDoc.setDrawColor(ORANGE.r, ORANGE.g, ORANGE.b);
      pdfDoc.line(padX, currentY, pageW - padX, currentY);
      pdfDoc.text(txt('Arıza Geçmişi'), padX, currentY + 12);
      currentY += 18;

      autoTable(pdfDoc, {
        head: [['Tarih', txt('Tür'), txt('Kullanıcı'), txt('Açıklama')]],
        body: history.map(ev => [
          ev.timestamp ? format(ev.timestamp, 'dd.MM.yy HH:mm', { locale: tr }) : '-',
          txt(ev.type.replace('_', ' ')),
          txt(ev.actorName || '-'),
          txt(ev.description || '-'),
        ]),
        startY: currentY,
        theme: 'grid',
        styles: { font: FONT, fontSize: 10 },
        headStyles: { fillColor: [224, 224, 224], textColor: [0, 0, 0], fontStyle: 'bold' },
        margin: { left: padX, right: padX },
      });

      currentY = (pdfDoc as any).lastAutoTable.finalY + 15;
    }

    // --- DEVICE IMAGE (if available) ---
    if (device?.imageUrl) {
      try {
        const imgResponse = await fetch(resolveImageSrc(device.imageUrl));
        const imgBlob = await imgResponse.blob();
        const imgData = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(imgBlob);
        });
        // Check if we need a new page
        if (currentY + 120 > pageH - padX) {
          pdfDoc.addPage();
          currentY = padX;
        }
        pdfDoc.addImage(imgData, 'PNG', padX, currentY, 80, 80, undefined, 'FAST');
      } catch (e) {
        console.error('PDF image load error:', e);
      }
    }

    pdfDoc.save(`Ariza_Raporu_${fault.id}.pdf`);
  };

  const openEditModal = (historyItem: HistoryEvent) => {
    setEditingHistoryItem(historyItem);
    setEditingDescription(historyItem.description || '');
    setIsEditHistoryModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingHistoryItem || !fault) return;
    setIsSavingEdit(true);
    try {
      const historyRef = doc(db, 'deviceFaultReports', fault.id, 'history', editingHistoryItem.id);
      const oldDescription = editingHistoryItem.description || '';
      await updateDoc(historyRef, {
        description: editingDescription,
        lastEditedAt: serverTimestamp(),
        lastEditedBy: currentUser?.uid,
        lastEditedByName: currentUserProfile?.name || 'Bilinmeyen',
      });

      if (editingHistoryItem.type === 'closed') {
        await updateDoc(doc(db, 'deviceFaultReports', fault.id), {
          closeDescription: editingDescription
        });
      }

      // Log the edit to history
      await addDoc(collection(db, 'deviceFaultReports', fault.id, 'history'), {
        type: 'note',
        actorUid: currentUser?.uid,
        actorName: currentUserProfile?.name || 'Bilinmeyen',
        description: `Kapanış notu düzenlendi. Eski: "${oldDescription}" → Yeni: "${editingDescription}"`,
        timestamp: serverTimestamp(),
        editType: 'closeDescription_edit',
      });

      toast({ title: 'Açıklama Güncellendi' });
      setIsEditHistoryModalOpen(false);
      setEditingHistoryItem(null);
    } catch (err) {
      console.error('Error updating history item:', err);
      toast({ title: 'Hata', description: 'Açıklama güncellenemedi.', variant: 'destructive' });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const openEditResolved = () => {
    if (!fault) return;
    setEditCloseDescription(fault.closeDescription || '');
    setEditSupportPersonnelUids((fault as any).supportPersonnelUids || (fault.supportPersonnelUid ? [fault.supportPersonnelUid] : []));
    setEditPersonnelSearchQuery('');
    setIsEditResolvedOpen(true);
  };

  const handleSaveResolvedEdit = async () => {
    if (!fault) return;
    setIsSavingResolved(true);
    try {
      const changes: string[] = [];
      const updateData: Record<string, any> = {};

      // Check closeDescription change
      if (editCloseDescription !== (fault.closeDescription || '')) {
        changes.push(`Çözüm açıklaması: "${fault.closeDescription || '-'}" → "${editCloseDescription}"`);
        updateData.closeDescription = editCloseDescription;

        // Also update the 'closed' history event
        const historySnap = await getDocs(
          query(
            collection(db, 'deviceFaultReports', fault.id, 'history'),
            where('type', '==', 'closed')
          )
        );
        for (const hDoc of historySnap.docs) {
          await updateDoc(doc(db, 'deviceFaultReports', fault.id, 'history', hDoc.id), {
            description: editCloseDescription,
            lastEditedAt: serverTimestamp(),
            lastEditedBy: currentUser?.uid,
            lastEditedByName: currentUserProfile?.name || 'Bilinmeyen',
          });
        }
      }

      // Check support personnel change
      const newSupportUids = [...editSupportPersonnelUids].sort();
      const oldSupportUids = ([...(((fault as any).supportPersonnelUids || (fault.supportPersonnelUid ? [fault.supportPersonnelUid] : [])))] as string[]).sort();
      if (newSupportUids.join('|') !== oldSupportUids.join('|')) {
        const newPeople = allPersonnel.filter(p => newSupportUids.includes(p.uid));
        const oldNames = ((fault as any).supportPersonnelNames || (fault.supportPersonnelName ? [fault.supportPersonnelName] : ['Seçim yok'])) as string[];
        const newNames = newPeople.map(p => p.name || p.email || p.uid);
        changes.push(`Destek personeli: "${oldNames.join(', ') || 'Seçim yok'}" → "${newNames.join(', ') || 'Seçim yok'}"`);
        updateData.supportPersonnelUids = newSupportUids;
        updateData.supportPersonnelNames = newNames;
        updateData.supportPersonnelUid = newPeople[0]?.uid || null;
        updateData.supportPersonnelName = newPeople[0]?.name || null;
      }

      if (changes.length === 0) {
        toast({ title: 'Değişiklik Yok', description: 'Herhangi bir değişiklik yapılmadı.' });
        setIsEditResolvedOpen(false);
        return;
      }

      // Update the fault report
      await updateDoc(doc(db, 'deviceFaultReports', fault.id), updateData);

      // Log the edit to history
      await addDoc(collection(db, 'deviceFaultReports', fault.id, 'history'), {
        type: 'note',
        actorUid: currentUser?.uid,
        actorName: currentUserProfile?.name || 'Bilinmeyen',
        description: `Çözüm bilgileri düzenlendi:\n${changes.join('\n')}`,
        timestamp: serverTimestamp(),
        editType: 'resolved_edit',
      });

      toast({ title: 'Çözüm Bilgileri Güncellendi' });
      setIsEditResolvedOpen(false);
    } catch (err) {
      console.error('Error updating resolved fault:', err);
      toast({ title: 'Hata', description: 'Güncelleme başarısız oldu.', variant: 'destructive' });
    } finally {
      setIsSavingResolved(false);
    }
  };


  if (loading) {
    return <div className="p-6"><div className="animate-pulse h-6 w-40 rounded bg-muted" /></div>
  }

  if (!fault) return null;

  return (
    <div className="device-module-page p-4 space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <BackButton fallback="/ariza-yonetimi" />
        <div className="flex items-center gap-2">
            <div className="md:hidden">{statusBadge}</div>
            <div className="hidden md:flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="sm" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" /> Paylaş
              </Button>
              <Button variant="outline" size="sm" onClick={generatePdf}>
                  <FileDown className="h-4 w-4 mr-2" /> PDF Olarak İndir
              </Button>
            </div>
             <div className="md:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                     {theme === 'dark' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                     <span>Tema Değiştir</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleShare}>
                    <Share2 className="h-4 w-4 mr-2" />
                    <span>Paylaş</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={generatePdf}>
                    <FileDown className="h-4 w-4 mr-2" />
                    <span>PDF Olarak İndir</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
        </div>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              {device?.imageUrl && (
                <div className="w-24 h-24 flex-shrink-0 bg-muted rounded-lg p-1">
                  <Image
                    src={resolveImageSrc(device.imageUrl)}
                    alt={device.model || ''}
                    width={96}
                    height={96}
                    className="object-contain w-full h-full"
                  />
                </div>
              )}
              <div>
                <CardTitle className="text-xl font-headline">
                  {fault.model} ({fault.serial})
                </CardTitle>
                <CardDescription>Arıza ID: {fault.id}</CardDescription>
              </div>
            </div>
            <div className="hidden md:flex flex-col items-end gap-2">
                {statusBadge}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div><p className="font-medium">Laboratuvar:</p><p>{fault.labName}</p></div>
            <div><p className="font-medium">Cihaz:</p><p>{fault.model} <span className="text-muted-foreground font-mono">({fault.serial})</span></p></div>
            <div><p className="font-medium">Arıza Tipi:</p><p className="capitalize">{fault.faultType?.replace('_',' ')}</p></div>
            <div><p className="font-medium">Durum:</p><p className="capitalize">{fault.status === 'open' ? 'Açık' : 'Giderildi'}</p></div>
            <div><p className="font-medium">Açan:</p><p>{fault.openedByName} {fault.openedAt && (<span className="text-xs text-muted-foreground">({format(fault.openedAt, 'dd.MM.yyyy HH:mm', { locale: tr })})</span>)}</p></div>
            {fault.status === 'closed' && (
              <div><p className="font-medium">Kapatan:</p><p>{fault.closedByName} {fault.closedAt && (<span className="text-xs text-muted-foreground">({format(fault.closedAt, 'dd.MM.yyyy HH:mm', { locale: tr })})</span>)}</p></div>
            )}
          </div>

          {fault.isEjectedKitFault && (
            <div className="pt-4 border-t">
                <p className="font-medium mb-2 text-amber-600">İlişkili Kit Bilgisi</p>
                <div className="text-sm grid grid-cols-2 gap-4">
                    <div><p className="font-medium">Ürün:</p><p>{fault.productStokAdi} ({fault.productStokKodu})</p></div>
                    <div><p className="font-medium">Test Sayısı:</p><p>{fault.testCount}</p></div>
                </div>
            </div>
          )}
            

          <div className="space-y-3 pt-4 border-t">
            <p className="font-medium">Açıklama</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{fault.description || '-'}</p>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-500" />
                <p className="font-medium">AI Önerisi</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => fetchAiSuggestion(true)} disabled={isAiLoading}>
                {isAiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Yenile'}
              </Button>
            </div>

            {isAiLoading && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> AI önerisi hazırlanıyor...
              </div>
            )}

            {aiError && <p className="text-sm text-red-600">{aiError}</p>}

            {!isAiLoading && !aiError && aiSuggestion && (
              <div className="rounded-lg border bg-violet-50/40 dark:bg-violet-950/20 p-3 space-y-3 text-sm">
                {aiSuggestion.summary && <p><span className="font-medium">Özet:</span> {aiSuggestion.summary}</p>}
                {typeof aiSuggestion.confidence === 'number' && (
                  <p><span className="font-medium">Güven Skoru:</span> %{Math.max(0, Math.min(100, Math.round(aiSuggestion.confidence)))}</p>
                )}
                {!!aiSuggestion.probableCauses?.length && (
                  <div>
                    <p className="font-medium mb-1">Olası Nedenler</p>
                    <ul className="list-disc pl-5 space-y-1">
                      {aiSuggestion.probableCauses.map((item, idx) => <li key={`cause-${idx}`}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {!!aiSuggestion.suggestedActions?.length && (
                  <div>
                    <p className="font-medium mb-1">Önerilen Aksiyonlar</p>
                    <ul className="list-disc pl-5 space-y-1">
                      {aiSuggestion.suggestedActions.map((item, idx) => <li key={`action-${idx}`}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {aiSuggestion.chronicInsight && <p><span className="font-medium">Kronik Sorun Analizi:</span> {aiSuggestion.chronicInsight}</p>}
                {aiSuggestion.resolutionAssessment && <p><span className="font-medium">Kalıcı/Geçici Çözüm Yorumu:</span> {aiSuggestion.resolutionAssessment}</p>}
                {aiSuggestion.evidenceBasedRecommendation && <p><span className="font-medium">Cihaz Geçmişine Dayalı Özel Öneri:</span> {aiSuggestion.evidenceBasedRecommendation}</p>}
                {aiSuggestion.similarFaultStats && (
                  <p className="text-xs text-muted-foreground">
                    Benzer arıza: {aiSuggestion.similarFaultStats.total} • Aynı model: {aiSuggestion.similarFaultStats.sameModelCount} • Aynı başlık+kategori: {aiSuggestion.similarFaultStats.sameTitleCategoryCount} • Çözülen: {aiSuggestion.similarFaultStats.resolvedCount}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Yeni Arıza Akış Sistemi */}
          {(() => {
            const normalized = normalizeStatus(fault.status);

            // KİLİT MEKANİZMASI - Başka bir personel müdahale ediyorsa
            if (isLockedByOther) {
              return (
                <div className="pt-4 border-t">
                  <div className="relative rounded-lg overflow-hidden border-2 border-amber-400/50">
                    <div className="bg-amber-50 dark:bg-amber-950/30 p-6">
                      <div className="flex flex-col items-center justify-center text-center gap-3">
                        <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                          <Lock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                          <p className="font-semibold text-amber-800 dark:text-amber-200 text-lg">
                            Bu Arıza Üzerinde Çalışılıyor
                          </p>
                          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                            <span className="font-medium">{fault.assignedToName}</span> bu arıza üzerinde müdahale ediyor.
                          </p>
                          <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-2">
                            Arıza kapama, müdahale ve diğer işlemler sadece atanmış personel tarafından yapılabilir.
                          </p>
                        </div>
                        <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300 mt-1">
                          {normalized === 'mudahale_bekliyor' ? 'Müdahale Bekleniyor' : 'Müdahale Ediliyor'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            // ATAMA BEKLİYOR - Buzlu arka plan ve "Üzerime Ata" butonu
            if (normalized === 'atama_bekliyor') {
              // Kullanıcının rolü arıza tipine uygun mu kontrol et
              const userRole = currentUserProfile?.role;
              const faultType = fault.faultType;
              const canAssign = isAdmin || (faultType === 'teknik_servis' && userRole === 'teknik_servis') || (faultType === 'aplikasyon' && userRole === 'aplikasyon');

              return (
                <div className="pt-4 border-t">
                  <div className="relative rounded-lg overflow-hidden">
                    {/* Buzlu arka plan efekti */}
                    <div className="absolute inset-0 backdrop-blur-sm bg-white/60 dark:bg-black/60 z-10" />

                    {/* Arıza önizlemesi (bulanık) - butonlara yeterli alan sağlamak için min yükseklik */}
                    <div className="p-4 opacity-50 min-h-[160px]">
                      <p className="text-sm text-muted-foreground">{fault.description}</p>
                    </div>

                    {/* Üzerime Ata butonu */}
                    <div className="absolute inset-0 z-20 flex items-center justify-center flex-col gap-3 px-4">
                      {canAssign ? (
                        <>
                          <Button
                            size="lg"
                            onClick={handleAssignToSelf}
                            disabled={isAssigning || isTransferringUnit}
                            className="w-full max-w-xs bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg text-base px-6 py-5"
                          >
                            {isAssigning ? (
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                            ) : (
                              <UserPlus className="h-5 w-5 mr-2" />
                            )}
                            Arızayı Üzerime Al
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setIsTransferDialogOpen(true)}
                            disabled={isAssigning || isTransferringUnit}
                            className="w-full max-w-xs border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 px-6 py-4"
                          >
                            {isTransferringUnit ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <ArrowRightLeft className="h-4 w-4 mr-2" />
                            )}
                            {fault.faultType === 'teknik_servis' ? 'Aplikasyon Birimine Aktar' : 'Teknik Servis Birimine Aktar'}
                          </Button>
                        </>
                      ) : (
                        <div className="text-center p-4 bg-white/80 dark:bg-black/80 rounded-lg">
                          <p className="text-sm text-muted-foreground">
                            Bu arıza <span className="font-semibold">{faultType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}</span> tipinde.
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Sadece {faultType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'} personeli bu arızayı üzerine alabilir.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {fault.openedAt && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Arıza {formatDistanceToNow(fault.openedAt, { addSuffix: true, locale: tr })} açıldı - Atama bekliyor
                    </p>
                  )}
                </div>
              );
            }

            // MÜDAHALE BEKLİYOR - Test seçimi ve müdahale tipi
            if (normalized === 'mudahale_bekliyor') {
              return (
                <div className="pt-4 border-t space-y-4">
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                    <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">Müdahale Tipi Seçin</p>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
                      Arızaya nasıl müdahale edeceğinizi seçin. Kurumda müdahale için konum doğrulaması gereklidir.
                    </p>

                    {/* Konum doğrulama (kurum ziyareti için) */}
                    <div className="mb-4 p-3 bg-white/50 dark:bg-black/20 rounded-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MapPin className={`h-4 w-4 ${locationVerified ? 'text-green-600' : 'text-muted-foreground'}`} />
                          <span className="text-sm">
                            {locationVerified ? 'Konum doğrulandı' : 'Konum doğrulanmadı'}
                          </span>
                        </div>
                        {!locationVerified && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleVerifyLocation}
                            disabled={isVerifyingLocation}
                          >
                            {isVerifyingLocation ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <Navigation className="h-4 w-4 mr-2" />
                            )}
                            Konumu Doğrula
                          </Button>
                        )}
                      </div>
                      {locationError && (
                        <p className="text-xs text-red-600 mt-2">{locationError}</p>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        variant="default"
                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                        onClick={() => openInterventionDialog('telefon')}
                        disabled={isStartingIntervention}
                      >
                        <Phone className="h-4 w-4 mr-2" /> Telefonla Destek Ver
                      </Button>
                      <Button
                        variant="default"
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={() => openInterventionDialog('kurum_ziyaret')}
                        disabled={isStartingIntervention || !locationVerified}
                      >
                        <MapPin className="h-4 w-4 mr-2" /> Kurumda Müdahale Et
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }

            // MÜDAHALE EDİLİYOR - Çözüm açıklaması ve kapat butonu
            if (normalized === 'mudahale_ediliyor') {
              return (
                <div className="pt-4 border-t space-y-4">
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Wrench className="h-4 w-4 text-blue-600" />
                      <span className="font-medium text-blue-800 dark:text-blue-200">
                        {fault.interventionType === 'telefon' ? 'Telefonla Destek Veriliyor' : 'Kurumda Müdahale Ediliyor'}
                      </span>
                    </div>

                    {fault.relatedTests && fault.relatedTests.length > 0 && (
                      <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
                        İlişkili testler: {fault.relatedTests.join(', ')}
                      </p>
                    )}

                    {fault.isEjectedKitFault ? (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button variant="destructive" size="sm" onClick={() => handleKitResolution('imha')} className="flex-1">
                          <Recycle className="h-4 w-4 mr-2" /> Kit İmhaya Gönderildi
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleKitResolution('tekrar_kullanim')} className="flex-1">
                          <CornerDownRight className="h-4 w-4 mr-2" /> Kit Tekrar Kullanılabildi
                        </Button>
                      </div>
                    ) : (
                      <Button variant="default" size="sm" onClick={() => setIsCloseDialogOpen(true)} className="w-full sm:w-auto">
                        <CheckCircle className="h-4 w-4 mr-2" /> Arızayı Çözüldü Olarak Kapat
                      </Button>
                    )}
                  </div>
                </div>
              );
            }

            // ÇÖZÜLDÜ - Çözüm bilgileri (düzenlenebilir)
            if (normalized === 'cozuldu') {
              const canEdit = isAdmin || fault.closedByUid === currentUser?.uid || fault.closedBy === currentUser?.uid || fault.assignedToUid === currentUser?.uid;
              return (
                <div className="pt-4 border-t space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      Çözüm Bilgileri
                    </p>
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={openEditResolved}>
                        <Edit3 className="h-4 w-4 mr-1" /> Düzenle
                      </Button>
                    )}
                  </div>
                  <div className="bg-green-50/50 dark:bg-green-950/20 border border-green-200/50 dark:border-green-800/50 rounded-lg p-4 space-y-3 text-sm">
                    <div>
                      <p className="font-medium text-muted-foreground">Çözüm Açıklaması</p>
                      <p className="whitespace-pre-wrap mt-1">{fault.closeDescription || '-'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="font-medium text-muted-foreground">Kapatan</p>
                        <p className="mt-1">{fault.closedByName || '-'}</p>
                        {fault.closedAt && (
                          <p className="text-xs text-muted-foreground">{format(fault.closedAt, 'dd.MM.yyyy HH:mm', { locale: tr })}</p>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-muted-foreground">Destek Personeli</p>
                        <p className="mt-1">{((fault as any).supportPersonnelNames?.join(', ')) || fault.supportPersonnelName || 'Belirtilmedi'}</p>
                      </div>
                    </div>
                    {fault.toplamCozumSuresi && (
                      <div>
                        <p className="font-medium text-muted-foreground">Toplam Çözüm Süresi</p>
                        <p className="mt-1">{Math.round(fault.toplamCozumSuresi / 60000)} dakika</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // Legacy 'open' status için eski davranış
            if (fault.status === 'open') {
              return (
                <div className="pt-4 border-t">
                  {fault.isEjectedKitFault ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button variant="destructive" size="sm" onClick={() => handleKitResolution('imha')} className="flex-1">
                        <Recycle className="h-4 w-4 mr-2" /> Kit İmhaya Gönderildi
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => handleKitResolution('tekrar_kullanim')} className="flex-1">
                        <CornerDownRight className="h-4 w-4 mr-2" /> Kit Tekrar Kullanılabildi
                      </Button>
                    </div>
                  ) : (
                    <Button variant="default" size="sm" onClick={() => setIsCloseDialogOpen(true)} className="w-full sm:w-auto">
                      <CheckCircle className="h-4 w-4 mr-2" /> Arızayı Kapat
                    </Button>
                  )}
                </div>
              );
            }

            return null;
          })()}

          {/* Yedek Parça Değişimleri */}
          {(() => {
            const normalized = normalizeStatus(fault.status);
            const isActiveIntervention = normalized === 'mudahale_ediliyor' || normalized === 'mudahale_bekliyor';
            // Çözülmüş arızalarda, sadece arızayı kapatan kişi sonradan parça ekleyebilir
            const isOwnClosedFault = normalized === 'cozuldu' && (
              fault.closedByUid === currentUser?.uid || fault.closedBy === currentUser?.uid ||
              fault.assignedToUid === currentUser?.uid
            );
            const showPartChange = isActiveIntervention || isOwnClosedFault;
            if (!showPartChange && faultPartChanges.length === 0) return null;

            return (
              <div className="space-y-3 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <p className="font-medium flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Yedek Parça Değişimleri
                    {faultPartChanges.length > 0 && (
                      <Badge variant="secondary">{faultPartChanges.length}</Badge>
                    )}
                  </p>
                  {showPartChange && (
                    <Button variant="outline" size="sm" onClick={openPartModal}>
                      <Plus className="h-4 w-4 mr-1" />
                      {isOwnClosedFault ? 'Sonradan Parça Ekle' : 'Parça Değişimi Ekle'}
                    </Button>
                  )}
                </div>
                {faultPartChanges.length > 0 ? (
                  <div className="space-y-2">
                    {faultPartChanges.map(pc => (
                      <div key={pc.id} className="p-3 border rounded-lg bg-muted/30 text-sm space-y-1">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">
                              Takılan: {pc.stokAdi} {pc.serialNumber && <span className="font-mono text-xs">({pc.serialNumber})</span>}
                            </p>
                            {pc.stokKodu && <p className="text-xs text-muted-foreground font-mono">{pc.stokKodu}</p>}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant={pc.isManualEntry ? 'outline' : 'secondary'} className="text-xs">
                              {pc.isManualEntry ? 'Manuel' : (pc as any).poolStockId ? 'Havuz Stok' : 'Stoktan'}
                            </Badge>
                            {(pc as any).isPostClosure && (
                              <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
                                Sonradan Eklendi
                              </Badge>
                            )}
                          </div>
                        </div>
                        {pc.removedPartSerialNumber && (
                          <p className="text-amber-700 dark:text-amber-400">
                            Çıkan: {pc.removedPartStokAdi || pc.stokAdi} <span className="font-mono text-xs">({pc.removedPartSerialNumber})</span>
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          {pc.removedPartImageUrl && (
                            <a href={pc.removedPartImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                              <Camera className="h-3 w-3" /> Çıkan Parça Foto
                            </a>
                          )}
                          {pc.usedPartImageUrl && (
                            <a href={pc.usedPartImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                              <Camera className="h-3 w-3" /> Takılan Parça Foto
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {pc.addedByName} - {pc.addedAt ? format(pc.addedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Henüz parça değişimi eklenmedi.</p>
                )}
              </div>
            );
          })()}

          {/* Hücre Değişimleri */}
          {(() => {
            const normalized = normalizeStatus(fault.status);
            const isActiveIntervention = normalized === 'mudahale_ediliyor' || normalized === 'mudahale_bekliyor';
            const isOwnClosedFault = normalized === 'cozuldu' && (
              fault.closedByUid === currentUser?.uid || fault.closedBy === currentUser?.uid || fault.assignedToUid === currentUser?.uid
            );
            const showHucreDegisimi = isActiveIntervention || isOwnClosedFault;
            if (!showHucreDegisimi && faultHucreDegisimleri.length === 0) return null;

            return (
              <div className="space-y-3 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <p className="font-medium flex items-center gap-2">
                    <Wrench className="h-4 w-4" />
                    Hücre Değişimleri
                    {faultHucreDegisimleri.length > 0 && (
                      <Badge variant="secondary">{faultHucreDegisimleri.length}</Badge>
                    )}
                  </p>
                  {showHucreDegisimi && (
                    <Button variant="outline" size="sm" onClick={() => setIsHucreDegisimiModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" />
                      Hücre Değişimi Ekle
                    </Button>
                  )}
                </div>
                {faultHucreDegisimleri.length > 0 ? (
                  <div className="space-y-2">
                    {faultHucreDegisimleri.map(hd => (
                      <div key={hd.id} className="p-3 border rounded-lg bg-muted/30 text-sm space-y-1">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{hd.stokAdi}</p>
                            <p className="text-xs font-mono text-muted-foreground">{hd.stokKodu}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span>Takılan: <span className="font-mono font-semibold" style={{ color: '#7C3AED' }}>H:{hd.hucreNumarasi}</span></span>
                          {hd.removedHucreNumarasi && (
                            <span>Çıkan: <span className="font-mono font-semibold text-amber-600">H:{hd.removedHucreNumarasi}</span></span>
                          )}
                        </div>
                        {hd.description && <p className="text-xs text-muted-foreground">{hd.description}</p>}
                        <p className="text-xs text-muted-foreground">
                          {hd.addedByName} - {hd.addedAt ? format(hd.addedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Henüz hücre değişimi eklenmedi.</p>
                )}
              </div>
            );
          })()}

          <div className="space-y-2 pt-4 border-t">
            <p className="font-medium">Arıza Geçmişi</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Tür</TableHead>
                  <TableHead>Kullanıcı</TableHead>
                  <TableHead>Açıklama</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(ev => (
                  <TableRow key={ev.id}>
                    <TableCell className="text-xs">{ev.timestamp ? format(ev.timestamp, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}</TableCell>
                    <TableCell className="capitalize">{ev.type.replace('_', ' ')}</TableCell>
                    <TableCell>{ev.actorName || '-'}</TableCell>
                    <TableCell className="whitespace-pre-wrap">
                      <div className="flex items-start justify-between">
                        <span>{ev.description || '-'}</span>
                        {ev.type === 'closed' && (isAdmin || fault.closedByUid === currentUser?.uid || fault.closedBy === currentUser?.uid || fault.assignedToUid === currentUser?.uid) && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditModal(ev)}>
                            <Edit3 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isCloseDialogOpen} onOpenChange={(open) => {
        setIsCloseDialogOpen(open);
        if (!open) {
          setSelectedSupportPersonnelUids([]);
          setPersonnelSearchQuery('');
        }
      }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Arızayı Kapat</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kapanış Açıklaması</label>
              <Textarea value={closeDescription} onChange={(e) => setCloseDescription(e.target.value)} placeholder="Yapılan işlem / değişen parça vb." />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Destek Personeli (İsteğe Bağlı)</label>
              <p className="text-xs text-muted-foreground">
                Arıza çözümünde destek veren personeli seçebilirsiniz. Seçilen personele destek puanı verilecektir.
              </p>
              <Input
                placeholder="Personel ara..."
                value={personnelSearchQuery}
                onChange={(e) => setPersonnelSearchQuery(e.target.value)}
              />
              <div className="max-h-52 overflow-y-auto border rounded-md">
                {allPersonnel
                  .filter(p => p.uid !== currentUser?.uid)
                  .filter(p => p.role === 'teknik_servis' || p.role === 'aplikasyon')
                  .filter(p => {
                    if (!personnelSearchQuery) return true;
                    const q = personnelSearchQuery.toLowerCase();
                    return (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
                  })
                  .map(p => {
                    const checked = selectedSupportPersonnelUids.includes(p.uid);
                    return (
                      <label key={p.uid} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setSelectedSupportPersonnelUids(prev => v ? [...prev, p.uid] : prev.filter(uid => uid !== p.uid));
                          }}
                        />
                        <span className="text-sm">{p.name || p.email} ({p.role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'})</span>
                      </label>
                    );
                  })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCloseDialogOpen(false)}>Vazgeç</Button>
            <Button onClick={handleClose}><CheckCircle className="h-4 w-4 mr-2" /> Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isEditHistoryModalOpen} onOpenChange={setIsEditHistoryModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Kapanış Notunu Düzenle</DialogTitle>
            </DialogHeader>
            <div className="py-4">
                <Textarea
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    placeholder="Yapılan işlem hakkında detay..."
                    rows={4}
                />
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={() => setIsEditHistoryModalOpen(false)}>İptal</Button>
                <Button onClick={handleSaveEdit} disabled={isSavingEdit}>
                    {isSavingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Kaydet
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Çözüm Bilgileri Düzenleme Dialog */}
      <Dialog open={isEditResolvedOpen} onOpenChange={setIsEditResolvedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Çözüm Bilgilerini Düzenle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Çözüm Açıklaması</label>
              <Textarea
                value={editCloseDescription}
                onChange={(e) => setEditCloseDescription(e.target.value)}
                placeholder="Yapılan işlem hakkında detay..."
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Destek Personeli</label>
              <p className="text-xs text-muted-foreground">
                Arıza çözümünde destek veren personeli değiştirebilirsiniz.
              </p>
              <Input
                placeholder="Personel ara..."
                value={editPersonnelSearchQuery}
                onChange={(e) => setEditPersonnelSearchQuery(e.target.value)}
              />
              <div className="max-h-52 overflow-y-auto border rounded-md">
                {allPersonnel
                  .filter(p => p.role === 'teknik_servis' || p.role === 'aplikasyon')
                  .filter(p => {
                    if (!editPersonnelSearchQuery) return true;
                    const q = editPersonnelSearchQuery.toLowerCase();
                    return (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
                  })
                  .map(p => {
                    const checked = editSupportPersonnelUids.includes(p.uid);
                    return (
                      <label key={p.uid} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setEditSupportPersonnelUids(prev => v ? [...prev, p.uid] : prev.filter(uid => uid !== p.uid));
                          }}
                        />
                        <span className="text-sm">{p.name || p.email} ({p.role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'})</span>
                      </label>
                    );
                  })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditResolvedOpen(false)}>İptal</Button>
            <Button onClick={handleSaveResolvedEdit} disabled={isSavingResolved}>
              {isSavingResolved ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hücre Değişimi Dialog */}
      <Dialog open={isHucreDegisimiModalOpen} onOpenChange={(open) => {
        if (!open) {
          setIsHucreDegisimiModalOpen(false);
          setHucreDegisimiSelectedItem(null);
          setHucreDegisimiRemovedHucre('');
          setHucreDegisimiDescription('');
          setHucreDegisimiSearchQuery('');
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Hücre Değişimi Ekle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Stok seçimi */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Hücre Numaralı Stok Seçimi</Label>
              <Input
                placeholder="Stok kodu, adı veya hücre numarası ile ara..."
                value={hucreDegisimiSearchQuery}
                onChange={(e) => setHucreDegisimiSearchQuery(e.target.value)}
              />
              <ScrollArea className="h-48 border rounded-md">
                <div className="p-2 space-y-1">
                  {(() => {
                    const hucreItems = personalStock.filter(p =>
                      p.hucreNumarasi && p.hucreNumarasi.trim() !== ''
                    );
                    const query = hucreDegisimiSearchQuery.toLowerCase().trim();
                    const filtered = query
                      ? hucreItems.filter(p =>
                          p.stokKodu.toLowerCase().includes(query) ||
                          p.stokAdi.toLowerCase().includes(query) ||
                          (p.hucreNumarasi || '').toLowerCase().includes(query)
                        )
                      : hucreItems;
                    if (filtered.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground p-2">
                          {hucreItems.length === 0
                            ? 'Stoğunuzda hücre numaralı ürün bulunmuyor.'
                            : 'Aramanızla eşleşen ürün bulunamadı.'}
                        </p>
                      );
                    }
                    return filtered.map(item => (
                      <div
                        key={item.id}
                        className={`p-2 rounded-md cursor-pointer text-sm transition-colors ${
                          hucreDegisimiSelectedItem?.id === item.id
                            ? 'bg-primary/10 border border-primary'
                            : 'hover:bg-muted'
                        }`}
                        onClick={() => setHucreDegisimiSelectedItem(item)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{item.stokAdi}</p>
                            <p className="text-xs text-muted-foreground font-mono">{item.stokKodu}</p>
                          </div>
                          <Badge variant="outline" style={{ color: '#7C3AED', borderColor: '#7C3AED' }} className="font-mono">
                            H:{item.hucreNumarasi}
                          </Badge>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </ScrollArea>
              {hucreDegisimiSelectedItem && (
                <p className="text-xs text-primary">
                  Seçilen: {hucreDegisimiSelectedItem.stokAdi} — <span className="font-mono" style={{ color: '#7C3AED' }}>H:{hucreDegisimiSelectedItem.hucreNumarasi}</span>
                </p>
              )}
            </div>

            {/* Çıkan hücre numarası */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Çıkan Hücre Numarası (Opsiyonel)</Label>
              <Input
                placeholder="Örn: A1234"
                value={hucreDegisimiRemovedHucre}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
                  setHucreDegisimiRemovedHucre(val);
                }}
                maxLength={5}
                className="font-mono"
              />
              {hucreDegisimiRemovedHucre && !/^[A-Za-z]\d{4}$/.test(hucreDegisimiRemovedHucre) && (
                <p className="text-xs text-destructive">Format: 1 harf + 4 rakam (Örn: A1234)</p>
              )}
            </div>

            {/* Açıklama */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Açıklama (Opsiyonel)</Label>
              <Input
                placeholder="Değişim ile ilgili açıklama..."
                value={hucreDegisimiDescription}
                onChange={(e) => setHucreDegisimiDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsHucreDegisimiModalOpen(false)}>İptal</Button>
            <Button
              onClick={addFaultHucreDegisimi}
              disabled={!hucreDegisimiSelectedItem || isSavingHucre}
            >
              {isSavingHucre ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Hücre Değişimi Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Seçimi ve Müdahale Başlatma Dialog */}
      <Dialog open={isTestDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsTestDialogOpen(false);
          setSelectedTests([]);
          setPendingInterventionType(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingInterventionType === 'telefon' ? 'Telefonla Destek' : 'Kurumda Müdahale'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <Label className="text-sm font-medium">İlişkili Testler (Opsiyonel)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Arızayla ilişkili testleri seçebilirsiniz. Bu bilgi istatistiklerde kullanılacaktır.
              </p>
              <ScrollArea className="h-48 border rounded-md p-2">
                <div className="space-y-2">
                  {availableTests.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Bu laboratuvar için test tanımı bulunmuyor.</p>
                  ) : (
                    availableTests.map(test => (
                      <div key={test} className="flex items-center space-x-2">
                        <Checkbox
                          id={`test-${test}`}
                          checked={selectedTests.includes(test)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedTests(prev => [...prev, test]);
                            } else {
                              setSelectedTests(prev => prev.filter(t => t !== test));
                            }
                          }}
                        />
                        <Label htmlFor={`test-${test}`} className="text-sm cursor-pointer">{test}</Label>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
              {selectedTests.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedTests.map(test => (
                    <Badge key={test} variant="secondary" className="text-xs">
                      {test}
                      <button
                        type="button"
                        onClick={() => setSelectedTests(prev => prev.filter(t => t !== test))}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => {
              setIsTestDialogOpen(false);
              setSelectedTests([]);
              setPendingInterventionType(null);
            }}>
              İptal
            </Button>
            <Button
              onClick={() => pendingInterventionType && handleStartIntervention(pendingInterventionType)}
              disabled={isStartingIntervention}
            >
              {isStartingIntervention ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {pendingInterventionType === 'telefon' ? (
                <><Phone className="h-4 w-4 mr-2" /> Telefonla Başlat</>
              ) : (
                <><MapPin className="h-4 w-4 mr-2" /> Kurumda Başlat</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kit Arızası için Ürün Test Bilgisi Dialog */}
      <Dialog open={isProductTestDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsProductTestDialogOpen(false);
          setSelectedTests([]);
          setPendingInterventionType(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingInterventionType === 'telefon' ? 'Telefonla Destek' : 'Kurumda Müdahale'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Kit/Ürün Bilgisi */}
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">İlişkili Ürün</p>
              <p className="font-medium">{fault?.productStokAdi}</p>
              <p className="text-sm text-muted-foreground font-mono">{fault?.productStokKodu}</p>
              {fault?.testCount && (
                <p className="text-sm mt-1">Test Sayısı: {fault.testCount}</p>
              )}
            </div>

            {/* Ürüne Bağlı Test Bilgisi */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">İlişkili Test</p>
              {productTestInfo ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-sm">
                    {productTestInfo}
                  </Badge>
                  <span className="text-xs text-muted-foreground">(Otomatik seçildi)</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Bu ürün için test tanımı bulunmuyor.</p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Bu bilgiler arıza istatistiklerinde kullanılacaktır.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => {
              setIsProductTestDialogOpen(false);
              setSelectedTests([]);
              setPendingInterventionType(null);
            }}>
              İptal
            </Button>
            <Button
              onClick={() => pendingInterventionType && handleStartIntervention(pendingInterventionType)}
              disabled={isStartingIntervention}
            >
              {isStartingIntervention ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {pendingInterventionType === 'telefon' ? (
                <><Phone className="h-4 w-4 mr-2" /> Telefonla Başlat</>
              ) : (
                <><MapPin className="h-4 w-4 mr-2" /> Kurumda Başlat</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Birim Aktarma Onay Dialog */}
      <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-blue-600" />
              Birim Aktarma
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="text-center flex-1">
                  <p className="text-xs text-muted-foreground mb-1">Mevcut Birim</p>
                  <Badge variant="outline" className="text-sm px-3 py-1">
                    {fault.faultType === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}
                  </Badge>
                </div>
                <ArrowRightLeft className="h-5 w-5 text-blue-500 flex-shrink-0" />
                <div className="text-center flex-1">
                  <p className="text-xs text-muted-foreground mb-1">Hedef Birim</p>
                  <Badge className="text-sm px-3 py-1 bg-blue-600 hover:bg-blue-600">
                    {fault.faultType === 'teknik_servis' ? 'Aplikasyon' : 'Teknik Servis'}
                  </Badge>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Bu arıza <span className="font-semibold">{fault.faultType === 'teknik_servis' ? 'Aplikasyon' : 'Teknik Servis'}</span> birimine aktarılacak. Aktarılan birim personeli arızayı üzerine alabilecektir.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsTransferDialogOpen(false)}>Vazgeç</Button>
            <Button
              onClick={async () => {
                await handleTransferToOtherUnit();
                setIsTransferDialogOpen(false);
              }}
              disabled={isTransferringUnit}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isTransferringUnit ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 mr-2" />
              )}
              Aktarımı Onayla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Yedek Parça Değişim Modal */}
      <Dialog open={isPartModalOpen} onOpenChange={(open) => {
        if (!open) resetPartModalState();
        setIsPartModalOpen(open);
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Yedek Parça Değişimi</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Section 1: Select part from personal stock or pool stock */}
            <div className="p-3 border rounded-lg bg-muted/30 space-y-3">
              <Label className="font-semibold">1. Parça Seçin</Label>

              {/* Stock source tabs */}
              {!showManualEntry && (
                <div className="flex gap-1 p-1 rounded-lg bg-muted border">
                  <button
                    onClick={() => { setStockSourceTab('personal'); setSelectedPoolStockItem(null); setSelectedDepotStockItem(null); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      stockSourceTab === 'personal'
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground'
                    }`}
                  >
                    <Package className="h-3 w-3 inline mr-1" />
                    Şahsi Stok ({personalStock.length})
                  </button>
                  <button
                    onClick={() => { setStockSourceTab('pool'); setSelectedStockItem(null); setSelectedDepotStockItem(null); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      stockSourceTab === 'pool'
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground'
                    }`}
                  >
                    <Package className="h-3 w-3 inline mr-1" />
                    Havuz Stok ({poolStockItems.length})
                  </button>
                  <button
                    onClick={() => { setStockSourceTab('depot'); setSelectedStockItem(null); setSelectedPoolStockItem(null); }}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      stockSourceTab === 'depot'
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground'
                    }`}
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
                  <ScrollArea className="h-40 border rounded-md bg-background">
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
                            onClick={() => selectPersonalStockItem(item)}
                            className={`w-full text-left p-2 rounded-md transition-colors ${
                              selectedStockItem?.id === item.id
                                ? 'bg-primary/10 border-primary border'
                                : 'hover:bg-muted'
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
                  <ScrollArea className="h-40 border rounded-md bg-background">
                    {filteredPoolStock.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        {poolStockItems.length === 0
                          ? 'Havuz depoda yedek parça bulunmuyor.'
                          : 'Sonuç bulunamadı.'}
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredPoolStock.map(item => (
                          <button
                            key={item.id}
                            onClick={() => selectPoolStockItem(item)}
                            className={`w-full text-left p-2 rounded-md transition-colors ${
                              selectedPoolStockItem?.id === item.id
                                ? 'bg-purple-500/10 border-purple-500 border'
                                : 'hover:bg-muted'
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
                  <ScrollArea className="h-40 border rounded-md bg-background">
                    {filteredDepotStock.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        {selectableDepotStock.length === 0 ? 'Depoda yedek parça bulunmuyor.' : 'Sonuç bulunamadı.'}
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredDepotStock.map(item => (
                          <button
                            key={`${item.id || item.stokKodu}-${item.serialNumber || item.hucreNumarasi || 'qty'}`}
                            onClick={() => handleDepotItemSelect(item)}
                            className={`w-full text-left p-2 rounded-md transition-colors ${
                              selectedDepotStockItem?.id === item.id && selectedDepotStockItem?.stokKodu === item.stokKodu
                                ? 'bg-orange-500/10 border-orange-500 border'
                                : 'hover:bg-muted'
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
                      <Label className="text-xs">Seri No</Label>
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

            {/* Section 2: Removed part info (from device) - opsiyonel */}
            <div className="p-3 border rounded-lg space-y-3 bg-muted/30">
              <Label className="font-semibold flex items-center gap-2">
                2. Cihazdan Çıkan Parça Bilgisi
                <span className="text-xs font-normal text-muted-foreground">(opsiyonel)</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Parça Kodu</Label>
                  <Input
                    placeholder={selectedStockItem?.stokKodu || selectedPoolStockItem?.stokKodu || manualPartCode || 'Kod...'}
                    value={removedPartStokKodu}
                    onChange={(e) => setRemovedPartStokKodu(e.target.value)}
                    className="h-9"
                  />
                  <p className="text-xs text-muted-foreground">Boş bırakılırsa yeni parça kodu kullanılır</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Seri No</Label>
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
                  placeholder={selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || manualPartName || 'Parça adı...'}
                  value={removedPartStokAdi}
                  onChange={(e) => setRemovedPartStokAdi(e.target.value)}
                  className="h-9"
                />
                <p className="text-xs text-muted-foreground">Boş bırakılırsa yeni parça adı kullanılır</p>
              </div>
              {/* Part images */}
              <div className="space-y-3 pt-2 border-t">
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
                          if (removedPartImageInputRef.current) removedPartImageInputRef.current.value = '';
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
                          if (usedPartImageInputRef.current) usedPartImageInputRef.current.value = '';
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
            {(selectedStockItem || selectedPoolStockItem || selectedDepotStockItem || (showManualEntry && manualPartCode && manualPartName)) && (
              <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-sm">
                <p className="font-medium text-green-800 dark:text-green-200">
                  Takılacak: {selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || selectedDepotStockItem?.stokAdi || manualPartName} ({selectedStockItem?.serialNumber || selectedPoolStockItem?.serialNumber || selectedDepotStockItem?.serialNumber || manualSerialNumber || (selectedDepotStockItem?.isGrouped ? `${selectedDepotStockItem.totalQuantity} adet` : 'Seri No Yok')})
                </p>
                {selectedPoolStockItem && (
                  <p className="text-purple-700 dark:text-purple-300 text-xs">
                    Kaynak: Havuz Stok - {selectedPoolStockItem.poolWarehouseName}
                  </p>
                )}
                {selectedDepotStockItem && (
                  <p className="text-orange-700 dark:text-orange-300 text-xs">
                    Kaynak: Depo Stok {selectedDepotStockItem.isGrouped ? `- ${selectedDepotStockItem.totalQuantity} adet` : ''}
                  </p>
                )}
                {removedPartSerialNumber && (
                  <p className="text-green-700 dark:text-green-300">
                    Çıkacak: {removedPartStokAdi || selectedStockItem?.stokAdi || selectedPoolStockItem?.stokAdi || selectedDepotStockItem?.stokAdi || manualPartName} ({removedPartSerialNumber})
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPartModalOpen(false)}>İptal</Button>
            <Button
              onClick={addFaultPartChange}
              disabled={
                (!selectedStockItem && !selectedPoolStockItem && !selectedDepotStockItem && !(showManualEntry && manualPartCode && manualPartName))
                || isSavingPart
                || isUploadingImage
              }
            >
              {isSavingPart ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Kaydediliyor...</> : 'Ekle'}
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
    </div>
  );
}
