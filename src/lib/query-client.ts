/**
 * Paylaşılan TanStack Query client.
 *
 * QueryClient'ı React context dosyasından ayrı, saf bir modülde tutuyoruz ki
 * veri katmanı (src/lib/firestore-fetch.ts) React'e bağımlı olmadan
 * `setQueryData` / `invalidateQueries` çağırabilsin. query-context.tsx bu
 * instance'ı provider'a verir; ikisi her zaman aynı cache'i paylaşır.
 */
import { QueryClient } from '@tanstack/react-query';

export const appQueryClient = new QueryClient({
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
