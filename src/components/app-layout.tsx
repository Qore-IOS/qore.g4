
"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "next-themes";
import { Dock } from "@/components/dock";
import TaskPlannerPanel from "./TaskPlannerPanel";
import AutoRedirectOnLogin from "./AutoRedirectOnLogin";
import OnlyUsageAutoRedirect from "./OnlyUsageAutoRedirect";
import { useDock } from "@/hooks/use-dock";
import PresenceManager from "./PresenceManager";
import PersistentNotificationToast from "./notifications/PersistentNotificationToast";
import PageShell from "./responsive/PageShell";

import NotificationsBell from "@/components/notifications/NotificationsBell";
import { ThemeToggleDock } from "./ui/theme-toggle-dock";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarFooter,
  SidebarTrigger,
} from "./ui/sidebar";
import Image from "next/image";
import { useIconMappings, getIconSrc } from "@/hooks/useIconMappings";
import { useProductCodes, useBarcodeFormatsQuery, useDepots, useAddressDefinitions, useUsers, useHospitals } from "@/hooks/useFirebaseQueries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sun, Moon, Laptop, Eye, EyeOff, Star, Columns, Calendar } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AnimatePresence } from "framer-motion";
import { CalendarDockPanel } from "./dock/CalendarDockPanel";
import { PushNotificationsErrorBoundary } from "./PushNotificationsErrorBoundary";
import dynamic from 'next/dynamic';

const MobileDock = dynamic(() => import('./MobileDock'), { ssr: false });
const PushNotificationsClient = dynamic(
  () => import("./PushNotificationsClient"),
  { ssr: false }
);
const QoreTechnicShell = dynamic(() => import('./qore-technic-shell'), { ssr: false });
const LojistikTerminalShell = dynamic(() => import('./lojistik-terminal-shell'), { ssr: false });


