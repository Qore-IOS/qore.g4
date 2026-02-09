'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
} from 'firebase/firestore';
import type { PurchasingTask } from '@/lib/types';
import {
  Plus,
  Check,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  Trash2,
  X,
  ChevronsUpDown,
} from 'lucide-react';
import { format, addDays, subDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, getDay, startOfWeek, endOfWeek, parseISO, isSameMonth } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ==========================================
// Helper: Occupancy calculation (9-5, 8 hours)
// ==========================================

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
const TOTAL_WORK_MINUTES = (WORK_END_HOUR - WORK_START_HOUR) * 60; // 480

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function getOccupancyForDay(tasks: PurchasingTask[], dateStr: string): number {
  const dayTasks = tasks.filter((t) => t.date === dateStr && !t.completed);
  if (dayTasks.length === 0) return 0;

  let totalMinutes = 0;
  for (const task of dayTasks) {
    const start = Math.max(parseTime(task.startTime), WORK_START_HOUR * 60);
    const end = Math.min(parseTime(task.endTime), WORK_END_HOUR * 60);
    if (end > start) totalMinutes += end - start;
  }
  return Math.min(Math.round((totalMinutes / TOTAL_WORK_MINUTES) * 100), 100);
}

function getOccupancyColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500';
  if (pct >= 50) return 'bg-yellow-500';
  if (pct > 0) return 'bg-emerald-400';
  return 'bg-zinc-700';
}

function getOccupancyRingColor(pct: number): string {
  if (pct >= 80) return 'text-red-500';
  if (pct >= 50) return 'text-yellow-500';
  if (pct > 0) return 'text-emerald-400';
  return 'text-zinc-600';
}

// ==========================================
// Main Panel Component
// ==========================================

