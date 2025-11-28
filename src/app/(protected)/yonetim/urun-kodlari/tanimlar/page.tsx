'use client';
import React from 'react';
import UrunKodlariTanimlarPanel from '@/components/yonetim/urun-kodlari-tanimlar-panel';
import BackButton from '@/components/BackButton';

export default function UrunKodlariTanimlarPage() {
  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/yonetim/urun-kodlari" />
      <UrunKodlariTanimlarPanel />
    </div>
  );
}
