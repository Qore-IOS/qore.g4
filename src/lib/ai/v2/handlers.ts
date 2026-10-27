/**
 * Tool handlers — actual Firestore queries.
 *
 * Every handler is permission-aware: it filters by companyId, assigned labs,
 * assigned depots and brand. Handlers MUST never return data the user isn't
 * allowed to see.
 */

import { adminDb } from '../../data/admin';
import type { Query, DocumentData, Timestamp } from '../../data/admin';
import { aiLogger } from '@/lib/logger';
import type { PermissionContext, ToolCallResult } from './types';
import {
  canSeeBrand,
  canSeeDepot,
  canSeeLab,
} from './permissions';
import { createShortcutDraft } from '@/lib/shortcuts/draft';
import { SHORTCUT_CATALOG } from '@/lib/shortcuts/catalog';
import {
  getHospitalById,
  getProductByCode,
  listHospitalsForContext,
  resolveDevices,
  resolveHospitals,
  resolveProducts,
} from './resolver';


export async function createShortcutDraftTool(
  args: { text?: string; accessibleViews?: string[] },
  _ctx: PermissionContext,
): Promise<ToolCallResult> {
  const text = String(args.text || '').trim();
  if (!text) return { ok: false, label: 'create_shortcut_draft', data: null, notice: 'Taslak için metin gerekli.' };
  const accessibleViews = Array.isArray(args.accessibleViews) && args.accessibleViews.length > 0
    ? args.accessibleViews
    : SHORTCUT_CATALOG.map((panel) => String(panel.requiredView));
  const draft = createShortcutDraft({ text, accessibleViews });
  if (!draft) {
    return { ok: true, label: 'create_shortcut_draft', data: null, notice: 'Bu ifade desteklenen bir kestirme taslağına eşlenemedi.' };
  }
  return {
    ok: true,
    label: 'create_shortcut_draft',
    data: draft,
    notice: 'Sadece taslak döndürüldü; gerçek kestirme kaydı oluşturulmadı.',
  };
}

function tsToISO(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const ts = value as Timestamp;
  if (typeof ts?.toDate === 'function') return ts.toDate().toISOString();
  if (typeof value === 'string') return value;
  return undefined;
}

function tsToShort(value: unknown): string | undefined {
  const iso = tsToISO(value);
  return iso ? iso.slice(0, 10) : undefined;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function inDaysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function applyCompanyScope(q: Query<DocumentData>, ctx: PermissionContext): Query<DocumentData> {
  if (!ctx.companyId) return q;
  // For super_admin we don't restrict by company.
  if (ctx.isSuperAdmin) return q;
  return q.where('companyId', '==', ctx.companyId);
}

function err(label: string, error: unknown): ToolCallResult {
  const code = (error as { code?: number | string })?.code;
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  aiLogger.warn(`tool error: ${label}`, { code, message });
  if (code === 7 || code === 'PERMISSION_DENIED') {
    return { ok: false, label, data: null, notice: 'Yetki reddedildi.' };
  }
  if (code === 5 || code === 'NOT_FOUND') {
    return { ok: false, label, data: null, notice: 'Veri kaynağı bulunamadı.' };
  }
  if (code === 9 || code === 'FAILED_PRECONDITION' || /requires an index|index.*build|composite/i.test(message)) {
    return {
      ok: false,
      label,
      data: null,
      notice: 'Bu sorgu için Firestore composite index eksik. Daha basit filtre veya alternatif tool dene.',
    };
  }
  return { ok: false, label, data: null, notice: message };
}

/** Detect "missing index" errors so callers can decide to fall back. */
function isMissingIndexError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  if (code === 9 || code === 'FAILED_PRECONDITION') return true;
  const msg = error instanceof Error ? error.message : '';
  return /requires an index|composite|index.*build/i.test(msg);
}

/* ----------------------------------------------------------------------- */
/* Robust list helper — central pattern used by every list-style handler   */
/* ----------------------------------------------------------------------- */

import { robustQuery, type RobustFilter } from './query';
import { aliasedFilter, expandAlias } from './aliases';

/** Backward-compat status normalization (kept for explicit lookups). */
function normaliseFaultStatus(input?: string): string[] | null {
  if (!input || input === 'all') return null;
  const expanded = expandAlias('deviceFaultReports', 'status', input);
  return expanded.length > 0 ? (expanded as string[]) : null;
}

/**
 * Add a where-clause with automatic alias expansion.
 * If the value has aliases registered (e.g. "closed" → ["cozuldu","closed"]),
 * uses Firestore `in` (server-side OR) so any equivalent value matches.
 */
function whereAliased(
  q: Query<DocumentData>,
  collection: string,
  field: string,
  value: unknown,
): Query<DocumentData> {
  if (value === undefined || value === null || value === 'all') return q;
  const candidates = expandAlias(collection, field, value);
  if (candidates.length === 1) return q.where(field, '==', candidates[0] as never);
  if (candidates.length <= 30) return q.where(field, 'in', candidates as never);
  return q.where(field, '==', value as never);
}

/**
 * Try a Firestore query; if it fails with FAILED_PRECONDITION (missing
 * composite index) OR returns empty, fall back to a "loose" version that
 * keeps only the named "required" filters and applies the rest in memory.
 *
 * This is the universal escape hatch — any handler can wrap its query in
 * `tryWithFallback` to get index-error resilience and empty-result widening
 * without rewriting the handler logic.
 */
async function tryWithFallback<T>(
  strict: () => Promise<{ docs: Array<{ id: string; data(): DocumentData }>; size: number }>,
  loose: () => Promise<{ docs: Array<{ id: string; data(): DocumentData }>; size: number }>,
  applyMemoryFilters: (doc: DocumentData) => boolean,
  shape: (doc: DocumentData, id: string) => T,
): Promise<{ rows: T[]; scanned: number }> {
  // 1. Strict attempt
  let snap: Awaited<ReturnType<typeof strict>> | null = null;
  try {
    snap = await strict();
  } catch (e) {
    if (!isMissingIndexError(e)) throw e;
  }
  if (snap) {
    const rows: T[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!applyMemoryFilters(data)) continue;
      rows.push(shape(data, doc.id));
    }
    if (rows.length > 0) return { rows, scanned: snap.size };
  }
  // 2. Loose attempt (with in-memory filter on the broader result set)
  const looseSnap = await loose();
  const rows: T[] = [];
  for (const doc of looseSnap.docs) {
    const data = doc.data();
    if (!applyMemoryFilters(data)) continue;
    rows.push(shape(data, doc.id));
  }
  return { rows, scanned: looseSnap.size };
}

interface ListHandlerSpec<T> {
  label: string;
  collection: string;
  /** Required scope (companyId, labId) — never dropped by robustQuery. */
  scope: RobustFilter[];
  /** Optional filters in priority order (highest first). */
  filters: RobustFilter[];
  /** orderBy field (dropped automatically if index error). */
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  limit?: number;
  /** Permission-aware row filter (defense in depth). */
  rowGuard?: (data: DocumentData) => boolean;
  /** Shape the row for the model (small object, no PII bloat). */
  shape: (data: DocumentData, id: string) => T;
  /** Optional alternate noticeWhenEmpty (default "kayıt yok"). */
  emptyNotice?: string;
}

/**
 * Generic robust list runner. Use this for ANY handler that:
 *   - lists documents from a collection
 *   - has scope filters (companyId / lab / depot) that MUST be applied
 *   - has optional model-supplied filters (status, days, faultType, …) that
 *     should auto-relax under index errors or empty results
 *   - needs to shape the rows + apply rowGuard
 */
async function runList<T>(spec: ListHandlerSpec<T>): Promise<ToolCallResult> {
  try {
    const allFilters: RobustFilter[] = [...spec.scope, ...spec.filters];
    const result = await robustQuery(adminDb, spec.collection, allFilters, {
      limit: spec.limit ?? 500,
      orderBy: spec.orderBy,
      orderDir: spec.orderDir,
    });
    const shaped: T[] = [];
    for (const doc of result.docs) {
      const data = doc.data();
      if (spec.rowGuard && !spec.rowGuard(data)) continue;
      shaped.push(spec.shape(data, doc.id));
    }
    return {
      ok: true,
      label: spec.label,
      data: shaped,
      scanned: result.scanned,
      notice: shaped.length === 0 ? (spec.emptyNotice ?? 'Kayıt yok.') : undefined,
    };
  } catch (e) {
    return err(spec.label, e);
  }
}

/** Build a scope filter list common to most handlers. */
function commonScope(ctx: PermissionContext, opts: { labField?: string; labId?: string; depotField?: string; depotId?: string } = {}): RobustFilter[] {
  const out: RobustFilter[] = [];
  // CompanyId is required for non-superadmins (security).
  if (ctx.companyId && !ctx.isSuperAdmin) {
    out.push({ field: 'companyId', value: ctx.companyId, priority: 'required' });
  }
  if (opts.labId && opts.labField) {
    out.push({ field: opts.labField, value: opts.labId, priority: 'required' });
  }
  if (opts.depotId && opts.depotField) {
    out.push({ field: opts.depotField, value: opts.depotId, priority: 'required' });
  }
  return out;
}

/* ----------------------------------------------------------------------- */
/* resolve_entities                                                        */
/* ----------------------------------------------------------------------- */

