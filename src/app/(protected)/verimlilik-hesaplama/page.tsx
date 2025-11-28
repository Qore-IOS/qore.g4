'use client';
import VerimlilikHesaplamaPanel from '@/components/verimlilik-hesaplama-panel';
import { useDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';

export default function VerimlilikHesaplamaPage() {
    const {
        hospitals,
        productCodes,
        tuketimKayitlari,
        cihazUstuGecmisi,
        kumulatifRaporlar,
        labPools,
        allMinMaxRules,
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
        <VerimlilikHesaplamaPanel
            hospitals={hospitals}
            productCodes={productCodes}
            tuketimKayitlari={tuketimKayitlari}
            cihazUstuGecmisi={cihazUstuGecmisi}
            kumulatifRaporlar={kumulatifRaporlar}
            labPools={labPools} 
            allMinMaxRules={allMinMaxRules}
        />
    );
}
