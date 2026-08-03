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
import type { TransferTemplate, TransferTemplateItem, DepoStokItem } from '@/lib/types';
import { Loader2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isAvailableDepotStock, sumStockItemQuantities } from '@/lib/stock-quantity';

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
        const lotsInStock = stockPool.filter(s => s.stokKodu === item.stokKodu && isAvailableDepotStock(s));
        const uniqueLots = Array.from(new Set(lotsInStock.map(s => `${s.lotNumarasi || 'N/A'}|${s.miad || 'N/A'}`)));

        map[item.stokKodu] = uniqueLots.map(key => {
          const [lotNum, miadVal] = key.split('|');
          const count = sumStockItemQuantities(
            lotsInStock.filter(s => (s.lotNumarasi || 'N/A') === lotNum && (s.miad || 'N/A') === miadVal),
          );
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
        const itemsInStock = stockPool.filter(s => s.stokKodu === item.stokKodu && isAvailableDepotStock(s));
        const totalCount = sumStockItemQuantities(itemsInStock);
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
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Şablondan Ekle</p>
        <button onClick={onClose} className="w-7 h-7 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors">
          <X className="h-3.5 w-3.5 text-[var(--dashboard-muted)]" />
        </button>
      </div>

      {templatesLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--dashboard-accent)] mr-2" />
          <span className="text-sm text-[var(--dashboard-muted)]">Şablonlar yükleniyor...</span>
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-[var(--dashboard-muted)] text-center py-4">
          Henüz şablon oluşturulmamış.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Template Selector */}
          <div>
            <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Şablon Seç</label>
            <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
              <SelectTrigger className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10">
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
                <span className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Şablon Ürünleri</span>
                <button
                  onClick={handleAddAllItems}
                  disabled={!canAddAll}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all",
                    canAddAll
                      ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)] hover:-translate-y-0.5 active:translate-y-0"
                      : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] cursor-not-allowed"
                  )}
                >
                  <Plus className="h-3 w-3" />
                  Tümünü Ekle
                </button>
              </div>

              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {selectedTemplate.items.map((item, idx) => {
                  const selection = itemSelections[item.stokKodu];
                  const isExpanded = expandedItems.has(item.stokKodu);
                  const isLotTracked = item.tracking === 'lot_barcode' || item.tracking === 'lot_manual';
                  const availableLots = availableLotsMap[item.stokKodu] || [];
                  const totalStock = totalStockMap[item.stokKodu] || 0;
                  const selectedLotInfo = availableLots.find(l => l.key === selection?.selectedLotKey);
                  const hasStock = isLotTracked ? availableLots.length > 0 : totalStock > 0;

                  return (
                    <div key={item.stokKodu} className="rounded-xl overflow-hidden border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
                      {/* Item Header */}
                      <div
                        className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-[var(--dashboard-surface-2)] transition-colors"
                        onClick={() => toggleExpanded(item.stokKodu)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-[var(--dashboard-muted)] shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--dashboard-muted)] shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[var(--dashboard-text)] truncate">{item.stokAdi}</p>
                            <p className="text-[10px] text-[var(--dashboard-muted)]">{item.stokKodu}</p>
                          </div>
                        </div>
                        <span className={cn(
                          "text-[10px] px-2 py-0.5 rounded-lg font-medium shrink-0",
                          hasStock
                            ? "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)]"
                            : "bg-amber-100 text-amber-700"
                        )}>
                          {isLotTracked ? (hasStock ? `${availableLots.length} lot` : 'Stok yok') : `Stok: ${totalStock}`}
                        </span>
                      </div>

                      {/* Item Details (Expanded) */}
                      {isExpanded && (
                        <div className="px-2.5 pb-2.5 pt-1 border-t border-[var(--dashboard-stroke)] space-y-2">
                          {isLotTracked ? (
                            <>
                              <div>
                                <label className="text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Lot / Miad</label>
                                <Select value={selection?.selectedLotKey || ''} onValueChange={(v) => handleLotChange(item.stokKodu, v)}>
                                  <SelectTrigger className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-9 text-xs"><SelectValue placeholder="Lot seçin..." /></SelectTrigger>
                                  <SelectContent>
                                    {availableLots.length === 0 ? (
                                      <SelectItem value="__none__" disabled>Stokta lot bulunamadı</SelectItem>
                                    ) : (
                                      availableLots.map(lot => (
                                        <SelectItem key={lot.key} value={lot.key}>{lot.label} ({lot.remaining})</SelectItem>
                                      ))
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-end gap-2">
                                <div className="flex-1">
                                  <label className="text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Adet</label>
                                  <Input type="number" min={1} max={selectedLotInfo?.remaining || 1} value={selection?.quantity || 1} onChange={(e) => handleQtyChange(item.stokKodu, parseInt(e.target.value) || 1)} className="h-9 bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl text-xs" />
                                </div>
                                <button
                                  onClick={() => handleAddItem(item)}
                                  disabled={!selection?.selectedLotKey}
                                  className={cn(
                                    "h-9 px-3 rounded-xl text-xs font-semibold transition-all flex items-center gap-1",
                                    selection?.selectedLotKey
                                      ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                                      : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] cursor-not-allowed"
                                  )}
                                >
                                  <Plus className="h-3.5 w-3.5" /> Ekle
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-end gap-2">
                              <div className="flex items-center gap-2 p-1.5 rounded-lg bg-[var(--dashboard-surface-2)] shrink-0">
                                <span className="text-[10px] text-[var(--dashboard-muted)]">Stok:</span>
                                <span className="text-xs font-bold text-[var(--dashboard-accent)]">{totalStock}</span>
                              </div>
                              <div className="flex-1">
                                <label className="text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Adet</label>
                                <Input type="number" min={1} max={totalStock} value={selection?.quantity || 1} onChange={(e) => handleQtyChange(item.stokKodu, parseInt(e.target.value) || 1)} className="h-9 bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl text-xs" />
                              </div>
                              <button
                                onClick={() => handleAddItem(item)}
                                disabled={totalStock <= 0}
                                className={cn(
                                  "h-9 px-3 rounded-xl text-xs font-semibold transition-all flex items-center gap-1",
                                  totalStock > 0
                                    ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                                    : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] cursor-not-allowed"
                                )}
                              >
                                <Plus className="h-3.5 w-3.5" /> Ekle
                              </button>
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
