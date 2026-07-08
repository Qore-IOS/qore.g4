'use client';

import React from 'react';
import { Search, X, Plus, BarChart2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import {
  AC, PlStyles, PlIconBtn, PlToast, useContainerMode, uid,
  type Task, type Mode, type SubTask,
} from './pl-primitives';
import PlList from './PlList';
import PlCalendar from './PlCalendar';
import PlTaskModal from './PlTaskModal';
import PlAnalytics from './PlAnalytics';

const COLLECTION = 'planlamaGorevler';

/* header (segmented Bugün/Takvim + action buttons) */
const PlHeader = ({ ac, mode, view, setView, onSearch, onAdd, onAnalytics }: any) => {
  const mobile = mode === 'mobile';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 8 : 12, marginBottom: mobile ? 18 : 22 }}>
      <div style={{ display: 'inline-flex', gap: 4, padding: 5, borderRadius: 'var(--radius-pill)', background: 'linear-gradient(180deg, var(--surface), var(--surface-2))', boxShadow: 'var(--clay-inset)' }}>
        {[{ v: 'list', l: 'Bugün' }, { v: 'cal', l: 'Takvim' }].map((o) => {
          const on = view === o.v;
          return (
            <button key={o.v} onClick={() => setView(o.v)} style={{ all: 'unset', cursor: 'pointer', height: 44, padding: mobile ? '0 18px' : '0 24px', borderRadius: 'var(--radius-pill)', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, color: on ? '#fff' : 'var(--ink-3)', background: on ? 'linear-gradient(180deg, #4A4034, #3D382F)' : 'transparent', boxShadow: on ? 'var(--clay-flat)' : 'none', transition: 'all 220ms var(--ease-fluid)' }}>{o.l}</button>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      <PlIconBtn onClick={onSearch} ac={ac} ariaLabel="Ara"><Search size={19} /></PlIconBtn>
      <PlIconBtn onClick={onAnalytics} ac={ac} ariaLabel="Analiz"><BarChart2 size={19} /></PlIconBtn>
      {!mobile && <PlIconBtn onClick={onAdd} hot ac={ac} ariaLabel="Görev ekle"><Plus size={22} /></PlIconBtn>}
    </div>
  );
};

const toTask = (id: string, d: any): Task => ({
  id,
  title: d.title || '',
  note: d.note || '',
  pri: d.pri || 'mid',
  date: d.date || '',
  time: d.time || '',
  end: d.end || '',
  done: !!d.done,
  subs: Array.isArray(d.subs) ? d.subs : [],
  createdAt: typeof d.createdAt === 'number' ? d.createdAt : (d.createdAt?.toMillis?.() ?? 0),
});

const sortTasks = (arr: Task[]) => arr.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

export default function PlanlamaPanel() {
  const { currentUser, currentCompanyId } = useAuth();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mode: Mode = useContainerMode(rootRef);

  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState<'list' | 'cal'>('list');
  const [filter, setFilter] = React.useState<'today' | 'all' | 'done'>('today');
  const [taskModal, setTaskModal] = React.useState<any>(null);
  const [analytics, setAnalytics] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [toast, setToast] = React.useState<any>(null);
  const toastRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = (t: any) => {
    if (toastRef.current) clearTimeout(toastRef.current);
    setToast({ ...t, id: Date.now() });
    toastRef.current = setTimeout(() => setToast(null), 2400);
  };

  /* Firestore subscription, company-scoped.
     No orderBy → no composite index needed, and pending local writes
     (latency compensation) surface immediately; we sort client-side. */
  React.useEffect(() => {
    if (!currentUser || !currentCompanyId) return;
    setLoading(true);
    const q = query(collection(db, COLLECTION), where('companyId', '==', currentCompanyId));
    const unsub = onSnapshot(q, (snap) => {
      setTasks(sortTasks(snap.docs.map((d) => toTask(d.id, d.data()))));
      setLoading(false);
    }, (err) => { console.error('PlanlamaPanel Firestore error:', err); setLoading(false); });
    return unsub;
  }, [currentUser, currentCompanyId]);

  /* task operations → optimistic local update + Firestore write.
     Optimistic keeps the UI instant even if the snapshot round-trips. */
  const patchLocal = (id: string, fn: (t: Task) => Task) =>
    setTasks((cur) => cur.map((t) => (t.id === id ? fn(t) : t)));

  const toggleTask = async (id: string) => {
    const t = tasks.find((x) => x.id === id); if (!t) return;
    patchLocal(id, (x) => ({ ...x, done: !x.done }));
    try { await updateDoc(doc(db, COLLECTION, id), { done: !t.done, updatedAt: serverTimestamp() }); }
    catch (e) { console.error(e); }
  };
  const toggleSub = async (tid: string, sid: string) => {
    const t = tasks.find((x) => x.id === tid); if (!t) return;
    const subs = t.subs.map((s) => s.id === sid ? { ...s, done: !s.done } : s);
    patchLocal(tid, (x) => ({ ...x, subs }));
    try { await updateDoc(doc(db, COLLECTION, tid), { subs, updatedAt: serverTimestamp() }); }
    catch (e) { console.error(e); }
  };
  const addSub = async (tid: string, title: string) => {
    const t = tasks.find((x) => x.id === tid); if (!t) return;
    const subs: SubTask[] = [...t.subs, { id: 's' + uid(), title, done: false }];
    patchLocal(tid, (x) => ({ ...x, subs }));
    try { await updateDoc(doc(db, COLLECTION, tid), { subs, updatedAt: serverTimestamp() }); }
    catch (e) { console.error(e); }
  };
  const delTask = async (id: string) => {
    setTasks((cur) => cur.filter((t) => t.id !== id));
    try { await deleteDoc(doc(db, COLLECTION, id)); fire({ title: 'Görev Silindi' }); }
    catch (e) { console.error(e); }
  };
  const saveTask = async (data: any) => {
    try {
      if (data.id) {
        patchLocal(data.id, (x) => ({ ...x, title: data.title, note: data.note, pri: data.pri, date: data.date, time: data.time || '', end: data.end || '' }));
        await updateDoc(doc(db, COLLECTION, data.id), {
          title: data.title, note: data.note, pri: data.pri, date: data.date, time: data.time || '', end: data.end || '', updatedAt: serverTimestamp(),
        });
        fire({ tone: 'ok', title: 'Görev Güncellendi' });
      } else {
        const now = Date.now();
        await addDoc(collection(db, COLLECTION), {
          title: data.title, note: data.note, pri: data.pri, date: data.date, time: data.time || '', end: data.end || '',
          done: false, subs: [], companyId: currentCompanyId, userId: currentUser?.uid || '',
          createdAt: now, updatedAt: serverTimestamp(),
        });
        fire({ tone: 'ok', title: 'Görev Eklendi', sub: data.title });
      }
    } catch (e) { console.error(e); }
  };

  /* keyboard shortcuts */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
      if (e.key === 'Escape') {
        if (taskModal) setTaskModal(null);
        else if (analytics) setAnalytics(false);
        else if (searchOpen) { setSearchOpen(false); setSearch(''); }
        return;
      }
      if (typing) return;
      const k = e.key?.toLowerCase();
      if (k === 'n') { e.preventDefault(); setTaskModal({}); }
      else if (k === 's' || e.key === '/') { e.preventDefault(); setSearchOpen((v) => !v); }
      else if (k === 'a') { e.preventDefault(); setAnalytics((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [taskModal, analytics, searchOpen]);

  const visible = searchOpen && search.trim()
    ? tasks.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()) || (t.note || '').toLowerCase().includes(search.toLowerCase()))
    : tasks;

  const pad = mode === 'mobile' ? '16px 14px 100px' : mode === 'tablet' ? '22px 24px 64px' : '28px 34px 64px';

  return (
    <div ref={rootRef} className="pl-root" style={{ minHeight: '100%', width: '100%' }}>
      <PlStyles />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: pad }}>
        <PlHeader ac={AC} mode={mode} view={view} setView={setView}
          onSearch={() => setSearchOpen((v) => !v)} onAdd={() => setTaskModal({})} onAnalytics={() => setAnalytics(true)} />

        {searchOpen && (
          <div style={{ position: 'relative', marginBottom: 16, animation: 'plPopIn 240ms var(--ease-fluid)' }}>
            <span style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', display: 'inline-flex' }}><Search size={18} /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Görev ara…" autoFocus
              style={{ width: '100%', boxSizing: 'border-box', height: 52, padding: '0 48px', borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-1)', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', outline: 'none' }} />
            <button onClick={() => { setSearch(''); setSearchOpen(false); }} aria-label="Aramayı kapat" style={{ all: 'unset', cursor: 'pointer', position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--ink-3)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-flat)' }}><X size={16} /></button>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 20px' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.4em', color: 'var(--ink-3)', textTransform: 'uppercase', animation: 'plBob 1.6s ease-in-out infinite' }}>Yükleniyor</span>
          </div>
        ) : (
          <div key={view} style={{ animation: 'plFadeIn 300ms var(--ease-fluid)' }}>
            {view === 'list'
              ? <PlList ac={AC} mode={mode} tasks={visible} filter={filter} setFilter={setFilter}
                  onToggle={toggleTask} onToggleSub={toggleSub} onAddSub={addSub} onEdit={(t) => setTaskModal(t)} onDelete={delTask} onAdd={() => setTaskModal({})} />
              : <PlCalendar ac={AC} mode={mode} tasks={tasks} onToggle={toggleTask} onEdit={(t) => setTaskModal(t)} onAdd={(d) => setTaskModal({ presetDate: d })} />}
          </div>
        )}
      </div>

      {mode === 'mobile' && (
        <button onClick={() => setTaskModal({})} aria-label="Görev ekle" style={{ all: 'unset', cursor: 'pointer', position: 'fixed', right: 18, bottom: 22, zIndex: 500, width: 60, height: 60, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(circle at 32% 28%, ${AC.accent}, ${AC.primary})`, boxShadow: `0 16px 30px -8px ${AC.glow}, inset 0 1px 0 rgba(255,255,255,0.35)`, animation: 'plPopIn 400ms var(--ease-fluid)' }}><Plus size={26} /></button>
      )}

      <PlTaskModal ac={AC} mode={mode} open={!!taskModal} task={taskModal} onClose={() => setTaskModal(null)} onSave={saveTask} onDelete={delTask} />
      <PlAnalytics ac={AC} mode={mode} open={analytics} tasks={tasks} onClose={() => setAnalytics(false)} />
      <PlToast toast={toast} ac={AC} />
    </div>
  );
}
