'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Loader2, Upload, Download, Search, X, Calculator, RefreshCw, BarChart3, Pencil } from 'lucide-react';
import TestCostDetailModal from '@/components/TestCostDetailModal';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  writeBatch,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { ProductCode, TestDefinitionGlobal } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { YonetimShell, YonetimHeader, YonetimCard } from '@/components/yonetim-ui/YonetimHub';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery, getScopedDocs } from '@/lib/firestore-helpers';
import { filterByCompanyScope, normalizeCompanyId } from '@/lib/company-scope';
import { getExchangeRates } from '@/lib/exchange-rates';
import { useProductCodes, useTestDefinitions } from '@/hooks/useFirebaseQueries';

const COLLECTION = 'testDefinitions';

/**
 * Excel şablon parser: A=SUT kodu, B=test adı, C=hak ediş, D+=stok kodları.
 */
function parseLinkedStokKodlari(raw: unknown): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseLinkedStokKodlariFromCells(cells: unknown[]): string[] {
  return Array.from(new Set(cells.flatMap(parseLinkedStokKodlari)));
}

function parseHakEdisAmount(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  let value = String(raw ?? '').trim();
  if (!value) return NaN;
  value = value.replace(/₺|tl|try/gi, '').replace(/\s+/g, '');
  const hasComma = value.includes(',');
  const hasDot = value.includes('.');
  if (hasComma && hasDot) {
    // Son ayırıcı ondalık kabul edilir: 1.234,56 veya 1,234.56
    value = value.lastIndexOf(',') > value.lastIndexOf('.')
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(/,/g, '');
  } else if (hasComma) {
    value = value.replace(',', '.');
  }
  value = value.replace(/[^0-9.-]/g, '');
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : NaN;
}


function normHeader(raw: unknown): string {
  return String(raw ?? '').toLowerCase().replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/\s+/g, ' ').trim();
}

