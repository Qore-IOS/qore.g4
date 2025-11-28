// src/hooks/useSafeBarcodeFormats.ts
'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
  const [state, setState] = useState<State>({ formats: [], loading: true });

  useEffect(() => {
    let canceled = false;

    async function load() {
      setState(prev => ({ ...prev, loading: true, error: undefined }));
      try {
        // Preferred query (might require composite index on your project)
        const q = query(
          collection(db, 'barcodeFormats'),
          where('active', '==', true)
        );
        const snap = await getDocs(q);
        const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
        if (!canceled) {
          setState({ formats: withLegacy(items), loading: false });
        }
      } catch (err: any) {
        // Fallback: fetch full collection, filter/sort locally
        try {
          const snapAll = await getDocs(collection(db, 'barcodeFormats'));
          const all = snapAll.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
          const activeOnly = all.filter((f: any) => f.active !== false);
          
          if (!canceled) {
            setState({ formats: withLegacy(activeOnly), loading: false, error: err?.message });
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
  }, []);

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
