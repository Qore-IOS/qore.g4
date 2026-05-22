
'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent
} from '@/components/ui/card';
import {
  Table, TableHeader, TableHead, TableBody, TableRow, TableCell
} from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { LabSelector } from '@/components/common/LabSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, doc, writeBatch, Timestamp, deleteDoc } from 'firebase/firestore';
import type { DepoStokItem, Laboratory, ProductCode, MinMaxRule } from '@/lib/types';
import { Loader2, Search, ChevronUp, ChevronDown, ListChecks, History, PackageX, FileText } from 'lucide-react';
import { useMinMaxRules, touchStockMetadata } from '@/hooks/useFirebaseQueries';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { useToast } from '@/hooks/use-toast';
import LabIrsaliyeOcrModal, { type LabOcrResult } from '@/components/lab/LabIrsaliyeOcrModal';
import { reconcileIrsaliyeAcceptance } from '@/lib/lojistik/reconcile-irsaliye';
import { normalizeMiad } from '@/lib/date';
import { formatMiad } from '@/lib/date';
import { differenceInDays, parse, isValid } from 'date-fns';
import { cn } from '@/lib/utils';

type MiadSeverity = 'normal' | 'notice' | 'caution' | 'warning' | 'critical' | 'expired';

function getMiadInfoFromString(miadStr: string): { days: number; severity: MiadSeverity } {
  if (!miadStr) return { days: Infinity, severity: 'normal' };
  const miadDate = parse(miadStr, 'dd.MM.yyyy', new Date());
  if (!isValid(miadDate)) return { days: Infinity, severity: 'normal' };
  const days = differenceInDays(miadDate, new Date());
  if (days < 0) return { days, severity: 'expired' };
  if (days <= 3) return { days, severity: 'critical' };
  if (days <= 10) return { days, severity: 'warning' };
  if (days < 45) return { days, severity: 'caution' };
  if (days < 60) return { days, severity: 'notice' };
  return { days, severity: 'normal' };
}

function getRowStripeColor(miadSeverity: MiadSeverity): string {
  if (miadSeverity === 'expired' || miadSeverity === 'critical') return 'bg-red-500';
  if (miadSeverity === 'warning' || miadSeverity === 'caution') return 'bg-amber-500';
  if (miadSeverity === 'notice') return 'bg-yellow-400';
  return 'bg-transparent';
}

function normalizeKey(key: string): string {
  return key
    .replace(/\s+/g, '')
    .replace(/İ/g, 'i').replace(/I/g, 'i')
    .replace(/Ş/g, 's').replace(/ş/g, 's')
    .replace(/Ç/g, 'c').replace(/ç/g, 'c')
    .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u').replace(/ü/g, 'u')
    .replace(/Ö/g, 'o').replace(/ö/g, 'o')
    .replace(/ı/g, 'i')
    .toLowerCase();
}

type ColumnRole = 'stokKodu' | 'stokAdi' | 'lot' | 'miad' | 'seri' | 'adet';

/**
 * Inspect the header row of an Excel sheet and produce a mapping from
 * each role (stokKodu, miad, ...) to the original header name in the
 * sheet. Uses keyword matching against normalized header names so users
 * can use variations like "Miat" / "Miad", "Barkod Seri" / "Seri No",
 * "Lot Numarası" / "Lot", etc.
 */
