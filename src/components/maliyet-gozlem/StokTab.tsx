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
  getLatestByLocation,
  getMonthlyTrend,
  getProductCostInCurrency,
  getSessionDate,
  type SayimSession,
} from '@/lib/cost-analytics';
import { ActivitiesPanel, InsightsCard, MiniStat, SectionHeader, Card, HBarList, KpiBreakdownModal, type KpiBreakdownRow } from './primitives';
import { DonutChart, formatCompactTL } from './charts';
import { useIsMobile } from './useIsMobile';
import { Loader2 } from 'lucide-react';
import { exportDataToPdf } from '@/lib/utils';
import { buildStokMaliyetModel, downloadStokMaliyetExcel, type StokExportLocationInfo } from '@/lib/maliyetGozlemExcel';
import { useToast } from '@/hooks/use-toast';
import type { TabExportHandlers } from './MaliyetGozlemMerkezi';

interface StokTabProps {
  currency: Currency;
  search: string;
  setSearch: (value: string) => void;
  /** Header'daki Excel/PDF butonlarının çağıracağı işleyicileri kaydeder. */
  registerExportHandlers?: (handlers: TabExportHandlers) => void;
}

const BRAND_COLORS = ['#fb923c', '#a78bfa', '#3b82f6', '#42e46d', '#6ea8ff', '#fc7272', '#f59e0b', '#06b6d4'];


type StockProductDetail = {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  group: 'kit' | 'sarf' | 'yedek_parca' | 'diger';
  locationId: string;
  locationName: string;
  locationType: 'lab' | 'depot';
  quantity: number;
  stockQty: number;
  cihazQty: number;
  cost: number;
  monthKey: string | null;
};

