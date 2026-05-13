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
import { cn } from '@/lib/utils';

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
  status: string;
  urgency: string;
};

function getStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Beklemede</span>;
    case 'toplaniyor':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Hazırlanıyor</span>;
    case 'completed':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">Teslim Edildi</span>;
    case 'eksik':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400">Eksik Onaylandı</span>;
    case 'cancelled':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">İptal</span>;
    default:
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400">{status}</span>;
  }
}

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
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Sipariş Detayı</CardTitle>
              <CardDescription className="mt-1">
                ID: <span className="font-mono text-xs font-semibold">{order.id.toUpperCase()}</span> • Açan: <span className="font-medium text-foreground">{order.createdBy || '-'}</span>
              </CardDescription>
            </div>
            <div className="text-right">
              {getStatusBadge(order.status)}
              {order.urgency && order.urgency !== 'normal' && (
                <div className="mt-1">
                  <span className={cn(
                    "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border",
                    order.urgency === 'cok_acil' ? "border-red-500 text-red-500" : "border-amber-500 text-amber-500"
                  )}>
                    {order.urgency === 'cok_acil' ? 'ÇOK ACİL' : 'ACİL'}
                  </span>
                </div>
              )}
            </div>
          </div>
          <CardDescription className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4 pt-4 border-t">
            <div>
              <span className="text-xs uppercase font-bold block text-muted-foreground mb-1">Tarih & Saat</span>
              <span className="font-medium text-foreground text-sm">
                {order.createdAt ? format(new Date(order.createdAt), 'dd MMM yyyy, HH:mm', { locale: tr }) : '-'}
              </span>
            </div>
            <div>
              <span className="text-xs uppercase font-bold block text-muted-foreground mb-1">Hedef Laboratuvar</span>
              <span className="font-medium text-foreground text-sm">{order.kurumAdi || '-'}</span>
            </div>
            <div>
              <span className="text-xs uppercase font-bold block text-muted-foreground mb-1">Kaynak Depo</span>
              <span className="font-medium text-foreground text-sm">{order.depotName || '-'}</span>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stok Kodu</TableHead>
                <TableHead>Ürün</TableHead>
                <TableHead className="text-right">Adet</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items?.length ? (
                order.items.map((item, index) => (
                  <TableRow key={`${item.stokKodu}-${index}`}>
                    <TableCell className="font-mono text-xs">{item.stokKodu}</TableCell>
                    <TableCell className="font-medium">{item.stokAdi}</TableCell>
                    <TableCell className="text-right font-bold text-primary">{item.adet}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-10">Kalem bulunamadı.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
