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
  registerDockReveal: (fn: (() => void) | null) => void;
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
  // Dock kapalıyken (auto-hide) minimize edildiğinde dock'u görünür yapacak fn.
  const dockRevealRef = useRef<(() => void) | null>(null);
  const registerDockReveal = useCallback((fn: (() => void) | null) => {
    dockRevealRef.current = fn;
  }, []);

  // Genie hedefi: minimize alanının İLK yuvası (sekme oraya iner), konteyner
  // merkezi değil — böylece efekt tam o yuvada son bulur.
  const dockTarget = useCallback(() => {
    const t = dockTargetRef.current;
    if (!t) return null;
    const slot = (t.firstElementChild as HTMLElement) || t;
    const r = slot.getBoundingClientRect();
    if (!r.width) return null;

    // Dock gizliyken framer-motion translateY(20px) uygular.
    // getBoundingClientRect bu transform'u içerir, biz "açık" konumu istiyoruz.
    let yOffset = 0;
    let scaleCompensation = 1;
    const dockEl = t.closest('[data-qore-dock]') as HTMLElement | null;
    if (dockEl) {
      const style = window.getComputedStyle(dockEl);
      const transform = style.transform;
      if (transform && transform !== 'none') {
        try {
          const matrix = new DOMMatrixReadOnly(transform);
          yOffset = matrix.f; // translateY bileşeni
          // fitScale de transform matrisinde. a ve d ölçek bileşenleri.
          if (matrix.a > 0 && matrix.a < 1) {
            scaleCompensation = matrix.a;
          }
        } catch (_e) { /* ignore */ }
      }
    }

    return {
      x: r.left + r.width / 2,
      y: r.top - yOffset,
      w: r.width / scaleCompensation, // scale'den arındırılmış gerçek genişlik
    };
  }, []);

  const minimizeCurrent = useCallback(() => {
    const el = contentRef.current;
    if (!el || isMinimized) return;
    // Dock kapalıysa önce göster ki panel ulaşacağı yuvayı görebilelim.
    dockRevealRef.current?.();
    const finish = () => {
      setIsMinimized(true);
      setMinimized([{ id: pathname || 'win', title: current.title, icon: current.icon }]);
      // Eleman gizlendikten sonra inline genie stillerini temizle.
      requestAnimationFrame(() => requestAnimationFrame(() => clearGenie(el)));
    };
    // Dock görünür konuma gelsin diye birkaç kare bekleyip ölç + genie başlat.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const tgt = dockTarget();
        if (tgt) runGenie(el, tgt.x, tgt.y, { onDone: finish, slotW: tgt.w });
        else finish();
      }),
    );
  }, [isMinimized, pathname, current, dockTarget]);

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
      registerDockReveal,
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
      registerDockReveal,
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
