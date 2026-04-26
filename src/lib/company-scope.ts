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
  _record: ScopedRecord | null | undefined,
  _currentCompanyId?: string | null,
  _isSuperAdmin?: boolean
): boolean {
  return true;
}

export function filterByCompanyScope<T>(
  records: T[],
  _currentCompanyId?: string | null,
  _isSuperAdmin?: boolean
): T[] {
  return records;
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
