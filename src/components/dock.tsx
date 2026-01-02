
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronRight } from 'lucide-react';
import NotificationsBell from '@/components/notifications/NotificationsBell';
import type { DockItemData } from '@/hooks/use-dock';
import { useAuth } from '@/contexts/auth-context';
import { useAI } from '@/contexts/ai-context';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ThemeToggleDock } from "@/components/ui/theme-toggle-dock"
import { useTheme } from 'next-themes';
import Image from 'next/image';

interface DockProps {
  items: DockItemData[];
  currentView: string;
  className?: string;
  setTheme: (theme: string) => void;
  isVisible: boolean;
}

// Liquid Glass Selector Component - Apple Style
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
  const springConfig = { damping: 22, stiffness: 180, mass: 0.6 };
  const springX = useSpring(x, springConfig);
  const springWidth = useSpring(width, springConfig);

  useEffect(() => {
    springX.set(x);
    springWidth.set(width);
  }, [x, width, springX, springWidth]);

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
        borderRadius: '9999px',
        overflow: 'visible',
      }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {/* Main Glass Container - all effects contained within pill shape */}
      <div
        className="relative w-full h-full"
        style={{
          borderRadius: '9999px',
          overflow: 'hidden',
          // Outer shadow using filter to keep pill shape
          filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.15)) drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
        }}
      >
        {/* Glass body - main structure */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '9999px',
            background: `
              linear-gradient(
                180deg,
                rgba(255, 255, 255, 0.3) 0%,
                rgba(255, 255, 255, 0.08) 40%,
                rgba(255, 255, 255, 0.15) 100%
              )
            `,
            backdropFilter: 'blur(16px) saturate(180%) contrast(1.05)',
            WebkitBackdropFilter: 'blur(16px) saturate(180%) contrast(1.05)',
          }}
        />

        {/* Top highlight - 3D rim light */}
        <div
          className="absolute inset-x-[8%] top-[1px] h-[45%]"
          style={{
            borderRadius: '9999px',
            background: `
              linear-gradient(
                180deg,
                rgba(255, 255, 255, 0.7) 0%,
                rgba(255, 255, 255, 0.25) 50%,
                transparent 100%
              )
            `,
          }}
        />

        {/* Edge refraction - LEFT */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[5px]"
          style={{
            background: `
              linear-gradient(
                90deg,
                rgba(255, 255, 255, 0.8) 0%,
                rgba(255, 255, 255, 0.2) 70%,
                transparent 100%
              )
            `,
          }}
        />

        {/* Edge refraction - RIGHT */}
        <div
          className="absolute right-0 top-0 bottom-0 w-[5px]"
          style={{
            background: `
              linear-gradient(
                -90deg,
                rgba(255, 255, 255, 0.6) 0%,
                rgba(255, 255, 255, 0.15) 70%,
                transparent 100%
              )
            `,
          }}
        />

        {/* Inner border glow */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '9999px',
            border: '1px solid rgba(255, 255, 255, 0.6)',
          }}
        />

        {/* Specular highlight - top left corner */}
        <div
          className="absolute top-[10%] left-[6%] w-[18%] h-[40%]"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.9) 0%, transparent 70%)',
            borderRadius: '50%',
          }}
        />
      </div>

      {/* Active label below selector */}
      <AnimatePresence>
        {activeLabel && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1, ease: "easeOut" }}
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
}: {
  item: DockItemData;
  isActive: boolean;
  setTheme: (theme: string) => void;
  isLiquidMode?: boolean;
  isLiquidHovered?: boolean;
  onRefSet?: (el: HTMLDivElement | null) => void;
}) => {

  const { isOrbAnimationEnabled, toggleOrbAnimation, toggleNavMode, navMode } = useAuth();
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<string | null>(null);
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const subMenuTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleNavigate = (e: React.MouseEvent, path?: string) => {
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
        />
      </div>
    );
  }

  // The original theme button is removed from use-dock.ts now.
  // This logic is preserved in case it's needed elsewhere but won't be triggered by the dock items.
  if (item.key === 'theme') {
    return <ThemeToggleDock />;
  }

  const hasSubItems = item.subItems && item.subItems.length > 0;

  // For items with submenus, use a different structure
  // Tooltip wraps only the icon, not the submenu
  if (hasSubItems) {
    return (
      <div
        className="relative flex flex-col items-center"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Submenu positioned above the icon - OUTSIDE tooltip */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full mb-1 flex flex-col items-start gap-1 p-1.5 rounded-lg bg-popover border border-border shadow-lg min-w-[160px] z-50"
            >
              {/* Invisible bridge to prevent gap between submenu and icon */}
              <div className="absolute -bottom-2 left-0 right-0 h-3" />
              {item.subItems!.map(sub => (
                <div
                  key={sub.key}
                  className="relative w-full"
                  onMouseEnter={() => handleSubMenuEnter(sub.key)}
                  onMouseLeave={handleSubMenuLeave}
                >
                  <motion.div
                    whileHover={{ scale: 1.02, x: 2 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-auto py-1.5 rounded-md w-full justify-start px-2 text-sm hover:bg-accent/80"
                      onClick={(e) => handleNavigate(e, sub.href)}
                    >
                      <sub.icon className="w-4 h-4 mr-2 flex-shrink-0" />
                      <span className="truncate">{sub.label}</span>
                      {sub.subItems && <ChevronRight className="w-4 h-4 ml-auto flex-shrink-0" />}
                    </Button>
                  </motion.div>
                  {/* Nested Sub-Menu */}
                  <AnimatePresence>
                  {activeSubMenu === sub.key && sub.subItems && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-full top-0 ml-1 flex flex-col items-start gap-1 p-1.5 rounded-lg bg-popover border border-border shadow-lg min-w-[160px] z-50"
                    >
                      {/* Invisible bridge for nested menu */}
                      <div className="absolute -left-2 top-0 bottom-0 w-3" />
                      {sub.subItems.map(nestedSub => (
                        <motion.div
                          key={nestedSub.key}
                          whileHover={{ scale: 1.02, x: 2 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                          className="w-full"
                        >
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-auto py-1.5 rounded-md w-full justify-start px-2 text-sm hover:bg-accent/80"
                            onClick={(e) => handleNavigate(e, nestedSub.href)}
                          >
                            <nestedSub.icon className="w-4 h-4 mr-2 flex-shrink-0" />
                            <span className="truncate">{nestedSub.label}</span>
                          </Button>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                  </AnimatePresence>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tooltip wraps ONLY the icon */}
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.div
              ref={onRefSet}
              animate={!isLiquidMode && isHovered ? { scale: 1.2, y: -8 } : { scale: 1, y: 0 }}
              className={cn(
                'dock-item-wrapper flex items-center justify-center cursor-pointer',
                isActive && item.type === 'nav' && 'active',
                isLiquidMode && isLiquidHovered && 'z-20'
              )}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              onClick={(e) => handleNavigate(e, item.href)}
            >
              <item.icon className={cn("dock-item-icon", item.key === 'logout' && 'text-destructive')} />
            </motion.div>
          </TooltipTrigger>
          {!isLiquidMode && (
            <TooltipContent side="bottom" align="center" sideOffset={35} avoidCollisions={false} className="glass-card z-[100]">
              <p>{item.label}</p>
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    );
  }

  // For items without submenus, tooltip on top
  const itemContent = (
    <div
      ref={onRefSet}
      className="relative flex flex-col items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        animate={!isLiquidMode && isHovered ? { scale: 1.2, y: -8 } : { scale: 1, y: 0 }}
        className={cn(
          'dock-item-wrapper flex items-center justify-center cursor-pointer',
          isActive && item.type === 'nav' && 'active',
          isLiquidMode && isLiquidHovered && 'z-20'
        )}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        onClick={(e) => handleNavigate(e, item.href)}
      >
        <item.icon className={cn("dock-item-icon", item.key === 'logout' && 'text-destructive')} />
      </motion.div>
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {itemContent}
      </TooltipTrigger>
      {!isLiquidMode && (
        <TooltipContent side="top" align="center" className="mb-2 glass-card">
          <p>{item.label}</p>
        </TooltipContent>
      )}
    </Tooltip>
  );
};

const DockLogo = () => {
  const { resolvedTheme } = useTheme();
  const { openAI } = useAI();
  const [logoSrc, setLogoSrc] = useState('/wt.png');

  useEffect(() => {
    setLogoSrc(resolvedTheme === 'light' ? '/blk.png' : '/wt.png');
  }, [resolvedTheme]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          whileHover={{ scale: 1.15, y: -4 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 10 }}
          onClick={openAI}
          className="flex items-center justify-center h-10 w-10 px-2 cursor-pointer rounded-full hover:bg-white/10 transition-colors"
        >
          <Image src={logoSrc} alt="Qore AI" width={28} height={28} className="object-contain" />
        </motion.button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="mb-2 glass-card">
        <p>Qore AI</p>
      </TooltipContent>
    </Tooltip>
  );
};

export function Dock({ items, currentView, className, setTheme, isVisible }: DockProps) {
  const { dockStyle } = useAuth();
  const isLiquidMode = dockStyle === 'liquid';

  // Refs for each item to track positions
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const dockRef = useRef<HTMLDivElement>(null);
  const dockContentRef = useRef<HTMLDivElement>(null);

  // Liquid mode state
  const [isMouseInDock, setIsMouseInDock] = useState(false);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const [selectorPosition, setSelectorPosition] = useState({ x: 0, width: 48 });
  const mouseInDockRef = useRef(false);

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

  const activeItem = items.find(item => item.key === activeItemKey);

  return (
    <div className={cn(className)}>
      <TooltipProvider delayDuration={150}>
        <motion.div
          ref={dockRef}
          className={cn(
            "relative flex h-14 items-center gap-3 p-3 rounded-full transition-shadow duration-300",
            "bg-[#e0e0e0] shadow-[9px_9px_18px_#bebebe,-9px_-9px_18px_#ffffff]",
            "dark:bg-black/20 dark:shadow-[0_4px_30px_rgba(0,0,0,0.1)] dark:border dark:border-white/10 dark:backdrop-blur-md",
            isLiquidMode && isMouseInDock && "[&_*]:!cursor-none !cursor-none"
          )}
          animate={{
            opacity: isVisible ? 1 : 0,
            y: isVisible ? 0 : 20,
            pointerEvents: isVisible ? 'auto' : 'none',
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          onMouseMove={handleMouseMove}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Content wrapper for position reference */}
          <div ref={dockContentRef} className="relative flex items-center gap-3">
            {/* Liquid Glass Selector */}
            {isLiquidMode && (
              <AnimatePresence>
                {isMouseInDock && activeItemKey && (
                  <LiquidGlassSelector
                    x={selectorPosition.x}
                    width={selectorPosition.width}
                    height={44}
                    isVisible={isMouseInDock}
                    activeLabel={activeItem?.label}
                  />
                )}
              </AnimatePresence>
            )}

            <DockLogo />
            {items.map((item) => (
              <DockItem
                key={item.key}
                item={item}
                isActive={item.key === currentView && item.type === 'nav'}
                setTheme={setTheme}
                isLiquidMode={isLiquidMode}
                isLiquidHovered={isLiquidMode && activeItemKey === item.key}
                onRefSet={(el) => setItemRef(item.key, el)}
              />
            ))}
          </div>
          <div className="mx-2">
            <ThemeToggleDock />
          </div>
        </motion.div>
      </TooltipProvider>
    </div>
  );
}
