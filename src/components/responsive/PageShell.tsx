'use client';
import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';

export default function PageShell({
  className,
  children,
  edgeToEdge,
}: React.PropsWithChildren<{ className?: string; edgeToEdge?: boolean }>) {
  // Edge-to-edge sayfalarda body'e de mg-bg uygulanır (siyah/beyaz çerçeve olmasın).
  useEffect(() => {
    if (!edgeToEdge) return;
    document.body.classList.add('mg-edge-body');
    return () => {
      document.body.classList.remove('mg-edge-body');
    };
  }, [edgeToEdge]);

  if (edgeToEdge) {
    return (
      <div
        className={cn(
          'page-shell w-full',
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
      'md:px-3',
      'pb-[env(safe-area-inset-bottom)]',
      'md:pb-[calc(var(--dock-h)+var(--dock-gap)+24px)]',
      className
    )}>
      {children}
    </div>
  );
}
