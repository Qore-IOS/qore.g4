
'use client';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import type { ProductCode, Currency } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PieChart, ResponsiveContainer, Pie, Cell, Tooltip as RechartsTooltip, LineChart, Line, XAxis, YAxis } from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, ChevronLeft, ChevronRight, TrendingUp, PieChart as PieChartIcon,
  Wallet, BarChart3, Calendar, ArrowLeft, Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, eachMonthOfInterval, endOfMonth, isValid } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

// ============================================================================
// TYPES
// ============================================================================

interface SayimSessionItem {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  stokAdedi: number;
  cihazUstuAdedi: number;
}

interface SayimSession {
  id: string;
  locationType: 'lab' | 'depot';
  locationId: string;
  locationName: string;
  createdAt: any;
  createdByUid?: string;
  createdByName?: string;
  items: SayimSessionItem[];
  totalBrands: number;
  totalProducts: number;
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  EUR: '€',
  USD: '$',
  TRY: '₺',
};

const PRIMARY_API_KEY = 'e69314b14644080788775553';
const CACHE_TTL = 1000 * 60 * 60;

const PIE_COLORS = [
  '#F2994A', '#6FCF97', '#56CCF2', '#BB6BD9', '#F2C94C',
  '#EB5757', '#2F80ED', '#27AE60', '#E2B93B', '#9B51E0',
  '#219653', '#F2994A', '#828282', '#4F4F4F', '#2D9CDB',
];

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
    try {
      const res = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=USD,TRY`);
      if (!res.ok) throw new Error('Backup failed');
      const data = await res.json();
      const rates = { EUR: 1, USD: data.rates.USD, TRY: data.rates.TRY };
      localStorage.setItem(cacheKey, JSON.stringify({ data: rates, timestamp: Date.now() }));
      return rates;
    } catch {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached).data;
      return { EUR: 1, USD: 1.08, TRY: 38.5 };
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function formatCurrency(value: number, symbol: string): string {
  return `${symbol}${value.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatCurrencyDetailed(value: number, symbol: string): string {
  return `${symbol}${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSessionDate(session: SayimSession): Date | null {
  if (!session.createdAt) return null;
  if (session.createdAt.toDate) return session.createdAt.toDate();
  if (session.createdAt.seconds) return new Date(session.createdAt.seconds * 1000);
  const d = new Date(session.createdAt);
  return isValid(d) ? d : null;
}

// ============================================================================
// PROPS
// ============================================================================

interface CostDashboardPanelProps {
  productCodes: ProductCode[];
  depoStok: any[];
  tuketimKayitlari: any[];
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function CostDashboardPanel({ productCodes }: CostDashboardPanelProps) {
  const [rates, setRates] = useState<Record<Currency, number> | null>(null);
  const [currency, setCurrency] = useState<Currency>('TRY');
  const [isLoading, setIsLoading] = useState(true);
  const [sessions, setSessions] = useState<SayimSession[]>([]);
  const [detailView, setDetailView] = useState<'closed' | 'brands' | 'products'>('closed');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch exchange rates and sayım sessions
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [ratesData, sessionsSnap] = await Promise.all([
          fetchExchangeRates(),
          getDocs(query(collection(db, 'maliyetSayimSessions'), orderBy('createdAt', 'desc'))),
        ]);
        setRates(ratesData);
        setSessions(sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as SayimSession)));
      } catch (err) {
        console.error('Error loading cost dashboard:', err);
        // Still try to get rates even if sessions fail
        try {
          const ratesData = await fetchExchangeRates();
          setRates(ratesData);
        } catch {}
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const productMap = useMemo(() => {
    const map = new Map<string, ProductCode>();
    productCodes.forEach(p => map.set(p.stokKodu, p));
    return map;
  }, [productCodes]);

  // Get cost in selected currency for a product
  const getProductCost = useCallback((stokKodu: string, quantity: number, cihazUstu: number): { amount: number; currency: Currency } => {
    if (!rates) return { amount: 0, currency: 'TRY' };
    const product = productMap.get(stokKodu);
    if (!product?.cost || !product?.ambalajDegeri) return { amount: 0, currency: (product?.currency || 'TRY') as Currency };

    const totalTest = (quantity * product.ambalajDegeri) + cihazUstu;
    const costPerTest = product.cost / product.ambalajDegeri;
    const totalCostNative = costPerTest * totalTest;
    const productCurrency = (product.currency || 'TRY') as Currency;

    // Convert to EUR first, then to selected currency
    let costEUR: number;
    switch (productCurrency) {
      case 'EUR': costEUR = totalCostNative; break;
      case 'USD': costEUR = totalCostNative / (rates.USD || 1); break;
      case 'TRY': costEUR = totalCostNative / (rates.TRY || 1); break;
      default: costEUR = totalCostNative / (rates.TRY || 1);
    }

    return { amount: costEUR * (rates[currency] || 1), currency: productCurrency };
  }, [rates, productMap, currency]);

  // Latest session (most recent completed sayım)
  const latestSession = sessions[0] || null;

  // ---- COMPUTED DATA FROM SESSIONS ----

  // Total cost from latest session
  const totalCost = useMemo(() => {
    if (!latestSession || !rates) return 0;
    return latestSession.items.reduce((sum, item) => {
      return sum + getProductCost(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi).amount;
    }, 0);
  }, [latestSession, rates, getProductCost]);

  // Brand-based costs from latest session
  const brandCosts = useMemo(() => {
    if (!latestSession || !rates) return [];
    const map = new Map<string, number>();
    latestSession.items.forEach(item => {
      const brand = item.marka || 'Diğer';
      const cost = getProductCost(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi).amount;
      map.set(brand, (map.get(brand) || 0) + cost);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [latestSession, rates, getProductCost]);

  // Product costs per brand from latest session (for drill-down)
  const productCostsByBrand = useMemo(() => {
    if (!latestSession || !rates || !selectedBrand) return [];
    return latestSession.items
      .filter(item => (item.marka || 'Diğer') === selectedBrand)
      .map(item => ({
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        stokAdedi: item.stokAdedi,
        cihazUstuAdedi: item.cihazUstuAdedi,
        cost: getProductCost(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi).amount,
        nativeCurrency: productMap.get(item.stokKodu)?.currency || 'TRY',
      }))
      .filter(p => p.cost > 0)
      .sort((a, b) => b.cost - a.cost);
  }, [latestSession, rates, selectedBrand, getProductCost, productMap]);

  // Monthly cost trend from sessions
  const monthlyTrend = useMemo(() => {
    if (!rates || sessions.length === 0) return [];
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const months = eachMonthOfInterval({ start: oneYearAgo, end: now });

    return months.map(monthStart => {
      const monthEnd = endOfMonth(monthStart);
      // Find sessions in this month
      const monthSessions = sessions.filter(s => {
        const d = getSessionDate(s);
        return d && d >= monthStart && d <= monthEnd;
      });

      // Use latest session in the month for cost calculation
      const latestInMonth = monthSessions[0]; // already sorted desc
      let cost = 0;
      if (latestInMonth) {
        cost = latestInMonth.items.reduce((sum, item) => {
          return sum + getProductCost(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi).amount;
        }, 0);
      }

      return {
        month: format(monthStart, 'MMM yy', { locale: tr }),
        cost,
      };
    });
  }, [sessions, rates, getProductCost]);

  // Quarterly costs from sessions
  const quarterlyData = useMemo(() => {
    if (!rates || sessions.length === 0) return [0, 0, 0, 0];
    const currentYear = new Date().getFullYear();
    const quarters = [0, 0, 0, 0];

    // For each quarter, find sessions and take the latest one per month, then average/sum
    for (let q = 0; q < 4; q++) {
      const qStart = new Date(currentYear, q * 3, 1);
      const qEnd = endOfMonth(new Date(currentYear, q * 3 + 2, 1));

      const qSessions = sessions.filter(s => {
        const d = getSessionDate(s);
        return d && d >= qStart && d <= qEnd;
      });

      // Sum costs of all sessions in this quarter (each session = a snapshot)
      // Use the latest session per location to avoid double counting
      const latestByLocation = new Map<string, SayimSession>();
      qSessions.forEach(s => {
        const key = `${s.locationType}-${s.locationId}`;
        if (!latestByLocation.has(key)) latestByLocation.set(key, s);
      });

      quarters[q] = Array.from(latestByLocation.values()).reduce((sum, session) => {
        return sum + session.items.reduce((s, item) => {
          return s + getProductCost(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi).amount;
        }, 0);
      }, 0);
    }

    return quarters;
  }, [sessions, rates, getProductCost]);

  // Session count and location stats
  const stats = useMemo(() => {
    const brands = new Set<string>();
    const locations = new Set<string>();
    if (latestSession) {
      latestSession.items.forEach(item => {
        if (item.marka) brands.add(item.marka);
      });
      locations.add(latestSession.locationName);
    }
    sessions.forEach(s => locations.add(s.locationName));
    return {
      sessionCount: sessions.length,
      brandCount: brands.size,
      locationCount: locations.size,
      productCount: latestSession?.items.length || 0,
    };
  }, [sessions, latestSession]);

  // ---- RENDER ----

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    );
  }

  const sym = CURRENCY_SYMBOLS[currency];

  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24">

        {/* ===== HEADER ===== */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <BarChart3 className="h-5 w-5 text-[var(--dashboard-accent)]" />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Maliyet Gözlem</h1>
              <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">Sayım verilerine dayalı maliyet analizi</p>
            </div>
          </div>

          {/* Currency switcher */}
          <div className="flex items-center gap-1.5">
            {(['EUR', 'USD', 'TRY'] as Currency[]).map(cur => (
              <button
                key={cur}
                onClick={() => setCurrency(cur)}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200',
                  currency === cur
                    ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
                    : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
                )}
              >
                {CURRENCY_SYMBOLS[cur]} {cur}
              </button>
            ))}
          </div>
        </div>

        {/* ===== STATS ROW ===== */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Toplam Sayım', value: stats.sessionCount, icon: ClipboardIcon },
            { label: 'Marka', value: stats.brandCount, icon: Package },
            { label: 'Lokasyon', value: stats.locationCount, icon: MapPinIcon },
            { label: 'Ürün', value: stats.productCount, icon: Package },
          ].map((s, i) => (
            <div key={i} className="cihaz-pressed px-4 py-3 flex items-center gap-3">
              <span className="text-lg font-bold text-[var(--dashboard-text)]">{s.value}</span>
              <span className="text-[11px] text-[var(--dashboard-muted)]">{s.label}</span>
            </div>
          ))}
        </div>

        {/* ===== MAIN GRID ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* ---- TOP LEFT: Total Cost ---- */}
          <div className="lg:col-span-2 cihaz-card-strong p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Wallet className="w-5 h-5 text-[var(--dashboard-accent)]" />
              <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Toplam Envanter Maliyeti</h2>
            </div>
            <div className="text-3xl sm:text-4xl font-bold text-[var(--dashboard-accent)] mb-3">
              {formatCurrency(totalCost, sym)}
            </div>
            {latestSession && (
              <p className="text-[11px] text-[var(--dashboard-muted)] mb-4">
                Son sayım: {latestSession.locationName}
                {getSessionDate(latestSession) && ` · ${format(getSessionDate(latestSession)!, 'dd MMM yyyy', { locale: tr })}`}
              </p>
            )}
            <Button
              size="sm"
              onClick={() => setDetailView('brands')}
              className="h-9 text-xs rounded-xl bg-[var(--dashboard-accent)] hover:bg-[var(--dashboard-accent)]/90 text-white"
            >
              Detaylar
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>

          {/* ---- TOP RIGHT: Monthly Trend ---- */}
          <div className="lg:col-span-3 cihaz-card-strong p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-[var(--dashboard-accent)]" />
              <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Aylık Maliyet Trendi</h2>
            </div>
            <div className="h-[220px]">
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
                      formatter={(value: number) => [formatCurrencyDetailed(value, sym), 'Maliyet']}
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
                  Henüz sayım verisi bulunmuyor.
                </div>
              )}
            </div>
          </div>

          {/* ---- MIDDLE LEFT: Pie Chart ---- */}
          <div className="lg:col-span-2 cihaz-card-strong p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <PieChartIcon className="w-5 h-5 text-[var(--dashboard-accent)]" />
              <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Marka Bazlı Dağılım</h2>
            </div>
            <div className="h-[200px]">
              {brandCosts.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={brandCosts}
                      dataKey="value"
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
                        boxShadow: 'var(--dashboard-raised-soft)',
                      }}
                      formatter={(value: number) => [formatCurrencyDetailed(value, sym), '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-[var(--dashboard-muted)]">
                  Veri yok
                </div>
              )}
            </div>
            {/* Legend */}
            {brandCosts.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
                {brandCosts.slice(0, 8).map((b, i) => (
                  <div key={b.name} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-[10px] text-[var(--dashboard-muted)] truncate max-w-[80px]">{b.name}</span>
                  </div>
                ))}
                {brandCosts.length > 8 && (
                  <span className="text-[10px] text-[var(--dashboard-muted)]">+{brandCosts.length - 8} diğer</span>
                )}
              </div>
            )}
          </div>

          {/* ---- MIDDLE RIGHT: Session List ---- */}
          <div className="lg:col-span-3 cihaz-card-strong p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-[var(--dashboard-accent)]" />
              <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">Son Sayımlar</h2>
            </div>
            <ScrollArea className="h-[240px]">
              {sessions.length > 0 ? (
                <div className="space-y-2 pr-2">
                  {sessions.slice(0, 10).map(session => {
                    const date = getSessionDate(session);
                    const sessionCost = session.items.reduce((sum, item) => {
                      return sum + getProductCost(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi).amount;
                    }, 0);
                    return (
                      <div
                        key={session.id}
                        className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)]/50 hover:bg-[var(--dashboard-surface-2)] transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--dashboard-text)] truncate">
                            {session.locationName}
                          </p>
                          <p className="text-[11px] text-[var(--dashboard-muted)]">
                            {date ? format(date, 'dd MMM yyyy HH:mm', { locale: tr }) : '—'}
                            {' · '}{session.items.length} ürün
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-[var(--dashboard-accent)] shrink-0 ml-3">
                          {formatCurrency(sessionCost, sym)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-[var(--dashboard-muted)]">
                  Henüz sayım yapılmamış.
                </div>
              )}
            </ScrollArea>
          </div>

          {/* ---- BOTTOM: Quarterly Cards ---- */}
          <div className="lg:col-span-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quarterlyData.map((val, i) => (
              <div key={i} className="cihaz-card p-4 sm:p-5 text-center">
                <p className="text-xs font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider mb-2">
                  Çeyrek {i + 1}
                </p>
                <p className={cn(
                  'text-xl sm:text-2xl font-bold',
                  val > 0 ? 'text-[var(--dashboard-accent)]' : 'text-[var(--dashboard-muted)]'
                )}>
                  {formatCurrency(val, sym)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== DETAIL DIALOG: Brand → Product drill-down ===== */}
      <Dialog open={detailView !== 'closed'} onOpenChange={(open) => {
        if (!open) { setDetailView('closed'); setSelectedBrand(null); }
      }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col cihaz-card-strong !rounded-3xl !p-0 !gap-0 border-0">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-[var(--dashboard-stroke)]">
            <div className="flex items-center gap-3">
              {detailView === 'products' && (
                <button
                  onClick={() => { setDetailView('brands'); setSelectedBrand(null); }}
                  className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <div>
                <DialogTitle className="text-base font-bold text-[var(--dashboard-text)]">
                  {detailView === 'brands' ? 'Marka Bazlı Maliyet' : selectedBrand}
                </DialogTitle>
                <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
                  {detailView === 'brands'
                    ? `${brandCosts.length} marka · Toplam ${formatCurrency(totalCost, sym)}`
                    : `${productCostsByBrand.length} ürün`
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-2">
              {detailView === 'brands' ? (
                brandCosts.map((brand, i) => (
                  <button
                    key={brand.name}
                    onClick={() => { setSelectedBrand(brand.name); setDetailView('products'); }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-[var(--dashboard-surface-2)]/50 hover:bg-[var(--dashboard-surface-2)] transition-all duration-200 text-left group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="text-sm font-medium text-[var(--dashboard-text)] truncate">{brand.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold text-[var(--dashboard-accent)]">
                        {formatCurrency(brand.value, sym)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-[var(--dashboard-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))
              ) : (
                productCostsByBrand.map(product => (
                  <div
                    key={product.stokKodu}
                    className="px-4 py-3 rounded-2xl bg-[var(--dashboard-surface-2)]/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--dashboard-text)] leading-snug">
                          {product.stokAdi}
                        </p>
                        <p className="text-[11px] text-[var(--dashboard-muted)] mt-0.5">
                          {product.stokKodu}
                          {' · '}Stok: {product.stokAdedi}
                          {product.cihazUstuAdedi > 0 && ` · Cihaz Üstü: ${product.cihazUstuAdedi}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-sm font-semibold text-[var(--dashboard-accent)]">
                          {formatCurrencyDetailed(product.cost, sym)}
                        </span>
                        {product.nativeCurrency !== currency && (
                          <p className="text-[10px] text-[var(--dashboard-muted)]">
                            {CURRENCY_SYMBOLS[product.nativeCurrency as Currency]}{product.nativeCurrency}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}

              {((detailView === 'brands' && brandCosts.length === 0) ||
                (detailView === 'products' && productCostsByBrand.length === 0)) && (
                <div className="text-center py-12 text-sm text-[var(--dashboard-muted)]">
                  Veri bulunamadı.
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[var(--dashboard-stroke)]">
            <Button
              variant="outline"
              onClick={() => { setDetailView('closed'); setSelectedBrand(null); }}
              className="w-full h-10 rounded-xl"
            >
              Kapat
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Mini icon components to avoid extra lucide imports
function ClipboardIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>;
}
function MapPinIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>;
}
