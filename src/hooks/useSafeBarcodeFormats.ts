// src/hooks/useSafeBarcodeFormats.ts
'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import type { BarcodeFormat } from '@/lib/barcode';

type State = {
  formats: BarcodeFormat[];
  loading: boolean;
  error?: string;
};

/**
 * Loads barcode formats via Admin SDK server action (bypasses IndexedDB).
 * Falls back to withLegacy([]) on error so callers always get a usable array.
 */
export function useSafeBarcodeFormats(): State {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [state, setState] = useState<State>({ formats: [], loading: true });

  useEffect(() => {
    let canceled = false;

    async function load() {
      setState(prev => ({ ...prev, loading: true, error: undefined }));
      try {
        const { getBarcodeFormatsAction } = await import('@/actions/stokActions');
        const items = await getBarcodeFormatsAction(currentCompanyId, isSuperAdmin ?? false) as BarcodeFormat[];
        const sorted = items.slice().sort((a, b) => ((a as any).priority ?? 10) - ((b as any).priority ?? 10));
        if (!canceled) setState({ formats: withLegacy(sorted), loading: false });
      } catch (err: any) {
        if (!canceled) {
          setState({
            formats: withLegacy([]),
            loading: false,
            error: err?.message || 'Formats could not be loaded.',
          });
        }
      }
    }

    load();
    return () => { canceled = true; };
  }, [currentCompanyId, isSuperAdmin]);

  return state;
}

/**
 * Gömülü Roche formatını listeye ekler (yoksa).
 *
 * DIŞA AÇIK: masaüstü terminali barkod formatlarını bu hook üzerinden değil,
 * önyükleme deposundan okur — ama aynı yedek formatı eklemek zorundadır,
 * yoksa o formatla basılmış eski barkodlar terminalde okunamaz.
 */
export function withLegacyBarcodeFormat(list: BarcodeFormat[]): BarcodeFormat[] {
  return withLegacy(list);
}

function withLegacy(list: BarcodeFormat[]): BarcodeFormat[] {
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
