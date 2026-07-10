
'use client';

import { db } from '@/lib/firebase';
import {
  collection, doc, addDoc, updateDoc, deleteField, onSnapshot,
  serverTimestamp, getDoc, getDocs, query, where, orderBy, Timestamp,
  arrayUnion, arrayRemove, setDoc,
} from 'firebase/firestore';
import type { User } from '@/lib/types';
import { normalizeCompanyId } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';

// ============================================================================
// TYPES
// ============================================================================

export type ParticipantStatus = 'invited' | 'joined' | 'declined';

export interface SessionParticipant {
  uid: string;
  name: string;
  status: ParticipantStatus;
  invitedAt?: any;
  joinedAt?: any;
}

export interface PresenceData {
  activeBrand: string | null;
  activeProduct: string | null;
  lastSeen: any;
  name: string;
  color: string;
}

export interface CellUpdate {
  uid: string;
  name: string;
  field: string; // 'stokAdedi' | 'cihazUstuAdedi' | 'counted'
  value: string | number | boolean;
  timestamp: any;
}

export interface SessionCountItem {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  stokAdedi: number;
  cihazUstuAdedi: number;
  counted: boolean;
  countedByUid?: string;
  countedByName?: string;
  updates: CellUpdate[];
}

export interface MaliyetSayimOturum {
  id: string;
  locationType: 'lab' | 'depot';
  locationId: string;
  locationName: string;
  status: 'active' | 'completed';
  createdAt: any;
  createdByUid: string;
  createdByName: string;
  participants: SessionParticipant[];
  // presence is stored as a sub-map: { [uid]: PresenceData }
  presence?: Record<string, PresenceData>;
  // countData stored per stokKodu
  countData?: Record<string, SessionCountItem>;
  // After completion, snapshot of final items
  completedItems?: {
    stokKodu: string;
    stokAdi: string;
    marka: string;
    stokAdedi: number;
    cihazUstuAdedi: number;
    cost?: number;
    currency?: 'EUR' | 'USD' | 'TRY';
    ambalajDegeri?: number;
    countedByUid?: string;
    countedByName?: string;
    updates: CellUpdate[];
  }[];
  completedAt?: any;
  totalBrands?: number;
  totalProducts?: number;
  period?: string;
  month?: number;
  year?: number;
}

// User colors for presence indicators
const PRESENCE_COLORS = [
  '#F2994A', '#6FCF97', '#56CCF2', '#BB6BD9', '#F2C94C',
  '#EB5757', '#2F80ED', '#27AE60', '#9B51E0', '#2D9CDB',
];

export function getPresenceColor(index: number): string {
  return PRESENCE_COLORS[index % PRESENCE_COLORS.length];
}

// ============================================================================
// FIRESTORE OPERATIONS
// ============================================================================

const COLLECTION = 'maliyetSayimOturumlar';

/** Create a new collaborative session */
export async function createSession(params: {
  locationType: 'lab' | 'depot';
  locationId: string;
  locationName: string;
  creatorUid: string;
  creatorName: string;
  invitedUsers: { uid: string; name: string }[];
  companyId?: string | null;
  period?: string;
  month?: number;
  year?: number;
}): Promise<string> {
  const now = new Date().toISOString();
  const participants: SessionParticipant[] = [
    {
      uid: params.creatorUid,
      name: params.creatorName,
      status: 'joined',
      joinedAt: now,
    },
    ...params.invitedUsers.map(u => ({
      uid: u.uid,
      name: u.name,
      status: 'invited' as ParticipantStatus,
      invitedAt: now,
    })),
  ];

  const docRef = await addDoc(collection(db, COLLECTION), {
    locationType: params.locationType,
    locationId: params.locationId,
    locationName: params.locationName,
    status: 'active',
    createdAt: serverTimestamp(),
    createdByUid: params.creatorUid,
    createdByName: params.creatorName,
    participants,
    presence: {},
    countData: {},
    companyId: normalizeCompanyId(params.companyId),
    period: params.period,
    month: params.month,
    year: params.year,
  });

  return docRef.id;
}

