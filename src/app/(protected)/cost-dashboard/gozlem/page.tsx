
'use client';
import React from 'react';
import CostDashboardPanel from '@/components/cost-dashboard-panel';
import { useProductCodes, useAllDepoStok, useRecentConsumption } from '@/hooks/useFirebaseQueries';
import { Loader2 } from 'lucide-react';

export default function CostGozlemPage() {
    const productsQuery = useProductCodes();
    const depoStokQuery = useAllDepoStok();
    const consumptionQuery = useRecentConsumption(500);

    const isLoading = productsQuery.isLoading || depoStokQuery.isLoading;

    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
            </div>
        );
    }

    return (
        <CostDashboardPanel
            productCodes={productsQuery.data ?? []}
            depoStok={depoStokQuery.data ?? []}
            tuketimKayitlari={consumptionQuery.data ?? []}
        />
    );
}
