
'use client';
import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import type { Hospital, DepoStokItem, Device, ConsumptionRecord, ProductCode, MinMaxRule, Shipment } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, PackageCheck, PackageX, TrendingUp, Zap, ChevronLeft, ChevronRight, Eye, ChevronDown } from 'lucide-react';
import {
  differenceInDays, format, startOfWeek, endOfWeek, eachDayOfInterval,
  subDays, addDays, subWeeks, addWeeks, subMonths, addMonths, subYears, addYears,
  startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear, eachMonthOfInterval
} from 'date-fns';
import { tr } from 'date-fns/locale';
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"
import { cn } from '@/lib/utils';
import EfficiencyDetailsModal from '@/components/EfficiencyDetailsModal';
import { motion } from 'framer-motion';
import ConsumptionTrendModal from '@/components/ConsumptionTrendModal'; 
import { useAuth } from '@/contexts/auth-context';
import TimestampText from './TimestampText';
import { toDateFromAny } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: format(new Date(2000, i), 'LLLL', { locale: tr }),
}));


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
    efficiencyHistoryRecords: any[]; // Changed from efficiencyDataRecords
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
    efficiencyHistoryRecords, // Changed from efficiencyDataRecords
    minMaxRulesByLab
}: DashboardPanelProps) {
  const [isEfficiencyModalOpen, setIsEfficiencyModalOpen] = useState(false);
  const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
  const { currentUserProfile } = useAuth();
  const { theme } = useTheme();
  
  const router = useRouter();

  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('weekly');
  const [trendDate, setTrendDate] = useState(new Date());

  const [efficiencyMonth, setEfficiencyMonth] = useState(new Date().getMonth());
  const [efficiencyYear, setEfficiencyYear] = useState(new Date().getFullYear());
  const [isEfficiencyCardExpanded, setIsEfficiencyCardExpanded] = useState(false);


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
  
  const periodEfficiencyData = useMemo(() => {
    if (!efficiencyHistoryRecords) return [];
    const recordsForPeriod = efficiencyHistoryRecords.filter(
        record => record.month === efficiencyMonth && record.year === efficiencyYear
    );
    
    return recordsForPeriod.map(record => {
      let totalWeightedEfficiency = 0;
      let totalConsumption = 0;
      if (record.rows) {
        record.rows.forEach((res: any) => {
          const anaTuketim = (res.anaTuketimTestAdeti ?? ((res.carryOverPrev || 0) + (res.consumption || 0) - (res.eomDeviceOn || 0)));
          if (anaTuketim > 0) { // Avoid division by zero and negative consumption effects
             const kitEff = (res.kitEffPct ?? 0);
             totalWeightedEfficiency += kitEff * anaTuketim;
             totalConsumption += anaTuketim;
          }
        });
      }
      const weightedAvg = totalConsumption > 0 ? totalWeightedEfficiency / totalConsumption : 0;
      
      return {
        name: record.hospitalName || 'Bilinmeyen',
        period: format(new Date(record.year, record.month), 'LLLL yyyy', { locale: tr }),
        Verimlilik: Math.max(0, weightedAvg),
      };
    }).sort((a, b) => b.Verimlilik - a.Verimlilik);
  }, [efficiencyHistoryRecords, efficiencyMonth, efficiencyYear]);

  const displayedEfficiencyData = useMemo(() => {
      return isEfficiencyCardExpanded ? periodEfficiencyData : periodEfficiencyData.slice(0, 5);
  }, [periodEfficiencyData, isEfficiencyCardExpanded]);


  const getProgressColor = (percentage: number) => {
    if (percentage <= 80) return 'bg-destructive';
    if (percentage <= 90) return 'bg-orange-500';
    return 'bg-green-600';
  };

  return (
    <>
      <div className={cn("p-3 sm:p-4 md:p-4 space-y-4 sm:space-y-6 pt-12 sm:pt-16")}>

        <h1 className={cn(
          "text-2xl sm:text-3xl md:text-4xl font-bold tracking-wide mt-6 sm:mt-10",
          theme === 'qore-dark' ? 'text-gradient-bronze' : 'text-gradient-neon'
        )}>
          {currentUserProfile?.name || 'Lojistik & Stok Paneli'}
        </h1>

        {/* Main KPI Grid - Mobile Responsive */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
          <motion.div {...motionProps} className="xl:col-span-2">
            <Card className="glass-card h-full flex flex-col">
              <CardHeader className="space-y-2 sm:space-y-3">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg md:text-xl">
                    <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5" /> Tüketim Trendi
                  </CardTitle>
                  <Tabs value={trendPeriod} onValueChange={(v) => setTrendPeriod(v as TrendPeriod)} className="w-full sm:w-auto">
                    <TabsList className="grid grid-cols-4 w-full sm:w-auto">
                      <TabsTrigger value="daily" className="text-[10px] sm:text-xs px-1.5 sm:px-3">Günlük</TabsTrigger>
                      <TabsTrigger value="weekly" className="text-[10px] sm:text-xs px-1.5 sm:px-3">Haftalık</TabsTrigger>
                      <TabsTrigger value="monthly" className="text-[10px] sm:text-xs px-1.5 sm:px-3">Aylık</TabsTrigger>
                      <TabsTrigger value="yearly" className="text-[10px] sm:text-xs px-1.5 sm:px-3">Yıllık</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="flex items-center justify-between mt-1 sm:mt-2">
                   <CardDescription className="text-[10px] sm:text-xs md:text-sm">{trendTitle}</CardDescription>
                   <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" onClick={() => handleTrendNav('prev')}>
                        <ChevronLeft className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" onClick={() => handleTrendNav('next')}>
                        <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Button>
                   </div>
                </div>
              </CardHeader>
              <CardContent className="h-full flex-grow cursor-pointer" onClick={() => setIsConsumptionModalOpen(true)}>
                 <ChartContainer
                    config={{}}
                    className="h-[180px] sm:h-[220px] md:h-[250px] w-full"
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
          
          <motion.div {...motionProps}>
            <Card className="glass-card h-full flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start">
                    <CardTitle className="flex items-center gap-2"><Zap/> Verimlilik Oranları</CardTitle>
                    <Button variant="ghost" size="icon" className="h-8 w-8 -mt-2 -mr-2" onClick={() => setIsEfficiencyModalOpen(true)}>
                        <Eye className="h-4 w-4" />
                    </Button>
                </div>
                <div className="flex gap-2 items-center pt-2">
                    <Select value={String(efficiencyMonth)} onValueChange={(v) => setEfficiencyMonth(Number(v))}>
                        <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={String(efficiencyYear)} onValueChange={(v) => setEfficiencyYear(Number(v))}>
                        <SelectTrigger className="w-[100px] h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col flex-grow justify-center space-y-3">
                {displayedEfficiencyData.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">Bu dönem için hesaplanmış verimlilik verisi bulunmuyor.</p>
                ) : (
                    displayedEfficiencyData.map((data, index) => (
                        <div key={index}>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="font-medium truncate" title={data.name}>{data.name}</span>
                                <span className="font-bold">{data.Verimlilik.toFixed(1)}%</span>
                            </div>
                            <Progress value={data.Verimlilik} className="h-2.5" indicatorClassName={getProgressColor(data.Verimlilik)} />
                        </div>
                    ))
                )}
              </CardContent>
              {periodEfficiencyData.length > 5 && (
                <CardFooter className="pt-2">
                    <Button variant="link" size="sm" onClick={() => setIsEfficiencyCardExpanded(prev => !prev)} className="w-full">
                        {isEfficiencyCardExpanded ? 'Daha Az Göster' : `Tümünü Göster (${periodEfficiencyData.length})`}
                        <ChevronDown className={cn("ml-1 h-4 w-4 transition-transform", isEfficiencyCardExpanded && "rotate-180")}/>
                    </Button>
                </CardFooter>
              )}
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

        {/* Bottom KPI Grid - Mobile Responsive */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
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
                      <Progress value={hospital.percentage} className="h-3" />
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
          efficiencyHistoryRecords={efficiencyHistoryRecords} // Changed
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
