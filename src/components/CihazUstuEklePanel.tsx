'use client';

import React, { useState, useEffect, useCallback, ChangeEvent, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Loader2, PackagePlus, Save, Upload, Download, FileSpreadsheet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, setDoc, Timestamp, query, where, orderBy } from 'firebase/firestore';
import type { Hospital, ProductCode, TestDefinition, MinMaxRule, LabPool } from '@/lib/types';
import BackButton from './BackButton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { exportDataToExcel, readExcelData } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, filterByAssignedLabs, withCompanyScope } from '@/lib/company-scope';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Row {
  productId: string; // Changed from testId to productId (stokKodu)
  productName: string;
  value: number | string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

// helpers
const normalize = (s: any) => String(s ?? '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
const parseLocaleInt = (v: any) => {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
};


export default function CihazUstuEklePanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();
  const assignedLabs = currentUserProfile?.assignedLaboratories;
  const [loading, setLoading] = useState(true);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [allMinMaxRules, setAllMinMaxRules] = useState<Record<string, MinMaxRule[]>>({});

  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [rows, setRows] = useState<Row[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [hSnap, pSnap, poolSnap] = await Promise.all([
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'productCodes')),
          getDocs(collection(db, 'labPools')),
        ]);
        
        const allHospitals = hSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital));
        const scopedHospitals = filterByCompanyScope(allHospitals, currentCompanyId, isSuperAdmin);
        const fetchedHospitals = filterByAssignedLabs(scopedHospitals, assignedLabs, {
          labIdFields: ['id'],
          isSuperAdmin,
        });
        setHospitals(fetchedHospitals);
        setProductCodes(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
        const allLabPools = poolSnap.docs.map(d => ({ id: d.id, ...d.data() } as LabPool));
        setLabPools(filterByCompanyScope(allLabPools, currentCompanyId, isSuperAdmin));

        const rulesPromises = fetchedHospitals.map(async (h) => {
          const rulesSnap = await getDocs(collection(db, 'hospitals', h.id, 'minMaxRules'));
          return {
            labId: h.id,
            rules: rulesSnap.docs.map((d) => d.data() as MinMaxRule),
          };
        });
        const rulesResults = await Promise.all(rulesPromises);
        const rulesMap: Record<string, MinMaxRule[]> = {};
        rulesResults.forEach((res) => { rulesMap[res.labId] = res.rules; });
        setAllMinMaxRules(rulesMap);

      } catch (e) {
        toast({ title: 'Hata', description: 'Ana veriler yüklenemedi.', variant: 'destructive' });
      }
      setLoading(false);
    })();
  }, [toast, currentCompanyId, isSuperAdmin, assignedLabs]);

  useEffect(() => {
    if (!selectedHospitalId) {
      setRows([]);
      return;
    }
    const fetchAndSetRows = async () => {
      setLoading(true);
      try {
        // --- START NEW LOGIC ---
        const owningPool = labPools.find(p => p.mainLabId === selectedHospitalId);
        const labIdsToScan = owningPool?.memberIds && owningPool.memberIds.length > 0
          ? owningPool.memberIds
          : [selectedHospitalId];
          
        const relevantStockCodes = new Set<string>();
        labIdsToScan.forEach(labId => {
          const rules = allMinMaxRules[labId] || [];
          rules.forEach(rule => { if (rule.stokKodu) relevantStockCodes.add(rule.stokKodu); });
        });
        // --- END NEW LOGIC ---

        const period = `${String(selectedMonth + 1).padStart(2, '0')}-${selectedYear}`;
        const dataSnap = await getDocs(query(collection(db, 'cihazUstuGecmisi'), where('hospitalId', '==', selectedHospitalId), where('period', '==', period)));
        
        const existingData: Record<string, number> = {};
        if (!dataSnap.empty) {
            const items = dataSnap.docs[0].data().items || [];
            items.forEach((item: { productId: string; value: number }) => {
                if(item.productId) existingData[item.productId] = item.value;
            });
        }
        
        const initialRows = Array.from(relevantStockCodes).map(stokKodu => {
            const product = productCodes.find(p => p.stokKodu === stokKodu);
            return {
                productId: stokKodu,
                productName: product?.stokAdi || stokKodu,
                value: existingData[stokKodu] ?? '',
            };
        }).sort((a,b) => a.productName.localeCompare(b.productName));

        setRows(initialRows);

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    fetchAndSetRows();
  }, [selectedHospitalId, selectedMonth, selectedYear, productCodes, toast, labPools, allMinMaxRules]);


  const handleValueChange = (productId: string, value: string) => {
    const numValue = value === '' ? '' : Number(value);
    if (isNaN(Number(numValue))) return;
    setRows(prev => prev.map(r => r.productId === productId ? { ...r, value: numValue } : r));
  };
  
  const handleSave = async () => {
    if (!selectedHospitalId) return;
    setIsSaving(true);
    try {
        const period = `${String(selectedMonth + 1).padStart(2, '0')}-${selectedYear}`;
        const docId = `${selectedHospitalId}_${period}`;
        
        const dataToSave = withCompanyScope({
            hospitalId: selectedHospitalId,
            hospitalName: hospitals.find(h => h.id === selectedHospitalId)?.name || '',
            period: period,
            month: selectedMonth,
            year: selectedYear,
            createdAt: Timestamp.now(),
            items: rows.map(r => ({ productId: r.productId, productName: r.productName, value: Number(r.value || 0) })),
        }, currentCompanyId);

        await setDoc(doc(db, 'cihazUstuGecmisi', docId), dataToSave, { merge: true });
        toast({ title: 'Başarılı', description: 'Cihaz üstü stok verileri kaydedildi.' });

    } catch (error) {
        console.error('Error saving on-device stock:', error);
        toast({ title: 'Hata', description: 'Veriler kaydedilemedi.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };

  const handleDownloadTemplate = () => {
    if (rows.length === 0) {
      toast({ title: "Uyarı", description: "Önce laboratuvar seçerek ürün listesini yükleyin.", variant: "default" });
      return;
    }
    const templateData = rows.map(r => ({ 'Ürün Kodu': r.productId, 'Ürün Adı': r.productName, 'Adet': '' }));
    exportDataToExcel(templateData, "CihazUstu_Sablon", "Sablon", toast);
  };

  const handleExcelImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = await readExcelData(file, toast);
      if (!Array.isArray(data) || data.length === 0) {
        toast({ title: "Excel Hatası", description: "Dosyada satır bulunamadı.", variant: "destructive" });
        return;
      }
      
      const headers = Object.keys(data[0] || {});
      const findHeader = (aliases: string[]) => {
        return headers.find(h => aliases.map(normalize).includes(normalize(h)));
      };

      const hProductCode = findHeader(['Ürün Kodu', 'Urun Kodu', 'Stok Kodu', 'Product Code', 'Code', 'SKU']);
      const hProductName = findHeader(['Ürün Adı', 'Urun Adi', 'Product Name', 'Adı', 'Ad']);
      const hQty        = findHeader(['Adet', 'Miktar', 'Quantity', 'Qty']);

      if (!hQty || (!hProductCode && !hProductName)) {
        toast({
          title: 'Başlık Eşleşmedi',
          description: "Excel'de en azından 'Adet' ve 'Ürün Kodu' veya 'Ürün Adı' sütunu olmalı.",
          variant: 'destructive'
        });
        return;
      }

      const newRows = [...rows];
      let updatedCount = 0;
      let unmatchedCount = 0;

      for (const r of data) {
        const code = hProductCode ? String(r[hProductCode] ?? '').trim() : '';
        const name = hProductName ? normalize(r[hProductName]) : '';
        const qty  = parseLocaleInt(r[hQty]);

        let idx = -1;
        if (code) idx = newRows.findIndex(x => x.productId === code);
        if (idx === -1 && name) idx = newRows.findIndex(x => normalize(x.productName) === name);

        if (idx === -1) {
          unmatchedCount++;
          continue;
        }

        newRows[idx] = { ...newRows[idx], value: qty };
        updatedCount++;
      }
      
      setRows(newRows);
      toast({ title: "Başarılı", description: `${updatedCount} ürün güncellendi, ${unmatchedCount} satır eşleşmedi.` });

    } catch (error) {
      toast({ title: "Excel Hatası", description: "Dosya okunurken bir hata oluştu.", variant: "destructive" });
    } finally {
        if(event.target) (event.target as HTMLInputElement).value = '';
    }
  };


  return (
    <div className="p-4 space-y-4">
      <input
        ref={fileInputRef}
        id="excel-upload"
        type="file"
        className="hidden"
        accept=".xlsx,.xls"
        onChange={handleExcelImport}
      />
      <BackButton fallback="/raporlama" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PackagePlus className="h-5 w-5" /> Cihaz Üstü Stok Girişi</CardTitle>
          <CardDescription>Belirtilen dönem için cihaz üzerindeki test adetlerini girin.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select value={selectedHospitalId} onValueChange={setSelectedHospitalId}>
              <SelectTrigger><SelectValue placeholder="Laboratuvar Seçin..." /></SelectTrigger>
              <SelectContent>{hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
             <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><FileSpreadsheet className="mr-2 h-4 w-4"/>Excel İşlemleri</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={handleDownloadTemplate}><Download className="mr-2 h-4 w-4"/>Şablon İndir</DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); fileInputRef.current?.click(); }}>
                    <Upload className="mr-2 h-4 w-4" />Dosyayı İçeri Aktar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          <ScrollArea className="h-96 border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ürün Adı</TableHead>
                  <TableHead>Stok Kodu</TableHead>
                  <TableHead className="w-48 text-right">Adet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !rows.length ? (
                    <TableRow><TableCell colSpan={3} className="text-center h-24"><Loader2 className="animate-spin mx-auto"/></TableCell></TableRow>
                ) : rows.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center h-24 text-muted-foreground">Başlamak için laboratuvar seçin veya bu laboratuvar için ürün tanımı bulunamadı.</TableCell></TableRow>
                ) : (
                    rows.map(row => (
                        <TableRow key={row.productId}>
                            <TableCell>{row.productName}</TableCell>
                            <TableCell className="font-mono text-xs">{row.productId}</TableCell>
                            <TableCell className="text-right">
                                <Input
                                    type="number"
                                    value={row.value}
                                    onChange={(e) => handleValueChange(row.productId, e.target.value)}
                                    className="h-8 text-right"
                                    min="0"
                                />
                            </TableCell>
                        </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
        <CardFooter>
            <Button onClick={handleSave} disabled={isSaving || rows.length === 0}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                Kaydet
            </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
