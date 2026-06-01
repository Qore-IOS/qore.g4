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
  query,
  where,
  type Query,
  type QueryConstraint,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { normalizeCompanyId } from '@/lib/company-scope';

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
