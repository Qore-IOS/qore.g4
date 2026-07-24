import type { ProductCode } from '@/lib/types';

export type LogisticsCountStatus =
  | 'complete'
  | 'partial'
  | 'not_started'
  | 'not_applicable';

export interface LabGroupDefinition {
  id: string;
  name: string;
}

export interface ProductGroupCarrier {
  laboratuvarGrubu?: string;
  laboratuvarGruplari?: string[];
}

export interface LogisticsCountItemInput {
  stokKodu?: string;
  stokAdi?: string;
  expected?: number;
  counted?: number;
  openTestQty?: number;
  totalTests?: number;
}

export interface LogisticsScopeProductInput extends ProductGroupCarrier {
  stokKodu?: string;
  stokAdi?: string;
  ambalajDegeri?: number;
}

export interface LogisticsCountSessionInput {
  id: string;
  period?: string;
  month?: number;
  year?: number;
  finishedAt?: unknown;
  items?: LogisticsCountItemInput[];
  scopeProducts?: LogisticsScopeProductInput[];
  cihazUstuUploaded?: boolean;
  kumulatifUploaded?: boolean;
}

export interface LogisticsCountProductRow {
  stokKodu: string;
  stokAdi: string;
  labGroups: string[];
  labGroupLabel: string;
  isCounted: boolean;
  countedQuantity: number | null;
  systemQuantity: number;
  difference: number | null;
  openTestQuantity: number | null;
  totalTests: number | null;
  latestSessionId: string | null;
  countedAt: Date | null;
}

export interface LogisticsLabCountOverview {
  id: string;
  name: string;
  countStatus: LogisticsCountStatus;
  requiredProductCount: number;
  countedProductCount: number;
  sessionCount: number;
  kumulatifUploaded: boolean;
  cihazUstuUploaded: boolean;
  products: LogisticsCountProductRow[];
}

export interface BuildLabCountOverviewOptions {
  labId: string;
  labName: string;
  period: string;
  products: ProductCode[];
  labScopeCodes: Iterable<string>;
  currentStockQuantityByCode?: ReadonlyMap<string, number>;
  assignedGroupKeys: ReadonlySet<string>;
  groupNameById: ReadonlyMap<string, string>;
  sessions: LogisticsCountSessionInput[];
  hasExternalKumulatifUpload?: boolean;
  hasExternalCihazUstuUpload?: boolean;
}

interface ProductSnapshot {
  countedQuantity: number;
  systemQuantity: number;
  openTestQuantity: number;
  hasOpenTestQuantity: boolean;
  totalTests: number;
  hasTotalTests: boolean;
  sessionId: string;
  countedAt: Date | null;
}

export function normalizeGroupKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR');
}

export function buildGroupNameById(
  definitions: LabGroupDefinition[],
): Map<string, string> {
  const result = new Map<string, string>();
  definitions.forEach((definition) => {
    const id = String(definition.id || '').trim();
    const name = String(definition.name || '').trim();
    if (id && name) result.set(id, name);
  });
  return result;
}

export function resolveAssignedGroupKeys(
  assignments: Iterable<string>,
  groupNameById: ReadonlyMap<string, string>,
): Set<string> {
  const result = new Set<string>();
  for (const assignment of assignments) {
    const raw = String(assignment || '').trim();
    if (!raw) continue;
    const resolved = groupNameById.get(raw) || raw;
    const key = normalizeGroupKey(resolved);
    if (key) result.add(key);
  }
  return result;
}

export function resolveProductGroupNames(
  product: ProductGroupCarrier,
  groupNameById: ReadonlyMap<string, string>,
): string[] {
  const configured =
    Array.isArray(product.laboratuvarGruplari) &&
    product.laboratuvarGruplari.length > 0
      ? product.laboratuvarGruplari
      : product.laboratuvarGrubu
        ? [product.laboratuvarGrubu]
        : [];

  const names = new Map<string, string>();
  configured.forEach((entry) => {
    const raw = String(entry || '').trim();
    if (!raw) return;
    const resolved = String(groupNameById.get(raw) || raw).trim();
    const key = normalizeGroupKey(resolved);
    if (key && !names.has(key)) names.set(key, resolved);
  });
  return Array.from(names.values());
}

export function productMatchesAssignedGroups(
  product: ProductGroupCarrier,
  assignedGroupKeys: ReadonlySet<string>,
  groupNameById: ReadonlyMap<string, string>,
): boolean {
  if (assignedGroupKeys.size === 0) return false;
  return resolveProductGroupNames(product, groupNameById).some((group) =>
    assignedGroupKeys.has(normalizeGroupKey(group)),
  );
}

