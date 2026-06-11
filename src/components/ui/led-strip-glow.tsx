'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface LedStripGlowProps {
  isReady: boolean;
  edge: 'right' | 'bottom';
}

const edgeClass = {
  right:  'right-0  top-[10%]  bottom-[10%] w-[1px]',
  bottom: 'bottom-0 left-[10%] right-[10%]  h-[1px]',
} as const;

/**
 * Ambient LED strip effect tied only to data-ready state.
 * React.memo ensures zero re-renders during barcode scanning.
 */
export const LedStripGlow = React.memo(function LedStripGlow({
  isReady,
  edge,
}: LedStripGlowProps) {
  const base = cn('pointer-events-none absolute rounded-full', edgeClass[edge]);

  return (
    <>
      {/* Amber breathing — fades out when data is ready */}
      <div
        aria-hidden
        className={cn(
          base,
          'led-glow-amber',
          isReady && 'opacity-0 transition-opacity duration-700',
        )}
      />
      {/* Green steady — mounts and fades in when data is ready */}
      {isReady && <div aria-hidden className={cn(base, 'led-glow-green')} />}
    </>
  );
});
