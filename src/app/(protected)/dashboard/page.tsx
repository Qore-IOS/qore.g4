
'use client';
import React from 'react';
import DashboardPanel from '@/components/dashboard-panel';
import { useDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';

export default function DashboardPage() {
    const { 
        hospitals,
        devices,
        productCodes,
        depoStok,
        tuketimKayitlari,
        shipments,
        efficiencyHistoryRecords,
        minMaxRulesByLab,
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
        <DashboardPanel
            hospitals={hospitals}
            devices={devices}
            productCodes={productCodes}
            depoStok={depoStok}
            tuketimKayitlari={tuketimKayitlari}
            shipments={shipments}
            efficiencyHistoryRecords={efficiencyHistoryRecords}
            minMaxRulesByLab={minMaxRulesByLab}
        />
    );
}
