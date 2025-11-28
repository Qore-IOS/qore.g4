"use client";
import React, { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import DynamicIslandToast, { AppNotification } from "./DynamicIslandToast";

// Reuse your existing store/hooks.
import { useDock } from "@/hooks/use-dock";
import { useAuth } from "@/contexts/auth-context";
import { buildHrefForResource } from "@/lib/notifications";

export default function PersistentNotificationToast() {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const { dockItems, acknowledgeNotification } = useDock();

  const notificationDockItem = dockItems.find((item) => item.key === "notifications");
  const notifications = notificationDockItem?.items || [];

  // Filter unread for this user; newest first
  const unread = useMemo(() => {
    const uid = currentUserProfile?.uid;
    const arr: AppNotification[] = (notifications ?? [])
      .filter((n: any) => {
        const readBy = (n.readBy ?? []) as string[];
        return uid ? !readBy.includes(uid) : true;
      })
      .map((n: any) => {
        // ✅ Merge normalized fields back into meta so the toast sees them
        const normalizedMeta = {
          ...n.meta,
          kurumAdi: n.meta?.kurumAdi || n.meta?.labName || n.meta?.hospitalName, // lab name for both hover & details
          deviceName: n.meta?.deviceName,
          itemCount: n.meta?.itemCount ?? n.meta?.items?.length ?? 1,
        };
        return {
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          actor: n.actor,
          meta: normalizedMeta,
          createdAt: n.createdAt,
          href: n.href,
          resource: n.resource,
        } as AppNotification;
      })
      .sort(
        (a, b) =>
          (b.createdAt?.toDate?.().getTime?.() ?? 0) -
          (a.createdAt?.toDate?.().getTime?.() ?? 0)
      );
    return arr;
  }, [notifications, currentUserProfile?.uid]);

  const onNavigate = useCallback(
    (n: AppNotification) => {
      // ✅ Mark read then navigate with robust fallbacks
      acknowledgeNotification(n.id);
      
      const fallbackHref = buildHrefForResource(n.resource, {
          labId: n.meta?.labId,
          depotId: n.meta?.depotId,
          tab: n.meta?.tab,
      });

      const to = n.href || fallbackHref;
      
      if (to) {
        router.push(to);
        return;
      }
      
      switch (n.type) {
        case "order_created":
        case "order_created_from_request":
          router.push("/siparisler");
          break;
        case "transfer_to_lab":
          router.push("/siparis-gecmis");
          break;
        case "fault_opened":
          router.push("/ariza-yonetimi");
          break;
        default:
          router.push("/");
      }
    },
    [acknowledgeNotification, router]
  );

  const onMarkRead = useCallback(
    async (id: string) => {
      await acknowledgeNotification(id);
    },
    [acknowledgeNotification]
  );

  const latestNotification = unread.length > 0 ? unread[0] : null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9998] flex flex-col items-center">
      <AnimatePresence initial={false}>
        {latestNotification && (
          <DynamicIslandToast
            key={latestNotification.id}
            notification={latestNotification}
            onNavigate={onNavigate}
            onMarkRead={onMarkRead}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
