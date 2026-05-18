
'use client';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import type { Hospital, ConsumptionRecord, ProductCode, DailyConsumptionStats, DeviceFaultReport, PurchasingTask } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TrendingUp, ChevronLeft, ChevronRight, UserPlus2, TimerReset, ActivitySquare, AlertTriangle, CalendarCheck, Banknote, RefreshCw, ArrowUpRight } from 'lucide-react';
import { Sparkline } from '@/components/maliyet-gozlem/charts';
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval,
  subDays, addDays, subWeeks, addWeeks, subMonths, addMonths, subYears, addYears,
  startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear, eachMonthOfInterval,
  parse, isValid, differenceInDays
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
import { collection, onSnapshot, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VIEWS } from '@/lib/constants';
import { getExchangeRates } from '@/lib/exchange-rates';
import { calculateEfficiencyMetrics } from '@/lib/verimlilik/validation';
import { matchesCompanyScope } from '@/lib/company-scope';
import { 
  useDeviceFaultReports, 
  usePurchasingTasks, 
  useExpiringProductsCount 
} from '@/hooks/useFirebaseQueries';
import { Skeleton } from '@/components/ui/skeleton';

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
type CostCurrency = 'EUR' | 'USD' | 'TRY';
type CurrencyPools = Record<CostCurrency, number>;

type StockProductBreakdown = {
  stokKodu: string;
  stokAdi: string;
  quantity: number;
  nativeTotals: CurrencyPools;
  tryTotal: number;
};

type StockLocationBreakdown = {
  id: string;
  name: string;
  type: 'depo' | 'lab';
  quantity: number;
  nativeTotals: CurrencyPools;
  tryTotal: number;
  products: StockProductBreakdown[];
};

type StockBrandBreakdown = {
  brand: string;
  quantity: number;
  nativeTotals: CurrencyPools;
  tryTotal: number;
  locations: StockLocationBreakdown[];
};

function DashboardSkeleton() {
  return (
    <div className="p-4 sm:p-8 space-y-8 animate-pulse">
      <div className="h-10 w-64 bg-muted rounded-lg mb-8" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-32 bg-muted rounded-2xl shadow-sm" />
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 h-[500px] bg-muted rounded-2xl shadow-sm" />
        <div className="xl:col-span-4 h-[500px] bg-muted rounded-2xl shadow-sm" />
      </div>
    </div>
  );
}

const STOCK_COST_SNAPSHOT_KEY = 'dashboard_stock_cost_snapshot_v1';
const STOCK_COST_SNAPSHOT_TTL = 1000 * 60 * 60 * 24; // 24 saat

