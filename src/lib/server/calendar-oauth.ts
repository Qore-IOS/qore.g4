/**
 * Google Calendar & Microsoft Outlook takvim entegrasyonu – sunucu tarafı yardımcıları.
 *
 * IMPORTANT: Bu dosya yalnızca sunucu tarafında (API route'ları) kullanılır.
 * OAuth client secret'ları ve kullanıcıların refresh token'ları burada işlenir;
 * asla client bileşenlerinden import edilmemelidir.
 *
 * Gerekli ortam değişkenleri (.env.local):
 *   GOOGLE_CALENDAR_CLIENT_ID
 *   GOOGLE_CALENDAR_CLIENT_SECRET
 *   MICROSOFT_CALENDAR_CLIENT_ID
 *   MICROSOFT_CALENDAR_CLIENT_SECRET
 *   MICROSOFT_CALENDAR_TENANT        (opsiyonel, varsayılan "common")
 *   CALENDAR_TIMEZONE                (opsiyonel, varsayılan "Europe/Istanbul")
 *   APP_BASE_URL                     (opsiyonel; verilmezse istekten türetilir)
 *   CALENDAR_TOKEN_SECRET            (opsiyonel; refresh token'ları şifrelemek için)
 */
import crypto from 'crypto';
import type { NextRequest } from 'next/server';

export type CalendarProvider = 'google' | 'microsoft';

export const CALENDAR_TIMEZONE = process.env.CALENDAR_TIMEZONE || 'Europe/Istanbul';

/* ───────────────────────── konfigürasyon ───────────────────────── */

export function providerConfigured(provider: CalendarProvider): boolean {
  if (provider === 'google') {
    return !!(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
  }
  return !!(process.env.MICROSOFT_CALENDAR_CLIENT_ID && process.env.MICROSOFT_CALENDAR_CLIENT_SECRET);
}

/** İstekten uygulama tabanını türetir (proxy başlıklarını dikkate alarak). */
export function appBaseUrl(req: NextRequest): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  return `${proto}://${host}`;
}

export function redirectUri(req: NextRequest, provider: CalendarProvider): string {
  return `${appBaseUrl(req)}/api/calendar/${provider}/callback`;
}

/* ─────────────────── refresh token şifreleme (opsiyonel) ─────────────────── */
// CALENDAR_TOKEN_SECRET tanımlıysa refresh token'lar AES-256-GCM ile şifrelenir.
// Tanımlı değilse düz metin saklanır (koleksiyon zaten yalnızca sunucudan
// erişilebilir – firestore.rules ile tüm client erişimi reddedilir).

const ENC_PREFIX = 'enc:v1:';

function encKey(): Buffer | null {
  const secret = process.env.CALENDAR_TOKEN_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(plain: string): string {
  const key = encKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptToken(stored: string): string {
  if (!stored?.startsWith(ENC_PREFIX)) return stored;
  const key = encKey();
  if (!key) throw new Error('CALENDAR_TOKEN_SECRET tanımlı değil; token çözülemiyor.');
  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/* ───────────────────────── yetkilendirme URL'leri ───────────────────────── */

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const MICROSOFT_SCOPES = ['offline_access', 'Calendars.ReadWrite', 'User.Read', 'openid', 'email'];

function msTenant(): string {
  return process.env.MICROSOFT_CALENDAR_TENANT || 'common';
}

export function buildAuthUrl(provider: CalendarProvider, redirect: string, state: string): string {
  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      redirect_uri: redirect,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent', // her bağlanışta refresh token almayı garanti eder
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CALENDAR_CLIENT_ID!,
    redirect_uri: redirect,
    response_type: 'code',
    scope: MICROSOFT_SCOPES.join(' '),
    response_mode: 'query',
    prompt: 'select_account',
    state,
  });
  return `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/authorize?${params.toString()}`;
}

/* ───────────────────────── token değişimi ───────────────────────── */

interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number; // saniye
}

export async function exchangeCodeForToken(
  provider: CalendarProvider,
  code: string,
  redirect: string,
): Promise<TokenResult> {
  if (provider === 'google') {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error(`Google token değişimi başarısız: ${await res.text()}`);
    const data = await res.json();
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  const res = await fetch(`https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CALENDAR_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET!,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
      scope: MICROSOFT_SCOPES.join(' '),
    }),
  });
  if (!res.ok) throw new Error(`Microsoft token değişimi başarısız: ${await res.text()}`);
  const data = await res.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

export async function refreshAccessToken(
  provider: CalendarProvider,
  refreshToken: string,
): Promise<TokenResult> {
  if (provider === 'google') {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`Google token yenileme başarısız: ${await res.text()}`);
    const data = await res.json();
    // Google yeni bir refresh token döndürmez; mevcut olan korunur.
    return { accessToken: data.access_token, refreshToken: undefined, expiresIn: data.expires_in };
  }

  const res = await fetch(`https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CALENDAR_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: MICROSOFT_SCOPES.join(' '),
    }),
  });
  if (!res.ok) throw new Error(`Microsoft token yenileme başarısız: ${await res.text()}`);
  const data = await res.json();
  // Microsoft rotasyonlu refresh token döndürebilir; yenisini geri veriyoruz.
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

