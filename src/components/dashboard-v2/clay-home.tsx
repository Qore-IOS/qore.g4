/**
 * @fileoverview Dashboard (Ana Sayfa) — claymorphic cream presentation kit.
 * Animated SVG line chart (draw-in + area gradient + axis labels + hover),
 * progress ring, count-up hook and the shared clay chrome (Card / CardHead /
 * Pill / Tag / IconBtn / Segmented). Matches the Mal Kabul / Sipariş / Direkt
 * Transfer clay language via MK_C tokens.
 */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MK_C } from '@/components/mal-kabul/clay-kit';

const C = MK_C;
export const HOME_C = {
  ...C,
  sky: '#7CA8DE',
  skyDeep: '#5582C0',
  violet: '#9B86D6',
  violetDeep: '#7A66C0',
  ease: 'cubic-bezier(.22, 1, .36, 1)',
};

// ── formatting helpers ────────────────────────────────────────────────────────
export const fmtInt = (n: number) => Math.round(n).toLocaleString('tr-TR');
export const fmtTL = (n: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);

// ── count-up hook — animates from the previous value to the new target ────────
export function useCountUp(target: number, duration = 1000): number {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const start = fromRef.current;
    const delta = target - start;
    if (delta === 0) { setVal(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(start + delta * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

// ── smooth catmull-rom → bezier path ──────────────────────────────────────────
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

// ── animated line chart ───────────────────────────────────────────────────────
export function ClayLineChart({
  data, labels, height = 200, big = false, yTicks = false, animKey, accent = C.accent, accent2 = C.accent2,
}: {
  data: number[]; labels: string[]; height?: number; big?: boolean; yTicks?: boolean;
  animKey?: string; accent?: string; accent2?: string;
}) {
  const W = 800, H = height;
  const padL = yTicks ? 46 : 16, padR = 16, padT = 18, padB = 30;
  const maxV = Math.max(...data, 1);
  const niceMax = big ? Math.max(150, Math.ceil(maxV / 150) * 150) : maxV * 1.14;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = data.length;
  const pts = data.map((v, i) => ({
    x: padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
    y: padT + innerH - (v / niceMax) * innerH,
    v,
  }));
  const line = smoothPath(pts);
  const area = pts.length
    ? `${line} L ${pts[pts.length - 1].x} ${padT + innerH} L ${pts[0].x} ${padT + innerH} Z`
    : '';

  const pathRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!pathRef.current) return;
    const l = pathRef.current.getTotalLength();
    setLen(l); setDrawn(false);
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(r);
  }, [animKey, line]);

  const gid = 'lcg-' + (animKey || 'x').replace(/[^a-z0-9]/gi, '');
  const yLines = yTicks ? [0, 0.25, 0.5, 0.75, 1] : [];

  // thin x labels so they never overlap (always keep first + last)
  const step = Math.max(1, Math.ceil(n / (big ? 12 : 8)));
  const showLabel = (i: number) => i === 0 || i === n - 1 || i % step === 0;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={accent} stopOpacity="0.34" />
            <stop offset="0.6" stopColor={accent2} stopOpacity="0.12" />
            <stop offset="1" stopColor={accent2} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={gid + '-s'} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={accent2} />
            <stop offset="1" stopColor={accent} />
          </linearGradient>
          <filter id={gid + '-g'} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {yLines.map((t, i) => {
          const y = padT + innerH - t * innerH;
          return <line key={i} x1={padL} x2={W - padR} y1={y} y2={y} stroke={C.line} strokeWidth="1" strokeDasharray="2 6" />;
        })}
        {yTicks && yLines.map((t, i) => (
          <text key={'yl' + i} x={padL - 10} y={padT + innerH - t * innerH + 4} textAnchor="end"
            fontSize="13" fontWeight="600" fill={C.ink3}>{Math.round(niceMax * t)}</text>
        ))}

        {area && (
          <path d={area} fill={`url(#${gid})`} opacity={drawn ? 1 : 0}
            style={{ transition: `opacity 900ms 250ms ${HOME_C.ease}` }} />
        )}

        <path ref={pathRef} d={line} fill="none" stroke={`url(#${gid}-s)`} strokeWidth={big ? 3.5 : 3}
          strokeLinecap="round" strokeLinejoin="round" filter={`url(#${gid}-g)`}
          style={{ strokeDasharray: len, strokeDashoffset: drawn ? 0 : len, transition: `stroke-dashoffset 1300ms ${HOME_C.ease}` }} />

        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 6 : 4}
            fill={C.surfaceHi} stroke={accent} strokeWidth="3" opacity={drawn ? 1 : 0}
            style={{ transition: `opacity 400ms ${300 + i * 60}ms ${HOME_C.ease}, r 180ms ${HOME_C.ease}` }} />
        ))}

        {hover != null && pts[hover] && (
          <g>
            <line x1={pts[hover].x} x2={pts[hover].x} y1={padT} y2={padT + innerH} stroke={accent} strokeWidth="1.4" strokeDasharray="3 4" opacity="0.5" />
            <circle cx={pts[hover].x} cy={pts[hover].y} r="7" fill={accent} stroke={C.surfaceHi} strokeWidth="3" />
          </g>
        )}

        {labels.map((lb, i) => {
          if (!showLabel(i)) return null;
          const x = padL + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
          return <text key={i} x={x} y={H - 8} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
            fontSize={big ? 14 : 12} fontWeight="600" fill={hover === i ? accent : C.ink2}
            style={{ transition: 'fill 180ms' }}>{lb}</text>;
        })}
      </svg>

      {hover != null && pts[hover] && (
        <div style={{
          position: 'absolute', top: 0, left: `${(pts[hover].x / W) * 100}%`, transform: 'translateX(-50%)',
          padding: '7px 13px', borderRadius: C.radiusPill, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
          boxShadow: `0 12px 26px -10px rgba(90,72,40,0.5), ${C.clayFlat}`, pointerEvents: 'none', whiteSpace: 'nowrap',
          fontSize: 13, fontWeight: 800, color: C.ink1,
        }}>
          <span style={{ color: accent }}>{labels[hover]}</span> · {fmtInt(data[hover])}
        </div>
      )}
    </div>
  );
}

