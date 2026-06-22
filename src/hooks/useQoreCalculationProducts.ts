'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getScopedDocs } from '@/lib/firestore-helpers';
import type { Hospital, LabPool, ProductCode } from '@/lib/types';
import { useProductCodes } from '@/hooks/useFirebaseQueries';

export type CalculationProductRow = {
  stokKodu: string;
  stokAdi: string;
  testAdi: string;
  marka: string;
  urunGrubu: string;
};

const ALL = '__all__';

export const ALL_FILTER_VALUE = ALL;

export function useQoreCalculationProducts({
  hospitalId,
  hospitals,
  currentCompanyId,
  isSuperAdmin,
}: {
  hospitalId: string;
  hospitals: Hospital[];
  currentCompanyId?: string | null;
  isSuperAdmin?: boolean | null;
}) {
  const productsQuery = useProductCodes();
  const productCodes = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [minMaxProductCodes, setMinMaxProductCodes] = useState<Set<string>>(new Set());
  const [isLoadingScope, setIsLoadingScope] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const docs = await getScopedDocs('labPools', currentCompanyId, !!isSuperAdmin);
        if (!alive) return;
        setLabPools(docs.map((d) => ({ id: d.id, ...d.data() } as LabPool)));
      } catch {
        if (!alive) return;
        setLabPools([]);
      }
    })();
    return () => { alive = false; };
  }, [currentCompanyId, isSuperAdmin]);

  const selectedPool = useMemo(
    () => labPools.find((pool) => pool.mainLabId === hospitalId),
    [hospitalId, labPools]
  );

  const scopedLabIds = useMemo(() => {
    if (!hospitalId) return [];
    if (selectedPool?.memberIds?.length) return Array.from(new Set(selectedPool.memberIds));
    return [hospitalId];
  }, [hospitalId, selectedPool]);

  const scopeLabel = useMemo(() => {
    if (!selectedPool) return '';
    return `${selectedPool.name} havuzu (${scopedLabIds.length} lab)`;
  }, [selectedPool, scopedLabIds.length]);

  useEffect(() => {
    let alive = true;
    if (!hospitalId) {
      setMinMaxProductCodes(new Set());
      setScopeError(null);
      return;
    }

    (async () => {
      setIsLoadingScope(true);
      setScopeError(null);
      try {
        const entries = await Promise.all(
          scopedLabIds.map(async (labId) => {
            const snap = await getDocs(collection(db, 'hospitals', labId, 'minMaxRules'));
            return snap.docs.map((d) => d.id || String((d.data() as any).stokKodu || '')).filter(Boolean);
          })
        );
        if (!alive) return;
        setMinMaxProductCodes(new Set(entries.flat()));
      } catch (e: any) {
        if (!alive) return;
        setMinMaxProductCodes(new Set());
        setScopeError(e?.message || 'Min-max ürünleri yüklenemedi.');
      } finally {
        if (alive) setIsLoadingScope(false);
      }
    })();

    return () => { alive = false; };
  }, [hospitalId, scopedLabIds]);

  const rows = useMemo<CalculationProductRow[]>(() => {
    if (!minMaxProductCodes.size) return [];
    const byCode = new Map<string, ProductCode>();
    productCodes.forEach((p) => {
      if (p.stokKodu && minMaxProductCodes.has(p.stokKodu) && !byCode.has(p.stokKodu)) byCode.set(p.stokKodu, p);
    });
    return Array.from(byCode.values())
      .map((p) => ({
        stokKodu: p.stokKodu,
        stokAdi: p.stokAdi,
        testAdi: String(p.testAdi || ''),
        marka: String(p.marka || ''),
        urunGrubu: String(p.urunGrubu || ''),
      }))
      .sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr'));
  }, [minMaxProductCodes, productCodes]);

  const brandOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.marka).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr')),
    [rows]
  );
  const productGroupOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.urunGrubu).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr')),
    [rows]
  );

  return {
    rows,
    brandOptions,
    productGroupOptions,
    isLoadingScope: isLoadingScope || productsQuery.isLoading,
    scopeError,
    scopeLabel,
    scopedLabIds,
    selectedHospital: hospitals.find((h) => h.id === hospitalId) || null,
  };
}
