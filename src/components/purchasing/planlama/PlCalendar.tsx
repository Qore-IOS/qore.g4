'use client';

import React from 'react';
import {
  PL_PRI, PL_CAL_COLORS, PL_MON, PL_MON_SHORT, PL_EN_MON, PL_DOW, PL_DOW_FULL, PLIco,
  PlBtn, PlRing, PlIconBtn, PlCheck,
  plToday, plParse, plDow, plRelative, plWorkMinutes,
  type Task, type Mode, type Accent,
} from './pl-primitives';

interface CalProps {
  ac: Accent; mode: Mode; tasks: Task[];
  onToggle: (id: string) => void; onEdit: (t: Task) => void; onAdd: (d: string) => void;
}

const PlCalendar: React.FC<CalProps> = ({ ac, mode, tasks, onToggle, onEdit, onAdd }) => {
  const mobile = mode === 'mobile';
  const today = plToday();
  const t0 = plParse(today);
  const [cursor, setCursor] = React.useState({ y: t0.getFullYear(), m: t0.getMonth() });
  const [calMode, setCalMode] = React.useState<'cards' | 'grid'>('cards');

  const prev = () => setCursor(c => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 });
  const next = () => setCursor(c => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 });

  const monthTasks = tasks.filter(t => { const d = plParse(t.date); return d.getFullYear() === cursor.y && d.getMonth() === cursor.m; });
  const byDay = new Map<string, Task[]>();
  monthTasks.forEach(t => { if (!byDay.has(t.date)) byDay.set(t.date, []); byDay.get(t.date)!.push(t); });
  const days = [...byDay.keys()].sort();

  const prevM = cursor.m === 0 ? 11 : cursor.m - 1;
  const nextM = cursor.m === 11 ? 0 : cursor.m + 1;

  const monthSideStyle: React.CSSProperties = { all: 'unset' as any, cursor: 'pointer', fontFamily: 'var(--serif)', fontWeight: 700, fontSize: mobile ? 17 : 22, color: 'var(--ink-3)', letterSpacing: '0.03em' };
  const chevStyle: React.CSSProperties = { all: 'unset' as any, cursor: 'pointer', width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--ink-2)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: 'var(--clay)' };

  return (
    <div>
      {/* view mode toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: mobile ? 14 : 16 }}>
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 'var(--radius-pill)', background: 'linear-gradient(180deg, var(--surface), var(--surface-2))', boxShadow: 'var(--clay-inset)' }}>
          {[{ v: 'cards', l: 'Kartlar', ic: 'list' }, { v: 'grid', l: 'Takvim', ic: 'calendar' }].map(o => {
            const on = calMode === o.v; const G = PLIco[o.ic];
            return (
              <button key={o.v} onClick={() => setCalMode(o.v as any)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 700, color: on ? 'var(--ink-1)' : 'var(--ink-3)', background: on ? 'var(--surface-hi)' : 'transparent', boxShadow: on ? 'var(--clay-flat)' : 'none', transition: 'all 200ms var(--ease-fluid)' }}><G s={15} /> {o.l}</button>
            );
          })}
        </div>
      </div>

      {/* month switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: mobile ? 14 : 26, marginBottom: mobile ? 22 : 28, padding: '4px 0' }}>
        <button onClick={prev} style={monthSideStyle}>{PL_MON_SHORT[prevM].toUpperCase()}</button>
        <button onClick={prev} aria-label="Önceki ay" style={chevStyle}><PLIco.chevL s={20} /></button>
        <div style={{ fontFamily: 'var(--serif)', fontWeight: 800, fontSize: mobile ? 34 : 46, color: 'var(--ink-1)', letterSpacing: '0.01em', minWidth: mobile ? 86 : 120, textAlign: 'center' }}>{PL_EN_MON[cursor.m]}</div>
        <button onClick={next} aria-label="Sonraki ay" style={chevStyle}><PLIco.chevR s={20} /></button>
        <button onClick={next} style={monthSideStyle}>{PL_MON_SHORT[nextM].toUpperCase()}</button>
      </div>

      {calMode === 'grid' ? (
        <PlMonthGrid cursor={cursor} byDay={byDay} ac={ac} mobile={mobile} mode={mode} onToggle={onToggle} onEdit={onEdit} onAdd={onAdd} />
      ) : days.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '50px 30px', textAlign: 'center' }}>
          <span style={{ width: 80, height: 80, borderRadius: '28%', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-3)' }}><PLIco.calendar s={36} /></span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-1)' }}>{PL_MON[cursor.m]} {cursor.y} boş</div>
            <div style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 500, marginTop: 5 }}>Bu ay için planlanmış görev yok.</div>
          </div>
          <PlBtn ico="plus" variant="primary" ac={ac} onClick={() => onAdd(today)}>Görev Ekle</PlBtn>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: mode === 'wide' ? '1fr 1fr' : '1fr', gap: 16 }}>
          {days.map((iso, idx) => (
            <PlDayCard key={iso} iso={iso} items={byDay.get(iso)!} color={PL_CAL_COLORS[idx % PL_CAL_COLORS.length]} idx={idx} mobile={mobile} isToday={iso === today} onToggle={onToggle} onEdit={onEdit} onAdd={onAdd} />
          ))}
        </div>
      )}
    </div>
  );
};

const PlDayCard = ({ iso, items, color, idx, mobile, isToday, onToggle, onEdit, onAdd }: any) => {
  const d = plParse(iso);
  const sorted = items.slice().sort((a: Task, b: Task) => (Number(a.done) - Number(b.done)) || ((a.time || '99').localeCompare(b.time || '99')));
  const doneN = items.filter((t: Task) => t.done).length;

  return (
    <div style={{ borderRadius: 'var(--radius-lg)', background: color.bg, boxShadow: isToday ? `var(--clay), 0 0 0 2px ${color.solid}` : 'var(--clay)', overflow: 'hidden', animation: `plPopIn ${240 + Math.min(idx, 10) * 60}ms var(--ease-fluid)` }}>
      <div style={{ display: 'flex', gap: mobile ? 14 : 18, padding: mobile ? 16 : 20 }}>
        <div style={{ flexShrink: 0, minWidth: mobile ? 78 : 96 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: color.ink, opacity: 0.85 }}>{PL_DOW_FULL[plDow(iso)]}</div>
          <div style={{ fontFamily: 'var(--serif)', fontWeight: 800, fontSize: mobile ? 52 : 64, lineHeight: 0.9, color: color.ink, marginTop: 2 }}>{d.getDate()}</div>
          <div style={{ fontFamily: 'var(--serif)', fontWeight: 700, fontSize: mobile ? 26 : 32, lineHeight: 1, color: color.ink, letterSpacing: '0.02em' }}>{PL_EN_MON[d.getMonth()]}</div>
          <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 'var(--radius-pill)', background: color.soft, color: color.ink, fontSize: 11.5, fontWeight: 800 }}>{doneN}/{items.length} bitti</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${color.ink}22`, paddingLeft: mobile ? 14 : 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
          {sorted.map((t: Task, i: number) => {
            const pri = PL_PRI[t.pri as keyof typeof PL_PRI];
            return (
              <div key={t.id} onClick={() => onEdit(t)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: mobile ? '9px 11px' : '10px 13px', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.5)', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.6)', cursor: 'pointer', opacity: t.done ? 0.6 : 1, animation: `plPopIn ${200 + i * 60}ms var(--ease-fluid)` }}>
                <button onClick={(e) => { e.stopPropagation(); onToggle(t.id); }} aria-label="Tamamla" style={{ all: 'unset', cursor: 'pointer', width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', boxSizing: 'border-box', background: t.done ? color.solid : 'rgba(255,255,255,0.7)', border: t.done ? 'none' : `2px solid ${color.ink}55`, color: '#fff' }}>{t.done && <PLIco.check s={13} />}</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</div>
                </div>
                {t.time && <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 800, color: color.ink, fontFamily: 'ui-monospace, monospace' }}>{t.time}</span>}
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: pri.solid, flexShrink: 0 }} />
              </div>
            );
          })}
          <button onClick={() => onAdd(iso)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start', marginTop: 2, padding: '7px 13px', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,0.4)', color: color.ink, fontSize: 12.5, fontWeight: 700 }}><PLIco.plus s={14} /> Ekle</button>
        </div>
      </div>
    </div>
  );
};

const PlMonthGrid = ({ cursor, byDay, ac, mobile, mode, onToggle, onEdit, onAdd }: any) => {
  const today = plToday();
  const pref = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
  const iso = (d: number) => `${pref}-${String(d).padStart(2, '0')}`;
  const first = new Date(cursor.y, cursor.m, 1);
  const startDow = (first.getDay() + 6) % 7;
  const dim = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const [sel, setSel] = React.useState(today.startsWith(pref) ? today : (byDay.size ? [...byDay.keys()].sort()[0] : iso(1)));
  React.useEffect(() => { setSel(today.startsWith(pref) ? today : (byDay.size ? [...byDay.keys()].sort()[0] : iso(1))); }, [cursor.y, cursor.m]); // eslint-disable-line

  const selItems = ((byDay.get(sel) || []) as Task[]).slice().sort((a, b) => (Number(a.done) - Number(b.done)) || ((a.time || '99').localeCompare(b.time || '99')));
  const selD = plParse(sel);
  const loadBooked = selItems.reduce((a, t) => a + plWorkMinutes(t.time, t.end), 0);
  const loadPct = Math.min(100, Math.round(loadBooked / 480 * 100));
  const loadCol = loadPct === 0 ? 'var(--water-solid)' : loadPct < 45 ? 'var(--water-solid)' : loadPct < 75 ? 'var(--sky)' : loadPct < 100 ? 'var(--amber)' : 'var(--danger)';
  const loadLbl = loadPct === 0 ? 'Boş' : loadPct < 45 ? 'Rahat' : loadPct < 75 ? 'Dengeli' : loadPct < 100 ? 'Yoğun' : 'Dolu';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: mode === 'wide' ? 'minmax(0,1.3fr) minmax(0,1fr)' : '1fr', gap: mobile ? 14 : 18, alignItems: 'start', animation: 'plFadeIn 280ms var(--ease-fluid)' }}>
      <div style={{ padding: mobile ? 14 : 18, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: mobile ? 4 : 7, marginBottom: 8 }}>
          {PL_DOW.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: mobile ? 4 : 7 }}>
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const isoS = iso(d), items = (byDay.get(isoS) || []) as Task[];
            const isT = isoS === today, isS = isoS === sel;
            const pris = [...new Set(items.map(t => t.pri))];
            const allDone = items.length > 0 && items.every(t => t.done);
            return (
              <button key={i} onClick={() => setSel(isoS)} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', aspectRatio: '1', minHeight: mobile ? 38 : 50, borderRadius: mobile ? 11 : 'var(--radius-sm)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                background: isS ? `linear-gradient(180deg, ${ac.accent}, ${ac.primary})` : isT ? `${ac.primary}14` : (items.length ? 'var(--surface-hi)' : 'transparent'),
                boxShadow: isS ? `0 8px 16px -7px ${ac.glow}` : (items.length && !isT ? 'var(--clay-flat)' : isT ? `inset 0 0 0 1.5px ${ac.primary}44` : 'none'), transition: 'all 200ms var(--ease-fluid)' }}>
                <span style={{ fontSize: mobile ? 13 : 14.5, fontWeight: isS || isT ? 800 : 600, color: isS ? '#fff' : isT ? ac.primary : (items.length ? 'var(--ink-1)' : 'var(--ink-3)') }}>{d}</span>
                {items.length > 0 && <div style={{ display: 'flex', gap: 3 }}>{allDone ? <span style={{ color: isS ? '#fff' : 'var(--water-deep)', display: 'inline-flex' }}><PLIco.check s={mobile ? 10 : 12} /></span> : pris.slice(0, 3).map(p => <span key={p} style={{ width: mobile ? 5 : 6, height: mobile ? 5 : 6, borderRadius: '50%', background: isS ? '#fff' : PL_PRI[p as keyof typeof PL_PRI].solid }} />)}</div>}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: mobile ? 16 : 18, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{plRelative(sel)}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-1)', marginTop: 2 }}>{selD.getDate()} {PL_MON[selD.getMonth()]}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px 7px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }} title={`Mesai doluluğu · ${loadBooked / 60}s / 8s`}>
            <PlRing pct={loadPct} size={38} thickness={5} color={loadCol} on />
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: loadCol }}>{loadLbl}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)' }}>09–17</div>
            </div>
          </div>
          <PlIconBtn onClick={() => onAdd(sel)} hot ac={ac} size={40} ariaLabel="Görev ekle"><PLIco.plus s={19} /></PlIconBtn>
        </div>
        {selItems.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '30px 16px', textAlign: 'center' }}>
            <span style={{ width: 52, height: 52, borderRadius: '28%', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-3)' }}><PLIco.calendar s={24} /></span>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>Bu gün için görev yok</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {selItems.map((t, i) => { const pri = PL_PRI[t.pri as keyof typeof PL_PRI]; return (
              <div key={t.id} onClick={() => onEdit(t)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-flat)', cursor: 'pointer', position: 'relative', overflow: 'hidden', opacity: t.done ? 0.65 : 1, animation: `plPopIn ${180 + i * 55}ms var(--ease-fluid)` }}>
                <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 4, borderRadius: 99, background: pri.solid }} />
                <PlCheck done={t.done} onClick={() => onToggle(t.id)} size={23} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-1)', textDecoration: t.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                  {t.time && <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}><PLIco.clock s={12} /> {t.time}</div>}
                </div>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: pri.solid, flexShrink: 0 }} />
              </div>
            ); })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlCalendar;
