
'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, History, BarChart3, ChevronRight, Wallet } from 'lucide-react';

interface HubTileProps {
  icon: React.ElementType;
  label: string;
  description: string;
  onClick: () => void;
}

function HubTile({ icon: Icon, label, description, onClick }: HubTileProps) {
  return (
    <button
      onClick={onClick}
      className="cihaz-action-tile cihaz-focus-ring group flex flex-col items-center justify-center gap-3 p-6 sm:p-8 text-center w-full min-h-[180px] sm:min-h-[220px]"
    >
      <span className="flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] transition-transform duration-200 group-hover:scale-105">
        <Icon className="h-7 w-7 sm:h-8 sm:w-8 text-[var(--dashboard-accent)]" />
      </span>
      <span className="text-base sm:text-lg font-semibold text-[var(--dashboard-text)] leading-snug">
        {label}
      </span>
      <span className="text-xs sm:text-sm text-[var(--dashboard-muted)] leading-relaxed max-w-[200px]">
        {description}
      </span>
      <ChevronRight className="w-5 h-5 text-[var(--dashboard-muted)] opacity-0 group-hover:opacity-100 transition-all duration-200 group-hover:translate-x-1" />
    </button>
  );
}

export default function CostDashboardPage() {
  const router = useRouter();

  const tiles = [
    {
      icon: ClipboardCheck,
      label: 'Maliyet Sayım',
      description: 'Laboratuvar ve depo bazlı marka marka maliyet sayımı yapın',
      href: '/maliyet-sayim',
    },
    {
      icon: History,
      label: 'Sayım Geçmişi',
      description: 'Geçmiş maliyet sayım oturumlarını görüntüleyin',
      href: '/cost-dashboard/gecmis',
    },
    {
      icon: BarChart3,
      label: 'Maliyet Gözlem',
      description: 'Envanter maliyeti, trendler ve marka bazlı analizler',
      href: '/maliyet-gozlem',
    },
  ];

  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8 sm:mb-12 px-1">
          <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
            <Wallet className="h-5 w-5 text-[var(--dashboard-accent)]" />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Maliyet Paneli</h1>
            <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">Maliyet sayım, geçmiş ve gözlem araçları</p>
          </div>
        </div>

        {/* Hub Tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
          {tiles.map((tile) => (
            <HubTile
              key={tile.label}
              icon={tile.icon}
              label={tile.label}
              description={tile.description}
              onClick={() => router.push(tile.href)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
