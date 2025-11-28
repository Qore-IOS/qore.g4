
'use client';

import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronsUpDown } from 'lucide-react';

interface Option {
    value: string;
    label: string;
}

interface MultiSelectFilterProps {
  options: Option[];
  selectedValues: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  className?: string;
  title: string;
}

export default function MultiSelectFilter({ options, selectedValues = [], onChange, placeholder = "Seç...", className, title }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (value: string) => {
    const newSelected = selectedValues.includes(value)
      ? selectedValues.filter(item => item !== value)
      : [...selectedValues, value];
    onChange(newSelected);
  };
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className={`w-full justify-between font-normal ${className}`}>
            <span className="truncate">
                {selectedValues.length > 0 ? `${selectedValues.length} seçili` : `${title} seç...`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
    </PopoverTrigger>
    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
            <CommandInput placeholder="Ara..." />
            <CommandList>
                <CommandEmpty>Sonuç bulunamadı.</CommandEmpty>
                <CommandGroup>
                    {options.map(option => (
                        <CommandItem
                            key={option.value}
                            value={option.label}
                            onSelect={() => handleSelect(option.value)}
                        >
                            <Checkbox
                                checked={selectedValues.includes(option.value)}
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
}

    