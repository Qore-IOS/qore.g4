'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { companyQuery, addCompanyFilter, companyStamp } from '@/lib/company-filter';
import type { Hospital, PurchasingTask, User } from '@/lib/types';
import { ArrowLeft, CalendarClock, Building2, FileText, ImageIcon, Flame, CalendarDays } from 'lucide-react';
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
  const { currentUserProfile, currentCompanyId } = useAuth();
  const [tasks, setTasks] = useState<PurchasingTask[]>([]);
  const [labs, setLabs] = useState<Hospital[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [heatmapMode, setHeatmapMode] = useState<'weekly' | 'monthly'>('weekly');
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [personalCalendarMode, setPersonalCalendarMode] = useState<'weekly' | 'monthly'>('weekly');

  useEffect(() => {
    const q = companyQuery(db, 'purchasingTasks', currentCompanyId, orderBy('date', 'desc'));
    const unsub = onSnapshot(
      q as any,
      (snap: any) => {
        const items = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as PurchasingTask[];
        setTasks(items);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [currentCompanyId]);

  useEffect(() => {
    async function fetchRefs() {
      const [labSnap, usersSnap] = await Promise.all([
        getDocs(companyQuery(db, 'hospitals', currentCompanyId)),
        getDocs(companyQuery(db, 'users', currentCompanyId, where('role', 'in', ['admin', 'satin_alma']))),
      ]);
      setLabs(labSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)));
      setUsers(usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() } as User)));
    }
    fetchRefs();
  }, [currentCompanyId]);

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
    <div className="min-h-screen bg-background text-foreground pb-16">
      <div className="px-4 md:px-8 pt-6 md:pt-8 border-b border-border pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/satin-alma" className="p-2 -ml-2 rounded-xl hover:bg-accent transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl md:text-2xl font-bold">Analiz Planlama Paneli</h1>
            <p className="text-xs text-muted-foreground">Ziyaret geçmişi ve personel yoğunluk analizi</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="px-4 md:px-8 py-16 text-muted-foreground">Veriler yükleniyor...</div>
      ) : (
        <div className="px-4 md:px-8 py-6 space-y-6">
          <section className="dashboard-kpi-surface rounded-2xl border border-border p-4 md:p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm md:text-base font-semibold">Kişisel Takvim KPI</h2>
                <p className="text-xs text-muted-foreground">Kendi görevlerinizin 1 haftalık veya 1 aylık görünümü</p>
              </div>
              <div className="inline-flex rounded-xl border border-border bg-secondary p-1">
                <button
                  onClick={() => setPersonalCalendarMode('weekly')}
                  className={cn('px-3 py-1.5 text-xs rounded-lg transition-colors', personalCalendarMode === 'weekly' ? 'bg-background text-foreground' : 'text-muted-foreground')}
                >
                  1 Hafta
                </button>
                <button
                  onClick={() => setPersonalCalendarMode('monthly')}
                  className={cn('px-3 py-1.5 text-xs rounded-lg transition-colors', personalCalendarMode === 'monthly' ? 'bg-background text-foreground' : 'text-muted-foreground')}
                >
                  1 Ay
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary/30 p-3 mb-3">
              <p className="text-[11px] text-muted-foreground">Aralık</p>
              <p className="text-sm font-medium">{personalCalendar.rangeLabel}</p>
              <p className="text-xs text-muted-foreground mt-1">Toplam görev: {personalCalendar.tasks.length}</p>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {personalCalendar.tasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">Bu aralıkta üzerinize atanmış veya oluşturduğunuz görev bulunmuyor.</p>
              ) : (
                personalCalendar.tasks.map((task) => (
                  <div key={task.id} className="rounded-xl border border-border bg-secondary/20 px-3 py-2">
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {format(parseISO(task.date), 'd MMMM yyyy EEEE', { locale: tr })} • {task.startTime}-{task.endTime}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Laboratuvar Ziyaret Geçmişi */}
          <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="w-4 h-4" />
              <h2 className="text-sm md:text-base font-semibold">Laboratuvar Ziyaret Geçmişi</h2>
            </div>

            <div className="mb-4">
              <select
                value={selectedLabId}
                onChange={(e) => setSelectedLabId(e.target.value)}
                className="w-full md:w-[360px] px-3 py-2 bg-secondary border border-border rounded-xl text-sm"
              >
                {selectableLabs.map((lab) => (
                  <option key={lab.id} value={lab.id}>{lab.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
              <div className="rounded-xl border border-border p-3 bg-secondary/30">
                <p className="text-[11px] text-muted-foreground">Son 6 ay ziyaret sayısı</p>
                <p className="text-xl font-bold mt-1">{sixMonthMetrics.visits.length}</p>
              </div>
              <div className="rounded-xl border border-border p-3 bg-secondary/30">
                <p className="text-[11px] text-muted-foreground">Son ziyaret</p>
                <p className="text-sm font-medium mt-1">
                  {sixMonthMetrics.lastVisit ? format(parseISO(sixMonthMetrics.lastVisit.date), 'd MMM yyyy', { locale: tr }) : '-'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{sixMonthMetrics.lastVisit?.createdByName || '-'}</p>
              </div>
              <div className="rounded-xl border border-border p-3 bg-secondary/30 md:col-span-2">
                <p className="text-[11px] text-muted-foreground">Bir sonraki planlanan ziyaret</p>
                <p className="text-sm font-medium mt-1">
                  {sixMonthMetrics.nextVisit
                    ? `${format(parseISO(sixMonthMetrics.nextVisit.date), 'd MMM yyyy', { locale: tr })} — ${sixMonthMetrics.nextVisit.startTime}-${sixMonthMetrics.nextVisit.endTime}`
                    : 'Planlı ziyaret bulunmuyor'}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">Ziyaret notları / dosyalar</h3>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {labNotesAndFiles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Kayıt bulunamadı.</p>
                ) : (
                  labNotesAndFiles.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border p-3 bg-secondary/20">
                      <p className="text-xs font-medium mb-1">
                        {format(parseISO(item.date), 'd MMM yyyy', { locale: tr })} • {item.by}
                      </p>
                      {item.comments.length > 0 ? (
                        <ul className="space-y-1 mb-2">
                          {item.comments.slice(-2).map((c) => (
                            <li key={c.id} className="text-[11px] text-muted-foreground">• {c.message}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-muted-foreground mb-2">Not yok</p>
                      )}

                      {item.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {item.attachments.map((att, idx) => (
                            <a
                              key={`${item.id}-${idx}`}
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                'inline-flex items-center gap-1 px-2 py-1 rounded text-[10px]',
                                att.type === 'image' ? 'bg-blue-500/10 text-blue-500' : 'bg-red-500/10 text-red-500'
                              )}
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
            </div>
          </section>

          {/* Personel Aktivite Haritası */}
          <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4" />
                <h2 className="text-sm md:text-base font-semibold">Personel Aktivite Haritası (Heatmap)</h2>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="px-3 py-2 bg-secondary border border-border rounded-xl text-xs"
                >
                  <option value="all">Tüm personel</option>
                  {users.map((u) => (
                    <option key={u.uid} value={u.uid}>{u.name || u.email}</option>
                  ))}
                </select>
                <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary border border-border">
                  {(['weekly', 'monthly'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setHeatmapMode(m)}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-[11px] font-medium',
                        heatmapMode === m ? 'bg-[#d4ec00] text-zinc-900' : 'text-muted-foreground'
                      )}
                    >
                      {m === 'weekly' ? 'Haftalık' : 'Aylık'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid" style={{ gridTemplateColumns: `80px repeat(${heatmapDays.length}, minmax(20px, 1fr))` }}>
                  <div />
                  {heatmapDays.map((day) => (
                    <div key={day.toISOString()} className="text-[10px] text-center text-muted-foreground pb-1">
                      {heatmapMode === 'weekly' ? DAY_LABELS[(day.getDay() + 6) % 7] : format(day, 'd')}
                    </div>
                  ))}

                  {HOURS.map((hour, hourIdx) => (
                    <React.Fragment key={hour}>
                      <div className="text-[10px] text-muted-foreground pr-2 py-1">{`${hour.toString().padStart(2, '0')}:00`}</div>
                      {heatmapDays.map((_, dayIdx) => {
                        const value = heatmapData.matrix[dayIdx]?.[hourIdx] || 0;
                        return (
                          <div
                            key={`${dayIdx}-${hourIdx}`}
                            className={cn('h-6 border rounded-sm m-[1px]', getHeatColor(value, heatmapData.max))}
                            title={`${value} görev`}
                          />
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Boş bloklar yeşil, yoğun bloklar kırmızı gösterilir.</span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
