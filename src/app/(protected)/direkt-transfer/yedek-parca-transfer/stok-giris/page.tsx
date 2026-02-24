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
import { Input } from '@/components/ui/input';
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
  CheckCircle,
  ChevronLeft,
} from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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

  const isAuthorized = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'lojistik_sorumlusu' || currentUserProfile?.role === 'teknik_lojistik';

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

  // Tab state for manual vs excel
  const [activeTab, setActiveTab] = useState<'manual' | 'excel'>('manual');

  if (loading) {
    return (
      <div className="cihaz-shell flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <div className="cihaz-card-strong p-8 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
          <span style={{ color: 'var(--dashboard-text)' }} className="text-sm font-medium">Yükleniyor…</span>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="cihaz-shell flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <div className="cihaz-card-strong p-8 text-center space-y-3">
          <h2 className="text-lg font-bold" style={{ color: '#B91C1C' }}>Yetkisiz Erişim</h2>
          <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>Bu sayfaya erişim yetkiniz bulunmamaktadır.</p>
          <button onClick={() => router.back()} className="cihaz-tool-item px-4 py-2 text-sm font-medium" style={{ color: 'var(--dashboard-muted)' }}>Geri Dön</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 sm:space-y-5" style={{ minHeight: '100dvh' }}>

      {/* Back */}
      <button
        onClick={() => router.push('/direkt-transfer/yedek-parca-transfer')}
        className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
        style={{ color: 'var(--dashboard-muted)' }}
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Yedek Parça Paneli
      </button>

      {/* Header */}
      <header className="cihaz-card-strong p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,.12)' }}>
            <Package className="w-4.5 h-4.5" style={{ color: 'var(--dashboard-accent)' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--dashboard-text)' }}>Yedek Parça Stok Girişi</h1>
            <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Depoya yeni ürünler ekleyin — manuel veya Excel ile.</p>
          </div>
        </div>
      </header>

      {/* Tab switcher */}
      <div className="cihaz-pressed inline-flex p-1 gap-1" style={{ borderRadius: 14 }}>
        {(['manual', 'excel'] as const).map(tab => {
          const labels = { manual: 'Manuel Giriş', excel: 'Excel ile Giriş' };
          const icons = { manual: <Plus className="w-3.5 h-3.5" />, excel: <FileSpreadsheet className="w-3.5 h-3.5" /> };
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: isActive ? 'var(--dashboard-surface)' : 'transparent',
                color: isActive ? 'var(--dashboard-text)' : 'var(--dashboard-muted)',
                boxShadow: isActive ? 'var(--dashboard-raised-soft)' : 'none',
              }}
            >
              {icons[tab]} {labels[tab]}
            </button>
          );
        })}
      </div>

      {/* ─── Manuel Giriş ─── */}
      {activeTab === 'manual' && (
        <section className="cihaz-card p-4 sm:p-5 space-y-4">
          <p className="cihaz-section-label">Yeni Ürün Ekle</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Product selector */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Yedek Parça *</label>
              <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="cihaz-pressed w-full flex items-center justify-between px-3 py-2.5 text-sm text-left"
                    style={{ borderRadius: 12, color: selectedProduct ? 'var(--dashboard-text)' : 'var(--dashboard-muted)' }}
                  >
                    <span className="truncate">
                      {selectedProduct ? `${selectedProduct.stokKodu} — ${selectedProduct.stokAdi?.substring(0, 20)}` : 'Ürün seçin…'}
                    </span>
                    <Search className="w-3.5 h-3.5 flex-shrink-0 ml-2 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0">
                  <Command>
                    <CommandInput placeholder="Kod veya isim ile ara…" value={productSearchQuery} onValueChange={setProductSearchQuery} />
                    <CommandList>
                      <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                      <CommandGroup>
                        {filteredProducts.map(product => (
                          <CommandItem
                            key={product.id}
                            value={`${product.stokKodu} ${product.stokAdi}`}
                            onSelect={() => { setSelectedProductId(product.id); setProductSearchOpen(false); }}
                          >
                            <div className="flex flex-col">
                              <span className="font-mono font-medium text-sm">{product.stokKodu}</span>
                              <span className="text-xs text-muted-foreground truncate">{product.stokAdi}</span>
                              {product.cihazGrubu && <span className="text-[10px]" style={{ color: 'var(--dashboard-accent)' }}>{product.cihazGrubu}</span>}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedProduct?.cihazGrubu && (
                <p className="text-[10px] font-medium" style={{ color: 'var(--dashboard-accent)' }}>Grup: {selectedProduct.cihazGrubu}</p>
              )}
            </div>

            {/* Serial number */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Seri No (Opsiyonel)</label>
              <Input
                placeholder="Seri numarası"
                value={serialNumber}
                onChange={(e) => handleSerialNumberChange(e.target.value)}
                disabled={!selectedProductId}
                className="cihaz-pressed !border-0 !ring-0 h-10"
                style={{ borderRadius: 12 }}
              />
            </div>

            {/* Quantity */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Adet</label>
              <Input
                type="number"
                min={1}
                value={serialNumber.trim() ? 1 : quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={!selectedProductId || !!serialNumber.trim()}
                className="cihaz-pressed !border-0 !ring-0 h-10"
                style={{ borderRadius: 12 }}
              />
              {serialNumber.trim() && <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>Seri no varsa adet 1.</p>}
            </div>

            {/* Add button */}
            <div className="flex items-end">
              <button
                onClick={addRow}
                disabled={!selectedProductId}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: selectedProductId ? 'var(--dashboard-accent)' : '#9CA3AF', boxShadow: selectedProductId ? 'var(--dashboard-raised-soft)' : 'none' }}
              >
                <Plus className="w-4 h-4" /> Ekle
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ─── Excel Giriş ─── */}
      {activeTab === 'excel' && (
        <section className="cihaz-card p-4 sm:p-5 space-y-4">
          <p className="cihaz-section-label">Excel ile Toplu Stok Girişi</p>

          {/* Rules card */}
          <div className="cihaz-pressed p-3 space-y-1.5" style={{ borderRadius: 14 }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>Şablon formatı:</p>
            <div className="text-[11px] space-y-0.5" style={{ color: 'var(--dashboard-muted)' }}>
              <p>Sütun A: <strong>Stok Kodu</strong> · Sütun B: <strong>Seri No</strong> (opsiyonel) · Sütun C: <strong>Adet</strong></p>
              <p>Seri no varsa adet 1 · İlk satır başlık algılanır · Tanımsız kodlar atlanır</p>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadTemplate} className="cihaz-tool-item inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
              <Download className="w-3.5 h-3.5" /> Şablon İndir
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsingExcel}
              className="cihaz-action-tile inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: 'var(--dashboard-accent)' }}
            >
              {isParsingExcel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Excel Yükle
            </button>
          </div>

          {/* Excel summary + errors */}
          {excelTotalRows > 0 && (excelRows.length > 0 || excelErrors.length > 0) && (
            <div className="cihaz-card p-3 space-y-2" style={{ borderLeft: excelErrors.length > 0 ? '3px solid #B91C1C' : '3px solid #16A34A' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>
                {excelTotalRows} satırdan {excelRows.length} tanesi okundu.
                {excelErrors.length > 0 && ` ${excelErrors.length} satırda sorun.`}
              </p>
              {excelNotFoundProducts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {excelNotFoundProducts.map((code, i) => (
                    <span key={i} className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono font-medium" style={{ background: 'rgba(185,28,28,.10)', color: '#B91C1C' }}>{code}</span>
                  ))}
                </div>
              )}
              {excelErrors.length > 0 && (
                <details className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>
                  <summary className="cursor-pointer hover:underline">Detaylı hatalar ({excelErrors.length})</summary>
                  <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto pl-4 list-disc">
                    {excelErrors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Excel parsed rows preview */}
          {excelRows.length > 0 && (
            <div className="cihaz-card overflow-hidden" style={{ borderLeft: '3px solid #16A34A' }}>
              <div className="flex items-center justify-between p-3" style={{ background: 'rgba(22,163,74,.06)' }}>
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4" style={{ color: '#16A34A' }} />
                  <span className="text-xs font-semibold" style={{ color: '#16A34A' }}>
                    {excelRows.length} satır okundu ({excelRows.reduce((s, r) => s + r.quantity, 0)} adet)
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => { setExcelRows([]); setExcelErrors([]); setExcelNotFoundProducts([]); setExcelTotalRows(0); }} className="cihaz-tool-item px-3 py-1 text-[11px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>İptal</button>
                  <button onClick={confirmExcelRows} className="cihaz-action-tile px-3 py-1 text-[11px] font-semibold text-white" style={{ background: '#16A34A' }}>
                    <Plus className="w-3 h-3 inline mr-0.5" /> Listeye Ekle
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                      <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Kod</th>
                      <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Ürün</th>
                      <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Seri No</th>
                      <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Adet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excelRows.slice(0, 20).map(row => (
                      <tr key={row.id} style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                        <td className="px-3 py-2 font-mono" style={{ color: 'var(--dashboard-text)' }}>{row.stokKodu}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--dashboard-text)' }}>{row.stokAdi}</td>
                        <td className="px-3 py-2 font-mono" style={{ color: row.serialNumber ? 'var(--dashboard-text)' : 'var(--dashboard-muted)' }}>{row.serialNumber || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: 'var(--dashboard-text)' }}>{row.quantity}</td>
                      </tr>
                    ))}
                    {excelRows.length > 20 && (
                      <tr><td colSpan={4} className="px-3 py-2 text-center" style={{ color: 'var(--dashboard-muted)' }}>… ve {excelRows.length - 20} satır daha</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ─── Combined stock entry list ─── */}
      {rows.length > 0 && (
        <section className="cihaz-card-strong overflow-hidden">
          <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--dashboard-text)' }}>Stoğa Eklenecek Ürünler</p>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <span className="cihaz-pressed px-2 py-0.5 text-[10px] font-semibold" style={{ borderRadius: 8, color: 'var(--dashboard-text)' }}>{rows.length} satır</span>
                <span className="cihaz-pressed px-2 py-0.5 text-[10px] font-semibold" style={{ borderRadius: 8, color: 'var(--dashboard-text)' }}>{totalQuantity} adet</span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--dashboard-stroke)', background: 'var(--dashboard-surface-2, var(--dashboard-surface))' }}>
                  <th className="px-3 py-2.5 text-left font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Kod</th>
                  <th className="px-3 py-2.5 text-left font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Ürün Adı</th>
                  <th className="px-3 py-2.5 text-left font-semibold hidden sm:table-cell" style={{ color: 'var(--dashboard-muted)' }}>Grup</th>
                  <th className="px-3 py-2.5 text-left font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Seri No</th>
                  <th className="px-3 py-2.5 text-right font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Adet</th>
                  <th className="px-2 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--dashboard-stroke)' }} className="hover:bg-black/[.02] transition-colors">
                    <td className="px-3 py-2.5 font-mono" style={{ color: 'var(--dashboard-text)' }}>{row.stokKodu}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--dashboard-text)' }}>{row.stokAdi}</td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      {row.cihazGrubu ? (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(245,158,11,.10)', color: '#B45309' }}>{row.cihazGrubu}</span>
                      ) : <span style={{ color: 'var(--dashboard-muted)' }}>—</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono" style={{ color: row.serialNumber ? 'var(--dashboard-text)' : 'var(--dashboard-muted)' }}>{row.serialNumber || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold" style={{ color: 'var(--dashboard-text)' }}>{row.quantity}</td>
                    <td className="px-2 py-2.5">
                      <button onClick={() => removeRow(row.id)} className="p-1 rounded-lg hover:bg-black/5 transition" title="Kaldır">
                        <Trash2 className="w-3.5 h-3.5" style={{ color: '#B91C1C' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sticky save bar */}
          <div className="flex items-center justify-between p-4" style={{ borderTop: '1px solid var(--dashboard-stroke)', background: 'var(--dashboard-surface)' }}>
            <div className="text-[11px] space-y-0.5" style={{ color: 'var(--dashboard-muted)' }}>
              <p>{rows.filter(r => r.serialNumber).length} seri numaralı · {rows.filter(r => !r.serialNumber).length} seri numarasız</p>
            </div>
            <button
              onClick={saveStock}
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#16A34A', boxShadow: 'var(--dashboard-raised-soft)' }}
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Stoğa Kaydet
            </button>
          </div>
        </section>
      )}

      {/* Empty state */}
      {rows.length === 0 && excelRows.length === 0 && (
        <div className="cihaz-card p-8 text-center" style={{ color: 'var(--dashboard-muted)' }}>
          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">Henüz eklenecek ürün yok.</p>
          <p className="text-xs mt-1">Manuel giriş veya Excel yükleme ile başlayın.</p>
        </div>
      )}
    </div>
  );
}
