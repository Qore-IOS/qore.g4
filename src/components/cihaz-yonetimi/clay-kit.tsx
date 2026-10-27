/**
 * @fileoverview Cihaz Yönetimi — claymorphic cream design kit.
 * @description Shared clay primitives for the device-management analytics
 * panels (Cihaz Yönetim Merkezi, Arıza İstatistikleri, Kurum Ziyaret Analizi,
 * Yedek Parça Analizi, Performans Analizi). Faithful TSX port of the demo
 * `window.CY` kit, built on the established cream-clay MK_C tokens so it stays
 * visually consistent with Mal Kabul / Sipariş / Direkt Transfer / Dashboard.
 *
 * Everything here is self-contained (inline styles use JS token values, not
 * CSS vars) and responsive-first: charts measure their container and never
 * overflow, KPI tiles keep a calm fixed scale, and all motion respects
 * prefers-reduced-motion.
 */
'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Box, BarChart3, Search, ChevronRight, ChevronDown, Building2, Calendar,
  Users, Wrench, FlaskConical, AlertTriangle, Clock, ShieldAlert, MapPin,
  Server, Monitor, Warehouse, ChevronLeft, Gauge, Package, Activity,
  TrendingUp, FileText, CheckCircle2, Sparkles, type LucideIcon,
} from 'lucide-react';
import { MK_C } from '@/components/mal-kabul/clay-kit';
import { useCountUpFlash, prefersReducedMotion } from '@/components/dashboard-v2/clay-home';

// ── tokens ────────────────────────────────────────────────────────────────────
export const C = MK_C;

/** Default warm accent (matches the demo's `ac`). */
export const AC = { primary: MK_C.accent, accent: MK_C.accent2, glow: MK_C.accentGlow } as const;

/** Role / category palette used across the analytics panels. */
export const PAL = {
  tech: '#7CA8DE',   // teknik servis (sky)
  app: '#4E9E6B',    // aplikasyon (water deep)
  admin: '#9B86D6',  // admin (violet)
  ready: '#6FB585',
  amber: 'var(--qc-amber)',
  danger: 'var(--qc-danger)',
  sky: '#7CA8DE',
  violet: '#9B86D6',
} as const;

export type Accent = { primary: string; accent: string; glow: string };
export type Mode = 'mobile' | 'tablet' | 'wide';
export type Tone = 'default' | 'tech' | 'app' | 'admin' | 'ok' | 'amber' | 'danger';

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

// ── number formatting ──────────────────────────────────────────────────────────
export const fmtInt = (n: number) => Math.round(n).toLocaleString('tr-TR');

// ── responsive mode hook ───────────────────────────────────────────────────────
export function useMode(): Mode {
  const get = (): Mode => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
    return w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'wide';
  };
  const [m, setM] = useState<Mode>('wide');
  useEffect(() => {
    const h = () => setM(get());
    h();
    window.addEventListener('resize', h);
    window.addEventListener('orientationchange', h);
    return () => {
      window.removeEventListener('resize', h);
      window.removeEventListener('orientationchange', h);
    };
  }, []);
  return m;
}

