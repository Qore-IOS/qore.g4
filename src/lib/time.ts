// src/lib/time.ts
import { Timestamp } from './data/client';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

// Accept anything we see in Firestore/UI code
export type FireSecondsObject = { seconds: number; nanoseconds?: number };
export type FireToDateObject = { toDate: () => Date; seconds: number; nanoseconds: number };

export type TimestampLike =
  | Date
  | Timestamp
  | string
  | number
  | FireSecondsObject
  | FireToDateObject
  | null
  | undefined;

function tryParseStringDate(s: string): Date | null {
  const t = s.trim();
  // ISO
  const iso = Date.parse(t);
  if (!Number.isNaN(iso)) return new Date(iso);
  // dd.MM.yyyy
  const m1 = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m1) {
    const d = Number(m1[1]), m = Number(m1[2]) - 1, y = Number(m1[3]);
    const dt = new Date(y, m, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  // MM/yyyy (ayı son gününe ayarla)
  const m2 = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m2) {
    const m = Number(m2[1]) - 1, y = Number(m2[2]);
    const dt = new Date(y, m + 1, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

export function toDateFromAny(value: TimestampLike): Date | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value instanceof Timestamp) {
    const dt = value.toDate();
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (typeof value === 'number') {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (typeof value === 'string') {
    return tryParseStringDate(value);
  }

  // Plain object varyasyonları
  const anyVal = value as any;
  try {
    if (typeof anyVal?.toDate === 'function') {
      const dt = anyVal.toDate();
      return dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt : null;
    }
    if (typeof anyVal?.seconds === 'number') {
      const millis = anyVal.seconds * 1000;
      const dt = new Date(millis);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
  } catch {
    // yut
  }
  return null;
}

export function formatTimestamp(value: TimestampLike, fmt = 'dd.MM.yyyy'): string | null {
  const dt = toDateFromAny(value);
  return dt ? format(dt, fmt, { locale: tr }) : null;
}

// Takvim karşılaştırmaları için
export function safeCompareByMiad(a: TimestampLike, b: TimestampLike): number {
  const da = toDateFromAny(a);
  const db = toDateFromAny(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da.getTime() - db.getTime();
}

// Geriye dönük isim
export const parseMiad = toDateFromAny;
