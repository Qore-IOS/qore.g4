"use client";

import { onAuthStateChanged, getAuth, signOut } from "firebase/auth";
import { app, db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set as rSet,
} from "firebase/database";
import { firebaseConfig } from "@/lib/firebase";
import { trackListener } from "@/lib/listener-monitor";

// Module-level tracking for cleanup
let activeDebounceTimer: NodeJS.Timeout | null = null;

// Helper to get RTDB instance, reusing the main app config
function getRtdb() {
  // Pass the databaseURL from the config to ensure connection to the correct region
  return getDatabase(app, firebaseConfig.databaseURL);
}

/**
 * Starts presence tracking for the authenticated user using RTDB's onDisconnect.
 */
export function startPresence() {
  const auth = getAuth(app);
  const rtdb = getRtdb();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      return; // User is not signed in.
    }

    const uid = user.uid;
    const userStatusRef = ref(rtdb, `status/${uid}`);
    const presenceRef = doc(db, "presence", uid);

    // Track connection state to prevent duplicate writes
    let isOnline = false;

    // This is the Firestore document that the UI listens to.
    // It's updated by the Cloud Function that mirrors RTDB.
    // We do an initial write here to ensure the document exists.
    try {
      await setDoc(
        presenceRef,
        { state: "online", lastChanged: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.error("Initial presence write to Firestore failed:", e);
    }

    // Monitor connection state to RTDB
    trackListener("presence-system", "create");
    const connectedRef = ref(rtdb, ".info/connected");
    const unsubscribe = onValue(connectedRef, async (snap) => {
      const connected = snap.val() === true;

      // Clear any pending debounce timer
      if (activeDebounceTimer) {
        clearTimeout(activeDebounceTimer);
      }

      // Debounce connection state changes to prevent rapid writes during network instability
      activeDebounceTimer = setTimeout(async () => {
        try {
          if (connected && !isOnline) {
            // Only write if we're transitioning from offline to online
            isOnline = true;

            // Register onDisconnect hook
            await onDisconnect(userStatusRef).set({
              state: "offline",
              lastChanged: Date.now(),
            });

            // Set current state in RTDB
            await rSet(userStatusRef, {
              state: "online",
              lastChanged: Date.now(),
            });
          } else if (!connected && isOnline) {
            // Mark as offline locally (RTDB onDisconnect will handle server-side)
            isOnline = false;
          }
        } catch (error) {
          console.error("Presence update error:", error);
        }
      }, 1000); // Debounce by 1 second
    });

    // Cleanup function for auth state change
    return () => {
      trackListener("presence-system", "cleanup");
      if (activeDebounceTimer) {
        clearTimeout(activeDebounceTimer);
        activeDebounceTimer = null;
      }
      if (unsubscribe) {
        unsubscribe();
      }
    };
  });
}

// Function to explicitly mark user as offline before signing out
export async function safeSignOut() {
  // Clear any pending debounce timers
  if (activeDebounceTimer) {
    clearTimeout(activeDebounceTimer);
    activeDebounceTimer = null;
  }

  const auth = getAuth(app);
  const user = auth.currentUser;
  if (user) {
    const rtdb = getRtdb();
    const userStatusRef = ref(rtdb, `status/${user.uid}`);
    await rSet(userStatusRef, { state: "offline", lastChanged: Date.now() });
  }
  await signOut(auth);
}
