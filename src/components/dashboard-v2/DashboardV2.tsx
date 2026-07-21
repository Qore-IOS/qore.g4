
'use client';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import type { Hospital, ConsumptionRecord, ProductCode, DailyConsumptionStats, DeviceFaultReport, PurchasingTask } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TrendingUp, ChevronLeft, ChevronRight, UserPlus2, TimerReset, ActivitySquare, AlertTriangle, CalendarCheck, Banknote, RefreshCw, ArrowUpRight, Bell, Maximize2, Check, X as XIcon, Search, Loader2, Download, Warehouse, FlaskConical } from 'lucide-react';
import {
  HOME_C, fmtInt, fmtTL, useCountUpFlash, ClayLineChart, Ring,
  Card as ClayCard, CardHead, Pill, Tag, ClayIconBtn, Segmented, ClayBar, DeltaBadge,
} from '@/components/dashboard-v2/clay-home';
import { ClayShell } from '@/components/mal-kabul/clay-kit';
import {
  format, startOfWeek, endOfWeek, eachDayOfInterval,
  subDays, addDays, subWeeks, addWeeks, subMonths, addMonths, subYears, addYears,
  startOfDay, endOfDay, startOfMonth, endOfMonth, startOfYear, endOfYear, eachMonthOfInterval,
  parse, isValid, differenceInDays, isSameDay, isSameMonth, isToday
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
import { collection, onSnapshot, query, where, getDocs, doc, setDoc, Timestamp, limit as fsLimit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VIEWS } from '@/lib/constants';
import { getExchangeRates } from '@/lib/exchange-rates';
import { withCompanyScope } from '@/lib/company-scope';
import { computeStockCostSnapshot, type StockCostSnapshot, type CostLocationRow } from '@/lib/cost-snapshot';
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
// Flash key bumps on every value change → number pulses to grab attention.
function CountText({ value, format = fmtInt, style }: { value: number; format?: (n: number) => string; style?: React.CSSProperties }) {
  const { value: v, flash } = useCountUpFlash(value, 1000);
  return <span key={flash} style={{ display: 'inline-block', animation: flash ? `mkValueFlash 600ms ${HOME_C.ease}` : undefined, ...style }}>{format(v)}</span>;
}

function MiniKpi({ s, i }: { s: { value: number; tone: string; bg: string; icon: any; label: string; href: string }; i: number }) {
  const { value: v, flash } = useCountUpFlash(s.value, 1000);
  const Icon = s.icon;
  return (
    <Link href={s.href} style={{ textDecoration: 'none', padding: '14px 10px', borderRadius: HOME_C.radiusSm, background: HOME_C.surfaceHi, boxShadow: HOME_C.clayFlat, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, textAlign: 'center', animation: `mkPopIn ${320 + i * 120}ms ${HOME_C.ease}` }}>
      <span style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', color: s.tone, background: s.bg, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><Icon size={19} /></span>
      <span key={flash} style={{ display: 'inline-block', fontSize: 28, fontWeight: 800, color: HOME_C.ink1, lineHeight: 1, fontVariantNumeric: 'tabular-nums', animation: flash ? `mkValueFlash 600ms ${HOME_C.ease}` : undefined }}>{fmtInt(v)}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: HOME_C.ink2, lineHeight: 1.2 }}>{s.label}</span>
    </Link>
  );
}

