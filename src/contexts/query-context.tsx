'use client';

import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useLoading } from './loading-context';

// Create a stable query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 5 minutes
      staleTime: 5 * 60 * 1000,
      // Keep unused data in cache for 30 minutes
      gcTime: 30 * 60 * 1000,
      // Don't refetch on window focus by default (we'll handle this selectively)
      refetchOnWindowFocus: false,
      // Retry failed requests 2 times
      retry: 2,
      // Don't refetch on mount if data is fresh
      refetchOnMount: false,
    },
  },
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <QueryLoadingObserver />
      {children}
    </QueryClientProvider>
  );
}

// Component to observe React Query state and control global loading
function QueryLoadingObserver() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const { setGlobalLoading } = useLoading();

  useEffect(() => {
    // Show loading if there are any fetches or mutations in progress
    const isLoading = isFetching > 0 || isMutating > 0;
    setGlobalLoading(isLoading);
  }, [isFetching, isMutating, setGlobalLoading]);

  return null;
}

export const getQueryClient = () => {
  // For backwards compatibility, but note: this won't have loading hooks
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 2,
        refetchOnMount: false,
      },
    },
  });
};
