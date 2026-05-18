'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatedNumber, BigCurrency, Sparkline } from './charts';
import { HBarList } from './charts';

// ────────────────────────────────────────────────────────────────────────────
// SectionHeader
// ────────────────────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  count?: number;
}

export function SectionHeader({ icon, title, action, count }: SectionHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18, gap: 10 }}>
      <span style={{ color: 'var(--mg-accent)', display: 'inline-flex' }}>{icon}</span>
      <h3
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: 'var(--mg-text)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          margin: 0,
        }}
      >
        {title}
      </h3>
      {count != null && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--mg-muted)',
            background: 'var(--mg-surface-2)',
            padding: '2px 8px',
            borderRadius: 10,
          }}
        >
          {count}
        </span>
      )}
      {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Card
// ────────────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  padding?: number;
  hoverable?: boolean;
}

export function Card({ children, style, padding = 24, hoverable = false }: CardProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--mg-surface)',
        border: '1px solid var(--mg-border)',
        borderRadius: 20,
        padding,
        boxShadow:
          hoverable && hovered
            ? '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(251,146,60,0.18)'
            : '0 1px 0 rgba(255,255,255,0.03) inset, 0 6px 24px rgba(0,0,0,0.25)',
        transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        transform: hoverable && hovered ? 'translateY(-2px)' : 'none',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MiniStat (KPI satırı)
// ────────────────────────────────────────────────────────────────────────────

interface MiniStatProps {
  label: string;
  value: number;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
  trend?: number;
  sparkData?: number[];
  unit?: string;
  isCount?: boolean;
  decimals?: number;
}

