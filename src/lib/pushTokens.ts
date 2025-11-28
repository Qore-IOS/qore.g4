
'use client';

import { db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { User } from './types';

export function buildMembershipKeysFromProfile(profile: User | null): string[] {
  const keys = new Set<string>();
  if (!profile) return [];
  if (profile.uid) keys.add(`user:${profile.uid}`);
  if (profile.role) keys.add(`role:${profile.role}`);
  (profile.accessibleViews || []).forEach((v: string) => keys.add(`view:${v}`));
  (profile.assignedLaboratories || []).forEach((id: string) => keys.add(`lab:${id}`));
  (profile.assignedDepots || []).forEach((id: string) => keys.add(`depot:${id}`));
  return Array.from(keys);
}

export async function savePushToken(
  token: string,
  profile: User | null,
  opts: { enabled: boolean }
) {
  const membershipKeys = buildMembershipKeysFromProfile(profile);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const payload = {
    token,
    uid: profile?.uid || null,
    enabled: !!opts.enabled,
    membershipKeys,
    platform: detectPlatform(ua),
    userAgent: ua,
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  // Flat collection for efficient audience queries
  await setDoc(doc(db, 'pushTokens', token), payload, { merge: true });

  // Optional per-user subcollection for account view / revocation UI
  if (profile?.uid) {
    await setDoc(doc(db, `users/${profile.uid}/pushTokens/${token}`), payload, { merge: true });
  }
}

function detectPlatform(ua: string) {
  if (!ua) return 'web';
  if (/Android/i.test(ua)) return 'android-web';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios-web';
  if (/Windows/i.test(ua)) return 'windows-web';
  if (/Macintosh/i.test(ua)) return 'mac-web';
  return 'web';
}
