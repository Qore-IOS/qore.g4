'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Hospital, Device, AssignedDevice } from '@/lib/types';
import { useToast } from "@/hooks/use-toast";
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import TeknikServisPanel from '@/components/teknik-servis-panel';
import { Loader2 } from 'lucide-react';

export default function TeknikServisPage() {
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitalDeviceAssignments, setHospitalDeviceAssignments] = useState<AssignedDevice[]>([]);

  const fetchAllApplicationData = useCallback(async () => {
    setIsLoading(true);
    try {
      const unsubHospitals = onSnapshot(
        query(collection(db, 'hospitals'), orderBy('name', 'asc')),
        (snap) => setHospitals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital))),
        (err) => {
          console.error("Hospitals listener error:", err);
          toast({ title: 'Veri Hatası', description: 'Hastaneler yüklenemedi.', variant: 'destructive' });
        }
      );

      const unsubDevices = onSnapshot(
        collection(db, 'devices'),
        (snap) => setDevices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Device))),
        (err) => {
          console.error("Devices listener error:", err);
          toast({ title: 'Veri Hatası', description: 'Cihazlar yüklenemedi.', variant: 'destructive' });
        }
      );
      
      const unsubAssignments = onSnapshot(
        collection(db, 'hospitalDeviceAssignments'),
        (snap) => {
          setHospitalDeviceAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() } as AssignedDevice)));
          setIsLoading(false); // Mark loading as false after the last listener is attached and has fired once
        },
        (err) => {
          console.error("Assignments listener error:", err);
          toast({ title: 'Veri Hatası', description: 'Cihaz atamaları yüklenemedi.', variant: 'destructive' });
          setIsLoading(false);
        }
      );

      return () => {
        unsubHospitals();
        unsubDevices();
        unsubAssignments();
      };
    } catch (error) {
      console.error("Error setting up listeners:", error);
      toast({ title: 'Kurulum Hatası', description: 'Veri dinleyicileri kurulamadı.', variant: 'destructive' });
      setIsLoading(false);
      return () => {};
    }
  }, [toast]);

  useEffect(() => {
    const cleanupPromise = fetchAllApplicationData();
    return () => {
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [fetchAllApplicationData]);


  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-4 text-lg">Teknik Servis Paneli Yükleniyor...</p></div>
  }

  const commonProps = {
    hospitals,
    devices,
    setDevices,
    hospitalDeviceAssignments,
    toast,
    setSubView: () => {}, // No subviews in this dedicated page
    fetchAllApplicationData: () => fetchAllApplicationData().then(c => c), // Provide a compatible function
  };

  return <TeknikServisPanel {...commonProps} />;
}
