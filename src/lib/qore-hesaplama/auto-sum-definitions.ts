import type { CumulativeRow } from './parse-cumulative';
import type { AggregatedReagentRow } from './aggregate';
import { normalizeTestName } from './test-name-matcher';

export type TestAutoSumDefinition = {
  id: string;
  mainTestName: string;
  includeTestNames: string[];
  companyId?: string;
  createdAt?: any;
  updatedAt?: any;
};

function buildAliasToMainMap(definitions: TestAutoSumDefinition[]): Map<string, string> {
  const map = new Map<string, string>();
  definitions.forEach((definition) => {
    const mainKey = normalizeTestName(definition.mainTestName);
    if (!mainKey) return;
    map.set(mainKey, mainKey);
    definition.includeTestNames.forEach((alias) => {
      const aliasKey = normalizeTestName(alias);
      if (aliasKey) map.set(aliasKey, mainKey);
    });
  });
  return map;
}

function mainNameForKey(definitions: TestAutoSumDefinition[], mainKey: string, fallback: string): string {
  return definitions.find((definition) => normalizeTestName(definition.mainTestName) === mainKey)?.mainTestName || fallback;
}

export function applyCumulativeAutoSum(rows: CumulativeRow[], definitions: TestAutoSumDefinition[]): CumulativeRow[] {
  if (!definitions.length) return rows;
  const aliasToMain = buildAliasToMainMap(definitions);
  const map = new Map<string, CumulativeRow>();

  rows.forEach((row) => {
    const rowKey = normalizeTestName(row.test);
    const targetKey = aliasToMain.get(rowKey) || rowKey || row.test.trim().toUpperCase();
    const targetName = aliasToMain.has(rowKey) ? mainNameForKey(definitions, targetKey, row.test) : row.test;
    const prev = map.get(targetKey);
    if (!prev) {
      map.set(targetKey, { ...row, test: targetName.trim() });
      return;
    }
    map.set(targetKey, {
      test: prev.test,
      routine: prev.routine + row.routine,
      rerun: prev.rerun + row.rerun,
      calib: prev.calib + row.calib,
      control: prev.control + row.control,
      total: prev.total + row.total,
    });
  });

  return Array.from(map.values()).sort((a, b) => a.test.localeCompare(b.test, 'tr'));
}

export function applyReagentAutoSum(rows: AggregatedReagentRow[], definitions: TestAutoSumDefinition[]): AggregatedReagentRow[] {
  if (!definitions.length) return rows;
  const aliasToMain = buildAliasToMainMap(definitions);
  const map = new Map<string, AggregatedReagentRow>();

  rows.forEach((row) => {
    const rowKey = normalizeTestName(row.test);
    const targetKey = aliasToMain.get(rowKey) || rowKey || row.test.trim().toUpperCase();
    const targetName = aliasToMain.has(rowKey) ? mainNameForKey(definitions, targetKey, row.test) : row.test;
    const prev = map.get(targetKey);
    map.set(targetKey, {
      test: prev?.test || targetName.trim(),
      available: (prev?.available || 0) + (row.available || 0),
    });
  });

  return Array.from(map.values()).sort((a, b) => a.test.localeCompare(b.test, 'tr'));
}
