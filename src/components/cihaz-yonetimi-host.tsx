'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Hospital, Device, AssignedDevice, User, MaintenancePlan, MaintenanceLog } from '@/lib/types';
import {
  Sparkles,
  Building,
  School,
  CircleDot,
  AlertCircle,
  PlayCircle,
  ClipboardCheck,
  Cpu,
  ShieldAlert,
  Wrench,
  ArrowUpRight,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { addDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
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
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';

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
  const cls =
    tone === 'success' ? 'qt-pill qt-pill--success'
    : tone === 'info' ? 'qt-pill qt-pill--info'
    : tone === 'warning' ? 'qt-pill qt-pill--warn'
    : 'qt-pill qt-pill--neutral';
  const Icon = tone === 'success' ? ClipboardCheck
    : tone === 'info' ? PlayCircle
    : tone === 'warning' ? AlertCircle
    : CircleDot;
  return (
    <span className={cls}>
      <Icon className="h-3.5 w-3.5" />
      <span>{label || 'Müsait'}</span>
    </span>
  );
}

interface MetricCardProps {
  label: string;
  value: number | string;
  unit?: string;
  footer?: string;
  icon: React.ElementType;
  tone?: 'default' | 'danger' | 'warn' | 'success';
  onClick?: () => void;
}

function MetricCard({ label, value, unit, footer, icon: Icon, tone = 'default', onClick }: MetricCardProps) {
  const toneCls =
    tone === 'danger' ? 'qt-metric-card--danger'
    : tone === 'warn' ? 'qt-metric-card--warn'
    : tone === 'success' ? 'qt-metric-card--success'
    : '';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn('qt-metric-card', toneCls, onClick && 'qt-metric-card--link')}
    >
      <div className="qt-metric-card__icon">
        <Icon className="h-5 w-5" />
      </div>
      <div className="qt-metric-card__label">{label}</div>
      <div className="qt-metric-card__value">
        <span>{value}</span>
        {unit && <span className="qt-metric-card__unit">{unit}</span>}
      </div>
      {footer && (
        <div className="qt-metric-card__footer">
          {onClick && <ArrowUpRight className="h-3.5 w-3.5" />}
          <span>{footer}</span>
        </div>
      )}
    </button>
  );
}

