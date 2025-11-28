
'use client';

import React, { useState, useCallback, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { FileUploader } from '@/components/lbys/FileUploader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Database, Send, Loader2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import type { LabResultExcelRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, doc, serverTimestamp, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { Progress } from '@/components/ui/progress';
import { toDateFromAny } from '@/lib/time';

const columnHeaders: Record<keyof Omit<LabResultExcelRow, 'sourceFileId' | 'importDate'>, string> = {
    hastaId: 'HASTA_ID',
    ornekNo: 'ORNEKNO',
    hastaneId: 'HASTANE_ID',
    hastaneAdi: 'HASTANE_ADI',
    acil: 'ACIL',
    yatan: 'YATAN',
    testId: 'TEST_ID',
    testAdi: 'TEST_ADI',
    endikeKodu: 'ENDIKE_KODU',
    barkodNo: 'BARKODNO',
    servisKodu: 'SERVIS_POLIKLINIK_KODU',
    servisAdi: 'SERVIS_POL_ADI',
    doktorBrans: 'DOKTOR_BRANS',
    doktorAdi: 'DOKTOR_ADI',
    tekrarSayisi: 'TEKRAR_SAYISI',
    cihazNo: 'CIHAZNO',
    retNedeni: 'RET_NEDENI',
    onaylayanAd: 'ONAYLAYAN_AD',
    onaylayanUnvan: 'ONAYLAYAN_UNVAN',
    sonucDurum: 'SONUC_DURUM',
    istemTarihi: 'ISTEMTARIHI',
    kayitTarihi: 'KAYITTARIHI',
    kanAlmaTarihi: 'KANALMA_TARIHI',
    labKabulTarihi: 'LABKABUL_TARIHI',
    calismaTarihi: 'CALISMA_TARIHI',
    altOnayTarih: 'ALT_ONAYTARIH',
    onayTarih: 'ONAYTARIH',
    otoOnayliMi: 'OTOONAYLI_MI',
    hedefSureDakika: 'HEDEF_SURE',
    materyal: 'MATERYAL',
    bolgeKodu: 'BOLGE_KODU',
    dislabKabul: 'DISLAB_KABUL',
    tupAdi: 'TUP_ADI',
};
  
const allColumns: (keyof Omit<LabResultExcelRow, 'sourceFileId' | 'importDate'>)[] = Object.keys(columnHeaders) as any;

function calculateSummaries(data: LabResultExcelRow[]) {
    const hospitalMap: Record<string, { testCount: number; sampleSet: Set<string> }> = {};
    const departmentMap: Record<string, { testCount: number; sampleSet: Set<string> }> = {};
    const testMap: Record<string, { calismaSayisi: number; redSayisi: number; tekrarSayisi: number; totalTat: number; tatCount: number }> = {};

    data.forEach(row => {
        if (row.hastaneAdi) {
            if (!hospitalMap[row.hastaneAdi]) hospitalMap[row.hastaneAdi] = { testCount: 0, sampleSet: new Set() };
            hospitalMap[row.hastaneAdi].testCount++;
            if (row.ornekNo) hospitalMap[row.hastaneAdi].sampleSet.add(row.ornekNo);
        }
        if (row.servisAdi) {
            if (!departmentMap[row.servisAdi]) departmentMap[row.servisAdi] = { testCount: 0, sampleSet: new Set() };
            departmentMap[row.servisAdi].testCount++;
            if (row.ornekNo) departmentMap[row.servisAdi].sampleSet.add(row.ornekNo);
        }
        if (row.testAdi) {
            if (!testMap[row.testAdi]) testMap[row.testAdi] = { calismaSayisi: 0, redSayisi: 0, tekrarSayisi: 0, totalTat: 0, tatCount: 0 };
            testMap[row.testAdi].calismaSayisi++;
            if (row.sonucDurum === 'Reddedildi') testMap[row.testAdi].redSayisi++;
            testMap[row.testAdi].tekrarSayisi += Number(row.tekrarSayisi || 0);

            const onayDate = toDateFromAny(row.onayTarih);
            const kabulDate = toDateFromAny(row.labKabulTarihi);
            if (onayDate && kabulDate && onayDate > kabulDate) {
                const tat = (onayDate.getTime() - kabulDate.getTime()) / 60000; // minutes
                if (tat > 0) {
                    testMap[row.testAdi].totalTat += tat;
                    testMap[row.testAdi].tatCount++;
                }
            }
        }
    });

    return {
        hospitalSummaries: Object.entries(hospitalMap).map(([name, { testCount, sampleSet }]) => ({ id: name, hastaneAdi: name, testSayisi: testCount, numuneSayisi: sampleSet.size })),
        departmentSummaries: Object.entries(departmentMap).map(([name, { testCount, sampleSet }]) => ({ id: name, servisAdi: name, testSayisi: testCount, numuneSayisi: sampleSet.size })),
        testSummaries: Object.entries(testMap).map(([name, data]) => ({
            id: name,
            testAdi: name,
            ...data,
            rejectionRate: data.calismaSayisi > 0 ? (data.redSayisi / data.calismaSayisi) * 100 : 0,
            rerunRate: data.calismaSayisi > 0 ? (data.tekrarSayisi / data.calismaSayisi) * 100 : 0,
            avgTat: data.tatCount > 0 ? data.totalTat / data.tatCount : 0
        })),
    };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}


export default function LbysVeriYonetimiPage() {
  const [localLabData, setLocalLabData] = useState<LabResultExcelRow[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();

  const handleDataLoaded = (data: LabResultExcelRow[]) => {
    setLocalLabData(data);
  };
  
  const handleSaveToAnalysis = async () => {
    if (localLabData.length === 0) {
      toast({ title: 'Veri Yok', description: 'Kaydedilecek veri bulunmuyor.', variant: 'default' });
      return;
    }
    setSending(true);
    setProgress({ current: 0, total: 1 });

    try {
      const analysisDocRef = doc(db, 'isAnaliziVerileri', 'sonVeri');
      const docSnap = await getDoc(analysisDocRef);
      const existingRawData = docSnap.exists() ? (docSnap.data().rawData || []) : [];
      
      const combinedRawData = [...existingRawData, ...localLabData];
      const summary = calculateSummaries(combinedRawData);
      
      const analysisData = {
          ...summary,
          fileName: localLabData[0]?.sourceFileId || `upload-${Date.now()}`,
          uploadedAt: serverTimestamp(),
          uploadedBy: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
          uploadedById: currentUserProfile?.uid || null,
          rowCount: combinedRawData.length,
          rawData: combinedRawData,
      };
      
      await setDoc(analysisDocRef, analysisData);
      
      setProgress({ current: 1, total: 1 });
      toast({ title: 'Veri Kaydedildi ve Birleştirildi', description: `Özetlenmiş veri, İş Analizi paneli için güncellendi.` });
      setLocalLabData([]); 
    } catch (error: any) {
      console.error("Error saving data:", error);
      toast({ title: 'Hata', description: `Veri kaydedilirken bir sorun oluştu: ${error.message}`, variant: 'destructive' });
    } finally {
      setSending(false);
      setProgress({ current: 0, total: 0 });
    }
  };


  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
          <BackButton fallback="/raporlama" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-headline flex items-center gap-3">
            <Database className="h-7 w-7 text-primary" />
            LBYS Veri Yükleme Paneli
          </CardTitle>
          <CardDescription>
            LBYS'den alınan Excel raporlarını yükleyin. Veriler özetlenerek İş Analizi paneline gönderilecektir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <FileUploader onDataLoaded={handleDataLoaded} />
            
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Yüklenen Veri Önizlemesi</CardTitle>
                            <CardDescription>
                                {localLabData.length > 0 
                                    ? `Toplam ${localLabData.length} satır veri yüklendi. Kontrol edip kaydedebilirsiniz.`
                                    : "Veri yüklenmedi. Lütfen bir Excel dosyası yükleyin."
                                }
                            </CardDescription>
                        </div>
                         <Button onClick={handleSaveToAnalysis} disabled={sending || localLabData.length === 0}>
                            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Verileri İş Analizine Gönder
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {sending && progress.total > 0 && (
                      <div className="mb-4">
                        <Progress value={(progress.current / progress.total) * 100} className="w-full" />
                        <p className="text-sm text-muted-foreground text-center mt-2">
                          Özetlenmiş veri kaydediliyor...
                        </p>
                      </div>
                    )}
                    <div className="relative w-full overflow-x-auto border rounded-md">
                        <Table className="min-w-max">
                            <TableHeader>
                                <TableRow>
                                    {allColumns.map(key => (
                                        <TableHead key={key}>{columnHeaders[key] || key}</TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {localLabData.length > 0 ? (
                                    localLabData.slice(0, 100).map((row, index) => (
                                        <TableRow key={index}>
                                            {allColumns.map(key => (
                                                <TableCell key={key}>
                                                    {(row as any)[key] instanceof Date
                                                      ? (row as any)[key].toLocaleString('tr-TR')
                                                      : (row as any)[key]?.toString() || '-'}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={allColumns.length} className="text-center h-24 text-muted-foreground">
                                            Tabloyu görüntülemek için bir Excel dosyası yükleyin.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </CardContent>
      </Card>
    </div>
  );
}
