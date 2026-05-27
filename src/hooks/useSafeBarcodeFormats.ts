// src/hooks/useSafeBarcodeFormats.ts
'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import type { BarcodeFormat } from '@/lib/barcode';

type State = {
  formats: BarcodeFormat[];
  loading: boolean;
  error?: string;
};

/**
 * Loads barcode formats robustly:
 * 1) Try active=true ordered by priority (preferred)
 * 2) If that fails (index/network), fetch all and filter client-side
 * 3) Ensure legacy Roche is present as a fallback entry
 */
export function useSafeBarcodeFormats(): State {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [state, setState] = useState<State>({ formats: [], loading: true });

  useEffect(() => {
    let canceled = false;

    async function load() {
      setState(prev => ({ ...prev, loading: true, error: undefined }));
      try {
        // Preferred query — tenant-scoped
        const q = scopedQuery(
          'barcodeFormats',
          currentCompanyId,
          isSuperAdmin,
          where('active', '==', true)
        );
        const snap = await getDocs(q);
        const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
        // Sort by priority (ascending - lower priority number = higher precedence)
        const sorted = items.sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));
        if (!canceled) {
          setState({ formats: withLegacy(sorted), loading: false });
        }
      } catch (err: any) {
        // Fallback: fetch tenant collection, filter/sort locally
        try {
          const snapAll = await getDocs(scopedQuery('barcodeFormats', currentCompanyId, isSuperAdmin));
          const all = snapAll.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
          const activeOnly = all.filter((f: any) => f.active !== false);
          // Sort by priority (ascending - lower priority number = higher precedence)
          const sorted = activeOnly.sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));

          if (!canceled) {
            setState({ formats: withLegacy(sorted), loading: false, error: err?.message });
          }
        } catch (err2: any) {
          if (!canceled) {
            setState({
              formats: withLegacy([]),
              loading: false,
              error: err2?.message || 'Formats could not be loaded.',
            });
          }
        }
      }
    }

    load();
    return () => {
      canceled = true;
    };
  }, [currentCompanyId, isSuperAdmin]);

  return state;
}

function withLegacy(list: BarcodeFormat[]): BarcodeFormat[] {
  // Ensure legacy Roche parser appears as a selectable strategy if you use it in useBarcodeParser
  const hasLegacy = list.some((f: any) => f.strategy === 'legacy_roche' || f.id === 'legacy_roche');
  return hasLegacy
    ? list
    : [
        ...list,
        {
          id: 'legacy_roche',
          name: 'Legacy (Roche – gömülü)',
          strategy: 'legacy_roche' as const,
          active: true,
        } as any,
      ];
}
