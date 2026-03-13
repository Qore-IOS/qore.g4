'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { Hospital } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2 } from 'lucide-react';
import BackButton from '@/components/BackButton';

const DeviceMapPanel = dynamic(() => import('@/components/DeviceMapPanel'), { ssr: false });

export default function AplikasyonHaritaPage() {
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'hospitals'), orderBy('name', 'asc')),
      (snap) => {
        setHospitals(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Hospital));
        setIsLoading(false);
      },
      (err) => {
        console.error('Hospitals error:', err);
        toast({ title: 'Veri Hatası', description: 'Hastaneler yüklenemedi.', variant: 'destructive' });
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [toast]);

  if (isLoading) {
    return (
      <div className="cihaz-shell flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
          <p className="text-sm text-[var(--dashboard-muted)]">Harita yükleniyor&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cihaz-shell min-h-screen px-2 py-4 sm:px-6 sm:py-6">
      <div className="mb-4">
        <BackButton />
      </div>
      <DeviceMapPanel hospitals={hospitals} panelType="aplikasyon" />
    </div>
  );
}
