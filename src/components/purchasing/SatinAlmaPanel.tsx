'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
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
  CalendarRange,
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
  isWeekend,
  startOfWeek,
  endOfWeek,
  parseISO,
  isSameMonth,
  addWeeks,
  addMonths,
  isBefore,
  startOfDay,
} from 'date-fns';
import {
  emitWeeklyPlanApprovalRequested,
  emitWeeklyPlanApproved,
  emitWeeklyPlanRejected,
} from '@/lib/notifications';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PurchasingAgentChat from '@/components/purchasing/PurchasingAgentChat';
import WorkflowCanvasPanel from '@/components/purchasing/WorkflowCanvasPanel';
import { LabSelector } from '@/components/common/LabSelector';

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
  // Haftalık plan modu — her güne ayrı görev girişi yapılarak
  // firma sorumlusuna onay için bildirim gider.
  weeklyPlan?: boolean;
  weeklyPlanStart?: string;
  weeklyPlanEnd?: string;
  weeklyPlanDayEntries?: WeeklyPlanDayEntry[];
}

interface WeeklyPlanDayEntry {
  date: string; // YYYY-MM-DD
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  priority: Priority;
  laboratoryId?: string;
  laboratoryName?: string;
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
  const { currentUserProfile, isAdmin, isSuperAdmin, currentCompanyId } = useAuth();
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
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
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
    const q = scopedQuery('purchasingTaskDefinitions', currentCompanyId, isSuperAdmin, orderBy('name', 'asc'));
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
    const q = scopedQuery('purchasingWorkflows', currentCompanyId, isSuperAdmin, orderBy('updatedAt', 'desc'));
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

  // ==========================================
  // Haftalık plan oluşturma & onay akışı
  // ==========================================

  // Kullanıcının bağlı olduğu firmanın sorumlusunu getirir.
  const fetchCompanyResponsible = useCallback(async (companyId?: string) => {
    if (!companyId) return null;
    try {
      const snap = await getDoc(doc(db, 'companies', companyId));
      if (!snap.exists()) return null;
      const data = snap.data() as any;
      if (!data.responsibleUid) return null;
      return {
        uid: data.responsibleUid as string,
        name: (data.responsibleName as string) || '',
        companyName: (data.name as string) || '',
      };
    } catch (err) {
      console.error('Error fetching company responsible', err);
      return null;
    }
  }, []);

