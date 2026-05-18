'use client';

/**
 * Maliyet Gözlem Merkezi — ana container.
 *
 * Verilen Maliyet_Dashboard.html'in React/TypeScript adaptasyonu.
 * Sidebar yok, sol üst başlık yok, tema/bildirim butonları yok (dockta var).
 * Header'da: arama + tek "ayarlar" butonu (içinde döviz seçimi + Excel/PDF
 * export). Altta tab switcher (Stok / Test) ve seçili tab içeriği.
 *
 * Urbanist font sayfaya scope edilir; tema (dark/light) html'deki `dark`
 * class'ı üzerinden otomatik takip edilir.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Urbanist } from 'next/font/google';
import { Search, Settings, Download, X } from 'lucide-react';
import type { Currency } from '@/lib/types';
import { TestTab } from './TestTab';
import { StokTab } from './StokTab';

const urbanist = Urbanist({
  subsets: ['latin'],
  variable: '--font-urbanist',
  weight: ['300', '400', '500', '600', '700', '800', '900'],
});

type TabKey = 'stok' | 'test';

const NavStock = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
  </svg>
);
const NavLab = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2v6L4 18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2L15 8V2M8 2h8M7 14h10" />
  </svg>
);

// ────────────────────────────────────────────────────────────────────────────
// Settings dropdown — para birimi + export
// ────────────────────────────────────────────────────────────────────────────

interface SettingsMenuProps {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  onExportExcel?: () => void;
  onExportPdf?: () => void;
}

function SettingsMenu({ currency, setCurrency, onExportExcel, onExportPdf }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Ayarlar"
        style={{
          height: 36,
          padding: '0 14px',
          borderRadius: 10,
          background: 'var(--mg-surface)',
          border: '1px solid var(--mg-border)',
          color: 'var(--mg-text-2)',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Settings size={14} />
        Ayarlar
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            minWidth: 260,
            padding: 12,
            background: 'var(--mg-surface)',
            border: '1px solid var(--mg-border)',
            borderRadius: 14,
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            zIndex: 100,
            backdropFilter: 'blur(20px)',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Para Birimi
          </div>
          <div style={{ display: 'inline-flex', background: 'var(--mg-surface-2)', borderRadius: 10, padding: 3, width: '100%' }}>
            {(['TRY', 'USD', 'EUR'] as Currency[]).map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: 7,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  background: currency === c ? 'var(--mg-accent)' : 'transparent',
                  color: currency === c ? '#0a0a0c' : 'var(--mg-text-2)',
                  transition: 'all 0.2s',
                }}
              >
                {c === 'TRY' ? '₺ TRY' : c === 'USD' ? '$ USD' : '€ EUR'}
              </button>
            ))}
          </div>

          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: 'var(--mg-muted)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginTop: 14,
              marginBottom: 8,
            }}
          >
            Dışa Aktar
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => {
                onExportExcel?.();
                setOpen(false);
              }}
              style={{
                flex: 1,
                height: 32,
                padding: '0 10px',
                borderRadius: 8,
                background: 'var(--mg-surface-2)',
                border: '1px solid var(--mg-border)',
                color: 'var(--mg-text-2)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Download size={12} /> Excel
            </button>
            <button
              onClick={() => {
                onExportPdf?.();
                setOpen(false);
              }}
              style={{
                flex: 1,
                height: 32,
                padding: '0 10px',
                borderRadius: 8,
                background: 'var(--mg-surface-2)',
                border: '1px solid var(--mg-border)',
                color: 'var(--mg-text-2)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Download size={12} /> PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Header
// ────────────────────────────────────────────────────────────────────────────

interface HeaderProps {
  search: string;
  setSearch: (s: string) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
}

function Header({ search, setSearch, currency, setCurrency }: HeaderProps) {
  return (
    <header
      style={{
        height: 64,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 24px',
        borderBottom: '1px solid var(--mg-border)',
        background: 'var(--mg-header-bg)',
        backdropFilter: 'blur(20px)',
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--mg-surface)',
          borderRadius: 10,
          padding: '8px 14px',
          border: '1px solid var(--mg-border)',
          flex: 1,
          maxWidth: 480,
        }}
      >
        <Search size={14} style={{ color: 'var(--mg-muted)' }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ara…"
          style={{
            background: 'none',
            border: 'none',
            outline: 'none',
            flex: 1,
            color: 'var(--mg-text)',
            fontSize: 13,
            fontFamily: 'inherit',
            fontWeight: 500,
            minWidth: 0,
          }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mg-muted)' }}
            aria-label="Temizle"
          >
            <X size={14} />
          </button>
        )}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--mg-muted)',
            background: 'var(--mg-surface-2)',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          ⌘K
        </span>
      </div>

      <div style={{ flex: 1 }} />

      <SettingsMenu currency={currency} setCurrency={setCurrency} />
    </header>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tab Switcher
// ────────────────────────────────────────────────────────────────────────────

interface TabSwitcherProps {
  value: TabKey;
  onChange: (v: TabKey) => void;
  counts: { stok: number; test: number };
}

function TabSwitcher({ value, onChange, counts }: TabSwitcherProps) {
  const tabs: { k: TabKey; label: string; labelShort: string; icon: React.ReactNode; count: number; desc: string }[] = [
    { k: 'stok', label: 'Stok Maliyeti', labelShort: 'Stok', icon: NavStock, count: counts.stok, desc: 'Envanter ve marka kırılımı' },
    { k: 'test', label: 'Test Bazlı Maliyet', labelShort: 'Test', icon: NavLab, count: counts.test, desc: 'Test başına detaylı dağılım' },
  ];
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '20px 24px 0',
        borderBottom: '1px solid var(--mg-border)',
      }}
    >
      {tabs.map((t) => {
        const active = value === t.k;
        return (
          <button
            key={t.k}
            onClick={() => onChange(t.k)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '12px 0',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              position: 'relative',
              marginRight: 20,
              color: active ? 'var(--mg-text)' : 'var(--mg-muted)',
              transition: 'color 0.2s',
              fontFamily: 'inherit',
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: active ? 'var(--mg-accent-soft)' : 'var(--mg-surface)',
                color: active ? 'var(--mg-accent)' : 'var(--mg-muted)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid ' + (active ? 'rgba(251,146,60,0.3)' : 'var(--mg-border)'),
              }}
            >
              {t.icon}
            </span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.label}</div>
              <div style={{ fontSize: 11, color: 'var(--mg-muted)', fontWeight: 500, marginTop: 1 }}>{t.desc}</div>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: 6,
                background: active ? 'var(--mg-accent)' : 'var(--mg-surface-2)',
                color: active ? '#0a0a0c' : 'var(--mg-muted)',
                marginLeft: 4,
              }}
            >
              {t.count}
            </span>

            {active && (
              <span
                style={{
                  position: 'absolute',
                  bottom: -1,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: 'var(--mg-accent)',
                  borderRadius: 2,
                  boxShadow: '0 0 8px var(--mg-accent)',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Container
// ────────────────────────────────────────────────────────────────────────────

interface MaliyetGozlemMerkeziProps {
  /** Tab'i dışarıdan kontrol etmek için; verilmezse component kendi state'i */
  initialTab?: TabKey;
}

