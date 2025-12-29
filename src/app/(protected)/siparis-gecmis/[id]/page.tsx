'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { collection, doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import TimestampText from '@/components/TimestampText';
import type { Order, Shipment, ShipmentItem, OrderItem } from '@/lib/types';


type CombinedItem = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: any;
  quantity: number;
  serialNumbers?: string[];
};

export default function SiparisGecmisDetailPage() {
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { toast } = useToast();
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    (async () => {
      // First, try to fetch as a shipment (most common case for this page)
      const shipmentSnap = await getDoc(doc(db, 'shipments', id));
      if (shipmentSnap.exists()) {
        const shipmentData = { id: shipmentSnap.id, ...shipmentSnap.data() } as Shipment;
        setShipment(shipmentData);

        if (shipmentData.orderId && shipmentData.orderId !== 'DIREKT_TRANSFER') {
            const orderSnap = await getDoc(doc(db, 'orders', shipmentData.orderId));
            if (orderSnap.exists()) {
                const orderData = orderSnap.data();
                setOrder({ id: orderSnap.id, ...orderData } as Order);
            }
        }
      } else {
        // If not a shipment, try to fetch as an order
        const orderSnap = await getDoc(doc(db, 'orders', id));
        if (orderSnap.exists()) {
            const orderData = orderSnap.data();
            setOrder({ id: orderSnap.id, ...orderData } as Order);
        } else {
            toast({ title: 'Bulunamadı', description: 'Kayıt mevcut değil.', variant: 'destructive' });
            router.back();
        }
      }
    })().finally(() => setLoading(false));
  }, [id, router, toast]);


  const tableData: CombinedItem[] = React.useMemo(() => {
    if (shipment?.items?.length) {
      return shipment.items.map(it => ({
        stokKodu: it.stokKodu || '',
        stokAdi: it.stokAdi || '',
        lotNumarasi: it.lotNumarasi,
        miad: it.miad,
        quantity: it.quantity ?? 0,
        serialNumbers: it.serialNumbers
      }));
    }
    if (order?.items?.length) {
      return order.items.map(it => ({
        stokKodu: it.stokKodu || '',
        stokAdi: it.stokAdi || '',
        quantity: it.adet ?? 0
      }));
    }
    return [];
  }, [shipment, order]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Yükleniyor...</span>
      </div>
    );
  }
  
  const displayShipment = shipment || {
    id: order!.id,
    depotName: order!.depotName,
    recipientHospital: order!.kurumAdi,
    timestamp: order!.transferredAt || order!.createdAt,
    userName: order!.transferredBy
  };
  
  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <BackButton fallback={`/siparis-gecmis?depotId=${order?.depotId || ''}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detay: {id}</CardTitle>
          <CardDescription>
            Gönderen Depo: <span className="font-medium">{displayShipment.depotName || '-'}</span> •{' '}
            Teslim Alan Kurum: <span className="font-medium">{displayShipment.recipientHospital}</span> •{' '}
            Tarih: <span className="font-medium"><TimestampText value={displayShipment.timestamp}/></span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[60vh] border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stok Kodu</TableHead>
                  <TableHead>Ürün</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead>Miad</TableHead>
                  <TableHead>Adet</TableHead>
                  <TableHead className="text-left">Seri Numaraları</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableData.map((it: any, idx: number) => (
                  <TableRow key={`${it.stokKodu}-${idx}`}>
                    <TableCell className="font-mono text-xs">{it.stokKodu}</TableCell>
                    <TableCell>{it.stokAdi}</TableCell>
                    <TableCell>{it.lotNumarasi || ''}</TableCell>
                    <TableCell><TimestampText value={it.miad}/></TableCell>
                    <TableCell>{it.quantity}</TableCell>
                    <TableCell className="font-mono text-xs text-left whitespace-pre-wrap break-words">
                      {(it.serialNumbers || []).join(', ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
