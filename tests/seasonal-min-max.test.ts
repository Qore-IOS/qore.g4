import test from 'node:test';
import assert from 'node:assert/strict';
import { getActiveMinMaxPeriod, normalizePeriodId, resolveSeasonalMinMaxRule } from '../src/lib/seasonal-min-max';

const config = {
  periods: [{ id: 'kis', name: 'Kış' }, { id: 'yaz', name: 'Yaz' }],
  monthPeriodMap: { 1: 'kis', 7: 'yaz' },
};

test('getActiveMinMaxPeriod selects the period assigned to the current month', () => {
  assert.deepEqual(getActiveMinMaxPeriod(config, new Date(2026, 0, 15)), { id: 'kis', name: 'Kış' });
  assert.deepEqual(getActiveMinMaxPeriod(config, new Date(2026, 6, 15)), { id: 'yaz', name: 'Yaz' });
});

test('resolveSeasonalMinMaxRule uses seasonal values and preserves other rule fields', () => {
  const result = resolveSeasonalMinMaxRule({ stokKodu: 'R1', min: 1, max: 2, maxGun: 30, donemDegerleri: { kis: { min: 10, max: 20 }, yaz: { min: 4, max: 8 } } }, config, new Date(2026, 6, 1));
  assert.equal(result.min, 4);
  assert.equal(result.max, 8);
  assert.equal(result.maxGun, 30);
});

test('normalizePeriodId creates stable Turkish-compatible ids', () => {
  assert.equal(normalizePeriodId('  Kış Dönemi  '), 'kis-donemi');
});
