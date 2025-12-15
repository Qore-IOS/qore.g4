'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Loader2, History, Calendar, Building2, Eye, EyeOff, FileSpreadsheet } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { exportDataToExcel } from '@/lib/utils';

interface TableRowData {
  id: string;
  labId: string;
  labName: string;
  labKod: string;
  stokKodu: string;
  stokAdi: string;
  testAdi: string;
  ambalajDegeri: number;
  cihazGrubu: string;
  baslangicStokuKutu: number;
  ayBasiCihazUstuTest: number;
  totalAyBasiStok: number;
  ayBasiSevkiyatKutu: number;
  goztepeSevkiyat: number;
  kurumlarArasiSevk: number;
  lojistikAraTransfer: number;
  sevkiyatlarSonrasiTotalTest: number;
  kumulatifTotal: number;
  donemSonuStokKutu: number;
  donemSonuCihazUstuTest: number;
  donemSonuToplamTest: number;
  hakEdis: number;
  stokDogrulukFark: number;
  stokDogrulukYuzde: number;
  kitVerimlilikFark: number;
  kitVerimlilikYuzde: number;
}

interface TotalEfficiencyRecord {
  id: string;
  poolId: string;
  poolName: string;
  month: number;
  year: number;
  rows: TableRowData[];
  createdAt: { seconds: number; nanoseconds: number } | null;
  createdByName: string;
}

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

interface Props {
  recordId: string;
}

