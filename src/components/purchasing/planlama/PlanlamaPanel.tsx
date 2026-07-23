'use client';

import React from 'react';
import { Search, X, Plus, BarChart2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { createNotification } from '@/lib/notifications';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import {
  AC, PL_DOW, PL_MON, PL_PRI, PlStyles, PlIconBtn, PlToast, PlCheck, useContainerMode, uid,
  plToday, plParse, plRelative,
  type Task, type Mode, type SubTask, type TaskInvite,
} from './pl-primitives';
import PlList from './PlList';
import PlTaskModal from './PlTaskModal';
import PlAnalytics from './PlAnalytics';
import CalendarConnect from './CalendarConnect';

const COLLECTION = 'planlamaGorevler';

/* header (mobile actions, desktop keeps the canvas tabless) */
const PlHeader = ({ ac, mode, onSearch, onAdd, onAnalytics, calendarSlot }: any) => {
  const mobile = mode === 'mobile';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 8 : 12, marginBottom: mobile ? 18 : 22 }}>
      {mobile && (
        <>
          <div style={{ display: 'inline-flex', gap: 4, padding: 5, borderRadius: 'var(--radius-pill)', background: 'linear-gradient(180deg, var(--surface), var(--surface-2))', boxShadow: 'var(--clay-inset)' }}>
            <button style={{ all: 'unset', height: 42, padding: '0 18px', borderRadius: 'var(--radius-pill)', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 800, color: '#fff', background: 'linear-gradient(180deg, #4A4034, #3D382F)', boxShadow: 'var(--clay-flat)' }}>Bugün</button>
          </div>
          <div style={{ flex: 1 }} />
          {calendarSlot}
          <PlIconBtn onClick={onSearch} ac={ac} ariaLabel="Ara"><Search size={19} /></PlIconBtn>
          <PlIconBtn onClick={onAnalytics} ac={ac} ariaLabel="Analiz"><BarChart2 size={19} /></PlIconBtn>
          <PlIconBtn onClick={onAdd} hot ac={ac} ariaLabel="Görev ekle"><Plus size={22} /></PlIconBtn>
        </>
      )}
      {!mobile && (
        <>
          <div style={{ flex: 1 }} />
          {calendarSlot}
          <PlIconBtn onClick={onSearch} ac={ac} ariaLabel="Ara"><Search size={19} /></PlIconBtn>
          <PlIconBtn onClick={onAnalytics} ac={ac} ariaLabel="Analiz"><BarChart2 size={19} /></PlIconBtn>
          <PlIconBtn onClick={onAdd} hot ac={ac} ariaLabel="Görev ekle"><Plus size={22} /></PlIconBtn>
        </>
      )}
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
  labVisit: !!d.labVisit,
  laboratoryId: d.laboratoryId || '', laboratoryName: d.laboratoryName || '',
  laboratoryLat: typeof d.laboratoryLat === 'number' ? d.laboratoryLat : undefined,
  laboratoryLng: typeof d.laboratoryLng === 'number' ? d.laboratoryLng : undefined,
  invitations: Array.isArray(d.invitations) ? d.invitations : [],
  locationVerifiedAt: d.locationVerifiedAt,
  createdAt: typeof d.createdAt === 'number' ? d.createdAt : (d.createdAt?.toMillis?.() ?? 0),
});

