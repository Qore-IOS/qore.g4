import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();

// Set your region once here (keep in sync with client):
const WITH_REGION = functions.region('europe-west1');

async function isAdmin(uid: string): Promise<boolean> {
  try {
    const userRec = await admin.auth().getUser(uid);
    // Prefer custom claim if present
    if ((userRec.customClaims as any)?.admin === true) return true;
  } catch { /* ignore */ }

  // Fallback to Firestore role check
  try {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    const role = snap.get('role');
    return role === 'admin';
  } catch {
    return false;
  }
}

export const revokeUserSessions = WITH_REGION.https.onCall(
  async (data, context) => {
    try {
      // 1) Auth check
      const callerUid = context.auth?.uid;
      if (!callerUid) {
        throw new functions.https.HttpsError('unauthenticated', 'Giriş gerekli.');
      }

      // 2) Admin check (claims or Firestore fallback)
      const adminOk = await isAdmin(callerUid);
      if (!adminOk) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Yalnızca adminler oturum sonlandırabilir.'
        );
      }

      // 3) Args check
      const uids: unknown = data?.uids;
      if (!Array.isArray(uids) || uids.length === 0 || uids.some((x) => typeof x !== 'string' || !x)) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Geçerli bir uid listesi (string[]) gönderin.'
        );
      }

      // 4) Do work - revoke tokens AND set forceLogout flag
      const failed: string[] = [];
      const db = admin.firestore();
      const batch = db.batch();

      await Promise.all(
        (uids as string[]).map(async (id) => {
          try {
            // Revoke refresh tokens
            await admin.auth().revokeRefreshTokens(id);
            // Set forceLogout flag in Firestore for immediate client-side logout
            const userRef = db.doc(`users/${id}`);
            batch.update(userRef, {
              forceLogout: admin.firestore.FieldValue.serverTimestamp()
            });
          } catch (e) {
            failed.push(id);
          }
        })
      );

      // Commit all forceLogout updates
      await batch.commit();

      return {
        success: failed.length === 0,
        processed: (uids as string[]).length - failed.length,
        failed,
      };
    } catch (err: any) {
      // Known HttpsError? rethrow it.
      if (err instanceof functions.https.HttpsError) throw err;

      // Unknown errors -> INTERNAL with safe message
      console.error('revokeUserSessions error', err);
      throw new functions.https.HttpsError(
        'internal',
        'Sunucu hatası: revokeUserSessions tamamlanamadı.'
      );
    }
  }
);
