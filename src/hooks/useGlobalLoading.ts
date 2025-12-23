'use client';

import { useCallback } from 'react';
import { useLoading } from '@/contexts/loading-context';

/**
 * Hook for managing global loading state
 * Use this when you need to show a loading indicator during async operations
 *
 * @example
 * // Basic usage
 * const { startLoading, stopLoading } = useGlobalLoading();
 *
 * const handleSubmit = async () => {
 *   startLoading();
 *   try {
 *     await someAsyncOperation();
 *   } finally {
 *     stopLoading();
 *   }
 * };
 *
 * @example
 * // Using withLoading wrapper
 * const { withLoading } = useGlobalLoading();
 *
 * const handleSubmit = withLoading(async () => {
 *   await someAsyncOperation();
 * });
 */
export function useGlobalLoading() {
  const { startGlobalLoading, stopGlobalLoading, isGlobalLoading } = useLoading();

  /**
   * Wraps an async function with loading state management
   * Automatically shows loading when the function starts and hides it when done
   * Handles errors gracefully and ensures loading is stopped even if the function throws
   */
  const withLoading = useCallback(
    <T extends (...args: any[]) => Promise<any>>(fn: T): T => {
      return (async (...args: Parameters<T>) => {
        startGlobalLoading();
        try {
          return await fn(...args);
        } finally {
          stopGlobalLoading();
        }
      }) as T;
    },
    [startGlobalLoading, stopGlobalLoading]
  );

  return {
    /**
     * Whether global loading is currently active
     */
    isLoading: isGlobalLoading,

    /**
     * Start showing the global loading indicator
     */
    startLoading: startGlobalLoading,

    /**
     * Stop showing the global loading indicator
     */
    stopLoading: stopGlobalLoading,

    /**
     * Wrap an async function with automatic loading state management
     */
    withLoading,
  };
}
