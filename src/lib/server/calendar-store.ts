/**
 * Kullanıcıların takvim bağlantılarının (refresh token vb.) Firestore'da
 * saklanması ve taze access token üretimi. Yalnızca sunucu tarafı.
 *
 * Koleksiyon: calendarConnections/{uid}
 *   {
 *     google?:    { email, refreshToken(enc), accessToken(enc), expiry, connectedAt },
 *     microsoft?: { email, refreshToken(enc), accessToken(enc), expiry, connectedAt },
 *   }
 *
 * firestore.rules bu koleksiyona tüm client erişimini reddeder; yalnızca
 * Admin SDK (bu dosya) okuyup yazabilir.
 */
import { adminDb } from '../data/admin';
import {
  type CalendarProvider,
  encryptToken,
  decryptToken,
  refreshAccessToken,
} from './calendar-oauth';

const COLLECTION = 'calendarConnections';

interface ProviderConnection {
  email: string | null;
  refreshToken: string;
  accessToken?: string;
  expiry?: number; // epoch ms
  connectedAt?: number;
}

export interface ConnectionStatus {
  google: { connected: boolean; email: string | null };
  microsoft: { connected: boolean; email: string | null };
}

export async function saveConnection(
  uid: string,
  provider: CalendarProvider,
  data: { email: string | null; refreshToken: string; accessToken: string; expiresIn: number },
): Promise<void> {
  const conn: ProviderConnection = {
    email: data.email,
    refreshToken: encryptToken(data.refreshToken),
    accessToken: encryptToken(data.accessToken),
    expiry: Date.now() + data.expiresIn * 1000,
    connectedAt: Date.now(),
  };
  await adminDb.collection(COLLECTION).doc(uid).set({ [provider]: conn }, { merge: true });
}

export async function deleteConnection(uid: string, provider: CalendarProvider): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(uid);
  const {FieldValue} = await import('../data/admin');
  await ref.set({ [provider]: FieldValue.delete() }, { merge: true });
}

export async function getConnectionStatus(uid: string): Promise<ConnectionStatus> {
  const snap = await adminDb.collection(COLLECTION).doc(uid).get();
  const data = snap.exists ? (snap.data() as Record<string, ProviderConnection>) : {};
  return {
    google: { connected: !!data.google?.refreshToken, email: data.google?.email ?? null },
    microsoft: { connected: !!data.microsoft?.refreshToken, email: data.microsoft?.email ?? null },
  };
}

/** Bağlı sağlayıcıların listesi (sync için). */
export async function connectedProviders(uid: string): Promise<CalendarProvider[]> {
  const snap = await adminDb.collection(COLLECTION).doc(uid).get();
  if (!snap.exists) return [];
  const data = snap.data() as Record<string, ProviderConnection>;
  const out: CalendarProvider[] = [];
  if (data.google?.refreshToken) out.push('google');
  if (data.microsoft?.refreshToken) out.push('microsoft');
  return out;
}

/* ─────────── görev → etkinlik id eşlemesi (kullanıcıya özel) ───────────
 * Etkinlik id'leri paylaşılan görev dokümanında DEĞİL, kullanıcıya özel bir
 * alt koleksiyonda tutulur: calendarConnections/{uid}/events/{taskId}.
 * Böylece aynı şirketteki birden çok kullanıcı aynı görevi kendi takvimlerine
 * bağımsız event id'lerle ekleyebilir. */

interface TaskEventIds {
  google?: string;
  microsoft?: string;
}

function eventDoc(uid: string, taskId: string) {
  return adminDb.collection(COLLECTION).doc(uid).collection('events').doc(taskId);
}

export async function getTaskEventIds(uid: string, taskId: string): Promise<TaskEventIds> {
  const snap = await eventDoc(uid, taskId).get();
  return snap.exists ? (snap.data() as TaskEventIds) : {};
}

export async function setTaskEventId(
  uid: string,
  taskId: string,
  provider: CalendarProvider,
  eventId: string,
): Promise<void> {
  await eventDoc(uid, taskId).set({ [provider]: eventId }, { merge: true });
}

export async function clearTaskEventIds(uid: string, taskId: string): Promise<void> {
  await eventDoc(uid, taskId).delete().catch(() => {});
}

/**
 * Taze bir access token döndürür. Saklı token hâlâ geçerliyse onu kullanır;
 * değilse refresh token ile yeniler ve saklıyı günceller. Bağlantı yoksa null.
 */
export async function getFreshAccessToken(
  uid: string,
  provider: CalendarProvider,
): Promise<string | null> {
  const ref = adminDb.collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const conn = (snap.data() as Record<string, ProviderConnection>)[provider];
  if (!conn?.refreshToken) return null;

  // 60 sn'lik güvenlik payı ile hâlâ geçerliyse saklı token'ı kullan.
  if (conn.accessToken && conn.expiry && conn.expiry - Date.now() > 60_000) {
    return decryptToken(conn.accessToken);
  }

  const refreshToken = decryptToken(conn.refreshToken);
  const result = await refreshAccessToken(provider, refreshToken);
  const update: Partial<ProviderConnection> = {
    accessToken: encryptToken(result.accessToken),
    expiry: Date.now() + result.expiresIn * 1000,
  };
  // Microsoft rotasyonlu refresh token döndürebilir.
  if (result.refreshToken) update.refreshToken = encryptToken(result.refreshToken);
  await ref.set({ [provider]: { ...conn, ...update } }, { merge: true });
  return result.accessToken;
}
