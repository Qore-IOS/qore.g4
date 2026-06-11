'use client';

import React from 'react';
import { cn } from '@/lib/utils';

type Corner = 'bottom-right' | 'top-right';

interface LedStripGlowProps {
  isReady: boolean;
  /** Which two card edges the hidden strip runs along, meeting at this corner. */
  corner: Corner;
}

// Two strips form a continuous L meeting at the corner; the far ends fade out
// via mask so the light looks like spill from a hidden LED, not a hard source.
const stripClasses: Record<Corner, [string, string]> = {
  'bottom-right': [
    '-right-[3px] top-[8%] -bottom-[3px] w-[3px] led-mask-fade-top',
    '-bottom-[3px] left-[8%] -right-[3px] h-[3px] led-mask-fade-left',
  ],
  'top-right': [
    '-right-[3px] bottom-[8%] -top-[3px] w-[3px] led-mask-fade-bottom',
    '-top-[3px] left-[8%] -right-[3px] h-[3px] led-mask-fade-left',
  ],
};

/**
 * Ambient LED strip effect tied only to data-ready state.
 * React.memo + finished CSS animations mean zero work during barcode scans:
 * amber swaps to a one-shot fade-out and green settles to a static frame.
 */
export const LedStripGlow = React.memo(function LedStripGlow({
  isReady,
  corner,
}: LedStripGlowProps) {
  const strips = stripClasses[corner];
  const base = 'pointer-events-none absolute rounded-full';

  return (
    <>
      {strips.map((cls, i) => (
        <div
          key={`a${i}`}
          aria-hidden
          className={cn(base, cls, isReady ? 'led-glow-amber-off' : 'led-glow-amber')}
        />
      ))}
      {isReady && strips.map((cls, i) => (
        <div key={`g${i}`} aria-hidden className={cn(base, cls, 'led-glow-green')} />
      ))}
    </>
  );
});
