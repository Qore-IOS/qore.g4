'use client';

import type { Currency } from '@/lib/types';
import TimeRangeSelector from './TimeRangeSelector';
import type { TimeRange } from '@/lib/cost-analytics';

const CURRENCY_SYMBOLS: Record<Currency, string> = { EUR: '€', USD: '$', TRY: '₺' };

interface CostKPICardProps {
  title: string;
  total: number;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  currency: Currency;
  subtitle?: string;
}

export default function CostKPICard({ title, total, range, onRangeChange, currency, subtitle }: CostKPICardProps) {
  const sym = CURRENCY_SYMBOLS[currency];
  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-[var(--dashboard-text)] mb-2">{title}</h2>
      <div className="text-3xl sm:text-4xl font-bold text-[var(--dashboard-accent)] mb-2">
        {sym}{total.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
      </div>
      {subtitle && <p className="text-xs text-[var(--dashboard-muted)] mb-4">{subtitle}</p>}
      <TimeRangeSelector value={range} onChange={onRangeChange} />
    </div>
  );
}
