/**
 * DateRangeFilterBar — Geçmiş/rapor paneller için standart tarih filtre çubuğu.
 *
 * `useDateRangeFilter` hook'u ile birlikte kullanılır. Varsayılan etiketi
 * "Son 90 gün" şeklindedir ve preset menüsü, kalıcı seçim, yenileme butonu
 * sağlar.
 */
'use client';

import React from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface DateRangeFilterBarProps {
  range: DateRange | undefined;
  setRange: (next: DateRange | undefined) => void;
  /** "Yenile" tıklandığında çağrılır — refetch tetiklemek için. */
  onRefresh?: () => void;
  /** "Son 90 gün" vb. yardımcı etiket. */
  label?: string;
  /** Sıkı yer için badge'i gizlemek. */
  showSummaryBadge?: boolean;
  /** Tüm zaman seçeneğini gizle (allowAll=false hook ile uyum). */
  hideAllOption?: boolean;
  className?: string;
}

function formatRangeSummary(range: DateRange | undefined): string {
  if (!range?.from) return 'Tüm zaman';
  if (!range.to) return format(range.from, 'd MMM yyyy', { locale: tr });
  return `${format(range.from, 'd MMM yyyy', { locale: tr })} – ${format(range.to, 'd MMM yyyy', { locale: tr })}`;
}

export function DateRangeFilterBar({
  range,
  setRange,
  onRefresh,
  label = 'Tarih aralığı',
  showSummaryBadge = true,
  hideAllOption = false,
  className,
}: DateRangeFilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        <span>{label}:</span>
      </div>
      <div className="min-w-[240px]">
        <DatePickerWithRange
          date={range}
          setDate={setRange}
          showAllOption={!hideAllOption}
        />
      </div>
      {showSummaryBadge && (
        <Badge variant="secondary" className="hidden sm:inline-flex">
          {formatRangeSummary(range)}
        </Badge>
      )}
      {onRefresh && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="ml-auto"
          aria-label="Yenile"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
