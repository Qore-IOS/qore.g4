

"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { VIEWS, DOCK_ACTIONS } from "@/lib/constants";
import { db } from "@/lib/firebase";
import { trackListener } from "@/lib/listener-monitor";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit as fsLimit,
  updateDoc,
  doc,
  arrayUnion,
} from "firebase/firestore";
import type { NotificationDoc } from "@/lib/notifications";
import {
  Bell,
  Moon,
  LogOut,
  Wrench,
  ShieldAlert,
  AlertTriangle,
  ShoppingBag,
  Truck,
  Building,
  BookText,
  UserCog,
  Warehouse,
  BarChart3,
  TrendingUp,
  PackagePlus,
  History,
  Activity,
  Archive,
  ScanBarcode,
  CheckSquare,
  Settings,
  ClipboardPlus,
  Clock,
  CalendarCheck,
  Wallet,
  Map,
  Users,
  QrCode,
  Beaker,
  Pill,
  MapPin,
  Calculator,
  Barcode,
  PlusCircle,
  Palette,
  FolderKanban,
  Boxes,
} from "lucide-react";
import type { AppView } from "@/lib/types";
import { playNotificationSound } from "@/lib/utils";
import { scopedQuery } from '@/lib/firestore-helpers';

export type NotificationItem = { id: string } & NotificationDoc;

export interface DockSubItem {
  key: string;
  label: string;
  icon: React.ElementType;
  href: string;
  subItems?: DockSubItem[]; // Allow nested sub-items
}

export interface DockItemData {
  key: string;
  label: string;
  icon: React.ElementType;
  type: "nav" | "action";
  href?: string;
  onClick?: () => void;
  subItems?: DockSubItem[];
  // For notifications item specifically
  items?: NotificationItem[];
  unreadCount?: number;
  loading?: boolean;
}

