"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useWindowManager } from "@/contexts/window-manager-context";
import { 
  LayoutDashboard, 
  CreditCard, 
  Receipt, 
  FileText, 
  Building2, 
  Settings,
  Wallet,
  Landmark,
  PieChart,
  LineChart,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";

const NAV_ITEMS = [
  { title: "Gösterge Paneli", href: "/cari-odeme", icon: LayoutDashboard, exact: true },
  { title: "Ödemeler", href: "/cari-odeme/odemeler", icon: CreditCard },
  { title: "Tahsilatlar", href: "/cari-odeme/tahsilat", icon: Wallet },
  { title: "Banka / Kasa", href: "/cari-odeme/banka", icon: Landmark },
  { title: "Faturalar", href: "/cari-odeme/faturalar", icon: FileText },
  { title: "Cari Ekstre", href: "/cari-odeme/ekstre", icon: Receipt },
  { title: "Karlılık", href: "/cari-odeme/karlilik", icon: PieChart },
  { title: "Nakit Akışı", href: "/cari-odeme/nakit-akis", icon: LineChart },
  { title: "Firmalar", href: "/cari-odeme/firmalar", icon: Building2 },
  { title: "Ayarlar", href: "/cari-odeme/ayarlar", icon: Settings }
];

export function CariOdemeSidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  const { windows, activeId, closeWindow, minimizeWindow, windowBack } = useWindowManager();
  const active = windows.find((w) => w.id === activeId);
  const title = active?.title || "Cari Ödeme";

  return (
    <aside 
      className={cn(
        "min-h-full h-full flex flex-col bg-[#f4f6f4] border-r border-border/40 transition-all duration-300 relative",
        isCollapsed ? "w-[80px]" : "w-[280px]"
      )}
    >
      {/* Header Area (Window Chrome) */}
      <div className={cn(
        "flex pt-6 pb-4 w-full transition-all duration-300",
        isCollapsed ? "flex-col items-center gap-5" : "flex-row items-center gap-3 px-4"
      )}>
        {/* Traffic Lights */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => activeId && closeWindow(activeId)}
            className="group/light relative h-[13px] w-[13px] rounded-full bg-[#ff5f57] border border-black/10 grid place-items-center transition active:brightness-90"
          >
            <svg className="opacity-0 transition-opacity duration-150 group-hover/light:opacity-100" width="7" height="7" viewBox="0 0 8 8" stroke="rgba(80,0,0,.55)" strokeWidth="1.3" strokeLinecap="round">
              <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => activeId && minimizeWindow(activeId)}
            className="group/light relative h-[13px] w-[13px] rounded-full bg-[#febc2e] border border-black/10 grid place-items-center transition active:brightness-90"
          >
            <svg className="opacity-0 transition-opacity duration-150 group-hover/light:opacity-100" width="8" height="8" viewBox="0 0 8 8" stroke="rgba(110,70,0,.6)" strokeWidth="1.3" strokeLinecap="round">
              <path d="M1.5 4h5" />
            </svg>
          </button>
          <button
            type="button"
            disabled
            className="group/light relative h-[13px] w-[13px] rounded-full bg-[#28c840] border border-black/10 grid place-items-center opacity-90 cursor-default"
          >
            <svg className="opacity-0 transition-opacity duration-150 group-hover/light:opacity-100" width="8" height="8" viewBox="0 0 8 8" fill="rgba(0,80,0,.5)">
              <path d="M1.6 1.6h2.2L1.6 3.8zM6.4 6.4H4.2L6.4 4.2z" />
            </svg>
          </button>
        </div>

        {/* Global Back Button */}
        <button
          type="button"
          onClick={windowBack}
          title="Geri Dön"
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-full border border-black/5 bg-white/75 text-slate-800 shadow-[0_8px_22px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-md transition hover:bg-white active:scale-95",
            isCollapsed && "mt-1"
          )}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
        </button>

        {/* Title */}
        {!isCollapsed && (
          <div className="min-w-0 pr-2">
            <h1 className="truncate text-[18px] font-extrabold leading-none tracking-[-0.02em] text-slate-950">
              {title}
            </h1>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className={cn(
        "flex-1 space-y-1 overflow-y-auto mt-2 pb-4", 
        isCollapsed ? "px-3" : "px-4"
      )}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.exact 
            ? pathname === item.href 
            : pathname.startsWith(item.href);
            
          return (
            <Link
              key={item.href}
              href={item.href}
              title={isCollapsed ? item.title : undefined}
              className={cn(
                "flex items-center rounded-xl transition-all duration-200 font-medium",
                isCollapsed ? "justify-center p-3" : "gap-3 px-4 py-3",
                isActive 
                  ? "bg-[#b3eb46] text-black shadow-sm" 
                  : "text-muted-foreground hover:bg-black/5 hover:text-foreground"
              )}
            >
              <item.icon className={cn("shrink-0", isCollapsed ? "h-6 w-6" : "h-5 w-5")} />
              {!isCollapsed && <span className="truncate">{item.title}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer Toggle */}
      <div className="p-4 border-t border-border/20 flex justify-center mt-auto">
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)} 
          className="p-2 rounded-xl hover:bg-black/5 text-muted-foreground hover:text-foreground transition-colors"
          title={isCollapsed ? "Genişlet" : "Daralt"}
        >
          {isCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
      </div>
    </aside>
  );
}
