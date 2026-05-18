'use client';

/**
 * Maliyet Gözlem Merkezi — SVG tabanlı chart bileşenleri (bağımlılıksız).
 * Verilen örnek HTML/JSX dosyalarının TypeScript & React adaptasyonu.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

// ────────────────────────────────────────────────────────────────────────────
// AnimatedNumber
// ────────────────────────────────────────────────────────────────────────────

interface AnimatedNumberProps {
  value: number;
  format?: (v: number) => React.ReactNode;
  duration?: number;
}

export function AnimatedNumber({
  value,
  format = (v) => v.toLocaleString('tr-TR'),
  duration = 900,
}: AnimatedNumberProps) {
  const [d, setD] = useState(value);
  const prev = useRef(value);
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (prev.current === value) return;
    const from = prev.current;
    const to = value;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 4);
      setD(from + (to - from) * e);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else prev.current = to;
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  return <span>{format(d)}</span>;
}

// ────────────────────────────────────────────────────────────────────────────
// BigCurrency
// ────────────────────────────────────────────────────────────────────────────

interface BigCurrencyProps {
  value: number;
  symbol?: string;
  animated?: boolean;
  mainSize?: number;
  decSize?: number;
  showSymbol?: boolean;
}

export function BigCurrency({
  value,
  symbol = '₺',
  animated = true,
  mainSize = 48,
  decSize = 24,
  showSymbol = true,
}: BigCurrencyProps) {
  const fmt = (v: number): [string, string] => {
    const rounded = Math.round(v);
    const s = rounded.toLocaleString('tr-TR');
    if (s.length <= 3) return [s, ''];
    const main = s.slice(0, -4);
    const tail = s.slice(-4);
    return [main, tail];
  };
  const [staticMain, staticTail] = animated ? ['', ''] : fmt(value);

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        lineHeight: 1,
        fontWeight: 400,
        letterSpacing: '-0.04em',
      }}
    >
      {showSymbol && (
        <span style={{ fontSize: mainSize * 0.5, color: 'var(--mg-text)', marginRight: 6, fontWeight: 300 }}>
          {symbol}
        </span>
      )}
      {animated ? (
        <AnimatedNumber
          value={value}
          format={(v) => {
            const [m, t] = fmt(v);
            return (
              <>
                <span style={{ fontSize: mainSize, color: 'var(--mg-text)', fontWeight: 400 }}>{m}</span>
                {t && (
                  <span style={{ fontSize: decSize, color: 'var(--mg-muted)', marginLeft: 1, fontWeight: 400 }}>
                    ,{t.replace(/^\./, '')}
                  </span>
                )}
              </>
            );
          }}
        />
      ) : (
        <>
          <span style={{ fontSize: mainSize, color: 'var(--mg-text)', fontWeight: 400 }}>{staticMain}</span>
          {staticTail && (
            <span style={{ fontSize: decSize, color: 'var(--mg-muted)', marginLeft: 1, fontWeight: 400 }}>
              ,{staticTail.replace(/^\./, '')}
            </span>
          )}
        </>
      )}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sparkline
// ────────────────────────────────────────────────────────────────────────────

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
}

export function Sparkline({ data, color = '#fb923c', width = 80, height = 28, fill = true }: SparklineProps) {
  if (!data?.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => ({
    x: data.length === 1 ? width / 2 : (i / (data.length - 1)) * width,
    y: height - ((v - min) / range) * height,
  }));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  const gid = useMemo(() => 'sg-' + Math.random().toString(36).slice(2, 8), []);
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// DonutChart
// ────────────────────────────────────────────────────────────────────────────

export interface DonutSegment {
  name: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  onSelect?: (name: string) => void;
  selectedKey?: string;
}

export function DonutChart({ segments, size = 180, thickness = 28, onSelect, selectedKey }: DonutChartProps) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - thickness / 2;
  const cx = size / 2;
  const cy = size / 2;
  let acc = 0;
  const arcs = segments.map((s) => {
    const startAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += s.value;
    const endAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    return { ...s, d: `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2}`, pct: (s.value / total) * 100 };
  });

  const sel = arcs.find((a) => a.name === selectedKey) || arcs[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size}>
          {arcs.map((a, i) => (
            <path
              key={i}
              d={a.d}
              fill="none"
              stroke={a.color}
              strokeWidth={thickness}
              strokeLinecap="butt"
              opacity={selectedKey && a.name !== selectedKey ? 0.25 : 1}
              style={{
                cursor: onSelect ? 'pointer' : 'default',
                transition: 'opacity 0.25s, stroke-width 0.25s',
              }}
              onClick={() => onSelect && onSelect(a.name)}
            />
          ))}
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--mg-muted)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {sel?.name || 'Toplam'}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: 'var(--mg-text)',
              letterSpacing: '-0.02em',
              marginTop: 2,
            }}
          >
            %{sel ? sel.pct.toFixed(1) : 100}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {arcs.map((a, i) => (
          <div
            key={i}
            onClick={() => onSelect && onSelect(a.name)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 8px',
              borderRadius: 8,
              cursor: onSelect ? 'pointer' : 'default',
              background: selectedKey === a.name ? 'var(--mg-surface-2)' : 'transparent',
              transition: 'background 0.2s',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color, flexShrink: 0 }} />
            <span
              style={{
                fontSize: 13,
                color: 'var(--mg-text)',
                fontWeight: 600,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {a.name}
            </span>
            <span
              style={{
                fontSize: 13,
                color: 'var(--mg-text-2)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              ₺{Math.round(a.value).toLocaleString('tr-TR')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// HBarList
// ────────────────────────────────────────────────────────────────────────────

export interface HBarItem {
  name: string;
  value: number;
  color?: string;
  sub?: string;
}

interface HBarListProps {
  items: HBarItem[];
  color?: string;
  onSelect?: (name: string) => void;
  selectedKey?: string;
  format?: (v: number) => string;
}

export function HBarList({
  items,
  color = '#fb923c',
  onSelect,
  selectedKey,
  format = (v) => `₺${Math.round(v).toLocaleString('tr-TR')}`,
}: HBarListProps) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {items.map((item, i) => {
        const pct = (item.value / max) * 100;
        const c = item.color || color;
        const active = selectedKey === item.name;
        return (
          <div
            key={i}
            onClick={() => onSelect && onSelect(item.name)}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--mg-text)' : 'var(--mg-text-2)' }}>
                {item.name}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: active ? c : 'var(--mg-text-2)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {format(item.value)}
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: 'var(--mg-surface-2)',
                borderRadius: 4,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${c}, ${c}dd)`,
                  borderRadius: 4,
                  boxShadow: `0 0 12px ${c}40`,
                  transition: 'width 0.7s cubic-bezier(0.34,1.56,0.64,1)',
                }}
              />
            </div>
            {item.sub && (
              <div style={{ fontSize: 11, color: 'var(--mg-muted)', marginTop: 4, fontWeight: 500 }}>{item.sub}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// LineChart (sayfanın hover'lı çizgi grafiği)
// ────────────────────────────────────────────────────────────────────────────

export interface LineChartPoint {
  m: string;
  v: number;
}

interface LineChartProps {
  data: LineChartPoint[];
  color?: string;
  height?: number;
  formatY?: (v: number) => string;
}

export function LineChart({
  data,
  color = '#fb923c',
  height = 280,
  formatY = (v) => (v >= 1000 ? `₺${Math.round(v / 1000)}k` : `₺${v}`),
}: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [W, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const r = new ResizeObserver((es) => setW(es[0].contentRect.width));
    r.observe(wrapRef.current);
    return () => r.disconnect();
  }, []);

  const H = height;
  const padL = 56;
  const padR = 16;
  const padT = 20;
  const padB = 36;
  const innerW = Math.max(100, W - padL - padR);
  const innerH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.v), 1);
  const niceMax = Math.ceil(max / 50000) * 50000 || max;

  const ySteps = 5;
  const yTicks = Array.from({ length: ySteps + 1 }, (_, i) => (niceMax / ySteps) * i);

  const points = data.map((d, i) => ({
    x: padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
    y: padT + innerH - (d.v / niceMax) * innerH,
    raw: d,
  }));

  const path = points.reduce((acc, p, i) => {
    if (i === 0) return `M${p.x},${p.y}`;
    const prev = points[i - 1];
    const cx = (prev.x + p.x) / 2;
    return acc + ` C${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
  }, '');
  const area = points.length
    ? `${path} L${points[points.length - 1].x},${padT + innerH} L${points[0].x},${padT + innerH} Z`
    : '';

  return (
    <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
      <svg
        width={W}
        height={H}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          let nearest = 0;
          let bestDist = Infinity;
          points.forEach((p, i) => {
            const d = Math.abs(p.x - mx);
            if (d < bestDist) {
              bestDist = d;
              nearest = i;
            }
          });
          setHover(nearest);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="mg-lc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tv, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={padT + innerH - (tv / niceMax) * innerH}
              y2={padT + innerH - (tv / niceMax) * innerH}
              stroke="var(--mg-border)"
              strokeWidth="1"
              strokeDasharray="2 4"
            />
            <text
              x={padL - 10}
              y={padT + innerH - (tv / niceMax) * innerH + 4}
              fill="var(--mg-muted)"
              fontSize="11"
              textAnchor="end"
              fontWeight="500"
            >
              {formatY(tv)}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          const step = Math.ceil(points.length / 8);
          if (i % step !== 0 && i !== points.length - 1) return null;
          return (
            <text
              key={i}
              x={p.x}
              y={H - 12}
              fill="var(--mg-muted)"
              fontSize="11"
              textAnchor="middle"
              fontWeight="500"
            >
              {p.raw.m}
            </text>
          );
        })}

        <path d={area} fill="url(#mg-lc-area)" />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 2000,
            strokeDashoffset: 2000,
            animation: 'mg-drawLine 1.4s ease-out 0.1s forwards',
          }}
        />

        {hover != null && points[hover] && (
          <line
            x1={points[hover].x}
            x2={points[hover].x}
            y1={padT}
            y2={padT + innerH}
            stroke={color}
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.5"
          />
        )}

        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 6 : 3}
              fill={hover === i ? color : 'var(--mg-bg)'}
              stroke={color}
              strokeWidth="2"
              style={{ transition: 'r 0.15s' }}
            />
          </g>
        ))}

        {hover != null &&
          points[hover] &&
          (() => {
            const p = points[hover];
            const tx = Math.min(Math.max(p.x, padL + 70), W - padR - 70);
            return (
              <g transform={`translate(${tx}, ${p.y - 44})`}>
                <rect
                  x={-60}
                  y={-4}
                  width={120}
                  height={40}
                  rx={8}
                  fill="var(--mg-surface-2)"
                  stroke={color + '44'}
                  strokeWidth="1"
                  style={{ filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))' }}
                />
                <text x={0} y={12} fill="var(--mg-text-2)" fontSize="10" textAnchor="middle" fontWeight="600">
                  {p.raw.m}
                </text>
                <text x={0} y={28} fill={color} fontSize="14" textAnchor="middle" fontWeight="700">
                  ₺{p.raw.v.toLocaleString('tr-TR')}
                </text>
              </g>
            );
          })()}
      </svg>
    </div>
  );
}
