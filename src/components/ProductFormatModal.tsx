
'use client';
import React, { useState, useEffect, FC } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, GitBranchPlus } from 'lucide-react';
import type { ProductCode, Currency } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { doc, addDoc, collection, getDocs, query, where, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CostInput } from './CostInput';
import { useAuth } from '@/contexts/auth-context';
import TrackingModeSelect from './TrackingModeSelect';
import { TrackingMode, resolveDefaultTrackingMode, TRACKING_MODE_LABEL } from '@/lib/tracking';
import BarcodeFormatSelect from './BarcodeFormatSelect';
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
  versions?: ProductCode[];
  onSetActiveVersion?: (versionId: string) => Promise<void>;
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

const toVersionedPayload = (
  input: Partial<ProductCode & { trackingMode: TrackingMode }>,
  multiFormatMode: boolean,
): Omit<ProductCode, 'id'> => ({
  stokKodu: String(input.stokKodu || '').trim(),
  stokAdi: String(input.stokAdi || '').trim(),
  urunGrubu: input.urunGrubu || 'kit',
  anaBirim: input.anaBirim || 'Kutu',
  cost: input.cost || 0,
  currency: input.currency || 'EUR',
  marka: String(input.marka || '').trim() || null,
  laboratuvarGrubu: String(input.laboratuvarGrubu || '').trim() || null,
  testGrubu: String(input.testGrubu || '').trim() || null,
  cihazGrubu: String(input.cihazGrubu || '').trim() || null,
  testAdi: String(input.testAdi || '').trim() || null,
  barcodeNumber: String(input.barcodeNumber || '').trim() || null,
  barcodeFormatId: multiFormatMode ? null : (input.barcodeFormatId || null),
  barcodeFormatIds: multiFormatMode ? ((input as any).barcodeFormatIds || []) : null,
  ambalajDegeri: input.ambalajDegeri || null,
  trackingMode: input.trackingMode || resolveDefaultTrackingMode(input as any),
  genislik: input.genislik || null,
  yukseklik: input.yukseklik || null,
  derinlik: input.derinlik || null,
});


