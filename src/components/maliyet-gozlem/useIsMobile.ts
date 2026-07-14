'use client';
import { useEffect, useState } from 'react';

/**
 * Mobile breakpoint (max-width: 768px) tespiti. Maliyet Gözlem ve Dashboard
 * gibi inline-style kullanan sayfalarda responsive davranışı sağlamak için
 * Tailwind responsive sınıflarına alternatif olarak kullanılır.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [breakpoint]);
  return isMobile;
}
