/**
 * Centralised robust query helper.
 *
 * Solves two recurring failure modes that previously required per-handler
 * patches:
 *
 *   1. **Composite index missing** — Firestore needs a composite index when
 *      a query combines multiple filters (especially with a range). If the
 *      index isn't deployed, the query throws FAILED_PRECONDITION.
 *      `robustQuery` catches this and progressively drops the lowest-priority
 *      filters from the Firestore query, applying them in memory instead.
 *
 *   2. **Status (or any equality) value mismatch** — the model may use an
 *      English alias ("closed") while the real Firestore value is in Turkish
 *      ("cozuldu"). Filters can be declared with `aliases: [...]` so the
 *      handler tries any of the equivalent values.
 *
 * Plus a third helpful behaviour: if the strict query returns empty but a
 * relaxed version returns rows that still satisfy the original filters (in
 * memory), we use the relaxed result. This means every handler effectively
 * gets a "if nothing found, try widening" pass for free.
 */

import type { Query, DocumentData, Firestore } from 'firebase-admin/firestore';
import { aiLogger } from '@/lib/logger';

export type FilterOp = '==' | '<=' | '>=' | '<' | '>' | '!=';

export interface RobustFilter {
  field: string;
  op?: FilterOp; // default '=='
  value: unknown;
  /** Equivalent values that should also satisfy this filter (any-of). */
  aliases?: unknown[];
  /**
   * Priority for the Firestore where-clause budget.
   *  - 'required' filters are NEVER dropped (e.g. security: companyId, labId).
   *  - Numbers ≤ 0 are highest priority; we drop high numbers first.
   *  - Default: 5.
   */
  priority?: number | 'required';
}

export interface RobustOptions {
  /** Max docs to fetch in any single Firestore request. */
  limit?: number;
  /** Optional ordering — dropped first if it causes index errors. */
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  /** If true, log the strategy taken for debugging. */
  debug?: boolean;
}

export interface RobustQueryResult {
  docs: Array<{ id: string; data: () => DocumentData }>;
  scanned: number;
  /** How we ended up running the query — useful for debugging. */
  strategy: 'strict' | 'partial' | 'memory' | 'memory-no-results';
}

/**
 * Run a query that tolerates missing composite indexes and value mismatches.
 *
 * Implementation:
 *   - First try ALL filters as Firestore where + aliases via `in` if size ≤ 10.
 *   - If FAILED_PRECONDITION OR empty result: drop the lowest-priority
 *     non-required filter, retry.
 *   - Continue until success or only required filters remain.
 *   - In all cases, apply ALL original filters in memory after retrieval to
 *     guarantee correctness.
 */
