'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface LedStripGlowProps {
  isReady: boolean;
  corner: 'bottom-right' | 'top-right';
}

/**
 * inset-0 absolute with rounded-[24px] to match the card.
 * box-shadow spills OUTSIDE the card bounds; the card's opaque
 * background hides this element — only the shadow light is visible.
 */
export const LedStripGlow = React.memo(function LedStripGlow({
  isReady,
  corner,
}: LedStripGlowProps) {
  const base = 'absolute inset-0 rounded-[24px] pointer-events-none';
  const br = corner === 'bottom-right';
  const amberShadow = br ? 'led-shadow-amber-br' : 'led-shadow-amber-tr';
  const greenShadow  = br ? 'led-shadow-green-br'  : 'led-shadow-green-tr';

  return (
    <>
      <div
        aria-hidden
        className={cn(base, amberShadow, isReady ? 'led-anim-out' : 'led-anim-breathe')}
      />
      {isReady && (
        <div aria-hidden className={cn(base, greenShadow, 'led-anim-in')} />
      )}
    </>
  );
});
