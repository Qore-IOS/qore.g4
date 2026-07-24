'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  collection,
  getDocs,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { getScopedDocs } from '@/lib/firestore-helpers';
import {
  buildGroupNameById,
  buildLabCountOverview,
  formatCalculationPeriod,
  parseCalculationPeriod,
  resolveAssignedGroupKeys,
  toReportingPeriod,
  type LabGroupDefinition,
  type LogisticsCountSessionInput,
  type LogisticsLabCountOverview,
} from '@/lib/lojistik/count-overview';
import type { Hospital, ProductCode } from '@/lib/types';

export interface LogisticsCountOverviewData {
  period: string;
  periodLabel: string;
  labs: LogisticsLabCountOverview[];
  assignedGroupNames: string[];
  sourceWarnings: string[];
  loadedAt: Date;
}

interface LoadOverviewOptions {
  period: string;
  assignedLabIds: string[];
  assignedLabGroups: string[];
  currentCompanyId?: string | null;
  isSuperAdmin?: boolean;
}

function settledDocs(
  result: PromiseSettledResult<QueryDocumentSnapshot<DocumentData>[]>,
  warning: string,
  warnings: string[],
): QueryDocumentSnapshot<DocumentData>[] {
  if (result.status === 'fulfilled') return result.value;
  console.warn(`[lojistik-count-overview] ${warning}`, result.reason);
  warnings.push(warning);
  return [];
}

function matchesProcessedHistory(
  data: Record<string, unknown>,
  labId: string,
  parsedPeriod: { year: number; monthIndex: number },
  reportingPeriod: string,
): boolean {
  const directLabId = String(data.hospitalId || '').trim();
  const scopedLabIds = Array.isArray(data.scopedLabIds)
    ? data.scopedLabIds.map((id) => String(id || '').trim())
    : [];
  if (directLabId !== labId && !scopedLabIds.includes(labId)) return false;
  if (String(data.period || '') === reportingPeriod) return true;
  return (
    Number(data.year) === parsedPeriod.year &&
    Number(data.month) === parsedPeriod.monthIndex + 1
  );
}

async function loadProcessedHistoryDocs(
  collectionName: 'kumulatifHesaplamaGecmisi' | 'cihazUstuGecmisi',
  currentCompanyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
  reportingPeriod: string,
  parsedPeriod: { year: number; monthIndex: number },
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const results = await Promise.allSettled([
    getScopedDocs(
      collectionName,
      currentCompanyId,
      isSuperAdmin,
      where('period', '==', reportingPeriod),
    ),
    getScopedDocs(
      collectionName,
      currentCompanyId,
      isSuperAdmin,
      where('year', '==', parsedPeriod.year),
      where('month', '==', parsedPeriod.monthIndex + 1),
    ),
  ]);
  const successful = results.filter(
    (
      result,
    ): result is PromiseFulfilledResult<
      QueryDocumentSnapshot<DocumentData>[]
    > => result.status === 'fulfilled',
  );
  if (successful.length === 0) {
    throw results[0].status === 'rejected'
      ? results[0].reason
      : new Error('Rapor geçmişi okunamadı.');
  }

  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.warn(
        `[lojistik-count-overview] ${collectionName} eski dönem sorgusu okunamadı.`,
        result.reason,
      );
    }
  });
  const docsById = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  successful.forEach((result) => {
    result.value.forEach((document) => docsById.set(document.id, document));
  });
  return Array.from(docsById.values());
}

interface ShippedStockMaps {
  /** hedefKurumId -> (stokKodu -> sevk edilmiş adet) */
  byLabId: Map<string, Map<string, number>>;
  /** hedefKurum (ad, legacy) -> (stokKodu -> adet); yalnızca hedefKurumId olmayan kayıtlar */
  byLabName: Map<string, Map<string, number>>;
  warning?: string;
}

/**
 * PERF: Önceden her lab için 4 ayrı `depoStok` sorgusu (company+legacy × id+ad)
 * TÜM sevk edilmiş birim doc'larını web SDK/IndexedDB üzerinden indiriyordu — büyük
 * envanterde on binlerce doc → dakikalarca bekleme. Bunun yerine lean Admin SDK
 * aksiyonuyla (yalnızca gerekli alanlar) şirketin sevk stoğu TEK sefer çekilir ve
 * lab bazında haritalar istemci tarafında kurulur. Sayım/scope semantiği aynıdır.
 */
