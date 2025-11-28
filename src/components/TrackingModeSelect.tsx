'use client';
import * as React from 'react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { TrackingMode, TRACKING_MODE_LABEL } from '@/lib/tracking';
import { cn } from '@/lib/utils';

type Props = {
  value?: TrackingMode;
  onChange: (v: TrackingMode) => void;
  className?: string;
};

const modes: TrackingMode[] = [
  'serial',
  'lot_barcode',
  'lot_manual',
  'qty_barcode',
  'qty_manual',
];

export default function TrackingModeSelect({
  value = 'qty_barcode',
  onChange,
  className,
}: Props) {
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center gap-2">
        <Label className="text-sm">Takip Türü</Label>

        {/* Replaced invalid SVG "title" attribute with shadcn Tooltip */}
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle
                className="h-4 w-4 text-muted-foreground"
                aria-label="Ürün bu moda göre takip edilir (seri/lot/adet)."
                role="img"
              />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              Ürün bu moda göre takip edilir (seri/lot/adet).
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Select value={value} onValueChange={(v) => onChange(v as TrackingMode)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Takip türü seçin" />
        </SelectTrigger>
        <SelectContent>
          {modes.map((m) => (
            <SelectItem key={m} value={m}>
              {TRACKING_MODE_LABEL[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
