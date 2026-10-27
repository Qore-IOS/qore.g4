'use client';

import { useGlobalLoading } from './useGlobalLoading';
import { useCallback } from 'react';

/**
 * Hook for database operations with automatic loading state
 * Use this for direct database operations (setDoc, updateDoc, deleteDoc, etc.)
 * that are not wrapped in React Query mutations
 *
 * @example
 * const { executeWithLoading } = useDatabaseOperation();
 *
 * const handleSave = async () => {
 *   await executeWithLoading(async () => {
 *     await setDoc(doc(db, 'collection', 'id'), data);
 *   });
 * };
 */
export function useDatabaseOperation() {
  const { withLoading, startLoading, stopLoading } = useGlobalLoading();

  /**
   * Execute a database operation with automatic loading state
   * Automatically handles loading start/stop and errors
   */
  const executeWithLoading = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      return await withLoading(operation)();
    },
    [withLoading]
  );

  /**
   * Execute multiple database operations in parallel with loading state
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
   * Execute multiple database operations sequentially with loading state
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
     * Execute a single database operation with loading
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
