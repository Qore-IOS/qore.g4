'use client';

import React, { useEffect, useRef } from 'react';
import { useWindowManager, type WMWindow } from '@/contexts/window-manager-context';

/**
 * Açık/küçültülmüş pencereleri iframe olarak render eder. Tüm pencereler tek bir
 * stabil listede tutulur (key=id) — aktif↔küçük geçişlerinde iframe remount
 * OLMAZ, böylece içerideki state (form/scroll/işlemler) korunur. Aktif olan
 * görünür; diğerleri visibility:hidden ile DOM'da canlı kalır. Sarmalayıcı div
 * genie animasyonunun hedefidir (window manager'a kaydedilir).
 *
 * Pencereler TAM EKRAN (inset:0). İframe kendi compositing katmanına alınır
 * (translateZ) — üstündeki clip-path warp'ını yırtılma/yarım çizim olmadan kırpar.
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
        inset: 0,
        zIndex: 60,
        overflow: 'hidden',
        background: 'hsl(var(--background))',
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
          // Kendi GPU katmanı → üstteki clip-path warp'ı temiz kırpar (yırtılma yok).
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          willChange: 'transform',
        }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

export function WindowHost() {
  const { windows, activeId } = useWindowManager();

  // Bir pencere açıkken dış (masaüstü) kaydırmayı kilitle — yoksa sağda iki
  // kaydırma çubuğu üst üste biner ve bazen arkadaki panel scroll edilir.
  useEffect(() => {
    if (activeId == null) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = 'hidden';
    return () => {
      el.style.overflow = prev;
    };
  }, [activeId]);

  return (
    <>
      {windows.map((w) => (
        <WindowItem key={w.id} win={w} active={w.id === activeId} />
      ))}
    </>
  );
}

export default WindowHost;
