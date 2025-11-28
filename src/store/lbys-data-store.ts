
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { collection, getDocs, setDoc, doc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { read, utils as XLSXUtils } from 'xlsx';
import { nanoid } from 'nanoid';
import { format, parseISO } from 'date-fns';
import { toDateFromAny } from '@/lib/time';

// --- TYPE DEFINITIONS ---

export interface HospitalDefinition {
  code: string;
  name: string;
}

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
  patientIds: Set<string>; // Use Set for automatic uniqueness
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
  processAndUploadExcel: (excelData: any[]) => Promise<void>;
  fetchDataByDateRange: (from: Date, to: Date) => Promise<void>;
  setFilters: (newFilters: Partial<FilterState>) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  loadHospitalDefinitions: () => Promise<void>;
  saveHospitalDefinition: (code: string, name: string) => Promise<void>;
}

// --- HELPERS ---
const normalize = (str: any) => str?.toString().toLocaleUpperCase('tr-TR').trim() || "BELİRTİLMEMİŞ";

// --- ZUSTAND STORE ---
export const useLbysDataStore = create<LbysStore>()(
  devtools(
    (set, get) => ({
      aggregatedData: [],
      filteredData: [],
      isLoading: true,
      processingProgress: { current: 0, total: 0 },
      error: null,
      filters: {
        dateRange: { from: undefined, to: undefined },
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
        try {
          await setDoc(doc(db, 'config_hospitals', code), { name });
          const current = get().hospitalDefinitions;
          set({ hospitalDefinitions: { ...current, [code]: name } });
          get().applyFilters();
        } catch (e) {
          console.error("Definition could not be saved", e);
        }
      },

      processAndUploadExcel: async (excelData) => {
        set({ isLoading: true, error: null, processingProgress: { current: 0, total: excelData.length } });
        const { hospitalDefinitions } = get();

        try {
          const groups: Map<string, Omit<AggregatedRecord, 'id'>> = new Map();
          
          const processChunk = (chunk: any[]) => {
            chunk.forEach((row, rowIndex) => {
                const calismaTarihiRaw = row['CALISMA_TARIHI']; // Col AA
                const calismaTarihi = toDateFromAny(calismaTarihiRaw);
                if (!calismaTarihi) return;

                const dateStr = format(calismaTarihi, 'yyyy-MM-dd');
                const hastaneId = String(row['HASTANE_ID'] || '').trim(); // Col D
                const isAsm = hastaneId === '999';
                
                let derivedHospitalName = 'Bilinmeyen Kurum';
                if (isAsm) {
                    derivedHospitalName = normalize(row['SERVIS_POL_ADI']); // Col L
                } else {
                    derivedHospitalName = hospitalDefinitions[hastaneId] || `Hastane (${hastaneId})`;
                }

                const testName = normalize(row['TEST_ADI']); // Col H
                const serviceName = normalize(row['SERVIS_POL_ADI']); // Col L
                const hastaId = String(row['HASTA_ID'] || `no-id-${rowIndex}`); // Col B
                const isEmergency = String(row['ACIL'] || '').toUpperCase() === 'E'; // Col E
                const isRepeat = Number(row['TEKRAR_SAYISI'] || 0) > 0; // Col O
                const rejectionReason = String(row['RET_NEDENI'] || '').trim(); // Col Q
                const branchName = normalize(row['DOKTOR_BRANS']);

                const key = `${dateStr}|${hastaneId}|${serviceName}|${testName}|${branchName}`;

                if (!groups.has(key)) {
                    groups.set(key, {
                        date: dateStr, hospitalId: hastaneId, hospitalName: derivedHospitalName, isAsm,
                        service: serviceName, testName,
                        totalTests: 0, emergencyCount: 0, patientIds: new Set(),
                        rejectedCount: 0, repeatCount: 0, totalTatMinutes: 0, tatCount: 0, rejectionReasons: {},
                        branch: branchName
                    });
                }
                
                const record = groups.get(key)!;
                record.totalTests++;
                if (isEmergency) record.emergencyCount++;
                if (hastaId) record.patientIds.add(hastaId);
                if (isRepeat) record.repeatCount++;
                if (rejectionReason) {
                    record.rejectedCount++;
                    record.rejectionReasons[rejectionReason] = (record.rejectionReasons[rejectionReason] || 0) + 1;
                }

                const labKabul = toDateFromAny(row['LABKABUL_TARIHI']); // Col Y
                if (labKabul && calismaTarihi > labKabul) {
                    const diff = (calismaTarihi.getTime() - labKabul.getTime()) / (1000 * 60);
                    if (diff > 0) {
                        record.totalTatMinutes += diff;
                        record.tatCount++;
                    }
                }
            });
          };

          const chunkSize = 2000;
          for (let i = 0; i < excelData.length; i += chunkSize) {
            const chunk = excelData.slice(i, i + chunkSize);
            processChunk(chunk);
            set({ processingProgress: { current: i + chunk.length, total: excelData.length } });
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          
          const finalAggregatedData = Array.from(groups.values()).map(g => ({
              ...g,
              id: nanoid(),
          }));

          set({ aggregatedData: finalAggregatedData, filteredData: finalAggregatedData });
          get().applyFilters();

        } catch (error: any) {
          set({ error: "Dosya işlenirken bir hata oluştu: " + error.message });
        } finally {
          set({ isLoading: false, processingProgress: { current: 0, total: 0 } });
        }
      },
      
      fetchDataByDateRange: async (from, to) => { /* This is now handled by processing file directly */ },

      applyFilters: () => {
        const { aggregatedData, filters } = get();
        const { from, to } = filters.dateRange;

        const filtered = aggregatedData.filter((item) => {
            const itemDate = parseISO(item.date);
            if (from && to && (itemDate < from || itemDate > to)) return false;

            const hospitalMatch = filters.selectedHospitals.length === 0 || (!item.isAsm && filters.selectedHospitals.includes(item.hospitalName));
            const asmMatch = filters.selectedAsms.length === 0 || (item.isAsm && filters.selectedAsms.includes(item.hospitalName));
            const serviceMatch = filters.selectedServices.length === 0 || filters.selectedServices.includes(item.service);
            const testMatch = filters.selectedTests.length === 0 || filters.selectedTests.includes(item.testName);
            const branchMatch = filters.selectedBranches.length === 0 || filters.selectedBranches.includes(item.branch);
            
            if (filters.selectedHospitals.length > 0 && filters.selectedAsms.length > 0) {
              if(!hospitalMatch && !asmMatch) return false;
            } else if (filters.selectedHospitals.length > 0) {
              if(!hospitalMatch) return false;
            } else if (filters.selectedAsms.length > 0) {
              if(!asmMatch) return false;
            }

            return serviceMatch && testMatch && branchMatch;
        });

        set({ filteredData: filtered });
      },
      
      setFilters: (newFilters) => {
        set(state => ({ filters: { ...state.filters, ...newFilters } }));
        get().applyFilters();
      },

      resetFilters: () => {
          set({ 
              filters: { 
                  dateRange: { from: undefined, to: undefined }, 
                  selectedHospitals: [], 
                  selectedAsms: [],
                  selectedServices: [], 
                  selectedTests: [], 
                  selectedBranches: [],
              } 
          });
          get().applyFilters();
      }
    })
  )
);
