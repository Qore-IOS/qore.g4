'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  onSnapshot,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, History, ChevronLeft, ChevronRight, RotateCw, FileSpreadsheet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { exportDataToExcel } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { toDateFromAny, formatTimestamp } from '@/lib/time';
import { useRowFocus } from '@/hooks/useRowFocus';

type MalKabulHeader = {
  transactionId: string;
  depotId: string;
  depotName: string;
  userId: string;
  userName: string;
  timestamp?: any;
  itemCount: number;
  brands?: string[];
  mode: 'verified' | 'unverified';
};

type MalKabulLine = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  adet: number;
  serials?: string[];
};

const PAGE_SIZE_OPTIONS = [50, 100, 200];
const COLLECTION_NAME = 'malKabulTransactions';
const ORDER_FIELD = 'timestamp';

export default function MalKabulGecmisPage() {
  const { toast } = useToast();
  const sp = useSearchParams();
  const openId = sp.get('open');

  const [pageSize, setPageSize] = useState<number>(50);
  const [isLoading, setIsLoading] = useState(true);
  const [allRows, setAllRows] = useState<(MalKabulHeader & { id: string })[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const { focusRef } = useRowFocus('open');

  // line modal
  const [selectedTx, setSelectedTx] = useState<(MalKabulHeader & { id: string }) | null>(null);
  const [linesLoading, setLinesLoading] = useState(false);
  const [lines, setLines] = useState<MalKabulLine[]>([]);

  // Real-time listener
  useEffect(() => {
    setIsLoading(true);
    const q = query(
      collection(db, COLLECTION_NAME),
      orderBy(ORDER_FIELD, 'desc'),
      limit(1000) // Limit to a reasonable number for performance
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...(d.data() as MalKabulHeader) }));
      // Client-side sort to guarantee order, as onSnapshot can deliver out-of-order updates initially
      data.sort((a,b) => toDateFromAny(b.timestamp)!.getTime() - toDateFromAny(a.timestamp)!.getTime());
      setAllRows(data);
      setIsLoading(false);
    }, (error) => {
      console.error('Error listening to mal kabul history:', error);
      toast({ title: 'Hata', description: 'Geçmiş verileri dinlenirken bir hata oluştu.', variant: 'destructive' });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);
  
  const openTransaction = useCallback(async (txId: string) => {
    setLines([]);
    setLinesLoading(true);
    const txHeader = allRows.find(r => r.id === txId);
    if (!txHeader) {
      toast({ title: 'Bulunamadı', description: 'İşlem mevcut değil veya silinmiş.' });
      return;
    }
    setSelectedTx(txHeader);

    try {
      const txRef = doc(db, COLLECTION_NAME, txId);
      const linesSnap = await getDocsFromServer(query(collection(txRef, 'lines'), orderBy('stokKodu')));
      setLines(linesSnap.docs.map(d => d.data() as MalKabulLine));
    } catch (e: any) {
      console.error('Satır detayları alınamadı:', e);
      toast({ title: 'Hata', description: e?.message ?? 'Detaylar yüklenemedi', variant: 'destructive' });
    } finally {
      setLinesLoading(false);
    }
  }, [toast, allRows]);
  
  useEffect(() => {
    if (openId && allRows.length > 0) openTransaction(openId);
  }, [openId, allRows, openTransaction]);

  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return allRows.slice(startIndex, startIndex + pageSize);
  }, [allRows, currentPage, pageSize]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const exportCurrentPage = () => {
    const rowsForExcel = paginatedRows.map(r => {
      return {
        'İşlem No': r.transactionId || r.id,
        'Depo': r.depotName,
        'Kullanıcı': r.userName,
        'İşlem Zamanı': formatTimestamp(r.timestamp, 'dd.MM.yyyy HH:mm') || '-',
        'Kalem Sayısı': r.itemCount,
        'Markalar': (r.brands || []).join(', ')
      };
    });
    exportDataToExcel(rowsForExcel, 'Mal_Kabul_Gecmis', 'Sayfa', toast);
  };

  const exportDetails = () => {
    if (!selectedTx || lines.length === 0) {
      toast({ title: 'Veri Yok', description: 'Dışa aktarılacak detay bulunamadı.' });
      return;
    }
    const summaryData = lines.map(l => ({
      'Stok Kodu': l.stokKodu,
      'Stok Adı': l.stokAdi,
      'Lot': l.lotNumarasi,
      'Miad': l.miad,
      'Adet': l.adet,
    }));
    const serialsData = lines.flatMap(l =>
      (l.serials || []).map(s => ({
        'Stok Kodu': l.stokKodu,
        'Stok Adı': l.stokAdi,
        'Lot': l.lotNumarasi,
        'Seri Numarası': s,
      }))
    );
    exportDataToExcel({
      'Özet': summaryData,
      'Seri Numaraları': serialsData
    }, `MalKabul_${selectedTx.transactionId || selectedTx.id}`, toast);
  };


  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl mb-4">
        <BackButton fallback="/mal-kabul" />
      </div>

      <Card className="mx-auto max-w-5xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <History className="h-6 w-6" />
                Mal Kabul İşlem Geçmişi
              </CardTitle>
              <CardDescription>
                Tüm işlemler listelenir. Sayfa başına kayıt sayısını seçebilir ve sayfalar arasında gezinebilirsiniz.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-32"><SelectValue placeholder="Sayfa boyutu" /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map(s => <SelectItem key={s} value={String(s)}>{s} / sayfa</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={exportCurrentPage}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
              </Button>
            </div>
          </div>
          <div className="pt-2 text-sm text-muted-foreground">
            Toplam işlem: {allRows.length} &nbsp;•&nbsp; Sayfa {currentPage} / {totalPages}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <ScrollArea className="h-[60vh] border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>İşlem No</TableHead>
                  <TableHead>Depo</TableHead>
                  <TableHead>Kullanıcı</TableHead>
                  <TableHead>İşlem Zamanı</TableHead>
                  <TableHead className="text-right">Kalem</TableHead>
                  <TableHead>Markalar</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <div className="flex flex-col items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="mt-2 text-sm text-muted-foreground">Yükleniyor...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : paginatedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10">Kayıt bulunamadı.</TableCell>
                  </TableRow>
                ) : (
                  paginatedRows.map((r) => (
                      <TableRow key={r.id} data-row-id={r.id} ref={r.id === openId ? focusRef : null} className="hover:bg-muted/40" >
                        <TableCell className="font-medium">{r.transactionId || r.id}</TableCell>
                        <TableCell>{r.depotName || '-'}</TableCell>
                        <TableCell>{r.userName || '-'}</TableCell>
                        <TableCell>{formatTimestamp(r.timestamp, 'dd.MM.yyyy HH:mm')}</TableCell>
                        <TableCell className="text-right">{r.itemCount ?? 0}</TableCell>
                        <TableCell className="capitalize text-xs text-muted-foreground">{(r.brands || []).join(', ')}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" onClick={() => openTransaction(r.id)}>Detay</Button>
                        </TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>

        <CardFooter className="flex items-center justify-between">
          <Button variant="outline" disabled={currentPage <= 1 || isLoading} onClick={() => setCurrentPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4 mr-2" /> Önceki
          </Button>
          <span>Sayfa {currentPage} / {totalPages}</span>
          <Button variant="outline" disabled={currentPage >= totalPages || isLoading} onClick={() => setCurrentPage(p => p + 1)}>
            Sonraki <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={!!selectedTx} onOpenChange={(o) => !o && setSelectedTx(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
             <div className="flex justify-between items-start">
              <div>
                <DialogTitle>İşlem Detayı</DialogTitle>
                <DialogDescription>
                  {selectedTx ? `${selectedTx.depotName ?? '-'} • ${selectedTx.userName ?? '-'} • ${formatTimestamp(selectedTx.timestamp, 'dd.MM.yyyy HH:mm')}` : ''}
                </DialogDescription>
              </div>
              <Button variant="outline" size="sm" onClick={exportDetails}>
                  <FileSpreadsheet className="mr-2 h-4 w-4"/> Detaylı Excel
              </Button>
            </div>
          </DialogHeader>
          <div className="border rounded-lg">
            <ScrollArea className="max-h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stok Kodu</TableHead>
                    <TableHead>Adı</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Miad</TableHead>
                    <TableHead className="text-right">Adet</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linesLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin inline-block mr-2" />
                        Detaylar yükleniyor...
                      </TableCell>
                    </TableRow>
                  ) : lines.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-10">Detay yok.</TableCell></TableRow>
                  ) : (
                    lines.map((l, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{l.stokKodu}</TableCell>
                        <TableCell>{l.stokAdi}</TableCell>
                        <TableCell>{l.lotNumarasi || '-'}</TableCell>
                        <TableCell>{l.miad || '-'}</TableCell>
                        <TableCell className="text-right">{l.adet}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTx(null)}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
