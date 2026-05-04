'use client';
import React, { useState, useMemo, useEffect } from 'react';
import type { Hospital, Device, AssignedDevice, CihazYonetimiSubView, LabPool } from '@/lib/types';
import {
  Wrench, ArrowLeft, Layers, ChevronRight, FileText,
  Package, CalendarClock, Map as MapIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import BackButton from './BackButton';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { matchesCompanyScope } from '@/lib/company-scope';

/* ─── Types ─── */

interface TeknikServisPanelProps {
  hospitals: Hospital[];
  devices: Device[];
  setDevices: React.Dispatch<React.SetStateAction<Device[]>>;
  hospitalDeviceAssignments: AssignedDevice[];
  labPools?: LabPool[];
  userAssignedLabs?: string[];
  userRole?: string;
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
  setSubView: (view: CihazYonetimiSubView) => void;
  fetchAllApplicationData: () => Promise<void>;
}

/* ─── Reusable sub-components ─── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <span className="cihaz-section-label">{children}</span>
      <span className="flex-1 h-px bg-[var(--dashboard-stroke)]" />
    </div>
  );
}

function StatusBadge({ count, variant }: { count: number; variant: 'danger' | 'success' }) {
  const colors = variant === 'danger'
    ? 'bg-red-50 text-red-700 border-red-200/60'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200/60';
  const dotColor = variant === 'danger' ? 'bg-red-500' : 'bg-emerald-500';
  const label = variant === 'danger' ? 'Arızalı' : 'Sağlıklı';

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', colors)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dotColor)} />
      {count} {label}
    </span>
  );
}

/* ─── Main component ─── */

export default function TeknikServisPanel({
  hospitals, devices, hospitalDeviceAssignments, labPools = [], userAssignedLabs = [], userRole = ''
}: TeknikServisPanelProps) {
  const router = useRouter();
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null);
  const { currentCompanyId, isSuperAdmin } = useAuth();

  /* ── Open fault reports ── */
  const [faultyDeviceIds, setFaultyDeviceIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const q = query(
      collection(db, 'deviceFaultReports'),
      where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
    );
    const unsub = onSnapshot(q, (snap) => {
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const data = d.data();
        if (!matchesCompanyScope(data as any, currentCompanyId, isSuperAdmin)) return;
        if (data.deviceId) ids.add(data.deviceId);
      });
      setFaultyDeviceIds(ids);
    }, (err) => {
      console.error('Error listening open fault reports:', err);
    });
    return () => unsub();
  }, [currentCompanyId, isSuperAdmin]);

  /* ── Device helpers ── */

  const getDevicesForHospital = (hospitalId: string): Device[] =>
    devices.filter(d => (d as any).hospitalId === hospitalId).sort((a, b) => (Number(a.order ?? 99)) - (Number(b.order ?? 99)));

  const getDevicesForHospitals = (hospitalIds: string[]): Device[] =>
    devices.filter(d => hospitalIds.includes((d as any).hospitalId)).sort((a, b) => (Number(a.order ?? 99)) - (Number(b.order ?? 99)));

  const isAdmin = userRole === 'admin' || userRole === 'super_admin';

  const filteredHospitals = useMemo(() => {
    if (isAdmin || userAssignedLabs.length === 0) return hospitals;
    return hospitals.filter(h => userAssignedLabs.includes(h.id));
  }, [hospitals, userAssignedLabs, isAdmin]);

  /* ── Organize hospitals into pools and standalone ── */
  const { poolGroups, standaloneLabs } = useMemo(() => {
    const poolGroups: { pool: LabPool; mainLab: Hospital; memberLabs: Hospital[] }[] = [];
    const labsInPools = new Set<string>();

    for (const pool of labPools) {
      const accessibleMembers = pool.memberIds.filter(id =>
        isAdmin || userAssignedLabs.length === 0 || userAssignedLabs.includes(id)
      );
      if (accessibleMembers.length === 0) continue;

      const mainLabId = pool.mainLabId && accessibleMembers.includes(pool.mainLabId)
        ? pool.mainLabId : accessibleMembers[0];
      const mainLab = filteredHospitals.find(h => h.id === mainLabId);
      if (!mainLab) continue;

      const memberLabs = accessibleMembers
        .map(id => filteredHospitals.find(h => h.id === id))
        .filter((h): h is Hospital => h !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

      if (memberLabs.length > 0) {
        poolGroups.push({ pool, mainLab, memberLabs });
        accessibleMembers.forEach(id => labsInPools.add(id));
      }
    }

    const standaloneLabs = filteredHospitals.filter(h => !labsInPools.has(h.id));
    return { poolGroups, standaloneLabs };
  }, [filteredHospitals, labPools, userAssignedLabs, isAdmin]);

  const isDeviceFaulty = (d: Device) => faultyDeviceIds.has(d.id);

  const getHospitalStats = (hospitalId: string) => {
    const hospitalDevices = getDevicesForHospital(hospitalId);
    return { cihazSayisi: hospitalDevices.length, arizaSayisi: hospitalDevices.filter(isDeviceFaulty).length, devices: hospitalDevices };
  };

  const getPoolStats = (memberIds: string[]) => {
    const poolDevices = getDevicesForHospitals(memberIds);
    return { cihazSayisi: poolDevices.length, arizaSayisi: poolDevices.filter(isDeviceFaulty).length, devices: poolDevices };
  };

  /* ── Device status summary for a card ── */
  const DeviceStatusSummary = ({ devs }: { devs: Device[] }) => {
    if (devs.length === 0) {
      return <p className="text-xs text-[var(--dashboard-muted)] mt-2">Atanmış cihaz yok</p>;
    }
    const faultyCount = devs.filter(isDeviceFaulty).length;
    const healthyCount = devs.length - faultyCount;

    return (
      <div className="mt-3 pt-3 border-t border-[var(--dashboard-stroke)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--dashboard-muted)]">
            {devs.length} cihaz
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {faultyCount > 0 && <StatusBadge count={faultyCount} variant="danger" />}
          <StatusBadge count={healthyCount} variant="success" />
        </div>
      </div>
    );
  };

  /* ═══════════════════════════════════════════════════════
     EXPANDED POOL VIEW
     ═══════════════════════════════════════════════════════ */
  if (expandedPoolId) {
    const poolGroup = poolGroups.find(pg => pg.pool.id === expandedPoolId);
    if (!poolGroup) { setExpandedPoolId(null); return null; }

    const poolStats = getPoolStats(poolGroup.memberLabs.map(l => l.id));

    return (
      <div className="cihaz-shell px-4 py-6 sm:px-8 sm:py-10">
        <div className="max-w-5xl mx-auto space-y-5">
          {/* Back + Header */}
          <div className="cihaz-card-strong p-5 sm:p-7 bg-white/40 backdrop-blur-md border border-white/50 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
                    <Layers className="h-4.5 w-4.5 text-[var(--dashboard-accent)]" />
                  </span>
                  <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)] leading-tight">
                    {poolGroup.pool.name || poolGroup.mainLab.name}
                  </h1>
                </div>
                <p className="text-xs sm:text-sm text-[var(--dashboard-muted)] ml-[46px]">
                  {poolGroup.memberLabs.length} laboratuvar &middot; {poolStats.cihazSayisi} cihaz
                  {poolStats.arizaSayisi > 0 && (
                    <span className="text-red-600 font-medium"> &middot; {poolStats.arizaSayisi} arızalı</span>
                  )}
                </p>
            </div>
        </div>

          {/* Member lab cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {poolGroup.memberLabs.map(hospital => {
              const stats = getHospitalStats(hospital.id);
              return (
                <button
                  key={hospital.id}
                  onClick={() => router.push(`/teknik-servis/${hospital.id}`)}
                  className="cihaz-card cihaz-focus-ring w-full text-left p-4 sm:p-5 flex flex-col bg-white/40 backdrop-blur-sm border border-white/40 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm sm:text-[15px] font-semibold text-[var(--dashboard-text)] truncate leading-snug flex-1" title={hospital.name}>
                      {hospital.name}
                    </h3>
                    <ChevronRight className="h-4 w-4 text-[var(--dashboard-muted)] shrink-0 mt-0.5" />
                  </div>
                  <DeviceStatusSummary devs={stats.devices} />
                </button>
              );
            })}
          </div>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════
     MAIN PANEL VIEW
     ═══════════════════════════════════════════════════════ */

  const totalDevices = devices.length;
  const totalFaulty = devices.filter(isDeviceFaulty).length;

  return (
    <div className="cihaz-shell px-4 py-6 sm:px-8 sm:py-10">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* ── Header card ── */}
        <div className="cihaz-card-strong p-5 sm:p-7 bg-white/40 backdrop-blur-md border border-white/50 shadow-sm relative">
          {/* Action buttons top-right aligned */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={() => router.push('/nobet-yonetimi')}
              className="cihaz-tool-item cihaz-focus-ring flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg hover:bg-white/50 transition-colors"
              title="Nöbet"
            >
              <CalendarClock className="h-4 w-4 text-[var(--dashboard-accent)]" />
              <span className="text-[var(--dashboard-text)] font-medium hidden sm:inline">Nöbet</span>
            </button>
            <button
              onClick={() => router.push('/teknik-harita')}
              className="cihaz-tool-item cihaz-focus-ring flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg hover:bg-white/50 transition-colors"
              title="Harita"
            >
              <MapIcon className="h-4 w-4 text-[var(--dashboard-accent)]" />
              <span className="text-[var(--dashboard-text)] font-medium hidden sm:inline">Harita</span>
            </button>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between pr-32">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
                  <Wrench className="h-5 w-5 text-[var(--dashboard-accent)]" />
                </span>
                <div>
                  <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)] leading-tight">
                    Teknik Servis Paneli
                  </h1>
                  <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">
                    {filteredHospitals.length} kurum &middot; {totalDevices} cihaz
                    {totalFaulty > 0 && (
                      <span className="text-red-600 font-medium"> &middot; {totalFaulty} arızalı</span>
                    )}
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── Lab pools section ── */}
        {poolGroups.length > 0 && (
          <section>
            <SectionLabel>Cihaz Model Grupları</SectionLabel>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
              {poolGroups.map(({ pool, mainLab, memberLabs }) => {
                const stats = getPoolStats(memberLabs.map(l => l.id));
                return (
                  <button
                    key={pool.id}
                    onClick={() => setExpandedPoolId(pool.id)}
                    className={cn(
                      "cihaz-card cihaz-focus-ring w-full text-left p-4 sm:p-5 flex flex-col",
                      "border-[var(--dashboard-accent)]/20"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm sm:text-[15px] font-semibold text-[var(--dashboard-text)] truncate leading-snug" title={pool.name || mainLab.name}>
                          {pool.name || mainLab.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1 text-[var(--dashboard-muted)] shrink-0">
                        <Layers className="h-3.5 w-3.5" />
                        <span className="text-xs font-medium">{memberLabs.length}</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                    <DeviceStatusSummary devs={stats.devices} />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Standalone labs section ── */}
        {standaloneLabs.length > 0 && (
          <section>
            <SectionLabel>Gruplanmamış Kurumlar</SectionLabel>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
              {standaloneLabs.map(hospital => {
                const stats = getHospitalStats(hospital.id);
                return (
                  <button
                    key={hospital.id}
                    onClick={() => router.push(`/teknik-servis/${hospital.id}`)}
                    className="cihaz-card cihaz-focus-ring w-full text-left p-4 sm:p-5 flex flex-col"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm sm:text-[15px] font-semibold text-[var(--dashboard-text)] truncate leading-snug flex-1" title={hospital.name}>
                        {hospital.name}
                      </h3>
                      <ChevronRight className="h-4 w-4 text-[var(--dashboard-muted)] shrink-0 mt-0.5" />
                    </div>
                    <DeviceStatusSummary devs={stats.devices} />
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

    </div>
  );
}
