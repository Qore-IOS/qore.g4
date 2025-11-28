"use client";

import NotificationTester from "@/components/NotificationTester";

export default function TestNotificationsPage() {
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Test Push Notifications</h1>
      <NotificationTester />
    </div>
  );
}
