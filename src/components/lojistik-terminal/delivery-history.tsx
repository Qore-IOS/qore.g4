'use client';

import React from 'react';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Truck, FileText, AlertCircle, PackagePlus, History as HistoryIcon } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { cn } from '@/lib/utils';

export type PartialDeliveryItem = {
  stokKodu: string;
  deliveredAdet?: number;
  missingAdet?: number;
};

export type PartialDelivery = {
  at?: Date | Timestamp | { toDate: () => Date } | null;
  actorUid?: string | null;
  actorName?: string | null;
  irsaliyeFileId?: string | null;
  irsaliyeFileName?: string | null;
  items?: PartialDeliveryItem[];
  extras?: { stokKodu: string; adet: number }[];
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'object' && value && 'toDate' in (value as any) && typeof (value as any).toDate === 'function') {
    return (value as any).toDate();
  }
  return null;
}

interface Props {
  deliveries?: PartialDelivery[];
  productNameMap?: Map<string, string>;
  className?: string;
  emptyHint?: string;
  compact?: boolean;
}

export default function DeliveryHistory({
  deliveries,
  productNameMap,
  className,
  emptyHint = 'Henüz irsaliye ile teslim alınmış kalem yok.',
  compact = false,
}: Props) {
  const list = (deliveries ?? []).slice().sort((a, b) => {
    const ad = toDate(a.at)?.getTime() ?? 0;
    const bd = toDate(b.at)?.getTime() ?? 0;
    return bd - ad; // newest first
  });

  if (list.length === 0) {
    return (
      <div
        className={cn('text-xs px-3 py-2 rounded-lg', className)}
        style={{ background: 'var(--loj-surface-3)', color: 'var(--loj-muted)' }}
      >
        <span className="inline-flex items-center gap-1.5">
          <HistoryIcon className="h-3.5 w-3.5" />
          {emptyHint}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {list.map((d, idx) => {
        const date = toDate(d.at);
        const items = d.items ?? [];
        const totalDelivered = items.reduce((s, it) => s + (Number(it.deliveredAdet) || 0), 0);
        const totalMissing = items.reduce((s, it) => s + (Number(it.missingAdet) || 0), 0);
        const extras = d.extras ?? [];
        return (
          <div
            key={`${d.irsaliyeFileId || idx}-${date?.getTime() || idx}`}
            className="rounded-xl border p-3"
            style={{ borderColor: 'var(--loj-stroke)', background: 'var(--loj-surface-3)' }}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--loj-accent)' }}>
                  <Truck className="h-3.5 w-3.5" />
                  İrsaliye Teslim
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--loj-text)' }}>
                  {date ? formatDate(date, 'dd.MM.yyyy · HH:mm', { locale: tr }) : 'Tarih yok'}
                  {d.actorName ? <span style={{ color: 'var(--loj-muted)' }}> · {d.actorName}</span> : null}
                </p>
                {d.irsaliyeFileName ? (
                  <p className="text-[11px] mt-1 inline-flex items-center gap-1" style={{ color: 'var(--loj-muted)' }}>
                    <FileText className="h-3 w-3" />
                    {d.irsaliyeFileName}
                  </p>
                ) : null}
              </div>
              <div className="text-right shrink-0">
                <p className="text-base font-extrabold" style={{ color: 'var(--loj-accent)' }}>{totalDelivered}</p>
                <p className="text-[10px] uppercase" style={{ color: 'var(--loj-muted)' }}>adet teslim</p>
              </div>
            </div>

            {items.length > 0 && (
              <div className={cn('grid gap-1', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
                {items.map((it, i) => {
                  const name = productNameMap?.get(it.stokKodu) || it.stokKodu;
                  const missing = Number(it.missingAdet) || 0;
                  return (
                    <div
                      key={`${it.stokKodu}-${i}`}
                      className="flex items-center justify-between text-[11px] px-2 py-1 rounded-md"
                      style={{
                        background: missing > 0 ? 'var(--loj-warning-soft)' : 'var(--loj-success-soft)',
                        color: 'var(--loj-text)',
                      }}
                    >
                      <span className="truncate font-medium" title={name}>{name}</span>
                      <span className="font-bold ml-2 shrink-0" style={{ color: missing > 0 ? 'var(--loj-warning)' : 'var(--loj-success)' }}>
                        {it.deliveredAdet ?? 0}
                        {missing > 0 ? <span className="opacity-70"> · -{missing}</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {totalMissing > 0 && (
              <p className="text-[11px] mt-2 inline-flex items-center gap-1" style={{ color: 'var(--loj-warning)' }}>
                <AlertCircle className="h-3 w-3" /> {totalMissing} adet eksik kaldı
              </p>
            )}

            {extras.length > 0 && (
              <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--loj-stroke)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1" style={{ color: 'var(--loj-muted)' }}>
                  <PackagePlus className="h-3 w-3" /> Fazla Kalemler (notla)
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {extras.map((e, i) => {
                    const name = productNameMap?.get(e.stokKodu) || e.stokKodu;
                    return (
                      <span
                        key={`${e.stokKodu}-extra-${i}`}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background: 'var(--loj-info-soft)',
                          color: 'var(--loj-info)',
                          border: '1px solid color-mix(in srgb, var(--loj-info) 28%, transparent)',
                        }}
                      >
                        {name} · +{e.adet}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
