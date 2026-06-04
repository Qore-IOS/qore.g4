'use client';

import React from 'react';
import AppLayout from '@/components/app-layout';
import { RouteObserver } from '@/components/RouteObserver';
import { AIProvider } from '@/contexts/ai-context';
import { AIChatbot } from '@/components/ai/AIChatbot';
import { StartMenuProvider } from '@/contexts/start-menu-context';
import { StartMenu } from '@/components/start-menu/StartMenu';
import { WindowManagerProvider, useIsWindowMode } from '@/contexts/window-manager-context';
import { WindowHost } from '@/components/window/WindowHost';
import { WindowChrome } from '@/components/window/WindowChrome';

function ProtectedShell({ children }: { children: React.ReactNode }) {
    // İframe pencere içinde (çıplak mod) çalışırken kabuk öğelerini (üst butonlar,
    // start menü, AI, pencere host'u) gösterme — yalnızca panel içeriği.
    const bare = useIsWindowMode();
    return (
        <StartMenuProvider>
            <AIProvider>
                <AppLayout>
                    <RouteObserver />
                    {children}
                </AppLayout>
                {!bare && <AIChatbot />}
                {!bare && <StartMenu />}
                {!bare && <WindowChrome />}
                {!bare && <WindowHost />}
            </AIProvider>
        </StartMenuProvider>
    );
}

export default function ProtectedPagesLayout({ children }: { children: React.ReactNode }) {
    // This layout wraps all pages that require authentication.
    return (
        <WindowManagerProvider>
            <ProtectedShell>{children}</ProtectedShell>
        </WindowManagerProvider>
    );
}
