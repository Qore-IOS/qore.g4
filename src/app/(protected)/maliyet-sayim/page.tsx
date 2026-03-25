
'use client';
import React from 'react';
import MaliyetSayimPanel from '@/components/maliyet-sayim-panel';
import { useProductCodes, useHospitals, useDepots } from '@/hooks/useFirebaseQueries';
import { Loader2 } from 'lucide-react';

export default function MaliyetSayimPage() {
  const hospitalsQuery = useHospitals();
  const depotsQuery = useDepots();
  const productsQuery = useProductCodes();

  const isLoading = hospitalsQuery.isLoading || depotsQuery.isLoading || productsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    );
  }

  return (
    <MaliyetSayimPanel
      hospitals={hospitalsQuery.data ?? []}
      depots={depotsQuery.data ?? []}
      productCodes={productsQuery.data ?? []}
    />
  );
}
