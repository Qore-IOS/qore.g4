'use client';

import React, { useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Plus, Search, User, X } from 'lucide-react';
import type { Device, Hospital, MaintenanceLog, MaintenancePlan } from '@/lib/types';
import { db } from '@/lib/firebase';
import { withCompanyScope } from '@/lib/company-scope';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import {
  calculateDeviceMaintenanceStatus,
  getMaintenanceLogDate,
  periodToDays,
  type BakimTakipStatus,
} from '@/lib/maintenance';
import { cn } from '@/lib/utils';

interface BakimTakipPanelProps {
  hospitals: Hospital[];
  devices: Device[];
  maintenancePlans: MaintenancePlan[];
  maintenanceLogs: MaintenanceLog[];
  onSaved?: () => Promise<void> | void;
}

type ViewMode = 'overview' | 'hospital' | 'device';
type FilterKey = 'all' | 'guncel' | 'uyari' | 'kritik' | 'plansiz';

type EnrichedDevice = {
  device: Device;
  hospital?: Hospital;
  plans: MaintenancePlan[];
  logs: MaintenanceLog[];
  summary: ReturnType<typeof calculateDeviceMaintenanceStatus>;
  category: string;
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

function isCentralLab(hospital?: Hospital) {
  const name = (hospital?.name || hospital?.ad || '').toLocaleLowerCase('tr-TR');
  return name.includes('göztepe merkez') || name.includes('goztepe merkez') || name.includes('merkez lab');
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
  return <span className={cn('inline-flex items-center gap-1 border px-3 py-1 text-xs font-mono', cls)}>{prefix} {label || (status === 'plansiz' ? 'Kritik' : status)}</span>;
}

function MetricCard({ title, value, color, active, onClick }: { title: string; value: number; color: 'green' | 'yellow' | 'red' | 'white'; active?: boolean; onClick?: () => void }) {
  const valueCls = color === 'green' ? 'text-emerald-400' : color === 'yellow' ? 'text-amber-400' : color === 'red' ? 'text-red-500' : 'text-[var(--dashboard-text)]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('min-h-[104px] rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] p-5 text-left shadow-[var(--dashboard-raised-soft)] transition-colors hover:bg-[var(--dashboard-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/40', active && 'ring-2 ring-[var(--dashboard-accent)]')}
    >
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.35em] text-[var(--dashboard-muted)]">{title}</div>
      <div className={cn('font-mono text-4xl font-bold leading-none', valueCls)}>{value}</div>
    </button>
  );
}

