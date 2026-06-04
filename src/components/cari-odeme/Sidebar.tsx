"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  CreditCard, 
  Receipt, 
  FileText, 
  Building2, 
  Settings,
  Bell,
  BookOpen,
  Sun,
  User,
  ChevronDown,
  Wallet,
  Landmark,
  PieChart,
  LineChart
} from "lucide-react";

const NAV_ITEMS = [
  {
    title: "Gösterge Paneli",
    href: "/cari-odeme",
    icon: LayoutDashboard,
    exact: true
  },
  {
    title: "Ödemeler",
    href: "/cari-odeme/odemeler",
    icon: CreditCard
  },
  {
    title: "Tahsilatlar",
    href: "/cari-odeme/tahsilat",
    icon: Wallet
  },
  {
    title: "Banka / Kasa",
    href: "/cari-odeme/banka",
    icon: Landmark
  },
  {
    title: "Faturalar",
    href: "/cari-odeme/faturalar",
    icon: FileText
  },
  {
    title: "Cari Ekstre",
    href: "/cari-odeme/ekstre",
    icon: Receipt
  },
  {
    title: "Karlılık",
    href: "/cari-odeme/karlilik",
    icon: PieChart
  },
  {
    title: "Nakit Akışı",
    href: "/cari-odeme/nakit-akis",
    icon: LineChart
  },
  {
    title: "Firmalar",
    href: "/cari-odeme/firmalar",
    icon: Building2
  },
  {
    title: "Ayarlar",
    href: "/cari-odeme/ayarlar",
    icon: Settings
  }
];

export function CariOdemeSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[280px] min-h-[calc(100dvh-76px)] flex flex-col bg-[#f4f6f4] border-r border-border/40">
      {/* Header Area */}
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center">
            {/* Simple logo placeholder similar to Nukleus atom icon */}
            <div className="h-4 w-4 rounded-full border-2 border-background" />
          </div>
          <span className="font-bold text-xl tracking-tight text-foreground">Nukleus</span>
        </div>
        
        <div className="flex items-center gap-4 text-muted-foreground mb-4 px-1">
          <div className="relative cursor-pointer hover:text-foreground transition-colors">
            <Bell className="h-5 w-5" />
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-destructive rounded-full border-2 border-[#f4f6f4]" />
          </div>
          <BookOpen className="h-5 w-5 cursor-pointer hover:text-foreground transition-colors" />
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = item.exact 
            ? pathname === item.href 
            : pathname.startsWith(item.href);
            
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium",
                isActive 
                  ? "bg-[#b3eb46] text-black shadow-sm" 
                  : "text-muted-foreground hover:bg-black/5 hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.title}
            </Link>
          );
        })}
      </nav>

      {/* Footer Area */}
      <div className="p-4 mt-auto border-t border-border/40 space-y-2">
        <button className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-muted-foreground hover:bg-black/5 hover:text-foreground transition-colors font-medium">
          <Sun className="h-5 w-5" />
          Temayı Değiştir
        </button>
        
        <button className="flex items-center justify-between w-full px-4 py-3 rounded-xl hover:bg-black/5 transition-colors">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium">BB</span>
            </div>
            <div className="flex flex-col items-start truncate">
              <span className="text-sm font-medium truncate w-full">bbasar@nukleus.c...</span>
              <span className="text-xs text-muted-foreground">Admin</span>
            </div>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-2" />
        </button>
      </div>
    </aside>
  );
}
