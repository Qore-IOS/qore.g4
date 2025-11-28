"use client";

import { useState } from "react";
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
import { app } from "@/lib/firebase";

export default function NotificationTester() {
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  const [title, setTitle] = useState("Test Notification");
  const [message, setMessage] = useState("This is a test notification");
  const [loading, setLoading] = useState(false);
  const [currentToken, setCurrentToken] = useState<string>("");

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
              <strong>Foreground:</strong> Keep this tab active and click "Send
              Test Notification"
            </li>
            <li>
              <strong>Background:</strong> Minimize or switch tabs, then click
              the button
            </li>
            <li>
              Check browser DevTools → Application → Service Workers to verify
              registration
            </li>
            <li>Check browser DevTools → Console for detailed logs</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
