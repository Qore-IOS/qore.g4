'use client';

/**
 * Yönetim panellerinin paylaşılan UI birimleri.
 * Maliyet Gözlem panelindeki tasarım dilini (mg-* renkler, tipografi,
 * animasyonlar) yönetim hub'larında yeniden kullanır.
 */

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { useIsMobile } from '@/components/maliyet-gozlem/useIsMobile';

// ────────────────────────────────────────────────────────────────────────────
// YonetimShell — sayfa kabuğu (mg-root tema + edge-to-edge background)
// ────────────────────────────────────────────────────────────────────────────

export function YonetimShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div
      className="mg-root yonetim-hub-shell"
      style={{
        minHeight: '100vh',
        padding: isMobile ? '16px 14px 28px' : '24px clamp(24px, 3vw, 44px) 40px',
        background: 'transparent',
        color: 'var(--mg-text)',
        letterSpacing: '-0.005em',
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? 16 : 20,
      }}
    >
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// YonetimHeader — başlık + geri butonu + sağda opsiyonel action
// ────────────────────────────────────────────────────────────────────────────

interface YonetimHeaderProps {
  title: string;
  description?: string;
  backHref?: string;
  rightAction?: React.ReactNode;
}

export function YonetimHeader({ title, description, backHref, rightAction }: YonetimHeaderProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  return (
    <div className="yonetim-hub-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button
        onClick={() => (backHref ? router.push(backHref) : router.back())}
        style={{
          width: isMobile ? 44 : 42,
          height: isMobile ? 44 : 42,
          borderRadius: 15,
          background: 'var(--mg-surface)',
          border: '1px solid var(--mg-border)',
          boxShadow: 'var(--qc-clay-flat)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--mg-text-2)',
          flexShrink: 0,
        }}
        aria-label="Geri"
      >
        <ArrowLeft size={16} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1
          style={{
            fontSize: isMobile ? 23 : 30,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--mg-text)',
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
        {description && (
          <p
            style={{
              fontSize: isMobile ? 13 : 14,
              color: 'var(--mg-muted)',
              margin: '4px 0 0',
              fontWeight: 500,
            }}
          >
            {description}
          </p>
        )}
      </div>
      {rightAction && <div style={{ flexShrink: 0 }}>{rightAction}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// YonetimTile — modül kartı
// ────────────────────────────────────────────────────────────────────────────

export interface YonetimTileProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  href?: string;
  onClick?: () => void;
  color?: string;
  badge?: React.ReactNode;
  attention?: boolean;
}

export function YonetimTile({
  icon: Icon,
  label,
  description,
  href,
  onClick,
  color = 'var(--mg-accent)',
  badge,
  attention,
}: YonetimTileProps) {
  const content = (
    <div
      className="yonetim-hub-tile"
      onClick={onClick}
      style={{
        background: 'linear-gradient(145deg, var(--qc-surface-hi), var(--qc-surface2))',
        border: '1px solid var(--mg-border)',
        borderRadius: 26,
        padding: '20px',
        boxShadow: 'var(--qc-clay)',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 154,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = `var(--qc-clay), 0 12px 26px -18px ${color}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = 'var(--qc-clay)';
      }}
    >
      {/* Soft glow blob */}
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
          opacity: 0.08,
          pointerEvents: 'none',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: color + '18',
            color,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid ' + color + '33',
          }}
        >
          <Icon size={18} />
        </span>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            border: '1px solid var(--mg-border-strong)',
            background: 'transparent',
            color: 'var(--mg-text-2)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ArrowUpRight size={14} />
        </span>
        {attention && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: 28,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--mg-accent)',
              boxShadow: '0 0 8px var(--mg-accent)',
            }}
          />
        )}
      </div>

      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--mg-text)',
            letterSpacing: '-0.01em',
            marginBottom: 4,
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--mg-muted)',
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            {description}
          </div>
        )}
      </div>
      {badge && <div>{badge}</div>}
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        {content}
      </Link>
    );
  }
  return content;
}

// ────────────────────────────────────────────────────────────────────────────
// YonetimTileGrid — responsive grid layout
// ────────────────────────────────────────────────────────────────────────────

export function YonetimTileGrid({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: isMobile ? 14 : 18,
      }}
    >
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// YonetimCard — alt panel sayfalarında kullanılabilen genel kart
// ────────────────────────────────────────────────────────────────────────────

export function YonetimCard({
  children,
  padding = 16,
  title,
  description,
}: {
  children: React.ReactNode;
  padding?: number;
  title?: string;
  description?: string;
}) {
  return (
    <div
      className="yonetim-hub-card"
      style={{
        background: 'var(--mg-surface)',
        border: '1px solid var(--mg-border)',
        borderRadius: 28,
        padding,
        boxShadow: 'var(--qc-clay)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {(title || description) && (
        <div>
          {title && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: 'var(--mg-text)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {title}
            </div>
          )}
          {description && (
            <div style={{ fontSize: 12, color: 'var(--mg-muted)', marginTop: 4, fontWeight: 500 }}>
              {description}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
