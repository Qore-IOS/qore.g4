
'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { Hospital, ProductCode, ConsumptionRecord, EfficiencyData, KumulatifDataInput, VerimlilikAnalizi, LabPool, MinMaxRule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Download, Calculator, Save, RefreshCw, FileSpreadsheet, Loader2, UploadCloud, CalendarRange, History, BarChart3 } from 'lucide-react';
import { format, getMonth, getYear, isValid, parse, startOfMonth, endOfMonth } from 'date-fns';
import { tr } from 'date-fns/locale';
import { exportDataToExcel } from '@/lib/utils';
import { doc, setDoc, getDocs, collection, Timestamp, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';

interface Row {
  productId: string;
  productName: string;
  packageTests: number;
  packageSize?: number;
  consumption: number;
  carryOverPrev: number;
  total: number;
  rerun: number;
  routine: number;
  control: number;
  calib: number;
  eomDeviceOn: number;
  knownLoss: number;
  unknownLoss: number;
  unknownLossBoxes: number;
  deviceEffPct: number;
  kitEffPct: number;
}

interface VerimlilikHesaplamaPanelProps {
    hospitals: Hospital[];
    productCodes: ProductCode[];
    tuketimKayitlari: ConsumptionRecord[];
    cihazUstuGecmisi: any[];
    kumulatifRaporlar: any[];
    labPools?: LabPool[];
    allMinMaxRules?: Record<string, MinMaxRule[]>;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' })
}));

