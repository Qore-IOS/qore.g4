'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Download, Save, PlusCircle, Trash2, Loader2, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { exportDataToExcel, readExcelData } from '@/lib/utils';
import { format, parse } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';


type ExpenseCategory =
  | 'Ulaşım'
  | 'Yakıt'
  | 'Yemek'
  | 'Temsil'
  | 'Otel'
  | 'Diğerleri';

type ExpenseRow = {
  id: string;
  tarih: string;       // 'dd.MM.yyyy'
  fisNo: string;
  kdv: number;         // percentage (e.g., 10, 20)
  aciklama: string;
  kategori: ExpenseCategory | '';
  fiyat: number;       // TL
};

type ExpensePeriod = {
  id: string;
  month: number;       // 0 - 11
  year: number;        // e.g. 2025
  ownerUid: string;
  ownerName: string;
  createdAt: any;
  updatedAt: any;
  status: 'pending' | 'approved' | 'rejected';
  total: number;
  receipts: ExpenseRow[];
};

const CATEGORIES: ExpenseCategory[] = ['Ulaşım','Yakıt','Yemek','Temsil','Otel','Diğerleri'];
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i, label: format(new Date(2000, i, 1), 'LLLL', { locale: tr }) }));

export default function MasrafYonetimiPanel() {
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [month, setMonth] = useState<number>(new Date().getMonth());
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyRequests, setHistoryRequests] = useState<ExpensePeriod[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const total = useMemo(() => {
    return rows.reduce((acc, r) => acc + (Number(r.fiyat) || 0), 0);
  }, [rows]);

  const periodId = useMemo(() => `${year}-${String(month + 1).padStart(2,'0')}-${currentUser?.uid ?? 'unknown'}`, [year, month, currentUser?.uid]);

  const addEmptyRow = () => {
    setRows(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        tarih: format(new Date(), 'dd.MM.yyyy'),
        fisNo: '',
        kdv: 20,
        aciklama: '',
        kategori: '',
        fiyat: 0,
      },
    ]);
  };

  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

  const updateRow = (id: string, patch: Partial<ExpenseRow>) =>
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const handleExcelExport = () => {
    const data = rows.map(r => ({
      'Tarih': r.tarih,
      'FİŞ NO': r.fisNo,
      'KDV (%)': r.kdv,
      'Açıklama': r.aciklama,
      'Kategori': r.kategori || '',
      'Fiyat': r.fiyat,
    }));
    exportDataToExcel(data, `MASRAF_${String(month+1).padStart(2,'0')}_${year}.xlsx`, "Masraflar", toast);
  };

  const handleExcelImport = async (file: File) => {
    setIsImporting(true);
    try {
      const parsed = await readExcelData(file, toast);
      const nextRows: ExpenseRow[] = parsed.map((row: any) => ({
        id: crypto.randomUUID(),
        tarih: normalizeDate(String(row['Tarih'] ?? '')),
        fisNo: String(row['FİŞ NO'] ?? ''),
        kdv: Number(row['KDV (%)'] ?? 0),
        aciklama: String(row['Açıklama'] ?? ''),
        kategori: (String(row['Kategori'] ?? '') as ExpenseCategory) || '',
        fiyat: Number(row['Fiyat'] ?? 0),
      }));
      setRows(prev => [...prev, ...nextRows]);
      toast({ title: 'Excel İçe Aktarıldı', description: `${nextRows.length} satır eklendi.` });
    } catch (e:any) {
      console.error(e);
      toast({ title: 'Excel Hatası', description: e?.message ?? 'Dosya okunamadı.', variant: 'destructive' });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  function normalizeDate(input: string): string {
    if (!input) return '';
    try {
      const tryParse = parse(input, 'dd.MM.yyyy', new Date());
      if (!isNaN(tryParse.getTime())) return format(tryParse, 'dd.MM.yyyy');
      const safe = new Date(input);
      return isNaN(safe.getTime()) ? '' : format(safe, 'dd.MM.yyyy');
    } catch {
      return '';
    }
  }

  const saveToFirestore = async () => {
    if (!currentUser?.uid) {
      toast({ title: 'Oturum Yok', description: 'Lütfen tekrar giriş yapın.', variant: 'destructive' });
      return;
    }
    if (rows.length === 0) {
      toast({ title: 'Boş Kayıt', description: 'Kaydetmeden önce en az bir fiş ekleyin.' });
      return;
    }
    setIsSaving(true);
    try {
      const periodDoc: Omit<ExpensePeriod, 'id' | 'receipts'> = {
        month,
        year,
        ownerUid: currentUser.uid,
        ownerName: currentUserProfile?.name || currentUser.email || 'Bilinmeyen Kullanıcı',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'pending',
        total,
      };
      await setDoc(doc(db, 'expensePeriods', periodId), withCompanyScope({
        ...periodDoc,
        receipts: rows,
      }, currentCompanyId), { merge: true });

      toast({ title: 'Kaydedildi', description: 'Masraf fişleri dönem bazında kaydedildi ve onaya gönderildi.' });
    } catch (e) {
      console.error(e);
      toast({ title: 'Kayıt Hatası', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const loadExistingIfAny = useCallback(async () => {
    if (!currentUser?.uid) return;
    try {
      const q = scopedQuery(
        'expensePeriods',
        currentCompanyId,
        isSuperAdmin,
        where('ownerUid', '==', currentUser.uid),
        where('year', '==', year),
        where('month', '==', month),
        orderBy('updatedAt', 'desc')
      );
      const snap = await getDocs(q);

      if (!snap.empty) {
        const data = snap.docs[0].data() as any;
        if (Array.isArray(data.receipts)) {
          setRows(
            data.receipts.map((r: any) => ({
              id: r.id ?? crypto.randomUUID(),
              tarih: r.tarih ?? '',
              fisNo: r.fisNo ?? '',
              kdv: Number(r.kdv ?? 0),
              aciklama: r.aciklama ?? '',
              kategori: (r.kategori ?? '') as ExpenseCategory | '',
              fiyat: Number(r.fiyat ?? 0),
              ocrKaynak: r.ocrKaynak ?? undefined,
            }))
          );
        } else {
          setRows([]);
        }
      } else {
        setRows([]);
      }
    } catch (e) {
      console.error('loadExistingIfAny error', e);
      setRows([]);
    }
  }, [currentUser?.uid, month, year]);

  useEffect(() => {
    loadExistingIfAny();
  }, [loadExistingIfAny]);
  
  const openHistoryModal = useCallback(() => {
    if (!currentUser) return;
    setHistoryLoading(true);
    setIsHistoryOpen(true);
    // Simple query without ordering to avoid composite index requirement
    const q = scopedQuery('expensePeriods', currentCompanyId, isSuperAdmin, where('ownerUid', '==', currentUser.uid));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpensePeriod));
        // Sort client-side
        data.sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0));
        setHistoryRequests(data);
        setHistoryLoading(false);
    }, (error) => {
        console.error("Error fetching history:", error);
        toast({ title: 'Hata', description: 'Geçmiş talepler yüklenemedi.', variant: 'destructive' });
        setHistoryLoading(false);
    });

    // In this pattern, we would return the unsubscribe function if the modal could stay open
    // but since it's modal, we assume it's transient and don't need to manage the lifecycle here.
    // For a real-time panel, you'd return `unsubscribe`.
  }, [currentUser, toast]);


  return (
    <>
      <div className="p-4 space-y-4">
        <BackButton fallback="/personel-islemleri" />
        <Card className="shadow-lg">
          <CardHeader className="flex flex-col md:flex-row md:items-start md:justify-between">
              <div>
                  <CardTitle>Masraf Yönetimi</CardTitle>
                  <CardDescription>Personel fişlerini dönem bazında toplayın, Excel ile içe/dışa aktarın.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={openHistoryModal}>
                  <History className="h-4 w-4 mr-2" />
                  Geçmiş Taleplerim
                </Button>
                <Button onClick={saveToFirestore} disabled={isSaving || rows.length === 0}>
                    {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Kaydet ve Onaya Gönder
                </Button>
              </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Period Selection */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex flex-col">
                <label className="text-sm text-muted-foreground mb-1">Dönem (Ay)</label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Ay" /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <label className="text-sm text-muted-foreground mb-1">Dönem (Yıl)</label>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Yıl" /></SelectTrigger>
                  <SelectContent>
                    {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button variant="secondary" onClick={addEmptyRow}><PlusCircle className="h-4 w-4 mr-2" />Satır Ekle</Button>
              </div>
            </div>

            {/* Table */}
            <div className="rounded-md border">
              <ScrollArea className="h-[50vh]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="min-w-[120px]">Tarih</TableHead>
                      <TableHead className="min-w-[120px]">FİŞ NO</TableHead>
                      <TableHead className="min-w-[90px]">KDV (%)</TableHead>
                      <TableHead className="min-w-[220px]">Açıklama</TableHead>
                      <TableHead className="min-w-[180px]">Kategori</TableHead>
                      <TableHead className="min-w-[120px]" style={{ textAlign: 'right' }}>Fiyat (₺)</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-10">Bu döneme ait fiş bulunmuyor. “Satır Ekle” ile başlayın.</TableCell>
                      </TableRow>
                    )}
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Input
                            value={r.tarih}
                            onChange={(e) => updateRow(r.id, { tarih: e.target.value })}
                            placeholder="gg.AA.yyyy"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={r.fisNo}
                            onChange={(e) => updateRow(r.id, { fisNo: e.target.value })}
                            placeholder="Fiş No"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={String(r.kdv)}
                            onChange={(e) => updateRow(r.id, { kdv: Number(e.target.value) })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={r.aciklama}
                            onChange={(e) => updateRow(r.id, { aciklama: e.target.value })}
                            placeholder="Açıklama"
                          />
                        </TableCell>
                        <TableCell>
                          <Select value={r.kategori || ''} onValueChange={(v) => updateRow(r.id, { kategori: v as ExpenseCategory })}>
                            <SelectTrigger><SelectValue placeholder="Seçin" /></SelectTrigger>
                            <SelectContent>
                              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            className="text-right"
                            type="number"
                            value={String(r.fiyat)}
                            onChange={(e) => updateRow(r.id, { fiyat: Number(e.target.value) })}
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeRow(r.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-lg font-medium">
              Toplam Ödenek: <span className="font-semibold">{total.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</span>
            </div>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleExcelImport(f);
                }}
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Excel İçe Aktar
              </Button>
              <Button variant="outline" onClick={handleExcelExport}><Download className="h-4 w-4 mr-2" />Excel Dışa Aktar</Button>
            </div>
          </CardFooter>
        </Card>
      </div>

       <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-4xl">
            <DialogHeader>
                <DialogTitle>Masraf Geçmişi</DialogTitle>
                <DialogDescription>Daha önce gönderdiğiniz talepler ve durumları.</DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto">
                {historyLoading ? <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin"/></div> :
                 historyRequests.length === 0 ? <p className="text-center text-muted-foreground p-8">Geçmiş talep bulunmuyor.</p> : (
                    <Accordion type="single" collapsible className="w-full">
                        {historyRequests.map(req => {
                            const periodLabel = format(new Date(req.year, req.month), 'MMMM yyyy', { locale: tr });
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
                                            <span className="font-medium">{periodLabel}</span>
                                            <span>{req.total.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</span>
                                            <Badge variant={statusVariant[req.status]}>{statusText[req.status]}</Badge>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <Table>
                                            <TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>Fiş No</TableHead><TableHead>Açıklama</TableHead><TableHead className="text-right">Fiyat</TableHead></TableRow></TableHeader>
                                            <TableBody>
                                                {req.receipts.map(entry => (
                                                    <TableRow key={entry.id}>
                                                        <TableCell>{entry.tarih}</TableCell>
                                                        <TableCell>{entry.fisNo}</TableCell>
                                                        <TableCell>{entry.aciklama}</TableCell>
                                                        <TableCell className="text-right">{entry.fiyat.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</TableCell>
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
