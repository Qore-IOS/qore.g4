/**
 * Firestore query helpers — multi-tenancy aware.
 *
 * `scopedQuery` is the single entry point for building company-scoped
 * collection queries. It injects `where('companyId', '==', X)` automatically
 * for non-superadmin sessions and falls through unfiltered for superadmins.
 * Product-code definition collections are intentionally global and are never
 * filtered by company.
 *
 * After Faz 4 every hook in src/hooks/useDatabaseQueries.ts uses this helper,
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
} from './data/client';
import { db } from './data/client';
import { normalizeCompanyId } from '@/lib/company-scope';

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

  // NOT: burada bir zamanlar, `companyId` alanı hiç olmayan çok eski kayıtları
  // da toplamak için filtresiz bir okuma vardı (`getDocs(query(base))`) ve
  // sonucu `matchesCompanyScope` ile istemcide elenirdi.
  //
  // Kaldırıldı, çünkü tam da işe yaramasının sebebi bir güvenlik açığıydı:
  // kurallardaki etiketsiz-belge dalı `list` için de açık olduğundan filtresiz
  // sorgu kabul ediliyor ve BÜTÜN şirketlerin belgelerini istemciye
  // gönderiyordu; ayıklama yalnızca tarayıcıda yapılıyordu. Kural artık
  // etiketsiz dalı `get` ile sınırlıyor, dolayısıyla bu okuma her çağrıda
  // permission-denied alır — sessizce yutulsa bile kuralların üretim
  // izlemesini ("denied" olmamalı) kalıcı olarak kirletirdi.
  //
  // Etiketsiz eski kayıtlar listelerde görünsün isteniyorsa companyId
  // backfill'i gerekir; sorgu ya hepsini döndürür ya hiçbirini.
  return Array.from(docsById.values());
}
