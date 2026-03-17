'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { Laboratory, ProductCode, ConsumptionRecord } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, Loader2, Info, Search, ShieldCheck, Trash2, Nfc } from 'lucide-react';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { kullanimDogrulamaLogger } from '@/lib/logger';

// NFC tag format regex: xx:xx:xx:xx:xx:xx:xx:xx (each xx is 2 hex chars)
const NFC_TAG_REGEX = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){7}$/;

/** A single NFC verification group for a product consumed with serial tracking */
interface NfcVerificationGroup {
  stokKodu: string;
  stokAdi: string;
  /** Total number of consumptions for this product (serial-tracked) */
  tuketilenAdet: number;
  /** Unique NFC serial tags scanned so far for this product */
  okutulanNfcler: string[];
  /** Whether the empty box NFC has been scanned */
  bosKutuOkutuldu: boolean;
  /** The original consumption record IDs */
  consumptionRecordIds: string[];
  /** The serial numbers from consumption records */
  tuketilenSeriNolar: string[];
}

export default function KullanimDogrulamaPanel() {
  const [selectedLaboratoryId, setSelectedLaboratoryId] = useState<string>('');
  const [nfcInput, setNfcInput] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [tuketimKayitlari, setTuketimKayitlari] = useState<ConsumptionRecord[]>([]);
  const [verificationGroups, setVerificationGroups] = useState<NfcVerificationGroup[]>([]);

  const { toast } = useToast();

  const NFC_INPUT_ID = 'nfc-tag-input';

  // Fetch panel data
  const fetchPanelData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [laboratoriesSnap, productsSnap, consumptionSnap] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'productCodes')),
        getDocs(collection(db, 'tuketimKayitlari')),
      ]);

      setLaboratories(
        laboratoriesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Laboratory))
      );

      const products = productsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ProductCode));
      setProductCodes(products);

      const consumptionItems = consumptionSnap.docs.map((doc) => {
        const data = doc.data();
        Object.keys(data).forEach((key) => {
          if (data[key] instanceof Timestamp) {
            data[key] = data[key].toDate();
          }
        });
        return { id: doc.id, ...data } as ConsumptionRecord;
      });
      setTuketimKayitlari(consumptionItems);

      kullanimDogrulamaLogger.info('Panel verileri yüklendi', {
        laboratories: laboratoriesSnap.docs.length,
        products: productsSnap.docs.length,
        consumptions: consumptionSnap.docs.length,
      });
    } catch (error) {
      kullanimDogrulamaLogger.error('Panel verileri yüklenemedi', error);
      toast({
        title: 'Veri Hatası',
        description: 'Doğrulama paneli için veriler yüklenemedi.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPanelData();
  }, [fetchPanelData]);

  // Build verification groups when lab changes
  useEffect(() => {
    if (!selectedLaboratoryId) {
      setVerificationGroups([]);
      return;
    }

    const laboratory = laboratories.find((h) => h.id === selectedLaboratoryId);
    if (!laboratory) return;

    // Find serial-tracked product codes
    const serialTrackedCodes = new Set(
      productCodes
        .filter((p) => p.trackingMode === 'serial')
        .map((p) => p.stokKodu)
    );

    // Filter consumptions: this lab, normal usage, serial-tracked products
    const relevantConsumptions = tuketimKayitlari.filter(
      (record) =>
        record.laboratoryName === laboratory.name &&
        record.consumptionType === 'normal_kullanim' &&
        serialTrackedCodes.has(record.stokKodu)
    );

    // Group by product (stokKodu)
    const grouped: Record<string, NfcVerificationGroup> = {};

    relevantConsumptions.forEach((record) => {
      const key = record.stokKodu;
      if (!grouped[key]) {
        grouped[key] = {
          stokKodu: record.stokKodu,
          stokAdi: record.stokAdi,
          tuketilenAdet: 0,
          okutulanNfcler: [],
          bosKutuOkutuldu: false,
          consumptionRecordIds: [],
          tuketilenSeriNolar: [],
        };
      }
      grouped[key].tuketilenAdet += 1;
      if (!grouped[key].consumptionRecordIds.includes(record.id)) {
        grouped[key].consumptionRecordIds.push(record.id);
      }
      if (record.seriNumarasi && !grouped[key].tuketilenSeriNolar.includes(record.seriNumarasi)) {
        grouped[key].tuketilenSeriNolar.push(record.seriNumarasi);
      }
    });

    setVerificationGroups(
      Object.values(grouped).sort((a, b) => a.stokAdi.localeCompare(b.stokAdi))
    );
    setNfcInput('');
  }, [selectedLaboratoryId, tuketimKayitlari, laboratories, productCodes]);

  // Filtered groups for search
  const filteredGroups = useMemo(() => {
    if (!searchTerm) return verificationGroups;
    const term = searchTerm.toLowerCase();
    return verificationGroups.filter(
      (g) =>
        g.stokAdi.toLowerCase().includes(term) || g.stokKodu.toLowerCase().includes(term)
    );
  }, [verificationGroups, searchTerm]);

  // Handle NFC scan
  const handleNfcScan = useCallback(() => {
    const tag = nfcInput.trim().toLowerCase();

    if (!selectedLaboratoryId) {
      toast({ title: 'Uyarı', description: 'Lütfen önce bir laboratuvar seçin.' });
      setNfcInput('');
      return;
    }

    if (!tag) {
      toast({ title: 'Uyarı', description: 'Lütfen NFC etiketini okutun.' });
      return;
    }

    if (!NFC_TAG_REGEX.test(tag)) {
      kullanimDogrulamaLogger.warn('Geçersiz NFC formatı', { tag });
      toast({
        title: 'Hata',
        description: `Geçersiz NFC formatı. Beklenen: xx:xx:xx:xx:xx:xx:xx:xx — Girilen: ${tag}`,
        variant: 'destructive',
      });
      setNfcInput('');
      return;
    }

    // Check if this NFC tag was already scanned in any group
    const alreadyScanned = verificationGroups.some((g) => g.okutulanNfcler.includes(tag));
    if (alreadyScanned) {
      kullanimDogrulamaLogger.warn('Zaten okutulmuş NFC etiketi', { tag });
      toast({
        title: 'Tekrar Okutma',
        description: `Bu NFC etiketi (${tag}) zaten okutulmuş.`,
        variant: 'destructive',
      });
      setNfcInput('');
      document.getElementById(NFC_INPUT_ID)?.focus();
      return;
    }

    // Try to match to a group that still needs NFC scans
    let matched = false;

    setVerificationGroups((prev) =>
      prev.map((group) => {
        if (!matched && group.okutulanNfcler.length < group.tuketilenAdet) {
          matched = true;
          const updated = {
            ...group,
            okutulanNfcler: [...group.okutulanNfcler, tag],
          };
          kullanimDogrulamaLogger.info('NFC doğrulandı', {
            stokKodu: group.stokKodu,
            tag,
            count: updated.okutulanNfcler.length,
            total: group.tuketilenAdet,
          });
          toast({
            title: 'NFC Okutuldu',
            description: `${group.stokAdi} — ${updated.okutulanNfcler.length}/${group.tuketilenAdet} seri doğrulandı.`,
          });
          return updated;
        }
        return group;
      })
    );

    if (!matched) {
      toast({
        title: 'Eşleşme Yok',
        description: 'Doğrulanmayı bekleyen ürün bulunamadı veya tüm ürünler zaten doğrulanmış.',
      });
    }

    setNfcInput('');
    document.getElementById(NFC_INPUT_ID)?.focus();
  }, [nfcInput, selectedLaboratoryId, verificationGroups, toast]);

  // Handle empty box NFC scan
  const handleEmptyBoxScan = useCallback(
    (stokKodu: string) => {
      setVerificationGroups((prev) =>
        prev.map((group) => {
          if (group.stokKodu === stokKodu) {
            if (group.okutulanNfcler.length < group.tuketilenAdet) {
              toast({
                title: 'Uyarı',
                description: `Önce tüm seri numaralarını okutmanız gerekiyor. (${group.okutulanNfcler.length}/${group.tuketilenAdet})`,
                variant: 'destructive',
              });
              return group;
            }
            kullanimDogrulamaLogger.info('Boş kutu okutuldu', { stokKodu });
            toast({
              title: 'Boş Kutu Doğrulandı',
              description: `${group.stokAdi} — boş kutu çöpe atıldı olarak işaretlendi.`,
            });
            return { ...group, bosKutuOkutuldu: true };
          }
          return group;
        })
      );
    },
    [toast]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNfcScan();
    }
  };

  // Overall progress
  const overallProgress = useMemo(() => {
    if (verificationGroups.length === 0) return { nfc: 0, box: 0, total: 0 };
    const totalNfc = verificationGroups.reduce((s, g) => s + g.tuketilenAdet, 0);
    const scannedNfc = verificationGroups.reduce((s, g) => s + g.okutulanNfcler.length, 0);
    const totalBoxes = verificationGroups.length;
    const scannedBoxes = verificationGroups.filter((g) => g.bosKutuOkutuldu).length;
    const totalSteps = totalNfc + totalBoxes;
    const doneSteps = scannedNfc + scannedBoxes;
    return {
      nfc: totalNfc > 0 ? Math.round((scannedNfc / totalNfc) * 100) : 0,
      box: totalBoxes > 0 ? Math.round((scannedBoxes / totalBoxes) * 100) : 0,
      total: totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0,
    };
  }, [verificationGroups]);

  return (
    <div className="space-y-6">
      <Card className="shadow-md rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl flex items-center">
            <ShieldCheck className="mr-2 h-6 w-6 text-green-600" />
            Kullanım Doğrulama (NFC Seri No Doğrulama)
          </CardTitle>
          <CardDescription>
            Seri numarası takipli ürünlerin tüketim doğrulaması. Her tüketilen ürün için eşsiz NFC
            seri etiketi okutun, ardından boş kutuyu okutarak çöpe atın.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Laboratory selection */}
          <div>
            <label htmlFor="lab-select-nfc" className="block text-sm font-medium mb-1">
              Laboratuvar Seçin
            </label>
            <Select
              value={selectedLaboratoryId}
              onValueChange={(value) => {
                setSelectedLaboratoryId(value);
                setSearchTerm('');
              }}
            >
              <SelectTrigger id="lab-select-nfc" className="w-full md:w-1/2 lg:w-1/3 rounded-md">
                <SelectValue placeholder="Doğrulama yapılacak laboratuvarı seçin" />
              </SelectTrigger>
              <SelectContent>
                {laboratories.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedLaboratoryId && (
            <Card className="border-border dark:border-input rounded-lg p-4 mt-4">
              <CardHeader className="px-0 pt-0 pb-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <CardTitle className="text-lg">Doğrulanacak Kullanımlar</CardTitle>
                  <Input
                    type="search"
                    placeholder="Ürün adı veya kodu ile ara..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="max-w-xs rounded-md h-9"
                  />
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {/* Overall progress */}
                {verificationGroups.length > 0 && (
                  <div className="mb-4 p-3 bg-muted/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Genel İlerleme</span>
                      <span className="font-mono">{overallProgress.total}%</span>
                    </div>
                    <Progress value={overallProgress.total} className="h-2" />
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>NFC Seri: {overallProgress.nfc}%</span>
                      <span>Boş Kutu: {overallProgress.box}%</span>
                    </div>
                  </div>
                )}

                {/* NFC input */}
                <div className="flex items-center space-x-2 mb-4">
                  <Input
                    id={NFC_INPUT_ID}
                    placeholder="NFC Etiketi (xx:xx:xx:xx:xx:xx:xx:xx)"
                    value={nfcInput}
                    onChange={(e) => setNfcInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-grow rounded-md h-10 font-mono"
                    disabled={!selectedLaboratoryId || verificationGroups.length === 0}
                  />
                  <Button
                    onClick={handleNfcScan}
                    className="rounded-md h-10"
                    disabled={!nfcInput.trim()}
                  >
                    <Nfc className="mr-2 h-5 w-5" />
                    Okut
                  </Button>
                </div>

                {isLoading ? (
                  <div className="flex justify-center items-center py-6">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : verificationGroups.length === 0 && !searchTerm ? (
                  <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                    <Info className="h-10 w-10 mb-2" />
                    <p>
                      Bu laboratuvarda seri numarası takipli tüketilmiş ürün bulunamadı.
                    </p>
                  </div>
                ) : filteredGroups.length === 0 && searchTerm ? (
                  <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                    <Search className="h-10 w-10 mb-2" />
                    <p>Arama kriterlerine uyan ürün bulunamadı.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ürün Adı (Kodu)</TableHead>
                          <TableHead className="text-center">Tüketilen</TableHead>
                          <TableHead className="text-center">NFC Okutulan</TableHead>
                          <TableHead className="w-[180px]">İlerleme</TableHead>
                          <TableHead className="text-center">Boş Kutu</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredGroups.map((group) => {
                          const nfcProgress =
                            group.tuketilenAdet > 0
                              ? (group.okutulanNfcler.length / group.tuketilenAdet) * 100
                              : 0;
                          const allNfcDone =
                            group.okutulanNfcler.length === group.tuketilenAdet &&
                            group.tuketilenAdet > 0;
                          const fullyDone = allNfcDone && group.bosKutuOkutuldu;

                          return (
                            <TableRow
                              key={group.stokKodu}
                              className={
                                fullyDone
                                  ? 'bg-green-500/10 dark:bg-green-500/20 opacity-70'
                                  : ''
                              }
                            >
                              <TableCell>
                                {group.stokAdi}
                                <span className="block text-xs text-muted-foreground font-mono">
                                  ({group.stokKodu})
                                </span>
                                {/* Show scanned NFC tags */}
                                {group.okutulanNfcler.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {group.okutulanNfcler.map((tag) => (
                                      <Badge
                                        key={tag}
                                        variant="secondary"
                                        className="font-mono text-[10px]"
                                      >
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-center font-medium">
                                {group.tuketilenAdet}
                              </TableCell>
                              <TableCell className="text-center font-semibold text-primary">
                                {group.okutulanNfcler.length}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-2">
                                  <Progress
                                    value={nfcProgress}
                                    className="h-3 flex-grow rounded-md"
                                  />
                                  <span className="text-xs font-mono w-10 text-right">
                                    {Math.round(nfcProgress)}%
                                  </span>
                                  {allNfcDone && (
                                    <CheckSquare className="h-4 w-4 text-green-600" />
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-center">
                                {group.bosKutuOkutuldu ? (
                                  <Badge
                                    variant="default"
                                    className="bg-green-600 hover:bg-green-700"
                                  >
                                    <Trash2 className="mr-1 h-3 w-3" />
                                    Atıldı
                                  </Badge>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleEmptyBoxScan(group.stokKodu)}
                                    disabled={!allNfcDone}
                                    className="text-xs"
                                  >
                                    <Trash2 className="mr-1 h-3 w-3" />
                                    Boş Kutu Okut
                                  </Button>
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
