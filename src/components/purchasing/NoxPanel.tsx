'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Check, ChevronLeft, X, Search, Volume2, VolumeX,
  Settings, BarChart2, Calendar, Share2, Copy, Zap,
} from 'lucide-react';
import NoxStatsOverlay, { FlatTask } from './NoxStatsOverlay';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, serverTimestamp, orderBy,
} from 'firebase/firestore';

const COLLECTION = 'planlamaTasks';

interface TreeTask extends FlatTask {
  subtasks: TreeTask[];
}

let audioCtx: AudioContext | null = null;

const playSubtleSound = (type: 'add' | 'complete' | 'delete', isEnabled: boolean) => {
  if (!isEnabled) return;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  const now = audioCtx.currentTime;

  if (type === 'add') {
    osc.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.05, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  } else if (type === 'complete') {
    osc.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.05, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now); osc.stop(now + 0.15);
  } else {
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 300;
    osc.connect(filter); filter.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.02, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  }
};

// Dependency-free confetti burst rendered on a transient full-screen canvas.
const fireConfetti = (colors: string[]) => {
  if (typeof document === 'undefined') return;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483647';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }

  const count = 60;
  const originX = canvas.width / 2;
  const originY = canvas.height * 0.8;
  const gravity = 0.35;

  const particles = Array.from({ length: count }, () => {
    // Spread ~45deg cone aimed upward.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 4);
    const speed = 8 + Math.random() * 9;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 4 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)] || '#ffffff',
      life: 1,
    };
  });

  let frame = 0;
  const maxFrames = 120;

  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      p.life = Math.max(0, 1 - frame / maxFrames);
      if (p.life > 0 && p.y < canvas.height + 20) alive = true;
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    }
    frame++;
    if (alive && frame < maxFrames) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  };

  requestAnimationFrame(tick);
};

