
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
  const springConfig = { damping: 20, stiffness: 200, mass: 0.8 };
  const springX = useSpring(x, springConfig);
  const springWidth = useSpring(width, springConfig);

  useEffect(() => {
    springX.set(x);
    springWidth.set(width);
  }, [x, width, springX, springWidth]);

  if (!isVisible) return null;

  return (
    <motion.div
      className="absolute pointer-events-none z-10"
      style={{
        x: springX,
        width: springWidth,
        height: height + 20,
        top: -10,
      }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      {/* SVG Filter for Lensing Effect */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <filter id="liquid-glass-filter" x="-50%" y="-50%" width="200%" height="200%">
            {/* Turbulence for subtle distortion */}
            <feTurbulence type="fractalNoise" baseFrequency="0.01" numOctaves="1" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
          </filter>

          {/* Glow filter */}
          <filter id="liquid-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
      </svg>

      {/* Main Glass Container */}
      <div
        className="relative w-full h-full"
        style={{
          borderRadius: '9999px',
          transform: 'perspective(500px) rotateX(2deg)',
        }}
      >
        {/* Bottom shadow - creates floating effect */}
        <div
          className="absolute inset-x-2 -bottom-2 h-4"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, transparent 70%)',
            filter: 'blur(4px)',
            borderRadius: '50%',
          }}
        />

        {/* Glass body - main structure */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            borderRadius: '9999px',
            background: `
              linear-gradient(
                180deg,
                rgba(255, 255, 255, 0.25) 0%,
                rgba(255, 255, 255, 0.08) 50%,
                rgba(255, 255, 255, 0.15) 100%
              )
            `,
            backdropFilter: 'blur(20px) saturate(180%) brightness(1.1)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%) brightness(1.1)',
          }}
        />

        {/* Top highlight - 3D rim light */}
        <div
          className="absolute inset-x-0 top-0 h-[45%] overflow-hidden"
          style={{
            borderRadius: '9999px 9999px 50% 50%',
            background: `
              linear-gradient(
                180deg,
                rgba(255, 255, 255, 0.6) 0%,
                rgba(255, 255, 255, 0.3) 40%,
                transparent 100%
              )
            `,
          }}
        />

        {/* Left edge refraction */}
        <div
          className="absolute left-0 top-[10%] bottom-[10%] w-[3px]"
          style={{
            background: `
              linear-gradient(
                180deg,
                transparent 0%,
                rgba(255, 255, 255, 0.8) 20%,
                rgba(255, 255, 255, 0.9) 50%,
                rgba(255, 255, 255, 0.8) 80%,
                transparent 100%
              )
            `,
            filter: 'blur(1px)',
            borderRadius: '9999px',
          }}
        />

        {/* Right edge refraction */}
        <div
          className="absolute right-0 top-[10%] bottom-[10%] w-[3px]"
          style={{
            background: `
              linear-gradient(
                180deg,
                transparent 0%,
                rgba(255, 255, 255, 0.5) 20%,
                rgba(255, 255, 255, 0.6) 50%,
                rgba(255, 255, 255, 0.5) 80%,
                transparent 100%
              )
            `,
            filter: 'blur(1px)',
            borderRadius: '9999px',
          }}
        />

        {/* Inner depth shadow */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '9999px',
            boxShadow: `
              inset 0 -8px 16px rgba(0, 0, 0, 0.06),
              inset 0 2px 4px rgba(255, 255, 255, 0.4)
            `,
          }}
        />

        {/* Outer glass border - creates thickness illusion */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '9999px',
            border: '1.5px solid rgba(255, 255, 255, 0.5)',
            boxShadow: `
              0 8px 32px rgba(0, 0, 0, 0.12),
              0 4px 16px rgba(0, 0, 0, 0.08),
              0 2px 8px rgba(0, 0, 0, 0.04)
            `,
          }}
        />

        {/* Specular highlight - top left */}
        <div
          className="absolute top-[15%] left-[10%] w-[30%] h-[25%]"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.7) 0%, transparent 70%)',
            filter: 'blur(2px)',
            borderRadius: '50%',
          }}
        />
      </div>

      {/* Active label below selector */}
      <AnimatePresence>
        {activeLabel && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.9 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap"
          >
            <span className="text-xs font-medium text-foreground bg-background/90 backdrop-blur-md px-3 py-1 rounded-full shadow-lg border border-white/20">
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

  // Liquid mode state
  const [isMouseInDock, setIsMouseInDock] = useState(false);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const [selectorPosition, setSelectorPosition] = useState({ x: 0, width: 48 });

  // Track mouse position for liquid selector
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isLiquidMode || !dockRef.current) return;

    const dockRect = dockRef.current.getBoundingClientRect();
    const mouseX = e.clientX - dockRect.left;

    // Find the closest item to the mouse
    let closestItem: { key: string; x: number; width: number } | null = null;
    let closestDistance = Infinity;

    itemRefs.current.forEach((ref, key) => {
      if (ref) {
        const rect = ref.getBoundingClientRect();
        const itemCenterX = rect.left + rect.width / 2 - dockRect.left;
        const distance = Math.abs(mouseX - itemCenterX);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestItem = {
            key,
            x: rect.left - dockRect.left - 8, // Offset for padding
            width: rect.width + 16, // Add padding to selector
          };
        }
      }
    });

    if (closestItem) {
      setActiveItemKey(closestItem.key);
      setSelectorPosition({ x: closestItem.x, width: closestItem.width });
    }
  }, [isLiquidMode]);

  const handleMouseEnter = useCallback(() => {
    if (isLiquidMode) {
      setIsMouseInDock(true);
    }
  }, [isLiquidMode]);

  const handleMouseLeave = useCallback(() => {
    if (isLiquidMode) {
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
            isLiquidMode && isMouseInDock && "cursor-none"
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
          {/* Liquid Glass Selector */}
          {isLiquidMode && (
            <AnimatePresence>
              {isMouseInDock && (
                <LiquidGlassSelector
                  x={selectorPosition.x}
                  width={selectorPosition.width}
                  height={40}
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
          <div className="mx-2">
            <ThemeToggleDock />
          </div>
        </motion.div>
      </TooltipProvider>
    </div>
  );
}
