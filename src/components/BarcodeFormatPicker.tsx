'use client';
import { useEffect, useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBarcodeFormats } from '@/hooks/useBarcodeFormats';

export default function BarcodeFormatPicker({
  warehouseId,
  value,
  onChange,
  className,
  includeAuto = true,
}: {
  warehouseId?: string | null;
  value?: string | 'AUTO' | null;
  onChange: (v: string | 'AUTO' | null) => void;
  className?: string;
  includeAuto?: boolean;
}) {
  const { formats } = useBarcodeFormats();
  const storageKey = warehouseId ? `malKabul:format:${warehouseId}` : `malKabul:format:_global`;

  useEffect(() => {
    if (value == null) {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
      if (saved) onChange(saved as any);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId]);

  useEffect(() => {
    if (value != null) {
      try { window.localStorage.setItem(storageKey, String(value)); } catch {}
    }
  }, [value, storageKey]);

  const hasLegacy = useMemo(() => formats.some(f => f.strategy === 'legacy_roche'), [formats]);

  return (
    <div className={className}>
      <label className="text-xs text-muted-foreground block mb-1">Barkod Formatı</label>
      <Select value={(value as any) ?? (includeAuto ? 'AUTO' : '')} onValueChange={(v) => onChange((v as any) || null)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Seçiniz" />
        </SelectTrigger>
        <SelectContent>
          {includeAuto && <SelectItem value="AUTO">Otomatik (Tüm Aktif Formatlar)</SelectItem>}
          {formats.map(f => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}{f.strategy === 'legacy_roche' ? (hasLegacy ? ' (Legacy)' : '') : ''} • öncelik {f.priority}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
