
'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import type { Hospital, ConsumptionRecord, ProductCode, DailyConsumptionStats, DeviceFaultReport, PurchasingTask } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval,
  subDays, addDays, subWeeks, addWeeks, subMonths, addMonths, subYears, addYears,
  startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear, eachMonthOfInterval
} from 'date-fns';
import { tr } from 'date-fns/locale';
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import ConsumptionTrendModal from '@/components/ConsumptionTrendModal';
import { useAuth } from '@/contexts/auth-context';
import { toDateFromAny } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDailyConsumptionStats } from '@/hooks/useFirebaseQueries';
import { formatDateKey } from '@/lib/dailyConsumptionStats';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VIEWS } from '@/lib/constants';

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
    tuketimKayitlari,
}: DashboardPanelProps) {
  const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
  const { currentUserProfile } = useAuth();
  const { theme } = useTheme();
  const [faultReports, setFaultReports] = useState<DeviceFaultReport[]>([]);
  const [purchasingTasks, setPurchasingTasks] = useState<PurchasingTask[]>([]);

  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('weekly');
  const [trendDate, setTrendDate] = useState(new Date());

  const calendarScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const faultQuery = query(collection(db, 'deviceFaultReports'));
    const unsubscribeFaults = onSnapshot(
      faultQuery,
      (snapshot) => {
        const reports = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as DeviceFaultReport[];
        setFaultReports(reports);
      },
      (error) => console.error('deviceFaultReports fetch error:', error)
    );

    const taskQuery = query(collection(db, 'purchasingTasks'));
    const unsubscribeTasks = onSnapshot(
      taskQuery,
      (snapshot) => {
        const tasks = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as PurchasingTask[];
        setPurchasingTasks(tasks);
      },
      (error) => console.error('purchasingTasks fetch error:', error)
    );

    return () => {
      unsubscribeFaults();
      unsubscribeTasks();
    };
  }, []);

  const faultKpis = useMemo(() => faultReports.reduce((acc, report) => {
    if (report.status === 'atama_bekliyor') acc.atamaBekleyen += 1;
    if (report.status === 'mudahale_bekliyor') acc.mudahaleBekleyen += 1;
    if (report.status === 'mudahale_ediliyor') acc.mudahaleEdilen += 1;
    return acc;
  }, { atamaBekleyen: 0, mudahaleBekleyen: 0, mudahaleEdilen: 0 }), [faultReports]);

  const personalCalendarKpi = useMemo(() => {
    if (!currentUserProfile?.uid) {
      return {
        timelineItems: [] as Array<{ id: string; label: string; type: 'past' | 'today' | 'future' }>,
      };
    }

    const currentDate = new Date();
    const todayKey = format(currentDate, 'yyyy-MM-dd');

    const userTasks = purchasingTasks.filter((task) => {
      return task.createdByUid === currentUserProfile.uid
        || task.assignedPersonnel?.some((person) => person.uid === currentUserProfile.uid)
        || task.accompanyingPersonnel?.some((person) => person.uid === currentUserProfile.uid);
    });

    const sortedTasks = userTasks
      .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
      .map((task) => ({
        id: task.id ?? `${task.date}-${task.startTime}-${task.title}`,
        label: `${task.date} • ${task.startTime} • ${task.title}`,
        date: task.date,
        completed: !!task.completed,
      }));

    const pastCompleted = sortedTasks
      .filter((task) => task.completed && task.date < todayKey)
      .map((task) => ({ id: task.id, label: task.label, type: 'past' as const }));

    const futureTasks = sortedTasks
      .filter((task) => task.date > todayKey)
      .map((task) => ({ id: task.id, label: task.label, type: 'future' as const }));

    const timelineItems = [
      ...pastCompleted,
      { id: 'today-marker', label: format(currentDate, "dd MMMM yyyy", { locale: tr }) + " • Bugün", type: 'today' as const },
      ...futureTasks,
    ];

    return { timelineItems };
  }, [purchasingTasks, currentUserProfile?.uid]);

  useEffect(() => {
    const el = calendarScrollRef.current;
    if (!el) return;
    const todayNode = el.querySelector<HTMLElement>('[data-today="true"]');
    if (!todayNode) return;

    const top = todayNode.offsetTop - (el.clientHeight / 2) + (todayNode.clientHeight / 2);
    el.scrollTo({ top: Math.max(0, top) });
  }, [personalCalendarKpi.timelineItems]);

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
  
  const visiblePanels = useMemo(() => {
    const allowed = new Set(currentUserProfile?.accessibleViews ?? []);
    return VIEWS.filter((view) => view.type === 'nav' && !!view.href && allowed.has(view.key) && view.key !== 'dashboard');
  }, [currentUserProfile?.accessibleViews]);

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
              <CardContent className="grid h-full grid-cols-1 gap-2 sm:grid-cols-3">
                <Link href="/ariza-yonetimi?status=atama_bekliyor" className="rounded-xl border border-border/60 bg-secondary/30 p-3 transition-colors hover:bg-secondary/50">
                  <p className="text-xs font-medium text-amber-500">Atama Bekleyen</p>
                  <p className="text-2xl font-bold text-foreground">{faultKpis.atamaBekleyen}</p>
                </Link>
                <Link href="/ariza-yonetimi?status=mudahale_bekliyor" className="rounded-xl border border-border/60 bg-secondary/30 p-3 transition-colors hover:bg-secondary/50">
                  <p className="text-xs font-medium text-orange-500">Müdahale Bekleyen</p>
                  <p className="text-2xl font-bold text-foreground">{faultKpis.mudahaleBekleyen}</p>
                </Link>
                <Link href="/ariza-yonetimi?status=mudahale_ediliyor" className="rounded-xl border border-border/60 bg-secondary/30 p-3 transition-colors hover:bg-secondary/50">
                  <p className="text-xs font-medium text-emerald-500">Müdahale Edilen</p>
                  <p className="text-2xl font-bold text-foreground">{faultKpis.mudahaleEdilen}</p>
                </Link>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...motionProps}>
            <Link href="/satin-alma/analiz-planlama" className="block h-full">
              <Card className="glass-card h-full flex flex-col cursor-pointer">
                <CardContent className="pt-6">
                  <div
                    ref={calendarScrollRef}
                    className="h-[252px] space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {personalCalendarKpi.timelineItems.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Takvim kaydı bulunmuyor.</p>
                    ) : (
                      personalCalendarKpi.timelineItems.map((item) => (
                        <div
                          key={item.id}
                          data-today={item.type === 'today'}
                          className={cn(
                            'rounded-lg border border-border/50 px-3 py-2 transition-colors',
                            item.type === 'today' && 'bg-primary/15 text-center text-base font-semibold text-primary',
                            item.type === 'past' && 'text-xs text-muted-foreground line-through',
                            item.type === 'future' && 'text-xs text-muted-foreground'
                          )}
                        >
                          {item.label}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        </div>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Paneller</CardTitle>
            <CardDescription>Yetkiniz dahilinde erişebileceğiniz modüller</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12">
              {visiblePanels.map((panel) => {
                const Icon = panel.icon;
                return (
                  <Link key={panel.key} href={panel.href!} className="group flex flex-col items-center gap-2 rounded-xl border border-border/50 p-3 text-center transition hover:border-primary/40 hover:bg-primary/5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary/40 text-primary transition group-hover:bg-primary/15">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-xs text-muted-foreground group-hover:text-foreground">{panel.label}</span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
      
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
