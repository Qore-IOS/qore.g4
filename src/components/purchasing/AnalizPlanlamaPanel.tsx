'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { Hospital, PurchasingTask, User } from '@/lib/types';
import { ArrowLeft, Building2, FileText, ImageIcon, Flame, CalendarDays, Sparkles, CircleCheckBig } from 'lucide-react';
import { endOfDay, endOfWeek, format, isAfter, isBefore, parseISO, startOfDay, startOfMonth, startOfWeek, endOfMonth, subMonths } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const HOURS = Array.from({ length: 9 }, (_, i) => 9 + i); // 09..17
const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function getHeatColor(value: number, max: number): string {
  if (value === 0) return 'bg-emerald-500/15 border-emerald-500/20';
  const ratio = max > 0 ? value / max : 0;
  if (ratio < 0.34) return 'bg-yellow-500/25 border-yellow-500/30';
  if (ratio < 0.67) return 'bg-orange-500/35 border-orange-500/40';
  return 'bg-red-500/45 border-red-500/50';
}

export default function AnalizPlanlamaPanel() {
  const { currentUserProfile } = useAuth();
  const [tasks, setTasks] = useState<PurchasingTask[]>([]);
  const [labs, setLabs] = useState<Hospital[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [heatmapMode, setHeatmapMode] = useState<'weekly' | 'monthly'>('weekly');
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [personalCalendarMode, setPersonalCalendarMode] = useState<'weekly' | 'monthly'>('weekly');

  useEffect(() => {
    const q = query(collection(db, 'purchasingTasks'), orderBy('date', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PurchasingTask[];
        setTasks(items);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    async function fetchRefs() {
      const [labSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(query(collection(db, 'users'), where('role', 'in', ['admin', 'satin_alma']))),
      ]);
      setLabs(labSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)));
      setUsers(usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() } as User)));
    }
    fetchRefs();
  }, []);

  const visitTasks = useMemo(
    () => tasks.filter((t) => (t.taskType === 'kurum_ziyareti' || !!t.laboratoryId) && !!t.laboratoryId),
    [tasks]
  );

  const selectableLabs = useMemo(() => {
    const used = new Set(visitTasks.map((t) => t.laboratoryId).filter(Boolean));
    return labs.filter((l) => used.has(l.id));
  }, [labs, visitTasks]);

  useEffect(() => {
    if (!selectedLabId && selectableLabs.length > 0) setSelectedLabId(selectableLabs[0].id);
  }, [selectableLabs, selectedLabId]);

  const selectedLabVisits = useMemo(
    () => visitTasks.filter((t) => t.laboratoryId === selectedLabId).sort((a, b) => (a.date > b.date ? -1 : 1)),
    [visitTasks, selectedLabId]
  );

  const sixMonthMetrics = useMemo(() => {
    const now = new Date();
    const sixMonthsAgo = subMonths(now, 6);
    const visits = selectedLabVisits.filter((t) => {
      const d = parseISO(t.date);
      return isAfter(d, sixMonthsAgo) && isBefore(d, endOfDay(now));
    });

    const lastVisit = selectedLabVisits.find((t) => isBefore(parseISO(t.date), endOfDay(now)));
    const nextVisit = selectedLabVisits
      .filter((t) => !isBefore(parseISO(t.date), startOfDay(now)))
      .sort((a, b) => (a.date > b.date ? 1 : -1))[0];

    return { visits, lastVisit, nextVisit };
  }, [selectedLabVisits]);

  const labNotesAndFiles = useMemo(() => {
    return selectedLabVisits.slice(0, 12).map((t) => ({
      id: t.id,
      date: t.date,
      by: t.createdByName,
      comments: t.comments || [],
      attachments: t.attachments || [],
    }));
  }, [selectedLabVisits]);

  const heatmapDays = useMemo(() => {
    const now = new Date();
    if (heatmapMode === 'weekly') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - (6 - i));
        return d;
      });
    }
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (29 - i));
      return d;
    });
  }, [heatmapMode]);

  useEffect(() => {
    if (currentUserProfile?.uid) {
      setSelectedUserId((prev) => (prev === 'all' ? currentUserProfile.uid : prev));
    }
  }, [currentUserProfile?.uid]);

  const personalCalendar = useMemo(() => {
    if (!currentUserProfile?.uid) {
      return { tasks: [] as PurchasingTask[], rangeLabel: '-' };
    }

    const now = new Date();
    const start = personalCalendarMode === 'weekly'
      ? startOfWeek(now, { weekStartsOn: 1 })
      : startOfMonth(now);
    const end = personalCalendarMode === 'weekly'
      ? endOfWeek(now, { weekStartsOn: 1 })
      : endOfMonth(now);

    const mine = tasks
      .filter((t) => {
        const taskDate = parseISO(t.date);
        const isMine =
          t.createdByUid === currentUserProfile.uid ||
          (t.assignedPersonnel || []).some((p) => p.uid === currentUserProfile.uid) ||
          (t.accompanyingPersonnel || []).some((p) => p.uid === currentUserProfile.uid);

        return isMine && !t.completed && taskDate >= start && taskDate <= end;
      })
      .sort((a, b) => (a.date === b.date ? (a.startTime > b.startTime ? 1 : -1) : a.date > b.date ? 1 : -1));

    return {
      tasks: mine,
      rangeLabel: `${format(start, 'd MMM', { locale: tr })} - ${format(end, 'd MMM yyyy', { locale: tr })}`,
    };
  }, [tasks, currentUserProfile?.uid, personalCalendarMode]);

  const heatmapData = useMemo(() => {
    const filtered = selectedUserId === 'all'
      ? tasks
      : tasks.filter(
          (t) =>
            t.createdByUid === selectedUserId ||
            (t.assignedPersonnel || []).some((p) => p.uid === selectedUserId) ||
            (t.accompanyingPersonnel || []).some((p) => p.uid === selectedUserId)
        );

    const matrix = heatmapDays.map((day) => {
      const dayStr = format(day, 'yyyy-MM-dd');
      return HOURS.map((hour) => {
        const slotStart = hour * 60;
        const slotEnd = (hour + 1) * 60;
        let count = 0;
        filtered.forEach((t) => {
          if (t.date !== dayStr || t.completed) return;
          const ts = parseTime(t.startTime);
          const te = parseTime(t.endTime);
          if (slotStart < te && slotEnd > ts) count += 1;
        });
        return count;
      });
    });

    const max = Math.max(0, ...matrix.flat());
    return { matrix, max };
  }, [tasks, heatmapDays, selectedUserId]);

  return (
    <div className="fluid-editorial min-h-screen pb-20 relative overflow-x-hidden">
      {/* Ambient depth blobs */}
      <div className="fluid-blob-1 -top-20 -right-16 opacity-60" />
      <div className="fluid-blob-2 top-[50%] -left-20 opacity-50" />

      <div className="sticky top-0 z-20 satin-glass-header" style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 md:py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/satin-alma"
              className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all active:scale-95 fluid-card-tap"
              style={{ background: 'rgba(0,107,104,0.08)', color: '#006b68' }}
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#006b68' }}>Satın Alma Birimi</p>
              <h1 className="text-xl md:text-3xl font-extrabold tracking-tight" style={{ color: '#2c3432' }}>Planlama Akışı</h1>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: 'rgba(0,107,104,0.08)' }}>
            <Sparkles className="w-4 h-4 text-[#006b68]" />
            <span className="text-xs font-bold text-[#006b68]">Tek Dokunuş Operasyon Modu</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="px-4 md:px-8 py-12">
          <div className="max-w-7xl mx-auto space-y-5">
            {/* Hero skeleton */}
            <div className="rounded-[2rem] h-40 animate-pulse" style={{ background: 'linear-gradient(135deg, rgba(0,107,104,0.15) 0%, rgba(118,221,216,0.15) 100%)' }} />
            {/* Two-col skeleton */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <div className="rounded-[2rem] h-56 bg-white animate-pulse shadow-[0_8px_32px_rgba(44,52,50,0.05)]" />
              <div className="rounded-[2rem] h-56 bg-white animate-pulse shadow-[0_8px_32px_rgba(44,52,50,0.05)]" />
            </div>
            {/* Full-width skeletons */}
            <div className="rounded-[2rem] h-48 bg-white animate-pulse shadow-[0_8px_32px_rgba(44,52,50,0.05)]" />
            <div className="rounded-[2rem] h-48 bg-white animate-pulse shadow-[0_8px_32px_rgba(44,52,50,0.05)]" />
          </div>
        </div>
      ) : (
        <div className="px-4 md:px-8 py-6 md:py-8">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* ── Hero: Kişisel Plan Özeti ── */}
            <section className="relative overflow-hidden rounded-[2rem] p-6 md:p-8 satin-hero-card shadow-[0_24px_70px_rgba(0,107,104,0.24)]"
              style={{ background: 'linear-gradient(135deg, #006b68 0%, #76ddd8 100%)', color: '#e1fffd' }}>
              {/* Decorative blobs */}
              <div className="absolute -top-16 -right-10 h-52 w-52 rounded-full bg-white/10 blur-3xl pointer-events-none" />
              <div className="absolute bottom-0 left-8 h-32 w-32 rounded-full bg-white/5 blur-2xl pointer-events-none" />

              <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] opacity-80 mb-2 font-bold">Kişisel Plan Özeti</p>
                  <h2 className="text-3xl md:text-5xl font-extrabold leading-[1.05] tracking-tight">
                    {personalCalendar.tasks.length}
                    <span className="text-xl md:text-3xl font-semibold opacity-80 ml-3">aktif görev</span>
                  </h2>
                  <p className="mt-3 text-sm md:text-base opacity-80 font-medium">{personalCalendar.rangeLabel}</p>
                </div>
                <div className="inline-flex rounded-full p-1 backdrop-blur-xl self-start" style={{ background: 'rgba(255,255,255,0.15)' }}>
                  <button
                    onClick={() => setPersonalCalendarMode('weekly')}
                    className={cn(
                      'px-4 py-2 text-xs md:text-sm rounded-full font-bold transition-all active:scale-95',
                      personalCalendarMode === 'weekly' ? 'bg-white text-[#005654] shadow-md' : 'text-white/90 hover:text-white'
                    )}
                  >
                    1 Hafta
                  </button>
                  <button
                    onClick={() => setPersonalCalendarMode('monthly')}
                    className={cn(
                      'px-4 py-2 text-xs md:text-sm rounded-full font-bold transition-all active:scale-95',
                      personalCalendarMode === 'monthly' ? 'bg-white text-[#005654] shadow-md' : 'text-white/90 hover:text-white'
                    )}
                  >
                    1 Ay
                  </button>
                </div>
              </div>
            </section>

            {/* ── Two-col grid: Kişisel Takvim + Lab Ziyaretleri ── */}
            <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">

              {/* Kişisel Takvim */}
              <section className="rounded-[2rem] bg-white p-5 md:p-6 shadow-[0_8px_32px_rgba(44,52,50,0.06)]">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,107,104,0.10)' }}>
                      <CalendarDays className="w-4 h-4 text-[#006b68]" />
                    </div>
                    <h3 className="text-lg md:text-xl font-bold" style={{ color: '#2c3432' }}>Kişisel Takvim</h3>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                    style={{ background: 'rgba(0,107,104,0.08)', color: '#006b68' }}>
                    <CircleCheckBig className="w-3.5 h-3.5" />
                    {personalCalendar.tasks.length} görev
                  </span>
                </div>

                <div className="space-y-2.5 max-h-[24rem] overflow-y-auto pr-1">
                  {personalCalendar.tasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 rounded-[1.5rem]"
                      style={{ background: '#f7faf8' }}>
                      <CalendarDays className="w-8 h-8 mb-3 opacity-30" style={{ color: '#006b68' }} />
                      <p className="text-sm font-medium text-[#58615f] text-center">Bu aralıkta üzerinize atanmış<br />veya oluşturduğunuz görev bulunmuyor.</p>
                    </div>
                  ) : (
                    personalCalendar.tasks.map((task) => (
                      <button
                        key={task.id}
                        className="w-full text-left rounded-[1.5rem] p-4 transition-all fluid-card-tap hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(44,52,50,0.09)] active:scale-[0.98]"
                        style={{
                          background: '#ffffff',
                          boxShadow: '0 4px 16px rgba(44,52,50,0.05)',
                          borderLeft: '3px solid rgba(0,107,104,0.3)',
                        }}
                      >
                        <p className="text-sm font-bold" style={{ color: '#2c3432' }}>{task.title}</p>
                        <p className="text-xs font-medium mt-1" style={{ color: '#58615f' }}>
                          {format(parseISO(task.date), 'd MMMM yyyy EEEE', { locale: tr })}
                        </p>
                        <span className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-full text-[10px] font-bold"
                          style={{ background: 'rgba(0,107,104,0.08)', color: '#006b68' }}>
                          {task.startTime} – {task.endTime}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </section>

              {/* Lab Ziyaretleri */}
              <section className="rounded-[2rem] bg-white p-5 md:p-6 shadow-[0_8px_32px_rgba(44,52,50,0.06)]">
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,107,104,0.10)' }}>
                    <Building2 className="w-4 h-4 text-[#006b68]" />
                  </div>
                  <h3 className="text-lg md:text-xl font-bold" style={{ color: '#2c3432' }}>Laboratuvar Ziyaretleri</h3>
                </div>

                <select
                  value={selectedLabId}
                  onChange={(e) => setSelectedLabId(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl text-sm focus:outline-none transition-all"
                  style={{
                    background: '#f7faf8',
                    color: '#2c3432',
                    boxShadow: 'inset 0 2px 6px rgba(44,52,50,0.04)',
                  }}
                >
                  {selectableLabs.map((lab) => (
                    <option key={lab.id} value={lab.id}>{lab.name}</option>
                  ))}
                </select>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                  <div className="rounded-2xl p-4 transition-all fluid-card-tap hover:-translate-y-0.5"
                    style={{ background: '#f7faf8', boxShadow: '0 4px 16px rgba(44,52,50,0.04)' }}>
                    <p className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: '#006b68' }}>6 Ay Ziyaret</p>
                    <p className="text-3xl font-extrabold mt-1.5" style={{ color: '#2c3432' }}>{sixMonthMetrics.visits.length}</p>
                  </div>
                  <div className="rounded-2xl p-4 transition-all fluid-card-tap hover:-translate-y-0.5"
                    style={{ background: '#f7faf8', boxShadow: '0 4px 16px rgba(44,52,50,0.04)' }}>
                    <p className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: '#006b68' }}>Son Ziyaret</p>
                    <p className="text-sm font-bold mt-1.5" style={{ color: '#2c3432' }}>
                      {sixMonthMetrics.lastVisit ? format(parseISO(sixMonthMetrics.lastVisit.date), 'd MMM yyyy', { locale: tr }) : '—'}
                    </p>
                    <p className="text-xs font-medium mt-0.5" style={{ color: '#58615f' }}>{sixMonthMetrics.lastVisit?.createdByName || '—'}</p>
                  </div>
                  <div className="rounded-2xl p-4 sm:col-span-2 transition-all"
                    style={{ background: 'linear-gradient(135deg, rgba(0,107,104,0.06) 0%, rgba(118,221,216,0.06) 100%)', boxShadow: '0 4px 16px rgba(44,52,50,0.04)' }}>
                    <p className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: '#006b68' }}>Sıradaki Ziyaret</p>
                    <p className="text-sm font-bold mt-1.5" style={{ color: '#2c3432' }}>
                      {sixMonthMetrics.nextVisit
                        ? `${format(parseISO(sixMonthMetrics.nextVisit.date), 'd MMM yyyy', { locale: tr })} • ${sixMonthMetrics.nextVisit.startTime}-${sixMonthMetrics.nextVisit.endTime}`
                        : 'Planlı ziyaret bulunmuyor'}
                    </p>
                  </div>
                </div>
              </section>
            </div>

            {/* ── Ziyaret Notları & Dosyalar ── */}
            <section className="rounded-[2rem] bg-white p-5 md:p-6 shadow-[0_8px_32px_rgba(44,52,50,0.06)]">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,107,104,0.10)' }}>
                  <FileText className="w-4 h-4 text-[#006b68]" />
                </div>
                <h3 className="text-lg md:text-xl font-bold" style={{ color: '#2c3432' }}>Ziyaret Notları & Dosyalar</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[28rem] overflow-y-auto pr-1">
                {labNotesAndFiles.length === 0 ? (
                  <div className="col-span-full flex flex-col items-center justify-center py-10 rounded-[1.5rem]"
                    style={{ background: '#f7faf8' }}>
                    <FileText className="w-8 h-8 mb-3 opacity-30 text-[#006b68]" />
                    <p className="text-sm font-medium text-[#58615f]">Kayıt bulunamadı.</p>
                  </div>
                ) : (
                  labNotesAndFiles.map((item) => (
                    <div key={item.id}
                      className="rounded-[1.75rem] p-4 transition-all fluid-card-tap hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(44,52,50,0.08)]"
                      style={{ background: '#f7faf8', boxShadow: '0 4px 16px rgba(44,52,50,0.04)' }}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#006b68' }} />
                        <p className="text-xs font-bold" style={{ color: '#58615f' }}>
                          {format(parseISO(item.date), 'd MMM yyyy', { locale: tr })} · {item.by}
                        </p>
                      </div>
                      {item.comments.length > 0 ? (
                        <ul className="space-y-1.5 mb-3">
                          {item.comments.slice(-2).map((c) => (
                            <li key={c.id} className="text-xs leading-relaxed" style={{ color: '#58615f' }}>
                              <span style={{ color: '#006b68' }}>›</span> {c.message}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs italic mb-3" style={{ color: '#9aa09e' }}>Not eklenmemiş</p>
                      )}

                      {item.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {item.attachments.map((att, idx) => (
                            <a
                              key={`${item.id}-${idx}`}
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all hover:scale-[1.03] active:scale-[0.97]"
                              style={{
                                background: att.type === 'image' ? 'rgba(0,107,104,0.10)' : 'rgba(0,107,104,0.06)',
                                color: '#006b68',
                              }}
                            >
                              {att.type === 'image' ? <ImageIcon className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                              <span className="truncate max-w-[140px]">{att.name}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* ── Personel Aktivite Haritası ── */}
            <section className="rounded-[2rem] bg-white p-5 md:p-6 shadow-[0_8px_32px_rgba(44,52,50,0.06)]">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,107,104,0.10)' }}>
                    <Flame className="w-4 h-4 text-[#006b68]" />
                  </div>
                  <h3 className="text-lg md:text-xl font-bold" style={{ color: '#2c3432' }}>Personel Aktivite Haritası</h3>
                </div>
                <div className="flex items-center flex-wrap gap-2">
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="px-4 py-2.5 rounded-full text-xs md:text-sm font-medium focus:outline-none transition-all"
                    style={{
                      background: '#f7faf8',
                      color: '#2c3432',
                      boxShadow: '0 2px 8px rgba(44,52,50,0.06)',
                    }}
                  >
                    <option value="all">Tüm personel</option>
                    {users.map((u) => (
                      <option key={u.uid} value={u.uid}>{u.name || u.email}</option>
                    ))}
                  </select>
                  <div className="inline-flex p-1 rounded-full" style={{ background: '#f0f5f2' }}>
                    {(['weekly', 'monthly'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setHeatmapMode(m)}
                        className={cn(
                          'px-4 py-2 text-xs rounded-full font-bold transition-all active:scale-95',
                          heatmapMode === m
                            ? 'text-white shadow-md'
                            : 'text-[#58615f] hover:text-[#2c3432]'
                        )}
                        style={heatmapMode === m ? { background: 'linear-gradient(135deg, #006b68, #76ddd8)' } : {}}
                      >
                        {m === 'weekly' ? 'Haftalık' : 'Aylık'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl p-4" style={{ background: '#f7faf8' }}>
                <div className="min-w-[760px]">
                  <div className="grid" style={{ gridTemplateColumns: `80px repeat(${heatmapDays.length}, minmax(20px, 1fr))` }}>
                    <div />
                    {heatmapDays.map((day) => (
                      <div key={day.toISOString()} className="text-[10px] text-center font-bold pb-2" style={{ color: '#58615f' }}>
                        {heatmapMode === 'weekly' ? DAY_LABELS[(day.getDay() + 6) % 7] : format(day, 'd')}
                      </div>
                    ))}

                    {HOURS.map((hour, hourIdx) => (
                      <React.Fragment key={hour}>
                        <div className="text-[10px] font-bold pr-2 py-1" style={{ color: '#58615f' }}>{`${hour.toString().padStart(2, '0')}:00`}</div>
                        {heatmapDays.map((_, dayIdx) => {
                          const value = heatmapData.matrix[dayIdx]?.[hourIdx] || 0;
                          return (
                            <div
                              key={`${dayIdx}-${hourIdx}`}
                              className={cn('h-6 rounded-lg m-[2px] transition-all hover:scale-110 cursor-default', getHeatColor(value, heatmapData.max))}
                              title={`${value} görev`}
                            />
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 text-xs font-medium" style={{ color: '#58615f' }}>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-emerald-500/15 inline-block" />
                  <span>Boş</span>
                </div>
                <span className="opacity-30">·</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-yellow-500/25 inline-block" />
                  <span>Az yoğun</span>
                </div>
                <span className="opacity-30">·</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-orange-500/35 inline-block" />
                  <span>Orta</span>
                </div>
                <span className="opacity-30">·</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-red-500/45 inline-block" />
                  <span>Yoğun</span>
                </div>
              </div>
            </section>

          </div>
        </div>
      )}
    </div>
  );
}
