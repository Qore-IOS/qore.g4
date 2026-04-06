'use client';

import type { TimeRange } from '@/lib/cost-analytics';
import { cn } from '@/lib/utils';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const QUICK_RANGES: { label: string; value: TimeRange }[] = [
  { label: 'Son Sayım', value: 'latest' },
  { label: 'Son 3 Ay', value: 'last-3m' },
  { label: 'Son 6 Ay', value: 'last-6m' },
  { label: 'Son 12 Ay', value: 'last-12m' },
  { label: 'Yıl Başı', value: 'ytd' },
  { label: 'Tümü', value: 'all' },
];

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {QUICK_RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className={cn(
            'px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200',
            value === r.value
              ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
              : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
