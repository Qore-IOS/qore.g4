'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

const UrunKullanimDogrulamaPanel = dynamic(
  () => import('@/components/urun-kullanim-dogrulama-panel'),
  { 
    ssr: false,
    loading: () => (
      <div className="flex justify-center items-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }
);

export default function UrunKullanimDogrulamaPage() {
  return (
    <div className="container mx-auto p-4">
      <UrunKullanimDogrulamaPanel />
    </div>
  );
}