export async function resolveEntities(
  args: { hospitals_query?: string; products_query?: string; devices_query?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  const limit = args.limit ?? 5;
  try {
    const [hospitals, products, devices] = await Promise.all([
      args.hospitals_query ? resolveHospitals(args.hospitals_query, ctx, { limit }) : Promise.resolve([]),
      args.products_query ? resolveProducts(args.products_query, ctx, { limit }) : Promise.resolve([]),
      args.devices_query ? resolveDevices(args.devices_query, ctx, { limit }) : Promise.resolve([]),
    ]);

    const notice = (() => {
      const missing: string[] = [];
      if (args.hospitals_query && hospitals.length === 0) missing.push(`hastane "${args.hospitals_query}"`);
      if (args.products_query && products.length === 0) missing.push(`ürün "${args.products_query}"`);
      if (args.devices_query && devices.length === 0) missing.push(`cihaz "${args.devices_query}"`);
      return missing.length > 0
        ? `Bulunamayan: ${missing.join(', ')}. Kullanıcıdan netleştirme iste.`
        : undefined;
    })();

    return {
      ok: true,
      label: 'resolve_entities',
      data: { hospitals, products, devices },
      notice,
    };
  } catch (e) {
    return err('resolve_entities', e);
  }
}

/* ----------------------------------------------------------------------- */
/* list_hospitals                                                          */
/* ----------------------------------------------------------------------- */

export async function listHospitals(_args: unknown, ctx: PermissionContext): Promise<ToolCallResult> {
  try {
    const hospitals = await listHospitalsForContext(ctx);
    return {
      ok: true,
      label: 'list_hospitals',
      data: hospitals.map((h) => ({ id: h.id, name: h.name, kod: h.kod ?? null })),
      scanned: hospitals.length,
    };
  } catch (e) {
    return err('list_hospitals', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_product_definition                                                  */
/* ----------------------------------------------------------------------- */

export async function getProductDefinition(
  args: { stokKodu?: string; searchText?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (args.stokKodu) {
      const prod = await getProductByCode(args.stokKodu);
      if (!prod) {
        return {
          ok: true,
          label: 'get_product_definition',
          data: null,
          notice: `${args.stokKodu} kodlu ürün bulunamadı.`,
        };
      }
      if (!canSeeBrand(ctx, prod.marka)) {
        return { ok: false, label: 'get_product_definition', data: null, notice: 'Marka yetkin dışında.' };
      }
      return { ok: true, label: 'get_product_definition', data: prod };
    }
    if (args.searchText) {
      const matches = await resolveProducts(args.searchText, ctx, { limit: 5 });
      return {
        ok: true,
        label: 'get_product_definition',
        data: matches,
        notice: matches.length === 0 ? 'Ürün bulunamadı.' : undefined,
      };
    }
    return { ok: false, label: 'get_product_definition', data: null, notice: 'stokKodu veya searchText gerekli.' };
  } catch (e) {
    return err('get_product_definition', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_lab_stock                                                           */
/* ----------------------------------------------------------------------- */

interface StockAggregate {
  stokKodu: string;
  stokAdi: string;
  urunGrubu?: string;
  lotNumarasi?: string;
  miad?: string;
  adet: number;
}

export async function getLabStock(
  args: { hospitalId: string; stokKodu?: string; urunGrubu?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  if (!args.hospitalId) {
    return { ok: false, label: 'get_lab_stock', data: null, notice: 'hospitalId zorunlu.' };
  }
  if (!canSeeLab(ctx, args.hospitalId)) {
    return { ok: false, label: 'get_lab_stock', data: null, notice: 'Bu laboratuvara erişim yetkin yok.' };
  }
  const hospital = await getHospitalById(args.hospitalId);
  if (!hospital) {
    return { ok: false, label: 'get_lab_stock', data: null, notice: 'Hastane bulunamadı.' };
  }

  const filterDoc = (d: DocumentData): boolean => {
    if (args.urunGrubu && d.urunGrubu !== args.urunGrubu) return false;
    if (args.stokKodu && d.stokKodu !== args.stokKodu) return false;
    if (d.isShipped !== true) return false;
    if (d.hedefKurumId !== args.hospitalId) return false;
    if (!canSeeBrand(ctx, d.marka)) return false;
    return true;
  };

  const aggregate = (docs: Array<{ data(): DocumentData }>): StockAggregate[] => {
    const agg: Record<string, StockAggregate> = {};
    for (const doc of docs) {
      const d = doc.data();
      if (!filterDoc(d)) continue;
      const key = `${d.stokKodu}|${d.lotNumarasi ?? '-'}|${tsToShort(d.miad) ?? '-'}`;
      if (!agg[key]) {
        agg[key] = {
          stokKodu: d.stokKodu,
          stokAdi: d.stokAdi,
          urunGrubu: d.urunGrubu,
          lotNumarasi: d.lotNumarasi,
          miad: tsToShort(d.miad),
          adet: 0,
        };
      }
      agg[key].adet += 1;
    }
    return Object.values(agg).sort((a, b) => {
      if (a.stokKodu !== b.stokKodu) return a.stokKodu.localeCompare(b.stokKodu);
      return (a.miad ?? '').localeCompare(b.miad ?? '');
    });
  };

  async function runStrict() {
    let q: Query<DocumentData> = adminDb.collection('depoStok')
      .where('isShipped', '==', true)
      .where('hedefKurumId', '==', args.hospitalId);
    q = applyCompanyScope(q, ctx);
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);
    const snap = await q.limit(args.limit ?? 500).get();
    return { lots: aggregate(snap.docs), scanned: snap.size };
  }

  async function runFallback() {
    // Most robust: query only by hedefKurumId (single equality, no index needed)
    const q = adminDb.collection('depoStok').where('hedefKurumId', '==', args.hospitalId).limit(args.limit ?? 2000);
    const snap = await q.get();
    return { lots: aggregate(snap.docs), scanned: snap.size };
  }

  try {
    let result;
    try {
      result = await runStrict();
      if (result.lots.length === 0) {
        const fb = await runFallback();
        if (fb.lots.length > 0) result = fb;
      }
    } catch (e) {
      if (isMissingIndexError(e)) {
        result = await runFallback();
      } else {
        throw e;
      }
    }

    const totals: Record<string, { stokKodu: string; stokAdi: string; toplamAdet: number; lotSayisi: number }> = {};
    for (const l of result.lots) {
      const t = totals[l.stokKodu] ?? { stokKodu: l.stokKodu, stokAdi: l.stokAdi, toplamAdet: 0, lotSayisi: 0 };
      t.toplamAdet += l.adet;
      t.lotSayisi += 1;
      totals[l.stokKodu] = t;
    }

    return {
      ok: true,
      label: 'get_lab_stock',
      data: {
        hospital: { id: hospital.id, name: hospital.name },
        totals: Object.values(totals).sort((a, b) => b.toplamAdet - a.toplamAdet),
        lots: result.lots.slice(0, 100),
        lotCount: result.lots.length,
      },
      scanned: result.scanned,
      notice: result.lots.length === 0 ? 'Bu lab için kayıt bulunamadı.' : undefined,
    };
  } catch (e) {
    return err('get_lab_stock', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_depot_stock                                                         */
/* ----------------------------------------------------------------------- */

export async function getDepotStock(
  args: { depotId?: string; stokKodu?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('depoStok').where('isShipped', '==', false);
    q = applyCompanyScope(q, ctx);
    if (args.depotId) {
      if (!canSeeDepot(ctx, args.depotId)) {
        return { ok: false, label: 'get_depot_stock', data: null, notice: 'Bu depoya yetkin yok.' };
      }
      q = q.where('depotId', '==', args.depotId);
    }
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);

    const snap = await q.limit(args.limit ?? 1000).get();
    const agg: Record<string, { depotId?: string; depotName?: string; stokKodu: string; stokAdi: string; lotNumarasi?: string; miad?: string; adet: number }> = {};
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!canSeeDepot(ctx, d.depotId)) continue;
      if (!canSeeBrand(ctx, d.marka)) continue;
      const key = `${d.depotId}|${d.stokKodu}|${d.lotNumarasi ?? '-'}|${tsToShort(d.miad) ?? '-'}`;
      if (!agg[key]) {
        agg[key] = {
          depotId: d.depotId,
          depotName: d.depotName,
          stokKodu: d.stokKodu,
          stokAdi: d.stokAdi,
          lotNumarasi: d.lotNumarasi,
          miad: tsToShort(d.miad),
          adet: 0,
        };
      }
      agg[key].adet += 1;
    }
    const rows = Object.values(agg).sort((a, b) => b.adet - a.adet);
    return {
      ok: true,
      label: 'get_depot_stock',
      data: rows.slice(0, 200),
      scanned: snap.size,
      notice: rows.length === 0 ? 'Depoda eşleşen kayıt yok.' : undefined,
    };
  } catch (e) {
    return err('get_depot_stock', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_min_max_rules                                                       */
/* ----------------------------------------------------------------------- */

export async function getMinMaxRules(
  args: { hospitalId: string; stokKodu?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_min_max_rules', data: null, notice: 'Lab yetkin dışında.' };
    }
    const snap = await adminDb
      .collection('hospitals')
      .doc(args.hospitalId)
      .collection('minMaxRules')
      .get();
    const rows: Array<{ stokKodu: string; min?: number; max?: number; raw: DocumentData }> = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      const stokKodu = d.stokKodu || doc.id;
      if (args.stokKodu && stokKodu !== args.stokKodu) continue;
      rows.push({
        stokKodu,
        min: typeof d.min === 'number' ? d.min : undefined,
        max: typeof d.max === 'number' ? d.max : undefined,
        raw: d,
      });
    }
    return {
      ok: true,
      label: 'get_min_max_rules',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Bu lab için kural tanımlı değil.' : undefined,
    };
  } catch (e) {
    return err('get_min_max_rules', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_consumption                                                         */
/* ----------------------------------------------------------------------- */

export async function getConsumption(
  args: { hospitalId?: string; stokKodu?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const days = args.days ?? 30;
    if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_consumption', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('tuketimKayitlari')
      .where('consumptionTimestamp', '>=', daysAgo(days));
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) q = q.where('laboratoryId', '==', args.hospitalId);
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);

    const snap = await q.limit(args.limit ?? 1500).get();

    // Group by hospital × product
    const agg: Record<string, { laboratoryId: string; laboratoryName: string; stokKodu: string; stokAdi: string; toplamMiktar: number; kayitSayisi: number; sonTarih?: string }> = {};
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!canSeeLab(ctx, d.laboratoryId)) continue;
      const key = `${d.laboratoryId}|${d.stokKodu}`;
      const ambalaj = typeof d.ambalajDegeri === 'number' && d.ambalajDegeri > 0 ? d.ambalajDegeri : 1;
      if (!agg[key]) {
        agg[key] = {
          laboratoryId: d.laboratoryId,
          laboratoryName: d.laboratoryName,
          stokKodu: d.stokKodu,
          stokAdi: d.stokAdi,
          toplamMiktar: 0,
          kayitSayisi: 0,
          sonTarih: tsToShort(d.consumptionTimestamp),
        };
      }
      agg[key].toplamMiktar += ambalaj;
      agg[key].kayitSayisi += 1;
      const t = tsToShort(d.consumptionTimestamp);
      if (t && (!agg[key].sonTarih || t > agg[key].sonTarih)) agg[key].sonTarih = t;
    }
    const rows = Object.values(agg)
      .map((r) => ({ ...r, gunlukOrtalama: round(r.toplamMiktar / days) }))
      .sort((a, b) => b.toplamMiktar - a.toplamMiktar);
    return {
      ok: true,
      label: 'get_consumption',
      data: { range_days: days, rows: rows.slice(0, 100), totalRows: rows.length },
      scanned: snap.size,
      notice: rows.length === 0 ? `Son ${days} günde tüketim kaydı yok.` : undefined,
    };
  } catch (e) {
    return err('get_consumption', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_expiring_stock                                                      */
/* ----------------------------------------------------------------------- */

export async function getExpiringStock(
  args: { hospitalId?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  const days = args.days ?? 90;
  if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
    return { ok: false, label: 'get_expiring_stock', data: null, notice: 'Lab yetkin dışında.' };
  }
  const expiryThreshold = inDaysFromNow(days).getTime();

  type Row = { stokKodu: string; stokAdi: string; lotNumarasi?: string; miad?: string; hedefKurum?: string; hedefKurumId?: string; depotName?: string; depotId?: string; isShipped?: boolean; adet: number };

  const filterRow = (d: DocumentData): boolean => {
    if (d.isShipped && !canSeeLab(ctx, d.hedefKurumId)) return false;
    if (!d.isShipped && !canSeeDepot(ctx, d.depotId)) return false;
    if (!canSeeBrand(ctx, d.marka)) return false;
    const miadMs = d.miad?.toDate ? d.miad.toDate().getTime() : (d.miad instanceof Date ? d.miad.getTime() : 0);
    if (!miadMs) return false;
    if (miadMs > expiryThreshold) return false;
    // Exclude items already expired more than 30 days ago (not actionable, only "yaklaşan")
    return true;
  };

  const aggregate = (docs: Array<{ data(): DocumentData }>): Row[] => {
    const agg: Record<string, Row> = {};
    for (const doc of docs) {
      const d = doc.data();
      if (!filterRow(d)) continue;
      const key = `${d.stokKodu}|${d.lotNumarasi}|${d.hedefKurumId ?? d.depotId}`;
      if (!agg[key]) {
        agg[key] = {
          stokKodu: d.stokKodu,
          stokAdi: d.stokAdi,
          lotNumarasi: d.lotNumarasi,
          miad: tsToShort(d.miad),
          hedefKurum: d.hedefKurum,
          hedefKurumId: d.hedefKurumId,
          depotName: d.depotName,
          depotId: d.depotId,
          isShipped: d.isShipped,
          adet: 0,
        };
      }
      agg[key].adet += 1;
    }
    return Object.values(agg).sort((a, b) => (a.miad ?? '').localeCompare(b.miad ?? ''));
  };

  async function runStrict(): Promise<{ rows: Row[]; scanned: number } | { fallback: true }> {
    try {
      let q: Query<DocumentData> = adminDb.collection('depoStok');
      // Note: combining `miad <=` with multiple `==` fields needs a composite index.
      // Try with as many filters as possible first.
      if (args.hospitalId) {
        q = q.where('isShipped', '==', true).where('hedefKurumId', '==', args.hospitalId);
      }
      q = q.where('miad', '<=', inDaysFromNow(days));
      q = applyCompanyScope(q, ctx);
      const snap = await q.limit(args.limit ?? 1000).get();
      return { rows: aggregate(snap.docs), scanned: snap.size };
    } catch (e) {
      if (isMissingIndexError(e)) return { fallback: true } as const;
      throw e;
    }
  }

  async function runFallback(): Promise<{ rows: Row[]; scanned: number }> {
    // Most reliable path for a single lab: just query by hedefKurumId,
    // filter miad + isShipped in memory. No composite index needed.
    let q: Query<DocumentData> = adminDb.collection('depoStok');
    if (args.hospitalId) {
      q = q.where('hedefKurumId', '==', args.hospitalId);
    } else {
      // No lab → fetch by company + we'll filter miad in memory
      q = applyCompanyScope(q, ctx);
    }
    const snap = await q.limit(args.limit ?? 2000).get();
    return { rows: aggregate(snap.docs), scanned: snap.size };
  }

  try {
    let result = await runStrict();
    if ('fallback' in result) {
      result = await runFallback();
    } else if (result.rows.length === 0) {
      // Strict query returned empty — try fallback (might be index issue silently)
      const fb = await runFallback();
      if (fb.rows.length > 0) result = fb;
    }
    return {
      ok: true,
      label: 'get_expiring_stock',
      data: { window_days: days, rows: result.rows.slice(0, 200), total: result.rows.length },
      scanned: result.scanned,
      notice: result.rows.length === 0 ? `Önümüzdeki ${days} günde miadı dolacak ürün yok.` : undefined,
    };
  } catch (e) {
    return err('get_expiring_stock', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_efficiency                                                          */
/* ----------------------------------------------------------------------- */

export async function getEfficiency(
  args: { hospitalId: string; year?: number; month?: number; months?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_efficiency', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('efficiencyHistory')
      .where('hospitalId', '==', args.hospitalId);
    q = applyCompanyScope(q, ctx);
    if (args.year) q = q.where('year', '==', args.year);
    if (args.month) q = q.where('month', '==', args.month);

    const snap = await q.limit(60).get();
    const rows = snap.docs.map((d) => d.data());
    rows.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
    const limited = args.months ? rows.slice(0, args.months) : rows.slice(0, 12);
    const compact = limited.map((r) => ({
      year: r.year,
      month: r.month,
      hospitalName: r.hospitalName,
      testBazliTuketim: r.hesaplananTestBazliTuketim ?? {},
      verimlilikSonuclari: r.verimlilikSonuclari ?? {},
      kumulatif: r.cihazUstuDevir ?? {},
    }));
    return {
      ok: true,
      label: 'get_efficiency',
      data: compact,
      scanned: snap.size,
      notice: compact.length === 0 ? 'Verimlilik kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_efficiency', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_devices                                                             */
/* ----------------------------------------------------------------------- */

export async function getDevices(
  args: { hospitalId?: string; model?: string; brand?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('devices');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_devices', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('hospitalId', '==', args.hospitalId);
    }
    const snap = await q.limit(500).get();
    const devices = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => canSeeLab(ctx, (d as { hospitalId?: string; labId?: string }).hospitalId ?? (d as { labId?: string }).labId))
      .filter((d) => canSeeBrand(ctx, (d as { brand?: string; marka?: string }).brand ?? (d as { marka?: string }).marka));

    const filtered = devices.filter((d) => {
      const data = d as { brand?: string; marka?: string; model?: string };
      if (args.brand) {
        const b = (data.brand ?? data.marka ?? '').toLowerCase();
        if (!b.includes(args.brand.toLowerCase())) return false;
      }
      if (args.model) {
        const m = (data.model ?? '').toLowerCase();
        if (!m.includes(args.model.toLowerCase())) return false;
      }
      return true;
    });
    const compact = filtered.slice(0, 100).map((d) => {
      const data = d as DocumentData;
      return {
        id: data.id,
        brand: data.brand ?? data.marka,
        model: data.model,
        serial: data.seriNumarasi ?? data.serial,
        hospitalId: data.hospitalId ?? data.labId,
        hospitalName: data.hospitalName ?? data.labName,
        arizaDurumu: data.arizaDurumu,
        testDistribution: data.testDagilimi ?? data.testDistribution ?? null,
      };
    });
    return {
      ok: true,
      label: 'get_devices',
      data: compact,
      scanned: snap.size,
      notice: compact.length === 0 ? 'Eşleşen cihaz yok.' : undefined,
    };
  } catch (e) {
    return err('get_devices', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_device_faults                                                       */
/* ----------------------------------------------------------------------- */

export async function getDeviceFaults(
  args: {
    hospitalId?: string;
    status?: string;
    faultType?: string;
    days?: number;
    limit?: number;
    latest?: boolean;
    orderBy?: 'openedAt' | 'closedAt' | 'assignedAt';
  },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
    return { ok: false, label: 'get_device_faults', data: null, notice: 'Lab yetkin dışında.' };
  }
  const statusValues = normaliseFaultStatus(args.status);
  const wantLatest = !!args.latest;
  const orderField = args.orderBy ?? (wantLatest && statusValues?.includes('cozuldu') ? 'closedAt' : 'openedAt');
  const sinceMs = args.days ? daysAgo(args.days).getTime() : null;

  const memoryFilter = (data: DocumentData): boolean => {
    if (!canSeeLab(ctx, data.labId)) return false;
    if (statusValues && !statusValues.includes(String(data.status))) return false;
    if (args.faultType && data.faultType !== args.faultType) return false;
    if (sinceMs !== null) {
      const iso = tsToISO(data.openedAt);
      if (!iso || new Date(iso).getTime() < sinceMs) return false;
    }
    return true;
  };

  const shape = (data: DocumentData, id: string) => ({
    id,
    labId: data.labId,
    labName: data.labName,
    deviceId: data.deviceId,
    model: data.model,
    serial: data.serial,
    faultType: data.faultType,
    status: data.status,
    description: data.description,
    openedAt: tsToShort(data.openedAt),
    closedAt: tsToShort(data.closedAt),
    assignedAt: tsToShort(data.assignedAt),
    assignedToName: data.assignedToName,
    closedByName: data.closedByName,
  });

  try {
    const strict = async () => {
      let q: Query<DocumentData> = adminDb.collection('deviceFaultReports');
      q = applyCompanyScope(q, ctx);
      if (args.hospitalId) q = q.where('labId', '==', args.hospitalId);
      if (args.faultType) q = whereAliased(q, 'deviceFaultReports', 'faultType', args.faultType);
      if (statusValues) q = whereAliased(q, 'deviceFaultReports', 'status', args.status);
      if (args.days) q = q.where('openedAt', '>=', daysAgo(args.days));
      if (wantLatest) q = q.orderBy(orderField, 'desc');
      return q.limit(args.limit ?? (wantLatest ? 5 : 200)).get();
    };
    const loose = async () => {
      let q: Query<DocumentData> = adminDb.collection('deviceFaultReports');
      q = applyCompanyScope(q, ctx);
      if (args.hospitalId) q = q.where('labId', '==', args.hospitalId);
      return q.limit(args.limit ? Math.max(args.limit * 4, 200) : 500).get();
    };

    const result = await tryWithFallback(strict, loose, memoryFilter, shape);
    // Sort latest in memory (loose path didn't orderBy)
    if (wantLatest) {
      result.rows.sort((a, b) => (b[orderField] ?? '').localeCompare(a[orderField] ?? ''));
      result.rows = result.rows.slice(0, args.limit ?? 5);
    } else if (args.limit) {
      result.rows = result.rows.slice(0, args.limit);
    }
    return {
      ok: true,
      label: 'get_device_faults',
      data: result.rows,
      scanned: result.scanned,
      notice: result.rows.length === 0 ? 'Arıza kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_device_faults', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_recent_stock_entries                                                */
/* ----------------------------------------------------------------------- */

export async function getRecentStockEntries(
  args: { hospitalId?: string; stokKodu?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const days = args.days ?? 30;
    if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_recent_stock_entries', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('depoStok')
      .where('createdAt', '>=', daysAgo(days));
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      q = q.where('isShipped', '==', true).where('hedefKurumId', '==', args.hospitalId);
    }
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);
    const snap = await q.limit(args.limit ?? 500).get();
    const agg: Record<string, { stokKodu: string; stokAdi: string; tarih: string; adet: number; hedefKurum?: string; depotName?: string }> = {};
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.isShipped && !canSeeLab(ctx, d.hedefKurumId)) continue;
      if (!d.isShipped && !canSeeDepot(ctx, d.depotId)) continue;
      const tarih = tsToShort(d.createdAt) ?? '';
      const key = `${tarih}|${d.stokKodu}|${d.hedefKurumId ?? d.depotId}`;
      if (!agg[key]) {
        agg[key] = {
          stokKodu: d.stokKodu,
          stokAdi: d.stokAdi,
          tarih,
          adet: 0,
          hedefKurum: d.hedefKurum,
          depotName: d.depotName,
        };
      }
      agg[key].adet += 1;
    }
    const rows = Object.values(agg).sort((a, b) => b.tarih.localeCompare(a.tarih));
    return {
      ok: true,
      label: 'get_recent_stock_entries',
      data: { range_days: days, rows: rows.slice(0, 200), total: rows.length },
      scanned: snap.size,
      notice: rows.length === 0 ? `Son ${days} günde stok girişi yok.` : undefined,
    };
  } catch (e) {
    return err('get_recent_stock_entries', e);
  }
}

/* ----------------------------------------------------------------------- */
/* get_orders                                                              */
/* ----------------------------------------------------------------------- */

export async function getOrders(
  args: { hospitalId?: string; status?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_orders', data: null, notice: 'Lab yetkin dışında.' };
    }
    // Tamamlanan siparişler `orders`'tan `ordersArchive`'a taşınır. Bu yüzden:
    //  - status === 'completed'  → yalnızca arşiv
    //  - status verilmemiş/'all' → her iki koleksiyon (birleştir)
    //  - diğer (aktif) statüler   → yalnızca canlı `orders`
    const ORDERS_ARCHIVE = 'ordersArchive';
    const wantCompleted = args.status === 'completed';
    const wantAll = !args.status || args.status === 'all';
    const buildQuery = (collectionName: string): Query<DocumentData> => {
      let q: Query<DocumentData> = adminDb.collection(collectionName);
      q = applyCompanyScope(q, ctx);
      if (args.hospitalId) q = q.where('hedefKurumId', '==', args.hospitalId);
      // Statü filtresi yalnızca canlı koleksiyona uygulanır; arşivdeki her şey
      // zaten 'completed'.
      if (collectionName === 'orders' && args.status && args.status !== 'all' && args.status !== 'completed') {
        q = whereAliased(q, 'orders', 'status', args.status);
      }
      if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
      return q.limit(args.limit ?? 100);
    };
    const collections: string[] = wantCompleted
      ? [ORDERS_ARCHIVE]
      : wantAll
        ? ['orders', ORDERS_ARCHIVE]
        : ['orders'];
    const snaps = await Promise.all(collections.map((c) => buildQuery(c).get()));
    const scannedCount = snaps.reduce((sum, s) => sum + s.size, 0);
    const rows = snaps
      .flatMap((s) => s.docs)
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => canSeeLab(ctx, (d as { hedefKurumId?: string }).hedefKurumId))
      .map((d) => {
        const data = d as DocumentData;
        return {
          id: data.id,
          status: data.status,
          hedefKurum: data.hedefKurum,
          hedefKurumId: data.hedefKurumId,
          depotName: data.depotName,
          createdAt: tsToShort(data.createdAt),
          completedAt: tsToShort(data.completedAt),
          totalItems: Array.isArray(data.items) ? data.items.length : undefined,
        };
      });
    return {
      ok: true,
      label: 'get_orders',
      data: rows,
      scanned: scannedCount,
      notice: rows.length === 0 ? 'Sipariş kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_orders', e);
  }
}

/* ----------------------------------------------------------------------- */
/* find_labs_low_on_product                                                */
/* ----------------------------------------------------------------------- */

export async function findLabsLowOnProduct(
  args: { stokKodu: string; belowPercent?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const below = args.belowPercent ?? 100;
    const hospitals = await listHospitalsForContext(ctx);

    // Aggregate stock per hospital for this product
    let q: Query<DocumentData> = adminDb.collection('depoStok')
      .where('isShipped', '==', true)
      .where('stokKodu', '==', args.stokKodu);
    q = applyCompanyScope(q, ctx);
    const stockSnap = await q.limit(5000).get();
    const stockByLab: Record<string, number> = {};
    for (const doc of stockSnap.docs) {
      const d = doc.data();
      if (!canSeeLab(ctx, d.hedefKurumId)) continue;
      stockByLab[d.hedefKurumId] = (stockByLab[d.hedefKurumId] ?? 0) + 1;
    }

    // For each hospital fetch min rule, then compare
    const out: Array<{ hospitalId: string; hospitalName: string; stok: number; min: number | null; doluluk: number | null }> = [];
    for (const h of hospitals) {
      try {
        const ruleSnap = await adminDb
          .collection('hospitals')
          .doc(h.id)
          .collection('minMaxRules')
          .where('stokKodu', '==', args.stokKodu)
          .limit(1)
          .get();
        const rule = ruleSnap.docs[0]?.data();
        const stok = stockByLab[h.id] ?? 0;
        const min = typeof rule?.min === 'number' ? rule.min : null;
        const doluluk = min && min > 0 ? Math.round((stok / min) * 100) : null;
        if (min !== null && doluluk !== null && doluluk <= below) {
          out.push({ hospitalId: h.id, hospitalName: h.name, stok, min, doluluk });
        } else if (min === null && stok === 0) {
          // No rule, no stock → still relevant
          out.push({ hospitalId: h.id, hospitalName: h.name, stok, min, doluluk: 0 });
        }
      } catch (e) {
        aiLogger.debug('minMax read failed', { hospital: h.id, e: (e as Error).message });
      }
    }
    out.sort((a, b) => (a.doluluk ?? 0) - (b.doluluk ?? 0));
    return {
      ok: true,
      label: 'find_labs_low_on_product',
      data: out,
      scanned: hospitals.length,
      notice: out.length === 0 ? 'Bu ürün için min altında lab bulunamadı.' : undefined,
    };
  } catch (e) {
    return err('find_labs_low_on_product', e);
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ======================================================================= */
/* ARIZA DERİN ANALİZ                                                      */
/* ======================================================================= */

export async function getFaultDetail(
  args: { faultId: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!args.faultId) {
      return { ok: false, label: 'get_fault_detail', data: null, notice: 'faultId zorunlu.' };
    }
    const snap = await adminDb.collection('deviceFaultReports').doc(args.faultId).get();
    if (!snap.exists) {
      return { ok: true, label: 'get_fault_detail', data: null, notice: 'Arıza bulunamadı.' };
    }
    const d = snap.data() as DocumentData;
    if (!canSeeLab(ctx, d.labId ?? d.hospitalId)) {
      return { ok: false, label: 'get_fault_detail', data: null, notice: 'Bu arızaya erişim yetkin yok.' };
    }
    const detail = {
      id: snap.id,
      labId: d.labId,
      labName: d.labName,
      deviceId: d.deviceId,
      model: d.model,
      serial: d.serial,
      faultType: d.faultType,
      status: d.status,
      description: d.description,
      title: d.title,
      openedAt: tsToISO(d.openedAt),
      openedByName: d.openedByName,
      assignedAt: tsToISO(d.assignedAt),
      assignedToName: d.assignedToName,
      interventionType: d.interventionType,
      interventionStartedAt: tsToISO(d.interventionStartedAt),
      closedAt: tsToISO(d.closedAt),
      closedByName: d.closedByName,
      supportPersonnelName: d.supportPersonnelName,
      closeDescription: d.closeDescription,
      atamaBekmeSaat: msToHours(d.atamaBekmeSuresi),
      mudahaleBekmeSaat: msToHours(d.mudahaleBekmeSuresi),
      cozumSaat: msToHours(d.cozumSuresi),
      toplamCozumSaat: msToHours(d.toplamCozumSuresi),
      isEjectedKitFault: d.isEjectedKitFault,
      kitResolution: d.kitResolution,
      ejectedKitRecordId: d.ejectedKitRecordId,
      productStokKodu: d.productStokKodu,
      productStokAdi: d.productStokAdi,
      relatedTests: d.relatedTests,
      isCustomFault: d.isCustomFault,
    };
    return { ok: true, label: 'get_fault_detail', data: detail, scanned: 1 };
  } catch (e) {
    return err('get_fault_detail', e);
  }
}

export async function getDeviceFaultHistory(
  args: { deviceId?: string; serial?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!args.deviceId && !args.serial) {
      return { ok: false, label: 'get_device_fault_history', data: null, notice: 'deviceId veya serial gerekli.' };
    }
    let q: Query<DocumentData> = adminDb.collection('deviceFaultReports');
    q = applyCompanyScope(q, ctx);
    if (args.deviceId) q = q.where('deviceId', '==', args.deviceId);
    else if (args.serial) q = q.where('serial', '==', args.serial);
    if (args.days) q = q.where('openedAt', '>=', daysAgo(args.days));

    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((r) => canSeeLab(ctx, (r as { labId?: string }).labId))
      .map((r) => {
        const d = r as DocumentData;
        return {
          id: d.id,
          labName: d.labName,
          status: d.status,
          faultType: d.faultType,
          openedAt: tsToShort(d.openedAt),
          closedAt: tsToShort(d.closedAt),
          toplamCozumSaat: msToHours(d.toplamCozumSuresi),
          description: d.description,
          closedByName: d.closedByName,
        };
      })
      .sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? ''));

    const stats = {
      adet: rows.length,
      acik: rows.filter((r) => r.status !== 'cozuldu' && r.status !== 'closed').length,
      ortalamaCozumSaat: rows.filter((r) => typeof r.toplamCozumSaat === 'number').length
        ? round(
            rows.reduce((s, r) => s + (typeof r.toplamCozumSaat === 'number' ? r.toplamCozumSaat : 0), 0) /
            rows.filter((r) => typeof r.toplamCozumSaat === 'number').length,
          )
        : null,
    };
    return {
      ok: true,
      label: 'get_device_fault_history',
      data: { stats, rows },
      scanned: snap.size,
      notice: rows.length === 0 ? 'Bu cihaz için arıza kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_device_fault_history', e);
  }
}

export async function getFaultSlaViolations(
  args: { thresholdHours?: number; scope?: string; status?: string; days?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const thresholdMs = (args.thresholdHours ?? 8) * 3600 * 1000;
    const scope = (args.scope ?? 'toplam') as 'toplam' | 'mudahale' | 'atama';
    let q: Query<DocumentData> = adminDb.collection('deviceFaultReports');
    q = applyCompanyScope(q, ctx);
    if (args.status && args.status !== 'all') q = whereAliased(q, 'getFaultSlaViolations', 'status', args.status);
    if (args.days) q = q.where('openedAt', '>=', daysAgo(args.days));

    const snap = await q.limit(500).get();
    const now = Date.now();
    const rows: Array<DocumentData & { sureSaat?: number }> = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!canSeeLab(ctx, d.labId)) continue;
      let elapsedMs: number | null = null;
      if (scope === 'atama') {
        elapsedMs = typeof d.atamaBekmeSuresi === 'number' ? d.atamaBekmeSuresi : null;
        if (elapsedMs === null && d.openedAt && !d.assignedAt) {
          elapsedMs = now - (tsToISO(d.openedAt) ? new Date(tsToISO(d.openedAt)!).getTime() : now);
        }
      } else if (scope === 'mudahale') {
        elapsedMs = typeof d.mudahaleBekmeSuresi === 'number' ? d.mudahaleBekmeSuresi : null;
        if (elapsedMs === null && d.assignedAt && !d.interventionStartedAt) {
          elapsedMs = now - (tsToISO(d.assignedAt) ? new Date(tsToISO(d.assignedAt)!).getTime() : now);
        }
      } else {
        elapsedMs = typeof d.toplamCozumSuresi === 'number' ? d.toplamCozumSuresi : null;
        if (elapsedMs === null && d.openedAt && d.status !== 'cozuldu' && d.status !== 'closed') {
          elapsedMs = now - (tsToISO(d.openedAt) ? new Date(tsToISO(d.openedAt)!).getTime() : now);
        }
      }
      if (elapsedMs === null) continue;
      if (elapsedMs < thresholdMs) continue;
      rows.push({
        id: doc.id,
        labName: d.labName,
        deviceModel: d.model,
        faultType: d.faultType,
        status: d.status,
        openedAt: tsToShort(d.openedAt),
        assignedToName: d.assignedToName,
        sureSaat: msToHours(elapsedMs) ?? undefined,
      });
    }
    rows.sort((a, b) => (b.sureSaat ?? 0) - (a.sureSaat ?? 0));
    return {
      ok: true,
      label: 'get_fault_sla_violations',
      data: { scope, thresholdSaat: args.thresholdHours ?? 8, rows: rows.slice(0, 100) },
      scanned: snap.size,
      notice: rows.length === 0 ? 'SLA ihlali yok.' : undefined,
    };
  } catch (e) {
    return err('get_fault_sla_violations', e);
  }
}

export async function getFaultActionForms(
  args: { faultId?: string; deviceId?: string; faultType?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const limit = args.limit ?? 20;
    const collections = args.faultType === 'aplikasyon'
      ? ['aplikasyonActionForms']
      : args.faultType === 'teknik_servis'
      ? ['teknikServisActionForms']
      : ['aplikasyonActionForms', 'teknikServisActionForms'];

    const rows: Array<DocumentData & { _kind: string }> = [];
    for (const col of collections) {
      let q: Query<DocumentData> = adminDb.collection(col);
      q = applyCompanyScope(q, ctx);
      if (args.faultId) q = q.where('faultId', '==', args.faultId);
      else if (args.deviceId) q = q.where('deviceId', '==', args.deviceId);
      else continue;
      const snap = await q.limit(limit).get();
      for (const doc of snap.docs) {
        const d = doc.data();
        if (!canSeeLab(ctx, d.labId ?? d.hospitalId)) continue;
        rows.push({ _kind: col, id: doc.id, ...d });
      }
    }
    const compact = rows.slice(0, limit).map((r) => ({
      kind: r._kind,
      id: r.id,
      faultId: r.faultId,
      deviceId: r.deviceId,
      labName: r.labName,
      createdAt: tsToShort(r.createdAt ?? r.formCreatedAt),
      createdByName: r.createdByName ?? r.technicianName,
      status: r.status,
      hasSignatures: !!(r.technicianSignature || r.personnelSignature),
      summary: r.summary ?? r.description ?? null,
      partsUsed: Array.isArray(r.partsUsed) ? r.partsUsed.length : undefined,
    }));
    return {
      ok: true,
      label: 'get_fault_action_forms',
      data: compact,
      notice: compact.length === 0 ? 'Form bulunamadı.' : undefined,
    };
  } catch (e) {
    return err('get_fault_action_forms', e);
  }
}

export async function getLabDevicesStatus(
  args: { hospitalId: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_lab_devices_status', data: null, notice: 'Lab yetkin dışında.' };
    }
    let dq: Query<DocumentData> = adminDb.collection('devices').where('hospitalId', '==', args.hospitalId);
    dq = applyCompanyScope(dq, ctx);
    const dSnap = await dq.limit(200).get();
    const devices = dSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => canSeeBrand(ctx, (d as DocumentData).brand ?? (d as DocumentData).marka));

    // Open fault counts per device
    let fq: Query<DocumentData> = adminDb.collection('deviceFaultReports')
      .where('labId', '==', args.hospitalId);
    fq = applyCompanyScope(fq, ctx);
    const fSnap = await fq.limit(500).get();
    const openByDevice: Record<string, number> = {};
    for (const doc of fSnap.docs) {
      const d = doc.data();
      if (d.status === 'cozuldu' || d.status === 'closed') continue;
      openByDevice[d.deviceId] = (openByDevice[d.deviceId] ?? 0) + 1;
    }

    const rows = devices.map((dev) => {
      const d = dev as DocumentData;
      return {
        id: d.id,
        brand: d.brand ?? d.marka,
        model: d.model,
        serial: d.seriNumarasi ?? d.serial,
        arizaDurumu: d.arizaDurumu ?? null,
        acikArizaSayisi: openByDevice[d.id] ?? 0,
        testDistribution: d.testDagilimi ?? d.testDistribution ?? null,
      };
    });
    return {
      ok: true,
      label: 'get_lab_devices_status',
      data: rows,
      scanned: dSnap.size + fSnap.size,
      notice: rows.length === 0 ? 'Bu lab\'da tanımlı cihaz yok.' : undefined,
    };
  } catch (e) {
    return err('get_lab_devices_status', e);
  }
}

/* ======================================================================= */
/* KULLANICI / PERSONEL                                                    */
/* ======================================================================= */

export async function getUserProfile(
  args: { uid?: string; email?: string; name?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!args.uid && !args.email && !args.name) {
      return { ok: false, label: 'get_user_profile', data: null, notice: 'uid, email veya name gerekli.' };
    }
    if (args.uid) {
      const snap = await adminDb.collection('users').doc(args.uid).get();
      if (!snap.exists) return { ok: true, label: 'get_user_profile', data: null, notice: 'Kullanıcı bulunamadı.' };
      const d = snap.data() as DocumentData;
      return { ok: true, label: 'get_user_profile', data: compactUser(d, ctx), scanned: 1 };
    }
    let q: Query<DocumentData> = adminDb.collection('users');
    q = applyCompanyScope(q, ctx);
    if (args.email) q = q.where('email', '==', args.email);
    const snap = await q.limit(20).get();
    let matches = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    if (args.name) {
      const needle = normaliseLocal(args.name);
      matches = matches.filter((u) => normaliseLocal((u as DocumentData).name ?? '').includes(needle));
    }
    return {
      ok: true,
      label: 'get_user_profile',
      data: matches.slice(0, 5).map((d) => compactUser(d as DocumentData, ctx)),
      scanned: snap.size,
      notice: matches.length === 0 ? 'Eşleşen kullanıcı yok.' : undefined,
    };
  } catch (e) {
    return err('get_user_profile', e);
  }
}

export async function listUsers(
  args: { role?: string; labId?: string; depotId?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('users');
    q = applyCompanyScope(q, ctx);
    if (args.role) q = q.where('role', '==', args.role);
    if (args.labId) q = q.where('assignedLaboratories', 'array-contains', args.labId);
    else if (args.depotId) q = q.where('assignedDepots', 'array-contains', args.depotId);
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).map((u) => compactUser(u as DocumentData, ctx));
    return {
      ok: true,
      label: 'list_users',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Eşleşen kullanıcı yok.' : undefined,
    };
  } catch (e) {
    return err('list_users', e);
  }
}

export async function getUserActivity(
  args: { uid: string; days?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!args.uid) return { ok: false, label: 'get_user_activity', data: null, notice: 'uid zorunlu.' };
    const days = args.days ?? 30;
    const since = daysAgo(days);

    const [ordersSnap, openedFaultsSnap, assignedFaultsSnap, closedFaultsSnap, transfersSnap, consSnap] = await Promise.allSettled([
      applyCompanyScope(adminDb.collection('orders').where('createdById', '==', args.uid), ctx)
        .where('createdAt', '>=', since).limit(50).get(),
      applyCompanyScope(adminDb.collection('deviceFaultReports').where('openedBy', '==', args.uid), ctx)
        .where('openedAt', '>=', since).limit(50).get(),
      applyCompanyScope(adminDb.collection('deviceFaultReports').where('assignedToUid', '==', args.uid), ctx)
        .where('assignedAt', '>=', since).limit(50).get(),
      applyCompanyScope(adminDb.collection('deviceFaultReports').where('closedByUid', '==', args.uid), ctx)
        .where('closedAt', '>=', since).limit(50).get(),
      applyCompanyScope(adminDb.collection('transfers').where('userId', '==', args.uid), ctx)
        .where('timestamp', '>=', since).limit(50).get(),
      applyCompanyScope(adminDb.collection('tuketimKayitlari').where('userId', '==', args.uid), ctx)
        .where('consumptionTimestamp', '>=', since).limit(50).get(),
    ]);

    const safe = <T extends { docs: { id: string; data: () => DocumentData }[]; size: number }>(s: PromiseSettledResult<T>) =>
      s.status === 'fulfilled' ? s.value : null;

    const orders = safe(ordersSnap as PromiseSettledResult<{ docs: { id: string; data: () => DocumentData }[]; size: number }>);
    const oFaults = safe(openedFaultsSnap as PromiseSettledResult<{ docs: { id: string; data: () => DocumentData }[]; size: number }>);
    const aFaults = safe(assignedFaultsSnap as PromiseSettledResult<{ docs: { id: string; data: () => DocumentData }[]; size: number }>);
    const cFaults = safe(closedFaultsSnap as PromiseSettledResult<{ docs: { id: string; data: () => DocumentData }[]; size: number }>);
    const transfers = safe(transfersSnap as PromiseSettledResult<{ docs: { id: string; data: () => DocumentData }[]; size: number }>);
    const cons = safe(consSnap as PromiseSettledResult<{ docs: { id: string; data: () => DocumentData }[]; size: number }>);

    const summary = {
      range_days: days,
      orders_created: orders?.size ?? 0,
      faults_opened: oFaults?.size ?? 0,
      faults_assigned: aFaults?.size ?? 0,
      faults_closed: cFaults?.size ?? 0,
      transfers_done: transfers?.size ?? 0,
      consumption_records: cons?.size ?? 0,
    };
    const recentOrders = (orders?.docs ?? []).slice(0, 10).map((d) => {
      const data = d.data();
      return { id: d.id, kurumAdi: data.kurumAdi, status: data.status, urgency: data.urgency, createdAt: tsToShort(data.createdAt) };
    });
    const recentFaultsClosed = (cFaults?.docs ?? []).slice(0, 10).map((d) => {
      const data = d.data();
      return { id: d.id, labName: data.labName, model: data.model, faultType: data.faultType, closedAt: tsToShort(data.closedAt) };
    });
    return {
      ok: true,
      label: 'get_user_activity',
      data: { summary, recentOrders, recentFaultsClosed },
    };
  } catch (e) {
    return err('get_user_activity', e);
  }
}

export async function getPersonnelRecord(
  args: { userId?: string; name?: string; labId?: string; includeSalary?: boolean },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('personnel');
    q = applyCompanyScope(q, ctx);
    if (args.userId) q = q.where('userId', '==', args.userId);
    if (args.labId) q = q.where('assignedLabIds', 'array-contains', args.labId);
    const snap = await q.limit(100).get();
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (args.name) {
      const needle = normaliseLocal(args.name);
      rows = rows.filter((r) => normaliseLocal((r as DocumentData).adSoyad ?? '').includes(needle));
    }
    const wantsSalary = !!args.includeSalary && ctx.isAdmin;
    const compact = rows.slice(0, 30).map((r) => {
      const d = r as DocumentData;
      return {
        id: d.id,
        adSoyad: d.adSoyad,
        pozisyon: d.pozisyon,
        assignedLabIds: d.assignedLabIds,
        primaryLabId: d.primaryLabId,
        aktif: d.aktif,
        baslamaTarihi: d.baslamaTarihi,
        userId: d.userId,
        ...(wantsSalary ? {
          aylikBrutMaas: d.aylikBrutMaas,
          aylikYanHaklar: d.aylikYanHaklar,
          currency: d.currency,
        } : {}),
      };
    });
    return {
      ok: true,
      label: 'get_personnel_record',
      data: compact,
      scanned: snap.size,
      notice: !wantsSalary && args.includeSalary ? 'Maaş alanları yalnızca admin yetkili kullanıcılara döner.' : (compact.length === 0 ? 'Personel kaydı yok.' : undefined),
    };
  } catch (e) {
    return err('get_personnel_record', e);
  }
}

export async function getPersonnelAvailability(
  args: { uid?: string; from?: string; to?: string; type?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('personnelAvailability');
    q = applyCompanyScope(q, ctx);
    if (args.uid) q = q.where('uid', '==', args.uid);
    if (args.type) q = whereAliased(q, 'getPersonnelAvailability', 'type', args.type);
    if (args.from) q = q.where('startAt', '>=', new Date(args.from));
    const snap = await q.limit(200).get();
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (args.to) {
      const end = new Date(args.to).getTime();
      rows = rows.filter((r) => {
        const startMs = (r as DocumentData).startAt ? new Date(tsToISO((r as DocumentData).startAt)!).getTime() : 0;
        return startMs <= end;
      });
    }
    const compact = rows.map((r) => {
      const d = r as DocumentData;
      return { id: d.id, uid: d.uid, type: d.type, description: d.description, startAt: tsToShort(d.startAt), endAt: tsToShort(d.endAt) };
    });
    return {
      ok: true,
      label: 'get_personnel_availability',
      data: compact,
      scanned: snap.size,
      notice: compact.length === 0 ? 'Müsaitlik kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_personnel_availability', e);
  }
}

export async function getExpensePeriods(
  args: { uid?: string; status?: string; year?: number; month?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!ctx.isAdmin && args.uid && args.uid !== ctx.uid) {
      return { ok: false, label: 'get_expense_periods', data: null, notice: 'Sadece kendi masraf taleplerini görebilirsin.' };
    }
    let q: Query<DocumentData> = adminDb.collection('expensePeriods');
    q = applyCompanyScope(q, ctx);
    const filterUid = args.uid ?? (ctx.isAdmin ? undefined : ctx.uid);
    if (filterUid) q = q.where('ownerUid', '==', filterUid);
    if (args.status && args.status !== 'all') q = whereAliased(q, 'expensePeriods', 'status', args.status);
    if (args.year) q = q.where('year', '==', args.year);
    if (args.month) q = q.where('month', '==', args.month);
    const snap = await q.limit(60).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      const receipts = Array.isArray(data.receipts) ? data.receipts : [];
      const byCategory: Record<string, number> = {};
      for (const r of receipts) {
        const cat = r.kategori ?? 'Diğer';
        byCategory[cat] = (byCategory[cat] ?? 0) + (typeof r.fiyat === 'number' ? r.fiyat : 0);
      }
      return {
        id: d.id,
        ownerUid: data.ownerUid,
        year: data.year,
        month: data.month,
        status: data.status,
        total: data.total,
        receiptCount: receipts.length,
        byCategory,
      };
    });
    return {
      ok: true,
      label: 'get_expense_periods',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Masraf talep kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_expense_periods', e);
  }
}

export async function getOvertimeRequests(
  args: { uid?: string; status?: string; days?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('overtimeRequests');
    q = applyCompanyScope(q, ctx);
    const filterUid = args.uid ?? (ctx.isAdmin ? undefined : ctx.uid);
    if (filterUid) q = q.where('uid', '==', filterUid);
    if (args.status && args.status !== 'all') q = whereAliased(q, 'overtimeRequests', 'status', args.status);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, uid: data.uid, status: data.status, hours: data.hours, date: tsToShort(data.date ?? data.createdAt), description: data.description };
    });
    return {
      ok: true,
      label: 'get_overtime_requests',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Ek mesai talebi yok.' : undefined,
    };
  } catch (e) {
    return err('get_overtime_requests', e);
  }
}

