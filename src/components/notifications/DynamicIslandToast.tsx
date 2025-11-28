
"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useIsMobile } from "@/hooks/use-mobile";

export type NotificationType =
  | "order_created"
  | "order_created_from_request"
  | "transfer_to_lab"
  | "fefo_override"
  | "fault_opened";

export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: { name?: string };
  title: string;
  message: string;
  meta?: {
    kurumAdi?: string;
    labName?: string;
    hospitalName?: string;
    deviceName?: string;
    itemCount?: number;
    items?: any[];
  };
  createdAt?: { toDate: () => Date };
  href?: string;
}

// --- Visual constants ---
// Desktop
const NOTCH = { w: 220, h: 34 };
const ISLAND = { w: 420, h: 40 };
const EXPANDED = { w: 640, h: 148 };

// Mobile
const MOBILE_NOTCH = { w: 180, h: 32 };
const MOBILE_ISLAND = { w: "90vw", h: 50 };
const MOBILE_EXPANDED = { w: "95vw", h: 160 };


function typeAccent(n: AppNotification) {
  const isFault = n.type === "fault_opened";
  const isFefo = n.type === 'fefo_override';
  
  if (isFefo) {
    return {
        accentText: "text-amber-500",
        accentBg: "bg-amber-500",
    };
  }
  
  return {
    accentText: isFault ? "text-red-500" : "text-green-500",
    accentBg: isFault ? "bg-red-500" : "bg-green-500",
  };
}

function shortLabel(n: AppNotification) {
  if (n.type === "fault_opened") return `1 yeni arıza kaydı`;
  if (n.type === 'fefo_override') return `FEFO Uyarısı Yoksayıldı`;
  return `${n.meta?.itemCount ?? 1} yeni ürün talebi`;
}

function hoverLabel(n: AppNotification) {
  const lab = n.meta?.kurumAdi || n.meta?.labName || n.meta?.hospitalName || "";
  if (n.type === "fault_opened") {
    const who = n.actor?.name ? ` ${n.actor.name} tarafından` : "";
    const labPart = lab ? ` ${lab} laboratuvarında` : "";
    return `${labPart}${who} 1 yeni arıza kaydı`;
  }
  if (n.type === 'fefo_override') {
      const who = n.actor?.name ? `${n.actor.name} tarafından` : '';
      return `FEFO Kuralı ${who} yoksayıldı`;
  }
  const labPart = lab ? `${lab} laboratuvarından` : "Laboratuvardan";
  return `${labPart} ${n.meta?.itemCount ?? 1} yeni talep`;
}

function detailLines(n: AppNotification) {
  const createdAtText = n.createdAt
    ? n.createdAt.toDate().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
    : "-";
  const lab = n.meta?.kurumAdi || n.meta?.labName || n.meta?.hospitalName || "-";
  
  if (n.type === 'fefo_override') {
    return [
      { label: 'Ürün', value: n.meta?.stokAdi ?? '-' },
      { label: 'Lot', value: n.meta?.lot ?? '-' },
      { label: 'İşlem', value: n.meta?.action === 'product_usage' ? 'Kullanım' : 'Transfer' },
      { label: 'Yapan', value: n.actor?.name ?? '-' },
    ];
  }
  
  if (n.type === "fault_opened") {
    return [
      { label: "Cihaz", value: n.meta?.deviceName ?? "-" },
      { label: "Laboratuvar", value: lab },
      { label: "Açan", value: n.actor?.name ?? "-" },
      { label: "Saat", value: createdAtText },
    ];
  }
  return [
    { label: "Laboratuvar", value: lab },
    { label: "Açan", value: n.actor?.name ?? "-" },
    { label: "Kalem / Adet", value: `${n.meta?.itemCount ?? 1}` },
    { label: "Saat", value: createdAtText },
  ];
}

export type Stage = "notch" | "island" | "expanded";

export interface DynamicIslandToastProps {
  notification: AppNotification;
  onNavigate: (n: AppNotification) => void;
  onMarkRead: (id: string) => Promise<void> | void;
}

