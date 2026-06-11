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

/**
 * Two blurred blobs positioned BEFORE the card in DOM so the card's opaque
 * background covers the inner halves; only the outer halves are visible as
 * soft light spilling from a "hidden" strip behind the card edge.
 *
 * React.memo → re-renders only when isReady changes (once, at load).
 * All animation runs in the CSS compositor; zero JS cost during scanning.
 */
export const LedStripGlow = React.memo(function LedStripGlow({
  isReady,
  corner,
}: LedStripGlowProps) {
  const br = corner === 'bottom-right';

  // Vertical blob centred on the right edge
  const vClass = cn(
    'pointer-events-none absolute -right-6 w-12',
    br ? 'top-[12%] -bottom-6' : '-top-6 bottom-[12%]',
  );
  // Horizontal blob centred on the bottom/top edge
  const hClass = cn(
    'pointer-events-none absolute h-12 left-[12%] -right-6',
    br ? '-bottom-6' : '-top-6',
  );

  const amberCls = isReady ? 'led-blob-amber-out' : 'led-blob-amber';

  return (
    <>
      <div aria-hidden className={cn(vClass, amberCls)} />
      <div aria-hidden className={cn(hClass, amberCls)} />
      {isReady && <div aria-hidden className={cn(vClass, 'led-blob-green')} />}
      {isReady && <div aria-hidden className={cn(hClass, 'led-blob-green')} />}
    </>
  );
});
