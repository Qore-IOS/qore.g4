
'use client';
import React, { useState, useEffect, FC } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import type { ProductCode, Currency } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { doc, setDoc, addDoc, collection, getDocs, query, where, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CostInput } from './CostInput';
import { useAuth } from '@/contexts/auth-context';
import TrackingModeSelect from './TrackingModeSelect';
import { TrackingMode, resolveDefaultTrackingMode, TRACKING_MODE_LABEL } from '@/lib/tracking';
import BarcodeFormatSelect, { type FormatValue } from './BarcodeFormatSelect';
import BarcodeFormatMultiSelect from './BarcodeFormatMultiSelect';

type Definitions = {
  brands: string[];
  labGroups: string[];
  testGroups: string[];
  deviceGroups: string[];
  productGroups: string[];
  mainUnits: string[];
};

interface ProductFormatModalProps {
  open: boolean;
  initial: Partial<ProductCode & { trackingMode: TrackingMode }>;
  onSave: (product: ProductCode) => void;
  onClose: () => void;
  productCodes: ProductCode[];
  definitions: Definitions;
}

/**
 * Removes properties with `undefined` values from an object, converting empty strings to null.
 * This is crucial for Firestore updates with `merge: true` to correctly delete fields.
 */
function cleanDataForFirestore(data: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const key in data) {
    const value = data[key];
    if (value === undefined) {
      // Exclude undefined properties entirely.
      continue;
    }
    if (value === '') {
      // Convert empty strings to null for intentional field deletion.
      cleaned[key] = null;
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}


export const ProductFormatModal: FC<ProductFormatModalProps> = ({
  open,
  initial,
  onSave,
  onClose,
  productCodes,
  definitions
}) => {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [product, setProduct] = useState<Partial<ProductCode & { trackingMode: TrackingMode }>>({
    ...initial,
    trackingMode: resolveDefaultTrackingMode(initial as any),
  });
  const [isSaving, setIsSaving] = useState(false);

  // Çoklu format modu kontrolü - eğer barcodeFormatIds varsa çoklu mod aktif
  const hasMultipleFormats = Array.isArray((initial as any)?.barcodeFormatIds) &&
    (initial as any).barcodeFormatIds.length > 0;
  const [multiFormatMode, setMultiFormatMode] = useState(hasMultipleFormats);

  useEffect(() => {
    setProduct({
      ...initial,
      trackingMode: resolveDefaultTrackingMode(initial as any),
    });
    const hasMulti = Array.isArray((initial as any)?.barcodeFormatIds) &&
      (initial as any).barcodeFormatIds.length > 0;
    setMultiFormatMode(hasMulti);
  }, [initial]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProduct(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSelectChange = (name: keyof ProductCode, value: string) => {
    setProduct(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    if (!currentUser) {
      toast({ title: "Yetki Hatası", description: "Bu işlemi yapmak için giriş yapmalısınız.", variant: "destructive" });
      return;
    }
    if (!product.stokKodu?.trim() || !product.stokAdi?.trim()) {
      toast({ title: "Hata", description: "Stok kodu ve adı boş olamaz.", variant: "destructive" });
      return;
    }
    if (product.urunGrubu === 'kit' && (!product.ambalajDegeri || product.ambalajDegeri <= 0)) {
        toast({ title: "Hata", description: "Kitler için ambalaj değeri pozitif bir sayı olmalıdır.", variant: "destructive" });
        return;
    }
    
    setIsSaving(true);
    
    // Explicitly prepare the data payload, defaulting undefined/empty strings to null
    const productData: Omit<ProductCode, 'id'> = {
      stokKodu: product.stokKodu!.trim(),
      stokAdi: product.stokAdi!.trim(),
      urunGrubu: product.urunGrubu || 'kit',
      anaBirim: product.anaBirim || 'Kutu',
      cost: product.cost || 0,
      currency: product.currency || 'EUR',
      marka: product.marka?.trim() || null,
      laboratuvarGrubu: product.laboratuvarGrubu?.trim() || null,
      testGrubu: product.testGrubu?.trim() || null,
      cihazGrubu: product.cihazGrubu?.trim() || null,
      testAdi: product.testAdi?.trim() || null,
      barcodeNumber: (product.barcodeNumber || '').trim() || null,
      // Çoklu format modunda barcodeFormatIds kullan, tek modda barcodeFormatId
      barcodeFormatId: multiFormatMode ? null : (product.barcodeFormatId || null),
      barcodeFormatIds: multiFormatMode ? ((product as any).barcodeFormatIds || []) : null,
      ambalajDegeri: product.ambalajDegeri || null,
      trackingMode: product.trackingMode || resolveDefaultTrackingMode(product as any),
      // Ürün boyutları (cm cinsinden)
      genislik: product.genislik || null,
      yukseklik: product.yukseklik || null,
      derinlik: product.derinlik || null,
    };

    try {
      if (product.id) {
        // Use updateDoc for existing documents to ensure fields set to null are actually removed
        await updateDoc(doc(db, 'productCodes', product.id), productData);
        onSave({ ...product, ...productData } as ProductCode);
      } else {
        const q = query(collection(db, "productCodes"), where("stokKodu", "==", productData.stokKodu));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          toast({ title: "Hata", description: "Bu stok kodu zaten mevcut.", variant: "destructive" });
          setIsSaving(false);
          return;
        }
        const ref = await addDoc(collection(db, 'productCodes'), productData);
        onSave({ id: ref.id, ...productData } as ProductCode);
      }
      toast({ title: 'Başarılı', description: `Ürün kaydedildi (${TRACKING_MODE_LABEL[productData.trackingMode as TrackingMode]})` });
      onClose();
    } catch (error: any) {
      console.error("Error saving product:", error);
      toast({ 
        title: 'Hata', 
        description: `Ürün kaydedilemedi: ${error.code || error.message}`, 
        variant: 'destructive' 
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product.id ? 'Ürün Düzenle' : 'Yeni Ürün'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-3 max-h-[70vh] overflow-y-auto pr-2">
          <div>
            <Label>Stok Kodu</Label>
            <Input
              name="stokKodu"
              value={product.stokKodu || ''}
              onChange={handleChange}
              disabled={!!product.id}
              placeholder="Örn: 03589301190"
              className="font-code"
            />
            {product.id && <p className="text-xs text-muted-foreground">Stok kodu düzenlenemez.</p>}
          </div>
          <div><Label>Stok Adı</Label><Input name="stokAdi" value={product.stokAdi || ''} onChange={handleChange} placeholder="Örn: Cobas E411 Temizlik Solüsyonu"/></div>
          
          <div>
            <Label>Marka</Label>
            <Select value={product.marka || ''} onValueChange={(value) => handleSelectChange('marka', value)}>
                <SelectTrigger><SelectValue placeholder="Marka seçin..." /></SelectTrigger>
                <SelectContent>{definitions.brands.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Laboratuvar Grubu</Label>
            <Select value={product.laboratuvarGrubu || ''} onValueChange={(value) => handleSelectChange('laboratuvarGrubu', value)}>
                <SelectTrigger><SelectValue placeholder="Laboratuvar grubu seçin..." /></SelectTrigger>
                <SelectContent>{definitions.labGroups.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Test Grubu</Label>
             <Select value={product.testGrubu || ''} onValueChange={(value) => handleSelectChange('testGrubu', value)}>
                <SelectTrigger><SelectValue placeholder="Test grubu seçin..." /></SelectTrigger>
                <SelectContent>{definitions.testGroups.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Test Adı</Label>
            <Input
              name="testAdi"
              value={product.testAdi || ''}
              onChange={handleChange}
              placeholder="Örn: HbA1c, TSH, Ferritin..."
            />
            <p className="text-xs text-muted-foreground mt-1">Ürünün çalıştığı testin adı (Total Verimlilik paneli için).</p>
          </div>
          <div>
            <Label>Cihaz Grubu</Label>
             <Select value={product.cihazGrubu || ''} onValueChange={(value) => handleSelectChange('cihazGrubu', value)}>
                <SelectTrigger><SelectValue placeholder="Cihaz grubu seçin..." /></SelectTrigger>
                <SelectContent>{definitions.deviceGroups.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          
          <div>
            <Label>Ürün Grubu</Label>
            <Select value={product.urunGrubu || 'kit'} onValueChange={(value) => handleSelectChange('urunGrubu', value as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="kit">Kit</SelectItem>
                    <SelectItem value="sarf">Sarf Malzeme</SelectItem>
                    <SelectItem value="yedek_parca">Yedek Parça</SelectItem>
                </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Ambalaj Değeri (Test Adedi/Birim)</Label>
            <Input type="number" name="ambalajDegeri" value={product.ambalajDegeri || ''} onChange={e => setProduct(p => ({ ...p, ambalajDegeri: e.target.value === '' ? undefined : Number(e.target.value) }))} placeholder="Örn: 100" min="0"/>
          </div>
          
          <div>
            <Label>Ana Birim</Label>
            <Select value={product.anaBirim || ''} onValueChange={(value) => handleSelectChange('anaBirim', value as any)}>
                <SelectTrigger><SelectValue placeholder="Ana birim seçin..." /></SelectTrigger>
                <SelectContent>
                  {definitions.mainUnits.map(unit => (<SelectItem key={unit} value={unit}>{unit}</SelectItem>))}
                </SelectContent>
            </Select>
          </div>

          <TrackingModeSelect
            value={product.trackingMode ?? 'qty_barcode'}
            onChange={(v) => setProduct((s) => ({ ...s, trackingMode: v }))}
            className="mt-2"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <div>
              <Label>Barkod Numarası (UDI)</Label>
              <Input
                value={product.barcodeNumber ?? ''}
                onChange={(e) => setProduct(s => ({ ...s, barcodeNumber: e.target.value.trim() }))}
                placeholder="Örn: 00812345678901"
              />
              <p className="text-xs text-muted-foreground mt-1">Referans gömülü değilse ürünün benzersiz barkod numarası.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Çoklu Format</Label>
                <Switch
                  checked={multiFormatMode}
                  onCheckedChange={(checked) => {
                    setMultiFormatMode(checked);
                    if (checked) {
                      // Tek format'tan çoklu format'a geçiş
                      const currentFormatId = product.barcodeFormatId;
                      setProduct(s => ({
                        ...s,
                        barcodeFormatIds: currentFormatId && currentFormatId !== '__auto__'
                          ? [currentFormatId]
                          : [],
                        barcodeFormatId: null
                      }));
                    } else {
                      // Çoklu format'tan tek format'a geçiş
                      const formatIds = (product as any).barcodeFormatIds || [];
                      setProduct(s => ({
                        ...s,
                        barcodeFormatId: formatIds.length > 0 ? formatIds[0] : '__auto__',
                        barcodeFormatIds: null
                      }));
                    }
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Aynı ürün için hem seri no hem lot takipli barkod formatları kullanabilirsiniz.
              </p>
            </div>
          </div>

          <div className="mt-2">
            {multiFormatMode ? (
              <BarcodeFormatMultiSelect
                value={(product as any).barcodeFormatIds || []}
                onChange={(ids) => setProduct(s => ({ ...s, barcodeFormatIds: ids }))}
              />
            ) : (
              <BarcodeFormatSelect
                value={product.barcodeFormatId}
                onChange={(id) => setProduct(s => ({ ...s, barcodeFormatId: id }))}
              />
            )}
          </div>
          <div>
              <Label>Maliyet</Label>
              <CostInput
                initialCost={product.cost || 0}
                initialCurrency={product.currency || 'EUR'}
                onCostChange={(newCost, newCurrency) => {
                  setProduct(p => ({...p, cost: newCost, currency: newCurrency}));
                }}
              />
          </div>

          {/* Ürün Boyutları */}
          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-semibold">Ürün Boyutları (cm)</Label>
              <span className="text-xs text-muted-foreground">- Araç doluluk oranı hesaplaması için</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Genişlik</Label>
                <Input
                  type="number"
                  placeholder="cm"
                  value={product.genislik || ''}
                  onChange={(e) => setProduct(s => ({ ...s, genislik: e.target.value ? Number(e.target.value) : undefined }))}
                  min="0"
                  step="0.1"
                />
              </div>
              <div>
                <Label className="text-xs">Yükseklik</Label>
                <Input
                  type="number"
                  placeholder="cm"
                  value={product.yukseklik || ''}
                  onChange={(e) => setProduct(s => ({ ...s, yukseklik: e.target.value ? Number(e.target.value) : undefined }))}
                  min="0"
                  step="0.1"
                />
              </div>
              <div>
                <Label className="text-xs">Derinlik</Label>
                <Input
                  type="number"
                  placeholder="cm"
                  value={product.derinlik || ''}
                  onChange={(e) => setProduct(s => ({ ...s, derinlik: e.target.value ? Number(e.target.value) : undefined }))}
                  min="0"
                  step="0.1"
                />
              </div>
            </div>
            {product.genislik && product.yukseklik && product.derinlik && (
              <div className="text-xs text-muted-foreground">
                Hesaplanan hacim: <span className="font-mono font-semibold">{((product.genislik * product.yukseklik * product.derinlik) / 1000).toFixed(2)} L</span>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isSaving}>İptal</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? <Loader2 className="animate-spin mr-2" /> : 'Kaydet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
