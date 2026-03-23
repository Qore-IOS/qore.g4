/**
 * Şirket Bazlı Veri Filtreleme Katmanı
 *
 * Bu modül, Firestore sorgularına şirket bazlı filtreleme ekler.
 *
 * - Legacy kullanıcılar (companyId yok): Filtre uygulanmaz, mevcut davranış korunur
 * - Şirket kullanıcıları (companyId var): where('companyId', '==', id) filtresi eklenir
 * - Paylaşılan koleksiyonlar (productCodes, barcodeFormats): Her zaman filtresiz
 *
 * Composite Index: Firestore, yeni where clause eklenen sorgular için composite index
 * gerektirebilir. Bu durumda tarayıcı konsolunda index oluşturma URL'si loglanır.
 */

import {
  collection,
  query,
  where,
  getDocs as firestoreGetDocs,
  type CollectionReference,
  type Query,
  type QueryConstraint,
  type QuerySnapshot,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { LEGACY_COMPANY_ID } from '@/lib/types';

/** Tüm şirketler için ortak olan, filtrelenMEyecek koleksiyonlar */
const SHARED_COLLECTIONS = new Set([
  'productCodes',
  'barcodeFormats',
  'companies',
]);

/**
 * Bir koleksiyon adının paylaşılan (şirket filtresi uygulanmayan) bir koleksiyon olup olmadığını kontrol eder.
 */
export function isSharedCollection(collectionName: string): boolean {
  return SHARED_COLLECTIONS.has(collectionName);
}

/**
 * Şirket filtresinin uygulanıp uygulanmayacağını belirler.
 * Legacy kullanıcılar ve paylaşılan koleksiyonlar için false döner.
 */
export function shouldApplyCompanyFilter(companyId: string, collectionName: string): boolean {
  if (SHARED_COLLECTIONS.has(collectionName)) return false;
  if (!companyId || companyId === LEGACY_COMPANY_ID) return false;
  return true;
}

/**
 * Şirket filtresi için gerekli where constraint'lerini döndürür.
 * Legacy kullanıcılar ve paylaşılan koleksiyonlar için boş array döner.
 */
export function companyWhereConstraints(companyId: string, collectionName: string): QueryConstraint[] {
  if (!shouldApplyCompanyFilter(companyId, collectionName)) return [];
  return [where('companyId', '==', companyId)];
}

/**
 * Şirket filtreli Firestore query oluşturur.
 *
 * Kullanım:
 * ```
 * const snap = await getDocs(companyQuery(db, 'depots', companyId));
 * const snap = await getDocs(companyQuery(db, 'depoStok', companyId, where('depotId', '==', id)));
 * ```
 */
export function companyQuery(
  db: Firestore,
  collectionName: string,
  companyId: string,
  ...extraConstraints: QueryConstraint[]
): Query | CollectionReference {
  const ref = collection(db, collectionName);
  const companyConstraints = companyWhereConstraints(companyId, collectionName);
  const allConstraints = [...companyConstraints, ...extraConstraints];

  if (allConstraints.length === 0) return ref;
  return query(ref, ...allConstraints);
}

/**
 * Mevcut bir query'ye şirket filtresi ekler.
 * Zaten oluşturulmuş query'lere ek where clause eklemek için kullanılır.
 *
 * Kullanım:
 * ```
 * const baseQ = query(collection(db, 'orders'), where('status', '==', 'pending'));
 * const filtered = addCompanyFilter(baseQ, companyId, 'orders');
 * ```
 */
export function addCompanyFilter(
  baseQuery: Query | CollectionReference,
  companyId: string,
  collectionName: string
): Query | CollectionReference {
  if (!shouldApplyCompanyFilter(companyId, collectionName)) return baseQuery;
  return query(baseQuery, where('companyId', '==', companyId));
}

/**
 * Yazma işlemlerinde veriye companyId damgalar.
 * Legacy kullanıcılar ve paylaşılan koleksiyonlar için veriyi olduğu gibi döndürür.
 *
 * Kullanım:
 * ```
 * await addDoc(collection(db, 'orders'), companyStamp({ ...orderData }, companyId, 'orders'));
 * ```
 */
export function companyStamp<T extends Record<string, any>>(
  data: T,
  companyId: string,
  collectionName: string
): T {
  if (!shouldApplyCompanyFilter(companyId, collectionName)) return data;
  return { ...data, companyId };
}

/**
 * Firestore composite index hatalarını yakalayıp konsola index oluşturma URL'si loglayan getDocs wrapper'ı.
 * Firestore "requires an index" hatası verdiğinde, hata mesajındaki URL otomatik olarak loglanır.
 * Bu URL'ye tıklayarak Firebase konsolundan index'i tek tıkla oluşturabilirsiniz.
 */
export async function safeGetDocs<T = DocumentData>(
  q: Query | CollectionReference
): Promise<QuerySnapshot<T>> {
  try {
    return await firestoreGetDocs(q) as QuerySnapshot<T>;
  } catch (error: any) {
    const msg = error?.message || '';
    // Firestore composite index hatası yakalandığında URL'yi logla
    const indexUrlMatch = msg.match(/(https:\/\/console\.firebase\.google\.com[^\s"']+)/);
    if (indexUrlMatch) {
      console.error(
        `%c🔥 COMPOSITE INDEX GEREKLİ%c\nAşağıdaki URL'ye tıklayarak index oluşturun:\n%c${indexUrlMatch[1]}`,
        'color: #ff6b35; font-weight: bold; font-size: 14px;',
        'color: #ff6b35;',
        'color: #4CAF50; text-decoration: underline; font-size: 12px;'
      );
      console.error('Hata detayı:', msg);
    }
    throw error;
  }
}
