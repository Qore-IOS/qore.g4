/**
 * Firestore query helpers — multi-tenancy aware.
 *
 * `scopedQuery` is the single entry point for building company-scoped
 * collection queries. It injects `where('companyId', '==', X)` automatically
 * for non-superadmin sessions and falls through unfiltered for superadmins.
 * Product-code definition collections are intentionally global and are never
 * filtered by company.
 *
 * After Faz 4 every hook in src/hooks/useFirebaseQueries.ts uses this helper,
 * so tenant data isolation is enforced at the database level — the
 * client-side `filterByCompanyScope` in src/lib/company-scope.ts is kept as
 * defense-in-depth until Faz 9.
 */
import {
  collection,
  getDocsFromCache,
  query,
  where,
  type Query,
  type QueryConstraint,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { matchesCompanyScope, normalizeCompanyId } from '@/lib/company-scope';
import {
  getDocsCacheFirst,
  revalidateInBackground,
  type QueryFnCtx,
} from '@/lib/firestore-fetch';
import { getDocsResilient } from '@/lib/firestore-network-recovery';

/**
 * Faz 4 (perf-stability-recovery-plan): companyId alanı HİÇ olmayan çok eski
 * kayıtlar için çalıştırılan ek "unscoped" uyumluluk sorgusunun anahtarı.
 * Multi-tenancy migration'ı üretimde doğrulandıktan sonra
 * NEXT_PUBLIC_LEGACY_UNTAGGED_COMPAT=off ile kapatın — scoped okuma yapılan
 * her koleksiyon için bir tam koleksiyon sorgusu tasarruf ettirir.
 * (`__legacy__` ETİKETLİ kayıt sorgusu bundan bağımsızdır ve açık kalır.)
 */
const LEGACY_UNTAGGED_COMPAT =
  process.env.NEXT_PUBLIC_LEGACY_UNTAGGED_COMPAT !== 'off';

export const GLOBAL_DEFINITION_COLLECTIONS = new Set([
  'def_brands',
  'def_labGroups',
  'def_testGroups',
  'def_deviceGroups',
  'def_productGroups',
  'def_mainUnits',
]);

export function isGlobalDefinitionCollection(collectionPath: string): boolean {
  return GLOBAL_DEFINITION_COLLECTIONS.has(collectionPath);
}

/**
 * Build a Firestore Query for `collectionPath` that's scoped to the caller's
 * company. Superadmins and shared product-definition collections receive an
 * unscoped query.
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
  if (isGlobalDefinitionCollection(collectionPath) || isSuperAdmin || normalized === '__legacy__') {
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

  if (isGlobalDefinitionCollection(collectionPath) || isSuperAdmin || normalized === '__legacy__') {
    return (await getDocsResilient(scopedQuery(collectionPath, currentCompanyId, isSuperAdmin, ...extraConstraints))).docs;
  }

  const base = collection(db, collectionPath);
  const [companySnap, legacySnap] = await Promise.all([
    getDocsResilient(query(base, where('companyId', '==', normalized), ...extraConstraints)),
    getDocsResilient(query(base, where('companyId', '==', '__legacy__'), ...extraConstraints)),
  ]);

  const docsById = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  companySnap.docs.forEach((docSnap) => docsById.set(docSnap.id, docSnap));
  legacySnap.docs.forEach((docSnap) => {
    if (!docsById.has(docSnap.id)) docsById.set(docSnap.id, docSnap);
  });

  // Backward compatibility for very old, untagged records. In multi-tenant
  // projects this unscoped read may be rejected by security rules; in that case
  // the explicit company/legacy query result above remains the source of truth.
  if (LEGACY_UNTAGGED_COMPAT) {
    try {
      const unscopedSnap = await getDocsResilient(query(base, ...extraConstraints));
      unscopedSnap.docs
        .filter((docSnap) => matchesCompanyScope(docSnap.data(), normalized, isSuperAdmin))
        .forEach((docSnap) => {
          if (!docsById.has(docSnap.id)) docsById.set(docSnap.id, docSnap);
        });
    } catch {
      // Ignore permission/index failures from the compatibility path.
    }
  }

  return Array.from(docsById.values());
}

/**
 * `getScopedDocs`'un cache-first muadili (React Query hook'ları için).
 *
 * Birincil (company) sorgu local cache'ten gelebiliyorsa sonuç milisaniyeler
 * içinde döner; legacy + untagged uyumluluk sorguları da cache'ten okunur ve
 * üçü birden arka planda sunucudan tazelenip ilgili query key invalidate
 * edilir. Birincil sorgu cache'te yoksa (ilk ziyaret) davranış birebir
 * `getScopedDocs` ile aynıdır — sadece takılan kanala karşı timeout +
 * otomatik kurtarma korumalıdır.
 */
export async function getScopedDocsCacheFirst(
  ctx: QueryFnCtx,
  collectionPath: string,
  currentCompanyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
  ...extraConstraints: QueryConstraint[]
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const normalized = normalizeCompanyId(currentCompanyId);

  if (isGlobalDefinitionCollection(collectionPath) || isSuperAdmin || normalized === '__legacy__') {
    const snap = await getDocsCacheFirst(
      ctx,
      scopedQuery(collectionPath, currentCompanyId, isSuperAdmin, ...extraConstraints),
    );
    return snap.docs;
  }

  const base = collection(db, collectionPath);
  const companyQuery = query(base, where('companyId', '==', normalized), ...extraConstraints);
  const legacyQuery = query(base, where('companyId', '==', '__legacy__'), ...extraConstraints);
  const unscopedQuery = query(base, ...extraConstraints);

  const companySnap = await getDocsCacheFirst(ctx, companyQuery);

  const docsById = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  companySnap.docs.forEach((docSnap) => docsById.set(docSnap.id, docSnap));

  const mergeSnap = (snap: { docs: QueryDocumentSnapshot<DocumentData>[] }, scopeFilter = false) => {
    snap.docs
      .filter((docSnap) => !scopeFilter || matchesCompanyScope(docSnap.data(), normalized, isSuperAdmin))
      .forEach((docSnap) => {
        if (!docsById.has(docSnap.id)) docsById.set(docSnap.id, docSnap);
      });
  };

  if (companySnap.metadata.fromCache) {
    // Hızlı yol: uyumluluk sorguları da cache'ten gelir (boşsa eksik legacy
    // kayıtlar arka plan tazelemesiyle ~1sn içinde görünür). Sunucuyu
    // bloklamadan beklemek, "panel açılır açılmaz veri" garantisinin parçası.
    try {
      mergeSnap(await getDocsFromCache(legacyQuery));
    } catch { /* cache erişilemedi — arka plan tazelemesi telafi eder */ }
    revalidateInBackground(ctx, legacyQuery);
    if (LEGACY_UNTAGGED_COMPAT) {
      try {
        mergeSnap(await getDocsFromCache(unscopedQuery), true);
      } catch { /* ignore */ }
      revalidateInBackground(ctx, unscopedQuery);
    }
  } else {
    // İlk yükleme: tam doğruluk için orijinal sunucu yolu.
    mergeSnap(await getDocsResilient(legacyQuery));
    if (LEGACY_UNTAGGED_COMPAT) {
      try {
        mergeSnap(await getDocsResilient(unscopedQuery), true);
      } catch {
        // Multi-tenant kurallarda unscoped okuma reddedilebilir — yoksay.
      }
    }
  }

  return Array.from(docsById.values());
}
