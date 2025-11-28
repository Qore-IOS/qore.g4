
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Transfer, Depot } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import BackButton from '@/components/BackButton';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRowFocus } from '@/hooks/useRowFocus';

export default function TransferGecmisPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const depotIdFromUrl = searchParams.get('depotId') || '';
  const { toast } = useToast();

  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>(depotIdFromUrl);
  const [allTransfers, setAllTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);

  // Pagination State
  const [rowsPerPage, setRowsPerPage] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  
  useRowFocus('focus');

  // Fetch depots once
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'depots'), snap => {
      const depotList = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setDepots(depotList);
      if (!selectedDepotId && depotList.length > 0) {
        setSelectedDepotId(depotList[0].id);
      }
    });
    return () => unsub();
  }, [selectedDepotId]);

  // Fetch ALL transfers once and listen for changes
  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, 'transfers'),
      orderBy('timestamp', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => {
        const docData = d.data();
        return {
          id: d.id,
          ...docData,
          timestamp: docData.timestamp?.toDate ? docData.timestamp.toDate() : new Date(),
        } as Transfer;
      });
      setAllTransfers(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching transfer history:", error);
      toast({ title: 'Hata', description: 'Transfer geçmişi yüklenirken bir hata oluştu.', variant: 'destructive' });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);
  
  const filteredTransfers = useMemo(() => {
    if (!selectedDepotId) return [];
    return allTransfers.filter(t => t.sourceDepotId === selectedDepotId);
  }, [selectedDepotId, allTransfers]);
  
  const selectedDepotName = useMemo(() => 
    depots.find(d => d.id === selectedDepotId)?.name || 'Bilinmeyen Depo',
    [depots, selectedDepotId]
  );
  
  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [selectedDepotId, rowsPerPage]);

  const totalPages = Math.ceil(filteredTransfers.length / rowsPerPage);
  const paginatedTransfers = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    return filteredTransfers.slice(start, end);
  }, [filteredTransfers, page, rowsPerPage]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <BackButton fallback="/direkt-transfer" />
      <Card>
        <CardHeader>
          <CardTitle>Transfer Geçmişi</CardTitle>
          <CardDescription>Depodan yapılan tüm direkt transfer işlemlerini görüntüleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md mb-4">
            <label className="text-sm font-medium">Depo</label>
            <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Depo Seçin..." />
              </SelectTrigger>
              <SelectContent>
                {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name || d.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          
          {loading ? (
             <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
             <Accordion type="single" collapsible className="w-full">
                {paginatedTransfers.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Bu depo için transfer kaydı bulunamadı.</p>
                ) : (
                  paginatedTransfers.map(t => (
                    <AccordionItem key={t.id} value={t.id} data-row-id={t.id}>
                        <AccordionTrigger 
                          className="flex justify-between items-center hover:no-underline p-4"
                          onClick={() => router.push(`/transfer-gecmis/${t.id}?depotId=${selectedDepotId}`)}
                        >
                            <div className="text-left space-y-1">
                                <p className="font-semibold">{t.targetName}</p>
                                <p className="text-xs text-muted-foreground">{t.timestamp ? formatDate(t.timestamp, 'dd MMM yyyy, HH:mm', { locale: tr }) : '-'}</p>
                            </div>
                            <div className="text-center">
                                <p className="font-mono text-sm">{t.itemCount} adet</p>
                                <p className="text-xs text-muted-foreground">{t.userName}</p>
                            </div>
                        </AccordionTrigger>
                    </AccordionItem>
                  ))
                )}
             </Accordion>
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
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1 || loading}
                    >
                        Önceki
                    </Button>
                    <span className="text-sm">Sayfa {page} / {totalPages}</span>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages || loading}
                    >
                        Sonraki
                    </Button>
                </div>
            </CardFooter>
        )}
      </Card>
    </div>
  );
}
