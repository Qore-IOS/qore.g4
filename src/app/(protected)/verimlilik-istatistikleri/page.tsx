'use client';
import React from 'react';
import VerimlilikIstatistikleriPanel from '@/components/verimlilik-istatistikleri-panel';
import { useDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';
import BackButton from '@/components/BackButton';

export default function VerimlilikIstatistikleriPage() {
    const { 
        hospitals,
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
        <div className="p-4 space-y-4">
            <BackButton fallback="/verimlilik-hesaplama" />
            <VerimlilikIstatistikleriPanel
                hospitals={hospitals}
                efficiencyHistoryRecords={efficiencyHistoryRecords}
            />
        </div>
    );
}
