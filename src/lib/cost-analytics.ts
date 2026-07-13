import { addYears, endOfMonth, isValid, startOfMonth, subMonths } from 'date-fns';
import type { Currency, ProductCode } from '@/lib/types';

export type TimeRange = 'latest' | 'last-3m' | 'last-6m' | 'last-12m' | 'ytd' | 'all' | 'custom';

export interface SayimSessionItem {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  stokAdedi: number;
  cihazUstuAdedi: number;
  /** Cost snapshot captured when the count was saved. */
  cost?: number;
  /** Currency snapshot captured when the count was saved. */
  currency?: Currency;
  /** Package-size snapshot captured when the count was saved. */
  ambalajDegeri?: number;
}

export interface SayimSession {
  id: string;
  locationType: 'lab' | 'depot';
  locationId: string;
  locationName: string;
  createdAt: any;
  /** Optional accounting period for back-dated bulk count sessions, formatted as YYYY-MM. */
  period?: string;
  /** Optional zero-based month saved by the bulk count flow. */
  month?: number;
  /** Optional year saved by the bulk count flow. */
  year?: number;
  items: SayimSessionItem[];
  /** Soft-deleted sessions act as a reset marker for the same period + location. */
  isDeleted?: boolean;
  deletedAt?: any;
  deletedByUid?: string;
  deletedByName?: string;
}


export interface BrandCostData {
  name: string;
  value: number;
  productCount: number;
}

export interface LocationCostData {
  locationId: string;
  locationName: string;
  locationType: 'lab' | 'depot';
  totalCost: number;
  productCount: number;
  lastSessionDate: Date | null;
  brands: { name: string; cost: number }[];
}

export interface MonthlyTrendPoint {
  monthKey: string;
  monthLabel: string;
  cost: number;
}

export interface DeltaMetrics {
  current: number;
  previous: number;
  deltaPct: number;
}

export interface ComparisonDeltas {
  mom: DeltaMetrics;
  qoq: DeltaMetrics;
  yoy: DeltaMetrics;
}

export interface ProductGroupCostData {
  group: 'kit' | 'sarf' | 'yedek_parca' | 'diger';
  value: number;
}

export interface TurnoverMetrics {
  capitalTied: number;
  estimatedQuarterConsumption: number;
  turnoverRatio: number;
  dio: number;
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  const d = new Date(value);
  return isValid(d) ? d : null;
}

function getCreatedAtDate(session: SayimSession): Date | null {
  return toDateValue(session.createdAt);
}

function getSessionPeriodDate(session: SayimSession): Date | null {
  const periodMatch = typeof session.period === 'string' ? session.period.match(/^(\d{4})-(\d{2})$/) : null;
  if (periodMatch) {
    const year = Number(periodMatch[1]);
    const monthIndex = Number(periodMatch[2]) - 1;
    const d = new Date(year, monthIndex, 1);
    return isValid(d) ? d : null;
  }

  if (typeof session.year === 'number' && typeof session.month === 'number') {
    const d = new Date(session.year, session.month, 1);
    return isValid(d) ? d : null;
  }

  return null;
}

/**
 * Date used by cost-observation analytics. Back-dated bulk counts are grouped
 * by their selected accounting period; legacy sessions fall back to createdAt.
 */
export function getSessionDate(session: SayimSession): Date | null {
  return getSessionPeriodDate(session) || getCreatedAtDate(session);
}

export function getProductCostInCurrency(
  stokKodu: string,
  quantity: number,
  cihazUstu: number,
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  targetCurrency: Currency,
  snapshot?: Pick<SayimSessionItem, 'cost' | 'currency' | 'ambalajDegeri'>
): number {
  const product = productMap.get(stokKodu);
  const productCost = Number(product?.cost ?? snapshot?.cost ?? 0);
  const rawPackageSize = Number(product?.ambalajDegeri ?? snapshot?.ambalajDegeri ?? 0);
  const packageSize = rawPackageSize > 0 ? rawPackageSize : 1;
  if (!productCost) return 0;

  const totalTest = (quantity * packageSize) + cihazUstu;
  const costPerTest = productCost / packageSize;
  const totalCostNative = costPerTest * totalTest;
  const productCurrency = (product?.currency || snapshot?.currency || 'TRY') as Currency;

  let costEUR = totalCostNative;
  if (productCurrency === 'USD') costEUR = totalCostNative / (rates.USD || 1);
  if (productCurrency === 'TRY') costEUR = totalCostNative / (rates.TRY || 1);

  return costEUR * (rates[targetCurrency] || 1);
}

