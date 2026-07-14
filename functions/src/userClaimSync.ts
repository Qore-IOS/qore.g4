/**
 * Multi-tenancy custom claim sync (Faz 2).
 *
 * Firestore `users/{uid}` dokümanına her yazma sonrası, ilgili Firebase Auth
 * kullanıcısının custom claim'lerini (`companyId`, `role`, `isSuperAdmin`)
 * günceller. Bu claim'ler Firestore Security Rules (Faz 6) için kritiktir —
 * Rules'ta `request.auth.token.companyId` ve `request.auth.token.isSuperAdmin`
 * okunur.
 *
 * Idempotent: ilgili alanlar değişmediyse no-op.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';

interface ClaimPayload {
  companyId: string | null;
  role: string | null;
  isSuperAdmin: boolean;
}

function buildClaim(data: FirebaseFirestore.DocumentData | undefined | null): ClaimPayload {
  if (!data) {
    return { companyId: null, role: null, isSuperAdmin: false };
  }
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const role = typeof data.role === 'string' ? data.role : null;
  return {
    companyId: companyId || null,
    role,
    isSuperAdmin: role === 'super_admin',
  };
}

function claimsEqual(a: ClaimPayload, b: ClaimPayload): boolean {
  return a.companyId === b.companyId && a.role === b.role && a.isSuperAdmin === b.isSuperAdmin;
}

export const onUserClaimSync = functions.firestore
  .document('users/{uid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid as string;

    const after = change.after.exists ? change.after.data() : null;
    if (!after) {
      // Doc silindi — Auth user'ı zaten silinmiş olabilir. Claim sync yapmıyoruz.
      return;
    }

    const before = change.before.exists ? change.before.data() : null;
    const beforeClaim = buildClaim(before);
    const afterClaim = buildClaim(after);

    if (before && claimsEqual(beforeClaim, afterClaim)) {
      // İlgili alanlar değişmedi.
      return;
    }

    try {
      await admin.auth().setCustomUserClaims(uid, afterClaim);
      logger.info(`Custom claims updated for ${uid}`, afterClaim);
    } catch (err: any) {
      if (err && err.code === 'auth/user-not-found') {
        logger.warn(`Auth user not found for uid=${uid}; skipping claim sync.`);
        return;
      }
      logger.error(`Failed to set custom claims for ${uid}:`, err);
      throw err;
    }
  });
