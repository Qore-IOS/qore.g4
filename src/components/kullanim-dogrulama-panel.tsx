'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { Laboratory, ProductCode, ConsumptionRecord } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CalendarClock, CheckSquare, Info, Loader2, Nfc, Search, ShieldCheck, Smartphone, Trash2, RefreshCcw, ScanLine, AlertTriangle } from 'lucide-react';
import {
  collection,
  getDoc,
  getDocs,
  doc,
  onSnapshot,
  query,
  setDoc,
  Timestamp,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { kullanimDogrulamaLogger } from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';

const NFC_TAG_REGEX = /^[0-9A-F]{2}(:[0-9A-F]{2}){7}$/;
const NFC_INPUT_ID = 'nfc-tag-input';
const NFC_SUFFIX = '53:01:04:E0';

type DayRangeOption = '1' | '2' | '5' | '7' | '30' | 'all';

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

  const [selectedLaboratoryId, setSelectedLaboratoryId] = useState<string>(initialLaboratoryId);
  const [selectedRange, setSelectedRange] = useState<DayRangeOption>('1');
  const [nfcInput, setNfcInput] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLabsLoading, setIsLabsLoading] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [isWebNfcScanning, setIsWebNfcScanning] = useState(false);
  const [hasFetchedData, setHasFetchedData] = useState(false);
  const [loadedRangeLabel, setLoadedRangeLabel] = useState<string>('');
  const [activeSinceDate, setActiveSinceDate] = useState<Date | null>(null);

  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [consumptionRecords, setConsumptionRecords] = useState<ConsumptionRecord[]>([]);
  const [lotDefinitionsByKey, setLotDefinitionsByKey] = useState<Record<string, LotNfcDefinition>>({});
  const [disposalEvents, setDisposalEvents] = useState<NfcDisposalEvent[]>([]);

  const unsubscribeRefs = useRef<Array<() => void>>([]);
  const scanBufferRef = useRef('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const processNfcScanRef = useRef<(rawUid?: string) => Promise<void>>(async () => {});

  const clearSubscriptions = () => {
    unsubscribeRefs.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRefs.current = [];
  };

  useEffect(() => () => {
    unsubscribeRefs.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRefs.current = [];
  }, []);

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
            consumptionRecordIds: [],
            tuketilenSeriNolar: [],
            disposedUids: [],
            productIdentityKey,
            eksikAileTanimi: !productIdentityKey,
          };
        }

        grouped[key].tuketilenAdet += 1;
        grouped[key].consumptionRecordIds.push(record.id);
        if (record.seriNumarasi) {
          grouped[key].tuketilenSeriNolar.push(record.seriNumarasi);
        }
      });

    Object.values(grouped).forEach((group) => {
      const disposedUids = uniqueStrings(
        disposalEvents
          .filter((event) => event.stokKodu === group.stokKodu && event.lotNumarasi === group.lotNumarasi)
          .map((event) => event.uid)
      );

      group.disposedUids = disposedUids;
      group.tuketilenSeriNolar = uniqueStrings(group.tuketilenSeriNolar);
    });

    return Object.values(grouped).sort((left, right) => left.stokAdi.localeCompare(right.stokAdi, 'tr'));
  }, [consumptionRecords, disposalEvents, lotDefinitionsByKey, serialTrackedCodes]);

  const filteredGroups = !searchTerm
    ? verificationGroups
    : verificationGroups.filter((group) =>
        [group.stokAdi, group.stokKodu, group.lotNumarasi]
          .join(' ')
          .toLowerCase()
          .includes(searchTerm.toLowerCase())
      );

  const expectedVerificationCount = verificationGroups.reduce((sum, group) => sum + group.tuketilenAdet, 0);
  const verifiedVerificationCount = verificationGroups.reduce((sum, group) => sum + group.disposedUids.length, 0);
  const overallProgress = {
    expected: expectedVerificationCount,
    verified: verifiedVerificationCount,
    total:
      expectedVerificationCount > 0
        ? Math.round((verifiedVerificationCount / expectedVerificationCount) * 100)
        : 0,
  };

  const syncLabUrl = (labId: string) => {
    const targetPath = labId ? `/kullanim-dogrulama/${labId}` : '/kullanim-dogrulama';
    window.history.replaceState(null, '', targetPath);
  };

  const hydrateLotDefinitions = async (records: ConsumptionRecord[]) => {
    const keys = Array.from(
      new Set(
        records
          .filter((record) => record.stokKodu && record.lotNumarasi)
          .map((record) => `${record.stokKodu}__${record.lotNumarasi || ''}`)
      )
    );

    if (keys.length === 0) {
      setLotDefinitionsByKey({});
      return;
    }

    try {
      const entries = await Promise.all(
        keys.map(async (key) => {
          const [stokKodu, lotNumarasi] = key.split('__');
          const definitionId = buildLotNfcDefinitionId(stokKodu, lotNumarasi);
          const definitionSnap = await getDoc(doc(db, 'lotNfcDefinitions', definitionId));
          return [key, definitionSnap.exists() ? (definitionSnap.data() as LotNfcDefinition) : null] as const;
        })
      );

      setLotDefinitionsByKey(
        entries.reduce<Record<string, LotNfcDefinition>>((accumulator, [key, value]) => {
          if (value) accumulator[key] = value;
          return accumulator;
        }, {})
      );
    } catch (error) {
      kullanimDogrulamaLogger.error('Lot NFC tanımları yüklenemedi', error);
      toast({
        title: 'NFC Tanım Hatası',
        description: 'Tüketim kayıtlarına bağlı lot NFC tanımları yüklenemedi.',
        variant: 'destructive',
      });
    }
  };

  const handleFetchData = useCallback(async () => {
    if (!selectedLaboratoryId) {
      toast({
        title: 'Laboratuvar Seçin',
        description: 'Önce doğrulama yapılacak laboratuvarı seçin.',
      });
      return;
    }

    const selectedLaboratory = laboratories.find((laboratory) => laboratory.id === selectedLaboratoryId);
    if (!selectedLaboratory) {
      toast({
        title: 'Laboratuvar Bulunamadı',
        description: 'Seçilen laboratuvar bilgisi yüklenemedi.',
        variant: 'destructive',
      });
      return;
    }

    clearSubscriptions();
    setIsDataLoading(true);
    setConsumptionRecords([]);
    setDisposalEvents([]);
    setLotDefinitionsByKey({});
    setHasFetchedData(false);
    setSearchTerm('');

    const sinceDate = getSinceDate(selectedRange);
    setActiveSinceDate(sinceDate);
    setLoadedRangeLabel(
      selectedRange === 'all'
        ? 'Tüm geçmiş'
        : `Son ${selectedRange} gün`
    );

    try {
      const consumptionConstraints = [
        where('laboratoryId', '==', selectedLaboratoryId),
        where('consumptionType', '==', 'normal_kullanim'),
      ];

      if (sinceDate) {
        consumptionConstraints.push(where('consumptionTimestamp', '>=', Timestamp.fromDate(sinceDate)));
      }

      const consumptionQuery = query(collection(db, 'tuketimKayitlari'), ...consumptionConstraints);
      const unsubscribeConsumption = onSnapshot(
        consumptionQuery,
        async (snapshot) => {
          const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ConsumptionRecord));
          setConsumptionRecords(records);
          await hydrateLotDefinitions(records);
          setIsDataLoading(false);
          setHasFetchedData(true);

          kullanimDogrulamaLogger.info('Kullanım doğrulama tüketim snapshot güncellendi', {
            laboratoryId: selectedLaboratoryId,
            count: records.length,
            range: selectedRange,
          });
        },
        (error) => {
          kullanimDogrulamaLogger.error('Tüketim snapshot dinlenemedi', error);
          setIsDataLoading(false);
          toast({
            title: 'Tüketim Hatası',
            description: 'Seçilen aralıktaki tüketim verileri alınamadı.',
            variant: 'destructive',
          });
        }
      );

      const disposalQuery = query(
        collection(db, 'nfcDisposalEvents'),
        where('laboratoryId', '==', selectedLaboratoryId)
      );
      const unsubscribeDisposals = onSnapshot(
        disposalQuery,
        (snapshot) => {
          setDisposalEvents(
            snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as NfcDisposalEvent))
          );
        },
        (error) => {
          kullanimDogrulamaLogger.error('İmha/NFC disposal snapshot dinlenemedi', error);
        }
      );

      unsubscribeRefs.current = [unsubscribeConsumption, unsubscribeDisposals];
      syncLabUrl(selectedLaboratoryId);
      setNfcInput('');

      toast({
        title: 'Veriler Yükleniyor',
        description:
          selectedRange === 'all'
            ? `${selectedLaboratory.name} için tüm geçmiş tüketim verileri yükleniyor.`
            : `${selectedLaboratory.name} için son ${selectedRange} günün tüketimleri yükleniyor.`,
      });
    } catch (error) {
      kullanimDogrulamaLogger.error('Kullanım doğrulama veri akışı başlatılamadı', error);
      setIsDataLoading(false);
      toast({
        title: 'Akış Başlatılamadı',
        description: 'Seçilen laboratuvar için doğrulama verileri başlatılamadı.',
        variant: 'destructive',
      });
    }
  }, [clearSubscriptions, hydrateLotDefinitions, laboratories, selectedLaboratoryId, selectedRange, syncLabUrl, toast]);

  const processNfcScan = async (rawUid?: string) => {
    const sourceUid = rawUid ?? nfcInput;
    const parsedUid = parseNfcUid(sourceUid);

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

      kullanimDogrulamaLogger.info('NFC disposal doğrulaması tamamlandı', {
        uid,
        stokKodu: exactGroup.stokKodu,
        lotNumarasi: exactGroup.lotNumarasi,
      });

      toast({
        title: 'Çöp Kutusu Kabul Etti',
        description: `${exactGroup.stokAdi} için ${uid} aile örüntüsüne uygun olarak kabul edildi.`,
      });
      setNfcInput('');
      document.getElementById(NFC_INPUT_ID)?.focus();
    } catch (error) {
      kullanimDogrulamaLogger.error('NFC disposal doğrulaması kaydedilemedi', error);
      toast({
        title: 'Kayıt Hatası',
        description: 'NFC doğrulama sonucu kaydedilemedi.',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    processNfcScanRef.current = processNfcScan;
  }, [processNfcScan]);

  const startWebNfcScan = async () => {
    if (typeof window === 'undefined' || !('NDEFReader' in window)) {
      setIsWebNfcScanning(false);
      return;
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

  useEffect(() => {
    if (!hasFetchedData || !selectedLaboratoryId) {
      setIsWebNfcScanning(false);
      return;
    }

    void startWebNfcScan();
  }, [hasFetchedData, selectedLaboratoryId]);

  useEffect(() => {
    if (!hasFetchedData) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      const isOtherInputFocused = activeElement?.tagName === 'INPUT' && activeElement.id !== NFC_INPUT_ID;
      if (isOtherInputFocused) return;

      if (event.key === 'Enter') {
        const raw = scanBufferRef.current;
        scanBufferRef.current = '';
        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        if (!raw.trim()) return;
        void processNfcScanRef.current(raw);
        return;
      }

      if (event.key.length !== 1) return;
      scanBufferRef.current += event.key;
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = setTimeout(() => {
        scanBufferRef.current = '';
      }, 250);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasFetchedData]);

  return (
    <div className="space-y-6">
      <Card className="shadow-md rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl flex items-center">
            <ShieldCheck className="mr-2 h-6 w-6 text-green-600" />
            Kullanım Doğrulama (NFC UID Doğrulama)
          </CardTitle>
          <CardDescription>
            Önce laboratuvarı ve aralığı seçin, sonra veriyi yükleyin. Sonrasında panel yalnızca seçili laboratuvarın yeni tüketimlerini canlı izler ve çöp kutusunda tam UID ile doğrulama yapar.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Doğrulama mantığı</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>1) UID formatı doğrulanır.</p>
              <p>2) Ürün-lot için tanımlı B4:B5:B6:B7:B8 ürün kimliği kontrol edilir.</p>
              <p>3) B1:B2 seri alanı değişken kabul edilir; aynı tam UID ikinci kez kabul edilmez.</p>
              <p>4) UID daha önce disposed olmuşsa tekrar kabul edilmez.</p>
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_auto]">
            <div>
              <label htmlFor="lab-select-nfc" className="block text-sm font-medium mb-1">
                Laboratuvar Seçin
              </label>
              <Select
                value={selectedLaboratoryId}
                onValueChange={(value) => {
                  setSelectedLaboratoryId(value);
                  setHasFetchedData(false);
                  setConsumptionRecords([]);
                  setDisposalEvents([]);
                  setLotDefinitionsByKey({});
                  setSearchTerm('');
                  clearSubscriptions();
                  syncLabUrl(value);
                }}
              >
                <SelectTrigger id="lab-select-nfc" className="w-full rounded-md" disabled={isLabsLoading}>
                  <SelectValue placeholder={isLabsLoading ? 'Laboratuvarlar yükleniyor...' : 'Doğrulama yapılacak laboratuvarı seçin'} />
                </SelectTrigger>
                <SelectContent>
                  {laboratories.map((laboratory) => (
                    <SelectItem key={laboratory.id} value={laboratory.id}>
                      {laboratory.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="day-range-nfc" className="block text-sm font-medium mb-1">
                Veri Aralığı
              </label>
              <Select value={selectedRange} onValueChange={(value: DayRangeOption) => setSelectedRange(value)}>
                <SelectTrigger id="day-range-nfc" className="w-full rounded-md">
                  <SelectValue placeholder="Gün aralığı seçin" />
                </SelectTrigger>
                <SelectContent>
                  {DAY_RANGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button onClick={handleFetchData} className="w-full lg:w-auto" disabled={!selectedLaboratoryId || isDataLoading}>
                {isDataLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                Veri Al
              </Button>
            </div>
          </div>

          {selectedLaboratoryId && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">
                {`URL: /kullanim-dogrulama/${selectedLaboratoryId}`}
              </Badge>
              {hasFetchedData && (
                <>
                  <Badge variant="secondary">
                    <CalendarClock className="mr-1 h-3 w-3" />
                    {loadedRangeLabel}
                  </Badge>
                  {activeSinceDate && (
                    <Badge variant="outline">
                      Başlangıç: {activeSinceDate.toLocaleDateString('tr-TR')}
                    </Badge>
                  )}
                </>
              )}
            </div>
          )}

          {selectedLaboratoryId && (
            <Card className="border-border dark:border-input rounded-lg p-4 mt-4">
              <CardHeader className="px-0 pt-0 pb-3">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
                  <div>
                    <CardTitle className="text-lg">Doğrulanacak Kullanımlar</CardTitle>
                    <CardDescription>
                      Veri yalnızca "Veri Al" sonrası yüklenir. Sonrasında NFC okuyucu ve harici tarayıcı sürekli dinlemede kalır.
                    </CardDescription>
                  </div>
                  <Input
                    type="search"
                    placeholder="Ürün adı, kodu veya lot ile ara..."
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="max-w-sm rounded-md h-9"
                    disabled={!hasFetchedData}
                  />
                </div>
              </CardHeader>

              <CardContent className="px-0 pb-0 space-y-4">
                {hasFetchedData && verificationGroups.length > 0 && (
                  <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Genel Aile Doğrulama İlerlemesi</span>
                      <span className="font-mono">
                        {overallProgress.verified}/{overallProgress.expected} ({overallProgress.total}%)
                      </span>
                    </div>
                    <Progress value={overallProgress.total} className="h-2" />
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    id={NFC_INPUT_ID}
                    placeholder="NFC UID otomatik dinleniyor... manuel giriş için Enter"
                    value={nfcInput}
                    onChange={(event) => setNfcInput(event.target.value.toUpperCase())}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void processNfcScan();
                      }
                    }}
                    className="font-mono"
                    disabled={!hasFetchedData || isDataLoading || verificationGroups.length === 0}
                  />

                  <Button
                    type="button"
                    variant="outline"
                    onClick={startWebNfcScan}
                    disabled={!hasFetchedData || verificationGroups.length === 0 || isWebNfcScanning}
                  >
                    {isWebNfcScanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />}
                    {isWebNfcScanning ? 'Mobil NFC Dinlemede' : 'Dinlemeyi Başlat'}
                  </Button>
                </div>

                {parseNfcUid(nfcInput) && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline" className="font-mono">
                      Seri: {parseNfcUid(nfcInput)?.serialField}
                    </Badge>
                    <Badge variant="secondary" className="font-mono">
                      Ürün Kimliği: {parseNfcUid(nfcInput)?.productIdentityKey}
                    </Badge>
                    <Badge
                      variant={parseNfcUid(nfcInput)?.fixedSuffix === NFC_SUFFIX ? 'secondary' : 'destructive'}
                      className="font-mono"
                    >
                      Son 4 bayt: {parseNfcUid(nfcInput)?.fixedSuffix}
                    </Badge>
                  </div>
                )}

                {!hasFetchedData ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <ScanLine className="h-10 w-10 mb-2" />
                    <p>Önce laboratuvar ve gün aralığını seçip veriyi yükleyin.</p>
                  </div>
                ) : isDataLoading ? (
                  <div className="flex justify-center items-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : verificationGroups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Info className="h-10 w-10 mb-2" />
                    <p>Seçilen aralıkta seri takipli tüketim kaydı bulunamadı.</p>
                  </div>
                ) : filteredGroups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Search className="h-10 w-10 mb-2" />
                    <p>Arama kriterlerine uyan kayıt bulunamadı.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[560px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ürün / Lot</TableHead>
                          <TableHead className="text-center">Tüketilen</TableHead>
                          <TableHead className="text-center">Beklenen Kimlik</TableHead>
                          <TableHead className="text-center">Doğrulanan UID</TableHead>
                          <TableHead className="w-[220px]">İlerleme</TableHead>
                          <TableHead>Durum</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredGroups.map((group) => {
                          const progress = group.tuketilenAdet > 0
                            ? (group.disposedUids.length / group.tuketilenAdet) * 100
                            : 0;
                          const pendingCount = Math.max(group.tuketilenAdet - group.disposedUids.length, 0);
                          const fullyDone = group.tuketilenAdet > 0 && pendingCount === 0;

                          return (
                            <TableRow
                              key={group.id}
                              className={fullyDone ? 'bg-green-500/10 dark:bg-green-500/20' : ''}
                            >
                              <TableCell>
                                <div className="font-medium">{group.stokAdi}</div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  {group.stokKodu} • Lot: {group.lotNumarasi || '-'}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {group.productIdentityKey && (
                                    <Badge variant="outline" className="font-mono text-[10px]">
                                      Kimlik {group.productIdentityKey.split(':')[0]}
                                    </Badge>
                                  )}
                                  {group.tuketilenSeriNolar.slice(0, 3).map((serial) => (
                                    <Badge key={serial} variant="secondary" className="font-mono text-[10px]">
                                      Seri {serial}
                                    </Badge>
                                  ))}
                                  {group.tuketilenSeriNolar.length > 3 && (
                                    <Badge variant="secondary" className="text-[10px]">
                                      +{group.tuketilenSeriNolar.length - 3} seri
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="text-center font-semibold">
                                {group.tuketilenAdet}
                              </TableCell>

                              <TableCell className="text-center">
                                <span className="font-semibold">{group.tuketilenAdet}</span>
                                <div className="mt-2 flex flex-wrap gap-1 justify-center">
                                  {group.productIdentityKey ? (
                                    <Badge variant="outline" className="font-mono text-[10px]">
                                      {`??:??:??:${group.productIdentityKey}`}
                                    </Badge>
                                  ) : (
                                    <Badge variant="destructive" className="text-[10px]">
                                      Kimlik tanımı yok
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="text-center font-semibold text-primary">
                                {group.disposedUids.length}
                                {group.disposedUids.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1 justify-center">
                                    {group.disposedUids.slice(0, 2).map((uid) => (
                                      <Badge key={uid} className="font-mono text-[10px]">
                                        {uid}
                                      </Badge>
                                    ))}
                                    {group.disposedUids.length > 2 && (
                                      <Badge className="text-[10px]">+{group.disposedUids.length - 2} UID</Badge>
                                    )}
                                  </div>
                                )}
                              </TableCell>

                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Progress value={progress} className="h-3 flex-grow" />
                                  <span className="text-xs font-mono w-10 text-right">
                                    {Math.round(progress)}%
                                  </span>
                                  {fullyDone && <CheckSquare className="h-4 w-4 text-green-600" />}
                                </div>
                              </TableCell>

                              <TableCell>
                                {group.eksikAileTanimi ? (
                                  <Alert variant="destructive" className="py-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle className="text-xs">Ürün kimliği tanımı eksik</AlertTitle>
                                    <AlertDescription className="text-xs">
                                      Bu lot için B4:B5:B6:B7:B8 ürün kimliği tanımlı değil. Kullanım doğrulamada bu örüntü beklenir.
                                    </AlertDescription>
                                  </Alert>
                                ) : fullyDone ? (
                                  <Badge className="bg-green-600 hover:bg-green-700">
                                    <Trash2 className="mr-1 h-3 w-3" />
                                    Tamamlandı
                                  </Badge>
                                ) : (
                                  <div className="space-y-1">
                                    <Badge variant="secondary">
                                      Bekleyen: {pendingCount}
                                    </Badge>
                                    <p className="text-xs text-muted-foreground">
                                      Beklenen örüntü: {`??:??:??:${group.productIdentityKey}`}
                                    </p>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
