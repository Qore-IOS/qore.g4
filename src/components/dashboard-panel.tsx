
'use client';
import React, { useState, useMemo, useEffect } from 'react';
import { useTheme } from 'next-themes';
import type { Hospital, ConsumptionRecord, ProductCode, DailyConsumptionStats } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, Zap, ChevronLeft, ChevronRight, Eye, ChevronDown } from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval,
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
import { toDateFromAny } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDailyConsumptionStats } from '@/hooks/useFirebaseQueries';
import { formatDateKey } from '@/lib/dailyConsumptionStats';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: format(new Date(2000, i), 'LLLL', { locale: tr }),
}));


const motionProps = {
  initial: { scale: 1, y: 0 },
  whileHover: { scale: 1.03, y: -5, transition: { type: 'spring', stiffness: 300, damping: 20 } },
};

interface DashboardPanelProps {
    hospitals: Hospital[];
    productCodes: ProductCode[];
    tuketimKayitlari: ConsumptionRecord[];
    efficiencyHistoryRecords: any[];
}

type TrendPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export default function DashboardPanel({
    hospitals,
    productCodes,
    tuketimKayitlari,
    efficiencyHistoryRecords,
}: DashboardPanelProps) {
  const [isEfficiencyModalOpen, setIsEfficiencyModalOpen] = useState(false);
  const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
  const { currentUserProfile } = useAuth();
  const { theme } = useTheme();

  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('weekly');
  const [trendDate, setTrendDate] = useState(new Date());

  const [efficiencyMonth, setEfficiencyMonth] = useState(new Date().getMonth());
  const [efficiencyYear, setEfficiencyYear] = useState(new Date().getFullYear());
  const [isEfficiencyCardExpanded, setIsEfficiencyCardExpanded] = useState(false);

  // Calculate date range for daily stats query
  const { startDateKey, endDateKey } = useMemo(() => {
    let start: Date;
    let end: Date;

    switch (trendPeriod) {
      case 'daily':
        start = startOfDay(trendDate);
        end = endOfDay(trendDate);
        break;
      case 'monthly':
        start = startOfMonth(trendDate);
        end = endOfMonth(trendDate);
        break;
      case 'yearly':
        start = startOfYear(trendDate);
        end = endOfYear(trendDate);
        break;
      case 'weekly':
      default:
        start = startOfWeek(trendDate, { weekStartsOn: 1 });
        end = endOfWeek(trendDate, { weekStartsOn: 1 });
    }

    return {
      startDateKey: formatDateKey(start),
      endDateKey: formatDateKey(end)
    };
  }, [trendPeriod, trendDate]);

  // Fetch daily consumption stats from pre-computed collection
  const { data: dailyStats = [] } = useDailyConsumptionStats(startDateKey, endDateKey);

  // Convert daily stats to chart data format
  const { data: stockConsumptionTrend, title: trendTitle } = useMemo(() => {
    // Create a map of date -> stats for quick lookup
    const statsMap = new Map<string, DailyConsumptionStats>();
    dailyStats.forEach(stat => statsMap.set(stat.date, stat));

    // For 'daily' period (hourly breakdown), we still need tuketimKayitlari
    // For other periods, use daily aggregated stats
    let interval: Date[];
    let formatLabel: (date: Date) => string;
    let title = '';
    let useHourlyData = false;

    switch (trendPeriod) {
      case 'daily':
        // Hourly breakdown still needs real-time data
        interval = Array.from({ length: 24 }, (_, i) =>
          new Date(trendDate.getFullYear(), trendDate.getMonth(), trendDate.getDate(), i)
        );
        formatLabel = (d) => format(d, 'HH:00');
        title = `${format(trendDate, 'dd MMMM yyyy', { locale: tr })} - Günlük Tüketim`;
        useHourlyData = true;
        break;
      case 'monthly':
        interval = eachDayOfInterval({ start: startOfMonth(trendDate), end: endOfMonth(trendDate) });
        formatLabel = (d) => format(d, 'd');
        title = `${format(trendDate, 'MMMM yyyy', { locale: tr })} - Aylık Tüketim`;
        break;
      case 'yearly':
        interval = eachMonthOfInterval({ start: startOfYear(trendDate), end: endOfYear(trendDate) });
        formatLabel = (d) => format(d, 'MMM', { locale: tr });
        title = `${format(trendDate, 'yyyy', { locale: tr })} - Yıllık Tüketim`;
        break;
      case 'weekly':
      default:
        const weekStart = startOfWeek(trendDate, { weekStartsOn: 1 });
        interval = eachDayOfInterval({ start: weekStart, end: endOfWeek(trendDate, { weekStartsOn: 1 }) });
        formatLabel = (d) => format(d, 'eee', { locale: tr });
        title = `Haftalık Tüketim (${format(weekStart, 'dd MMM', { locale: tr })} - ${format(endOfWeek(trendDate, { weekStartsOn: 1 }), 'dd MMM yyyy', { locale: tr })})`;
    }

    const data = interval.map(date => {
      const dataPoint: Record<string, any> = {
        date: formatLabel(date)
      };

      if (useHourlyData) {
        // For hourly data, use tuketimKayitlari (real-time for today)
        const hourStart = date;
        const hourEnd = new Date(date.getTime() + 3600000 - 1);

        const recordsInHour = tuketimKayitlari.filter(item => {
          const d = toDateFromAny(item.consumptionTimestamp);
          return d && d >= hourStart && d <= hourEnd;
        });

        dataPoint['Tüketim'] = recordsInHour.length;

        // Add per-lab breakdown
        hospitals.forEach(h => {
          if (h.id) {
            dataPoint[h.id] = recordsInHour.filter(r => {
              const hospital = hospitals.find(h => h.name === r.laboratoryName);
              return hospital?.id === h.id;
            }).length;
          }
        });
      } else if (trendPeriod === 'yearly') {
        // For yearly view, aggregate all days in the month
        const monthStart = startOfMonth(date);
        const monthEnd = endOfMonth(date);
        const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

        let monthTotal = 0;
        const monthByLab: Record<string, number> = {};

        daysInMonth.forEach(day => {
          const dayKey = formatDateKey(day);
          const dayStat = statsMap.get(dayKey);
          if (dayStat) {
            monthTotal += dayStat.totalCount;
            Object.entries(dayStat.byLab || {}).forEach(([labId, count]) => {
              monthByLab[labId] = (monthByLab[labId] || 0) + count;
            });
          }
        });

        dataPoint['Tüketim'] = monthTotal;
        Object.entries(monthByLab).forEach(([labId, count]) => {
          dataPoint[labId] = count;
        });
      } else {
        // For weekly/monthly view, use daily stats directly
        const dateKey = formatDateKey(date);
        const stat = statsMap.get(dateKey);

        dataPoint['Tüketim'] = stat?.totalCount || 0;

        // Add per-lab breakdown
        if (stat?.byLab) {
          Object.entries(stat.byLab).forEach(([labId, count]) => {
            dataPoint[labId] = count;
          });
        }
      }

      return dataPoint;
    });

    return { data, title };
  }, [dailyStats, trendPeriod, trendDate, hospitals, tuketimKayitlari]);
  
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
