/**
 * Pure matching algorithm: reconcile an irsaliye (delivery note) acceptance
 * against a set of peripheral orders waiting in "Hazırlanan" (toplaniyor)
 * for the same hospital/lab.
 *
 * Rules (per product spec):
 *  - An order is a *candidate* only if every one of its stokKodu values
 *    is present in the irsaliye (subset match). Adet is checked separately.
 *  - Candidates are ranked by specificity: most-items first, then oldest.
 *  - Greedy multi-pass: each accepted order consumes from the shared
 *    irsaliye inventory; subsequent orders see what's left.
 *  - For every order item, deliveredAdet = min(sentAdet, remaining_in_irsaliye).
 *    missingAdet = sentAdet - deliveredAdet. fulfilled = (missingAdet === 0).
 *  - An order is `fullyDelivered` when every item has missingAdet === 0.
 *  - Plans with zero deliveries are dropped.
 *  - Items left in the irsaliye after all candidate plans are returned as
 *    `extras` attached to the first plan, or as `leftoverItems` if no plan.
 */

export interface AcceptedItem {
  stokKodu: string;
  adet: number;
}

export interface OrderItemForMatch {
  itemId: string;
  stokKodu: string;
  /** Quantity the lojistik manager actually approved (may differ from request). */
  sentAdet: number;
  /** Original requested quantity (kept for reporting). */
  requestedAdet: number;
}

export interface OrderForMatch {
  id: string;
  items: OrderItemForMatch[];
  /** Used as tie-breaker (older first). */
  createdAt?: Date | null;
}

export interface PlannedItemDelivery {
  itemId: string;
  stokKodu: string;
  sentAdet: number;
  /** How much this acceptance pass delivered. */
  deliveredAdet: number;
  /** sentAdet - deliveredAdet (cumulative for this pass; existing missing is
   *  tracked separately by the reconcile layer when persisting). */
  missingAdet: number;
  fulfilled: boolean;
}

export interface MatchPlan {
  orderId: string;
  items: PlannedItemDelivery[];
  /** Items present in the irsaliye that weren't part of any closed order
   *  - attached to the first plan as a record. */
  extras: AcceptedItem[];
  /** True iff every order item delivered === sentAdet in this pass alone. */
  fullyDelivered: boolean;
  /** Total adet delivered across this plan. */
  totalDelivered: number;
}

export interface ReconcileResult {
  plans: MatchPlan[];
  /** Items that did not match any candidate order. */
  leftoverItems: AcceptedItem[];
}

function sumAccepted(items: AcceptedItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (!it.stokKodu) continue;
    const adet = Math.max(0, Number(it.adet) || 0);
    if (adet === 0) continue;
    m.set(it.stokKodu, (m.get(it.stokKodu) ?? 0) + adet);
  }
  return m;
}

export function planReconciliation(
  accepted: AcceptedItem[],
  orders: OrderForMatch[]
): ReconcileResult {
  const remaining = sumAccepted(accepted);
  const initialKeys = new Set(remaining.keys());

  // Filter candidates: every order item's stokKodu must exist in the irsaliye
  // at all. Adet sufficiency is evaluated per-pass below.
  const candidates = orders.filter(
    (o) =>
      o.items.length > 0 &&
      o.items.every((it) => !!it.stokKodu && initialKeys.has(it.stokKodu))
  );

  // Most specific first (most items), oldest as tiebreak.
  candidates.sort((a, b) => {
    const sd = b.items.length - a.items.length;
    if (sd !== 0) return sd;
    const at = a.createdAt?.getTime?.() ?? 0;
    const bt = b.createdAt?.getTime?.() ?? 0;
    return at - bt;
  });

  const plans: MatchPlan[] = [];

  for (const order of candidates) {
    const planItems: PlannedItemDelivery[] = order.items.map((it) => {
      const have = remaining.get(it.stokKodu) ?? 0;
      const sent = Math.max(0, Number(it.sentAdet) || 0);
      const delivered = Math.min(sent, have);
      remaining.set(it.stokKodu, have - delivered);
      return {
        itemId: it.itemId,
        stokKodu: it.stokKodu,
        sentAdet: sent,
        deliveredAdet: delivered,
        missingAdet: Math.max(0, sent - delivered),
        fulfilled: delivered >= sent && sent > 0,
      };
    });

    const totalDelivered = planItems.reduce((s, p) => s + p.deliveredAdet, 0);
    if (totalDelivered === 0) continue;

    const fullyDelivered = planItems.every((p) => p.fulfilled);

    plans.push({
      orderId: order.id,
      items: planItems,
      extras: [],
      fullyDelivered,
      totalDelivered,
    });
  }

  const leftoverItems: AcceptedItem[] = [];
  remaining.forEach((adet, stokKodu) => {
    if (adet > 0) leftoverItems.push({ stokKodu, adet });
  });

  if (plans.length > 0 && leftoverItems.length > 0) {
    plans[0].extras = leftoverItems;
    return { plans, leftoverItems: [] };
  }

  return { plans, leftoverItems };
}
