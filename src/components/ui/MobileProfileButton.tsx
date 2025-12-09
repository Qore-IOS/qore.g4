"use client";

import React, { useState } from "react";
import { User, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface MobileProfileButtonProps {
  isDark: boolean;
  className?: string;
}

export function MobileProfileButton({ isDark, className }: MobileProfileButtonProps) {
  const { currentUserProfile, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    setOpen(false);
    await logout();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Profil"
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200",
            isDark
              ? "text-white hover:bg-white/10"
              : "text-[#333] hover:bg-black/5",
            className
          )}
        >
          <User className="w-5 h-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={16}
        className={cn(
          "w-64 p-0 border",
          isDark
            ? "bg-black/80 backdrop-blur-xl border-white/10"
            : "bg-[#e0e0e0] shadow-[6px_6px_12px_#bebebe,-6px_-6px_12px_#ffffff] border-transparent"
        )}
      >
        <div className="p-4 space-y-3">
          <div className="space-y-1">
            <p className={cn(
              "text-sm font-medium",
              isDark ? "text-white" : "text-[#333]"
            )}>
              {currentUserProfile?.name || "Kullanıcı"}
            </p>
            <p className={cn(
              "text-xs",
              isDark ? "text-white/60" : "text-[#666]"
            )}>
              {currentUserProfile?.email || ""}
            </p>
            {currentUserProfile?.role && (
              <p className={cn(
                "text-xs capitalize",
                isDark ? "text-white/40" : "text-[#999]"
              )}>
                {currentUserProfile.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-current/10">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className={cn(
                "w-full justify-start gap-2 text-destructive hover:text-destructive",
                isDark
                  ? "hover:bg-white/10"
                  : "hover:bg-black/5"
              )}
            >
              <LogOut className="w-4 h-4" />
              Çıkış Yap
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
