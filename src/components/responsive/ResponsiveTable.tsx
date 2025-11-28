
'use client';
import React from 'react';
import { cn } from '@/lib/utils';

type ColumnDef<T> = {
  key: keyof T | string;
  header: React.ReactNode;
  cell?: (row: T) => React.ReactNode;
  hideOnMobile?: boolean;
  stackedLabel?: string;
};

type Props<T> = {
  rows: T[];
  columns: ColumnDef<T>[];
  mobileMode?: 'scroll' | 'stack';
  rowKey?: (row: T, index: number) => React.Key;
  className?: string;
  stackedCardClassName?: string;
};

export default function ResponsiveTable<T>({
  rows,
  columns,
  mobileMode = 'stack',
  rowKey = (_r, i) => i,
  className,
  stackedCardClassName,
}: Props<T>) {
  return (
    <div className={cn('w-full', className)}>
      {/* Desktop table unchanged */}
      <div className="hidden md:block">
        <div className="relative w-full overflow-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="[&_tr]:border-b">
              <tr>
                {columns.map((c, i) => (
                  <th key={i} className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {rows.map((r, i) => (
                <tr key={rowKey(r, i)} className="border-b">
                  {columns.map((c, j) => (
                    <td key={j} className="p-4 align-middle">{c.cell ? c.cell(r) : (r as any)[c.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile */}
      {mobileMode === 'scroll' ? (
        <div className="md:hidden relative w-full overflow-x-auto -mx-2 px-2">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="[&_tr]:border-b">
              <tr>
                {columns.map((c, i) => (
                  <th key={i} className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {rows.map((r, i) => (
                <tr key={rowKey(r, i)} className="border-b">
                  {columns.map((c, j) => (
                    <td key={j} className="p-3 align-middle">{c.cell ? c.cell(r) : (r as any)[c.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="md:hidden space-y-3">
          {rows.map((r, i) => (
            <div key={rowKey(r, i)} className={cn('rounded-xl border border-border/40 bg-background/50 shadow-sm p-3', stackedCardClassName)}>
              {/* first row: show first two visible columns side-by-side */}
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {columns.filter(c => !c.hideOnMobile).slice(0, 2).map((c, j) => (
                  <div key={j} className={j === 0 ? 'font-medium break-words' : 'text-muted-foreground break-words'}>
                    {c.cell ? c.cell(r) : (r as any)[c.key]}
                  </div>
                ))}
              </div>
              {/* rest: key/value lines */}
              <div className="mt-2 grid grid-cols-1 gap-1">
                {columns.filter((_, idx) => idx >= 2).filter(c => !c.hideOnMobile).map((c, j) => (
                  <div key={j} className="text-xs text-muted-foreground break-words">
                    <span className="font-medium text-foreground">{c.stackedLabel ?? c.header}: </span>
                    <span className="font-mono">{c.cell ? c.cell(r) : (r as any)[c.key]}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