const subItemMap: Record<string, DockSubItem[]> = {
  yonetim: [
    {
      key: "tanimlar",
      label: "Tanımlar",
      icon: BookText,
      href: "/yonetim/tanimlar",
      subItems: [
        {
          key: "depolar",
          label: "Depo Yönetimi",
          icon: Warehouse,
          href: "/yonetim/depolar",
        },
        {
          key: "borc-depolar",
          label: "Borç Depo Tanımlama",
          icon: Building,
          href: "/yonetim/borc-depolar",
        },
        {
          key: "urun-kodlari",
          label: "Ürün Kodu Yönetimi",
          icon: Barcode,
          href: "/yonetim/urun-kodlari",
        },
        {
          key: "adresler",
          label: "Adres Tanımları",
          icon: MapPin,
          href: "/yonetim/adresler",
        },
        {
          key: "laboratuvarlar",
          label: "Laboratuvar Yönetimi",
          icon: Pill,
          href: "/yonetim/laboratuvarlar",
        },
        {
          key: "kullanicilar",
          label: "Kullanıcı Yönetimi",
          icon: Users,
          href: "/yonetim/kullanicilar",
        },
        {
          key: "test-yonetimi",
          label: "Test Yönetimi",
          icon: Beaker,
          href: "/yonetim/test-yonetimi",
        },
        {
          key: "barkod-formatlari",
          label: "Barkod Formatları",
          icon: QrCode,
          href: "/yonetim/barkod-formatlari",
        },
      ],
    },
    {
      key: "personel-yonetimi",
      label: "Personel Yönetimi",
      icon: UserCog,
      href: "/yonetim/personel-yonetimi",
      subItems: [
        {
          key: "oturum-yonetimi",
          label: "Oturum Yönetimi",
          icon: LogOut,
          href: "/yonetim/personel-yonetimi/oturum-yonetimi",
        },
        {
          key: "ek-mesai",
          label: "Ek Mesai Yönetimi",
          icon: Clock,
          href: "/yonetim/personel-yonetimi/ek-mesai-yonetimi",
        },
        {
          key: "izin-yonetimi",
          label: "İzin Yönetimi",
          icon: CalendarCheck,
          href: "/yonetim/personel-yonetimi/izin-yonetimi",
        },
        {
          key: "masraf-yonetimi",
          label: "Masraf Yönetimi",
          icon: Wallet,
          href: "/yonetim/personel-yonetimi/masraf-yonetimi",
        },
      ],
    },
    {
      key: "envanter-yonetimi",
      label: "Envanter Yönetimi",
      icon: Warehouse,
      href: "/yonetim/envanter-yonetimi",
    },
    {
      key: "kisisellistirme",
      label: "Kişiselleştirme",
      icon: Palette,
      href: "/yonetim/kisisellistirme",
    },
  ],
  raporlama: [
    {
      key: "hareketsiz-stok",
      label: "Hareketsiz Stok",
      icon: History,
      href: "/raporlama/hareketsiz-stok-raporu",
    },
    {
      key: "minmax-grafik",
      label: "Min-Max Grafik",
      icon: TrendingUp,
      href: "/raporlama/minmax-urun-grafik",
    },
    {
      key: "gecmis-stok",
      label: "Geçmiş Stok Raporu",
      icon: History,
      href: "/raporlama/gecmis-stok-raporu",
    },
    {
      key: "stock-risk-report",
      label: "Stok Risk Raporu",
      icon: AlertTriangle,
      href: "/raporlama/stock-risk-report",
    },
    {
      key: "kumulatif-hesaplama",
      label: "Kümülatif Hesaplama",
      icon: Calculator,
      href: "/kumulatif-hesaplama",
    },
    {
      key: "cihaz-ustu-hesaplama",
      label: "Cihaz Üstü Hesaplama",
      icon: Activity,
      href: "/cihaz-ustu-hesaplama",
    },
  ],
  "urun-kullanim": [
    {
      key: "urun-talep",
      label: "Ürün Talebi",
      icon: ClipboardPlus,
      href: "/urun-talep",
    },
    {
      key: "tuketim-istatistikleri",
      label: "İstatistikler",
      icon: TrendingUp,
      href: "/tuketim-istatistikleri",
    },
    {
      key: "kullanim-dogrulama",
      label: "Kullanım Doğrulama",
      icon: CheckSquare,
      href: "/kullanim-dogrulama",
    },
  ],
  "mal-kabul": [
    {
      key: "mal-kabul-gecmis",
      label: "Mal Kabul Geçmişi",
      icon: History,
      href: "/mal-kabul/gecmis",
    },
  ],
  siparisler: [
    {
      key: "siparis-gecmis",
      label: "Sipariş Geçmişi",
      icon: History,
      // Sipariş geçmişi artık Siparişler sayfasındaki "Tamamlanan" sekmesi.
      href: "/siparisler?tab=tamamlanan",
    },
    {
      key: "direkt-transfer",
      label: "Direkt Transfer",
      icon: Truck,
      href: "/direkt-transfer",
    },
  ],
  "cihaz-yonetimi-ana": [
    {
      key: "teknik-servis",
      label: "Teknik Servis",
      icon: Wrench,
      href: "/teknik-servis",
    },
    {
      key: "ariza-yonetimi",
      label: "Tüm Arızalar",
      icon: ShieldAlert,
      href: "/ariza-yonetimi",
    },
  ],
  "personel-islemleri": [
    {
      key: "ek-mesai-bildirimi",
      label: "Ek Mesai Bildirimi",
      icon: Clock,
      href: "/personel-islemleri/ek-mesai",
    },
    // { key: 'masraf-bildirimi', label: 'Masraf Bildirimi', icon: Wallet, href: '/personel-islemleri/masraf' },
    // { key: 'izin-talebi', label: 'İzin Talebi', icon: CalendarCheck, href: '/personel-islemleri/izin' },
  ],
  "cari-odeme": [
    {
      key: "cari-odeme-genel",
      label: "Gösterge Paneli",
      icon: BarChart3,
      href: "/cari-odeme",
    },
    {
      key: "cari-odemeler",
      label: "Ödemeler",
      icon: Wallet,
      href: "/cari-odeme/odemeler",
    },
    {
      key: "cari-sablonlar",
      label: "Ödeme Talimatları",
      icon: ClipboardPlus,
      href: "/cari-odeme/sablonlar",
    },
    {
      key: "cari-firmalar",
      label: "Cari Firmalar",
      icon: Building,
      href: "/cari-odeme/firmalar",
    },
    {
      key: "cari-ayarlar",
      label: "Ayarlar",
      icon: Settings,
      href: "/cari-odeme/ayarlar",
    },
  ],
};

