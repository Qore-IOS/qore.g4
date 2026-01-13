/**
 * IS-ANALIZI SUMMARY TYPES
 *
 * Bu modül, is-analizi paneli için optimize edilmiş summary veri yapılarını tanımlar.
 *
 * MİMARİ YAKLAŞIM:
 * - Firestore: Sadece günlük/aylık/yıllık summary veriler
 * - BigQuery: Ham detay veriler (gelecekte)
 * - Dashboard: Sadece summary koleksiyonlarından okur
 * - Filtre listeleri: analysis_filter_options koleksiyonundan gelir
 *
 * KOLEKSIYONLAR:
 * - analysis_daily_summary: Günlük agregasyon (doc id: "YYYY-MM-DD")
 * - analysis_monthly_summary: Aylık agregasyon (doc id: "YYYY-MM")
 * - analysis_yearly_summary: Yıllık agregasyon (doc id: "YYYY")
 * - analysis_filter_options: Filtre seçenekleri (doc id: "master")
 * - analysis_results: Ham agregasyon (mevcut - BigQuery'ye taşınacak)
 */

import type { StageStats } from '@/store/lbys-data-store';

// ============================================================================
// SUMMARY STAT TYPES
// ============================================================================

/**
 * Kompakt istatistik yapısı - Summary tablolarda kullanılır
 * StageStats'tan farklı olarak patientIds array tutmaz, sadece count tutar
 */
export interface SummaryStats {
  totalTests: number;
  emergencyCount: number;
  uniquePatientCount: number; // patientIds.length yerine sadece sayı
  rejectedCount: number;
  repeatCount: number;
  totalTatMinutes: number;
  tatCount: number;
  rejectionReasons: Record<string, number>;
}

/**
 * Stage bazlı summary (labAccepted, worked, approved için)
 */
export interface StageSummaryStats {
  labAccepted: SummaryStats;
  worked: SummaryStats;
  approved: SummaryStats;
}

// ============================================================================
// DAILY SUMMARY
// ============================================================================

/**
 * Günlük summary dökümanı
 * Bir günün tüm agregasyonlarını içerir
 */
export interface DailySummary {
  id: string; // "YYYY-MM-DD" formatında
  date: string; // "YYYY-MM-DD"

  // Günün toplam istatistikleri
  totals: StageSummaryStats;

  // Boyut bazlı kırılımlar (her biri stage'lere göre ayrılmış)
  byHospital: Record<string, StageSummaryStats>;
  byAsm: Record<string, StageSummaryStats>;
  byService: Record<string, StageSummaryStats>;
  byTest: Record<string, StageSummaryStats>;
  byBranch: Record<string, StageSummaryStats>;

  // Çapraz kırılımlar (detaylı analiz için)
  hospitalServiceBreakdown: Record<string, Record<string, StageSummaryStats>>; // hospital -> service -> stats

  // Meta bilgiler
  uploadBatchIds: string[]; // Bu güne veri yükleyen batch'ler
  lastUpdated: string; // ISO timestamp
  version: number; // Optimistic locking için
}

// ============================================================================
// MONTHLY SUMMARY
// ============================================================================

/**
 * Aylık summary dökümanı
 * Bir ayın tüm agregasyonlarını içerir
 */
export interface MonthlySummary {
  id: string; // "YYYY-MM" formatında
  year: number;
  month: number; // 1-12

  // Ayın toplam istatistikleri
  totals: StageSummaryStats;

  // Boyut bazlı kırılımlar
  byHospital: Record<string, StageSummaryStats>;
  byAsm: Record<string, StageSummaryStats>;
  byService: Record<string, StageSummaryStats>;
  byTest: Record<string, StageSummaryStats>;
  byBranch: Record<string, StageSummaryStats>;

  // Günlük trend verisi (sparkline grafikler için)
  dailyTotals: Record<string, StageSummaryStats>; // "DD" -> stats

  // Çapraz kırılımlar
  hospitalServiceBreakdown: Record<string, Record<string, StageSummaryStats>>;

  // Meta bilgiler
  lastUpdated: string;
  version: number;
}

// ============================================================================
// YEARLY SUMMARY
// ============================================================================

/**
 * Yıllık summary dökümanı
 * Bir yılın toplam agregasyonlarını içerir (opsiyonel)
 */
export interface YearlySummary {
  id: string; // "YYYY" formatında
  year: number;

  // Yılın toplam istatistikleri
  totals: StageSummaryStats;

  // Boyut bazlı kırılımlar (sadece top N tutulabilir)
  byHospital: Record<string, StageSummaryStats>;
  byAsm: Record<string, StageSummaryStats>;

