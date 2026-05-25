'use client';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Loader2, Coins, Upload, Download, Search, X, Calculator } from 'lucide-react';
import TestCostDetailModal from '@/components/TestCostDetailModal';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  writeBatch,
  onSnapshot,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { ProductCode, TestDefinitionGlobal } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { YonetimShell, YonetimHeader, YonetimCard } from '@/components/yonetim-ui/YonetimHub';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope, normalizeCompanyId } from '@/lib/company-scope';
import { getExchangeRates } from '@/lib/exchange-rates';

const COLLECTION = 'testDefinitions';

/**
 * Excel kolon parser: bağlı ürün kodları "STOK1;STOK2,STOK3" gibi noktalı virgül
 * veya virgül ayrılmış olarak gelebilir; ya da tek string.
 */
function parseLinkedStokKodlari(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return String(raw)
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function HakEdisPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();

  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [testDefs, setTestDefs] = useState<TestDefinitionGlobal[]>([]);
  const [loading, setLoading] = useState({ products: true, defs: true });

  // Yeni satır ekleme state'leri
  const [newSutKodu, setNewSutKodu] = useState('');
  const [newSutTestAdi, setNewSutTestAdi] = useState('');
  const [newLinkedStokKodlari, setNewLinkedStokKodlari] = useState<string[]>([]);
  const [newHakEdisMiktari, setNewHakEdisMiktari] = useState('');
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Arama
  const [searchTerm, setSearchTerm] = useState('');

  // Excel import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Cost detail modal
  const [costDetailFor, setCostDetailFor] = useState<TestDefinitionGlobal | null>(null);

  // Döviz kurları
  const [exchangeRates, setExchangeRates] = useState<{ EUR: number; USD: number; TRY: number } | null>(null);

  // Master data (productCodes)
  useEffect(() => {
    const run = async () => {
      setLoading((p) => ({ ...p, products: true }));
      try {
        const snap = await getDocs(query(collection(db, 'productCodes'), orderBy('stokAdi', 'asc')));
        setProductCodes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductCode)));
      } catch (e) {
        console.error('productCodes fetch error', e);
        toast({ title: 'Hata', description: 'Ürün kodları yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading((p) => ({ ...p, products: false }));
      }
    };
    run();
  }, [toast]);

  // Global testDefinitions
  useEffect(() => {
    setLoading((p) => ({ ...p, defs: true }));
    const q = scopedQuery(COLLECTION, currentCompanyId, isSuperAdmin, orderBy('sutKodu', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTestDefs(
          filterByCompanyScope(
            snap.docs.map((d) => ({ id: d.id, ...d.data() } as TestDefinitionGlobal)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );
        setLoading((p) => ({ ...p, defs: false }));
      },
      (e) => {
        console.error('testDefinitions subscription error', e);
        toast({ title: 'Hata', description: 'Test tanımları yüklenemedi.', variant: 'destructive' });
        setLoading((p) => ({ ...p, defs: false }));
      },
    );
    return () => unsub();
  }, [currentCompanyId, isSuperAdmin, toast]);

  // Exchange rates
  useEffect(() => {
    getExchangeRates()
      .then(setExchangeRates)
      .catch(() => setExchangeRates({ EUR: 1, USD: 1.08, TRY: 38.5 }));
  }, []);

  const productMap = useMemo(() => {
    const m = new Map<string, ProductCode>();
    productCodes.forEach((p) => m.set(p.stokKodu, p));
    return m;
  }, [productCodes]);

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  const handleAdd = async () => {
    if (!newSutKodu.trim() || !newSutTestAdi.trim() || newLinkedStokKodlari.length === 0 || !newHakEdisMiktari.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Tüm alanlar doldurulmalıdır.', variant: 'destructive' });
      return;
    }
    const hakEdis = parseFloat(newHakEdisMiktari.replace(',', '.'));
    if (isNaN(hakEdis) || hakEdis <= 0) {
      toast({ title: 'Geçersiz Değer', description: 'Hak ediş miktarı geçerli bir sayı olmalı.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      await addDoc(collection(db, COLLECTION), {
        sutKodu: newSutKodu.trim(),
        sutTestAdi: newSutTestAdi.trim(),
        linkedStokKodlari: newLinkedStokKodlari,
        hakEdisMiktari: hakEdis,
        currency: 'TRY',
        aktif: true,
        createdAt: serverTimestamp(),
        createdByUid: currentUserProfile?.uid ?? null,
        createdByName: currentUserProfile?.name ?? currentUserProfile?.email ?? null,
        companyId: normalizeCompanyId(currentUserProfile?.companyId || currentCompanyId),
      });
      toast({ title: 'Başarılı', description: 'Test tanımı eklendi.' });
      setNewSutKodu('');
      setNewSutTestAdi('');
      setNewLinkedStokKodlari([]);
      setNewHakEdisMiktari('');
    } catch (e) {
      console.error('add error', e);
      toast({ title: 'Hata', description: 'Tanım eklenemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu test tanımını silmek istediğinizden emin misiniz?')) return;
    try {
      await deleteDoc(doc(db, COLLECTION, id));
      toast({ title: 'Silindi', description: 'Test tanımı silindi.' });
    } catch (e) {
      console.error('delete error', e);
      toast({ title: 'Hata', description: 'Silinemedi.', variant: 'destructive' });
    }
  };

  const toggleStokKodu = (stokKodu: string) => {
    setNewLinkedStokKodlari((cur) => (cur.includes(stokKodu) ? cur.filter((x) => x !== stokKodu) : [...cur, stokKodu]));
  };

  const removeStokKodu = (stokKodu: string) => {
    setNewLinkedStokKodlari((cur) => cur.filter((x) => x !== stokKodu));
  };

  // -------------------------------------------------------------------------
  // Excel
  // -------------------------------------------------------------------------

  const handleExcelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
      const dataRows = rows.slice(1).filter((r) => r && r.length >= 4 && r[0]);

      if (dataRows.length === 0) {
        toast({ title: 'Uyarı', description: 'Excel dosyasında geçerli veri yok.', variant: 'destructive' });
        return;
      }

      const batch = writeBatch(db);
      let added = 0;
      let skipped = 0;
      const skipReasons: string[] = [];

      for (const r of dataRows) {
        const sutKodu = String(r[0] || '').trim();
        const sutTestAdi = String(r[1] || '').trim();
        const stokKodlari = parseLinkedStokKodlari(r[2]);
        const hakEdis = parseFloat(String(r[3] || '0').replace(',', '.'));

        if (!sutKodu || !sutTestAdi || stokKodlari.length === 0 || isNaN(hakEdis) || hakEdis <= 0) {
          skipped++;
          skipReasons.push(`${sutKodu || '(boş)'}: geçersiz değer`);
          continue;
        }

        // Sistemde olmayan stok kodlarını filtrele
        const validStokKodlari = stokKodlari.filter((k) => productMap.has(k));
        const missing = stokKodlari.filter((k) => !productMap.has(k));
        if (validStokKodlari.length === 0) {
          skipped++;
          skipReasons.push(`${sutKodu}: hiçbir stok kodu sistemde yok (${missing.join(', ')})`);
          continue;
        }

        const ref = doc(collection(db, COLLECTION));
        batch.set(ref, {
          sutKodu,
          sutTestAdi,
          linkedStokKodlari: validStokKodlari,
          hakEdisMiktari: hakEdis,
          currency: 'TRY',
          aktif: true,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid ?? null,
          createdByName: currentUserProfile?.name ?? currentUserProfile?.email ?? null,
          companyId: normalizeCompanyId(currentUserProfile?.companyId || currentCompanyId),
        });
        added++;
      }

      if (added > 0) await batch.commit();
      const msg = [`${added} tanım eklendi`, skipped > 0 ? `${skipped} satır atlandı` : ''].filter(Boolean).join(', ');
      toast({ title: 'İçe Aktarma', description: msg });
      if (skipReasons.length > 0) {
        console.warn('Atlanan satırlar:', skipReasons);
      }
    } catch (e) {
      console.error('import error', e);
      toast({ title: 'Hata', description: 'Excel dosyası işlenemedi.', variant: 'destructive' });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExcelExport = () => {
    const rows = testDefs.map((d) => ({
      'SUT Kodu': d.sutKodu,
      'SUT Test Adı': d.sutTestAdi,
      'Bağlı Stok Kodları (;)': (d.linkedStokKodlari || []).join(';'),
      'Bağlı Ürün Adları': (d.linkedStokKodlari || [])
        .map((k) => productMap.get(k)?.stokAdi)
        .filter(Boolean)
        .join('; '),
      'Hak Ediş (TL)': d.hakEdisMiktari,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Test Tanımları');
    XLSX.writeFile(wb, `test_tanimlari_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'SUT Kodu': '900.010',
        'SUT Test Adı': 'Glikoz Tayini',
        'Bağlı Stok Kodları (;)': 'STOK001;STOK002',
        'Hak Ediş (TL)': 5.5,
      },
      {
        'SUT Kodu': '900.020',
        'SUT Test Adı': 'Hemogram',
        'Bağlı Stok Kodları (;)': 'STOK010',
        'Hak Ediş (TL)': 8.0,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Şablon');
    XLSX.writeFile(wb, 'test_tanimlari_sablon.xlsx');
  };

  // -------------------------------------------------------------------------
  // Filtre + özet
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    if (!searchTerm) return testDefs;
    const t = searchTerm.toLowerCase();
    return testDefs.filter((d) => {
      if (d.sutKodu.toLowerCase().includes(t)) return true;
      if (d.sutTestAdi.toLowerCase().includes(t)) return true;
      if ((d.linkedStokKodlari || []).some((k) => k.toLowerCase().includes(t))) return true;
      if (
        (d.linkedStokKodlari || []).some((k) => {
          const name = productMap.get(k)?.stokAdi?.toLowerCase() || '';
          return name.includes(t);
        })
      )
        return true;
      return false;
    });
  }, [testDefs, searchTerm, productMap]);

  const totalHakEdis = testDefs.reduce((s, d) => s + (Number(d.hakEdisMiktari) || 0), 0);

  return (
    <YonetimShell>
      <YonetimHeader
        title="Hak Ediş Paneli"
        description="Sistem genelinde SUT kodlarına göre test tanımlamaları. Her test bir veya birden çok ürüne bağlanabilir; tanımlar laboratuvardan bağımsızdır."
        backHref="/yonetim/tanimlar"
      />
      <YonetimCard>
        <div className="space-y-6">
          {/* Özet rozetler */}
          <div className="flex flex-wrap gap-4 items-center">
            <Badge variant="outline" className="px-4 py-2 text-base">
              {testDefs.length} test tanımı
            </Badge>
            <Badge variant="outline" className="px-4 py-2 text-base bg-amber-50 text-amber-700">
              Toplam Hak Ediş: ₺{totalHakEdis.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </Badge>
            {exchangeRates && (
              <>
                <Badge variant="outline" className="px-4 py-2 text-sm">
                  €{(totalHakEdis / exchangeRates.TRY).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Badge>
                <Badge variant="outline" className="px-4 py-2 text-sm">
                  ${((totalHakEdis / exchangeRates.TRY) * exchangeRates.USD).toLocaleString('tr-TR', {
                    minimumFractionDigits: 2,
                  })}
                </Badge>
              </>
            )}
          </div>

          {/* İşlem butonları */}
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={handleExcelImport} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isImporting || loading.products}>
              {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Excel ile İçe Aktar
            </Button>
            <Button variant="outline" onClick={handleExcelExport} disabled={testDefs.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Excel'e Aktar
            </Button>
            <Button variant="outline" onClick={handleDownloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Şablon İndir
            </Button>
          </div>

          {/* Yeni satır ekleme */}
          <Card className="border">
            <CardHeader>
              <CardTitle className="text-lg">Yeni Test Tanımı Ekle</CardTitle>
              <CardDescription>Bir teste birden çok ürün bağlanabilir.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
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

              {/* Çoklu ürün seçici */}
              <div className="flex flex-col gap-2 md:col-span-1">
                <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                      {newLinkedStokKodlari.length === 0 ? 'Ürün(ler) Seçin...' : `${newLinkedStokKodlari.length} ürün`}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Ürün adı veya kodu ara..." />
                      <CommandList>
                        <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                        <CommandGroup>
                          {productCodes.map((p) => {
                            const checked = newLinkedStokKodlari.includes(p.stokKodu);
                            return (
                              <CommandItem
                                key={p.id}
                                value={`${p.stokAdi} ${p.stokKodu} ${p.testAdi || ''}`}
                                onSelect={() => toggleStokKodu(p.stokKodu)}
                              >
                                <Check className={cn('mr-2 h-4 w-4', checked ? 'opacity-100' : 'opacity-0')} />
                                <div className="flex flex-col">
                                  <span>{p.stokAdi}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {p.stokKodu} {p.testAdi && `• ${p.testAdi}`}
                                  </span>
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {/* Seçili rozetler */}
                {newLinkedStokKodlari.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {newLinkedStokKodlari.map((k) => (
                      <Badge key={k} variant="secondary" className="gap-1">
                        <span className="font-mono text-xs">{k}</span>
                        <button
                          type="button"
                          onClick={() => removeStokKodu(k)}
                          className="hover:text-destructive"
                          aria-label={`${k} kaldır`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <Input
                placeholder="Hak Ediş (TL)"
                value={newHakEdisMiktari}
                onChange={(e) => setNewHakEdisMiktari(e.target.value)}
                type="text"
                inputMode="decimal"
              />
              <Button onClick={handleAdd} disabled={isSaving || loading.products}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Ekle
              </Button>
            </CardContent>
          </Card>

          {/* Arama */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="SUT kodu, test adı, ürün ile ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Liste */}
          <Card className="border">
            <CardHeader className="py-3">
              <CardTitle className="text-lg">
                Tanımlı Testler
                {searchTerm && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({filtered.length}/{testDefs.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {loading.defs ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Yükleniyor...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center text-muted-foreground p-8">
                    {searchTerm ? 'Aramayla eşleşen tanım bulunamadı.' : 'Henüz test tanımı yok.'}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">SUT Kodu</TableHead>
                        <TableHead>SUT Test Adı</TableHead>
                        <TableHead>Bağlı Ürünler</TableHead>
                        <TableHead className="text-right w-[150px]">Hak Ediş (TL)</TableHead>
                        <TableHead className="text-right w-[140px]">İşlem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono font-medium">{d.sutKodu}</TableCell>
                          <TableCell>{d.sutTestAdi}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(d.linkedStokKodlari || []).map((k) => {
                                const p = productMap.get(k);
                                return (
                                  <Badge key={k} variant="outline" className="gap-1">
                                    <span className="text-xs">{p?.stokAdi || k}</span>
                                    <span className="font-mono text-[10px] text-muted-foreground">{k}</span>
                                  </Badge>
                                );
                              })}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-amber-700">
                            ₺{Number(d.hakEdisMiktari || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Maliyet Detayı"
                              onClick={() => setCostDetailFor(d)}
                            >
                              <Calculator className="h-4 w-4 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </YonetimCard>

      <TestCostDetailModal
        open={!!costDetailFor}
        onOpenChange={(o) => !o && setCostDetailFor(null)}
        testDef={costDetailFor}
        allTestDefs={testDefs}
      />
    </YonetimShell>
  );
}
