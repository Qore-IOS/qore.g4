/**
 * useDateRangeFilter — Tarih aralığı filtresi için merkezi hook.
 *
 * Faz 1 performans optimizasyonu kapsamında eklendi. Büyük geçmiş/rapor
 * panellerinin tüm koleksiyonu indirmesini engellemek için varsayılan
 * 90 günlük pencere sağlar; kullanıcı isterse genişletebilir.
 *
 * Kullanım:
 *   const { range, setRange, constraints } = useDateRangeFilter({
 *     defaultDays: 90,
 *     storageKey: 'ariza-istatistik:range',
 *   });
 *   const q = scopedQuery(
 *     'deviceFaultReports', currentCompanyId, isSuperAdmin,
 *     ...constraints('openedAt'),
 *     orderBy('openedAt', 'desc'),
 *     limit(500),
 *   );
 */
'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Timestamp, where, type QueryConstraint } from 'firebase/firestore';
import type { DateRange } from 'react-day-picker';
import { addDays, startOfDay, endOfDay } from 'date-fns';

export interface UseDateRangeFilterOptions {
  /** Varsayılan pencere uzunluğu (gün). Varsayılan: 90. */
  defaultDays?: number;
  /**
   * localStorage anahtarı — verilirse kullanıcının son seçimi kalıcı olur.
   * Multi-tenant için panel/firma başına ayrı anahtar kullanın.
   */
  storageKey?: string;
  /**
   * `null` / `undefined` döndürebilen aralık; "tüm zaman" seçildiğinde
   * `range` undefined olur ve `constraints()` boş dizi döndürür.
   */
  allowAll?: boolean;
}

function loadStoredRange(key: string | undefined): DateRange | undefined {
  if (!key || typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { from?: string; to?: string } | null;
    if (!parsed?.from || !parsed?.to) return undefined;
    const from = new Date(parsed.from);
    const to = new Date(parsed.to);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return undefined;
    return { from, to };
  } catch {
    return undefined;
  }
}

function persistRange(key: string | undefined, range: DateRange | undefined) {
  if (!key || typeof window === 'undefined') return;
  try {
    if (!range?.from || !range?.to) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({ from: range.from.toISOString(), to: range.to.toISOString() }),
    );
  } catch {
    // localStorage quota aşımı sessiz tolere edilir.
  }
}

export function useDateRangeFilter(options: UseDateRangeFilterOptions = {}) {
  const { defaultDays = 90, storageKey, allowAll = true } = options;

  const defaultRange = useMemo<DateRange>(() => {
    const now = new Date();
    return { from: addDays(now, -(defaultDays - 1)), to: now };
  }, [defaultDays]);

  const [range, setRangeState] = useState<DateRange | undefined>(() => {
    return loadStoredRange(storageKey) ?? defaultRange;
  });

  useEffect(() => {
    persistRange(storageKey, range);
  }, [range, storageKey]);

  const setRange = useCallback((next: DateRange | undefined) => {
    if (!allowAll && !next) {
      setRangeState(defaultRange);
      return;
    }
    setRangeState(next);
  }, [allowAll, defaultRange]);

  /**
   * Firestore `where(field, '>=', from)` + `where(field, '<=', to)` üretir.
   * `range` undefined ise (tüm zaman) boş dizi döner; çağıran sorgu
   * o zaman tarih filtresiz çalışır.
   */
  const constraints = useCallback((fieldPath: string): QueryConstraint[] => {
    if (!range?.from || !range?.to) return [];
    return [
      where(fieldPath, '>=', Timestamp.fromDate(startOfDay(range.from))),
      where(fieldPath, '<=', Timestamp.fromDate(endOfDay(range.to))),
    ];
  }, [range]);

  const reset = useCallback(() => setRangeState(defaultRange), [defaultRange]);

  return { range, setRange, constraints, reset, defaultRange };
}
