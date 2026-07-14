'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { orderBy } from 'firebase/firestore';
import {
  BarChart3, FileSpreadsheet, Loader2, ChevronDown, Check, Download,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { useAuth } from '@/contexts/auth-context';
import { getScopedDocs } from '@/lib/firestore-helpers';
import { useProductCodes, useTestDefinitions } from '@/hooks/useFirebaseQueries';
import { useToast } from '@/hooks/use-toast';
import {
  C, AC, ClayPage, useMode, Card, RaporHead, SoftBtn, PrimaryBtn, FieldLabel, Dropdown,
} from '@/components/raporlama/rapor-kit';

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

// ── MONTHS ────────────────────────────────────────────────────────────────────
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  short: new Date(0, i, 1).toLocaleString('tr-TR', { month: 'short' }),
  label: new Date(0, i, 1).toLocaleString('tr-TR', { month: 'long' }),
}));

// ── TYPES ──────────────────────────────────────────────────────────────────────
type CumulativeHistoryItem = {
  productId?: string;
  productName?: string;
  total?: number;
};

type CumulativeHistoryRecord = {
  id: string;
  hospitalId?: string;
  hospitalName?: string;
  period?: string;
  month?: number;
  year?: number;
  items?: CumulativeHistoryItem[];
};

// ── INLINE DROPDOWN (compact, for toolbar) ─────────────────────────────────────
type Opt = string | { value: string; label: string };
const optVal = (o: Opt) => (typeof o === 'string' ? o : o.value);
const optLabel = (o: Opt) => (typeof o === 'string' ? o : o.label);

