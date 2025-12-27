
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
    <div className="mt-2 rounded-xl border bg-background/40 p-3">
      <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'manual' | 'barcode')} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="manual">Manuel Takip</TabsTrigger>
          <TabsTrigger value="barcode">Barkodsuz Giriş (Lot/Adet)</TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className="mt-4">
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

              {chosenProduct && (chosenProduct.tracking === 'qty_manual' || chosenProduct.tracking === 'qty_barcode') && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Adet</Label>
                    <Input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(e.target.value)}
                      className="w-28"
                    />
                  </div>
                </>
              )}

              {chosenProduct && (chosenProduct.tracking === 'lot_manual' || chosenProduct.tracking === 'lot_barcode') && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Lot</Label>
                    <Input value={lot} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLot(e.target.value)} className="w-40" placeholder="Lot Numarası"/>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Miad</Label>
                    <ExpiryDateInput value={miad} onChange={setMiad} className="w-44 h-9 rounded-md border px-3 bg-background" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Adet</Label>
                    <Input type="number" min={1} value={quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(e.target.value)} className="w-28" />
                  </div>
                </>
              )}

              <Button onClick={handleAdd} disabled={!chosenProduct || ((chosenProduct.tracking.includes('lot')) && (!lot || !miad))}>Ekle</Button>
              <Button variant="ghost" onClick={onClose} className="ml-auto">Kapat</Button>
           </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
