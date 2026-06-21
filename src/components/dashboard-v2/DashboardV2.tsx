
'use client';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import type { Hospital, ConsumptionRecord, ProductCode, DailyConsumptionStats, DeviceFaultReport, PurchasingTask } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TrendingUp, ChevronLeft, ChevronRight, UserPlus2, TimerReset, ActivitySquare, AlertTriangle, CalendarCheck, Banknote, RefreshCw, ArrowUpRight, Bell, Maximize2, Check, X as XIcon, Search } from 'lucide-react';
import {
  HOME_C, fmtInt, fmtTL, useCountUp, ClayLineChart, Ring,
  Card as ClayCard, CardHead, Pill, Tag, ClayIconBtn, Segmented, ClayBar,
} from '@/components/dashboard-v2/clay-home';
import { ClayShell } from '@/components/mal-kabul/clay-kit';
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
import { scopedQuery } from '@/lib/firestore-helpers';
import { toDateFromAny } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDailyConsumptionStats } from '@/hooks/useFirebaseQueries';
import { formatDateKey } from '@/lib/dailyConsumptionStats';
import { collection, onSnapshot, query, where, getDocs, Timestamp, limit as fsLimit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VIEWS } from '@/lib/constants';
import { getExchangeRates } from '@/lib/exchange-rates';
import { calculateEfficiencyMetrics } from '@/lib/verimlilik/validation';
import { matchesCompanyScope } from '@/lib/company-scope';
import {
  useOpenDeviceFaultReports,
  usePurchasingTasks,
  useExpiringProductsCount
} from '@/hooks/useFirebaseQueries';
import { useCompanyStats } from '@/hooks/useCompanyStats';
import { Skeleton } from '@/components/ui/skeleton';

const motionProps = {
  initial: { scale: 1, y: 0 },
  whileHover: { scale: 1.03, y: -5, transition: { type: 'spring', stiffness: 300, damping: 20 } },
};

// ── clay dashboard sub-components (count-up animated) ─────────────────────────
function CountText({ value, format = fmtInt, style }: { value: number; format?: (n: number) => string; style?: React.CSSProperties }) {
  const v = useCountUp(value, 1000);
  return <span style={style}>{format(v)}</span>;
}

function MiniKpi({ s, i }: { s: { value: number; tone: string; bg: string; icon: any; label: string; href: string }; i: number }) {
  const v = useCountUp(s.value, 1000);
  const Icon = s.icon;
  return (
    <Link href={s.href} style={{ textDecoration: 'none', padding: '14px 10px', borderRadius: HOME_C.radiusSm, background: HOME_C.surfaceHi, boxShadow: HOME_C.clayFlat, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, textAlign: 'center', animation: `mkPopIn ${320 + i * 120}ms ${HOME_C.ease}` }}>
      <span style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', color: s.tone, background: s.bg, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><Icon size={19} /></span>
      <span style={{ fontSize: 28, fontWeight: 800, color: HOME_C.ink1, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(v)}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: HOME_C.ink2, lineHeight: 1.2 }}>{s.label}</span>
    </Link>
  );
}

