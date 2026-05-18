'use client';
import React from 'react';
import { cn } from '@/lib/utils';

export default function PageShell({
  className,
  children,
  edgeToEdge,
}: React.PropsWithChildren<{ className?: string; edgeToEdge?: boolean }>) {
  if (edgeToEdge) {
    return (
      <div
        className={cn(
          'page-shell w-full',
          // Edge-to-edge: kenar padding'leri yok; sayfa kendi background'ını
          // tüm ekrana yayar. Dock için yalnızca alt safe-area bırakılır.
          'pb-[env(safe-area-inset-bottom)]',
          'md:pb-[calc(var(--dock-h)+var(--dock-gap)+24px)]',
          className,
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={cn(
      'page-shell mx-auto w-full max-w-none',
      // Desktop padding
      'md:px-3',
      // Mobile padding handled via CSS variables in MobileResponsiveFix
      // Bottom safe area for mobile dock + desktop dock clearance
      'pb-[env(safe-area-inset-bottom)]',
      'md:pb-[calc(var(--dock-h)+var(--dock-gap)+24px)]',
      className
    )}>
      {children}
    </div>
  );
}
