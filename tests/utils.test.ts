import assert from "node:assert/strict";
import test from "node:test";

import { isValid61Digits, normalizeGS1GroupSeparators, parseBarcode, sanitizeGS1 } from "../src/lib/utils";

test("sanitizeGS1 removes separators and whitespace", () => {
  const raw = "]C101234\u001d5678 90\u001d";
  const cleaned = sanitizeGS1(raw);
  assert.equal(cleaned, "]C101234567890");
});

test("normalizeGS1GroupSeparators converts tokenized separators to ASCII 29", () => {
  const raw = "010123<FNC1>10LOT[GS]21SERI\\x1DEND␝";
  const normalized = normalizeGS1GroupSeparators(raw);
  const gs = String.fromCharCode(29);
  assert.equal(normalized, `010123${gs}10LOT${gs}21SERI${gs}END${gs}`);
});

test("isValid61Digits validates strict length", () => {
  const valid = "1".repeat(61);
  const invalid = "1".repeat(60);
  assert.equal(isValid61Digits(valid), true);
  assert.equal(isValid61Digits(invalid), false);
});

test("parseBarcode extracts Roche QR payload sections", () => {
  const barcodeArray = Array(61).fill("0");

  const setSegment = (start: number, value: string) => {
    value.split("").forEach((char, index) => {
      barcodeArray[start + index] = char;
    });
  };

  setSegment(18, "240201"); // yy aa gg -> 01.02.2024
  setSegment(26, "87654321");
  setSegment(36, "123456789012");
  setSegment(50, "99887766554");

  const barcode = barcodeArray.join("");
  const result = parseBarcode(barcode);

  assert.ok(result, "expected parseBarcode to succeed for a 61-digit payload");
  assert.equal(result?.miadFormatted, "01.02.2024");
  assert.equal(result?.lotNumarasi, "87654321");
  assert.equal(result?.seriNumarasi, "123456789012");
  assert.equal(result?.refNo, "99887766554");
});
