'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import type { Depot, DepoStokItem, ConsumptionRecord } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose, DialogFooter } from '@/components/ui/dialog';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { addDays, isValid, format, startOfDay, endOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { toDateSafe, formatMiad } from '@/lib/date';
import { Loader2, FileSpreadsheet } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { exportDataToExcel } from '@/lib/utils';
import { tr } from 'date-fns/locale';
import BackButton from './BackButton';

// --- TYPE DEFINITIONS ---

interface ReportRow {
  key: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  donemBasiStok: number;
  donemIciGiris: number;
  donemSonuStok: number;
  fark: number;
  detaySeriNumaralari: string[];
}

interface DetailItem {
  seriNumarasi: string;
  hedef?: string;
  tarih?: Date;
}

// --- COMPONENT ---

export default function StokYonetimiGecmisPanel() {
  const { toast } = useToast();
  const [depots, setDepots] = useState<Depot[]>([]);
  const [allStock, setAllStock] = useState<DepoStokItem[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [queryLoading, setQueryLoading] = useState(false);

  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfDay(addDays(new Date(), -7)),
    to: endOfDay(new Date()),
  });

  const [reportData, setReportData] = useState<ReportRow[]>([]);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedRowDetails, setSelectedRowDetails] = useState<DetailItem[]>([]);

  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [depotsSnap, stockSnap] = await Promise.all([
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'depoStok')),
      ]);
      setDepots(depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)));
      
      const processItems = (snap: any) => snap.docs.map((d: any) => {
        const data = d.data();
        Object.keys(data).forEach(key => {
            if (data[key] instanceof Timestamp) data[key] = data[key].toDate();
        });
        return { id: d.id, ...data };
      });
      setAllStock(processItems(stockSnap));

    } catch (error) {
      toast({ title: 'Hata', description: 'Gerekli ana veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleQuery = async () => {
    if (!selectedLocationId || !dateRange?.from || !dateRange?.to) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen depo ve tarih aralığı seçin.', variant: 'default' });
      return;
    }
    setQueryLoading(true);
  
    const from = startOfDay(dateRange.from);
    const to = endOfDay(dateRange.to);
  
    try {
        const reportMap = new Map<string, ReportRow>();
  
        const initializeRowIfNeeded = (item: DepoStokItem) => {
            const key = `${item.stokKodu}-${item.lotNumarasi || ''}`;
            if (!reportMap.has(key)) {
                reportMap.set(key, {
                    key, stokKodu: item.stokKodu, stokAdi: item.stokAdi, lotNumarasi: item.lotNumarasi || '', miad: formatMiad(item.miad, ''),
                    donemBasiStok: 0, donemIciGiris: 0, donemSonuStok: 0, fark: 0, detaySeriNumaralari: []
                });
            }
            return reportMap.get(key)!;
        };

        const stockForDepot = allStock.filter(item => item.depotId === selectedLocationId);

        stockForDepot.forEach(item => {
            const row = initializeRowIfNeeded(item);
            const isShipped = !!(item.isShipped && item.sevkTarihi);
            const arrivalDate = toDateSafe(item.eklenmeTarihi);
            const sevkDate = toDateSafe(item.sevkTarihi);

            if (arrivalDate && isValid(arrivalDate) && arrivalDate < from && (!isShipped || (sevkDate && sevkDate >= from))) {
                row.donemBasiStok++;
            }
            if (arrivalDate && isValid(arrivalDate) && arrivalDate >= from && arrivalDate <= to) {
                row.donemIciGiris++;
            }
            if (arrivalDate && isValid(arrivalDate) && arrivalDate <= to && (!isShipped || (sevkDate && sevkDate > to))) {
                row.donemSonuStok++;
            }
        });

        reportMap.forEach(row => {
            row.fark = (row.donemBasiStok + row.donemIciGiris) - row.donemSonuStok;
            if (row.fark > 0) {
                row.detaySeriNumaralari = allStock
                    .filter(s => {
                        if (s.depotId !== selectedLocationId) return false;
                        if (s.stokKodu !== row.stokKodu) return false;
                        if ((s.lotNumarasi || '') !== row.lotNumarasi) return false;
                        if (!s.isShipped) return false;
                        const sevkDate = toDateSafe(s.sevkTarihi);
                        return sevkDate && sevkDate >= from && sevkDate <= to;
                    })
                    .map(s => s.seriNumarasi)
                    .filter((sn): sn is string => !!sn);
            }
        });
  
        setReportData(Array.from(reportMap.values()).filter(r => r.donemBasiStok > 0 || r.donemIciGiris > 0 || r.donemSonuStok > 0 || r.fark > 0));
        setPage(1);
  
    } catch(err) {
        console.error(err);
        toast({ title: 'Rapor Hatası', description: 'Rapor oluşturulurken bir hata oluştu.', variant: 'destructive' });
    } finally {
        setQueryLoading(false);
    }
  };
  
  const showDetails = (row: ReportRow) => {
    if (row.fark <= 0) return;

    const details = row.detaySeriNumaralari.map(sn => {
        const stockItem = allStock.find(s => s.seriNumarasi === sn);
        return {
            seriNumarasi: sn,
            hedef: stockItem?.hedefKurum || 'Bilinmiyor',
            tarih: toDateSafe(stockItem?.sevkTarihi),
        };
    });
    setSelectedRowDetails(details);
    setDetailModalOpen(true);
  };
  
  const handleExport = () => {
    if (reportData.length === 0) return;
    const summaryData = reportData.map(r => ({
        'Stok Kodu': r.stokKodu,
        'Stok Adı': r.stokAdi,
        'Lot Numarası': r.lotNumarasi,
        'Miad': r.miad,
        'Dönem Başı Adet': r.donemBasiStok,
        'Dönem İçi Giriş': r.donemIciGiris,
        'Dönem Sonu Adet': r.donemSonuStok,
        'Fark (Sevk Edilen)': r.fark
    }));

    const detailData = reportData.flatMap(row =>
        row.detaySeriNumaralari.map(sn => {
            const stockItem = allStock.find(s => s.seriNumarasi === sn);
            const sevkDate = toDateSafe(stockItem?.sevkTarihi);
            return {
                'Stok Kodu': row.stokKodu,
                'Lot': row.lotNumarasi,
                'Seri Numarası': sn,
                'Hedef Kurum': stockItem?.hedefKurum || 'Bilinmiyor',
                'Tarih': sevkDate && isValid(sevkDate) ? format(sevkDate, 'dd.MM.yyyy HH:mm') : ''
            };
        })
    );
    exportDataToExcel({ 'Özet Rapor': summaryData, 'Detay Raporu': detailData }, 'Gecmis_Stok_Raporu', toast);
  };

  const paginatedData = reportData.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const totalPages = Math.ceil(reportData.length / rowsPerPage);

  return (
    <>
      <div className="p-4 space-y-4">
        <BackButton fallback="/stok-yonetimi" />
        <Card>
          <CardHeader>
            <CardTitle>Geçmiş Depo Stok Raporu</CardTitle>
            <CardDescription>Belirtilen depo ve tarih aralığı için dönem başı ve dönem sonu stok adetlerini karşılaştırın.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                <SelectTrigger><SelectValue placeholder="Depo Seçin" /></SelectTrigger>
                <SelectContent>{depots.map(opt => <SelectItem key={opt.id} value={opt.id}>{opt.name}</SelectItem>)}</SelectContent>
              </Select>
              <DatePickerWithRange date={dateRange} setDate={setDateRange} className="md:col-span-2" />
            </div>
            <div className="flex justify-between items-center">
              <Button onClick={handleQuery} disabled={!selectedLocationId || !dateRange?.from || !dateRange?.to || queryLoading}>
                {queryLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Sorgula
              </Button>
              <Button onClick={handleExport} disabled={reportData.length === 0} variant="outline">
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'e Aktar
              </Button>
            </div>

            <div className="border rounded-md mt-4">
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader><TableRow><TableHead>Stok Kodu</TableHead><TableHead>Stok Adı</TableHead><TableHead>Lot</TableHead><TableHead>Miad</TableHead><TableHead className="text-right">Dönem Başı</TableHead><TableHead className="text-right">Dönem İçi Giriş</TableHead><TableHead className="text-right">Dönem Sonu</TableHead><TableHead className="text-right">Fark</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {queryLoading ? <TableRow><TableCell colSpan={8} className="h-24 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow>
                      : paginatedData.length === 0 ? <TableRow><TableCell colSpan={8} className="h-24 text-center">Rapor oluşturmak için sorgulama yapın.</TableCell></TableRow>
                        : paginatedData.map(row => (
                          <TableRow key={row.key} onClick={() => showDetails(row)} className={row.fark > 0 ? "cursor-pointer hover:bg-muted/50" : ""}>
                            <TableCell>{row.stokKodu}</TableCell><TableCell>{row.stokAdi}</TableCell><TableCell>{row.lotNumarasi}</TableCell><TableCell>{row.miad}</TableCell>
                            <TableCell className="text-right">{row.donemBasiStok}</TableCell>
                            <TableCell className="text-right">{row.donemIciGiris}</TableCell>
                            <TableCell className="text-right">{row.donemSonuStok}</TableCell>
                            <TableCell className={`text-right font-bold ${row.fark > 0 ? 'text-destructive' : ''}`}>{row.fark}</TableCell>
                          </TableRow>
                        ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between items-center">
            <div className="flex items-center space-x-2 text-sm">
              <span>Sayfa başına:</span>
              <Select value={`${rowsPerPage}`} onValueChange={v => { setRowsPerPage(Number(v)); setPage(1); }}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>{[20, 50, 100].map(n => <SelectItem key={n} value={`${n}`}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2 text-sm">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Önceki</Button>
              <span>Sayfa {page} / {totalPages > 0 ? totalPages : 1}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Sonraki</Button>
            </div>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fark Detayları</DialogTitle>
            <DialogDescription>Dönem içinde transfer edilen ürünlerin seri numaraları.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-96 mt-4">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Seri Numarası</TableHead>
                        <TableHead>Hedef Kurum</TableHead>
                        <TableHead>Tarih</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {selectedRowDetails.map((d, i) => (
                        <TableRow key={`${d.seriNumarasi}-${i}`}>
                            <TableCell className="font-mono text-xs">{d.seriNumarasi}</TableCell>
                            <TableCell>{d.hedef}</TableCell>
                            <TableCell>{d.tarih && isValid(d.tarih) ? format(d.tarih, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
          </ScrollArea>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Kapat</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
