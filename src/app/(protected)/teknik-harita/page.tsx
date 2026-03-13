'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { Hospital, AssignedDevice } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2 } from 'lucide-react';
import BackButton from '@/components/BackButton';

const DeviceMapPanel = dynamic(() => import('@/components/DeviceMapPanel'), { ssr: false });

export default function TeknikHaritaPage() {
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [assignments, setAssignments] = useState<AssignedDevice[]>([]);
  const [openFaultMap, setOpenFaultMap] = useState<Record<string, 'teknik_servis' | 'aplikasyon'>>({});

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    const unsubHospitals = onSnapshot(
      query(collection(db, 'hospitals'), orderBy('name', 'asc')),
      (snap) => setHospitals(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Hospital)),
      (err) => {
        console.error('Hospitals error:', err);
        toast({ title: 'Veri Hatası', description: 'Hastaneler yüklenemedi.', variant: 'destructive' });
      }
    );
    unsubs.push(unsubHospitals);

    const unsubAssignments = onSnapshot(
      collection(db, 'hospitalDeviceAssignments'),
      (snap) => {
        setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AssignedDevice));
        setIsLoading(false);
      },
      (err) => {
        console.error('Assignments error:', err);
        setIsLoading(false);
      }
    );
    unsubs.push(unsubAssignments);

    const unsubFaults = onSnapshot(
      query(
        collection(db, 'deviceFaultReports'),
        where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
      ),
      (snap) => {
        const map: Record<string, 'teknik_servis' | 'aplikasyon'> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.deviceId && data.faultType) {
            if (map[data.deviceId] === 'teknik_servis') return;
            map[data.deviceId] = data.faultType;
          }
        });
        setOpenFaultMap(map);
      }
    );
    unsubs.push(unsubFaults);

    return () => unsubs.forEach((u) => u());
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
      <DeviceMapPanel
        hospitals={hospitals}
        assignments={assignments}
        openFaultMap={openFaultMap}
        panelType="teknik_servis"
      />
    </div>
  );
}
