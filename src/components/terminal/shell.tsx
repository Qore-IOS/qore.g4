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
import { Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ConnectionBadge } from '@/components/terminal/connection-badge';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';

/** Terminal ekranlarının ortak dış çerçevesi. */
/**
 * Açık/koyu tema anahtarı.
 *
 * Rampada güneş alan bir terminalde koyu tema okunmaz, loş depoda açık tema
 * göz yorar — bu yüzden tercih makine başında, tek tıkla değişebilir olmalı.
 */
function ThemeToggle() {
  const [theme, setTheme] = useTerminalTheme();
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={next === 'light' ? 'Açık temaya geç' : 'Koyu temaya geç'}
      title={next === 'light' ? 'Açık tema' : 'Koyu tema'}
      className="rounded-lg border border-border p-2.5 text-muted-foreground hover:bg-muted"
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

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
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Bağlantı durumu HER ekranda görünür — çevrimdışı olduğunu
              bilmeyen kullanıcı, kaydın gittiğini sanıp devam eder. */}
          <ConnectionBadge />
          {right}
          <ThemeToggle />
          <button
            type="button"
            onClick={() => (onBack ? onBack() : router.push('/terminal'))}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-muted"
          >
            Geri <kbd className="ml-1 text-xs text-muted-foreground">Esc</kbd>
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
        'group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-8 text-left transition',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : 'hover:border-foreground/30 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary',
      )}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-primary">{icon}</span>
        <kbd className="rounded border border-border px-2 py-0.5 text-sm text-muted-foreground">
          {index}
        </kbd>
      </div>
      <span className="text-2xl font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </button>
  );
}

export type ScanFeedback = {
  tone: 'success' | 'error' | 'warning' | 'idle';
  title: string;
  detail?: string;
};

/**
 * Geri bildirim tonları.
 *
 * Renkler hem açık hem koyu temada okunur olmalı: bu yüzden zemin `/10`
 * saydamlıkla, metin ise `-700 dark:-200` çiftiyle verilir. Koyu temaya özel
 * sabit bir zemin (ör. `bg-emerald-950`) açık temada siyah bir blok gibi
 * görünürdü.
 */
const FEEDBACK_TONE: Record<ScanFeedback['tone'], string> = {
  success: 'border-emerald-600 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
  error: 'border-red-600 bg-red-500/10 text-red-700 dark:text-red-200',
  warning: 'border-amber-600 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  idle: 'border-border bg-card text-muted-foreground',
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
    <div className="rounded-xl border border-border bg-card px-5 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
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
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground',
    ghost:
      'border border-border text-foreground/80 hover:bg-muted disabled:text-muted-foreground disabled:hover:bg-transparent',
    danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground',
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
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="rounded-xl border border-border bg-card px-4 py-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
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
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-xl border border-border bg-card px-4 py-3 text-lg text-foreground focus:border-primary focus:outline-none"
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
