
'use client';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ListChecks, Check, X, Save, XCircle, Search, ListFilter, Nfc, Smartphone, ScanLine } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { DepoStokItem, ConsumptionRecord } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';
import { formatMiad } from "@/lib/date";
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { cn, playFeedback } from '@/lib/utils';
import { parseBarcode as parseRocheBarcode } from '@/lib/utils';
import { scopedQuery } from '@/lib/firestore-helpers';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface StockGroup {
  id: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  expectedQty: number;
  serials: string[];
}

interface LotNfcDefinition {
  stokKodu: string;
  stokAdi?: string;
  lotNumarasi: string;
  sampleUid: string;
  patternKey: string;
  productIdentityKey?: string;
  b3: string;
  b4: string;
  fixedSuffix: string;
  serialField: string;
  updatedAt?: unknown;
  updatedByUid?: string;
  updatedByName?: string;
  createdAt?: unknown;
  createdByUid?: string;
  createdByName?: string;
}


// Helper: normalize any serial for strict comparison
const normalizeSerial = (s: string | null | undefined): string =>
  (s ?? '').trim().toUpperCase();

// Fallback parser: accept raw serial string when full Roche barcode isn't provided
function parseSerialFlexible(raw: string): { seriNumarasi: string } | null {
  // Try Roche first
  const parsed = parseRocheBarcode(raw);
  if (parsed && parsed.seriNumarasi) {
    return { seriNumarasi: normalizeSerial(parsed.seriNumarasi) };
  }
  // Fallback: raw scanner sent only the serial (commonly 10–20 alnum)
  const candidate = normalizeSerial(raw);
  if (/^[A-Z0-9]{10,20}$/.test(candidate)) {
    return { seriNumarasi: candidate };
  }
  return null;
}

const NFC_SUFFIX = '53:01:04:E0';

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
    bytes,
    serialField: `${bytes[0]}:${bytes[1]}`,
    patternKey: `${bytes[2]}:${bytes[3]}`,
    productIdentityKey: `${bytes[3]}:${bytes.slice(4).join(':')}`,
    b3: bytes[2],
    b4: bytes[3],
    fixedSuffix: bytes.slice(4).join(':'),
  };
};

const buildLotNfcDefinitionId = (stokKodu: string, lotNumarasi: string) =>
  `${encodeURIComponent(stokKodu)}__${encodeURIComponent(lotNumarasi)}`;

