'use client';

import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import ShiftSchedulePanel from '@/components/nobet/ShiftSchedulePanel';
import type { Hospital, User } from '@/lib/types';

export default function NobetYonetimiPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [hospitalsSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'users'))
        ]);

        setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Hospital));
        setUsers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }) as User));
      } catch (error) {
        console.error('Data fetch error:', error);
        toast({
          title: 'Hata',
          description: 'Veriler yüklenirken bir hata oluştu.',
          variant: 'destructive'
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-lg">Nöbet Yönetimi Yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="h-full min-h-screen">
      <ShiftSchedulePanel
        hospitals={hospitals}
        users={users}
        onBack={() => router.push('/cihaz-yonetimi-ana')}
      />
    </div>
  );
}
