'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { Loader2, BarChart3 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import type { ProductCode, Currency } from '@/lib/types';
import { PieChart, ResponsiveContainer, Pie, Cell, Tooltip as RechartsTooltip, LineChart, Line, XAxis, YAxis } from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, TrendingUp, TrendingDown, PieChart as PieChartIcon,
  Wallet, BarChart3, Calendar, ChevronRight, ArrowLeft,
  MapPin, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, eachMonthOfInterval, endOfMonth, isValid, subMonths } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import CostKPICard from '@/components/cost-observation/CostKPICard';
import TrendChart from '@/components/cost-observation/TrendChart';
import BrandDistribution from '@/components/cost-observation/BrandDistribution';
import LocationBreakdown from '@/components/cost-observation/LocationBreakdown';
import BrandOverviewGrid from '@/components/cost-observation/BrandOverviewGrid';
import SessionTimeline from '@/components/cost-observation/SessionTimeline';
import BudgetComparison from '@/components/cost-observation/BudgetComparison';
import CapitalEfficiency from '@/components/cost-observation/CapitalEfficiency';
import ExpiryRiskCard from '@/components/cost-observation/ExpiryRiskCard';
import ProductGroupBreakdown from '@/components/cost-observation/ProductGroupBreakdown';
import {
  calculateTotalCostForRange,
  calculateTurnoverMetrics,
  getBrandCostBreakdown,
  getComparisonDeltas,
  getLocationCostBreakdown,
  getMonthlyTrend,
  getProductCostInCurrency,
  getProductGroupBreakdown,
  type SayimSession,
  type TimeRange,
} from '@/lib/cost-analytics';

const CURRENCY_SYMBOLS: Record<Currency, string> = { EUR: '€', USD: '$', TRY: '₺' };
const PRIMARY_API_KEY = 'e69314b14644080788775553';
const CACHE_TTL = 1000 * 60 * 60;

