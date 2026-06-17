'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Table2 } from 'lucide-react';
import { orderBy } from 'firebase/firestore';
import BackButton from '@/components/BackButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/contexts/auth-context';
import { getScopedDocs } from '@/lib/firestore-helpers';
import { exportDataToExcel } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

type HistoryKind = 'kumulatif' | 'cihazUstu';

type HistoryItem = {
  productId: string;
  productName?: string;
  testName?: string;
  matchedTests?: string[];
  routine?: number;
  rerun?: number;
  calib?: number;
  control?: number;
  total?: number;
  value?: number;
};

type HistoryRecord = {
  id: string;
  hospitalId?: string;
  hospitalName?: string;
  scopeLabel?: string;
  period?: string;
  month?: number;
  year?: number;
  rowCount?: number;
  items?: HistoryItem[];
  createdAt?: any;
  createdByName?: string;
};

const config = {
  kumulatif: {
    title: 'Kümülatif Hesaplama Geçmişi',
    collection: 'kumulatifHesaplamaGecmisi',
    fallback: '/kumulatif-hesaplama',
    sheet: 'Kümülatif Geçmiş',
  },
  cihazUstu: {
    title: 'Cihaz Üstü Hesaplama Geçmişi',
    collection: 'cihazUstuGecmisi',
    fallback: '/cihaz-ustu-hesaplama',
    sheet: 'Cihaz Üstü Geçmiş',
  },
} as const;

function formatDate(value: any): string {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
  return date ? date.toLocaleString('tr-TR') : '-';
}

export default function QoreHesaplamaGecmisPanel({ kind }: { kind: HistoryKind }) {
  const cfg = config[kind];
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const docs = await getScopedDocs(cfg.collection, currentCompanyId, !!isSuperAdmin, orderBy('createdAt', 'desc'));
        if (!alive) return;
        setRecords(docs.map((d) => ({ id: d.id, ...d.data() } as HistoryRecord)));
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Geçmiş kayıtları yüklenemedi.');
        setRecords([]);
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [cfg.collection, currentCompanyId, isSuperAdmin]);

  const selected = useMemo(() => records.find((record) => record.id === selectedId) || records[0] || null, [records, selectedId]);

  function exportRecord(record: HistoryRecord) {
    const data = (record.items || []).map((item) => ({
      'Stok Kodu': item.productId,
      'Stok Adı': item.productName || '',
      'Test Adı': item.testName || '',
      'Eşleşen Dosya Testi': (item.matchedTests || []).join(', '),
      ...(kind === 'kumulatif'
        ? { Routine: item.routine || 0, Rerun: item.rerun || 0, Calib: item.calib || 0, Control: item.control || 0, Total: item.total || 0 }
        : { 'Toplam Kullanılabilir': item.value || 0 }),
    }));
    exportDataToExcel(data, `${cfg.sheet}_${record.hospitalName || record.hospitalId || 'Lab'}_${record.period || ''}`, cfg.sheet, toast);
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <BackButton fallback={cfg.fallback} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Table2 className="h-5 w-5 text-primary" />{cfg.title}</CardTitle>
          <CardDescription>Kaydedilmiş lab/havuz ve dönem bazlı hesaplama kayıtlarını görüntüleyin, detaylarını açın ve Excel'e aktarın.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="destructive"><AlertTitle>Hata</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…</div>
          ) : records.length === 0 ? (
            <div className="text-sm text-muted-foreground">Henüz kayıt yok.</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.4fr] gap-4">
              <ScrollArea className="h-[55vh] rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow><TableHead>Lab/Havuz</TableHead><TableHead>Dönem</TableHead><TableHead>Satır</TableHead><TableHead>Kayıt</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((record) => (
                      <TableRow key={record.id} className="cursor-pointer" onClick={() => setSelectedId(record.id)}>
                        <TableCell className="font-medium">{record.scopeLabel || record.hospitalName || record.hospitalId || '-'}</TableCell>
                        <TableCell>{record.period || `${record.month ?? '-'}-${record.year ?? '-'}`}</TableCell>
                        <TableCell>{record.rowCount ?? record.items?.length ?? 0}</TableCell>
                        <TableCell>{formatDate(record.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>

              {selected && (
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Detay — {selected.scopeLabel || selected.hospitalName || selected.hospitalId}</CardTitle>
                      <CardDescription>{selected.period} • {formatDate(selected.createdAt)}</CardDescription>
                    </div>
                    <Button variant="outline" onClick={() => exportRecord(selected)}><Download className="mr-2 h-4 w-4" /> Excel</Button>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[48vh] rounded-md border">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow>
                            <TableHead>Stok Kodu</TableHead><TableHead>Stok Adı</TableHead><TableHead>Test Adı</TableHead><TableHead>Eşleşen</TableHead>
                            {kind === 'kumulatif' ? <><TableHead className="text-right">Routine</TableHead><TableHead className="text-right">Rerun</TableHead><TableHead className="text-right">Calib</TableHead><TableHead className="text-right">Control</TableHead><TableHead className="text-right">Total</TableHead></> : <TableHead className="text-right">Toplam Kullanılabilir</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(selected.items || []).map((item) => (
                            <TableRow key={`${item.productId}-${item.testName}`}>
                              <TableCell className="font-medium">{item.productId}</TableCell>
                              <TableCell>{item.productName}</TableCell>
                              <TableCell>{item.testName}</TableCell>
                              <TableCell className="text-muted-foreground">{(item.matchedTests || []).join(', ') || '-'}</TableCell>
                              {kind === 'kumulatif' ? <><TableCell className="text-right">{item.routine || 0}</TableCell><TableCell className="text-right">{item.rerun || 0}</TableCell><TableCell className="text-right">{item.calib || 0}</TableCell><TableCell className="text-right">{item.control || 0}</TableCell><TableCell className="text-right font-semibold">{item.total || 0}</TableCell></> : <TableCell className="text-right font-semibold">{item.value || 0}</TableCell>}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
