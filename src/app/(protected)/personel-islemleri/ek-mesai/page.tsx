'use client';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Trash2, Save, Loader2, Clock, History, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, writeBatch, doc, onSnapshot, orderBy, Timestamp, updateDoc } from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import BackButton from '@/components/BackButton';
import { format, differenceInMinutes, isValid } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { tr } from 'date-fns/locale';


interface OvertimeEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
}

interface OvertimeRequest {
    id: string;
    userId: string;
    userName: string;
    period: string;
    entries: OvertimeEntry[];
    totalMinutes: number;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: Timestamp;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));

// Helper function to sanitize text for PDF fonts that may not support all Turkish characters
function sanitizeForPdfFont(str: string | null | undefined): string {
  if (!str) return '';
  return str
      .replace(/İ/g, 'I').replace(/ı/g, 'i')
      .replace(/Ş/g, 'S').replace(/ş/g, 's')
      .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
      .replace(/Ü/g, 'U').replace(/ü/g, 'u')
      .replace(/Ö/g, 'O').replace(/ö/g, 'o')
      .replace(/Ç/g, 'C').replace(/ç/g, 'c');
}

export default function EkMesaiBildirimPage() {
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [entries, setEntries] = useState<OvertimeEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyRequests, setHistoryRequests] = useState<OvertimeRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const generatePdfTutanak = (request: OvertimeRequest) => {
    const doc = new jsPDF();
    const FONT_FAMILY = 'helvetica';
    const totalHours = Math.floor(request.totalMinutes / 60);
    const remainingMinutes = request.totalMinutes % 60;

    doc.setFont(FONT_FAMILY, 'bold');
    doc.setFontSize(18);
    doc.text(sanitizeForPdfFont('Ek Mesai Bildirim Tutanağı'), 14, 22);

    doc.setFontSize(11);
    doc.setFont(FONT_FAMILY, 'normal');
    doc.text(sanitizeForPdfFont(`Personel: ${request.userName}`), 14, 40);
    doc.text(sanitizeForPdfFont(`Dönem: ${request.period}`), 14, 50);
    doc.text(sanitizeForPdfFont(`Toplam Süre: ${totalHours} saat ${remainingMinutes} dakika`), 14, 60);
    doc.text(sanitizeForPdfFont(`Durum: ${request.status === 'approved' ? 'Onaylandı' : request.status === 'rejected' ? 'Reddedildi' : 'Beklemede'}`), 14, 70);

    const tableColumn = [
      sanitizeForPdfFont('Tarih'), 
      sanitizeForPdfFont('Başlangıç'), 
      sanitizeForPdfFont('Bitiş'), 
      sanitizeForPdfFont('Açıklama')
    ];
    const tableRows: (string | number)[][] = [];

    request.entries.forEach(entry => {
        const row = [
            format(new Date(entry.date), 'dd.MM.yyyy'),
            entry.startTime,
            entry.endTime,
            sanitizeForPdfFont(entry.description)
        ];
        tableRows.push(row);
    });

    autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 80,
        theme: 'grid',
        styles: { font: FONT_FAMILY, halign: 'left', fontSize: 10 },
        headStyles: { fillColor: [22, 160, 133], fontStyle: 'bold' },
    });
    
    doc.save(`EkMesai_${request.userName.replace(' ','_')}_${request.period.replace('/','-')}.pdf`);
  };


  const addNewEntry = () => {
    setEntries(prev => [...prev, {
      id: crypto.randomUUID(),
      date: '',
      startTime: '',
      endTime: '',
      description: '',
    }]);
  };
  
  const removeEntry = (id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };
  
  const handleEntryChange = (id: string, field: keyof Omit<OvertimeEntry, 'id'>, value: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const totalMinutes = useMemo(() => {
    return entries.reduce((total, entry) => {
      if (entry.date && entry.startTime && entry.endTime) {
        const start = new Date(`${entry.date}T${entry.startTime}`);
        const end = new Date(`${entry.date}T${entry.endTime}`);
        if (isValid(start) && isValid(end) && end > start) {
          return total + differenceInMinutes(end, start);
        }
      }
      return total;
    }, 0);
  }, [entries]);

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  const handleSubmit = async () => {
    if (!currentUser || !currentUserProfile) {
      toast({ title: 'Hata', description: 'Kullanıcı bilgisi bulunamadı. Lütfen tekrar giriş yapın.', variant: 'destructive' });
      return;
    }
    if (entries.some(e => !e.date || !e.startTime || !e.endTime)) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tüm tarih ve saat alanlarını doldurun.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const period = `${String(selectedMonth + 1).padStart(2, '0')}/${selectedYear}`;
      const requestsRef = collection(db, 'overtimeRequests');
      const q = scopedQuery(
        'overtimeRequests',
        currentCompanyId,
        isSuperAdmin,
        where('userId', '==', currentUser.uid),
        where('period', '==', period),
        where('status', '==', 'pending')
      );

      const querySnapshot = await getDocsResilient(q);

      if (!querySnapshot.empty) {
        const existingDoc = querySnapshot.docs[0];
        const existingData = existingDoc.data();
        const combinedEntries = [...existingData.entries, ...entries];
        
        const newTotalMinutes = combinedEntries.reduce((total: number, entry: OvertimeEntry) => {
          if (entry.date && entry.startTime && entry.endTime) {
            const start = new Date(`${entry.date}T${entry.startTime}`);
            const end = new Date(`${entry.date}T${entry.endTime}`);
            if (isValid(start) && isValid(end) && end > start) {
              return total + differenceInMinutes(end, start);
            }
          }
          return total;
        }, 0);

        await updateDoc(doc(db, 'overtimeRequests', existingDoc.id), {
            entries: combinedEntries,
            totalMinutes: newTotalMinutes,
            updatedAt: serverTimestamp(),
        });

        toast({ title: 'Güncellendi', description: 'Mevcut ek mesai talebinize yeni girişler eklendi.' });
      } else {
        await addDoc(requestsRef, withCompanyScope({
          userId: currentUser.uid,
          userName: currentUserProfile.name,
          period: period,
          entries: entries,
          totalMinutes: totalMinutes,
          status: 'pending',
          createdAt: serverTimestamp(),
        }, currentCompanyId));
        toast({ title: 'Başarılı', description: 'Ek mesai talebiniz yönetici onayına gönderildi.' });
      }
      
      setEntries([]);
    } catch (error) {
      console.error('Error submitting overtime request:', error);
      toast({ title: 'Hata', description: 'Talep gönderilirken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };
  
  const openHistoryModal = useCallback(async () => {
    if (!currentUser) return;
    setHistoryLoading(true);
    setIsHistoryOpen(true);
    try {
        const q = scopedQuery('overtimeRequests', currentCompanyId, isSuperAdmin, where('userId', '==', currentUser.uid));
        const snap = await getDocsResilient(q);
        const data = snap.docs.map(d => ({id: d.id, ...d.data()} as OvertimeRequest));
        // Sort client-side
        data.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
        setHistoryRequests(data);
    } catch (error) {
        console.error("Error fetching history:", error);
        toast({ title: "Geçmiş Yüklenemedi", description: "Talepleriniz alınırken bir hata oluştu.", variant: 'destructive' });
    } finally {
        setHistoryLoading(false);
    }
  }, [currentUser, toast]);


  return (
    <>
      <div className="p-6 space-y-6">
        <BackButton fallback="/personel-islemleri" />
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2 text-2xl font-headline">
                    <Clock className="h-6 w-6" /> Ek Mesai Bildirimi
                </CardTitle>
                <Button variant="outline" onClick={openHistoryModal}>
                    <History className="h-4 w-4 mr-2" /> Geçmiş Taleplerim
                </Button>
            </div>
            <CardDescription>İlgili dönem için yaptığınız ek mesaileri girin ve onaya gönderin.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <label className="text-sm font-medium">Dönem Ayı</label>
                <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Dönem Yılı</label>
                <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={addNewEntry} className="w-full"><PlusCircle className="mr-2 h-4 w-4" /> Satır Ekle</Button>
              </div>
            </div>
            
            <ScrollArea className="h-64 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">Tarih</TableHead>
                    <TableHead className="w-[120px]">Başlangıç</TableHead>
                    <TableHead className="w-[120px]">Bitiş</TableHead>
                    <TableHead>Açıklama</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center h-24">Ek mesai satırı ekleyin.</TableCell></TableRow>
                  ) : (
                    entries.map(entry => (
                      <TableRow key={entry.id}>
                        <TableCell><Input type="date" value={entry.date} onChange={e => handleEntryChange(entry.id, 'date', e.target.value)} /></TableCell>
                        <TableCell><Input type="time" value={entry.startTime} onChange={e => handleEntryChange(entry.id, 'startTime', e.target.value)} /></TableCell>
                        <TableCell><Input type="time" value={entry.endTime} onChange={e => handleEntryChange(entry.id, 'endTime', e.target.value)} /></TableCell>
                        <TableCell><Input placeholder="Yapılan iş..." value={entry.description} onChange={e => handleEntryChange(entry.id, 'description', e.target.value)} /></TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeEntry(entry.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
          <CardFooter className="flex justify-between items-center">
            <div className="text-lg font-bold">
              Toplam Mesai: {totalHours} saat {remainingMinutes} dakika
            </div>
            <Button onClick={handleSubmit} disabled={loading || entries.length === 0}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Kaydet ve Onaya Gönder
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-4xl">
            <DialogHeader>
                <DialogTitle>Ek Mesai Geçmişi</DialogTitle>
                <DialogDescription>Daha önce gönderdiğiniz talepler ve durumları.</DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto">
                {historyLoading ? <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin"/></div> :
                 historyRequests.length === 0 ? <p className="text-center text-muted-foreground p-8">Geçmiş talep bulunmuyor.</p> : (
                    <Accordion type="single" collapsible className="w-full">
                        {historyRequests.map(req => {
                            const totalHours = Math.floor(req.totalMinutes / 60);
                            const remainingMinutes = req.totalMinutes % 60;
                            const statusVariant = {
                                pending: 'secondary',
                                approved: 'default',
                                rejected: 'destructive',
                            } as const;
                             const statusText = {
                                pending: 'Beklemede',
                                approved: 'Onaylandı',
                                rejected: 'Reddedildi',
                            };
                            return (
                                <AccordionItem value={req.id} key={req.id}>
                                    <AccordionTrigger>
                                        <div className="flex justify-between items-center w-full pr-4">
                                            <span className="font-medium">{req.period}</span>
                                            <span>{totalHours} sa {remainingMinutes} dk</span>
                                            <Badge variant={statusVariant[req.status]}>{statusText[req.status]}</Badge>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <div className="flex justify-end mb-2">
                                            <Button size="sm" variant="outline" onClick={() => generatePdfTutanak(req)}>
                                                <FileText className="h-4 w-4 mr-2" /> PDF Tutanak
                                            </Button>
                                        </div>
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Tarih</TableHead>
                                                    <TableHead>Başlangıç</TableHead>
                                                    <TableHead>Bitiş</TableHead>
                                                    <TableHead>Açıklama</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {req.entries.map(entry => (
                                                    <TableRow key={entry.id}>
                                                        <TableCell>{entry.date ? format(new Date(entry.date), 'dd.MM.yyyy') : '-'}</TableCell>
                                                        <TableCell>{entry.startTime}</TableCell>
                                                        <TableCell>{entry.endTime}</TableCell>
                                                        <TableCell>{entry.description}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </AccordionContent>
                                </AccordionItem>
                            )
                        })}
                    </Accordion>
                )}
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button variant="outline">Kapat</Button>
                </DialogClose>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
