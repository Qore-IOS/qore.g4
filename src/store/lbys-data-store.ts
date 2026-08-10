'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { collection, getDocs, writeBatch, doc, query, setDoc, where, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { scopedQuery } from '@/lib/firestore-helpers';
import { nanoid } from 'nanoid';
import { format } from 'date-fns';
import {
  type DailySummary,
  type MonthlySummary,
  type FilterOptions,
  type DashboardData,
  type SummaryQueryParams,
  type StageSummaryStats,
  emptyStageSummaryStats,
  mergeStageSummaryStats,
  getMonthId
} from '@/lib/analysis-summary-types';
import {
  COLLECTIONS,
  loadDailySummaries,
  loadMonthlySummaries,
  loadFilterOptions,
  saveFilterOptions,
  generateSummariesFromRecords,
  generateMonthlySummariesFromDaily,
  saveSummariesBatch,
  updateFilterOptionsFromSummary,
  generateDashboardDataFromSummaries,
  createEmptyFilterOptions
} from '@/lib/analysis-summary-utils';

// --- EXCEL SÜTUN HARİTALAMASI ---
// A sütunu (index 0): Sıra numarası (başlık yok)
// B sütunu (index 1): HASTA_ID - Benzersiz numune sayısı için kullanılır
// C sütunu (index 2): ORNEKNO
// D sütunu (index 3): HASTANE_ID - 999 ise ASM
// E sütunu (index 4): ACIL - "E" ise acil, "H" ise normal
// H sütunu (index 7): TEST_ADI - Test adı
// L sütunu (index 11): SERVIS_POL_ADI - Servis/ASM adı
// M sütunu (index 12): DOKTOR_BRANS
// O sütunu (index 14): TEKRAR_SAYISI - 0'dan büyükse tekrar
// Q sütunu (index 16): RET_NEDENI - Doluysa red sayılır
// Y sütunu (index 24): LABKABUL_TARIHI - Lab kabul aşaması
// AA sütunu (index 26): CALISMA_TARIHI - Çalışılmış aşaması
// AC sütunu (index 28): ONAYTARIH - Onaylanmış aşaması

// --- VIEW MODE ---
export type ViewMode = 'labAccepted' | 'worked' | 'approved';

// --- STAGE STATS ---
export interface StageStats {
  totalTests: number;
  emergencyCount: number;
  patientIds: string[];
  rejectedCount: number;
  repeatCount: number;
  totalTatMinutes: number;
  tatCount: number;
  rejectionReasons: Record<string, number>;
}

// --- TYPE DEFINITIONS ---
export interface AggregatedRecord {
  id: string;
  date: string;
  hospitalId: string;
  hospitalName: string;
  isAsm: boolean;
  service: string;
  testName: string;
  branch: string;
  // 3 aşama için ayrı istatistikler
  labAccepted: StageStats;
  worked: StageStats;
  approved: StageStats;
  uploadBatchId?: string;
  createdAt?: string;
}

export interface FilterState {
  dateRange: { from: Date | undefined; to: Date | undefined };
  selectedHospitals: string[];
  selectedAsms: string[];
  selectedServices: string[];
  selectedTests: string[];
  selectedBranches: string[];
  showAll: boolean;
}

// --- DASHBOARD DATA STATE ---
interface DashboardState {
  kpis: {
    totalTests: number;
    uniquePatients: number;
    rejectionRate: number;
    avgTatMinutes: number;
    repeatRate: number;
    emergencyRate: number;
  };
  hospitalDistribution: Array<{ name: string; value: number; emergencyCount?: number; normalCount?: number }>;
  serviceDistribution: Array<{ name: string; value: number }>;
  topTests: Array<{ name: string; value: number }>;
  asmDistribution: Array<{ name: string; value: number }>;
  rejectionReasons: Array<{ name: string; value: number }>;
  dailyTrend: Array<{ name: string; value: number }>;
}

interface LbysStore {
  // Legacy data (geriye uyumluluk için)
  aggregatedData: AggregatedRecord[];
  filteredData: AggregatedRecord[];

  // Yeni summary tabanlı data
  dailySummaries: DailySummary[];
  monthlySummaries: MonthlySummary[];
  dashboardData: DashboardState | null;

  // Filter options (master listeler)
  filterOptions: FilterOptions;

  filters: FilterState;
  viewMode: ViewMode;
  isLoading: boolean;
  processingProgress: { current: number; total: number; status: string };
  hospitalDefinitions: Record<string, string>;
  error: string | null;

  // Yeni flag: summary mode aktif mi
  useSummaryMode: boolean;
  /**
   * Oturumun şirket kapsamı. Firestore kuralları `list` sorgularında companyId
   * filtresi zorunlu kıldığı için store'un da bunu bilmesi gerekiyor; store bir
   * React bileşeni olmadığından `useAuth()` çağıramaz, bu yüzden kapsam
   * dışarıdan bir kez set edilir.
   */
  companyScope: { companyId: string | null; isSuperAdmin: boolean };
  setCompanyScope: (scope: { companyId: string | null; isSuperAdmin: boolean }) => void;