export function useDock() {
  const { currentUser, currentUserProfile, logout, currentCompanyId, isSuperAdmin } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [isPlannerPanelOpen, setIsPlannerPanelOpen] = useState(false);

  // Dock Visibility State
  const [isVisible, setIsVisible] = useState(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Notification State
  const [notificationItems, setNotificationItems] = useState<
    NotificationItem[]
  >([]);
  const [loadingNotifications, setLoadingNotifications] = useState(true);
  const prevUnreadCountRef = useRef(0);
  const uid = currentUserProfile?.uid || "";

  const notificationsAllowed =
    currentUserProfile?.notificationsEnabled === true;

  // Compute membership keys for notification targeting
  // Using stable primitive dependencies to prevent infinite loops
  const membershipKeysString = useMemo(() => {
    if (!notificationsAllowed || !currentUserProfile) return '';
    const keys = new Set<string>();
    if (currentUserProfile.uid) keys.add(`user:${currentUserProfile.uid}`);
    if (currentUserProfile.role) keys.add(`role:${currentUserProfile.role}`);
    (currentUserProfile.accessibleViews || []).forEach((v: string) =>
      keys.add(`view:${v}`)
    );
    (currentUserProfile.assignedLaboratories || []).forEach((id: string) =>
      keys.add(`lab:${id}`)
    );
    (currentUserProfile.assignedDepots || []).forEach((id: string) =>
      keys.add(`depot:${id}`)
    );
    return Array.from(keys).sort().join('|');
  }, [
    notificationsAllowed,
    currentUserProfile?.uid,
    currentUserProfile?.role,
    // Use JSON.stringify for arrays to get stable primitive values
    JSON.stringify(currentUserProfile?.accessibleViews || []),
    JSON.stringify(currentUserProfile?.assignedLaboratories || []),
    JSON.stringify(currentUserProfile?.assignedDepots || []),
  ]);

  const membershipKeys = useMemo(() => {
    if (!membershipKeysString) return [];
    return membershipKeysString.split('|');
  }, [membershipKeysString]);

  // peekDock is now defined as peekDockStable inside the notification effect section

  const acknowledgeNotification = useCallback(
    async (notificationId: string) => {
      if (!uid || !notificationId) return;
      setNotificationItems((prev) =>
        prev.filter((n) => n.id !== notificationId)
      );
      await updateDoc(doc(db, "notifications", notificationId), {
        readBy: arrayUnion(uid),
      });
    },
    [uid]
  );

  // Memoize peekDock to avoid dependency issues
  const peekDockStable = useCallback(() => {
    setIsVisible(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 5000);
  }, []);

  useEffect(() => {
    // Use membershipKeysString (primitive) instead of membershipKeys (array)
    // to prevent infinite loops from reference changes
    if (!membershipKeysString || !notificationsAllowed) {
      setNotificationItems([]);
      setLoadingNotifications(false);
      return;
    }

    const keysArray = membershipKeysString.split('|').slice(0, 30);
    if (keysArray.length === 0) {
      setNotificationItems([]);
      setLoadingNotifications(false);
      return;
    }

    trackListener("useDock-notifications", "create");

    const q = query(
      scopedQuery('notifications', currentCompanyId, isSuperAdmin),
      where("targets", "array-contains-any", keysArray),
      orderBy("createdAt", "desc"),
      fsLimit(40)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rawItems = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as NotificationItem[];

        // Intersection filter for fault_opened: non-admin users must have matching role AND assigned lab
        const userRole = currentUserProfile?.role;
        const userIsAdmin = userRole === 'admin' || userRole === 'super_admin';
        const userAssignedLabs = currentUserProfile?.assignedLaboratories || [];
        const newItems = rawItems.filter((item) => {
          if (item.type !== 'fault_opened') return true; // only filter fault notifications
          if (userIsAdmin) return true; // admins see all
          const faultType = item.meta?.faultType;
          const hospitalId = item.meta?.hospitalId;
          if (!faultType || !hospitalId) return true; // missing meta, allow through
          const roleMatch = userRole === faultType;
          const labMatch = userAssignedLabs.includes(hospitalId);
          return roleMatch && labMatch;
        });

        const newUnreadCount = newItems.filter(
          (i) => !(i.readBy || []).includes(uid)
        ).length;

        // Check if there is a *new* unread notification
        if (newUnreadCount > prevUnreadCountRef.current) {
          const latestUnread = newItems.find(i => !(i.readBy || []).includes(uid));
          if (latestUnread && (latestUnread.type === 'fefo_override' || latestUnread.type === 'fault_opened' || latestUnread.type === 'spare_part_transfer')) {
            playNotificationSound();
          }
          peekDockStable();
        }
        prevUnreadCountRef.current = newUnreadCount;
        setNotificationItems(newItems);
        setLoadingNotifications(false);
      },
      (err) => {
        console.error("Notification subscribe error", err);
        setLoadingNotifications(false);
      }
    );

    return () => {
      trackListener("useDock-notifications", "cleanup");
      unsub();
    };
  }, [membershipKeysString, uid, notificationsAllowed, peekDockStable]);

  const unreadCount = useMemo(() => {
    if (!uid || !notificationsAllowed) return 0;
    return notificationItems.filter((i) => !(i.readBy || []).includes(uid))
      .length;
  }, [notificationItems, uid, notificationsAllowed]);

  const markAllAsRead = async () => {
    if (!uid || !notificationsAllowed) return;
    const unreadIds = notificationItems
      .filter((i) => !(i.readBy || []).includes(uid))
      .map((i) => i.id);

    setNotificationItems((prev) =>
      prev.map((it) =>
        unreadIds.includes(it.id)
          ? { ...it, readBy: [...(it.readBy || []), uid] }
          : it
      )
    );
    const promises = unreadIds.map((id) =>
      updateDoc(doc(db, "notifications", id), { readBy: arrayUnion(uid) })
    );
    await Promise.all(promises).catch((err) =>
      console.error("Failed to mark all as read:", err)
    );
  };

  useEffect(() => {
    const onShow = () => {
      setIsVisible(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setIsVisible(false), 3000);
    };
    window.addEventListener('qore:dock-show', onShow);
    return () => window.removeEventListener('qore:dock-show', onShow);
  }, []);

  const currentViewKey = VIEWS.find((v) => v.href === pathname)?.key || "";

  const hasOnlyProductUsagePermission = (perms?: AppView[] | null): boolean => {
    if (!perms || perms.length === 0) return false;
    const set = new Set(perms);
    return set.has("urun-kullanim") && set.size === 1;
  };

  const accessibleViews =
    currentUserProfile?.accessibleViews ||
    (currentUser?.isAnonymous ? VIEWS.map((v) => v.key) : []);

  const dockItems: DockItemData[] = useMemo(() => {
    let actionItems: DockItemData[] = [];

    if (notificationsAllowed) {
      actionItems.push({
        key: "notifications",
        label: "Bildirimler",
        icon: Bell,
        type: "action",
        items: notificationItems,
        unreadCount: unreadCount,
        loading: loadingNotifications,
      });
    }

    // Filter out the 'theme' action
    actionItems.push(
      ...DOCK_ACTIONS.filter((a) => a.key !== "theme" && a.key !== "notifications").map(
        (action) => ({
          ...action,
          onClick: action.key === "logout" ? logout : undefined,
        })
      )
    );

    if (hasOnlyProductUsagePermission(accessibleViews)) {
      return actionItems;
    } else {
      const navItems: DockItemData[] = VIEWS.filter(
        (view) =>
          view.type === "nav" && accessibleViews.includes(view.key as AppView)
      ).map((view) => {
        const isTeknikServis = currentUserProfile?.role === 'teknik_servis';
        const isAplikasyon = currentUserProfile?.role === 'aplikasyon';
        const ownStockHref = currentUserProfile?.uid
          ? `/direkt-transfer/yedek-parca-transfer/${currentUserProfile.uid}`
          : '/direkt-transfer/yedek-parca-transfer';

        let subItems = subItemMap[view.key] || [];
        if (view.key === 'cihaz-yonetimi-ana' && (isTeknikServis || isAplikasyon)) {
          const formsHref = isAplikasyon ? '/aplikasyon-paneli/tum-formlar' : '/teknik-servis/tum-formlar';
          subItems = [
            {
              key: 'islem-formlarim',
              label: 'İşlem Formlarım',
              icon: FolderKanban,
              href: formsHref,
            },
            {
              key: 'stogum',
              label: 'Stoğum',
              icon: Boxes,
              href: ownStockHref,
            },
            {
              key: 'kumulatif-hesaplama-field',
              label: 'Kümülatif Hesapla',
              icon: Calculator,
              href: '/kumulatif-hesaplama',
            },
          ];
        }

        return {
          ...view,
          onClick:
            view.key === "planner"
              ? () => setIsPlannerPanelOpen(true)
              : view.href
              ? () => router.push(view.href!)
              : undefined,
          subItems,
        };
      });

      if (isMobile && (currentUserProfile?.role === 'teknik_servis' || currentUserProfile?.role === 'aplikasyon')) {
        const formsHref = currentUserProfile.role === 'aplikasyon' ? '/aplikasyon-paneli/tum-formlar' : '/teknik-servis/tum-formlar';
        const stockHref = currentUserProfile?.uid
          ? `/direkt-transfer/yedek-parca-transfer/${currentUserProfile.uid}`
          : '/direkt-transfer/yedek-parca-transfer';

        navItems.push(
          {
            key: 'islem-formlarim-mobile',
            label: 'İşlem Formlarım',
            icon: FolderKanban,
            type: 'nav',
            href: formsHref,
            onClick: () => router.push(formsHref),
          },
          {
            key: 'stogum-mobile',
            label: 'Stoğum',
            icon: Boxes,
            type: 'nav',
            href: stockHref,
            onClick: () => router.push(stockHref),
          },
          {
            key: 'kumulatif-hesaplama-field-mobile',
            label: 'Kümülatif Hesapla',
            icon: Calculator,
            type: 'nav',
            href: '/kumulatif-hesaplama',
            onClick: () => router.push('/kumulatif-hesaplama'),
          }
        );
      }

      return [...navItems, ...actionItems];
    }
  }, [
    accessibleViews,
    currentUser?.isAnonymous,
    logout,
    router,
    notificationItems,
    unreadCount,
    loadingNotifications,
    notificationsAllowed,
    currentUserProfile?.role,
    currentUserProfile?.uid,
    isMobile,
  ]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 3000); // 3s delay
  };

  return {
    dockItems,
    isPlannerPanelOpen,
    setIsPlannerPanelOpen,
    currentViewKey,
    isMobile,
    isVisible,
    handleMouseEnter,
    handleMouseLeave,
    markAllAsRead,
    notifications: notificationItems, // pass the full list
    acknowledgeNotification,
  };
}
