'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useWindowManager } from '@/contexts/window-manager-context';

const TITLE_SOURCE_SELECTOR = '[data-qore-window-content="true"] h1:not([data-qore-ignore-global-title])';
const TITLE_SOURCE_ATTR = 'data-qore-global-title-source';
const TITLE_BLOCK_ATTR = 'data-qore-global-title-block';
const TITLE_DECORATOR_ATTR = 'data-qore-global-title-decorator';

function readPanelTitle(fallbackTitle: string) {
  if (typeof document === 'undefined') return fallbackTitle;

  const titleEl = document.querySelector<HTMLHeadingElement>(TITLE_SOURCE_SELECTOR);
  document.querySelectorAll(`[${TITLE_SOURCE_ATTR}="true"]`).forEach((el) => {
    if (el !== titleEl) el.removeAttribute(TITLE_SOURCE_ATTR);
  });
  document.querySelectorAll(`[${TITLE_BLOCK_ATTR}="true"]`).forEach((el) => {
    el.removeAttribute(TITLE_BLOCK_ATTR);
  });
  document.querySelectorAll(`[${TITLE_DECORATOR_ATTR}="true"]`).forEach((el) => {
    el.removeAttribute(TITLE_DECORATOR_ATTR);
  });

  if (!titleEl) return fallbackTitle;

  const titleBlock = titleEl.parentElement;
  const decorator = titleBlock?.previousElementSibling;

  titleEl.setAttribute(TITLE_SOURCE_ATTR, 'true');
  titleBlock?.setAttribute(TITLE_BLOCK_ATTR, 'true');

  // Common title rows place a decorative icon immediately before the text block.
  // Hide that ornament globally too; the chrome title is intentionally iconless.
  if (decorator && decorator.querySelector('svg') && !decorator.textContent?.trim()) {
    decorator.setAttribute(TITLE_DECORATOR_ATTR, 'true');
  }

  return titleEl.textContent?.replace(/\s+/g, ' ').trim() || fallbackTitle;
}

/**
 * macOS-vari global pencere başlığı.
 * Trafik ışıklarının konumu sabit kalır; hemen yanında tüm standart panellerin
 * ortak dairesel geri butonu ve panelin ilk h1'inden okunan ikonsuz başlığı gösterilir; yerel başlık bloğu global olarak gizlenir.
 */
export function WindowChrome() {
  const { windowHidden, closeCurrent, minimizeCurrent, current } = useWindowManager();
  const router = useRouter();
  const pathname = usePathname();
  const [title, setTitle] = useState(current.title);

  useEffect(() => {
    if (windowHidden) return;

    const syncTitle = () => setTitle(readPanelTitle(current.title));
    syncTitle();

    const contentEl = document.querySelector('[data-qore-window-content="true"]');
    if (!contentEl) return;

    const observer = new MutationObserver(syncTitle);
    observer.observe(contentEl, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });

    return () => observer.disconnect();
  }, [current.title, pathname, windowHidden]);

  if (windowHidden) return null;

  const handleBack = () => {
    if (window.history.length > 2) router.back();
    else router.push('/');
  };

  return (
    <div
      className="group fixed top-3.5 left-4 flex items-center gap-2 select-none"
      style={{ zIndex: 200 }}
      // Pencere başlığı sürükleme alanı değil; tıklamaların alta geçmemesi için.
      onMouseDown={(e) => e.stopPropagation()}
      aria-label="Global pencere başlığı"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={closeCurrent}
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
          onClick={minimizeCurrent}
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

      <button
        type="button"
        onClick={handleBack}
        aria-label="Geri dön"
        title="Geri dön"
        className="ml-3 grid h-7 w-7 place-items-center rounded-full border border-black/5 bg-white/75 text-slate-800 shadow-[0_8px_22px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-md transition hover:bg-white active:scale-95 dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
      </button>

      <div className="min-w-0 pl-1">
        <h1 className="qore-window-title max-w-[min(52vw,520px)] truncate text-[19px] font-extrabold leading-none tracking-[-0.035em] text-slate-950 drop-shadow-[0_1px_0_rgba(255,255,255,0.65)] dark:text-white sm:text-[21px]">
          {title}
        </h1>
      </div>
    </div>
  );
}

export default WindowChrome;
