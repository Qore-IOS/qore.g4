'use client';
import React, { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Hospital, Device, AssignedDevice, User, MaintenancePlan, MaintenanceLog } from '@/lib/types';
import {
  useHospitals,
  useDevices,
  useHospitalDeviceAssignments,
  useUsers,
  usePersonnelAvailability,
  useDeviceFaultReports,
  useDeviceActionForms,
  useAplikasyonActionForms,
  useMaintenancePlans,
  useMaintenanceLogs,
} from '@/hooks/useFirebaseQueries';
import {
  Building,
  School,
  CircleDot,
  AlertCircle,
  PlayCircle,
  ClipboardCheck,
  Cpu,
  Wrench,
  ArrowUpRight,
  Users,
  BarChart3,
  Building2,
  Gauge,
  Package,
  ChevronRight,
} from 'lucide-react';
import {
  ClayPage, Card, KpiTile, GhostBtn, NavBtn, PageHead, C, AC, PAL,
} from '@/components/cihaz-yonetimi/clay-kit';
import { useToast } from '@/hooks/use-toast';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import QoreAIPanel from '@/components/QoreAIPanel';
import { QoreTechnicBrandMark, QoreTechnicProfileButton, QoreTechnicNotificationsButton } from '@/components/qore-technic-shell';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  isDateInRange,
  toDateValue,
  type PersonnelAvailabilityRecord,
  type PersonnelAvailabilityType,
} from '@/lib/personnel-availability';
import { withCompanyScope } from '@/lib/company-scope';

interface PersonnelRowData {
  user: User;
  statusLabel: string;
  statusTone: 'neutral' | 'warning' | 'info' | 'success';
  laboratoryName?: string;
}

interface PersonnelStatusMeta {
  statusLabel: string;
  statusTone: PersonnelRowData['statusTone'];
  laboratoryId?: string;
}

interface PersonnelFormWindow {
  uid: string;
  hospitalId?: string | null;
  startAt: Date;
  endAt: Date;
}

interface FaultLike {
  assignedToUid?: string | null;
  status?: string;
  interventionStartedAt?: Date | null;
  hospitalId?: string | null;
  openedAt?: Date | null;
}

function getFaultStatusMeta(fault: FaultLike): PersonnelStatusMeta {
  if (fault.status === 'atandi' || fault.status === 'assigned') {
    return { statusLabel: 'Arıza müdahalesi bekliyor', statusTone: 'warning', laboratoryId: fault.hospitalId || undefined };
  }
  if (fault.interventionStartedAt && fault.status !== 'cozuldu' && fault.status !== 'closed') {
    return { statusLabel: 'Arızada', statusTone: 'info', laboratoryId: fault.hospitalId || undefined };
  }
  return { statusLabel: '', statusTone: 'neutral' };
}

function StatusPill({ tone, label }: { tone: PersonnelRowData['statusTone']; label: string }) {
  const meta =
    tone === 'success' ? { c: C.waterDeep, bg: 'rgba(111,181,133,0.16)', Icon: ClipboardCheck }
    : tone === 'info' ? { c: PAL.sky, bg: 'rgba(124,168,222,0.16)', Icon: PlayCircle }
    : tone === 'warning' ? { c: '#9A6F1E', bg: C.amberSoft, Icon: AlertCircle }
    : { c: C.ink2, bg: C.surface2, Icon: CircleDot };
  const { Icon } = meta;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: C.radiusPill, background: meta.bg, color: meta.c, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <Icon className="h-3.5 w-3.5" />
      <span>{label || 'Müsait'}</span>
    </span>
  );
}

function KpiSkeleton() {
  return (
    <div style={{ padding: 16, borderRadius: C.radiusLg, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, boxShadow: C.clay }} className="animate-pulse">
      <div style={{ height: 14, width: 96, background: C.surface2, borderRadius: 6 }} />
      <div style={{ height: 30, width: 64, background: C.surface2, borderRadius: 8, marginTop: 14 }} />
      <div style={{ height: 14, width: 120, background: C.surface2, borderRadius: 6, marginTop: 14 }} />
    </div>
  );
}

