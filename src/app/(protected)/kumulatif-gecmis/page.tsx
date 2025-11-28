'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ChevronDown, ChevronRight, FileSpreadsheet, History, Loader2 } from 'lucide-react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { exportDataToExcel } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';

type Row = { test: string; routine: number; rerun: number; calib: number; control: number; total: number; };

type HistoryItem = {
  id: string;
  hospitalName: string;
  month: number;
  year: number;
  summary: Record<string, Omit<Row, 'test'>>;
  fileNames?: string[];
  createdAt?: any;
};

export default function KumulatifGecmisPanel() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'kumulatifRaporlar'), orderBy('createdAt', 'desc')));
        const list: HistoryItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setItems(list);
      } catch(e) {
        console.error(e);
        toast({ title: 'Hata', description: 'Geçmiş verileri yüklenemedi.', variant: 'destructive'});
      }
      finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const exportExcel = (item: HistoryItem) => {
    const data = Object.entries(item.summary).map(([test, values]) => ({ Test: test, ...values }));
    const fname = `Kumulatif_${item.hospitalName}_${String(item.month + 1).padStart(2, '0')}-${item.year}`;
    exportDataToExcel(data, fname, 'Rapor', toast);
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2">Yükleniyor…</span></div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Kümülatif Geçmişi
          </CardTitle>
          <CardDescription>Kaydedilen dönemler ve detayları. Başlıklara tıklayarak açabilirsiniz.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-muted-foreground text-sm">Henüz geçmiş kaydı yok.</div>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {items.map((item) => {
                const title = `${item.hospitalName} - ${new Date(item.year, item.month).toLocaleString('tr-TR', { month: 'long', year: 'numeric' })}`;
                const rows = Object.entries(item.summary || {}).map(([test, v]) => ({ test, ...v })).sort((a,b)=>a.test.localeCompare(b.test));
                return (
                  <AccordionItem key={item.id} value={item.id} className="border rounded-lg mb-2">
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className='flex justify-between w-full items-center'>
                         <span>{title}</span>
                         <span className='text-xs text-muted-foreground'>{item.createdAt?.toDate?.().toLocaleDateString('tr-TR')}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="px-4 pb-4">
                        <div className="flex justify-between items-center mb-2">
                            <div className="text-xs text-muted-foreground">
                            Kaynak: {item.fileNames?.join(', ') || '—'}
                            </div>
                            <Button size="sm" variant="outline" onClick={() => exportExcel(item)}>
                                <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel’e Aktar
                            </Button>
                        </div>
                        <ScrollArea className="h-[50vh] border rounded-md">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Test</TableHead>
                                <TableHead className="text-right">Routine</TableHead>
                                <TableHead className="text-right">Rerun</TableHead>
                                <TableHead className="text-right">Calib</TableHead>
                                <TableHead className="text-right">Control</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rows.map((r) => (
                                <TableRow key={r.test}>
                                  <TableCell className="font-medium">{r.test}</TableCell>
                                  <TableCell className="text-right">{r.routine}</TableCell>
                                  <TableCell className="text-right">{r.rerun}</TableCell>
                                  <TableCell className="text-right">{r.calib}</TableCell>
                                  <TableCell className="text-right">{r.control}</TableCell>
                                  <TableCell className="text-right">{r.total}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}