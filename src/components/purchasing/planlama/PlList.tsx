'use client';

import React from 'react';
import {
  PL_PRI, PL_EN_MON, PL_MON, PL_DOW_FULL, PLIco, PlCheck, PlBtn,
  plToday, plParse, plDow, plRelative, plAddMin, plWorkMinutes, plDurLabel,
  type Task, type Mode, type Accent,
} from './pl-primitives';

type Filter = 'today' | 'all' | 'done';

interface ListProps {
  ac: Accent; mode: Mode; tasks: Task[];
  filter: Filter; setFilter: (f: Filter) => void;
  selectedDate?: string; setSelectedDate?: (date: string) => void;
  onToggle: (id: string) => void; onToggleSub: (tid: string, sid: string) => void;
  onAddSub: (tid: string, title: string) => void;
  onEdit: (t: Task) => void; onDelete: (id: string) => void; onAdd: () => void;
}

const PlList: React.FC<ListProps> = ({ ac, mode, tasks, filter, setFilter, selectedDate, setSelectedDate, onToggle, onToggleSub, onAddSub, onEdit, onDelete, onAdd }) => {
  const mobile = mode === 'mobile';
  const today = selectedDate || plToday();
  const td = plParse(today);
  const now = new Date();
  const clock = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  const todays = tasks.filter(t => t.date === today);
  const openCount = todays.filter(t => !t.done).length;

  let rows: Task[];
  if (filter === 'today') rows = todays;
  else if (filter === 'done') rows = tasks.filter(t => t.done);
  else rows = tasks.filter(t => !t.done);

  const w: Record<string, number> = { high: 0, mid: 1, low: 2 };
  rows = rows.slice().sort((a, b) =>
    (Number(a.done) - Number(b.done)) || a.date.localeCompare(b.date) ||
    ((a.time || '99').localeCompare(b.time || '99')) || (w[a.pri] - w[b.pri]));

  const scopes: { v: Filter; l: string }[] = [{ v: 'today', l: 'Bugün' }, { v: 'all', l: 'Açık' }, { v: 'done', l: 'Tamamlanan' }];
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  const shiftDay = (delta: number) => {
    if (!setSelectedDate) return;
    const d = plParse(today);
    d.setDate(d.getDate() + delta);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setSelectedDate(iso);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(18);
  };
  const swipeHandlers = mobile ? {
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; touchStart.current = { x: t.clientX, y: t.clientY }; },
    onTouchEnd: (e: React.TouchEvent) => {
      const st = touchStart.current; if (!st) return;
      const t = e.changedTouches[0]; const dx = t.clientX - st.x; const dy = t.clientY - st.y;
      if (Math.abs(dx) > 58 && Math.abs(dx) > Math.abs(dy) * 1.35) shiftDay(dx < 0 ? 1 : -1);
      touchStart.current = null;
    },
  } : {};

  return (
    <div {...swipeHandlers} style={{ touchAction: mobile ? 'pan-y' : undefined, animation: mobile ? 'plSlideDay 260ms var(--ease-fluid)' : undefined }}>
      {/* serif date hero */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: mobile ? 16 : 28, marginBottom: mobile ? 22 : 30, padding: '4px 4px 0' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: mobile ? 16 : 19, fontWeight: 700, color: 'var(--ink-1)', letterSpacing: '-0.01em', marginBottom: mobile ? -2 : -4 }}>{PL_DOW_FULL[plDow(today)]}</div>
          <div style={{ fontFamily: 'var(--serif)', fontWeight: 800, fontSize: mobile ? 76 : 110, lineHeight: 0.92, color: 'var(--ink-1)', letterSpacing: '-0.02em' }}>{td.getDate()}</div>
          <div style={{ fontFamily: 'var(--serif)', fontWeight: 700, fontSize: mobile ? 50 : 72, lineHeight: 0.95, color: 'var(--ink-1)', letterSpacing: '0.01em' }}>{PL_EN_MON[td.getMonth()]}</div>
        </div>
        <div style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: mobile ? '6px 0' : '10px 0' }} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: mobile ? 18 : 26, minWidth: mobile ? 96 : 130 }}>
          <div>
            <div style={{ fontSize: mobile ? 19 : 23, fontWeight: 800, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>{clock}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', marginTop: 2 }}>{PL_MON[td.getMonth()]} {td.getFullYear()}</div>
          </div>
          <div>
            <div style={{ fontSize: mobile ? 19 : 23, fontWeight: 800, color: openCount ? ac.primary : 'var(--water-deep)', letterSpacing: '-0.01em' }}>{openCount} görev</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', marginTop: 2 }}>{openCount ? 'bugün açık' : 'hepsi tamam'}</div>
          </div>
        </div>
      </div>

      <PlDayLoad mobile={mobile} tasks={todays} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: mobile ? 19 : 22, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--ink-1)' }}>
          {filter === 'today' ? 'Bugünün görevleri' : filter === 'done' ? 'Tamamlananlar' : 'Açık görevler'}
        </h2>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 'var(--radius-pill)', background: 'linear-gradient(180deg, var(--surface), var(--surface-2))', boxShadow: 'var(--clay-inset)' }}>
          {scopes.map(s => {
            const on = filter === s.v;
            return (
              <button key={s.v} onClick={() => setFilter(s.v)} style={{ all: 'unset', cursor: 'pointer', height: 34, padding: '0 14px', borderRadius: 'var(--radius-pill)', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 700, color: on ? 'var(--ink-1)' : 'var(--ink-3)', background: on ? 'var(--surface-hi)' : 'transparent', boxShadow: on ? 'var(--clay-flat)' : 'none', transition: 'all 200ms var(--ease-fluid)', whiteSpace: 'nowrap' }}>{s.l}</button>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <PlEmpty ac={ac} onAdd={onAdd} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: mode === 'wide' ? '1fr 1fr' : '1fr', gap: 14 }}>
          {rows.map((t, i) => (
            <PlMeetingCard key={t.id} t={t} i={i} ac={ac} mobile={mobile} showDate={filter !== 'today'}
              onToggle={() => onToggle(t.id)} onToggleSub={(sid) => onToggleSub(t.id, sid)}
              onAddSub={(title) => onAddSub(t.id, title)} onEdit={() => onEdit(t)} onDelete={() => onDelete(t.id)} />
          ))}
        </div>
      )}
    </div>
  );
};

