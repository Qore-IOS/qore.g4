'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/document-helpers';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2, Edit2, Save, X, FileText, ChevronDown, ChevronUp, Check, ChevronsUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, addDoc, deleteDoc, doc, Timestamp, updateDoc } from '../../../lib/data/client';
import { db } from '../../../lib/data/client';
import BackButton from '@/components/BackButton';
import type { TransferTemplate, TransferTemplateItem, ProductCode } from '@/lib/types';
import { type TrackingMode, resolveDefaultTrackingMode } from '@/lib/tracking';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function TransferSablonlariPage() {
  const router = useRouter();
  const { currentUserProfile, isAdmin, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<TransferTemplate[]>([]);
  const [products, setProducts] = useState<ProductCode[]>([]);
  const [productTracking, setProductTracking] = useState<Record<string, TrackingMode>>({});

  // Create/Edit mode state
  const [isCreating, setIsCreating] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateItems, setTemplateItems] = useState<TransferTemplateItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Product selector state
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);
  const [selectedProductCode, setSelectedProductCode] = useState<string>('');

  // Delete confirmation state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Expanded template view
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);

  // Filter products to only show non-serial tracked products
  const availableProducts = useMemo(() => {
    return products.filter(p => {
      const tracking = productTracking[p.stokKodu] || resolveDefaultTrackingMode(p as any);
      return tracking !== 'serial';
    }).sort((a, b) => (a.stokAdi || '').localeCompare(b.stokAdi || ''));
  }, [products, productTracking]);

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [templateSnap, productSnap] = await Promise.all([
          getDocs(scopedQuery('transferTemplates', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
        ]);

        const templateList = templateSnap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.() || null,
          updatedAt: d.data().updatedAt?.toDate?.() || null,
        })) as TransferTemplate[];

        const productList = productSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode));

        // Build tracking map
        const trackingMap: Record<string, TrackingMode> = {};
        productList.forEach(p => {
          if (p.stokKodu && p.trackingMode) {
            trackingMap[p.stokKodu] = p.trackingMode;
          }
        });

        setTemplates(templateList.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
        setProducts(productList);
        setProductTracking(trackingMap);
      } catch (err) {
        console.error('Error fetching data:', err);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [toast]);

  const resetForm = useCallback(() => {
    setIsCreating(false);
    setEditingTemplateId(null);
    setTemplateName('');
    setTemplateItems([]);
    setSelectedProductCode('');
    setIsProductPopoverOpen(false);
  }, []);

  const handleStartCreate = () => {
    resetForm();
    setIsCreating(true);
  };

  const handleStartEdit = (template: TransferTemplate) => {
    setIsCreating(false);
    setEditingTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateItems([...template.items]);
  };

  const handleAddProduct = () => {
    if (!selectedProductCode) return;

    const product = products.find(p => p.stokKodu === selectedProductCode);
    if (!product) return;

    // Check if already added
    if (templateItems.some(item => item.stokKodu === selectedProductCode)) {
      toast({ title: 'Uyari', description: 'Bu urun zaten listede.', variant: 'default' });
      return;
    }

    const tracking = productTracking[selectedProductCode] || resolveDefaultTrackingMode(product as any);

    const newItem: TransferTemplateItem = {
      stokKodu: selectedProductCode,
      stokAdi: product.stokAdi || selectedProductCode,
      tracking: tracking,
      defaultQty: 1,
    };

    setTemplateItems(prev => [...prev, newItem]);
    setSelectedProductCode('');
    setIsProductPopoverOpen(false);
  };

  const handleRemoveItem = (stokKodu: string) => {
    setTemplateItems(prev => prev.filter(item => item.stokKodu !== stokKodu));
  };

  const handleUpdateItemQty = (stokKodu: string, qty: number) => {
    setTemplateItems(prev => prev.map(item =>
      item.stokKodu === stokKodu ? { ...item, defaultQty: qty } : item
    ));
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      toast({ title: 'Uyari', description: 'Sablon adi bos olamaz.', variant: 'destructive' });
      return;
    }

    if (templateItems.length === 0) {
      toast({ title: 'Uyari', description: 'En az bir urun ekleyin.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      if (editingTemplateId) {
        // Update existing template
        await updateDoc(doc(db, 'transferTemplates', editingTemplateId), {
          name: templateName.trim(),
          items: templateItems,
          updatedAt: Timestamp.now(),
          updatedByUid: currentUserProfile?.uid,
          updatedByName: currentUserProfile?.name || 'Bilinmeyen',
        });

        setTemplates(prev => prev.map(t =>
          t.id === editingTemplateId
            ? { ...t, name: templateName.trim(), items: templateItems, updatedAt: new Date() }
            : t
        ).sort((a, b) => (a.name || '').localeCompare(b.name || '')));

        toast({ title: 'Guncellendi', description: 'Sablon guncellendi.' });
      } else {
        // Create new template
        const docRef = await addDoc(collection(db, 'transferTemplates'), withCompanyScope({
          name: templateName.trim(),
          items: templateItems,
          createdAt: Timestamp.now(),
          createdByUid: currentUserProfile?.uid,
          createdByName: currentUserProfile?.name || 'Bilinmeyen',
        }, currentCompanyId));

        const newTemplate: TransferTemplate = {
          id: docRef.id,
          name: templateName.trim(),
          items: templateItems,
          createdAt: new Date(),
          createdByUid: currentUserProfile?.uid || '',
          createdByName: currentUserProfile?.name || 'Bilinmeyen',
        };

        setTemplates(prev => [...prev, newTemplate].sort((a, b) => (a.name || '').localeCompare(b.name || '')));

        toast({ title: 'Eklendi', description: 'Sablon olusturuldu.' });
      }

      resetForm();
    } catch (err) {
      console.error('Error saving template:', err);
      toast({ title: 'Hata', description: 'Sablon kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'transferTemplates', id));
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast({ title: 'Silindi', description: 'Sablon silindi.' });
    } catch (err) {
      console.error('Error deleting template:', err);
      toast({ title: 'Hata', description: 'Sablon silinemedi.', variant: 'destructive' });
    }
    setDeleteConfirmId(null);
  };

  const getTrackingLabel = (tracking: TrackingMode) => {
    switch (tracking) {
      case 'lot_barcode': return 'Lot Barkod';
      case 'lot_manual': return 'Lot Manuel';
      case 'qty_barcode': return 'Adet Barkod';
      case 'qty_manual': return 'Adet Manuel';
      default: return tracking;
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

  const isEditing = isCreating || editingTemplateId !== null;

  return (
    <div className="p-4 space-y-6">
      <BackButton fallback="/direkt-transfer" />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-6 w-6" />
                Transfer Sablonlari
              </CardTitle>
              <CardDescription>
                Sik kullanilan transfer listelerini sablon olarak kaydedin ve hizlica uygulayin.
              </CardDescription>
            </div>
            {!isEditing && (
              <Button onClick={handleStartCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Yeni Sablon
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {/* Create/Edit Form */}
          {isEditing && (
            <div className="mb-6 p-4 border rounded-lg bg-muted/30">
              <h3 className="font-semibold mb-4">
                {editingTemplateId ? 'Sablonu Duzenle' : 'Yeni Sablon Olustur'}
              </h3>

              <div className="space-y-4">
                {/* Template Name */}
                <div>
                  <Label className="text-sm">Sablon Adi</Label>
                  <Input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="Sablon adi girin..."
                    className="max-w-md mt-1"
                  />
                </div>

                {/* Product Selector */}
                <div>
                  <Label className="text-sm">Urun Ekle</Label>
                  <div className="flex gap-2 mt-1">
                    <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={isProductPopoverOpen}
                          className="w-full max-w-md justify-between font-normal"
                        >
                          <span className="truncate">
                            {selectedProductCode
                              ? products.find(p => p.stokKodu === selectedProductCode)?.stokAdi || selectedProductCode
                              : 'Urun secin...'}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0">
                        <Command>
                          <CommandInput placeholder="Urun ara..." />
                          <CommandList>
                            <CommandEmpty>Urun bulunamadi.</CommandEmpty>
                            <CommandGroup>
                              {availableProducts.map(p => (
                                <CommandItem
                                  key={p.stokKodu}
                                  value={`${p.stokAdi} ${p.stokKodu}`}
                                  onSelect={() => {
                                    setSelectedProductCode(p.stokKodu);
                                    setIsProductPopoverOpen(false);
                                  }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", selectedProductCode === p.stokKodu ? "opacity-100" : "opacity-0")} />
                                  <div className="flex flex-col">
                                    <span>{p.stokAdi}</span>
                                    <span className="text-xs text-muted-foreground">{p.stokKodu}</span>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <Button onClick={handleAddProduct} disabled={!selectedProductCode}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Template Items List */}
                {templateItems.length > 0 && (
                  <div>
                    <Label className="text-sm">Sablon Urunleri ({templateItems.length})</Label>
                    <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                      {templateItems.map((item, idx) => (
                        <div
                          key={item.stokKodu}
                          className="flex items-center gap-3 p-3 bg-background border rounded-lg"
                        >
                          <span className="text-xs text-muted-foreground w-6">{idx + 1}.</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.stokAdi}</p>
                            <p className="text-xs text-muted-foreground">{item.stokKodu} - {getTrackingLabel(item.tracking)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground">Adet:</Label>
                            <Input
                              type="number"
                              min={1}
                              value={item.defaultQty || 1}
                              onChange={(e) => handleUpdateItemQty(item.stokKodu, parseInt(e.target.value) || 1)}
                              className="w-20 h-8"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveItem(item.stokKodu)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Kaydet
                  </Button>
                  <Button variant="outline" onClick={resetForm}>
                    <X className="h-4 w-4 mr-2" />
                    Iptal
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Template List */}
          <div className="space-y-3">
            {templates.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Henuz sablon olusturulmamis.
              </p>
            ) : (
              templates.map(template => (
                <div
                  key={template.id}
                  className="border rounded-lg overflow-hidden"
                >
                  {/* Template Header */}
                  <div
                    className="flex items-center justify-between p-4 bg-muted/30 cursor-pointer"
                    onClick={() => setExpandedTemplateId(expandedTemplateId === template.id ? null : template.id)}
                  >
                    <div className="flex items-center gap-3">
                      {expandedTemplateId === template.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      <div>
                        <p className="font-medium">{template.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {template.items.length} urun
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartEdit(template)}
                        disabled={isEditing}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteConfirmId(template.id)}
                        disabled={isEditing}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {/* Template Items (Expanded) */}
                  {expandedTemplateId === template.id && (
                    <div className="p-4 border-t space-y-2">
                      {template.items.map((item, idx) => (
                        <div
                          key={item.stokKodu}
                          className="flex items-center gap-3 p-2 bg-muted/20 rounded"
                        >
                          <span className="text-xs text-muted-foreground w-6">{idx + 1}.</span>
                          <div className="flex-1">
                            <p className="text-sm">{item.stokAdi}</p>
                            <p className="text-xs text-muted-foreground">{item.stokKodu}</p>
                          </div>
                          <span className="text-xs px-2 py-1 bg-muted rounded">
                            {getTrackingLabel(item.tracking)}
                          </span>
                          <span className="text-sm font-medium">
                            x{item.defaultQty || 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sablonu Sil</AlertDialogTitle>
            <AlertDialogDescription>
              Bu sablonu silmek istediginize emin misiniz? Bu islem geri alinamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Iptal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
