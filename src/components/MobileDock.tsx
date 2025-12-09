"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bell } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { MobileProfileButton } from "@/components/ui/MobileProfileButton";
import { ThemeToggleDock } from "@/components/ui/theme-toggle-dock";
import NotificationsBell from "@/components/notifications/NotificationsBell";
import type { DockItemData, NotificationItem } from "@/hooks/use-dock";

// --- HELPERS ---

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
};

const triggerHaptic = () => {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

// --- MAIN COMPONENT ---

export default function MobileDock({ items }: { items: DockItemData[] }) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  if (!isMobile) return null;

  // Filter navigation items for menu
  const menuItems = items.filter((item) => item.type === "nav");

  // Get notification data
  const notificationItem = items.find((item) => item.key === "notifications");

  return (
    <>
      {/* Spacer to prevent content from hiding behind dock */}
      <div className="h-28 pointer-events-none" />

      {/* BOTTOM DOCK BAR */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pointer-events-none"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}
      >
        <div className="pointer-events-auto px-4 pb-4 w-full max-w-md">
          {/* Dock Container */}
          <div
            className={cn(
              "relative flex items-center justify-between h-14 px-4 rounded-full transition-all duration-300",
              isDark
                ? "bg-white/10 backdrop-blur-xl border border-white/20 shadow-[0_4px_30px_rgba(0,0,0,0.3)]"
                : "bg-[#e0e0e0] shadow-[6px_6px_12px_#bebebe,-6px_-6px_12px_#ffffff]"
            )}
          >
            {/* Left - Profile Button */}
            <MobileProfileButton isDark={isDark} />

            {/* Center - Logo Button (Floating Above) */}
            <div className="absolute left-1/2 -translate-x-1/2 -top-6">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  triggerHaptic();
                  setIsOpen(true);
                }}
                className={cn(
                  "w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 rotate-45 overflow-hidden",
                  isDark
                    ? "bg-white/10 backdrop-blur-xl border border-white/20 shadow-[0_4px_30px_rgba(0,0,0,0.3)]"
                    : "bg-[#e0e0e0] shadow-[6px_6px_12px_#bebebe,-6px_-6px_12px_#ffffff]"
                )}
              >
                <img
                  src="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG"
                  alt="Qore"
                  className="w-10 h-10 object-contain -rotate-45"
                />
              </motion.button>
            </div>

            {/* Right - Notification Button */}
            <div className="flex items-center">
              {notificationItem ? (
                <NotificationsBell
                  triggerClassName={cn(
                    "relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200",
                    isDark
                      ? "text-white hover:bg-white/10"
                      : "text-[#333] hover:bg-black/5"
                  )}
                  items={notificationItem.items || []}
                  unreadCount={notificationItem.unreadCount || 0}
                  loading={notificationItem.loading || false}
                />
              ) : (
                <button
                  className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200",
                    isDark
                      ? "text-white hover:bg-white/10"
                      : "text-[#333] hover:bg-black/5"
                  )}
                >
                  <Bell className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* FULL SCREEN MENU */}
      <AnimatePresence>
        {isOpen && (
          <FullScreenMenu
            items={menuItems}
            onClose={() => setIsOpen(false)}
            isDark={isDark}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// --- FULL SCREEN MENU ---

interface FullScreenMenuProps {
  items: DockItemData[];
  onClose: () => void;
  isDark: boolean;
}

function FullScreenMenu({ items, onClose, isDark }: FullScreenMenuProps) {
  const router = useRouter();

  const handleItemClick = (item: DockItemData) => {
    triggerHaptic();
    onClose();
    if (item.href) {
      router.push(item.href);
    } else if (item.onClick) {
      item.onClick();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "fixed inset-0 z-50 flex flex-col",
        isDark
          ? "bg-black/95 backdrop-blur-xl"
          : "bg-[#e0e0e0]"
      )}
      style={{
        paddingTop: "env(safe-area-inset-top, 20px)",
        paddingBottom: "env(safe-area-inset-bottom, 20px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {/* Header with Close Button */}
      <div className="flex justify-end px-6 pt-4">
        <motion.button
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          exit={{ scale: 0, rotate: 180 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          onClick={onClose}
          className={cn(
            "p-3 rounded-full transition-all duration-200",
            isDark
              ? "bg-white/10 text-white hover:bg-white/20"
              : "bg-[#e0e0e0] text-[#333] shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff] active:shadow-[inset_4px_4px_8px_#bebebe,inset_-4px_-4px_8px_#ffffff]"
          )}
        >
          <X size={24} />
        </motion.button>
      </div>

      {/* Menu Items */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <motion.ul
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={{
            visible: {
              transition: {
                staggerChildren: 0.05,
              },
            },
          }}
          className="space-y-3"
        >
          {items.map((item, index) => (
            <motion.li
              key={item.key}
              variants={{
                hidden: { opacity: 0, x: -20 },
                visible: { opacity: 1, x: 0 },
              }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <button
                onClick={() => handleItemClick(item)}
                className={cn(
                  "w-full text-left px-5 py-4 rounded-2xl transition-all duration-200 flex items-center gap-4",
                  isDark
                    ? "bg-white/5 hover:bg-white/10 border border-white/10 text-white"
                    : "bg-[#e0e0e0] shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff] hover:shadow-[2px_2px_4px_#bebebe,-2px_-2px_4px_#ffffff] active:shadow-[inset_4px_4px_8px_#bebebe,inset_-4px_-4px_8px_#ffffff] text-[#333]"
                )}
              >
                {item.icon && (
                  <item.icon
                    className={cn(
                      "w-5 h-5 shrink-0",
                      isDark ? "text-amber-400" : "text-amber-600"
                    )}
                  />
                )}
                <span className="text-lg font-medium">{item.label}</span>
              </button>
            </motion.li>
          ))}
        </motion.ul>
      </div>

      {/* Footer with Theme Toggle */}
      <div className="px-6 pb-4">
        <div className="flex justify-end">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className={cn(
              "p-3 rounded-2xl",
              isDark
                ? "bg-white/5 border border-white/10"
                : "bg-[#e0e0e0] shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff]"
            )}
          >
            <ThemeToggleDock />
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
