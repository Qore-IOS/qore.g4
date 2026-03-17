'use client';

/**
 * useCompanyFirestore
 *
 * Firestore yazma işlemlerini saran hook.
 * TENANT_COLLECTIONS listesindeki collection'lara yazarken
 * companyId otomatik eklenir — elle eklemeye gerek yok.
 *
 * Kullanım:
 *   const { addDoc, setDoc } = useCompanyFirestore();
 *   await addDoc('depots', { name: 'Depo A' });
 *   // → Firestore'a { name: 'Depo A', companyId: 'ISLAB2' } gider
 */

import { useCallback } from 'react';
import {
  collection,
  doc,
  addDoc as _addDoc,
  setDoc as _setDoc,
  updateDoc as _updateDoc,
  DocumentReference,
  CollectionReference,
  WithFieldValue,
  DocumentData,
  SetOptions,
  UpdateData,
  FieldPath,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCompany } from '@/contexts/company-context';
import { TENANT_COLLECTIONS } from '@/contexts/company-context';

/** Collection adını string veya CollectionReference'dan çıkarır */
function getCollectionName(collectionPath: string | CollectionReference): string {
  if (typeof collectionPath === 'string') {
    // "hospitals" veya "hospitals/docId/subCollection" → ilk segment
    return collectionPath.split('/')[0];
  }
  return collectionPath.path.split('/')[0];
}

export function useCompanyFirestore() {
  const { activeCompanyId } = useCompany();

  /**
   * addDoc: Yeni döküman ekler, tenant collection ise companyId otomatik eklenir.
   */
  const addDoc = useCallback(
    async <T extends DocumentData>(
      collectionPath: string | CollectionReference<T>,
      data: WithFieldValue<T>
    ) => {
      const collectionName = getCollectionName(collectionPath as string | CollectionReference);
      const isTenant = TENANT_COLLECTIONS.has(collectionName);

      const finalData = isTenant && activeCompanyId
        ? { ...data, companyId: activeCompanyId }
        : data;

      const colRef = typeof collectionPath === 'string'
        ? collection(db, collectionPath)
        : collectionPath;

      return _addDoc(colRef as CollectionReference<DocumentData>, finalData as WithFieldValue<DocumentData>);
    },
    [activeCompanyId]
  );

  /**
   * setDoc: Döküman oluşturur/üstüne yazar, tenant collection ise companyId otomatik eklenir.
   */
  const setDoc = useCallback(
    async <T extends DocumentData>(
      docRef: DocumentReference<T>,
      data: WithFieldValue<T>,
      options?: SetOptions
    ) => {
      const collectionName = docRef.parent.path.split('/')[0];
      const isTenant = TENANT_COLLECTIONS.has(collectionName);

      // merge: true iken companyId zaten varsa üzerine yazmayız
      const shouldInject = isTenant && activeCompanyId && !(data as DocumentData).companyId;
      const finalData = shouldInject
        ? { ...data, companyId: activeCompanyId }
        : data;

      return options
        ? _setDoc(docRef, finalData as WithFieldValue<T>, options)
        : _setDoc(docRef, finalData as WithFieldValue<T>);
    },
    [activeCompanyId]
  );

  /**
   * updateDoc: Mevcut dökümanı günceller.
   * companyId zaten var olduğundan dokunmayız — olduğu gibi iletilir.
   */
  const updateDoc = useCallback(
    <T extends DocumentData>(
      docRef: DocumentReference<T>,
      data: UpdateData<T> | { [x: string]: unknown },
      ...moreFieldsAndValues: (string | FieldPath | unknown)[]
    ) => {
      if (moreFieldsAndValues.length > 0) {
        return _updateDoc(
          docRef,
          data as string | FieldPath,
          ...(moreFieldsAndValues as [unknown, ...unknown[]])
        );
      }
      return _updateDoc(docRef, data as UpdateData<T>);
    },
    []
  );

  /**
   * Kolayca collection referansı oluştur.
   */
  const col = useCallback(
    (path: string) => collection(db, path),
    []
  );

  /**
   * Kolayca doc referansı oluştur.
   */
  const docRef = useCallback(
    (path: string, ...segments: string[]) => doc(db, path, ...segments),
    []
  );

  return { addDoc, setDoc, updateDoc, col, docRef };
}
