"use client";

import { useEffect, useRef } from "react";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { savePushToken } from "@/lib/pushTokens";
import { registerServiceWorker } from "@/lib/register-sw";

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
        console.error("❌ [Push Notifications] Error:", error);
        initialized.current = false; // Allow retry
      }
    };

    initMessaging();

    // Foreground listener
    const messaging = getMessaging(app);
    const unsubscribe = onMessage(messaging, (payload) => {
        console.log("🔔 [Push Notifications] Foreground message:", payload);
        // Skip foreground toast for fault_opened - DynamicIslandToast handles these via Firestore listener
        const notificationType = payload.data?.type;
        if (notificationType === 'fault_opened' || notificationType === 'fault_closed' || notificationType === 'fefo_override') {
          console.log("🔇 [Push Notifications] Suppressing foreground toast for", notificationType, "- handled by DynamicIslandToast");
          return;
        }
        toast({
            title: payload.notification?.title || "Yeni Bildirim",
            description: payload.notification?.body || "",
        });
    });

    return () => unsubscribe();
  }, [currentUserProfile, toast]);

  return null;
}
