'use client';

import React from 'react';
import {
  Wallet, ClipboardCheck, History, BarChart3, Bell, Layers, ChevronRight, ChevronDown,
  ChevronLeft, X, Check, Calendar, User, Tag, Package, Trash2, Filter, Search,
  FlaskConical, Building2, ScanBarcode, Mic, Download, FileSpreadsheet,
} from 'lucide-react';

/* ─────────────── accent + types ─────────────── */
export interface Accent { primary: string; accent: string; glow: string; }
export const AC: Accent = { primary: '#C98A57', accent: '#E0B776', glow: 'rgba(201,138,87,0.24)' };
export type Mode = 'mobile' | 'tablet' | 'wide';

/* ─────────────── formatters ─────────────── */
export const ML_NUM = (v: number) => Math.round(v).toLocaleString('tr-TR');
export const ML_MONEY = (v: number) =>
  '$' + (v || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ─────────────── icons (lucide adapters, called as <MLIco.x s={n} />) ─────────────── */
type IcoProps = { s?: number };
const mk = (C: any) => ({ s = 18 }: IcoProps) => <C size={s} strokeWidth={2.1} />;
export const MLIco: Record<string, (p: IcoProps) => JSX.Element> = {
  wallet: mk(Wallet), clipboardCheck: mk(ClipboardCheck), history: mk(History), chart: mk(BarChart3),
  bell: mk(Bell), layers: mk(Layers), chevR: mk(ChevronRight), chevD: mk(ChevronDown), back: mk(ChevronLeft),
  close: mk(X), check: mk(Check), calendar: mk(Calendar), user: mk(User), tag: mk(Tag), box: mk(Package),
  trash: mk(Trash2), filter: mk(Filter), search: mk(Search), flask: mk(FlaskConical), building: mk(Building2),
  barcode: mk(ScanBarcode), mic: mk(Mic), download: mk(Download), excel: mk(FileSpreadsheet),
};

/* ─────────────── hooks ─────────────── */
export const useContainerMode = (ref: React.RefObject<HTMLElement>): Mode => {
  const [mode, setMode] = React.useState<Mode>('wide');
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calc = () => { const w = el.clientWidth; setMode(w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'wide'); };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return mode;
};

export function useCountUp(target: number, dur = 650, on = true) {
  const [v, setV] = React.useState(target);
  const from = React.useRef(target);
  const raf = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!on) { setV(target); return; }
    const a = from.current, b = target, t0 = performance.now();
    const ease = (p: number) => 1 - Math.pow(1 - p, 3);
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setV(a + (b - a) * ease(p));
      if (p < 1) raf.current = requestAnimationFrame(tick); else from.current = b;
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, dur, on]);
  return v;
}

/* ─────────────── primitives ─────────────── */
export const MlCard = ({ children, style, pad, tone, onClick }: any) => {
  const bg = tone === 'ok'
    ? 'linear-gradient(180deg, rgba(111,181,133,0.09), var(--surface-2))'
    : 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)';
  return (
    <div onClick={onClick} style={{ position: 'relative', padding: pad != null ? pad : 18, borderRadius: 'var(--radius-lg)', background: bg, boxShadow: 'var(--clay)', cursor: onClick ? 'pointer' : 'default', ...style }}>
      {children}
    </div>
  );
};

export const MlBtn = ({ children, onClick, ico, variant, ac = AC, style, disabled, size }: any) => {
  const [p, setP] = React.useState(false);
  const I = ico ? MLIco[ico] : null;
  const prim = variant === 'primary', grn = variant === 'green', ghost = variant === 'ghost';
  const h = size === 'lg' ? 54 : size === 'sm' ? 40 : 48;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onPointerDown={() => !disabled && setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, height: h, padding: size === 'lg' ? '0 26px' : '0 18px', borderRadius: 'var(--radius-sm)',
        background: disabled ? 'var(--surface-2)' : prim ? `linear-gradient(180deg, ${ac.accent}, ${ac.primary})` : grn ? 'linear-gradient(180deg, #8FD3A6, var(--water-solid))' : ghost ? 'transparent' : 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))',
        boxShadow: disabled ? 'var(--clay-inset)' : ghost ? 'none' : (p ? (prim || grn ? 'inset 0 2px 6px rgba(0,0,0,0.2)' : 'var(--clay-press)') : (prim ? `inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 18px -8px ${ac.glow}` : grn ? 'inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 18px -8px rgba(111,181,133,0.6)' : 'var(--clay)')),
        color: disabled ? 'var(--ink-3)' : (prim || grn) ? '#fff' : ghost ? 'var(--ink-2)' : 'var(--ink-1)', fontSize: size === 'lg' ? 15.5 : 14, fontWeight: 800, whiteSpace: 'nowrap',
        transition: 'transform 180ms var(--ease-fluid), box-shadow 180ms', transform: p ? 'translateY(1px) scale(0.98)' : 'none', ...style,
      }}
    >
      {I && <I s={size === 'lg' ? 19 : 17} />}{children}
    </button>
  );
};

