'use client';
import { Suspense } from 'react';
import SiparislerPanel from '@/components/siparisler-panel';

export default function SiparislerPage() {
    // useSearchParams (panel içinde, ?tab= okuması için) bir Suspense sınırı ister.
    return (
        <Suspense fallback={null}>
            <SiparislerPanel />
        </Suspense>
    );
}
