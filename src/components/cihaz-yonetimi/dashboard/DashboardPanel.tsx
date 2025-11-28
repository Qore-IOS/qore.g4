
'use client';
import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Hospital, DepoStokItem, Device, ConsumptionRecord, EfficiencyData, AppView, ProductCode, MinMaxRule, Shipment } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, PackageCheck, PackageX, TrendingUp, Zap, Warehouse, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import {
  differenceInDays, parse, format, startOfWeek, endOfWeek, eachDayOfInterval, isValid,
  subDays, addDays, subWeeks, addWeeks, subMonths, addMonths, subYears, addYears,
  startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear, eachMonthOfInterval
} from 'date-fns';
import { tr } from 'date-fns/locale';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell as RechartsCell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { cn } from '@/lib/utils';
import EfficiencyDetailsModal from '@/components/EfficiencyDetailsModal';
import { motion } from 'framer-motion';
import ConsumptionTrendModal from '@/components/ConsumptionTrendModal'; 
import { useAuth } from '@/contexts/auth-context';
import TimestampText from '../../TimestampText';
import { toDateFromAny } from '@/lib/time';
import { Button } from '../../ui/button';
import { Tabs, TabsList, TabsTrigger } from '../../ui/tabs';


const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

const motionProps = {
  initial: { scale: 1, y: 0 },
  whileHover: { scale: 1.03, y: -5, transition: { type: 'spring', stiffness: 300, damping: 20 } },
};

interface DashboardPanelProps {
    hospitals: Hospital[];
    devices: Device[];
    productCodes: ProductCode[];
    depoStok: DepoStokItem[];
    tuketimKayitlari: ConsumptionRecord[];
    shipments: Shipment[];
    efficiencyDataRecords: EfficiencyData[];
    minMaxRulesByLab: Record<string, Record<string, MinMaxRule>>;
}

type TrendPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export default function DashboardPanel({
    hospitals,
    devices,
    productCodes,
    depoStok,
    tuketimKayitlari,
    shipments,
    efficiencyDataRecords,
    minMaxRulesByLab
}: DashboardPanelProps) {
  const [isEfficiencyModalOpen, setIsEfficiencyModalOpen] = useState(false);
  const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
  const { currentUserProfile } = useAuth();
  const router = useRouter();

  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('weekly');
  const [trendDate, setTrendDate] = useState(new Date());

  const hospitalStockData = useMemo(() => {
    return hospitals.map(hospital => {
      const rules = minMaxRulesByLab[hospital.id] || {};
      if (Object.keys(rules).length === 0) {
        return { name: hospital.name, value: 0, percentage: 0 };
      }

      let totalPercentage = 0;
      let ruleCount = 0;

      for (const stokKodu in rules) {
        const rule = rules[stokKodu];
        if (rule && rule.max > 0) {
          const currentStock = depoStok.filter(
            item => item.hedefKurum === hospital.name && item.stokKodu === stokKodu
          ).length;
          const percentage = Math.min(100, (currentStock / rule.max) * 100);
          totalPercentage += percentage;
          ruleCount++;
        }
      }
      
      const averagePercentage = ruleCount > 0 ? totalPercentage / ruleCount : 0;
      const totalStockForLab = depoStok.filter(item => item.hedefKurum === hospital.name).length;

      return {
        name: hospital.name,
        value: totalStockForLab,
        percentage: Math.round(averagePercentage)
      };
    })
    .filter(item => item.percentage > 0)
    .sort((a,b) => (a.name || '').localeCompare(b.name || ''));
  }, [hospitals, depoStok, minMaxRulesByLab]);

  const defectReports = useMemo(() => {
    return devices.filter(d => d.arizaDurumu && d.arizaDurumu !== 'yok');
  }, [devices]);

  const expiringItems = useMemo(() => {
    const today = new Date();
    return depoStok
      .filter(item => !item.isShipped && item.miad)
      .map(item => {
        const miadDate = toDateFromAny(item.miad);
        const farkGun = miadDate ? differenceInDays(miadDate, today) : 9999;
        return { ...item, farkGun };
      })
      .filter(item => item.farkGun <= 60)
      .sort((a, b) => a.farkGun - b.farkGun);
  }, [depoStok]);

  const { data: stockConsumptionTrend, title: trendTitle } = useMemo(() => {
    const getConsumptionCounts = (start: Date, end: Date): { total: number; byLab: Record<string, number> } => {
        const byLab: Record<string, number> = {};
        hospitals.forEach(h => {
          if (h.id) byLab[h.id] = 0;
        });

        const recordsInPeriod = tuketimKayitlari.filter(item => {
            const d = toDateFromAny(item.consumptionTimestamp);
            return d && d >= start && d <= end;
        });

        recordsInPeriod.forEach(item => {
            const hospital = hospitals.find(h => h.name === item.laboratoryName);
            if (hospital && hospital.id) {
                byLab[hospital.id] = (byLab[hospital.id] || 0) + 1;
            }
        });
        
        return { total: recordsInPeriod.length, byLab };
    };

    let interval: Date[];
    let getPeriod: (date: Date) => { start: Date; end: Date };
    let formatLabel: (date: Date) => string;
    let title = '';

    switch (trendPeriod) {
        case 'daily':
            interval = Array.from({ length: 24 }, (_, i) => new Date(trendDate.getFullYear(), trendDate.getMonth(), trendDate.getDate(), i));
            getPeriod = (d) => ({ start: d, end: new Date(d.getTime() + 3600000 - 1) });
            formatLabel = (d) => format(d, 'HH:00');
            title = `${format(trendDate, 'dd MMMM yyyy', { locale: tr })} - Günlük Tüketim`;
            break;
        case 'monthly':
            interval = eachDayOfInterval({ start: startOfMonth(trendDate), end: endOfMonth(trendDate) });
            getPeriod = (d) => ({ start: startOfDay(d), end: endOfDay(d) });
            formatLabel = (d) => format(d, 'd');
            title = `${format(trendDate, 'MMMM yyyy', { locale: tr })} - Aylık Tüketim`;
            break;
        case 'yearly':
            interval = eachMonthOfInterval({ start: startOfYear(trendDate), end: endOfYear(trendDate) });
            getPeriod = (d) => ({ start: startOfMonth(d), end: endOfMonth(d) });
            formatLabel = (d) => format(d, 'MMM', { locale: tr });
            title = `${format(trendDate, 'yyyy', { locale: tr })} - Yıllık Tüketim`;
            break;
        case 'weekly':
        default:
            const weekStart = startOfWeek(trendDate, { weekStartsOn: 1 });
            interval = eachDayOfInterval({ start: weekStart, end: endOfWeek(trendDate, { weekStartsOn: 1 }) });
            getPeriod = (d) => ({ start: startOfDay(d), end: endOfDay(d) });
            formatLabel = (d) => format(d, 'eee', { locale: tr });
            title = `Haftalık Tüketim (${format(weekStart, 'dd MMM', { locale: tr })} - ${format(endOfWeek(trendDate, { weekStartsOn: 1 }), 'dd MMM yyyy', { locale: tr })})`;
    }

    const data = interval.map(date => {
        const period = getPeriod(date);
        const counts = getConsumptionCounts(period.start, period.end);
        const dataPoint: Record<string, any> = {
            date: formatLabel(date),
            Tüketim: counts.total
        };
        for (const labId in counts.byLab) {
            dataPoint[labId] = counts.byLab[labId];
        }
        return dataPoint;
    });

    return { data, title };
}, [tuketimKayitlari, trendPeriod, trendDate, hospitals]);
  
  const handleTrendNav = (direction: 'prev' | 'next') => {
    const fns = {
      daily: { prev: subDays, next: addDays },
      weekly: { prev: subWeeks, next: addWeeks },
      monthly: { prev: subMonths, next: addMonths },
      yearly: { prev: subYears, next: addYears },
    };
    setTrendDate(current => fns[trendPeriod][direction](current, 1));
  };
  
  const latestEfficiencyData = useMemo(() => {
    const latestRecords: Record<string, EfficiencyData> = {};
    efficiencyDataRecords.forEach(record => {
      if (!record.hospitalId) return;
      if (!latestRecords[record.hospitalId] || (record.year > latestRecords[record.hospitalId].year) || (record.year === latestRecords[record.hospitalId].year && record.month > latestRecords[record.hospitalId].month)) {
        latestRecords[record.hospitalId] = record;
      }
    });
    
    return Object.values(latestRecords).map(record => {
      let totalAnaTuketim = 0, totalFire = 0;
      if (record.verimlilikSonuclari) {
        Object.values(record.verimlilikSonuclari).forEach(res => {
          if (res.anaTuketimTestAdeti > 0) {
            totalAnaTuketim += res.anaTuketimTestAdeti;
            totalFire += res.toplamFire;
          }
        });
      }
      const fireRate = totalAnaTuketim > 0 ? (totalFire / totalAnaTuketim) : 0;
      const efficiencyRate = (1 - fireRate) * 100;
      
      return {
        name: hospitals.find(h => h.id === record.hospitalId)?.name?.substring(0, 15) || 'Bilinmeyen',
        Verimlilik: Math.max(0, efficiencyRate),
      };
    }).filter(d => d.Verimlilik > 0);
  }, [efficiencyDataRecords, hospitals]);

  const getProgressColor = (percentage: number) => {
    if (percentage <= 30) return 'bg-destructive';
    if (percentage <= 70) return 'bg-orange-500';
    return 'bg-green-600';
  };

  return (
    <>
      <div className={cn("p-2 md:p-4 space-y-6 pt-16")}>
      
        <h1 className="text-3xl md:text-4xl font-bold tracking-wide text-gradient-neon mt-10">
          {currentUserProfile?.name || 'Lojistik & Stok Paneli'}
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <motion.div {...motionProps} className="xl:col-span-2">
            <Card className="glass-card h-full flex flex-col">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                  <CardTitle className="flex items-center gap-2"><TrendingUp/> Tüketim Trendi</CardTitle>
                  <Tabs value={trendPeriod} onValueChange={(v) => setTrendPeriod(v as TrendPeriod)} className="w-full sm:w-auto">
                    <TabsList>
                      <TabsTrigger value="daily">Günlük</TabsTrigger>
                      <TabsTrigger value="weekly">Haftalık</TabsTrigger>
                      <TabsTrigger value="monthly">Aylık</TabsTrigger>
                      <TabsTrigger value="yearly">Yıllık</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="flex items-center justify-between mt-2">
                   <CardDescription>{trendTitle}</CardDescription>
                   <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => handleTrendNav('prev')}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => handleTrendNav('next')}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                   </div>
                </div>
              </CardHeader>
              <CardContent className="h-full flex-grow cursor-pointer" onClick={() => setIsConsumptionModalOpen(true)}>
                 <ChartContainer
                    config={{}}
                    className="h-[250px] w-full"
                  >
                  <AreaChart data={stockConsumptionTrend} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="neonGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="hsl(var(--chart-4))" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip
                      cursor={{ stroke: 'hsl(var(--chart-3))', strokeWidth: 1, strokeDasharray: '3 3' }}
                      content={<ChartTooltipContent indicator="dot" />}
                    />
                    <Area type="monotone" dataKey="Tüketim" stroke="hsl(var(--chart-3))" fillOpacity={0.4} fill="url(#neonGradient)" strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div {...motionProps} className="cursor-pointer" onClick={() => setIsEfficiencyModalOpen(true)}>
            <Card className="glass-card h-full">
              <CardHeader>
                <div className="flex justify-between items-start">
                    <CardTitle className="flex items-center gap-2"><Zap/> Son Verimlilik Oranları</CardTitle>
                    <Button variant="ghost" size="icon" className="h-8 w-8 -mt-2 -mr-2">
                        <Eye className="h-4 w-4" />
                    </Button>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-center">
                <ChartContainer config={{}} className="h-[250px] w-full">
                  <BarChart data={latestEfficiencyData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <XAxis type="number" dataKey="Verimlilik" domain={[0,100]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} width={80} interval={0} />
                    <Tooltip
                      cursor={{ fill: 'hsla(var(--chart-2) / 0.1)' }}
                      content={<ChartTooltipContent indicator="dot" />}
                    />
                     <Bar dataKey="Verimlilik" radius={5}>
                      {latestEfficiencyData.map((_, index) => (
                        <RechartsCell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div {...motionProps} className="cursor-pointer" onClick={() => router.push('/cihaz-yonetimi-ana')}>
              <Card className="glass-card h-full">
                 <CardHeader>
                  <CardTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/> Açık Arıza Kayıtları</CardTitle>
                  <CardDescription>{defectReports.length} cihazda arıza bildirildi.</CardDescription>
                </CardHeader>
                <CardContent className={cn("overflow-y-auto max-h-[190px]", defectReports.length > 5 && "glass-scroll")}>
                  <div className="space-y-3 pr-2">
                    {defectReports.length === 0 && <p className="text-muted-foreground text-center py-8">Aktif arıza kaydı yok.</p>}
                    {defectReports.slice(0, 5).map(d => (
                      <div key={d.id} className="flex justify-between items-center text-sm p-2 rounded-md bg-destructive/10">
                        <span className="font-semibold">{d.cihazAdi}</span>
                        <span className="text-destructive font-medium capitalize">{(d.arizaDurumu || '').replace('_', ' ')}</span>
                      </div>
                    ))}
                     {defectReports.length > 5 && <p className="text-xs text-center text-muted-foreground mt-2">... ve {defectReports.length - 5} daha fazlası</p>}
                  </div>
                </CardContent>
              </Card>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <motion.div {...motionProps} className="xl:col-span-2 cursor-pointer" onClick={() => router.push('/laboratuvar-yonetimi')}>
              <Card className="glass-card h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><PackageCheck/> Laboratuvar Stok Doluluk Oranları</CardTitle>
                  <CardDescription>Her laboratuvarın min-max kurallarına göre ortalama stok doluluk yüzdesi.</CardDescription>
                </CardHeader>
                <CardContent className={cn("space-y-4 pr-2", hospitalStockData.length > 6 && "glass-scroll")}>
                  {hospitalStockData.map((hospital) => (
                    <div key={hospital.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{hospital.name}</span>
                        <span className="text-muted-foreground font-bold text-lg">{hospital.percentage}%</span>
                      </div>
                      <Progress value={hospital.percentage} className="h-3" indicatorClassName={getProgressColor(hospital.percentage)} />
                    </div>
                  ))}
                </CardContent>
              </Card>
          </motion.div>

          <motion.div {...motionProps} className="cursor-pointer" onClick={() => router.push('/stok-yonetimi')}>
              <Card className="glass-card h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><PackageX/> Miadı Yaklaşanlar (Depo)</CardTitle>
                  <CardDescription>60 gün içinde miadı dolacak ürünler.</CardDescription>
                </CardHeader>
                <CardContent className={cn("pr-2", expiringItems.length > 6 && "glass-scroll")}>
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead>Ürün</TableHead>
                              <TableHead className="text-right">Kalan Gün</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                        {expiringItems.length === 0 && <TableRow><TableCell colSpan={2} className="text-center h-24">Miadı yaklaşan ürün yok.</TableCell></TableRow>}
                        {expiringItems.slice(0, 10).map(item => (
                          <TableRow key={item.id} className={item.farkGun <= 30 ? "text-destructive" : "text-amber-400"}>
                              <TableCell className="font-medium truncate" title={item.stokAdi}>{item.stokAdi}</TableCell>
                              <TableCell className="text-right font-bold">{item.farkGun}</TableCell>
                          </TableRow>
                        ))}
                         {expiringItems.length > 10 && <TableRow><TableCell colSpan={2} className="text-center text-xs text-muted-foreground">... ve {expiringItems.length - 10} daha</TableCell></TableRow>}
                      </TableBody>
                  </Table>
                </CardContent>
              </Card>
          </motion.div>
        </div>
      </div>
      
      {isEfficiencyModalOpen && (
        <EfficiencyDetailsModal
          isOpen={isEfficiencyModalOpen}
          onClose={() => setIsEfficiencyModalOpen(false)}
          efficiencyDataRecords={efficiencyDataRecords}
          productCodes={productCodes}
          hospitals={hospitals}
        />
      )}
      
      {isConsumptionModalOpen && (
        <ConsumptionTrendModal
          isOpen={isConsumptionModalOpen}
          onClose={() => setIsConsumptionModalOpen(false)}
          consumptionRecords={tuketimKayitlari}
          hospitals={hospitals}
          chartData={stockConsumptionTrend}
          trendPeriod={trendPeriod}
          setTrendPeriod={setTrendPeriod}
          handleTrendNav={handleTrendNav}
          trendTitle={trendTitle}
        />
      )}
    </>
  );
}