// Kompakt, etkileşimli aylık takvim (Bugün kartının sol yarısı).
function MiniCalendar({ month, selected, taskDays, onSelectDay, onPrevMonth, onNextMonth }: {
  month: Date; selected: Date; taskDays: Set<string>;
  onSelectDay: (d: Date) => void; onPrevMonth: () => void; onNextMonth: () => void;
}) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const wd = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
  const btn = (child: React.ReactNode, onClick: () => void) => (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ all: 'unset', cursor: 'pointer', width: 26, height: 26, borderRadius: 9, display: 'grid', placeItems: 'center', color: HOME_C.ink2, background: `linear-gradient(180deg, ${HOME_C.surfaceHi}, ${HOME_C.surface2})`, boxShadow: HOME_C.clayFlat }}>{child}</button>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        {btn(<ChevronLeft size={14} />, onPrevMonth)}
        <span style={{ fontSize: 12.5, fontWeight: 800, color: HOME_C.ink1, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{format(month, 'LLLL yyyy', { locale: tr })}</span>
        {btn(<ChevronRight size={14} />, onNextMonth)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {wd.map((d) => <div key={d} style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 700, color: HOME_C.ink3, padding: '2px 0' }}>{d}</div>)}
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, month);
          const sel = isSameDay(day, selected);
          const today = isToday(day);
          const has = taskDays.has(key);
          return (
            <button key={key} onClick={(e) => { e.stopPropagation(); onSelectDay(day); }}
              style={{ all: 'unset', cursor: 'pointer', position: 'relative', aspectRatio: '1 / 1', minWidth: 0, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: sel || today ? 800 : 600,
                color: sel ? '#fff' : inMonth ? HOME_C.ink1 : HOME_C.ink3,
                background: sel ? `linear-gradient(180deg, ${HOME_C.accent2}, ${HOME_C.accent})` : 'transparent',
                boxShadow: sel ? `0 5px 11px -5px ${HOME_C.accentGlow}` : today ? `inset 0 0 0 1.5px ${HOME_C.accent}` : 'none',
                opacity: inMonth ? 1 : 0.55 }}>
              {format(day, 'd')}
              {has && <span style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: sel ? '#fff' : HOME_C.accent }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShortcutTile({ panel, i, dense }: { panel: any; i: number; dense?: boolean }) {
  const [p, setP] = useState(false);
  const Icon = panel.icon;
  const iconSz = dense ? 40 : 46;
  return (
    <Link href={panel.href} onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{ textDecoration: 'none', boxSizing: 'border-box', position: 'relative', height: '100%', minHeight: dense ? 78 : 96, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: dense ? 7 : 10, padding: dense ? '10px 6px' : '16px 8px', borderRadius: HOME_C.radius, background: `linear-gradient(180deg, ${HOME_C.surfaceHi}, ${HOME_C.surface2})`, boxShadow: p ? HOME_C.clayPress : HOME_C.clay, color: HOME_C.ink1, transition: `transform 220ms ${HOME_C.ease}, box-shadow 220ms ${HOME_C.ease}`, transform: p ? 'translateY(2px) scale(0.96)' : 'none', animation: `mkPopIn ${260 + i * 40}ms ${HOME_C.ease}` }}>
      <span style={{ width: iconSz, height: iconSz, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: HOME_C.clayFlat, color: HOME_C.accent }}><Icon size={dense ? 20 : 22} /></span>
      <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>{panel.label}</span>
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

  // Anlık maliyet — costSnapshots/{companyId} dokümanından okunur (her sabah
  // 06:00'da Cloud Function günceller). Doküman yoksa ilk açılışta istemci
  // fallback ile hesaplanır. "Yeniden hesapla" elle yeniden hesaplar.
  const [totalStockCost, setTotalStockCost] = useState<number | null>(null);
  const [riskyCost, setRiskyCost] = useState<number | null>(null);
  const [isStockCostDetailOpen, setIsStockCostDetailOpen] = useState(false);
  const [costByDepot, setCostByDepot] = useState<CostLocationRow[]>([]);
  const [costByLab, setCostByLab] = useState<CostLocationRow[]>([]);
  const [costMeta, setCostMeta] = useState<{ computedAt: string; forDate: string; source: string } | null>(null);
  const [isRefreshingStockCost, setIsRefreshingStockCost] = useState(false);

  const applySnapshot = useCallback((snap: StockCostSnapshot) => {
    setTotalStockCost(Number(snap.totalTRY) || 0);
    setRiskyCost(Number(snap.riskyTRY) || 0);
    setCostByDepot(Array.isArray(snap.byDepot) ? snap.byDepot : []);
    setCostByLab(Array.isArray(snap.byLab) ? snap.byLab : []);
    setCostMeta({ computedAt: snap.computedAt, forDate: snap.forDate, source: snap.source });
  }, []);

  // Tüm depo + lab stoğunu (isShipped filtresi YOK) çekip anlık maliyeti hesaplar,
  // costSnapshots/{companyId} dokümanına yazar.
  const computeAndSaveSnapshot = useCallback(async (source: StockCostSnapshot['source']) => {
    setIsRefreshingStockCost(true);
    try {
      const rates = await getExchangeRates();
      let productDocs: any[] = [], stockDocs: any[] = [], depotDocs: any[] = [];
      try { const s = await getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)); productDocs = s.docs; } catch (e) { console.warn('[Dashboard] productCodes fetch failed:', e); }
      try { const s = await getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin)); stockDocs = s.docs; } catch (e) { console.warn('[Dashboard] depoStok fetch failed:', e); }
      try { const s = await getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)); depotDocs = s.docs; } catch (e) { console.warn('[Dashboard] depots fetch failed:', e); }

      const depotNames: Record<string, string> = {};
      depotDocs.forEach((d) => { depotNames[d.id] = String(d.data()?.name || d.id); });
      const hospitalNames: Record<string, string> = {};
      hospitals.forEach((h) => { hospitalNames[h.id] = h.name; });

      // Depo bazlı minMaxRules — riskli stok hesabı için
      const minMaxRules: Record<string, { max: number; maxGun: number }> = {};
      await Promise.all(depotDocs.map(async (dep) => {
        try {
          const rs = await getDocs(collection(db, 'depots', dep.id, 'minMaxRules'));
          rs.docs.forEach((r) => {
            const rule = r.data();
            if (rule.stokKodu && rule.max && rule.maxGun) minMaxRules[`${dep.id}__${rule.stokKodu}`] = { max: rule.max, maxGun: rule.maxGun };
          });
        } catch { /* rule fetch hatası riskli hesabı atlar */ }
      }));

      const snapshot = computeStockCostSnapshot({
        products: productDocs.map((d) => d.data()),
        stocks: stockDocs.map((d) => d.data()),
        depotNames, hospitalNames, minMaxRules, rates, source, now: new Date(),
      });
      applySnapshot(snapshot);

      if (currentCompanyId) {
        try {
          await setDoc(doc(db, 'costSnapshots', currentCompanyId), withCompanyScope({ ...snapshot, updatedAt: Timestamp.now() }, currentCompanyId));
        } catch (e) { console.warn('[Dashboard] costSnapshot save failed:', e); }
      }
    } catch (err) {
      console.error('[Dashboard] computeAndSaveSnapshot error:', err);
      setTotalStockCost((prev) => (prev === null ? 0 : prev));
      setRiskyCost((prev) => (prev === null ? 0 : prev));
    } finally {
      setIsRefreshingStockCost(false);
    }
  }, [currentCompanyId, isSuperAdmin, hospitals, applySnapshot]);

  // Kırılım tablosunu (Depo + Lab → Ürün) Excel'e aktar
  const exportCostExcel = useCallback(async () => {
    const XLSX = await import('xlsx');
    const rows: Record<string, any>[] = [];
    const push = (loc: CostLocationRow) => {
      loc.products.forEach((p) => {
        rows.push({
          Boyut: loc.type === 'depo' ? 'Depo' : 'Laboratuvar',
          Konum: loc.name,
          'Stok Kodu': p.stokKodu,
          'Ürün': p.stokAdi,
          Marka: p.brand,
          'Ürün Grubu': p.urunGrubu || '',
          Adet: p.quantity,
          EUR: Number(p.nativeTotals.EUR.toFixed(2)),
          USD: Number(p.nativeTotals.USD.toFixed(2)),
          TRY: Number(p.nativeTotals.TRY.toFixed(2)),
          'Toplam (TRY)': Number(p.tryTotal.toFixed(2)),
        });
      });
    };
    costByDepot.forEach(push);
    costByLab.forEach(push);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Anlık Maliyet');
    const dateTag = costMeta?.forDate || format(new Date(), 'yyyy-MM-dd');
    XLSX.writeFile(wb, `anlik-maliyet-${dateTag}.xlsx`);
  }, [costByDepot, costByLab, costMeta]);

  // Snapshot dokümanını dinle; yoksa bir kez istemci fallback ile hesapla.
  const costFallbackTriggered = useRef(false);
  useEffect(() => {
    if (!currentCompanyId) return;
    const ref = doc(db, 'costSnapshots', currentCompanyId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        applySnapshot(snap.data() as StockCostSnapshot);
      } else if (!costFallbackTriggered.current) {
        costFallbackTriggered.current = true;
        computeAndSaveSnapshot('client-fallback');
      }
    }, (err) => {
      console.warn('[Dashboard] costSnapshot listen failed:', err);
      if (!costFallbackTriggered.current) { costFallbackTriggered.current = true; computeAndSaveSnapshot('client-fallback'); }
    });
    return () => unsub();
  }, [currentCompanyId, applySnapshot, computeAndSaveSnapshot]);

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

  // Bugün kartı — etkileşimli takvim + seçili günün görevleri
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [calMonth, setCalMonth] = useState<Date>(startOfMonth(new Date()));
  const tasksByDayKey = useMemo(() => {
    const m = new Map<string, any[]>();
    if (!currentUserProfile?.uid) return m;
    purchasingTasks.forEach((task) => {
      const mine = task.createdByUid === currentUserProfile.uid
        || task.assignedPersonnel?.some((p: any) => p.uid === currentUserProfile.uid)
        || task.accompanyingPersonnel?.some((p: any) => p.uid === currentUserProfile.uid);
      if (!mine || !task.date) return;
      const arr = m.get(task.date) || [];
      arr.push(task); m.set(task.date, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return m;
  }, [purchasingTasks, currentUserProfile?.uid]);
  const taskDaySet = useMemo(() => new Set(tasksByDayKey.keys()), [tasksByDayKey]);
  const selectedDayKey = format(selectedDay, 'yyyy-MM-dd');
  const selectedDayTasks = tasksByDayKey.get(selectedDayKey) || [];

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

  // Momentum: dönemin ikinci yarısı vs ilk yarısı — ivme yüzdesi
  const trendDelta = (() => {
    const half = Math.floor(trendSpark.length / 2);
    if (half < 1) return 0;
    const first = trendSpark.slice(0, half).reduce((a: number, b: number) => a + b, 0);
    const second = trendSpark.slice(half).reduce((a: number, b: number) => a + b, 0);
    if (first === 0) return second > 0 ? 100 : 0;
    return Math.round(((second - first) / first) * 100);
  })();
  const trendPeak = trendSpark.length ? Math.max(...trendSpark) : 0;

  // Fault total (atama+müdahale)
  const faultTotal = faultKpis.atamaBekleyen + faultKpis.mudahaleBekleyen + faultKpis.mudahaleEdilen;

  const hasStockCost = totalStockCost !== null && totalStockCost > 0;

  const faultStats = [
    { key: 'atama', label: 'Atama Bekleyen', value: faultKpis.atamaBekleyen, tone: HOME_C.accent, bg: `${HOME_C.accent}14`, icon: UserPlus2, href: '/ariza-yonetimi?status=atama_bekliyor' },
    { key: 'mb', label: 'Müdahale Bekleyen', value: faultKpis.mudahaleBekleyen, tone: HOME_C.danger, bg: 'rgba(192,121,106,0.12)', icon: TimerReset, href: '/ariza-yonetimi?status=mudahale_bekliyor' },
    { key: 'me', label: 'Müdahale Edilen', value: faultKpis.mudahaleEdilen, tone: HOME_C.waterDeep, bg: 'rgba(111,181,133,0.14)', icon: ActivitySquare, href: '/ariza-yonetimi?status=mudahale_ediliyor' },
  ];

  // Bugün — yapılan / toplam görev
  const totalToday = selectedDayTasks.length;
  const doneToday = selectedDayTasks.filter((t: any) => t.completed).length;
  const todayPct = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;
  const selectedIsToday = isToday(selectedDay);

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
      <ClayShell style={{ padding: isMobile ? '16px 14px 30px' : wide ? '14px 24px 18px' : '18px 22px 26px' }}>
        <div style={{ maxWidth: 1480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap, height: wide ? 'calc(100dvh - 32px)' : 'auto', overflow: wide ? 'hidden' : 'visible' }}>

          {/* Header */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 16, flexWrap: 'wrap', animation: `mkRise 520ms ${HOME_C.ease} both` }}>
            <div style={{ width: isMobile ? 42 : 46, height: isMobile ? 42 : 46, borderRadius: 15, flexShrink: 0, display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(circle at 32% 28%, ${HOME_C.accent2}, ${HOME_C.accent})`, boxShadow: `inset 0 1px 1px rgba(255,255,255,0.4), 0 10px 20px -8px ${HOME_C.accentGlow}`, fontSize: isMobile ? 16 : 19, fontWeight: 800 }}>{initials}</div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 23, fontWeight: 800, letterSpacing: '-0.02em', color: HOME_C.ink1 }}>{userName}</h1>
              <div style={{ fontSize: 13, fontWeight: 600, color: HOME_C.ink2 }}>Hoş geldin · genel bakış</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              {!isMobile && <span style={{ fontSize: 13.5, fontWeight: 700, color: HOME_C.ink2, fontFamily: 'ui-monospace, monospace' }}>{format(new Date(), 'dd MMMM yyyy · EEEE', { locale: tr })}</span>}
              <ClayIconBtn round><Bell size={18} /></ClayIconBtn>
            </div>
          </div>

          {/* KPI row — üç kart eşit boyda, kompakt */}
          <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : tablet ? '1fr 1fr' : '1fr 1fr 1fr', gap, alignItems: 'stretch', animation: `mkRise 560ms ${HOME_C.ease} 60ms both` }}>
            {/* Cihaz Atama Durumu */}
            <div style={{ gridColumn: tablet ? '1 / -1' : 'auto' }}>
              <ClayCard pad={16} style={{ height: '100%' }}>
                <CardHead ico={<ActivitySquare size={18} />} title="Cihaz Atama Durumu" tone="accent" right={<Pill>{faultTotal} toplam</Pill>} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 12 }}>
                  {faultStats.map((s, i) => <MiniKpi key={s.key} s={s} i={i} />)}
                </div>
              </ClayCard>
            </div>

            {/* Miad ≤ 45 Gün */}
            <Link href="/stok-yonetimi" style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
              <ClayCard hover pad={16} style={{ height: '100%' }}>
                <CardHead ico={<AlertTriangle size={18} />} title="Miad ≤ 45 Gün" tone="amber" right={<span style={{ color: HOME_C.ink3, display: 'inline-flex' }}><ArrowUpRight size={16} /></span>} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
                  <Ring pct={miadPct} size={72} stroke={9} color={HOME_C.amber} delay={200}>
                    <div style={{ textAlign: 'center' }}>
                      <CountText value={miadCount} style={{ fontSize: 22, fontWeight: 800, color: HOME_C.ink1, lineHeight: 1, fontVariantNumeric: 'tabular-nums', display: 'block' }} />
                      <div style={{ fontSize: 10, fontWeight: 600, color: HOME_C.ink3 }}>ürün</div>
                    </div>
                  </Ring>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: HOME_C.ink2, lineHeight: 1.4 }}>Tüm depolarda miadı yaklaşan ürünler</div>
                    <div style={{ marginTop: 10 }}><Tag tone={HOME_C.amber} bg={HOME_C.amberSoft}>≤ 45 gün penceresi</Tag></div>
                  </div>
                </div>
              </ClayCard>
            </Link>

            {/* Anlık Maliyet */}
            <ClayCard tone="ok" onClick={() => setIsStockCostDetailOpen(true)} hover pad={16} style={{ height: '100%' }}>
              <CardHead ico={<Banknote size={18} />} title="Anlık Maliyet" tone="ok" right={<ClayIconBtn onClick={() => computeAndSaveSnapshot('manual')}>{isRefreshingStockCost ? <Loader2 size={16} style={{ animation: 'mkSpin 0.8s linear infinite' }} /> : <RefreshCw size={16} />}</ClayIconBtn>} />
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  {totalStockCost === null
                    ? <span style={{ fontSize: 28, fontWeight: 800, color: HOME_C.ink3 }}>…</span>
                    : <CountText value={totalStockCost} format={fmtTL} style={{ fontSize: isMobile ? 26 : 30, fontWeight: 800, color: HOME_C.ink1, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }} />}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: HOME_C.ink3, marginTop: 5 }}>
                  {costMeta ? `${format(new Date(costMeta.computedAt), 'dd MMM HH:mm', { locale: tr })} · ${costMeta.source === 'scheduled' ? '06:00 otomatik' : costMeta.source === 'manual' ? 'elle hesaplandı' : 'ilk hesap'}` : 'hesaplanıyor…'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9, padding: '9px 13px', borderRadius: HOME_C.radiusSm, background: 'rgba(192,121,106,0.10)', boxShadow: 'inset 0 0 0 1px rgba(192,121,106,0.18)' }}>
                  <span style={{ color: HOME_C.danger, display: 'inline-flex' }}><AlertTriangle size={16} /></span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: HOME_C.danger, letterSpacing: '0.02em' }}>RİSKLİ STOK</span>
                  <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800, color: HOME_C.danger, fontVariantNumeric: 'tabular-nums' }}>{riskyCost !== null ? fmtTL(riskyCost) : '…'}</span>
                </div>
              </div>
            </ClayCard>
          </div>

          {/* Trend + Bugün — kompakt boy */}
          <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: wide ? 'minmax(0,1.5fr) minmax(0,1fr)' : '1fr', gap, animation: `mkRise 560ms ${HOME_C.ease} 150ms both` }}>
            {/* Tüketim Trendi */}
            <ClayCard onClick={() => setIsConsumptionModalOpen(true)} hover pad={16}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 4, flexWrap: 'wrap' }}>
                <CardHead ico={<TrendingUp size={18} />} title="Tüketim Trendi" tone="accent" flush />
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Segmented value={trendPeriod} onChange={(v) => setTrendPeriod(v)} options={periodSeg.map(p => ({ v: p, l: periodLabel[p] }))} />
                  <ClayIconBtn onClick={() => setIsConsumptionModalOpen(true)}><Maximize2 size={16} /></ClayIconBtn>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <CountText value={trendTotal} style={{ fontSize: isMobile ? 28 : 34, fontWeight: 800, color: HOME_C.ink1, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }} />
                    {trendTotal > 0 && <DeltaBadge value={trendDelta} neutralLabel="sabit" />}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: HOME_C.ink2, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>{trendTitle}</span>
                    {trendPeak > 0 && <span style={{ color: HOME_C.ink3 }}>· zirve {fmtInt(trendPeak)}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <ClayIconBtn round onClick={() => handleTrendNav('prev')}><ChevronLeft size={16} /></ClayIconBtn>
                  <ClayIconBtn round onClick={() => handleTrendNav('next')}><ChevronRight size={16} /></ClayIconBtn>
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <ClayLineChart data={trendSpark.length ? trendSpark : [0]} labels={trendLabels.length ? trendLabels : ['']} height={isMobile ? 150 : wide ? 132 : 168} animKey={trendPeriod + trendTitle} yTicks />
              </div>
            </ClayCard>

            {/* Bugün — sol yarı etkileşimli takvim, sağ yarı seçili günün görevleri */}
            <ClayCard pad={16}>
              <CardHead ico={<CalendarCheck size={18} />} title="Bugün" tone="accent" right={<Pill>{doneToday}/{totalToday} görev</Pill>} />
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(186px, 216px) 1fr', gap: 16, alignItems: 'stretch' }}>
                {/* takvim */}
                <MiniCalendar
                  month={calMonth}
                  selected={selectedDay}
                  taskDays={taskDaySet}
                  onSelectDay={(d) => { setSelectedDay(d); if (!isSameMonth(d, calMonth)) setCalMonth(startOfMonth(d)); }}
                  onPrevMonth={() => setCalMonth((m) => subMonths(m, 1))}
                  onNextMonth={() => setCalMonth((m) => addMonths(m, 1))}
                />
                {/* seçili günün görevleri */}
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12, fontWeight: 700, color: HOME_C.ink2, marginBottom: 6 }}>
                    <span style={{ textTransform: 'capitalize' }}>{format(selectedDay, 'd MMMM EEEE', { locale: tr })}{selectedIsToday ? ' · bugün' : ''}</span>
                    <span style={{ color: HOME_C.ink3 }}>%{todayPct}</span>
                  </div>
                  <ClayBar pct={todayPct} />
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7, maxHeight: isMobile ? 220 : 150, overflowY: 'auto', paddingRight: 4 }}>
                    {totalToday === 0 ? (
                      <div style={{ padding: '22px 0', textAlign: 'center', color: HOME_C.ink3, fontSize: 12.5, fontWeight: 600 }}>{selectedIsToday ? 'Bugün için planlanmış görev yok.' : 'Bu gün için planlanmış görev yok.'}</div>
                    ) : selectedDayTasks.map((t: any, i: number) => (
                      <div key={t.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: HOME_C.radiusSm, background: t.completed ? 'rgba(111,181,133,0.09)' : HOME_C.surfaceHi, boxShadow: t.completed ? 'none' : HOME_C.clayFlat, animation: `mkPopIn ${240 + Math.min(i, 8) * 70}ms ${HOME_C.ease}` }}>
                        <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: t.completed ? HOME_C.waterSolid : HOME_C.surface2, boxShadow: t.completed ? '0 4px 9px -3px rgba(111,181,133,0.6)' : HOME_C.clayInset, color: t.completed ? '#fff' : HOME_C.ink3 }}>{t.completed ? <Check size={12} /> : <span style={{ width: 6, height: 6, borderRadius: '50%', background: HOME_C.accent }} />}</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: HOME_C.ink3, fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>{t.startTime}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: t.completed ? HOME_C.ink3 : HOME_C.ink1, textDecoration: t.completed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </ClayCard>
          </div>

          {/* Sık Kullanılanlar — kalan alanı doldurur, tüm butonlar kaydırmasız sığar */}
          <div style={{ flex: wide ? '1 1 auto' : '0 0 auto', minHeight: 0, display: 'flex', animation: `mkRise 560ms ${HOME_C.ease} 240ms both` }}>
          <ClayCard tone="brown" pad={isMobile ? 14 : 16} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <CardHead ico={<Search size={18} />} title="Sık Kullanılanlar" onLight right={<Pill onLight>{visiblePanels.length}</Pill>} />
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${isMobile ? 3 : tablet ? 5 : 8}, 1fr)`, gridAutoRows: wide ? '1fr' : 'auto', gap: isMobile ? 10 : 11, marginTop: 12 }}>
              {visiblePanels.map((panel, i) => <ShortcutTile key={panel.key} panel={panel} i={i} dense={wide} />)}
            </div>
          </ClayCard>
          </div>

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
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 20, fontWeight: 800, color: HOME_C.ink1, letterSpacing: '-0.02em' }}>
                <span style={{ width: 40, height: 40, borderRadius: 13, display: 'grid', placeItems: 'center', color: HOME_C.waterDeep, background: 'rgba(111,181,133,0.14)', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><Banknote size={20} /></span>
                Anlık Maliyet Detayı
              </DialogTitle>
              <button onClick={exportCostExcel} style={{ all: 'unset', marginLeft: 'auto', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 15px', borderRadius: HOME_C.radiusSm, fontSize: 13, fontWeight: 800, color: '#fff', background: `linear-gradient(180deg, ${HOME_C.waterSolid}, ${HOME_C.waterDeep})`, boxShadow: `0 8px 16px -8px rgba(111,181,133,0.7)` }}>
                <Download size={16} /> Excel
              </button>
            </div>
            <DialogDescription style={{ fontSize: 13.5, color: HOME_C.ink2, fontWeight: 500, marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>Depo ve laboratuvar bazında kırılım.</span>
              <span style={{ fontWeight: 800, color: HOME_C.ink1 }}>Toplam: {totalStockCost !== null ? fmtTL(totalStockCost) : '…'}</span>
              {costMeta && <span style={{ color: HOME_C.ink3 }}>· {format(new Date(costMeta.computedAt), 'dd MMM yyyy HH:mm', { locale: tr })}</span>}
            </DialogDescription>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '16px 26px 26px' }}>
            {(costByDepot.length === 0 && costByLab.length === 0) ? (
              <p style={{ fontSize: 14, color: HOME_C.ink3, fontWeight: 600, textAlign: 'center', padding: '40px 0' }}>Detay verisi bulunamadı.</p>
            ) : ([
              { key: 'depo', title: 'Depolar', icon: <Warehouse size={17} />, rows: costByDepot, tone: HOME_C.accent, bg: `${HOME_C.accent}16` },
              { key: 'lab', title: 'Laboratuvarlar', icon: <FlaskConical size={17} />, rows: costByLab, tone: HOME_C.skyDeep, bg: 'rgba(124,168,222,0.16)' },
            ] as const).map((section) => section.rows.length === 0 ? null : (
              <div key={section.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 15, fontWeight: 800, color: HOME_C.ink1 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', color: section.tone, background: section.bg }}>{section.icon}</span>
                  {section.title}
                  <span style={{ marginLeft: 'auto', color: HOME_C.waterDeep, fontVariantNumeric: 'tabular-nums' }}>{fmtTL(section.rows.reduce((a, l) => a + l.tryTotal, 0))}</span>
                </div>
                {section.rows.map((location) => (
                  <details key={`${location.type}-${location.id}`} style={{ borderRadius: HOME_C.radius, background: HOME_C.surfaceHi, boxShadow: HOME_C.clayFlat, padding: 14 }}>
                    <summary style={{ cursor: 'pointer', listStyle: 'none', fontSize: 14, fontWeight: 700, color: HOME_C.ink1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {location.name}
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: HOME_C.ink3 }}>· {location.products.length} ürün · {location.quantity} adet</span>
                      </span>
                      <span style={{ fontWeight: 800, color: HOME_C.waterDeep, fontVariantNumeric: 'tabular-nums' }}>{fmtTL(location.tryTotal)}</span>
                    </summary>
                    <div style={{ marginTop: 10, overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: HOME_C.ink3, borderBottom: `1px solid ${HOME_C.line}` }}>
                            <th style={{ padding: '6px 8px 6px 0', fontWeight: 700 }}>Stok Kodu</th>
                            <th style={{ padding: '6px 8px 6px 0', fontWeight: 700 }}>Ürün</th>
                            <th style={{ padding: '6px 8px 6px 0', fontWeight: 700 }}>Marka</th>
                            <th style={{ padding: '6px 8px 6px 0', fontWeight: 700 }}>Adet</th>
                            <th style={{ padding: '6px 0 6px 8px', fontWeight: 700, textAlign: 'right' }}>Toplam (TRY)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {location.products.map((product) => (
                            <tr key={product.stokKodu} style={{ borderBottom: `1px solid ${HOME_C.line}` }}>
                              <td style={{ padding: '7px 8px 7px 0', fontFamily: 'ui-monospace, monospace', color: HOME_C.ink2 }}>{product.stokKodu}</td>
                              <td style={{ padding: '7px 8px 7px 0', color: HOME_C.ink1, fontWeight: 600 }}>{product.stokAdi}</td>
                              <td style={{ padding: '7px 8px 7px 0', color: HOME_C.ink2 }}>{product.brand}</td>
                              <td style={{ padding: '7px 8px 7px 0', color: HOME_C.ink2 }}>{product.quantity}</td>
                              <td style={{ padding: '7px 0 7px 8px', textAlign: 'right', fontWeight: 700, color: HOME_C.ink1, fontVariantNumeric: 'tabular-nums' }}>{fmtTL(product.tryTotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
