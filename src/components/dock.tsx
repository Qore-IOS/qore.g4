
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
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feComposite in="SourceGraphic" in2="blur" operator="over"/>
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
              style={{
                maxHeight: 'calc(100vh - 120px)',
                bottom: '100%',
                marginBottom: '4px'
              }}
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
                      style={{
                        maxHeight: 'calc(100vh - 120px)'
                      }}
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
              animate={!isLiquidMode && isHovered ? { scale: 1.1 } : { scale: 1 }}
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
            <TooltipContent
              side="bottom"
              align="center"
              sideOffset={20}
              collisionPadding={0}
              avoidCollisions={false}
              className="glass-card z-[100]"
            >
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
