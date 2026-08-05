'use client';

import React, { useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Activity, AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Search, Settings2, Wrench } from 'lucide-react';
import type { Device, Hospital, MaintenanceLog, MaintenancePlan, MaintenanceType } from '@/lib/types';
import { db } from '@/lib/firebase';
import { withCompanyScope } from '@/lib/company-scope';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import {
  calculateDeviceMaintenanceStatus,
  getBakimTakipStatusLabel,
  BAKIM_TAKIP_SOURCE_DEFINITIONS,
  type BakimTakipStatus,
} from '@/lib/maintenance';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface BakimTakipPanelProps {
  hospitals: Hospital[];
  devices: Device[];
  maintenancePlans: MaintenancePlan[];
  maintenanceLogs: MaintenanceLog[];
  onSaved?: () => Promise<void> | void;
}

type EnrichedDevice = {
  device: Device;
  hospital?: Hospital;
  plans: MaintenancePlan[];
  logs: MaintenanceLog[];
  summary: ReturnType<typeof calculateDeviceMaintenanceStatus>;
};

const STATUS_CLASS: Record<BakimTakipStatus, string> = {
  guncel: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  uyari: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  kritik: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  bakim_yok: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  plansiz: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
};

function formatDate(date: Date | null | undefined) {
  return date ? format(date, 'dd MMM yyyy', { locale: tr }) : '—';
}

function deviceName(device: Device) {
  return device.cihazAdi || [device.brand, device.model].filter(Boolean).join(' ') || device.model || 'İsimsiz cihaz';
}

function StatusBadge({ status }: { status: BakimTakipStatus }) {
  return <Badge variant="outline" className={cn('min-w-24 justify-center', STATUS_CLASS[status])}>{getBakimTakipStatusLabel(status)}</Badge>;
}

