
'use client';
import React from 'react';
import CostDashboardPanel from '@/components/cost-dashboard-panel';
import { useDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';

export default function CostDashboardPage() {
    const { 
        productCodes,
        depoStok,
        tuketimKayitlari,
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
        <CostDashboardPanel
            productCodes={productCodes}
            depoStok={depoStok}
            tuketimKayitlari={tuketimKayitlari}
        />
    );
}
