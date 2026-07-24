import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOJISTIK_COUNTS_PATH,
  LOJISTIK_HOME_PATH,
} from '../../src/lib/lojistik/navigation';

test('logistics landing and count routes remain stable', () => {
  assert.equal(LOJISTIK_HOME_PATH, '/lojistik');
  assert.equal(LOJISTIK_COUNTS_PATH, '/lojistik/sayimlar');
});
