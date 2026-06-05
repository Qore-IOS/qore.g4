'use client';

import React from 'react';
import AppLayout from '@/components/app-layout';
import { RouteObserver } from '@/components/RouteObserver';
import { AIProvider } from '@/contexts/ai-context';
import { AIChatbot } from '@/components/ai/AIChatbot';
import { StartMenuProvider } from '@/contexts/start-menu-context';
import { StartMenu } from '@/components/start-menu/StartMenu';

export default function ProtectedPagesLayout({ children }: { children: React.ReactNode }) {
    // This layout wraps all pages that require authentication.
    return (
        <AIProvider>
            <StartMenuProvider>
                <AppLayout>
                    <RouteObserver />
                    {children}
                </AppLayout>
                <StartMenu />
            </StartMenuProvider>
            <AIChatbot />
        </AIProvider>
    );
}
