/**
 * @fileoverview Dashboard (Ana Sayfa) — claymorphic cream presentation kit.
 * Animated SVG line chart (draw-in + area gradient + axis labels + hover),
 * progress ring, count-up hook and the shared clay chrome (Card / CardHead /
 * Pill / Tag / IconBtn / Segmented). Matches the Mal Kabul / Sipariş / Direkt
 * Transfer clay language via MK_C tokens.
 */
'use client';

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MK_C } from '@/components/mal-kabul/clay-kit';
import { haptic } from '@/lib/haptics';

const C = MK_C;
export const HOME_C = {
  ...C,
  sky: 'var(--qc-sky)',
  skyDeep: 'var(--qc-sky-deep)',
  violet: 'var(--qc-violet)',
  violetDeep: 'var(--qc-violet-deep)',
  ease: 'cubic-bezier(.22, 1, .36, 1)',
};

// ── girdi yeteneği ────────────────────────────────────────────────────────────
// apple-design/references/adaptive.md: etkileşim kararları ekran genişliğine
// değil girdi yeteneğine göre verilir. Hover yalnızca gerçek imleçte, 44px
// dokunma hedefi yalnızca kaba işaretçide devreye girer.
function useMediaQuery(queryString: string, serverValue = false): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mql = window.matchMedia(queryString);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [queryString]);
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return serverValue;
    return window.matchMedia(queryString).matches;
  }, [queryString, serverValue]);
  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}

/** Gerçek imleç: hover ve yoğun (küçük) kontrol geometrisi bu yetenekte açılır. */
export const useHoverCapable = () => useMediaQuery('(hover: hover) and (pointer: fine)');
/** Kaba işaretçi (parmak): kontroller 44px'lik hedefe büyür. */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)');
/** Kullanıcı hareketi azaltmak istiyor mu — canlı olarak izlenir. */
export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

// ── formatting helpers ────────────────────────────────────────────────────────
export const fmtInt = (n: number) => Math.round(n).toLocaleString('tr-TR');
export const fmtTL = (n: number) =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);

// ── respect prefers-reduced-motion (a11y — HIGH) ──────────────────────────────
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ── count-up hook — animates from the previous value to the new target ────────
// Returns the live value plus a monotonically increasing `flash` token that
// bumps whenever the target changes, so KPIs can pulse to draw the eye.
export function useCountUp(target: number, duration = 1000): number {
  return useCountUpFlash(target, duration).value;
}