export default function BakimTakipPanel({ hospitals, devices, maintenancePlans, maintenanceLogs, onSaved }: BakimTakipPanelProps) {
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<ViewMode>('overview');
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [technician, setTechnician] = useState(currentUserProfile?.name || currentUserProfile?.email || 'Teknisyen');
  const [modalOpen, setModalOpen] = useState(false);
  const [checkedTasks, setCheckedTasks] = useState<string[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const hospitalById = useMemo(() => new Map(hospitals.map((h) => [h.id, h])), [hospitals]);

  const enriched = useMemo<EnrichedDevice[]>(() => devices.map((device) => {
    const realPlans = maintenancePlans.filter((plan) => plan.deviceId === device.id);
    const plans = realPlans.length > 0 ? realPlans : createVirtualPlans(device);
    const logs = maintenanceLogs.filter((log) => log.deviceId === device.id);
    return {
      device,
      hospital: device.hospitalId ? hospitalById.get(device.hospitalId) : undefined,
      plans,
      logs,
      category: getCategory(device),
      summary: calculateDeviceMaintenanceStatus(plans, logs),
    };
  }), [devices, hospitalById, maintenanceLogs, maintenancePlans]);

  const selectedHospital = selectedHospitalId ? hospitalById.get(selectedHospitalId) : undefined;
  const selectedDevice = selectedDeviceId ? enriched.find((d) => d.device.id === selectedDeviceId) : undefined;

  const hospitalsWithDevices = useMemo(() => hospitals
    .map((hospital) => ({ hospital, devs: enriched.filter((item) => item.device.hospitalId === hospital.id) }))
    .filter((item) => item.devs.length > 0)
    .sort((a, b) => (a.hospital.name || '').localeCompare(b.hospital.name || '', 'tr-TR')),
  [enriched, hospitals]);

  const centralDevices = enriched.filter((item) => isCentralLab(item.hospital));
  const peripheralDevices = enriched.filter((item) => !isCentralLab(item.hospital));
  const centralLabel = centralDevices.length > 0 ? 'GÖZTEPE MERKEZ LAB' : 'MERKEZ LAB';

  function groupStats(items: EnrichedDevice[]) {
    return {
      total: items.length,
      guncel: items.filter((d) => d.summary.status === 'guncel').length,
      uyari: items.filter((d) => d.summary.status === 'uyari').length,
      kritik: items.filter((d) => statusBucket(d.summary.status) === 'kritik' || d.summary.status === 'plansiz').length,
    };
  }

  const totalStats = groupStats(enriched);
  const centralStats = groupStats(centralDevices);
  const peripheralStats = groupStats(peripheralDevices);

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
      await Promise.all(selectedPlans.map((plan) => {
        const periodDays = periodToDays(plan) || 60;
        const nextDueDate = new Date(completed.getTime() + periodDays * 24 * 60 * 60 * 1000);
        return addDoc(collection(db, 'maintenanceLogs'), withCompanyScope({
          deviceId: selectedDevice.device.id,
          planId: plan.id,
          taskName: plan.taskName,
          completedAt: Timestamp.fromDate(completed),
          completedByUid: currentUserProfile?.uid || '',
          completedByName: technician,
          nextDueDate: Timestamp.fromDate(nextDueDate),
          formType: plan.type,
          notes: notes.trim() || undefined,
          source: plan.id.startsWith('bakim-takip:') ? 'bakim-takip-source-definition' : 'bakim-takip-panel',
          createdAt: serverTimestamp(),
        }, currentUserProfile?.companyId));
      }));
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

  const lastLogsForDevice = selectedDevice?.logs
    .map((log) => ({ log, completedAt: getMaintenanceLogDate(log) }))
    .filter((item): item is { log: MaintenanceLog; completedAt: Date } => Boolean(item.completedAt))
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime()) ?? [];

  return (
    <div className="min-h-screen bg-transparent text-[var(--dashboard-text)]">
      <div className="flex gap-4 md:gap-6">
        <aside className="hidden w-[268px] shrink-0 rounded-3xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] shadow-[var(--dashboard-raised-soft)] md:block">
          <div className="flex items-center justify-between border-b border-[var(--dashboard-stroke)] px-4 pb-3 pt-5 font-mono text-[10px] uppercase tracking-[0.45em] text-[var(--dashboard-muted)]">
            Kurumlar <span className="rounded-lg border border-[var(--dashboard-stroke)] px-2 py-1 text-sm tracking-normal">+</span>
          </div>
          <div className="max-h-[calc(100vh-142px)] overflow-y-auto pb-6">
            {hospitalsWithDevices.map(({ hospital, devs }) => {
              const stats = groupStats(devs);
              const active = selectedHospitalId === hospital.id;
              return (
                <button key={hospital.id} type="button" onClick={() => goHospital(hospital.id)} className={cn('w-full px-4 py-3 text-left font-mono hover:bg-[var(--dashboard-surface-2)]', active && 'bg-[var(--dashboard-pressed)] text-[var(--dashboard-accent)]')}>
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
              <div>
                <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.45em] text-[var(--dashboard-accent)]">{centralLabel} — {centralStats.total} Cihaz</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard title="Güncel ≤150g" value={centralStats.guncel} color="green" active={filter === 'guncel'} onClick={() => setFilter('guncel')} />
                  <MetricCard title="Uyarı 150-165g" value={centralStats.uyari} color="yellow" active={filter === 'uyari'} onClick={() => setFilter('uyari')} />
                  <MetricCard title="Kritik >165g" value={centralStats.kritik} color="red" active={filter === 'kritik'} onClick={() => setFilter('kritik')} />
                </div>
              </div>
              <div>
                <h2 className="mb-3 font-mono text-sm uppercase tracking-[0.35em] text-[var(--dashboard-muted)]">PERİFER — {peripheralStats.total} Cihaz</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard title="Güncel ≤60g ✓" value={peripheralStats.guncel} color="green" active={filter === 'guncel'} onClick={() => setFilter('guncel')} />
                  <MetricCard title="Uyarı 60-75g" value={peripheralStats.uyari} color="yellow" active={filter === 'uyari'} onClick={() => setFilter('uyari')} />
                  <MetricCard title="Kritik >75g" value={peripheralStats.kritik} color="red" active={filter === 'kritik'} onClick={() => setFilter('kritik')} />
                </div>
              </div>
              <section className="rounded-3xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] p-4 shadow-[var(--dashboard-raised-soft)]">
                <div className="mb-3 font-mono text-xs uppercase tracking-[0.35em] text-[var(--dashboard-muted)]">Bakım Takip Kaynağı — Lab Tanım Listesi</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] border-collapse font-mono text-sm">
                    <thead><tr className="border-b border-[var(--dashboard-stroke)] text-left text-[11px] uppercase tracking-[0.25em] text-[var(--dashboard-muted)]"><th className="px-3 py-3">Lab</th><th className="px-3 py-3">Cihaz</th><th className="px-3 py-3">Tanımlı Bakımlar</th></tr></thead>
                    <tbody>{definitionRows.map((row) => <tr key={row.hospital.id} className="border-b border-[var(--dashboard-stroke)]/70"><td className="px-3 py-3 font-semibold">{String(row.hospital.name || row.hospital.ad || 'Lab')}</td><td className="px-3 py-3">{row.cihazSayisi}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{row.tanimlar.map((tanim) => <span key={tanim} className="rounded-full border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] px-3 py-1 text-xs">{tanim}</span>)}</div></td></tr>)}</tbody>
                  </table>
                </div>
              </section>
              <DeviceTable title={`${filter === 'all' ? 'TÜM' : filter.toLocaleUpperCase('tr-TR')} CİHAZLAR (${activeList.length})`} devices={activeList} onDevice={goDevice} technician={technician} setTechnician={setTechnician} />
            </section>
          )}

          {view === 'hospital' && selectedHospital && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="font-mono text-4xl font-black uppercase tracking-tight">{String(selectedHospital.name || selectedHospital.ad || 'Kurum')}</h1>
                  <p className="mt-2 font-mono text-sm text-[var(--dashboard-muted)]">{activeList.length} cihaz · <span className="text-red-500">{activeList.filter((d) => statusBucket(d.summary.status) === 'kritik').length} kritik</span></p>
                </div>
                <button type="button" className="bg-[var(--dashboard-accent)] px-5 py-3 font-mono text-sm font-bold uppercase text-white hover:brightness-110"><Plus className="mr-1 inline h-4 w-4" /> Cihaz Ekle</button>
              </div>
              <div className="relative"><Search className="absolute left-4 top-3.5 h-4 w-4 text-[var(--dashboard-muted)]" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cihaz ara..." className="w-full border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] px-11 py-3 font-mono outline-none focus:border-[var(--dashboard-accent)]" /></div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {activeList.map((item) => <button key={item.device.id} type="button" onClick={() => goDevice(item.device.id)} className="border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] p-5 text-left font-mono hover:border-[var(--dashboard-accent)] hover:shadow-md">
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
                  <h1 className="font-mono text-4xl font-black uppercase tracking-tight">{selectedDevice.category}</h1>
                  <div className="mt-4 flex flex-wrap items-end gap-3 font-mono"><span className="bg-white px-2 py-1 text-[var(--dashboard-muted)]">{String(selectedDevice.hospital?.name || selectedDevice.hospital?.ad || 'Kurum Yok')}</span><span className="text-xs uppercase tracking-[0.35em] text-[var(--dashboard-muted)]">{selectedDevice.category} S/N</span><span className="text-xl font-black">{deviceSerial(selectedDevice.device)}</span></div>
                </div>
                <button type="button" onClick={openMaintenanceModal} className="bg-[var(--dashboard-accent)] px-5 py-3 font-mono text-sm font-bold uppercase text-white hover:brightness-110">+ Bakım Ekle</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedDevice.summary.planStatuses.map((item) => <StatusPill key={item.plan.id} status={statusBucket(item.status)} label={`${item.plan.taskName} (${item.daysSinceLast ?? 'Yok'}g)`} />)}
              </div>
              <div className="space-y-3">
                {lastLogsForDevice.map(({ log, completedAt }) => <div key={log.id} className="flex items-center gap-5 border border-[var(--dashboard-stroke)] border-l-[var(--dashboard-accent)] border-l-4 bg-white p-4 font-mono">
                  <div className="w-16 text-center"><div className="text-4xl font-black text-[var(--dashboard-accent)]">{day(completedAt)}</div><div className="text-xs uppercase text-[var(--dashboard-muted)]">{monthShort(completedAt)}</div></div>
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-bold"><User className="h-4 w-4 text-purple-800" />{log.completedByName || technician}</div><div className="mt-1 text-[var(--dashboard-muted)]">{log.taskName}</div>{(log as any).notes && <div className="mt-1 text-sm text-[var(--dashboard-muted)]">{(log as any).notes}</div>}</div>
                  <StatusPill status={statusBucket(calculateDeviceMaintenanceStatus(selectedDevice.plans, [log]).status)} label={`${Math.max(0, Math.abs(Math.floor((Date.now() - completedAt.getTime()) / 86400000)))}g`} />
                </div>)}
                {lastLogsForDevice.length === 0 && <div className="border border-dashed border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] p-8 text-center font-mono text-[var(--dashboard-muted)]">Bu cihaz için bakım kaydı yok.</div>}
              </div>
            </section>
          )}
        </main>
      </div>

      {modalOpen && selectedDevice && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 backdrop-blur-sm p-4 pt-8 md:pt-12">
          <div className="w-full max-w-[575px] rounded-3xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] p-8 font-mono shadow-[var(--dashboard-raised)] md:p-10">
            <h2 className="mb-8 text-2xl font-black uppercase tracking-[0.12em]">Bakım Kaydı Ekle</h2>
            <div className="mb-5 border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] px-4 py-3 text-[var(--dashboard-muted)]">{selectedDevice.category} — {String(selectedDevice.hospital?.name || selectedDevice.hospital?.ad || 'Kurum Yok')}</div>
            <label className="mb-2 block text-[11px] uppercase tracking-[0.45em] text-[var(--dashboard-muted)]">Bakım Tarihi</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mb-5 w-full border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] px-4 py-3 outline-none focus:border-[var(--dashboard-accent)]" />
            <label className="mb-2 block text-[11px] uppercase tracking-[0.45em] text-[var(--dashboard-muted)]">Teknisyen</label>
            <input value={technician} onChange={(e) => setTechnician(e.target.value)} className="mb-5 w-full border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] px-4 py-3 text-[var(--dashboard-muted)] outline-none focus:border-[var(--dashboard-accent)]" />
            <label className="mb-2 block text-[11px] uppercase tracking-[0.45em] text-[var(--dashboard-muted)]">Yapılan İşlemler</label>
            <div className="mb-5 space-y-3 border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] p-4">
              {selectedDevice.plans.map((plan) => <label key={plan.id} className="flex min-h-8 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-[var(--dashboard-accent)]" checked={checkedTasks.includes(plan.taskName)} onChange={(e) => setCheckedTasks((prev) => e.target.checked ? [...prev, plan.taskName] : prev.filter((task) => task !== plan.taskName))} />{plan.taskName}</label>)}
            </div>
            <label className="mb-2 block text-[11px] uppercase tracking-[0.45em] text-[var(--dashboard-muted)]">Notlar</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ek notlar..." className="mb-7 min-h-24 w-full border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)] px-4 py-3 outline-none focus:border-[var(--dashboard-accent)]" />
            <div className="flex justify-end gap-3"><button type="button" onClick={() => setModalOpen(false)} className="border border-[var(--dashboard-stroke)] px-6 py-3 hover:border-[var(--dashboard-accent)]">İptal</button><button type="button" disabled={saving || checkedTasks.length === 0} onClick={saveMaintenance} className="bg-[var(--dashboard-accent)] px-6 py-3 font-bold uppercase text-white disabled:opacity-50">{saving ? 'Kaydediliyor...' : 'Kaydet'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function DeviceTable({ title, devices, onDevice, technician, setTechnician }: { title: string; devices: EnrichedDevice[]; onDevice: (id: string) => void; technician: string; setTechnician: (name: string) => void }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.35em] text-[var(--dashboard-muted)]">{title}</h2>
        <div className="flex items-center gap-2"><select value={technician} onChange={(e) => setTechnician(e.target.value)} className="bg-[var(--dashboard-surface)] px-4 py-2 font-mono text-xs uppercase text-[var(--dashboard-accent)] outline-none"><option>{technician}</option></select><X className="h-4 w-4 text-[var(--dashboard-muted)]" /></div>
      </div>
      <div className="overflow-x-auto border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)]">
        <table className="w-full min-w-[620px] border-collapse font-mono">
          <thead><tr className="border-b border-[var(--dashboard-stroke)] text-left text-[11px] uppercase tracking-[0.35em] text-[var(--dashboard-muted)]"><th className="px-4 py-4">Cihaz</th><th className="px-4 py-4">Kurum</th><th className="px-4 py-4">Son Bakım</th><th className="px-4 py-4">Bakım Türü</th></tr></thead>
          <tbody>{devices.map((item) => <tr key={item.device.id} className="cursor-pointer border-b border-[var(--dashboard-stroke)] hover:bg-[var(--dashboard-surface-2)]" onClick={() => onDevice(item.device.id)}><td className="px-4 py-4"><div className="font-black">{item.category}</div><div className="text-[var(--dashboard-muted)]">S/N {deviceSerial(item.device)}</div></td><td className="px-4 py-4"><span className="bg-[var(--dashboard-surface-2)] px-2 py-1 text-[var(--dashboard-muted)]">{String(item.hospital?.name || item.hospital?.ad || '—')}</span></td><td className="px-4 py-4">{fmt(item.summary.lastCompletedAt)}</td><td className="px-4 py-4 font-bold text-emerald-700">{item.summary.worstPlan?.plan.taskName || '—'}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