async function loadShippedStockByLab(
  currentCompanyId: string | null | undefined,
  isSuperAdmin: boolean | undefined,
): Promise<ShippedStockMaps> {
  const byLabId = new Map<string, Map<string, number>>();
  const byLabName = new Map<string, Map<string, number>>();
  try {
    const { getDepoStokForOrders } = await import('@/actions/stokActions');
    const items = await getDepoStokForOrders(currentCompanyId, isSuperAdmin);
    for (const item of items) {
      if (item.isShipped !== true) continue;
      const code = String(item.stokKodu || '').trim();
      if (!code) continue;
      const hedefKurumId = String(item.hedefKurumId || '').trim();
      if (hedefKurumId) {
        const map = byLabId.get(hedefKurumId) ?? new Map<string, number>();
        map.set(code, (map.get(code) || 0) + 1);
        byLabId.set(hedefKurumId, map);
      } else {
        const name = String(item.hedefKurum || '').trim();
        if (!name) continue;
        const map = byLabName.get(name) ?? new Map<string, number>();
        map.set(code, (map.get(code) || 0) + 1);
        byLabName.set(name, map);
      }
    }
    return { byLabId, byLabName };
  } catch (error) {
    console.warn(
      '[lojistik-count-overview] Sevk edilen stok özeti okunamadı.',
      error,
    );
    return {
      byLabId,
      byLabName,
      warning: 'Sevk edilen stok özeti alınamadı.',
    };
  }
}

async function loadLogisticsCountOverview({
  period,
  assignedLabIds,
  assignedLabGroups,
  currentCompanyId,
  isSuperAdmin,
}: LoadOverviewOptions): Promise<LogisticsCountOverviewData> {
  const parsedPeriod = parseCalculationPeriod(period);
  if (!parsedPeriod) throw new Error('Geçersiz sayım dönemi.');

  const uniqueAssignedLabIds = Array.from(
    new Set(assignedLabIds.map((id) => String(id || '').trim()).filter(Boolean)),
  );
  if (uniqueAssignedLabIds.length === 0) {
    return {
      period,
      periodLabel: formatCalculationPeriod(period),
      labs: [],
      assignedGroupNames: [],
      sourceWarnings: [],
      loadedAt: new Date(),
    };
  }

  const [hospitalDocs, productDocs, groupDocs, shippedStock] = await Promise.all([
    getScopedDocs('hospitals', currentCompanyId, isSuperAdmin),
    getScopedDocs('productCodes', currentCompanyId, isSuperAdmin),
    getScopedDocs('def_labGroups', currentCompanyId, isSuperAdmin),
    loadShippedStockByLab(currentCompanyId, isSuperAdmin),
  ]);

  const hospitalById = new Map<string, Hospital>();
  hospitalDocs.forEach((document) => {
    hospitalById.set(
      document.id,
      { id: document.id, ...document.data() } as Hospital,
    );
  });
  const authorizedLabs = uniqueAssignedLabIds
    .map((id) => hospitalById.get(id))
    .filter((lab): lab is Hospital => Boolean(lab))
    .sort((left, right) =>
      String(left.name || left.ad || '').localeCompare(
        String(right.name || right.ad || ''),
        'tr',
      ),
    );

  const products: ProductCode[] = productDocs.map(
    (document) =>
      ({ id: document.id, ...document.data() }) as ProductCode,
  );
  const groupDefinitions: LabGroupDefinition[] = groupDocs.map((document) => ({
    id: document.id,
    name: String(document.data()?.name || document.id),
  }));
  const groupNameById = buildGroupNameById(groupDefinitions);
  const assignedGroupKeys = resolveAssignedGroupKeys(
    assignedLabGroups,
    groupNameById,
  );
  const assignedGroupNames = Array.from(
    new Set(
      assignedLabGroups
        .map((entry) => {
          const raw = String(entry || '').trim();
          return groupNameById.get(raw) || raw;
        })
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, 'tr'));

  const reportingPeriod = toReportingPeriod(period);
  const optionalResults = await Promise.allSettled([
    getScopedDocs(
      'qoreCalculationPendingFiles',
      currentCompanyId,
      isSuperAdmin,
      where('period', '==', period),
    ),
    loadProcessedHistoryDocs(
      'kumulatifHesaplamaGecmisi',
      currentCompanyId,
      isSuperAdmin,
      reportingPeriod,
      parsedPeriod,
    ),
    loadProcessedHistoryDocs(
      'cihazUstuGecmisi',
      currentCompanyId,
      isSuperAdmin,
      reportingPeriod,
      parsedPeriod,
    ),
  ]);
  const sourceWarnings: string[] = [];
  if (shippedStock.warning) sourceWarnings.push(shippedStock.warning);
  const pendingFileDocs = settledDocs(
    optionalResults[0],
    'Bekleyen rapor dosyaları okunamadı.',
    sourceWarnings,
  );
  const kumulatifHistoryDocs = settledDocs(
    optionalResults[1],
    'Kümülatif rapor geçmişi okunamadı.',
    sourceWarnings,
  );
  const cihazUstuHistoryDocs = settledDocs(
    optionalResults[2],
    'Cihaz üstü rapor geçmişi okunamadı.',
    sourceWarnings,
  );

  const labs = await Promise.all(
    authorizedLabs.map(async (lab) => {
      const labName = String(lab.name || lab.ad || lab.id);
      const stockCountsRef = collection(db, 'hospitals', lab.id, 'stockCounts');
      const minMaxRulesRef = collection(db, 'hospitals', lab.id, 'minMaxRules');
      const [sessionResults, minMaxSnapshot] = await Promise.all([
        Promise.allSettled([
          getDocs(query(stockCountsRef, where('period', '==', period))),
          getDocs(
            query(
              stockCountsRef,
              where('year', '==', parsedPeriod.year),
              where('month', '==', parsedPeriod.monthIndex),
            ),
          ),
        ]),
        getDocs(minMaxRulesRef),
      ]);
      const successfulSessionResults = sessionResults.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof getDocs>>
        > => result.status === 'fulfilled',
      );
      if (successfulSessionResults.length === 0) {
        throw sessionResults[0].status === 'rejected'
          ? sessionResults[0].reason
          : new Error('Sayım kayıtları okunamadı.');
      }
      sessionResults.forEach((result) => {
        if (result.status === 'rejected') {
          console.warn(
            `[lojistik-count-overview] ${lab.id} eski sayım sorgusu okunamadı.`,
            result.reason,
          );
        }
      });
      const sessionDocsById = new Map<
        string,
        QueryDocumentSnapshot<DocumentData>
      >();
      successfulSessionResults.forEach((result) => {
        result.value.docs.forEach((document) =>
          sessionDocsById.set(document.id, document),
        );
      });

      const labScopeCodes = new Set<string>();
      const currentStockQuantityByCode = new Map<string, number>();
      minMaxSnapshot.docs.forEach((document) => {
        const code = String(document.data()?.stokKodu || '').trim();
        if (code) labScopeCodes.add(code);
      });
      // Sevk edilmiş stok: id ile eşleşen + (id'siz) ad ile eşleşen legacy kayıtlar.
      // Eski davranışla birebir aynı — sadece kaynak tek lean sorgudan geliyor.
      [
        shippedStock.byLabId.get(lab.id),
        shippedStock.byLabName.get(labName),
      ].forEach((codeCounts) => {
        if (!codeCounts) return;
        codeCounts.forEach((count, code) => {
          labScopeCodes.add(code);
          currentStockQuantityByCode.set(
            code,
            (currentStockQuantityByCode.get(code) || 0) + count,
          );
        });
      });

      const sessions: LogisticsCountSessionInput[] =
        Array.from(sessionDocsById.values()).map((document) => ({
          id: document.id,
          ...(document.data() as Omit<LogisticsCountSessionInput, 'id'>),
        }));

      const hasPendingUpload = (kind: 'kumulatif' | 'cihazUstu') =>
        pendingFileDocs.some((document) => {
          const data = document.data();
          return (
            String(data.hospitalId || '').trim() === lab.id &&
            data.kind === kind
          );
        });
      const hasKumulatifHistory = kumulatifHistoryDocs.some((document) =>
        matchesProcessedHistory(
          document.data(),
          lab.id,
          parsedPeriod,
          reportingPeriod,
        ),
      );
      const hasCihazUstuHistory = cihazUstuHistoryDocs.some((document) =>
        matchesProcessedHistory(
          document.data(),
          lab.id,
          parsedPeriod,
          reportingPeriod,
        ),
      );

      return buildLabCountOverview({
        labId: lab.id,
        labName,
        period,
        products,
        labScopeCodes,
        currentStockQuantityByCode,
        assignedGroupKeys,
        groupNameById,
        sessions,
        hasExternalKumulatifUpload:
          hasPendingUpload('kumulatif') || hasKumulatifHistory,
        hasExternalCihazUstuUpload:
          hasPendingUpload('cihazUstu') || hasCihazUstuHistory,
      });
    }),
  );

  return {
    period,
    periodLabel: formatCalculationPeriod(period),
    labs,
    assignedGroupNames,
    sourceWarnings,
    loadedAt: new Date(),
  };
}

