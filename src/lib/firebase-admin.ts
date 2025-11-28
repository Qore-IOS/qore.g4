// src/lib/firebase-admin.ts
import * as admin from 'firebase-admin';

// IMPORTANT: This file is used in server-side code (Server Actions, API routes).
// Do not import this file in client-side components.

const serviceAccountKeyFromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

let serviceAccount: admin.ServiceAccount;

// Initialize the app only if it's not already initialized.
if (!admin.apps.length) {
  try {
    if (serviceAccountKeyFromEnv) {
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
const adminAuth = admin.auth();

export { adminDb, adminAuth };
