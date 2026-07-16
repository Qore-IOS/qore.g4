/**
 * OAuth "state" parametresi için kısa ömürlü doğrulama kayıtları.
 * State, hangi kullanıcının hangi sağlayıcıya bağlandığını CSRF'e karşı korumalı
 * biçimde taşır. Firestore'da saklanır, callback'te bir kez okunup silinir.
 * Yalnızca sunucu tarafı (Admin SDK).
 */
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import type { CalendarProvider } from './calendar-oauth';

const COLLECTION = 'calendarOAuthStates';
const TTL_MS = 10 * 60 * 1000; // 10 dakika

export async function createOAuthState(
  uid: string,
  provider: CalendarProvider,
  redirect: string,
): Promise<string> {
  const id = crypto.randomBytes(24).toString('hex');
  await adminDb.collection(COLLECTION).doc(id).set({
    uid,
    provider,
    redirect,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  });
  return id;
}

export interface OAuthState {
  uid: string;
  provider: CalendarProvider;
  redirect: string;
}

/** State'i doğrular ve tüketir (tek kullanımlık). Geçersiz/süresi dolmuşsa null. */
export async function consumeOAuthState(
  id: string,
  provider: CalendarProvider,
): Promise<OAuthState | null> {
  if (!id) return null;
  const ref = adminDb.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  await ref.delete().catch(() => {});
  if (data.provider !== provider) return null;
  if (typeof data.expiresAt === 'number' && data.expiresAt < Date.now()) return null;
  return { uid: data.uid, provider: data.provider, redirect: data.redirect };
}
