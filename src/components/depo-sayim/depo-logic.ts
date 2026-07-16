'use client';

import { collection, doc, setDoc, writeBatch, Timestamp } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { db } from '@/lib/firebase';
import { withCompanyScope } from '@/lib/company-scope';
import { resolveDefaultTrackingMode } from '@/lib/tracking';
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
  docs: DepoStokItem[];   // depot docs (one per physical unit, !isShipped)
  serials: string[];      // distinct seriNumarasi across docs (serial products)
  currentQty: number;     // = docs.length (mevcut stok)
}

export interface LabGroup { labId: string; labName: string; products: ProductGroup[]; }

/* live per-product count state (keyed by stokKodu) */
export interface CountState {
  countedAdet: string;             // manual number (string to allow empty)
  scannedSerials: Set<string>;     // scanned serial numbers (serial products)
  touched: boolean;                // user interacted → include in save
}
export const emptyCount = (): CountState => ({ countedAdet: '', scannedSerials: new Set(), touched: false });

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

  const isSynthetic = (s: string) => /^(FAZLA|SAYIM)-/i.test(s);
  const labMap = new Map<string, LabGroup>();
  docsByStok.forEach((docs, stokKodu) => {
    const p = productsByCode.get(stokKodu); // may be undefined if the catalog hasn't loaded — depoStok carries enough
    const { labId, labName } = resolveLab(stokKodu, stokToHospitals, hospitalsById, labPools);
    // real serials only (exclude synthetic FAZLA-/SAYIM- placeholders)
    const serials = Array.from(new Set(docs.map(d => (d.seriNumarasi || '').trim()).filter(s => s && !isSynthetic(s))));
    const serial = (!!p && resolveDefaultTrackingMode(p as any) === 'serial') || serials.length > 0;
    const group: ProductGroup = {
      stokKodu,
      stokAdi: p?.stokAdi || docs[0]?.stokAdi || stokKodu,
      labId, labName,
      urunGrubu: p?.urunGrubu || docs[0]?.urunGrubu,
      ambalajDegeri: p?.ambalajDegeri ?? docs[0]?.ambalajDegeri,
      serial,
      docs, serials, currentQty: docs.length,
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
  return s.touched || (g.serial && s.scannedSerials.size > 0) || s.countedAdet !== '';
}

export interface SaveSummary { deleted: number; created: number; sessions: number; skippedSerial: number; touched: number; }

/* Reconcile the depot's depoStok docs so the count matches the counted amount, then write a session.
   - non-serial: delete oldest surplus docs / create shortage-fill docs
   - serial with scans: delete docs whose serial was NOT scanned (identity-based)
   - serial with manual number: NEVER delete serial docs (preserve traceability); only create if counted>current */
export async function saveDepoCount(params: {
  groups: LabGroup[];
  states: Record<string, CountState>;
  depot: { id: string; name: string };
  companyId: string;
  user: { uid: string; name: string };
}): Promise<SaveSummary> {
  const { groups, states, depot, companyId, user } = params;
  const now = Timestamp.now();
  const ops: ((batch: ReturnType<typeof writeBatch>) => void)[] = [];
  let deleted = 0, created = 0, skippedSerial = 0, touched = 0;
  let totalCurrent = 0, totalCounted = 0;

  const allProducts = groups.flatMap(g => g.products);
  allProducts.forEach(g => {
    const st = states[g.stokKodu];
    if (!isCountedRow(g, st)) return;
    touched++;
    const current = g.currentQty;
    const counted = countedOf(g, st);
    totalCurrent += current;
    totalCounted += counted;

    if (g.serial && st && st.scannedSerials.size > 0) {
      // scan-based: remove docs whose serial was not scanned
      g.docs.forEach(item => {
        if (!st.scannedSerials.has((item.seriNumarasi || '').trim())) {
          ops.push(b => b.delete(doc(db, 'depoStok', item.id!)));
          deleted++;
        }
      });
      return;
    }

    const diff = counted - current;
    if (diff === 0) return;

    if (diff < 0) {
      if (g.serial) { skippedSerial++; return; } // manual reduction never deletes serials
      // non-serial: delete oldest |diff| docs
      g.docs.slice(0, Math.abs(diff)).forEach(item => {
        ops.push(b => b.delete(doc(db, 'depoStok', item.id!)));
        deleted++;
      });
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
        ops.push(b => b.set(doc(collection(db, 'depoStok')), entry));
        created++;
      }
    }
  });

  // commit in chunks of 450
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach(op => op(batch));
    await batch.commit();
  }

  // session record (history)
  await setDoc(doc(collection(db, 'depotBrandCountSessions')), withCompanyScope({
    depotId: depot.id, depotName: depot.name, brand: null, mode: 'depo-sayim-v2',
    startedAt: now, closedAt: now, createdBy: user.uid, createdByName: user.name,
    status: 'completed', itemCount: totalCurrent, scannedCount: totalCounted,
    missingCount: Math.max(0, totalCurrent - totalCounted), extraCount: Math.max(0, totalCounted - totalCurrent),
  }, companyId));

  return { deleted, created, sessions: 1, skippedSerial, touched };
}
