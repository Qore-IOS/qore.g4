
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Accordion, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, Timestamp, onSnapshot } from 'firebase/firestore';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { Shipment, Order, Depot } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useRowFocus } from '@/hooks/useRowFocus';

export default function SiparisGecmisPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const depotIdFromUrl = searchParams.get('depotId') || '';
  const { toast } = useToast();

  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>(depotIdFromUrl);
  const [loading, setLoading] = useState(true);

  // Pagination State
  const [rowsPerPage, setRowsPerPage] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  
  const [allShipments, setAllShipments] = useState<Shipment[]>([]);
  const [allOrders, setAllOrders] = useState<Record<string, Order>>({});
  
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
  
  // Fetch ALL shipments and orders once
  useEffect(() => {
    setLoading(true);
    const shipmentsQuery = query(collection(db, 'shipments'), orderBy('timestamp', 'desc'));
    
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
            const orderPromises = orderChunks.map(chunk => getDocs(query(collection(db, 'orders'), where('id', 'in', chunk))));
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
        console.error("Error fetching shipment/order history:", error);
        toast({ title: 'Hata', description: 'Geçmiş yüklenirken bir hata oluştu.', variant: 'destructive' });
        setLoading(false);
    });

    return () => unsubscribe();
  }, [toast]);

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
    <div className="p-4 space-y-4">
      <BackButton fallback="/siparisler" />
      <Card>
        <CardHeader>
          <CardTitle>Sipariş Geçmişi</CardTitle>
          <CardDescription>Depo bazlı tamamlanmış sipariş ve sevkiyatları görüntüleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md mb-4">
            <label className="text-sm font-medium">Depo</label>
            <Select value={selectedDepotId} onValueChange={v => { router.push(`/siparis-gecmis?depotId=${v}`); setSelectedDepotId(v); }}>
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
                {paginatedShipments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Bu depo için geçmiş sevkiyat bulunamadı.</p>
                ) : (
                  paginatedShipments.map(s => (
                    <AccordionItem key={s.id} value={s.id} data-row-id={s.id}>
                        <AccordionTrigger 
                          className="flex justify-between items-center hover:no-underline p-4"
                          onClick={() => router.push(`/siparis-gecmis/${s.id}?depotId=${selectedDepotId}`)}
                        >
                            <div className="text-left space-y-1">
                                <p className="font-semibold">{s.recipientHospital}</p>
                                <p className="text-xs text-muted-foreground">{s.timestamp ? formatDate(s.timestamp, 'dd MMM yyyy, HH:mm', { locale: tr }) : '-'}</p>
                            </div>
                            <div className="text-xs text-muted-foreground">
                                Sip. Oluşturan: {allOrders[s.orderId]?.createdBy || 'Direkt Transfer'} <br/>
                                Sevk Eden: {s.userName}
                            </div>
                            <div className="font-medium">
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
                    <span>Satır/sayfa:</span>
                    <Select value={String(rowsPerPage)} onValueChange={val => { setRowsPerPage(Number(val)); setPage(1); }}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {[20, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center space-x-1">
                  <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Önceki</Button>
                  <span className="text-sm px-2">Sayfa {page} / {totalPages}</span>
                  <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Sonraki</Button>
                </div>
            </CardFooter>
        )}
      </Card>
    </div>
  );
}