export function useCountUpFlash(target: number, duration = 1000): { value: number; flash: number } {
  const [val, setVal] = useState(0);
  const [flash, setFlash] = useState(0);
  const fromRef = useRef(0);
  const firstRef = useRef(true);
  useEffect(() => {
    const start = fromRef.current;
    const delta = target - start;
    if (!firstRef.current && delta !== 0) setFlash(f => f + 1);
    firstRef.current = false;
    if (delta === 0) { setVal(target); return; }
    if (prefersReducedMotion()) { setVal(target); fromRef.current = target; return; }
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
  return { value: val, flash };
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
  showPeak = true, showAvg = true,
}: {
  data: number[]; labels: string[]; height?: number; big?: boolean; yTicks?: boolean;
  animKey?: string; accent?: string; accent2?: string; showPeak?: boolean; showAvg?: boolean;
}) {
  const W = 800, H = height;
  const padL = yTicks ? 46 : 16, padR = 16, padT = 22, padB = 30;
  const maxV = Math.max(...data, 1);
  const niceMax = big ? Math.max(150, Math.ceil(maxV / 150) * 150) : maxV * 1.18;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = data.length;
  const sum = data.reduce((a, b) => a + b, 0);
  const avg = n ? sum / n : 0;
  const peakIdx = data.reduce((best, v, i) => (v > data[best] ? i : best), 0);
  const hasSignal = sum > 0 && n > 1;
  const pts = data.map((v, i) => ({
    x: padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
    y: padT + innerH - (v / niceMax) * innerH,
    v,
  }));
  const line = smoothPath(pts);
  const area = pts.length
    ? `${line} L ${pts[pts.length - 1].x} ${padT + innerH} L ${pts[0].x} ${padT + innerH} Z`
    : '';
  const avgY = padT + innerH - (avg / niceMax) * innerH;

  const pathRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!pathRef.current) return;
    const l = pathRef.current.getTotalLength();
    setLen(l); setDrawn(false);
    if (prefersReducedMotion()) { setDrawn(true); return; }
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(r);
  }, [animKey, line]);

  const gid = 'lcg-' + (animKey || 'x').replace(/[^a-z0-9]/gi, '');
  const yLines = yTicks ? [0, 0.25, 0.5, 0.75, 1] : [];

  // thin x labels so they never overlap (always keep first + last)
  const step = Math.max(1, Math.ceil(n / (big ? 12 : 8)));
  const showLabel = (i: number) => i === 0 || i === n - 1 || i % step === 0;

  // Doğrudan manipülasyon: imleç *ve* parmak aynı kod yolundan okunur. Parmakla
  // basılı tutup kaydırınca değer sürekli güncellenir (skill §1–§2); dikey sayfa
  // kaydırması `touch-action: pan-y` ile korunur.
  const readPoint = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'mouse' && e.buttons === 0 && !e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    readPoint(e.clientX, e.currentTarget);
  };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    readPoint(e.clientX, e.currentTarget);
  };
  const releasePointer = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setHover(null);
  };

  const peak = pts[peakIdx];

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible', touchAction: 'pan-y' }}
        onPointerMove={onPointerMove} onPointerDown={onPointerDown}
        onPointerUp={releasePointer} onPointerCancel={releasePointer} onPointerLeave={releasePointer}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={accent} stopOpacity="0.42" />
            <stop offset="0.55" stopColor={accent2} stopOpacity="0.16" />
            <stop offset="1" stopColor={accent2} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={gid + '-s'} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={accent2} />
            <stop offset="0.5" stopColor={accent} />
            <stop offset="1" stopColor={HOME_C.violetDeep} />
          </linearGradient>
          <filter id={gid + '-g'} x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="3.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id={gid + '-soft'} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
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

        {/* average reference line */}
        {showAvg && hasSignal && (
          <g opacity={drawn ? 1 : 0} style={{ transition: `opacity 700ms 700ms ${HOME_C.ease}` }}>
            <line x1={padL} x2={W - padR} y1={avgY} y2={avgY} stroke={accent} strokeWidth="1.4" strokeDasharray="5 6" opacity="0.42" />
            <text x={W - padR} y={avgY - 7} textAnchor="end" fontSize="11.5" fontWeight="700" fill={accent} opacity="0.8">ort {fmtInt(avg)}</text>
          </g>
        )}

        {area && (
          <path d={area} fill={`url(#${gid})`} opacity={drawn ? 1 : 0}
            style={{ transition: `opacity 900ms 250ms ${HOME_C.ease}` }} />
        )}

        <path ref={pathRef} d={line} fill="none" stroke={`url(#${gid}-s)`} strokeWidth={big ? 3.5 : 3.2}
          strokeLinecap="round" strokeLinejoin="round" filter={`url(#${gid}-g)`}
          style={{ strokeDasharray: len, strokeDashoffset: drawn ? 0 : len, transition: `stroke-dashoffset 1400ms ${HOME_C.ease}` }} />

        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 6 : 4}
            fill={C.surfaceHi} stroke={accent} strokeWidth="3" opacity={drawn ? 1 : 0}
            style={{ transition: `opacity 400ms ${300 + i * 60}ms ${HOME_C.ease}, r 180ms ${HOME_C.ease}` }} />
        ))}

        {/* peak marker — eye-catching glow + badge */}
        {showPeak && hasSignal && peak && drawn && peakIdx !== hover && (
          <g style={{ animation: `mkPeakPop 520ms ${HOME_C.ease} both` }}>
            <circle cx={peak.x} cy={peak.y} r="11" fill={accent} opacity="0.22" filter={`url(#${gid}-soft)`} />
            <circle cx={peak.x} cy={peak.y} r="5.5" fill={accent2} stroke={C.surfaceHi} strokeWidth="3" />
            <g transform={`translate(${Math.min(Math.max(peak.x, padL + 26), W - padR - 26)}, ${Math.max(peak.y - 18, padT + 4)})`}>
              <rect x="-26" y="-13" width="52" height="20" rx="10" fill={accent} />
              <text x="0" y="1.5" textAnchor="middle" dominantBaseline="middle" fontSize="11.5" fontWeight="800" fill="#fff">▲ {fmtInt(peak.v)}</text>
            </g>
          </g>
        )}

        {hover != null && pts[hover] && (
          <g>
            <line x1={pts[hover].x} x2={pts[hover].x} y1={padT} y2={padT + innerH} stroke={accent} strokeWidth="1.4" strokeDasharray="3 4" opacity="0.5" />
            <circle cx={pts[hover].x} cy={pts[hover].y} r="12" fill={accent} opacity="0.18" filter={`url(#${gid}-soft)`} />
            <circle cx={pts[hover].x} cy={pts[hover].y} r="7" fill={accent} stroke={C.surfaceHi} strokeWidth="3" />
          </g>
        )}

        {labels.map((lb, i) => {
          if (!showLabel(i)) return null;
          const x = padL + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
          return <text key={i} x={x} y={H - 8} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
            fontSize={big ? 14 : 12} fontWeight={hover === i ? 800 : 600} fill={hover === i ? accent : C.ink2}
            style={{ transition: 'fill 180ms' }}>{lb}</text>;
        })}
      </svg>

      {hover != null && pts[hover] && (
        <div style={{
          position: 'absolute', top: 0, left: `${(pts[hover].x / W) * 100}%`, transform: 'translateX(-50%)',
          padding: '7px 13px', borderRadius: C.radiusPill, background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
          boxShadow: `${C.floatShadow}, ${C.clayFlat}`, pointerEvents: 'none', whiteSpace: 'nowrap',
          fontSize: 13, fontWeight: 800, color: C.ink1,
        }}>
          <span style={{ color: accent }}>{labels[hover]}</span> · {fmtInt(data[hover])}
        </div>
      )}
    </div>
  );
}

