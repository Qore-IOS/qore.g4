'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

export function useRowFocus(param: string = 'focus') {
  const sp = useSearchParams();
  const focusId = sp.get(param);
  const focusRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!focusId) return;

    const el = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(focusId)}"]`);
    
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const prevClassName = el.className;
      el.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background', 'bg-primary/5', 'animate-pulse');
      
      const timer = setTimeout(() => {
        el.className = prevClassName;
      }, 2200);

      return () => clearTimeout(timer);
    }
  }, [focusId, param]);

  return { focusRef };
}
