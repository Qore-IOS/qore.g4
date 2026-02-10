'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
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
  getDoc,
  setDoc,
  Timestamp,
  writeBatch,
  arrayUnion,
} from 'firebase/firestore';
import type {
  PurchasingTask,
  PurchasingTaskAttachment,
  PurchasingSubtask,
  PurchasingTaskRecurrence,
  PurchasingTaskComment,
  PurchasingTaskActivityLog,
  PurchasingTaskDefinition,
  Hospital,
  LabPool,
  User,
} from '@/lib/types';
import {
  Plus,
  Check,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CalendarClock,
  Clock,
  Trash2,
  X,
  ChevronsUpDown,
  Building2,
  Users,
  ChevronDown,
  Search,
  ClipboardList,
  Paperclip,
  FileText,
  ImageIcon,
  Loader2,
  Pencil,
  GripVertical,
  Flag,
  Repeat,
  ListChecks,
  CirclePlus,
  AlertTriangle,
  ArrowUp,
  Minus,
  ArrowDown,
  Square,
  CheckSquare,
  MessageSquare,
  Send,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import {
  format,
  addDays,
  subDays,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isToday,
  startOfWeek,
  endOfWeek,
  parseISO,
  isSameMonth,
  addWeeks,
  addMonths,
  isBefore,
} from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PurchasingAgentChat from '@/components/purchasing/PurchasingAgentChat';

// ==========================================
// Helper: Occupancy calculation (9-5, 8 hours)
// ==========================================

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
const TOTAL_WORK_MINUTES = (WORK_END_HOUR - WORK_START_HOUR) * 60;
const TASK_CACHE_KEY = 'purchasing:tasks:cache:v1';
const TASK_MUTATION_QUEUE_KEY = 'purchasing:tasks:queue:v1';

type OfflineMutation = {
  id: string;
  action: 'create' | 'update' | 'delete';
  taskId: string;
  payload?: Record<string, any>;
  baseUpdatedAtMs?: number;
};

function serializeForCache<T>(value: T): T {
  if (value instanceof Timestamp) return { __ts: value.toMillis() } as T;
  if (Array.isArray(value)) return value.map((v) => serializeForCache(v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, any>).map(([k, v]) => [k, serializeForCache(v)])) as T;
  }
  return value;
}

function hydrateFromCache<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => hydrateFromCache(v)) as T;
  if (value && typeof value === 'object') {
    if ('__ts' in (value as Record<string, any>)) return Timestamp.fromMillis((value as any).__ts) as T;
    return Object.fromEntries(Object.entries(value as Record<string, any>).map(([k, v]) => [k, hydrateFromCache(v)])) as T;
  }
  return value;
}

function getUpdatedAtMs(task?: PurchasingTask): number {
  const updated = task?.updatedAt as any;
  if (updated?.toMillis) return updated.toMillis();
  if (updated?.seconds) return updated.seconds * 1000;
  return 0;
}

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

function getHeatColor(value: number, max: number): string {
  if (value === 0) return 'bg-emerald-500/15 border-emerald-500/20';
  const ratio = max > 0 ? value / max : 0;
  if (ratio < 0.34) return 'bg-yellow-500/25 border-yellow-500/30';
  if (ratio < 0.67) return 'bg-orange-500/35 border-orange-500/40';
  return 'bg-red-500/45 border-red-500/50';
}

// Accent color helpers
const ACCENT = 'text-[#7a8a00] dark:text-[#d4ec00]';
const ACCENT_BG = 'bg-[#d4ec00]';
const ACCENT_BG_SUBTLE = 'bg-[#d4ec00]/10 dark:bg-[#d4ec00]/10';
const ACCENT_BORDER = 'border-[#d4ec00]/40';
const ACCENT_RING = 'ring-[#d4ec00]/30';


interface CalendarSpecialDay {
  monthDay: string; // MM-dd
  name: string;
  type: 'holiday' | 'special';
}

const CALENDAR_SPECIAL_DAYS: CalendarSpecialDay[] = [
  { monthDay: '01-01', name: 'Yılbaşı', type: 'holiday' },
  { monthDay: '04-23', name: '23 Nisan', type: 'holiday' },
  { monthDay: '05-01', name: 'Emek ve Dayanışma Günü', type: 'holiday' },
  { monthDay: '05-19', name: '19 Mayıs', type: 'holiday' },
  { monthDay: '07-15', name: '15 Temmuz', type: 'holiday' },
  { monthDay: '08-30', name: '30 Ağustos', type: 'holiday' },
  { monthDay: '10-29', name: '29 Ekim', type: 'holiday' },
  { monthDay: '03-14', name: 'Tıp Bayramı', type: 'special' },
];

function getSpecialDay(dateStr: string): CalendarSpecialDay | undefined {
  const monthDay = dateStr.slice(5);
  return CALENDAR_SPECIAL_DAYS.find((d) => d.monthDay === monthDay);
}

function createActivityLog(action: string, message: string, user: { uid: string; name?: string; email?: string }): PurchasingTaskActivityLog {
  return {
    id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    message,
    createdAt: Timestamp.now(),
    createdByUid: user.uid,
    createdByName: user.name || user.email || 'Kullanıcı',
  };
}

// ==========================================
// Priority helpers
// ==========================================