function compareSessionsByAnalyticsDateDesc(a: SayimSession, b: SayimSession): number {
  const ad = getSessionDate(a)?.getTime() ?? 0;
  const bd = getSessionDate(b)?.getTime() ?? 0;
  if (bd !== ad) return bd - ad;
  const ac = (toDateValue(a.deletedAt) || getCreatedAtDate(a))?.getTime() ?? 0;
  const bc = (toDateValue(b.deletedAt) || getCreatedAtDate(b))?.getTime() ?? 0;
  return bc - ac;
}

function sortSessionsByAnalyticsDateDesc(sessions: SayimSession[]): SayimSession[] {
  return [...sessions].sort(compareSessionsByAnalyticsDateDesc);
}

function mergeSessionItem(target: SayimSessionItem, source: SayimSessionItem): SayimSessionItem {
  return {
    ...target,
    stokAdedi: (Number(target.stokAdedi) || 0) + (Number(source.stokAdedi) || 0),
    cihazUstuAdedi: (Number(target.cihazUstuAdedi) || 0) + (Number(source.cihazUstuAdedi) || 0),
  };
}

function mergeSessionsByLocation(sessions: SayimSession[]): Map<string, SayimSession> {
  const consolidatedByLocation = new Map<string, SayimSession>();
  const resetKeys = new Set<string>();

  sortSessionsByAnalyticsDateDesc(sessions).forEach((session) => {
    const key = `${session.locationType}-${session.locationId}`;
    if (resetKeys.has(key)) return;
    if (session.isDeleted) {
      resetKeys.add(key);
      return;
    }

    const current = consolidatedByLocation.get(key);
    if (!current) {
      consolidatedByLocation.set(key, {
        ...session,
        items: session.items.map((item) => ({ ...item })),
      });
      return;
    }

    const itemsByStockCode = new Map<string, SayimSessionItem>(
      current.items.map((item) => [item.stokKodu, { ...item }]),
    );

    session.items.forEach((item) => {
      const existing = itemsByStockCode.get(item.stokKodu);
      itemsByStockCode.set(item.stokKodu, existing ? mergeSessionItem(existing, item) : { ...item });
    });

    consolidatedByLocation.set(key, {
      ...current,
      id: `${current.id}+${session.id}`,
      items: Array.from(itemsByStockCode.values()),
    });
  });

  return consolidatedByLocation;
}

export function getSessionsInRange(
  sessions: SayimSession[],
  range: TimeRange,
  customStart?: Date,
  customEnd?: Date
): SayimSession[] {
  const sortedSessions = sortSessionsByAnalyticsDateDesc(sessions);
  if (range === 'all') return sortedSessions;
  if (range === 'latest') return sortedSessions.length > 0 ? [sortedSessions[0]] : [];

  const now = new Date();
  let start: Date;
  let end: Date = now;

  if (range === 'custom' && customStart && customEnd) {
    start = customStart;
    end = customEnd;
  } else if (range === 'ytd') {
    start = new Date(now.getFullYear(), 0, 1);
  } else if (range === 'last-3m') {
    start = subMonths(now, 3);
  } else if (range === 'last-6m') {
    start = subMonths(now, 6);
  } else {
    start = subMonths(now, 12);
  }

  return sortedSessions.filter((s) => {
    const d = getSessionDate(s);
    return d && d >= start && d <= end;
  });
}

