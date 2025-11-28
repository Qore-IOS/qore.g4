
'use client';
import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AppView } from '@/lib/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface NavItemProps {
  view: AppView;
  label: string;
  currentView: AppView;
  IconComponent?: React.ElementType;
  className?: string;
  isMobileNavItem?: boolean;
  href: string;
  onClick?: () => void;
  subItems?: NavItemProps[]; // Add subItems to the props
}

export function NavItem({ view, label, currentView, IconComponent, className, isMobileNavItem = false, href, onClick, subItems }: NavItemProps) {
  const isActive = currentView === view;

  const content = (
    <>
      {IconComponent && <IconComponent className={cn(isMobileNavItem ? "h-5 w-5 mr-3 flex-shrink-0" : "h-6 w-6")} />}
      {isMobileNavItem ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </>
  );

  const buttonClass = isMobileNavItem
    ? cn(
        "w-full text-left h-12 justify-start text-base font-medium py-3 rounded-xl",
        isActive ? "shadow-primary/30" : "text-foreground",
        className
      )
    : cn(
        "p-0 rounded-full transition-all duration-200 ease-out hover:scale-110 h-10 w-10",
        isActive && "bg-primary/80 text-primary-foreground scale-110",
        "shadow-[0_0_8px_hsl(var(--primary)_/_0.0)]",
        isActive && "shadow-[0_0_12px_hsl(var(--primary)_/_0.6)]",
        "hover:shadow-[0_0_12px_hsl(var(--primary)_/_0.4)]",
        className
      );

  if (isMobileNavItem) {
    return (
      <Link href={href} passHref legacyBehavior>
        <Button
          as="a"
          variant={isActive ? 'default' : 'ghost'}
          className={buttonClass}
          onClick={onClick}
        >
          {content}
        </Button>
      </Link>
    );
  }

  // Desktop Dock: Icon only, label in tooltip
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
            asChild
            variant={'ghost'}
            className={buttonClass}
            onClick={onClick}
        >
            <Link href={href} passHref>
                {content}
            </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="mb-2 glass-card">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
