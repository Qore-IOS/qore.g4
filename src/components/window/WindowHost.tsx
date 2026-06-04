'use client';

import React, { useEffect, useRef } from 'react';
import { useWindowManager, type WMWindow } from '@/contexts/window-manager-context';

/**
 * Açık/küçültülmüş pencereleri iframe olarak render eder. Tüm pencereler tek bir
 * stabil listede tutulur (key=id) — aktif↔küçük geçişlerinde iframe remount
 * OLMAZ, böylece içerideki state (form/scroll/işlemler) korunur. Aktif olan
 * görünür; diğerleri visibility:hidden ile DOM'da canlı kalır. Sarmalayıcı div
 * genie animasyonunun hedefidir (window manager'a kaydedilir).
 */
function WindowItem({ win, active }: { win: WMWindow; active: boolean }) {
  const { registerWindowEl } = useWindowManager();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerWindowEl(win.id, ref.current);
    return () => registerWindowEl(win.id, null);
  }, [registerWindowEl, win.id]);

  return (
    <div
      ref={ref}
      aria-hidden={!active}
      style={{
        position: 'fixed',
        left: 8,
        right: 8,
        top: 8,
        bottom: 'calc(var(--dock-gap) + var(--dock-h) + 12px)',
        zIndex: 60,
        borderRadius: 16,
        overflow: 'hidden',
        background: 'hsl(var(--background))',
        border: '1px solid hsl(var(--border))',
        boxShadow:
          '0 30px 80px -24px rgba(0,0,0,.45), 0 8px 24px -12px rgba(0,0,0,.3)',
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      <iframe
        src={win.path}
        title={win.title}
        style={{
          width: '100%',
          height: '100%',
          border: 0,
          display: 'block',
          background: 'hsl(var(--background))',
        }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

export function WindowHost() {
  const { windows, activeId } = useWindowManager();
  return (
    <>
      {windows.map((w) => (
        <WindowItem key={w.id} win={w} active={w.id === activeId} />
      ))}
    </>
  );
}

export default WindowHost;
