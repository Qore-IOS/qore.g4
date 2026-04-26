import assert from "node:assert/strict";
import test from "node:test";

import {
  planReconciliation,
  type AcceptedItem,
  type OrderForMatch,
} from "../../src/lib/lojistik/match-irsaliye-to-orders";

const order = (
  id: string,
  items: { stokKodu: string; sentAdet: number }[],
  createdAt = new Date(2026, 0, 1)
): OrderForMatch => ({
  id,
  createdAt,
  items: items.map((it, idx) => ({
    itemId: `${id}-${idx}`,
    stokKodu: it.stokKodu,
    sentAdet: it.sentAdet,
    requestedAdet: it.sentAdet,
  })),
});

const accept = (...items: { stokKodu: string; adet: number }[]): AcceptedItem[] =>
  items;

test("only orders whose items are a subset of the irsaliye are candidates", () => {
  // irs={z}, orders=[{x,y,z},{z,c,v},{z}] → only {z} qualifies
  const result = planReconciliation(
    accept({ stokKodu: "z", adet: 5 }),
    [
      order("o1", [
        { stokKodu: "x", sentAdet: 1 },
        { stokKodu: "y", sentAdet: 1 },
        { stokKodu: "z", sentAdet: 1 },
      ]),
      order("o2", [
        { stokKodu: "z", sentAdet: 1 },
        { stokKodu: "c", sentAdet: 1 },
        { stokKodu: "v", sentAdet: 1 },
      ]),
      order("o3", [{ stokKodu: "z", sentAdet: 1 }]),
    ]
  );

  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].orderId, "o3");
  assert.equal(result.plans[0].fullyDelivered, true);
});

test("most-specific candidate wins; superset items are recorded as extras", () => {
  // irs={x,y,z,a,s}, orders=[{x,y,z},{z,c,v},{z}] → {x,y,z} closes, {z}
  // remains a candidate but z is exhausted, drops to zero delivery; {a,s} are extras.
  const result = planReconciliation(
    accept(
      { stokKodu: "x", adet: 1 },
      { stokKodu: "y", adet: 1 },
      { stokKodu: "z", adet: 1 },
      { stokKodu: "a", adet: 2 },
      { stokKodu: "s", adet: 3 }
    ),
    [
      order("o-xyz", [
        { stokKodu: "x", sentAdet: 1 },
        { stokKodu: "y", sentAdet: 1 },
        { stokKodu: "z", sentAdet: 1 },
      ]),
      order("o-zcv", [
        { stokKodu: "z", sentAdet: 1 },
        { stokKodu: "c", sentAdet: 1 },
        { stokKodu: "v", sentAdet: 1 },
      ]),
      order("o-z", [{ stokKodu: "z", sentAdet: 1 }]),
    ]
  );

  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].orderId, "o-xyz");
  assert.equal(result.plans[0].fullyDelivered, true);
  const extrasMap = new Map(result.plans[0].extras.map((e) => [e.stokKodu, e.adet]));
  assert.equal(extrasMap.get("a"), 2);
  assert.equal(extrasMap.get("s"), 3);
  assert.equal(result.leftoverItems.length, 0);
});

test("multiple disjoint orders close in one pass when irsaliye covers all", () => {
  const result = planReconciliation(
    accept(
      { stokKodu: "x", adet: 1 },
      { stokKodu: "y", adet: 1 },
      { stokKodu: "z", adet: 1 },
      { stokKodu: "a", adet: 1 },
      { stokKodu: "s", adet: 1 }
    ),
    [
      order("o-xyz", [
        { stokKodu: "x", sentAdet: 1 },
        { stokKodu: "y", sentAdet: 1 },
        { stokKodu: "z", sentAdet: 1 },
      ]),
      order("o-as", [
        { stokKodu: "a", sentAdet: 1 },
        { stokKodu: "s", sentAdet: 1 },
      ]),
    ]
  );

  assert.equal(result.plans.length, 2);
  const ids = result.plans.map((p) => p.orderId).sort();
  assert.deepEqual(ids, ["o-as", "o-xyz"]);
  assert.ok(result.plans.every((p) => p.fullyDelivered));
  assert.equal(result.leftoverItems.length, 0);
});

test("partial adet → not fully delivered, missingAdet is reported", () => {
  // sentAdet 5, irs supplies 3 → 2 missing
  const result = planReconciliation(
    accept({ stokKodu: "z", adet: 3 }),
    [order("o1", [{ stokKodu: "z", sentAdet: 5 }])]
  );

  assert.equal(result.plans.length, 1);
  const plan = result.plans[0];
  assert.equal(plan.fullyDelivered, false);
  assert.equal(plan.items[0].deliveredAdet, 3);
  assert.equal(plan.items[0].missingAdet, 2);
  assert.equal(plan.items[0].fulfilled, false);
});

test("greedy multi-pass: shared stokKodu is consumed by the most-specific order first", () => {
  // irs has only 1 z. Order o-xyz needs 1z; o-z needs 1z. Most specific
  // (o-xyz, 3 items) consumes z first → o-z gets 0, dropped.
  const result = planReconciliation(
    accept(
      { stokKodu: "x", adet: 1 },
      { stokKodu: "y", adet: 1 },
      { stokKodu: "z", adet: 1 }
    ),
    [
      order("o-xyz", [
        { stokKodu: "x", sentAdet: 1 },
        { stokKodu: "y", sentAdet: 1 },
        { stokKodu: "z", sentAdet: 1 },
      ]),
      order("o-z", [{ stokKodu: "z", sentAdet: 1 }]),
    ]
  );

  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].orderId, "o-xyz");
});

test("no candidate orders → all accepted items become leftoverItems", () => {
  const result = planReconciliation(
    accept({ stokKodu: "x", adet: 2 }, { stokKodu: "y", adet: 1 }),
    [
      order("o1", [
        { stokKodu: "z", sentAdet: 1 },
        { stokKodu: "c", sentAdet: 1 },
      ]),
    ]
  );

  assert.equal(result.plans.length, 0);
  const leftoverMap = new Map(result.leftoverItems.map((l) => [l.stokKodu, l.adet]));
  assert.equal(leftoverMap.get("x"), 2);
  assert.equal(leftoverMap.get("y"), 1);
});

test("tiebreak between equally specific orders prefers older createdAt", () => {
  const older = new Date(2026, 0, 1);
  const newer = new Date(2026, 1, 1);
  const result = planReconciliation(
    accept({ stokKodu: "z", adet: 1 }),
    [
      order("o-newer", [{ stokKodu: "z", sentAdet: 1 }], newer),
      order("o-older", [{ stokKodu: "z", sentAdet: 1 }], older),
    ]
  );

  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].orderId, "o-older");
});
