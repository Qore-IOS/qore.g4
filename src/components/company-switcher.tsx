'use client';

/**
 * CompanySwitcher - Süper admin için şirket geçiş componenti
 *
 * Navigasyon çubuğunda (dock/sidebar) görünür.
 * Süper admin değilse hiçbir şey render etmez.
 */

import React from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCompany } from '@/contexts/company-context';

export function CompanySwitcher() {
  const { isSuperAdmin, companies, activeCompanyId, activeCompany, switchCompany } = useCompany();

  if (!isSuperAdmin || companies.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs gap-1 px-2"
        >
          <Building2 className="h-3 w-3" />
          <span className="max-w-[80px] truncate font-mono">
            {activeCompany?.name || activeCompanyId}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Şirket Değiştir (Süper Admin)
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((company) => (
          <DropdownMenuItem
            key={company.id}
            onClick={() => switchCompany(company.id)}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex flex-col">
              <span className="font-mono text-xs font-medium">{company.name}</span>
              <span className="text-xs text-muted-foreground">{company.displayName}</span>
            </div>
            {company.id === activeCompanyId && (
              <Badge variant="secondary" className="text-xs ml-2 shrink-0">Aktif</Badge>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
