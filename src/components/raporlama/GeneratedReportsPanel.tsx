'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query as firestoreQuery, where } from 'firebase/firestore';
import { Download, ExternalLink, FileText, Inbox, Mail, MessageCircle, Monitor, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';

type TimestampLike = { toDate?: () => Date; seconds?: number } | Date | string | number | null | undefined;

type GeneratedFile = {
  name?: string;
  url?: string;
  path?: string;
  storagePath?: string;
  contentType?: string;
  sizeBytes?: number;
};

type DeliveryAttempt = {
  channel?: string;
  status?: string;
  message?: string;
  recipients?: unknown[];
  attachmentNames?: string[];
};

type ShortcutRun = {
  id: string;
  shortcutId?: string | null;
  actionKey?: string | null;
  panelKey?: string | null;
  trigger?: string | null;
  status?: string | null;
  createdAt?: TimestampLike;
  startedAt?: TimestampLike;
  completedAt?: TimestampLike;
  createdByUid?: string | null;
  createdByName?: string | null;
  message?: string | null;
  result?: {
    deliverySummary?: string;
    generatedAttachments?: GeneratedFile[];
    attachments?: GeneratedFile[];
    deliveryAttempts?: DeliveryAttempt[];
    summaryText?: string;
  } | null;
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
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(value?: number) {
  if (!value || !Number.isFinite(value)) return '';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function filesForRun(run: ShortcutRun): GeneratedFile[] {
  const files = [...(run.result?.generatedAttachments || []), ...(run.result?.attachments || [])];
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = file.url || file.path || file.storagePath || file.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function channelsForRun(run: ShortcutRun): string[] {
  const channels = new Set<string>();
  (run.result?.deliveryAttempts || []).forEach((attempt) => {
    if (attempt.channel) channels.add(attempt.channel);
  });
  return Array.from(channels);
}

function channelIcon(channel: string) {
  if (channel === 'email') return <Mail className="h-3.5 w-3.5" />;
  if (channel === 'whatsapp') return <MessageCircle className="h-3.5 w-3.5" />;
  return <Monitor className="h-3.5 w-3.5" />;
}

function channelLabel(channel: string) {
  if (channel === 'inApp') return 'Uygulama içi';
  if (channel === 'email') return 'E-posta';
  if (channel === 'whatsapp') return 'WhatsApp';
  if (channel === 'pdf') return 'PDF';
  if (channel === 'excel') return 'Excel';
  return channel;
}

export function GeneratedReportsPanel({ focusRunId }: { focusRunId?: string }) {
  const router = useRouter();
  const { currentUser } = useAuth();
  const [runs, setRuns] = useState<ShortcutRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(focusRunId || null);

  useEffect(() => {
    setSelectedRunId(focusRunId || null);
  }, [focusRunId]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const runsQuery = firestoreQuery(
      collection(db, 'shortcutRuns'),
      where('createdByUid', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(runsQuery, (snapshot) => {
      setRuns(snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<ShortcutRun, 'id'>) })));
      setLoading(false);
    }, () => setLoading(false));
  }, [currentUser?.uid]);

  const reportRuns = useMemo(() => runs.filter((run) => filesForRun(run).length > 0), [runs]);
  const selectedRun = reportRuns.find((run) => run.id === selectedRunId) || reportRuns[0] || null;
  const selectedFiles = selectedRun ? filesForRun(selectedRun) : [];

  useEffect(() => {
    if (!selectedRun || selectedRun.id === selectedRunId) return;
    setSelectedRunId(selectedRun.id);
  }, [selectedRun, selectedRunId]);

  const selectRun = (run: ShortcutRun) => {
    setSelectedRunId(run.id);
    router.replace(`/raporlama/olusturulan-raporlar?runId=${run.id}`, { scroll: false });
  };

  return (
    <div className="dashboard-neu-page min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--dashboard-text)' }}>
            Oluşturulan raporlar
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--dashboard-muted)' }}>
            Kestirmelerden üretilen ve kanal fark etmeksizin teslim edilen PDF/Excel raporlarınız.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => router.push('/raporlama')}>
          Raporlama paneline dön
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="glass-card overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-orange-500" /> Rapor geçmişi
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" /> Yükleniyor…
              </div>
            ) : reportRuns.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8 opacity-40" /> Henüz oluşturulmuş rapor bulunmuyor.
              </div>
            ) : (
              <div className="max-h-[70vh] divide-y overflow-auto">
                {reportRuns.map((run) => {
                  const files = filesForRun(run);
                  const active = selectedRun?.id === run.id;
                  const channels = channelsForRun(run);
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => selectRun(run)}
                      className={cn('block w-full px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.05]', active && 'bg-orange-500/10')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{run.actionKey || 'Kestirme raporu'}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{formatDate(run.completedAt || run.createdAt)}</div>
                        </div>
                        <Badge variant={run.status === 'success' ? 'default' : 'secondary'}>{run.status || 'unknown'}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {channels.map((channel) => (
                          <span key={channel} className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-white/10">
                            {channelIcon(channel)} {channelLabel(channel)}
                          </span>
                        ))}
                        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-white/10">{files.length} dosya</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card min-h-[420px]">
          <CardHeader>
            <CardTitle className="text-base">Seçili rapor</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedRun ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <Inbox className="h-10 w-10 opacity-40" /> Bir rapor seçin.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-2xl border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-foreground">{selectedRun.actionKey || 'Kestirme raporu'}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{selectedRun.result?.deliverySummary || selectedRun.message || selectedRun.result?.summaryText || 'Rapor oluşturuldu.'}</p>
                    </div>
                    <Badge variant={selectedRun.status === 'success' ? 'default' : 'secondary'}>{selectedRun.status || 'unknown'}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>Run ID: <span className="font-mono">{selectedRun.id}</span></div>
                    <div>Tarih: {formatDate(selectedRun.completedAt || selectedRun.createdAt)}</div>
                    <div>Panel: {selectedRun.panelKey || '—'}</div>
                    <div>Tetikleyici: {selectedRun.trigger || '—'}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-foreground">Dosyalar</h3>
                  <div className="grid gap-2">
                    {selectedFiles.map((file) => {
                      const url = file.url;
                      return (
                        <div key={file.url || file.path || file.storagePath || file.name} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">{file.name || file.path || file.storagePath || 'Rapor dosyası'}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{file.contentType || 'dosya'} {formatBytes(file.sizeBytes)}</div>
                          </div>
                          {url ? (
                            <div className="flex gap-2">
                              <Button asChild size="sm" variant="outline">
                                <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" /> Aç</a>
                              </Button>
                              <Button asChild size="sm">
                                <a href={url} download><Download className="mr-1 h-4 w-4" /> İndir</a>
                              </Button>
                            </div>
                          ) : (
                            <Badge variant="secondary">Storage: {file.path || file.storagePath || '—'}</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-foreground">Teslimat kanalları</h3>
                  <div className="grid gap-2">
                    {(selectedRun.result?.deliveryAttempts || []).map((attempt, index) => (
                      <div key={`${attempt.channel}-${index}`} className="rounded-xl border border-black/10 p-3 text-sm dark:border-white/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 font-semibold">{channelIcon(attempt.channel || '')} {channelLabel(attempt.channel || 'unknown')}</span>
                          <Badge variant={attempt.status === 'sent' ? 'default' : 'secondary'}>{attempt.status || 'unknown'}</Badge>
                        </div>
                        {attempt.message && <p className="mt-1 text-xs text-muted-foreground">{attempt.message}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default GeneratedReportsPanel;
