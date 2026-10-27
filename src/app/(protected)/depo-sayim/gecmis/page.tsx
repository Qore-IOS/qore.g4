
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '../../../../lib/data/client';
import { orderBy, onSnapshot } from '../../../../lib/data/client';
import type { DepotStockCountSession } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Loader2, History } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/document-helpers';
import BackButton from '@/components/BackButton';

export default function DepoSayimGecmisPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [sessions, setSessions] = useState<DepotStockCountSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = scopedQuery('depotBrandCountSessions', currentCompanyId, isSuperAdmin, orderBy('closedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessionList = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          closedAt: data.closedAt?.toDate ? data.closedAt.toDate() : null,
        } as DepotStockCountSession;
      });
      setSessions(sessionList);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching count sessions:", error);
      toast({ title: 'Hata', description: 'Sayım geçmişi yüklenemedi.', variant: 'destructive' });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentCompanyId, isSuperAdmin, toast]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <BackButton fallback="/depo-sayim" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-6 w-6 text-primary" />
            Depo Sayım Geçmişi
          </CardTitle>
          <CardDescription>Tamamlanmış tüm depo sayım oturumlarının listesi.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="q-table" data-mobile-mode="stack">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>İşlem ID</TableHead>
                    <TableHead>Depo</TableHead>
                    <TableHead>Sayım Yapan</TableHead>
                    <TableHead>Tarih/Saat</TableHead>
                    <TableHead>Detaylar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center">
                        Geçmiş depo sayımı bulunamadı.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sessions.map((session) => (
                      <TableRow
                        key={session.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/depo-sayim/gecmis/${session.id}`)}
                      >
                        <TableCell data-label="İşlem ID" className="font-mono text-xs">{session.id}</TableCell>
                        <TableCell data-label="Depo">{session.depotName || session.brand || '-'}</TableCell>
                        <TableCell data-label="Kullanıcı">{session.createdByName}</TableCell>
                        <TableCell data-label="Tarih/Saat">
                          {session.closedAt ? format(session.closedAt as Date, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}
                        </TableCell>
                        <TableCell data-label="Detaylar">
                          {session.itemCount || 0} mevcut, {session.scannedCount || 0} sayıldı, {session.missingCount || 0} eksik.
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
