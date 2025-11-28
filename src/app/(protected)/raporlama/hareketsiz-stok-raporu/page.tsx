
'use client';
import React from 'react';
import HareketsizStokRaporuPanel from '@/components/hareketsiz-stok-raporu-panel';
import BackButton from '@/components/BackButton';

export default function HareketsizStokRaporuPage() {
  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/raporlama" />
      <HareketsizStokRaporuPanel />
    </div>
  );
}
