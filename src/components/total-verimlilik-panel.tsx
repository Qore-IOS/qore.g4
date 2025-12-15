'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { Hospital, ProductCode, EfficiencyPool, LabPool, MinMaxRule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Loader2, BarChart3, FileSpreadsheet, Save } from 'lucide-react';
import { collection, getDocs, query, orderBy, doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import BackButton from '@/components/BackButton';
import { exportDataToExcel } from '@/lib/utils';

interface TotalVerimlilikPanelProps {
  hospitals: Hospital[];
  productCodes: ProductCode[];
}

interface TableRow {
  id: string; // labId-stokKodu kombinasyonu
  labId: string;
  labName: string;
  labKod: string;
  stokKodu: string;
  stokAdi: string;
  testAdi: string;
  ambalajDegeri: number;
  cihazGrubu: string;
  // Manuel giriş alanları
  baslangicStokuKutu: number;
  ayBasiCihazUstuTest: number;
  // Hesaplanan alan
  totalAyBasiStok: number;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' })
}));

export default function TotalVerimlilikPanel({
  hospitals = [],
  productCodes = [],
}: TotalVerimlilikPanelProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();

  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [efficiencyPools, setEfficiencyPools] = useState<EfficiencyPool[]>([]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [allMinMaxRules, setAllMinMaxRules] = useState<Record<string, MinMaxRule[]>>({});

  const [rows, setRows] = useState<TableRow[]>([]);

  // Verimlilik havuzlarını ve ortak lab havuzlarını çek
  useEffect(() => {
    const fetchPools = async () => {
      setIsLoading(true);
      try {
        const [effPoolsSnap, labPoolsSnap] = await Promise.all([
          getDocs(query(collection(db, 'efficiencyPools'), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'labPools')),
        ]);
        setEfficiencyPools(effPoolsSnap.docs.map(d => ({ id: d.id, ...d.data() } as EfficiencyPool)));
        setLabPools(labPoolsSnap.docs.map(d => ({ id: d.id, ...d.data() } as LabPool)));
      } catch (error) {
        console.error('Error fetching pools:', error);
        toast({ title: 'Hata', description: 'Havuzlar yüklenemedi.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    fetchPools();
  }, [toast]);

  // Seçilen havuz değiştiğinde min-max kurallarını çek ve satırları oluştur
  useEffect(() => {
    if (!selectedPoolId) {
      setRows([]);
      return;
    }

    const fetchMinMaxAndBuildRows = async () => {
      setIsLoading(true);
      try {
        const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
        if (!selectedPool) {
          setRows([]);
          return;
        }

        // Önce skip edilecek laboratuvarları belirle
        // Eğer bir laboratuvar bir ortak stok havuzuna dahilse ve o havuzun ana laboratuvarı
        // verimlilik havuzunda ise, bu laboratuvar skip edilmeli (ana lab zaten temsil ediyor)
        const labsToSkip = new Set<string>();

        for (const labId of selectedPool.memberIds) {
          // Bu laboratuvar herhangi bir ortak stok havuzuna dahil mi?
          const sharedPool = labPools.find(p => p.memberIds.includes(labId));

          if (sharedPool && sharedPool.mainLabId) {
            // Bu ortak stok havuzunun ana laboratuvarı verimlilik havuzunda mı?
            if (selectedPool.memberIds.includes(sharedPool.mainLabId)) {
              // Eğer bu laboratuvar ana lab değilse, skip et
              if (labId !== sharedPool.mainLabId) {
                labsToSkip.add(labId);
              }
            }
          }
        }

        // Havuzdaki laboratuvarların ID'lerini al (skip edilenler hariç)
        const labIdsToProcess = new Set<string>();
        const labIdToDisplayName = new Map<string, { name: string; kod: string }>();
        const labIdToMinMaxLabIds = new Map<string, string[]>();

        for (const labId of selectedPool.memberIds) {
          // Skip listesindeki laboratuvarları atla - bunlar zaten ana lab tarafından temsil ediliyor
          if (labsToSkip.has(labId)) continue;

          const lab = hospitals.find(h => h.id === labId);
          if (!lab) continue;

          // Bu laboratuvar bir ortak havuzun ana laboratuvarı mı?
          const sharedPool = labPools.find(p => p.mainLabId === labId);
          if (sharedPool) {
            // Ana laboratuvar olarak görüntüle ama tüm havuz üyelerinin min-max'ını al
            labIdToDisplayName.set(labId, { name: lab.name, kod: lab.kod || '' });
            labIdToMinMaxLabIds.set(labId, sharedPool.memberIds);
            sharedPool.memberIds.forEach(memberId => labIdsToProcess.add(memberId));
          } else {
            labIdsToProcess.add(labId);
            labIdToDisplayName.set(labId, { name: lab.name, kod: lab.kod || '' });
            labIdToMinMaxLabIds.set(labId, [labId]);
          }
        }

        // Min-max kurallarını çek
        const rulesMap: Record<string, MinMaxRule[]> = {};
        for (const labId of labIdsToProcess) {
          try {
            const rulesSnap = await getDocs(collection(db, 'hospitals', labId, 'minMaxRules'));
            rulesMap[labId] = rulesSnap.docs.map(d => ({ stokKodu: d.id, ...d.data() } as MinMaxRule));
          } catch (e) {
            console.error(`Error fetching minMax for ${labId}:`, e);
            rulesMap[labId] = [];
          }
        }
        setAllMinMaxRules(rulesMap);

        // Her laboratuvar için benzersiz ürün listesi oluştur
        const newRows: TableRow[] = [];

        for (const labId of selectedPool.memberIds) {
          // Skip listesindeki laboratuvarları atla
          if (labsToSkip.has(labId)) continue;

          const displayInfo = labIdToDisplayName.get(labId);
          if (!displayInfo) continue;

          // Bu laboratuvar (veya ortak havuz) için tüm min-max ürünlerini topla
          const labIdsForMinMax = labIdToMinMaxLabIds.get(labId) || [labId];

          const uniqueProductCodes = new Set<string>();
          labIdsForMinMax.forEach(lid => {
            const rules = rulesMap[lid] || [];
            rules.forEach(rule => uniqueProductCodes.add(rule.stokKodu));
          });

          // Her ürün için satır oluştur
          const productCodesArray = Array.from(uniqueProductCodes);
          productCodesArray.forEach(stokKodu => {
            const product = productCodes.find(p => p.stokKodu === stokKodu);
            if (!product) return;

            newRows.push({
              id: `${labId}-${stokKodu}`,
              labId: labId,
              labName: displayInfo.name,
              labKod: displayInfo.kod,
              stokKodu: product.stokKodu,
              stokAdi: product.stokAdi,
              testAdi: product.testAdi || '',
              ambalajDegeri: product.ambalajDegeri || 0,
              cihazGrubu: product.cihazGrubu || '',
              baslangicStokuKutu: 0,
              ayBasiCihazUstuTest: 0,
              totalAyBasiStok: 0,
            });
          });
        }

        // Alfabetik sıralama: önce laboratuvar adı, sonra ürün adı
        newRows.sort((a, b) => {
          const labCompare = a.labName.localeCompare(b.labName, 'tr');
          if (labCompare !== 0) return labCompare;
          return a.stokAdi.localeCompare(b.stokAdi, 'tr');
        });

        setRows(newRows);
      } catch (error) {
        console.error('Error building rows:', error);
        toast({ title: 'Hata', description: 'Veriler yüklenirken bir sorun oluştu.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchMinMaxAndBuildRows();
  }, [selectedPoolId, efficiencyPools, labPools, hospitals, productCodes, toast]);

  // Hesaplama fonksiyonu
  const computeRow = useCallback((row: TableRow): TableRow => {
    // Total Ay Başı Stok = (Başlangıç Stoğu Kutu * Ambalaj Değeri) + Ay Başı Cihaz Üstü Test
    const totalAyBasiStok = (row.baslangicStokuKutu * row.ambalajDegeri) + row.ayBasiCihazUstuTest;
    return {
      ...row,
      totalAyBasiStok,
    };
  }, []);

  // Değer değişikliği handler'ı
  const handleValueChange = useCallback((rowId: string, field: 'baslangicStokuKutu' | 'ayBasiCihazUstuTest', value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue)) return;

    setRows(prevRows => {
      return prevRows.map(row => {
        if (row.id !== rowId) return row;
        const updatedRow = { ...row, [field]: numValue };
        return computeRow(updatedRow);
      });
    });
  }, [computeRow]);

  // Excel export
  const handleExportExcel = useCallback(() => {
    if (rows.length === 0) return;

    const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
    const dataToExport = rows.map(r => ({
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
    }));

    const fileName = `Total_Verimlilik_${selectedPool?.name || 'Rapor'}_${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
    exportDataToExcel(dataToExport, fileName, 'Veriler', toast);
  }, [rows, selectedPoolId, efficiencyPools, selectedYear, selectedMonth, toast]);

  // Kaydetme
  const handleSave = useCallback(async () => {
    if (!selectedPoolId || rows.length === 0) return;

    setIsSaving(true);
    try {
      const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
      const docId = `${selectedPoolId}-${selectedYear}-${selectedMonth}`;

      const dataToSave = {
        poolId: selectedPoolId,
        poolName: selectedPool?.name || '',
        month: selectedMonth,
        year: selectedYear,
        rows: rows,
        createdAt: Timestamp.now(),
        createdByUid: currentUser?.uid || '',
        createdByName: currentUser?.name || currentUser?.email || '',
        updatedAt: Timestamp.now(),
      };

      await setDoc(doc(db, 'totalEfficiencyRecords', docId), dataToSave, { merge: true });
      toast({ title: 'Kaydedildi', description: 'Total verimlilik verileri kaydedildi.' });
    } catch (error) {
      console.error('Error saving:', error);
      toast({ title: 'Hata', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [selectedPoolId, rows, selectedYear, selectedMonth, currentUser, efficiencyPools, toast]);

  // Laboratuvar gruplarını hesapla (aynı laboratuvarın satırlarını gruplamak için)
  const labGroups = useMemo(() => {
    const groups: { labId: string; labName: string; startIndex: number; count: number }[] = [];
    let currentLabId = '';
    let startIndex = 0;
    let count = 0;

    rows.forEach((row, index) => {
      if (row.labId !== currentLabId) {
        if (currentLabId) {
          groups.push({ labId: currentLabId, labName: rows[startIndex].labName, startIndex, count });
        }
        currentLabId = row.labId;
        startIndex = index;
        count = 1;
      } else {
        count++;
      }
    });

    if (currentLabId) {
      groups.push({ labId: currentLabId, labName: rows[startIndex].labName, startIndex, count });
    }

    return groups;
  }, [rows]);

  return (
    <div className="p-4 space-y-6">
      <BackButton fallback="/" />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Total Verimlilik Paneli
          </CardTitle>
          <CardDescription>
            Verimlilik havuzundaki laboratuvarların stok doğruluk oranı ve hak ediş verimliliği hesaplaması.
            Tüm veriler manuel olarak girilecektir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Verimlilik Havuzu</label>
              <Select value={selectedPoolId} onValueChange={setSelectedPoolId}>
                <SelectTrigger>
                  <SelectValue placeholder="Havuz seçin..." />
                </SelectTrigger>
                <SelectContent>
                  {efficiencyPools.map(pool => (
                    <SelectItem key={pool.id} value={pool.id}>
                      {pool.name} ({pool.memberIds.length} lab)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Ay</label>
              <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i)}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Yıl</label>
              <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEARS.map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedPoolId && (
            <div className="flex items-center gap-2 pt-4 border-t">
              <Button onClick={handleSave} disabled={isSaving || rows.length === 0}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Kaydet
              </Button>
              <Button variant="outline" onClick={handleExportExcel} disabled={rows.length === 0}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel'e Aktar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedPoolId && (
        <Card>
          <CardHeader>
            <CardTitle>Veri Tablosu</CardTitle>
            <CardDescription>
              İlk 6 sütun otomatik doldurulur. 7-8. sütunlara manuel veri girişi yapın. 9. sütun otomatik hesaplanır.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Bu havuz için min-max tanımlı ürün bulunamadı.
              </div>
            ) : (
              <ScrollArea className="w-full">
                <div className="min-w-[1200px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[180px] bg-muted/50 sticky left-0 z-10">
                          1. Laboratuvar
                        </TableHead>
                        <TableHead className="min-w-[120px]">2. Stok Kodu</TableHead>
                        <TableHead className="min-w-[200px]">3. Ürün Adı</TableHead>
                        <TableHead className="min-w-[150px]">4. Test Adı</TableHead>
                        <TableHead className="min-w-[100px] text-center">5. Ambalaj</TableHead>
                        <TableHead className="min-w-[150px]">6. Cihaz Grubu</TableHead>
                        <TableHead className="min-w-[130px] bg-blue-50 dark:bg-blue-950">
                          7. Başlangıç Stoğu (Kutu)
                        </TableHead>
                        <TableHead className="min-w-[150px] bg-blue-50 dark:bg-blue-950">
                          8. Ay Başı Cihaz Üstü (Test)
                        </TableHead>
                        <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950 text-center">
                          9. Total Ay Başı Stok (Test)
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => {
                        return (
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
                            <TableCell className="text-muted-foreground">{row.testAdi || '-'}</TableCell>
                            <TableCell className="text-center">{row.ambalajDegeri || '-'}</TableCell>
                            <TableCell className="text-muted-foreground">{row.cihazGrubu || '-'}</TableCell>
                            <TableCell className="bg-blue-50/50 dark:bg-blue-950/50">
                              <Input
                                type="number"
                                min="0"
                                className="h-8 w-24"
                                value={row.baslangicStokuKutu || ''}
                                onChange={e => handleValueChange(row.id, 'baslangicStokuKutu', e.target.value)}
                                placeholder="0"
                              />
                            </TableCell>
                            <TableCell className="bg-blue-50/50 dark:bg-blue-950/50">
                              <Input
                                type="number"
                                min="0"
                                className="h-8 w-28"
                                value={row.ayBasiCihazUstuTest || ''}
                                onChange={e => handleValueChange(row.id, 'ayBasiCihazUstuTest', e.target.value)}
                                placeholder="0"
                              />
                            </TableCell>
                            <TableCell className="bg-green-50/50 dark:bg-green-950/50 text-center font-semibold">
                              {row.totalAyBasiStok.toLocaleString('tr-TR')}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      {selectedPoolId && rows.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Toplam {rows.length} satır</span>
              <span>{labGroups.length} laboratuvar</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
