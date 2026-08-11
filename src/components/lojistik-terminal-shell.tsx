'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { VIEWS } from '@/lib/constants';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CheckCircle2,
  House,
  History as HistoryIcon,
  FilePlus,
  ListChecks,
  LogOut,
  Moon,
  Send,
  Sun,
  Truck,
} from 'lucide-react';
import {
  LOJISTIK_COUNTS_PATH,
  LOJISTIK_HOME_PATH,
  LOJISTIK_SEVKIYAT_PATH,
} from '@/lib/lojistik/navigation';

function QorelogisticsBrand({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return <span className="lt-brand__mark-only" aria-label="Qorelogistics">Q</span>;
  }
  return (
    <div className="lt-brand" aria-label="Qorelogistics">
      <span className="lt-brand__qore">QORE</span>
      <span className="lt-brand__logistics">logistics</span>
    </div>
  );
}

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  href: string;
  match?: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    key: 'ana-sayfa',
    label: 'Ana Sayfa',
    icon: House,
    href: LOJISTIK_HOME_PATH,
    match: (p) => p === LOJISTIK_HOME_PATH,
  },
  {
    key: 'sayimlar',
    label: 'Sayımlar',
    icon: ListChecks,
    href: LOJISTIK_COUNTS_PATH,
    match: (p) => p.startsWith(LOJISTIK_COUNTS_PATH),
  },
  {
    key: 'sevkiyatlar',
    label: 'Sevkiyatlar',
    icon: Truck,
    href: LOJISTIK_SEVKIYAT_PATH,
    match: (p) => p.startsWith(LOJISTIK_SEVKIYAT_PATH),
  },
  {
    key: 'bekleyen',
    label: 'Bekleyen Siparişler',
    icon: ClipboardList,
    href: '/siparisler',
    match: (p) =>
      (p === '/siparisler' ||
        (p.startsWith('/siparisler/') &&
          !p.startsWith('/siparisler/olustur') &&
          !p.startsWith('/siparisler/toplu') &&
          !p.startsWith('/siparisler/tamamlanan'))),
  },
  {
    key: 'olustur',
    label: 'Sipariş Oluştur',
    icon: FilePlus,
    href: '/siparisler/olustur',
    match: (p) => p.startsWith('/siparisler/olustur'),
  },
  {
    key: 'toplu',
    label: 'Toplu Yönlendirme',
    icon: Send,
    href: '/route-planlayici',
    match: (p) => p.startsWith('/route-planlayici') || p.startsWith('/siparisler/toplu'),
  },
  {
    key: 'tamamlanan',
    label: 'Tamamlanan',
    icon: CheckCircle2,
    href: '/siparisler/tamamlanan',
    match: (p) => p.startsWith('/siparisler/tamamlanan'),
  },
  {
    key: 'gecmis',
    label: 'Geçmiş Siparişler',
    icon: HistoryIcon,
    href: '/siparis-gecmis',
    match: (p) => p.startsWith('/siparis-gecmis'),
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
      collapsed ? '0px' : 'var(--lt-sidebar-w)'
    );
  }, [collapsed]);

  const isActive = (item: NavItem) =>
    item.match ? item.match(pathname) : pathname === item.href;

  const extraNavItems: NavItem[] = React.useMemo(() => {
    const excluded = new Set<string>([
      'dashboard',
      'siparisler',
      'route-planlayici',
      'planner',
    ]);
    const allowed = new Set<string>(currentUserProfile?.accessibleViews || []);
    return VIEWS
      .filter((v) => v.type === 'nav' && !!v.href && allowed.has(v.key) && !excluded.has(v.key))
      .map((v) => ({
        key: `extra-${v.key}`,
        label: v.label,
        icon: v.icon,
        href: v.href!,
        match: (p: string) => p === v.href || p.startsWith(`${v.href}/`),
      }));
  }, [currentUserProfile?.accessibleViews]);

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
      {!collapsed && <aside className="lt-sidebar hidden md:flex">
        <div className="lt-sidebar__brand">
          <QorelogisticsBrand collapsed={false} />
          <button
            type="button"
            aria-label="Kenar çubuğunu kapat"
            title="Kenar çubuğunu kapat"
            className="lt-collapse-btn"
            onClick={() => setCollapsed(true)}
          >
            <ChevronLeft className="h-4 w-4" />
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
          {extraNavItems.length > 0 && !collapsed && (
            <div className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--lt-text-dim)]">
              Diğer Paneller
            </div>
          )}
          {extraNavItems.map((item) => {
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
      </aside>}

      {collapsed && (
        <button
          type="button"
          className="lt-sidebar-reveal hidden md:flex"
          onClick={() => setCollapsed(false)}
          aria-label="QORE Logistics kenar çubuğunu aç"
          title="Menüyü aç"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      {/* Mobile top bar */}
      <header className="lt-mobile-header md:hidden">
        <QorelogisticsBrand />
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
        {extraNavItems.map((item) => {
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
