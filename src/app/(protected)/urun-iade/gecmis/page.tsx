
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, History } from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import BackButton from '@/components/BackButton';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface ReturnItemDetail {
  stokKodu: string;
  stokAdi: string;
  seriNumarasi?: string;
  lotNumarasi?: string;
  returnedFrom: string;
}

interface ReturnRecord {
  id: string;
  returnedAt: { toDate: () => Date };
  returnedByName: string;
  returnedToDepotName: string;
  itemCount: number;
  items: ReturnItemDetail[];
}

export default function UrunIadeGecmisPage() {
  const [history, setHistory] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<ReturnRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  useEffect(() => {
    const q = query(collection(db, 'productReturns'), orderBy('returnedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ReturnRecord));
      setHistory(records);
      setLoading(false);
    }, (error) => {
      console.error("Failed to fetch return history:", error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const totalPages = Math.ceil(history.length / rowsPerPage);
  const paginatedHistory = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return history.slice(start, start + rowsPerPage);
  }, [history, page, rowsPerPage]);

  const openDetails = (record: ReturnRecord) => {
    setSelectedRecord(record);
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="p-4 md:p-6 space-y-4">
        <BackButton fallback="/urun-iade" />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-6 w-6 text-primary" />
              Ürün İade Geçmişi
            </CardTitle>
            <CardDescription>Depolara yapılan tüm ürün iade işlemlerinin kaydı.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : paginatedHistory.length === 0 ? (
              <p className="text-center text-muted-foreground">İade geçmişi bulunamadı.</p>
            ) : (
              <ScrollArea className="h-[60vh] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>İşlem ID</TableHead>
                      <TableHead>İade Tarihi</TableHead>
                      <TableHead>İade Edilen Depo</TableHead>
                      <TableHead>İşlemi Yapan</TableHead>
                      <TableHead className="text-right">Adet</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedHistory.map(record => (
                      <TableRow key={record.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetails(record)}>
                        <TableCell className="font-mono text-xs">{record.id.substring(0, 10)}...</TableCell>
                        <TableCell>{format(record.returnedAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: tr })}</TableCell>
                        <TableCell>{record.returnedToDepotName}</TableCell>
                        <TableCell>{record.returnedByName}</TableCell>
                        <TableCell className="text-right font-bold">{record.itemCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
           {totalPages > 1 && (
            <CardFooter className="flex items-center justify-between mt-4 pt-4 border-t">
                 <div className="flex items-center space-x-2 text-sm">
                    <span>Satır/sayfa:</span>
                    <Select value={String(rowsPerPage)} onValueChange={val => { setRowsPerPage(Number(val)); setPage(1); }}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {[20, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Önceki</Button>
                    <span className="text-sm">Sayfa {page} / {totalPages}</span>
                    <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Sonraki</Button>
                </div>
            </CardFooter>
        )}
        </Card>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>İade Detayları: {selectedRecord?.id.substring(0, 10)}...</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-96 mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ürün Adı</TableHead>
                  <TableHead>Seri No</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead>İade Alınan Yer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedRecord?.items.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell>{item.stokAdi}</TableCell>
                    <TableCell className="font-mono">{item.seriNumarasi || '-'}</TableCell>
                    <TableCell>{item.lotNumarasi || '-'}</TableCell>
                    <TableCell>{item.returnedFrom}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