/** Dönem anahtarı (YYYY-MM) — sayımın analitik tarihinden türetilir. */
function periodKeyOf(session: SayimSession): string {
  const d = getSessionDate(session);
  if (!d) return 'na';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** İki kalem listesini stok koduna göre birleştirir; adetleri TOPLAR. */
function mergeSessionItems(target: Map<string, SayimSessionItem>, items: SayimSessionItem[] | undefined): void {
  (items || []).forEach((it) => {
    if (!it || !it.stokKodu) return;
    const existing = target.get(it.stokKodu);
    if (existing) {
      existing.stokAdedi = (Number(existing.stokAdedi) || 0) + (Number(it.stokAdedi) || 0);
      existing.cihazUstuAdedi = (Number(existing.cihazUstuAdedi) || 0) + (Number(it.cihazUstuAdedi) || 0);
      if (!existing.stokAdi && it.stokAdi) existing.stokAdi = it.stokAdi;
      if (!existing.marka && it.marka) existing.marka = it.marka;
      if (existing.cost == null && it.cost != null) existing.cost = it.cost;
      if (existing.currency == null && it.currency != null) existing.currency = it.currency;
      if (existing.ambalajDegeri == null && it.ambalajDegeri != null) existing.ambalajDegeri = it.ambalajDegeri;
    } else {
      target.set(it.stokKodu, {
        ...it,
        stokAdedi: Number(it.stokAdedi) || 0,
        cihazUstuAdedi: Number(it.cihazUstuAdedi) || 0,
      });
    }
  });
}

/**
 * Bir lokasyonun bir dönemdeki (ay) sayımlarını TOPLAR. Aynı kurum + aynı dönem
 * için birden fazla sayım girildiyse üzerine yazmaz; aynı stok kodundaki adetleri
 * toplar, farklı ürünleri ayrı kalem olarak tutar. Silinen (isDeleted) sayım, o
 * döneme kadar biriken toplamı SIFIRLAR (reset marker); sonraki sayımlar yeniden
 * birikmeye başlar. Her (lokasyon, dönem) için tek birleşik sayım döndürür.
 */
export function consolidateSessionsByLocationPeriod(sessions: SayimSession[]): SayimSession[] {
  const groups = new Map<string, SayimSession[]>();
  sessions.forEach((s) => {
    const key = `${s.locationType}-${s.locationId}-${periodKeyOf(s)}`;
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  });

  const result: SayimSession[] = [];
  groups.forEach((groupSessions, key) => {
    // Kronolojik (eskiden yeniye) — silme reset'i doğru sırayla uygulansın.
    const ordered = [...groupSessions].sort((a, b) => {
      const at = (toDateValue(a.deletedAt) || getCreatedAtDate(a))?.getTime() ?? 0;
      const bt = (toDateValue(b.deletedAt) || getCreatedAtDate(b))?.getTime() ?? 0;
      return at - bt;
    });

    const merged = new Map<string, SayimSessionItem>();
    let representative: SayimSession | null = null;
    let latestCreatedAt: any = null;
    let latestCreatedMs = -Infinity;

    ordered.forEach((s) => {
      if (s.isDeleted) {
        merged.clear(); // dönem sıfırlama
        return;
      }
      mergeSessionItems(merged, s.items);
      representative = s;
      const ms = getCreatedAtDate(s)?.getTime() ?? 0;
      if (ms >= latestCreatedMs) {
        latestCreatedMs = ms;
        latestCreatedAt = s.createdAt;
      }
    });

    if (merged.size === 0 || !representative) return; // boş / tamamen resetlenmiş dönem
    const rep = representative as SayimSession;
    result.push({
      id: key,
      locationType: rep.locationType,
      locationId: rep.locationId,
      locationName: rep.locationName,
      createdAt: latestCreatedAt ?? rep.createdAt,
      period: rep.period,
      month: rep.month,
      year: rep.year,
      items: Array.from(merged.values()),
      isDeleted: false,
    });
  });

  return result;
}

/**
 * Her lokasyon için EN GÜNCEL DÖNEMİN birleşik (toplanmış) sayımını döndürür.
 * Aynı dönemdeki birden çok sayım `consolidateSessionsByLocationPeriod` ile
 * toplanır; ardından lokasyon başına en güncel dönem seçilir. Tek bir döneme
 * filtrelenmiş girdi verilirse (dönem seçili gözlem) sonuç o dönemin toplamıdır.
 */
export function getLatestByLocation(sessions: SayimSession[]): Map<string, SayimSession> {
  const consolidated = consolidateSessionsByLocationPeriod(sessions);
  const latestByLocation = new Map<string, SayimSession>();

  sortSessionsByAnalyticsDateDesc(consolidated).forEach((session) => {
    const key = `${session.locationType}-${session.locationId}`;
    if (latestByLocation.has(key)) return;
    latestByLocation.set(key, session);
  });

  return latestByLocation;
}

export function getSessionCost(
  session: SayimSession,
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency
): number {
  if (session.isDeleted) return 0;
  return session.items.reduce((sum, item) => sum + getProductCostInCurrency(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi, productMap, rates, currency, item), 0);
}

export function getConsolidatedCostForWindow(
  sessions: SayimSession[],
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency,
  start: Date,
  end: Date
): number {
  const rangeSessions = sessions.filter((s) => {
    const d = getSessionDate(s);
    return d && d >= start && d <= end;
  });
  const latestByLocation = getLatestByLocation(rangeSessions);
  return Array.from(latestByLocation.values()).reduce((sum, s) => sum + getSessionCost(s, productMap, rates, currency), 0);
}

export function calculateTotalCostForRange(
  sessions: SayimSession[],
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency,
  range: TimeRange,
  customStart?: Date,
  customEnd?: Date
): number {
  const ranged = getSessionsInRange(sessions, range, customStart, customEnd);
  if (range === 'latest') {
    return ranged[0] ? getSessionCost(ranged[0], productMap, rates, currency) : 0;
  }

  const latestByLocation = getLatestByLocation(ranged);
  return Array.from(latestByLocation.values()).reduce((sum, s) => sum + getSessionCost(s, productMap, rates, currency), 0);
}

function calculateDelta(current: number, previous: number): DeltaMetrics {
  if (!previous) return { current, previous, deltaPct: current > 0 ? 100 : 0 };
  return { current, previous, deltaPct: ((current - previous) / previous) * 100 };
}

export function getComparisonDeltas(
  sessions: SayimSession[],
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency,
  anchorDate: Date = new Date()
): ComparisonDeltas {
  const thisMonthStart = startOfMonth(anchorDate);
  const thisMonthEnd = endOfMonth(anchorDate);
  const prevMonthStart = startOfMonth(subMonths(anchorDate, 1));
  const prevMonthEnd = endOfMonth(subMonths(anchorDate, 1));

  const currentMonth = getConsolidatedCostForWindow(sessions, productMap, rates, currency, thisMonthStart, thisMonthEnd);
  const previousMonth = getConsolidatedCostForWindow(sessions, productMap, rates, currency, prevMonthStart, prevMonthEnd);

  const thisQuarterStart = startOfMonth(subMonths(anchorDate, 2));
  const prevQuarterStart = startOfMonth(subMonths(anchorDate, 5));
  const thisQuarter = getConsolidatedCostForWindow(sessions, productMap, rates, currency, thisQuarterStart, thisMonthEnd);
  const previousQuarter = getConsolidatedCostForWindow(sessions, productMap, rates, currency, prevQuarterStart, endOfMonth(subMonths(anchorDate, 3)));

  const thisYearStart = startOfMonth(subMonths(anchorDate, 11));
  const prevYearStart = addYears(thisYearStart, -1);
  const thisYear = getConsolidatedCostForWindow(sessions, productMap, rates, currency, thisYearStart, thisMonthEnd);
  const previousYear = getConsolidatedCostForWindow(sessions, productMap, rates, currency, prevYearStart, endOfMonth(addYears(thisMonthEnd, -1)));

  return {
    mom: calculateDelta(currentMonth, previousMonth),
    qoq: calculateDelta(thisQuarter, previousQuarter),
    yoy: calculateDelta(thisYear, previousYear),
  };
}

export function getBrandCostBreakdown(
  sessions: SayimSession[],
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency
): BrandCostData[] {
  const latestByLocation = getLatestByLocation(sessions);
  const map = new Map<string, { value: number; products: Set<string> }>();

  Array.from(latestByLocation.values()).forEach((session) => {
    session.items.forEach((item) => {
      const name = item.marka || 'Diğer';
      const row = map.get(name) || { value: 0, products: new Set<string>() };
      row.value += getProductCostInCurrency(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi, productMap, rates, currency, item);
      row.products.add(item.stokKodu);
      map.set(name, row);
    });
  });

  return Array.from(map.entries())
    .map(([name, data]) => ({ name, value: data.value, productCount: data.products.size }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
}

export function getLocationCostBreakdown(
  sessions: SayimSession[],
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency
): LocationCostData[] {
  const latestByLocation = getLatestByLocation(sessions);

  return Array.from(latestByLocation.values()).map((session) => {
    const brandMap = new Map<string, number>();
    let total = 0;
    session.items.forEach((item) => {
      const cost = getProductCostInCurrency(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi, productMap, rates, currency, item);
      total += cost;
      brandMap.set(item.marka || 'Diğer', (brandMap.get(item.marka || 'Diğer') || 0) + cost);
    });

    return {
      locationId: session.locationId,
      locationName: session.locationName,
      locationType: session.locationType,
      totalCost: total,
      productCount: session.items.length,
      lastSessionDate: getSessionDate(session),
      brands: Array.from(brandMap.entries()).map(([name, cost]) => ({ name, cost })).sort((a, b) => b.cost - a.cost).slice(0, 3),
    };
  }).sort((a, b) => b.totalCost - a.totalCost);
}

export function getProductGroupBreakdown(
  sessions: SayimSession[],
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency
): ProductGroupCostData[] {
  const totals = new Map<ProductGroupCostData['group'], number>([
    ['kit', 0],
    ['sarf', 0],
    ['yedek_parca', 0],
    ['diger', 0],
  ]);
  const latestByLocation = getLatestByLocation(sessions);

  Array.from(latestByLocation.values()).forEach((session) => {
    session.items.forEach((item) => {
      const group = (productMap.get(item.stokKodu)?.urunGrubu || 'diger') as ProductGroupCostData['group'];
      const normalizedGroup = ['kit', 'sarf', 'yedek_parca'].includes(group) ? group : 'diger';
      const cost = getProductCostInCurrency(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi, productMap, rates, currency, item);
      totals.set(normalizedGroup, (totals.get(normalizedGroup) || 0) + cost);
    });
  });

  return Array.from(totals.entries()).map(([group, value]) => ({ group, value })).sort((a, b) => b.value - a.value);
}

export function calculateTurnoverMetrics(
  sessions: SayimSession[],
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency
): TurnoverMetrics {
  const capitalTied = calculateTotalCostForRange(sessions, productMap, rates, currency, 'all');
  const trend = getMonthlyTrend(sessions, productMap, rates, currency);
  const recent = trend.slice(-4);

  let consumption = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i - 1].cost - recent[i].cost;
    if (diff > 0) consumption += diff;
  }

  const estimatedQuarterConsumption = Math.max(consumption, 1);
  const turnoverRatio = capitalTied > 0 ? estimatedQuarterConsumption / capitalTied : 0;
  const dailyConsumption = estimatedQuarterConsumption / 90;
  const dio = dailyConsumption > 0 ? capitalTied / dailyConsumption : 0;

  return { capitalTied, estimatedQuarterConsumption, turnoverRatio, dio };
}

export function getMonthlyTrend(
  sessions: SayimSession[],
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency
): MonthlyTrendPoint[] {
  if (!sessions.length) return [];
  const dated = sessions
    .map((s) => ({ session: s, d: getSessionDate(s) }))
    .filter((x): x is { session: SayimSession; d: Date } => !!x.d);

  if (!dated.length) return [];
  dated.sort((a, b) => a.d.getTime() - b.d.getTime());
  const minDate = dated[0].d;
  const maxDate = dated[dated.length - 1].d;
  const start = startOfMonth(minDate);
  const end = endOfMonth(maxDate);

  const points: MonthlyTrendPoint[] = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const monthSessions = sessions.filter((s) => {
      const d = getSessionDate(s);
      return d && d >= monthStart && d <= monthEnd;
    });
    const latestByLocation = getLatestByLocation(monthSessions);
    const cost = Array.from(latestByLocation.values()).reduce((sum, s) => sum + getSessionCost(s, productMap, rates, currency), 0);

    points.push({
      monthKey: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
      monthLabel: monthStart.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }),
      cost,
    });

    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return points;
}
