import assert from "node:assert/strict";
import test from "node:test";

import {
  addQuantityScan,
  adjustQuantity,
  expiryRank,
  intakeGroupKey,
  pickOneUnit,
  sortByExpiry,
  totalPicked,
} from "../../src/lib/terminal/quantity-picking";

test("expiryRank üç miad biçimini de sıralanabilir kılar", () => {
  const iso = expiryRank("2026-01-01");
  const date = expiryRank(new Date("2026-01-01"));
  const timestamp = expiryRank({ toDate: () => new Date("2026-01-01") });
  const seconds = expiryRank({ seconds: Date.parse("2026-01-01") / 1000 });

  assert.equal(iso, date);
  assert.equal(iso, timestamp);
  assert.equal(iso, seconds);
});

test("çözümlenemeyen miad EN SONA atılır", () => {
  // Miadı bilinmeyen kutuyu FEFO'da öne almak, bilerek yanlış kutuyu
  // sevk etmek olurdu.
  assert.equal(expiryRank(undefined), Number.POSITIVE_INFINITY);
  assert.equal(expiryRank(""), Number.POSITIVE_INFINITY);
  assert.equal(expiryRank("bozuk-tarih"), Number.POSITIVE_INFINITY);
});

test("sortByExpiry miadı yakın olanı öne alır ve girdiyi bozmaz", () => {
  const input = [
    { id: "gec", miad: "2027-01-01" },
    { id: "bilinmiyor" },
    { id: "yakin", miad: "2026-01-01" },
  ];
  const sorted = sortByExpiry(input);

  assert.deepEqual(
    sorted.map(i => i.id),
    ["yakin", "gec", "bilinmiyor"],
  );
  assert.equal(input[0].id, "gec", "girdi dizisi değişmemeli");
});

test("pickOneUnit FEFO ile en yakın miadlı kutuyu seçer", () => {
  const stock = [
    { id: "a", stokKodu: "X", adet: 5, miad: "2027-06-01" },
    { id: "b", stokKodu: "X", adet: 5, miad: "2026-03-01" },
  ];

  assert.equal(pickOneUnit(stock, new Map(), { stokKodu: "X" }), "b");
});

test("pickOneUnit tükenen belgeden sonrakine geçer", () => {
  const stock = [
    { id: "yakin", stokKodu: "X", adet: 2, miad: "2026-03-01" },
    { id: "gec", stokKodu: "X", adet: 5, miad: "2027-06-01" },
  ];
  const picked = new Map<string, number>();

  for (let i = 0; i < 2; i++) {
    const id = pickOneUnit(stock, picked, { stokKodu: "X" })!;
    picked.set(id, (picked.get(id) ?? 0) + 1);
  }

  assert.equal(picked.get("yakin"), 2);
  // İlk belge bitti; üçüncü okutma sonrakine düşmeli.
  assert.equal(pickOneUnit(stock, picked, { stokKodu: "X" }), "gec");
});

test("pickOneUnit depoda kalmadığında null döner", () => {
  const stock = [{ id: "a", stokKodu: "X", adet: 1 }];
  const picked = new Map([["a", 1]]);

  assert.equal(pickOneUnit(stock, picked, { stokKodu: "X" }), null);
});

test("barkodda lot varsa yalnızca o lot seçilir", () => {
  const stock = [
    { id: "lot-a", stokKodu: "X", lotNumarasi: "A", adet: 5, miad: "2026-01-01" },
    { id: "lot-b", stokKodu: "X", lotNumarasi: "B", adet: 5, miad: "2027-01-01" },
  ];

  // Lot verilmezse FEFO kazanır…
  assert.equal(pickOneUnit(stock, new Map(), { stokKodu: "X" }), "lot-a");
  // …lot verilirse miadı daha uzak olsa bile o lot seçilir.
  assert.equal(pickOneUnit(stock, new Map(), { stokKodu: "X", lotNumarasi: "B" }), "lot-b");
});

/**
 * Seri numaralı belgeleri adet mantığıyla bölmek stoğu bozardı: o kalemlerin
 * kendi eşleşme yolu var.
 */
test("seri numaralı belgeler adet havuzuna girmez", () => {
  const stock = [
    { id: "serili", stokKodu: "X", seriNumarasi: "S1", adet: 1, miad: "2026-01-01" },
    { id: "adetli", stokKodu: "X", adet: 3, miad: "2027-01-01" },
  ];

  assert.equal(pickOneUnit(stock, new Map(), { stokKodu: "X" }), "adetli");
});

test("başka ürünün stoğu seçilmez", () => {
  const stock = [{ id: "y", stokKodu: "Y", adet: 5 }];
  assert.equal(pickOneUnit(stock, new Map(), { stokKodu: "X" }), null);
});

test("totalPicked ayrılan adetleri toplar", () => {
  assert.equal(totalPicked(new Map([["a", 2], ["b", 3]])), 5);
  assert.equal(totalPicked(new Map()), 0);
});

test("intakeGroupKey lot ve miadı ayırt eder", () => {
  const base = { stokKodu: "X", lotNumarasi: "A", miad: "2026-01-01" };

  assert.equal(intakeGroupKey(base), intakeGroupKey({ ...base }));
  assert.notEqual(intakeGroupKey(base), intakeGroupKey({ ...base, lotNumarasi: "B" }));
  // Aynı lot farklı miatla gelebiliyor; tek satırda toplamak stok kaydına
  // yanlış miad yazardı.
  assert.notEqual(intakeGroupKey(base), intakeGroupKey({ ...base, miad: "2027-01-01" }));
});

test("addQuantityScan aynı anahtarı tek satırda toplar", () => {
  type Row = { id: string; key: string; adet?: number };
  const keyOf = (row: Row) => row.key;

  const first = addQuantityScan<Row>([], "X||A||2026", keyOf, () => ({
    id: "1",
    key: "X||A||2026",
    adet: 1,
  }));
  assert.equal(first.merged, false);
  assert.equal(first.rows.length, 1);

  const second = addQuantityScan(first.rows, "X||A||2026", keyOf, () => ({
    id: "2",
    key: "X||A||2026",
    adet: 1,
  }));
  assert.equal(second.merged, true);
  assert.equal(second.rows.length, 1);
  assert.equal(second.rows[0].adet, 2);

  const other = addQuantityScan(second.rows, "X||B||2026", keyOf, () => ({
    id: "3",
    key: "X||B||2026",
    adet: 1,
  }));
  assert.equal(other.rows.length, 2, "farklı lot ayrı satır olmalı");
});

test("adjustQuantity 1'in altına inmez", () => {
  const rows = [{ id: "a", adet: 2 }];

  assert.equal(adjustQuantity(rows, "a", 1)[0].adet, 3);
  assert.equal(adjustQuantity(rows, "a", -1)[0].adet, 1);
  assert.equal(adjustQuantity(rows, "a", -5)[0].adet, 1);
  // Sıfıra indirmek yerine satır silinir; "0 adet mal kabul" anlamsız.
});
