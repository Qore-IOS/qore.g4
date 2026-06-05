
"use client";

import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';
import { cn } from '@/lib/utils';
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronRight, Calendar } from 'lucide-react';
import NotificationsBell from '@/components/notifications/NotificationsBell';
import type { DockItemData } from '@/hooks/use-dock';
import { useAuth } from '@/contexts/auth-context';
import { useStartMenu } from '@/contexts/start-menu-context';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CalendarDockPanel } from '@/components/dock/CalendarDockPanel';
import Image from 'next/image';
import { useIconMappings, getIconSrc } from '@/hooks/useIconMappings';

// Apple-like colorful icon colors - applied directly to the icon SVG via CSS gradient text
// Each icon gets a unique vibrant color pair for a 3D gradient feel
const ICON_COLORS: Record<string, [string, string]> = {
  'dashboard': ['#3b82f6', '#1d4ed8'],   // blue
  'planner': ['#8b5cf6', '#6d28d9'],   // purple
  'arama': ['#14b8a6', '#0d9488'],   // teal
  'mal-kabul': ['#22c55e', '#16a34a'],   // green
  'siparisler': ['#f97316', '#ea580c'],   // orange
  'direkt-transfer': ['#6366f1', '#4f46e5'],   // indigo
  'stok-yonetimi': ['#10b981', '#059669'],   // emerald
  'depo-sayim': ['#06b6d4', '#0891b2'],   // cyan
  'route-planlayici': ['#ec4899', '#db2777'],   // pink
  'laboratuvar-yonetimi': ['#8b5cf6', '#7c3aed'],   // violet
  'urun-kullanim': ['#f59e0b', '#d97706'],   // amber
  'sarf-dagitim': ['#f43f5e', '#e11d48'],   // rose
  'numune-arsivi': ['#64748b', '#475569'],   // slate
  'cihazdan-cikan-kit': ['#ef4444', '#dc2626'],   // red
  'is-analizi': ['#0ea5e9', '#0284c7'],   // sky
  'total-verimlilik': ['#d946ef', '#c026d3'],   // fuchsia
  'cihaz-yonetimi-ana': ['#eab308', '#ca8a04'],   // yellow
  'raporlama': ['#60a5fa', '#4f46e5'],   // blue-indigo
  'personel-islemleri': ['#14b8a6', '#06b6d4'],   // teal-cyan
  'tanimlar': ['#6b7280', '#4b5563'],   // gray
  'satin-alma': ['#f97316', '#ef4444'],   // orange-red
  'kullanici-talepleri': ['#22c55e', '#14b8a6'],   // green-teal
  'yonetim': ['#6b7280', '#374151'],   // gray-dark
  'notifications': ['#ef4444', '#f43f5e'],   // red-rose
  'logout': ['#ef4444', '#dc2626'],   // red
  // Sub-item keys for colorful submenu icons
  'depolar': ['#0ea5e9', '#0284c7'],   // sky
  'borc-depolar': ['#6366f1', '#4f46e5'],   // indigo
  'urun-kodlari': ['#f97316', '#ea580c'],   // orange
  'adresler': ['#ec4899', '#db2777'],   // pink
  'laboratuvarlar': ['#8b5cf6', '#7c3aed'],   // violet
  'kullanicilar': ['#14b8a6', '#0d9488'],   // teal
  'test-yonetimi': ['#06b6d4', '#0891b2'],   // cyan
  'barkod-formatlari': ['#64748b', '#475569'],   // slate
  'personel-yonetimi': ['#f59e0b', '#d97706'],   // amber
  'envanter-yonetimi': ['#22c55e', '#16a34a'],   // green
  'kisisellistirme': ['#d946ef', '#c026d3'],   // fuchsia
  'oturum-yonetimi': ['#ef4444', '#dc2626'],   // red
  'ek-mesai': ['#f97316', '#ea580c'],   // orange
  'izin-yonetimi': ['#22c55e', '#16a34a'],   // green
  'masraf-yonetimi': ['#eab308', '#ca8a04'],   // yellow
  'hareketsiz-stok': ['#64748b', '#475569'],   // slate
  'minmax-grafik': ['#3b82f6', '#1d4ed8'],   // blue
  'gecmis-stok': ['#8b5cf6', '#7c3aed'],   // violet
  'kumulatif-islemleri': ['#14b8a6', '#0d9488'],   // teal
  'kumulatif-hesaplama': ['#06b6d4', '#0891b2'],   // cyan
  'kumulatif-gecmis': ['#64748b', '#475569'],   // slate
  'cihaz-ustu-islemleri': ['#f43f5e', '#e11d48'],   // rose
  'cihaz-ustu-ekle': ['#22c55e', '#16a34a'],   // green
  'cihaz-ustu-gecmisi': ['#f59e0b', '#d97706'],   // amber
  'urun-talep': ['#3b82f6', '#1d4ed8'],   // blue
  'tuketim-istatistikleri': ['#d946ef', '#c026d3'],  // fuchsia
  'kullanim-dogrulama': ['#22c55e', '#16a34a'],   // green
  'mal-kabul-gecmis': ['#64748b', '#475569'],   // slate
  'siparis-gecmis': ['#f59e0b', '#d97706'],   // amber
  'cost-dashboard': ['#eab308', '#ca8a04'],   // yellow
  'teknik-servis': ['#f97316', '#ea580c'],   // orange
  'ariza-yonetimi': ['#ef4444', '#dc2626'],   // red
  'ek-mesai-bildirimi': ['#f97316', '#ea580c'],   // orange
  'islem-formlarim': ['#6366f1', '#4f46e5'],   // indigo
  'stogum': ['#10b981', '#059669'],   // emerald
};

