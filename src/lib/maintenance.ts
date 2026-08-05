import type { MaintenanceLog, MaintenancePlan, TimestampLike } from './types';

export type BakimTakipStatus = 'guncel' | 'uyari' | 'kritik' | 'bakim_yok' | 'plansiz';

export interface BakimTakipPlanStatus {
  plan: MaintenancePlan;
  lastLog?: MaintenanceLog;
  status: BakimTakipStatus;
  daysSinceLast: number | null;
  daysRemaining: number | null;
  nextDueDate: Date | null;
}

export interface BakimTakipDeviceStatus {
  status: BakimTakipStatus;
  worstPlan?: BakimTakipPlanStatus;
  planStatuses: BakimTakipPlanStatus[];
  lastCompletedAt: Date | null;
  nextDueDate: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STATUS_RANK: Record<BakimTakipStatus, number> = {
  guncel: 0,
  uyari: 1,
  kritik: 2,
  bakim_yok: 3,
  plansiz: -1,
};

export const BAKIM_TAKIP_SOURCE_DEFINITIONS = [
  { taskName: 'Bakım Kiti', deviceCategory: 'Biyokimya', type: 'teknik_servis', periodValue: 60, periodUnit: 'gun' },
  { taskName: 'Dekon Yapıldı', deviceCategory: 'Biyokimya', type: 'aplikasyon', periodValue: 60, periodUnit: 'gun' },
  { taskName: 'Vacuum Tank', deviceCategory: 'ISE', type: 'teknik_servis', periodValue: 60, periodUnit: 'gun' },
  { taskName: 'Bidon Temizliği', deviceCategory: 'Biyokimya', type: 'teknik_servis', periodValue: 60, periodUnit: 'gun' },
] as const;

export function toDateSafe(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const parsed = value.toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  return null;
}

export function periodToDays(plan: Pick<MaintenancePlan, 'periodValue' | 'periodUnit'>): number {
  const value = Number(plan.periodValue || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (plan.periodUnit === 'hafta') return value * 7;
  if (plan.periodUnit === 'ay') return value * 30;
  if (plan.periodUnit === 'yil') return value * 365;
  return value;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffDays(a: Date, b: Date): number {
  return Math.ceil((startOfLocalDay(a).getTime() - startOfLocalDay(b).getTime()) / DAY_MS);
}

export function getMaintenanceLogDate(log?: MaintenanceLog): Date | null {
  return toDateSafe(log?.completedAt);
}

export function calculatePlanStatus(
  plan: MaintenancePlan,
  logs: readonly MaintenanceLog[],
  now: Date = new Date(),
): BakimTakipPlanStatus {
  const relatedLogs = logs
    .filter((log) => log.planId === plan.id || (log.deviceId === plan.deviceId && log.taskName === plan.taskName))
    .map((log) => ({ log, completedAt: getMaintenanceLogDate(log) }))
    .filter((item): item is { log: MaintenanceLog; completedAt: Date } => Boolean(item.completedAt))
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

  const last = relatedLogs[0];
  if (!last) {
    return { plan, status: 'bakim_yok', daysSinceLast: null, daysRemaining: null, nextDueDate: null };
  }

  const periodDays = periodToDays(plan);
  const explicitNextDue = toDateSafe(last.log.nextDueDate);
  const nextDueDate = explicitNextDue ?? (periodDays > 0 ? new Date(last.completedAt.getTime() + periodDays * DAY_MS) : null);
  const daysSinceLast = diffDays(now, last.completedAt);
  const daysRemaining = nextDueDate ? diffDays(nextDueDate, now) : null;
  const warningWindow = Math.max(7, Math.ceil((periodDays || 30) * 0.2));

  let status: BakimTakipStatus = 'guncel';
  if (daysRemaining !== null && daysRemaining < 0) status = 'kritik';
  else if (daysRemaining !== null && daysRemaining <= warningWindow) status = 'uyari';

  return { plan, lastLog: last.log, status, daysSinceLast, daysRemaining, nextDueDate };
}

export function calculateDeviceMaintenanceStatus(
  plans: readonly MaintenancePlan[],
  logs: readonly MaintenanceLog[],
  now: Date = new Date(),
): BakimTakipDeviceStatus {
  if (plans.length === 0) {
    return { status: 'plansiz', planStatuses: [], lastCompletedAt: null, nextDueDate: null };
  }

  const planStatuses = plans.map((plan) => calculatePlanStatus(plan, logs, now));
  const worstPlan = [...planStatuses].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0];
  const lastCompletedAt = planStatuses
    .map((item) => getMaintenanceLogDate(item.lastLog))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const nextDueDate = planStatuses
    .map((item) => item.nextDueDate)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return { status: worstPlan?.status ?? 'plansiz', worstPlan, planStatuses, lastCompletedAt, nextDueDate };
}

export function getBakimTakipStatusLabel(status: BakimTakipStatus): string {
  switch (status) {
    case 'guncel': return 'Güncel';
    case 'uyari': return 'Uyarı';
    case 'kritik': return 'Kritik';
    case 'bakim_yok': return 'Bakım Yok';
    case 'plansiz': return 'Plansız';
  }
}
