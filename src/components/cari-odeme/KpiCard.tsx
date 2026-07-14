import { cn } from "@/lib/utils";
import React from "react";

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  isCurrency?: boolean;
  className?: string;
  showBadge?: boolean;
}

export function KpiCard({ title, value, icon, subtitle, trend, isCurrency = true, className, showBadge }: KpiCardProps) {
  const formattedValue = isCurrency && typeof value === 'number' 
    ? value.toLocaleString("tr-TR", { style: "currency", currency: "TRY" }) 
    : value;

  return (
    <div className={cn("relative p-5 rounded-xl bg-card border border-border shadow-sm flex flex-col justify-between h-full gap-4 transition-all hover:bg-muted/50", className)}>
      <div className="flex items-center justify-between text-muted-foreground text-sm font-medium">
        <span>{title}</span>
        <div className="relative">
          {icon}
          {showBadge && (
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm" />
          )}
        </div>
      </div>
      
      <div>
        <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          {formattedValue}
        </div>
        
        {(subtitle || trend) && (
          <div className="flex items-center gap-2 mt-2">
            {trend && (
              <span className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                trend.isPositive ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
              )}>
                {trend.isPositive ? "+" : "-"}{trend.value}%
              </span>
            )}
            {subtitle && (
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
