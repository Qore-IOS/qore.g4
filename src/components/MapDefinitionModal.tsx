
'use client';
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { X, ChevronDown, Check } from 'lucide-react';
import type { Depot, GridDefinition, CellDef, AddressDefinition, ProductCode } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';

interface MultiSelectProps {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}

const MultiSelect: React.FC<MultiSelectProps> = ({ options, value, onChange, placeholder, className }) => {
  const [open, setOpen] = useState(false);
  const selectedLabels = value.map(val => options.find(opt => opt.value === val)?.label).join(', ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={`w-full justify-start ${className}`}>
          <span className="truncate">{selectedLabels || placeholder || "Select..."}</span>
          <ChevronDown className="ml-auto h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  onSelect={() => {
                    const newValue = value.includes(option.value)
                      ? value.filter(v => v !== option.value)
                      : [...value, option.value];
                    onChange(newValue);
                  }}
                  className="cursor-pointer"
                >
                  <Checkbox
                    checked={value.includes(option.value)}
                    className="mr-2"
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};


interface Props {
  depot: Depot;
  initialMap?: GridDefinition;
  addresses: AddressDefinition[];
  products: ProductCode[];
  onSave: (map: GridDefinition) => void;
  onClose: () => void;
}

export default function MapDefinitionModal({
  depot,
  initialMap,
  addresses,
  products,
  onSave,
  onClose,
}: Props) {
  const MAX = 6;
  const [step, setStep] = useState<1 | 2>(1);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [cells, setCells] = useState<CellDef[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const groups = Array.from(new Set(addresses.map(a => a.addressName.replace(/\d+$/, ''))));

  useEffect(() => {
    if (initialMap) {
      const pts = new Set<string>();
      initialMap.cells.forEach(c => pts.add(`${c.x}-${c.y}`));
      setToggled(pts);
      setCells(initialMap.cells); // Pre-populate cells with full data
      setStep(2);
    }
  }, [initialMap]);

  useEffect(() => {
    if (step === 2) {
      const arr = Array.from(toggled).map(key => {
        const [x, y] = key.split('-').map(Number);
        const existing = cells.find(c => c.x === x && c.y === y) || initialMap?.cells.find(c => c.x === x && c.y === y);
        return {
          x,
          y,
          group: existing?.group || '',
          products: existing?.products || [],
        };
      });
      setCells(arr);
      setEditingIdx(null);
    }
  }, [step, toggled, initialMap]);

  const xs = Array.from(toggled).map(k => +k.split('-')[0]);
  const ys = Array.from(toggled).map(k => +k.split('-')[1]);
  const cols = xs.length > 0 ? Math.max(...xs) + 1 : 0;
  const rows = ys.length ? Math.max(...ys) + 1 : 0;

  const allAssigned = cells.every(c => !!c.group);

  const save = () => {
    if (!allAssigned) return;
    onSave({ rows, cols, cells });
  };

  const currentEditingCell = editingIdx !== null ? cells[editingIdx] : null;

  return (
    <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-4xl">
             <DialogHeader>
                <DialogTitle className="text-2xl font-semibold mb-1">Harita Tanımla: {depot.name}</DialogTitle>
                <DialogDescription>
                    Depo yerleşim planını oluşturun. Rafları seçin, ardından adres ve ürün ataması yapın.
                </DialogDescription>
             </DialogHeader>
             
             <div className="relative p-1">
                 {step === 1 ? (
                 <>
                    <h3 className="font-medium mb-4">Adım 1: Depo Alanını Seçin (Maks {MAX}×{MAX})</h3>
                    <div
                        className="grid gap-2 mx-auto mb-6"
                        style={{
                            gridTemplateColumns: `repeat(${MAX},1fr)`,
                            gridTemplateRows: `repeat(${MAX},1fr)`,
                            width: 320,
                            height: 320,
                        }}
                    >
                        {Array.from({ length: MAX * MAX }).map((_, i) => {
                            const x = i % MAX;
                            const y = Math.floor(i / MAX);
                            const key = `${x}-${y}`;
                            const on = toggled.has(key);
                            return (
                                <button
                                key={key}
                                onClick={() => {
                                    const s = new Set(toggled);
                                    on ? s.delete(key) : s.add(key);
                                    setToggled(s);
                                }}
                                className={`border rounded transition flex items-center justify-center ${on ? 'bg-primary border-primary/80 text-white' : 'bg-muted/50 border-border'}`}
                                >
                                {on && <Check className="h-5 w-5"/>}
                                </button>
                            );
                        })}
                    </div>
                    <DialogFooter>
                         <Button variant="outline" onClick={onClose}>İptal</Button>
                         <Button disabled={toggled.size === 0} onClick={() => setStep(2)}>İleri →</Button>
                    </DialogFooter>
                 </>
                 ) : (
                 <>
                    <h3 className="mb-4 font-medium">Adım 2: Her Raf Alanına Adres Grubu ve Ürün Ata</h3>
                    <div className="flex gap-6">
                        {/* Grid */}
                        <div
                            className="grid gap-2 bg-muted p-4 rounded-lg flex-shrink-0"
                            style={{
                                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                                gridTemplateRows: `repeat(${rows}, 1fr)`,
                            }}
                        >
                            {cells.map((c, idx) => {
                                const isEditing = idx === editingIdx;
                                return (
                                <div
                                    key={`${c.x}-${c.y}-${idx}`}
                                    style={{
                                      gridColumnStart: c.x + 1,
                                      gridRowStart: c.y + 1,
                                    }}
                                >
                                  <button
                                      onClick={() => setEditingIdx(idx)}
                                      className={`border rounded text-sm font-medium transition-colors h-full w-full aspect-square ${
                                      isEditing
                                          ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2'
                                          : 'bg-background hover:bg-accent/50'
                                      }`}
                                  >
                                      {c.group || `${c.x},${c.y}`}
                                  </button>
                                </div>
                                );
                            })}
                        </div>
                        {/* Side panel */}
                        {editingIdx !== null && currentEditingCell && (
                        <div className="flex-1 bg-background/50 p-4 rounded-lg border">
                            <h4 className="text-lg font-medium mb-3">
                            Raf Detayları: ({currentEditingCell.x},{currentEditingCell.y})
                            </h4>

                            <label className="block mb-2 font-medium text-sm">
                            Raf Adres Grubu
                            </label>
                            <Select
                            value={currentEditingCell.group || ''}
                            onValueChange={v => {
                                const newCells = [...cells];
                                newCells[editingIdx].group = v;
                                setCells(newCells);
                            }}
                            >
                                <SelectTrigger><SelectValue placeholder="Adres grubu seçin..." /></SelectTrigger>
                                <SelectContent>
                                    {groups.map(g => (
                                    <SelectItem key={g} value={g}>
                                        {g}
                                    </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <label className="block mt-4 mb-2 font-medium text-sm">
                            Bu Raftaki Ürünler
                            </label>
                            <MultiSelect
                            placeholder="Ürünleri seçin..."
                            options={products.map(p => ({
                                value: p.id,
                                label: p.stokAdi,
                            }))}
                            value={currentEditingCell.products || []}
                            onChange={vals => {
                                const newCells = [...cells];
                                newCells[editingIdx].products = vals;
                                setCells(newCells);
                            }}
                            />
                        </div>
                        )}
                    </div>
                    <DialogFooter className="mt-6">
                        <Button variant="outline" onClick={() => { setStep(1); setEditingIdx(null); }}>← Geri</Button>
                        <Button disabled={!allAssigned} onClick={save}>Haritayı Kaydet</Button>
                    </DialogFooter>
                 </>
                 )}
            </div>
             <DialogClose asChild>
                <Button variant="ghost" size="icon" className="absolute top-4 right-4" onClick={onClose}><X className="h-4 w-4" /><span className="sr-only">Kapat</span></Button>
            </DialogClose>
        </DialogContent>
    </Dialog>
  );
}
