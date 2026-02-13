'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Loader2, History } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';

type RequestHistoryItem = {
  id: string;
  itemCount: number;
  createdBy: string;
  createdAt: string | null;
};

export default function UrunTalepGecmisPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<RequestHistoryItem[]>([]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/urun-talep-gecmis?createdById=${currentUser.uid}`, {
          signal: controller.signal,
          cache: 'no-store',
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || 'Geçmiş verisi alınamadı.');
        }
        setOrders(payload.data || []);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        toast({ title: 'Hata', description: (error as Error).message || 'Ürün talep geçmişi yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [currentUser?.uid, toast]);

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/urun-talep" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Ürün Talep Geçmişi
          </CardTitle>
          <CardDescription>
            Önceki taleplerinizi görüntüleyin. Satıra tıklayarak sipariş detayını açabilirsiniz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-56">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Yükleniyor...</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sipariş ID</TableHead>
                  <TableHead>Kalem Sayısı</TableHead>
                  <TableHead>Açan Kişi</TableHead>
                  <TableHead>Tarih & Saat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Geçmiş sipariş bulunamadı.
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => (
                    <TableRow
                      key={order.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/urun-talep/gecmis/${order.id}`)}
                    >
                      <TableCell className="font-mono text-xs">{order.id}</TableCell>
                      <TableCell>{order.itemCount}</TableCell>
                      <TableCell>{order.createdBy || '-'}</TableCell>
                      <TableCell>
                        {order.createdAt
                          ? format(new Date(order.createdAt), 'dd MMM yyyy, HH:mm', { locale: tr })
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