/** Join a session (accept invitation) */
export async function joinSession(sessionId: string, uid: string, name: string): Promise<void> {
  const ref = doc(db, COLLECTION, sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Oturum bulunamadı');

  const data = snap.data() as Omit<MaliyetSayimOturum, 'id'>;
  const updatedParticipants = data.participants.map(p =>
    p.uid === uid ? { ...p, status: 'joined' as ParticipantStatus, joinedAt: new Date().toISOString() } : p
  );

  await updateDoc(ref, { participants: updatedParticipants });
}

/** Decline a session invitation */
export async function declineSession(sessionId: string, uid: string): Promise<void> {
  const ref = doc(db, COLLECTION, sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Oturum bulunamadı');

  const data = snap.data() as Omit<MaliyetSayimOturum, 'id'>;
  const updatedParticipants = data.participants.map(p =>
    p.uid === uid ? { ...p, status: 'declined' as ParticipantStatus } : p
  );

  await updateDoc(ref, { participants: updatedParticipants });
}

/** Update presence data for a user */
export async function updatePresence(
  sessionId: string,
  uid: string,
  data: { activeBrand: string | null; activeProduct: string | null; name: string; color: string }
): Promise<void> {
  const ref = doc(db, COLLECTION, sessionId);
  await updateDoc(ref, {
    [`presence.${uid}`]: {
      ...data,
      lastSeen: serverTimestamp(),
    },
  });
}

/** Remove presence when user leaves */
export async function removePresence(sessionId: string, uid: string): Promise<void> {
  const ref = doc(db, COLLECTION, sessionId);
  await updateDoc(ref, {
    [`presence.${uid}`]: deleteField(),
  });
}

/** Update count data for a specific product */
export async function updateSessionCountData(
  sessionId: string,
  stokKodu: string,
  field: string,
  value: string | number | boolean,
  user: { uid: string; name: string },
  fullItem: { stokKodu: string; stokAdi: string; marka: string; stokAdedi: number; cihazUstuAdedi: number; counted: boolean }
): Promise<void> {
  const ref = doc(db, COLLECTION, sessionId);

  const update: Record<string, any> = {
    [`countData.${stokKodu}.stokKodu`]: fullItem.stokKodu,
    [`countData.${stokKodu}.stokAdi`]: fullItem.stokAdi,
    [`countData.${stokKodu}.marka`]: fullItem.marka,
    [`countData.${stokKodu}.stokAdedi`]: fullItem.stokAdedi,
    [`countData.${stokKodu}.cihazUstuAdedi`]: fullItem.cihazUstuAdedi,
    [`countData.${stokKodu}.counted`]: fullItem.counted,
  };

  if (field === 'counted' && value === true) {
    update[`countData.${stokKodu}.countedByUid`] = user.uid;
    update[`countData.${stokKodu}.countedByName`] = user.name;
  }

  // Add update log entry
  const updateEntry: CellUpdate = {
    uid: user.uid,
    name: user.name,
    field,
    value,
    timestamp: new Date().toISOString(),
  };

  // We use arrayUnion for the updates array
  update[`countData.${stokKodu}.updates`] = arrayUnion(updateEntry);

  await updateDoc(ref, update);
}

/** Complete a session and save final data to maliyetSayimSessions */
export async function completeSession(
  sessionId: string,
  finalItems: {
    stokKodu: string;
    stokAdi: string;
    marka: string;
    stokAdedi: number;
    cihazUstuAdedi: number;
    cost?: number;
    currency?: 'EUR' | 'USD' | 'TRY';
    ambalajDegeri?: number;
    countedByUid?: string;
    countedByName?: string;
    updates: CellUpdate[];
  }[],
  sessionMeta: {
    locationType: 'lab' | 'depot';
    locationId: string;
    locationName: string;
    createdByUid: string;
    createdByName: string;
    totalBrands: number;
    participants: SessionParticipant[];
    companyId?: string | null;
    period?: string;
    month?: number;
    year?: number;
  }
): Promise<void> {
  const ref = doc(db, COLLECTION, sessionId);

  // Save to maliyetSayimSessions (legacy format + enhanced with attribution)
  await addDoc(collection(db, 'maliyetSayimSessions'), {
    locationType: sessionMeta.locationType,
    locationId: sessionMeta.locationId,
    locationName: sessionMeta.locationName,
    createdAt: serverTimestamp(),
    createdByUid: sessionMeta.createdByUid,
    createdByName: sessionMeta.createdByName,
    items: finalItems.map(item => ({
      stokKodu: item.stokKodu,
      stokAdi: item.stokAdi,
      marka: item.marka,
      stokAdedi: item.stokAdedi,
      cihazUstuAdedi: item.cihazUstuAdedi,
      cost: item.cost ?? 0,
      currency: item.currency || 'TRY',
      ambalajDegeri: Number(item.ambalajDegeri) || 1,
    })),
    // Enhanced data for history
    itemsDetailed: finalItems,
    participants: sessionMeta.participants.filter(p => p.status === 'joined').map(p => ({
      uid: p.uid,
      name: p.name,
    })),
    sessionId, // reference back to the oturum
    totalBrands: sessionMeta.totalBrands,
    totalProducts: finalItems.length,
    companyId: normalizeCompanyId(sessionMeta.companyId),
    period: sessionMeta.period,
    month: sessionMeta.month,
    year: sessionMeta.year,
  });

  // Mark the oturum as completed
  await updateDoc(ref, {
    status: 'completed',
    completedAt: serverTimestamp(),
    completedItems: finalItems,
  });
}

/** Subscribe to a session for real-time updates */
export function subscribeToSession(
  sessionId: string,
  callback: (session: MaliyetSayimOturum | null) => void
): () => void {
  const ref = doc(db, COLLECTION, sessionId);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      callback({ id: snap.id, ...snap.data() } as MaliyetSayimOturum);
    } else {
      callback(null);
    }
  }, (error) => {
    console.error('Session subscription error:', error);
  });
}

