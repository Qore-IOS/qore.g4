import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTestName, normalizeTestName, testNameSimilarity } from '../src/lib/qore-hesaplama/test-name-matcher';

test('normalizeTestName punctuation, case and roman numerals normalize to the same key', () => {
  assert.equal(normalizeTestName('A-HCV 2'), 'ahcv2');
  assert.equal(normalizeTestName('A-HCV II'), 'ahcv2');
  assert.equal(normalizeTestName('a.hcv-2'), 'ahcv2');
});

test('matchTestName connects parsed file tests to filtered product test names without changing aggregation engines', () => {
  const match = matchTestName('A-HCV II', [
    { id: 'product-a-hcv', displayName: 'A-HCV 2' },
  ]);

  assert.equal(match.status, 'normalized');
  assert.equal(match.candidate?.id, 'product-a-hcv');
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
