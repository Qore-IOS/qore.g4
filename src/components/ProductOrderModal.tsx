'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Hospital, ProductCode, MinMaxRule } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Loader2,
  ArrowUp,
  ArrowDown,
  Upload,
  Download,
  GripVertical,
  Search,
  RotateCcw,
  Save,
  AlertCircle
} from 'lucide-react';
import { exportDataToExcel, readExcelData } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface ProductOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hospital: Hospital;
  productCodes: ProductCode[];
  onSaved?: () => void;
}

interface OrderedProduct {
  stokKodu: string;
  stokAdi: string;
  cihazGrubu?: string;
}

export default function ProductOrderModal({
  open,
  onOpenChange,
  hospital,
  productCodes,
  onSaved
}: ProductOrderModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [orderedProducts, setOrderedProducts] = useState<OrderedProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [originalOrder, setOriginalOrder] = useState<string[]>([]);

  // Fetch minMaxRules and initialize product order
  const fetchMinMaxProducts = useCallback(async () => {
    if (!hospital?.id) return;

    setIsLoading(true);
    try {
      const rulesSnap = await getDocs(collection(db, 'hospitals', hospital.id, 'minMaxRules'));
      const rules: MinMaxRule[] = rulesSnap.docs.map(d => d.data() as MinMaxRule);

      // Get all stokKodus from minMaxRules
      const minMaxStokKodlari = rules.map(r => r.stokKodu).filter(Boolean);

      // Map to product info
      const products: OrderedProduct[] = minMaxStokKodlari.map(stokKodu => {
        const product = productCodes.find(p => p.stokKodu === stokKodu);
        return {
          stokKodu,
          stokAdi: product?.stokAdi || stokKodu,
          cihazGrubu: product?.cihazGrubu
        };
      });

      // If hospital has existing customProductOrder, apply it
      if (hospital.customProductOrder && hospital.customProductOrder.length > 0) {
        const orderMap = new Map<string, number>();
        hospital.customProductOrder.forEach((code, idx) => {
          orderMap.set(code, idx);
        });

        // Sort products by customProductOrder, unordered items go to end
        products.sort((a, b) => {
          const orderA = orderMap.has(a.stokKodu) ? orderMap.get(a.stokKodu)! : 99999;
          const orderB = orderMap.has(b.stokKodu) ? orderMap.get(b.stokKodu)! : 99999;
          if (orderA !== orderB) return orderA - orderB;
          // Fallback to device group + name sort
          const groupA = a.cihazGrubu || 'zzz';
          const groupB = b.cihazGrubu || 'zzz';
          if (groupA !== groupB) return groupA.localeCompare(groupB);
          return a.stokAdi.localeCompare(b.stokAdi);
        });

        setOriginalOrder(hospital.customProductOrder);
      } else {
        // Default sorting: cihazGrubu then stokAdi alphabetically
        products.sort((a, b) => {
          const groupA = a.cihazGrubu || 'zzz';
          const groupB = b.cihazGrubu || 'zzz';
          if (groupA !== groupB) return groupA.localeCompare(groupB);
          return a.stokAdi.localeCompare(b.stokAdi);
        });

        setOriginalOrder([]);
      }

      setOrderedProducts(products);
      setHasChanges(false);
    } catch (error) {
      console.error('Error fetching minMax products:', error);
      toast({ title: 'Hata', description: 'Ürünler yüklenirken bir hata oluştu.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [hospital, productCodes, toast]);

  useEffect(() => {
    if (open && hospital?.id) {
      fetchMinMaxProducts();
    }
  }, [open, hospital?.id, fetchMinMaxProducts]);

  // Move item up
  const moveUp = (index: number) => {
    if (index === 0) return;
    const newOrder = [...orderedProducts];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setOrderedProducts(newOrder);
    setHasChanges(true);
  };

  // Move item down
  const moveDown = (index: number) => {
    if (index === orderedProducts.length - 1) return;
    const newOrder = [...orderedProducts];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setOrderedProducts(newOrder);
    setHasChanges(true);
  };

  // Reset to default sorting (cihazGrubu + stokAdi)
  const resetToDefault = () => {
    const sorted = [...orderedProducts].sort((a, b) => {
      const groupA = a.cihazGrubu || 'zzz';
      const groupB = b.cihazGrubu || 'zzz';
      if (groupA !== groupB) return groupA.localeCompare(groupB);
      return a.stokAdi.localeCompare(b.stokAdi);
    });
    setOrderedProducts(sorted);
    setHasChanges(true);
  };

  // Save order to Firestore
  const handleSave = async () => {
    if (!hospital?.id) return;

    setIsSaving(true);
    try {
      const customOrder = orderedProducts.map(p => p.stokKodu);
      await updateDoc(doc(db, 'hospitals', hospital.id), {
        customProductOrder: customOrder,
        updatedAt: new Date()
      });

      toast({ title: 'Başarılı', description: 'Özel ürün sıralaması kaydedildi.' });
      setHasChanges(false);
      setOriginalOrder(customOrder);
      onSaved?.();
    } catch (error) {
      console.error('Error saving product order:', error);
      toast({ title: 'Hata', description: 'Sıralama kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  // Clear custom order (revert to default behavior)
  const handleClearCustomOrder = async () => {
    if (!hospital?.id) return;

    if (!confirm('Özel sıralamayı kaldırmak istediğinizden emin misiniz? Varsayılan sıralama kullanılacaktır.')) {
      return;
    }

    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'hospitals', hospital.id), {
        customProductOrder: null,
        updatedAt: new Date()
      });

      toast({ title: 'Başarılı', description: 'Özel sıralama kaldırıldı. Varsayılan sıralama kullanılacak.' });
      resetToDefault();
      setOriginalOrder([]);
      setHasChanges(false);
      onSaved?.();
    } catch (error) {
      console.error('Error clearing product order:', error);
      toast({ title: 'Hata', description: 'Sıralama kaldırılamadı.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  // Export current order to Excel
  const handleExportExcel = () => {
    const data = orderedProducts.map((p, idx) => ({
      'Sıra': idx + 1,
      'Stok Kodu': p.stokKodu,
      'Stok Adı': p.stokAdi,
      'Cihaz Grubu': p.cihazGrubu || '-'
    }));

    exportDataToExcel(data, `Urun_Sirasi_${hospital.name}`, 'UrunSirasi', toast);
  };

  // Import order from Excel
  const handleImportExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = await readExcelData(file, toast);

      // Extract stok kodları from Excel - look for 'Stok Kodu' or first column
      const importedCodes: string[] = [];
      for (const row of data) {
        const stokKodu = row['Stok Kodu'] || row['stokKodu'] || row['StokKodu'] || row['stok_kodu'] || Object.values(row)[0];
        if (stokKodu && typeof stokKodu === 'string') {
          importedCodes.push(stokKodu.trim());
        }
      }

      if (importedCodes.length === 0) {
        toast({ title: 'Hata', description: 'Excel dosyasında stok kodu bulunamadı.', variant: 'destructive' });
        return;
      }

      // Get current minMax products (in case some are in Excel that aren't in minMax, ignore them)
      const currentCodes = new Set(orderedProducts.map(p => p.stokKodu));

      // Filter imported codes to only include those in minMax
      const validCodes = importedCodes.filter(code => currentCodes.has(code));

      if (validCodes.length === 0) {
        toast({ title: 'Hata', description: 'Excel\'deki ürünlerden hiçbiri bu laboratuvarın Min-Max listesinde yok.', variant: 'destructive' });
        return;
      }

      // Create new order based on Excel
      const codeToProduct = new Map(orderedProducts.map(p => [p.stokKodu, p]));
      const newOrder: OrderedProduct[] = [];
      const usedCodes = new Set<string>();

      // First add products in Excel order
      for (const code of validCodes) {
        if (!usedCodes.has(code) && codeToProduct.has(code)) {
          newOrder.push(codeToProduct.get(code)!);
          usedCodes.add(code);
        }
      }

      // Then add remaining products not in Excel (keep their relative order from minMax)
      for (const product of orderedProducts) {
        if (!usedCodes.has(product.stokKodu)) {
          newOrder.push(product);
        }
      }

      setOrderedProducts(newOrder);
      setHasChanges(true);

      const ignored = importedCodes.length - validCodes.length;
      if (ignored > 0) {
        toast({
          title: 'Kısmen Yüklendi',
          description: `${validCodes.length} ürün sıralandı. ${ignored} ürün Min-Max listesinde olmadığı için atlandı.`
        });
      } else {
        toast({ title: 'Başarılı', description: `${validCodes.length} ürün Excel'den sıralandı.` });
      }

    } catch (error) {
      console.error('Error importing Excel:', error);
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Filtered products based on search
  const filteredProducts = useMemo(() => {
    if (!searchTerm.trim()) return orderedProducts;
    const term = searchTerm.toLowerCase();
    return orderedProducts.filter(p =>
      p.stokKodu.toLowerCase().includes(term) ||
      p.stokAdi.toLowerCase().includes(term) ||
      (p.cihazGrubu && p.cihazGrubu.toLowerCase().includes(term))
    );
  }, [orderedProducts, searchTerm]);

  // Get actual index in orderedProducts from filtered index
  const getActualIndex = (filteredIndex: number): number => {
    const product = filteredProducts[filteredIndex];
    return orderedProducts.findIndex(p => p.stokKodu === product.stokKodu);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GripVertical className="h-5 w-5 text-primary" />
            Özel Ürün Sıralaması - {hospital?.name}
          </DialogTitle>
          <DialogDescription>
            Sipariş toplama ekranında ürünlerin hangi sırayla listeleneceğini belirleyin.
            Min-Max listesindeki ürünleri sıralayabilirsiniz.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2">Ürünler yükleniyor...</span>
          </div>
        ) : orderedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Bu laboratuvar için Min-Max kuralı tanımlanmamış.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Önce Min-Max ayarlarından ürün tanımlayın.
            </p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 py-2 border-b">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ürün ara (kod, ad, cihaz grubu)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>

              <Button variant="outline" size="sm" onClick={resetToDefault}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Varsayılan Sıra
              </Button>

              <Button variant="outline" size="sm" onClick={handleExportExcel}>
                <Download className="h-4 w-4 mr-1" />
                Excel İndir
              </Button>

              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" />
                Excel Yükle
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleImportExcel}
                className="hidden"
              />
            </div>

            {/* Info banner */}
            {originalOrder.length > 0 && (
              <div className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 rounded-md flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Bu laboratuvar için özel sıralama tanımlı ({originalOrder.length} ürün).
              </div>
            )}

            {/* Product list */}
            <ScrollArea className="flex-1 border rounded-md">
              <div className="p-2 space-y-1">
                {filteredProducts.map((product, filteredIdx) => {
                  const actualIndex = getActualIndex(filteredIdx);
                  const isFiltered = searchTerm.trim() !== '';

                  return (
                    <div
                      key={product.stokKodu}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors",
                        isFiltered && "opacity-90"
                      )}
                    >
                      {/* Position indicator */}
                      <div className="w-8 h-8 flex items-center justify-center rounded bg-muted text-sm font-mono font-medium">
                        {actualIndex + 1}
                      </div>

                      {/* Product info */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{product.stokAdi}</div>
                        <div className="text-xs text-muted-foreground flex gap-2">
                          <span className="font-mono">{product.stokKodu}</span>
                          {product.cihazGrubu && (
                            <span className="text-primary">• {product.cihazGrubu}</span>
                          )}
                        </div>
                      </div>

                      {/* Move buttons - disabled when filtering */}
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => moveUp(actualIndex)}
                          disabled={actualIndex === 0 || isFiltered}
                          title={isFiltered ? "Arama yaparken sıralama değiştirilemez" : "Yukarı taşı"}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => moveDown(actualIndex)}
                          disabled={actualIndex === orderedProducts.length - 1 || isFiltered}
                          title={isFiltered ? "Arama yaparken sıralama değiştirilemez" : "Aşağı taşı"}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Summary */}
            <div className="text-sm text-muted-foreground">
              {searchTerm ? (
                <span>{filteredProducts.length} / {orderedProducts.length} ürün gösteriliyor</span>
              ) : (
                <span>Toplam {orderedProducts.length} ürün</span>
              )}
              {hasChanges && (
                <span className="ml-2 text-amber-600 font-medium">• Kaydedilmemiş değişiklikler var</span>
              )}
            </div>
          </>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {originalOrder.length > 0 && (
            <Button
              variant="outline"
              onClick={handleClearCustomOrder}
              disabled={isSaving}
              className="mr-auto text-destructive hover:text-destructive"
            >
              Özel Sıralamayı Kaldır
            </Button>
          )}

          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {hasChanges ? 'Vazgeç' : 'Kapat'}
          </Button>

          <Button
            onClick={handleSave}
            disabled={isSaving || !hasChanges || orderedProducts.length === 0}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
