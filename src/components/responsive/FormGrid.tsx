'use client';
import React from 'react';
import { cn } from '@/lib/utils';

export default function FormGrid({
  colsMd = 2,
  colsLg,
  className,
  children,
}: React.PropsWithChildren<{ colsMd?: 1|2|3|4|5|6; colsLg?: 1|2|3|4|5|6; className?: string }>) {
  return (
    <div className={cn('stack-on-mobile md:grid gap-3', `md:grid-cols-${colsMd}`, colsLg ? `lg:grid-cols-${colsLg}` : '', className)}>
      {children}
    </div>
  );
}

FormGrid.Item = function Item({
  mdSpan = 1,
  lgSpan,
  className,
  children,
}: React.PropsWithChildren<{ mdSpan?: 1|2|3|4|5|6; lgSpan?: 1|2|3|4|5|6; className?: string }>) {
  return <div className={cn(mdSpan ? `md:col-span-${mdSpan}` : '', lgSpan ? `lg:col-span-${lgSpan}` : '', className)}>{children}</div>;
};