/* ======================================================================= */
/* SİPARİŞ / SEVK / TRANSFER / DOĞRULAMA / İADE                           */
/* ======================================================================= */

export async function getShipments(
  args: { hospitalId?: string; orderId?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('shipments');
    q = applyCompanyScope(q, ctx);
    if (args.orderId) q = q.where('orderId', '==', args.orderId);
    if (args.days) q = q.where('timestamp', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const hospitalName = args.hospitalId ? (await getHospitalById(args.hospitalId))?.name : undefined;
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => {
        const d = s as DocumentData;
        if (args.hospitalId && hospitalName) {
          return normaliseLocal(d.recipientHospital ?? '') === normaliseLocal(hospitalName);
        }
        return true;
      })
      .map((s) => {
        const d = s as DocumentData;
        return {
          id: d.id,
          orderId: d.orderId,
          depotName: d.depotName,
          recipientHospital: d.recipientHospital,
          userName: d.userName,
          timestamp: tsToShort(d.timestamp),
          itemCount: Array.isArray(d.items) ? d.items.length : 0,
        };
      });
    return {
      ok: true,
      label: 'get_shipments',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Sevkiyat yok.' : undefined,
    };
  } catch (e) {
    return err('get_shipments', e);
  }
}

export async function getTransfers(
  args: { sourceDepotId?: string; targetName?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('transfers');
    q = applyCompanyScope(q, ctx);
    if (args.sourceDepotId) {
      if (!canSeeDepot(ctx, args.sourceDepotId)) {
        return { ok: false, label: 'get_transfers', data: null, notice: 'Depo yetkin dışında.' };
      }
      q = q.where('sourceDepotId', '==', args.sourceDepotId);
    }
    if (args.days) q = q.where('timestamp', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        sourceDepotName: data.sourceDepotName,
        targetName: data.targetName,
        userName: data.userName,
        timestamp: tsToShort(data.timestamp),
        itemCount: data.itemCount,
      };
    }).filter((r) => !args.targetName || normaliseLocal(r.targetName ?? '').includes(normaliseLocal(args.targetName)));
    return {
      ok: true,
      label: 'get_transfers',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Transfer yok.' : undefined,
    };
  } catch (e) {
    return err('get_transfers', e);
  }
}

