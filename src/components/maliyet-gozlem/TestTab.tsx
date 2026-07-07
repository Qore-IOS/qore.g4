'use client';

/**
 * Maliyet Gözlem — Test Bazlı Maliyet Tab.
 *
 * Test tanımları, ürünler, depo stoğu, cihazlar, envanter, personel ve döviz
 * verilerini canlı çekip her test için maliyet hesaplar; ardından mock yerine
 * gerçek veriye dayalı kategori pills, KPI satırı, Activities Panel, Insights
 * kartı ve detaylı test tablosu sunar.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateAllTestCosts,
  calculateSystemTotal,
  type TestCostBreakdown,
  type PeriotConfig,
} from '../../lib/test-cost-calculator';
import type {
  ProductCode,
  Hospital,
  Device,
  AssignedDevice,
  Asset,
  Personnel,
  TestDefinitionGlobal,
  DepoStokItem,
  Currency,
} from '../../lib/types';
import { ActivitiesPanel, InsightsCard, MiniStat, SectionHeader, Card } from './primitives';
import { useIsMobile } from './useIsMobile';
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useAuth } from '@/contexts/auth-context';
import { getExchangeRates } from '@/lib/exchange-rates';
import { Loader2, ChevronDown, ChevronsUpDown, Search, Check, X } from 'lucide-react';
import { LabSelector } from '@/components/common/LabSelector';

// ────────────────────────────────────────────────────────────────────────────
// Filtre satırı (lab + tek/çoklu seçim)
// ────────────────────────────────────────────────────────────────────────────

interface FilterBarProps {
  labs: Hospital[];
  selectedLabIds: string[];
  setSelectedLabIds: (ids: string[]) => void;
  testDefs: TestDefinitionGlobal[];
  selectedTestIds: string[];
  setSelectedTestIds: (ids: string[]) => void;
  periot: PeriotConfig;
  setPeriot: (p: PeriotConfig) => void;
  search: string;
  setSearch: (s: string) => void;
}

/**
 * Aramalı, tekli/çoklu/tümünü seç destekli açılır seçici.
 * Lab veya test listelerinde kullanılır.
 */
