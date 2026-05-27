
'use client';

import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, History } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import BackButton from '@/components/BackButton';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { CursorPaginationFooter } from '@/components/common/CursorPaginationFooter';

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

/**
 * Ürün iade geçmişi — server-side cursor pagination.
 *
 * Önceki sürüm tüm `productReturns` koleksiyonunu indirip client'ta sayfalıyordu.
 * Yeni sürüm: her sayfa için Firestore'dan sadece N kayıt çeker.
 */
export default function UrunIadeGecmisPage() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [selectedRecord, setSelectedRecord] = useState<ReturnRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const mapper = useCallback((d: any): ReturnRecord => ({
    id: d.id,
    ...(d.data() as Omit<ReturnRecord, 'id'>),
  }), []);

  const pagination = useCursorPagination<ReturnRecord>({
    collectionName: 'productReturns',
    orderByField: 'returnedAt',
    orderDirection: 'desc',
    pageSize: 20,
    companyId: currentCompanyId,
    isSuperAdmin,
    mapper,
  });

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
            {pagination.loading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : pagination.items.length === 0 ? (
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
                    {pagination.items.map(record => (
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
          <CardFooter className="border-t">
            <CursorPaginationFooter
              page={pagination.page}
              pageSize={pagination.pageSize}
              totalCount={pagination.totalCount}
              totalPages={pagination.totalPages}
              hasNext={pagination.hasNext}
              hasPrev={pagination.hasPrev}
              loading={pagination.loading}
              onNext={pagination.nextPage}
              onPrev={pagination.prevPage}
              onPageSizeChange={pagination.setPageSize}
              className="w-full"
            />
          </CardFooter>
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
