'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, History, ChevronUp, ChevronDown, Search, Download, FileSpreadsheet, Trash2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { exportDataToExcel } from '@/lib/utils';
import { Button } from './ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"


interface Row {
  productId: string;
  productName: string;
  consumption: number;
  carryOverPrev: number;
  total: number;
  rerun: number;
  routine: number;
  control: number;
  calib: number;
  eomDeviceOn: number;
  knownLoss: number;
  unknownLoss: number;
  unknownLossBoxes: number;
  deviceEffPct: number;
  kitEffPct: number;
  anaTuketimTestAdeti?: number;
  toplamFire?: number;
}

interface HistoryRecord {
  id: string;
  hospitalName: string;
  month: number;
  year: number;
  rows: Row[];
}

type SortKey = keyof Row;

const SortableHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  currentSortKey: SortKey;
  sortOrder: 'asc' | 'desc';
  setSort: (key: SortKey) => void;
}> = ({ label, sortKey, currentSortKey, sortOrder, setSort }) => {
  const isActive = currentSortKey === sortKey;
  return (
    <TableHead onClick={() => setSort(sortKey)} className="cursor-pointer hover:bg-muted/50">
      <div className="flex items-center gap-1">
        {label}
        {isActive && (sortOrder === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
      </div>
    </TableHead>
  );
};

const HistoryDetails: React.FC<{ record: HistoryRecord }> = ({ record }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('productName');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortOrder('asc');
        }
    };

    const filteredAndSortedRows = useMemo(() => {
        let filtered = record.rows;
        if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            filtered = filtered.filter(row => 
                row.productName.toLowerCase().includes(lowerSearch) ||
                row.productId.toLowerCase().includes(lowerSearch)
            );
        }

        return filtered.sort((a, b) => {
            const valA = a[sortKey];
            const valB = b[sortKey];
            let comparison = 0;
            if (typeof valA === 'number' && typeof valB === 'number') {
                comparison = valA - valB;
            } else {
                comparison = String(valA).localeCompare(String(valB));
            }
            return sortOrder === 'asc' ? comparison : -comparison;
        });
    }, [record.rows, searchTerm, sortKey, sortOrder]);

    return (
        <div className="space-y-4">
            <div className="relative max-w-xs">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Ürün adı veya kodu ile ara..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                />
            </div>
            <ScrollArea className="h-[60vh] border rounded-md">
                <Table>
                    <TableHeader>
                    <TableRow>
                        <SortableHeader label="Ürün" sortKey="productName" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Tüketim" sortKey="consumption" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Devir" sortKey="carryOverPrev" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Total" sortKey="total" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Tekrar" sortKey="rerun" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Rutin" sortKey="routine" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Kontrol" sortKey="control" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Kalib." sortKey="calib" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Ay Sonu" sortKey="eomDeviceOn" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Blnn. Fire" sortKey="knownLoss" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Blnmyn. Fire" sortKey="unknownLoss" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Blnmyn. Fire (Kutu)" sortKey="unknownLossBoxes" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Cihaz Verim %" sortKey="deviceEffPct" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                        <SortableHeader label="Kit Verim %" sortKey="kitEffPct" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {filteredAndSortedRows.map(row => (
                        <TableRow key={row.productId} className="text-xs">
                        <TableCell className="font-medium">{row.productName} <span className="text-muted-foreground font-mono">({row.productId})</span></TableCell>
                        <TableCell>{row.consumption}</TableCell>
                        <TableCell>{row.carryOverPrev}</TableCell>
                        <TableCell>{row.total}</TableCell>
                        <TableCell>{row.rerun}</TableCell>
                        <TableCell>{row.routine}</TableCell>
                        <TableCell>{row.control}</TableCell>
                        <TableCell>{row.calib}</TableCell>
                        <TableCell>{row.eomDeviceOn}</TableCell>
                        <TableCell className="text-orange-600 font-semibold">{row.knownLoss.toFixed(0)}</TableCell>
                        <TableCell className="text-red-600 font-semibold">{row.unknownLoss.toFixed(0)}</TableCell>
                        <TableCell className="text-red-600 font-semibold">{row.unknownLossBoxes.toFixed(1)}</TableCell>
                        <TableCell>{row.deviceEffPct.toFixed(1)}%</TableCell>
                        <TableCell>{row.kitEffPct.toFixed(1)}%</TableCell>
                        </TableRow>
                    ))}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
    );
};

function calculateWeightedEfficiency(rows: Row[]): number {
    if (!rows || rows.length === 0) return 0;
    const { totalWeightedEfficiency, totalConsumption } = rows.reduce(
        (acc, row) => {
            const anaTuketim = (row.anaTuketimTestAdeti ?? ((row.carryOverPrev || 0) + (row.consumption || 0) - (row.eomDeviceOn || 0)));
            if (anaTuketim > 0) {
               acc.totalWeightedEfficiency += (row.kitEffPct || 0) * anaTuketim;
               acc.totalConsumption += anaTuketim;
            }
            return acc;
        },
        { totalWeightedEfficiency: 0, totalConsumption: 0 }
    );
    const efficiency = totalConsumption > 0 ? totalWeightedEfficiency / totalConsumption : 0;
    return Math.max(0, efficiency);
}

