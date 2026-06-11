import type { LucideIcon } from 'lucide-react';
import {
  Check,
  Truck,
  ArrowLeftRight,
  Receipt,
} from 'lucide-react';

/**
 * Start menu shared data + colour language.
 *
 * The "frequently used panels" grid and the search results are built from real
 * data (the user's accessible VIEWS) inside the component. The daily-summary
 * card and the recent-actions list are PLACEHOLDERS for the design pass — the
 * real sources (AI digest + activity feed) will be wired in a later step, as
 * agreed with the product owner.
 */

export type StartTone = 'orange' | 'blue' | 'green' | 'violet' | 'slate';

/** Soft icon-chip styles per tone — mirrors the dock's colour language and
 *  adapts to light/dark via Tailwind opacity utilities. */
export const TONE_CHIP: Record<StartTone, string> = {
  orange: 'bg-orange-500/12 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300',
  blue: 'bg-blue-500/12 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300',
  green: 'bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300',
  violet: 'bg-violet-500/12 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300',
  slate: 'bg-slate-500/12 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300',
};

/** Deterministic, on-brand tone per panel key (kept in step with the dock's
 *  ICON_COLORS palette). Unmapped keys fall back to 'slate'. */
export const VIEW_TONES: Record<string, StartTone> = {
  dashboard: 'blue',
  planner: 'violet',
  arama: 'blue',
  'mal-kabul': 'green',
  siparisler: 'orange',
  'direkt-transfer': 'violet',
  'stok-yonetimi': 'green',
  'depo-sayim': 'blue',
  'route-planlayici': 'violet',
  'laboratuvar-yonetimi': 'violet',
  'urun-kullanim': 'orange',
  'sarf-dagitim': 'orange',
  'numune-arsivi': 'slate',
  'cihazdan-cikan-kit': 'orange',
  'is-analizi': 'blue',
  'total-verimlilik': 'violet',
  'cost-dashboard': 'orange',
  'cihaz-yonetimi-ana': 'orange',
  raporlama: 'green',
  'kumulatif-hesaplama': 'blue',
  'cihaz-ustu-hesaplama': 'green',
  'personel-islemleri': 'blue',
  tanimlar: 'slate',
  'satin-alma': 'orange',
  'kullanici-talepleri': 'green',
  'cari-odeme': 'green',
  yonetim: 'slate',
};

export const toneForKey = (key: string): StartTone => VIEW_TONES[key] ?? 'slate';

export interface RecentAction {
  id: string;
  title: string;
  subtitle: string;
  time: string;
  icon: LucideIcon;
  tone: StartTone;
  href?: string;
}

// TODO(qore): replace with a real activity feed (per-user, Firestore-backed).
// Placeholder copy is for the design pass only.
export const PLACEHOLDER_RECENT_ACTIONS: RecentAction[] = [
  {
    id: 'r1',
    title: 'Ödeme onaylandı',
    subtitle: 'Ödeme #TRX-4821 · ₺150.000',
    time: '18 dk',
    icon: Check,
    tone: 'green',
  },
  {
    id: 'r2',
    title: 'Mal kabul kaydı',
    subtitle: 'İrsaliye #MK-0934 · IT',
    time: '1 sa',
    icon: Truck,
    tone: 'blue',
  },
  {
    id: 'r3',
    title: 'Transfer talebi açıldı',
    subtitle: 'Lojistik → IT · ₺42.000',
    time: '3 sa',
    icon: ArrowLeftRight,
    tone: 'violet',
  },
  {
    id: 'r4',
    title: 'Maliyet raporu indirildi',
    subtitle: 'Q2 · Departman kırılımı',
    time: 'Dün',
    icon: Receipt,
    tone: 'orange',
  },
];

export interface DailySummaryAction {
  label: string;
  /** Optional route; omit for not-yet-wired actions. */
  href?: string;
  variant: 'primary' | 'ghost';
}

export interface DailySummary {
  eyebrow: string;
  /** Supports **bold** segments which render in the accent colour. */
  message: string;
  actions: DailySummaryAction[];
}

// TODO(qore): replace with the real AI-generated daily digest. Placeholder
// content for the design pass.
export const PLACEHOLDER_DAILY_SUMMARY: DailySummary = {
  eyebrow: 'Qore AI · Günün Özeti',
  message:
    'Bu hafta IT bütçesinin **%12’si** kullanıldı; **3 ödeme** onayını bekliyor.',
  actions: [
    { label: 'Onayları gör', href: '/cari-odeme/odemeler', variant: 'primary' },
    { label: 'Haftalık rapor oluştur', href: '/raporlama', variant: 'ghost' },
  ],
};
