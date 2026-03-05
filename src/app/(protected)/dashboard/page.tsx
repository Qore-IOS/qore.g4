
'use client';
import React from 'react';
import DashboardPanel from '@/components/dashboard-panel';
import { useDashboardData } from '@/components/dashboard/useDashboardData';

export default function DashboardPage() {
    const {
        hospitals,
        productCodes,
        tuketimKayitlari,
        efficiencyHistoryRecords,
    } = useDashboardData();

    return (
        <DashboardPanel
            hospitals={hospitals}
            productCodes={productCodes}
            tuketimKayitlari={tuketimKayitlari}
            efficiencyHistoryRecords={efficiencyHistoryRecords}
        />
    );
}
