
'use client';
import React, { useMemo, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '../ui/label';
import { normalizeMiad } from '@/components/common/ExpiryDateInput';
import ExpiryDateInput from '@/components/common/ExpiryDateInput';
import type { ManualProductOption } from '../../lib/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type LotPayload = { code: string; name: string; lot: string; miad: string; qty: number };
type QtyPayload = { code: string; name: string; qty: number };

export default function ManualInlineAdder({
  visible,
  onClose,
  manualProducts,
  barcodeProducts,
  onAddLot,
  onAddQty,
  onDone,
}: {
  visible: boolean;
  manualProducts: ManualProductOption[];
  barcodeProducts: ManualProductOption[];
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
  const [activeTab, setActiveTab] = useState<'manual' | 'barcode'>('manual');

  const productsForCurrentTab = useMemo(() => {
    return activeTab === 'manual' ? manualProducts : barcodeProducts;
  }, [activeTab, manualProducts, barcodeProducts]);
  
  const chosenProduct = useMemo(() => productsForCurrentTab.find((p: ManualProductOption) => p.code === selectedProductCode), [productsForCurrentTab, selectedProductCode]);

  const resetLocalState = () => {
    setSelectedProductCode('');
    setLot('');
    setMiad('');
    setQuantity(1);
    setIsProductPopoverOpen(false);
  };
  
  useEffect(() => {
    if (!visible) resetLocalState();
  }, [visible]);

  useEffect(() => {
    resetLocalState();
  }, [activeTab]);

  const handleAdd = () => {
    if (!chosenProduct) return;
    const qtyNum = Number(quantity) || 1;
    const name = chosenProduct.name || chosenProduct.code;

    if (chosenProduct.tracking === 'lot_manual' || chosenProduct.tracking === 'lot_barcode') {
      if (!lot || !miad) return;
      onAddLot({
        code: chosenProduct.code,
        name,
        lot: lot.trim(),
        miad: normalizeMiad(miad),
        qty: qtyNum,
      });
    } else {
      onAddQty({ code: chosenProduct.code, name, qty: qtyNum });
    }
    
    resetLocalState();
    onDone?.();
  };

  if (!visible) return null;

  return (
    <div>
      <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'manual' | 'barcode')} className="w-full">
        <TabsList className="grid w-full grid-cols-2 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-1">
          <TabsTrigger value="manual" className="rounded-lg text-xs sm:text-sm data-[state=active]:bg-[var(--dashboard-surface)] data-[state=active]:shadow-[var(--dashboard-raised-soft)]">Manuel Takip</TabsTrigger>
          <TabsTrigger value="barcode" className="rounded-lg text-xs sm:text-sm data-[state=active]:bg-[var(--dashboard-surface)] data-[state=active]:shadow-[var(--dashboard-raised-soft)]">Barkodsuz Giriş</TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className="mt-3">
           <div className="flex flex-wrap items-end gap-2 sm:gap-3">
              <div className="w-full sm:min-w-[300px] sm:w-auto sm:flex-1">
                <Label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] mb-1 block">Ürün Seç</Label>
                 <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={isProductPopoverOpen}
                        className="w-full justify-between font-normal bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-xl"
                      >
                        <span className="truncate text-sm">
                          {selectedProductCode ? productsForCurrentTab.find((p: ManualProductOption) => p.code === selectedProductCode)?.name : 'Ürün seçin...'}
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
                            {productsForCurrentTab.sort((a: ManualProductOption, b: ManualProductOption) => a.name.localeCompare(b.name)).map((p: ManualProductOption) => (
                              <CommandItem
                                key={p.code}
                                value={`${p.name} ${p.code}`}
                                onSelect={() => {
                                  setSelectedProductCode(p.code);
                                  setIsProductPopoverOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", selectedProductCode === p.code ? "opacity-100" : "opacity-0")} />
                                <div className="flex flex-col">
                                    <span className="text-sm">{p.name}</span>
                                    <span className="text-xs text-[var(--dashboard-muted)] font-mono">{p.code}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
              </div>

              {chosenProduct && (chosenProduct.tracking === 'qty_manual' || chosenProduct.tracking === 'qty_barcode') && (
                <div>
                  <Label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] mb-1 block">Adet</Label>
                  <Input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(e.target.value)}
                    className="w-24 bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-xl"
                  />
                </div>
              )}

              {chosenProduct && (chosenProduct.tracking === 'lot_manual' || chosenProduct.tracking === 'lot_barcode') && (
                <>
                  <div>
                    <Label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] mb-1 block">Lot</Label>
                    <Input value={lot} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLot(e.target.value)} className="w-36 bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-xl" placeholder="Lot No"/>
                  </div>
                  <div>
                    <Label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] mb-1 block">Miad</Label>
                    <ExpiryDateInput value={miad} onChange={setMiad} className="w-40 h-9 rounded-xl border border-[var(--dashboard-stroke)] px-3 bg-[var(--dashboard-surface-2)]" />
                  </div>
                  <div>
                    <Label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] mb-1 block">Adet</Label>
                    <Input type="number" min={1} value={quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(e.target.value)} className="w-24 bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] rounded-xl" />
                  </div>
                </>
              )}

              <button
                onClick={handleAdd}
                disabled={!chosenProduct || ((chosenProduct.tracking.includes('lot')) && (!lot || !miad))}
                className="cihaz-action-tile px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                style={chosenProduct && !((chosenProduct.tracking.includes('lot')) && (!lot || !miad)) ? { background: 'var(--dashboard-accent)', color: '#fff', border: 'none' } : undefined}
              >
                Ekle
              </button>
           </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
