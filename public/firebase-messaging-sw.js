// public/firebase-messaging-sw.js

console.log("[Service Worker] Firebase messaging service worker loading...");

// Scripts for Firebase
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
);

// Import Firebase configuration
try {
  importScripts("/firebase-config.js");
  console.log("[Service Worker] Firebase config imported successfully");
} catch (error) {
  console.error("[Service Worker] Failed to import firebase-config.js:", error);
}

// Your web app's Firebase configuration
// Use imported config if available, otherwise fallback to hardcoded values
const firebaseConfig = self.FIREBASE_CONFIG || {
  apiKey: "AIzaSyCNyMrzGqqE6lswpxAXkNavCdWqOcXupwY",
  authDomain: "invpilot.firebaseapp.com",
  databaseURL:
    "https://invpilot-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "invpilot",
  storageBucket: "invpilot.appspot.com",
  messagingSenderId: "929852527053",
  appId: "1:929852527053:web:bde59db5aae5c07a387484",
  measurementId: "G-TGHCKJKWEZ",
};

console.log("[Service Worker] Initializing Firebase with config:", {
  projectId: firebaseConfig.projectId,
  messagingSenderId: firebaseConfig.messagingSenderId,
});

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

console.log("[Service Worker] Firebase initialized successfully");

/**
 * Handles incoming push notifications when the app is in the background or closed.
 * It displays a system-level notification to the user.
 */
messaging.onBackgroundMessage((payload) => {
  console.log("[Service Worker] Received background message:", {
    title: payload.notification?.title,
    body: payload.notification?.body,
    data: payload.data,
  });

  try {
    const notificationTitle = payload.notification?.title || "Yeni Bildirim";
    const notificationOptions = {
      body: payload.notification?.body || "",
      icon:
        payload.notification?.icon ||
        "/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG",
      badge: "/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG",
      tag: payload.data?.id || "notification",
      requireInteraction: false,
      data: {
        url:
          payload.fcmOptions?.link ||
          payload.data?.link ||
          payload.data?.href ||
          "/",
        ...payload.data,
      },
    };

    console.log("[Service Worker] Showing notification:", notificationTitle);
    return self.registration.showNotification(
      notificationTitle,
      notificationOptions
    );
  } catch (error) {
    console.error("[Service Worker] Error showing notification:", error);
  }
});

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
  console.log("[Service Worker] Notification clicked:", event.notification.tag);
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";
  console.log("[Service Worker] Opening URL:", urlToOpen);

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((clientList) => {
        // If a window for this app is already open, focus it and navigate
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            // Navigate to the URL if possible
            if (client.navigate) {
              return client.navigate(urlToOpen);
            }
            return client;
          }
        }
        // Otherwise, open a new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
      .catch((error) => {
        console.error(
          "[Service Worker] Error handling notification click:",
          error
        );
      })
  );
});