export function StokTab({ currency, search, setSearch, registerExportHandlers }: StokTabProps) {
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
  /** Lokasyon kimliği → ad/lab kodu/tip — Excel çıktısında lab kodları için. */
  const [locationInfo, setLocationInfo] = useState<Map<string, StokExportLocationInfo>>(new Map());
  /** Seçili sayım dönemi ('all' = tüm dönemler, aksi halde 'YYYY-MM') */
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');
  /** Kullanıcı kaynak/dönem seçmeden veri YÜKLENMEZ (performans + netlik). */
  const [sourceChosen, setSourceChosen] = useState(false);
  const [pendingMonth, setPendingMonth] = useState(new Date().getMonth());
  const [pendingYear, setPendingYear] = useState(new Date().getFullYear());
  /** KPI kartına tıklanınca gösterilen alt kırılım */
  const [kpiModal, setKpiModal] = useState<{ title: string; subtitle?: string; rows: KpiBreakdownRow[] } | null>(null);
  const [selectedStockCode, setSelectedStockCode] = useState<string | null>(null);

  useEffect(() => {
    // Kaynak/dönem seçilmeden hiçbir veri çekilmez.
    if (!sourceChosen) return;
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
  }, [currentCompanyId, isSuperAdmin, reloadKey, sourceChosen]);

  // Lab kodları + depo adları — Excel çıktısında kullanılır.
  useEffect(() => {
    if (!sourceChosen) return;
    let cancelled = false;
    (async () => {
      try {
        const [hospSnap, depoSnap] = await Promise.all([
          getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)).catch(() => null),
        ]);
        if (cancelled) return;
        const map = new Map<string, StokExportLocationInfo>();
        filterByCompanyScope(
          hospSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)),
          currentCompanyId,
          isSuperAdmin,
        ).forEach((h: any) => map.set(h.id, { name: h.name || h.ad || h.id, kod: h.kod || '', type: 'lab' }));
        if (depoSnap) {
          filterByCompanyScope(
            depoSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)),
            currentCompanyId,
            isSuperAdmin,
          ).forEach((d: any) => map.set(d.id, { name: d.name || d.id, kod: d.kod || '', type: 'depot' }));
        }
        setLocationInfo(map);
      } catch (e) {
        console.error('Lokasyon bilgisi yüklenemedi', e);
      }
    })();
    return () => { cancelled = true; };
  }, [currentCompanyId, isSuperAdmin, sourceChosen]);

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

  const analysisSessions = useMemo(() => {
    if (!selectedStockCode) return periodSessions;
    return periodSessions
      .map((session) => ({ ...session, items: session.items.filter((item) => item.stokKodu === selectedStockCode) }))
      .filter((session) => session.items.length > 0);
  }, [periodSessions, selectedStockCode]);

  const trendSourceSessions = useMemo(() => {
    if (!selectedStockCode) return sessions;
    return sessions
      .map((session) => ({ ...session, items: session.items.filter((item) => item.stokKodu === selectedStockCode) }))
      .filter((session) => session.items.length > 0);
  }, [sessions, selectedStockCode]);

  const total = useMemo(
    () => calculateTotalCostForRange(analysisSessions, productMap, rates, currency, 'all'),
    [analysisSessions, productMap, rates, currency],
  );

  const brands = useMemo(
    () => getBrandCostBreakdown(analysisSessions, productMap, rates, currency),
    [analysisSessions, productMap, rates, currency],
  );
  const locations = useMemo(
    () => getLocationCostBreakdown(analysisSessions, productMap, rates, currency),
    [analysisSessions, productMap, rates, currency],
  );
  const groups = useMemo(
    () => getProductGroupBreakdown(analysisSessions, productMap, rates, currency),
    [analysisSessions, productMap, rates, currency],
  );
  const trend = useMemo(
    () => getMonthlyTrend(trendSourceSessions, productMap, rates, currency),
    [trendSourceSessions, productMap, rates, currency],
  );

  const groupLabel = (g: string) =>
    g === 'kit' ? 'Kit' : g === 'sarf' ? 'Sarf' : g === 'yedek_parca' ? 'Yedek Parça' : 'Diğer';
  const symbol = currency === 'TRY' ? '₺' : currency === 'EUR' ? '€' : '$';

  /** Tam Türkçe tutar formatı (kırılım modalı ve alt metinler için) */
  const fmtFull = (v: number) => `${symbol}${Math.round(v).toLocaleString('tr-TR')}`;

  const normalizeSearch = (value: string) => value.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const buildProductDetails = (sourceSessions: SayimSession[]): StockProductDetail[] => {
    const latestSessions = Array.from(getLatestByLocation(sourceSessions).values());
    return latestSessions.flatMap((session) => session.items.map((item) => {
      const product = productMap.get(item.stokKodu);
      const sessionDate = getSessionDate(session);
      const rawGroup = (product?.urunGrubu || 'diger') as StockProductDetail['group'];
      const normalizedGroup = ['kit', 'sarf', 'yedek_parca'].includes(rawGroup) ? rawGroup : 'diger';
      return {
        stokKodu: item.stokKodu,
        stokAdi: item.stokAdi,
        marka: item.marka || 'Diğer',
        group: normalizedGroup,
        locationId: session.locationId,
        locationName: session.locationName,
        locationType: session.locationType,
        stockQty: Number(item.stokAdedi) || 0,
        cihazQty: Number(item.cihazUstuAdedi) || 0,
        quantity: (Number(item.stokAdedi) || 0) + (Number(item.cihazUstuAdedi) || 0),
        cost: getProductCostInCurrency(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi, productMap, rates, currency, item),
        monthKey: sessionDate ? `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}` : null,
      };
    }));
  };

  const productDetails = useMemo<StockProductDetail[]>(() => buildProductDetails(analysisSessions), [analysisSessions, productMap, rates, currency]);
  const searchProductDetails = useMemo<StockProductDetail[]>(() => buildProductDetails(periodSessions), [periodSessions, productMap, rates, currency]);

  const aggregateDetails = (details: StockProductDetail[], keyFn: (d: StockProductDetail) => string, labelFn: (d: StockProductDetail) => string, subFn?: (rows: StockProductDetail[]) => string) => {
    const map = new Map<string, { label: string; rows: StockProductDetail[]; cost: number; products: Set<string>; quantity: number }>();
    details.forEach((detail) => {
      const key = keyFn(detail);
      const row = map.get(key) || { label: labelFn(detail), rows: [], cost: 0, products: new Set<string>(), quantity: 0 };
      row.rows.push(detail);
      row.cost += detail.cost;
      row.products.add(detail.stokKodu);
      row.quantity += detail.quantity;
      map.set(key, row);
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost).map((row) => ({
      ...row,
      sub: subFn ? subFn(row.rows) : `${row.products.size} ürün · ${row.quantity.toLocaleString('tr-TR')} adet`,
    }));
  };

  const productRows = (details: StockProductDetail[]): KpiBreakdownRow[] => aggregateDetails(
    details,
    (d) => d.stokKodu,
    (d) => d.stokAdi,
    (rows) => {
      const first = rows[0];
      const locationCount = new Set(rows.map((r) => r.locationId)).size;
      const qty = rows.reduce((sum, r) => sum + r.quantity, 0);
      return `${first.stokKodu} · ${locationCount} lokasyon · ${qty.toLocaleString('tr-TR')} adet`;
    },
  ).map((row) => ({ label: row.label, sub: row.sub, value: fmtFull(row.cost) }));

  const openProducts = (title: string, details: StockProductDetail[], subtitle?: string) => setKpiModal({
    title,
    subtitle: subtitle || `${details.length} ürün satırı`,
    rows: productRows(details),
  });

  // Marka detay paneline git — kurum kurum ürün detayı + Excel/PDF çıktısı orada.
  // Seçili dönem varsa ?period ile taşınır (sayfa yalnızca o ayı analiz eder).
  const goToBrand = (brand: string) => {
    const qs = selectedPeriod !== 'all' ? `?period=${encodeURIComponent(selectedPeriod)}` : '';
    router.push(`/cost-dashboard/gozlem/marka/${encodeURIComponent(brand)}${qs}`);
  };

  const openLocationBrands = (locationId: string, locationName: string) => {
    const details = productDetails.filter((d) => d.locationId === locationId);
    setKpiModal({
      title: `${locationName} — Marka Kırılımı`,
      subtitle: fmtFull(details.reduce((acc, d) => acc + d.cost, 0)),
      rows: aggregateDetails(details, (d) => d.marka, (d) => d.marka).map((row) => ({
        label: row.label,
        sub: row.sub,
        value: fmtFull(row.cost),
        onClick: () => openProducts(`${locationName} / ${row.label} — Ürün Kırılımı`, row.rows, fmtFull(row.cost)),
      })),
    });
  };

  const openGroupBrands = (group: StockProductDetail['group']) => {
    const details = productDetails.filter((d) => d.group === group);
    const label = groupLabel(group);
    setKpiModal({
      title: `${label} — Marka Kırılımı`,
      subtitle: fmtFull(details.reduce((acc, d) => acc + d.cost, 0)),
      rows: aggregateDetails(details, (d) => d.marka, (d) => d.marka).map((row) => ({
        label: row.label,
        sub: row.sub,
        value: fmtFull(row.cost),
        onClick: () => openProducts(`${label} / ${row.label} — Ürün Kırılımı`, row.rows, fmtFull(row.cost)),
      })),
    });
  };

  const searchResults = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return [];
    return aggregateDetails(
      searchProductDetails.filter((detail) => normalizeSearch(`${detail.stokKodu} ${detail.stokAdi}`).includes(q)),
      (d) => d.stokKodu,
      (d) => d.stokAdi,
      (rows) => {
        const first = rows[0];
        const locationCount = new Set(rows.map((r) => r.locationId)).size;
        const qty = rows.reduce((sum, r) => sum + r.quantity, 0);
        return `${first.stokKodu} · ${locationCount} lokasyon · ${qty.toLocaleString('tr-TR')} adet`;
      },
    ).slice(0, 12);
  }, [search, searchProductDetails]);

  useEffect(() => {
    if (!search.trim()) setSelectedStockCode(null);
  }, [search]);

  const selectedProduct = selectedStockCode ? productMap.get(selectedStockCode) : null;


  // Header'daki Excel/PDF butonları için dışa aktarma işleyicilerini kaydet
  useEffect(() => {
    if (!registerExportHandlers) return;
    const periodName = selectedPeriod === 'all'
      ? 'Tüm Dönemler'
      : periodOptions.find((p) => p.key === selectedPeriod)?.label || selectedPeriod;

    registerExportHandlers({
      excel: async () => {
        try {
          // Genel Tablo + marka-kurum dağılımları; tüm tutarlar TL, lab kodlu.
          const model = buildStokMaliyetModel({
            sessions: periodSessions,
            productMap,
            rates,
            locationInfo,
            periodLabel: periodName,
          });
          if (model.brands.length === 0) {
            toast({ title: 'Veri yok', description: 'Bu dönemde dışa aktarılacak maliyet verisi bulunamadı.' });
            return;
          }
          await downloadStokMaliyetExcel(model, `Maliyet_Gozlem_Stok_${periodName}`);
          toast({ title: 'Excel indirildi', description: 'Genel tablo + marka-kurum dağılımları (TL) oluşturuldu.' });
        } catch (e) {
          console.error('Stok Excel export error', e);
          toast({ title: 'Hata', description: 'Excel oluşturulamadı.', variant: 'destructive' });
        }
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
  }, [registerExportHandlers, selectedPeriod, periodOptions, currency, locations, periodSessions, productMap, rates, locationInfo, toast]);
  // Aktivite kartlarında ortak tutar formatı — milyonlar "5,2M", binler "298k"
  const cardMoneyFormat = (v: number) => (
    <>
      <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>
        {symbol}
      </span>
      {formatCompactTL(v)}
    </>
  );

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

  // ---- Kaynak/dönem seçilmeden veri yüklenmez ----
  if (!sourceChosen) {
    const btnBase: React.CSSProperties = {
      padding: '10px 18px',
      borderRadius: 12,
      border: '1px solid var(--mg-border)',
      fontFamily: 'inherit',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer',
    };
    const selBase: React.CSSProperties = {
      padding: '9px 12px',
      borderRadius: 10,
      background: 'var(--mg-surface-2)',
      color: 'var(--mg-text)',
      border: '1px solid var(--mg-border)',
      fontFamily: 'inherit',
      fontSize: 13,
      fontWeight: 600,
      outline: 'none',
      cursor: 'pointer',
    };
    return (
      <Card>
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--mg-text)', marginBottom: 6 }}>
            Sayım Dönemi Seçin
          </div>
          <div style={{ fontSize: 13, color: 'var(--mg-muted)', marginBottom: 24 }}>
            Veriler seçim yapılana kadar yüklenmez. Belirli bir dönemin sayımını ya da tüm dönemleri görüntüleyebilirsiniz.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
            <select value={pendingMonth} onChange={(e) => setPendingMonth(Number(e.target.value))} style={selBase}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i}>{new Date(0, i, 1).toLocaleString('tr-TR', { month: 'long' })}</option>
              ))}
            </select>
            <select value={pendingYear} onChange={(e) => setPendingYear(Number(e.target.value))} style={selBase}>
              {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              onClick={() => {
                setSelectedPeriod(`${pendingYear}-${String(pendingMonth + 1).padStart(2, '0')}`);
                setSourceChosen(true);
              }}
              style={{ ...btnBase, background: 'var(--mg-accent)', color: '#0a0a0c', boxShadow: '0 2px 12px rgba(251,146,60,0.35)' }}
            >
              Dönemi Yükle
            </button>
            <span style={{ fontSize: 12, color: 'var(--mg-muted)' }}>veya</span>
            <button
              onClick={() => {
                setSelectedPeriod('all');
                setSourceChosen(true);
              }}
              style={{ ...btnBase, background: 'var(--mg-surface-2)', color: 'var(--mg-text-2)' }}
            >
              Tüm Dönemler
            </button>
          </div>
        </div>
      </Card>
    );
  }

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


      {search.trim() && (
        <Card padding={14}>
          {selectedStockCode ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mg-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedProduct?.stokAdi || selectedStockCode}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mg-muted)', marginTop: 2 }}>
                  {selectedStockCode} · sadece bu ürünün stok maliyeti gösteriliyor
                </div>
              </div>
              <button
                onClick={() => { setSelectedStockCode(null); setSearch(''); }}
                style={{ border: '1px solid var(--mg-border)', background: 'var(--mg-surface-2)', color: 'var(--mg-text-2)', borderRadius: 10, padding: '7px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                Filtreyi Temizle
              </button>
            </div>
          ) : searchResults.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Stok kodu / stok adı eşleşmeleri
              </div>
              {searchResults.map((result) => (
                <button
                  key={result.rows[0]?.stokKodu || result.label}
                  onClick={() => setSelectedStockCode(result.rows[0]?.stokKodu || null)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid var(--mg-border)', background: 'var(--mg-surface-2)', color: 'var(--mg-text)', borderRadius: 12, padding: '10px 12px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--mg-muted)', marginTop: 2 }}>{result.sub}</span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mg-accent)', whiteSpace: 'nowrap' }}>{fmtFull(result.cost)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--mg-muted)' }}>Maliyet hesabına dahil olan ürünlerde eşleşme bulunamadı.</div>
          )}
        </Card>
      )}

      {/* KPI Row — kartlara tıklayınca hesabın alt kırılımı açılır */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: isMobile ? 8 : 16 }}>
        <MiniStat
          label={`Toplam Envanter (${currency})`}
          value={total}
          sub={selectedPeriod === 'all' ? 'Son sayımlar' : periodOptions.find((p) => p.key === selectedPeriod)?.label || 'Dönem'}
          color="#fb923c"
          onClick={() => setKpiModal({
            title: 'Toplam Envanter — Lokasyon Kırılımı',
            subtitle: `${fmtFull(total)} · ${locations.length} lokasyon`,
            rows: locations.map((l) => ({
              label: l.locationName,
              sub: `${l.locationType === 'lab' ? 'Lab' : 'Depo'} · ${l.productCount} ürün`,
              value: fmtFull(l.totalCost),
              onClick: () => openLocationBrands(l.locationId, l.locationName),
            })),
          })}
        />
        <MiniStat
          label="Lokasyon Sayısı"
          value={locations.length}
          sub="aktif"
          color="#6ea8ff"
          isCount
          unit="lab/depo"
          onClick={() => setKpiModal({
            title: 'Aktif Lokasyonlar',
            rows: locations.map((l) => ({
              label: l.locationName,
              sub: `${l.productCount} ürün · Son sayım: ${l.lastSessionDate ? l.lastSessionDate.toLocaleDateString('tr-TR') : '—'}`,
              value: fmtFull(l.totalCost),
              onClick: () => openLocationBrands(l.locationId, l.locationName),
            })),
          })}
        />
        <MiniStat
          label="Marka Sayısı"
          value={brands.length}
          sub="aktif"
          color="#a78bfa"
          isCount
          unit="marka"
          onClick={() => setKpiModal({
            title: 'Marka Kırılımı',
            subtitle: `Toplam ${fmtFull(total)}`,
            rows: brands.map((b) => ({
              label: b.name,
              sub: `${b.productCount} ürün · %${total > 0 ? ((b.value / total) * 100).toFixed(1) : 0} pay · detay ›`,
              value: fmtFull(b.value),
              onClick: () => goToBrand(b.name),
            })),
          })}
        />
        <MiniStat
          label="Sayım Oturumu"
          value={analysisSessions.length}
          sub={selectedPeriod === 'all' ? 'tamamlandı' : 'bu dönemde'}
          color="#42e46d"
          isCount
          unit="oturum"
          onClick={() => setKpiModal({
            title: 'Sayım Oturumları',
            rows: analysisSessions.map((s) => ({
              label: s.locationName,
              sub: `${s.items.length} ürün · ${getSessionDate(s)?.toLocaleDateString('tr-TR') ?? ''}`,
              onClick: () => router.push(`/cost-dashboard/gecmis/${s.id}`),
            })),
          })}
        />
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
                  format: cardMoneyFormat,
                  sparkData: spark.length > 1 ? spark : null,
                  active: isCurrent,
                  onClick: () => {
                    const details = productDetails.filter((d) => d.monthKey === m.monthKey);
                    setSelectedPeriod(m.monthKey);
                    openProducts(`${m.monthLabel} — Ürün Kırılımı`, details.length ? details : productDetails, fmtFull(m.cost));
                  },
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
                format: cardMoneyFormat,
                sparkData: null,
                onClick: () => openLocationBrands(loc.locationId, loc.locationName),
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
                format: cardMoneyFormat,
                sparkData: null,
                onClick: () => goToBrand(b.name),
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
              onSelect={(name) => goToBrand(name)}
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
            onSelect={(name) => {
              const group = groups.find((g) => groupLabel(g.group) === name)?.group;
              if (group) openGroupBrands(group);
            }}
          />
        </Card>
      </div>

      {kpiModal && (
        <KpiBreakdownModal
          title={kpiModal.title}
          subtitle={kpiModal.subtitle}
          rows={kpiModal.rows}
          onClose={() => setKpiModal(null)}
        />
      )}
    </div>
  );
}
