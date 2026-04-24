'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FilePlus,
  LogOut,
  Moon,
  Send,
  Sun,
  UserCircle,
} from 'lucide-react';

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  href: string;
  match?: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    key: 'bekleyen',
    label: 'Bekleyen Siparişler',
    icon: ClipboardList,
    href: '/siparisler',
    match: (p) => p === '/siparisler' || p.startsWith('/siparisler/') && !p.startsWith('/siparisler/olustur') && !p.startsWith('/siparisler/toplu'),
  },
  {
    key: 'olustur',
    label: 'Sipariş Oluştur',
    icon: FilePlus,
    href: '/merkez-siparis',
    match: (p) => p.startsWith('/merkez-siparis') || p.startsWith('/siparisler/olustur'),
  },
  {
    key: 'toplu',
    label: 'Toplu Yönlendirme',
    icon: Send,
    href: '/route-planlayici',
    match: (p) => p.startsWith('/route-planlayici') || p.startsWith('/siparisler/toplu'),
  },
];

export default function LojistikTerminalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const { currentUserProfile, logout } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('lt:sidebar:collapsed') === '1';
    } catch {
      return false;
    }
  });

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!profileMenuRef.current) return;
      if (!profileMenuRef.current.contains(e.target as Node)) setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileMenuOpen]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.add('lt-active');
    body.classList.add('lt-active');
    return () => {
      root.classList.remove('lt-active');
      body.classList.remove('lt-active');
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('lt:sidebar:collapsed', collapsed ? '1' : '0');
    } catch {
      /* noop */
    }
    document.documentElement.style.setProperty(
      '--lt-sidebar-current-w',
      collapsed ? 'var(--lt-sidebar-w-compact)' : 'var(--lt-sidebar-w)'
    );
  }, [collapsed]);

  const isActive = (item: NavItem) =>
    item.match ? item.match(pathname) : pathname === item.href;

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  const isDark = (resolvedTheme ?? theme) === 'dark';
  const initials = (currentUserProfile?.name || currentUserProfile?.email || 'LY')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={cn('lt-shell', collapsed && 'lt-shell--collapsed')}>
      <div className="lt-bg" aria-hidden="true" />

      {/* Desktop / Tablet sidebar */}
      <aside className="lt-sidebar hidden md:flex">
        <div className="lt-sidebar__brand">
          <div className="lt-brand">
            <div className="lt-brand__mark">
              <Image
                src="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG"
                alt="Qore"
                width={28}
                height={28}
              />
            </div>
            {!collapsed && (
              <div className="lt-brand__text">
                <span className="lt-brand__title">Qore</span>
                <span className="lt-brand__subtitle">Lojistik Terminal</span>
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
            title={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
            className="lt-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {!collapsed && (
          <div className="lt-sidebar__section-label">MENÜ</div>
        )}

        <nav className="lt-sidebar__nav" aria-label="Lojistik terminal navigasyon">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => router.push(item.href)}
                className={cn('lt-navitem', active && 'lt-navitem--active')}
                title={collapsed ? item.label : undefined}
              >
                <span className="lt-navitem__icon">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="lt-navitem__label">{item.label}</span>
                {active && <span className="lt-navitem__indicator" aria-hidden="true" />}
              </button>
            );
          })}
        </nav>

        <div className="lt-sidebar__footer" ref={profileMenuRef}>
          <button
            type="button"
            className="lt-theme-toggle"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title={isDark ? 'Açık mod' : 'Koyu mod'}
            aria-label="Tema değiştir"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {!collapsed && <span>{isDark ? 'Açık mod' : 'Koyu mod'}</span>}
          </button>

          {profileMenuOpen && (
            <div className="lt-profile-popover" role="menu" aria-label="Profil menüsü">
              <button
                type="button"
                className="lt-profile-popover__item lt-profile-popover__item--danger"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  handleLogout();
                }}
              >
                <LogOut className="h-4 w-4" />
                <span>Çıkış Yap</span>
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setProfileMenuOpen((o) => !o)}
            className={cn('lt-profile', profileMenuOpen && 'lt-profile--open')}
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
          >
            <span className="lt-profile__avatar">{initials}</span>
            {!collapsed && (
              <span className="lt-profile__meta">
                <span className="lt-profile__name">
                  {currentUserProfile?.name || 'Lojistik Yöneticisi'}
                </span>
                <span className="lt-profile__role">Yönetici</span>
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lt-mobile-header md:hidden">
        <div className="lt-brand">
          <div className="lt-brand__mark">
            <Image
              src="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG"
              alt="Qore"
              width={24}
              height={24}
            />
          </div>
          <div className="lt-brand__text">
            <span className="lt-brand__title">Qore</span>
            <span className="lt-brand__subtitle">Lojistik Terminal</span>
          </div>
        </div>
        <button
          type="button"
          className="lt-theme-toggle lt-theme-toggle--compact"
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label="Tema değiştir"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      {/* Main content area */}
      <main className="lt-main">
        <div className="lt-main__inner">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="lt-bottom-nav md:hidden" aria-label="Lojistik terminal menü">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => router.push(item.href)}
              className={cn('lt-bottom-item', active && 'lt-bottom-item--active')}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={handleLogout}
          className="lt-bottom-item lt-bottom-item--danger"
          aria-label="Çıkış Yap"
        >
          <LogOut className="h-4 w-4" />
          <span>Çıkış</span>
        </button>
      </nav>
    </div>
  );
}
