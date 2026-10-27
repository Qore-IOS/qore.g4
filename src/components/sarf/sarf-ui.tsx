'use client';

/* Sarf Dağıtım — paylaşılan UI primitifleri.
   Demo dosyalarının (sarf-list.jsx / sarf-transfers.jsx / sarf-app.jsx)
   birebir uygulama içi karşılığı. Krem/bej claymorphism. */

import React from 'react';
import localFont from 'next/font/local';
import QRCodeLib from 'qrcode';
import { IconSearch, IconQr, IconCheck } from './sarf-icons';
import type { SarfTransferItem } from '@/lib/types';
import './sarf-theme.css';

export const sarfFont = localFont({
 src: [{path:'../../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2'},{path:'../../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2'}],
 weight:'200 800',display:'swap',
});

/* Tek sıcak aksan paleti (demo "Kum") */
export const SARF_AC = {
  primary: '#C68A5E',
  accent: '#DBB36C',
  glow: 'rgba(198,138,94,0.30)',
};

/* Ürün kapak renkleri — chip ve tüp ikonlarında döngüsel kullanılır */
export const SARF_CAPS = ['#DBB36C', '#E0C24A', '#9B6FC4', '#D2604E', '#7FA9D8', '#8FA67E'];

export const capForIndex = (i: number) => SARF_CAPS[Math.abs(i) % SARF_CAPS.length];

export const sarfMono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/* ——— Shell: skin + font + içerik genişliği ——— */
export const SarfShell = ({ children, maxWidth = 1240 }: { children: React.ReactNode; maxWidth?: number }) => {
  // PageShell'in dock boşluğu gibi skin dışında kalan alanlarda uygulamanın
  // kendi arka planı görünmesin diye body'ye de sarf kremi uygulanır.
  React.useEffect(() => {
    document.body.classList.add('sarf-edge-body');
    return () => { document.body.classList.remove('sarf-edge-body'); };
  }, []);

  return (
    <div className={`sarf-skin ${sarfFont.className}`}>
      <div style={{ maxWidth, margin: '0 auto', padding: '32px 40px', minHeight: '100vh' }} className="sarf-shell-pad">
        {children}
      </div>
    </div>
  );
};

/* ——— Soft (clay) buton ——— */
export const SoftBtn = ({
  children, onClick, round, aria, style, disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  round?: boolean;
  aria?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) => {
  const [p, setP] = React.useState(false);
  return (
    <button
      aria-label={aria}
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => setP(true)}
      onMouseUp={() => setP(false)}
      onMouseLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', boxSizing: 'border-box',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        width: round ? 46 : 'auto', height: 46,
        padding: round ? 0 : '0 20px',
        borderRadius: round ? '50%' : 'var(--sarf-radius-sm)',
        background: 'linear-gradient(180deg, var(--sarf-surface-hi) 0%, var(--sarf-surface-2) 100%)',
        boxShadow: p ? 'var(--sarf-clay-press)' : 'var(--sarf-clay)',
        color: 'var(--sarf-ink-1)', fontWeight: 700, fontSize: 14,
        transition: 'transform 160ms ease, box-shadow 160ms ease',
        transform: p ? 'translateY(1px) scale(0.98)' : 'none',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
};

/* ——— Birincil (turuncu radial) buton ——— */
export const PrimaryBtn = ({
  children, onClick, disabled, style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) => {
  const [p, setP] = React.useState(false);
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseDown={() => !disabled && setP(true)}
      onMouseUp={() => setP(false)}
      onMouseLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer', boxSizing: 'border-box',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 11,
        height: 52, padding: '0 24px', borderRadius: 'var(--sarf-radius-pill)',
        background: disabled
          ? 'var(--sarf-surface-2)'
          : `radial-gradient(130% 150% at 30% 20%, ${SARF_AC.accent} 0%, ${SARF_AC.primary} 75%)`,
        boxShadow: disabled
          ? 'var(--sarf-clay-inset)'
          : (p
            ? `inset 0 3px 7px rgba(120,80,40,0.35), 0 4px 10px -4px ${SARF_AC.glow}`
            : `inset 0 2px 2px rgba(255,255,255,0.45), inset 0 -6px 12px rgba(120,80,40,0.22), 0 14px 26px -8px ${SARF_AC.glow}`),
        color: disabled ? 'var(--sarf-ink-3)' : '#fff',
        fontWeight: 800, fontSize: 15, letterSpacing: '0.01em',
        transition: 'transform 160ms ease, box-shadow 160ms ease',
        transform: p ? 'translateY(1px) scale(0.99)' : 'none',
        ...style,
      }}
    >
      {children}
    </button>
  );
};

