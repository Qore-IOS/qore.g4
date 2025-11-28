'use client';
import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Key/Value rows for card bodies.
 * Mobile: single column stacked. Desktop: 2 columns (label/value per row).
 */
export function InfoList({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-3', className)}>{children}</div>;
}

InfoList.Row = function Row({
  label,
  value,
  className,
}: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col md:flex-row md:items-baseline md:justify-between gap-1', className)}>
      <div className="text-sm text-muted-foreground break-words">{label}</div>
      <div className="font-medium break-words">{value}</div>
    </div>
  );
};
