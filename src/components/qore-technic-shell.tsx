'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import { LiquidGlassSurface } from '@/components/ui/liquid-glass';
import {
  Home,
  ShieldAlert,
  BarChart3,
  Settings,
  Wrench,
  FlaskConical,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Package,
  ClipboardList,
  Building2,
  UserCircle,
  Gauge,
  X,
  Bell,
  AlertTriangle,
  CheckCircle2,
  Truck,
  ListChecks,
  Trash2,
  Calculator,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useDock } from '@/hooks/use-dock';
import type { NotificationItem } from '@/hooks/use-dock';
import { markAsRead, buildHrefForResource } from '@/lib/notifications';

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
  /** Optional mobile-only popover list for grouped shortcuts. */
  subItems?: { label: string; icon: React.ElementType; href?: string; action?: 'openStatsSheet' }[];
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

function SidebarNotificationsBell({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { notifications, markAllAsRead } = useDock();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const uid = currentUserProfile?.uid || '';

  const unread = useMemo(
    () => notifications.filter((n: NotificationItem) => !(n.readBy || []).includes(uid)),
    [notifications, uid]
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleClick = async (item: NotificationItem) => {
    if (uid) markAsRead(item.id, uid);
    const fallbackHref = buildHrefForResource(item.resource, {
      labId: item.meta?.labId,
      depotId: item.meta?.depotId,
      tab: item.meta?.tab,
    });
    const to = item.href || fallbackHref;
    if (to) router.push(to);
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      {open && (
        <div className="qt-sidebar-notif-panel">
          <div className="qt-sidebar-notif-panel__header">
            <span className="text-sm font-semibold">Bildirimler</span>
            {unread.length > 0 && (
              <button type="button" className="qt-notif-clear-btn" onClick={() => markAllAsRead()}>
                Temizle
              </button>
            )}
          </div>
          <div className="qt-sidebar-notif-panel__list">
            {unread.length === 0 ? (
              <div className="qt-notif-empty" style={{ padding: '24px 16px' }}>
                <Bell className="h-6 w-6 opacity-30" />
                <span style={{ fontSize: 12 }}>Bildirim yok</span>
              </div>
            ) : (
              unread.slice(0, 20).map((item: NotificationItem) => (
                <button key={item.id} type="button" className="qt-notif-item" onClick={() => handleClick(item)}>
                  <span className="qt-notif-item__icon">{notifIconFor(item.type)}</span>
                  <span className="qt-notif-item__body">
                    <span className="qt-notif-item__title">{item.title}</span>
                    {item.message && <span className="qt-notif-item__msg">{item.message}</span>}
                  </span>
                  <span className="qt-notif-item__time">{notifTimeAgo(item.createdAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn('qore-technic-navitem', open && 'qore-technic-navitem--active')}
        title={collapsed ? 'Bildirimler' : undefined}
      >
        <span className="qore-technic-navitem__icon" style={{ position: 'relative' }}>
          <Bell className="h-[18px] w-[18px]" />
          {unread.length > 0 && (
            <span className="qt-sidebar-notif-dot" />
          )}
        </span>
        <span className="qore-technic-navitem__label">Bildirimler</span>
      </button>
    </div>
  );
}

export default function QoreTechnicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  // Arıza detayı (/ariza-yonetimi/[id]) KENDİ tam-sayfa shell'ine (fault-clay-page +
  // fault-topbar) sahip. Shell'in mobil üst başlığı çift "QORE technic" yaratıyordu →
  // bu rotada shell başlığını gizle (alt nav korunur). İstatistik/diğer-firma hariç.
  const isFaultDetailPage =
    pathname.startsWith('/ariza-yonetimi/') &&
    !pathname.startsWith('/ariza-yonetimi/istatistikler') &&
    !pathname.startsWith('/ariza-yonetimi/diger-firma-gecmisi');
  const router = useRouter();
  const { currentUserProfile, logout } = useAuth();
  const role = currentUserProfile?.role;
  const isAplikasyon = role === 'aplikasyon';

  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

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
  const actionFormsHref = isAplikasyon ? '/aplikasyon-paneli/tum-formlar' : '/teknik-servis/tum-formlar';

  const navItems: NavItem[] = [
    { key: 'home', label: 'Ana Panel', icon: Home, href: '/cihaz-yonetimi-ana',
      match: (p) => p === '/cihaz-yonetimi-ana' },
    primaryPanel,
    { key: 'arizalar', label: 'Tüm Arızalar', icon: ShieldAlert, href: '/ariza-yonetimi',
      match: (p) => p.startsWith('/ariza-yonetimi') && !p.startsWith('/ariza-yonetimi/istatistikler') },
    { key: 'islem-formu', label: 'İşlem Formları', icon: ClipboardList,
      href: actionFormsHref,
      match: (p) => p.includes('/islem-formu') || p.endsWith('/tum-formlar') || p.includes('/tum-formlar/') },
    { key: 'yedek-parca', label: 'Yedek Parça', icon: Package,
      href: '/direkt-transfer/yedek-parca-transfer',
      match: (p) => p.startsWith('/direkt-transfer/yedek-parca-transfer') },
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

  // Mobile bottom nav is grouped for compact access. Items with `subItems`
  // open the popover; statistics details are still shown in the existing
  // selection sheet.
  const mobileNavItems: NavItem[] = [
    navItems[0], // Ana Panel
    {
      ...primaryPanel,
      subItems: [
        { label: 'İşlem Formları', icon: ClipboardList, href: actionFormsHref },
        { label: 'Form Oluşturma', icon: primaryPanel.icon, href: primaryPanel.href },
        { label: 'Yedek Parça', icon: Package, href: '/direkt-transfer/yedek-parca-transfer' },
        { label: 'Kümülatif Hesaplama', icon: Calculator, href: `/kumulatif-hesaplama?from=${encodeURIComponent(primaryPanel.href)}` },
      ],
    },
    navItems[2], // Tüm Arızalar
    {
      key: 'gozlem',
      label: 'Gözlem',
      icon: BarChart3,
      href: '/cihaz-tanimlamalari',
      match: (p) =>
        p.startsWith('/cihaz-tanimlamalari') ||
        p.startsWith('/ariza-tanimlamalari') ||
        p.startsWith('/ariza-yonetimi/istatistikler') ||
        p.startsWith('/yedek-parca-analizi') ||
        p.startsWith('/kurum-ziyaret-analizi'),
      subItems: [
        { label: 'Tanımlamalar', icon: Settings, href: '/cihaz-tanimlamalari' },
        { label: 'İstatistikler', icon: BarChart3, action: 'openStatsSheet' },
      ],
    },
  ];

  const isActive = (item: NavItem) => (item.match ? item.match(pathname) : pathname === item.href);

  const handleLogout = async () => {
    try {
      await logout();
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
          <SidebarNotificationsBell collapsed={collapsed} />
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

      {/* Mobile top brand — arıza detayı kendi başlığına (fault-topbar) sahip olduğundan
          çift "QORE technic" başlığı olmaması için bu rotada gizlenir. */}
      {!isFaultDetailPage && (
        <header className="qore-technic-mobile-header md:hidden">
          <QoreTechnicBrand align="center" size="md" />
        </header>
      )}

      {/* Main content area */}
      <main className="qore-technic-main qt-content">
        <div className="qore-technic-main__inner">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="qore-technic-bottom-nav md:hidden" aria-label="QOREtechnic menü">
        {/* Apple Liquid Glass yüzeyi — eski düz cam (CSS background) yerine canlı kırılma */}
        <LiquidGlassSurface radius={18} strength={32} dispersion={0.4} blur={3} bezel={16} zoom={0.18} fallbackBlur={20} shine={false} />

        {/* Backdrop for closing popovers */}
        <div 
          className={cn('qt-popover-overlay', expandedMenu && 'qt-popover-overlay--open')}
          onClick={() => setExpandedMenu(null)}
          aria-hidden="true"
        />

        {/* Popover Container */}
        <div className={cn('qt-mobile-popover', expandedMenu && 'qt-mobile-popover--open')} aria-hidden={!expandedMenu}>
          <LiquidGlassSurface radius={20} strength={22} dispersion={0.3} blur={4} bezel={14} zoom={0.1} fallbackBlur={26} shine={false} />
          {expandedMenu &&
            mobileNavItems.find(g => g.key === expandedMenu)?.subItems?.map((sub, idx) => {
              const SubIcon = sub.icon;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setExpandedMenu(null);
                    if (sub.action === 'openStatsSheet') {
                      setStatsSheetOpen(true);
                      return;
                    }
                    if (sub.href) router.push(sub.href);
                  }}
                  className="qt-popover-item"
                >
                  <span className="qt-popover-item-icon">
                    <SubIcon className="w-5 h-5" />
                  </span>
                  <span>{sub.label}</span>
                </button>
              );
            })
          }
        </div>

        <div className="qore-technic-bottom-nav__scroll" style={{ justifyContent: 'space-around', gap: 0, overflowX: 'visible', paddingInline: '4px' }}>
          {mobileNavItems.map((item) => {
            const active = item.match ? item.match(pathname) : false;
            const Icon = item.icon;
            const onTap = () => {
              if (item.subItems?.length) {
                setExpandedMenu((prev) => (prev === item.key ? null : item.key));
              } else if (item.submenu) {
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
                style={{ minWidth: 0, padding: '6px 2px', fontSize: '9px', position: 'relative', zIndex: 40 }}
              >
                <Icon className="h-4 w-4" />
                <span style={{ lineHeight: 1.1 }}>{item.label}</span>
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
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
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

const notifIconFor = (t: string) => {
  switch (t) {
    case 'fefo_override': return <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />;
    case 'order_created':
    case 'order_created_from_request': return <ClipboardList className="w-4 h-4 shrink-0 text-blue-500" />;
    case 'transfer_to_lab': return <Truck className="w-4 h-4 shrink-0 text-indigo-500" />;
    case 'depot_count_completed':
    case 'lab_count_completed': return <ListChecks className="w-4 h-4 shrink-0 text-green-500" />;
    case 'fault_opened':
    case 'fault_transferred': return <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />;
    case 'fault_closed': return <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />;
    default: return <Package className="w-4 h-4 shrink-0 text-white/70" />;
  }
};

const notifTimeAgo = (ts: any) => {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date());
    const diffMs = Date.now() - d.getTime();
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return 'şimdi';
    if (m < 60) return `${m} dk`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} sa`;
    const day = Math.floor(h / 24);
    return `${day} g`;
  } catch { return ''; }
};

export function QoreTechnicNotificationsButton({
  className,
}: {
  className?: string;
}) {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { notifications, markAllAsRead } = useDock();
  const [open, setOpen] = useState(false);
  const uid = currentUserProfile?.uid || '';

  const unread = useMemo(
    () => notifications.filter((n: NotificationItem) => !(n.readBy || []).includes(uid)),
    [notifications, uid]
  );

  const handleClick = async (item: NotificationItem) => {
    if (uid) markAsRead(item.id, uid);
    const fallbackHref = buildHrefForResource(item.resource, {
      labId: item.meta?.labId,
      depotId: item.meta?.depotId,
      tab: item.meta?.tab,
    });
    const to = item.href || fallbackHref;
    if (to) router.push(to);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={cn('qt-status-btn qt-status-btn--notifications', className)}
        onClick={() => setOpen(true)}
      >
        <Bell className="h-4 w-4" />
        Bildirimler
        {unread.length > 0 && (
          <span className="qt-notif-badge">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="qt-sheet-overlay" onClick={() => setOpen(false)}>
          <div className="qt-sheet qt-sheet--notifications" role="dialog" aria-label="Bildirimler" onClick={(e) => e.stopPropagation()}>
            <div className="qt-sheet__handle" aria-hidden="true" />
            <div className="qt-sheet__header">
              <h2 className="qt-sheet__title">
                Bildirimler
                {unread.length > 0 && (
                  <span className="qt-notif-header-badge">{unread.length}</span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {unread.length > 0 && (
                  <button
                    type="button"
                    className="qt-notif-clear-btn"
                    onClick={() => markAllAsRead()}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Temizle
                  </button>
                )}
                <button
                  type="button"
                  className="qt-sheet__close"
                  aria-label="Kapat"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="qt-notif-list">
              {unread.length === 0 ? (
                <div className="qt-notif-empty">
                  <Bell className="h-8 w-8 opacity-30" />
                  <span>Bildirim yok</span>
                </div>
              ) : (
                unread.map((item: NotificationItem) => (
                  <button
                    key={item.id}
                    type="button"
                    className="qt-notif-item"
                    onClick={() => handleClick(item)}
                  >
                    <span className="qt-notif-item__icon">
                      {notifIconFor(item.type)}
                    </span>
                    <span className="qt-notif-item__body">
                      <span className="qt-notif-item__title">{item.title}</span>
                      {item.message && (
                        <span className="qt-notif-item__msg">{item.message}</span>
                      )}
                    </span>
                    <span className="qt-notif-item__time">
                      {notifTimeAgo(item.createdAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