/* ——— Arama kutusu ——— */
export const SearchBox = ({
  value, onChange, placeholder, width,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number | string;
}) => (
  <div style={{ position: 'relative', width: width || '100%', maxWidth: width || 'none' }}>
    <span style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--sarf-ink-3)', display: 'inline-flex' }}>
      <IconSearch />
    </span>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', boxSizing: 'border-box', height: 52,
        padding: '0 18px 0 48px', borderRadius: 'var(--sarf-radius-pill)',
        border: 'none', background: 'var(--sarf-surface-2)',
        boxShadow: 'var(--sarf-clay-inset)',
        color: 'var(--sarf-ink-1)', fontSize: 15, fontWeight: 500, fontFamily: 'inherit',
        outline: 'none',
      }}
    />
  </div>
);

/* ——— QR kutusu: beyaz yuvarlatılmış kart içinde QR ——— */
export const QrBox = ({ value, size = 92, dim }: { value: string; size?: number; dim?: boolean }) => {
  const [src, setSrc] = React.useState<string>('');
  React.useEffect(() => {
    let alive = true;
    if (!value) { setSrc(''); return; }
    QRCodeLib.toDataURL(value, { margin: 0, width: size * 2, color: { dark: '#2A2620', light: '#FFFFFF' } })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(''); });
    return () => { alive = false; };
  }, [value, size]);

  return (
    <div style={{
      width: size + 18, height: size + 18, flexShrink: 0,
      borderRadius: 14, background: 'var(--qc-surface-hi)',
      boxShadow: 'var(--sarf-clay-soft)',
      display: 'grid', placeItems: 'center',
      opacity: dim ? 0.5 : 1, filter: dim ? 'grayscale(0.4)' : 'none',
    }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={value} width={size} height={size} style={{ display: 'block', borderRadius: 4 }} />
      ) : (
        <span style={{ color: 'var(--sarf-ink-3)' }}><IconQr s={Math.round(size * 0.5)} /></span>
      )}
    </div>
  );
};

/* ——— Sekme çubuğu ——— */
export interface SarfTab {
  id: string;
  label: string;
  count?: number;
  dot?: string;
}

export const TabBar = ({ tabs, tab, setTab }: { tabs: SarfTab[]; tab: string; setTab: (id: string) => void }) => (
  <div style={{
    display: 'inline-flex', gap: 6, padding: 6, marginBottom: 20,
    borderRadius: 'var(--sarf-radius-pill)',
    background: 'var(--sarf-surface-2)', boxShadow: 'var(--sarf-clay-inset)',
    maxWidth: '100%', flexWrap: 'wrap',
  }}>
    {tabs.map((tb) => {
      const on = tab === tb.id;
      return (
        <button
          key={tb.id}
          onClick={() => setTab(tb.id)}
          style={{
            all: 'unset', cursor: 'pointer', boxSizing: 'border-box',
            display: 'inline-flex', alignItems: 'center', gap: 9,
            height: 44, padding: '0 20px', borderRadius: 'var(--sarf-radius-pill)',
            background: on ? 'linear-gradient(180deg, var(--sarf-surface-hi), var(--sarf-surface-2))' : 'transparent',
            boxShadow: on ? 'var(--sarf-clay)' : 'none',
            color: on ? 'var(--sarf-ink-1)' : 'var(--sarf-ink-2)',
            fontSize: 14.5, fontWeight: 700,
            transition: 'color 160ms ease',
          }}
        >
          {tb.dot && (
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: tb.dot,
              boxShadow: on ? `0 0 8px ${tb.dot}` : 'none', opacity: on ? 1 : 0.5,
            }} />
          )}
          {tb.label}
          {tb.count != null && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999,
              background: on ? SARF_AC.primary : 'rgba(150,128,96,0.18)',
              color: on ? '#fff' : 'var(--sarf-ink-2)', fontSize: 12, fontWeight: 800,
            }}>{tb.count}</span>
          )}
        </button>
      );
    })}
  </div>
);

