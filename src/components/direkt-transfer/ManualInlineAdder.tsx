/**
 * @fileoverview Manual Inline Adder Component for Direct Transfer
 * @description Allows users to manually add products to a transfer list
 * either from depot stock or via manual entry.
 * @module components/direkt-transfer/ManualInlineAdder
 * @version 2.1.0
 */

'use client';
import { useMemo, useState, useEffect } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { normalizeMiad } from '@/components/common/ExpiryDateInput';
import ExpiryDateInput from '@/components/common/ExpiryDateInput';
import type { ManualProductOption } from '@/lib/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { DepoStokItem } from '@/lib/types';
import { direktTransferLogger } from '@/lib/logger';
import { getStockItemQuantity, sumStockItemQuantities } from '@/lib/stock-quantity';

type LotPayload = { code: string; name: string; lot: string; miad: string; qty: number };
type QtyPayload = { code: string; name: string; qty: number };

export default function ManualInlineAdder({
  visible,
  onClose,
  depotName,
  stockPool,
  transferRows,
  products,
  onAddLot,
  onAddQty,
  onDone,
}: {
  visible: boolean;
  depotName: string;
  stockPool: DepoStokItem[];
  transferRows: TransferRow[];
  products: ManualProductOption[];
  onAddLot: (p: LotPayload) => void;
  onAddQty: (p: QtyPayload) => void;
  onClose?: () => void;
  onDone?: () => void;
}) {
  const [selectedProductCode, setSelectedProductCode] = useState<string>('');
  const [lot, setLot] = useState('');
  const [miad, setMiad] = useState('');
  const [quantity, setQuantity] = useState<number | string>(1);
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'from_stock' | 'manual'>('from_stock');

  const [selectedLotKey, setSelectedLotKey] = useState<string>('');

  const productsForCurrentTab = useMemo(() => {
    if (activeTab === 'manual') {
      return products.filter(p => p.tracking !== 'serial');
    }

    // "Depo Stoğundan Seç"
    const uniqueCodesInStock = Array.from(new Set(stockPool.map(item => item.stokKodu)));
    return uniqueCodesInStock
      .map(code => {
        const p = products.find(p => p.code === code);
        // Ürün adını önce products listesinden, bulunamazsa stockPool'dan al
        const stockItem = stockPool.find(item => item.stokKodu === code);
        const name = p?.name || stockItem?.stokAdi || code;
        return {
          code: code,
          name: name,
          tracking: p?.tracking || 'qty_barcode'
        };
      })
      .filter(p => p.tracking !== 'serial'); // Exclude serial-tracked items
  }, [activeTab, products, stockPool]);


  const chosenProduct = useMemo(() => productsForCurrentTab.find(p => p.code === selectedProductCode), [productsForCurrentTab, selectedProductCode]);

  // Check if the chosen product is lot-tracked
  const isLotTracked = useMemo(() => {
    if (!chosenProduct) return false;
    return chosenProduct.tracking === 'lot_barcode' || chosenProduct.tracking === 'lot_manual';
  }, [chosenProduct]);

  // Check if the chosen product is qty-tracked
  const isQtyTracked = useMemo(() => {
    if (!chosenProduct) return false;
    return chosenProduct.tracking === 'qty_barcode' || chosenProduct.tracking === 'qty_manual';
  }, [chosenProduct]);

  // Calculate total stock for qty-tracked products
  const totalStockForQtyProduct = useMemo(() => {
    if (!chosenProduct || !isQtyTracked) return 0;
    const itemsInStock = stockPool.filter(item => item.stokKodu === chosenProduct.code && !item.isShipped);
    const totalCount = sumStockItemQuantities(itemsInStock);
    const allocated = transferRows
      .filter(r => r.stokKodu === chosenProduct.code)
      .reduce((sum, r) => sum + getStockItemQuantity(r), 0);
    return totalCount - allocated;
  }, [chosenProduct, isQtyTracked, stockPool, transferRows]);

  const availableLotsForProduct = useMemo(() => {
    if (!chosenProduct || !isLotTracked) return [];
    const lotsInStock = stockPool.filter(item => item.stokKodu === chosenProduct.code && !item.isShipped);
    const uniqueLots = Array.from(new Set(lotsInStock.map(item => `${item.lotNumarasi || 'N/A'}|${item.miad || 'N/A'}`)));
    return uniqueLots.map(key => {
        const [lotNum, miadVal] = key.split('|');
        const lotItems = lotsInStock.filter(item => (item.lotNumarasi || 'N/A') === lotNum && (item.miad || 'N/A') === miadVal);
        const count = sumStockItemQuantities(lotItems);
        const allocated = transferRows
          .filter(r => r.stokKodu === chosenProduct.code && r.lotNumarasi === lotNum && r.miad === miadVal)
          .reduce((sum, r) => sum + getStockItemQuantity(r), 0);
        return { key, label: `${lotNum} - ${miadVal}`, remaining: count - allocated };
    });
  }, [chosenProduct, isLotTracked, stockPool, transferRows]);

  useEffect(() => {
    if (!visible) resetLocalState();
  }, [visible]);

  useEffect(() => {
    resetLocalState();
  }, [activeTab]);

  const resetLocalState = () => {
    setSelectedProductCode('');
    setLot('');
    setMiad('');
    setQuantity(1);
    setSelectedLotKey('');
    setIsProductPopoverOpen(false);
  };

  /**
   * Handles adding a product to the transfer list
   */
  const handleAdd = () => {
    if (!chosenProduct) return;
    const qtyNum = Math.max(1, Math.floor(Number(quantity) || 1));
    const name = chosenProduct.name || chosenProduct.code;

    if (activeTab === 'manual') {
        // Manuel tab: lot takipli ürünler için lot/miad ile, adet takipli için sadece adet ile ekle
        if (isLotTracked) {
            const payload = {
                code: chosenProduct.code,
                name,
                lot: lot.trim(),
                miad: normalizeMiad(miad),
                qty: qtyNum,
            };
            onAddLot(payload);
            direktTransferLogger.debug('Manuel lot ürünü eklendi', {
              mode: 'manual',
              stokKodu: payload.code,
              lot: payload.lot,
              qty: payload.qty,
            });
        } else {
            // Adet takipli ürün
            const payload = { code: chosenProduct.code, name, qty: qtyNum };
            onAddQty(payload);
            direktTransferLogger.debug('Manuel adet ürünü eklendi', {
              mode: 'manual',
              stokKodu: payload.code,
              qty: payload.qty,
            });
        }
    } else { // from_stock
        if (isLotTracked) {
            const [lotNum, miadVal] = selectedLotKey.split('|');
            const payload = {
                code: chosenProduct.code,
                name,
                lot: lotNum,
                miad: miadVal,
                qty: qtyNum
            };
            onAddLot(payload);
            direktTransferLogger.debug('Stoktan lot ürünü eklendi', {
              mode: 'from_stock',
              stokKodu: payload.code,
              lot: payload.lot,
              qty: payload.qty,
            });
        } else {
            // Adet takipli ürün - stoktan seçme
            const payload = { code: chosenProduct.code, name, qty: qtyNum };
            onAddQty(payload);
            direktTransferLogger.debug('Stoktan adet ürünü eklendi', {
              mode: 'from_stock',
              stokKodu: payload.code,
              qty: payload.qty,
            });
        }
    }

    resetLocalState();
    onDone?.();
  };

  const selectedLotInfo = availableLotsForProduct.find(l => l.key === selectedLotKey);

  // Validation for add button
  const isAddDisabled = useMemo(() => {
    if (!chosenProduct) return true;

    if (activeTab === 'manual') {
      // Manuel modda: lot takipli ürünler için lot ve miad zorunlu
      if (isLotTracked && (!lot || !miad)) return true;
      return false;
    } else {
      const qtyNum = Math.max(1, Math.floor(Number(quantity) || 1));
      // Stoktan seçme modunda: lot takipli ürünler için lot seçimi ve kalan adet kontrolü zorunlu
      if (isLotTracked) return !selectedLotInfo || selectedLotInfo.remaining <= 0 || qtyNum > selectedLotInfo.remaining;
      // Adet takipli ürünler için stok kontrolü
      if (isQtyTracked) return totalStockForQtyProduct <= 0 || qtyNum > totalStockForQtyProduct;
      return false;
    }
  }, [chosenProduct, activeTab, isLotTracked, isQtyTracked, lot, miad, selectedLotKey, selectedLotInfo, quantity, totalStockForQtyProduct]);

  return (
    <div>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-[var(--dashboard-surface-2)] rounded-xl p-1 h-auto">
          <TabsTrigger value="from_stock" className="rounded-lg text-xs sm:text-sm py-1.5 data-[state=active]:bg-[var(--dashboard-surface)] data-[state=active]:shadow-[var(--dashboard-raised-soft)] data-[state=active]:font-semibold">Depo Stoğundan</TabsTrigger>
          <TabsTrigger value="manual" className="rounded-lg text-xs sm:text-sm py-1.5 data-[state=active]:bg-[var(--dashboard-surface)] data-[state=active]:shadow-[var(--dashboard-raised-soft)] data-[state=active]:font-semibold">Manuel Takip</TabsTrigger>
        </TabsList>
        <div className="mt-3 space-y-3">
            {/* Product selector */}
            <div>
              <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Ürün Seç</label>
              <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "w-full flex items-center justify-between px-3 h-10 rounded-xl text-sm transition-all border border-[var(--dashboard-stroke)]",
                      selectedProductCode
                        ? "bg-[var(--dashboard-surface)] shadow-[var(--dashboard-raised-soft)] font-medium text-[var(--dashboard-text)]"
                        : "bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)]"
                    )}
                  >
                    <span className="truncate">
                      {selectedProductCode ? productsForCurrentTab.find(p => p.code === selectedProductCode)?.name : 'Ürün seçin...'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                  <Command>
                    <CommandInput placeholder="Ürün ara..." />
                    <CommandList>
                      <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                      <CommandGroup>
                        {productsForCurrentTab.sort((a,b) => a.name.localeCompare(b.name)).map(p => (
                          <CommandItem
                            key={p.code}
                            value={`${p.name} ${p.code}`}
                            onSelect={() => {
                              setSelectedProductCode(p.code);
                              setIsProductPopoverOpen(false);
                              setSelectedLotKey('');
                              setQuantity(1);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedProductCode === p.code ? "opacity-100" : "opacity-0")} />
                            <div className="flex flex-col">
                              <span className="text-sm">{p.name}</span>
                              <span className="text-[10px] text-[var(--dashboard-muted)]">{p.code}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {chosenProduct && (
              <div className="space-y-3">
                {activeTab === 'from_stock' ? (
                  isLotTracked ? (
                    <>
                      <div>
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Lot / Miad (Kalan Stok)</label>
                        <Select value={selectedLotKey} onValueChange={setSelectedLotKey}>
                          <SelectTrigger className="bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10"><SelectValue placeholder="Lot seçin..." /></SelectTrigger>
                          <SelectContent>
                            {availableLotsForProduct.map(lot => (
                              <SelectItem key={lot.key} value={lot.key}>{lot.label} ({lot.remaining})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Adet</label>
                        <Input type="number" min="1" max={selectedLotInfo?.remaining || 1} value={quantity} onChange={e => setQuantity(e.target.value)} className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--dashboard-surface-2)]">
                        <span className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)]">Depo Stoğu:</span>
                        <span className="text-sm font-bold text-[var(--dashboard-accent)]">{totalStockForQtyProduct}</span>
                      </div>
                      <div>
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Adet</label>
                        <Input type="number" min="1" max={totalStockForQtyProduct} value={quantity} onChange={e => setQuantity(e.target.value)} className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10" />
                      </div>
                    </>
                  )
                ) : (
                  isLotTracked ? (
                    <>
                      <div>
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Lot</label>
                        <Input value={lot} onChange={e => setLot(e.target.value)} placeholder="Lot Numarası" className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10" />
                      </div>
                      <div>
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Miad</label>
                        <ExpiryDateInput value={miad} onChange={setMiad} className="w-full h-10 rounded-xl border border-[var(--dashboard-stroke)] px-3 bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]" />
                      </div>
                      <div>
                        <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Adet</label>
                        <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10" />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Adet</label>
                      <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10" />
                    </div>
                  )
                )}
                <button
                  onClick={handleAdd}
                  disabled={isAddDisabled}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all",
                    !isAddDisabled
                      ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[var(--dashboard-pressed)]"
                      : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] cursor-not-allowed"
                  )}
                >
                  Listeye Ekle
                </button>
              </div>
            )}
        </div>
      </Tabs>
    </div>
  );
}
type TransferRow = DepoStokItem & { adet: number; isGroup?: boolean, key: string };
