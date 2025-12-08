'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { collection, getDocs, writeBatch, doc, query, setDoc, where, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { nanoid } from 'nanoid';
import { format } from 'date-fns';

// --- EXCEL SÜTUN HARİTALAMASI ---
// A sütunu (index 0): Sıra numarası (başlık yok)
// B sütunu (index 1): HASTA_ID - Benzersiz numune sayısı için kullanılır
// C sütunu (index 2): ORNEKNO
// D sütunu (index 3): HASTANE_ID - 999 ise ASM
// E sütunu (index 4): ACIL - "E" ise acil, "H" ise normal
// F sütunu (index 5): YATAN
// G sütunu (index 6): TEST_ID
// H sütunu (index 7): TEST_ADI - Test adı
// I sütunu (index 8): ENDIKE_KODU
// J sütunu (index 9): BARKODNO
// K sütunu (index 10): SERVIS_POLIKLINIK_KODU
// L sütunu (index 11): SERVIS_POL_ADI - Servis/ASM adı
// M sütunu (index 12): DOKTOR_BRANS
// N sütunu (index 13): DOKTOR_BRANS_KOD
// O sütunu (index 14): TEKRAR_SAYISI - 0'dan büyükse tekrar
// P sütunu (index 15): CIHAZNO
// Q sütunu (index 16): RET_NEDENI - Doluysa red sayılır
// ... diğer sütunlar kullanılmıyor
// Y sütunu (index 24): LABKABUL_TARIHI - TAT hesabı için
// Z sütunu (index 25): -
// AA sütunu (index 26): CALISMA_TARIHI - Test sayısı ve TAT hesabı için

// --- TYPE DEFINITIONS ---
export interface AggregatedRecord {
  id: string; // Composite key: date|hospitalId|service|testName|branch
  date: string; // YYYY-MM-DD
  hospitalId: string; // HASTANE_ID (Raw) - D sütunu
  hospitalName: string; // Mapped Name or ASM Name
  isAsm: boolean; // hospitalId == 999
  service: string; // L sütunu
  testName: string; // H sütunu
  totalTests: number; // AA sütunu dolu olanlar
  emergencyCount: number; // E sütunu == 'E' sayısı
  patientIds: string[]; // B sütunu - benzersiz numune
  rejectedCount: number; // Q sütunu dolu olanlar
  repeatCount: number; // O sütunu > 0 olanlar
  totalTatMinutes: number; // Y ve AA arası fark toplamı
  tatCount: number; // TAT hesaplanan satır sayısı
  rejectionReasons: Record<string, number>; // Red nedenleri ve sayıları
  branch: string; // M sütunu
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
  showAll: boolean; // Tüm verileri göster
}

interface LbysStore {
  aggregatedData: AggregatedRecord[];
  filteredData: AggregatedRecord[];
  filters: FilterState;
  isLoading: boolean;
  processingProgress: { current: number; total: number; status: string };
  hospitalDefinitions: Record<string, string>;
  error: string | null;

