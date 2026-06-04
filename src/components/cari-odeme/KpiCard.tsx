import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  className?: string;
  showBadge?: boolean;
}

export function KpiCard({ title, value, icon: Icon, className, showBadge }: KpiCardProps) {
  return (
    <div className={cn("relative p-5 rounded-xl bg-card border border-border shadow-sm flex flex-col justify-between h-full gap-4 transition-all hover:bg-muted/50", className)}>
      <div className="flex items-center justify-between text-muted-foreground text-sm font-medium">
        <span>{title}</span>
        <div className="relative">
          <Icon className="h-5 w-5" />
          {showBadge && (
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm" />
          )}
        </div>
      </div>
      <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
        {value}
      </div>
    </div>
  );
}
