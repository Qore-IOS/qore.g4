'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useWindowManager } from '@/contexts/window-manager-context';

/**
 * Açık paneli saran "pencere" çerçevesi. Görsel bir kasa eklemez — yalnızca
 * genie animasyonu için ölçülebilir bir kutu sağlar ve küçültülünce/kapatılınca
 * içeriği görünmez yapar (visibility:hidden — DOM'da kalır, state korunur).
 */
export function WindowFrame({ children }: { children: React.ReactNode }) {
  const { registerContentEl, windowHidden } = useWindowManager();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerContentEl(ref.current);
    return () => registerContentEl(null);
  }, [registerContentEl]);

  return (
    <div
      ref={ref}
      data-qore-window-content="true"
      className={cn(
        'w-full flex-1 flex flex-col min-h-0',
        // visibility:hidden — layout/rect korunur (genie ölçümü için), görsel gizlenir
        windowHidden && 'invisible',
      )}
    >
      {children}
    </div>
  );
}

export default WindowFrame;
