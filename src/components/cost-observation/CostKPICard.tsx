'use client';

import type { Currency } from '@/lib/types';
import TimeRangeSelector from './TimeRangeSelector';
import type { DeltaMetrics, TimeRange } from '@/lib/cost-analytics';

const CURRENCY_SYMBOLS: Record<Currency, string> = { EUR: '€', USD: '$', TRY: '₺' };

interface CostKPICardProps {
  title: string;
  total: number;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  currency: Currency;
  subtitle?: string;
  deltas?: { mom: DeltaMetrics; qoq: DeltaMetrics; yoy: DeltaMetrics };
}

function DeltaPill({ label, value }: { label: string; value: number }) {
  const positive = value >= 0;
  return (
    <div className={`px-2 py-1 rounded-lg text-xs font-semibold ${positive ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-600'}`}>
      {label}: {positive ? '↑' : '↓'} %{Math.abs(value).toFixed(1)}
    </div>
  );
}

export default function CostKPICard({ title, total, range, onRangeChange, currency, subtitle, deltas }: CostKPICardProps) {
  const sym = CURRENCY_SYMBOLS[currency];
  return (
    <div className="cihaz-card-strong p-5 sm:p-6 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--dashboard-text)]">{title}</h2>
      <div className="text-3xl sm:text-4xl font-bold text-[var(--dashboard-accent)]">
        {sym}{total.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
      </div>
      {subtitle && <p className="text-xs text-[var(--dashboard-muted)]">{subtitle}</p>}
      {deltas && (
        <div className="flex flex-wrap gap-2">
          <DeltaPill label="MoM" value={deltas.mom.deltaPct} />
          <DeltaPill label="QoQ" value={deltas.qoq.deltaPct} />
          <DeltaPill label="YoY" value={deltas.yoy.deltaPct} />
        </div>
      )}
      <TimeRangeSelector value={range} onChange={onRangeChange} />
    </div>
  );
}
