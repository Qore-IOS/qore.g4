/**
 * @fileoverview Terminal kabuğu — masaüstü depo uygulamasının ortak arayüzü.
 *
 * TASARIM KARARI: Bu ekranlar depo zeminine bakar. Kullanıcı elinde barkod
 * okuyucuyla ayakta durur, ekrana bir buçuk metreden bakar ve fareye çoğu
 * zaman dokunmaz. Bu yüzden web panellerinin yoğun arayüzü burada BİLEREK
 * kullanılmaz:
 *
 *   - tek ekranda tek iş, dolayısıyla sekme/menü yok
 *   - okunabilirlik için büyük tipografi ve yüksek kontrast
 *   - her eylemin bir kısayolu var; Esc her zaman "geri"
 *   - renk tek başına anlam taşımaz (metin de durumu söyler)
 */

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Terminal ekranlarının ortak dış çerçevesi. */
export function TerminalShell({
  title,
  subtitle,
  onBack,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Verilmezse Esc ve "Geri" terminal ana ekranına döner. */
  onBack?: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Bir alana yazılırken Esc alanı temizlemeli, ekranı değiştirmemeli.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      if (onBack) onBack();
      else router.push('/terminal');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onBack, router]);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="truncate text-sm text-zinc-400">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {right}
          <button
            type="button"
            onClick={() => (onBack ? onBack() : router.push('/terminal'))}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Geri <kbd className="ml-1 text-xs text-zinc-500">Esc</kbd>
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

/** Ana ekrandaki büyük eylem kutusu. */
export function TerminalTile({
  index,
  title,
  description,
  icon,
  onClick,
  disabled,
}: {
  /** 1-9 arası; klavyeden bu rakamla açılır. */
  index: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex flex-col items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-left transition',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : 'hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500',
      )}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-sky-400">{icon}</span>
        <kbd className="rounded border border-zinc-700 px-2 py-0.5 text-sm text-zinc-500">
          {index}
        </kbd>
      </div>
      <span className="text-2xl font-semibold">{title}</span>
      <span className="text-sm text-zinc-400">{description}</span>
    </button>
  );
}

export type ScanFeedback = {
  tone: 'success' | 'error' | 'warning' | 'idle';
  title: string;
  detail?: string;
};

const FEEDBACK_TONE: Record<ScanFeedback['tone'], string> = {
  success: 'border-emerald-600 bg-emerald-950/60 text-emerald-100',
  error: 'border-red-600 bg-red-950/60 text-red-100',
  warning: 'border-amber-600 bg-amber-950/60 text-amber-100',
  idle: 'border-zinc-800 bg-zinc-900 text-zinc-400',
};

/**
 * Son okutmanın sonucunu gösteren büyük şerit.
 *
 * Renk TEK BAŞINA anlam taşımaz — başlık metni de sonucu söyler. Depo
 * aydınlatması ve renk körlüğü altında yalnızca yeşil/kırmızıya güvenilemez.
 */
export function ScanFeedbackBar({ feedback }: { feedback: ScanFeedback }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-4 rounded-xl border px-6 py-4 transition-colors',
        FEEDBACK_TONE[feedback.tone],
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-xl font-semibold">{feedback.title}</p>
        {feedback.detail ? (
          <p className="truncate text-sm opacity-80">{feedback.detail}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Sayaç kutusu — "kaç kalem okutuldu" gibi tek sayılık göstergeler. */
export function TerminalStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** Terminal genelinde kullanılan birincil eylem butonu. */
export function TerminalButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
  shortcut,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  shortcut?: string;
  type?: 'button' | 'submit';
}) {
  const variants = {
    primary: 'bg-sky-600 text-white hover:bg-sky-500 disabled:bg-zinc-800 disabled:text-zinc-500',
    ghost:
      'border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent',
    danger: 'bg-red-600 text-white hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-500',
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-xl px-6 py-3 text-base font-semibold transition disabled:cursor-not-allowed',
        variants[variant],
      )}
    >
      {children}
      {shortcut ? <kbd className="text-xs opacity-70">{shortcut}</kbd> : null}
    </button>
  );
}

/** Etiketli, terminal ölçeğinde bir metin alanı. */
export function TerminalField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-lg text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
      />
    </label>
  );
}

/** Etiketli, terminal ölçeğinde bir seçim kutusu. */
export function TerminalSelect<T extends { id: string; name?: string }>({
  label,
  value,
  onChange,
  options,
  placeholder = 'Seçiniz…',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: T[];
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-lg text-zinc-100 focus:border-sky-500 focus:outline-none"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.name || o.id}
          </option>
        ))}
      </select>
    </label>
  );
}
