'use client';

import { PieChart, ResponsiveContainer, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';

const PIE_COLORS = ['#F2994A','#6FCF97','#56CCF2','#BB6BD9','#F2C94C','#EB5757','#2F80ED','#27AE60'];

interface BrandDistributionProps {
  brands: { name: string; value: number }[];
  symbol: string;
  onBrandClick: (name: string) => void;
}

export default function BrandDistribution({ brands, symbol, onBrandClick }: BrandDistributionProps) {
  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Marka Dağılımı</h3>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={brands} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} onClick={(p: any) => p?.name && onBrandClick(p.name)}>
              {brands.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <RechartsTooltip formatter={(value: number) => [`${symbol}${value.toLocaleString('tr-TR')}`, '']} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 space-y-1">
        {brands.slice(0, 6).map((b, i) => (
          <button key={b.name} onClick={() => onBrandClick(b.name)} className="w-full flex items-center justify-between text-xs text-left">
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />{b.name}</span>
            <span className="text-[var(--dashboard-muted)]">{symbol}{b.value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