/* ——— Klinik kartı metriği ——— */
export const Metric = ({ label, value, cap, mono }: { label: string; value: React.ReactNode; cap?: string; mono?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
    {cap && <span style={{ width: 8, height: 8, borderRadius: '50%', background: cap, boxShadow: `0 0 0 3px ${cap}22`, flexShrink: 0 }} />}
    <span style={{ fontSize: 12.5, color: 'var(--sarf-ink-3)', fontWeight: 600 }}>{label}</span>
    <span style={{ marginLeft: 'auto', fontSize: 13.5, fontWeight: 700, color: 'var(--sarf-ink-1)', fontFamily: mono ? sarfMono : 'inherit' }}>{value}</span>
  </div>
);

/* ——— Transfer kartı meta alanı ——— */
export const Meta = ({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    <span style={{ fontSize: 11, color: 'var(--sarf-ink-3)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--sarf-ink-1)', fontFamily: mono ? sarfMono : 'inherit' }}>{value}</span>
  </div>
);

/* ——— Ürün chip listesi ——— */
export const ItemChips = ({ items }: { items: SarfTransferItem[] }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
    {items.slice(0, 3).map((it, i) => (
      <span key={i} style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '6px 11px', borderRadius: 'var(--sarf-radius-pill)',
        background: 'var(--sarf-surface-2)', boxShadow: 'var(--sarf-clay-inset)',
        fontSize: 12.5, fontWeight: 600, color: 'var(--sarf-ink-1)',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: capForIndex(i) }} />
        {it.stokAdi} <strong style={{ color: 'var(--sarf-ink-2)' }}>×{it.adet}</strong>
      </span>
    ))}
    {items.length > 3 && (
      <span style={{
        padding: '6px 11px', borderRadius: 'var(--sarf-radius-pill)',
        background: 'var(--sarf-surface-2)', boxShadow: 'var(--sarf-clay-inset)',
        fontSize: 12.5, fontWeight: 700, color: 'var(--sarf-ink-2)',
      }}>+{items.length - 3} ürün</span>
    )}
  </div>
);

/* ——— Durum rozetleri ——— */
export const PendingPill = ({ label = 'Kabul Bekliyor' }: { label?: string }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', borderRadius: 'var(--sarf-radius-pill)',
    background: 'var(--sarf-surface-2)', boxShadow: 'var(--sarf-clay-inset)', color: SARF_AC.primary,
    fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
  }}>
    <span style={{
      width: 8, height: 8, borderRadius: '50%', background: SARF_AC.primary,
      boxShadow: `0 0 8px ${SARF_AC.primary}`, animation: 'sarfPulseDot 1.4s ease-in-out infinite',
    }} />
    {label}
  </span>
);

export const DeliveredPill = ({ label = 'Teslim Edildi' }: { label?: string }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', borderRadius: 'var(--sarf-radius-pill)',
    background: 'rgba(143,166,126,0.16)', color: '#5E7A4E',
    fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
  }}>
    <span style={{ color: '#5E7A4E', display: 'inline-flex' }}><IconCheck /></span>
    {label}
  </span>
);

