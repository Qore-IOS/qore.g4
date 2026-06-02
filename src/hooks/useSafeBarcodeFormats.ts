// src/hooks/useSafeBarcodeFormats.ts
'use client';
import { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { getScopedDocs } from '@/lib/firestore-helpers';
import { filterByCompanyScope } from '@/lib/company-scope';
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
 *
 * Legacy-aware: getScopedDocs eski/__legacy__ etiketli format kayıtlarını
 * non-superadmin oturumlarda da getirir. Aksi halde mal kabul ve ürün
 * kullanım panellerinde (useBarcodeFormatsQuery üstünden çalışan) okuyan
 * bir barkod, direkt transfer panelinde "format hatası" verir; çünkü bu
 * hook scopedQuery'nin server-side companyId filtresine takılı kalıyordu.
 */
export function useSafeBarcodeFormats(): State {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [state, setState] = useState<State>({ formats: [], loading: true });

  useEffect(() => {
    let canceled = false;

    async function load() {
      setState(prev => ({ ...prev, loading: true, error: undefined }));
      try {
        // Preferred query — tenant-scoped, legacy-aware
        const docs = await getScopedDocs(
          'barcodeFormats',
          currentCompanyId,
          isSuperAdmin,
          where('active', '==', true),
        );
        const items = docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
        const scoped = filterByCompanyScope(items, currentCompanyId, isSuperAdmin);
        // Sort by priority (ascending - lower priority number = higher precedence)
        const sorted = scoped.sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));
        if (!canceled) {
          setState({ formats: withLegacy(sorted), loading: false });
        }
      } catch (err: any) {
        // Fallback: fetch tenant collection without active filter, filter/sort locally
        try {
          const docsAll = await getScopedDocs('barcodeFormats', currentCompanyId, isSuperAdmin);
          const all = docsAll.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
          const scoped = filterByCompanyScope(all, currentCompanyId, isSuperAdmin);
          const activeOnly = scoped.filter((f: any) => f.active !== false);
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