export default function SatinAlmaPanel() {
  const { currentUserProfile } = useAuth();
  const userName = currentUserProfile?.name || 'Kullanıcı';

  // State
  const [tasks, setTasks] = useState<PurchasingTask[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  // Date slider ref
  const sliderRef = useRef<HTMLDivElement>(null);

  // Firestore listener for tasks
  useEffect(() => {
    const q = query(
      collection(db, 'purchasingTasks'),
      orderBy('date', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as PurchasingTask[];
        setTasks(items);
      },
      (err) => {
        console.error('PurchasingTasks listen error', err);
      }
    );
    return () => unsub();
  }, []);

  // Selected date string
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');

  // Tasks for selected date
  const dayTasks = useMemo(
    () => tasks.filter((t) => t.date === selectedDateStr),
    [tasks, selectedDateStr]
  );

  // Toggle task completion
  const toggleTask = useCallback(async (task: PurchasingTask) => {
    try {
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        completed: !task.completed,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Error toggling task', err);
      toast.error('Görev güncellenemedi');
    }
  }, []);

  // Delete task
  const deleteTask = useCallback(async (taskId: string) => {
    try {
      await deleteDoc(doc(db, 'purchasingTasks', taskId));
      toast.success('Görev silindi');
    } catch (err) {
      console.error('Error deleting task', err);
      toast.error('Görev silinemedi');
    }
  }, []);

  // Add task handler
  const handleAddTask = useCallback(
    async (data: { title: string; description: string; date: string; startTime: string; endTime: string }) => {
      if (!currentUserProfile) return;
      try {
        await addDoc(collection(db, 'purchasingTasks'), {
          title: data.title,
          description: data.description || '',
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          completed: false,
          createdAt: Timestamp.now(),
          createdByUid: currentUserProfile.uid,
          createdByName: currentUserProfile.name || '',
        });
        toast.success('Görev eklendi');
        setShowAddModal(false);
        // Navigate to that date
        setSelectedDate(parseISO(data.date));
      } catch (err) {
        console.error('Error adding task', err);
        toast.error('Görev eklenemedi');
      }
    },
    [currentUserProfile]
  );

  // Occupancy for selected date
  const selectedOccupancy = getOccupancyForDay(tasks, selectedDateStr);

  // Date slider dates (7 before + selected + 7 after = 15 days)
  const sliderDates = useMemo(() => {
    const dates: Date[] = [];
    for (let i = -7; i <= 7; i++) {
      dates.push(addDays(selectedDate, i));
    }
    return dates;
  }, [selectedDate]);

  // Calendar month days
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [calendarMonth]);

  // Scroll slider to center on mount
  useEffect(() => {
    if (sliderRef.current) {
      const container = sliderRef.current;
      const center = container.scrollWidth / 2 - container.clientWidth / 2;
      container.scrollTo({ left: center, behavior: 'auto' });
    }
  }, [selectedDate]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-24">
      {/* Header with greeting */}
      <div className="px-4 pt-6 pb-2 md:px-8 md:pt-8">
        <p className="text-zinc-500 text-sm">Satın Alma Birimi</p>
        <h1 className="text-2xl md:text-3xl font-bold mt-1">
          Merhaba, <span className="text-[#d4ec00]">{userName}</span>
        </h1>
      </div>

      {/* Date Slider */}
      <div className="mt-4 px-2 md:px-6">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedDate((d) => subDays(d, 1))}
            className="shrink-0 p-2 rounded-xl hover:bg-zinc-800 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-zinc-400" />
          </button>

          <div
            ref={sliderRef}
            className="flex gap-2 overflow-x-auto scrollbar-none py-2 snap-x snap-mandatory flex-1"
          >
            {sliderDates.map((date) => {
              const dateStr = format(date, 'yyyy-MM-dd');
              const isSelected = isSameDay(date, selectedDate);
              const today = isToday(date);
              const occupancy = getOccupancyForDay(tasks, dateStr);
              const dayTaskCount = tasks.filter((t) => t.date === dateStr).length;

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(date)}
                  className={cn(
                    'snap-center shrink-0 flex flex-col items-center justify-center rounded-2xl px-3 py-3 min-w-[64px] transition-all duration-200',
                    isSelected
                      ? 'bg-[#d4ec00] text-zinc-900 shadow-lg shadow-[#d4ec00]/20 scale-105'
                      : today
                      ? 'bg-zinc-800 text-white ring-1 ring-[#d4ec00]/30'
                      : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                  )}
                >
                  <span className="text-[10px] uppercase font-medium opacity-70">
                    {format(date, 'EEE', { locale: tr })}
                  </span>
                  <span className="text-lg font-bold leading-tight mt-0.5">
                    {format(date, 'd')}
                  </span>
                  <span className="text-[10px] opacity-60">
                    {format(date, 'MMM', { locale: tr })}
                  </span>

                  {/* Occupancy indicator */}
                  {dayTaskCount > 0 && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <div
                        className={cn(
                          'w-1.5 h-1.5 rounded-full',
                          isSelected ? 'bg-zinc-900/60' : getOccupancyColor(occupancy)
                        )}
                      />
                      <span className={cn('text-[9px] font-medium', isSelected ? 'text-zinc-900/70' : 'opacity-50')}>
                        %{occupancy}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setSelectedDate((d) => addDays(d, 1))}
            className="shrink-0 p-2 rounded-xl hover:bg-zinc-800 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Expand calendar toggle */}
      <div className="px-4 md:px-8 mt-3">
        <button
          onClick={() => {
            setCalendarExpanded((v) => !v);
            setCalendarMonth(selectedDate);
          }}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <CalendarIcon className="w-4 h-4" />
          <span>{calendarExpanded ? 'Takvimi Kapat' : 'Takvimi Genişlet'}</span>
          <ChevronsUpDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expandable Monthly Calendar */}
      {calendarExpanded && (
        <div className="px-4 md:px-8 mt-3 animate-in slide-in-from-top-2 duration-300">
          <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold">
                {format(calendarMonth, 'MMMM yyyy', { locale: tr })}
              </span>
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => (
                <div key={d} className="text-center text-[10px] text-zinc-500 font-medium py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const isSelected = isSameDay(day, selectedDate);
                const today = isToday(day);
                const inMonth = isSameMonth(day, calendarMonth);
                const occupancy = getOccupancyForDay(tasks, dayStr);
                const hasTasks = tasks.some((t) => t.date === dayStr);

                return (
                  <button
                    key={dayStr}
                    onClick={() => {
                      setSelectedDate(day);
                      setCalendarExpanded(false);
                    }}
                    className={cn(
                      'relative flex flex-col items-center justify-center py-2 rounded-xl text-sm transition-all',
                      !inMonth && 'opacity-30',
                      isSelected
                        ? 'bg-[#d4ec00] text-zinc-900 font-bold'
                        : today
                        ? 'bg-zinc-800 text-white font-semibold'
                        : 'hover:bg-zinc-800 text-zinc-300'
                    )}
                  >
                    <span>{format(day, 'd')}</span>
                    {hasTasks && (
                      <div className="flex items-center gap-0.5 mt-0.5">
                        <div
                          className={cn(
                            'w-1 h-1 rounded-full',
                            isSelected ? 'bg-zinc-900/60' : getOccupancyColor(occupancy)
                          )}
                        />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Occupancy bar for selected date */}
      <div className="px-4 md:px-8 mt-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">
            {isToday(selectedDate)
              ? 'Bugün'
              : format(selectedDate, 'd MMMM EEEE', { locale: tr })}
          </h2>
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-medium', getOccupancyRingColor(selectedOccupancy))}>
              %{selectedOccupancy} dolu
            </span>
          </div>
        </div>
        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', getOccupancyColor(selectedOccupancy))}
            style={{ width: `${selectedOccupancy}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-zinc-600">
          <span>09:00</span>
          <span>12:00</span>
          <span>15:00</span>
          <span>17:00</span>
        </div>
      </div>

      {/* Task List */}
      <div className="px-4 md:px-8 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-400">
            Görevler ({dayTasks.length})
          </h3>
        </div>

        {dayTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
            <CalendarIcon className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Bu güne ait görev bulunmuyor</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 text-xs text-[#d4ec00] hover:underline"
            >
              Yeni görev ekle
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {dayTasks
              .sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime))
              .map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onToggle={() => toggleTask(task)}
                  onDelete={() => deleteTask(task.id)}
                />
              ))}
          </div>
        )}
      </div>

      {/* Floating Add Button */}
      <button
        onClick={() => setShowAddModal(true)}
        className="fixed bottom-20 right-5 md:bottom-8 md:right-8 z-40 w-14 h-14 rounded-full bg-[#d4ec00] text-zinc-900 shadow-lg shadow-[#d4ec00]/30 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
      >
        <Plus className="w-6 h-6" strokeWidth={2.5} />
      </button>

      {/* Add Task Modal */}
      {showAddModal && (
        <AddTaskModal
          defaultDate={selectedDateStr}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddTask}
        />
      )}
    </div>
  );
}

// ==========================================
// Task Card Sub-component
// ==========================================

function TaskCard({
  task,
  onToggle,
  onDelete,
}: {
  task: PurchasingTask;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const durationMin =
    parseTime(task.endTime) - parseTime(task.startTime);
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 p-4 rounded-2xl border transition-all duration-200',
        task.completed
          ? 'bg-zinc-900/50 border-zinc-800/50'
          : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
      )}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className={cn(
          'shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
          task.completed
            ? 'bg-[#d4ec00] border-[#d4ec00]'
            : 'border-zinc-600 hover:border-[#d4ec00]'
        )}
      >
        {task.completed && <Check className="w-3 h-3 text-zinc-900" strokeWidth={3} />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm font-medium leading-tight transition-all',
            task.completed ? 'line-through text-zinc-600' : 'text-white'
          )}
        >
          {task.title}
        </p>
        {task.description && (
          <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{task.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1 text-zinc-500">
            <Clock className="w-3 h-3" />
            <span className="text-[11px]">
              {task.startTime} - {task.endTime}
            </span>
          </div>
          <span className="text-[11px] text-zinc-600">
            {hours > 0 ? `${hours}s ` : ''}
            {mins > 0 ? `${mins}dk` : ''}
          </span>
        </div>
      </div>

      {/* Time bar indicator */}
      <div className="shrink-0 w-1 h-10 rounded-full bg-zinc-800 overflow-hidden self-center">
        <div
          className={cn(
            'w-full rounded-full transition-all',
            task.completed ? 'bg-zinc-600' : 'bg-[#d4ec00]'
          )}
          style={{
            height: `${Math.min((durationMin / TOTAL_WORK_MINUTES) * 100, 100)}%`,
          }}
        />
      </div>

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ==========================================
// Add Task Modal
// ==========================================

function AddTaskModal({
  defaultDate,
  onClose,
  onSubmit,
}: {
  defaultDate: string;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [submitting, setSubmitting] = useState(false);

  const valid = title.trim().length > 0 && parseTime(endTime) > parseTime(startTime);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    await onSubmit({ title: title.trim(), description: description.trim(), date, startTime, endTime });
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl md:rounded-3xl p-6 animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold">Yeni Görev</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Görev Adı *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Görev başlığı girin"
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#d4ec00]/40 focus:border-[#d4ec00]/40 transition-all"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Açıklama</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opsiyonel açıklama"
              rows={2}
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-[#d4ec00]/40 focus:border-[#d4ec00]/40 resize-none transition-all"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Tarih</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#d4ec00]/40 focus:border-[#d4ec00]/40 transition-all [color-scheme:dark]"
            />
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Başlangıç</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#d4ec00]/40 focus:border-[#d4ec00]/40 transition-all [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Bitiş</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#d4ec00]/40 focus:border-[#d4ec00]/40 transition-all [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Duration preview */}
          {parseTime(endTime) > parseTime(startTime) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 rounded-xl">
              <Clock className="w-3.5 h-3.5 text-[#d4ec00]" />
              <span className="text-xs text-zinc-400">
                Süre:{' '}
                {(() => {
                  const dur = parseTime(endTime) - parseTime(startTime);
                  const h = Math.floor(dur / 60);
                  const m = dur % 60;
                  return `${h > 0 ? `${h} saat ` : ''}${m > 0 ? `${m} dakika` : ''}`;
                })()}
              </span>
            </div>
          )}

          {/* Validation errors */}
          {parseTime(endTime) <= parseTime(startTime) && startTime && endTime && (
            <p className="text-xs text-red-400">Bitiş saati başlangıçtan sonra olmalıdır</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!valid || submitting}
            className={cn(
              'w-full py-3.5 rounded-xl text-sm font-semibold transition-all',
              valid && !submitting
                ? 'bg-[#d4ec00] text-zinc-900 hover:brightness-110 active:scale-[0.98]'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            )}
          >
            {submitting ? 'Ekleniyor...' : 'Görev Ekle'}
          </button>
        </form>
      </div>
    </div>
  );
}
