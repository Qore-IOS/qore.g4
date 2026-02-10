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
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import type {
  PurchasingTask,
  PurchasingTaskAttachment,
  PurchasingSubtask,
  PurchasingTaskRecurrence,
  PurchasingTaskComment,
  PurchasingTaskActivity,
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
  UserPlus,
  History,
  AtSign,
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

// ==========================================
// Helper: Occupancy calculation (9-5, 8 hours)
// ==========================================

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
const TOTAL_WORK_MINUTES = (WORK_END_HOUR - WORK_START_HOUR) * 60;

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

// ==========================================
// Form data interface (shared between add & edit)
// ==========================================

interface TaskFormData {
  title: string;
  description: string;
  taskType: 'custom' | 'kurum_ziyareti';
  date: string;
  startTime: string;
  endTime: string;
  priority: Priority;
  laboratoryId?: string;
  laboratoryName?: string;
  accompanyingPersonnel?: { uid: string; name: string }[];
  assignedTo?: { uid: string; name: string }[];
  files?: File[];
  existingAttachments?: PurchasingTaskAttachment[];
  removedAttachments?: PurchasingTaskAttachment[];
  subtasks?: PurchasingSubtask[];
  recurring?: PurchasingTaskRecurrence;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
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

  // Reference data
  const [laboratories, setLaboratories] = useState<Hospital[]>([]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [personnel, setPersonnel] = useState<User[]>([]);

  const sliderRef = useRef<HTMLDivElement>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  // Firestore listener
  useEffect(() => {
    const q = query(collection(db, 'purchasingTasks'), orderBy('date', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PurchasingTask[];
        setTasks(items);
      },
      (err) => console.error('PurchasingTasks listen error', err)
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

  // Filter tasks visible to current user (creator or assigned)
  const myTasks = useMemo(() => {
    if (!currentUserProfile) return tasks;
    const uid = currentUserProfile.uid;
    return tasks.filter((t) =>
      t.createdByUid === uid ||
      t.assignedTo?.some((a) => a.uid === uid) ||
      // Show all tasks if no assignedTo (backwards compat)
      !t.assignedTo || t.assignedTo.length === 0
    );
  }, [tasks, currentUserProfile]);

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
    const newStatus = !task.completed;
    const activity: PurchasingTaskActivity = {
      id: generateId(),
      action: newStatus ? 'completed' : 'reopened',
      userId: currentUserProfile.uid,
      userName: currentUserProfile.name || '',
      details: newStatus ? 'Görev tamamlandı' : 'Görev yeniden açıldı',
      createdAt: new Date().toISOString(),
    };
    try {
      await updateDoc(doc(db, 'purchasingTasks', task.id), {
        completed: newStatus,
        updatedAt: Timestamp.now(),
        activities: [...(task.activities || []), activity],
      });
    } catch (err) {
      console.error('Error toggling task', err);
      toast.error('Görev güncellenemedi');
    }
  }, [currentUserProfile]);

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

  // Delete task
  const deleteTask = useCallback(async (task: PurchasingTask) => {
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
      console.error('Error deleting task', err);
      toast.error('Görev silinemedi');
    }
  }, [editingTask]);

  // Add task
  const handleAddTask = useCallback(
    async (data: TaskFormData) => {
      if (!currentUserProfile) return;
      try {
        const createdActivity: PurchasingTaskActivity = {
          id: generateId(),
          action: 'created',
          userId: currentUserProfile.uid,
          userName: currentUserProfile.name || '',
          details: 'Görev oluşturuldu',
          createdAt: new Date().toISOString(),
        };

        const taskDoc: Record<string, any> = {
          title: data.title,
          description: data.description,
          taskType: data.taskType,
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          priority: data.priority,
          completed: false,
          createdAt: Timestamp.now(),
          createdByUid: currentUserProfile.uid,
          createdByName: currentUserProfile.name || '',
          sortOrder: Date.now(),
          activities: [createdActivity],
        };

        if (data.assignedTo?.length) {
          taskDoc.assignedTo = data.assignedTo;
          const names = data.assignedTo.map((a) => a.name).join(', ');
          taskDoc.activities.push({
            id: generateId(),
            action: 'assigned',
            userId: currentUserProfile.uid,
            userName: currentUserProfile.name || '',
            details: `Atanan kişiler: ${names}`,
            createdAt: new Date().toISOString(),
          });
        }

        if (data.taskType === 'kurum_ziyareti') {
          if (data.laboratoryId) taskDoc.laboratoryId = data.laboratoryId;
          if (data.laboratoryName) taskDoc.laboratoryName = data.laboratoryName;
          if (data.accompanyingPersonnel?.length) taskDoc.accompanyingPersonnel = data.accompanyingPersonnel;
        }

        if (data.subtasks?.length) taskDoc.subtasks = data.subtasks;
        if (data.recurring) {
          taskDoc.recurring = data.recurring;
          taskDoc.recurringGroupId = `rg_${Date.now()}`;
        }

        const docRef = await addDoc(collection(db, 'purchasingTasks'), taskDoc);

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

        // Create recurring instances
        if (data.recurring) {
          const futureDates = generateRecurringDates(data.date, data.recurring);
          if (futureDates.length > 0) {
            const batch = writeBatch(db);
            for (const futureDate of futureDates) {
              const recurDoc = { ...taskDoc, date: futureDate, createdAt: Timestamp.now() };
              batch.set(doc(collection(db, 'purchasingTasks')), recurDoc);
            }
            await batch.commit();
            toast.success(`${futureDates.length} tekrarlayan görev oluşturuldu`);
          }
        }

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

  // Add comment to a task
  const handleAddComment = useCallback(
    async (task: PurchasingTask, text: string) => {
      if (!currentUserProfile || !text.trim()) return;
      const comment: PurchasingTaskComment = {
        id: generateId(),
        userId: currentUserProfile.uid,
        userName: currentUserProfile.name || '',
        text: text.trim(),
        createdAt: new Date().toISOString(),
      };
      const activity: PurchasingTaskActivity = {
        id: generateId(),
        action: 'comment_added',
        userId: currentUserProfile.uid,
        userName: currentUserProfile.name || '',
        details: `Yorum ekledi: "${text.trim().substring(0, 60)}${text.trim().length > 60 ? '...' : ''}"`,
        createdAt: new Date().toISOString(),
      };
      try {
        await updateDoc(doc(db, 'purchasingTasks', task.id), {
          comments: [...(task.comments || []), comment],
          activities: [...(task.activities || []), activity],
          updatedAt: Timestamp.now(),
        });
        toast.success('Yorum eklendi');
      } catch (err) {
        console.error('Error adding comment', err);
        toast.error('Yorum eklenemedi');
      }
    },
    [currentUserProfile]
  );

  // Edit task
  const handleEditTask = useCallback(
    async (data: TaskFormData) => {
      if (!editingTask || !currentUserProfile) return;
      try {
        const activities = [...(editingTask.activities || [])];

        // Track changes for activity log
        const changes: string[] = [];
        if (editingTask.title !== data.title) changes.push(`Başlık: "${editingTask.title}" → "${data.title}"`);
        if (editingTask.startTime !== data.startTime || editingTask.endTime !== data.endTime) {
          changes.push(`Saat: ${editingTask.startTime}-${editingTask.endTime} → ${data.startTime}-${data.endTime}`);
        }
        if (editingTask.date !== data.date) changes.push(`Tarih: ${editingTask.date} → ${data.date}`);
        if ((editingTask.priority || 'normal') !== data.priority) changes.push(`Öncelik değiştirildi: ${data.priority}`);

        // Track assignedTo changes
        const oldAssigned = (editingTask.assignedTo || []).map((a) => a.uid).sort().join(',');
        const newAssigned = (data.assignedTo || []).map((a) => a.uid).sort().join(',');
        if (oldAssigned !== newAssigned) {
          const names = (data.assignedTo || []).map((a) => a.name).join(', ') || 'Kimse';
          changes.push(`Atanan kişiler: ${names}`);
        }

        if (changes.length > 0) {
          activities.push({
            id: generateId(),
            action: 'updated',
            userId: currentUserProfile.uid,
            userName: currentUserProfile.name || '',
            details: changes.join(' | '),
            createdAt: new Date().toISOString(),
          });
        }

        const updates: Record<string, any> = {
          title: data.title,
          description: data.description,
          taskType: data.taskType,
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          priority: data.priority,
          updatedAt: Timestamp.now(),
          assignedTo: data.assignedTo?.length ? data.assignedTo : null,
          activities,
        };

        if (data.taskType === 'kurum_ziyareti') {
          updates.laboratoryId = data.laboratoryId || null;
          updates.laboratoryName = data.laboratoryName || null;
          updates.accompanyingPersonnel = data.accompanyingPersonnel?.length ? data.accompanyingPersonnel : null;
        } else {
          updates.laboratoryId = null;
          updates.laboratoryName = null;
          updates.accompanyingPersonnel = null;
        }

        updates.subtasks = data.subtasks?.length ? data.subtasks : null;

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

        await updateDoc(doc(db, 'purchasingTasks', editingTask.id), updates);
        toast.success('Görev güncellendi');
        setEditingTask(null);
        setSelectedDate(parseISO(data.date));
      } catch (err) {
        console.error('Error editing task', err);
        toast.error('Görev güncellenemedi');
      }
    },
    [editingTask, currentUserProfile]
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
            className="flex flex-nowrap gap-1.5 overflow-x-auto scrollbar-none py-2 flex-1 min-w-0"
            style={{ scrollSnapType: 'x mandatory' }}
          >
            {sliderDates.map((date) => {
              const dateStr = format(date, 'yyyy-MM-dd');
              const isSelected = isSameDay(date, selectedDate);
              const today = isToday(date);
              const occupancy = getOccupancyForDay(myTasks, dateStr);
              const dayTaskCount = myTasks.filter((t) => t.date === dateStr).length;

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(date)}
                  style={{ scrollSnapAlign: 'center' }}
                  className={cn(
                    'shrink-0 w-[60px] md:w-auto md:flex-1 md:min-w-0 flex flex-col items-center justify-center rounded-2xl py-2.5 transition-all duration-200',
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
            className="shrink-0 p-1.5 rounded-xl hover:bg-accent transition-colors"
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
                const occupancy = getOccupancyForDay(myTasks, dayStr);
                const hasTasks = myTasks.some((t) => t.date === dayStr);
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

      {/* Task List with DnD */}
      <div className="px-4 md:px-8 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Görevler ({dayTasks.length})</h3>
        </div>

        {dayTasks.length === 0 ? (
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
                  onOpenDetail={() => setDetailTask(task)}
                  onEdit={() => setEditingTask(task)}
                  onDelete={() => deleteTask(task)}
                />
              </div>
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

      {/* Add Modal */}
      {showAddModal && (
        <TaskFormModal
          mode="add"
          defaultDate={selectedDateStr}
          laboratories={mainLaboratories}
          personnel={personnel}
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
}: {
  task: PurchasingTask;
  onToggle: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const durationMin = parseTime(task.endTime) - parseTime(task.startTime);
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;
  const isVisit = task.taskType === 'kurum_ziyareti';
  const priority = (task.priority || 'normal') as Priority;
  const priorityConf = PRIORITY_CONFIG[priority];
  const completedSubtasks = task.subtasks?.filter((s) => s.completed).length || 0;
  const totalSubtasks = task.subtasks?.length || 0;

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 p-4 rounded-2xl border-l-[3px] border border-border transition-all duration-200',
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
  onClose,
  onSubmit,
  onDelete,
}: {
  mode: 'add' | 'edit';
  task?: PurchasingTask;
  defaultDate: string;
  laboratories: Hospital[];
  personnel: User[];
  onClose: () => void;
  onSubmit: (data: TaskFormData) => void;
  onDelete?: () => void;
}) {
  const isEdit = mode === 'edit' && task;

  const [taskType, setTaskType] = useState<'custom' | 'kurum_ziyareti'>(isEdit ? task.taskType || 'custom' : 'custom');
  const [title, setTitle] = useState(isEdit ? (task.taskType === 'kurum_ziyareti' ? '' : task.title) : '');
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
  const [labSearchQuery, setLabSearchQuery] = useState('');
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState('');
  const [showLabDropdown, setShowLabDropdown] = useState(false);
  const [showPersonnelDropdown, setShowPersonnelDropdown] = useState(false);

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (labDropdownRef.current && !labDropdownRef.current.contains(e.target as Node)) setShowLabDropdown(false);
      if (personnelDropdownRef.current && !personnelDropdownRef.current.contains(e.target as Node)) setShowPersonnelDropdown(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const effectiveTitle = taskType === 'kurum_ziyareti' ? 'Kurum Ziyareti' : title;
  const selectedLab = laboratories.find((l) => l.id === selectedLabId);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const allowed = Array.from(selected).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (allowed.length < selected.length) toast.error('Sadece resim ve PDF dosyaları yüklenebilir');
    setFiles((prev) => [...prev, ...allowed]);
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
      date,
      startTime,
      endTime,
      priority,
      ...(taskType === 'kurum_ziyareti' && {
        laboratoryId: selectedLabId,
        laboratoryName: selectedLab?.name || '',
        accompanyingPersonnel: selectedPersonnel.length > 0 ? selectedPersonnel : undefined,
      }),
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
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Görev Türü</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setTaskType('custom'); setTitle(''); setSelectedLabId(''); setSelectedPersonnel([]); }}
                className={cn('flex-1 py-2.5 px-3 rounded-xl text-sm font-medium border transition-all', taskType === 'custom' ? cn(ACCENT_BG_SUBTLE, ACCENT_BORDER, ACCENT) : 'bg-secondary border-border text-muted-foreground hover:border-muted-foreground/40')}
              >
                Serbest Görev
              </button>
              <button
                type="button"
                onClick={() => { setTaskType('kurum_ziyareti'); setTitle('Kurum Ziyareti'); }}
                className={cn('flex-1 py-2.5 px-3 rounded-xl text-sm font-medium border transition-all flex items-center justify-center gap-2', taskType === 'kurum_ziyareti' ? cn(ACCENT_BG_SUBTLE, ACCENT_BORDER, ACCENT) : 'bg-secondary border-border text-muted-foreground hover:border-muted-foreground/40')}
              >
                <Building2 className="w-4 h-4" />
                Kurum Ziyareti
              </button>
            </div>
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
          {taskType === 'custom' ? (
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Görev Adı *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Görev başlığı girin" className={inputCls} autoFocus />
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
                onClick={() => { setShowLabDropdown((v) => !v); setShowPersonnelDropdown(false); }}
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

          {/* Accompanying Personnel (kurum_ziyareti only) */}
          {taskType === 'kurum_ziyareti' && (
            <div ref={personnelDropdownRef} className="relative">
              <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Eşlik Eden Personel</label>
              <button
                type="button"
                onClick={() => { setShowPersonnelDropdown((v) => !v); setShowLabDropdown(false); }}
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
