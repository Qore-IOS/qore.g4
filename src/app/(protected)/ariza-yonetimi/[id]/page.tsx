

'use client';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, orderBy, onSnapshot, updateDoc, serverTimestamp, getDocs, where, addDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle, ArrowLeft, Clock, FileDown, Share2, Edit3, Loader2, MoreVertical, Sun, Moon, Recycle, CornerDownRight, UserPlus, Phone, MapPin, Wrench, Navigation, X, Search, Plus, Camera, ImageIcon, Package, Trash2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format, differenceInMinutes, formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { closeDeviceFaultReport, resolveEjectedKitFault, assignFaultToSelf, startIntervention, verifyLocationForIntervention } from '@/lib/faults';
import { useAuth } from '@/contexts/auth-context';
import type { Device, DeviceFaultReport, DeviceFaultStatus, InterventionType, ProductCode, User, PersonalStockItem } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
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

type FaultPartChange = {
  id: string;
  stokKodu?: string;
  stokAdi?: string;
  serialNumber?: string;
  personalStockId?: string;
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

  // Yeni atama sistemi state'leri
  const [isAssigning, setIsAssigning] = useState(false);
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
  const [selectedSupportPersonnelUid, setSelectedSupportPersonnelUid] = useState<string>('');
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState('');

  // Yedek parça değişim state'leri
  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [personalStock, setPersonalStock] = useState<PersonalStockItem[]>([]);
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const [selectedStockItem, setSelectedStockItem] = useState<PersonalStockItem | null>(null);
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
  const [isSavingPart, setIsSavingPart] = useState(false);


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

  // Konum doğrulama durumunu kontrol et
  useEffect(() => {
    if (fault?.locationVerifiedAt) {
      setLocationVerified(true);
    }
  }, [fault?.locationVerifiedAt]);

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
    try {
      const supportPerson = selectedSupportPersonnelUid
        ? allPersonnel.find(p => p.uid === selectedSupportPersonnelUid)
        : null;

      await closeDeviceFaultReport(fault.id, {
        closedByUid: currentUser?.uid || '',
        closedByName: currentUserProfile?.name || '',
        closeDescription,
        supportPersonnel: supportPerson ? { uid: supportPerson.uid, name: supportPerson.name || '' } : null,
      });
      setIsCloseDialogOpen(false);
      setCloseDescription('');
      setSelectedSupportPersonnelUid('');
      toast({ title: 'Arıza Kapatıldı', description: `#${fault.id} kapatıldı.` });
    } catch (e) {
      console.error(e);
      toast({ title: 'Hata', description: 'Arıza kapatılamadı.', variant: 'destructive' });
    }
  }, [fault, closeDescription, currentUser, currentUserProfile, toast, selectedSupportPersonnelUid, allPersonnel]);

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

  const addFaultPartChange = async () => {
    if (!fault || !currentUser) return;
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

      const partChangeData: any = {
        stokKodu: selectedStockItem?.stokKodu || manualPartCode.trim(),
        stokAdi: selectedStockItem?.stokAdi || manualPartName.trim(),
        serialNumber: selectedStockItem?.serialNumber || manualSerialNumber.trim(),
        personalStockId: selectedStockItem?.id || null,
        isManualEntry: !selectedStockItem,
        removedPartStokKodu: removedPartStokKodu.trim() || selectedStockItem?.stokKodu || manualPartCode.trim(),
        removedPartStokAdi: removedPartStokAdi.trim() || selectedStockItem?.stokAdi || manualPartName.trim(),
        removedPartSerialNumber: removedPartSerialNumber.trim() || null,
        removedPartImageUrl: removedImgUrl || null,
        usedPartImageUrl: usedImgUrl || null,
        addedAt: Timestamp.fromDate(now),
        addedByUid: currentUser.uid,
        addedByName: currentUserProfile?.name || 'Bilinmeyen',
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

      // If removed part has serial number, create personal stock entry for removed part
      if (removedPartSerialNumber.trim()) {
        const removedStockRef = doc(collection(db, 'personalStock'));
        batch.set(removedStockRef, {
          ownerUid: currentUser.uid,
          ownerName: currentUserProfile?.name || '',
          productCodeId: null,
          stokKodu: removedPartStokKodu.trim() || selectedStockItem?.stokKodu || manualPartCode.trim(),
          stokAdi: removedPartStokAdi.trim() || selectedStockItem?.stokAdi || manualPartName.trim(),
          serialNumber: removedPartSerialNumber.trim(),
          imageUrl: removedImgUrl || null,
          source: 'device',
          sourceDeviceId: fault.deviceId,
          sourceDeviceName: fault.model || '',
          status: 'in_stock',
          createdAt: Timestamp.fromDate(now),
          replacedPartId: selectedStockItem?.id || null,
        });
      }

      // Add history entry for part change
      const historyRef = doc(collection(db, 'deviceFaultReports', fault.id, 'history'));
      batch.set(historyRef, {
        type: 'note',
        actorUid: currentUser.uid,
        actorName: currentUserProfile?.name || 'Bilinmeyen',
        description: `Parça değişimi: ${partChangeData.stokAdi} (${partChangeData.serialNumber || 'Seri No Yok'})${removedPartSerialNumber.trim() ? ` → Çıkan: ${partChangeData.removedPartStokAdi} (${removedPartSerialNumber.trim()})` : ''}`,
        timestamp: Timestamp.fromDate(now),
      });

      await batch.commit();

      toast({ title: 'Başarılı', description: 'Parça değişimi eklendi.' });
      resetPartModalState();
      setIsPartModalOpen(false);
    } catch (e: any) {
      console.error('Part change error:', e);
      toast({ title: 'Hata', description: e.message || 'Parça değişimi eklenemedi.', variant: 'destructive' });
    } finally {
      setIsSavingPart(false);
    }
  };

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
    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(`Arıza Raporu: #${fault.id}`, 14, 22);

    let yPos = 30;

    if (device?.imageUrl) {
        try {
            const response = await fetch(`/${device.imageUrl}`);
            const blob = await response.blob();
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const base64data = reader.result;
                doc.addImage(base64data as string, 'PNG', 14, yPos, 40, 40);
                addPdfContent(doc, yPos + 50);
            };
        } catch (e) {
            console.error("PDF image load error:", e);
            addPdfContent(doc, yPos);
        }
    } else {
        addPdfContent(doc, yPos);
    }
  };

  const addPdfContent = (doc: jsPDF, startY: number) => {
    if (!fault) return;

    let y = startY;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    
    doc.text(`Laboratuvar: ${fault.labName}`, 14, y); y += 7;
    doc.text(`Cihaz: ${fault.model} (SN: ${fault.serial})`, 14, y); y += 7;
    doc.text(`Arıza Tipi: ${fault.faultType?.replace('_',' ')}`, 14, y); y += 7;
    doc.text(`Durum: ${fault.status === 'open' ? 'Açık' : 'Giderildi'}`, 14, y); y += 10;
    
    doc.text(`Açan: ${fault.openedByName} - ${fault.openedAt ? format(fault.openedAt, 'dd.MM.yyyy HH:mm', {locale: tr}) : ''}`, 14, y); y += 7;
    if (fault.status === 'closed') {
        doc.text(`Kapatan: ${fault.closedByName} - ${fault.closedAt ? format(fault.closedAt, 'dd.MM.yyyy HH:mm', {locale: tr}) : ''}`, 14, y); y += 7;
        if(resolutionTime !== null) doc.text(`Çözüm Süresi: ${resolutionTime} dakika`, 14, y); y += 7;
    }
    y+= 5;
    
    (doc as any).autoTable({
        startY: y,
        head: [['Tarih', 'Tür', 'Kullanıcı', 'Açıklama']],
        body: history.map(ev => [
            ev.timestamp ? format(ev.timestamp, 'dd.MM.yy HH:mm', { locale: tr }) : '-',
            ev.type.replace('_', ' '),
            ev.actorName || '-',
            ev.description || '-'
        ]),
        styles: { font: 'helvetica', fontSize: 10 },
        headStyles: { fillColor: [220, 220, 220] }
    });

    doc.save(`Ariza_Raporu_${fault.id}.pdf`);
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
                    src={`/${device.imageUrl}`}
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
            
          {/* Yeni Arıza Akış Sistemi */}
          {(() => {
            const normalized = normalizeStatus(fault.status);

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

                    {/* Arıza önizlemesi (bulanık) */}
                    <div className="p-4 opacity-50">
                      <p className="text-sm text-muted-foreground">{fault.description}</p>
                    </div>

                    {/* Üzerime Ata butonu */}
                    <div className="absolute inset-0 z-20 flex items-center justify-center flex-col gap-2">
                      {canAssign ? (
                        <Button
                          size="lg"
                          onClick={handleAssignToSelf}
                          disabled={isAssigning}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg text-lg px-8 py-6"
                        >
                          {isAssigning ? (
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          ) : (
                            <UserPlus className="h-5 w-5 mr-2" />
                          )}
                          Arızayı Üzerime Al
                        </Button>
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
            const showPartChange = normalized === 'mudahale_ediliyor' || normalized === 'mudahale_bekliyor';
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
                      Parça Değişimi Ekle
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
                          <Badge variant={pc.isManualEntry ? 'outline' : 'secondary'} className="text-xs">
                            {pc.isManualEntry ? 'Manuel' : 'Stoktan'}
                          </Badge>
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
                        {ev.type === 'closed' && isAdmin && (
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
          setSelectedSupportPersonnelUid('');
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
              <Select value={selectedSupportPersonnelUid} onValueChange={setSelectedSupportPersonnelUid}>
                <SelectTrigger>
                  <SelectValue placeholder="Destek personeli seçin..." />
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Personel ara..."
                      value={personnelSearchQuery}
                      onChange={(e) => setPersonnelSearchQuery(e.target.value)}
                      className="mb-2"
                    />
                  </div>
                  <SelectItem value="none">Seçim Yok</SelectItem>
                  {allPersonnel
                    .filter(p => p.uid !== currentUser?.uid) // Kendisini gösterme
                    .filter(p => {
                      // Arıza tipine göre personel filtrele
                      if (fault?.faultType === 'teknik_servis') {
                        return p.role === 'teknik_servis';
                      } else if (fault?.faultType === 'aplikasyon') {
                        return p.role === 'aplikasyon';
                      }
                      return true;
                    })
                    .filter(p => {
                      if (!personnelSearchQuery) return true;
                      const q = personnelSearchQuery.toLowerCase();
                      return (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
                    })
                    .map(p => (
                      <SelectItem key={p.uid} value={p.uid}>
                        {p.name || p.email} ({p.role === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
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
            {/* Section 1: Select part from personal stock */}
            <div className="p-3 border rounded-lg bg-muted/30 space-y-3">
              <Label className="font-semibold">1. Şahsi Stokunuzdan Parça Seçin</Label>
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
                            onClick={() => setSelectedStockItem(item)}
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
              )}
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
                    placeholder={selectedStockItem?.stokKodu || manualPartCode || 'Kod...'}
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
                  placeholder={selectedStockItem?.stokAdi || manualPartName || 'Parça adı...'}
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
            {(selectedStockItem || (showManualEntry && manualPartCode && manualPartName)) && (
              <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-sm">
                <p className="font-medium text-green-800 dark:text-green-200">
                  Takılacak: {selectedStockItem?.stokAdi || manualPartName} ({selectedStockItem?.serialNumber || manualSerialNumber || 'Seri No Yok'})
                </p>
                {removedPartSerialNumber && (
                  <p className="text-green-700 dark:text-green-300">
                    Çıkacak: {removedPartStokAdi || selectedStockItem?.stokAdi || manualPartName} ({removedPartSerialNumber})
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
                (!selectedStockItem && !(showManualEntry && manualPartCode && manualPartName))
                || isSavingPart
                || isUploadingImage
              }
            >
              {isSavingPart ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Kaydediliyor...</> : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
