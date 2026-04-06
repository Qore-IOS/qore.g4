'use client';

import BrandCard from './BrandCard';

interface BrandOverviewGridProps {
  brands: { name: string; value: number; productCount: number }[];
  symbol: string;
  onBrandClick: (name: string) => void;
}

export default function BrandOverviewGrid({ brands, symbol, onBrandClick }: BrandOverviewGridProps) {
  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Marka Genel Görünümü</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {brands.map((b) => <BrandCard key={b.name} brand={b} symbol={symbol} onClick={() => onBrandClick(b.name)} />)}
      </div>
    </div>
  );
}
