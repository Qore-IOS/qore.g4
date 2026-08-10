'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { filterByCompanyScope } from '@/lib/company-scope';
import { ACTIVE_DEVICE_FAULT_STATUSES } from '@/lib/device-faults';
import type { DeviceFaultReport } from '@/lib/types';
import { scopedQuery } from '@/lib/firestore-helpers';

export function useRealtimeOpenDeviceFaultReports(): DeviceFaultReport[] {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [faults, setFaults] = useState<DeviceFaultReport[]>([]);

  useEffect(() => {
    const faultsQuery = query(
      scopedQuery('deviceFaultReports', currentCompanyId, isSuperAdmin),
      where('status', 'in', [...ACTIVE_DEVICE_FAULT_STATUSES]),
    );

    return onSnapshot(
      faultsQuery,
      (snapshot) => {
        const reports = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        } as DeviceFaultReport));

        setFaults(filterByCompanyScope(reports, currentCompanyId, isSuperAdmin));
      },
      (error) => {
        console.error('Aktif cihaz arızaları gerçek zamanlı dinlenemedi:', error);
        setFaults([]);
      },
    );
  }, [currentCompanyId, isSuperAdmin]);

  return faults;
}
