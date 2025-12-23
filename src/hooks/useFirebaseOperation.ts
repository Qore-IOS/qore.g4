'use client';

import { useGlobalLoading } from './useGlobalLoading';
import { useCallback } from 'react';

/**
 * Hook for Firebase operations with automatic loading state
 * Use this for direct Firebase operations (setDoc, updateDoc, deleteDoc, etc.)
 * that are not wrapped in React Query mutations
 *
 * @example
 * const { executeWithLoading } = useFirebaseOperation();
 *
 * const handleSave = async () => {
 *   await executeWithLoading(async () => {
 *     await setDoc(doc(db, 'collection', 'id'), data);
 *   });
 * };
 */
export function useFirebaseOperation() {
  const { withLoading, startLoading, stopLoading } = useGlobalLoading();

  /**
   * Execute a Firebase operation with automatic loading state
   * Automatically handles loading start/stop and errors
   */
  const executeWithLoading = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      return await withLoading(operation)();
    },
    [withLoading]
  );

  /**
   * Execute multiple Firebase operations in parallel with loading state
   */
  const executeBatchWithLoading = useCallback(
    async <T,>(operations: Array<() => Promise<T>>): Promise<T[]> => {
      return await withLoading(async () => {
        return await Promise.all(operations.map(op => op()));
      })();
    },
    [withLoading]
  );

  /**
   * Execute multiple Firebase operations sequentially with loading state
   */
  const executeSequentialWithLoading = useCallback(
    async <T,>(operations: Array<() => Promise<T>>): Promise<T[]> => {
      return await withLoading(async () => {
        const results: T[] = [];
        for (const operation of operations) {
          results.push(await operation());
        }
        return results;
      })();
    },
    [withLoading]
  );

  return {
    /**
     * Execute a single Firebase operation with loading
     */
    executeWithLoading,

    /**
     * Execute multiple operations in parallel with loading
     */
    executeBatchWithLoading,

    /**
     * Execute multiple operations sequentially with loading
     */
    executeSequentialWithLoading,

    /**
     * Manual control (use only if you need fine-grained control)
     */
    startLoading,
    stopLoading,
  };
}
