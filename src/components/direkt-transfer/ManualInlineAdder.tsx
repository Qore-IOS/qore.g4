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
import { Button } from '@/components/ui/button';
import { Label } from '../ui/label';
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
    const totalCount = itemsInStock.length;
    const allocated = transferRows
      .filter(r => r.stokKodu === chosenProduct.code)
      .reduce((sum, r) => sum + (r.adet ?? 1), 0);
    return totalCount - allocated;
  }, [chosenProduct, isQtyTracked, stockPool, transferRows]);

  const availableLotsForProduct = useMemo(() => {
    if (!chosenProduct || !isLotTracked) return [];
    const lotsInStock = stockPool.filter(item => item.stokKodu === chosenProduct.code && !item.isShipped);
    const uniqueLots = Array.from(new Set(lotsInStock.map(item => `${item.lotNumarasi || 'N/A'}|${item.miad || 'N/A'}`)));
    return uniqueLots.map(key => {
        const [lotNum, miadVal] = key.split('|');
        const count = lotsInStock.filter(item => (item.lotNumarasi || 'N/A') === lotNum && (item.miad || 'N/A') === miadVal).length;
        const allocated = transferRows.filter(r => r.stokKodu === chosenProduct.code && r.lotNumarasi === lotNum && r.miad === miadVal).reduce((sum, r) => sum + (r.adet ?? 1), 0);
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
    const qtyNum = Number(quantity) || 1;
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
      // Stoktan seçme modunda: lot takipli ürünler için lot seçimi zorunlu
      if (isLotTracked && !selectedLotKey) return true;
      // Adet takipli ürünler için stok kontrolü
      if (isQtyTracked && totalStockForQtyProduct <= 0) return true;
      return false;
    }
  }, [chosenProduct, activeTab, isLotTracked, isQtyTracked, lot, miad, selectedLotKey, totalStockForQtyProduct]);

  return (
    <div className="mt-2 rounded-xl border bg-background/40 p-3">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="from_stock">Depo Stoğundan Seç</TabsTrigger>
          <TabsTrigger value="manual">Manuel Takip</TabsTrigger>
        </TabsList>
        <div className="mt-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[340px]">
                <Label className="text-xs text-muted-foreground mb-1 block">Ürün Seç</Label>
                 <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={isProductPopoverOpen}
                        className="w-full justify-between font-normal"
                      >
                        <span className="truncate">
                          {selectedProductCode ? productsForCurrentTab.find(p => p.code === selectedProductCode)?.name : 'Ürün seçin...'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
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
                                  setSelectedLotKey(''); // Reset lot selection
                                  setQuantity(1);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", selectedProductCode === p.code ? "opacity-100" : "opacity-0")} />
                                <div className="flex flex-col">
                                    <span>{p.name}</span>
                                    <span className="text-xs text-muted-foreground">{p.code}</span>
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
              <>
                {activeTab === 'from_stock' ? (
                  // Stoktan seçme modu
                  isLotTracked ? (
                    // Lot takipli ürünler: Lot seçimi + Adet
                    <>
                      <div className="min-w-[200px]">
                        <Label className="text-xs text-muted-foreground mb-1 block">Lot / Miad (Kalan Stok)</Label>
                        <Select value={selectedLotKey} onValueChange={setSelectedLotKey}>
                          <SelectTrigger><SelectValue placeholder="Lot seçin..."/></SelectTrigger>
                          <SelectContent>
                            {availableLotsForProduct.map(lot => (
                              <SelectItem key={lot.key} value={lot.key}>{lot.label} ({lot.remaining})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Adet</Label>
                        <Input
                          type="number"
                          min="1"
                          max={selectedLotInfo?.remaining || 1}
                          value={quantity}
                          onChange={e => setQuantity(e.target.value)}
                          className="w-28"
                        />
                      </div>
                    </>
                  ) : (
                    // Adet takipli ürünler: Toplam stok göster + Adet
                    <>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground">Depo Stoğu:</Label>
                        <span className="text-sm font-semibold text-primary">{totalStockForQtyProduct}</span>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Adet</Label>
                        <Input
                          type="number"
                          min="1"
                          max={totalStockForQtyProduct}
                          value={quantity}
                          onChange={e => setQuantity(e.target.value)}
                          className="w-28"
                        />
                      </div>
                    </>
                  )
                ) : (
                  // Manuel takip modu
                  isLotTracked ? (
                    // Lot takipli ürünler: Lot + Miad + Adet girişi
                    <>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Lot</Label>
                        <Input value={lot} onChange={e => setLot(e.target.value)} className="w-40" placeholder="Lot Numarası"/>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Miad</Label>
                        <ExpiryDateInput value={miad} onChange={setMiad} className="w-44 h-9 rounded-md border px-3 bg-background" />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Adet</Label>
                        <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-28" />
                      </div>
                    </>
                  ) : (
                    // Adet takipli ürünler: Sadece Adet girişi
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Adet</Label>
                      <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-28" />
                    </div>
                  )
                )}
                <Button onClick={handleAdd} disabled={isAddDisabled}>Ekle</Button>
              </>
            )}

              <Button variant="ghost" onClick={onClose} className="ml-auto">Kapat</Button>
           </div>
        </div>
      </Tabs>
    </div>
  );
}
type TransferRow = DepoStokItem & { adet: number; isGroup?: boolean, key: string };
