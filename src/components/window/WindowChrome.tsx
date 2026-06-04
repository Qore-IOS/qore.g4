'use client';

import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { useWindowManager } from '@/contexts/window-manager-context';
import { WINDOW_HEADER_H } from './WindowHost';

/**
 * Global pencere başlık çubuğu (başlık paketi):
 *  • macOS-vari trafik ışıkları (kapat / küçült / tam ekran)
 *  • global geri butonu (aktif pencerenin iframe geçmişinde geri gider)
 *  • aktif panelin başlığı
 * Aktif pencere yoksa (sade masaüstü) gizlenir.
 */
export function WindowChrome() {
  const { windows, activeId, minimizeWindow, closeWindow, windowBack } = useWindowManager();

  if (!activeId) return null;
  const active = windows.find((w) => w.id === activeId);

  return (
    <div
      className="fixed top-0 left-0 right-0 flex items-center gap-3 px-4 select-none bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl border-b border-black/[0.06] dark:border-white/10"
      style={{ height: WINDOW_HEADER_H, zIndex: 220 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* trafik ışıkları */}
      <div className="group flex items-center gap-2">
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
          aria-label="Tam ekran (zaten tam ekran)"
          title="Tam ekran"
          className="relative h-[13px] w-[13px] rounded-full bg-[#28c840] border border-black/10 grid place-items-center opacity-90 cursor-default"
        >
          <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="8" height="8" viewBox="0 0 8 8" fill="rgba(0,80,0,.5)">
            <path d="M1.6 1.6h2.2L1.6 3.8zM6.4 6.4H4.2L6.4 4.2z" />
          </svg>
        </button>
      </div>

      {/* global geri butonu */}
      <button
        type="button"
        onClick={windowBack}
        aria-label="Geri"
        title="Geri"
        className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition"
      >
        <ChevronLeft className="h-[18px] w-[18px]" />
      </button>

      {/* panel başlığı */}
      {active && (
        <span className="text-[13.5px] font-semibold text-foreground truncate">
          {active.title}
        </span>
      )}
    </div>
  );
}

export default WindowChrome;