  const createWeeklyPlan = useCallback(async (data: TaskFormData) => {
    if (!currentUserProfile) return;

    const dayEntries = data.weeklyPlanDayEntries || [];
    if (dayEntries.length === 0) {
      toast.warning('Haftalık planda en az bir iş günü olmalıdır.');
      return;
    }

    // Firma sorumlusunu çöz — onay akışı için gereklidir.
    const responsible = await fetchCompanyResponsible(currentUserProfile.companyId);

    const weeklyPlanGroupId = `wp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const weekStartStr = data.weeklyPlanStart || dayEntries[0].date;
    const weekEndStr = data.weeklyPlanEnd || dayEntries[dayEntries.length - 1].date;

    try {
      const batch = writeBatch(db);
      for (const entry of dayEntries) {
        const ref = doc(collection(db, 'purchasingTasks'));
        const taskPayload: Record<string, any> = {
          title: entry.title,
          description: entry.description,
          taskType: data.taskType,
          taskTypeLabel: data.taskTypeLabel || null,
          startTime: entry.startTime,
          endTime: entry.endTime,
          priority: entry.priority,
          date: entry.date,
          completed: false,
          createdByUid: currentUserProfile.uid,
          createdByName: currentUserProfile.name || '',
          weeklyPlanGroupId,
          weeklyPlanWeekStart: weekStartStr,
          approvalStatus: responsible ? 'pending' : 'approved',
          ...(responsible && {
            approvalRequiredFromUid: responsible.uid,
            approvalRequiredFromName: responsible.name || '',
          }),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          sortOrder: Date.now() + Math.random(),
          activityLogs: [
            createActivityLog(
              'created',
              `Haftalık plan kapsamında oluşturuldu (${currentUserProfile.name || currentUserProfile.email || 'Kullanıcı'}, ${format(new Date(), 'HH:mm')})`,
              currentUserProfile
            ),
          ],
        };

        if (entry.laboratoryId) taskPayload.laboratoryId = entry.laboratoryId;
        if (entry.laboratoryName) taskPayload.laboratoryName = entry.laboratoryName;
        if (data.assignedPersonnel?.length) taskPayload.assignedPersonnel = data.assignedPersonnel;
        if (data.accompanyingPersonnel?.length) taskPayload.accompanyingPersonnel = data.accompanyingPersonnel;
        if (data.subtasks?.length) taskPayload.subtasks = data.subtasks;
        if (data.completionChecklist?.length) taskPayload.completionChecklist = data.completionChecklist;
        if (data.expectedCompletionFileName) taskPayload.expectedCompletionFileName = data.expectedCompletionFileName;

        batch.set(ref, taskPayload);
      }
      await batch.commit();

      // Firma sorumlusuna sistem içi + push bildirim gönder.
      if (responsible) {
        try {
          await emitWeeklyPlanApprovalRequested({
            actor: { uid: currentUserProfile.uid, name: currentUserProfile.name || currentUserProfile.email || 'Kullanıcı' },
            responsibleUid: responsible.uid,
            responsibleName: responsible.name,
            weeklyPlanGroupId,
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
            taskCount: dayEntries.length,
            companyName: responsible.companyName,
          });
          toast.success(`Haftalık plan oluşturuldu (${dayEntries.length} gün). Onay için ${responsible.name || 'firma sorumlusu'} bilgilendirildi.`);
        } catch (notifErr) {
          console.error('Weekly plan notification failed', notifErr);
          toast.warning('Plan oluşturuldu fakat bildirim gönderilemedi.');
        }
      } else {
        toast.info('Firma sorumlusu tanımlı olmadığı için plan otomatik olarak onaylandı.');
      }

      setShowAddModal(false);
      setSelectedDate(parseISO(dayEntries[0].date));
    } catch (err) {
      console.error('Error creating weekly plan', err);
      toast.error('Haftalık plan oluşturulamadı');
    }
  }, [currentUserProfile, fetchCompanyResponsible]);

  // Haftalık plan onayı — grup içindeki tüm görevleri approved yapar ve
  // planı oluşturan kullanıcıya bildirim gönderir.
  const approveWeeklyPlan = useCallback(async (groupId: string) => {
    if (!currentUserProfile) return;
    const groupTasks = tasks.filter((t) => t.weeklyPlanGroupId === groupId);
    if (groupTasks.length === 0) return;
    const first = groupTasks[0];
    // Yetki kontrolü — sadece onay beklenen kişi onaylayabilir.
    if (first.approvalRequiredFromUid && first.approvalRequiredFromUid !== currentUserProfile.uid && !isSuperAdmin) {
      toast.error('Bu planı onaylama yetkiniz yok.');
      return;
    }
    try {
      const batch = writeBatch(db);
      const now = Timestamp.now();
      for (const t of groupTasks) {
        batch.update(doc(db, 'purchasingTasks', t.id), {
          approvalStatus: 'approved',
          approvedByUid: currentUserProfile.uid,
          approvedByName: currentUserProfile.name || '',
          approvedAt: now,
          updatedAt: now,
          activityLogs: arrayUnion(createActivityLog(
            'approved',
            `Haftalık plan onaylandı (${currentUserProfile.name || 'Sorumlu'}, ${format(new Date(), 'HH:mm')})`,
            currentUserProfile
          )),
        });
      }
      await batch.commit();
      await emitWeeklyPlanApproved({
        actor: { uid: currentUserProfile.uid, name: currentUserProfile.name || currentUserProfile.email || 'Sorumlu' },
        createdByUid: first.createdByUid,
        weeklyPlanGroupId: groupId,
        weekStart: first.weeklyPlanWeekStart || first.date,
        weekEnd: format(endOfWeek(parseISO(first.weeklyPlanWeekStart || first.date), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        taskCount: groupTasks.length,
      });
      toast.success('Haftalık plan onaylandı.');
    } catch (err) {
      console.error('Error approving weekly plan', err);
      toast.error('Plan onaylanamadı');
    }
  }, [currentUserProfile, tasks, isSuperAdmin]);

  const rejectWeeklyPlan = useCallback(async (groupId: string, reason?: string) => {
    if (!currentUserProfile) return;
    const groupTasks = tasks.filter((t) => t.weeklyPlanGroupId === groupId);
    if (groupTasks.length === 0) return;
    const first = groupTasks[0];
    if (first.approvalRequiredFromUid && first.approvalRequiredFromUid !== currentUserProfile.uid && !isSuperAdmin) {
      toast.error('Bu planı reddetme yetkiniz yok.');
      return;
    }
    try {
      const batch = writeBatch(db);
      const now = Timestamp.now();
      for (const t of groupTasks) {
        batch.update(doc(db, 'purchasingTasks', t.id), {
          approvalStatus: 'rejected',
          rejectedReason: reason || '',
          updatedAt: now,
          activityLogs: arrayUnion(createActivityLog(
            'rejected',
            `Haftalık plan reddedildi (${currentUserProfile.name || 'Sorumlu'}${reason ? `, sebep: ${reason}` : ''})`,
            currentUserProfile
          )),
        });
      }
      await batch.commit();
      await emitWeeklyPlanRejected({
        actor: { uid: currentUserProfile.uid, name: currentUserProfile.name || currentUserProfile.email || 'Sorumlu' },
        createdByUid: first.createdByUid,
        weeklyPlanGroupId: groupId,
        weekStart: first.weeklyPlanWeekStart || first.date,
        weekEnd: format(endOfWeek(parseISO(first.weeklyPlanWeekStart || first.date), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        reason,
      });
      toast.success('Plan reddedildi.');
    } catch (err) {
      console.error('Error rejecting weekly plan', err);
      toast.error('Plan reddedilemedi');
    }
  }, [currentUserProfile, tasks, isSuperAdmin]);

  // Add task
  const handleAddTask = useCallback(
    async (data: TaskFormData) => {
      if (!currentUserProfile) return;
      try {
        // ===== Haftalık plan modu =====
        // Aynı girdiyle Pzt-Cum günleri için 5 görev oluşturur ve firma
        // sorumlusuna onay için bildirim gönderir.
        if (data.weeklyPlan) {
          await createWeeklyPlan(data);
          return;
        }

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

  // Panel aktifken body'e sınıf ekleyerek sistem UI rengi sızmasını engelle.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('satin-alma-active');
    return () => {
      document.body.classList.remove('satin-alma-active');
    };
  }, []);

  return (
    <div className="fluid-editorial fluid-safe-content min-h-[100dvh] pb-28 relative overflow-x-hidden">
      {/* Ambient depth blobs */}
      <div className="fluid-blob-1 -top-24 -right-16 opacity-50" />
      <div className="fluid-blob-2 top-[55%] -left-20 opacity-40" />

      {/* ===== STICKY HEADER ===== */}
      <div className="sticky top-0 z-30 satin-glass-header" style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
        {/* Row 1: Compact title bar + icon actions */}
        <div className="px-4 md:px-8 pt-4 pb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.22em] leading-none" style={{ color: '#006b68' }}>
                Satın Alma · Plan Akışı
              </p>
              <h1 className="text-lg md:text-xl font-extrabold tracking-tight mt-1 truncate" style={{ color: '#2c3432' }}>
                Merhaba, {userName.split(' ')[0]}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(isOffline || pendingMutations > 0 || syncInProgress) && (
              <span className="hidden sm:inline-flex text-[10px] px-2.5 py-1 rounded-full font-bold items-center gap-1"
                style={{ background: isOffline ? 'rgba(239,68,68,0.10)' : 'rgba(0,107,104,0.08)', color: isOffline ? '#ef4444' : '#006b68' }}>
                {isOffline ? `Offline · ${pendingMutations}` : syncInProgress ? 'Sync...' : `${pendingMutations} sync`}
              </span>
            )}
            <button
              onClick={() => setHeaderSearchOpen((v) => !v)}
              className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all active:scale-95 fluid-card-tap"
              style={{
                background: headerSearchOpen || normalizedSearchQuery ? 'rgba(0,107,104,0.12)' : 'rgba(44,52,50,0.06)',
                color: headerSearchOpen || normalizedSearchQuery ? '#006b68' : '#58615f',
              }}
              title="Ara"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowTaskDefinitionModal(true)}
              className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all active:scale-95 fluid-card-tap"
              style={{ background: 'rgba(44,52,50,0.06)', color: '#58615f' }}
              title="Görev tanımları"
            >
              <Settings className="w-4 h-4" />
            </button>
            <Link
              href="/satin-alma/analiz-planlama"
              className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all active:scale-95 fluid-card-tap"
              style={{ background: 'rgba(0,107,104,0.08)', color: '#006b68' }}
              title="Analiz Planlama"
            >
              <CalendarClock className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Expandable search (appears only when toggled) */}
        {headerSearchOpen && (
          <div className="px-4 md:px-8 pb-3 animate-in slide-in-from-top-1 duration-200">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2" style={{ color: '#006b68' }} />
              <input
                autoFocus
                value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                placeholder="Görev, personel, tarih ara..."
                className="w-full pl-11 pr-11 py-3 rounded-2xl text-sm outline-none"
                style={{ background: '#ffffff', color: '#2c3432', boxShadow: '0 4px 16px rgba(44,52,50,0.06)' }}
              />
              <button
                onClick={() => { setGlobalSearchQuery(''); setHeaderSearchOpen(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(44,52,50,0.06)', color: '#58615f' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Row 2: Compact date rail */}
        <div className="px-2 md:px-6 pb-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedDate((d) => subDays(d, 7))}
              className="hidden md:flex shrink-0 w-8 h-9 items-center justify-center rounded-xl transition-all active:scale-95 hover:bg-[#f0f5f2]"
              style={{ color: '#58615f' }}
              title="Önceki hafta"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div
              ref={sliderRef}
              className="grid grid-flow-col auto-cols-[48px] sm:auto-cols-[54px] md:auto-cols-[62px] gap-1 overflow-x-auto scrollbar-none flex-1 min-w-0"
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
                      'shrink-0 flex flex-col items-center justify-center rounded-2xl py-2 transition-all duration-200 fluid-card-tap',
                      isSelected
                        ? 'fluid-date-selected scale-105 -translate-y-0.5 z-10 shadow-md'
                        : today
                        ? 'bg-white ring-1 ring-[#006b68]/20'
                        : 'opacity-55 hover:opacity-90 hover:bg-white/50'
                    )}
                  >
                    <span className={cn('text-[9px] uppercase font-bold tracking-wide', isSelected ? 'text-white/85' : 'text-[#58615f]')}>
                      {format(date, 'EEE', { locale: tr })}
                    </span>
                    <span className={cn('text-base font-extrabold leading-tight mt-0.5', isSelected ? 'text-white' : today ? 'text-[#006b68]' : 'text-[#2c3432]')}>
                      {format(date, 'd')}
                    </span>
                    {dayTaskCount > 0 ? (
                      <div className={cn('mt-1 w-1.5 h-1.5 rounded-full', isSelected ? 'bg-white/80' : getOccupancyColor(occupancy))} />
                    ) : specialDay ? (
                      <div className={cn('mt-1 w-1 h-1 rounded-full', specialDay.type === 'holiday' ? 'bg-red-400' : 'bg-blue-400')} />
                    ) : (
                      <div className="mt-1 w-1.5 h-1.5" />
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setSelectedDate((d) => addDays(d, 7))}
              className="hidden md:flex shrink-0 w-8 h-9 items-center justify-center rounded-xl transition-all active:scale-95 hover:bg-[#f0f5f2]"
              style={{ color: '#58615f' }}
              title="Sonraki hafta"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setCalendarExpanded((v) => !v); setCalendarMonth(selectedDate); }}
              className="shrink-0 ml-1 w-9 h-9 rounded-2xl flex items-center justify-center transition-all active:scale-95 fluid-card-tap"
              style={{
                background: calendarExpanded ? 'rgba(0,107,104,0.12)' : 'rgba(44,52,50,0.06)',
                color: calendarExpanded ? '#006b68' : '#58615f',
              }}
              title="Ay takvimi"
            >
              <CalendarIcon className="w-4 h-4" />
            </button>
            {!isSameDay(selectedDate, new Date()) && (
              <button
                onClick={() => setSelectedDate(new Date())}
                className="shrink-0 ml-1 h-9 px-3 rounded-2xl text-[11px] font-bold transition-all active:scale-95 fluid-card-tap"
                style={{ background: 'rgba(0,107,104,0.10)', color: '#006b68' }}
              >
                Bugün
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Search results */}
      {normalizedSearchQuery && (
        <div className="px-4 md:px-8 mt-2 animate-in slide-in-from-top-1 duration-200">
          <div className="rounded-2xl p-4" style={{ background: '#ffffff', boxShadow: '0 12px 40px rgba(44,52,50,0.10)' }}>
            <p className="text-[11px] font-bold mb-3 px-1" style={{ color: '#58615f' }}>
              {globalSearchResults.length} sonuç bulundu
            </p>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {groupedSearchResults.length === 0 ? (
                <p className="text-sm text-center py-4" style={{ color: '#9aa09e' }}>Eşleşen kayıt yok</p>
              ) : (
                groupedSearchResults.map(([day, dayTasks]) => (
                  <div key={day} className="mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 px-2" style={{ color: '#006b68' }}>
                      {format(parseISO(day), 'd MMMM EEEE', { locale: tr })}
                    </p>
                    {dayTasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => { setSelectedDate(parseISO(task.date)); setEditingTask(task); setGlobalSearchQuery(''); setHeaderSearchOpen(false); }}
                        className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all active:scale-[0.99] hover:bg-[#f7faf8]"
                      >
                        <span className="text-xs font-bold shrink-0 w-11" style={{ color: '#006b68' }}>{task.startTime}</span>
                        <span className="text-sm font-medium flex-1 truncate" style={{ color: '#2c3432' }}>{task.title}</span>
                        {(task.priority === 'urgent' || task.priority === 'high') && (
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0', PRIORITY_CONFIG[task.priority as Priority].bg, PRIORITY_CONFIG[task.priority as Priority].color)}>
                            {PRIORITY_CONFIG[task.priority as Priority].label}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}


      {/* ===== EXPANDABLE CALENDAR ===== */}
      {calendarExpanded && (
        <div className="px-4 md:px-8 mt-3 animate-in slide-in-from-top-2 duration-300">
          <div className="rounded-[2rem] p-5" style={{ background: '#ffffff', boxShadow: '0 12px 40px rgba(44,52,50,0.07)' }}>
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="w-9 h-9 rounded-2xl flex items-center justify-center transition-all active:scale-95 fluid-card-tap"
                style={{ background: '#f0f5f2', color: '#58615f' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-base font-extrabold" style={{ color: '#2c3432' }}>
                {format(calendarMonth, 'MMMM yyyy', { locale: tr })}
              </span>
              <button
                onClick={() => setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="w-9 h-9 rounded-2xl flex items-center justify-center transition-all active:scale-95 fluid-card-tap"
                style={{ background: '#f0f5f2', color: '#58615f' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'].map((d) => (
                <div key={d} className="text-center text-[10px] font-bold py-1" style={{ color: '#9aa09e' }}>{d}</div>
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
                    className={cn(
                      'relative flex flex-col items-center justify-center py-2.5 rounded-2xl text-sm transition-all fluid-card-tap',
                      !inMonth && 'opacity-20',
                      isSelected
                        ? 'fluid-date-selected font-extrabold shadow-md'
                        : today
                        ? 'font-semibold bg-[#f0f5f2]'
                        : 'hover:bg-[#f7faf8]'
                    )}
                    style={!isSelected && today ? { color: '#006b68' } : !isSelected ? { color: '#2c3432' } : {}}
                  >
                    <span>{format(day, 'd')}</span>
                    {specialDay && (
                      <span className={cn('text-[8px] mt-0.5 w-1 h-1 rounded-full', specialDay.type === 'holiday' ? 'bg-red-400' : 'bg-blue-400')} />
                    )}
                    {hasTasks && !specialDay && (
                      <div className={cn('w-1 h-1 rounded-full mt-0.5', isSelected ? 'bg-white/70' : getOccupancyColor(occupancy))} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== COMMAND STRIP — Today at-a-glance ===== */}
      <div className="px-4 md:px-8 mt-4">
        <div className="rounded-2xl p-4 md:p-5" style={{ background: '#ffffff', boxShadow: '0 4px 20px rgba(44,52,50,0.06)' }}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] leading-none mb-1.5" style={{ color: '#006b68' }}>
                {isToday(selectedDate)
                  ? `Bugün · ${format(new Date(), 'HH:mm')}`
                  : format(selectedDate, 'd MMMM yyyy, EEEE', { locale: tr })}
              </p>
              {isToday(selectedDate) && nextUpcomingTask ? (
                <p className="text-sm font-medium truncate" style={{ color: '#2c3432' }}>
                  Sıradaki:{' '}
                  <span className="font-bold">{nextUpcomingTask.title}</span>
                  <span className="font-semibold ml-1" style={{ color: '#006b68' }}>
                    {nextUpcomingTask.startTime}–{nextUpcomingTask.endTime}
                  </span>
                </p>
              ) : isToday(selectedDate) && todayTasks.length === 0 ? (
                <p className="text-sm" style={{ color: '#9aa09e' }}>Bugün plan boş</p>
              ) : isToday(selectedDate) ? (
                <p className="text-sm" style={{ color: '#58615f' }}>Tüm görevler tamamlandı</p>
              ) : (
                <p className="text-sm font-medium" style={{ color: '#58615f' }}>
                  {dayTasks.length} görev planlandı
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isToday(selectedDate) && todayUrgentCount > 0 && (
                <span className="text-[10px] font-bold px-2.5 py-1.5 rounded-full" style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444' }}>
                  {todayUrgentCount} acil
                </span>
              )}
              <span className={cn('text-xs font-bold px-2.5 py-1.5 rounded-full', getOccupancyRingColor(selectedOccupancy))} style={{ background: 'rgba(44,52,50,0.05)' }}>
                %{selectedOccupancy}
              </span>
            </div>
          </div>
          {/* Occupancy bar */}
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#f0f5f2' }}>
            <div
              className={cn('h-full rounded-full transition-all duration-700', getOccupancyColor(selectedOccupancy))}
              style={{ width: `${selectedOccupancy}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[9px] font-semibold" style={{ color: '#c5cac8' }}>
            <span>09:00</span><span>11:00</span><span>13:00</span><span>15:00</span><span>17:00</span>
          </div>
        </div>
      </div>

      {/* ===== TASK STREAM ===== */}
      <div className="px-4 md:px-8 mt-5">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4 px-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-extrabold tracking-tight" style={{ color: '#2c3432' }}>
              {viewMode === 'weekly' ? 'Haftalık Bakış' : isToday(selectedDate) ? "Bugünün Görevleri" : format(selectedDate, 'd MMMM', { locale: tr })}
            </h2>
            {viewMode === 'daily' && dayTasks.length > 0 && (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,107,104,0.08)', color: '#006b68' }}>
                {dayTasks.length}
              </span>
            )}
          </div>
          {/* View toggle */}
          <div className="flex items-center p-1 rounded-2xl" style={{ background: '#f0f5f2' }}>
            <button
              onClick={() => setViewMode('daily')}
              className="px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all"
              style={viewMode === 'daily'
                ? { background: '#ffffff', color: '#006b68', boxShadow: '0 2px 8px rgba(44,52,50,0.08)' }
                : { color: '#58615f' }}
            >
              Günlük
            </button>
            <button
              onClick={() => setViewMode('weekly')}
              className="px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all"
              style={viewMode === 'weekly'
                ? { background: '#ffffff', color: '#006b68', boxShadow: '0 2px 8px rgba(44,52,50,0.08)' }
                : { color: '#58615f' }}
            >
              Haftalık
            </button>
          </div>
        </div>

        {/* Loading */}
        {tasksLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: '#ffffff', boxShadow: '0 4px 16px rgba(44,52,50,0.04)' }} />
            ))}
          </div>

        /* ── DAILY VIEW ── */
        ) : viewMode === 'daily' ? (
          dayTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 rounded-[2rem]"
              style={{ background: '#ffffff', boxShadow: '0 8px 28px rgba(44,52,50,0.05)' }}>
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4"
                style={{ background: 'rgba(0,107,104,0.08)' }}>
                <CalendarIcon className="w-7 h-7" style={{ color: '#006b68' }} />
              </div>
              <p className="text-base font-bold mb-1" style={{ color: '#2c3432' }}>Bu gün boş</p>
              <p className="text-xs mb-6" style={{ color: '#9aa09e' }}>+ butonuna dokun, hızlıca görev ekle</p>
              <div className="flex flex-wrap justify-center gap-2 px-4">
                {['Kurum Ziyareti', 'Toplantı', 'Stok Kontrol', 'Arıza Takibi'].map((tpl) => (
                  <button
                    key={tpl}
                    onClick={() => setShowAddModal(true)}
                    className="px-4 py-2 rounded-full text-[11px] font-bold transition-all active:scale-95 fluid-card-tap"
                    style={{ background: 'rgba(0,107,104,0.08)', color: '#006b68' }}
                  >
                    + {tpl}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {dayTasks.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => { setDraggedTaskId(task.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => setDraggedTaskId(null)}
                  onDragOver={(e) => handleDragOver(e, task.id)}
                  onDrop={(e) => handleDrop(e, task.id)}
                  className={cn(draggedTaskId === task.id && 'opacity-40')}
                >
                  <TaskCard
                    task={task}
                    onToggle={() => requestTaskCompletion(task)}
                    onToggleSubtask={(stId) => toggleSubtask(task, stId)}
                    onEdit={() => setEditingTask(task)}
                    onDelete={() => deleteTask(task)}
                    onAddComment={(message) => addTaskComment(task, message)}
                    onPostpone={() => postponeTaskToTomorrow(task)}
                    canApprove={
                      !!task.weeklyPlanGroupId &&
                      task.approvalStatus === 'pending' &&
                      (task.approvalRequiredFromUid === currentUserProfile?.uid || isSuperAdmin)
                    }
                    onApprove={() => task.weeklyPlanGroupId && approveWeeklyPlan(task.weeklyPlanGroupId)}
                    onReject={() => {
                      if (!task.weeklyPlanGroupId) return;
                      const reason = typeof window !== 'undefined'
                        ? (window.prompt('Reddetme sebebi (opsiyonel):') || '')
                        : '';
                      rejectWeeklyPlan(task.weeklyPlanGroupId, reason);
                    }}
                  />
                </div>
              ))}
            </div>
          )

        /* ── WEEKLY VIEW ── */
        ) : viewMode === 'weekly' ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {weekDays.map((day) => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const dayTasksForWeek = myTasks
                .filter((t) => t.date === dayStr)
                .sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
              const isCurrentDay = isToday(day);
              const isSelectedDay = isSameDay(day, selectedDate);
              const occ = getOccupancyForDay(myTasks, dayStr);
              return (
                <button
                  key={dayStr}
                  onClick={() => { setSelectedDate(day); setViewMode('daily'); }}
                  className="rounded-2xl p-3 text-left transition-all fluid-card-tap hover:-translate-y-0.5"
                  style={isSelectedDay
                    ? { background: '#ffffff', boxShadow: '0 8px 28px rgba(0,107,104,0.10)', borderLeft: '3px solid #006b68' }
                    : isCurrentDay
                    ? { background: '#ffffff', boxShadow: '0 4px 16px rgba(44,52,50,0.06)', borderLeft: '3px solid rgba(0,107,104,0.25)' }
                    : { background: '#f7faf8' }}
                >
                  <p className="text-[10px] uppercase font-bold" style={{ color: isCurrentDay ? '#006b68' : '#9aa09e' }}>
                    {format(day, 'EEE', { locale: tr })}
                  </p>
                  <p className="text-sm font-extrabold mt-0.5 mb-2.5" style={{ color: '#2c3432' }}>
                    {format(day, 'd')}
                    <span className="text-[10px] font-medium ml-1" style={{ color: '#9aa09e' }}>{format(day, 'MMM', { locale: tr })}</span>
                  </p>
                  <div className="w-full h-1 rounded-full overflow-hidden mb-2.5" style={{ background: '#e8ecea' }}>
                    <div className={cn('h-full rounded-full transition-all', getOccupancyColor(occ))} style={{ width: `${occ}%` }} />
                  </div>
                  {dayTasksForWeek.length === 0 ? (
                    <p className="text-[10px]" style={{ color: '#c5cac8' }}>Boş</p>
                  ) : (
                    <div className="space-y-1">
                      {dayTasksForWeek.slice(0, 3).map((t) => {
                        const p = (t.priority || 'normal') as Priority;
                        return (
                          <div key={t.id} className="flex items-start gap-1.5">
                            <div className={cn('w-1.5 h-1.5 rounded-full mt-1 shrink-0',
                              t.completed ? 'bg-[#006b68]' : p === 'urgent' ? 'bg-red-400' : p === 'high' ? 'bg-orange-400' : 'bg-emerald-400'
                            )} />
                            <p className={cn('text-[10px] font-medium leading-tight line-clamp-2',
                              t.completed && 'line-through opacity-50'
                            )} style={{ color: '#2c3432' }}>{t.title}</p>
                          </div>
                        );
                      })}
                      {dayTasksForWeek.length > 3 && (
                        <p className="text-[10px] font-bold pl-3" style={{ color: '#006b68' }}>
                          +{dayTasksForWeek.length - 3} daha
                        </p>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>


      {mobileMonthModalDate && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileMonthModalDate(null)} />
          <div className="absolute inset-x-3 bottom-4 rounded-[2rem] p-5 flex flex-col max-h-[70vh]"
            style={{ background: '#ffffff', boxShadow: '0 -8px 40px rgba(44,52,50,0.15)' }}>
            {/* Handle */}
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: '#e0e5e3' }} />
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#006b68' }}>Günlük Görevler</p>
                <h4 className="text-base font-extrabold" style={{ color: '#2c3432' }}>{format(mobileMonthModalDate, 'd MMMM EEEE', { locale: tr })}</h4>
              </div>
              <button
                onClick={() => setMobileMonthModalDate(null)}
                className="w-9 h-9 rounded-2xl flex items-center justify-center"
                style={{ background: '#f0f5f2', color: '#58615f' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
              {mobileMonthModalTasks.length === 0 ? (
                <div className="flex flex-col items-center py-8">
                  <p className="text-sm mb-4" style={{ color: '#9aa09e' }}>Bu gün için görev bulunmuyor.</p>
                  <button
                    onClick={() => { setMobileMonthModalDate(null); setShowAddModal(true); }}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-bold fluid-btn-primary"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.5} />
                    Görev Ekle
                  </button>
                </div>
              ) : (
                mobileMonthModalTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => { setEditingTask(task); setMobileMonthModalDate(null); }}
                    className="w-full text-left p-3.5 rounded-2xl transition-all active:scale-[0.99]"
                    style={{ background: '#f7faf8', borderLeft: '3px solid rgba(0,107,104,0.3)' }}
                  >
                    <p className="text-sm font-bold truncate" style={{ color: '#2c3432' }}>{task.title}</p>
                    <p className="text-xs font-medium mt-0.5" style={{ color: '#58615f' }}>{task.startTime} – {task.endTime}</p>
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
        className="fixed bottom-20 right-5 md:bottom-8 md:right-8 z-40 w-16 h-16 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-90"
        style={{ background: 'linear-gradient(135deg, #006b68, #76ddd8)', color: '#e1fffd', boxShadow: '0 8px 28px rgba(0,107,104,0.38), 0 2px 8px rgba(0,107,104,0.20)' }}
      >
        <Plus className="w-7 h-7" strokeWidth={2.5} />
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
            await addDoc(collection(db, 'purchasingTaskDefinitions'), withCompanyScope({
              name: trimmed,
              requiresLaboratory,
              active: true,
              createdAt: Timestamp.now(),
            }, currentCompanyId));
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
  canApprove,
  onApprove,
  onReject,
}: {
  task: PurchasingTask;
  onToggle: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddComment: (message: string) => void;
  onPostpone: () => void;
  canApprove?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
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
  const accentColor = workflowColor || (
    priority === 'urgent' ? '#ef4444' :
    priority === 'high' ? '#f97316' :
    '#006b68'
  );

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Swipe reveal layer */}
      <div className={cn(
        'absolute inset-0 flex items-center justify-between px-5 text-[11px] font-bold rounded-2xl pointer-events-none',
        swipeOffset > 40 ? 'fluid-swipe-hint-complete' :
        swipeOffset < -40 ? 'fluid-swipe-hint-postpone' :
        'opacity-0'
      )}>
        <span>✔ Tamamlandı</span>
        <span>↪ Ertelendi</span>
      </div>

      {/* Main card */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          background: task.completed ? '#f7faf8' : '#ffffff',
          boxShadow: task.completed ? 'none' : '0 4px 20px rgba(44,52,50,0.06)',
        }}
        className={cn(
          'group relative rounded-2xl overflow-hidden',
          isSwiping ? 'transition-none' : 'transition-all duration-200',
          task.completed ? 'opacity-55' : 'hover:-translate-y-px hover:shadow-[0_12px_36px_rgba(44,52,50,0.10)]'
        )}
      >
        {/* Left accent bar */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-2xl" style={{ background: accentColor }} />

        {/* Top row: time + title + checkbox */}
        <div className="flex items-start gap-3 px-4 pt-4 pb-3 pl-5">
          {/* Time block */}
          <div className="shrink-0 flex flex-col items-center w-12 pt-0.5">
            <span className="text-xs font-extrabold tabular-nums leading-none" style={{ color: accentColor }}>{task.startTime}</span>
            <div className="w-px flex-1 my-1 min-h-[16px]" style={{ background: `${accentColor}30` }} />
            <span className="text-[10px] font-semibold tabular-nums leading-none" style={{ color: '#9aa09e' }}>{task.endTime}</span>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
            {/* Title + badges row */}
            <div className="flex items-start gap-1.5 flex-wrap">
              <p className={cn('text-sm font-bold leading-snug', task.completed && 'line-through')} style={{ color: task.completed ? '#9aa09e' : '#2c3432' }}>
                {task.title}
              </p>
              {isVisit && (
                <span className="shrink-0 text-[9px] px-2 py-0.5 rounded-full font-bold mt-0.5" style={{ background: 'rgba(0,107,104,0.10)', color: '#006b68' }}>Ziyaret</span>
              )}
              {priority !== 'normal' && (
                <span className={cn('shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold mt-0.5', priorityConf.bg, priorityConf.color)}>
                  <priorityConf.icon className="w-2.5 h-2.5" />
                  {priorityConf.label}
                </span>
              )}
              {task.recurring && (
                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-bold mt-0.5 bg-purple-500/10 text-purple-400">
                  <Repeat className="w-2.5 h-2.5 inline" />
                </span>
              )}
              {task.approvalStatus === 'pending' && (
                <span
                  className="shrink-0 inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold mt-0.5"
                  style={{ background: 'rgba(245,158,11,0.15)', color: '#b45309' }}
                  title={task.approvalRequiredFromName ? `Onay: ${task.approvalRequiredFromName}` : 'Onay bekliyor'}
                >
                  <Clock className="w-2.5 h-2.5" />
                  Onay Bekliyor
                </span>
              )}
              {task.approvalStatus === 'rejected' && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold mt-0.5" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                  <X className="w-2.5 h-2.5" />
                  Reddedildi
                </span>
              )}
              {task.weeklyPlanGroupId && task.approvalStatus === 'approved' && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold mt-0.5" style={{ background: 'rgba(0,107,104,0.10)', color: '#006b68' }}>
                  Haftalık
                </span>
              )}
            </div>

            {/* Meta row: duration, lab, people */}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[11px] font-medium" style={{ color: '#9aa09e' }}>
                {hours > 0 ? `${hours}s ` : ''}{mins > 0 ? `${mins}dk` : ''}
              </span>
              {isVisit && task.laboratoryName && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#58615f' }}>
                  <Building2 className="w-3 h-3" />
                  {task.laboratoryName}
                </span>
              )}
              {(assignedPersonnel.length > 0 || (task.accompanyingPersonnel && task.accompanyingPersonnel.length > 0)) && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#58615f' }}>
                  <Users className="w-3 h-3" />
                  {[...(assignedPersonnel), ...(task.accompanyingPersonnel || [])].slice(0, 2).map(p => p.name.split(' ')[0]).join(', ')}
                </span>
              )}
              {task.attachments && task.attachments.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#9aa09e' }}>
                  <Paperclip className="w-3 h-3" />
                  {task.attachments.length}
                </span>
              )}
              {totalSubtasks > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#9aa09e' }}>
                  <ListChecks className="w-3 h-3" />
                  {completedSubtasks}/{totalSubtasks}
                </span>
              )}
            </div>

            {/* Subtask progress bar */}
            {totalSubtasks > 0 && (
              <div className="mt-2 w-full h-1 rounded-full overflow-hidden" style={{ background: '#f0f5f2' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(completedSubtasks / totalSubtasks) * 100}%`, background: '#006b68' }} />
              </div>
            )}
          </div>

          {/* Right: complete toggle + edit */}
          <div className="shrink-0 flex flex-col items-center gap-2 pt-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              className="w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all active:scale-85 hover:border-[#006b68]"
              style={task.completed
                ? { background: '#006b68', borderColor: '#006b68', boxShadow: '0 4px 12px rgba(0,107,104,0.28)' }
                : { borderColor: 'rgba(0,107,104,0.28)', background: 'transparent' }}
            >
              {task.completed && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="w-7 h-7 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
              style={{ background: '#f0f5f2', color: '#58615f' }}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Haftalık plan onay aksiyonları — yalnızca onay bekleyen sorumluya gösterilir */}
        {task.approvalStatus === 'pending' && canApprove && (onApprove || onReject) && (
          <div
            className="flex items-center gap-2 px-5 pb-3 -mt-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onApprove?.()}
              className="flex-1 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-[0.97]"
              style={{ background: '#006b68', color: '#e1fffd', boxShadow: '0 4px 12px rgba(0,107,104,0.25)' }}
            >
              <Check className="w-3 h-3 inline mr-1" strokeWidth={3} />
              Onayla
            </button>
            <button
              onClick={() => onReject?.()}
              className="flex-1 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-[0.97]"
              style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}
            >
              <X className="w-3 h-3 inline mr-1" strokeWidth={3} />
              Reddet
            </button>
          </div>
        )}

        {/* Expandable: subtasks, comments, attachments, logs */}
        {(showComments || showActivityLogs || (task.subtasks && task.subtasks.length > 0)) && (
          <div className="px-5 pb-4 pt-1 border-t" style={{ borderColor: 'rgba(171,180,177,0.12)' }} onClick={(e) => e.stopPropagation()}>
            {/* Subtask list */}
            {task.subtasks && task.subtasks.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {task.subtasks.map((st) => (
                  <button
                    key={st.id}
                    onClick={(e) => { e.stopPropagation(); onToggleSubtask(st.id); }}
                    className="flex items-center gap-2 text-left w-full py-1 px-2 rounded-xl transition-all active:scale-[0.99] hover:bg-[#f7faf8]"
                  >
                    <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
                      st.completed ? 'border-[#006b68] bg-[#006b68]' : 'border-[rgba(0,107,104,0.3)]'
                    )}>
                      {st.completed && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                    </div>
                    <span className={cn('text-xs font-medium', st.completed && 'line-through')} style={{ color: st.completed ? '#9aa09e' : '#2c3432' }}>
                      {st.title}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Activity logs */}
            {showActivityLogs && (
              <div className="space-y-1.5 mb-3 max-h-36 overflow-y-auto">
                {activityLogs.length === 0
                  ? <p className="text-xs" style={{ color: '#9aa09e' }}>Kayıt yok</p>
                  : activityLogs.map((log) => (
                    <div key={log.id} className="rounded-xl px-3 py-2" style={{ background: '#f7faf8' }}>
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[10px] font-bold" style={{ color: '#2c3432' }}>{log.createdByName}</span>
                        <span className="text-[10px]" style={{ color: '#9aa09e' }}>
                          {log.createdAt && 'seconds' in (log.createdAt as any) ? format(new Date((log.createdAt as any).seconds * 1000), 'dd.MM HH:mm') : ''}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed" style={{ color: '#58615f' }}>{log.message}</p>
                    </div>
                  ))
                }
              </div>
            )}

            {/* Comments */}
            {showComments && (
              <div className="space-y-2">
                {comments.length > 0 && (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {comments.map((comment) => (
                      <div key={comment.id} className="rounded-xl px-3 py-2" style={{ background: '#f7faf8' }}>
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[10px] font-bold" style={{ color: '#2c3432' }}>{comment.createdByName}</span>
                          <span className="text-[10px]" style={{ color: '#9aa09e' }}>
                            {comment.createdAt && 'seconds' in (comment.createdAt as any) ? format(new Date((comment.createdAt as any).seconds * 1000), 'dd.MM HH:mm') : ''}
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: '#58615f' }}>{comment.message}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitComment(); } }}
                    placeholder="Not ekle..."
                    className="flex-1 h-9 px-3 rounded-2xl text-xs outline-none"
                    style={{ background: '#f7faf8', color: '#2c3432' }}
                  />
                  <button onClick={submitComment} className="h-9 w-9 rounded-2xl flex items-center justify-center transition-all active:scale-95"
                    style={{ background: 'linear-gradient(135deg, #006b68, #76ddd8)', color: '#fff' }}>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom action bar (shown on hover) */}
        <div className="flex items-center gap-1 px-5 pb-3 opacity-0 group-hover:opacity-100 transition-all" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowComments((v) => !v)}
            className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-full transition-all')}
            style={showComments ? { background: 'rgba(0,107,104,0.10)', color: '#006b68' } : { color: '#9aa09e' }}
          >
            <MessageSquare className="w-3 h-3" />
            {comments.length > 0 ? `${comments.length} not` : 'Not ekle'}
          </button>
          {activityLogs.length > 0 && (
            <button
              onClick={() => setShowActivityLogs((v) => !v)}
              className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-full transition-all')}
              style={showActivityLogs ? { background: 'rgba(0,107,104,0.10)', color: '#006b68' } : { color: '#9aa09e' }}
            >
              <Clock className="w-3 h-3" />
              Geçmiş
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => onDelete()}
            className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-full transition-all hover:text-red-500"
            style={{ color: '#c5cac8' }}
          >
            <Trash2 className="w-3 h-3" />
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
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState('');
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

  // Haftalık plan modu — tarih aralığı seçilir, her güne ayrı görev girilir.
  const [weeklyPlanMode, setWeeklyPlanMode] = useState(false);
  const [weeklyPlanStart, setWeeklyPlanStart] = useState<string>(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );
  const [weeklyPlanEnd, setWeeklyPlanEnd] = useState<string>(
    format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 4), 'yyyy-MM-dd')
  );
  // Per-day entries for weekly plan
  const [wpDayEntries, setWpDayEntries] = useState<{ date: string; title: string; description: string; startTime: string; endTime: string; priority: Priority }[]>([]);
  const [wpExpandedDay, setWpExpandedDay] = useState<string | null>(null);

  // Compute business days from the selected range
  const wpBusinessDays = useMemo(() => {
    try {
      const start = parseISO(weeklyPlanStart);
      const end = parseISO(weeklyPlanEnd);
      if (isBefore(end, start)) return [];
      return eachDayOfInterval({ start, end })
        .filter((d) => !isWeekend(d))
        .filter((d) => getSpecialDay(format(d, 'yyyy-MM-dd'))?.type !== 'holiday')
        .map((d) => format(d, 'yyyy-MM-dd'));
    } catch { return []; }
  }, [weeklyPlanStart, weeklyPlanEnd]);

  // Sync day entries when business days change
  useEffect(() => {
    if (!weeklyPlanMode) return;
    setWpDayEntries((prev) => {
      const prevMap = new Map(prev.map((e) => [e.date, e]));
      return wpBusinessDays.map((d) => prevMap.get(d) || { date: d, title: '', description: '', startTime: '09:00', endTime: '10:00', priority: 'normal' as Priority });
    });
    // auto-expand first day if none expanded
    if (wpBusinessDays.length > 0 && !wpBusinessDays.includes(wpExpandedDay || '')) {
      setWpExpandedDay(wpBusinessDays[0]);
    }
  }, [wpBusinessDays, weeklyPlanMode]);

  const personnelDropdownRef = useRef<HTMLDivElement>(null);
  const assignedDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
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

  const filteredPersonnel = useMemo(() => {
    if (!personnelSearchQuery.trim()) return personnel;
    const q = personnelSearchQuery.toLowerCase();
    return personnel.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q));
  }, [personnel, personnelSearchQuery]);

  const timeValid = parseTime(endTime) > parseTime(startTime);
  const descriptionValid = description.trim().length > 0;
  const titleValid = isVisitType || title.trim().length > 0;
  const labValid = !isVisitType || selectedLabId !== '';

  // Weekly plan validation: every day must have title + description + valid time
  const wpAllDaysValid = weeklyPlanMode
    ? wpDayEntries.length > 0 && wpDayEntries.every((e) => e.title.trim().length > 0 && e.description.trim().length > 0 && parseTime(e.endTime) > parseTime(e.startTime))
    : true;

  const valid = weeklyPlanMode
    ? wpAllDaysValid && wpDayEntries.length > 0
    : titleValid && descriptionValid && timeValid && labValid;

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
      title: weeklyPlanMode ? wpDayEntries[0]?.title || 'Haftalık Plan' : effectiveTitle,
      description: weeklyPlanMode ? wpDayEntries[0]?.description || '' : description.trim(),
      taskType,
      taskTypeLabel: selectedDefinition?.name || (taskType === 'custom' ? 'Serbest Görev' : taskType),
      date: weeklyPlanMode ? wpDayEntries[0]?.date || date : date,
      startTime: weeklyPlanMode ? wpDayEntries[0]?.startTime || '09:00' : startTime,
      endTime: weeklyPlanMode ? wpDayEntries[0]?.endTime || '10:00' : endTime,
      priority: weeklyPlanMode ? wpDayEntries[0]?.priority || 'normal' : priority,
      ...(isVisitType && !weeklyPlanMode && {
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
      ...(isRecurring && !isEdit && !weeklyPlanMode && {
        recurring: {
          type: recurringType,
          interval: recurringInterval,
          ...(recurringEndDate && { endDate: recurringEndDate }),
        },
      }),
      ...(weeklyPlanMode && !isEdit && {
        weeklyPlan: true,
        weeklyPlanStart,
        weeklyPlanEnd,
        weeklyPlanDayEntries: wpDayEntries,
      }),
    });
    setSubmitting(false);
  };

  const inputCls = 'w-full px-4 py-3 rounded-2xl text-sm outline-none transition-all focus:ring-2 focus:ring-[#006b68]/20';
  const dropdownTriggerCls = 'w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm transition-all';
  const [showDetails, setShowDetails] = useState(!!isEdit);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="fluid-editorial w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-[2rem] md:rounded-[2rem] animate-in slide-in-from-bottom-4 duration-300"
        style={{ background: '#ffffff', boxShadow: '0 -8px 60px rgba(0,107,104,0.12), 0 40px 80px rgba(44,52,50,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(44,52,50,0.15)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#006b68' }}>{isEdit ? 'Düzenle' : 'Yeni Intent'}</p>
            <h3 className="text-xl font-extrabold tracking-tight mt-0.5" style={{ color: 'var(--dashboard-text)' }}>
              {isEdit ? 'Görevi Düzenle' : 'Sonraki Adım Nedir?'}
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            {isEdit && onDelete && (
              <button
                type="button"
                onClick={() => { onDelete(); }}
                className="p-2 rounded-2xl transition-all active:scale-90"
                style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose}
              className="p-2 rounded-2xl transition-all active:scale-90"
              style={{ background: '#f0f5f2', color: 'var(--dashboard-muted)' }}
            >
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

          {/* ===== SECTION B: Time — big preset buttons (hidden in weekly plan mode) ===== */}
          {!weeklyPlanMode && (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: '#f7faf8' }}>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#006b68' }}>Zaman</p>
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
                  className={cn('flex-1 py-2.5 rounded-2xl text-xs font-bold transition-all fluid-card-tap')}
                  style={date === preset.value ? { background: '#006b68', color: '#e1fffd', boxShadow: '0 4px 12px rgba(0,107,104,0.28)' } : { background: '#ffffff', color: 'var(--dashboard-muted)' }}
                >
                  {preset.label}
                </button>
              ))}
              <div className="flex-1">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputCls, 'py-2.5 text-xs text-center dark:[color-scheme:dark]')} style={{ color: 'var(--dashboard-text)', background: '#ffffff' }} />
              </div>
            </div>
            {/* Time range — side by side */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Başlangıç</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={cn(inputCls, 'py-3 text-sm dark:[color-scheme:dark]')} style={{ background: '#ffffff', color: 'var(--dashboard-text)' }} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>Bitiş</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={cn(inputCls, 'py-3 text-sm dark:[color-scheme:dark]')} style={{ background: '#ffffff', color: 'var(--dashboard-text)' }} />
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
                    className={cn('flex-1 py-2 rounded-full text-[10px] font-bold transition-all fluid-card-tap')}
                    style={isActive ? { background: '#006b68', color: '#e1fffd' } : { background: '#ffffff', color: 'var(--dashboard-muted)' }}
                  >
                    {dur.label}
                  </button>
                );
              })}
            </div>
            {/* Duration preview */}
            {timeValid && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-2xl" style={{ background: 'rgba(0,107,104,0.07)' }}>
                <Clock className="w-3.5 h-3.5" style={{ color: '#006b68' }} />
                <span className="text-[11px] font-semibold" style={{ color: '#006b68' }}>
                  {(() => { const dur = parseTime(endTime) - parseTime(startTime); const h = Math.floor(dur / 60); const m = dur % 60; return `${h > 0 ? `${h} saat ` : ''}${m > 0 ? `${m} dakika` : ''}`; })()}
                </span>
              </div>
            )}
            {!timeValid && startTime && endTime && (
              <p className="text-[10px] font-semibold text-red-500">Bitiş saati başlangıçtan sonra olmalıdır</p>
            )}
          </div>
          )}

          {/* ===== SECTION B2: Plan Modu — Günlük / Haftalık ===== */}
          {!isEdit && (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: '#f7faf8' }}>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#006b68' }}>Plan Modu</p>
                {weeklyPlanMode && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
                    Onay Bekleyecek
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setWeeklyPlanMode(false)}
                  className="py-2.5 rounded-2xl text-xs font-bold transition-all fluid-card-tap"
                  style={!weeklyPlanMode
                    ? { background: '#006b68', color: '#e1fffd', boxShadow: '0 4px 12px rgba(0,107,104,0.28)' }
                    : { background: '#ffffff', color: 'var(--dashboard-muted)' }}
                >
                  Günlük Görev
                </button>
                <button
                  type="button"
                  onClick={() => setWeeklyPlanMode(true)}
                  className="py-2.5 rounded-2xl text-xs font-bold transition-all fluid-card-tap"
                  style={weeklyPlanMode
                    ? { background: '#006b68', color: '#e1fffd', boxShadow: '0 4px 12px rgba(0,107,104,0.28)' }
                    : { background: '#ffffff', color: 'var(--dashboard-muted)' }}
                >
                  Haftalık Plan
                </button>
              </div>
              {weeklyPlanMode && (
                <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
                  {/* Date range selection */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>
                        Başlangıç Tarihi
                      </label>
                      <input
                        type="date"
                        value={weeklyPlanStart}
                        onChange={(e) => setWeeklyPlanStart(e.target.value)}
                        className={cn(inputCls, 'py-2.5 text-xs text-center dark:[color-scheme:dark]')}
                        style={{ color: 'var(--dashboard-text)', background: '#ffffff' }}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold mb-1.5" style={{ color: 'var(--dashboard-muted)' }}>
                        Bitiş Tarihi
                      </label>
                      <input
                        type="date"
                        value={weeklyPlanEnd}
                        onChange={(e) => setWeeklyPlanEnd(e.target.value)}
                        className={cn(inputCls, 'py-2.5 text-xs text-center dark:[color-scheme:dark]')}
                        style={{ color: 'var(--dashboard-text)', background: '#ffffff' }}
                      />
                    </div>
                  </div>

                  {/* Business days info */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-2xl" style={{ background: 'rgba(0,107,104,0.07)' }}>
                    <CalendarRange className="w-3.5 h-3.5" style={{ color: '#006b68' }} />
                    <span className="text-[11px] font-semibold" style={{ color: '#006b68' }}>
                      {wpBusinessDays.length > 0 ? `${wpBusinessDays.length} iş günü bulundu` : 'Seçilen aralıkta iş günü yok'}
                    </span>
                  </div>

                  {/* Per-day task entry cards */}
                  {wpDayEntries.map((entry, idx) => {
                    const dayDate = parseISO(entry.date);
                    const dayLabel = format(dayDate, 'EEEE', { locale: tr });
                    const dayFormatted = format(dayDate, 'd MMMM', { locale: tr });
                    const isExpanded = wpExpandedDay === entry.date;
                    const dayTimeValid = parseTime(entry.endTime) > parseTime(entry.startTime);
                    const dayFilled = entry.title.trim().length > 0 && entry.description.trim().length > 0 && dayTimeValid;

                    const updateEntry = (updates: Partial<typeof entry>) => {
                      setWpDayEntries((prev) => prev.map((e, i) => i === idx ? { ...e, ...updates } : e));
                    };

                    return (
                      <div
                        key={entry.date}
                        className="rounded-xl overflow-hidden transition-all"
                        style={{ border: `1px solid ${dayFilled ? 'rgba(0,107,104,0.3)' : isExpanded ? 'rgba(0,107,104,0.2)' : 'var(--dashboard-stroke)'}`, background: '#ffffff' }}
                      >
                        {/* Day header — clickable accordion */}
                        <button
                          type="button"
                          onClick={() => setWpExpandedDay(isExpanded ? null : entry.date)}
                          className="w-full flex items-center justify-between px-4 py-3 text-left transition-all hover:brightness-[0.98]"
                        >
                          <div className="flex items-center gap-2">
                            <div className={cn('w-2 h-2 rounded-full', dayFilled ? 'bg-emerald-500' : 'bg-gray-300')} />
                            <span className="text-xs font-bold capitalize" style={{ color: 'var(--dashboard-text)' }}>
                              {dayLabel}
                            </span>
                            <span className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
                              {dayFormatted}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {dayFilled && (
                              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,107,104,0.08)', color: '#006b68' }}>
                                {entry.startTime}–{entry.endTime}
                              </span>
                            )}
                            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isExpanded && 'rotate-180')} style={{ color: 'var(--dashboard-muted)' }} />
                          </div>
                        </button>

                        {/* Day form — expanded */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 space-y-3 border-t animate-in slide-in-from-top-1 duration-150" style={{ borderColor: 'var(--dashboard-stroke)' }}>
                            {/* Title */}
                            <div>
                              <label className="block text-[10px] font-semibold mb-1" style={{ color: 'var(--dashboard-muted)' }}>Başlık *</label>
                              <input
                                type="text"
                                value={entry.title}
                                onChange={(e) => updateEntry({ title: e.target.value })}
                                placeholder="Bu gün ne yapılacak?"
                                className={cn(inputCls, 'py-2.5 text-xs')}
                                style={{ color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }}
                              />
                            </div>
                            {/* Description */}
                            <div>
                              <label className="block text-[10px] font-semibold mb-1" style={{ color: 'var(--dashboard-muted)' }}>Açıklama *</label>
                              <textarea
                                value={entry.description}
                                onChange={(e) => updateEntry({ description: e.target.value })}
                                placeholder="Detaylı açıklama"
                                rows={2}
                                className={cn(inputCls, 'resize-none py-2.5 text-xs')}
                                style={{ color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }}
                              />
                            </div>
                            {/* Time */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-semibold mb-1" style={{ color: 'var(--dashboard-muted)' }}>Başlangıç</label>
                                <input
                                  type="time"
                                  value={entry.startTime}
                                  onChange={(e) => updateEntry({ startTime: e.target.value })}
                                  className={cn(inputCls, 'py-2 text-xs dark:[color-scheme:dark]')}
                                  style={{ background: '#ffffff', color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }}
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold mb-1" style={{ color: 'var(--dashboard-muted)' }}>Bitiş</label>
                                <input
                                  type="time"
                                  value={entry.endTime}
                                  onChange={(e) => updateEntry({ endTime: e.target.value })}
                                  className={cn(inputCls, 'py-2 text-xs dark:[color-scheme:dark]')}
                                  style={{ background: '#ffffff', color: 'var(--dashboard-text)', border: '1px solid var(--dashboard-stroke)' }}
                                />
                              </div>
                            </div>
                            {!dayTimeValid && entry.startTime && entry.endTime && (
                              <p className="text-[9px] font-semibold text-red-500">Bitiş saati başlangıçtan sonra olmalı</p>
                            )}
                            {/* Duration presets */}
                            <div className="flex gap-1">
                              {[
                                { label: '30dk', mins: 30 },
                                { label: '1s', mins: 60 },
                                { label: '2s', mins: 120 },
                                { label: '4s', mins: 240 },
                              ].map((dur) => {
                                const computedEnd = `${Math.floor((parseTime(entry.startTime) + dur.mins) / 60).toString().padStart(2, '0')}:${((parseTime(entry.startTime) + dur.mins) % 60).toString().padStart(2, '0')}`;
                                return (
                                  <button
                                    key={dur.label}
                                    type="button"
                                    onClick={() => updateEntry({ endTime: computedEnd })}
                                    className={cn('flex-1 py-1.5 rounded-full text-[9px] font-bold transition-all fluid-card-tap')}
                                    style={entry.endTime === computedEnd ? { background: '#006b68', color: '#e1fffd' } : { background: '#f0f5f2', color: 'var(--dashboard-muted)' }}
                                  >
                                    {dur.label}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Priority */}
                            <div>
                              <label className="block text-[10px] font-semibold mb-1" style={{ color: 'var(--dashboard-muted)' }}>Öncelik</label>
                              <div className="grid grid-cols-4 gap-1">
                                {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(([key, conf]) => (
                                  <button
                                    key={key}
                                    type="button"
                                    onClick={() => updateEntry({ priority: key })}
                                    className={cn('flex items-center justify-center gap-0.5 py-2 rounded-xl text-[9px] font-bold transition-all fluid-card-tap')}
                                    style={entry.priority === key
                                      ? { background: '#006b68', color: '#e1fffd', boxShadow: '0 2px 8px rgba(0,107,104,0.2)' }
                                      : { background: '#f0f5f2', color: 'var(--dashboard-muted)' }}
                                  >
                                    <conf.icon className="w-2.5 h-2.5" />
                                    {conf.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Info text */}
                  <p className="text-[10px] leading-relaxed" style={{ color: 'var(--dashboard-muted)' }}>
                    Her güne ayrı görev detayı girilir. Plan, firmanızın sorumlusuna
                    onay için bildirim olarak iletilir. Onaylandığında takvimde aktif olur; aksi hâlde
                    <span className="font-semibold"> "Onay Bekliyor"</span> etiketiyle görünür.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ===== SECTION C: Priority — segmented, single row (hidden in weekly plan mode) ===== */}
          {!weeklyPlanMode && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2" style={{ color: 'var(--dashboard-muted)' }}>Öncelik Seviyesi</p>
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(([key, conf]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPriority(key)}
                  className={cn(
                    'flex items-center justify-center gap-1 py-3 rounded-2xl text-[11px] font-bold transition-all fluid-card-tap'
                  )}
                  style={priority === key
                    ? { background: '#006b68', color: '#e1fffd', boxShadow: '0 4px 12px rgba(0,107,104,0.25)' }
                    : { background: '#f0f5f2', color: 'var(--dashboard-muted)' }}
                >
                  <conf.icon className="w-3 h-3" />
                  {conf.label}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* ===== SECTION D: Assignees — single big button ===== */}
          <div ref={assignedDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => { setShowAssignedDropdown((v) => !v); setShowPersonnelDropdown(false); }}
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
            <LabSelector
              label="Kurum (Laboratuvar) *"
              labs={laboratories.map(l => ({ id: l.id, name: l.name, kod: l.kod }))}
              value={selectedLabId}
              onChange={setSelectedLabId}
              placeholder="Laboratuvar seçin"
            />
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
                onClick={() => { setShowPersonnelDropdown((v) => !v); setShowAssignedDropdown(false); }}
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
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderTop: '1px solid rgba(171,180,177,0.12)', background: '#ffffff' }}>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 px-5 py-3.5 rounded-full text-sm font-bold transition-all active:scale-95 fluid-card-tap"
            style={{ background: '#f0f5f2', color: 'var(--dashboard-muted)' }}
          >
            Vazgeç
          </button>
          <button
            type="submit"
            form="task-form"
            disabled={!valid || submitting}
            onClick={(e) => { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); }}
            className={cn('flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full text-sm font-bold transition-all active:scale-[0.97]', valid && !submitting ? 'fluid-btn-primary' : 'cursor-not-allowed')}
            style={!valid || submitting ? { background: '#e9efed', color: 'var(--dashboard-muted)' } : {}}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {files.length > 0 ? 'Dosyalar yükleniyor...' : isEdit ? 'Güncelleniyor...' : 'Ekleniyor...'}
              </>
            ) : (
              <>
                {!isEdit && !weeklyPlanMode && <Plus className="w-4 h-4" strokeWidth={2.5} />}
                {!isEdit && weeklyPlanMode && <Send className="w-4 h-4" strokeWidth={2.5} />}
                {isEdit
                  ? 'Kaydet'
                  : weeklyPlanMode
                  ? `Haftalık Planı Onaya Gönder (${wpDayEntries.length} gün)`
                  : `Görev Ekle${files.length > 0 ? ` (${files.length} dosya)` : ''}`}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
