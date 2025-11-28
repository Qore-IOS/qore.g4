
'use client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import React from 'react';
import type { BarcodeFormat } from '@/lib/barcode';
import { useSafeBarcodeFormats } from '@/hooks/useSafeBarcodeFormats';

export type FormatValue = '__auto__' | string;

type Props = {
  value: FormatValue | null | undefined;
  onChange: (id: FormatValue) => void;
  disabled?: boolean;
  className?: string;
};

export default function BarcodeFormatSelect({ value, onChange, disabled, className }: Props) {
  const { formats, loading } = useSafeBarcodeFormats();
  const safeValue = value || '__auto__';

  return (
    <div className={className}>
      <Label className="text-sm font-medium">Barkod Formatı</Label>
      <Select value={safeValue} onValueChange={(v) => onChange((v as FormatValue) || '__auto__')} disabled={disabled || loading}>
        <SelectTrigger className="w-full mt-1">
          <SelectValue placeholder="Format seçin" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__auto__">Otomatik (Tüm Aktif Formatlar)</SelectItem>
          {(formats || []).map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
