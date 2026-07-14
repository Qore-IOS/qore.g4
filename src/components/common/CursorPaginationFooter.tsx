/**
 * CursorPaginationFooter — `useCursorPagination` hook'u ile kullanılan
 * standart sayfalama alt çubuğu.
 *
 * "1-20 / 1.234" sayım, sayfa numarası, ileri/geri butonları ve sayfa
 * boyutu seçici sağlar.
 */
'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface CursorPaginationFooterProps {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  loading?: boolean;
  onNext: () => void;
  onPrev: () => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
  /** Sayım yerine "Sayfa X / Y" göster (totalCount=0 ise). */
  hideTotal?: boolean;
}

export function CursorPaginationFooter({
  page,
  pageSize,
  totalCount,
  totalPages,
  hasNext,
  hasPrev,
  loading,
  onNext,
  onPrev,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  className,
  hideTotal,
}: CursorPaginationFooterProps) {
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 pt-2', className)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Sayfa başına:</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-3 text-sm">
        {!hideTotal && totalCount > 0 && (
          <span className="text-muted-foreground tabular-nums">
            {start.toLocaleString('tr-TR')}–{end.toLocaleString('tr-TR')} / {totalCount.toLocaleString('tr-TR')}
          </span>
        )}
        <span className="text-muted-foreground tabular-nums hidden sm:inline">
          Sayfa {page} / {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onPrev}
            disabled={!hasPrev || loading}
            aria-label="Önceki sayfa"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onNext}
            disabled={!hasNext || loading}
            aria-label="Sonraki sayfa"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
