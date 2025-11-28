"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  motion, 
  AnimatePresence 
} from "framer-motion";
import { 
  X,
  LayoutGrid, Box, ClipboardList, ScanLine, Truck, BarChart3, History, Settings
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import type { DockItemData } from '@/hooks/use-dock';

// --- CONFIG ---

// CSS'teki renk sırası (nth-child mantığı)
const BG_COLORS = [
  "#0470fe", // Mavi
  "#ff7675", // Kırmızımsı
  "#1582fe", // Açık Mavi
  "#a29bfe", // Mor
  "#fd79a8", // Pembe
  "#ffeaa7", // Sarı
];


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

      {/* FIXED TRIGGER BUTTON (LOGO) */}
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
                "pointer-events-auto w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all z-50",
                isDark ? "bg-black border border-white/20" : "bg-white border border-slate-200"
              )}
            >
              <img 
                src="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG" 
                alt="Qore" 
                className="w-12 h-12 object-contain"
              />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* FULL SCREEN MENU */}
      <AnimatePresence>
        {isOpen && (
          <FullScreenMenu 
            items={menuItems} 
            onClose={() => setIsOpen(false)} 
            isDark={isDark} 
          />
        )}
      </AnimatePresence>
    </>
  );
}

// --- MENU IMPLEMENTATION ---

function FullScreenMenu({ items, onClose, isDark }: { items: any[], onClose: () => void, isDark: boolean }) {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, clipPath: "circle(0% at 50% 100%)" }}
      animate={{ opacity: 1, clipPath: "circle(150% at 50% 100%)" }}
      exit={{ opacity: 0, clipPath: "circle(0% at 50% 100%)" }}
      transition={{ type: "spring", stiffness: 120, damping: 20 }}
      className={cn(
        "fixed inset-0 z-50 flex flex-col overflow-hidden",
        isDark ? "bg-[#1a1a1a]" : "bg-[#dcd9cd]"
      )}
    >
      {/* CLOSE BUTTON */}
      <div className="absolute top-6 right-6 z-50">
        <button 
          onClick={onClose}
          className={cn(
            "p-2 rounded-full border transition-colors",
            isDark ? "border-white/20 text-white" : "border-black/20 text-black"
          )}
        >
          <X size={32} />
        </button>
      </div>

      {/* SCROLLABLE LIST AREA */}
      <div className="flex-1 overflow-y-auto flex flex-col justify-center items-center py-20 relative">
        <ul className="relative flex flex-col items-center gap-2 w-full">
          {items.map((item, index) => {
            const color = BG_COLORS[index % BG_COLORS.length];
            const isDimmed = activeIndex !== null && activeIndex !== index;
            const isActive = activeIndex === index;

            return (
              <li 
                key={item.id}
                className="relative w-full text-center py-4"
                onPointerDown={() => setActiveIndex(index)}
                onPointerUp={() => setActiveIndex(null)}
                onPointerLeave={() => setActiveIndex(null)}
              >
                <motion.button
                  onClick={() => {
                    triggerHaptic();
                    setTimeout(() => {
                        onClose();
                        if (item.href) router.push(item.href);
                        else if (item.onClick) item.onClick();
                    }, 100);
                  }}
                  className={cn(
                    "relative z-10 text-5xl font-black tracking-tight transition-all duration-300 px-6 py-2 rounded-xl",
                    isDark ? "text-white" : "text-[#333]",
                    isDimmed && "opacity-10 blur-[1px] scale-90"
                  )}
                  style={{ fontFamily: "'Cairo', sans-serif" }}
                >
                  <span className="relative z-20">{item.label}</span>

                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        layoutId="active-blob"
                        initial={{ opacity: 0, scale: 0.5, borderRadius: "50%" }}
                        animate={{ 
                            opacity: 1, 
                            scale: 1.5,
                            width: "100%",
                            borderRadius: "100px" 
                        }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        transition={{ duration: 0.3, type: "spring" }}
                        className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none overflow-hidden"
                        style={{ backgroundColor: color }}
                      >
                         <span 
                            className="absolute text-9xl font-black opacity-10 whitespace-nowrap uppercase tracking-[10px]"
                            style={{ color: "black" }}
                         >
                            {item.label}
                         </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              </li>
            );
          })}
        </ul>
      </div>
      
      <div className="pb-10 flex justify-center opacity-30 pointer-events-none">
         <img src="/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG" alt="Logo" className="w-12 h-12 grayscale" />
      </div>

    </motion.div>
  );
}