export default function BakimTakipPanel({ hospitals, devices, maintenancePlans, maintenanceLogs, onSaved }: BakimTakipPanelProps) {
  const { currentUserProfile } = useAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<MaintenanceType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<BakimTakipStatus | 'all'>('all');
  const [selected, setSelected] = useState<EnrichedDevice | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const hospitalById = useMemo(() => new Map(hospitals.map((h) => [h.id, h])), [hospitals]);

  const enriched = useMemo<EnrichedDevice[]>(() => {
    return devices.map((device) => {
      const plans = maintenancePlans.filter((plan) => plan.deviceId === device.id && (typeFilter === 'all' || plan.type === typeFilter));
      const logs = maintenanceLogs.filter((log) => log.deviceId === device.id);
      return { device, hospital: device.hospitalId ? hospitalById.get(device.hospitalId) : undefined, plans, logs, summary: calculateDeviceMaintenanceStatus(plans, logs) };
    });
  }, [devices, hospitalById, maintenanceLogs, maintenancePlans, typeFilter]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    return enriched.filter((item) => {
      if (statusFilter !== 'all' && item.summary.status !== statusFilter) return false;
      if (!normalized) return true;
      const haystack = [deviceName(item.device), item.device.seriNumarasi, item.hospital?.name, item.summary.worstPlan?.plan.taskName]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      return haystack.includes(normalized);
    });
  }, [enriched, query, statusFilter]);

  const stats = useMemo(() => ({
    total: enriched.length,
    guncel: enriched.filter((d) => d.summary.status === 'guncel').length,
    uyari: enriched.filter((d) => d.summary.status === 'uyari').length,
    kritik: enriched.filter((d) => d.summary.status === 'kritik' || d.summary.status === 'bakim_yok').length,
    plansiz: enriched.filter((d) => d.summary.status === 'plansiz').length,
  }), [enriched]);

  const selectedPlans = selected?.plans ?? [];

  async function saveLog() {
    const plan = selectedPlans.find((p) => p.id === selectedPlanId);
    if (!selected || !plan || !completedAt) return;
    setIsSaving(true);
    try {
      const completed = new Date(`${completedAt}T00:00:00`);
      const periodDays = plan.periodUnit === 'hafta' ? plan.periodValue * 7 : plan.periodUnit === 'ay' ? plan.periodValue * 30 : plan.periodValue * 365;
      const nextDueDate = new Date(completed.getTime() + periodDays * 24 * 60 * 60 * 1000);
      await addDoc(collection(db, 'maintenanceLogs'), withCompanyScope({
        deviceId: selected.device.id,
        planId: plan.id,
        taskName: plan.taskName,
        completedAt: Timestamp.fromDate(completed),
        completedByUid: currentUserProfile?.uid || '',
        completedByName: currentUserProfile?.name || currentUserProfile?.email || 'Bilinmeyen kullanıcı',
        nextDueDate: Timestamp.fromDate(nextDueDate),
        formType: plan.type,
        notes: notes.trim() || undefined,
        source: 'bakim-takip-panel',
        createdAt: serverTimestamp(),
      }, currentUserProfile?.companyId));
      toast({ title: 'Bakım kaydedildi', description: `${plan.taskName} bakım geçmişine eklendi.` });
      setNotes('');
      setSelected(null);
      await onSaved?.();
    } catch (error) {
      console.error('Bakım kaydı oluşturulamadı:', error);
      toast({ title: 'Hata', description: 'Bakım kaydı oluşturulamadı.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-3xl border bg-gradient-to-br from-cyan-50 via-background to-emerald-50 p-6 shadow-sm dark:from-cyan-950/30 dark:via-background dark:to-emerald-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-sm text-muted-foreground">
              <Wrench className="h-4 w-4 text-cyan-700" /> Bakım Takip Paneli
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Qore cihaz/lab verileriyle periyodik bakım izleme</h1>
            <p className="text-muted-foreground">Tanımlar bakım takip uygulamasındaki bakım kalemlerinden gelir; cihaz ve laboratuvar eşleşmeleri Qore verisinden okunur.</p>
          </div>
          <Card className="min-w-72 bg-background/90">
            <CardHeader className="pb-2"><CardTitle className="text-base">Kaynak Tanımlar</CardTitle><CardDescription>İlk fazda sabit katalog olarak yüklendi.</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {BAKIM_TAKIP_SOURCE_DEFINITIONS.map((d) => <Badge key={`${d.deviceCategory}-${d.taskName}`} variant="secondary">{d.taskName}</Badge>)}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[['Toplam', stats.total, Activity], ['Güncel', stats.guncel, CheckCircle2], ['Uyarı', stats.uyari, CalendarClock], ['Kritik/Bakımsız', stats.kritik, AlertTriangle], ['Plansız', stats.plansiz, Settings2]].map(([label, value, Icon]) => {
          const IconCmp = Icon as typeof Activity;
          return <Card key={String(label)}><CardContent className="flex items-center justify-between p-4"><div><p className="text-sm text-muted-foreground">{String(label)}</p><p className="text-2xl font-semibold">{String(value)}</p></div><IconCmp className="h-5 w-5 text-cyan-700" /></CardContent></Card>;
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cihaz Bakım Durumları</CardTitle>
          <CardDescription>Liste Qore cihazlarından, bakım durumları `maintenancePlans` ve `maintenanceLogs` kayıtlarından hesaplanır.</CardDescription>
          <div className="grid gap-3 pt-3 md:grid-cols-[1fr_180px_180px]">
            <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Cihaz, seri no, lab veya bakım ara" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as MaintenanceType | 'all')}><SelectTrigger><SelectValue placeholder="Bakım tipi" /></SelectTrigger><SelectContent><SelectItem value="all">Tüm tipler</SelectItem><SelectItem value="teknik_servis">Teknik servis</SelectItem><SelectItem value="aplikasyon">Aplikasyon</SelectItem></SelectContent></Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as BakimTakipStatus | 'all')}><SelectTrigger><SelectValue placeholder="Durum" /></SelectTrigger><SelectContent><SelectItem value="all">Tüm durumlar</SelectItem><SelectItem value="guncel">Güncel</SelectItem><SelectItem value="uyari">Uyarı</SelectItem><SelectItem value="kritik">Kritik</SelectItem><SelectItem value="bakim_yok">Bakım yok</SelectItem><SelectItem value="plansiz">Plansız</SelectItem></SelectContent></Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow><TableHead>Cihaz</TableHead><TableHead>Laboratuvar</TableHead><TableHead>Durum</TableHead><TableHead>Kritik Kalem</TableHead><TableHead>Son Bakım</TableHead><TableHead>Sonraki Bakım</TableHead><TableHead className="text-right">İşlem</TableHead></TableRow></TableHeader>
              <TableBody>
                {filtered.map((item) => <TableRow key={item.device.id}>
                  <TableCell><div className="font-medium">{deviceName(item.device)}</div><div className="text-xs text-muted-foreground">Seri: {item.device.seriNumarasi || '—'}</div></TableCell>
                  <TableCell>{item.hospital?.name || '—'}</TableCell>
                  <TableCell><StatusBadge status={item.summary.status} /></TableCell>
                  <TableCell>{item.summary.worstPlan?.plan.taskName || '—'}</TableCell>
                  <TableCell>{formatDate(item.summary.lastCompletedAt)}</TableCell>
                  <TableCell>{formatDate(item.summary.nextDueDate)}</TableCell>
                  <TableCell className="text-right"><Button className="cursor-pointer" size="sm" variant="outline" onClick={() => { setSelected(item); setSelectedPlanId(item.plans[0]?.id || ''); }}><ClipboardList className="mr-2 h-4 w-4" />Bakım Ekle</Button></TableCell>
                </TableRow>)}
                {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">Eşleşen cihaz bulunamadı.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bakım Kaydı Ekle</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><p className="font-medium">{selected ? deviceName(selected.device) : ''}</p><p className="text-sm text-muted-foreground">{selected?.hospital?.name || 'Laboratuvar yok'}</p></div>
            <div className="space-y-2"><Label htmlFor="plan">Bakım kalemi</Label><Select value={selectedPlanId} onValueChange={setSelectedPlanId}><SelectTrigger id="plan"><SelectValue placeholder="Plan seç" /></SelectTrigger><SelectContent>{selectedPlans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.taskName} · {plan.type === 'teknik_servis' ? 'Teknik' : 'Aplikasyon'}</SelectItem>)}</SelectContent></Select>{selectedPlans.length === 0 && <p className="text-sm text-red-600">Bu cihaz için bakım planı yok. Önce Cihaz Tanımlamaları / Periyodik Bakım Yönetimi ekranından plan ekleyin.</p>}</div>
            <div className="space-y-2"><Label htmlFor="completedAt">Bakım tarihi</Label><Input id="completedAt" type="date" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="notes">Not</Label><Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Yapılan işlem, gözlem veya yedek parça bilgisi" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Vazgeç</Button><Button onClick={saveLog} disabled={isSaving || !selectedPlanId || selectedPlans.length === 0}>{isSaving ? 'Kaydediliyor...' : 'Kaydet'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
