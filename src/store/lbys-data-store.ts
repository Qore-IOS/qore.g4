
'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { collection, getDocs, setDoc, doc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { nanoid } from 'nanoid';
import { format, parse, parseISO, isValid } from 'date-fns';
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
          // Re-process names in existing data
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
        set({ isLoading: true, error: null, processingProgress: { current: 0, total: excelData.length } });
        const { hospitalDefinitions } = get();

        try {
          const groups: Map<string, Omit<AggregatedRecord, 'id' | 'patientIds'> & { patientIds: Set<string> }> = new Map();
          
          const processChunk = (chunk: any[]) => {
            chunk.forEach((row) => {
                if (!row || row.length < 27) return;

                const resultDateRaw = row[26];
                if (!resultDateRaw) return;

                const resultDate = toDateFromAny(resultDateRaw);
                if (!resultDate || !isValid(resultDate)) return;

                const dateStr = format(resultDate, 'yyyy-MM-dd');

                const hospitalId = String(row[3] || '').trim();
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
                const labDate = toDateFromAny(row[24]);
                
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
                
                if (labDate && isValid(labDate) && resultDate > labDate) {
                    const diff = (resultDate.getTime() - labDate.getTime()) / (1000 * 60);
                    if (diff > 0) {
                        record.totalTatMinutes += diff;
                        record.tatCount++;
                    }
                }
            });
          };

          const chunkSize = 2000;
          for (let i = 1; i < excelData.length; i += chunkSize) {
            const chunk = excelData.slice(i, i + chunkSize);
            processChunk(chunk);
            set({ processingProgress: { current: i + chunk.length, total: excelData.length } });
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          
          const finalAggregatedData = Array.from(groups.values()).map(g => ({ ...g, id: nanoid() }));

          set({ aggregatedData: finalAggregatedData });
          get().applyFilters();

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
            const itemDate = parseISO(item.date);
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
