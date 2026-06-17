'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Calculator,
  CheckCircle,
  Download,
  FileText,
  Loader2,
  Plus,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { getDocs, orderBy } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import type { Hospital } from '@/lib/types';
import { exportDataToExcel } from '@/lib/utils';
import { cn } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { parseCumulativePdfFiles, type CumulativeRow } from '@/lib/qore-hesaplama/parse-cumulative';
import { parseCumulativeTxtFiles } from '@/lib/qore-hesaplama/parse-cumulative-txt';
import { aggregateCumulative } from '@/lib/qore-hesaplama/aggregate';
import { normalizeTestName } from '@/lib/qore-hesaplama/test-name-matcher';
import { ALL_FILTER_VALUE, type CalculationProductRow, useQoreCalculationProducts } from '@/hooks/useQoreCalculationProducts';

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(0, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isTxt = (f: File) => f.type.startsWith('text/') || /\.(txt|csv)$/i.test(f.name);

export default function KumulatifHesaplamaPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loadingHospitals, setLoadingHospitals] = useState(true);
  const [hospitalId, setHospitalId] = useState('');
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());

  const [files, setFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<CalculationProductRow & CumulativeRow & { matchedTests: string[] }>>([]);
  const [brandFilter, setBrandFilter] = useState(ALL_FILTER_VALUE);
  const [productGroupFilter, setProductGroupFilter] = useState(ALL_FILTER_VALUE);
  const inputRef = useRef<HTMLInputElement>(null);

  // Manuel birleştirme durumu
  const [anchor, setAnchor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const combineMode = anchor !== null;

  const hospitalName = useMemo(
    () => hospitals.find((h) => h.id === hospitalId)?.name || '',
    [hospitals, hospitalId]
  );

  const { rows: scopedProducts, brandOptions, productGroupOptions, isLoadingScope, scopeError, scopeLabel } = useQoreCalculationProducts({
    hospitalId,
    hospitals,
    currentCompanyId,
    isSuperAdmin,
  });

  const filteredProducts = useMemo(() => scopedProducts.filter((product) => (
    (brandFilter === ALL_FILTER_VALUE || product.marka === brandFilter) &&
    (productGroupFilter === ALL_FILTER_VALUE || product.urunGrubu === productGroupFilter)
  )), [scopedProducts, brandFilter, productGroupFilter]);

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

  const hasComputed = rows.length > 0;
  const canParse = files.length > 0 && !!hospitalId && filteredProducts.length > 0 && !isParsing && !isLoadingScope;

  function cancelCombine() {
    setAnchor(null);
    setPicked(new Set());
  }

  const addFiles = useCallback((incoming: File[]) => {
    const accepted = incoming.filter((f) => isPdf(f) || isTxt(f));
    if (!accepted.length) return;
    setFiles((prev) => [...prev, ...accepted]);
    setRows([]);
    setError(null);
    cancelCombine();
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setRows([]);
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
    cancelCombine();
    try {
      const pdfs = files.filter(isPdf);
      const txts = files.filter(isTxt);
      const [pdfRows, txtRows] = await Promise.all([
        parseCumulativePdfFiles(pdfs),
        parseCumulativeTxtFiles(txts),
      ]);
      const merged = [...pdfRows, ...txtRows];
      const aggregated = aggregateCumulative(merged);
      const byTest = new Map(aggregated.map((row) => [normalizeTestName(row.test), row]));
      const matched = filteredProducts.map((product) => {
        const match = byTest.get(normalizeTestName(product.testAdi));
        return {
          ...product,
          test: product.testAdi || product.stokKodu,
          routine: match?.routine || 0,
          rerun: match?.rerun || 0,
          calib: match?.calib || 0,
          control: match?.control || 0,
          total: match?.total || 0,
          matchedTests: match ? [match.test] : [],
        };
      });
      setRows(matched);
      if (aggregated.length === 0) {
        setError('Geçerli veri satırı çıkarılamadı. Dosya içeriğini ve biçimini kontrol edin.');
      } else {
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
    }));
    const fname = `Kumulatif_${hospitalName || 'Lab'}_${String(month + 1).padStart(2, '0')}-${year}`;
    exportDataToExcel(data, fname, 'Kumulatif', toast);
  }

  // ---- Sürükle-bırak ----
  const onDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(false); };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <BackButton fallback="/raporlama" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Kümülatif Hesaplama Motoru
          </CardTitle>
          <CardDescription>
            'Cumulative Operation List' PDF/TXT dosyalarını yükleyin; testleri çıkarıp benzersiz listede
            birleştirin ve Excel'e aktarın.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="col-span-1 md:col-span-2">
              <label className="text-sm font-medium">Laboratuvar</label>
              <Select value={hospitalId} onValueChange={setHospitalId} disabled={loadingHospitals}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={loadingHospitals ? 'Yükleniyor...' : 'Seçiniz'} />
                </SelectTrigger>
                <SelectContent>
                  {hospitals.filter((h) => h.id).map((h) => (
                    <SelectItem key={h.id} value={h.id!}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Ay</label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={String(m.value)} className="capitalize">{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Yıl</label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-xl border bg-muted/20 p-4">
            <div>
              <label className="text-sm font-medium">Marka Filtresi</label>
              <Select value={brandFilter} onValueChange={(v) => { setBrandFilter(v); setRows([]); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Tüm Markalar</SelectItem>
                  {brandOptions.map((brand) => <SelectItem key={brand} value={brand}>{brand}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Ürün Grubu Filtresi</label>
              <Select value={productGroupFilter} onValueChange={(v) => { setProductGroupFilter(v); setRows([]); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER_VALUE}>Tüm Ürün Grupları</SelectItem>
                  {productGroupOptions.map((group) => <SelectItem key={group} value={group}>{group}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col justify-end text-sm text-muted-foreground">
              <span>{isLoadingScope ? 'Ürünler yükleniyor…' : `${filteredProducts.length} ürün listeleniyor`}</span>
              {scopeLabel && <span>Ortak stok havuzu: {scopeLabel}</span>}
            </div>
          </div>

          <div
            className={cn(
              'group relative flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer',
              isDragActive ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50 hover:bg-muted/30'
            )}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <UploadCloud className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Dosyaları buraya sürükleyip bırakın veya seçmek için tıklayın</p>
            <p className="text-sm text-muted-foreground">.pdf, .txt, .csv dosyaları (toplu yükleme desteklenir)</p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv"
              multiple
              className="sr-only"
              onChange={(e) => { addFiles(Array.from(e.target.files || [])); if (e.target) e.target.value = ''; }}
            />
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Seçilen Dosyalar ({files.length})</h3>
              <ScrollArea className="h-28 rounded-md border p-2">
                <ul className="space-y-1">
                  {files.map((file, i) => (
                    <li key={i} className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5 text-sm">
                      <span className="flex items-center gap-2 truncate">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleParse} disabled={!canParse}>
              {isParsing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
              {files.length > 0 ? `${files.length} Dosyayı Ayrıştır` : 'Ayrıştır'}
            </Button>
            {hasComputed && (
              <>
                <Button variant="outline" onClick={removeZeroRows} disabled={!hasZeroRows || combineMode}>
                  <Trash2 className="mr-2 h-4 w-4" /> 0 Olanları Kaldır
                </Button>
                <Button variant="outline" onClick={handleExport} disabled={combineMode}>
                  <Download className="mr-2 h-4 w-4" /> Excel'e Aktar
                </Button>
              </>
            )}
          </div>

          {scopeError && (
            <Alert variant="destructive">
              <AlertTitle>Hata</AlertTitle>
              <AlertDescription>{scopeError}</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Hata</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {(visibleRows.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ürün Bazlı Kümülatif Eşleşmeler ({visibleRows.length} ürün)</CardTitle>
                <CardDescription>
                  {hospitalName ? `${hospitalName} – ${MONTHS[month].label} ${year}` : `${MONTHS[month].label} ${year}`}
                  {combineMode && ' • Birleştirme modu: ana teste eklenecek testleri seçin.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[55vh] rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Stok Kodu</TableHead>
                        <TableHead>Stok Adı</TableHead>
                        <TableHead>Test Adı</TableHead>
                        <TableHead>Eşleşen Dosya Testi</TableHead>
                        <TableHead className="text-right">Routine</TableHead>
                        <TableHead className="text-right">Rerun</TableHead>
                        <TableHead className="text-right">Calib</TableHead>
                        <TableHead className="text-right">Control</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-28" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.map((r) => {
                        const isAnchor = combineMode && anchor === r.test;
                        const isPickable = combineMode && !isAnchor;
                        const isPicked = picked.has(r.test);
                        return (
                          <TableRow
                            key={r.test}
                            className={cn(
                              isPickable && 'cursor-pointer hover:bg-muted/50',
                              isPicked && 'ring-2 ring-inset ring-sky-400/60',
                              isAnchor && 'ring-2 ring-inset ring-amber-400/80'
                            )}
                            onClick={() => { if (isPickable) togglePick(r.test); }}
                          >
                            <TableCell className="px-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full"
                                disabled={combineMode && !isAnchor}
                                onClick={(e) => { e.stopPropagation(); startCombine(r.test); }}
                                title="Bu testi ana test yap ve diğerlerini buna ekle"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </TableCell>
                            <TableCell className="font-medium">{r.stokKodu}</TableCell>
                            <TableCell>{r.stokAdi}</TableCell>
                            <TableCell>{r.testAdi || '—'}</TableCell>
                            <TableCell className="text-muted-foreground">{r.matchedTests.join(', ') || '—'}</TableCell>
                            <TableCell className="text-right">{r.routine}</TableCell>
                            <TableCell className="text-right">{r.rerun}</TableCell>
                            <TableCell className="text-right">{r.calib}</TableCell>
                            <TableCell className="text-right">{r.control}</TableCell>
                            <TableCell className="text-right font-semibold">{r.total}</TableCell>
                            <TableCell className="text-right">
                              {isAnchor && (
                                <div className="flex items-center justify-end gap-1">
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-green-600" onClick={(e) => { e.stopPropagation(); applyCombine(); }}>
                                    <CheckCircle className="h-4 w-4 mr-1" /> Ekle
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-red-600" onClick={(e) => { e.stopPropagation(); cancelCombine(); }}>
                                    <XCircle className="h-4 w-4 mr-1" /> İptal
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
