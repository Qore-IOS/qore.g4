'use client';

import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

interface LiquidGlassProps extends HTMLMotionProps<'div'> {
  /** When true, applies the “active” style */
  active?: boolean;
}

/**
 * Renders a rounded, blurred, translucent container with animated
 * background and shadow transitions for active/inactive states.
 */
export const LiquidGlass: React.FC<LiquidGlassProps> = ({
  active = false,
  className,
  children,
  ...props
}) => (
  <motion.div
    {...props}
    initial={false}
    animate={{
      backgroundColor: active ? 'hsla(var(--primary), 0.25)' : 'rgba(255,255,255,0.05)',
      boxShadow: active
        ? '0 6px 20px hsla(var(--primary), 0.3)'
        : '0 4px 16px rgba(0, 0, 0, 0.1)',
      ...props.animate
    }}
    whileHover={{
        backgroundColor: active ? 'hsla(var(--primary), 0.3)' : 'rgba(255,255,255,0.1)',
        boxShadow: active ? '0 8px 24px hsla(var(--primary), 0.35)' : '0 6px 20px rgba(0, 0, 0, 0.15)',
    }}
    transition={{ duration: 0.3, ease: 'easeInOut' }}
    className={cn(
      'relative overflow-hidden rounded-xl border border-white/10 backdrop-blur-lg',
      'shadow-lg',
      className
    )}
  >
    {children}
    {/* subtle inner border highlight */}
    <div className="pointer-events-none absolute inset-0 rounded-xl border border-white/10" />
  </motion.div>
);