  // Aylık trend verisi
  monthlyTotals: Record<string, StageSummaryStats>; // "MM" -> stats

  // Meta bilgiler
  lastUpdated: string;
  version: number;
}

// ============================================================================
// FILTER OPTIONS
// ============================================================================

/**
 * Filtre seçenekleri metadata dökümanı
 * Dashboard filtreleri için tüm benzersiz değerleri tutar
 * Her Excel yüklemesinde güncellenir
 */
export interface FilterOptions {
  id: 'master';

  // Benzersiz değer listeleri
  hospitals: string[]; // Hastane adları (ASM hariç)
  asms: string[]; // ASM adları
  services: string[]; // Servis adları
  tests: string[]; // Test adları
  branches: string[]; // Branş adları

  // Kod -> İsim eşleştirmeleri
  hospitalCodeMap: Record<string, string>; // hospitalId -> hospitalName

  // Tarih aralığı bilgisi
  earliestDate: string; // En eski veri tarihi
  latestDate: string; // En yeni veri tarihi

  // Meta bilgiler
  lastUpdated: string;
  totalRecordCount: number; // Toplam summary kayıt sayısı
}

// ============================================================================
// DASHBOARD VIEW TYPES
// ============================================================================

/**
 * Dashboard için hazırlanmış KPI verileri
 */
export interface DashboardKPIs {
  totalTests: number;
  uniquePatients: number;
  rejectionRate: number; // Yüzde
  avgTatMinutes: number;
  repeatRate: number; // Yüzde
  emergencyRate: number; // Yüzde
}

/**
 * Dashboard grafik verisi - Bar chart için
 */
export interface ChartDataItem {
  name: string;
  value: number;
  emergencyCount?: number;
  normalCount?: number;
}

/**
 * Dashboard için hazırlanmış veri paketi
 */
export interface DashboardData {
  kpis: DashboardKPIs;
  hospitalDistribution: ChartDataItem[];
  serviceDistribution: ChartDataItem[];
  topTests: ChartDataItem[];
  asmDistribution: ChartDataItem[];
  rejectionReasons: ChartDataItem[];
  dailyTrend?: ChartDataItem[]; // Günlük test sayısı trendi
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Summary sorgu parametreleri
 */
export interface SummaryQueryParams {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  hospitals?: string[];
  asms?: string[];
  services?: string[];
  tests?: string[];
  branches?: string[];
}

/**
 * Tarih aralığı türü - Hangi summary koleksiyonundan okunacağını belirler
 */
export type DateRangeType = 'daily' | 'monthly' | 'yearly';

// ============================================================================
// BIGQUERY INTEGRATION TYPES (Gelecek için)
// ============================================================================

/**
 * BigQuery'ye yazılacak ham satır verisi
 */
export interface BigQueryRawRecord {
  // Kimlik alanları
  rowId: string;
  uploadBatchId: string;
  uploadTimestamp: string;

  // Hasta/numune bilgileri
  hastaId: string;
  ornekNo: string;

  // Kurum bilgileri
  hospitalId: string;
  hospitalName: string;
  isAsm: boolean;

  // Test bilgileri
  testName: string;
  service: string;
  branch: string;

  // Durum bayrakları
  isEmergency: boolean;
  isRepeat: boolean;
  repeatCount: number;
  rejectionReason: string | null;

  // Tarihler (ISO format)
  labAcceptDate: string | null;
  workDate: string | null;
  approveDate: string | null;

  // Hesaplanan alanlar
  tatMinutes: number | null;

  // Partition alanı
  labAcceptDatePartition: string; // "YYYY-MM-DD" - BigQuery partition key
}

/**
 * BigQuery detay sorgu parametreleri
 */
export interface BigQueryQueryParams extends SummaryQueryParams {
  // Ek detay filtreleri
  doctorName?: string;
  deviceNo?: string;
  minTatMinutes?: number;
  maxTatMinutes?: number;
  onlyRejected?: boolean;
  onlyRepeats?: boolean;
}

// ============================================================================
// HELPER FUNCTIONS - TYPE GUARDS
// ============================================================================

export function isDailySummary(obj: unknown): obj is DailySummary {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'date' in obj &&
    'totals' in obj &&
    'byHospital' in obj
  );
}

export function isMonthlySummary(obj: unknown): obj is MonthlySummary {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'year' in obj &&
    'month' in obj &&
    'totals' in obj &&
    'dailyTotals' in obj
  );
}

