'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent
} from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, doc, deleteDoc, getDocFromServer, writeBatch, Timestamp } from 'firebase/firestore';
import type { DepoStokItem, Laboratory, MinMaxRule } from '@/lib/types';
import { Loader2, Search, ListChecks, History, FileSpreadsheet, MoreVertical, Eye, AlertCircle, AlertTriangle, Upload, CheckCircle } from 'lucide-react';
import { touchStockMetadata, useLabStock, useLabPools, useHospitals, useProductCodes, useInvalidateQueries } from '@/hooks/useFirebaseQueries';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { exportDataToExcel } from '@/lib/utils';
import { formatMiad, normalizeMiad } from '@/lib/date';
import { useAuth } from '@/contexts/auth-context';
import { differenceInDays, isValid, parse } from 'date-fns';
import { resolveDefaultTrackingMode } from '@/lib/tracking';
import LabIrsaliyeOcrModal, { type LabOcrResult } from '@/components/lab/LabIrsaliyeOcrModal';

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

type GroupedStockItem = {
    groupKey: string;
    stokKodu: string;
    stokAdi: string;
    lot: string;
    miad: string;
    quantity: number;
    anaBirim: string;
    firstId: string;
};

type MiadSeverity = 'normal' | 'notice' | 'caution' | 'warning' | 'critical' | 'expired';

function getMiadInfoFromString(miadStr: string): { days: number; severity: MiadSeverity } {
  if (!miadStr) return { days: Infinity, severity: 'normal' };
  const miadDate = parse(miadStr, 'dd.MM.yyyy', new Date());
  if (!isValid(miadDate)) return { days: Infinity, severity: 'normal' };
  const days = differenceInDays(miadDate, new Date());
  if (days < 0) return { days, severity: 'expired' };
  if (days <= 30) return { days, severity: 'critical' };
  if (days < 45) return { days, severity: 'caution' };
  if (days < 60) return { days, severity: 'notice' };
  return { days, severity: 'normal' };
}

function getCoverageInfoForRow(
  row: GroupedStockItem,
  minMaxRules: Record<string, MinMaxRule>,
  lotTrackedStockCodes: Set<string>,
  sourceRows: GroupedStockItem[]
): { label: string; severity: 'good' | 'warning' | 'critical' | 'unknown'; coverageDays: number; dailyNeed: number } {
  const rule = minMaxRules[row.stokKodu];
  if (!rule || !rule.max || !rule.maxGun) return { label: 'Min/Max tanımsız', severity: 'unknown', coverageDays: 0, dailyNeed: 0 };
  const stockForCoverage = lotTrackedStockCodes.has(row.stokKodu)
    ? row.quantity
    : sourceRows.reduce((acc, r) => r.stokKodu === row.stokKodu ? acc + r.quantity : acc, 0);
  const periodDays = Math.floor(rule.maxGun);
  if (periodDays <= 0) return { label: 'Hesaplanamadı', severity: 'unknown', coverageDays: 0, dailyNeed: 0 };
  const dailyNeed = rule.max / periodDays;
  if (dailyNeed <= 0) return { label: 'Hesaplanamadı', severity: 'unknown', coverageDays: 0, dailyNeed: 0 };
  const coverageDays = Math.floor(stockForCoverage / dailyNeed);
  if (coverageDays <= 3) return { label: `${coverageDays} gün`, severity: 'critical', coverageDays, dailyNeed };
  if (coverageDays <= 10) return { label: `${coverageDays} gün`, severity: 'warning', coverageDays, dailyNeed };
  return { label: `${coverageDays} gün yeter`, severity: 'good', coverageDays, dailyNeed };
}

function getRiskyBoxes(miadInfo: { days: number }, coverageInfo: { severity: string; coverageDays: number; dailyNeed: number }) {
  if (coverageInfo.severity === 'unknown' || miadInfo.days === Infinity || miadInfo.days <= 0 || coverageInfo.coverageDays <= miadInfo.days) return 0;
  const riskyDays = coverageInfo.coverageDays - miadInfo.days;
  return Math.max(0, Math.ceil(riskyDays * coverageInfo.dailyNeed));
}

export default function LaboratuvarYonetimiPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { isSuperAdmin, currentUserProfile } = useAuth();
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<keyof GroupedStockItem>('stokAdi');
  const [sortAsc, setSortAsc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [minMaxRules, setMinMaxRules] = useState<Record<string, MinMaxRule>>({});
  const [isDeletingGroup, setIsDeletingGroup] = useState<string | null>(null);

  // Excel import states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedExcelRow[]>([]);
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use TanStack Query hooks for data fetching
  const { data: allLaboratories = [], isLoading: labsLoading } = useHospitals();
  const { data: products = [], isLoading: productsLoading } = useProductCodes();
  const { data: labPools = [], isLoading: labPoolsLoading } = useLabPools();
  const { invalidateDepoStok } = useInvalidateQueries();

  const isLoading = labsLoading || productsLoading;

  // Derive product lookup maps from products query data
  const productNames = useMemo(() => {
    const names: Record<string, string> = {};
    products.forEach(p => {
      if (p.stokKodu) names[p.stokKodu] = p.stokAdi || p.stokKodu;
    });
    return names;
  }, [products]);

  const productMeta = useMemo(() => {
    const meta: Record<string, { anaBirim?: string; takipSekli?: string }> = {};
    products.forEach(p => {
      if (p.stokKodu) meta[p.stokKodu] = { anaBirim: p.anaBirim, takipSekli: p.takipSekli };
    });
    return meta;
  }, [products]);

  // Filter labs by user's assignedLaboratories - role-independent
  const laboratories = useMemo(() => {
    if (isSuperAdmin || currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'admin_developer') return allLaboratories;
    if (currentUserProfile?.assignedLaboratories && currentUserProfile.assignedLaboratories.length > 0) {
      return allLaboratories.filter(h => currentUserProfile.assignedLaboratories!.includes(h.id));
    }
    return allLaboratories;
  }, [allLaboratories, currentUserProfile, isSuperAdmin]);

  // Auto-select lab if user has only one assigned
  useEffect(() => {
    if (selectedLabId || isLoading) return;
    if (laboratories.length === 1) {
      setSelectedLabId(laboratories[0].id);
    }
  }, [laboratories, selectedLabId, isLoading]);

  // Compute pool member IDs and names for lab stock query
  const { poolMemberIds, poolMemberNames } = useMemo(() => {
    const pool = labPools.find(p => p.memberIds.includes(selectedLabId));
    const ids = pool?.memberIds || (selectedLabId ? [selectedLabId] : []);
    const names = ids.map(id => allLaboratories.find(l => l.id === id)?.name).filter((n): n is string => !!n);
    return { poolMemberIds: ids, poolMemberNames: names };
  }, [labPools, selectedLabId, allLaboratories]);

  // Use targeted lab stock query instead of broad depoStok fetch
  const { data: labStocks = [] } = useLabStock(poolMemberIds, poolMemberNames, {
    enabled: !labPoolsLoading && poolMemberIds.length > 0
  });

  useEffect(() => {
    if (!selectedLabId) {
      setMinMaxRules({});
      return;
    }
    (async () => {
      try {
        const rulesRef = collection(db, 'hospitals', selectedLabId, 'minMaxRules');
        const snapshot = await getDocs(rulesRef);
        const rules: Record<string, MinMaxRule> = {};
        snapshot.forEach(d => {
          const rule = d.data() as MinMaxRule;
          if (rule.stokKodu) rules[rule.stokKodu] = rule;
        });
        setMinMaxRules(rules);
      } catch (e) {
        console.error('Error fetching lab min-max rules:', e);
      }
    })();
  }, [selectedLabId]);

  const selectedLabName = useMemo(() => {
    return laboratories.find(l => l.id === selectedLabId)?.name || '';
  }, [laboratories, selectedLabId]);

  const groupedMap = useMemo(() => {
    const map: Record<string, {
      stokKodu: string; stokAdi: string; lot: string; miad: string; items: DepoStokItem[]
    }> = {};
    labStocks.forEach(item => {
      const stokKodu = item.stokKodu ?? '';
      const lot = item.lotNumarasi ?? '';
      const miadText = formatMiad(item.miad);
      const key = `${stokKodu}_${lot}_${miadText}`;

      if (!map[key]) {
        const adi = productNames[stokKodu] ?? item.stokAdi ?? stokKodu;
        map[key] = { stokKodu, stokAdi: adi, lot, miad: miadText, items: [] };
      }
      map[key].items.push(item);
    });
    return map;
  }, [labStocks, productNames]);

  const summaryList: GroupedStockItem[] = useMemo(
    () => Object.entries(groupedMap).map(([groupKey, grp]) => {
      const firstValidId = grp.items.find(it => typeof it.id === 'string' && it.id.length > 0)?.id ?? '';
      return {
        groupKey,
        stokKodu: grp.stokKodu,
        stokAdi: grp.stokAdi,
        lot: grp.lot,
        miad: grp.miad,
        quantity: grp.items.length,
        anaBirim: productMeta[grp.stokKodu]?.anaBirim || 'Kutu',
        firstId: firstValidId
      };
    }),
    [groupedMap, productMeta]
  );

  const lotTrackedStockCodes = useMemo(() => {
    const set = new Set<string>();
    Object.entries(productMeta).forEach(([stokKodu, meta]) => {
      const takipSekli = resolveDefaultTrackingMode(meta as any);
      if (takipSekli === 'lot') set.add(stokKodu);
    });
    return set;
  }, [productMeta]);

  const filtered = useMemo(() => {
    if (!searchQuery) return summaryList;
    const q = searchQuery.toLowerCase();
    return summaryList.filter(row =>
      row.stokKodu.toLowerCase().includes(q) ||
      row.stokAdi.toLowerCase().includes(q) ||
      row.lot.toLowerCase().includes(q) ||
      (row.miad ?? '').toLowerCase().includes(q) ||
      groupedMap[row.groupKey].items.some(item =>
        (item.seriNumarasi ?? '').toLowerCase().includes(q)
      )
    );
  }, [searchQuery, summaryList, groupedMap]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA ?? '').localeCompare(String(valB ?? ''));
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [filtered, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return sorted.slice(start, start + rowsPerPage);
  }, [sorted, currentPage, rowsPerPage]);

  const goToDetail = (id: string) => router.push(`/laboratuvar-yonetimi/${id}`);

  // Delete all items in a group directly (for incorrectly entered items)
  const handleDeleteGroup = async (groupKey: string) => {
    const group = groupedMap[groupKey];
    if (!group || group.items.length === 0) {
      toast({ title: 'Hata', description: 'Silinecek kayıt bulunamadı.', variant: 'destructive' });
      return;
    }

    const confirmMessage = `${group.stokAdi} - Lot: ${group.lot}\n\n${group.items.length} adet kayıt KALICI OLARAK SİLİNECEK.\nTüketim kaydı oluşturulmayacak.\n\nDevam etmek istiyor musunuz?`;
    if (!confirm(confirmMessage)) {
      return;
    }

    setIsDeletingGroup(groupKey);
    console.log(`[LAB-GROUP-DELETE] Starting deletion for group: ${groupKey}, ${group.items.length} items`);

    try {
      // Collect valid item IDs
      const itemsToDelete = group.items.filter(item => item.id);

      if (itemsToDelete.length === 0) {
        toast({ title: 'Hata', description: 'Silinecek geçerli kayıt bulunamadı.', variant: 'destructive' });
        return;
      }

      // Delete items one by one to handle errors individually
      let successCount = 0;
      let failCount = 0;
      const failedIds: string[] = [];

      for (const item of itemsToDelete) {
        try {
          console.log(`[LAB-GROUP-DELETE] Deleting item: ${item.id}`);
          await deleteDoc(doc(db, 'depoStok', item.id!));

          // Verify deletion by reading directly from server (bypass cache)
          const verifySnap = await getDocFromServer(doc(db, 'depoStok', item.id!));
          if (verifySnap.exists()) {
            console.error(`[LAB-GROUP-DELETE] VERIFICATION FAILED: Item ${item.id} still exists after delete!`);
            failCount++;
            failedIds.push(item.id!);
          } else {
            console.log(`[LAB-GROUP-DELETE] Verified: Item ${item.id} successfully deleted`);
            successCount++;
          }
        } catch (itemErr: unknown) {
          const itemError = itemErr as Error;
          console.error(`[LAB-GROUP-DELETE] Error deleting item ${item.id}:`, itemError);
          failCount++;
          failedIds.push(item.id!);
        }
      }

      console.log(`[LAB-GROUP-DELETE] Deletion complete. Success: ${successCount}, Failed: ${failCount}`);

      if (failCount > 0 && successCount === 0) {
        // All deletions failed
        toast({
          title: 'Silme Başarısız',
          description: `Kayıtlar silinemedi. Firebase Security Rules silme işlemine izin vermiyor olabilir. Lütfen yönetici ile iletişime geçin.`,
          variant: 'destructive'
        });
      } else if (failCount > 0) {
        // Partial success
        await invalidateDepoStok();
        toast({
          title: 'Kısmi Başarı',
          description: `${successCount} kayıt silindi, ${failCount} kayıt silinemedi. Firebase Security Rules kontrol edin.`,
          variant: 'default'
        });
      } else {
        // All successful
        await invalidateDepoStok();
        toast({
          title: 'Silindi',
          description: `${successCount} kayıt kalıcı olarak silindi.`
        });
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[LAB-GROUP-DELETE] Error in deletion process:`, error);
      toast({
        title: 'Silme Hatası',
        description: `İşlem sırasında hata: ${error.message || 'Bilinmeyen hata'}. Firebase Security Rules kontrol edin.`,
        variant: 'destructive'
      });
    } finally {
      setIsDeletingGroup(null);
    }
  };

  const handleExport = () => {
    if (summaryList.length === 0) {
      toast({
        title: "Veri Yok",
        description: "Dışa aktarılacak laboratuvar stoğu bulunmuyor.",
        variant: "default",
      });
      return;
    }
    const dataToExport = summaryList.map(item => ({
      'Stok Kodu': item.stokKodu,
      'Stok Adı': item.stokAdi,
      'Lot Numarası': item.lot,
      'Miad': item.miad,
      'Adet': item.quantity,
    }));
    exportDataToExcel(dataToExport, `${selectedLabName}_Stok_Ozeti`, "Stok Özeti", toast);
  };

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
      const productMap = new Map<string, { stokKodu: string; stokAdi: string }>();
      Object.entries(productNames).forEach(([code, name]) => {
        productMap.set(code.trim().toUpperCase(), { stokKodu: code, stokAdi: name });
      });

      const rows: ParsedExcelRow[] = [];

      for (const rawRow of jsonData) {
        const row: Record<string, any> = {};
        for (const key of Object.keys(rawRow)) {
          row[normalizeKey(key)] = rawRow[key];
        }

        const stokKodu = String(row['stokkodu'] || '').trim();
        if (!stokKodu) continue;

        const product = productMap.get(stokKodu.toUpperCase());
        const stokAdi = String(row['stokadi'] || row['stokadı'] || product?.stokAdi || stokKodu).trim();
        const lotNumarasi = String(row['lotnumarasi'] || row['lotno'] || row['lot'] || '').trim();
        const miadRaw = String(row['miad'] || row['sonkullanmatarihi'] || row['skt'] || '').trim();
        const seriNumarasi = String(row['serinumarasi'] || row['serino'] || row['seri'] || '').trim();
        const adetRaw = row['adet'] || row['miktar'] || row['quantity'] || '1';
        const adet = Math.max(1, Math.floor(Number(adetRaw) || 1));

        let valid = true;
        let error: string | undefined;
        if (!product) {
          valid = false;
          error = `"${stokKodu}" stok kodu tanımlı değil`;
        }
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
    } catch {
      toast({ title: 'Excel Okuma Hatası', description: 'Dosya işlenirken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsParsingExcel(false);
      if (event.target) event.target.value = '';
    }
  }, [productNames, toast]);

  const validRows = useMemo(() => parsedRows.filter(r => r.valid), [parsedRows]);
  const invalidRows = useMemo(() => parsedRows.filter(r => !r.valid), [parsedRows]);

  const handleImportConfirm = useCallback(async () => {
    if (validRows.length === 0 || !selectedLabId) return;

    setIsImporting(true);
    setImportProgress('Stok ekleniyor...');

    try {
      const BATCH_SIZE = 450;
      let written = 0;

      // Flatten rows: each row produces `adet` documents
      const docsToWrite: Array<{
        stokKodu: string; stokAdi: string; lotNumarasi: string; miad: string; seriNumarasi: string;
      }> = [];
      for (const row of validRows) {
        for (let i = 0; i < row.adet; i++) {
          docsToWrite.push({
            stokKodu: row.stokKodu, stokAdi: row.stokAdi,
            lotNumarasi: row.lotNumarasi, miad: row.miad, seriNumarasi: row.seriNumarasi,
          });
        }
      }

      for (let i = 0; i < docsToWrite.length; i += BATCH_SIZE) {
        const chunk = docsToWrite.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);

        for (const item of chunk) {
          const docRef = doc(collection(db, 'depoStok'));
          batch.set(docRef, {
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
          });
        }

        await batch.commit();
        written += chunk.length;
        setImportProgress(`Stok ekleniyor... (${written}/${docsToWrite.length})`);
      }

      await touchStockMetadata();

      // Invalidate cache so useLabStock refetches
      await invalidateDepoStok();

      toast({
        title: 'Stok Ekleme Başarılı',
        description: `${docsToWrite.length} adet ürün laboratuvar stoğuna eklendi.`,
      });

      setIsImportModalOpen(false);
      setParsedRows([]);
    } catch {
      toast({ title: 'Stok Ekleme Hatası', description: 'Kayıt sırasında bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsImporting(false);
      setImportProgress('');
    }
  }, [validRows, selectedLabId, selectedLabName, toast, invalidateDepoStok]);

  const handleOcrResults = useCallback(async (
    results: LabOcrResult[],
    file: { id: string; storagePath: string; fileName: string }
  ) => {
    if (!selectedLabId || results.length === 0) return;
    setIsOcrProcessing(true);
    try {
      const aiPayload = results.map((item) => {
        const product = products.find(p => p.stokKodu === item.stokKodu);
        return {
          stokKodu: item.stokKodu,
          stokAdi: product?.stokAdi || '',
          parsedQuantity: Math.max(1, item.quantity || 1),
          rawLine: item.rawLine || '',
          anaBirim: product?.anaBirim || '',
          ambalajDegeri: Number(product?.ambalajDegeri || 0),
        };
      });

      let aiConvertedMap = new Map<string, number>();
      try {
        const aiRes = await fetch('/api/ai/irsaliye-unit-convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: aiPayload }),
        });
        const aiData = await aiRes.json().catch(() => ({}));
        const convertedList = Array.isArray(aiData?.converted) ? aiData.converted : [];
        aiConvertedMap = new Map(
          convertedList.map((item: any) => [
            String(item?.stokKodu || ''),
            Math.max(1, Number(item?.convertedQuantity || 1)),
          ])
        );
      } catch (aiError) {
        console.warn('AI quantity conversion skipped, using fallback:', aiError);
      }

      const batch = writeBatch(db);
      let totalDocs = 0;

      for (const item of results) {
        const product = products.find(p => p.stokKodu === item.stokKodu);
        if (!product) continue;

        const parsedQty = Math.max(1, item.quantity || 1);
        const fallbackQty = (() => {
          const ambalaj = Number(product.ambalajDegeri || 0);
          const anaBirim = String(product.anaBirim || '').toLowerCase();
          const raw = String(item.rawLine || '').toLowerCase();
          const usesPackLikeUnit = anaBirim.includes('paket') || anaBirim.includes('kutu');
          const invoiceLooksAdet = raw.includes(' adet') || raw.endsWith('adet');
          if (usesPackLikeUnit && invoiceLooksAdet && ambalaj > 0) {
            return Math.max(1, Math.round(parsedQty / ambalaj));
          }
          return parsedQty;
        })();
        const qty = aiConvertedMap.get(item.stokKodu) || fallbackQty;
        for (let i = 0; i < qty; i++) {
          const ref = doc(collection(db, 'depoStok'));
          batch.set(ref, {
            stokKodu: item.stokKodu,
            stokAdi: product.stokAdi || item.stokKodu,
            lotNumarasi: item.lot || '',
            miad: item.miad ? normalizeMiad(item.miad) : '',
            seriNumarasi: '',
            isShipped: true,
            hedefKurumId: selectedLabId,
            hedefKurum: selectedLabName,
            eklenmeTarihi: Timestamp.now(),
            sevkTarihi: Timestamp.now(),
            kaynak: 'irsaliye_ocr',
            createdByName: currentUserProfile?.name || currentUserProfile?.email || 'Unknown',
            createdByUid: currentUserProfile?.uid || null,
          });
          totalDocs++;
        }
      }

      await batch.commit();
      await touchStockMetadata();
      await invalidateDepoStok();

      // Optional cleanup of consumed file
      await deleteDoc(doc(db, 'irsaliyeDosyalari', file.id));
      await fetch('/api/storage/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: file.storagePath }),
      });

      toast({
        title: 'Stok girişi tamamlandı',
        description: `${totalDocs} birim ürün laboratuvar stoğuna eklendi.`,
      });
    } catch (error: any) {
      console.error('Lab OCR stock entry error:', error);
      toast({
        title: 'Hata',
        description: error?.message || 'İrsaliye işlenirken hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsOcrProcessing(false);
    }
  }, [selectedLabId, selectedLabName, products, currentUserProfile, toast, invalidateDepoStok]);

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
              <label className="block text-sm font-medium mb-1">Laboratuvar Seçin</label>
              <Select value={selectedLabId} onValueChange={setSelectedLabId} disabled={isLoading}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Bir laboratuvar seçin" />
                </SelectTrigger>
                <SelectContent>
                  {laboratories.map(l => (
                    <SelectItem key={l.id ?? String(l.name)} value={l.id ?? ''}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!selectedLabId || isParsingExcel}
                        variant="outline"
                        className="w-full sm:w-auto"
                        >
                        {isParsingExcel ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Upload className="mr-2 h-5 w-5" />}
                        Excel ile Stok Ekle
                    </Button>
                    <Button
                        onClick={() => setIsOcrModalOpen(true)}
                        disabled={!selectedLabId || isOcrProcessing}
                        variant="outline"
                        className="w-full sm:w-auto"
                        >
                        {isOcrProcessing
                          ? <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          : <FileSpreadsheet className="mr-2 h-5 w-5" />
                        }
                        İrsaliye Seç
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
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
            <div className="cihaz-card-strong overflow-hidden mt-4">
              <div className="sticky top-0 z-20 bg-[var(--dashboard-surface)] border-b border-[var(--dashboard-stroke)] px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-xs text-[var(--dashboard-muted)]">
                  <span className="font-medium">{selectedLabName} • Toplam: <span className="text-[var(--dashboard-text)] font-bold">{sorted.length}</span> kayıt</span>
                  {pageCount > 1 && <span>Sayfa <span className="text-[var(--dashboard-text)] font-bold">{currentPage}</span>/{pageCount}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex items-center gap-3 text-[10px] text-[var(--dashboard-muted)]">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> &lt;30 gün</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> &lt;45 gün</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> &lt;60 gün</span>
                  </div>
                  <Button onClick={handleExport} variant="outline" size="sm" className="h-8 text-xs">
                    <FileSpreadsheet className="mr-2 h-3.5 w-3.5" /> Excel
                  </Button>
                </div>
              </div>

              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 text-[var(--dashboard-muted)]">
                  <Loader2 className="h-8 w-8 animate-spin mb-3 text-orange-400" />
                  <p className="text-sm">Veriler yükleniyor...</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="z-10">
                        <tr className="bg-[var(--dashboard-surface-2)]">
                          <th className="w-1.5" />
                          <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Stok Kodu</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Stok Adı</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Lot</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Miad</th>
                          <th className="text-center px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Adet</th>
                          <th className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Yeterlilik</th>
                          <th className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">İşlem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.map(row => {
                          const miadInfo = getMiadInfoFromString(row.miad);
                          const coverageInfo = getCoverageInfoForRow(row, minMaxRules, lotTrackedStockCodes, summaryList);
                          const riskyBoxes = getRiskyBoxes(miadInfo, coverageInfo);
                          const stripeColor =
                            miadInfo.severity === 'expired' || miadInfo.severity === 'critical'
                              ? 'bg-red-500'
                              : miadInfo.severity === 'caution'
                                ? 'bg-amber-500'
                                : miadInfo.severity === 'notice'
                                  ? 'bg-yellow-400'
                                  : 'bg-slate-300';

                          return (
                            <tr
                              key={row.groupKey}
                              className={`border-b border-[var(--dashboard-stroke)] hover:bg-[var(--dashboard-surface-2)]/50 transition-colors ${
                                miadInfo.severity === 'expired' || miadInfo.severity === 'critical'
                                  ? 'bg-red-500/[0.04]'
                                  : miadInfo.severity === 'caution'
                                    ? 'bg-amber-500/[0.04]'
                                    : ''
                              }`}
                            >
                              <td className="w-1.5 p-0">
                                <div className={`w-1 h-full min-h-[56px] rounded-r ${stripeColor}`} />
                              </td>
                              <td onClick={() => { if (row.firstId) goToDetail(row.firstId); }} className={`px-3 py-3 cursor-pointer ${row.firstId ? '' : 'opacity-60'}`}>
                                <span className="text-[10px] text-[var(--dashboard-muted)] font-mono">{row.stokKodu}</span>
                              </td>
                              <td onClick={() => { if (row.firstId) goToDetail(row.firstId); }} className={`px-3 py-3 cursor-pointer font-medium text-[var(--dashboard-text)] ${row.firstId ? '' : 'opacity-60'}`}>
                                {row.stokAdi}
                              </td>
                              <td onClick={() => { if (row.firstId) goToDetail(row.firstId); }} className={`px-3 py-3 cursor-pointer text-xs text-[var(--dashboard-muted)] ${row.firstId ? '' : 'opacity-60'}`}>
                                {row.lot}
                              </td>
                              <td onClick={() => { if (row.firstId) goToDetail(row.firstId); }} className={`px-3 py-3 cursor-pointer ${row.firstId ? '' : 'opacity-60'}`}>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-xs text-[var(--dashboard-text)]">{row.miad}</span>
                                  {miadInfo.days !== Infinity && (
                                    <span
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold w-fit ${
                                        miadInfo.severity === 'expired' || miadInfo.severity === 'critical'
                                          ? 'bg-red-100 text-red-700'
                                          : miadInfo.severity === 'caution'
                                            ? 'bg-amber-100 text-amber-700'
                                            : miadInfo.severity === 'notice'
                                              ? 'bg-yellow-100 text-yellow-700'
                                              : 'bg-slate-100 text-slate-700'
                                      }`}
                                    >
                                      {miadInfo.days < 0 ? 'Süresi dolmuş' : `${miadInfo.days} gün kaldı`}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td onClick={() => { if (row.firstId) goToDetail(row.firstId); }} className={`px-3 py-3 text-center cursor-pointer ${row.firstId ? '' : 'opacity-60'}`}>
                                <span className="inline-flex items-center justify-center min-w-[48px] px-2 py-1 rounded-lg bg-[var(--dashboard-surface)] border border-[var(--dashboard-stroke)] shadow-sm text-xs font-bold text-[var(--dashboard-text)]">
                                  {row.quantity} {row.anaBirim}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                    coverageInfo.severity === 'good' ? 'bg-emerald-100 text-emerald-700' :
                                      coverageInfo.severity === 'warning' ? 'bg-orange-100 text-orange-700' :
                                        coverageInfo.severity === 'critical' ? 'bg-red-100 text-red-700' :
                                          'bg-slate-100 text-slate-500'
                                  }`}>
                                    {coverageInfo.label}
                                  </span>
                                  {riskyBoxes > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                                      <AlertTriangle className="h-3 w-3" />
                                      {riskyBoxes} kutu riskli
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="cihaz-tool-item h-8 w-8" disabled={isDeletingGroup === row.groupKey}>
                                      {isDeletingGroup === row.groupKey ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <MoreVertical className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => { if (row.firstId) goToDetail(row.firstId); }} disabled={!row.firstId}>
                                      <Eye className="mr-2 h-4 w-4" />
                                      Detayları Görüntüle
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleDeleteGroup(row.groupKey)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <AlertCircle className="mr-2 h-4 w-4" />
                                      Hatalı Kayıt - Tümünü Sil
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </td>
                            </tr>
                          );
                        })}
                        {paginated.length === 0 && (
                          <tr>
                            <td colSpan={8} className="text-center py-16 text-[var(--dashboard-muted)]">
                              Kayıt bulunamadı.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="sticky bottom-0 bg-[var(--dashboard-surface)] border-t border-[var(--dashboard-stroke)] px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-[var(--dashboard-muted)]">
                      <span>Sayfa başına:</span>
                      <Select value={String(rowsPerPage)} onValueChange={val => { setRowsPerPage(Number(val)); setCurrentPage(1); }}>
                        <SelectTrigger className="w-16 h-7 text-xs bg-[var(--dashboard-surface)] border-[var(--dashboard-stroke)]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[20, 50, 100].map(n => (
                            <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
                        Ön
                      </Button>
                      <span className="text-xs text-[var(--dashboard-muted)] px-2">{currentPage}/{pageCount}</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={currentPage === pageCount} onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}>
                        Son
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Excel Import Preview Modal */}
      <Dialog open={isImportModalOpen} onOpenChange={(open) => { if (!isImporting) setIsImportModalOpen(open); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Excel ile Stok Ekleme - Önizleme
            </DialogTitle>
            <DialogDescription>
              {selectedLabName} laboratuvarına eklenecek stok verilerini kontrol edin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="font-medium">{validRows.length} geçerli satır</span>
                <span className="text-muted-foreground">({validRows.reduce((s, r) => s + r.adet, 0)} adet ürün)</span>
              </div>
              {invalidRows.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-medium">{invalidRows.length} hatalı satır (atlanacak)</span>
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              Beklenen sütunlar: <strong>Stok Kodu</strong> (zorunlu), Stok Adı, Lot Numarası, Miad, Seri Numarası, Adet
            </div>

            <ScrollArea className="h-[350px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm">
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Stok Kodu</TableHead>
                    <TableHead>Stok Adı</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Miad</TableHead>
                    <TableHead>Seri No</TableHead>
                    <TableHead className="text-right">Adet</TableHead>
                    <TableHead>Durum</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((row, idx) => (
                    <TableRow key={idx} className={!row.valid ? 'bg-destructive/5' : ''}>
                      <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{row.stokKodu}</TableCell>
                      <TableCell className="text-sm">{row.stokAdi}</TableCell>
                      <TableCell className="text-xs">{row.lotNumarasi || '-'}</TableCell>
                      <TableCell className="text-xs">{row.miad || '-'}</TableCell>
                      <TableCell className="text-xs">{row.seriNumarasi || '-'}</TableCell>
                      <TableCell className="text-right font-semibold">{row.adet}</TableCell>
                      <TableCell>
                        {row.valid ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <span className="text-xs text-destructive">{row.error}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>

          <DialogFooter className="gap-2">
            {importProgress && <span className="text-sm text-muted-foreground mr-auto">{importProgress}</span>}
            <Button variant="outline" onClick={() => setIsImportModalOpen(false)} disabled={isImporting}>
              İptal
            </Button>
            <Button onClick={handleImportConfirm} disabled={isImporting || validRows.length === 0}>
              {isImporting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Ekleniyor...</>
              ) : (
                <><Upload className="mr-2 h-4 w-4" /> {validRows.reduce((s, r) => s + r.adet, 0)} Adet Stok Ekle</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LabIrsaliyeOcrModal
        isOpen={isOcrModalOpen}
        onClose={() => setIsOcrModalOpen(false)}
        productCodes={products}
        onResults={handleOcrResults}
        locationType="hospital"
        locationId={selectedLabId}
      />
    </div>
  );
}
