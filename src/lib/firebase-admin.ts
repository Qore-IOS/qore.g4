// src/lib/firebase-admin.ts
import * as admin from 'firebase-admin';

// IMPORTANT: This file is used in server-side code (Server Actions, API routes).
// Do not import this file in client-side components.

const serviceAccountKeyFromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

let serviceAccount: admin.ServiceAccount;

/**
 * Emülatör kipi. Admin SDK, `FIRESTORE_EMULATOR_HOST` ve
 * `FIREBASE_AUTH_EMULATOR_HOST` ortam değişkenlerini KENDİLİĞİNDEN okur ve
 * trafiği emülatöre yönlendirir — ek bir bağlantı çağrısı gerekmez.
 *
 * Değişmesi gereken tek şey başlatma: emülatörde gerçek bir kimlik bilgisi
 * yoktur, `applicationDefault()` hata verir. Bu yüzden yalnız `projectId` ile
 * başlatılır. Emülatör dışında davranış birebir eskisi gibidir.
 */
const EMULATOR_MODE = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

// Initialize the app only if it's not already initialized.
if (!admin.apps.length) {
  try {
    if (EMULATOR_MODE) {
        admin.initializeApp({
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
              || process.env.GCLOUD_PROJECT
              || 'qore-e2e',
        });
        console.log(`Firebase Admin SDK initialized against emulator (${process.env.FIRESTORE_EMULATOR_HOST}).`);
    } else if (serviceAccountKeyFromEnv) {
        serviceAccount = JSON.parse(serviceAccountKeyFromEnv);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        console.log("Firebase Admin SDK initialized with service account from environment variable.");
    } else {
        // Fallback for local development or environments with Application Default Credentials
        admin.initializeApp({
             credential: admin.credential.applicationDefault(),
        });
        console.log("Firebase Admin SDK initialized with Application Default Credentials.");
    }
  } catch (error: any) {
    console.error("Firebase Admin SDK initialization error:", error.message);
    // This could indicate a missing or misconfigured service account.
    // Ensure GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_KEY is set in your environment.
  }
}

const adminDb = admin.firestore();
try {
  adminDb.settings({ ignoreUndefinedProperties: true });
} catch {
  // settings() may only run before the first Firestore call; safe to ignore on hot reload
}
const adminAuth = admin.auth();

export { adminDb, adminAuth };
