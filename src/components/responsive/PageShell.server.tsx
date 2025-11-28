// src/components/responsive/PageShell.server.tsx
// Server Component wrapper — NO "use client", no hooks.
import React from "react";
import { cn } from "@/lib/utils";

/**
 * Use this in Server Components (e.g., app/(protected)/page.tsx).
 * It renders the exact same DOM structure as PageShell.
 */
export default function PageShell({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn("page-shell mx-auto w-full max-w-screen-2xl pb-[env(safe-area-inset-bottom)]", className)}>
      {children}
    </div>
  );
}