/* ——— Adet stepper'ı (− value +) ——— */
export const Stepper = ({ value, onChange, max }: { value: number; onChange: (v: number) => void; max?: number }) => {
  const StepBtn = ({ dir, disabled }: { dir: 1 | -1; disabled?: boolean }) => {
    const [p, setP] = React.useState(false);
    return (
      <button
        disabled={disabled}
        onClick={() => onChange(Math.max(0, value + dir))}
        onMouseDown={() => !disabled && setP(true)}
        onMouseUp={() => setP(false)}
        onMouseLeave={() => setP(false)}
        style={{
          all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer',
          width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: dir > 0
            ? `radial-gradient(120% 120% at 30% 25%, ${SARF_AC.accent} 0%, ${SARF_AC.primary} 80%)`
            : 'linear-gradient(180deg, var(--sarf-surface-hi), var(--sarf-surface-2))',
          boxShadow: p ? 'var(--sarf-clay-press)' : (dir > 0 ? `inset 0 2px 2px rgba(255,255,255,0.45), 0 6px 12px -3px ${SARF_AC.glow}` : 'var(--sarf-clay-soft)'),
          color: dir > 0 ? '#fff' : 'var(--sarf-ink-2)',
          opacity: disabled ? 0.4 : 1,
          transition: 'transform 140ms ease',
          transform: p ? 'scale(0.92)' : 'none',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          {dir > 0
            ? <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            : <path d="M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />}
        </svg>
      </button>
    );
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'center',
      padding: 6, borderRadius: 'var(--sarf-radius-pill)',
      background: 'var(--sarf-surface-2)', boxShadow: 'var(--sarf-clay-inset)',
    }}>
      <StepBtn dir={-1} disabled={value <= 0} />
      <input
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value.replace(/\D/g, ''), 10);
          onChange(Number.isNaN(v) ? 0 : (max != null ? Math.min(max, v) : v));
        }}
        style={{
          width: 40, textAlign: 'center', border: 'none', background: 'transparent',
          fontSize: 17, fontWeight: 800, color: value > 0 ? SARF_AC.primary : 'var(--sarf-ink-3)',
          fontFamily: 'inherit', outline: 'none',
        }}
      />
      <StepBtn dir={1} />
    </div>
  );
};

/* ——— Başarı overlay'i (RippleConfirm karşılığı) ——— */
export const SarfSuccessOverlay = ({
  show, code, label = 'Teslimat Tamamlandı', onDone,
}: {
  show: boolean;
  code?: string | null;
  label?: string;
  onDone: () => void;
}) => {
  React.useEffect(() => {
    if (!show) return;
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [show, onDone]);

  if (!show) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80, display: 'grid', placeItems: 'center',
      background: 'rgba(40,32,20,0.35)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      animation: 'sarfSheetFade 200ms ease',
    }}>
      <div style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        padding: '40px 56px', borderRadius: 'var(--sarf-radius-lg)',
        background: 'linear-gradient(180deg, var(--sarf-surface) 0%, var(--sarf-surface-2) 100%)',
        boxShadow: 'var(--sarf-clay)',
        animation: 'sarfPopIn 320ms cubic-bezier(.2,.8,.2,1.1)',
      }}>
        <div style={{ position: 'relative', width: 84, height: 84, display: 'grid', placeItems: 'center' }}>
          <span style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '3px solid var(--sarf-sage)', animation: 'sarfRipple 1.2s ease-out infinite',
          }} />
          <span style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #B6E2A8, var(--sarf-sage))',
            boxShadow: '0 0 0 8px rgba(143,166,126,0.22), 0 10px 22px -4px rgba(94,122,78,0.6)',
            display: 'grid', placeItems: 'center', color: '#fff',
          }}>
            <IconCheck s={34} w={3.2} />
          </span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--sarf-ink-1)' }}>{label}</div>
        {code && (
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sarf-ink-2)', fontFamily: sarfMono }}>{code}</div>
        )}
      </div>
    </div>
  );
};

/* ——— Boş durum kutusu ——— */
export const SarfEmpty = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <div style={{
    padding: '60px 30px', textAlign: 'center', borderRadius: 'var(--sarf-radius)',
    background: 'var(--sarf-surface-2)', boxShadow: 'var(--sarf-clay-inset)',
    color: 'var(--sarf-ink-3)',
  }}>
    <div style={{ width: 64, height: 64, margin: '0 auto 14px', opacity: 0.6 }}>{icon}</div>
    <div style={{ fontSize: 15, fontWeight: 600 }}>{text}</div>
  </div>
);
