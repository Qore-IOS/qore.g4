'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { AppWindow } from 'lucide-react';
import { VIEWS } from '@/lib/constants';
import { runGenie, applyGenieCollapsed, clearGenie } from '@/lib/genie';

export interface MinimizedWindow {
  id: string;
  title: string;
  icon: React.ElementType;
}

interface WindowManagerCtx {
  isMinimized: boolean;
  isClosed: boolean;
  /** Pencere içeriği gizli mi (küçültülmüş veya kapatılmış → sade masaüstü). */
  windowHidden: boolean;
  minimized: MinimizedWindow[];
  current: { title: string; icon: React.ElementType };
  registerContentEl: (el: HTMLElement | null) => void;
  registerDockTarget: (el: HTMLElement | null) => void;
  minimizeCurrent: () => void;
  closeCurrent: () => void;
  restore: (id: string) => void;
  surface: () => void;
}

const Ctx = createContext<WindowManagerCtx | undefined>(undefined);

/**
 * Pencere yöneticisi (ilk adım: tek pencere).
 *
 * Açık panel bir "pencere" gibi davranır: küçült (genie ile dock'a, state
 * korunarak), kapat (sade masaüstünü göster), dock'taki sekmeden geri getir.
 * İçerik DOM'dan kaldırılmaz — yalnızca görünürlüğü kapatılır (visibility:
 * hidden) — böylece yapılan işlemler/scroll/form state'i sıfırlanmaz.
 */
export function WindowManagerProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const contentRef = useRef<HTMLElement | null>(null);
  const dockTargetRef = useRef<HTMLElement | null>(null);

  const [isMinimized, setIsMinimized] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [minimized, setMinimized] = useState<MinimizedWindow[]>([]);

  // Mevcut "pencereyi" route'tan tanı (başlık + ikon).
  const current = useMemo(() => {
    const v = VIEWS.find(
      (x) => x.href && (pathname === x.href || pathname?.startsWith(x.href + '/')),
    );
    return {
      title: v?.label || 'Pencere',
      icon: (v?.icon as React.ElementType) || AppWindow,
    };
  }, [pathname]);

  // Başka bir route'a geçmek pencereyi tazeler (şimdilik tek pencere modeli).
  useEffect(() => {
    setIsMinimized(false);
    setIsClosed(false);
    setMinimized([]);
    const el = contentRef.current;
    if (el) clearGenie(el);
  }, [pathname]);

  const registerContentEl = useCallback((el: HTMLElement | null) => {
    contentRef.current = el;
  }, []);
  const registerDockTarget = useCallback((el: HTMLElement | null) => {
    dockTargetRef.current = el;
  }, []);

  const dockTarget = useCallback((index: number) => {
    const t = dockTargetRef.current;
    if (!t) return null;
    
    // minZoneRef is the container. Find the specific slot or use container as fallback.
    const children = Array.from(t.children);
    const targetChild = (children[index] as HTMLElement) || t;
    
    const r = targetChild.getBoundingClientRect();
    if (!r.width) return null;

    let yOffset = 0;
    // Account for Dock's transform (e.g. translateY(20px)) if it's currently hidden
    // We use closest with a specific class that framer-motion applies to the dock.
    const dockEl = t.closest('.h-\\[72px\\]');
    if (dockEl) {
       const style = window.getComputedStyle(dockEl);
       const transform = style.transform;
       if (transform && transform !== 'none') {
           try {
               const matrix = new DOMMatrixReadOnly(transform);
               yOffset = matrix.f; // f is the translateY component
           } catch(e) {}
       }
    }

    return { x: r.left + r.width / 2, y: r.top - yOffset, w: r.width };
  }, []);

  const minimizeCurrent = useCallback(() => {
    const el = contentRef.current;
    if (!el || isMinimized) return;
    
    // Yüzeyi göster (Dock'u aç)
    window.dispatchEvent(new CustomEvent('qore:dock-show'));

    const finish = () => {
      setIsMinimized(true);
      setMinimized([{ id: pathname || 'win', title: current.title, icon: current.icon }]);
      // Eleman gizlendikten sonra inline genie stillerini temizle.
      requestAnimationFrame(() => requestAnimationFrame(() => clearGenie(el)));
    };
    
    // Sadece 1 pencere desteklendiği için eklenecek indeks minimized.length'dir.
    const tgt = dockTarget(minimized.length);
    if (tgt) runGenie(el, tgt.x, tgt.y, { onDone: finish, slotW: tgt.w });
    else finish();
  }, [isMinimized, pathname, current, dockTarget, minimized]);

  const restore = useCallback(() => {
    const el = contentRef.current;
    
    // Yüzeyi göster (Dock'u aç)
    window.dispatchEvent(new CustomEvent('qore:dock-show'));

    // Geri getirme animasyonu dock'ta bulunan var olan (minimized) ikondan çıkar.
    // Şimdilik sadece 1 pencere desteklediğimizden index 0'dır.
    const tgt = dockTarget(0);
    // Flash'ı önlemek için göstermeden önce büzülmüş kareye sabitle.
    if (el && tgt) applyGenieCollapsed(el, tgt.x, tgt.y, tgt.w);
    setIsMinimized(false);
    setMinimized([]);
    if (el && tgt) {
      requestAnimationFrame(() => {
        runGenie(el, tgt.x, tgt.y, { reverse: true, slotW: tgt.w });
      });
    } else if (el) {
      clearGenie(el);
    }
  }, [dockTarget]);

  const closeCurrent = useCallback(() => {
    setIsClosed(true);
    setIsMinimized(false);
    setMinimized([]);
    const el = contentRef.current;
    if (el) clearGenie(el);
  }, []);

  const surface = useCallback(() => {
    setIsClosed(false);
    setIsMinimized(false);
    setMinimized([]);
    const el = contentRef.current;
    if (el) clearGenie(el);
  }, []);

  const value = useMemo<WindowManagerCtx>(
    () => ({
      isMinimized,
      isClosed,
      windowHidden: isMinimized || isClosed,
      minimized,
      current,
      registerContentEl,
      registerDockTarget,
      minimizeCurrent,
      closeCurrent,
      restore,
      surface,
    }),
    [
      isMinimized,
      isClosed,
      minimized,
      current,
      registerContentEl,
      registerDockTarget,
      minimizeCurrent,
      closeCurrent,
      restore,
      surface,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWindowManager() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWindowManager must be used within a WindowManagerProvider');
  return c;
}
