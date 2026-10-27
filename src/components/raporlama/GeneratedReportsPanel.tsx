'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query as firestoreQuery, where } from '../../lib/data/client';
import {
  Download, ExternalLink, FileText, Inbox, Mail, MessageCircle,
  Monitor, RefreshCw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { db } from '../../lib/data/client';
import {
  C, AC, ClayPage, useMode, Card, RaporHead, SoftBtn, Pill, EmptyBlock,
} from '@/components/raporlama/rapor-kit';

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

// ── types ─────────────────────────────────────────────────────────────────────
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

// ── helpers ───────────────────────────────────────────────────────────────────
function toDate(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof (value as any).toDate === 'function') return (value as any).toDate();
  if (typeof (value as any).seconds === 'number') return new Date((value as any).seconds * 1000);
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
  if (channel === 'email') return <Mail size={14} />;
  if (channel === 'whatsapp') return <MessageCircle size={14} />;
  return <Monitor size={14} />;
}

function channelLabel(channel: string) {
  if (channel === 'inApp') return 'Uygulama içi';
  if (channel === 'email') return 'E-posta';
  if (channel === 'whatsapp') return 'WhatsApp';
  if (channel === 'pdf') return 'PDF';
  if (channel === 'excel') return 'Excel';
  return channel;
}

// ── status pill ───────────────────────────────────────────────────────────────
function StatusPill({ status }: { status?: string | null }) {
  const ok = status === 'success';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '4px 11px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
      background: ok ? 'rgba(78,158,107,0.16)' : 'rgba(90,72,40,0.10)',
      color: ok ? C.waterDeep : C.ink2,
    }}>
      {status || 'bekliyor'}
    </span>
  );
}

// ── channel tag ───────────────────────────────────────────────────────────────
function ChannelTag({ channel }: { channel: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
      background: C.surface2, boxShadow: C.clayInset, fontSize: 11.5, fontWeight: 600, color: C.ink2,
    }}>
      {channelIcon(channel)} {channelLabel(channel)}
    </span>
  );
}

// ── run list item ──────────────────────────────────────────────────────────────
function RunItem({ run, active, onClick }: { run: ShortcutRun; active: boolean; onClick: () => void }) {
  const [p, setP] = useState(false);
  const files = filesForRun(run);
  const channels = channelsForRun(run);
  return (
    <button
      type="button" onClick={onClick}
      onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8,
        padding: '14px 16px', borderRadius: C.radius,
        background: active ? `${AC.primary}12` : C.surfaceHi,
        boxShadow: active ? `inset 0 0 0 1.5px ${AC.primary}30, ${C.clayFlat}` : p ? C.clayPress : C.clayFlat,
        transition: `box-shadow 200ms ${EASE}, transform 200ms ${EASE}`,
        transform: p && !active ? 'translateY(1px) scale(0.99)' : 'none',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {run.actionKey || 'Kestirme raporu'}
          </div>
          <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 600, color: C.ink2 }}>
            {formatDate(run.completedAt || run.createdAt)}
          </div>
        </div>
        <StatusPill status={run.status} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {channels.map((ch) => <ChannelTag key={ch} channel={ch} />)}
        <span style={{
          display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 999,
          background: C.surface2, boxShadow: C.clayInset, fontSize: 11.5, fontWeight: 600, color: C.ink2,
        }}>
          {files.length} dosya
        </span>
      </div>
    </button>
  );
}

// ── detail meta row ───────────────────────────────────────────────────────────
function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase', minWidth: 90 }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink1, flex: 1, minWidth: 0, fontFamily: typeof value === 'string' && value.length > 20 ? 'ui-monospace, monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

// ── section header ────────────────────────────────────────────────────────────
function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 10 }}>{children}</div>
  );
}

// ── file card ──────────────────────────────────────────────────────────────────
function FileCard({ file }: { file: GeneratedFile }) {
  const url = file.url;
  const name = file.name || file.path || file.storagePath || 'Rapor dosyası';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between',
      padding: '13px 16px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 600, color: C.ink2 }}>
          {file.contentType || 'dosya'}{file.sizeBytes ? ` · ${formatBytes(file.sizeBytes)}` : ''}
        </div>
      </div>
      {url ? (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <SoftBtn><ExternalLink size={15} /> Aç</SoftBtn>
          </a>
          <a href={url} download style={{ textDecoration: 'none' }}>
            <SoftBtn tone={C.waterDeep}><Download size={15} /> İndir</SoftBtn>
          </a>
        </div>
      ) : (
        <span style={{
          padding: '5px 12px', borderRadius: 999, background: C.surface2, boxShadow: C.clayInset,
          fontSize: 12, fontWeight: 600, color: C.ink3, fontFamily: 'ui-monospace, monospace',
        }}>
          {file.path || file.storagePath || '—'}
        </span>
      )}
    </div>
  );
}

