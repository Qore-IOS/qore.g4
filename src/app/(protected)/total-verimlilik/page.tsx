'use client';

import React from 'react';
import TotalVerimlilikPanel from '@/components/total-verimlilik-panel';
import { useLightDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';

export default function TotalVerimlilikPage() {
  const { hospitals, productCodes, isLoading } = useLightDashboardData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <TotalVerimlilikPanel
      hospitals={hospitals}
      productCodes={productCodes}
    />
  );
}
