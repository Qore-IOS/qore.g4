
"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronRight } from 'lucide-react';
import NotificationsBell from '@/components/notifications/NotificationsBell';
import type { DockItemData } from '@/hooks/use-dock';
import { useAuth } from '@/contexts/auth-context';
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

const DockItem = ({
  item,
  isActive,
  setTheme,
}: {
  item: DockItemData;
  isActive: boolean;
  setTheme: (theme: string) => void;
}) => {
    
  const { isOrbAnimationEnabled, toggleOrbAnimation, toggleNavMode, navMode } = useAuth();
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<string | null>(null);

  const handleNavigate = (e: React.MouseEvent, path?: string) => {
    if (path) {
      e.stopPropagation();
      router.push(path);
    } else if (item.onClick) {
      item.onClick();
    }
  };
    
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
  
  const itemContent = (
    <motion.div
      whileHover={{ scale: 1.2, y: -8 }}
      className={cn(
        'dock-item-wrapper flex items-center justify-center', 
        isActive && item.type === 'nav' && 'active'
      )}
      transition={{ type: 'spring', stiffness: 400, damping: 10 }}
      onClick={(e) => handleNavigate(e, item.href)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setActiveSubMenu(null); }}
    >
      <AnimatePresence>
        {isHovered && item.subItems && item.subItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-full mb-2 flex flex-col items-start gap-1 p-1 rounded-lg bg-popover border border-border shadow-lg"
            onMouseEnter={() => setIsHovered(true)} 
            onMouseLeave={() => { setIsHovered(false); setActiveSubMenu(null); }}
          >
            {item.subItems.map(sub => (
              <div key={sub.key} className="relative" onMouseEnter={() => setActiveSubMenu(sub.key)} onMouseLeave={() => setActiveSubMenu(null)}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto py-1 rounded-md w-full justify-start px-2"
                  onClick={(e) => handleNavigate(e, sub.href)}
                >
                  <sub.icon className="w-4 h-4 mr-2" />
                  {sub.label}
                  {sub.subItems && <ChevronRight className="w-4 h-4 ml-auto" />}
                </Button>
                {/* Nested Sub-Menu */}
                <AnimatePresence>
                {activeSubMenu === sub.key && sub.subItems && (
                  <motion.div
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="absolute left-full bottom-0 mb-1 flex flex-col items-start gap-1 p-1 rounded-lg bg-popover border border-border"
                  >
                    {sub.subItems.map(nestedSub => (
                      <Button
                        key={nestedSub.key}
                        size="sm"
                        variant="ghost"
                        className="h-auto py-1 rounded-md w-full justify-start px-2"
                        onClick={(e) => handleNavigate(e, nestedSub.href)}
                      >
                        <nestedSub.icon className="w-4 h-4 mr-2" />
                        {nestedSub.label}
                      </Button>
                    ))}
                  </motion.div>
                )}
                </AnimatePresence>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <item.icon className={cn("dock-item-icon", item.key === 'logout' && 'text-destructive')} />
    </motion.div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {itemContent}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="mb-2 glass-card">
        <p>{item.label}</p>
      </TooltipContent>
    </Tooltip>
  );
};

const DockLogo = () => {
  const { resolvedTheme } = useTheme();
  const [logoSrc, setLogoSrc] = useState('/wt.png');

  useEffect(() => {
    setLogoSrc(resolvedTheme === 'light' ? '/blk.png' : '/wt.png');
  }, [resolvedTheme]);

  return (
    <div className="flex items-center justify-center h-10 w-10 px-2">
      <Image src={logoSrc} alt="Logo" width={28} height={28} className="object-contain" />
    </div>
  );
};

export function Dock({ items, currentView, className, setTheme, isVisible }: DockProps) {
  return (
    <div className={cn(className)}>
      <TooltipProvider delayDuration={150}>
        <motion.div
          className="flex h-14 items-center gap-3 p-3 rounded-full transition-shadow duration-300
                     bg-[#e0e0e0] shadow-[9px_9px_18px_#bebebe,-9px_-9px_18px_#ffffff]
                     dark:bg-black/20 dark:shadow-[0_4px_30px_rgba(0,0,0,0.1)] dark:border dark:border-white/10 dark:backdrop-blur-md"
          animate={{
            opacity: isVisible ? 1 : 0,
            y: isVisible ? 0 : 20,
            pointerEvents: isVisible ? 'auto' : 'none',
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        >
          <DockLogo />
          {items.map((item) => (
            <DockItem
              key={item.key}
              item={item}
              isActive={item.key === currentView && item.type === 'nav'}
              setTheme={setTheme}
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
