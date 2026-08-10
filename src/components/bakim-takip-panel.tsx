'use client';

import React, { useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ArrowLeft, Plus, Search, User } from 'lucide-react';
import type { Device, DeviceLabPool, Hospital, MaintenanceDefinition, MaintenanceLog, MaintenancePlan } from '@/lib/types';
import { db } from '@/lib/firebase';
import { withCompanyScope } from '@/lib/company-scope';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import {
  calculateDeviceMaintenanceStatus,
  getMaintenanceLogDate,
  periodToDays,
  resolveDeviceLabPool,
  type BakimTakipStatus,
} from '@/lib/maintenance';
import { cn } from '@/lib/utils';

interface BakimTakipPanelProps {
  hospitals: Hospital[];
  devices: Device[];
  maintenancePlans: MaintenancePlan[];
  maintenanceLogs: MaintenanceLog[];
  maintenanceDefinitions: MaintenanceDefinition[];
  deviceLabPools: DeviceLabPool[];
  onSaved?: () => Promise<void> | void;
}

type ViewMode = 'overview' | 'hospital' | 'device';
type MaintenanceHistoryRow = MaintenanceLogGroup & { device: EnrichedDevice };
type FilterKey = 'all' | 'guncel' | 'uyari' | 'kritik' | 'plansiz';

type EnrichedDevice = {
  device: Device;
  hospital?: Hospital;
  plans: MaintenancePlan[];
  logs: MaintenanceLog[];
  summary: ReturnType<typeof calculateDeviceMaintenanceStatus>;
  category: string;
};

type MaintenanceLogGroup = {
  id: string;
  logs: MaintenanceLog[];
  completedAt: Date;
  completedByName: string;
  taskNames: string[];
  notes?: string;
};

const SOURCE_TASKS = ['Bakım Kiti', 'Dekon Yapıldı', 'Vacuum Tank', 'Bidon Temizliği'];

function fmt(date?: Date | null) {
  return date ? format(date, 'dd.MM.yyyy', { locale: tr }) : '—';
}

function monthShort(date?: Date | null) {
  return date ? format(date, 'MMM', { locale: tr }).toLocaleUpperCase('tr-TR').slice(0, 3) : '—';
}

function day(date?: Date | null) {
  return date ? format(date, 'dd') : '—';
}

function deviceName(device: Device) {
  return String(device.cihazAdi || device.model || device.brand || 'Cihaz');
}

function deviceSerial(device: Device) {
  return String(device.seriNumarasi || device.serial || device.id.slice(0, 8));
}

function getCategory(device: Device) {
  const text = [device.cihazAdi, device.model, device.brand, device.cihazGrubu, device.groupName]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('tr-TR');
  if (text.includes('ise')) return 'ISE';
  if (text.includes('hormon') || text.includes('cobas e')) return 'Hormon';
  if (text.includes('biyokimya') || text.includes('cobas c')) return 'Biyokimya';
  return String(device.cihazAdi || device.model || 'Biyokimya');
}

function definitionForDevice(device: Device, definitions: MaintenanceDefinition[], pools: DeviceLabPool[]) {
  const pool = resolveDeviceLabPool(device, pools);
  if (!pool) return undefined;
  return definitions.find((definition) => definition.groupName === pool.name && definition.model === device.model);
}

function adaptivePeriodDays(plan: MaintenancePlan, logs: MaintenanceLog[]) {
  const base = periodToDays(plan) || Number((plan as any).periodDays) || 60;
  const matching = logs
    .filter((log) => {
      const taskNames = Array.isArray((log as any).taskNames) ? (log as any).taskNames : [];
      return log.taskName === plan.taskName || taskNames.includes(plan.taskName);
    })
    .map(getMaintenanceLogDate)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime());
  if (matching.length < 2) return base;
  const observed = Math.max(1, Math.round(Math.abs(matching[0].getTime() - matching[1].getTime()) / 86400000));
  return observed !== base ? observed : base;
}

function createDefinitionPlans(device: Device, definition: MaintenanceDefinition | undefined, logs: MaintenanceLog[]): MaintenancePlan[] {
  if (!definition?.tasks?.length) return [];
  return definition.tasks.map((task) => {
    const plan = {
      id: `bakim-definition:${definition.id}:${device.id}:${task.id}`,
      deviceId: device.id,
      taskName: task.taskName,
      periodValue: Number(task.periodDays) || 30,
      periodUnit: 'gun' as any,
      type: task.type || 'teknik_servis',
      sourceDefinitionId: definition.id,
      sourceListName: definition.listName,
    } as MaintenancePlan;
    const nextPeriodDays = adaptivePeriodDays(plan, logs);
    return { ...plan, periodValue: nextPeriodDays };
  });
}

