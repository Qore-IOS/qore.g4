/**
 * Paylaşılan TanStack Query client.
 *
 * QueryClient'ı React context dosyasından ayrı, saf bir modülde tutuyoruz ki
 * veri katmanı (src/lib/firestore-fetch.ts) React'e bağımlı olmadan
 * `setQueryData` / `invalidateQueries` çağırabilsin. query-context.tsx bu
 * instance'ı provider'a verir; ikisi her zaman aynı cache'i paylaşır.
 *
 * STABİLİZASYON (P0.2): global `retry: 2` kaldırıldı. Kör retry, içeride
 * zaten timeout+retry yapan resilient okuma katmanıyla çarpılınca tek
 * logical sorguyu dakikalara uzatıyordu ve permission/index/validation gibi
 * KESİN hataları da anlamsızca tekrarlıyordu. Yeni politika hata sınıfına
 * bakar: kalıcı hatalarda hiç retry yok, geçici hatalarda en fazla bir.
 */
import { QueryClient } from '@tanstack/react-query';
import { recordDataIssue } from '@/lib/perf/data-vitals';

/**
 * Tekrar denemenin sonucu DEĞİŞTİRMEYECEĞİ hata kodları. Firebase hem
 * 'permission-denied' hem 'firestore/permission-denied' biçimini
 * kullanabildiği için son segmente bakılır.
 */
const NON_RETRIABLE_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'failed-precondition', // eksik composite index dahil
  'invalid-argument',
  'not-found',
  'already-exists',
  'out-of-range',
  'unimplemented',
  'data-loss',
]);

export function isNonRetriableError(error: unknown): boolean {
  const err = error as { code?: unknown; name?: unknown } | null | undefined;
  // Resilient katman (firestore-network-recovery) timeout'ta kendi retry'ını
  // zaten yaptı; üstüne TanStack retry'ı bindirmek beklemeyi katlar.
  if (err?.name === 'FirestoreTimeoutError') return true;
  if (typeof err?.code === 'string') {
    const code = err.code.includes('/') ? err.code.split('/').pop()! : err.code;
    return NON_RETRIABLE_CODES.has(code);
  }
  return false;
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isNonRetriableError(error)) return false;
  if (failureCount >= 1) return false; // geçici hatada en fazla 1 retry
  const code = (error as { code?: string } | null)?.code;
  recordDataIssue('query-retry', code ?? (error as Error | null)?.message ?? 'unknown');
  return true;
}

/** Tek retry için kısa, jitter'lı gecikme (thundering herd önleyici). */
function retryDelay(attemptIndex: number): number {
  return Math.min(2_000, 500 * 2 ** attemptIndex) + Math.random() * 250;
}

export const queryRetryOptions = {
  retry: shouldRetry,
  retryDelay,
} as const;

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 5 minutes
      staleTime: 5 * 60 * 1000,
      // Keep unused data in cache for 30 minutes
      gcTime: 30 * 60 * 1000,
      // Don't refetch on window focus by default (we'll handle this selectively)
      refetchOnWindowFocus: false,
      ...queryRetryOptions,
      // Don't refetch on mount if data is fresh
      refetchOnMount: false,
    },
  },
});
