'use client';

import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { LocationCostData } from '@/lib/cost-analytics';

interface LocationBreakdownProps {
  data: LocationCostData[];
  symbol: string;
}

export default function LocationBreakdown({ data, symbol }: LocationBreakdownProps) {
  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Konum Bazlı Maliyet</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.map((l) => (
          <div key={`${l.locationType}-${l.locationId}`} className="cihaz-pressed px-4 py-3">
            <p className="text-sm font-semibold text-[var(--dashboard-text)]">{l.locationName}</p>
            <p className="text-xs text-[var(--dashboard-muted)] mb-1">{l.locationType === 'lab' ? 'Lab' : 'Depo'} · {l.productCount} ürün</p>
            <p className="text-lg font-bold text-[var(--dashboard-accent)]">{symbol}{l.totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
            <p className="text-[11px] text-[var(--dashboard-muted)]">Son sayım: {l.lastSessionDate ? format(l.lastSessionDate, 'dd MMM yyyy', { locale: tr }) : '—'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
