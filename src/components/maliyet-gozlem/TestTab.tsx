'use client';

/**
 * Maliyet Gözlem — Test Bazlı Maliyet Tab.
 *
 * Test tanımları, ürünler, depo stoğu, cihazlar, envanter, personel ve döviz
 * verilerini canlı çekip her test için maliyet hesaplar; ardından mock yerine
 * gerçek veriye dayalı kategori pills, KPI satırı, Activities Panel, Insights
 * kartı ve detaylı test tablosu sunar.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  calculateTestCost,
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
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { filterByCompanyScope } from '@/lib/company-scope';
import { useAuth } from '@/contexts/auth-context';
import { getExchangeRates } from '@/lib/exchange-rates';
import { Loader2, ChevronDown, Search } from 'lucide-react';

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

function Pill({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 100,
        cursor: 'pointer',
        background: active ? 'var(--mg-surface-2)' : 'var(--mg-surface)',
        border: '1px solid ' + (active ? color || 'var(--mg-border-strong)' : 'var(--mg-border)'),
        color: active ? color || 'var(--mg-text)' : 'var(--mg-text-2)',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 500,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
        transition: 'all 0.2s',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: active ? color || 'var(--mg-accent)' : 'var(--mg-muted)',
        }}
      />
      {label}
    </button>
  );
}

function FilterBar({
  labs,
  selectedLabIds,
  setSelectedLabIds,
  periot,
  setPeriot,
  search,
  setSearch,
}: FilterBarProps) {
  const periodOpts: { k: PeriotConfig['type']; label: string }[] = [
    { k: 'gunluk', label: 'Günlük' },
    { k: 'aylik', label: 'Aylık' },
    { k: 'yillik', label: 'Yıllık' },
  ];

  const toggleLab = (id: string) => {
    if (selectedLabIds.includes(id)) setSelectedLabIds(selectedLabIds.filter((x) => x !== id));
    else setSelectedLabIds([...selectedLabIds, id]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Periyot + arama */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'inline-flex',
            gap: 4,
            background: 'var(--mg-surface-2)',
            padding: 4,
            borderRadius: 10,
            border: '1px solid var(--mg-border)',
          }}
        >
          {periodOpts.map((o) => (
            <button
              key={o.k}
              onClick={() => setPeriot({ type: o.k })}
              style={{
                padding: '5px 12px',
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
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--mg-surface)',
            borderRadius: 10,
            padding: '8px 14px',
            border: '1px solid var(--mg-border)',
            minWidth: 240,
            flex: 1,
            maxWidth: 360,
          }}
        >
          <Search size={14} style={{ color: 'var(--mg-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Test ara…"
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
        </div>
      </div>

      {/* Lab seçim pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Pill
          label={`Tüm Laboratuvarlar (${labs.length})`}
          active={selectedLabIds.length === 0}
          onClick={() => setSelectedLabIds([])}
        />
        {labs.map((l) => (
          <Pill
            key={l.id}
            label={l.name}
            active={selectedLabIds.includes(l.id)}
            onClick={() => toggleLab(l.id)}
          />
        ))}
        {selectedLabIds.length > 0 && (
          <button
            onClick={() => setSelectedLabIds([])}
            style={{
              padding: '6px 12px',
              borderRadius: 100,
              cursor: 'pointer',
              background: 'transparent',
              border: '1px dashed var(--mg-border-strong)',
              color: 'var(--mg-muted)',
              fontFamily: 'inherit',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Temizle ({selectedLabIds.length})
          </button>
        )}
      </div>
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
  const totalPct = (result.testTotalCostTL / Math.max(maxTotal, 1)) * 100;
  const c = result.marjTL >= 0 ? 'var(--mg-success)' : 'var(--mg-danger)';
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

  const [loading, setLoading] = useState(true);
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
          getDocs(query(collection(db, 'productCodes'), orderBy('stokAdi', 'asc'))),
          getDocs(query(collection(db, 'hospitals'), orderBy('name', 'asc'))),
          getDocs(collection(db, 'devices')),
          getDocs(collection(db, 'hospitalDeviceAssignments')),
          getDocs(collection(db, 'assets')),
          getDocs(collection(db, 'personnel')),
          getDocs(collection(db, 'depoStok')),
          getDocs(query(collection(db, 'testDefinitions'), orderBy('sutKodu', 'asc'))),
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
        const stok = stokSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DepoStokItem)).filter((s) => s.isShipped === true);
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
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentCompanyId, isSuperAdmin]);

  // Hesap motoru — her test için breakdown
  const breakdowns = useMemo<TestCostBreakdown[]>(() => {
    if (testDefs.length === 0) return [];
    return testDefs.map((t) =>
      calculateTestCost({
        testDef: t,
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
      }),
    );
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

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--mg-muted)' }}>
        <Loader2 size={32} className="animate-spin" style={{ display: 'inline-block', marginBottom: 12 }} />
        <div style={{ fontSize: 14 }}>Maliyet verileri yükleniyor...</div>
      </div>
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
        search={search}
        setSearch={setSearch}
      />

      {/* KPI Row */}
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

      {/* Activities + Insights */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)', gap: 16 }}>
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
