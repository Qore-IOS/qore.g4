'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Hospital, Device, AssignedDevice, User } from '@/lib/types';
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
  School,
  Building,
  CircleDot,
  AlertCircle,
  PlayCircle,
  ClipboardCheck,
  Map as MapIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { addDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import QoreAIPanel from '@/components/QoreAIPanel';
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

interface ActionTileProps {
  icon: React.ElementType;
  label: string;
  description?: string;
  onClick: () => void;
  className?: string;
}

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

function ToolItem({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="cihaz-tool-item cihaz-focus-ring flex items-center gap-3 px-4 py-3 sm:py-3.5 w-full text-left"
    >
      <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] shrink-0">
        <Icon className="h-4 w-4 text-[var(--dashboard-accent)]" />
      </span>
      <span className="text-sm font-medium text-[var(--dashboard-text)] flex-1">{label}</span>
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

function getFaultStatusMeta(fault: FaultLike): PersonnelStatusMeta {
  if (fault.status === 'atandi' || fault.status === 'assigned') {
    return { statusLabel: 'Arıza müdahalesi bekliyor', statusTone: 'warning', laboratoryId: fault.hospitalId || undefined };
  }

  if (fault.interventionStartedAt && fault.status !== 'cozuldu' && fault.status !== 'closed') {
    return { statusLabel: 'Arızada', statusTone: 'info', laboratoryId: fault.hospitalId || undefined };
  }

  return { statusLabel: '', statusTone: 'neutral' };
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
  const { isAdmin, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitalDeviceAssignments, setHospitalDeviceAssignments] = useState<AssignedDevice[]>([]);
  const [personnelUsers, setPersonnelUsers] = useState<User[]>([]);
  const [availabilityRecords, setAvailabilityRecords] = useState<PersonnelAvailabilityRecord[]>([]);
  const [faultRows, setFaultRows] = useState<FaultLike[]>([]);
  const [formWindows, setFormWindows] = useState<PersonnelFormWindow[]>([]);

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
      ] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'devices')),
        getDocs(collection(db, 'hospitalDeviceAssignments')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'personnelAvailability')),
        getDocs(collection(db, 'deviceFaultReports')),
        getDocs(collection(db, 'deviceActionForms')),
        getDocs(collection(db, 'aplikasyonActionForms')),
      ]);

      setHospitals(filterByCompanyScope(
        hospitalsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Hospital),
        currentCompanyId,
        isSuperAdmin
      ));
      setDevices(filterByCompanyScope(
        devicesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Device),
        currentCompanyId,
        isSuperAdmin
      ));
      setHospitalDeviceAssignments(filterByCompanyScope(
        assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as AssignedDevice),
        currentCompanyId,
        isSuperAdmin
      ));

      const users = filterByCompanyScope(
        usersSnap.docs
        .map((d) => ({ uid: d.id, ...d.data() }) as User)
        .filter((u) => u.role === 'teknik_servis' || u.role === 'aplikasyon'),
        currentCompanyId,
        isSuperAdmin
      );
      setPersonnelUsers(users);

      const availability = filterByCompanyScope(
        availabilitySnap.docs
        .map((d) => {
          const data = d.data();
          const startAt = toDateValue(data.startAt);
          const endAt = toDateValue(data.endAt);
          if (!startAt || !endAt || !data.uid) return null;

          return {
            id: d.id,
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
        .filter((item): item is PersonnelAvailabilityRecord => Boolean(item)),
        currentCompanyId,
        isSuperAdmin
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

          return {
            uid,
            hospitalId: data.hospitalId || null,
            startAt,
            endAt,
          } as PersonnelFormWindow;
        })
        .filter((item): item is PersonnelFormWindow => Boolean(item));

      setFormWindows([
        ...mapFormsToWindows(teknikFormsSnap.docs),
        ...mapFormsToWindows(aplikasyonFormsSnap.docs),
      ]);
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


  const totalHospitals = hospitals.length;
  const totalDevices = devices.length;
  const totalAssignments = hospitalDeviceAssignments.length;

  const definitionTools = [
    { label: 'Cihaz Modelleri', icon: Settings, href: '/cihaz-tanimlamalari' },
    { label: 'Arıza Tanımlamaları', icon: ShieldAlert, href: '/ariza-tanimlamalari' },
  ];

  const quickActionTiles = [
    ...(currentUserProfile?.role === 'aplikasyon'
      ? [{ icon: FlaskConical, label: 'Aplikasyon', description: 'Aplikasyon paneli', href: '/aplikasyon-paneli' }]
      : [{ icon: Wrench, label: 'Teknik Servis', description: 'Servis paneli', href: '/teknik-servis' }]),
    { icon: ShieldAlert, label: 'Tüm Arızalar', description: 'Arıza yönetimi', href: '/ariza-yonetimi' },
    { icon: CalendarClock, label: 'Nöbet Vardiyası', description: 'Vardiya takibi', href: '/nobet-yonetimi' },
    { icon: MapIcon, label: 'Harita Paneli', description: 'Cihaz haritası', href: currentUserProfile?.role === 'aplikasyon' ? '/aplikasyon-harita' : '/teknik-harita' },
  ];

  const analysisTools = [
    { label: 'Arıza İstatistikleri', icon: BarChart3, href: '/ariza-yonetimi/istatistikler' },
    ...(isAdmin ? [{ label: 'Personel İzlem', icon: Users, href: '/personel-izlem' }] : []),
    { label: 'Yedek Parça Analizi', icon: Package, href: '/yedek-parca-analizi' },
    { label: 'Kurum Ziyaret Analizi', icon: Building2, href: '/kurum-ziyaret-analizi' },
  ];

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
    hospitals.forEach((h) => {
      map.set(h.id, h.name || h.ad || 'Laboratuvar');
    });
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
      const activeFault = userFaults.find((fault) => {
        if (fault.status === 'cozuldu' || fault.status === 'closed') return false;
        return true;
      });

      if (activeFault) {
        const meta = getFaultStatusMeta(activeFault);
        return {
          user,
          statusLabel: meta.statusLabel,
          statusTone: meta.statusTone,
          laboratoryName: meta.laboratoryId ? hospitalNameById.get(meta.laboratoryId) : undefined,
        };
      }

      const activeWindow = formWindows.find((window) => window.uid === user.uid && isDateInRange(now, window.startAt, window.endAt));
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
        startAt,
        endAt,
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
          startAt,
          endAt,
          createdAt: serverTimestamp(),
          source: 'cihaz-yonetimi-ana',
          metadata: {
            type: availabilityType,
          },
        }, currentUserProfile.companyId)),
      ]);

      setAvailabilityRecords((prev) => [
        ...prev,
        {
          id: recordRef.id,
          uid: currentUserProfile.uid,
          type: availabilityType,
          description: availabilityDescription.trim(),
          startAt,
          endAt,
          createdAt: new Date(),
          createdByUid: currentUserProfile.uid,
        },
      ]);

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
        <div className="cihaz-card-strong w-full max-w-2xl lg:max-w-4xl p-5 sm:p-8 relative">
          <div className="flex items-start justify-between mb-4 sm:mb-6 gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)] leading-tight tracking-tight">Cihaz Yönetim Merkezi</h1>
              <p className="mt-1 text-xs sm:text-sm text-[var(--dashboard-muted)]">
                {totalHospitals} kurum &middot; {totalDevices} model &middot; {totalAssignments} atama
              </p>
            </div>

            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <Button type="button" variant="outline" className="cihaz-tool-item h-10 px-3" onClick={() => openAvailabilityDialog('office')}>
                <Building className="h-4 w-4 text-[var(--dashboard-accent)]" />
                Ofisteyim
              </Button>
              <Button type="button" variant="outline" className="cihaz-tool-item h-10 px-3" onClick={() => openAvailabilityDialog('training')}>
                <School className="h-4 w-4 text-[var(--dashboard-accent)]" />
                Eğitimdeyim
              </Button>
              <button
                onClick={() => setIsQoreAIPanelOpen(true)}
                className="cihaz-tool-item cihaz-focus-ring flex items-center gap-2 px-3 py-2 text-sm shrink-0"
              >
                <Sparkles className="h-4 w-4 text-purple-500" />
                <span className="hidden sm:inline text-[var(--dashboard-text)] font-medium">Qore AI</span>
              </button>
            </div>
          </div>

          <div className="sm:hidden grid grid-cols-2 gap-2 mb-4">
            <Button type="button" variant="outline" className="cihaz-tool-item h-10 px-3" onClick={() => openAvailabilityDialog('office')}>
              <Building className="h-4 w-4 text-[var(--dashboard-accent)]" />
              Ofisteyim
            </Button>
            <Button type="button" variant="outline" className="cihaz-tool-item h-10 px-3" onClick={() => openAvailabilityDialog('training')}>
              <School className="h-4 w-4 text-[var(--dashboard-accent)]" />
              Eğitimdeyim
            </Button>
          </div>

          <section className="mb-6 sm:mb-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {quickActionTiles.map((action) => (
                <ActionTile
                  key={action.label}
                  icon={action.icon}
                  label={action.label}
                  description={action.description}
                  onClick={() => router.push(action.href)}
                />
              ))}
            </div>
          </section>

          <section className="mb-6 sm:mb-8">
            <SectionLabel>Personel Listesi</SectionLabel>
            <div className="mt-3 space-y-3">
              {(['teknik_servis', 'aplikasyon'] as const).map((roleKey) => (
                <div key={roleKey} className="rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] overflow-hidden">
                  <div className="px-4 py-2 text-xs font-semibold text-[var(--dashboard-muted)] bg-[var(--dashboard-surface-2)] uppercase tracking-wide">
                    {roleKey === 'teknik_servis' ? 'Teknik Personeller' : 'Aplikasyon Personelleri'}
                  </div>
                  <div className="hidden sm:grid grid-cols-12 px-4 py-2 text-xs font-semibold text-[var(--dashboard-muted)]">
                    <span className="col-span-4">Personel</span>
                    <span className="col-span-4">Durum</span>
                    <span className="col-span-4">Laboratuvar</span>
                  </div>
                  {personnelRows.filter((row) => row.user.role === roleKey).map((row) => (
                    <button
                      key={row.user.uid}
                      className="w-full grid grid-cols-1 sm:grid-cols-12 items-start sm:items-center gap-1 sm:gap-3 px-4 py-3 border-t border-[var(--dashboard-stroke)] first:border-t-0 text-left hover:bg-[var(--dashboard-surface-2)]"
                      onClick={() => router.push(`/cihaz-yonetimi-ana/personel-gecmis7/${row.user.uid}`)}
                    >
                      <div className="sm:col-span-4 font-medium text-[var(--dashboard-text)]">{row.user.name || row.user.email || row.user.uid}</div>
                      <div className="sm:col-span-4 text-sm text-[var(--dashboard-text)] flex items-center gap-1.5">
                        {row.statusTone === 'warning' && <AlertCircle className="h-4 w-4 text-amber-500" />}
                        {row.statusTone === 'info' && <PlayCircle className="h-4 w-4 text-blue-500" />}
                        {row.statusTone === 'success' && <ClipboardCheck className="h-4 w-4 text-emerald-500" />}
                        {row.statusTone === 'neutral' && <CircleDot className="h-3 w-3 text-[var(--dashboard-muted)]" />}
                        <span>{row.statusLabel || '-'}</span>
                      </div>
                      <div className="sm:col-span-4 text-sm text-[var(--dashboard-muted)]">{row.laboratoryName || '-'}</div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="mb-6 sm:mb-8">
            <SectionLabel>Tanımlamalar</SectionLabel>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
              {definitionTools.map((item) => (
                <ToolItem key={item.label} icon={item.icon} label={item.label} onClick={() => router.push(item.href)} />
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>Analizler</SectionLabel>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
              {analysisTools.map((item) => (
                <ToolItem key={item.label} icon={item.icon} label={item.label} onClick={() => router.push(item.href)} />
              ))}
            </div>
          </section>
        </div>
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
              <Textarea
                id="availability-description"
                value={availabilityDescription}
                onChange={(event) => setAvailabilityDescription(event.target.value)}
                placeholder="Örn: Şirket içi eğitim / ofis planlama"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="availability-start-date">Başlangıç Tarihi</Label>
                <Input id="availability-start-date" type="date" value={availabilityStartDate} onChange={(event) => setAvailabilityStartDate(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="availability-start-time">Başlangıç Saati</Label>
                <Input id="availability-start-time" type="time" value={availabilityStartTime} onChange={(event) => setAvailabilityStartTime(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="availability-end-date">Bitiş Tarihi</Label>
                <Input id="availability-end-date" type="date" value={availabilityEndDate} onChange={(event) => setAvailabilityEndDate(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="availability-end-time">Bitiş Saati</Label>
                <Input id="availability-end-time" type="time" value={availabilityEndTime} onChange={(event) => setAvailabilityEndTime(event.target.value)} />
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
