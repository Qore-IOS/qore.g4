/**
 * IS-ANALIZI SUMMARY UTILITIES
 *
 * Bu modül, summary verilerinin oluşturulması, güncellenmesi ve sorgulanması için
 * gerekli fonksiyonları içerir.
 */

import { collection, doc, getDoc, getDocs, setDoc, query, where, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { StageStats, AggregatedRecord } from '@/store/lbys-data-store';
import {
  type DailySummary,
  type MonthlySummary,
  type YearlySummary,
  type FilterOptions,
  type StageSummaryStats,
  type SummaryStats,
  type DashboardData,
  type DashboardKPIs,
  type ChartDataItem,
  type SummaryQueryParams,
  emptySummaryStats,
  emptyStageSummaryStats,
  mergeSummaryStats,
  mergeStageSummaryStats,
  stageStatsToSummaryStats,
  calculateKPIsFromStats,
  getMonthId,
  getYearId,
  getDateRange,
  getMonthRange
} from './analysis-summary-types';

// ============================================================================
// COLLECTION NAMES
// ============================================================================

export const COLLECTIONS = {
  DAILY_SUMMARY: 'analysis_daily_summary',
  MONTHLY_SUMMARY: 'analysis_monthly_summary',
  YEARLY_SUMMARY: 'analysis_yearly_summary',
  FILTER_OPTIONS: 'analysis_filter_options',
  RAW_RESULTS: 'analysis_results', // Mevcut koleksiyon - geriye dönük uyumluluk
  HOSPITAL_CONFIG: 'config_hospitals'
} as const;

// ============================================================================
// DAILY SUMMARY OPERATIONS
// ============================================================================

/**
 * Boş günlük summary oluşturur
 */
export function createEmptyDailySummary(date: string): DailySummary {
  return {
    id: date,
    date,
    totals: emptyStageSummaryStats(),
    byHospital: {},
    byAsm: {},
    byService: {},
    byTest: {},
    byBranch: {},
    hospitalServiceBreakdown: {},
    uploadBatchIds: [],
    lastUpdated: new Date().toISOString(),
    version: 1
  };
}

/**
 * AggregatedRecord'ları günlük summary'ye dönüştürür
 */
export function aggregateRecordsToDailySummary(
  records: AggregatedRecord[],
  existingSummary?: DailySummary
): DailySummary {
  // Tarihe göre grupla
  const recordsByDate = new Map<string, AggregatedRecord[]>();
  for (const record of records) {
    const existing = recordsByDate.get(record.date) || [];
    existing.push(record);
    recordsByDate.set(record.date, existing);
  }

  // Her gün için summary oluştur (şimdilik tek gün varsayıyoruz)
  const dates = Array.from(recordsByDate.keys());
  if (dates.length === 0) {
    return existingSummary || createEmptyDailySummary(new Date().toISOString().split('T')[0]);
  }

  const date = dates[0]; // İlk tarih
  const dayRecords = recordsByDate.get(date) || [];
  const summary = existingSummary || createEmptyDailySummary(date);

  // Unique patient tracking için Set'ler
  const patientSets = {
    totals: {
      labAccepted: new Set<string>(),
      worked: new Set<string>(),
      approved: new Set<string>()
    },
    byHospital: new Map<string, { labAccepted: Set<string>; worked: Set<string>; approved: Set<string> }>(),
    byAsm: new Map<string, { labAccepted: Set<string>; worked: Set<string>; approved: Set<string> }>(),
    byService: new Map<string, { labAccepted: Set<string>; worked: Set<string>; approved: Set<string> }>(),
    byTest: new Map<string, { labAccepted: Set<string>; worked: Set<string>; approved: Set<string> }>(),
    byBranch: new Map<string, { labAccepted: Set<string>; worked: Set<string>; approved: Set<string> }>()
  };

  const getOrCreatePatientSet = (
    map: Map<string, { labAccepted: Set<string>; worked: Set<string>; approved: Set<string> }>,
    key: string
  ) => {
    if (!map.has(key)) {
      map.set(key, {
        labAccepted: new Set<string>(),
        worked: new Set<string>(),
        approved: new Set<string>()
      });
    }
    return map.get(key)!;
  };

  // Her record'u işle
  for (const record of dayRecords) {
    const { hospitalName, isAsm, service, testName, branch } = record;
    const locationKey = hospitalName;

    // Stage'leri işle
    for (const stage of ['labAccepted', 'worked', 'approved'] as const) {
      const stageData = record[stage];
      if (!stageData || stageData.totalTests === 0) continue;

      const summaryStats = stageStatsToSummaryStats(stageData);

      // Total'e ekle
      summary.totals[stage] = mergeSummaryStats(summary.totals[stage], summaryStats);
      stageData.patientIds.forEach((id) => patientSets.totals[stage].add(id));

      // Hospital/ASM bazlı
      if (isAsm) {
        if (!summary.byAsm[locationKey]) {
          summary.byAsm[locationKey] = emptyStageSummaryStats();
        }
        summary.byAsm[locationKey][stage] = mergeSummaryStats(summary.byAsm[locationKey][stage], summaryStats);
        const asmSet = getOrCreatePatientSet(patientSets.byAsm, locationKey);
        stageData.patientIds.forEach((id) => asmSet[stage].add(id));
      } else {
        if (!summary.byHospital[locationKey]) {
          summary.byHospital[locationKey] = emptyStageSummaryStats();
        }
        summary.byHospital[locationKey][stage] = mergeSummaryStats(
          summary.byHospital[locationKey][stage],
          summaryStats
        );
        const hospSet = getOrCreatePatientSet(patientSets.byHospital, locationKey);
        stageData.patientIds.forEach((id) => hospSet[stage].add(id));
      }

      // Service bazlı
      if (!summary.byService[service]) {
        summary.byService[service] = emptyStageSummaryStats();
      }
      summary.byService[service][stage] = mergeSummaryStats(summary.byService[service][stage], summaryStats);
      const svcSet = getOrCreatePatientSet(patientSets.byService, service);
      stageData.patientIds.forEach((id) => svcSet[stage].add(id));

      // Test bazlı
      if (!summary.byTest[testName]) {
        summary.byTest[testName] = emptyStageSummaryStats();
      }
      summary.byTest[testName][stage] = mergeSummaryStats(summary.byTest[testName][stage], summaryStats);
      const testSet = getOrCreatePatientSet(patientSets.byTest, testName);
      stageData.patientIds.forEach((id) => testSet[stage].add(id));

      // Branch bazlı
      if (!summary.byBranch[branch]) {
        summary.byBranch[branch] = emptyStageSummaryStats();
      }
      summary.byBranch[branch][stage] = mergeSummaryStats(summary.byBranch[branch][stage], summaryStats);
      const branchSet = getOrCreatePatientSet(patientSets.byBranch, branch);
      stageData.patientIds.forEach((id) => branchSet[stage].add(id));

      // Hospital-Service breakdown (sadece hastaneler için)
      if (!isAsm) {
        if (!summary.hospitalServiceBreakdown[locationKey]) {
          summary.hospitalServiceBreakdown[locationKey] = {};
        }
        if (!summary.hospitalServiceBreakdown[locationKey][service]) {
          summary.hospitalServiceBreakdown[locationKey][service] = emptyStageSummaryStats();
        }
        summary.hospitalServiceBreakdown[locationKey][service][stage] = mergeSummaryStats(
          summary.hospitalServiceBreakdown[locationKey][service][stage],
          summaryStats
        );
      }
    }
  }

  // Patient count'ları güncelle (Set size'ları)
  for (const stage of ['labAccepted', 'worked', 'approved'] as const) {
    summary.totals[stage].uniquePatientCount = patientSets.totals[stage].size;
  }

  patientSets.byHospital.forEach((sets, key) => {
    if (summary.byHospital[key]) {
      for (const stage of ['labAccepted', 'worked', 'approved'] as const) {
        summary.byHospital[key][stage].uniquePatientCount = sets[stage].size;
      }
    }
  });

  patientSets.byAsm.forEach((sets, key) => {
    if (summary.byAsm[key]) {
      for (const stage of ['labAccepted', 'worked', 'approved'] as const) {
        summary.byAsm[key][stage].uniquePatientCount = sets[stage].size;
      }
    }
  });

  patientSets.byService.forEach((sets, key) => {
    if (summary.byService[key]) {
      for (const stage of ['labAccepted', 'worked', 'approved'] as const) {
        summary.byService[key][stage].uniquePatientCount = sets[stage].size;
      }
    }
  });

  patientSets.byTest.forEach((sets, key) => {
    if (summary.byTest[key]) {
      for (const stage of ['labAccepted', 'worked', 'approved'] as const) {
        summary.byTest[key][stage].uniquePatientCount = sets[stage].size;
      }
    }
  });

  patientSets.byBranch.forEach((sets, key) => {
    if (summary.byBranch[key]) {
      for (const stage of ['labAccepted', 'worked', 'approved'] as const) {
        summary.byBranch[key][stage].uniquePatientCount = sets[stage].size;
      }
    }
  });

  summary.lastUpdated = new Date().toISOString();
  summary.version = (existingSummary?.version || 0) + 1;

  return summary;
}

/**
 * Günlük summary'yi Firestore'a yazar
 */
export async function saveDailySummary(summary: DailySummary): Promise<void> {
  const docRef = doc(db, COLLECTIONS.DAILY_SUMMARY, summary.id);
  await setDoc(docRef, summary, { merge: true });
}

/**
 * Günlük summary'yi Firestore'dan okur
 */
export async function loadDailySummary(date: string): Promise<DailySummary | null> {
  const docRef = doc(db, COLLECTIONS.DAILY_SUMMARY, date);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return docSnap.data() as DailySummary;
}

/**
 * Tarih aralığındaki günlük summary'leri yükler
 */
export async function loadDailySummaries(startDate: string, endDate: string): Promise<DailySummary[]> {
  const q = query(
    collection(db, COLLECTIONS.DAILY_SUMMARY),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );

  const snapshot = await getDocs(q);
  const summaries: DailySummary[] = [];

  snapshot.forEach((doc) => {
    summaries.push(doc.data() as DailySummary);
  });

  return summaries.sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================================
// MONTHLY SUMMARY OPERATIONS
// ============================================================================

/**
 * Boş aylık summary oluşturur
 */
export function createEmptyMonthlySummary(monthId: string): MonthlySummary {
  const [yearStr, monthStr] = monthId.split('-');
  return {
    id: monthId,
    year: parseInt(yearStr),
    month: parseInt(monthStr),
    totals: emptyStageSummaryStats(),
    byHospital: {},
    byAsm: {},
    byService: {},
    byTest: {},
    byBranch: {},
    dailyTotals: {},
    hospitalServiceBreakdown: {},
    lastUpdated: new Date().toISOString(),
    version: 1
  };
}

/**
 * Günlük summary'lerden aylık summary oluşturur
 */
export function aggregateDailyToMonthlySummary(
  dailySummaries: DailySummary[],
  existingMonthly?: MonthlySummary
): MonthlySummary {
  if (dailySummaries.length === 0 && existingMonthly) {
    return existingMonthly;
  }

  const monthId = dailySummaries[0]
    ? getMonthId(dailySummaries[0].date)
    : existingMonthly?.id || getMonthId(new Date().toISOString().split('T')[0]);

  const summary = existingMonthly || createEmptyMonthlySummary(monthId);

  // Her günlük summary'yi aylık'a ekle
  for (const daily of dailySummaries) {
    const dayKey = daily.date.substring(8, 10); // "DD" kısmı

    // Toplam istatistikleri birleştir
    summary.totals = mergeStageSummaryStats(summary.totals, daily.totals);

    // Günlük trend
    summary.dailyTotals[dayKey] = daily.totals;

    // Boyut bazlı kırılımları birleştir
    for (const [hospital, stats] of Object.entries(daily.byHospital)) {
      if (!summary.byHospital[hospital]) {
        summary.byHospital[hospital] = emptyStageSummaryStats();
      }
      summary.byHospital[hospital] = mergeStageSummaryStats(summary.byHospital[hospital], stats);
    }

    for (const [asm, stats] of Object.entries(daily.byAsm)) {
      if (!summary.byAsm[asm]) {
        summary.byAsm[asm] = emptyStageSummaryStats();
      }
      summary.byAsm[asm] = mergeStageSummaryStats(summary.byAsm[asm], stats);
    }

    for (const [service, stats] of Object.entries(daily.byService)) {
      if (!summary.byService[service]) {
        summary.byService[service] = emptyStageSummaryStats();
      }
      summary.byService[service] = mergeStageSummaryStats(summary.byService[service], stats);
    }

    for (const [test, stats] of Object.entries(daily.byTest)) {
      if (!summary.byTest[test]) {
        summary.byTest[test] = emptyStageSummaryStats();
      }
      summary.byTest[test] = mergeStageSummaryStats(summary.byTest[test], stats);
    }

    for (const [branch, stats] of Object.entries(daily.byBranch)) {
      if (!summary.byBranch[branch]) {
        summary.byBranch[branch] = emptyStageSummaryStats();
      }
      summary.byBranch[branch] = mergeStageSummaryStats(summary.byBranch[branch], stats);
    }

    // Hospital-Service breakdown
    for (const [hospital, services] of Object.entries(daily.hospitalServiceBreakdown)) {
      if (!summary.hospitalServiceBreakdown[hospital]) {
        summary.hospitalServiceBreakdown[hospital] = {};
      }
      for (const [service, stats] of Object.entries(services)) {
        if (!summary.hospitalServiceBreakdown[hospital][service]) {
          summary.hospitalServiceBreakdown[hospital][service] = emptyStageSummaryStats();
        }
        summary.hospitalServiceBreakdown[hospital][service] = mergeStageSummaryStats(
          summary.hospitalServiceBreakdown[hospital][service],
          stats
        );
      }
    }
  }

  summary.lastUpdated = new Date().toISOString();
  summary.version = (existingMonthly?.version || 0) + 1;

  return summary;
}

/**
 * Aylık summary'yi Firestore'a yazar
 */
export async function saveMonthlySummary(summary: MonthlySummary): Promise<void> {
  const docRef = doc(db, COLLECTIONS.MONTHLY_SUMMARY, summary.id);
  await setDoc(docRef, summary, { merge: true });
}

/**
 * Aylık summary'yi Firestore'dan okur
 */
export async function loadMonthlySummary(monthId: string): Promise<MonthlySummary | null> {
  const docRef = doc(db, COLLECTIONS.MONTHLY_SUMMARY, monthId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return docSnap.data() as MonthlySummary;
}

/**
 * Tarih aralığındaki aylık summary'leri yükler
 */
export async function loadMonthlySummaries(startMonth: string, endMonth: string): Promise<MonthlySummary[]> {
  const q = query(
    collection(db, COLLECTIONS.MONTHLY_SUMMARY),
    where('id', '>=', startMonth),
    where('id', '<=', endMonth)
  );

  const snapshot = await getDocs(q);
  const summaries: MonthlySummary[] = [];

  snapshot.forEach((doc) => {
    summaries.push(doc.data() as MonthlySummary);
  });

  return summaries.sort((a, b) => a.id.localeCompare(b.id));
}

// ============================================================================
// FILTER OPTIONS OPERATIONS
// ============================================================================

/**
 * Boş filter options oluşturur
 */
export function createEmptyFilterOptions(): FilterOptions {
  return {
    id: 'master',
    hospitals: [],
    asms: [],
    services: [],
    tests: [],
    branches: [],
    hospitalCodeMap: {},
    earliestDate: '',
    latestDate: '',
    lastUpdated: new Date().toISOString(),
    totalRecordCount: 0
  };
}

/**
 * Summary'lerden filter options günceller
 */
export function updateFilterOptionsFromSummary(
  summary: DailySummary,
  existingOptions: FilterOptions
): FilterOptions {
  const options = { ...existingOptions };

  // Benzersiz değerleri Set ile topla
  const hospitals = new Set(options.hospitals);
  const asms = new Set(options.asms);
  const services = new Set(options.services);
  const tests = new Set(options.tests);
  const branches = new Set(options.branches);

  // Summary'den değerleri ekle
  Object.keys(summary.byHospital).forEach((h) => hospitals.add(h));
  Object.keys(summary.byAsm).forEach((a) => asms.add(a));
  Object.keys(summary.byService).forEach((s) => services.add(s));
  Object.keys(summary.byTest).forEach((t) => tests.add(t));
  Object.keys(summary.byBranch).forEach((b) => branches.add(b));

  // Sorted array'lere dönüştür
  options.hospitals = Array.from(hospitals).sort();
  options.asms = Array.from(asms).sort();
  options.services = Array.from(services).sort();
  options.tests = Array.from(tests).sort();
  options.branches = Array.from(branches).sort();

  // Tarih aralığını güncelle
  if (!options.earliestDate || summary.date < options.earliestDate) {
    options.earliestDate = summary.date;
  }
  if (!options.latestDate || summary.date > options.latestDate) {
    options.latestDate = summary.date;
  }

  options.lastUpdated = new Date().toISOString();
  options.totalRecordCount++;

  return options;
}

/**
 * Filter options'ı Firestore'a yazar
 */
export async function saveFilterOptions(options: FilterOptions): Promise<void> {
  const docRef = doc(db, COLLECTIONS.FILTER_OPTIONS, 'master');
  await setDoc(docRef, options, { merge: true });
}

/**
 * Filter options'ı Firestore'dan okur
 */
export async function loadFilterOptions(): Promise<FilterOptions> {
  const docRef = doc(db, COLLECTIONS.FILTER_OPTIONS, 'master');
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return createEmptyFilterOptions();
  }

  return docSnap.data() as FilterOptions;
}

// ============================================================================
// DASHBOARD DATA GENERATION
// ============================================================================

type ViewMode = 'labAccepted' | 'worked' | 'approved';

/**
 * Summary'lerden dashboard verisi oluşturur
 */
export function generateDashboardDataFromSummaries(
  summaries: DailySummary[],
  viewMode: ViewMode = 'approved',
  filters?: SummaryQueryParams
): DashboardData {
  // Tüm summary'leri birleştir
  let combinedTotals = emptyStageSummaryStats();
  const combinedByHospital: Record<string, StageSummaryStats> = {};
  const combinedByAsm: Record<string, StageSummaryStats> = {};
  const combinedByService: Record<string, StageSummaryStats> = {};
  const combinedByTest: Record<string, StageSummaryStats> = {};

  for (const summary of summaries) {
    // Filtreleme uygula
    let filteredTotals = emptyStageSummaryStats();

    // Hospital filtresi
    const hospitalFilter = filters?.hospitals && filters.hospitals.length > 0;
    const asmFilter = filters?.asms && filters.asms.length > 0;
    const serviceFilter = filters?.services && filters.services.length > 0;
    const testFilter = filters?.tests && filters.tests.length > 0;
    const branchFilter = filters?.branches && filters.branches.length > 0;

    // Eğer filtre yoksa, direkt totals kullan
    if (!hospitalFilter && !asmFilter && !serviceFilter && !testFilter && !branchFilter) {
      filteredTotals = summary.totals;

      // Hospital ve ASM dağılımlarını ekle
      for (const [hospital, stats] of Object.entries(summary.byHospital)) {
        if (!combinedByHospital[hospital]) {
          combinedByHospital[hospital] = emptyStageSummaryStats();
        }
        combinedByHospital[hospital] = mergeStageSummaryStats(combinedByHospital[hospital], stats);
      }

      for (const [asm, stats] of Object.entries(summary.byAsm)) {
        if (!combinedByAsm[asm]) {
          combinedByAsm[asm] = emptyStageSummaryStats();
        }
        combinedByAsm[asm] = mergeStageSummaryStats(combinedByAsm[asm], stats);
      }

      for (const [service, stats] of Object.entries(summary.byService)) {
        if (!combinedByService[service]) {
          combinedByService[service] = emptyStageSummaryStats();
        }
        combinedByService[service] = mergeStageSummaryStats(combinedByService[service], stats);
      }

      for (const [test, stats] of Object.entries(summary.byTest)) {
        if (!combinedByTest[test]) {
          combinedByTest[test] = emptyStageSummaryStats();
        }
        combinedByTest[test] = mergeStageSummaryStats(combinedByTest[test], stats);
      }
    } else {
      // Filtreli hesaplama - sadece seçili değerleri topla
      if (hospitalFilter || asmFilter) {
        // Location bazlı filtreleme
        if (hospitalFilter) {
          for (const hospital of filters!.hospitals!) {
            if (summary.byHospital[hospital]) {
              filteredTotals = mergeStageSummaryStats(filteredTotals, summary.byHospital[hospital]);
              if (!combinedByHospital[hospital]) {
                combinedByHospital[hospital] = emptyStageSummaryStats();
              }
              combinedByHospital[hospital] = mergeStageSummaryStats(
                combinedByHospital[hospital],
                summary.byHospital[hospital]
              );
            }
          }
        }

        if (asmFilter) {
          for (const asm of filters!.asms!) {
            if (summary.byAsm[asm]) {
              filteredTotals = mergeStageSummaryStats(filteredTotals, summary.byAsm[asm]);
              if (!combinedByAsm[asm]) {
                combinedByAsm[asm] = emptyStageSummaryStats();
              }
              combinedByAsm[asm] = mergeStageSummaryStats(combinedByAsm[asm], summary.byAsm[asm]);
            }
          }
        }
      }

      // Service bazlı - location filtresi yoksa
      if (serviceFilter && !hospitalFilter && !asmFilter) {
        for (const service of filters!.services!) {
          if (summary.byService[service]) {
            filteredTotals = mergeStageSummaryStats(filteredTotals, summary.byService[service]);
            if (!combinedByService[service]) {
              combinedByService[service] = emptyStageSummaryStats();
            }
            combinedByService[service] = mergeStageSummaryStats(
              combinedByService[service],
              summary.byService[service]
            );
          }
        }
      } else if (!hospitalFilter && !asmFilter && !serviceFilter) {
        // Servis dağılımı için tüm servisleri ekle
        for (const [service, stats] of Object.entries(summary.byService)) {
          if (!combinedByService[service]) {
            combinedByService[service] = emptyStageSummaryStats();
          }
          combinedByService[service] = mergeStageSummaryStats(combinedByService[service], stats);
        }
      }

      // Test bazlı - diğer filtreler yoksa
      if (testFilter && !hospitalFilter && !asmFilter && !serviceFilter) {
        for (const test of filters!.tests!) {
          if (summary.byTest[test]) {
            filteredTotals = mergeStageSummaryStats(filteredTotals, summary.byTest[test]);
            if (!combinedByTest[test]) {
              combinedByTest[test] = emptyStageSummaryStats();
            }
            combinedByTest[test] = mergeStageSummaryStats(combinedByTest[test], summary.byTest[test]);
          }
        }
      } else if (!hospitalFilter && !asmFilter && !serviceFilter && !testFilter) {
        // Test dağılımı için tüm testleri ekle
        for (const [test, stats] of Object.entries(summary.byTest)) {
          if (!combinedByTest[test]) {
            combinedByTest[test] = emptyStageSummaryStats();
          }
          combinedByTest[test] = mergeStageSummaryStats(combinedByTest[test], stats);
        }
      }
    }

    combinedTotals = mergeStageSummaryStats(combinedTotals, filteredTotals);
  }

  // View mode'a göre istatistikleri al
  const viewStats = combinedTotals[viewMode];

  // KPI'ları hesapla
  const kpis: DashboardKPIs = {
    totalTests: viewStats.totalTests,
    uniquePatients: viewStats.uniquePatientCount,
    rejectionRate: viewStats.totalTests > 0 ? (viewStats.rejectedCount / viewStats.totalTests) * 100 : 0,
    avgTatMinutes: viewStats.tatCount > 0 ? viewStats.totalTatMinutes / viewStats.tatCount : 0,
    repeatRate: viewStats.totalTests > 0 ? (viewStats.repeatCount / viewStats.totalTests) * 100 : 0,
    emergencyRate: viewStats.totalTests > 0 ? (viewStats.emergencyCount / viewStats.totalTests) * 100 : 0
  };

  // Hospital distribution (top 10)
  const hospitalDistribution: ChartDataItem[] = Object.entries(combinedByHospital)
    .map(([name, stats]) => ({
      name,
      value: stats[viewMode].totalTests,
      emergencyCount: stats[viewMode].emergencyCount,
      normalCount: stats[viewMode].totalTests - stats[viewMode].emergencyCount
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Service distribution (top 10)
  const serviceDistribution: ChartDataItem[] = Object.entries(combinedByService)
    .map(([name, stats]) => ({
      name,
      value: stats[viewMode].totalTests
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Top tests (top 10)
  const topTests: ChartDataItem[] = Object.entries(combinedByTest)
    .map(([name, stats]) => ({
      name,
      value: stats[viewMode].totalTests
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // ASM distribution (top 10)
  const asmDistribution: ChartDataItem[] = Object.entries(combinedByAsm)
    .map(([name, stats]) => ({
      name,
      value: stats[viewMode].totalTests
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Rejection reasons
  const rejectionReasons: ChartDataItem[] = Object.entries(viewStats.rejectionReasons)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Daily trend
  const dailyTrend: ChartDataItem[] = summaries
    .map((s) => ({
      name: s.date,
      value: s.totals[viewMode].totalTests
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    kpis,
    hospitalDistribution,
    serviceDistribution,
    topTests,
    asmDistribution,
    rejectionReasons,
    dailyTrend
  };
}

// ============================================================================
// BATCH SUMMARY GENERATION (Excel Upload için)
// ============================================================================

/**
 * AggregatedRecord'ları tarihe göre gruplar ve her gün için summary oluşturur
 */
export function generateSummariesFromRecords(records: AggregatedRecord[]): Map<string, DailySummary> {
  // Tarihe göre grupla
  const recordsByDate = new Map<string, AggregatedRecord[]>();

  for (const record of records) {
    const existing = recordsByDate.get(record.date) || [];
    existing.push(record);
    recordsByDate.set(record.date, existing);
  }

  // Her gün için summary oluştur
  const summaries = new Map<string, DailySummary>();

  for (const [date, dayRecords] of recordsByDate) {
    const summary = aggregateRecordsToDailySummary(dayRecords);
    summaries.set(date, summary);
  }

  return summaries;
}

/**
 * Günlük summary'leri aylık summary'lere dönüştürür
 */
export function generateMonthlySummariesFromDaily(
  dailySummaries: Map<string, DailySummary>
): Map<string, MonthlySummary> {
  // Aya göre grupla
  const byMonth = new Map<string, DailySummary[]>();

  for (const [date, summary] of dailySummaries) {
    const monthId = getMonthId(date);
    const existing = byMonth.get(monthId) || [];
    existing.push(summary);
    byMonth.set(monthId, existing);
  }

  // Her ay için summary oluştur
  const monthlySummaries = new Map<string, MonthlySummary>();

  for (const [monthId, dailies] of byMonth) {
    const monthly = aggregateDailyToMonthlySummary(dailies);
    monthlySummaries.set(monthId, monthly);
  }

  return monthlySummaries;
}

/**
 * Tüm summary'leri tek batch'te Firestore'a yazar
 */
export async function saveSummariesBatch(
  dailySummaries: Map<string, DailySummary>,
  monthlySummaries: Map<string, MonthlySummary>,
  filterOptions: FilterOptions,
  onProgress?: (current: number, total: number, status: string) => void
): Promise<void> {
  const totalDocs = dailySummaries.size + monthlySummaries.size + 1; // +1 for filter options
  let processed = 0;

  const BATCH_SIZE = 450;
  let currentBatch = writeBatch(db);
  let batchCount = 0;

  // Günlük summary'leri yaz
  for (const [date, summary] of dailySummaries) {
    const docRef = doc(db, COLLECTIONS.DAILY_SUMMARY, date);
    currentBatch.set(docRef, summary, { merge: true });
    batchCount++;
    processed++;

    if (batchCount >= BATCH_SIZE) {
      await currentBatch.commit();
      currentBatch = writeBatch(db);
      batchCount = 0;
      onProgress?.(processed, totalDocs, 'Günlük summary yazılıyor...');
    }
  }

  // Aylık summary'leri yaz
  for (const [monthId, summary] of monthlySummaries) {
    const docRef = doc(db, COLLECTIONS.MONTHLY_SUMMARY, monthId);
    currentBatch.set(docRef, summary, { merge: true });
    batchCount++;
    processed++;

    if (batchCount >= BATCH_SIZE) {
      await currentBatch.commit();
      currentBatch = writeBatch(db);
      batchCount = 0;
      onProgress?.(processed, totalDocs, 'Aylık summary yazılıyor...');
    }
  }

  // Filter options yaz
  const filterDocRef = doc(db, COLLECTIONS.FILTER_OPTIONS, 'master');
  currentBatch.set(filterDocRef, filterOptions, { merge: true });
  processed++;

  // Son batch'i commit et
  if (batchCount > 0) {
    await currentBatch.commit();
  }

  onProgress?.(processed, totalDocs, 'Tamamlandı');
}

// ============================================================================
// MIGRATION UTILITY
// ============================================================================

/**
 * Mevcut analysis_results verilerinden summary'ler oluşturur
 * Bir kerelik migration için kullanılır
 */
export async function migrateExistingDataToSummaries(
  onProgress?: (current: number, total: number, status: string) => void
): Promise<{
  dailyCount: number;
  monthlyCount: number;
  success: boolean;
  error?: string;
}> {
  try {
    onProgress?.(0, 100, 'Mevcut veriler okunuyor...');

    // Tüm analysis_results'ı oku
    const snapshot = await getDocs(collection(db, COLLECTIONS.RAW_RESULTS));
    const records: AggregatedRecord[] = [];

    snapshot.forEach((doc) => {
      records.push(doc.data() as AggregatedRecord);
    });

    if (records.length === 0) {
      return { dailyCount: 0, monthlyCount: 0, success: true };
    }

    onProgress?.(10, 100, `${records.length} kayıt bulundu, summary oluşturuluyor...`);

    // Günlük summary'ler oluştur
    const dailySummaries = generateSummariesFromRecords(records);
    onProgress?.(40, 100, `${dailySummaries.size} günlük summary oluşturuldu`);

    // Aylık summary'ler oluştur
    const monthlySummaries = generateMonthlySummariesFromDaily(dailySummaries);
    onProgress?.(60, 100, `${monthlySummaries.size} aylık summary oluşturuldu`);

    // Filter options oluştur
    let filterOptions = createEmptyFilterOptions();
    for (const summary of dailySummaries.values()) {
      filterOptions = updateFilterOptionsFromSummary(summary, filterOptions);
    }

    onProgress?.(70, 100, 'Summary veriler Firestore\'a yazılıyor...');

    // Firestore'a yaz
    await saveSummariesBatch(dailySummaries, monthlySummaries, filterOptions, (current, total, status) => {
      const progress = 70 + Math.round((current / total) * 30);
      onProgress?.(progress, 100, status);
    });

    return {
      dailyCount: dailySummaries.size,
      monthlyCount: monthlySummaries.size,
      success: true
    };
  } catch (error: any) {
    console.error('Migration error:', error);
    return {
      dailyCount: 0,
      monthlyCount: 0,
      success: false,
      error: error.message
    };
  }
}
