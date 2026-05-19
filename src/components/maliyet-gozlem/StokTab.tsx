'use client';

/**
 * Maliyet Gözlem — Stok Maliyeti Tab.
 *
 * `maliyetSayimSessions` koleksiyonundaki tamamlanmış sayım oturumlarından
 * brand/lokasyon/grup kırılımlarını üretir; KPI, Activities Panel ve detaylı
 * kartlar sunar. Mevcut `cost-analytics.ts` motoru re-use edilir.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { filterByCompanyScope } from '@/lib/company-scope';
import { useAuth } from '@/contexts/auth-context';
import { getExchangeRates } from '@/lib/exchange-rates';
import type { ProductCode, Currency } from '@/lib/types';
import {
  calculateTotalCostForRange,
  getBrandCostBreakdown,
  getLocationCostBreakdown,
  getProductGroupBreakdown,
  getMonthlyTrend,
  type SayimSession,
} from '@/lib/cost-analytics';
import { ActivitiesPanel, InsightsCard, MiniStat, SectionHeader, Card, HBarList } from './primitives';
import { DonutChart } from './charts';
import { useIsMobile } from './useIsMobile';
import { Loader2 } from 'lucide-react';

interface StokTabProps {
  currency: Currency;
}

const BRAND_COLORS = ['#fb923c', '#a78bfa', '#3b82f6', '#42e46d', '#6ea8ff', '#fc7272', '#f59e0b', '#06b6d4'];

export function StokTab({ currency }: StokTabProps) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SayimSession[]>([]);
  const [productMap, setProductMap] = useState<Map<string, ProductCode>>(new Map());
  const [rates, setRates] = useState<Record<Currency, number>>({ EUR: 1, USD: 1.08, TRY: 38.5 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [sessionsSnap, productsSnap, ratesValue] = await Promise.all([
          getDocs(query(collection(db, 'maliyetSayimSessions'), orderBy('createdAt', 'desc'))),
          getDocs(query(collection(db, 'productCodes'), orderBy('stokAdi', 'asc'))),
          getExchangeRates().catch(() => ({ EUR: 1, USD: 1.08, TRY: 38.5 })),
        ]);
        if (cancelled) return;

        const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductCode));
        const pMap = new Map<string, ProductCode>();
        products.forEach((p) => pMap.set(p.stokKodu, p));
        setProductMap(pMap);

        setSessions(
          filterByCompanyScope(
            sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SayimSession)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );

        setRates(ratesValue as Record<Currency, number>);
      } catch (e) {
        console.error('StokTab load error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentCompanyId, isSuperAdmin]);

  const total = useMemo(
    () => calculateTotalCostForRange(sessions, productMap, rates, currency, 'all'),
    [sessions, productMap, rates, currency],
  );

  const brands = useMemo(
    () => getBrandCostBreakdown(sessions, productMap, rates, currency),
    [sessions, productMap, rates, currency],
  );
  const locations = useMemo(
    () => getLocationCostBreakdown(sessions, productMap, rates, currency),
    [sessions, productMap, rates, currency],
  );
  const groups = useMemo(
    () => getProductGroupBreakdown(sessions, productMap, rates, currency),
    [sessions, productMap, rates, currency],
  );
  const trend = useMemo(
    () => getMonthlyTrend(sessions, productMap, rates, currency),
    [sessions, productMap, rates, currency],
  );

  const groupLabel = (g: string) =>
    g === 'kit' ? 'Kit' : g === 'sarf' ? 'Sarf' : g === 'yedek_parca' ? 'Yedek Parça' : 'Diğer';
  const symbol = currency === 'TRY' ? '₺' : currency === 'EUR' ? '€' : '$';

  const assistantContext = useMemo(() => ({
    panel: 'stok' as const,
    currency,
    generatedAt: new Date().toISOString(),
    totals: {
      totalInventoryCost: Math.round(total),
      sessionCount: sessions.length,
      locationCount: locations.length,
      brandCount: brands.length,
      productGroupCount: groups.filter((g) => g.value > 0).length,
    },
    rankings: {
      topLocations: locations.slice(0, 10).map((l) => ({
        locationId: l.locationId,
        locationName: l.locationName,
        locationType: l.locationType,
        totalCost: Math.round(l.totalCost),
        productCount: l.productCount,
        lastSessionDate: l.lastSessionDate?.toISOString() || null,
        topBrands: l.brands.slice(0, 5),
      })),
      topBrands: brands.slice(0, 10).map((b) => ({ ...b, value: Math.round(b.value), sharePct: total > 0 ? Number(((b.value / total) * 100).toFixed(1)) : 0 })),
      productGroups: groups.map((g) => ({ group: groupLabel(g.group), value: Math.round(g.value), sharePct: total > 0 ? Number(((g.value / total) * 100).toFixed(1)) : 0 })),
    },
    history: {
      monthlyTrend: trend.map((t) => ({ monthKey: t.monthKey, monthLabel: t.monthLabel, cost: Math.round(t.cost) })),
      latestSessions: sessions.slice(0, 12).map((session) => ({
        id: session.id,
        locationName: session.locationName,
        locationType: session.locationType,
        itemCount: session.items.length,
        totalQuantity: session.items.reduce((sum, item) => sum + item.stokAdedi + item.cihazUstuAdedi, 0),
        topItems: session.items.slice(0, 8),
      })),
    },
    rawSamples: {
      rates,
      productCount: productMap.size,
      allLocations: locations.map((l) => ({
        locationId: l.locationId,
        locationName: l.locationName,
        locationType: l.locationType,
        totalCost: Math.round(l.totalCost),
        productCount: l.productCount,
      })),
      allBrands: brands.map((b) => ({ ...b, value: Math.round(b.value) })),
      allGroups: groups.map((g) => ({ group: groupLabel(g.group), value: Math.round(g.value) })),
      allMonthlyTrend: trend.map((t) => ({ monthKey: t.monthKey, monthLabel: t.monthLabel, cost: Math.round(t.cost) })),
      allSessions: sessions.map((session) => ({
        id: session.id,
        locationName: session.locationName,
        locationType: session.locationType,
        itemCount: session.items.length,
      })),
    },
  }), [currency, total, sessions, locations, brands, groups, trend, rates, productMap.size]);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--mg-muted)' }}>
        <Loader2 size={32} className="animate-spin" style={{ display: 'inline-block', marginBottom: 12 }} />
        <div style={{ fontSize: 14 }}>Sayım verileri yükleniyor...</div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--mg-muted)' }}>
          Henüz tamamlanmış maliyet sayım oturumu yok.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 20 }}>
      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: isMobile ? 8 : 16 }}>
        <MiniStat label={`Toplam Envanter (${currency})`} value={total} sub="Son sayımlar" color="#fb923c" />
        <MiniStat label="Lokasyon Sayısı" value={locations.length} sub="aktif" color="#6ea8ff" isCount unit="lab/depo" />
        <MiniStat label="Marka Sayısı" value={brands.length} sub="aktif" color="#a78bfa" isCount unit="marka" />
        <MiniStat label="Sayım Oturumu" value={sessions.length} sub="tamamlandı" color="#42e46d" isCount unit="oturum" />
      </div>

      {/* Activities + Insights */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 3fr) minmax(0, 1fr)', gap: isMobile ? 12 : 16 }}>
        <ActivitiesPanel
          count={trend.length + locations.length + brands.length}
          title="Maliyet Aktiviteleri"
          sections={[
            {
              title: 'Aylık Trend',
              cards: trend.slice(-6).map((m, i, arr) => {
                const prev = i > 0 ? arr[i - 1].cost : m.cost;
                const delta = prev > 0 ? Math.round(((m.cost - prev) / prev) * 100) : 0;
                const isCurrent = i === arr.length - 1;
                const spark = arr.slice(Math.max(0, i - 3), i + 1).map((x) => x.cost);
                return {
                  value: m.cost,
                  label: m.monthLabel,
                  sublabel: isCurrent ? 'Bu Ay' : 'Geçen',
                  color: isCurrent ? 'var(--mg-accent)' : '#6ea8ff',
                  delta: m.cost === 0 ? null : delta > 0 ? `+${delta}%` : `${delta}%`,
                  format: (v) =>
                    v >= 1000 ? (
                      <>
                        <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>
                          {symbol}
                        </span>
                        {Math.round(v / 1000).toLocaleString('tr-TR')}
                        <span style={{ fontSize: 20, color: 'var(--mg-muted)', marginLeft: 1, fontWeight: 300 }}>k</span>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>
                          {symbol}
                        </span>
                        {Math.round(v).toLocaleString('tr-TR')}
                      </>
                    ),
                  sparkData: spark.length > 1 ? spark : null,
                  active: isCurrent,
                };
              }),
            },
            {
              title: 'Lokasyon Maliyeti',
              cards: locations.slice(0, 8).map((loc, i) => ({
                value: loc.totalCost,
                label: loc.locationName,
                sublabel: `${loc.productCount} ürün`,
                color: BRAND_COLORS[i % BRAND_COLORS.length],
                delta: null,
                format: (v) => (
                  <>
                    <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>
                      {symbol}
                    </span>
                    {Math.round(v / 1000).toLocaleString('tr-TR')}
                    <span style={{ fontSize: 20, color: 'var(--mg-muted)', marginLeft: 1, fontWeight: 300 }}>k</span>
                  </>
                ),
                sparkData: null,
              })),
            },
            {
              title: 'Marka Maliyeti',
              cards: brands.slice(0, 8).map((b, i) => ({
                value: b.value,
                label: b.name,
                sublabel: `${b.productCount} ürün`,
                color: BRAND_COLORS[i % BRAND_COLORS.length],
                delta: `%${total > 0 ? ((b.value / total) * 100).toFixed(0) : 0}`,
                format: (v) => (
                  <>
                    <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>
                      {symbol}
                    </span>
                    {Math.round(v / 1000).toLocaleString('tr-TR')}
                    <span style={{ fontSize: 20, color: 'var(--mg-muted)', marginLeft: 1, fontWeight: 300 }}>k</span>
                  </>
                ),
                sparkData: null,
              })),
            },
          ]}
        />

        <InsightsCard
          assistantContext={assistantContext}
          insights={[
            {
              palette: ['#ffb088', '#b8c6ff', '#d8a8ff', '#88b3ff', '#1a0c1e'],
              title: 'Toplam envanter',
              headline: 'Bağlı sermaye',
              subhead: `${sessions.length} sayım üzerinden`,
              delta: Math.round(total),
              deltaPositive: true,
            },
            {
              palette: ['#a3e8c1', '#7bd5f2', '#9ab6ff', '#7a8af0', '#0a1422'],
              title: 'Lokasyon',
              headline: locations[0]?.locationName || '—',
              subhead: 'En yüksek maliyet',
              delta: Math.round(locations[0]?.totalCost || 0),
              deltaPositive: true,
            },
            {
              palette: ['#ffd28a', '#ff9b76', '#ff7a8a', '#c25a8e', '#1a0a18'],
              title: 'Marka',
              headline: brands[0]?.name || '—',
              subhead: `${brands[0]?.productCount || 0} ürün`,
              delta: Math.round(brands[0]?.value || 0),
              deltaPositive: true,
            },
          ]}
        />
      </div>

      {/* Brand + Group */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.4fr', gap: isMobile ? 12 : 20 }}>
        <Card>
          <SectionHeader
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15.5A9 9 0 1 1 8.5 3M21 12A9 9 0 0 0 12 3v9z" />
              </svg>
            }
            title="Marka Dağılımı"
            count={brands.length}
          />
          {brands.length > 0 ? (
            <DonutChart
              segments={brands.slice(0, 8).map((b, i) => ({
                name: b.name,
                value: b.value,
                color: BRAND_COLORS[i % BRAND_COLORS.length],
              }))}
            />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--mg-muted)' }}>Veri yok</div>
          )}
        </Card>

        <Card>
          <SectionHeader
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            }
            title="Ürün Grubu Kırılımı"
            count={groups.filter((g) => g.value > 0).length}
          />
          <HBarList
            items={groups.map((g, i) => ({
              name: groupLabel(g.group),
              value: g.value,
              color: BRAND_COLORS[i % BRAND_COLORS.length],
              sub: total > 0 && g.value > 0 ? `%${((g.value / total) * 100).toFixed(1)} pay` : 'Veri yok',
            }))}
          />
        </Card>
      </div>
    </div>
  );
}
