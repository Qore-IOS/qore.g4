'use client';

import React from 'react';
import CostDashboardPanel from '@/components/cost-dashboard-panel';
import { useProductCodes } from '@/hooks/useFirebaseQueries';
import { Loader2 } from 'lucide-react';

export default function CostGozlemPage() {
  const productsQuery = useProductCodes();

  if (productsQuery.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
      </div>
    );
  }

  return <CostDashboardPanel productCodes={productsQuery.data ?? []} />;
}