const sortTasks = (arr: Task[]) => arr.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
const distanceInMeters = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const rad = (value: number) => value * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export default function PlanlamaPanel() {
  const { currentUser, currentCompanyId, currentUserProfile } = useAuth();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mode: Mode = useContainerMode(rootRef);

  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedDate, setSelectedDate] = React.useState(plToday());
  const [filter, setFilter] = React.useState<'today' | 'all' | 'done'>('today');
  const [taskModal, setTaskModal] = React.useState<any>(null);
  const [analytics, setAnalytics] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [toast, setToast] = React.useState<any>(null);
  const [laboratories, setLaboratories] = React.useState<{ id: string; name: string; lat?: number; lng?: number }[]>([]);
  const [personnel, setPersonnel] = React.useState<{ uid: string; name: string; role: string }[]>([]);
  const toastRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = (t: any) => {
    if (toastRef.current) clearTimeout(toastRef.current);
    setToast({ ...t, id: Date.now() });
    toastRef.current = setTimeout(() => setToast(null), 2400);
  };

  /* ── takvim entegrasyonu ─────────────────────────────────────────
     Bir kez bağlanan Google/Outlook takvimine görev senkronizasyonu.
     Bağlantı durumu CalendarConnect'ten yukarı taşınır; hiçbir takvim
     bağlı değilse sync çağrısı tümden atlanır (gereksiz istek yok). */
  const [calConnected, setCalConnected] = React.useState(false);
  const calConnectedRef = React.useRef(false);
  const [oauthSignal, setOauthSignal] = React.useState(0);
  React.useEffect(() => { calConnectedRef.current = calConnected; }, [calConnected]);

  const syncTask = React.useCallback(async (task: Task, action: 'upsert' | 'delete') => {
    if (!calConnectedRef.current) return;
    try {
      const token = await currentUser?.getIdToken();
      if (!token) return;
      const payload = {
        id: task.id, title: task.title, note: task.note, pri: task.pri,
        date: task.date, time: task.time, end: task.end, done: task.done,
        subs: (task.subs || []).map((s) => ({ title: s.title, done: s.done })),
      };
      await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, task: payload }),
      });
    } catch (e) {
      console.error('Takvim senkronizasyonu başarısız:', e);
    }
  }, [currentUser]);

  /* OAuth dönüşünü (?calendar=...) yakala: toast göster, URL'yi temizle,
     bağlantı durumunu yeniden oku. */
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const c = params.get('calendar');
    if (!c) return;
    const messages: Record<string, { tone?: string; title: string; sub?: string }> = {
      'google-connected': { tone: 'ok', title: 'Google Takvim bağlandı', sub: 'Görevleriniz artık takvime işlenecek' },
      'microsoft-connected': { tone: 'ok', title: 'Outlook Takvim bağlandı', sub: 'Görevleriniz artık takvime işlenecek' },
      'google-error': { title: 'Google Takvim bağlanamadı', sub: 'Lütfen tekrar deneyin' },
      'microsoft-error': { title: 'Outlook Takvim bağlanamadı', sub: 'Lütfen tekrar deneyin' },
      'google-unconfigured': { title: 'Google entegrasyonu yapılandırılmadı' },
      'microsoft-unconfigured': { title: 'Outlook entegrasyonu yapılandırılmadı' },
      'google-auth-required': { title: 'Oturum gerekli', sub: 'Lütfen tekrar giriş yapın' },
      'microsoft-auth-required': { title: 'Oturum gerekli', sub: 'Lütfen tekrar giriş yapın' },
    };
    if (messages[c]) fire(messages[c]);
    params.delete('calendar');
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '');
    window.history.replaceState(null, '', clean);
    setOauthSignal((v) => v + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  React.useEffect(() => {
    if (!currentUser || !currentCompanyId) return;
    const labs = onSnapshot(query(collection(db, 'hospitals'), where('companyId', '==', currentCompanyId)), (snap) => setLaboratories(snap.docs.map((item) => {
      const data = item.data(); return { id: item.id, name: data.name || data.ad || 'İsimsiz laboratuvar', lat: data.lat, lng: data.lng };
    })));
    const allowedRoles = new Set(['super_admin', 'admin', 'admin_developer', 'lojistik_sorumlusu', 'teknik_servis', 'aplikasyon', 'teknik_lojistik', 'satin_alma']);
    const users = onSnapshot(query(collection(db, 'users'), where('companyId', '==', currentCompanyId)), (snap) => setPersonnel(snap.docs.map((item) => ({ uid: item.id, name: item.data().name || item.data().email || 'İsimsiz kullanıcı', role: item.data().role || 'user' })).filter((person) => allowedRoles.has(person.role) && person.uid !== currentUser.uid)));
    return () => { labs(); users(); };
  }, [currentUser, currentCompanyId]);

  /* task operations → optimistic local update + Firestore write.
     Optimistic keeps the UI instant even if the snapshot round-trips. */
  const patchLocal = (id: string, fn: (t: Task) => Task) =>
    setTasks((cur) => cur.map((t) => (t.id === id ? fn(t) : t)));

  const toggleTask = async (id: string) => {
    const t = tasks.find((x) => x.id === id); if (!t) return;
    if (!t.done && t.labVisit) {
      if (typeof t.laboratoryLat !== 'number' || typeof t.laboratoryLng !== 'number') { fire({ title: 'Konum doğrulanamadı', sub: 'Laboratuvarın koordinat bilgisi tanımlı değil.' }); return; }
      if (!navigator.geolocation) { fire({ title: 'Konum doğrulanamadı', sub: 'Tarayıcınız konum hizmetini desteklemiyor.' }); return; }
      navigator.geolocation.getCurrentPosition(async (position) => {
        const distance = distanceInMeters(position.coords.latitude, position.coords.longitude, t.laboratoryLat!, t.laboratoryLng!);
        if (distance > 100) { fire({ title: 'Konum doğrulanamadı', sub: `${Math.round(distance)} m uzaktasınız; en fazla 100 m olmalıdır.` }); return; }
        patchLocal(id, (x) => ({ ...x, done: true, locationVerifiedAt: Date.now() }));
        await updateDoc(doc(db, COLLECTION, id), { done: true, locationVerifiedAt: serverTimestamp(), locationVerifiedLat: position.coords.latitude, locationVerifiedLng: position.coords.longitude, updatedAt: serverTimestamp() });
        syncTask({ ...t, done: true }, 'upsert'); fire({ tone: 'ok', title: 'Konum doğrulandı', sub: 'Laboratuvar ziyareti tamamlandı.' });
      }, () => fire({ title: 'Konum doğrulanamadı', sub: 'Konum izni vermeniz gerekiyor.' }), { enableHighAccuracy: true, timeout: 10000 });
      return;
    }
    patchLocal(id, (x) => ({ ...x, done: !x.done }));
    try { await updateDoc(doc(db, COLLECTION, id), { done: !t.done, updatedAt: serverTimestamp() }); }
    catch (e) { console.error(e); }
    syncTask({ ...t, done: !t.done }, 'upsert');
  };
  const toggleSub = async (tid: string, sid: string) => {
    const t = tasks.find((x) => x.id === tid); if (!t) return;
    const subs = t.subs.map((s) => s.id === sid ? { ...s, done: !s.done } : s);
    patchLocal(tid, (x) => ({ ...x, subs }));
    try { await updateDoc(doc(db, COLLECTION, tid), { subs, updatedAt: serverTimestamp() }); }
    catch (e) { console.error(e); }
    syncTask({ ...t, subs }, 'upsert');
  };
  const addSub = async (tid: string, title: string) => {
    const t = tasks.find((x) => x.id === tid); if (!t) return;
    const subs: SubTask[] = [...t.subs, { id: 's' + uid(), title, done: false }];
    patchLocal(tid, (x) => ({ ...x, subs }));
    try { await updateDoc(doc(db, COLLECTION, tid), { subs, updatedAt: serverTimestamp() }); }
    catch (e) { console.error(e); }
    syncTask({ ...t, subs }, 'upsert');
  };
  const delTask = async (id: string) => {
    const t = tasks.find((x) => x.id === id);
    setTasks((cur) => cur.filter((x) => x.id !== id));
    try { await deleteDoc(doc(db, COLLECTION, id)); fire({ title: 'Görev Silindi' }); }
    catch (e) { console.error(e); }
    if (t) syncTask(t, 'delete');
  };
  const saveTask = async (data: any) => {
    try {
      if (data.id) {
        patchLocal(data.id, (x) => ({ ...x, title: data.title, note: data.note, pri: data.pri, date: data.date, time: data.time || '', end: data.end || '', labVisit: data.labVisit, laboratoryId: data.laboratoryId, laboratoryName: data.laboratoryName, laboratoryLat: data.laboratoryLat, laboratoryLng: data.laboratoryLng, invitations: data.invitations }));
        await updateDoc(doc(db, COLLECTION, data.id), {
          title: data.title, note: data.note, pri: data.pri, date: data.date, time: data.time || '', end: data.end || '', labVisit: data.labVisit, laboratoryId: data.laboratoryId, laboratoryName: data.laboratoryName, laboratoryLat: data.laboratoryLat, laboratoryLng: data.laboratoryLng, invitations: data.invitations, updatedAt: serverTimestamp(),
        });
        fire({ tone: 'ok', title: 'Görev Güncellendi' });
        const prev = tasks.find((x) => x.id === data.id);
        syncTask({ id: data.id, title: data.title, note: data.note, pri: data.pri, date: data.date, time: data.time || '', end: data.end || '', done: !!prev?.done, subs: prev?.subs || [] }, 'upsert');
      } else {
        const now = Date.now();
        const ref = await addDoc(collection(db, COLLECTION), {
          title: data.title, note: data.note, pri: data.pri, date: data.date, time: data.time || '', end: data.end || '',
          labVisit: data.labVisit, laboratoryId: data.laboratoryId, laboratoryName: data.laboratoryName, laboratoryLat: data.laboratoryLat, laboratoryLng: data.laboratoryLng, invitations: data.invitations,
          done: false, subs: [], companyId: currentCompanyId, userId: currentUser?.uid || '',
          createdAt: now, updatedAt: serverTimestamp(),
        });
        fire({ tone: 'ok', title: 'Görev Eklendi', sub: data.title });
        await Promise.all((data.invitations || []).filter((invite: TaskInvite) => invite.status === 'pending').map((invite: TaskInvite) => createNotification({ type: 'custom', channel: 'push', title: 'Yeni görev daveti', message: `${currentUserProfile?.name || 'Bir kullanıcı'} sizi “${data.title}” görevine davet etti.`, href: '/satin-alma/planlama', actor: { uid: currentUser?.uid || 'system', name: currentUserProfile?.name || 'QORE' }, targets: [`user:${invite.uid}`], meta: { taskId: ref.id, invitation: true } })));
        syncTask({ id: ref.id, title: data.title, note: data.note, pri: data.pri, date: data.date, time: data.time || '', end: data.end || '', done: false, subs: [] }, 'upsert');
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

  const pad = mode === 'mobile' ? '16px 14px 100px' : mode === 'tablet' ? '22px 24px 64px' : '28px clamp(24px, 3vw, 52px) 64px';

  return (
    <div ref={rootRef} className="pl-root" style={{ minHeight: '100%', width: '100%' }}>
      <PlStyles />
      <div style={{ maxWidth: mode === 'wide' ? 'none' : 1080, margin: mode === 'wide' ? '0' : '0 auto', padding: pad }}>
        <PlHeader ac={AC} mode={mode}
          onSearch={() => setSearchOpen((v) => !v)} onAdd={() => setTaskModal({ presetDate: selectedDate })} onAnalytics={() => setAnalytics(true)}
          calendarSlot={<CalendarConnect ac={AC} compact={mode === 'mobile'} refreshSignal={oauthSignal} onConnectedChange={setCalConnected} />} />

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
          <div style={{ animation: 'plFadeIn 300ms var(--ease-fluid)', display: mode === 'wide' ? 'grid' : 'block', gridTemplateColumns: mode === 'wide' ? 'minmax(0, 1.45fr) minmax(360px, 0.55fr)' : undefined, gap: mode === 'wide' ? 28 : undefined, alignItems: 'start' }}>
            <PlList ac={AC} mode={mode} tasks={visible} filter={filter} setFilter={setFilter} selectedDate={selectedDate} setSelectedDate={setSelectedDate}
              onToggle={toggleTask} onToggleSub={toggleSub} onAddSub={addSub} onEdit={(t) => setTaskModal(t)} onDelete={delTask} onAdd={() => setTaskModal({ presetDate: selectedDate })} />
            {mode === 'wide' && <PlDesktopAside ac={AC} tasks={visible} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onToggle={toggleTask} onAdd={(d) => setTaskModal({ presetDate: d })} />}
          </div>
        )}
      </div>



      <PlTaskModal ac={AC} mode={mode} open={!!taskModal} task={taskModal} onClose={() => setTaskModal(null)} onSave={saveTask} onDelete={delTask} laboratories={laboratories} personnel={personnel} />
      <PlAnalytics ac={AC} mode={mode} open={analytics} tasks={tasks} onClose={() => setAnalytics(false)} />
      <PlToast toast={toast} ac={AC} />
    </div>
  );
}


const PlDesktopAside = ({ ac, tasks, selectedDate, setSelectedDate, onToggle, onAdd }: any) => {
  const d0 = plParse(selectedDate || plToday());
  const cursor = { y: d0.getFullYear(), m: d0.getMonth() };
  const pref = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
  const first = new Date(cursor.y, cursor.m, 1);
  const startDow = (first.getDay() + 6) % 7;
  const dim = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const byDay = new Map<string, Task[]>();
  tasks.forEach((t: Task) => { if (!byDay.has(t.date)) byDay.set(t.date, []); byDay.get(t.date)!.push(t); });
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const all = tasks.slice().sort((a: Task, b: Task) => a.date.localeCompare(b.date) || ((a.time || '99').localeCompare(b.time || '99')));
  return (
    <aside style={{ position: 'sticky', top: 18, display: 'flex', flexDirection: 'column', gap: 18, maxHeight: 'calc(100vh - 36px)' }}>
      <section style={{ padding: 22, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--ink-1)' }}>Takvim</h3>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-3)' }}>{PL_MON[cursor.m]} {cursor.y}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 7, marginBottom: 10 }}>
          {PL_DOW.map((d) => <div key={d} style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 800, color: 'var(--ink-3)' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 7 }}>
          {cells.map((day, i) => {
            if (day === null) return <div key={i} />;
            const iso = `${pref}-${String(day).padStart(2, '0')}`;
            const items = byDay.get(iso) || [];
            const isSel = iso === selectedDate;
            const isToday = iso === plToday();
            const allDone = items.length > 0 && items.every((t) => t.done);
            return (
              <button key={iso} onClick={() => setSelectedDate(iso)} style={{ all: 'unset', cursor: 'pointer', aspectRatio: '1', minHeight: 45, borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: isSel ? `linear-gradient(180deg, ${ac.accent}, ${ac.primary})` : isToday ? `${ac.primary}14` : (items.length ? 'var(--surface-hi)' : 'transparent'), boxShadow: isSel ? `0 8px 16px -7px ${ac.glow}` : (items.length ? 'var(--clay-flat)' : 'none'), color: isSel ? '#fff' : 'var(--ink-2)', transition: 'all 180ms var(--ease-fluid)' }}>
                <span style={{ fontSize: 14.5, fontWeight: 800 }}>{day}</span>
                {items.length > 0 && (allDone ? <span style={{ color: isSel ? '#fff' : 'var(--water-deep)', fontSize: 13, fontWeight: 900 }}>✓</span> : <span style={{ width: 6, height: 6, borderRadius: '50%', background: isSel ? '#fff' : ac.primary }} />)}
              </button>
            );
          })}
        </div>
      </section>
      <section style={{ flex: 1, minHeight: 0, padding: 22, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)', boxShadow: 'var(--clay)', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}><h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--ink-1)' }}>Tüm görevler</h3><div style={{ flex: 1 }} /><PlIconBtn onClick={() => onAdd(selectedDate)} hot ac={ac} size={38} ariaLabel="Görev ekle"><Plus size={18} /></PlIconBtn></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {all.map((t: Task) => { const pri = PL_PRI[t.pri]; return <div key={t.id} onClick={() => setSelectedDate(t.date)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 'var(--radius)', background: t.date === selectedDate ? `${ac.primary}14` : 'var(--surface-hi)', boxShadow: 'var(--clay-flat)', cursor: 'pointer', opacity: t.done ? 0.65 : 1 }}><PlCheck done={t.done} onClick={() => onToggle(t.id)} color={pri.solid} size={23} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</div><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', marginTop: 2 }}>{plRelative(t.date)}{t.time ? ` · ${t.time}` : ''}</div></div><span style={{ width: 8, height: 8, borderRadius: '50%', background: pri.solid }} /></div>; })}
        </div>
      </section>
    </aside>
  );
};
