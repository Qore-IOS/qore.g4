'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

type OrderItem = {
  id: string;
  stokKodu: string;
  stokAdi: string;
  adet: number;
};

type OrderDetail = {
  id: string;
  createdBy: string;
  kurumAdi: string;
  depotName: string;
  createdAt: string | null;
  items: OrderItem[];
};

export default function UrunTalepGecmisDetayPanel() {
  const params = useParams();
  const { toast } = useToast();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderDetail | null>(null);

  useEffect(() => {
    if (!id) return;

    const controller = new AbortController();

    (async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/urun-talep-gecmis/${id}`, {
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error('Sipariş detayı alınamadı.');
        }

        const payload = await response.json();
        setOrder(payload.data);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        toast({ title: 'Hata', description: 'Sipariş detayı yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [id, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Yükleniyor...</span>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-4 space-y-4">
        <BackButton fallback="/urun-talep/gecmis" />
        <Card>
          <CardContent className="pt-6 text-muted-foreground">Kayıt bulunamadı.</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/urun-talep/gecmis" />
      <Card>
        <CardHeader>
          <CardTitle>Sipariş Detayı</CardTitle>
          <CardDescription>
            ID: <span className="font-mono text-xs">{order.id}</span> • Açan: <span className="font-medium">{order.createdBy || '-'}</span> • 
            Tarih: <span className="font-medium">{order.createdAt ? format(new Date(order.createdAt), 'dd MMM yyyy, HH:mm', { locale: tr }) : '-'}</span>
          </CardDescription>
          <CardDescription>
            Kaynak Depo: <span className="font-medium">{order.depotName || '-'}</span> • Hedef Laboratuvar: <span className="font-medium">{order.kurumAdi || '-'}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stok Kodu</TableHead>
                <TableHead>Ürün</TableHead>
                <TableHead>Adet</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items?.length ? (
                order.items.map((item, index) => (
                  <TableRow key={`${item.stokKodu}-${index}`}>
                    <TableCell className="font-mono text-xs">{item.stokKodu}</TableCell>
                    <TableCell>{item.stokAdi}</TableCell>
                    <TableCell>{item.adet}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">Kalem bulunamadı.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