export function useLojistikCountOverview(period: string) {
  const {
    currentUserProfile,
    currentCompanyId,
    isSuperAdmin,
  } = useAuth();
  const assignedLabIds = useMemo(
    () =>
      [...(currentUserProfile?.assignedLaboratories || [])]
        .map((id) => String(id || '').trim())
        .filter(Boolean)
        .sort(),
    [currentUserProfile?.assignedLaboratories],
  );
  const assignedLabGroups = useMemo(
    () =>
      [...(currentUserProfile?.assignedLabGroups || [])]
        .map((group) => String(group || '').trim())
        .filter(Boolean)
        .sort(),
    [currentUserProfile?.assignedLabGroups],
  );

  return useQuery({
    queryKey: [
      'lojistik-count-overview',
      currentCompanyId,
      Boolean(isSuperAdmin),
      currentUserProfile?.uid,
      period,
      assignedLabIds,
      assignedLabGroups,
    ],
    queryFn: () =>
      loadLogisticsCountOverview({
        period,
        assignedLabIds,
        assignedLabGroups,
        currentCompanyId,
        isSuperAdmin,
      }),
    enabled:
      currentUserProfile?.role === 'lojistik_sorumlusu' &&
      Boolean(parseCalculationPeriod(period)),
    // PERF: 20 sn çok agresifti; her odaklanmada ağır sorgu yeniden koşuyordu.
    // Lean sorguyla birlikte 2 dk tazelik dönemsel sayım paneli için yeterli.
    staleTime: 120_000,
    refetchOnWindowFocus: true,
  });
}
