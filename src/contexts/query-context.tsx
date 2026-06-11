'use client';

import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStockUpdateListener } from '@/hooks/useFirebaseQueries';
import { appQueryClient, queryRetryOptions } from '@/lib/query-client';
import { initFirestoreConnectionWatchdog } from '@/lib/firestore-network-recovery';

// Stable query client — gerçek instance src/lib/query-client.ts'te yaşar ki
// React dışındaki veri katmanı (cache-first fetch) aynı cache'e yazabilsin.
const queryClient = appQueryClient;

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Zombi WebChannel kurtarma: uyku/ağ değişimi sonrası Firestore
  // bağlantısını proaktif tazeler (bkz. src/lib/firestore-network-recovery.ts).
  useEffect(() => {
    initFirestoreConnectionWatchdog();
  }, []);

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
        ...queryRetryOptions,
        refetchOnMount: false,
      },
    },
  });
};
