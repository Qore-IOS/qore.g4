
'use client';
import StokYonetimiPanel from '@/components/stok-yonetimi-panel';
import PageShell from '@/components/responsive/PageShell.server';

export default function StokYonetimiPage() {
    return (
        <PageShell className="p-0 md:p-6">
            <StokYonetimiPanel />
        </PageShell>
    );
}