export default function VerimlilikHesaplamaPanel({
    hospitals = [],
    productCodes = [],
    tuketimKayitlari = [],
    cihazUstuGecmisi,
    kumulatifRaporlar,
    labPools = [],
    allMinMaxRules = {},
}: VerimlilikHesaplamaPanelProps) {
  const { toast } = useToast();
  const router = useRouter();
  
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  
  const [rows, setRows] = useState<Row[]>([]);
  const [sistemTuketimleriDateRange, setSistemTuketimleriDateRange] = useState<{ from?: Date; to?: Date }>({});

  const [isLoading, setIsLoading] = useState(false);
  
  const [isTuketimModalOpen, setIsTuketimModalOpen] = useState(false);
  const [tempFromStr, setTempFromStr] = useState<string>('');
  const [tempToStr, setTempToStr] = useState<string>('');
  
  const toRow = useCallback((p: ProductCode): Row => ({
    productId: p.stokKodu,
    productName: p.stokAdi || p.stokKodu,
    packageTests: p.ambalajDegeri || 0,
    packageSize: 1,
    consumption: 0, carryOverPrev: 0, total: 0,
    rerun: 0, routine: 0, control: 0, calib: 0, eomDeviceOn: 0,
    knownLoss: 0, unknownLoss: 0, unknownLossBoxes: 0,
    deviceEffPct: 0, kitEffPct: 0,
  }), []);
  
  const computeAndApplyChanges = useCallback((prevRows: Row[], productId: string, patch: Partial<Row>): Row[] => {
    const rowIndex = prevRows.findIndex(r => r.productId === productId);
    if (rowIndex === -1) return prevRows;

    const updatedRow = { ...prevRows[rowIndex], ...patch };
    
    const {
      consumption, carryOverPrev, total, rerun, routine, control, calib, eomDeviceOn, packageTests
    } = updatedRow;
    
    const anaTuketim = carryOverPrev + consumption;
    
    updatedRow.knownLoss = control + calib + rerun;
    updatedRow.unknownLoss = Math.max(0, anaTuketim - total);
    
    updatedRow.unknownLossBoxes = packageTests > 0 ? Math.ceil(updatedRow.unknownLoss / packageTests) : 0;
    updatedRow.deviceEffPct = total > 0 ? ((total - rerun - calib - control) / total) * 100 : 0;
    const kitEfficiencyDenominator = anaTuketim - eomDeviceOn;
    updatedRow.kitEffPct = kitEfficiencyDenominator > 0 ? (1 - ((updatedRow.unknownLoss + control + calib) / kitEfficiencyDenominator)) * 100 : 0;

    const newRows = [...prevRows];
    newRows[rowIndex] = updatedRow;
    return newRows;
  }, []);

  const handleValueChange = (productId: string, field: keyof Omit<Row, 'productId' | 'productName' | 'packageTests' | 'packageSize'>, value: string | number) => {
    const numValue = typeof value === 'string' ? (value === '' ? 0 : parseFloat(value)) : value;
    if (isNaN(numValue)) return;
    
    setRows(prevRows => computeAndApplyChanges(prevRows, productId, { [field]: numValue }));
  };


  useEffect(() => {
    if (!selectedHospitalId) {
      setRows([]);
      return;
    }
    const run = async () => {
      setIsLoading(true);
      try {
        const pool = Array.isArray(labPools)
          ? labPools.find(p => Array.isArray(p.memberIds) && p.memberIds.includes(selectedHospitalId))
          : undefined;

        const labIdsToScan = pool?.memberIds?.length ? pool.memberIds : [selectedHospitalId];
          
        const relevantCodes = new Set<string>();
        if (allMinMaxRules && typeof allMinMaxRules === 'object') {
          labIdsToScan.forEach(labId => {
            const rulesForLab = allMinMaxRules[labId] || [];
            if (Array.isArray(rulesForLab)) {
              rulesForLab.forEach(rule => {
                if (rule?.stokKodu) relevantCodes.add(rule.stokKodu);
              });
            }
          });
        }

        let initialRows: Row[] = [];

        if (relevantCodes.size > 0) {
          initialRows = Array.from(relevantCodes).map(code => {
            const prod = productCodes.find(p => p.stokKodu === code);
            return toRow(prod ?? ({ stokKodu: code, stokAdi: code, ambalajDegeri: 0, anaBirim: 'Kutu', urunGrubu: 'kit' } as any));
          });
        } else {
          const kits = productCodes.filter(p => (p as any).urunGrubu === 'kit');
          const base = kits.length > 0 ? kits : productCodes;
          if (base.length === 0) {
            toast({
              title: 'Bilgi',
              description: 'Bu laboratuvar için kural bulunamadı. Ürün listesi boş görünüyor.',
            });
            setRows([]);
            setIsLoading(false);
            return;
          }
          initialRows = base.map(toRow);
        }

        initialRows.sort((a, b) => a.productName.localeCompare(b.productName, 'tr'));
        setRows(initialRows);

      } catch (err) {
        console.error('Error initializing efficiency rows:', err);
        const base = productCodes.filter(p => (p as any).urunGrubu === 'kit');
        setRows((base.length ? base : productCodes).map(toRow).sort((a, b) =>
          a.productName.localeCompare(b.productName, 'tr')
        ));
        toast({ title: 'Hata', description: 'Ürün listesi yüklenemedi. Varsayılan liste gösteriliyor.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    run();
  }, [selectedHospitalId, labPools, allMinMaxRules, productCodes, toRow, toast]);

  const fetchDeviceOnHandForPeriod = useCallback(async (periodKey: string): Promise<Record<string, number> | null> => {
    const record = cihazUstuGecmisi.find(
      (r) => r.hospitalId === selectedHospitalId && (r.period || r.Dönem || r.donem) === periodKey
    );
    if (!record) return null;

    const items = record.items || record.data || [];
    const map: Record<string, number> = {};
    if (Array.isArray(items)) {
      items.forEach((item: any) => {
        if (item.productId && item.value !== undefined) {
          map[item.productId] = Number(item.value);
        }
      });
    }
    return map;
  }, [cihazUstuGecmisi, selectedHospitalId]);


  const handleImportSystemData = useCallback(async () => {
    if (!selectedHospitalId) return;

    const prevDate = new Date(selectedYear, selectedMonth - 1, 1);
    const prevPeriodKey = `${String(prevDate.getMonth() + 1).padStart(2, '0')}-${prevDate.getFullYear()}`;
    const devirData = await fetchDeviceOnHandForPeriod(prevPeriodKey);

    const cumulativeRecord = kumulatifRaporlar.find(r => r.hospitalId === selectedHospitalId && r.month === selectedMonth && r.year === selectedYear);

    setRows(prevRows => {
      let newRows = [...prevRows];
      prevRows.forEach(row => {
        let patch: Partial<Row> = {};
        if (devirData) {
          patch.carryOverPrev = devirData[row.productId] || 0;
        }
        if (cumulativeRecord) {
          const cumulativeItem = cumulativeRecord.summary[row.productId];
          if (cumulativeItem) {
            patch = {
              ...patch,
              total: cumulativeItem?.total || 0,
              rerun: cumulativeItem?.rerun || 0,
              routine: cumulativeItem?.routine || 0,
              control: cumulativeItem?.control || 0,
              calib: cumulativeItem?.calib || 0,
            };
          }
        }
        newRows = computeAndApplyChanges(newRows, row.productId, patch);
      });
      return newRows;
    });

    if (devirData) {
      toast({ title: 'Devir Verisi Aktarıldı', description: `${prevPeriodKey} dönemi için cihaz üstü verileri aktarıldı.` });
    } else {
      toast({ title: 'Devir Verisi Bulunamadı', description: `Önceki dönem (${prevPeriodKey}) için kayıt bulunamadı.`, variant: 'default' });
    }
    if (cumulativeRecord) {
      toast({ title: "Kümülatif Veri Aktarıldı", description: "Seçili dönem için kümülatif veriler içe aktarıldı." });
    } else {
      toast({ title: "Kümülatif Veri Bulunamadı", description: "Seçili dönem için kümülatif veri bulunamadı.", variant: 'default' });
    }
  }, [selectedHospitalId, selectedYear, selectedMonth, fetchDeviceOnHandForPeriod, kumulatifRaporlar, toast, computeAndApplyChanges]);

  const handleImportEOM = useCallback(async () => {
    if (!selectedHospitalId) return;
    const currentPeriodKey = `${String(selectedMonth + 1).padStart(2, '0')}-${selectedYear}`;
    const eomData = await fetchDeviceOnHandForPeriod(currentPeriodKey);
    
    if (eomData) {
      setRows(prevRows => {
        let newRows = [...prevRows];
        prevRows.forEach(row => {
          const eomValue = eomData[row.productId] || 0;
          newRows = computeAndApplyChanges(newRows, row.productId, { eomDeviceOn: eomValue });
        });
        return newRows;
      });
      toast({ title: "Ay Sonu Verisi Aktarıldı", description: `${currentPeriodKey} dönemi için ay sonu cihaz üstü verileri aktarıldı.` });
    } else {
      toast({ title: "Ay Sonu Verisi Bulunamadı", description: `Seçili dönem (${currentPeriodKey}) için kayıt bulunamadı.`, variant: 'default' });
    }
  }, [selectedHospitalId, selectedMonth, selectedYear, fetchDeviceOnHandForPeriod, toast, computeAndApplyChanges]);

  const handleSaveHistory = async () => {
    if (!selectedHospitalId) return;
    setIsLoading(true);
    const labName = hospitals.find(h => h.id === selectedHospitalId)?.name || 'Bilinmeyen Lab';
    const periodId = `${selectedHospitalId}-${selectedYear}-${selectedMonth}`;
    const dataToSave = {
        hospitalId: selectedHospitalId,
        hospitalName: labName,
        month: selectedMonth,
        year: selectedYear,
        lastUpdated: new Date(),
        rows: rows
    };
    try {
        await setDoc(doc(db, "efficiencyHistory", periodId), dataToSave, { merge: true });
        toast({ title: 'Kaydedildi', description: 'Verimlilik analizi geçmişe kaydedildi.' });
    } catch (error) {
        console.error("Failed to save efficiency history:", error);
        toast({ title: 'Hata', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (rows.length === 0) return;
    const dataToExport = rows.map(r => ({
      'Ürün Adı': r.productName,
      'Stok Kodu': r.productId,
      'Tüketim (Test)': r.consumption,
      'Devir Cihaz Üstü': r.carryOverPrev,
      'Total (Kümülatif)': r.total,
      'Tekrar (Kümülatif)': r.rerun,
      'Rutin (Kümülatif)': r.routine,
      'Kontrol (Kümülatif)': r.control,
      'Kalibrasyon (Kümülatif)': r.calib,
      'Ay Sonu Cihaz Üstü': r.eomDeviceOn,
      'Bilinen Fire': r.knownLoss,
      'Bilinmeyen Fire': r.unknownLoss,
      'Bilinmeyen Fire (Kutu)': r.unknownLossBoxes.toFixed(2),
      'Cihaz Verimlilik %': r.deviceEffPct.toFixed(2),
      'Kit Verimliliği %': r.kitEffPct.toFixed(2),
    }));
    exportDataToExcel(dataToExport, `Verimlilik_${selectedHospitalId}_${selectedYear}-${selectedMonth + 1}`, 'Rapor', toast);
  };

  const fmtLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const MM = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const HH = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return `${yyyy}-${MM}-${dd}T${HH}:${mm}`;
  };

  const openTuketimModal = () => {
    const defFrom = sistemTuketimleriDateRange.from ?? new Date(selectedYear, selectedMonth, 1);
    const defTo = sistemTuketimleriDateRange.to ?? new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999);
    setTempFromStr(fmtLocal(defFrom));
    setTempToStr(fmtLocal(defTo));
    setIsTuketimModalOpen(true);
  };

  const handleConfirmTuketimHesapla = () => {
    if (!tempFromStr || !tempToStr) {
      toast({ title: "Eksik Seçim", description: "Başlangıç ve bitiş tarih/saatlerini seçin.", variant: "destructive" });
      return;
    }
    const from = new Date(tempFromStr);
    const to = new Date(tempToStr);
    if (!isValid(from) || !isValid(to) || from > to) {
      toast({ title: "Geçersiz Aralık", description: "Tarih/saat aralığını kontrol edin.", variant: "destructive" });
      return;
    }
    
    const pool = labPools.find(p => p.memberIds.includes(selectedHospitalId));
    const targetLabNames = new Set(
        hospitals
            .filter(h => (pool ? pool.memberIds : [selectedHospitalId]).includes(h.id))
            .map(h => h.name)
    );
  
    const filtered = tuketimKayitlari.filter(rec => {
      if (!targetLabNames.has(rec.laboratoryName)) return false;
      const t = new Date(rec.consumptionTimestamp as any);
      return isValid(t) && t >= from && t <= to;
    });
  
    const totals: Record<string, number> = {};
    filtered.forEach(rec => {
      const product = productCodes.find(p => p.stokKodu === rec.stokKodu);
      const ambalaj = product?.ambalajDegeri || 1;
      const test = rows.find(r => r.productId === rec.stokKodu);
      if(test) {
        totals[test.productId] = (totals[test.productId] || 0) + ambalaj;
      }
    });

    let newRows = [...rows];
    rows.forEach(row => {
      const consumptionValue = totals[row.productId] || 0;
      newRows = computeAndApplyChanges(newRows, row.productId, { consumption: consumptionValue });
    });
    setRows(newRows);
    
    setSistemTuketimleriDateRange({ from, to });
    setIsTuketimModalOpen(false);
    toast({
      title: "Tüketim Hesaplandı",
      description: `${filtered.length} kayıt işlendi. Aralık: ${format(from, 'dd.MM.yyyy HH:mm')} – ${format(to, 'dd.MM.yyyy HH:mm')}`
    });
  };
  
  return (
    <div className="p-4 space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-xl">Verimlilik Analizi (Sistem Verisi)</CardTitle>
            <CardDescription>Sistemdeki verileri kullanarak verimlilik hesaplaması yapın.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => router.push('/verimlilik-istatistikleri')} className="bg-accent text-accent-foreground hover:bg-accent/90">
            <BarChart3 className="mr-2 h-4 w-4" />
            Verimlilik İstatistikleri
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select value={selectedHospitalId} onValueChange={setSelectedHospitalId}>
              <SelectTrigger><SelectValue placeholder="Laboratuvar Seçin..." /></SelectTrigger>
              <SelectContent>{hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{MONTHS.map((m,i) => <SelectItem key={i} value={String(i)}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
             <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button onClick={openTuketimModal} disabled={!selectedHospitalId || isLoading}><CalendarRange className="w-4 h-4 mr-2"/>Tüketim Hesapla</Button>
            <Button onClick={handleImportSystemData} disabled={!selectedHospitalId || isLoading}><RefreshCw className="w-4 h-4 mr-2"/>Sistemden Aktar</Button>
            <Button onClick={handleImportEOM} disabled={!selectedHospitalId || isLoading}><UploadCloud className="w-4 h-4 mr-2"/>Ay Sonu Aktar</Button>
            <div className="ml-auto flex gap-2">
                <Button variant="secondary" onClick={() => router.push('/verimlilik-hesaplama/gecmis')}><History className="w-4 h-4 mr-2"/>Geçmiş</Button>
                <Button onClick={handleSaveHistory} disabled={rows.length === 0 || isLoading}><Save className="w-4 h-4 mr-2"/>Geçmişe Kaydet</Button>
                <Button onClick={handleExportExcel} disabled={rows.length === 0 || isLoading} variant="outline"><FileSpreadsheet className="w-4 h-4 mr-2"/>Excel'e Aktar</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {selectedHospitalId && (
        <Card>
            <CardHeader>
                <CardTitle>Hesaplama Tablosu</CardTitle>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[60vh] w-full">
                <Table>
                    <TableHeader>
                    <TableRow>
                        <TableHead className="min-w-[200px]">Ürün</TableHead>
                        <TableHead>Tüketim</TableHead>
                        <TableHead>Devir</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Tekrar</TableHead>
                        <TableHead>Rutin</TableHead>
                        <TableHead>Kontrol</TableHead>
                        <TableHead>Kalib.</TableHead>
                        <TableHead>Ay Sonu</TableHead>
                        <TableHead>Blnn. Fire</TableHead>
                        <TableHead>Blnmyn. Fire</TableHead>
                        <TableHead>Blnmyn. Fire (Kutu)</TableHead>
                        <TableHead>Cihaz Verim %</TableHead>
                        <TableHead>Kit Verim %</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading && !rows.length ? (
                            <TableRow><TableCell colSpan={14} className="text-center h-24"><Loader2 className="animate-spin mx-auto"/></TableCell></TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow><TableCell colSpan={14} className="text-center h-24">Bu laboratuvar için ürün bulunamadı.</TableCell></TableRow>
                        ) : (
                           rows.map(row => (
                                <TableRow key={row.productId} className="text-xs">
                                    <TableCell className="font-medium">{row.productName} <span className="text-muted-foreground font-mono">({row.productId})</span></TableCell>
                                    <TableCell><Input className="h-7 w-20" type="number" value={row.consumption} onChange={e => handleValueChange(row.productId, 'consumption', e.target.value)}/></TableCell>
                                    <TableCell><Input className="h-7 w-20" type="number" value={row.carryOverPrev} onChange={e => handleValueChange(row.productId, 'carryOverPrev', e.target.value)}/></TableCell>
                                    <TableCell><Input className="h-7 w-20" type="number" value={row.total} onChange={e => handleValueChange(row.productId, 'total', e.target.value)}/></TableCell>
                                    <TableCell><Input className="h-7 w-20" type="number" value={row.rerun} onChange={e => handleValueChange(row.productId, 'rerun', e.target.value)}/></TableCell>
                                    <TableCell><Input className="h-7 w-20" type="number" value={row.routine} onChange={e => handleValueChange(row.productId, 'routine', e.target.value)}/></TableCell>
                                    <TableCell><Input className="h-7 w-20" type="number" value={row.control} onChange={e => handleValueChange(row.productId, 'control', e.target.value)}/></TableCell>
                                    <TableCell><Input className="h-7 w-20" type="number" value={row.calib} onChange={e => handleValueChange(row.productId, 'calib', e.target.value)}/></TableCell>
                                    <TableCell><Input className="h-7 w-20" type="number" value={row.eomDeviceOn} onChange={e => handleValueChange(row.productId, 'eomDeviceOn', e.target.value)}/></TableCell>
                                    <TableCell className="text-orange-600 font-semibold">{row.knownLoss.toFixed(0)}</TableCell>
                                    <TableCell className="text-red-600 font-semibold">{row.unknownLoss.toFixed(0)}</TableCell>
                                    <TableCell className="text-red-600 font-semibold">{row.unknownLossBoxes.toFixed(1)}</TableCell>
                                    <TableCell>{row.deviceEffPct.toFixed(1)}%</TableCell>
                                    <TableCell>{row.kitEffPct.toFixed(1)}%</TableCell>
                                </TableRow>
                           ))
                        )}
                    </TableBody>
                </Table>
                </ScrollArea>
            </CardContent>
        </Card>
      )}

      <Dialog open={isTuketimModalOpen} onOpenChange={setIsTuketimModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tarih & Saat Aralığı Seçin</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Başlangıç</label>
              <Input
                type="datetime-local"
                value={tempFromStr}
                onChange={e => setTempFromStr(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Bitiş</label>
              <Input
                type="datetime-local"
                value={tempToStr}
                onChange={e => setTempToStr(e.target.value)}
              />
            </div>

            <p className="text-muted-foreground text-xs">
              Seçtiğiniz aralıktaki ürün kullanım geçmişine göre test bazlı tüketim hesaplanır.
              Her kayıt 1 kutu olarak kabul edilir, <span className="font-medium">ambalaj test sayısı</span> (productCodes.ambalajDegeri) ile çarpılır.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Vazgeç</Button>
            </DialogClose>
            <Button onClick={handleConfirmTuketimHesapla}>Hesapla</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
