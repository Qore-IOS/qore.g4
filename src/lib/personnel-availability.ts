import { Timestamp } from 'firebase/firestore';

export type PersonnelAvailabilityType = 'office' | 'training';

export interface PersonnelAvailabilityRecord {
  id: string;
  uid: string;
  type: PersonnelAvailabilityType;
  description: string;
  startAt: Date;
  endAt: Date;
  createdAt?: Date | null;
  createdByUid?: string | null;
}

export function toDateValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isDateInRange(date: Date, startAt: Date, endAt: Date): boolean {
  return date.getTime() >= startAt.getTime() && date.getTime() <= endAt.getTime();
}

export function isUnavailableAt(
  intervals: PersonnelAvailabilityRecord[],
  at: Date,
): boolean {
  return intervals.some((item) => isDateInRange(at, item.startAt, item.endAt));
}
