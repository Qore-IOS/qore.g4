import type * as DocumentStore from '../data/admin';
/**
 * Cloud Function: peripheral order delivery auto-reconciliation.
 *
 * Listens for new stock arrivals at a lab (depoStok docs created with
 * `isShipped == true` and a `hedefKurumId` set — Excel import, PDF irsaliye OCR,
 * Ceomed irsaliye, depot transfer all funnel through this collection) or at a
 * depot (`isShipped == false` + `depotId`) and credits each unit against the oldest active peripheral/depot order for that location
 * whose `peripheralFulfillment.items[]` still has remaining demand for the
 * arriving stokKodu.
 *
 * Status transitions:
 *  - All order items fulfilled (deliveredAdet >= sentAdet) -> 'completed'.
 *  - Any item under-fulfilled -> 'eksik' (was 'toplaniyor' on save).
 *  - When more stock arrives and finally covers everything, status flips to
 *    'completed' on that final write.
 *
 * Excess stock items (no matching open order) are simply ignored — they enter
 * lab stock as normal; subsequent matching orders can consume them on later
 * arrivals.
 *
 * Idempotency: each depoStok doc id is recorded into the order's
 * `peripheralFulfillment.appliedDepoStokIds` so retries / replays do not
 * double-credit.
 */

import {adminDb,FieldValue,Timestamp} from '../data/admin';
import {resolveStorageBucket} from '@/lib/server/storage-bucket';
import * as functions from '@/lib/jobs/runtime';
import { logger } from '@/lib/jobs/runtime';


const db = adminDb;

type FulfillmentItem = {
  itemId: string;
  stokKodu: string;
  requestedAdet: number;
  sentAdet: number;
  deliveredAdet?: number;
  missingAdet?: number;
  fulfilled?: boolean;
};

function pickToDate(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?._seconds === 'number') return value._seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return 0;
}

