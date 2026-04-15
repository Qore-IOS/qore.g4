'use client';

import React, { useEffect, useRef, useState } from 'react';
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
  Package,
  Building2,
  UserCircle,
  Gauge,
  X,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  href: string;
  match?: (pathname: string) => boolean;
  /** When set, tapping the item on mobile opens a selection sheet
   *  with these sub-choices instead of navigating directly. On desktop
   *  the sub-items are rendered as separate nav buttons. */
  submenu?: { key: string; label: string; icon: React.ElementType; href: string }[];
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

  // Mobile "İstatistikler" selection sheet
  const [statsSheetOpen, setStatsSheetOpen] = useState(false);
  // Profil popover (desktop) / sheet (mobile)
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
      match: (p) =>
        p.startsWith('/ariza-yonetimi/istatistikler') ||
        p.startsWith('/yedek-parca-analizi') ||
        p.startsWith('/kurum-ziyaret-analizi'),
      submenu: [
        { key: 'arizaIst', label: 'Arıza İstatistikleri', icon: BarChart3, href: '/ariza-yonetimi/istatistikler' },
        { key: 'parcaAnaliz', label: 'Yedek Parça Analizi', icon: Package, href: '/yedek-parca-analizi' },
        { key: 'ziyaretAnaliz', label: 'Kurum Ziyaret Analizi', icon: Building2, href: '/kurum-ziyaret-analizi' },
      ],
    },
    { key: 'tanim', label: 'Tanımlamalar', icon: Settings, href: '/cihaz-tanimlamalari',
      match: (p) => p.startsWith('/cihaz-tanimlamalari') || p.startsWith('/ariza-tanimlamalari') },
  ];

  // Desktop sidebar shows each submenu child as its own nav button, so the
  // sidebar exposes all stats panels directly. Mobile keeps the single
  // "İstatistikler" entry and opens a selection sheet on tap.
  const desktopNavItems: NavItem[] = navItems.flatMap((item) => {
    if (!item.submenu) return [item];
    return item.submenu.map((sub) => ({
      key: sub.key,
      label: sub.label,
      icon: sub.icon,
      href: sub.href,
      match: (p: string) => p.startsWith(sub.href),
    }));
  });

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
          {desktopNavItems.map((item) => {
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

        <div className="qore-technic-sidebar__footer" ref={profileMenuRef}>
          {profileMenuOpen && (
            <div className="qt-profile-popover" role="menu" aria-label="Profil menüsü">
              <button
                type="button"
                className="qt-profile-popover__item"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  router.push('/personel-izlem?mine=1');
                }}
              >
                <Gauge className="h-4 w-4" />
                <span>Performansım</span>
              </button>
              <button
                type="button"
                className="qt-profile-popover__item qt-profile-popover__item--danger"
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
            className={cn(
              'qore-technic-navitem qore-technic-navitem--profile',
              profileMenuOpen && 'qore-technic-navitem--active',
            )}
            title={collapsed ? 'Profil' : undefined}
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
          >
            <span className="qore-technic-navitem__icon">
              <UserCircle className="h-[18px] w-[18px]" />
            </span>
            <span className="qore-technic-navitem__label">Profil</span>
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
            const onTap = () => {
              if (item.submenu) {
                setStatsSheetOpen(true);
              } else {
                router.push(item.href);
              }
            };
            return (
              <button
                key={item.key}
                type="button"
                onClick={onTap}
                className={cn('qore-technic-bottom-item', active && 'qore-technic-bottom-item--active')}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile İstatistikler selection sheet */}
      {statsSheetOpen && (
        <div className="qt-sheet-overlay md:hidden" onClick={() => setStatsSheetOpen(false)}>
          <div
            className="qt-sheet"
            role="dialog"
            aria-label="İstatistik paneli seç"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="qt-sheet__handle" aria-hidden="true" />
            <div className="qt-sheet__header">
              <h2 className="qt-sheet__title">İstatistikler</h2>
              <button
                type="button"
                className="qt-sheet__close"
                aria-label="Kapat"
                onClick={() => setStatsSheetOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="qt-sheet__list">
              {navItems.find((i) => i.key === 'istatistik')?.submenu?.map((sub) => {
                const SubIcon = sub.icon;
                return (
                  <button
                    key={sub.key}
                    type="button"
                    className="qt-sheet__item"
                    onClick={() => {
                      setStatsSheetOpen(false);
                      router.push(sub.href);
                    }}
                  >
                    <span className="qt-sheet__item-icon">
                      <SubIcon className="h-5 w-5" />
                    </span>
                    <span className="qt-sheet__item-label">{sub.label}</span>
                    <ChevronRight className="h-4 w-4 opacity-60" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Profil button for the QOREtechnic hub — used in the ana-panel status row
 * on mobile (replaces the Qore AI button for teknik_servis / aplikasyon
 * personnel). Opens a sheet with "Performansım" and "Çıkış Yap" options.
 */
export function QoreTechnicProfileButton({
  className,
}: {
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/login');
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  return (
    <>
      <button
        type="button"
        className={cn('qt-status-btn qt-status-btn--profile', className)}
        onClick={() => setOpen(true)}
      >
        <UserCircle className="h-4 w-4" />
        Profil
      </button>
      {open && (
        <div className="qt-sheet-overlay" onClick={() => setOpen(false)}>
          <div className="qt-sheet" role="dialog" aria-label="Profil" onClick={(e) => e.stopPropagation()}>
            <div className="qt-sheet__handle" aria-hidden="true" />
            <div className="qt-sheet__header">
              <h2 className="qt-sheet__title">Profil</h2>
              <button
                type="button"
                className="qt-sheet__close"
                aria-label="Kapat"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="qt-sheet__list">
              <button
                type="button"
                className="qt-sheet__item"
                onClick={() => {
                  setOpen(false);
                  router.push('/personel-izlem?mine=1');
                }}
              >
                <span className="qt-sheet__item-icon">
                  <Gauge className="h-5 w-5" />
                </span>
                <span className="qt-sheet__item-label">Performansım</span>
                <ChevronRight className="h-4 w-4 opacity-60" />
              </button>
              <button
                type="button"
                className="qt-sheet__item qt-sheet__item--danger"
                onClick={() => {
                  setOpen(false);
                  handleLogout();
                }}
              >
                <span className="qt-sheet__item-icon">
                  <LogOut className="h-5 w-5" />
                </span>
                <span className="qt-sheet__item-label">Çıkış Yap</span>
                <ChevronRight className="h-4 w-4 opacity-60" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
