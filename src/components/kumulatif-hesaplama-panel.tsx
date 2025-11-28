
'use client';

import React, { useState, useEffect, useCallback, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  getDoc,
  doc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import type { Hospital, SummaryRow as SummaryRowType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileSpreadsheet, History, Save, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { exportDataToExcel, readExcelData } from '@/lib/utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

// ---- Helpers ----
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i, label: format(new Date(0, i), 'LLLL', { locale: tr }) }));

function normalizeTestName(s: string): string {
  // Turkish-friendly, whitespace/period tolerant
  return (s || '')
    .toLocaleLowerCase('tr')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type ExcelRow = {
  Test?: string;
  'Rutin'?: number | string;
  'Tekrar'?: number | string;
  'Kalib.'?: number | string;
  'Kontrol'?: number | string;
  'Toplam'?: number | string;
};

function toInt(v: any): number {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function fetchLabTestsRobust(labId: string, debugLog = true): Promise<string[]> {
  const add = (collected: Set<string>, name: any) => {
    const v = typeof name === 'string' ? name : (name?.name ?? name?.test ?? name?.testAdi);
    if (v) collected.add(String(v));
  };
  const collected = new Set<string>();

  const tries: Array<() => Promise<void>> = [
    // A) hospitals/{labId}/testDefinitions (subcollection)
    async () => {
      const snap = await getDocs(collection(db, 'hospitals', labId, 'testDefinitions'));
      snap.forEach(d => add(collected, d.data() ?? d.id));
    },
    // B) hospitals/{labId}/tests (another common subcollection name)
    async () => {
        const snap = await getDocs(collection(db, 'hospitals', labId, 'tests'));
        snap.forEach(d => add(collected, d.data() ?? d.id));
    },
    // C) yonetim/test-yonetimi/{labId}/tests (canonical in many setups)
    async () => {
      const snap = await getDocs(collection(db, 'yonetim', 'test-yonetimi', labId, 'tests'));
      snap.forEach(d => add(collected, d.data() ?? d.id));
    },
    // D) yonetim/test-yonetimi/labs/{labId}/tests (two-level)
    async () => {
      const snap = await getDocs(collection(db, 'yonetim', 'test-yonetimi', 'labs', labId, 'tests'));
      snap.forEach(d => add(collected, d.data() ?? d.id));
    },
    // E) yonetim/test-yonetimi/labs/{labId} (doc with arrays)
    async () => {
      const ref = doc(db, 'yonetim', 'test-yonetimi', 'labs', labId);
      const ds = await getDoc(ref);
      if (ds.exists()) {
        const data: any = ds.data();
        const arr: any[] = data?.tests ?? data?.items ?? [];
        arr.forEach(t => add(collected, t));
      }
    },
    // F) yonetim/test-yonetimi (doc with maps { [labId]: [...] })
    async () => {
      const ref = doc(db, 'yonetim', 'test-yonetimi');
      const ds = await getDoc(ref);
      if (ds.exists()) {
        const data: any = ds.data();
        const arr: any[] =
          data?.[labId] ??
          data?.labs?.[labId] ??
          data?.testsByLab?.[labId] ??
          [];
        arr.forEach(t => add(collected, t));
      }
    },
    // G) testYonetimi/{labId} (doc with array "tests")
    async () => {
      const ref = doc(db, 'testYonetimi', labId);
      const ds = await getDoc(ref);
      if (ds.exists()) {
        const arr: any[] = (ds.data() as any)?.tests ?? [];
        arr.forEach(t => add(collected, t));
      }
    },
    // H) hospitals/{labId} (doc with array "tests")
    async () => {
      const ref = doc(db, 'hospitals', labId);
      const ds = await getDoc(ref);
      if (ds.exists()) {
        const arr: any[] = (ds.data() as any)?.tests ?? [];
        arr.forEach(t => add(collected, t));
      }
    },
  ];

  for (const t of tries) {
    try {
      await t();
    } catch (e) {
      if (debugLog) console.debug('[kumulatif] fetch attempt failed (ok to ignore):', e);
    }
  }

  const list = Array.from(collected).filter(Boolean).sort((a, b) => a.localeCompare(b, 'tr'));
  if (debugLog) console.info(`[kumulatif] fetched ${list.length} tests for lab ${labId}`);
  return list;
}

// ---- Component ----
export default function KumulatifHesaplamaPanel() {
  const router = useRouter();
  const { toast } = useToast();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);

  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);

  const [resultRows, setResultRows] = useState<SummaryRowType[]>([]); // table model

  const selectedHospitalName = hospitals.find(h => h.id === selectedHospitalId)?.name || '';

  // Load hospitals
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'hospitals'));
        setHospitals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital)));
      } catch (error) {
        console.error('Error fetching hospitals:', error);
        toast({ title: 'Veri Hatası', description: 'Hastaneler yüklenemedi.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [toast]);

  // Load lab tests → initialize rows with zeros
  useEffect(() => {
    if (!selectedHospitalId) {
      setResultRows([]);
      return;
    }
    (async () => {
      setIsLoading(true);
      try {
        const tests = await fetchLabTestsRobust(selectedHospitalId);
        if (tests.length === 0) {
          toast({
            title: 'Test Tanımı Bulunamadı',
            description: 'Bu laboratuvara ait test listesi bulunamadı. Lütfen Yönetim > Test Yönetimi panelinden ekleyin.',
            variant: 'destructive',
          });
        }
        const initRows: SummaryRowType[] = tests.map(t => ({
          test: t,
          routine: 0,
          rerun: 0,
          calib: 0,
          control: 0,
          total: 0,
        }));
        setResultRows(initRows);
      } catch (e) {
        console.error('fetchLabTestsRobust error', e);
        toast({ title: 'Hata', description: 'Test listesi alınamadı.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [selectedHospitalId, toast]);

  const handleExcelUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!selectedHospitalId) {
        toast({ title: 'Eksik Seçim', description: 'Önce laboratuvarı seçin.', variant: 'destructive' });
        e.target.value = '';
        return;
      }

      setIsImporting(true);
      try {
        const rows: ExcelRow[] = await readExcelData(file, toast);

        const byName = new Map<string, SummaryRowType>();
        for (const r of resultRows) {
          byName.set(normalizeTestName(r.test), { ...r });
        }

        let matched = 0;
        let ignored = 0;

        for (const row of rows) {
          const rawName = String(row.Test ?? '').trim();
          if (!rawName) {
            ignored++;
            continue;
          }
          const key = normalizeTestName(rawName);
          const current = byName.get(key);
          if (!current) {
            // Excel’de var ama bu lab listesinde yok → ignore
            ignored++;
            continue;
          }
          const routine = toInt(row['Rutin']);
          const rerun = toInt(row['Tekrar']);
          const calib = toInt(row['Kalib.']);
          const control = toInt(row['Kontrol']);
          const total = toInt(row['Toplam']);

          byName.set(key, { ...current, routine, rerun, calib, control, total });
          matched++;
        }

        setResultRows(Array.from(byName.values()).sort((a, b) => a.test.localeCompare(b.test, 'tr')));
        toast({
          title: 'Excel İçe Aktarıldı',
          description: `${matched} satır eşleşti, ${ignored} satır yok sayıldı.`,
        });
      } catch (err) {
        console.error('Excel parse error', err);
        toast({ title: 'Excel Hatası', description: 'Excel dosyası işlenemedi.', variant: 'destructive' });
      } finally {
        setIsImporting(false);
        e.target.value = '';
      }
    },
    [resultRows, selectedHospitalId, toast]
  );

  const handleSaveToHistory = useCallback(async () => {
    if (!selectedHospitalId || resultRows.length === 0) return;
    try {
      const summary = resultRows.reduce((acc, row) => {
        const { test, ...rest } = row;
        acc[test] = rest; // { routine, rerun, calib, control, total }
        return acc;
      }, {} as Record<string, Omit<SummaryRowType, 'test'>>);

      await addDoc(collection(db, 'kumulatifRaporlar'), {
        hospitalId: selectedHospitalId,
        hospitalName: selectedHospitalName,
        month: selectedMonth,
        year: selectedYear,
        summary,
        createdAt: serverTimestamp(),
      });
      toast({ title: 'Geçmişe Kaydedildi', description: `${selectedHospitalName} – ${MONTHS[selectedMonth].label} ${selectedYear}` });
    } catch (e) {
      console.error(e);
      toast({ title: 'Kayıt Hatası', description: 'Geçmişe kaydedilemedi.', variant: 'destructive' });
    }
  }, [resultRows, selectedHospitalId, selectedHospitalName, selectedMonth, selectedYear, toast]);

  const exportCurrentToExcel = useCallback(() => {
    if (resultRows.length === 0) return;
    const data = resultRows.map(r => ({
      'Test': r.test,
      'Rutin': r.routine,
      'Tekrar': r.rerun,
      'Kalib.': r.calib,
      'Kontrol': r.control,
      'Toplam': r.total,
    }));
    const fname = `Kumulatif_${selectedHospitalName || 'Lab'}_${String(selectedMonth + 1).padStart(2, '0')}-${selectedYear}`;
    exportDataToExcel(data, fname, 'Kumulatif', toast);
  }, [resultRows, selectedHospitalName, selectedMonth, selectedYear, toast]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Kümülatif Hesaplama (Excel)
          </CardTitle>
          <CardDescription>
            Laboratuvar ve dönem seçildikten sonra testler 0 değerlerle listelenir. Excel içe aktarımıyla kümülatif sayılar doldurulur.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="col-span-1 md:col-span-2">
              <label className="text-sm font-medium">Laboratuvar</label>
              <Select value={selectedHospitalId} onValueChange={setSelectedHospitalId} disabled={isLoading}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={isLoading ? 'Yükleniyor...' : 'Seçiniz'} />
                </SelectTrigger>
                <SelectContent>
                  {hospitals
                    .filter(h => typeof h.id === 'string' && h.id.length > 0)
                    .map(h => (
                      <SelectItem key={h.id!} value={h.id!}>
                        {h.name}
                      </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Ay</label>
              <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map(m => (<SelectItem key={m.value} value={String(m.value)} className="capitalize">{m.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Yıl</label>
              <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEARS.map(y => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Excel Import / Actions */}
          <div className="flex flex-wrap gap-3 items-center">
            <label className="inline-flex items-center">
              <input
                id="excel-upload"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleExcelUpload}
              />
              <Button asChild disabled={!selectedHospitalId || isImporting}>
                <label htmlFor="excel-upload" className="cursor-pointer">
                  <Upload className="h-4 w-4 mr-2" />
                  Excel ile İçe Aktar
                </label>
              </Button>
            </label>

            <Button variant="outline" onClick={exportCurrentToExcel} disabled={resultRows.length === 0}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Excel’e Aktar
            </Button>

            <Button variant="secondary" onClick={() => router.push('/kumulatif-gecmis')}>
              <History className="h-4 w-4 mr-2" />
              Kümülatif Geçmişi
            </Button>

            <Button onClick={handleSaveToHistory} disabled={!selectedHospitalId || resultRows.length === 0}>
              <Save className="h-4 w-4 mr-2" />
              Geçmişe Kaydet
            </Button>
          </div>

          {/* Grid */}
          <Card className="mt-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {selectedHospitalName ? `${selectedHospitalName} – ${MONTHS[selectedMonth].label} ${selectedYear}` : 'Seçim Bekleniyor'}
              </CardTitle>
              <CardDescription>Başlıklar veri gelene kadar 0’dır. Excel içe aktarma ile değerler doldurulur.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[60vh] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Test</TableHead>
                      <TableHead className="text-right">Rutin</TableHead>
                      <TableHead className="text-right">Tekrar</TableHead>
                      <TableHead className="text-right">Kalib.</TableHead>
                      <TableHead className="text-right">Kontrol</TableHead>
                      <TableHead className="text-right">Toplam</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultRows.map(r => (
                      <TableRow key={r.test}>
                        <TableCell className="font-medium">{r.test}</TableCell>
                        <TableCell className="text-right">{r.routine}</TableCell>
                        <TableCell className="text-right">{r.rerun}</TableCell>
                        <TableCell className="text-right">{r.calib}</TableCell>
                        <TableCell className="text-right">{r.control}</TableCell>
                        <TableCell className="text-right">{r.total}</TableCell>
                      </TableRow>
                    ))}
                    {resultRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          Test listesi için laboratuvar seçin.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
