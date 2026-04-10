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
  PurchasingWorkflowProject,
  Hospital,
  LabPool,
  User,
  DeviceFaultReport,
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
  Wrench,
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
  startOfDay,
} from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PurchasingAgentChat from '@/components/purchasing/PurchasingAgentChat';
import WorkflowCanvasPanel from '@/components/purchasing/WorkflowCanvasPanel';

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
  if (pct >= 50) return 'bg-amber-500';
  if (pct > 0) return 'bg-emerald-500';
  return 'bg-[#B5B3AF]';
}

function getOccupancyRingColor(pct: number): string {
  if (pct >= 80) return 'text-red-500';
  if (pct >= 50) return 'text-amber-500';
  if (pct > 0) return 'text-emerald-600';
  return 'text-[#9A9895]';
}

function getHeatColor(value: number, max: number): string {
  if (value === 0) return 'bg-emerald-500/15 border-emerald-500/20';
  const ratio = max > 0 ? value / max : 0;
  if (ratio < 0.34) return 'bg-yellow-500/25 border-yellow-500/30';
  if (ratio < 0.67) return 'bg-orange-500/35 border-orange-500/40';
  return 'bg-red-500/45 border-red-500/50';
}

// Accent color helpers — neumorphic design uses dashboard-accent (#F2994A) as primary
const ACCENT = 'text-[#C77B35]';
const ACCENT_BG = 'bg-[#F2994A]';
const ACCENT_BG_SUBTLE = 'bg-[#F2994A]/10';
const ACCENT_BORDER = 'border-[#F2994A]/40';
const ACCENT_RING = 'ring-[#F2994A]/30';


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
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) throw new Error('Dosya boyutu 10MB sınırını aşıyor');

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `purchasing-tasks/${taskPath}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, storagePath);

  let uploadData: Blob | File = file;
  if (isImage) uploadData = await compressImage(file);

  const uploadFile = uploadData instanceof File
    ? uploadData
    : new File([uploadData], file.name, { type: uploadData.type || file.type || 'image/jpeg' });

  const formData = new FormData();
  formData.append('file', uploadFile);
  formData.append('folder', 'purchasing-tasks');
  formData.append('userUid', taskPath);

  return { name: file.name, url, type: isImage ? 'image' : isPdf ? 'pdf' : 'file', size: uploadData.size, storagePath };
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

function generateChecklistId(): string {
  return `chk_${Math.random().toString(36).substring(2, 10)}`;
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
  const prevChecklistTitles = (prev.completionChecklist || []).map((i) => i.title).join(' | ');
  const nextChecklistTitles = (next.completionChecklist || []).map((i) => i.title).join(' | ');
  if (prevChecklistTitles !== nextChecklistTitles) {
    logs.push(createActivityLog('completion_checklist_changed', 'Görev tamamlama çıktı checklisti güncellendi', user));
  }
  if ((prev.expectedCompletionFileName || '') !== (next.expectedCompletionFileName || '')) {
    logs.push(createActivityLog('expected_file_changed', 'Beklenen tamamlanma dosyası güncellendi', user));
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
  completionChecklist?: PurchasingSubtask[];
  expectedCompletionFileName?: string;
  workflowProjectId?: string;
  workflowColor?: string;
  workflowNodeX?: number;
  workflowNodeY?: number;
  recurring?: PurchasingTaskRecurrence;
}


function getNextWeekdayDate(targetWeekday: number): Date {
  const today = new Date();
  const current = today.getDay(); // 0..6 Sun..Sat
  const delta = (targetWeekday - current + 7) % 7 || 7;
  const d = new Date(today);
  d.setDate(today.getDate() + delta);
  return d;
}

function parseNaturalTaskInputForPlanning(
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
      date = format(getNextWeekdayDate(idx), 'yyyy-MM-dd');
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
  const { currentUserProfile, isAdmin } = useAuth();
  const userName = currentUserProfile?.name || 'Kullanıcı';

  // State
  const [tasks, setTasks] = useState<PurchasingTask[]>([]);
  const [faultReports, setFaultReports] = useState<DeviceFaultReport[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTask, setEditingTask] = useState<PurchasingTask | null>(null);
  const [detailTask, setDetailTask] = useState<PurchasingTask | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly' | 'workflow'>('daily');
  const [timelineScope, setTimelineScope] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskDefinitions, setTaskDefinitions] = useState<PurchasingTaskDefinition[]>([]);
  const [workflows, setWorkflows] = useState<PurchasingWorkflowProject[]>([]);
  const [showTaskDefinitionModal, setShowTaskDefinitionModal] = useState(false);
  const [mobileMonthModalDate, setMobileMonthModalDate] = useState<Date | null>(null);
  const [myDayTaskIds, setMyDayTaskIds] = useState<string[]>([]);
  const [naturalInput, setNaturalInput] = useState('');
  const [naturalSubmitting, setNaturalSubmitting] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [isOffline, setIsOffline] = useState<boolean>(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [completionTask, setCompletionTask] = useState<PurchasingTask | null>(null);
  const [workflowNewTaskPreset, setWorkflowNewTaskPreset] = useState<{ workflowProjectId?: string; workflowColor?: string; x?: number; y?: number } | null>(null);
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
    const q = query(collection(db, 'deviceFaultReports'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as DeviceFaultReport[];
        setFaultReports(items);
      },
      (err) => console.error('DeviceFaultReports listen error', err)
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

  useEffect(() => {
    const q = query(collection(db, 'purchasingWorkflows'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PurchasingWorkflowProject[];
        setWorkflows(items);
      },
      (err) => console.error('Workflows listen error', err)
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

  // Role-based task filtering:
  // Admin sees all tasks; satın alma sees only their own tasks.
  const myTasks = useMemo(() => {
    if (isAdmin) return tasks;
    if (!currentUserProfile?.uid) return [];
    const uid = currentUserProfile.uid;
    return tasks.filter((t) =>
      t.createdByUid === uid ||
      t.assignedPersonnel?.some((p) => p.uid === uid) ||
      t.accompanyingPersonnel?.some((p) => p.uid === uid)
    );
  }, [tasks, isAdmin, currentUserProfile?.uid]);

  const normalizedSearchQuery = useMemo(() => globalSearchQuery.trim().toLocaleLowerCase('tr-TR'), [globalSearchQuery]);

  const globalSearchResults = useMemo(() => {
    if (!normalizedSearchQuery) return [] as PurchasingTask[];

    return myTasks
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
  }, [normalizedSearchQuery, myTasks]);

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
    return myTasks
      .filter((t) => t.date === dayStr)
      .sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
  }, [mobileMonthModalDate, myTasks]);

  // Permission check: admin can operate on all tasks, satın alma only on own tasks
  const canOperateOnTask = useCallback((task: PurchasingTask): boolean => {
    if (isAdmin) return true;
    if (!currentUserProfile?.uid) return false;
    const uid = currentUserProfile.uid;
    return (
      task.createdByUid === uid ||
      !!task.assignedPersonnel?.some((p) => p.uid === uid) ||
      !!task.accompanyingPersonnel?.some((p) => p.uid === uid)
    );
  }, [isAdmin, currentUserProfile?.uid]);

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
  const completeTask = useCallback(async (task: PurchasingTask) => {
    if (!currentUserProfile) return;
    if (task.completed) return;
    if (!canOperateOnTask(task)) {
      toast.error('Bu görevi tamamlama yetkiniz yok');
      return;
    }
    const log = createActivityLog(
      'completed',
      `Görev tamamlandı (${currentUserProfile.name || currentUserProfile.email || 'Kullanıcı'}, ${format(new Date(), 'HH:mm')})`,
      currentUserProfile
    );

    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: true } : t)));

    try {
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        completed: true,
        activityLogs: arrayUnion(log),
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Client toggle failed, trying API fallback', err);
      try {
        const res = await fetch('/api/purchasing-tasks/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: task.id,
            completed: true,
            userUid: currentUserProfile?.uid,
            userName: currentUserProfile?.name || currentUserProfile?.email || 'Kullanıcı',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || 'API fallback başarısız');
        toast.success('Görev tamamlandı');
      } catch (fallbackErr) {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: false } : t)));
        console.error('Error toggling task (fallback failed)', fallbackErr);
        toast.error('Görev güncellenemedi');
      }
    }
  }, [currentUserProfile, canOperateOnTask]);

  const reopenTask = useCallback(async (task: PurchasingTask) => {
    if (!currentUserProfile) return;
    if (!task.completed) return;
    if (!canOperateOnTask(task)) {
      toast.error('Bu görevi yeniden açma yetkiniz yok');
      return;
    }
    const log = createActivityLog(
      'reopened',
      `Görev yeniden açıldı (${currentUserProfile.name || currentUserProfile.email || 'Kullanıcı'}, ${format(new Date(), 'HH:mm')})`,
      currentUserProfile
    );
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: false } : t)));
    try {
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        completed: false,
        activityLogs: arrayUnion(log),
        updatedAt: Timestamp.now(),
      });
      toast.success('Görev yeniden açıldı');
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: true } : t)));
      console.error('Error reopening task', err);
      toast.error('Görev güncellenemedi');
    }
  }, [currentUserProfile, canOperateOnTask]);

  const requestTaskCompletion = useCallback((task: PurchasingTask) => {
    if (task.completed) {
      reopenTask(task);
      return;
    }
    const checklist = task.completionChecklist || [];
    if (checklist.length === 0 && !task.expectedCompletionFileName) {
      completeTask(task);
      return;
    }
    setCompletionTask(task);
  }, [completeTask, reopenTask]);


  const postponeTaskToTomorrow = useCallback(async (task: PurchasingTask) => {
    if (!canOperateOnTask(task)) {
      toast.error('Bu görevi erteleme yetkiniz yok');
      return;
    }
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
  }, [currentUserProfile, canOperateOnTask]);

  const moveTaskTimeInTimeline = useCallback(async (task: PurchasingTask, date: string, startHour: number) => {
    if (!canOperateOnTask(task)) {
      toast.error('Bu görevi taşıma yetkiniz yok');
      return;
    }
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
  }, [canOperateOnTask]);

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

  const attachFilesToTask = useCallback(async (task: PurchasingTask, files: File[]) => {
    if (!files.length) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      toast.warning('Çevrimdışı modda dosya yükleme desteklenmiyor');
      return;
    }

    const uploaded: PurchasingTaskAttachment[] = [];
    for (const file of files) {
      try {
        uploaded.push(await uploadAttachment(file, task.id));
      } catch (err) {
        console.error('Workflow card file upload error:', err);
        toast.error(`"${file.name}" yüklenemedi`);
      }
    }
    if (uploaded.length === 0) return;

    const nextAttachments = [...(task.attachments || []), ...uploaded];
    try {
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        attachments: nextAttachments,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Error attaching files from workflow', err);
      toast.error('Dosyalar göreve işlenemedi');
      throw err;
    }
  }, []);

  // Delete task
  const deleteTask = useCallback(async (task: PurchasingTask) => {
    if (!canOperateOnTask(task)) {
      toast.error('Bu görevi silme yetkiniz yok');
      return;
    }
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
          try { await fetch('/api/storage/delete-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storagePath: att.storagePath }) }); } catch { /* ok */ }
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
  }, [editingTask, tasks, enqueueMutation, canOperateOnTask]);

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
        if (data.completionChecklist?.length) taskDoc.completionChecklist = data.completionChecklist;
        if (data.expectedCompletionFileName) taskDoc.expectedCompletionFileName = data.expectedCompletionFileName;
        if (data.workflowProjectId) taskDoc.workflowProjectId = data.workflowProjectId;
        if (data.workflowColor) taskDoc.workflowColor = data.workflowColor;
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

          if (data.workflowProjectId) {
            const targetWorkflow = workflows.find((w) => w.id === data.workflowProjectId);
            if (targetWorkflow) {
              const nodeX = Math.max(12, Math.min(4200 - 236 - 12, (data.workflowNodeX ?? 220) - 118));
              const nodeY = Math.max(12, Math.min(2400 - 84 - 12, (data.workflowNodeY ?? 220) - 42));
              await updateDoc(doc(db, 'purchasingWorkflows', data.workflowProjectId), {
                taskIds: [...(targetWorkflow.taskIds || []), docRef.id],
                nodes: [...(targetWorkflow.nodes || []), { taskId: docRef.id, x: nodeX, y: nodeY }],
                updatedAt: Timestamp.now(),
              });
            }
          }

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
                workflowProjectId: null,
                workflowColor: null,
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
    [currentUserProfile, tasks, enqueueMutation, workflows]
  );

  // Edit task
  const handleEditTask = useCallback(
    async (data: TaskFormData) => {
      if (!editingTask || !currentUserProfile) return;
      if (!canOperateOnTask(editingTask)) {
        toast.error('Bu görevi düzenleme yetkiniz yok');
        return;
      }
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
        updates.completionChecklist = data.completionChecklist?.length ? data.completionChecklist : null;
        updates.expectedCompletionFileName = data.expectedCompletionFileName || null;

        if (currentUserProfile) {
          const changeLogs = getTaskChangeLogs(editingTask, data, currentUserProfile);
          if (changeLogs.length > 0) updates.activityLogs = arrayUnion(...changeLogs);
        }

        // Remove deleted attachments from storage
        if (data.removedAttachments?.length) {
          for (const att of data.removedAttachments) {
            try { await fetch('/api/storage/delete-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storagePath: att.storagePath }) }); } catch { /* ok */ }
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
    [editingTask, currentUserProfile, tasks, enqueueMutation, canOperateOnTask]
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

  const faultKpi = useMemo(() => {
    return faultReports.reduce(
      (acc, fault) => {
        if (fault.status === 'atama_bekliyor') acc.pendingAssignment += 1;
        if (fault.status === 'mudahale_bekliyor') acc.pendingIntervention += 1;
        if (fault.status === 'mudahale_ediliyor') acc.inIntervention += 1;
        return acc;
      },
      { pendingAssignment: 0, pendingIntervention: 0, inIntervention: 0 }
    );
  }, [faultReports]);

  const personalCalendarKpi = useMemo(() => {
    if (!currentUserProfile?.uid) {
      return { weekCount: 0, monthCount: 0, nextTasks: [] as PurchasingTask[] };
    }

    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const mine = tasks.filter((task) => {
      if (task.completed) return false;
      return (
        task.createdByUid === currentUserProfile.uid ||
        task.assignedPersonnel?.some((p) => p.uid === currentUserProfile.uid) ||
        task.accompanyingPersonnel?.some((p) => p.uid === currentUserProfile.uid)
      );
    });

    const weekCount = mine.filter((task) => {
      const taskDate = parseISO(task.date);
      return taskDate >= weekStart && taskDate <= weekEnd;
    }).length;

    const monthCount = mine.filter((task) => {
      const taskDate = parseISO(task.date);
      return taskDate >= monthStart && taskDate <= monthEnd;
    }).length;

    const nextTasks = mine
      .filter((task) => parseISO(task.date) >= startOfDay(now))
      .sort((a, b) => (a.date === b.date ? (a.startTime > b.startTime ? 1 : -1) : a.date > b.date ? 1 : -1))
      .slice(0, 3);

    return { weekCount, monthCount, nextTasks };
  }, [tasks, currentUserProfile?.uid]);

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
      const parsed = parseNaturalTaskInputForPlanning(trimmed, mainLaboratories);
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

  // Today hero data
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayTasks = useMemo(() => tasks.filter((t) => t.date === todayStr).sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime)), [tasks, todayStr]);
  const todayOccupancy = getOccupancyForDay(tasks, todayStr);
  const todayUrgentCount = todayTasks.filter((t) => t.priority === 'urgent' && !t.completed).length;
  const todayIncompleteTasks = useMemo(() => todayTasks.filter((t) => !t.completed), [todayTasks]);
  const todayCompletedTasks = useMemo(() => todayTasks.filter((t) => t.completed), [todayTasks]);
  const nextUpcomingTask = useMemo(() => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return todayTasks.find((t) => !t.completed && parseTime(t.startTime) >= nowMin);
  }, [todayTasks]);
  // Now indicator for weekly timeline
  const nowHour = new Date().getHours();
  const nowMinute = new Date().getMinutes();
  const nowTotalMin = nowHour * 60 + nowMinute;
  const nowLinePct = Math.max(0, Math.min(100, ((nowTotalMin - WORK_START_HOUR * 60) / TOTAL_WORK_MINUTES) * 100));
  const showNowLine = nowTotalMin >= WORK_START_HOUR * 60 && nowTotalMin <= WORK_END_HOUR * 60;
  // Inline feedback state
  const [justAddedTaskId, setJustAddedTaskId] = useState<string | null>(null);

  return (
    <div className="cihaz-shell min-h-screen pb-24 satin-alma-fluid-shell">
      {/* ===== STICKY HEADER — 3 rows: title+nav / search / date-strip ===== */}
      <div className="sticky top-0 z-30 satin-glass-header" style={{ backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', background: 'rgba(233,231,227,.82)' }}>
        {/* Row 1: Title + nav links */}
        <div className="px-4 pt-4 pb-1 md:px-8 md:pt-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Planlama Birimi</p>
              <h1 className="text-lg md:text-xl font-bold mt-0.5" style={{ color: 'var(--dashboard-text)' }}>
                Merhaba, <span style={{ color: 'var(--dashboard-accent)' }}>{userName}</span>
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold px-2 py-1 rounded-full satin-pill" style={{ color: 'var(--dashboard-accent)' }}>
                  Tek Dokunuş Modu
                </span>
                <span className="text-[10px] px-2 py-1 rounded-full satin-pill" style={{ color: 'var(--dashboard-muted)' }}>
                  {todayIncompleteTasks.length} açık görev
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {(isOffline || pendingMutations > 0 || syncInProgress) && (
                <div className="text-[10px] px-2 py-1 rounded-lg cihaz-pressed" style={{ color: 'var(--dashboard-muted)' }}>
                  {isOffline
                    ? `Offline • ${pendingMutations} bekleyen`
                    : syncInProgress
                      ? 'Senkronize ediliyor...'
                      : `${pendingMutations} bekleyen`}
                </div>
              )}
              <button
                onClick={() => setShowTaskDefinitionModal(true)}
                className="shrink-0 p-2 rounded-xl cihaz-card transition-all hover:brightness-[0.97]"
                style={{ color: 'var(--dashboard-muted)' }}
                title="Görev tanımları"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <Link
                href="/satin-alma/analiz-planlama"
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-medium cihaz-card transition-all hover:brightness-[0.97]"
                style={{ color: 'var(--dashboard-muted)' }}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Analiz Planlama</span>
              </Link>
              <Link
                href="/satin-alma/tum-islemler"
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-medium cihaz-card transition-all hover:brightness-[0.97]"
                style={{ color: 'var(--dashboard-muted)' }}
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Tüm İşlemler</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Row 2: Global search — full width */}
        <div className="px-4 md:px-8 pb-2 mt-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dashboard-muted)' }} />
            <input
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
              placeholder="Görevlerde ara: tarih, personel, başlık, açıklama, öncelik, dosya adı..."
              className="w-full pl-9 pr-3 py-2 rounded-xl text-xs outline-none cihaz-pressed"
              style={{ color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }}
            />
          </div>
        </div>

        {/* Row 3: Horizontal date strip (always visible) */}
        <div className="px-1 md:px-4 pb-2">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setSelectedDate((d) => subDays(d, 1))}
              className="hidden md:block shrink-0 p-1 rounded-lg cihaz-card transition-all hover:brightness-[0.97]"
            >
              <ChevronLeft className="w-4 h-4" style={{ color: 'var(--dashboard-muted)' }} />
            </button>

            <div
              ref={sliderRef}
              className="grid grid-flow-col auto-cols-[52px] sm:auto-cols-[60px] md:auto-cols-[68px] gap-1 overflow-x-auto scrollbar-none py-1 flex-1 min-w-0"
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
                    style={{
                      scrollSnapAlign: 'center',
                      ...(isSelected ? { background: 'var(--dashboard-accent)', color: '#fff' } : {}),
                    }}
                    className={cn(
                      'shrink-0 flex flex-col items-center justify-center rounded-xl py-1.5 transition-all duration-200',
                      isSelected
                        ? 'shadow-md scale-105 z-10'
                        : today
                        ? 'cihaz-card-strong ring-1 ring-[#F2994A]/30'
                        : 'opacity-60 hover:opacity-90'
                    )}
                  >
                    <span className="text-[9px] uppercase font-medium opacity-70">
                      {format(date, 'EEE', { locale: tr })}
                    </span>
                    <span className="text-base font-bold leading-tight mt-0.5">
                      {format(date, 'd')}
                    </span>
                    {specialDay && (
                      <span className={cn('mt-0.5 text-[8px] px-1 rounded-full', specialDay.type === 'holiday' ? 'bg-red-500/15 text-red-500' : 'bg-blue-500/15 text-blue-500')}>
                        {specialDay.name}
                      </span>
                    )}
                    {dayTaskCount > 0 && (
                      <div className="mt-0.5 flex items-center gap-0.5" title={`${dayTaskCount} görev / %${occupancy} dolu`}>
                        <div className={cn('w-1.5 h-1.5 rounded-full', isSelected ? 'bg-white/60' : getOccupancyColor(occupancy))} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setSelectedDate((d) => addDays(d, 1))}
              className="hidden md:block shrink-0 p-1 rounded-lg cihaz-card transition-all hover:brightness-[0.97]"
            >
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--dashboard-muted)' }} />
            </button>
          </div>

          {/* Expand calendar toggle — inline */}
          <div className="flex items-center justify-between px-3 md:px-4 mt-1">
            <button
              onClick={() => { setCalendarExpanded((v) => !v); setCalendarMonth(selectedDate); }}
              className="flex items-center gap-1.5 text-[11px] transition-colors hover:brightness-[0.9]"
              style={{ color: 'var(--dashboard-muted)' }}
            >
              <CalendarIcon className="w-3 h-3" />
              <span>{calendarExpanded ? 'Takvimi Kapat' : 'Takvimi Genişlet'}</span>
              <ChevronsUpDown className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Search Results (shown when search is active) */}
      {normalizedSearchQuery && (
        <div className="px-4 md:px-8 mt-3">
          <div className="cihaz-card rounded-2xl p-3">
            <p className="text-xs mb-2" style={{ color: 'var(--dashboard-muted)' }}>
              {globalSearchResults.length} görev / {groupedSearchResults.length} gün eşleşti
            </p>
            <div className="max-h-52 overflow-y-auto space-y-2">
              {groupedSearchResults.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Eşleşen kayıt bulunamadı.</p>
              ) : (
                groupedSearchResults.map(([day, dayTasks]) => (
                  <div key={day} className="rounded-xl p-2 cihaz-pressed">
                    <button
                      onClick={() => setSelectedDate(parseISO(day))}
                      className="text-[11px] font-semibold mb-1 hover:underline"
                      style={{ color: 'var(--dashboard-text)' }}
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
                          className="w-full text-left text-[11px] p-1.5 rounded-lg hover:brightness-[0.97] transition-all"
                          style={{ color: 'var(--dashboard-text)' }}
                        >
                          <span className="font-medium">{task.startTime}</span> • {task.title}
                          <span style={{ color: 'var(--dashboard-muted)' }}> • {task.priority}</span>
                          {task.attachments?.length ? (
                            <span style={{ color: 'var(--dashboard-muted)' }}> • {task.attachments.map((a) => a.name).join(', ')}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 1.1 TODAY HERO CARD (Bugün Kartı) ===== */}
      <div className="px-4 md:px-8 mt-3">
        <div className="cihaz-card-strong rounded-3xl p-4 md:p-6 satin-hero-card">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--dashboard-accent)' }}>
                  Bugün — {format(new Date(), 'd MMMM', { locale: tr })} ({format(new Date(), 'EEEE', { locale: tr })})
                </p>
              </div>
              <p className="text-sm mt-1.5" style={{ color: 'var(--dashboard-text)' }}>
                <span className="font-medium">Şu an: {format(new Date(), 'HH:mm')}</span>
                {nextUpcomingTask
                  ? <span style={{ color: 'var(--dashboard-muted)' }}> &middot; Sonraki: <span style={{ color: 'var(--dashboard-text)' }}>"{nextUpcomingTask.title}"</span> {nextUpcomingTask.startTime}–{nextUpcomingTask.endTime}</span>
                  : todayTasks.length === 0
                    ? <span style={{ color: 'var(--dashboard-muted)' }}> &middot; Plan boş</span>
                    : <span style={{ color: 'var(--dashboard-muted)' }}> &middot; Sonraki görev yok</span>}
              </p>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>
                  {todayTasks.length} görev
                </span>
                <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                  %{todayOccupancy} dolu
                </span>
                {todayUrgentCount > 0 && (
                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-600">{todayUrgentCount} acil</span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 md:min-w-[220px]">
              <div className="rounded-2xl p-2.5 satin-metric">
                <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>Açık</p>
                <p className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>{todayIncompleteTasks.length}</p>
              </div>
              <div className="rounded-2xl p-2.5 satin-metric">
                <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>Tamam</p>
                <p className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>{todayCompletedTasks.length}</p>
              </div>
              <div className="rounded-2xl p-2.5 satin-metric">
                <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>Doluluk</p>
                <p className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>%{todayOccupancy}</p>
              </div>
            </div>
          </div>
          {/* Two hero action buttons — larger, more prominent CTA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-all hover:brightness-[0.93] active:scale-[0.97] satin-float-action"
              style={{ background: 'var(--dashboard-accent)', color: '#fff', boxShadow: '0 4px 16px rgba(242,153,74,.25)' }}
            >
              <Plus className="w-5 h-5" strokeWidth={2.5} />
              Hızlı Görev
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold cihaz-card transition-all hover:brightness-[0.96] active:scale-[0.97] satin-float-action"
              style={{ color: 'var(--dashboard-text)' }}
            >
              <CalendarIcon className="w-4 h-4" />
              Planlı Görev
            </button>
          </div>
        </div>
      </div>

      {/* ===== 1.2 TODAY AGENDA — Task list before calendar ===== */}
      <div className="px-4 md:px-8 mt-3">
        <div className="cihaz-card rounded-3xl p-4 md:p-5 satin-soft-list">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--dashboard-text)' }}>
              Bugün Yapılacaklar
            </h3>
            <span className="text-[10px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>
              {todayIncompleteTasks.length} açık / {todayCompletedTasks.length} tamamlandı
            </span>
          </div>
          {todayTasks.length === 0 ? (
            <div className="flex flex-col items-center py-6">
              <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Bugün görev yok</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-3 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all hover:brightness-[0.95]"
                style={{ background: 'var(--dashboard-accent)', color: '#fff' }}
              >
                <Plus className="w-3.5 h-3.5" />
                Hızlı Görev
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {todayIncompleteTasks.map((task) => {
                const priority = (task.priority || 'normal') as Priority;
                const priorityConf = PRIORITY_CONFIG[priority];
                const isHighlighted = justAddedTaskId === task.id;
                return (
                  <div
                    key={task.id}
                    className={cn(
                      'flex items-center gap-3 p-3 md:p-3.5 rounded-2xl transition-all cursor-pointer hover:brightness-[0.98] satin-task-item',
                      isHighlighted ? 'ring-2 ring-[#F2994A]/40 scale-[1.01]' : ''
                    )}
                    style={{ background: 'var(--dashboard-surface)', border: '1px solid var(--dashboard-stroke)' }}
                    onClick={() => setEditingTask(task)}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); requestTaskCompletion(task); }}
                      className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
                      style={{ borderColor: 'rgba(108,114,122,.35)' }}
                    >
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--dashboard-text)' }}>{task.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>{task.startTime}–{task.endTime}</span>
                        {priority !== 'normal' && (
                          <span className={cn('inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium', priorityConf.bg, priorityConf.color)}>
                            <priorityConf.icon className="w-2.5 h-2.5" />
                            {priorityConf.label}
                          </span>
                        )}
                        {task.laboratoryName && (
                          <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{task.laboratoryName}</span>
                        )}
                        {task.assignedPersonnel && task.assignedPersonnel.length > 0 && (
                          <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{task.assignedPersonnel[0].name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {todayCompletedTasks.length > 0 && (
                <div className="pt-2" style={{ borderTop: '1px solid var(--dashboard-stroke)' }}>
                  <p className="text-[10px] font-medium mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Tamamlanan ({todayCompletedTasks.length})</p>
                  {todayCompletedTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl opacity-60 cursor-pointer hover:opacity-80 transition-all"
                      onClick={() => setEditingTask(task)}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); requestTaskCompletion(task); }}
                        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: 'var(--dashboard-accent)', borderColor: 'var(--dashboard-accent)' }}
                      >
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </button>
                      <p className="text-xs line-through truncate" style={{ color: 'var(--dashboard-muted)' }}>{task.title}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ===== 1.3 Expandable Monthly Calendar (second layer) ===== */}
      {calendarExpanded && (
        <div className="px-4 md:px-8 mt-3 animate-in slide-in-from-top-2 duration-300">
          <div className="cihaz-card rounded-2xl p-4">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="p-1.5 rounded-lg cihaz-card transition-all hover:brightness-[0.97]"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold" style={{ color: 'var(--dashboard-text)' }}>{format(calendarMonth, 'MMMM yyyy', { locale: tr })}</span>
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="p-1.5 rounded-lg cihaz-card transition-all hover:brightness-[0.97]"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => (
                <div key={d} className="text-center text-[10px] font-medium py-1" style={{ color: 'var(--dashboard-muted)' }}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const isSelected = isSameDay(day, selectedDate);
                const today = isToday(day);
                const inMonth = isSameMonth(day, calendarMonth);
                const occupancy = getOccupancyForDay(myTasks, dayStr);
                const hasTasks = myTasks.some((t) => t.date === dayStr);
                const specialDay = getSpecialDay(dayStr);
                return (
                  <button
                    key={dayStr}
                    onClick={() => { setSelectedDate(day); setCalendarExpanded(false); }}
                    style={{
                      color: isSelected ? '#fff' : 'var(--dashboard-text)',
                      ...(isSelected ? { background: 'var(--dashboard-accent)' } : {}),
                    }}
                    className={cn(
                      'relative flex flex-col items-center justify-center py-2 rounded-xl text-sm transition-all',
                      !inMonth && 'opacity-30',
                      isSelected ? 'font-bold' : today ? 'cihaz-card-strong font-semibold' : 'hover:brightness-[0.97]'
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
                        <div className={cn('w-1 h-1 rounded-full', isSelected ? 'bg-white/60' : getOccupancyColor(occupancy))} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== Occupancy bar — compact ===== */}
      <div className="px-4 md:px-8 mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--dashboard-text)' }}>
            {isToday(selectedDate) ? 'Bugün' : format(selectedDate, 'd MMMM EEEE', { locale: tr })}
          </h2>
          <span className={cn('text-[11px] font-medium', getOccupancyRingColor(selectedOccupancy))}>
            %{selectedOccupancy} dolu
          </span>
        </div>
        <div className="w-full h-1 rounded-full overflow-hidden cihaz-pressed">
          <div
            className={cn('h-full rounded-full transition-all duration-500', getOccupancyColor(selectedOccupancy))}
            style={{ width: `${selectedOccupancy}%` }}
          />
        </div>
        <div className="flex justify-between mt-0.5 text-[9px]" style={{ color: 'var(--dashboard-muted)' }}>
          <span>09:00</span><span>12:00</span><span>15:00</span><span>17:00</span>
        </div>
      </div>

      {/* Task Views */}
      <div className="px-4 md:px-8 mt-6">
        {tasksLoading ? (
          <div className="flex items-center justify-center py-14" style={{ color: 'var(--dashboard-muted)' }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Görevler yükleniyor...
          </div>
        ) : (
        <>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--dashboard-muted)' }}>
            {viewMode === 'daily' ? `Günlük Görevler (${dayTasks.length})` : viewMode === 'weekly' ? 'Haftalık Zaman Çizelgesi' : viewMode === 'monthly' ? 'Aylık Görev Görünümü' : viewMode === 'timeline' ? 'Timeline / Gantt' : viewMode === 'heatmap' ? 'Personel Aktivite Haritası' : viewMode === 'workflow' ? 'Workflow Kanvası' : 'Bugünüm'}
          </h3>
          <div className="flex items-center gap-1">
            {/* 3 primary tabs */}
            <div className="flex items-center gap-1 p-1 rounded-xl cihaz-pressed">
              {([
                ['daily', 'Günlük'],
                ['weekly', 'Haftalık'],
                ['monthly', 'Aylık'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn('px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all', viewMode === mode ? 'cihaz-card-strong' : 'hover:brightness-[0.97]')}
                  style={viewMode === mode ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-muted)' }}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Analiz dropdown for secondary modes */}
            <div className="relative group">
              <button
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-medium transition-all',
                  ['timeline', 'heatmap', 'myday', 'workflow'].includes(viewMode) ? 'cihaz-card-strong' : 'cihaz-pressed'
                )}
                style={['timeline', 'heatmap', 'myday', 'workflow'].includes(viewMode) ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-muted)' }}
              >
                Analiz
                <ChevronDown className="w-3 h-3" />
              </button>
              <div className="absolute right-0 top-full mt-1 w-40 rounded-xl p-1 cihaz-card-strong opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                {([
                  ['timeline', 'Timeline'],
                  ['heatmap', 'Heatmap'],
                  ['myday', 'Bugünüm'],
                  ['workflow', 'Workflow'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={cn('w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all', viewMode === mode ? 'cihaz-pressed' : 'hover:brightness-[0.97]')}
                    style={viewMode === mode ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-text)' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {viewMode === 'myday' && (
          <div className="space-y-4">
            <div className="cihaz-card rounded-2xl p-4">
              <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--dashboard-text)' }}>Bugünüm</h4>
              {myDayTasks.length === 0 ? (
                <div className="flex flex-col items-center py-6">
                  <CalendarIcon className="w-8 h-8 mb-2 opacity-30" style={{ color: 'var(--dashboard-muted)' }} />
                  <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Bugün için henüz görev seçmediniz.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myDayTasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-2 p-3 rounded-xl cihaz-pressed">
                      <div className="min-w-0">
                        <p className="text-sm truncate" style={{ color: 'var(--dashboard-text)' }}>{task.title}</p>
                        <p className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>{task.date} • {task.startTime}-{task.endTime}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditingTask(task)} className="text-[11px] px-2.5 py-1 rounded-lg cihaz-card font-medium" style={{ color: 'var(--dashboard-text)' }}>Aç</button>
                        <button onClick={() => removeFromMyDay(task.id)} className="text-[11px] px-2.5 py-1 rounded-lg cihaz-card" style={{ color: 'var(--dashboard-muted)' }}>Çıkar</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="cihaz-card rounded-2xl p-4">
              <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--dashboard-text)' }}>Akıllı Öneriler</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {myDaySuggestions.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Önerilecek görev bulunamadı.</p>
                ) : (
                  myDaySuggestions.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-2 p-3 rounded-xl cihaz-pressed">
                      <div className="min-w-0">
                        <p className="text-sm truncate" style={{ color: 'var(--dashboard-text)' }}>{task.title}</p>
                        <p className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>{task.date} • {task.startTime}-{task.endTime}{task.recurring ? ' • Tekrarlı' : ''}</p>
                      </div>
                      <button
                        onClick={() => addToMyDay(task.id)}
                        disabled={myDayTaskIds.includes(task.id)}
                        className={cn('text-[11px] px-3 py-1.5 rounded-lg font-medium transition-all', myDayTaskIds.includes(task.id) ? 'cihaz-pressed cursor-not-allowed' : 'cihaz-card hover:brightness-[0.97]')}
                        style={myDayTaskIds.includes(task.id) ? { color: 'var(--dashboard-muted)' } : { color: 'var(--dashboard-accent)' }}
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
            <div className="flex flex-col items-center justify-center py-10">
              <CalendarIcon className="w-8 h-8 mb-3 opacity-30" style={{ color: 'var(--dashboard-muted)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--dashboard-text)' }}>Bu güne ait görev bulunmuyor</p>
              <p className="text-xs mt-1" style={{ color: 'var(--dashboard-muted)' }}>Aşağıdan hızlıca ekleyebilirsiniz</p>
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all hover:brightness-[0.95]"
                  style={{ background: 'var(--dashboard-accent)', color: '#fff' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Hızlı Görev
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold cihaz-card transition-all hover:brightness-[0.97]"
                  style={{ color: 'var(--dashboard-text)' }}
                >
                  <CalendarIcon className="w-3.5 h-3.5" />
                  Detaylı Görev
                </button>
              </div>
              {/* Template suggestions */}
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {['Kurum Ziyareti', 'Toplantı', 'Stok Kontrol', 'Arıza Takibi'].map((tpl) => (
                  <button
                    key={tpl}
                    onClick={() => setShowAddModal(true)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium cihaz-pressed transition-all hover:brightness-[0.97]"
                    style={{ color: 'var(--dashboard-muted)' }}
                  >
                    {tpl}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
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
                    onToggle={() => requestTaskCompletion(task)}
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
              const dayTasksForWeek = myTasks
                .filter((t) => t.date === dayStr)
                .sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
              const layout = buildTimelineLayout(dayTasksForWeek);
              const isCurrentDay = isToday(day);

              return (
                <div key={dayStr} className={cn('rounded-xl p-2', isSameDay(day, selectedDate) ? 'cihaz-card-strong' : 'cihaz-card')} style={isSameDay(day, selectedDate) ? { borderLeft: '2px solid var(--dashboard-accent)' } : {}}>
                  {/* Sticky column header */}
                  <button onClick={() => setSelectedDate(day)} className="w-full text-left mb-2 sticky top-0 z-10 py-1 rounded-lg" style={{ background: 'inherit' }}>
                    <p className="text-[11px] uppercase" style={{ color: 'var(--dashboard-muted)' }}>{format(day, 'EEE', { locale: tr })}</p>
                    <p className="text-sm font-semibold" style={{ color: isCurrentDay ? 'var(--dashboard-accent)' : 'var(--dashboard-text)' }}>{format(day, 'd MMM', { locale: tr })}</p>
                  </button>
                  <div className="relative h-[420px] rounded-lg overflow-hidden cihaz-pressed">
                    {[9, 11, 13, 15, 17].map((h) => (
                      <div key={h} className="absolute left-0 right-0" style={{ top: `${((h - 9) / 8) * 100}%`, borderTop: '1px solid var(--dashboard-stroke)' }} />
                    ))}

                    {/* Now line indicator */}
                    {isCurrentDay && showNowLine && (
                      <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top: `${nowLinePct}%` }}>
                        <div className="relative">
                          <div className="absolute left-0 right-0 h-[1.5px] bg-red-500/70" />
                          <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
                          <span className="absolute left-2.5 -top-2 text-[8px] font-semibold text-red-500">{`${nowHour.toString().padStart(2, '0')}:${nowMinute.toString().padStart(2, '0')}`}</span>
                        </div>
                      </div>
                    )}

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
                            moveTaskTimeInTimeline(draggedTimelineTask, dayStr, hour);
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
                          className={cn('absolute rounded-lg px-1.5 py-1 text-left border-l-2 text-[10px] overflow-hidden z-20', task.completed ? 'opacity-50' : '')}
                          style={{
                            top: `${topPct}%`,
                            height: `${Math.max(heightPct, 8)}%`,
                            left: `calc(${leftPct}% + 2px)`,
                            width: `calc(${widthPct}% - 4px)`,
                            borderLeftColor: task.workflowColor || 'var(--dashboard-accent)',
                            background: task.completed ? 'var(--dashboard-surface-2)' : 'var(--dashboard-surface)',
                            color: 'var(--dashboard-text)',
                            boxShadow: 'var(--dashboard-raised-soft)',
                          }}
                          title={`${task.title} • ${task.startTime}–${task.endTime}`}
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
          <div className="cihaz-card rounded-2xl p-3">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h4 className="text-xs font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Zaman Çizelgesi (Gantt)</h4>
              <div className="flex items-center gap-1 p-1 rounded-xl cihaz-pressed">
                {(['daily', 'weekly', 'monthly'] as const).map((scope) => (
                  <button
                    key={scope}
                    onClick={() => setTimelineScope(scope)}
                    className={cn('px-2.5 py-1 text-[10px] rounded-lg font-medium transition-all', timelineScope === scope ? 'cihaz-card-strong' : '')}
                    style={timelineScope === scope ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-muted)' }}
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
                  <div key={day.toISOString()} className="text-[10px] text-center" style={{ color: 'var(--dashboard-muted)' }}>{format(day, 'd MMM', { locale: tr })}</div>
                ))}

                {Array.from({ length: WORK_END_HOUR - WORK_START_HOUR }, (_, idx) => {
                  const hour = WORK_START_HOUR + idx;
                  return (
                    <React.Fragment key={`r-${hour}`}>
                      <div className="text-[10px] pr-2" style={{ color: 'var(--dashboard-muted)' }}>{`${hour.toString().padStart(2, '0')}:00`}</div>
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
                        return (
                          <div
                            key={`${dayStr}-${hour}`}
                            className="h-8 rounded"
                            style={cnt > 0
                              ? { background: 'rgba(242,153,74,.15)', border: '1px solid rgba(242,153,74,.3)' }
                              : { background: 'var(--dashboard-surface-2)', border: '1px solid var(--dashboard-stroke)' }
                            }
                          />
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            <p className="text-[10px] mt-2" style={{ color: 'var(--dashboard-muted)' }}>Çakışan görevler aynı satırda birden fazla blok olarak gösterilir; haftalık görünümde blokları sürükleyip saat/gün değiştirin.</p>
          </div>
        )}

        {viewMode === 'heatmap' && (
          <div className="cihaz-card rounded-2xl p-3">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Personel Aktivite Haritası</h4>
              <div className="flex items-center gap-1 p-1 rounded-xl cihaz-pressed">
                {(['weekly', 'monthly'] as const).map((scope) => (
                  <button
                    key={scope}
                    onClick={() => setTimelineScope(scope)}
                    className={cn('px-2.5 py-1 text-[10px] rounded-lg font-medium transition-all', timelineScope === scope ? 'cihaz-card-strong' : '')}
                    style={timelineScope === scope ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-muted)' }}
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
                  <div key={d.toISOString()} className="text-[9px] text-center" style={{ color: 'var(--dashboard-muted)' }}>{timelineScope === 'weekly' ? format(d, 'EEE', { locale: tr }) : format(d, 'd')}</div>
                ))}
                {Array.from({ length: WORK_END_HOUR - WORK_START_HOUR }, (_, idx) => {
                  const hour = WORK_START_HOUR + idx;
                  return (
                    <React.Fragment key={`h-${hour}`}>
                      <div className="text-[9px]" style={{ color: 'var(--dashboard-muted)' }}>{hour}:00</div>
                      {heatmapData.days.map((_, di) => {
                        const val = heatmapData.matrix[di]?.[idx] || 0;
                        return <div key={`${di}-${idx}`} className={cn('h-5 rounded-sm', getHeatColor(val, heatmapData.max))} style={{ border: '1px solid var(--dashboard-stroke)' }} title={`${val} görev`} />;
                      })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            <p className="text-[10px] mt-2" style={{ color: 'var(--dashboard-muted)' }}>Boş zaman blokları yeşil, yoğun bloklar kırmızıya yakın tonlarda gösterilir.</p>
          </div>
        )}

        {viewMode === 'workflow' && (
          <div className="cihaz-card rounded-2xl p-3">
            <WorkflowCanvasPanel
              tasks={myTasks}
              workflows={workflows}
              userUid={currentUserProfile?.uid}
              userName={currentUserProfile?.name}
              onToggleTask={reopenTask}
              onRequestTaskCompletion={requestTaskCompletion}
              onRequestCreateTask={(preset) => {
                setWorkflowNewTaskPreset({
                  workflowProjectId: preset?.workflowProjectId,
                  workflowColor: preset?.workflowColor,
                  x: preset?.x,
                  y: preset?.y,
                });
                setShowAddModal(true);
              }}
              onAttachFilesToTask={attachFilesToTask}
            />
          </div>
        )}

        {viewMode === 'monthly' && (
          <div className="cihaz-card rounded-2xl p-3">
            {/* Legend — mini, top right */}
            <div className="flex items-center gap-3 mb-3 text-[9px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Normal</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Yaklaşan</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Çakışma / Overdue</span>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => (
                <div key={d} className="text-center text-[10px] font-medium py-1" style={{ color: 'var(--dashboard-muted)' }}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthDays.map((day) => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const cellTasks = myTasks.filter((t) => t.date === dayStr).sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
                const inMonth = isSameMonth(day, selectedDate);
                const selected = isSameDay(day, selectedDate);
                // Check for collisions (2+ tasks with overlapping times)
                const hasCollision = cellTasks.some((t, i) => cellTasks.slice(i + 1).some((t2) => parseTime(t.startTime) < parseTime(t2.endTime) && parseTime(t.endTime) > parseTime(t2.startTime)));
                const specialDay = getSpecialDay(dayStr);
                return (
                  <button
                    key={dayStr}
                    onClick={() => handleMonthlyDayClick(day)}
                    className={cn('min-h-[84px] md:min-h-[110px] rounded-xl p-1.5 text-left transition-all', selected ? 'cihaz-card-strong ring-1 ring-[#F2994A]/30' : 'hover:brightness-[0.97]', !inMonth && 'opacity-30')}
                    style={selected ? { borderLeft: '2px solid var(--dashboard-accent)' } : { border: '1px solid var(--dashboard-stroke)' }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold" style={{ color: isToday(day) ? 'var(--dashboard-accent)' : 'var(--dashboard-text)' }}>{format(day, 'd')}</span>
                      {cellTasks.length > 0 && <span className="text-[9px]" style={{ color: 'var(--dashboard-muted)' }}>{cellTasks.length}</span>}
                    </div>
                    {specialDay && (
                      <p className={cn('text-[9px] mb-1 truncate', specialDay.type === 'holiday' ? 'text-red-500' : 'text-blue-500')}>
                        {specialDay.name}
                      </p>
                    )}
                    <div className="space-y-0.5">
                      {cellTasks.slice(0, 2).map((task) => {
                        const isOverdue = !task.completed && parseTime(task.endTime) < nowTotalMin && isToday(day);
                        return (
                          <div
                            key={task.id}
                            className="text-[9px] rounded px-1 py-0.5 truncate border-l-2"
                            style={{
                              borderLeftColor: isOverdue ? '#ef4444' : hasCollision ? '#f59e0b' : task.workflowColor || '#22c55e',
                              background: task.completed ? 'var(--dashboard-surface-2)' : 'var(--dashboard-surface)',
                              color: task.completed ? 'var(--dashboard-muted)' : 'var(--dashboard-text)',
                            }}
                            title={`${task.title} • ${task.startTime}–${task.endTime}${task.assignedPersonnel?.length ? ` • ${task.assignedPersonnel[0].name}` : ''}`}
                          >
                            {task.startTime} {task.title}
                          </div>
                        );
                      })}
                      {cellTasks.length > 2 && (
                        <p className="text-[9px] font-semibold" style={{ color: 'var(--dashboard-accent)' }}>+{cellTasks.length - 2} daha</p>
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
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileMonthModalDate(null)} />
          <div className="absolute inset-x-3 bottom-4 top-20 rounded-2xl p-4 flex flex-col" style={{ background: 'var(--dashboard-surface)', border: '1px solid var(--dashboard-stroke)', boxShadow: 'var(--dashboard-raised)' }}>
            <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
              <div>
                <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Günlük Görevler</p>
                <h4 className="text-sm font-semibold" style={{ color: 'var(--dashboard-text)' }}>{format(mobileMonthModalDate, 'd MMMM EEEE', { locale: tr })}</h4>
              </div>
              <button
                onClick={() => setMobileMonthModalDate(null)}
                className="p-2 rounded-lg cihaz-card"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 overflow-y-auto flex-1 space-y-2">
              {mobileMonthModalTasks.length === 0 ? (
                <div className="flex flex-col items-center py-8">
                  <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Bu gün için görev bulunmuyor.</p>
                  <button
                    onClick={() => { setMobileMonthModalDate(null); setShowAddModal(true); }}
                    className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold"
                    style={{ background: 'var(--dashboard-accent)', color: '#fff' }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Görev Ekle
                  </button>
                </div>
              ) : (
                mobileMonthModalTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => {
                      setEditingTask(task);
                      setMobileMonthModalDate(null);
                    }}
                    className="w-full text-left p-3 rounded-xl cihaz-pressed transition-all"
                  >
                    <p className="text-sm truncate" style={{ color: 'var(--dashboard-text)' }}>{task.title}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--dashboard-muted)' }}>{task.startTime} - {task.endTime}</p>
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
        className="fixed bottom-20 right-5 md:bottom-8 md:right-8 z-40 w-14 h-14 rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
        style={{ background: 'var(--dashboard-accent)', color: '#fff', boxShadow: '0 6px 20px rgba(242,153,74,.35)' }}
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
          defaultWorkflowPreset={workflowNewTaskPreset || undefined}
          laboratories={mainLaboratories}
          personnel={personnel}
          taskDefinitions={taskDefinitions}
          onClose={() => { setShowAddModal(false); setWorkflowNewTaskPreset(null); }}
          onSubmit={async (data) => {
            await handleAddTask(data);
            setWorkflowNewTaskPreset(null);
          }}
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

      {completionTask && (
        <TaskCompletionModal
          task={completionTask}
          onClose={() => setCompletionTask(null)}
          onSaveChecklist={async (items) => {
            try {
              await updateDoc(doc(db, 'purchasingTasks', completionTask.id), {
                completionChecklist: items,
                updatedAt: Timestamp.now(),
              });
              setTasks((prev) => prev.map((t) => (t.id === completionTask.id ? { ...t, completionChecklist: items } : t)));
            } catch (err) {
              console.error('Error saving completion checklist', err);
            }
          }}
          onComplete={async (force) => {
            const latest = tasks.find((t) => t.id === completionTask.id) || completionTask;
            const total = latest.completionChecklist?.length || 0;
            const done = latest.completionChecklist?.filter((i) => i.completed).length || 0;
            if (!force && total > 0 && done < total) return;
            await completeTask(latest);
            if (latest.expectedCompletionFileName) {
              const shouldUpload = typeof window !== 'undefined'
                ? window.confirm(`Görev tamamlandı. Yüklemeniz gereken "${latest.expectedCompletionFileName}" dosyasını şimdi yüklemek ister misiniz?`)
                : false;
              if (shouldUpload) {
                toast.info(`Lütfen görev kartını düzenleyip "${latest.expectedCompletionFileName}" dosyasını yükleyin.`);
              }
            }
            setCompletionTask(null);
          }}
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
  const workflowColor = task.workflowColor || undefined;
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
        style={{
          transform: `translateX(${swipeOffset}px)`,
          borderLeftColor: workflowColor || 'var(--dashboard-accent)',
          background: task.completed ? 'var(--dashboard-surface-2)' : 'var(--dashboard-surface)',
          border: '1px solid var(--dashboard-stroke)',
          boxShadow: task.completed ? 'none' : 'var(--dashboard-raised-soft)',
        }}
        className={cn(
          'group relative flex items-start gap-3 p-4 rounded-2xl border-l-[3px]',
          isSwiping ? 'transition-none' : 'transition-transform duration-200',
          task.completed ? 'opacity-70' : 'hover:brightness-[0.98]'
        )}
      >
      {/* Drag handle */}
      <div className="shrink-0 mt-1 p-0.5 rounded cursor-grab active:cursor-grabbing opacity-30 hover:opacity-60" style={{ color: 'var(--dashboard-muted)' }}>
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
        style={task.completed ? { background: 'var(--dashboard-accent)', borderColor: 'var(--dashboard-accent)' } : { borderColor: 'rgba(108,114,122,.4)' }}
      >
        {task.completed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </button>

      {/* Content - clickable to edit */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn('text-sm font-medium leading-tight transition-all', task.completed && 'line-through')} style={{ color: task.completed ? 'var(--dashboard-muted)' : 'var(--dashboard-text)' }}>
            {task.title}
          </p>
          {isVisit && (
            <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(242,153,74,.1)', color: 'var(--dashboard-accent)' }}>Ziyaret</span>
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
          {workflowColor && (
            <span className="shrink-0 inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium border" style={{ borderColor: workflowColor, color: workflowColor }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: workflowColor }} />
              Workflow
            </span>
          )}
        </div>

        {isVisit && task.laboratoryName && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Building2 className="w-3 h-3" style={{ color: 'var(--dashboard-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>{task.laboratoryName}</span>
          </div>
        )}

        {task.description && (
          <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--dashboard-muted)' }}>{task.description}</p>
        )}

        {isVisit && task.accompanyingPersonnel && task.accompanyingPersonnel.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Users className="w-3 h-3" style={{ color: 'var(--dashboard-muted)' }} />
            <span className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>{task.accompanyingPersonnel.map((p) => p.name).join(', ')}</span>
          </div>
        )}

        {assignedPersonnel.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Users className="w-3 h-3" style={{ color: 'var(--dashboard-muted)' }} />
            <span className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>Takipçiler: {assignedPersonnel.map((p) => p.name).join(', ')}</span>
          </div>
        )}

        {/* Subtasks */}
        {task.subtasks && task.subtasks.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>
              <ListChecks className="w-3 h-3" />
              <span>{completedSubtasks}/{totalSubtasks} alt görev</span>
              <div className="flex-1 h-1 rounded-full overflow-hidden ml-1 cihaz-pressed">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) * 100 : 0}%`, background: 'var(--dashboard-accent)' }}
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
                  <CheckSquare className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--dashboard-accent)' }} />
                ) : (
                  <Square className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--dashboard-muted)' }} />
                )}
                <span className={cn('text-[11px]', st.completed && 'line-through')} style={{ color: st.completed ? 'var(--dashboard-muted)' : 'var(--dashboard-text)' }}>
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
          <div className="flex items-center gap-1" style={{ color: 'var(--dashboard-muted)' }}>
            <Clock className="w-3 h-3" />
            <span className="text-[11px]">{task.startTime} - {task.endTime}</span>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--dashboard-muted)', opacity: 0.7 }}>
            {hours > 0 ? `${hours}s ` : ''}{mins > 0 ? `${mins}dk` : ''}
          </span>
        </div>

        <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--dashboard-stroke)' }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setShowActivityLogs((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] transition-colors hover:brightness-[0.8]"
            style={{ color: 'var(--dashboard-muted)' }}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Geçmiş ({activityLogs.length})</span>
          </button>

          {showActivityLogs && (
            <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {activityLogs.length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>Henüz hareket kaydı yok.</p>
              ) : (
                activityLogs.map((log) => (
                  <div key={log.id} className="rounded-lg px-2.5 py-1.5 cihaz-pressed">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium" style={{ color: 'var(--dashboard-text)' }}>{log.createdByName}</span>
                      <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                        {log.createdAt && 'seconds' in (log.createdAt as any)
                          ? format(new Date((log.createdAt as any).seconds * 1000), 'dd.MM HH:mm')
                          : '-'}
                      </span>
                    </div>
                    <p className="text-[11px] mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--dashboard-text)', opacity: 0.8 }}>{log.message}</p>
                  </div>
                ))
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] transition-colors hover:brightness-[0.8] mt-2"
            style={{ color: 'var(--dashboard-muted)' }}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Notlar ({comments.length})</span>
          </button>

          {showComments && (
            <div className="mt-2 space-y-2">
              {comments.length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>Henüz not eklenmedi.</p>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {comments.map((comment) => (
                    <div key={comment.id} className="rounded-lg px-2.5 py-1.5 cihaz-pressed">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium" style={{ color: 'var(--dashboard-text)' }}>{comment.createdByName}</span>
                        <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                          {comment.createdAt && 'seconds' in (comment.createdAt as any)
                            ? format(new Date((comment.createdAt as any).seconds * 1000), 'dd.MM HH:mm')
                            : '-'}
                        </span>
                      </div>
                      <p className="text-[11px] mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--dashboard-text)', opacity: 0.8 }}>{comment.message}</p>
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
                  className="flex-1 h-8 px-2.5 rounded-lg text-[11px] outline-none cihaz-pressed"
                  style={{ color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }}
                />
                <button
                  type="button"
                  onClick={submitComment}
                  className="h-8 w-8 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--dashboard-accent)', color: '#fff' }}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Time bar */}
      <div className="shrink-0 w-1 h-10 rounded-full overflow-hidden self-center cihaz-pressed">
        <div
          className="w-full rounded-full transition-all"
          style={{ height: `${Math.min((durationMin / TOTAL_WORK_MINUTES) * 100, 100)}%`, background: task.completed ? 'var(--dashboard-muted)' : 'var(--dashboard-accent)', opacity: task.completed ? 0.3 : 1 }}
        />
      </div>

      {/* Actions */}
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1.5 rounded-lg cihaz-card transition-all hover:brightness-[0.97]" style={{ color: 'var(--dashboard-muted)' }}>
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-lg cihaz-card transition-all hover:brightness-[0.97] hover:text-red-500" style={{ color: 'var(--dashboard-muted)' }}>
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
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl md:rounded-3xl p-6" style={{ background: 'var(--dashboard-surface)', border: '1px solid var(--dashboard-stroke)', boxShadow: 'var(--dashboard-raised)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--dashboard-text)' }}>Görev Tanımları</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg cihaz-card transition-all hover:brightness-[0.97]"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-2 mb-4">
          {definitions.map((def) => (
            <div key={def.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl cihaz-pressed">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: 'var(--dashboard-text)' }}>{def.name}</p>
                {def.requiresLaboratory && <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>Laboratuvar seçimi zorunlu</p>}
              </div>
              <button onClick={() => onDelete(def.id)} className="p-1 rounded-lg cihaz-card hover:text-red-500 transition-all" style={{ color: 'var(--dashboard-muted)' }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {definitions.length === 0 && <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Henüz tanım yok.</p>}
        </div>

        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Yeni görev tanımı"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none cihaz-pressed"
            style={{ color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }}
          />
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--dashboard-muted)' }}>
            <input type="checkbox" checked={requiresLaboratory} onChange={(e) => setRequiresLaboratory(e.target.checked)} />
            Bu tanım laboratuvar gerektirir (kurum ziyareti benzeri)
          </label>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            className={cn('w-full py-2.5 rounded-xl text-sm font-semibold transition-all', name.trim() && !saving ? 'hover:brightness-[0.95]' : 'cihaz-pressed cursor-not-allowed')}
            style={name.trim() && !saving ? { background: 'var(--dashboard-accent)', color: '#fff' } : { color: 'var(--dashboard-muted)' }}
          >
            Tanım Ekle
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskCompletionModal({
  task,
  onClose,
  onSaveChecklist,
  onComplete,
}: {
  task: PurchasingTask;
  onClose: () => void;
  onSaveChecklist: (items: PurchasingSubtask[]) => Promise<void>;
  onComplete: (force: boolean) => Promise<void>;
}) {
  const [items, setItems] = useState<PurchasingSubtask[]>(task.completionChecklist || []);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const total = items.length;
  const done = items.filter((i) => i.completed).length;
  const allDone = total > 0 && done === total;

  const persistItems = async (nextItems: PurchasingSubtask[]) => {
    setItems(nextItems);
    setSaving(true);
    try {
      await onSaveChecklist(nextItems);
    } finally {
      setSaving(false);
    }
  };

  const toggleItem = async (id: string) => {
    const nextItems = items.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item));
    await persistItems(nextItems);
    const nextDone = nextItems.filter((i) => i.completed).length;
    if (nextItems.length > 0 && nextDone === nextItems.length) {
      setCompleting(true);
      await onComplete(false);
      setCompleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl md:rounded-3xl p-6 animate-in slide-in-from-bottom-4 duration-300" style={{ background: 'var(--dashboard-surface)', border: '1px solid var(--dashboard-stroke)', boxShadow: 'var(--dashboard-raised)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--dashboard-text)' }}>Görev Tamamlama</h3>
            <p className="text-xs mt-1" style={{ color: 'var(--dashboard-muted)' }}>{task.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg cihaz-card transition-all hover:brightness-[0.97]" style={{ color: 'var(--dashboard-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {items.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Çıktı checklisti: {done}/{total}</p>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleItem(item.id)}
                disabled={saving || completing}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left cihaz-pressed"
              >
                {item.completed ? <CheckSquare className="w-4 h-4" style={{ color: 'var(--dashboard-accent)' }} /> : <Square className="w-4 h-4" style={{ color: 'var(--dashboard-muted)' }} />}
                <span className={cn('text-sm', item.completed && 'line-through')} style={{ color: item.completed ? 'var(--dashboard-muted)' : 'var(--dashboard-text)' }}>{item.title}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--dashboard-muted)' }}>Bu görev için checklist tanımı yok.</p>
        )}

        {task.expectedCompletionFileName && (
          <div className="mt-4 rounded-xl p-3 cihaz-pressed">
            <p className="text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>Beklenen çıktı dosyası</p>
            <p className="text-xs mt-1" style={{ color: 'var(--dashboard-muted)' }}>{task.expectedCompletionFileName}</p>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={completing || saving || (items.length > 0 && !allDone)}
            onClick={async () => {
              setCompleting(true);
              await onComplete(false);
              setCompleting(false);
            }}
            className={cn('w-full py-3 rounded-xl text-sm font-semibold transition-all', items.length > 0 && !allDone ? 'cihaz-pressed cursor-not-allowed' : 'hover:brightness-[0.95]')}
            style={items.length > 0 && !allDone ? { color: 'var(--dashboard-muted)' } : { background: 'var(--dashboard-accent)', color: '#fff' }}
          >
            Tüm Çıktılar Tamamlandı → Görevi Bitir
          </button>

          {items.length > 0 && !allDone && (
            <button
              type="button"
              disabled={completing || saving}
              onClick={async () => {
                setCompleting(true);
                await onComplete(true);
                setCompleting(false);
              }}
              className="w-full py-2.5 rounded-xl text-xs font-medium border border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
            >
              Yine de tamamla
            </button>
          )}
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
  defaultWorkflowPreset,
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
  defaultWorkflowPreset?: { workflowProjectId?: string; workflowColor?: string; x?: number; y?: number };
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
  const [completionChecklist, setCompletionChecklist] = useState<PurchasingSubtask[]>(isEdit ? task.completionChecklist || [] : []);
  const [newCompletionChecklistTitle, setNewCompletionChecklistTitle] = useState('');
  const [expectedCompletionFileName, setExpectedCompletionFileName] = useState(isEdit ? task.expectedCompletionFileName || '' : '');

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
    const allowed = Array.from(selected).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf' || f.type === '' || !!f.name);
    const sizeFiltered = Array.from(selected).filter((f) => f.size <= MAX_ATTACHMENT_SIZE_BYTES);
    if (allowed.length < selected.length) toast.error('Bazı dosyalar format nedeniyle eklenemedi');
    if (sizeFiltered.length < allowed.length) toast.error('10MB üzeri dosyalar eklenemez');
    setFiles((prev) => [...prev, ...sizeFiltered.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf' || f.type === '' || !!f.name)]);
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

  const addCompletionChecklistItem = () => {
    const trimmed = newCompletionChecklistTitle.trim();
    if (!trimmed) return;
    setCompletionChecklist((prev) => [...prev, { id: generateChecklistId(), title: trimmed, completed: false }]);
    setNewCompletionChecklistTitle('');
  };

  const removeCompletionChecklistItem = (id: string) => setCompletionChecklist((prev) => prev.filter((s) => s.id !== id));

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
      completionChecklist: completionChecklist.length > 0 ? completionChecklist : undefined,
      expectedCompletionFileName: expectedCompletionFileName.trim() || undefined,
      ...(!isEdit && defaultWorkflowPreset?.workflowProjectId && {
        workflowProjectId: defaultWorkflowPreset.workflowProjectId,
        workflowColor: defaultWorkflowPreset.workflowColor,
        workflowNodeX: defaultWorkflowPreset.x,
        workflowNodeY: defaultWorkflowPreset.y,
      }),
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

  const inputCls = 'w-full px-4 py-3 rounded-xl text-sm outline-none cihaz-pressed transition-all focus:ring-2 focus:ring-[#F2994A]/30';
  const dropdownTriggerCls = 'w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm transition-all';
  const [showDetails, setShowDetails] = useState(!!isEdit);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] flex flex-col rounded-t-3xl md:rounded-3xl animate-in slide-in-from-bottom-4 duration-300"
        style={{ background: 'var(--dashboard-surface)', border: '1px solid var(--dashboard-stroke)', boxShadow: 'var(--dashboard-raised)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h3 className="text-lg font-bold" style={{ color: 'var(--dashboard-text)' }}>
            {isEdit ? 'Görevi Düzenle' : 'Yeni Görev'}
          </h3>
          <div className="flex items-center gap-1">
            {isEdit && onDelete && (
              <button
                type="button"
                onClick={() => { onDelete(); }}
                className="p-1.5 rounded-lg cihaz-card hover:text-red-500 transition-all"
                style={{ color: 'var(--dashboard-muted)' }}
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg cihaz-card transition-all hover:brightness-[0.97]" style={{ color: 'var(--dashboard-muted)' }}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 pb-2 space-y-4">
          {/* ===== SECTION A: Core — Title + quick template chips ===== */}
          {!isVisitType ? (
            <div>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ne yapacaksın?" className={cn(inputCls, 'text-base font-medium py-3.5')} style={{ color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }} autoFocus />
              {/* Template chips */}
              {!isEdit && !title.trim() && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {['Toplantı', 'Kurum Ziyareti', 'Stok Kontrol', 'Arıza Takibi'].map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => setTitle(tpl)}
                      className="px-3 py-2 rounded-xl text-xs font-semibold cihaz-card transition-all hover:brightness-[0.96] active:scale-[0.97]"
                      style={{ color: 'var(--dashboard-text)' }}
                    >
                      {tpl}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl cihaz-pressed" style={{ border: '1px solid var(--dashboard-stroke)' }}>
              <Building2 className="w-4 h-4" style={{ color: 'var(--dashboard-accent)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--dashboard-text)' }}>{selectedDefinition?.name || 'Kurum Ziyareti'}</span>
            </div>
          )}

          {/* Task Type selector — compact */}
          <div>
            <div className="relative">
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                className={cn(inputCls, 'pr-10 appearance-none py-2.5 text-xs')}
                style={{ color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }}
              >
                {taskDefinitions.length === 0 && <option value="custom">Serbest Görev</option>}
                {taskDefinitions.map((def) => (
                  <option key={def.id} value={def.id}>{def.name}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--dashboard-muted)' }} />
            </div>
          </div>

          {/* ===== SECTION B: Time — big preset buttons ===== */}
          <div className="cihaz-card rounded-xl p-3 space-y-3">
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--dashboard-muted)' }}>Zaman</p>
            {/* Date presets */}
            <div className="flex gap-1.5">
              {[
                { label: 'Bugün', value: format(new Date(), 'yyyy-MM-dd') },
                { label: 'Yarın', value: format(addDays(new Date(), 1), 'yyyy-MM-dd') },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setDate(preset.value)}
                  className={cn('flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all', date === preset.value ? 'cihaz-card-strong' : 'cihaz-pressed')}
                  style={date === preset.value ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-text)' }}
                >
                  {preset.label}
                </button>
              ))}
              <div className="flex-1">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputCls, 'py-2.5 text-xs text-center dark:[color-scheme:dark]')} style={{ color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }} />
              </div>
            </div>
            {/* Time range — side by side */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] mb-1" style={{ color: 'var(--dashboard-muted)' }}>Başlangıç</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={cn(inputCls, 'py-2.5 text-xs dark:[color-scheme:dark]')} />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: 'var(--dashboard-muted)' }}>Bitiş</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={cn(inputCls, 'py-2.5 text-xs dark:[color-scheme:dark]')} />
              </div>
            </div>
            {/* Duration presets */}
            <div className="flex gap-1.5">
              {[
                { label: '15 dk', mins: 15 },
                { label: '30 dk', mins: 30 },
                { label: '1 saat', mins: 60 },
                { label: '2 saat', mins: 120 },
              ].map((dur) => {
                const computedEnd = `${Math.floor((parseTime(startTime) + dur.mins) / 60).toString().padStart(2, '0')}:${((parseTime(startTime) + dur.mins) % 60).toString().padStart(2, '0')}`;
                const isActive = endTime === computedEnd;
                return (
                  <button
                    key={dur.label}
                    type="button"
                    onClick={() => setEndTime(computedEnd)}
                    className={cn('flex-1 py-2 rounded-lg text-[10px] font-semibold transition-all', isActive ? 'cihaz-card-strong' : 'cihaz-pressed')}
                    style={isActive ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-muted)' }}
                  >
                    {dur.label}
                  </button>
                );
              })}
            </div>
            {/* Duration preview */}
            {timeValid && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
                <Clock className="w-3 h-3" style={{ color: 'var(--dashboard-accent)' }} />
                <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                  Süre: {(() => { const dur = parseTime(endTime) - parseTime(startTime); const h = Math.floor(dur / 60); const m = dur % 60; return `${h > 0 ? `${h} saat ` : ''}${m > 0 ? `${m} dakika` : ''}`; })()}
                </span>
              </div>
            )}
            {!timeValid && startTime && endTime && (
              <p className="text-[10px] text-red-400">Bitiş saati başlangıçtan sonra olmalıdır</p>
            )}
          </div>

          {/* ===== SECTION C: Priority — segmented, single row ===== */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Öncelik</p>
            <div className="grid grid-cols-4 gap-1">
              {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(([key, conf]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPriority(key)}
                  className={cn(
                    'flex items-center justify-center gap-1 py-2.5 rounded-xl text-[11px] font-semibold transition-all',
                    priority === key ? 'cihaz-card-strong' : 'cihaz-pressed'
                  )}
                  style={priority === key ? { color: conf.color.includes('red') ? '#dc2626' : conf.color.includes('amber') ? '#d97706' : conf.color.includes('blue') ? '#2563eb' : 'var(--dashboard-accent)' } : { color: 'var(--dashboard-muted)' }}
                >
                  <conf.icon className="w-3 h-3" />
                  {conf.label}
                </button>
              ))}
            </div>
          </div>

          {/* ===== SECTION D: Assignees — single big button ===== */}
          <div ref={assignedDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => { setShowAssignedDropdown((v) => !v); setShowLabDropdown(false); setShowPersonnelDropdown(false); }}
              className={cn(dropdownTriggerCls, showAssignedDropdown ? 'ring-2 ring-[#F2994A]/30' : '', 'cihaz-pressed rounded-xl')}
              style={{ color: assignedPersonnel.length > 0 ? 'var(--dashboard-text)' : 'var(--dashboard-muted)', border: '1px solid var(--dashboard-stroke)' }}
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span className="text-sm">{assignedPersonnel.length > 0 ? `${assignedPersonnel.length} kişi seçildi` : 'Kişi seç (opsiyonel)'}</span>
              </div>
              <ChevronDown className={cn('w-4 h-4 shrink-0 transition-transform', showAssignedDropdown && 'rotate-180')} />
            </button>
            {assignedPersonnel.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {assignedPersonnel.map((p) => (
                  <span key={p.uid} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] cihaz-card" style={{ color: 'var(--dashboard-text)' }}>
                    {p.name}
                    <button type="button" onClick={() => setAssignedPersonnel((prev) => prev.filter((x) => x.uid !== p.uid))} className="hover:text-red-500 transition-colors" style={{ color: 'var(--dashboard-muted)' }}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            {showAssignedDropdown && (
              <div className="absolute z-20 mt-1 w-full rounded-xl overflow-hidden animate-in slide-in-from-top-1 duration-150" style={{ background: 'var(--dashboard-surface)', border: '1px solid var(--dashboard-stroke)', boxShadow: 'var(--dashboard-raised)' }}>
                <div className="p-2" style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg cihaz-pressed">
                    <Search className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-muted)' }} />
                    <input type="text" value={personnelSearchQuery} onChange={(e) => setPersonnelSearchQuery(e.target.value)} placeholder="Personel ara..." className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--dashboard-text)' }} autoFocus />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredPersonnel.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-center" style={{ color: 'var(--dashboard-muted)' }}>Sonuç bulunamadı</div>
                  ) : (
                    filteredPersonnel.map((user) => {
                      const isSelected = assignedPersonnel.some((p) => p.uid === user.uid);
                      return (
                        <button key={user.uid} type="button" onClick={() => toggleAssignedPersonnel(user)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-all hover:brightness-[0.97]">
                          <div className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all" style={isSelected ? { background: 'var(--dashboard-accent)', borderColor: 'var(--dashboard-accent)' } : { borderColor: 'rgba(108,114,122,.4)' }}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="truncate block" style={{ color: 'var(--dashboard-text)' }}>{user.name || user.email}</span>
                            <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{user.role === 'admin' ? 'Admin' : 'Planlama Birimi'}</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ===== COLLAPSIBLE DETAILS ===== */}
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-2 text-xs font-medium w-full py-2 transition-colors"
            style={{ color: 'var(--dashboard-muted)' }}
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showDetails && 'rotate-180')} />
            <span>{showDetails ? 'Detayları Gizle' : 'Detaylar'}</span>
            {(description || (subtasks.length > 0) || (files.length > 0) || (existingAttachments.length > 0)) && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#F2994A]" />
            )}
          </button>

          {showDetails && (
            <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">

          {/* Laboratory selector (kurum_ziyareti only) */}
          {isVisitType && (
            <div ref={labDropdownRef} className="relative">
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Kurum (Laboratuvar) *</label>
              <button
                type="button"
                onClick={() => { setShowLabDropdown((v) => !v); setShowPersonnelDropdown(false); setShowAssignedDropdown(false); }}
                className={cn(dropdownTriggerCls, showLabDropdown ? 'ring-2 ring-[#F2994A]/30' : '', 'cihaz-pressed')}
                style={{ color: selectedLabId ? 'var(--dashboard-text)' : 'var(--dashboard-muted)', border: '1px solid var(--dashboard-stroke)' }}
              >
                <span className="truncate">{selectedLab?.name || 'Laboratuvar seçin'}</span>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground shrink-0 transition-transform', showLabDropdown && 'rotate-180')} />
              </button>
              {showLabDropdown && (
                <div className="absolute z-20 mt-1 w-full rounded-xl overflow-hidden animate-in slide-in-from-top-1 duration-150" style={{ background: 'var(--dashboard-surface)', border: '1px solid var(--dashboard-stroke)', boxShadow: 'var(--dashboard-raised)' }}>
                  <div className="p-2" style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg cihaz-pressed">
                      <Search className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-muted)' }} />
                      <input type="text" value={labSearchQuery} onChange={(e) => setLabSearchQuery(e.target.value)} placeholder="Ara..." className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--dashboard-text)' }} autoFocus />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredLabs.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-center" style={{ color: 'var(--dashboard-muted)' }}>Sonuç bulunamadı</div>
                    ) : (
                      filteredLabs.map((lab) => (
                        <button key={lab.id} type="button" onClick={() => { setSelectedLabId(lab.id); setShowLabDropdown(false); setLabSearchQuery(''); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-all hover:brightness-[0.97]" style={{ color: selectedLabId === lab.id ? 'var(--dashboard-accent)' : 'var(--dashboard-text)' }}>
                          <Building2 className="w-3.5 h-3.5 shrink-0 opacity-50" />
                          <span className="truncate">{lab.name}</span>
                          {selectedLabId === lab.id && <Check className="w-3.5 h-3.5 shrink-0 ml-auto" style={{ color: 'var(--dashboard-accent)' }} />}
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
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Açıklama *</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Açıklama girin" rows={2} className={cn(inputCls, 'resize-none')} />
          </div>

          {/* Accompanying Personnel (kurum_ziyareti only) */}
          {isVisitType && (
            <div ref={personnelDropdownRef} className="relative">
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Eşlik Eden Personel</label>
              <button
                type="button"
                onClick={() => { setShowPersonnelDropdown((v) => !v); setShowLabDropdown(false); setShowAssignedDropdown(false); }}
                className={cn(dropdownTriggerCls, showPersonnelDropdown ? 'ring-2 ring-[#F2994A]/30' : '', 'cihaz-pressed')}
                style={{ color: selectedPersonnel.length > 0 ? 'var(--dashboard-text)' : 'var(--dashboard-muted)', border: '1px solid var(--dashboard-stroke)' }}
              >
                <span className="truncate">{selectedPersonnel.length > 0 ? `${selectedPersonnel.length} kişi seçildi` : 'Personel seçin (opsiyonel)'}</span>
                <ChevronDown className={cn('w-4 h-4 shrink-0 transition-transform', showPersonnelDropdown && 'rotate-180')} style={{ color: 'var(--dashboard-muted)' }} />
              </button>
              {selectedPersonnel.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedPersonnel.map((p) => (
                    <span key={p.uid} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] cihaz-card" style={{ color: 'var(--dashboard-text)' }}>
                      {p.name}
                      <button type="button" onClick={() => setSelectedPersonnel((prev) => prev.filter((x) => x.uid !== p.uid))} className="hover:text-red-500 transition-colors" style={{ color: 'var(--dashboard-muted)' }}><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              {showPersonnelDropdown && (
                <div className="absolute z-20 mt-1 w-full rounded-xl overflow-hidden animate-in slide-in-from-top-1 duration-150" style={{ background: 'var(--dashboard-surface)', border: '1px solid var(--dashboard-stroke)', boxShadow: 'var(--dashboard-raised)' }}>
                  <div className="p-2" style={{ borderBottom: '1px solid var(--dashboard-stroke)' }}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg cihaz-pressed">
                      <Search className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-muted)' }} />
                      <input type="text" value={personnelSearchQuery} onChange={(e) => setPersonnelSearchQuery(e.target.value)} placeholder="Personel ara..." className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--dashboard-text)' }} autoFocus />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {filteredPersonnel.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-center" style={{ color: 'var(--dashboard-muted)' }}>Sonuç bulunamadı</div>
                    ) : (
                      filteredPersonnel.map((user) => {
                        const isSelected = selectedPersonnel.some((p) => p.uid === user.uid);
                        return (
                          <button key={user.uid} type="button" onClick={() => togglePersonnel(user)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-all hover:brightness-[0.97]">
                            <div className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all" style={isSelected ? { background: 'var(--dashboard-accent)', borderColor: 'var(--dashboard-accent)' } : { borderColor: 'rgba(108,114,122,.4)' }}>
                              {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="truncate block" style={{ color: 'var(--dashboard-text)' }}>{user.name || user.email}</span>
                              <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{user.role === 'admin' ? 'Admin' : 'Planlama Birimi'}</span>
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
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>
              <ListChecks className="w-3.5 h-3.5 inline mr-1" />
              Alt Görevler
            </label>
            {subtasks.length > 0 && (
              <div className="space-y-1 mb-2">
                {subtasks.map((st) => (
                  <div key={st.id} className="flex items-center gap-2 px-3 py-2 rounded-lg cihaz-pressed">
                    <span className="flex-1 text-xs" style={{ color: 'var(--dashboard-text)' }}>{st.title}</span>
                    <button type="button" onClick={() => removeSubtask(st.id)} className="shrink-0 p-0.5 rounded hover:text-red-500 transition-colors" style={{ color: 'var(--dashboard-muted)' }}>
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
                className={cn('shrink-0 px-3 rounded-xl transition-all', newSubtaskTitle.trim() ? 'cihaz-card' : 'cihaz-pressed')}
                style={newSubtaskTitle.trim() ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-muted)' }}
              >
                <CirclePlus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>
              <CheckSquare className="w-3.5 h-3.5 inline mr-1" />
              Görev Sonlandırma Çıktı Listesi (opsiyonel)
            </label>
            {completionChecklist.length > 0 && (
              <div className="space-y-1 mb-2">
                {completionChecklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 px-3 py-2 rounded-lg cihaz-pressed">
                    <span className="flex-1 text-xs" style={{ color: 'var(--dashboard-text)' }}>{item.title}</span>
                    <button type="button" onClick={() => removeCompletionChecklistItem(item.id)} className="shrink-0 p-0.5 rounded hover:text-red-500 transition-colors" style={{ color: 'var(--dashboard-muted)' }}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newCompletionChecklistTitle}
                onChange={(e) => setNewCompletionChecklistTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCompletionChecklistItem(); } }}
                placeholder="Örn: Tedarikçi teklifleri karşılaştırıldı"
                className={cn(inputCls, 'py-2.5')}
              />
              <button
                type="button"
                onClick={addCompletionChecklistItem}
                disabled={!newCompletionChecklistTitle.trim()}
                className={cn('shrink-0 px-3 rounded-xl transition-all', newCompletionChecklistTitle.trim() ? 'cihaz-card' : 'cihaz-pressed')}
                style={newCompletionChecklistTitle.trim() ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-muted)' }}
              >
                <CirclePlus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Tamamlandığında Beklenen Dosya Adı (opsiyonel)</label>
            <input
              type="text"
              value={expectedCompletionFileName}
              onChange={(e) => setExpectedCompletionFileName(e.target.value)}
              placeholder="Örn: teklif-karsilastirma-raporu.pdf"
              className={inputCls}
            />
          </div>

          {/* Recurring (only for add mode) */}
          {!isEdit && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <button
                  type="button"
                  onClick={() => setIsRecurring(!isRecurring)}
                  className="w-5 h-5 rounded border-2 flex items-center justify-center transition-all"
                  style={isRecurring ? { background: 'var(--dashboard-accent)', borderColor: 'var(--dashboard-accent)' } : { borderColor: 'rgba(108,114,122,.4)' }}
                >
                  {isRecurring && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </button>
                <Repeat className="w-3.5 h-3.5" style={{ color: 'var(--dashboard-muted)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--dashboard-muted)' }}>Tekrarlayan Görev</span>
              </label>
              {isRecurring && (
                <div className="mt-2 p-3 rounded-xl space-y-3 animate-in slide-in-from-top-1 duration-200 cihaz-pressed">
                  <div className="flex gap-2">
                    {(['daily', 'weekly', 'monthly'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setRecurringType(type)}
                        className={cn('flex-1 py-2 px-2 rounded-lg text-[11px] font-medium transition-all', recurringType === type ? 'cihaz-card-strong' : 'cihaz-pressed')}
                        style={recurringType === type ? { color: 'var(--dashboard-accent)' } : { color: 'var(--dashboard-muted)' }}
                      >
                        {type === 'daily' ? 'Günlük' : type === 'weekly' ? 'Haftalık' : 'Aylık'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>Her</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={recurringInterval}
                      onChange={(e) => setRecurringInterval(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 px-2 py-1.5 rounded-lg text-sm text-center outline-none cihaz-card"
                      style={{ color: 'var(--dashboard-text)' }}
                    />
                    <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                      {recurringType === 'daily' ? 'günde' : recurringType === 'weekly' ? 'haftada' : 'ayda'} bir
                    </span>
                  </div>
                  <div>
                    <label className="block text-[10px] mb-1" style={{ color: 'var(--dashboard-muted)' }}>Bitiş Tarihi (opsiyonel)</label>
                    <input type="date" value={recurringEndDate} onChange={(e) => setRecurringEndDate(e.target.value)} className={cn(inputCls, 'py-2 text-xs')} style={{ color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* File Attachments */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Dosya Ekle (Resim / PDF / Diğer)</label>
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed transition-all hover:brightness-[0.97] cihaz-pressed"
              style={{ borderColor: 'var(--dashboard-stroke)', color: 'var(--dashboard-muted)' }}
            >
              <Paperclip className="w-4 h-4" />
              <span className="text-sm">Dosya Seç</span>
            </button>

            {/* Existing attachments (edit mode) */}
            {existingAttachments.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {existingAttachments.map((att) => (
                  <div key={att.storagePath} className="flex items-center gap-2 px-3 py-2 rounded-lg cihaz-pressed">
                    {att.type === 'image' ? <ImageIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" /> : <FileText className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                    <a href={att.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-xs truncate hover:underline" style={{ color: 'var(--dashboard-text)' }}>{att.name}</a>
                    <button type="button" onClick={() => removeExistingAttachment(att)} className="shrink-0 p-1 rounded-lg cihaz-card hover:text-red-500 transition-all" style={{ color: 'var(--dashboard-muted)' }}>
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
                    <div key={`${file.name}-${idx}`} className="flex items-center gap-2 px-3 py-2 rounded-lg cihaz-pressed">
                      {isImage ? <ImageIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" /> : <FileText className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs truncate" style={{ color: 'var(--dashboard-text)' }}>{file.name}</p>
                        <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>{formatFileSize(file.size)}{isImage && ' — sıkıştırılacak'}</p>
                      </div>
                      <button type="button" onClick={() => removeFile(idx)} className="shrink-0 p-1 rounded-lg cihaz-card hover:text-red-500 transition-all" style={{ color: 'var(--dashboard-muted)' }}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Close showDetails */}
          </div>
          )}
        </form>

        {/* ===== STICKY FOOTER — always visible, outside scroll ===== */}
        <div className="px-6 py-3 flex items-center gap-3" style={{ borderTop: '1px solid var(--dashboard-stroke)', background: 'var(--dashboard-surface)' }}>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 px-4 py-3 rounded-xl text-sm font-medium cihaz-card transition-all hover:brightness-[0.97]"
            style={{ color: 'var(--dashboard-muted)' }}
          >
            Vazgeç
          </button>
          <button
            type="submit"
            form="task-form"
            disabled={!valid || submitting}
            onClick={(e) => { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); }}
            className={cn('flex-1 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.97]', valid && !submitting ? 'hover:brightness-[0.93]' : 'cihaz-pressed cursor-not-allowed')}
            style={valid && !submitting ? { background: 'var(--dashboard-accent)', color: '#fff', boxShadow: '0 4px 16px rgba(242,153,74,.25)' } : { color: 'var(--dashboard-muted)' }}
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
        </div>
      </div>
    </div>
  );
}
