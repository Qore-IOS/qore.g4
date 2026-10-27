"use client";

/**
 * Lab acceptance → peripheral order reconciliation.
 *
 * Triggered after a hospital irsaliye is OCR-parsed and accepted into lab
 * stock. Looks up "Hazırlanan" (status=toplaniyor) peripheral orders for the
 * same lab, runs the pure matching algorithm, then:
 *   - Updates each matched order's peripheralFulfillment.items[] with new
 *     deliveredAdet / missingAdet, appends a partialDeliveries[] log entry,
 *     and only flips status to 'completed' when the order is fully delivered.
 *   - Stores extras (irsaliye items not consumed by the order) on the
 *     primary plan.
 *   - Emits a single in-app + push notification summarising what was closed
 *     vs. partially delivered.
 */

import { db } from "../data/client";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "../data/client";
import { archiveCompletedOrderInBatch } from "@/lib/orders-archive";
import type { Order } from "@/lib/types";
import { emitOrderReconciled } from "@/lib/notifications";
import { scopedQuery } from '@/lib/document-helpers';
import {
  planReconciliation,
  type AcceptedItem,
  type MatchPlan,
  type OrderForMatch,
} from "@/lib/lojistik/match-irsaliye-to-orders";

export interface ReconcileIrsaliyeOptions {
  hospitalId: string;
  hospitalName?: string;
  accepted: AcceptedItem[];
  irsaliye?: { fileId?: string; fileName?: string };
  actor: { uid: string; name: string };
  // Kural gereği `list` sorguları companyId ile filtrelenmek zorunda.
  companyId?: string | null;
  isSuperAdmin?: boolean;
}

export interface ReconcileSummary {
  closedOrderIds: string[];
  partialOrderIds: string[];
  leftoverItems: AcceptedItem[];
  plans: MatchPlan[];
}

function tsToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "object" && value && "toDate" in value && typeof (value as any).toDate === "function") {
    return (value as any).toDate();
  }
  return null;
}

function buildOrderForMatch(orderDoc: Order & { id: string }): OrderForMatch | null {
  if (!orderDoc.items || orderDoc.items.length === 0) return null;

  // Prefer the lojistik manager's approved adet (peripheralFulfillment.sentAdet);
  // fall back to original requested adet.
  const fulfillmentByItemId = new Map<string, any>();
  (orderDoc.peripheralFulfillment?.items ?? []).forEach((it: any) => {
    fulfillmentByItemId.set(it.itemId, it);
  });

  const items = orderDoc.items.map((it, idx) => {
    const fulfilled = fulfillmentByItemId.get(it.id);
    // If a previous partial delivery left a residualAdet, only that residual
    // remains to be delivered. Otherwise sent = approved (or original adet).
    const approved = fulfilled?.sentAdet ?? (Number(it.adet) || 0);
    const alreadyDelivered = fulfilled?.deliveredAdet ?? 0;
    const sentAdet = Math.max(0, approved - alreadyDelivered);
    return {
      itemId: it.id ?? `${orderDoc.id}-${idx}`,
      stokKodu: it.stokKodu,
      sentAdet,
      requestedAdet: Number(it.adet) || 0,
    };
  }).filter((it) => it.sentAdet > 0 && !!it.stokKodu);

  if (items.length === 0) return null;

  return {
    id: orderDoc.id,
    items,
    createdAt: tsToDate(orderDoc.createdAt as any),
  };
}

/** Build the next peripheralFulfillment payload for an order, merging the new
 *  delivery into any prior fulfillment state. */
