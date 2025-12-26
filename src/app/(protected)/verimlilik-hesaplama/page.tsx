'use client';
import VerimlilikHesaplamaPanel from '@/components/verimlilik-hesaplama-panel';
import {
    useHospitals,
    useProductCodes,
    useRecentConsumption,
    useLabPools,
    useAllMinMaxRules
} from '@/hooks/useFirebaseQueries';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';

export default function VerimlilikHesaplamaPage() {
    const hospitalsQuery = useHospitals();
    const productsQuery = useProductCodes();
    const consumptionQuery = useRecentConsumption(500);
    const labPoolsQuery = useLabPools();

    // Get hospital IDs for min/max rules
    const hospitalIds = useMemo(
        () => (hospitalsQuery.data ?? []).map(h => h.id),
        [hospitalsQuery.data]
    );
    const minMaxRulesQuery = useAllMinMaxRules(hospitalIds);

    const isLoading = hospitalsQuery.isLoading || productsQuery.isLoading;

    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <VerimlilikHesaplamaPanel
            hospitals={hospitalsQuery.data ?? []}
            productCodes={productsQuery.data ?? []}
            tuketimKayitlari={consumptionQuery.data ?? []}
            cihazUstuGecmisi={[]}
            kumulatifRaporlar={[]}
            labPools={labPoolsQuery.data ?? []}
            allMinMaxRules={minMaxRulesQuery.data ?? {}}
        />
    );
}
