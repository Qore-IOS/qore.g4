'use client';
import React from 'react';
import { SelectItem } from '@/components/ui/select';

export function SafeSelectItem<T extends { id?: string | number }>({
  item,
  children,
}: {
  item: T;
  children: React.ReactNode;
}) {
  if (item?.id == null) return null;
  return (
    <SelectItem value={String(item.id)}>
      {children}
    </SelectItem>
  );
}
