'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import type { PurchasingTask, Hospital, LabPool, User } from '@/lib/types';
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
  Building2,
  Users,
  ChevronDown,
  Search,
} from 'lucide-react';
import { format, addDays, subDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, startOfWeek, endOfWeek, parseISO, isSameMonth } from 'date-fns';
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
  return 'bg-zinc-300 dark:bg-zinc-700';
}

function getOccupancyRingColor(pct: number): string {
  if (pct >= 80) return 'text-red-500';
  if (pct >= 50) return 'text-yellow-500';
  if (pct > 0) return 'text-emerald-500 dark:text-emerald-400';
  return 'text-zinc-400 dark:text-zinc-600';
}

// Accent color helpers
const ACCENT = 'text-[#7a8a00] dark:text-[#d4ec00]';
const ACCENT_BG = 'bg-[#d4ec00]';
const ACCENT_BG_SUBTLE = 'bg-[#d4ec00]/10 dark:bg-[#d4ec00]/10';
const ACCENT_BORDER = 'border-[#d4ec00]/40';
const ACCENT_RING = 'ring-[#d4ec00]/30';

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

  // Reference data for the modal
  const [laboratories, setLaboratories] = useState<Hospital[]>([]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [personnel, setPersonnel] = useState<User[]>([]);

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

  // Fetch laboratories, labPools, and personnel once
  useEffect(() => {
    let cancelled = false;

    async function fetchReferenceData() {
      try {
        const [hospSnap, poolSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'labPools')),
          getDocs(
            query(
              collection(db, 'users'),
              where('role', 'in', ['admin', 'satin_alma'])
            )
          ),
        ]);

        if (cancelled) return;

        setLaboratories(
          hospSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital))
        );
        setLabPools(
          poolSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LabPool))
        );
        setPersonnel(
          usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() } as User))
        );
      } catch (err) {
        console.error('Error fetching reference data', err);
      }
    }

    fetchReferenceData();
    return () => { cancelled = true; };
  }, []);

  // Compute main laboratories only (standalone + pool main labs)
  const mainLaboratories = useMemo(() => {
    const subLabIds = new Set<string>();
    for (const pool of labPools) {
      if (pool.active && pool.mainLabId && pool.memberIds) {
        for (const memberId of pool.memberIds) {
          if (memberId !== pool.mainLabId) {
            subLabIds.add(memberId);
          }
        }
      }
    }
    return laboratories.filter((lab) => !subLabIds.has(lab.id));
  }, [laboratories, labPools]);

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
    async (data: {
      title: string;
      description: string;
      taskType: 'custom' | 'kurum_ziyareti';
      date: string;
      startTime: string;
      endTime: string;
      laboratoryId?: string;
      laboratoryName?: string;
      accompanyingPersonnel?: { uid: string; name: string }[];
    }) => {
      if (!currentUserProfile) return;
      try {
        const taskDoc: Record<string, any> = {
          title: data.title,
          description: data.description,
          taskType: data.taskType,
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          completed: false,
          createdAt: Timestamp.now(),
          createdByUid: currentUserProfile.uid,
          createdByName: currentUserProfile.name || '',
        };

        if (data.taskType === 'kurum_ziyareti') {
          if (data.laboratoryId) taskDoc.laboratoryId = data.laboratoryId;
          if (data.laboratoryName) taskDoc.laboratoryName = data.laboratoryName;
          if (data.accompanyingPersonnel && data.accompanyingPersonnel.length > 0) {
            taskDoc.accompanyingPersonnel = data.accompanyingPersonnel;
          }
        }

        await addDoc(collection(db, 'purchasingTasks'), taskDoc);
        toast.success('Görev eklendi');
        setShowAddModal(false);
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
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Header with greeting */}
      <div className="px-4 pt-6 pb-2 md:px-8 md:pt-8">
        <p className="text-muted-foreground text-sm">Satın Alma Birimi</p>
        <h1 className="text-2xl md:text-3xl font-bold mt-1">
          Merhaba, <span className={ACCENT}>{userName}</span>
        </h1>
      </div>

      {/* Date Slider */}
      <div className="mt-4 px-1 md:px-4">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setSelectedDate((d) => subDays(d, 1))}
            className="shrink-0 p-1.5 rounded-xl hover:bg-accent transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>

          <div
            ref={sliderRef}
            className="flex gap-1 overflow-x-auto scrollbar-none py-2 flex-1"
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
                    'flex-1 min-w-0 flex flex-col items-center justify-center rounded-2xl py-2.5 transition-all duration-200',
                    isSelected
                      ? `${ACCENT_BG} text-zinc-900 shadow-lg shadow-[#d4ec00]/20 scale-105 z-10`
                      : today
                      ? `bg-accent text-foreground ring-1 ${ACCENT_RING}`
                      : 'bg-secondary text-muted-foreground hover:bg-accent'
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
                    <div className="mt-1 flex items-center gap-0.5">
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
            className="shrink-0 p-1.5 rounded-xl hover:bg-accent transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
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
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <CalendarIcon className="w-4 h-4" />
          <span>{calendarExpanded ? 'Takvimi Kapat' : 'Takvimi Genişlet'}</span>
          <ChevronsUpDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expandable Monthly Calendar */}
      {calendarExpanded && (
        <div className="px-4 md:px-8 mt-3 animate-in slide-in-from-top-2 duration-300">
          <div className="bg-card rounded-2xl p-4 border border-border">
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="p-1.5 rounded-lg hover:bg-accent transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold">
                {format(calendarMonth, 'MMMM yyyy', { locale: tr })}
              </span>
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="p-1.5 rounded-lg hover:bg-accent transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => (
                <div key={d} className="text-center text-[10px] text-muted-foreground font-medium py-1">
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
                        ? `${ACCENT_BG} text-zinc-900 font-bold`
                        : today
                        ? 'bg-accent text-foreground font-semibold'
                        : 'hover:bg-accent text-foreground'
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
        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', getOccupancyColor(selectedOccupancy))}
            style={{ width: `${selectedOccupancy}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
          <span>09:00</span>
          <span>12:00</span>
          <span>15:00</span>
          <span>17:00</span>
        </div>
      </div>

      {/* Task List */}
      <div className="px-4 md:px-8 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Görevler ({dayTasks.length})
          </h3>
        </div>

        {dayTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <CalendarIcon className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Bu güne ait görev bulunmuyor</p>
            <button
              onClick={() => setShowAddModal(true)}
              className={cn('mt-3 text-xs hover:underline', ACCENT)}
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
        className={cn(
          'fixed bottom-20 right-5 md:bottom-8 md:right-8 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center hover:scale-110 active:scale-95 transition-transform',
          ACCENT_BG, 'text-zinc-900 shadow-[#d4ec00]/30'
        )}
      >
        <Plus className="w-6 h-6" strokeWidth={2.5} />
      </button>

      {/* Add Task Modal */}
      {showAddModal && (
        <AddTaskModal
          defaultDate={selectedDateStr}
          laboratories={mainLaboratories}
          personnel={personnel}
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
  const isVisit = task.taskType === 'kurum_ziyareti';

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 p-4 rounded-2xl border transition-all duration-200',
        task.completed
          ? 'bg-card/50 border-border/50'
          : 'bg-card border-border hover:border-muted-foreground/30'
      )}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className={cn(
          'shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
          task.completed
            ? `${ACCENT_BG} border-[#d4ec00]`
            : 'border-muted-foreground/40 hover:border-[#d4ec00]'
        )}
      >
        {task.completed && <Check className="w-3 h-3 text-zinc-900" strokeWidth={3} />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              'text-sm font-medium leading-tight transition-all',
              task.completed ? 'line-through text-muted-foreground' : 'text-foreground'
            )}
          >
            {task.title}
          </p>
          {isVisit && (
            <span className={cn('shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium', ACCENT_BG_SUBTLE, ACCENT)}>
              Ziyaret
            </span>
          )}
        </div>

        {/* Laboratory info for visit tasks */}
        {isVisit && task.laboratoryName && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Building2 className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{task.laboratoryName}</span>
          </div>
        )}

        {task.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
        )}

        {/* Accompanying personnel */}
        {isVisit && task.accompanyingPersonnel && task.accompanyingPersonnel.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Users className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              {task.accompanyingPersonnel.map((p) => p.name).join(', ')}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span className="text-[11px]">
              {task.startTime} - {task.endTime}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground/70">
            {hours > 0 ? `${hours}s ` : ''}
            {mins > 0 ? `${mins}dk` : ''}
          </span>
        </div>
      </div>

      {/* Time bar indicator */}
      <div className="shrink-0 w-1 h-10 rounded-full bg-secondary overflow-hidden self-center">
        <div
          className={cn(
            'w-full rounded-full transition-all',
            task.completed ? 'bg-muted-foreground/30' : ACCENT_BG
          )}
          style={{
            height: `${Math.min((durationMin / TOTAL_WORK_MINUTES) * 100, 100)}%`,
          }}
        />
      </div>

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-red-400 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ==========================================
// Add Task Modal
// ==========================================

interface AddTaskSubmitData {
  title: string;
  description: string;
  taskType: 'custom' | 'kurum_ziyareti';
  date: string;
  startTime: string;
  endTime: string;
  laboratoryId?: string;
  laboratoryName?: string;
  accompanyingPersonnel?: { uid: string; name: string }[];
}

function AddTaskModal({
  defaultDate,
  laboratories,
  personnel,
  onClose,
  onSubmit,
}: {
  defaultDate: string;
  laboratories: Hospital[];
  personnel: User[];
  onClose: () => void;
  onSubmit: (data: AddTaskSubmitData) => void;
}) {
  const [taskType, setTaskType] = useState<'custom' | 'kurum_ziyareti'>('custom');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [submitting, setSubmitting] = useState(false);

  // Kurum ziyareti fields
  const [selectedLabId, setSelectedLabId] = useState('');
  const [selectedPersonnel, setSelectedPersonnel] = useState<{ uid: string; name: string }[]>([]);
  const [labSearchQuery, setLabSearchQuery] = useState('');
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState('');
  const [showLabDropdown, setShowLabDropdown] = useState(false);
  const [showPersonnelDropdown, setShowPersonnelDropdown] = useState(false);

  const labDropdownRef = useRef<HTMLDivElement>(null);
  const personnelDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (labDropdownRef.current && !labDropdownRef.current.contains(e.target as Node)) {
        setShowLabDropdown(false);
      }
      if (personnelDropdownRef.current && !personnelDropdownRef.current.contains(e.target as Node)) {
        setShowPersonnelDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const effectiveTitle = taskType === 'kurum_ziyareti' ? 'Kurum Ziyareti' : title;
  const selectedLab = laboratories.find((l) => l.id === selectedLabId);

  const filteredLabs = useMemo(() => {
    if (!labSearchQuery.trim()) return laboratories;
    const q = labSearchQuery.toLowerCase();
    return laboratories.filter(
      (l) =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.kod || '').toLowerCase().includes(q)
    );
  }, [laboratories, labSearchQuery]);

  const filteredPersonnel = useMemo(() => {
    if (!personnelSearchQuery.trim()) return personnel;
    const q = personnelSearchQuery.toLowerCase();
    return personnel.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q)
    );
  }, [personnel, personnelSearchQuery]);

  const timeValid = parseTime(endTime) > parseTime(startTime);
  const descriptionValid = description.trim().length > 0;
  const titleValid = taskType === 'kurum_ziyareti' || title.trim().length > 0;
  const labValid = taskType === 'custom' || selectedLabId !== '';
  const valid = titleValid && descriptionValid && timeValid && labValid;

  const togglePersonnel = (user: User) => {
    setSelectedPersonnel((prev) => {
      const exists = prev.find((p) => p.uid === user.uid);
      if (exists) return prev.filter((p) => p.uid !== user.uid);
      return [...prev, { uid: user.uid, name: user.name || user.email || '' }];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    await onSubmit({
      title: effectiveTitle,
      description: description.trim(),
      taskType,
      date,
      startTime,
      endTime,
      ...(taskType === 'kurum_ziyareti' && {
        laboratoryId: selectedLabId,
        laboratoryName: selectedLab?.name || '',
        accompanyingPersonnel: selectedPersonnel.length > 0 ? selectedPersonnel : undefined,
      }),
    });
    setSubmitting(false);
  };

  // Modal input/surface classes
  const inputCls = 'w-full px-4 py-3 bg-secondary border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#d4ec00]/40 focus:border-[#d4ec00]/40 transition-all';
  const dropdownTriggerCls = 'w-full flex items-center justify-between px-4 py-3 bg-secondary border rounded-xl text-sm transition-all';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-card border border-border rounded-t-3xl md:rounded-3xl p-6 animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-foreground">Yeni Görev</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Task Type Selector */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Görev Türü</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setTaskType('custom');
                  setTitle('');
                  setSelectedLabId('');
                  setSelectedPersonnel([]);
                }}
                className={cn(
                  'flex-1 py-2.5 px-3 rounded-xl text-sm font-medium border transition-all',
                  taskType === 'custom'
                    ? cn(ACCENT_BG_SUBTLE, ACCENT_BORDER, ACCENT)
                    : 'bg-secondary border-border text-muted-foreground hover:border-muted-foreground/40'
                )}
              >
                Serbest Görev
              </button>
              <button
                type="button"
                onClick={() => {
                  setTaskType('kurum_ziyareti');
                  setTitle('Kurum Ziyareti');
                }}
                className={cn(
                  'flex-1 py-2.5 px-3 rounded-xl text-sm font-medium border transition-all flex items-center justify-center gap-2',
                  taskType === 'kurum_ziyareti'
                    ? cn(ACCENT_BG_SUBTLE, ACCENT_BORDER, ACCENT)
                    : 'bg-secondary border-border text-muted-foreground hover:border-muted-foreground/40'
                )}
              >
                <Building2 className="w-4 h-4" />
                Kurum Ziyareti
              </button>
            </div>
          </div>

          {/* Title - shown only for custom tasks */}
          {taskType === 'custom' ? (
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Görev Adı *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Görev başlığı girin"
                className={inputCls}
                autoFocus
              />
            </div>
          ) : (
            <div className={cn('flex items-center gap-2 px-4 py-3 rounded-xl border', ACCENT_BG_SUBTLE, 'border-border/50')}>
              <Building2 className={cn('w-4 h-4', ACCENT)} />
              <span className="text-sm font-medium text-foreground">Kurum Ziyareti</span>
            </div>
          )}

          {/* Laboratory selector (kurum_ziyareti only) */}
          {taskType === 'kurum_ziyareti' && (
            <div ref={labDropdownRef} className="relative">
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Kurum (Laboratuvar) *</label>
              <button
                type="button"
                onClick={() => {
                  setShowLabDropdown((v) => !v);
                  setShowPersonnelDropdown(false);
                }}
                className={cn(
                  dropdownTriggerCls,
                  showLabDropdown
                    ? `${ACCENT_BORDER} ring-2 ring-[#d4ec00]/40`
                    : 'border-border',
                  selectedLabId ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <span className="truncate">{selectedLab?.name || 'Laboratuvar seçin'}</span>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform', showLabDropdown && 'rotate-180')} />
              </button>

              {showLabDropdown && (
                <div className="absolute z-20 mt-1 w-full bg-popover border border-border rounded-xl shadow-xl overflow-hidden animate-in slide-in-from-top-1 duration-150">
                  <div className="p-2 border-b border-border">
                    <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
                      <Search className="w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={labSearchQuery}
                        onChange={(e) => setLabSearchQuery(e.target.value)}
                        placeholder="Ara..."
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredLabs.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground text-center">Sonuç bulunamadı</div>
                    ) : (
                      filteredLabs.map((lab) => (
                        <button
                          key={lab.id}
                          type="button"
                          onClick={() => {
                            setSelectedLabId(lab.id);
                            setShowLabDropdown(false);
                            setLabSearchQuery('');
                          }}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors text-left',
                            selectedLabId === lab.id ? cn('bg-accent/50', ACCENT) : 'text-foreground'
                          )}
                        >
                          <Building2 className="w-3.5 h-3.5 shrink-0 opacity-50" />
                          <span className="truncate">{lab.name}</span>
                          {selectedLabId === lab.id && (
                            <Check className={cn('w-3.5 h-3.5 shrink-0 ml-auto', ACCENT)} />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Description (required in all scenarios) */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Açıklama *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Açıklama girin"
              rows={2}
              className={cn(inputCls, 'resize-none')}
            />
          </div>

          {/* Accompanying Personnel (kurum_ziyareti only) */}
          {taskType === 'kurum_ziyareti' && (
            <div ref={personnelDropdownRef} className="relative">
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Eşlik Eden Personel</label>
              <button
                type="button"
                onClick={() => {
                  setShowPersonnelDropdown((v) => !v);
                  setShowLabDropdown(false);
                }}
                className={cn(
                  dropdownTriggerCls,
                  showPersonnelDropdown
                    ? `${ACCENT_BORDER} ring-2 ring-[#d4ec00]/40`
                    : 'border-border',
                  selectedPersonnel.length > 0 ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <span className="truncate">
                  {selectedPersonnel.length > 0
                    ? `${selectedPersonnel.length} kişi seçildi`
                    : 'Personel seçin (opsiyonel)'}
                </span>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform', showPersonnelDropdown && 'rotate-180')} />
              </button>

              {/* Selected personnel tags */}
              {selectedPersonnel.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedPersonnel.map((p) => (
                    <span
                      key={p.uid}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-secondary border border-border rounded-lg text-[11px] text-foreground"
                    >
                      {p.name}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedPersonnel((prev) => prev.filter((x) => x.uid !== p.uid))
                        }
                        className="text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {showPersonnelDropdown && (
                <div className="absolute z-20 mt-1 w-full bg-popover border border-border rounded-xl shadow-xl overflow-hidden animate-in slide-in-from-top-1 duration-150">
                  <div className="p-2 border-b border-border">
                    <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
                      <Search className="w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={personnelSearchQuery}
                        onChange={(e) => setPersonnelSearchQuery(e.target.value)}
                        placeholder="Personel ara..."
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredPersonnel.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground text-center">Sonuç bulunamadı</div>
                    ) : (
                      filteredPersonnel.map((user) => {
                        const isSelected = selectedPersonnel.some((p) => p.uid === user.uid);
                        return (
                          <button
                            key={user.uid}
                            type="button"
                            onClick={() => togglePersonnel(user)}
                            className={cn(
                              'w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors text-left',
                              isSelected ? 'bg-accent/50' : ''
                            )}
                          >
                            <div
                              className={cn(
                                'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all',
                                isSelected ? `${ACCENT_BG} border-[#d4ec00]` : 'border-muted-foreground/40'
                              )}
                            >
                              {isSelected && <Check className="w-2.5 h-2.5 text-zinc-900" strokeWidth={3} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={cn('truncate block', isSelected ? 'text-foreground' : 'text-foreground/80')}>
                                {user.name || user.email}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {user.role === 'admin' ? 'Admin' : 'Satın Alma'}
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Date */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Tarih</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={cn(inputCls, 'dark:[color-scheme:dark]')}
            />
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Başlangıç</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={cn(inputCls, 'dark:[color-scheme:dark]')}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Bitiş</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={cn(inputCls, 'dark:[color-scheme:dark]')}
              />
            </div>
          </div>

          {/* Duration preview */}
          {timeValid && (
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-xl">
              <Clock className={cn('w-3.5 h-3.5', ACCENT)} />
              <span className="text-xs text-muted-foreground">
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
          {!timeValid && startTime && endTime && (
            <p className="text-xs text-red-400">Bitiş saati başlangıçtan sonra olmalıdır</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!valid || submitting}
            className={cn(
              'w-full py-3.5 rounded-xl text-sm font-semibold transition-all',
              valid && !submitting
                ? `${ACCENT_BG} text-zinc-900 hover:brightness-110 active:scale-[0.98]`
                : 'bg-secondary text-muted-foreground cursor-not-allowed'
            )}
          >
            {submitting ? 'Ekleniyor...' : 'Görev Ekle'}
          </button>
        </form>
      </div>
    </div>
  );
}
