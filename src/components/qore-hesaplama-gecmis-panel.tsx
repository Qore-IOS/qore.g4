'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, Table2, Trash2 } from 'lucide-react';
import { deleteDoc, doc, orderBy } from '../lib/data/client';
import BackButton from '@/components/BackButton';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/contexts/auth-context';
import { db } from '../lib/data/client';
import { getScopedDocs } from '@/lib/document-helpers';
import { exportDataToExcel } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useTestDefinitions } from '@/hooks/useDatabaseQueries';

type HistoryKind = 'kumulatif' | 'cihazUstu';

type HistoryItem = {
  productId: string;
  productName?: string;
  testName?: string;
  matchedTests?: string[];
  routine?: number;
  rerun?: number;
  calib?: number;
  control?: number;
  total?: number;
  efficiency?: number | null;
  value?: number;
};

type HistoryRecord = {
  id: string;
  hospitalId?: string;
  hospitalName?: string;
  scopeLabel?: string;
  period?: string;
  month?: number;
  year?: number;
  rowCount?: number;
  items?: HistoryItem[];
  createdAt?: any;
  createdByName?: string;
};

const config = {
  kumulatif: {
    title: 'Kümülatif Hesaplama Geçmişi',
    collection: 'kumulatifHesaplamaGecmisi',
    fallback: '/kumulatif-hesaplama',
    sheet: 'Kümülatif Geçmiş',
  },
  cihazUstu: {
    title: 'Cihaz Üstü Hesaplama Geçmişi',
    collection: 'cihazUstuGecmisi',
    fallback: '/cihaz-ustu-hesaplama',
    sheet: 'Cihaz Üstü Geçmiş',
  },
} as const;


function calculateEfficiency(item: HistoryItem): number | null {
  const total = item.total || 0;
  return total ? ((item.routine || 0) / total) * 100 : null;
}

function getEfficiencyValue(item: HistoryItem): number | null {
  return typeof item.efficiency === 'number' ? item.efficiency : calculateEfficiency(item);
}