export async function getVerificationReports(
  args: { ilgiliBelgeId?: string; raporTipi?: string; durum?: string; hedefKurum?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('verificationReports');
    q = applyCompanyScope(q, ctx);
    if (args.ilgiliBelgeId) q = q.where('ilgiliBelgeId', '==', args.ilgiliBelgeId);
    if (args.raporTipi) q = whereAliased(q, 'verificationReports', 'raporTipi', args.raporTipi);
    if (args.durum) q = whereAliased(q, 'verificationReports', 'durum', args.durum);
    if (args.days) q = q.where('islemTarihi', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        raporTipi: data.raporTipi,
        durum: data.durum,
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
        lotNumarasi: data.lotNumarasi,
        seriNumarasi: data.seriNumarasi,
        hedefKurum: data.hedefKurum,
        islemTarihi: tsToShort(data.islemTarihi),
        ilgiliBelgeId: data.ilgiliBelgeId,
      };
    }).filter((r) => !args.hedefKurum || normaliseLocal(r.hedefKurum ?? '').includes(normaliseLocal(args.hedefKurum)));
    return {
      ok: true,
      label: 'get_verification_reports',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Doğrulama raporu yok.' : undefined,
    };
  } catch (e) {
    return err('get_verification_reports', e);
  }
}

export async function getProductReturns(
  args: { hospitalId?: string; stokKodu?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('productReturns');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_product_returns', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('hospitalId', '==', args.hospitalId);
    }
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        hospitalId: data.hospitalId,
        hospitalName: data.hospitalName ?? data.hedefKurum,
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
        adet: data.adet ?? data.quantity ?? 1,
        sebep: data.sebep ?? data.reason,
        createdAt: tsToShort(data.createdAt),
      };
    }).filter((r) => canSeeLab(ctx, r.hospitalId));
    return {
      ok: true,
      label: 'get_product_returns',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'İade kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_product_returns', e);
  }
}

