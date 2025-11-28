/**
 * Service Worker Registration Utility
 *
 * Safely registers the Firebase messaging service worker with comprehensive
 * error handling and logging. This utility ensures the app continues to work
 * even if service worker registration fails.
 */

/**
 * Registers the Firebase messaging service worker
 *
 * @returns ServiceWorkerRegistration if successful, null if registration fails
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  // Check if we're in a browser environment
  if (typeof window === "undefined") {
    console.log(
      "[Service Worker] Not in browser environment, skipping registration"
    );
    return null;
  }

  // Check if service workers are supported
  if (!("serviceWorker" in navigator)) {
    console.warn(
      "[Service Worker] Service workers are not supported in this browser"
    );
    return null;
  }

  try {
    console.log("[Service Worker] Starting registration...");

    // Register the service worker
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
      {
        scope: "/",
      }
    );

    console.log("[Service Worker] Registration successful:", {
      scope: registration.scope,
      active: !!registration.active,
      installing: !!registration.installing,
      waiting: !!registration.waiting,
    });

    // Wait for the service worker to be ready
    await navigator.serviceWorker.ready;
    console.log("[Service Worker] Service worker is ready");

    return registration;
  } catch (error) {
    // Log the error but don't throw - allow the app to continue
    console.error("[Service Worker] Registration failed:", error);
    return null;
  }
}

/**
 * Checks if a service worker is currently registered
 *
 * @returns true if a service worker is registered and active
 */
export function isServiceWorkerRegistered(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  return !!navigator.serviceWorker.controller;
}

/**
 * Gets the current service worker registration
 *
 * @returns The current registration or null
 */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration(
      "/firebase-messaging-sw.js"
    );
    return registration || null;
  } catch (error) {
    console.error("[Service Worker] Failed to get registration:", error);
    return null;
  }
}
