'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  doc,
  Timestamp,
  addDoc,
} from 'firebase/firestore';
import type { ProductCode } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2,
  Package,
  Plus,
  Trash2,
  Search,
  Save,
  FileSpreadsheet,
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  Info,
} from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import BackButton from '@/components/BackButton';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface StokGirisRow {
  id: string;
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  cihazGrubu: string;
  serialNumber: string;
  quantity: number; // seri numarası varsa 1, yoksa kullanıcının girdiği adet
}

export default function YedekParcaStokGirisPage() {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [spareParts, setSpareParts] = useState<ProductCode[]>([]);
  const [rows, setRows] = useState<StokGirisRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // New row state
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [serialNumber, setSerialNumber] = useState('');
  const [quantity, setQuantity] = useState<number>(1);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');

  // Excel import state
  const [excelRows, setExcelRows] = useState<StokGirisRow[]>([]);
  const [excelErrors, setExcelErrors] = useState<string[]>([]);
  const [excelNotFoundProducts, setExcelNotFoundProducts] = useState<string[]>([]);
  const [excelTotalRows, setExcelTotalRows] = useState(0);
  const [isParsingExcel, setIsParsingExcel] = useState(false);

  const isAuthorized = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'lojistik_sorumlusu';

  useEffect(() => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const productsQuery = query(
          collection(db, 'productCodes'),
          where('urunGrubu', '==', 'yedek_parca')
        );
        const productsSnap = await getDocs(productsQuery);
        const sparePartProducts = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ProductCode);
        setSpareParts(sparePartProducts);
      } catch (err) {
        console.error('Error fetching data:', err);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthorized, toast]);

  const filteredProducts = useMemo(() => {
    if (!productSearchQuery) return spareParts.slice(0, 50);
    const q = productSearchQuery.toLowerCase();
    return spareParts
      .filter(p =>
        (p.stokKodu?.toLowerCase().includes(q) || p.stokAdi?.toLowerCase().includes(q))
      )
      .slice(0, 50);
  }, [spareParts, productSearchQuery]);

  const selectedProduct = useMemo(() => {
    return spareParts.find(p => p.id === selectedProductId);
  }, [spareParts, selectedProductId]);

  // Seri numarası girildiğinde adet otomatik 1 olmalı
  const handleSerialNumberChange = (value: string) => {
    setSerialNumber(value);
    if (value.trim()) {
      setQuantity(1);
    }
  };

  const addRow = useCallback(() => {
    if (!selectedProduct) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen bir ürün seçin.', variant: 'destructive' });
      return;
    }

    const sn = serialNumber.trim();
    const qty = sn ? 1 : Math.max(1, Math.floor(quantity));

    // Seri numarası kontrolü
    if (sn && rows.some(r => r.serialNumber === sn)) {
      toast({ title: 'Uyarı', description: 'Bu seri numarası zaten listede var.', variant: 'default' });
      return;
    }

    const newRow: StokGirisRow = {
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      productCodeId: selectedProduct.id,
      stokKodu: selectedProduct.stokKodu || '',
      stokAdi: selectedProduct.stokAdi || '',
      cihazGrubu: selectedProduct.cihazGrubu || '',
      serialNumber: sn,
      quantity: qty,
    };

    setRows(prev => [...prev, newRow]);
    setSerialNumber('');
    setQuantity(1);
    toast({
      title: 'Eklendi',
      description: sn
        ? `${selectedProduct.stokAdi} (SN: ${sn}) listeye eklendi.`
        : `${selectedProduct.stokAdi} x${qty} listeye eklendi.`,
    });
  }, [selectedProduct, serialNumber, quantity, rows, toast]);

  const removeRow = (rowId: string) => {
    setRows(prev => prev.filter(r => r.id !== rowId));
  };

  // Excel şablon indirme
  const downloadTemplate = useCallback(async () => {
    try {
      const XLSX = await import('xlsx');
      const templateData = [
        ['Stok Kodu', 'Seri Numarası', 'Adet'],
        ['ORN-001', 'SN123456', 1],
        ['ORN-002', '', 5],
      ];
      const ws = XLSX.utils.aoa_to_sheet(templateData);
      ws['!cols'] = [{ wch: 20 }, { wch: 25 }, { wch: 10 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Stok Girişi');
      XLSX.writeFile(wb, 'yedek_parca_stok_giris_sablon.xlsx');
    } catch (err) {
      console.error('Template download error:', err);
      toast({ title: 'Hata', description: 'Şablon indirilemedi.', variant: 'destructive' });
    }
  }, [toast]);

  // Excel dosyası yükleme işlemi
  const handleExcelUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsingExcel(true);
    setExcelErrors([]);
    setExcelRows([]);
    setExcelNotFoundProducts([]);
    setExcelTotalRows(0);

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { header: 1 });

      // İlk satır başlık olabilir - kontrol et
      let startRow = 0;
      const firstRow = jsonData[0] as any[];
      if (firstRow && typeof firstRow[0] === 'string') {
        const val = firstRow[0].toLowerCase();
        if (val.includes('stok') || val.includes('kod') || val.includes('ürün') || val.includes('urun')) {
          startRow = 1;
        }
      }

      const errors: string[] = [];
      const parsedRows: StokGirisRow[] = [];
      const notFoundProducts = new Set<string>();

      // Stok kodu -> ProductCode map
      const productMap = new Map<string, ProductCode>();
      spareParts.forEach(p => {
        if (p.stokKodu) productMap.set(p.stokKodu.trim().toUpperCase(), p);
      });

      const seenSerials = new Set<string>();
      let totalDataRows = 0;

      for (let i = startRow; i < jsonData.length; i++) {
        const row = jsonData[i] as any[];
        if (!row || row.length === 0 || !row[0]) continue;

        totalDataRows++;

        const rawStokKodu = String(row[0]).trim();
        const rawSeriNo = row[1] != null ? String(row[1]).trim() : '';
        const rawAdet = row[2] != null ? Number(row[2]) : undefined;

        const stokKoduUpper = rawStokKodu.toUpperCase();
        const product = productMap.get(stokKoduUpper);

        if (!product) {
          notFoundProducts.add(rawStokKodu);
          errors.push(`Satır ${i + 1}: "${rawStokKodu}" stok kodu sistemde tanımlı değil.`);
          continue;
        }

        // Seri numarası varsa adet girilmemeli (veya 1 olmalı)
        if (rawSeriNo) {
          if (rawAdet && rawAdet > 1) {
            errors.push(`Satır ${i + 1}: Seri numarası girildiğinde adet 1 olmalıdır (girilen: ${rawAdet}).`);
            continue;
          }
          // Mükerrer seri no kontrolü
          if (seenSerials.has(rawSeriNo)) {
            errors.push(`Satır ${i + 1}: "${rawSeriNo}" seri numarası dosya içinde mükerrer.`);
            continue;
          }
          seenSerials.add(rawSeriNo);

          parsedRows.push({
            id: `excel_${i}_${Date.now()}`,
            productCodeId: product.id,
            stokKodu: product.stokKodu || '',
            stokAdi: product.stokAdi || '',
            cihazGrubu: product.cihazGrubu || '',
            serialNumber: rawSeriNo,
            quantity: 1,
          });
        } else {
          // Seri numarası yoksa adet zorunlu
          const adet = rawAdet && rawAdet >= 1 ? Math.floor(rawAdet) : 1;
          parsedRows.push({
            id: `excel_${i}_${Date.now()}`,
            productCodeId: product.id,
            stokKodu: product.stokKodu || '',
            stokAdi: product.stokAdi || '',
            cihazGrubu: product.cihazGrubu || '',
            serialNumber: '',
            quantity: adet,
          });
        }
      }

      setExcelRows(parsedRows);
      setExcelErrors(errors);
      setExcelNotFoundProducts(Array.from(notFoundProducts));
      setExcelTotalRows(totalDataRows);

      if (parsedRows.length > 0) {
        const notFoundMsg = notFoundProducts.size > 0
          ? ` ${notFoundProducts.size} ürün sistemde bulunamadı.`
          : '';
        toast({
          title: 'Excel Okundu',
          description: `${totalDataRows} satırdan ${parsedRows.length} tanesi başarıyla okundu.${notFoundMsg}`,
        });
      } else {
        toast({
          title: 'Uyarı',
          description: errors.length > 0 ? 'Dosyadaki hiçbir satır geçerli değil.' : 'Dosya boş veya okunamadı.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Excel parse error:', err);
      toast({ title: 'Hata', description: 'Excel dosyası okunamadı.', variant: 'destructive' });
    } finally {
      setIsParsingExcel(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [spareParts, toast]);

  // Excel satırlarını onaylayıp ana listeye ekle
  const confirmExcelRows = useCallback(() => {
    // Mevcut seri numaralarıyla çakışma kontrolü
    const existingSerials = new Set(rows.filter(r => r.serialNumber).map(r => r.serialNumber));
    const filtered = excelRows.filter(r => {
      if (r.serialNumber && existingSerials.has(r.serialNumber)) return false;
      return true;
    });

    setRows(prev => [...prev, ...filtered]);
    setExcelRows([]);
    setExcelErrors([]);
    setExcelNotFoundProducts([]);
    setExcelTotalRows(0);
    toast({
      title: 'Excel Verileri Eklendi',
      description: `${filtered.length} ürün satırı listeye eklendi.`,
    });
  }, [excelRows, rows, toast]);

  // Toplam adet hesaplama
  const totalQuantity = useMemo(() => {
    return rows.reduce((sum, r) => sum + r.quantity, 0);
  }, [rows]);

  const saveStock = async () => {
    if (rows.length === 0) {
      toast({ title: 'Uyarı', description: 'Eklenecek ürün yok.', variant: 'default' });
      return;
    }

    setIsSaving(true);

    try {
      const batch = writeBatch(db);
      const now = new Date();

      for (const row of rows) {
        if (row.serialNumber) {
          // Seri numaralı: her biri 1 adet olarak ayrı document
          const stockRef = doc(collection(db, 'yedekParcaDepoStok'));
          batch.set(stockRef, {
            productCodeId: row.productCodeId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            cihazGrubu: row.cihazGrubu || '',
            serialNumber: row.serialNumber,
            quantity: 1,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          });
        } else {
          // Seri numarasız: quantity ile tek document
          const stockRef = doc(collection(db, 'yedekParcaDepoStok'));
          batch.set(stockRef, {
            productCodeId: row.productCodeId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            cihazGrubu: row.cihazGrubu || '',
            serialNumber: '',
            quantity: row.quantity,
            createdAt: Timestamp.fromDate(now),
            createdByUid: currentUserProfile?.uid || '',
            createdByName: currentUserProfile?.name || '',
          });
        }
      }

      await batch.commit();

      // Log kaydı oluştur - her satır için ayrı log
      for (const row of rows) {
        await addDoc(collection(db, 'yedekParcaDepoLog'), {
          action: 'stok_giris',
          productCodeId: row.productCodeId,
          stokKodu: row.stokKodu,
          stokAdi: row.stokAdi,
          cihazGrubu: row.cihazGrubu || '',
          serialNumber: row.serialNumber || '',
          quantity: row.serialNumber ? 1 : row.quantity,
          notes: row.serialNumber
            ? `Seri numaralı stok girişi: ${row.serialNumber}`
            : `${row.quantity} adet stok girişi`,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
      }

      toast({
        title: 'Stok Girişi Tamamlandı',
        description: `${totalQuantity} adet yedek parça (${rows.length} satır) depoya eklendi.`,
      });

      setRows([]);
    } catch (err) {
      console.error('Error saving stock:', err);
      toast({ title: 'Hata', description: 'Stok girişi sırasında hata oluştu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  // Excel ile toplu kaydetme
  const saveExcelStock = async () => {
    if (excelRows.length === 0) return;
    // Excel satırlarını ana rows'a ekle ve kaydet
    const allRows = [...rows, ...excelRows];
    setRows(allRows);
    setExcelRows([]);
    setExcelErrors([]);
    setExcelNotFoundProducts([]);
    setExcelTotalRows(0);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Yükleniyor...</span>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold text-destructive">Yetkisiz Erişim</h2>
        <p className="text-muted-foreground mt-2">
          Bu sayfaya erişim yetkiniz bulunmamaktadır.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>
          Geri Dön
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/direkt-transfer/yedek-parca-transfer" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Yedek Parça Stok Girişi
          </CardTitle>
          <CardDescription>
            Yedek parça deposuna yeni ürünler ekleyin. Manuel veya Excel ile toplu giriş yapabilirsiniz.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="manual">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">
                <Plus className="h-4 w-4 mr-2" />
                Manuel Giriş
              </TabsTrigger>
              <TabsTrigger value="excel">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel ile Giriş
              </TabsTrigger>
            </TabsList>

            {/* Manuel Giriş Tab */}
            <TabsContent value="manual" className="space-y-4 mt-4">
              <div className="p-4 border rounded-lg bg-muted/30 space-y-4">
                <Label className="font-semibold">Yeni Ürün Ekle</Label>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Product selector */}
                  <div className="space-y-2">
                    <Label>Yedek Parça</Label>
                    <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between"
                        >
                          {selectedProduct
                            ? `${selectedProduct.stokKodu} - ${selectedProduct.stokAdi?.substring(0, 15)}...`
                            : 'Ürün seçin...'}
                          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0">
                        <Command>
                          <CommandInput
                            placeholder="Kod veya isim ile ara..."
                            value={productSearchQuery}
                            onValueChange={setProductSearchQuery}
                          />
                          <CommandList>
                            <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                            <CommandGroup>
                              {filteredProducts.map((product) => (
                                <CommandItem
                                  key={product.id}
                                  value={`${product.stokKodu} ${product.stokAdi}`}
                                  onSelect={() => {
                                    setSelectedProductId(product.id);
                                    setProductSearchOpen(false);
                                  }}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">{product.stokKodu}</span>
                                    <span className="text-sm text-muted-foreground truncate">
                                      {product.stokAdi}
                                    </span>
                                    {product.cihazGrubu && (
                                      <span className="text-xs text-blue-500">
                                        {product.cihazGrubu}
                                      </span>
                                    )}
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Serial number input (optional) */}
                  <div className="space-y-2">
                    <Label>Seri Numarası (Opsiyonel)</Label>
                    <Input
                      placeholder="Seri numarasını girin"
                      value={serialNumber}
                      onChange={(e) => handleSerialNumberChange(e.target.value)}
                      disabled={!selectedProductId}
                    />
                  </div>

                  {/* Quantity input */}
                  <div className="space-y-2">
                    <Label>Adet</Label>
                    <Input
                      type="number"
                      min={1}
                      value={serialNumber.trim() ? 1 : quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      disabled={!selectedProductId || !!serialNumber.trim()}
                    />
                    {serialNumber.trim() && (
                      <p className="text-xs text-muted-foreground">Seri numaralı ürünlerde adet 1 olmalıdır.</p>
                    )}
                  </div>

                  {/* Add button */}
                  <div className="flex items-end">
                    <Button
                      onClick={addRow}
                      disabled={!selectedProductId}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Satır Ekle
                    </Button>
                  </div>
                </div>

                {selectedProduct?.cihazGrubu && (
                  <div className="flex items-center gap-2 text-sm text-blue-600">
                    <Info className="h-4 w-4" />
                    Cihaz Ana Grubu: <strong>{selectedProduct.cihazGrubu}</strong>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Excel Giriş Tab */}
            <TabsContent value="excel" className="space-y-4 mt-4">
              <div className="p-4 border rounded-lg bg-muted/30 space-y-4">
                <Label className="font-semibold">Excel ile Toplu Stok Girişi</Label>
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-1">Excel Şablon Formatı:</p>
                    <p className="text-sm">Sütun A: <strong>Stok Kodu</strong> | Sütun B: <strong>Seri Numarası</strong> (opsiyonel) | Sütun C: <strong>Adet</strong></p>
                    <ul className="text-sm mt-2 space-y-1 list-disc list-inside">
                      <li>Seri numarası girilmişse adet otomatik 1 kabul edilir.</li>
                      <li>Seri numarası girilmemişse adet sütunundaki değer kullanılır.</li>
                      <li>İlk satır başlık satırı olabilir (otomatik algılanır).</li>
                    </ul>
                  </AlertDescription>
                </Alert>

                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    onClick={downloadTemplate}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Şablon İndir
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleExcelUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isParsingExcel}
                  >
                    {isParsingExcel ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    Excel Dosyası Yükle
                  </Button>
                </div>

                {/* Excel summary + errors */}
                {excelTotalRows > 0 && (excelRows.length > 0 || excelErrors.length > 0) && (
                  <Alert variant={excelErrors.length > 0 ? 'destructive' : 'default'}>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="space-y-2">
                      <p className="font-medium">
                        Excel&apos;deki {excelTotalRows} üründen {excelRows.length} tanesi sisteme eklendi.
                        {excelErrors.length > 0 && ` ${excelErrors.length} satırda sorun tespit edildi.`}
                      </p>

                      {excelNotFoundProducts.length > 0 && (
                        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md p-3">
                          <p className="text-sm font-medium mb-1">
                            Sistemde bulunamayan ürünler ({excelNotFoundProducts.length}):
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {excelNotFoundProducts.map((code, i) => (
                              <Badge key={i} variant="destructive" className="font-mono text-xs">
                                {code}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {excelErrors.length > 0 && (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Detaylı hata listesi ({excelErrors.length} satır)
                          </summary>
                          <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto pl-4 list-disc">
                            {excelErrors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Excel parsed rows preview */}
                {excelRows.length > 0 && (
                  <div className="border rounded-lg">
                    <div className="p-3 bg-green-50 dark:bg-green-950 border-b flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium text-green-700 dark:text-green-300">
                          {excelRows.length} satır başarıyla okundu (Toplam {excelRows.reduce((s, r) => s + r.quantity, 0)} adet)
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setExcelRows([]); setExcelErrors([]); setExcelNotFoundProducts([]); setExcelTotalRows(0); }}>
                          İptal
                        </Button>
                        <Button size="sm" onClick={confirmExcelRows}>
                          <Plus className="h-4 w-4 mr-1" />
                          Listeye Ekle
                        </Button>
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ürün Kodu</TableHead>
                          <TableHead>Ürün Adı</TableHead>
                          <TableHead>Cihaz Grubu</TableHead>
                          <TableHead>Seri No</TableHead>
                          <TableHead>Adet</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {excelRows.slice(0, 20).map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="font-mono text-sm">{row.stokKodu}</TableCell>
                            <TableCell className="text-sm">{row.stokAdi}</TableCell>
                            <TableCell>
                              {row.cihazGrubu ? (
                                <Badge variant="outline" className="text-xs">{row.cihazGrubu}</Badge>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{row.serialNumber || '-'}</TableCell>
                            <TableCell className="font-mono">{row.quantity}</TableCell>
                          </TableRow>
                        ))}
                        {excelRows.length > 20 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                              ... ve {excelRows.length - 20} satır daha
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Combined stock entry list */}
          {rows.length > 0 && (
            <div className="border rounded-lg">
              <div className="p-3 border-b bg-muted/30">
                <span className="font-medium text-sm">Stoğa Eklenecek Ürünler</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ürün Kodu</TableHead>
                    <TableHead>Ürün Adı</TableHead>
                    <TableHead>Cihaz Grubu</TableHead>
                    <TableHead>Seri No</TableHead>
                    <TableHead>Adet</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono">{row.stokKodu}</TableCell>
                      <TableCell>{row.stokAdi}</TableCell>
                      <TableCell>
                        {row.cihazGrubu ? (
                          <Badge variant="outline" className="text-xs">{row.cihazGrubu}</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="font-mono">{row.serialNumber || '-'}</TableCell>
                      <TableCell className="font-mono">{row.quantity}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow(row.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="p-4 border-t flex justify-between items-center">
                <div className="text-sm text-muted-foreground space-y-0.5">
                  <p>{rows.length} satır, toplam <strong>{totalQuantity}</strong> adet ürün eklenecek</p>
                  <p>{rows.filter(r => r.serialNumber).length} seri numaralı, {rows.filter(r => !r.serialNumber).length} seri numarasız</p>
                </div>
                <Button onClick={saveStock} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Stoğa Kaydet
                </Button>
              </div>
            </div>
          )}

          {rows.length === 0 && excelRows.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>Henüz eklenecek ürün yok.</p>
              <p className="text-sm">Manuel giriş veya Excel yükleme ile ürün ekleyin.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
