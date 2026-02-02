'use client';
import React from 'react';
import TransferRaporuPanel from '@/components/transfer-raporu-panel';
import BackButton from '@/components/BackButton';

export default function TransferRaporuPage() {
  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/raporlama" />
      <TransferRaporuPanel />
    </div>
  );
}