interface DockProps {
  items: DockItemData[];
  currentView: string;
  className?: string;
  setTheme: (theme: string) => void;
  isVisible: boolean;
}

// Liquid Glass Selector Component - Apple Style with Liquid Motion
const LiquidGlassSelector = ({
  x,
  width,
  height,
  isVisible,
  activeLabel,
}: {
  x: number;
  width: number;
  height: number;
  isVisible: boolean;
  activeLabel?: string;
}) => {
  // Spring configs for different properties
  const positionSpring = { damping: 18, stiffness: 150, mass: 0.8 };
  const morphSpring = { damping: 12, stiffness: 200, mass: 0.5 };

  const springX = useSpring(x, positionSpring);
  const springWidth = useSpring(width, positionSpring);

  // Track velocity for liquid deformation
  const [velocity, setVelocity] = useState(0);
  const [isMoving, setIsMoving] = useState(false);
  const prevXRef = useRef(x);
  const velocityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Deformation values based on velocity
  const scaleX = useSpring(1, morphSpring);
  const scaleY = useSpring(1, morphSpring);
  const skewX = useSpring(0, morphSpring);

  useEffect(() => {
    const deltaX = x - prevXRef.current;
    const newVelocity = Math.abs(deltaX);

    if (newVelocity > 2) {
      setIsMoving(true);
      setVelocity(deltaX);

      // Calculate deformation based on movement direction and speed
      const deformAmount = Math.min(Math.abs(deltaX) / 30, 0.25);
      const direction = deltaX > 0 ? 1 : -1;

      // Stretch horizontally, compress vertically (liquid squash & stretch)
      scaleX.set(1 + deformAmount * 0.8);
      scaleY.set(1 - deformAmount * 0.3);
      skewX.set(direction * deformAmount * 8);

      // Clear previous timeout
      if (velocityTimeoutRef.current) {
        clearTimeout(velocityTimeoutRef.current);
      }

      // Bounce back to original shape
      velocityTimeoutRef.current = setTimeout(() => {
        scaleX.set(1);
        scaleY.set(1);
        skewX.set(0);
        setIsMoving(false);
        setVelocity(0);
      }, 80);
    }

    prevXRef.current = x;
    springX.set(x);
    springWidth.set(width);

    return () => {
      if (velocityTimeoutRef.current) {
        clearTimeout(velocityTimeoutRef.current);
      }
    };
  }, [x, width, springX, springWidth, scaleX, scaleY, skewX]);

  if (!isVisible) return null;

  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        x: springX,
        width: springWidth,
        height: height,
        top: '50%',
        translateY: '-50%',
        zIndex: 5,
        scaleX,
        scaleY,
        skewX,
      }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.1, ease: "easeOut" }}
    >
      {/* SVG Filters for advanced effects */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          {/* Displacement filter for liquid edge distortion */}
          <filter id="liquid-distort" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015"
              numOctaves="2"
              result="noise"
              seed="5"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={isMoving ? 6 : 2}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>

          {/* Glow filter for rim light */}
          <filter id="liquid-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
      </svg>

      {/* Shadow layer - soft, colored shadow */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: '9999px',
          transform: 'translateY(6px) scaleX(0.92) scaleY(0.6)',
          background: 'radial-gradient(ellipse at center, rgba(0, 30, 60, 0.25) 0%, transparent 70%)',
          filter: 'blur(8px)',
        }}
      />

      {/* Main Glass Container */}
      <div
        className="relative w-full h-full"
        style={{
          borderRadius: '9999px',
          overflow: 'hidden',
          filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.12)) drop-shadow(0 1px 3px rgba(0,0,0,0.08))',
        }}
      >
        {/* Refraction layer - magnifies and tints background */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '9999px',
            background: `
              linear-gradient(
                180deg,
                rgba(255, 255, 255, 0.35) 0%,
                rgba(255, 255, 255, 0.05) 35%,
                rgba(255, 255, 255, 0.12) 100%
              )
            `,
            backdropFilter: 'blur(20px) saturate(200%) contrast(1.08) brightness(1.05)',
            WebkitBackdropFilter: 'blur(20px) saturate(200%) contrast(1.08) brightness(1.05)',
          }}
        />

        {/* Light A - Sharp rim light (top) */}
        <div
          className="absolute inset-x-[5%] top-0 h-[50%]"
          style={{
            borderRadius: '9999px 9999px 50% 50%',
            background: `
              linear-gradient(
                180deg,
                rgba(255, 255, 255, 0.85) 0%,
                rgba(255, 255, 255, 0.4) 30%,
                rgba(255, 255, 255, 0.1) 60%,
                transparent 100%
              )
            `,
          }}
        />

        {/* Light B - Soft volume light */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '9999px',
            background: `
              radial-gradient(
                ellipse 80% 50% at 50% 0%,
                rgba(255, 255, 255, 0.3) 0%,
                transparent 70%
              )
            `,
            opacity: 0.6,
          }}
        />

        {/* Left edge refraction - stronger */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[8px]"
          style={{
            background: `
              linear-gradient(
                90deg,
                rgba(255, 255, 255, 0.95) 0%,
                rgba(255, 255, 255, 0.5) 40%,
                rgba(255, 255, 255, 0.1) 80%,
                transparent 100%
              )
            `,
          }}
        />

        {/* Right edge refraction */}
        <div
          className="absolute right-0 top-0 bottom-0 w-[8px]"
          style={{
            background: `
              linear-gradient(
                -90deg,
                rgba(255, 255, 255, 0.75) 0%,
                rgba(255, 255, 255, 0.3) 40%,
                rgba(255, 255, 255, 0.05) 80%,
                transparent 100%
              )
            `,
          }}
        />

        {/* Bottom edge subtle highlight */}
        <div
          className="absolute inset-x-[10%] bottom-0 h-[25%]"
          style={{
            borderRadius: '50% 50% 9999px 9999px',
            background: `
              linear-gradient(
                0deg,
                rgba(255, 255, 255, 0.25) 0%,
                transparent 100%
              )
            `,
          }}
        />

        {/* Light C - Specular highlight sweep (top-left) */}
        <div
          className="absolute top-[8%] left-[5%] w-[25%] h-[45%]"
          style={{
            background: 'radial-gradient(ellipse at 30% 30%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.4) 40%, transparent 70%)',
            borderRadius: '50%',
            filter: 'blur(1px)',
          }}
        />

        {/* Light D - Secondary highlight (top-right, subtle) */}
        <div
          className="absolute top-[15%] right-[8%] w-[15%] h-[30%]"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.5) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />

        {/* Inner depth shadow */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '9999px',
            boxShadow: `
              inset 0 -8px 20px rgba(0, 0, 0, 0.06),
              inset 0 4px 8px rgba(255, 255, 255, 0.4),
              inset 0 1px 2px rgba(255, 255, 255, 0.6)
            `,
          }}
        />

        {/* Glass border */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '9999px',
            border: '1.5px solid rgba(255, 255, 255, 0.7)',
          }}
        />
      </div>

      {/* Active label below selector */}
      <AnimatePresence>
        {activeLabel && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap"
          >
            <span className="text-xs font-medium text-foreground bg-background/95 backdrop-blur-md px-2.5 py-0.5 rounded-full shadow-md border border-border/50">
              {activeLabel}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const DockItem = ({
  item,
  isActive,
  setTheme,
  isLiquidMode,
  isLiquidHovered,
  onRefSet,
  customIcon,
}: {
  item: DockItemData;
  isActive: boolean;
  setTheme: (theme: string) => void;
  isLiquidMode?: boolean;
  isLiquidHovered?: boolean;
  onRefSet?: (el: HTMLDivElement | null) => void;
  customIcon?: string;
}) => {

  const { isOrbAnimationEnabled, toggleOrbAnimation, toggleNavMode, navMode } = useAuth();
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<string | null>(null);
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const subMenuTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Doğrudan sayfaya yönlendir
  const handleNavigate = (
    e: React.MouseEvent,
    path?: string,
    label?: string,
    icon?: React.ElementType,
  ) => {
    if (path) {
      e.stopPropagation();
      router.push(path);
    } else if (item.onClick) {
      item.onClick();
    }
  };

  // Stabilized hover handlers with delay to prevent flickering
  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      setActiveSubMenu(null);
    }, 150); // Small delay to allow moving to submenu
  };

  const handleSubMenuEnter = (subKey: string) => {
    if (subMenuTimeoutRef.current) {
      clearTimeout(subMenuTimeoutRef.current);
      subMenuTimeoutRef.current = null;
    }
    setActiveSubMenu(subKey);
  };

  const handleSubMenuLeave = () => {
    subMenuTimeoutRef.current = setTimeout(() => {
      setActiveSubMenu(null);
    }, 100);
  };

  // Cleanup timeouts on unmount
  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (subMenuTimeoutRef.current) clearTimeout(subMenuTimeoutRef.current);
    };
  }, []);

  if (item.key === 'notifications') {
    return (
      <div className="relative flex items-center justify-center">
        <NotificationsBell
          label={item.label}
          items={item.items || []}
          unreadCount={item.unreadCount || 0}
          loading={item.loading || false}
          customIcon={customIcon}
        />
      </div>
    );
  }

  const hasSubItems = item.subItems && item.subItems.length > 0;

  // Viewport-aware submenu positioning
  const submenuRef = useRef<HTMLDivElement>(null);
  const nestedSubmenuRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const iconRef = useRef<HTMLDivElement>(null);

  // Adjust main submenu: clamp horizontally, flip vertically if needed
  useEffect(() => {
    if (!isHovered || !submenuRef.current) return;
    const menu = submenuRef.current;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Reset
    menu.style.transform = '';
    menu.style.bottom = '';
    menu.style.top = '';

    // If the menu overflows above the viewport, flip it below the dock icon
    if (rect.top < 8) {
      menu.style.bottom = 'auto';
      menu.style.top = '100%';
      menu.style.marginTop = '4px';
    }

    // Re-measure after potential flip
    const rect2 = menu.getBoundingClientRect();

    // Clamp horizontally
    if (rect2.right > vw - 8) {
      menu.style.transform = `translateX(-${rect2.right - vw + 12}px)`;
    } else if (rect2.left < 8) {
      menu.style.transform = `translateX(${12 - rect2.left}px)`;
    }
  }, [isHovered]);

  // Adjust nested submenu: flip left if overflows right, flip up if overflows bottom
  useEffect(() => {
    if (!activeSubMenu) return;
    const el = nestedSubmenuRefs.current.get(activeSubMenu);
    if (!el) return;

    // Reset first
    el.style.left = '';
    el.style.right = '';
    el.style.top = '';
    el.style.bottom = '';
    el.style.marginLeft = '4px';
    el.style.marginRight = '';

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Flip horizontally: if overflows right, position to the left
    if (rect.right > vw - 8) {
      el.style.left = 'auto';
      el.style.right = '100%';
      el.style.marginLeft = '0';
      el.style.marginRight = '4px';
    }

    // Re-measure after horizontal flip
    const rect2 = el.getBoundingClientRect();

    // Vertical: if overflows bottom, shift up
    if (rect2.bottom > vh - 8) {
      const overflow = rect2.bottom - vh + 12;
      el.style.top = `-${overflow}px`;
    }
    // If overflows top, shift down
    if (rect2.top < 8) {
      el.style.top = `${8 - rect2.top}px`;
    }
  }, [activeSubMenu]);

  const iconColors = ICON_COLORS[item.key] || ['#6b7280', '#4b5563'];
  const iconGradientStyle = {
    background: `linear-gradient(135deg, ${iconColors[0]}, ${iconColors[1]})`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))',
  } as React.CSSProperties;

  const submenuSurface = "bg-white/80 dark:bg-black/30 backdrop-blur-xl border border-gray-200/60 dark:border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)]";

  // Fast spring for snappy animations
  const fastSpring = { type: 'spring' as const, stiffness: 600, damping: 25 };

  // Helper: get gradient style for a sub-item icon by key
  const getSubIconStyle = (key: string): React.CSSProperties => {
    const colors = ICON_COLORS[key];
    if (!colors) return {};
    return {
      background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`,
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    };
  };

  // For items with submenus, use a different structure
  // Tooltip wraps only the icon, not the submenu
  if (hasSubItems) {
    return (
      <div
        className="relative flex flex-col items-center"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Submenu positioned above the icon - no scroll, fits all buttons */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              ref={submenuRef}
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className={cn("absolute bottom-full mb-1 flex flex-col items-stretch gap-0.5 p-1.5 rounded-xl", submenuSurface)}
              style={{
                bottom: '100%',
                marginBottom: '4px',
                zIndex: 'var(--z-float)',
                whiteSpace: 'nowrap',
              } as React.CSSProperties}
            >
              {/* Invisible bridge to prevent gap between submenu and icon */}
              <div className="absolute -bottom-2 left-0 right-0 h-3" />
              {item.subItems!.map(sub => {
                const subColors = ICON_COLORS[sub.key] || ['#6b7280', '#4b5563'];
                return (
                  <div
                    key={sub.key}
                    className="relative"
                    onMouseEnter={() => handleSubMenuEnter(sub.key)}
                    onMouseLeave={handleSubMenuLeave}
                  >
                    <button
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors text-left"
                      onClick={(e) => handleNavigate(e, sub.href, sub.label, sub.icon)}
                    >
                      <sub.icon className="w-4 h-4 flex-shrink-0" style={{ color: subColors[0] }} />
                      <span className="text-foreground">{sub.label}</span>
                      {sub.subItems && <ChevronRight className="w-3.5 h-3.5 ml-auto flex-shrink-0 opacity-40" />}
                    </button>
                    {/* Nested Sub-Menu - viewport aware */}
                    <AnimatePresence>
                      {activeSubMenu === sub.key && sub.subItems && (
                        <motion.div
                          ref={(el) => { if (el) nestedSubmenuRefs.current.set(sub.key, el); }}
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.97 }}
                          transition={{ duration: 0.1 }}
                          className={cn("absolute left-full top-0 ml-1 flex flex-col items-stretch gap-0.5 p-1.5 rounded-xl", submenuSurface)}
                          style={{
                            zIndex: 'var(--z-float)',
                            whiteSpace: 'nowrap',
                          } as React.CSSProperties}
                        >
                          {/* Invisible bridge for nested menu */}
                          <div className="absolute -left-2 top-0 bottom-0 w-3" />
                          {sub.subItems.map(nestedSub => {
                            const nestedColors = ICON_COLORS[nestedSub.key] || ['#6b7280', '#4b5563'];
                            return (
                              <button
                                key={nestedSub.key}
                                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors text-left"
                                onClick={(e) => handleNavigate(e, nestedSub.href, nestedSub.label, nestedSub.icon)}
                              >
                                <nestedSub.icon className="w-4 h-4 flex-shrink-0" style={{ color: nestedColors[0] }} />
                                <span className="text-foreground">{nestedSub.label}</span>
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tooltip wraps ONLY the icon - HIDDEN when submenu is open */}
        <Tooltip open={!isLiquidMode && !isHovered ? undefined : false}>
          <TooltipTrigger asChild>
            <motion.div
              ref={(el) => { if (onRefSet) onRefSet(el); (iconRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
              animate={!isLiquidMode && isHovered ? { scale: 1.55 } : { scale: 1 }}
              className={cn(
                'dock-item-wrapper flex items-center justify-center cursor-pointer',
                isActive && item.type === 'nav' && 'active',
                isLiquidMode && isLiquidHovered && 'z-20'
              )}
              transition={fastSpring}
              onClick={(e) => handleNavigate(e, item.href)}
            >
              {customIcon ? (
                <Image src={getIconSrc(customIcon)} alt={item.label} width={34} height={34} className="dock-item-icon object-contain" />
              ) : (
                <item.icon className="dock-item-icon" style={iconGradientStyle} />
              )}
            </motion.div>
          </TooltipTrigger>
          {!isLiquidMode && !isHovered && (
            <TooltipPrimitive.Portal>
              <TooltipContent
                side="top"
                align="center"
                sideOffset={12}
                className="dock-tooltip"
                style={{ zIndex: 'var(--z-float)' } as React.CSSProperties}
              >
                <p>{item.label}</p>
              </TooltipContent>
            </TooltipPrimitive.Portal>
          )}
        </Tooltip>
      </div>
    );
  }

  // For items without submenus, tooltip on top
  const itemContent = (
    <div
      ref={(el) => { if (onRefSet) onRefSet(el as HTMLDivElement | null); }}
      className="relative flex flex-col items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        animate={!isLiquidMode && isHovered ? { scale: 1.55, y: -8 } : { scale: 1, y: 0 }}
        className={cn(
          'dock-item-wrapper flex items-center justify-center cursor-pointer',
          isActive && item.type === 'nav' && 'active',
          isLiquidMode && isLiquidHovered && 'z-20'
        )}
        transition={fastSpring}
        onClick={(e) => handleNavigate(e, item.href)}
      >
        {customIcon ? (
          <Image src={getIconSrc(customIcon)} alt={item.label} width={34} height={34} className="dock-item-icon object-contain" />
        ) : (
          <item.icon className="dock-item-icon" style={iconGradientStyle} />
        )}
      </motion.div>
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {itemContent}
      </TooltipTrigger>
      {!isLiquidMode && (
        <TooltipPrimitive.Portal>
          <TooltipContent
            side="top"
            align="center"
            sideOffset={12}
            className="dock-tooltip"
            style={{ zIndex: 'var(--z-float)' } as React.CSSProperties}
          >
            <p>{item.label}</p>
          </TooltipContent>
        </TooltipPrimitive.Portal>
      )}
    </Tooltip>
  );
};

// Windows-vari "Başlat" düğmesi — Qore Start menüsünü açar. Marka kimliğini
// koruyan turuncu gradyan kutu + beyaz Qore logosu.
const DockLogo = () => {
  const { toggle, isOpen } = useStartMenu();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          whileHover={{ scale: 1.08, y: -3 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 600, damping: 25 }}
          onClick={toggle}
          aria-label="Başlat"
          aria-expanded={isOpen}
          className={cn(
            'flex items-center justify-center h-11 w-11 cursor-pointer rounded-2xl text-white transition-shadow',
            'bg-gradient-to-br from-[#f99a52] to-[#f06f2c]',
            'shadow-[0_8px_16px_-5px_rgba(240,111,44,0.7),inset_0_1px_1px_rgba(255,255,255,0.4)]',
            isOpen && 'ring-2 ring-orange-300/70'
          )}
        >
          <Image src="/wt.png" alt="Qore" width={24} height={24} className="object-contain" />
        </motion.button>
      </TooltipTrigger>
      <TooltipPrimitive.Portal>
        <TooltipContent side="top" align="center" sideOffset={12} className="dock-tooltip" style={{ zIndex: 'var(--z-float)' } as React.CSSProperties}>
          <p>Başlat</p>
        </TooltipContent>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
};

// Takvim kısayolu — dock'un sağ bölgesinde, basınca takvim panelini açar.
const CalendarDockButton = ({ open, onToggle, customIcon }: { open: boolean; onToggle: () => void; customIcon?: string }) => {
  const calGradient = {
    background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))',
  } as React.CSSProperties;
  return (
    <Tooltip open={open ? false : undefined}>
      <TooltipTrigger asChild>
        <motion.div
          whileHover={{ scale: 1.55, y: -8 }}
          transition={{ type: 'spring', stiffness: 600, damping: 25 }}
          className={cn('dock-item-wrapper flex items-center justify-center cursor-pointer', open && 'active')}
          onClick={onToggle}
          aria-label="Takvim"
          aria-expanded={open}
        >
          {customIcon ? (
            <Image src={getIconSrc(customIcon)} alt="Takvim" width={34} height={34} className="dock-item-icon object-contain" />
          ) : (
            <Calendar className="dock-item-icon" style={calGradient} />
          )}
        </motion.div>
      </TooltipTrigger>
      <TooltipPrimitive.Portal>
        <TooltipContent side="top" align="center" sideOffset={12} className="dock-tooltip" style={{ zIndex: 'var(--z-float)' } as React.CSSProperties}>
          <p>Takvim · Planlama</p>
        </TooltipContent>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
};

export function Dock({ items, currentView, className, setTheme, isVisible }: DockProps) {
  const { dockStyle, currentUserProfile } = useAuth();
  const isLiquidMode = dockStyle === 'liquid';
  const iconData = useIconMappings();
  const dockIcons = iconData?.mappings?.dock || {};

  // Refs for each item to track positions
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const dockRef = useRef<HTMLDivElement>(null);
  const dockContentRef = useRef<HTMLDivElement>(null);

  // Liquid mode state
  const [isMouseInDock, setIsMouseInDock] = useState(false);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const [selectorPosition, setSelectorPosition] = useState({ x: 0, width: 48 });
  const mouseInDockRef = useRef(false);

  // Calendar shortcut (right zone). Close it when navigating to another view.
  const [calendarOpen, setCalendarOpen] = useState(false);
  useEffect(() => { setCalendarOpen(false); }, [currentView]);



  // Auto-fit: shrink the whole dock proportionally if it would overflow the
  // viewport (many panels). offsetWidth is the layout width — unaffected by the
  // transform scale we apply — so it's a stable basis for the ratio.
  const [fitScale, setFitScale] = useState(1);
  const recomputeFit = useCallback(() => {
    const el = dockRef.current;
    if (!el) return;
    const natural = el.offsetWidth;
    const avail = window.innerWidth - 24;
    const next = natural > avail ? Math.max(0.5, avail / natural) : 1;
    setFitScale((prev) => (Math.abs(prev - next) > 0.005 ? next : prev));
  }, []);

  // Track mouse position for liquid selector
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isLiquidMode || !dockContentRef.current) return;

    const contentRect = dockContentRef.current.getBoundingClientRect();
    const mouseX = e.clientX - contentRect.left;

    // Find the closest item to the mouse
    let closestItem: { key: string; centerX: number; width: number } | null = null;
    let closestDistance = Infinity;

    itemRefs.current.forEach((ref, key) => {
      if (ref) {
        const rect = ref.getBoundingClientRect();
        const itemCenterX = rect.left + rect.width / 2 - contentRect.left;
        const distance = Math.abs(mouseX - itemCenterX);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestItem = {
            key,
            centerX: itemCenterX,
            width: rect.width,
          };
        }
      }
    });

    if (closestItem) {
      const selectorWidth = closestItem.width + 12; // Add padding
      const selectorX = closestItem.centerX - selectorWidth / 2; // Center on icon

      setActiveItemKey(closestItem.key);
      setSelectorPosition({ x: selectorX, width: selectorWidth });
    }
  }, [isLiquidMode]);

  const handleMouseEnter = useCallback(() => {
    if (isLiquidMode) {
      mouseInDockRef.current = true;
      setIsMouseInDock(true);
    }
  }, [isLiquidMode]);

  const handleMouseLeave = useCallback(() => {
    if (isLiquidMode) {
      mouseInDockRef.current = false;
      setIsMouseInDock(false);
      setActiveItemKey(null);
    }
  }, [isLiquidMode]);

  // Get ref setter for each item
  const setItemRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(key, el);
    }
  }, []);

  // Logout stays in the dock only for the 'user' role; everyone else uses the
  // Start menu's logout. The theme toggle moved to the Start menu entirely.
  const role = currentUserProfile?.role;
  const showDockLogout = role === 'user';
  const mainItems = items.filter((i) => i.key !== 'logout');
  const logoutItem = items.find((i) => i.key === 'logout');

  // Recompute auto-fit on mount, on resize, and when the item set changes.
  useLayoutEffect(() => { recomputeFit(); }, [recomputeFit, mainItems.length, showDockLogout]);
  useEffect(() => {
    window.addEventListener('resize', recomputeFit);
    return () => window.removeEventListener('resize', recomputeFit);
  }, [recomputeFit]);

  const activeItem = items.find(item => item.key === activeItemKey);

  return (
    <div className={cn(className)}>
      <TooltipProvider delayDuration={150}>
        <motion.div
          ref={dockRef}
          data-qore-dock
          className={cn(
            "relative flex h-[72px] items-center gap-1 px-3 py-2.5 rounded-[24px] transition-shadow duration-300",
            "bg-white/80 backdrop-blur-xl border border-gray-200/60",
            "shadow-[0_2px_12px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]",
            "dark:bg-black/30 dark:backdrop-blur-xl dark:border-white/[0.08]",
            "dark:shadow-[0_4px_24px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.1)]",
            isLiquidMode && isMouseInDock && "[&_*]:!cursor-none !cursor-none"
          )}
          animate={{
            opacity: isVisible ? 1 : 0,
            y: isVisible ? 0 : 20,
            scale: fitScale,
            pointerEvents: isVisible ? 'auto' : 'none',
          }}
          style={{ transformOrigin: 'bottom center' }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          onMouseMove={handleMouseMove}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Content wrapper for position reference */}
          <div ref={dockContentRef} className="relative flex items-center gap-1">
            {/* Liquid Glass Selector */}
            {isLiquidMode && (
              <AnimatePresence>
                {isMouseInDock && activeItemKey && (
                  <LiquidGlassSelector
                    x={selectorPosition.x}
                    width={selectorPosition.width}
                    height={52}
                    isVisible={isMouseInDock}
                    activeLabel={activeItem?.label}
                  />
                )}
              </AnimatePresence>
            )}

            <DockLogo />
            {mainItems.map((item) => (
              <DockItem
                key={item.key}
                item={item}
                isActive={item.key === currentView && item.type === 'nav'}
                setTheme={setTheme}
                isLiquidMode={isLiquidMode}
                isLiquidHovered={isLiquidMode && activeItemKey === item.key}
                onRefSet={(el) => setItemRef(item.key, el)}
                customIcon={dockIcons[item.key]}
              />
            ))}

            <div className="qdock-sep" />
            <CalendarDockButton open={calendarOpen} onToggle={() => setCalendarOpen((o) => !o)} customIcon={dockIcons['calendar']} />
            {showDockLogout && logoutItem && (
              <DockItem
                key={logoutItem.key}
                item={logoutItem}
                isActive={false}
                setTheme={setTheme}
                isLiquidMode={isLiquidMode}
                isLiquidHovered={isLiquidMode && activeItemKey === logoutItem.key}
                onRefSet={(el) => setItemRef(logoutItem.key, el)}
                customIcon={dockIcons[logoutItem.key]}
              />
            )}
          </div>
        </motion.div>
      </TooltipProvider>

      <AnimatePresence>
        {calendarOpen && <CalendarDockPanel key="cal" onClose={() => setCalendarOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
