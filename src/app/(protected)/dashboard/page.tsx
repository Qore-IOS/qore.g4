
'use client';
import React from 'react';
import DashboardPanel from '@/components/dashboard-panel';
import { useDashboardData } from '@/components/dashboard/useDashboardData';
import { useSyncedLoading } from '@/hooks/useSyncedLoading';
import { Loader2 } from 'lucide-react';

export default function DashboardPage() {
    const {
        hospitals,
        productCodes,
        tuketimKayitlari,
        efficiencyHistoryRecords,
        isLoading
    } = useDashboardData();

    // Sync dashboard loading with global loader
    useSyncedLoading(isLoading);

    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <DashboardPanel
            hospitals={hospitals}
            productCodes={productCodes}
            tuketimKayitlari={tuketimKayitlari}
            efficiencyHistoryRecords={efficiencyHistoryRecords}
        />
    );
}