  setViewMode: (mode: ViewMode) => void;
  loadDataFromFirestore: (dateRange: { from: Date; to: Date }) => Promise<void>;
  loadAllDataFromFirestore: () => Promise<void>;

  // Yeni summary tabanlı yükleme
  loadSummaryData: (dateRange: { from: Date; to: Date }) => Promise<void>;
  loadFilterOptionsFromFirestore: () => Promise<void>;

  processAndUploadExcel: (excelData: any[]) => Promise<void>;
  setFilters: (newFilters: Partial<FilterState>) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  showAllData: () => void;
  loadHospitalDefinitions: () => Promise<void>;
  saveHospitalDefinition: (code: string, name: string) => Promise<void>;
  resetAnalysisData: () => Promise<void>;

  // Migration utility
  migrateToSummaries: () => Promise<{ success: boolean; message: string }>;

  // Summary mode toggle
  setUseSummaryMode: (enabled: boolean) => void;

  // Web Worker desteği için yeni fonksiyonlar
  getExistingDates: () => Promise<string[]>;
  uploadParsedData: (parsedData: any[]) => Promise<void>;
}

// --- HELPERS ---
const normalize = (str: any): string => str?.toString().toLocaleUpperCase('tr-TR').trim() || "BELİRTİLMEMİŞ";

