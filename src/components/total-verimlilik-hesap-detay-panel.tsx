'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Calendar, History, Loader2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { totalVerimlilikLogger } from '@/lib/logger';
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
  sevkiyatlarSonrasiTotalTest: number;
  kumulatifTotal: number;
  donemSonuToplamTest: number;
  hakEdis: number;
  stokDogrulukFark: number;
  kitVerimlilikFark: number;
}

interface TotalEfficiencyRecord {
  id: string;
  poolName: string;
  month: number;
  year: number;
  rows: TableRowData[];
  createdAt: { seconds: number; nanoseconds: number } | null;
  createdByName: string;
  isAraKayit?: boolean;
}

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

interface Props {
  recordId: string;
  labId: string;
}

export default function TotalVerimlilikHesapDetayPanel({ recordId, labId }: Props) {
  const { toast } = useToast();
  const [record, setRecord] = useState<TotalEfficiencyRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRecord = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'totalEfficiencyRecords', recordId));
        if (!docSnap.exists()) {
          toast({ title: 'Hata', description: 'Kayıt bulunamadı.', variant: 'destructive' });
          return;
        }

        const data = docSnap.data();
        setRecord({
          id: docSnap.id,
          poolName: data.poolName || '',
          month: data.month ?? 0,
          year: data.year ?? 0,
          rows: data.rows || [],
          createdAt: data.createdAt || null,
          createdByName: data.createdByName || '',
          isAraKayit: data.isAraKayit === true,
        });
      } catch (error) {
        totalVerimlilikLogger.error('Total verimlilik hesap detay kaydı yüklenemedi', error, { recordId, labId });
        toast({ title: 'Hata', description: 'Hesap detayı yüklenirken bir hata oluştu.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecord();
  }, [recordId, labId, toast]);

  const labRows = useMemo(() => record?.rows.filter(row => row.labId === labId) ?? [], [record, labId]);
  const labMetrics = useMemo(() => labRows.length ? calculateEfficiencyMetrics(labRows) : null, [labRows]);
  const labName = labRows[0]?.labName || labId;
  const labKod = labRows[0]?.labKod || '';

  const calculationRows = useMemo(() => labRows.map(row => {
    const expectedConsumption = row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest;
    const volume = Math.max(0, row.kumulatifTotal || 0);
    const stockScore = volume > 0
      ? Math.max(0, Math.min(100, 100 - (Math.abs(row.stokDogrulukFark) / volume) * 100))
      : 100;
    const kitScore = labMetrics?.hakEdisVerisiGirildi && volume > 0
      ? Math.max(0, Math.min(100, 100 - (Math.abs(row.kitVerimlilikFark) / volume) * 100))
      : null;
    const generalScore = kitScore === null ? stockScore : (stockScore + kitScore) / 2;

    return {
      ...row,
      expectedConsumption,
      volume,
      stockScore,
      kitScore,
      generalScore,
      impact: volume,
    };
  }), [labRows, labMetrics]);

  if (isLoading) {
    return (
      <div className="p-4">
        <BackButton fallback={`/total-verimlilik/gecmis/${recordId}`} />
        <div className="flex h-64 items-center justify-center" role="status" aria-label="Yükleniyor">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Hesap detayı yükleniyor...</span>
        </div>
      </div>
    );
  }

  if (!record || !labMetrics) {
    return (
      <div className="p-4 space-y-4">
        <BackButton fallback={`/total-verimlilik/gecmis/${recordId}`} />
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Bu laboratuvar ve dönem için hesap detayı bulunamadı.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6" role="main" aria-label="Laboratuvar dönem hesap detayı">
      <BackButton fallback={`/total-verimlilik/gecmis/${recordId}`} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <History className="h-6 w-6 text-primary" aria-hidden="true" />
                Hesap Detayı
              </CardTitle>
              <CardDescription className="mt-2 space-y-1">
                <div className="font-medium text-foreground">
                  {labName}{labKod ? ` (${labKod})` : ''}
                  {record.isAraKayit && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Ara Kayıt</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" aria-hidden="true" />
                  <span>{MONTHS[record.month]} {record.year} • {record.poolName}</span>
                </div>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs text-muted-foreground">Genel Verimlilik</div>
              <div className="text-2xl font-bold">%{labMetrics.genelVerimlilik.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">
                {labMetrics.hakEdisVerisiGirildi ? 'Stok + Kit ortalaması' : 'Sadece stok doğruluk'}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs text-muted-foreground">Stok Doğruluk</div>
              <div className="text-2xl font-bold">%{labMetrics.stokDogrulukSkoru.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">Sapma: %{labMetrics.stokSapmaYuzde.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs text-muted-foreground">Kit Verimlilik</div>
              {labMetrics.hakEdisVerisiGirildi ? (
                <>
                  <div className="text-2xl font-bold">%{labMetrics.kitVerimlilikSkoru.toFixed(1)}</div>
                  <div className="text-xs text-muted-foreground">Sapma: %{labMetrics.kitSapmaYuzde.toFixed(2)}</div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold text-muted-foreground">Dahil değil</div>
                  <div className="text-xs text-muted-foreground">19. Hak Ediş girilmedi</div>
                </>
              )}
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-xs text-muted-foreground">Etki / Satır</div>
              <div className="text-2xl font-bold">{labMetrics.toplamEtkiDegeri.toLocaleString('tr-TR')}</div>
              <div className="text-xs text-muted-foreground">{labMetrics.hesaplananSatirSayisi} satır hesaplandı</div>
            </div>
          </div>

          <div className="rounded-lg border p-4 text-sm">
            <div className="mb-2 font-semibold">Algoritma</div>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Beklenen tüketim = 14. Sevkiyatlar Sonrası Total - 18. Dönem Sonu Toplam.</li>
              <li>Stok doğruluk farkı = (14 - 18) - 15. Kümülatif Total.</li>
              <li>Satır stok skoru = 100 - (|stok doğruluk farkı| / 15. Kümülatif Total × 100), 0-100 aralığına sıkıştırılır.</li>
              <li>Hak ediş girilmişse satır kit skoru da aynı mantıkla 21. Kit Verimlilik farkı üzerinden hesaplanır ve stokla ortalanır.</li>
              <li>Hak ediş girilmemişse genel verimlilik sadece stok doğruluk skorudur.</li>
              <li>Laboratuvar dönem skoru = Σ(satır skoru × etki değeri) / Σ(etki değeri).</li>
            </ol>
          </div>

          <ScrollArea className="h-[520px] rounded-lg border">
            <Table aria-label="Laboratuvar dönem hesap detayı satırları">
              <TableHeader>
                <TableRow>
                  <TableHead>Stok Kodu</TableHead>
                  <TableHead>Ürün</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead className="text-right">14-18</TableHead>
                  <TableHead className="text-right">15. Kümülatif</TableHead>
                  <TableHead className="text-right">19. Hak Ediş</TableHead>
                  <TableHead className="text-right">Stok Fark</TableHead>
                  <TableHead className="text-right">Stok Skoru</TableHead>
                  <TableHead className="text-right">Kit Fark</TableHead>
                  <TableHead className="text-right">Kit Skoru</TableHead>
                  <TableHead className="text-right">Satır Skoru</TableHead>
                  <TableHead className="text-right">Etki</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calculationRows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.stokKodu}</TableCell>
                    <TableCell className="min-w-[240px]">{row.stokAdi}</TableCell>
                    <TableCell>{row.testAdi || '-'}</TableCell>
                    <TableCell className="text-right">{row.expectedConsumption.toLocaleString('tr-TR')}</TableCell>
                    <TableCell className="text-right">{row.volume.toLocaleString('tr-TR')}</TableCell>
                    <TableCell className="text-right">{row.hakEdis.toLocaleString('tr-TR')}</TableCell>
                    <TableCell className="text-right">{row.stokDogrulukFark.toLocaleString('tr-TR')}</TableCell>
                    <TableCell className="text-right">%{row.stockScore.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{row.kitVerimlilikFark.toLocaleString('tr-TR')}</TableCell>
                    <TableCell className="text-right">{row.kitScore === null ? '-' : `%${row.kitScore.toFixed(1)}`}</TableCell>
                    <TableCell className="text-right font-semibold">%{row.generalScore.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{row.impact.toLocaleString('tr-TR')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
