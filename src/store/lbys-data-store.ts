
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { nanoid } from 'nanoid';
import { format } from 'date-fns';

// --- TYPE DEFINITIONS ---

export interface AggregatedRecord {
  id: string; // Composite key: date|hospitalId|service|testName
  date: string; // YYYY-MM-DD
  hospitalId: string; // HASTANE_ID (Raw)
  hospitalName: string; // Mapped Name or ASM Name
  isAsm: boolean; // ID == 999
  service: string;
  testName: string;
  totalTests: number;
  emergencyCount: number; // ACIL == 'E' sayısı
  patientIds: Set<string>; 
  rejectedCount: number;
  repeatCount: number;
  totalTatMinutes: number;
  tatCount: number;
  rejectionReasons: Record<string, number>;
  branch: string;
}

export interface FilterState {
  dateRange: { from: Date | undefined; to: Date | undefined };
  selectedHospitals: string[];
  selectedAsms: string[];
  selectedServices: string[];
  selectedTests: string[];
  selectedBranches: string[];
}

interface LbysStore {
  aggregatedData: AggregatedRecord[];
  filteredData: AggregatedRecord[];
  filters: FilterState;
  isLoading: boolean;
  processingProgress: { current: number; total: number };
  hospitalDefinitions: Record<string, string>;
  error: string | null;

  // Actions
  processAndUploadExcel: (excelData: any[][]) => Promise<void>;
  setFilters: (newFilters: Partial<FilterState>) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  loadHospitalDefinitions: () => Promise<void>;
  saveHospitalDefinition: (code: string, name: string) => Promise<void>;
}

// --- HELPERS ---
const normalize = (str: any): string => str?.toString().toLocaleUpperCase('tr-TR').trim() || "BELİRTİLMEMİŞ";

