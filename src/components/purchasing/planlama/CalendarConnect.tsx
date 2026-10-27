'use client';

import React from 'react';
import { CalendarClock, Check, X, Loader2, Plug, Unplug, ChevronDown } from 'lucide-react';
import { getAuth } from '../../../lib/workspace';
import type { Accent } from './pl-primitives';

type Provider = 'google' | 'microsoft';

interface ProviderState {
  connected: boolean;
  email: string | null;
}

interface StatusResponse {
  ok: boolean;
  configured: Record<Provider, boolean>;
  connections: Record<Provider, ProviderState>;
}

/* Marka rozetleri (harici görsel yüklemeden, inline SVG) */
const GoogleMark = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7C43.8 37.5 46.5 31.5 46.5 24.5z" />
    <path fill="#FBBC05" d="M10.4 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.7 2.2-8.5 2.2-6.4 0-11.7-3.7-13.6-9.9l-7.9 6.1C6.4 42.6 14.6 48 24 48z" />
  </svg>
);
const MicrosoftMark = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
    <path fill="#F25022" d="M1 1h10v10H1z" />
    <path fill="#7FBA00" d="M13 1h10v10H13z" />
    <path fill="#00A4EF" d="M1 13h10v10H1z" />
    <path fill="#FFB900" d="M13 13h10v10H13z" />
  </svg>
);

const LABELS: Record<Provider, string> = { google: 'Google Takvim', microsoft: 'Outlook Takvim' };

async function idToken(): Promise<string | null> {
  try {
    return (await getAuth().currentUser?.getIdToken()) || null;
  } catch {
    return null;
  }
}

interface Props {
  ac: Accent;
  compact?: boolean;
  /** OAuth dönüşü sonrası yeniden okuma tetiklemek için (query param değişimi). */
  refreshSignal?: number;
  onConnectedChange?: (anyConnected: boolean) => void;
}

const CalendarConnect: React.FC<Props> = ({ ac, compact, refreshSignal, onConnectedChange }) => {
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<StatusResponse | null>(null);
  const [busy, setBusy] = React.useState<Provider | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    const token = await idToken();
    if (!token) return;
    try {
      const res = await fetch('/api/calendar/status', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data: StatusResponse = await res.json();
      setStatus(data);
      onConnectedChange?.(data.connections.google.connected || data.connections.microsoft.connected);
    } catch {
      /* sessiz geç */
    }
  }, [onConnectedChange]);

  React.useEffect(() => { load(); }, [load, refreshSignal]);

  // dış tıklamada kapat
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const connect = async (provider: Provider) => {
    const token = await idToken();
    if (!token) return;
    window.location.href = `/api/calendar/${provider}/connect?token=${encodeURIComponent(token)}`;
  };

  const disconnect = async (provider: Provider) => {
    const token = await idToken();
    if (!token) return;
    setBusy(provider);
    try {
      await fetch('/api/calendar/status', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const anyConnected =
    !!status && (status.connections.google.connected || status.connections.microsoft.connected);

  const triggerStyle: React.CSSProperties = {
    all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
    height: 46, padding: compact ? '0 12px' : '0 16px', borderRadius: 'var(--radius-sm)',
    boxSizing: 'border-box', color: 'var(--ink-2)', background: 'var(--surface-hi)',
    boxShadow: 'var(--clay)', fontSize: 13.5, fontWeight: 700, transition: 'all 200ms var(--ease-fluid)',
  };

  const providers: Provider[] = ['google', 'microsoft'];

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((v) => !v)} style={triggerStyle} aria-label="Takvim bağlantısı" aria-expanded={open}>
        <CalendarClock size={18} />
        {!compact && <span>Takvim</span>}
        {anyConnected && (
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--water-solid)', boxShadow: '0 0 0 3px rgba(111,181,133,0.25)' }} />
        )}
        {!compact && <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms var(--ease-fluid)', color: 'var(--ink-3)' }} />}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 900, width: 296,
            padding: 14, borderRadius: 'var(--radius)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface))',
            boxShadow: 'var(--clay), 0 24px 44px -20px rgba(90,72,40,0.4)', animation: 'plPopIn 200ms var(--ease-fluid)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 12, padding: '0 2px' }}>
            Takvim Entegrasyonu
          </div>

          {providers.map((p) => {
            const configured = status?.configured?.[p] ?? true;
            const conn = status?.connections?.[p];
            const connected = !!conn?.connected;
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', marginBottom: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--surface-hi)', boxShadow: 'var(--clay-flat)', flexShrink: 0 }}>
                  {p === 'google' ? <GoogleMark s={18} /> : <MicrosoftMark s={16} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink-1)' }}>{LABELS[p]}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: connected ? 'var(--water-deep)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {!configured ? 'Yapılandırılmadı' : connected ? (conn?.email || 'Bağlı') : 'Bağlı değil'}
                  </div>
                </div>
                {connected ? (
                  <button
                    onClick={() => disconnect(p)} disabled={busy === p} aria-label="Bağlantıyı kaldır"
                    style={{ all: 'unset', cursor: busy === p ? 'default' : 'pointer', width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', color: 'var(--danger)', background: 'var(--surface-hi)', boxShadow: 'var(--clay-flat)', flexShrink: 0 }}
                  >
                    {busy === p ? <Loader2 size={16} className="pl-spin" /> : <Unplug size={16} />}
                  </button>
                ) : (
                  <button
                    onClick={() => configured && connect(p)} disabled={!configured}
                    aria-label={`${LABELS[p]} bağlan`}
                    style={{ all: 'unset', cursor: configured ? 'pointer' : 'not-allowed', opacity: configured ? 1 : 0.45, height: 36, padding: '0 12px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#fff', background: `linear-gradient(180deg, ${ac.accent}, ${ac.primary})`, boxShadow: `0 8px 16px -8px ${ac.glow}`, fontSize: 12.5, fontWeight: 800, flexShrink: 0 }}
                  >
                    <Plug size={14} /> Bağlan
                  </button>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 4, padding: '0 2px', fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', lineHeight: 1.45 }}>
            <Check size={13} style={{ marginTop: 1, flexShrink: 0, color: 'var(--water-solid)' }} />
            <span>Bağlantı bir kez yapılır. Sonrasında eklediğiniz her görev, tüm detaylarıyla seçili takviminize otomatik işlenir.</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarConnect;
