/**
 * @fileoverview `next/navigation` yerine geçen shim.
 *
 * NEDEN BÖYLE: Terminal ekranları (`src/app/terminal/**`), ortak kabuk ve
 * `auth-context` Next'in `useRouter`'ını kullanıyor. Statik pakette Next
 * yoktur; bu modül Vite tarafında `next/navigation` yerine takılır
 * (`vite.config.terminal.ts` → `resolve.alias`).
 *
 * Kazanç, ekranların TEK KOPYA kalmasıdır: web sürümü Next router'ıyla,
 * masaüstü sürümü buradaki hash router'la aynı bileşenleri çalıştırır.
 * Ekranlarda `if (masaüstü)` türü dallanma yoktur.
 *
 * Kapsam bilinçli olarak dardır — yalnızca gerçekten kullanılan API'ler.
 * Eksik bir şey eklenecekse burada, tek yerde eklenir.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type RouterLike = {
  push: (href: string) => void;
  replace: (href: string) => void;
  back: () => void;
  refresh: () => void;
  prefetch: (href: string) => void;
};

type NavState = {
  pathname: string;
  router: RouterLike;
  searchParams: URLSearchParams;
};

const NavContext = createContext<NavState | null>(null);

/** Adres çubuğu olmayan bir pencerede yol, hash üzerinden taşınır. */
function readPath(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return raw || '/terminal';
}

function splitPath(full: string): { pathname: string; search: string } {
  const index = full.indexOf('?');
  if (index === -1) return { pathname: full, search: '' };
  return { pathname: full.slice(0, index), search: full.slice(index + 1) };
}

/**
 * Terminal paketinin router sağlayıcısı.
 *
 * `history.pushState` yerine hash kullanılır: paket `app://` özel protokolü
 * üzerinden tek bir `index.html` olarak servis edilir ve gerçek yol
 * değişiklikleri 404'e düşerdi.
 */
export function TerminalRouterProvider({ children }: { children: React.ReactNode }) {
  const [full, setFull] = useState<string>(() =>
    typeof window === 'undefined' ? '/terminal' : readPath(),
  );

  useEffect(() => {
    const onHashChange = () => setFull(readPath());
    window.addEventListener('hashchange', onHashChange);
    // İlk açılışta hash boşsa terminale sabitle; boş hash ile geri tuşu
    // uygulamayı tanımsız bir duruma düşürürdü.
    if (!window.location.hash) window.location.hash = '/terminal';
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((href: string, replace: boolean) => {
    const target = `#${href}`;
    if (replace) window.location.replace(target);
    else window.location.hash = href;
  }, []);

  const value = useMemo<NavState>(() => {
    const { pathname, search } = splitPath(full);
    return {
      pathname,
      searchParams: new URLSearchParams(search),
      router: {
        push: href => navigate(href, false),
        replace: href => navigate(href, true),
        back: () => window.history.back(),
        // Statik pakette sunucudan yeniden veri çekilecek bir şey yok;
        // veri tazeleme TanStack Query'nin işi.
        refresh: () => {},
        prefetch: () => {},
      },
    };
  }, [full, navigate]);

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error('next/navigation shim: TerminalRouterProvider ile sarmalanmalı.');
  }
  return ctx;
}

export function useRouter(): RouterLike {
  return useNav().router;
}

export function usePathname(): string {
  return useNav().pathname;
}

export function useSearchParams(): URLSearchParams {
  return useNav().searchParams;
}

/** `useParams` — terminal rotalarında dinamik segment yok, boş döner. */
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return {} as T;
}

/**
 * `redirect` — Next'te bu fonksiyon render'ı durdurmak için fırlatır.
 * Burada gezinip fırlatmadan döneriz; terminal akışlarında render sırasında
 * yönlendirme yapan bir kod yok.
 */
export function redirect(href: string): void {
  if (typeof window !== 'undefined') window.location.hash = href;
}

export function notFound(): never {
  throw new Error('notFound() terminal paketinde desteklenmiyor.');
}
