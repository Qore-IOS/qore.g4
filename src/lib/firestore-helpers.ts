/**
 * Firestore query helpers — multi-tenancy aware.
 *
 * `scopedQuery` is the single entry point for building company-scoped
 * collection queries. It injects `where('companyId', '==', X)` automatically
 * for non-superadmin sessions and falls through unfiltered for superadmins.
 *
 * After Faz 4 every hook in src/hooks/useFirebaseQueries.ts uses this helper,
 * so tenant data isolation is enforced at the database level — the
 * client-side `filterByCompanyScope` in src/lib/company-scope.ts is kept as
 * defense-in-depth until Faz 9.
 */
import {
  collection,
  getDocs,
  query,
  where,
  type Query,
  type QueryConstraint,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { matchesCompanyScope, normalizeCompanyId } from '@/lib/company-scope';

/**
 * Build a Firestore Query for `collectionPath` that's scoped to the caller's
 * company. Superadmins receive an unscoped query so they can browse across
 * tenants from the admin console.
 *
 * Composite indexes (firestore.indexes.json) cover the common
 * `(companyId, <orderBy/where>)` shapes — see Faz 5.
 */
export function scopedQuery(
  collectionPath: string,
  currentCompanyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
  ...extraConstraints: QueryConstraint[]
): Query<DocumentData> {
  const base = collection(db, collectionPath);
  const normalized = normalizeCompanyId(currentCompanyId);
  if (isSuperAdmin || normalized === '__legacy__') {
    return extraConstraints.length > 0
      ? query(base, ...extraConstraints)
      : query(base);
  }
  return query(
    base,
    where('companyId', '==', normalized),
    ...extraConstraints,
  );
}


/**
 * Fetch scoped collection docs while preserving the legacy compatibility rule
 * from `filterByCompanyScope`: non-superadmin users should see both records
 * tagged with their company and records explicitly tagged as `__legacy__`.
 *
 * Firestore cannot express "companyId is missing OR companyId == X" in a
 * single query, so callers that need legacy-aware list screens should use this
 * helper instead of reading `scopedQuery(...).docs` directly.
 */
export async function getScopedDocs(
  collectionPath: string,
  currentCompanyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
  ...extraConstraints: QueryConstraint[]
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const normalized = normalizeCompanyId(currentCompanyId);

  if (isSuperAdmin || normalized === '__legacy__') {
    return (await getDocs(scopedQuery(collectionPath, currentCompanyId, isSuperAdmin, ...extraConstraints))).docs;
  }

  const base = collection(db, collectionPath);
  const [companySnap, legacySnap] = await Promise.all([
    getDocs(query(base, where('companyId', '==', normalized), ...extraConstraints)),
    getDocs(query(base, where('companyId', '==', '__legacy__'), ...extraConstraints)),
  ]);

  const docsById = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  companySnap.docs.forEach((docSnap) => docsById.set(docSnap.id, docSnap));
  legacySnap.docs.forEach((docSnap) => {
    if (!docsById.has(docSnap.id)) docsById.set(docSnap.id, docSnap);
  });

  // Backward compatibility for very old, untagged records. In multi-tenant
  // projects this unscoped read may be rejected by security rules; in that case
  // the explicit company/legacy query result above remains the source of truth.
  try {
    const unscopedSnap = await getDocs(query(base, ...extraConstraints));
    unscopedSnap.docs
      .filter((docSnap) => matchesCompanyScope(docSnap.data(), normalized, isSuperAdmin))
      .forEach((docSnap) => {
        if (!docsById.has(docSnap.id)) docsById.set(docSnap.id, docSnap);
      });
  } catch {
    // Ignore permission/index failures from the compatibility path.
  }

  return Array.from(docsById.values());
}
