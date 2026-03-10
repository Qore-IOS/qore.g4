'use client';

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStockUpdateListener } from '@/hooks/useFirebaseQueries';

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
      <StockUpdateObserver />
      {children}
    </QueryClientProvider>
  );
}

// Component to listen for stock metadata changes and invalidate cache
function StockUpdateObserver() {
  useStockUpdateListener();
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