// ── animated progress ring ────────────────────────────────────────────────────
export function Ring({ pct, size = 86, stroke = 10, color, track, children, delay = 0 }: {
  pct: number; size?: number; stroke?: number; color: string; track?: string; children?: React.ReactNode; delay?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), delay + 60); return () => clearTimeout(t); }, [pct, delay]);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track || C.surface2} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={show ? c * (1 - pct) : c}
          style={{ transition: `stroke-dashoffset 1100ms ${HOME_C.ease}`, filter: `drop-shadow(0 0 5px ${color}55)` }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</div>
    </div>
  );
}

// ── clay chrome ───────────────────────────────────────────────────────────────
export function Card({ children, tone, onClick, hover, pad = 18, style }: {
  children: React.ReactNode; tone?: 'ok' | 'brown'; onClick?: () => void; hover?: boolean; pad?: number; style?: React.CSSProperties;
}) {
  const [h, setH] = useState(false);
  const bg = tone === 'ok'
    ? `linear-gradient(180deg, rgba(111,181,133,0.08), ${C.surface2})`
    : tone === 'brown'
      ? `linear-gradient(165deg, ${C.accent} 0%, #B5784A 60%, #A66C40 100%)`
      : `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`;
  return (
    <div onClick={onClick} onPointerEnter={() => hover && setH(true)} onPointerLeave={() => setH(false)}
      style={{
        position: 'relative', padding: pad, borderRadius: C.radiusLg, background: bg,
        boxShadow: tone === 'brown'
          ? `inset 0 1px 0 rgba(255,255,255,0.25), 0 18px 40px -18px ${C.accentGlow}, 0 4px 12px -4px rgba(150,128,96,0.3)`
          : (hover && h ? `${C.clay}, 0 0 0 1.5px ${C.accent}` : C.clay),
        cursor: onClick ? 'pointer' : 'default', transition: `box-shadow 240ms ${HOME_C.ease}, transform 240ms ${HOME_C.ease}`,
        transform: hover && h ? 'translateY(-2px)' : 'none',
        ...style,
      }}>
      {children}
    </div>
  );
}

