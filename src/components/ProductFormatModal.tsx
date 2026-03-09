
'use client';
import React, { useState, useEffect, FC } from 'react';
import { X, Loader2, ChevronDown, ChevronRight, Lock, Package, Tag, Cpu, BarChart3 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
import { cn } from '@/lib/utils';

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

/* ─── Collapsible Section ─── */
const Section: FC<{ title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, icon, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <span className="text-[var(--dashboard-muted)]">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)] flex-1">{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-[var(--dashboard-muted)]" /> : <ChevronRight className="h-4 w-4 text-[var(--dashboard-muted)]" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
};

/* ─── Neumorphic Input ─── */
const NeuInput: FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }> = ({ label, hint, className, ...props }) => (
  <div>
    <label className="text-xs font-semibold text-[var(--dashboard-text)] block mb-1.5">{label}</label>
    <input
      {...props}
      className={cn(
        "w-full px-3 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] border-none outline-none text-sm text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] disabled:opacity-50",
        className
      )}
    />
    {hint && <p className="text-[10px] text-[var(--dashboard-muted)] mt-1">{hint}</p>}
  </div>
);

/* ─── Neumorphic Select Wrapper ─── */
const NeuSelect: FC<{
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  placeholder: string;
  options: string[];
}> = ({ label, value, onValueChange, placeholder, options }) => (
  <div>
    <label className="text-xs font-semibold text-[var(--dashboard-text)] block mb-1.5">{label}</label>
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10 text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
);

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
  const isEditMode = !!initial.id;

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
      barcodeFormatId: multiFormatMode ? null : (product.barcodeFormatId || null),
      barcodeFormatIds: multiFormatMode ? ((product as any).barcodeFormatIds || []) : null,
      ambalajDegeri: product.ambalajDegeri || null,
      trackingMode: product.trackingMode || resolveDefaultTrackingMode(product as any),
      genislik: product.genislik || null,
      yukseklik: product.yukseklik || null,
      derinlik: product.derinlik || null,
    };

    try {
      if (product.id) {
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 glass-card rounded-3xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-3 border-b border-[var(--dashboard-stroke)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--dashboard-text)]">
              {isEditMode ? 'Ürün Düzenle' : 'Yeni Ürün'}
            </h2>
            {isEditMode && (
              <p className="text-xs text-[var(--dashboard-muted)] mt-0.5 font-mono">{product.stokKodu}</p>
            )}
            {!isEditMode && (
              <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">Temel bilgileri girin, detayları sonra tamamlayabilirsiniz</p>
            )}
          </div>
          <button onClick={onClose} className="neu-btn-universal w-9 h-9 rounded-xl flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* Section: Kimlik (Always Open) */}
          <Section title="Kimlik Bilgileri" icon={<Package className="h-4 w-4" />} defaultOpen={true}>
            <NeuInput
              label="Stok Kodu"
              name="stokKodu"
              value={product.stokKodu || ''}
              onChange={handleChange}
              disabled={isEditMode}
              placeholder="Örn: 03589301190"
              className="font-mono"
              hint={isEditMode ? "Stok kodu düzenlenemez." : undefined}
            />
            <NeuInput
              label="Stok Adı"
              name="stokAdi"
              value={product.stokAdi || ''}
              onChange={handleChange}
              placeholder="Örn: Cobas E411 Temizlik Solüsyonu"
            />
            <div className="grid grid-cols-2 gap-3">
              <NeuSelect
                label="Marka"
                value={product.marka || ''}
                onValueChange={(v) => handleSelectChange('marka', v)}
                placeholder="Seçin..."
                options={definitions.brands}
              />
              <div>
                <label className="text-xs font-semibold text-[var(--dashboard-text)] block mb-1.5">Ürün Grubu</label>
                <Select value={product.urunGrubu || 'kit'} onValueChange={(value) => handleSelectChange('urunGrubu', value as any)}>
                  <SelectTrigger className="bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kit">Kit</SelectItem>
                    <SelectItem value="sarf">Sarf Malzeme</SelectItem>
                    <SelectItem value="yedek_parca">Yedek Parça</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Section>

          {/* Section: Sınıflandırma */}
          <Section title="Sınıflandırma" icon={<Tag className="h-4 w-4" />} defaultOpen={isEditMode}>
            <NeuSelect
              label="Laboratuvar Grubu"
              value={product.laboratuvarGrubu || ''}
              onValueChange={(v) => handleSelectChange('laboratuvarGrubu', v)}
              placeholder="Seçin..."
              options={definitions.labGroups}
            />
            <div className="grid grid-cols-2 gap-3">
              <NeuSelect
                label="Test Grubu"
                value={product.testGrubu || ''}
                onValueChange={(v) => handleSelectChange('testGrubu', v)}
                placeholder="Seçin..."
                options={definitions.testGroups}
              />
              <NeuSelect
                label="Cihaz Grubu"
                value={product.cihazGrubu || ''}
                onValueChange={(v) => handleSelectChange('cihazGrubu', v)}
                placeholder="Seçin..."
                options={definitions.deviceGroups}
              />
            </div>
            <NeuInput
              label="Test Adı"
              name="testAdi"
              value={product.testAdi || ''}
              onChange={handleChange}
              placeholder="Örn: HbA1c, TSH, Ferritin..."
              hint="Ürünün çalıştığı testin adı (Total Verimlilik paneli için)."
            />
            <div className="grid grid-cols-2 gap-3">
              <NeuInput
                label="Ambalaj Değeri"
                type="number"
                name="ambalajDegeri"
                value={product.ambalajDegeri || ''}
                onChange={e => setProduct(p => ({ ...p, ambalajDegeri: e.target.value === '' ? undefined : Number(e.target.value) }))}
                placeholder="Örn: 100"
                hint="Test adedi / birim"
              />
              <NeuSelect
                label="Ana Birim"
                value={product.anaBirim || ''}
                onValueChange={(v) => handleSelectChange('anaBirim', v as any)}
                placeholder="Seçin..."
                options={definitions.mainUnits}
              />
            </div>
          </Section>

          {/* Section: İzleme / Barkod */}
          <Section title="Takip ve Barkod" icon={<Cpu className="h-4 w-4" />} defaultOpen={isEditMode}>
            <TrackingModeSelect
              value={product.trackingMode ?? 'qty_barcode'}
              onChange={(v) => setProduct((s) => ({ ...s, trackingMode: v }))}
            />

            <NeuInput
              label="Barkod Numarası (UDI)"
              value={product.barcodeNumber ?? ''}
              onChange={(e) => setProduct(s => ({ ...s, barcodeNumber: e.target.value.trim() }))}
              placeholder="Örn: 00812345678901"
              hint="Referans gömülü değilse ürünün benzersiz barkod numarası."
            />

            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--dashboard-surface)] shadow-[var(--dashboard-raised-soft)]">
              <div>
                <p className="text-xs font-semibold text-[var(--dashboard-text)]">Çoklu Format</p>
                <p className="text-[10px] text-[var(--dashboard-muted)]">Hem seri no hem lot takipli barkod formatları</p>
              </div>
              <Switch
                checked={multiFormatMode}
                onCheckedChange={(checked) => {
                  setMultiFormatMode(checked);
                  if (checked) {
                    const currentFormatId = product.barcodeFormatId;
                    setProduct(s => ({
                      ...s,
                      barcodeFormatIds: currentFormatId && currentFormatId !== '__auto__' ? [currentFormatId] : [],
                      barcodeFormatId: null
                    }));
                  } else {
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

            <div>
              <label className="text-xs font-semibold text-[var(--dashboard-text)] block mb-1.5">Barkod Formatı</label>
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
          </Section>

          {/* Section: Maliyet */}
          <Section title="Maliyet" icon={<BarChart3 className="h-4 w-4" />} defaultOpen={isEditMode}>
            <CostInput
              initialCost={product.cost || 0}
              initialCurrency={product.currency || 'EUR'}
              onCostChange={(newCost, newCurrency) => {
                setProduct(p => ({ ...p, cost: newCost, currency: newCurrency }));
              }}
            />
          </Section>

          {/* Section: Boyutlar (default closed) */}
          <Section title="Ürün Boyutları (cm)" icon={<Package className="h-4 w-4" />} defaultOpen={false}>
            <p className="text-[10px] text-[var(--dashboard-muted)] -mt-1 mb-2">Araç doluluk oranı hesaplaması için</p>
            <div className="grid grid-cols-3 gap-3">
              <NeuInput
                label="Genişlik"
                type="number"
                placeholder="cm"
                value={product.genislik || ''}
                onChange={(e) => setProduct(s => ({ ...s, genislik: e.target.value ? Number(e.target.value) : undefined }))}
              />
              <NeuInput
                label="Yükseklik"
                type="number"
                placeholder="cm"
                value={product.yukseklik || ''}
                onChange={(e) => setProduct(s => ({ ...s, yukseklik: e.target.value ? Number(e.target.value) : undefined }))}
              />
              <NeuInput
                label="Derinlik"
                type="number"
                placeholder="cm"
                value={product.derinlik || ''}
                onChange={(e) => setProduct(s => ({ ...s, derinlik: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>
            {product.genislik && product.yukseklik && product.derinlik && (
              <div className="text-xs text-[var(--dashboard-muted)] mt-1">
                Hesaplanan hacim: <span className="font-mono font-semibold">{((product.genislik * product.yukseklik * product.derinlik) / 1000).toFixed(2)} L</span>
              </div>
            )}
          </Section>
        </div>

        {/* Footer - Sticky */}
        <div className="flex items-center justify-between p-5 pt-3 border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
          <button onClick={onClose} className="neu-btn-universal px-5 py-2.5 rounded-xl text-sm font-semibold" disabled={isSaving}>
            İptal
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="neu-btn-universal neu-text-primary px-6 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
};
