'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Loader2, Coins, Upload, Download, Search } from 'lucide-react';
import { collection, getDocs, addDoc, deleteDoc, doc, query, orderBy, writeBatch, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { ProductCode } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';

interface HakEdisDefinition {
  id: string;
  sutKodu: string;
  sutTestAdi: string;
  linkedStokKodu: string;
  hakEdisMiktari: number; // TL cinsinden
}

export default function HakEdisPage() {
  const { toast } = useToast();

  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [hakEdisDefinitions, setHakEdisDefinitions] = useState<HakEdisDefinition[]>([]);

  const [loading, setLoading] = useState({ products: true, definitions: true });

  // Yeni satır ekleme state'leri
  const [newSutKodu, setNewSutKodu] = useState('');
  const [newSutTestAdi, setNewSutTestAdi] = useState('');
  const [newLinkedStokKodu, setNewLinkedStokKodu] = useState('');
  const [newHakEdisMiktari, setNewHakEdisMiktari] = useState('');
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Arama
  const [searchTerm, setSearchTerm] = useState('');

  // Excel import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Döviz kurları
  const [exchangeRates, setExchangeRates] = useState<{ EUR: number; USD: number; TRY: number } | null>(null);

  // Fetch product codes and hak ediş definitions
  useEffect(() => {
    const fetchData = async () => {
      setLoading({ products: true, definitions: true });
      try {
        const [productsSnap, hakEdisSnap] = await Promise.all([
          getDocs(query(collection(db, 'productCodes'), orderBy('stokAdi', 'asc'))),
          getDocs(query(collection(db, 'hakEdisDefinitions'), orderBy('sutKodu', 'asc'))),
        ]);
        setProductCodes(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
        setHakEdisDefinitions(hakEdisSnap.docs.map(d => ({ id: d.id, ...d.data() } as HakEdisDefinition)));
      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading({ products: false, definitions: false });
      }
    };
    fetchData();
  }, [toast]);

  // Fetch exchange rates
  useEffect(() => {
    const fetchRates = async () => {
      const CACHE_KEY = 'exchange_rates_cache';
      const CACHE_TTL = 1000 * 60 * 60; // 1 saat

      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const { rates, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_TTL) {
            setExchangeRates(rates);
            return;
          }
        } catch (e) {}
      }

      try {
        const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD,TRY');
        if (res.ok) {
          const data = await res.json();
          const rates = { EUR: 1, USD: data.rates.USD, TRY: data.rates.TRY };
          setExchangeRates(rates);
          localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, timestamp: Date.now() }));
        }
      } catch (e) {
        setExchangeRates({ EUR: 1, USD: 1.08, TRY: 38.5 });
      }
    };
    fetchRates();
  }, []);

  const handleAddDefinition = async () => {
    if (!newSutKodu.trim() || !newSutTestAdi.trim() || !newLinkedStokKodu.trim() || !newHakEdisMiktari.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Tüm alanlar doldurulmalıdır.', variant: 'destructive' });
      return;
    }

    const hakEdis = parseFloat(newHakEdisMiktari.replace(',', '.'));
    if (isNaN(hakEdis) || hakEdis <= 0) {
      toast({ title: 'Geçersiz Değer', description: 'Hak ediş miktarı geçerli bir sayı olmalıdır.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const docRef = await addDoc(collection(db, 'hakEdisDefinitions'), {
        sutKodu: newSutKodu.trim(),
        sutTestAdi: newSutTestAdi.trim(),
        linkedStokKodu: newLinkedStokKodu.trim(),
        hakEdisMiktari: hakEdis,
      });

      setHakEdisDefinitions(prev => [...prev, {
        id: docRef.id,
        sutKodu: newSutKodu.trim(),
        sutTestAdi: newSutTestAdi.trim(),
        linkedStokKodu: newLinkedStokKodu.trim(),
        hakEdisMiktari: hakEdis,
      }].sort((a, b) => a.sutKodu.localeCompare(b.sutKodu)));

      toast({ title: 'Başarılı', description: 'Hak ediş tanımı eklendi.' });
      setNewSutKodu('');
      setNewSutTestAdi('');
      setNewLinkedStokKodu('');
      setNewHakEdisMiktari('');
    } catch (error) {
      console.error("Error adding definition:", error);
      toast({ title: 'Hata', description: 'Tanım eklenemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDefinition = async (id: string) => {
    if (!confirm('Bu hak ediş tanımını silmek istediğinizden emin misiniz?')) return;

    try {
      await deleteDoc(doc(db, 'hakEdisDefinitions', id));
      setHakEdisDefinitions(prev => prev.filter(d => d.id !== id));
      toast({ title: 'Silindi', description: 'Hak ediş tanımı silindi.' });
    } catch (error) {
      console.error("Error deleting definition:", error);
      toast({ title: 'Hata', description: 'Tanım silinemedi.', variant: 'destructive' });
    }
  };

  const handleExcelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

      // İlk satır başlık, atla
      const rows = jsonData.slice(1).filter(row => row.length >= 4 && row[0]);

      if (rows.length === 0) {
        toast({ title: 'Uyarı', description: 'Excel dosyasında geçerli veri bulunamadı.', variant: 'destructive' });
        return;
      }

      const batch = writeBatch(db);
      const newDefinitions: HakEdisDefinition[] = [];

      for (const row of rows) {
        const sutKodu = String(row[0] || '').trim();
        const sutTestAdi = String(row[1] || '').trim();
        const stokKodu = String(row[2] || '').trim();
        const hakEdis = parseFloat(String(row[3] || '0').replace(',', '.'));

        if (!sutKodu || !sutTestAdi || !stokKodu || isNaN(hakEdis) || hakEdis <= 0) continue;

        // Stok kodunun sistemde olup olmadığını kontrol et
        const product = productCodes.find(p => p.stokKodu === stokKodu);
        if (!product) {
          console.warn(`Stok kodu bulunamadı: ${stokKodu}`);
          continue;
        }

        const docRef = doc(collection(db, 'hakEdisDefinitions'));
        batch.set(docRef, {
          sutKodu,
          sutTestAdi,
          linkedStokKodu: stokKodu,
          hakEdisMiktari: hakEdis,
        });

        newDefinitions.push({
          id: docRef.id,
          sutKodu,
          sutTestAdi,
          linkedStokKodu: stokKodu,
          hakEdisMiktari: hakEdis,
        });
      }

      await batch.commit();

      setHakEdisDefinitions(prev => [...prev, ...newDefinitions].sort((a, b) => a.sutKodu.localeCompare(b.sutKodu)));

      toast({
        title: 'İçe Aktarma Başarılı',
        description: `${newDefinitions.length} hak ediş tanımı eklendi.`,
      });
    } catch (error) {
      console.error("Error importing Excel:", error);
      toast({ title: 'Hata', description: 'Excel dosyası işlenemedi.', variant: 'destructive' });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExcelExport = () => {
    const exportData = hakEdisDefinitions.map(d => {
      const product = productCodes.find(p => p.stokKodu === d.linkedStokKodu);
      return {
        'SUT Kodu': d.sutKodu,
        'SUT Test Adı': d.sutTestAdi,
        'Stok Kodu': d.linkedStokKodu,
        'Stok Adı': product?.stokAdi || '',
        'Test Adı': product?.testAdi || '',
        'Hak Ediş (TL)': d.hakEdisMiktari,
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hak Ediş Tanımları');
    XLSX.writeFile(wb, `hak_edis_tanimlari_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      { 'SUT Kodu': '900.010', 'SUT Test Adı': 'Örnek Test', 'Stok Kodu': 'STOK001', 'Hak Ediş (TL)': 5.50 },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Şablon');
    XLSX.writeFile(wb, 'hak_edis_sablon.xlsx');
  };

  // Filtreleme
  const filteredDefinitions = hakEdisDefinitions.filter(d => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const product = productCodes.find(p => p.stokKodu === d.linkedStokKodu);
    return (
      d.sutKodu.toLowerCase().includes(term) ||
      d.sutTestAdi.toLowerCase().includes(term) ||
      d.linkedStokKodu.toLowerCase().includes(term) ||
      (product?.stokAdi || '').toLowerCase().includes(term)
    );
  });

  // Toplam hak ediş hesapla
  const totalHakEdis = hakEdisDefinitions.reduce((sum, d) => sum + d.hakEdisMiktari, 0);

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/yonetim/tanimlar" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-6 w-6 text-amber-500" />
            Hak Ediş Paneli
          </CardTitle>
          <CardDescription>
            SUT kodlarına göre test bazlı hak ediş tanımlamalarını yönetin. Her teste ait TL cinsinden hak ediş miktarını belirleyin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Özet Bilgiler */}
          <div className="flex flex-wrap gap-4">
            <Badge variant="outline" className="px-4 py-2 text-base">
              {hakEdisDefinitions.length} tanım
            </Badge>
            <Badge variant="outline" className="px-4 py-2 text-base bg-amber-50 text-amber-700">
              Toplam: ₺{totalHakEdis.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </Badge>
            {exchangeRates && (
              <>
                <Badge variant="outline" className="px-4 py-2 text-sm">
                  €{(totalHakEdis / exchangeRates.TRY).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Badge>
                <Badge variant="outline" className="px-4 py-2 text-sm">
                  ${(totalHakEdis / exchangeRates.TRY * exchangeRates.USD).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Badge>
              </>
            )}
          </div>

          {/* İşlem Butonları */}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".xlsx,.xls"
              onChange={handleExcelImport}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isImporting || loading.products}>
              {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Excel ile İçe Aktar
            </Button>
            <Button variant="outline" onClick={handleExcelExport} disabled={hakEdisDefinitions.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Excel'e Aktar
            </Button>
            <Button variant="outline" onClick={handleDownloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Şablon İndir
            </Button>
          </div>

          {/* Yeni Tanım Ekleme */}
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-lg">Yeni Hak Ediş Tanımı Ekle</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
              <Input
                placeholder="SUT Kodu (örn: 900.010)"
                value={newSutKodu}
                onChange={(e) => setNewSutKodu(e.target.value)}
              />
              <Input
                placeholder="SUT Test Adı"
                value={newSutTestAdi}
                onChange={(e) => setNewSutTestAdi(e.target.value)}
              />
              <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isProductPopoverOpen}
                    className="w-full justify-between font-normal"
                  >
                    {newLinkedStokKodu
                      ? productCodes.find(p => p.stokKodu === newLinkedStokKodu)?.stokAdi || newLinkedStokKodu
                      : "Ürün Seçin..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                  <Command>
                    <CommandInput placeholder="Ürün adı veya kodu ara..." />
                    <CommandList>
                      <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                      <CommandGroup>
                        {productCodes.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.stokAdi} ${p.stokKodu} ${p.testAdi || ''}`}
                            onSelect={() => {
                              setNewLinkedStokKodu(p.stokKodu);
                              setIsProductPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                newLinkedStokKodu === p.stokKodu ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{p.stokAdi}</span>
                              <span className="text-xs text-muted-foreground">
                                {p.stokKodu} {p.testAdi && `• ${p.testAdi}`}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Input
                placeholder="Hak Ediş (TL)"
                value={newHakEdisMiktari}
                onChange={(e) => setNewHakEdisMiktari(e.target.value)}
                type="text"
                inputMode="decimal"
              />
              <Button onClick={handleAddDefinition} disabled={isSaving || loading.products}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Ekle
              </Button>
            </CardContent>
          </Card>

          {/* Arama */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="SUT kodu, test adı veya stok kodu ile ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Tanımlı Hak Edişler Tablosu */}
          <Card className="border">
            <CardHeader className="py-3">
              <CardTitle className="text-lg">
                Tanımlı Hak Edişler
                {searchTerm && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({filteredDefinitions.length}/{hakEdisDefinitions.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[400px]">
                {loading.definitions ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Yükleniyor...
                  </div>
                ) : filteredDefinitions.length === 0 ? (
                  <div className="text-center text-muted-foreground p-8">
                    {searchTerm ? 'Aramayla eşleşen tanım bulunamadı.' : 'Henüz hak ediş tanımı yok.'}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">SUT Kodu</TableHead>
                        <TableHead>SUT Test Adı</TableHead>
                        <TableHead>Sistemdeki Ürün Eşleşmesi</TableHead>
                        <TableHead className="text-right w-[150px]">Hak Ediş (TL)</TableHead>
                        <TableHead className="text-right w-[80px]">İşlem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDefinitions.map(d => {
                        const product = productCodes.find(p => p.stokKodu === d.linkedStokKodu);
                        return (
                          <TableRow key={d.id}>
                            <TableCell className="font-mono font-medium">{d.sutKodu}</TableCell>
                            <TableCell>{d.sutTestAdi}</TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium">{product?.stokAdi || '-'}</span>
                                <span className="text-xs text-muted-foreground">
                                  {d.linkedStokKodu}
                                  {product?.testAdi && ` • ${product.testAdi}`}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-amber-700">
                              ₺{d.hakEdisMiktari.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteDefinition(d.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
