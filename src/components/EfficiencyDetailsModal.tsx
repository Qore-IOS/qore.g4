
'use client';
import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as ShadcnCardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';
import { X } from 'lucide-react';
import type { EfficiencyData, ProductCode, Hospital, VerimlilikAnalizi } from '@/lib/types';
import { tr } from 'date-fns/locale';
import { format } from 'date-fns';

interface EfficiencyHistoryRecord {
  id: string;
  hospitalName: string;
  month: number;
  year: number;
  rows: ResultRow[];
}

interface EfficiencyDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  efficiencyHistoryRecords: EfficiencyHistoryRecord[];
  productCodes: ProductCode[];
  hospitals: Hospital[];
}

interface ResultRow extends VerimlilikAnalizi {
    productId: string;
    productName: string;
    unknownLossBoxes: number;
    kitEffPct: number;
    deviceEffPct: number;
    unknownLoss: number;
    knownLoss: number;
    anaTuketimTestAdeti: number;
}

export default function EfficiencyDetailsModal({
  isOpen,
  onClose,
  efficiencyHistoryRecords,
  productCodes,
  hospitals
}: EfficiencyDetailsModalProps) {
  
  const allResults = useMemo(() => {
    if (!efficiencyHistoryRecords) return [];
    return efficiencyHistoryRecords.map(record => {
      return {
        hospitalName: record.hospitalName,
        month: format(new Date(record.year, record.month), 'LLLL yyyy', { locale: tr }),
        results: record.rows || []
      };
    }).filter(data => data.results.length > 0);
  }, [efficiencyHistoryRecords]);


  const chartData = useMemo(() => {
    const data: Record<string, { name: string; stokKodu: string, "Bilinmeyen Fire": number, "Bilinen Fire": number }> = {};
    if (!allResults) return [];
    
    allResults.forEach(hospitalData => {
        hospitalData.results.forEach(res => {
            if (!res.productId) return;
            if (!data[res.productId]) {
                const productName = res.productName || res.productId;
                data[res.productId] = { name: productName.substring(0, 15), stokKodu: res.productId, "Bilinmeyen Fire": 0, "Bilinen Fire": 0 };
            }
            data[res.productId]["Bilinmeyen Fire"] += res.unknownLoss < 0 ? 0 : res.unknownLoss;
            data[res.productId]["Bilinen Fire"] += res.knownLoss;
        });
    });
    return Object.values(data);
  }, [allResults]);

  const yAxisTickFormatter = (value: string) => {
    const item = chartData.find(d => d.stokKodu === value);
    return item ? item.name : value;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl font-headline text-primary">Detaylı Verimlilik Raporu</DialogTitle>
          <DialogDescription>Tüm hastaneler için son hesaplanan verimlilik sonuçları.</DialogDescription>
        </DialogHeader>
        
        <div className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-6 px-6 overflow-hidden">
            <Card className="flex flex-col">
                <CardHeader>
                    <CardTitle>Genel Fire Analizi (Tüm Hastaneler)</CardTitle>
                </CardHeader>
                <CardContent className="flex-grow">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="stokKodu" width={120} style={{fontSize: '10px'}} interval={0} tickFormatter={yAxisTickFormatter} />
                        <Tooltip cursor={{fill: 'rgba(var(--foreground), 0.1)'}} />
                        <Legend />
                        <Bar dataKey="Bilinen Fire" stackId="a" fill="hsl(var(--chart-5))" />
                        <Bar dataKey="Bilinmeyen Fire" stackId="a" fill="hsl(var(--destructive))" />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            <ScrollArea className="h-full">
                <div className="space-y-6 pr-6">
                {allResults.map(data => (
                    <Card key={data.hospitalName + data.month}>
                        <CardHeader>
                            <CardTitle>{data.hospitalName}</CardTitle>
                            <ShadcnCardDescription>{data.month} Ayı Sonuçları</ShadcnCardDescription>
                        </CardHeader>
                        <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Ürün</TableHead>
                                    <TableHead>Ana Tüketim</TableHead>
                                    <TableHead>Bilinen Fire</TableHead>
                                    <TableHead>Bilinmeyen Fire (Test)</TableHead>
                                    <TableHead>Bilinmeyen Fire (Kutu)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                            {data.results.map(res => (
                                <TableRow key={res.productId}>
                                    <TableCell className="font-medium">{res.productName}</TableCell>
                                    <TableCell>{res.anaTuketimTestAdeti}</TableCell>
                                    <TableCell className="text-amber-500">{res.knownLoss}</TableCell>
                                    <TableCell className="text-destructive font-semibold">{res.unknownLoss < 0 ? 0 : res.unknownLoss}</TableCell>
                                    <TableCell className="text-destructive font-semibold">{res.unknownLossBoxes}</TableCell>
                                </TableRow>
                            ))}
                            </TableBody>
                        </Table>
                        </CardContent>
                    </Card>
                ))}
                </div>
            </ScrollArea>
        </div>

        <DialogClose asChild className="absolute right-4 top-4">
            <Button variant="ghost" size="icon">
                <X className="h-5 w-5" />
            </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
