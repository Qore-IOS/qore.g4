
'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  ChangeEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Calculator,
  FileSpreadsheet,
  History as HistoryIcon,
  Save,
  Upload,
  Loader2,
  Download,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';
import type {
  Hospital,
  SummaryRow as SummaryRowType,
  ProductCode,
  LabPool,
  MinMaxRule,
} from '@/lib/types';
import { exportDataToExcel, readExcelData } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { useAuth } from '@/contexts/auth-context';
import { companyQuery } from '@/lib/company-filter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ---- TYPE UPDATES ----

// The table row now represents a product, not a test.
interface SummaryRow extends Omit<SummaryRowType, 'test'> {
  stokKodu: string;
  stokAdi: string;
  routine: number;
  rerun: number;
  calib: number;
  control: number;
  total: number;
}

// ---- CONSTANTS ----
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(0, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

// ---- HELPERS ----

const normalizeName = (s: string) =>
  (s || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

function parseLocaleInt(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return Math.round(val);
  const s = String(val).trim();
  if (s === '') return 0;
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : Math.round(n);
}

// --- COMPONENT ---

export default function KumulatifHesaplamaPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Master Data
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [allMinMaxRules, setAllMinMaxRules] = useState<
    Record<string, MinMaxRule[]>
  >({}); // labId -> rules[]

  // Selections
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(
    new Date().getMonth()
  );
  const [selectedYear, setSelectedYear] = useState<number>(
    new Date().getFullYear()
  );

  // Table Data
  const [resultRows, setResultRows] = useState<SummaryRow[]>([]);

  const selectedHospitalName = useMemo(() => {
    return hospitals.find((h) => h.id === selectedHospitalId)?.name || 'Lab';
  }, [hospitals, selectedHospitalId]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Data Fetching ----

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const [hSnap, pSnap, poolSnap] = await Promise.all([
          getDocs(companyQuery(db, 'hospitals', currentCompanyId, orderBy('name'))),
          getDocs(collection(db, 'productCodes')),
          getDocs(collection(db, 'labPools')),
        ]);

        const fetchedHospitals = hSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Hospital)
        );
        setHospitals(fetchedHospitals);
        setProductCodes(
          pSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductCode))
        );
        setLabPools(
          poolSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LabPool))
        );

        // Fetch all min-max rules for all hospitals at once
        const rulesPromises = fetchedHospitals
          .filter((h) => h.id)
          .map(async (h) => {
          const rulesSnap = await getDocs(
            collection(db, 'hospitals', h.id!, 'minMaxRules')
          );
          return {
            labId: h.id!,
            rules: rulesSnap.docs.map((d) => d.data() as MinMaxRule),
          };
        });

        const rulesResults = await Promise.all(rulesPromises);
        const rulesMap: Record<string, MinMaxRule[]> = {};
        rulesResults.forEach((res) => {
          rulesMap[res.labId] = res.rules;
        });
        setAllMinMaxRules(rulesMap);
      } catch (e) {
        console.error(e);
        toast({
          title: 'Veri Yüklenemedi',
          description: 'Gerekli ana veriler alınırken hata oluştu.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [toast, currentCompanyId]);

  // ---- Product Listing Logic ----

  useEffect(() => {
    if (!selectedHospitalId) {
      setResultRows([]);
      return;
    }

    // 1. Find if the selected lab is a main lab in any pool
    const owningPool = labPools.find(
      (p) => p.mainLabId === selectedHospitalId
    );

    // 2. Determine which lab IDs to get rules from
    const labIdsToScan =
      owningPool?.memberIds && owningPool.memberIds.length > 0
        ? owningPool.memberIds
        : [selectedHospitalId];

    // 3. Aggregate unique stock codes from all those labs
    const relevantStockCodes = new Set<string>();
    labIdsToScan.forEach((labId) => {
      const rules = allMinMaxRules[labId] || [];
      rules.forEach((rule) => {
        if (rule.stokKodu) {
          relevantStockCodes.add(rule.stokKodu);
        }
      });
    });

    if (relevantStockCodes.size === 0) {
      toast({
        title: 'Ürün Tanımı Yok',
        description:
          'Bu laboratuvar (veya havuzu) için tanımlanmış Min-Max kuralı olan ürün bulunamadı.',
        variant: 'default',
      });
    }

    // 4. Create initial rows for the table from these unique stock codes
    const initialRows: SummaryRow[] = Array.from(relevantStockCodes)
      .map((code) => {
        const product = productCodes.find((p) => p.stokKodu === code);
        return {
          stokKodu: code,
          stokAdi: product?.stokAdi || code,
          routine: 0,
          rerun: 0,
          calib: 0,
          control: 0,
          total: 0,
        };
      })
      .sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr'));

    setResultRows(initialRows);
  }, [selectedHospitalId, allMinMaxRules, productCodes, labPools, toast]);

  // ---- Handlers ----
  const handleValueChange = (
    stokKodu: string,
    field: keyof Omit<SummaryRow, 'stokKodu' | 'stokAdi'>,
    value: string
  ) => {
    const numValue = parseInt(value, 10);
    setResultRows((prev) =>
      prev.map((row) =>
        row.stokKodu === stokKodu
          ? { ...row, [field]: isNaN(numValue) ? 0 : numValue }
          : row
      )
    );
  };

  const handleExcelImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!selectedHospitalId || resultRows.length === 0) {
      toast({
        title: 'Önce Laboratuvar/Ürünler',
        description:
          'Excel eşleştirmesi için önce laboratuvar seçip ürün listesinin yüklenmesini bekleyin.',
        variant: 'destructive',
      });
      if (e.target) e.target.value = '';
      return;
    }

    setIsLoading(true);
    try {
      const excelData = await readExcelData(file, toast);
      if (!excelData || excelData.length === 0) {
        throw new Error('Excel dosyasında veri bulunamadı.');
      }

      // --- Header detection & validation
      const headers = Object.keys(excelData[0]);
      const findHeader = (aliases: string[]): string | undefined => {
        for (const alias of aliases) {
          const header = headers.find(
            (h) => normalizeName(h) === normalizeName(alias)
          );
          if (header) return header;
        }
        return undefined;
      };

      const headerMap = {
        // allow both product name and test name as identifier
        test: findHeader([
          'Test',
          'Test Adı',
          'Test Name',
          'Ürün Adı',
          'Urun Adi',
          'Stok Adı',
          'Stok Adi',
        ]),
        stokKodu: findHeader([
          'Stok Kodu',
          'stokKodu',
          'Product Code',
          'Kod',
        ]),
        routine: findHeader(['Routine', 'Rutin']),
        rerun: findHeader(['Rerun', 'Tekrar']),
        calib: findHeader(['Calib', 'Kalibrasyon']),
        control: findHeader(['Control', 'Kontrol']),
        total: findHeader(['Total', 'Toplam']),
      } as const;

      // require at least one identifier column to match: stokKodu or test
      if (!headerMap.stokKodu && !headerMap.test) {
        throw new Error(
          "Excel başlıklarında 'Stok Kodu' veya 'Ürün Adı/Test' sütunu bulunamadı."
        );
      }

      let updatedCount = 0;
      let unmatchedCount = 0;

      const newResultRows = [...resultRows];

      for (const excelRow of excelData) {
        const excelStokKodu = headerMap.stokKodu
          ? String(excelRow[headerMap.stokKodu] ?? '').trim()
          : '';
        const excelTestName = headerMap.test
          ? normalizeName(String(excelRow[headerMap.test] ?? ''))
          : '';

        // find row by stokKodu first; fallback to normalized product name
        let matchIndex = -1;
        if (excelStokKodu) {
          matchIndex = newResultRows.findIndex(
            (row) => row.stokKodu === excelStokKodu
          );
        }
        if (matchIndex === -1 && excelTestName) {
          matchIndex = newResultRows.findIndex(
            (row) => normalizeName(row.stokAdi) === excelTestName
          );
        }

        if (matchIndex === -1) {
          unmatchedCount++;
          continue;
        }

        const routine = parseLocaleInt(
          headerMap.routine ? excelRow[headerMap.routine] : 0
        );
        const rerun = parseLocaleInt(
          headerMap.rerun ? excelRow[headerMap.rerun] : 0
        );
        const calib = parseLocaleInt(
          headerMap.calib ? excelRow[headerMap.calib] : 0
        );
        const control = parseLocaleInt(
          headerMap.control ? excelRow[headerMap.control] : 0
        );
        let total = parseLocaleInt(
          headerMap.total ? excelRow[headerMap.total] : 0
        );

        const sum = routine + rerun + calib + control;
        if (total === 0 && sum > 0) total = sum;

        newResultRows[matchIndex] = {
          ...newResultRows[matchIndex],
          routine,
          rerun,
          calib,
          control,
          total,
        };
        updatedCount++;
      }

      setResultRows(newResultRows);

      toast({
        title: 'Excel aktarımı tamamlandı',
        description: `${updatedCount} ürün güncellendi. ${unmatchedCount} satır eşleşmedi.`,
      });
    } catch (error: any) {
      console.error('Excel import error', error);
      toast({
        title: 'Excel Hatası',
        description:
          error.message || 'Dosya okunurken/işlenirken bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSaveToHistory = useCallback(async () => {
    if (!resultRows.length || !selectedHospitalId) return;
    setIsSaving(true);
    try {
      const summary = resultRows.reduce((acc, row) => {
        // Use stokKodu as the key
        const { stokKodu, stokAdi, ...rest } = row;
        const numericValues = {
          routine: Number(rest.routine || 0),
          rerun: Number(rest.rerun || 0),
          calib: Number(rest.calib || 0),
          control: Number(rest.control || 0),
          total: Number(rest.total || 0),
        };
        acc[stokKodu] = { stokAdi, ...numericValues };
        return acc;
      }, {} as Record<string, Omit<SummaryRow, 'stokKodu'>>);

      await addDoc(collection(db, 'kumulatifRaporlar'), {
        hospitalId: selectedHospitalId,
        hospitalName: selectedHospitalName,
        month: selectedMonth,
        year: selectedYear,
        summary,
        createdAt: serverTimestamp(),
      });

      toast({
        title: 'Geçmişe kaydedildi',
        description: 'Hesaplama sonucu geçmişe eklendi.',
      });
    } catch (e) {
      console.error(e);
      toast({
        title: 'Kayıt Hatası',
        description: 'Geçmişe kaydederken sorun oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    resultRows,
    selectedHospitalId,
    selectedHospitalName,
    selectedMonth,
    selectedYear,
    toast,
  ]);

  const handleDownloadTemplate = () => {
    if (resultRows.length === 0) {
      toast({
        title: 'Önce Laboratuvar Seçin',
        description:
          'Şablon oluşturmak için önce ürün listesinin yüklenmesi gerekir.',
        variant: 'default',
      });
      return;
    }
    // Now use stokAdi for the template
    const templateData = resultRows.map((r) => ({
      'Ürün Adı': r.stokAdi,
      'Stok Kodu': r.stokKodu,
      Routine: '',
      Rerun: '',
      Calib: '',
      Control: '',
      Total: '',
    }));
    exportDataToExcel(
      templateData,
      `Kumulatif_Sablon_${selectedHospitalName}`,
      'Sablon',
      toast
    );
  };

  const exportExcel = useCallback(() => {
    if (resultRows.length === 0) {
      toast({
        title: 'Çıktı Yok',
        description: 'Önce hesaplama yapın.',
        variant: 'destructive',
      });
      return;
    }
    const data = resultRows.map((r) => ({
      'Ürün Adı': r.stokAdi,
      'Stok Kodu': r.stokKodu,
      Routine: r.routine,
      Rerun: r.rerun,
      Calib: r.calib,
      Control: r.control,
      Total: r.total,
    }));
    const fname = `Kumulatif_${selectedHospitalName || 'Lab'}_${String(
      selectedMonth + 1
    ).padStart(2, '0')}-${selectedYear}`;
    exportDataToExcel(data, fname, 'Kumulatif_Rapor', toast);
  }, [resultRows, selectedHospitalName, selectedMonth, selectedYear, toast]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <BackButton fallback="/raporlama" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Kümülatif Hesaplama Aracı
          </CardTitle>
          <CardDescription>
            Laboratuvar ve dönem seçerek kümülatif verileri Excel'den aktarın.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <input
            ref={fileInputRef}
            id="excel-upload"
            type="file"
            className="hidden"
            accept=".xlsx,.xls"
            onChange={handleExcelImport}
          />

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="col-span-1 md:col-span-2">
              <label className="text-sm font-medium">Laboratuvar</label>
              <Select
                value={selectedHospitalId}
                onValueChange={setSelectedHospitalId}
                disabled={isLoading}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue
                    placeholder={isLoading ? 'Yükleniyor...' : 'Seçiniz'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {hospitals.filter((h) => h.id).map((h) => (
                    <SelectItem key={h.id} value={h.id!}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Ay</label>
              <Select
                value={String(selectedMonth)}
                onValueChange={(v) => setSelectedMonth(Number(v))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem
                      key={m.value}
                      value={String(m.value)}
                      className="capitalize"
                    >
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Yıl</label>
              <Select
                value={String(selectedYear)}
                onValueChange={(v) => setSelectedYear(Number(v))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!selectedHospitalId || isLoading}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel İşlemleri
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={handleDownloadTemplate}>
                  <Download className="h-4 w-4 mr-2" />
                  Şablon İndir
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Excel'den Yükle
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="secondary"
              onClick={() => router.push('/kumulatif-gecmis')}
            >
              <HistoryIcon className="h-4 w-4 mr-2" />
              Kümülatif Geçmişi
            </Button>
            <Button
              onClick={handleSaveToHistory}
              disabled={isSaving || resultRows.length === 0}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Geçmişe Kaydet
            </Button>
          </div>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Hesaplama Tablosu</CardTitle>
              <CardDescription>
                {selectedHospitalName
                  ? `${selectedHospitalName} – ${MONTHS[selectedMonth].label} ${selectedYear}`
                  : 'Lütfen bir laboratuvar seçin.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[60vh] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ürün Adı</TableHead>
                      <TableHead>Stok Kodu</TableHead>
                      <TableHead className="w-24 text-right">Routine</TableHead>
                      <TableHead className="w-24 text-right">Rerun</TableHead>
                      <TableHead className="w-24 text-right">Calib</TableHead>
                      <TableHead className="w-24 text-right">Control</TableHead>
                      <TableHead className="w-24 text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center">
                          <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : resultRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="h-24 text-center text-muted-foreground"
                        >
                          Ürünler için laboratuvar seçin.
                        </TableCell>
                      </TableRow>
                    ) : (
                      resultRows.map((r) => (
                        <TableRow key={r.stokKodu}>
                          <TableCell className="font-medium">
                            {r.stokAdi}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {r.stokKodu}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={r.routine}
                              onChange={(e) =>
                                handleValueChange(
                                  r.stokKodu,
                                  'routine',
                                  e.target.value
                                )
                              }
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={r.rerun}
                              onChange={(e) =>
                                handleValueChange(
                                  r.stokKodu,
                                  'rerun',
                                  e.target.value
                                )
                              }
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={r.calib}
                              onChange={(e) =>
                                handleValueChange(
                                  r.stokKodu,
                                  'calib',
                                  e.target.value
                                )
                              }
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={r.control}
                              onChange={(e) =>
                                handleValueChange(
                                  r.stokKodu,
                                  'control',
                                  e.target.value
                                )
                              }
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={r.total}
                              onChange={(e) =>
                                handleValueChange(
                                  r.stokKodu,
                                  'total',
                                  e.target.value
                                )
                              }
                              className="h-8 text-right"
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}

    