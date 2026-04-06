'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { Loader2, BarChart3 } from 'lucide-react';
import { db } from '@/lib/firebase';
import type { Currency, ProductCode } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import CostKPICard from '@/components/cost-observation/CostKPICard';
import TrendChart from '@/components/cost-observation/TrendChart';
import BrandDistribution from '@/components/cost-observation/BrandDistribution';
import LocationBreakdown from '@/components/cost-observation/LocationBreakdown';
import BrandOverviewGrid from '@/components/cost-observation/BrandOverviewGrid';
import SessionTimeline from '@/components/cost-observation/SessionTimeline';
import {
  calculateTotalCostForRange,
  getBrandCostBreakdown,
  getLocationCostBreakdown,
  getMonthlyTrend,
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

interface CostDashboardPanelProps {
  productCodes: ProductCode[];
}

export default function CostDashboardPanel({ productCodes }: CostDashboardPanelProps) {
  const router = useRouter();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [rates, setRates] = useState<Record<Currency, number> | null>(null);
  const [currency, setCurrency] = useState<Currency>('TRY');
  const [sessions, setSessions] = useState<SayimSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>('latest');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [rateData, snap] = await Promise.all([
          fetchExchangeRates(),
          getDocs(query(collection(db, 'maliyetSayimSessions'), orderBy('createdAt', 'desc'))),
        ]);
        setRates(rateData);
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SayimSession));
        setSessions(filterByCompanyScope(all, currentCompanyId, isSuperAdmin));
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

  const totalCost = useMemo(() => {
    if (!rates) return 0;
    return calculateTotalCostForRange(sessions, productMap, rates, currency, range);
  }, [sessions, productMap, rates, currency, range]);

  const brandData = useMemo(() => {
    if (!rates) return [];
    return getBrandCostBreakdown(sessions, productMap, rates, currency);
  }, [sessions, productMap, rates, currency]);

  const locationData = useMemo(() => {
    if (!rates) return [];
    return getLocationCostBreakdown(sessions, productMap, rates, currency);
  }, [sessions, productMap, rates, currency]);

  const trendData = useMemo(() => {
    if (!rates) return [];
    return getMonthlyTrend(sessions, productMap, rates, currency);
  }, [sessions, productMap, rates, currency]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" /></div>;
  }

  const sym = CURRENCY_SYMBOLS[currency];

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
              <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">Patron / Müdür / Bölüm sorumlusu için çok katmanlı analiz</p>
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

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-2">
            <CostKPICard
              title="Toplam Envanter Maliyeti"
              total={totalCost}
              range={range}
              onRangeChange={setRange}
              currency={currency}
              subtitle="Lokasyon başına son snapshot kuralı ile hesaplanır"
            />
          </div>
          <div className="lg:col-span-3">
            <TrendChart data={trendData} currency={currency} />
          </div>

          <div className="lg:col-span-2">
            <BrandDistribution
              brands={brandData}
              symbol={sym}
              onBrandClick={(brand) => router.push(`/cost-dashboard/gozlem/marka/${encodeURIComponent(brand)}`)}
            />
          </div>
          <div className="lg:col-span-3">
            <LocationBreakdown data={locationData} symbol={sym} />
          </div>

          <div className="lg:col-span-5">
            <BrandOverviewGrid brands={brandData} symbol={sym} onBrandClick={(brand) => router.push(`/cost-dashboard/gozlem/marka/${encodeURIComponent(brand)}`)} />
          </div>
          <div className="lg:col-span-5">
            <SessionTimeline sessions={sessions} />
          </div>
        </div>
      </div>
    </div>
  );
}
