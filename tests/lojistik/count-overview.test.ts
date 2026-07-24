import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGroupNameById,
  buildLabCountOverview,
  productMatchesAssignedGroups,
  resolveAssignedGroupKeys,
  sessionMatchesPeriod,
  toReportingPeriod,
} from '../../src/lib/lojistik/count-overview';
import type { ProductCode } from '../../src/lib/types';

const groupDefinitions = [
  { id: 'group-bio', name: 'Biyokimya' },
  { id: 'group-elisa', name: 'Elisa' },
];

const products: ProductCode[] = [
  {
    id: 'p1',
    stokKodu: 'P-1',
    stokAdi: 'Birinci Ürün',
    laboratuvarGrubu: 'Biyokimya',
    ambalajDegeri: 100,
  },
  {
    id: 'p2',
    stokKodu: 'P-2',
    stokAdi: 'İkinci Ürün',
    laboratuvarGruplari: ['Elisa', 'Biyokimya'],
    ambalajDegeri: 50,
  },
  {
    id: 'p3',
    stokKodu: 'P-3',
    stokAdi: 'Yetkisiz Ürün',
    laboratuvarGrubu: 'Seroloji',
  },
];

test('group assignments accept definition IDs, names and multi-group products', () => {
  const namesById = buildGroupNameById(groupDefinitions);
  const assigned = resolveAssignedGroupKeys(
    ['group-bio', 'ELİSA'],
    namesById,
  );

  assert.equal(
    productMatchesAssignedGroups(products[0], assigned, namesById),
    true,
  );
  assert.equal(
    productMatchesAssignedGroups(products[1], assigned, namesById),
    true,
  );
  assert.equal(
    productMatchesAssignedGroups(products[2], assigned, namesById),
    false,
  );
});

test('multiple partial sessions complete the required product scope', () => {
  const namesById = buildGroupNameById(groupDefinitions);
  const assigned = resolveAssignedGroupKeys(['Biyokimya'], namesById);
  const overview = buildLabCountOverview({
    labId: 'lab-1',
    labName: 'Merkez Lab',
    period: '2026-07',
    products,
    labScopeCodes: ['P-1', 'P-2', 'P-3'],
    assignedGroupKeys: assigned,
    groupNameById: namesById,
    sessions: [
      {
        id: 's1',
        period: '2026-07',
        finishedAt: new Date('2026-07-04T10:00:00Z'),
        items: [{ stokKodu: 'P-1', expected: 2, counted: 0, openTestQty: 0 }],
      },
      {
        id: 's2',
        period: '2026-07',
        finishedAt: new Date('2026-07-05T10:00:00Z'),
        items: [{ stokKodu: 'P-2', expected: 3, counted: 3, openTestQty: 25 }],
      },
    ],
  });

  assert.equal(overview.countStatus, 'complete');
  assert.equal(overview.requiredProductCount, 2);
  assert.equal(overview.countedProductCount, 2);
  assert.equal(
    overview.products.find((row) => row.stokKodu === 'P-1')?.isCounted,
    true,
    'a recorded zero quantity is still a completed product count',
  );
});

test('latest occurrence supplies quantities without double-counting sessions', () => {
  const namesById = buildGroupNameById(groupDefinitions);
  const assigned = resolveAssignedGroupKeys(['Biyokimya'], namesById);
  const overview = buildLabCountOverview({
    labId: 'lab-1',
    labName: 'Merkez Lab',
    period: '2026-07',
    products: [products[0]],
    labScopeCodes: ['P-1'],
    assignedGroupKeys: assigned,
    groupNameById: namesById,
    sessions: [
      {
        id: 'older',
        period: '2026-07',
        finishedAt: new Date('2026-07-01T10:00:00Z'),
        items: [{ stokKodu: 'P-1', expected: 5, counted: 4, openTestQty: 10 }],
      },
      {
        id: 'latest',
        period: '2026-07',
        finishedAt: new Date('2026-07-03T10:00:00Z'),
        items: [
          { stokKodu: 'P-1', expected: 3, counted: 2, openTestQty: 5 },
          { stokKodu: 'P-1', expected: 2, counted: 2, openTestQty: 7 },
        ],
      },
    ],
  });
  const row = overview.products[0];

  assert.equal(row.latestSessionId, 'latest');
  assert.equal(row.countedQuantity, 4);
  assert.equal(row.systemQuantity, 5);
  assert.equal(row.openTestQuantity, 12);
  assert.equal(row.totalTests, 412);
});

test('outside-count uploads mark files as uploaded while an empty scope is neutral', () => {
  const overview = buildLabCountOverview({
    labId: 'lab-1',
    labName: 'Merkez Lab',
    period: '2026-07',
    products,
    labScopeCodes: [],
    assignedGroupKeys: new Set(['biyokimya']),
    groupNameById: buildGroupNameById(groupDefinitions),
    sessions: [],
    hasExternalKumulatifUpload: true,
    hasExternalCihazUstuUpload: true,
  });

  assert.equal(overview.countStatus, 'not_applicable');
  assert.equal(overview.kumulatifUploaded, true);
  assert.equal(overview.cihazUstuUploaded, true);
});

test('a period count stays visible after the live stock scope drops to zero', () => {
  const overview = buildLabCountOverview({
    labId: 'lab-1',
    labName: 'Merkez Lab',
    period: '2026-07',
    products: [products[0]],
    labScopeCodes: [],
    assignedGroupKeys: new Set(['biyokimya']),
    groupNameById: buildGroupNameById(groupDefinitions),
    sessions: [
      {
        id: 'zeroed-stock',
        period: '2026-07',
        finishedAt: new Date('2026-07-06T10:00:00Z'),
        items: [{ stokKodu: 'P-1', expected: 2, counted: 0 }],
      },
    ],
  });

  assert.equal(overview.countStatus, 'complete');
  assert.equal(overview.requiredProductCount, 1);
  assert.equal(overview.products[0]?.countedQuantity, 0);
});

test('saved scope snapshot keeps historical group and product definitions stable', () => {
  const overview = buildLabCountOverview({
    labId: 'lab-1',
    labName: 'Merkez Lab',
    period: '2026-07',
    products: [],
    labScopeCodes: ['NEW-CURRENT-CODE'],
    assignedGroupKeys: new Set(['biyokimya']),
    groupNameById: buildGroupNameById(groupDefinitions),
    sessions: [
      {
        id: 'snapshotted',
        period: '2026-07',
        finishedAt: new Date('2026-07-07T10:00:00Z'),
        scopeProducts: [
          {
            stokKodu: 'P-OLD',
            stokAdi: 'Tarihi Ürün',
            laboratuvarGruplari: ['Biyokimya'],
            ambalajDegeri: 10,
          },
        ],
        items: [{ stokKodu: 'P-OLD', expected: 1, counted: 1 }],
      },
    ],
  });

  assert.equal(overview.countStatus, 'complete');
  assert.deepEqual(
    overview.products.map((product) => product.stokKodu),
    ['P-OLD'],
  );
});

test('legacy sessions fall back to zero-based month/year and reporting period is converted', () => {
  assert.equal(
    sessionMatchesPeriod(
      { id: 'legacy', month: 6, year: 2026, items: [] },
      '2026-07',
    ),
    true,
  );
  assert.equal(toReportingPeriod('2026-07'), '07-2026');
});
