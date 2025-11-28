'use client';
import React from 'react';
import { cn } from '@/lib/utils';

/** Fluid media container for images/charts inside cards */
export default function MediaBox({
  aspect = 'aspect-video',
  className,
  children,
}: React.PropsWithChildren<{ aspect?: 'aspect-video' | 'aspect-square' | string; className?: string }>) {
  return (
    <div className={cn('w-full overflow-hidden rounded-xl', aspect, className)}>
      {/* Children should fill with width/height:100% (e.g., Recharts ResponsiveContainer) */}
      <div className="w-full h-full">{children}</div>
    </div>
  );
}
