'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface LedStripGlowProps {
  isReady: boolean;
  /**
   * bottom-right → right edge + bottom edge (direkt transfer)
   * top-right    → right edge + top edge   (mal kabul)
   */
  corner: 'bottom-right' | 'top-right';
}

// Two thin strips hug the card edges and meet at the corner; the glow comes
// from the box-shadow, the far ends melt away via mask so there are no hard
// stops. The strip core is nearly invisible — only the spill reads as light.
const stripClasses: Record<LedStripGlowProps['corner'], [string, string]> = {
  'bottom-right': [
    'right-0 top-[10%] bottom-0 w-[2px] led-mask-fade-top',
    'bottom-0 left-[10%] right-0 h-[2px] led-mask-fade-left',
  ],
  'top-right': [
    'right-0 bottom-[10%] top-0 w-[2px] led-mask-fade-bottom',
    'top-0 left-[10%] right-0 h-[2px] led-mask-fade-left',
  ],
};

/**
 * Ambient LED strip effect tied only to data-ready state.
 * React.memo + finished one-shot CSS animations mean zero work during scans.
 */
export const LedStripGlow = React.memo(function LedStripGlow({
  isReady,
  corner,
}: LedStripGlowProps) {
  const strips = stripClasses[corner];
  const base = 'pointer-events-none absolute rounded-full';
  const amberCls = isReady ? 'led-glow-amber-off' : 'led-glow-amber';

  return (
    <>
      {strips.map((cls, i) => (
        <div key={`a${i}`} aria-hidden className={cn(base, cls, amberCls)} />
      ))}
      {isReady && strips.map((cls, i) => (
        <div key={`g${i}`} aria-hidden className={cn(base, cls, 'led-glow-green')} />
      ))}
    </>
  );
});
