
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const auth = admin.auth();
const REGION = 'europe-west1';

/**
 * Creates a custom authentication token for a user identified by an NFC ID.
 * This function can be called by an unauthenticated client.
 */
export const createCustomTokenForNfcUser = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    // 1. Validate Input
    const nfcId = data.nfcId;
    if (typeof nfcId !== 'string' || !nfcId.trim()) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Geçerli bir NFC ID (nfcId) sağlanmalıdır.'
      );
    }

    // 2. Find User by NFC ID
    const usersRef = db.collection('users');
    const query = usersRef.where('nfcId', '==', nfcId.trim()).limit(1);

    const snapshot = await query.get();

    if (snapshot.empty) {
      throw new functions.https.HttpsError(
        'not-found',
        'Bu NFC kartıyla eşleşen bir kullanıcı bulunamadı.'
      );
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    const uid = userDoc.id; // The document ID is the user's UID

    // 3. Create Custom Token
    try {
      const customToken = await auth.createCustomToken(uid);
      
      // 4. Return the token and user data to the client
      return {
        token: customToken,
        user: {
          uid: uid,
          name: userData.name || null,
          email: userData.email || null,
          role: userData.role || 'user',
        }
      };
    } catch (error) {
      console.error('Error creating custom token:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Kullanıcı oturumu oluşturulurken bir sunucu hatası oluştu.'
      );
    }
  });
