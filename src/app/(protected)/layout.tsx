'use client';

import React from 'react';
import AppLayout from '@/components/app-layout';
import { RouteObserver } from '@/components/RouteObserver';

export default function ProtectedPagesLayout({ children }: { children: React.ReactNode }) {
    // This layout wraps all pages that require authentication.
    // The AppLayout component contains the main UI shell with navigation etc.
    return (
        <AppLayout>
            <RouteObserver />
            {children}
        </AppLayout>
    );
}