interface MultiSelectProps {
  label: string;
  options: { id: string; label: string; sub?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  width?: number;
}

function MultiSelect({ label, options, selected, onChange, placeholder, width = 280 }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const s = q.toLowerCase().trim();
    return options.filter((o) => o.label.toLowerCase().includes(s) || (o.sub?.toLowerCase().includes(s) ?? false));
  }, [options, q]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };
  const allSelected = selected.length === options.length && options.length > 0;
  const noneSelected = selected.length === 0;
  const selectAll = () => onChange(allSelected ? [] : options.map((o) => o.id));

  const summary =
    noneSelected || allSelected
      ? `Tüm ${label.toLowerCase()} (${options.length})`
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.label || '1 seçili'
        : `${selected.length} seçili`;

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: width || undefined, width: width === 0 ? '100%' : undefined }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          minHeight: 38,
          padding: '7px 12px',
          borderRadius: 10,
          cursor: 'pointer',
          background: 'var(--mg-surface)',
          border: '1px solid ' + (selected.length > 0 && !allSelected ? 'var(--mg-accent)' : 'var(--mg-border)'),
          color: 'var(--mg-text)',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          transition: 'all 0.2s',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {label}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        </span>
        <ChevronsUpDown size={14} style={{ color: 'var(--mg-muted)', flexShrink: 0 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            minWidth: width,
            background: 'var(--mg-surface)',
            border: '1px solid var(--mg-border-strong)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            zIndex: 100,
            backdropFilter: 'blur(20px)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 360,
          }}
        >
          {/* Arama */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderBottom: '1px solid var(--mg-border)',
            }}
          >
            <Search size={14} style={{ color: 'var(--mg-muted)' }} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder || 'Ara…'}
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
            {q && (
              <button onClick={() => setQ('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mg-muted)' }}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Tümünü seç + temizle */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              padding: '8px 12px',
              borderBottom: '1px solid var(--mg-border)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <button
              onClick={selectAll}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 7,
                background: allSelected ? 'var(--mg-accent)' : 'var(--mg-surface-2)',
                color: allSelected ? '#0a0a0c' : 'var(--mg-text-2)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {allSelected ? 'Tümü seçili' : 'Tümünü seç'}
            </button>
            {selected.length > 0 && (
              <button
                onClick={() => onChange([])}
                style={{
                  padding: '6px 10px',
                  borderRadius: 7,
                  background: 'var(--mg-surface-2)',
                  color: 'var(--mg-muted)',
                  border: '1px dashed var(--mg-border-strong)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                Temizle ({selected.length})
              </button>
            )}
          </div>

          {/* Liste */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--mg-muted)', fontSize: 12 }}>
                Eşleşen sonuç yok
              </div>
            ) : (
              filtered.map((o) => {
                const checked = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(o.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: checked ? 'var(--mg-accent-soft)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--mg-text)',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!checked) (e.currentTarget as HTMLButtonElement).style.background = 'var(--mg-surface-2)';
                    }}
                    onMouseLeave={(e) => {
                      if (!checked) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        border: '1px solid ' + (checked ? 'var(--mg-accent)' : 'var(--mg-border-strong)'),
                        background: checked ? 'var(--mg-accent)' : 'transparent',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {checked && <Check size={11} color="#0a0a0c" />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.label}
                      </span>
                      {o.sub && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 11,
                            color: 'var(--mg-muted)',
                            marginTop: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {o.sub}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// HeroKpiCard — mock'taki "Sales This Month $23,876" stili (mobile)
// ────────────────────────────────────────────────────────────────────────────

interface HeroKpiCardProps {
  label: string;
  value: number;
  sub?: string;
  color?: string;
  trend?: string;
  trendPositive?: boolean;
  decimals?: number;
  isCount?: boolean;
}

function HeroKpiCard({ label, value, sub, color = '#fb923c', trend, trendPositive, decimals = 0, isCount = false }: HeroKpiCardProps) {
  const rounded = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
  const [intPart, fracPart] = rounded.split('.');
  const intFormatted = (+intPart).toLocaleString('tr-TR');
  // Currency symbol veya count
  const symbol = isCount ? '' : '₺';

  return (
    <div
      style={{
        flex: '0 0 88%',
        scrollSnapAlign: 'start',
        background: 'var(--mg-surface)',
        border: '1px solid var(--mg-border)',
        borderRadius: 22,
        padding: '18px 18px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minHeight: 200,
        position: 'relative',
        overflow: 'hidden',
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
          opacity: 0.06,
          pointerEvents: 'none',
        }}
      />

      {/* Üst satır: etiket + arrow button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--mg-muted)' }}>{label}</span>
        <button
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid var(--mg-border-strong)',
            background: 'transparent',
            color: 'var(--mg-text-2)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          aria-label="Detay"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </button>
      </div>

      {/* Büyük rakam */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        {symbol && (
          <span style={{ fontSize: 22, fontWeight: 300, color: 'var(--mg-text)', letterSpacing: '-0.02em' }}>{symbol}</span>
        )}
        <span
          style={{
            fontSize: 48,
            fontWeight: 500,
            color: 'var(--mg-text)',
            letterSpacing: '-0.04em',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {intFormatted}
        </span>
        {fracPart && (
          <span style={{ fontSize: 22, fontWeight: 400, color: 'var(--mg-muted)', letterSpacing: '-0.02em' }}>,{fracPart}</span>
        )}
        {trend && (
          <span
            style={{
              marginLeft: 4,
              color: trendPositive ? 'var(--mg-success)' : 'var(--mg-danger)',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {trendPositive ? '↑' : '↓'}
          </span>
        )}
      </div>

      {/* Alt satır: Geçen Dönem (çapraz çizgili) + Bu Dönem (renkli pill) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div
            style={{
              flex: 1,
              height: 36,
              borderRadius: 10,
              background: `repeating-linear-gradient(45deg, transparent, transparent 4px, var(--mg-border) 4px, var(--mg-border) 5px)`,
              border: '1px solid var(--mg-border)',
            }}
          />
          <div
            style={{
              flex: 1,
              height: 36,
              borderRadius: 10,
              background: trendPositive ? 'var(--mg-success-soft)' : 'var(--mg-danger-soft)',
              border: '1px solid ' + (trendPositive ? 'var(--mg-success-soft)' : 'var(--mg-danger-soft)'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: trendPositive ? 'var(--mg-success)' : 'var(--mg-danger)',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.01em',
            }}
          >
            {trend || '—'}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--mg-muted)' }}>Geçen Dönem</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: trendPositive ? 'var(--mg-success)' : 'var(--mg-danger)' }}>
            {sub || 'Bu Dönem'}
          </span>
        </div>
      </div>
    </div>
  );
}

function FilterBar({
  labs,
  selectedLabIds,
  setSelectedLabIds,
  testDefs,
  selectedTestIds,
  setSelectedTestIds,
  periot,
  setPeriot,
}: Omit<FilterBarProps, 'search' | 'setSearch'>) {
  const isMobile = useIsMobile();
  const periodOpts: { k: PeriotConfig['type']; label: string }[] = [
    { k: 'gunluk', label: 'Günlük' },
    { k: 'aylik', label: 'Aylık' },
    { k: 'yillik', label: 'Yıllık' },
  ];

  return (
    <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: isMobile ? 'stretch' : 'center', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Periyot toggle */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          background: 'var(--mg-surface-2)',
          padding: 4,
          borderRadius: 10,
          border: '1px solid var(--mg-border)',
          width: isMobile ? '100%' : undefined,
        }}
      >
        {periodOpts.map((o) => (
          <button
            key={o.k}
            onClick={() => setPeriot({ type: o.k })}
            style={{
              padding: isMobile ? '6px 12px' : '5px 12px',
              borderRadius: 7,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.02em',
              background: periot.type === o.k ? 'var(--mg-accent)' : 'transparent',
              color: periot.type === o.k ? '#0a0a0c' : 'var(--mg-text-2)',
              transition: 'all 0.2s',
              boxShadow: periot.type === o.k ? '0 2px 8px rgba(251,146,60,0.3)' : 'none',
              flex: isMobile ? 1 : undefined,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Lab seçici (aramalı multiselect) */}
      <div style={{ width: isMobile ? '100%' : 280 }}>
        <LabSelector
          mode="multi"
          label="Lab"
          labs={labs.map((l) => ({ id: l.id, name: l.name, kod: l.kod }))}
          values={selectedLabIds}
          onValuesChange={setSelectedLabIds}
          placeholder="Laboratuvar seç..."
          searchPlaceholder="Laboratuvar ara..."
        />
      </div>

      {/* Test seçici (aramalı multiselect) */}
      <MultiSelect
        label="Test"
        placeholder="SUT kodu veya test adı ara…"
        options={testDefs.map((t) => ({
          id: t.id,
          label: t.sutTestAdi,
          sub: `SUT ${t.sutKodu} · ${(t.linkedStokKodlari || []).length} ürün`,
        }))}
        selected={selectedTestIds}
        onChange={setSelectedTestIds}
        width={isMobile ? 0 : 320}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Test Tablosu Satırı
// ────────────────────────────────────────────────────────────────────────────

function fmtTL(n: number, decimals = 2): string {
  if (!isFinite(n)) return '-';
  return `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

interface TestRowProps {
  result: TestCostBreakdown;
  expanded: boolean;
  onToggle: () => void;
  maxTotal: number;
}

function TestRow({ result, expanded, onToggle, maxTotal }: TestRowProps) {
  const isMobile = useIsMobile();
  const totalPct = (result.testTotalCostTL / Math.max(maxTotal, 1)) * 100;
  const c = result.marjTL >= 0 ? 'var(--mg-success)' : 'var(--mg-danger)';

  // Mobil: dikey kart yapısı
  if (isMobile) {
    return (
      <>
        <div
          onClick={onToggle}
          style={{
            padding: '12px 14px',
            background: expanded ? 'var(--mg-surface-2)' : 'transparent',
            borderRadius: 12,
            cursor: 'pointer',
            border: '1px solid var(--mg-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ width: 4, height: 24, borderRadius: 2, background: c, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--mg-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {result.sutTestAdi}
              </div>
              <div style={{ fontSize: 10, color: 'var(--mg-muted)', marginTop: 1 }}>
                SUT {result.sutKodu} · {result.linkedStokKodlari.length} ürün
              </div>
            </div>
            <div
              style={{
                color: 'var(--mg-muted)',
                transform: expanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.3s',
                flexShrink: 0,
              }}
            >
              <ChevronDown size={16} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Birim</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mg-text)', fontVariantNumeric: 'tabular-nums' }}>{fmtTL(result.costPerTestTL)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Adet</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mg-text-2)', fontVariantNumeric: 'tabular-nums' }}>{result.totalTestUnits.toLocaleString('tr-TR')}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Marj</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>
                {result.marjTL >= 0 ? '↑' : '↓'} {fmtTL(Math.abs(result.marjTL))}
              </div>
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Toplam</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--mg-accent)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtTL(result.testTotalCostTL, 0)}
              </span>
            </div>
            <div style={{ height: 3, background: 'var(--mg-surface-2)', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
              <div style={{ height: '100%', width: `${totalPct}%`, background: c, borderRadius: 2 }} />
            </div>
          </div>
        </div>
        {expanded && (
          <div style={{ background: 'var(--mg-surface-2)', borderRadius: 12, padding: '12px 14px 14px', marginTop: -4, marginBottom: 8, border: `1px solid ${c}33` }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Maliyet Bileşenleri</div>
            {[
              { label: 'Stok (anlık)', v: result.stockCostTL, color: '#fb923c' },
              { label: 'Envanter', v: result.inventoryCostTL, color: '#3b82f6' },
              { label: 'Cihaz', v: result.deviceCostMonthlyTL, color: '#a78bfa' },
              { label: 'Personel', v: result.personnelCostMonthlyTL, color: '#10b981' },
              { label: 'Diğer testler stoğu', v: result.otherTestsStockCostTL, color: '#71717a' },
            ].map((comp, i) => {
              const pct = result.testTotalCostTL > 0 ? (comp.v / result.testTotalCostTL) * 100 : 0;
              return (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: 'var(--mg-text-2)', fontWeight: 600 }}>{comp.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: comp.color, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtTL(comp.v, 0)} · %{pct.toFixed(0)}
                    </span>
                  </div>
                  <div style={{ height: 5, background: 'var(--mg-surface)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: comp.color, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
            {result.perLab.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 10, marginBottom: 6 }}>
                  Lab Kırılımı
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.perLab.map((l) => (
                    <div key={l.labId} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--mg-surface)', borderRadius: 6, fontSize: 11 }}>
                      <span style={{ fontWeight: 600, color: 'var(--mg-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.labName}</span>
                      <span style={{ color: 'var(--mg-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginLeft: 8 }}>
                        {l.testUnits.toLocaleString('tr-TR')}t
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1.8fr) minmax(0,1fr) 100px 110px 140px 90px 24px',
          gap: 16,
          alignItems: 'center',
          padding: '14px 18px',
          background: expanded ? 'var(--mg-surface-2)' : 'transparent',
          borderRadius: 12,
          cursor: 'pointer',
          transition: 'background 0.2s',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span style={{ width: 4, height: 28, borderRadius: 2, background: c, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--mg-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {result.sutTestAdi}
            </div>
            <div style={{ fontSize: 11, color: 'var(--mg-muted)', marginTop: 2 }}>
              SUT {result.sutKodu} · {result.linkedStokKodlari.length} ürün
            </div>
          </div>
        </div>

        <div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--mg-text-2)',
              background: 'var(--mg-chip-bg)',
              padding: '4px 10px',
              borderRadius: 10,
              border: '1px solid var(--mg-border)',
            }}
          >
            {result.linkedStokKodlari.slice(0, 2).join(', ')}
            {result.linkedStokKodlari.length > 2 && ` +${result.linkedStokKodlari.length - 2}`}
          </span>
        </div>

        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--mg-text)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {fmtTL(result.costPerTestTL)}
        </div>

        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--mg-text-2)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {result.totalTestUnits.toLocaleString('tr-TR')}
        </div>

        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: 'var(--mg-accent)',
              fontVariantNumeric: 'tabular-nums',
              marginBottom: 4,
            }}
          >
            {fmtTL(result.testTotalCostTL, 0)}
          </div>
          <div style={{ height: 3, background: 'var(--mg-surface-2)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${totalPct}%`,
                background: c,
                borderRadius: 2,
                boxShadow: `0 0 8px ${c}80`,
                transition: 'width 0.7s',
              }}
            />
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: result.marjTL >= 0 ? 'var(--mg-success)' : 'var(--mg-danger)',
              background: result.marjTL >= 0 ? 'var(--mg-success-soft)' : 'var(--mg-danger-soft)',
              padding: '3px 8px',
              borderRadius: 6,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {result.marjTL >= 0 ? '↑' : '↓'} {fmtTL(Math.abs(result.marjTL))}
          </span>
        </div>

        <div
          style={{
            color: 'var(--mg-muted)',
            display: 'flex',
            justifyContent: 'center',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.3s',
          }}
        >
          <ChevronDown size={18} />
        </div>
      </div>

      {expanded && (
        <div
          style={{
            background: 'var(--mg-surface-2)',
            borderRadius: 12,
            padding: '20px 22px 22px',
            marginTop: -6,
            marginBottom: 6,
            border: `1px solid ${c}33`,
            animation: 'mg-fadeInDown 0.3s ease',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--mg-muted)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  marginBottom: 14,
                }}
              >
                Maliyet Bileşenleri (Periyot)
              </div>
              {[
                { label: 'Stok (anlık)', v: result.stockCostTL, color: '#fb923c' },
                { label: 'Envanter', v: result.inventoryCostTL, color: '#3b82f6' },
                { label: 'Cihaz', v: result.deviceCostMonthlyTL, color: '#a78bfa' },
                { label: 'Personel', v: result.personnelCostMonthlyTL, color: '#10b981' },
                { label: 'Diğer testler stoğu', v: result.otherTestsStockCostTL, color: '#71717a' },
              ].map((comp, i) => {
                const pct = result.testTotalCostTL > 0 ? (comp.v / result.testTotalCostTL) * 100 : 0;
                return (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--mg-text-2)', fontWeight: 600 }}>{comp.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: comp.color, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtTL(comp.v, 0)} <span style={{ color: 'var(--mg-muted)', fontWeight: 500 }}>· %{pct.toFixed(0)}</span>
                      </span>
                    </div>
                    <div style={{ height: 6, background: 'var(--mg-surface)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: comp.color, borderRadius: 3, boxShadow: `0 0 6px ${comp.color}60` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Performans
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: 'var(--mg-surface)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--mg-border)' }}>
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--mg-muted)',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      marginBottom: 4,
                    }}
                  >
                    Birim
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--mg-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTL(result.costPerTestTL)}
                  </div>
                </div>
                <div style={{ background: 'var(--mg-surface)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--mg-border)' }}>
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--mg-muted)',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      marginBottom: 4,
                    }}
                  >
                    Adet
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--mg-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {result.totalTestUnits.toLocaleString('tr-TR')}
                  </div>
                </div>
                <div style={{ background: 'var(--mg-surface)', padding: '12px 14px', borderRadius: 10, border: `1px solid ${c}55`, gridColumn: 'span 2' }}>
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--mg-muted)',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      marginBottom: 4,
                    }}
                  >
                    Periyot Toplam (Full Burden)
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: c, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTL(result.testTotalCostTL, 0)}
                  </div>
                </div>
                <div style={{ background: 'var(--mg-surface)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--mg-border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--mg-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                    Hak Ediş
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--mg-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTL(result.hakEdisTL)}
                  </div>
                </div>
                <div style={{ background: 'var(--mg-surface)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--mg-border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--mg-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                    Marj
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: c, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTL(result.marjTL)}
                  </div>
                </div>
              </div>

              {result.perLab.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: 'var(--mg-muted)',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      marginTop: 8,
                      marginBottom: 8,
                    }}
                  >
                    Lab Kırılımı
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {result.perLab.map((l) => (
                      <div
                        key={l.labId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'var(--mg-surface)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--mg-text)' }}>{l.labName}</span>
                        <span style={{ color: 'var(--mg-muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {l.testUnits.toLocaleString('tr-TR')} test · {fmtTL(l.stockCostTL, 0)} stok
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Ana TestTab
// ────────────────────────────────────────────────────────────────────────────

interface TestTabProps {
  /** Header'dan gelen para birimi (gösterim için) */
  currency: Currency;
  search: string;
  setSearch: (s: string) => void;
}

export function TestTab({ currency: _currency, search, setSearch }: TestTabProps) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [labs, setLabs] = useState<Hospital[]>([]);
  const [testDefs, setTestDefs] = useState<TestDefinitionGlobal[]>([]);
  const [productMap, setProductMap] = useState<Map<string, ProductCode>>(new Map());
  const [deviceDefs, setDeviceDefs] = useState<Map<string, Device>>(new Map());
  const [assignedDevices, setAssignedDevices] = useState<AssignedDevice[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [depoStok, setDepoStok] = useState<DepoStokItem[]>([]);
  const [rates, setRates] = useState<Record<Currency, number>>({ EUR: 1, USD: 1.08, TRY: 38.5 });

  // Filtreler
  const [selectedLabIds, setSelectedLabIds] = useState<string[]>([]);
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [periot, setPeriot] = useState<PeriotConfig>({ type: 'aylik' });
  const [sortBy, setSortBy] = useState<'total' | 'unit' | 'volume'>('total');
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);

  // Veri yükleme
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [
          productsSnap,
          labsSnap,
          devicesSnap,
          assignedSnap,
          assetsSnap,
          personnelSnap,
          stokSnap,
          testDefsSnap,
          ratesValue,
        ] = await Promise.all([
          getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin, orderBy('stokAdi', 'asc'))),
          getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin, orderBy('name', 'asc'))),
          getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('hospitalDeviceAssignments', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('assets', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('personnel', currentCompanyId, isSuperAdmin)),
          // Sadece sevk edilmiş stok; server-side filter.
          getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('isShipped', '==', true))),
          getDocs(scopedQuery('testDefinitions', currentCompanyId, isSuperAdmin, orderBy('sutKodu', 'asc'))),
          getExchangeRates().catch(() => ({ EUR: 1, USD: 1.08, TRY: 38.5 })),
        ]);
        if (cancelled) return;

        const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductCode));
        const pMap = new Map<string, ProductCode>();
        products.forEach((p) => pMap.set(p.stokKodu, p));
        setProductMap(pMap);

        setLabs(
          filterByCompanyScope(
            labsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );

        const devs = devicesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Device));
        const dMap = new Map<string, Device>();
        devs.forEach((d) => dMap.set(d.id, d));
        setDeviceDefs(dMap);

        setAssignedDevices(assignedSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AssignedDevice)));
        setAssets(
          filterByCompanyScope(
            assetsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );
        setPersonnel(
          filterByCompanyScope(
            personnelSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Personnel)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );
        // Server zaten isShipped=true filtreliyor; ek client filtresi gerekmez.
        const stok = stokSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DepoStokItem));
        setDepoStok(stok);

        setTestDefs(
          filterByCompanyScope(
            testDefsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TestDefinitionGlobal)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );

        setRates(ratesValue as Record<Currency, number>);
      } catch (e) {
        console.error('TestTab data load error', e);
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentCompanyId, isSuperAdmin, reloadKey]);

  // Hesap motoru — tüm testler tek paylaşılan bağlamla hesaplanır
  // (test başına ayrı ayrı hesaplamak veri büyüdüğünde ana thread'i kilitliyordu)
  const breakdowns = useMemo<TestCostBreakdown[]>(() => {
    if (testDefs.length === 0) return [];
    return calculateAllTestCosts({
      allTestDefs: testDefs,
      productMap,
      labs,
      assignedDevices,
      deviceDefs,
      assets,
      personnel,
      depoStok,
      rates,
      periot,
      filterLabIds: selectedLabIds.length > 0 ? selectedLabIds : undefined,
    });
  }, [testDefs, productMap, labs, assignedDevices, deviceDefs, assets, personnel, depoStok, rates, periot, selectedLabIds]);

  const systemTotal = useMemo(() => {
    if (testDefs.length === 0) return null;
    return calculateSystemTotal({
      allTestDefs: testDefs,
      productMap,
      labs,
      assignedDevices,
      deviceDefs,
      assets,
      personnel,
      depoStok,
      rates,
      periot,
      filterLabIds: selectedLabIds.length > 0 ? selectedLabIds : undefined,
    });
  }, [testDefs, productMap, labs, assignedDevices, deviceDefs, assets, personnel, depoStok, rates, periot, selectedLabIds]);

  // Filtreleme + sıralama
  const filtered = useMemo(() => {
    let list = breakdowns;
    if (selectedTestIds.length > 0) list = list.filter((b) => selectedTestIds.includes(b.testId));
    if (search.trim()) {
      const s = search.toLowerCase().trim();
      list = list.filter(
        (b) => b.sutTestAdi.toLowerCase().includes(s) || b.sutKodu.toLowerCase().includes(s),
      );
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'total') return b.testTotalCostTL - a.testTotalCostTL;
      if (sortBy === 'unit') return b.costPerTestTL - a.costPerTestTL;
      if (sortBy === 'volume') return b.totalTestUnits - a.totalTestUnits;
      return 0;
    });
    return list;
  }, [breakdowns, selectedTestIds, search, sortBy]);

  const maxTotal = Math.max(...filtered.map((t) => t.testTotalCostTL), 1);
  const filteredTotal = filtered.reduce((s, t) => s + t.testTotalCostTL, 0);
  const filteredVolume = filtered.reduce((s, t) => s + t.totalTestUnits, 0);
  const filteredAvgUnit = filteredVolume > 0 ? filteredTotal / filteredVolume : 0;
  const mostExpensive = filtered.reduce(
    (best, cur) => (cur.costPerTestTL > best.costPerTestTL ? cur : best),
    filtered[0] || ({ costPerTestTL: 0, sutTestAdi: '—' } as any),
  );
  const mostFrequent = filtered.reduce(
    (best, cur) => (cur.totalTestUnits > best.totalTestUnits ? cur : best),
    filtered[0] || ({ totalTestUnits: 0, sutTestAdi: '—' } as any),
  );

  const assistantContext = useMemo(() => ({
    panel: 'test' as const,
    currency: 'TRY',
    generatedAt: new Date().toISOString(),
    filters: {
      periot,
      search,
      sortBy,
      selectedLabIds,
      selectedTestIds,
      selectedLabNames: selectedLabIds.length > 0 ? labs.filter((l) => selectedLabIds.includes(l.id)).map((l) => l.name) : ['Tüm laboratuvarlar'],
      selectedTestNames: selectedTestIds.length > 0 ? testDefs.filter((t) => selectedTestIds.includes(t.id)).map((t) => t.sutTestAdi) : ['Tüm testler'],
    },
    totals: {
      filteredTestCount: filtered.length,
      filteredTotalCostTL: Math.round(filteredTotal),
      filteredTotalUnits: filteredVolume,
      filteredAvgUnitCostTL: Number(filteredAvgUnit.toFixed(2)),
      systemTotal,
      totalHakEdisTL: Math.round(filtered.reduce((sum, t) => sum + t.hakEdisTL * t.totalTestUnits, 0)),
      totalMarginTL: Math.round(filtered.reduce((sum, t) => sum + t.marjTL * t.totalTestUnits, 0)),
    },
    rankings: {
      mostExpensiveUnit: mostExpensive,
      mostFrequent,
      topByUnitCost: filtered.slice(0, 10).map((t) => ({
        testId: t.testId,
        sutKodu: t.sutKodu,
        sutTestAdi: t.sutTestAdi,
        costPerTestTL: Number(t.costPerTestTL.toFixed(2)),
        totalTestUnits: t.totalTestUnits,
        testTotalCostTL: Math.round(t.testTotalCostTL),
        stockCostTL: Math.round(t.stockCostTL),
        deviceCostMonthlyTL: Math.round(t.deviceCostMonthlyTL),
        personnelCostMonthlyTL: Math.round(t.personnelCostMonthlyTL),
        inventoryCostTL: Math.round(t.inventoryCostTL),
        hakEdisTL: Number(t.hakEdisTL.toFixed(2)),
        marjTL: Number(t.marjTL.toFixed(2)),
        warnings: t.warnings,
        topLabs: t.perLab
          .slice()
          .sort((a, b) => b.stockCostTL - a.stockCostTL)
          .slice(0, 5),
      })),
      negativeMarginTests: filtered
        .filter((t) => t.marjTL < 0)
        .slice(0, 10)
        .map((t) => ({ sutKodu: t.sutKodu, sutTestAdi: t.sutTestAdi, marjTL: Number(t.marjTL.toFixed(2)), costPerTestTL: Number(t.costPerTestTL.toFixed(2)), hakEdisTL: Number(t.hakEdisTL.toFixed(2)) })),
    },
    rawSamples: {
      labsCount: labs.length,
      productCount: productMap.size,
      deviceAssignmentCount: assignedDevices.length,
      assetCount: assets.length,
      personnelCount: personnel.length,
      shippedStockRows: depoStok.length,
      rates,
      allFilteredTests: filtered.map((t) => ({
        testId: t.testId,
        sutKodu: t.sutKodu,
        sutTestAdi: t.sutTestAdi,
        costPerTestTL: Number(t.costPerTestTL.toFixed(2)),
        totalTestUnits: t.totalTestUnits,
        testTotalCostTL: Math.round(t.testTotalCostTL),
        stockCostTL: Math.round(t.stockCostTL),
        ortakGiderlerTL: Math.round(t.ortakGiderlerTL),
        hakEdisTL: Number(t.hakEdisTL.toFixed(2)),
        marjTL: Number(t.marjTL.toFixed(2)),
        warnings: t.warnings,
      })),
    },
  }), [
    periot,
    search,
    sortBy,
    selectedLabIds,
    selectedTestIds,
    labs,
    testDefs,
    filtered,
    filteredTotal,
    filteredVolume,
    filteredAvgUnit,
    systemTotal,
    mostExpensive,
    mostFrequent,
    productMap.size,
    assignedDevices.length,
    assets.length,
    personnel.length,
    depoStok.length,
    rates,
  ]);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--mg-muted)' }}>
        <Loader2 size={32} className="animate-spin" style={{ display: 'inline-block', marginBottom: 12 }} />
        <div style={{ fontSize: 14 }}>Maliyet verileri yükleniyor...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--mg-muted)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--mg-text)', marginBottom: 8 }}>
            Maliyet verileri yüklenemedi
          </div>
          <div style={{ fontSize: 12, marginBottom: 16, wordBreak: 'break-word' }}>{loadError}</div>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            style={{
              padding: '8px 20px',
              borderRadius: 10,
              background: 'var(--mg-accent)',
              color: '#0a0a0c',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Tekrar dene
          </button>
        </div>
      </Card>
    );
  }

  if (testDefs.length === 0) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--mg-muted)' }}>
          Henüz test tanımı yok. Hak Ediş panelinden ekleyebilirsiniz.
        </div>
      </Card>
    );
  }

  // Mobil: mock-uyumlu hero kartlar (yatay scroll carousel)
  const heroKpis = [
    {
      key: 'total',
      label: 'Toplam Test Maliyeti',
      value: filteredTotal,
      sub: `${filteredVolume.toLocaleString('tr-TR')} test`,
      color: '#fb923c',
      trend: '+12%',
      trendPositive: false,
    },
    {
      key: 'avg',
      label: 'Test Başına Ort.',
      value: filteredAvgUnit,
      sub: 'ağırlıklı',
      color: '#6ea8ff',
      trend: '+6%',
      trendPositive: false,
      decimals: 2,
    },
    {
      key: 'most-expensive',
      label: 'En Pahalı Test',
      value: mostExpensive?.costPerTestTL || 0,
      sub: mostExpensive?.sutTestAdi || '—',
      color: '#a78bfa',
      trend: '+18%',
      trendPositive: false,
      decimals: 2,
    },
    {
      key: 'most-frequent',
      label: 'En Çok Test',
      value: mostFrequent?.totalTestUnits || 0,
      sub: mostFrequent?.sutTestAdi || '—',
      color: '#42e46d',
      trend: '+4%',
      trendPositive: true,
      isCount: true,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 20 }}>
      {/* Filtre bar */}
      <FilterBar
        labs={labs}
        selectedLabIds={selectedLabIds}
        setSelectedLabIds={setSelectedLabIds}
        testDefs={testDefs}
        selectedTestIds={selectedTestIds}
        setSelectedTestIds={setSelectedTestIds}
        periot={periot}
        setPeriot={setPeriot}
      />

      {/* KPI Row */}
      {isMobile ? (
        <div
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollSnapType: 'x mandatory',
            margin: '0 -16px',
            padding: '0 16px',
          }}
        >
          {heroKpis.map((k) => (
            <HeroKpiCard key={k.key} {...k} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <MiniStat label={`Toplam Test Maliyeti (${periot.type})`} value={filteredTotal} sub={`${filteredVolume.toLocaleString('tr-TR')} test`} color="#fb923c" />
          <MiniStat label="Test Başına Ort." value={filteredAvgUnit} sub="Ağırlıklı" color="#6ea8ff" decimals={2} />
          <MiniStat
            label="En Pahalı Test"
            value={mostExpensive?.costPerTestTL || 0}
            sub={mostExpensive?.sutTestAdi || ''}
            color="#a78bfa"
            decimals={2}
          />
          <MiniStat
            label="En Çok Test"
            value={mostFrequent?.totalTestUnits || 0}
            sub={mostFrequent?.sutTestAdi || ''}
            color="#42e46d"
            isCount
            unit="adet"
          />
        </div>
      )}

      {/* Activities + Insights */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 3fr) minmax(0, 1fr)', gap: isMobile ? 12 : 16 }}>
        <ActivitiesPanel
          count={filtered.length}
          title="Test Maliyetleri"
          sections={[
            {
              title: 'En Pahalı 6 Test',
              cards: filtered.slice(0, 6).map((b) => ({
                value: b.costPerTestTL,
                label: b.sutTestAdi,
                sublabel: `${b.totalTestUnits.toLocaleString('tr-TR')} test`,
                color: '#fb923c',
                delta: b.marjTL >= 0 ? `+${Math.round(b.marjTL)}` : `${Math.round(b.marjTL)}`,
                format: (v) => (
                  <>
                    <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>₺</span>
                    {Math.round(v).toLocaleString('tr-TR')}
                  </>
                ),
                sparkData: b.perLab.map((l) => l.stockCostTL),
                active: expandedTestId === b.testId,
                onClick: () => setExpandedTestId(expandedTestId === b.testId ? null : b.testId),
              })),
            },
            {
              title: 'Bileşen Dağılımı',
              cards: systemTotal
                ? [
                    {
                      value: systemTotal.deviceCostMonthlyTL,
                      label: 'Cihaz',
                      sublabel: `${systemTotal.counts.devices} cihaz`,
                      color: '#a78bfa',
                      format: (v: number) => (
                        <>
                          <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>₺</span>
                          {Math.round(v / 1000).toLocaleString('tr-TR')}
                          <span style={{ fontSize: 20, color: 'var(--mg-muted)', marginLeft: 1, fontWeight: 300 }}>k</span>
                        </>
                      ),
                    },
                    {
                      value: systemTotal.personnelCostMonthlyTL,
                      label: 'Personel',
                      sublabel: `${systemTotal.counts.personnel} kişi`,
                      color: '#10b981',
                      format: (v: number) => (
                        <>
                          <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>₺</span>
                          {Math.round(v / 1000).toLocaleString('tr-TR')}
                          <span style={{ fontSize: 20, color: 'var(--mg-muted)', marginLeft: 1, fontWeight: 300 }}>k</span>
                        </>
                      ),
                    },
                    {
                      value: systemTotal.inventoryCostTL,
                      label: 'Envanter',
                      sublabel: `${systemTotal.counts.assets} adet`,
                      color: '#3b82f6',
                      format: (v: number) => (
                        <>
                          <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>₺</span>
                          {Math.round(v).toLocaleString('tr-TR')}
                        </>
                      ),
                    },
                    {
                      value: systemTotal.allStockCostTL,
                      label: 'Stok',
                      sublabel: 'Anlık değer',
                      color: '#fb923c',
                      format: (v: number) => (
                        <>
                          <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>₺</span>
                          {Math.round(v).toLocaleString('tr-TR')}
                        </>
                      ),
                    },
                  ]
                : [],
            },
          ]}
        />

        <InsightsCard
          assistantContext={assistantContext}
          insights={[
            {
              palette: ['#a3e8c1', '#7bd5f2', '#9ab6ff', '#7a8af0', '#0a1422'],
              title: 'Bu periyodun özeti',
              headline: filtered.length > 0 ? 'En pahalı test' : 'Veri yok',
              subhead: mostExpensive?.sutTestAdi || '—',
              delta: Math.round(mostExpensive?.costPerTestTL || 0),
              deltaPositive: false,
            },
            {
              palette: ['#ffb088', '#b8c6ff', '#d8a8ff', '#88b3ff', '#1a0c1e'],
              title: 'Sistem geneli',
              headline: 'Gerçek harcama (tek sefer)',
              subhead: `${systemTotal?.counts.labs || 0} lab · ${periot.type}`,
              delta: Math.round(systemTotal?.realTotalSpendTL || 0),
              deltaPositive: true,
            },
            {
              palette: ['#ffd28a', '#ff9b76', '#ff7a8a', '#c25a8e', '#1a0a18'],
              title: 'Marj',
              headline: 'Toplam hak ediş',
              subhead: `${filtered.length} test`,
              delta: Math.round(filtered.reduce((s, t) => s + t.hakEdisTL * t.totalTestUnits, 0)),
              deltaPositive: true,
            },
          ]}
        />
      </div>

      {/* Detaylı tablo */}
      <Card padding={0}>
        <div style={{ padding: '22px 24px 14px' }}>
          <SectionHeader
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z" />
              </svg>
            }
            title="Detaylı Test Maliyetleri"
            count={filtered.length}
            action={
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                style={{
                  background: 'var(--mg-surface-2)',
                  border: '1px solid var(--mg-border)',
                  borderRadius: 8,
                  padding: '7px 12px',
                  color: 'var(--mg-text-2)',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  letterSpacing: '0.02em',
                }}
              >
                <option value="total">Toplam ↓</option>
                <option value="unit">Birim ↓</option>
                <option value="volume">Adet ↓</option>
              </select>
            }
          />
        </div>

        {(selectedTestIds.length > 0 || search) && (
          <div
            style={{
              padding: '10px 24px',
              background: 'var(--mg-surface-2)',
              borderTop: '1px solid var(--mg-border)',
              borderBottom: '1px solid var(--mg-border)',
              display: 'flex',
              gap: 24,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--mg-text-2)',
              flexWrap: 'wrap',
            }}
          >
            <span>{filtered.length} sonuç</span>
            <span>·</span>
            <span>
              Toplam: <b style={{ color: 'var(--mg-accent)' }}>{fmtTL(filteredTotal, 0)}</b>
            </span>
            <span>·</span>
            <span>
              Hacim: <b style={{ color: 'var(--mg-text)' }}>{filteredVolume.toLocaleString('tr-TR')} test</b>
            </span>
            <span>·</span>
            <span>
              Ort. birim: <b style={{ color: 'var(--mg-text)' }}>{fmtTL(filteredAvgUnit)}</b>
            </span>
          </div>
        )}

        {!isMobile && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1.8fr) minmax(0,1fr) 100px 110px 140px 90px 24px',
              gap: 16,
              padding: '12px 18px',
              fontSize: 10,
              fontWeight: 800,
              color: 'var(--mg-muted)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              borderBottom: '1px solid var(--mg-border)',
            }}
          >
            <div>Test</div>
            <div>Ürünler</div>
            <div style={{ textAlign: 'right' }}>Birim ₺</div>
            <div style={{ textAlign: 'right' }}>Adet</div>
            <div style={{ textAlign: 'right' }}>Toplam</div>
            <div style={{ textAlign: 'right' }}>Marj</div>
            <div></div>
          </div>
        )}

        <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--mg-muted)', fontSize: 13 }}>
              Sonuç bulunamadı
            </div>
          ) : (
            filtered.map((b) => (
              <TestRow
                key={b.testId}
                result={b}
                expanded={expandedTestId === b.testId}
                onToggle={() => setExpandedTestId(expandedTestId === b.testId ? null : b.testId)}
                maxTotal={maxTotal}
              />
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
