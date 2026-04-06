'use client';

import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { SayimSession } from '@/lib/cost-analytics';
import { getSessionDate } from '@/lib/cost-analytics';

interface SessionTimelineProps {
  sessions: SayimSession[];
}

export default function SessionTimeline({ sessions }: SessionTimelineProps) {
  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Son Sayımlar</h3>
      <div className="space-y-2 max-h-[320px] overflow-auto">
        {sessions.slice(0, 12).map((s) => {
          const d = getSessionDate(s);
          return (
            <div key={s.id} className="cihaz-pressed px-3 py-2">
              <p className="text-sm text-[var(--dashboard-text)] font-medium">{s.locationName}</p>
              <p className="text-xs text-[var(--dashboard-muted)]">{d ? format(d, 'dd MMM yyyy HH:mm', { locale: tr }) : '—'} · {s.items.length} ürün</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
