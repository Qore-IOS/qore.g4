'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Hospital, Device, AssignedDevice, CihazYonetimiSubView } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings, Server, Wrench, Loader2, History, ShieldAlert, FileCode, FlaskConical, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from "@/hooks/use-toast";
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

const ModernButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button> & {icon?: React.ElementType}>(
  ({ className, children, icon: Icon, ...props }, ref) => (
    <Button
      ref={ref}
      className={cn(
        "h-auto p-8 text-lg font-headline rounded-xl transition-all duration-200 ease-in-out",
        "bg-card text-card-foreground hover:bg-accent/10 hover:text-accent-foreground",
        "shadow-lg hover:shadow-xl",
        className
      )}
      {...props}
    >
      <div className="flex flex-col items-center justify-center">
        {Icon && <Icon className="h-12 w-12 mb-3 text-primary" />}
        {children}
      </div>
    </Button>
  )
);
ModernButton.displayName = "ModernButton";


export default function CihazYonetimiHost() {
  const [subView, setSubView] = useState<CihazYonetimiSubView>('ana');
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const router = useRouter();
  const { isAdmin } = useAuth();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitalDeviceAssignments, setHospitalDeviceAssignments] = useState<AssignedDevice[]>([]);

  const fetchAllApplicationData = useCallback(async () => {
    setIsLoading(true);
    try {
        const [hospitalsSnap, devicesSnap, assignmentsSnap] = await Promise.all([
            getDocs(collection(db, 'hospitals')),
            getDocs(collection(db, 'devices')),
            getDocs(collection(db, 'hospitalDeviceAssignments'))
        ]);
        
        setHospitals(hospitalsSnap.docs.map(d => ({id: d.id, ...d.data()}) as Hospital));
        setDevices(devicesSnap.docs.map(d => ({id: d.id, ...d.data()}) as Device));
        setHospitalDeviceAssignments(assignmentsSnap.docs.map(d => ({id: d.id, ...d.data()}) as AssignedDevice));
    } catch (error) {
        console.error("Device management data fetch error:", error);
        toast({ title: "Veri Hatası", description: "Cihaz yönetimi verileri yüklenemedi.", variant: 'destructive'});
    } finally {
        setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAllApplicationData();
  }, [fetchAllApplicationData]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><div className="custom-loader" /><p className="ml-4 text-lg">Cihaz Yönetim Paneli Yükleniyor...</p></div>
  }

  const commonProps = { hospitals, devices, setDevices, hospitalDeviceAssignments, setHospitalDeviceAssignments, toast, setSubView, fetchAllApplicationData };

  const MainMenu = () => (
     <div className="flex flex-col items-center justify-center min-h-full p-4 sm:p-8">
      <Card className={cn(
        "w-full max-w-4xl p-6 sm:p-10 rounded-3xl",
        "shadow-2xl"
      )}>
        <CardHeader className="text-center mb-8">
          <CardTitle className="text-3xl sm:text-4xl font-headline text-primary">Cihaz Yönetim Merkezi</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-10">
          <ModernButton onClick={() => router.push('/teknik-servis')} icon={Wrench}>
            Teknik Servis
          </ModernButton>
          <ModernButton onClick={() => router.push('/aplikasyon-paneli')} icon={FlaskConical}>
            Aplikasyon
          </ModernButton>
          <ModernButton onClick={() => router.push('/ariza-yonetimi')} icon={ShieldAlert}>
            Tüm Arızalar
          </ModernButton>
        </CardContent>
        <div className="mt-12 flex flex-wrap justify-center gap-4">
            <Button variant="ghost" onClick={() => router.push('/cihaz-tanimlamalari')} className="text-muted-foreground hover:text-primary">
                <Settings className="mr-2 h-5 w-5" />
                Cihaz Modelleri
            </Button>
            <Button variant="ghost" onClick={() => router.push('/ariza-tanimlamalari')} className="text-muted-foreground hover:text-primary">
                <ShieldAlert className="mr-2 h-5 w-5" />
                Arıza Tanımlamaları
            </Button>
            <Button variant="ghost" onClick={() => window.open('/raporlama/ariza-raporu', '_blank')} className="text-muted-foreground hover:text-primary">
              <FileCode className="mr-2 h-5 w-5" />
              HTML Raporu
            </Button>
            {isAdmin && (
              <Button variant="ghost" onClick={() => router.push('/personel-izlem')} className="text-muted-foreground hover:text-primary">
                <Users className="mr-2 h-5 w-5" />
                Personel İzlem
              </Button>
            )}
        </div>
      </Card>
    </div>
  );

  return <MainMenu />;
}
