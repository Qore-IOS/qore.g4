'use client';

import { collection, doc, setDoc, writeBatch, Timestamp } from '../../lib/data/client';
import { nanoid } from 'nanoid';
import { db } from '../../lib/data/client';
import { withCompanyScope } from '@/lib/company-scope';
import { resolveDefaultTrackingMode } from '@/lib/tracking';
import { appendSerialEventToBatch } from '@/lib/serial-ledger/client';
import type { DepoStokItem, ProductCode, Hospital, LabPool, Depot, DeviceLabPool } from '@/lib/types';

/* labs actually linked to the depot in depot management (linkedLaboratoryIds +
   deviceLabPools members for pool warehouses), EXCLUDING perifer labs. This is
   the only set of labs the depot count should categorize by — no hospital-wide
   or perifer labs leak in. */
export function resolveDepotLabs(depot: Depot | undefined, deviceLabPools: DeviceLabPool[], hospitals: Hospital[]): Hospital[] {
  if (!depot) return [];
  const ids = new Set<string>();
  (depot.linkedLaboratoryIds || []).forEach(id => id && ids.add(id));
  if (depot.isPoolWarehouse) {
    (depot.linkedDeviceLabPoolIds || []).forEach(pid => {
      const pool = deviceLabPools.find(p => p.id === pid);
      (pool?.memberIds || []).forEach(id => id && ids.add(id));
    });
  }
  const byId = new Map(hospitals.map(h => [h.id, h]));
  return Array.from(ids)
    .map(id => byId.get(id))
    .filter((h): h is Hospital => !!h && !h.perifer);
}

/* one row per product (stokKodu) within the selected depot */
export interface ProductGroup {
  stokKodu: string;
  stokAdi: string;
  labId: string;          // resolved lab group id ('' for undefined)
  labName: string;        // resolved lab / pool main-lab display name
  urunGrubu?: string;
  ambalajDegeri?: number;
  serial: boolean;        // serial-tracked
  docs: DepoStokItem[];   // depot docs (!isShipped) — a doc's `adet` field may be >1 (bulk mal kabul)
  serials: string[];      // distinct seriNumarasi across docs (serial products)
  currentQty: number;     // sum of each doc's qty (mevcut stok) — matches stok yönetimi's totals
}

export interface LabGroup { labId: string; labName: string; products: ProductGroup[]; }

/* a depoStok doc can represent more than one physical unit (bulk mal kabul writes a
   single doc with adet=N instead of N per-unit docs) — mirrors the same fallback
   stok-yönetimi uses (getPaginatedDepotStock) so "mevcut" always matches reality. */
export function qtyOf(d: DepoStokItem): number {
  const adet = (d as any).adet;
  return (typeof adet === 'number' && adet > 0) ? adet : 1;
}