export const MlIconBtn = ({ children, onClick, round, hot, ac = AC, size = 44, ariaLabel }: any) => {
  const [p, setP] = React.useState(false);
  return (
    <button
      onClick={onClick} aria-label={ariaLabel}
      onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{ all: 'unset', cursor: 'pointer', width: size, height: size, borderRadius: round ? '50%' : 12, display: 'grid', placeItems: 'center', color: hot ? '#fff' : 'var(--ink-2)', background: hot ? `radial-gradient(circle at 32% 28%, ${ac.accent}, ${ac.primary})` : 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: p ? 'var(--clay-press)' : (hot ? `0 8px 16px -7px ${ac.glow}` : 'var(--clay)'), transition: 'transform 180ms var(--ease-fluid)', transform: p ? 'scale(0.92)' : 'none' }}
    >
      {children}
    </button>
  );
};

export const MlPill = ({ children, tone, style }: any) => {
  const m = tone === 'ok' ? { c: 'var(--water-deep)', bg: 'rgba(111,181,133,0.16)' }
    : tone === 'amber' ? { c: '#9A6F1E', bg: 'var(--amber-soft)' }
    : tone === 'accent' ? { c: 'var(--accent)', bg: 'rgba(201,138,87,0.14)' }
    : tone === 'blue' ? { c: '#4E76B0', bg: 'rgba(124,168,222,0.16)' }
    : { c: 'var(--ink-2)', bg: 'var(--surface-2)' };
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 'var(--radius-pill)', background: m.bg, boxShadow: tone ? 'none' : 'var(--clay-inset)', fontSize: 12, fontWeight: 800, color: m.c, whiteSpace: 'nowrap', ...style }}>{children}</span>;
};

export const MlPageHead = ({ ico, title, sub, ac = AC, onBack, right, mobile }: any) => {
  const I = ico ? MLIco[ico] : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: mobile ? 16 : 22, flexWrap: 'wrap' }}>
      {onBack && <MlIconBtn onClick={onBack} ac={ac} size={mobile ? 40 : 44} ariaLabel="Geri"><MLIco.back s={18} /></MlIconBtn>}
      {I && <span style={{ width: mobile ? 44 : 50, height: mobile ? 44 : 50, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: ac.primary, background: `${ac.primary}16`, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><I s={mobile ? 22 : 25} /></span>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <h1 style={{ margin: 0, fontSize: mobile ? 22 : 27, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>{title}</h1>
        {sub && <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)', marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
};

export const MlModal = ({ open, onClose, children, width = 620, sheet }: any) => {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: sheet ? 'end center' : 'center', padding: sheet ? 0 : 'clamp(12px,4vw,28px)', animation: 'mlFadeIn 200ms ease' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(58,46,28,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />
      <div style={{ position: 'relative', width: sheet ? '100%' : `min(${width}px, 100%)`, maxHeight: sheet ? '92vh' : '90vh', display: 'flex', flexDirection: 'column', borderRadius: sheet ? 'var(--radius-lg) var(--radius-lg) 0 0' : 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: '0 44px 90px -30px rgba(90,72,40,0.55), var(--clay)', overflow: 'hidden', animation: sheet ? 'mlSheetUp 360ms var(--ease-fluid)' : 'mlModalPop 340ms var(--ease-fluid)' }}>
        {children}
      </div>
    </div>
  );
};

export const MlModalHead = ({ ico, title, sub, onClose, ac = AC }: any) => {
  const I = ico ? MLIco[ico] : null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13, padding: 'clamp(16px,3vw,22px) clamp(16px,3vw,24px)', borderBottom: '1px solid var(--line)' }}>
      {I && <span style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 13, display: 'grid', placeItems: 'center', color: ac.primary, background: `${ac.primary}16`, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><I s={21} /></span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: 'clamp(17px,2.4vw,20px)', fontWeight: 800, color: 'var(--ink-1)' }}>{title}</h2>
        {sub && <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 500, lineHeight: 1.5 }}>{sub}</p>}
      </div>
      <button onClick={onClose} aria-label="Kapat" style={{ all: 'unset', cursor: 'pointer', width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', color: 'var(--ink-2)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: 'var(--clay)' }}><X size={18} /></button>
    </div>
  );
};

export const MlToast = ({ toast, ac = AC }: any) => {
  if (!toast) return null;
  const ok = toast.tone === 'ok';
  return (
    <div style={{ position: 'fixed', top: 18, left: 0, right: 0, zIndex: 1200, display: 'flex', justifyContent: 'center', pointerEvents: 'none', padding: '0 16px' }}>
      <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 'var(--radius)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: '0 24px 50px -18px rgba(90,72,40,0.42), var(--clay)', animation: 'mlToastIn 420ms var(--ease-fluid)', maxWidth: 'min(440px, calc(100vw - 32px))' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', color: '#fff', background: ok ? 'radial-gradient(circle at 32% 28%, #A6E3BC, var(--water-solid))' : `radial-gradient(circle at 32% 28%, ${ac.accent}, ${ac.primary})`, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.5)' }}>{ok ? <Check size={17} strokeWidth={2.6} /> : <Bell size={16} />}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink-1)' }}>{toast.title}</div>
          {toast.sub && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>{toast.sub}</div>}
        </div>
      </div>
    </div>
  );
};

