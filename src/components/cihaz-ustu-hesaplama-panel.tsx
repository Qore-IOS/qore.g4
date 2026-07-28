'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle,
  Database,
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
import { addDoc, collection, getDocs, orderBy, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { scopedQuery } from '@/lib/firestore-helpers';
import { labDonemineYaz } from '@/lib/lab-period/kaydet';
import type { Hospital } from '@/lib/types';
import { exportDataToExcel } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseReagentPdfFiles, type ReagentRow } from '@/lib/qore-hesaplama/parse-reagent';
import { parseReagentTxtFiles } from '@/lib/qore-hesaplama/parse-reagent-txt';
import { aggregateReagent, type AggregatedReagentRow } from '@/lib/qore-hesaplama/aggregate';
import { applyReagentAutoSum } from '@/lib/qore-hesaplama/auto-sum-definitions';
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

export default function CihazUstuHesaplamaPanel() {
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
  const [rows, setRows] = useState<Array<CalculationProductRow & AggregatedReagentRow & { matchedTests: string[] }>>([]);
  const [unmatchedTests, setUnmatchedTests] = useState<AggregatedReagentRow[]>([]);
  const [brandFilter, setBrandFilter] = useState(ALL_FILTER_VALUE);
  const [productGroupFilter, setProductGroupFilter] = useState(ALL_FILTER_VALUE);

  const [anchor, setAnchor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const combineMode = anchor !== null;

  const hospitalName = useMemo(
    () => hospitals.find((h) => h.id === hospitalId)?.name || '',
    [hospitals, hospitalId]
  );

  const { definitions: autoSumDefinitions } = useTestAutoSumDefinitions();

  const { rows: scopedProducts, brandOptions, productGroupOptions, isLoadingScope, scopeError, scopeLabel, scopedLabIds } = useQoreCalculationProducts({
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

  const refreshPendingDocs = useCallback(async () => {
    if (!hospitalId) {
      setPendingDocs([]);
      return;
    }
    setIsLoadingPending(true);
    try {
      await deleteExpiredPendingCalculationFiles({ currentCompanyId, isSuperAdmin });
      const docs = await loadPendingCalculationFiles({
        kind: 'cihazUstu',
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

  const visibleRows = rows.length > 0 ? rows : filteredProducts.map((product) => ({
    ...product,
    test: product.testAdi || product.stokKodu,
    available: 0,
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
        parseReagentPdfFiles(pdfs),
        parseReagentTxtFiles(txts),
      ]);
      const merged: ReagentRow[] = [...pdfRows, ...txtRows];
      const aggregated = applyReagentAutoSum(aggregateReagent(merged), autoSumDefinitions);
      const byTest = new Map<string, AggregatedReagentRow[]>();
      aggregated.forEach((row) => {
        const key = normalizeTestName(row.test);
        byTest.set(key, [...(byTest.get(key) ?? []), row]);
      });
      const usedTestKeys = new Set<string>();
      const matched = filteredProducts.map((product) => {
        const productTestKey = normalizeTestName(product.testAdi);
        const matches = byTest.get(productTestKey) ?? [];
        if (matches.length > 0) usedTestKeys.add(productTestKey);
        return {
          ...product,
          test: product.testAdi || product.stokKodu,
          available: matches.reduce((sum, match) => sum + (match.available || 0), 0),
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
      const add = prev.filter((r) => picked.has(r.test)).reduce((s, r) => s + (r.available || 0), 0);
      return prev
        .filter((r) => !picked.has(r.test))
        .map((r) => (r.test === anchor ? { ...r, available: r.available + add } : r));
    });
    cancelCombine();
  }

  const hasZeroRows = useMemo(() => rows.some((r) => (r.available || 0) === 0), [rows]);
  function removeZeroRows() {
    setRows((prev) => prev.filter((r) => (r.available || 0) !== 0));
    cancelCombine();
  }

  function assignUnmatchedTest(testName: string, stokKodu: string) {
    const source = unmatchedTests.find((item) => item.test === testName);
    if (!source || !stokKodu) return;

    setRows((prev) => prev.map((row) => row.stokKodu === stokKodu
      ? {
          ...row,
          test: row.testAdi || row.stokKodu,
          available: source.available,
          matchedTests: [...row.matchedTests, source.test],
        }
      : row
    ));
    setUnmatchedTests((prev) => prev.filter((item) => item.test !== testName));
  }


  /**
   * Bu lab-dönem için kayıtlı cihaz üstü verisini tabloya doldurur.
   *
   * Değerler normalde yüklenen dosyalardan türer; snapshot'ı otomatik
   * uygulamak hangi sayının dosyadan hangisinin kayıttan geldiğini
   * belirsizleştirirdi. Bu yüzden doldurma açık bir eylemdir: kullanıcı
   * butona basar, ne olduğunu bilir.
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
      const kayit = snapshotlar[hospitalId]?.cihazUstu || {};
      const kodlar = Object.keys(kayit);
      if (kodlar.length === 0) {
        toast({ title: 'Kayıt yok', description: 'Bu dönem için kayıtlı cihaz üstü verisi bulunamadı.' });
        return;
      }
      // Tablo boşsa ürün listesinden kurulur; doluysa yalnızca değerler yazılır.
      setRows(prev => {
        const taban = prev.length > 0
          ? prev
          : filteredProducts.map(product => ({
              ...product,
              test: product.testAdi || product.stokKodu,
              available: 0,
              matchedTests: [] as string[],
            }));
        return taban.map(row =>
          kayit[row.stokKodu] ? { ...row, available: kayit[row.stokKodu].deger } : row,
        );
      });
      toast({
        title: 'Kayıtlı veri yüklendi',
        description: `${kodlar.length} ürün için kayıtlı cihaz üstü değerleri tabloya yazıldı.`,
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
      const gecmisRef = await addDoc(collection(db, 'cihazUstuGecmisi'), {
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
          value: r.available || 0,
        })),
        createdAt: serverTimestamp(),
        createdByUid: currentUser?.uid || null,
        createdByName: currentUserProfile?.name || currentUser?.email || null,
      });
      // Cihaz üstü, lab-dönem snapshot'ının tek doğruluk kaynağına da işlenir.
      await labDonemineYaz({
        labId: hospitalId,
        labAdi: hospitalName,
        yil: year,
        ay: month + 1,
        girdiler: rows
          .map(r => ({
            stokKodu: String(r.stokKodu || '').trim(),
            alan: 'cihazUstu' as const,
            deger: Number(r.available) || 0,
          }))
          .filter(g => g.stokKodu && g.deger > 0),
        kaynak: 'cihaz-ustu-hesaplama',
        kaynakKayitId: gecmisRef.id,
        girenAdi: currentUserProfile?.name || currentUser?.email || undefined,
        companyId: currentCompanyId,
      });

      toast({ title: 'Kaydedildi', description: `${period} dönemi cihaz üstü hesaplama geçmişe kaydedildi.` });
    } catch (e: any) {
      toast({ title: 'Kayıt başarısız', description: e?.message || 'Geçmiş kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsSavingHistory(false);
    }
  }

  function handleExport() {
    if (!rows.length) return;
    const data = rows.map((r) => ({ 'Stok Kodu': r.stokKodu, 'Stok Adı': r.stokAdi, 'Test Adı': r.testAdi, 'Eşleşen Dosya Testi': r.matchedTests.join(', '), 'Toplam Kullanılabilir': r.available }));
    const fname = `CihazUstu_${hospitalName || 'Lab'}_${String(month + 1).padStart(2, '0')}-${year}`;
    exportDataToExcel(data, fname, 'Cihaz Üstü', toast);
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
          icon={Activity}
          title="Cihaz Üstü Hesaplama Motoru"
          desc="'Reagent Status' PDF/TXT dosyalarını yükleyin; kullanılabilir test sayılarını çıkarıp benzersiz listede toplayın ve Excel'e aktarın."
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
                onChange={(v) => { setHospitalId(v); setRows([]); setUnmatchedTests([]); }}
                options={hospitals.filter((h) => h.id).map((h) => ({ value: h.id!, label: h.name }))}
                placeholder={loadingHospitals ? 'Yükleniyor...' : 'Seçiniz'}
                icon={<Activity size={17} />}
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
          </div>

          {/* Bekleyen dosya uyarısı */}
          {pendingDocs.length > 0 && (
            card(
              <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', alignItems: mobile ? 'stretch' : 'center', gap: 12 }}>
                <span style={{ display: 'inline-flex', flexShrink: 0, color: '#9A6F1E' }}><FileText size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.ink1 }}>Sayım ekranından gelen bekleyen dosya var</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: C.ink2, marginTop: 3, lineHeight: 1.45 }}>
                    {selectedPeriod} döneminde bu laboratuvar için {pendingDocs.reduce((sum, pending) => sum + pending.files.length, 0)} cihaz üstü dosyası hesaplamaya hazır bekliyor.
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
            <Link href="/cihaz-ustu-hesaplama/gecmis" style={{ textDecoration: 'none' }}>
              <SoftBtn><History size={17} /> Geçmiş</SoftBtn>
            </Link>
            <PrimaryBtn onClick={handleParse} disabled={!canParse}>
              {isParsing ? <Loader2 size={17} style={{ animation: 'cySpin 1s linear infinite' }} /> : <Activity size={17} />}
              {files.length > 0 ? `${files.length} Dosyayı Ayrıştır` : 'Ayrıştır'}
            </PrimaryBtn>
            <SoftBtn onClick={handleKayittanDoldur} disabled={!hospitalId || isLoadingSnapshot || combineMode}>
              {isLoadingSnapshot ? (
                <Loader2 size={17} style={{ animation: 'cySpin 1s linear infinite' }} />
              ) : (
                <Database size={17} />
              )}{' '}
              Kayıtlı Veriden Doldur
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
                          <div style={{ fontSize: 12, fontWeight: 500, color: C.ink3, marginTop: 2 }}>Toplam Kullanılabilir: {item.available}</div>
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
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.ink1 }}>Ürün Bazlı Cihaz Üstü Eşleşmeler ({visibleRows.length} ürün)</h3>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2 }}>
                  {hospitalName ? `${hospitalName} – ${MONTHS[month].label} ${year}` : `${MONTHS[month].label} ${year}`}
                  {combineMode && ' • Birleştirme modu: ana teste eklenecek testleri seçin.'}
                </span>
              </div>
              <div style={{ borderRadius: C.radius, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
                <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: C.surface }}>
                      <tr style={{ textAlign: 'left', color: C.ink3 }}>
                        <th style={thStyle(40)} />
                        <th style={thStyle()}>Stok Kodu</th>
                        <th style={thStyle()}>Stok Adı</th>
                        <th style={thStyle()}>Test Adı</th>
                        <th style={thStyle()}>Eşleşen Dosya Testi</th>
                        <th style={thStyle(undefined, 'right')}>Toplam Kullanılabilir</th>
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
                            <td style={{ ...tdStyle('right'), fontWeight: 800, color: AC.primary }}>{r.available}</td>
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
              <EmptyBlock icon={<Activity size={26} />} text="Henüz sonuç yok" sub="Bir laboratuvar seçip dosya yükleyerek hesaplamayı başlatın." />
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