export function docTimeMillis(d: DepoStokItem): number {
  const v: any = (d as any).eklenmeTarihi;
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/* live per-product count state (keyed by stokKodu) */
export interface CountState {
  countedAdet: string;             // manual number (string to allow empty)
  scannedSerials: Set<string>;     // scanned serial numbers (serial products)
  counted: boolean;                // explicit completion (green + saved) — like maliyet
  touched: boolean;                // user typed something (value present)
}
export const emptyCount = (): CountState => ({ countedAdet: '', scannedSerials: new Set(), counted: false, touched: false });

/* invert Record<hospitalId, MinMaxRule[]> → Map<stokKodu, hospitalId[]> */
export function buildStokToHospitals(allRules: Record<string, { stokKodu: string }[]>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  Object.entries(allRules || {}).forEach(([hid, rules]) => {
    (rules || []).forEach(r => {
      if (!r?.stokKodu) return;
      const arr = m.get(r.stokKodu) || [];
      if (!arr.includes(hid)) arr.push(hid);
      m.set(r.stokKodu, arr);
    });
  });
  return m;
}

const UNDEFINED_LAB = '__undefined__';

/* resolve a product's display lab group (pool members collapse to the pool main-lab name) */
function resolveLab(stokKodu: string, stokToHospitals: Map<string, string[]>, hospitalsById: Map<string, Hospital>, labPools: LabPool[]): { labId: string; labName: string } {
  const owners = stokToHospitals.get(stokKodu) || [];
  const hid = owners[0];
  if (!hid) return { labId: UNDEFINED_LAB, labName: 'Tanımsız' };
  const pool = labPools.find(p => p.memberIds?.includes(hid));
  if (pool) {
    const mainName = pool.mainLabId ? hospitalsById.get(pool.mainLabId)?.name : undefined;
    return { labId: pool.mainLabId || pool.id, labName: mainName || pool.name || 'Havuz' };
  }
  return { labId: hid, labName: hospitalsById.get(hid)?.name || 'Laboratuvar' };
}

/* a real (non-placeholder) serial number — excludes the FAZLA-/SAYIM- synthetic
   ids the count itself creates for filler/surplus docs */
export const isSyntheticSerial = (s: string) => /^(FAZLA|SAYIM)-/i.test(s);

/* same "is this product serial-tracked" call the count/reconciliation makes:
   the product's own tracking mode, or (fallback) any real serial already on its docs */
export function isSerialClassified(docs: DepoStokItem[], product?: { trackingMode?: ProductCode['trackingMode']; marka?: string; manufacturer?: string; stokAdi?: string }): boolean {
  if (product && resolveDefaultTrackingMode(product as any) === 'serial') return true;
  return docs.some(d => { const s = (d.seriNumarasi || '').trim(); return !!s && !isSyntheticSerial(s); });
}

/* group a depot's stock into labs → products (matches the "x,y,z under lab A" requirement) */
export function buildLabGroups(
  depotStock: DepoStokItem[],
  productCodes: ProductCode[],
  stokToHospitals: Map<string, string[]>,
  hospitals: Hospital[],
  labPools: LabPool[],
): LabGroup[] {
  const productsByCode = new Map(productCodes.map(p => [p.stokKodu, p]));
  const hospitalsById = new Map(hospitals.map(h => [h.id, h]));

  // group depot docs by stokKodu
  const docsByStok = new Map<string, DepoStokItem[]>();
  depotStock.forEach(d => {
    if (d.isShipped) return;
    const arr = docsByStok.get(d.stokKodu) || [];
    arr.push(d);
    docsByStok.set(d.stokKodu, arr);
  });

  const labMap = new Map<string, LabGroup>();
  docsByStok.forEach((docs, stokKodu) => {
    const p = productsByCode.get(stokKodu); // may be undefined if the catalog hasn't loaded — depoStok carries enough
    const { labId, labName } = resolveLab(stokKodu, stokToHospitals, hospitalsById, labPools);
    // real serials only (exclude synthetic FAZLA-/SAYIM- placeholders)
    const serials = Array.from(new Set(docs.map(d => (d.seriNumarasi || '').trim()).filter(s => s && !isSyntheticSerial(s))));
    const serial = isSerialClassified(docs, p);
    const group: ProductGroup = {
      stokKodu,
      stokAdi: p?.stokAdi || docs[0]?.stokAdi || stokKodu,
      labId, labName,
      urunGrubu: p?.urunGrubu || docs[0]?.urunGrubu,
      ambalajDegeri: p?.ambalajDegeri ?? docs[0]?.ambalajDegeri,
      serial,
      docs, serials, currentQty: docs.reduce((s, d) => s + qtyOf(d), 0),
    };
    const lg = labMap.get(labId) || { labId, labName, products: [] };
    lg.products.push(group);
    labMap.set(labId, lg);
  });

  const groups = Array.from(labMap.values());
  groups.forEach(g => g.products.sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr')));
  // undefined lab last, others alphabetical
  groups.sort((a, b) => {
    if (a.labId === UNDEFINED_LAB) return 1;
    if (b.labId === UNDEFINED_LAB) return -1;
    return a.labName.localeCompare(b.labName, 'tr');
  });
  return groups;
}

/* counted amount for a product (serial: scanned count if any scanned, else manual) */
export function countedOf(g: ProductGroup, s?: CountState): number {
  if (!s) return 0;
  if (g.serial && s.scannedSerials.size > 0) return s.scannedSerials.size;
  return parseInt(s.countedAdet, 10) || 0;
}
export function isCountedRow(g: ProductGroup, s?: CountState): boolean {
  if (!s) return false;
  return s.counted || (g.serial && s.scannedSerials.size > 0);
}

export interface SaveSummary { deleted: number; created: number; sessions: number; touched: number; }

export interface DepoCountHistoryItem {
  stokKodu: string;
  stokAdi: string;
  labName: string;
  serialTracked: boolean;
  currentQty: number;
  countedQty: number;
  expectedSerials: string[];
  countedSerials: string[];
  deletedSerials: string[];
}

/* Reconcile the depot's depoStok docs so the count matches the counted amount, then write a session.
   - serial with scans: delete docs whose serial was NOT scanned (identity-based)
   - everything else (non-serial, or serial counted manually without scanning): reduce/increase
     total quantity oldest-first. A doc can represent >1 unit (bulk mal kabul writes adet=N on
     a single doc instead of N per-unit docs), so a partial reduction decrements `adet` instead
     of deleting the doc outright — this keeps the count in sync with stok yönetimi, which sums
     `adet` the same way (see getPaginatedDepotStock). */
export async function saveDepoCount(params: {
  groups: LabGroup[];
  states: Record<string, CountState>;
  depot: { id: string; name: string };
  companyId: string;
  user: { uid: string; name: string };
}): Promise<SaveSummary> {
  const { groups, states, depot, companyId, user } = params;
  const now = Timestamp.now();
  // Her `op` birden çok Firestore yazımı üretebilir (bir seri düşümü: eski
  // geçmiş kaydı + defter satırı + defter olayı = 3 yazım). Parti bölme bu
  // yüzden op SAYISINA değil, ürettikleri YAZIM SAYISINA göre yapılır; aksi
  // hâlde 450 op kolayca 500 yazım sınırını aşar ve sayım kaydedilemez.
  const ops: Array<{ run: (batch: ReturnType<typeof writeBatch>) => void; cost: number }> = [];
  const pushOp = (run: (batch: ReturnType<typeof writeBatch>) => void, cost = 1) => ops.push({ run, cost });
  /* eski geçmiş kaydı + defter satırı (merge) + defter olayı */
  const SERIAL_DEPARTURE_COST = 3;
  let deleted = 0, created = 0, touched = 0;
  let totalCurrent = 0, totalCounted = 0;
  const historyItems: DepoCountHistoryItem[] = [];

  // Sayımla depodan düşen bir seri numarası HEM eski `serialHistory` HEM de Seri
  // No Defteri'ne işlenir. Defterdeki satır `serbest` durumuna geçer; kullanıcı
  // akışının gereği budur: fiziksel birim depodan çıkmıştır, aynı seri numarası
  // yeniden mal kabul edilebilir, transfer edilebilir ve tüketilebilir.
  //
  // Bu olay daha önce hiç kaydedilemiyordu: `serialHistory` için Firestore
  // güvenlik kuralı tanımlı değildi, yazma reddediliyordu. Sonuçta sayımdan
  // düşülen seriler sistemde kalıcı olarak "işlem görmüş" kalıyor, mal kabul
  // onları kabul etmiyordu.
  const logSerialDeparture = (b: ReturnType<typeof writeBatch>, item: DepoStokItem) => {
    const serial = (item.seriNumarasi || '').trim();
    if (!serial || isSyntheticSerial(serial)) return;
    const histRef = doc(collection(db, `serialHistory/${serial}/events`));
    b.set(histRef, {
      type: 'sayimdan_dusum',
      details: {
        stokKodu: item.stokKodu, stokAdi: item.stokAdi,
        depotId: depot.id, depotName: depot.name,
        lotNumarasi: item.lotNumarasi || '', miad: item.miad || '',
      },
      timestamp: now,
    });
    appendSerialEventToBatch(b, {
      type: 'sayim_dusum',
      stokKodu: item.stokKodu,
      stokAdi: item.stokAdi,
      seriNumarasi: serial,
      lotNumarasi: item.lotNumarasi || '',
      miad: typeof item.miad === 'string' ? item.miad : '',
      source: { locationType: 'depot', locationId: depot.id, locationName: depot.name },
      location: { locationType: 'none', locationId: '', locationName: '' },
      refs: { depotId: depot.id, depoStokId: item.id },
      actorUid: user.uid,
      actorName: user.name,
      details: { reason: 'depo_sayimi', depotName: depot.name },
    }, companyId);
  };

  const allProducts = groups.flatMap(g => g.products);
  allProducts.forEach(g => {
    const st = states[g.stokKodu];
    if (!isCountedRow(g, st)) return;
    touched++;
    const current = g.currentQty;
    const counted = countedOf(g, st);
    totalCurrent += current;
    totalCounted += counted;

    let deletedSerials: string[] = [];
    let countedSerials: string[] = [];
    if (g.serial && st?.scannedSerials.size) {
      countedSerials = Array.from(st.scannedSerials);
      deletedSerials = g.serials.filter(serial => !st.scannedSerials.has(serial));
    } else if (g.serial) {
      // Manual serial counts are reconciled oldest-first below. Mirror that exact
      // choice here so history reports the identities that will really be deleted.
      let remainingToDelete = Math.max(0, current - counted);
      [...g.docs].sort((a, b) => docTimeMillis(a) - docTimeMillis(b)).forEach(item => {
        if (remainingToDelete <= 0) return;
        const quantity = qtyOf(item);
        if (quantity <= remainingToDelete) {
          const serial = (item.seriNumarasi || '').trim();
          if (serial && !isSyntheticSerial(serial)) deletedSerials.push(serial);
          remainingToDelete -= quantity;
        }
      });
      countedSerials = g.serials.filter(serial => !deletedSerials.includes(serial));
    }
    historyItems.push({
      stokKodu: g.stokKodu,
      stokAdi: g.stokAdi,
      labName: g.labName,
      serialTracked: g.serial,
      currentQty: current,
      countedQty: counted,
      expectedSerials: g.serials,
      countedSerials,
      deletedSerials,
    });

    if (g.serial && st && st.scannedSerials.size > 0) {
      // scan-based: remove docs whose serial was not scanned
      g.docs.forEach(item => {
        if (!st.scannedSerials.has((item.seriNumarasi || '').trim())) {
          pushOp(b => b.delete(doc(db, 'depoStok', item.id!)));
          pushOp(b => logSerialDeparture(b, item), SERIAL_DEPARTURE_COST);
          deleted++;
        }
      });
      return;
    }

    const diff = counted - current;
    if (diff === 0) return;

    if (diff < 0) {
      // reduce total quantity by |diff|, oldest docs first; partially decrement a doc's
      // `adet` when only part of it needs to go (bulk-received docs can carry adet>1)
      let toRemove = Math.abs(diff);
      const sorted = [...g.docs].sort((a, b) => docTimeMillis(a) - docTimeMillis(b));
      for (const item of sorted) {
        if (toRemove <= 0) break;
        const q = qtyOf(item);
        if (q <= toRemove) {
          pushOp(b => b.delete(doc(db, 'depoStok', item.id!)));
          pushOp(b => logSerialDeparture(b, item), SERIAL_DEPARTURE_COST);
          toRemove -= q;
          deleted += q;
        } else {
          pushOp(b => b.update(doc(db, 'depoStok', item.id!), { adet: q - toRemove }));
          deleted += toRemove;
          toRemove = 0;
        }
      }
    } else {
      // surplus: create diff filler docs
      for (let i = 0; i < diff; i++) {
        const entry = withCompanyScope({
          stokKodu: g.stokKodu, stokAdi: g.stokAdi,
          depotId: depot.id, depotName: depot.name,
          seriNumarasi: `FAZLA-${nanoid(6)}`, lotNumarasi: '', miad: '',
          irsaliyeNumarasi: 'SAYIMDAN_FAZLA', isShipped: false,
          urunGrubu: g.urunGrubu, ambalajDegeri: g.ambalajDegeri,
          eklenmeTarihi: now, createdByName: user.name,
        }, companyId);
        pushOp(b => b.set(doc(collection(db, 'depoStok')), entry));
        created++;
      }
    }
  });

  // Yazım maliyetine göre parti bölme (Firestore sınırı: 500 yazım/batch).
  const MAX_WRITES_PER_BATCH = 450;
  let batch = writeBatch(db);
  let pending = 0;
  for (const op of ops) {
    if (pending > 0 && pending + op.cost > MAX_WRITES_PER_BATCH) {
      await batch.commit();
      batch = writeBatch(db);
      pending = 0;
    }
    op.run(batch);
    pending += op.cost;
  }
  if (pending > 0) await batch.commit();

  // session record (history)
  const sessionRef = doc(collection(db, 'depotBrandCountSessions'));
  await setDoc(sessionRef, withCompanyScope({
    depotId: depot.id, depotName: depot.name, brand: null, mode: 'depo-sayim-v2',
    startedAt: now, closedAt: now, createdBy: user.uid, createdByName: user.name,
    status: 'completed', itemCount: totalCurrent, scannedCount: totalCounted,
    missingCount: Math.max(0, totalCurrent - totalCounted), extraCount: Math.max(0, totalCounted - totalCurrent),
    detailCount: historyItems.length,
  }, companyId));

  // Details live in a subcollection so large serial-tracked counts cannot exceed
  // Firestore's per-document size limit. Each row preserves serials removed by
  // this exact count, making the audit trail independent from current stock.
  for (let i = 0; i < historyItems.length; i += 450) {
    const batch = writeBatch(db);
    historyItems.slice(i, i + 450).forEach(item => {
      batch.set(doc(collection(sessionRef, 'items')), withCompanyScope(item, companyId));
    });
    await batch.commit();
  }

  return { deleted, created, sessions: 1, touched };
}
