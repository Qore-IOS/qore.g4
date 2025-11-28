'use client';
import React from 'react';
import { cn } from '@/lib/utils';

export default function PageShell({ className, children }: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn('page-shell mx-auto w-full max-w-screen-2xl pb-[env(safe-area-inset-bottom)] md:px-6', className)}>
      {children}
    </div>
  );
}
