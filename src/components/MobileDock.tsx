
"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bell } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { MobileProfileButton } from "@/components/ui/MobileProfileButton";
import { ThemeToggleDock } from "@/components/ui/theme-toggle-dock";
import NotificationsBell from "@/components/notifications/NotificationsBell";
import { useAI } from "@/contexts/ai-context";
import type { DockItemData, NotificationItem } from "@/hooks/use-dock";
import Image from "next/image";
import { useIconMappings, getIconSrc } from "@/hooks/useIconMappings";

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

const triggerHaptic = (pattern: number | number[] = 10) => {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
};

// Long press duration in milliseconds
const LONG_PRESS_DURATION = 500;

// --- MAIN COMPONENT ---

export default function MobileDock({ items }: { items: DockItemData[] }) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { openAI } = useAI();
  const { mappings: iconMappings } = useIconMappings();

  // Long press handling
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const hasHandledTouch = useRef(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Prevent default to avoid ghost clicks
    e.preventDefault();

    // Reset state
    isLongPress.current = false;
    hasHandledTouch.current = false;

    // Store touch start position
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };

    // Start long press timer
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      hasHandledTouch.current = true;
      triggerHaptic([50, 30, 50]); // Distinctive haptic for AI
      openAI();
    }, LONG_PRESS_DURATION);
  }, [openAI]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    clearLongPressTimer();

    // If already handled (long press) or moved too much, don't open menu
    if (hasHandledTouch.current) {
      return;
    }

    // Short tap - open menu
    triggerHaptic();
    setIsOpen(true);
  }, [clearLongPressTimer]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Check if finger moved more than threshold (10px)
    if (touchStartPos.current && e.touches[0]) {
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - touchStartPos.current.x);
      const deltaY = Math.abs(touch.clientY - touchStartPos.current.y);

      if (deltaX > 10 || deltaY > 10) {
        clearLongPressTimer();
        hasHandledTouch.current = true; // Mark as handled to prevent menu open
      }
    }
  }, [clearLongPressTimer]);

  const handleTouchCancel = useCallback(() => {
    clearLongPressTimer();
    hasHandledTouch.current = true;
  }, [clearLongPressTimer]);

  // Mouse events for desktop testing (separate from touch)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only handle if not a touch device (avoid double firing)
    if ('ontouchstart' in window) return;

    e.preventDefault();
    isLongPress.current = false;

    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      openAI();
    }, LONG_PRESS_DURATION);
  }, [openAI]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if ('ontouchstart' in window) return;

    e.preventDefault();
    clearLongPressTimer();

    if (!isLongPress.current) {
      setIsOpen(true);
    }
  }, [clearLongPressTimer]);

  const handleMouseLeave = useCallback(() => {
    if ('ontouchstart' in window) return;
    clearLongPressTimer();
  }, [clearLongPressTimer]);

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
            {/* Tap: Open menu | Long press: Open AI */}
            <div className="absolute left-1/2 -translate-x-1/2 -top-[2.375rem]">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchMove}
                onTouchCancel={handleTouchCancel}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                className="w-20 h-20 flex items-center justify-center transition-all duration-300 select-none touch-none"
                style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
              >
                <Image
                  src={isDark ? "/newlogoblk.png" : "/newlogowh.png"}
                  alt="Qore - Basılı tut: AI"
                  width={80}
                  height={80}
                  className="w-20 h-20 object-contain pointer-events-none select-none"
                  draggable={false}
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
                {iconMappings.mobile[item.key] ? (
                  <Image
                    src={getIconSrc(iconMappings.mobile[item.key])}
                    alt={item.label}
                    width={20}
                    height={20}
                    className="w-5 h-5 shrink-0 object-contain"
                  />
                ) : item.icon ? (
                  <item.icon
                    className={cn(
                      "w-5 h-5 shrink-0",
                      isDark ? "text-amber-400" : "text-amber-600"
                    )}
                  />
                ) : null}
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
