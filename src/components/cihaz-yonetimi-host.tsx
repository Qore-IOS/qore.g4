'use client';
import React, { useState, useEffect, useCallback } from 'react';
import type { Hospital, Device, AssignedDevice } from '@/lib/types';
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
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from "@/hooks/use-toast";
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import QoreAIPanel from '@/components/QoreAIPanel';

/* ─── Reusable sub-components ─── */

interface ActionTileProps {
  icon: React.ElementType;
  label: string;
  description?: string;
  onClick: () => void;
  className?: string;
}

function ActionTile({ icon: Icon, label, description, onClick, className }: ActionTileProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'cihaz-action-tile cihaz-focus-ring flex flex-col items-center justify-center gap-2.5 p-5 sm:p-6 text-center w-full',
        className
      )}
    >
      <span className="flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
        <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-[var(--dashboard-accent)]" />
      </span>
      <span className="text-[15px] sm:text-base font-semibold text-[var(--dashboard-text)] leading-snug">
        {label}
      </span>
      {description && (
        <span className="text-xs text-[var(--dashboard-muted)] leading-tight">
          {description}
        </span>
      )}
    </button>
  );
}

interface ToolItemProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}

function ToolItem({ icon: Icon, label, onClick }: ToolItemProps) {
  return (
    <button
      onClick={onClick}
      className="cihaz-tool-item cihaz-focus-ring flex items-center gap-3 px-4 py-3 sm:py-3.5 w-full text-left"
    >
      <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] shrink-0">
        <Icon className="h-4 w-4 text-[var(--dashboard-accent)]" />
      </span>
      <span className="text-sm font-medium text-[var(--dashboard-text)] flex-1">
        {label}
      </span>
      <ChevronRight className="h-4 w-4 text-[var(--dashboard-muted)] shrink-0" />
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <span className="cihaz-section-label">{children}</span>
      <span className="flex-1 h-px bg-[var(--dashboard-stroke)]" />
    </div>
  );
}

/* ─── Main component ─── */

export default function CihazYonetimiHost() {
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
      setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Hospital));
      setDevices(devicesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Device));
      setHospitalDeviceAssignments(assignmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as AssignedDevice));
    } catch (error) {
      console.error("Device management data fetch error:", error);
      toast({ title: "Veri Hatası", description: "Cihaz yönetimi verileri yüklenemedi.", variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAllApplicationData();
  }, [fetchAllApplicationData]);

  /* ── Role-based primary action ── */
  const rolePrimaryAction = currentUserProfile?.role === 'aplikasyon'
    ? { label: 'Aplikasyon', description: 'Aplikasyon paneli', icon: FlaskConical, href: '/aplikasyon-paneli' }
    : { label: 'Teknik Servis', description: 'Servis paneli', icon: Wrench, href: '/teknik-servis' };

  /* ── Quick stats from loaded data ── */
  const totalHospitals = hospitals.length;
  const totalDevices = devices.length;
  const totalAssignments = hospitalDeviceAssignments.length;

  /* ── Tool / secondary action lists ── */
  const definitionTools = [
    { label: 'Cihaz Modelleri', icon: Settings, href: '/cihaz-tanimlamalari' },
    { label: 'Arıza Tanımlamaları', icon: ShieldAlert, href: '/ariza-tanimlamalari' },
  ];

  const analysisTools = [
    { label: 'Arıza İstatistikleri', icon: BarChart3, href: '/ariza-yonetimi/istatistikler' },
    ...(isAdmin ? [{ label: 'Personel İzlem', icon: Users, href: '/personel-izlem' }] : []),
    { label: 'Yedek Parça Analizi', icon: Package, href: '/yedek-parca-analizi' },
    { label: 'Kurum Ziyaret Analizi', icon: Building2, href: '/kurum-ziyaret-analizi' },
  ];

  /* ── Loading state ── */
  if (isLoading) {
    return (
      <div className="cihaz-shell flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="custom-loader" />
          <p className="text-sm text-[var(--dashboard-muted)]">Yükleniyor&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="cihaz-shell flex flex-col items-center px-4 py-6 sm:px-8 sm:py-10">
        {/* ── Container card ── */}
        <div className="cihaz-card-strong w-full max-w-2xl lg:max-w-4xl p-5 sm:p-8 relative">

          {/* ── Header row ── */}
          <div className="flex items-start justify-between mb-6 sm:mb-8">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)] leading-tight tracking-tight">
                Cihaz Yönetim Merkezi
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-[var(--dashboard-muted)]">
                {totalHospitals} kurum &middot; {totalDevices} model &middot; {totalAssignments} atama
              </p>
            </div>
            <button
              onClick={() => setIsQoreAIPanelOpen(true)}
              className="cihaz-tool-item cihaz-focus-ring flex items-center gap-2 px-3 py-2 text-sm shrink-0"
            >
              <Sparkles className="h-4 w-4 text-purple-500" />
              <span className="hidden sm:inline text-[var(--dashboard-text)] font-medium">Qore AI</span>
            </button>
          </div>

          {/* ── Primary actions – 2x2 mobile, 4-col desktop ── */}
          <section className="mb-6 sm:mb-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <ActionTile
                icon={rolePrimaryAction.icon}
                label={rolePrimaryAction.label}
                description={rolePrimaryAction.description}
                onClick={() => router.push(rolePrimaryAction.href)}
              />
              <ActionTile
                icon={ShieldAlert}
                label="Tüm Arızalar"
                description="Arıza yönetimi"
                onClick={() => router.push('/ariza-yonetimi')}
              />
              <ActionTile
                icon={CalendarClock}
                label="Nöbet Vardiyası"
                description="Vardiya takibi"
                onClick={() => router.push('/nobet-yonetimi')}
              />
              <ActionTile
                icon={BarChart3}
                label="Dashboard"
                description="Genel bakış"
                onClick={() => router.push('/cihaz-yonetimi/dashboard')}
              />
            </div>
          </section>

          {/* ── Definitions section ── */}
          <section className="mb-6 sm:mb-8">
            <SectionLabel>Tanımlamalar</SectionLabel>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
              {definitionTools.map((item) => (
                <ToolItem
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => router.push(item.href)}
                />
              ))}
            </div>
          </section>

          {/* ── Analysis tools section ── */}
          <section>
            <SectionLabel>Analizler</SectionLabel>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
              {analysisTools.map((item) => (
                <ToolItem
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => router.push(item.href)}
                />
              ))}
            </div>
          </section>

        </div>
      </div>

      {/* ── Qore AI Panel ── */}
      <QoreAIPanel open={isQoreAIPanelOpen} onClose={() => setIsQoreAIPanelOpen(false)} />
    </>
  );
}
