'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import {
  Home,
  ShieldAlert,
  CalendarClock,
  Map as MapIcon,
  BarChart3,
  Settings,
  Wrench,
  FlaskConical,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  href: string;
  match?: (pathname: string) => boolean;
}

function QoreTechnicBrand({
  align = 'left',
  size = 'md',
  iconOnly = false,
}: {
  align?: 'left' | 'center';
  size?: 'sm' | 'md' | 'lg';
  iconOnly?: boolean;
}) {
  const sizeCls =
    size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-xl' : 'text-2xl';

  if (iconOnly) {
    return (
      <div className="qore-technic-brand-mark">
        <span>Q</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'qore-technic-brand flex items-baseline select-none',
        align === 'center' ? 'justify-center' : 'justify-start'
      )}
    >
      <span className={cn('qore-technic-brand__qore font-extrabold tracking-tight', sizeCls)}>
        QORE
      </span>
      <span className={cn('qore-technic-brand__technic', sizeCls)}>technic</span>
    </div>
  );
}

export function QoreTechnicBrandMark(props: React.ComponentProps<typeof QoreTechnicBrand>) {
  return <QoreTechnicBrand {...props} />;
}

export default function QoreTechnicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const role = currentUserProfile?.role;
  const isAplikasyon = role === 'aplikasyon';

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem('qt:sidebar:collapsed') === '1'; } catch { return false; }
  });

  // Persist body/html background override so scrolling never reveals
  // the default app background behind the hub.
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.add('qt-active');
    body.classList.add('qt-active');
    return () => {
      root.classList.remove('qt-active');
      body.classList.remove('qt-active');
    };
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem('qt:sidebar:collapsed', collapsed ? '1' : '0'); } catch { /* noop */ }
    document.documentElement.style.setProperty(
      '--qt-sidebar-current-w',
      collapsed ? 'var(--qt-sidebar-w-compact)' : 'var(--qt-sidebar-w)'
    );
  }, [collapsed]);

  const primaryPanel: NavItem = isAplikasyon
    ? {
        key: 'aplikasyon', label: 'Aplikasyon', icon: FlaskConical,
        href: '/aplikasyon-paneli',
        match: (p) => p.startsWith('/aplikasyon-paneli'),
      }
    : {
        key: 'teknik', label: 'Teknik Servis', icon: Wrench,
        href: '/teknik-servis',
        match: (p) => p.startsWith('/teknik-servis'),
      };

  const navItems: NavItem[] = [
    { key: 'home', label: 'Ana Panel', icon: Home, href: '/cihaz-yonetimi-ana',
      match: (p) => p === '/cihaz-yonetimi-ana' },
    primaryPanel,
    { key: 'arizalar', label: 'Tüm Arızalar', icon: ShieldAlert, href: '/ariza-yonetimi',
      match: (p) => p.startsWith('/ariza-yonetimi') && !p.startsWith('/ariza-yonetimi/istatistikler') },
    { key: 'nobet', label: 'Nöbet', icon: CalendarClock, href: '/nobet-yonetimi',
      match: (p) => p.startsWith('/nobet-yonetimi') },
    { key: 'harita', label: 'Harita', icon: MapIcon,
      href: isAplikasyon ? '/aplikasyon-harita' : '/teknik-harita',
      match: (p) => p.startsWith('/teknik-harita') || p.startsWith('/aplikasyon-harita') },
    { key: 'istatistik', label: 'İstatistikler', icon: BarChart3, href: '/ariza-yonetimi/istatistikler',
      match: (p) => p.startsWith('/ariza-yonetimi/istatistikler') },
    { key: 'tanim', label: 'Tanımlamalar', icon: Settings, href: '/cihaz-tanimlamalari',
      match: (p) => p.startsWith('/cihaz-tanimlamalari') || p.startsWith('/ariza-tanimlamalari') },
  ];

  const isActive = (item: NavItem) => (item.match ? item.match(pathname) : pathname === item.href);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/login');
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  return (
    <div className={cn('qore-technic-shell', collapsed && 'qore-technic-shell--collapsed')}>
      <div className="qore-technic-bg" aria-hidden="true" />

      {/* Desktop / Tablet sidebar */}
      <aside className="qore-technic-sidebar hidden md:flex">
        <div className="qore-technic-sidebar__brand">
          <div className="qore-technic-sidebar__brand-inner">
            {collapsed ? <QoreTechnicBrand iconOnly /> : <QoreTechnicBrand size="md" />}
          </div>
          <button
            type="button"
            aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
            title={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
            className="qore-technic-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="qore-technic-sidebar__nav" aria-label="QOREtechnic navigasyon">
          {navItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => router.push(item.href)}
                className={cn('qore-technic-navitem', active && 'qore-technic-navitem--active')}
                title={collapsed ? item.label : undefined}
              >
                <span className="qore-technic-navitem__icon">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="qore-technic-navitem__label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="qore-technic-sidebar__footer">
          <button
            type="button"
            onClick={handleLogout}
            className="qore-technic-navitem qore-technic-navitem--logout"
            title={collapsed ? 'Çıkış Yap' : undefined}
          >
            <span className="qore-technic-navitem__icon">
              <LogOut className="h-[18px] w-[18px]" />
            </span>
            <span className="qore-technic-navitem__label">Çıkış Yap</span>
          </button>
        </div>
      </aside>

      {/* Mobile top brand */}
      <header className="qore-technic-mobile-header md:hidden">
        <QoreTechnicBrand align="center" size="md" />
      </header>

      {/* Main content area */}
      <main className="qore-technic-main qt-content">
        <div className="qore-technic-main__inner">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="qore-technic-bottom-nav md:hidden" aria-label="QOREtechnic menü">
        <div className="qore-technic-bottom-nav__scroll">
          {navItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => router.push(item.href)}
                className={cn('qore-technic-bottom-item', active && 'qore-technic-bottom-item--active')}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
