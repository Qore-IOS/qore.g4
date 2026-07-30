'use client';

/**
 * One-time retroactive correction for the depo sayım count-reduction bug (now
 * fixed in depo-logic.ts / stock-adjustment.ts): a manual count of a
 * serial-tracked product never actually deleted its pre-existing depoStok
 * docs, so the product stayed at its old quantity instead of the counted
 * value. Past count sessions only recorded aggregate totals, not a
 * per-product/per-lot breakdown, so we can't reconstruct "what the count
 * said" from history — but we CAN reconstruct "what should now be true":
 * everything the count was supposed to zero out is, by definition, stock
 * that existed BEFORE that count closed. Anything dated at/after the count
 * (mal kabul received afterwards) is left completely untouched.
 */
import { collection, doc, getDocs, limit as fbLimit, orderBy, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { isSerialClassified, qtyOf, docTimeMillis } from '@/components/depo-sayim/depo-logic';
import type { DepoStokItem, ProductCode } from '@/lib/types';

export interface LastCountSession {
  id: string;
  depotId: string;
  closedAt: Date;
  closedAtMillis: number;
}

/** the depot's most recent depo-sayim-v2 session — the "last count" being corrected for */
export async function findLastDepoSayimV2Session(
  depotId: string,
  companyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
): Promise<LastCountSession | null> {
  // Filtered client-side (depotId/mode) rather than as extra `where` clauses: the
  // deployed composite index only covers (companyId, closedAt desc), and adding
  // more equality filters here would need an index that doesn't exist yet.
  const snap = await getDocs(
    scopedQuery('depotBrandCountSessions', companyId, isSuperAdmin, orderBy('closedAt', 'desc'), fbLimit(1000)),
  );
  const sessions = filterByCompanyScope(
    snap.docs.map(d => ({ id: d.id, ...d.data() } as any)),
    companyId, isSuperAdmin,
  );
  const match = sessions.find(s => s.depotId === depotId && s.mode === 'depo-sayim-v2');
  if (!match) return null;
  const closedAt: Date = match.closedAt?.toDate ? match.closedAt.toDate() : new Date(match.closedAt);
  return { id: match.id, depotId, closedAt, closedAtMillis: closedAt.getTime() };
}

export interface BackfillPreviewRow {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  toDeleteQty: number;
  toDeleteDocIds: string[];
  keepQty: number; // untouched — mal kabul received after the count closed
}

export interface BackfillPreview {
  rows: BackfillPreviewRow[];
  totalToDeleteQty: number;
  totalToDeleteDocs: number;
}

/**
 * Finds leftover pre-count docs for serial-tracked products (the ones the bug
 * skipped). Non-serial products are never included — they were already
 * correctly reduced by the count at the time.
 */
export function buildPreCountLeftoverPreview(
  depotStock: DepoStokItem[],
  productCodes: ProductCode[],
  sessionClosedAtMillis: number,
): BackfillPreview {
  const productsByCode = new Map(productCodes.map(p => [p.stokKodu, p]));
  const docsByStok = new Map<string, DepoStokItem[]>();
  depotStock.forEach(d => {
    if (d.isShipped) return;
    const arr = docsByStok.get(d.stokKodu) || [];
    arr.push(d);
    docsByStok.set(d.stokKodu, arr);
  });

  const rowsByKey = new Map<string, BackfillPreviewRow>();
  let totalToDeleteQty = 0, totalToDeleteDocs = 0;

  docsByStok.forEach((docs, stokKodu) => {
    const product = productsByCode.get(stokKodu);
    if (!isSerialClassified(docs, product)) return; // non-serial: already correctly zeroed by the count

    docs.forEach(d => {
      const lot = d.lotNumarasi || '';
      const miad = typeof d.miad === 'string' ? d.miad : '';
      const key = `${stokKodu}-${lot}-${miad}`;
      let row = rowsByKey.get(key);
      if (!row) {
        row = { stokKodu, stokAdi: d.stokAdi || product?.stokAdi || stokKodu, lotNumarasi: lot, miad, toDeleteQty: 0, toDeleteDocIds: [], keepQty: 0 };
        rowsByKey.set(key, row);
      }
      const q = qtyOf(d);
      if (docTimeMillis(d) < sessionClosedAtMillis) {
        row.toDeleteQty += q;
        row.toDeleteDocIds.push(d.id!);
        totalToDeleteQty += q;
        totalToDeleteDocs++;
      } else {
        row.keepQty += q;
      }
    });
  });

  const rows = Array.from(rowsByKey.values())
    .filter(r => r.toDeleteQty > 0)
    .sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr'));
  return { rows, totalToDeleteQty, totalToDeleteDocs };
}

export async function applyPreCountLeftoverBackfill(params: {
  rows: BackfillPreviewRow[];
  depot: { id: string; name: string };
  session: LastCountSession;
  companyId: string | null | undefined;
  user: { uid: string; name: string };
}): Promise<{ deletedDocs: number; deletedQty: number }> {
  const { rows, depot, session, companyId, user } = params;
  const allDocIds = rows.flatMap(r => r.toDeleteDocIds);
  const deletedQty = rows.reduce((s, r) => s + r.toDeleteQty, 0);

  for (let i = 0; i < allDocIds.length; i += 450) {
    const batch = writeBatch(db);
    allDocIds.slice(i, i + 450).forEach(id => batch.delete(doc(db, 'depoStok', id)));
    await batch.commit();
  }

  await setDoc(doc(collection(db, 'depoSayimBackfillLogs')), withCompanyScope({
    depotId: depot.id, depotName: depot.name,
    sessionId: session.id, sessionClosedAt: session.closedAt.toISOString(),
    deletedDocs: allDocIds.length, deletedQty,
    rows: rows.map(r => ({ stokKodu: r.stokKodu, stokAdi: r.stokAdi, lotNumarasi: r.lotNumarasi, miad: r.miad, deletedQty: r.toDeleteQty, keepQty: r.keepQty })),
    reason: 'depo-sayim seri sayım düzeltmesi öncesi kalan eski stok (geriye dönük backfill)',
    userId: user.uid, userName: user.name,
    timestamp: new Date().toISOString(),
  }, companyId));

  return { deletedDocs: allDocIds.length, deletedQty };
}