export default function AppLayout({ children }: { children: React.ReactNode }) {
  const {
    currentUser,
    currentUserProfile,
    isLoadingAuth,
    navMode,
    isOrbAnimationEnabled,
    toggleOrbAnimation,
    toggleNavMode,
  } = useAuth();

  // Prefetch static master-data in the background to speed up panel loading (cached for 30m-1h)
  useProductCodes();
  useBarcodeFormatsQuery();
  useDepots();
  useAddressDefinitions();
  useUsers();
  useHospitals(); // Siparisler paneli ve LojistikSiparisView için

  const pathname = usePathname();
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    setCalendarOpen(false);
  }, [pathname]);

  // Check if user is a teknisyen - hide dock for them
  const isTeknisyen = currentUserProfile?.role === 'teknisyen';
  // QOREtechnic hub users: teknik_servis and aplikasyon get the new hub shell and no global dock
  const isQoreTechnicRole =
    currentUserProfile?.role === 'teknik_servis' ||
    currentUserProfile?.role === 'aplikasyon';
  // Sarf dağıtım personeli: tek ekran (QR ile teslim al / teslim et) — dock yok.
  const isSarfDagitimPersonel = currentUserProfile?.role === 'sarf_dagitim_personeli';
  // Lojistik terminal: lojistik_sorumlusu gets a dedicated work terminal
  // shell (its own collapsible sidebar, no global dock).
  const isLojistikTerminalRole = currentUserProfile?.role === 'lojistik_sorumlusu';
  const isLojistikTerminalPath =
    !!pathname &&
    (
      pathname === '/siparisler' ||
      pathname.startsWith('/siparisler/') ||
      pathname.startsWith('/merkez-siparis') ||
      pathname.startsWith('/route-planlayici') ||
      pathname.startsWith('/siparis-gecmis')
    );
  const { setTheme } = useTheme();
  const router = useRouter();

  const isWideContentRoute = pathname?.startsWith("/total-verimlilik");
  const isEdgeToEdgeRoute =
    pathname?.startsWith("/maliyet-gozlem") ||
    pathname?.startsWith("/cihaz-test-dagilimi") ||
    pathname?.startsWith("/cari-odeme") ||
    pathname?.startsWith("/sarf-dagitim") ||
    pathname?.startsWith("/sarf-teslimat") ||
    // Yönetim ve alt panelleri (envanter yönetimi hariç) yeni tasarım dilinde
    (pathname?.startsWith("/yonetim") && !pathname?.startsWith("/yonetim/envanter-yonetimi")) ||
    pathname === "/dashboard" ||
    pathname?.startsWith("/dashboard/");

  const {
    dockItems,
    isPlannerPanelOpen,
    setIsPlannerPanelOpen,
    currentViewKey,
    isMobile,
    isVisible,
    handleMouseEnter,
    handleMouseLeave,
  } = useDock();

  const iconData = useIconMappings();
  const dockIcons = iconData?.mappings?.dock || {};



  useEffect(() => {
    if (!isLoadingAuth && !currentUser) {
      router.replace("/login");
    }
  }, [currentUser, isLoadingAuth, router]);

  useEffect(() => {
    if (pathname && pathname !== "/") {
      localStorage.setItem("last_path", pathname);
    }
  }, [pathname]);

  if (isLoadingAuth || !currentUser) {
    return null;
  }



  // Sarf dağıtım personeli — tek ekranlık teslimat arayüzü.
  // Dock / sidebar yok; sayfa kendi başlığını ve çıkışını barındırır.
  if (isSarfDagitimPersonel) {
    return (
      <>
        <PushNotificationsErrorBoundary>
          <PushNotificationsClient />
        </PushNotificationsErrorBoundary>
        <PresenceManager />
        <AutoRedirectOnLogin />
        <PersistentNotificationToast />
        {children}
      </>
    );
  }

  // Lojistik terminal — dedicated shell for lojistik_sorumlusu role.
  // No global dock / sidebar / mobile dock. The shell provides its own navigation.
  if (isLojistikTerminalRole && isLojistikTerminalPath) {
    return (
      <>
        <PushNotificationsErrorBoundary>
          <PushNotificationsClient />
        </PushNotificationsErrorBoundary>
        <PresenceManager />
        <AutoRedirectOnLogin />
        <OnlyUsageAutoRedirect />
        <PersistentNotificationToast />
        <LojistikTerminalShell>{children}</LojistikTerminalShell>
        <TaskPlannerPanel
          open={isPlannerPanelOpen}
          onClose={() => setIsPlannerPanelOpen(false)}
        />
      </>
    );
  }

  // QOREtechnic hub — dedicated shell for teknik_servis and aplikasyon roles.
  // No global dock / sidebar / mobile dock. The shell provides its own navigation.
  if (isQoreTechnicRole) {
    return (
      <>
        <PushNotificationsErrorBoundary>
          <PushNotificationsClient />
        </PushNotificationsErrorBoundary>
        <PresenceManager />
        <AutoRedirectOnLogin />
        <OnlyUsageAutoRedirect />
        <PersistentNotificationToast />
        <QoreTechnicShell>{children}</QoreTechnicShell>
        <TaskPlannerPanel
          open={isPlannerPanelOpen}
          onClose={() => setIsPlannerPanelOpen(false)}
        />
      </>
    );
  }

  if (navMode === "sidebar" && !isTeknisyen) {
    const notificationItem = dockItems.find(
      (item) => item.key === "notifications"
    );
    const logoutItem = dockItems.find((item) => item.key === "logout");

    return (
      <SidebarProvider>
        <PushNotificationsErrorBoundary>
          <PushNotificationsClient />
        </PushNotificationsErrorBoundary>
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center gap-2 p-2">
              <Image
                src="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG"
                alt="Logo"
                width={32}
                height={32}
              />
              <span className="font-bold text-lg group-data-[collapsible=icon]:hidden">
                QORE
              </span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              {dockItems
                .filter((item) => item.type === "nav")
                .map((item) => (
                  <SidebarMenuSub
                    key={item.key}
                    item={item}
                    currentViewKey={currentViewKey}
                    pathname={pathname}
                  />
                ))}
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Takvim"
                onClick={() => setCalendarOpen(prev => !prev)}
                className="w-full justify-start h-8 text-sm gap-2"
              >
                {dockIcons['calendar'] ? (
                  <Image
                    src={getIconSrc(dockIcons['calendar'])}
                    alt="Takvim"
                    width={20}
                    height={20}
                    className="w-5 h-5 object-contain"
                  />
                ) : (
                  <Calendar className="w-5 h-5" />
                )}
                <span className="group-data-[collapsible=icon]:hidden">Takvim</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {notificationItem && (
              <SidebarMenuItem>
                <NotificationsBell
                  label={notificationItem.label}
                  items={notificationItem.items || []}
                  unreadCount={notificationItem.unreadCount || 0}
                  loading={notificationItem.loading || false}
                  triggerClassName="w-full justify-start h-8 text-sm gap-2"
                  customIcon={dockIcons['notifications']}
                />
              </SidebarMenuItem>
            )}
             <SidebarMenuItem>
              <div className="flex justify-center w-full">
                <ThemeToggleDock />
              </div>
            </SidebarMenuItem>
            {logoutItem && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={logoutItem.label}
                  onClick={logoutItem.onClick}
                >
                  <logoutItem.icon className="text-destructive" />
                  <span className="group-data-[collapsible=icon]:hidden text-destructive">
                    {logoutItem.label}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarFooter>
        </Sidebar>
        <main className="w-full">
          <div className="p-2 md:p-4">
            <SidebarTrigger variant="ghost" size="icon"/>
          </div>
          {children}
        </main>
        <AnimatePresence>
          {calendarOpen && <CalendarDockPanel key="cal" onClose={() => setCalendarOpen(false)} />}
        </AnimatePresence>
        <TaskPlannerPanel
          open={isPlannerPanelOpen}
          onClose={() => setIsPlannerPanelOpen(false)}
        />
      </SidebarProvider>
    );
  }

  // Default to Dock view
  return (
    <div className="flex min-h-screen flex-col items-center">
      <PresenceManager />
      <PushNotificationsErrorBoundary>
        <PushNotificationsClient />
      </PushNotificationsErrorBoundary>
      <AutoRedirectOnLogin />
      <OnlyUsageAutoRedirect />
      <main className="flex w-full flex-1 flex-col items-center">
        <PersistentNotificationToast />
        <PageShell
          edgeToEdge={isEdgeToEdgeRoute}
          className={`w-full flex-1 ${isWideContentRoute ? "max-w-none md:px-3" : ""} ${pathname?.startsWith("/cari-odeme") ? "bg-transparent" : ""}`}
        >
          {children}
        </PageShell>

        {!isMobile && !isTeknisyen && (
          /* Ortalanma flex ile (mobil dock deseni). Not: dock camını bozan
             gerçek neden sheen'deki mix-blend-mode idi; flex ortalama yine
             de translate'e eşdeğer ve daha sade olduğu için korunuyor. */
          <div
             className="fixed left-0 right-0 flex justify-center pointer-events-none"
             style={{ bottom: 'var(--dock-gap)', zIndex: 'var(--z-dock)' } as React.CSSProperties}
          >
            <div
              className="pointer-events-auto"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <Dock
                  items={dockItems}
                  currentView={currentViewKey}
                  setTheme={setTheme}
                  isVisible={isVisible}
              />
            </div>
          </div>
        )}

        {!isTeknisyen && <MobileDock items={dockItems} />}


        <TaskPlannerPanel
          open={isPlannerPanelOpen}
          onClose={() => setIsPlannerPanelOpen(false)}
        />
      </main>
    </div>
  );
}