export function CardHead({ ico, title, tone, right, flush, onLight }: {
  ico: React.ReactNode; title: string; tone?: 'accent' | 'amber' | 'ok' | 'sky' | 'violet'; right?: React.ReactNode; flush?: boolean; onLight?: boolean;
}) {
  const map: Record<string, { c: string; bg: string }> = {
    accent: { c: C.accent, bg: `${C.accent}16` },
    amber: { c: C.amber, bg: C.amberSoft },
    ok: { c: C.waterDeep, bg: 'rgba(111,181,133,0.14)' },
    sky: { c: HOME_C.skyDeep, bg: 'rgba(124,168,222,0.16)' },
    violet: { c: HOME_C.violetDeep, bg: 'rgba(155,134,214,0.16)' },
  };
  const t = map[tone || 'accent'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: flush ? 0 : 2 }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center', color: onLight ? '#fff' : t.c, background: onLight ? 'rgba(255,255,255,0.22)' : t.bg, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}>{ico}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: onLight ? '#fff' : C.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{title}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}

export function Pill({ children, onLight }: { children: React.ReactNode; onLight?: boolean }) {
  return <span style={{ padding: '5px 12px', borderRadius: C.radiusPill, background: onLight ? 'rgba(255,255,255,0.22)' : C.surface2, boxShadow: onLight ? 'none' : C.clayInset, fontSize: 12.5, fontWeight: 700, color: onLight ? '#fff' : C.ink2, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function Tag({ children, tone, bg }: { children: React.ReactNode; tone: string; bg: string }) {
  return <span style={{ padding: '6px 12px', borderRadius: C.radiusPill, background: bg, color: tone, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function ClayIconBtn({ children, onClick, round, spin, onLight }: {
  children: React.ReactNode; onClick?: () => void; round?: boolean; spin?: boolean; onLight?: boolean;
}) {
  const [s, setS] = useState(false);
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick?.(); if (spin) { setS(true); setTimeout(() => setS(false), 700); } }}
      style={{ all: 'unset', cursor: 'pointer', width: 38, height: 38, borderRadius: round ? '50%' : 12, display: 'grid', placeItems: 'center', color: onLight ? '#fff' : C.ink2, background: onLight ? 'rgba(255,255,255,0.2)' : `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: onLight ? 'none' : C.clayFlat, transition: `transform 200ms ${HOME_C.ease}` }}
      onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
      onPointerUp={(e) => (e.currentTarget.style.transform = '')}
      onPointerLeave={(e) => (e.currentTarget.style.transform = '')}>
      <span style={{ display: 'inline-flex', animation: s ? `mkSpin 0.7s ${HOME_C.ease}` : 'none' }}>{children}</span>
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { v: T; l: string }[];
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 3, padding: 4, borderRadius: C.radiusPill, background: C.surface2, boxShadow: C.clayInset }}>
      {options.map(o => {
        const on = value === o.v;
        return (
          <button key={o.v} onClick={(e) => { e.stopPropagation(); onChange(o.v); }}
            style={{ all: 'unset', cursor: 'pointer', minWidth: 32, height: 32, padding: '0 11px', borderRadius: C.radiusPill, display: 'grid', placeItems: 'center', background: on ? `linear-gradient(180deg, ${C.accent2}, ${C.accent})` : 'transparent', boxShadow: on ? `0 5px 11px -4px ${C.accentGlow}` : 'none', color: on ? '#fff' : C.ink2, fontSize: 13, fontWeight: 800, transition: `all 200ms ${HOME_C.ease}` }}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

// ── animated progress bar ─────────────────────────────────────────────────────
export function ClayBar({ pct, tone = C.waterSolid, height = 8 }: { pct: number; tone?: string; height?: number }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW(pct), 80); return () => clearTimeout(t); }, [pct]);
  return (
    <div style={{ height, borderRadius: 99, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, w))}%`, borderRadius: 99, background: `linear-gradient(90deg, ${tone}, #8FD3A6)`, transition: `width 1000ms ${HOME_C.ease}` }} />
    </div>
  );
}
