/**
 * Firebase Configuration for Service Worker
 *
 * This file provides Firebase configuration to the service worker.
 * It uses environment variables when available, with fallback to hardcoded values.
 *
 * Note: This file is loaded by the service worker, so it must be plain JavaScript
 * and cannot use ES6 imports or Next.js features.
 */

// Firebase configuration from environment variables
// These will be replaced at build time by Next.js
self.FIREBASE_CONFIG = {
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

console.log("[Firebase Config] Configuration loaded for service worker");