export default function NoxPanel() {
  const { currentUser, currentCompanyId } = useAuth();

  const [flatTasks, setFlatTasks] = useState<FlatTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [navigationStack, setNavigationStack] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickInputValue, setQuickInputValue] = useState('');
  const [quickDueDateValue, setQuickDueDateValue] = useState('');
  const [quickPriorityValue, setQuickPriorityValue] = useState<'low' | 'medium' | 'high' | null>(null);
  const [quickAddTargetRoot, setQuickAddTargetRoot] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [bgColor, setBgColor] = useState('#000000');
  const [themeColor, setThemeColor] = useState('#ffffff');
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('nox_sound') !== 'false';
  });
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'high' | 'medium' | 'low' | 'completed' | 'uncompleted'>('all');
  const [inputValue, setInputValue] = useState('');
  const [dueDateValue, setDueDateValue] = useState('');
  const [priorityValue, setPriorityValue] = useState<'low' | 'medium' | 'high' | null>(null);
  const [direction, setDirection] = useState(1);
  const [longPressedTask, setLongPressedTask] = useState<TreeTask | null>(null);
  const isDraggingRef = useRef(false);

  const [isCalendarView, setIsCalendarView] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [longPressedCalendarDay, setLongPressedCalendarDay] = useState<{ dayStr: string; tasks: TreeTask[] } | null>(null);

  const calendarPressTimerRef = useRef<any>(null);
  const isCalendarLongPressTriggered = useRef(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const isLongPressTriggered = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const todayDateStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // Set nox CSS vars on mount, restore on unmount
  useEffect(() => {
    document.documentElement.style.setProperty('--bg-color', bgColor);
    document.documentElement.style.setProperty('--theme-color', themeColor);
    return () => {
      document.documentElement.style.removeProperty('--bg-color');
      document.documentElement.style.removeProperty('--theme-color');
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--bg-color', bgColor);
    document.documentElement.style.setProperty('--theme-color', themeColor);
  }, [bgColor, themeColor]);

  // Load tasks from Firestore scoped by companyId
  useEffect(() => {
    if (!currentUser || !currentCompanyId) return;

    setLoading(true);
    const q = query(
      collection(db, COLLECTION),
      where('companyId', '==', currentCompanyId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as FlatTask));
      const sorted = [...data].sort((a, b) => {
        const orderA = a.order ?? 0;
        const orderB = b.order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
      });
      setFlatTasks(sorted);
      setLoading(false);
    }, (err) => {
      console.error('NoxPanel Firestore error:', err);
      setLoading(false);
    });

    return unsubscribe;
  }, [currentUser, currentCompanyId]);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage({ text, type });
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 4000);
  };

  const triggerFeedback = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(5);
  };

  const triggerConfetti = () => {
    fireConfetti([themeColor, '#888888', '#aaaaaa', '#555555', '#dddddd']);
  };

  const handlePointerDown = (task: TreeTask) => {
    isLongPressTriggered.current = false;
    pressTimerRef.current = setTimeout(() => {
      isLongPressTriggered.current = true;
      setLongPressedTask(task);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(60);
    }, 350);
  };

  const clearLongPress = () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
  };

  const handleTaskClick = (task: TreeTask) => {
    clearLongPress();
    if (isLongPressTriggered.current) { isLongPressTriggered.current = false; return; }
    triggerFeedback();
    navigateIn(task.id);
  };

  const handleCalendarDayPointerDown = (dayStr: string, dayTasks: TreeTask[]) => {
    isCalendarLongPressTriggered.current = false;
    if (dayTasks.length === 0) return;
    calendarPressTimerRef.current = setTimeout(() => {
      isCalendarLongPressTriggered.current = true;
      setLongPressedCalendarDay({ dayStr, tasks: dayTasks });
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(60);
    }, 350);
  };

  const clearCalendarDayLongPress = () => {
    if (calendarPressTimerRef.current) clearTimeout(calendarPressTimerRef.current);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' ||
        activeEl.hasAttribute('contenteditable')
      );

      if (e.key === 'Escape') {
        let closed = false;
        if (isAdding) { setIsAdding(false); closed = true; }
        if (isQuickAddOpen) { setIsQuickAddOpen(false); closed = true; }
        if (isSettingsOpen) { setIsSettingsOpen(false); closed = true; }
        if (isStatsOpen) { setIsStatsOpen(false); closed = true; }
        if (longPressedTask) { setLongPressedTask(null); closed = true; }
        if (longPressedCalendarDay) { setLongPressedCalendarDay(null); closed = true; }
        if (isSearching) { setIsSearching(false); setSearchQuery(''); closed = true; }
        if (closed) { e.preventDefault(); triggerFeedback(); }
        return;
      }
      if (isTyping) return;

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      const isAlt = e.altKey;

      if ((isCtrlOrMeta && e.key?.toLowerCase() === 'n') || (isAlt && e.key?.toLowerCase() === 'n') || e.key?.toLowerCase() === 'n') {
        e.preventDefault(); triggerFeedback(); setIsAdding(true); return;
      }
      if ((isCtrlOrMeta && e.key?.toLowerCase() === 'k') || e.key === '/' || e.key?.toLowerCase() === 's') {
        e.preventDefault(); triggerFeedback();
        if (isSearching) { setIsSearching(false); setSearchQuery(''); }
        else {
          setIsSearching(true);
          setTimeout(() => {
            const inp = document.querySelector('input[placeholder*="ARA"]') as HTMLInputElement;
            if (inp) { inp.focus(); inp.select(); }
          }, 50);
        }
        return;
      }
      if ((isAlt && e.key?.toLowerCase() === 'i') || e.key?.toLowerCase() === 'i' || e.key === ',') {
        e.preventDefault(); triggerFeedback(); setIsSettingsOpen(p => !p); return;
      }
      if ((isAlt && e.key?.toLowerCase() === 'a') || e.key?.toLowerCase() === 'a') {
        e.preventDefault(); triggerFeedback(); setIsStatsOpen(p => !p); return;
      }
      if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && navigationStack.length > 0) {
        e.preventDefault(); triggerFeedback(); navigateBack(); return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAdding, isQuickAddOpen, isSettingsOpen, isStatsOpen, longPressedTask, isSearching, navigationStack, longPressedCalendarDay]);

  // Tree building
  const taskTree = useMemo(() => {
    const list = JSON.parse(JSON.stringify(flatTasks)) as TreeTask[];
    const map: Record<string, TreeTask> = {};
    const root: TreeTask[] = [];
    list.forEach(t => { t.subtasks = []; map[t.id] = t; });
    list.forEach(t => {
      if (t.parentId && map[t.parentId]) map[t.parentId].subtasks.push(t);
      else root.push(t);
    });
    return root;
  }, [flatTasks]);

  const listToTreeFind = (tree: TreeTask[], id: string): TreeTask | null => {
    for (const node of tree) {
      if (node.id === id) return node;
      const found = listToTreeFind(node.subtasks, id);
      if (found) return found;
    }
    return null;
  };

  const getCurrentCollection = (): TreeTask[] => {
    let current = taskTree;
    for (const id of navigationStack) {
      const found = listToTreeFind(taskTree, id);
      if (found) current = found.subtasks;
    }
    return current;
  };

  const currentTask = useMemo(() => {
    if (navigationStack.length === 0) return null;
    return flatTasks.find(t => t.id === navigationStack[navigationStack.length - 1]) || null;
  }, [navigationStack, flatTasks]);

  const getActiveTitle = () => {
    if (!currentTask) return 'PLANLAMA';
    return currentTask.title.toLocaleUpperCase('tr-TR');
  };

  const stats = useMemo(() => {
    const current = getCurrentCollection();
    return { completed: current.filter(t => t.completed).length, total: current.length };
  }, [navigationStack, taskTree]);

  const getDescendants = (id: string, list: FlatTask[]): string[] => {
    const children = list.filter(t => t.parentId === id);
    let ids = children.map(c => c.id);
    children.forEach(c => { ids = [...ids, ...getDescendants(c.id, list)]; });
    return ids;
  };

  // CRUD operations
  const addTask = async () => {
    if (!inputValue.trim() || !currentUser) return;
    const parentId = navigationStack.length > 0 ? navigationStack[navigationStack.length - 1] : null;
    try {
      const payload: any = {
        title: inputValue.trim(), completed: false,
        userId: currentUser.uid, companyId: currentCompanyId,
        parentId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      if (dueDateValue) payload.dueDate = dueDateValue;
      if (priorityValue) payload.priority = priorityValue;
      await addDoc(collection(db, COLLECTION), payload);
      playSubtleSound('add', isSoundEnabled);
      setInputValue(''); setDueDateValue(''); setPriorityValue(null); setIsAdding(false);
    } catch (err) {
      console.error('addTask error:', err);
    }
  };

  const addQuickTask = async () => {
    if (!quickInputValue.trim() || !currentUser) return;
    const parentId = (!quickAddTargetRoot && navigationStack.length > 0)
      ? navigationStack[navigationStack.length - 1] : null;
    try {
      const payload: any = {
        title: quickInputValue.trim(), completed: false,
        userId: currentUser.uid, companyId: currentCompanyId,
        parentId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      if (quickDueDateValue) payload.dueDate = quickDueDateValue;
      if (quickPriorityValue) payload.priority = quickPriorityValue;
      await addDoc(collection(db, COLLECTION), payload);
      playSubtleSound('add', isSoundEnabled);
      setQuickInputValue(''); setQuickDueDateValue(''); setQuickPriorityValue(null); setIsQuickAddOpen(false);
      showToast('Hızlı görev başarıyla oluşturuldu.', 'success');
    } catch (err) {
      console.error('addQuickTask error:', err);
    }
  };

  const toggleTask = async (taskId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, COLLECTION, taskId), { completed: !currentStatus, updatedAt: serverTimestamp() });
      if (!currentStatus) { playSubtleSound('complete', isSoundEnabled); triggerConfetti(); }
    } catch (err) {
      console.error('toggleTask error:', err);
    }
  };

  const updateTaskPriority = async (taskId: string, priority: 'low' | 'medium' | 'high' | null) => {
    try {
      await updateDoc(doc(db, COLLECTION, taskId), { priority, updatedAt: serverTimestamp() });
      showToast('Görev önceliği güncellendi.', 'success');
      if (longPressedTask?.id === taskId) setLongPressedTask(p => p ? { ...p, priority } : null);
    } catch (err) {
      console.error('updateTaskPriority error:', err);
    }
  };

  const updateTaskDueDate = async (taskId: string, dueDate: string) => {
    try {
      await updateDoc(doc(db, COLLECTION, taskId), { dueDate: dueDate || null, updatedAt: serverTimestamp() });
      showToast('Görev tarihi güncellendi.', 'success');
      if (longPressedTask?.id === taskId) setLongPressedTask(p => p ? { ...p, dueDate: dueDate || null } : null);
    } catch (err) {
      console.error('updateTaskDueDate error:', err);
    }
  };

  const deleteTask = async (taskId: string, e: React.MouseEvent | { stopPropagation: () => void }) => {
    e.stopPropagation();
    try {
      playSubtleSound('delete', isSoundEnabled);
      const batch = [taskId, ...getDescendants(taskId, flatTasks)];
      for (const id of batch) await deleteDoc(doc(db, COLLECTION, id));
      if (navigationStack.includes(taskId)) {
        setNavigationStack(prev => prev.slice(0, prev.indexOf(taskId)));
      }
    } catch (err) {
      console.error('deleteTask error:', err);
    }
  };

  const navigateIn = (taskId: string) => { setDirection(1); setNavigationStack([...navigationStack, taskId]); };
  const navigateBack = () => { setDirection(-1); setNavigationStack(navigationStack.slice(0, -1)); };

  const toggleSound = () => {
    const v = !isSoundEnabled;
    setIsSoundEnabled(v);
    localStorage.setItem('nox_sound', v.toString());
    if (v) playSubtleSound('complete', true);
  };

  const handleCopyTaskText = (task: TreeTask) => {
    triggerFeedback();
    const priorityText = task.priority === 'high' ? ' [YÜKSEK ÖNCELİK]' : task.priority === 'medium' ? ' [ORTA ÖNCELİK]' : task.priority === 'low' ? ' [DÜŞÜK ÖNCELİK]' : '';
    const dateText = task.dueDate ? ` (📅 Bitiş: ${task.dueDate})` : '';
    const subtasksText = task.subtasks?.length ? '\nAlt Görevler:\n' + task.subtasks.map(s => `  ${s.completed ? '✓' : '○'} ${s.title}`).join('\n') : '';
    navigator.clipboard.writeText(`📌 ${task.title}${priorityText}${dateText}${subtasksText}`)
      .then(() => showToast('Görev metni kopyalandı.', 'success'))
      .catch(() => showToast('Kopyalama başarısız oldu.', 'error'));
  };

  const handleNativeShareTask = async (task: TreeTask) => {
    triggerFeedback();
    const priorityText = task.priority === 'high' ? ' [YÜKSEK ÖNCELİK]' : task.priority === 'medium' ? ' [ORTA ÖNCELİK]' : task.priority === 'low' ? ' [DÜŞÜK ÖNCELİK]' : '';
    const dateText = task.dueDate ? ` (📅 Bitiş: ${task.dueDate})` : '';
    const subtasksText = task.subtasks?.length ? '\nAlt Görevler:\n' + task.subtasks.map(s => `  ${s.completed ? '✓' : '○'} ${s.title}`).join('\n') : '';
    const shareContent = `📌 ${task.title}${priorityText}${dateText}${subtasksText}`;
    if (navigator.share) {
      try { await navigator.share({ title: task.title, text: shareContent }); showToast('Görev paylaşıldı.', 'success'); }
      catch { handleCopyTaskText(task); }
    } else {
      handleCopyTaskText(task);
    }
  };

  const currentItems = useMemo(() => {
    let items: TreeTask[] = [];
    if (showAllTasks) {
      items = flatTasks.map(t => ({ ...t, subtasks: [] })) as TreeTask[];
      items.sort((a, b) => {
        const va = a.dueDate?.trim() ?? '';
        const vb = b.dueDate?.trim() ?? '';
        if (va && !vb) return -1;
        if (!va && vb) return 1;
        if (!va && !vb) return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
        return va.localeCompare(vb);
      });
    } else {
      items = getCurrentCollection();
    }
    if (searchQuery) {
      const q = searchQuery.toLocaleLowerCase('tr-TR');
      items = items.filter(t => t.title.toLocaleLowerCase('tr-TR').includes(q));
    }
    if (filterMode !== 'all') {
      items = items.filter(t => {
        if (filterMode === 'completed') return t.completed;
        if (filterMode === 'uncompleted') return !t.completed;
        return t.priority === filterMode;
      });
    }
    return items;
  }, [navigationStack, flatTasks, taskTree, searchQuery, showAllTasks, filterMode]);

  const [orderedItems, setOrderedItems] = useState<TreeTask[]>([]);
  useEffect(() => { setOrderedItems(currentItems); }, [currentItems]);

  if (loading && flatTasks.length === 0) {
    return (
      <div className="bg-brand-bg text-brand-fg min-h-full flex items-center justify-center">
        <motion.div
          animate={{ opacity: [0.2, 0.5, 0.2] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="text-xs uppercase tracking-[1em]"
        >
          YÜKLENİYOR
        </motion.div>
      </div>
    );
  }

  return (
    <div className="bg-brand-bg text-brand-fg min-h-full flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="p-4 md:p-16 pb-4 md:pb-6 border-b border-brand-fg/20 flex justify-between items-end sticky top-0 bg-brand-bg z-20">
        <div className="flex flex-col gap-1 md:gap-2 min-w-0 flex-1">
          <AnimatePresence mode="wait">
            {navigationStack.length > 0 && (
              <motion.button
                key="back"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 0.5, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-2 text-[10px] md:text-xs uppercase tracking-[0.3em] hover:opacity-100 transition-opacity w-fit"
                onClick={() => { triggerFeedback(); navigateBack(); }}
              >
                <ChevronLeft size={14} /> GERİ
              </motion.button>
            )}
          </AnimatePresence>
          <div className="flex items-center gap-2 md:gap-6 min-w-0">
            <motion.h1
              key={getActiveTitle()}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`text-[clamp(1.5rem,8vw,4.5rem)] font-bold tracking-tighter truncate leading-tight transition-opacity duration-500 ${currentTask?.completed ? 'opacity-30' : 'opacity-100'}`}
            >
              {getActiveTitle()}
            </motion.h1>
            {currentTask && (
              <motion.button
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                onClick={() => { triggerFeedback(); toggleTask(currentTask.id, currentTask.completed); }}
                className={`flex shrink-0 items-center justify-center transition-all ${currentTask.completed ? 'text-brand-fg' : 'text-brand-fg/10'}`}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {currentTask.completed ? (
                    <motion.svg
                      key="header-complete"
                      initial={{ pathLength: 0, scale: 0.5, opacity: 0, rotate: -45 }}
                      animate={{ pathLength: 1, scale: 1, opacity: 1, rotate: 0 }}
                      exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.2 } }}
                      transition={{ duration: 0.4, type: 'spring', bounce: 0.5 }}
                      className="w-8 h-8 md:w-12 md:h-12"
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                    >
                      <motion.polyline
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4 }} points="20 6 9 17 4 12"
                      />
                    </motion.svg>
                  ) : (
                    <motion.span
                      key="header-incomplete"
                      initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.2 } }}
                      className="text-2xl md:text-5xl"
                    >✓</motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 md:gap-4 ml-2 shrink-0">
          <button onClick={() => { triggerFeedback(); toggleSound(); }} className="w-10 h-10 md:w-14 md:h-14 flex items-center justify-center hover:opacity-50 transition-all" title={isSoundEnabled ? 'Sesi Kapat' : 'Sesi Aç'}>
            {isSoundEnabled ? <Volume2 className="w-5 h-5 md:w-7 md:h-7" /> : <VolumeX className="w-5 h-5 md:w-7 md:h-7 opacity-50" />}
          </button>
          <button onClick={() => { triggerFeedback(); setIsSearching(!isSearching); if (isSearching) setSearchQuery(''); }} className="w-10 h-10 md:w-14 md:h-14 flex items-center justify-center hover:opacity-50 transition-all" title="Ara">
            <Search className="w-5 h-5 md:w-7 md:h-7" />
          </button>
          <button onClick={() => { triggerFeedback(); setIsQuickAddOpen(true); }} className="w-10 h-10 md:w-14 md:h-14 flex items-center justify-center hover:opacity-50 transition-all text-amber-400" title="Hızlı Ekle">
            <Zap className="w-5 h-5 md:w-7 md:h-7 fill-amber-400/10" />
          </button>
          <button onClick={() => { triggerFeedback(); setIsAdding(true); }} className="w-10 h-10 md:w-14 md:h-14 flex items-center justify-center hover:opacity-50 transition-all">
            <Plus className="w-6 h-6 md:w-8 md:h-8" />
          </button>
          <button onClick={() => { triggerFeedback(); setIsStatsOpen(true); }} className="w-10 h-10 md:w-14 md:h-14 flex items-center justify-center hover:opacity-50 transition-all" title="Analiz">
            <BarChart2 className="w-5 h-5 md:w-7 md:h-7" />
          </button>
          <button onClick={() => { triggerFeedback(); setIsSettingsOpen(true); }} className="w-10 h-10 md:w-14 md:h-14 flex items-center justify-center hover:opacity-50 transition-all" title="Ayarlar">
            <Settings className="w-5 h-5 md:w-7 md:h-7" />
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 p-4 md:p-16 pt-6 md:pt-8 overflow-y-auto">
        <div className="flex flex-col gap-8 md:gap-12 max-w-6xl mx-auto">

          <AnimatePresence>
            {isSearching && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto', marginBottom: 32 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }} className="overflow-hidden"
              >
                <div className="relative">
                  <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-6 h-6 md:w-8 md:h-8 text-brand-fg/30" />
                  <input
                    type="text" autoFocus placeholder="ARA..."
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-transparent border-b border-brand-fg/20 pb-4 pl-10 md:pl-14 text-2xl md:text-4xl font-bold tracking-tighter outline-none placeholder:opacity-10"
                  />
                  {searchQuery && (
                    <button onClick={() => { triggerFeedback(); setSearchQuery(''); }} className="absolute right-0 top-1/2 -translate-y-1/2 p-2 hover:opacity-50 transition-opacity">
                      <X className="w-6 h-6 md:w-8 md:h-8 text-brand-fg/50" />
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* View Toggle */}
          <div className="flex justify-between items-center border-b border-brand-fg/10 pb-4">
            <div className="flex gap-6">
              {(['LİSTE GÖRÜNÜMÜ', 'TAKVİM GÖRÜNÜMÜ'] as const).map(label => {
                const isCalendar = label === 'TAKVİM GÖRÜNÜMÜ';
                const active = isCalendar ? isCalendarView : !isCalendarView;
                return (
                  <button key={label} onClick={() => { triggerFeedback(); setIsCalendarView(isCalendar); }}
                    className={`pb-2 px-1 text-xs uppercase tracking-widest border-b-2 transition-all ${active ? 'border-brand-fg font-bold opacity-100' : 'border-transparent opacity-40 hover:opacity-75'}`}
                  >{label}</button>
                );
              })}
            </div>
            {!isCalendarView && (
              <button
                onClick={() => { triggerFeedback(); setShowAllTasks(!showAllTasks); }}
                className={`text-[10px] uppercase tracking-wider font-mono transition-all rounded-full px-3 py-1 flex items-center gap-1.5 border ${showAllTasks ? 'border-brand-fg bg-brand-fg/10 font-bold opacity-100 text-brand-fg' : 'border-brand-fg/10 opacity-40 hover:opacity-80 text-brand-fg bg-transparent'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${showAllTasks ? 'bg-amber-500 animate-pulse' : 'bg-brand-fg/30'}`} />
                TÜMÜNÜ GÖSTER
              </button>
            )}
          </div>

          {/* Filters */}
          {!isCalendarView && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
              className="flex gap-2 overflow-x-auto snap-x py-2 -mt-4 mb-2 max-w-full" style={{ scrollbarWidth: 'none' }}
            >
              {(['all', 'high', 'medium', 'low', 'completed', 'uncompleted'] as const).map(f => (
                <button key={f} onClick={() => { triggerFeedback(); setFilterMode(f); }}
                  className={`snap-center flex-shrink-0 text-[10px] md:text-xs font-mono uppercase tracking-widest px-4 py-2 md:px-5 md:py-2.5 rounded-full border transition-all ${
                    filterMode === f
                      ? f === 'high' ? 'bg-red-500/10 border-red-500/50 text-red-500 font-bold shadow-sm'
                        : f === 'medium' ? 'bg-orange-500/10 border-orange-500/50 text-orange-500 font-bold shadow-sm'
                        : f === 'low' ? 'bg-blue-500/10 border-blue-500/50 text-blue-500 font-bold shadow-sm'
                        : f === 'completed' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-500 font-bold shadow-sm'
                        : 'bg-brand-fg border-brand-fg text-brand-bg font-bold shadow-sm'
                      : 'border-brand-fg/15 text-brand-fg/60 hover:bg-brand-fg/5 hover:text-brand-fg hover:border-brand-fg/30'
                  }`}
                >
                  {f === 'all' ? 'TÜMÜ' : f === 'high' ? '⚡ YÜKSEK' : f === 'medium' ? 'ORTA' : f === 'low' ? 'DÜŞÜK' : f === 'completed' ? '✓ TAMAMLANANLAR' : '○ BEKLEYENLER'}
                </button>
              ))}
            </motion.div>
          )}

          {/* Calendar View */}
          {isCalendarView ? (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
              <div className="flex justify-between items-center bg-brand-fg/5 p-4 rounded-3xl border border-brand-fg/5">
                <button onClick={() => { triggerFeedback(); if (calendarMonth === 0) { setCalendarMonth(11); setCalendarYear(y => y - 1); } else setCalendarMonth(m => m - 1); }}
                  className="p-3 opacity-60 hover:opacity-100 transition-opacity bg-brand-fg/5 rounded-full">
                  <ChevronLeft size={20} />
                </button>
                <h2 className="text-lg md:text-xl font-bold tracking-tight uppercase font-mono">
                  {new Date(calendarYear, calendarMonth).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}
                </h2>
                <button onClick={() => { triggerFeedback(); if (calendarMonth === 11) { setCalendarMonth(0); setCalendarYear(y => y + 1); } else setCalendarMonth(m => m + 1); }}
                  className="p-3 opacity-60 hover:opacity-100 transition-opacity bg-brand-fg/5 rounded-full rotate-180">
                  <ChevronLeft size={20} />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 md:gap-3 text-center text-xs opacity-40 font-bold uppercase tracking-wider font-mono">
                {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map(d => <div key={d}>{d}</div>)}
              </div>

              <div className="grid grid-cols-7 gap-1 md:gap-3">
                {(() => {
                  const totalDays = new Date(calendarYear, calendarMonth + 1, 0).getDate();
                  let firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
                  firstDay = firstDay === 0 ? 6 : firstDay - 1;
                  const prevTotal = new Date(calendarYear, calendarMonth, 0).getDate();
                  const cells: { day: number; isCurrentMonth: boolean; month: number; year: number }[] = [];
                  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: prevTotal - i, isCurrentMonth: false, month: calendarMonth === 0 ? 11 : calendarMonth - 1, year: calendarMonth === 0 ? calendarYear - 1 : calendarYear });
                  for (let i = 1; i <= totalDays; i++) cells.push({ day: i, isCurrentMonth: true, month: calendarMonth, year: calendarYear });
                  for (let i = 1; i <= 42 - cells.length; i++) cells.push({ day: i, isCurrentMonth: false, month: calendarMonth === 11 ? 0 : calendarMonth + 1, year: calendarMonth === 11 ? calendarYear + 1 : calendarYear });
                  return cells.map((cell, idx) => {
                    const formattedDate = `${cell.year}-${String(cell.month + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
                    const dayTasks = flatTasks.filter(t => t.dueDate === formattedDate) as TreeTask[];
                    const isToday = formattedDate === todayDateStr;
                    const completedCount = dayTasks.filter(t => t.completed).length;
                    return (
                      <motion.div
                        key={`${formattedDate}-${idx}`}
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onPointerDown={() => handleCalendarDayPointerDown(formattedDate, dayTasks)}
                        onPointerUp={clearCalendarDayLongPress} onPointerLeave={clearCalendarDayLongPress}
                        onPointerCancel={clearCalendarDayLongPress} onContextMenu={e => e.preventDefault()}
                        onClick={() => {
                          if (dayTasks.length > 0) setLongPressedCalendarDay({ dayStr: formattedDate, tasks: dayTasks });
                          else { triggerFeedback(); setDueDateValue(formattedDate); setIsAdding(true); }
                        }}
                        className={`relative aspect-square rounded-2xl flex flex-col justify-between p-2 md:p-3 border select-none cursor-pointer transition-all ${cell.isCurrentMonth ? 'opacity-100' : 'opacity-25'} ${isToday ? 'bg-brand-fg/[0.08] border-brand-fg/40' : 'bg-brand-fg/5 border-brand-fg/5 hover:border-brand-fg/20'}`}
                      >
                        <span className={`text-xs md:text-sm font-semibold font-mono ${isToday ? 'text-amber-500 font-bold underline' : ''}`}>{cell.day}</span>
                        {dayTasks.length > 0 && (
                          <div className="flex flex-col gap-1 w-full mt-auto">
                            <div className="hidden md:flex flex-col gap-0.5">
                              <span className="text-[8px] font-bold text-brand-fg/50 tracking-tighter truncate leading-none uppercase">{dayTasks.length} GÖREV</span>
                              <div className="h-1 bg-brand-fg/10 rounded-full w-full overflow-hidden">
                                <div className="h-full bg-brand-fg" style={{ width: `${(completedCount / dayTasks.length) * 100}%` }} />
                              </div>
                            </div>
                            <div className="flex md:hidden gap-1 justify-center mt-1">
                              {dayTasks.map(t => (
                                <div key={t.id} className={`w-1.5 h-1.5 rounded-full ${t.completed ? 'bg-brand-fg/20' : t.priority === 'high' ? 'bg-red-500' : t.priority === 'medium' ? 'bg-orange-500' : 'bg-blue-500'}`} />
                              ))}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  });
                })()}
              </div>
              <p className="text-center text-[10px] md:text-xs opacity-40 font-mono tracking-widest mt-2 uppercase">
                💡 Görevi görmek için güne tıklayın veya basılı tutun
              </p>
            </motion.div>
          ) : (
            /* List View */
            <section className="flex flex-col">
              <motion.div layout className="space-y-4">
                <AnimatePresence mode="popLayout" initial={false}>
                  {orderedItems.map((task, index) => {
                    const isDueToday = task.dueDate === todayDateStr && !task.completed;
                    return (
                      <motion.div
                        key={task.id} layout="position"
                        custom={direction}
                        initial={{ opacity: 0, x: 20 * direction, filter: 'blur(5px)' }}
                        animate={{ opacity: 1, x: 0, filter: 'blur(0px)', transition: { delay: index * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] } }}
                        exit={{ opacity: 0, scale: 0.95, filter: 'blur(5px)', transition: { duration: 0.3, ease: 'easeOut' } }}
                        className="relative overflow-hidden rounded-2xl group/swipe select-none"
                      >
                        <motion.div
                          drag="x"
                          dragConstraints={{ left: 0, right: 0 }}
                          dragElastic={{ left: 0.6, right: 0.6 }}
                          dragTransition={{ bounceStiffness: 600, bounceDamping: 25 }}
                          onDragStart={() => { isDraggingRef.current = true; }}
                          onDrag={(event, info) => {
                            const el = (event.target as HTMLElement).closest('.draggable-card') as HTMLElement;
                            if (el) {
                              const threshold = 100;
                              const passed = Math.abs(info.offset.x) > threshold;
                              const prev = el.dataset.passed === 'true';
                              if (passed && !prev) { if (navigator.vibrate) navigator.vibrate([50, 30, 50]); el.dataset.passed = 'true'; }
                              else if (!passed && prev) el.dataset.passed = 'false';
                              if (info.offset.x > 0) {
                                const op = Math.min(info.offset.x / threshold, 1) * 0.5;
                                el.style.boxShadow = passed ? `inset 0 0 40px rgba(16,185,129,0.4),0 0 20px rgba(16,185,129,0.6)` : `inset 0 0 20px rgba(16,185,129,${op})`;
                                el.style.borderColor = `rgba(16,185,129,${passed ? 0.8 : op * 0.5})`;
                              } else if (info.offset.x < 0) {
                                const op = Math.min(-info.offset.x / threshold, 1) * 0.5;
                                el.style.boxShadow = passed ? `inset 0 0 40px rgba(239,68,68,0.4),0 0 20px rgba(239,68,68,0.6)` : `inset 0 0 20px rgba(239,68,68,${op})`;
                                el.style.borderColor = `rgba(239,68,68,${passed ? 0.8 : op * 0.5})`;
                              }
                            }
                          }}
                          onDragEnd={(event, info) => {
                            setTimeout(() => { isDraggingRef.current = false; }, 500);
                            const el = (event.target as HTMLElement).closest('.draggable-card') as HTMLElement;
                            if (el) { el.style.boxShadow = ''; el.style.borderColor = ''; el.dataset.passed = 'false'; }
                            const threshold = 100;
                            if (info.offset.x > threshold) {
                              if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
                              toggleTask(task.id, task.completed);
                            } else if (info.offset.x < -threshold) {
                              if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
                              if (window.confirm('Bu görevi silmek istediğinize emin misiniz?')) {
                                deleteTask(task.id, { stopPropagation: () => {} });
                              }
                            }
                          }}
                          onPointerDown={() => handlePointerDown(task)}
                          onPointerUp={clearLongPress} onPointerLeave={clearLongPress} onPointerCancel={clearLongPress}
                          onContextMenu={e => e.preventDefault()}
                          onClickCapture={e => {
                            e.preventDefault();
                            if (isDraggingRef.current) return;
                            handleTaskClick(task);
                          }}
                          className={`draggable-card flex justify-between items-center group cursor-grab active:cursor-grabbing border pb-3 last:border-b select-none z-10 px-4 py-3 rounded-2xl transition-all duration-300 relative bg-brand-bg ${isDueToday ? 'bg-amber-500/[0.04] border-amber-500/25 shadow-[0_4px_20px_rgba(245,158,11,0.08)] pl-6' : 'bg-brand-bg border-transparent border-b-brand-fg/5 hover:bg-brand-fg/[0.02]'}`}
                        >
                          {isDueToday && <div className="absolute left-0 top-0 bottom-0 w-1 md:w-1.5 bg-gradient-to-b from-amber-400 to-amber-600 rounded-r-xl" />}
                          <div className="flex-1 flex flex-col gap-0.5 min-w-0 origin-left">
                            <motion.span
                              layout="position"
                              animate={{ opacity: task.completed ? 0.3 : 0.8, scale: task.completed ? 0.85 : 1 }}
                              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                              style={{ transformOrigin: 'left center' }}
                              className={`text-xl md:text-2xl font-light tracking-tight break-words whitespace-pre-wrap ${task.completed ? 'line-through' : ''}`}
                            >{task.title}</motion.span>
                            {task.subtasks.length > 0 && (
                              <motion.div layout="position" className="flex flex-col gap-2 mt-1 w-full max-w-[10rem]">
                                <span className="text-[9px] uppercase tracking-[0.2em] opacity-40">{task.subtasks.filter(s => s.completed).length} / {task.subtasks.length} TAMAMLANDI</span>
                                <div className="h-[2px] w-full bg-brand-fg/10 rounded-full overflow-hidden">
                                  <motion.div
                                    className="h-full bg-brand-fg/70" initial={false}
                                    animate={{ width: `${(task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100}%` }}
                                    transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                                  />
                                </div>
                              </motion.div>
                            )}
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              {task.priority && (
                                <motion.span layout="position"
                                  className={`text-[9px] md:text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-sm border ${task.priority === 'high' ? 'border-red-500/50 text-red-400 bg-red-500/10' : task.priority === 'medium' ? 'border-orange-500/50 text-orange-400 bg-orange-500/10' : 'border-blue-500/50 text-blue-400 bg-blue-500/10'} ${task.completed ? 'opacity-30' : ''}`}
                                >
                                  {task.priority === 'high' ? 'YÜKSEK' : task.priority === 'medium' ? 'ORTA' : 'DÜŞÜK'}
                                </motion.span>
                              )}
                              {task.dueDate && (
                                <motion.span layout="position"
                                  className={`text-[10px] md:text-xs font-mono uppercase opacity-50 ${task.completed ? 'line-through opacity-20' : ''} ${isDueToday ? 'text-amber-500 font-bold opacity-100' : ''}`}
                                >
                                  BİTİŞ: {task.dueDate}{isDueToday && ' • BUGÜN ⚡'}
                                </motion.span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 md:gap-8 pointer-events-auto">
                            <button
                              onClickCapture={e => {
                                e.stopPropagation(); e.preventDefault();
                                if (isDraggingRef.current) return;
                                if (window.confirm('Bu görevi silmek istediğinize emin misiniz?')) {
                                  triggerFeedback(); deleteTask(task.id, e);
                                }
                              }}
                              className="opacity-0 group-hover:opacity-30 hover:opacity-100 text-3xl transition-opacity px-2"
                            >×</button>
                            <button
                              onClickCapture={e => {
                                e.stopPropagation(); e.preventDefault();
                                if (isDraggingRef.current) return;
                                triggerFeedback(); toggleTask(task.id, task.completed);
                              }}
                              className={`w-12 h-12 flex items-center justify-center transition-colors duration-500 rounded-full ${task.completed ? 'bg-brand-fg/10' : 'hover:bg-brand-fg/5'}`}
                            >
                              <AnimatePresence mode="wait" initial={false}>
                                {task.completed ? (
                                  <motion.svg
                                    key={`check-${task.id}`}
                                    initial={{ scale: 0.5, opacity: 0, rotate: -45 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                    exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.2 } }}
                                    transition={{ duration: 0.4, type: 'spring', bounce: 0.5 }}
                                    className="text-brand-fg w-5 h-5 md:w-6 md:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                                  >
                                    <motion.polyline initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3 }} points="20 6 9 17 4 12" />
                                  </motion.svg>
                                ) : (
                                  <motion.div key={`circle-${task.id}`}
                                    initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.2 } }}
                                    className="w-4 h-4 border border-brand-fg/40 rounded-full group-hover:border-brand-fg transition-colors"
                                  />
                                )}
                              </AnimatePresence>
                            </button>
                          </div>
                        </motion.div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {orderedItems.length === 0 && !loading && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-24 text-center">
                    <p className="text-brand-fg/20 text-sm uppercase tracking-[0.3em]">
                      {filterMode !== 'all' || searchQuery ? 'SONUÇ BULUNAMADI' : 'HENÜZ GÖREV YOK'}
                    </p>
                    {filterMode === 'all' && !searchQuery && (
                      <button onClick={() => { triggerFeedback(); setIsAdding(true); }} className="mt-8 text-xs uppercase tracking-widest opacity-40 hover:opacity-80 transition-opacity">
                        + İLK GÖREVİ EKLE
                      </button>
                    )}
                  </motion.div>
                )}
              </motion.div>
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 md:p-16 pt-4 md:pt-8 border-t border-brand-fg/10 flex justify-between items-center text-xs tracking-widest opacity-30 uppercase">
        <div>{stats.completed} TAMAMLANDI / {stats.total} TOPLAM</div>
        <div>Planlama</div>
      </footer>

      {/* Quick Add Overlay */}
      <AnimatePresence>
        {isQuickAddOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-brand-bg/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 cursor-default"
            onClick={() => setIsQuickAddOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 30, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-brand-bg border border-brand-fg/10 p-6 md:p-8 w-full max-w-lg rounded-[2rem] shadow-2xl flex flex-col gap-6 relative"
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-6 right-6">
                <button onClick={() => setIsQuickAddOpen(false)} className="p-2 opacity-55 hover:opacity-100 rounded-full hover:bg-brand-fg/5 transition-colors"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex items-center gap-3">
                <Zap className="w-6 h-6 text-amber-400 fill-amber-400/20" />
                <h3 className="text-xl md:text-2xl font-bold tracking-tight">Hızlı Görev Ekle</h3>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-[0.2em] opacity-40">GÖREV BAŞLIĞI</span>
                <input
                  type="text" autoFocus placeholder="Hızlıca bir şeyler yazın..."
                  value={quickInputValue} onChange={e => setQuickInputValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addQuickTask(); } }}
                  className="bg-brand-fg/5 outline-none border border-brand-fg/15 rounded-2xl px-4 py-3 text-lg font-light tracking-tight w-full hover:border-brand-fg/30 focus:border-brand-fg/50 transition-colors"
                />
              </div>
              {navigationStack.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-[0.2em] opacity-40 font-mono">KONUM</span>
                  <div className="flex gap-2 p-1 bg-brand-fg/5 rounded-2xl border border-brand-fg/5">
                    {[{ label: 'Ana Ekran (Root)', value: true }, { label: 'Mevcut Bölüm', value: false }].map(opt => (
                      <button key={String(opt.value)} type="button" onClick={() => { triggerFeedback(); setQuickAddTargetRoot(opt.value); }}
                        className={`flex-1 py-1.5 text-xs uppercase tracking-wider font-semibold rounded-xl transition-all ${quickAddTargetRoot === opt.value ? 'bg-brand-fg text-brand-bg shadow-sm' : 'text-brand-fg/60 hover:text-brand-fg'}`}
                      >{opt.label}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.2em] opacity-40 font-mono font-semibold">BİTİŞ TARİHİ</span>
                <input type="date" value={quickDueDateValue} onChange={e => setQuickDueDateValue(e.target.value)}
                  className="bg-brand-fg/5 text-brand-fg font-mono outline-none cursor-pointer border border-brand-fg/15 rounded-2xl px-4 py-3 text-sm [color-scheme:dark] w-full" />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.2em] opacity-40 font-mono font-semibold">ÖNCELİK</span>
                <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {(['low', 'medium', 'high'] as const).map(p => (
                    <button key={p} onClick={() => { triggerFeedback(); setQuickPriorityValue(p === quickPriorityValue ? null : p); }}
                      className={`text-xs uppercase tracking-widest px-4 py-2 rounded-xl border transition-all whitespace-nowrap flex-1 text-center ${quickPriorityValue === p ? p === 'high' ? 'bg-red-500/20 border-red-500 text-red-500 font-semibold' : p === 'medium' ? 'bg-orange-500/20 border-orange-500 text-orange-500 font-semibold' : 'bg-blue-500/20 border-blue-500 text-blue-500 font-semibold' : 'border-brand-fg/10 text-brand-fg/50 hover:border-brand-fg/30 bg-brand-fg/5'}`}
                    >{p === 'high' ? 'YÜKSEK' : p === 'medium' ? 'ORTA' : 'DÜŞÜK'}</button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => { triggerFeedback(); addQuickTask(); }}
                disabled={!quickInputValue.trim()}
                className="mt-2 w-full flex items-center justify-center gap-2 text-xs uppercase tracking-widest font-bold py-4 rounded-2xl bg-brand-fg text-brand-bg hover:opacity-90 active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none transition-all"
              >
                <Plus size={14} strokeWidth={3} /> GÖREVİ EKLE
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Task Overlay */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-brand-bg/95 z-50 flex flex-col p-6 md:p-16"
          >
            <div className="flex items-end mb-12 md:mb-24 border-b border-brand-fg pb-4 md:pb-8 flex-between justify-between gap-4">
              <h1 className="text-4xl md:text-7xl font-bold tracking-tighter shrink">
                {navigationStack.length === 0 ? 'YENİ GÖREV' : 'YENİ ALT GÖREV'}
              </h1>
              <button onClick={() => { triggerFeedback(); setIsAdding(false); }}
                className="text-sm md:text-xl opacity-50 hover:opacity-100 uppercase tracking-widest md:mb-4 bg-brand-fg/10 px-4 py-2 rounded-full shrink-0">
                Kapat
              </button>
            </div>
            <div className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full">
              <textarea
                ref={inputRef} autoFocus placeholder="BURAYA YAZIN..." rows={4}
                value={inputValue} onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addTask(); } if (e.key === 'Escape') setIsAdding(false); }}
                className={`bg-transparent font-bold tracking-tighter outline-none placeholder:opacity-5 border-none w-full transition-all duration-300 resize-none ${navigationStack.length === 0 ? 'text-3xl md:text-6xl/tight' : 'text-2xl md:text-4xl/tight'}`}
              />
              <div className="mt-8 flex flex-col md:flex-row md:items-center gap-4 border-b border-brand-fg/20 pb-4">
                <span className="text-xs uppercase tracking-[0.2em] opacity-40">BİTİŞ TARİHİ</span>
                <input type="date" value={dueDateValue} onChange={e => setDueDateValue(e.target.value)}
                  className="bg-transparent text-brand-fg font-mono outline-none cursor-pointer placeholder:opacity-20 flex-1 [color-scheme:dark]" />
              </div>
              <div className="mt-4 flex flex-col md:flex-row md:items-center gap-4 border-b border-brand-fg/20 pb-4">
                <span className="text-xs uppercase tracking-[0.2em] opacity-40">ÖNCELİK</span>
                <div className="flex gap-2 flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {(['low', 'medium', 'high'] as const).map(p => (
                    <button key={p} onClick={() => { triggerFeedback(); setPriorityValue(p === priorityValue ? null : p); }}
                      className={`text-xs uppercase tracking-widest px-4 py-2 rounded-full border transition-all whitespace-nowrap ${priorityValue === p ? p === 'high' ? 'bg-red-500/20 border-red-500 text-red-500' : p === 'medium' ? 'bg-orange-500/20 border-orange-500 text-orange-500' : 'bg-blue-500/20 border-blue-500 text-blue-500' : 'border-brand-fg/20 text-brand-fg/50 hover:border-brand-fg/50'}`}
                    >{p === 'high' ? 'YÜKSEK' : p === 'medium' ? 'ORTA' : 'DÜŞÜK'}</button>
                  ))}
                </div>
              </div>
              <motion.button
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                onClick={() => { triggerFeedback(); addTask(); }}
                className="mt-24 self-start flex items-center gap-6 text-2xl font-medium group"
              >
                <Plus size={32} strokeWidth={3} /> GÖREV OLUŞTUR
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Long Press Context Menu */}
      <AnimatePresence>
        {longPressedTask && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-brand-bg/60 backdrop-blur-md z-[100] flex items-center justify-center p-4"
            onClick={() => setLongPressedTask(null)}
          >
            <motion.div
              initial={{ scale: 0.7, y: 40, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.8, y: 20, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 400, mass: 0.8 }}
              className="bg-brand-bg border border-brand-fg/10 p-6 md:p-8 w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden flex flex-col gap-4 relative"
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-4 right-4">
                <button onClick={() => setLongPressedTask(null)} className="p-2 opacity-50 hover:opacity-100 rounded-full bg-brand-fg/5"><X className="w-5 h-5" /></button>
              </div>
              <h3 className="text-xl md:text-2xl font-bold tracking-tight mb-2 pr-8">{longPressedTask.title}</h3>
              <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-2" style={{ scrollbarWidth: 'none' }}>
                {longPressedTask.subtasks.length === 0 ? (
                  <p className="text-brand-fg/40 text-sm">Alt görev bulunmuyor.</p>
                ) : (
                  longPressedTask.subtasks.map(subtask => (
                    <div key={subtask.id} className="flex items-center gap-3 p-3 bg-brand-fg/5 rounded-2xl">
                      <div className={`w-4 h-4 rounded-full border border-brand-fg/20 flex-shrink-0 ${subtask.completed ? 'bg-brand-fg' : ''}`} />
                      <span className={`text-sm md:text-base opacity-80 ${subtask.completed ? 'line-through opacity-40' : ''}`}>{subtask.title}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-brand-fg/10 pt-4">
                <span className="text-xs uppercase tracking-[0.2em] opacity-40">ÖNCELİK DEĞİŞTİR</span>
                <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {(['low', 'medium', 'high'] as const).map(p => (
                    <button key={p} onClick={() => { triggerFeedback(); updateTaskPriority(longPressedTask.id, p === longPressedTask.priority ? null : p); }}
                      className={`text-xs uppercase tracking-widest px-4 py-2 rounded-full border transition-all whitespace-nowrap ${longPressedTask.priority === p ? p === 'high' ? 'bg-red-500/20 border-red-500 text-red-500' : p === 'medium' ? 'bg-orange-500/20 border-orange-500 text-orange-500' : 'bg-blue-500/20 border-blue-500 text-blue-500' : 'border-brand-fg/20 text-brand-fg/40 hover:border-brand-fg/60'}`}
                    >{p === 'high' ? 'YÜKSEK' : p === 'medium' ? 'ORTA' : 'DÜŞÜK'}</button>
                  ))}
                </div>
              </div>

              <div className="mt-2 flex flex-col gap-3 border-t border-brand-fg/10 pt-4">
                <span className="text-xs uppercase tracking-[0.2em] opacity-40">BİTİŞ TARİHİ DEĞİŞTİR</span>
                <div className="flex items-center gap-2">
                  <input type="date" value={longPressedTask.dueDate || ''} onChange={e => { triggerFeedback(); updateTaskDueDate(longPressedTask.id, e.target.value); }}
                    className="bg-transparent text-brand-fg font-mono outline-none cursor-pointer flex-1 [color-scheme:dark] border border-brand-fg/10 rounded-xl px-3 py-2 text-sm" />
                  {longPressedTask.dueDate && (
                    <button onClick={() => { triggerFeedback(); updateTaskDueDate(longPressedTask.id, ''); }}
                      className="text-xs uppercase tracking-widest px-3 py-2 rounded-xl border border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10 transition-colors">X</button>
                  )}
                </div>
              </div>

              <div className="mt-2 flex flex-col gap-3 border-t border-brand-fg/10 pt-4">
                <span className="text-xs uppercase tracking-[0.2em] opacity-40">PAYLAŞ</span>
                <div className="flex gap-2">
                  <button onClick={() => handleCopyTaskText(longPressedTask)}
                    className="flex-1 flex items-center justify-center gap-2 text-xs uppercase tracking-widest px-3 py-2.5 rounded-xl border border-brand-fg/10 hover:border-brand-fg/30 transition-all font-mono text-brand-fg/70 hover:text-brand-fg">
                    <Copy className="w-3.5 h-3.5" /> Kopyala
                  </button>
                  <button onClick={() => handleNativeShareTask(longPressedTask)}
                    className="flex-1 flex items-center justify-center gap-2 text-xs uppercase tracking-widest px-3 py-2.5 rounded-xl border border-brand-fg/10 hover:border-brand-fg/30 transition-all font-mono text-brand-fg/70 hover:text-brand-fg">
                    <Share2 className="w-3.5 h-3.5" /> Paylaş
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Panel */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-brand-bg/60 backdrop-blur-md z-[100] flex items-center justify-center p-4"
            onClick={() => setIsSettingsOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.7, y: 40, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.8, y: 20, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 400, mass: 0.8 }}
              className="bg-brand-bg border border-brand-fg/10 p-6 md:p-8 w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden flex flex-col gap-6 relative"
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-4 right-4">
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 opacity-50 hover:opacity-100 rounded-full bg-brand-fg/5"><X className="w-5 h-5" /></button>
              </div>
              <h3 className="text-xl md:text-2xl font-bold tracking-tight mb-2 pr-8">AYARLAR</h3>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium opacity-80">Arka Plan Rengi</span>
                  <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium opacity-80">Tema Rengi</span>
                  <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium opacity-80">Ses Efektleri</span>
                  <button onClick={toggleSound} className={`w-12 h-6 rounded-full relative transition-colors ${isSoundEnabled ? 'bg-green-500' : 'bg-brand-fg/20'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-brand-fg transition-all ${isSoundEnabled ? 'left-7 bg-white' : 'left-1'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2 pt-4 border-t border-brand-fg/10">
                  <span className="text-sm font-medium opacity-80">Karanlık Mod (Sıfırla)</span>
                  <button onClick={() => { setBgColor('#000000'); setThemeColor('#ffffff'); }}
                    className="px-3 py-1.5 bg-brand-fg/10 hover:bg-brand-fg/20 rounded text-xs font-bold transition-colors">
                    SIFIRLA
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats Overlay */}
      <AnimatePresence>
        {isStatsOpen && (
          <NoxStatsOverlay
            isOpen={isStatsOpen}
            onClose={() => setIsStatsOpen(false)}
            flatTasks={flatTasks}
            themeColor={themeColor}
          />
        )}
      </AnimatePresence>

      {/* Calendar Day Detail */}
      <AnimatePresence>
        {longPressedCalendarDay && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-brand-bg/60 backdrop-blur-md z-[110] flex items-center justify-center p-4 cursor-pointer"
            onClick={() => setLongPressedCalendarDay(null)}
          >
            <motion.div
              initial={{ scale: 0.7, y: 40, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.8, y: 20, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 400, mass: 0.8 }}
              className="bg-brand-bg border border-brand-fg/10 p-6 md:p-8 w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden flex flex-col gap-4 relative cursor-default"
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-4 right-4">
                <button onClick={() => setLongPressedCalendarDay(null)} className="p-2 opacity-50 hover:opacity-100 rounded-full bg-brand-fg/5"><X className="w-5 h-5" /></button>
              </div>
              <h3 className="text-lg md:text-xl font-bold tracking-tight mb-2 pr-8 uppercase flex flex-col gap-0.5">
                <span className="text-[10px] uppercase font-mono tracking-[0.2em] opacity-45">GÖREV LİSTESİ</span>
                <span>{new Date(longPressedCalendarDay.dayStr).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </h3>
              <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto pr-2" style={{ scrollbarWidth: 'none' }}>
                {longPressedCalendarDay.tasks.map(task => (
                  <div key={task.id} className="flex flex-col gap-2 p-3 bg-brand-fg/5 rounded-2xl border border-brand-fg/5 relative group">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            triggerFeedback();
                            toggleTask(task.id, task.completed);
                            setLongPressedCalendarDay(prev => prev ? { ...prev, tasks: prev.tasks.map(t => t.id === task.id ? { ...t, completed: !t.completed } : t) } : null);
                          }}
                          className={`w-6 h-6 border flex-shrink-0 rounded-full transition-all flex items-center justify-center ${task.completed ? 'bg-brand-fg border-brand-fg text-brand-bg' : 'border-brand-fg/30'}`}
                        >
                          {task.completed && <Check className="w-4 h-4" strokeWidth={3} />}
                        </button>
                        <span className={`text-sm md:text-base font-medium transition-all ${task.completed ? 'line-through opacity-40' : 'opacity-90'}`}>{task.title}</span>
                      </div>
                      <button
                        onClick={async e => {
                          e.stopPropagation(); triggerFeedback();
                          await deleteTask(task.id, e);
                          setLongPressedCalendarDay(prev => {
                            if (!prev) return null;
                            const remaining = prev.tasks.filter(t => t.id !== task.id);
                            return remaining.length === 0 ? null : { ...prev, tasks: remaining };
                          });
                        }}
                        className="opacity-20 hover:opacity-100 text-lg transition-opacity px-2 font-light"
                      >×</button>
                    </div>
                    {task.subtasks && task.subtasks.length > 0 && (
                      <div className="pl-9 flex flex-col gap-1 border-t border-brand-fg/5 pt-2">
                        {task.subtasks.map(sub => (
                          <div key={sub.id} className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${sub.completed ? 'bg-brand-fg' : 'border border-brand-fg/30'}`} />
                            <span className={`text-xs ${sub.completed ? 'line-through opacity-40' : 'opacity-70'}`}>{sub.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {task.priority && (
                      <div className="flex gap-2 pl-9">
                        <span className={`text-[8px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded-sm border ${task.priority === 'high' ? 'border-red-500/30 text-red-400 bg-red-500/5' : task.priority === 'medium' ? 'border-orange-500/30 text-orange-400 bg-orange-500/5' : 'border-blue-500/30 text-blue-400 bg-blue-500/5'}`}>
                          {task.priority === 'high' ? 'YÜKSEK' : task.priority === 'medium' ? 'ORTA' : 'DÜŞÜK'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }} transition={{ duration: 0.2 }}
            className="fixed top-8 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-full border border-brand-fg/10 bg-brand-bg shadow-2xl flex items-center gap-3 backdrop-blur-md max-w-sm w-[90%]"
          >
            <div className={`w-2 h-2 rounded-full ${toastMessage.type === 'success' ? 'bg-emerald-500' : toastMessage.type === 'error' ? 'bg-rose-500' : 'bg-brand-fg/40'}`} />
            <p className="text-sm font-medium tracking-tight text-brand-fg truncate">{toastMessage.text}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
