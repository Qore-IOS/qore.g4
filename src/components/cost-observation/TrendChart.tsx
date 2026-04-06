'use client';

import React, { useMemo, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip as RechartsTooltip } from 'recharts';
import type { Currency } from '@/lib/types';
import type { MonthlyTrendPoint } from '@/lib/cost-analytics';

const CURRENCY_SYMBOLS: Record<Currency, string> = { EUR: '€', USD: '$', TRY: '₺' };

interface TrendChartProps {
  data: MonthlyTrendPoint[];
  currency: Currency;
}

const windows = [6, 12, 24, 999] as const;

export default function TrendChart({ data, currency }: TrendChartProps) {
  const [windowMonths, setWindowMonths] = useState<(typeof windows)[number]>(12);
  const sym = CURRENCY_SYMBOLS[currency];
  const sliced = useMemo(() => {
    if (windowMonths === 999) return data;
    return data.slice(Math.max(0, data.length - windowMonths));
  }, [data, windowMonths]);

  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-[var(--dashboard-text)]">Aylık Maliyet Trendi</h3>
        <div className="flex gap-1">
          {windows.map((w) => (
            <button key={w} onClick={() => setWindowMonths(w)} className={`px-2 py-1 text-xs rounded-lg ${windowMonths === w ? 'bg-[var(--dashboard-accent)] text-white' : 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)]'}`}>
              {w === 999 ? 'Tümü' : `${w} Ay`}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sliced}>
            <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} width={55} tickFormatter={(v) => `${sym}${Math.round(v / 1000)}k`} />
            <RechartsTooltip formatter={(value: number) => [`${sym}${value.toLocaleString('tr-TR')}`, 'Maliyet']} />
            <Line type="monotone" dataKey="cost" stroke="var(--dashboard-accent)" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