function detectExcelColumns(headers: string[]): Partial<Record<ColumnRole, string>> {
  const result: Partial<Record<ColumnRole, string>> = {};
  for (const header of headers) {
    const norm = normalizeKey(header);
    if (!result.stokKodu && (norm.includes('stokkodu') || norm === 'kod' || norm === 'sku' || norm === 'urunkodu')) {
      result.stokKodu = header;
      continue;
    }
    if (!result.stokAdi && (norm.includes('stokadi') || norm.includes('urunadi') || norm === 'urun' || norm === 'aciklama')) {
      result.stokAdi = header;
      continue;
    }
    if (!result.lot && (norm.includes('lot') || norm.includes('parti') || norm.includes('batch'))) {
      result.lot = header;
      continue;
    }
    if (
      !result.miad &&
      (norm.includes('miad') || norm.includes('miat') || norm.includes('skt') ||
        norm.includes('sonkullanma') || norm.includes('expir') || norm.includes('sonkul'))
    ) {
      result.miad = header;
      continue;
    }
    if (
      !result.seri &&
      (norm.includes('seri') || norm.includes('barkod') || norm.includes('serial') ||
        norm.includes('udi'))
    ) {
      result.seri = header;
      continue;
    }
    if (
      !result.adet &&
      (norm.includes('adet') || norm.includes('miktar') || norm.includes('kutu') ||
        norm === 'qty' || norm.includes('quantity'))
    ) {
      result.adet = header;
      continue;
    }
  }
  return result;
}

type ParsedExcelRow = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi: string;
  adet: number;
  valid: boolean;
  error?: string;
};

const SortableHeader: React.FC<{
  label: string;
  field: keyof GroupedStockItem;
  sortField: keyof GroupedStockItem;
  sortAsc: boolean;
  onClick: (field: keyof GroupedStockItem) => void;
}> = ({ label, field, sortField, sortAsc, onClick }) => {
  const isActive = sortField === field;
  return (
    <TableHead onClick={() => onClick(field)} className="cursor-pointer hover:bg-muted/50">
      <div className="flex items-center">
        {label}
        {isActive && (sortAsc ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />)}
      </div>
    </TableHead>
  );
};


type GroupedStockItem = {
    groupKey: string;
    stokKodu: string;
    stokAdi: string;
    lot: string;
    miad: string;
    quantity: number;
    firstId: string;
};

