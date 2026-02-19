'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Hospital, Device, AssignedDevice, CihazYonetimiSubView } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings, Wrench, ShieldAlert, FileCode, FlaskConical, Users, BarChart3, Sparkles, CalendarClock, Building2, Package, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from "@/hooks/use-toast";
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import QoreAIPanel from '@/components/QoreAIPanel';

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
  const [subView, setSubView] = useState<CihazYonetimiSubView>('ana');
  const [isLoading, setIsLoading] = useState(true);
  const [isQoreAIPanelOpen, setIsQoreAIPanelOpen] = useState(false);
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

  const commonProps = { hospitals, devices, setDevices, hospitalDeviceAssignments, setHospitalDeviceAssignments, toast, setSubView, fetchAllApplicationData };

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
        <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          {currentUserProfile?.role !== 'aplikasyon' && (
            <ModernButton onClick={() => router.push('/teknik-servis')} icon={Wrench}>
              Teknik Servis
            </ModernButton>
          )}
          {currentUserProfile?.role !== 'teknik_servis' && (
            <ModernButton onClick={() => router.push('/aplikasyon-paneli')} icon={FlaskConical}>
              Aplikasyon
            </ModernButton>
          )}
          <ModernButton onClick={() => router.push('/ariza-yonetimi')} icon={ShieldAlert}>
            Tüm Arızalar
          </ModernButton>
          <ModernButton onClick={() => router.push('/nobet-yonetimi')} icon={CalendarClock}>
            Nöbet Vardiyası
          </ModernButton>
        </CardContent>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            {[
              { label: 'Cihaz Modelleri', icon: Settings, href: '/cihaz-tanimlamalari' },
              { label: 'Arıza Tanımlamaları', icon: ShieldAlert, href: '/ariza-tanimlamalari' },
              { label: 'Arıza İstatistikleri', icon: BarChart3, href: '/ariza-yonetimi/istatistikler' },
              { label: 'HTML Raporu', icon: FileCode, href: '/raporlama/ariza-raporu', external: true },
              ...(isAdmin ? [{ label: 'Personel İzlem', icon: Users, href: '/personel-izlem' }] : []),
              { label: 'Kurum Ziyaret Analizi', icon: Building2, href: '/kurum-ziyaret-analizi' },
              { label: 'Yedek Parça Analizi', icon: Package, href: '/yedek-parca-analizi' },
            ].map((item) => (
              <Button
                key={item.label}
                variant="ghost"
                className="cihaz-card cihaz-focus-ring h-auto justify-between px-4 py-3 text-[var(--dashboard-text)] hover:bg-white"
                onClick={() => item.external ? window.open(item.href, '_blank') : router.push(item.href)}
              >
                <span className="flex items-center gap-2 text-sm sm:text-base">
                  <item.icon className="h-4 w-4 text-amber-500" />
                  {item.label}
                </span>
                <ChevronRight className="h-4 w-4 text-[var(--dashboard-muted)]" />
              </Button>
            ))}
        </div>
      </Card>
    </div>
  );

  return (
    <>
      <MainMenu />
      <QoreAIPanel open={isQoreAIPanelOpen} onClose={() => setIsQoreAIPanelOpen(false)} />
    </>
  );
}
