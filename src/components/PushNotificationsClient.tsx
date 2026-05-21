"use client";

import { useEffect, useRef } from "react";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { FirebaseError } from "firebase/app";
import { app } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { savePushToken } from "@/lib/pushTokens";
import { registerServiceWorker } from "@/lib/register-sw";

// Errors that cannot be fixed by retrying — usually a Google Cloud Console
// or Firebase Console configuration problem. Logging guidance instead of
// retrying avoids hammering a permanently-failing endpoint.
const PERMANENT_ERROR_CODES = new Set([
  "messaging/permission-blocked",
  "messaging/unsupported-browser",
  "messaging/failed-service-worker-registration",
  "installations/request-failed",
  "installations/app-config-not-set",
  "messaging/token-subscribe-failed",
  "messaging/token-subscribe-no-token",
]);

function logActionableError(error: unknown) {
  console.error("❌ [Push Notifications] Error:", error);

  const code = error instanceof FirebaseError ? error.code : "";
  const message = error instanceof Error ? error.message : String(error);

  const isInstallationsBlocked =
    code === "installations/request-failed" ||
    /firebaseinstallations\.googleapis\.com/i.test(message) ||
    /PERMISSION_DENIED/.test(message);

  if (isInstallationsBlocked) {
    console.error(
      [
        "🔧 [Push Notifications] Firebase Installations API isteği reddedildi.",
        "Bu bir kod hatası değil — Google Cloud Console konfigürasyonu gerekiyor:",
        "  1) APIs & Services → Library: 'Firebase Installations API' ve",
        "     'Firebase Cloud Messaging API' enable edilmiş olmalı.",
        "  2) APIs & Services → Credentials: Web API key'inin",
        "     'API restrictions' listesinde 'Firebase Installations API' bulunmalı.",
        "  3) HTTP referrer kısıtlaması varsa, çalışılan domain izin verilen",
        "     referrer'lar arasında olmalı.",
        `Proje: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "(unset)"}`,
      ].join("\n"),
    );
  }
}

function isPermanentError(error: unknown): boolean {
  if (error instanceof FirebaseError && PERMANENT_ERROR_CODES.has(error.code)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /firebaseinstallations\.googleapis\.com/i.test(message);
}

export default function PushNotificationsClient() {
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;

    // 1. Basic checks
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
        return;
    }

    if (!currentUserProfile) return;

    // 2. VAPID Key Check (Crucial)
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.error("❌ [Push Notifications] VAPID Key is missing! Check your .env file.");
      return;
    }

    const initMessaging = async () => {
      initialized.current = true;
      try {
        console.log("🔄 [Push Notifications] Initializing...");

        const registration = await registerServiceWorker();
        if (!registration) {
             console.error("❌ [Push Notifications] Service Worker registration failed.");
             return;
        }

        const messaging = getMessaging(app);

        // 3. Request Permission
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            console.warn("⚠️ [Push Notifications] Permission denied by user.");
            return;
        }

        // 4. Get Token
        console.log("🔑 [Push Notifications] Fetching FCM Token...");
        const currentToken = await getToken(messaging, {
          vapidKey: vapidKey,
          serviceWorkerRegistration: registration,
        });

        if (currentToken) {
           console.log("✅ [Push Notifications] Token received:", currentToken.slice(0, 10) + "...");
           await savePushToken(currentToken, currentUserProfile as any, {
              enabled: true,
           });
        } else {
            console.warn("⚠️ [Push Notifications] No registration token available.");
        }

      } catch (error) {
        logActionableError(error);
        // Only allow retry for transient errors (e.g. network blip). Permanent
        // errors like blocked APIs would loop forever otherwise.
        if (!isPermanentError(error)) {
          initialized.current = false;
        }
      }
    };

    initMessaging();

    // Foreground listener
    const messaging = getMessaging(app);
    const unsubscribe = onMessage(messaging, (payload) => {
        console.log("🔔 [Push Notifications] Foreground message:", payload);
        const d = payload.data as Record<string, string> | undefined;
        toast({
            title: d?.title || payload.notification?.title || "Yeni Bildirim",
            description: d?.body || payload.notification?.body || "",
        });
    });

    return () => unsubscribe();
  }, [currentUserProfile, toast]);

  return null;
}
