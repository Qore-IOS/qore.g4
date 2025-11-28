"use client";
import React from "react";
import { cn } from "@/lib/utils";

/** Cards: 1 column on mobile, N on ≥md/≥lg, centered on mobile */
export default function CardGrid({
  md = 2,
  lg,
  gap = "gap-4",
  className,
  children,
}: React.PropsWithChildren<{ md?: 1|2|3|4|5|6; lg?: 1|2|3|4|5|6; gap?: string; className?: string }>) {
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-"+md, lg ? "lg:grid-cols-"+lg : "", "justify-items-stretch", gap, className)}>
      {children}
    </div>
  );
}