export default function VerimlilikGecmisPanel() {
  const { toast } = useToast();
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'efficiencyHistory'), orderBy('lastUpdated', 'desc'));
      const snap = await getDocs(q);
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() } as HistoryRecord)));
    } catch (e) {
      toast({ title: 'Hata', description: 'Geçmiş verimlilik kayıtları yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  const exportCalculationDetails = (record: HistoryRecord) => {
    const excelData = record.rows.map(row => {
        const anaTuketim = (row.anaTuketimTestAdeti ?? ((row.carryOverPrev || 0) + (row.consumption || 0) - (row.eomDeviceOn || 0)));
        const kitVerimDenom = anaTuketim - (row.eomDeviceOn || 0);
        return {
            'Ürün Adı': row.productName,
            'Ürün Kodu': row.productId,
            'A: Devir Cihaz Üstü': row.carryOverPrev || 0,
            'B: Tüketim (Test)': row.consumption || 0,
            'C: Ay Sonu Cihaz Üstü': row.eomDeviceOn || 0,
            'D: Ana Tüketim (A+B-C)': anaTuketim,
            'E: Rutin Test (Kümülatif)': row.routine || 0,
            'F: Bilinen Fire (D-E)': anaTuketim - (row.routine || 0),
            'G: Total (Kümülatif)': row.total || 0,
            'H: Bilinmeyen Fire (D-G)': anaTuketim - (row.total || 0),
            'I: Kontrol (Kümülatif)': row.control || 0,
            'J: Kalibrasyon (Kümülatif)': row.calib || 0,
            'K: Tekrar (Kümülatif)': row.rerun || 0,
            'Kit Verimliliği (%)': kitVerimDenom > 0 ? `(1 - ((${row.unknownLoss} + ${row.control} + ${row.calib}) / ${kitVerimDenom})) * 100 = ${(row.kitEffPct || 0).toFixed(2)}%` : 'N/A',
            'Cihaz Verimliliği (%)': row.total > 0 ? `((${row.total} - ${row.rerun} - ${row.calib} - ${row.control}) / ${row.total}) * 100 = ${(row.deviceEffPct || 0).toFixed(2)}%` : 'N/A',
        };
    });

    const labEfficiency = calculateWeightedEfficiency(record.rows);
    
    excelData.push({} as any); // Spacer
    excelData.push({ 'Ürün Adı': 'Laboratuvar Verimlilik Puanı', 'A: Devir Cihaz Üstü': `${labEfficiency.toFixed(2)}%` } as any);


    const fileName = `Verimlilik_Hesap_Detayi_${record.hospitalName}_${record.year}-${record.month + 1}`;
    exportDataToExcel(excelData, fileName, "HesaplamaDetayi", toast);
  };

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/verimlilik-hesaplama" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Verimlilik Geçmişi
          </CardTitle>
          <CardDescription>Kaydedilmiş verimlilik analizi sonuçları.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-center text-muted-foreground">Geçmiş kayıt bulunamadı.</p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {history.map(record => {
                const title = `${record.hospitalName} - ${format(new Date(record.year, record.month), 'LLLL yyyy', { locale: tr })}`;
                
                const labEfficiency = calculateWeightedEfficiency(record.rows);
                const barColor = 'hsl(var(--primary))';

                return (
                  <AccordionItem key={record.id} value={record.id} className="border rounded-lg mb-2">
                    <AccordionTrigger className="hover:no-underline px-4">
                      <div className="flex justify-between items-center w-full pr-4">
                        <div className="flex items-center gap-4">
                            <div className="relative h-20 w-20 cursor-pointer group">
                                <ResponsiveContainer width="100%" height="100%">
                                <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ name: 'Verimlilik', value: labEfficiency, fill: barColor }]} startAngle={90} endAngle={-270}>
                                    <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                                    <RadialBar background dataKey="value" cornerRadius={10} angleAxisId={0} />
                                </RadialBarChart>
                                </ResponsiveContainer>
                                <span className="absolute inset-0 flex items-center justify-center font-bold text-lg">{labEfficiency.toFixed(1)}%</span>
                            </div>
                            <span className="font-semibold">{title}</span>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                exportCalculationDetails(record);
                            }}
                            className="flex items-center gap-1 text-muted-foreground hover:text-primary"
                        >
                            <Download className="h-4 w-4" />
                            Hesaplama Detayı
                        </Button>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4">
                      <HistoryDetails record={record} />
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
