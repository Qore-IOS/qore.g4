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
  type DepoStokCount,
  type PersonnelCostConfigInput,
  type LabPoolLite,
  type LabBreakdown,
  toTRY,
} from '../../lib/test-cost-calculator';
import { fetchDepoStokCounts, aggregateDepoStokRows } from '@/lib/depo-stok-ozet';
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
import { ActivitiesPanel, InsightsCard, MiniStat, SectionHeader, Card, KpiBreakdownModal, type KpiBreakdownRow } from './primitives';
import { formatCompactTL } from './charts';
import { useIsMobile } from './useIsMobile';
import { collection, getDocs, query, orderBy, where, Timestamp } from '../../lib/data/client';
import { db } from '../../lib/data/client';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery, getScopedDocs } from '@/lib/document-helpers';
import { useAuth } from '@/contexts/auth-context';
import { getExchangeRates } from '@/lib/exchange-rates';
import { getLatestByLocation, getSessionDate, type SayimSession } from '@/lib/cost-analytics';
import { exportDataToExcel, exportDataToPdf } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { TabExportHandlers } from './MaliyetGozlemMerkezi';
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
  countPeriod,
  setCountPeriod,
  countPeriodOptions,
}: Omit<FilterBarProps, 'search' | 'setSearch'> & {
  countPeriod: string;
  setCountPeriod: (p: string) => void;
  countPeriodOptions: { key: string; label: string }[];
}) {
  const isMobile = useIsMobile();
  const periodOpts: { k: PeriotConfig['type']; label: string }[] = [
    { k: 'gunluk', label: 'Günlük' },
    { k: 'aylik', label: 'Aylık' },
    { k: 'yillik', label: 'Yıllık' },
  ];

  return (
    <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: isMobile ? 'stretch' : 'center', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Veri kaynağı: anlık stok veya sayım dönemi */}
      <select
        value={countPeriod}
        onChange={(e) => setCountPeriod(e.target.value)}
        title="Test hacmi kaynağı: anlık sevk edilmiş stok veya seçili dönemin maliyet sayımı"
        style={{
          padding: isMobile ? '9px 12px' : '8px 12px',
          borderRadius: 10,
          background: countPeriod === 'live' ? 'var(--mg-surface-2)' : 'var(--mg-accent)',
          color: countPeriod === 'live' ? 'var(--mg-text)' : '#0a0a0c',
          border: '1px solid var(--mg-border)',
          fontFamily: 'inherit',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          outline: 'none',
          width: isMobile ? '100%' : undefined,
        }}
      >
        <option value="live">Anlık Stok</option>
        {countPeriodOptions.map((p) => (
          <option key={p.key} value={p.key}>Sayım: {p.label}</option>
        ))}
      </select>

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

      {/* Lokasyon seçici (lab + depo, aramalı multiselect) */}
      <div style={{ width: isMobile ? '100%' : 280 }}>
        <LabSelector
          mode="multi"
          label="Lokasyon"
          labs={labs.map((l) => ({ id: l.id, name: l.name, kod: l.kod }))}
          values={selectedLabIds}
          onValuesChange={setSelectedLabIds}
          placeholder="Lab / depo seç..."
          searchPlaceholder="Lab veya depo ara..."
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

/** Dönem içi tek bir yedek parça değişim kaydı (ekstre satırı). */
interface SparePartEntry {
  date: Date | null;
  labId: string;
  labName: string;
  stokKodu: string;
  stokAdi: string;
  deviceInfo?: string;
  costTL: number;
}

/**
 * Gerçek birim fiyat satırı — test maliyeti YALNIZCA ürün stoğundan hesaplanır.
 * Personel (devlet geri ödemeli) bilgi amaçlı ayrıca gösterilir, maliyete dahil edilmez.
 */
function UnitPriceSplit({ result }: { result: TestCostBreakdown }) {
  if (!(result.costPerTestTL > 0)) return null;
  const personnelUnit = result.personnelUnitCostTL || 0;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', padding: '8px 10px', background: 'var(--mg-surface)', borderRadius: 8, border: '1px solid var(--mg-border)', marginTop: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Gerçek Birim Fiyat (Yalnız Stok)
      </span>
      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--mg-accent)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtTL(result.costPerTestTL)}
      </span>
      {personnelUnit > 0 && (
        <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981', fontVariantNumeric: 'tabular-nums' }}>
          + personel {fmtTL(personnelUnit)}/test · maliyete dahil değil
        </span>
      )}
    </div>
  );
}

/**
 * Lab lab kırılım — her labda testin adedi, stok maliyeti, o labdan bu teste
 * düşen personel payı ve lab başına birim maliyet. Birimlerin hacim ağırlıklı
 * ortalaması testin gerçek birim fiyatına eşittir.
 */