const parseExcelDate = (input: any): Date | null => {
  if (!input) return null;
  if (typeof input === 'number') {
    return new Date(Math.round((input - 25569) * 86400 * 1000));
  }
  const str = String(input).trim().replace(' ', 'T');
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

const emptyStageStats = (): StageStats => ({
  totalTests: 0,
  emergencyCount: 0,
  patientIds: [],
  rejectedCount: 0,
  repeatCount: 0,
  totalTatMinutes: 0,
  tatCount: 0,
  rejectionReasons: {}
});

const emptyDashboardState = (): DashboardState => ({
  kpis: {
    totalTests: 0,
    uniquePatients: 0,
    rejectionRate: 0,
    avgTatMinutes: 0,
    repeatRate: 0,
    emergencyRate: 0
  },
  hospitalDistribution: [],
  serviceDistribution: [],
  topTests: [],
  asmDistribution: [],
  rejectionReasons: [],
  dailyTrend: []
});

// --- ZUSTAND STORE ---
export const useLbysDataStore = create<LbysStore>()(
  devtools(
    (set, get) => ({
      aggregatedData: [],
      filteredData: [],
      dailySummaries: [],
      monthlySummaries: [],
      dashboardData: null,
      filterOptions: createEmptyFilterOptions(),
      isLoading: false,
      processingProgress: { current: 0, total: 0, status: '' },
      error: null,
      viewMode: 'approved', // Default: Onaylanmış testler
      useSummaryMode: true, // Summary mode: Aktif (optimum performans)
      filters: {
        dateRange: { from: new Date(new Date().setDate(new Date().getDate() - 7)), to: new Date() },
        selectedHospitals: [],
        selectedAsms: [],
        selectedServices: [],
        selectedTests: [],
        selectedBranches: [],
        showAll: false,
      },
      hospitalDefinitions: {},

      setUseSummaryMode: (enabled) => {
        set({ useSummaryMode: enabled });
      },

      setViewMode: (mode) => {
        set({ viewMode: mode });
        const { useSummaryMode, dailySummaries, filters } = get();

        if (useSummaryMode && dailySummaries.length > 0) {
          // Summary mode: dashboard verisini yeniden hesapla
          const queryParams: SummaryQueryParams = {
            startDate: filters.dateRange.from ? format(filters.dateRange.from, 'yyyy-MM-dd') : '',
            endDate: filters.dateRange.to ? format(filters.dateRange.to, 'yyyy-MM-dd') : '',
            hospitals: filters.selectedHospitals.length > 0 ? filters.selectedHospitals : undefined,
            asms: filters.selectedAsms.length > 0 ? filters.selectedAsms : undefined,
            services: filters.selectedServices.length > 0 ? filters.selectedServices : undefined,
            tests: filters.selectedTests.length > 0 ? filters.selectedTests : undefined,
            branches: filters.selectedBranches.length > 0 ? filters.selectedBranches : undefined
          };

          const data = generateDashboardDataFromSummaries(dailySummaries, mode, queryParams);
          set({
            dashboardData: {
              kpis: data.kpis,
              hospitalDistribution: data.hospitalDistribution,
              serviceDistribution: data.serviceDistribution,
              topTests: data.topTests,
              asmDistribution: data.asmDistribution,
              rejectionReasons: data.rejectionReasons,
              dailyTrend: data.dailyTrend || []
            }
          });
        } else {
          // Legacy mode
          get().applyFilters();
        }
      },

      companyScope: { companyId: null, isSuperAdmin: false },

      setCompanyScope: (scope) => set({ companyScope: scope }),


      loadHospitalDefinitions: async () => {
        try {
          const snap = await getDocs(scopedQuery('config_hospitals', get().companyScope.companyId, get().companyScope.isSuperAdmin));
          const defs: Record<string, string> = {};
          snap.forEach(d => { defs[d.id] = d.data().name });
          set({ hospitalDefinitions: defs });
        } catch (e) {
          console.error("Definitions error", e);
        }
      },

      saveHospitalDefinition: async (code, name) => {
         if (!code || !name) return;
         try {
             await setDoc(doc(db, 'config_hospitals', code), { name });
             const current = get().hospitalDefinitions;
             set({ hospitalDefinitions: { ...current, [code]: name } });
             const updated = get().aggregatedData.map(d => (!d.isAsm && d.hospitalId === code) ? {...d, hospitalName: name} : d);
             set({ aggregatedData: updated });
             get().applyFilters();
         } catch(e) { console.error(e); }
      },

      // Yeni: Filter options'ı Firestore'dan yükle
      loadFilterOptionsFromFirestore: async () => {
        try {
          const options = await loadFilterOptions();
          set({ filterOptions: options });
        } catch (e) {
          console.error("Filter options yükleme hatası:", e);
        }
      },

      // Yeni: Summary tabanlı veri yükleme
      loadSummaryData: async (dateRange) => {
        if (!dateRange.from || !dateRange.to) return;

        set({
          isLoading: true,
          processingProgress: { current: 0, total: 3, status: 'Summary veriler yükleniyor...' }
        });

        try {
          const startDate = format(dateRange.from, 'yyyy-MM-dd');
          const endDate = format(dateRange.to, 'yyyy-MM-dd');

          // 1. Günlük summary'leri yükle
          set({ processingProgress: { current: 1, total: 3, status: 'Günlük summary yükleniyor...' } });
          const dailySummaries = await loadDailySummaries(startDate, endDate);

          // 2. Dashboard verisini hesapla
          set({ processingProgress: { current: 2, total: 3, status: 'Dashboard verisi hesaplanıyor...' } });
          const { viewMode, filters } = get();

          const queryParams: SummaryQueryParams = {
            startDate,
            endDate,
            hospitals: filters.selectedHospitals.length > 0 ? filters.selectedHospitals : undefined,
            asms: filters.selectedAsms.length > 0 ? filters.selectedAsms : undefined,
            services: filters.selectedServices.length > 0 ? filters.selectedServices : undefined,
            tests: filters.selectedTests.length > 0 ? filters.selectedTests : undefined,
            branches: filters.selectedBranches.length > 0 ? filters.selectedBranches : undefined
          };

          const data = generateDashboardDataFromSummaries(dailySummaries, viewMode, queryParams);

          set({
            dailySummaries,
            dashboardData: {
              kpis: data.kpis,
              hospitalDistribution: data.hospitalDistribution,
              serviceDistribution: data.serviceDistribution,
              topTests: data.topTests,
              asmDistribution: data.asmDistribution,
              rejectionReasons: data.rejectionReasons,
              dailyTrend: data.dailyTrend || []
            },
            processingProgress: { current: 3, total: 3, status: 'Tamamlandı' }
          });

          console.log(`Qore Analyse: ${dailySummaries.length} günlük summary yüklendi (${startDate} - ${endDate}).`);
        } catch (error: any) {
          set({ error: "Summary veri yükleme hatası: " + error.message });
          console.error("Summary load failed:", error);
        } finally {
          set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
      },

      // Legacy: Firestore'dan raw veri yükleme (geriye uyumluluk)
      loadDataFromFirestore: async (dateRange) => {
        const { useSummaryMode } = get();

        // Summary mode aktifse, summary'lerden yükle
        if (useSummaryMode) {
          return get().loadSummaryData(dateRange);
        }

        // Legacy mode
        if (!dateRange.from || !dateRange.to) return;
        set({ isLoading: true, processingProgress: { current: 0, total: 0, status: 'Veriler Buluttan İndiriliyor...' } });
        try {
            const startDate = format(dateRange.from, 'yyyy-MM-dd');
            const endDate = format(dateRange.to, 'yyyy-MM-dd');

            const q = query(
                scopedQuery('analysis_results', get().companyScope.companyId, get().companyScope.isSuperAdmin),
                where('date', '>=', startDate),
                where('date', '<=', endDate)
            );

            const querySnapshot = await getDocs(q);
            const fetchedData: AggregatedRecord[] = [];

            querySnapshot.forEach((doc) => {
                fetchedData.push(doc.data() as AggregatedRecord);
            });

            set({ aggregatedData: fetchedData });
            get().applyFilters();
            console.log(`Qore Analyse: Firestore'dan ${fetchedData.length} kayıt indirildi (${startDate} - ${endDate}).`);
        } catch (error: any) {
            set({ error: "Veri indirme hatası: " + error.message });
            console.error("Firestore query failed:", error);
        } finally {
            set({ isLoading: false });
        }
      },

      loadAllDataFromFirestore: async () => {
        const { useSummaryMode } = get();

        if (useSummaryMode) {
          // Summary mode: son 90 günü yükle
          const today = new Date();
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(today.getDate() - 90);
          return get().loadSummaryData({ from: ninetyDaysAgo, to: today });
        }

        // Legacy mode
        set({ isLoading: true, processingProgress: { current: 0, total: 0, status: 'Tüm Veriler Yükleniyor...' } });
        try {
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            const startDate = format(ninetyDaysAgo, 'yyyy-MM-dd');

            const q = query(
                scopedQuery('analysis_results', get().companyScope.companyId, get().companyScope.isSuperAdmin),
                where('date', '>=', startDate)
            );

            const querySnapshot = await getDocs(q);
            const fetchedData: AggregatedRecord[] = [];

            const docs = querySnapshot.docs;
            const totalDocs = docs.length;
            set({ processingProgress: { current: 0, total: totalDocs, status: 'Veriler İşleniyor...' } });

            const PROCESS_CHUNK = 500;
            for (let i = 0; i < totalDocs; i += PROCESS_CHUNK) {
                const chunk = docs.slice(i, i + PROCESS_CHUNK);
                chunk.forEach((doc) => {
                    fetchedData.push(doc.data() as AggregatedRecord);
                });
                set({ processingProgress: { current: Math.min(i + PROCESS_CHUNK, totalDocs), total: totalDocs, status: 'Veriler İşleniyor...' } });
                await new Promise(r => setTimeout(r, 0));
            }

            set({ aggregatedData: fetchedData });
            get().applyFilters();
            console.log(`Qore Analyse: Firestore'dan toplam ${fetchedData.length} kayıt indirildi (son 90 gün).`);
        } catch (error: any) {
            set({ error: "Veri indirme hatası: " + error.message });
            console.error("Firestore query failed:", error);
        } finally {
            set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
      },

      processAndUploadExcel: async (excelData) => {
        console.log("Qore Analyse: Veri işleme başlatıldı...");
        set({ isLoading: true, error: null, processingProgress: { current: 0, total: excelData.length, status: 'Analiz Ediliyor...' } });
        const { hospitalDefinitions } = get();
        const uploadBatchId = nanoid();

        try {
            // Her aşama için ayrı gruplar
            const groups: Map<string, {
              id: string;
              date: string;
              hospitalId: string;
              hospitalName: string;
              isAsm: boolean;
              service: string;
              testName: string;
              branch: string;
              labAccepted: { totalTests: number; emergencyCount: number; patientIds: Set<string>; rejectedCount: number; repeatCount: number; totalTatMinutes: number; tatCount: number; rejectionReasons: Record<string, number> };
              worked: { totalTests: number; emergencyCount: number; patientIds: Set<string>; rejectedCount: number; repeatCount: number; totalTatMinutes: number; tatCount: number; rejectionReasons: Record<string, number> };
              approved: { totalTests: number; emergencyCount: number; patientIds: Set<string>; rejectedCount: number; repeatCount: number; totalTatMinutes: number; tatCount: number; rejectionReasons: Record<string, number> };
            }> = new Map();

            let skippedCount = 0;
            let labAcceptedCount = 0;
            let workedCount = 0;
            let approvedCount = 0;

            const processChunk = (chunk: any[]) => {
                chunk.forEach((row) => {
                    if (!row || row.length < 12) return;

                    // D sütunu (index 3): HASTANE_ID
                    const rawHospitalId = row[3];
                    if (!rawHospitalId) { skippedCount++; return; }

                    // Aşama kontrolü
                    // Y (24): Lab Kabul, AA (26): Çalışılmış, AC (28): Onaylanmış
                    const rawLabAcceptDate = row[24];
                    const rawWorkDate = row[26];
                    const rawApproveDate = row[28];

                    // En az lab kabul tarihi olmalı
                    if (!rawLabAcceptDate) { skippedCount++; return; }

                    const labAcceptDate = parseExcelDate(rawLabAcceptDate);
                    if (!labAcceptDate) { skippedCount++; return; }

                    const workDate = parseExcelDate(rawWorkDate);
                    const approveDate = parseExcelDate(rawApproveDate);

                    // Tarih olarak lab kabul tarihini kullan
                    const dateStr = format(labAcceptDate, 'yyyy-MM-dd');
                    const hospitalId = String(rawHospitalId).trim();
                    const isAsm = hospitalId === '999';

                    let derivedHospitalName = 'Bilinmeyen Kurum';
                    if (isAsm) {
                        derivedHospitalName = normalize(row[11]);
                    } else {
                        derivedHospitalName = hospitalDefinitions[hospitalId] || `Hastane (${hospitalId})`;
                    }

                    const testName = normalize(row[7]);
                    const serviceName = normalize(row[11]);
                    const branchName = normalize(row[12]);
                    const patientId = String(row[1] || `temp-${Math.random()}`);
                    const isEmergency = String(row[4] || '').toUpperCase() === 'E';
                    const isRepeat = Number(row[14] || 0) > 0;
                    const rejectionReason = String(row[16] || '').trim();

                    // TAT hesabı (lab kabul - çalışma arası)
                    const tatMin = workDate ? (workDate.getTime() - labAcceptDate.getTime()) / (1000 * 60) : 0;

                    const key = `${dateStr}|${hospitalId}|${serviceName}|${testName}|${branchName}`;
                    const docId = key.replace(/\|/g, '_').replace(/[^a-zA-Z0-9_\u00C0-\u024F]/g, '').substring(0, 150);

                    if (!groups.has(key)) {
                        groups.set(key, {
                            id: docId,
                            date: dateStr,
                            hospitalId,
                            hospitalName: derivedHospitalName,
                            isAsm,
                            service: serviceName,
                            testName,
                            branch: branchName,
                            labAccepted: { totalTests: 0, emergencyCount: 0, patientIds: new Set(), rejectedCount: 0, repeatCount: 0, totalTatMinutes: 0, tatCount: 0, rejectionReasons: {} },
                            worked: { totalTests: 0, emergencyCount: 0, patientIds: new Set(), rejectedCount: 0, repeatCount: 0, totalTatMinutes: 0, tatCount: 0, rejectionReasons: {} },
                            approved: { totalTests: 0, emergencyCount: 0, patientIds: new Set(), rejectedCount: 0, repeatCount: 0, totalTatMinutes: 0, tatCount: 0, rejectionReasons: {} }
                        });
                    }

                    const record = groups.get(key)!;

                    // Lab Kabul aşaması (Y dolu) - her zaman sayılır
                    record.labAccepted.totalTests++;
                    labAcceptedCount++;
                    if (isEmergency) record.labAccepted.emergencyCount++;
                    record.labAccepted.patientIds.add(patientId);
                    if (isRepeat) record.labAccepted.repeatCount++;
                    if (rejectionReason) {
                        record.labAccepted.rejectedCount++;
                        record.labAccepted.rejectionReasons[rejectionReason] = (record.labAccepted.rejectionReasons[rejectionReason] || 0) + 1;
                    }

                    // Çalışılmış aşaması (Y + AA dolu)
                    if (workDate) {
                        record.worked.totalTests++;
                        workedCount++;
                        if (isEmergency) record.worked.emergencyCount++;
                        record.worked.patientIds.add(patientId);
                        if (isRepeat) record.worked.repeatCount++;
                        if (rejectionReason) {
                            record.worked.rejectedCount++;
                            record.worked.rejectionReasons[rejectionReason] = (record.worked.rejectionReasons[rejectionReason] || 0) + 1;
                        }
                        if (tatMin > 0) {
                            record.worked.totalTatMinutes += tatMin;
                            record.worked.tatCount++;
                        }
                    }

                    // Onaylanmış aşaması (Y + AA + AC dolu)
                    if (workDate && approveDate) {
                        record.approved.totalTests++;
                        approvedCount++;
                        if (isEmergency) record.approved.emergencyCount++;
                        record.approved.patientIds.add(patientId);
                        if (isRepeat) record.approved.repeatCount++;
                        if (rejectionReason) {
                            record.approved.rejectedCount++;
                            record.approved.rejectionReasons[rejectionReason] = (record.approved.rejectionReasons[rejectionReason] || 0) + 1;
                        }
                        if (tatMin > 0) {
                            record.approved.totalTatMinutes += tatMin;
                            record.approved.tatCount++;
                        }
                    }
                });
            };

            const chunkSize = 5000;
            for (let i = 1; i < excelData.length; i += chunkSize) {
                const chunk = excelData.slice(i, i + chunkSize);
                processChunk(chunk);
                set({ processingProgress: { current: Math.min(i + chunkSize, excelData.length), total: excelData.length, status: 'Analiz Ediliyor...' } });
                await new Promise(r => setTimeout(r, 0));
            }

            // Set'leri array'e dönüştür
            const newRecords: AggregatedRecord[] = Array.from(groups.values()).map(g => ({
                id: g.id,
                date: g.date,
                hospitalId: g.hospitalId,
                hospitalName: g.hospitalName,
                isAsm: g.isAsm,
                service: g.service,
                testName: g.testName,
                branch: g.branch,
                labAccepted: { ...g.labAccepted, patientIds: Array.from(g.labAccepted.patientIds) },
                worked: { ...g.worked, patientIds: Array.from(g.worked.patientIds) },
                approved: { ...g.approved, patientIds: Array.from(g.approved.patientIds) },
                uploadBatchId,
                createdAt: new Date().toISOString()
            }));

            console.log(`Qore Analyse: Lab Kabul: ${labAcceptedCount}, Çalışılmış: ${workedCount}, Onaylanmış: ${approvedCount}, Atlanan: ${skippedCount}`);

            // =====================================================
            // Firestore'a yaz (sadece raw veriler - summary ayrı migration ile)
            // =====================================================
            const totalDocs = newRecords.length;
            set({ processingProgress: { current: 0, total: totalDocs, status: 'Buluta Yazılıyor...' } });
            const CHUNK_SIZE = 450;
            let writtenCount = 0;

            for (let i = 0; i < totalDocs; i += CHUNK_SIZE) {
                const chunk = newRecords.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);

                chunk.forEach((docData) => {
                    const docRef = doc(db, 'analysis_results', docData.id);
                    batch.set(docRef, docData, { merge: true });
                });

                await batch.commit();
                writtenCount += chunk.length;
                set({ processingProgress: { current: writtenCount, total: totalDocs, status: 'Buluta Yazılıyor...' } });
                // UI'ın nefes almasını sağla
                await new Promise(r => setTimeout(r, 0));
            }

            console.log(`Qore Analyse: ${totalDocs} raw kayıt buluta yüklendi.`);

            // Local state güncelle
            const currentData = get().aggregatedData;
            const newDataMap = new Map(newRecords.map(r => [r.id, r]));

            const updatedData = currentData.map(existing => {
                const newVersion = newDataMap.get(existing.id);
                if (newVersion) {
                    newDataMap.delete(existing.id);
                    return newVersion;
                }
                return existing;
            });

            newDataMap.forEach(newRec => updatedData.push(newRec));

            set({ aggregatedData: updatedData });
            get().applyFilters();

        } catch (error: any) {
            set({ error: "Hata: " + error.message });
            console.error("Excel işleme hatası:", error);
        } finally {
            set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
      },

      applyFilters: () => {
        const { useSummaryMode, dailySummaries, aggregatedData, filters, viewMode } = get();

        if (useSummaryMode && dailySummaries.length > 0) {
          // Summary mode: dashboard verisini yeniden hesapla
          const queryParams: SummaryQueryParams = {
            startDate: filters.dateRange.from ? format(filters.dateRange.from, 'yyyy-MM-dd') : '',
            endDate: filters.dateRange.to ? format(filters.dateRange.to, 'yyyy-MM-dd') : '',
            hospitals: filters.selectedHospitals.length > 0 ? filters.selectedHospitals : undefined,
            asms: filters.selectedAsms.length > 0 ? filters.selectedAsms : undefined,
            services: filters.selectedServices.length > 0 ? filters.selectedServices : undefined,
            tests: filters.selectedTests.length > 0 ? filters.selectedTests : undefined,
            branches: filters.selectedBranches.length > 0 ? filters.selectedBranches : undefined
          };

          const data = generateDashboardDataFromSummaries(dailySummaries, viewMode, queryParams);
          set({
            dashboardData: {
              kpis: data.kpis,
              hospitalDistribution: data.hospitalDistribution,
              serviceDistribution: data.serviceDistribution,
              topTests: data.topTests,
              asmDistribution: data.asmDistribution,
              rejectionReasons: data.rejectionReasons,
              dailyTrend: data.dailyTrend || []
            }
          });
          return;
        }

        // Legacy mode
        const filtered = aggregatedData.filter((item) => {
            // viewMode'a göre bu kayıtta veri var mı kontrol et
            const stageData = item[viewMode];
            if (!stageData || stageData.totalTests === 0) return false;

            let locationMatch = true;
            if (filters.selectedHospitals.length > 0 || filters.selectedAsms.length > 0) {
                 locationMatch = (filters.selectedHospitals.includes(item.hospitalName) || filters.selectedAsms.includes(item.hospitalName));
            }

            const serviceMatch = filters.selectedServices.length === 0 || filters.selectedServices.includes(item.service);
            const testMatch = filters.selectedTests.length === 0 || filters.selectedTests.includes(item.testName);
            const branchMatch = filters.selectedBranches.length === 0 || filters.selectedBranches.includes(item.branch);

            return locationMatch && serviceMatch && testMatch && branchMatch;
        });
        set({ filteredData: filtered });
      },

      setFilters: (newFilters) => {
        set(state => ({ filters: { ...state.filters, ...newFilters } }));
        get().applyFilters();
      },

      resetFilters: () => {
         const today = new Date();
         const lastWeek = new Date();
         lastWeek.setDate(today.getDate() - 7);
         const newFilters: FilterState = {
            dateRange: { from: lastWeek, to: today },
            selectedHospitals: [], selectedAsms: [], selectedServices: [], selectedTests: [], selectedBranches: [],
            showAll: false
         };
         set({ filters: newFilters, viewMode: 'approved' });
         get().loadDataFromFirestore({ from: lastWeek, to: today });
      },

      showAllData: () => {
         const newFilters: FilterState = {
            dateRange: { from: undefined, to: undefined },
            selectedHospitals: [], selectedAsms: [], selectedServices: [], selectedTests: [], selectedBranches: [],
            showAll: true
         };
         set({ filters: newFilters });
         get().loadAllDataFromFirestore();
      },

      resetAnalysisData: async () => {
        set({ isLoading: true, error: null, processingProgress: { current: 0, total: 0, status: 'Veriler Sayılıyor...' } });
        try {
          console.log('Qore Analyse: Tüm veriler siliniyor...');

          // Summary koleksiyonlarını da sil
          const collections = [
            COLLECTIONS.RAW_RESULTS,
            COLLECTIONS.DAILY_SUMMARY,
            COLLECTIONS.MONTHLY_SUMMARY,
            COLLECTIONS.YEARLY_SUMMARY
          ];

          let totalDeleted = 0;

          for (const collName of collections) {
            const snapshot = await getDocs(collection(db, collName));
            const total = snapshot.size;

            if (total === 0) continue;

            console.log(`Qore Analyse: ${collName} - ${total} kayıt silinecek.`);
            set({ processingProgress: { current: 0, total, status: `${collName} siliniyor...` } });

            const CHUNK_SIZE = 450;
            let deletedCount = 0;

            for (let i = 0; i < total; i += CHUNK_SIZE) {
              const batch = writeBatch(db);
              const chunk = snapshot.docs.slice(i, i + CHUNK_SIZE);
              chunk.forEach(docSnap => batch.delete(docSnap.ref));
              await batch.commit();
              deletedCount += chunk.length;
              totalDeleted += chunk.length;
              set({ processingProgress: { current: deletedCount, total, status: `${collName}: ${deletedCount}/${total}` } });
              await new Promise(r => setTimeout(r, 10));
            }
          }

          // Filter options'ı sıfırla
          await saveFilterOptions(createEmptyFilterOptions());

          console.log(`Qore Analyse: Toplam ${totalDeleted} kayıt başarıyla silindi.`);
          set({
            aggregatedData: [],
            filteredData: [],
            dailySummaries: [],
            monthlySummaries: [],
            dashboardData: null,
            filterOptions: createEmptyFilterOptions()
          });
        } catch (error: any) {
          console.error('Qore Analyse: Silme hatası:', error);
          set({ error: "Veri sıfırlama hatası: " + error.message });
        } finally {
          set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
      },

      // Migration utility: Mevcut raw verilerden summary oluşturur
      migrateToSummaries: async () => {
        set({
          isLoading: true,
          error: null,
          processingProgress: { current: 0, total: 100, status: 'Mevcut veriler okunuyor...' }
        });

        try {
          // Tüm raw verileri oku
          const snapshot = await getDocs(collection(db, COLLECTIONS.RAW_RESULTS));
          const records: AggregatedRecord[] = [];

          snapshot.forEach((doc) => {
            records.push(doc.data() as AggregatedRecord);
          });

          if (records.length === 0) {
            set({ isLoading: false });
            return { success: true, message: 'Migration için veri bulunamadı.' };
          }

          set({ processingProgress: { current: 20, total: 100, status: `${records.length} kayıt bulundu, summary oluşturuluyor...` } });

          // Günlük summary'ler oluştur
          const dailySummaries = generateSummariesFromRecords(records);
          set({ processingProgress: { current: 40, total: 100, status: `${dailySummaries.size} günlük summary oluşturuldu` } });

          // Aylık summary'ler oluştur
          const monthlySummaries = generateMonthlySummariesFromDaily(dailySummaries);
          set({ processingProgress: { current: 50, total: 100, status: `${monthlySummaries.size} aylık summary oluşturuldu` } });

          // Filter options oluştur
          let filterOptions = createEmptyFilterOptions();
          for (const summary of dailySummaries.values()) {
            filterOptions = updateFilterOptionsFromSummary(summary, filterOptions);
          }

          // Hospital code map'i oluştur
          for (const record of records) {
            if (!record.isAsm && record.hospitalId) {
              filterOptions.hospitalCodeMap[record.hospitalId] = record.hospitalName;
            }
          }

          set({ processingProgress: { current: 60, total: 100, status: 'Summary veriler Firestore\'a yazılıyor...' } });

          // Firestore'a yaz
          await saveSummariesBatch(dailySummaries, monthlySummaries, filterOptions, (current, total, status) => {
            const progress = 60 + Math.round((current / total) * 40);
            set({ processingProgress: { current: progress, total: 100, status } });
          });

          // Local state güncelle
          set({
            dailySummaries: Array.from(dailySummaries.values()),
            monthlySummaries: Array.from(monthlySummaries.values()),
            filterOptions
          });

          const message = `Migration tamamlandı: ${dailySummaries.size} günlük, ${monthlySummaries.size} aylık summary oluşturuldu.`;
          console.log('Qore Analyse:', message);

          return { success: true, message };
        } catch (error: any) {
          console.error('Migration error:', error);
          set({ error: "Migration hatası: " + error.message });
          return { success: false, message: error.message };
        } finally {
          set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
      },

      // Mevcut tarihleri al (incremental upload için)
      getExistingDates: async () => {
        try {
          const { useSummaryMode } = get();

          if (useSummaryMode) {
            // Summary mode: daily summary koleksiyonundan tarihleri al
            const snapshot = await getDocs(collection(db, COLLECTIONS.DAILY_SUMMARY));
            const dates: string[] = [];
            snapshot.forEach((doc) => {
              dates.push(doc.id); // doc.id = "YYYY-MM-DD"
            });
            return dates;
          } else {
            // Legacy mode: analysis_results'tan unique tarihleri al
            const snapshot = await getDocs(scopedQuery('analysis_results', get().companyScope.companyId, get().companyScope.isSuperAdmin));
            const dateSet = new Set<string>();
            snapshot.forEach((doc) => {
              const data = doc.data();
              if (data.date) dateSet.add(data.date);
            });
            return Array.from(dateSet);
          }
        } catch (error) {
          console.error('Mevcut tarihler alınamadı:', error);
          return [];
        }
      },

      // Worker'dan gelen parse edilmiş veriyi yükle
      uploadParsedData: async (parsedData) => {
        if (!parsedData || parsedData.length === 0) {
          set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
          return;
        }

        const { hospitalDefinitions, useSummaryMode } = get();
        const uploadBatchId = nanoid();

        try {
          set({ processingProgress: { current: 0, total: parsedData.length, status: 'Hastane isimleri eşleştiriliyor...' } });

          // Hospital names eşleştirme
          const recordsWithNames: AggregatedRecord[] = parsedData.map((record: any) => {
            let hospitalName = 'Bilinmeyen Kurum';

            if (record.isAsm) {
              hospitalName = record.service;
            } else {
              hospitalName = hospitalDefinitions[record.hospitalId] || `Hastane (${record.hospitalId})`;
            }

            return {
              ...record,
              hospitalName,
              uploadBatchId,
              createdAt: new Date().toISOString()
            };
          });

          // =====================================================
          // Firestore'a yaz (optimized batch writing)
          // =====================================================
          const totalDocs = recordsWithNames.length;
          set({ processingProgress: { current: 0, total: totalDocs, status: 'Buluta yazılıyor...' } });

          const CHUNK_SIZE = 450;
          let writtenCount = 0;

          for (let i = 0; i < totalDocs; i += CHUNK_SIZE) {
            const chunk = recordsWithNames.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);

            chunk.forEach((docData) => {
              const docRef = doc(db, 'analysis_results', docData.id);
              batch.set(docRef, docData, { merge: true });
            });

            await batch.commit();
            writtenCount += chunk.length;
            set({ processingProgress: { current: writtenCount, total: totalDocs, status: `Buluta yazılıyor... (${writtenCount}/${totalDocs})` } });

            // UI nefes alsın
            await new Promise(r => setTimeout(r, 0));
          }

          console.log(`Qore Analyse: ${totalDocs} kayıt buluta yüklendi.`);

          // =====================================================
          // Summary mode ise summary'leri de güncelle
          // =====================================================
          if (useSummaryMode) {
            set({ processingProgress: { current: 0, total: 100, status: 'Summary veriler oluşturuluyor...' } });

            // Günlük summary'ler oluştur
            const dailySummaries = generateSummariesFromRecords(recordsWithNames);
            set({ processingProgress: { current: 30, total: 100, status: `${dailySummaries.size} günlük summary oluşturuldu` } });

            // Aylık summary'ler oluştur
            const monthlySummaries = generateMonthlySummariesFromDaily(dailySummaries);
            set({ processingProgress: { current: 40, total: 100, status: `${monthlySummaries.size} aylık summary oluşturuldu` } });

            // Filter options güncelle
            let filterOptions = get().filterOptions;
            for (const summary of dailySummaries.values()) {
              filterOptions = updateFilterOptionsFromSummary(summary, filterOptions);
            }

            // Hospital code map güncelle
            for (const record of recordsWithNames) {
              if (!record.isAsm && record.hospitalId) {
                filterOptions.hospitalCodeMap[record.hospitalId] = record.hospitalName;
              }
            }

            set({ processingProgress: { current: 50, total: 100, status: 'Summary veriler yazılıyor...' } });

            // Summary'leri kaydet
            await saveSummariesBatch(dailySummaries, monthlySummaries, filterOptions, (current, total, status) => {
              const progress = 50 + Math.round((current / total) * 50);
              set({ processingProgress: { current: progress, total: 100, status } });
            });

            // Local state güncelle
            const existingSummaries = get().dailySummaries;
            const newSummariesMap = new Map<string, DailySummary>();
            dailySummaries.forEach((summary, id) => newSummariesMap.set(id, summary));

            // Mevcut summary'leri güncelle veya yenilerini ekle
            const updatedSummaries = existingSummaries.map(existing => {
              const newVersion = newSummariesMap.get(existing.id);
              if (newVersion) {
                newSummariesMap.delete(existing.id);
                return newVersion;
              }
              return existing;
            });

            newSummariesMap.forEach(newSummary => updatedSummaries.push(newSummary));

            set({
              dailySummaries: updatedSummaries,
              monthlySummaries: Array.from(monthlySummaries.values()),
              filterOptions
            });

            console.log(`Qore Analyse: ${dailySummaries.size} günlük summary güncellendi.`);
          }

          // Local aggregatedData güncelle
          const currentData = get().aggregatedData;
          const newDataMap = new Map(recordsWithNames.map(r => [r.id, r]));

          const updatedData = currentData.map(existing => {
            const newVersion = newDataMap.get(existing.id);
            if (newVersion) {
              newDataMap.delete(existing.id);
              return newVersion;
            }
            return existing;
          });

          newDataMap.forEach(newRec => updatedData.push(newRec));

          set({ aggregatedData: updatedData });
          get().applyFilters();

        } catch (error: any) {
          set({ error: "Yükleme hatası: " + error.message });
          console.error("Upload error:", error);
        } finally {
          set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
      }
    })
  )
);
