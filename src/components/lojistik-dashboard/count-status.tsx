'use client';

import {
  AlertTriangle,
  Check,
  CircleMinus,
  Clock3,
  UploadCloud,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LogisticsCountStatus } from '@/lib/lojistik/count-overview';

const countConfig = {
  complete: {
    label: 'Tamamlandı',
    icon: Check,
    className:
      'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/15 dark:text-emerald-200',
  },
  partial: {
    label: 'Eksik',
    icon: AlertTriangle,
    className:
      'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/15 dark:text-amber-200',
  },
  not_started: {
    label: 'Yapılmadı',
    icon: X,
    className:
      'border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/15 dark:text-rose-200',
  },
  not_applicable: {
    label: 'Kapsam yok',
    icon: CircleMinus,
    className:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-300',
  },
} as const;

interface StatusChipProps {
  status: LogisticsCountStatus;
  className?: string;
  showIcon?: boolean;
}

export function CountStatusChip({
  status,
  className,
  showIcon = true,
}: StatusChipProps) {
  const config = countConfig[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold',
        config.className,
        className,
      )}
    >
      {showIcon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {config.label}
    </span>
  );
}

export function UploadStatusChip({
  uploaded,
  className,
  showIcon = true,
}: {
  uploaded: boolean;
  className?: string;
  showIcon?: boolean;
}) {
  const Icon = uploaded ? UploadCloud : Clock3;
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold',
        uploaded
          ? 'border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/15 dark:text-sky-200'
          : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-300',
        className,
      )}
    >
      {showIcon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {uploaded ? 'Yüklendi' : 'Yüklenmedi'}
    </span>
  );
}
