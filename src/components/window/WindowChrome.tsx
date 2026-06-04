'use client';

import React from 'react';
import { useWindowManager } from '@/contexts/window-manager-context';

/**
 * macOS-vari global trafik ışıkları — aktif pencere üzerinde işlem yapar.
 * Kapat ve küçült çalışır; tam ekran (yeşil) şimdilik devre dışı.
 * Aktif pencere yoksa (sade masaüstü) gizlenir.
 */
export function WindowChrome() {
  const { activeId, minimizeWindow, closeWindow } = useWindowManager();

  if (!activeId) return null;

  return (
    <div
      className="group fixed top-3.5 left-5 flex items-center gap-2 select-none"
      style={{ zIndex: 220 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => closeWindow(activeId)}
        aria-label="Kapat"
        title="Kapat"
        className="relative h-[13px] w-[13px] rounded-full bg-[#ff5f57] border border-black/10 grid place-items-center transition active:brightness-90"
      >
        <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="7" height="7" viewBox="0 0 8 8" stroke="rgba(80,0,0,.55)" strokeWidth="1.3" strokeLinecap="round">
          <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => minimizeWindow(activeId)}
        aria-label="Küçült"
        title="Küçült"
        className="relative h-[13px] w-[13px] rounded-full bg-[#febc2e] border border-black/10 grid place-items-center transition active:brightness-90"
      >
        <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="8" height="8" viewBox="0 0 8 8" stroke="rgba(110,70,0,.6)" strokeWidth="1.3" strokeLinecap="round">
          <path d="M1.5 4h5" />
        </svg>
      </button>

      <button
        type="button"
        disabled
        aria-label="Tam ekran (yakında)"
        title="Tam ekran (yakında)"
        className="relative h-[13px] w-[13px] rounded-full bg-[#28c840] border border-black/10 grid place-items-center opacity-90 cursor-default"
      >
        <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="8" height="8" viewBox="0 0 8 8" fill="rgba(0,80,0,.5)">
          <path d="M1.6 1.6h2.2L1.6 3.8zM6.4 6.4H4.2L6.4 4.2z" />
        </svg>
      </button>
    </div>
  );
}

export default WindowChrome;