export const onDepoStokAccepted = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .firestore.document('depoStok/{stokId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() as any;
    const stokId = context.params.stokId as string;

    const isLabArrival = data?.isShipped === true && !!data?.hedefKurumId;
    const isDepotArrival = data?.isShipped === false && !!data?.depotId;
    if (!isLabArrival && !isDepotArrival) return;

    const locationId: string = (isDepotArrival ? data.depotId : data.hedefKurumId).toString();
    const locationKind = isDepotArrival ? 'depot' : 'lab';
    const fulfillmentField = isDepotArrival ? 'depotFulfillment' : 'peripheralFulfillment';
    const stokKodu = (data?.stokKodu || '').toString().trim();
    if (!stokKodu) return;

    const arrivedAdet = Math.max(1, Number(data?.adet) || 1);

    // Find active product requests for this lab/depot.
    let ordersSnap: DocumentStore.QuerySnapshot;
    try {
      let orderQuery: DocumentStore.Query = db.collection('orders');
      if (isDepotArrival) {
        orderQuery = orderQuery
          .where('isDepotRequest', '==', true)
          .where('depotId', '==', locationId)
          .where('status', 'in', ['pending', 'eksik']);
      } else {
        orderQuery = orderQuery
          .where('isPeripheral', '==', true)
          .where('labId', '==', locationId)
          .where('status', 'in', ['toplaniyor', 'eksik']);
      }
      ordersSnap = await orderQuery.get();
    } catch (e: any) {
      logger.warn(`[peripheralReconcile] order query failed for ${locationKind} ${locationId}:`, e?.message || e);
      return;
    }

    if (ordersSnap.empty) return;

    // Sort by createdAt ascending — oldest order has priority.
    const orderDocs = ordersSnap.docs.slice().sort((a, b) => {
      const ad = pickToDate(a.data()?.createdAt);
      const bd = pickToDate(b.data()?.createdAt);
      return ad - bd;
    });

    let remainingAdet = arrivedAdet;

    for (const orderRef of orderDocs) {
      if (remainingAdet <= 0) break;
      try {
        const applied: number = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(orderRef.ref);
          if (!fresh.exists) return 0;
          const order = fresh.data() as any;
          const rawFulfillment = order?.[fulfillmentField];
          const fallbackItems: FulfillmentItem[] = isDepotArrival && Array.isArray(order?.items)
            ? order.items.map((it: any) => ({
                itemId: it?.id || it?.stokKodu || '',
                stokKodu: (it?.stokKodu || '').toString(),
                requestedAdet: Number(it?.adet) || 0,
                sentAdet: Number(it?.adet) || 0,
                deliveredAdet: 0,
                missingAdet: Number(it?.adet) || 0,
                fulfilled: false,
              }))
            : [];
          const fulfillment = rawFulfillment || (isDepotArrival ? { items: fallbackItems, appliedDepoStokIds: [], partialDeliveries: [] } : null);
          const items: FulfillmentItem[] = Array.isArray(fulfillment?.items) ? fulfillment.items : [];
          if (items.length === 0) return 0;

          const appliedIds: string[] = Array.isArray(fulfillment?.appliedDepoStokIds)
            ? fulfillment.appliedDepoStokIds
            : [];
          if (appliedIds.includes(stokId)) return 0;

          // Find the first matching item with remaining need.
          const idx = items.findIndex((it) => {
            if ((it?.stokKodu || '').toString().trim() !== stokKodu) return false;
            const target = Number(it?.sentAdet ?? it?.requestedAdet) || 0;
            const delivered = Number(it?.deliveredAdet) || 0;
            return target > delivered;
          });
          if (idx < 0) return 0;

          const item = items[idx];
          const targetAdet = Number(item.sentAdet ?? item.requestedAdet) || 0;
          const prevDelivered = Number(item.deliveredAdet) || 0;
          const need = Math.max(0, targetAdet - prevDelivered);
          if (need <= 0) return 0;
          const credit = Math.min(need, remainingAdet);
          if (credit <= 0) return 0;

          const newDelivered = prevDelivered + credit;
          const newItems = items.slice();
          newItems[idx] = {
            ...item,
            deliveredAdet: newDelivered,
            sentAdet: Number(item.sentAdet ?? item.requestedAdet) || 0,
            missingAdet: Math.max(0, targetAdet - newDelivered),
            fulfilled: newDelivered >= targetAdet && targetAdet > 0,
          };

          const allFulfilled = newItems.every((m) => {
            const s = Number(m.sentAdet ?? m.requestedAdet) || 0;
            const d = Number(m.deliveredAdet) || 0;
            return s > 0 && d >= s;
          });
          const anyMissing = newItems.some((m) => {
            const s = Number(m.sentAdet ?? m.requestedAdet) || 0;
            const d = Number(m.deliveredAdet) || 0;
            return s > d;
          });

          const partialDeliveries: any[] = Array.isArray(fulfillment?.partialDeliveries)
            ? fulfillment.partialDeliveries.slice()
            : [];
          partialDeliveries.push({
            at: Timestamp.now(),
            source: 'depoStok',
            depoStokId: stokId,
            depoStokDocPath: snap.ref.path,
            actorUid: data?.lastEditedById || data?.createdById || null,
            actorName: data?.lastEditedBy || data?.createdBy || null,
            items: [{ stokKodu, deliveredAdet: credit, missingAdet: Math.max(0, targetAdet - newDelivered) }],
          });

          const update: Record<string, any> = {
            [fulfillmentField]: {
              ...fulfillment,
              items: newItems,
              appliedDepoStokIds: [...appliedIds, stokId],
              partialDeliveries,
              updatedAt: FieldValue.serverTimestamp(),
            },
          };

          if (allFulfilled) {
            update.status = 'completed';
            update.transferredAt = FieldValue.serverTimestamp();
            update.transferredBy = isDepotArrival ? 'Otomatik (Depo Mal Kabul)' : 'Otomatik (Stok Girişi)';
          } else if (anyMissing) {
            update.status = 'eksik';
          }

          tx.update(orderRef.ref, update);
          return credit;
        });

        if (applied > 0) {
          remainingAdet -= applied;
          logger.info(
            `[peripheralReconcile] credited ${applied} of ${stokKodu} to order ${orderRef.id} (depoStok=${stokId}, ${locationKind}=${locationId})`
          );
        }
      } catch (e: any) {
        logger.error(
          `[peripheralReconcile] failed to credit order ${orderRef.id} for depoStok ${stokId}:`,
          e?.message || e
        );
      }
    }
  });
