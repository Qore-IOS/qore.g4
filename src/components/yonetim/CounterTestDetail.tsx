'use client';

import React, { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowLeftRight, BarChart3, Beaker, Building2, ChevronLeft, CircleGauge, TrendingDown, TrendingUp } from 'lucide-react';
import { C, AC, Card, SoftBtn } from '@/components/raporlama/rapor-kit';

type HistoryRecord = {
  hospitalId?: string; hospitalName?: string; period?: string; month?: number; year?: number;
  items?: Array<{ productId?: string; total?: number }>;
};
type TestDef = { id: string; sutKodu?: string; sutTestAdi?: string; linkedStokKodlari?: string[] };

const COLORS = ['#C98A57', '#6FB585', '#6EA8FF', '#A78BFA', '#E0A33E', '#E87878', '#46B8C8', '#D477A8'];
const fmt = (n: number) => Math.round(n || 0).toLocaleString('tr-TR');
const testName = (test?: TestDef) => test?.sutTestAdi || test?.sutKodu || 'Test seçilmedi';

function contribution(record: HistoryRecord, linked: Set<string>) {
  return (record.items || []).reduce((sum, item) => linked.has(item.productId || '') ? sum + (Number(item.total) || 0) : sum, 0);
}

function analyze(test: TestDef, records: HistoryRecord[]) {
  const linked = new Set(test.linkedStokKodlari || []);
  const periods = new Map<string, { key: string; year: number; month: number; label: string; total: number }>();
  const labsByPeriod = new Map<string, Map<string, { name: string; total: number }>>();
  records.forEach((record) => {
    const year = record.year ?? Number(record.period?.split('-')[0]);
    const month = record.month ?? Number(record.period?.split('-')[1]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return;
    const value = contribution(record, linked);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const date = new Date(year, month - 1, 1);
    const row = periods.get(key) || { key, year, month, label: date.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }), total: 0 };
    row.total += value;
    periods.set(key, row);
    const labId = record.hospitalId || record.hospitalName || 'unknown';
    const periodLabs = labsByPeriod.get(key) || new Map();
    const lab = periodLabs.get(labId) || { name: record.hospitalName || labId, total: 0 };
    lab.total += value;
    periodLabs.set(labId, lab);
    labsByPeriod.set(key, periodLabs);
  });
  const available = [...periods.values()].filter((row) => row.total > 0).sort((a, b) => a.key.localeCompare(b.key));
  const lastAvailable = available.at(-1);
  const timeline = lastAvailable ? Array.from({ length: 12 }, (_, index) => {
    const date = new Date(lastAvailable.year, lastAvailable.month - 12 + index, 1);
    const year = date.getFullYear(); const month = date.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    return periods.get(key) || { key, year, month, label: date.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }), total: 0 };
  }) : [];
  const latest = timeline.at(-1);
  const previous = timeline.at(-2);
  const sixMonthWindow = timeline.slice(-6);
  // Baştaki veri olmayan ayları saklama; ilk dolu aydan sonraki gerçek boşlukları
  // ise trendin kopuşunu doğru anlatmak için sıfır olarak koru.
  const firstDataIndex = sixMonthWindow.findIndex((row) => row.total > 0);
  const lastSix = firstDataIndex < 0 ? [] : sixMonthWindow.slice(firstDataIndex);
  const firstSixValue = lastSix[0]?.total || 0;
  const latestValue = latest?.total || 0;
  const sixMonthDelta = firstSixValue ? ((latestValue - firstSixValue) / firstSixValue) * 100 : latestValue > 0 ? 100 : 0;
  const total = timeline.reduce((sum, row) => sum + row.total, 0);
  const latestLabs = labsByPeriod.get(latest?.key || '') || new Map();
  const previousLabs = labsByPeriod.get(previous?.key || '') || new Map();
  const labIds = new Set([...latestLabs.keys(), ...previousLabs.keys()]);
  const labs = [...labIds].map((id) => {
    const current = latestLabs.get(id)?.total || 0;
    const prior = previousLabs.get(id)?.total || 0;
    return { id, name: latestLabs.get(id)?.name || previousLabs.get(id)?.name || id, total: current, delta: prior ? ((current - prior) / prior) * 100 : current > 0 ? 100 : 0 };
  }).sort((a, b) => b.total - a.total);
  const labTotal = labs.reduce((sum, lab) => sum + lab.total, 0);
  const labShare = labs.map((lab) => ({ ...lab, share: labTotal ? (lab.total / labTotal) * 100 : 0 }));
  const peak = timeline.reduce((best, row) => row.total > (best?.total || 0) ? row : best, timeline[0]);
  const average = timeline.length ? total / timeline.length : 0;
  return { timeline, lastSix, total, latestValue, sixMonthDelta, labs: labShare, latestLabel: latest?.label || 'Veri yok', peak, average };
}