function parseCounterAmount(raw: unknown): number {
  const value = parseHakEdisAmount(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function normalizeSutKey(raw: unknown): string {
  return String(raw ?? '').trim().toLocaleUpperCase('tr-TR');
}

type ParsedExcelDefinition = {
  sutKodu: string;
  sutTestAdi: string;
  linkedStokKodlari: string[];
  counterValue: number;
  hakEdisMiktari: number;
};

export default function HakEdisPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();

  const { data: productCodes = [], isLoading: isLoadingProducts } = useProductCodes();
  const { data: testDefs = [], isLoading: isLoadingDefs } = useTestDefinitions();
  
  const loading = {
    products: isLoadingProducts,
    defs: isLoadingDefs
  };

  // Yeni satır ekleme state'leri
  const [newSutKodu, setNewSutKodu] = useState('');
  const [newSutTestAdi, setNewSutTestAdi] = useState('');
  const [newLinkedStokKodlari, setNewLinkedStokKodlari] = useState<string[]>([]);
  const [newCounterValue, setNewCounterValue] = useState('0');
  const [newHakEdisMiktari, setNewHakEdisMiktari] = useState('');
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Arama
  const [searchTerm, setSearchTerm] = useState('');

  // Excel import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateFileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isUpdatingFromExcel, setIsUpdatingFromExcel] = useState(false);

  // Cost detail modal
  const [costDetailFor, setCostDetailFor] = useState<TestDefinitionGlobal | null>(null);
  const [editingProductsForId, setEditingProductsForId] = useState<string | null>(null);
  const [editingLinkedStokKodlari, setEditingLinkedStokKodlari] = useState<string[]>([]);
  const [isUpdatingProducts, setIsUpdatingProducts] = useState(false);

  // Döviz kurları
  const [exchangeRates, setExchangeRates] = useState<{ EUR: number; USD: number; TRY: number } | null>(null);
  useEffect(() => {
    getExchangeRates()
      .then(setExchangeRates)
      .catch(() => setExchangeRates({ EUR: 1, USD: 1.08, TRY: 38.5 }));
  }, []);

  const productMap = useMemo(() => {
    const m = new Map<string, ProductCode>();
    productCodes.forEach((p) => m.set(p.stokKodu, p));
    return m;
  }, [productCodes]);

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  const handleAdd = async () => {
    if (!newSutKodu.trim() || !newSutTestAdi.trim() || !newHakEdisMiktari.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'SUT kodu, test adı ve hak ediş miktarı doldurulmalıdır. Ürün bağlantısı opsiyoneldir.', variant: 'destructive' });
      return;
    }
    const hakEdis = parseHakEdisAmount(newHakEdisMiktari);
    const counterValue = parseCounterAmount(newCounterValue);
    if (isNaN(hakEdis) || hakEdis < 0) {
      toast({ title: 'Geçersiz Değer', description: 'Hak ediş miktarı 0 veya pozitif bir sayı olmalı.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      await addDoc(collection(db, COLLECTION), {
        sutKodu: newSutKodu.trim(),
        sutTestAdi: newSutTestAdi.trim(),
        linkedStokKodlari: newLinkedStokKodlari,
        counterValue,
        hakEdisMiktari: hakEdis,
        currency: 'TRY',
        aktif: true,
        createdAt: serverTimestamp(),
        createdByUid: currentUserProfile?.uid ?? null,
        createdByName: currentUserProfile?.name ?? currentUserProfile?.email ?? null,
        companyId: normalizeCompanyId(currentUserProfile?.companyId || currentCompanyId),
      });
      toast({ title: 'Başarılı', description: 'Test tanımı eklendi.' });
      setNewSutKodu('');
      setNewSutTestAdi('');
      setNewLinkedStokKodlari([]);
      setNewCounterValue('0');
      setNewHakEdisMiktari('');
    } catch (e) {
      console.error('add error', e);
      toast({ title: 'Hata', description: 'Tanım eklenemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu test tanımını silmek istediğinizden emin misiniz?')) return;
    try {
      await deleteDoc(doc(db, COLLECTION, id));
      toast({ title: 'Silindi', description: 'Test tanımı silindi.' });
    } catch (e) {
      console.error('delete error', e);
      toast({ title: 'Hata', description: 'Silinemedi.', variant: 'destructive' });
    }
  };

  const toggleStokKodu = (stokKodu: string) => {
    setNewLinkedStokKodlari((cur) => (cur.includes(stokKodu) ? cur.filter((x) => x !== stokKodu) : [...cur, stokKodu]));
  };

  const removeStokKodu = (stokKodu: string) => {
    setNewLinkedStokKodlari((cur) => cur.filter((x) => x !== stokKodu));
  };

  const startEditingProducts = (definition: TestDefinitionGlobal) => {
    setEditingProductsForId(definition.id);
    setEditingLinkedStokKodlari([...(definition.linkedStokKodlari || [])]);
  };

  const toggleEditingStokKodu = (stokKodu: string) => {
    setEditingLinkedStokKodlari((cur) => (cur.includes(stokKodu) ? cur.filter((x) => x !== stokKodu) : [...cur, stokKodu]));
  };

  const removeEditingStokKodu = (stokKodu: string) => {
    setEditingLinkedStokKodlari((cur) => cur.filter((x) => x !== stokKodu));
  };

  const handleUpdateLinkedProducts = async (definition: TestDefinitionGlobal) => {
    setIsUpdatingProducts(true);
    try {
      const uniqueLinkedStokKodlari = Array.from(new Set(editingLinkedStokKodlari));
      await updateDoc(doc(db, COLLECTION, definition.id), {
        linkedStokKodlari: uniqueLinkedStokKodlari,
        updatedAt: serverTimestamp(),
        updatedByUid: currentUserProfile?.uid ?? null,
        updatedByName: currentUserProfile?.name ?? currentUserProfile?.email ?? null,
      });
      toast({ title: 'Başarılı', description: 'Teste bağlı ürünler güncellendi.' });
      setEditingProductsForId(null);
      setEditingLinkedStokKodlari([]);
    } catch (e) {
      console.error('linked products update error', e);
      toast({ title: 'Hata', description: 'Teste bağlı ürünler güncellenemedi.', variant: 'destructive' });
    } finally {
      setIsUpdatingProducts(false);
    }
  };

  // -------------------------------------------------------------------------
  // Excel
  // -------------------------------------------------------------------------

  async function parseExcelDefinitions(file: File): Promise<{ parsedRows: ParsedExcelDefinition[]; skipped: number; skipReasons: string[] }> {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
    const header = (rows[0] || []).map(normHeader);
    const sutIdx = header.findIndex((h) => h.includes('sut')) >= 0 ? header.findIndex((h) => h.includes('sut')) : 0;
    const counterIdx = header.findIndex((h) => h.includes('counter'));
    const hakIdxFromHeader = header.findIndex((h) => h.includes('hak'));
    const hakIdx = hakIdxFromHeader >= 0 ? hakIdxFromHeader : (counterIdx >= 0 ? 3 : 2);
    const testIdxFromHeader = header.findIndex((h, i) => i !== sutIdx && h.includes('test') && !h.includes('counter'));
    const testIdx = testIdxFromHeader >= 0 ? testIdxFromHeader : 1;
    const stockHeaderIdxs = header
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.includes('stok'))
      .map(({ i }) => i);
    const firstStockIdx = Math.max(sutIdx, testIdx, hakIdx, counterIdx) + 1;
    const dataRows = rows.slice(1).filter((r) => r && r.length >= 3 && r[sutIdx]);

    let skipped = 0;
    const skipReasons: string[] = [];
    const parsedRows: ParsedExcelDefinition[] = [];
    const seenInFile = new Set<string>();

    for (const r of dataRows) {
      const sutKodu = String(r[sutIdx] || '').trim();
      const sutTestAdi = String(r[testIdx] || '').trim();
      const counterValue = counterIdx >= 0 ? parseCounterAmount(r[counterIdx]) : 0;
      const hakEdis = parseHakEdisAmount(r[hakIdx]);
      const stockCells = stockHeaderIdxs.length > 0 ? stockHeaderIdxs.map((idx) => r[idx]) : r.slice(firstStockIdx);
      const stokKodlari = parseLinkedStokKodlariFromCells(stockCells);
      const sutKey = normalizeSutKey(sutKodu);

      if (!sutKodu || !sutTestAdi || isNaN(hakEdis) || hakEdis < 0) {
        skipped++;
        skipReasons.push(`${sutKodu || '(boş)'}: geçersiz değer`);
        continue;
      }
      if (seenInFile.has(sutKey)) {
        skipped++;
        skipReasons.push(`${sutKodu}: Excel içinde mükerrer SUT kodu, sonraki satır atlandı`);
        continue;
      }
      seenInFile.add(sutKey);

      // Sistemde olmayan stok kodlarını filtrele; stok kodu yazılmamışsa tanım ürünsüz oluşturulabilir.
      const validStokKodlari = stokKodlari.filter((k) => productMap.has(k));
      const missing = stokKodlari.filter((k) => !productMap.has(k));
      if (stokKodlari.length > 0 && validStokKodlari.length === 0) {
        skipped++;
        skipReasons.push(`${sutKodu}: yazılan stok kodlarının hiçbiri sistemde yok (${missing.join(', ')})`);
        continue;
      }
      if (missing.length > 0) {
        skipReasons.push(`${sutKodu}: sistemde olmayan stok kodları atlandı (${missing.join(', ')})`);
      }

      parsedRows.push({
        sutKodu,
        sutTestAdi,
        linkedStokKodlari: validStokKodlari,
        counterValue,
        hakEdisMiktari: hakEdis,
      });
    }

    return { parsedRows, skipped, skipReasons };
  }

  const buildDefinitionPayload = (row: ParsedExcelDefinition) => ({
    sutKodu: row.sutKodu,
    sutTestAdi: row.sutTestAdi,
    linkedStokKodlari: row.linkedStokKodlari,
    counterValue: row.counterValue,
    hakEdisMiktari: row.hakEdisMiktari,
    currency: 'TRY',
    aktif: true,
    companyId: normalizeCompanyId(currentUserProfile?.companyId || currentCompanyId),
  });

  const handleExcelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const { parsedRows, skipped, skipReasons } = await parseExcelDefinitions(file);

      if (parsedRows.length === 0) {
        toast({ title: 'Uyarı', description: 'Excel dosyasında geçerli veri yok.', variant: 'destructive' });
        return;
      }

      const batch = writeBatch(db);
      let added = 0;

      for (const row of parsedRows) {
        const ref = doc(collection(db, COLLECTION));
        batch.set(ref, {
          ...buildDefinitionPayload(row),
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid ?? null,
          createdByName: currentUserProfile?.name ?? currentUserProfile?.email ?? null,
        });
        added++;
      }

      if (added > 0) await batch.commit();
      const msg = [`${added} tanım eklendi`, skipped > 0 ? `${skipped} satır atlandı` : ''].filter(Boolean).join(', ');
      toast({ title: 'İçe Aktarma', description: msg });
      if (skipReasons.length > 0) console.warn('Atlanan satırlar:', skipReasons);
    } catch (e) {
      console.error('import error', e);
      toast({ title: 'Hata', description: 'Excel dosyası işlenemedi.', variant: 'destructive' });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExcelUpdate = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUpdatingFromExcel(true);
    try {
      const { parsedRows, skipped, skipReasons } = await parseExcelDefinitions(file);

      if (parsedRows.length === 0) {
        toast({ title: 'Uyarı', description: 'Excel dosyasında geçerli veri yok.', variant: 'destructive' });
        return;
      }

      const defsBySut = new Map<string, TestDefinitionGlobal[]>();
      testDefs.forEach((def) => {
        const key = normalizeSutKey(def.sutKodu);
        defsBySut.set(key, [...(defsBySut.get(key) || []), def]);
      });

      const batch = writeBatch(db);
      let updated = 0;
      let added = 0;
      let duplicateDeleted = 0;

      for (const row of parsedRows) {
        const key = normalizeSutKey(row.sutKodu);
        const existing = defsBySut.get(key) || [];
        const payload = buildDefinitionPayload(row);

        if (existing.length > 0) {
          const primary = existing[0];
          batch.update(doc(db, COLLECTION, primary.id), {
            ...payload,
            updatedAt: serverTimestamp(),
            updatedByUid: currentUserProfile?.uid ?? null,
            updatedByName: currentUserProfile?.name ?? currentUserProfile?.email ?? null,
          });
          updated++;

          existing.slice(1).forEach((duplicate) => {
            batch.delete(doc(db, COLLECTION, duplicate.id));
            duplicateDeleted++;
          });
        } else {
          const ref = doc(collection(db, COLLECTION));
          batch.set(ref, {
            ...payload,
            createdAt: serverTimestamp(),
            createdByUid: currentUserProfile?.uid ?? null,
            createdByName: currentUserProfile?.name ?? currentUserProfile?.email ?? null,
          });
          added++;
        }
      }

      await batch.commit();
      const msg = [
        `${updated} tanım güncellendi`,
        added > 0 ? `${added} yeni tanım eklendi` : '',
        duplicateDeleted > 0 ? `${duplicateDeleted} mükerrer kayıt temizlendi` : '',
        skipped > 0 ? `${skipped} satır atlandı` : '',
      ].filter(Boolean).join(', ');
      toast({ title: 'Excel Güncelleme', description: msg });
      if (skipReasons.length > 0) console.warn('Atlanan satırlar:', skipReasons);
    } catch (e) {
      console.error('update import error', e);
      toast({ title: 'Hata', description: 'Excel güncellemesi işlenemedi.', variant: 'destructive' });
    } finally {
      setIsUpdatingFromExcel(false);
      if (updateFileInputRef.current) updateFileInputRef.current.value = '';
    }
  };

  const handleExcelExport = () => {
    const maxLinkedCount = Math.max(1, ...testDefs.map((d) => (d.linkedStokKodlari || []).length));
    const rows = testDefs.map((d) => {
      const row: Record<string, any> = {
        'SUT Kodu': d.sutKodu,
        'SUT Test Adı': d.sutTestAdi,
        Counter: d.counterValue || 0,
        'Hak Ediş (TL)': d.hakEdisMiktari,
      };
      for (let i = 0; i < maxLinkedCount; i++) {
        row[`Stok Kodu ${i + 1}`] = (d.linkedStokKodlari || [])[i] || '';
      }
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Test Tanımları');
    XLSX.writeFile(wb, `test_tanimlari_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      ['SUT Kodu', 'SUT Test Adı', 'Counter', 'Hak Ediş (TL)', 'Stok Kodu 1', 'Stok Kodu 2', 'Stok Kodu 3'],
      ['900.010', 'Glikoz Tayini', 0, 5.5, 'STOK001', 'STOK002', ''],
      ['900.020', 'Hemogram', 0, 8.0, 'STOK010', '', ''],
      ['900.030', 'Ürünsüz Tanım Örneği', 0, 4.25, '', '', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Şablon');
    XLSX.writeFile(wb, 'test_tanimlari_sablon.xlsx');
  };

  // -------------------------------------------------------------------------
  // Filtre + özet
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    if (!searchTerm) return testDefs;
    const t = searchTerm.toLowerCase();
    return testDefs.filter((d) => {
      if (d.sutKodu.toLowerCase().includes(t)) return true;
      if (d.sutTestAdi.toLowerCase().includes(t)) return true;
      if ((d.linkedStokKodlari || []).some((k) => k.toLowerCase().includes(t))) return true;
      if (
        (d.linkedStokKodlari || []).some((k) => {
          const name = productMap.get(k)?.stokAdi?.toLowerCase() || '';
          return name.includes(t);
        })
      )
        return true;
      return false;
    });
  }, [testDefs, searchTerm, productMap]);

  const totalHakEdis = testDefs.reduce((s, d) => s + (Number(d.hakEdisMiktari) || 0), 0);

  return (
    <YonetimShell>
      <YonetimHeader
        title="Hak Ediş Paneli"
        description="Sistem genelinde SUT kodlarına göre test tanımlamaları. Her test bir veya birden çok ürüne bağlanabilir; tanımlar laboratuvardan bağımsızdır."
        backHref="/yonetim/tanimlar"
      />
      <YonetimCard>
        <div className="space-y-6">
          {/* Özet rozetler */}
          <div className="flex flex-wrap gap-4 items-center">
            <Badge variant="outline" className="px-4 py-2 text-base">
              {testDefs.length} test tanımı
            </Badge>
            <Badge variant="outline" className="px-4 py-2 text-base bg-amber-50 text-amber-700">
              Toplam Hak Ediş: ₺{totalHakEdis.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </Badge>
            {exchangeRates && (
              <>
                <Badge variant="outline" className="px-4 py-2 text-sm">
                  €{(totalHakEdis / exchangeRates.TRY).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Badge>
                <Badge variant="outline" className="px-4 py-2 text-sm">
                  ${((totalHakEdis / exchangeRates.TRY) * exchangeRates.USD).toLocaleString('tr-TR', {
                    minimumFractionDigits: 2,
                  })}
                </Badge>
              </>
            )}
          </div>

          {/* İşlem butonları */}
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={handleExcelImport} />
            <input ref={updateFileInputRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={handleExcelUpdate} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isImporting || isUpdatingFromExcel || loading.products}>
              {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Excel ile Yeni Ekle
            </Button>
            <Button variant="outline" onClick={() => updateFileInputRef.current?.click()} disabled={isImporting || isUpdatingFromExcel || loading.products}>
              {isUpdatingFromExcel ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Excel ile Güncelle
            </Button>
            <Button variant="outline" onClick={handleExcelExport} disabled={testDefs.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Excel'e Aktar
            </Button>
            <Button variant="outline" onClick={handleDownloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Şablon İndir
            </Button>
            <Button variant="outline" onClick={() => router.push('/yonetim/test-yonetimi/counter-analiz')}>
              <BarChart3 className="h-4 w-4 mr-2" />
              Counter Analiz
            </Button>
          </div>

          {/* Yeni satır ekleme */}
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-lg">Yeni Test Tanımı Ekle</CardTitle>
              <CardDescription>Bir teste ürün bağlanmayabilir ya da istenen sayıda ürün bağlanabilir.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-4 items-start">
              <Input
                placeholder="SUT Kodu (örn: 900.010)"
                value={newSutKodu}
                onChange={(e) => setNewSutKodu(e.target.value)}
              />
              <Input
                placeholder="SUT Test Adı"
                value={newSutTestAdi}
                onChange={(e) => setNewSutTestAdi(e.target.value)}
              />

              {/* Çoklu ürün seçici */}
              <div className="flex flex-col gap-2 md:col-span-1">
                <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                      {newLinkedStokKodlari.length === 0 ? 'Ürün(ler) Seçin (opsiyonel)' : `${newLinkedStokKodlari.length} ürün`}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Ürün adı veya kodu ara..." />
                      <CommandList>
                        <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                        <CommandGroup>
                          {productCodes.map((p) => {
                            const checked = newLinkedStokKodlari.includes(p.stokKodu);
                            return (
                              <CommandItem
                                key={p.id}
                                value={`${p.stokAdi} ${p.stokKodu} ${p.testAdi || ''}`}
                                onSelect={() => toggleStokKodu(p.stokKodu)}
                              >
                                <Check className={cn('mr-2 h-4 w-4', checked ? 'opacity-100' : 'opacity-0')} />
                                <div className="flex flex-col">
                                  <span>{p.stokAdi}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {p.stokKodu} {p.testAdi && `• ${p.testAdi}`}
                                  </span>
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {/* Seçili rozetler */}
                {newLinkedStokKodlari.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {newLinkedStokKodlari.map((k) => (
                      <Badge key={k} variant="secondary" className="gap-1">
                        <span className="font-mono text-xs">{k}</span>
                        <button
                          type="button"
                          onClick={() => removeStokKodu(k)}
                          className="hover:text-destructive"
                          aria-label={`${k} kaldır`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <Input
                placeholder="Counter başlangıç"
                value={newCounterValue}
                onChange={(e) => setNewCounterValue(e.target.value)}
                type="text"
                inputMode="numeric"
              />

              <Input
                placeholder="Hak Ediş (TL)"
                value={newHakEdisMiktari}
                onChange={(e) => setNewHakEdisMiktari(e.target.value)}
                type="text"
                inputMode="decimal"
              />
              <Button onClick={handleAdd} disabled={isSaving || loading.products}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Ekle
              </Button>
            </CardContent>
          </Card>

          {/* Arama */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="SUT kodu, test adı, ürün ile ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Liste */}
          <Card className="border">
            <CardHeader className="py-3">
              <CardTitle className="text-lg">
                Tanımlı Testler
                {searchTerm && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({filtered.length}/{testDefs.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {loading.defs ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Yükleniyor...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center text-muted-foreground p-8">
                    {searchTerm ? 'Aramayla eşleşen tanım bulunamadı.' : 'Henüz test tanımı yok.'}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">SUT Kodu</TableHead>
                        <TableHead>SUT Test Adı</TableHead>
                        <TableHead>Bağlı Ürünler</TableHead>
                        <TableHead className="text-right w-[120px]">Counter</TableHead>
                        <TableHead className="text-right w-[150px]">Hak Ediş (TL)</TableHead>
                        <TableHead className="text-right w-[140px]">İşlem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono font-medium">{d.sutKodu}</TableCell>
                          <TableCell>{d.sutTestAdi}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-2">
                              <div className="flex flex-wrap gap-1">
                                {(d.linkedStokKodlari || []).length === 0 ? (
                                  <span className="text-xs text-muted-foreground">Ürün bağlantısı yok</span>
                                ) : (d.linkedStokKodlari || []).map((k) => {
                                  const p = productMap.get(k);
                                  return (
                                    <Badge key={k} variant="outline" className="gap-1">
                                      <span className="text-xs">{p?.stokAdi || k}</span>
                                      <span className="font-mono text-[10px] text-muted-foreground">{k}</span>
                                    </Badge>
                                  );
                                })}
                              </div>
                              <Popover
                                open={editingProductsForId === d.id}
                                onOpenChange={(open) => {
                                  if (open) {
                                    startEditingProducts(d);
                                  } else {
                                    setEditingProductsForId(null);
                                    setEditingLinkedStokKodlari([]);
                                  }
                                }}
                              >
                                <PopoverTrigger asChild>
                                  <Button variant="outline" size="sm" className="w-fit gap-2" disabled={loading.products}>
                                    <Pencil className="h-3.5 w-3.5" /> Ürünleri Düzenle
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-96 p-3" align="start">
                                  <div className="space-y-3">
                                    <div>
                                      <div className="text-sm font-medium">Bağlı ürünleri düzenle</div>
                                      <div className="text-xs text-muted-foreground">Ürün ekleyebilir veya mevcut ürünleri çıkarabilirsiniz.</div>
                                    </div>
                                    {editingLinkedStokKodlari.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {editingLinkedStokKodlari.map((k) => (
                                          <Badge key={k} variant="secondary" className="gap-1">
                                            <span className="text-xs">{productMap.get(k)?.stokAdi || k}</span>
                                            <span className="font-mono text-[10px] text-muted-foreground">{k}</span>
                                            <button
                                              type="button"
                                              onClick={() => removeEditingStokKodu(k)}
                                              className="hover:text-destructive"
                                              aria-label={`${k} kaldır`}
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          </Badge>
                                        ))}
                                      </div>
                                    )}
                                    <Command>
                                      <CommandInput placeholder="Ürün adı veya kodu ara..." />
                                      <CommandList className="max-h-64">
                                        <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                                        <CommandGroup>
                                          {productCodes.map((p) => {
                                            const checked = editingLinkedStokKodlari.includes(p.stokKodu);
                                            return (
                                              <CommandItem
                                                key={p.id}
                                                value={`${p.stokAdi} ${p.stokKodu} ${p.testAdi || ''}`}
                                                onSelect={() => toggleEditingStokKodu(p.stokKodu)}
                                              >
                                                <Check className={cn('mr-2 h-4 w-4', checked ? 'opacity-100' : 'opacity-0')} />
                                                <div className="flex flex-col">
                                                  <span>{p.stokAdi}</span>
                                                  <span className="text-xs text-muted-foreground">
                                                    {p.stokKodu} {p.testAdi && `• ${p.testAdi}`}
                                                  </span>
                                                </div>
                                              </CommandItem>
                                            );
                                          })}
                                        </CommandGroup>
                                      </CommandList>
                                    </Command>
                                    <div className="flex justify-end gap-2">
                                      <Button variant="outline" size="sm" onClick={() => setEditingProductsForId(null)} disabled={isUpdatingProducts}>
                                        Vazgeç
                                      </Button>
                                      <Button size="sm" onClick={() => handleUpdateLinkedProducts(d)} disabled={isUpdatingProducts}>
                                        {isUpdatingProducts && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                        Kaydet
                                      </Button>
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {Number(d.counterValue || 0).toLocaleString('tr-TR')}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-amber-700">
                            ₺{Number(d.hakEdisMiktari || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Maliyet Detayı"
                              onClick={() => setCostDetailFor(d)}
                            >
                              <Calculator className="h-4 w-4 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </YonetimCard>

      <TestCostDetailModal
        open={!!costDetailFor}
        onOpenChange={(o) => !o && setCostDetailFor(null)}
        testDef={costDetailFor}
        allTestDefs={testDefs}
      />
    </YonetimShell>
  );
}