function FilterSelect({
  value, onChange, options, label,
}: { value: string; onChange: (v: string) => void; options: Opt[]; label: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const selected = options.find((o) => optVal(o) === value);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 180 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          height: 44, padding: '0 14px', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset,
          width: '100%', fontSize: 13.5, fontWeight: 600, color: C.ink1,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? optLabel(selected) : label}
        </span>
        <ChevronDown size={15} style={{ color: C.ink3, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: `transform 200ms ${EASE}` }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', left: 0, right: 0, zIndex: 80,
          background: C.surface, borderRadius: C.radiusSm,
          boxShadow: `${C.clay}, 0 20px 44px -18px rgba(90,72,40,0.45)`, padding: 5, maxHeight: 240, overflowY: 'auto',
          animation: `cyPopIn 160ms ${EASE}`,
        }}>
          {options.map((o) => {
            const v = optVal(o); const on = v === value;
            return (
              <button key={v} type="button" onClick={() => { onChange(v); setOpen(false); }}
                style={{
                  all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '9px 10px', borderRadius: 10,
                  background: on ? `${AC.primary}16` : 'transparent', color: on ? AC.primary : C.ink1,
                  fontSize: 13.5, fontWeight: on ? 800 : 600,
                }}
                onPointerEnter={(e) => { if (!on) e.currentTarget.style.background = C.surface2; }}
                onPointerLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{optLabel(o)}</span>
                {on && <Check size={14} style={{ flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── TABLE CELL HELPERS ─────────────────────────────────────────────────────────
const thStyle = (bg = C.surface2, right = false): React.CSSProperties => ({
  padding: '10px 12px', fontSize: 11, fontWeight: 800, color: C.ink2,
  letterSpacing: '0.05em', textTransform: 'uppercase',
  background: bg, textAlign: right ? 'right' : 'left',
  borderBottom: `1.5px solid ${C.line}`, whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 10,
});

const tdNum = (value: number, accent = false): React.CSSProperties => ({
  padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  fontSize: 13, fontWeight: value === 0 ? 600 : 700,
  color: value === 0 ? '#C0404C' : (accent ? AC.primary : C.ink1),
  whiteSpace: 'nowrap',
});

const tdText = (mono = false): React.CSSProperties => ({
  padding: '9px 12px', fontSize: 13, fontWeight: 600, color: C.ink2,
  fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
});

// ── PAGE ───────────────────────────────────────────────────────────────────────
export default function CounterAnalizPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const mode = useMode();
  const mobile = mode === 'mobile';

  const { data: testDefs = [] } = useTestDefinitions();
  const { data: productCodes = [] } = useProductCodes();

  const [records, setRecords] = useState<CumulativeHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [analysisMode, setAnalysisMode] = useState<'monthly' | 'yearly'>('monthly');
  const [analysisYear, setAnalysisYear] = useState(new Date().getFullYear());
  const [analysisMonth, setAnalysisMonth] = useState(new Date().getMonth());
  const [analysisLab, setAnalysisLab] = useState('__all__');

  // Load cumulative history
  useEffect(() => {
    let alive = true;
    setIsLoading(true);
    (async () => {
      try {
        const docs = await getScopedDocs('kumulatifHesaplamaGecmisi', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc'));
        if (!alive) return;
        setRecords(docs.map((d) => ({ id: d.id, ...d.data() } as CumulativeHistoryRecord)));
      } catch (e: any) {
        if (!alive) return;
        toast({ title: 'Hata', description: 'Kümülatif geçmiş okunamadı.', variant: 'destructive' });
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [currentCompanyId, isSuperAdmin, toast]);

  const productMap = useMemo(() => {
    const m = new Map<string, string>();
    productCodes.forEach((p) => m.set(p.stokKodu, p.stokAdi));
    return m;
  }, [productCodes]);

  // Years available in data
  const years = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear(), analysisYear]);
    records.forEach((r) => {
      const y = r.year || (r.period ? Number(String(r.period).split('-')[0]) : NaN);
      if (Number.isFinite(y)) s.add(y);
    });
    return Array.from(s).sort((a, b) => b - a);
  }, [records, analysisYear]);

  // Labs available in data
  const labs = useMemo(() => {
    const m = new Map<string, string>();
    records.forEach((r) => {
      const id = r.hospitalId || r.hospitalName || 'unknown';
      if (id) m.set(id, r.hospitalName || id);
    });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [records]);

  // Filtered records for selected year/month/lab
  const filteredRecords = useMemo(() => records.filter((r) => {
    const year = r.year || (r.period ? Number(String(r.period).split('-')[0]) : NaN);
    const month = typeof r.month === 'number' ? r.month - 1 : NaN;
    if (year !== analysisYear) return false;
    if (analysisMode === 'monthly' && month !== analysisMonth) return false;
    if (analysisLab !== '__all__' && (r.hospitalId || r.hospitalName || 'unknown') !== analysisLab) return false;
    return true;
  }), [records, analysisYear, analysisMonth, analysisMode, analysisLab]);

  // Compute per-test rows
  const tableRows = useMemo(() => testDefs.map((def, rowIndex) => {
    const linked = new Set(def.linkedStokKodlari || []);
    const monthlyTotals = Array(12).fill(0) as number[];
    const labTotals = new Map<string, { name: string; total: number }>();
    let selectedTotal = 0;

    filteredRecords.forEach((r) => {
      const recordMonth = typeof r.month === 'number' ? r.month - 1 : 0;
      const labId = r.hospitalId || r.hospitalName || 'unknown';
      const contribution = (r.items || []).reduce((s, item) => (
        linked.has(item.productId || '') ? s + (Number(item.total) || 0) : s
      ), 0);
      if (contribution <= 0) return;
      selectedTotal += contribution;
      if (recordMonth >= 0 && recordMonth < 12) monthlyTotals[recordMonth] += contribution;
      const existing = labTotals.get(labId) || { name: r.hospitalName || labId, total: 0 };
      existing.total += contribution;
      labTotals.set(labId, existing);
    });

    return {
      num: rowIndex + 1,
      def,
      linkedNames: (def.linkedStokKodlari || []).map((k) => productMap.get(k) || k).join(', '),
      selectedTotal,
      annualTotal: monthlyTotals.reduce((s, v) => s + v, 0),
      monthlyTotals,
      labTotals: Array.from(labTotals.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.total - a.total),
    };
  }), [testDefs, filteredRecords, productMap]);

  // All lab columns visible in current table
  const labColumns = useMemo(() => {
    const m = new Map<string, string>();
    tableRows.forEach((r) => r.labTotals.forEach((l) => m.set(l.id, l.name)));
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [tableRows]);

  // Period label for column header
  const periodLabel = analysisMode === 'monthly'
    ? `${MONTHS[analysisMonth]?.short}.${String(analysisYear).slice(-2)} Toplam`
    : `${analysisYear} Kümülatif`;

  // ── Excel Export ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    const wb = XLSX.utils.book_new();

    if (analysisMode === 'monthly') {
      // TOPLAM sheet — lab columns
      const headerRow = ['#', 'SUT KODU', 'SUT ADI', 'BAĞLI ÜRÜNLER', 'COUNTER TOPLAM', periodLabel, ...labColumns.map((l) => l.name)];
      const dataRows = tableRows.map((r) => [
        r.num,
        r.def.sutKodu,
        r.def.sutTestAdi,
        r.linkedNames,
        Number(r.def.counterValue || 0),
        r.selectedTotal,
        ...labColumns.map((l) => r.labTotals.find((t) => t.id === l.id)?.total || 0),
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
      // Yellow fill for header cells 4-5 (0-indexed)
      XLSX.utils.book_append_sheet(wb, ws, 'Toplam');

      // Per-lab sheets
      labs.forEach((lab) => {
        const labHeader = ['#', 'SUT KODU', 'SUT ADI', 'BAĞLI ÜRÜNLER', `${periodLabel}`, ...MONTHS.map((m) => `${m.short}.${String(analysisYear).slice(-2)}`)];
        const labRecords = records.filter((r) => {
          const y = r.year || (r.period ? Number(String(r.period).split('-')[0]) : NaN);
          const id = r.hospitalId || r.hospitalName || 'unknown';
          return y === analysisYear && id === lab.id;
        });
        const labRows = tableRows.map((r) => {
          const linked = new Set(r.def.linkedStokKodlari || []);
          const monthly = Array(12).fill(0);
          let labTotal = 0;
          labRecords.forEach((rec) => {
            const m = typeof rec.month === 'number' ? rec.month - 1 : 0;
            const contrib = (rec.items || []).reduce((s, item) => linked.has(item.productId || '') ? s + (Number(item.total) || 0) : s, 0);
            if (contrib <= 0) return;
            labTotal += contrib;
            if (m >= 0 && m < 12) monthly[m] += contrib;
          });
          return [r.num, r.def.sutKodu, r.def.sutTestAdi, r.linkedNames, labTotal, ...monthly];
        });
        const ws2 = XLSX.utils.aoa_to_sheet([labHeader, ...labRows]);
        XLSX.utils.book_append_sheet(wb, ws2, lab.name.slice(0, 31));
      });
    } else {
      // Yıllık: one sheet with monthly columns
      const headerRow = ['#', 'SUT KODU', 'SUT ADI', 'BAĞLI ÜRÜNLER', `${analysisYear} Kümülatif`, ...MONTHS.map((m) => `${m.short}.${String(analysisYear).slice(-2)}`)];
      const dataRows = tableRows.map((r) => [
        r.num, r.def.sutKodu, r.def.sutTestAdi, r.linkedNames, r.annualTotal, ...r.monthlyTotals,
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
      XLSX.utils.book_append_sheet(wb, ws, `${analysisYear} Yıllık`);
    }

    XLSX.writeFile(wb, `counter_analiz_${analysisYear}${analysisMode === 'monthly' ? `_${MONTHS[analysisMonth]?.short}` : ''}.xlsx`);
    toast({ title: 'Excel İndirildi', description: 'Counter analiz tablosu indirildi.' });
  };

  // ── Dropdown options ──────────────────────────────────────────────────────────
  const modeOptions = [
    { value: 'monthly', label: 'Dönem + Laboratuvar' },
    { value: 'yearly', label: 'Yıllık Ay Dağılımı' },
  ];
  const yearOptions = years.map((y) => ({ value: String(y), label: String(y) }));
  const monthOptions = MONTHS.map((m) => ({ value: String(m.value), label: m.label }));
  const labOptions = [
    { value: '__all__', label: 'Tüm Laboratuvarlar' },
    ...labs.map((l) => ({ value: l.id, label: l.name })),
  ];

  return (
    <ClayPage>
      <div style={{ animation: `cyRise 360ms ${EASE} both` }}>

        {/* Header */}
        <RaporHead
          icon={BarChart3}
          title="Counter Test Analizi"
          desc="Test tanımlarını seçili dönem kümülatif geçmişiyle eşleştirir; laboratuvar bazında test sayılarını gösterir."
          onBack={() => router.push('/yonetim/test-yonetimi')}
          mobile={mobile}
          right={
            <SoftBtn tone={C.waterDeep} onClick={handleExport} disabled={isLoading || tableRows.length === 0}>
              <FileSpreadsheet size={18} /> Excel&apos;e Aktar
            </SoftBtn>
          }
        />

        {/* Filter toolbar */}
        <Card style={{ marginBottom: 16, padding: mobile ? 14 : '16px 20px', position: 'relative', zIndex: 40, overflow: 'visible' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 180px', minWidth: 160 }}>
              <FieldLabel>Görünüm</FieldLabel>
              <FilterSelect value={analysisMode} onChange={(v) => setAnalysisMode(v as 'monthly' | 'yearly')} options={modeOptions} label="Görünüm" />
            </div>
            <div style={{ flex: '0 0 120px', minWidth: 100 }}>
              <FieldLabel>Yıl</FieldLabel>
              <FilterSelect value={String(analysisYear)} onChange={(v) => setAnalysisYear(Number(v))} options={yearOptions} label="Yıl" />
            </div>
            {analysisMode === 'monthly' && (
              <div style={{ flex: '1 1 160px', minWidth: 140 }}>
                <FieldLabel>Ay</FieldLabel>
                <FilterSelect value={String(analysisMonth)} onChange={(v) => setAnalysisMonth(Number(v))} options={monthOptions} label="Ay" />
              </div>
            )}
            <div style={{ flex: '1 1 220px', minWidth: 180 }}>
              <FieldLabel>Laboratuvar</FieldLabel>
              <FilterSelect value={analysisLab} onChange={setAnalysisLab} options={labOptions} label="Tüm Laboratuvarlar" />
            </div>
          </div>
        </Card>

        {/* Table */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '48px 24px', color: C.ink2, fontSize: 14, fontWeight: 700 }}>
              <Loader2 size={20} style={{ animation: 'cySpin 1s linear infinite', color: AC.primary }} />
              Kümülatif veriler yükleniyor…
            </div>
          ) : (
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
              <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    {/* Fixed left columns */}
                    <th style={{ ...thStyle(C.surface2), width: 44, textAlign: 'center', left: 0, position: 'sticky', zIndex: 20 }}>#</th>
                    <th style={{ ...thStyle(C.surface2), minWidth: 110 }}>SUT Kodu</th>
                    <th style={{ ...thStyle(C.surface2), minWidth: 220 }}>SUT Adı</th>
                    <th style={{ ...thStyle(C.surface2), minWidth: 240 }}>Bağlı Ürünler</th>
                    {/* Yellow: counter baseline */}
                    <th style={{ ...thStyle('rgba(255,220,60,0.25)', true), minWidth: 120 }}>Counter Toplam</th>
                    {/* Yellow: period/annual total */}
                    <th style={{ ...thStyle('rgba(255,220,60,0.22)', true), minWidth: 130 }}>{periodLabel}</th>
                    {/* Dynamic columns */}
                    {analysisMode === 'yearly'
                      ? MONTHS.map((m) => (
                          <th key={m.value} style={{ ...thStyle('rgba(255,190,50,0.12)', true), minWidth: 90 }}>
                            {m.short}.{String(analysisYear).slice(-2)}
                          </th>
                        ))
                      : labColumns.map((lab) => (
                          <th key={lab.id} style={{ ...thStyle('rgba(255,190,50,0.12)', true), minWidth: 130 }}>
                            {lab.name}
                          </th>
                        ))
                    }
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={6 + (analysisMode === 'yearly' ? 12 : labColumns.length)}
                        style={{ padding: '48px 24px', textAlign: 'center', color: C.ink3, fontSize: 14, fontWeight: 600 }}>
                        Eşleşen kayıt bulunamadı. Dönem, yıl ve laboratuvar filtrelerini kontrol edin.
                      </td>
                    </tr>
                  ) : tableRows.map((row, i) => {
                    const even = i % 2 === 0;
                    const rowBg = even ? C.surfaceHi : C.surface;
                    const counterVal = Number(row.def.counterValue || 0);
                    const periodVal = analysisMode === 'yearly' ? row.annualTotal : row.selectedTotal;
                    return (
                      <tr key={row.def.id}
                        style={{ background: rowBg, transition: `background 120ms ${EASE}` }}
                        onPointerEnter={(e) => { e.currentTarget.style.background = `${AC.primary}09`; }}
                        onPointerLeave={(e) => { e.currentTarget.style.background = rowBg; }}
                      >
                        <td style={{ padding: '9px 8px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.ink3, position: 'sticky', left: 0, background: rowBg, zIndex: 5 }}>
                          {row.num}
                        </td>
                        <td style={{ ...tdText(true), color: C.ink1, fontWeight: 700 }}>{row.def.sutKodu}</td>
                        <td style={{ ...tdText(false), color: C.ink1, maxWidth: 240 }}>{row.def.sutTestAdi}</td>
                        <td style={{ ...tdText(false), color: C.ink2, maxWidth: 260 }}>{row.linkedNames || '—'}</td>
                        {/* Counter Toplam — yellow bg */}
                        <td style={{ ...tdNum(counterVal, false), background: 'rgba(255,220,60,0.14)', color: counterVal === 0 ? C.ink3 : C.ink1, fontWeight: 700 }}>
                          {counterVal.toLocaleString('tr-TR')}
                        </td>
                        {/* Period total — yellow bg, red if zero */}
                        <td style={{ ...tdNum(periodVal, false), background: 'rgba(255,220,60,0.10)', color: periodVal === 0 ? '#C0404C' : C.ink1, fontWeight: 700 }}>
                          {periodVal.toLocaleString('tr-TR')}
                        </td>
                        {/* Dynamic columns */}
                        {analysisMode === 'yearly'
                          ? row.monthlyTotals.map((v, mi) => (
                              <td key={mi} style={tdNum(v)}>
                                {v === 0 ? '0' : v.toLocaleString('tr-TR')}
                              </td>
                            ))
                          : labColumns.map((lab) => {
                              const v = row.labTotals.find((t) => t.id === lab.id)?.total || 0;
                              return (
                                <td key={lab.id} style={tdNum(v)}>
                                  {v === 0 ? '0' : v.toLocaleString('tr-TR')}
                                </td>
                              );
                            })
                        }
                      </tr>
                    );
                  })}
                </tbody>
                {/* Footer totals */}
                {tableRows.length > 0 && (
                  <tfoot>
                    <tr style={{ background: C.surface2, borderTop: `2px solid ${C.line}` }}>
                      <td colSpan={4} style={{ padding: '10px 12px', fontSize: 12, fontWeight: 800, color: C.ink2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        TOPLAM
                      </td>
                      <td style={{ ...tdNum(tableRows.reduce((s, r) => s + Number(r.def.counterValue || 0), 0), true), background: 'rgba(255,220,60,0.18)', fontWeight: 800, color: C.ink1 }}>
                        {tableRows.reduce((s, r) => s + Number(r.def.counterValue || 0), 0).toLocaleString('tr-TR')}
                      </td>
                      <td style={{ ...tdNum(0, true), background: 'rgba(255,220,60,0.12)', fontWeight: 800, color: C.ink1 }}>
                        {(analysisMode === 'yearly'
                          ? tableRows.reduce((s, r) => s + r.annualTotal, 0)
                          : tableRows.reduce((s, r) => s + r.selectedTotal, 0)
                        ).toLocaleString('tr-TR')}
                      </td>
                      {analysisMode === 'yearly'
                        ? MONTHS.map((m) => (
                            <td key={m.value} style={{ ...tdNum(0), fontWeight: 700, color: C.ink1 }}>
                              {tableRows.reduce((s, r) => s + (r.monthlyTotals[m.value] || 0), 0).toLocaleString('tr-TR')}
                            </td>
                          ))
                        : labColumns.map((lab) => (
                            <td key={lab.id} style={{ ...tdNum(0), fontWeight: 700, color: C.ink1 }}>
                              {tableRows.reduce((s, r) => s + (r.labTotals.find((t) => t.id === lab.id)?.total || 0), 0).toLocaleString('tr-TR')}
                            </td>
                          ))
                      }
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </Card>

      </div>
    </ClayPage>
  );
}
