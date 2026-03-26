'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Hospital, Device, AssignedDevice, DeviceLabPool } from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import TeknikServisPanel from '@/components/teknik-servis-panel';
import { Loader2 } from 'lucide-react';
import { filterByCompanyScope } from '@/lib/company-scope';

export default function TeknikServisPage() {
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { currentUserProfile, isSuperAdmin, currentCompanyId } = useAuth();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitalDeviceAssignments, setHospitalDeviceAssignments] = useState<AssignedDevice[]>([]);
  const [deviceLabPools, setDeviceLabPools] = useState<DeviceLabPool[]>([]);

  const fetchAllApplicationData = useCallback(async () => {
    setIsLoading(true);
    try {
      const unsubHospitals = onSnapshot(
        query(collection(db, 'hospitals'), orderBy('name', 'asc')),
        (snap) => setHospitals(filterByCompanyScope(
          snap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)),
          currentCompanyId,
          isSuperAdmin
        )),
        (err) => {
          console.error("Hospitals listener error:", err);
          toast({ title: 'Veri Hatası', description: 'Hastaneler yüklenemedi.', variant: 'destructive' });
        }
      );

      const unsubDevices = onSnapshot(
        collection(db, 'devices'),
        (snap) => setDevices(filterByCompanyScope(
          snap.docs.map(d => ({ id: d.id, ...d.data() } as Device)),
          currentCompanyId,
          isSuperAdmin
        )),
        (err) => {
          console.error("Devices listener error:", err);
          toast({ title: 'Veri Hatası', description: 'Cihazlar yüklenemedi.', variant: 'destructive' });
        }
      );

      const unsubAssignments = onSnapshot(
        collection(db, 'hospitalDeviceAssignments'),
        (snap) => {
          setHospitalDeviceAssignments(filterByCompanyScope(
            snap.docs.map(d => ({ id: d.id, ...d.data() } as AssignedDevice)),
            currentCompanyId,
            isSuperAdmin
          ));
        },
        (err) => {
          console.error("Assignments listener error:", err);
          toast({ title: 'Veri Hatası', description: 'Cihaz atamaları yüklenemedi.', variant: 'destructive' });
        }
      );

      // Fetch active device lab pools
      const unsubLabPools = onSnapshot(
        query(collection(db, 'deviceLabPools'), where('active', '==', true)),
        (snap) => {
          setDeviceLabPools(filterByCompanyScope(
            snap.docs.map(d => ({ id: d.id, ...d.data() } as DeviceLabPool)),
            currentCompanyId,
            isSuperAdmin
          ));
          setIsLoading(false);
        },
        (err) => {
          console.error("Lab pools listener error:", err);
          setIsLoading(false);
        }
      );

      return () => {
        unsubHospitals();
        unsubDevices();
        unsubAssignments();
        unsubLabPools();
      };
    } catch (error) {
      console.error("Error setting up listeners:", error);
      toast({ title: 'Kurulum Hatası', description: 'Veri dinleyicileri kurulamadı.', variant: 'destructive' });
      setIsLoading(false);
      return () => {};
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    const cleanupPromise = fetchAllApplicationData();
    return () => {
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [fetchAllApplicationData]);


  if (isLoading) {
    return (
      <div className="cihaz-shell flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
          <p className="text-sm text-[var(--dashboard-muted)]">Teknik Servis Paneli yükleniyor&hellip;</p>
        </div>
      </div>
    );
  }

  const commonProps = {
    hospitals,
    devices,
    setDevices,
    hospitalDeviceAssignments,
    labPools: deviceLabPools,
    userAssignedLabs: currentUserProfile?.assignedLaboratories || [],
    userRole: currentUserProfile?.role || '',
    toast,
    setSubView: () => {}, // No subviews in this dedicated page
    fetchAllApplicationData: async () => { await fetchAllApplicationData(); }, // Provide a compatible function
  };

  return <TeknikServisPanel {...commonProps} />;
}