function PersonnelSkeleton() {
  return (
    <div className="animate-pulse" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat }}>
          <div style={{ height: 18, width: 160, background: C.surface2, borderRadius: 6 }} />
          <div style={{ height: 26, width: 80, background: C.surface2, borderRadius: 99, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

export default function CihazYonetimiHost() {
  const [isQoreAIPanelOpen, setIsQoreAIPanelOpen] = useState(false);
  const [isAvailabilityDialogOpen, setIsAvailabilityDialogOpen] = useState(false);
  const [availabilityType, setAvailabilityType] = useState<PersonnelAvailabilityType>('office');
  const [availabilityDescription, setAvailabilityDescription] = useState('');
  const [availabilityStartDate, setAvailabilityStartDate] = useState('');
  const [availabilityStartTime, setAvailabilityStartTime] = useState('');
  const [availabilityEndDate, setAvailabilityEndDate] = useState('');
  const [availabilityEndTime, setAvailabilityEndTime] = useState('');
  const [savingAvailability, setSavingAvailability] = useState(false);

  const { toast } = useToast();
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const queryClient = useQueryClient();
  const currentRole = currentUserProfile?.role || '';
  const isFieldUser = currentRole === 'teknik_servis' || currentRole === 'aplikasyon';
  const isPrivilegedAdmin = ['admin', 'super_admin', 'admin_developer'].includes(currentRole);
  const showAdminStatsButton = isPrivilegedAdmin && !isFieldUser;

  // TanStack Query — all data is cached and shared with other panels.
  // Each query handles its own company scope filtering inside the hook.
  const hospitalsQuery = useHospitals();
  const devicesQuery = useDevices();
  const assignmentsQuery = useHospitalDeviceAssignments();
  const usersQuery = useUsers();
  const personnelAvailabilityQuery = usePersonnelAvailability();
  const faultsQuery = useDeviceFaultReports();
  const teknikFormsQuery = useDeviceActionForms();
  const aplikasyonFormsQuery = useAplikasyonActionForms();
  const maintenancePlansQuery = useMaintenancePlans();
  const maintenanceLogsQuery = useMaintenanceLogs();

  const isLoading =
    hospitalsQuery.isLoading ||
    devicesQuery.isLoading ||
    assignmentsQuery.isLoading ||
    usersQuery.isLoading ||
    personnelAvailabilityQuery.isLoading ||
    faultsQuery.isLoading ||
    teknikFormsQuery.isLoading ||
    aplikasyonFormsQuery.isLoading ||
    maintenancePlansQuery.isLoading ||
    maintenanceLogsQuery.isLoading;

  // Surface fetch failures via toast (TanStack Query handles retry; we notify on final error).
  useEffect(() => {
    const anyError =
      hospitalsQuery.isError || devicesQuery.isError || assignmentsQuery.isError ||
      usersQuery.isError || personnelAvailabilityQuery.isError || faultsQuery.isError ||
      teknikFormsQuery.isError || aplikasyonFormsQuery.isError ||
      maintenancePlansQuery.isError || maintenanceLogsQuery.isError;
    if (anyError) {
      toast({ title: 'Veri Hatası', description: 'Cihaz yönetimi verileri yüklenemedi.', variant: 'destructive' });
    }
  }, [
    hospitalsQuery.isError, devicesQuery.isError, assignmentsQuery.isError,
    usersQuery.isError, personnelAvailabilityQuery.isError, faultsQuery.isError,
    teknikFormsQuery.isError, aplikasyonFormsQuery.isError,
    maintenancePlansQuery.isError, maintenanceLogsQuery.isError, toast,
  ]);

  const hospitals = useMemo<Hospital[]>(
    () => (hospitalsQuery.data ?? []) as Hospital[],
    [hospitalsQuery.data],
  );
  const devices = useMemo<Device[]>(
    () => (devicesQuery.data ?? []) as Device[],
    [devicesQuery.data],
  );
  const hospitalDeviceAssignments = useMemo<AssignedDevice[]>(
    () => (assignmentsQuery.data ?? []) as AssignedDevice[],
    [assignmentsQuery.data],
  );

  const personnelUsers = useMemo<User[]>(
    () =>
      ((usersQuery.data ?? []) as User[]).filter(
        (u) => u.role === 'teknik_servis' || u.role === 'aplikasyon',
      ),
    [usersQuery.data],
  );

  const availabilityRecords = useMemo<PersonnelAvailabilityRecord[]>(() => {
    const raw = (personnelAvailabilityQuery.data ?? []) as Array<Record<string, any>>;
    return raw
      .map((data) => {
        const startAt = toDateValue(data.startAt);
        const endAt = toDateValue(data.endAt);
        if (!startAt || !endAt || !data.uid) return null;
        return {
          id: data.id,
          uid: data.uid,
          type: data.type === 'training' ? 'training' : 'office',
          description: data.description || '',
          startAt,
          endAt,
          createdAt: toDateValue(data.createdAt),
          createdByUid: data.createdByUid || null,
          companyId: data.companyId,
        } as PersonnelAvailabilityRecord;
      })
      .filter((i): i is PersonnelAvailabilityRecord => Boolean(i));
  }, [personnelAvailabilityQuery.data]);

  const faultRows = useMemo<FaultLike[]>(() => {
    const raw = (faultsQuery.data ?? []) as Array<Record<string, any>>;
    return raw.map((data) => ({
      assignedToUid: data.assignedToUid || null,
      status: data.status,
      interventionStartedAt: toDateValue(data.interventionStartedAt),
      hospitalId: data.hospitalId || null,
      openedAt: toDateValue(data.openedAt),
      companyId: data.companyId,
    }));
  }, [faultsQuery.data]);

  const formWindows = useMemo<PersonnelFormWindow[]>(() => {
    const buildWindow = (data: Record<string, any>): PersonnelFormWindow | null => {
      const startDate = String(data.baslangicTarihi || '').trim();
      const endDate = String(data.bitisTarihi || '').trim();
      const startTime = String(data.baslangicSaati || '').trim();
      const endTime = String(data.bitisSaati || '').trim();
      const uid = data.createdByUid;
      if (!uid || !startDate || !endDate || !startTime || !endTime) return null;
      const startAt = new Date(`${startDate}T${startTime}:00`);
      const endAt = new Date(`${endDate}T${endTime}:00`);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
      return { uid, hospitalId: data.hospitalId || null, startAt, endAt };
    };
    const teknikData = (teknikFormsQuery.data ?? []) as Array<Record<string, any>>;
    const aplikasyonData = (aplikasyonFormsQuery.data ?? []) as Array<Record<string, any>>;
    return [
      ...teknikData.map(buildWindow),
      ...aplikasyonData.map(buildWindow),
    ].filter((i): i is PersonnelFormWindow => Boolean(i));
  }, [teknikFormsQuery.data, aplikasyonFormsQuery.data]);

  const maintenancePlans = useMemo<MaintenancePlan[]>(
    () => (maintenancePlansQuery.data ?? []) as MaintenancePlan[],
    [maintenancePlansQuery.data],
  );

  const maintenanceLogs = useMemo<MaintenanceLog[]>(() => {
    const raw = (maintenanceLogsQuery.data ?? []) as Array<Record<string, any>>;
    return raw.map((data) => ({
      ...data,
      id: data.id,
      completedAt: data.completedAt instanceof Date
        ? data.completedAt
        : (data.completedAt?.toDate?.() ?? null),
      nextDueDate: data.nextDueDate instanceof Date
        ? data.nextDueDate
        : (data.nextDueDate?.toDate?.() ?? null),
    } as MaintenanceLog));
  }, [maintenanceLogsQuery.data]);

  const availabilityByUser = useMemo(() => {
    const map = new Map<string, PersonnelAvailabilityRecord[]>();
    availabilityRecords.forEach((item) => {
      const current = map.get(item.uid) || [];
      current.push(item);
      map.set(item.uid, current);
    });
    return map;
  }, [availabilityRecords]);

  const hospitalNameById = useMemo(() => {
    const map = new Map<string, string>();
    hospitals.forEach((h) => map.set(h.id, h.name || h.ad || 'Laboratuvar'));
    return map;
  }, [hospitals]);

  // Index the first active (unresolved) fault per assigned user, so the
  // personnel table resolves each person's status with an O(1) lookup instead
  // of re-scanning the full (up to ~10k) fault list per person. Preserves the
  // previous "first matching fault in list order" semantics.
  const activeFaultByUid = useMemo(() => {
    const map = new Map<string, FaultLike>();
    for (const fault of faultRows) {
      const uid = fault.assignedToUid;
      if (!uid) continue;
      if (fault.status === 'cozuldu' || fault.status === 'closed') continue;
      if (!map.has(uid)) map.set(uid, fault);
    }
    return map;
  }, [faultRows]);

  // Index the first currently-active form window per user (same idea).
  const activeWindowByUid = useMemo(() => {
    const now = new Date();
    const map = new Map<string, PersonnelFormWindow>();
    for (const w of formWindows) {
      if (!w.uid) continue;
      if (!isDateInRange(now, w.startAt, w.endAt)) continue;
      if (!map.has(w.uid)) map.set(w.uid, w);
    }
    return map;
  }, [formWindows]);

  const personnelRows = useMemo<PersonnelRowData[]>(() => {
    const now = new Date();
    return personnelUsers.map((user) => {
      const userAvailability = availabilityByUser.get(user.uid) || [];
      const activeAvailability = userAvailability.find((item) => isDateInRange(now, item.startAt, item.endAt));
      if (activeAvailability) {
        return {
          user,
          statusLabel: activeAvailability.type === 'office' ? 'Ofiste' : 'Eğitimde',
          statusTone: 'success',
        };
      }
      const activeFault = activeFaultByUid.get(user.uid);
      if (activeFault) {
        const meta = getFaultStatusMeta(activeFault);
        return {
          user,
          statusLabel: meta.statusLabel,
          statusTone: meta.statusTone,
          laboratoryName: meta.laboratoryId ? hospitalNameById.get(meta.laboratoryId) : undefined,
        };
      }
      const activeWindow = activeWindowByUid.get(user.uid);
      if (activeWindow) {
        return {
          user,
          statusLabel: 'İşlemde',
          statusTone: 'info',
          laboratoryName: activeWindow.hospitalId ? hospitalNameById.get(activeWindow.hospitalId) : undefined,
        };
      }
      return { user, statusLabel: '', statusTone: 'neutral' };
    });
  }, [availabilityByUser, activeFaultByUid, activeWindowByUid, hospitalNameById, personnelUsers]);

  // Aktif cihazlar: atama kaydı olanlar (assignment-based)
  const activeDeviceCount = useMemo(() => {
    const ids = new Set<string>();
    hospitalDeviceAssignments.forEach((a: any) => {
      if (a?.deviceId) ids.add(a.deviceId);
    });
    return ids.size || devices.length;
  }, [hospitalDeviceAssignments, devices]);

  // Arızalı cihaz sayısı (açık / çözülmemiş arızalar)
  const faultyDeviceCount = useMemo(() => {
    return faultRows.filter((f) => f.status && f.status !== 'cozuldu' && f.status !== 'closed').length;
  }, [faultRows]);

  // Bakımı yaklaşanlar: 30 gün içinde bakımı dolacak veya vadesi geçmiş plan sayısı
  const upcomingMaintenanceCount = useMemo(() => {
    if (maintenancePlans.length === 0) return 0;
    const now = Date.now();
    const WINDOW = 30 * 24 * 60 * 60 * 1000;
    const latestLogByPlan = new Map<string, MaintenanceLog>();
    maintenanceLogs.forEach((log) => {
      if (!log.planId) return;
      const existing = latestLogByPlan.get(log.planId);
      const ts = log.completedAt ? new Date(log.completedAt).getTime() : 0;
      const existingTs = existing?.completedAt ? new Date(existing.completedAt).getTime() : 0;
      if (!existing || ts > existingTs) latestLogByPlan.set(log.planId, log);
    });
    let count = 0;
    maintenancePlans.forEach((plan) => {
      const log = latestLogByPlan.get(plan.id);
      if (!log || !log.nextDueDate) { count += 1; return; }
      const due = new Date(log.nextDueDate).getTime();
      if (due - now <= WINDOW) count += 1;
    });
    return count;
  }, [maintenancePlans, maintenanceLogs]);

  const openAvailabilityDialog = (type: PersonnelAvailabilityType) => {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    setAvailabilityType(type);
    setAvailabilityDescription('');
    setAvailabilityStartDate(date);
    setAvailabilityStartTime(`${hh}:${mm}`);
    setAvailabilityEndDate(date);
    setAvailabilityEndTime(`${hh}:${mm}`);
    setIsAvailabilityDialogOpen(true);
  };

  const saveAvailability = async () => {
    if (!currentUserProfile?.uid) {
      toast({ title: 'Yetki Hatası', description: 'Kullanıcı bilgisi bulunamadı.', variant: 'destructive' });
      return;
    }
    if (!availabilityDescription.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen açıklama girin.', variant: 'destructive' });
      return;
    }
    if (!availabilityStartDate || !availabilityStartTime || !availabilityEndDate || !availabilityEndTime) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen tarih/saat aralığını doldurun.', variant: 'destructive' });
      return;
    }
    const startAt = new Date(`${availabilityStartDate}T${availabilityStartTime}:00`);
    const endAt = new Date(`${availabilityEndDate}T${availabilityEndTime}:00`);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      toast({ title: 'Hatalı Tarih', description: 'Tarih/saat formatı geçersiz.', variant: 'destructive' });
      return;
    }
    if (startAt.getTime() > endAt.getTime()) {
      toast({ title: 'Hatalı Aralık', description: 'Başlangıç bitişten sonra olamaz.', variant: 'destructive' });
      return;
    }
    try {
      setSavingAvailability(true);
      const statusLabel = availabilityType === 'office' ? 'Ofisteyim' : 'Eğitimdeyim';
      const payload = withCompanyScope({
        uid: currentUserProfile.uid,
        type: availabilityType,
        description: availabilityDescription.trim(),
        startAt, endAt,
        createdByUid: currentUserProfile.uid,
        createdAt: serverTimestamp(),
      }, currentUserProfile.companyId);
      await Promise.all([
        addDoc(collection(db, 'personnelAvailability'), payload),
        addDoc(collection(db, 'personnelHistoryLogs'), withCompanyScope({
          uid: currentUserProfile.uid,
          action: 'availability_created',
          actionLabel: statusLabel,
          description: availabilityDescription.trim(),
          startAt, endAt,
          createdAt: serverTimestamp(),
          source: 'cihaz-yonetimi-ana',
          metadata: { type: availabilityType },
        }, currentUserProfile.companyId)),
      ]);
      // Invalidate the cached availability records so the new entry shows up
      // on the next render. TanStack Query refetches automatically when consumers
      // are mounted, keeping data in sync without manual state mutation.
      await queryClient.invalidateQueries({ queryKey: ['personnelAvailability'] });
      toast({ title: 'Kaydedildi', description: `${statusLabel} bilgisi personel geçmişine işlendi.` });
      setIsAvailabilityDialogOpen(false);
    } catch (error) {
      console.error('Failed to save availability:', error);
      toast({ title: 'Kayıt Hatası', description: 'Bilgi kaydedilemedi.', variant: 'destructive' });
    } finally {
      setSavingAvailability(false);
    }
  };


  const teknikRows = personnelRows.filter((r) => r.user.role === 'teknik_servis');
  const aplikasyonRows = personnelRows.filter((r) => r.user.role === 'aplikasyon');

  const personnelGroups = [
    { key: 'teknik', label: 'Teknik Personeller', rows: teknikRows },
    { key: 'aplikasyon', label: 'Aplikasyon Personelleri', rows: aplikasyonRows },
  ] as const;

  const analyticsTiles = [
    { title: 'Arıza İstatistikleri', desc: 'Açık/kapalı arızalar, ürün ve kategori istatistikleri', href: '/ariza-yonetimi/istatistikler', icon: BarChart3, color: C.danger },
    { title: 'Kurum Ziyaret Analizi', desc: 'Kurum bazlı ziyaret, form ve arıza temasları', href: '/kurum-ziyaret-analizi', icon: Building2, color: PAL.tech },
    { title: 'Yedek Parça Analizi', desc: 'Parça kullanımı, değişim geçmişi ve dağılımlar', href: '/yedek-parca-analizi', icon: Package, color: PAL.violet },
    { title: 'Performans Paneli', desc: 'Teknik servis ve aplikasyon performans metrikleri', href: '/personel-izlem', icon: Gauge, color: C.waterDeep },
  ];

  return (
    <ClayPage>
      {/* Header — title + status / quick actions */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: 'grid', placeItems: 'center', color: '#fff', background: `radial-gradient(circle at 32% 28%, ${AC.accent}, ${AC.primary})`, boxShadow: `inset 0 1px 1px rgba(255,255,255,0.4), 0 10px 20px -8px ${AC.glow}` }}>
          <Cpu size={24} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 800, letterSpacing: '-0.02em', color: C.ink1, lineHeight: 1.15 }}>Cihaz Yönetim Merkezi</h1>
          <p style={{ margin: '3px 0 0', fontSize: 13.5, fontWeight: 600, color: C.ink2 }}>
            {hospitalsQuery.isLoading ? 'Kurumlar…' : `${hospitals.length} kurum`} · {devicesQuery.isLoading ? 'Cihazlar…' : `${devices.length} cihaz`} · {assignmentsQuery.isLoading ? 'Atamalar…' : `${hospitalDeviceAssignments.length} atama`}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <GhostBtn onClick={() => openAvailabilityDialog('office')}><Building className="h-4 w-4" /> Ofisteyim</GhostBtn>
          <GhostBtn onClick={() => openAvailabilityDialog('training')}><School className="h-4 w-4" /> Eğitimdeyim</GhostBtn>
          <QoreTechnicNotificationsButton />
          {isFieldUser ? (
            <QoreTechnicProfileButton className="md:hidden" />
          ) : (
            <NavBtn label="Qore AI" grad={`linear-gradient(180deg, ${AC.accent}, ${AC.primary})`} onClick={() => setIsQoreAIPanelOpen(true)} />
          )}
        </div>
      </div>

      {/* Metric grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 14, marginBottom: 16 }}>
        {(devicesQuery.isLoading || assignmentsQuery.isLoading) ? (
          <><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></>
        ) : (
          <>
            <KpiTile ico="server" label="Aktif Cihaz" value={activeDeviceCount} unit="cihaz" foot="Kurumlarda sahada" delay={0} />
            <KpiTile
              ico="shield" label="Arızalı Cihaz" value={faultyDeviceCount} unit="açık arıza"
              tone={faultyDeviceCount > 0 ? 'danger' : 'ok'}
              foot={<><ArrowUpRight size={13} />{faultyDeviceCount > 0 ? 'Atama bekleyenler' : 'Açık arıza yok'}</>}
              onClick={() => router.push('/ariza-yonetimi?tab=atama_bekliyor')} delay={60}
            />
            <KpiTile
              ico="wrench" label="Bakımı Yaklaşan" value={upcomingMaintenanceCount} unit="cihaz"
              tone={upcomingMaintenanceCount > 0 ? 'amber' : 'ok'}
              foot={<><ArrowUpRight size={13} />{upcomingMaintenanceCount > 0 ? 'Periyodik bakım planları' : 'Yaklaşan bakım yok'}</>}
              onClick={() => router.push('/cihaz-tanimlamalari/periyodik-bakim-yonetimi')} delay={120}
            />
          </>
        )}
      </div>

      {/* Analiz panelleri — admin shortcuts */}
      {showAdminStatsButton && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center', color: AC.primary, background: AC.primary + '16', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}><BarChart3 size={20} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-0.01em', color: C.ink1 }}>Analiz Panelleri</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink2, marginTop: 2 }}>Ziyaret, performans, yedek parça ve arıza istatistikleri</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 12 }}>
            {analyticsTiles.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href} type="button" onClick={() => router.push(item.href)}
                  className="cy-row-hover"
                  style={{
                    all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 16px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat,
                    animation: `cyPopIn ${260 + i * 60}ms cubic-bezier(.22,1,.36,1) both`,
                  }}
                >
                  <span style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center', color: item.color, background: item.color + '1c', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.7)' }}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800, color: C.ink1 }}>{item.title}</span>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.ink2, marginTop: 2 }}>{item.desc}</span>
                  </span>
                  <ChevronRight size={18} style={{ color: C.ink3, flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Personnel panel */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-0.01em', color: C.ink1 }}>Personel Durumu</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink2, marginTop: 2 }}>Anlık durum, aktif görev ve ilgili laboratuvar bilgisi</div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: C.ink2 }}>
            <Users className="h-4 w-4" />{personnelUsers.length} personel
          </span>
        </div>

        {usersQuery.isLoading ? (
          <PersonnelSkeleton />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {personnelGroups.map((group) => (
              <div key={group.key}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>{group.label}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {group.rows.length === 0 && (
                    <div style={{ padding: '14px 16px', borderRadius: C.radius, background: C.surface2, boxShadow: C.clayInset, fontSize: 13.5, fontWeight: 600, color: C.ink3 }}>Kayıt bulunmuyor.</div>
                  )}
                  {group.rows.map((row, i) => (
                    <button
                      key={row.user.uid} type="button" className="cy-row-hover"
                      onClick={() => router.push(`/cihaz-yonetimi-ana/personel-gecmis7/${row.user.uid}`)}
                      style={{
                        all: 'unset', cursor: 'pointer', boxSizing: 'border-box',
                        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '4px 12px', alignItems: 'center',
                        padding: '13px 16px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat,
                        animation: `cyPopIn ${220 + i * 40}ms cubic-bezier(.22,1,.36,1) both`,
                      }}
                    >
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.user.name || row.user.email || row.user.uid}
                      </span>
                      <span style={{ justifySelf: 'end' }}><StatusPill tone={row.statusTone} label={row.statusLabel} /></span>
                      {row.laboratoryName && (
                        <span style={{ gridColumn: '1 / -1', fontSize: 12.5, fontWeight: 600, color: C.ink2, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Building2 size={13} style={{ color: C.ink3 }} />{row.laboratoryName}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={isAvailabilityDialogOpen} onOpenChange={setIsAvailabilityDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{availabilityType === 'office' ? 'Ofisteyim' : 'Eğitimdeyim'} Bilgisi</DialogTitle>
            <DialogDescription>
              Açıklama ve tarih/saat aralığı girerek personel geçmişine kayıt oluşturabilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="availability-description">Açıklama</Label>
              <Textarea id="availability-description" value={availabilityDescription}
                onChange={(e) => setAvailabilityDescription(e.target.value)}
                placeholder="Örn: Şirket içi eğitim / ofis planlama" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="availability-start-date">Başlangıç Tarihi</Label>
                <Input id="availability-start-date" type="date" value={availabilityStartDate}
                  onChange={(e) => setAvailabilityStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="availability-start-time">Başlangıç Saati</Label>
                <Input id="availability-start-time" type="time" value={availabilityStartTime}
                  onChange={(e) => setAvailabilityStartTime(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="availability-end-date">Bitiş Tarihi</Label>
                <Input id="availability-end-date" type="date" value={availabilityEndDate}
                  onChange={(e) => setAvailabilityEndDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="availability-end-time">Bitiş Saati</Label>
                <Input id="availability-end-time" type="time" value={availabilityEndTime}
                  onChange={(e) => setAvailabilityEndTime(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsAvailabilityDialogOpen(false)}>İptal</Button>
            <Button type="button" onClick={saveAvailability} disabled={savingAvailability}>
              {savingAvailability ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QoreAIPanel open={isQoreAIPanelOpen} onClose={() => setIsQoreAIPanelOpen(false)} />
    </ClayPage>
  );
}