function buildFulfillmentUpdate(
  existingOrder: Order & { id: string },
  plan: MatchPlan,
  actor: { uid: string; name: string },
  irsaliye?: { fileId?: string; fileName?: string }
) {
  const existingItems = (existingOrder.peripheralFulfillment as any)?.items ?? [];
  const byId = new Map<string, any>();
  existingItems.forEach((it: any) => byId.set(it.itemId, it));

  // For order items not in this plan (shouldn't happen since plan covers all
  // order items), keep them untouched.
  const orderItems = existingOrder.items ?? [];
  const merged = orderItems.map((orderIt, idx) => {
    const itemId = orderIt.id ?? `${existingOrder.id}-${idx}`;
    const planEntry = plan.items.find((p) => p.itemId === itemId);
    const prev = byId.get(itemId) ?? {};
    const approved = prev.sentAdet ?? (Number(orderIt.adet) || 0);
    const prevDelivered = Number(prev.deliveredAdet ?? 0);
    const addDelivered = planEntry?.deliveredAdet ?? 0;
    const totalDelivered = prevDelivered + addDelivered;
    const missingAdet = Math.max(0, approved - totalDelivered);
    return {
      itemId,
      stokKodu: orderIt.stokKodu,
      requestedAdet: Number(orderIt.adet) || 0,
      sentAdet: approved,
      deliveredAdet: totalDelivered,
      missingAdet,
      fulfilled: totalDelivered >= approved && approved > 0,
    };
  });

  const partialDeliveries = (existingOrder.peripheralFulfillment as any)?.partialDeliveries ?? [];
  partialDeliveries.push({
    at: Timestamp.now(),
    actorUid: actor.uid || null,
    actorName: actor.name || null,
    irsaliyeFileId: irsaliye?.fileId || null,
    irsaliyeFileName: irsaliye?.fileName || null,
    items: plan.items
      .filter((p) => p.deliveredAdet > 0)
      .map((p) => ({
        stokKodu: p.stokKodu,
        deliveredAdet: p.deliveredAdet,
        missingAdet: p.missingAdet,
      })),
    extras: plan.extras,
  });

  const fullyDelivered = merged.every((m) => m.fulfilled);

  return {
    fulfillment: {
      items: merged,
      partialDeliveries,
      extras: plan.extras,
      updatedAt: serverTimestamp(),
      updatedById: actor.uid || null,
      updatedBy: actor.name || null,
    },
    fullyDelivered,
  };
}

export async function reconcileIrsaliyeAcceptance(
  options: ReconcileIrsaliyeOptions
): Promise<ReconcileSummary> {
  const empty: ReconcileSummary = {
    closedOrderIds: [],
    partialOrderIds: [],
    leftoverItems: options.accepted,
    plans: [],
  };

  if (!options.hospitalId || options.accepted.length === 0) return empty;

  // Fetch all peripheral, "Hazırlanan" orders for this lab.
  const ordersSnap = await getDocs(
    query(
      scopedQuery('orders', options.companyId, options.isSuperAdmin),
      where("isPeripheral", "==", true),
      where("labId", "==", options.hospitalId),
      where("status", "==", "toplaniyor")
    )
  );

  if (ordersSnap.empty) {
    return { ...empty, leftoverItems: options.accepted };
  }

  const orderDocs: (Order & { id: string })[] = ordersSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Order),
  }));

  const candidates = orderDocs
    .map(buildOrderForMatch)
    .filter((o): o is OrderForMatch => !!o);

  if (candidates.length === 0) {
    return { ...empty, leftoverItems: options.accepted };
  }

  const { plans, leftoverItems } = planReconciliation(options.accepted, candidates);

  const closedOrderIds: string[] = [];
  const partialOrderIds: string[] = [];

  for (const plan of plans) {
    const orderDoc = orderDocs.find((o) => o.id === plan.orderId);
    if (!orderDoc) continue;

    const { fulfillment, fullyDelivered } = buildFulfillmentUpdate(
      orderDoc,
      plan,
      options.actor,
      options.irsaliye
    );

    if (fullyDelivered) {
      // Tamamen teslim edilen sipariş `ordersArchive`'a taşınır (kopyala + sil).
      const batch = writeBatch(db);
      archiveCompletedOrderInBatch(
        batch,
        plan.orderId,
        orderDoc as unknown as Record<string, unknown>,
        {
          peripheralFulfillment: fulfillment,
          transferredAt: serverTimestamp(),
          transferredById: options.actor.uid || null,
          transferredBy: options.actor.name || null,
          completedAt: serverTimestamp(),
        },
      );
      await batch.commit();
      closedOrderIds.push(plan.orderId);
    } else {
      // Stays in 'toplaniyor' (Hazırlanan) per spec — only delivery state
      // is updated.
      partialOrderIds.push(plan.orderId);
      await updateDoc(doc(db, "orders", plan.orderId), {
        peripheralFulfillment: fulfillment,
      });
    }
  }

  // Fire notification (in-app bell + cloud-function fan-out for push).
  if (plans.length > 0) {
    try {
      await emitOrderReconciled({
        actor: options.actor,
        hospitalId: options.hospitalId,
        hospitalName: options.hospitalName,
        irsaliyeFileName: options.irsaliye?.fileName,
        results: plans.map((p) => ({
          orderId: p.orderId,
          fullyDelivered: p.fullyDelivered,
          deliveredAdet: p.totalDelivered,
          missingAdet: p.items.reduce((s, it) => s + it.missingAdet, 0),
          extras: p.extras,
        })),
        leftoverItems,
      });
    } catch (err) {
      // Notification failure must not block reconciliation success.
      // eslint-disable-next-line no-console
      console.error("emitOrderReconciled failed:", err);
    }
  }

  return { closedOrderIds, partialOrderIds, leftoverItems, plans };
}
