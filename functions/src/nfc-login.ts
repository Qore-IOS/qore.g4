
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Normalizes NFC serials by removing non-alphanumeric chars and uppercasing.
 */
function normalizeNfcId(raw: any): string {
    if (typeof raw !== 'string') return '';
    return raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}


/**
 * Callable function to get a custom auth token for a given NFC serial.
 * This function can be called by an unauthenticated (anonymous) user.
 */
export const nfcLoginWithSerial = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    
    const rawSerial = data?.serial;
    if (!rawSerial || typeof rawSerial !== 'string' || rawSerial.length < 4) {
      throw new functions.https.HttpsError('invalid-argument', 'Geçerli bir seri numarası (serial) sağlanmalıdır.');
    }
    
    const serial = normalizeNfcId(rawSerial);

    try {
      const db = admin.firestore();
      const qs = await db
        .collection('users')
        .where('nfcId', '==', serial)
        .limit(1)
        .get();

      if (qs.empty) {
        throw new functions.https.HttpsError('not-found', 'Bu NFC kartıyla eşleşen bir kullanıcı bulunamadı.');
      }

      const userDoc = qs.docs[0];
      const uid = userDoc.id; // Doc ID is the UID
      const userData = userDoc.data() || {};
      
      const token = await admin.auth().createCustomToken(uid, { nfcLogin: true });

      return {
        token,
        uid,
        email: userData.email || null,
        name: userData.name || null,
      };

    } catch (e: any) {
      logger.warn('nfcLoginWithSerial error', { serial, code: e?.code, msg: e?.message });
      if (e instanceof functions.https.HttpsError) throw e;
      logger.error('nfcLoginWithSerial internal', { msg: e?.message, stack: e?.stack });
      throw new functions.https.HttpsError('internal', e?.message || 'Beklenmeyen hata');
    }
  });
