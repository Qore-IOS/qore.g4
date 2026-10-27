'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from '../lib/data/client';
import { db } from '../lib/data/client';
import { getScopedDocs } from '@/lib/document-helpers';
import type { Hospital, LabPool, ProductCode } from '@/lib/types';
import { useProductCodes } from '@/hooks/useDatabaseQueries';

export type CalculationProductRow = {
  stokKodu: string;
  stokAdi: string;
  testAdi: string;
  marka: string;
  urunGrubu: string;
  counterEnabled?: boolean;
  counterPlusEnabled?: boolean;
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
  const [minMaxRulesMap, setMinMaxRulesMap] = useState<Map<string, { counterEnabled: boolean; counterPlusEnabled: boolean }>>(new Map());
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
      setMinMaxRulesMap(new Map());
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
            return snap.docs.map((d) => {
              const data = d.data();
              return {
                stokKodu: d.id || String(data.stokKodu || ''),
                counterEnabled: !!data.counterEnabled,
                counterPlusEnabled: !!data.counterPlusEnabled
              };
            });
          })
        );
        if (!alive) return;
        
        const ruleMap = new Map<string, { counterEnabled: boolean; counterPlusEnabled: boolean }>();
        entries.flat().forEach(entry => {
          if (!ruleMap.has(entry.stokKodu)) {
            ruleMap.set(entry.stokKodu, {
              counterEnabled: entry.counterEnabled,
              counterPlusEnabled: entry.counterPlusEnabled
            });
          } else {
            const existing = ruleMap.get(entry.stokKodu)!;
            ruleMap.set(entry.stokKodu, {
              counterEnabled: existing.counterEnabled || entry.counterEnabled,
              counterPlusEnabled: existing.counterPlusEnabled || entry.counterPlusEnabled
            });
          }
        });
        
        setMinMaxRulesMap(ruleMap);
        setMinMaxProductCodes(new Set(ruleMap.keys()));
      } catch (e: any) {
        if (!alive) return;
        setMinMaxRulesMap(new Map());
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
      .map((p) => {
        const rule = minMaxRulesMap.get(p.stokKodu!);
        return {
          stokKodu: p.stokKodu!,
          stokAdi: p.stokAdi!,
          testAdi: String(p.testAdi || ''),
          marka: String(p.marka || ''),
          urunGrubu: String(p.urunGrubu || ''),
          counterEnabled: rule?.counterEnabled ?? false,
          counterPlusEnabled: rule?.counterPlusEnabled ?? false,
        };
      })
      .sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr'));
  }, [minMaxProductCodes, productCodes, minMaxRulesMap]);

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