function createVirtualPlans(device: Device): MaintenancePlan[] {
  return SOURCE_TASKS.map((taskName, index) => ({
    id: `bakim-takip:${device.id}:${taskName}`,
    deviceId: device.id,
    taskName,
    periodValue: 60,
    periodUnit: 'gun' as any,
    type: index === 0 || taskName.includes('Vacuum') ? 'teknik_servis' : 'aplikasyon',
  }));
}

function groupMaintenanceLogs(logs: MaintenanceLog[]): MaintenanceLogGroup[] {
  const groups = new Map<string, MaintenanceLogGroup>();

  logs.forEach((log) => {
    const completedAt = getMaintenanceLogDate(log);
    if (!completedAt) return;
    const taskNames = Array.isArray((log as any).taskNames) && (log as any).taskNames.length > 0
      ? (log as any).taskNames.map(String)
      : [log.taskName].filter(Boolean).map(String);
    const notes = String((log as any).notes || '');
    const batchKey = String((log as any).maintenanceBatchId || (log as any).formId || [completedAt.toISOString(), log.completedByUid || log.completedByName || '', notes].join('|'));
    const existing = groups.get(batchKey);

    if (existing) {
      existing.logs.push(log);
      taskNames.forEach((task) => {
        if (!existing.taskNames.includes(task)) existing.taskNames.push(task);
      });
      if (!existing.notes && notes) existing.notes = notes;
      return;
    }

    groups.set(batchKey, {
      id: batchKey,
      logs: [log],
      completedAt,
      completedByName: log.completedByName || 'Teknisyen',
      taskNames,
      notes: notes || undefined,
    });
  });

  return Array.from(groups.values()).sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
}

function statusBucket(status: BakimTakipStatus): FilterKey {
  if (status === 'guncel' || status === 'uyari') return status;
  if (status === 'plansiz') return 'plansiz';
  return 'kritik';
}

function StatusPill({ status, label }: { status: FilterKey; label?: string }) {
  const cls = status === 'guncel'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status === 'uyari'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-red-200 bg-red-50 text-red-600';
  const prefix = status === 'guncel' ? '✓' : status === 'uyari' ? '!' : 'X';
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_3px_7px_rgba(61,73,120,0.12)]', cls)}>{prefix} {label || (status === 'plansiz' ? 'Kritik' : status)}</span>;
}

function MetricCard({ title, value, color, active, onClick }: { title: string; value: number; color: 'green' | 'yellow' | 'red' | 'white'; active?: boolean; onClick?: () => void }) {
  const valueCls = color === 'green' ? 'text-emerald-400' : color === 'yellow' ? 'text-amber-400' : color === 'red' ? 'text-red-500' : 'text-[var(--dashboard-text)]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('min-h-[112px] rounded-[28px] border border-white/60 bg-[var(--dashboard-surface)] p-5 text-left shadow-[7px_7px_16px_rgba(61,73,120,0.16),-5px_-5px_14px_rgba(255,255,255,0.72),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all hover:-translate-y-0.5 hover:bg-[var(--dashboard-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/40 active:translate-y-0 active:shadow-[inset_3px_3px_8px_rgba(61,73,120,0.14)]', active && 'ring-2 ring-[var(--dashboard-accent)]')}
    >
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--dashboard-muted)]">{title}</div>
      <div className={cn('text-4xl font-black leading-none', valueCls)}>{value}</div>
    </button>
  );
}