// --- ZUSTAND STORE ---
export const useLbysDataStore = create<LbysStore>()(
  devtools(
    (set, get) => ({
      aggregatedData: [],
      filteredData: [],
      isLoading: false,
      processingProgress: { current: 0, total: 0 },
      error: null,
      filters: {
        dateRange: { from: new Date(new Date().setDate(new Date().getDate() - 7)), to: new Date() },
        selectedHospitals: [],
        selectedAsms: [],
        selectedServices: [],
        selectedTests: [],
        selectedBranches: [],
      },
      hospitalDefinitions: {},

      loadHospitalDefinitions: async () => {
        try {
          const snap = await getDocs(collection(db, 'config_hospitals'));
          const defs: Record<string, string> = {};
          snap.forEach(d => { defs[d.id] = d.data().name });
          set({ hospitalDefinitions: defs });
        } catch (e) {
          console.error("Definitions could not be loaded", e);
        }
      },

      saveHospitalDefinition: async (code, name) => {
        if (!code || !name) return;
        try {
          await setDoc(doc(db, 'config_hospitals', code), { name });
          const current = get().hospitalDefinitions;
          set({ hospitalDefinitions: { ...current, [code]: name } });
          const currentData = get().aggregatedData;
          const updatedData = currentData.map(d => {
              if (!d.isAsm && d.hospitalId === code) {
                  return { ...d, hospitalName: name };
              }
              return d;
          });
          set({ aggregatedData: updatedData });
          get().applyFilters();
        } catch (e) {
          console.error("Definition could not be saved", e);
        }
      },

    processAndUploadExcel: async (excelData) => {
        console.log("Qore Analyse: Veri işleme başladı...");
        set({ isLoading: true, error: null, processingProgress: { current: 0, total: excelData.length } });
        const { hospitalDefinitions } = get();

        // İLK SATIR KONTROLÜ (Console'dan bak: Sütunlar kaymış mı?)
        if (excelData.length > 1) {
            console.log("Örnek Ham Satır (İlk Veri Satırı):", excelData[1]);
            console.log("Beklenen İndeksler -> D(3): HASTANE_ID, AA(26): CALISMA_TARIHI");
        }

        try {
            const groups: Map<string, Omit<AggregatedRecord, 'id' | 'patientIds'> & { patientIds: Set<string> }> = new Map();
            let skippedCount = 0;

            const processChunk = (chunk: any[]) => {
                chunk.forEach((row, i) => {
                    const rowIndex = (get().processingProgress.current) + i;
                    if (!row || row.length < 27) {
                        skippedCount++;
                        return;
                    }
                    
                    const rawHospitalId = row[3];
                    const rawResultDate = row[26];
                    const rawLabDate = row[24];
                    
                    if (!rawHospitalId || !rawResultDate) {
                        if (rowIndex < 5) console.warn(`Satır ${rowIndex+1} Atlandı: Hastane ID veya Sonuç Tarihi eksik.`);
                        skippedCount++;
                        return;
                    }

                    const labDateStr = String(rawLabDate).replace(' ', 'T');
                    const resDateStr = String(rawResultDate).replace(' ', 'T');
                    
                    const labDate = new Date(labDateStr);
                    const resDate = new Date(resDateStr);

                    if (isNaN(labDate.getTime()) || isNaN(resDate.getTime())) {
                       if (rowIndex < 5) console.warn(`Satır ${rowIndex+1} Tarih Hatası:`, rawLabDate, rawResultDate);
                       skippedCount++;
                       return;
                    }

                    const dateStr = format(resDate, 'yyyy-MM-dd');
                    const tatMin = (resDate.getTime() - labDate.getTime()) / (1000 * 60);
                    
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
                    const patientId = String(row[1] || `no-id-${Math.random()}`);
                    const isEmergency = String(row[4] || '').toUpperCase() === 'E';
                    const isRepeat = Number(row[14] || 0) > 0;
                    const rejectionReason = String(row[16] || '').trim();
                    const branchName = normalize(row[12]);

                    const key = `${dateStr}|${hospitalId}|${serviceName}|${testName}|${branchName}`;
                    
                    if (!groups.has(key)) {
                        groups.set(key, {
                            date: dateStr, hospitalId, hospitalName: derivedHospitalName, isAsm,
                            service: serviceName, testName,
                            totalTests: 0, emergencyCount: 0, patientIds: new Set(),
                            rejectedCount: 0, repeatCount: 0, totalTatMinutes: 0, tatCount: 0, rejectionReasons: {},
                            branch: branchName
                        });
                    }
                    
                    const record = groups.get(key)!;
                    record.totalTests++;
                    if (isEmergency) record.emergencyCount++;
                    if (patientId) record.patientIds.add(patientId);
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

            const chunkSize = 2000;
            for (let i = 1; i < excelData.length; i += chunkSize) {
                const chunk = excelData.slice(i, i + chunkSize);
                processChunk(chunk);
                set({ processingProgress: { current: i + chunk.length - 1, total: excelData.length } });
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            
            const finalAggregatedData = Array.from(groups.values()).map(g => ({ ...g, id: nanoid() }));
            
            set({ aggregatedData: finalAggregatedData });
            get().applyFilters();
            
            console.log(`Qore Analyse Sonuç: Toplam ${excelData.length - 1} satırdan ${finalAggregatedData.length} tanesi işlendi. ${skippedCount} satır atlandı.`);

        } catch (error: any) {
            set({ error: "Dosya işlenirken bir hata oluştu: " + error.message });
        } finally {
            set({ isLoading: false, processingProgress: { current: 0, total: 0 } });
        }
    },
      
    applyFilters: () => {
        const { aggregatedData, filters } = get();
        const { from, to } = filters.dateRange;

        const filtered = aggregatedData.filter((item) => {
            const itemDate = new Date(item.date); // Correctly parse date string
            if (from && to && (itemDate < from || itemDate > to)) return false;

            const hospitalMatch = filters.selectedHospitals.length === 0 || (!item.isAsm && filters.selectedHospitals.includes(item.hospitalName));
            const asmMatch = filters.selectedAsms.length === 0 || (item.isAsm && filters.selectedAsms.includes(item.hospitalName));
            const serviceMatch = filters.selectedServices.length === 0 || filters.selectedServices.includes(item.service);
            const testMatch = filters.selectedTests.length === 0 || filters.selectedTests.includes(item.testName);
            const branchMatch = filters.selectedBranches.length === 0 || filters.selectedBranches.includes(item.branch);
            
            let locationMatch = true;
            if (filters.selectedHospitals.length > 0 && filters.selectedAsms.length > 0) {
              locationMatch = hospitalMatch || asmMatch;
            } else if (filters.selectedHospitals.length > 0) {
              locationMatch = hospitalMatch;
            } else if (filters.selectedAsms.length > 0) {
              locationMatch = asmMatch;
            }

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
        set({ 
            filters: { 
                dateRange: { from: lastWeek, to: today }, 
                selectedHospitals: [], 
                selectedServices: [], 
                selectedTests: [], 
                selectedBranches: [],
                selectedAsms: [],
            } 
        });
        get().applyFilters();
    }
  }))
);
