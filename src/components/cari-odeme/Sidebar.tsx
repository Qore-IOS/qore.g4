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

    </aside>
  );
}