// ── trend delta badge — up/down vs comparison, bold & color-coded ─────────────
export function DeltaBadge({ value, suffix = '%', neutralLabel }: { value: number; suffix?: string; neutralLabel?: string }) {
  const up = value > 0, down = value < 0;
  const col = up ? C.waterDeep : down ? C.danger : C.ink2;
  const bg = up ? C.waterA14 : down ? C.dangerA12 : C.surface2;
  const arrow = up ? '▲' : down ? '▼' : '–';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: C.radiusPill, background: bg, color: col, fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontSize: 10 }}>{arrow}</span>
      {value === 0 && neutralLabel ? neutralLabel : `${Math.abs(value)}${suffix}`}
    </span>
  );
}

// ── mini inline sparkline — tiny bold area chart for KPI tiles ────────────────
export function Sparkline({ data, color = C.accent, width = 92, height = 30 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  const uid = useRef('sp-' + Math.random().toString(36).slice(2, 8)).current;
  if (data.length < 2) return null;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => ({ x: (i / (data.length - 1)) * width, y: height - 3 - ((v - min) / span) * (height - 6) }));
  const line = smoothPath(pts);
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={uid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.30" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3" fill={color} />
    </svg>
  );
}

// ── animated progress ring ────────────────────────────────────────────────────
export function Ring({ pct, size = 86, stroke = 10, color, track, children, delay = 0 }: {
  pct: number; size?: number; stroke?: number; color: string; track?: string; children?: React.ReactNode; delay?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) { setShow(true); return; }
    const t = setTimeout(() => setShow(true), delay + 60); return () => clearTimeout(t);
  }, [pct, delay]);
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
/**
 * Clay kart.
 *
 * `onClick` yalnızca imleç/parmak için bir kolaylıktır: kartın tamamı tıklanır.
 * Kartın kendisi role="button" almaz — kartların içinde kendi kontrolleri
 * (yenile, büyüt, sekme) var ve "button" rolü kap görevi göremez. Bu yüzden
 * tıklanabilir her kart, aynı eylemi yapan görünür bir kontrol de barındırmak
 * zorundadır; klavye yolu oradan geçer (desktop.md §2).
 */
