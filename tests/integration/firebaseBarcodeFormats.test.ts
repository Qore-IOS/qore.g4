import assert from "node:assert/strict";
import { test } from "node:test";

import path from "path";

import { createMockFirestoreModule } from "../helpers/mockFirestore";

test("fetchBarcodeFormats loads only active formats and appends legacy fallback", async () => {
  const firestoreMock = createMockFirestoreModule();

  const firestorePath = require.resolve("firebase/firestore");
  require.cache[firestorePath] = { exports: firestoreMock } as any;

  const firebasePath = path.join(process.cwd(), ".test-dist", "src", "lib", "firebase.js");
  require.cache[firebasePath] = { exports: { db: {} } } as any;

  const { fetchBarcodeFormats } = await import("../../src/hooks/useSafeBarcodeFormats");

  await firestoreMock.setDoc(firestoreMock.doc("barcodeFormats", "active"), {
    name: "GS1",
    strategy: "gs1",
    priority: 1,
    active: true,
  });
  await firestoreMock.setDoc(firestoreMock.doc("barcodeFormats", "inactive"), {
    name: "Old",
    strategy: "legacy_roche",
    active: false,
  });

  const { formats, error } = await fetchBarcodeFormats({} as any);

  assert.equal(error, undefined);
  assert.ok(formats.some((f) => f.id === "active"));
  assert.ok(!formats.some((f) => f.id === "inactive"));
  assert.ok(formats.some((f) => f.id === "legacy_roche"));
});

