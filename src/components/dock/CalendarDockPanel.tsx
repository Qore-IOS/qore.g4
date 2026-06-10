'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Dot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LiquidGlassSurface } from '@/components/ui/liquid-glass';
import { useAuth } from '@/contexts/auth-context';
import { usePurchasingTasks } from '@/hooks/useFirebaseQueries';

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
const DOW = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];

const NAV_BTN =
  'grid place-items-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition';

/** PurchasingTask.date is normally a YYYY-MM-DD string, but defensively accept
 *  Firestore Timestamps / Date objects too. */
function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'object') {
    const o = v as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') {
      try { return o.toDate(); } catch { return null; }
    }
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000);
  }
  return null;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Takvim kısayolu paneli — dock'taki takvim ikonu açar. Planlama Birimi
 * (purchasingTasks) görevlerinden, giriş yapan kullanıcıya ait olanları aya
 * işaretler ve bugünün görevlerini listeler. Sadece açıkken mount edildiği
 * için sorgu yalnızca panel açıldığında çalışır (react-query ile cache'li).
 */
export function CalendarDockPanel({ onClose }: { onClose: () => void }) {
  const { currentUser, currentUserProfile } = useAuth();
  const uid = currentUserProfile?.uid || currentUser?.uid || '';
  const { data: allTasks = [], isLoading } = usePurchasingTasks();

  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }));

  // Yalnızca giriş yapan kullanıcının görevleri (oluşturduğu veya atandığı).
  const myTasks = useMemo(() => {
    if (!uid) return [] as Array<Record<string, unknown> & { _d: Date }>;
    return (allTasks as Array<Record<string, unknown>>)
      .map((t) => ({ ...t, _d: toDate(t.date) }))
      .filter(
        (t): t is Record<string, unknown> & { _d: Date } =>
          !!t._d &&
          (t.createdByUid === uid ||
            ((t.assignedPersonnel as Array<{ uid?: string }> | undefined) || []).some(
              (p) => p?.uid === uid,
            )),
      );
  }, [allTasks, uid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const first = new Date(view.y, view.m, 1);
  const startDow = (first.getDay() + 6) % 7; // Pazartesi ilk sütun
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const prevDays = new Date(view.y, view.m, 0).getDate();

  const cells: { d: number; muted: boolean }[] = [];
  for (let i = 0; i < startDow; i++) cells.push({ d: prevDays - startDow + 1 + i, muted: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, muted: false });
  while (cells.length % 7 !== 0) cells.push({ d: cells.length - (startDow + daysInMonth) + 1, muted: true });

  const isCurMonth = view.y === today.getFullYear() && view.m === today.getMonth();

  const todoDays = useMemo(() => {
    const s = new Set<number>();
    myTasks.forEach((t) => {
      if (t._d.getFullYear() === view.y && t._d.getMonth() === view.m) s.add(t._d.getDate());
    });
    return s;
  }, [myTasks, view.y, view.m]);

  const todays = useMemo(
    () =>
      myTasks
        .filter((t) => sameDay(t._d, today))
        .sort((a, b) =>
          String(a.startTime || '').localeCompare(String(b.startTime || '')),
        ),
    [myTasks, today],
  );

  const move = (delta: number) =>
    setView((v) => {
      let m = v.m + delta;
      let y = v.y;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      return { y, m };
    });

  if (typeof document === 'undefined') return null;

  // Portal to body so position:fixed is viewport-relative (the dock sits inside
  // a translateX(-50%) wrapper, which would otherwise be the containing block).
  return createPortal(
    <>
      {/* Saydam yakalayıcı — dock'un altında kalır, taskbar tıklanabilir kalsın */}
      <div className="fixed inset-0" style={{ zIndex: 489 }} onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        role="dialog"
        aria-label="Takvim"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'fixed w-[360px] max-w-[94vw] rounded-[22px] p-4 flex flex-col gap-3',
          'bg-white/40 dark:bg-zinc-900/35',
        )}
        style={{
          right: 16,
          bottom: 'calc(var(--dock-gap) + var(--dock-h) + 12px)',
          zIndex: 511,
          boxShadow:
            '0 30px 70px -24px rgba(20,28,60,0.45), 0 8px 24px -12px rgba(20,28,60,0.30)',
          willChange: 'auto',
        }}
      >
        {/* Apple Liquid Glass yüzeyi — içerik okunaklı kalsın diye hafif tonlu */}
        <LiquidGlassSurface radius={22} strength={26} dispersion={0.32} blur={5} bezel={18} zoom={0.1} fallbackBlur={28} shine={false} />
        {/* head */}
        <div className="relative flex items-center justify-between">
          <div className="text-[15px] font-bold text-foreground">
            {MONTHS[view.m]} {view.y}
          </div>
          <div className="flex items-center gap-1">
            <button className={NAV_BTN} onClick={() => move(-1)} aria-label="Önceki ay">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              className={NAV_BTN}
              onClick={() => setView({ y: today.getFullYear(), m: today.getMonth() })}
              aria-label="Bugüne dön"
            >
              <Dot className="h-4 w-4" />
            </button>
            <button className={NAV_BTN} onClick={() => move(1)} aria-label="Sonraki ay">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* grid */}
        <div className="relative grid grid-cols-7 gap-y-1 text-center">
          {DOW.map((d) => (
            <div key={d} className="text-[11px] font-semibold text-muted-foreground/70 pb-1">
              {d}
            </div>
          ))}
          {cells.map((c, i) => {
            const isToday = !c.muted && isCurMonth && c.d === today.getDate();
            const hasTodo = !c.muted && todoDays.has(c.d);
            return (
              <div key={i} className="relative h-9 flex items-center justify-center">
                <span
                  className={cn(
                    'grid place-items-center h-8 w-8 rounded-full text-[13px] font-semibold',
                    c.muted ? 'text-muted-foreground/30' : 'text-foreground',
                    isToday && 'text-white',
                  )}
                  style={
                    isToday
                      ? { background: 'linear-gradient(140deg,#f99a52,#f06f2c)' }
                      : undefined
                  }
                >
                  {c.d}
                </span>
                {hasTodo && (
                  <span
                    className={cn(
                      'absolute bottom-0.5 h-1 w-1 rounded-full',
                      isToday ? 'bg-white/90' : 'bg-blue-500',
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* bugünün görevleri */}
        <div className="relative border-t border-black/[0.06] dark:border-white/[0.08] pt-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground px-1 mb-1.5">
            Bugünün görevleri · {today.getDate()} {MONTHS[today.getMonth()]}
          </div>
          <div className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto">
            {isLoading && (
              <div className="text-[12.5px] text-muted-foreground px-1 py-1">Yükleniyor…</div>
            )}
            {!isLoading && todays.length === 0 && (
              <div className="text-[12.5px] text-muted-foreground px-1 py-1">
                Bugün için görev yok.
              </div>
            )}
            {todays.map((t, i) => {
              const tag = (t.taskTypeLabel || t.taskType) as string | undefined;
              return (
                <div key={(t.id as string) || i} className="flex items-center gap-2.5 px-1 py-1">
                  <span
                    className={cn(
                      'grid place-items-center h-4 w-4 rounded-[5px] border text-[10px] leading-none shrink-0',
                      t.completed
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-muted-foreground/40 text-transparent',
                    )}
                  >
                    ✓
                  </span>
                  <span
                    className={cn(
                      'flex-1 text-[13px] truncate',
                      t.completed ? 'text-muted-foreground line-through' : 'text-foreground',
                    )}
                  >
                    {t.title as string}
                  </span>
                  {tag && (
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{tag}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </>,
    document.body,
  );
}

export default CalendarDockPanel;
