'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Loader2, History } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';

type RequestHistoryItem = {
  id: string;
  itemCount: number;
  createdBy: string;
  createdAt: string | null;
  status: string;
  urgency: string;
};

const DEFAULT_PAGE_SIZE = 20;

function getStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Beklemede</span>;
    case 'toplaniyor':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Hazırlanıyor</span>;
    case 'completed':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">Teslim</span>;
    case 'eksik':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400">Eksik</span>;
    case 'cancelled':
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">İptal</span>;
    default:
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400">{status}</span>;
  }
}

export default function UrunTalepGecmisPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { currentUser, currentUserProfile } = useAuth();

  const urlLabId = searchParams.get('labId');

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<RequestHistoryItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Pagination state
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_PAGE_SIZE);

  // Cursor stack: cursorStack[i] = lastDocId for page (i+1)
  const cursorStackRef = useRef<(string | null)[]>([]);

  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));

  // Determine labIds from profile or URL
  const labFilter = urlLabId || (currentUserProfile?.assignedLaboratories || []).join(',');

  /**
   * Fetch total count from the server
   */
  const fetchTotalCount = useCallback(async (uid: string, filter: string, signal: AbortSignal) => {
    try {
      let url = `/api/urun-talep-gecmis?countOnly=true`;
      if (filter.includes(',')) url += `&labIds=${filter}`;
      else if (filter) url += `&labId=${filter}`;
      else url += `&createdById=${uid}`;

      const response = await fetch(url, { signal, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Sayım alınamadı.');
      setTotalCount(payload.totalCount ?? 0);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setTotalCount(0);
    }
  }, []);

  /**
   * Fetch a page of data from the server
   */
  const fetchPage = useCallback(async (
    uid: string,
    filter: string,
    pageNum: number,
    pageSize: number,
    cursors: (string | null)[],
    signal: AbortSignal
  ) => {
    setLoading(true);
    try {
      const startAfterId = pageNum > 1 ? cursors[pageNum - 2] : null;

      let url = `/api/urun-talep-gecmis?pageSize=${pageSize}`;
      if (filter.includes(',')) url += `&labIds=${filter}`;
      else if (filter) url += `&labId=${filter}`;
      else url += `&createdById=${uid}`;

      if (startAfterId) {
        url += `&startAfterId=${startAfterId}`;
      }

      const response = await fetch(url, { signal, cache: 'no-store' });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || 'Geçmiş verisi alınamadı.');
      }

      setOrders(payload.data || []);

      if (payload.lastDocId) {
        const newCursors = [...cursors];
        newCursors[pageNum - 1] = payload.lastDocId;
        cursorStackRef.current = newCursors;
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      toast({
        title: 'Hata',
        description: (error as Error).message || 'Ürün talep geçmişi yüklenemedi.',
        variant: 'destructive',
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Reset pagination when page size changes
  useEffect(() => {
    setPage(1);
    cursorStackRef.current = [];
  }, [rowsPerPage]);

  // Fetch total count on mount and when labs change
  useEffect(() => {
    if (!currentUser?.uid) return;
    const controller = new AbortController();
    fetchTotalCount(currentUser.uid, labFilter, controller.signal);
    return () => controller.abort();
  }, [currentUser?.uid, labFilter, fetchTotalCount]);

  // Fetch current page data
  useEffect(() => {
    if (!currentUser?.uid) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    fetchPage(currentUser.uid, labFilter, page, rowsPerPage, cursorStackRef.current, controller.signal);
    return () => controller.abort();
  }, [currentUser?.uid, labFilter, page, rowsPerPage, fetchPage]);

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
            {labFilter ? 'Laboratuvarınıza ait talepleri görüntüleyin.' : 'Önceki taleplerinizi görüntüleyin.'} Satıra tıklayarak sipariş detayını açabilirsiniz.
            {totalCount > 0 && (
              <span className="ml-2 font-medium">({totalCount} kayıt)</span>
            )}
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
                  <TableHead>Durum</TableHead>
                  <TableHead>Kalem Sayısı</TableHead>
                  <TableHead>Açan Kişi</TableHead>
                  <TableHead>Tarih & Saat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Geçmiş sipariş bulunamadı.
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => (
                    <TableRow
                      key={order.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => router.push(`/urun-talep/gecmis/${order.id}`)}
                    >
                      <TableCell className="font-mono text-xs font-semibold">{order.id.slice(-8).toUpperCase()}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getStatusBadge(order.status)}
                          {order.urgency && order.urgency !== 'normal' && (
                            <span className={cn(
                              "text-[9px] font-bold uppercase px-1 py-0.5 rounded border self-start",
                              order.urgency === 'cok_acil' ? "border-red-500 text-red-500 bg-red-50" : "border-amber-500 text-amber-500 bg-amber-50"
                            )}>
                              {order.urgency === 'cok_acil' ? 'ÇOK ACİL' : 'ACİL'}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{order.itemCount} kalem</TableCell>
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
        {totalPages > 1 && (
          <CardFooter className="flex items-center justify-between mt-4 pt-4 border-t">
            <div className="flex items-center space-x-2 text-sm">
              <span>Satır/sayfa:</span>
              <Select
                value={String(rowsPerPage)}
                onValueChange={(val) => {
                  setRowsPerPage(Number(val));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[20, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                Önceki
              </Button>
              <span className="text-sm font-medium">
                Sayfa {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
