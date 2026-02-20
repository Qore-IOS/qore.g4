'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Hospital, Device, AssignedDevice } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Settings,
  Wrench,
  ShieldAlert,
  FlaskConical,
  Users,
  BarChart3,
  Sparkles,
  CalendarClock,
  Building2,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from "@/hooks/use-toast";
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import QoreAIPanel from '@/components/QoreAIPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const ModernButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button> & {icon?: React.ElementType}>(
  ({ className, children, icon: Icon, ...props }, ref) => (
    <Button
      ref={ref}
      className={cn(
        "cihaz-card cihaz-focus-ring h-auto min-h-[120px] sm:min-h-[132px] p-4 sm:p-5 text-sm sm:text-base font-headline rounded-2xl transition-all duration-200 ease-in-out whitespace-normal text-center",
        "text-[var(--dashboard-text)] hover:-translate-y-0.5 hover:shadow-[var(--dashboard-raised)]",
        className
      )}
      {...props}
    >
      <div className="flex flex-col items-center justify-center gap-3 leading-tight">
        {Icon && <Icon className="h-8 w-8 sm:h-9 sm:w-9 text-amber-500 shrink-0" />}
        <span className="max-w-full break-words">{children}</span>
      </div>
    </Button>
  )
);
ModernButton.displayName = "ModernButton";


export default function CihazYonetimiHost() {
  const [isLoading, setIsLoading] = useState(true);
  const [isQoreAIPanelOpen, setIsQoreAIPanelOpen] = useState(false);
  const [isDefinitionsModalOpen, setIsDefinitionsModalOpen] = useState(false);
  const [isAnalysesModalOpen, setIsAnalysesModalOpen] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const { isAdmin, currentUserProfile } = useAuth();

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

  const rolePrimaryAction = currentUserProfile?.role === 'aplikasyon'
    ? {
        label: 'Aplikasyon',
        icon: FlaskConical,
        href: '/aplikasyon-paneli',
      }
    : {
        label: 'Teknik Servis',
        icon: Wrench,
        href: '/teknik-servis',
      };

  const definitionActions = [
    { label: 'Cihaz Modelleri', icon: Settings, href: '/cihaz-tanimlamalari' },
    { label: 'Arıza Tanımlamaları', icon: ShieldAlert, href: '/ariza-tanimlamalari' },
  ];

  const analysisActions = [
    { label: 'Arıza İstatistikleri', icon: BarChart3, href: '/ariza-yonetimi/istatistikler' },
    ...(isAdmin ? [{ label: 'Personel İzlem', icon: Users, href: '/personel-izlem' }] : []),
    { label: 'Yedek Parça Analizi', icon: Package, href: '/yedek-parca-analizi' },
    { label: 'Kurum Ziyaret Analizi', icon: Building2, href: '/kurum-ziyaret-analizi' },
  ];

  const MainMenu = () => (
     <div className="cihaz-shell flex flex-col items-center justify-center min-h-full p-4 sm:p-8">
      <Card className={cn(
        "cihaz-card-strong w-full max-w-6xl p-4 sm:p-8 rounded-3xl relative"
      )}>
        {/* Qore AI Button - Top Right */}
        <Button
          variant="outline"
          onClick={() => setIsQoreAIPanelOpen(true)}
          className="cihaz-focus-ring absolute top-4 right-4 gap-2 bg-white/70 hover:bg-white border-[var(--dashboard-stroke)] text-[var(--dashboard-text)]"
        >
          <Sparkles className="h-4 w-4 text-purple-500" />
          Qore AI
        </Button>
        <CardHeader className="text-center mb-8">
          <CardTitle className="text-2xl sm:text-3xl font-headline text-[var(--dashboard-text)]">Cihaz Yönetim Merkezi</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5">
          <ModernButton onClick={() => router.push(rolePrimaryAction.href)} icon={rolePrimaryAction.icon}>
            {rolePrimaryAction.label}
          </ModernButton>
          <ModernButton onClick={() => router.push('/ariza-yonetimi')} icon={ShieldAlert}>
            Tüm Arızalar
          </ModernButton>
          <ModernButton onClick={() => router.push('/nobet-yonetimi')} icon={CalendarClock}>
            Nöbet Vardiyası
          </ModernButton>
        </CardContent>
        <div className="mt-4 sm:mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5">
          <ModernButton
            className="min-h-[100px] sm:min-h-[112px]"
            onClick={() => setIsDefinitionsModalOpen(true)}
            icon={Settings}
          >
            Tanımlamalar
          </ModernButton>
          <ModernButton
            className="min-h-[100px] sm:min-h-[112px]"
            onClick={() => setIsAnalysesModalOpen(true)}
            icon={BarChart3}
          >
            Analizler
          </ModernButton>
        </div>
        <div className="h-32 sm:h-40" />
      </Card>
    </div>
  );

  return (
    <>
      <MainMenu />
      <Dialog open={isDefinitionsModalOpen} onOpenChange={setIsDefinitionsModalOpen}>
        <DialogContent className="cihaz-card-strong border-[var(--dashboard-stroke)] bg-[var(--dashboard-card)] text-[var(--dashboard-text)] max-w-md">
          <DialogHeader>
            <DialogTitle>Tanımlamalar</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 mt-2">
            {definitionActions.map((item) => (
              <Button
                key={item.label}
                variant="outline"
                className="cihaz-focus-ring justify-start gap-2 border-[var(--dashboard-stroke)] bg-white/70 hover:bg-white text-[var(--dashboard-text)]"
                onClick={() => {
                  setIsDefinitionsModalOpen(false);
                  router.push(item.href);
                }}
              >
                <item.icon className="h-4 w-4 text-amber-500" />
                {item.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAnalysesModalOpen} onOpenChange={setIsAnalysesModalOpen}>
        <DialogContent className="cihaz-card-strong border-[var(--dashboard-stroke)] bg-[var(--dashboard-card)] text-[var(--dashboard-text)] max-w-md">
          <DialogHeader>
            <DialogTitle>Analizler</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 mt-2">
            {analysisActions.map((item) => (
              <Button
                key={item.label}
                variant="outline"
                className="cihaz-focus-ring justify-start gap-2 border-[var(--dashboard-stroke)] bg-white/70 hover:bg-white text-[var(--dashboard-text)]"
                onClick={() => {
                  setIsAnalysesModalOpen(false);
                  router.push(item.href);
                }}
              >
                <item.icon className="h-4 w-4 text-amber-500" />
                {item.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <QoreAIPanel open={isQoreAIPanelOpen} onClose={() => setIsQoreAIPanelOpen(false)} />
    </>
  );
}
