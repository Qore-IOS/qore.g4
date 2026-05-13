/**
 * Cloud Function: peripheral order delivery auto-reconciliation.
 *
 * Listens for new stock arrivals at a lab (depoStok docs created with
 * `isShipped == true` and a `hedefKurumId` set — Excel import, PDF irsaliye OCR,
 * Ceomed irsaliye, depot transfer all funnel through this collection) and
 * credits each unit against the oldest active peripheral order for that lab
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

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

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

    // Gate: only react when this stock entry is destined for a lab (perifer flow
    // and depot→lab transfers both flag isShipped+hedefKurumId).
    if (!data?.isShipped) return;
    const hedefKurumId: string | undefined = data?.hedefKurumId;
    if (!hedefKurumId) return;
    const stokKodu = (data?.stokKodu || '').toString().trim();
    if (!stokKodu) return;

    const arrivedAdet = Math.max(1, Number(data?.adet) || 1);

    // Find active peripheral orders for this lab.
    let ordersSnap: FirebaseFirestore.QuerySnapshot;
    try {
      ordersSnap = await db
        .collection('orders')
        .where('isPeripheral', '==', true)
        .where('labId', '==', hedefKurumId)
        .where('status', 'in', ['toplaniyor', 'eksik'])
        .get();
    } catch (e: any) {
      logger.warn(`[peripheralReconcile] order query failed for lab ${hedefKurumId}:`, e?.message || e);
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
          const fulfillment = order?.peripheralFulfillment;
          const items: FulfillmentItem[] = Array.isArray(fulfillment?.items) ? fulfillment.items : [];
          if (items.length === 0) return 0;

          const appliedIds: string[] = Array.isArray(fulfillment?.appliedDepoStokIds)
            ? fulfillment.appliedDepoStokIds
            : [];
          if (appliedIds.includes(stokId)) return 0;

          // Find the first matching item with remaining need.
          const idx = items.findIndex((it) => {
            if ((it?.stokKodu || '').toString().trim() !== stokKodu) return false;
            const sent = Number(it?.sentAdet) || 0;
            const delivered = Number(it?.deliveredAdet) || 0;
            return sent > delivered;
          });
          if (idx < 0) return 0;

          const item = items[idx];
          const sent = Number(item.sentAdet) || 0;
          const prevDelivered = Number(item.deliveredAdet) || 0;
          const need = Math.max(0, sent - prevDelivered);
          if (need <= 0) return 0;
          const credit = Math.min(need, remainingAdet);
          if (credit <= 0) return 0;

          const newDelivered = prevDelivered + credit;
          const newItems = items.slice();
          newItems[idx] = {
            ...item,
            deliveredAdet: newDelivered,
            missingAdet: Math.max(0, sent - newDelivered),
            fulfilled: newDelivered >= sent && sent > 0,
          };

          const allFulfilled = newItems.every((m) => {
            const s = Number(m.sentAdet) || 0;
            const d = Number(m.deliveredAdet) || 0;
            return s > 0 && d >= s;
          });
          const anyMissing = newItems.some((m) => {
            const s = Number(m.sentAdet) || 0;
            const d = Number(m.deliveredAdet) || 0;
            return s > d;
          });

          const partialDeliveries: any[] = Array.isArray(fulfillment?.partialDeliveries)
            ? fulfillment.partialDeliveries.slice()
            : [];
          partialDeliveries.push({
            at: admin.firestore.Timestamp.now(),
            source: 'depoStok',
            depoStokId: stokId,
            depoStokDocPath: orderRef.ref.path,
            actorUid: data?.lastEditedById || data?.createdById || null,
            actorName: data?.lastEditedBy || data?.createdBy || null,
            items: [{ stokKodu, deliveredAdet: credit, missingAdet: Math.max(0, sent - newDelivered) }],
          });

          const update: Record<string, any> = {
            peripheralFulfillment: {
              ...fulfillment,
              items: newItems,
              appliedDepoStokIds: [...appliedIds, stokId],
              partialDeliveries,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          };

          if (allFulfilled) {
            update.status = 'completed';
            update.transferredAt = admin.firestore.FieldValue.serverTimestamp();
            update.transferredBy = 'Otomatik (Stok Girişi)';
          } else if (anyMissing) {
            update.status = 'eksik';
          }

          tx.update(orderRef.ref, update);
          return credit;
        });

        if (applied > 0) {
          remainingAdet -= applied;
          logger.info(
            `[peripheralReconcile] credited ${applied} of ${stokKodu} to order ${orderRef.id} (depoStok=${stokId}, lab=${hedefKurumId})`
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
