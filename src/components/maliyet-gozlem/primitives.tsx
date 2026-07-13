'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatedNumber, BigCurrency, Sparkline } from './charts';
import { HBarList } from './charts';
import { useIsMobile } from './useIsMobile';

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
  /** Verilirse kart tıklanabilir olur — hesabın alt kırılımını açmak için. */
  onClick?: () => void;
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
  onClick,
}: MiniStatProps) {
  const [hovered, setHovered] = useState(false);
  const isMobile = useIsMobile();
  const positive = trend != null && trend >= 0;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))',
        border: '1px solid var(--mg-border)',
        borderRadius: isMobile ? 18 : 24,
        padding: isMobile ? '14px 14px 12px' : '22px 24px 20px',
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        transform: hovered ? 'translateY(-3px)' : 'none',
        boxShadow: hovered
          ? `0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px ${color}33, inset 0 1px 0 rgba(255,255,255,0.06)`
          : '0 1px 0 rgba(255,255,255,0.04) inset',
        cursor: onClick ? 'pointer' : 'default',
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMobile ? 10 : 18, gap: 8 }}>
        <span style={{ fontSize: isMobile ? 11 : 12, fontWeight: 500, color: 'var(--mg-muted)', letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <div
          style={{
            width: isMobile ? 24 : 32,
            height: isMobile ? 24 : 32,
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

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: isMobile ? 10 : 18 }}>
        {isCount ? (
          <span
            style={{
              fontSize: isMobile ? 30 : 42,
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
              fontSize: isMobile ? 30 : 42,
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
          <BigCurrency value={value} mainSize={isMobile ? 28 : 42} decSize={isMobile ? 16 : 22} showSymbol={unit === '₺'} />
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
  const isMobile = useIsMobile();
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
        borderRadius: isMobile ? 18 : 22,
        padding: isMobile ? '12px 12px 12px' : compact ? '14px 14px 14px' : '16px 16px 16px',
        position: 'relative',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        transform: hovered && onClick ? 'translateY(-2px)' : 'none',
        boxShadow:
          hovered && onClick
            ? `0 12px 28px rgba(0,0,0,0.25), 0 0 0 1px ${color}33, inset 0 1px 0 rgba(255,255,255,0.06)`
            : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        minHeight: isMobile ? 122 : 150,
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontSize: isMobile ? 32 : 44,
              fontWeight: 400,
              color: 'var(--mg-text)',
              letterSpacing: '-0.04em',
              lineHeight: 0.95,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            <AnimatedNumber value={value} format={fmt} />
          </span>
          {delta != null && (
            <span
              style={{
                fontSize: isMobile ? 9 : 10,
                fontWeight: 700,
                color: '#fff',
                background: positive ? '#42e46d' : '#fc7272',
                padding: '2px 6px',
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
            width: isMobile ? 24 : 30,
            height: isMobile ? 24 : 30,
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
          onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        >
          <svg width={isMobile ? 10 : 12} height={isMobile ? 10 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', marginBottom: isMobile ? 6 : 10 }}>
        {sparkData && sparkData.length > 1 && (
          <div style={{ marginLeft: -2 }}>
            <Sparkline data={sparkData} color={color} width={isMobile ? 80 : 100} height={isMobile ? 18 : 22} fill={false} />
          </div>
        )}
        <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--mg-muted)', letterSpacing: '0.04em', marginTop: 2 }}>
          {sublabel}
        </div>
      </div>

      <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 600, color: 'var(--mg-text-2)', letterSpacing: '-0.01em', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollBy = (dir: number) => {
    if (scrollRef.current) scrollRef.current.scrollBy({ left: dir * (isMobile ? 200 : 320), behavior: 'smooth' });
  };
  const cardWidth = isMobile ? 138 : 168;
  return (
    <div
      style={{
        borderRadius: isMobile ? 22 : 28,
        background: 'linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))',
        border: '1px solid var(--mg-border)',
        padding: isMobile ? '14px 0 14px' : '20px 0 20px',
        position: 'relative',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.2)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 8 : 14,
          padding: isMobile ? '0 14px' : '0 22px',
          marginBottom: isMobile ? 12 : 18,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px 4px 5px',
            background: 'var(--mg-surface-2)',
            borderRadius: 100,
            border: '1px solid var(--mg-border)',
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: isMobile ? 20 : 22,
              height: isMobile ? 20 : 22,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #fc7272, #fb923c)',
              fontSize: 10,
              fontWeight: 800,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {count}
          </span>
          <span
            style={{
              fontSize: isMobile ? 12 : 14,
              fontWeight: 700,
              color: 'var(--mg-text)',
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </span>
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => scrollBy(-1)}
            style={{
              width: isMobile ? 26 : 30,
              height: isMobile ? 26 : 30,
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={() => scrollBy(1)}
            style={{
              width: isMobile ? 26 : 30,
              height: isMobile ? 26 : 30,
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
          gap: isMobile ? 16 : 28,
          padding: isMobile ? '0 14px 4px' : '0 22px 4px',
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
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div
                style={{
                  fontSize: isMobile ? 12 : 13,
                  fontWeight: 600,
                  color: 'var(--mg-text-2)',
                  marginBottom: 10,
                  paddingLeft: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {sec.title}
              </div>
              <div style={{ display: 'flex', gap: isMobile ? 8 : 12 }}>
                {sec.cards.map((card, ci) => (
                  <div key={ci} style={{ width: cardWidth, flexShrink: 0 }}>
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
  assistantContext?: Omit<CostAssistantContext, 'activeInsight'>;
}

export interface CostAssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CostAssistantContext {
  panel: 'test' | 'stok';
  currency: string;
  generatedAt: string;
  activeInsight?: Pick<Insight, 'title' | 'headline' | 'subhead' | 'delta' | 'deltaPositive' | 'isPct'>;
  filters?: Record<string, unknown>;
  totals?: Record<string, unknown>;
  rankings?: Record<string, unknown>;
  history?: Record<string, unknown>;
  rawSamples?: Record<string, unknown>;
}

interface CostInsightAssistantProps {
  context: CostAssistantContext;
  activeInsight: Insight;
  open: boolean;
  setOpen: (open: boolean) => void;
  showTrigger?: boolean;
  showPanel?: boolean;
}

function CostInsightAssistant({
  context,
  activeInsight,
  open,
  setOpen,
  showTrigger = true,
  showPanel = true,
}: CostInsightAssistantProps) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<CostAssistantMessage[]>([
    { role: 'assistant', content: 'Merhaba! Bu öngörüyle ilgili sorularınızı yanıtlayabilirim.' },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 40);
    return () => window.clearTimeout(id);
  }, [open, messages, busy]);

  const ask = async (override?: string) => {
    const question = (override ?? input).trim();
    if (!question || busy) return;

    const nextMessages: CostAssistantMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setInput('');
    setOpen(true);
    setBusy(true);

    try {
      const res = await fetch('/api/ai/maliyet-gozlem-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          history: messages.slice(-6),
          context: { ...context, activeInsight },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || 'AI yanıtı alınamadı');
      setMessages([...nextMessages, { role: 'assistant', content: data.message || 'Yanıt üretilemedi.' }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
      setMessages([...nextMessages, { role: 'assistant', content: `Üzgünüm, analiz oluşturulamadı: ${message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void ask();
  };

  return (
    <>
      {showTrigger && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width: '100%',
            minHeight: 46,
            marginTop: 12,
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.28)',
            background: 'rgba(255,255,255,0.13)',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 700,
            backdropFilter: 'blur(14px)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)',
            transformOrigin: '50% 50%',
            transition: 'transform 0.55s cubic-bezier(0.22,1,0.36,1), opacity 0.35s ease, background 0.35s ease',
          }}
          title="Qore Asistan'a sor"
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.82)',
                color: '#35223e',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✦
            </span>
            Asistana sor
          </span>
          <span style={{ fontSize: 22, lineHeight: 1 }}>›</span>
        </button>
      )}

      {showPanel && (
      <div
        aria-hidden={!open}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 5,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 'inherit',
          color: '#fff',
          pointerEvents: open ? 'auto' : 'none',
          opacity: open ? 1 : 0,
          transform: open ? 'scale(1) translateY(0)' : 'scale(0.86) translateY(18px)',
          clipPath: open ? 'inset(0% 0% 0% 0% round 24px)' : 'inset(67% 9% 8% 9% round 999px)',
          transformOrigin: '50% 88%',
          transition:
            'opacity 0.42s ease, transform 0.72s cubic-bezier(0.22,1,0.36,1), clip-path 0.72s cubic-bezier(0.22,1,0.36,1)',
          backdropFilter: open ? 'blur(18px)' : 'blur(0px)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background:
              'radial-gradient(90% 70% at 16% 8%, rgba(255,255,255,0.20), transparent 54%), radial-gradient(80% 70% at 88% 88%, rgba(126,78,166,0.42), transparent 58%), linear-gradient(145deg, rgba(80,54,83,0.24), rgba(95,84,145,0.16))',
            opacity: open ? 1 : 0,
            transition: 'opacity 0.5s ease',
          }}
        />

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 22px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.14)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                width: 42,
                height: 42,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.9)',
                color: '#2f2635',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                fontSize: 18,
                boxShadow: '0 10px 26px rgba(30,15,40,0.22)',
              }}
            >
              ✦
            </span>
            <div>
              <div style={{ fontSize: 17, fontWeight: 850, lineHeight: 1.1 }}>Qore Asistan</div>
              <div style={{ fontSize: 12, opacity: 0.78, marginTop: 3 }}>{busy ? 'Düşünüyor…' : 'Aktif'}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.3)',
              background: 'rgba(255,255,255,0.13)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 22,
              lineHeight: 1,
              backdropFilter: 'blur(12px)',
            }}
            title="Asistanı kapat"
          >
            ×
          </button>
        </div>

        <div
          ref={scrollRef}
          style={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            overflowY: 'auto',
            padding: '18px 22px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            scrollbarWidth: 'thin',
          }}
        >
          {messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: m.role === 'user' ? '78%' : '88%',
                borderRadius: m.role === 'user' ? '18px 18px 6px 18px' : '6px 18px 18px 18px',
                border: m.role === 'assistant' ? '1px solid rgba(255,255,255,0.2)' : 'none',
                background: m.role === 'user' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.13)',
                color: m.role === 'user' ? '#2f2635' : '#fff',
                padding: '11px 14px',
                fontSize: 13,
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                boxShadow: '0 8px 22px rgba(31,18,40,0.18)',
                backdropFilter: m.role === 'assistant' ? 'blur(10px)' : undefined,
              }}
            >
              {m.content}
            </div>
          ))}
          {busy && (
            <div
              style={{
                alignSelf: 'flex-start',
                borderRadius: '6px 18px 18px 18px',
                background: 'rgba(255,255,255,0.13)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                padding: '10px 13px',
                fontSize: 13,
                backdropFilter: 'blur(10px)',
              }}
            >
              Analiz ediliyor…
            </div>
          )}
        </div>

        <div style={{ position: 'relative', zIndex: 1, padding: '0 22px 18px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {['Tavsiyen?', 'Risk var mı?'].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void ask(q)}
                disabled={busy}
                style={{
                  border: '1px solid rgba(255,255,255,0.24)',
                  background: 'rgba(255,255,255,0.13)',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '7px 12px',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  backdropFilter: 'blur(10px)',
                }}
              >
                {q}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Sorunuzu yazın..."
              disabled={busy}
              style={{
                minWidth: 0,
                flex: 1,
                height: 48,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.27)',
                background: 'rgba(255,255,255,0.15)',
                color: '#fff',
                outline: 'none',
                padding: '0 18px',
                fontFamily: 'inherit',
                fontSize: 13,
                backdropFilter: 'blur(12px)',
              }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              style={{
                width: 50,
                height: 50,
                borderRadius: '50%',
                border: 0,
                background: 'rgba(255,255,255,0.34)',
                color: '#231827',
                cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
                fontSize: 25,
                lineHeight: 1,
                opacity: busy || !input.trim() ? 0.55 : 1,
                boxShadow: '0 10px 26px rgba(30,15,40,0.2)',
              }}
              title="Gönder"
            >
              →
            </button>
          </form>
        </div>
      </div>
      )}
    </>
  );
}


export function InsightsCard({ insights, autoMs = 60000, assistantContext }: InsightsCardProps) {
  const [idx, setIdx] = useState(0);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [transitionKey, setTransitionKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const filterIdRef = useRef('mg-goo-' + Math.random().toString(36).slice(2, 8));

  const list = insights.length > 0 ? insights : [];
  const advance = (dir: number) => {
    setIdx((i) => (i + dir + list.length) % list.length);
    setTransitionKey((k) => k + 1);
  };

  useEffect(() => {
    if (assistantOpen || !autoMs || list.length <= 1) return;
    timerRef.current = setTimeout(() => advance(1), autoMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, autoMs, assistantOpen]);

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
        minHeight: assistantOpen ? 390 : 260,
        boxShadow: assistantOpen
          ? '0 22px 68px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.18)'
          : '0 16px 48px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
        background: cur.palette[4],
        isolation: 'isolate',
        transition: 'min-height 0.72s cubic-bezier(0.22,1,0.36,1), box-shadow 0.72s cubic-bezier(0.22,1,0.36,1)',
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

      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          opacity: assistantOpen ? 0 : 1,
          transform: assistantOpen ? 'scale(0.94) translateY(-10px)' : 'scale(1) translateY(0)',
          filter: assistantOpen ? 'blur(8px)' : 'blur(0px)',
          pointerEvents: assistantOpen ? 'none' : 'auto',
          transition: 'opacity 0.32s ease, transform 0.62s cubic-bezier(0.22,1,0.36,1), filter 0.5s ease',
        }}
      >
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

        {!assistantOpen && assistantContext && (
          <CostInsightAssistant
            context={assistantContext}
            activeInsight={cur}
            open={assistantOpen}
            setOpen={setAssistantOpen}
            showPanel={false}
          />
        )}

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

      {assistantContext && (
        <CostInsightAssistant
          context={assistantContext}
          activeInsight={cur}
          open={assistantOpen}
          setOpen={setAssistantOpen}
          showTrigger={false}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// KpiBreakdownModal — KPI kartına tıklanınca hesabın alt kırılımını gösterir
// ────────────────────────────────────────────────────────────────────────────

export interface KpiBreakdownRow {
  label: string;
  value?: string;
  sub?: string;
  onClick?: () => void;
}

export function KpiBreakdownModal({
  title,
  subtitle,
  rows,
  onClose,
}: {
  title: string;
  subtitle?: string;
  rows: KpiBreakdownRow[];
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--mg-surface)',
          border: '1px solid var(--mg-border)',
          borderRadius: 18,
          width: 'min(560px, 100%)',
          maxHeight: '72vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--mg-border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--mg-text)' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: 'var(--mg-muted)', marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="Kapat"
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: '1px solid var(--mg-border)',
              background: 'var(--mg-surface-2)',
              color: 'var(--mg-text-2)',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 20px 16px' }}>
          {rows.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--mg-muted)' }}>Kırılım verisi yok.</div>
          ) : (
            rows.map((r, i) => (
              <div
                key={`${r.label}-${i}`}
                role={r.onClick ? 'button' : undefined}
                tabIndex={r.onClick ? 0 : undefined}
                onClick={r.onClick}
                onKeyDown={(e) => { if (r.onClick && (e.key === 'Enter' || e.key === ' ')) r.onClick(); }}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: i < rows.length - 1 ? '1px solid var(--mg-border)' : 'none',
                  cursor: r.onClick ? 'pointer' : 'default',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mg-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                  {r.sub && <div style={{ fontSize: 11, color: 'var(--mg-muted)', marginTop: 1 }}>{r.sub}</div>}
                </div>
                {r.value != null && (
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mg-accent)', whiteSpace: 'nowrap' }}>{r.value}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Re-export HBarList
export { HBarList };
