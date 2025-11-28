"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Error Boundary for Push Notifications
 *
 * Catches errors in the PushNotificationsClient component to prevent
 * the entire app from crashing if notifications fail to initialize.
 */
export class PushNotificationsErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    console.error("[Push Notifications Error Boundary] Caught error:", error);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("[Push Notifications Error Boundary] Error details:", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      // Don't render anything - just fail silently
      // The app continues to work without notifications
      console.warn(
        "[Push Notifications Error Boundary] Push notifications failed to initialize, but app continues to work"
      );
      return null;
    }

    return this.props.children;
  }
}