function LabKirilimList({ perLab }: { perLab: LabBreakdown[] }) {
  const rows = [...perLab].filter((l) => l.testUnits > 0).sort((a, b) => b.testUnits - a.testUnits);
  if (rows.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {rows.map((l) => (
        <div
          key={l.labId}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
            padding: '7px 10px',
            background: 'var(--mg-surface)',
            borderRadius: 8,
            fontSize: 11,
          }}
        >
          <span style={{ fontWeight: 700, color: 'var(--mg-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {l.labName}
          </span>
          <span style={{ display: 'flex', gap: 10, flexShrink: 0, fontVariantNumeric: 'tabular-nums', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span style={{ color: 'var(--mg-muted)' }}>{l.testUnits.toLocaleString('tr-TR')} test</span>
            <span style={{ color: '#fb923c', fontWeight: 600 }}>stok {fmtTL(l.stockCostTL, 0)}</span>
            {l.personnelCostMonthlyTL > 0 && (
              <span style={{ color: '#10b981', fontWeight: 600 }}>personel {fmtTL(l.personnelCostMonthlyTL, 0)} (ayrı)</span>
            )}
            <span style={{ color: 'var(--mg-accent)', fontWeight: 800 }}>birim {fmtTL(l.unitCostTL ?? 0)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Yedek parça modalı — dönem içi tüm parça değişimlerinin ekstresi + testin
 * lablarına ait toplamın hacim payıyla bu teste dağıtımı.
 */
function SparePartModal({
  result,
  entries,
  spareByLab,
  onClose,
}: {
  result: TestCostBreakdown;
  entries: SparePartEntry[];
  spareByLab: Map<string, number>;
  onClose: () => void;
}) {
  // Testin çalıştığı lablar ve her birinin dönem yedek parça havuzu + bu teste payı
  const testLabs = [...result.perLab].filter((l) => l.testUnits > 0);
  const testLabIdSet = new Set(testLabs.map((l) => l.labId));
  const allocTL = result.sparePartAllocTL || 0;
  const poolTL = testLabs.reduce((s, l) => s + (spareByLab.get(l.labId) || 0), 0);
  // Ekstre — bu testin lablarındaki değişimler önce, diğerleri soluk
  const relevant = entries.filter((e) => testLabIdSet.has(e.labId));
  const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

  const distTable = (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '12px 0 8px' }}>
        Lab Dağıtımı (hacim payı)
      </div>
      {testLabs.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--mg-muted)' }}>Bu testin çalıştığı lab bulunamadı.</div>
      ) : (
        [...testLabs]
          .sort((a, b) => (spareByLab.get(b.labId) || 0) - (spareByLab.get(a.labId) || 0))
          .map((l) => {
            const labPool = spareByLab.get(l.labId) || 0;
            const share = l.labVolume ? l.testUnits / l.labVolume : 0;
            return (
              <div key={l.labId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--mg-border)', fontSize: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--mg-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.labName}</div>
                  <div style={{ fontSize: 10, color: 'var(--mg-muted)' }}>
                    havuz {fmtTL(labPool, 0)} · {l.testUnits.toLocaleString('tr-TR')}/{(l.labVolume || 0).toLocaleString('tr-TR')} test · pay %{(share * 100).toFixed(1)}
                  </div>
                </div>
                <div style={{ fontWeight: 800, color: '#f472b6', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtTL(labPool * share, 0)}</div>
              </div>
            );
          })
      )}
    </div>
  );

  const ledger = (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '14px 0 8px' }}>
        Dönem Ekstresi ({relevant.length} değişim)
      </div>
      {relevant.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--mg-muted)' }}>Bu testin lablarında dönem içinde yedek parça değişimi yok.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {relevant.map((e, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: i < relevant.length - 1 ? '1px solid var(--mg-border)' : 'none', fontSize: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--mg-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.stokAdi}</div>
                <div style={{ fontSize: 10, color: 'var(--mg-muted)' }}>
                  {fmtDate(e.date)} · {e.labName}{e.deviceInfo ? ` · ${e.deviceInfo}` : ''}
                </div>
              </div>
              <div style={{ fontWeight: 700, color: 'var(--mg-text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtTL(e.costTL, 0)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <KpiBreakdownModal
      title={`${result.sutTestAdi} — Yedek Parça`}
      subtitle="Dönem içi parça değişimleri · test maliyetine dahil değil"
      width={620}
      rows={[
        { label: 'Bu teste düşen (hacim payı)', value: fmtTL(allocTL, 0), sub: `${fmtTL(result.sparePartUnitTL || 0)}/test` },
        { label: 'Testin lablarındaki havuz', value: fmtTL(poolTL, 0), sub: 'Dönem içi tüm parça değişimleri (bu labların)' },
      ]}
      content={<>{distTable}{ledger}</>}
      onClose={onClose}
    />
  );
}

interface TestRowProps {
  result: TestCostBreakdown;
  expanded: boolean;
  onToggle: () => void;
  maxTotal: number;
  /** Stok bileşeni etiketi — veri kaynağına göre "Stok (anlık)" ya da "Stok (Sayım …)". */
  stockLabel?: string;
  /** Dönem içi envanter kayıtları (satın alma): labId → TL. Havuz gösterimi için. */
  periodInventoryByLab?: Map<string, number>;
  /** Dönem içi yedek parça değişimleri (işlem formları): labId → TL. Havuz gösterimi için. */
  periodSpareByLab?: Map<string, number>;
  /** Personel dağıtım kırılımı modalını açar */
  onOpenPersonnel?: () => void;
  /** Yedek parça ekstresi + dağıtım modalını açar */
  onOpenSpareParts?: () => void;
}

function TestRow({ result, expanded, onToggle, maxTotal, stockLabel = 'Stok (anlık)', periodInventoryByLab, periodSpareByLab, onOpenPersonnel, onOpenSpareParts }: TestRowProps) {
  const isMobile = useIsMobile();
  const totalPct = (result.testTotalCostTL / Math.max(maxTotal, 1)) * 100;
  // Hak ediş tanımlı değilse marj hesaplanamaz — renk nötr kalsın.
  const hasHakEdis = !!result.hakEdisTanimli;
  const c = !hasHakEdis ? 'var(--mg-accent)' : (result.marjTL >= 0 ? 'var(--mg-success)' : 'var(--mg-danger)');

  // Ayrı kalemler — test maliyetine DAHİL EDİLMEZ, bilgi amaçlı listelenir.
  // Dönem içi envanter/yedek parça: testin lab hacim payıyla dağıtılan tutarları
  // gösterilir; havuz (testin çalıştığı labların dönem toplamı) alt not olarak.
  const testLabIds = result.perLab.filter((l) => l.testUnits > 0).map((l) => l.labId);
  const invPoolTL = testLabIds.reduce((s, id) => s + (periodInventoryByLab?.get(id) || 0), 0);
  const sparePoolTL = testLabIds.reduce((s, id) => s + (periodSpareByLab?.get(id) || 0), 0);
  const invAllocTL = result.inventoryEntryAllocTL || 0;
  const spareAllocTL = result.sparePartAllocTL || 0;
  const separateItems: {
    label: string; sub: string; v: number; color: string; onClick?: () => void;
  }[] = [
    { label: 'Personel (hacim payı)', sub: 'Devlet geri ödemeli · dağıtımı gör', v: result.personnelCostMonthlyTL, color: '#10b981', onClick: onOpenPersonnel },
    { label: 'Envanter payı (aylık)', sub: 'Demirbaş amortisman payı', v: result.inventoryCostTL, color: '#3b82f6' },
    { label: 'Cihaz payı (aylık)', sub: 'Cihaz maliyet payı', v: result.deviceCostMonthlyTL, color: '#a78bfa' },
    { label: 'Envanter kaydı (dönem)', sub: invPoolTL > 0 ? `Bu teste düşen · havuz ${fmtTL(invPoolTL, 0)}` : 'Testin lablarına dönem içi alım', v: invAllocTL, color: '#22d3ee' },
    { label: 'Yedek parça (dönem)', sub: sparePoolTL > 0 ? `Bu teste düşen · havuz ${fmtTL(sparePoolTL, 0)} · ekstre` : 'İşlem formu parça değişimleri · ekstre', v: spareAllocTL, color: '#f472b6', onClick: onOpenSpareParts },
  ];
  const maxSeparate = Math.max(...separateItems.map((s) => s.v), 1);

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
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Reaktif/Test</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mg-text)', fontVariantNumeric: 'tabular-nums' }}>{fmtTL(result.costPerTestTL)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Kapasite</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mg-text-2)', fontVariantNumeric: 'tabular-nums' }}>{result.totalTestUnits.toLocaleString('tr-TR')}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--mg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Marj</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: hasHakEdis ? c : 'var(--mg-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {hasHakEdis ? <>{result.marjTL >= 0 ? '↑' : '↓'} {fmtTL(Math.abs(result.marjTL))}</> : '—'}
              </div>
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--mg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Stok Değeri</span>
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
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Test Maliyeti (Yalnız Ürün Stoğu)
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--mg-text-2)', fontWeight: 600 }}>{stockLabel}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fb923c', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtTL(result.stockCostTL, 0)}
                </span>
              </div>
              <div style={{ height: 5, background: 'var(--mg-surface)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '100%', background: '#fb923c', borderRadius: 3 }} />
              </div>
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Ayrı Kalemler · Teste Dahil Değildir
            </div>
            {separateItems.map((comp, i) => (
              <div
                key={i}
                onClick={comp.onClick ? (e) => { e.stopPropagation(); comp.onClick!(); } : undefined}
                style={{ marginBottom: 8, cursor: comp.onClick ? 'pointer' : 'default' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11, color: 'var(--mg-text-2)', fontWeight: 600 }}>
                    {comp.label}
                    {comp.onClick && <span style={{ color: comp.color, marginLeft: 5, fontSize: 10 }}>›</span>}
                    <span style={{ display: 'block', fontSize: 9, color: 'var(--mg-muted)', fontWeight: 500 }}>{comp.sub}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: comp.color, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                    {fmtTL(comp.v, 0)}
                  </span>
                </div>
                <div style={{ height: 5, background: 'var(--mg-surface)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(comp.v / maxSeparate) * 100}%`, background: comp.color, borderRadius: 3, opacity: 0.7 }} />
                </div>
              </div>
            ))}
            <UnitPriceSplit result={result} />
            {result.perLab.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mg-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 10, marginBottom: 6 }}>
                  Lab Kırılımı
                </div>
                <LabKirilimList perLab={result.perLab} />
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
                Test Maliyeti (Yalnız Ürün Stoğu)
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--mg-text-2)', fontWeight: 600 }}>{stockLabel}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#fb923c', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTL(result.stockCostTL, 0)}
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--mg-surface)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '100%', background: '#fb923c', borderRadius: 3, boxShadow: '0 0 6px #fb923c60' }} />
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--mg-muted)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}
              >
                Ayrı Kalemler · Teste Dahil Değildir
              </div>
              {separateItems.map((comp, i) => (
                <div
                  key={i}
                  onClick={comp.onClick ? (e) => { e.stopPropagation(); comp.onClick!(); } : undefined}
                  style={{
                    marginBottom: 10,
                    cursor: comp.onClick ? 'pointer' : 'default',
                    borderRadius: 8,
                    ...(comp.onClick ? { padding: '2px 6px', margin: '-2px -6px 8px', transition: 'background 0.15s' } : {}),
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--mg-text-2)', fontWeight: 600 }}>
                      {comp.label}
                      {comp.onClick && <span style={{ color: comp.color, marginLeft: 5, fontWeight: 800 }}>›</span>}
                      <span style={{ fontSize: 10, color: 'var(--mg-muted)', fontWeight: 500, marginLeft: 6 }}>{comp.sub}</span>
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: comp.color, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {fmtTL(comp.v, 0)}
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--mg-surface)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(comp.v / maxSeparate) * 100}%`, background: comp.color, borderRadius: 3, opacity: 0.7 }} />
                  </div>
                </div>
              ))}
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
                    Reaktif Maliyet / Test
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--mg-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTL(result.costPerTestTL)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mg-muted)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                    Ağırlıklı stok / kapasite
                    {(result.personnelUnitCostTL || 0) > 0 && <> · personel {fmtTL(result.personnelUnitCostTL || 0)}/test dahil değil</>}
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
                    Stok Kapasitesi
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--mg-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {result.totalTestUnits.toLocaleString('tr-TR')}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mg-muted)', marginTop: 4 }}>test (teorik)</div>
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
                    Toplam Stok Değeri
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--mg-accent)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTL(result.testTotalCostTL, 0)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mg-muted)', marginTop: 4 }}>
                    Sayım tarihindeki stok · dönem tüketimi değildir
                  </div>
                </div>
                <div style={{ background: 'var(--mg-surface)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--mg-border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--mg-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                    Hak Ediş
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: hasHakEdis ? 'var(--mg-text)' : 'var(--mg-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {hasHakEdis ? fmtTL(result.hakEdisTL) : 'Veri yok'}
                  </div>
                </div>
                <div style={{ background: 'var(--mg-surface)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--mg-border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--mg-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                    Marj
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: hasHakEdis ? c : 'var(--mg-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {hasHakEdis ? fmtTL(result.marjTL) : 'Hesaplanamadı'}
                  </div>
                </div>
              </div>

              <UnitPriceSplit result={result} />
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
                  <LabKirilimList perLab={result.perLab} />
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
  /** Header'daki Excel/PDF butonlarının çağıracağı işleyicileri kaydeder. */
  registerExportHandlers?: (handlers: TabExportHandlers) => void;
}

export function TestTab({ currency: _currency, search, setSearch, registerExportHandlers }: TestTabProps) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [labs, setLabs] = useState<Hospital[]>([]);
  const [depots, setDepots] = useState<Hospital[]>([]);
  const [testDefs, setTestDefs] = useState<TestDefinitionGlobal[]>([]);
  const [productMap, setProductMap] = useState<Map<string, ProductCode>>(new Map());
  const [deviceDefs, setDeviceDefs] = useState<Map<string, Device>>(new Map());
  const [assignedDevices, setAssignedDevices] = useState<AssignedDevice[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [depoStokCounts, setDepoStokCounts] = useState<DepoStokCount[]>([]);
  const [countSessions, setCountSessions] = useState<SayimSession[]>([]);
  const [personnelConfig, setPersonnelConfig] = useState<PersonnelCostConfigInput | null>(null);
  const [labPools, setLabPools] = useState<LabPoolLite[]>([]);
  /** Dönem içi yedek parça değişimleri: labId → toplam TL (işlem formlarından) */
  const [sparePartByLab, setSparePartByLab] = useState<Map<string, number>>(new Map());
  /** Dönem içi yedek parça ekstresi — tek tek değişim kalemleri (modal için) */
  const [sparePartEntries, setSparePartEntries] = useState<SparePartEntry[]>([]);
  const [rates, setRates] = useState<Record<Currency, number>>({ EUR: 1, USD: 1.08, TRY: 38.5 });

  // Filtreler
  const [selectedLabIds, setSelectedLabIds] = useState<string[]>([]);
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [periot, setPeriot] = useState<PeriotConfig>({ type: 'aylik' });
  /** Test hacmi kaynağı: 'live' = anlık sevk edilmiş stok, aksi halde 'YYYY-MM' sayım dönemi */
  const [countPeriod, setCountPeriod] = useState<string>('live');
  /** Kullanıcı kaynak (anlık/dönem) seçmeden veri YÜKLENMEZ. */
  const [sourceChosen, setSourceChosen] = useState(false);
  const [pendingMonth, setPendingMonth] = useState(new Date().getMonth());
  const [pendingYear, setPendingYear] = useState(new Date().getFullYear());
  /** KPI kartına tıklanınca gösterilen alt kırılım */
  const [kpiModal, setKpiModal] = useState<{ title: string; subtitle?: string; rows: KpiBreakdownRow[] } | null>(null);
  /** Ayrı kalem (personel / yedek parça) dağıtım modalı */
  const [extraModal, setExtraModal] = useState<{ kind: 'personnel' | 'spare'; result: TestCostBreakdown } | null>(null);
  /** Tüm dönem yedek parça ekstresi (toplam kartından) */
  const [showSpareLedger, setShowSpareLedger] = useState(false);
  const [sortBy, setSortBy] = useState<'total' | 'unit' | 'volume'>('total');
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);

  // Veri yükleme — kaynak (anlık/dönem) seçilmeden hiçbir veri çekilmez
  useEffect(() => {
    if (!sourceChosen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [
          productsSnap,
          labsSnap,
          depotsSnap,
          devicesSnap,
          assignedSnap,
          assetsSnap,
          personnelSnap,
          stokCounts,
          testDefsSnap,
          ratesValue,
          sayimSessionsSnap,
          personnelCfgSnap,
          labPoolsSnap,
        ] = await Promise.all([
          // Legacy-aware: companyId'si eksik ya da __legacy__ etiketli ürün
          // kayıtları da gelsin — aksi halde maliyet hesapları 0 çıkıyor.
          getScopedDocs('productCodes', currentCompanyId, isSuperAdmin),
          getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin, orderBy('name', 'asc'))),
          // Depolar da stok hesabına dahil edilir — depo sayımlarındaki stok
          // testin toplam stoğuna girer (yalnızca lab sayımı değil).
          getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)).catch(() => null),
          getDocs(scopedQuery('devices', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('hospitalDeviceAssignments', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('assets', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('personnel', currentCompanyId, isSuperAdmin)),
          // Sevk edilmiş stok sunucuda özetlenir (lab+stok kodu başına satır
          // sayısı) — on binlerce belgeyi indirmek yerine kompakt özet gelir.
          // API erişilemezse eski belge-belge Firestore yoluna düşülür.
          fetchDepoStokCounts(currentCompanyId, isSuperAdmin).catch(async () => {
            const snap = await getDocs(
              scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('isShipped', '==', true)),
            );
            return aggregateDepoStokRows(snap.docs.map((d) => d.data() as DepoStokItem));
          }),
          getDocs(scopedQuery('testDefinitions', currentCompanyId, isSuperAdmin, orderBy('sutKodu', 'asc'))),
          getExchangeRates().catch(() => ({ EUR: 1, USD: 1.08, TRY: 38.5 })),
          getDocs(scopedQuery('maliyetSayimSessions', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc'))).catch(() => null),
          getDocs(scopedQuery('personnelCostConfig', currentCompanyId, isSuperAdmin)).catch(() => null),
          getDocs(scopedQuery('labPools', currentCompanyId, isSuperAdmin)).catch(() => null),
        ]);
        if (cancelled) return;

        const products = productsSnap.map((d) => ({ id: d.id, ...d.data() } as ProductCode));
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

        setDepots(
          depotsSnap
            ? filterByCompanyScope(
                depotsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
                currentCompanyId,
                isSuperAdmin,
              )
            : [],
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
        setDepoStokCounts(stokCounts);

        if (sayimSessionsSnap) {
          setCountSessions(
            filterByCompanyScope(
              sayimSessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SayimSession)),
              currentCompanyId,
              isSuperAdmin,
            ),
          );
        }

        // Basitleştirilmiş personel gider modeli + havuz tanımları
        if (personnelCfgSnap && !personnelCfgSnap.empty) {
          const cfg = filterByCompanyScope(
            personnelCfgSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)),
            currentCompanyId,
            isSuperAdmin,
          )[0];
          setPersonnelConfig(
            cfg && Number(cfg.costPerPersonTL) > 0
              ? { costPerPersonTL: Number(cfg.costPerPersonTL), labCounts: cfg.labCounts || {} }
              : null,
          );
        }
        if (labPoolsSnap) {
          setLabPools(
            filterByCompanyScope(
              labPoolsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)),
              currentCompanyId,
              isSuperAdmin,
            ).map((p: any) => ({ mainLabId: p.mainLabId, memberIds: p.memberIds || [], active: p.active })),
          );
        }

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
  }, [currentCompanyId, isSuperAdmin, reloadKey, sourceChosen]);

  // Sayım oturumlarında bulunan dönemler (yeniden eskiye)
  const countPeriodOptions = useMemo(() => {
    const keys = new Map<string, string>();
    countSessions.forEach((s) => {
      const d = getSessionDate(s);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!keys.has(key)) {
        keys.set(key, d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }));
      }
    });
    return Array.from(keys.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, label]) => ({ key, label }));
  }, [countSessions]);

  // Stok bileşeni etiketi — kaynak dönem sayımıysa "Stok (anlık)" yanıltıcı olur
  const stockSourceLabel = countPeriod === 'live'
    ? 'Stok (anlık)'
    : `Stok (Sayım: ${countPeriodOptions.find((p) => p.key === countPeriod)?.label || countPeriod})`;

  // Seçili dönemin [başlangıç, bitiş) tarih aralığı — 'YYYY-MM'
  const periodRange = useMemo(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(countPeriod);
    if (!m) return null;
    const start = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    const end = new Date(Number(m[1]), Number(m[2]), 1);
    return { start, end };
  }, [countPeriod]);

  // ── Dönem içi YEDEK PARÇA değişimleri (işlem formlarından) ────────────────
  // deviceActionForms + teknikServisActionForms: createdAt döneme düşen
  // formların actions[type='part_change'] satırları; maliyet stok kodunun
  // ürün fiyatından TL'ye çevrilir. Test maliyetine DAHİL EDİLMEZ — ayrı kalem.
  useEffect(() => {
    if (!sourceChosen || !periodRange) {
      setSparePartByLab(new Map());
      setSparePartEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const startTs = Timestamp.fromDate(periodRange.start);
        const endTs = Timestamp.fromDate(periodRange.end);
        const fetchForms = (coll: string) =>
          getDocs(query(
            collection(db, coll),
            where('createdAt', '>=', startTs),
            where('createdAt', '<', endTs),
          )).then((s) => s.docs.map((d) => d.data() as any)).catch(() => [] as any[]);

        const [labForms, tsForms] = await Promise.all([
          fetchForms('deviceActionForms'),
          fetchForms('teknikServisActionForms'),
        ]);
        if (cancelled) return;

        const labNameById = new Map(labs.map((l) => [l.id, l.name]));
        const map = new Map<string, number>();
        const entries: SparePartEntry[] = [];
        filterByCompanyScope([...labForms, ...tsForms], currentCompanyId, isSuperAdmin).forEach((form: any) => {
          const labId = form.hospitalId;
          if (!labId) return;
          const created: Date | null = form.createdAt?.toDate
            ? form.createdAt.toDate()
            : (form.createdAt instanceof Date ? form.createdAt : null);
          const deviceInfo = form.deviceModel || form.cihazModeli || form.deviceName || form.serialNumber || undefined;
          (form.actions || []).forEach((a: any) => {
            if (a?.type !== 'part_change' || !a.stokKodu) return;
            const product = productMap.get(a.stokKodu);
            if (!product) return;
            const costTL = toTRY(Number(product.cost) || 0, (product.currency || 'TRY') as Currency, rates);
            map.set(labId, (map.get(labId) || 0) + costTL);
            entries.push({
              date: created,
              labId,
              labName: labNameById.get(labId) || labId,
              stokKodu: a.stokKodu,
              stokAdi: a.stokAdi || product.malzemeAdi || product.stokAdi || a.stokKodu,
              deviceInfo,
              costTL,
            });
          });
        });
        entries.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
        setSparePartByLab(map);
        setSparePartEntries(entries);
      } catch (e) {
        console.error('Dönem yedek parça maliyetleri yüklenemedi', e);
        if (!cancelled) { setSparePartByLab(new Map()); setSparePartEntries([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [sourceChosen, periodRange, productMap, rates, currentCompanyId, isSuperAdmin, labs]);

  // ── Dönem içi ENVANTER kayıtları (satın alma tarihi dönemde olan assetler) ─
  // Test maliyetine DAHİL EDİLMEZ — ayrı bilgi kalemi. Kira kayıtları hariç
  // (onlar aylık gider olarak zaten ayrıca izlenir).
  const inventoryEntryByLab = useMemo(() => {
    const map = new Map<string, number>();
    if (!periodRange) return map;
    const inPeriod = (raw?: string) => {
      if (!raw) return false;
      // 'YYYY-MM-DD' veya 'dd.MM.yyyy' desteklenir
      let d: Date | null = null;
      if (/^\d{4}-\d{2}/.test(raw)) d = new Date(raw);
      else {
        const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(raw);
        if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      }
      return !!d && !Number.isNaN(d.getTime()) && d >= periodRange.start && d < periodRange.end;
    };
    for (const a of assets) {
      if (a.mulkiyet === 'kira') continue;
      if (!inPeriod(a.satinAlmaTarihi)) continue;
      const lab = labs.find((l) => l.id === a.konum || l.name === a.konum);
      if (!lab) continue;
      // alimFiyatiTl uygulama genelinde TL olarak tutulur — kur çevrimi yapılmaz
      const costTL = Number(a.alimFiyatiTl) || 0;
      map.set(lab.id, (map.get(lab.id) || 0) + costTL);
    }
    return map;
  }, [periodRange, assets, labs]);

  const periodExtrasTotals = useMemo(() => {
    let inventory = 0;
    inventoryEntryByLab.forEach((v) => { inventory += v; });
    let spare = 0;
    sparePartByLab.forEach((v) => { spare += v; });
    return { inventory, spare };
  }, [inventoryEntryByLab, sparePartByLab]);

  // Test hacmi kaynağı: anlık stok özeti veya seçili dönemin sayım oturumları.
  // Dönem seçildiğinde her lab için o ayın en güncel oturumu esas alınır;
  // stokAdedi kutu sayısı, cihazUstuAdedi test adedi olarak hesaba girer.
  // Hesaba dahil edilen lokasyonlar = laboratuvarlar + depolar. Depo sayımındaki
  // stok da testin toplam stoğuna girsin diye hesaplayıcıya birlikte verilir.
  const calcLocations = useMemo<Hospital[]>(() => [...labs, ...depots], [labs, depots]);

  const effectiveStokCounts = useMemo<DepoStokCount[]>(() => {
    if (countPeriod === 'live') return depoStokCounts;
    const monthSessions = countSessions.filter((s) => {
      // Lab VE depo sayımları dahil — yalnız lab değil.
      if (s.locationType !== 'lab' && s.locationType !== 'depot') return false;
      const d = getSessionDate(s);
      if (!d) return false;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === countPeriod;
    });
    const latestByLab = getLatestByLocation(monthSessions);
    const rows: DepoStokCount[] = [];
    Array.from(latestByLab.values()).forEach((session) => {
      session.items.forEach((item) => {
        rows.push({
          hedefKurumId: session.locationId,
          stokKodu: item.stokKodu,
          count: Number(item.stokAdedi) || 0,
          cihazUstuAdedi: Number(item.cihazUstuAdedi) || 0,
        });
      });
    });
    return rows;
  }, [countPeriod, depoStokCounts, countSessions]);

  // Hesap motoru — tüm testler tek paylaşılan bağlamla hesaplanır
  // (test başına ayrı ayrı hesaplamak veri büyüdüğünde ana thread'i kilitliyordu)
  const breakdowns = useMemo<TestCostBreakdown[]>(() => {
    if (testDefs.length === 0) return [];
    return calculateAllTestCosts({
      allTestDefs: testDefs,
      productMap,
      labs: calcLocations,
      assignedDevices,
      deviceDefs,
      assets,
      personnel,
      depoStokCounts: effectiveStokCounts,
      rates,
      periot,
      // Ortak giderler test hacmine göre dağıtılır — full_burden her testte
      // aynı toplamı (grandTotal) gösterip tabloyu anlamsızlaştırıyordu.
      mode: 'volume_weighted',
      personnelConfig: personnelConfig ?? undefined,
      labPools,
      sparePartByLab: Object.fromEntries(sparePartByLab),
      inventoryEntryByLab: Object.fromEntries(inventoryEntryByLab),
      filterLabIds: selectedLabIds.length > 0 ? selectedLabIds : undefined,
    });
  }, [testDefs, productMap, calcLocations, assignedDevices, deviceDefs, assets, personnel, effectiveStokCounts, rates, periot, selectedLabIds, personnelConfig, labPools, sparePartByLab, inventoryEntryByLab]);

  const systemTotal = useMemo(() => {
    if (testDefs.length === 0) return null;
    return calculateSystemTotal({
      allTestDefs: testDefs,
      productMap,
      labs: calcLocations,
      assignedDevices,
      deviceDefs,
      assets,
      personnel,
      depoStokCounts: effectiveStokCounts,
      rates,
      periot,
      personnelConfig: personnelConfig ?? undefined,
      labPools,
      filterLabIds: selectedLabIds.length > 0 ? selectedLabIds : undefined,
    });
  }, [testDefs, productMap, calcLocations, assignedDevices, deviceDefs, assets, personnel, effectiveStokCounts, rates, periot, selectedLabIds, personnelConfig, labPools]);

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

  // Header'daki Excel/PDF butonları için dışa aktarma işleyicilerini kaydet
  useEffect(() => {
    if (!registerExportHandlers) return;
    const sourceName = countPeriod === 'live'
      ? 'Anlık Stok'
      : `Sayım ${countPeriodOptions.find((p) => p.key === countPeriod)?.label || countPeriod}`;
    const periotName = periot.type === 'gunluk' ? 'Günlük' : periot.type === 'yillik' ? 'Yıllık' : 'Aylık';

    const rows = filtered.map((b) => ({
      'SUT Kodu': b.sutKodu,
      'Test Adı': b.sutTestAdi,
      'Test Adedi': Math.round(b.totalTestUnits),
      'Stok Maliyeti (TL)': Math.round(b.stockCostTL),
      'Ortak Giderler (TL)': Math.round(b.ortakGiderlerTL),
      'Toplam Maliyet (TL)': Math.round(b.testTotalCostTL),
      'Birim Maliyet (TL)': Number(b.costPerTestTL.toFixed(2)),
      'Hak Ediş (TL)': Number(b.hakEdisTL.toFixed(2)),
      'Marj (TL)': Number(b.marjTL.toFixed(2)),
    }));

    registerExportHandlers({
      excel: () => {
        exportDataToExcel(
          {
            'Test Maliyetleri': rows,
            'Özet': [
              { Alan: 'Veri Kaynağı', Değer: sourceName },
              { Alan: 'Periyot', Değer: periotName },
              { Alan: 'Test Sayısı', Değer: filtered.length },
              { Alan: 'Toplam Harcama (TL)', Değer: Math.round(systemTotal?.realTotalSpendTL ?? 0) },
              { Alan: 'Envanter Maliyeti (TL)', Değer: Math.round(systemTotal?.inventoryCostTL ?? 0) },
              { Alan: 'Cihaz Maliyeti (TL/ay)', Değer: Math.round(systemTotal?.deviceCostMonthlyTL ?? 0) },
              { Alan: 'Personel Gideri (TL/ay)', Değer: Math.round(systemTotal?.personnelCostMonthlyTL ?? 0) },
              { Alan: 'Tüm Stok Maliyeti (TL)', Değer: Math.round(systemTotal?.allStockCostTL ?? 0) },
            ],
          },
          `Maliyet_Gozlem_Test_${sourceName}`,
          toast,
        );
      },
      pdf: () => {
        exportDataToPdf(
          rows.map((r) => ({
            ...r,
            'Stok Maliyeti (TL)': r['Stok Maliyeti (TL)'].toLocaleString('tr-TR'),
            'Ortak Giderler (TL)': r['Ortak Giderler (TL)'].toLocaleString('tr-TR'),
            'Toplam Maliyet (TL)': r['Toplam Maliyet (TL)'].toLocaleString('tr-TR'),
            'Birim Maliyet (TL)': r['Birim Maliyet (TL)'].toLocaleString('tr-TR'),
            'Hak Ediş (TL)': r['Hak Ediş (TL)'].toLocaleString('tr-TR'),
            'Marj (TL)': r['Marj (TL)'].toLocaleString('tr-TR'),
          })),
          `Maliyet_Gozlem_Test_${sourceName}`,
          `Maliyet Gözlem — Test Bazlı Maliyet (${sourceName} · ${periotName})`,
          toast,
        );
      },
    });
  }, [registerExportHandlers, filtered, systemTotal, countPeriod, countPeriodOptions, periot.type, toast]);

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
      shippedStockRows: depoStokCounts.reduce((sum, r) => sum + r.count, 0),
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
    depoStokCounts,
    rates,
  ]);

  // ---- Kaynak (anlık/dönem) seçilmeden veri yüklenmez ----
  if (!sourceChosen) {
    const btnBase: React.CSSProperties = {
      padding: '10px 18px',
      borderRadius: 12,
      border: '1px solid var(--mg-border)',
      fontFamily: 'inherit',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer',
    };
    const selBase: React.CSSProperties = {
      padding: '9px 12px',
      borderRadius: 10,
      background: 'var(--mg-surface-2)',
      color: 'var(--mg-text)',
      border: '1px solid var(--mg-border)',
      fontFamily: 'inherit',
      fontSize: 13,
      fontWeight: 600,
      outline: 'none',
      cursor: 'pointer',
    };
    return (
      <Card>
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--mg-text)', marginBottom: 6 }}>
            Veri Kaynağı Seçin
          </div>
          <div style={{ fontSize: 13, color: 'var(--mg-muted)', marginBottom: 24 }}>
            Veriler seçim yapılana kadar yüklenmez. Test maliyetleri seçili sayım döneminin verisiyle ya da anlık stokla hesaplanır.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
            <select value={pendingMonth} onChange={(e) => setPendingMonth(Number(e.target.value))} style={selBase}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i}>{new Date(0, i, 1).toLocaleString('tr-TR', { month: 'long' })}</option>
              ))}
            </select>
            <select value={pendingYear} onChange={(e) => setPendingYear(Number(e.target.value))} style={selBase}>
              {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              onClick={() => {
                setCountPeriod(`${pendingYear}-${String(pendingMonth + 1).padStart(2, '0')}`);
                setSourceChosen(true);
              }}
              style={{ ...btnBase, background: 'var(--mg-accent)', color: '#0a0a0c', boxShadow: '0 2px 12px rgba(251,146,60,0.35)' }}
            >
              Sayım Dönemini Yükle
            </button>
            <span style={{ fontSize: 12, color: 'var(--mg-muted)' }}>veya</span>
            <button
              onClick={() => {
                setCountPeriod('live');
                setSourceChosen(true);
              }}
              style={{ ...btnBase, background: 'var(--mg-surface-2)', color: 'var(--mg-text-2)' }}
            >
              Anlık Stok
            </button>
          </div>
        </div>
      </Card>
    );
  }

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
        labs={calcLocations}
        selectedLabIds={selectedLabIds}
        setSelectedLabIds={setSelectedLabIds}
        testDefs={testDefs}
        selectedTestIds={selectedTestIds}
        setSelectedTestIds={setSelectedTestIds}
        periot={periot}
        setPeriot={setPeriot}
        countPeriod={countPeriod}
        setCountPeriod={setCountPeriod}
        countPeriodOptions={countPeriodOptions}
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
          <MiniStat
            label={`Toplam Test Maliyeti (${periot.type})`}
            value={filteredTotal}
            sub={`${filteredVolume.toLocaleString('tr-TR')} test`}
            color="#fb923c"
            onClick={() => setKpiModal({
              title: 'Toplam Test Maliyeti — Test Kırılımı',
              subtitle: `₺${Math.round(filteredTotal).toLocaleString('tr-TR')} · ${filtered.length} test`,
              rows: [...filtered]
                .sort((a, b) => b.testTotalCostTL - a.testTotalCostTL)
                .map((b) => ({
                  label: b.sutTestAdi,
                  sub: `SUT ${b.sutKodu} · ${b.totalTestUnits.toLocaleString('tr-TR')} test · Stok ₺${Math.round(b.stockCostTL).toLocaleString('tr-TR')} + Ortak ₺${Math.round(b.ortakGiderlerTL).toLocaleString('tr-TR')}`,
                  value: `₺${Math.round(b.testTotalCostTL).toLocaleString('tr-TR')}`,
                })),
            })}
          />
          <MiniStat
            label="Test Başına Ort."
            value={filteredAvgUnit}
            sub="Ağırlıklı"
            color="#6ea8ff"
            decimals={2}
            onClick={() => setKpiModal({
              title: 'Birim Maliyet Kırılımı',
              subtitle: 'Test başına maliyet (yüksekten düşüğe)',
              rows: [...filtered]
                .sort((a, b) => b.costPerTestTL - a.costPerTestTL)
                .map((b) => ({
                  label: b.sutTestAdi,
                  sub: `SUT ${b.sutKodu} · ${b.totalTestUnits.toLocaleString('tr-TR')} test`,
                  value: `₺${b.costPerTestTL.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`,
                })),
            })}
          />
          <MiniStat
            label="En Pahalı Test"
            value={mostExpensive?.costPerTestTL || 0}
            sub={mostExpensive?.sutTestAdi || ''}
            color="#a78bfa"
            decimals={2}
            onClick={() => mostExpensive && setKpiModal({
              title: `${mostExpensive.sutTestAdi} — Maliyet Bileşenleri`,
              subtitle: `SUT ${mostExpensive.sutKodu}`,
              rows: [
                { label: 'Test Adedi', value: (mostExpensive.totalTestUnits || 0).toLocaleString('tr-TR') },
                { label: 'Stok Maliyeti', value: `₺${Math.round(mostExpensive.stockCostTL || 0).toLocaleString('tr-TR')}` },
                { label: 'Ayrı Kalemler', sub: 'Envanter + cihaz + personel — teste dahil değil', value: `₺${Math.round(mostExpensive.ortakGiderlerTL || 0).toLocaleString('tr-TR')}` },
                { label: 'Toplam Maliyet (Yalnız Stok)', value: `₺${Math.round(mostExpensive.testTotalCostTL || 0).toLocaleString('tr-TR')}` },
                { label: 'Birim Maliyet', value: `₺${(mostExpensive.costPerTestTL || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}` },
                { label: 'Hak Ediş', value: `₺${(mostExpensive.hakEdisTL || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}` },
                { label: 'Marj', value: `₺${(mostExpensive.marjTL || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}` },
              ],
            })}
          />
          <MiniStat
            label="En Çok Test"
            value={mostFrequent?.totalTestUnits || 0}
            sub={mostFrequent?.sutTestAdi || ''}
            color="#42e46d"
            isCount
            unit="adet"
            onClick={() => setKpiModal({
              title: 'Test Hacmi Kırılımı',
              subtitle: 'Test adedi (çoktan aza)',
              rows: [...filtered]
                .sort((a, b) => b.totalTestUnits - a.totalTestUnits)
                .map((b) => ({
                  label: b.sutTestAdi,
                  sub: `SUT ${b.sutKodu}`,
                  value: `${b.totalTestUnits.toLocaleString('tr-TR')} test`,
                })),
            })}
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
                          {formatCompactTL(v)}
                        </>
                      ),
                    },
                    {
                      value: systemTotal.personnelCostMonthlyTL,
                      label: 'Personel (ayrı)',
                      sublabel: 'Teste dahil değil · devlet geri ödemeli',
                      color: '#10b981',
                      format: (v: number) => (
                        <>
                          <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>₺</span>
                          {formatCompactTL(v)}
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
                      sublabel: countPeriod === 'live' ? 'Anlık değer' : 'Sayım dönemi',
                      color: '#fb923c',
                      format: (v: number) => (
                        <>
                          <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>₺</span>
                          {Math.round(v).toLocaleString('tr-TR')}
                        </>
                      ),
                    },
                    {
                      value: periodExtrasTotals.inventory,
                      label: 'Envanter Kaydı (Dönem)',
                      sublabel: 'Dönem içi alımlar · teste dahil değil',
                      color: '#22d3ee',
                      format: (v: number) => (
                        <>
                          <span style={{ fontSize: 20, color: 'var(--mg-muted)', fontWeight: 300, marginRight: 2 }}>₺</span>
                          {Math.round(v).toLocaleString('tr-TR')}
                        </>
                      ),
                    },
                    {
                      value: periodExtrasTotals.spare,
                      label: 'Yedek Parça (Dönem)',
                      sublabel: 'İşlem formu değişimleri · ekstre için tıkla',
                      color: '#f472b6',
                      onClick: () => setShowSpareLedger(true),
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
            <div style={{ textAlign: 'right' }}>Reaktif ₺</div>
            <div style={{ textAlign: 'right' }}>Kapasite</div>
            <div style={{ textAlign: 'right' }}>Stok Değeri</div>
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
                stockLabel={stockSourceLabel}
                periodInventoryByLab={inventoryEntryByLab}
                periodSpareByLab={sparePartByLab}
                onOpenPersonnel={() => setExtraModal({ kind: 'personnel', result: b })}
                onOpenSpareParts={() => setExtraModal({ kind: 'spare', result: b })}
              />
            ))
          )}
        </div>
      </Card>

      {kpiModal && (
        <KpiBreakdownModal
          title={kpiModal.title}
          subtitle={kpiModal.subtitle}
          rows={kpiModal.rows}
          onClose={() => setKpiModal(null)}
        />
      )}

      {extraModal?.kind === 'personnel' && (
        <KpiBreakdownModal
          title={`${extraModal.result.sutTestAdi} — Personel Dağıtımı`}
          subtitle="Devlet geri ödemeli · test maliyetine dahil değil · lab hacim payıyla"
          rows={[
            { label: 'Bu teste düşen toplam', value: fmtTL(extraModal.result.personnelCostMonthlyTL, 0), sub: `${fmtTL(extraModal.result.personnelUnitCostTL || 0)}/test` },
            ...[...extraModal.result.perLab]
              .filter((l) => (l.personnelCostMonthlyTL || 0) > 0)
              .sort((a, b) => (b.personnelCostMonthlyTL || 0) - (a.personnelCostMonthlyTL || 0))
              .map((l) => ({
                label: l.labName,
                sub: `${l.testUnits.toLocaleString('tr-TR')} test · lab hacmi ${(l.labVolume || 0).toLocaleString('tr-TR')} · pay %${l.labVolume ? ((l.testUnits / l.labVolume) * 100).toFixed(1) : '0'}`,
                value: fmtTL(l.personnelCostMonthlyTL || 0, 0),
              })),
          ]}
          onClose={() => setExtraModal(null)}
        />
      )}

      {extraModal?.kind === 'spare' && (
        <SparePartModal
          result={extraModal.result}
          entries={sparePartEntries}
          spareByLab={sparePartByLab}
          onClose={() => setExtraModal(null)}
        />
      )}

      {showSpareLedger && (
        <KpiBreakdownModal
          title="Yedek Parça Ekstresi — Dönem"
          subtitle={`${sparePartEntries.length} değişim · toplam ${fmtTL(periodExtrasTotals.spare, 0)} · teste dahil değil`}
          width={620}
          rows={sparePartEntries.length === 0 ? [] : sparePartEntries.map((e) => ({
            label: e.stokAdi,
            sub: `${e.date ? e.date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'} · ${e.labName}${e.deviceInfo ? ` · ${e.deviceInfo}` : ''}`,
            value: fmtTL(e.costTL, 0),
          }))}
          onClose={() => setShowSpareLedger(false)}
        />
      )}
    </div>
  );
}