function ShortcutTile({ panel, i }: { panel: any; i: number }) {
  const [p, setP] = useState(false);
  const Icon = panel.icon;
  return (
    <Link href={panel.href} onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{ textDecoration: 'none', boxSizing: 'border-box', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px 8px', borderRadius: HOME_C.radius, background: `linear-gradient(180deg, ${HOME_C.surfaceHi}, ${HOME_C.surface2})`, boxShadow: p ? HOME_C.clayPress : HOME_C.clay, color: HOME_C.ink1, transition: `transform 220ms ${HOME_C.ease}, box-shadow 220ms ${HOME_C.ease}`, transform: p ? 'translateY(2px) scale(0.96)' : 'none', animation: `mkPopIn ${260 + i * 45}ms ${HOME_C.ease}` }}>
      <span style={{ width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: HOME_C.clayFlat, color: HOME_C.accent }}><Icon size={22} /></span>
      <span style={{ fontSize: 12.5, fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>{panel.label}</span>
    </Link>
  );
}

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
  // PERF (Faz 2): Dashboard KPI'ları yalnızca AÇIK arıza durumlarını (atama/müdahale
  // bekleyen/edilen) sayıyor. Önceden useDeviceFaultReports() 730 gün + 10.000 kayıt
  // (kapalılar dahil) + 60sn refetch çekiyordu — KPI için fazlası. Faz 4'te eklenmiş
  // ama hiç kullanılmayan useOpenDeviceFaultReports (yalnızca aktif durumlar, limit 1000)
  // tam karşılığı; çok daha hafif.
  const { data: faultReports = [], isLoading: faultsLoading } = useOpenDeviceFaultReports();
  const { data: purchasingTasks = [], isLoading: tasksLoading } = usePurchasingTasks();
  const { data: expiringCountServer = 0, isLoading: expiringLoading } = useExpiringProductsCount();

  // Faz 5: Pre-aggregated KPI özet — Cloud Function realtime günceller.
  const { data: companyStats } = useCompanyStats();

  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('weekly');
  const [trendDate, setTrendDate] = useState(new Date());

  // Responsive: mobile (<720) / tablet (<1080) / wide — clay layout breakpoints
  const [mode, setMode] = useState<'mobile' | 'tablet' | 'wide'>('wide');
  useEffect(() => {
    const get = (): 'mobile' | 'tablet' | 'wide' => {
      const w = window.innerWidth;
      return w < 720 ? 'mobile' : w < 1080 ? 'tablet' : 'wide';
    };
    const update = () => setMode(get());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('orientationchange', update); };
  }, []);
  const isMobile = mode === 'mobile';
  const tablet = mode === 'tablet';
  const wide = mode === 'wide';

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

        try { const s = await getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)); productDocs = s.docs; } catch (e) { console.warn('[Dashboard] productCodes fetch failed:', e); }
        try {
          // Dashboard sadece mevcut stoğu (sevk edilmemiş) sayar; isShipped=true
          // kayıtlar zaman içinde birikir ama özet için gerekmez.
          const s = await getDocs(scopedQuery(
            'depoStok',
            currentCompanyId,
            isSuperAdmin,
            where('isShipped', '==', false),
          ));
          stockDocs = s.docs;
        } catch (e) { console.warn('[Dashboard] depoStok fetch failed:', e); }
        try { const s = await getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)); depotDocs = s.docs; } catch (e) { console.warn('[Dashboard] depots fetch failed:', e); }

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

        try { const s = await getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)); productDocs2 = s.docs; } catch (e) { console.warn('[Dashboard] yesterday productCodes fetch failed:', e); }
        try {
          // Scope bug fix: önceki sürüm companyId filtresizdi.
          const s = await getDocs(scopedQuery(
            'tuketimKayitlari',
            currentCompanyId,
            isSuperAdmin,
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
        const effSnap = await getDocs(scopedQuery('totalEfficiencyRecords', currentCompanyId, isSuperAdmin));
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

  // Tüketim trendi — animasyonlu çizgi grafik verisi
  const trendSpark = stockConsumptionTrend.map((d: any) => Number(d['Tüketim']) || 0);
  const trendLabels = stockConsumptionTrend.map((d: any) => String(d.date ?? ''));
  const trendTotal = trendSpark.reduce((a, b) => a + b, 0);

  // Fault total (atama+müdahale)
  const faultTotal = faultKpis.atamaBekleyen + faultKpis.mudahaleBekleyen + faultKpis.mudahaleEdilen;

  const hasStockCost = totalStockCost !== null && totalStockCost > 0;

  const faultStats = [
    { key: 'atama', label: 'Atama Bekleyen', value: faultKpis.atamaBekleyen, tone: HOME_C.accent, bg: `${HOME_C.accent}14`, icon: UserPlus2, href: '/ariza-yonetimi?status=atama_bekliyor' },
    { key: 'mb', label: 'Müdahale Bekleyen', value: faultKpis.mudahaleBekleyen, tone: HOME_C.danger, bg: 'rgba(192,121,106,0.12)', icon: TimerReset, href: '/ariza-yonetimi?status=mudahale_bekliyor' },
    { key: 'me', label: 'Müdahale Edilen', value: faultKpis.mudahaleEdilen, tone: HOME_C.waterDeep, bg: 'rgba(111,181,133,0.14)', icon: ActivitySquare, href: '/ariza-yonetimi?status=mudahale_ediliyor' },
  ];

  // Bugün — yapılan / toplam görev
  const totalToday = todayTasks.length;
  const doneToday = todayTasks.filter((t: any) => t.completed).length;
  const todayPct = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;

  // Miad göstergesi (gauge — adet kapaklı oran)
  const miadCount = typeof expiringProductsCount === 'number' ? expiringProductsCount : 0;
  const miadPct = Math.min(miadCount / 50, 1);

  // Kullanıcı baş harfleri
  const userName = currentUserProfile?.name || 'Lojistik & Stok';
  const initials = userName.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || 'QO';

  const periodSeg = (['daily', 'weekly', 'monthly', 'yearly'] as TrendPeriod[]);
  const periodLabel: Record<TrendPeriod, string> = { daily: 'G', weekly: 'H', monthly: 'A', yearly: 'Y' };

  const gap = isMobile ? 12 : 14;

  return (
    <>
      <ClayShell style={{ padding: isMobile ? '16px 14px 30px' : wide ? '18px 26px 28px' : '20px 22px 30px' }}>
        <div style={{ maxWidth: 1480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 16, flexWrap: 'wrap' }}>
            <div style={{ width: isMobile ? 44 : 50, height: isMobile ? 44 : 50, borderRadius: 16, flexShrink: 0, display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(circle at 32% 28%, ${HOME_C.accent2}, ${HOME_C.accent})`, boxShadow: `inset 0 1px 1px rgba(255,255,255,0.4), 0 10px 20px -8px ${HOME_C.accentGlow}`, fontSize: isMobile ? 17 : 20, fontWeight: 800 }}>{initials}</div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: isMobile ? 21 : 26, fontWeight: 800, letterSpacing: '-0.02em', color: HOME_C.ink1 }}>{userName}</h1>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: HOME_C.ink2 }}>Hoş geldin · genel bakış</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              {!isMobile && <span style={{ fontSize: 14, fontWeight: 700, color: HOME_C.ink2, fontFamily: 'ui-monospace, monospace' }}>{format(new Date(), 'dd MMMM yyyy · EEEE', { locale: tr })}</span>}
              <ClayIconBtn round><Bell size={18} /></ClayIconBtn>
            </div>
          </div>

          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : tablet ? '1fr 1fr' : 'minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr)', gap, alignItems: 'stretch' }}>
            {/* Cihaz Atama Durumu */}
            <div style={{ gridColumn: tablet ? '1 / -1' : 'auto' }}>
              <ClayCard>
                <CardHead ico={<ActivitySquare size={19} />} title="Cihaz Atama Durumu" tone="accent" right={<Pill>{faultTotal} toplam</Pill>} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
                  {faultStats.map((s, i) => <MiniKpi key={s.key} s={s} i={i} />)}
                </div>
              </ClayCard>
            </div>

            {/* Miad ≤ 45 Gün */}
            <Link href="/stok-yonetimi" style={{ textDecoration: 'none', display: 'block' }}>
              <ClayCard hover>
                <CardHead ico={<AlertTriangle size={19} />} title="Miad ≤ 45 Gün" tone="amber" right={<span style={{ color: HOME_C.ink3, display: 'inline-flex' }}><ArrowUpRight size={16} /></span>} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 14 }}>
                  <Ring pct={miadPct} size={86} stroke={10} color={HOME_C.amber} delay={200}>
                    <div style={{ textAlign: 'center' }}>
                      <CountText value={miadCount} style={{ fontSize: 26, fontWeight: 800, color: HOME_C.ink1, lineHeight: 1, fontVariantNumeric: 'tabular-nums', display: 'block' }} />
                      <div style={{ fontSize: 11, fontWeight: 600, color: HOME_C.ink3 }}>ürün</div>
                    </div>
                  </Ring>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: HOME_C.ink2, lineHeight: 1.45 }}>Tüm depolarda miadı yaklaşan ürünler</div>
                    <div style={{ marginTop: 12 }}><Tag tone={HOME_C.amber} bg={HOME_C.amberSoft}>≤ 45 gün penceresi</Tag></div>
                  </div>
                </div>
              </ClayCard>
            </Link>

            {/* Anlık Maliyet */}
            <ClayCard tone="ok" onClick={() => setIsStockCostDetailOpen(true)} hover>
              <CardHead ico={<Banknote size={19} />} title="Anlık Maliyet" tone="ok" right={<ClayIconBtn spin onClick={() => loadStockCostSnapshot(true)}><RefreshCw size={16} /></ClayIconBtn>} />
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  {totalStockCost === null
                    ? <span style={{ fontSize: 34, fontWeight: 800, color: HOME_C.ink3 }}>…</span>
                    : <CountText value={totalStockCost} format={fmtTL} style={{ fontSize: isMobile ? 30 : 36, fontWeight: 800, color: HOME_C.ink1, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 14, padding: '12px 16px', borderRadius: HOME_C.radiusSm, background: 'rgba(192,121,106,0.10)', boxShadow: 'inset 0 0 0 1px rgba(192,121,106,0.18)' }}>
                  <span style={{ color: HOME_C.danger, display: 'inline-flex' }}><AlertTriangle size={18} /></span>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: HOME_C.danger, letterSpacing: '0.02em' }}>RİSKLİ STOK</span>
                  <span style={{ marginLeft: 'auto', fontSize: 17, fontWeight: 800, color: HOME_C.danger, fontVariantNumeric: 'tabular-nums' }}>{riskyCost !== null ? fmtTL(riskyCost) : '…'}</span>
                </div>
              </div>
            </ClayCard>
          </div>

          {/* Trend + Today */}
          <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(0,1.55fr) minmax(0,1fr)' : '1fr', gap }}>
            {/* Tüketim Trendi */}
            <ClayCard onClick={() => setIsConsumptionModalOpen(true)} hover>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 6, flexWrap: 'wrap' }}>
                <CardHead ico={<TrendingUp size={19} />} title="Tüketim Trendi" tone="accent" flush />
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Segmented value={trendPeriod} onChange={(v) => setTrendPeriod(v)} options={periodSeg.map(p => ({ v: p, l: periodLabel[p] }))} />
                  <ClayIconBtn onClick={() => setIsConsumptionModalOpen(true)}><Maximize2 size={16} /></ClayIconBtn>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <CountText value={trendTotal} style={{ fontSize: isMobile ? 32 : 40, fontWeight: 800, color: HOME_C.ink1, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', display: 'block' }} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: HOME_C.ink2, marginTop: 6 }}>{trendTitle}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <ClayIconBtn round onClick={() => handleTrendNav('prev')}><ChevronLeft size={16} /></ClayIconBtn>
                  <ClayIconBtn round onClick={() => handleTrendNav('next')}><ChevronRight size={16} /></ClayIconBtn>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <ClayLineChart data={trendSpark.length ? trendSpark : [0]} labels={trendLabels.length ? trendLabels : ['']} height={isMobile ? 180 : wide ? 176 : 210} animKey={trendPeriod + trendTitle} yTicks />
              </div>
            </ClayCard>

            {/* Bugün */}
            <ClayCard>
              <CardHead ico={<CalendarCheck size={19} />} title="Bugün" tone="accent" right={<Pill>{doneToday}/{totalToday} görev</Pill>} />
              <div style={{ marginTop: 10, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: HOME_C.ink3, marginBottom: 7 }}>
                  <span>{format(new Date(), 'dd MMMM yyyy · EEEE', { locale: tr })}</span><span>%{todayPct}</span>
                </div>
                <ClayBar pct={todayPct} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: isMobile ? 'none' : wide ? 168 : 220, overflowY: 'auto', paddingRight: 4 }}>
                {totalToday === 0 ? (
                  <div style={{ padding: '30px 0', textAlign: 'center', color: HOME_C.ink3, fontSize: 13, fontWeight: 600 }}>Bugün için planlanmış görev yok.</div>
                ) : todayTasks.map((t: any, i: number) => (
                  <div key={t.id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: HOME_C.radiusSm, background: t.completed ? 'rgba(111,181,133,0.09)' : HOME_C.surfaceHi, boxShadow: t.completed ? 'none' : HOME_C.clayFlat, animation: `mkPopIn ${300 + Math.min(i, 8) * 80}ms ${HOME_C.ease}` }}>
                    <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: t.completed ? HOME_C.waterSolid : HOME_C.surface2, boxShadow: t.completed ? '0 4px 9px -3px rgba(111,181,133,0.6)' : HOME_C.clayInset, color: t.completed ? '#fff' : HOME_C.ink3 }}>{t.completed ? <Check size={14} /> : <span style={{ width: 7, height: 7, borderRadius: '50%', background: HOME_C.accent }} />}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: HOME_C.ink3, fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>{t.startTime}</span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: t.completed ? HOME_C.ink3 : HOME_C.ink1, textDecoration: t.completed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  </div>
                ))}
              </div>
            </ClayCard>
          </div>

          {/* Sık Kullanılanlar — kahve kart / krem butonlar */}
          <ClayCard tone="brown" pad={isMobile ? 14 : 18}>
            <CardHead ico={<Search size={19} />} title="Sık Kullanılanlar" onLight right={<Pill onLight>{visiblePanels.length}</Pill>} />
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 3 : tablet ? 5 : 7}, 1fr)`, gap: isMobile ? 10 : 12, marginTop: 16 }}>
              {visiblePanels.map((panel, i) => <ShortcutTile key={panel.key} panel={panel} i={i} />)}
            </div>
          </ClayCard>

        </div>
      </ClayShell>

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
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto border-0 p-0" style={{ background: `linear-gradient(180deg, ${HOME_C.surface} 0%, ${HOME_C.surface2} 100%)`, boxShadow: HOME_C.clay, borderRadius: HOME_C.radiusLg }}>
          <DialogHeader style={{ padding: '22px 26px 16px', borderBottom: `1px solid ${HOME_C.line}` }}>
            <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 20, fontWeight: 800, color: HOME_C.ink1, letterSpacing: '-0.02em' }}>
              <span style={{ width: 40, height: 40, borderRadius: 13, display: 'grid', placeItems: 'center', color: HOME_C.waterDeep, background: 'rgba(111,181,133,0.14)', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><Banknote size={20} /></span>
              Anlık Maliyet Detayı
            </DialogTitle>
            <DialogDescription style={{ fontSize: 13.5, color: HOME_C.ink2, fontWeight: 500, marginTop: 4 }}>
              Kırılım sırası: Marka → Kurum (Depo/Lab) → Ürün.
            </DialogDescription>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 26px 26px' }}>
            {stockCostBreakdown.length === 0 ? (
              <p style={{ fontSize: 14, color: HOME_C.ink3, fontWeight: 600, textAlign: 'center', padding: '40px 0' }}>Detay verisi bulunamadı.</p>
            ) : stockCostBreakdown.map((brand) => (
              <details key={brand.brand} style={{ borderRadius: HOME_C.radius, background: HOME_C.surfaceHi, boxShadow: HOME_C.clayFlat, padding: 14 }} open>
                <summary style={{ cursor: 'pointer', listStyle: 'none', fontWeight: 800, fontSize: 14.5, color: HOME_C.ink1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span>{brand.brand}</span>
                  <span style={{ color: HOME_C.waterDeep, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTL(brand.tryTotal)}
                  </span>
                </summary>
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {brand.locations.map((location) => (
                    <details key={`${location.type}-${location.id}`} style={{ borderRadius: HOME_C.radiusSm, background: HOME_C.surface2, boxShadow: HOME_C.clayInset, padding: 12 }}>
                      <summary style={{ cursor: 'pointer', listStyle: 'none', fontSize: 13.5, fontWeight: 700, color: HOME_C.ink1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          <Tag tone={location.type === 'depo' ? HOME_C.accent : HOME_C.skyDeep} bg={location.type === 'depo' ? `${HOME_C.accent}16` : 'rgba(124,168,222,0.16)'}>{location.type === 'depo' ? 'Depo' : 'Lab'}</Tag>
                          {location.name}
                        </span>
                        <span style={{ fontWeight: 700, color: HOME_C.ink2, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtTL(location.tryTotal)}
                        </span>
                      </summary>
                      <div style={{ marginTop: 10, overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ textAlign: 'left', color: HOME_C.ink3, borderBottom: `1px solid ${HOME_C.line}` }}>
                              <th style={{ padding: '6px 8px 6px 0', fontWeight: 700 }}>Stok Kodu</th>
                              <th style={{ padding: '6px 8px 6px 0', fontWeight: 700 }}>Ürün</th>
                              <th style={{ padding: '6px 8px 6px 0', fontWeight: 700 }}>Adet</th>
                              <th style={{ padding: '6px 0 6px 8px', fontWeight: 700, textAlign: 'right' }}>Toplam (TRY)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {location.products.map((product) => (
                              <tr key={product.stokKodu} style={{ borderBottom: `1px solid ${HOME_C.line}` }}>
                                <td style={{ padding: '7px 8px 7px 0', fontFamily: 'ui-monospace, monospace', color: HOME_C.ink2 }}>{product.stokKodu}</td>
                                <td style={{ padding: '7px 8px 7px 0', color: HOME_C.ink1, fontWeight: 600 }}>{product.stokAdi}</td>
                                <td style={{ padding: '7px 8px 7px 0', color: HOME_C.ink2 }}>{product.quantity}</td>
                                <td style={{ padding: '7px 0 7px 8px', textAlign: 'right', fontWeight: 700, color: HOME_C.ink1, fontVariantNumeric: 'tabular-nums' }}>
                                  {fmtTL(product.tryTotal)}
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