const PlMeetingCard = ({ t, i, ac, mobile, showDate, onToggle, onToggleSub, onAddSub, onEdit, onDelete }: any) => {
  const pri = PL_PRI[t.pri as keyof typeof PL_PRI];
  const [open, setOpen] = React.useState(false);
  const [subInput, setSubInput] = React.useState('');
  const subDone = t.subs.filter((s: any) => s.done).length;
  const subPct = t.subs.length ? Math.round(subDone / t.subs.length * 100) : 0;
  const start = t.time || '';
  const end = t.end || (t.time ? plAddMin(t.time, 30) : '');
  const durLabel = plDurLabel(t.time, t.end);
  const submit = () => { const v = subInput.trim(); if (v) { onAddSub(v); setSubInput(''); } };

  return (
    <div style={{ borderRadius: 'var(--radius-lg)', background: pri.card, boxShadow: open ? `var(--clay), 0 0 0 1.5px ${pri.solid}66` : 'var(--clay)', overflow: 'hidden', transition: 'box-shadow 300ms var(--ease-fluid)', animation: `plPopIn ${240 + Math.min(i, 10) * 50}ms var(--ease-fluid)`, opacity: t.done ? 0.66 : 1 }}>
      <div onClick={() => setOpen((o: boolean) => !o)} style={{ position: 'relative', padding: mobile ? 17 : 20, cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
          <PlCheck done={t.done} onClick={onToggle} color={pri.solid} size={mobile ? 26 : 28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: mobile ? 18 : 20, fontWeight: 800, color: '#41382b', lineHeight: 1.2, letterSpacing: '-0.01em', textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</div>
            {t.note && <div style={{ fontSize: 13, color: 'rgba(65,56,43,0.66)', fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.note}</div>}
          </div>
          <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,0.55)', color: pri.ink, fontSize: 12, fontWeight: 800, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}>
            {t.pri === 'high' ? <PLIco.bolt s={12} /> : <span style={{ width: 7, height: 7, borderRadius: '50%', background: pri.solid }} />}{pri.label}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: mobile ? 16 : 18, paddingTop: mobile ? 14 : 16, borderTop: '1px solid rgba(65,56,43,0.12)' }}>
          {start ? (
            <>
              <div>
                <div style={{ fontSize: mobile ? 17 : 19, fontWeight: 800, color: '#41382b', letterSpacing: '-0.01em' }}>{start}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(65,56,43,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Başlangıç</div>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 'var(--radius-pill)', background: '#41382b', color: '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {t.subs.length ? <><PLIco.sub s={12} /> {subDone}/{t.subs.length}</> : <><PLIco.clock s={12} /> {durLabel}</>}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: mobile ? 17 : 19, fontWeight: 800, color: '#41382b', letterSpacing: '-0.01em' }}>{end}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(65,56,43,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Bitiş</div>
              </div>
            </>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,0.5)', color: '#41382b', fontSize: 12.5, fontWeight: 700 }}><PLIco.calendar s={13} /> Tüm gün{t.subs.length ? ` · ${subDone}/${t.subs.length} alt görev` : ''}</span>
          )}
          {showDate && <span style={{ marginLeft: start ? 0 : 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,0.5)', color: '#41382b', fontSize: 12, fontWeight: 700 }}>{plRelative(t.date)}</span>}
        </div>
      </div>

      {open && (
        <div style={{ padding: mobile ? '0 17px 17px' : '0 20px 20px', animation: 'plPopIn 240ms var(--ease-fluid)' }}>
          <div style={{ background: 'rgba(255,255,255,0.55)', borderRadius: 'var(--radius)', padding: 14, boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.6)' }}>
            {t.subs.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1, height: 7, borderRadius: 99, background: 'rgba(65,56,43,0.12)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${subPct}%`, borderRadius: 99, background: '#41382b', transition: 'width 500ms var(--ease-fluid)' }} />
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#41382b' }}>%{subPct}</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {t.subs.map((s: any) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.6)' }}>
                  <PlCheck done={s.done} onClick={() => onToggleSub(s.id)} size={21} />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: s.done ? 'rgba(65,56,43,0.5)' : '#41382b', textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(65,56,43,0.06)' }}>
                <span style={{ color: '#41382b', display: 'inline-flex', opacity: 0.7 }}><PLIco.plus s={17} /></span>
                <input value={subInput} onChange={(e) => setSubInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Alt görev ekle…"
                  style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 14, fontWeight: 500, color: '#41382b', fontFamily: 'inherit', outline: 'none' }} />
                {subInput.trim() && <button onClick={submit} style={{ all: 'unset', cursor: 'pointer', padding: '5px 12px', borderRadius: 'var(--radius-pill)', background: '#41382b', color: '#fff', fontSize: 12.5, fontWeight: 700 }}>Ekle</button>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={onEdit} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 15px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.7)', color: '#41382b', fontSize: 13, fontWeight: 700 }}><PLIco.edit s={15} /> Düzenle</button>
              <button onClick={onDelete} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 15px', borderRadius: 'var(--radius-sm)', background: 'rgba(192,121,106,0.18)', color: '#9a4936', fontSize: 13, fontWeight: 700 }}><PLIco.trash s={15} /> Sil</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PlDayLoad = ({ mobile, tasks }: { mobile: boolean; tasks: Task[] }) => {
  const WORK = 480;
  const timed = tasks.filter(t => t.time);
  const booked = timed.reduce((a, t) => a + plWorkMinutes(t.time, t.end), 0);
  const pct = Math.min(100, Math.round(booked / WORK * 100));
  const state = pct === 0 ? { l: 'Boş gün', c: 'var(--water-deep)', bg: 'rgba(111,181,133,0.14)', ico: 'check', msg: 'Henüz saatli görev yok' }
    : pct < 45 ? { l: 'Rahat', c: 'var(--water-deep)', bg: 'rgba(111,181,133,0.14)', ico: 'check', msg: 'Günün bol boş zamanı var' }
    : pct < 75 ? { l: 'Dengeli', c: 'var(--sky)', bg: 'rgba(124,168,222,0.16)', ico: 'clock', msg: 'Akışında, kontrollü bir gün' }
    : pct < 100 ? { l: 'Yoğun', c: '#9A6F1E', bg: 'var(--amber-soft)', ico: 'bolt', msg: 'Gün hızlı doluyor' }
    : { l: 'Dolu', c: 'var(--danger)', bg: 'rgba(192,121,106,0.16)', ico: 'bolt', msg: 'Mesai neredeyse tamamen dolu' };
  const SI = PLIco[state.ico];
  const slots = WORK / 30;
  const filled = Math.round(pct / 100 * slots);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 12 : 16, padding: mobile ? '14px 15px' : '15px 18px', marginBottom: mobile ? 16 : 18, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)', animation: 'plPopIn 320ms var(--ease-fluid)' }}>
      <span style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 13, display: 'grid', placeItems: 'center', color: state.c, background: state.bg, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><SI s={20} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 6 }}>
          <span style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--ink-1)', whiteSpace: 'nowrap' }}>Gün doluluğu</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: state.bg, color: state.c, fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap' }}>{state.l} · %{pct}</span>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginTop: 3 }}>09:00–17:00 mesai</div>
        <div style={{ display: 'flex', gap: 3, marginTop: 9 }}>
          {Array.from({ length: slots }).map((_, i) => (
            <span key={i} style={{ flex: 1, height: 8, borderRadius: 3, background: i < filled ? state.c : 'var(--surface-2)', boxShadow: i < filled ? 'none' : 'var(--clay-inset)', opacity: i < filled ? 1 : 0.8, transition: `background 400ms ${i * 35}ms var(--ease-fluid)` }} />
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginTop: 7 }}>{state.msg} · {Number.isInteger(booked / 60) ? booked / 60 : (booked / 60).toFixed(1)}s / 8s planlı</div>
      </div>
    </div>
  );
};

const PlEmpty = ({ ac, onAdd }: any) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '60px 30px', textAlign: 'center', animation: 'plPopIn 320ms var(--ease-fluid)' }}>
    <div style={{ width: 88, height: 88, borderRadius: '30%', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: ac.primary, animation: 'plBob 2.6s ease-in-out infinite' }}><PLIco.inbox s={40} /></div>
    <div>
      <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink-1)' }}>Burada görev yok</div>
      <div style={{ fontSize: 14.5, color: 'var(--ink-2)', fontWeight: 500, marginTop: 6 }}>Yeni bir görev ekleyerek planlamaya başla.</div>
    </div>
    <PlBtn ico="plus" variant="primary" ac={ac} onClick={onAdd}>Görev Ekle</PlBtn>
  </div>
);

export default PlList;
