'use client';

import { useEffect, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useToast } from './use-toast';

interface UseRequiredParamOptions {
  /** The dynamic parameter name from the route, e.g., 'id' for /items/[id] */
  param: string;
  /** An optional search parameter to also retrieve from the URL */
  searchParam?: string;
  /** The route to redirect to if the parameter is missing */
  fallbackRoute: string;
  /** The message to show in the toast notification on failure */
  toastMessage?: string;
}

/**
 * A hook to safely access a required dynamic route parameter.
 * It handles various types from `useParams` and `useSearchParams`,
 * provides a stable string value, and redirects if the param is missing.
 *
 * @returns An object with the stable parameter value and any requested search params.
 * If the required param is missing, this hook triggers a redirect and the component will unmount.
 * The returned value will be an empty string during the brief moment before redirection.
 */
export function useRequiredParam(options: UseRequiredParamOptions) {
  const { param, searchParam, fallbackRoute, toastMessage } = options;

  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const getStableId = (p: string | string[] | null | undefined): string | undefined => {
    if (Array.isArray(p)) return p[0] || undefined;
    return p || undefined;
  };
  
  const stableId = useMemo(() => getStableId(params?.[param]), [params, param]);
  const stableSearchParam = useMemo(() => searchParams.get(searchParam || ''), [searchParams, searchParam]);

  useEffect(() => {
    if (!stableId) {
      if (toastMessage) {
        toast({
          title: 'Hata',
          description: toastMessage,
          variant: 'destructive',
        });
      }
      const finalFallback = searchParam && stableSearchParam 
        ? `${fallbackRoute}?${searchParam}=${stableSearchParam}`
        : fallbackRoute;
      router.replace(finalFallback);
    }
  }, [stableId, fallbackRoute, toastMessage, toast, router, searchParam, stableSearchParam]);

  return { [param]: stableId || '', [searchParam || 'searchParam']: stableSearchParam };
}