/**
 * @fileoverview Total Verimlilik Geçmiş Detay (Total Efficiency History Detail) Panel
 * @description Displays detailed view of a saved total efficiency calculation record
 * with full table data, efficiency metrics visualization, and export capabilities.
 * @module components/total-verimlilik-gecmis-detay-panel
 * @version 1.0.0
 *
 * @features
 * - Full table view with all efficiency columns
 * - Results-only view toggle
 * - Efficiency metrics visualization with circular charts
 * - Excel export functionality
 * - Column 22 box loss calculation with mode toggle
 *
 * @accessibility
 * - ARIA labels for charts and tables
 * - Screen reader compatible data display
 * - Keyboard accessible toggle buttons
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { loadTotalEfficiencyRows } from '@/lib/total-efficiency-record-storage';
import { useToast } from '@/hooks/use-toast';
import { totalVerimlilikLogger } from '@/lib/logger';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Loader2, History, Calendar, Building2, Eye, EyeOff, FileSpreadsheet } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { exportDataToExcel } from '@/lib/utils';
import { calculateEfficiencyMetrics } from '@/lib/verimlilik/validation';

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

interface EfficiencyMetrics {
  toplamKumulatif: number;
  toplamBeklenenTuketim: number;
  toplamHakEdis: number;
  stokSapmaYuzde: number;
  kitSapmaYuzde: number;
  stokDogrulukSkoru: number;
  kitVerimlilikSkoru: number;
  genelVerimlilik: number;
  toplamEtkiDegeri?: number;
  maliyetAgirlikli?: boolean;
  hesaplananSatirSayisi?: number;
  hakEdisVerisiGirildi?: boolean;
  algoritma?: 'value-impact-efficiency-index';
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
  efficiencyMetrics?: EfficiencyMetrics;
  isAraKayit?: boolean;
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
  const [column22Mode, setColumn22Mode] = useState<'kumulatif' | 'hakedis'>('kumulatif');
  const [showStockAlgorithmModal, setShowStockAlgorithmModal] = useState(false);

  useEffect(() => {
    const fetchRecord = async () => {
      try {
        const docRef = doc(db, 'totalEfficiencyRecords', recordId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          const rows = await loadTotalEfficiencyRows<TotalEfficiencyRecord['rows'][number]>(docSnap.id, data);
          setRecord({
            id: docSnap.id,
            poolId: data.poolId || '',
            poolName: data.poolName || '',
            month: data.month ?? 0,
            year: data.year ?? 0,
            rows,
            createdAt: data.createdAt || null,
            createdByName: data.createdByName || '',
            efficiencyMetrics: rows.length && data.efficiencyMetrics?.hakEdisVerisiGirildi === undefined
              ? calculateEfficiencyMetrics(rows)
              : data.efficiencyMetrics || (rows.length ? calculateEfficiencyMetrics(rows) : undefined),
            isAraKayit: data.isAraKayit === true,
          });
        } else {
          toast({
            title: 'Hata',
            description: 'Kayıt bulunamadı.',
            variant: 'destructive',
          });
        }
      } catch (error) {
        totalVerimlilikLogger.error('Total verimlilik detay kaydı yüklenemedi', error, {
          recordId,
        });
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
      'Rutin (Test)': r.hakEdis,
      'Stok Doğruluk Fark (Test)': r.stokDogrulukFark,
      'Stok Doğruluk Sapma (%)': Number(r.stokDogrulukYuzde.toFixed(2)),
      'Kit Verimlilik Fark (Test)': r.kitVerimlilikFark,
      'Kit Verimlilik Sapma (%)': Number(r.kitVerimlilikYuzde.toFixed(2)),
    }));

    const fileName = `Total_Verimlilik_Gecmis_${record.poolName}_${record.year}-${String(record.month + 1).padStart(2, '0')}`;
    exportDataToExcel(dataToExport, fileName, 'Veriler', toast);
  };

  const stockAlgorithmRows = useMemo(() => {
    if (!record?.rows.length) return [];

    return record.rows.map(row => {
      const expectedConsumption = row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest;
      const volume = Math.max(0, row.kumulatifTotal || 0);
      const stockScore = volume > 0
        ? Math.max(0, Math.min(100, 100 - (Math.abs(row.stokDogrulukFark) / volume) * 100))
        : 100;

      return {
        id: row.id,
        labName: row.labName,
        stokAdi: row.stokAdi,
        expectedConsumption,
        volume,
        stockDiff: row.stokDogrulukFark,
        stockScore,
        impact: volume,
      };
    });
  }, [record]);

  const stockAlgorithmTotals = useMemo(() => {
    const hakEdisVerisiGirildi = record?.efficiencyMetrics?.hakEdisVerisiGirildi
      ?? record?.rows.some(row => Number(row.hakEdis || 0) > 0)
      ?? false;

    return { hakEdisVerisiGirildi };
  }, [record]);

  if (isLoading) {
    return (
      <div className="p-4">
        <BackButton fallback="/total-verimlilik/gecmis" />
        <div className="flex items-center justify-center h-64" role="status" aria-label="Yükleniyor">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Kayıt detayları yükleniyor...</span>
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="p-4">
        <BackButton fallback="/total-verimlilik/gecmis" />
        <div className="text-center py-8 text-muted-foreground" role="status" aria-live="polite">
          Kayıt bulunamadı.
        </div>
      </div>
    );
  }

  const firstLabId = record.rows[0]?.labId;
  const calculationDetailHref = firstLabId
    ? `/total-verimlilik/gecmis/${record.id}/hesap-detay/${encodeURIComponent(firstLabId)}`
    : null;

  return (
    <div className="p-4 space-y-6" role="main" aria-label="Total Verimlilik Geçmiş Detayı">
      <BackButton fallback="/total-verimlilik/gecmis" />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <History className="h-6 w-6 text-primary" aria-hidden="true" />
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

            {/* Genel Verimlilik Dairesel Grafik */}
            {record.efficiencyMetrics && (
              <div className="flex items-center gap-6 px-6 py-4 bg-muted/30 rounded-xl">
                {/* Ana Dairesel Grafik */}
                <div className="relative w-28 h-28">
                  <svg className="w-28 h-28 transform -rotate-90">
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      stroke="currentColor"
                      strokeWidth="10"
                      fill="none"
                      className="text-muted"
                    />
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      stroke="currentColor"
                      strokeWidth="10"
                      fill="none"
                      strokeDasharray={`${(record.efficiencyMetrics.genelVerimlilik / 100) * 301.6} 301.6`}
                      strokeLinecap="round"
                      className={
                        record.efficiencyMetrics.genelVerimlilik >= 90 ? 'text-green-500' :
                        record.efficiencyMetrics.genelVerimlilik >= 70 ? 'text-yellow-500' :
                        record.efficiencyMetrics.genelVerimlilik >= 50 ? 'text-orange-500' : 'text-red-500'
                      }
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {calculationDetailHref ? (
                      <Link
                        href={calculationDetailHref}
                        className={`text-2xl font-bold underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                          record.efficiencyMetrics.genelVerimlilik >= 90 ? 'text-green-600' :
                          record.efficiencyMetrics.genelVerimlilik >= 70 ? 'text-yellow-600' :
                          record.efficiencyMetrics.genelVerimlilik >= 50 ? 'text-orange-600' : 'text-red-600'
                        }`}
                        aria-label="Laboratuvar dönem hesap detay panelini aç"
                        title="Hesap detay panelini aç"
                      >
                        %{record.efficiencyMetrics.genelVerimlilik.toFixed(1)}
                      </Link>
                    ) : (
                      <span className={`text-2xl font-bold ${
                        record.efficiencyMetrics.genelVerimlilik >= 90 ? 'text-green-600' :
                        record.efficiencyMetrics.genelVerimlilik >= 70 ? 'text-yellow-600' :
                        record.efficiencyMetrics.genelVerimlilik >= 50 ? 'text-orange-600' : 'text-red-600'
                      }`}>
                        %{record.efficiencyMetrics.genelVerimlilik.toFixed(1)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">Genel</span>
                  </div>
                </div>

                {/* Detay Skorları */}
                <div className="flex flex-col gap-3">
                  {/* Stok Doğruluk */}
                  <div className="flex items-center gap-3">
                    <div className="relative w-12 h-12">
                      <svg className="w-12 h-12 transform -rotate-90">
                        <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="none" className="text-muted" />
                        <circle
                          cx="24" cy="24" r="20"
                          stroke="currentColor" strokeWidth="4" fill="none"
                          strokeDasharray={`${(record.efficiencyMetrics.stokDogrulukSkoru / 100) * 125.7} 125.7`}
                          strokeLinecap="round"
                          className={record.efficiencyMetrics.stokDogrulukSkoru >= 90 ? 'text-green-500' : record.efficiencyMetrics.stokDogrulukSkoru >= 70 ? 'text-yellow-500' : 'text-red-500'}
                        />
                      </svg>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">Stok Doğruluk</span>
                      {calculationDetailHref ? (
                        <Link
                          href={calculationDetailHref}
                          className={`w-fit text-left text-lg font-bold underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${record.efficiencyMetrics.stokDogrulukSkoru >= 90 ? 'text-green-600' : record.efficiencyMetrics.stokDogrulukSkoru >= 70 ? 'text-yellow-600' : 'text-red-600'}`}
                          aria-label="Laboratuvar dönem hesap detay panelini aç"
                          title="Hesap detay panelini aç"
                        >
                          %{record.efficiencyMetrics.stokDogrulukSkoru.toFixed(1)}
                        </Link>
                      ) : (
                        <span className={`text-lg font-bold ${record.efficiencyMetrics.stokDogrulukSkoru >= 90 ? 'text-green-600' : record.efficiencyMetrics.stokDogrulukSkoru >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                          %{record.efficiencyMetrics.stokDogrulukSkoru.toFixed(1)}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">Sapma: %{record.efficiencyMetrics.stokSapmaYuzde.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Kit Verimlilik */}
                  <div className="flex items-center gap-3">
                    <div className="relative w-12 h-12">
                      <svg className="w-12 h-12 transform -rotate-90">
                        <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="none" className="text-muted" />
                        <circle
                          cx="24" cy="24" r="20"
                          stroke="currentColor" strokeWidth="4" fill="none"
                          strokeDasharray={`${record.efficiencyMetrics.hakEdisVerisiGirildi === false ? 0 : (record.efficiencyMetrics.kitVerimlilikSkoru / 100) * 125.7} 125.7`}
                          strokeLinecap="round"
                          className={record.efficiencyMetrics.hakEdisVerisiGirildi === false ? 'text-muted-foreground' : record.efficiencyMetrics.kitVerimlilikSkoru >= 90 ? 'text-green-500' : record.efficiencyMetrics.kitVerimlilikSkoru >= 70 ? 'text-yellow-500' : 'text-red-500'}
                        />
                      </svg>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">Kit Verimlilik</span>
                      {record.efficiencyMetrics.hakEdisVerisiGirildi === false ? (
                        <>
                          <span className="text-lg font-bold text-muted-foreground">Dahil değil</span>
                          <span className="text-xs text-muted-foreground">Hak ediş girilmedi</span>
                        </>
                      ) : (
                        <>
                          <span className={`text-lg font-bold ${record.efficiencyMetrics.kitVerimlilikSkoru >= 90 ? 'text-green-600' : record.efficiencyMetrics.kitVerimlilikSkoru >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                            %{record.efficiencyMetrics.kitVerimlilikSkoru.toFixed(1)}
                          </span>
                          <span className="text-xs text-muted-foreground">Sapma: %{record.efficiencyMetrics.kitSapmaYuzde.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Toplam Test */}
                <div className="flex flex-col items-center justify-center px-4 border-l">
                  <span className="text-2xl font-bold text-primary">
                    {record.efficiencyMetrics.toplamKumulatif.toLocaleString('tr-TR')}
                  </span>
                  <span className="text-sm text-muted-foreground">Toplam Test</span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportExcel} aria-label="Excel dosyasına aktar">
                <FileSpreadsheet className="h-4 w-4 mr-2" aria-hidden="true" />
                Excel'e Aktar
              </Button>
              <Button
                variant={showResultsOnly ? 'default' : 'outline'}
                onClick={() => setShowResultsOnly(!showResultsOnly)}
                aria-pressed={showResultsOnly}
                aria-label={showResultsOnly ? "Tüm sütunları göster" : "Sadece sonuçları göster"}
              >
                {showResultsOnly ? (
                  <>
                    <EyeOff className="h-4 w-4 mr-2" aria-hidden="true" />
                    Tüm Sütunları Göster
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" aria-hidden="true" />
                    Sadece Sonuçları Göster
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {record.rows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" role="status" aria-live="polite">
              Bu kayıtta veri bulunmuyor.
            </div>
          ) : (
            <ScrollArea className="w-full">
              <div className={showResultsOnly ? 'min-w-[1400px]' : 'min-w-[3400px]'}>
                <Table aria-label="Total verimlilik detay tablosu">
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
                        21. Rutin (Test)
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
                      {/* Sütun 22: Kutu Kayıp */}
                      <TableHead className="min-w-[180px] bg-violet-50 dark:bg-violet-950 text-center p-0">
                        <div className="flex flex-col">
                          <div className="flex">
                            <button
                              onClick={() => setColumn22Mode('kumulatif')}
                              className={`flex-1 py-1.5 px-2 text-xs font-medium transition-colors ${
                                column22Mode === 'kumulatif'
                                  ? 'bg-violet-500 text-white'
                                  : 'bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-800'
                              }`}
                            >
                              Kümülatife Göre
                            </button>
                            <button
                              onClick={() => setColumn22Mode('hakedis')}
                              className={`flex-1 py-1.5 px-2 text-xs font-medium transition-colors ${
                                column22Mode === 'hakedis'
                                  ? 'bg-violet-500 text-white'
                                  : 'bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-800'
                              }`}
                            >
                              Rutine Göre
                            </button>
                          </div>
                          <div className="py-1.5 px-2">
                            <span>22. Kutu Kayıp</span>
                            <div className="text-xs font-normal text-muted-foreground">
                              {column22Mode === 'kumulatif' ? '((14-18)-15)/Amb' : '((14-18)-19)/Amb'}
                            </div>
                          </div>
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {record.rows.map((row) => (
                      <TableRow key={row.id} className="text-sm">
                        <TableCell className="font-medium bg-muted/30 sticky left-0 z-10">
                          <div className="space-y-1">
                            <div>
                              <span>{row.labName}</span>
                              {row.labKod && (
                                <span className="ml-1 text-xs font-mono text-muted-foreground">
                                  ({row.labKod})
                                </span>
                              )}
                            </div>
                            <Link
                              href={`/total-verimlilik/gecmis/${record.id}/hesap-detay/${encodeURIComponent(row.labId)}`}
                              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                              title="Hesap detay panelini aç"
                            >
                              Hesap Detayı
                            </Link>
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
                            <span className="text-[10px] text-muted-foreground">
                              S({(row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest).toLocaleString('tr-TR')}) - K({row.kumulatifTotal.toLocaleString('tr-TR')}) = {row.stokDogrulukFark.toLocaleString('tr-TR')}
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
                            <span className="text-[10px] text-muted-foreground">
                              K({row.kumulatifTotal.toLocaleString('tr-TR')}) - H({row.hakEdis.toLocaleString('tr-TR')}) = {row.kitVerimlilikFark.toLocaleString('tr-TR')}
                            </span>
                          </div>
                        </TableCell>
                        {/* Sütun 22: Kutu Kayıp */}
                        <TableCell className="bg-violet-50/50 dark:bg-violet-950/50 text-center">
                          {(() => {
                            const testFark = column22Mode === 'kumulatif'
                              ? row.stokDogrulukFark
                              : (row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest) - row.hakEdis;

                            const ambalaj = row.ambalajDegeri || 1;
                            const kutuFark = testFark / ambalaj;
                            const absKutuFark = Math.abs(kutuFark);

                            if (absKutuFark < 1) {
                              return (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="text-muted-foreground">0 kutu</span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {Math.abs(testFark).toLocaleString('tr-TR')} test / {ambalaj} amb
                                  </span>
                                </div>
                              );
                            }

                            const colorClass = absKutuFark >= 2
                              ? 'text-red-600 font-bold'
                              : 'text-yellow-600 font-semibold';

                            return (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className={colorClass}>
                                  {kutuFark > 0 ? '+' : '-'}{absKutuFark.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kutu
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {Math.abs(testFark).toLocaleString('tr-TR')} test / {ambalaj} amb
                                </span>
                              </div>
                            );
                          })()}
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