/* ======================================================================= */
/* EJECTED / DESTROYED / TRASH                                             */
/* ======================================================================= */

export async function getEjectedKits(
  args: { hospitalId?: string; deviceId?: string; stokKodu?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('ejectedKitRecords');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_ejected_kits', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('laboratoryId', '==', args.hospitalId);
    }
    if (args.deviceId) q = q.where('deviceId', '==', args.deviceId);
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        laboratoryName: data.laboratoryName,
        deviceModel: data.deviceModel,
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
        testCount: data.testCount,
        aciklama: data.aciklama,
        createdAt: tsToShort(data.createdAt),
        createdByName: data.createdByName,
        faultReportId: data.faultReportId,
      };
    });
    return {
      ok: true,
      label: 'get_ejected_kits',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Cihazdan çıkan kit yok.' : undefined,
    };
  } catch (e) {
    return err('get_ejected_kits', e);
  }
}

export async function getDestroyedKits(
  args: { hospitalId?: string; depotId?: string; stokKodu?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('destroyedKitsReports');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_destroyed_kits', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('laboratoryId', '==', args.hospitalId);
    } else if (args.depotId) {
      if (!canSeeDepot(ctx, args.depotId)) {
        return { ok: false, label: 'get_destroyed_kits', data: null, notice: 'Depo yetkin dışında.' };
      }
      q = q.where('depotId', '==', args.depotId);
    }
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);
    if (args.days) q = q.where('resolvedAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        laboratoryName: data.laboratoryName,
        depotName: data.depotName,
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
        lotNumarasi: data.lotNumarasi,
        miad: data.miad,
        testCount: data.testCount,
        remainingTests: data.remainingTests,
        aciklama: data.aciklama,
        sourceType: data.sourceType,
        resolvedAt: tsToShort(data.resolvedAt),
        resolvedByName: data.resolvedByName,
      };
    });
    return {
      ok: true,
      label: 'get_destroyed_kits',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'İmha kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_destroyed_kits', e);
  }
}

export async function getTrashBin(
  args: { hospitalId?: string; deviceId?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('trashBinRecords');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_trash_bin', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('laboratoryId', '==', args.hospitalId);
    }
    if (args.deviceId) q = q.where('deviceId', '==', args.deviceId);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        laboratoryName: data.laboratoryName,
        deviceModel: data.deviceModel,
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
        remainingTests: data.remainingTests,
        createdAt: tsToShort(data.createdAt),
        createdByName: data.createdByName,
      };
    });
    return {
      ok: true,
      label: 'get_trash_bin',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Çöp kutusu kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_trash_bin', e);
  }
}

/* ======================================================================= */
/* TALEP / BİLDİRİM / SAYIM / BAKIM                                        */
/* ======================================================================= */

export async function getUserRequests(
  args: { category?: string; priority?: string; status?: string; assignedTo?: string; createdBy?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('userRequests');
    if (args.category) q = q.where('category', '==', args.category);
    if (args.priority) q = q.where('priority', '==', args.priority);
    if (args.status) q = whereAliased(q, 'userRequests', 'status', args.status);
    if (args.assignedTo) q = q.where('assignedTo', '==', args.assignedTo);
    if (args.createdBy) q = q.where('createdBy', '==', args.createdBy);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    if (!ctx.isAdmin) q = q.where('createdBy', '==', ctx.uid);
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: data.title,
        category: data.category,
        priority: data.priority,
        status: data.status,
        createdByName: data.createdByName,
        assignedToName: data.assignedToName,
        createdAt: tsToShort(data.createdAt),
        resolvedAt: tsToShort(data.resolvedAt),
      };
    });
    return {
      ok: true,
      label: 'get_user_requests',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Kullanıcı talebi yok.' : undefined,
    };
  } catch (e) {
    return err('get_user_requests', e);
  }
}

export async function getNotifications(
  args: { type?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('notifications');
    if (args.type) q = whereAliased(q, 'notifications', 'type', args.type);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        type: data.type,
        title: data.title,
        target: data.target,
        resource: data.resource,
        createdAt: tsToShort(data.createdAt),
      };
    });
    // Filter to ones that target this user or roles they hold
    const visible = ctx.isAdmin ? rows : rows.filter((n) => {
      if (!n.target) return true;
      const t = String(n.target);
      return t.includes(`uid:${ctx.uid}`) || t.includes(`role:${ctx.role}`)
        || ctx.assignedLaboratories.some((id) => t.includes(`lab:${id}`))
        || ctx.assignedDepots.some((id) => t.includes(`depot:${id}`));
    });
    return {
      ok: true,
      label: 'get_notifications',
      data: visible,
      scanned: snap.size,
      notice: visible.length === 0 ? 'Bildirim yok.' : undefined,
    };
  } catch (e) {
    return err('get_notifications', e);
  }
}

export async function getCountSessions(
  args: { kind?: string; locationId?: string; status?: string; days?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const kind = (args.kind ?? 'depot_stock') as 'depot_stock' | 'depot_brand' | 'maliyet';
    const collection = kind === 'depot_brand' ? 'depotBrandCountSessions' : kind === 'maliyet' ? 'maliyetSayimSessions' : 'depotStockCountSessions';
    let q: Query<DocumentData> = adminDb.collection(collection);
    q = applyCompanyScope(q, ctx);
    if (args.locationId) {
      if (kind === 'maliyet') {
        q = q.where('locationId', '==', args.locationId);
      } else {
        q = q.where('depotId', '==', args.locationId);
      }
    }
    if (args.status) q = whereAliased(q, collection, 'status', args.status);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).map((r) => {
      const data = r as DocumentData;
      return {
        id: data.id,
        status: data.status,
        depotId: data.depotId,
        depotName: data.depotName,
        locationType: data.locationType,
        locationId: data.locationId,
        createdAt: tsToShort(data.createdAt),
        completedAt: tsToShort(data.completedAt),
      };
    });
    return {
      ok: true,
      label: 'get_count_sessions',
      data: { kind, rows },
      scanned: snap.size,
      notice: rows.length === 0 ? 'Sayım oturumu yok.' : undefined,
    };
  } catch (e) {
    return err('get_count_sessions', e);
  }
}

export async function getMaintenance(
  args: { deviceId?: string; hospitalId?: string; kind?: string; upcomingDays?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const kind = (args.kind ?? 'plans') as 'plans' | 'logs';
    const collection = kind === 'logs' ? 'maintenanceLogs' : 'maintenancePlans';
    let q: Query<DocumentData> = adminDb.collection(collection);
    q = applyCompanyScope(q, ctx);
    if (args.deviceId) q = q.where('deviceId', '==', args.deviceId);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_maintenance', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('hospitalId', '==', args.hospitalId);
    }
    if (kind === 'plans' && args.upcomingDays) {
      q = q.where('nextDate', '<=', inDaysFromNow(args.upcomingDays));
    }
    const snap = await q.limit(200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return {
      ok: true,
      label: 'get_maintenance',
      data: { kind, rows },
      scanned: snap.size,
      notice: rows.length === 0 ? 'Bakım kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_maintenance', e);
  }
}

/* ----------------------------------------------------------------------- */

function msToHours(ms: unknown): number | null {
  if (typeof ms !== 'number' || ms < 0) return null;
  return Math.round((ms / 3600000) * 10) / 10;
}

function normaliseLocal(s: string): string {
  if (!s) return '';
  const trMap: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u' };
  return s.toLowerCase().split('').map((c) => trMap[c] ?? c).join('');
}

function compactUser(d: DocumentData, ctx: PermissionContext) {
  // Only admins see other users' brand/depot/lab assignments in full.
  return {
    uid: d.uid ?? d.id,
    email: d.email,
    name: d.name,
    role: d.role,
    companyId: d.companyId,
    assignedLaboratoriesCount: Array.isArray(d.assignedLaboratories) ? d.assignedLaboratories.length : 0,
    assignedDepotsCount: Array.isArray(d.assignedDepots) ? d.assignedDepots.length : 0,
    assignedBrandsCount: Array.isArray(d.assignedBrands) ? d.assignedBrands.length : 0,
    ...(ctx.isAdmin ? {
      assignedLaboratories: d.assignedLaboratories,
      assignedDepots: d.assignedDepots,
      assignedBrands: d.assignedBrands,
      primaryLaboratories: d.primaryLaboratories,
    } : {}),
    createdAt: tsToShort(d.createdAt),
  };
}

/* ======================================================================= */
/* MAL KABUL / SİPARİŞ EK / TÜKETİM EK                                     */
/* ======================================================================= */

