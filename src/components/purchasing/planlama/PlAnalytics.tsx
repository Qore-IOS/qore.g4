'use client';

import React from 'react';
import {
  PL_PRI, PL_PRI_ORDER, PL_DOW, PlModal, PlModalHead, PlRing,
  plToday, plParse, isoOffset,
  type Task, type Mode, type Accent,
} from './pl-primitives';

interface Props {
  ac: Accent; mode: Mode; open: boolean; tasks: Task[]; onClose: () => void;
}

const MiniStat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2)' }}>{label} <strong style={{ color: 'var(--ink-1)' }}>{value}</strong></span>
);

const PlAnalytics: React.FC<Props> = ({ ac, mode, open, tasks, onClose }) => {
  const mobile = mode === 'mobile';
  if (!open) return null;

  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;
  const donePct = total ? Math.round(done / total * 100) : 0;
  const subTotal = tasks.reduce((a, t) => a + t.subs.length, 0);
  const subDone = tasks.reduce((a, t) => a + t.subs.filter(s => s.done).length, 0);

  const byPri = PL_PRI_ORDER.map(pk => ({ pk, p: PL_PRI[pk], n: tasks.filter(t => t.pri === pk).length, d: tasks.filter(t => t.pri === pk && t.done).length }));
  const maxPri = Math.max(...byPri.map(x => x.n), 1);

  const week: { iso: string; label: string; total: number; done: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const iso = isoOffset(-i);
    const day = plParse(iso);
    week.push({ iso, label: PL_DOW[(day.getDay() + 6) % 7], total: tasks.filter(t => t.date === iso).length, done: tasks.filter(t => t.date === iso && t.done).length });
  }
  const maxWeek = Math.max(...week.map(w => w.total), 1);

  return (
    <PlModal open={open} onClose={onClose} width={680} sheet={mobile}>
      <PlModalHead ico="bars" title="Analiz" onClose={onClose} ac={ac} />
      <div style={{ padding: 'clamp(16px,3vw,22px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 18, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: 'var(--clay)' }}>
          <PlRing pct={donePct} size={mobile ? 64 : 78} thickness={8} on={open} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-1)' }}>Genel İlerleme</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600, marginTop: 2 }}>{done} / {total} görev tamamlandı</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <MiniStat label="Açık" value={total - done} />
              <MiniStat label="Alt görev" value={`${subDone}/${subTotal}`} />
            </div>
          </div>
        </div>

        <div style={{ padding: 18, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16 }}>Önem Derecesine Göre</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {byPri.map((x, i) => (
              <div key={x.pk} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 42px', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: x.p.ink }}>{x.p.label}</span>
                <div style={{ height: 14, borderRadius: 99, background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(x.n / maxPri) * 100}%`, borderRadius: 99, background: `linear-gradient(90deg, ${x.p.solid}, ${x.p.solid}cc)`, animation: `plGrowW 1000ms ${i * 130}ms var(--ease-fluid)` }} />
                </div>
                <span style={{ textAlign: 'right', fontSize: 15, fontWeight: 800, color: 'var(--ink-1)' }}>{x.n}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: 18, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16 }}>Son 7 Gün</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: mobile ? 6 : 12, height: 120 }}>
            {week.map((w, i) => {
              const h = (w.total / maxWeek) * 100;
              return (
                <div key={w.iso} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, height: '100%' }}>
                  <div style={{ flex: 1, width: '100%', maxWidth: 34, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div style={{ position: 'relative', width: '100%', height: `${h}%`, minHeight: w.total ? 8 : 0, borderRadius: '8px 8px 4px 4px', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', overflow: 'hidden', transition: 'height 700ms var(--ease-fluid)' }}>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${w.total ? (w.done / w.total) * 100 : 0}%`, background: `linear-gradient(180deg, ${ac.accent}, ${ac.primary})`, borderRadius: '6px 6px 4px 4px', animation: `plGrowH 900ms ${i * 80}ms var(--ease-fluid)` }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: w.iso === plToday() ? ac.primary : 'var(--ink-3)' }}>{w.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PlModal>
  );
};

export default PlAnalytics;