export const ProductFormatModal: FC<ProductFormatModalProps> = ({
  open,
  initial,
  onSave,
  onClose,
  productCodes,
  definitions,
  versions = [],
  onSetActiveVersion,
}) => {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [product, setProduct] = useState<Partial<ProductCode & { trackingMode: TrackingMode }>>({
    ...initial,
    trackingMode: resolveDefaultTrackingMode(initial as any),
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [versionDraft, setVersionDraft] = useState<Partial<ProductCode & { trackingMode: TrackingMode }>>({
    ...initial,
    id: undefined,
    stokKodu: '',
    trackingMode: resolveDefaultTrackingMode(initial as any),
  });
  const [isVersionSaving, setIsVersionSaving] = useState(false);

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
    setVersionDraft({
      ...initial,
      id: undefined,
      stokKodu: '',
      trackingMode: resolveDefaultTrackingMode(initial as any),
    });
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
    const productData = toVersionedPayload(product, multiFormatMode);

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

  const handleVersionChangeSave = async () => {
    if (!currentUser || !product.id) return;
    if (!versionDraft.stokKodu?.trim() || !versionDraft.stokAdi?.trim()) {
      toast({ title: 'Hata', description: 'Yeni versiyon için stok kodu ve stok adı zorunludur.', variant: 'destructive' });
      return;
    }

    setIsVersionSaving(true);
    try {
      const nextCode = versionDraft.stokKodu.trim();
      const duplicate = productCodes.find(p => p.stokKodu === nextCode);
      if (duplicate) {
        toast({ title: 'Hata', description: 'Bu stok kodu zaten kullanılıyor.', variant: 'destructive' });
        return;
      }

      const currentVersion = Number((product as any).versionNumber || 1);
      const versionGroupId = (product as any).versionGroupId || product.id;
      const payload = cleanDataForFirestore({
        ...toVersionedPayload(versionDraft, multiFormatMode),
        versionGroupId,
        versionNumber: currentVersion + 1,
        isActiveVersion: true,
        previousVersionId: product.id,
        updatedByUid: currentUser.uid,
        updatedByName: (currentUser as any).name || currentUser.email || '',
      });

      const batch = writeBatch(db);
      const newDocRef = doc(collection(db, 'productCodes'));
      batch.set(newDocRef, payload);
      batch.update(doc(db, 'productCodes', product.id), {
        versionGroupId,
        versionNumber: currentVersion,
        isActiveVersion: false,
      });
      await batch.commit();

      toast({ title: 'Başarılı', description: 'Versiyon değişikliği kaydedildi.' });
      setIsVersionModalOpen(false);
      onSave({ id: newDocRef.id, ...(payload as any) } as ProductCode);
      onClose();
    } catch (error: any) {
      toast({ title: 'Hata', description: `Versiyon değiştirilemedi: ${error.code || error.message}`, variant: 'destructive' });
    } finally {
      setIsVersionSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>{product.id ? 'Ürün Düzenle' : 'Yeni Ürün'}</DialogTitle>
            {product.id && (
              <Button size="sm" variant="secondary" onClick={() => setIsVersionModalOpen(true)}>
                <GitBranchPlus className="mr-2 h-4 w-4" /> Versiyon Değişikliği
              </Button>
            )}
          </div>
        </DialogHeader>
        <div className="space-y-3 py-3 max-h-[70vh] overflow-y-auto pr-2">
          {product.id && versions.length > 0 && (
            <div className="border rounded-md p-3 bg-muted/40 space-y-2">
              <p className="text-xs font-medium">Versiyonlar</p>
              <div className="space-y-1">
                {versions
                  .slice()
                  .sort((a, b) => Number((b as any).versionNumber || 1) - Number((a as any).versionNumber || 1))
                  .map((v) => (
                    <div key={v.id} className="flex items-center justify-between text-xs">
                      <span className="font-mono">v{(v as any).versionNumber || 1} · {v.stokKodu} · {v.stokAdi}</span>
                      {(v as any).isActiveVersion === false ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onSetActiveVersion?.(v.id)}
                        >
                          Aktif Yap
                        </Button>
                      ) : (
                        <span className="text-emerald-600 font-semibold">Aktif</span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
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
              value={String((product as any).testAdi || '')}
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
                  value={Number((product as any).genislik || 0) || ''}
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
                  value={Number((product as any).yukseklik || 0) || ''}
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
                  value={Number((product as any).derinlik || 0) || ''}
                  onChange={(e) => setProduct(s => ({ ...s, derinlik: e.target.value ? Number(e.target.value) : undefined }))}
                  min="0"
                  step="0.1"
                />
              </div>
            </div>
            {Number((product as any).genislik) && Number((product as any).yukseklik) && Number((product as any).derinlik) && (
              <div className="text-xs text-muted-foreground">
                Hesaplanan hacim: <span className="font-mono font-semibold">{((Number((product as any).genislik) * Number((product as any).yukseklik) * Number((product as any).derinlik)) / 1000).toFixed(2)} L</span>
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

    <Dialog open={isVersionModalOpen} onOpenChange={setIsVersionModalOpen}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Versiyon Değişikliği</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-2 border rounded-md p-3">
            <p className="text-sm font-semibold">Eski Bilgiler</p>
            <Input value={product.stokKodu || ''} disabled />
            <Input value={product.stokAdi || ''} disabled />
            <Input value={product.marka || ''} disabled />
            <Input value={product.laboratuvarGrubu || ''} disabled />
            <Input value={product.testGrubu || ''} disabled />
            <Input value={String((product as any).testAdi || '')} disabled />
            <Input value={product.cihazGrubu || ''} disabled />
            <Input value={product.urunGrubu || ''} disabled />
            <Input value={String(product.ambalajDegeri || '')} disabled />
            <Input value={product.anaBirim || ''} disabled />
            <Input value={product.barcodeNumber || ''} disabled />
            <Input value={String(product.cost || '')} disabled />
            <Input value={product.currency || ''} disabled />
            <Input value={String(product.genislik || '')} disabled />
            <Input value={String(product.yukseklik || '')} disabled />
            <Input value={String(product.derinlik || '')} disabled />
          </div>

          <div className="space-y-2 border rounded-md p-3">
            <p className="text-sm font-semibold">Yeni Bilgiler</p>
            <Input
              placeholder="Yeni Stok Kodu"
              value={versionDraft.stokKodu || ''}
              onChange={(e) => setVersionDraft(s => ({ ...s, stokKodu: e.target.value }))}
            />
            <Input value={versionDraft.stokAdi || ''} onChange={(e) => setVersionDraft(s => ({ ...s, stokAdi: e.target.value }))} />
            <Input value={versionDraft.marka || ''} onChange={(e) => setVersionDraft(s => ({ ...s, marka: e.target.value }))} />
            <Input value={versionDraft.laboratuvarGrubu || ''} onChange={(e) => setVersionDraft(s => ({ ...s, laboratuvarGrubu: e.target.value }))} />
            <Input value={versionDraft.testGrubu || ''} onChange={(e) => setVersionDraft(s => ({ ...s, testGrubu: e.target.value }))} />
            <Input value={String((versionDraft as any).testAdi || '')} onChange={(e) => setVersionDraft(s => ({ ...s, testAdi: e.target.value }))} />
            <Input value={versionDraft.cihazGrubu || ''} onChange={(e) => setVersionDraft(s => ({ ...s, cihazGrubu: e.target.value }))} />
            <Input value={versionDraft.urunGrubu || ''} onChange={(e) => setVersionDraft(s => ({ ...s, urunGrubu: e.target.value as any }))} />
            <Input type="number" value={versionDraft.ambalajDegeri || ''} onChange={(e) => setVersionDraft(s => ({ ...s, ambalajDegeri: e.target.value ? Number(e.target.value) : undefined }))} />
            <Input value={versionDraft.anaBirim || ''} onChange={(e) => setVersionDraft(s => ({ ...s, anaBirim: e.target.value }))} />
            <Input value={versionDraft.barcodeNumber || ''} onChange={(e) => setVersionDraft(s => ({ ...s, barcodeNumber: e.target.value }))} />
            <Input type="number" value={versionDraft.cost || ''} onChange={(e) => setVersionDraft(s => ({ ...s, cost: e.target.value ? Number(e.target.value) : undefined }))} />
            <Input value={versionDraft.currency || ''} onChange={(e) => setVersionDraft(s => ({ ...s, currency: e.target.value as Currency }))} />
            <Input type="number" value={Number((versionDraft as any).genislik || 0) || ''} onChange={(e) => setVersionDraft(s => ({ ...s, genislik: e.target.value ? Number(e.target.value) : undefined }))} />
            <Input type="number" value={Number((versionDraft as any).yukseklik || 0) || ''} onChange={(e) => setVersionDraft(s => ({ ...s, yukseklik: e.target.value ? Number(e.target.value) : undefined }))} />
            <Input type="number" value={Number((versionDraft as any).derinlik || 0) || ''} onChange={(e) => setVersionDraft(s => ({ ...s, derinlik: e.target.value ? Number(e.target.value) : undefined }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsVersionModalOpen(false)}>İptal</Button>
          <Button onClick={handleVersionChangeSave} disabled={isVersionSaving}>
            {isVersionSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
