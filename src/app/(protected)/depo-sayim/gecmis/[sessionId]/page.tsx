'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Check, Download, Loader2, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';
import { toDateSafe } from '@/lib/date';
import type { DepoCountHistoryItem } from '@/components/depo-sayim/depo-logic';

type CountSession = {
  id: string;
  depotName?: string;
  brand?: string | null;
  createdByName?: string;
  closedAt?: unknown;
  itemCount?: number;
  scannedCount?: number;
  missingCount?: number;
  extraCount?: number;
  scannedItems?: Array<Record<string, any>>;
};

type HistoryRow = DepoCountHistoryItem & { id: string };

function legacyRows(session: CountSession): HistoryRow[] {
  return (Array.isArray(session.scannedItems) ? session.scannedItems : []).map((group, index) => {
    const expectedSerials = (group.items || []).map((item: any) => item.seriNumarasi).filter(Boolean);
    const countedSerials = (group.scannedSerials || []).filter(Boolean);
    return {
      id: group.id || `legacy-${index}`,
      stokKodu: group.stokKodu || '', stokAdi: group.stokAdi || 'Ürün', labName: group.labName || '',
      serialTracked: true, currentQty: expectedSerials.length, countedQty: countedSerials.length,
      expectedSerials, countedSerials,
      deletedSerials: expectedSerials.filter((serial: string) => !countedSerials.includes(serial)),
    };
  });
}

export default function DepoSayimDetayPage() {
  const params = useParams();
  const sessionId = Array.isArray(params?.sessionId) ? params.sessionId[0] : params?.sessionId;
  const router = useRouter();
  const { toast } = useToast();
  const [session, setSession] = useState<CountSession | null>(null);
  const [items, setItems] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      try {
        const sessionRef = doc(db, 'depotBrandCountSessions', sessionId);
        const [sessionSnap, itemsSnap] = await Promise.all([
          getDoc(sessionRef),
          getDocs(collection(sessionRef, 'items')),
        ]);
        if (!sessionSnap.exists()) {
          toast({ title: 'Hata', description: 'Sayım oturumu bulunamadı.', variant: 'destructive' });
          router.push('/depo-sayim/gecmis');
          return;
        }
        const loaded = { id: sessionSnap.id, ...sessionSnap.data() } as CountSession;
        setSession(loaded);
        const detailRows = itemsSnap.docs.map(item => ({ id: item.id, ...item.data() } as HistoryRow));
        setItems(detailRows.length ? detailRows : legacyRows(loaded));
      } catch (error) {
        console.error('Error fetching session details:', error);
        toast({ title: 'Hata', description: 'Oturum detayları yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, router, toast]);

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const summary = items.map(item => ({
      'Laboratuvar': item.labName, 'Stok Kodu': item.stokKodu, 'Stok Adı': item.stokAdi,
      'Takip Tipi': item.serialTracked ? 'Seri No' : 'Adet', 'Mevcut': item.currentQty,
      'Sayılan': item.countedQty, 'Eksik': Math.max(0, item.currentQty - item.countedQty),
      'Fazla': Math.max(0, item.countedQty - item.currentQty),
    }));
    const serials = items.flatMap(item => item.expectedSerials.map(serial => ({
      'Stok Kodu': item.stokKodu, 'Stok Adı': item.stokAdi, 'Seri No': serial,
      'Durum': item.deletedSerials.includes(serial) ? 'Sayımda silindi' : 'Sayıldı',
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), 'Sayım Özeti');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(serials), 'Seri No Detayları');
    XLSX.writeFile(workbook, `${session?.depotName || 'Depo'}-sayim-gecmisi.xlsx`);
  };

  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!session) return <div className="p-4">Sayım detayı bulunamadı.</div>;
  const closedAt = toDateSafe(session.closedAt);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <BackButton fallback="/depo-sayim/gecmis" />
        <Button onClick={() => void exportExcel()} disabled={!items.length}><Download className="mr-2 h-4 w-4" />Excel&apos;e Aktar</Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Depo Sayım Detayı: {session.depotName || session.brand || 'Depo'}</CardTitle>
          <CardDescription>{session.createdByName || 'Bilinmeyen kullanıcı'} tarafından {closedAt ? format(closedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'} tarihinde tamamlandı.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[['Beklenen', session.itemCount || 0], ['Sayılan', session.scannedCount || 0], ['Eksik', session.missingCount || 0], ['Fazla', session.extraCount || 0]].map(([label, value]) => (
              <Card key={String(label)}><CardHeader className="p-4 text-center"><CardTitle>{value}</CardTitle><CardDescription>{label}</CardDescription></CardHeader></Card>
            ))}
          </div>
          <div className="q-table" data-mobile-mode="stack">
            <Table>
              <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead>Lab</TableHead><TableHead>Mevcut / Sayılan</TableHead><TableHead>Silinen Seri Nolar</TableHead></TableRow></TableHeader>
              <TableBody>
                {!items.length ? <TableRow><TableCell colSpan={4} className="h-24 text-center">Bu eski sayım için ürün detayı kaydedilmemiş.</TableCell></TableRow> : items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell data-label="Ürün"><div className="font-medium">{item.stokAdi}</div><div className="text-xs text-muted-foreground">{item.stokKodu}</div></TableCell>
                    <TableCell data-label="Lab">{item.labName || '-'}</TableCell>
                    <TableCell data-label="Mevcut / Sayılan">{item.currentQty} / {item.countedQty}</TableCell>
                    <TableCell data-label="Silinen Seri Nolar">
                      {!item.serialTracked ? <span className="text-muted-foreground">Adet takipli</span> : item.deletedSerials.length === 0 ? <span className="inline-flex items-center gap-1 text-green-700"><Check className="h-4 w-4" />Yok</span> : (
                        <div className="flex max-w-xl flex-wrap gap-1">{item.deletedSerials.map(serial => <span key={serial} className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-1 font-mono text-xs text-red-800"><X className="h-3 w-3" />{serial}</span>)}</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