export const MlNum = ({ value, money, size = 30, color, dur = 550 }: any) => {
  const v = useCountUp(value, dur, true);
  return <span style={{ fontSize: size, fontWeight: 800, color: color || 'var(--ink-1)', letterSpacing: '-0.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{money ? ML_MONEY(v) : ML_NUM(v)}</span>;
};

export const MlBar = ({ pct, tone, height = 8 }: any) => (
  <div style={{ position: 'relative', height, borderRadius: 99, background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, borderRadius: 99, background: tone || 'linear-gradient(90deg, var(--accent), var(--accent-2))', transition: 'width 600ms var(--ease-fluid)' }} />
  </div>
);

export const MlRing = ({ pct, size = 48, thickness = 6, color }: any) => {
  const v = useCountUp(pct, 700, true);
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  const col = color || (pct >= 100 ? 'var(--water-solid)' : 'var(--accent)');
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={thickness} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: 'stroke-dashoffset 120ms linear', filter: `drop-shadow(0 0 4px ${col}55)` }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: size * 0.26, fontWeight: 800, color: pct >= 100 ? 'var(--water-deep)' : 'var(--ink-1)' }}>{Math.round(v)}</div>
    </div>
  );
};

/* ─────────────── scoped tokens + keyframes (.ml-root — same clay palette as planlama) ─────────────── */
export const ML_CSS = `
.ml-root {
  --bg-0: #EFEAE0; --bg-1: #E9E3D6;
  --surface: #FCFAF5; --surface-2: #F5F1E8; --surface-hi: #FFFFFF;
  --ink-1: #3D382F; --ink-2: #908872; --ink-3: #BBB2A0;
  --line: rgba(90,72,40,0.07);
  --accent: #C98A57; --accent-2: #E0B776; --accent-glow: rgba(201,138,87,0.24);
  --water: rgba(124,191,140,0.30); --water-edge: rgba(110,184,128,0.55); --water-solid: #6FB585; --water-deep: #4E9E6B;
  --amber: #E0A33E; --amber-soft: rgba(224,163,62,0.16); --amber-glow: rgba(224,163,62,0.45);
  --ready: #6FB585; --ready-glow: rgba(111,181,133,0.5); --danger: #C0796A; --violet: #9B86D6; --sky: #7CA8DE;
  --radius: 24px; --radius-sm: 16px; --radius-lg: 32px; --radius-pill: 999px;
  --clay: inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16);
  --clay-press: inset 0 2px 5px rgba(178,160,128,0.32), inset 0 -1px 0 rgba(255,255,255,0.6), 0 2px 6px -4px rgba(150,128,96,0.2);
  --clay-inset: inset 0 2px 5px rgba(178,160,128,0.30), inset 0 -1px 0 rgba(255,255,255,0.55);
  --clay-flat: inset 0 1px 1px rgba(255,255,255,0.85), 0 4px 12px -7px rgba(150,128,96,0.28);
  --ease-fluid: cubic-bezier(.22, 1, .36, 1);
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  color: var(--ink-1);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  background:
    radial-gradient(120% 80% at 10% 0%, #F6F2EA 0%, transparent 55%),
    radial-gradient(120% 80% at 100% 100%, #E8E1D2 0%, transparent 55%),
    var(--bg-0);
}
body.mg-edge-body:has(.ml-root) { background: #EFEAE0 !important; }
.ml-root *, .ml-root *::before, .ml-root *::after { box-sizing: border-box; }
.ml-root button:focus-visible, .ml-root input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ml-root ::-webkit-scrollbar { width: 9px; height: 9px; }
.ml-root ::-webkit-scrollbar-thumb { background: rgba(150,128,96,0.22); border-radius: 99px; border: 2.5px solid transparent; background-clip: padding-box; }
.ml-root ::-webkit-scrollbar-track { background: transparent; }
.ml-root input::placeholder { color: var(--ink-3); }

@keyframes mlPopIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes mlFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes mlToastIn { from { opacity: 0; transform: translateY(-14px) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes mlModalPop { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes mlSheetUp { from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: none; } }
@keyframes mlLivePulse { 0%,100% { box-shadow: 0 0 0 0 rgba(111,181,133,0.55); } 70% { box-shadow: 0 0 0 6px rgba(111,181,133,0); } }
@media (prefers-reduced-motion: reduce) { .ml-root *, .ml-root *::before, .ml-root *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
`;

export const MlStyles = () => <style dangerouslySetInnerHTML={{ __html: ML_CSS }} />;
