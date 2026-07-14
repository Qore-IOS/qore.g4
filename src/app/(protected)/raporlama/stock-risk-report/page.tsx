'use client';

import BackButton from '@/components/BackButton';
import StockRiskReportPanel from '@/components/stock-risk-report-panel';

export default function StockRiskReportPage() {
  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/raporlama" />
      <StockRiskReportPanel />
    </div>
  );
}
