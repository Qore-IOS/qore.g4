/**
 * Tool handlers — actual Firestore queries.
 *
 * Every handler is permission-aware: it filters by companyId, assigned labs,
 * assigned depots and brand. Handlers MUST never return data the user isn't
 * allowed to see.
 */

import { adminDb } from '@/lib/firebase-admin';
import type { Query, DocumentData, Timestamp } from 'firebase-admin/firestore';
import { aiLogger } from '@/lib/logger';
import type { PermissionContext, ToolCallResult } from './types';
import {
  canSeeBrand,
  canSeeDepot,
  canSeeLab,
} from './permissions';
import {
  getHospitalById,
  getProductByCode,
  listHospitalsForContext,
  resolveDevices,
  resolveHospitals,
  resolveProducts,
} from './resolver';

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
  return { ok: false, label, data: null, notice: message };
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
  try {
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

    let q: Query<DocumentData> = adminDb.collection('depoStok')
      .where('isShipped', '==', true)
      .where('hedefKurumId', '==', args.hospitalId);

    q = applyCompanyScope(q, ctx);
    if (args.stokKodu) q = q.where('stokKodu', '==', args.stokKodu);

    const snap = await q.limit(args.limit ?? 500).get();
    const agg: Record<string, StockAggregate> = {};

    for (const doc of snap.docs) {
      const d = doc.data();
      if (args.urunGrubu && d.urunGrubu !== args.urunGrubu) continue;
      if (!canSeeBrand(ctx, d.marka)) continue;
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

    const lots = Object.values(agg).sort((a, b) => {
      if (a.stokKodu !== b.stokKodu) return a.stokKodu.localeCompare(b.stokKodu);
      return (a.miad ?? '').localeCompare(b.miad ?? '');
    });

    // Per-product totals for easier consumption by the model
    const totals: Record<string, { stokKodu: string; stokAdi: string; toplamAdet: number; lotSayisi: number }> = {};
    for (const l of lots) {
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
        lots: lots.slice(0, 100),
        lotCount: lots.length,
      },
      scanned: snap.size,
      notice: snap.size === 0 ? 'Bu lab için kayıt bulunamadı.' : undefined,
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
  try {
    const days = args.days ?? 90;
    if (args.hospitalId && !canSeeLab(ctx, args.hospitalId)) {
      return { ok: false, label: 'get_expiring_stock', data: null, notice: 'Lab yetkin dışında.' };
    }
    let q: Query<DocumentData> = adminDb.collection('depoStok')
      .where('miad', '<=', inDaysFromNow(days));
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      q = q.where('isShipped', '==', true).where('hedefKurumId', '==', args.hospitalId);
    }
    const snap = await q.limit(args.limit ?? 1000).get();
    const agg: Record<string, { stokKodu: string; stokAdi: string; lotNumarasi?: string; miad?: string; hedefKurum?: string; hedefKurumId?: string; depotName?: string; isShipped?: boolean; adet: number }> = {};
    for (const doc of snap.docs) {
      const d = doc.data();
      // Permission guard
      if (d.isShipped && !canSeeLab(ctx, d.hedefKurumId)) continue;
      if (!d.isShipped && !canSeeDepot(ctx, d.depotId)) continue;
      if (!canSeeBrand(ctx, d.marka)) continue;
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
          isShipped: d.isShipped,
          adet: 0,
        };
      }
      agg[key].adet += 1;
    }
    const rows = Object.values(agg).sort((a, b) => (a.miad ?? '').localeCompare(b.miad ?? ''));
    return {
      ok: true,
      label: 'get_expiring_stock',
      data: { window_days: days, rows: rows.slice(0, 200), total: rows.length },
      scanned: snap.size,
      notice: rows.length === 0 ? `Önümüzdeki ${days} günde miadı dolacak ürün yok.` : undefined,
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
  args: { hospitalId?: string; status?: string; faultType?: string; days?: number; limit?: number },
  ctx: PermissionContext,
): Promise<ToolCallResult> {
  try {
    let q: Query<DocumentData> = adminDb.collection('deviceFaultReports');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) {
      if (!canSeeLab(ctx, args.hospitalId)) {
        return { ok: false, label: 'get_device_faults', data: null, notice: 'Lab yetkin dışında.' };
      }
      q = q.where('labId', '==', args.hospitalId);
    }
    if (args.status && args.status !== 'all') q = q.where('status', '==', args.status);
    if (args.faultType) q = q.where('faultType', '==', args.faultType);
    if (args.days) q = q.where('openedAt', '>=', daysAgo(args.days));

    const snap = await q.limit(args.limit ?? 200).get();
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => canSeeLab(ctx, (d as { labId?: string }).labId))
      .map((d) => {
        const data = d as DocumentData;
        return {
          id: data.id,
          labId: data.labId,
          labName: data.labName,
          model: data.model,
          serial: data.serial,
          faultType: data.faultType,
          status: data.status,
          description: data.description,
          openedAt: tsToShort(data.openedAt),
          closedAt: tsToShort(data.closedAt),
          assignedToName: data.assignedToName,
        };
      });
    return {
      ok: true,
      label: 'get_device_faults',
      data: rows,
      scanned: snap.size,
      notice: rows.length === 0 ? 'Arıza kaydı yok.' : undefined,
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
    let q: Query<DocumentData> = adminDb.collection('orders');
    q = applyCompanyScope(q, ctx);
    if (args.hospitalId) q = q.where('hedefKurumId', '==', args.hospitalId);
    if (args.status && args.status !== 'all') q = q.where('status', '==', args.status);
    if (args.days) q = q.where('createdAt', '>=', daysAgo(args.days));
    const snap = await q.limit(args.limit ?? 100).get();
    const rows = snap.docs
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
      scanned: snap.size,
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
    default:
      return { ok: false, label: name, data: null, notice: `Bilinmeyen tool: ${name}` };
  }
}
