
'use client';
import React from 'react';
import DashboardPanel from '@/components/cihaz-yonetimi/dashboard/DashboardPanel';
import { useDashboardData } from '@/components/cihaz-yonetimi/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';

export default function DashboardPage() {
    const { 
        hospitals,
        devices,
        productCodes,
        depoStok,
        tuketimKayitlari,
        shipments,
        efficiencyDataRecords,
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
            efficiencyDataRecords={efficiencyDataRecords}
            minMaxRulesByLab={minMaxRulesByLab}
        />
    );
}
