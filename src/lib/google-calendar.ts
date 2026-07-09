import type { Task } from '@/components/purchasing/planlama/pl-primitives';

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export interface GoogleCalendarSyncResult {
  eventId: string;
  htmlLink?: string;
}

type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
  callback?: (response: { access_token?: string; error?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

let tokenClient: GoogleTokenClient | null = null;
let accessToken: string | null = null;
let scriptPromise: Promise<void> | null = null;

const loadGoogleIdentityScript = () => {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google Calendar yalnızca tarayıcıda kullanılabilir.'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google giriş betiği yüklenemedi.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google giriş betiği yüklenemedi.'));
    document.head.appendChild(script);
  });

  return scriptPromise;
};

const getClientId = () => {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('Google Calendar için NEXT_PUBLIC_GOOGLE_CLIENT_ID ortam değişkeni tanımlı değil.');
  }
  return clientId;
};

export const isGoogleCalendarConfigured = () => Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
export const hasGoogleCalendarToken = () => Boolean(accessToken);

export async function connectGoogleCalendar(): Promise<void> {
  await loadGoogleIdentityScript();
  const clientId = getClientId();

  await new Promise<void>((resolve, reject) => {
    tokenClient = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_CALENDAR_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(`Google yetkilendirme hatası: ${response.error}`));
          return;
        }
        if (!response.access_token) {
          reject(new Error('Google erişim anahtarı alınamadı.'));
          return;
        }
        accessToken = response.access_token;
        resolve();
      },
    }) || null;

    if (!tokenClient) {
      reject(new Error('Google oturum istemcisi başlatılamadı.'));
      return;
    }

    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

const normalizeTime = (value?: string, fallback = '09:00') => /^\d{2}:\d{2}$/.test(value || '') ? value as string : fallback;

const toCalendarDateTime = (date: string, time?: string, fallback = '09:00') => `${date}T${normalizeTime(time, fallback)}:00`;

const addDays = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const taskDescription = (task: Pick<Task, 'note' | 'pri' | 'subs'>) => {
  const priorityMap: Record<Task['pri'], string> = { high: 'Yüksek', mid: 'Orta', low: 'Düşük' };
  const lines = [
    task.note?.trim() ? task.note.trim() : '',
    `Önem: ${priorityMap[task.pri]}`,
    ...(task.subs?.length ? ['', 'Alt görevler:', ...task.subs.map((sub) => `- ${sub.done ? '[x]' : '[ ]'} ${sub.title}`)] : []),
    '',
    'Qore Planlama Birimi tarafından oluşturuldu.',
  ];
  return lines.filter((line, index) => line || index === 2).join('\n');
};

const taskToGoogleEvent = (task: Task) => {
  const hasTime = Boolean(task.time);
  const endTime = task.end || (task.time ? undefined : '17:00');

  return {
    summary: task.done ? `✓ ${task.title}` : task.title,
    description: taskDescription(task),
    start: hasTime ? { dateTime: toCalendarDateTime(task.date, task.time), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : { date: task.date },
    end: hasTime ? { dateTime: toCalendarDateTime(task.date, endTime, '17:00'), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : { date: addDays(task.date, 1) },
    extendedProperties: {
      private: {
        qoreSource: 'planlamaGorevler',
        qoreTaskId: task.id,
      },
    },
  };
};

async function ensureToken() {
  if (!accessToken) await connectGoogleCalendar();
  if (!accessToken) throw new Error('Google Calendar bağlantısı kurulamadı.');
  return accessToken;
}

async function requestCalendar<T>(url: string, init: RequestInit): Promise<T> {
  const token = await ensureToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (response.status === 401) {
    accessToken = null;
    throw new Error('Google Calendar oturumu süresi doldu. Lütfen tekrar bağlanın.');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar işlemi başarısız oldu (${response.status}): ${text}`);
  }
  return response.status === 204 ? ({} as T) : response.json();
}

export async function upsertGoogleCalendarEvent(task: Task): Promise<GoogleCalendarSyncResult> {
  const body = JSON.stringify(taskToGoogleEvent(task));
  const eventId = task.googleCalendarEventId;
  const event = await requestCalendar<{ id: string; htmlLink?: string }>(
    eventId ? `${CALENDAR_API_BASE}/${encodeURIComponent(eventId)}` : CALENDAR_API_BASE,
    { method: eventId ? 'PATCH' : 'POST', body },
  );
  return { eventId: event.id, htmlLink: event.htmlLink };
}

export async function deleteGoogleCalendarEvent(eventId?: string): Promise<void> {
  if (!eventId) return;
  await requestCalendar(`${CALENDAR_API_BASE}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
}
