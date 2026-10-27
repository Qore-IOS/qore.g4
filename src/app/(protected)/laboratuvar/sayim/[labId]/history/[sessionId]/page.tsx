
'use client';
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { db } from '../../../../../../../lib/data/client';
import { doc, getDoc } from '../../../../../../../lib/data/client';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2, FileSpreadsheet, Check, X } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import { exportDataToExcel } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function HistoryDetailPage() {
  const params = useParams();
  const labId = Array.isArray(params?.labId) ? params.labId[0] : params?.labId;
  const sessionId = Array.isArray(params?.sessionId) ? params.sessionId[0] : params?.sessionId;
  const { toast } = useToast();

  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!labId || !sessionId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'hospitals', labId, 'stockCounts', sessionId));
        if (snap.exists()) {
          const data = snap.data();
          const finishedAt = data.finishedAt?.toDate ? data.finishedAt.toDate() : new Date();
          setDetail({ id: snap.id, ...data, finishedAt });
        }
      } catch (e) {
        console.error('Error loading session detail:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [labId, sessionId]);

  const handleExport = () => {
    if (!detail) return;
    const summary = detail.items.map((r: any) => ({
      'Stok Kodu': r.stokKodu,
      'Stok Adı': r.stokAdi,
      'Lot': r.lotNumarasi,
      'Miad': r.miad,
      'Beklenen Adet': r.expected,
      'Sayılan Adet': r.counted,
      'Fark': r.expected - r.counted,
    }));
    const serials = detail.items.flatMap((r: any) => [
      ...r.verifiedSerials.map((sn: string) => ({
        'Stok Kodu': r.stokKodu,
        'Stok Adı': r.stokAdi,
        'Lot': r.lotNumarasi,
        'Miad': r.miad,
        'Seri No': sn,
        'Durum': 'Okutuldu',
      })),
       ...r.unscannedSerials.map((sn: string) => ({
        'Stok Kodu': r.stokKodu,
        'Stok Adı': r.stokAdi,
        'Lot': r.lotNumarasi,
        'Miad': r.miad,
        'Seri No': sn,
        'Durum': 'Okunmadı',
      }))
    ]);

    exportDataToExcel(
      { Özet: summary, 'Seri No Detay': serials },
      `Sayim_${detail.laboratoryName}_${format(detail.finishedAt, 'yyyyMMdd_HHmm')}`,
      toast
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!detail) {
    return <div className="p-4">Sayım detayı bulunamadı.</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback={`/laboratuvar-yonetimi`} />
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Sayım Detayı: {detail.laboratoryName}</CardTitle>
            <CardDescription>
              {detail.createdByName} — {detail.finishedAt ? format(detail.finishedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : 'Tarih Yok'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'e Aktar
          </Button>
        </CardHeader>
        <CardContent>
          <h3 className="text-lg font-semibold mb-2">Özet</h3>
          <Table>
            <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead>Lot</TableHead><TableHead>Miad</TableHead><TableHead>Beklenen</TableHead><TableHead>Sayılan</TableHead><TableHead>Fark</TableHead></TableRow></TableHeader>
            <TableBody>
              {detail.items.map((r:any, idx: number) => (
                <TableRow key={`${r.stokKodu}-${idx}`}>
                  <TableCell>{r.stokAdi} ({r.stokKodu})</TableCell>
                  <TableCell>{r.lotNumarasi}</TableCell>
                  <TableCell>{r.miad}</TableCell>
                  <TableCell>{r.expected}</TableCell>
                  <TableCell>{r.counted}</TableCell>
                  <TableCell className={cn(r.expected - r.counted !== 0 && 'font-bold text-destructive')}>{r.expected - r.counted}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <h3 className="text-lg font-semibold mt-6 mb-2">Seri Numarası Detayları</h3>
          <ScrollArea className="h-[50vh]">
            <Accordion type="multiple" defaultValue={detail.items.map((_: any, i: number) => `item-${i}`)}>
              {detail.items.map((r: any, i: number) => (
                <AccordionItem key={i} value={`item-${i}`} className="border-b">
                  <AccordionTrigger className="flex justify-between hover:no-underline p-2 rounded-md">
                    <span>{r.stokAdi} ({r.stokKodu})</span>
                    <span>{r.counted}/{r.expected}</span>
                  </AccordionTrigger>
                  <AccordionContent className="p-2 bg-muted/50 rounded-md">
                    <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 font-mono text-xs">
                      {r.verifiedSerials?.map((sn: string) => (
                        <li key={sn} className="p-1 rounded flex items-center gap-1 truncate bg-green-200">
                          <Check className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">{sn}</span>
                        </li>
                      ))}
                       {r.unscannedSerials?.map((sn: string) => (
                         <li key={sn} className="p-1 rounded flex items-center gap-1 truncate bg-red-200">
                           <X className="h-4 w-4 flex-shrink-0" />
                           <span className="truncate">{sn}</span>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