export default function StockDetailPage() {
  const params = useParams();
  const depotId = Array.isArray(params?.depotId) ? params.depotId[0] : params?.depotId;
  const stockCode = Array.isArray(params?.stockCode) ? params.stockCode[0] : params?.stockCode;
  const lotNumber = Array.isArray(params?.lotNumber) ? params.lotNumber[0] : params?.lotNumber;
  const { toast } = useToast();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const [items, setItems] = useState<DepoStokItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [isCounting, setIsCounting] = useState(false);
  const [scannedSerials, setScannedSerials] = useState<Record<string, Set<string>>>({});
  const [showOnlyUnverified, setShowOnlyUnverified] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isNfcDialogOpen, setIsNfcDialogOpen] = useState(false);
  const [nfcUidInput, setNfcUidInput] = useState('');
  const [isScanningNfc, setIsScanningNfc] = useState(false);
  const [isSavingNfc, setIsSavingNfc] = useState(false);
  const [lotNfcDefinition, setLotNfcDefinition] = useState<LotNfcDefinition | null>(null);

  const loadLotNfcDefinition = useCallback(async () => {
    if (!stockCode || !lotNumber) {
      setLotNfcDefinition(null);
      return;
    }

    try {
      const definitionId = buildLotNfcDefinitionId(
        decodeURIComponent(stockCode as string),
        decodeURIComponent(lotNumber as string)
      );
      const definitionSnap = await getDoc(doc(db, 'lotNfcDefinitions', definitionId));
      if (definitionSnap.exists()) {
        setLotNfcDefinition(definitionSnap.data() as LotNfcDefinition);
      } else {
        setLotNfcDefinition(null);
      }
    } catch (error) {
      console.error('Error loading NFC definition:', error);
      toast({
        title: 'NFC tanımı yüklenemedi',
        description: 'Lot için kayıtlı etiket örüntüsü okunurken bir hata oluştu.',
        variant: 'destructive',
      });
    }
  }, [lotNumber, stockCode, toast]);

  const fetchItems = useCallback(async () => {
    if (!depotId || !stockCode || !lotNumber) {
        setLoading(false);
        return;
    }
    setLoading(true);
    try {
      const q = query(
        scopedQuery('depoStok', currentCompanyId, isSuperAdmin),
        where('depotId', '==', depotId),
        where('stokKodu', '==', decodeURIComponent(stockCode as string)),
        where('lotNumarasi', '==', decodeURIComponent(lotNumber as string)),
        where('isShipped', '==', false)
      );
      const snap = await getDocs(q);
      const fetchedItems = filterByCompanyScope(
        snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DepoStokItem)),
        currentCompanyId,
        isSuperAdmin,
      );
      setItems(fetchedItems);
    } catch (err) {
      console.error("Error fetching stock details:", err);
      toast({ title: 'Hata', description: 'Stok detayları yüklenemedi.', variant: 'destructive'});
    } finally {
      setLoading(false);
    }
  }, [depotId, stockCode, lotNumber, toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    loadLotNfcDefinition();
  }, [loadLotNfcDefinition]);

  const stockList: StockGroup[] = useMemo(() => {
    const groups: Record<string, StockGroup> = {};
    items.forEach(item => {
      const key = `${item.stokKodu}-${item.lotNumarasi}-${formatMiad(item.miad)}`;
      if (!groups[key]) {
        groups[key] = {
          id: key,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          lotNumarasi: item.lotNumarasi || '',
          miad: formatMiad(item.miad),
          expectedQty: 0,
          serials: [],
        };
      }
      groups[key].expectedQty++;
      if (item.seriNumarasi) groups[key].serials.push(normalizeSerial(item.seriNumarasi));
    });
    return Object.values(groups);
  }, [items]);

  const handleBarcodeScan = useCallback((barcode: string) => {
    if (!isCounting) return;

    const parsed = parseSerialFlexible(barcode);
    if (!parsed) {
        playFeedback(true);
        toast({ title: 'Hata', description: 'Geçersiz barkod/seri formatı.', variant: 'destructive' });
        return;
    }
    const serial = parsed.seriNumarasi;

    let itemFoundInAnyLot = false;

    for (const group of stockList) {
        if (group.serials.some(s => normalizeSerial(s) === serial)) {
            itemFoundInAnyLot = true;
            setScannedSerials(prev => {
                const lotId = group.id;
                const setForLot = new Set(prev[lotId] || []);
                if (!setForLot.has(serial)) {
                    setForLot.add(serial);
                    playFeedback();
                    toast({ title: 'Okundu', description: `${serial} doğrulandı.` });
                    return { ...prev, [lotId]: setForLot };
                } else {
                    playFeedback(true);
                    toast({ title: 'Uyarı', description: 'Bu seri zaten doğrulandı.' });
                    return prev;
                }
            });
            break;
        }
    }

    if (!itemFoundInAnyLot) {
        playFeedback(true);
        toast({ title: 'Bulunamadı', description: 'Okutulan seri no bu lot listesinde yok.', variant: 'destructive' });
    }
  }, [isCounting, stockList, toast]);

  const scanBuffer = useRef('');
  const scanTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isCounting) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      if (e.key === 'Enter') {
        const len = scanBuffer.current.length;
        const isRoche = len === 61;
        const isRawSerial = len >= 10 && len <= 20;
        if (isRoche || isRawSerial) {
          handleBarcodeScan(scanBuffer.current);
        }
        scanBuffer.current = '';
        if (scanTimeout.current) clearTimeout(scanTimeout.current);
        return;
      }

      if (e.key.length > 1) return;
      scanBuffer.current += e.key;
      if (scanTimeout.current) clearTimeout(scanTimeout.current);
      scanTimeout.current = setTimeout(() => { scanBuffer.current = ''; }, 250);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCounting, handleBarcodeScan]);

  const startCounting = () => {
    setIsCounting(true);
    setScannedSerials({});
    setShowOnlyUnverified(false);
    toast({ title: 'Sayım Başladı', description: 'Lütfen ürün seri numaralarını okutun.' });
  };

  const cancelCounting = () => {
      setIsCounting(false);
      setScannedSerials({});
      setShowOnlyUnverified(false);
  };

  const saveCount = async () => {
    if (!currentUserProfile) return;

    const allSerialsInList = new Set(stockList.flatMap(g => g.serials));
    const allScannedSerials = new Set(Object.values(scannedSerials).flatMap(s => Array.from(s)));

    const unscannedSerials = Array.from(allSerialsInList).filter(s => !allScannedSerials.has(s));

    if (unscannedSerials.length === 0) {
      toast({ title: 'İşlem Yok', description: 'Stoktan düşülecek ürün bulunmuyor. Tüm ürünler okutuldu.' });
      setIsCounting(false);
      return;
    }

    if (!confirm(`${unscannedSerials.length} adet ürün stoktan düşülecek. Devam etmek istiyor musunuz?`)) return;

    setIsSaving(true);
    const batch = writeBatch(db);
    const depotName = items[0]?.depotName || depotId;

    const itemsToDeduct = items.filter(item => unscannedSerials.includes(normalizeSerial(item.seriNumarasi)));

    itemsToDeduct.forEach(item => {
        const consumptionRecord: Omit<ConsumptionRecord, 'id'> = {
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            lotNumarasi: item.lotNumarasi ?? '',
            miad: formatMiad(item.miad),
            seriNumarasi: item.seriNumarasi ?? '',
            consumptionTimestamp: new Date(),
            consumptionType: 'sayimdan_dusum',
            userId: currentUserProfile.uid,
            userName: currentUserProfile.name || 'Bilinmeyen Kullanıcı',
            laboratoryName: depotName,
            laboratoryId: depotId,
        };
        batch.delete(doc(db, 'depoStok', item.id));
        batch.set(doc(collection(db, 'tuketimKayitlari')), consumptionRecord);
    });

    try {
        await batch.commit();

        toast({ title: 'Başarılı', description: `${unscannedSerials.length} adet ürün stoktan düşüldü ve tüketim olarak kaydedildi.` });
        await fetchItems();
        setIsCounting(false);
    } catch(err) {
        console.error("Error saving count:", err);
        toast({ title: 'Hata', description: 'Sayım kaydedilirken bir hata oluştu.', variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
  };

  const filteredGroups = useMemo(() => {
    let list = stockList;
    if (isCounting && showOnlyUnverified) {
      list = list.filter(group => {
        const scannedCount = (scannedSerials[group.id] || new Set()).size;
        return scannedCount < group.expectedQty;
      });
    }
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      list = list.filter(group =>
        group.stokAdi.toLowerCase().includes(lowerSearch) ||
        group.lotNumarasi.toLowerCase().includes(lowerSearch) ||
        group.serials.some(s => s.toLowerCase().includes(lowerSearch))
      );
    }
    return list;
  }, [stockList, isCounting, showOnlyUnverified, searchTerm, scannedSerials]);

  const parsedNfcUid = useMemo(() => parseNfcUid(nfcUidInput), [nfcUidInput]);

  const { totalItems, verifiedItems, progress } = useMemo(() => {
    const total = stockList.reduce((sum, g) => sum + g.expectedQty, 0);
    const verified = Object.values(scannedSerials).reduce((sum, set) => sum + set.size, 0);
    const progressPercentage = total > 0 ? (verified / total) * 100 : 0;
    return {
      totalItems: total,
      verifiedItems: verified,
      progress: progressPercentage
    };
  }, [stockList, scannedSerials]);

  const firstItem = items[0];

  const handleDetectedNfcUid = useCallback((rawUid: string) => {
    const normalized = normalizeNfcUid(rawUid);
    if (!normalized) {
      playFeedback(true);
      toast({
        title: 'Geçersiz NFC etiketi',
        description: 'UID 8 bayt ve xx:xx:xx:xx:xx:xx:xx:xx formatında olmalıdır.',
        variant: 'destructive',
      });
      return;
    }

    setNfcUidInput(normalized);
    setIsScanningNfc(false);
    playFeedback();
    toast({
      title: 'NFC etiketi okundu',
      description: `${normalized} örüntüsü tanımlama için hazır.`,
    });
  }, [toast]);

  const startNfcScan = useCallback(async () => {
    if (typeof window === 'undefined' || !('NDEFReader' in window)) {
      toast({
        title: 'Web NFC kullanılamıyor',
        description: 'Bu özellik Android Chrome ve HTTPS ortamında çalışır. Harici okuyucu için UID alanını kullanabilirsiniz.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // @ts-ignore Web NFC API
      const ndef = new NDEFReader();
      await ndef.scan();
      setIsScanningNfc(true);
      toast({
        title: 'NFC okuyucu hazır',
        description: 'Lütfen boş kit kutusundaki etiketi cihaza yaklaştırın.',
      });
      ndef.onreading = (event: { serialNumber?: string }) => {
        if (event.serialNumber) {
          handleDetectedNfcUid(event.serialNumber);
        }
      };
    } catch (error) {
      console.error('Error starting NFC scan:', error);
      setIsScanningNfc(false);
      toast({
        title: 'NFC tarama başlatılamadı',
        description: 'Tarama başlatılırken bir hata oluştu. Gerekirse UID alanına manuel giriş yapın.',
        variant: 'destructive',
      });
    }
  }, [handleDetectedNfcUid, toast]);

  const saveLotNfcDefinition = useCallback(async () => {
    if (!stockCode || !lotNumber || !parsedNfcUid || !currentUserProfile) return;

    const decodedStockCode = decodeURIComponent(stockCode as string);
    const decodedLotNumber = decodeURIComponent(lotNumber as string);
    const definitionId = buildLotNfcDefinitionId(decodedStockCode, decodedLotNumber);

    setIsSavingNfc(true);
    try {
      const payload: LotNfcDefinition & Record<string, unknown> = {
        stokKodu: decodedStockCode,
        stokAdi: firstItem?.stokAdi || '',
        lotNumarasi: decodedLotNumber,
        sampleUid: parsedNfcUid.normalized,
        patternKey: parsedNfcUid.patternKey,
        productIdentityKey: parsedNfcUid.productIdentityKey,
        b3: parsedNfcUid.b3,
        b4: parsedNfcUid.b4,
        fixedSuffix: parsedNfcUid.fixedSuffix,
        serialField: parsedNfcUid.serialField,
        updatedAt: serverTimestamp(),
        updatedByUid: currentUserProfile.uid,
        updatedByName: currentUserProfile.name || 'Bilinmeyen Kullanıcı',
      };

      if (!lotNfcDefinition) {
        payload.createdAt = serverTimestamp();
        payload.createdByUid = currentUserProfile.uid;
        payload.createdByName = currentUserProfile.name || 'Bilinmeyen Kullanıcı';
      }

      await setDoc(doc(db, 'lotNfcDefinitions', definitionId), payload, { merge: true });
      setLotNfcDefinition({
        stokKodu: decodedStockCode,
        stokAdi: firstItem?.stokAdi || '',
        lotNumarasi: decodedLotNumber,
        sampleUid: parsedNfcUid.normalized,
        patternKey: parsedNfcUid.patternKey,
        productIdentityKey: parsedNfcUid.productIdentityKey,
        b3: parsedNfcUid.b3,
        b4: parsedNfcUid.b4,
        fixedSuffix: parsedNfcUid.fixedSuffix,
        serialField: parsedNfcUid.serialField,
        updatedByUid: currentUserProfile.uid,
        updatedByName: currentUserProfile.name || 'Bilinmeyen Kullanıcı',
      });
      setIsNfcDialogOpen(false);
      setNfcUidInput('');
      setIsScanningNfc(false);
      toast({
        title: 'Etiket örüntüsü kaydedildi',
        description: `${decodedStockCode} / ${decodedLotNumber} için ${parsedNfcUid.productIdentityKey} ürün kimliği kaydedildi.`,
      });
    } catch (error) {
      console.error('Error saving NFC definition:', error);
      toast({
        title: 'Kayıt başarısız',
        description: 'Lot NFC tanımı kaydedilirken bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingNfc(false);
    }
  }, [currentUserProfile, firstItem?.stokAdi, lotNfcDefinition, lotNumber, parsedNfcUid, stockCode, toast]);

  if (loading && items.length === 0) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary"/></div>;
  }

  if (!depotId || !stockCode || !lotNumber) {
    return (
        <div className="flex h-full items-center justify-center text-destructive">
            Gerekli rota parametreleri eksik. Lütfen geri dönün.
        </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/stok-yonetimi" />
      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-start">
            <div>
                <CardTitle className="truncate max-w-full">{firstItem?.stokAdi || 'Yükleniyor...'}</CardTitle>
                <CardDescription>
                    Stok Kodu: {decodeURIComponent(stockCode as string)} | Lot Numarası: {decodeURIComponent(lotNumber as string)}
                </CardDescription>
                {lotNfcDefinition && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono">
                      NFC Kimliği: {lotNfcDefinition.productIdentityKey || `${lotNfcDefinition.b4}:${lotNfcDefinition.fixedSuffix}`}
                    </Badge>
                    <Badge variant="outline" className="font-mono">
                      Örnek UID: {lotNfcDefinition.sampleUid}
                    </Badge>
                  </div>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
              <Button
                variant="outline"
                onClick={() => {
                  setNfcUidInput(lotNfcDefinition?.sampleUid || '');
                  setIsNfcDialogOpen(true);
                }}
                disabled={loading || items.length === 0}
              >
                <Nfc className="mr-2 h-4 w-4" />
                {lotNfcDefinition ? 'Etiket Tanımını Güncelle' : 'Etiket Tanımla'}
              </Button>
              {!isCounting ? (
                  <Button onClick={startCounting} disabled={loading || items.length === 0}>
                      <ListChecks className="mr-2 h-4 w-4" /> Lot Sayımı Başlat
                  </Button>
              ) : (
                  <div className="flex gap-2">
                      <Button onClick={saveCount} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4" />}
                        Sayımı Tamamla ve Kaydet
                      </Button>
                      <Button onClick={cancelCounting} variant="outline" disabled={isSaving}>İptal</Button>
                  </div>
              )}
            </div>
        </CardHeader>

        {isCounting && (
          <CardContent className="border-t pt-4">
            <div className="flex justify-between items-center mb-2">
              <div className="relative">
                 <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                 <Input
                    placeholder="Seri no ara..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                 />
              </div>
              <Button onClick={() => setShowOnlyUnverified(v => !v)} variant="outline">
                <ListFilter className="mr-2 h-4 w-4"/>
                {showOnlyUnverified ? 'Tümünü Göster' : 'Doğrulanmayanları Göster'}
              </Button>
            </div>
            <div className="pt-2 space-y-2">
              <Progress value={progress} className="h-3" indicatorClassName={progress === 100 ? 'bg-green-500' : 'bg-primary'} />
              <div className="flex justify-between text-sm font-medium">
                  <span className="text-muted-foreground">Toplam Ürün: {totalItems}</span>
                  <span className="text-primary">Doğrulanan: {verifiedItems}</span>
              </div>
            </div>
          </CardContent>
        )}

        <CardContent>
          {items.length === 0 && !loading ? (
            <p className="text-center text-muted-foreground py-8">Bu lot için stok bulunamadı.</p>
          ) : !isCounting ? (
             <ScrollArea className="h-[70vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seri Numarası</TableHead>
                    <TableHead>Raf Adresi</TableHead>
                    <TableHead>Miad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.seriNumarasi}</TableCell>
                      <TableCell>{item.rafAdresi}</TableCell>
                      <TableCell>{formatMiad(item.miad)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
             <Accordion type="multiple" defaultValue={filteredGroups.map(g => g.id)} className="w-full">
              {filteredGroups.map(group => {
                const scannedInGroup = scannedSerials[group.id] || new Set();
                const isComplete = scannedInGroup.size === group.expectedQty;
                return (
                  <AccordionItem key={group.id} value={group.id}>
                    <AccordionTrigger>
                      <div className="flex w-full justify-between items-center pr-4">
                        <span>{group.stokAdi} - Lot: {group.lotNumarasi} - Miad: {group.miad}</span>
                        <Badge variant={isComplete ? "default" : "secondary"}>
                          {scannedInGroup.size} / {group.expectedQty}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ScrollArea className="h-64">
                        <ul className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
                          {group.serials.map(s => {
                            const isScanned = scannedInGroup.has(s);
                            const matchesSearch = searchTerm && s.toLowerCase().includes(searchTerm.toLowerCase());
                            return (
                              <li key={s}
                                className={cn(
                                  'p-1 rounded flex items-center gap-2 text-xs font-mono',
                                  isScanned ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30',
                                  matchesSearch && 'ring-2 ring-primary'
                                )}
                              >
                                {isScanned ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-red-600" />}
                                <span>{s || '(no-serial)'}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </ScrollArea>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
             </Accordion>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={isNfcDialogOpen}
        onOpenChange={(open) => {
          setIsNfcDialogOpen(open);
          if (!open) {
            setIsScanningNfc(false);
            setNfcUidInput(lotNfcDefinition?.sampleUid || '');
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Nfc className="h-5 w-5" />
              Lot için NFC etiket örüntüsü tanımla
            </DialogTitle>
            <DialogDescription>
              Bu ekranda ürün + lot eşleşmesi için B4:B5:B6:B7:B8 ürün kimliğini kaydediyoruz. B1:B2 seri alanı değişken kalır.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert>
              <ScanLine className="h-4 w-4" />
              <AlertTitle>Kaydedilecek alanlar</AlertTitle>
              <AlertDescription className="space-y-1">
                <p><span className="font-medium">B1:B2</span> seri alanı olarak değişken kabul edilir.</p>
                <p><span className="font-medium">B4:B5:B6:B7:B8</span> ürün + lot kimliği olarak kaydedilir.</p>
                <p><span className="font-medium">B3</span> ayırt etmede kullanılmaz; <span className="font-medium">B5:B6:B7:B8</span> sabit örüntüdür.</p>
              </AlertDescription>
            </Alert>

            <div className="grid gap-3 md:grid-cols-[auto_1fr]">
              <Button type="button" variant="outline" onClick={startNfcScan} disabled={isScanningNfc}>
                {isScanningNfc ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Smartphone className="mr-2 h-4 w-4" />
                )}
                Telefonda NFC Tara
              </Button>
              <Input
                value={nfcUidInput}
                onChange={(event) => setNfcUidInput(event.target.value)}
                placeholder="AA:E1:C4:20:53:01:04:E0"
                className="font-mono"
              />
            </div>

            {parsedNfcUid ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Çözümlenen UID</CardTitle>
                    <CardDescription className="font-mono">{parsedNfcUid.normalized}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <span>Seri alanı (B1:B2)</span>
                      <Badge variant="outline" className="font-mono">{parsedNfcUid.serialField}</Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <span>Ürün kimliği (B4:B5:B6:B7:B8)</span>
                      <Badge className="font-mono">{parsedNfcUid.productIdentityKey}</Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <span>Sabit son 4 bayt</span>
                      <Badge variant={parsedNfcUid.fixedSuffix === NFC_SUFFIX ? 'secondary' : 'destructive'} className="font-mono">
                        {parsedNfcUid.fixedSuffix}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Bu lota yazılacak tanım</CardTitle>
                    <CardDescription>
                      {decodeURIComponent(stockCode as string)} / {decodeURIComponent(lotNumber as string)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">Tanımlama kuralı</p>
                      <p className="font-mono font-medium">??:??:??:{parsedNfcUid.productIdentityKey}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-muted-foreground">Tüketimde beklenen davranış</p>
                      <p>Tam UID ile eşsiz kutu doğrulaması yapılacak; bu desen ise ön sınıflandırma ve lot eşleşmesi için kullanılacak.</p>
                    </div>
                    {parsedNfcUid.fixedSuffix !== NFC_SUFFIX && (
                      <Alert variant="destructive">
                        <XCircle className="h-4 w-4" />
                        <AlertTitle>Beklenmeyen son 4 bayt</AlertTitle>
                        <AlertDescription>
                          Okunan etiketin son 4 baytı beklenen sabit değerle uyuşmuyor. Yine de kaydetmek isterseniz önce fiziksel etiketi doğrulayın.
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Etiketi mobil NFC ile okutun veya UID değerini manuel olarak girin. Geçerli format: <span className="font-mono">xx:xx:xx:xx:xx:xx:xx:xx</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsNfcDialogOpen(false)} disabled={isSavingNfc}>
              Vazgeç
            </Button>
            <Button type="button" onClick={saveLotNfcDefinition} disabled={!parsedNfcUid || isSavingNfc}>
              {isSavingNfc ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Etiket Örüntüsünü Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