export function buildCalculationPeriodKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseCalculationPeriod(
  period: string,
): { year: number; monthIndex: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) return null;
  return { year, monthIndex };
}

export function toReportingPeriod(period: string): string {
  const parsed = parseCalculationPeriod(period);
  if (!parsed) return '';
  return `${String(parsed.monthIndex + 1).padStart(2, '0')}-${parsed.year}`;
}

export function formatCalculationPeriod(
  period: string,
  options?: { shortYear?: boolean },
): string {
  const parsed = parseCalculationPeriod(period);
  if (!parsed) return period;
  const month = new Date(parsed.year, parsed.monthIndex, 1).toLocaleString(
    'tr-TR',
    { month: 'long' },
  );
  const normalizedMonth = month
    ? `${month.charAt(0).toLocaleUpperCase('tr-TR')}${month.slice(1)}`
    : month;
  const year = options?.shortYear
    ? String(parsed.year).slice(-2)
    : String(parsed.year);
  return `${normalizedMonth} ${year}`;
}

export function timestampToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'object') {
    const timestamp = value as {
      toDate?: () => Date;
      seconds?: number;
    };
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof timestamp.seconds === 'number') {
      const date = new Date(timestamp.seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function sessionMatchesPeriod(
  session: LogisticsCountSessionInput,
  period: string,
): boolean {
  const parsed = parseCalculationPeriod(period);
  if (!parsed) return false;

  if (session.period) return session.period === period;

  if (
    Number(session.year) === parsed.year &&
    Number(session.month) === parsed.monthIndex
  ) {
    return true;
  }

  if (session.year == null && session.month == null) {
    const finishedAt = timestampToDate(session.finishedAt);
    return (
      finishedAt?.getFullYear() === parsed.year &&
      finishedAt.getMonth() === parsed.monthIndex
    );
  }

  return false;
}

function toSafeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getSessionTime(session: LogisticsCountSessionInput): number {
  return timestampToDate(session.finishedAt)?.getTime() ?? 0;
}

function aggregateSessionProducts(
  session: LogisticsCountSessionInput,
): Map<string, ProductSnapshot> {
  const result = new Map<string, ProductSnapshot>();

  (session.items || []).forEach((item) => {
    const code = String(item.stokKodu || '').trim();
    if (!code) return;
    const current = result.get(code) || {
      countedQuantity: 0,
      systemQuantity: 0,
      openTestQuantity: 0,
      hasOpenTestQuantity: false,
      totalTests: 0,
      hasTotalTests: false,
      sessionId: session.id,
      countedAt: timestampToDate(session.finishedAt),
    };
    current.countedQuantity += toSafeNumber(item.counted);
    current.systemQuantity += toSafeNumber(item.expected);
    if (Object.prototype.hasOwnProperty.call(item, 'openTestQty')) {
      current.hasOpenTestQuantity = true;
      current.openTestQuantity += toSafeNumber(item.openTestQty);
    }
    if (Object.prototype.hasOwnProperty.call(item, 'totalTests')) {
      current.hasTotalTests = true;
      current.totalTests += toSafeNumber(item.totalTests);
    }
    result.set(code, current);
  });

  return result;
}

export function buildLabCountOverview({
  labId,
  labName,
  period,
  products,
  labScopeCodes,
  currentStockQuantityByCode = new Map<string, number>(),
  assignedGroupKeys,
  groupNameById,
  sessions,
  hasExternalKumulatifUpload = false,
  hasExternalCihazUstuUpload = false,
}: BuildLabCountOverviewOptions): LogisticsLabCountOverview {
  const scopedCodes = new Set(
    Array.from(labScopeCodes, (code) => String(code || '').trim()).filter(Boolean),
  );
  const periodSessions = sessions.filter((session) =>
    sessionMatchesPeriod(session, period),
  );
  const latestScopeProducts = [...periodSessions]
    .sort(
      (left, right) =>
        getSessionTime(right) - getSessionTime(left) ||
        right.id.localeCompare(left.id),
    )
    .find((session) => (session.scopeProducts?.length || 0) > 0)
    ?.scopeProducts;

  if (latestScopeProducts?.length) {
    scopedCodes.clear();
    latestScopeProducts.forEach((product) => {
      const code = String(product.stokKodu || '').trim();
      if (code) scopedCodes.add(code);
    });
  }

  // A completed count can reduce a product's live stock to zero. Keep products
  // recorded in the selected period in scope so historical detail and product
  // search do not disappear when there is no longer a live stock/min-max row.
  periodSessions.forEach((session) => {
    (session.items || []).forEach((item) => {
      const code = String(item.stokKodu || '').trim();
      if (code) scopedCodes.add(code);
    });
  });

  const productByCode = new Map<string, ProductCode>();
  products.forEach((product) => {
    const code = String(product.stokKodu || '').trim();
    if (code && !productByCode.has(code)) productByCode.set(code, product);
  });
  latestScopeProducts?.forEach((snapshot) => {
    const code = String(snapshot.stokKodu || '').trim();
    if (!code) return;
    const current = productByCode.get(code);
    productByCode.set(code, {
      ...(current || {}),
      id: current?.id || code,
      stokKodu: code,
      stokAdi: String(snapshot.stokAdi || current?.stokAdi || code),
      laboratuvarGrubu: snapshot.laboratuvarGrubu,
      laboratuvarGruplari: snapshot.laboratuvarGruplari,
      ambalajDegeri:
        snapshot.ambalajDegeri ?? current?.ambalajDegeri ?? 1,
    } as ProductCode);
  });

  const requiredProducts = Array.from(productByCode.values()).filter((product) => {
    const code = String(product.stokKodu || '').trim();
    return (
      scopedCodes.has(code) &&
      productMatchesAssignedGroups(product, assignedGroupKeys, groupNameById)
    );
  });
  const requiredCodes = new Set(
    requiredProducts.map((product) => String(product.stokKodu || '').trim()),
  );

  const countedCodes = new Set<string>();
  periodSessions.forEach((session) => {
    (session.items || []).forEach((item) => {
      const code = String(item.stokKodu || '').trim();
      if (requiredCodes.has(code)) countedCodes.add(code);
    });
  });

  const latestSnapshotByCode = new Map<string, ProductSnapshot>();
  [...periodSessions]
    .sort((left, right) => getSessionTime(right) - getSessionTime(left))
    .forEach((session) => {
      aggregateSessionProducts(session).forEach((snapshot, code) => {
        if (requiredCodes.has(code) && !latestSnapshotByCode.has(code)) {
          latestSnapshotByCode.set(code, snapshot);
        }
      });
    });

  const rows = requiredProducts
    .map<LogisticsCountProductRow>((product) => {
      const code = String(product.stokKodu || '').trim();
      const snapshot = latestSnapshotByCode.get(code);
      const labGroups = resolveProductGroupNames(product, groupNameById);
      const fallbackSystemQuantity = Math.max(
        0,
        toSafeNumber(currentStockQuantityByCode.get(code)),
      );
      const systemQuantity = snapshot
        ? snapshot.systemQuantity
        : fallbackSystemQuantity;
      const countedQuantity = snapshot ? snapshot.countedQuantity : null;
      const packageValue = Math.max(1, toSafeNumber(product.ambalajDegeri) || 1);
      const computedTotalTests = snapshot
        ? snapshot.countedQuantity * packageValue +
          (snapshot.hasOpenTestQuantity ? snapshot.openTestQuantity : 0)
        : null;

      return {
        stokKodu: code,
        stokAdi: product.stokAdi || code,
        labGroups,
        labGroupLabel: labGroups.join(', ') || 'Grup yok',
        isCounted: countedCodes.has(code),
        countedQuantity,
        systemQuantity,
        difference:
          countedQuantity == null ? null : countedQuantity - systemQuantity,
        openTestQuantity:
          snapshot?.hasOpenTestQuantity ? snapshot.openTestQuantity : null,
        totalTests: snapshot
          ? snapshot.hasTotalTests
            ? snapshot.totalTests
            : computedTotalTests
          : null,
        latestSessionId: snapshot?.sessionId || null,
        countedAt: snapshot?.countedAt || null,
      };
    })
    .sort(
      (left, right) =>
        left.stokAdi.localeCompare(right.stokAdi, 'tr') ||
        left.stokKodu.localeCompare(right.stokKodu, 'tr'),
    );

  const requiredProductCount = rows.length;
  const countedProductCount = rows.filter((row) => row.isCounted).length;
  const countStatus: LogisticsCountStatus =
    requiredProductCount === 0
      ? 'not_applicable'
      : countedProductCount === 0
        ? 'not_started'
        : countedProductCount === requiredProductCount
          ? 'complete'
          : 'partial';

  return {
    id: labId,
    name: labName,
    countStatus,
    requiredProductCount,
    countedProductCount,
    sessionCount: periodSessions.length,
    kumulatifUploaded:
      hasExternalKumulatifUpload ||
      periodSessions.some((session) => session.kumulatifUploaded === true),
    cihazUstuUploaded:
      hasExternalCihazUstuUpload ||
      periodSessions.some((session) => session.cihazUstuUploaded === true),
    products: rows,
  };
}
