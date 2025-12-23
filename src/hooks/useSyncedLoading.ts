'use client';

import { useEffect } from 'react';
import { useLoading } from '@/contexts/loading-context';

/**
 * Syncs a component's local loading state with the global loading indicator
 *
 * @param isLoading - The component's local loading state
 *
 * @example
 * const [isLoading, setIsLoading] = useState(true);
 * useSyncedLoading(isLoading); // Global loader will show while isLoading is true
 *
 * useEffect(() => {
 *   const loadData = async () => {
 *     setIsLoading(true);
 *     await fetchData();
 *     setIsLoading(false); // Global loader will hide automatically
 *   };
 *   loadData();
 * }, []);
 */
export function useSyncedLoading(isLoading: boolean) {
  const { setGlobalLoading } = useLoading();

  useEffect(() => {
    setGlobalLoading(isLoading);

    // Cleanup: turn off loading when component unmounts
    return () => {
      setGlobalLoading(false);
    };
  }, [isLoading, setGlobalLoading]);
}
