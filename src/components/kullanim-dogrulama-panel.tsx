/**
 * @fileoverview Usage Verification Panel Component
 * @description Enterprise-grade panel for verifying product consumption through
 * disposal barcode scanning. Ensures proper kit disposal verification in laboratory environments.
 * @module components/kullanim-dogrulama-panel
 * @version 2.0.0
 */

'use client';
import React, { useState, useMemo, useEffect, ChangeEvent, KeyboardEvent, Suspense, useCallback } from 'react';
import type { Laboratory, ProductCode, ConsumptionRecord, VerificationItemGroup, AppView } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { CheckSquare, Recycle, Loader2, Info, Search, Barcode } from 'lucide-react';
import { DISPOSAL_BARCODE_LENGTH, DISPOSAL_LOT_LENGTH } from '@/lib/constants';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";
import { kullanimDogrulamaLogger } from '@/lib/logger';


/**
 * Usage Verification Panel Component
 *
 * Provides functionality for verifying that consumed products have been properly
 * disposed of by scanning disposal kit barcodes. The panel displays consumption
 * records grouped by product, lot, and expiry date, allowing verification of
 * each consumed item.
 *
 * @example
 * ```tsx
 * <KullanimDogrulamaPanel />
 * ```
 */
export default function KullanimDogrulamaPanel() {
  const [selectedLaboratoryId, setSelectedLaboratoryId] = useState<string>('');
  const [disposalBarcode, setDisposalBarcode] = useState<string>('');
  const [verificationItems, setVerificationItems] = useState<VerificationItemGroup[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [tuketimKayitlari, setTuketimKayitlari] = useState<ConsumptionRecord[]>([]);
  const { toast } = useToast();

  /** Input element ID for disposal barcode scanner field */
  const DISPOSAL_BARCODE_INPUT_ID = "disposal-barcode-input";

  /**
   * Fetches all required data for the verification panel
   * Loads laboratories, product codes, and consumption records from Firestore
   */
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
    fetchPanelData();
  }, [fetchPanelData]);

  useEffect(() => {
    if (selectedLaboratoryId) {
      const laboratory = laboratories.find(h => h.id === selectedLaboratoryId);
      if (!laboratory) return;

      const laboratoryName = laboratory.name;
      const relevantConsumptions = tuketimKayitlari.filter(
        record => record.laboratoryName === laboratoryName && record.consumptionType === 'normal_kullanim'
      );

      const grouped: Record<string, VerificationItemGroup> = {};

      relevantConsumptions.forEach(record => {
        const key = `${record.stokKodu}-${record.lotNumarasi}-${record.miad}`;
        if (!grouped[key]) {
          grouped[key] = {
            stokKodu: record.stokKodu,
            stokAdi: record.stokAdi,
            lotNumarasi: record.lotNumarasi,
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
        if(currentVerificationState[key] && currentVerificationState[key] <= grouped[key].tuketilenAdet) {
          grouped[key].dogrulananAdet = currentVerificationState[key];
        }
      });
      
      setVerificationItems(Object.values(grouped).sort((a,b) => a.stokAdi.localeCompare(b.stokAdi)));
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
  }, [verificationItems, searchTerm]);


  /**
   * Handles disposal barcode scanning and verification
   * Validates barcode format, finds matching consumption record, and updates verification count
   * @param barcodeToProcess - Optional barcode to process, defaults to current input value
   */
  const handleDisposalScan = (barcodeToProcess?: string) => {
    const currentBarcode = (barcodeToProcess || disposalBarcode).trim();

    if (!selectedLaboratoryId) {
      kullanimDogrulamaLogger.warn('Laboratuvar seçilmeden barkod okutulmaya çalışıldı');
      toast({ title: "Uyarı", description: "Lütfen önce bir laboratuvar seçin.", variant: "default" });
      return;
    }
    if (!currentBarcode) {
      toast({ title: "Uyarı", description: "Lütfen imha barkodunu okutun.", variant: "default" });
      return;
    }
    if (currentBarcode.length !== DISPOSAL_BARCODE_LENGTH) {
      kullanimDogrulamaLogger.warn('Geçersiz barkod uzunluğu', {
        expected: DISPOSAL_BARCODE_LENGTH,
        received: currentBarcode.length,
      });
      toast({ title: "Hata", description: `İmha barkodu ${DISPOSAL_BARCODE_LENGTH} hane olmalıdır. Girilen: ${currentBarcode.length}`, variant: "destructive" });
      setDisposalBarcode('');
      return;
    }

    const kitLotNumber = currentBarcode.substring(0, DISPOSAL_LOT_LENGTH);

    let itemWasFoundAndUpdated = false;
    let updatedItemDetailsForToast: VerificationItemGroup | null = null;

    setVerificationItems(prevItems =>
      prevItems.map(item => {
        if (!itemWasFoundAndUpdated && item.lotNumarasi === kitLotNumber && item.dogrulananAdet < item.tuketilenAdet) {
          itemWasFoundAndUpdated = true;
          updatedItemDetailsForToast = { ...item, dogrulananAdet: item.dogrulananAdet + 1 };
          return { ...item, dogrulananAdet: item.dogrulananAdet + 1 };
        }
        return item;
      })
    );

    if (itemWasFoundAndUpdated && updatedItemDetailsForToast) {
      kullanimDogrulamaLogger.info('İmha doğrulandı', {
        stokKodu: updatedItemDetailsForToast.stokKodu,
        lotNumarasi: updatedItemDetailsForToast.lotNumarasi,
        dogrulananAdet: updatedItemDetailsForToast.dogrulananAdet,
        tuketilenAdet: updatedItemDetailsForToast.tuketilenAdet,
      });
      toast({ title: "Doğrulandı", description: `${updatedItemDetailsForToast.stokAdi} (Lot: ${updatedItemDetailsForToast.lotNumarasi}) için 1 adet imha doğrulandı.` });
    } else {
      const alreadyFullyVerifiedItem = verificationItems.find(item => item.lotNumarasi === kitLotNumber && item.dogrulananAdet === item.tuketilenAdet);
      if(alreadyFullyVerifiedItem){
          kullanimDogrulamaLogger.debug('Zaten tamamen doğrulanmış lot', { kitLotNumber });
          toast({ title: "Zaten Doğrulanmış", description: `${alreadyFullyVerifiedItem.stokAdi} (Lot: ${kitLotNumber}) için tüm tüketimler zaten doğrulanmış.`, variant: "default", duration: 5000 });
      } else {
        kullanimDogrulamaLogger.warn('Eşleşen lot bulunamadı', { kitLotNumber });
        toast({ title: "Uyarı", description: `Okutulan kit lot numarası (${kitLotNumber}) ile eşleşen veya doğrulanmamış tüketim bulunamadı.`, variant: "default", duration: 5000 });
      }
    }

    setDisposalBarcode('');
    document.getElementById(DISPOSAL_BARCODE_INPUT_ID)?.focus();
  };
  
  const handleDisposalKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleDisposalScan();
    }
  }

  return (
    <div className="space-y-6" role="main" aria-label="Kullanım doğrulama paneli">
      <Card className="shadow-md rounded-lg" role="region" aria-labelledby="verification-title">
        <CardHeader>
          <CardTitle id="verification-title" className="text-xl flex items-center">
            <Recycle className="mr-2 h-6 w-6 text-green-600" aria-hidden="true" />
            Kullanım Sağlama (İmha Doğrulama)
          </CardTitle>
          <CardDescription>Kullanılan ürünlerin kitlerinin imha edildiğini doğrulayın. İmha kiti barkodunu okutun.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="laboratory-select-verification" className="block text-sm font-medium mb-1">Laboratuvar Seçin</label>
            <Select value={selectedLaboratoryId} onValueChange={(value) => { setSelectedLaboratoryId(value); setSearchTerm(''); }}>
              <SelectTrigger id="laboratory-select-verification" className="w-full md:w-1/2 lg:w-1/3 rounded-md" aria-label="Doğrulama yapılacak laboratuvarı seçin">
                <SelectValue placeholder="Doğrulama yapılacak laboratuvarı seçin" />
              </SelectTrigger>
              <SelectContent>
                {laboratories.map(h => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
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
                        placeholder="Stok adı, kodu veya lot ile ara..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="max-w-xs rounded-md h-9"
                    />
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-0">
              <div className="flex items-center space-x-2 mb-4" role="search">
                <Input
                  id={DISPOSAL_BARCODE_INPUT_ID}
                  placeholder={`İmha Kiti Barkodu (${DISPOSAL_BARCODE_LENGTH} hane)`}
                  value={disposalBarcode}
                  onChange={(e) => setDisposalBarcode(e.target.value)}
                  onKeyPress={handleDisposalKeyPress}
                  maxLength={DISPOSAL_BARCODE_LENGTH}
                  className="flex-grow rounded-md h-10"
                  disabled={!selectedLaboratoryId || verificationItems.length === 0}
                  aria-label="İmha kiti barkodu girin"
                  aria-describedby="barcode-hint"
                />
                <span id="barcode-hint" className="sr-only">
                  Barkod {DISPOSAL_BARCODE_LENGTH} haneli olmalıdır
                </span>
                <Button
                  onClick={() => handleDisposalScan()}
                  className="rounded-md h-10"
                  disabled={!disposalBarcode}
                  aria-label="Barkodu doğrula"
                >
                  <Barcode className="mr-2 h-5 w-5" aria-hidden="true" />
                  Doğrula
                </Button>
              </div>

              {isLoading ? (
                  <div className="flex justify-center items-center py-6" role="status" aria-label="Yükleniyor">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
                    <span className="sr-only">Veriler yükleniyor...</span>
                  </div>
              ) : verificationItems.length === 0 && !searchTerm ? (
                 <div className="flex flex-col items-center justify-center py-6 text-muted-foreground" role="status">
                  <Info className="h-10 w-10 mb-2" aria-hidden="true" />
                  <p>Bu laboratuvar için doğrulanacak kullanım kaydı bulunmuyor.</p>
                </div>
              ) : filteredVerificationItems.length === 0 && searchTerm ? (
                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground" role="status">
                  <Search className="h-10 w-10 mb-2" aria-hidden="true" />
                  <p>Arama kriterlerine uyan doğrulanacak kullanım yok.</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[500px]">
                  <Table aria-label="Doğrulanacak kullanım kayıtları">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stok Adı (Kodu)</TableHead>
                        <TableHead>Lot Numarası</TableHead>
                        <TableHead>Miad</TableHead>
                        <TableHead className="text-center">Tüketilen</TableHead>
                        <TableHead className="text-center">Doğrulanan</TableHead>
                        <TableHead className="w-[150px]">İlerleme</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredVerificationItems.map(item => {
                        const progressPercentage = item.tuketilenAdet > 0 ? (item.dogrulananAdet / item.tuketilenAdet) * 100 : 0;
                        const isFullyVerified = item.dogrulananAdet === item.tuketilenAdet && item.tuketilenAdet > 0;
                        return (
                          <TableRow key={`${item.stokKodu}-${item.lotNumarasi}-${item.miad}`} className={isFullyVerified ? 'bg-green-500/10 dark:bg-green-500/20 opacity-70' : ''}>
                            <TableCell>
                              {item.stokAdi}
                              <span className="block text-xs text-muted-foreground font-mono">({item.stokKodu})</span>
                            </TableCell>
                            <TableCell className="font-mono">{item.lotNumarasi}</TableCell>
                            <TableCell>{item.miad}</TableCell>
                            <TableCell className="text-center font-medium">{item.tuketilenAdet}</TableCell>
                            <TableCell className="text-center font-semibold text-primary">{item.dogrulananAdet}</TableCell>
                            <TableCell>
                              <div className="flex items-center space-x-2">
                                <Progress value={progressPercentage} className="h-3 flex-grow rounded-md" />
                                <span className="text-xs font-mono w-10 text-right">
                                  {Math.round(progressPercentage)}%
                                </span>
                                {isFullyVerified && <CheckSquare className="h-5 w-5 text-green-600" />}
                              </div>
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
