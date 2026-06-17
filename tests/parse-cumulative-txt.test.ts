import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCumulativeTxtFiles } from '../src/lib/qore-hesaplama/parse-cumulative-txt';
import { aggregateCumulative } from '../src/lib/qore-hesaplama/aggregate';

test('parseCumulativeTxtFiles preserves middle cumulative columns from right-aligned TXT rows', async () => {
  const txt = `
Cumulative Operations List          01/05/26    20:48
TEST     CODE ROUTINE   CALIB. CONTROL   RERUN    STAT    TOTAL
X        0001   1000       10     300      20       0     1330
Y        0002   2000       10     300      11       0     2321
MODULE E -2
X        0001    111       16      71       6       0      204
Y        0002     53       10      41      10       0      114
-------------------------------------------------------------
TOTAL           3164       46     712      47       0     3969
`;

  const rows = aggregateCumulative(await parseCumulativeTxtFiles([
    new File([txt], 'cumulative.txt', { type: 'text/plain' }),
  ]));

  assert.deepEqual(rows.find((row) => row.test === 'X'), {
    test: 'X',
    routine: 1111,
    rerun: 26,
    calib: 26,
    control: 371,
    total: 1534,
  });
  assert.deepEqual(rows.find((row) => row.test === 'Y'), {
    test: 'Y',
    routine: 2053,
    rerun: 21,
    calib: 20,
    control: 341,
    total: 2435,
  });
});
