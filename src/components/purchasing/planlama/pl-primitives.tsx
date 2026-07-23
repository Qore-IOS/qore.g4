'use client';

import React from 'react';
import {
  Search, X, Plus, ChevronLeft, ChevronRight, Check, Calendar, List,
  Clock, Zap, CornerDownRight, Pencil, Trash2, BarChart2, Inbox, Info,
} from 'lucide-react';

/* ─────────────────────────── types ─────────────────────────── */
export type Priority = 'high' | 'mid' | 'low';
export interface SubTask { id: string; title: string; done: boolean; }
export interface TaskInvite { uid: string; name: string; status: 'pending' | 'accepted' | 'declined'; respondedAt?: number; }
export interface Task {
  id: string;
  title: string;
  note?: string;
  pri: Priority;
  date: string;   // YYYY-MM-DD
  time?: string;  // HH:MM
  end?: string;   // HH:MM
  done: boolean;
  subs: SubTask[];
  labVisit?: boolean;
  laboratoryId?: string;
  laboratoryName?: string;
  laboratoryLat?: number;
  laboratoryLng?: number;
  invitations?: TaskInvite[];
  locationVerifiedAt?: any;
  createdAt?: any;
}
export type Mode = 'mobile' | 'tablet' | 'wide';
export interface Accent { primary: string; accent: string; glow: string; }

export const AC: Accent = { primary: '#C98A57', accent: '#E0B776', glow: 'rgba(201,138,87,0.24)' };

/* ─────────────────────── priority palette ──────────────────── */
export const PL_PRI: Record<Priority, { label: string; solid: string; ink: string; card: string }> = {
  high: { label: 'Yüksek', solid: '#E0A33E', ink: '#8A6516', card: 'linear-gradient(165deg, #FAF1DC, #F4E4C2)' },
  mid:  { label: 'Orta',   solid: '#7CA8DE', ink: '#3C5F88', card: 'linear-gradient(165deg, #EEF3FB, #DEE9F7)' },
  low:  { label: 'Düşük',  solid: '#6FB585', ink: '#3B6E50', card: 'linear-gradient(165deg, #EAF4EC, #D8EADD)' },
};
export const PL_PRI_ORDER: Priority[] = ['high', 'mid', 'low'];

/* calendar day-card colors (referans Screen 2) */
export const PL_CAL_COLORS = [
  { bg: 'linear-gradient(180deg, #CFC2E6, #BFAFDC)', ink: '#4a3d68', solid: '#9B86D6', soft: 'rgba(255,255,255,0.5)' },
  { bg: 'linear-gradient(180deg, #E0BFC9, #D3AAB6)', ink: '#6b4450', solid: '#C98AA0', soft: 'rgba(255,255,255,0.5)' },
  { bg: 'linear-gradient(180deg, #B6D8CE, #A2CCC0)', ink: '#2f5f56', solid: '#5EAE9C', soft: 'rgba(255,255,255,0.5)' },
  { bg: 'linear-gradient(180deg, #CFDDB4, #BFD09F)', ink: '#4f5e33', solid: '#8FA85E', soft: 'rgba(255,255,255,0.5)' },
  { bg: 'linear-gradient(180deg, #F0DAA8, #E6C893)', ink: '#6e5320', solid: '#D9A94E', soft: 'rgba(255,255,255,0.5)' },
];

/* ───────────────────────── locale data ─────────────────────── */
export const PL_MON = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const PL_MON_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const PL_EN_MON = ['OCA', 'ŞUB', 'MAR', 'NİS', 'MAY', 'HAZ', 'TEM', 'AĞU', 'EYL', 'EKİ', 'KAS', 'ARA'];
export const PL_DOW = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
export const PL_DOW_FULL = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