export async function getMalKabulHistory(
  args: { depotId?: string; days?: number; irsaliyeNo?: string; supplierName?: string; includeLines?: boolean; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('malKabulTransactions');
    q = applyCompanyScope(q, ctx);
    if (args.depotId) {
      if (!canSeeDepot(ctx, args.depotId)) {
        return { ok: false, label: 'get_mal_kabul_history', data: null, notice: 'Depo yetkin dışında.' };
      }
      q = q.where('depotId', '==', args.depotId);
    }
    if (args.irsaliyeNo) q = q.where('irsaliyeNo', '==', args.irsaliyeNo);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows: Array<DocumentData & { lines?: DocumentData[] }> = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!canSeeDepot(ctx, data.depotId)) continue;
      if (args.supplierName) {
        const s = String(data.supplierName ?? data.tedarikciAdi ?? '').toLowerCase();
        if (!s.includes(args.supplierName.toLowerCase())) continue;
      }
      const out: DocumentData = {
        id: doc.id,
        depotId: data.depotId,
        depotName: data.depotName,
        irsaliyeNo: data.irsaliyeNo,
        supplierName: data.supplierName ?? data.tedarikciAdi,
        createdAt: tsToShort(data.createdAt),
        createdByName: data.createdByName,
        toplamKalemSayisi: data.toplamKalemSayisi ?? data.lineCount,
        status: data.status,
      };
      if (args.includeLines && rows.length < 5) {
        try {
          const linesSnap = await adminDb.collection('malKabulTransactions').doc(doc.id).collection('lines').limit(50).get();
          out.lines = linesSnap.docs.map((l) => {
            const ld = l.data();
            return { stokKodu: ld.stokKodu, stokAdi: ld.stokAdi, lotNumarasi: ld.lotNumarasi, miad: tsToShort(ld.miad), adet: ld.adet ?? ld.quantity };
          });
        } catch { /* ignore */ }
      }
      rows.push(out);
    }
    return {
      ok: true,
      label: 'get_mal_kabul_history',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Mal kabul kaydı yok.' : undefined,
    };
  } catch (e) {
    return err('get_mal_kabul_history', e);
  }
}

export async function getCentralOrders(
  args: { status?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('centralOrders');
    q = applyCompanyScope(q, ctx);
    if (args.status && args.status !== 'all') q = whereAliased(q, 'centralOrders', 'status', args.status);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        status: data.status,
        supplierName: data.supplierName ?? data.tedarikciAdi,
        depotName: data.depotName,
        createdAt: tsToShort(data.createdAt),
        completedAt: tsToShort(data.completedAt),
        totalItems: Array.isArray(data.items) ? data.items.length : data.itemCount,
      };
    });
    return { ok: true, label: 'get_central_orders', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Merkez sipariş yok.' : undefined };
  } catch (e) {
    return err('get_central_orders', e);
  }
}

export async function getConsumableRequests(
  args: { hospitalId?: string; status?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_consumable_requests', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('consumableRequests');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) q = q.where('hospitalId', '==', args.hospitalId);
    if (args.status && args.status !== 'all') q = whereAliased(q, 'consumableRequests', 'status', args.status);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        hospitalId: data.hospitalId,
        hospitalName: data.hospitalName ?? data.kurumAdi,
        status: data.status,
        urgency: data.urgency,
        createdAt: tsToShort(data.createdAt),
        createdByName: data.createdByName,
        itemCount: Array.isArray(data.items) ? data.items.length : data.itemCount,
      };
    }).filter((r) => canSeeLab(ctx, r.hospitalId));
    return { ok: true, label: 'get_consumable_requests', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Sarf talebi yok.' : undefined };
  } catch (e) {
    return err('get_consumable_requests', e);
  }
}

export async function getTotalEfficiencyRecords(
  args: { hospitalId?: string; labId?: string; stokKodu?: string; year?: number; month?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const labId = args.hospitalId ?? args.labId;
    if (labId && !canSeeLab(ctx, labId)) {
      return { ok: false, label: 'get_total_efficiency_records', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('totalEfficiencyRecords');
    q = applyCompanyScope(q, ctx);
    if (labId) q = q.where('labId', '==', labId);
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);
    if (args.year) q = q.where('year', '==', args.year);
    if (args.month) q = q.where('month', '==', args.month);
    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        labId: data.labId,
        labName: data.labName,
        year: data.year,
        month: data.month,
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
        testAdi: data.testAdi,
        ambalajDegeri: data.ambalajDegeri,
        cihazGrubu: data.cihazGrubu,
        baslangicStokuKutu: data.baslangicStokuKutu,
        ayBasiCihazUstuTest: data.ayBasiCihazUstuTest,
        totalAyBasiStok: data.totalAyBasiStok,
        sevkiyatKutu: data.sevkiyatKutu,
        sevkiyatTest: data.sevkiyatTest,
        toplamTuketim: data.toplamTuketim ?? data.tuketim,
        verimlilikSonucu: data.verimlilikSonucu,
      };
    }).filter((r) => canSeeLab(ctx, r.labId));
    return { ok: true, label: 'get_total_efficiency_records', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Total verimlilik kaydı yok.' : undefined };
  } catch (e) {
    return err('get_total_efficiency_records', e);
  }
}

export async function getCihazUstuHistory(
  args: { hospitalId?: string; period?: string; stokKodu?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_cihaz_ustu_history', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('cihazUstuGecmisi');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) q = q.where('hospitalId', '==', args.hospitalId);
    if (args.period) q = q.where('period', '==', args.period);
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);
    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => canSeeLab(ctx, (r as DocumentData).hospitalId));
    return { ok: true, label: 'get_cihaz_ustu_history', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Cihaz üstü geçmişi yok.' : undefined };
  } catch (e) {
    return err('get_cihaz_ustu_history', e);
  }
}

export async function getKumulatifRaporlar(
  args: { hospitalId?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('kumulatifRaporlar');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_kumulatif_raporlar', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('hospitalId', '==', args.hospitalId);
    }
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        hospitalId: data.hospitalId,
        hospitalName: data.hospitalName,
        period: data.period,
        createdAt: tsToShort(data.createdAt),
        createdByName: data.createdByName,
        toplamTestSayisi: data.toplamTestSayisi ?? data.totalTests,
        kayitSayisi: Array.isArray(data.kayitlar) ? data.kayitlar.length : undefined,
      };
    }).filter((r) => canSeeLab(ctx, r.hospitalId));
    return { ok: true, label: 'get_kumulatif_raporlar', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Kümülatif rapor yok.' : undefined };
  } catch (e) {
    return err('get_kumulatif_raporlar', e);
  }
}

export async function getCostCheckpoints(
  args: { hospitalId?: string; year?: number; month?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_cost_checkpoints', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('costCheckpoints');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) q = q.where('hospitalId', '==', args.hospitalId);
    if (args.year) q = q.where('year', '==', args.year);
    if (args.month) q = q.where('month', '==', args.month);
    const snap = await q.limit(args.limit ?? 60).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !args.hospitalId || canSeeLab(ctx, (r as DocumentData).hospitalId));
    return { ok: true, label: 'get_cost_checkpoints', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Maliyet checkpoint yok.' : undefined };
  } catch (e) {
    return err('get_cost_checkpoints', e);
  }
}

export async function getDailyConsumptionStats(
  args: { hospitalId?: string; stokKodu?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_daily_consumption_stats', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('dailyConsumptionStats');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) q = q.where('hospitalId', '==', args.hospitalId);
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);
    if (args.days) q = q.where('date', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => canSeeLab(ctx, (r as DocumentData).hospitalId));
    return { ok: true, label: 'get_daily_consumption_stats', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Günlük tüketim istatistiği yok.' : undefined };
  } catch (e) {
    return err('get_daily_consumption_stats', e);
  }
}

export async function getNfcDisposalEvents(
  args: { hospitalId?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_nfc_disposal_events', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('nfcDisposalEvents');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) q = q.where('hospitalId', '==', args.hospitalId);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !args.hospitalId || canSeeLab(ctx, (r as DocumentData).hospitalId));
    return { ok: true, label: 'get_nfc_disposal_events', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'NFC imha kaydı yok.' : undefined };
  } catch (e) {
    return err('get_nfc_disposal_events', e);
  }
}

/* ======================================================================= */
/* CİHAZ YÖNETİMİ EK                                                       */
/* ======================================================================= */

export async function getDeviceModelDefinitions(
  args: { brand?: string; model?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('deviceModelDefinitions');
    q = applyCompanyScope(q, ctx);
    const snap = await q.limit(500).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => {
      const data = r as DocumentData;
      if (args.brand && !String(data.brand ?? data.marka ?? '').toLowerCase().includes(args.brand.toLowerCase())) return false;
      if (args.model && !String(data.model ?? '').toLowerCase().includes(args.model.toLowerCase())) return false;
      return true;
    });
    return { ok: true, label: 'get_device_model_definitions', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Cihaz modeli tanımı yok.' : undefined };
  } catch (e) {
    return err('get_device_model_definitions', e);
  }
}

export async function getDeviceBrandModels(
  args: { brand?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('deviceBrandModels');
    q = applyCompanyScope(q, ctx);
    const snap = await q.limit(500).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) =>
      !args.brand || String((r as DocumentData).brand ?? (r as DocumentData).marka ?? '').toLowerCase().includes(args.brand.toLowerCase()),
    );
    return { ok: true, label: 'get_device_brand_models', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Marka-model kaydı yok.' : undefined };
  } catch (e) {
    return err('get_device_brand_models', e);
  }
}

export async function getFaultDefinitions(
  args: { type?: string },
  _ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('faultDefinitions');
    if (args.type) q = whereAliased(q, 'faultDefinitions', 'type', args.type);
    const snap = await q.limit(500).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_fault_definitions', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Arıza tanımı yok.' : undefined };
  } catch (e) {
    return err('get_fault_definitions', e);
  }
}

export async function getPeriodicPartChanges(
  args: { deviceId?: string; hospitalId?: string; kind?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const kind = (args.kind ?? 'plans') as 'plans' | 'logs';
    const collection = kind === 'logs' ? 'periodicPartChangeLogs' : 'periodicPartChanges';
    let q: Query<DocumentData> = adminDb.collection(collection);
    q = applyCompanyScope(q, ctx);
    if (args.deviceId) q = q.where('deviceId', '==', args.deviceId);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_periodic_part_changes', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('hospitalId', '==', args.hospitalId);
    }
    const snap = await q.limit(200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_periodic_part_changes', data: { kind, rows }, scanned: snap.size, notice: rows.length === 0 ? 'Periyodik parça değişimi yok.' : undefined };
  } catch (e) {
    return err('get_periodic_part_changes', e);
  }
}

export async function getHospitalDeviceAssignments(
  args: { hospitalId?: string; deviceId?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('hospitalDeviceAssignments');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_hospital_device_assignments', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('hospitalId', '==', args.hospitalId);
    }
    if (args.deviceId) q = q.where('deviceId', '==', args.deviceId);
    const snap = await q.limit(500).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => canSeeLab(ctx, (r as DocumentData).hospitalId));
    return { ok: true, label: 'get_hospital_device_assignments', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Atama kaydı yok.' : undefined };
  } catch (e) {
    return err('get_hospital_device_assignments', e);
  }
}

export async function getOtherCompanyFaults(
  args: { hospitalId?: string; status?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('digerFirmaArizalar');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_other_company_faults', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('hospitalId', '==', args.hospitalId);
    }
    if (args.status && args.status !== 'all') q = whereAliased(q, 'digerFirmaArizalar', 'status', args.status);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_other_company_faults', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Diğer firma arızası yok.' : undefined };
  } catch (e) {
    return err('get_other_company_faults', e);
  }
}

/* ======================================================================= */
/* YEDEK PARÇA                                                             */
/* ======================================================================= */

export async function getSparePartStock(
  args: { depotId?: string; partCode?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('yedekParcaDepoStok');
    q = applyCompanyScope(q, ctx);
    if (args.depotId) {
      if (!canSeeDepot(ctx, args.depotId)) {
        return { ok: false, label: 'get_spare_part_stock', data: null, notice: 'Depo yetkin dışında.' };
      }
      q = q.where('depotId', '==', args.depotId);
    }
    if (args.partCode) q = q.where('stokKodu', '==', args.partCode);
    const snap = await q.limit(args.limit ?? 500).get();
    const agg: Record<string, { stokKodu: string; stokAdi: string; depotName?: string; depotId?: string; adet: number; lots: Set<string> }> = {};
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!canSeeDepot(ctx, d.depotId)) continue;
      const key = `${d.depotId}|${d.stokKodu}`;
      if (!agg[key]) agg[key] = { stokKodu: d.stokKodu, stokAdi: d.stokAdi, depotName: d.depotName, depotId: d.depotId, adet: 0, lots: new Set() };
      agg[key].adet += 1;
      if (d.lotNumarasi) agg[key].lots.add(d.lotNumarasi);
    }
    const rows = Object.values(agg).map((r) => ({ ...r, lotSayisi: r.lots.size, lots: undefined }));
    rows.sort((a, b) => b.adet - a.adet);
    return { ok: true, label: 'get_spare_part_stock', data: rows.slice(0, 200), scanned: snap.size, notice: rows.length === 0 ? 'Yedek parça stoğu yok.' : undefined };
  } catch (e) {
    return err('get_spare_part_stock', e);
  }
}

export async function getSparePartMinMax(
  args: { depotId?: string; partCode?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('yedekParcaDepoMinMax');
    q = applyCompanyScope(q, ctx);
    if (args.depotId) q = q.where('depotId', '==', args.depotId);
    if (args.partCode) q = q.where('stokKodu', '==', args.partCode);
    const snap = await q.limit(300).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => canSeeDepot(ctx, (r as DocumentData).depotId));
    return { ok: true, label: 'get_spare_part_min_max', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Min/max yok.' : undefined };
  } catch (e) {
    return err('get_spare_part_min_max', e);
  }
}

export async function getSparePartLog(
  args: { depotId?: string; partCode?: string; days?: number; action?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('yedekParcaDepoLog');
    q = applyCompanyScope(q, ctx);
    if (args.depotId) q = q.where('depotId', '==', args.depotId);
    if (args.partCode) q = q.where('stokKodu', '==', args.partCode);
    if (args.action) q = whereAliased(q, 'yedekParcaDepoLog', 'action', args.action);
    if (args.days) q = q.where('timestamp', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => canSeeDepot(ctx, (r as DocumentData).depotId));
    return { ok: true, label: 'get_spare_part_log', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Yedek parça log\'u yok.' : undefined };
  } catch (e) {
    return err('get_spare_part_log', e);
  }
}

export async function getSparePartOrders(
  args: { status?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('yedekParcaSiparisler');
    q = applyCompanyScope(q, ctx);
    if (args.status && args.status !== 'all') q = whereAliased(q, 'yedekParcaSiparisler', 'status', args.status);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_spare_part_orders', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Yedek parça siparişi yok.' : undefined };
  } catch (e) {
    return err('get_spare_part_orders', e);
  }
}

