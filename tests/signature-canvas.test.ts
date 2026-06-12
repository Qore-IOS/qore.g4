import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSignatureExportDimensions,
  getSignaturePixelRatio,
  MAX_SIGNATURE_HISTORY_ENTRIES,
} from '../src/lib/signature-canvas';

test('iPad-like DPR 2 remains unchanged', () => {
  assert.equal(getSignaturePixelRatio(2), 2);
});

test('iPhone-like DPR 3 is capped to keep canvas memory bounded', () => {
  assert.equal(getSignaturePixelRatio(3), 2);
});

test('invalid DPR values fall back to 1', () => {
  assert.equal(getSignaturePixelRatio(undefined), 1);
  assert.equal(getSignaturePixelRatio(0), 1);
  assert.equal(getSignaturePixelRatio(Number.NaN), 1);
});

test('signature export uses stable logical dimensions', () => {
  assert.deepEqual(getSignatureExportDimensions(500, 200), { width: 500, height: 200 });
  assert.deepEqual(getSignatureExportDimensions(0, -10), { width: 1, height: 1 });
});

test('undo history has a finite device-independent limit', () => {
  assert.equal(MAX_SIGNATURE_HISTORY_ENTRIES, 12);
});
