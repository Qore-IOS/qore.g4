/**
 * @fileoverview Transfer History Panel Component
 * @description Displays historical transfer records with server-side filtering and pagination.
 * @module components/transfer-gecmis-panel
 * @version 3.0.0
 *
 * @requires Firestore composite index: transfers (sourceDepotId ASC, timestamp DESC)
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Building2, CalendarClock, Loader2, Package2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
  startAfter,
  getDocsFromServer,
  getCountFromServer,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Transfer, Depot, Hospital } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import BackButton from '@/components/BackButton';
import { transferGecmisLogger } from '@/lib/logger';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { LabSelector } from '@/components/common/LabSelector';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRowFocus } from '@/hooks/useRowFocus';

export default function TransferGecmisPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const depotIdFromUrl = searchParams.get('depotId') || '';
  const labIdFromUrl = searchParams.get('labId') || 'all';
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [depots, setDepots] = useState<Depot[]>([]);
  const [labs, setLabs] = useState<Hospital[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>(depotIdFromUrl);
  const [selectedLabId, setSelectedLabId] = useState<string>(labIdFromUrl);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Pagination State
  const [rowsPerPage, setRowsPerPage] = useState<number>(20);
  const [page, setPage] = useState<number>(1);

  // Cursor stack for navigation (each entry is the last doc of that page)
  const cursorStackRef = useRef<QueryDocumentSnapshot[]>([]);

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

  // Fetch labs once for target laboratory filter
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'hospitals'), snap => {
      const labList = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setLabs(labList);
    });
    return () => unsub();
  }, []);

  /**
   * Fetch total count for the selected depot (server-side)
   */
  const fetchTotalCount = useCallback(async (depotId: string, labId: string) => {
    if (!depotId) {
      setTotalCount(0);
      return;
    }
    try {
      const filters = [where('sourceDepotId', '==', depotId)];
      if (labId && labId !== 'all') {
        filters.push(where('targetHospitalId', '==', labId));
      }
      const countQuery = scopedQuery('transfers', currentCompanyId, isSuperAdmin, ...filters);
      const snapshot = await getCountFromServer(countQuery);
      setTotalCount(snapshot.data().count);
    } catch (error) {
      transferGecmisLogger.error('Transfer sayısı alınamadı', error as Error, {
        operation: 'fetchTotalCount',
        depotId,
        labId,
      });
      setTotalCount(0);
    }
  }, []);

  /**
   * Fetch transfers for the given page (server-side with cursor pagination)
   */
  const fetchTransfers = useCallback(async (
    depotId: string,
    labId: string,
    pageNum: number,
    pageSize: number,
    cursors: QueryDocumentSnapshot[]
  ) => {
    if (!depotId) {
      setTransfers([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Build query with server-side filtering
      // Requires composite index: sourceDepotId ASC + timestamp DESC
      const filters = [where('sourceDepotId', '==', depotId)];
      if (labId && labId !== 'all') {
        filters.push(where('targetHospitalId', '==', labId));
      }
      let q = scopedQuery('transfers', currentCompanyId, isSuperAdmin, ...filters, orderBy('timestamp', 'desc'), limit(pageSize));

      // If not first page, use cursor from previous page
      if (pageNum > 1 && cursors[pageNum - 2]) {
        q = scopedQuery(
          'transfers',
          currentCompanyId,
          isSuperAdmin,
          ...filters,
          orderBy('timestamp', 'desc'),
          startAfter(cursors[pageNum - 2]),
          limit(pageSize)
        );
      }

      const snapshot = await getDocsFromServer(q);

      const data = snapshot.docs.map(d => {
        const docData = d.data();
        return {
          id: d.id,
          ...docData,
          timestamp: docData.timestamp?.toDate ? docData.timestamp.toDate() : new Date(),
        } as Transfer;
      });

      // Store cursor for this page (last doc)
      if (snapshot.docs.length > 0) {
        const newCursors = [...cursors];
        newCursors[pageNum - 1] = snapshot.docs[snapshot.docs.length - 1];
        cursorStackRef.current = newCursors;
      }

      setTransfers(data);
      transferGecmisLogger.info('Transfer geçmişi yüklendi (server-side)', {
        depotId,
        labId,
        page: pageNum,
        count: data.length,
      });
    } catch (error) {
      transferGecmisLogger.error('Transfer geçmişi yüklenemedi', error as Error, {
        operation: 'fetchTransferHistory',
        depotId,
        labId,
      });
      toast({ title: 'Hata', description: 'Transfer geçmişi yüklenirken bir hata oluştu.', variant: 'destructive' });
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Reset pagination when depot or page size changes
  useEffect(() => {
    setPage(1);
    cursorStackRef.current = [];
    if (selectedDepotId) {
      fetchTotalCount(selectedDepotId, selectedLabId);
    }
  }, [selectedDepotId, selectedLabId, rowsPerPage, fetchTotalCount]);

  // Fetch transfers when page, depot, or page size changes
  useEffect(() => {
    fetchTransfers(selectedDepotId, selectedLabId, page, rowsPerPage, cursorStackRef.current);
  }, [selectedDepotId, selectedLabId, page, rowsPerPage, fetchTransfers]);

  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));

  return (
    <div
      className="p-4 md:p-6 space-y-6"
      role="main"
      aria-label="Transfer geçmişi sayfası"
    >
      <BackButton fallback="/direkt-transfer" aria-label="Geri dön" />
      <Card className="border-0 shadow-xl bg-gradient-to-b from-background to-[var(--dashboard-surface-1)]/35">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[var(--dashboard-surface-2)] text-[var(--dashboard-primary)]">
              <Package2 className="h-5 w-5" />
            </div>
            <CardTitle id="transfer-history-title" className="text-3xl font-semibold tracking-tight">Transfer Geçmişi</CardTitle>
          </div>
          <CardDescription>
            Depodan yapılan tüm direkt transfer işlemlerini görüntüleyin.
            {totalCount > 0 && <span className="ml-2 font-medium">({totalCount} kayıt)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent aria-labelledby="transfer-history-title">
          <div className="grid gap-4 md:grid-cols-2 mb-5">
            <div className="space-y-2">
            <label htmlFor="depot-filter-select" className="text-sm font-medium flex items-center gap-2"><Building2 className="h-4 w-4 text-[var(--dashboard-primary)]" />Depo</label>
            <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
              <SelectTrigger
                id="depot-filter-select"
                className="w-full bg-[var(--dashboard-surface-1)] border-[var(--dashboard-border)]"
                aria-label="Depo filtresi"
              >
                <SelectValue placeholder="Depo Seçin..." />
              </SelectTrigger>
              <SelectContent>
                {depots.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name || d.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="lab-filter-select" className="text-sm font-medium flex items-center gap-2"><CalendarClock className="h-4 w-4 text-[var(--dashboard-primary)]" />Hedef Laboratuvar</label>
              <LabSelector
                id="lab-filter-select"
                ariaLabel="Laboratuvar filtresi"
                labs={labs.map(l => ({ id: l.id, name: l.name || l.id, kod: l.kod }))}
                value={selectedLabId}
                onChange={setSelectedLabId}
                placeholder="Laboratuvar Seçin..."
                allOption={{ value: 'all', label: 'Tüm Laboratuvarlar' }}
                icon={false}
              />
            </div>
          </div>
          
          {loading ? (
             <div
               className="flex items-center justify-center h-64"
               role="status"
               aria-label="Transfer geçmişi yükleniyor"
             >
               <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
               <span className="sr-only">Yükleniyor...</span>
             </div>
          ) : (
             <Accordion type="single" collapsible className="w-full rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-surface-1)]/80 px-2">
                {transfers.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Bu depo için transfer kaydı bulunamadı.</p>
                ) : (
                  transfers.map(t => {
                    const transferPersonName = t.userName || t.createdByName || t.createdBy || 'Bilinmiyor';
                    return (
                    <AccordionItem key={t.id} value={t.id} data-row-id={t.id}>
                        <AccordionTrigger
                          className="flex justify-between items-center hover:no-underline p-4 rounded-lg hover:bg-[var(--dashboard-surface-2)]/60"
                          onClick={() => router.push(`/transfer-gecmis/${t.id}?depotId=${selectedDepotId}&labId=${selectedLabId}`)}
                        >
                            <div className="text-left space-y-1">
                                <p className="font-semibold">{t.targetName}</p>
                                <p className="text-xs text-muted-foreground">{t.timestamp ? formatDate(t.timestamp, 'dd MMM yyyy, HH:mm', { locale: tr }) : '-'}</p>
                            </div>
                            <div className="text-center">
                                <p className="font-mono text-sm">{t.itemCount} adet</p>
                                <p className="text-xs text-muted-foreground">Personel: {transferPersonName}</p>
                            </div>
                        </AccordionTrigger>
                    </AccordionItem>
                  )})
                )}
             </Accordion>
          )}
        </CardContent>
        {totalPages > 1 && (
            <CardFooter className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--dashboard-border)]">
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
