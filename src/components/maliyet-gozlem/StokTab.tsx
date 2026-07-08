'use client';

/**
 * Maliyet Gözlem — Stok Maliyeti Tab.
 *
 * `maliyetSayimSessions` koleksiyonundaki tamamlanmış sayım oturumlarından
 * brand/lokasyon/grup kırılımlarını üretir; KPI, Activities Panel ve detaylı
 * kartlar sunar. Mevcut `cost-analytics.ts` motoru re-use edilir.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { filterByCompanyScope } from '@/lib/company-scope';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery, getScopedDocs } from '@/lib/firestore-helpers';
import { getExchangeRates } from '@/lib/exchange-rates';
import type { ProductCode, Currency } from '@/lib/types';
import {
  calculateTotalCostForRange,
  getBrandCostBreakdown,
  getLocationCostBreakdown,
  getProductGroupBreakdown,
  getMonthlyTrend,
  getSessionDate,
  type SayimSession,
} from '@/lib/cost-analytics';
import { ActivitiesPanel, InsightsCard, MiniStat, SectionHeader, Card, HBarList } from './primitives';
import { DonutChart } from './charts';
import { useIsMobile } from './useIsMobile';
import { Loader2 } from 'lucide-react';
import { exportDataToExcel, exportDataToPdf } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { TabExportHandlers } from './MaliyetGozlemMerkezi';

interface StokTabProps {
  currency: Currency;
  /** Header'daki Excel/PDF butonlarının çağıracağı işleyicileri kaydeder. */
  registerExportHandlers?: (handlers: TabExportHandlers) => void;
}

const BRAND_COLORS = ['#fb923c', '#a78bfa', '#3b82f6', '#42e46d', '#6ea8ff', '#fc7272', '#f59e0b', '#06b6d4'];