export default function BakimTakipPanel({ hospitals, devices, maintenancePlans, maintenanceLogs, maintenanceDefinitions, deviceLabPools, onSaved }: BakimTakipPanelProps) {
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<ViewMode>('overview');
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [selectedMaintenance, setSelectedMaintenance] = useState('all');
  const [technician, setTechnician] = useState(currentUserProfile?.name || currentUserProfile?.email || 'Teknisyen');
  const [modalOpen, setModalOpen] = useState(false);
  const [checkedTasks, setCheckedTasks] = useState<string[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const hospitalById = useMemo(() => new Map(hospitals.map((h) => [h.id, h])), [hospitals]);

  const enriched = useMemo<EnrichedDevice[]>(() => devices.map((device) => {
    const logs = maintenanceLogs.filter((log) => log.deviceId === device.id);
    const definitionPlans = createDefinitionPlans(device, definitionForDevice(device, maintenanceDefinitions, deviceLabPools), logs);
    const realPlans = maintenancePlans.filter((plan) => plan.deviceId === device.id);
    const plans = definitionPlans.length > 0 ? definitionPlans : realPlans;
    return {
      device,
      hospital: device.hospitalId ? hospitalById.get(device.hospitalId) : undefined,
      plans,
      logs,
      category: getCategory(device),
      summary: calculateDeviceMaintenanceStatus(plans, logs),
    };
  }), [deviceLabPools, devices, hospitalById, maintenanceDefinitions, maintenanceLogs, maintenancePlans]);

  const selectedHospital = selectedHospitalId ? hospitalById.get(selectedHospitalId) : undefined;
  const selectedDevice = selectedDeviceId ? enriched.find((d) => d.device.id === selectedDeviceId) : undefined;

  const hospitalsWithDevices = useMemo(() => hospitals
    .map((hospital) => ({ hospital, devs: enriched.filter((item) => item.device.hospitalId === hospital.id) }))
    .filter((item) => item.devs.length > 0)
    .sort((a, b) => (a.hospital.name || '').localeCompare(b.hospital.name || '', 'tr-TR')),
  [enriched, hospitals]);

  const groupedByLabPool = useMemo(() => {
    const rows = deviceLabPools.map((pool) => ({
      id: pool.id,
      name: pool.name,
      devices: enriched.filter((item) => pool.memberIds.includes(String(item.device.hospitalId || ''))),
    }));
    const groupedHospitalIds = new Set(deviceLabPools.flatMap((pool) => pool.memberIds));
    const ungrouped = enriched.filter((item) => !groupedHospitalIds.has(String(item.device.hospitalId || '')));
    if (ungrouped.length > 0) {
      rows.push({ id: 'ungrouped', name: 'Gruplanmamış Laboratuvarlar', devices: ungrouped });
    }
    return rows.filter((row) => row.devices.length > 0);
  }, [deviceLabPools, enriched]);

  function groupStats(items: EnrichedDevice[]) {
    return {
      total: items.length,
      guncel: items.filter((d) => d.summary.status === 'guncel').length,
      uyari: items.filter((d) => d.summary.status === 'uyari').length,
      kritik: items.filter((d) => statusBucket(d.summary.status) === 'kritik' || d.summary.status === 'plansiz').length,
    };
  }

  const totalStats = groupStats(enriched);

  const maintenanceOptions = useMemo(() => Array.from(new Set(enriched.flatMap(item => item.plans.map(plan => plan.taskName)))).sort((a, b) => a.localeCompare(b, 'tr-TR')), [enriched]);
  const selectedMaintenanceHistory = useMemo<MaintenanceHistoryRow[]>(() => {
    if (selectedMaintenance === 'all') return [];
    return enriched.flatMap((item) => groupMaintenanceLogs(item.logs)
      .filter((group) => group.taskNames.includes(selectedMaintenance))
      .map((group) => ({ ...group, device: item })));
  }, [enriched, selectedMaintenance]);

  const definitionRows = useMemo(() => hospitalsWithDevices.map(({ hospital, devs }) => ({
    hospital,
    cihazSayisi: devs.length,
    tanimlar: Array.from(new Set(devs.flatMap((item) => item.plans.map((plan) => plan.taskName)))).sort((a, b) => a.localeCompare(b, 'tr-TR')),
  })), [hospitalsWithDevices]);

  const activeList = useMemo(() => {
    const scoped = view === 'hospital' && selectedHospitalId
      ? enriched.filter((item) => item.device.hospitalId === selectedHospitalId)
      : view === 'device' && selectedDevice
        ? [selectedDevice]
        : enriched;
    const q = query.trim().toLocaleLowerCase('tr-TR');
    return scoped.filter((item) => {
      if (filter !== 'all' && statusBucket(item.summary.status) !== filter) return false;
      if (!q) return true;
      return [deviceName(item.device), deviceSerial(item.device), item.hospital?.name, item.category]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(q);
    });
  }, [enriched, filter, query, selectedDevice, selectedHospitalId, view]);

  function goHospital(id: string) {
    setSelectedHospitalId(id);
    setSelectedDeviceId(null);
    setView('hospital');
    setQuery('');
  }

  function goDevice(id: string) {
    const item = enriched.find((d) => d.device.id === id);
    if (!item) return;
    setSelectedHospitalId(item.device.hospitalId || null);
    setSelectedDeviceId(id);
    setView('device');
    setCheckedTasks([]);
  }

  function openMaintenanceModal() {
    const firstTasks = selectedDevice?.plans.map((p) => p.taskName) ?? [];
    setCheckedTasks(firstTasks.slice(0, 0));
    setModalOpen(true);
  }

  async function saveMaintenance() {
    if (!selectedDevice || checkedTasks.length === 0) return;
    setSaving(true);
    try {
      const completed = new Date(`${date}T00:00:00`);
      const selectedPlans = selectedDevice.plans.filter((p) => checkedTasks.includes(p.taskName));
      if (selectedPlans.length === 0) return;
      const periodDays = Math.min(...selectedPlans.map((plan) => periodToDays(plan) || 60));
      const nextDueDate = new Date(completed.getTime() + periodDays * 24 * 60 * 60 * 1000);
      const maintenanceBatchId = `bakim-takip:${selectedDevice.device.id}:${completed.getTime()}:${Date.now()}`;
      await addDoc(collection(db, 'maintenanceLogs'), withCompanyScope({
        deviceId: selectedDevice.device.id,
        planId: selectedPlans[0]?.id || maintenanceBatchId,
        planIds: selectedPlans.map((plan) => plan.id),
        taskName: selectedPlans.map((plan) => plan.taskName).join(', '),
        taskNames: selectedPlans.map((plan) => plan.taskName),
        completedAt: Timestamp.fromDate(completed),
        completedByUid: currentUserProfile?.uid || '',
        completedByName: technician,
        nextDueDate: Timestamp.fromDate(nextDueDate),
        formType: selectedPlans.some((plan) => plan.type === 'teknik_servis') ? 'teknik_servis' : 'aplikasyon',
        notes: notes.trim() || undefined,
        source: selectedPlans.some((plan) => plan.id.startsWith('bakim-takip:')) ? 'bakim-takip-source-definition' : 'bakim-takip-panel',
        maintenanceBatchId,
        createdAt: serverTimestamp(),
      }, currentUserProfile?.companyId));
      toast({ title: 'Bakım kaydedildi', description: `${checkedTasks.length} işlem bakım geçmişine eklendi.` });
      setModalOpen(false);
      setCheckedTasks([]);
      setNotes('');
      await onSaved?.();
    } catch (error) {
      console.error('Bakım kaydı oluşturulamadı:', error);
      toast({ title: 'Hata', description: 'Bakım kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  const lastLogGroupsForDevice = selectedDevice ? groupMaintenanceLogs(selectedDevice.logs) : [];

  return (
    <div className="min-h-screen bg-transparent font-sans text-[var(--dashboard-text)]">
      <button type="button" onClick={() => view === 'overview' ? window.history.back() : setView('overview')} className="fixed left-4 top-4 z-40 inline-flex min-h-12 min-w-12 items-center justify-center rounded-[20px] border border-white/70 bg-[var(--dashboard-surface)] text-[var(--dashboard-text)] shadow-[6px_6px_14px_rgba(61,73,120,0.18),-4px_-4px_12px_rgba(255,255,255,0.75),inset_0_1px_0_white] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/40 active:translate-y-0 active:shadow-inner" aria-label="Geri"><ArrowLeft className="h-5 w-5" /></button>
      <div className="flex gap-4 md:gap-6">
        <aside className="hidden w-[268px] shrink-0 rounded-[32px] border border-white/60 bg-[var(--dashboard-surface)] shadow-[8px_8px_20px_rgba(61,73,120,0.16),-6px_-6px_16px_rgba(255,255,255,0.7),inset_0_1px_0_white] md:block">
          <div className="flex items-center justify-between border-b border-[var(--dashboard-stroke)] px-5 pb-4 pt-6 text-[10px] font-semibold uppercase tracking-[0.4em] text-[var(--dashboard-muted)]">
            Kurumlar <span className="rounded-xl border border-white/70 bg-[var(--dashboard-surface-2)] px-2.5 py-1 text-sm tracking-normal shadow-[3px_3px_7px_rgba(61,73,120,0.13),-2px_-2px_5px_white]">+</span>
          </div>
          <div className="max-h-[calc(100vh-142px)] overflow-y-auto pb-6">
            {hospitalsWithDevices.map(({ hospital, devs }) => {
              const stats = groupStats(devs);
              const active = selectedHospitalId === hospital.id;
              return (
                <button key={hospital.id} type="button" onClick={() => goHospital(hospital.id)} className={cn('mx-3 my-2 w-[calc(100%-1.5rem)] rounded-2xl px-4 py-3 text-left font-semibold transition-all hover:bg-[var(--dashboard-surface-2)] hover:shadow-[4px_4px_10px_rgba(61,73,120,0.12),-3px_-3px_8px_white]', active && 'bg-[var(--dashboard-pressed)] text-[var(--dashboard-accent)] shadow-inner')}>
                  <div className="truncate text-sm">{hospital.name}</div>
                  <div className="mt-1 text-[11px] text-[var(--dashboard-muted)]">{stats.total} cihaz · <span className="text-red-500">{stats.kritik} kritik</span></div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="w-full min-w-0 pb-20 md:pb-0">
          {view === 'overview' && (
            <section className="space-y-7">
              <MetricCard title="Toplam Cihaz" value={totalStats.total} color="white" onClick={() => setFilter('all')} active={filter === 'all'} />
              {groupedByLabPool.map((group) => {
                const stats = groupStats(group.devices);
                return (
                  <div key={group.id}>
                    <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.35em] text-[var(--dashboard-accent)]">{group.name.toLocaleUpperCase('tr-TR')} — {stats.total} Cihaz</h2>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <MetricCard title="Güncel" value={stats.guncel} color="green" active={filter === 'guncel'} onClick={() => setFilter('guncel')} />
                      <MetricCard title="Uyarı" value={stats.uyari} color="yellow" active={filter === 'uyari'} onClick={() => setFilter('uyari')} />
                      <MetricCard title="Kritik" value={stats.kritik} color="red" active={filter === 'kritik'} onClick={() => setFilter('kritik')} />
                    </div>
                  </div>
                );
              })}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-xs font-bold uppercase tracking-[0.3em] text-[var(--dashboard-muted)]">
                  Kurum Seçin
                  <select value={selectedHospitalId || 'all'} onChange={(event) => event.target.value === 'all' ? setSelectedHospitalId(null) : goHospital(event.target.value)} className="mt-3 w-full rounded-[22px] border border-white/70 bg-[var(--dashboard-surface)] px-5 py-4 text-sm font-semibold normal-case tracking-normal text-[var(--dashboard-text)] shadow-[5px_5px_12px_rgba(61,73,120,0.14),-4px_-4px_10px_rgba(255,255,255,0.75),inset_0_1px_0_white] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/35">
                    <option value="all">— Kurum Seçiniz —</option>
                    {hospitalsWithDevices.map(({ hospital }) => <option key={hospital.id} value={hospital.id}>{String(hospital.name || hospital.ad || 'Kurum')}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.3em] text-[var(--dashboard-muted)]">
                  Bakım Seçimi
                  <select value={selectedMaintenance} onChange={(event) => setSelectedMaintenance(event.target.value)} className="mt-3 w-full rounded-[22px] border border-white/70 bg-[var(--dashboard-surface)] px-5 py-4 text-sm font-semibold normal-case tracking-normal text-[var(--dashboard-text)] shadow-[5px_5px_12px_rgba(61,73,120,0.14),-4px_-4px_10px_rgba(255,255,255,0.75),inset_0_1px_0_white] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/35">
                    <option value="all">— Bakım Seçiniz —</option>
                    {maintenanceOptions.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              </div>
              {selectedMaintenance !== 'all' && <MaintenanceHistoryList title={`${selectedMaintenance} Geçmişi (${selectedMaintenanceHistory.length})`} rows={selectedMaintenanceHistory} />}
              <section className="rounded-[32px] border border-white/60 bg-[var(--dashboard-surface)] p-5 shadow-[8px_8px_20px_rgba(61,73,120,0.15),-6px_-6px_16px_rgba(255,255,255,0.72),inset_0_1px_0_white]">
                <div className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-[var(--dashboard-muted)]">Bakım Takip Kaynağı — Lab Tanım Listesi</div>
                <div className="space-y-3 md:hidden">
                  {definitionRows.map((row) => (
                    <article key={row.hospital.id} className="min-w-0 rounded-[24px] border border-white/60 bg-[var(--dashboard-surface-2)] p-4 shadow-[5px_5px_12px_rgba(61,73,120,0.12),-3px_-3px_9px_rgba(255,255,255,0.65),inset_0_1px_0_white]">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <h3 className="min-w-0 break-words text-sm font-bold leading-5">{String(row.hospital.name || row.hospital.ad || 'Lab')}</h3>
                        <span className="shrink-0 rounded-full border border-[var(--dashboard-stroke)] px-2.5 py-1 text-xs">{row.cihazSayisi} cihaz</span>
                      </div>
                      <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                        {row.tanimlar.length > 0 ? row.tanimlar.map((tanim) => (
                          <span key={tanim} className="max-w-full break-words rounded-full border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] px-3 py-1.5 text-xs leading-4">{tanim}</span>
                        )) : <span className="text-xs text-[var(--dashboard-muted)]">Bakım tanımı yok</span>}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[620px] border-collapse text-sm">
                    <thead><tr className="border-b border-[var(--dashboard-stroke)] text-left text-[11px] uppercase tracking-[0.25em] text-[var(--dashboard-muted)]"><th className="px-3 py-3">Lab</th><th className="px-3 py-3">Cihaz</th><th className="px-3 py-3">Tanımlı Bakımlar</th></tr></thead>
                    <tbody>{definitionRows.map((row) => <tr key={row.hospital.id} className="border-b border-[var(--dashboard-stroke)]/70"><td className="px-3 py-3 font-semibold">{String(row.hospital.name || row.hospital.ad || 'Lab')}</td><td className="px-3 py-3">{row.cihazSayisi}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{row.tanimlar.map((tanim) => <span key={tanim} className="rounded-full border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] px-3 py-1 text-xs">{tanim}</span>)}</div></td></tr>)}</tbody>
                  </table>
                </div>
              </section>
            </section>
          )}

          {view === 'hospital' && selectedHospital && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-4xl font-black uppercase tracking-tight">{String(selectedHospital.name || selectedHospital.ad || 'Kurum')}</h1>
                  <p className="mt-2 text-sm font-medium text-[var(--dashboard-muted)]">{activeList.length} cihaz · <span className="text-red-500">{activeList.filter((d) => statusBucket(d.summary.status) === 'kritik').length} kritik</span></p>
                </div>
                <button type="button" className="rounded-[18px] border border-white/30 bg-[var(--dashboard-accent)] px-5 py-3 text-sm font-black uppercase text-white shadow-[5px_5px_12px_rgba(61,73,120,0.2),inset_0_1px_0_rgba(255,255,255,0.35)] transition-transform hover:-translate-y-0.5 active:translate-y-0 active:shadow-inner"><Plus className="mr-1 inline h-4 w-4" /> Cihaz Ekle</button>
              </div>
              <div className="relative"><Search className="absolute left-4 top-3.5 h-4 w-4 text-[var(--dashboard-muted)]" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cihaz ara..." className="w-full rounded-[22px] border border-white/70 bg-[var(--dashboard-surface)] px-11 py-4 font-semibold shadow-[5px_5px_12px_rgba(61,73,120,0.14),-4px_-4px_10px_rgba(255,255,255,0.72),inset_0_1px_0_white] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/35" /></div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {activeList.map((item) => <button key={item.device.id} type="button" onClick={() => goDevice(item.device.id)} className="rounded-[26px] border border-white/65 bg-[var(--dashboard-surface)] p-5 text-left shadow-[6px_6px_14px_rgba(61,73,120,0.14),-4px_-4px_12px_rgba(255,255,255,0.72),inset_0_1px_0_white] transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-[var(--dashboard-accent)]/25 active:translate-y-0 active:shadow-inner">
                  <div className="flex justify-between gap-3"><div><div className="font-bold">{item.category}</div><div className="mt-2 text-lg font-black">S/N: {deviceSerial(item.device)}</div></div><span className="text-[var(--dashboard-muted)]">⌫</span></div>
                  <div className="mt-4 text-xs text-[var(--dashboard-muted)]">Son Bakım</div>
                  <div className="mt-1 flex items-center justify-between"><span>{fmt(item.summary.lastCompletedAt)}</span><StatusPill status={statusBucket(item.summary.status)} label={statusBucket(item.summary.status) === 'kritik' ? 'Kritik' : undefined} /></div>
                </button>)}
              </div>
            </section>
          )}

          {view === 'device' && selectedDevice && (
            <section className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-4xl font-black uppercase tracking-tight">{selectedDevice.category}</h1>
                  <div className="mt-4 flex flex-wrap items-end gap-3"><span className="rounded-full bg-[var(--dashboard-surface-2)] px-3 py-1.5 font-semibold text-[var(--dashboard-muted)] shadow-inner">{String(selectedDevice.hospital?.name || selectedDevice.hospital?.ad || 'Kurum Yok')}</span><span className="text-xs uppercase tracking-[0.35em] text-[var(--dashboard-muted)]">{selectedDevice.category} S/N</span><span className="text-xl font-black">{deviceSerial(selectedDevice.device)}</span></div>
                </div>
                <button type="button" onClick={openMaintenanceModal} className="rounded-[18px] border border-white/30 bg-[var(--dashboard-accent)] px-5 py-3 text-sm font-black uppercase text-white shadow-[5px_5px_12px_rgba(61,73,120,0.2),inset_0_1px_0_rgba(255,255,255,0.35)] transition-transform hover:-translate-y-0.5 active:translate-y-0 active:shadow-inner">+ Bakım Ekle</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedDevice.summary.planStatuses.map((item) => <StatusPill key={item.plan.id} status={statusBucket(item.status)} label={`${item.plan.taskName} (${item.daysSinceLast ?? 'Yok'}g)`} />)}
              </div>
              <div className="space-y-3">
                {lastLogGroupsForDevice.map((group) => <div key={group.id} className="flex items-center gap-5 rounded-[26px] border border-white/65 border-l-[var(--dashboard-accent)] border-l-4 bg-[var(--dashboard-surface)] p-4 shadow-[6px_6px_14px_rgba(61,73,120,0.13),-4px_-4px_11px_rgba(255,255,255,0.7),inset_0_1px_0_white]">
                  <div className="w-16 text-center"><div className="text-4xl font-black text-[var(--dashboard-accent)]">{day(group.completedAt)}</div><div className="text-xs uppercase text-[var(--dashboard-muted)]">{monthShort(group.completedAt)}</div></div>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-bold"><User className="h-4 w-4 text-purple-800" />{group.completedByName || technician}</div><div className="mt-2 flex flex-wrap gap-2">{group.taskNames.map((task) => <span key={task} className="rounded-full border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] px-3 py-1 text-xs text-[var(--dashboard-muted)]">{task}</span>)}</div>{group.notes && <div className="mt-2 text-sm text-[var(--dashboard-muted)]">{group.notes}</div>}</div>
                  <StatusPill status={statusBucket(calculateDeviceMaintenanceStatus(selectedDevice.plans, group.logs).status)} label={`${Math.max(0, Math.abs(Math.floor((Date.now() - group.completedAt.getTime()) / 86400000)))}g`} />
                </div>)}
                {lastLogGroupsForDevice.length === 0 && <div className="rounded-[26px] border border-dashed border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] p-8 text-center font-semibold text-[var(--dashboard-muted)] shadow-inner">Bu cihaz için bakım kaydı yok.</div>}
              </div>
            </section>
          )}
        </main>
      </div>

      {modalOpen && selectedDevice && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 backdrop-blur-sm p-4 pt-8 md:pt-12">
          <div className="w-full max-w-[575px] rounded-[34px] border border-white/70 bg-[var(--dashboard-surface)] p-8 shadow-[12px_12px_28px_rgba(29,36,70,0.25),-7px_-7px_18px_rgba(255,255,255,0.55),inset_0_1px_0_white] md:p-10">
            <h2 className="mb-8 text-2xl font-black uppercase tracking-[0.12em]">Bakım Kaydı Ekle</h2>
            <div className="mb-5 rounded-[20px] border border-white/60 bg-[var(--dashboard-surface-2)] px-4 py-3 font-semibold shadow-inner text-[var(--dashboard-muted)]">{selectedDevice.category} — {String(selectedDevice.hospital?.name || selectedDevice.hospital?.ad || 'Kurum Yok')}</div>
            <label className="mb-2 block text-[11px] uppercase tracking-[0.45em] text-[var(--dashboard-muted)]">Bakım Tarihi</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mb-5 w-full rounded-[18px] border border-white/65 bg-[var(--dashboard-surface-2)] px-4 py-3 shadow-inner outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/35" />
            <label className="mb-2 block text-[11px] uppercase tracking-[0.45em] text-[var(--dashboard-muted)]">Teknisyen</label>
            <input value={technician} onChange={(e) => setTechnician(e.target.value)} className="mb-5 w-full rounded-[18px] border border-white/65 bg-[var(--dashboard-surface-2)] px-4 py-3 text-[var(--dashboard-muted)] shadow-inner outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/35" />
            <label className="mb-2 block text-[11px] uppercase tracking-[0.45em] text-[var(--dashboard-muted)]">Yapılan İşlemler</label>
            <div className="mb-5 space-y-3 rounded-[22px] border border-white/65 bg-[var(--dashboard-surface-2)] p-4 shadow-inner">
              {selectedDevice.plans.map((plan) => <label key={plan.id} className="flex min-h-8 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[var(--dashboard-accent)]" checked={checkedTasks.includes(plan.taskName)} onChange={(e) => setCheckedTasks((prev) => e.target.checked ? [...prev, plan.taskName] : prev.filter((task) => task !== plan.taskName))} />{plan.taskName}</label>)}
            </div>
            <label className="mb-2 block text-[11px] uppercase tracking-[0.45em] text-[var(--dashboard-muted)]">Notlar</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ek notlar..." className="mb-7 min-h-24 w-full rounded-[20px] border border-white/65 bg-[var(--dashboard-surface-2)] px-4 py-3 shadow-inner outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/35" />
            <div className="flex justify-end gap-3"><button type="button" onClick={() => setModalOpen(false)} className="rounded-[18px] border border-white/70 bg-[var(--dashboard-surface)] px-6 py-3 font-semibold shadow-[4px_4px_10px_rgba(61,73,120,0.14),-3px_-3px_8px_white] hover:-translate-y-0.5 active:translate-y-0 active:shadow-inner">İptal</button><button type="button" disabled={saving || checkedTasks.length === 0} onClick={saveMaintenance} className="rounded-[18px] border border-white/30 bg-[var(--dashboard-accent)] px-6 py-3 font-black uppercase text-white shadow-[5px_5px_12px_rgba(61,73,120,0.2),inset_0_1px_0_rgba(255,255,255,0.35)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-inner disabled:opacity-50">{saving ? 'Kaydediliyor...' : 'Kaydet'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function MaintenanceHistoryList({ title, rows }: { title: string; rows: MaintenanceHistoryRow[] }) {
  return (
    <section className="rounded-[32px] border border-white/65 bg-[var(--dashboard-surface)] p-5 shadow-[8px_8px_20px_rgba(61,73,120,0.15),-6px_-6px_16px_rgba(255,255,255,0.72),inset_0_1px_0_white]">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.3em] text-[var(--dashboard-muted)]">{title}</h2>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={`${row.device.device.id}-${row.id}`} className="flex flex-col gap-3 rounded-[26px] border border-white/60 bg-[var(--dashboard-surface-2)] p-4 shadow-[5px_5px_12px_rgba(61,73,120,0.12),-3px_-3px_9px_rgba(255,255,255,0.65),inset_0_1px_0_white] md:flex-row md:items-center">
            <div className="w-16 text-center">
              <div className="text-3xl font-black text-[var(--dashboard-accent)]">{day(row.completedAt)}</div>
              <div className="text-xs uppercase text-[var(--dashboard-muted)]">{monthShort(row.completedAt)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[var(--dashboard-text)]">{deviceName(row.device.device)} · S/N {deviceSerial(row.device.device)}</div>
              <div className="mt-1 text-sm text-[var(--dashboard-muted)]">{String(row.device.hospital?.name || row.device.hospital?.ad || 'Kurum Yok')} · {row.completedByName}</div>
              <div className="mt-2 flex flex-wrap gap-2">{row.taskNames.map(task => <span key={task} className="rounded-full border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] px-3 py-1 text-xs">{task}</span>)}</div>
              {row.notes && <div className="mt-2 text-sm text-[var(--dashboard-muted)]">{row.notes}</div>}
            </div>
            <StatusPill status={statusBucket(row.device.summary.status)} label={fmt(row.device.summary.lastCompletedAt)} />
          </div>
        ))}
        {rows.length === 0 && <div className="rounded-[24px] border border-dashed border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] p-8 text-center font-semibold text-[var(--dashboard-muted)] shadow-inner">Bu bakım seçimi için geçmiş kayıt yok.</div>}
      </div>
    </section>
  );
}
