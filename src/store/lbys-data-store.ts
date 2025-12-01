'use client';

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { collection, getDocs, writeBatch, doc, query, setDoc } from 'firebase/firestore';
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
  patientIds: string[]; 
  rejectedCount: number;
  repeatCount: number;
  totalTatMinutes: number;
  tatCount: number;
  rejectionReasons: Record<string, number>;
  branch: string;
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
}

interface LbysStore {
  aggregatedData: AggregatedRecord[];
  filteredData: AggregatedRecord[];
  filters: FilterState;
  isLoading: boolean;
  processingProgress: { current: number; total: number; status: string };
  hospitalDefinitions: Record<string, string>;
  error: string | null;

  loadDataFromFirestore: () => Promise<void>;
  processAndUploadExcel: (excelData: any[]) => Promise<void>;
  setFilters: (newFilters: Partial<FilterState>) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  loadHospitalDefinitions: () => Promise<void>;
  saveHospitalDefinition: (code: string, name: string) => Promise<void>;
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

      loadDataFromFirestore: async () => {
        set({ isLoading: true, processingProgress: { current: 0, total: 0, status: 'Veriler Buluttan İndiriliyor...' } });
        try {
            const q = query(collection(db, 'analysis_results'));
            const querySnapshot = await getDocs(q);
            const fetchedData: AggregatedRecord[] = [];
            
            querySnapshot.forEach((doc) => {
                fetchedData.push(doc.data() as AggregatedRecord);
            });

            set({ aggregatedData: fetchedData });
            get().applyFilters();
            console.log(`Qore Analyse: Firestore'dan ${fetchedData.length} kayıt indirildi.`);
        } catch (error: any) {
            set({ error: "Veri indirme hatası: " + error.message });
        } finally {
            set({ isLoading: false });
        }
      },

      processAndUploadExcel: async (excelData) => {
        console.log("Qore Analyse: Veri işleme v2 başlatıldı...");
        set({ isLoading: true, error: null, processingProgress: { current: 0, total: excelData.length, status: 'Analiz Ediliyor...' } });
        const { hospitalDefinitions } = get();
        const uploadBatchId = nanoid();

        try {
            const groups: Map<string, any> = new Map();
            let skippedCount = 0;

            if (excelData.length > 1) {
                console.log("Debug - İlk Satır İndeksleri:", {
                    Index21_ISTEM: excelData[1][21],
                    Index22_KAYIT: excelData[1][22],
                    Index24_LAB: excelData[1][24],
                    Index26_SONUC: excelData[1][26]
                });
            }

            const processChunk = (chunk: any[]) => {
                chunk.forEach((row) => {
                    if (!row || row.length < 20) return;

                    const rawHospitalId = row[3];
                    let rawResultDate = row[26] || row[22]; 
                    let rawLabDate = row[24] || row[21]; 

                    if (!rawHospitalId || !rawResultDate) { skippedCount++; return; }

                    const resDate = parseExcelDate(rawResultDate);
                    const labDate = parseExcelDate(rawLabDate) || resDate; 

                    if (!resDate || !labDate) { skippedCount++; return; }

                    const tatMin = (resDate.getTime() - labDate.getTime()) / (1000 * 60);
                    const dateStr = format(resDate, 'yyyy-MM-dd');
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

                    const key = `${dateStr}|${hospitalId}|${serviceName}|${testName}|${branchName}`;
                    
                    if (!groups.has(key)) {
                        groups.set(key, {
                            id: nanoid(),
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
            for (let i = 1; i < excelData.length; i += chunkSize) {
                const chunk = excelData.slice(i, i + chunkSize);
                processChunk(chunk);
                set({ processingProgress: { current: Math.min(i + chunkSize, excelData.length), total: excelData.length, status: 'Analiz Ediliyor...' } });
                await new Promise(r => setTimeout(r, 0));
            }
            
            const recordsToWrite = Array.from(groups.values()).map(g => ({
                ...g,
                patientIds: Array.from(g.patientIds)
            }));

            const CHUNK_SIZE = 450;
            const totalDocs = recordsToWrite.length;
            set({ processingProgress: { current: 0, total: totalDocs, status: 'Buluta Yazılıyor...' } });

            for (let i = 0; i < totalDocs; i += CHUNK_SIZE) {
                const batch = writeBatch(db);
                const chunk = recordsToWrite.slice(i, i + CHUNK_SIZE);
                chunk.forEach((docData) => {
                    const docRef = doc(db, 'analysis_results', docData.id);
                    batch.set(docRef, docData);
                });
                await batch.commit();
                set({ processingProgress: { current: Math.min(i + CHUNK_SIZE, totalDocs), total: totalDocs, status: 'Buluta Yazılıyor...' } });
            }

            console.log(`Qore Analyse: ${totalDocs} kayıt buluta yüklendi.`);
            
            set(state => ({ aggregatedData: [...state.aggregatedData, ...recordsToWrite] }));
            get().applyFilters();

        } catch (error: any) {
            set({ error: "Hata: " + error.message });
        } finally {
            set({ isLoading: false, processingProgress: { current: 0, total: 0, status: '' } });
        }
      },
      
      applyFilters: () => {
        const { aggregatedData, filters } = get();
        const { from, to } = filters.dateRange;

        const filtered = aggregatedData.filter((item) => {
            const itemDate = new Date(item.date);
            if (from && to && (itemDate < from || itemDate > to)) return false;

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
         set({ filters: { dateRange: { from: lastWeek, to: today }, selectedHospitals: [], selectedAsms: [], selectedServices: [], selectedTests: [], selectedBranches: [] } });
         get().applyFilters();
      }
    })
  )
);
