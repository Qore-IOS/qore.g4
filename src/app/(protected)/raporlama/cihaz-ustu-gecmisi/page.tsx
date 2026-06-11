'use client';
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { FileSpreadsheet, History, Loader2 } from 'lucide-react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { db } from '@/lib/firebase';
import { exportDataToExcel } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';

type HistoryItem = {
  id: string;
  hospitalName: string;
  month: number;
  year: number;
  items: { productId: string; productName: string; value: number }[];
  period: string;
  createdAt?: any;
};

function CihazUstuGecmisiPanel() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocsResilient(scopedQuery('cihazUstuGecmisi', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc')));
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

  const exportExcel = (item: HistoryItem) => {
    const data = (item.items || []).map(it => ({
        'Ürün Kodu': it.productId,
        'Ürün Adı': it.productName,
        'Adet': it.value,
    }));
    const fname = `CihazUstu_${item.hospitalName}_${item.period}`;
    exportDataToExcel(data, fname, 'Rapor', toast);
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2">Yükleniyor…</span></div>;
  }

  return (
    <div className="space-y-4">
        <BackButton fallback="/raporlama" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Cihaz Üstü Stok Geçmişi
          </CardTitle>
          <CardDescription>Kaydedilen dönemler ve girilen stok adetleri.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-muted-foreground text-sm">Henüz geçmiş kaydı yok.</div>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {items.map((item) => {
                const title = `${item.hospitalName} - ${item.period}`;
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
                        <div className="flex justify-end items-center mb-2">
                            <Button size="sm" variant="outline" onClick={() => exportExcel(item)}>
                                <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel’e Aktar
                            </Button>
                        </div>
                        <ScrollArea className="h-[50vh] border rounded-md">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Ürün Adı</TableHead>
                                <TableHead>Stok Kodu</TableHead>
                                <TableHead className="text-right">Adet</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(item.items || []).map((r) => (
                                <TableRow key={r.productId}>
                                  <TableCell className="font-medium">{r.productName}</TableCell>
                                  <TableCell className="font-mono text-xs">{r.productId}</TableCell>
                                  <TableCell className="text-right">{r.value}</TableCell>
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

export default function CihazUstuGecmisiPage() {
    return <CihazUstuGecmisiPanel />;
}