/** Get active sessions for a user (invited or joined) */
export function subscribeToUserSessions(
  uid: string,
  callback: (sessions: MaliyetSayimOturum[]) => void,
  companyId?: string | null,
  isSuperAdmin?: boolean
): () => void {
  // Query only active sessions, sort client-side to avoid composite index requirement
  const q = query(
    collection(db, COLLECTION),
    where('status', '==', 'active')
  );

  const activeCompanyId = normalizeCompanyId(companyId);

  return onSnapshot(q, (snap) => {
    const sessions = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as MaliyetSayimOturum))
      .filter(s => {
        // Company scope filter
        if (!isSuperAdmin) {
          const sessionCompanyId = normalizeCompanyId((s as any).companyId);
          if (sessionCompanyId !== activeCompanyId) return false;
        }
        return s.participants.some(p => p.uid === uid);
      })
      .sort((a, b) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      });
    callback(sessions);
  }, (error) => {
    console.error('User sessions subscription error:', error);
  });
}

/** Get users assigned to a location (lab or depot) */
export async function getUsersForLocation(
  locationType: 'lab' | 'depot',
  locationId: string,
  companyId: string | null,
  isSuperAdmin: boolean,
): Promise<{ uid: string; name: string; email: string; role: string }[]> {
  const field = locationType === 'lab' ? 'assignedLaboratories' : 'assignedDepots';
  const usersSnap = await getDocs(scopedQuery('users', companyId, isSuperAdmin));

  const users: { uid: string; name: string; email: string; role: string }[] = [];

  usersSnap.docs.forEach(d => {
    const data = d.data() as User;
    const assignedIds: string[] = (data as any)[field] || [];
    const isAdmin = ['admin', 'admin_developer', 'super_admin'].includes(data.role || '');

    if (assignedIds.includes(locationId) || isAdmin) {
      users.push({
        uid: d.id,
        name: data.name || data.email || d.id,
        email: data.email || '',
        role: data.role || 'user',
      });
    }
  });

  return users.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}