export async function robustQuery(
  db: Firestore,
  collection: string,
  filters: RobustFilter[],
  options: RobustOptions = {},
): Promise<RobustQueryResult> {
  const limit = options.limit ?? 500;
  const debug = !!options.debug;
  const tagged = filters.map((f) => ({
    ...f,
    op: f.op ?? '==',
    priorityNum: f.priority === 'required' ? -Infinity : (typeof f.priority === 'number' ? f.priority : 5),
    isRequired: f.priority === 'required',
  }));

  // Try strategies in order: full → drop one filter at a time → only required
  // and orderBy. We use the original filter set in memory after each query.
  const candidates: Array<typeof tagged> = [];
  candidates.push([...tagged]);
  const removable = tagged.filter((f) => !f.isRequired).sort((a, b) => b.priorityNum - a.priorityNum);
  // For each removable filter (highest priority dropped first), create a candidate
  // that drops it (and all higher-priority drops below it).
  for (let i = 0; i < removable.length; i++) {
    const drop = new Set(removable.slice(0, i + 1).map((f) => f.field + '|' + String(f.op)));
    candidates.push(tagged.filter((f) => !drop.has(f.field + '|' + String(f.op))));
  }
  // Final attempt: only required filters.
  const onlyRequired = tagged.filter((f) => f.isRequired);
  if (onlyRequired.length > 0 && onlyRequired.length < tagged.length) candidates.push(onlyRequired);

  // Deduplicate candidate sets
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = c.map((f) => f.field + '|' + String(f.op)).sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let bestRows: Array<{ id: string; data: () => DocumentData }> = [];
  let bestScanned = 0;
  let bestStrategy: RobustQueryResult['strategy'] = 'memory-no-results';

  for (let i = 0; i < unique.length; i++) {
    const set = unique[i];
    const isStrict = i === 0;
    try {
      let q: Query<DocumentData> = db.collection(collection);
      for (const f of set) {
        const op = f.op as FilterOp;
        // Use `in` if we have aliases (server-side OR). Firestore allows up to
        // 30 values per `in` (was 10 historically; new SDKs raised it).
        if (op === '==' && Array.isArray(f.aliases) && f.aliases.length > 0) {
          const values = uniqueValues([f.value, ...f.aliases]);
          if (values.length === 1) q = q.where(f.field, '==', values[0]);
          else if (values.length <= 30) q = q.where(f.field, 'in', values);
          else q = q.where(f.field, '==', f.value); // too many — fall back; memory filter will catch
        } else {
          q = q.where(f.field, op, f.value as never);
        }
      }
      // Only use orderBy on the strict attempt — relaxing assumes we don't
      // have the right composite index.
      if (isStrict && options.orderBy) q = q.orderBy(options.orderBy, options.orderDir ?? 'desc');

      const snap = await q.limit(limit).get();
      const rows = applyMemoryFilters(snap.docs, tagged);
      if (debug) aiLogger.debug(`[robustQuery ${collection}] candidate ${i}/${unique.length} → ${snap.size} docs, ${rows.length} after memory filter`);
      if (rows.length > 0) {
        return {
          docs: rows,
          scanned: snap.size,
          strategy: isStrict ? 'strict' : (set.length === tagged.length ? 'partial' : 'partial'),
        };
      }
      // Keep best (largest scanned) as a fallback
      if (snap.size > bestScanned) {
        bestRows = rows;
        bestScanned = snap.size;
        bestStrategy = isStrict ? 'strict' : 'partial';
      }
    } catch (e) {
      if (isMissingIndexError(e)) {
        if (debug) aiLogger.debug(`[robustQuery ${collection}] candidate ${i} index missing, relaxing`);
        continue; // try next, fewer filters
      }
      // Other errors propagate to caller (rare — usually permission denied)
      throw e;
    }
  }

  return {
    docs: bestRows,
    scanned: bestScanned,
    strategy: bestStrategy,
  };
}

function applyMemoryFilters(
  docs: Array<{ id: string; data: () => DocumentData }>,
  filters: Array<{ field: string; op: FilterOp; value: unknown; aliases?: unknown[] }>,
): Array<{ id: string; data: () => DocumentData }> {
  return docs.filter((doc) => {
    const d = doc.data();
    for (const f of filters) {
      const v = readPath(d, f.field);
      if (!matchesFilter(v, f.op, f.value, f.aliases)) return false;
    }
    return true;
  });
}

function readPath(obj: DocumentData, path: string): unknown {
  if (!path.includes('.')) return obj[path];
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

function matchesFilter(value: unknown, op: FilterOp, target: unknown, aliases?: unknown[]): boolean {
  const candidates = uniqueValues([target, ...(aliases ?? [])]);
  const compare = (a: unknown, b: unknown): number => {
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    // Timestamps from firestore have a toMillis()
    const am = toMillis(a);
    const bm = toMillis(b);
    if (am !== null && bm !== null) return am - bm;
    return String(a).localeCompare(String(b));
  };
  switch (op) {
    case '==': return candidates.some((c) => deepEqual(value, c));
    case '!=': return !candidates.some((c) => deepEqual(value, c));
    case '<':  return compare(value, target) < 0;
    case '<=': return compare(value, target) <= 0;
    case '>':  return compare(value, target) > 0;
    case '>=': return compare(value, target) >= 0;
    default:   return true;
  }
}

function toMillis(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  const t = v as { toMillis?: () => number; toDate?: () => Date };
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?.toDate === 'function') return t.toDate().getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) {
    // Coerce primitives where it makes sense (e.g. boolean comparisons)
    return String(a) === String(b);
  }
  return false;
}

function uniqueValues(arr: unknown[]): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const key = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function isMissingIndexError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  if (code === 9 || code === 'FAILED_PRECONDITION') return true;
  const msg = error instanceof Error ? error.message : '';
  return /requires an index|composite|index.*build|index.*missing/i.test(msg);
}
