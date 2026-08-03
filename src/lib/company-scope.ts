const LEGACY_COMPANY_ID = '__legacy__';

type ScopedRecord = {
  companyId?: string | null;
  company?: string | null;
} & Record<string, any>;

export function normalizeCompanyId(companyId?: string | null): string {
  const trimmed = (companyId || '').trim();
  return trimmed || LEGACY_COMPANY_ID;
}

/**
 * Reads a record's company tag. Returns `null` for legacy records (missing
 * or blank companyId, or explicitly marked as the legacy bucket) so callers
 * can treat them as company-agnostic.
 */
function readRecordCompanyTag(record: ScopedRecord | null | undefined): string | null {
  if (!record) return null;
  const raw = record.companyId ?? record.company;
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === LEGACY_COMPANY_ID) return null;
  return trimmed;
}

export function matchesCompanyScope(
  record: ScopedRecord | null | undefined,
  currentCompanyId?: string | null,
  isSuperAdmin?: boolean
): boolean {
  if (isSuperAdmin) return true;
  const recordCompany = readRecordCompanyTag(record);
  // Legacy / untagged records are visible to every user as a backward
  // compatibility fallback. Once a record carries an explicit companyId,
  // it's only visible to members of that company.
  if (recordCompany === null) return true;
  return recordCompany === normalizeCompanyId(currentCompanyId);
}

/**
 * Mirrors `scopedQuery()` exactly for tenant-owned collections.
 *
 * Unlike the legacy-compatible `matchesCompanyScope`, this does not expose
 * `__legacy__` or untagged records to a user who has an explicit company. Use
 * it when an Admin SDK/unscoped query must return the same rows as a panel that
 * reads through `scopedQuery()`.
 */
export function matchesScopedQueryCompany(
  record: ScopedRecord | null | undefined,
  currentCompanyId?: string | null,
  isSuperAdmin?: boolean,
): boolean {
  const target = normalizeCompanyId(currentCompanyId);
  if (isSuperAdmin || target === LEGACY_COMPANY_ID) return true;
  return String(record?.companyId ?? '').trim() === target;
}

export function filterByCompanyScope<T>(
  records: T[],
  currentCompanyId?: string | null,
  isSuperAdmin?: boolean
): T[] {
  if (isSuperAdmin) return records;
  const target = normalizeCompanyId(currentCompanyId);
  return records.filter(r => {
    const recordCompany = readRecordCompanyTag(r as ScopedRecord);
    if (recordCompany === null) return true; // legacy fallback
    return recordCompany === target;
  });
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

/**
 * Filters records by user's assigned laboratory IDs. Records without a lab
 * field are kept (they aren't lab-scoped). Super admins and users without lab
 * restrictions see everything.
 */
export function filterByAssignedLabs<T extends Record<string, any>>(
  records: T[],
  assignedLabIds: string[] | undefined | null,
  options?: {
    labIdFields?: string[];
    isSuperAdmin?: boolean;
  }
): T[] {
  if (options?.isSuperAdmin) return records;
  const labs = assignedLabIds ?? [];
  if (labs.length === 0) return records;
  const fields = options?.labIdFields ?? ['labId', 'hospitalId', 'laboratoryId'];
  const allowed = new Set(labs);
  return records.filter(r => {
    for (const f of fields) {
      const v = r?.[f];
      if (typeof v === 'string' && v) {
        return allowed.has(v);
      }
    }
    // No lab field on the record — not lab-scoped; keep it.
    return true;
  });
}
