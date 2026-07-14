
"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bell, Calendar, Menu, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { MobileProfileButton } from "@/components/ui/MobileProfileButton";
import { ThemeToggleDock } from "@/components/ui/theme-toggle-dock";
import NotificationsBell from "@/components/notifications/NotificationsBell";
import { useAI } from "@/contexts/ai-context";
import type { DockItemData } from "@/hooks/use-dock";
import { useIconMappings } from "@/hooks/useIconMappings";
import { CalendarDockPanel } from "./dock/CalendarDockPanel";
import { LiquidGlassSurface } from "@/components/ui/liquid-glass";

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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { openAI } = useAI();
  const router = useRouter();
  const iconData = useIconMappings();
  const mobileIcons = iconData?.mappings?.mobile || {};
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
          {/* Dock Container — Apple Liquid Glass yüzeyi (eski neumorphic kabuk kalktı) */}
          <div
            className={cn(
              "relative flex items-center justify-between h-14 px-4 rounded-full transition-all duration-300",
              isDark
                ? "shadow-[0_10px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.25)]"
                : "shadow-[0_12px_32px_rgba(0,0,0,0.16),0_3px_8px_rgba(0,0,0,0.08)]"
            )}
          >
            <LiquidGlassSurface radius={28} strength={34} dispersion={0.42} blur={2.5} bezel={18} zoom={0.22} fallbackBlur={22} shine={false} />

            {/* Profile Button */}
            <div className="relative">
              <MobileProfileButton isDark={isDark} />
            </div>

            {/* Search Button */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                triggerHaptic();
                router.push('/arama');
              }}
              aria-label="Arama panelini aç"
              className={cn(
                "relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200",
                isDark
                  ? "text-white hover:bg-white/10"
                  : "text-[#333] hover:bg-black/5"
              )}
            >
              <Search className="w-5 h-5" />
            </motion.button>

            {/* Center - Menu Button */}
            {/* Tap: Open menu | Long press: Open AI */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              onTouchCancel={handleTouchCancel}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              aria-label="Mobil menüyü aç"
              className={cn(
                "relative flex items-center justify-center w-11 h-11 rounded-full transition-all duration-200 select-none touch-none",
                isDark
                  ? "text-white bg-white/10 hover:bg-white/15"
                  : "text-[#333] bg-white/35 hover:bg-black/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.75)]"
              )}
              style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
            >
              <Menu className="w-5 h-5 pointer-events-none" />
            </motion.button>

            {/* Calendar Button */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                triggerHaptic();
                setCalendarOpen(true);
              }}
              aria-label="Takvimi aç"
              className={cn(
                "relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200",
                isDark
                  ? "text-white hover:bg-white/10"
                  : "text-[#333] hover:bg-black/5"
              )}
            >
              <Calendar className="w-5 h-5" />
            </motion.button>

            {/* Notification Button */}
            <div className="relative flex items-center">
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
                  customIcon={mobileIcons['notifications']}
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
            onCalendarClick={() => {
              setIsOpen(false);
              setCalendarOpen(true);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {calendarOpen && <CalendarDockPanel onClose={() => setCalendarOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

// --- FULL SCREEN MENU ---

interface FullScreenMenuProps {
  items: DockItemData[];
  onClose: () => void;
  isDark: boolean;
  onCalendarClick: () => void;
}

function FullScreenMenu({ items, onClose, isDark, onCalendarClick }: FullScreenMenuProps) {
  const router = useRouter();

  const handleItemClick = (item: DockItemData) => {
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
          ? "bg-black/70 backdrop-blur-2xl"
          : "bg-white/60 backdrop-blur-2xl"
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
              ? "bg-white/10 text-white hover:bg-white/20 border border-white/15"
              : "bg-white/55 text-[#333] border border-white/70 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] active:scale-95"
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
          className="space-y-2"
        >
          {items.map((item) => (
            <motion.li
              key={item.key}
              variants={{
                hidden: { opacity: 0, x: -20 },
                visible: { opacity: 1, x: 0 },
              }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <button
                onPointerDown={() => triggerHaptic()}
                onClick={() => handleItemClick(item)}
                className={cn(
                  "w-full text-left px-2 py-5 transition-all duration-200 rounded-2xl flex items-center",
                  isDark
                    ? "text-white hover:bg-white/5 active:bg-white/10"
                    : "text-[#333] hover:bg-black/5 active:bg-black/5"
                )}
              >
                <span className="text-2xl font-semibold tracking-[-0.02em]">{item.label}</span>
              </button>
            </motion.li>
          ))}
          {/* Takvim Item */}
          <motion.li
            key="calendar"
            variants={{
              hidden: { opacity: 0, x: -20 },
              visible: { opacity: 1, x: 0 },
            }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <button
              onPointerDown={() => triggerHaptic()}
              onClick={onCalendarClick}
              className={cn(
                "w-full text-left px-2 py-5 transition-all duration-200 rounded-2xl flex items-center",
                isDark
                  ? "text-white hover:bg-white/5 active:bg-white/10"
                  : "text-[#333] hover:bg-black/5 active:bg-black/5"
              )}
            >
              <span className="text-2xl font-semibold tracking-[-0.02em]">Takvim</span>
            </button>
          </motion.li>
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
                : "bg-white/55 border border-white/70 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.10),inset_0_1px_1px_rgba(255,255,255,0.8)]"
            )}
          >
            <ThemeToggleDock />
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
