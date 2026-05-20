/**
 * Resolve a Firebase ID token (sent by the chat UI) to a PermissionContext.
 * Falls back to an admin-scope context when no token is supplied so the engine
 * still runs in environments where the chat is opened anonymously.
 */
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { aiLogger } from '@/lib/logger';
import type { User } from '@/lib/types';
import { buildPermissionContext } from './permissions';
import type { PermissionContext } from './types';

const LEGACY_COMPANY_ID = '__legacy__';

export async function permissionContextFromRequest(req: Request): Promise<PermissionContext> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (token) {
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      const profile = await loadUserProfile(decoded.uid);
      return buildPermissionContext({
        uid: decoded.uid,
        email: decoded.email ?? null,
        name: decoded.name ?? profile?.name ?? null,
        role: profile?.role ?? 'user',
        companyId: profile?.companyId ?? LEGACY_COMPANY_ID,
        assignedLaboratories: profile?.assignedLaboratories ?? [],
        primaryLaboratories: profile?.primaryLaboratories ?? [],
        assignedDepots: profile?.assignedDepots ?? [],
        assignedBrands: profile?.assignedBrands ?? [],
        assignedLabGroups: profile?.assignedLabGroups ?? [],
      });
    } catch (e) {
      aiLogger.warn('verifyIdToken failed, using fallback context', { message: (e as Error).message });
    }
  }

  // Fallback: admin-equivalent so the chat still works for legacy/anonymous
  // callers. Real deployments should send a token.
  return buildPermissionContext({
    uid: 'anonymous',
    email: null,
    name: 'Misafir',
    role: 'admin',
    companyId: LEGACY_COMPANY_ID,
    assignedLaboratories: [],
    primaryLaboratories: [],
    assignedDepots: [],
    assignedBrands: [],
    assignedLabGroups: [],
  });
}

async function loadUserProfile(uid: string): Promise<User | null> {
  try {
    const snap = await adminDb.collection('users').doc(uid).get();
    if (!snap.exists) return null;
    return snap.data() as User;
  } catch (e) {
    aiLogger.warn('users/{uid} read failed', { uid, message: (e as Error).message });
    return null;
  }
}