export default function MaliyetGozlemMerkezi({ initialTab = 'test' }: MaliyetGozlemMerkeziProps) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [currency, setCurrency] = useState<Currency>('TRY');
  const [search, setSearch] = useState('');

  // Tab counts — TestTab/StokTab kendi içlerinde fetch edip count'u expose etmiyor;
  // basitlik için 0 veriyoruz, UI'da sembolik.
  const [counts] = useState({ stok: 0, test: 0 });

  return (
    <div
      className={`mg-root ${urbanist.className} ${urbanist.variable}`}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `radial-gradient(ellipse at 0% 0%, rgba(251,146,60,0.06) 0%, transparent 50%),
                     radial-gradient(ellipse at 100% 100%, rgba(167,139,250,0.04) 0%, transparent 50%),
                     var(--mg-bg)`,
        color: 'var(--mg-text)',
        letterSpacing: '-0.005em',
        fontFamily: urbanist.style.fontFamily,
      }}
    >
      <Header search={search} setSearch={setSearch} currency={currency} setCurrency={setCurrency} />
      <TabSwitcher value={tab} onChange={setTab} counts={counts} />

      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '24px',
        }}
      >
        {tab === 'stok' ? (
          <StokTab currency={currency} />
        ) : (
          <TestTab currency={currency} search={search} setSearch={setSearch} />
        )}

        <div style={{ height: 40 }} />
      </main>
    </div>
  );
}
