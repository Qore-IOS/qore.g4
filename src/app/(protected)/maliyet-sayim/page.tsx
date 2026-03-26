
'use client';
import React, { Suspense } from 'react';
import MaliyetSayimPanel from '@/components/maliyet-sayim-panel';
import { useProductCodes, useHospitals, useDepots } from '@/hooks/useFirebaseQueries';
import { Loader2 } from 'lucide-react';

function MaliyetSayimContent() {
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

export default function MaliyetSayimPage() {
  return (
    <Suspense fallback={
      <div className="flex h-full w-full items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    }>
      <MaliyetSayimContent />
    </Suspense>
  );
}
