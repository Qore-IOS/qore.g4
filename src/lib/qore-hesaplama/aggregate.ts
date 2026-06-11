'use client';
// Hesaplama motorlarının birleştirme (aggregation) çekirdeği.
// Referans uygulamadaki davranış birebir korunmuştur.
import type { CumulativeRow } from './parse-cumulative';
import type { ReagentRow } from './parse-reagent';

/**
 * Kümülatif: test adına göre (TR-duyarsız, büyük harf anahtar) grupla ve tüm
 * sayısal alanları topla. Test adına göre alfabetik sıralı döner.
 */
export function aggregateCumulative(rows: CumulativeRow[]): CumulativeRow[] {
  const map = new Map<string, CumulativeRow>();
  for (const r of rows) {
    const key = r.test.trim().toUpperCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r, test: r.test.trim() });
    } else {
      map.set(key, {
        test: prev.test,
        routine: prev.routine + r.routine,
        rerun: prev.rerun + r.rerun,
        calib: prev.calib + r.calib,
        control: prev.control + r.control,
        total: prev.total + r.total,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.test.localeCompare(b.test, 'tr'));
}

export type AggregatedReagentRow = { test: string; available: number };

/**
 * Cihaz üstü: aynı test için "Available Tests" değeri her kartuş pozisyonunda
 * tekrar eder (modül toplamı). Mükerrer kontrolü için kaynak dosya bazında
 * BENZERSİZ available değerleri tutulur ve hepsi toplanır.
 */
export function aggregateReagent(rows: ReagentRow[]): AggregatedReagentRow[] {
  const byTest = new Map<string, { test: string; bySrc: Map<string, Set<number>> }>();
  for (const r of rows) {
    const testKey = r.test.trim().toUpperCase();
    let entry = byTest.get(testKey);
    if (!entry) {
      entry = { test: r.test.trim(), bySrc: new Map() };
      byTest.set(testKey, entry);
    }
    const srcKey = r.src || 'unknown';
    let set = entry.bySrc.get(srcKey);
    if (!set) {
      set = new Set<number>();
      entry.bySrc.set(srcKey, set);
    }
    set.add(r.available); // dosya başına benzersiz değer
  }
  const result: AggregatedReagentRow[] = [];
  for (const entry of byTest.values()) {
    let sum = 0;
    entry.bySrc.forEach((set) => set.forEach((v) => (sum += v)));
    result.push({ test: entry.test, available: sum });
  }
  return result.sort((a, b) => a.test.localeCompare(b.test, 'tr'));
}
