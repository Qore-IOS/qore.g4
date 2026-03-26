const LEGACY_COMPANY_ID = '__legacy__';

type ScopedRecord = {
  companyId?: string | null;
  company?: string | null;
} & Record<string, any>;

export function normalizeCompanyId(companyId?: string | null): string {
  const trimmed = (companyId || '').trim();
  return trimmed || LEGACY_COMPANY_ID;
}

export function matchesCompanyScope(
  record: ScopedRecord | null | undefined,
  currentCompanyId?: string | null,
  isSuperAdmin?: boolean
): boolean {
  if (isSuperAdmin) return true;
  const activeCompanyId = normalizeCompanyId(currentCompanyId);
  const recordCompanyId = normalizeCompanyId(record?.companyId || record?.company);
  return recordCompanyId === activeCompanyId;
}

export function filterByCompanyScope<T>(
  records: T[],
  currentCompanyId?: string | null,
  isSuperAdmin?: boolean
): T[] {
  if (isSuperAdmin) return records;
  return records.filter((record) => matchesCompanyScope(record as ScopedRecord, currentCompanyId, isSuperAdmin));
}

export function withCompanyScope<T extends Record<string, any>>(
  payload: T,
  currentCompanyId?: string | null
): T & { companyId: string } {
  return {
    ...payload,
    companyId: normalizeCompanyId(currentCompanyId),
  };
}
