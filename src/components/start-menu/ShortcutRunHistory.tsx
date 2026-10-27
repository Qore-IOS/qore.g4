'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, addDoc, limit, onSnapshot, orderBy, query as firestoreQuery, serverTimestamp, where } from '../../lib/data/client';
import { AlertCircle, FileText, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { db } from '../../lib/data/client';
import { cn } from '@/lib/utils';

type TimestampLike = { toDate?: () => Date; seconds?: number } | Date | string | number | null | undefined;
type ShortcutRunStatus = 'success' | 'failed' | 'skipped' | 'partial' | 'processing' | 'queued' | string;

type ShortcutRun = {
  id: string;
  shortcutId?: string | null;
  actionKey?: string | null;
  panelKey?: string | null;
  status?: ShortcutRunStatus | null;
  createdAt?: TimestampLike;
  startedAt?: TimestampLike;
  completedAt?: TimestampLike;
  message?: string | null;
  error?: string | null;
  result?: {
    generatedAttachments?: GeneratedFile[];
    attachments?: GeneratedFile[];
    deliveryAttempts?: DeliveryAttempt[];
    deliverySummary?: string;
  } | null;
};

type ShortcutLog = {
  id: string;
  runId?: string | null;
  level?: string | null;
  message?: string | null;
  meta?: {
    channel?: string;
    recipients?: unknown[];
    attachmentNames?: string[];
    status?: string;
    message?: string;
  } | null;
  createdAt?: TimestampLike;
};

type SavedShortcut = {
  id: string;
  title?: string | null;
  actionLabel?: string | null;
  panelLabel?: string | null;
  deliveryChannels?: string[] | string | null;
  recipients?: unknown[] | string | null;
};

type DeliveryAttempt = {
  channel?: string;
  status?: string;
  message?: string;
  recipients?: unknown[];
  attachmentNames?: string[];
};

type GeneratedFile = {
  name?: string;
  url?: string;
  path?: string;
  storagePath?: string;
  sizeBytes?: number;
};

const statusClass: Record<string, string> = {
  success: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300',
  failed: 'bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-300',
  skipped: 'bg-zinc-500/10 text-zinc-700 border-zinc-500/20 dark:text-zinc-300',
  partial: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300',
  processing: 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300',
  queued: 'bg-purple-500/10 text-purple-700 border-purple-500/20 dark:text-purple-300',
};

function toDate(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
}

function formatDate(value: TimestampLike) {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function countRecipients(attempts: DeliveryAttempt[], fallback?: SavedShortcut) {
  const total = attempts.reduce((sum, attempt) => sum + (Array.isArray(attempt.recipients) ? attempt.recipients.length : 0), 0);
  if (total > 0) return total;
  if (Array.isArray(fallback?.recipients)) return fallback.recipients.length;
  if (typeof fallback?.recipients === 'string' && fallback.recipients.trim()) return fallback.recipients.split(/[;,\n]/).filter(Boolean).length;
  return 0;
}

function normalizeChannels(run: ShortcutRun, shortcut?: SavedShortcut, logs: ShortcutLog[] = []) {
  const attempts = run.result?.deliveryAttempts || [];
  const channels = new Set<string>();
  attempts.forEach((attempt) => attempt.channel && channels.add(attempt.channel));
  logs.forEach((log) => log.meta?.channel && channels.add(log.meta.channel));
  const shortcutChannels = shortcut?.deliveryChannels;
  if (Array.isArray(shortcutChannels)) shortcutChannels.forEach((channel) => channels.add(channel));
  else if (typeof shortcutChannels === 'string') channels.add(shortcutChannels);
  return Array.from(channels);
}

function filesForRun(run: ShortcutRun, logs: ShortcutLog[]) {
  const byResult = [...(run.result?.generatedAttachments || []), ...(run.result?.attachments || [])];
  const byAttempts = (run.result?.deliveryAttempts || []).flatMap((attempt) => attempt.attachmentNames || []).map((name) => ({ name }));
  const byLogs = logs.flatMap((log) => log.meta?.attachmentNames || []).map((name) => ({ name }));
  const seen = new Set<string>();
  return [...byResult, ...byAttempts, ...byLogs].filter((file) => {
    const key = file.url || file.path || file.storagePath || file.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ShortcutRunHistory({ compact = false }: { compact?: boolean }) {
  const { currentUser, currentCompanyId } = useAuth();
  const [runs, setRuns] = useState<ShortcutRun[]>([]);
  const [logs, setLogs] = useState<ShortcutLog[]>([]);
  const [shortcuts, setShortcuts] = useState<SavedShortcut[]>([]);
  const [isRequesting, setIsRequesting] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser?.uid) {
      setRuns([]);
      return;
    }
    const runsQuery = firestoreQuery(collection(db, 'shortcutRuns'), where('createdByUid', '==', currentUser.uid), orderBy('createdAt', 'desc'), limit(compact ? 5 : 30));
    return onSnapshot(runsQuery, (snapshot) => setRuns(snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<ShortcutRun, 'id'>) }))));
  }, [compact, currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setShortcuts([]);
      return;
    }
    const shortcutsQuery = firestoreQuery(collection(db, 'shortcuts'), where('createdByUid', '==', currentUser.uid), orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(shortcutsQuery, (snapshot) => setShortcuts(snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<SavedShortcut, 'id'>) }))));
  }, [currentUser?.uid]);

  useEffect(() => {
    const runIds = runs.map((run) => run.id);
    if (!runIds.length) {
      setLogs([]);
      return;
    }
    const unsubscribers = runIds.map((runId) => {
      const logsQuery = firestoreQuery(collection(db, 'shortcutRunLogs'), where('runId', '==', runId), orderBy('createdAt', 'desc'), limit(8));
      return onSnapshot(logsQuery, (snapshot) => {
        setLogs((prev) => {
          const rest = prev.filter((log) => log.runId !== runId);
          return [...rest, ...snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<ShortcutLog, 'id'>) }))];
        });
      });
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [runs]);

  const shortcutById = useMemo(() => new Map(shortcuts.map((shortcut) => [shortcut.id, shortcut])), [shortcuts]);
  const logsByRunId = useMemo(() => {
    const map = new Map<string, ShortcutLog[]>();
    logs.forEach((log) => {
      if (!log.runId) return;
      map.set(log.runId, [...(map.get(log.runId) || []), log]);
    });
    return map;
  }, [logs]);

  const rerun = async (run: ShortcutRun) => {
    if (!currentUser?.uid || !run.shortcutId) return;
    setIsRequesting(run.id);
    try {
      await addDoc(collection(db, 'shortcutRunRequests'), {
        shortcutId: run.shortcutId,
        requestedByUid: currentUser.uid,
        companyId: currentCompanyId || null,
        status: 'queued',
        createdAt: serverTimestamp(),
      });
      toast.success('Kestirme tekrar çalıştırma isteği oluşturuldu.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tekrar çalıştırma isteği oluşturulamadı.');
    } finally {
      setIsRequesting(null);
    }
  };

  return (
    <Card className={cn('border border-border/60 bg-background/80', compact && 'shadow-none')}>
      <CardHeader className={compact ? 'p-3' : undefined}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className={compact ? 'text-base' : undefined}>Kestirme çalışma geçmişi</CardTitle>
            <CardDescription>shortcutRuns ve shortcutRunLogs koleksiyonlarından son çalışma kayıtları.</CardDescription>
          </div>
          <RefreshCw className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className={compact ? 'p-3 pt-0' : undefined}>
        <div className="overflow-x-auto">
          <Table primaryCols={[0, 1]}>
            <TableHeader>
              <TableRow>
                <TableHead>Kestirme</TableHead>
                <TableHead>Son çalışma</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Kanal</TableHead>
                <TableHead>Alıcı</TableHead>
                <TableHead>Dosyalar</TableHead>
                <TableHead>Hata</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const shortcut = run.shortcutId ? shortcutById.get(run.shortcutId) : undefined;
                const runLogs = logsByRunId.get(run.id) || [];
                const attempts = run.result?.deliveryAttempts || [];
                const files = filesForRun(run, runLogs);
                const channels = normalizeChannels(run, shortcut, runLogs);
                const errorLog = runLogs.find((log) => log.level === 'error');
                const status = run.status || 'skipped';
                return (
                  <TableRow key={run.id}>
                    <TableCell className="min-w-[180px] font-medium">
                      <div>{shortcut?.title || shortcut?.actionLabel || run.actionKey || 'Kestirme'}</div>
                      <div className="text-xs text-muted-foreground">{shortcut?.panelLabel || run.panelKey || run.shortcutId}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(run.completedAt || run.startedAt || run.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('capitalize', statusClass[status] || statusClass.skipped)}>{status}</Badge>
                    </TableCell>
                    <TableCell>{channels.length ? channels.join(', ') : '—'}</TableCell>
                    <TableCell>{countRecipients(attempts, shortcut)}</TableCell>
                    <TableCell className="min-w-[160px]">
                      {files.length ? (
                        <div className="flex flex-col gap-1">
                          {files.slice(0, 3).map((file) => file.url ? (
                            <a key={file.url} href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline dark:text-orange-400">
                              <FileText className="h-3 w-3" /> {file.name || file.path || 'Dosya'}
                            </a>
                          ) : (
                            <span key={file.name || file.path || file.storagePath} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><FileText className="h-3 w-3" /> {file.name || file.path || file.storagePath}</span>
                          ))}
                          {files.length > 3 && <span className="text-xs text-muted-foreground">+{files.length - 3} dosya</span>}
                        </div>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      {run.error || errorLog?.message ? (
                        <span className="inline-flex items-start gap-1 text-xs text-red-600 dark:text-red-300"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> <span className="line-clamp-2">{run.error || errorLog?.message}</span></span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => rerun(run)} disabled={!run.shortcutId || isRequesting === run.id}>
                        <Play className="mr-1 h-3.5 w-3.5" /> Tekrar çalıştır
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Henüz kestirme çalışma kaydı yok.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default ShortcutRunHistory;
