/**
 * @fileoverview Total Dashboard Page
 * @description Page wrapper for the Total Dashboard Panel component.
 * @module app/total-dashboard/page
 */

'use client';

import React from 'react';
import TotalDashboardPanel from '@/components/total-dashboard-panel';
import { useLightDashboardData } from '@/components/dashboard/useDashboardData';
import { Loader2 } from 'lucide-react';

export default function TotalDashboardPage() {
  const { hospitals, isLoading } = useLightDashboardData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-label="Yükleniyor">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="sr-only">Total Dashboard yükleniyor...</span>
      </div>
    );
  }

  return (
    <TotalDashboardPanel
      hospitals={hospitals}
    />
  );
}