export default function CounterTestDetail({
  primary, comparison, tests, records, onPrimaryChange, onComparisonChange, onClose, mobile,
}: {
  primary: TestDef; comparison?: TestDef; tests: TestDef[]; records: HistoryRecord[];
  onPrimaryChange: (id: string) => void; onComparisonChange: (id?: string) => void; onClose: () => void; mobile: boolean;
}) {
  const left = useMemo(() => analyze(primary, records), [primary, records]);
  const right = useMemo(() => comparison ? analyze(comparison, records) : null, [comparison, records]);
  const compared = !!comparison && !!right;

  return (
    <div className="counter-detail" style={{ animation: 'cyRise 360ms cubic-bezier(.22,1,.36,1) both' }}>
      <div className="counter-detail-toolbar">
        <SoftBtn onClick={onClose}><ChevronLeft size={17} /> Analize Dön</SoftBtn>
        <Selector label="Detayı gösterilen test" value={primary.id} tests={tests} onChange={onPrimaryChange} />
        <span className="counter-compare-icon"><ArrowLeftRight size={19} /></span>
        <Selector label="Karşılaştır" value={comparison?.id || ''} tests={tests.filter((t) => t.id !== primary.id)} allowEmpty onChange={(id) => onComparisonChange(id || undefined)} />
      </div>

      {compared && <ComparisonOverview left={left} right={right!} leftName={testName(primary)} rightName={testName(comparison)} />}

      <div className={compared ? 'counter-detail-compare' : 'counter-detail-single'}>
        <TestSide test={primary} data={left} color={COLORS[0]} mobile={mobile} />
        {compared && <ComparisonRail left={left} right={right!} />}
        {compared && <TestSide test={comparison!} data={right!} color={COLORS[2]} mobile={mobile} />}
      </div>
    </div>
  );
}

function Selector({ label, value, tests, onChange, allowEmpty }: { label: string; value: string; tests: TestDef[]; onChange: (id: string) => void; allowEmpty?: boolean }) {
  return <label className="counter-detail-select"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{allowEmpty && <option value="">Karşılaştırma kapalı</option>}{tests.map((test) => <option key={test.id} value={test.id}>{testName(test)}</option>)}</select></label>;
}