/* ──────────────────────── date helpers ─────────────────────── */
const p2 = (n: number) => String(n).padStart(2, '0');
export const plToday = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const plParse = (iso: string) => { const [y, m, d] = (iso || plToday()).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const plDow = (iso: string) => (plParse(iso).getDay() + 6) % 7; // Monday = 0
export const isoOffset = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const plRelative = (iso: string) => {
  const t0 = plParse(plToday()), t1 = plParse(iso);
  const diff = Math.round((t1.getTime() - t0.getTime()) / 86400000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  if (diff === -1) return 'Dün';
  if (diff > 1 && diff < 7) return PL_DOW_FULL[plDow(iso)];
  return `${t1.getDate()} ${PL_MON_SHORT[t1.getMonth()]}`;
};
export const plToMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const plAddMin = (hhmm: string, mins: number) => { if (!hhmm) return ''; const [h, m] = hhmm.split(':').map(Number); const d = new Date(2000, 0, 1, h, m + mins); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
// mesai (09:00–17:00 = 540–1020 dk) içine düşen süre
export const plWorkMinutes = (start?: string, end?: string) => { if (!start) return 0; const s = plToMin(start); const e = end ? plToMin(end) : s + 30; const a = Math.max(s, 540), b = Math.min(e, 1020); return Math.max(0, b - a); };
export const plDurLabel = (start?: string, end?: string) => { if (!start) return ''; const dur = end ? Math.max(0, plToMin(end) - plToMin(start)) : 30; const h = Math.floor(dur / 60), m = dur % 60; if (h && m) return `${h} sa ${m} dk`; if (h) return `${h} sa`; return `${m} dk`; };

export const uid = () => 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);

/* container-based responsive mode */
export const useContainerMode = (ref: React.RefObject<HTMLElement>): Mode => {
  const [mode, setMode] = React.useState<Mode>('wide');
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calc = () => { const w = el.clientWidth; setMode(w < 680 ? 'mobile' : w < 1024 ? 'tablet' : 'wide'); };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return mode;
};

/* ───────────────────────── icon adapter ────────────────────── */
type IcoProps = { s?: number };
const mk = (C: any) => ({ s = 18 }: IcoProps) => <C size={s} strokeWidth={2.1} />;
export const PLIco: Record<string, (p: IcoProps) => JSX.Element> = {
  search: mk(Search), close: mk(X), plus: mk(Plus), chevL: mk(ChevronLeft), chevR: mk(ChevronRight),
  check: mk(Check), calendar: mk(Calendar), list: mk(List), clock: mk(Clock), bolt: mk(Zap),
  sub: mk(CornerDownRight), edit: mk(Pencil), trash: mk(Trash2), bars: mk(BarChart2), inbox: mk(Inbox),
};

/* ─────────────────────── clay UI primitives ────────────────── */
export const PlCheck = ({ done, onClick, color, size = 26 }: { done: boolean; onClick: () => void; color?: string; size?: number }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    aria-label={done ? 'Tamamlandı olarak işaretle' : 'Tamamla'}
    style={{
      all: 'unset', cursor: 'pointer', width: size, height: size, minWidth: size, minHeight: size, aspectRatio: '1 / 1', borderRadius: '50%', flexShrink: 0,
      display: 'grid', placeItems: 'center', boxSizing: 'border-box',
      background: done ? (color || 'var(--water-solid)') : 'var(--surface-hi)',
      border: done ? 'none' : `2px solid ${color ? color + '88' : 'var(--ink-3)'}`,
      boxShadow: done ? `0 5px 12px -5px ${(color || '#6FB585')}99` : 'var(--clay-flat)',
      color: '#fff', transition: 'all 220ms var(--ease-fluid)',
    }}
  >
    {done && <Check size={Math.round(size * 0.55)} strokeWidth={3.2} />}
  </button>
);

export const PlRing = ({ pct, size = 64, thickness = 8, color, on = true }: { pct: number; size?: number; thickness?: number; color?: string; on?: boolean }) => {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - (on ? pct : 0) / 100);
  const col = color || 'var(--water-solid)';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={thickness} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 950ms var(--ease-fluid)' }} />
      </svg>
      {size >= 50 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
          <span style={{ fontSize: Math.round(size * 0.17), fontWeight: 800, color: 'var(--ink-3)', marginBottom: 1 }}>%</span>
          <span style={{ fontSize: Math.round(size * 0.30), fontWeight: 800, color: 'var(--ink-1)' }}>{pct}</span>
        </div>
      )}
    </div>
  );
};