export default function CihazYonetimiHost() {
  const [isLoading, setIsLoading] = useState(true);
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
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitalDeviceAssignments, setHospitalDeviceAssignments] = useState<AssignedDevice[]>([]);
  const [personnelUsers, setPersonnelUsers] = useState<User[]>([]);
  const [availabilityRecords, setAvailabilityRecords] = useState<PersonnelAvailabilityRecord[]>([]);
  const [faultRows, setFaultRows] = useState<FaultLike[]>([]);
  const [formWindows, setFormWindows] = useState<PersonnelFormWindow[]>([]);
  const [maintenancePlans, setMaintenancePlans] = useState<MaintenancePlan[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);

  const fetchAllApplicationData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [
        hospitalsSnap,
        devicesSnap,
        assignmentsSnap,
        usersSnap,
        availabilitySnap,
        faultsSnap,
        teknikFormsSnap,
        aplikasyonFormsSnap,
        maintenancePlansSnap,
        maintenanceLogsSnap,
      ] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'devices')),
        getDocs(collection(db, 'hospitalDeviceAssignments')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'personnelAvailability')),
        getDocs(collection(db, 'deviceFaultReports')),
        getDocs(collection(db, 'deviceActionForms')),
        getDocs(collection(db, 'aplikasyonActionForms')),
        getDocs(collection(db, 'maintenancePlans')),
        getDocs(collection(db, 'maintenanceLogs')),
      ]);

      setHospitals(filterByCompanyScope(
        hospitalsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Hospital),
        currentCompanyId, isSuperAdmin,
      ));
      setDevices(filterByCompanyScope(
        devicesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Device),
        currentCompanyId, isSuperAdmin,
      ));
      setHospitalDeviceAssignments(filterByCompanyScope(
        assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as AssignedDevice),
        currentCompanyId, isSuperAdmin,
      ));

      const users = filterByCompanyScope(
        usersSnap.docs
          .map((d) => ({ uid: d.id, ...d.data() }) as User)
          .filter((u) => u.role === 'teknik_servis' || u.role === 'aplikasyon'),
        currentCompanyId, isSuperAdmin,
      );
      setPersonnelUsers(users);

      const availability = filterByCompanyScope(
        availabilitySnap.docs.map((d) => {
          const data = d.data();
          const startAt = toDateValue(data.startAt);
          const endAt = toDateValue(data.endAt);
          if (!startAt || !endAt || !data.uid) return null;
          return {
            id: d.id,
            uid: data.uid,
            type: data.type === 'training' ? 'training' : 'office',
            description: data.description || '',
            startAt, endAt,
            createdAt: toDateValue(data.createdAt),
            createdByUid: data.createdByUid || null,
            companyId: data.companyId,
          } as PersonnelAvailabilityRecord;
        }).filter((i): i is PersonnelAvailabilityRecord => Boolean(i)),
        currentCompanyId, isSuperAdmin,
      );
      setAvailabilityRecords(availability);

      const faults = filterByCompanyScope(faultsSnap.docs.map((d) => {
        const data = d.data();
        return {
          assignedToUid: data.assignedToUid || null,
          status: data.status,
          interventionStartedAt: toDateValue(data.interventionStartedAt),
          hospitalId: data.hospitalId || null,
          openedAt: toDateValue(data.openedAt),
          companyId: data.companyId,
        } as FaultLike;
      }), currentCompanyId, isSuperAdmin);
      setFaultRows(faults);

      const mapFormsToWindows = (docs: typeof teknikFormsSnap.docs) => docs
        .map((d) => {
          const data = d.data();
          const startDate = String(data.baslangicTarihi || '').trim();
          const endDate = String(data.bitisTarihi || '').trim();
          const startTime = String(data.baslangicSaati || '').trim();
          const endTime = String(data.bitisSaati || '').trim();
          const uid = data.createdByUid;
          if (!uid || !startDate || !endDate || !startTime || !endTime) return null;
          const startAt = new Date(`${startDate}T${startTime}:00`);
          const endAt = new Date(`${endDate}T${endTime}:00`);
          if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
          return { uid, hospitalId: data.hospitalId || null, startAt, endAt } as PersonnelFormWindow;
        })
        .filter((i): i is PersonnelFormWindow => Boolean(i));

      setFormWindows([
        ...mapFormsToWindows(teknikFormsSnap.docs),
        ...mapFormsToWindows(aplikasyonFormsSnap.docs),
      ]);

      setMaintenancePlans(maintenancePlansSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as MaintenancePlan));
      setMaintenanceLogs(maintenanceLogsSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          completedAt: data.completedAt?.toDate?.() || null,
          nextDueDate: data.nextDueDate?.toDate?.() || null,
        } as MaintenanceLog;
      }));
    } catch (error) {
      console.error('Device management data fetch error:', error);
      toast({ title: 'Veri Hatası', description: 'Cihaz yönetimi verileri yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    fetchAllApplicationData();
  }, [fetchAllApplicationData]);

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
      const userFaults = faultRows.filter((fault) => fault.assignedToUid === user.uid);
      const activeFault = userFaults.find((fault) => fault.status !== 'cozuldu' && fault.status !== 'closed');
      if (activeFault) {
        const meta = getFaultStatusMeta(activeFault);
        return {
          user,
          statusLabel: meta.statusLabel,
          statusTone: meta.statusTone,
          laboratoryName: meta.laboratoryId ? hospitalNameById.get(meta.laboratoryId) : undefined,
        };
      }
      const activeWindow = formWindows.find((w) => w.uid === user.uid && isDateInRange(now, w.startAt, w.endAt));
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
  }, [availabilityByUser, faultRows, formWindows, hospitalNameById, personnelUsers]);

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
      const [recordRef] = await Promise.all([
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
      setAvailabilityRecords((prev) => [...prev, {
        id: recordRef.id,
        uid: currentUserProfile.uid,
        type: availabilityType,
        description: availabilityDescription.trim(),
        startAt, endAt,
        createdAt: new Date(),
        createdByUid: currentUserProfile.uid,
      }]);
      toast({ title: 'Kaydedildi', description: `${statusLabel} bilgisi personel geçmişine işlendi.` });
      setIsAvailabilityDialogOpen(false);
    } catch (error) {
      console.error('Failed to save availability:', error);
      toast({ title: 'Kayıt Hatası', description: 'Bilgi kaydedilemedi.', variant: 'destructive' });
    } finally {
      setSavingAvailability(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="custom-loader" />
          <p className="text-sm text-[var(--qt-muted)]">Yükleniyor&hellip;</p>
        </div>
      </div>
    );
  }

  const teknikRows = personnelRows.filter((r) => r.user.role === 'teknik_servis');
  const aplikasyonRows = personnelRows.filter((r) => r.user.role === 'aplikasyon');

  return (
    <>
      {/* Mobile brand at top-center is handled by the shell.
          Here we render a compact top-area with title + status buttons. */}
      <div className="qt-hub-header">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="qt-hub-title hidden md:block">Cihaz Yönetim Merkezi</h1>
            <p className="qt-hub-subtitle">
              {hospitals.length} kurum · {devices.length} cihaz · {hospitalDeviceAssignments.length} atama
            </p>
          </div>
        </div>

        <div className="qt-status-row">
          <button type="button" className="qt-status-btn" onClick={() => openAvailabilityDialog('office')}>
            <Building className="h-4 w-4" />
            Ofisteyim
          </button>
          <button type="button" className="qt-status-btn qt-status-btn--training" onClick={() => openAvailabilityDialog('training')}>
            <School className="h-4 w-4" />
            Eğitimdeyim
          </button>
          <QoreTechnicNotificationsButton />
          {(() => {
            const role = currentUserProfile?.role;
            const isFieldUser = role === 'teknik_servis' || role === 'aplikasyon';
            if (isFieldUser) {
              return <QoreTechnicProfileButton className="md:hidden" />;
            }
            return (
              <button type="button" className="qt-status-btn qt-status-btn--ai" onClick={() => setIsQoreAIPanelOpen(true)}>
                <Sparkles className="h-4 w-4" />
                Qore AI
              </button>
            );
          })()}
        </div>
      </div>

      {/* Metric grid */}
      <div className="qt-metric-grid">
        <MetricCard
          label="Aktif Cihaz"
          value={activeDeviceCount}
          unit="cihaz"
          footer="Kurumlarda sahada"
          icon={Cpu}
          tone="default"
        />
        <MetricCard
          label="Arızalı Cihaz"
          value={faultyDeviceCount}
          unit="açık arıza"
          footer={faultyDeviceCount > 0 ? 'Atama bekleyenler' : 'Açık arıza yok'}
          icon={ShieldAlert}
          tone={faultyDeviceCount > 0 ? 'danger' : 'success'}
          onClick={() => router.push('/ariza-yonetimi?tab=atama_bekliyor')}
        />
        <MetricCard
          label="Bakımı Yaklaşan"
          value={upcomingMaintenanceCount}
          unit="cihaz"
          footer={upcomingMaintenanceCount > 0 ? 'Periyodik bakım planları' : 'Yaklaşan bakım yok'}
          icon={Wrench}
          tone={upcomingMaintenanceCount > 0 ? 'warn' : 'success'}
          onClick={() => router.push('/cihaz-tanimlamalari/periyodik-bakim-yonetimi')}
        />
      </div>

      {/* Personnel panel */}
      <div className="qt-panel">
        <div className="qt-panel__header">
          <div>
            <div className="qt-panel__title">Personel Durumu</div>
            <div className="qt-panel__subtitle">Anlık durum, aktif görev ve ilgili laboratuvar bilgisi</div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[12px] text-[var(--qt-muted)]">
            <Users className="h-4 w-4" />
            <span>{personnelUsers.length} personel</span>
          </div>
        </div>

        {([
          { key: 'teknik', label: 'Teknik Personeller', rows: teknikRows },
          { key: 'aplikasyon', label: 'Aplikasyon Personelleri', rows: aplikasyonRows },
        ] as const).map((group) => (
          <div key={group.key} className="qt-personnel-group">
            <div className="qt-personnel-group__label">{group.label}</div>
            {group.rows.length === 0 && (
              <div className="qt-personnel-row">
                <span className="qt-personnel-lab">Kayıt bulunmuyor.</span>
              </div>
            )}
            {group.rows.map((row) => (
              <button
                key={row.user.uid}
                type="button"
                className="qt-personnel-row"
                onClick={() => router.push(`/cihaz-yonetimi-ana/personel-gecmis7/${row.user.uid}`)}
              >
                <span className="qt-personnel-name">
                  {row.user.name || row.user.email || row.user.uid}
                </span>
                <span className="qt-personnel-status">
                  <StatusPill tone={row.statusTone} label={row.statusLabel} />
                </span>
                <span className="qt-personnel-lab">{row.laboratoryName || '—'}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

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
    </>
  );
}