function TestSide({ test, data, color, mobile }: { test: TestDef; data: ReturnType<typeof analyze>; color: string; mobile: boolean }) {
  const positive = data.sixMonthDelta >= 0;
  const [trendView, setTrendView] = useState<'area' | 'bars'>('area');
  return <section className="counter-test-side" style={{ '--test-color': color } as React.CSSProperties}>
    <Card style={{ padding: mobile ? 18 : 24, overflow: 'hidden', position: 'relative' }}>
      <div className="counter-test-hero">
        <span className="counter-test-icon"><Beaker size={25} /></span>
        <div><div className="counter-test-code">{test.sutKodu || 'SUT'}</div><h1>{testName(test)}</h1><p>Son 12 aylık toplam çalışma</p></div>
        <div className="counter-test-total"><strong>{fmt(data.total)}</strong><span>TOTAL COUNT</span></div>
      </div>
      <div className={`counter-trend-chip ${positive ? 'up' : 'down'}`}>{positive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}<strong>{Math.abs(data.sixMonthDelta).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}%</strong><span>son 6 ayda {positive ? 'artış' : 'azalış'}</span></div>
      <div className="counter-kpi-strip">
        <MiniMetric label="Son ay" value={fmt(data.latestValue)} tone={color}/>
        <MiniMetric label="Aylık ortalama" value={fmt(data.average)} tone="#6FB585"/>
        <MiniMetric label="Zirve ay" value={data.peak ? `${data.peak.label} · ${fmt(data.peak.total)}` : 'Veri yok'} tone="#A78BFA"/>
        <MiniMetric label="Aktif lab" value={String(data.labs.filter((lab) => lab.total > 0).length)} tone="#46B8C8"/>
      </div>
    </Card>

    <Card style={{ padding: 18 }}><SectionTitle title="Son 6 ay çalışma trendi" subtitle={`${data.latestLabel} · ${fmt(data.latestValue)} çalışma`} actions={<ChartToggle value={trendView} onChange={setTrendView}/>}/>
      <div className="counter-chart-lg"><ResponsiveContainer width="100%" height="100%">{trendView === 'area' ? <AreaChart data={data.lastSix} margin={{ top: 18, right: 10, left: -12, bottom: 0 }}><defs><linearGradient id={`area-${test.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.5}/><stop offset="1" stopColor={color} stopOpacity={0.03}/></linearGradient></defs><CartesianGrid vertical={false} stroke={C.line} strokeDasharray="3 6"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: C.ink3, fontSize: 11 }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: C.ink3, fontSize: 11 }}/><Tooltip content={<ChartTooltip/>}/><Area type="monotone" dataKey="total" stroke={color} strokeWidth={3} fill={`url(#area-${test.id})`} dot={{ r: 4, fill: color, strokeWidth: 0 }} activeDot={{ r: 7 }}/></AreaChart> : <BarChart data={data.lastSix} margin={{ top: 18, right: 10, left: -12, bottom: 0 }}><CartesianGrid vertical={false} stroke={C.line} strokeDasharray="3 6"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: C.ink3, fontSize: 11 }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: C.ink3, fontSize: 11 }}/><Tooltip content={<ChartTooltip/>}/><Bar dataKey="total" radius={[10,10,3,3]}>{data.lastSix.map((row, index) => <Cell key={row.key} fill={index === data.lastSix.length - 1 ? color : `${color}88`}/>)}</Bar></BarChart>}</ResponsiveContainer></div>
    </Card>

    <div className="counter-visual-grid">
      <Card style={{ padding: 18 }}><SectionTitle title="Lab payları" subtitle="Son veri ayının yüzdesel dağılımı"/><div className="counter-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.labs} dataKey="total" nameKey="name" innerRadius="54%" outerRadius="82%" paddingAngle={2}>{data.labs.map((lab, index) => <Cell key={lab.id} fill={COLORS[index % COLORS.length]}/>)}</Pie><Tooltip content={<ChartTooltip percentTotal={data.latestValue}/>} /></PieChart></ResponsiveContainer><div className="counter-donut-center"><strong>{fmt(data.latestValue)}</strong><span>çalışma</span></div></div></Card>
      <Card style={{ padding: 18 }}><SectionTitle title="12 aylık yoğunluk" subtitle="Ayların toplam içindeki ağırlığı"/><div className="counter-spark-bars">{data.timeline.map((row) => { const max = Math.max(...data.timeline.map((item) => item.total), 1); return <div key={row.key} className="counter-spark-column" title={`${row.label}: ${fmt(row.total)}`}><span style={{ height: `${Math.max(row.total ? 8 : 2, (row.total / max) * 100)}%`, background: row.total ? color : C.line }}/><small>{row.label.split(' ')[0]}</small></div>; })}</div></Card>
    </div>

    <Card style={{ padding: 18 }}><SectionTitle title="Laboratuvar dağılımı" subtitle="Son veri ayı ve önceki aya göre değişim" />
      <div className="counter-chart-md" style={{ height: Math.max(230, data.labs.length * 38) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={data.labs} layout="vertical" margin={{ left: 4, right: 28 }}><XAxis type="number" hide/><YAxis type="category" dataKey="name" width={mobile ? 82 : 118} tickLine={false} axisLine={false} tick={{ fill: C.ink2, fontSize: 10 }}/><Tooltip cursor={{ fill: `${color}10` }} content={<ChartTooltip/>}/><Bar dataKey="total" radius={[0, 9, 9, 0]}>{data.labs.map((lab, index) => <Cell key={lab.id} fill={COLORS[index % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div>
      <div className="counter-lab-list">{data.labs.map((lab, index) => <div key={lab.id} className="counter-lab-row"><span className="counter-lab-dot" style={{ background: COLORS[index % COLORS.length] }}/><Building2 size={15}/><strong title={lab.name}>{lab.name}</strong><span>{fmt(lab.total)}</span><DeltaChip value={lab.delta}/></div>)}</div>
    </Card>
  </section>;
}

function ComparisonOverview({ left, right, leftName, rightName }: { left: ReturnType<typeof analyze>; right: ReturnType<typeof analyze>; leftName: string; rightName: string }) {
  const months = new Map<string, { key: string; label: string; left?: number; right?: number }>();
  left.lastSix.forEach((row) => months.set(row.key, { key: row.key, label: row.label, left: row.total }));
  right.lastSix.forEach((row) => months.set(row.key, { ...(months.get(row.key) || { key: row.key, label: row.label }), right: row.total }));
  const trend = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
  const labIds = new Set([...left.labs.map((lab) => lab.id), ...right.labs.map((lab) => lab.id)]);
  const labs = [...labIds].map((id) => ({ name: left.labs.find((lab) => lab.id === id)?.name || right.labs.find((lab) => lab.id === id)?.name || id, left: left.labs.find((lab) => lab.id === id)?.total || 0, right: right.labs.find((lab) => lab.id === id)?.total || 0 })).sort((a, b) => Math.max(b.left, b.right) - Math.max(a.left, a.right));
  return <Card className="counter-compare-overview" style={{ padding: 20 }}><SectionTitle title="Karşılaştırmalı görsel özet" subtitle="Aynı ölçek üzerinde aylık trend ve tüm laboratuvarlar"/><div className="counter-compare-charts"><div className="counter-chart-md"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend}><CartesianGrid vertical={false} stroke={C.line} strokeDasharray="3 6"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: C.ink3, fontSize: 10 }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: C.ink3, fontSize: 10 }}/><Tooltip content={<ChartTooltip/>}/><Legend/><Line name={leftName} type="monotone" dataKey="left" stroke={COLORS[0]} strokeWidth={3} connectNulls={false}/><Line name={rightName} type="monotone" dataKey="right" stroke={COLORS[2]} strokeWidth={3} connectNulls={false}/></LineChart></ResponsiveContainer></div><div className="counter-chart-md" style={{ height: Math.max(240, labs.length * 34) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={labs} layout="vertical"><XAxis type="number" hide/><YAxis dataKey="name" type="category" width={105} tickLine={false} axisLine={false} tick={{ fill: C.ink2, fontSize: 9 }}/><Tooltip content={<ChartTooltip/>}/><Legend/><Bar name={leftName} dataKey="left" fill={COLORS[0]} radius={[0,7,7,0]}/><Bar name={rightName} dataKey="right" fill={COLORS[2]} radius={[0,7,7,0]}/></BarChart></ResponsiveContainer></div></div></Card>;
}

function ChartTooltip({ active, payload, label, percentTotal }: any) { if (!active || !payload?.length) return null; return <div className="counter-chart-tooltip"><strong>{label || payload[0]?.name}</strong>{payload.map((item: any) => <div key={`${item.dataKey}-${item.name}`}><i style={{ background: item.color || item.payload?.fill }}/><span>{item.name === 'total' ? 'Çalışma' : item.name}</span><b>{fmt(item.value)}{percentTotal ? ` · %${((item.value / percentTotal) * 100).toFixed(1)}` : ''}</b></div>)}</div>; }
function MiniMetric({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="counter-mini-metric"><i style={{ background: tone }}/><span>{label}</span><strong>{value}</strong></div>; }
function ChartToggle({ value, onChange }: { value: 'area' | 'bars'; onChange: (value: 'area' | 'bars') => void }) { return <div className="counter-chart-toggle" aria-label="Grafik türü"><button type="button" className={value === 'area' ? 'active' : ''} onClick={() => onChange('area')} aria-label="Alan grafik"><CircleGauge size={15}/></button><button type="button" className={value === 'bars' ? 'active' : ''} onClick={() => onChange('bars')} aria-label="Sütun grafik"><BarChart3 size={15}/></button></div>; }

function ComparisonRail({ left, right }: { left: ReturnType<typeof analyze>; right: ReturnType<typeof analyze> }) {
  return <aside className="counter-comparison-rail" aria-label="Karşılaştırma sonuçları">
    <CompareMarker label="Toplam" left={left.total} right={right.total}/>
    <CompareMarker label="Son ay" left={left.latestValue} right={right.latestValue}/>
    <CompareMarker label="6 ay trend" left={left.sixMonthDelta} right={right.sixMonthDelta} percent/>
    <CompareMarker label="Lab lideri" left={left.labs[0]?.total || 0} right={right.labs[0]?.total || 0}/>
  </aside>;
}

function CompareMarker({ label, left, right, percent }: { label: string; left: number; right: number; percent?: boolean }) {
  const direction = left === right ? 'equal' : left > right ? 'left' : 'right';
  return <div className="counter-compare-marker"><span>{label}</span><div className={`counter-compare-arrow ${direction}`} aria-label={direction === 'equal' ? `${label} eşit` : `${label}: ${direction === 'left' ? 'soldaki' : 'sağdaki'} test daha yüksek`}><i/><b>{direction === 'equal' ? '=' : direction === 'left' ? '‹' : '›'}</b></div><small>{percent ? `${Math.abs(left - right).toFixed(1)} puan` : `${fmt(Math.abs(left - right))} fark`}</small></div>;
}

function DeltaChip({ value }: { value: number }) { const up = value >= 0; return <span className={`counter-lab-delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(value).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}%</span>; }
function SectionTitle({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) { return <div className="counter-section-title"><div><h2>{title}</h2><p>{subtitle}</p></div>{actions}</div>; }
