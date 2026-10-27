'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { db } from '../lib/data/client';
import {
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  doc,
  Timestamp,
} from '../lib/data/client';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  PieChart,
  Pie,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from 'recharts';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { scopedQuery } from '@/lib/document-helpers';

// Types
interface BorcTransfer {
  id: string;
  fromDepotId: string;
  toBorcDepotId: string;
  company: string;
  stokKodu: string;
  stokAdi: string;
  lot: string;
  miad: string;
  seriNumarasi: string;
  isReturned?: boolean;
  timestamp: Timestamp;
}

interface BorcReturn {
  id: string;
  fromBorcDepotId: string;
  company: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi: string;
  timestamp: Timestamp;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function BorcDepotPanel({
  fromDepotId,
  onBack,
}: {
  fromDepotId: string;
  onBack: () => void;
}) {
  const [transfers, setTransfers] = useState<BorcTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [inputValues, setInputValues] = useState<
    Record<string, Record<string, number>>
  >({});
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const tQ = query(
        scopedQuery('borcTransfers', currentCompanyId, isSuperAdmin),
        where('fromDepotId', '==', fromDepotId)
      );
      const [tSnap] = await Promise.all([getDocs(tQ)]);
      const fetchedTransfers = tSnap.docs.map(
        d => ({ id: d.id, ...d.data() } as BorcTransfer)
      );
      setTransfers(fetchedTransfers);

      // Initialize input values based on fetched data
      const initialInputs: Record<string, Record<string, number>> = {};
      const groupedByCompanyAndSku = fetchedTransfers.reduce((acc, t) => {
        acc[t.company] = acc[t.company] || {};
        acc[t.company][t.stokKodu] = acc[t.company][t.stokKodu] || [];
        acc[t.company][t.stokKodu].push(t);
        return acc;
      }, {} as Record<string, Record<string, BorcTransfer[]>>);
      
      for(const company in groupedByCompanyAndSku) {
        initialInputs[company] = {};
        for (const sku in groupedByCompanyAndSku[company]) {
            initialInputs[company][sku] = groupedByCompanyAndSku[company][sku].filter(t => t.isReturned).length;
        }
      }
      setInputValues(initialInputs);

    } catch (err) {
      console.error('Error fetching debt data:', err);
      toast({title: "Hata", description: "Borç verileri yüklenemedi.", variant: "destructive"});
    } finally {
      setLoading(false);
    }
  }, [fromDepotId, toast]);

  useEffect(() => {
    if (fromDepotId) fetchData();
  }, [fromDepotId, fetchData]);

  const {
    totalItems,
    distinctSKUs,
    totalReturned,
    returnRate,
    transferByCompany,
    transferBySku,
  } = useMemo(() => {
    const totalItems = transfers.length;
    const distinctSKUs = new Set(transfers.map(t => t.stokKodu)).size;
    const totalReturned = transfers.filter(t => t.isReturned).length;
    const returnRate = totalItems ? (totalReturned / totalItems) * 100 : 0;

    const transferByCompany = transfers.reduce((acc, t) => {
        acc[t.company] = acc[t.company] || [];
        acc[t.company].push(t);
        return acc;
    }, {} as Record<string, BorcTransfer[]>);

    const transferBySku = transfers.reduce((acc, t) => {
        acc[t.stokKodu] = acc[t.stokKodu] || [];
        acc[t.stokKodu].push(t);
        return acc;
    }, {} as Record<string, BorcTransfer[]>);

    return {
      totalItems,
      distinctSKUs,
      totalReturned,
      returnRate,
      transferByCompany,
      transferBySku,
    };
  }, [transfers]);

  const handleInputChange = (company: string, sku: string, value: number) => {
    setInputValues(prev => ({
      ...prev,
      [company]: { ...(prev[company] || {}), [sku]: value },
    }));
  };

  const handleSaveReturn = async (company: string, sku: string) => {
    setIsSaving(true);
    const desired = inputValues[company]?.[sku] ?? 0;
    const current = transfers.filter(t => t.company === company && t.stokKodu === sku && t.isReturned).length;
    const diff = desired - current;
    
    if (diff === 0) {
        setIsSaving(false);
        return;
    }

    if (diff < 0) {
        toast({title: "Hata", description: "Karşılanan adet azaltılamaz.", variant: "destructive"});
        setIsSaving(false);
        return;
    }
    
    const unreturnedItems = transfers.filter(t => 
        t.company === company && t.stokKodu === sku && !t.isReturned
    );

    if (diff > unreturnedItems.length) {
        toast({title: "Hata", description: `En fazla ${unreturnedItems.length} adet daha karşılanabilir.`, variant: "destructive"});
        setIsSaving(false);
        return;
    }

    const toUpdate = unreturnedItems.slice(0, diff);

    const batch = writeBatch(db);
    toUpdate.forEach(dSnap => {
      const trRef = doc(db, 'borcTransfers', dSnap.id);
      batch.update(trRef, { isReturned: true, returnTimestamp: new Date() });
    });
    
    try {
        await batch.commit();
        toast({title: "Kaydedildi", description: `${company} - ${sku} için ${diff} adet karşılama kaydedildi.`});
        await fetchData(); // Refetch all data to ensure consistency
    } catch(err) {
        console.error("Error saving return", err);
        toast({title: "Hata", description: "Karşılama kaydedilirken bir hata oluştu.", variant: "destructive"});
    } finally {
        setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const companyChartData = Object.entries(transferByCompany).map(
    ([company, txs], idx) => ({
      name: company,
      value: txs.length,
      returned: txs.filter(t => t.isReturned).length,
      color: COLORS[idx % COLORS.length],
    })
  );

  return (
    <div className="flex flex-col h-full space-y-6 p-4">
      <Button variant="ghost" onClick={onBack} className="self-start">
        <ArrowLeft className="mr-2 h-4 w-4" /> Geri
      </Button>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader><CardTitle>Toplam Borç Adeti</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{totalItems}</CardContent></Card>
        <Card><CardHeader><CardTitle>Toplam Kalem</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{distinctSKUs}</CardContent></Card>
        <Card><CardHeader><CardTitle>Toplam Karşılanan</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{totalReturned}</CardContent></Card>
        <Card><CardHeader><CardTitle>Karşılama Oranı</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{returnRate.toFixed(1)}%</CardContent></Card>
      </div>

       <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Firma Pay Dağılımı</CardTitle>
          </CardHeader>
          <CardContent className="h-48">
            {companyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={companyChartData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={80}
                    label
                  >
                    {companyChartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val, name, entry: any) =>
                      `${val} Borç, ${entry.payload.payload.returned} Karşılama`
                    }
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-sm">Veri yok</p>
            )}
          </CardContent>
        </Card>
        <Card>
            <CardHeader><CardTitle>Açık Borçlar</CardTitle></CardHeader>
            <CardContent>
                <div className="text-4xl font-bold text-destructive">{totalItems - totalReturned}</div>
                <p className="text-xs text-muted-foreground">Adet ürünün geri dönüşü bekleniyor.</p>
            </CardContent>
        </Card>
       </div>

      <div className="flex gap-6 flex-1 overflow-hidden">
        {/* SKU Table */}
        <Card className="flex-1 overflow-auto">
          <CardHeader>
            <CardTitle>Borç Verilen Ürünler</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stok Kodu</TableHead>
                  <TableHead>Stok Adı</TableHead>
                  <TableHead>Adet</TableHead>
                  <TableHead>Karşılama</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(transferBySku).map(([sku, txs]) => {
                  const returnedCount = txs.filter(t => t.isReturned).length;
                  return (
                    <TableRow key={sku}>
                      <TableCell>{sku}</TableCell>
                      <TableCell>{txs[0].stokAdi}</TableCell>
                      <TableCell>{txs.length}</TableCell>
                      <TableCell>
                        {returnedCount} ({txs.length ? ((returnedCount / txs.length) * 100).toFixed(1) : '0'}%)
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Company Details Accordion */}
        <Card className="overflow-auto flex-1">
          <CardHeader>
            <CardTitle>Firmalar</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="space-y-4">
              {Object.entries(transferByCompany).map(([company, txs]) => {
                const returnedCountCompany = txs.filter(t => t.isReturned).length;
                return (
                <AccordionItem key={company} value={company}>
                  <AccordionTrigger>
                    {company} — {txs.length} Borç, {returnedCountCompany} Karşılama
                  </AccordionTrigger>
                  <AccordionContent>
                    <ScrollArea className="max-h-60 pr-4">
                      {Object.entries(
                        txs.reduce<Record<string, BorcTransfer[]>>((acc, t) => {
                          acc[t.stokKodu] = acc[t.stokKodu] || [];
                          acc[t.stokKodu].push(t);
                          return acc;
                        }, {})
                      ).map(([sku, items]) => {
                        const lentCount = items.length;
                        const returnedCount = items.filter(t => t.isReturned).length;
                        return (
                          <div
                            key={sku}
                            className="flex items-center justify-between mb-2 p-2 rounded-md bg-background"
                          >
                            <div>
                              <span className="font-medium text-sm">{items[0].stokAdi}</span>
                              <span className="text-xs text-muted-foreground ml-2">({sku})</span>
                              <div className="text-xs text-muted-foreground">
                                 Borç: {lentCount}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                               <label className="text-xs">Karşılanan:</label>
                              <Input
                                type="number"
                                min={0}
                                max={lentCount}
                                value={inputValues[company]?.[sku] ?? returnedCount}
                                onChange={e => handleInputChange(company, sku, e.target.valueAsNumber)}
                                className="w-20 h-8"
                                disabled={isSaving}
                              />
                              <Button
                                size="sm"
                                onClick={() => handleSaveReturn(company, sku)}
                                disabled={isSaving || (inputValues[company]?.[sku] ?? returnedCount) === returnedCount}
                              >
                                Kaydet
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              )})}
            </Accordion>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