export function StokTab({ currency, registerExportHandlers }: StokTabProps) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sessions, setSessions] = useState<SayimSession[]>([]);
  const [productMap, setProductMap] = useState<Map<string, ProductCode>>(new Map());
  const [rates, setRates] = useState<Record<Currency, number>>({ EUR: 1, USD: 1.08, TRY: 38.5 });
  /** Seçili sayım dönemi ('all' = tüm dönemler, aksi halde 'YYYY-MM') */
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [sessionsSnap, productDocs, ratesValue] = await Promise.all([
          getDocs(scopedQuery('maliyetSayimSessions', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc'))),
          // Legacy-aware: companyId'si eksik ya da __legacy__ etiketli ürün
          // kayıtları da gelsin — scopedQuery'nin where('companyId') filtresi
          // eski ürünleri dışarıda bırakınca tüm maliyetler 0 hesaplanıyordu.
          getScopedDocs('productCodes', currentCompanyId, isSuperAdmin),
          getExchangeRates().catch(() => ({ EUR: 1, USD: 1.08, TRY: 38.5 })),
        ]);
        if (cancelled) return;

        const products = productDocs.map((d) => ({ id: d.id, ...d.data() } as ProductCode));
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
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentCompanyId, isSuperAdmin, reloadKey]);

  // Oturumlarda bulunan sayım dönemleri (yeniden eskiye)
  const periodOptions = useMemo(() => {
    const keys = new Map<string, string>(); // key -> label
    sessions.forEach((s) => {
      const d = getSessionDate(s);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!keys.has(key)) {
        keys.set(key, d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }));
      }
    });
    return Array.from(keys.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, label]) => ({ key, label }));
  }, [sessions]);

  // Dönem seçiliyse yalnızca o ayın oturumları analiz edilir
  const periodSessions = useMemo(() => {
    if (selectedPeriod === 'all') return sessions;
    return sessions.filter((s) => {
      const d = getSessionDate(s);
      if (!d) return false;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === selectedPeriod;
    });
  }, [sessions, selectedPeriod]);

  const total = useMemo(
    () => calculateTotalCostForRange(periodSessions, productMap, rates, currency, 'all'),
    [periodSessions, productMap, rates, currency],
  );

  const brands = useMemo(
    () => getBrandCostBreakdown(periodSessions, productMap, rates, currency),
    [periodSessions, productMap, rates, currency],
  );
  const locations = useMemo(
    () => getLocationCostBreakdown(periodSessions, productMap, rates, currency),
    [periodSessions, productMap, rates, currency],
  );
  const groups = useMemo(
    () => getProductGroupBreakdown(periodSessions, productMap, rates, currency),
    [periodSessions, productMap, rates, currency],
  );
  const trend = useMemo(
    () => getMonthlyTrend(sessions, productMap, rates, currency),
    [sessions, productMap, rates, currency],
  );

  const groupLabel = (g: string) =>
    g === 'kit' ? 'Kit' : g === 'sarf' ? 'Sarf' : g === 'yedek_parca' ? 'Yedek Parça' : 'Diğer';

  // Header'daki Excel/PDF butonları için dışa aktarma işleyicilerini kaydet
  useEffect(() => {
    if (!registerExportHandlers) return;
    const periodName = selectedPeriod === 'all'
      ? 'Tüm Dönemler'
      : periodOptions.find((p) => p.key === selectedPeriod)?.label || selectedPeriod;

    registerExportHandlers({
      excel: () => {
        exportDataToExcel(
          {
            'Özet': [
              { Alan: 'Dönem', Değer: periodName },
              { Alan: `Toplam Envanter (${currency})`, Değer: Math.round(total) },
              { Alan: 'Lokasyon Sayısı', Değer: locations.length },
              { Alan: 'Marka Sayısı', Değer: brands.length },
              { Alan: 'Sayım Oturumu', Değer: periodSessions.length },
            ],
            'Markalar': brands.map((b) => ({
              Marka: b.name,
              [`Maliyet (${currency})`]: Math.round(b.value),
              'Ürün Sayısı': b.productCount,
            })),
            'Lokasyonlar': locations.map((l) => ({
              Lokasyon: l.locationName,
              Tip: l.locationType === 'lab' ? 'Lab' : 'Depo',
              [`Maliyet (${currency})`]: Math.round(l.totalCost),
              'Ürün Sayısı': l.productCount,
              'Son Sayım': l.lastSessionDate ? l.lastSessionDate.toLocaleDateString('tr-TR') : '',
            })),
            'Ürün Grupları': groups.map((g) => ({
              Grup: groupLabel(g.group),
              [`Maliyet (${currency})`]: Math.round(g.value),
            })),
            'Aylık Trend': trend.map((t) => ({
              Ay: t.monthLabel,
              [`Maliyet (${currency})`]: Math.round(t.cost),
            })),
          },
          `Maliyet_Gozlem_Stok_${periodName}`,
          toast,
        );
      },
      pdf: () => {
        exportDataToPdf(
          locations.map((l) => ({
            'Lokasyon': l.locationName,
            'Tip': l.locationType === 'lab' ? 'Lab' : 'Depo',
            [`Maliyet (${currency})`]: Math.round(l.totalCost).toLocaleString('tr-TR'),
            'Ürün Sayısı': l.productCount,
            'Son Sayım': l.lastSessionDate ? l.lastSessionDate.toLocaleDateString('tr-TR') : '',
          })),
          `Maliyet_Gozlem_Stok_${periodName}`,
          `Maliyet Gözlem — Stok Maliyeti (${periodName})`,
          toast,
        );
      },
    });
  }, [registerExportHandlers, selectedPeriod, periodOptions, currency, total, brands, locations, groups, trend, periodSessions.length, toast]);
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

  if (loadError) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--mg-muted)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--mg-text)', marginBottom: 8 }}>
            Sayım verileri yüklenemedi
          </div>
          <div style={{ fontSize: 12, marginBottom: 16, wordBreak: 'break-word' }}>{loadError}</div>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            style={{
              padding: '8px 20px',
              borderRadius: 10,
              background: 'var(--mg-accent)',
              color: '#0a0a0c',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Tekrar dene
          </button>
        </div>
      </Card>
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
      {/* Dönem seçici */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Sayım Dönemi
        </span>
        <select
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
          style={{
            padding: '7px 12px',
            borderRadius: 10,
            background: 'var(--mg-card)',
            color: 'var(--mg-text)',
            border: '1px solid var(--mg-border)',
            fontFamily: 'inherit',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="all">Tüm Dönemler</option>
          {periodOptions.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        {selectedPeriod !== 'all' && periodSessions.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--mg-muted)' }}>
            Bu dönemde sayım oturumu bulunamadı.
          </span>
        )}
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: isMobile ? 8 : 16 }}>
        <MiniStat label={`Toplam Envanter (${currency})`} value={total} sub={selectedPeriod === 'all' ? 'Son sayımlar' : periodOptions.find((p) => p.key === selectedPeriod)?.label || 'Dönem'} color="#fb923c" />
        <MiniStat label="Lokasyon Sayısı" value={locations.length} sub="aktif" color="#6ea8ff" isCount unit="lab/depo" />
        <MiniStat label="Marka Sayısı" value={brands.length} sub="aktif" color="#a78bfa" isCount unit="marka" />
        <MiniStat label="Sayım Oturumu" value={periodSessions.length} sub={selectedPeriod === 'all' ? 'tamamlandı' : 'bu dönemde'} color="#42e46d" isCount unit="oturum" />
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
              onSelect={(name) => router.push(`/cost-dashboard/gozlem/marka/${encodeURIComponent(name)}`)}
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
