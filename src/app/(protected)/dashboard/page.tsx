
'use client';
import React from 'react';
import DashboardV2 from '@/components/dashboard-v2/DashboardV2';
import { useDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';

export default function DashboardPage() {
    const {
        hospitals,
        productCodes,
        tuketimKayitlari,
        efficiencyHistoryRecords,
        isLoading
    } = useDashboardData();

    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <DashboardV2
            hospitals={hospitals}
            productCodes={productCodes}
            tuketimKayitlari={tuketimKayitlari}
            efficiencyHistoryRecords={efficiencyHistoryRecords}
        />
    );
}
