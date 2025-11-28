
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  motion, 
  AnimatePresence, 
  useMotionValue, 
  useTransform, 
  PanInfo, 
  animate 
} from "framer-motion";
import { 
  ChevronRight, X 
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import type { DockItemData } from '@/hooks/use-dock';

const ITEM_HEIGHT = 60; // Each row's height

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

const triggerHaptic = () => {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

// --- COMPONENTS ---

export default function MobileDock({ items }: { items: DockItemData[] }) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === 'dark' || theme === 'qore-dark';

  if (!isMobile) return null;

  const menuItems = items.filter(item => item.type === 'nav');

  return (
    <>
      <div className="h-24 pointer-events-none" />

      {/* Floating Trigger Button (Logo) */}
      <div className="fixed bottom-8 left-0 right-0 z-40 flex justify-center pointer-events-none">
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              initial={{ scale: 0, y: 50 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0, y: 50 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                triggerHaptic();
                setIsOpen(true);
              }}
              className={cn(
                "pointer-events-auto w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all",
                isDark ? "bg-black border border-white/20" : "bg-white border border-slate-200"
              )}
            >
              <img 
                src="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG" 
                alt="Qore" 
                className="w-10 h-10 object-contain"
              />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Fullscreen Overlay & Scroll Wheel */}
      <AnimatePresence>
        {isOpen && (
          <WheelOverlay 
            items={menuItems} 
            onClose={() => setIsOpen(false)} 
            isDark={isDark} 
          />
        )}
      </AnimatePresence>
    </>
  );
}

// --- The Main Wheel Overlay Component ---
function WheelOverlay({ items, onClose, isDark }: { items: any[], onClose: () => void, isDark: boolean }) {
  const router = useRouter();
  
  // Y-axis motion value for the scrollable list
  const y = useMotionValue(0);
  
  // Snap-to-item logic on pan end
  const onPanEnd = (e: any, info: PanInfo) => {
    const currentY = y.get();
    const velocity = info.velocity.y * 0.2; // Velocity factor
    const targetY = currentY + velocity;
    
    // Round to the nearest item index
    const snapIndex = Math.round(targetY / ITEM_HEIGHT);
    
    // Clamp the index within the list bounds
    const maxIndex = 0;
    const minIndex = -(items.length - 1);
    const clampedIndex = Math.max(minIndex, Math.min(maxIndex, snapIndex));
    
    const finalY = clampedIndex * ITEM_HEIGHT;

    // Animate to the final snapped position
    animate(y, finalY, {
      type: "spring",
      stiffness: 200,
      damping: 30,
      onComplete: triggerHaptic
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-end bg-black/90 backdrop-blur-md"
    >
      {/* Clickable area to close the overlay */}
      <div className="flex-1 w-full" onClick={onClose} />

      {/* Wheel container */}
      <div className="relative w-full h-[350px] overflow-hidden flex flex-col items-center justify-center bg-gradient-to-b from-transparent via-black/20 to-transparent">
        
        {/* Selection Indicator Arrow */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex items-center pointer-events-none">
            <ChevronRight className={cn("w-8 h-8 animate-pulse", isDark ? "text-cyan-400" : "text-white")} />
        </div>
        
        {/* Center Highlight Bar */}
        <div className={cn(
            "absolute w-full h-[60px] top-1/2 -translate-y-1/2 z-0 pointer-events-none border-t border-b",
            isDark ? "border-white/10 bg-white/5" : "border-white/20 bg-white/10"
        )} />

        {/* Scrollable List */}
        <motion.div
          className="cursor-grab active:cursor-grabbing touch-none z-10 py-[145px]" // Padding = (ContainerHeight - ItemHeight) / 2
          style={{ y }}
          onPan={(e, info) => y.set(y.get() + info.delta.y)}
          onPanEnd={onPanEnd}
        >
          {items.map((item, index) => (
            <WheelItem 
              key={item.id} 
              item={item} 
              index={index} 
              y={y} 
              isDark={isDark}
              onSelect={() => {
                triggerHaptic();
                onClose(); 
                if (item.path) router.push(item.path);
              }}
            />
          ))}
        </motion.div>

      </div>

      {/* Bottom Action Buttons */}
      <div className="w-full pb-10 pt-4 flex flex-col items-center gap-4 bg-black">
         <p className="text-xs text-white/40 font-medium tracking-widest uppercase">
            Paneli Seçmek İçin Kaydır
         </p>
         
         <button 
            onClick={onClose}
            className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/20 transition-all"
         >
            <X size={20} />
         </button>
      </div>
    </motion.div>
  );
}

// --- Individual Wheel Item ---
function WheelItem({ item, index, y, isDark, onSelect }: any) {
  const myOffset = index * ITEM_HEIGHT;
  
  // Calculate distance from the center (where y = -myOffset)
  const distance = useTransform(y, (currentY: number) => {
    return Math.abs(currentY + myOffset);
  });

  // Transform properties based on distance from center
  const scale = useTransform(distance, [0, ITEM_HEIGHT * 2], [1.3, 0.7]);
  const opacity = useTransform(distance, [0, ITEM_HEIGHT * 2], [1, 0.3]);
  const color = useTransform(distance, [0, 50], [
      isDark ? "#22d3ee" : "#ffffff", // Center Color (Cyan / White)
      "#64748b" // Off-center Color (Gray)
  ]);
  const fontWeight = useTransform(distance, [0, 50], [700, 400]);

  return (
    <motion.div
      style={{ 
        height: ITEM_HEIGHT,
        scale,
        opacity,
      }}
      className="flex items-center justify-center w-screen"
    >
      <motion.button
        onClick={onSelect}
        style={{ color, fontWeight }}
        className="text-2xl tracking-wide transition-colors"
      >
        {item.label}
      </motion.button>
    </motion.div>
  );
}
