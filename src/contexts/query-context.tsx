'use client';

import React, { useRef, useEffect } from 'react';
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from '@tanstack/react-query';
import { useLoading } from './loading-context';

// We need to create the query client with cache callbacks
// But we need access to loading context, so we'll create it inside the provider
function createQueryClientWithLoading(
  startLoading: () => void,
  stopLoading: () => void
) {
  // Track active operations
  let activeOperations = 0;

  const startOperation = () => {
    activeOperations++;
    if (activeOperations === 1) {
      startLoading();
    }
  };

  const endOperation = () => {
    activeOperations--;
    if (activeOperations === 0) {
      stopLoading();
    }
  };

  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        console.error('Query error:', error);
        endOperation();
      },
      onSuccess: () => {
        endOperation();
      },
    }),
    mutationCache: new MutationCache({
      onMutate: () => {
        startOperation();
      },
      onSettled: () => {
        endOperation();
      },
    }),
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
      mutations: {
        onMutate: () => {
          startOperation();
        },
        onSettled: () => {
          endOperation();
        },
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const { startGlobalLoading, stopGlobalLoading } = useLoading();
  const queryClientRef = useRef<QueryClient>();

  if (!queryClientRef.current) {
    queryClientRef.current = createQueryClientWithLoading(
      startGlobalLoading,
      stopGlobalLoading
    );
  }

  return (
    <QueryClientProvider client={queryClientRef.current}>
      {children}
    </QueryClientProvider>
  );
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
