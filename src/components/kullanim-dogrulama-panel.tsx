'use client';

import React, { useState, useMemo, useEffect, useCallback, KeyboardEvent } from 'react';
import type { Laboratory, ProductCode, ConsumptionRecord, VerificationItemGroup } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Recycle, Loader2, Search, Barcode, CheckCircle2, AlertCircle, ScanLine, ShieldCheck, Package } from 'lucide-react';
import { DISPOSAL_BARCODE_LENGTH, DISPOSAL_LOT_LENGTH } from '@/lib/constants';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { kullanimDogrulamaLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';

export default function KullanimDogrulamaPanel() {
  const [selectedLaboratoryId, setSelectedLaboratoryId] = useState<string>('');
  const [disposalBarcode, setDisposalBarcode] = useState<string>('');
  const [verificationItems, setVerificationItems] = useState<VerificationItemGroup[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

interface KullanimDogrulamaPanelProps {
  initialLaboratoryId?: string;
}

interface LotNfcDefinition {
  stokKodu: string;
  stokAdi?: string;
  lotNumarasi: string;
  sampleUid?: string;
  patternKey?: string;
  b3?: string;
  b4?: string;
  fixedSuffix?: string;
  registeredTagUIDs?: string[];
}

interface NfcDisposalEvent {
  id: string;
  laboratoryId: string;
  laboratoryName: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  uid: string;
  patternKey?: string;
  fixedSuffix?: string;
  consumptionRecordIds: string[];
}

interface NfcVerificationGroup {
  id: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  tuketilenAdet: number;
  consumptionRecordIds: string[];
  tuketilenSeriNolar: string[];
  disposedUids: string[];
  productIdentityKey: string;
  eksikAileTanimi: boolean;
}

const DAY_RANGE_OPTIONS: Array<{ value: DayRangeOption; label: string }> = [
  { value: '1', label: 'Son 1 gün' },
  { value: '2', label: 'Son 2 gün' },
  { value: '5', label: 'Son 5 gün' },
  { value: '7', label: 'Son 7 gün' },
  { value: '30', label: 'Son 30 gün' },
  { value: 'all', label: 'Tüm geçmiş' },
];

const normalizeNfcUid = (raw: string): string | null => {
  const hex = (raw || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 16) return null;
  return hex.match(/.{1,2}/g)?.join(':') ?? null;
};

const parseNfcUid = (raw: string) => {
  const normalized = normalizeNfcUid(raw);
  if (!normalized) return null;

  const bytes = normalized.split(':');
  if (bytes.length !== 8) return null;

  return {
    normalized,
    serialField: `${bytes[0]}:${bytes[1]}`,
    ignoredB3: bytes[2],
    productIdentityKey: `${bytes[3]}:${bytes[4]}:${bytes[5]}:${bytes[6]}:${bytes[7]}`,
    fixedSuffix: bytes.slice(4).join(':'),
  };
};

const buildLotNfcDefinitionId = (stokKodu: string, lotNumarasi: string) =>
  `${encodeURIComponent(stokKodu)}__${encodeURIComponent(lotNumarasi)}`;

const buildDisposalEventId = (uid: string) => normalizeNfcUid(uid)?.replace(/:/g, '') ?? uid.replace(/[^0-9A-F]/gi, '').toUpperCase();

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const getSinceDate = (range: DayRangeOption): Date | null => {
  if (range === 'all') return null;
  const days = Number(range);
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date;
};

const uniqueStrings = (values: Array<string | undefined | null>) =>
  Array.from(new Set(values.map((value) => (value || '').trim().toUpperCase()).filter(Boolean)));

export default function KullanimDogrulamaPanel({ initialLaboratoryId = '' }: KullanimDogrulamaPanelProps) {
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();

  const DISPOSAL_BARCODE_INPUT_ID = "disposal-barcode-input";

  const fetchPanelData = useCallback(async () => {
    setIsLoading(true);
    const startTime = performance.now();

    try {
      const [laboratoriesSnap, productsSnap, consumptionSnap] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'tuketimKayitlari'))
      ]);

      setLaboratories(laboratoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Laboratory)));
      setProductCodes(productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductCode)));

      const consumptionItems = consumptionSnap.docs.map(doc => {
        const data = doc.data();
        Object.keys(data).forEach(key => {
          if (data[key] instanceof Timestamp) {
            data[key] = data[key].toDate();
          }
        });
        return { id: doc.id, ...data } as ConsumptionRecord;
      });
      setTuketimKayitlari(consumptionItems);

      const duration = performance.now() - startTime;
      kullanimDogrulamaLogger.performance('Panel verileri yüklendi', duration, {
        laboratoriesCount: laboratoriesSnap.docs.length,
        productsCount: productsSnap.docs.length,
        consumptionCount: consumptionSnap.docs.length,
      });
    } catch (error) {
      kullanimDogrulamaLogger.error('Panel verileri yüklenemedi', error);
      toast({ title: "Veri Hatası", description: "Doğrulama paneli için veriler yüklenemedi.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    setSelectedLaboratoryId(initialLaboratoryId || '');
  }, [initialLaboratoryId]);

  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLabsLoading(true);
      try {
        const [laboratoriesSnap, productsSnap] = await Promise.all([
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'productCodes')),
        ]);

        setLaboratories(
          laboratoriesSnap.docs.map((item) => ({ id: item.id, ...item.data() } as Laboratory))
        );
        setProductCodes(
          productsSnap.docs.map((item) => ({ id: item.id, ...item.data() } as ProductCode))
        );

        kullanimDogrulamaLogger.info('Kullanım doğrulama temel verileri yüklendi', {
          laboratoryCount: laboratoriesSnap.docs.length,
          productCount: productsSnap.docs.length,
        });
      } catch (error) {
        kullanimDogrulamaLogger.error('Kullanım doğrulama temel verileri yüklenemedi', error);
        toast({
          title: 'Veri Hatası',
          description: 'Laboratuvar ve ürün listesi yüklenemedi.',
          variant: 'destructive',
        });
      } finally {
        setIsLabsLoading(false);
      }
    };

    fetchInitialData();
  }, [toast]);

  const serialTrackedCodes = useMemo(
    () => new Set(productCodes.filter((product) => product.trackingMode === 'serial').map((product) => product.stokKodu)),
    [productCodes]
  );

  const verificationGroups: NfcVerificationGroup[] = useMemo(() => {
    const grouped: Record<string, NfcVerificationGroup> = {};

    consumptionRecords
      .filter((record) => serialTrackedCodes.has(record.stokKodu))
      .forEach((record) => {
        const key = `${record.stokKodu}__${record.lotNumarasi || ''}`;
        const definition = lotDefinitionsByKey[key];
        const productIdentityKey = definition?.b4
          ? `${definition.b4}:${(definition?.fixedSuffix || NFC_SUFFIX).toUpperCase()}`
          : '';

        if (!grouped[key]) {
          grouped[key] = {
            id: key,
            stokKodu: record.stokKodu,
            stokAdi: record.stokAdi,
            lotNumarasi: record.lotNumarasi || '',
            miad: record.miad,
            tuketilenAdet: 0,
            dogrulananAdet: 0,
            originalRecordIds: [],
          };
        }

        grouped[key].tuketilenAdet += 1;
        if (!grouped[key].originalRecordIds.includes(record.id)) {
          grouped[key].originalRecordIds.push(record.id);
        }
      });

      const currentVerificationState = verificationItems.reduce((acc, item) => {
        const key = `${item.stokKodu}-${item.lotNumarasi}-${item.miad}`;
        acc[key] = item.dogrulananAdet;
        return acc;
      }, {} as Record<string, number>);

      Object.keys(grouped).forEach(key => {
        if (currentVerificationState[key] && currentVerificationState[key] <= grouped[key].tuketilenAdet) {
          grouped[key].dogrulananAdet = currentVerificationState[key];
        }
      });

      setVerificationItems(Object.values(grouped).sort((a, b) => a.stokAdi.localeCompare(b.stokAdi)));
    } else {
      setVerificationItems([]);
    }
    setDisposalBarcode('');
  }, [selectedLaboratoryId, tuketimKayitlari, laboratories]);

  const filteredVerificationItems = useMemo(() => {
    if (!searchTerm) return verificationItems;
    return verificationItems.filter(item =>
      item.stokAdi.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.stokKodu.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.lotNumarasi.toLowerCase().includes(searchTerm.toLowerCase())
    );

  /* ─── Summary KPIs ─── */
  const summary = useMemo(() => {
    const total = verificationItems.reduce((sum, i) => sum + i.tuketilenAdet, 0);
    const verified = verificationItems.reduce((sum, i) => sum + i.dogrulananAdet, 0);
    const fullyVerified = verificationItems.filter(i => i.dogrulananAdet === i.tuketilenAdet && i.tuketilenAdet > 0).length;
    const pending = verificationItems.filter(i => i.dogrulananAdet < i.tuketilenAdet).length;
    return { total, verified, fullyVerified, pending, percentage: total > 0 ? Math.round((verified / total) * 100) : 0 };
  }, [verificationItems]);

  const handleDisposalScan = (barcodeToProcess?: string) => {
    const currentBarcode = (barcodeToProcess || disposalBarcode).trim();

    if (!selectedLaboratoryId) {
      toast({ title: 'Uyarı', description: 'Önce laboratuvar seçin.' });
      return;
    }

    if (!hasFetchedData) {
      toast({
        title: 'Önce Veri Alın',
        description: 'Laboratuvar ve gün aralığını seçip "Veri Al" butonuna basın.',
      });
      return;
    }

    if (!parsedUid || !NFC_TAG_REGEX.test(parsedUid.normalized)) {
      toast({
        title: 'Geçersiz UID',
        description: 'Beklenen format: xx:xx:xx:xx:xx:xx:xx:xx',
        variant: 'destructive',
      });
      setNfcInput('');
      return;
    }

    const uid = parsedUid.normalized;
    const disposalDocId = buildDisposalEventId(uid);

    try {
      const existingDisposalSnap = await getDoc(doc(db, 'nfcDisposalEvents', disposalDocId));
      if (existingDisposalSnap.exists()) {
        toast({
          title: 'UID Daha Önce İmha Edilmiş',
          description: `${uid} daha önce disposed olarak işaretlenmiş.`,
          variant: 'destructive',
        });
        setNfcInput('');
        document.getElementById(NFC_INPUT_ID)?.focus();
        return;
      }

      const familyGroup = verificationGroups.find((group) =>
        !group.eksikAileTanimi &&
        group.productIdentityKey === parsedUid.productIdentityKey
      );

      const exactGroup = verificationGroups.find((group) =>
        !group.eksikAileTanimi &&
        group.productIdentityKey === parsedUid.productIdentityKey &&
        group.disposedUids.length < group.tuketilenAdet
      );

      if (!exactGroup) {
        if (familyGroup) {
          toast({
            title: 'Bekleyen Kutu Kalmadı',
            description: `${familyGroup.stokAdi} / ${familyGroup.lotNumarasi} için tanımlı aile örüntüsü eşleşti ancak bekleyen boş kutu kalmamış görünüyor.`,
            variant: 'destructive',
          });
        } else {
          const samePatternDifferentSuffix = verificationGroups.find((group) =>
            !group.eksikAileTanimi && group.productIdentityKey.startsWith(`${parsedUid.productIdentityKey.split(':')[0]}:`)
          );

          if (samePatternDifferentSuffix) {
            toast({
              title: 'Ürün Kimliği Yakın, Örüntü Uyuşmadı',
              description: `${uid} için ürün byte alanı benzer görünüyor ancak beklenen ürün+lota ait kimlik ile tam eşleşme yok.`,
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Aile Örüntüsü Tanımlı Değil',
              description: `${uid} için ${parsedUid.productIdentityKey} ürün-lot kimliği seçili laboratuvarın bekleyen tüketimlerinde bulunamadı.`,
              variant: 'destructive',
            });
          }
        }
        setNfcInput('');
        document.getElementById(NFC_INPUT_ID)?.focus();
        return;
      }

      await setDoc(doc(db, 'nfcDisposalEvents', disposalDocId), {
        laboratoryId: selectedLaboratoryId,
        laboratoryName: laboratories.find((laboratory) => laboratory.id === selectedLaboratoryId)?.name || '',
        stokKodu: exactGroup.stokKodu,
        stokAdi: exactGroup.stokAdi,
        lotNumarasi: exactGroup.lotNumarasi,
        uid,
        patternKey: parsedUid.productIdentityKey,
        fixedSuffix: parsedUid.fixedSuffix,
        serialField: parsedUid.serialField,
        consumptionRecordIds: exactGroup.consumptionRecordIds,
        source: 'kullanim-dogrulama-panel',
        status: 'disposed',
        verifiedAt: serverTimestamp(),
        verifiedByUid: currentUserProfile?.uid || '',
        verifiedByName: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
      });
      toast({ title: "Doğrulandı", description: `${updatedItemDetailsForToast.stokAdi} (Lot: ${updatedItemDetailsForToast.lotNumarasi}) için 1 adet imha doğrulandı.` });
    } else {
      const alreadyFullyVerifiedItem = verificationItems.find(item => item.lotNumarasi === kitLotNumber && item.dogrulananAdet === item.tuketilenAdet);
      if (alreadyFullyVerifiedItem) {
        kullanimDogrulamaLogger.debug('Zaten tamamen doğrulanmış lot', { kitLotNumber });
        toast({ title: "Zaten Doğrulanmış", description: `${alreadyFullyVerifiedItem.stokAdi} (Lot: ${kitLotNumber}) için tüm tüketimler zaten doğrulanmış.`, variant: "default", duration: 5000 });
      } else {
        kullanimDogrulamaLogger.warn('Eşleşen lot bulunamadı', { kitLotNumber });
        toast({ title: "Uyarı", description: `Okutulan kit lot numarası (${kitLotNumber}) ile eşleşen veya doğrulanmamış tüketim bulunamadı.`, variant: "default", duration: 5000 });
      }
    }

    try {
      // @ts-ignore Web NFC API
      const ndef = new NDEFReader();
      await ndef.scan();
      setIsWebNfcScanning(true);
      ndef.onreading = (event: { serialNumber?: string }) => {
        if (!event.serialNumber) return;
        const normalized = normalizeNfcUid(event.serialNumber);
        if (!normalized) return;
        setNfcInput(normalized);
        void processNfcScanRef.current(normalized);
      };
    } catch (error) {
      kullanimDogrulamaLogger.warn('Web NFC otomatik dinleme başlatılamadı', error);
      setIsWebNfcScanning(false);
    }
  };

  const handleDisposalKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleDisposalScan();
    }
  };

  return (
    <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 sm:space-y-5 min-h-screen" role="main" aria-label="Kullanım doğrulama paneli">

      {/* ══════════════════════ HEADER ══════════════════════ */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)] flex items-center gap-2">
            <Recycle className="h-5 w-5 text-emerald-500" />
            Kullanım Doğrulama
          </h1>
          <p className="text-[11px] sm:text-xs text-[var(--dashboard-muted)] truncate">
            Kullanılan ürünlerin kitlerinin imha edildiğini doğrulayın
          </p>
        </div>
      </div>

      {/* ══════════════════════ LABORATORY SELECT ══════════════════════ */}
      <div className="cihaz-card p-4 sm:p-5 space-y-3">
        <p className="cihaz-overline text-[10px] sm:text-xs">Laboratuvar</p>
        <Select value={selectedLaboratoryId} onValueChange={(value) => { setSelectedLaboratoryId(value); setSearchTerm(''); }}>
          <SelectTrigger className="cihaz-pressed border-none h-10 w-full sm:w-1/2 lg:w-1/3" aria-label="Doğrulama yapılacak laboratuvarı seçin">
            <SelectValue placeholder="Laboratuvar seçin" />
          </SelectTrigger>
          <SelectContent>
            {laboratories.map(h => (
              <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ══════════════════════ CONTENT ══════════════════════ */}
      {selectedLaboratoryId && (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="cihaz-card p-3 sm:p-4 flex flex-col items-center text-center">
              <Package className="h-4 w-4 text-[var(--dashboard-accent)] mb-1.5" />
              <span className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">{summary.total}</span>
              <span className="text-[10px] text-[var(--dashboard-muted)] font-medium uppercase tracking-wide">Toplam Tüketim</span>
            </div>
            <div className="cihaz-card p-3 sm:p-4 flex flex-col items-center text-center">
              <ShieldCheck className="h-4 w-4 text-emerald-500 mb-1.5" />
              <span className="text-xl sm:text-2xl font-bold text-emerald-600">{summary.verified}</span>
              <span className="text-[10px] text-[var(--dashboard-muted)] font-medium uppercase tracking-wide">Doğrulanan</span>
            </div>
            <div className="cihaz-card p-3 sm:p-4 flex flex-col items-center text-center">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 mb-1.5" />
              <span className="text-xl sm:text-2xl font-bold text-emerald-600">{summary.fullyVerified}</span>
              <span className="text-[10px] text-[var(--dashboard-muted)] font-medium uppercase tracking-wide">Tamamlanan</span>
            </div>
            <div className="cihaz-card p-3 sm:p-4 flex flex-col items-center text-center">
              <AlertCircle className="h-4 w-4 text-amber-500 mb-1.5" />
              <span className="text-xl sm:text-2xl font-bold text-amber-600">{summary.pending}</span>
              <span className="text-[10px] text-[var(--dashboard-muted)] font-medium uppercase tracking-wide">Bekleyen</span>
            </div>
          </div>

          {/* ── Global Progress Bar ── */}
          <div className="cihaz-card p-4 sm:p-5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[var(--dashboard-text)]">Genel İlerleme</p>
              <span className="text-xs font-bold text-[var(--dashboard-accent)]">{summary.percentage}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500 ease-out"
                style={{ width: `${summary.percentage}%` }}
              />
            </div>
            <p className="text-[10px] text-[var(--dashboard-muted)]">
              {summary.verified} / {summary.total} adet doğrulandı
            </p>
          </div>

          {/* ── Barcode Scanner ── */}
          <div className="cihaz-card p-4 sm:p-5 space-y-3">
            <p className="cihaz-overline text-[10px] sm:text-xs flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5" />
              Barkod Tarayıcı
            </p>
            <div className="flex items-center gap-2" role="search">
              <Input
                id={DISPOSAL_BARCODE_INPUT_ID}
                placeholder={`İmha kiti barkodu (${DISPOSAL_BARCODE_LENGTH} hane)`}
                value={disposalBarcode}
                onChange={(e) => setDisposalBarcode(e.target.value)}
                onKeyPress={handleDisposalKeyPress}
                maxLength={DISPOSAL_BARCODE_LENGTH}
                className="cihaz-pressed border-none flex-grow h-10 text-sm font-mono"
                disabled={!selectedLaboratoryId || verificationItems.length === 0}
                aria-label="İmha kiti barkodu girin"
              />
              <button
                onClick={() => handleDisposalScan()}
                disabled={!disposalBarcode}
                className="cihaz-tool-item flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium disabled:opacity-40 shrink-0"
                aria-label="Barkodu doğrula"
              >
                <Barcode className="h-4 w-4" />
                <span className="hidden sm:inline">Doğrula</span>
              </button>
            </div>
          </div>

          {/* ── Search + Verification Table ── */}
          <div className="cihaz-card-strong flex-1 flex flex-col overflow-hidden">
            {/* Search bar */}
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-[var(--dashboard-stroke)]">
              <p className="text-xs font-semibold text-[var(--dashboard-text)] shrink-0">Doğrulanacak Kullanımlar</p>
              <div className="relative max-w-xs w-full">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--dashboard-muted)]" />
                <Input
                  type="search"
                  placeholder="Stok adı, kodu veya lot ara..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cihaz-pressed border-none h-8 text-xs pl-8"
                />
              </div>
            </div>

            {/* Table header */}
            {filteredVerificationItems.length > 0 && (
              <div className="hidden sm:grid grid-cols-[2fr_1fr_80px_70px_70px_140px] gap-1 px-4 sm:px-5 py-2.5 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)]">
                <span>Ürün</span>
                <span>Lot / Miad</span>
                <span className="text-center">Tüketilen</span>
                <span className="text-center">Doğrulanan</span>
                <span className="text-center">%</span>
                <span>İlerleme</span>
              </div>
            )}

            {/* Content */}
            {isLoading ? (
              <div className="flex items-center justify-center h-[40vh]">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
              </div>
            ) : verificationItems.length === 0 && !searchTerm ? (
              <div className="flex flex-col items-center justify-center h-[35vh] text-center px-4">
                <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                  <Recycle className="h-6 w-6 text-[var(--dashboard-muted)]" />
                </div>
                <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Kayıt bulunamadı</p>
                <p className="text-xs text-[var(--dashboard-muted)]">Bu laboratuvar için doğrulanacak kullanım kaydı yok</p>
              </div>
            ) : filteredVerificationItems.length === 0 && searchTerm ? (
              <div className="flex flex-col items-center justify-center h-[35vh] text-center px-4">
                <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                  <Search className="h-6 w-6 text-[var(--dashboard-muted)]" />
                </div>
                <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Sonuç yok</p>
                <p className="text-xs text-[var(--dashboard-muted)]">Arama kriterlerine uyan kayıt bulunamadı</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto" style={{ maxHeight: '55vh' }}>
                {filteredVerificationItems.map((item, idx) => {
                  const progressPercentage = item.tuketilenAdet > 0 ? (item.dogrulananAdet / item.tuketilenAdet) * 100 : 0;
                  const isFullyVerified = item.dogrulananAdet === item.tuketilenAdet && item.tuketilenAdet > 0;

                  return (
                    <div
                      key={`${item.stokKodu}-${item.lotNumarasi}-${item.miad}`}
                      className={cn(
                        "border-b border-[var(--dashboard-stroke)] last:border-0 hover:bg-[var(--dashboard-surface-2)] transition-colors",
                        idx % 2 === 0 && "bg-[var(--dashboard-surface)]/50",
                        isFullyVerified && "opacity-60"
                      )}
                    >
                      {/* Desktop row */}
                      <div className="hidden sm:grid grid-cols-[2fr_1fr_80px_70px_70px_140px] gap-1 items-center px-4 sm:px-5 py-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[var(--dashboard-text)] truncate flex items-center gap-1.5">
                            {isFullyVerified && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                            {item.stokAdi}
                          </p>
                          <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">{item.stokKodu}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] text-[var(--dashboard-text)] font-mono">{item.lotNumarasi}</p>
                          <p className="text-[10px] text-[var(--dashboard-muted)]">{item.miad}</p>
                        </div>
                        <span className="text-xs font-medium text-center text-[var(--dashboard-text)]">{item.tuketilenAdet}</span>
                        <span className={cn(
                          "text-xs font-bold text-center",
                          isFullyVerified ? "text-emerald-600" : "text-[var(--dashboard-accent)]"
                        )}>{item.dogrulananAdet}</span>
                        <span className="text-[10px] font-mono text-center text-[var(--dashboard-muted)]">{Math.round(progressPercentage)}%</span>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-300",
                                isFullyVerified
                                  ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                                  : "bg-gradient-to-r from-[var(--dashboard-accent)] to-amber-400"
                              )}
                              style={{ width: `${progressPercentage}%` }}
                            />
                          </div>
                          {isFullyVerified && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
                        </div>
                      </div>

                      {/* Mobile row */}
                      <div className="sm:hidden px-4 py-3 space-y-2">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--dashboard-text)] truncate flex items-center gap-1.5">
                              {isFullyVerified && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                              {item.stokAdi}
                            </p>
                            <p className="text-[10px] text-[var(--dashboard-muted)] font-mono">{item.stokKodu}</p>
                          </div>
                          <span className={cn(
                            "text-lg font-bold ml-2",
                            isFullyVerified ? "text-emerald-600" : "text-[var(--dashboard-accent)]"
                          )}>
                            {item.dogrulananAdet}/{item.tuketilenAdet}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]">
                            Lot: {item.lotNumarasi}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]">
                            Miad: {item.miad}
                          </span>
                          {isFullyVerified && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              Tamamlandı
                            </span>
                          )}
                        </div>
                        <div className="h-1.5 rounded-full bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              isFullyVerified
                                ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                                : "bg-gradient-to-r from-[var(--dashboard-accent)] to-amber-400"
                            )}
                            style={{ width: `${progressPercentage}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Empty state when no lab selected ── */}
      {!selectedLaboratoryId && !isLoading && (
        <div className="cihaz-card-strong flex flex-col items-center justify-center h-[50vh] text-center px-4">
          <div className="w-20 h-20 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
            <ScanLine className="h-8 w-8 text-[var(--dashboard-muted)]" />
          </div>
          <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Laboratuvar Seçin</p>
          <p className="text-xs text-[var(--dashboard-muted)] max-w-xs">
            Doğrulama işlemine başlamak için yukarıdan bir laboratuvar seçin
          </p>
        </div>
      )}
    </div>
  );
}
