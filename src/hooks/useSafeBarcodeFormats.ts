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
 * Loads barcode formats via the dual-source reader (Admin SDK server action,
 * falling back to the client SDK when that path is down — see master-data-resilient.ts).
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
        // İki kaynaklı okuma (Admin SDK → istemci SDK yedeği); bkz. master-data-resilient.ts.
        const { fetchBarcodeFormatsResilient } = await import('@/lib/master-data-resilient');
        const { items } = await fetchBarcodeFormatsResilient(currentCompanyId, isSuperAdmin ?? false);
        if (!canceled) setState({ formats: withLegacy(items), loading: false });
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
