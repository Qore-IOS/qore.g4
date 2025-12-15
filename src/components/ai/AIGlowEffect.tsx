'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AIGlowEffectProps {
  isActive: boolean;
  children?: React.ReactNode;
}

export function AIGlowEffect({ isActive, children }: AIGlowEffectProps) {
  return (
    <>
      <AnimatePresence>
        {isActive && (
          <>
            {/* Top edge glow */}
            <motion.div
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{
                opacity: [0, 1, 0.8, 1],
                scaleX: 1,
              }}
              exit={{ opacity: 0, scaleX: 0 }}
              transition={{
                duration: 0.6,
                ease: "easeOut",
                opacity: { duration: 1.5, repeat: Infinity, repeatType: "reverse" }
              }}
              className="fixed top-0 left-0 right-0 h-[3px] z-[60] pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent, #a855f7, #3b82f6, #06b6d4, #3b82f6, #a855f7, transparent)',
                boxShadow: '0 0 20px 5px rgba(168, 85, 247, 0.5), 0 0 40px 10px rgba(59, 130, 246, 0.3)',
                filter: 'blur(1px)',
              }}
            />

            {/* Bottom edge glow */}
            <motion.div
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{
                opacity: [0, 1, 0.8, 1],
                scaleX: 1,
              }}
              exit={{ opacity: 0, scaleX: 0 }}
              transition={{
                duration: 0.6,
                ease: "easeOut",
                delay: 0.1,
                opacity: { duration: 1.5, repeat: Infinity, repeatType: "reverse", delay: 0.5 }
              }}
              className="fixed bottom-0 left-0 right-0 h-[3px] z-[60] pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent, #06b6d4, #3b82f6, #a855f7, #3b82f6, #06b6d4, transparent)',
                boxShadow: '0 0 20px 5px rgba(6, 182, 212, 0.5), 0 0 40px 10px rgba(59, 130, 246, 0.3)',
                filter: 'blur(1px)',
              }}
            />

            {/* Left edge glow */}
            <motion.div
              initial={{ opacity: 0, scaleY: 0 }}
              animate={{
                opacity: [0, 1, 0.8, 1],
                scaleY: 1,
              }}
              exit={{ opacity: 0, scaleY: 0 }}
              transition={{
                duration: 0.6,
                ease: "easeOut",
                delay: 0.15,
                opacity: { duration: 1.5, repeat: Infinity, repeatType: "reverse", delay: 0.25 }
              }}
              className="fixed top-0 bottom-0 left-0 w-[3px] z-[60] pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, transparent, #a855f7, #3b82f6, #06b6d4, #3b82f6, #a855f7, transparent)',
                boxShadow: '0 0 20px 5px rgba(168, 85, 247, 0.5), 0 0 40px 10px rgba(59, 130, 246, 0.3)',
                filter: 'blur(1px)',
              }}
            />

            {/* Right edge glow */}
            <motion.div
              initial={{ opacity: 0, scaleY: 0 }}
              animate={{
                opacity: [0, 1, 0.8, 1],
                scaleY: 1,
              }}
              exit={{ opacity: 0, scaleY: 0 }}
              transition={{
                duration: 0.6,
                ease: "easeOut",
                delay: 0.2,
                opacity: { duration: 1.5, repeat: Infinity, repeatType: "reverse", delay: 0.75 }
              }}
              className="fixed top-0 bottom-0 right-0 w-[3px] z-[60] pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, transparent, #06b6d4, #3b82f6, #a855f7, #3b82f6, #06b6d4, transparent)',
                boxShadow: '0 0 20px 5px rgba(6, 182, 212, 0.5), 0 0 40px 10px rgba(59, 130, 246, 0.3)',
                filter: 'blur(1px)',
              }}
            />

            {/* Corner accents - Top Left */}
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="fixed top-0 left-0 w-16 h-16 z-[60] pointer-events-none"
              style={{
                background: 'radial-gradient(circle at top left, rgba(168, 85, 247, 0.6), transparent 70%)',
                filter: 'blur(8px)',
              }}
            />

            {/* Corner accents - Top Right */}
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ duration: 0.4, delay: 0.35 }}
              className="fixed top-0 right-0 w-16 h-16 z-[60] pointer-events-none"
              style={{
                background: 'radial-gradient(circle at top right, rgba(59, 130, 246, 0.6), transparent 70%)',
                filter: 'blur(8px)',
              }}
            />

            {/* Corner accents - Bottom Left */}
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
              className="fixed bottom-0 left-0 w-16 h-16 z-[60] pointer-events-none"
              style={{
                background: 'radial-gradient(circle at bottom left, rgba(6, 182, 212, 0.6), transparent 70%)',
                filter: 'blur(8px)',
              }}
            />

            {/* Corner accents - Bottom Right */}
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ duration: 0.4, delay: 0.45 }}
              className="fixed bottom-0 right-0 w-16 h-16 z-[60] pointer-events-none"
              style={{
                background: 'radial-gradient(circle at bottom right, rgba(168, 85, 247, 0.6), transparent 70%)',
                filter: 'blur(8px)',
              }}
            />
          </>
        )}
      </AnimatePresence>
      {children}
    </>
  );
}