export function Card({ children, tone, onClick, hover, pad = 18, style }: {
  children: React.ReactNode; tone?: 'ok' | 'brown'; onClick?: () => void; hover?: boolean; pad?: number; style?: React.CSSProperties;
}) {
  const [h, setH] = useState(false);
  const [pressed, setPressed] = useState(false);
  // Hover yalnızca gerçek imleçte. Dokunmatikte `pointerenter` da tetiklendiği
  // için kart parmak değince "hover" durumunda takılı kalıyordu.
  const hoverCapable = useHoverCapable();
  const canHover = !!hover && hoverCapable;
  const lifted = canHover && h;
  const bg = tone === 'ok'
    ? `linear-gradient(180deg, ${C.waterA09}, ${C.surface2})`
    : tone === 'brown'
      ? `linear-gradient(165deg, ${C.brownTop} 0%, ${C.brownMid} 60%, ${C.brownDeep} 100%)`
      : `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`;
  return (
    <div onClick={onClick}
      onPointerEnter={() => canHover && setH(true)}
      onPointerLeave={() => { setH(false); setPressed(false); }}
      // Geri bildirim basma anında doğar, bırakışta değil (skill §1).
      onPointerDown={() => onClick && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        position: 'relative', padding: pad, borderRadius: C.radiusLg, background: bg,
        boxShadow: tone === 'brown'
          ? `inset 0 1px 0 ${C.hi}, 0 18px 40px -18px ${C.accentGlow}, 0 4px 12px -4px rgba(150,128,96,0.3)`
          : (lifted ? `${C.clay}, 0 0 0 1.5px ${C.accent}` : C.clay),
        cursor: onClick ? 'pointer' : 'default',
        transition: `box-shadow 200ms ${HOME_C.ease}, transform 200ms ${HOME_C.ease}`,
        transform: pressed ? 'scale(0.995)' : lifted ? 'translateY(-2px)' : 'none',
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
    accent: { c: C.accent, bg: `${C.accentA09}` },
    amber: { c: C.amber, bg: C.amberSoft },
    ok: { c: C.waterDeep, bg: C.waterA14 },
    sky: { c: HOME_C.skyDeep, bg: C.skyA16 },
    violet: { c: HOME_C.violetDeep, bg: C.violetA16 },
  };
  const t = map[tone || 'accent'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: flush ? 0 : 2 }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center', color: onLight ? C.onBrown : t.c, background: onLight ? 'rgba(255,255,255,0.22)' : t.bg, boxShadow: `inset 0 1px 1px ${C.hi}` }}>{ico}</span>
      {/* Büyük harf başlıklarda pozitif tracking okunurluğu artırır (skill §15). */}
      <span style={{ fontSize: 13, fontWeight: 800, color: onLight ? C.onBrown : C.ink2, letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{title}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}

export function Pill({ children, onLight }: { children: React.ReactNode; onLight?: boolean }) {
  return <span style={{ padding: '5px 12px', borderRadius: C.radiusPill, background: onLight ? 'rgba(255,255,255,0.22)' : C.surface2, boxShadow: onLight ? 'none' : C.clayInset, fontSize: 12.5, fontWeight: 700, color: onLight ? C.onBrown : C.ink2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{children}</span>;
}

export function Tag({ children, tone, bg }: { children: React.ReactNode; tone: string; bg: string }) {
  return <span style={{ padding: '6px 12px', borderRadius: C.radiusPill, background: bg, color: tone, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function ClayIconBtn({ children, onClick, round, spin, onLight, label }: {
  children: React.ReactNode; onClick?: () => void; round?: boolean; spin?: boolean; onLight?: boolean;
  /** İkon-only kontrolün erişilebilir adı (skill §14: etiketsiz ikon olmaz). */
  label?: string;
}) {
  const [s, setS] = useState(false);
  const coarse = useCoarsePointer();
  // Dokunmatikte 44px'lik hedef, imleçte yoğun 38px geometri.
  const size = coarse ? 44 : 38;
  return (
    <button type="button" aria-label={label} title={label} className="clay-focusable"
      onClick={(e) => { e.stopPropagation(); onClick?.(); if (spin) { setS(true); setTimeout(() => setS(false), 700); } }}
      style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: size, height: size, flexShrink: 0, borderRadius: round ? '50%' : 12, display: 'grid', placeItems: 'center', color: onLight ? C.onBrown : C.ink2, background: onLight ? 'rgba(255,255,255,0.2)' : `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`, boxShadow: onLight ? 'none' : C.clayFlat, transition: `transform 110ms ${HOME_C.ease}` }}
      // Basma anında tepki (skill §1): 110ms içeri, bırakınca geri.
      onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
      onPointerUp={(e) => (e.currentTarget.style.transform = '')}
      onPointerCancel={(e) => (e.currentTarget.style.transform = '')}
      onPointerLeave={(e) => (e.currentTarget.style.transform = '')}>
      <span style={{ display: 'inline-flex', animation: s ? `mkSpin 0.7s ${HOME_C.ease}` : 'none' }}>{children}</span>
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { v: T; l: string; title?: string }[]; label?: string;
}) {
  const coarse = useCoarsePointer();
  // Tek harfli sekmeler dokunmatikte 44px'lik hedefe büyür.
  const h = coarse ? 40 : 32;
  return (
    <div role="tablist" aria-label={label} style={{ display: 'inline-flex', gap: 3, padding: 4, borderRadius: C.radiusPill, background: C.surface2, boxShadow: C.clayInset }}>
      {options.map(o => {
        const on = value === o.v;
        return (
          <button key={o.v} type="button" role="tab" aria-selected={on} aria-label={o.title} title={o.title}
            className="clay-focusable clay-touch-target"
            onClick={(e) => { e.stopPropagation(); if (coarse) haptic(); onChange(o.v); }}
            style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', minWidth: h, height: h, padding: coarse ? '0 14px' : '0 11px', borderRadius: C.radiusPill, display: 'grid', placeItems: 'center', background: on ? `linear-gradient(180deg, ${C.accent2}, ${C.accent})` : 'transparent', boxShadow: on ? `0 5px 11px -4px ${C.accentGlow}` : 'none', color: on ? C.onBrown : C.ink2, fontSize: 13, fontWeight: 800, transition: `background 200ms ${HOME_C.ease}, color 200ms ${HOME_C.ease}, box-shadow 200ms ${HOME_C.ease}` }}>
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
  useEffect(() => {
    if (prefersReducedMotion()) { setW(pct); return; }
    const t = setTimeout(() => setW(pct), 80); return () => clearTimeout(t);
  }, [pct]);
  return (
    <div style={{ height, borderRadius: 99, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, w))}%`, borderRadius: 99, background: `linear-gradient(90deg, ${tone}, ${C.waterHi})`, transition: `width 1000ms ${HOME_C.ease}` }} />
    </div>
  );
}