export function isYearlySummary(obj: unknown): obj is YearlySummary {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'year' in obj &&
    'monthlyTotals' in obj &&
    !('month' in obj)
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Boş SummaryStats oluşturur
 */
export function emptySummaryStats(): SummaryStats {
  return {
    totalTests: 0,
    emergencyCount: 0,
    uniquePatientCount: 0,
    rejectedCount: 0,
    repeatCount: 0,
    totalTatMinutes: 0,
    tatCount: 0,
    rejectionReasons: {}
  };
}

/**
 * Boş StageSummaryStats oluşturur
 */
export function emptyStageSummaryStats(): StageSummaryStats {
  return {
    labAccepted: emptySummaryStats(),
    worked: emptySummaryStats(),
    approved: emptySummaryStats()
  };
}

/**
 * StageStats'ı SummaryStats'a dönüştürür
 */
export function stageStatsToSummaryStats(stats: StageStats): SummaryStats {
  return {
    totalTests: stats.totalTests,
    emergencyCount: stats.emergencyCount,
    uniquePatientCount: stats.patientIds.length,
    rejectedCount: stats.rejectedCount,
    repeatCount: stats.repeatCount,
    totalTatMinutes: stats.totalTatMinutes,
    tatCount: stats.tatCount,
    rejectionReasons: { ...stats.rejectionReasons }
  };
}

/**
 * İki SummaryStats'ı birleştirir (merge)
 */
export function mergeSummaryStats(a: SummaryStats, b: SummaryStats): SummaryStats {
  const mergedReasons: Record<string, number> = { ...a.rejectionReasons };
  for (const [reason, count] of Object.entries(b.rejectionReasons)) {
    mergedReasons[reason] = (mergedReasons[reason] || 0) + count;
  }

  return {
    totalTests: a.totalTests + b.totalTests,
    emergencyCount: a.emergencyCount + b.emergencyCount,
    uniquePatientCount: a.uniquePatientCount + b.uniquePatientCount, // Not: Bu yaklaşık değer, gerçek unique için BigQuery gerekli
    rejectedCount: a.rejectedCount + b.rejectedCount,
    repeatCount: a.repeatCount + b.repeatCount,
    totalTatMinutes: a.totalTatMinutes + b.totalTatMinutes,
    tatCount: a.tatCount + b.tatCount,
    rejectionReasons: mergedReasons
  };
}

/**
 * İki StageSummaryStats'ı birleştirir
 */
export function mergeStageSummaryStats(a: StageSummaryStats, b: StageSummaryStats): StageSummaryStats {
  return {
    labAccepted: mergeSummaryStats(a.labAccepted, b.labAccepted),
    worked: mergeSummaryStats(a.worked, b.worked),
    approved: mergeSummaryStats(a.approved, b.approved)
  };
}

/**
 * StageSummaryStats'tan KPI hesaplar
 */
export function calculateKPIsFromStats(stats: SummaryStats): Omit<DashboardKPIs, 'uniquePatients'> & { uniquePatients: number } {
  const { totalTests, emergencyCount, rejectedCount, repeatCount, totalTatMinutes, tatCount, uniquePatientCount } = stats;

  return {
    totalTests,
    uniquePatients: uniquePatientCount,
    rejectionRate: totalTests > 0 ? (rejectedCount / totalTests) * 100 : 0,
    avgTatMinutes: tatCount > 0 ? totalTatMinutes / tatCount : 0,
    repeatRate: totalTests > 0 ? (repeatCount / totalTests) * 100 : 0,
    emergencyRate: totalTests > 0 ? (emergencyCount / totalTests) * 100 : 0
  };
}

/**
 * Tarih aralığına göre hangi summary türünün kullanılacağını belirler
 */
export function determineSummaryType(startDate: string, endDate: string): DateRangeType {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 31) {
    return 'daily'; // 1 aya kadar: günlük summary
  } else if (diffDays <= 365) {
    return 'monthly'; // 1 yıla kadar: aylık summary
  } else {
    return 'yearly'; // 1 yıldan fazla: yıllık summary
  }
}

/**
 * Tarih string'inden ay ID'si oluşturur
 */
export function getMonthId(dateStr: string): string {
  return dateStr.substring(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
}

/**
 * Tarih string'inden yıl ID'si oluşturur
 */
export function getYearId(dateStr: string): string {
  return dateStr.substring(0, 4); // "YYYY-MM-DD" -> "YYYY"
}

/**
 * Tarih aralığındaki tüm günleri döndürür
 */
export function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Tarih aralığındaki tüm ayları döndürür
 */
export function getMonthRange(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const monthId = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
    if (!months.includes(monthId)) {
      months.push(monthId);
    }
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}
