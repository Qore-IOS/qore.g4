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

  processAndUploadExcel: (excelData: any[]) => Promise<void>;
  setFilters: (newFilters: Partial<FilterState>) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  loadHospitalDefinitions: () => Promise<void>;
  saveHospitalDefinition: (code: string, name: string) => Promise<void>;
}

// --- HELPERS ---
const normalize = (str: any): string => str?.toString().toLocaleUpperCase('tr-TR').trim() || "BELİRTİLMEMİŞ";

// Excel Serial Date (45988.54) -> JS Date çevirici
const parseExcelDate = (input: any): Date | null => {
  if (!input) return null;
  
  // Eğer input zaten sayı ise (Excel Serial Number)
  if (typeof input === 'number') {
    // Excel tarihleri 1900'den başlar, JS 1970. Aradaki fark ~25569 gün.
    // 86400 * 1000 = Bir günün milisaniyesi
    return new Date(Math.round((input - 25569) * 86400 * 1000));
  }

  // Eğer string ise ('2025-11-27 13:00')
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
          console.error("Definitions error", e);
        }
      },

      saveHospitalDefinition: async (code, name) => {
        if (!code || !name) return;
        try {
            await setDoc(doc(db, 'config_hospitals', code), { name });
            const current = get().hospitalDefinitions;
            set({ hospitalDefinitions: { ...current, [code]: name } });
            // Veriyi de güncelle
            const updatedData = get().aggregatedData.map(d => 
                (!d.isAsm && d.hospitalId === code) ? { ...d, hospitalName: name } : d
            );
            set({ aggregatedData: updatedData });
            get().applyFilters();
        } catch (e) { console.error(e); }
      },

      processAndUploadExcel: async (excelData) => {
        console.log("Qore Analyse: Veri işleme v2 başlatıldı...");
        set({ isLoading: true, error: null, processingProgress: { current: 0, total: excelData.length } });
        const { hospitalDefinitions } = get();

        try {
            const groups: Map<string, Omit<AggregatedRecord, 'id' | 'patientIds'> & { patientIds: Set<string> }> = new Map();
            let skippedCount = 0;

            // Debug için ilk satırı logla
            if (excelData.length > 1) {
                console.log("Debug - İlk Satır İndeksleri:", {
                    Index21_ISTEM: excelData[1][21],
                    Index22_KAYIT: excelData[1][22],
                    Index24_LAB: excelData[1][24],
                    Index26_SONUC: excelData[1][26]
                });
            }

            const processChunk = (chunk: any[]) => {
                chunk.forEach((row, i) => {
                    if (!row || row.length < 20) return; // Eksik satırları atla

                    // 1. Hastane ID (Index 3)
                    const rawHospitalId = row[3];
                    if (!rawHospitalId) { skippedCount++; return; }

                    // 2. Tarihleri Al (ESNEK YAPI)
                    let rawResultDate = row[26]; 
                    if (!rawResultDate) rawResultDate = row[22]; // YEDEK: Kayıt Tarihi

                    let rawLabDate = row[24];
                    if (!rawLabDate) rawLabDate = row[21]; // YEDEK: İstem Tarihi

                    if (!rawResultDate) { skippedCount++; return; }

                    // 3. Tarih Formatlama (Excel Sayısal veya String)
                    const resDate = parseExcelDate(rawResultDate);
                    const labDate = parseExcelDate(rawLabDate) || resDate; 

                    if (!resDate || !labDate) { skippedCount++; return; }

                    const tatMin = (resDate.getTime() - labDate.getTime()) / (1000 * 60);
                    const dateStr = format(resDate, 'yyyy-MM-dd');

                    // 4. Diğer Veriler
                    const hospitalId = String(rawHospitalId).trim();
                    const isAsm = hospitalId === '999';
                    
                    let derivedHospitalName = 'Bilinmeyen Kurum';
                    if (isAsm) {
                        derivedHospitalName = normalize(row[11]); // L Sütunu
                    } else {
                        derivedHospitalName = hospitalDefinitions[hospitalId] || `Hastane (${hospitalId})`;
                    }

                    const testName = normalize(row[7]);
                    const serviceName = normalize(row[11]);
                    const patientId = String(row[1] || `temp-${Math.random()}`);
                    const isEmergency = String(row[4] || '').toUpperCase() === 'E';
                    const isRepeat = Number(row[14] || 0) > 0;
                    const rejectionReason = String(row[16] || '').trim();
                    const branchName = normalize(row[12]);

                    const key = `${dateStr}|${hospitalId}|${serviceName}|${testName}|${branchName}`;
                    
                    if (!groups.has(key)) {
                        groups.set(key, {
                            date: dateStr, hospitalId, hospitalName: derivedHospitalName, isAsm,
                            service: serviceName, testName, branch: branchName,
                            totalTests: 0, emergencyCount: 0, patientIds: new Set(),
                            rejectedCount: 0, repeatCount: 0, totalTatMinutes: 0, tatCount: 0, rejectionReasons: {},
                        });
                    }
                    
                    const record = groups.get(key)!;
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
                set({ processingProgress: { current: Math.min(i + chunkSize, excelData.length), total: excelData.length } });
                await new Promise(r => setTimeout(r, 0));
            }
            
            const finalData = Array.from(groups.values()).map(g => ({ ...g, id: nanoid() }));
            
            set({ aggregatedData: finalData });
            get().applyFilters();
            
            console.log(`Qore Analyse: ${finalData.length} grup oluşturuldu. Kaynak satırların ${skippedCount} tanesi işlenemedi (Tarih/ID eksik).`);

        } catch (error: any) {
            set({ error: "İşlem hatası: " + error.message });
        } finally {
            set({ isLoading: false, processingProgress: { current: 0, total: 0 } });
        }
      },
      
    applyFilters: () => {
        const { aggregatedData, filters } = get();
        const { from, to } = filters.dateRange;

        const filtered = aggregatedData.filter((item) => {
            const itemDate = new Date(item.date);
            if (from && to && (itemDate < from || itemDate > to)) return false;

            const hospitalMatch = filters.selectedHospitals.length === 0 || (!item.isAsm && filters.selectedHospitals.includes(item.hospitalName));
            const asmMatch = filters.selectedAsms.length === 0 || (item.isAsm && filters.selectedAsms.includes(item.hospitalName));
            
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
  }))
);