/** Measure a container's content width (for overflow-proof SVG charts). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? el.clientWidth;
      setW(cw);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ── keyframes + global niceties (inject once per page) ─────────────────────────
export function CyStyles() {
  return (
    <style>{`
      @keyframes cyPopIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes cyRise { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }
      @keyframes cyFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cyGrowW { from { width: 0 !important; } }
      @keyframes cyDraw { to { stroke-dashoffset: 0; } }
      @keyframes cyCountPop { 0% { transform: scale(0.6); opacity: 0; } 55% { transform: scale(1.16); } 100% { transform: scale(1); opacity: 1; } }
      @keyframes cyPeakPop { 0% { opacity: 0; transform: translateY(6px) scale(0.6); } 60% { transform: translateY(0) scale(1.12); } 100% { opacity: 1; transform: scale(1); } }
      @keyframes cySpin { to { transform: rotate(360deg); } }
      .cy-scope ::-webkit-scrollbar { width: 9px; height: 9px; }
      .cy-scope ::-webkit-scrollbar-thumb { background: rgba(150,128,96,0.22); border-radius: 99px; border: 2.5px solid transparent; background-clip: padding-box; }
      .cy-scope ::-webkit-scrollbar-track { background: transparent; }
      .cy-row-hover { transition: background 180ms ${EASE}; }
      .cy-row-hover:hover { background: ${C.surfaceHi} !important; }
      @media (prefers-reduced-motion: reduce) {
        .cy-scope *, .clay-shell * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
      }
    `}</style>
  );
}

// ── page wrapper: cream shell + centered, responsive inner column ──────────────
// `max` is intentionally wide (1480, matching the demo) so the content fills the
// viewport on laptops/desktops without leaving large empty gutters on the sides.
export function ClayPage({ children, max = 1480 }: { children: React.ReactNode; max?: number }) {
  return (
    <>
      <CyStyles />
      <div aria-hidden className="clay-shell-backdrop" />
      <div className="clay-shell cy-scope" style={{ width: '100%' }}>
        <div
          style={{
            width: '100%',
            maxWidth: max,
            margin: '0 auto',
            padding: '20px clamp(12px, 2.4vw, 26px) 80px',
            boxSizing: 'border-box',
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

// ── icon registry (string key → lucide) ────────────────────────────────────────
export const ICON: Record<string, LucideIcon> = {
  box: Box, chart: BarChart3, search: Search, chevR: ChevronRight, chevD: ChevronDown,
  building: Building2, calendar: Calendar, users: Users, wrench: Wrench, flask: FlaskConical,
  alert: AlertTriangle, clock: Clock, shield: ShieldAlert, pin: MapPin, server: Server,
  monitor: Monitor, warehouse: Warehouse, back: ChevronLeft, gauge: Gauge, package: Package,
  activity: Activity, trend: TrendingUp, file: FileText, check: CheckCircle2, sparkles: Sparkles,
};

// ── animated count-up number ───────────────────────────────────────────────────
export function StatNum({
  value, size = 30, color = C.ink1, suffix = '', weight = 800,
}: { value: number; size?: number; color?: string; suffix?: string; weight?: number }) {
  const { value: v, flash } = useCountUpFlash(value, 900);
  return (
    <span
      key={flash}
      style={{
        fontSize: size, fontWeight: weight, lineHeight: 1, color,
        letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
        display: 'inline-block', animation: 'cyCountPop 520ms ' + EASE,
      }}
    >
      {fmtInt(v)}{suffix}
    </span>
  );
}

// ── tone helpers ────────────────────────────────────────────────────────────────
function toneColor(tone: Tone | undefined, ac: Accent): string {
  switch (tone) {
    case 'amber': return C.amber;
    case 'danger': return C.danger;
    case 'ok': return C.waterDeep;
    case 'tech': return PAL.tech;
    case 'app': return C.waterDeep;
    case 'admin': return PAL.violet;
    default: return ac.primary;
  }
}
function toneBg(tone: Tone | undefined, ac: Accent): string {
  switch (tone) {
    case 'amber': return C.amberSoft;
    case 'danger': return 'rgba(192,121,106,0.12)';
    case 'ok': return 'rgba(111,181,133,0.14)';
    case 'tech': return 'rgba(124,168,222,0.14)';
    case 'app': return 'rgba(78,158,107,0.14)';
    case 'admin': return 'rgba(155,134,214,0.14)';
    default: return ac.primary + '16';
  }
}

// ── Card ────────────────────────────────────────────────────────────────────────
export function Card({
  children, tone, style, pad, anim = true, className,
}: { children: React.ReactNode; tone?: Tone; style?: React.CSSProperties; pad?: number; anim?: boolean; className?: string }) {
  const bg =
    tone === 'ok' ? `linear-gradient(180deg, rgba(111,181,133,0.08), ${C.surface2})`
    : tone === 'amber' ? `linear-gradient(180deg, rgba(224,163,62,0.08), ${C.surface2})`
    : tone === 'danger' ? `linear-gradient(180deg, rgba(192,121,106,0.08), ${C.surface2})`
    : `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`;
  return (
    <div
      className={className}
      style={{
        position: 'relative', padding: pad != null ? pad : 18, borderRadius: C.radiusLg,
        background: bg, boxShadow: C.clay, animation: anim ? `cyRise 480ms ${EASE} both` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── CardHead ──────────────────────────────────────────────────────────────────
export function CardHead({
  ico, title, sub, ac = AC, right, tone,
}: { ico?: string; title: string; sub?: string; ac?: Accent; right?: React.ReactNode; tone?: Tone }) {
  const I = ico ? ICON[ico] : null;
  const col = toneColor(tone, ac);
  const bg = toneBg(tone, ac);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
      {I && (
        <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center', color: col, background: bg, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}>
          <I size={20} />
        </span>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-0.01em', color: C.ink1, lineHeight: 1.2 }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink2, marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// ── Pill ────────────────────────────────────────────────────────────────────────
export function Pill({ children, tone }: { children: React.ReactNode; tone?: 'danger' | 'ok' | 'amber' | 'tech' }) {
  const c = tone === 'danger' ? C.danger : tone === 'ok' ? C.waterDeep : tone === 'amber' ? '#9A6F1E' : tone === 'tech' ? PAL.tech : C.ink2;
  const bg = tone === 'danger' ? 'rgba(192,121,106,0.14)' : tone === 'ok' ? 'rgba(111,181,133,0.14)' : tone === 'amber' ? C.amberSoft : tone === 'tech' ? 'rgba(124,168,222,0.14)' : C.surface2;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: C.radiusPill, background: bg, boxShadow: tone ? 'none' : C.clayInset, fontSize: 12.5, fontWeight: 700, color: c, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// ── KPI tile (calm fixed scale, never oversized) ────────────────────────────────
export function KpiTile({
  ico, label, value, suffix, unit, foot, tone, ac = AC, delay = 0, onClick,
}: {
  ico?: string; label: string; value: number | string; suffix?: string; unit?: string;
  foot?: React.ReactNode; tone?: Tone; ac?: Accent; delay?: number; onClick?: () => void;
}) {
  const col = toneColor(tone, ac);
  const bg = toneBg(tone, ac);
  const I = ico ? ICON[ico] : null;
  const numeric = typeof value === 'number';
  const [hover, setHover] = useState(false);
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
        </div>
        {I && (
          <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 11, display: 'grid', placeItems: 'center', color: col, background: bg, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}>
            <I size={19} />
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        {numeric
          ? <StatNum value={value as number} suffix={suffix} size={30} color={tone === 'danger' ? C.danger : C.ink1} />
          : <span style={{ fontSize: 22, fontWeight: 800, color: C.ink1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</span>}
        {unit && <span style={{ fontSize: 13, fontWeight: 600, color: C.ink3 }}>{unit}</span>}
      </div>
      {foot && <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{foot}</div>}
    </>
  );
  const cardStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 10,
    animation: `cyRise 460ms ${EASE} ${delay}ms both`,
    transition: `transform 200ms ${EASE}, box-shadow 200ms ${EASE}`,
    transform: onClick && hover ? 'translateY(-2px)' : 'none',
  };
  if (onClick) {
    return (
      <button
        type="button" onClick={onClick}
        onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
        style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', position: 'relative', padding: 16, borderRadius: C.radiusLg, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: hover ? `${C.clay}, 0 0 0 1.5px ${col}55` : C.clay, ...cardStyle }}
      >
        {body}
      </button>
    );
  }
  return <Card pad={16} anim={false} style={cardStyle}>{body}</Card>;
}

// ── small info tile (text value instead of count-up) ───────────────────────────
export function MiniInfo({ ico, label, text, ac = AC, delay = 0 }: { ico?: string; label: string; text: string; ac?: Accent; delay?: number }) {
  const I = ico ? ICON[ico] : null;
  return (
    <Card pad={16} anim={false} style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: `cyRise 460ms ${EASE} ${delay}ms both` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
        </div>
        {I && <span style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', color: ac.primary, background: ac.primary + '16', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><I size={19} /></span>}
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: C.ink1, letterSpacing: '-0.01em' }}>{text}</div>
    </Card>
  );
}

// ── buttons ──────────────────────────────────────────────────────────────────
export function NavBtn({ ico, label, grad, onClick }: { ico?: string; label: string; grad: string; onClick?: () => void }) {
  const [p, setP] = useState(false);
  const I = ico ? ICON[ico] : null;
  return (
    <button
      type="button" onClick={onClick}
      onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', gap: 9,
        height: 46, padding: '0 16px', borderRadius: C.radiusSm, background: grad,
        boxShadow: p ? 'inset 0 2px 6px rgba(0,0,0,0.18)' : 'inset 0 1px 0 rgba(255,255,255,0.3), 0 8px 16px -8px rgba(80,60,30,0.4)',
        color: '#fff', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap',
        transition: `transform 200ms ${EASE}, box-shadow 200ms ${EASE}`, transform: p ? 'translateY(1px) scale(0.98)' : 'none',
      }}
    >
      {I && <I size={18} />}{label}
    </button>
  );
}

export function GhostBtn({ children, onClick, ac = AC, active }: { children: React.ReactNode; onClick?: () => void; ac?: Accent; active?: boolean }) {
  const [p, setP] = useState(false);
  return (
    <button
      type="button" onClick={onClick}
      onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', gap: 8,
        height: 44, padding: '0 16px', borderRadius: C.radiusSm,
        background: active ? ac.primary + '16' : `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
        boxShadow: active ? `inset 0 0 0 1.5px ${ac.primary}66` : (p ? C.clayPress : C.clay),
        color: active ? ac.primary : C.ink1, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap',
        transition: `all 200ms ${EASE}`, transform: p ? 'translateY(1px) scale(0.985)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

export function IconBtn({ children, onClick, round }: { children: React.ReactNode; onClick?: () => void; round?: boolean }) {
  const [p, setP] = useState(false);
  return (
    <button
      type="button" onClick={onClick}
      onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: 'pointer', width: 44, height: 44, borderRadius: round ? '50%' : 12, display: 'grid', placeItems: 'center',
        color: C.ink2, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: p ? C.clayPress : C.clay,
        transition: `transform 180ms ${EASE}`, transform: p ? 'scale(0.94)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

// ── segmented control ──────────────────────────────────────────────────────────
export function Segmented<T extends string>({
  value, onChange, options, ac = AC,
}: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[]; ac?: Accent }) {
  return (
    <div style={{ display: 'inline-flex', gap: 3, padding: 4, borderRadius: C.radiusPill, background: C.surface2, boxShadow: C.clayInset }}>
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={o.v} type="button" onClick={() => onChange(o.v)}
            style={{
              all: 'unset', cursor: 'pointer', minWidth: 30, height: 32, padding: '0 14px', borderRadius: C.radiusPill, display: 'grid', placeItems: 'center',
              background: on ? `linear-gradient(180deg, ${ac.accent}, ${ac.primary})` : 'transparent',
              boxShadow: on ? `0 5px 11px -4px ${ac.glow}` : 'none', color: on ? '#fff' : C.ink2,
              fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', transition: `all 200ms ${EASE}`,
            }}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

// ── page header with back ──────────────────────────────────────────────────────
export function PageHead({
  ico, title, sub, ac = AC, onBack, right, mobile,
}: { ico?: string; title: string; sub?: string; ac?: Accent; onBack?: () => void; right?: React.ReactNode; mobile?: boolean }) {
  const I = ico ? ICON[ico] : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
      {onBack && <GhostBtn onClick={onBack} ac={ac}><ChevronLeft size={16} /> Geri</GhostBtn>}
      <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(circle at 32% 28%, ${ac.accent}, ${ac.primary})`, boxShadow: `inset 0 1px 1px rgba(255,255,255,0.4), 0 10px 20px -8px ${ac.glow}` }}>
        {I && <I size={24} />}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h1 style={{ margin: 0, fontSize: mobile ? 21 : 25, fontWeight: 800, letterSpacing: '-0.02em', color: C.ink1, lineHeight: 1.15 }}>{title}</h1>
        {sub && <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink2, marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// ── horizontal bar list ─────────────────────────────────────────────────────────
export function HBar({
  items, color = AC.primary, labelW = 130, max,
}: { items: { label: string; v: number; color?: string }[]; color?: string; labelW?: number; max?: number }) {
  const mx = max ?? Math.max(1, ...items.map((i) => i.v));
  const reduce = prefersReducedMotion();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {items.map((it, i) => {
        const pct = Math.max(2, (it.v / mx) * 100);
        const barCol = it.color || color;
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: `${labelW}px 1fr auto`, gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.label}>{it.label}</span>
            <div style={{ height: 18, borderRadius: 99, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden', minWidth: 0 }}>
              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: `linear-gradient(90deg, ${barCol}cc, ${barCol})`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35)`, animation: reduce ? undefined : `cyGrowW 900ms ${EASE} ${i * 70}ms both`, position: 'relative' }} />
            </div>
            <span style={{ minWidth: 30, textAlign: 'right', fontSize: 14, fontWeight: 800, color: C.ink1, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(it.v)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── donut ────────────────────────────────────────────────────────────────────
export function Donut({
  segments, size = 150, thickness = 26, center,
}: { segments: { v: number; color: string }[]; size?: number; thickness?: number; center?: React.ReactNode }) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.v, 0));
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const reduce = prefersReducedMotion();
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={C.surface2} strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.v / total) * circ;
          const dash = `${len} ${circ - len}`;
          const el = (
            <circle
              key={i} cx={cx} cy={cx} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeLinecap="round"
              strokeDasharray={dash} strokeDashoffset={-offset}
              style={reduce ? undefined : { transition: 'stroke-dasharray 900ms ' + EASE }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {center && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{center}</div>}
    </div>
  );
}

export function Legend({ color, label, val }: { color: string; label: string; val?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ width: 12, height: 12, borderRadius: 4, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink1 }}>{label}</span>
      {val && <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink2 }}>{val}</span>}
    </div>
  );
}

// ── line / area chart (measures container → never overflows) ────────────────────
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    const c1x = p1.x + (p2.x - p0.x) * t, c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t, c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function LineChart({
  data, labels, ac = AC, height = 200, yTicks = false,
}: { data: number[]; labels: string[]; ac?: Accent; height?: number; yTicks?: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const reduce = prefersReducedMotion();
  const padL = yTicks ? 36 : 10;
  const padR = 12, padT = 14, padB = 26;
  const W = Math.max(0, w);
  const innerW = Math.max(1, W - padL - padR);
  const innerH = Math.max(1, height - padT - padB);
  const max = Math.max(1, ...data);
  const min = Math.min(...data, 0);
  const span = Math.max(1, max - min);
  const pts = data.map((d, i) => ({
    x: padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
    y: padT + innerH - ((d - min) / span) * innerH,
  }));
  const line = smoothPath(pts);
  const area = pts.length ? `${line} L ${pts[pts.length - 1].x} ${padT + innerH} L ${pts[0].x} ${padT + innerH} Z` : '';
  const peakIdx = data.indexOf(Math.max(...data));
  const ticks = yTicks ? [0, 0.5, 1].map((f) => ({ y: padT + innerH - f * innerH, val: Math.round(min + f * span) })) : [];
  const uid = React.useId().replace(/[:]/g, '');

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {W > 0 && (
        <svg width={W} height={height} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <linearGradient id={`cyStroke${uid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={ac.accent} />
              <stop offset="100%" stopColor={ac.primary} />
            </linearGradient>
            <linearGradient id={`cyArea${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ac.primary} stopOpacity={0.22} />
              <stop offset="100%" stopColor={ac.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke={C.line} strokeWidth={1} strokeDasharray="3 5" />
              <text x={padL - 8} y={t.y + 4} textAnchor="end" fontSize={10.5} fontWeight={700} fill={C.ink3}>{fmtInt(t.val)}</text>
            </g>
          ))}
          {area && <path d={area} fill={`url(#cyArea${uid})`} />}
          {line && (
            <path
              d={line} fill="none" stroke={`url(#cyStroke${uid})`} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
              style={reduce ? undefined : { strokeDasharray: 2600, strokeDashoffset: 2600, animation: `cyDraw 1100ms ${EASE} forwards` }}
            />
          )}
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={i === peakIdx ? 5 : 3.5} fill={i === peakIdx ? ac.primary : C.surfaceHi} stroke={ac.primary} strokeWidth={2}
              style={reduce ? undefined : { opacity: 0, animation: `cyFadeIn 360ms ${EASE} ${600 + i * 50}ms forwards` }} />
          ))}
          {labels.map((lb, i) => (
            <text key={i} x={pts[i]?.x ?? 0} y={height - 8} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.ink3}>{lb}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

// ── role chip ───────────────────────────────────────────────────────────────────
export function RoleChip({ role }: { role: 'tech' | 'app' | 'admin' | string }) {
  const m = role === 'tech'
    ? { c: PAL.tech, l: 'Teknik', bg: 'rgba(124,168,222,0.16)' }
    : role === 'app'
    ? { c: C.waterDeep, l: 'Aplikasyon', bg: 'rgba(78,158,107,0.16)' }
    : { c: PAL.violet, l: 'Admin', bg: 'rgba(155,134,214,0.16)' };
  return <span style={{ padding: '4px 11px', borderRadius: C.radiusPill, background: m.bg, color: m.c, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.l}</span>;
}

// ── clay search input ──────────────────────────────────────────────────────────
export function ClaySearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: C.ink3, display: 'grid', placeItems: 'center' }}><Search size={18} /></span>
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', height: 50, padding: '0 16px 0 46px', borderRadius: C.radiusPill,
          border: 'none', background: C.surface2, boxShadow: C.clayInset, color: C.ink1, fontSize: 14.5, fontWeight: 500, fontFamily: 'inherit', outline: 'none',
        }}
      />
    </div>
  );
}

// ── full-page clay loader ───────────────────────────────────────────────────────
export function ClayLoader({ label = 'Yükleniyor…' }: { label?: string }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '50vh', gap: 14 }}>
      <span style={{ width: 44, height: 44, borderRadius: '50%', border: `3px solid ${C.surface2}`, borderTopColor: AC.primary, animation: 'cySpin 800ms linear infinite' }} />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink2 }}>{label}</span>
    </div>
  );
}