export function MiniStat({
  label,
  value,
  sub = '',
  color = 'var(--mg-accent)',
  trend,
  sparkData,
  unit = '₺',
  isCount = false,
  decimals = 0,
}: MiniStatProps) {
  const [hovered, setHovered] = useState(false);
  const positive = trend != null && trend >= 0;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        minWidth: 220,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))',
        border: '1px solid var(--mg-border)',
        borderRadius: 24,
        padding: '22px 24px 20px',
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        transform: hovered ? 'translateY(-3px)' : 'none',
        boxShadow: hovered
          ? `0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px ${color}33, inset 0 1px 0 rgba(255,255,255,0.06)`
          : '0 1px 0 rgba(255,255,255,0.04) inset',
        cursor: 'default',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: color,
          filter: 'blur(60px)',
          opacity: hovered ? 0.18 : 0.08,
          pointerEvents: 'none',
          transition: 'opacity 0.4s',
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--mg-muted)', letterSpacing: '0.01em' }}>
          {label}
        </span>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid var(--mg-border-strong)',
            background: hovered ? color + '18' : 'transparent',
            color: hovered ? color : 'var(--mg-text-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.25s',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 18 }}>
        {isCount ? (
          <span
            style={{
              fontSize: 42,
              fontWeight: 400,
              color: 'var(--mg-text)',
              letterSpacing: '-0.04em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 8,
            }}
          >
            <AnimatedNumber
              value={value}
              format={(v) => (decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString('tr-TR'))}
            />
            {unit && <span style={{ fontSize: 16, color: 'var(--mg-muted)', fontWeight: 400 }}>{unit}</span>}
          </span>
        ) : decimals > 0 ? (
          <span
            style={{
              fontSize: 42,
              fontWeight: 400,
              color: 'var(--mg-text)',
              letterSpacing: '-0.04em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}
          >
            <span style={{ fontSize: 22, color: 'var(--mg-text)', marginRight: 4, fontWeight: 300 }}>₺</span>
            <AnimatedNumber
              value={value}
              format={(v) => {
                const s = v.toFixed(decimals);
                const [intPart, frac] = s.split('.');
                return (
                  <>
                    <span>{(+intPart).toLocaleString('tr-TR')}</span>
                    {frac && (
                      <span style={{ fontSize: 22, color: 'var(--mg-muted)', fontWeight: 400 }}>,{frac}</span>
                    )}
                  </>
                );
              }}
            />
          </span>
        ) : (
          <BigCurrency value={value} mainSize={42} decSize={22} showSymbol={unit === '₺'} />
        )}
        {trend != null && (
          <span
            style={{
              fontSize: 14,
              color: positive ? 'var(--mg-success)' : 'var(--mg-danger)',
              lineHeight: 1,
              fontWeight: 600,
            }}
          >
            {positive ? '↑' : '↓'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, marginBottom: 8 }}>
        <div
          style={{
            flex: 1,
            height: '100%',
            borderRadius: 8,
            background: `repeating-linear-gradient(45deg, transparent, transparent 4px, var(--mg-border) 4px, var(--mg-border) 5px)`,
            border: '1px solid var(--mg-border)',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {sparkData && (
            <Sparkline data={sparkData.slice(0, sparkData.length - 1)} color={color} width={56} height={20} fill={false} />
          )}
        </div>
        <div
          style={{
            flex: 1,
            height: '100%',
            borderRadius: 8,
            background: positive ? 'var(--mg-success-soft)' : trend != null ? 'var(--mg-danger-soft)' : color + '18',
            border: `1px solid ${positive ? 'var(--mg-success-soft)' : trend != null ? 'var(--mg-danger-soft)' : color + '33'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: trend != null ? (positive ? 'var(--mg-success)' : 'var(--mg-danger)') : color,
            letterSpacing: '0.01em',
          }}
        >
          {trend != null ? `${positive ? '+' : ''}${trend}%` : sub.split(' ')[0] || '—'}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span
          style={{ fontSize: 10, fontWeight: 500, color: 'var(--mg-muted)', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}
        >
          Geçen
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: trend != null ? (positive ? 'var(--mg-success)' : 'var(--mg-danger)') : 'var(--mg-text-2)',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          Bu Dönem
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ActivityCard + ActivitiesPanel
// ────────────────────────────────────────────────────────────────────────────

export interface ActivityCardData {
  value: number;
  label: string;
  sublabel?: string;
  color?: string;
  delta?: string | number | null;
  format?: (v: number) => React.ReactNode;
  sparkData?: number[] | null;
  onClick?: () => void;
  active?: boolean;
  compact?: boolean;
}

export function ActivityCard({
  value,
  delta,
  label,
  sublabel = 'Son Dönem',
  color = 'var(--mg-accent)',
  sparkData,
  format,
  onClick,
  active,
  compact = false,
}: ActivityCardData) {
  const [hovered, setHovered] = useState(false);
  const positive = delta == null ? null : typeof delta === 'string' ? !delta.startsWith('-') : delta >= 0;
  const fmt = format || ((v: number) => Math.round(v).toLocaleString('tr-TR'));
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: active
          ? 'linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.025))'
          : 'linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))',
        border: '1px solid ' + (active ? color + '44' : 'var(--mg-border)'),
        borderRadius: 22,
        padding: compact ? '14px 14px 14px' : '16px 16px 16px',
        position: 'relative',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        transform: hovered && onClick ? 'translateY(-2px)' : 'none',
        boxShadow:
          hovered && onClick
            ? `0 12px 28px rgba(0,0,0,0.25), 0 0 0 1px ${color}33, inset 0 1px 0 rgba(255,255,255,0.06)`
            : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        minHeight: 150,
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span
            style={{
              fontSize: 44,
              fontWeight: 400,
              color: 'var(--mg-text)',
              letterSpacing: '-0.04em',
              lineHeight: 0.95,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <AnimatedNumber value={value} format={fmt} />
          </span>
          {delta != null && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#fff',
                background: positive ? '#42e46d' : '#fc7272',
                padding: '2px 7px',
                borderRadius: 100,
                marginTop: 4,
                whiteSpace: 'nowrap',
                lineHeight: 1.3,
              }}
            >
              {delta}
            </span>
          )}
        </div>
        <button
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            border: '1px solid var(--mg-border-strong)',
            background: hovered ? color + '18' : 'transparent',
            color: hovered ? color : 'var(--mg-text-2)',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', marginBottom: 10 }}>
        {sparkData && sparkData.length > 1 && (
          <div style={{ marginLeft: -2 }}>
            <Sparkline data={sparkData} color={color} width={100} height={22} fill={false} />
          </div>
        )}
        <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--mg-muted)', letterSpacing: '0.04em', marginTop: 2 }}>
          {sublabel}
        </div>
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--mg-text-2)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
        {label}
      </div>
    </div>
  );
}

interface ActivitiesSection {
  title: string;
  cards: ActivityCardData[];
}

interface ActivitiesPanelProps {
  count: number;
  sections: ActivitiesSection[];
  action?: React.ReactNode;
  title?: string;
}

export function ActivitiesPanel({ count, sections, action, title = 'Activities' }: ActivitiesPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollBy = (dir: number) => {
    if (scrollRef.current) scrollRef.current.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };
  return (
    <div
      style={{
        borderRadius: 28,
        background: 'linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))',
        border: '1px solid var(--mg-border)',
        padding: '20px 0 20px',
        position: 'relative',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.2)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', marginBottom: 18 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 12px 5px 6px',
            background: 'var(--mg-surface-2)',
            borderRadius: 100,
            border: '1px solid var(--mg-border)',
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #fc7272, #fb923c)',
              fontSize: 10,
              fontWeight: 800,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {count}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--mg-text)', letterSpacing: '-0.01em' }}>
            {title}
          </span>
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={() => scrollBy(-1)}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: '1px solid var(--mg-border)',
              background: 'var(--mg-surface)',
              color: 'var(--mg-text-2)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={() => scrollBy(1)}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: '1px solid var(--mg-border)',
              background: 'var(--mg-surface)',
              color: 'var(--mg-text-2)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          {action}
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          gap: 28,
          padding: '0 22px 4px',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'thin',
        }}
      >
        {sections.map((sec, si) => (
          <React.Fragment key={si}>
            {si > 0 && (
              <div
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  background: 'var(--mg-border)',
                  margin: '16px -8px',
                }}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--mg-text-2)',
                  marginBottom: 10,
                  paddingLeft: 4,
                }}
              >
                {sec.title}
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                {sec.cards.map((card, ci) => (
                  <div key={ci} style={{ width: 168, flexShrink: 0 }}>
                    <ActivityCard {...card} />
                  </div>
                ))}
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// InsightsCard
// ────────────────────────────────────────────────────────────────────────────

export interface Insight {
  palette: [string, string, string, string, string];
  title: string;
  headline: string;
  subhead: string;
  delta: number;
  deltaPositive?: boolean;
  isPct?: boolean;
}

interface InsightsCardProps {
  insights: Insight[];
  autoMs?: number;
}

export function InsightsCard({ insights, autoMs = 60000 }: InsightsCardProps) {
  const [idx, setIdx] = useState(0);
  const [transitionKey, setTransitionKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const filterIdRef = useRef('mg-goo-' + Math.random().toString(36).slice(2, 8));

  const list = insights.length > 0 ? insights : [];
  const advance = (dir: number) => {
    setIdx((i) => (i + dir + list.length) % list.length);
    setTransitionKey((k) => k + 1);
  };

  useEffect(() => {
    if (!autoMs || list.length <= 1) return;
    timerRef.current = setTimeout(() => advance(1), autoMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, autoMs]);

  if (list.length === 0) return null;

  const cur = list[idx];
  const gradient = (palette: [string, string, string, string, string]) => `
    radial-gradient(120% 90% at 30% 20%, ${palette[0]} 0%, transparent 45%),
    radial-gradient(100% 80% at 80% 30%, ${palette[1]} 0%, transparent 50%),
    radial-gradient(110% 100% at 60% 90%, ${palette[2]} 0%, transparent 50%),
    radial-gradient(80% 80% at 20% 80%, ${palette[3]} 0%, transparent 50%),
    ${palette[4]}
  `;

  return (
    <div
      style={{
        borderRadius: 24,
        padding: '26px 28px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 260,
        boxShadow: '0 16px 48px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
        background: cur.palette[4],
        isolation: 'isolate',
      }}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id={filterIdRef.current}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="22" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -6"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div style={{ position: 'absolute', inset: 0, background: cur.palette[4], zIndex: 0, transition: 'background 1.6s ease' }} />

      <div
        style={{
          position: 'absolute',
          inset: -60,
          filter: `url(#${filterIdRef.current})`,
          zIndex: 1,
          pointerEvents: 'none',
        }}
      >
        {list.map((ins, i) => (
          <div
            key={i + '-' + (i === idx ? transitionKey : 'old')}
            style={{
              position: 'absolute',
              inset: 0,
              background: gradient(ins.palette),
              opacity: i === idx ? 1 : 0,
              animation: i === idx ? 'mg-liquidIn 1.6s cubic-bezier(0.65,0,0.35,1) both' : 'none',
            }}
          />
        ))}
      </div>

      <div
        key={'ripple-' + transitionKey}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          background: `radial-gradient(circle at 50% 50%, ${cur.palette[1]}77 0%, transparent 60%)`,
          animation: 'mg-liquidRipple 1.4s cubic-bezier(0.65,0,0.35,1) both',
          mixBlendMode: 'screen',
        }}
      />

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.85)',
              background: 'rgba(0,0,0,0.18)',
              padding: '4px 10px',
              borderRadius: 100,
              backdropFilter: 'blur(10px)',
            }}
          >
            Öngörü
          </span>

          {list.length > 1 && (
            <div style={{ display: 'flex', gap: 6 }}>
              {[-1, 1].map((dir) => (
                <button
                  key={dir}
                  onClick={() => advance(dir)}
                  title={dir < 0 ? 'Önceki' : 'Sonraki'}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: '1px solid rgba(255,255,255,0.3)',
                    background: 'rgba(255,255,255,0.12)',
                    backdropFilter: 'blur(10px)',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.22)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)')}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={dir < 0 ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <div
          key={'text-' + transitionKey}
          style={{ marginBottom: 12, animation: 'mg-liquidTextIn 0.9s cubic-bezier(0.34,1.56,0.64,1) 0.2s both' }}
        >
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: 500, marginBottom: 6 }}>{cur.title}</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 500,
              color: '#fff',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              marginBottom: 4,
            }}
          >
            {cur.headline}
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 600,
              color: '#fff',
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 400, opacity: 0.85 }}>
              {cur.deltaPositive ? '+' : '−'}
              {cur.isPct ? '' : '₺'}
            </span>
            <AnimatedNumber
              value={cur.delta}
              format={(v) => {
                const r = Math.round(v).toLocaleString('tr-TR');
                return cur.isPct ? `${r}%` : r;
              }}
            />
          </div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: 500, marginTop: 4 }}>
            {cur.subhead}
          </div>
        </div>

        {list.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {list.map((_, i) => (
              <div
                key={i}
                onClick={() => {
                  setIdx(i);
                  setTransitionKey((k) => k + 1);
                }}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  cursor: 'pointer',
                  background: i === idx ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.22)',
                  transition: 'background 0.4s',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {i === idx && autoMs && (
                  <div
                    key={'prog-' + transitionKey}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(255,255,255,0.4)',
                      transformOrigin: 'left',
                      animation: `mg-progressFill ${autoMs}ms linear forwards`,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export HBarList
export { HBarList };