type Priority = 'low' | 'normal' | 'high' | 'urgent';

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string; border: string; icon: typeof Flag }> = {
  low: { label: 'Düşük', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-l-blue-400', icon: ArrowDown },
  normal: { label: 'Normal', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-l-emerald-400', icon: Minus },
  high: { label: 'Yüksek', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-l-orange-400', icon: ArrowUp },
  urgent: { label: 'Acil', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-l-red-500', icon: AlertTriangle },
};

// ==========================================
// Image compression - downgrade resolution
// ==========================================

const MAX_IMAGE_WIDTH = 1200;
const MAX_IMAGE_HEIGHT = 1200;
const JPEG_QUALITY = 0.7;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
        const ratio = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Compression failed'));
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

async function uploadAttachment(file: File, taskPath: string): Promise<PurchasingTaskAttachment> {
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  if (!isImage && !isPdf) throw new Error('Sadece resim ve PDF dosyaları yüklenebilir');
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) throw new Error('Dosya boyutu 10MB sınırını aşıyor');

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `purchasing-tasks/${taskPath}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, storagePath);

  let uploadData: Blob | File = file;
  if (isImage) uploadData = await compressImage(file);

  const uploadPromise = uploadBytes(storageRef, uploadData);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Yükleme zaman aşımına uğradı')), 60000)
  );
  await Promise.race([uploadPromise, timeoutPromise]);
  const url = await getDownloadURL(storageRef);

  return { name: file.name, url, type: isImage ? 'image' : 'pdf', size: uploadData.size, storagePath };
}

// ==========================================
// Recurring task helpers
// ==========================================

function generateRecurringDates(
  startDate: string,
  recurrence: PurchasingTaskRecurrence,
  maxInstances = 52
): string[] {
  const dates: string[] = [];
  let current = parseISO(startDate);
  const end = recurrence.endDate ? parseISO(recurrence.endDate) : addMonths(current, 12);

  for (let i = 0; i < maxInstances; i++) {
    if (i > 0) {
      if (recurrence.type === 'daily') current = addDays(current, recurrence.interval);
      else if (recurrence.type === 'weekly') current = addWeeks(current, recurrence.interval);
      else if (recurrence.type === 'monthly') current = addMonths(current, recurrence.interval);
    }
    if (isBefore(end, current)) break;
    if (i > 0) dates.push(format(current, 'yyyy-MM-dd'));
  }
  return dates;
}

function generateSubtaskId(): string {
  return Math.random().toString(36).substring(2, 10);
}


function getTaskChangeLogs(prev: PurchasingTask, next: TaskFormData, user: { uid: string; name?: string; email?: string }): PurchasingTaskActivityLog[] {
  const logs: PurchasingTaskActivityLog[] = [];
  if (prev.startTime !== next.startTime || prev.endTime !== next.endTime) {
    logs.push(createActivityLog('time_changed', `Saat ${prev.startTime}-${prev.endTime} -> ${next.startTime}-${next.endTime} olarak değiştirildi`, user));
  }
  if (prev.date !== next.date) {
    logs.push(createActivityLog('date_changed', `Tarih ${prev.date} -> ${next.date} olarak değiştirildi`, user));
  }
  if ((prev.priority || 'normal') !== next.priority) {
    logs.push(createActivityLog('priority_changed', `Öncelik ${(prev.priority || 'normal')} -> ${next.priority} olarak değiştirildi`, user));
  }
  if ((prev.assignedPersonnel || []).map((p) => p.uid).sort().join(',') !== (next.assignedPersonnel || []).map((p) => p.uid).sort().join(',')) {
    const names = (next.assignedPersonnel || []).map((p) => p.name).join(', ');
    logs.push(createActivityLog('assignee_changed', names ? `Takipçi personeller güncellendi: ${names}` : 'Takipçi personeller temizlendi', user));
  }
  return logs;
}


function hasTimeConflict(tasks: PurchasingTask[], payload: { date: string; startTime: string; endTime: string }, excludeTaskId?: string): PurchasingTask[] {
  const start = parseTime(payload.startTime);
  const end = parseTime(payload.endTime);
  return tasks.filter((t) => {
    if (excludeTaskId && t.id === excludeTaskId) return false;
    if (t.date !== payload.date) return false;
    const ts = parseTime(t.startTime);
    const te = parseTime(t.endTime);
    return start < te && end > ts;
  });
}


interface TimelineLayoutItem {
  task: PurchasingTask;
  column: number;
  columnCount: number;
}

function buildTimelineLayout(dayTasks: PurchasingTask[]): TimelineLayoutItem[] {
  const sorted = [...dayTasks].sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
  const items: Array<TimelineLayoutItem & { end: number }> = [];

  for (const task of sorted) {
    const start = parseTime(task.startTime);
    const end = parseTime(task.endTime);
    let column = 0;
    while (items.some((i) => i.column === column && start < i.end && end > parseTime(i.task.startTime))) {
      column += 1;
    }
    items.push({ task, column, columnCount: column + 1, end });
  }

  for (const item of items) {
    const overlaps = items.filter((i) => {
      const s1 = parseTime(item.task.startTime);
      const e1 = parseTime(item.task.endTime);
      const s2 = parseTime(i.task.startTime);
      const e2 = parseTime(i.task.endTime);
      return s1 < e2 && e1 > s2;
    });
    item.columnCount = Math.max(1, ...overlaps.map((o) => o.column + 1));
  }

  return items.map(({ end, ...rest }) => rest);
}

// ==========================================
// Form data interface (shared between add & edit)
// ==========================================

interface TaskFormData {
  title: string;
  description: string;
  taskType: string;
  taskTypeLabel?: string;
  date: string;
  startTime: string;
  endTime: string;
  priority: Priority;
  laboratoryId?: string;
  laboratoryName?: string;
  accompanyingPersonnel?: { uid: string; name: string }[];
  assignedPersonnel?: { uid: string; name: string }[];
  files?: File[];
  existingAttachments?: PurchasingTaskAttachment[];
  removedAttachments?: PurchasingTaskAttachment[];
  subtasks?: PurchasingSubtask[];
  recurring?: PurchasingTaskRecurrence;
}


function nextWeekdayDate(targetWeekday: number): Date {
  const today = new Date();
  const current = today.getDay(); // 0..6 Sun..Sat
  const delta = (targetWeekday - current + 7) % 7 || 7;
  const d = new Date(today);
  d.setDate(today.getDate() + delta);
  return d;
}

function parseNaturalTaskInput(
  input: string,
  labs: Hospital[]
): {
  title: string;
  description: string;
  taskType: string;
  taskTypeLabel?: string;
  date: string;
  startTime: string;
  endTime: string;
  priority: Priority;
  laboratoryId?: string;
  laboratoryName?: string;
  recurring?: PurchasingTaskRecurrence;
} {
  const raw = input.trim();
  const lower = raw.toLowerCase('tr-TR');
  const now = new Date();

  let date = format(now, 'yyyy-MM-dd');
  if (lower.includes('yarın')) date = format(addDays(now, 1), 'yyyy-MM-dd');
  else if (lower.includes('gelecek hafta')) date = format(addWeeks(now, 1), 'yyyy-MM-dd');

  const weekdays: Record<string, number> = {
    pazar: 0,
    pazartesi: 1,
    salı: 2,
    çarşamba: 3,
    perşembe: 4,
    cuma: 5,
    cumartesi: 6,
  };

  let recurring: PurchasingTaskRecurrence | undefined;
  for (const [name, idx] of Object.entries(weekdays)) {
    if (lower.includes(`her ${name}`)) {
      date = format(nextWeekdayDate(idx), 'yyyy-MM-dd');
      recurring = { type: 'weekly', interval: 1, daysOfWeek: [idx] };
      break;
    }
  }
  if (lower.includes('her ay')) recurring = { type: 'monthly', interval: 1 };

  const rangeMatch = raw.match(/(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/);
  const singleMatch = raw.match(/saat\s*(\d{1,2})(?::(\d{2}))?/i) || raw.match(/(\d{1,2}):(\d{2})/);

  let startTime = '09:00';
  let endTime = '10:00';
  if (rangeMatch) {
    const sh = parseInt(rangeMatch[1]);
    const sm = parseInt(rangeMatch[2] || '0');
    const eh = parseInt(rangeMatch[3]);
    const em = parseInt(rangeMatch[4] || '0');
    startTime = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
    endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
  } else if (singleMatch) {
    const sh = parseInt(singleMatch[1]);
    const sm = parseInt(singleMatch[2] || '0');
    const eh = Math.min(sh + 1, 23);
    startTime = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
    endTime = `${String(eh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
  }

  let priority: Priority = 'normal';
  if (lower.includes('#acil')) priority = 'urgent';
  else if (lower.includes('#önemli')) priority = 'high';

  const matchedLab = labs.find((l) => lower.includes((l.name || '').toLowerCase('tr-TR')));
  const isVisit = !!matchedLab || lower.includes('ziyaret');

  const cleanTitle = raw
    .replace(/#\S+/g, '')
    .replace(/yarın|bugün|gelecek hafta/gi, '')
    .replace(/her\s+(pazar|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|ay)/gi, '')
    .replace(/saat\s*\d{1,2}(:\d{2})?/gi, '')
    .replace(/\d{1,2}(:\d{2})?\s*[-–]\s*\d{1,2}(:\d{2})?/g, '')
    .trim();

  return {
    title: isVisit ? (matchedLab?.name ? `${matchedLab.name} Ziyareti` : 'Kurum Ziyareti') : (cleanTitle || 'Yeni Görev'),
    description: raw,
    taskType: isVisit ? 'kurum_ziyareti' : 'custom',
    taskTypeLabel: isVisit ? 'Kurum Ziyareti' : 'Serbest Görev',
    date,
    startTime,
    endTime,
    priority,
    ...(matchedLab && { laboratoryId: matchedLab.id, laboratoryName: matchedLab.name }),
    ...(recurring && { recurring }),
  };
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
  const [editingTask, setEditingTask] = useState<PurchasingTask | null>(null);
  const [detailTask, setDetailTask] = useState<PurchasingTask | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly' | 'timeline' | 'heatmap' | 'myday'>('daily');
  const [timelineScope, setTimelineScope] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskDefinitions, setTaskDefinitions] = useState<PurchasingTaskDefinition[]>([]);
  const [showTaskDefinitionModal, setShowTaskDefinitionModal] = useState(false);
  const [mobileMonthModalDate, setMobileMonthModalDate] = useState<Date | null>(null);
  const [myDayTaskIds, setMyDayTaskIds] = useState<string[]>([]);
  const [naturalInput, setNaturalInput] = useState('');
  const [naturalSubmitting, setNaturalSubmitting] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [isOffline, setIsOffline] = useState<boolean>(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [syncInProgress, setSyncInProgress] = useState(false);
  const syncRef = useRef(false);

  const loadQueue = useCallback((): OfflineMutation[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(TASK_MUTATION_QUEUE_KEY);
      const queue: OfflineMutation[] = raw ? JSON.parse(raw) : [];
      setPendingMutations(queue.length);
      return queue;
    } catch {
      setPendingMutations(0);
      return [];
    }
  }, []);

  const saveQueue = useCallback((queue: OfflineMutation[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TASK_MUTATION_QUEUE_KEY, JSON.stringify(queue));
    setPendingMutations(queue.length);
  }, []);

  const enqueueMutation = useCallback((mutation: Omit<OfflineMutation, 'id'>) => {
    const queue = loadQueue();
    queue.push({ ...mutation, id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` });
    saveQueue(queue);
  }, [loadQueue, saveQueue]);

  // Reference data
  const [laboratories, setLaboratories] = useState<Hospital[]>([]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [personnel, setPersonnel] = useState<User[]>([]);

  const sliderRef = useRef<HTMLDivElement>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [draggedTimelineTask, setDraggedTimelineTask] = useState<PurchasingTask | null>(null);

  // Firestore listener
  useEffect(() => {
    const q = query(collection(db, 'purchasingTasks'), orderBy('date', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PurchasingTask[];
        setTasks(items);
        setTasksLoading(false);
        if (typeof window !== 'undefined') {
          localStorage.setItem(TASK_CACHE_KEY, JSON.stringify(serializeForCache(items)));
        }
      },
      (err) => {
        console.error('PurchasingTasks listen error', err);
        if (typeof window !== 'undefined') {
          try {
            const raw = localStorage.getItem(TASK_CACHE_KEY);
            if (raw) {
              setTasks(hydrateFromCache(JSON.parse(raw)) as PurchasingTask[]);
            }
          } catch (cacheErr) {
            console.error('Task cache load failed', cacheErr);
          }
        }
        setTasksLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(TASK_CACHE_KEY);
      if (raw) {
        const cached = hydrateFromCache(JSON.parse(raw)) as PurchasingTask[];
        if (cached.length > 0) setTasks((prev) => (prev.length > 0 ? prev : cached));
      }
      loadQueue();
    } catch {
      // no-op
    }
  }, [loadQueue]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const syncOfflineMutations = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.onLine || syncRef.current) return;
    const queue = loadQueue();
    if (queue.length === 0) return;

    syncRef.current = true;
    setSyncInProgress(true);
    const remaining: OfflineMutation[] = [];

    for (const mutation of queue) {
      try {
        const taskRef = doc(db, 'purchasingTasks', mutation.taskId);
        if (mutation.action === 'create' && mutation.payload) {
          await setDoc(taskRef, mutation.payload, { merge: true });
        } else if (mutation.action === 'update' && mutation.payload) {
          const remote = await getDoc(taskRef);
          if (!remote.exists()) {
            await setDoc(taskRef, mutation.payload, { merge: true });
          } else {
            const remoteData = remote.data() as PurchasingTask;
            const remoteUpdatedAtMs = getUpdatedAtMs(remoteData);
            if (mutation.baseUpdatedAtMs && remoteUpdatedAtMs > mutation.baseUpdatedAtMs) {
              await setDoc(taskRef, { ...mutation.payload, updatedAt: Timestamp.now(), conflictResolvedAt: Timestamp.now() }, { merge: true });
            } else {
              await updateDoc(taskRef, { ...mutation.payload, updatedAt: Timestamp.now() });
            }
          }
        } else if (mutation.action === 'delete') {
          await deleteDoc(taskRef);
        }
      } catch (err) {
        console.error('Offline mutation sync failed', err);
        remaining.push(mutation);
      }
    }

    saveQueue(remaining);
    if (queue.length > 0 && remaining.length === 0) toast.success('Çevrimdışı değişiklikler senkronize edildi');
    syncRef.current = false;
    setSyncInProgress(false);
  }, [loadQueue, saveQueue]);

  useEffect(() => {
    if (!isOffline) syncOfflineMutations();
  }, [isOffline, syncOfflineMutations]);

  useEffect(() => {
    const q = query(collection(db, 'purchasingTaskDefinitions'), orderBy('name', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const defs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PurchasingTaskDefinition[];
        setTaskDefinitions(defs.filter((d) => d.active !== false));
      },
      (err) => console.error('TaskDefinitions listen error', err)
    );
    return () => unsub();
  }, []);

  // Fetch reference data
  useEffect(() => {
    let cancelled = false;
    async function fetchReferenceData() {
      try {
        const [hospSnap, poolSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'labPools')),
          getDocs(query(collection(db, 'users'), where('role', 'in', ['admin', 'satin_alma']))),
        ]);
        if (cancelled) return;
        setLaboratories(hospSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)));
        setLabPools(poolSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LabPool)));
        setPersonnel(usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() } as User)));
      } catch (err) {
        console.error('Error fetching reference data', err);
      }
    }
    fetchReferenceData();
    return () => { cancelled = true; };
  }, []);

  // Main laboratories
  const mainLaboratories = useMemo(() => {
    const subLabIds = new Set<string>();
    for (const pool of labPools) {
      if (pool.active && pool.mainLabId && pool.memberIds) {
        for (const memberId of pool.memberIds) {
          if (memberId !== pool.mainLabId) subLabIds.add(memberId);
        }
      }
    }
    return laboratories.filter((lab) => !subLabIds.has(lab.id));
  }, [laboratories, labPools]);

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');

  const normalizedSearchQuery = useMemo(() => globalSearchQuery.trim().toLocaleLowerCase('tr-TR'), [globalSearchQuery]);

  const globalSearchResults = useMemo(() => {
    if (!normalizedSearchQuery) return [] as PurchasingTask[];

    return tasks
      .filter((task) => {
        const attachmentNames = (task.attachments || []).map((a) => a.name || '').join(' ');
        const assignedNames = (task.assignedPersonnel || []).map((p) => p.name || '').join(' ');
        const accompanyingNames = (task.accompanyingPersonnel || []).map((p) => p.name || '').join(' ');
        const fields = [
          task.date,
          task.title,
          task.description || '',
          task.priority || '',
          task.laboratoryName || '',
          task.createdByName || '',
          attachmentNames,
          assignedNames,
          accompanyingNames,
        ]
          .join(' ')
          .toLocaleLowerCase('tr-TR');

        return fields.includes(normalizedSearchQuery);
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? 1 : -1;
        return parseTime(a.startTime) - parseTime(b.startTime);
      });
  }, [normalizedSearchQuery, tasks]);

  const groupedSearchResults = useMemo(() => {
    const grouped = new Map<string, PurchasingTask[]>();
    for (const task of globalSearchResults) {
      const arr = grouped.get(task.date) || [];
      arr.push(task);
      grouped.set(task.date, arr);
    }
    return Array.from(grouped.entries()).sort((a, b) => (a[0] > b[0] ? 1 : -1));
  }, [globalSearchResults]);

  const handleMonthlyDayClick = useCallback((day: Date) => {
    setSelectedDate(day);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setMobileMonthModalDate(day);
    }
  }, []);

  const mobileMonthModalTasks = useMemo(() => {
    if (!mobileMonthModalDate) return [];
    const dayStr = format(mobileMonthModalDate, 'yyyy-MM-dd');
    return tasks
      .filter((t) => t.date === dayStr)
      .sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
  }, [mobileMonthModalDate, tasks]);

  // NOTE: keep an explicit alias to avoid runtime regressions from stale refs (`myTasks`)
  // in dependency arrays after merges/cherry-picks.
  const myTasks = tasks;

  // Day tasks sorted by sortOrder then startTime
  const dayTasks = useMemo(() => {
    const filtered = myTasks.filter((t) => t.date === selectedDateStr);
    return filtered.sort((a, b) => {
      const orderA = a.sortOrder ?? 999999;
      const orderB = b.sortOrder ?? 999999;
      if (orderA !== orderB) return orderA - orderB;
      return parseTime(a.startTime) - parseTime(b.startTime);
    });
  }, [myTasks, selectedDateStr]);

  // Toggle completion
  const toggleTask = useCallback(async (task: PurchasingTask) => {
    if (!currentUserProfile) return;
    const newCompleted = !task.completed;
    const log = createActivityLog(
      newCompleted ? 'completed' : 'reopened',
      newCompleted
        ? `Görev tamamlandı (${currentUserProfile.name || currentUserProfile.email || 'Kullanıcı'}, ${format(new Date(), 'HH:mm')})`
        : `Görev yeniden açıldı (${currentUserProfile.name || currentUserProfile.email || 'Kullanıcı'}, ${format(new Date(), 'HH:mm')})`,
      currentUserProfile
    );

    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: newCompleted } : t)));

    try {
      const newCompleted = !task.completed;
      const log = createActivityLog(
        newCompleted ? 'completed' : 'reopened',
        newCompleted
          ? `Görev tamamlandı (${currentUserProfile.name || currentUserProfile.email || 'Kullanıcı'}, ${format(new Date(), 'HH:mm')})`
          : `Görev yeniden açıldı (${currentUserProfile.name || currentUserProfile.email || 'Kullanıcı'}, ${format(new Date(), 'HH:mm')})`,
        currentUserProfile
      );
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        completed: newCompleted,
        activityLogs: arrayUnion(log),
        updatedAt: Timestamp.now(),
        activities: [...(task.activities || []), activity],
      });
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t)));
      console.error('Error toggling task', err);
      toast.error('Görev güncellenemedi');
    }
  }, [currentUserProfile]);


  const postponeTaskToTomorrow = useCallback(async (task: PurchasingTask) => {
    const tomorrow = format(addDays(parseISO(task.date), 1), 'yyyy-MM-dd');
    const prevDate = task.date;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, date: tomorrow } : t)));
    try {
      const log = currentUserProfile
        ? createActivityLog('postponed', `Görev ertelendi (${prevDate} -> ${tomorrow})`, currentUserProfile)
        : null;
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        date: tomorrow,
        ...(log ? { activityLogs: arrayUnion(log) } : {}),
        updatedAt: Timestamp.now(),
      });
      toast.success('Görev yarına ertelendi');
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, date: prevDate } : t)));
      console.error('Error postponing task', err);
      toast.error('Görev ertelenemedi');
    }
  }, [currentUserProfile]);

  const moveTaskTime = useCallback(async (task: PurchasingTask, date: string, startHour: number) => {
    const duration = parseTime(task.endTime) - parseTime(task.startTime);
    const startMin = Math.max(WORK_START_HOUR * 60, startHour * 60);
    const endMin = Math.min(WORK_END_HOUR * 60, startMin + duration);
    const safeStart = `${Math.floor(startMin / 60).toString().padStart(2, '0')}:${(startMin % 60).toString().padStart(2, '0')}`;
    const safeEnd = `${Math.floor(endMin / 60).toString().padStart(2, '0')}:${(endMin % 60).toString().padStart(2, '0')}`;
    const prev = { date: task.date, startTime: task.startTime, endTime: task.endTime };

    setTasks((prevTasks) => prevTasks.map((t) => (t.id === task.id ? { ...t, date, startTime: safeStart, endTime: safeEnd } : t)));

    try {
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        date,
        startTime: safeStart,
        endTime: safeEnd,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      setTasks((prevTasks) => prevTasks.map((t) => (t.id === task.id ? { ...t, ...prev } : t)));
      console.error('Error moving task in timeline', err);
      toast.error('Görev zamanı güncellenemedi');
    }
  }, []);

  // Toggle subtask
  const toggleSubtask = useCallback(async (task: PurchasingTask, subtaskId: string) => {
    if (!task.subtasks) return;
    const updated = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    );
    try {
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        subtasks: updated,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Error toggling subtask', err);
    }
  }, []);

  const addTaskComment = useCallback(async (task: PurchasingTask, message: string) => {
    if (!currentUserProfile) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    const comment: PurchasingTaskComment = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      message: trimmed,
      createdAt: Timestamp.now(),
      createdByUid: currentUserProfile.uid,
      createdByName: currentUserProfile.name || currentUserProfile.email || 'Kullanıcı',
    };
    try {
      const log = createActivityLog('comment_added', 'Göreve not eklendi', currentUserProfile);
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        comments: arrayUnion(comment),
        activityLogs: arrayUnion(log),
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Error adding task comment', err);
      toast.error('Yorum eklenemedi');
    }
  }, [currentUserProfile]);

  // Delete task
  const deleteTask = useCallback(async (task: PurchasingTask) => {
    const ok = typeof window !== 'undefined' ? window.confirm('Bu görevi silmek istediğinize emin misiniz?') : true;
    if (!ok) return;

    const prevTasks = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      enqueueMutation({ action: 'delete', taskId: task.id, baseUpdatedAtMs: getUpdatedAtMs(task) });
      toast.info('Çevrimdışı: silme işlemi sıraya alındı');
      if (editingTask?.id === task.id) setEditingTask(null);
      return;
    }

    try {
      if (task.attachments && task.attachments.length > 0) {
        for (const att of task.attachments) {
          try { await deleteObject(ref(storage, att.storagePath)); } catch { /* ok */ }
        }
      }
      await deleteDoc(doc(db, 'purchasingTasks', task.id));
      toast.success('Görev silindi');
      if (editingTask?.id === task.id) setEditingTask(null);
    } catch (err) {
      setTasks(prevTasks);
      console.error('Error deleting task', err);
      toast.error('Görev silinemedi');
    }
  }, [editingTask, tasks, enqueueMutation]);

  // Add task
  const handleAddTask = useCallback(
    async (data: TaskFormData) => {
      if (!currentUserProfile) return;
      try {
        const specialDay = getSpecialDay(data.date);
        if (specialDay?.type === 'holiday') {
          toast.warning(`Seçilen tarih resmi tatil (${specialDay.name}). Bu güne görev oluşturulmadı.`);
          return;
        }

        const conflicts = hasTimeConflict(tasks, { date: data.date, startTime: data.startTime, endTime: data.endTime });
        if (conflicts.length > 0) {
          const proceed = typeof window !== 'undefined'
            ? window.confirm(`Aynı saat aralığında ${conflicts.length} görev var. Yine de eklemek istiyor musunuz?`)
            : true;
          if (!proceed) return;
          toast.warning('Saat çakışması tespit edildi. Görev yine de eklendi.');
        }

        const taskDoc: Record<string, any> = {
          title: data.title,
          description: data.description,
          taskType: data.taskType,
          taskTypeLabel: data.taskTypeLabel || null,
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          priority: data.priority,
          completed: false,
          createdAt: Timestamp.now(),
          createdByUid: currentUserProfile.uid,
          createdByName: currentUserProfile.name || '',
          updatedAt: Timestamp.now(),
          sortOrder: Date.now(),
          activityLogs: [
            createActivityLog(
              'created',
              `Görev oluşturuldu (${currentUserProfile.name || currentUserProfile.email || 'Kullanıcı'}, ${format(new Date(), 'HH:mm')})`,
              currentUserProfile
            ),
          ],
        };

        if (data.laboratoryId || data.laboratoryName || data.accompanyingPersonnel?.length) {
          if (data.laboratoryId) taskDoc.laboratoryId = data.laboratoryId;
          if (data.laboratoryName) taskDoc.laboratoryName = data.laboratoryName;
          if (data.accompanyingPersonnel?.length) taskDoc.accompanyingPersonnel = data.accompanyingPersonnel;
        }

        if (data.assignedPersonnel?.length) taskDoc.assignedPersonnel = data.assignedPersonnel;

        if (data.subtasks?.length) taskDoc.subtasks = data.subtasks;
        if (data.recurring && (typeof navigator === 'undefined' || navigator.onLine)) {
          taskDoc.recurring = data.recurring;
          taskDoc.recurringGroupId = `rg_${Date.now()}`;
        }

        let createdTaskId = '';
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          createdTaskId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const localTask = { ...taskDoc, id: createdTaskId } as PurchasingTask;
          setTasks((prev) => [...prev, localTask]);
          enqueueMutation({ action: 'create', taskId: createdTaskId, payload: taskDoc });
          if (data.files?.length) {
            toast.warning('Çevrimdışı modda dosya yükleme desteklenmiyor. İnternete bağlanınca düzenleyip ekleyebilirsiniz.');
          }
          toast.info('Çevrimdışı: görev yerel olarak kaydedildi ve senkron kuyruğuna alındı');
        } else {
          const docRef = await addDoc(collection(db, 'purchasingTasks'), taskDoc);
          createdTaskId = docRef.id;

          // Upload files
          if (data.files?.length) {
            const attachments: PurchasingTaskAttachment[] = [];
            for (const file of data.files) {
              try {
                attachments.push(await uploadAttachment(file, docRef.id));
              } catch (err) {
                console.error('File upload error:', err);
                toast.error(`"${file.name}" yüklenemedi`);
              }
            }
            if (attachments.length > 0) {
              await updateDoc(doc(db, 'purchasingTasks', docRef.id), { attachments });
            }
          }
        }

        // Create recurring instances
        if (data.recurring && (typeof navigator === 'undefined' || navigator.onLine)) {
          const futureDates = generateRecurringDates(data.date, data.recurring);
          const filteredFutureDates = futureDates.filter((dateStr) => getSpecialDay(dateStr)?.type !== 'holiday');
          const skippedDates = futureDates.length - filteredFutureDates.length;
          if (filteredFutureDates.length > 0) {
            const batch = writeBatch(db);
            for (const futureDate of filteredFutureDates) {
              const recurDoc = {
                ...taskDoc,
                date: futureDate,
                createdAt: Timestamp.now(),
                activityLogs: [
                  createActivityLog(
                    'created',
                    `Görev oluşturuldu (${currentUserProfile.name || currentUserProfile.email || 'Kullanıcı'}, ${format(new Date(), 'HH:mm')})`,
                    currentUserProfile
                  ),
                ],
              };
              batch.set(doc(collection(db, 'purchasingTasks')), recurDoc);
            }
            await batch.commit();
            toast.success(`${filteredFutureDates.length} tekrarlayan görev oluşturuldu`);
          }
          if (skippedDates > 0) toast.info(`${skippedDates} görev resmi tatil nedeniyle oluşturulmadı`);
        }

        toast.success('Görev eklendi');
        setShowAddModal(false);
        setSelectedDate(parseISO(data.date));
      } catch (err) {
        console.error('Error adding task', err);
        toast.error('Görev eklenemedi');
      }
    },
    [currentUserProfile, tasks, enqueueMutation]
  );

  // Edit task
  const handleEditTask = useCallback(
    async (data: TaskFormData) => {
      if (!editingTask || !currentUserProfile) return;
      try {
        const conflicts = hasTimeConflict(
          tasks,
          { date: data.date, startTime: data.startTime, endTime: data.endTime },
          editingTask.id
        );
        if (conflicts.length > 0) {
          const proceed = typeof window !== 'undefined'
            ? window.confirm(`Aynı saat aralığında ${conflicts.length} görev var. Yine de güncellemek istiyor musunuz?`)
            : true;
          if (!proceed) return;
          toast.warning('Saat çakışması tespit edildi. Görev yine de güncellendi.');
        }

        const updates: Record<string, any> = {
          title: data.title,
          description: data.description,
          taskType: data.taskType,
          taskTypeLabel: data.taskTypeLabel || null,
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          priority: data.priority,
          updatedAt: Timestamp.now(),
          assignedTo: data.assignedTo?.length ? data.assignedTo : null,
          activities,
        };

        if (data.laboratoryId || data.laboratoryName || data.accompanyingPersonnel?.length) {
          updates.laboratoryId = data.laboratoryId || null;
          updates.laboratoryName = data.laboratoryName || null;
          updates.accompanyingPersonnel = data.accompanyingPersonnel?.length ? data.accompanyingPersonnel : null;
        } else {
          updates.laboratoryId = null;
          updates.laboratoryName = null;
          updates.accompanyingPersonnel = null;
        }

        updates.assignedPersonnel = data.assignedPersonnel?.length ? data.assignedPersonnel : null;

        updates.subtasks = data.subtasks?.length ? data.subtasks : null;

        if (currentUserProfile) {
          const changeLogs = getTaskChangeLogs(editingTask, data, currentUserProfile);
          if (changeLogs.length > 0) updates.activityLogs = arrayUnion(...changeLogs);
        }

        // Remove deleted attachments from storage
        if (data.removedAttachments?.length) {
          for (const att of data.removedAttachments) {
            try { await deleteObject(ref(storage, att.storagePath)); } catch { /* ok */ }
          }
        }

        // Upload new files
        let allAttachments = [...(data.existingAttachments || [])];
        if (data.files?.length) {
          for (const file of data.files) {
            try {
              allAttachments.push(await uploadAttachment(file, editingTask.id));
            } catch (err) {
              console.error('File upload error:', err);
              toast.error(`"${file.name}" yüklenemedi`);
            }
          }
        }
        updates.attachments = allAttachments.length > 0 ? allAttachments : null;

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setTasks((prev) => prev.map((t) => (t.id === editingTask.id ? ({ ...t, ...updates } as PurchasingTask) : t)));
          enqueueMutation({
            action: 'update',
            taskId: editingTask.id,
            payload: updates,
            baseUpdatedAtMs: getUpdatedAtMs(editingTask),
          });
          toast.info('Çevrimdışı: güncelleme sıraya alındı');
        } else {
          await updateDoc(doc(db, 'purchasingTasks', editingTask.id), updates);
          toast.success('Görev güncellendi');
        }
        setEditingTask(null);
        setSelectedDate(parseISO(data.date));
      } catch (err) {
        console.error('Error editing task', err);
        toast.error('Görev güncellenemedi');
      }
    },
    [editingTask, currentUserProfile, tasks, enqueueMutation]
  );

  // Drag & drop reorder (native HTML5 DnD)
  const handleDragOver = useCallback((e: React.DragEvent, targetTaskId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetTaskId: string) => {
      e.preventDefault();
      const sourceId = draggedTaskId;
      setDraggedTaskId(null);
      if (!sourceId || sourceId === targetTaskId) return;

      const oldIndex = dayTasks.findIndex((t) => t.id === sourceId);
      const newIndex = dayTasks.findIndex((t) => t.id === targetTaskId);
      if (oldIndex === -1 || newIndex === -1) return;

      // arrayMove
      const reordered = [...dayTasks];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const batch = writeBatch(db);
      reordered.forEach((task, idx) => {
        batch.update(doc(db, 'purchasingTasks', task.id), { sortOrder: idx });
      });
      try {
        await batch.commit();
      } catch (err) {
        console.error('Error reordering', err);
      }
    },
    [dayTasks, draggedTaskId]
  );

  const selectedOccupancy = getOccupancyForDay(myTasks, selectedDateStr);

  const sliderDates = useMemo(() => {
    const dates: Date[] = [];
    for (let i = -7; i <= 7; i++) dates.push(addDays(selectedDate, i));
    return dates;
  }, [selectedDate]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [calendarMonth]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
    const end = endOfWeek(selectedDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [selectedDate]);

  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [selectedDate]);


  const timelineDays = useMemo(() => {
    if (timelineScope === 'daily') return [selectedDate];
    if (timelineScope === 'weekly') return weekDays;
    return monthDays.filter((d) => isSameMonth(d, selectedDate));
  }, [timelineScope, selectedDate, weekDays, monthDays]);


  const myDayStorageKey = useMemo(() => {
    if (!currentUserProfile?.uid) return '';
    return `myday:${currentUserProfile.uid}:${format(new Date(), 'yyyy-MM-dd')}`;
  }, [currentUserProfile?.uid]);

  useEffect(() => {
    if (!myDayStorageKey) return;
    try {
      const raw = localStorage.getItem(myDayStorageKey);
      setMyDayTaskIds(raw ? JSON.parse(raw) : []);
    } catch {
      setMyDayTaskIds([]);
    }
  }, [myDayStorageKey]);

  useEffect(() => {
    if (!myDayStorageKey) return;
    localStorage.setItem(myDayStorageKey, JSON.stringify(myDayTaskIds));
  }, [myDayStorageKey, myDayTaskIds]);

  const myDaySuggestions = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return tasks
      .filter((t) => !t.completed)
      .filter((t) => t.date < today || t.date <= format(addDays(new Date(), 2), 'yyyy-MM-dd') || !!t.recurring)
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [tasks]);

  const myDayTasks = useMemo(() => {
    const setIds = new Set(myDayTaskIds);
    return tasks.filter((t) => setIds.has(t.id));
  }, [tasks, myDayTaskIds]);

  const addToMyDay = (taskId: string) => {
    setMyDayTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
  };

  const removeFromMyDay = (taskId: string) => {
    setMyDayTaskIds((prev) => prev.filter((id) => id !== taskId));
  };

  const handleNaturalQuickAdd = useCallback(async () => {
    const trimmed = naturalInput.trim();
    if (!trimmed || naturalSubmitting) return;
    try {
      setNaturalSubmitting(true);
      const parsed = parseNaturalTaskInput(trimmed, mainLaboratories);
      await handleAddTask({
        title: parsed.title,
        description: parsed.description,
        taskType: parsed.taskType,
        taskTypeLabel: parsed.taskTypeLabel,
        date: parsed.date,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        priority: parsed.priority,
        laboratoryId: parsed.laboratoryId,
        laboratoryName: parsed.laboratoryName,
        recurring: parsed.recurring,
      });
      setNaturalInput('');
      toast.success('Doğal dilden görev oluşturuldu');
    } catch (err) {
      console.error('Natural quick add error', err);
      toast.error('Görev oluşturulamadı');
    } finally {
      setNaturalSubmitting(false);
    }
  }, [naturalInput, naturalSubmitting, mainLaboratories, handleAddTask]);

  const heatmapData = useMemo(() => {
    const days = timelineScope === 'daily' ? [selectedDate] : timelineScope === 'weekly' ? weekDays : monthDays.filter((d) => isSameMonth(d, selectedDate));
    const matrix = days.map((day) => {
      const dayStr = format(day, 'yyyy-MM-dd');
      return Array.from({ length: WORK_END_HOUR - WORK_START_HOUR }, (_, idx) => {
        const hour = WORK_START_HOUR + idx;
        const slotStart = hour * 60;
        const slotEnd = (hour + 1) * 60;
        return tasks.filter((t) => {
          if (t.date !== dayStr || t.completed) return false;
          const ts = parseTime(t.startTime);
          const te = parseTime(t.endTime);
          return slotStart < te && slotEnd > ts;
        }).length;
      });
    });
    const max = Math.max(0, ...matrix.flat());
    return { days, matrix, max };
  }, [tasks, timelineScope, selectedDate, weekDays, monthDays]);
  useEffect(() => {
    if (sliderRef.current) {
      const container = sliderRef.current;
      const center = container.scrollWidth / 2 - container.clientWidth / 2;
      container.scrollTo({ left: center, behavior: 'auto' });
    }
  }, [selectedDate]);

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Header */}
      <div className="px-4 pt-6 pb-2 md:px-8 md:pt-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-muted-foreground text-sm">Satın Alma Birimi</p>
            <h1 className="text-2xl md:text-3xl font-bold mt-1">
              Merhaba, <span className={ACCENT}>{userName}</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {(isOffline || pendingMutations > 0 || syncInProgress) && (
              <div className="text-[11px] px-2 py-1 rounded-lg border border-border bg-secondary text-muted-foreground">
                {isOffline
                  ? `Offline • ${pendingMutations} bekleyen işlem`
                  : syncInProgress
                    ? 'Senkronize ediliyor...'
                    : `${pendingMutations} işlem senkronize edilmeyi bekliyor`}
              </div>
            )}
            <button
              onClick={() => setShowTaskDefinitionModal(true)}
              className="shrink-0 mt-1 p-2 rounded-xl bg-secondary border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-all"
              title="Görev tanımları"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <Link
              href="/satin-alma/analiz-planlama"
              className={cn(
                'shrink-0 mt-1 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all',
                'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
              )}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Analiz Planlama</span>
            </Link>
            <Link
              href="/satin-alma/tum-islemler"
              className={cn(
                'shrink-0 mt-1 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all',
                'bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
              )}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tüm İşlemler</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Search */}
      <div className="px-4 md:px-8 mt-2">
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
              placeholder="Görevlerde ara: tarih, personel, başlık, açıklama, öncelik, dosya adı..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-secondary border border-border text-sm outline-none"
            />
          </div>

          {normalizedSearchQuery && (
            <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-2">
              <p className="text-xs text-muted-foreground mb-2">
                {globalSearchResults.length} görev / {groupedSearchResults.length} gün eşleşti
              </p>
              <div className="max-h-52 overflow-y-auto space-y-2">
                {groupedSearchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Eşleşen kayıt bulunamadı.</p>
                ) : (
                  groupedSearchResults.map(([day, dayTasks]) => (
                    <div key={day} className="rounded-lg border border-border bg-card p-2">
                      <button
                        onClick={() => setSelectedDate(parseISO(day))}
                        className="text-[11px] font-semibold mb-1 hover:underline"
                      >
                        {format(parseISO(day), 'd MMMM EEEE', { locale: tr })}
                      </button>
                      <div className="space-y-1">
                        {dayTasks.map((task) => (
                          <button
                            key={task.id}
                            onClick={() => {
                              setSelectedDate(parseISO(task.date));
                              setEditingTask(task);
                            }}
                            className="w-full text-left text-[11px] p-1.5 rounded-md hover:bg-accent/40 border border-transparent hover:border-border"
                          >
                            <span className="font-medium">{task.startTime}</span> • {task.title}
                            <span className="text-muted-foreground"> • {task.priority}</span>
                            {task.attachments?.length ? (
                              <span className="text-muted-foreground"> • {task.attachments.map((a) => a.name).join(', ')}</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Date Slider */}
      <div className="mt-4 px-1 md:px-4">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setSelectedDate((d) => subDays(d, 1))}
            className="hidden md:block shrink-0 p-1.5 rounded-xl hover:bg-accent transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>

          <div
            ref={sliderRef}
            className="grid grid-flow-col auto-cols-[56px] sm:auto-cols-[64px] md:auto-cols-[72px] gap-1.5 overflow-x-auto scrollbar-none py-2 flex-1 min-w-0"
            style={{ scrollSnapType: 'x mandatory' }}
          >
            {sliderDates.map((date) => {
              const dateStr = format(date, 'yyyy-MM-dd');
              const isSelected = isSameDay(date, selectedDate);
              const today = isToday(date);
              const occupancy = getOccupancyForDay(tasks, dateStr);
              const dayTaskCount = tasks.filter((t) => t.date === dateStr).length;
              const specialDay = getSpecialDay(dateStr);

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(date)}
                  style={{ scrollSnapAlign: 'center' }}
                  className={cn(
                    'shrink-0 w-[56px] sm:w-[64px] md:w-auto md:flex-1 md:min-w-0 flex flex-col items-center justify-center rounded-2xl py-2.5 transition-all duration-200',
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
                  {specialDay && (
                    <span className={cn('mt-1 text-[9px] px-1 rounded-full', specialDay.type === 'holiday' ? 'bg-red-500/15 text-red-500' : 'bg-blue-500/15 text-blue-500')}>
                      {specialDay.name}
                    </span>
                  )}
                  {dayTaskCount > 0 && (
                    <div className="mt-1 flex items-center gap-0.5">
                      <div className={cn('w-1.5 h-1.5 rounded-full', isSelected ? 'bg-zinc-900/60' : getOccupancyColor(occupancy))} />
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
            className="hidden md:block shrink-0 p-1.5 rounded-xl hover:bg-accent transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Expand calendar toggle */}
      <div className="px-4 md:px-8 mt-3">
        <button
          onClick={() => { setCalendarExpanded((v) => !v); setCalendarMonth(selectedDate); }}
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
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="p-1.5 rounded-lg hover:bg-accent transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold">{format(calendarMonth, 'MMMM yyyy', { locale: tr })}</span>
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="p-1.5 rounded-lg hover:bg-accent transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => (
                <div key={d} className="text-center text-[10px] text-muted-foreground font-medium py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const isSelected = isSameDay(day, selectedDate);
                const today = isToday(day);
                const inMonth = isSameMonth(day, calendarMonth);
                const occupancy = getOccupancyForDay(tasks, dayStr);
                const hasTasks = tasks.some((t) => t.date === dayStr);
                const specialDay = getSpecialDay(dayStr);
                return (
                  <button
                    key={dayStr}
                    onClick={() => { setSelectedDate(day); setCalendarExpanded(false); }}
                    className={cn(
                      'relative flex flex-col items-center justify-center py-2 rounded-xl text-sm transition-all',
                      !inMonth && 'opacity-30',
                      isSelected ? `${ACCENT_BG} text-zinc-900 font-bold` : today ? 'bg-accent text-foreground font-semibold' : 'hover:bg-accent text-foreground'
                    )}
                  >
                    <span>{format(day, 'd')}</span>
                    {specialDay && (
                      <span className={cn('text-[9px] mt-0.5 px-1 rounded', specialDay.type === 'holiday' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-500')}>
                        •
                      </span>
                    )}
                    {hasTasks && (
                      <div className="flex items-center gap-0.5 mt-0.5">
                        <div className={cn('w-1 h-1 rounded-full', isSelected ? 'bg-zinc-900/60' : getOccupancyColor(occupancy))} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Occupancy bar */}
      <div className="px-4 md:px-8 mt-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">
            {isToday(selectedDate) ? 'Bugün' : format(selectedDate, 'd MMMM EEEE', { locale: tr })}
          </h2>
          <span className={cn('text-xs font-medium', getOccupancyRingColor(selectedOccupancy))}>
            %{selectedOccupancy} dolu
          </span>
        </div>
        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', getOccupancyColor(selectedOccupancy))}
            style={{ width: `${selectedOccupancy}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
          <span>09:00</span><span>12:00</span><span>15:00</span><span>17:00</span>
        </div>
      </div>

      {/* Natural Language Quick Add */}
      <div className="px-4 md:px-8 mt-5">
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground mb-2">Doğal dil ile hızlı görev girişi</p>
          <div className="flex gap-2">
            <input
              value={naturalInput}
              onChange={(e) => setNaturalInput(e.target.value)}
              placeholder="Örn: 'Yarın saat 14:00'da Merkez Lab ziyareti #acil"
              className="flex-1 px-3 py-2 bg-secondary border border-border rounded-xl text-sm outline-none"
            />
            <button
              onClick={handleNaturalQuickAdd}
              disabled={!naturalInput.trim() || naturalSubmitting}
              className={cn('px-3 py-2 rounded-xl text-sm font-medium', naturalInput.trim() && !naturalSubmitting ? `${ACCENT_BG} text-zinc-900` : 'bg-secondary text-muted-foreground')}
            >
              {naturalSubmitting ? 'Ekleniyor...' : 'Ekle'}
            </button>
          </div>
        </div>
      </div>

      {/* Task Views */}
      <div className="px-4 md:px-8 mt-6">
        {tasksLoading ? (
          <div className="flex items-center justify-center py-14 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Görevler yükleniyor...
          </div>
        ) : (
        <>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {viewMode === 'daily' ? `Günlük Görevler (${dayTasks.length})` : viewMode === 'weekly' ? 'Haftalık Zaman Çizelgesi' : viewMode === 'monthly' ? 'Aylık Görev Görünümü' : viewMode === 'timeline' ? 'Timeline / Gantt' : viewMode === 'heatmap' ? 'Personel Aktivite Haritası' : 'Bugünüm'}
          </h3>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary border border-border">
            {([
              ['daily', 'Günlük'],
              ['weekly', 'Haftalık'],
              ['monthly', 'Aylık'],
              ['timeline', 'Timeline'],
              ['heatmap', 'Heatmap'],
              ['myday', 'Bugünüm'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn('px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all', viewMode === mode ? `${ACCENT_BG} text-zinc-900` : 'text-muted-foreground hover:text-foreground')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {viewMode === 'myday' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-3">
              <h4 className="text-sm font-semibold mb-2">Bugünüm</h4>
              {myDayTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">Bugün için henüz görev seçmediniz.</p>
              ) : (
                <div className="space-y-2">
                  {myDayTasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-secondary/50 border border-border">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{task.title}</p>
                        <p className="text-[11px] text-muted-foreground">{task.date} • {task.startTime}-{task.endTime}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditingTask(task)} className="text-[11px] px-2 py-1 rounded bg-secondary border border-border">Aç</button>
                        <button onClick={() => removeFromMyDay(task.id)} className="text-[11px] px-2 py-1 rounded bg-secondary border border-border text-muted-foreground">Çıkar</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-3">
              <h4 className="text-sm font-semibold mb-2">Akıllı Öneriler</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {myDaySuggestions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Önerilecek görev bulunamadı.</p>
                ) : (
                  myDaySuggestions.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-secondary/40 border border-border">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{task.title}</p>
                        <p className="text-[11px] text-muted-foreground">{task.date} • {task.startTime}-{task.endTime}{task.recurring ? ' • Tekrarlı' : ''}</p>
                      </div>
                      <button
                        onClick={() => addToMyDay(task.id)}
                        disabled={myDayTaskIds.includes(task.id)}
                        className={cn('text-[11px] px-2 py-1 rounded border', myDayTaskIds.includes(task.id) ? 'bg-secondary text-muted-foreground border-border' : `${ACCENT_BG_SUBTLE} ${ACCENT} ${ACCENT_BORDER}`)}
                      >
                        {myDayTaskIds.includes(task.id) ? 'Eklendi' : 'Bugüne ekle'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {viewMode === 'daily' && (
          dayTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CalendarIcon className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">Bu güne ait görev bulunmuyor</p>
              <button onClick={() => setShowAddModal(true)} className={cn('mt-3 text-xs hover:underline', ACCENT)}>
                Yeni görev ekle
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {dayTasks.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => { setDraggedTaskId(task.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => setDraggedTaskId(null)}
                  onDragOver={(e) => handleDragOver(e, task.id)}
                  onDrop={(e) => handleDrop(e, task.id)}
                  className={cn(draggedTaskId === task.id && 'opacity-50')}
                >
                  <TaskCard
                    task={task}
                    onToggle={() => toggleTask(task)}
                    onToggleSubtask={(stId) => toggleSubtask(task, stId)}
                    onEdit={() => setEditingTask(task)}
                    onDelete={() => deleteTask(task)}
                    onAddComment={(message) => addTaskComment(task, message)}
                    onPostpone={() => postponeTaskToTomorrow(task)}
                  />
                </div>
              ))}
            </div>
          )
        )}

        {viewMode === 'weekly' && (
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2"> 
            {weekDays.map((day) => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const dayTasksForWeek = tasks
                .filter((t) => t.date === dayStr)
                .sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
              const layout = buildTimelineLayout(dayTasksForWeek);

              return (
                <div key={dayStr} className={cn('rounded-xl border p-2', isSameDay(day, selectedDate) ? `${ACCENT_BORDER} bg-card` : 'border-border bg-card')}>
                  <button onClick={() => setSelectedDate(day)} className="w-full text-left mb-2">
                    <p className="text-[11px] text-muted-foreground uppercase">{format(day, 'EEE', { locale: tr })}</p>
                    <p className={cn('text-sm font-semibold', isToday(day) && ACCENT)}>{format(day, 'd MMM', { locale: tr })}</p>
                  </button>
                  <div className="relative h-[420px] rounded-lg bg-secondary/40 border border-border overflow-hidden">
                    {[9, 11, 13, 15, 17].map((h) => (
                      <div key={h} className="absolute left-0 right-0 border-t border-border/60" style={{ top: `${((h - 9) / 8) * 100}%` }} />
                    ))}

                    {Array.from({ length: WORK_END_HOUR - WORK_START_HOUR }, (_, idx) => {
                      const hour = WORK_START_HOUR + idx;
                      const top = ((hour - WORK_START_HOUR) / (WORK_END_HOUR - WORK_START_HOUR)) * 100;
                      return (
                        <div
                          key={`drop-${dayStr}-${hour}`}
                          className="absolute left-0 right-0 h-[12.5%] z-10"
                          style={{ top: `${top}%` }}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (!draggedTimelineTask) return;
                            moveTaskTime(draggedTimelineTask, dayStr, hour);
                            setDraggedTimelineTask(null);
                          }}
                        />
                      );
                    })}

                    {layout.map((item) => {
                      const task = item.task;
                      const start = Math.max(parseTime(task.startTime), WORK_START_HOUR * 60);
                      const end = Math.min(parseTime(task.endTime), WORK_END_HOUR * 60);
                      if (end <= start) return null;
                      const topPct = ((start - WORK_START_HOUR * 60) / TOTAL_WORK_MINUTES) * 100;
                      const heightPct = ((end - start) / TOTAL_WORK_MINUTES) * 100;
                      const widthPct = 100 / item.columnCount;
                      const leftPct = item.column * widthPct;

                      return (
                        <button
                          key={task.id}
                          draggable
                          onDragStart={(e) => { setDraggedTimelineTask(task); e.dataTransfer.effectAllowed = 'move'; }}
                          onDragEnd={() => setDraggedTimelineTask(null)}
                          onClick={() => setEditingTask(task)}
                          className={cn('absolute rounded-md px-1.5 py-1 text-left border-l-2 text-[10px] overflow-hidden z-20', task.completed ? 'bg-muted/60 border-muted-foreground/40 text-muted-foreground' : `${PRIORITY_CONFIG[(task.priority || 'normal') as Priority].bg} ${PRIORITY_CONFIG[(task.priority || 'normal') as Priority].border} text-foreground`)}
                          style={{ top: `${topPct}%`, height: `${Math.max(heightPct, 8)}%`, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }}
                          title="Sürükleyip saat/gün değiştirin"
                        >
                          <p className="truncate font-medium">{task.title}</p>
                          <p className="truncate opacity-70">{task.startTime} - {task.endTime}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {viewMode === 'timeline' && (
          <div className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h4 className="text-xs font-semibold text-muted-foreground">Zaman Çizelgesi (Gantt)</h4>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary border border-border">
                {(['daily', 'weekly', 'monthly'] as const).map((scope) => (
                  <button
                    key={scope}
                    onClick={() => setTimelineScope(scope)}
                    className={cn('px-2 py-1 text-[10px] rounded-lg', timelineScope === scope ? `${ACCENT_BG} text-zinc-900` : 'text-muted-foreground')}
                  >
                    {scope === 'daily' ? 'Günlük' : scope === 'weekly' ? 'Haftalık' : 'Aylık'}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="grid gap-2" style={{ gridTemplateColumns: `80px repeat(${timelineDays.length}, minmax(120px, 1fr))` }}>
                <div />
                {timelineDays.map((day) => (
                  <div key={day.toISOString()} className="text-[10px] text-center text-muted-foreground">{format(day, 'd MMM', { locale: tr })}</div>
                ))}

                {Array.from({ length: WORK_END_HOUR - WORK_START_HOUR }, (_, idx) => {
                  const hour = WORK_START_HOUR + idx;
                  return (
                    <React.Fragment key={`r-${hour}`}>
                      <div className="text-[10px] text-muted-foreground pr-2">{`${hour.toString().padStart(2, '0')}:00`}</div>
                      {timelineDays.map((day) => {
                        const dayStr = format(day, 'yyyy-MM-dd');
                        const cnt = tasks.filter((t) => {
                          if (t.date !== dayStr) return false;
                          const s = parseTime(t.startTime);
                          const e = parseTime(t.endTime);
                          const ss = hour * 60;
                          const ee = (hour + 1) * 60;
                          return ss < e && ee > s;
                        }).length;
                        return <div key={`${dayStr}-${hour}`} className={cn('h-8 border rounded', cnt > 0 ? 'bg-[#d4ec00]/20 border-[#d4ec00]/30' : 'bg-secondary/30 border-border')} />;
                      })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Çakışan görevler aynı satırda birden fazla blok olarak gösterilir; haftalık görünümde blokları sürükleyip saat/gün değiştirin.</p>
          </div>
        )}

        {viewMode === 'heatmap' && (
          <div className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-muted-foreground">Personel Aktivite Haritası</h4>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary border border-border">
                {(['weekly', 'monthly'] as const).map((scope) => (
                  <button
                    key={scope}
                    onClick={() => setTimelineScope(scope)}
                    className={cn('px-2 py-1 text-[10px] rounded-lg', timelineScope === scope ? `${ACCENT_BG} text-zinc-900` : 'text-muted-foreground')}
                  >
                    {scope === 'weekly' ? 'Haftalık' : 'Aylık'}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="grid gap-1" style={{ gridTemplateColumns: `60px repeat(${heatmapData.days.length}, minmax(18px, 1fr))` }}>
                <div />
                {heatmapData.days.map((d) => (
                  <div key={d.toISOString()} className="text-[9px] text-center text-muted-foreground">{timelineScope === 'weekly' ? format(d, 'EEE', { locale: tr }) : format(d, 'd')}</div>
                ))}
                {Array.from({ length: WORK_END_HOUR - WORK_START_HOUR }, (_, idx) => {
                  const hour = WORK_START_HOUR + idx;
                  return (
                    <React.Fragment key={`h-${hour}`}>
                      <div className="text-[9px] text-muted-foreground">{hour}:00</div>
                      {heatmapData.days.map((_, di) => {
                        const val = heatmapData.matrix[di]?.[idx] || 0;
                        return <div key={`${di}-${idx}`} className={cn('h-5 border rounded-sm', getHeatColor(val, heatmapData.max))} title={`${val} görev`} />;
                      })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Boş zaman blokları yeşil, yoğun bloklar kırmızıya yakın tonlarda gösterilir.</p>
          </div>
        )}

        {viewMode === 'monthly' && (
          <div className="bg-card border border-border rounded-2xl p-3">
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => (
                <div key={d} className="text-center text-[10px] text-muted-foreground font-medium py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthDays.map((day) => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const cellTasks = tasks.filter((t) => t.date === dayStr).sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
                const inMonth = isSameMonth(day, selectedDate);
                const selected = isSameDay(day, selectedDate);
                const specialDay = getSpecialDay(dayStr);
                return (
                  <button
                    key={dayStr}
                    onClick={() => handleMonthlyDayClick(day)}
                    className={cn('min-h-[84px] md:min-h-[110px] rounded-xl border p-1.5 text-left transition-colors', selected ? `${ACCENT_BORDER} ring-1 ${ACCENT_RING}` : 'border-border hover:bg-accent/40', !inMonth && 'opacity-40')}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn('text-[11px] font-semibold', isToday(day) && ACCENT)}>{format(day, 'd')}</span>
                      {cellTasks.length > 0 && <span className="text-[9px] text-muted-foreground">{cellTasks.length} görev</span>}
                    </div>
                    {specialDay && (
                      <p className={cn('text-[9px] mb-1 truncate', specialDay.type === 'holiday' ? 'text-red-500' : 'text-blue-500')}>
                        {specialDay.name}
                      </p>
                    )}
                    <div className="space-y-1">
                      {cellTasks.slice(0, 3).map((task) => (
                        <div key={task.id} className={cn('text-[10px] rounded px-1 py-0.5 truncate border-l-2', task.completed ? 'bg-secondary text-muted-foreground border-muted-foreground/40' : `${PRIORITY_CONFIG[(task.priority || 'normal') as Priority].bg} ${PRIORITY_CONFIG[(task.priority || 'normal') as Priority].border}`)}>
                          {task.startTime} {task.title}
                        </div>
                      ))}
                      {cellTasks.length > 3 && (
                        <p className="text-[10px] text-muted-foreground">+{cellTasks.length - 3} daha</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </>
      )}
      </div>

      {mobileMonthModalDate && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMonthModalDate(null)} />
          <div className="absolute inset-x-3 bottom-4 top-20 bg-card border border-border rounded-2xl shadow-xl p-3 flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div>
                <p className="text-xs text-muted-foreground">Günlük Görevler</p>
                <h4 className="text-sm font-semibold">{format(mobileMonthModalDate, 'd MMMM EEEE', { locale: tr })}</h4>
              </div>
              <button
                onClick={() => setMobileMonthModalDate(null)}
                className="p-2 rounded-lg bg-secondary border border-border"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 overflow-y-auto flex-1 space-y-2">
              {mobileMonthModalTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">Bu gün için görev bulunmuyor.</p>
              ) : (
                mobileMonthModalTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => {
                      setEditingTask(task);
                      setMobileMonthModalDate(null);
                    }}
                    className="w-full text-left p-2 rounded-xl border border-border bg-secondary/40"
                  >
                    <p className="text-sm truncate">{task.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{task.startTime} - {task.endTime}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <PurchasingAgentChat
        userUid={currentUserProfile?.uid}
        userName={currentUserProfile?.name || currentUserProfile?.email || 'Kullanıcı'}
      />

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


      {showTaskDefinitionModal && (
        <TaskDefinitionsModal
          definitions={taskDefinitions}
          onClose={() => setShowTaskDefinitionModal(false)}
          onCreate={async (name, requiresLaboratory) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            const exists = taskDefinitions.some((d) => d.name.toLowerCase() === trimmed.toLowerCase());
            if (exists) {
              toast.error('Bu görev tanımı zaten mevcut');
              return;
            }
            await addDoc(collection(db, 'purchasingTaskDefinitions'), {
              name: trimmed,
              requiresLaboratory,
              active: true,
              createdAt: Timestamp.now(),
            });
            toast.success('Görev tanımı eklendi');
          }}
          onDelete={async (id) => {
            const ok = typeof window !== 'undefined' ? window.confirm('Görev tanımı silinsin mi?') : true;
            if (!ok) return;
            await deleteDoc(doc(db, 'purchasingTaskDefinitions', id));
            toast.success('Görev tanımı silindi');
          }}
        />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <TaskFormModal
          mode="add"
          defaultDate={selectedDateStr}
          laboratories={mainLaboratories}
          personnel={personnel}
          taskDefinitions={taskDefinitions}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddTask}
        />
      )}

      {/* Edit Modal */}
      {editingTask && (
        <TaskFormModal
          mode="edit"
          task={editingTask}
          defaultDate={editingTask.date}
          laboratories={mainLaboratories}
          personnel={personnel}
          taskDefinitions={taskDefinitions}
          onClose={() => setEditingTask(null)}
          onSubmit={handleEditTask}
          onDelete={() => deleteTask(editingTask)}
        />
      )}
    </div>
  );
}

// ==========================================
// Task Card
// ==========================================

function TaskCard({
  task,
  onToggle,
  onToggleSubtask,
  onEdit,
  onDelete,
  onAddComment,
  onPostpone,
}: {
  task: PurchasingTask;
  onToggle: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddComment: (message: string) => void;
  onPostpone: () => void;
}) {
  const durationMin = parseTime(task.endTime) - parseTime(task.startTime);
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;
  const isVisit = task.taskType === 'kurum_ziyareti' || !!task.laboratoryId;
  const priority = (task.priority || 'normal') as Priority;
  const priorityConf = PRIORITY_CONFIG[priority];
  const completedSubtasks = task.subtasks?.filter((s) => s.completed).length || 0;
  const totalSubtasks = task.subtasks?.length || 0;
  const assignedPersonnel = task.assignedPersonnel || [];
  const comments = (task.comments || []).slice().sort((a, b) => {
    const ta = 'seconds' in (a.createdAt as any) ? (a.createdAt as any).seconds : 0;
    const tb = 'seconds' in (b.createdAt as any) ? (b.createdAt as any).seconds : 0;
    return ta - tb;
  });
  const activityLogs = (task.activityLogs || []).slice().sort((a, b) => {
    const ta = 'seconds' in (a.createdAt as any) ? (a.createdAt as any).seconds : 0;
    const tb = 'seconds' in (b.createdAt as any) ? (b.createdAt as any).seconds : 0;
    return tb - ta;
  });
  const [showComments, setShowComments] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [showActivityLogs, setShowActivityLogs] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const submitComment = () => {
    const trimmed = commentInput.trim();
    if (!trimmed) return;
    onAddComment(trimmed);
    setCommentInput('');
    setShowComments(true);
  };



  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0]?.clientX ?? null);
    setTouchStartY(e.touches[0]?.clientY ?? null);
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX === null || touchStartY === null) return;
    const currX = e.touches[0]?.clientX ?? touchStartX;
    const currY = e.touches[0]?.clientY ?? touchStartY;
    const deltaX = currX - touchStartX;
    const deltaY = currY - touchStartY;

    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      setSwipeOffset(0);
      return;
    }

    const clamped = Math.max(-120, Math.min(120, deltaX));
    setSwipeOffset(clamped);
  };

  const triggerHaptic = (pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX;
    const delta = endX - touchStartX;
    setTouchStartX(null);
    setTouchStartY(null);
    setIsSwiping(false);

    if (delta > 85) {
      setSwipeOffset(110);
      setTimeout(() => setSwipeOffset(0), 140);
      onToggle();
      triggerHaptic([12, 30, 18]);
      toast.success('Sağa kaydırıldı: görev tamamlandı');
      return;
    }

    if (delta < -85) {
      setSwipeOffset(-110);
      setTimeout(() => setSwipeOffset(0), 140);
      onPostpone();
      triggerHaptic([10, 24, 10]);
      toast.success('Sola kaydırıldı: görev ertelendi');
      return;
    }

    setSwipeOffset(0);
  };
  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-between px-3 text-[11px] font-semibold',
          swipeOffset > 0 ? 'bg-emerald-500/15 text-emerald-600' : swipeOffset < 0 ? 'bg-amber-500/15 text-amber-600' : 'bg-transparent text-transparent'
        )}
      >
        <span>{swipeOffset > 0 ? '✔ Tamamlanacak' : ''}</span>
        <span>{swipeOffset < 0 ? '↪ Ertelenecek' : ''}</span>
      </div>

      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ transform: `translateX(${swipeOffset}px)` }}
        className={cn(
          'group relative flex items-start gap-3 p-4 rounded-2xl border-l-[3px] border border-border',
          isSwiping ? 'transition-none' : 'transition-transform duration-200',
          priorityConf.border,
          task.completed ? 'bg-card/50 border-border/50' : 'bg-card hover:border-muted-foreground/30'
        )}
      >
      {/* Drag handle */}
      <div className="shrink-0 mt-1 p-0.5 rounded cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground">
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={cn(
          'shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
          task.completed ? `${ACCENT_BG} border-[#d4ec00]` : 'border-muted-foreground/40 hover:border-[#d4ec00]'
        )}
      >
        {task.completed && <Check className="w-3 h-3 text-zinc-900" strokeWidth={3} />}
      </button>

      {/* Content - clickable to edit */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn('text-sm font-medium leading-tight transition-all', task.completed ? 'line-through text-muted-foreground' : 'text-foreground')}>
            {task.title}
          </p>
          {isVisit && (
            <span className={cn('shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium', ACCENT_BG_SUBTLE, ACCENT)}>Ziyaret</span>
          )}
          {/* Priority badge */}
          {priority !== 'normal' && (
            <span className={cn('shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium', priorityConf.bg, priorityConf.color)}>
              <priorityConf.icon className="w-2.5 h-2.5" />
              {priorityConf.label}
            </span>
          )}
          {/* Recurring badge */}
          {task.recurring && (
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-purple-500/10 text-purple-400">
              <Repeat className="w-2.5 h-2.5" />
            </span>
          )}
        </div>

        {isVisit && task.laboratoryName && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Building2 className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{task.laboratoryName}</span>
          </div>
        )}

        {task.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
        )}

        {isVisit && task.accompanyingPersonnel && task.accompanyingPersonnel.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Users className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">{task.accompanyingPersonnel.map((p) => p.name).join(', ')}</span>
          </div>
        )}

        {assignedPersonnel.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Users className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Takipçiler: {assignedPersonnel.map((p) => p.name).join(', ')}</span>
          </div>
        )}

        {/* Subtasks */}
        {task.subtasks && task.subtasks.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ListChecks className="w-3 h-3" />
              <span>{completedSubtasks}/{totalSubtasks} alt görev</span>
              <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden ml-1">
                <div
                  className={cn('h-full rounded-full transition-all', ACCENT_BG)}
                  style={{ width: `${totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) * 100 : 0}%` }}
                />
              </div>
            </div>
            {task.subtasks.map((st) => (
              <button
                key={st.id}
                onClick={(e) => { e.stopPropagation(); onToggleSubtask(st.id); }}
                className="flex items-center gap-2 text-left w-full group/st"
              >
                {st.completed ? (
                  <CheckSquare className={cn('w-3.5 h-3.5 shrink-0', ACCENT)} />
                ) : (
                  <Square className="w-3.5 h-3.5 shrink-0 text-muted-foreground group-hover/st:text-foreground" />
                )}
                <span className={cn('text-[11px]', st.completed ? 'line-through text-muted-foreground' : 'text-foreground/80')}>
                  {st.title}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Attachments */}
        {task.attachments && task.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {task.attachments.map((att, idx) => (
              <a
                key={idx}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all hover:brightness-110',
                  att.type === 'image' ? 'bg-blue-500/10 text-blue-500' : 'bg-red-500/10 text-red-500'
                )}
              >
                {att.type === 'image' ? <ImageIcon className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                <span className="truncate max-w-[100px]">{att.name}</span>
              </a>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span className="text-[11px]">{task.startTime} - {task.endTime}</span>
          </div>
          <span className="text-[11px] text-muted-foreground/70">
            {hours > 0 ? `${hours}s ` : ''}{mins > 0 ? `${mins}dk` : ''}
          </span>
        </div>

        <div className="mt-3 border-t border-border/60 pt-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setShowActivityLogs((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Geçmiş ({activityLogs.length})</span>
          </button>

          {showActivityLogs && (
            <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {activityLogs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Henüz hareket kaydı yok.</p>
              ) : (
                activityLogs.map((log) => (
                  <div key={log.id} className="rounded-lg bg-secondary/70 px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium text-foreground/90">{log.createdByName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {log.createdAt && 'seconds' in (log.createdAt as any)
                          ? format(new Date((log.createdAt as any).seconds * 1000), 'dd.MM HH:mm')
                          : '-'}
                      </span>
                    </div>
                    <p className="text-[11px] text-foreground/80 mt-0.5 whitespace-pre-wrap">{log.message}</p>
                  </div>
                ))
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mt-2"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Notlar ({comments.length})</span>
          </button>

          {showComments && (
            <div className="mt-2 space-y-2">
              {comments.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Henüz not eklenmedi.</p>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {comments.map((comment) => (
                    <div key={comment.id} className="rounded-lg bg-secondary/70 px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-foreground/90">{comment.createdByName}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {comment.createdAt && 'seconds' in (comment.createdAt as any)
                            ? format(new Date((comment.createdAt as any).seconds * 1000), 'dd.MM HH:mm')
                            : '-'}
                        </span>
                      </div>
                      <p className="text-[11px] text-foreground/80 mt-0.5 whitespace-pre-wrap">{comment.message}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <input
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitComment();
                    }
                  }}
                  placeholder="Göreve not ekleyin..."
                  className="flex-1 h-8 px-2.5 bg-secondary border border-border rounded-lg text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
                />
                <button
                  type="button"
                  onClick={submitComment}
                  className={cn('h-8 w-8 rounded-lg flex items-center justify-center', ACCENT_BG, 'text-zinc-900')}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Time bar */}
      <div className="shrink-0 w-1 h-10 rounded-full bg-secondary overflow-hidden self-center">
        <div
          className={cn('w-full rounded-full transition-all', task.completed ? 'bg-muted-foreground/30' : ACCENT_BG)}
          style={{ height: `${Math.min((durationMin / TOTAL_WORK_MINUTES) * 100, 100)}%` }}
        />
      </div>

      {/* Actions */}
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-all">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-red-400 transition-all">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      </div>
    </div>
  );
}


function TaskDefinitionsModal({
  definitions,
  onClose,
  onCreate,
  onDelete,
}: {
  definitions: PurchasingTaskDefinition[];
  onClose: () => void;
  onCreate: (name: string, requiresLaboratory: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [requiresLaboratory, setRequiresLaboratory] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate(name, requiresLaboratory);
      setName('');
      setRequiresLaboratory(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-card border border-border rounded-t-3xl md:rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Görev Tanımları</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-2 mb-4">
          {definitions.map((def) => (
            <div key={def.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{def.name}</p>
                {def.requiresLaboratory && <p className="text-[10px] text-muted-foreground">Laboratuvar seçimi zorunlu</p>}
              </div>
              <button onClick={() => onDelete(def.id)} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {definitions.length === 0 && <p className="text-xs text-muted-foreground">Henüz tanım yok.</p>}
        </div>

        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Yeni görev tanımı"
            className="w-full px-4 py-3 bg-secondary border border-border rounded-xl text-sm outline-none"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={requiresLaboratory} onChange={(e) => setRequiresLaboratory(e.target.checked)} />
            Bu tanım laboratuvar gerektirir (kurum ziyareti benzeri)
          </label>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            className={cn('w-full py-2.5 rounded-xl text-sm font-semibold', name.trim() && !saving ? `${ACCENT_BG} text-zinc-900` : 'bg-secondary text-muted-foreground')}
          >
            Tanım Ekle
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Task Form Modal (Add & Edit)
// ==========================================

function TaskFormModal({
  mode,
  task,
  defaultDate,
  laboratories,
  personnel,
  taskDefinitions,
  onClose,
  onSubmit,
  onDelete,
}: {
  mode: 'add' | 'edit';
  task?: PurchasingTask;
  defaultDate: string;
  laboratories: Hospital[];
  personnel: User[];
  taskDefinitions: PurchasingTaskDefinition[];
  onClose: () => void;
  onSubmit: (data: TaskFormData) => void;
  onDelete?: () => void;
}) {
  const isEdit = mode === 'edit' && task;

  const [taskType, setTaskType] = useState<string>(isEdit ? task.taskType || 'custom' : (taskDefinitions[0]?.id || 'custom'));
  const [title, setTitle] = useState(isEdit ? ((task.taskType || 'custom') === 'kurum_ziyareti' ? '' : task.title) : '');
  const [description, setDescription] = useState(isEdit ? task.description || '' : '');
  const [date, setDate] = useState(isEdit ? task.date : defaultDate);
  const [startTime, setStartTime] = useState(isEdit ? task.startTime : '09:00');
  const [endTime, setEndTime] = useState(isEdit ? task.endTime : '10:00');
  const [priority, setPriority] = useState<Priority>(isEdit ? (task.priority || 'normal') as Priority : 'normal');
  const [submitting, setSubmitting] = useState(false);

  // Kurum ziyareti
  const [selectedLabId, setSelectedLabId] = useState(isEdit ? task.laboratoryId || '' : '');
  const [selectedPersonnel, setSelectedPersonnel] = useState<{ uid: string; name: string }[]>(
    isEdit ? task.accompanyingPersonnel || [] : []
  );
  const [assignedPersonnel, setAssignedPersonnel] = useState<{ uid: string; name: string }[]>(
    isEdit ? task.assignedPersonnel || [] : []
  );
  const [labSearchQuery, setLabSearchQuery] = useState('');
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState('');
  const [showLabDropdown, setShowLabDropdown] = useState(false);
  const [showPersonnelDropdown, setShowPersonnelDropdown] = useState(false);
  const [showAssignedDropdown, setShowAssignedDropdown] = useState(false);

  // Files
  const [files, setFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<PurchasingTaskAttachment[]>(
    isEdit ? task.attachments || [] : []
  );
  const [removedAttachments, setRemovedAttachments] = useState<PurchasingTaskAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subtasks
  const [subtasks, setSubtasks] = useState<PurchasingSubtask[]>(isEdit ? task.subtasks || [] : []);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  // Recurring
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringType, setRecurringType] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [recurringInterval, setRecurringInterval] = useState(1);
  const [recurringEndDate, setRecurringEndDate] = useState('');

  const labDropdownRef = useRef<HTMLDivElement>(null);
  const personnelDropdownRef = useRef<HTMLDivElement>(null);
  const assignedDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (labDropdownRef.current && !labDropdownRef.current.contains(e.target as Node)) setShowLabDropdown(false);
      if (personnelDropdownRef.current && !personnelDropdownRef.current.contains(e.target as Node)) setShowPersonnelDropdown(false);
      if (assignedDropdownRef.current && !assignedDropdownRef.current.contains(e.target as Node)) setShowAssignedDropdown(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedDefinition = taskDefinitions.find((d) => d.id === taskType);
  const isVisitType = taskType === 'kurum_ziyareti' || !!selectedDefinition?.requiresLaboratory;
  const effectiveTitle = isVisitType ? (selectedDefinition?.name || 'Kurum Ziyareti') : title;
  const selectedLab = laboratories.find((l) => l.id === selectedLabId);


  useEffect(() => {
    if (!isVisitType) {
      setSelectedLabId('');
      setSelectedPersonnel([]);
    }
  }, [isVisitType]);

  const filteredLabs = useMemo(() => {
    if (!labSearchQuery.trim()) return laboratories;
    const q = labSearchQuery.toLowerCase();
    return laboratories.filter((l) => (l.name || '').toLowerCase().includes(q) || (l.kod || '').toLowerCase().includes(q));
  }, [laboratories, labSearchQuery]);

  const filteredPersonnel = useMemo(() => {
    if (!personnelSearchQuery.trim()) return personnel;
    const q = personnelSearchQuery.toLowerCase();
    return personnel.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q));
  }, [personnel, personnelSearchQuery]);

  const timeValid = parseTime(endTime) > parseTime(startTime);
  const descriptionValid = description.trim().length > 0;
  const titleValid = isVisitType || title.trim().length > 0;
  const labValid = !isVisitType || selectedLabId !== '';
  const valid = titleValid && descriptionValid && timeValid && labValid;

  const togglePersonnel = (user: User) => {
    setSelectedPersonnel((prev) => {
      const exists = prev.find((p) => p.uid === user.uid);
      if (exists) return prev.filter((p) => p.uid !== user.uid);
      return [...prev, { uid: user.uid, name: user.name || user.email || '' }];
    });
  };

  const toggleAssignedPersonnel = (user: User) => {
    setAssignedPersonnel((prev) => {
      const exists = prev.find((p) => p.uid === user.uid);
      if (exists) return prev.filter((p) => p.uid !== user.uid);
      return [...prev, { uid: user.uid, name: user.name || user.email || '' }];
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const allowed = Array.from(selected).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
    const sizeFiltered = Array.from(selected).filter((f) => f.size <= MAX_ATTACHMENT_SIZE_BYTES);
    if (allowed.length < selected.length) toast.error('Sadece resim ve PDF dosyaları yüklenebilir');
    if (sizeFiltered.length < allowed.length) toast.error('10MB üzeri dosyalar eklenemez');
    setFiles((prev) => [...prev, ...sizeFiltered.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')]);
    e.target.value = '';
  };

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const removeExistingAttachment = (att: PurchasingTaskAttachment) => {
    setExistingAttachments((prev) => prev.filter((a) => a.storagePath !== att.storagePath));
    setRemovedAttachments((prev) => [...prev, att]);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const addSubtask = () => {
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    setSubtasks((prev) => [...prev, { id: generateSubtaskId(), title: trimmed, completed: false }]);
    setNewSubtaskTitle('');
  };

  const removeSubtask = (id: string) => setSubtasks((prev) => prev.filter((s) => s.id !== id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    await onSubmit({
      title: effectiveTitle,
      description: description.trim(),
      taskType,
      taskTypeLabel: selectedDefinition?.name || (taskType === 'custom' ? 'Serbest Görev' : taskType),
      date,
      startTime,
      endTime,
      priority,
      ...(isVisitType && {
        laboratoryId: selectedLabId,
        laboratoryName: selectedLab?.name || '',
        accompanyingPersonnel: selectedPersonnel.length > 0 ? selectedPersonnel : undefined,
      }),
      assignedPersonnel: assignedPersonnel.length > 0 ? assignedPersonnel : undefined,
      files: files.length > 0 ? files : undefined,
      existingAttachments: existingAttachments.length > 0 ? existingAttachments : undefined,
      removedAttachments: removedAttachments.length > 0 ? removedAttachments : undefined,
      subtasks: subtasks.length > 0 ? subtasks : undefined,
      ...(isRecurring && !isEdit && {
        recurring: {
          type: recurringType,
          interval: recurringInterval,
          ...(recurringEndDate && { endDate: recurringEndDate }),
        },
      }),
    });
    setSubmitting(false);
  };

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
          <h3 className="text-lg font-bold text-foreground">
            {isEdit ? 'Görevi Düzenle' : 'Yeni Görev'}
          </h3>
          <div className="flex items-center gap-1">
            {isEdit && onDelete && (
              <button
                type="button"
                onClick={() => { onDelete(); }}
                className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Task Type Selector */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Görev Tanımı</label>
            <div className="relative">
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                className={cn(inputCls, 'pr-10 appearance-none')}
              >
                {taskDefinitions.length === 0 && <option value="custom">Serbest Görev</option>}
                {taskDefinitions.map((def) => (
                  <option key={def.id} value={def.id}>{def.name}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Yeni görev tanımları sol üstteki çark butonundan eklenebilir.</p>
          </div>

{/* Priority Selector */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Öncelik</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(([key, conf]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPriority(key)}
                  className={cn(
                    'flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[11px] font-medium border transition-all',
                    priority === key ? cn(conf.bg, conf.color, 'border-current') : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  <conf.icon className="w-3 h-3" />
                  {conf.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          {!isVisitType ? (
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Görev Adı *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Görev başlığı girin" className={inputCls} autoFocus />
            </div>
          ) : (
            <div className={cn('flex items-center gap-2 px-4 py-3 rounded-xl border', ACCENT_BG_SUBTLE, 'border-border/50')}>
              <Building2 className={cn('w-4 h-4', ACCENT)} />
              <span className="text-sm font-medium text-foreground">{selectedDefinition?.name || 'Kurum Ziyareti'}</span>
            </div>
          )}

          {/* Laboratory selector (kurum_ziyareti only) */}
          {isVisitType && (
            <div ref={labDropdownRef} className="relative">
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Kurum (Laboratuvar) *</label>
              <button
                type="button"
                onClick={() => { setShowLabDropdown((v) => !v); setShowPersonnelDropdown(false); setShowAssignedDropdown(false); }}
                className={cn(dropdownTriggerCls, showLabDropdown ? `${ACCENT_BORDER} ring-2 ring-[#d4ec00]/40` : 'border-border', selectedLabId ? 'text-foreground' : 'text-muted-foreground')}
              >
                <span className="truncate">{selectedLab?.name || 'Laboratuvar seçin'}</span>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform', showLabDropdown && 'rotate-180')} />
              </button>
              {showLabDropdown && (
                <div className="absolute z-20 mt-1 w-full bg-popover border border-border rounded-xl shadow-xl overflow-hidden animate-in slide-in-from-top-1 duration-150">
                  <div className="p-2 border-b border-border">
                    <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
                      <Search className="w-3.5 h-3.5 text-muted-foreground" />
                      <input type="text" value={labSearchQuery} onChange={(e) => setLabSearchQuery(e.target.value)} placeholder="Ara..." className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" autoFocus />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredLabs.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground text-center">Sonuç bulunamadı</div>
                    ) : (
                      filteredLabs.map((lab) => (
                        <button key={lab.id} type="button" onClick={() => { setSelectedLabId(lab.id); setShowLabDropdown(false); setLabSearchQuery(''); }} className={cn('w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors text-left', selectedLabId === lab.id ? cn('bg-accent/50', ACCENT) : 'text-foreground')}>
                          <Building2 className="w-3.5 h-3.5 shrink-0 opacity-50" />
                          <span className="truncate">{lab.name}</span>
                          {selectedLabId === lab.id && <Check className={cn('w-3.5 h-3.5 shrink-0 ml-auto', ACCENT)} />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Açıklama *</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Açıklama girin" rows={2} className={cn(inputCls, 'resize-none')} />
          </div>

          {/* Task Followers / Assignees */}
          <div ref={assignedDropdownRef} className="relative">
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Görevi Takip Edecek Personeller</label>
            <button
              type="button"
              onClick={() => { setShowAssignedDropdown((v) => !v); setShowLabDropdown(false); setShowPersonnelDropdown(false); }}
              className={cn(dropdownTriggerCls, showAssignedDropdown ? `${ACCENT_BORDER} ring-2 ring-[#d4ec00]/40` : 'border-border', assignedPersonnel.length > 0 ? 'text-foreground' : 'text-muted-foreground')}
            >
              <span className="truncate">{assignedPersonnel.length > 0 ? `${assignedPersonnel.length} kişi seçildi` : 'Personel seçin (opsiyonel)'}</span>
              <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform', showAssignedDropdown && 'rotate-180')} />
            </button>
            {assignedPersonnel.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {assignedPersonnel.map((p) => (
                  <span key={p.uid} className="inline-flex items-center gap-1 px-2 py-1 bg-secondary border border-border rounded-lg text-[11px] text-foreground">
                    {p.name}
                    <button type="button" onClick={() => setAssignedPersonnel((prev) => prev.filter((x) => x.uid !== p.uid))} className="text-muted-foreground hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            {showAssignedDropdown && (
              <div className="absolute z-20 mt-1 w-full bg-popover border border-border rounded-xl shadow-xl overflow-hidden animate-in slide-in-from-top-1 duration-150">
                <div className="p-2 border-b border-border">
                  <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
                    <Search className="w-3.5 h-3.5 text-muted-foreground" />
                    <input type="text" value={personnelSearchQuery} onChange={(e) => setPersonnelSearchQuery(e.target.value)} placeholder="Personel ara..." className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" autoFocus />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredPersonnel.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-muted-foreground text-center">Sonuç bulunamadı</div>
                  ) : (
                    filteredPersonnel.map((user) => {
                      const isSelected = assignedPersonnel.some((p) => p.uid === user.uid);
                      return (
                        <button key={user.uid} type="button" onClick={() => toggleAssignedPersonnel(user)} className={cn('w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors text-left', isSelected ? 'bg-accent/50' : '')}>
                          <div className={cn('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all', isSelected ? `${ACCENT_BG} border-[#d4ec00]` : 'border-muted-foreground/40')}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-zinc-900" strokeWidth={3} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className={cn('truncate block', isSelected ? 'text-foreground' : 'text-foreground/80')}>{user.name || user.email}</span>
                            <span className="text-[10px] text-muted-foreground">{user.role === 'admin' ? 'Admin' : 'Satın Alma'}</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Accompanying Personnel (kurum_ziyareti only) */}
          {isVisitType && (
            <div ref={personnelDropdownRef} className="relative">
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Eşlik Eden Personel</label>
              <button
                type="button"
                onClick={() => { setShowPersonnelDropdown((v) => !v); setShowLabDropdown(false); setShowAssignedDropdown(false); }}
                className={cn(dropdownTriggerCls, showPersonnelDropdown ? `${ACCENT_BORDER} ring-2 ring-[#d4ec00]/40` : 'border-border', selectedPersonnel.length > 0 ? 'text-foreground' : 'text-muted-foreground')}
              >
                <span className="truncate">{selectedPersonnel.length > 0 ? `${selectedPersonnel.length} kişi seçildi` : 'Personel seçin (opsiyonel)'}</span>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform', showPersonnelDropdown && 'rotate-180')} />
              </button>
              {selectedPersonnel.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedPersonnel.map((p) => (
                    <span key={p.uid} className="inline-flex items-center gap-1 px-2 py-1 bg-secondary border border-border rounded-lg text-[11px] text-foreground">
                      {p.name}
                      <button type="button" onClick={() => setSelectedPersonnel((prev) => prev.filter((x) => x.uid !== p.uid))} className="text-muted-foreground hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              {showPersonnelDropdown && (
                <div className="absolute z-20 mt-1 w-full bg-popover border border-border rounded-xl shadow-xl overflow-hidden animate-in slide-in-from-top-1 duration-150">
                  <div className="p-2 border-b border-border">
                    <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
                      <Search className="w-3.5 h-3.5 text-muted-foreground" />
                      <input type="text" value={personnelSearchQuery} onChange={(e) => setPersonnelSearchQuery(e.target.value)} placeholder="Personel ara..." className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" autoFocus />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredPersonnel.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground text-center">Sonuç bulunamadı</div>
                    ) : (
                      filteredPersonnel.map((user) => {
                        const isSelected = selectedPersonnel.some((p) => p.uid === user.uid);
                        return (
                          <button key={user.uid} type="button" onClick={() => togglePersonnel(user)} className={cn('w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors text-left', isSelected ? 'bg-accent/50' : '')}>
                            <div className={cn('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all', isSelected ? `${ACCENT_BG} border-[#d4ec00]` : 'border-muted-foreground/40')}>
                              {isSelected && <Check className="w-2.5 h-2.5 text-zinc-900" strokeWidth={3} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={cn('truncate block', isSelected ? 'text-foreground' : 'text-foreground/80')}>{user.name || user.email}</span>
                              <span className="text-[10px] text-muted-foreground">{user.role === 'admin' ? 'Admin' : 'Satın Alma'}</span>
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

          {/* Subtasks */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">
              <ListChecks className="w-3.5 h-3.5 inline mr-1" />
              Alt Görevler
            </label>
            {subtasks.length > 0 && (
              <div className="space-y-1 mb-2">
                {subtasks.map((st) => (
                  <div key={st.id} className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
                    <span className="flex-1 text-xs text-foreground">{st.title}</span>
                    <button type="button" onClick={() => removeSubtask(st.id)} className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-red-400 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                placeholder="Alt görev ekle..."
                className={cn(inputCls, 'py-2.5')}
              />
              <button
                type="button"
                onClick={addSubtask}
                disabled={!newSubtaskTitle.trim()}
                className={cn('shrink-0 px-3 rounded-xl border transition-all', newSubtaskTitle.trim() ? cn(ACCENT_BG, 'text-zinc-900 border-transparent') : 'bg-secondary border-border text-muted-foreground')}
              >
                <CirclePlus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Tarih</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputCls, 'dark:[color-scheme:dark]')} />
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Başlangıç</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={cn(inputCls, 'dark:[color-scheme:dark]')} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Bitiş</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={cn(inputCls, 'dark:[color-scheme:dark]')} />
            </div>
          </div>

          {/* Duration preview */}
          {timeValid && (
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-xl">
              <Clock className={cn('w-3.5 h-3.5', ACCENT)} />
              <span className="text-xs text-muted-foreground">
                Süre: {(() => { const dur = parseTime(endTime) - parseTime(startTime); const h = Math.floor(dur / 60); const m = dur % 60; return `${h > 0 ? `${h} saat ` : ''}${m > 0 ? `${m} dakika` : ''}`; })()}
              </span>
            </div>
          )}

          {!timeValid && startTime && endTime && (
            <p className="text-xs text-red-400">Bitiş saati başlangıçtan sonra olmalıdır</p>
          )}

          {/* Recurring (only for add mode) */}
          {!isEdit && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <button
                  type="button"
                  onClick={() => setIsRecurring(!isRecurring)}
                  className={cn('w-5 h-5 rounded border-2 flex items-center justify-center transition-all', isRecurring ? `${ACCENT_BG} border-[#d4ec00]` : 'border-muted-foreground/40')}
                >
                  {isRecurring && <Check className="w-3 h-3 text-zinc-900" strokeWidth={3} />}
                </button>
                <Repeat className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium">Tekrarlayan Görev</span>
              </label>
              {isRecurring && (
                <div className="mt-2 p-3 bg-secondary/50 rounded-xl space-y-3 animate-in slide-in-from-top-1 duration-200">
                  <div className="flex gap-2">
                    {(['daily', 'weekly', 'monthly'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setRecurringType(type)}
                        className={cn('flex-1 py-2 px-2 rounded-lg text-[11px] font-medium border transition-all', recurringType === type ? cn(ACCENT_BG_SUBTLE, ACCENT_BORDER, ACCENT) : 'bg-secondary border-border text-muted-foreground')}
                      >
                        {type === 'daily' ? 'Günlük' : type === 'weekly' ? 'Haftalık' : 'Aylık'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Her</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={recurringInterval}
                      onChange={(e) => setRecurringInterval(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 px-2 py-1.5 bg-secondary border border-border rounded-lg text-sm text-foreground text-center outline-none"
                    />
                    <span className="text-xs text-muted-foreground">
                      {recurringType === 'daily' ? 'günde' : recurringType === 'weekly' ? 'haftada' : 'ayda'} bir
                    </span>
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1">Bitiş Tarihi (opsiyonel)</label>
                    <input type="date" value={recurringEndDate} onChange={(e) => setRecurringEndDate(e.target.value)} className={cn(inputCls, 'py-2 text-xs dark:[color-scheme:dark]')} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* File Attachments */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Dosya Ekle (Resim / PDF)</label>
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple onChange={handleFileSelect} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn('w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed transition-all', 'border-border text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground bg-secondary/30')}
            >
              <Paperclip className="w-4 h-4" />
              <span className="text-sm">Dosya Seç</span>
            </button>

            {/* Existing attachments (edit mode) */}
            {existingAttachments.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {existingAttachments.map((att) => (
                  <div key={att.storagePath} className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
                    {att.type === 'image' ? <ImageIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" /> : <FileText className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                    <a href={att.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-xs text-foreground truncate hover:underline">{att.name}</a>
                    <button type="button" onClick={() => removeExistingAttachment(att)} className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-red-400 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* New files */}
            {files.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {files.map((file, idx) => {
                  const isImage = file.type.startsWith('image/');
                  return (
                    <div key={`${file.name}-${idx}`} className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg">
                      {isImage ? <ImageIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" /> : <FileText className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground truncate">{file.name}</p>
                        <p className="text-[10px] text-muted-foreground">{formatFileSize(file.size)}{isImage && ' — sıkıştırılacak'}</p>
                      </div>
                      <button type="button" onClick={() => removeFile(idx)} className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-red-400 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!valid || submitting}
            className={cn('w-full py-3.5 rounded-xl text-sm font-semibold transition-all', valid && !submitting ? `${ACCENT_BG} text-zinc-900 hover:brightness-110 active:scale-[0.98]` : 'bg-secondary text-muted-foreground cursor-not-allowed')}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {files.length > 0 ? 'Dosyalar yükleniyor...' : isEdit ? 'Güncelleniyor...' : 'Ekleniyor...'}
              </span>
            ) : (
              isEdit ? 'Kaydet' : `Görev Ekle${files.length > 0 ? ` (${files.length} dosya)` : ''}`
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