  loadDataFromFirestore: (dateRange: { from: Date; to: Date }) => Promise<void>;
  loadAllDataFromFirestore: () => Promise<void>; // Tüm verileri yükle
  processAndUploadExcel: (excelData: any[]) => Promise<void>;
  setFilters: (newFilters: Partial<FilterState>) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  showAllData: () => void; // Tümünü göster
  loadHospitalDefinitions: () => Promise<void>;
  saveHospitalDefinition: (code: string, name: string) => Promise<void>;
  resetAnalysisData: () => Promise<void>;
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

// --- ZUSTAND STORE ---
export const useLbysDataStore = create<LbysStore>()(
  devtools(
    (set, get) => ({
      aggregatedData: [],
      filteredData: [],
      isLoading: false,
      processingProgress: { current: 0, total: 0, status: '' },
      error: null,
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

      loadHospitalDefinitions: async () => {
        try {
          const snap = await getDocs(collection(db, 'config_hospitals'));
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

      loadDataFromFirestore: async (dateRange) => {
        if (!dateRange.from || !dateRange.to) return;
        set({ isLoading: true, processingProgress: { current: 0, total: 0, status: 'Veriler Buluttan İndiriliyor...' } });
        try {
            const startDate = format(dateRange.from, 'yyyy-MM-dd');
            const endDate = format(dateRange.to, 'yyyy-MM-dd');

            const q = query(
                collection(db, 'analysis_results'),
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
        set({ isLoading: true, processingProgress: { current: 0, total: 0, status: 'Tüm Veriler Yükleniyor...' } });
        try {
            // Performans için son 90 günlük veriyi çek (çok fazla veri tarayıcıyı çökertebilir)
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            const startDate = format(ninetyDaysAgo, 'yyyy-MM-dd');

            const q = query(
                collection(db, 'analysis_results'),
                where('date', '>=', startDate)
            );

            const querySnapshot = await getDocs(q);
            const fetchedData: AggregatedRecord[] = [];

            // Chunk halinde işle - tarayıcı donmasını önle
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
                // UI'ın güncellenmesine izin ver
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
            const groups: Map<string, any> = new Map();
            let skippedCount = 0;

            const processChunk = (chunk: any[]) => {
                chunk.forEach((row) => {
                    if (!row || row.length < 20) return;

                    // D sütunu (index 3): HASTANE_ID
                    const rawHospitalId = row[3];
                    // AA sütunu (index 26): CALISMA_TARIHI - Test sayısı için bu dolu olmalı
                    let rawResultDate = row[26];
                    // Y sütunu (index 24): LABKABUL_TARIHI - TAT hesabı için
                    let rawLabDate = row[24];

                    // AA sütununda çalışma tarihi doluysa test sayılır
                    if (!rawHospitalId || !rawResultDate) { skippedCount++; return; }

                    const resDate = parseExcelDate(rawResultDate);
                    const labDate = parseExcelDate(rawLabDate) || resDate;

                    if (!resDate || !labDate) { skippedCount++; return; }

                    // TAT: Y (lab kabul) ile AA (çalışma tarihi) arası fark
                    const tatMin = (resDate.getTime() - labDate.getTime()) / (1000 * 60);
                    const dateStr = format(resDate, 'yyyy-MM-dd');
                    const hospitalId = String(rawHospitalId).trim();
                    // D sütunu 999 ise ASM
                    const isAsm = hospitalId === '999';

                    let derivedHospitalName = 'Bilinmeyen Kurum';
                    if (isAsm) {
                        // ASM için L sütunundan (index 11) ad alınır
                        derivedHospitalName = normalize(row[11]);
                    } else {
                        derivedHospitalName = hospitalDefinitions[hospitalId] || `Hastane (${hospitalId})`;
                    }

                    // H sütunu (index 7): TEST_ADI
                    const testName = normalize(row[7]);
                    // L sütunu (index 11): SERVIS_POL_ADI
                    const serviceName = normalize(row[11]);
                    // M sütunu (index 12): DOKTOR_BRANS
                    const branchName = normalize(row[12]);
                    // B sütunu (index 1): HASTA_ID - Benzersiz numune için
                    const patientId = String(row[1] || `temp-${Math.random()}`);
                    // E sütunu (index 4): ACIL - "E" ise acil
                    const isEmergency = String(row[4] || '').toUpperCase() === 'E';
                    // O sütunu (index 14): TEKRAR_SAYISI - 0'dan büyükse tekrar
                    const isRepeat = Number(row[14] || 0) > 0;
                    // Q sütunu (index 16): RET_NEDENI - Doluysa red
                    const rejectionReason = String(row[16] || '').trim();

                    // Composite key ile gruplama - deterministik ID oluştur
                    const key = `${dateStr}|${hospitalId}|${serviceName}|${testName}|${branchName}`;
                    // Deterministik ID - aynı key için her zaman aynı ID
                    const docId = key.replace(/\|/g, '_').replace(/[^a-zA-Z0-9_\u00C0-\u024F]/g, '').substring(0, 150);

                    if (!groups.has(key)) {
                        groups.set(key, {
                            id: docId,
                            date: dateStr, hospitalId, hospitalName: derivedHospitalName, isAsm,
                            service: serviceName, testName, branch: branchName,
                            totalTests: 0, emergencyCount: 0, patientIds: new Set(),
                            rejectedCount: 0, repeatCount: 0, totalTatMinutes: 0, tatCount: 0,
                            rejectionReasons: {}, uploadBatchId, createdAt: new Date().toISOString()
                        });
                    }

                    const record = groups.get(key);
                    record.totalTests++;
                    if (isEmergency) record.emergencyCount++;
                    record.patientIds.add(patientId);
                    if (isRepeat) record.repeatCount++;
                    if (rejectionReason) {
                        record.rejectedCount++;
                        record.rejectionReasons[rejectionReason] = (record.rejectionReasons[rejectionReason] || 0) + 1;
                    }
                    if (tatMin > 0) {
                        record.totalTatMinutes += tatMin;
                        record.tatCount++;
                    }
                });
            };

            const chunkSize = 5000;
            // Start from 1 to skip header row
            for (let i = 1; i < excelData.length; i += chunkSize) {
                const chunk = excelData.slice(i, i + chunkSize);
                processChunk(chunk);
                set({ processingProgress: { current: Math.min(i + chunkSize, excelData.length), total: excelData.length, status: 'Analiz Ediliyor...' } });
                await new Promise(r => setTimeout(r, 0));
            }

            const newRecords = Array.from(groups.values()).map(g => ({
                ...g,
                patientIds: Array.from(g.patientIds)
            }));

            // OPTİMİZE KÜMÜLATİF YAZMA: Mevcut verileri toplu çekmek yerine,
            // Her kayıt için tek tek kontrol edip güncelle
            const totalDocs = newRecords.length;
            set({ processingProgress: { current: 0, total: totalDocs, status: 'Buluta Yazılıyor...' } });

            const CHUNK_SIZE = 100; // Daha küçük chunk - her biri için getDoc yapılacak
            let processedCount = 0;

            for (let i = 0; i < totalDocs; i += CHUNK_SIZE) {
                const chunk = newRecords.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);

                // Her kayıt için mevcut veriyi kontrol et
                for (const newRec of chunk) {
                    const docRef = doc(db, 'analysis_results', newRec.id);
                    const existingDoc = await getDoc(docRef);

                    if (existingDoc.exists()) {
                        // Mevcut kayıt var - birleştir
                        const existing = existingDoc.data() as AggregatedRecord;
                        const mergedPatientIds = new Set([...existing.patientIds, ...newRec.patientIds]);
                        const mergedRejectionReasons: Record<string, number> = { ...existing.rejectionReasons };
                        Object.entries(newRec.rejectionReasons).forEach(([reason, count]) => {
                            mergedRejectionReasons[reason] = (mergedRejectionReasons[reason] || 0) + count;
                        });

                        batch.set(docRef, {
                            ...existing,
                            totalTests: existing.totalTests + newRec.totalTests,
                            emergencyCount: existing.emergencyCount + newRec.emergencyCount,
                            patientIds: Array.from(mergedPatientIds),
                            rejectedCount: existing.rejectedCount + newRec.rejectedCount,
                            repeatCount: existing.repeatCount + newRec.repeatCount,
                            totalTatMinutes: existing.totalTatMinutes + newRec.totalTatMinutes,
                            tatCount: existing.tatCount + newRec.tatCount,
                            rejectionReasons: mergedRejectionReasons,
                            uploadBatchId: newRec.uploadBatchId,
                            createdAt: new Date().toISOString()
                        });
                    } else {
                        // Yeni kayıt
                        batch.set(docRef, newRec);
                    }
                }

                await batch.commit();
                processedCount += chunk.length;
                set({ processingProgress: { current: processedCount, total: totalDocs, status: 'Buluta Yazılıyor...' } });
            }

            console.log(`Qore Analyse: ${totalDocs} kayıt buluta yüklendi (kümülatif). Atlanan satır: ${skippedCount}`);

            // Mevcut tarih filtresine göre verileri yeniden yükle
            const dateFilter = get().filters;
            if (dateFilter.showAll) {
                await get().loadAllDataFromFirestore();
            } else if (dateFilter.dateRange.from && dateFilter.dateRange.to) {
                await get().loadDataFromFirestore({ from: dateFilter.dateRange.from, to: dateFilter.dateRange.to });
            }

        } catch (error: any) {
            set({ error: "Hata: " + error.message });
            console.error("Excel işleme hatası:", error);
        } finally {
            set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
      },
      
      applyFilters: () => {
        const { aggregatedData, filters } = get();
        
        const filtered = aggregatedData.filter((item) => {
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
         set({ filters: newFilters });
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
          const snapshot = await getDocs(collection(db, 'analysis_results'));
          const total = snapshot.size;

          if (total === 0) {
            console.log('Qore Analyse: Silinecek veri yok.');
            set({ aggregatedData: [], filteredData: [] });
            return;
          }

          console.log(`Qore Analyse: ${total} kayıt silinecek.`);
          set({ processingProgress: { current: 0, total, status: `${total} Kayıt Siliniyor...` } });

          const CHUNK_SIZE = 450;
          let deletedCount = 0;

          for (let i = 0; i < total; i += CHUNK_SIZE) {
            const batch = writeBatch(db);
            const chunk = snapshot.docs.slice(i, i + CHUNK_SIZE);
            chunk.forEach(docSnap => batch.delete(docSnap.ref));
            await batch.commit();
            deletedCount += chunk.length;
            set({ processingProgress: { current: deletedCount, total, status: `${deletedCount}/${total} Kayıt Silindi` } });
            // UI güncellenmesi için bekle
            await new Promise(r => setTimeout(r, 10));
          }

          console.log(`Qore Analyse: ${deletedCount} kayıt başarıyla silindi.`);
          set({ aggregatedData: [], filteredData: [] });
        } catch (error: any) {
          console.error('Qore Analyse: Silme hatası:', error);
          set({ error: "Veri sıfırlama hatası: " + error.message });
        } finally {
          set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
      },
    })
  )
);