export const PlBtn = ({ variant = 'ghost', ico, ac, onClick, children, style }: any) => {
  const I = ico ? PLIco[ico] : null;
  const base: React.CSSProperties = {
    all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 46, padding: '0 20px', borderRadius: 'var(--radius-sm)', fontSize: 14, fontWeight: 700, boxSizing: 'border-box',
    transition: 'all 200ms var(--ease-fluid)',
  };
  if (variant === 'primary')
    return <button onClick={onClick} style={{ ...base, color: '#fff', background: `linear-gradient(180deg, ${ac.accent}, ${ac.primary})`, boxShadow: `0 12px 22px -10px ${ac.glow}, inset 0 1px 0 rgba(255,255,255,0.35)`, ...style }}>{I && <I s={17} />}{children}</button>;
  return <button onClick={onClick} style={{ ...base, color: 'var(--ink-2)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-flat)', ...style }}>{I && <I s={17} />}{children}</button>;
};

export const PlIconBtn = ({ onClick, hot, ac, size = 46, children, ariaLabel }: any) => (
  <button
    onClick={onClick} aria-label={ariaLabel}
    style={{
      all: 'unset', cursor: 'pointer', width: size, height: size, minWidth: size, minHeight: size, aspectRatio: '1 / 1', borderRadius: hot ? '50%' : 'var(--radius-sm)', display: 'grid', placeItems: 'center', flexShrink: 0, boxSizing: 'border-box',
      color: hot ? '#fff' : 'var(--ink-2)',
      background: hot ? `linear-gradient(180deg, ${ac.accent}, ${ac.primary})` : 'var(--surface-hi)',
      boxShadow: hot ? `0 12px 22px -10px ${ac.glow}, inset 0 1px 0 rgba(255,255,255,0.35)` : 'var(--clay)',
      transition: 'all 200ms var(--ease-fluid)',
    }}
  >
    {children}
  </button>
);

export const PlModal = ({ open, onClose, width = 560, sheet, children }: any) => {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(61,50,35,0.34)', backdropFilter: 'blur(7px)', WebkitBackdropFilter: 'blur(7px)', display: 'flex', alignItems: sheet ? 'flex-end' : 'center', justifyContent: 'center', padding: sheet ? 0 : 20, animation: 'plFadeIn 200ms var(--ease-fluid)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: sheet ? '100%' : width, maxHeight: sheet ? '92vh' : '90vh', display: 'flex', flexDirection: 'column', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface))', borderRadius: sheet ? '30px 30px 0 0' : 'var(--radius-lg)', boxShadow: 'var(--clay), 0 34px 64px -22px rgba(90,72,40,0.42)', overflow: 'hidden', animation: `${sheet ? 'plSheetUp' : 'plModalPop'} 360ms var(--ease-fluid)` }}
      >
        {children}
      </div>
    </div>
  );
};

export const PlModalHead = ({ ico, title, onClose, ac }: any) => {
  const I = PLIco[ico] || PLIco.plus;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 18px 16px', borderBottom: '1px solid var(--line)' }}>
      <span style={{ width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center', color: ac.primary, background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}><I s={20} /></span>
      <h3 style={{ margin: 0, flex: 1, fontSize: 20, fontWeight: 800, color: 'var(--ink-1)' }}>{title}</h3>
      <button onClick={onClose} aria-label="Kapat" style={{ all: 'unset', cursor: 'pointer', width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--ink-2)', background: 'var(--surface-hi)', boxShadow: 'var(--clay)' }}><X size={18} /></button>
    </div>
  );
};

export const PlToast = ({ toast, ac }: any) => {
  if (!toast) return null;
  const ok = toast.tone === 'ok';
  return (
    <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 1200, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderRadius: 'var(--radius-pill)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface))', boxShadow: 'var(--clay), 0 16px 30px -12px rgba(90,72,40,0.4)', maxWidth: '90vw', animation: 'plToastIn 300ms var(--ease-fluid)' }}>
      <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, color: '#fff', background: ok ? 'var(--water-solid)' : ac.primary }}>{ok ? <Check size={15} strokeWidth={3} /> : <Info size={15} />}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.title}</div>
        {toast.sub && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.sub}</div>}
      </div>
    </div>
  );
};

