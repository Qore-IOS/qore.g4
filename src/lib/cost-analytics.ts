import { addYears, endOfMonth, isValid, startOfMonth, subMonths } from 'date-fns';
import type { Currency, ProductCode } from '@/lib/types';

export type TimeRange = 'latest' | 'last-3m' | 'last-6m' | 'last-12m' | 'ytd' | 'all' | 'custom';

export interface SayimSessionItem {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  stokAdedi: number;
  cihazUstuAdedi: number;
}

export interface SayimSession {
  id: string;
  locationType: 'lab' | 'depot';
  locationId: string;
  locationName: string;
  createdAt: any;
  items: SayimSessionItem[];
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

export function getSessionDate(session: SayimSession): Date | null {
  if (!session.createdAt) return null;
  if (session.createdAt.toDate) return session.createdAt.toDate();
  if (session.createdAt.seconds) return new Date(session.createdAt.seconds * 1000);
  const d = new Date(session.createdAt);
  return isValid(d) ? d : null;
}

export function getProductCostInCurrency(
  stokKodu: string,
  quantity: number,
  cihazUstu: number,
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  targetCurrency: Currency
): number {
  const product = productMap.get(stokKodu);
  if (!product?.cost) return 0;

  const isKit = product.urunGrubu === 'kit';
  const ambalaj = product.ambalajDegeri || 1;
  const testAdeti = product.testAdeti || 1;

  let totalCostNative = 0;
  if (isKit) {
    // Kit: Calculate based on tests
    const totalTests = (quantity * ambalaj * testAdeti) + cihazUstu;
    const costPerTest = product.cost / (ambalaj * testAdeti);
    totalCostNative = costPerTest * totalTests;
  } else {
    // Sarf / Yedek Parça: Calculate based on boxes/units
    // (product.cost / ambalaj) gives unit cost if ambalaj > 1, 
    // total unitsCount = quantity * ambalaj + cihazUstu
    totalCostNative = (product.cost / ambalaj) * (quantity * ambalaj + cihazUstu);
  }

  const productCurrency = (product.currency || 'TRY') as Currency;
  let costEUR = totalCostNative;
  if (productCurrency === 'USD') costEUR = totalCostNative / (rates.USD || 1);
  if (productCurrency === 'TRY') costEUR = totalCostNative / (rates.TRY || 1);

  return costEUR * (rates[targetCurrency] || 1);
}

export function getSessionsInRange(
  sessions: SayimSession[],
  range: TimeRange,
  customStart?: Date,
  customEnd?: Date
): SayimSession[] {
  if (range === 'all') return sessions;
  if (range === 'latest') return sessions.length > 0 ? [sessions[0]] : [];

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

  return sessions.filter((s) => {
    const d = getSessionDate(s);
    return d && d >= start && d <= end;
  });
}

export function getLatestByLocation(sessions: SayimSession[]): Map<string, SayimSession> {
  const latestByLocation = new Map<string, SayimSession>();
  sessions.forEach((session) => {
    const key = `${session.locationType}-${session.locationId}`;
    if (!latestByLocation.has(key)) latestByLocation.set(key, session);
  });
  return latestByLocation;
}

export function getSessionCost(
  session: SayimSession,
  productMap: Map<string, ProductCode>,
  rates: Record<Currency, number>,
  currency: Currency
): number {
  return session.items.reduce((sum, item) => sum + getProductCostInCurrency(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi, productMap, rates, currency), 0);
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
      row.value += getProductCostInCurrency(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi, productMap, rates, currency);
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
      const cost = getProductCostInCurrency(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi, productMap, rates, currency);
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
      const cost = getProductCostInCurrency(item.stokKodu, item.stokAdedi, item.cihazUstuAdedi, productMap, rates, currency);
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
  const minDate = dated[dated.length - 1].d;
  const maxDate = dated[0].d;
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