export default function LaboratuvarYonetimiPanel() {
  const router = useRouter();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<keyof GroupedStockItem>('stokAdi');
  const [sortAsc, setSortAsc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const { data: minMaxRulesData } = useMinMaxRules(selectedLabId || null);

  const minMaxMap = useMemo(() => {
    const map: Record<string, MinMaxRule> = {};
    if (minMaxRulesData) {
      minMaxRulesData.forEach(rule => {
        map[rule.stokKodu] = rule;
      });
    }
    return map;
  }, [minMaxRulesData]);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      const [labsSnap, stokSnap, productsSnap] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(query(collection(db, 'depoStok'), where('isShipped', '==', true))),
        getDocs(collection(db, 'productCodes'))
      ]);
      setLaboratories(labsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Laboratory)));
      setDepoStok(filterByCompanyScope(
        stokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
        currentCompanyId,
        isSuperAdmin,
      ));
      
      const names: Record<string, string> = {};
      const codes: ProductCode[] = [];
      productsSnap.docs.forEach(d => {
        const p = { id: d.id, ...d.data() } as ProductCode;
        codes.push(p);
        if (p.stokKodu) names[p.stokKodu] = p.stokAdi || p.stokKodu;
      });
      setProductNames(names);
      setProductCodes(codes);

      setIsLoading(false);
    }
    fetchData();
  }, [currentCompanyId, isSuperAdmin]);

  const labStocks = useMemo(() => {
    if (!selectedLabId) return [];
    const selectedLab = laboratories.find(l => l.id === selectedLabId);
    const selectedLabName = selectedLab?.name || '';

    // Filter by hedefKurumId OR by hedefKurum (name) for legacy records
    // that may have hedefKurum set but hedefKurumId is null/undefined
    // CRITICAL: Also check isShipped to ensure only transferred items are shown
    return depoStok.filter(item =>
      item.isShipped === true &&
      (item.hedefKurumId === selectedLabId ||
      (!item.hedefKurumId && item.hedefKurum === selectedLabName))
    );
  }, [depoStok, selectedLabId, laboratories]);

  const groupedMap = useMemo(() => {
    const map: Record<string, {
      stokKodu: string; stokAdi: string; lot: string; miad: string; items: DepoStokItem[]
    }> = {};
    labStocks.forEach(item => {
      const key = `${item.stokKodu}_${item.lotNumarasi}_${item.miad}`;
      if (!map[key]) {
        map[key] = {
          stokKodu: item.stokKodu,
          stokAdi: productNames[item.stokKodu] || item.stokAdi || item.stokKodu,
          lot: item.lotNumarasi ?? '',
          miad: formatMiad(item.miad),
          items: []
        };
      }
      map[key].items.push(item);
    });
    return map;
  }, [labStocks, productNames]);

  const summaryList = useMemo(
    () => Object.entries(groupedMap).map(([groupKey, grp]) => ({
      groupKey,
      stokKodu: grp.stokKodu,
      stokAdi: grp.stokAdi,
      lot: grp.lot,
      miad: grp.miad,
      quantity: grp.items.length,
      firstId: grp.items[0].id
    })),
    [groupedMap]
  );

  const outOfStockItems = useMemo(() => {
    if (!showOutOfStock || !minMaxRulesData) return [];
    const inStockCodes = new Set(summaryList.map(r => r.stokKodu));
    return minMaxRulesData
      .filter(rule => !inStockCodes.has(rule.stokKodu))
      .map(rule => ({
        groupKey: `__oos__${rule.stokKodu}`,
        stokKodu: rule.stokKodu,
        stokAdi: productNames[rule.stokKodu] || rule.stokKodu,
        lot: '',
        miad: '',
        quantity: 0,
        firstId: '',
      }));
  }, [showOutOfStock, minMaxRulesData, summaryList, productNames]);

  const combinedList = useMemo(
    () => [...summaryList, ...outOfStockItems],
    [summaryList, outOfStockItems]
  );

  const filtered = useMemo(() => {
    if (!searchQuery) return combinedList;
    const q = searchQuery.toLowerCase();
    return combinedList.filter(row =>
      row.stokKodu.toLowerCase().includes(q) ||
      row.stokAdi.toLowerCase().includes(q) ||
      row.lot.toLowerCase().includes(q) ||
      row.miad.toLowerCase().includes(q) ||
      (groupedMap[row.groupKey]?.items.some(item =>
        item.seriNumarasi?.toLowerCase().includes(q)
      ) ?? false)
    );
  }, [searchQuery, combinedList, groupedMap]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB));
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [filtered, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return sorted.slice(start, start + rowsPerPage);
  }, [sorted, currentPage, rowsPerPage]);

  const onHeaderClick = (field: keyof GroupedStockItem) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
    setCurrentPage(1);
  };
  const goToDetail = (id: string) => router.push(`/laboratuvar-yonetimi/${id}`);

  const selectedLabName = useMemo(() => {
    return allLaboratories.find(l => l.id === selectedLabId)?.name || '';
  }, [allLaboratories, selectedLabId]);

  const stockIsLoading = isLoading || labPoolsLoading || labStockLoading;

  // --- Excel Import Logic ---

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsingExcel(true);
    setParsedRows([]);

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { raw: false, dateNF: 'dd.mm.yyyy' });

      // Build product lookup
      const productMap = new Map<string, ProductCode>();
      products.forEach(p => {
        if (p.stokKodu) productMap.set(p.stokKodu.trim().toUpperCase(), p);
      });

      // Detect column roles from the very first row's keys. Excel headers
      // can be "Stok Kodu / Barkod Seri / Miat / Lot" or any reasonable
      // variation; we use keyword matching so users don't need to use a
      // single canonical header set.
      const headerKeys = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
      const colMap = detectExcelColumns(headerKeys);

      // Positional fallback when the file has no recognizable headers.
      // Order: A=Stok Kodu, B=Barkod Seri, C=Miat, D=Lot, E=Adet.
      const positional = headerKeys;
      const positionalRole = (role: ColumnRole, index: number): string | undefined =>
        colMap[role] ?? positional[index];

      const rows: ParsedExcelRow[] = [];

      for (const rawRow of jsonData) {
        // Resolve each value by its detected header (with positional fallback).
        const stokKoduHeader = positionalRole('stokKodu', 0);
        const seriHeader = positionalRole('seri', 1);
        const miadHeader = positionalRole('miad', 2);
        const lotHeader = positionalRole('lot', 3);
        const adetHeader = colMap.adet; // No positional default; presence is optional
        const stokAdiHeader = colMap.stokAdi;

        const stokKodu = String((stokKoduHeader && rawRow[stokKoduHeader]) || '').trim();
        if (!stokKodu) continue;

        const product = productMap.get(stokKodu.toUpperCase());
        const stokAdi = String(
          (stokAdiHeader && rawRow[stokAdiHeader]) || product?.stokAdi || stokKodu,
        ).trim();
        const lotNumarasi = String((lotHeader && rawRow[lotHeader]) || '').trim();
        const miadRawValue = String((miadHeader && rawRow[miadHeader]) || '').trim();
        const miadRaw = miadRawValue ? normalizeMiad(miadRawValue) : '';
        const seriNumarasi = String((seriHeader && rawRow[seriHeader]) || '').trim();
        const adetRaw = (adetHeader && rawRow[adetHeader]) || '1';
        const adet = Math.max(1, Math.floor(Number(adetRaw) || 1));

        // Validate stokKodu exists in productCodes
        let valid = true;
        let error: string | undefined;
        if (!product) {
          valid = false;
          error = `"${stokKodu}" stok kodu tanımlı değil`;
        }

        // If serial number provided, quantity must be 1
        if (seriNumarasi && adet > 1) {
          valid = false;
          error = 'Seri numarası girildiğinde adet 1 olmalıdır';
        }

        rows.push({
          stokKodu: product?.stokKodu || stokKodu,
          stokAdi: product?.stokAdi || stokAdi,
          lotNumarasi,
          miad: miadRaw,
          seriNumarasi,
          adet: seriNumarasi ? 1 : adet,
          valid,
          error,
        });
      }

      setParsedRows(rows);
      setIsImportModalOpen(true);
    } catch (error) {
      toast({ title: 'Excel Okuma Hatası', description: 'Dosya işlenirken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsParsingExcel(false);
      if (event.target) event.target.value = '';
    }
  }, [products, toast]);

  const validRows = useMemo(() => parsedRows.filter(r => r.valid), [parsedRows]);
  const invalidRows = useMemo(() => parsedRows.filter(r => !r.valid), [parsedRows]);

  const handleImportConfirm = useCallback(async () => {
    if (validRows.length === 0 || !selectedLabId) return;

    setIsImporting(true);
    setImportProgress('Stok ekleniyor...');

    try {
      const BATCH_SIZE = 450;
      let written = 0;
      const totalDocs = validRows.reduce((sum, r) => sum + r.adet, 0);

      // Flatten rows: for each row, create `adet` number of depoStok documents
      const docsToWrite: Array<{
        stokKodu: string;
        stokAdi: string;
        lotNumarasi: string;
        miad: string;
        seriNumarasi: string;
      }> = [];

      for (const row of validRows) {
        for (let i = 0; i < row.adet; i++) {
          docsToWrite.push({
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            lotNumarasi: row.lotNumarasi,
            miad: row.miad,
            seriNumarasi: row.seriNumarasi,
          });
        }
      }

      for (let i = 0; i < docsToWrite.length; i += BATCH_SIZE) {
        const chunk = docsToWrite.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);

        for (const item of chunk) {
          const docRef = doc(collection(db, 'depoStok'));
          batch.set(docRef, withCompanyScope({
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            lotNumarasi: item.lotNumarasi || null,
            miad: item.miad || null,
            seriNumarasi: item.seriNumarasi || null,
            isShipped: true,
            hedefKurumId: selectedLabId,
            hedefKurum: selectedLabName,
            eklenmeTarihi: Timestamp.now(),
            sevkTarihi: Timestamp.now(),
            kaynak: 'excel_import',
          }, currentCompanyId));
        }

        await batch.commit();
        written += chunk.length;
        setImportProgress(`Stok ekleniyor... (${written}/${totalDocs})`);
      }

      // Invalidate cache and touch metadata
      await touchStockMetadata();
      invalidateDepoStok();

      toast({
        title: 'Stok Ekleme Başarılı',
        description: `${totalDocs} adet ürün laboratuvar stoğuna eklendi.`,
      });

      setIsImportModalOpen(false);
      setParsedRows([]);
    } catch (error) {
      toast({ title: 'Stok Ekleme Hatası', description: 'Kayıt sırasında bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsImporting(false);
      setImportProgress('');
    }
  }, [validRows, selectedLabId, selectedLabName, currentCompanyId, toast, invalidateDepoStok]);

  const handleOcrResults = useCallback(async (
    results: LabOcrResult[],
    file: { id: string; storagePath: string; fileName: string }
  ) => {
    if (!selectedLabId) return;
    setIsOcrProcessing(true);

    try {
      const selectedLab = laboratories.find(l => l.id === selectedLabId);
      const labName = selectedLab?.name || '';
      const batch = writeBatch(db);
      let totalDocs = 0;

      for (const item of results) {
        const product = productCodes.find(p => p.stokKodu === item.stokKodu);
        if (!product) continue;

        const qty = Math.max(1, item.quantity || 1);
        for (let i = 0; i < qty; i++) {
          const ref = doc(collection(db, 'depoStok'));
          batch.set(ref, withCompanyScope({
            depotId: '',
            depotName: '',
            stokKodu: item.stokKodu,
            stokAdi: product.stokAdi || '',
            lotNumarasi: item.lot || '',
            miad: item.miad ? normalizeMiad(item.miad) : '',
            seriNumarasi: '',
            rafAdresi: '',
            irsaliyeNumarasi: '',
            eklenmeTarihi: Timestamp.now(),
            isShipped: true,
            hedefKurumId: selectedLabId,
            hedefKurum: labName,
            createdByName: currentUserProfile?.name || currentUser?.email || 'Unknown',
            createdByUid: currentUser?.uid || null,
          }, currentCompanyId));
          totalDocs++;
        }
      }

      await batch.commit();
      await touchStockMetadata();

      // Reconcile against any "Hazırlanan" peripheral orders for this lab.
      // Closes orders whose entire item set is covered, or appends a partial
      // delivery record while keeping the order in 'toplaniyor'. Notifies
      // lojistik yöneticisi (in-app + push) regardless of outcome.
      let reconcileSummary: { closedOrderIds: string[]; partialOrderIds: string[] } | null = null;
      try {
        const acceptedItems = results
          .map((r) => ({ stokKodu: r.stokKodu, adet: Math.max(1, Number(r.quantity) || 1) }))
          .filter((it) => !!it.stokKodu);
        const summary = await reconcileIrsaliyeAcceptance({
          hospitalId: selectedLabId,
          hospitalName: labName,
          accepted: acceptedItems,
          irsaliye: { fileId: file.id, fileName: file.fileName },
          actor: {
            uid: currentUser?.uid || '',
            name: currentUserProfile?.name || currentUser?.email || 'Lab',
          },
        });
        reconcileSummary = {
          closedOrderIds: summary.closedOrderIds,
          partialOrderIds: summary.partialOrderIds,
        };
      } catch (reconcileErr) {
        // Stock entry already succeeded; log but don't throw so the file
        // cleanup still runs and the user sees a stock-success toast.
        console.error('Order reconciliation failed:', reconcileErr);
      }

      // Delete the file from Firestore and storage
      await deleteDoc(doc(db, 'irsaliyeDosyalari', file.id));
      await fetch('/api/storage/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: file.storagePath }),
      });

      // Refresh local stock data
      const stokSnap = await getDocs(query(collection(db, 'depoStok'), where('isShipped', '==', true)));
      setDepoStok(filterByCompanyScope(
        stokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
        currentCompanyId,
        isSuperAdmin,
      ));

      const reconcileNote = reconcileSummary
        ? (reconcileSummary.closedOrderIds.length > 0 || reconcileSummary.partialOrderIds.length > 0)
          ? ` ${reconcileSummary.closedOrderIds.length} sipariş tam, ${reconcileSummary.partialOrderIds.length} sipariş kısmi olarak güncellendi.`
          : ''
        : '';

      toast({
        title: 'Stok girişi tamamlandı',
        description: `${totalDocs} adet ürün laboratuvar stoğuna eklendi. İrsaliye dosyası (${file.fileName}) silindi.${reconcileNote}`,
      });
    } catch (error: any) {
      console.error('Lab OCR stock entry error:', error);
      toast({
        title: 'Hata',
        description: error?.message || 'Stok girişi sırasında bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsOcrProcessing(false);
    }
  }, [selectedLabId, laboratories, productCodes, currentUser, currentUserProfile, currentCompanyId, isSuperAdmin, toast]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Laboratuvar Stokları</CardTitle>
          <CardDescription>Laboratuvarlardaki mevcut stokları özet halinde görüntüleyebilirsiniz.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-grow">
              <LabSelector
                label="Laboratuvar Seçin"
                labs={laboratories.map(l => ({ id: l.id!, name: l.name, kod: l.kod }))}
                value={selectedLabId}
                onChange={setSelectedLabId}
                placeholder="Bir laboratuvar seçin"
                disabled={isLoading}
              />
            </div>
            {selectedLabId && (
                <div className="flex items-end gap-2">
                    <Button
                        onClick={() => router.push(`/laboratuvar/sayim/${selectedLabId}`)}
                        disabled={!selectedLabId}
                        className="w-full sm:w-auto"
                        >
                        <ListChecks className="mr-2 h-5 w-5" /> Sayım Başlat
                    </Button>
                     <Button
                        onClick={() => router.push(`/laboratuvar/sayim/${selectedLabId}/history`)}
                        disabled={!selectedLabId}
                        variant="outline"
                        className="w-full sm:w-auto"
                        >
                        <History className="mr-2 h-5 w-5" /> Sayım Geçmişi
                    </Button>
                    <Button
                        onClick={() => setIsOcrModalOpen(true)}
                        disabled={!selectedLabId || isOcrProcessing}
                        variant="outline"
                        className="w-full sm:w-auto"
                        >
                        {isOcrProcessing
                          ? <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          : <FileText className="mr-2 h-5 w-5" />
                        }
                        İrsaliye Seç
                    </Button>
                </div>
            )}
            <div className="flex-grow">
              <label className="block text-sm font-medium mb-1">Ara</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Stok Kodu, Adı, Lot, Miad veya Seri No"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.currentTarget.value); setCurrentPage(1); }}
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {selectedLabId && (
            <Card className="shadow mt-4">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{selectedLabName} - Özet Stok Durumu</CardTitle>
                <Button
                  variant={showOutOfStock ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setShowOutOfStock(v => !v); setCurrentPage(1); }}
                >
                  <PackageX className="mr-2 h-4 w-4" />
                  {showOutOfStock ? 'Stokta Olmayanları Gizle' : 'Stokta Olmayanları Göster'}
                </Button>
              </CardHeader>
              <CardContent>
                {stockIsLoading ? (
                  <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : (
                  <>
                    <ScrollArea className="h-[400px] border rounded-md">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm">
                          <TableRow>
                            <TableHead className="w-1.5 p-0" />
                            <SortableHeader label="Stok Kodu" field="stokKodu" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                            <SortableHeader label="Stok Adı" field="stokAdi" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                            <SortableHeader label="Lot" field="lot" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                            <SortableHeader label="Miad" field="miad" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                            <SortableHeader label="Adet" field="quantity" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                            <TableHead className="text-center">Min</TableHead>
                            <TableHead className="text-center">Max</TableHead>
                            <TableHead className="text-center">Ort. Tüketim Süresi</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginated.map(row => {
                            const isOutOfStock = row.groupKey.startsWith('__oos__');
                            const miadInfo = getMiadInfoFromString(row.miad);
                            const stripeColor = isOutOfStock ? 'bg-slate-400' : getRowStripeColor(miadInfo.severity);
                            return (
                            <TableRow
                              key={row.groupKey}
                              onClick={isOutOfStock ? undefined : () => goToDetail(row.firstId)}
                              className={cn(
                                !isOutOfStock && "cursor-pointer hover:bg-muted",
                                isOutOfStock && 'bg-slate-50 dark:bg-slate-900/30 text-muted-foreground',
                                !isOutOfStock && (miadInfo.severity === 'critical' || miadInfo.severity === 'expired') && 'bg-red-500/[0.04]',
                                !isOutOfStock && miadInfo.severity === 'caution' && 'bg-amber-500/[0.04]',
                              )}
                            >
                              {/* Color strip */}
                              <TableCell className="w-1.5 p-0">
                                <div className={cn("w-1 h-full min-h-[40px] rounded-r", stripeColor)} />
                              </TableCell>
                              <TableCell>{row.stokKodu}</TableCell>
                              <TableCell>{row.stokAdi}</TableCell>
                              <TableCell>{row.lot}</TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-xs">{row.miad}</span>
                                  {miadInfo.severity !== 'normal' && miadInfo.days !== Infinity && (
                                    <span className={cn(
                                      "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold w-fit",
                                      miadInfo.severity === 'expired' && 'bg-red-100 text-red-700',
                                      miadInfo.severity === 'critical' && 'bg-red-100 text-red-700',
                                      miadInfo.severity === 'warning' && 'bg-orange-100 text-orange-700',
                                      miadInfo.severity === 'caution' && 'bg-amber-100 text-amber-700',
                                      miadInfo.severity === 'notice' && 'bg-yellow-100 text-yellow-700',
                                    )}>
                                      {miadInfo.days < 0 ? 'Süresi dolmuş' : `${miadInfo.days} gün kaldı`}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {isOutOfStock
                                  ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Stokta Yok</span>
                                  : row.quantity}
                              </TableCell>
                              <TableCell className="text-center">{minMaxMap[row.stokKodu]?.min ?? '-'}</TableCell>
                              <TableCell className="text-center">{minMaxMap[row.stokKodu]?.max ?? '-'}</TableCell>
                              <TableCell className="text-center">
                                {minMaxMap[row.stokKodu]?.ortalamaTuketimSuresi != null
                                  ? `${minMaxMap[row.stokKodu].ortalamaTuketimSuresi} ${minMaxMap[row.stokKodu].tuketimSuresiBirimi === 'saat' ? 'saat' : 'gün'}`
                                  : '-'}
                              </TableCell>
                            </TableRow>
                            );
                          })}
                          {paginated.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={9} className="text-center py-4 text-muted-foreground">
                                Kayıt bulunamadı.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center space-x-2 text-sm">
                        <span>Satır / sayfa:</span>
                        <Select value={String(rowsPerPage)} onValueChange={val => { setRowsPerPage(Number(val)); setCurrentPage(1); }}>
                          <SelectTrigger className="w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[20, 50, 100].map(n => (
                              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={currentPage === 1}
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        >
                          Önceki
                        </Button>
                        <span className="text-sm">{currentPage} / {pageCount}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={currentPage === pageCount}
                          onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}
                        >
                          Sonraki
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
      <LabIrsaliyeOcrModal
        isOpen={isOcrModalOpen}
        onClose={() => setIsOcrModalOpen(false)}
        productCodes={productCodes}
        onResults={handleOcrResults}
        locationType="hospital"
        locationId={selectedLabId}
      />
    </div>
  );
}
