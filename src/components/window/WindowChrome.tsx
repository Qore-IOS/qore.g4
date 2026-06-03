'use client';

import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useWindowManager } from '@/contexts/window-manager-context';

const ROUTE_TITLE_OVERRIDES: Array<{ match: (pathname: string) => boolean; title: string }> = [
  {
    match: (pathname) => pathname === '/stok-yonetimi' || pathname.startsWith('/stok-yonetimi/'),
    title: 'Depo Stoğu',
  },
  {
    match: (pathname) => pathname === '/mal-kabul' || pathname.startsWith('/mal-kabul/'),
    title: 'Mal Kabul',
  },
  {
    match: (pathname) => pathname === '/direkt-transfer' || pathname.startsWith('/direkt-transfer/'),
    title: 'Direkt Transfer',
  },
];

function getPanelTitle(pathname: string | null, fallbackTitle: string) {
  if (!pathname) return fallbackTitle;
  return ROUTE_TITLE_OVERRIDES.find(({ match }) => match(pathname))?.title || fallbackTitle;
}

/**
 * macOS-vari global pencere başlığı.
 * Trafik ışıklarının konumu sabit kalır; hemen yanında tüm standart panellerin
 * ortak dairesel geri butonu ve ikonsuz başlığı gösterilir.
 */
export function WindowChrome() {
  const { windowHidden, closeCurrent, minimizeCurrent, current } = useWindowManager();
  const router = useRouter();
  const pathname = usePathname();
  const title = getPanelTitle(pathname, current.title);

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
        <h1 className="max-w-[min(52vw,520px)] truncate text-[19px] font-extrabold leading-none tracking-[-0.035em] text-slate-950 drop-shadow-[0_1px_0_rgba(255,255,255,0.65)] dark:text-white sm:text-[21px]">
          {title}
        </h1>
      </div>
    </div>
  );
}

export default WindowChrome;