function toSheetName(record: HistoryRecord, index: number): string {
  const base = `${record.scopeLabel || record.hospitalName || record.hospitalId || 'Lab'}_${index + 1}`
    .replace(/[\/?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || `Lab_${index + 1}`).substring(0, 31);
}

function getPeriodMonthLabel(period: string): string {
  const month = Number(period.split('-')[0]);
  if (!month || month < 1 || month > 12) return period;
  return new Date(0, month - 1, 1).toLocaleString('tr-TR', { month: 'long' }).toLocaleUpperCase('tr-TR');
}

function formatDate(value: any): string {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
  return date ? date.toLocaleString('tr-TR') : '-';
}

export default function QoreHesaplamaGecmisPanel({ kind }: { kind: HistoryKind }) {
  const cfg = config[kind];
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const { data: testDefinitions = [] } = useTestDefinitions();
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodExport, setPeriodExport] = useState<string>('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const docs = await getScopedDocs(cfg.collection, currentCompanyId, !!isSuperAdmin, orderBy('createdAt', 'desc'));
        if (!alive) return;
        setRecords(docs.map((d) => ({ id: d.id, ...d.data() } as HistoryRecord)));
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Geçmiş kayıtları yüklenemedi.');
        setRecords([]);
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [cfg.collection, currentCompanyId, isSuperAdmin]);

  const selected = useMemo(() => records.find((record) => record.id === selectedId) || records[0] || null, [records, selectedId]);
  const periodOptions = useMemo(() => Array.from(new Set(records.map((record) => record.period || `${record.month ?? '-'}-${record.year ?? '-'}`).filter(Boolean))).sort().reverse(), [records]);

  useEffect(() => {
    if (kind !== 'kumulatif') return;
    setPeriodExport((prev) => (prev && periodOptions.includes(prev) ? prev : periodOptions[0] || ''));
  }, [kind, periodOptions]);


  async function deleteRecord(record: HistoryRecord) {
    if (!window.confirm(`${record.scopeLabel || record.hospitalName || record.hospitalId || 'Seçili'} ${record.period || ''} geçmiş kaydı silinsin mi?`)) return;
    try {
      await deleteDoc(doc(db, cfg.collection, record.id));
      setRecords((prev) => prev.filter((item) => item.id !== record.id));
      setSelectedId((prev) => (prev === record.id ? null : prev));
      toast({ title: 'Geçmiş kaydı silindi' });
    } catch (e: any) {
      toast({ title: 'Silme başarısız', description: e?.message || 'Geçmiş kaydı silinemedi.', variant: 'destructive' });
    }
  }

  function exportRecord(record: HistoryRecord) {
    const data = (record.items || []).map((item) => ({
      'Stok Kodu': item.productId,
      'Stok Adı': item.productName || '',
      'Test Adı': item.testName || '',
      'Eşleşen Dosya Testi': (item.matchedTests || []).join(', '),
      ...(kind === 'kumulatif'
        ? { Routine: item.routine || 0, Rerun: item.rerun || 0, Calib: item.calib || 0, Control: item.control || 0, Total: item.total || 0, 'Verimlilik (%)': getEfficiencyValue(item) ?? '' }
        : { 'Toplam Kullanılabilir': item.value || 0 }),
    }));
    exportDataToExcel(data, `${cfg.sheet}_${record.hospitalName || record.hospitalId || 'Lab'}_${record.period || ''}`, cfg.sheet, toast);
  }



  async function exportPeriodRecords(period: string) {
    if (kind !== 'kumulatif' || !period) return;
    const periodRecords = records.filter((record) => (record.period || `${record.month ?? '-'}-${record.year ?? '-'}`) === period);
    if (!periodRecords.length) {
      toast({ title: 'Veri yok', description: `${period} dönemine ait kümülatif geçmiş kaydı bulunamadı.` });
      return;
    }

    try {
      const ExcelJS = await import('exceljs');
      const fileSaverModule = await import('file-saver');
      const saveAs = fileSaverModule.saveAs || (fileSaverModule as any).default?.saveAs || (fileSaverModule as any).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'QORE';
      workbook.created = new Date();

      const thinBorder = {
        top: { style: 'thin' as const },
        left: { style: 'thin' as const },
        bottom: { style: 'thin' as const },
        right: { style: 'thin' as const },
      };
      const fills = {
        headerPink: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFC7CE' } },
        month: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFFFCC' } },
        titleBlue: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF9CCAE4' } },
        routine: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFDDEBF7' } },
        rerun: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF2CC' } },
        stat: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9D2F4' } },
        calib: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEADCF8' } },
        control: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD5F5F0' } },
        total: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFB4A7F5' } },
        efficiency: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFF4F93' } },
      };

      periodRecords.forEach((record, recordIndex) => {
        const ws = workbook.addWorksheet(toSheetName(record, recordIndex));
        ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 10 }];
        ws.columns = [
          { key: 'sutKodu', width: 18 },
          { key: 'sutTestAdi', width: 38 },
          { key: 'counter', width: 16 },
          { key: 'blank1', width: 4 },
          { key: 'blank2', width: 4 },
          { key: 'stokKodu', width: 18 },
          { key: 'stokAdi', width: 36 },
          { key: 'urunTestAdi', width: 20 },
          { key: 'routine', width: 14 },
          { key: 'rerun', width: 14 },
          { key: 'stat', width: 12 },
          { key: 'calib', width: 12 },
          { key: 'control', width: 12 },
          { key: 'total', width: 12 },
          { key: 'efficiency', width: 14 },
        ];

        // Sol blok: Hak Ediş/Test Yönetimi tanımları (A-C)
        const leftHeader = ws.getRow(1);
        leftHeader.getCell(1).value = 'SUT Kodu';
        leftHeader.getCell(2).value = 'Test Adı';
        leftHeader.getCell(3).value = 'Test Counter';
        [1, 2, 3].forEach((col) => {
          const cell = leftHeader.getCell(col);
          cell.fill = fills.headerPink;
          cell.font = { bold: true };
          cell.alignment = { horizontal: 'center' };
          cell.border = thinBorder;
        });
        testDefinitions.forEach((def: any, index: number) => {
          const row = ws.getRow(index + 2);
          row.getCell(1).value = def.sutKodu || '';
          row.getCell(2).value = def.sutTestAdi || '';
          row.getCell(3).value = Number(def.counterValue || 0);
          [1, 2, 3].forEach((col) => {
            row.getCell(col).border = thinBorder;
            row.getCell(col).alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'center' };
          });
        });

        // Sağ blok: F10'dan başlayan kümülatif ürün verileri
        ws.mergeCells('I1:O1');
        const monthCell = ws.getCell('I1');
        monthCell.value = getPeriodMonthLabel(period);
        monthCell.fill = fills.month;
        monthCell.font = { bold: true, italic: true };
        monthCell.alignment = { horizontal: 'center' };
        monthCell.border = thinBorder;

        ws.mergeCells('F4:O5');
        const titleCell = ws.getCell('F4');
        titleCell.value = `${record.scopeLabel || record.hospitalName || record.hospitalId || 'LAB'} (TOPLAM)`;
        titleCell.fill = fills.titleBlue;
        titleCell.font = { bold: true, size: 14 };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.border = thinBorder;

        const headerRow = ws.getRow(10);
        const headers = ['Stok Kodu', 'Stok Adı', 'Test', 'Routine', 'Rerun', 'Stat', 'Calib.', 'Control', 'Total', '% VERİMLİLİK'];
        headers.forEach((header, index) => {
          const cell = headerRow.getCell(6 + index);
          cell.value = header;
          cell.fill = fills.month;
          cell.font = { bold: true, italic: index >= 2 };
          cell.alignment = { horizontal: 'center' };
          cell.border = thinBorder;
        });

        (record.items || []).forEach((item, index) => {
          const row = ws.getRow(11 + index);
          const efficiency = getEfficiencyValue(item);
          const values = [
            item.productId || '',
            item.productName || '',
            item.testName || '',
            item.routine || 0,
            item.rerun || 0,
            0,
            item.calib || 0,
            item.control || 0,
            item.total || 0,
            efficiency == null ? '' : Math.round(efficiency),
          ];
          values.forEach((value, valueIndex) => {
            const col = 6 + valueIndex;
            const cell = row.getCell(col);
            cell.value = value;
            cell.border = thinBorder;
            cell.alignment = { horizontal: valueIndex <= 2 ? 'left' : 'center' };
            if (valueIndex === 2) cell.font = { bold: true, italic: true };
            if (valueIndex === 3) cell.fill = fills.routine;
            if (valueIndex === 4) cell.fill = fills.rerun;
            if (valueIndex === 5) cell.fill = fills.stat;
            if (valueIndex === 6) cell.fill = fills.calib;
            if (valueIndex === 7) cell.fill = fills.control;
            if (valueIndex === 8) cell.fill = fills.total;
            if (valueIndex === 9) cell.fill = fills.efficiency;
          });
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), `Kumulatif_Donemsel_${period}.xlsx`);
      toast({ title: 'Başarılı', description: `${period} dönemi şirket formatında Excel'e aktarıldı.` });
    } catch (error: any) {
      toast({ title: 'Excel oluşturulamadı', description: error?.message || 'Dönemsel Excel çıktısı hazırlanamadı.', variant: 'destructive' });
    }
  }
  return (
    <div className="p-4 md:p-6 space-y-6">
      <BackButton fallback={cfg.fallback} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Table2 className="h-5 w-5 text-primary" />{cfg.title}</CardTitle>
          <CardDescription>Kaydedilmiş lab/havuz ve dönem bazlı hesaplama kayıtlarını görüntüleyin, detaylarını açın ve Excel'e aktarın.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="destructive"><AlertTitle>Hata</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          {kind === 'kumulatif' && records.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-2 rounded-lg border bg-muted/20 p-3 sm:items-end">
              <div className="min-w-[220px]">
                <label className="text-sm font-medium">Dönemsel toplu Excel</label>
                <Select value={periodExport} onValueChange={setPeriodExport}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Dönem seçin" /></SelectTrigger>
                  <SelectContent>
                    {periodOptions.map((period) => <SelectItem key={period} value={period}>{period}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={() => void exportPeriodRecords(periodExport)} disabled={!periodExport}>
                <Download className="mr-2 h-4 w-4" /> Seçili Dönemi Toplu Excel Al
              </Button>
              <Button asChild variant="outline">
                <Link href="/yonetim/test-yonetimi">Counter / Test Yönetimi</Link>
              </Button>
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…</div>
          ) : records.length === 0 ? (
            <div className="text-sm text-muted-foreground">Henüz kayıt yok.</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.4fr] gap-4">
              <ScrollArea className="h-[55vh] rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow><TableHead>Lab/Havuz</TableHead><TableHead>Dönem</TableHead><TableHead>Satır</TableHead><TableHead>Kayıt</TableHead><TableHead className="w-12" /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((record) => (
                      <TableRow key={record.id} className="cursor-pointer" onClick={() => setSelectedId(record.id)}>
                        <TableCell className="font-medium">{record.scopeLabel || record.hospitalName || record.hospitalId || '-'}</TableCell>
                        <TableCell>{record.period || `${record.month ?? '-'}-${record.year ?? '-'}`}</TableCell>
                        <TableCell>{record.rowCount ?? record.items?.length ?? 0}</TableCell>
                        <TableCell>{formatDate(record.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600"
                            onClick={(event) => { event.stopPropagation(); void deleteRecord(record); }}
                            title="Geçmiş kaydını sil"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>

              {selected && (
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Detay — {selected.scopeLabel || selected.hospitalName || selected.hospitalId}</CardTitle>
                      <CardDescription>{selected.period} • {formatDate(selected.createdAt)}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => exportRecord(selected)}><Download className="mr-2 h-4 w-4" /> Excel</Button>
                      <Button variant="outline" className="text-red-600" onClick={() => void deleteRecord(selected)}><Trash2 className="mr-2 h-4 w-4" /> Sil</Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[48vh] rounded-md border">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow>
                            <TableHead>Stok Kodu</TableHead><TableHead>Stok Adı</TableHead><TableHead>Test Adı</TableHead><TableHead>Eşleşen</TableHead>
                            {kind === 'kumulatif' ? <><TableHead className="text-right">Routine</TableHead><TableHead className="text-right">Rerun</TableHead><TableHead className="text-right">Calib</TableHead><TableHead className="text-right">Control</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Verimlilik (%)</TableHead></> : <TableHead className="text-right">Toplam Kullanılabilir</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(selected.items || []).map((item) => (
                            <TableRow key={`${item.productId}-${item.testName}`}>
                              <TableCell className="font-medium">{item.productId}</TableCell>
                              <TableCell>{item.productName}</TableCell>
                              <TableCell>{item.testName}</TableCell>
                              <TableCell className="text-muted-foreground">{(item.matchedTests || []).join(', ') || '-'}</TableCell>
                              {kind === 'kumulatif' ? <><TableCell className="text-right">{item.routine || 0}</TableCell><TableCell className="text-right">{item.rerun || 0}</TableCell><TableCell className="text-right">{item.calib || 0}</TableCell><TableCell className="text-right">{item.control || 0}</TableCell><TableCell className="text-right font-semibold">{item.total || 0}</TableCell><TableCell className="text-right">{getEfficiencyValue(item)?.toFixed(2) ?? ''}</TableCell></> : <TableCell className="text-right font-semibold">{item.value || 0}</TableCell>}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