/* scoped design tokens + keyframes (namespaced, does not leak outside .pl-root) */
export const PL_CSS = `
.pl-root {
  --bg-0: #EFEAE0; --bg-1: #E9E3D6;
  --surface: #FCFAF5; --surface-2: #F5F1E8; --surface-hi: #FFFFFF;
  --ink-1: #3D382F; --ink-2: #908872; --ink-3: #BBB2A0;
  --line: rgba(90,72,40,0.07);
  --accent: #C98A57; --accent-2: #E0B776; --accent-glow: rgba(201,138,87,0.24);
  --serif: 'Playfair Display', Georgia, 'Times New Roman', serif;
  --water: rgba(124,191,140,0.30); --water-edge: rgba(110,184,128,0.55); --water-solid: #6FB585; --water-deep: #4E9E6B;
  --amber: #E0A33E; --amber-soft: rgba(224,163,62,0.16); --amber-glow: rgba(224,163,62,0.45);
  --ready: #6FB585; --ready-glow: rgba(111,181,133,0.5);
  --danger: #C0796A; --violet: #9B86D6; --sky: #7CA8DE;
  --radius: 24px; --radius-sm: 16px; --radius-lg: 32px; --radius-pill: 999px;
  --clay: inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16);
  --clay-press: inset 0 2px 5px rgba(178,160,128,0.32), inset 0 -1px 0 rgba(255,255,255,0.6), 0 2px 6px -4px rgba(150,128,96,0.2);
  --clay-inset: inset 0 2px 5px rgba(178,160,128,0.30), inset 0 -1px 0 rgba(255,255,255,0.55);
  --clay-flat: inset 0 1px 1px rgba(255,255,255,0.85), 0 4px 12px -7px rgba(150,128,96,0.28);
  --ease-fluid: cubic-bezier(.22, 1, .36, 1);

  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  color: var(--ink-1);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  background:
    radial-gradient(120% 80% at 10% 0%, #F6F2EA 0%, transparent 55%),
    radial-gradient(120% 80% at 100% 100%, #E8E1D2 0%, transparent 55%),
    var(--bg-0);
}
/* satın-alma edge-to-edge: force the single cream backdrop everywhere */
body.mg-edge-body:has(.pl-root) { background: #EFEAE0 !important; }
.pl-root *, .pl-root *::before, .pl-root *::after { box-sizing: border-box; }
.pl-root button:focus-visible, .pl-root input:focus-visible, .pl-root textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pl-root ::-webkit-scrollbar { width: 9px; height: 9px; }
.pl-root ::-webkit-scrollbar-thumb { background: rgba(150,128,96,0.22); border-radius: 99px; border: 2.5px solid transparent; background-clip: padding-box; }
.pl-root ::-webkit-scrollbar-track { background: transparent; }
.pl-root input::placeholder, .pl-root textarea::placeholder { color: var(--ink-3); }
.pl-root input[type="date"], .pl-root input[type="time"] { color-scheme: light; }

@keyframes plPopIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes plFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes plSlideDay { from { opacity: 0.72; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
@keyframes plBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes plToastIn { from { opacity: 0; transform: translate(-50%, -14px) scale(0.96); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes plGrowW { from { width: 0; } }
@keyframes plGrowH { from { height: 0; } }
@keyframes plModalPop { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes plSheetUp { from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: none; } }
@keyframes plSpin { to { transform: rotate(360deg); } }
.pl-root .pl-spin, .pl-spin { animation: plSpin 0.8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .pl-root *, .pl-root *::before, .pl-root *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
`;

export const PlStyles = () => <style dangerouslySetInnerHTML={{ __html: PL_CSS }} />;