/* ───────────────────────── hesap e-postası ───────────────────────── */

export async function fetchAccountEmail(
  provider: CalendarProvider,
  accessToken: string,
): Promise<string | null> {
  try {
    if (provider === 'google') {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.email || null;
    }
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.mail || data.userPrincipalName || null;
  } catch {
    return null;
  }
}

/* ───────────────────────── görev → takvim etkinliği ───────────────────────── */

export interface CalendarTask {
  id: string;
  title: string;
  note?: string;
  pri?: 'high' | 'mid' | 'low';
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  end?: string; // HH:MM
  done?: boolean;
  subs?: { title: string; done: boolean }[];
}

const PRI_LABEL: Record<string, string> = { high: 'Yüksek', mid: 'Orta', low: 'Düşük' };

function nextDayIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const dt = new Date(2000, 0, 1, h, m + mins);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function buildDescription(task: CalendarTask): string {
  const lines: string[] = [];
  if (task.note) lines.push(task.note, '');
  if (task.pri) lines.push(`Önem: ${PRI_LABEL[task.pri] || task.pri}`);
  if (task.subs && task.subs.length) {
    lines.push('', 'Alt görevler:');
    for (const s of task.subs) lines.push(`  ${s.done ? '☑' : '☐'} ${s.title}`);
  }
  lines.push('', 'Qore · Satın-Alma Planlama');
  return lines.join('\n').trim();
}

/** Google Calendar API event gövdesi. */
export function toGoogleEvent(task: CalendarTask): Record<string, any> {
  const summary = `${task.done ? '✔ ' : ''}${task.title}`.trim();
  const description = buildDescription(task);
  if (task.time) {
    const endTime = task.end && task.end > task.time ? task.end : addMinutes(task.time, 30);
    return {
      summary,
      description,
      start: { dateTime: `${task.date}T${task.time}:00`, timeZone: CALENDAR_TIMEZONE },
      end: { dateTime: `${task.date}T${endTime}:00`, timeZone: CALENDAR_TIMEZONE },
    };
  }
  // Tüm gün etkinliği (Google'da end.date hariç tutulur → ertesi gün).
  return {
    summary,
    description,
    start: { date: task.date },
    end: { date: nextDayIso(task.date) },
  };
}

/** Microsoft Graph event gövdesi. */
export function toMicrosoftEvent(task: CalendarTask): Record<string, any> {
  const subject = `${task.done ? '✔ ' : ''}${task.title}`.trim();
  const body = { contentType: 'text', content: buildDescription(task) };
  if (task.time) {
    const endTime = task.end && task.end > task.time ? task.end : addMinutes(task.time, 30);
    return {
      subject,
      body,
      start: { dateTime: `${task.date}T${task.time}:00`, timeZone: CALENDAR_TIMEZONE },
      end: { dateTime: `${task.date}T${endTime}:00`, timeZone: CALENDAR_TIMEZONE },
    };
  }
  return {
    subject,
    body,
    isAllDay: true,
    start: { dateTime: `${task.date}T00:00:00`, timeZone: CALENDAR_TIMEZONE },
    end: { dateTime: `${nextDayIso(task.date)}T00:00:00`, timeZone: CALENDAR_TIMEZONE },
  };
}

/* ───────────────────────── takvim CRUD (REST) ───────────────────────── */

/** Etkinliği oluşturur/günceller, sağlayıcının event id'sini döndürür. */
export async function upsertEvent(
  provider: CalendarProvider,
  accessToken: string,
  task: CalendarTask,
  existingEventId?: string,
): Promise<string> {
  if (provider === 'google') {
    const body = toGoogleEvent(task);
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const url = existingEventId ? `${base}/${encodeURIComponent(existingEventId)}` : base;
    const res = await fetch(url, {
      method: existingEventId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 404 && existingEventId) {
      // Etkinlik takvimde silinmiş → yeniden oluştur.
      return upsertEvent(provider, accessToken, task, undefined);
    }
    if (!res.ok) throw new Error(`Google etkinlik yazma başarısız: ${await res.text()}`);
    const data = await res.json();
    return data.id;
  }

  const body = toMicrosoftEvent(task);
  const base = 'https://graph.microsoft.com/v1.0/me/events';
  const url = existingEventId ? `${base}/${encodeURIComponent(existingEventId)}` : base;
  const res = await fetch(url, {
    method: existingEventId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404 && existingEventId) {
    return upsertEvent(provider, accessToken, task, undefined);
  }
  if (!res.ok) throw new Error(`Microsoft etkinlik yazma başarısız: ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

export async function deleteEvent(
  provider: CalendarProvider,
  accessToken: string,
  eventId: string,
): Promise<void> {
  const url =
    provider === 'google'
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404/410 → etkinlik zaten yok; sorun değil.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`${provider} etkinlik silme başarısız: ${await res.text()}`);
  }
}
