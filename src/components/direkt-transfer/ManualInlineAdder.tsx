
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { DepoStokItem } from '@/lib/types';

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
        return {
          code: code,
          name: p?.name || code,
          tracking: p?.tracking || 'qty_barcode'
        };
      })
      .filter(p => p.tracking !== 'serial'); // Exclude serial-tracked items
  }, [activeTab, products, stockPool]);


  const chosenProduct = useMemo(() => productsForCurrentTab.find(p => p.code === selectedProductCode), [productsForCurrentTab, selectedProductCode]);
  
  const availableLotsForProduct = useMemo(() => {
    if (!chosenProduct) return [];
    const lotsInStock = stockPool.filter(item => item.stokKodu === chosenProduct.code && !item.isShipped);
    const uniqueLots = Array.from(new Set(lotsInStock.map(item => `${item.lotNumarasi || 'N/A'}|${item.miad || 'N/A'}`)));
    return uniqueLots.map(key => {
        const [lotNum, miadVal] = key.split('|');
        const count = lotsInStock.filter(item => (item.lotNumarasi || 'N/A') === lotNum && (item.miad || 'N/A') === miadVal).length;
        const allocated = transferRows.filter(r => r.stokKodu === chosenProduct.code && r.lotNumarasi === lotNum && r.miad === miadVal).reduce((sum, r) => sum + (r.adet ?? 1), 0);
        return { key, label: `${lotNum} - ${miadVal}`, remaining: count - allocated };
    });
  }, [chosenProduct, stockPool, transferRows]);

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
  
  const handleAdd = () => {
    if (!chosenProduct) return;
    const qtyNum = Number(quantity) || 1;
    const name = chosenProduct.name || chosenProduct.code;

    if (activeTab === 'manual') {
        onAddLot({
            code: chosenProduct.code,
            name,
            lot: lot.trim(),
            miad: normalizeMiad(miad),
            qty: qtyNum,
        });
    } else { // from_stock
        const [lotNum, miadVal] = selectedLotKey.split('|');
        onAddLot({
            code: chosenProduct.code,
            name,
            lot: lotNum,
            miad: miadVal,
            qty: qtyNum
        });
    }
    
    resetLocalState();
    onDone?.();
  };

  const selectedLotInfo = availableLotsForProduct.find(l => l.key === selectedLotKey);

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
                ) : ( // manual tab
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
                )}
                <Button onClick={handleAdd} disabled={!chosenProduct || (activeTab === 'manual' && (!lot || !miad)) || (activeTab === 'from_stock' && !selectedLotKey)}>Ekle</Button>
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
