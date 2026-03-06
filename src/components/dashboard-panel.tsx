
'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import type { Hospital, ConsumptionRecord, ProductCode, DailyConsumptionStats, DeviceFaultReport, PurchasingTask } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { TrendingUp, ChevronLeft, ChevronRight, UserPlus2, TimerReset, ActivitySquare, AlertTriangle, CheckCircle2, DollarSign, Wallet, BarChart3 } from 'lucide-react';
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
import { collection, onSnapshot, query, where, getCountFromServer, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VIEWS } from '@/lib/constants';
import { useQuery } from '@tanstack/react-query';

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

  // Server-side query: count of products expiring within 45 days across all depots
  const { data: expiringProductCount = 0 } = useQuery({
    queryKey: ['expiringProductCount45'],
    queryFn: async () => {
      const now = new Date();
      const cutoff = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
      const q = query(
        collection(db, 'depoStok'),
        where('isShipped', '==', false),
        where('miad', '<=', Timestamp.fromDate(cutoff)),
        where('miad', '>=', Timestamp.fromDate(now))
      );
      const snapshot = await getCountFromServer(q);
      return snapshot.data().count;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Server-side: Total stock cost using getCountFromServer per stokKodu (no document downloads)
  const { data: totalStockCost = 0 } = useQuery({
    queryKey: ['dashboardTotalStockCost'],
    queryFn: async () => {
      // Only fetch small productCodes collection
      const productSnap = await getDocs(collection(db, 'productCodes'));
      const pricedProducts: { stokKodu: string; cost: number }[] = [];
      productSnap.docs.forEach(d => {
        const data = d.data();
        if (data.cost && data.stokKodu) pricedProducts.push({ stokKodu: data.stokKodu, cost: data.cost });
      });
      if (pricedProducts.length === 0) return 0;
      // Count stock items per stokKodu server-side (no document data transfer)
      const counts = await Promise.all(
        pricedProducts.map(async (p) => {
          const snap = await getCountFromServer(
            query(collection(db, 'depoStok'), where('stokKodu', '==', p.stokKodu))
          );
          return snap.data().count * p.cost;
        })
      );
      return counts.reduce((sum, v) => sum + v, 0);
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Server-side: Yesterday's consumption cost using getCountFromServer per stokKodu
  const { data: yesterdayConsumptionCost = 0 } = useQuery({
    queryKey: ['dashboardYesterdayConsumptionCost'],
    queryFn: async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
      const productSnap = await getDocs(collection(db, 'productCodes'));
      const pricedProducts: { stokKodu: string; cost: number }[] = [];
      productSnap.docs.forEach(d => {
        const data = d.data();
        if (data.cost && data.stokKodu) pricedProducts.push({ stokKodu: data.stokKodu, cost: data.cost });
      });
      if (pricedProducts.length === 0) return 0;
      const counts = await Promise.all(
        pricedProducts.map(async (p) => {
          const snap = await getCountFromServer(
            query(
              collection(db, 'tuketimKayitlari'),
              where('stokKodu', '==', p.stokKodu),
              where('consumptionTimestamp', '>=', Timestamp.fromDate(dayStart)),
              where('consumptionTimestamp', '<=', Timestamp.fromDate(dayEnd)),
            )
          );
          return snap.data().count * p.cost;
        })
      );
      return counts.reduce((sum, v) => sum + v, 0);
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Server-side: Average efficiency from totalEfficiencyRecords
  const { data: avgEfficiency } = useQuery<number | null>({
    queryKey: ['dashboardAvgEfficiency'],
    queryFn: async () => {
      const snap = await getDocs(collection(db, 'totalEfficiencyRecords'));
      const efficiencies: number[] = [];
      snap.docs.forEach(d => {
        const data = d.data();
        const genelVerimlilik = data.efficiencyMetrics?.genelVerimlilik;
        if (typeof genelVerimlilik === 'number' && genelVerimlilik > 0) {
          efficiencies.push(genelVerimlilik);
        }
      });
      if (efficiencies.length === 0) return null;
      return efficiencies.reduce((sum, v) => sum + v, 0) / efficiencies.length;
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

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

  const todayTasks = useMemo(() => {
    if (!currentUserProfile?.uid) return [];
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    return purchasingTasks
      .filter((task) => {
        if (task.date !== todayKey) return false;
        return task.createdByUid === currentUserProfile.uid
          || task.assignedPersonnel?.some((p) => p.uid === currentUserProfile.uid)
          || task.accompanyingPersonnel?.some((p) => p.uid === currentUserProfile.uid);
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
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

  const faultStatusCards = [
    {
      key: 'atama',
      label: 'Atama Bekleyen',
      value: faultKpis.atamaBekleyen,
      href: '/ariza-yonetimi?status=atama_bekliyor',
      icon: UserPlus2,
      tone: 'text-amber-600',
      progressClass: 'bg-amber-400/70',
    },
    {
      key: 'mudahale-bekleyen',
      label: 'Müdahale Bekleyen',
      value: faultKpis.mudahaleBekleyen,
      href: '/ariza-yonetimi?status=mudahale_bekliyor',
      icon: TimerReset,
      tone: 'text-orange-600',
      progressClass: 'bg-orange-400/70',
    },
    {
      key: 'mudahale-edilen',
      label: 'Müdahale Edilen',
      value: faultKpis.mudahaleEdilen,
      href: '/ariza-yonetimi?status=mudahale_ediliyor',
      icon: ActivitySquare,
      tone: 'text-emerald-600',
      progressClass: 'bg-emerald-400/70',
    },
  ];

  return (
    <>
      <div className={cn("dashboard-neu-page p-3 sm:p-4 md:p-4 space-y-4 sm:space-y-6 pt-4 sm:pt-6")}>

        <h1 className={cn(
          "text-2xl sm:text-3xl md:text-4xl font-bold tracking-wide mt-2 sm:mt-4",
          theme === 'qore-dark' ? 'text-gradient-bronze' : 'text-slate-800'
        )}>
          {currentUserProfile?.name || 'Lojistik & Stok Paneli'}
        </h1>

        {/* Main KPI Grid - Mobile Responsive */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4 md:gap-6">
          {/* Tüketim Trendi */}
          <motion.div {...motionProps} className="xl:col-span-2">
            <Card className="glass-card h-full flex flex-col">
              <CardHeader className="space-y-2 sm:space-y-3">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg md:text-xl">
                    <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5" /> Tüketim Trendi
                  </CardTitle>
                  <Tabs value={trendPeriod} onValueChange={(v) => setTrendPeriod(v as TrendPeriod)} className="w-full sm:w-auto">
                    <TabsList className="dashboard-segment grid grid-cols-4 w-full sm:w-auto">
                      <TabsTrigger value="daily" className="dashboard-segment-trigger text-[10px] sm:text-xs px-1.5 sm:px-3">Günlük</TabsTrigger>
                      <TabsTrigger value="weekly" className="dashboard-segment-trigger text-[10px] sm:text-xs px-1.5 sm:px-3">Haftalık</TabsTrigger>
                      <TabsTrigger value="monthly" className="dashboard-segment-trigger text-[10px] sm:text-xs px-1.5 sm:px-3">Aylık</TabsTrigger>
                      <TabsTrigger value="yearly" className="dashboard-segment-trigger text-[10px] sm:text-xs px-1.5 sm:px-3">Yıllık</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="flex items-center justify-between mt-1 sm:mt-2">
                   <CardDescription className="text-[10px] sm:text-xs md:text-sm">{trendTitle}</CardDescription>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="dashboard-neu-button h-6 w-6 sm:h-7 sm:w-7" onClick={() => handleTrendNav('prev')}>
                        <ChevronLeft className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="dashboard-neu-button h-6 w-6 sm:h-7 sm:w-7" onClick={() => handleTrendNav('next')}>
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

          {/* Maliyet Kartı */}
          <motion.div {...motionProps}>
            <Card className="glass-card h-full flex flex-col">
              <CardContent className="flex-1 flex flex-col divide-y divide-border/50">
                {/* Anlık Stok Maliyeti */}
                <div className="flex-1 flex flex-col items-center justify-center py-3 gap-1">
                  <div className="flex items-center gap-1.5">
                    <Wallet className="h-4 w-4 text-blue-500" />
                    <p className="text-xs font-semibold text-blue-600">Anlık Stok Maliyeti</p>
                  </div>
                  <p className="text-2xl font-bold text-slate-700">
                    {totalStockCost > 0 ? `€${totalStockCost.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Tüm depolar + laboratuvarlar</p>
                </div>
                {/* Dünün Tüketim Maliyeti */}
                <div className="flex-1 flex flex-col items-center justify-center py-3 gap-1">
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="h-4 w-4 text-emerald-500" />
                    <p className="text-xs font-semibold text-emerald-600">Dünün Tüketim Maliyeti</p>
                  </div>
                  <p className="text-2xl font-bold text-slate-700">
                    {yesterdayConsumptionCost > 0 ? `€${yesterdayConsumptionCost.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Tüm laboratuvar tüketimi</p>
                </div>
                {/* Ortalama Verimlilik */}
                <div className="flex-1 flex flex-col items-center justify-center py-3 gap-1">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="h-4 w-4 text-violet-500" />
                    <p className="text-xs font-semibold text-violet-600">Ort. Verimlilik</p>
                  </div>
                  <p className="text-2xl font-bold text-slate-700">
                    {avgEfficiency != null ? `%${avgEfficiency.toFixed(1)}` : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Tüm havuzların ortalaması</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          {/* Fault KPIs (top) + Expiring Products (bottom) */}
          <motion.div {...motionProps} className="flex flex-col gap-3 sm:gap-4">
            <Card className="glass-card flex-1 flex flex-col">
              <CardContent className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-3 items-center justify-center">
                {faultStatusCards.map((item) => {
                  const Icon = item.icon;
                  const total = faultKpis.atamaBekleyen + faultKpis.mudahaleBekleyen + faultKpis.mudahaleEdilen;
                  const rate = total > 0 ? Math.round((item.value / total) * 100) : 0;

                  return (
                    <Link key={item.key} href={item.href} className="dashboard-kpi-mini group rounded-2xl p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-xs font-semibold", item.tone)}>{item.label}</p>
                        <Icon className={cn("h-4 w-4", item.tone)} />
                      </div>
                      <p className="mt-2 text-3xl font-bold text-slate-700">{item.value}</p>
                      <div className="mt-3 h-1.5 rounded-full bg-white/60">
                        <div className={cn("h-1.5 rounded-full transition-all duration-300", item.progressClass)} style={{ width: `${Math.max(rate, 10)}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="glass-card flex-1 flex flex-col">
              <CardContent className="flex-1 flex flex-col items-center justify-center py-4 gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                  <p className="text-sm font-semibold text-orange-600">Miadı Yaklaşan Ürünler</p>
                </div>
                <p className="text-5xl font-bold text-slate-700">{expiringProductCount}</p>
                <p className="text-xs text-muted-foreground">Tüm depolarda 45 gün ve altı</p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Calendar (top) + Today's Tasks (bottom) */}
          <motion.div {...motionProps} className="flex flex-col gap-3 sm:gap-4">
            <Link href="/satin-alma/analiz-planlama" className="flex-1 flex flex-col">
              <Card className="glass-card flex-1 flex flex-col cursor-pointer">
                <CardContent className="flex-1 flex flex-col justify-center pt-4 px-2">
                  <div
                    ref={calendarScrollRef}
                    className="max-h-[140px] space-y-1 overflow-y-auto rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {personalCalendarKpi.timelineItems.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center">Takvim kaydı bulunmuyor.</p>
                    ) : (
                      personalCalendarKpi.timelineItems.map((item) => (
                        <div
                          key={item.id}
                          data-today={item.type === 'today'}
                          className={cn(
                            'dashboard-timeline-row px-4 py-2 w-full',
                            item.type === 'today' && 'dashboard-timeline-row-active text-center text-sm font-semibold text-slate-700',
                            item.type === 'past' && 'text-xs text-slate-500 line-through',
                            item.type === 'future' && 'text-xs text-slate-500'
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
            <Card className="glass-card flex-1 flex flex-col">
              <CardContent className="flex-1 flex flex-col items-center justify-center py-4 gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <p className="text-sm font-semibold text-slate-600">Bugünün Görevleri</p>
                </div>
                {todayTasks.length === 0 ? (
                  <p className="text-4xl font-bold text-slate-400">0</p>
                ) : (
                  <p className="text-5xl font-bold text-slate-700">{todayTasks.length}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {todayTasks.length === 0 ? 'Bugün için görev bulunmuyor' : `${todayTasks.length} görev planlandı`}
                </p>
                {todayTasks.length > 0 && (
                  <div className="w-full max-h-[60px] space-y-1 overflow-y-auto rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {todayTasks.map((task) => (
                      <div
                        key={task.id}
                        className={cn(
                          'dashboard-timeline-row px-3 py-1 text-xs text-center',
                          task.completed ? 'text-slate-400 line-through' : 'text-slate-600'
                        )}
                      >
                        {task.startTime} • {task.title}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <Card className="glass-card">
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12">
              {visiblePanels.map((panel) => {
                const Icon = panel.icon;
                const isFrequent = ['arama', 'stok-yonetimi', 'laboratuvar-yonetimi', 'satin-alma'].includes(panel.key);
                const hasAttention = ['siparisler', 'sarf-dagitim', 'cihaz-yonetimi-ana'].includes(panel.key);

                return (
                  <Link key={panel.key} href={panel.href!} className={cn('dashboard-panel-tile group relative flex flex-col items-center gap-2 rounded-2xl p-3 text-center transition', isFrequent && 'dashboard-panel-tile-frequent')}>
                    {hasAttention && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-orange-400" />}
                    <span className="dashboard-panel-icon flex h-10 w-10 items-center justify-center rounded-full text-primary transition group-hover:text-orange-500">
                      <Icon className="h-5 w-5" />
                    </span>
                    {isFrequent && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-600">Sık</span>}
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
