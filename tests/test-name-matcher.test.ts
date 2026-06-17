import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCumulative, aggregateReagent } from '../src/lib/qore-hesaplama/aggregate';
import { matchTestName, normalizeTestName, testNameSimilarity } from '../src/lib/qore-hesaplama/test-name-matcher';

test('normalizeTestName punctuation, case and roman numerals normalize to the same key', () => {
  assert.equal(normalizeTestName('A-HCV 2'), 'ahcv2');
  assert.equal(normalizeTestName('A-HCV II'), 'ahcv2');
  assert.equal(normalizeTestName('a.hcv-2'), 'ahcv2');
});

test('aggregateCumulative merges device naming variants before summing', () => {
  const rows = aggregateCumulative([
    { test: 'A-HCV 2', routine: 10, rerun: 1, calib: 0, control: 0, total: 11 },
    { test: 'A-HCV II', routine: 7, rerun: 0, calib: 1, control: 1, total: 9 },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].test, 'A-HCV 2');
  assert.equal(rows[0].total, 20);
});

test('aggregateReagent merges available test rows with normalized names', () => {
  const rows = aggregateReagent([
    { test: 'A-HCV 2', available: 100, src: 'mod1' },
    { test: 'A-HCV II', available: 30, src: 'mod2' },
  ]);

  assert.deepEqual(rows, [{ test: 'A-HCV 2', available: 130 }]);
});

test('matchTestName supports aliases for semantic differences such as Syphil-2 and Syphilis', () => {
  const match = matchTestName('Syphil-2', [
    { id: 'syphilis', displayName: 'Syphilis', aliases: ['Syphil-2', 'Syphil II'] },
  ]);

  assert.equal(match.status, 'alias');
  assert.equal(match.candidate?.id, 'syphilis');
});

test('testNameSimilarity can suggest near misses without auto accepting low confidence terms', () => {
  assert.ok(testNameSimilarity('hemoglabin', 'hemoglobin') > 0.85);
  assert.equal(matchTestName('DIGO', [{ id: 'ferr', displayName: 'FERR' }]).status, 'unknown');
});