export default function TotalVerimlilikGecmisDetayPanel({ recordId }: Props) {
  const { toast } = useToast();
  const [record, setRecord] = useState<TotalEfficiencyRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showResultsOnly, setShowResultsOnly] = useState(false);

  useEffect(() => {
    const fetchRecord = async () => {
      try {
        const docRef = doc(db, 'totalEfficiencyRecords', recordId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setRecord({
            id: docSnap.id,
            poolId: data.poolId || '',
            poolName: data.poolName || '',
            month: data.month ?? 0,
            year: data.year ?? 0,
            rows: data.rows || [],
            createdAt: data.createdAt || null,
            createdByName: data.createdByName || '',
          });
        } else {
          toast({
            title: 'Hata',
            description: 'Kayıt bulunamadı.',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('Error fetching record:', error);
        toast({
          title: 'Hata',
          description: 'Kayıt yüklenirken bir hata oluştu.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecord();
  }, [recordId, toast]);

  const handleExportExcel = () => {
    if (!record || record.rows.length === 0) return;

    const dataToExport = record.rows.map(r => ({
      'Laboratuvar': r.labName,
      'Lab Kodu': r.labKod,
      'Stok Kodu': r.stokKodu,
      'Ürün Adı': r.stokAdi,
      'Test Adı': r.testAdi,
      'Ambalaj Miktarı': r.ambalajDegeri,
      'Cihaz Grubu': r.cihazGrubu,
      'Başlangıç Stoğu (Kutu)': r.baslangicStokuKutu,
      'Ay Başı Cihaz Üstü (Test)': r.ayBasiCihazUstuTest,
      'Total Ay Başı Stok (Test)': r.totalAyBasiStok,
      'Ay Başı Sevkiyat (Kutu)': r.ayBasiSevkiyatKutu,
      'Göztepe Sevkiyat (Kutu)': r.goztepeSevkiyat,
      'Kurumlar Arası Sevk (Kutu)': r.kurumlarArasiSevk,
      'Lojistik Ara Transfer (Kutu)': r.lojistikAraTransfer,
      'Sevkiyatlar Sonrası Total Test': r.sevkiyatlarSonrasiTotalTest,
      'Kümülatif Total (Test)': r.kumulatifTotal,
      'Dönem Sonu Stok (Kutu)': r.donemSonuStokKutu,
      'Dönem Sonu Cihaz Üstü (Test)': r.donemSonuCihazUstuTest,
      'Dönem Sonu Toplam Test': r.donemSonuToplamTest,
      'Hak Ediş (Test)': r.hakEdis,
      'Stok Doğruluk Fark (Test)': r.stokDogrulukFark,
      'Stok Doğruluk Sapma (%)': Number(r.stokDogrulukYuzde.toFixed(2)),
      'Kit Verimlilik Fark (Test)': r.kitVerimlilikFark,
      'Kit Verimlilik Sapma (%)': Number(r.kitVerimlilikYuzde.toFixed(2)),
    }));

    const fileName = `Total_Verimlilik_Gecmis_${record.poolName}_${record.year}-${String(record.month + 1).padStart(2, '0')}`;
    exportDataToExcel(dataToExport, fileName, 'Veriler', toast);
  };

  if (isLoading) {
    return (
      <div className="p-4">
        <BackButton fallback="/total-verimlilik/gecmis" />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="p-4">
        <BackButton fallback="/total-verimlilik/gecmis" />
        <div className="text-center py-8 text-muted-foreground">
          Kayıt bulunamadı.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      <BackButton fallback="/total-verimlilik/gecmis" />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <History className="h-6 w-6 text-primary" />
                Total Verimlilik Geçmişi
              </CardTitle>
              <CardDescription className="mt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  <span className="font-medium">{record.poolName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>{MONTHS[record.month]} {record.year}</span>
                </div>
                {record.createdAt && (
                  <div className="text-xs text-muted-foreground">
                    Kaydeden: {record.createdByName} - {format(new Date(record.createdAt.seconds * 1000), 'dd MMM yyyy HH:mm', { locale: tr })}
                  </div>
                )}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportExcel}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel'e Aktar
              </Button>
              <Button
                variant={showResultsOnly ? 'default' : 'outline'}
                onClick={() => setShowResultsOnly(!showResultsOnly)}
              >
                {showResultsOnly ? (
                  <>
                    <EyeOff className="h-4 w-4 mr-2" />
                    Tüm Sütunları Göster
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    Sadece Sonuçları Göster
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {record.rows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Bu kayıtta veri bulunmuyor.
            </div>
          ) : (
            <ScrollArea className="w-full">
              <div className={showResultsOnly ? 'min-w-[1400px]' : 'min-w-[3400px]'}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px] bg-muted/50 sticky left-0 z-10">
                        1. Laboratuvar
                      </TableHead>
                      <TableHead className="min-w-[120px]">2. Stok Kodu</TableHead>
                      <TableHead className="min-w-[200px]">3. Ürün Adı</TableHead>
                      {!showResultsOnly && (
                        <>
                          <TableHead className="min-w-[150px]">4. Test Adı</TableHead>
                          <TableHead className="min-w-[100px] text-center">5. Ambalaj</TableHead>
                          <TableHead className="min-w-[150px]">6. Cihaz Grubu</TableHead>
                          <TableHead className="min-w-[130px] bg-blue-50 dark:bg-blue-950">
                            7. Başlangıç Stoğu (Kutu)
                          </TableHead>
                          <TableHead className="min-w-[150px] bg-blue-50 dark:bg-blue-950">
                            8. Ay Başı Cihaz Üstü (Test)
                          </TableHead>
                        </>
                      )}
                      <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950 text-center">
                        9. Total Ay Başı Stok (Test)
                      </TableHead>
                      {!showResultsOnly && (
                        <>
                          <TableHead className="min-w-[130px] bg-blue-50 dark:bg-blue-950">
                            10. Ay Başı Sevkiyat (Kutu)
                          </TableHead>
                          <TableHead className="min-w-[130px] bg-purple-50 dark:bg-purple-950">
                            11. Göztepe Sevkiyat (Kutu)
                          </TableHead>
                          <TableHead className="min-w-[180px] bg-orange-50 dark:bg-orange-950">
                            12. Kurumlar Arası Sevk (Kutu)
                          </TableHead>
                          <TableHead className="min-w-[140px] bg-blue-50 dark:bg-blue-950">
                            13. Lojistik Ara Transfer (Kutu)
                          </TableHead>
                        </>
                      )}
                      <TableHead className="min-w-[180px] bg-green-50 dark:bg-green-950 text-center">
                        14. Sevkiyatlar Sonrası Total Test
                      </TableHead>
                      <TableHead className="min-w-[140px] bg-cyan-50 dark:bg-cyan-950">
                        15. Kümülatif Total (Test)
                      </TableHead>
                      {!showResultsOnly && (
                        <>
                          <TableHead className="min-w-[140px] bg-blue-50 dark:bg-blue-950">
                            16. Dönem Sonu Stok (Kutu)
                          </TableHead>
                          <TableHead className="min-w-[160px] bg-blue-50 dark:bg-blue-950">
                            17. Dönem Sonu Cihaz Üstü (Test)
                          </TableHead>
                        </>
                      )}
                      <TableHead className="min-w-[180px] bg-green-50 dark:bg-green-950 text-center">
                        18. Dönem Sonu Toplam Test
                      </TableHead>
                      <TableHead className="min-w-[140px] bg-yellow-50 dark:bg-yellow-950">
                        19. Hak Ediş (Test)
                      </TableHead>
                      <TableHead className="min-w-[200px] bg-red-50 dark:bg-red-950 text-center">
                        <div className="flex flex-col">
                          <span>20. Stok Doğruluk</span>
                          <span className="text-xs font-normal text-muted-foreground">(14-18) - 15</span>
                        </div>
                      </TableHead>
                      <TableHead className="min-w-[200px] bg-emerald-50 dark:bg-emerald-950 text-center">
                        <div className="flex flex-col">
                          <span>21. Kit Verimlilik</span>
                          <span className="text-xs font-normal text-muted-foreground">15 - 19</span>
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {record.rows.map((row) => (
                      <TableRow key={row.id} className="text-sm">
                        <TableCell className="font-medium bg-muted/30 sticky left-0 z-10">
                          <div>
                            <span>{row.labName}</span>
                            {row.labKod && (
                              <span className="ml-1 text-xs font-mono text-muted-foreground">
                                ({row.labKod})
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.stokKodu}</TableCell>
                        <TableCell>{row.stokAdi}</TableCell>
                        {!showResultsOnly && (
                          <>
                            <TableCell className="text-muted-foreground">{row.testAdi || '-'}</TableCell>
                            <TableCell className="text-center">{row.ambalajDegeri || '-'}</TableCell>
                            <TableCell className="text-muted-foreground">{row.cihazGrubu || '-'}</TableCell>
                            <TableCell className="bg-blue-50/50 dark:bg-blue-950/50 text-center">
                              {row.baslangicStokuKutu.toLocaleString('tr-TR')}
                            </TableCell>
                            <TableCell className="bg-blue-50/50 dark:bg-blue-950/50 text-center">
                              {row.ayBasiCihazUstuTest.toLocaleString('tr-TR')}
                            </TableCell>
                          </>
                        )}
                        <TableCell className="bg-green-50/50 dark:bg-green-950/50 text-center font-semibold">
                          {row.totalAyBasiStok.toLocaleString('tr-TR')}
                        </TableCell>
                        {!showResultsOnly && (
                          <>
                            <TableCell className="bg-blue-50/50 dark:bg-blue-950/50 text-center">
                              {row.ayBasiSevkiyatKutu.toLocaleString('tr-TR')}
                            </TableCell>
                            <TableCell className="bg-purple-50/50 dark:bg-purple-950/50 text-center">
                              {row.goztepeSevkiyat.toLocaleString('tr-TR')}
                            </TableCell>
                            <TableCell className="bg-orange-50/50 dark:bg-orange-950/50 text-center">
                              {row.kurumlarArasiSevk.toLocaleString('tr-TR')}
                            </TableCell>
                            <TableCell className="bg-blue-50/50 dark:bg-blue-950/50 text-center">
                              {row.lojistikAraTransfer.toLocaleString('tr-TR')}
                            </TableCell>
                          </>
                        )}
                        <TableCell className="bg-green-50/50 dark:bg-green-950/50 text-center font-semibold">
                          {row.sevkiyatlarSonrasiTotalTest.toLocaleString('tr-TR')}
                        </TableCell>
                        <TableCell className="bg-cyan-50/50 dark:bg-cyan-950/50 text-center font-semibold">
                          {row.kumulatifTotal.toLocaleString('tr-TR')}
                        </TableCell>
                        {!showResultsOnly && (
                          <>
                            <TableCell className="bg-blue-50/50 dark:bg-blue-950/50 text-center">
                              {row.donemSonuStokKutu.toLocaleString('tr-TR')}
                            </TableCell>
                            <TableCell className="bg-blue-50/50 dark:bg-blue-950/50 text-center">
                              {row.donemSonuCihazUstuTest.toLocaleString('tr-TR')}
                            </TableCell>
                          </>
                        )}
                        <TableCell className="bg-green-50/50 dark:bg-green-950/50 text-center font-semibold">
                          {row.donemSonuToplamTest.toLocaleString('tr-TR')}
                        </TableCell>
                        <TableCell className="bg-yellow-50/50 dark:bg-yellow-950/50 text-center font-semibold">
                          {row.hakEdis.toLocaleString('tr-TR')}
                        </TableCell>
                        <TableCell className="bg-red-50/50 dark:bg-red-950/50 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`font-semibold ${row.stokDogrulukFark !== 0 ? (row.stokDogrulukFark > 0 ? 'text-red-600' : 'text-green-600') : ''}`}>
                              Fark {Math.abs(row.stokDogrulukFark).toLocaleString('tr-TR')} test
                            </span>
                            <span className={`text-xs ${row.stokDogrulukYuzde !== 0 ? (row.stokDogrulukYuzde > 0 ? 'text-red-500' : 'text-green-500') : 'text-muted-foreground'}`}>
                              {Math.abs(row.stokDogrulukFark).toLocaleString('tr-TR')}/{row.kumulatifTotal.toLocaleString('tr-TR')} = %{Math.abs(row.stokDogrulukYuzde).toFixed(1)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="bg-emerald-50/50 dark:bg-emerald-950/50 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`font-semibold ${row.kitVerimlilikFark !== 0 ? (row.kitVerimlilikFark > 0 ? 'text-orange-600' : 'text-green-600') : ''}`}>
                              Fark {Math.abs(row.kitVerimlilikFark).toLocaleString('tr-TR')} test
                            </span>
                            <span className={`text-xs ${row.kitVerimlilikYuzde !== 0 ? (row.kitVerimlilikYuzde > 0 ? 'text-orange-500' : 'text-green-500') : 'text-muted-foreground'}`}>
                              {Math.abs(row.kitVerimlilikFark).toLocaleString('tr-TR')}/{row.kumulatifTotal.toLocaleString('tr-TR')} = %{Math.abs(row.kitVerimlilikYuzde).toFixed(1)}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}

          {record.rows.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground text-center">
              Toplam {record.rows.length} satır
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
