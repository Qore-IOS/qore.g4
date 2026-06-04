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
import { runGenie, applyGenieCollapsed, clearGenie } from '@/lib/genie';

/** İframe pencere modeli (gerçek OS hissi).
 *  Paneller dock/start menüsünden iframe pencere olarak açılır; küçültülünce
 *  iframe DOM'da kalır (visibility:hidden) → state/scroll/form korunur. En fazla
 *  2 küçültülmüş pencere tutulur; üstüne küçültülürse en eskisi kapatılır. */

export interface WMWindow {
  id: string; // = path
  path: string;
  title: string;
  icon: React.ElementType;
  minimized: boolean;
}

const MAX_MIN = 2;

interface WindowManagerCtx {
  windows: WMWindow[];
  activeId: string | null;
  minimizedWindows: WMWindow[];
  hasActive: boolean;
  openWindow: (path: string, title: string, icon: React.ElementType) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  closeWindow: (id: string) => void;
  registerWindowEl: (id: string, el: HTMLElement | null) => void;
  registerDockTarget: (el: HTMLElement | null) => void;
}

const Ctx = createContext<WindowManagerCtx | undefined>(undefined);

export function WindowManagerProvider({ children }: { children: React.ReactNode }) {
  const [windows, setWindows] = useState<WMWindow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // İmperatif (genie callback'leri) için güncel duruma ref erişimi.
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const windowEls = useRef<Map<string, HTMLElement>>(new Map());
  const dockTargetRef = useRef<HTMLElement | null>(null);

  const registerWindowEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) windowEls.current.set(id, el);
    else windowEls.current.delete(id);
  }, []);
  const registerDockTarget = useCallback((el: HTMLElement | null) => {
    dockTargetRef.current = el;
  }, []);

  // Minimize alanındaki index'inci yuvanın ekran konumu (genie hedefi).
  // Dock'un giriş animasyonu/transform'unu telafi ederek "yerleşik" konuma
  // nişan alır — böylece efekt tam yuvada son bulur.
  const dockSlot = useCallback((index: number) => {
    const c = dockTargetRef.current;
    if (!c) return null;
    const child =
      (c.children[index] as HTMLElement) ||
      (c.lastElementChild as HTMLElement) ||
      c;
    const r = child.getBoundingClientRect();
    if (!r.width) return null;

    let yOffset = 0;
    const dockEl = c.closest('[data-qore-dock]') as HTMLElement | null;
    if (dockEl) {
      const tr = window.getComputedStyle(dockEl).transform;
      if (tr && tr !== 'none') {
        try {
          yOffset = new DOMMatrixReadOnly(tr).f; // translateY bileşeni
        } catch {
          /* yoksay */
        }
      }
    }
    return { x: r.left + r.width / 2, y: r.top - yOffset, w: r.width };
  }, []);

  const minimizedCount = () => windowsRef.current.filter((w) => w.minimized).length;

  const openWindow = useCallback(
    (path: string, title: string, icon: React.ElementType) => {
      setWindows((prev) => {
        const existing = prev.find((w) => w.id === path);
        // Önceki aktif (küçültülmemiş, farklı) pencere bırakılır (gezinme gibi).
        const kept = prev.filter((w) => w.minimized || w.id === path);
        if (existing) {
          return kept.map((w) => (w.id === path ? { ...w, minimized: false } : w));
        }
        return [...kept, { id: path, path, title, icon, minimized: false }];
      });
      setActiveId(path);
    },
    [],
  );

  const minimizeWindow = useCallback(
    (id: string) => {
      if (activeIdRef.current !== id) return;
      // Dock kapalıysa göster (use-dock dinler) — yuva görünür olsun.
      window.dispatchEvent(new CustomEvent('qore:dock-show'));
      const el = windowEls.current.get(id);
      const targetIndex = minimizedCount(); // yeni sekmenin yuvası
      const finish = () => {
        setActiveId((cur) => (cur === id ? null : cur));
        setWindows((prev) => {
          let next = prev.map((w) => (w.id === id ? { ...w, minimized: true } : w));
          const mins = next.filter((w) => w.minimized);
          if (mins.length > MAX_MIN) {
            const evict = mins[0].id; // en eski küçültülmüşü kapat
            next = next.filter((w) => w.id !== evict);
          }
          return next;
        });
        if (el) requestAnimationFrame(() => requestAnimationFrame(() => clearGenie(el)));
      };
      if (!el) return finish();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const tgt = dockSlot(targetIndex);
          if (tgt) runGenie(el, tgt.x, tgt.y, { onDone: finish, slotW: tgt.w });
          else finish();
        }),
      );
    },
    [dockSlot],
  );

  const restoreWindow = useCallback(
    (id: string) => {
      const mins = windowsRef.current.filter((w) => w.minimized);
      const idx = mins.findIndex((w) => w.id === id);
      if (idx < 0) return;
      window.dispatchEvent(new CustomEvent('qore:dock-show'));
      const el = windowEls.current.get(id);
      const apply = () => {
        // Önceki aktif (küçültülmemiş, farklı) bırakılır; bu pencere aktif olur.
        setWindows((prev) =>
          prev
            .filter((w) => w.minimized || w.id === id)
            .map((w) => (w.id === id ? { ...w, minimized: false } : w)),
        );
        setActiveId(id);
      };
      if (el) {
        const tgt = dockSlot(idx);
        if (tgt) applyGenieCollapsed(el, tgt.x, tgt.y, tgt.w); // flash önleme
        apply();
        requestAnimationFrame(() => {
          const t2 = dockSlot(idx);
          if (t2) runGenie(el, t2.x, t2.y, { reverse: true, slotW: t2.w });
          else clearGenie(el);
        });
      } else {
        apply();
      }
    },
    [dockSlot],
  );

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
    windowEls.current.delete(id);
  }, []);

  const minimizedWindows = useMemo(() => windows.filter((w) => w.minimized), [windows]);

  const value = useMemo<WindowManagerCtx>(
    () => ({
      windows,
      activeId,
      minimizedWindows,
      hasActive: activeId != null,
      openWindow,
      minimizeWindow,
      restoreWindow,
      closeWindow,
      registerWindowEl,
      registerDockTarget,
    }),
    [
      windows,
      activeId,
      minimizedWindows,
      openWindow,
      minimizeWindow,
      restoreWindow,
      closeWindow,
      registerWindowEl,
      registerDockTarget,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWindowManager() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWindowManager must be used within a WindowManagerProvider');
  return c;
}

/** Bu uygulama bir iframe pencere içinde mi çalışıyor? (çıplak mod tespiti) */
export function useIsWindowMode() {
  const [inIframe, setInIframe] = useState(false);
  useEffect(() => {
    try {
      setInIframe(window.self !== window.top);
    } catch {
      setInIframe(true); // cross-origin → iframe varsay
    }
  }, []);
  return inIframe;
}
