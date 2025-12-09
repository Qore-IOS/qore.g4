import assert from "node:assert/strict";
import { test } from "node:test";

import path from "path";

import { createMockFirestoreModule } from "../helpers/mockFirestore";

test("inventory count flow builds items and persists a session", async () => {
  const firestoreMock = createMockFirestoreModule();

  const firestorePath = require.resolve("firebase/firestore");
  require.cache[firestorePath] = { exports: firestoreMock } as any;

  const firebasePath = path.join(process.cwd(), ".test-dist", "src", "lib", "firebase.js");
  require.cache[firebasePath] = { exports: { db: {} } } as any;

  const { buildCountItemsFromStock, saveLabCountSession } = await import("../../src/lib/labCount");

  const stock = [
    { id: "1", stokKodu: "A1", stokAdi: "Reagent", lotNumarasi: "LOT1", miad: "2024-12-01", seriNumarasi: "S1" },
    { id: "2", stokKodu: "A1", stokAdi: "Reagent", lotNumarasi: "LOT1", miad: "2024-12-01", seriNumarasi: "S2" },
  ];
  const scanned = new Set(["S1"]);

  const items = buildCountItemsFromStock(stock, scanned);
  assert.equal(items[0]?.expected, 2);
  assert.equal(items[0]?.counted, 1);

  const sessionId = await saveLabCountSession({
    laboratoryId: "lab-1",
    laboratoryName: "Main Lab",
    user: { id: "user-1", name: "Tester" },
    stockItemsForLab: stock,
    scannedSerials: scanned,
    firestoreDb: {} as any,
  });

  const snap = await firestoreMock.getDoc(firestoreMock.doc("hospitals/lab-1/stockCounts", sessionId));
  assert.equal(snap.exists(), true);
  const saved = snap.data();
  assert.equal(saved?.items?.[0]?.counted, 1);
  assert.equal(saved?.items?.[0]?.unscannedSerials?.length, 1);
});

