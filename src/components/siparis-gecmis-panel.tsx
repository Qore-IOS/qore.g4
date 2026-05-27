/**
 * @fileoverview Order History Panel Component
 * @description Displays historical shipments and completed orders by depot.
 * Provides filtering, pagination, and detailed shipment information.
 * @module components/siparis-gecmis-panel
 * @version 2.0.0
 *
 * @features
 * - Depot-based shipment history filtering
 * - Pagination with configurable rows per page
 * - Real-time updates via Firestore listeners
 * - Order creator and shipper information display
 * - Navigation to individual shipment details
 *
 * @accessibility
 * - ARIA labels for all interactive elements
 * - Screen reader support for navigation and status
 * - Keyboard accessible pagination controls
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Accordion, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, Timestamp, onSnapshot, limit } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { DateRangeFilterBar } from '@/components/common/DateRangeFilterBar';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Shipment, Order, Depot } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useRowFocus } from '@/hooks/useRowFocus';
import { Label } from '@/components/ui/label';
import { siparisGecmisLogger } from '@/lib/logger';

/**
 * Order History Panel Component
 * @description Displays completed orders and shipment history filtered by depot
 * @returns {JSX.Element} The rendered order history panel
 */
export default function SiparisGecmisPanel(): JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();
  const depotIdFromUrl = searchParams.get('depotId') || '';
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>(depotIdFromUrl);
  const [loading, setLoading] = useState(true);

  const dateFilter = useDateRangeFilter({
    defaultDays: 90,
    storageKey: 'siparis-gecmis:range',
  });

  // Pagination State
  const [rowsPerPage, setRowsPerPage] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  
  const [allShipments, setAllShipments] = useState<Shipment[]>([]);
  const [allOrders, setAllOrders] = useState<Record<string, Order>>({});
  
  useRowFocus('focus');

  // Fetch depots once
  useEffect(() => {
    const unsub = onSnapshot(scopedQuery('depots', currentCompanyId, isSuperAdmin), snap => {
      const depotList = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setDepots(depotList);
      if (!selectedDepotId && depotList.length > 0) {
        setSelectedDepotId(depotList[0].id);
      }
    });
    return () => unsub();
  }, [selectedDepotId, currentCompanyId, isSuperAdmin]);

  // Fetch shipments + ilgili siparişler — tarih penceresi + hard cap
  useEffect(() => {
    setLoading(true);
    const shipmentsQuery = scopedQuery(
      'shipments',
      currentCompanyId,
      isSuperAdmin,
      ...dateFilter.constraints('timestamp'),
      orderBy('timestamp', 'desc'),
      limit(1000),
    );
    
    const unsubscribe = onSnapshot(shipmentsQuery, async (shipmentSnap) => {
        const shipmentList = shipmentSnap.docs.map(d => ({ id: d.id, ...d.data(), timestamp: (d.data().timestamp as Timestamp)?.toDate() } as Shipment));
        setAllShipments(shipmentList);

        const orderIds = shipmentList.map(s => s.orderId).filter((id): id is string => !!id && id !== 'DIREKT_TRANSFER');
        
        if (orderIds.length > 0) {
            const uniqueOrderIds = Array.from(new Set(orderIds));
            const orderChunks: string[][] = [];
            for (let i = 0; i < uniqueOrderIds.length; i += 30) {
                orderChunks.push(uniqueOrderIds.slice(i, i + 30));
            }
            const orderPromises = orderChunks.map(chunk => getDocs(scopedQuery('orders', currentCompanyId, isSuperAdmin, where('id', 'in', chunk))));
            const orderSnaps = await Promise.all(orderPromises);
            
            const ordersData: Record<string, Order> = {};
            orderSnaps.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    ordersData[doc.id] = { id: doc.id, ...data, createdAt: (data.createdAt as Timestamp)?.toDate(), transferredAt: (data.transferredAt as Timestamp)?.toDate() } as Order;
                });
            });
            setAllOrders(ordersData);
        }
        setLoading(false);
    }, (error) => {
        siparisGecmisLogger.error('Sevkiyat/sipariş geçmişi yüklenirken hata oluştu', error, {
          shipmentsCount: allShipments.length,
        });
        toast({ title: 'Hata', description: 'Geçmiş yüklenirken bir hata oluştu.', variant: 'destructive' });
        setLoading(false);
    });

    return () => unsubscribe();
  }, [toast, currentCompanyId, isSuperAdmin, dateFilter.range]);

  const filteredShipments = useMemo(() => {
    if (!selectedDepotId) return [];
    return allShipments.filter(s => s.depotId === selectedDepotId);
  }, [selectedDepotId, allShipments]);
  
  const depotName = depots.find(d => d.id === selectedDepotId)?.name || selectedDepotId;

  // Pagination Logic
  const totalPages = Math.ceil(filteredShipments.length / rowsPerPage);
  const paginatedShipments = useMemo(() => {
      const start = (page - 1) * rowsPerPage;
      return filteredShipments.slice(start, start + rowsPerPage);
  }, [filteredShipments, page, rowsPerPage]);

  useEffect(() => {
    setPage(1);
  }, [selectedDepotId, rowsPerPage]);

  return (
    <div className="p-4 space-y-4" role="main" aria-label="Sipariş geçmişi sayfası">
      <BackButton fallback="/siparisler" />
      <Card role="region" aria-labelledby="order-history-title">
        <CardHeader>
          <CardTitle id="order-history-title">Sipariş Geçmişi</CardTitle>
          <CardDescription>Depo bazlı tamamlanmış sipariş ve sevkiyatları görüntüleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          <DateRangeFilterBar
            range={dateFilter.range}
            setRange={dateFilter.setRange}
            label="Sevkiyat tarihi"
            className="mb-4"
          />
          <div className="max-w-md mb-4">
            <Label htmlFor="depot-filter" className="text-sm font-medium">Depo</Label>
            <Select value={selectedDepotId} onValueChange={v => { router.push(`/siparis-gecmis?depotId=${v}`); setSelectedDepotId(v); }}>
              <SelectTrigger id="depot-filter" className="w-full" aria-label="Depo filtresi">
                <SelectValue placeholder="Depo Seçin..." />
              </SelectTrigger>
              <SelectContent>
                {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name || d.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
             <div className="flex items-center justify-center h-64" role="status" aria-label="Yükleniyor">
               <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
               <span className="sr-only">Sevkiyat geçmişi yükleniyor...</span>
             </div>
          ) : (
             <Accordion type="single" collapsible className="w-full" aria-label="Sevkiyat listesi">
                {paginatedShipments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" role="status">Bu depo için geçmiş sevkiyat bulunamadı.</p>
                ) : (
                  paginatedShipments.map(s => (
                    <AccordionItem key={s.id} value={s.id} data-row-id={s.id}>
                        <AccordionTrigger
                          className="flex justify-between items-center hover:no-underline p-4"
                          onClick={() => router.push(`/siparis-gecmis/${s.id}?depotId=${selectedDepotId}`)}
                          aria-label={`${s.recipientHospital} sevkiyat detaylarını görüntüle`}
                        >
                            <div className="text-left space-y-1">
                                <p className="font-semibold">{s.recipientHospital}</p>
                                <p className="text-xs text-muted-foreground">{s.timestamp ? formatDate(s.timestamp, 'dd MMM yyyy, HH:mm', { locale: tr }) : '-'}</p>
                            </div>
                            <div className="text-xs text-muted-foreground">
                                <span>Sip. Oluşturan: {allOrders[s.orderId]?.createdBy || 'Direkt Transfer'}</span>
                                <br aria-hidden="true" />
                                <span>Sevk Eden: {s.userName}</span>
                            </div>
                            <div className="font-medium" aria-label={`Toplam ${s.items.reduce((sum, i) => sum + i.quantity, 0)} adet`}>
                                {s.items.reduce((sum, i) => sum + i.quantity, 0)} Adet
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
                    <Label htmlFor="rows-per-page">Satır/sayfa:</Label>
                    <Select value={String(rowsPerPage)} onValueChange={val => { setRowsPerPage(Number(val)); setPage(1); }}>
                    <SelectTrigger id="rows-per-page" className="w-20" aria-label="Sayfa başına satır sayısı">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {[20, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                    </Select>
                </div>
                <nav className="flex items-center space-x-1" role="navigation" aria-label="Sayfalama">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    aria-label="Önceki sayfa"
                  >
                    Önceki
                  </Button>
                  <span className="text-sm px-2" aria-current="page">Sayfa {page} / {totalPages}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    aria-label="Sonraki sayfa"
                  >
                    Sonraki
                  </Button>
                </nav>
            </CardFooter>
        )}
      </Card>
    </div>
  );
}
