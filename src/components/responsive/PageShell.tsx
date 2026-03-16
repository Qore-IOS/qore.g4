'use client';
import React from 'react';
import { cn } from '@/lib/utils';

export default function PageShell({ className, children }: React.PropsWithChildren<{ className?: string }>) {
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
