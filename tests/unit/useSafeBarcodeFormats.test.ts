import assert from "node:assert/strict";
import test from "node:test";

import { withLegacy } from "../../src/hooks/useSafeBarcodeFormats";
import type { BarcodeFormat } from "../../src/lib/barcode";

test("withLegacy injects legacy format when missing", () => {
  const formats: BarcodeFormat[] = [
    { id: "custom", name: "Custom", strategy: "regex", active: true },
  ];

  const result = withLegacy(formats);
  assert.equal(result.length, 2);
  assert.ok(result.some((f) => f.id === "legacy_roche"));
});

test("withLegacy preserves existing legacy format and order", () => {
  const formats: BarcodeFormat[] = [
    { id: "legacy_roche", name: "Legacy", strategy: "legacy_roche" as const, active: true },
    { id: "custom", name: "Custom", strategy: "regex", active: true },
  ];

  const result = withLegacy(formats);
  assert.equal(result, formats);
});