export async function getSparePartTransfers(
  args: { uid?: string; action?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('sparePartTransferLogs');
    q = applyCompanyScope(q, ctx);
    if (args.uid) q = q.where('userId', '==', args.uid);
    if (args.action) q = whereAliased(q, 'sparePartTransferLogs', 'action', args.action);
    if (args.days) q = q.where('timestamp', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_spare_part_transfers', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Yedek parça transferi yok.' : undefined };
  } catch (e) {
    return err('get_spare_part_transfers', e);
  }
}

export async function getPersonalSpareStock(
  args: { userId?: string; partCode?: string; status?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!ctx.isAdmin && args.userId && args.userId !== ctx.uid) {
      return { ok: false, label: 'get_personal_spare_stock', data: null, notice: 'Sadece kendi kişisel stoğunu görebilirsin.' };
    }
    let q: Query<DocumentData> = adminDb.collection('personalStock');
    q = applyCompanyScope(q, ctx);
    const filterUid = args.userId ?? (ctx.isAdmin ? undefined : ctx.uid);
    if (filterUid) q = q.where('userId', '==', filterUid);
    if (args.partCode) q = q.where('stokKodu', '==', args.partCode);
    if (args.status) q = whereAliased(q, 'personalStock', 'status', args.status);
    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_personal_spare_stock', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Kişisel zimmet yok.' : undefined };
  } catch (e) {
    return err('get_personal_spare_stock', e);
  }
}

export async function getPoolWarehouseStock(
  args: { poolId?: string; partCode?: string; status?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('poolWarehouseStock');
    q = applyCompanyScope(q, ctx);
    if (args.poolId) q = q.where('poolId', '==', args.poolId);
    if (args.partCode) q = q.where('stokKodu', '==', args.partCode);
    if (args.status) q = whereAliased(q, 'poolWarehouseStock', 'status', args.status);
    const snap = await q.limit(500).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_pool_warehouse_stock', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Havuz depo stoğu yok.' : undefined };
  } catch (e) {
    return err('get_pool_warehouse_stock', e);
  }
}

export async function getPendingReturns(
  args: { userId?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('pendingReturns');
    q = applyCompanyScope(q, ctx);
    const filterUid = args.userId ?? (ctx.isAdmin ? undefined : ctx.uid);
    if (filterUid) q = q.where('userId', '==', filterUid);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_pending_returns', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Bekleyen iade yok.' : undefined };
  } catch (e) {
    return err('get_pending_returns', e);
  }
}

export async function getBorrowedSpareParts(
  args: { fromDepotId?: string; toCompany?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('borrowedSpareParts');
    q = applyCompanyScope(q, ctx);
    if (args.fromDepotId) q = q.where('fromDepotId', '==', args.fromDepotId);
    if (args.toCompany) q = q.where('toCompany', '==', args.toCompany);
    const snap = await q.limit(200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_borrowed_spare_parts', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Ödünç verilen parça yok.' : undefined };
  } catch (e) {
    return err('get_borrowed_spare_parts', e);
  }
}

export async function getPostClosurePartChanges(
  args: { deviceId?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('postClosurePartChangeLogs');
    q = applyCompanyScope(q, ctx);
    if (args.deviceId) q = q.where('deviceId', '==', args.deviceId);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_post_closure_part_changes', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Arıza sonrası değişim yok.' : undefined };
  } catch (e) {
    return err('get_post_closure_part_changes', e);
  }
}

/* ======================================================================= */
/* YÖNETİM TANIMLARI / KATALOG                                             */
/* ======================================================================= */

const DEFINITION_COLLECTIONS: Record<string, string> = {
  marka: 'def_brands',
  cihaz_grubu: 'def_deviceGroups',
  lab_grubu: 'def_labGroups',
  birim: 'def_mainUnits',
  urun_grubu: 'def_productGroups',
  test_grubu: 'def_testGroups',
  test: 'testDefinitions',
};

export async function getDefinitions(
  args: { kind: string; searchText?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const col = DEFINITION_COLLECTIONS[args.kind];
    if (!col) {
      return { ok: false, label: 'get_definitions', data: null, notice: `Bilinmeyen kind: ${args.kind}. Geçerli: ${Object.keys(DEFINITION_COLLECTIONS).join(', ')}` };
    }
    let q: Query<DocumentData> = adminDb.collection(col);
    if (col !== 'testDefinitions') q = applyCompanyScope(q, ctx);
    const snap = await q.limit(args.limit ?? 500).get();
    const needle = args.searchText ? normaliseLocal(args.searchText) : '';
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => {
      if (!needle) return true;
      const data = r as DocumentData;
      const txt = normaliseLocal(`${data.name ?? ''} ${data.ad ?? ''} ${data.kod ?? ''}`);
      return txt.includes(needle);
    });
    return { ok: true, label: 'get_definitions', data: { kind: args.kind, collection: col, rows: rows.slice(0, 200) }, scanned: snap.size, notice: rows.length === 0 ? 'Eşleşen tanım yok.' : undefined };
  } catch (e) {
    return err('get_definitions', e);
  }
}

export async function getCompanies(
  args: { limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!ctx.isAdmin) {
      // Non-admins only see their own company
      const snap = await adminDb.collection('companies').doc(ctx.companyId ?? '').get();
      const data = snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
      return { ok: true, label: 'get_companies', data, scanned: 1 };
    }
    const snap = await adminDb.collection('companies').limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_companies', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Şirket kaydı yok.' : undefined };
  } catch (e) {
    return err('get_companies', e);
  }
}

export async function getDepots(
  args: { companyId?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('depots');
    q = applyCompanyScope(q, ctx);
    if (args.companyId && ctx.isSuperAdmin) q = q.where('companyId', '==', args.companyId);
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => canSeeDepot(ctx, (r as DocumentData).id ?? d_id(r)));
    return { ok: true, label: 'get_depots', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Depo yok.' : undefined };
  } catch (e) {
    return err('get_depots', e);
  }
}

function d_id(r: unknown): string | undefined { return (r as { id?: string })?.id; }

export async function getAddressDefinitions(
  args: { searchText?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('addressDefinitions');
    q = applyCompanyScope(q, ctx);
    const snap = await q.limit(args.limit ?? 500).get();
    const needle = args.searchText ? normaliseLocal(args.searchText) : '';
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => {
      if (!needle) return true;
      const data = r as DocumentData;
      const txt = normaliseLocal(`${data.name ?? ''} ${data.address ?? ''} ${data.kisaAd ?? ''}`);
      return txt.includes(needle);
    });
    return { ok: true, label: 'get_address_definitions', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Adres tanımı yok.' : undefined };
  } catch (e) {
    return err('get_address_definitions', e);
  }
}

export async function getBarcodeFormats(
  args: { brand?: string; searchText?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('barcodeFormats');
    q = applyCompanyScope(q, ctx);
    const snap = await q.limit(args.limit ?? 500).get();
    const needle = args.searchText ? normaliseLocal(args.searchText) : '';
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => {
      const data = r as DocumentData;
      if (args.brand && !String(data.brand ?? data.marka ?? '').toLowerCase().includes(args.brand.toLowerCase())) return false;
      if (needle) {
        const txt = normaliseLocal(`${data.name ?? ''} ${data.format ?? ''} ${data.brand ?? ''}`);
        if (!txt.includes(needle)) return false;
      }
      return true;
    });
    return { ok: true, label: 'get_barcode_formats', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Barkod formatı yok.' : undefined };
  } catch (e) {
    return err('get_barcode_formats', e);
  }
}

export async function getAssets(
  args: { category?: string; konum?: string; zimmetliKisi?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('assets');
    q = applyCompanyScope(q, ctx);
    if (args.category) q = q.where('category', '==', args.category);
    const snap = await q.limit(args.limit ?? 500).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => {
      const data = r as DocumentData;
      if (args.konum && !String(data.konum ?? '').toLowerCase().includes(args.konum.toLowerCase())) return false;
      if (args.zimmetliKisi && !String(data.zimmetliKisi ?? '').toLowerCase().includes(args.zimmetliKisi.toLowerCase())) return false;
      return true;
    });
    return { ok: true, label: 'get_assets', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Demirbaş yok.' : undefined };
  } catch (e) {
    return err('get_assets', e);
  }
}

export async function getAssetCategories(_args: unknown, ctx: PermissionContext): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('assetCategories');
    q = applyCompanyScope(q, ctx);
    const snap = await q.limit(100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_asset_categories', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Kategori yok.' : undefined };
  } catch (e) {
    return err('get_asset_categories', e);
  }
}

export async function getVehicles(
  args: { searchText?: string },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('vehicles');
    q = applyCompanyScope(q, ctx);
    const snap = await q.limit(200).get();
    const needle = args.searchText ? normaliseLocal(args.searchText) : '';
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => {
      if (!needle) return true;
      const data = r as DocumentData;
      return normaliseLocal(`${data.plate ?? ''} ${data.brand ?? ''} ${data.model ?? ''} ${data.driverName ?? ''}`).includes(needle);
    });
    return { ok: true, label: 'get_vehicles', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Araç yok.' : undefined };
  } catch (e) {
    return err('get_vehicles', e);
  }
}

export async function getBorcDepots(_args: unknown, ctx: PermissionContext): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('borcDepots');
    q = applyCompanyScope(q, ctx);
    const snap = await q.limit(100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_borc_depots', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Borç depo yok.' : undefined };
  } catch (e) {
    return err('get_borc_depots', e);
  }
}

export async function getBorcTransfers(
  args: { days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('borcTransfers');
    q = applyCompanyScope(q, ctx);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_borc_transfers', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Borç transferi yok.' : undefined };
  } catch (e) {
    return err('get_borc_transfers', e);
  }
}

/* ======================================================================= */
/* RAPORLAMA / DOSYA / SATIN ALMA / LOJİSTİK / NÖBET                       */
/* ======================================================================= */

export async function getIrsaliyeFiles(
  args: { kind?: string; depotId?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    const col = args.kind === 'files' ? 'irsaliyeFiles' : 'irsaliyeDosyalari';
    let q: Query<DocumentData> = adminDb.collection(col);
    q = applyCompanyScope(q, ctx);
    if (args.depotId) q = q.where('depotId', '==', args.depotId);
    if (args.days) q = q.where('uploadedAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        depotId: data.depotId,
        depotName: data.depotName,
        irsaliyeNo: data.irsaliyeNo,
        supplierName: data.supplierName ?? data.tedarikciAdi,
        uploadedAt: tsToShort(data.uploadedAt ?? data.createdAt),
        fileUrl: data.fileUrl ?? data.url,
        ocrStatus: data.ocrStatus,
      };
    });
    return { ok: true, label: 'get_irsaliye_files', data: { collection: col, rows }, scanned: snap.size, notice: rows.length === 0 ? 'İrsaliye dosyası yok.' : undefined };
  } catch (e) {
    return err('get_irsaliye_files', e);
  }
}

export async function getAnalysisResults(
  args: { days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('analysis_results');
    q = applyCompanyScope(q, ctx);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 50).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_analysis_results', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Analiz sonucu yok.' : undefined };
  } catch (e) {
    return err('get_analysis_results', e);
  }
}

export async function getArchiveRacks(
  args: { hospitalId?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('archiveRacks');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_archive_racks', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('hospitalId', '==', args.hospitalId);
    }
    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !args.hospitalId || canSeeLab(ctx, (r as DocumentData).hospitalId));
    return { ok: true, label: 'get_archive_racks', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Arşiv rafı yok.' : undefined };
  } catch (e) {
    return err('get_archive_racks', e);
  }
}

export async function getRoutes(
  args: { days?: number; status?: string; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('routes');
    q = applyCompanyScope(q, ctx);
    if (args.status) q = whereAliased(q, 'routes', 'status', args.status);
    if (args.days) q = q.where('date', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_routes', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Rota kaydı yok.' : undefined };
  } catch (e) {
    return err('get_routes', e);
  }
}

export async function getPurchasingTasks(
  args: { status?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('purchasingTasks');
    q = applyCompanyScope(q, ctx);
    if (args.status) q = whereAliased(q, 'purchasingTasks', 'status', args.status);
    if (args.days) q = q.where('date', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_purchasing_tasks', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Satın alma görevi yok.' : undefined };
  } catch (e) {
    return err('get_purchasing_tasks', e);
  }
}

export async function getPurchasingWorkflows(
  args: { limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('purchasingWorkflows');
    q = applyCompanyScope(q, ctx);
    const snap = await q.limit(args.limit ?? 50).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_purchasing_workflows', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'İş akışı yok.' : undefined };
  } catch (e) {
    return err('get_purchasing_workflows', e);
  }
}

export async function getPendingCeomedIrsaliye(
  args: { days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('pendingCeomedIrsaliye');
    q = applyCompanyScope(q, ctx);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_pending_ceomed_irsaliye', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Bekleyen CEOMED irsaliye yok.' : undefined };
  } catch (e) {
    return err('get_pending_ceomed_irsaliye', e);
  }
}

export async function getDutyShifts(
  args: { uid?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('dutyShifts');
    q = applyCompanyScope(q, ctx);
    const filterUid = args.uid ?? (ctx.isAdmin ? undefined : ctx.uid);
    if (filterUid) q = q.where('uid', '==', filterUid);
    if (args.days) q = q.where('date', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_duty_shifts', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Nöbet yok.' : undefined };
  } catch (e) {
    return err('get_duty_shifts', e);
  }
}

export async function getShiftSchedules(
  args: { uid?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('shiftSchedules');
    q = applyCompanyScope(q, ctx);
    const filterUid = args.uid ?? (ctx.isAdmin ? undefined : ctx.uid);
    if (filterUid) q = q.where('uid', '==', filterUid);
    if (args.days) q = q.where('date', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_shift_schedules', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Vardiya yok.' : undefined };
  } catch (e) {
    return err('get_shift_schedules', e);
  }
}

export async function getPersonnelHistory(
  args: { uid?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!ctx.isAdmin) {
      return { ok: false, label: 'get_personnel_history', data: null, notice: 'Personel hareket logları yalnızca admin yetkili kullanıcıya açık.' };
    }
    let q: Query<DocumentData> = adminDb.collection('personnelHistoryLogs');
    q = applyCompanyScope(q, ctx);
    if (args.uid) q = q.where('uid', '==', args.uid);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { ok: true, label: 'get_personnel_history', data: rows, scanned: snap.size, notice: rows.length === 0 ? 'Personel hareket logu yok.' : undefined };
  } catch (e) {
    return err('get_personnel_history', e);
  }
}

