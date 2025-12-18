'use client';

import React from 'react';
import TotalDashboardPanel from '@/components/total-dashboard-panel';
import { useLightDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';

export default function TotalDashboardPage() {
  const { hospitals, isLoading } = useLightDashboardData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <TotalDashboardPanel
      hospitals={hospitals}
    />
  );
}
