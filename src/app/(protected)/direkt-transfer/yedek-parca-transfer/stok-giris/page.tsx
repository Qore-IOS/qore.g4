'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
} from 'firebase/firestore';
import type { ProductCode, YedekParcaDepoStokItem } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Loader2,
  Package,
  Plus,
  Trash2,
  Search,
  Save,
} from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import BackButton from '@/components/BackButton';

interface StokGirisRow {
  id: string;
  productCodeId: string;
  stokKodu: string;
  stokAdi: string;
  serialNumber: string;
}

export default function YedekParcaStokGirisPage() {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [spareParts, setSpareParts] = useState<ProductCode[]>([]);
  const [rows, setRows] = useState<StokGirisRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // New row state
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [serialNumber, setSerialNumber] = useState('');
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');

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

  const addRow = useCallback(() => {
    if (!selectedProduct) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen bir ürün seçin.', variant: 'destructive' });
      return;
    }

    // Check for duplicate serial number if provided
    if (serialNumber.trim() && rows.some(r => r.serialNumber === serialNumber.trim())) {
      toast({ title: 'Uyari', description: 'Bu seri numarasi zaten listede var.', variant: 'default' });
      return;
    }

    const newRow: StokGirisRow = {
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      productCodeId: selectedProduct.id,
      stokKodu: selectedProduct.stokKodu || '',
      stokAdi: selectedProduct.stokAdi || '',
      serialNumber: serialNumber.trim(),
    };

    setRows(prev => [...prev, newRow]);
    setSerialNumber('');
    toast({ title: 'Eklendi', description: `${selectedProduct.stokAdi} listeye eklendi.` });
  }, [selectedProduct, serialNumber, rows, toast]);

  const removeRow = (rowId: string) => {
    setRows(prev => prev.filter(r => r.id !== rowId));
  };

  const saveStock = async () => {
    if (rows.length === 0) {
      toast({ title: 'Uyari', description: 'Eklenecek urun yok.', variant: 'default' });
      return;
    }

    setIsSaving(true);

    try {
      const batch = writeBatch(db);
      const now = new Date();

      for (const row of rows) {
        const stockRef = doc(collection(db, 'yedekParcaDepoStok'));
        batch.set(stockRef, {
          productCodeId: row.productCodeId,
          stokKodu: row.stokKodu,
          stokAdi: row.stokAdi,
          serialNumber: row.serialNumber || '',
          quantity: 1,
          createdAt: Timestamp.fromDate(now),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
      }

      await batch.commit();

      toast({
        title: 'Stok Girisi Tamamlandi',
        description: `${rows.length} yedek parca depoya eklendi.`,
      });

      setRows([]);
    } catch (err) {
      console.error('Error saving stock:', err);
      toast({ title: 'Hata', description: 'Stok girisi sirasinda hata olustu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Yukleniyor...</span>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold text-destructive">Yetkisiz Erisim</h2>
        <p className="text-muted-foreground mt-2">
          Bu sayfaya erisim yetkiniz bulunmamaktadir.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>
          Geri Don
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
            Yedek Parca Stok Girisi
          </CardTitle>
          <CardDescription>
            Yedek parca deposuna yeni urunler ekleyin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new stock row */}
          <div className="p-4 border rounded-lg bg-muted/30 space-y-4">
            <Label className="font-semibold">Yeni Urun Ekle</Label>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Product selector */}
              <div className="space-y-2">
                <Label>Yedek Parca</Label>
                <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                    >
                      {selectedProduct
                        ? `${selectedProduct.stokKodu} - ${selectedProduct.stokAdi?.substring(0, 20)}...`
                        : 'Urun secin...'}
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
                        <CommandEmpty>Urun bulunamadi.</CommandEmpty>
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
                <Label>Seri Numarasi (Opsiyonel)</Label>
                <Input
                  placeholder="Seri numarasini girin"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  disabled={!selectedProductId}
                />
              </div>

              {/* Add button */}
              <div className="flex items-end">
                <Button
                  onClick={addRow}
                  disabled={!selectedProductId}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Satir Ekle
                </Button>
              </div>
            </div>
          </div>

          {/* Stock entry list */}
          {rows.length > 0 && (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Urun Kodu</TableHead>
                    <TableHead>Urun Adi</TableHead>
                    <TableHead>Seri No</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono">{row.stokKodu}</TableCell>
                      <TableCell>{row.stokAdi}</TableCell>
                      <TableCell className="font-mono">{row.serialNumber || '-'}</TableCell>
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
                <span className="text-sm text-muted-foreground">
                  {rows.length} urun eklenecek
                </span>
                <Button onClick={saveStock} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Stoga Kaydet
                </Button>
              </div>
            </div>
          )}

          {rows.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>Henuz eklenecek urun yok.</p>
              <p className="text-sm">Yukaridaki formu kullanarak urun ekleyin.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
