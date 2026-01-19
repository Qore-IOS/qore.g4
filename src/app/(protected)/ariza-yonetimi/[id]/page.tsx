

'use client';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, orderBy, onSnapshot, updateDoc, serverTimestamp, getDocs, where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle, ArrowLeft, Clock, FileDown, Share2, Edit3, Loader2, MoreVertical, Sun, Moon, Recycle, CornerDownRight, UserPlus, Phone, MapPin, Wrench, Navigation, X } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format, differenceInMinutes, formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { closeDeviceFaultReport, resolveEjectedKitFault, assignFaultToSelf, startIntervention, verifyLocationForIntervention } from '@/lib/faults';
import { useAuth } from '@/contexts/auth-context';
import type { Device, DeviceFaultReport, DeviceFaultStatus, InterventionType, ProductCode } from '@/lib/types';
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
    if (availableTests.length > 0) {
      setIsTestDialogOpen(true);
    } else {
      // Test yoksa direkt müdahale başlat
      handleStartIntervention(type);
    }
  };

  const handleClose = useCallback(async () => {
    if (!fault) return;
    try {
      await closeDeviceFaultReport(fault.id, {
        closedByUid: currentUser?.uid || '',
        closedByName: currentUserProfile?.name || '',
        closeDescription,
      });
      setIsCloseDialogOpen(false);
      setCloseDescription('');
      toast({ title: 'Arıza Kapatıldı', description: `#${fault.id} kapatıldı.` });
    } catch (e) {
      console.error(e);
      toast({ title: 'Hata', description: 'Arıza kapatılamadı.', variant: 'destructive' });
    }
  }, [fault, closeDescription, currentUser, currentUserProfile, toast]);

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
    <div className="p-4 space-y-4">
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
                    <div className="absolute inset-0 z-20 flex items-center justify-center">
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

      <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Arızayı Kapat</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="text-sm font-medium">Kapanış Açıklaması</label>
            <Textarea value={closeDescription} onChange={(e) => setCloseDescription(e.target.value)} placeholder="Yapılan işlem / değişen parça vb." />
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
    </div>
  );
}
