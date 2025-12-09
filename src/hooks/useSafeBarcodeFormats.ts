// src/hooks/useSafeBarcodeFormats.ts
'use client';
import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query, where, type Firestore } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { BarcodeFormat } from '../lib/barcode';

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
      const result = await fetchBarcodeFormats();
      if (!canceled) {
        setState({ formats: result.formats, loading: false, error: result.error });
      }
    }

    load();
    return () => {
      canceled = true;
    };
  }, []);

  return state;
}

export async function fetchBarcodeFormats(targetDb: Firestore = db): Promise<{ formats: BarcodeFormat[]; error?: string }> {
  try {
    const preferred = query(
      collection(targetDb, 'barcodeFormats'),
      where('active', '==', true),
      orderBy('priority', 'asc')
    );
    const snap = await getDocs(preferred);
    const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
    return { formats: withLegacy(items) };
  } catch (err: any) {
    // Fallback: fetch full collection, filter/sort locally
    try {
      const snapAll = await getDocs(collection(targetDb, 'barcodeFormats'));
      const all = snapAll.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
      const activeOnly = all
        .filter((f: any) => f.active !== false)
        .sort((a: any, b: any) => (a.priority ?? 9999) - (b.priority ?? 9999));

      return { formats: withLegacy(activeOnly), error: err?.message };
    } catch (err2: any) {
      return {
        formats: withLegacy([]),
        error: err2?.message || 'Formats could not be loaded.',
      };
    }
  }
}

export function withLegacy(list: BarcodeFormat[]): BarcodeFormat[] {
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
