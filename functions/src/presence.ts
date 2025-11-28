
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Mirrors RTDB /status/{uid} -> Firestore /presence/{uid}.
 * This is triggered whenever a user's connection state changes in the Realtime Database.
 */
export const mirrorPresenceToFirestore = functions
  .region('europe-west1')
  .database.ref('/status/{uid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid as string;
    
    // If the data is deleted (e.g., user logs out cleanly), mark as offline.
    const val = change.after.exists() ? change.after.val() : null;
    
    const state = val?.state === 'online' ? 'online' : 'offline';
    const lastChangedMs = typeof val?.lastChanged === 'number' ? val.lastChanged : Date.now();

    const fsRef = admin.firestore().doc(`presence/${uid}`);
    try {
      await fsRef.set(
        {
          state,
          lastChanged: admin.firestore.Timestamp.fromMillis(lastChangedMs),
        },
        { merge: true }
      );
      console.log(`Presence for ${uid} mirrored to Firestore: ${state}`);
    } catch (error) {
      console.error(`Error mirroring presence for ${uid} to Firestore:`, error);
    }
    return null;
  });
