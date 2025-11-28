
'use client';
import React from 'react';
import TuketimIstatistikleriPanel from '@/components/tuketim-istatistikleri-panel';
import { useDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function TuketimIstatistikleriPage() {
    const { toast } = useToast();
    const {
        hospitals,
        productCodes,
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
        <TuketimIstatistikleriPanel
            hospitals={hospitals}
            productCodes={productCodes}
            urunKullanimKayitlari={tuketimKayitlari}
            toast={toast}
        />
    );
}
