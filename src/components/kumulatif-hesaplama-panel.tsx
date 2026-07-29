'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Archive,
  CheckCircle,
  Database,
  Download,
  FileText,
  History,
  Save,
  Loader2,
  Network,
  Plus,
  Trash2,
  X,
  XCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { addDoc, collection, doc, getDocs, increment, orderBy, serverTimestamp, writeBatch, getDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { db, storage } from '@/lib/firebase';
import { scopedQuery } from '@/lib/firestore-helpers';
import { labDonemineYaz } from '@/lib/lab-period/kaydet';
import type { Hospital } from '@/lib/types';
import { exportDataToExcel } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseCumulativePdfFiles, type CumulativeRow } from '@/lib/qore-hesaplama/parse-cumulative';
import { parseCumulativeTxtFiles } from '@/lib/qore-hesaplama/parse-cumulative-txt';
import { aggregateCumulative } from '@/lib/qore-hesaplama/aggregate';
import { applyCumulativeAutoSum } from '@/lib/qore-hesaplama/auto-sum-definitions';
import { normalizeTestName } from '@/lib/qore-hesaplama/test-name-matcher';
import { ALL_FILTER_VALUE, type CalculationProductRow, useQoreCalculationProducts } from '@/hooks/useQoreCalculationProducts';
import { useTestAutoSumDefinitions } from '@/hooks/useTestAutoSumDefinitions';
import { buildCalculationPeriod, deleteExpiredPendingCalculationFiles, loadPendingCalculationFiles, markPendingCalculationFilesConsumed, pendingPayloadToFile, type PendingCalculationFileDoc } from '@/lib/qore-hesaplama/pending-calculation-files';
import {
  C, AC, useMode, ClayPage, RaporHead, Card, SoftBtn, PrimaryBtn,
  Dropdown, FieldLabel, UploadZone, EmptyBlock,
} from '@/components/raporlama/rapor-kit';

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(0, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isTxt = (f: File) => f.type.startsWith('text/') || /\.(txt|csv)$/i.test(f.name);
const calculateEfficiency = (routine?: number, total?: number) => total ? ((routine || 0) / total) * 100 : null;

export default function KumulatifHesaplamaPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const mode = useMode();
  const mobile = mode === 'mobile';
  const { currentCompanyId, currentUser, currentUserProfile, isSuperAdmin } = useAuth();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loadingHospitals, setLoadingHospitals] = useState(true);
  const [hospitalId, setHospitalId] = useState('');
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());

  const [files, setFiles] = useState<File[]>([]);
  const [pendingDocs, setPendingDocs] = useState<PendingCalculationFileDoc[]>([]);
  const [loadedPendingIds, setLoadedPendingIds] = useState<string[]>([]);
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSavingHistory, setIsSavingHistory] = useState(false);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [rows, setRows] = useState<Array<CalculationProductRow & CumulativeRow & { matchedTests: string[] }>>([]);
  const [unmatchedTests, setUnmatchedTests] = useState<CumulativeRow[]>([]);
  const [brandFilter, setBrandFilter] = useState(ALL_FILTER_VALUE);
  const [productGroupFilter, setProductGroupFilter] = useState(ALL_FILTER_VALUE);

  // Manuel birleştirme durumu
  const [anchor, setAnchor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const combineMode = anchor !== null;

  const hospitalName = useMemo(
    () => hospitals.find((h) => h.id === hospitalId)?.name || '',
    [hospitals, hospitalId]
  );

  const { definitions: autoSumDefinitions } = useTestAutoSumDefinitions();

  const { rows: scopedProducts, brandOptions, productGroupOptions, isLoadingScope, scopeError, scopeLabel, scopedLabIds, selectedHospital } = useQoreCalculationProducts({
    hospitalId,
    hospitals,
    currentCompanyId,
    isSuperAdmin,
  });

  const filteredProducts = useMemo(() => scopedProducts.filter((product) => (
    (brandFilter === ALL_FILTER_VALUE || product.marka === brandFilter) &&
    (productGroupFilter === ALL_FILTER_VALUE || product.urunGrubu === productGroupFilter)
  )), [scopedProducts, brandFilter, productGroupFilter]);

  const selectedPeriod = useMemo(() => buildCalculationPeriod(month, year), [month, year]);

  const [counterFile, setCounterFile] = useState<File | null>(null);
  const counterFileInputRef = useRef<HTMLInputElement>(null);

  const [dbCounterFileName, setDbCounterFileName] = useState<string | null>(null);
  const [dbCounterData, setDbCounterData] = useState<any | null>(null);
  const [dbCounterRecordId, setDbCounterRecordId] = useState<string | null>(null);
  const [isLoadingCounter, setIsLoadingCounter] = useState(false);
  const [isSavingCounter, setIsSavingCounter] = useState(false);
  const [lastLoadedKey, setLastLoadedKey] = useState<string>('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const hasCounterProducts = useMemo(() => {
    return filteredProducts.some(p => p.counterEnabled || p.counterPlusEnabled);
  }, [filteredProducts]);

  const cleanTurkishChars = (str: string) => {
    return str
      .replace(/İ/g, 'i')
      .replace(/ı/g, 'i')
      .replace(/I/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/Ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/Ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/Ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/Ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/Ç/g, 'c')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  };

  const normalizeSutCode = (val: string) => {
    return val.trim().toUpperCase().replace(/^L/, '');
  };

  const parseCounterExcelForAllSheets = useCallback((file: File): Promise<{ [sheetName: string]: { [sutKodu: string]: number } }> => {
    console.log('[CounterDebug] parseCounterExcelForAllSheets triggered for file:', file.name);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          import('xlsx').then(XLSX => {
            const data = event.target?.result;
            const workbook = XLSX.read(data, { type: 'array' });
            
            const parsedData: { [sheetName: string]: { [sutKodu: string]: number } } = {};
            
            const monthAbbrs = ['oca', 'sub', 'mar', 'nis', 'may', 'haz', 'tem', 'agu', 'eyl', 'eki', 'kas', 'ara'];
            const monthFull = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
            const targetAbbr = monthAbbrs[month];
            const targetFull = monthFull[month];
            const shortYear = String(year).slice(-2);

            const engMonthAbbrs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const engMonthFull = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
            const engAbbr = engMonthAbbrs[month];
            const engFull = engMonthFull[month];

            const expectedValues = [
              targetAbbr,
              targetFull,
              `${targetAbbr}${shortYear}`,
              `${targetAbbr}${year}`,
              `${targetFull}${shortYear}`,
              `${targetFull}${year}`,
              engAbbr,
              engFull,
              `${engAbbr}${shortYear}`,
              `${engAbbr}${year}`,
              `${engFull}${shortYear}`,
              `${engFull}${year}`
            ];
            console.log('[CounterDebug] Month/Year match parameters:', {
              month,
              year,
              targetAbbr,
              targetFull,
              shortYear,
              expectedValues
            });
            
            const matchesDate = (str: string, targetMonth: number, targetYear: number) => {
              const clean = str.trim();
              const parts = clean.split(/[\.\-\/]/);
              const targetMonthNum = targetMonth + 1; // 1-indexed
              const targetYearShort = targetYear % 100;
              
              if (parts.length === 3) {
                const p0 = parseInt(parts[0], 10);
                const p1 = parseInt(parts[1], 10);
                const p2 = parseInt(parts[2], 10);
                
                if (p0 === targetYear && p1 === targetMonthNum) return true;
                if (p2 === targetYear && p1 === targetMonthNum) return true;
                if (p2 === targetYearShort && p1 === targetMonthNum) return true;
                if (p2 === targetYear && p0 === targetMonthNum) return true;
              } else if (parts.length === 2) {
                const p0 = parseInt(parts[0], 10);
                const p1 = parseInt(parts[1], 10);
                
                if (p0 === targetMonthNum && p1 === targetYear) return true;
                if (p0 === targetMonthNum && p1 === targetYearShort) return true;
                if (p0 === targetYear && p1 === targetMonthNum) return true;
                if (p0 === targetYearShort && p1 === targetMonthNum) return true;
              }
              return false;
            };

            const isPeriodCell = (val: any) => {
              if (val === undefined || val === null) return false;
              
              if (typeof val === 'number') {
                if (val >= 35000 && val <= 60000) {
                  const jsDate = new Date(Math.round((val - 25569) * 86400 * 1000));
                  const m = jsDate.getUTCMonth();
                  const y = jsDate.getUTCFullYear();
                  if (m === month && y === year) return true;
                  
                  const localM = jsDate.getMonth();
                  const localY = jsDate.getFullYear();
                  if (localM === month && localY === year) return true;
                }
              }
              
              const strVal = String(val);
              const cleaned = cleanTurkishChars(strVal);
              if (expectedValues.includes(cleaned)) return true;
              if (matchesDate(strVal, month, year)) return true;
              
              return false;
            };

            workbook.SheetNames.forEach((sheetName) => {
              const worksheet = workbook.Sheets[sheetName];
              const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
              console.log(`[CounterDebug] Sheet: "${sheetName}", Total rows: ${rows.length}`);
              
              if (rows.length === 0) return;
              
              // Detect sutKoduColIndex dynamically (looking at columns 0 to 10 across the first 50 rows)
              let sutKoduColIndex = 3; // Default to Column D (index 3)
              const colScores = new Array(11).fill(0);
              const sutRegex = /^([lL]?\d{5,8})$/;
              const scanRowsLimit = Math.min(rows.length, 50);
              
              for (let r = 0; r < scanRowsLimit; r++) {
                const row = rows[r];
                if (!Array.isArray(row)) continue;
                for (let c = 0; c <= Math.min(row.length - 1, 10); c++) {
                  const valStr = String(row[c] || '').trim();
                  if (sutRegex.test(valStr)) {
                    colScores[c]++;
                  }
                }
              }
              
              let maxScore = 0;
              let bestColIndex = -1;
              for (let c = 0; c < colScores.length; c++) {
                if (colScores[c] > maxScore) {
                  maxScore = colScores[c];
                  bestColIndex = c;
                }
              }
              if (bestColIndex !== -1 && maxScore > 0) {
                sutKoduColIndex = bestColIndex;
              }
              console.log(`[CounterDebug] Detected SUT column index: ${sutKoduColIndex} (Column ${String.fromCharCode(65 + sutKoduColIndex)}) with score: ${maxScore}. Col scores:`, colScores);
              
              let periodColIndex = -1;
              let headerRowIndex = -1;
              
              // Find header row and period column index (starting from index 2 - Column C)
              for (let r = 0; r < Math.min(rows.length, 25); r++) {
                const row = rows[r];
                if (!Array.isArray(row)) continue;
                
                for (let c = 2; c < row.length; c++) {
                  const rawVal = row[c];
                  if (isPeriodCell(rawVal)) {
                    periodColIndex = c;
                    headerRowIndex = r;
                    console.log(`[CounterDebug] Found period column! Row: ${r}, Col: ${c} (Column ${String.fromCharCode(65 + c)}), Raw value: "${rawVal}"`);
                    break;
                  }
                }
                if (periodColIndex !== -1) {
                  break;
                }
              }
              
              // Fallback: If not found, look at any row containing period header in column >= 2
              if (periodColIndex === -1) {
                for (let r = 0; r < Math.min(rows.length, 25); r++) {
                  const row = rows[r];
                  if (!Array.isArray(row)) continue;
                  for (let c = 2; c < row.length; c++) {
                    const rawVal = row[c];
                    if (isPeriodCell(rawVal)) {
                      periodColIndex = c;
                      headerRowIndex = r;
                      console.log(`[CounterDebug] Fallback found period column! Row: ${r}, Col: ${c} (Column ${String.fromCharCode(65 + c)}), Raw value: "${rawVal}"`);
                      break;
                    }
                  }
                  if (periodColIndex !== -1) break;
                }
              }
              
              if (periodColIndex !== -1) {
                const sheetMap: { [sutKodu: string]: number } = {};
                const startRow = headerRowIndex !== -1 ? headerRowIndex + 1 : 0;
                let dataRowCount = 0;
                for (let r = startRow; r < rows.length; r++) {
                  const row = rows[r];
                  if (!Array.isArray(row)) continue;
                  
                  const sutVal = String(row[sutKoduColIndex] || '').trim();
                  if (!sutVal) continue;
                  
                  const rawVal = row[periodColIndex];
                  let parsedNum = 0;
                  if (typeof rawVal === 'number') {
                    parsedNum = rawVal;
                  } else {
                    const cleanVal = String(rawVal || '0').replace(/[\.,]/g, '').trim();
                    parsedNum = Number(cleanVal) || 0;
                  }
                  sheetMap[sutVal] = parsedNum;
                  dataRowCount++;
                }
                parsedData[sheetName] = sheetMap;
                console.log(`[CounterDebug] Sheet "${sheetName}" parsed successfully. Total data rows matched: ${dataRowCount}`);
              } else {
                console.warn(`[CounterDebug] Could not find period column for sheet "${sheetName}". Checked row headers (first 25 rows, columns >= 2) against expectedValues. First row was:`, rows[0]);
              }
            });
            
            resolve(parsedData);
          }).catch(error => {
            console.error('[CounterDebug] import xlsx or process error:', error);
            reject(error);
          });
        } catch (e) {
          console.error('[CounterDebug] FileReader try/catch error:', e);
          reject(e);
        }
      };
      reader.onerror = (error) => {
        console.error('[CounterDebug] FileReader error:', error);
        reject(error);
      };
      reader.readAsArrayBuffer(file);
    });
  }, [month, year]);

  const loadCounterRecord = useCallback(async () => {
    if (!currentCompanyId) return;
    setIsLoadingCounter(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'qoreCalculationPeriodCounters'),
          where('companyId', '==', currentCompanyId),
          where('period', '==', selectedPeriod)
        )
      );
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        const data = docSnap.data();
        setDbCounterRecordId(docSnap.id);
        setDbCounterFileName(data.fileName || 'Kaydedilmiş Counter Dosyası');
        if (data.parsedDataJson) {
          try {
            setDbCounterData(JSON.parse(data.parsedDataJson));
          } catch (e) {
            console.error('Parsed counter data JSON could not be parsed:', e);
            setDbCounterData(null);
          }
        } else {
          setDbCounterData(null);
        }
      } else {
        setDbCounterRecordId(null);
        setDbCounterFileName(null);
        setDbCounterData(null);
      }
    } catch (err) {
      console.error('Counter record could not be loaded:', err);
    } finally {
      setIsLoadingCounter(false);
    }
  }, [selectedPeriod, currentCompanyId]);

  useEffect(() => {
    loadCounterRecord();
  }, [loadCounterRecord]);

  const refreshPendingDocs = useCallback(async () => {
    if (!hospitalId) {
      setPendingDocs([]);
      return;
    }
    setIsLoadingPending(true);
    try {
      await deleteExpiredPendingCalculationFiles({ currentCompanyId, isSuperAdmin });
      const docs = await loadPendingCalculationFiles({
        kind: 'kumulatif',
        hospitalId,
        period: selectedPeriod,
        currentCompanyId,
        isSuperAdmin,
      });
      setPendingDocs(docs);
    } catch (err) {
      console.error('Pending calculation files could not be loaded:', err);
      setPendingDocs([]);
    } finally {
      setIsLoadingPending(false);
    }
  }, [hospitalId, selectedPeriod, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    refreshPendingDocs();
  }, [refreshPendingDocs]);

  const usePendingFiles = useCallback(async () => {
    if (pendingDocs.length === 0) return;
    setIsLoadingPending(true);
    try {
      const restored = (await Promise.all(pendingDocs.flatMap((pending) => pending.files).map(pendingPayloadToFile)))
        .filter((file) => isPdf(file) || isTxt(file));
      setFiles(restored);
      setLoadedPendingIds(pendingDocs.map((pending) => pending.id));
      setRows([]);
      setUnmatchedTests([]);
      setError(null);
      toast({ title: 'Bekleyen dosyalar yüklendi', description: `${restored.length} dosya ayrıştırmaya hazır.` });
    } catch (err: any) {
      toast({ title: 'Bekleyen dosyalar açılamadı', description: err?.message || 'Dosya verisi okunamadı.', variant: 'destructive' });
    } finally {
      setIsLoadingPending(false);
    }
  }, [pendingDocs, toast]);

  const [isApplyingCounter, setIsApplyingCounter] = useState(false);

  const handleCounterFileChange = async (file: File | null) => {
    if (!file) {
      setCounterFile(null);
      return;
    }
    setCounterFile(file);
    setIsSavingCounter(true);
    try {
      const parsedData = await parseCounterExcelForAllSheets(file);
      
      const recordPayload = {
        companyId: currentCompanyId || 'default',
        period: selectedPeriod,
        fileName: file.name,
        parsedDataJson: JSON.stringify(parsedData),
        uploadedAt: serverTimestamp(),
        uploadedById: currentUser?.uid || '',
        uploadedByName: currentUserProfile?.name || currentUser?.email || 'Bilinmeyen',
      };
      
      if (dbCounterRecordId) {
        await updateDoc(doc(db, 'qoreCalculationPeriodCounters', dbCounterRecordId), recordPayload);
      } else {
        const docRef = await addDoc(collection(db, 'qoreCalculationPeriodCounters'), recordPayload);
        setDbCounterRecordId(docRef.id);
      }
      
      setDbCounterFileName(file.name);
      setDbCounterData(parsedData);
      
      toast({
        title: 'Counter dosyası kaydedildi',
        description: `${selectedPeriod} dönemi için counter verileri başarıyla yüklendi ve kaydedildi.`,
      });
    } catch (err: any) {
      console.error('Counter parse/save failed:', err);
      toast({
        title: 'Yükleme başarısız',
        description: err?.message || 'Excel dosyası yüklenirken veya kaydedilirken hata oluştu.',
        variant: 'destructive',
      });
      setCounterFile(null);
    } finally {
      setIsSavingCounter(false);
    }
  };

  const handleRemoveCounterFile = async () => {
    setIsSavingCounter(true);
    try {
      if (dbCounterRecordId) {
        await deleteDoc(doc(db, 'qoreCalculationPeriodCounters', dbCounterRecordId));
      }
      
      setDbCounterRecordId(null);
      setDbCounterFileName(null);
      setDbCounterData(null);
      setCounterFile(null);
      
      toast({
        title: 'Counter dosyası silindi',
        description: `${selectedPeriod} dönemine ait counter verileri temizlendi.`,
      });
    } catch (err: any) {
      console.error('Counter delete failed:', err);
      toast({
        title: 'Silme işlemi başarısız',
        description: err?.message || 'Counter dosyası silinirken hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingCounter(false);
    }
  };

  const handleApplyCounterData = async () => {
    console.log('[CounterDebug] Starting handleApplyCounterData');
    console.log('[CounterDebug] dbCounterData:', dbCounterData ? Object.keys(dbCounterData) : 'null');
    console.log('[CounterDebug] counterFile:', counterFile ? counterFile.name : 'null');
    console.log('[CounterDebug] hospitalId:', hospitalId);
    console.log('[CounterDebug] filteredProducts count:', filteredProducts.length);
    
    if (!dbCounterData && !counterFile) {
      console.warn('[CounterDebug] No counter data or file available.');
      toast({ title: 'Counter Dosyası Yok', description: 'Lütfen önce bu döneme ait bir Counter Excel dosyası yükleyin.', variant: 'destructive' });
      return;
    }
    if (!hospitalId || filteredProducts.length === 0) {
      console.warn('[CounterDebug] Hospital ID or filteredProducts is empty.');
      toast({ title: 'Hata', description: 'Lütfen önce bir laboratuvar seçin.', variant: 'destructive' });
      return;
    }
    
    setIsApplyingCounter(true);
    try {
      let counterMap = new Map<string, number>();
      const selectedHospitalObj = selectedHospital || hospitals.find(h => h.id === hospitalId);
      console.log('[CounterDebug] selectedHospitalObj:', {
        id: selectedHospitalObj?.id,
        name: selectedHospitalObj?.name,
        kod: selectedHospitalObj?.kod,
        ceomedCariKodu: selectedHospitalObj?.ceomedCariKodu
      });
      
      let localData: any = null;
      if (!dbCounterData && counterFile) {
        console.log('[CounterDebug] Parsing local counter file...');
        localData = await parseCounterExcelForAllSheets(counterFile);
        console.log('[CounterDebug] Parsed local data sheets:', Object.keys(localData));
      }
      
      const targetData = dbCounterData || localData;
      if (!targetData) {
        console.warn('[CounterDebug] Target data is empty after parsing.');
      } else {
        const sheetKeys = Object.keys(targetData);
        console.log('[CounterDebug] Available sheets in targetData:', sheetKeys);
        
        const targetKey = sheetKeys.find(key => {
          const s = cleanTurkishChars(key);
          const ceomedCari = selectedHospitalObj?.ceomedCariKodu ? cleanTurkishChars(selectedHospitalObj.ceomedCariKodu) : '';
          const hospName = selectedHospitalObj?.name ? cleanTurkishChars(selectedHospitalObj.name) : '';
          const hospKod = selectedHospitalObj?.kod ? cleanTurkishChars(selectedHospitalObj.kod) : '';
          
          const matchCari = ceomedCari && (s === ceomedCari || s.includes(ceomedCari) || ceomedCari.includes(s));
          const matchName = hospName && (s === hospName || hospName.includes(s) || s.includes(hospName));
          const matchKod = hospKod && (s === hospKod || s.includes(hospKod) || hospKod.includes(s));
          
          if (matchCari || matchName || matchKod) {
            console.log(`[CounterDebug] Sheet match found (direct/substring)! Sheet: "${key}" matched hospital parameters:`, {
              matchCari, matchName, matchKod
            });
            return true;
          }
          
          // First word match (if first word length >= 4)
          const nameWords = (selectedHospitalObj?.name || '').split(/[^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]+/);
          if (nameWords.length > 0) {
            const firstWord = cleanTurkishChars(nameWords[0]);
            if (firstWord.length >= 4 && s.includes(firstWord)) {
              console.log(`[CounterDebug] Sheet match found (first word)! Sheet: "${key}" matched hospital first word: "${firstWord}"`);
              return true;
            }
          }
          
          // Significant initials match (e.g. FSM, HNH)
          const stopWords = new Set(['ve', 'egitim', 'arastirma', 'hastanesi', 'devlet', 'saglik', 'merkezi', 'kamu', 'sehir']);
          const sigWords = nameWords
            .map(w => cleanTurkishChars(w))
            .filter(w => w.length > 0 && !stopWords.has(w));
            
          if (sigWords.length >= 2) {
            const sigInitials = sigWords.map(w => w.charAt(0)).join('');
            if (sigInitials.length >= 2 && s.includes(sigInitials)) {
              console.log(`[CounterDebug] Sheet match found (significant initials)! Sheet: "${key}" matched initials: "${sigInitials}"`);
              return true;
            }
          }
          
          return false;
        });
        
        if (targetKey) {
          const sheetMap = targetData[targetKey];
          console.log(`[CounterDebug] Selected sheet "${targetKey}". Entry count:`, Object.keys(sheetMap).length);
          Object.entries(sheetMap).forEach(([sutKodu, val]) => {
            const norm = normalizeSutCode(sutKodu);
            counterMap.set(norm, val as number);
          });
          console.log('[CounterDebug] counterMap keys after normalization (first 10):', Array.from(counterMap.keys()).slice(0, 10));
        } else {
          console.warn('[CounterDebug] Could not match any sheet name to selected hospital. Tried comparing cleaned names with:', {
            ceomedCariKodu: selectedHospitalObj?.ceomedCariKodu,
            name: selectedHospitalObj?.name,
            kod: selectedHospitalObj?.kod
          });
        }
      }
      
      console.log('[CounterDebug] Fetching testDefinitions...');
      const defsSnap = await getDocs(scopedQuery('testDefinitions', currentCompanyId, isSuperAdmin));
      const productToSutCodeMap = new Map<string, string>();
      defsSnap.docs.forEach((d) => {
        const def = d.data() as any;
        const sutKodu = String(def.sutKodu || '').trim();
        const linkedStokKodlari = (def.linkedStokKodlari || []) as string[];
        linkedStokKodlari.forEach(code => {
          if (code && typeof code === 'string') {
            productToSutCodeMap.set(code.trim(), sutKodu);
          }
        });
      });
      console.log('[CounterDebug] Loaded productToSutCodeMap entries:', productToSutCodeMap.size);
      
      const currentRows = rows.length > 0 ? [...rows] : filteredProducts.map((product) => ({
        ...product,
        test: product.testAdi || product.stokKodu,
        routine: 0,
        rerun: 0,
        calib: 0,
        control: 0,
        total: 0,
        matchedTests: [] as string[],
      }));
      console.log('[CounterDebug] Initial rows count for processing:', currentRows.length);
      
      let matchCount = 0;
      let skippedCount = 0;
      const updatedRows = currentRows.map(row => {
        const isCounter = !!row.counterEnabled;
        const isCounterPlus = !!row.counterPlusEnabled;
        
        if (!isCounter && !isCounterPlus) {
          return row;
        }
        
        const sutKodu = productToSutCodeMap.get(row.stokKodu);
        let counterVal = 0;
        let matched = false;
        
        if (sutKodu) {
          const normSut = normalizeSutCode(sutKodu);
          if (counterMap.has(normSut)) {
            counterVal = counterMap.get(normSut) || 0;
            matched = true;
            matchCount++;
            console.log(`[CounterDebug] MATCH! Product: "${row.stokAdi}" (${row.stokKodu}) -> SUT: "${sutKodu}" (normalized: "${normSut}") -> Value: ${counterVal} (Mode: ${isCounter ? 'Counter' : 'Counter+'})`);
          } else {
            skippedCount++;
            console.log(`[CounterDebug] NO VALUE! Product: "${row.stokAdi}" (${row.stokKodu}) -> SUT: "${sutKodu}" (normalized: "${normSut}") was NOT found in counterMap.`);
          }
        } else {
          skippedCount++;
          console.log(`[CounterDebug] NO SUT MAPPING! Product: "${row.stokAdi}" (${row.stokKodu}) does not have a SUT code mapped in testDefinitions.`);
        }
        
        let routine = row.routine || 0;
        let rerun = row.rerun || 0;
        let calib = row.calib || 0;
        let control = row.control || 0;
        let total = row.total || 0;
        
        if (isCounter) {
          total = counterVal;
          routine = counterVal;
          rerun = 0;
          calib = 0;
          control = 0;
        } else if (isCounterPlus) {
          total = total + counterVal;
          routine = routine + counterVal;
        }
        
        return {
          ...row,
          routine,
          rerun,
          calib,
          control,
          total,
        };
      });
      
      console.log(`[CounterDebug] Processing finished. Total matched products: ${matchCount}, Total not matched/no SUT: ${skippedCount}`);
      setRows(updatedRows);
      
      if (matchCount > 0) {
        toast({ title: 'Counter verileri uygulandı', description: `${matchCount} ürünün değerleri güncellendi.` });
      } else {
        toast({ title: 'Eşleşen Veri Yok', description: 'Counter/Counter+ seçili ürünlerden hiçbiri excel verisiyle eşleşmedi. Konsol çıktılarını inceleyin.', variant: 'warning' as any });
      }
    } catch (err: any) {
      console.error('[CounterDebug] Error applying counter data:', err);
      toast({ title: 'Hata', description: err?.message || 'Counter verileri uygulanırken hata oluştu.', variant: 'destructive' });
    } finally {
      setIsApplyingCounter(false);
    }
  };

  const visibleRows = rows.length > 0 ? rows : filteredProducts.map((product) => ({
    ...product,
    test: product.testAdi || product.stokKodu,
    routine: 0,
    rerun: 0,
    calib: 0,
    control: 0,
    total: 0,
    matchedTests: [],
  }));

  useEffect(() => {
    (async () => {
      setLoadingHospitals(true);
      try {
        const snap = await getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin, orderBy('name')));
        setHospitals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)));
      } catch (e: any) {
        setError(e?.message || 'Laboratuvarlar yüklenemedi.');
      } finally {
        setLoadingHospitals(false);
      }
    })();
  }, [currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    if (!hospitalId || !currentCompanyId) {
      setRows([]);
      setUnmatchedTests([]);
      setLastLoadedKey('');
      return;
    }
    
    const loadKey = `${hospitalId}_${month}_${year}_${brandFilter}_${productGroupFilter}`;
    
    if (lastLoadedKey === loadKey) return;
    setLastLoadedKey(loadKey);

    (async () => {
      setIsLoadingHistory(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, 'kumulatifHesaplamaGecmisi'),
            where('companyId', '==', currentCompanyId),
            where('hospitalId', '==', hospitalId),
            where('month', '==', month + 1),
            where('year', '==', year)
          )
        );
        if (!snap.empty) {
          const sortedDocs = [...snap.docs].sort((a, b) => {
            const aTime = a.data().createdAt?.seconds || 0;
            const bTime = b.data().createdAt?.seconds || 0;
            return bTime - aTime;
          });
          const latestDoc = sortedDocs[0].data();
          const items = (latestDoc.items || []) as any[];
          
          const historyMap = new Map<string, any>();
          items.forEach(item => {
            if (item.productId) {
              historyMap.set(item.productId, item);
            }
          });
          
          const mappedRows = filteredProducts.map(product => {
            const hist = historyMap.get(product.stokKodu);
            return {
              ...product,
              test: product.testAdi || product.stokKodu,
              routine: hist ? hist.routine || 0 : 0,
              rerun: hist ? hist.rerun || 0 : 0,
              calib: hist ? hist.calib || 0 : 0,
              control: hist ? hist.control || 0 : 0,
              total: hist ? hist.total || 0 : 0,
              matchedTests: hist ? hist.matchedTests || [] : [],
            };
          });
          setRows(mappedRows);
          setUnmatchedTests([]);
        } else {
          setRows([]);
          setUnmatchedTests([]);
        }
      } catch (err) {
        console.error('Error loading cumulative calculation history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    })();
  }, [hospitalId, month, year, currentCompanyId, filteredProducts, brandFilter, productGroupFilter, lastLoadedKey]);

  const hasComputed = rows.length > 0;
  const availableUnmatchedProducts = useMemo(() => rows.filter((row) => row.matchedTests.length === 0), [rows]);
  const canParse = files.length > 0 && !!hospitalId && filteredProducts.length > 0 && !isParsing && !isLoadingScope;

  function cancelCombine() {
    setAnchor(null);
    setPicked(new Set());
  }

  const addFiles = useCallback((incoming: File[]) => {
    const accepted = incoming.filter((f) => isPdf(f) || isTxt(f));
    if (!accepted.length) return;
    setFiles((prev) => [...prev, ...accepted]);
    setLoadedPendingIds([]);
    setRows([]);
    setUnmatchedTests([]);
    setError(null);
    cancelCombine();
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setRows([]);
        setUnmatchedTests([]);
        cancelCombine();
      }
      return next;
    });
  };

  async function handleParse() {
    if (!canParse) {
      setError('Lütfen önce bir laboratuvar seçin ve dosya ekleyin.');
      return;
    }
    setError(null);
    setIsParsing(true);
    setRows([]);
    setUnmatchedTests([]);
    cancelCombine();
    try {
      const pdfs = files.filter(isPdf);
      const txts = files.filter(isTxt);
      const [pdfRows, txtRows] = await Promise.all([
        parseCumulativePdfFiles(pdfs),
        parseCumulativeTxtFiles(txts),
      ]);

      const merged = [...pdfRows, ...txtRows];
      const aggregated = applyCumulativeAutoSum(aggregateCumulative(merged), autoSumDefinitions);
      const byTest = new Map<string, CumulativeRow[]>();
      aggregated.forEach((row) => {
        const key = normalizeTestName(row.test);
        byTest.set(key, [...(byTest.get(key) ?? []), row]);
      });
      const usedTestKeys = new Set<string>();
      const matched = filteredProducts.map((product) => {
        const productTestKey = normalizeTestName(product.testAdi);
        const matches = byTest.get(productTestKey) ?? [];
        if (matches.length > 0) usedTestKeys.add(productTestKey);
        const totals = matches.reduce((acc, match) => ({
          routine: acc.routine + (match.routine || 0),
          rerun: acc.rerun + (match.rerun || 0),
          calib: acc.calib + (match.calib || 0),
          control: acc.control + (match.control || 0),
          total: acc.total + (match.total || 0),
        }), { routine: 0, rerun: 0, calib: 0, control: 0, total: 0 });

        return {
          ...product,
          test: product.testAdi || product.stokKodu,
          ...totals,
          total: totals.total,
          matchedTests: matches.map((match) => match.test),
        };
      });
      setRows(matched);
      setUnmatchedTests(aggregated.filter((row) => !usedTestKeys.has(normalizeTestName(row.test))));
      if (aggregated.length === 0) {
        setError('Geçerli veri satırı çıkarılamadı. Dosya içeriğini ve biçimini kontrol edin.');
      } else {
        if (loadedPendingIds.length > 0) {
          await markPendingCalculationFilesConsumed(loadedPendingIds);
          setLoadedPendingIds([]);
          refreshPendingDocs();
        }
        // Tarama sonrası dosyalar sistemde tutulmaz.
        setFiles([]);
      }
    } catch (e: any) {
      setError(e?.message || 'Ayrıştırma başarısız oldu. Dosyaların beklenen başlıkları içerdiğinden emin olun.');
    } finally {
      setIsParsing(false);
    }
  }

  // ---- Manuel birleştirme ----
  function startCombine(test: string) {
    setAnchor(test);
    setPicked(new Set());
  }
  function togglePick(test: string) {
    if (!combineMode || test === anchor) return;
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(test) ? next.delete(test) : next.add(test);
      return next;
    });
  }
  function applyCombine() {
    if (!anchor || picked.size === 0) {
      cancelCombine();
      return;
    }
    setRows((prev) => {
      const pickedRows = prev.filter((r) => picked.has(r.test));
      const sums = pickedRows.reduce(
        (acc, r) => {
          acc.routine += r.routine || 0;
          acc.rerun += r.rerun || 0;
          acc.calib += r.calib || 0;
          acc.control += r.control || 0;
          acc.total += r.total || 0;
          return acc;
        },
        { routine: 0, rerun: 0, calib: 0, control: 0, total: 0 }
      );
      return prev
        .filter((r) => !picked.has(r.test))
        .map((r) =>
          r.test === anchor
            ? {
                ...r,
                routine: r.routine + sums.routine,
                rerun: r.rerun + sums.rerun,
                calib: r.calib + sums.calib,
                control: r.control + sums.control,
                total: r.total + sums.total,
              }
            : r
        );
    });
    cancelCombine();
  }

  const isAllZero = (r: CumulativeRow) =>
    !r.routine && !r.rerun && !r.calib && !r.control && !r.total;
  const hasZeroRows = useMemo(() => rows.some(isAllZero), [rows]);
  function removeZeroRows() {
    setRows((prev) => prev.filter((r) => !isAllZero(r)));
    cancelCombine();
  }

  function assignUnmatchedTest(testName: string, stokKodu: string) {
    const source = unmatchedTests.find((item) => item.test === testName);
    if (!source || !stokKodu) return;

    setRows((prev) => prev.map((row) => row.stokKodu === stokKodu
      ? {
          ...row,
          test: row.testAdi || row.stokKodu,
          routine: source.routine,
          rerun: source.rerun,
          calib: source.calib,
          control: source.control,
          total: source.total,
          matchedTests: [...row.matchedTests, source.test],
        }
      : row
    ));
    setUnmatchedTests((prev) => prev.filter((item) => item.test !== testName));
  }


  async function updateTestCountersFromRows() {
    const defsSnap = await getDocs(scopedQuery('testDefinitions', currentCompanyId, isSuperAdmin, orderBy('sutKodu', 'asc')));
    const batch = writeBatch(db);
    let updateCount = 0;
    defsSnap.docs.forEach((defDoc) => {
      const def = defDoc.data() as any;
      const linked = new Set((def.linkedStokKodlari || []).map((code: unknown) => String(code).trim()).filter(Boolean));
      if (linked.size === 0) return;
      const incrementBy = rows.reduce((sum, row) => linked.has(row.stokKodu) ? sum + (row.total || 0) : sum, 0);
      if (incrementBy <= 0) return;
      batch.update(doc(db, 'testDefinitions', defDoc.id), {
        counterValue: increment(incrementBy),
        counterUpdatedAt: serverTimestamp(),
      });
      updateCount += 1;
    });
    if (updateCount > 0) await batch.commit();
    return updateCount;
  }


  /**
   * Bu lab-dönem için kayıtlı kümülatif veriyi tabloya doldurur.
   *
   * Değerler normalde yüklenen dosyalardan türer; snapshot'ı otomatik
   * uygulamak hangi sayının dosyadan hangisinin kayıttan geldiğini
   * belirsizleştirirdi. Bu yüzden doldurma açık bir eylemdir.
   *
   * Toplam ve varsa rutin/tekrar/kalibrasyon/kontrol kırılımı yazılır. Eski
   * kayıtlarda kırılım bulunmayabilir; o durumda yalnızca toplam yazılır ve
   * kırılım sütunlarına dokunulmaz.
   */
  async function handleKayittanDoldur() {
    if (!hospitalId) return;
    setIsLoadingSnapshot(true);
    try {
      const { getLabPeriodSnapshots } = await import('@/actions/labPeriodActions');
      const snapshotlar = await getLabPeriodSnapshots(
        [hospitalId],
        year,
        month + 1, // month 0-indekslidir
        currentCompanyId,
        isSuperAdmin,
      );
      const kayit = snapshotlar[hospitalId]?.kumulatif || {};
      const kodlar = Object.keys(kayit);
      if (kodlar.length === 0) {
        toast({ title: 'Kayıt yok', description: 'Bu dönem için kayıtlı kümülatif verisi bulunamadı.' });
        return;
      }
      // Tablo boşsa ürün listesinden kurulur; doluysa yalnızca toplam yazılır.
      setRows(prev => {
        const taban = prev.length > 0
          ? prev
          : filteredProducts.map(product => ({
              ...product,
              test: product.testAdi || product.stokKodu,
              routine: 0,
              rerun: 0,
              calib: 0,
              control: 0,
              total: 0,
              matchedTests: [] as string[],
            }));
        return taban.map(row => {
          const olcum = kayit[row.stokKodu];
          if (!olcum) return row;
          const k = olcum.kirilim;
          return {
            ...row,
            total: olcum.deger,
            // Kırılım kayıtta varsa yazılır; yoksa mevcut sütunlara dokunulmaz
            // (uydurulmuş sıfırlar tabloyu yanlış doldurmasın).
            ...(k
              ? {
                  routine: Number(k.routine) || 0,
                  rerun: Number(k.rerun) || 0,
                  calib: Number(k.calib) || 0,
                  control: Number(k.control) || 0,
                }
              : {}),
          };
        });
      });
      const kirilimliAdet = kodlar.filter(k => kayit[k]?.kirilim).length;
      toast({
        title: 'Kayıtlı veri yüklendi',
        description:
          kirilimliAdet === kodlar.length
            ? `${kodlar.length} ürün için kümülatif toplam ve kırılım tabloya yazıldı.`
            : `${kodlar.length} ürün yazıldı; ${kodlar.length - kirilimliAdet} tanesinde yalnızca toplam vardı, kırılım sütunları değiştirilmedi.`,
      });
    } catch (e: any) {
      toast({
        title: 'Yüklenemedi',
        description: e?.message || 'Kayıtlı veri okunamadı.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingSnapshot(false);
    }
  }

  async function handleSaveHistory() {
    if (!rows.length) return;
    setIsSavingHistory(true);
    try {
      const period = `${String(month + 1).padStart(2, '0')}-${year}`;
      const gecmisRef = await addDoc(collection(db, 'kumulatifHesaplamaGecmisi'), {
        companyId: currentCompanyId || '__legacy__',
        hospitalId,
        hospitalName,
        scopedLabIds,
        scopeLabel: scopeLabel || hospitalName,
        month: month + 1,
        year,
        period,
        rowCount: rows.length,
        items: rows.map((r) => ({
          productId: r.stokKodu,
          productName: r.stokAdi,
          testName: r.testAdi,
          matchedTests: r.matchedTests,
          routine: r.routine || 0,
          rerun: r.rerun || 0,
          calib: r.calib || 0,
          control: r.control || 0,
          total: r.total || 0,
          efficiency: calculateEfficiency(r.routine, r.total),
        })),
        createdAt: serverTimestamp(),
        createdByUid: currentUser?.uid || null,
        createdByName: currentUserProfile?.name || currentUser?.email || null,
      });
      // Kümülatif, lab-dönem snapshot'ının tek doğruluk kaynağına da işlenir.
      await labDonemineYaz({
        labId: hospitalId,
        labAdi: hospitalName,
        yil: year,
        ay: month + 1,
        girdiler: rows
          .map(r => ({
            stokKodu: String(r.stokKodu || '').trim(),
            alan: 'kumulatif' as const,
            deger: Number(r.total) || 0,
            // Kırılım toplamla birlikte taşınır ki panel geri okurken
            // rutin/tekrar/kalibrasyon/kontrol sütunlarını da doldurabilsin.
            kirilim: {
              routine: Number(r.routine) || 0,
              rerun: Number(r.rerun) || 0,
              calib: Number(r.calib) || 0,
              control: Number(r.control) || 0,
            },
          }))
          .filter(g => g.stokKodu && g.deger > 0),
        kaynak: 'kumulatif-hesaplama',
        kaynakKayitId: gecmisRef.id,
        girenAdi: currentUserProfile?.name || currentUser?.email || undefined,
        companyId: currentCompanyId,
      });

      const counterUpdateCount = await updateTestCountersFromRows();
      toast({ title: 'Kaydedildi', description: `${period} dönemi kümülatif hesaplama geçmişe kaydedildi.${counterUpdateCount ? ` ${counterUpdateCount} test counterı güncellendi.` : ''}` });
    } catch (e: any) {
      toast({ title: 'Kayıt başarısız', description: e?.message || 'Geçmiş kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsSavingHistory(false);
    }
  }

  function handleExport() {
    if (!rows.length) return;
    const data = rows.map((r) => ({
      'Stok Kodu': r.stokKodu,
      'Stok Adı': r.stokAdi,
      'Test Adı': r.testAdi,
      Test: r.test,
      Routine: r.routine,
      Rerun: r.rerun,
      Calib: r.calib,
      Control: r.control,
      Total: r.total,
      'Verimlilik (%)': calculateEfficiency(r.routine, r.total) ?? '',
    }));
    const fname = `Kumulatif_${hospitalName || 'Lab'}_${String(month + 1).padStart(2, '0')}-${year}`;
    exportDataToExcel(data, fname, 'Kumulatif', toast);
  }

  const card = (children: React.ReactNode, style?: React.CSSProperties) => (
    <div style={{
      borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat,
      padding: mobile ? 14 : 18, ...style,
    }}>{children}</div>
  );

  return (
    <ClayPage>
      <div style={{ animation: `cyRise 360ms ${EASE} both` }}>
        <RaporHead
          icon={Archive}
          title="Kümülatif Hesaplama Motoru"
          desc="'Cumulative Operation List' PDF/TXT dosyalarını yükleyin; testleri çıkarıp benzersiz listede birleştirin ve Excel'e aktarın."
          onBack={() => router.push('/raporlama')}
          mobile={mobile}
        />

        <Card>
          {/* Lab / Ay / Yıl */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
            <div>
              <FieldLabel>Laboratuvar</FieldLabel>
              <Dropdown
                value={hospitalId}
                onChange={(v) => { setHospitalId(v); setRows([]); setUnmatchedTests([]); setCounterFile(null); }}
                options={hospitals.filter((h) => h.id).map((h) => ({ value: h.id!, label: h.name }))}
                placeholder={loadingHospitals ? 'Yükleniyor...' : 'Seçiniz'}
                icon={<Archive size={17} />}
                disabled={loadingHospitals}
              />
            </div>
            <div>
              <FieldLabel>Ay</FieldLabel>
              <Dropdown
                value={String(month)}
                onChange={(v) => { setMonth(Number(v)); setRows([]); setUnmatchedTests([]); }}
                options={MONTHS.map((m) => ({ value: String(m.value), label: m.label }))}
              />
            </div>
            <div>
              <FieldLabel>Yıl</FieldLabel>
              <Dropdown
                value={String(year)}
                onChange={(v) => { setYear(Number(v)); setRows([]); setUnmatchedTests([]); }}
                options={YEARS.map((y) => String(y))}
              />
            </div>
            <div>
              <FieldLabel>Counter Excel Dosyası (İsteğe Bağlı)</FieldLabel>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <SoftBtn
                  onClick={() => counterFileInputRef.current?.click()}
                  disabled={isLoadingCounter || isSavingCounter}
                  style={{
                    flex: 1,
                    height: 38,
                    fontSize: 13,
                    borderColor: (dbCounterFileName || counterFile) ? '#10B981' : undefined,
                    background: (dbCounterFileName || counterFile) ? 'rgba(16, 185, 129, 0.05)' : undefined
                  }}
                >
                  {isLoadingCounter || isSavingCounter ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <FileSpreadsheet size={15} style={{ color: (dbCounterFileName || counterFile) ? '#10B981' : undefined }} />
                  )}
                  {isLoadingCounter ? 'Yükleniyor...' : isSavingCounter ? 'Kaydediliyor...' : dbCounterFileName ? dbCounterFileName : counterFile ? counterFile.name : 'Counter Excel Seç'}
                </SoftBtn>
                {(dbCounterFileName || counterFile) && (
                  <button
                    onClick={handleRemoveCounterFile}
                    disabled={isSavingCounter}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#EF4444'
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
                <input
                  ref={counterFileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    handleCounterFileChange(file);
                  }}
                  style={{ display: 'none' }}
                />
              </div>
            </div>
          </div>

          {/* Bekleyen dosya uyarısı */}
          {hasCounterProducts && !counterFile && !dbCounterFileName && (
            <div style={{ padding: 10, borderRadius: C.radiusSm, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#D97706', fontSize: 12.5, fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
              <span>⚠️ Bu laboratuvarda Counter veya Counter+ tanımlı ürünler var. Lütfen döneme ait Counter Excel dosyasını yükleyin.</span>
            </div>
          )}

          {pendingDocs.length > 0 && (
            card(
              <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', alignItems: mobile ? 'stretch' : 'center', gap: 12 }}>
                <span style={{ display: 'inline-flex', flexShrink: 0, color: '#9A6F1E' }}><FileText size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.ink1 }}>Sayım ekranından gelen bekleyen dosya var</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: C.ink2, marginTop: 3, lineHeight: 1.45 }}>
                    {selectedPeriod} döneminde bu laboratuvar için {pendingDocs.reduce((sum, pending) => sum + pending.files.length, 0)} kümülatif dosyası hesaplamaya hazır bekliyor.
                  </div>
                </div>
                <SoftBtn onClick={usePendingFiles} disabled={isLoadingPending} style={{ flexShrink: 0 }}>
                  {isLoadingPending && <Loader2 size={16} style={{ animation: 'cySpin 1s linear infinite' }} />}
                  Dosyaları Kullan
                </SoftBtn>
              </div>,
              { marginBottom: 16, background: 'linear-gradient(180deg, rgba(224,163,62,0.10), ' + C.surface2 + ')' }
            )
          )}

          {/* Marka / Ürün Grubu filtreleri */}
          <div style={{ marginBottom: 16, padding: mobile ? 14 : 16, borderRadius: C.radius, background: C.surface2, boxShadow: C.clayInset }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div>
                <FieldLabel>Marka Filtresi</FieldLabel>
                <Dropdown
                  value={brandFilter}
                  onChange={(v) => { setBrandFilter(v); setRows([]); setUnmatchedTests([]); }}
                  options={[{ value: ALL_FILTER_VALUE, label: 'Tüm Markalar' }, ...brandOptions.map((brand) => ({ value: brand, label: brand }))]}
                />
              </div>
              <div>
                <FieldLabel>Ürün Grubu Filtresi</FieldLabel>
                <Dropdown
                  value={productGroupFilter}
                  onChange={(v) => { setProductGroupFilter(v); setRows([]); setUnmatchedTests([]); }}
                  options={[{ value: ALL_FILTER_VALUE, label: 'Tüm Ürün Grupları' }, ...productGroupOptions.map((group) => ({ value: group, label: group }))]}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 3, fontSize: 13, fontWeight: 600, color: C.ink2 }}>
                <span>{isLoadingScope ? 'Ürünler yükleniyor…' : `${filteredProducts.length} ürün listeleniyor`}</span>
                {scopeLabel && <span style={{ color: C.ink3 }}>Ortak stok havuzu: {scopeLabel}</span>}
              </div>
            </div>
          </div>

          {/* Yükleme alanı */}
          <UploadZone
            hint=".pdf, .txt, .csv dosyaları (toplu yükleme desteklenir)"
            acceptAttr=".pdf,.txt,.csv,application/pdf,text/plain,text/csv"
            onFiles={(fl) => addFiles(Array.from(fl))}
            accept={['.pdf', '.txt', '.csv']}
          />

          {/* Seçilen dosyalar */}
          {files.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              {files.map((file, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 13px', borderRadius: 999, background: C.surface2, boxShadow: C.clayInset, fontSize: 13, fontWeight: 600, color: C.ink1, maxWidth: '100%' }}>
                  <FileText size={15} style={{ color: AC.primary, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{file.name}</span>
                  <button type="button" onClick={() => removeFile(i)} aria-label="Kaldır" style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', color: C.ink3, flexShrink: 0 }}>
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Aksiyon butonları */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
            <Link href="/oto-toplam-tanimlari" style={{ textDecoration: 'none' }}>
              <SoftBtn><Network size={17} /> Oto Toplam Tanımları</SoftBtn>
            </Link>
            <Link href="/kumulatif-hesaplama/gecmis" style={{ textDecoration: 'none' }}>
              <SoftBtn><History size={17} /> Geçmiş</SoftBtn>
            </Link>
            <PrimaryBtn onClick={handleParse} disabled={!canParse}>
              {isParsing ? <Loader2 size={17} style={{ animation: 'cySpin 1s linear infinite' }} /> : <Archive size={17} />}
              {files.length > 0 ? `${files.length} Dosyayı Ayrıştır` : 'Ayrıştır'}
            </PrimaryBtn>
            <SoftBtn
              onClick={handleApplyCounterData}
              disabled={(!dbCounterData && !counterFile) || isApplyingCounter || !hospitalId}
            >
              {isApplyingCounter ? <Loader2 size={17} style={{ animation: 'cySpin 1s linear infinite' }} /> : <FileSpreadsheet size={17} />}
              Counter Verilerini Al
            </SoftBtn>
            <SoftBtn onClick={handleKayittanDoldur} disabled={!hospitalId || isLoadingSnapshot || combineMode}>
              {isLoadingSnapshot ? <Loader2 size={17} style={{ animation: 'cySpin 1s linear infinite' }} /> : <Database size={17} />} Kayıtlı Veriden Doldur
            </SoftBtn>
            {hasComputed && (
              <>
                <SoftBtn onClick={removeZeroRows} disabled={!hasZeroRows || combineMode}>
                  <Trash2 size={17} /> 0 Olanları Kaldır
                </SoftBtn>
                <SoftBtn onClick={handleSaveHistory} disabled={combineMode || isSavingHistory}>
                  {isSavingHistory ? <Loader2 size={17} style={{ animation: 'cySpin 1s linear infinite' }} /> : <Save size={17} />} Kaydet
                </SoftBtn>
                <SoftBtn onClick={handleExport} tone={C.waterDeep} disabled={combineMode}>
                  <FileSpreadsheet size={17} /> Excel'e Aktar
                </SoftBtn>
              </>
            )}
          </div>

          {/* Kapsam hatası */}
          {scopeError && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: C.radiusSm, background: 'rgba(192,121,106,0.10)', boxShadow: C.clayInset }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.danger }}>Hata</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.ink2, marginTop: 3 }}>{scopeError}</div>
            </div>
          )}

          {/* Genel hata */}
          {error && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: C.radiusSm, background: 'rgba(192,121,106,0.10)', boxShadow: C.clayInset }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.danger }}>Hata</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.ink2, marginTop: 3 }}>{error}</div>
            </div>
          )}

          {/* Eşleşmeyen testler */}
          {unmatchedTests.length > 0 && (
            <div style={{ marginTop: 18 }}>
              {card(
                <>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink1 }}>Eşleşmeyen testler bulundu</div>
                  <p style={{ margin: '6px 0 14px', fontSize: 13, fontWeight: 500, color: C.ink2, lineHeight: 1.5 }}>
                    PDF/TXT içinden gelen ama seçili lab ürün listesinde otomatik eşleşmeyen testleri, boşta kalan ürünlerden birine aktarabilirsiniz.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {unmatchedTests.map((item) => (
                      <div key={item.test} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, alignItems: 'center', padding: 12, borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink1 }}>{item.test}</div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: C.ink3, marginTop: 2 }}>Routine {item.routine} • Rerun {item.rerun} • Calib {item.calib} • Control {item.control} • Total {item.total}</div>
                        </div>
                        <Dropdown
                          value=""
                          onChange={(stokKodu) => assignUnmatchedTest(item.test, stokKodu)}
                          options={availableUnmatchedProducts.map((product) => ({ value: product.stokKodu, label: `${product.stokKodu} • ${product.stokAdi} • ${product.testAdi || 'Test adı yok'}` }))}
                          placeholder={availableUnmatchedProducts.length ? 'Boşta kalan ürün/test seçin' : 'Boşta kalan ürün yok'}
                          disabled={availableUnmatchedProducts.length === 0}
                        />
                      </div>
                    ))}
                  </div>
                </>,
                { background: C.surfaceHi }
              )}
            </div>
          )}

          {/* Sonuç tablosu */}
          {visibleRows.length > 0 ? (
            <div style={{ marginTop: 22 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.ink1 }}>Ürün Bazlı Kümülatif Eşleşmeler ({visibleRows.length} ürün)</h3>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2 }}>
                  {hospitalName ? `${hospitalName} – ${MONTHS[month].label} ${year}` : `${MONTHS[month].label} ${year}`}
                  {combineMode && ' • Birleştirme modu: ana teste eklenecek testleri seçin.'}
                </span>
              </div>
              <div style={{ borderRadius: C.radius, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
                <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: C.surface }}>
                      <tr style={{ textAlign: 'left', color: C.ink3 }}>
                        <th style={thStyle(40)} />
                        <th style={thStyle()}>Stok Kodu</th>
                        <th style={thStyle()}>Stok Adı</th>
                        <th style={thStyle()}>Test Adı</th>
                        <th style={thStyle()}>Eşleşen Dosya Testi</th>
                        <th style={thStyle(undefined, 'right')}>Routine</th>
                        <th style={thStyle(undefined, 'right')}>Rerun</th>
                        <th style={thStyle(undefined, 'right')}>Calib</th>
                        <th style={thStyle(undefined, 'right')}>Control</th>
                        <th style={thStyle(undefined, 'right')}>Total</th>
                        <th style={thStyle(undefined, 'right')}>Verimlilik (%)</th>
                        <th style={thStyle(112)} />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((r) => {
                        const isAnchor = combineMode && anchor === r.test;
                        const isPickable = combineMode && !isAnchor;
                        const isPicked = picked.has(r.test);
                        return (
                          <tr
                            key={r.test}
                            onClick={() => { if (isPickable) togglePick(r.test); }}
                            style={{
                              cursor: isPickable ? 'pointer' : 'default',
                              borderTop: `1px solid ${C.line}`,
                              background: isAnchor ? 'rgba(224,163,62,0.14)' : isPicked ? 'rgba(124,168,222,0.14)' : 'transparent',
                              boxShadow: isAnchor ? `inset 0 0 0 2px rgba(224,163,62,0.7)` : isPicked ? `inset 0 0 0 2px rgba(124,168,222,0.6)` : 'none',
                            }}
                          >
                            <td style={tdStyle()}>
                              <button
                                type="button"
                                title="Bu testi ana test yap ve diğerlerini buna ekle"
                                disabled={combineMode && !isAnchor}
                                onClick={(e) => { e.stopPropagation(); startCombine(r.test); }}
                                style={{ all: 'unset', cursor: combineMode && !isAnchor ? 'not-allowed' : 'pointer', width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', color: C.ink2, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: C.clayFlat, opacity: combineMode && !isAnchor ? 0.5 : 1 }}
                              >
                                <Plus size={15} />
                              </button>
                            </td>
                            <td style={{ ...tdStyle(), fontWeight: 700, color: C.ink1 }}>{r.stokKodu}</td>
                            <td style={tdStyle()}>{r.stokAdi}</td>
                            <td style={tdStyle()}>{r.testAdi || '—'}</td>
                            <td style={{ ...tdStyle(), color: C.ink3 }}>{r.matchedTests.join(', ') || '—'}</td>
                            <td style={tdStyle('right')}>{r.routine}</td>
                            <td style={tdStyle('right')}>{r.rerun}</td>
                            <td style={tdStyle('right')}>{r.calib}</td>
                            <td style={tdStyle('right')}>{r.control}</td>
                            <td style={{ ...tdStyle('right'), fontWeight: 800, color: AC.primary }}>{r.total}</td>
                            <td style={tdStyle('right')}>{calculateEfficiency(r.routine, r.total)?.toFixed(2) ?? ''}</td>
                            <td style={tdStyle('right')}>
                              {isAnchor && (
                                <div style={{ display: 'inline-flex', gap: 6 }}>
                                  <SoftBtn onClick={() => applyCombine()} tone={C.waterDeep} style={{ height: 32, padding: '0 10px', fontSize: 12.5 }}>
                                    <CheckCircle size={15} /> Ekle
                                  </SoftBtn>
                                  <SoftBtn onClick={() => cancelCombine()} tone={C.danger} style={{ height: 32, padding: '0 10px', fontSize: 12.5 }}>
                                    <XCircle size={15} /> İptal
                                  </SoftBtn>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 18 }}>
              <EmptyBlock icon={<Archive size={26} />} text="Henüz sonuç yok" sub="Bir laboratuvar seçip dosya yükleyerek hesaplamayı başlatın." />
            </div>
          )}
        </Card>
      </div>
    </ClayPage>
  );
}

const thStyle = (width?: number, align: 'left' | 'right' = 'left'): React.CSSProperties => ({
  padding: '11px 12px', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
  textAlign: align, whiteSpace: 'nowrap', width, color: C.ink3,
});
const tdStyle = (align: 'left' | 'right' = 'left'): React.CSSProperties => ({
  padding: '10px 12px', textAlign: align, color: C.ink1, whiteSpace: 'nowrap',
});
