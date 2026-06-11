"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { createNotification } from "@/lib/notifications";
import { useToast } from "@/hooks/use-toast";
import { getMessaging, getToken } from "firebase/messaging";
import { app, db } from "@/lib/firebase";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { getDocsResilient } from '@/lib/firestore-network-recovery';

type NotificationLog = {
  id: string;
  notificationId: string;
  type: string;
  channel: string;
  title: string;
  targets: string[];
  status: string;
  tokensMatched: number;
  successCount: number;
  failureCount: number;
  staleTokensRemoved?: number;
  errors: string[];
  createdAt: any;
};

export default function NotificationTester() {
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  const [title, setTitle] = useState("Test Notification");
  const [message, setMessage] = useState("This is a test notification");
  const [loading, setLoading] = useState(false);
  const [currentToken, setCurrentToken] = useState<string>("");
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const q = query(
        collection(db, "notificationLogs"),
        orderBy("createdAt", "desc"),
        limit(20)
      );
      const snap = await getDocsResilient(q);
      const items: NotificationLog[] = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as NotificationLog[];
      setLogs(items);
    } catch (error) {
      console.error("Error fetching logs:", error);
      toast({
        title: "Hata",
        description: "Loglar yüklenemedi",
        variant: "destructive",
      });
    } finally {
      setLoadingLogs(false);
    }
  }, [toast]);

  const handleGetToken = async () => {
    try {
      const messaging = getMessaging(app);
      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

      if (!vapidKey) {
        toast({
          title: "Error",
          description: "VAPID key not configured",
          variant: "destructive",
        });
        return;
      }

      const token = await getToken(messaging, { vapidKey });
      setCurrentToken(token);

      toast({
        title: "Token Retrieved",
        description: "FCM token copied to display",
      });
    } catch (error) {
      console.error("Error getting token:", error);
      toast({
        title: "Error",
        description: "Failed to get FCM token",
        variant: "destructive",
      });
    }
  };

  const handleSendNotification = async () => {
    if (!currentUserProfile) {
      toast({
        title: "Error",
        description: "You must be logged in to send notifications",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      await createNotification({
        type: "custom",
        title,
        message,
        actor: {
          uid: currentUserProfile.uid || "test-user",
          name: currentUserProfile.name || "Test User",
        },
        targets: [`user:${currentUserProfile.uid}`], // Send to self for testing
        meta: {
          test: true,
        },
      });

      toast({
        title: "Success",
        description: "Test notification sent! Check your notifications.",
      });
    } catch (error) {
      console.error("Error sending notification:", error);
      toast({
        title: "Error",
        description: "Failed to send notification",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSendToAdmins = async () => {
    if (!currentUserProfile) {
      toast({
        title: "Error",
        description: "You must be logged in to send notifications",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      await createNotification({
        type: "custom",
        title,
        message,
        actor: {
          uid: currentUserProfile.uid || "test-user",
          name: currentUserProfile.name || "Test User",
        },
        targets: ["role:admin"], // Send to all admins
        meta: {
          test: true,
        },
      });

      toast({
        title: "Success",
        description: "Test notification sent to all admins!",
      });
    } catch (error) {
      console.error("Error sending notification:", error);
      toast({
        title: "Error",
        description: "Failed to send notification",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Push Notification Tester</CardTitle>
        <CardDescription>
          Test push notifications in foreground and background modes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* FCM Token Display */}
        <div className="space-y-2">
          <Label>Current FCM Token</Label>
          <div className="flex gap-2">
            <Input
              value={currentToken}
              readOnly
              placeholder="Click 'Get Token' to retrieve"
              className="font-mono text-xs"
            />
            <Button onClick={handleGetToken} variant="outline">
              Get Token
            </Button>
          </div>
          {currentToken && (
            <p className="text-xs text-muted-foreground">
              Token length: {currentToken.length} characters
            </p>
          )}
        </div>

        {/* Notification Content */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Notification Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter notification title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Notification Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter notification message"
              rows={3}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2">
          <Button
            onClick={handleSendNotification}
            disabled={loading || !title || !message}
            className="w-full"
          >
            {loading ? "Sending..." : "Send Test Notification (To Self)"}
          </Button>

          <Button
            onClick={handleSendToAdmins}
            disabled={loading || !title || !message}
            variant="secondary"
            className="w-full"
          >
            {loading ? "Sending..." : "Send to All Admins"}
          </Button>
        </div>

        {/* Instructions */}
        <div className="rounded-lg bg-muted p-4 space-y-2">
          <h4 className="font-semibold text-sm">Testing Instructions:</h4>
          <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
            <li>
              <strong>Foreground:</strong> Keep this tab active and click &quot;Send
              Test Notification&quot;
            </li>
            <li>
              <strong>Background:</strong> Minimize or switch tabs, then click
              the button
            </li>
            <li>
              Check browser DevTools &rarr; Application &rarr; Service Workers to verify
              registration
            </li>
            <li>Check browser DevTools &rarr; Console for detailed logs</li>
          </ul>
        </div>

        {/* Notification Logs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Bildirim Logları</h4>
            <Button
              onClick={fetchLogs}
              variant="outline"
              size="sm"
              disabled={loadingLogs}
            >
              {loadingLogs ? "Yükleniyor..." : "Logları Getir"}
            </Button>
          </div>

          {logs.length > 0 && (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`rounded-lg border p-3 text-xs space-y-1 ${
                    log.status === "sent"
                      ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
                      : log.status === "error" || log.status === "failed"
                      ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
                      : log.status === "no_tokens"
                      ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
                      : "border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{log.title || log.type}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        log.status === "sent"
                          ? "bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200"
                          : log.status === "error" || log.status === "failed"
                          ? "bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200"
                          : log.status === "no_tokens"
                          ? "bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200"
                          : "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                      }`}
                    >
                      {log.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    Kanal: {log.channel} | Hedef: {log.targets?.join(", ")} | Token: {log.tokensMatched} | Basarili: {log.successCount} | Basarisiz: {log.failureCount}
                    {log.staleTokensRemoved ? ` | Temizlenen: ${log.staleTokensRemoved}` : ""}
                  </div>
                  {log.errors && log.errors.length > 0 && (
                    <div className="text-red-600 dark:text-red-400 mt-1">
                      {log.errors.map((err, i) => (
                        <div key={i}>{err}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {logs.length === 0 && !loadingLogs && (
            <p className="text-xs text-muted-foreground">
              Henuz log yok. &quot;Logları Getir&quot; butonuna tıklayın.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