async function fetchExchangeRates(): Promise<Record<Currency, number>> {
  const cacheKey = 'exchange_rates_cache';
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) return data;
    }
  } catch {}

  try {
    const res = await fetch(`https://v6.exchangerate-api.com/v6/${PRIMARY_API_KEY}/latest/EUR`);
    if (!res.ok) throw new Error('Primary failed');
    const data = await res.json();
    const rates = { EUR: 1, USD: data.conversion_rates.USD, TRY: data.conversion_rates.TRY };
    localStorage.setItem(cacheKey, JSON.stringify({ data: rates, timestamp: Date.now() }));
    return rates;
  } catch {
    return { EUR: 1, USD: 1.08, TRY: 38.5 };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function fmtCurrency(value: number, symbol: string): string {
  return `${symbol}${value.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtCurrencyDetailed(value: number, symbol: string): string {
  return `${symbol}${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSessionDate(session: SayimSession): Date | null {
  if (!session.createdAt) return null;
  if (session.createdAt.toDate) return session.createdAt.toDate();
  if (session.createdAt.seconds) return new Date(session.createdAt.seconds * 1000);
  const d = new Date(session.createdAt);
  return isValid(d) ? d : null;
}

/** Get cost of a single session in the given currency */
function getSessionCost(
  session: SayimSession,
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency
): number {
  return session.items.reduce((sum, item) => {
    const product = productMap.get(item.stokKodu);
    if (!product?.cost || !product?.ambalajDegeri) return sum;
    const totalTest = (item.stokAdedi * product.ambalajDegeri) + item.cihazUstuAdedi;
    const costPerTest = product.cost / product.ambalajDegeri;
    const totalNative = costPerTest * totalTest;
    const productCurrency = (product.currency || 'TRY') as Currency;

    let costEUR: number;
    switch (productCurrency) {
      case 'EUR': costEUR = totalNative; break;
      case 'USD': costEUR = totalNative / (rates.USD || 1); break;
      case 'TRY': costEUR = totalNative / (rates.TRY || 1); break;
      default: costEUR = totalNative / (rates.TRY || 1);
    }
    return sum + costEUR * (rates[currency] || 1);
  }, 0);
}

/** Get latest session per location */
function getLatestPerLocation(sessions: SayimSession[]): SayimSession[] {
  const map = new Map<string, SayimSession>();
  // sessions already sorted desc by createdAt
  for (const s of sessions) {
    const key = `${s.locationType}-${s.locationId}`;
    if (!map.has(key)) map.set(key, s);
  }
  return Array.from(map.values());
}

// ============================================================================
// PROPS
// ============================================================================

interface CostDashboardPanelProps {
  productCodes: ProductCode[];
}

type TimePeriod = 'latest' | '3m' | '6m' | '12m' | 'all';

// ============================================================================
// COMPONENT
// ============================================================================

export default function CostDashboardPanel({ productCodes }: CostDashboardPanelProps) {
  const router = useRouter();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [rates, setRates] = useState<Record<Currency, number> | null>(null);
  const [currency, setCurrency] = useState<Currency>('TRY');
  const [sessions, setSessions] = useState<SayimSession[]>([]);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('12m');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const { currentCompanyId, isSuperAdmin } = useAuth();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [rateData, sessionSnap, depoSnap] = await Promise.all([
          fetchExchangeRates(),
          getDocs(query(collection(db, 'maliyetSayimSessions'), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'depoStok')),
        ]);
        setRates(ratesData);
        const allSessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as SayimSession));
        setSessions(filterByCompanyScope(allSessions, currentCompanyId, isSuperAdmin));
      } catch (err) {
        console.error('Error loading cost dashboard:', err);
        try {
          const ratesData = await fetchExchangeRates();
          setRates(ratesData);
        } catch {}
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [currentCompanyId, isSuperAdmin]);

  const productMap = useMemo(() => {
    const map = new Map<string, ProductCode>();
    productCodes.forEach((p) => map.set(p.stokKodu, p));
    return map;
  }, [productCodes]);

  const sym = CURRENCY_SYMBOLS[currency];

  // ---- Filter sessions by time period ----
  const filteredSessions = useMemo(() => {
    if (timePeriod === 'all' || timePeriod === 'latest') return sessions;
    const now = new Date();
    const months = timePeriod === '3m' ? 3 : timePeriod === '6m' ? 6 : 12;
    const cutoff = subMonths(now, months);
    return sessions.filter(s => {
      const d = getSessionDate(s);
      return d && d >= cutoff;
    });
  }, [sessions, timePeriod]);

  // ---- KONSOLIDE: latest session per location (real total across all locations) ----
  const latestPerLocation = useMemo(() => {
    return getLatestPerLocation(sessions);
  }, [sessions]);

  const consolidatedCost = useMemo(() => {
    if (!rates) return 0;
    return latestPerLocation.reduce((sum, s) => sum + getSessionCost(s, productMap, rates, currency), 0);
  }, [latestPerLocation, productMap, rates, currency]);

  // ---- Previous period cost for change indicator ----
  const previousPeriodCost = useMemo(() => {
    if (!rates || sessions.length < 2) return null;
    // Compare latest per location vs the one before that
    const previousMap = new Map<string, SayimSession>();
    const latestKeys = new Set(latestPerLocation.map(s => `${s.locationType}-${s.locationId}`));

    for (const s of sessions) {
      const key = `${s.locationType}-${s.locationId}`;
      if (latestKeys.has(key)) {
        // skip the latest, take the second one
        if (previousMap.has(key)) continue;
        const latest = latestPerLocation.find(l => `${l.locationType}-${l.locationId}` === key);
        if (latest && s.id !== latest.id && !previousMap.has(key)) {
          previousMap.set(key, s);
        }
      }
    }

    if (previousMap.size === 0) return null;
    return Array.from(previousMap.values()).reduce(
      (sum, s) => sum + getSessionCost(s, productMap, rates, currency), 0
    );
  }, [sessions, latestPerLocation, productMap, rates, currency]);

  const costChange = useMemo(() => {
    if (previousPeriodCost === null || previousPeriodCost === 0) return null;
    const diff = consolidatedCost - previousPeriodCost;
    const pct = (diff / previousPeriodCost) * 100;
    return { diff, pct, direction: diff >= 0 ? 'up' as const : 'down' as const };
  }, [consolidatedCost, previousPeriodCost]);

  // ---- Location breakdown ----
  const locationBreakdown = useMemo(() => {
    if (!rates) return [];
    return latestPerLocation.map(s => {
      const cost = getSessionCost(s, productMap, rates, currency);
      const date = getSessionDate(s);
      return {
        id: s.locationId,
        name: s.locationName,
        type: s.locationType,
        cost,
        productCount: s.items.length,
        date,
      };
    }).sort((a, b) => b.cost - a.cost);
  }, [latestPerLocation, productMap, rates, currency]);

  // ---- Brand costs (from ALL latest-per-location, not just one session) ----
  const brandCosts = useMemo(() => {
    if (!rates) return [];
    const map = new Map<string, { cost: number; productCount: number }>();
    latestPerLocation.forEach(session => {
      session.items.forEach(item => {
        const brand = item.marka || 'Diğer';
        const product = productMap.get(item.stokKodu);
        if (!product?.cost || !product?.ambalajDegeri) return;
        const totalTest = (item.stokAdedi * product.ambalajDegeri) + item.cihazUstuAdedi;
        const costPerTest = product.cost / product.ambalajDegeri;
        const totalNative = costPerTest * totalTest;
        const productCurrency = (product.currency || 'TRY') as Currency;

        let costEUR: number;
        switch (productCurrency) {
          case 'EUR': costEUR = totalNative; break;
          case 'USD': costEUR = totalNative / (rates.USD || 1); break;
          case 'TRY': costEUR = totalNative / (rates.TRY || 1); break;
          default: costEUR = totalNative / (rates.TRY || 1);
        }
        const cost = costEUR * (rates[currency] || 1);
        const existing = map.get(brand) || { cost: 0, productCount: 0 };
        map.set(brand, { cost: existing.cost + cost, productCount: existing.productCount + 1 });
      });
    });
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .filter(d => d.cost > 0)
      .sort((a, b) => b.cost - a.cost);
  }, [latestPerLocation, productMap, rates, currency]);

  // ---- Product group breakdown (Kit / Sarf / Yedek Parça) ----
  const groupBreakdown = useMemo(() => {
    if (!rates) return [];
    const map = new Map<string, number>();
    latestPerLocation.forEach(session => {
      session.items.forEach(item => {
        const product = productMap.get(item.stokKodu);
        if (!product?.cost || !product?.ambalajDegeri) return;
        const group = product.urunGrubu === 'kit' ? 'Kit'
          : product.urunGrubu === 'sarf' ? 'Sarf Malzeme'
          : product.urunGrubu === 'yedek_parca' ? 'Yedek Parça'
          : 'Diğer';
        const totalTest = (item.stokAdedi * product.ambalajDegeri) + item.cihazUstuAdedi;
        const costPerTest = product.cost / product.ambalajDegeri;
        const totalNative = costPerTest * totalTest;
        const productCurrency = (product.currency || 'TRY') as Currency;

        let costEUR: number;
        switch (productCurrency) {
          case 'EUR': costEUR = totalNative; break;
          case 'USD': costEUR = totalNative / (rates.USD || 1); break;
          case 'TRY': costEUR = totalNative / (rates.TRY || 1); break;
          default: costEUR = totalNative / (rates.TRY || 1);
        }
        const cost = costEUR * (rates[currency] || 1);
        map.set(group, (map.get(group) || 0) + cost);
      });
    });
    return Array.from(map.entries())
      .map(([name, cost]) => ({ name, cost }))
      .sort((a, b) => b.cost - a.cost);
  }, [latestPerLocation, productMap, rates, currency]);

  // ---- Monthly trend (using latest-per-location per month for consolidated view) ----
  const monthlyTrend = useMemo(() => {
    if (!rates || sessions.length === 0) return [];
    const months = timePeriod === '3m' ? 3 : timePeriod === '6m' ? 6 : 12;
    const now = new Date();
    const startDate = subMonths(now, months);
    const monthRange = eachMonthOfInterval({ start: startDate, end: now });

    return monthRange.map(monthStart => {
      const monthEnd = endOfMonth(monthStart);
      // Find sessions up to this month end
      const sessionsUpToMonth = sessions.filter(s => {
        const d = getSessionDate(s);
        return d && d <= monthEnd;
      });

      // Get latest per location as of this month
      const latestPerLoc = getLatestPerLocation(sessionsUpToMonth);
      const cost = latestPerLoc.reduce((sum, s) => sum + getSessionCost(s, productMap, rates, currency), 0);

      return {
        month: format(monthStart, 'MMM yy', { locale: tr }),
        cost,
      };
    });
  }, [sessions, rates, productMap, currency, timePeriod]);

  // ---- Brand detail products ----
  const brandProducts = useMemo(() => {
    if (!rates || !selectedBrand) return [];
    const products: { stokKodu: string; stokAdi: string; stokAdedi: number; cihazUstuAdedi: number; cost: number; nativeCurrency: string; locationName: string }[] = [];
    latestPerLocation.forEach(session => {
      session.items
        .filter(item => (item.marka || 'Diğer') === selectedBrand)
        .forEach(item => {
          const product = productMap.get(item.stokKodu);
          if (!product?.cost || !product?.ambalajDegeri) return;
          const totalTest = (item.stokAdedi * product.ambalajDegeri) + item.cihazUstuAdedi;
          const costPerTest = product.cost / product.ambalajDegeri;
          const totalNative = costPerTest * totalTest;
          const productCurrency = (product.currency || 'TRY') as Currency;
          let costEUR: number;
          switch (productCurrency) {
            case 'EUR': costEUR = totalNative; break;
            case 'USD': costEUR = totalNative / (rates.USD || 1); break;
            case 'TRY': costEUR = totalNative / (rates.TRY || 1); break;
            default: costEUR = totalNative / (rates.TRY || 1);
          }
          products.push({
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            stokAdedi: item.stokAdedi,
            cihazUstuAdedi: item.cihazUstuAdedi,
            cost: costEUR * (rates[currency] || 1),
            nativeCurrency: productCurrency,
            locationName: session.locationName,
          });
        });
    });
    return products.filter(p => p.cost > 0).sort((a, b) => b.cost - a.cost);
  }, [latestPerLocation, selectedBrand, productMap, rates, currency]);

  const monthlyBudget = useMemo(() => {
    const local = Number(localStorage.getItem('cost_dashboard_budget') || 0);
    if (local > 0) return local;
    return totalCost * 0.9;
  }, [totalCost]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-screen cihaz-shell">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    );
  }

  // Brand detail view
  if (selectedBrand) {
    const brandTotal = brandProducts.reduce((s, p) => s + p.cost, 0);
    return (
      <div className="cihaz-shell min-h-screen">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setSelectedBrand(null)}
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-[var(--dashboard-text)]">{selectedBrand}</h1>
              <p className="text-xs text-[var(--dashboard-muted)]">{brandProducts.length} ürün · Toplam {fmtCurrency(brandTotal, sym)}</p>
            </div>
          </div>

          <div className="space-y-2">
            {brandProducts.map((p, i) => (
              <div key={`${p.stokKodu}-${p.locationName}-${i}`} className="cihaz-card p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--dashboard-text)]">{p.stokAdi}</p>
                  <p className="text-[11px] text-[var(--dashboard-muted)] mt-0.5">
                    {p.stokKodu} · Stok: {p.stokAdedi}
                    {p.cihazUstuAdedi > 0 && ` · Cihaz Üstü: ${p.cihazUstuAdedi}`}
                    {latestPerLocation.length > 1 && ` · ${p.locationName}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-sm font-semibold text-[var(--dashboard-accent)]">{fmtCurrencyDetailed(p.cost, sym)}</span>
                  {p.nativeCurrency !== currency && (
                    <p className="text-[10px] text-[var(--dashboard-muted)]">{CURRENCY_SYMBOLS[p.nativeCurrency as Currency]}{p.nativeCurrency}</p>
                  )}
                </div>
              </div>
            ))}
            {brandProducts.length === 0 && (
              <div className="cihaz-card p-8 text-center text-sm text-[var(--dashboard-muted)]">Bu markada veri yok.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <BarChart3 className="h-5 w-5 text-[var(--dashboard-accent)]" />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Maliyet Gözlem Merkezi</h1>
              <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">CFO görünümü: delta, konsolide toplam, bütçe ve risk analizi</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {(['EUR', 'USD', 'TRY'] as Currency[]).map((cur) => (
              <button key={cur} onClick={() => setCurrency(cur)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${currency === cur ? 'bg-[var(--dashboard-accent)] text-white' : 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]'}`}>
                {CURRENCY_SYMBOLS[cur]} {cur}
              </button>
            ))}
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="cihaz-card-strong p-16 text-center">
            <Wallet className="w-12 h-12 text-[var(--dashboard-muted)] mx-auto mb-4 opacity-40" />
            <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Henüz sayım verisi yok</p>
            <p className="text-xs text-[var(--dashboard-muted)]">Maliyet sayımı yapıldıkça veriler burada görünecek.</p>
          </div>
        ) : (
          <>
            {/* ===== CONSOLIDATED COST + CHANGE ===== */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5 mb-5">

              {/* Total cost card */}
              <div className="cihaz-card-strong p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-1">
                  <Wallet className="w-4 h-4 text-[var(--dashboard-accent)]" />
                  <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Toplam Envanter Maliyeti</span>
                </div>
                <p className="text-[11px] text-[var(--dashboard-muted)] mb-3">
                  {latestPerLocation.length} konumun en güncel sayım toplamı
                </p>

                <div className="flex items-end gap-3 mb-3">
                  <span className="text-3xl sm:text-4xl font-bold text-[var(--dashboard-accent)]">
                    {fmtCurrency(consolidatedCost, sym)}
                  </span>
                  {costChange && (
                    <span className={cn(
                      'flex items-center gap-0.5 px-2 py-1 rounded-lg text-xs font-semibold mb-1',
                      costChange.direction === 'up'
                        ? 'bg-red-500/10 text-red-600'
                        : 'bg-emerald-500/10 text-emerald-600'
                    )}>
                      {costChange.direction === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      %{Math.abs(costChange.pct).toFixed(1)}
                      <span className="font-normal ml-0.5 text-[10px] opacity-70">önceki sayıma göre</span>
                    </span>
                  )}
                </div>

                {latestPerLocation.length > 0 && (
                  <p className="text-[11px] text-[var(--dashboard-muted)]">
                    Son güncelleme: {latestPerLocation.map(s => {
                      const d = getSessionDate(s);
                      return d ? format(d, 'dd MMM', { locale: tr }) : '';
                    }).filter(Boolean).join(', ')}
                  </p>
                )}
              </div>

              {/* Location breakdown */}
              <div className="cihaz-card-strong p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="w-4 h-4 text-[var(--dashboard-accent)]" />
                  <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Konum Bazlı Maliyet</span>
                </div>
                <ScrollArea className="h-[180px]">
                  <div className="space-y-2 pr-2">
                    {locationBreakdown.map(loc => (
                      <div key={loc.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)]/50">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-[var(--dashboard-text)] truncate">{loc.name}</span>
                          </div>
                          <p className="text-[10px] text-[var(--dashboard-muted)]">
                            {loc.type === 'lab' ? 'Lab' : 'Depo'} · {loc.productCount} ürün
                            {loc.date && ` · ${format(loc.date, 'dd MMM yyyy', { locale: tr })}`}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-[var(--dashboard-accent)] shrink-0 ml-3">{fmtCurrency(loc.cost, sym)}</span>
                      </div>
                    ))}
                    {locationBreakdown.length === 0 && (
                      <p className="text-center py-6 text-sm text-[var(--dashboard-muted)]">Veri yok</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* ===== TREND CHART ===== */}
            <div className="cihaz-card-strong p-5 sm:p-6 mb-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[var(--dashboard-accent)]" />
                  <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Aylık Maliyet Trendi</span>
                </div>
                <div className="flex items-center gap-1">
                  {([
                    { key: '3m', label: '3 Ay' },
                    { key: '6m', label: '6 Ay' },
                    { key: '12m', label: '12 Ay' },
                    { key: 'all', label: 'Tümü' },
                  ] as { key: TimePeriod; label: string }[]).map(p => (
                    <button
                      key={p.key}
                      onClick={() => setTimePeriod(p.key)}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all',
                        timePeriod === p.key
                          ? 'bg-[var(--dashboard-accent)] text-white shadow-sm'
                          : 'text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[240px]">
                {monthlyTrend.some(m => m.cost > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyTrend}>
                      <XAxis
                        dataKey="month"
                        stroke="var(--dashboard-muted)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="var(--dashboard-muted)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${sym}${(v / 1000).toFixed(0)}k`}
                        width={55}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          background: 'var(--dashboard-surface)',
                          border: '1px solid var(--dashboard-stroke)',
                          borderRadius: '12px',
                          fontSize: '12px',
                          boxShadow: 'var(--dashboard-raised-soft)',
                        }}
                        formatter={(value: number) => [fmtCurrencyDetailed(value, sym), 'Maliyet']}
                      />
                      <Line
                        type="monotone"
                        dataKey="cost"
                        stroke="var(--dashboard-accent)"
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: 'var(--dashboard-accent)', stroke: 'var(--dashboard-surface)', strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-[var(--dashboard-muted)]">
                    Bu dönemde sayım verisi yok.
                  </div>
                )}
              </div>
            </div>

            {/* ===== BOTTOM GRID: Brand Pie + Product Group + Recent Sessions ===== */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* Brand pie chart */}
              <div className="cihaz-card-strong p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <PieChartIcon className="w-4 h-4 text-[var(--dashboard-accent)]" />
                  <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Marka Dağılımı</span>
                </div>
                <div className="h-[200px]">
                  {brandCosts.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={brandCosts}
                          dataKey="cost"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={75}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {brandCosts.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          contentStyle={{
                            background: 'var(--dashboard-surface)',
                            border: '1px solid var(--dashboard-stroke)',
                            borderRadius: '12px',
                            fontSize: '12px',
                          }}
                          formatter={(value: number) => [fmtCurrencyDetailed(value, sym), '']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm text-[var(--dashboard-muted)]">Veri yok</div>
                  )}
                </div>
                {/* Brand list (clickable) */}
                <div className="space-y-1 mt-3">
                  {brandCosts.slice(0, 6).map((b, i) => (
                    <button
                      key={b.name}
                      onClick={() => setSelectedBrand(b.name)}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[var(--dashboard-surface-2)]/50 transition-colors group text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-xs text-[var(--dashboard-text)] truncate">{b.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs font-semibold text-[var(--dashboard-accent)]">{fmtCurrency(b.cost, sym)}</span>
                        <ChevronRight className="w-3 h-3 text-[var(--dashboard-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  ))}
                  {brandCosts.length > 6 && (
                    <p className="text-[10px] text-[var(--dashboard-muted)] text-center pt-1">+{brandCosts.length - 6} marka daha</p>
                  )}
                </div>
              </div>

              {/* Product group breakdown */}
              <div className="cihaz-card-strong p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Layers className="w-4 h-4 text-[var(--dashboard-accent)]" />
                  <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Ürün Grubu Kırılımı</span>
                </div>
                <div className="space-y-3 mt-6">
                  {groupBreakdown.length > 0 ? groupBreakdown.map(g => {
                    const pct = consolidatedCost > 0 ? (g.cost / consolidatedCost) * 100 : 0;
                    return (
                      <div key={g.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-[var(--dashboard-text)]">{g.name}</span>
                          <span className="text-sm font-semibold text-[var(--dashboard-accent)]">{fmtCurrency(g.cost, sym)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--dashboard-accent)] transition-all duration-500"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5">Toplam maliyetin %{pct.toFixed(1)}'i</p>
                      </div>
                    );
                  }) : (
                    <div className="text-center py-8 text-sm text-[var(--dashboard-muted)]">
                      Ürün grubu bilgisi tanımlı değil.
                      <p className="text-[10px] mt-1">Ürün tanımlarında "Ürün Grubu" alanını doldurun.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent sessions */}
              <div className="cihaz-card-strong p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="w-4 h-4 text-[var(--dashboard-accent)]" />
                  <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Son Sayımlar</span>
                </div>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2 pr-2">
                    {sessions.slice(0, 15).map(session => {
                      const date = getSessionDate(session);
                      const sessionCost = rates ? getSessionCost(session, productMap, rates, currency) : 0;
                      return (
                        <div
                          key={session.id}
                          className="px-3 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)]/50"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-[var(--dashboard-text)] truncate">{session.locationName}</span>
                            <span className="text-xs font-semibold text-[var(--dashboard-accent)] shrink-0 ml-2">{fmtCurrency(sessionCost, sym)}</span>
                          </div>
                          <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5">
                            {date ? format(date, 'dd MMM yyyy HH:mm', { locale: tr }) : '—'}
                            {' · '}{session.items.length} ürün
                            {session.createdByName && ` · ${session.createdByName}`}
                          </p>
                        </div>
                      );
                    })}
                    {sessions.length === 0 && (
                      <p className="text-center py-8 text-sm text-[var(--dashboard-muted)]">Henüz sayım yok.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
