
'use client';
import React from 'react';
import SearchManager from '@/components/SearchManager';
import { useDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';

export default function AramaPage() {
    const {
        productCodes,
        depoStok,
        tuketimKayitlari,
        shipments,
        depots,
        isLoading
    } = useDashboardData();

    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="ml-2">Arama motoru verileri yükleniyor...</span>
            </div>
        );
    }

    return (
        <SearchManager
            productCodes={productCodes}
            depoStok={depoStok}
            tuketimKayitlari={tuketimKayitlari}
            shipments={shipments}
            depots={depots}
        />
    );
}