export default function DynamicIslandToast({
  notification,
  onNavigate,
  onMarkRead,
}: DynamicIslandToastProps) {
  const [stage, setStage] = useState<Stage>("notch");
  const { theme } = useTheme();
  const { accentText, accentBg } = typeAccent(notification);
  const isMobile = useIsMobile();

  const idleTimer = useRef<number | null>(null);
  const resetIdle = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setStage("notch"), 3500);
  }, []);
  useEffect(() => {
    resetIdle();
    return () => { if (idleTimer.current) window.clearTimeout(idleTimer.current); };
  }, [stage, resetIdle]);

  const containerBg = theme === "light" ? "bg-black" : "bg-white";
  const bodyTextForExpanded = theme === "light" ? "text-white" : "text-black";
  const compactTextColor = accentText;
  
  // yOffset is now 0 since we only show one notification at a time.
  const yOffset = 0; 

  const radiiByStage = isMobile
    ? {
        notch: { tl: 0, tr: 0, br: 16, bl: 16 },
        island: { tl: 24, tr: 24, br: 24, bl: 24 },
        expanded: { tl: 0, tr: 0, br: 24, bl: 24 },
      }
    : {
        notch: { tl: 0, tr: 0, br: 18, bl: 18 },
        island: { tl: 20, tr: 20, br: 20, bl: 20 },
        expanded: { tl: 0, tr: 0, br: 20, bl: 20 },
      };

  const sizesByStage = isMobile
    ? { notch: MOBILE_NOTCH, island: MOBILE_ISLAND, expanded: MOBILE_EXPANDED }
    : { notch: NOTCH, island: ISLAND, expanded: EXPANDED };

  const { tl, tr, br, bl } = radiiByStage[stage];
  const { w, h } = sizesByStage[stage];

  const topPx = stage === "island" ? 8 : 0;
  const boxShadow =
    theme === "light"
      ? "0px 18px 40px -18px rgba(0,0,0,0.35)"
      : "0px 18px 40px -18px rgba(0,0,0,0.30)";

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: -18 }}
      animate={{ opacity: 1, y: yOffset }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.18 }}
      className="pointer-events-auto"
    >
      <motion.div
        layout
        onMouseEnter={() => setStage("island")}
        onMouseLeave={() => setStage("notch")}
        onClick={() => setStage((s) => (s === "expanded" ? "island" : "expanded"))}
        animate={{
          width: w,
          height: h,
          top: topPx,
          borderTopLeftRadius: tl,
          borderTopRightRadius: tr,
          borderBottomRightRadius: br,
          borderBottomLeftRadius: bl,
        }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={cn(
          "relative cursor-pointer ring-1 ring-black/10 dark:ring-black/5 overflow-hidden select-none",
          containerBg
        )}
        style={{ boxShadow, position: "relative" }}
      >
        <div className="flex h-full w-full items-center justify-between gap-3 px-3">
          <div className={cn("h-2 w-2 rounded-full", accentBg)} />
          {stage !== "expanded" ? (
            <div className={cn("truncate text-sm font-medium", compactTextColor)}>
              {stage === "island" ? hoverLabel(notification) : shortLabel(notification)}
            </div>
          ) : (
            <div className="flex w-full items-stretch gap-2 md:gap-6">
              <div className="flex min-w-0 flex-1 items-center">
                <div className="w-full">
                  <div className={cn("text-sm font-semibold", accentText)}>
                    {notification.title}
                  </div>
                  <div
                    className={cn(
                      "mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm",
                      bodyTextForExpanded
                    )}
                  >
                    {detailLines(notification).map((ln) => (
                      <div key={ln.label} className="flex min-w-0 items-center gap-2">
                        <span className={cn("w-28 shrink-0 text-xs font-semibold", accentText)}>
                          {ln.label}
                        </span>
                        <span className="truncate">{ln.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex w-24 flex-col items-center justify-center gap-3 px-1">
                <button
                  aria-label="İlgili kayda git"
                  onClick={(e) => { e.stopPropagation(); onNavigate(notification); }}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full",
                    "shadow-md transition-transform hover:scale-105 active:scale-95",
                    "bg-green-500"
                  )}
                >
                  <ChevronRight className="h-5 w-5 text-white" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkRead(notification.id);
                    setStage("notch");
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium",
                    "transition hover:opacity-90",
                    theme === "light" ? "border-white/20 text-white" : "border-black/10 text-black"
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                  Okundu
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
