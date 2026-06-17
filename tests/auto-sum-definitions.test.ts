import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCumulativeAutoSum, applyReagentAutoSum } from '../src/lib/qore-hesaplama/auto-sum-definitions';

const definitions = [
  { id: 'hiv', mainTestName: 'AHIV', includeTestNames: ['HIVAG'] },
];

test('applyCumulativeAutoSum folds alias test counts into the main test', () => {
  const rows = applyCumulativeAutoSum([
    { test: 'AHIV', routine: 10, rerun: 1, calib: 0, control: 0, total: 11 },
    { test: 'HIVAG', routine: 5, rerun: 0, calib: 1, control: 1, total: 7 },
  ], definitions);

  assert.deepEqual(rows, [{ test: 'AHIV', routine: 15, rerun: 1, calib: 1, control: 1, total: 18 }]);
});

test('applyReagentAutoSum folds alias available counts into the main test', () => {
  const rows = applyReagentAutoSum([
    { test: 'AHIV', available: 100 },
    { test: 'HIVAG', available: 25 },
  ], definitions);

  assert.deepEqual(rows, [{ test: 'AHIV', available: 125 }]);
});