/* ======================================================================= */
/* TEKNİK SERVİS BİLGİ TABANI (teknik_doc.txt)                            */
/* ======================================================================= */

let kbContent: string | null = null;
let kbLines: string[] | null = null;

async function loadKnowledgeBase(): Promise<string[]> {
  if (kbLines) return kbLines;
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const filePath = path.join(process.cwd(), 'public', 'teknik_doc.txt');
    kbContent = await fs.readFile(filePath, 'utf-8');
    kbLines = kbContent.split('\n');
    aiLogger.info('Knowledge base loaded', { lines: kbLines.length, bytes: kbContent.length });
    return kbLines;
  } catch (e) {
    aiLogger.warn('Knowledge base load failed', { message: (e as Error).message });
    kbLines = [];
    return kbLines;
  }
}

export async function searchKnowledgeBase(
  args: { query: string; limit?: number },
  _ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    if (!args.query || args.query.trim().length === 0) {
      return { ok: false, label: 'search_knowledge_base', data: null, notice: 'Sorgu boş.' };
    }
    const lines = await loadKnowledgeBase();
    if (lines.length === 0) {
      return { ok: true, label: 'search_knowledge_base', data: [], notice: 'Bilgi tabanı yüklenemedi.' };
    }
    const limit = Math.min(args.limit ?? 4, 6);
    const tokens = args.query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.length === 0) return { ok: true, label: 'search_knowledge_base', data: [], notice: 'Geçerli arama terimi yok.' };

    // Score lines: token-hit count, with bonus for proximity in same line
    const scored: Array<{ index: number; score: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      let hits = 0;
      for (const t of tokens) if (lower.includes(t)) hits++;
      if (hits > 0) scored.push({ index: i, score: hits / tokens.length });
    }
    scored.sort((a, b) => b.score - a.score);

    const results: Array<{ context: string; lineNumber: number; score: number }> = [];
    const taken = new Set<number>();
    for (const { index, score } of scored) {
      if (results.length >= limit) break;
      // Skip overlapping results
      let skip = false;
      for (const t of Array.from(taken)) if (Math.abs(t - index) < 8) { skip = true; break; }
      if (skip) continue;
      taken.add(index);
      const start = Math.max(0, index - 3);
      const end = Math.min(lines.length, index + 5);
      const excerpt = lines.slice(start, end).join('\n').slice(0, 700);
      results.push({ context: excerpt, lineNumber: index + 1, score: round(score) });
    }

    return {
      ok: true,
      label: 'search_knowledge_base',
      data: { query: args.query, results },
      scanned: lines.length,
      notice: results.length === 0 ? 'Bilgi tabanında eşleşme bulunamadı.' : undefined,
    };
  } catch (e) {
    return err('search_knowledge_base', e);
  }
}

/* ----------------------------------------------------------------------- */
/* Dispatcher                                                              */
/* ----------------------------------------------------------------------- */

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  switch (name) {
    case 'resolve_entities':
      return resolveEntities(args as Parameters<typeof resolveEntities>[0], ctx);
    case 'list_hospitals':
      return listHospitals(args, ctx);
    case 'get_product_definition':
      return getProductDefinition(args as Parameters<typeof getProductDefinition>[0], ctx);
    case 'get_lab_stock':
      return getLabStock(args as Parameters<typeof getLabStock>[0], ctx);
    case 'get_depot_stock':
      return getDepotStock(args as Parameters<typeof getDepotStock>[0], ctx);
    case 'get_min_max_rules':
      return getMinMaxRules(args as Parameters<typeof getMinMaxRules>[0], ctx);
    case 'get_consumption':
      return getConsumption(args as Parameters<typeof getConsumption>[0], ctx);
    case 'get_expiring_stock':
      return getExpiringStock(args as Parameters<typeof getExpiringStock>[0], ctx);
    case 'get_efficiency':
      return getEfficiency(args as Parameters<typeof getEfficiency>[0], ctx);
    case 'get_devices':
      return getDevices(args as Parameters<typeof getDevices>[0], ctx);
    case 'get_device_faults':
      return getDeviceFaults(args as Parameters<typeof getDeviceFaults>[0], ctx);
    case 'get_recent_stock_entries':
      return getRecentStockEntries(args as Parameters<typeof getRecentStockEntries>[0], ctx);
    case 'get_orders':
      return getOrders(args as Parameters<typeof getOrders>[0], ctx);
    case 'find_labs_low_on_product':
      return findLabsLowOnProduct(args as Parameters<typeof findLabsLowOnProduct>[0], ctx);

    // ===== Arıza derin analiz =====
    case 'get_fault_detail':
      return getFaultDetail(args as Parameters<typeof getFaultDetail>[0], ctx);
    case 'get_device_fault_history':
      return getDeviceFaultHistory(args as Parameters<typeof getDeviceFaultHistory>[0], ctx);
    case 'get_fault_sla_violations':
      return getFaultSlaViolations(args as Parameters<typeof getFaultSlaViolations>[0], ctx);
    case 'get_fault_action_forms':
      return getFaultActionForms(args as Parameters<typeof getFaultActionForms>[0], ctx);
    case 'get_lab_devices_status':
      return getLabDevicesStatus(args as Parameters<typeof getLabDevicesStatus>[0], ctx);

    // ===== Kullanıcı / Personel =====
    case 'get_user_profile':
      return getUserProfile(args as Parameters<typeof getUserProfile>[0], ctx);
    case 'list_users':
      return listUsers(args as Parameters<typeof listUsers>[0], ctx);
    case 'get_user_activity':
      return getUserActivity(args as Parameters<typeof getUserActivity>[0], ctx);
    case 'get_personnel_record':
      return getPersonnelRecord(args as Parameters<typeof getPersonnelRecord>[0], ctx);
    case 'get_personnel_availability':
      return getPersonnelAvailability(args as Parameters<typeof getPersonnelAvailability>[0], ctx);
    case 'get_expense_periods':
      return getExpensePeriods(args as Parameters<typeof getExpensePeriods>[0], ctx);
    case 'get_overtime_requests':
      return getOvertimeRequests(args as Parameters<typeof getOvertimeRequests>[0], ctx);

    // ===== Sipariş zinciri =====
    case 'get_shipments':
      return getShipments(args as Parameters<typeof getShipments>[0], ctx);
    case 'get_transfers':
      return getTransfers(args as Parameters<typeof getTransfers>[0], ctx);
    case 'get_verification_reports':
      return getVerificationReports(args as Parameters<typeof getVerificationReports>[0], ctx);
    case 'get_product_returns':
      return getProductReturns(args as Parameters<typeof getProductReturns>[0], ctx);

    // ===== Ejected / Destroyed / Trash =====
    case 'get_ejected_kits':
      return getEjectedKits(args as Parameters<typeof getEjectedKits>[0], ctx);
    case 'get_destroyed_kits':
      return getDestroyedKits(args as Parameters<typeof getDestroyedKits>[0], ctx);
    case 'get_trash_bin':
      return getTrashBin(args as Parameters<typeof getTrashBin>[0], ctx);

    // ===== Talep / Bildirim / Sayım / Bakım =====
    case 'get_user_requests':
      return getUserRequests(args as Parameters<typeof getUserRequests>[0], ctx);
    case 'get_notifications':
      return getNotifications(args as Parameters<typeof getNotifications>[0], ctx);
    case 'get_count_sessions':
      return getCountSessions(args as Parameters<typeof getCountSessions>[0], ctx);
    case 'get_maintenance':
      return getMaintenance(args as Parameters<typeof getMaintenance>[0], ctx);

    // ===== Mal kabul / Sipariş ek / Verimlilik ek / Tüketim ek =====
    case 'get_mal_kabul_history':
      return getMalKabulHistory(args as Parameters<typeof getMalKabulHistory>[0], ctx);
    case 'get_central_orders':
      return getCentralOrders(args as Parameters<typeof getCentralOrders>[0], ctx);
    case 'get_consumable_requests':
      return getConsumableRequests(args as Parameters<typeof getConsumableRequests>[0], ctx);
    case 'get_total_efficiency_records':
      return getTotalEfficiencyRecords(args as Parameters<typeof getTotalEfficiencyRecords>[0], ctx);
    case 'get_cihaz_ustu_history':
      return getCihazUstuHistory(args as Parameters<typeof getCihazUstuHistory>[0], ctx);
    case 'get_kumulatif_raporlar':
      return getKumulatifRaporlar(args as Parameters<typeof getKumulatifRaporlar>[0], ctx);
    case 'get_cost_checkpoints':
      return getCostCheckpoints(args as Parameters<typeof getCostCheckpoints>[0], ctx);
    case 'get_daily_consumption_stats':
      return getDailyConsumptionStats(args as Parameters<typeof getDailyConsumptionStats>[0], ctx);
    case 'get_nfc_disposal_events':
      return getNfcDisposalEvents(args as Parameters<typeof getNfcDisposalEvents>[0], ctx);

    // ===== Cihaz yönetimi ek =====
    case 'get_device_model_definitions':
      return getDeviceModelDefinitions(args as Parameters<typeof getDeviceModelDefinitions>[0], ctx);
    case 'get_device_brand_models':
      return getDeviceBrandModels(args as Parameters<typeof getDeviceBrandModels>[0], ctx);
    case 'get_fault_definitions':
      return getFaultDefinitions(args as Parameters<typeof getFaultDefinitions>[0], ctx);
    case 'get_periodic_part_changes':
      return getPeriodicPartChanges(args as Parameters<typeof getPeriodicPartChanges>[0], ctx);
    case 'get_hospital_device_assignments':
      return getHospitalDeviceAssignments(args as Parameters<typeof getHospitalDeviceAssignments>[0], ctx);
    case 'get_other_company_faults':
      return getOtherCompanyFaults(args as Parameters<typeof getOtherCompanyFaults>[0], ctx);

    // ===== Yedek parça =====
    case 'get_spare_part_stock':
      return getSparePartStock(args as Parameters<typeof getSparePartStock>[0], ctx);
    case 'get_spare_part_min_max':
      return getSparePartMinMax(args as Parameters<typeof getSparePartMinMax>[0], ctx);
    case 'get_spare_part_log':
      return getSparePartLog(args as Parameters<typeof getSparePartLog>[0], ctx);
    case 'get_spare_part_orders':
      return getSparePartOrders(args as Parameters<typeof getSparePartOrders>[0], ctx);
    case 'get_spare_part_transfers':
      return getSparePartTransfers(args as Parameters<typeof getSparePartTransfers>[0], ctx);
    case 'get_personal_spare_stock':
      return getPersonalSpareStock(args as Parameters<typeof getPersonalSpareStock>[0], ctx);
    case 'get_pool_warehouse_stock':
      return getPoolWarehouseStock(args as Parameters<typeof getPoolWarehouseStock>[0], ctx);
    case 'get_pending_returns':
      return getPendingReturns(args as Parameters<typeof getPendingReturns>[0], ctx);
    case 'get_borrowed_spare_parts':
      return getBorrowedSpareParts(args as Parameters<typeof getBorrowedSpareParts>[0], ctx);
    case 'get_post_closure_part_changes':
      return getPostClosurePartChanges(args as Parameters<typeof getPostClosurePartChanges>[0], ctx);

    // ===== Yönetim tanımları / katalog =====
    case 'get_definitions':
      return getDefinitions(args as Parameters<typeof getDefinitions>[0], ctx);
    case 'get_companies':
      return getCompanies(args as Parameters<typeof getCompanies>[0], ctx);
    case 'get_depots':
      return getDepots(args as Parameters<typeof getDepots>[0], ctx);
    case 'get_address_definitions':
      return getAddressDefinitions(args as Parameters<typeof getAddressDefinitions>[0], ctx);
    case 'get_barcode_formats':
      return getBarcodeFormats(args as Parameters<typeof getBarcodeFormats>[0], ctx);
    case 'get_assets':
      return getAssets(args as Parameters<typeof getAssets>[0], ctx);
    case 'get_asset_categories':
      return getAssetCategories(args, ctx);
    case 'get_vehicles':
      return getVehicles(args as Parameters<typeof getVehicles>[0], ctx);
    case 'get_borc_depots':
      return getBorcDepots(args, ctx);
    case 'get_borc_transfers':
      return getBorcTransfers(args as Parameters<typeof getBorcTransfers>[0], ctx);

    // ===== Raporlama / Dosya / Satın alma / Lojistik / Nöbet =====
    case 'get_irsaliye_files':
      return getIrsaliyeFiles(args as Parameters<typeof getIrsaliyeFiles>[0], ctx);
    case 'get_analysis_results':
      return getAnalysisResults(args as Parameters<typeof getAnalysisResults>[0], ctx);
    case 'get_archive_racks':
      return getArchiveRacks(args as Parameters<typeof getArchiveRacks>[0], ctx);
    case 'get_routes':
      return getRoutes(args as Parameters<typeof getRoutes>[0], ctx);
    case 'get_purchasing_tasks':
      return getPurchasingTasks(args as Parameters<typeof getPurchasingTasks>[0], ctx);
    case 'get_purchasing_workflows':
      return getPurchasingWorkflows(args as Parameters<typeof getPurchasingWorkflows>[0], ctx);
    case 'get_pending_ceomed_irsaliye':
      return getPendingCeomedIrsaliye(args as Parameters<typeof getPendingCeomedIrsaliye>[0], ctx);
    case 'get_duty_shifts':
      return getDutyShifts(args as Parameters<typeof getDutyShifts>[0], ctx);
    case 'get_shift_schedules':
      return getShiftSchedules(args as Parameters<typeof getShiftSchedules>[0], ctx);
    case 'get_personnel_history':
      return getPersonnelHistory(args as Parameters<typeof getPersonnelHistory>[0], ctx);

    // ===== Teknik servis bilgi tabanı =====
    case 'search_knowledge_base':
      return searchKnowledgeBase(args as Parameters<typeof searchKnowledgeBase>[0], ctx);
    case 'create_shortcut_draft':
      return createShortcutDraftTool(args as Parameters<typeof createShortcutDraftTool>[0], ctx);

    default:
      return { ok: false, label: name, data: null, notice: `Bilinmeyen tool: ${name}` };
  }
}