// ── delivery attempt card ──────────────────────────────────────────────────────
function AttemptCard({ attempt, index }: { attempt: DeliveryAttempt; index: number }) {
  return (
    <div style={{ padding: '13px 16px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700, color: C.ink1 }}>
          {channelIcon(attempt.channel || '')} {channelLabel(attempt.channel || 'unknown')}
        </span>
        <StatusPill status={attempt.status} />
      </div>
      {attempt.message && (
        <div style={{ fontSize: 12.5, fontWeight: 500, color: C.ink2, lineHeight: 1.45 }}>{attempt.message}</div>
      )}
    </div>
  );
}

// ── main panel ─────────────────────────────────────────────────────────────────
export function GeneratedReportsPanel({ focusRunId }: { focusRunId?: string }) {
  const router = useRouter();
  const { currentUser } = useAuth();
  const mode = useMode();
  const mobile = mode === 'mobile';

  const [runs, setRuns] = useState<ShortcutRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(focusRunId || null);

  useEffect(() => { setSelectedRunId(focusRunId || null); }, [focusRunId]);

  useEffect(() => {
    if (!currentUser?.uid) { setRuns([]); setLoading(false); return; }
    setLoading(true);
    const q = firestoreQuery(
      collection(db, 'shortcutRuns'),
      where('createdByUid', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(q, (snapshot) => {
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

  // ── list pane ───────────────────────────────────────────────────────────────
  const listPane = (
    <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px', borderBottom: `1px solid ${C.line}` }}>
        <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 11, display: 'grid', placeItems: 'center', color: AC.primary, background: 'radial-gradient(120% 120% at 30% 24%, #FFFFFF, #ECE4D4 82%)', boxShadow: C.clayFlat }}>
          <FileText size={18} />
        </span>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.ink1 }}>Rapor Geçmişi</span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 20px', fontSize: 14, fontWeight: 700, color: C.ink2 }}>
          <RefreshCw size={17} style={{ animation: 'cySpin 1s linear infinite', color: AC.primary }} /> Yükleniyor…
        </div>
      ) : reportRuns.length === 0 ? (
        <EmptyBlock icon={<Inbox size={26} />} text="Henüz oluşturulmuş rapor bulunmuyor." />
      ) : (
        <div style={{ overflowY: 'auto', maxHeight: mobile ? 320 : 'calc(100vh - 260px)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {reportRuns.map((run, i) => (
            <div key={run.id} style={{ animation: `cyRise 360ms ${EASE} ${i * 30}ms both` }}>
              <RunItem run={run} active={selectedRun?.id === run.id} onClick={() => selectRun(run)} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  // ── detail pane ─────────────────────────────────────────────────────────────
  const detailPane = (
    <Card style={{ flex: 1, minWidth: 0 }}>
      {!selectedRun ? (
        <div style={{ minHeight: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyBlock icon={<Inbox size={28} />} text="Bir rapor seçin." sub="Sol listeden bir raporu tıklayarak detaylarını görün." />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Run summary */}
          <div style={{ padding: '16px 20px', borderRadius: C.radius, background: C.surface2, boxShadow: C.clayInset }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, color: C.ink1 }}>{selectedRun.actionKey || 'Kestirme raporu'}</div>
                <div style={{ marginTop: 5, fontSize: 13.5, fontWeight: 500, color: C.ink2, lineHeight: 1.5 }}>
                  {selectedRun.result?.deliverySummary || selectedRun.message || selectedRun.result?.summaryText || 'Rapor oluşturuldu.'}
                </div>
              </div>
              <StatusPill status={selectedRun.status} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 8 }}>
              <MetaRow label="Run ID" value={selectedRun.id} />
              <MetaRow label="Tarih" value={formatDate(selectedRun.completedAt || selectedRun.createdAt)} />
              <MetaRow label="Panel" value={selectedRun.panelKey || '—'} />
              <MetaRow label="Tetikleyici" value={selectedRun.trigger || '—'} />
            </div>
          </div>

          {/* Files */}
          {selectedFiles.length > 0 && (
            <div>
              <SectionHead>Dosyalar ({selectedFiles.length})</SectionHead>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {selectedFiles.map((file) => (
                  <FileCard key={file.url || file.path || file.storagePath || file.name} file={file} />
                ))}
              </div>
            </div>
          )}

          {/* Delivery attempts */}
          {(selectedRun.result?.deliveryAttempts || []).length > 0 && (
            <div>
              <SectionHead>Teslimat Kanalları</SectionHead>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {(selectedRun.result?.deliveryAttempts || []).map((attempt, i) => (
                  <AttemptCard key={`${attempt.channel}-${i}`} attempt={attempt} index={i} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );

  return (
    <ClayPage>
      <div style={{ animation: `cyRise 360ms ${EASE} both` }}>
        <RaporHead
          icon={FileText}
          title="Oluşturulan Raporlar"
          desc="Kestirmelerden üretilen PDF/Excel raporları ve teslimat durumları."
          onBack={() => router.push('/raporlama')}
          mobile={mobile}
        />

        {mobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {listPane}
            {detailPane}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, alignItems: 'start' }}>
            {listPane}
            {detailPane}
          </div>
        )}
      </div>
    </ClayPage>
  );
}

export default GeneratedReportsPanel;
