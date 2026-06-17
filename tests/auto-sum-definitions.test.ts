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


test('applyCumulativeAutoSum combines multiple aliases from separate definitions into the same main test', () => {
  const rows = applyCumulativeAutoSum([
    { test: 'X', routine: 300, rerun: 0, calib: 0, control: 0, total: 300 },
    { test: 'X2', routine: 150, rerun: 0, calib: 0, control: 0, total: 150 },
    { test: 'X*', routine: 150, rerun: 0, calib: 0, control: 0, total: 150 },
  ], [
    { id: 'x-2', mainTestName: 'X', includeTestNames: ['X2'] },
    { id: 'x-star', mainTestName: 'X', includeTestNames: ['X*'] },
  ]);

  assert.deepEqual(rows, [{ test: 'X', routine: 600, rerun: 0, calib: 0, control: 0, total: 600 }]);
});

test('applyReagentAutoSum combines multiple aliases from separate definitions into the same main test', () => {
  const rows = applyReagentAutoSum([
    { test: 'X', available: 300 },
    { test: 'X2', available: 150 },
    { test: 'X*', available: 150 },
  ], [
    { id: 'x-2', mainTestName: 'X', includeTestNames: ['X2'] },
    { id: 'x-star', mainTestName: 'X', includeTestNames: ['X*'] },
  ]);

  assert.deepEqual(rows, [{ test: 'X', available: 600 }]);
});
