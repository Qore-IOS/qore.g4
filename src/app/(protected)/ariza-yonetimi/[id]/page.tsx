

'use client';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, orderBy, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle, ArrowLeft, Clock, FileDown, Share2, Edit3, Loader2, MoreVertical, Sun, Moon, Recycle, CornerDownRight } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format, differenceInMinutes } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { closeDeviceFaultReport, resolveEjectedKitFault } from '@/lib/faults';
import { useAuth } from '@/contexts/auth-context';
import type { Device, DeviceFaultReport } from '@/lib/types';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from 'next-themes';


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

  const resolutionTime = useMemo(() => {
    if (fault?.status === 'closed' && fault.openedAt && fault.closedAt) {
      return differenceInMinutes(fault.closedAt, fault.openedAt);
    }
    return null;
  }, [fault]);

  const statusBadge = useMemo(() => {
    if (!fault) return null;
    if (fault.status === 'open') {
      return <Badge className="bg-destructive/15 text-destructive border border-destructive/20"><AlertTriangle className="h-3 w-3 mr-1" />Açık</Badge>;
    }
    return (
      <div className="flex items-center gap-2">
        <Badge className="bg-green-600/10 text-green-700 dark:text-green-400 border border-green-600/20"><CheckCircle className="h-3 w-3 mr-1" />Giderildi</Badge>
        {resolutionTime !== null && (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {resolutionTime} dk
          </Badge>
        )}
      </div>
    );
  }, [fault, resolutionTime]);

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
            
          {fault.status === 'open' && (
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
           )}

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
    </div>
  );
}
