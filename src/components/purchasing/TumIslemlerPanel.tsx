'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
} from 'firebase/firestore';
import type { PurchasingTask, User } from '@/lib/types';
import {
  ArrowLeft,
  Download,
  ChevronLeft,
  ChevronRight,
  Building2,
  Users,
  Clock,
  Search,
  Filter,
  X,
  ChevronDown,
  Paperclip,
  FileText,
  ImageIcon,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// Accent color (neumorphic)
const ACCENT_COLOR = 'var(--dashboard-accent)';

const PAGE_SIZE = 20;

type TaskTypeFilter = 'all' | string;

export default function TumIslemlerPanel() {
  const [tasks, setTasks] = useState<PurchasingTask[]>([]);
  const [personnel, setPersonnel] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter>('all');
  const [personnelFilter, setPersonnelFilter] = useState<string>('all'); // 'all' or uid
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(1);

  // Fetch tasks
  useEffect(() => {
    const q = query(
      collection(db, 'purchasingTasks'),
      orderBy('date', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as PurchasingTask[];
        setTasks(items);
        setLoading(false);
      },
      (err) => {
        console.error('Tasks listen error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Fetch personnel
  useEffect(() => {
    async function fetchPersonnel() {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'users'),
            where('role', 'in', ['admin', 'satin_alma'])
          )
        );
        setPersonnel(
          snap.docs.map((d) => ({ uid: d.id, ...d.data() } as User))
        );
      } catch (err) {
        console.error('Error fetching personnel', err);
      }
    }
    fetchPersonnel();
  }, []);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Task type filter (default to 'custom' for tasks without taskType field)
    if (taskTypeFilter !== 'all') {
      result = result.filter((t) => (t.taskType || 'custom') === taskTypeFilter);
    }

    // Date range filter
    if (startDateFilter) result = result.filter((t) => t.date >= startDateFilter);
    if (endDateFilter) result = result.filter((t) => t.date <= endDateFilter);

    // Personnel filter - check both creator and accompanying/assigned personnel
    if (personnelFilter !== 'all') {
      result = result.filter(
        (t) =>
          t.createdByUid === personnelFilter ||
          (t.accompanyingPersonnel && t.accompanyingPersonnel.some((p) => p.uid === personnelFilter)) ||
          (t.assignedPersonnel && t.assignedPersonnel.some((p) => p.uid === personnelFilter))
      );
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          (t.title || '').toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q) ||
          (t.laboratoryName || '').toLowerCase().includes(q) ||
          (t.createdByName || '').toLowerCase().includes(q) ||
          (t.accompanyingPersonnel || []).some((p) => (p.name || '').toLowerCase().includes(q))
      );
    }

    return result;
  }, [tasks, taskTypeFilter, personnelFilter, searchQuery, startDateFilter, endDateFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const paginatedTasks = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredTasks.slice(start, start + PAGE_SIZE);
  }, [filteredTasks, page]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [taskTypeFilter, personnelFilter, searchQuery, startDateFilter, endDateFilter]);

  // Get unique creators for dropdown
  const uniqueCreators = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((t) => {
      if (t.createdByUid && t.createdByName) {
        map.set(t.createdByUid, t.createdByName);
      }
    });
    return Array.from(map.entries()).map(([uid, name]) => ({ uid, name }));
  }, [tasks]);


  const uniqueTaskTypes = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((t) => {
      const key = t.taskType || 'custom';
      const label = t.taskTypeLabel || (key === 'kurum_ziyareti' ? 'Kurum Ziyareti' : key === 'custom' ? 'Serbest Görev' : key);
      map.set(key, label);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [tasks]);

  // Excel export
  const handleExport = useCallback(() => {
    const rows = filteredTasks.map((t) => ({
      'Görev Başlığı': t.title,
      'Açıklama': t.description || '',
      'Görev Türü': (t.taskType || 'custom') === 'kurum_ziyareti' ? 'Kurum Ziyareti' : 'Serbest Görev',
      'Tarih': t.date,
      'Başlangıç': t.startTime,
      'Bitiş': t.endTime,
      'Laboratuvar': t.laboratoryName || '-',
      'Personel': t.createdByName || '',
      'Eşlik Eden': t.accompanyingPersonnel?.map((p) => p.name).join(', ') || '-',
      'Dosyalar': t.attachments?.map((a) => a.name).join(', ') || '-',
      'Durum': t.completed ? 'Tamamlandı' : 'Devam Ediyor',
    }));

    if (rows.length === 0) return;

    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join('\t'),
      ...rows.map((r) => headers.map((h) => (r as Record<string, string>)[h]).join('\t')),
    ].join('\n');

    // BOM for Excel Turkish character support
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `planlama-birimi-islemler-${format(new Date(), 'yyyy-MM-dd')}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredTasks]);

  const taskTypeLabel = (type: string | undefined, label?: string) =>
    label || (type === 'kurum_ziyareti' ? 'Kurum Ziyareti' : type === 'custom' ? 'Serbest Görev' : type || 'Serbest Görev');

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 md:px-8 md:pt-8 border-b border-border">
        <div className="flex items-center gap-3 mb-4">
          <Link
            href="/satin-alma"
            className="p-2 -ml-2 rounded-xl hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-bold">Tüm İşlemler</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filteredTasks.length} işlem bulundu
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={filteredTasks.length === 0}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all',
              filteredTasks.length > 0
                ? 'bg-secondary border-border text-foreground hover:border-muted-foreground/40'
                : 'bg-secondary border-border text-muted-foreground cursor-not-allowed opacity-50'
            )}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Excel</span>
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-secondary border border-border rounded-xl">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Görev, açıklama veya personel ara..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'shrink-0 p-2.5 rounded-xl border transition-all',
              showFilters
                ? cn('border-[#d4ec00]/40 bg-[#d4ec00]/10', ACCENT)
                : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-3 flex flex-col sm:flex-row gap-2 animate-in slide-in-from-top-1 duration-200">
            {/* Task type filter */}
            <select
              value={taskTypeFilter}
              onChange={(e) => setTaskTypeFilter(e.target.value)}
              className="flex-1 sm:max-w-[220px] py-2 px-3 bg-secondary border border-border rounded-lg text-xs text-foreground outline-none focus:ring-2 focus:ring-[#d4ec00]/40"
            >
              <option value="all">Tüm Türler</option>
              {uniqueTaskTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>

            {/* Personnel filter */}
            <select
              value={personnelFilter}
              onChange={(e) => setPersonnelFilter(e.target.value)}
              className="flex-1 sm:max-w-[220px] py-2 px-3 bg-secondary border border-border rounded-lg text-xs text-foreground outline-none focus:ring-2 focus:ring-[#d4ec00]/40"
            >
              <option value="all">Tüm Personel</option>
              {uniqueCreators.map((c) => (
                <option key={c.uid} value={c.uid}>
                  {c.name}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={startDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
              className="flex-1 sm:max-w-[170px] py-2 px-3 bg-secondary border border-border rounded-lg text-xs text-foreground outline-none focus:ring-2 focus:ring-[#d4ec00]/40"
              placeholder="Başlangıç"
            />
            <input
              type="date"
              value={endDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
              className="flex-1 sm:max-w-[170px] py-2 px-3 bg-secondary border border-border rounded-lg text-xs text-foreground outline-none focus:ring-2 focus:ring-[#d4ec00]/40"
              placeholder="Bitiş"
            />
          </div>
        )}
      </div>

      {/* Table / Card List */}
      <div className="px-4 md:px-8 mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
            Yükleniyor...
          </div>
        ) : paginatedTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Search className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">İşlem bulunamadı</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Görev</th>
                    <th className="pb-3 pr-4 font-medium">Tür</th>
                    <th className="pb-3 pr-4 font-medium">Tarih</th>
                    <th className="pb-3 pr-4 font-medium">Saat</th>
                    <th className="pb-3 pr-4 font-medium">Laboratuvar</th>
                    <th className="pb-3 pr-4 font-medium">Personel</th>
                    <th className="pb-3 pr-4 font-medium">Dosyalar</th>
                    <th className="pb-3 font-medium">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedTasks.map((task) => (
                    <tr
                      key={task.id}
                      className="border-b border-border/50 hover:bg-accent/30 transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <div>
                          <p className={cn('font-medium', task.completed && 'line-through text-muted-foreground')}>
                            {task.title}
                          </p>
                          {task.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={cn(
                            'inline-block text-[10px] px-2 py-0.5 rounded-full font-medium',
                            (task.taskType || 'custom') === 'kurum_ziyareti'
                              ? 'bg-[#d4ec00]/10 text-[#7a8a00] dark:text-[#d4ec00]'
                              : 'bg-secondary text-muted-foreground'
                          )}
                        >
                          {taskTypeLabel(task.taskType || 'custom', task.taskTypeLabel)}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                        {format(parseISO(task.date), 'd MMM yyyy', { locale: tr })}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                        {task.startTime} - {task.endTime}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {task.laboratoryName || '-'}
                      </td>
                      <td className="py-3 pr-4">
                        <div>
                          <p className="text-foreground">{task.createdByName}</p>
                          {task.accompanyingPersonnel && task.accompanyingPersonnel.length > 0 && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              +{task.accompanyingPersonnel.map((p) => p.name).join(', ')}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        {task.attachments && task.attachments.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {task.attachments.map((att, idx) => (
                              <a
                                key={idx}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                  'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all hover:brightness-110',
                                  att.type === 'image'
                                    ? 'bg-blue-500/10 text-blue-500'
                                    : 'bg-red-500/10 text-red-500'
                                )}
                                title={att.name}
                              >
                                {att.type === 'image' ? (
                                  <ImageIcon className="w-2.5 h-2.5" />
                                ) : (
                                  <FileText className="w-2.5 h-2.5" />
                                )}
                                <span className="truncate max-w-[60px]">{att.name}</span>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3">
                        <span
                          className={cn(
                            'inline-block text-[10px] px-2 py-0.5 rounded-full font-medium',
                            task.completed
                              ? 'bg-emerald-500/10 text-emerald-500'
                              : 'bg-yellow-500/10 text-yellow-500'
                          )}
                        >
                          {task.completed ? 'Tamamlandı' : 'Devam'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {paginatedTasks.map((task) => (
                <div
                  key={task.id}
                  className="p-3.5 bg-card border border-border rounded-xl"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm font-medium', task.completed && 'line-through text-muted-foreground')}>
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                        (task.taskType || 'custom') === 'kurum_ziyareti'
                          ? 'bg-[#d4ec00]/10 text-[#7a8a00] dark:text-[#d4ec00]'
                          : 'bg-secondary text-muted-foreground'
                      )}
                    >
                      {(task.taskType || 'custom') === 'kurum_ziyareti' ? 'Ziyaret' : 'Serbest'}
                    </span>
                  </div>

                  {task.laboratoryName && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <Building2 className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{task.laboratoryName}</span>
                    </div>
                  )}

                  <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                    <span>{format(parseISO(task.date), 'd MMM yyyy', { locale: tr })}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {task.startTime} - {task.endTime}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {task.createdByName}
                    </span>
                  </div>

                  {task.accompanyingPersonnel && task.accompanyingPersonnel.length > 0 && (
                    <div className="mt-1.5 text-[10px] text-muted-foreground">
                      Eşlik: {task.accompanyingPersonnel.map((p) => p.name).join(', ')}
                    </div>
                  )}

                  {/* Attachments */}
                  {task.attachments && task.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {task.attachments.map((att, idx) => (
                        <a
                          key={idx}
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all hover:brightness-110',
                            att.type === 'image'
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-red-500/10 text-red-500'
                          )}
                        >
                          {att.type === 'image' ? (
                            <ImageIcon className="w-2.5 h-2.5" />
                          ) : (
                            <FileText className="w-2.5 h-2.5" />
                          )}
                          <span className="truncate max-w-[80px]">{att.name}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="mt-2">
                    <span
                      className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full font-medium',
                        task.completed
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : 'bg-yellow-500/10 text-yellow-500'
                      )}
                    >
                      {task.completed ? 'Tamamlandı' : 'Devam Ediyor'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 md:px-8 mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className={cn(
              'p-2 rounded-lg border transition-all',
              page === 1
                ? 'border-border text-muted-foreground/40 cursor-not-allowed'
                : 'border-border text-foreground hover:bg-accent'
            )}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<(number | string)[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((item, i) =>
                typeof item === 'string' ? (
                  <span key={`dots-${i}`} className="px-1 text-muted-foreground text-xs">...</span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setPage(item)}
                    className={cn(
                      'w-8 h-8 rounded-lg text-xs font-medium transition-all',
                      page === item
                        ? `${ACCENT_BG} text-zinc-900`
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    {item}
                  </button>
                )
              )}
          </div>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className={cn(
              'p-2 rounded-lg border transition-all',
              page === totalPages
                ? 'border-border text-muted-foreground/40 cursor-not-allowed'
                : 'border-border text-foreground hover:bg-accent'
            )}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
