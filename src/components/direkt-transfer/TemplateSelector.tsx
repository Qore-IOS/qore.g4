/**
 * @fileoverview Template Selector Component for Direct Transfer
 * @description Allows users to select a saved transfer template and add its products
 * to the transfer list with lot/quantity selection.
 * @module components/direkt-transfer/TemplateSelector
 * @version 1.0.0
 */

'use client';
import { useMemo, useState, useCallback } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '../ui/label';
import type { TransferTemplate, TransferTemplateItem, DepoStokItem } from '@/lib/types';
import { Loader2, ChevronDown, ChevronUp, Check, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type LotPayload = { code: string; name: string; lot: string; miad: string; qty: number };
type QtyPayload = { code: string; name: string; qty: number };

interface TemplateItemSelection {
  stokKodu: string;
  selectedLotKey: string; // For lot-tracked products
  quantity: number;
  isLotTracked: boolean;
}

export default function TemplateSelector({
  visible,
  onClose,
  templates,
  templatesLoading,
  stockPool,
  transferRows,
  onAddLot,
  onAddQty,
}: {
  visible: boolean;
  onClose: () => void;
  templates: TransferTemplate[];
  templatesLoading: boolean;
  stockPool: DepoStokItem[];
  transferRows: TransferRow[];
  onAddLot: (p: LotPayload) => void;
  onAddQty: (p: QtyPayload) => void;
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [itemSelections, setItemSelections] = useState<Record<string, TemplateItemSelection>>({});
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const selectedTemplate = useMemo(() =>
    templates.find(t => t.id === selectedTemplateId),
    [templates, selectedTemplateId]
  );

  // Build available lots for each product in the template
  const availableLotsMap = useMemo(() => {
    if (!selectedTemplate) return {};

    const map: Record<string, { key: string; label: string; remaining: number }[]> = {};

    selectedTemplate.items.forEach(item => {
      if (item.tracking === 'lot_barcode' || item.tracking === 'lot_manual') {
        const lotsInStock = stockPool.filter(s => s.stokKodu === item.stokKodu && !s.isShipped);
        const uniqueLots = Array.from(new Set(lotsInStock.map(s => `${s.lotNumarasi || 'N/A'}|${s.miad || 'N/A'}`)));

        map[item.stokKodu] = uniqueLots.map(key => {
          const [lotNum, miadVal] = key.split('|');
          const count = lotsInStock.filter(s => (s.lotNumarasi || 'N/A') === lotNum && (s.miad || 'N/A') === miadVal).length;
          const allocated = transferRows.filter(r => r.stokKodu === item.stokKodu && r.lotNumarasi === lotNum && r.miad === miadVal).reduce((sum, r) => sum + (r.adet ?? 1), 0);
          return { key, label: `${lotNum} - ${miadVal}`, remaining: count - allocated };
        });
      }
    });

    return map;
  }, [selectedTemplate, stockPool, transferRows]);

  // Calculate total stock for qty-tracked products
  const totalStockMap = useMemo(() => {
    if (!selectedTemplate) return {};

    const map: Record<string, number> = {};

    selectedTemplate.items.forEach(item => {
      if (item.tracking === 'qty_barcode' || item.tracking === 'qty_manual') {
        const itemsInStock = stockPool.filter(s => s.stokKodu === item.stokKodu && !s.isShipped);
        const totalCount = itemsInStock.length;
        const allocated = transferRows.filter(r => r.stokKodu === item.stokKodu).reduce((sum, r) => sum + (r.adet ?? 1), 0);
        map[item.stokKodu] = totalCount - allocated;
      }
    });

    return map;
  }, [selectedTemplate, stockPool, transferRows]);

  const handleTemplateSelect = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);

    const template = templates.find(t => t.id === templateId);
    if (!template) {
      setItemSelections({});
      return;
    }

    // Initialize selections for all items
    const selections: Record<string, TemplateItemSelection> = {};
    template.items.forEach(item => {
      const isLotTracked = item.tracking === 'lot_barcode' || item.tracking === 'lot_manual';
      selections[item.stokKodu] = {
        stokKodu: item.stokKodu,
        selectedLotKey: '',
        quantity: item.defaultQty || 1,
        isLotTracked,
      };
    });
    setItemSelections(selections);
    setExpandedItems(new Set(template.items.map(i => i.stokKodu)));
  }, [templates]);

  const handleLotChange = (stokKodu: string, lotKey: string) => {
    setItemSelections(prev => ({
      ...prev,
      [stokKodu]: { ...prev[stokKodu], selectedLotKey: lotKey },
    }));
  };

  const handleQtyChange = (stokKodu: string, qty: number) => {
    setItemSelections(prev => ({
      ...prev,
      [stokKodu]: { ...prev[stokKodu], quantity: qty },
    }));
  };

  const toggleExpanded = (stokKodu: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stokKodu)) {
        newSet.delete(stokKodu);
      } else {
        newSet.add(stokKodu);
      }
      return newSet;
    });
  };

  const handleAddItem = (item: TransferTemplateItem) => {
    const selection = itemSelections[item.stokKodu];
    if (!selection) return;

    if (selection.isLotTracked) {
      if (!selection.selectedLotKey) return;
      const [lotNum, miadVal] = selection.selectedLotKey.split('|');
      onAddLot({
        code: item.stokKodu,
        name: item.stokAdi,
        lot: lotNum,
        miad: miadVal,
        qty: selection.quantity,
      });
    } else {
      onAddQty({
        code: item.stokKodu,
        name: item.stokAdi,
        qty: selection.quantity,
      });
    }

    // Reset this item's selection
    setItemSelections(prev => ({
      ...prev,
      [item.stokKodu]: { ...prev[item.stokKodu], selectedLotKey: '', quantity: item.defaultQty || 1 },
    }));
  };

  const handleAddAllItems = () => {
    if (!selectedTemplate) return;

    selectedTemplate.items.forEach(item => {
      const selection = itemSelections[item.stokKodu];
      if (!selection) return;

      // For lot-tracked items, only add if lot is selected
      if (selection.isLotTracked) {
        if (!selection.selectedLotKey) return;
        const [lotNum, miadVal] = selection.selectedLotKey.split('|');
        onAddLot({
          code: item.stokKodu,
          name: item.stokAdi,
          lot: lotNum,
          miad: miadVal,
          qty: selection.quantity,
        });
      } else {
        onAddQty({
          code: item.stokKodu,
          name: item.stokAdi,
          qty: selection.quantity,
        });
      }
    });

    // Reset all selections
    handleTemplateSelect(selectedTemplateId);
  };

  const canAddAll = useMemo(() => {
    if (!selectedTemplate) return false;

    return selectedTemplate.items.some(item => {
      const selection = itemSelections[item.stokKodu];
      if (!selection) return false;

      if (selection.isLotTracked) {
        return selection.selectedLotKey && selection.quantity > 0;
      }
      return selection.quantity > 0;
    });
  }, [selectedTemplate, itemSelections]);

  const getTrackingLabel = (tracking: string) => {
    switch (tracking) {
      case 'lot_barcode': return 'Lot Barkod';
      case 'lot_manual': return 'Lot Manuel';
      case 'qty_barcode': return 'Adet Barkod';
      case 'qty_manual': return 'Adet Manuel';
      default: return tracking;
    }
  };

  if (!visible) return null;

  return (
    <div className="mt-2 rounded-xl border bg-background/40 p-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Şablondan Ekle</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {templatesLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm text-muted-foreground">Şablonlar yükleniyor...</span>
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Henüz şablon oluşturulmamış.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Template Selector */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Şablon Seç</Label>
            <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder="Şablon seçin..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.items.length} ürün)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selected Template Items */}
          {selectedTemplate && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Şablon Ürünleri</Label>
                <Button
                  size="sm"
                  onClick={handleAddAllItems}
                  disabled={!canAddAll}
                  className="text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Tümünü Ekle
                </Button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {selectedTemplate.items.map((item, idx) => {
                  const selection = itemSelections[item.stokKodu];
                  const isExpanded = expandedItems.has(item.stokKodu);
                  const isLotTracked = item.tracking === 'lot_barcode' || item.tracking === 'lot_manual';
                  const availableLots = availableLotsMap[item.stokKodu] || [];
                  const totalStock = totalStockMap[item.stokKodu] || 0;
                  const selectedLotInfo = availableLots.find(l => l.key === selection?.selectedLotKey);

                  return (
                    <div key={item.stokKodu} className="border rounded-lg overflow-hidden">
                      {/* Item Header */}
                      <div
                        className="flex items-center justify-between p-3 bg-muted/30 cursor-pointer"
                        onClick={() => toggleExpanded(item.stokKodu)}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                          <div>
                            <p className="text-sm font-medium">{item.stokAdi}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.stokKodu} - {getTrackingLabel(item.tracking)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs px-2 py-1 bg-muted rounded">
                          {isLotTracked
                            ? availableLots.length > 0 ? `${availableLots.length} lot` : 'Stok yok'
                            : `Stok: ${totalStock}`
                          }
                        </span>
                      </div>

                      {/* Item Details (Expanded) */}
                      {isExpanded && (
                        <div className="p-3 border-t space-y-3">
                          {isLotTracked ? (
                            // Lot-tracked: show lot selector + quantity
                            <>
                              <div>
                                <Label className="text-xs text-muted-foreground mb-1 block">Lot / Miad (Kalan Stok)</Label>
                                <Select
                                  value={selection?.selectedLotKey || ''}
                                  onValueChange={(v) => handleLotChange(item.stokKodu, v)}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Lot seçin..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {availableLots.length === 0 ? (
                                      <SelectItem value="__none__" disabled>Stokta lot bulunamadı</SelectItem>
                                    ) : (
                                      availableLots.map(lot => (
                                        <SelectItem key={lot.key} value={lot.key}>
                                          {lot.label} ({lot.remaining})
                                        </SelectItem>
                                      ))
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center gap-3">
                                <div>
                                  <Label className="text-xs text-muted-foreground mb-1 block">Adet</Label>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={selectedLotInfo?.remaining || 1}
                                    value={selection?.quantity || 1}
                                    onChange={(e) => handleQtyChange(item.stokKodu, parseInt(e.target.value) || 1)}
                                    className="w-24"
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => handleAddItem(item)}
                                  disabled={!selection?.selectedLotKey}
                                  className="mt-5"
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            </>
                          ) : (
                            // Qty-tracked: show stock + quantity
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <Label className="text-xs text-muted-foreground">Depo Stoğu:</Label>
                                <span className="text-sm font-semibold text-primary">{totalStock}</span>
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground mb-1 block">Adet</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  max={totalStock}
                                  value={selection?.quantity || 1}
                                  onChange={(e) => handleQtyChange(item.stokKodu, parseInt(e.target.value) || 1)}
                                  className="w-24"
                                />
                              </div>
                              <Button
                                size="sm"
                                onClick={() => handleAddItem(item)}
                                disabled={totalStock <= 0}
                                className="mt-5"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type TransferRow = DepoStokItem & { adet: number; isGroup?: boolean; key: string };