export default function DashboardV2({
    hospitals,
    tuketimKayitlari,
    efficiencyHistoryRecords,
}: DashboardPanelProps) {
  const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { theme } = useTheme();

  // Optimized Fetching
  const { data: faultReports = [], isLoading: faultsLoading } = useDeviceFaultReports();
  const { data: purchasingTasks = [], isLoading: tasksLoading } = usePurchasingTasks();
  const { data: expiringCountServer = 0, isLoading: expiringLoading } = useExpiringProductsCount();

  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('weekly');
  const [trendDate, setTrendDate] = useState(new Date());

  const calendarScrollRef = useRef<HTMLDivElement | null>(null);

  const expiringProductsCount = expiringCountServer;

  const isLoading = faultsLoading || tasksLoading || expiringLoading;

  // Total stock cost + risky cost – client-side calculation
  const [totalStockCost, setTotalStockCost] = useState<number | null>(null);
  const [riskyCost, setRiskyCost] = useState<number | null>(null);
  const [isStockCostDetailOpen, setIsStockCostDetailOpen] = useState(false);
  const [stockCostBreakdown, setStockCostBreakdown] = useState<StockBrandBreakdown[]>([]);
  const [isRefreshingStockCost, setIsRefreshingStockCost] = useState(false);

  const loadStockCostSnapshot = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(STOCK_COST_SNAPSHOT_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as {
            timestamp: number;
            totalStockCost: number;
            riskyCost: number;
            stockCostBreakdown: StockBrandBreakdown[];
          };
          if (Date.now() - parsed.timestamp < STOCK_COST_SNAPSHOT_TTL) {
            setTotalStockCost(parsed.totalStockCost);
            setRiskyCost(parsed.riskyCost);
            setStockCostBreakdown(parsed.stockCostBreakdown || []);
            return;
          }
        }
      } catch (error) {
        console.warn('[Dashboard] stock cost snapshot cache parse error:', error);
      }
    }

    try {
      setIsRefreshingStockCost(true);
      try {
        const exchangeRates = await getExchangeRates();
        let productDocs: any[] = [];
        let stockDocs: any[] = [];
        let depotDocs: any[] = [];

        try { const s = await getDocs(collection(db, 'productCodes')); productDocs = s.docs; } catch (e) { console.warn('[Dashboard] productCodes fetch failed:', e); }
        try {
          const s = await getDocs(collection(db, 'depoStok'));
          stockDocs = s.docs.filter((d) => matchesCompanyScope(d.data() as any, currentCompanyId, isSuperAdmin));
        } catch (e) { console.warn('[Dashboard] depoStok fetch failed:', e); }
        try { const s = await getDocs(collection(db, 'depots')); depotDocs = s.docs; } catch (e) { console.warn('[Dashboard] depots fetch failed:', e); }

        const depotNameMap = new Map<string, string>();
        depotDocs.forEach((d) => {
          const data = d.data();
          depotNameMap.set(d.id, String(data?.name || d.id));
        });
        const hospitalById = new Map(hospitals.map((h) => [h.id, h.name]));

        // Build cost map: stokKodu -> birim maliyet + para birimi + metadata
        const costMap = new Map<string, { cost: number; currency: CostCurrency; brand: string; stokAdi: string }>();
        productDocs.forEach((d) => {
          const data = d.data();
          const rawCost = data.cost ?? data.birimFiyat ?? data.unitPrice ?? data.price;
          const numCost = typeof rawCost === 'number' ? rawCost : parseFloat(rawCost);
          const currency = (typeof data.currency === 'string' ? data.currency.toUpperCase() : 'TRY') as CostCurrency;
          const normalizedCurrency: CostCurrency = currency === 'EUR' || currency === 'USD' ? currency : 'TRY';
          if (numCost && !isNaN(numCost) && data.stokKodu) {
            costMap.set(data.stokKodu, {
              cost: numCost,
              currency: normalizedCurrency,
              brand: String(data.marka || 'Markasız'),
              stokAdi: String(data.stokAdi || data.stokKodu),
            });
          }
        });

        const sumPoolsToTry = (pools: Record<CostCurrency, number>): number => {
          const eurToTry = exchangeRates.TRY;
          const usdToTry = exchangeRates.TRY / exchangeRates.USD;
          return pools.TRY + (pools.EUR * eurToTry) + (pools.USD * usdToTry);
        };

        // Toplam maliyet hesapla
        const totalPools: Record<CostCurrency, number> = { TRY: 0, USD: 0, EUR: 0 };
        const breakdownMap = new Map<string, {
          quantity: number;
          nativeTotals: CurrencyPools;
          locations: Map<string, {
            id: string;
            name: string;
            type: 'depo' | 'lab';
            quantity: number;
            nativeTotals: CurrencyPools;
            products: Map<string, StockProductBreakdown>;
          }>;
        }>();
        const activeStockItems: Array<{ stokKodu: string; lotNumarasi: string; miad: string; depotId: string; quantity: number }> = [];
        const groupedByDepotAndProduct = new Map<string, number>();

        stockDocs.forEach((d) => {
          const data = d.data();
          const productCost = costMap.get(data.stokKodu);
          const qty = Number(data.quantity ?? 1) || 1;
          if (productCost) {
            totalPools[productCost.currency] += (productCost.cost * qty);

            const brandKey = productCost.brand || 'Markasız';
            let brandEntry = breakdownMap.get(brandKey);
            if (!brandEntry) {
              brandEntry = {
                quantity: 0,
                nativeTotals: { TRY: 0, USD: 0, EUR: 0 },
                locations: new Map(),
              };
              breakdownMap.set(brandKey, brandEntry);
            }
            brandEntry.quantity += qty;
            brandEntry.nativeTotals[productCost.currency] += productCost.cost * qty;

            const isLab = data.isShipped === true;
            const locationType: 'depo' | 'lab' = isLab ? 'lab' : 'depo';
            const locationId = isLab
              ? String(data.hedefKurumId || data.labId || data.hedefKurum || 'bilinmeyen-lab')
              : String(data.depotId || 'bilinmeyen-depo');
            const locationName = isLab
              ? (hospitalById.get(locationId) || String(data.hedefKurum || data.labName || 'Bilinmeyen Lab'))
              : (depotNameMap.get(locationId) || String(data.depotName || 'Bilinmeyen Depo'));
            const locationKey = `${locationType}:${locationId}`;
            let locationEntry = brandEntry.locations.get(locationKey);
            if (!locationEntry) {
              locationEntry = {
                id: locationId,
                name: locationName,
                type: locationType,
                quantity: 0,
                nativeTotals: { TRY: 0, USD: 0, EUR: 0 },
                products: new Map(),
              };
              brandEntry.locations.set(locationKey, locationEntry);
            }
            locationEntry.quantity += qty;
            locationEntry.nativeTotals[productCost.currency] += productCost.cost * qty;

            const productKey = data.stokKodu;
            let productEntry = locationEntry.products.get(productKey);
            if (!productEntry) {
              productEntry = {
                stokKodu: data.stokKodu,
                stokAdi: productCost.stokAdi,
                quantity: 0,
                nativeTotals: { TRY: 0, USD: 0, EUR: 0 },
                tryTotal: 0,
              };
              locationEntry.products.set(productKey, productEntry);
            }
            productEntry.quantity += qty;
            productEntry.nativeTotals[productCost.currency] += productCost.cost * qty;
          }
          // Riskli hesabı için stok bilgisi topla
          activeStockItems.push({
            stokKodu: data.stokKodu,
            lotNumarasi: data.lotNumarasi || '',
            miad: typeof data.miad === 'string' ? data.miad : '',
            depotId: data.depotId || '',
            quantity: qty,
          });
          // Depo+stokKodu bazında toplam adet
          const gKey = `${data.depotId || ''}__${data.stokKodu}`;
          groupedByDepotAndProduct.set(gKey, (groupedByDepotAndProduct.get(gKey) || 0) + qty);
        });

        const computedTotalStockCost = sumPoolsToTry(totalPools);
        setTotalStockCost(computedTotalStockCost);
        const breakdown: StockBrandBreakdown[] = Array.from(breakdownMap.entries()).map(([brand, brandEntry]) => {
          const locations: StockLocationBreakdown[] = Array.from(brandEntry.locations.values()).map((loc) => {
            const products = Array.from(loc.products.values()).map((p) => ({
              ...p,
              tryTotal: sumPoolsToTry(p.nativeTotals),
            })).sort((a, b) => b.tryTotal - a.tryTotal);
            return {
              id: loc.id,
              name: loc.name,
              type: loc.type,
              quantity: loc.quantity,
              nativeTotals: loc.nativeTotals,
              tryTotal: sumPoolsToTry(loc.nativeTotals),
              products,
            };
          }).sort((a, b) => b.tryTotal - a.tryTotal);
          return {
            brand,
            quantity: brandEntry.quantity,
            nativeTotals: brandEntry.nativeTotals,
            tryTotal: sumPoolsToTry(brandEntry.nativeTotals),
            locations,
          };
        }).sort((a, b) => b.tryTotal - a.tryTotal);
        setStockCostBreakdown(breakdown);

        // Riskli maliyet: tüm depolardan minMaxRules çek
        const depotIds = depotDocs.map((d) => d.id);
        const allMinMaxRules = new Map<string, { max: number; maxGun: number }>();

        const rulePromises = depotIds.map(async (depotId) => {
          const rulesSnap = await getDocs(collection(db, 'depots', depotId, 'minMaxRules'));
          rulesSnap.docs.forEach((d) => {
            const rule = d.data();
            if (rule.stokKodu && rule.max && rule.maxGun) {
              // Depo bazlı key — aynı ürün farklı depolarda farklı rule'a sahip olabilir
              allMinMaxRules.set(`${depotId}__${rule.stokKodu}`, { max: rule.max, maxGun: rule.maxGun });
            }
          });
        });
        await Promise.all(rulePromises);

        // Stokları grupla: depotId + stokKodu + lotNumarasi + miad
        const lotGroups = new Map<string, { stokKodu: string; depotId: string; lotNumarasi: string; miad: string; quantity: number }>();
        activeStockItems.forEach((item) => {
          const key = `${item.depotId}__${item.stokKodu}__${item.lotNumarasi}__${item.miad}`;
          const existing = lotGroups.get(key);
          if (existing) {
            existing.quantity += item.quantity;
          } else {
            lotGroups.set(key, { ...item, quantity: item.quantity });
          }
        });

        // Her lot grubu için riskli kutu hesabı
        const riskyPools: Record<CostCurrency, number> = { TRY: 0, USD: 0, EUR: 0 };
        lotGroups.forEach((group) => {
          const ruleKey = `${group.depotId}__${group.stokKodu}`;
          const rule = allMinMaxRules.get(ruleKey);
          if (!rule) return;

          // Miad info
          if (!group.miad) return;
          const miadDate = parse(group.miad, 'dd.MM.yyyy', new Date());
          if (!isValid(miadDate)) return;
          const miadDays = differenceInDays(miadDate, new Date());
          if (miadDays <= 0 || miadDays === Infinity) return;

          // Coverage info
          const periodDays = Math.floor(rule.maxGun);
          if (periodDays <= 0) return;
          const dailyNeed = rule.max / periodDays;
          if (dailyNeed <= 0) return;
          // Depo+stokKodu bazında toplam stok (lot-agnostic coverage)
          const totalStockForProduct = groupedByDepotAndProduct.get(ruleKey) || group.quantity;
          const coverageDays = Math.floor(totalStockForProduct / dailyNeed);

          if (coverageDays <= miadDays) return; // Riskli değil

          const riskyDays = coverageDays - miadDays;
          const riskyBoxes = Math.min(Math.max(0, Math.ceil(riskyDays * dailyNeed)), group.quantity);
          const productCost = costMap.get(group.stokKodu);
          if (!productCost) return;
          riskyPools[productCost.currency] += riskyBoxes * productCost.cost;
        });

        const computedRiskyCost = sumPoolsToTry(riskyPools);
        setRiskyCost(computedRiskyCost);

        try {
          localStorage.setItem(STOCK_COST_SNAPSHOT_KEY, JSON.stringify({
            timestamp: Date.now(),
            totalStockCost: computedTotalStockCost,
            riskyCost: computedRiskyCost,
            stockCostBreakdown: breakdown,
          }));
        } catch (error) {
          console.warn('[Dashboard] stock cost snapshot cache save error:', error);
        }
      } catch (err) {
        console.error('[Dashboard] getTotalStockCost error:', err);
        setTotalStockCost(0);
        setRiskyCost(0);
      }
    } finally {
      setIsRefreshingStockCost(false);
    }
  }, [hospitals]);

  useEffect(() => {
    loadStockCostSnapshot(false);
  }, [loadStockCostSnapshot]);

  // Yesterday's consumption cost – fetch by date range, then join client-side
  const [yesterdayConsumptionCost, setYesterdayConsumptionCost] = useState(0);
  useEffect(() => {
    (async () => {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

        let productDocs2: any[] = [];
        let consumptionDocs: any[] = [];

        try { const s = await getDocs(collection(db, 'productCodes')); productDocs2 = s.docs; } catch (e) { console.warn('[Dashboard] yesterday productCodes fetch failed:', e); }
        try {
          const s = await getDocs(query(
            collection(db, 'tuketimKayitlari'),
            where('consumptionTimestamp', '>=', Timestamp.fromDate(dayStart)),
            where('consumptionTimestamp', '<=', Timestamp.fromDate(dayEnd)),
          ));
          consumptionDocs = s.docs;
        } catch (e) { console.warn('[Dashboard] yesterday consumption fetch failed:', e); }

        const priceMap = new Map<string, number>();
        productDocs2.forEach(d => {
          const data = d.data();
          const rawCost = data.cost ?? data.birimFiyat ?? data.unitPrice ?? data.price;
          const numCost = typeof rawCost === 'number' ? rawCost : parseFloat(rawCost);
          if (numCost && !isNaN(numCost) && data.stokKodu) priceMap.set(data.stokKodu, numCost);
        });

        let total = 0;
        consumptionDocs.forEach(d => {
          const stokKodu = d.data().stokKodu;
          const cost = priceMap.get(stokKodu);
          if (cost) total += cost;
        });
        setYesterdayConsumptionCost(total);
      } catch (e) { console.error('Yesterday consumption cost error:', e); }
    })();
  }, []);

  // Average efficiency
  const [avgEfficiency, setAvgEfficiency] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const effSnap = await getDocs(collection(db, 'totalEfficiencyRecords'));
        if (!effSnap) return;
        const efficiencies: number[] = [];
        effSnap.docs.forEach(d => {
          const data = d.data();
          const metrics = data.rows?.length && data.efficiencyMetrics?.hakEdisVerisiGirildi === undefined
            ? calculateEfficiencyMetrics(data.rows)
            : data.efficiencyMetrics || (data.rows?.length ? calculateEfficiencyMetrics(data.rows) : undefined);
          const genelVerimlilik = metrics?.genelVerimlilik;
          if (typeof genelVerimlilik === 'number' && genelVerimlilik >= 0) {
            efficiencies.push(genelVerimlilik);
          }
        });
        if (efficiencies.length === 0) return;
        setAvgEfficiency(efficiencies.reduce((sum, v) => sum + v, 0) / efficiencies.length);
      } catch (e) { console.error('Avg efficiency error:', e); }
    })();
  }, []);

  const faultKpis = useMemo(() => faultReports.reduce((acc, report) => {
    const status = (report.status || '').toLowerCase().replace(/[\s-]/g, '_');
    if (status === 'atama_bekliyor') acc.atamaBekleyen += 1;
    else if (status === 'mudahale_bekliyor' || status === 'müdahale_bekliyor') acc.mudahaleBekleyen += 1;
    else if (status === 'mudahale_ediliyor' || status === 'müdahale_ediliyor') acc.mudahaleEdilen += 1;
    return acc;
  }, { atamaBekleyen: 0, mudahaleBekleyen: 0, mudahaleEdilen: 0 }), [faultReports]);

  const personalCalendarKpi = useMemo(() => {
    if (!currentUserProfile?.uid) {
      return {
        timelineItems: [] as Array<{ id: string; label: string; type: 'past' | 'today' | 'future' }>,
        todayTasks: [] as Array<{ id: string; label: string; type: 'today-task' }>,
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

    const todayTasks = sortedTasks
      .filter((task) => task.date === todayKey && !task.completed)
      .map((task) => ({ id: task.id, label: task.label, type: 'today-task' as const }));

    const timelineItems = [
      ...pastCompleted,
      { id: 'today-marker', label: format(currentDate, "dd MMMM yyyy", { locale: tr }) + " • Bugün", type: 'today' as const },
      ...futureTasks,
    ];

    return { timelineItems, todayTasks };
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
  // Fallback: when dailyConsumptionStats collection is empty, compute from tuketimKayitlari
  const hasDailyStats = dailyStats.length > 0;

  const { data: stockConsumptionTrend, title: trendTitle } = useMemo(() => {
    // Create a map of date -> stats for quick lookup
    const statsMap = new Map<string, DailyConsumptionStats>();
    dailyStats.forEach(stat => statsMap.set(stat.date, stat));

    // If dailyConsumptionStats is empty, build stats from tuketimKayitlari
    if (!hasDailyStats && tuketimKayitlari.length > 0) {
      tuketimKayitlari.forEach(record => {
        const d = toDateFromAny(record.consumptionTimestamp);
        if (!d) return;
        const dateKey = formatDateKey(d);
        const existing = statsMap.get(dateKey);
        if (existing) {
          existing.totalCount += 1;
          const labId = hospitals.find(h => h.name === record.laboratoryName)?.id;
          if (labId) {
            existing.byLab[labId] = (existing.byLab[labId] || 0) + 1;
          }
        } else {
          const byLab: Record<string, number> = {};
          const labId = hospitals.find(h => h.name === record.laboratoryName)?.id;
          if (labId) byLab[labId] = 1;
          statsMap.set(dateKey, { date: dateKey, totalCount: 1, byLab } as DailyConsumptionStats);
        }
      });
    }

    let interval: Date[];
    let formatLabel: (date: Date) => string;
    let title = '';
    let useHourlyData = false;

    switch (trendPeriod) {
      case 'daily':
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

  if (isLoading) return <DashboardSkeleton />;

  // Tüketim trendi sparkline verisi
  const trendSpark = stockConsumptionTrend.map((d: any) => Number(d['Tüketim']) || 0);
  const trendTotal = trendSpark.reduce((a, b) => a + b, 0);

  // Fault total (atama+müdahale)
  const faultTotal = faultKpis.atamaBekleyen + faultKpis.mudahaleBekleyen + faultKpis.mudahaleEdilen;

  const kpiCards = [
    {
      key: 'atama',
      label: 'Atama Bekleyen',
      value: faultKpis.atamaBekleyen,
      sub: 'arıza talebi',
      color: '#fb923c',
      icon: UserPlus2,
      href: '/ariza-yonetimi?status=atama_bekliyor',
    },
    {
      key: 'mudahale-bekleyen',
      label: 'Müdahale Bekleyen',
      value: faultKpis.mudahaleBekleyen,
      sub: `${faultTotal} toplam`,
      color: '#fc7272',
      icon: TimerReset,
      href: '/ariza-yonetimi?status=mudahale_bekliyor',
    },
    {
      key: 'mudahale-edilen',
      label: 'Müdahale Edilen',
      value: faultKpis.mudahaleEdilen,
      sub: 'açık çalışma',
      color: '#42e46d',
      icon: ActivitySquare,
      href: '/ariza-yonetimi?status=mudahale_ediliyor',
    },
    {
      key: 'miad',
      label: 'MIAD ≤ 45 Gün',
      value: typeof expiringProductsCount === 'number' ? expiringProductsCount : 0,
      sub: 'yaklaşan ürün',
      color: '#a78bfa',
      icon: AlertTriangle,
      href: '/stok-yonetimi',
    },
  ];

  return (
    <>
      <div
        className="mg-root"
        style={{
          minHeight: 'calc(100vh - var(--dock-h, 0px))',
          padding: '20px 22px',
          background: `radial-gradient(ellipse at 0% 0%, rgba(251,146,60,0.06) 0%, transparent 50%),
                       radial-gradient(ellipse at 100% 100%, rgba(167,139,250,0.04) 0%, transparent 50%),
                       var(--mg-bg)`,
          color: 'var(--mg-text)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Karşılama */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: 'var(--mg-text)',
              margin: 0,
            }}
          >
            {currentUserProfile?.name || 'Lojistik & Stok Paneli'}
          </h1>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mg-muted)', letterSpacing: '0.04em' }}>
            {format(new Date(), 'dd MMMM yyyy · EEEE', { locale: tr })}
          </span>
        </div>

        {/* KPI Sıra (4 kart) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.key}
                href={card.href}
                style={{
                  textDecoration: 'none',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))',
                  border: '1px solid var(--mg-border)',
                  borderRadius: 20,
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.25s',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: -30,
                    right: -30,
                    width: 100,
                    height: 100,
                    borderRadius: '50%',
                    background: card.color,
                    filter: 'blur(50px)',
                    opacity: 0.08,
                    pointerEvents: 'none',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mg-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {card.label}
                  </span>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: card.color + '18',
                      color: card.color,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon size={14} />
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span
                    style={{
                      fontSize: 36,
                      fontWeight: 400,
                      letterSpacing: '-0.04em',
                      color: 'var(--mg-text)',
                      lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {card.value.toLocaleString('tr-TR')}
                  </span>
                  <ArrowUpRight size={14} style={{ color: 'var(--mg-muted)' }} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--mg-muted)', fontWeight: 500 }}>{card.sub}</span>
              </Link>
            );
          })}
        </div>

        {/* Orta grid: Tüketim Trendi (geniş) + Anlık Maliyet + Görevler */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
          {/* Tüketim Trendi */}
          <div
            onClick={() => setIsConsumptionModalOpen(true)}
            style={{
              background: 'var(--mg-surface)',
              border: '1px solid var(--mg-border)',
              borderRadius: 20,
              padding: '16px 18px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 220,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={16} style={{ color: 'var(--mg-accent)' }} />
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mg-text)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Tüketim Trendi
                </span>
              </div>
              <div style={{ display: 'inline-flex', gap: 4, background: 'var(--mg-surface-2)', padding: 3, borderRadius: 8, border: '1px solid var(--mg-border)' }}>
                {(['daily', 'weekly', 'monthly', 'yearly'] as TrendPeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={(e) => {
                      e.stopPropagation();
                      setTrendPeriod(p);
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.02em',
                      background: trendPeriod === p ? 'var(--mg-accent)' : 'transparent',
                      color: trendPeriod === p ? '#0a0a0c' : 'var(--mg-text-2)',
                      transition: 'all 0.2s',
                    }}
                  >
                    {p === 'daily' ? 'G' : p === 'weekly' ? 'H' : p === 'monthly' ? 'A' : 'Y'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 32, fontWeight: 400, color: 'var(--mg-text)', letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {trendTotal.toLocaleString('tr-TR')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mg-muted)', marginTop: 4, fontWeight: 500 }}>{trendTitle}</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTrendNav('prev');
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: '1px solid var(--mg-border)',
                    background: 'var(--mg-surface-2)',
                    color: 'var(--mg-text-2)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTrendNav('next');
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: '1px solid var(--mg-border)',
                    background: 'var(--mg-surface-2)',
                    color: 'var(--mg-text-2)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 80 }}>
              <Sparkline data={trendSpark.length > 0 ? trendSpark : [0]} color="#fb923c" width={500} height={90} fill />
            </div>
          </div>

          {/* Anlık Maliyet */}
          <div
            onClick={() => setIsStockCostDetailOpen(true)}
            style={{
              background: 'var(--mg-surface)',
              border: '1px solid var(--mg-border)',
              borderRadius: 20,
              padding: '16px 18px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              position: 'relative',
              minHeight: 220,
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                loadStockCostSnapshot(true);
              }}
              title="Yenile"
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: '1px solid var(--mg-border)',
                background: 'var(--mg-surface-2)',
                color: 'var(--mg-text-2)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RefreshCw size={12} className={isRefreshingStockCost ? 'animate-spin' : ''} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Banknote size={16} style={{ color: 'var(--mg-success)' }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mg-text)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Anlık Maliyet
              </span>
            </div>
            <div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 400,
                  color: 'var(--mg-text)',
                  letterSpacing: '-0.04em',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1,
                }}
              >
                {totalStockCost !== null
                  ? new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(totalStockCost)
                  : '…'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mg-muted)', marginTop: 4, fontWeight: 500 }}>Tüm depo + lab stoğu (TRY)</div>
            </div>
            <div
              style={{
                marginTop: 'auto',
                padding: '10px 12px',
                background: 'var(--mg-danger-soft)',
                borderRadius: 12,
                border: '1px solid var(--mg-danger-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={12} style={{ color: 'var(--mg-danger)' }} />
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-danger)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Riskli
                </span>
              </div>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--mg-danger)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {riskyCost !== null
                  ? new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(riskyCost)
                  : '…'}
              </span>
            </div>
          </div>

          {/* Görevler + Etkinlikler */}
          <div
            style={{
              background: 'var(--mg-surface)',
              border: '1px solid var(--mg-border)',
              borderRadius: 20,
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 220,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarCheck size={16} style={{ color: 'var(--mg-accent)' }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mg-text)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Bugün
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: 6,
                  background: 'var(--mg-surface-2)',
                  color: 'var(--mg-muted)',
                  marginLeft: 'auto',
                }}
              >
                {personalCalendarKpi.todayTasks.length} görev
              </span>
            </div>

            {personalCalendarKpi.todayTasks.length === 0 && personalCalendarKpi.timelineItems.length <= 1 ? (
              <div style={{ fontSize: 12, color: 'var(--mg-muted)', textAlign: 'center', padding: '24px 0' }}>
                Bugün için planlanmış görev yok.
              </div>
            ) : (
              <div
                ref={calendarScrollRef}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingRight: 4,
                }}
              >
                {personalCalendarKpi.timelineItems.map((item) => (
                  <div
                    key={item.id}
                    data-today={item.type === 'today'}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background:
                        item.type === 'today' ? 'var(--mg-accent-soft)' : 'var(--mg-surface-2)',
                      border: '1px solid ' + (item.type === 'today' ? 'rgba(251,146,60,0.3)' : 'var(--mg-border)'),
                      fontSize: item.type === 'today' ? 12 : 11,
                      fontWeight: item.type === 'today' ? 700 : 500,
                      color:
                        item.type === 'today'
                          ? 'var(--mg-accent)'
                          : item.type === 'past'
                            ? 'var(--mg-muted)'
                            : 'var(--mg-text-2)',
                      textDecoration: item.type === 'past' ? 'line-through' : 'none',
                    }}
                  >
                    {item.label}
                  </div>
                ))}
                {personalCalendarKpi.todayTasks.map((task) => (
                  <div
                    key={task.id}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'var(--mg-success-soft)',
                      border: '1px solid var(--mg-success-soft)',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--mg-success)',
                    }}
                  >
                    {task.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sık Kullanılanlar */}
        <div
          style={{
            background: 'var(--mg-surface)',
            border: '1px solid var(--mg-border)',
            borderRadius: 20,
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mg-text)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Sık Kullanılanlar
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: 6,
                background: 'var(--mg-surface-2)',
                color: 'var(--mg-muted)',
              }}
            >
              {visiblePanels.length}
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              gap: 8,
            }}
          >
            {visiblePanels.map((panel) => {
              const Icon = panel.icon;
              const isFrequent = ['arama', 'stok-yonetimi', 'laboratuvar-yonetimi', 'satin-alma'].includes(panel.key);
              const hasAttention = ['siparisler', 'sarf-dagitim', 'cihaz-yonetimi-ana'].includes(panel.key);
              return (
                <Link
                  key={panel.key}
                  href={panel.href!}
                  style={{
                    textDecoration: 'none',
                    background: isFrequent ? 'var(--mg-accent-soft)' : 'var(--mg-surface-2)',
                    border: '1px solid ' + (isFrequent ? 'rgba(251,146,60,0.3)' : 'var(--mg-border)'),
                    borderRadius: 14,
                    padding: '10px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    position: 'relative',
                    transition: 'all 0.2s',
                    minHeight: 78,
                  }}
                >
                  {hasAttention && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--mg-accent)',
                      }}
                    />
                  )}
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: 'var(--mg-surface)',
                      color: isFrequent ? 'var(--mg-accent)' : 'var(--mg-text-2)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid var(--mg-border)',
                    }}
                  >
                    <Icon size={14} />
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--mg-text-2)',
                      textAlign: 'center',
                      lineHeight: 1.2,
                    }}
                  >
                    {panel.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
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

      <Dialog open={isStockCostDetailOpen} onOpenChange={setIsStockCostDetailOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Anlık Maliyet Detayı</DialogTitle>
            <DialogDescription>
              Kırılım sırası: Marka → Kurum (Depo/Lab) → Ürün.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {stockCostBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">Detay verisi bulunamadı.</p>
            ) : stockCostBreakdown.map((brand) => (
              <details key={brand.brand} className="rounded-lg border p-3" open>
                <summary className="cursor-pointer font-semibold text-sm flex items-center justify-between gap-2">
                  <span>{brand.brand}</span>
                  <span className="text-emerald-700">
                    {new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(brand.tryTotal)}
                  </span>
                </summary>
                <div className="mt-2 space-y-2">
                  {brand.locations.map((location) => (
                    <details key={`${location.type}-${location.id}`} className="rounded-md border p-2">
                      <summary className="cursor-pointer text-sm flex items-center justify-between gap-2">
                        <span>{location.type === 'depo' ? 'Depo' : 'Lab'}: {location.name}</span>
                        <span className="font-medium text-slate-700">
                          {new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(location.tryTotal)}
                        </span>
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b">
                              <th className="py-1 pr-2">Stok Kodu</th>
                              <th className="py-1 pr-2">Ürün</th>
                              <th className="py-1 pr-2">Adet</th>
                              <th className="py-1 pr-2 text-right">Toplam (TRY)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {location.products.map((product) => (
                              <tr key={product.stokKodu} className="border-b last:border-0">
                                <td className="py-1 pr-2 font-mono">{product.stokKodu}</td>
                                <td className="py-1 pr-2">{product.stokAdi}</td>
                                <td className="py-1 pr-2">{product.quantity}</td>
                                <td className="py-1 pr-2 text-right font-medium">
                                  {new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(product.tryTotal)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
