/**
 * useCursorPagination — Firestore cursor-based pagination için hook.
 *
 * Faz 2 performans optimizasyonu. `limit() + startAfter()` ile sayfa
 * sayfa veri çeker; toplam sayıyı `getCountFromServer` ile alır.
 * Tüm koleksiyonu indirmek yerine sadece o anki sayfayı server'dan getirir.
 *
 * Kullanım:
 *   const pagination = useCursorPagination({
 *     collectionName: 'productReturns',
 *     orderByField: 'returnedAt',
 *     pageSize: 20,
 *     companyId, isSuperAdmin,
 *     extraConstraints: [where('status', '==', 'open')],
 *     mapper: (d) => ({ id: d.id, ...d.data() }) as ReturnRecord,
 *   });
 *
 *   pagination.items, pagination.totalCount, pagination.page, pagination.loading
 *   pagination.nextPage(), pagination.prevPage(), pagination.goToPage(n)
 *
 * Composite index gerekir: (companyId ASC, <orderByField> DESC) + filter alanları.
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  orderBy as orderByFn,
  limit as limitFn,
  startAfter,
  getDocs,
  getCountFromServer,
  type QueryDocumentSnapshot,
  type QueryConstraint,
  type DocumentData,
  type OrderByDirection,
} from 'firebase/firestore';
import { scopedQuery } from '@/lib/firestore-helpers';

export interface UseCursorPaginationOptions<T> {
  collectionName: string;
  orderByField: string;
  orderDirection?: OrderByDirection;
  pageSize?: number;
  companyId: string | null | undefined;
  isSuperAdmin: boolean | undefined;
  /** Ek `where(...)` veya `orderBy(...)` constraint'leri. */
  extraConstraints?: QueryConstraint[];
  /** Firestore döküman → uygulama tipine dönüşüm. */
  mapper: (doc: QueryDocumentSnapshot<DocumentData>) => T;
  /** Hata durumunda callback. */
  onError?: (err: Error) => void;
  /**
   * `extraConstraints` değişimini takip için referans. Değişirse sayfa
   * 1'e döner, cursor sıfırlanır. Filtre seçimlerini buraya koyun.
   */
  resetKey?: string;
}

export interface CursorPaginationResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  setPageSize: (size: number) => void;
  totalPages: number;
  loading: boolean;
  error: Error | null;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  refresh: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}

export function useCursorPagination<T>(opts: UseCursorPaginationOptions<T>): CursorPaginationResult<T> {
  const {
    collectionName,
    orderByField,
    orderDirection = 'desc',
    companyId,
    isSuperAdmin,
    extraConstraints = [],
    mapper,
    onError,
    resetKey,
  } = opts;

  const [pageSize, setPageSize] = useState<number>(opts.pageSize ?? 20);
  const [page, setPage] = useState<number>(1);
  const [items, setItems] = useState<T[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Her sayfanın son dökümanı (cursor)
  const cursorStackRef = useRef<QueryDocumentSnapshot[]>([]);

  // resetKey değişince sayfa 1'e dön ve cursor'ları temizle.
  useEffect(() => {
    cursorStackRef.current = [];
    setPage(1);
  }, [resetKey, pageSize]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const fetchPage = useCallback(async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      let q = scopedQuery(
        collectionName,
        companyId,
        isSuperAdmin,
        ...extraConstraints,
        orderByFn(orderByField, orderDirection),
        limitFn(pageSize),
      );

      if (pageNum > 1) {
        const prevCursor = cursorStackRef.current[pageNum - 2];
        if (prevCursor) {
          q = scopedQuery(
            collectionName,
            companyId,
            isSuperAdmin,
            ...extraConstraints,
            orderByFn(orderByField, orderDirection),
            startAfter(prevCursor),
            limitFn(pageSize),
          );
        }
      }

      const snap = await getDocs(q);
      const mapped = snap.docs.map(mapper);
      setItems(mapped);

      if (snap.docs.length > 0) {
        const newStack = [...cursorStackRef.current];
        newStack[pageNum - 1] = snap.docs[snap.docs.length - 1];
        cursorStackRef.current = newStack;
      }
    } catch (err) {
      const e = err as Error;
      setError(e);
      onError?.(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [collectionName, companyId, isSuperAdmin, orderByField, orderDirection, pageSize, mapper, onError, extraConstraints]);

  const fetchTotal = useCallback(async () => {
    try {
      const q = scopedQuery(
        collectionName,
        companyId,
        isSuperAdmin,
        ...extraConstraints,
      );
      const snap = await getCountFromServer(q);
      setTotalCount(snap.data().count);
    } catch (err) {
      // Toplam sayım başarısız olursa pagination yine çalışır, sadece "X of Y" gösterimi eksik kalır.
      setTotalCount(0);
    }
  }, [collectionName, companyId, isSuperAdmin, extraConstraints]);

  // İlk yükleme + page değişimi + resetKey değişimi
  useEffect(() => {
    fetchPage(page);
  }, [fetchPage, page]);

  useEffect(() => {
    fetchTotal();
  }, [fetchTotal]);

  const nextPage = useCallback(() => {
    if (page < totalPages) setPage(p => p + 1);
  }, [page, totalPages]);

  const prevPage = useCallback(() => {
    if (page > 1) setPage(p => p - 1);
  }, [page]);

  const goToPage = useCallback((target: number) => {
    if (target < 1 || target > totalPages) return;
    // İleri sıçramada cursor'lar eksik olabilir; emin olmak için sırayla doldur.
    if (target > page && !cursorStackRef.current[target - 2]) {
      // Cursor eksikse 1'den itibaren git (basit ve doğru; nadir kullanım).
      setPage(1);
      cursorStackRef.current = [];
    } else {
      setPage(target);
    }
  }, [page, totalPages]);

  const refresh = useCallback(() => {
    cursorStackRef.current = [];
    setPage(1);
    fetchTotal();
    fetchPage(1);
  }, [fetchPage, fetchTotal]);

  return {
    items,
    totalCount,
    page,
    pageSize,
    setPageSize,
    totalPages,
    loading,
    error,
    nextPage,
    prevPage,
    goToPage,
    refresh,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
