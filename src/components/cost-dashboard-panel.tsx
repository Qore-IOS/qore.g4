'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import type { ProductCode, Currency } from '@/lib/types';
// @ts-ignore
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { PieChart, ResponsiveContainer, Pie, Cell, Tooltip as RechartsTooltip, LineChart, Line, XAxis, YAxis } from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Loader2, TrendingUp, TrendingDown, PieChart as PieChartIcon,
  Wallet, BarChart3, Calendar, ChevronRight, ChevronDown, ArrowLeft, FileSpreadsheet, FileText,
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
import { useToast } from '@/hooks/use-toast';
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
const PIE_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#16a34a', '#ca8a04', '#dc2626'];
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
  const { toast } = useToast();
  const [isLoading, setLoading] = useState(false);
  const [rates, setRates] = useState<Record<Currency, number> | null>(null);
  const [currency, setCurrency] = useState<Currency>('TRY');
  const [sessions, setSessions] = useState<SayimSession[]>([]);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('12m');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const authCtx = useAuth();
  const companyId = authCtx.currentCompanyId;
  const superAdmin = authCtx.isSuperAdmin;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [rateData, sessionSnap] = await Promise.all([
          fetchExchangeRates(),
          getDocs(query(collection(db, 'maliyetSayimSessions'), orderBy('createdAt', 'desc'))),
        ]);
        setRates(rateData);
        const allSessions = sessionSnap.docs.map(d => ({ id: d.id, ...d.data() } as SayimSession));
        setSessions(filterByCompanyScope(allSessions, companyId, superAdmin));
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
  }, [companyId, superAdmin]);

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
      
      const enrichedItems = s.items.map(item => {
        const product = productMap.get(item.stokKodu);
        if (!product?.cost || !product?.ambalajDegeri) return { ...item, calculatedCost: 0, nativeCurrency: 'TRY' as Currency };
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
        return {
          ...item,
          calculatedCost: costEUR * (rates[currency] || 1),
          nativeCurrency: productCurrency
        };
      }).filter(i => i.calculatedCost > 0).sort((a,b) => b.calculatedCost - a.calculatedCost);

      return {
        id: s.locationId,
        name: s.locationName,
        type: s.locationType,
        cost,
        productCount: s.items.length,
        date,
        items: enrichedItems
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
    const map = new Map<string, {cost: number, items: any[]}>();
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
        
        const existing = map.get(group) || { cost: 0, items: [] };
        existing.items.push({
           stokKodu: item.stokKodu,
           stokAdi: item.stokAdi,
           stokAdedi: item.stokAdedi,
           cihazUstuAdedi: item.cihazUstuAdedi,
           locationName: session.locationName,
           calculatedCost: cost,
           nativeCurrency: productCurrency
        });
        existing.cost += cost;
        map.set(group, existing);
      });
    });
    return Array.from(map.entries())
      .map(([name, data]) => {
         const sortedItems = [...data.items].sort((a,b) => b.calculatedCost - a.calculatedCost);
         return { name, cost: data.cost, items: sortedItems };
      })
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

  // ---- Brand detail: location breakdown ----
  const brandLocationBreakdown = useMemo(() => {
    if (!rates || !selectedBrand) return [];
    return latestPerLocation.map(session => {
      let cost = 0;
      let productCount = 0;
      const items: any[] = [];
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
          const itemCost = costEUR * (rates[currency] || 1);
          cost += itemCost;
          productCount++;
          items.push({
            ...item,
            calculatedCost: itemCost,
            nativeCurrency: productCurrency
          });
        });
      const sortedItems = items.sort((a,b) => b.calculatedCost - a.calculatedCost);
      return { name: session.locationName, type: session.locationType, cost, productCount, items: sortedItems };
    }).filter(l => l.cost > 0).sort((a, b) => b.cost - a.cost);
  }, [latestPerLocation, selectedBrand, productMap, rates, currency]);

  // ---- Brand detail: product group breakdown ----
  const brandGroupBreakdown = useMemo(() => {
    if (!rates || !selectedBrand) return [];
    const map = new Map<string, {cost: number, items: any[]}>();
    latestPerLocation.forEach(session => {
      session.items
        .filter(item => (item.marka || 'Diğer') === selectedBrand)
        .forEach(item => {
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
          
          const existing = map.get(group) || { cost: 0, items: [] };
          existing.items.push({
             stokKodu: item.stokKodu,
             stokAdi: item.stokAdi,
             stokAdedi: item.stokAdedi,
             cihazUstuAdedi: item.cihazUstuAdedi,
             locationName: session.locationName,
             calculatedCost: cost,
             nativeCurrency: productCurrency
          });
          existing.cost += cost;
          map.set(group, existing);
        });
    });
    return Array.from(map.entries())
      .map(([name, data]) => {
         const sortedItems = [...data.items].sort((a,b) => b.calculatedCost - a.calculatedCost);
         return { name, cost: data.cost, items: sortedItems };
      })
      .sort((a, b) => b.cost - a.cost);
  }, [latestPerLocation, selectedBrand, productMap, rates, currency]);

  // ---- Brand detail: monthly trend ----
  const brandMonthlyTrend = useMemo(() => {
    if (!rates || !selectedBrand || sessions.length === 0) return [];
    const now = new Date();
    const startDate = subMonths(now, 12);
    const monthRange = eachMonthOfInterval({ start: startDate, end: now });

    return monthRange.map(monthStart => {
      const monthEndDate = endOfMonth(monthStart);
      const sessionsUpToMonth = sessions.filter(s => {
        const d = getSessionDate(s);
        return d && d <= monthEndDate;
      });
      const latestPerLoc = getLatestPerLocation(sessionsUpToMonth);

      let cost = 0;
      latestPerLoc.forEach(session => {
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
            cost += costEUR * (rates[currency] || 1);
          });
      });
      return { month: format(monthStart, 'MMM yy', { locale: tr }), cost };
    });
  }, [sessions, selectedBrand, rates, productMap, currency]);

  // ---- Brand detail: average unit cost ----
  const brandAvgUnitCost = useMemo(() => {
    if (!rates || !selectedBrand) return 0;
    let totalCost = 0;
    let totalUnits = 0;
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
          totalCost += costEUR * (rates[currency] || 1);
          totalUnits += item.stokAdedi + (item.cihazUstuAdedi > 0 ? 1 : 0);
        });
    });
    return totalUnits > 0 ? totalCost / totalUnits : 0;
  }, [latestPerLocation, selectedBrand, productMap, rates, currency]);

  const loadLogoDataUrl = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/QORE-INV_LOGO.PNG');
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }, []);

  const sanitizePdfText = useCallback((text: string): string => {
    return text
      .replace(/İ/g, 'I').replace(/ı/g, 'i')
      .replace(/Ş/g, 'S').replace(/ş/g, 's')
      .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
      .replace(/Ü/g, 'U').replace(/ü/g, 'u')
      .replace(/Ö/g, 'O').replace(/ö/g, 'o')
      .replace(/Ç/g, 'C').replace(/ç/g, 'c');
  }, []);

  const createPieChartDataUrl = useCallback((items: { label: string; value: number }[], title: string): string | null => {
    if (typeof document === 'undefined' || items.length === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 460;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(title, 18, 26);

    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    let start = -Math.PI / 2;
    const cx = 140;
    const cy = 160;
    const r = 90;
    items.slice(0, 8).forEach((item, i) => {
      const ratio = item.value / total;
      const end = start + ratio * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = PIE_COLORS[i % PIE_COLORS.length];
      ctx.fill();
      start = end;
    });

    ctx.fillStyle = '#1e293b';
    ctx.font = '12px Arial';
    items.slice(0, 6).forEach((item, i) => {
      const y = 72 + i * 28;
      ctx.fillStyle = PIE_COLORS[i % PIE_COLORS.length];
      ctx.fillRect(260, y - 10, 10, 10);
      ctx.fillStyle = '#1e293b';
      const pct = ((item.value / total) * 100).toFixed(1);
      ctx.fillText(`${sanitizePdfText(item.label)} %${pct}`, 276, y);
    });

    return canvas.toDataURL('image/png');
  }, [sanitizePdfText]);

  const handleExportExcel = useCallback(async () => {
    try {
      const FileSaverModule = await import('file-saver');
      const saveAs = FileSaverModule.saveAs || FileSaverModule.default?.saveAs || (FileSaverModule as any).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'QORE';
      wb.created = new Date();

      // ==== ÖZET SAYFASI ====
      const wsOzet = wb.addWorksheet('Özet Maliyet');
      wsOzet.columns = [
        { header: 'Konum', key: 'name', width: 32 },
        { header: 'Tip', key: 'type', width: 14 },
        { header: 'Ürün Sayısı', key: 'count', width: 14 },
        { header: 'Maliyet', key: 'cost', width: 18 }
      ];

      wsOzet.insertRow(1, ['QORE Maliyet Gözlem Raporu']);
      wsOzet.insertRow(2, [`Tarih: ${new Date().toLocaleString('tr-TR')}`]);
      wsOzet.insertRow(3, [`Para Birimi: ${currency}`]);
      wsOzet.insertRow(4, [`Konsolide Toplam: ${fmtCurrency(consolidatedCost, sym)}`]);
      wsOzet.insertRow(5, []);
      // Shift header to row 6
      wsOzet.getRow(6).values = ['Konum', 'Tip', 'Ürün Sayısı', 'Maliyet'];
      wsOzet.getRow(6).font = { bold: true };
      
      let rowIndex = 7;
      locationBreakdown.forEach(l => {
        wsOzet.insertRow(rowIndex, [l.name, l.type === 'lab' ? 'Lab' : 'Depo', l.productCount, Number(l.cost.toFixed(2))]);
        rowIndex++;
      });

      // Style Ozet cells (Alignment and Borders)
      wsOzet.eachRow((row, rowNumber) => {
        row.eachCell((cell) => {
          if (rowNumber > 5) {
             cell.border = {
               top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'}
             };
          }
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
      });

      // ==== MARKA DETAY SAYFALARI ====
      brandCosts.forEach(b => {
         const safeSheetName = b.name.replace(/[\[\]\*\\\/\?]/g, '').substring(0, 31);
         const wsBrand = wb.addWorksheet(safeSheetName);
         
         wsBrand.columns = [
           { key: 'col1', width: 35 },
           { key: 'col2', width: 15 },
           { key: 'col3', width: 20 },
         ];

         wsBrand.addRow([`${b.name} Marka Maliyet Raporu`]);
         wsBrand.addRow([`Toplam Marka Maliyeti: ${fmtCurrency(b.cost, sym)}`]);
         wsBrand.addRow([]);
         
         wsBrand.addRow(['Konum Bazlı Maliyet']);
         wsBrand.lastRow.font = { bold: true, size: 12 };
         
         const locHeaderRow = wsBrand.addRow(['Konum', 'Ürün Sayısı', 'Maliyet']);
         locHeaderRow.font = { bold: true };
         
         let locStart = locHeaderRow.number;
         
         const locMap = new Map<string, {count: number, cost: number}>();
         const grpMap = new Map<string, number>();

         latestPerLocation.forEach(session => {
            let locCost = 0;
            let locCount = 0;
            session.items.filter(item => (item.marka || 'Diğer') === b.name).forEach(item => {
               const product = productMap.get(item.stokKodu);
               if (!product?.cost || !product?.ambalajDegeri) return;
               const totalTest = (item.stokAdedi * product.ambalajDegeri) + item.cihazUstuAdedi;
               const costPerTest = product.cost / product.ambalajDegeri;
               const totalNative = costPerTest * totalTest;
               const productCurrency = (product.currency || 'TRY') as Currency;
               let costEUR: number;
               switch (productCurrency) {
                 case 'EUR': costEUR = totalNative; break;
                 case 'USD': costEUR = totalNative / (rates!.USD || 1); break;
                 case 'TRY': costEUR = totalNative / (rates!.TRY || 1); break;
                 default: costEUR = totalNative / (rates!.TRY || 1);
               }
               const itemCost = costEUR * (rates![currency] || 1);
               
               locCost += itemCost;
               locCount++;
               
               const group = product.urunGrubu === 'kit' ? 'Kit'
                  : product.urunGrubu === 'sarf' ? 'Sarf Malzeme'
                  : product.urunGrubu === 'yedek_parca' ? 'Yedek Parça'
                  : 'Diğer';
                  
               grpMap.set(group, (grpMap.get(group) || 0) + itemCost);
            });
            if (locCost > 0) {
               locMap.set(session.locationName, { count: locCount, cost: locCost });
            }
         });
         
         Array.from(locMap.entries()).sort((x,y) => y[1].cost - x[1].cost).forEach(([locName, data]) => {
            wsBrand.addRow([locName, data.count, Number(data.cost.toFixed(2))]);
         });
         let locEnd = wsBrand.lastRow.number;

         wsBrand.addRow([]);
         wsBrand.addRow([]);

         wsBrand.addRow(['Ürün Grubu Maliyeti']);
         wsBrand.lastRow.font = { bold: true, size: 12 };
         
         const grpHeaderRow = wsBrand.addRow(['Ürün Grubu', '', 'Maliyet']);
         grpHeaderRow.font = { bold: true };
         let grpStart = grpHeaderRow.number;
         
         Array.from(grpMap.entries()).sort((x,y) => y[1] - x[1]).forEach(([grpName, cost]) => {
            wsBrand.addRow([grpName, '', Number(cost.toFixed(2))]);
         });
         let grpEnd = wsBrand.lastRow.number;
         
         wsBrand.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
               if ((rowNumber >= locStart && rowNumber <= locEnd) || (rowNumber >= grpStart && rowNumber <= grpEnd)) {
                  cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
               }
               cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
         });
      });

      const buffer = await wb.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), `Maliyet_Gozlem_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast({ title: 'Başarılı', description: 'Excel raporu detaylı bir şekilde indirildi.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Hata', description: 'Excel raporu oluşturulamadı.', variant: 'destructive' });
    }
  }, [currency, consolidatedCost, sym, locationBreakdown, brandCosts, latestPerLocation, productMap, rates, toast]);

  const handleExportPdf = useCallback(async () => {
    try {
      const [jsPDFModule, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const jsPDF = jsPDFModule.default;
      const autoTable = autoTableModule.default;
      const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const logo = await loadLogoDataUrl();
      const brandPie = createPieChartDataUrl(brandCosts.map((b) => ({ label: b.name, value: b.cost })), 'Marka Dagilimi');
      const groupPie = createPieChartDataUrl(groupBreakdown.map((g) => ({ label: g.name, value: g.cost })), 'Urun Grubu Kirilimi');

      const drawFooter = () => {
        const badgeW = 220;
        const badgeH = 32;
        const bx = pageW / 2 - badgeW / 2;
        const by = pageH - 40;
        doc.setFillColor(254, 243, 199);
        doc.roundedRect(bx, by, badgeW, badgeH, 10, 10, 'F');
        if (logo) {
          // "Üstten/alttan bastırılmış" görünüm için alçak yükseklik
          doc.addImage(logo, 'PNG', pageW / 2 - 58, by + 8, 116, 14, undefined, 'FAST');
        }
      };

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text(sanitizePdfText('QORE Maliyet Gozlem Raporu'), pageW / 2, 38, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(sanitizePdfText(`Tarih: ${new Date().toLocaleString('tr-TR')}   Para Birimi: ${currency}`), 40, 56);

      const cardY = 72;
      const cardW = (pageW - 60) / 4;
      const cards = [
        { t: 'Toplam Envanter Maliyeti', v: fmtCurrency(consolidatedCost, sym) },
        { t: 'Konum Bazli Maliyet', v: `${locationBreakdown.length} konum` },
        { t: 'Marka Dagilimi', v: `${brandCosts.length} marka` },
        { t: 'Urun Grubu Kirilim', v: `${groupBreakdown.length} grup` },
      ];
      cards.forEach((c, i) => {
        const x = 20 + i * cardW;
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x, cardY, cardW - 8, 58, 10, 10, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(sanitizePdfText(c.t), x + 10, cardY + 22);
        doc.setTextColor(199, 137, 65);
        doc.setFontSize(13);
        doc.text(sanitizePdfText(c.v), x + 10, cardY + 44);
        doc.setTextColor(0, 0, 0);
      });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(sanitizePdfText('Aylik Maliyet Trendi'), 28, 150);
      const chartX = 28, chartY = 160, chartW = pageW - 56, chartH = 110;
      doc.setDrawColor(226, 232, 240);
      doc.rect(chartX, chartY, chartW, chartH);
      const maxCost = Math.max(...monthlyTrend.map((m) => m.cost), 1);
      monthlyTrend.forEach((m, i) => {
        const bw = Math.max(10, (chartW - 30) / Math.max(monthlyTrend.length, 1) - 6);
        const x = chartX + 15 + i * (bw + 6);
        const h = (m.cost / maxCost) * (chartH - 28);
        doc.setFillColor(59, 130, 246);
        doc.rect(x, chartY + chartH - 14 - h, bw, h, 'F');
        doc.setFontSize(7);
        doc.text(sanitizePdfText(m.month), x, chartY + chartH - 3);
      });

      if (brandPie) doc.addImage(brandPie, 'PNG', 28, 286, (pageW - 72) / 2, 190, undefined, 'FAST');
      if (groupPie) doc.addImage(groupPie, 'PNG', pageW / 2 + 6, 286, (pageW - 72) / 2, 190, undefined, 'FAST');
      drawFooter();

      doc.addPage('a4', 'landscape');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(sanitizePdfText('Detay Tablolari'), 28, 34);

      autoTable(doc, {
        startY: 48,
        head: [[sanitizePdfText('Konum'), sanitizePdfText('Tip'), sanitizePdfText('Urun'), sanitizePdfText('Maliyet')]],
        body: locationBreakdown.map((l) => [sanitizePdfText(l.name), l.type === 'lab' ? 'Lab' : 'Depo', String(l.productCount), fmtCurrencyDetailed(l.cost, sym)]),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85] },
      });
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 10,
        head: [[sanitizePdfText('Marka'), sanitizePdfText('Urun'), sanitizePdfText('Maliyet')]],
        body: brandCosts.map((b) => [sanitizePdfText(b.name), String(b.productCount), fmtCurrencyDetailed(b.cost, sym)]),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [255, 237, 213], textColor: [154, 52, 18] },
      });
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 10,
        head: [[sanitizePdfText('Urun Grubu'), sanitizePdfText('Maliyet')]],
        body: groupBreakdown.map((g) => [sanitizePdfText(g.name), fmtCurrencyDetailed(g.cost, sym)]),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [220, 252, 231], textColor: [22, 101, 52] },
      });
      drawFooter();

      doc.save(`Maliyet_Gozlem_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast({ title: 'Başarılı', description: 'PDF raporu indirildi.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Hata', description: 'PDF raporu oluşturulamadı.', variant: 'destructive' });
    }
  }, [brandCosts, consolidatedCost, createPieChartDataUrl, currency, groupBreakdown, loadLogoDataUrl, locationBreakdown, monthlyTrend, sanitizePdfText, sym, toast]);

  // ---- RENDER ----

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
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setSelectedBrand(null)}
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-[var(--dashboard-text)]">{selectedBrand}</h1>
              <p className="text-xs text-[var(--dashboard-muted)]">{brandProducts.length} ürün · {brandLocationBreakdown.length} konum</p>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <div className="cihaz-card-strong p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <Wallet className="w-3.5 h-3.5 text-[var(--dashboard-accent)]" />
                <span className="text-[10px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Toplam Maliyet</span>
              </div>
              <p className="text-xl font-bold text-[var(--dashboard-accent)]">{fmtCurrency(brandTotal, sym)}</p>
              {consolidatedCost > 0 && (
                <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5">
                  Toplam maliyetin %{((brandTotal / consolidatedCost) * 100).toFixed(1)}&apos;i
                </p>
              )}
            </div>
            <div className="cihaz-card-strong p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <BarChart3 className="w-3.5 h-3.5 text-[var(--dashboard-accent)]" />
                <span className="text-[10px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Ort. Birim Maliyet</span>
              </div>
              <p className="text-xl font-bold text-[var(--dashboard-accent)]">{fmtCurrencyDetailed(brandAvgUnitCost, sym)}</p>
              <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5">birim başına ortalama</p>
            </div>
            <div className="cihaz-card-strong p-4 col-span-2 sm:col-span-1">
              <div className="flex items-center gap-1.5 mb-1">
                <Layers className="w-3.5 h-3.5 text-[var(--dashboard-accent)]" />
                <span className="text-[10px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Ürün Sayısı</span>
              </div>
              <p className="text-xl font-bold text-[var(--dashboard-accent)]">{brandProducts.length}</p>
              <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5">{brandLocationBreakdown.length} konumda</p>
            </div>
          </div>

          {/* Location & Group breakdown side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {/* Per-location cost */}
            <div className="cihaz-card-strong p-5">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-[var(--dashboard-accent)]" />
                <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Konum Bazlı Maliyet</span>
              </div>
              <div className="space-y-2">
                {brandLocationBreakdown.map(loc => (
                  <Collapsible key={loc.name} className="bg-[var(--dashboard-surface-2)]/50 rounded-xl overflow-hidden group/col">
                    <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[var(--dashboard-surface-2)] transition-colors">
                      <div className="flex-1 min-w-0 text-left">
                        <span className="text-sm font-semibold text-[var(--dashboard-text)] truncate block">{loc.name}</span>
                        <p className="text-[10px] text-[var(--dashboard-muted)]">
                          {loc.type === 'lab' ? 'Lab' : 'Depo'} · {loc.productCount} ürün
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <div className="text-right">
                          <span className="text-sm font-bold text-[var(--dashboard-accent)]">{fmtCurrency(loc.cost, sym)}</span>
                          {brandTotal > 0 && (
                            <p className="text-[10px] text-[var(--dashboard-muted)]">%{((loc.cost / brandTotal) * 100).toFixed(1)}</p>
                          )}
                        </div>
                        <ChevronDown className="w-4 h-4 text-[var(--dashboard-muted)] transition-transform duration-200 group-data-[state=open]/col:rotate-180" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-3 pb-3 space-y-1.5 pt-1 border-t border-[var(--dashboard-stroke)] mt-1">
                        {loc.items && loc.items.map((pi: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between gap-2 bg-[var(--dashboard-surface)]/50 px-2 py-1.5 rounded-lg">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-[var(--dashboard-text)] truncate">{pi.stokAdi}</p>
                              <p className="text-[9px] text-[var(--dashboard-muted)]">{pi.stokKodu} · Stok: {pi.stokAdedi} {pi.cihazUstuAdedi > 0 ? ` (+${pi.cihazUstuAdedi} C.Ü)` : ''}</p>
                            </div>
                            <span className="text-xs font-semibold text-[var(--dashboard-accent)] shrink-0">{fmtCurrencyDetailed(pi.calculatedCost, sym)}</span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
                {brandLocationBreakdown.length === 0 && (
                  <p className="text-center py-4 text-sm text-[var(--dashboard-muted)]">Veri yok</p>
                )}
              </div>
            </div>

            {/* Per-group cost */}
            <div className="cihaz-card-strong p-5">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-[var(--dashboard-accent)]" />
                <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Ürün Grubu Kırılımı</span>
              </div>
              <div className="space-y-3">
                {brandGroupBreakdown.length > 0 ? brandGroupBreakdown.map(g => {
                  const pct = brandTotal > 0 ? (g.cost / brandTotal) * 100 : 0;
                  return (
                    <Collapsible key={g.name} className="group/col">
                      <CollapsibleTrigger className="w-full text-left">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm font-medium text-[var(--dashboard-text)] truncate">{g.name}</span>
                            <ChevronDown className="w-3 h-3 text-[var(--dashboard-muted)] transition-transform duration-200 group-data-[state=open]/col:rotate-180" />
                          </div>
                          <span className="text-sm font-semibold text-[var(--dashboard-accent)]">{fmtCurrency(g.cost, sym)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--dashboard-accent)] transition-all duration-500"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5">Marka maliyetinin %{pct.toFixed(1)}'i</p>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-[var(--dashboard-stroke)] py-1">
                          {g.items && g.items.map((pi: any, idx: number) => (
                            <div key={idx} className="flex flex-col gap-0.5 bg-[var(--dashboard-surface-2)]/30 px-2 py-1.5 rounded-md">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-[var(--dashboard-text)] truncate">{pi.stokAdi}</span>
                                <span className="text-xs font-semibold text-[var(--dashboard-accent)] shrink-0">{fmtCurrencyDetailed(pi.calculatedCost, sym)}</span>
                              </div>
                              <span className="text-[10px] text-[var(--dashboard-muted)]">
                                {pi.locationName} · {pi.stokAdedi} adet
                              </span>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                }) : (
                  <p className="text-center py-4 text-sm text-[var(--dashboard-muted)]">Ürün grubu bilgisi yok</p>
                )}
              </div>
            </div>
          </div>

          {/* Monthly trend chart */}
          <div className="cihaz-card-strong p-5 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-[var(--dashboard-accent)]" />
              <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Yıllık Maliyet Trendi</span>
            </div>
            <div className="h-[200px]">
              {brandMonthlyTrend.some(m => m.cost > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={brandMonthlyTrend}>
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
                  Bu marka için trend verisi yok.
                </div>
              )}
            </div>
          </div>

          {/* Product list */}
          <div className="cihaz-card-strong p-5">
            <div className="flex items-center gap-2 mb-3">
              <PieChartIcon className="w-4 h-4 text-[var(--dashboard-accent)]" />
              <span className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">Ürün Listesi</span>
            </div>
            <div className="space-y-2">
              {brandProducts.map((p, i) => (
                <div key={`${p.stokKodu}-${p.locationName}-${i}`} className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)]/50">
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
                <div className="p-8 text-center text-sm text-[var(--dashboard-muted)]">Bu markada veri yok.</div>
              )}
            </div>
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
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500 text-white inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Excel
            </button>
            <button
              onClick={handleExportPdf}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 text-white inline-flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              PDF
            </button>
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
                      <Collapsible key={loc.id} className="bg-[var(--dashboard-surface-2)]/50 rounded-xl overflow-hidden group/col">
                        <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[var(--dashboard-surface-2)] transition-colors">
                          <div className="flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-semibold text-[var(--dashboard-text)] truncate">{loc.name}</span>
                            </div>
                            <p className="text-[10px] text-[var(--dashboard-muted)]">
                              {loc.type === 'lab' ? 'Lab' : 'Depo'} · {loc.productCount} ürün
                              {loc.date && ` · ${format(loc.date, 'dd MMM yyyy', { locale: tr })}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 ml-3">
                            <span className="text-sm font-bold text-[var(--dashboard-accent)]">{fmtCurrency(loc.cost, sym)}</span>
                            <ChevronDown className="w-4 h-4 text-[var(--dashboard-muted)] transition-transform duration-200 group-data-[state=open]/col:rotate-180" />
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-3 pb-3 space-y-1.5 pt-1 border-t border-[var(--dashboard-stroke)] mt-1">
                            {loc.items && loc.items.map((pi: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between gap-2 bg-[var(--dashboard-surface)]/50 px-2 py-1.5 rounded-lg">
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-[var(--dashboard-text)] truncate">{pi.stokAdi}</p>
                                  <p className="text-[9px] text-[var(--dashboard-muted)]">{pi.marka || 'Diğer'} · {pi.stokKodu} · Stok: {pi.stokAdedi} {pi.cihazUstuAdedi > 0 ? ` (+${pi.cihazUstuAdedi} C.Ü)` : ''}</p>
                                </div>
                                <span className="text-xs font-semibold text-[var(--dashboard-accent)] shrink-0">{fmtCurrencyDetailed(pi.calculatedCost, sym)}</span>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
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
                      <Collapsible key={g.name} className="group/col">
                        <CollapsibleTrigger className="w-full text-left">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm font-medium text-[var(--dashboard-text)] truncate">{g.name}</span>
                              <ChevronDown className="w-3 h-3 text-[var(--dashboard-muted)] transition-transform duration-200 group-data-[state=open]/col:rotate-180" />
                            </div>
                            <span className="text-sm font-semibold text-[var(--dashboard-accent)]">{fmtCurrency(g.cost, sym)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--dashboard-accent)] transition-all duration-500"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-[var(--dashboard-muted)] mt-0.5">Toplam maliyetin %{pct.toFixed(1)}'i</p>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ScrollArea className="h-[200px] mt-2">
                            <div className="space-y-1.5 pl-2 border-l-2 border-[var(--dashboard-stroke)] py-1 pr-2">
                              {g.items && g.items.map((pi: any, idx: number) => (
                                <div key={idx} className="flex flex-col gap-0.5 bg-[var(--dashboard-surface-2)]/30 px-2 py-1.5 rounded-md">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-[var(--dashboard-text)] truncate">{pi.stokAdi}</span>
                                    <span className="text-xs font-semibold text-[var(--dashboard-accent)] shrink-0">{fmtCurrencyDetailed(pi.calculatedCost, sym)}</span>
                                  </div>
                                  <span className="text-[10px] text-[var(--dashboard-muted)]">
                                    {pi.marka || 'Diğer'} · {pi.locationName} · {pi.stokAdedi} adet
                                  </span>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </CollapsibleContent>
                      </Collapsible>
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
                      const createdByName = (session as { createdByName?: string }).createdByName;
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
                            {createdByName && ` · ${createdByName}`}
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
