/**
 * @fileoverview Terminalin açık/koyu tema tercihi.
 *
 * Web uygulamasının `next-themes` sağlayıcısı BURADA kullanılmaz: terminal
 * paketi o sağlayıcıyı kurmuyor (masaüstünde tema Firestore'daki kullanıcı
 * profiline değil, MAKİNEYE ait bir tercihtir — aynı hesapla giren iki
 * terminalden biri güneş alan bir rampada, diğeri loş bir depoda durabilir).
 *
 * Bu yüzden tercih cihazda saklanır ve doğrudan kök `<html>` üzerindeki
 * `dark` sınıfına yazılır; `globals.css` içindeki tema değişkenleri geri
 * kalanı hâlleder.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'qore.terminal.theme';

export type TerminalTheme = 'light' | 'dark';

function applyTheme(theme: TerminalTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  // Tarayıcının kendi arayüz parçalarını (kaydırma çubuğu, form denetimleri)
  // da temayla uyumlu çizmesi için.
  root.style.colorScheme = theme;
}

export function useTerminalTheme(): [TerminalTheme, (next: TerminalTheme) => void] {
  // Varsayılan koyu: terminal ekranları çoğunlukla depo zemininde, düşük
  // aydınlatmada kullanılıyor.
  const [theme, setTheme] = useState<TerminalTheme>('dark');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* gizli mod — oturum boyunca varsayılan geçerli */
    }
    const initial: TerminalTheme = stored === 'light' ? 'light' : 'dark';
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const select = useCallback((next: TerminalTheme) => {
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* yazılamazsa tercih yalnızca bu oturumda geçerli */
    }
  }, []);

  return [theme, select];
}
