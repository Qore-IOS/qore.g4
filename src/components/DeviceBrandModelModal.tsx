'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Plus, Trash2, Edit3, ArrowLeft, ChevronRight,
  Upload, Download, Search, X, Server, Check,
} from 'lucide-react';
import { collection, getDocs, addDoc, deleteDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { cn, readExcelData, exportDataToExcel } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

export interface DeviceBrandModel {
  id: string;
  brand: string;
  model: string;
  imageUrl?: string;
  createdAt?: any;
}

interface DeviceBrandModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ModalView = 'list' | 'create' | 'edit';

// ============================================================================
// COMPONENT
// ============================================================================

export default function DeviceBrandModelModal({ open, onOpenChange }: DeviceBrandModelModalProps) {
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [items, setItems] = useState<DeviceBrandModel[]>([]);
  const [view, setView] = useState<ModalView>('list');
  const [searchQuery, setSearchQuery] = useState('');

  // Form state
  const [formBrand, setFormBrand] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [editingItem, setEditingItem] = useState<DeviceBrandModel | null>(null);

  // Grouped brands
  const brandGroups = React.useMemo(() => {
    const map = new Map<string, DeviceBrandModel[]>();
    const q = searchQuery.toLowerCase();
    items
      .filter(i => !q || i.brand.toLowerCase().includes(q) || i.model.toLowerCase().includes(q))
      .forEach(item => {
        if (!map.has(item.brand)) map.set(item.brand, []);
        map.get(item.brand)!.push(item);
      });
    // Sort brands alphabetically
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'tr'));
  }, [items, searchQuery]);

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'deviceBrandModels'));
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as DeviceBrandModel)));
    } catch (err) {
      console.error('Error fetching brand models:', err);
      toast({ title: 'Hata', description: 'Marka/model verileri yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      fetchItems();
      setView('list');
      setSearchQuery('');
    }
  }, [open, fetchItems]);

  const handleStartCreate = () => {
    setFormBrand('');
    setFormModel('');
    setFormImageUrl('');
    setEditingItem(null);
    setView('create');
  };

  const handleStartEdit = (item: DeviceBrandModel) => {
    setFormBrand(item.brand);
    setFormModel(item.model);
    setFormImageUrl(item.imageUrl || '');
    setEditingItem(item);
    setView('edit');
  };

  const handleSave = async () => {
    if (!formBrand.trim() || !formModel.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Marka ve model alanları zorunludur.', variant: 'destructive' });
      return;
    }

    // Duplicate check
    const exists = items.some(i =>
      i.brand.toLowerCase() === formBrand.trim().toLowerCase() &&
      i.model.toLowerCase() === formModel.trim().toLowerCase() &&
      i.id !== editingItem?.id
    );
    if (exists) {
      toast({ title: 'Tekrar', description: 'Bu marka ve model zaten tanımlı.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      if (editingItem) {
        await updateDoc(doc(db, 'deviceBrandModels', editingItem.id), {
          brand: formBrand.trim(),
          model: formModel.trim(),
          imageUrl: formImageUrl.trim() || null,
        });
        toast({ title: 'Güncellendi', description: 'Marka/model güncellendi.' });
      } else {
        await addDoc(collection(db, 'deviceBrandModels'), {
          brand: formBrand.trim(),
          model: formModel.trim(),
          imageUrl: formImageUrl.trim() || null,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
        toast({ title: 'Oluşturuldu', description: 'Yeni marka/model eklendi.' });
      }
      fetchItems();
      setView('list');
    } catch (err) {
      console.error('Error saving brand model:', err);
      toast({ title: 'Hata', description: 'Kayıt başarısız.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: DeviceBrandModel) => {
    if (!confirm(`"${item.brand} - ${item.model}" silinsin mi?`)) return;
    try {
      await deleteDoc(doc(db, 'deviceBrandModels', item.id));
      toast({ title: 'Silindi', description: 'Marka/model silindi.' });
      fetchItems();
    } catch (err) {
      toast({ title: 'Hata', description: 'Silme başarısız.', variant: 'destructive' });
    }
  };

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const rows = await readExcelData(file, toast);
      if (!rows || rows.length === 0) {
        toast({ title: 'Boş Dosya', description: 'Excel dosyasında veri bulunamadı.', variant: 'destructive' });
        return;
      }

      let imported = 0;
      const existingKeys = new Set(
        items.map(i => `${i.brand.trim().toLocaleLowerCase('tr')}::${i.model.trim().toLocaleLowerCase('tr')}`)
      );
      const seenInFile = new Set<string>();
      for (const row of rows) {
        const brand = (row['Marka'] || row['marka'] || row['Brand'] || row['brand'] || '').toString().trim();
        const model = (row['Model'] || row['model'] || '').toString().trim();
        const imageUrl = (row['Gorsel'] || row['gorsel'] || row['ImageUrl'] || row['imageUrl'] || '').toString().trim();

        if (!brand || !model) continue;
        const key = `${brand.toLocaleLowerCase('tr')}::${model.toLocaleLowerCase('tr')}`;
        if (existingKeys.has(key) || seenInFile.has(key)) continue;

        await addDoc(collection(db, 'deviceBrandModels'), {
          brand,
          model,
          imageUrl: imageUrl || null,
          createdAt: serverTimestamp(),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || '',
        });
        seenInFile.add(key);
        imported++;
      }

      toast({ title: 'Tamamlandı', description: `${imported} yeni marka/model eklendi.` });
      fetchItems();
    } catch (err) {
      console.error('Excel import error:', err);
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTemplateDownload = () => {
    const templateRows = [
      { Marka: 'Roche', Model: 'Cobas e 411', Gorsel: '' },
      { Marka: 'Roche', Model: 'Cobas c 311', Gorsel: '' },
      { Marka: 'Roche', Model: 'Cobas pure', Gorsel: '' },
    ];
    exportDataToExcel(templateRows, 'Marka_Model_Sablon', 'Sablon', toast);
    toast({ title: 'Şablon İndirildi', description: 'Excel şablonunu doldurup içe aktarabilirsiniz.' });
  };

  const handleExcelExport = () => {
    const data = items.map(i => ({
      Marka: i.brand,
      Model: i.model,
      Gorsel: i.imageUrl || '',
    }));
    exportDataToExcel(data, 'Cihaz_Marka_Model', 'Marka/Model', toast);
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col cihaz-card-strong !rounded-3xl !p-0 !gap-0 border-0">
        {view === 'list' ? (
          <>
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-[var(--dashboard-stroke)]">
              <div className="flex items-center gap-3 mb-1">
                <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
                  <Server className="h-4 w-4 text-[var(--dashboard-accent)]" />
                </span>
                <div>
                  <DialogTitle className="text-base font-bold text-[var(--dashboard-text)]">Cihaz Marka & Model Tanımları</DialogTitle>
                  <p className="text-xs text-[var(--dashboard-muted)]">Cihaz markalarını ve modellerini tanımlayın, Excel ile toplu ekleyin.</p>
                </div>
              </div>

              {/* Controls row */}
              <div className="flex items-center gap-2 mt-4">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
                  <Input
                    type="text"
                    placeholder="Marka veya model ara..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTemplateDownload}
                  className="h-9 text-xs shrink-0"
                >
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Şablon
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExcelExport}
                  className="h-9 text-xs shrink-0"
                >
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Excel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-9 text-xs shrink-0"
                >
                  <Upload className="w-3.5 h-3.5 mr-1" />
                  Excel Yükle
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleExcelImport}
                  className="hidden"
                />
                <Button
                  size="sm"
                  onClick={handleStartCreate}
                  className="h-9 text-xs shrink-0 bg-[var(--dashboard-accent)] hover:bg-[var(--dashboard-accent)]/90 text-white"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Ekle
                </Button>
              </div>

              {/* Summary badges */}
              <div className="flex gap-2 mt-3">
                <div className="cihaz-pressed px-3 py-1.5 text-center">
                  <div className="text-sm font-bold text-[var(--dashboard-text)]">{brandGroups.length}</div>
                  <div className="text-[10px] text-[var(--dashboard-muted)]">Marka</div>
                </div>
                <div className="cihaz-pressed px-3 py-1.5 text-center">
                  <div className="text-sm font-bold text-[var(--dashboard-text)]">{items.length}</div>
                  <div className="text-[10px] text-[var(--dashboard-muted)]">Model</div>
                </div>
              </div>
            </div>

            {/* Content */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4 space-y-3">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-[var(--dashboard-accent)]" />
                  </div>
                ) : brandGroups.length === 0 ? (
                  <div className="text-center py-12">
                    <Server className="h-10 w-10 mx-auto mb-3 text-[var(--dashboard-muted)] opacity-40" />
                    <p className="text-sm text-[var(--dashboard-muted)]">
                      {searchQuery ? 'Aramayla eslesen marka/model bulunamadi.' : 'Henuz marka/model tanimlanmamis.'}
                    </p>
                    {!searchQuery && (
                      <Button size="sm" onClick={handleStartCreate} className="mt-3 bg-[var(--dashboard-accent)] text-white">
                        <Plus className="w-3.5 h-3.5 mr-1" /> Ilk Marka/Model Ekle
                      </Button>
                    )}
                  </div>
                ) : (
                  brandGroups.map(([brand, models]) => (
                    <div key={brand} className="cihaz-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-[var(--dashboard-text)]">{brand}</h3>
                        <Badge variant="outline" className="text-[10px]">{models.length} model</Badge>
                      </div>
                      <div className="space-y-1.5">
                        {models.sort((a, b) => a.model.localeCompare(b.model, 'tr')).map(item => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--dashboard-surface-2)]/50 hover:bg-[var(--dashboard-surface-2)] transition-colors group"
                          >
                            <span className="text-sm text-[var(--dashboard-text)]">{item.model}</span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleStartEdit(item)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--dashboard-muted)] hover:text-[var(--dashboard-accent)] hover:bg-[var(--dashboard-surface-2)] transition-colors"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(item)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--dashboard-muted)] hover:text-red-500 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[var(--dashboard-stroke)]">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="w-full h-10 rounded-xl"
              >
                Kapat
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Create/Edit Form */}
            <div className="px-6 pt-6 pb-4 border-b border-[var(--dashboard-stroke)]">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setView('list')}
                  className="w-8 h-8 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <DialogTitle className="text-base font-bold text-[var(--dashboard-text)]">
                  {editingItem ? 'Marka/Model Duzenle' : 'Yeni Marka & Model'}
                </DialogTitle>
              </div>
            </div>

            <div className="px-6 py-6 space-y-5 flex-1">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
                  Marka *
                </label>
                <Input
                  placeholder="Ornek: Roche"
                  value={formBrand}
                  onChange={(e) => setFormBrand(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
                  Model *
                </label>
                <Input
                  placeholder="Ornek: cobas c 501"
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-[var(--dashboard-muted)] uppercase tracking-wider">
                  Gorsel Yolu (Opsiyonel)
                </label>
                <Input
                  placeholder="devices/roche-cobas-c501.png"
                  value={formImageUrl}
                  onChange={(e) => setFormImageUrl(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[var(--dashboard-stroke)] flex gap-2">
              <Button
                variant="outline"
                onClick={() => setView('list')}
                disabled={isSaving}
                className="flex-1 h-10 rounded-xl"
              >
                Iptal
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || !formBrand.trim() || !formModel.trim()}
                className="flex-1 h-10 rounded-xl bg-[var(--dashboard-accent)] hover:bg-[var(--dashboard-accent)]/90 text-white"
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                {editingItem ? 'Guncelle' : 'Olustur'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
