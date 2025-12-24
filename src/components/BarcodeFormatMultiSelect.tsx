'use client';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import React from 'react';
import type { BarcodeFormat } from '@/lib/barcode';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';
import { cn } from '@/lib/utils';

type Props = {
  value: string[] | null | undefined;
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
};

export default function BarcodeFormatMultiSelect({ value, onChange, disabled, className }: Props) {
  const { formats, loading } = useSafeBarcodeFormats();
  const [open, setOpen] = React.useState(false);

  const selectedIds = value || [];
  const selectedFormats = formats.filter(f => selectedIds.includes(f.id));

  const handleSelect = (formatId: string) => {
    const newSelection = selectedIds.includes(formatId)
      ? selectedIds.filter(id => id !== formatId)
      : [...selectedIds, formatId];
    onChange(newSelection);
  };

  const handleRemove = (formatId: string) => {
    onChange(selectedIds.filter(id => id !== formatId));
  };

  return (
    <div className={className}>
      <Label className="text-sm font-medium">Barkod Formatları</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full mt-1 justify-between h-auto min-h-10"
            disabled={disabled || loading}
          >
            <div className="flex flex-wrap gap-1 flex-1">
              {selectedFormats.length === 0 ? (
                <span className="text-muted-foreground">Format seçin...</span>
              ) : (
                selectedFormats.map((format) => (
                  <Badge key={format.id} variant="secondary" className="mr-1">
                    {format.name}
                    <button
                      type="button"
                      className="ml-1 hover:bg-muted rounded-full"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemove(format.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))
              )}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Format ara..." />
            <CommandEmpty>Format bulunamadı.</CommandEmpty>
            <CommandGroup className="max-h-64 overflow-auto">
              {formats.map((format) => (
                <CommandItem
                  key={format.id}
                  value={format.id}
                  onSelect={() => handleSelect(format.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selectedIds.includes(format.id) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {format.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
      <p className="text-xs text-muted-foreground mt-1">
        Birden fazla format seçebilirsiniz. Aynı ürün hem seri no hem lot takipli olabilir.
      </p>
    </div>
  );
}
