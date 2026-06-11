'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import type { MaintenancePlan, MaintenanceLog, PeriodicPartChange, PeriodicPartChangeLog, Device, Hospital } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import BackButton from '@/components/BackButton';
import { Loader2, Trash2, Search, Wrench, Package, Calendar, AlertTriangle, Building2, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type EnrichedMaintenancePlan = MaintenancePlan & {
  deviceName: string;
  hospitalName: string;
  lastLog?: MaintenanceLog;
  daysRemaining: number | null;
  isOverdue: boolean;
};

type EnrichedPeriodicPart = PeriodicPartChange & {
  deviceName: string;
  hospitalName: string;
  lastLog?: PeriodicPartChangeLog;
  daysRemaining: number | null;
  isOverdue: boolean;
};

const PERIOD_UNIT_LABELS: Record<string, string> = {
  hafta: 'Hafta',
  ay: 'Ay',
  yil: 'Yıl',
};

export default function PeriyodikBakimYonetimiPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLabFilter, setSelectedLabFilter] = useState<string>('all');

  const [maintenancePlans, setMaintenancePlans] = useState<MaintenancePlan[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);
  const [periodicParts, setPeriodicParts] = useState<PeriodicPartChange[]>([]);
  const [periodicPartLogs, setPeriodicPartLogs] = useState<PeriodicPartChangeLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: string; type: 'plan' | 'part'; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [plansSnap, logsSnap, partsSnap, partLogsSnap, devicesSnap, hospitalsSnap] = await Promise.all([
        getDocsResilient(scopedQuery('maintenancePlans', currentCompanyId, isSuperAdmin)),
        getDocsResilient(scopedQuery('maintenanceLogs', currentCompanyId, isSuperAdmin, orderBy('completedAt', 'desc'))),
        getDocsResilient(scopedQuery('periodicPartChanges', currentCompanyId, isSuperAdmin)),
        getDocsResilient(scopedQuery('periodicPartChangeLogs', currentCompanyId, isSuperAdmin, orderBy('completedAt', 'desc'))),
        getDocsResilient(scopedQuery('devices', currentCompanyId, isSuperAdmin)),
        getDocsResilient(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
      ]);

      setMaintenancePlans(plansSnap.docs.map(d => ({ id: d.id, ...d.data() }) as MaintenancePlan));
      setMaintenanceLogs(logsSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, ...data,
          completedAt: data.completedAt?.toDate?.() || new Date(data.completedAt),
          nextDueDate: data.nextDueDate?.toDate?.() || new Date(data.nextDueDate),
        } as MaintenanceLog;
      }));
      setPeriodicParts(partsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PeriodicPartChange));
      setPeriodicPartLogs(partLogsSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, ...data,
          completedAt: data.completedAt?.toDate?.() || new Date(data.completedAt),
          nextDueDate: data.nextDueDate?.toDate?.() || new Date(data.nextDueDate),
        } as PeriodicPartChangeLog;
      }));
      setDevices(devicesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Device));
      setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Hospital));
    } catch (err) {
      console.error('Error loading data:', err);
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const enrichedPlans = useMemo<EnrichedMaintenancePlan[]>(() => {
    const now = new Date();
    return maintenancePlans.map(plan => {
      const device = devices.find(d => d.id === plan.deviceId);
      const hospital = device?.hospitalId ? hospitals.find(h => h.id === device.hospitalId) : undefined;
      const lastLog = maintenanceLogs.find(l => l.planId === plan.id);

      let daysRemaining: number | null = null;
      let isOverdue = false;

      if (lastLog?.nextDueDate) {
        const nextDue = lastLog.nextDueDate instanceof Date ? lastLog.nextDueDate : new Date(lastLog.nextDueDate);
        daysRemaining = Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        isOverdue = daysRemaining < 0;
      }

      return {
        ...plan,
        deviceName: device?.cihazAdi || device?.model || 'Bilinmeyen Cihaz',
        hospitalName: hospital?.name || 'Bilinmeyen Lab',
        lastLog,
        daysRemaining,
        isOverdue,
      };
    });
  }, [maintenancePlans, maintenanceLogs, devices, hospitals]);

  const enrichedParts = useMemo<EnrichedPeriodicPart[]>(() => {
    const now = new Date();
    return periodicParts.map(part => {
      const device = devices.find(d => d.id === part.deviceId);
      const hospital = device?.hospitalId ? hospitals.find(h => h.id === device.hospitalId) : undefined;
      const lastLog = periodicPartLogs.find(l => l.periodicPartChangeId === part.id);

      let daysRemaining: number | null = null;
      let isOverdue = false;

      const nextDueSource = lastLog?.nextDueDate || part.nextDueDate;
      if (nextDueSource) {
        const nextDue = nextDueSource instanceof Date ? nextDueSource : (nextDueSource?.toDate?.() || new Date(nextDueSource));
        daysRemaining = Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        isOverdue = daysRemaining < 0;
      }

      return {
        ...part,
        deviceName: device?.cihazAdi || device?.model || 'Bilinmeyen Cihaz',
        hospitalName: hospital?.name || 'Bilinmeyen Lab',
        lastLog,
        daysRemaining,
        isOverdue,
      };
    });
  }, [periodicParts, periodicPartLogs, devices, hospitals]);

  const hospitalOptions = useMemo(() => {
    const labIds = new Set([
      ...maintenancePlans.map(p => devices.find(d => d.id === p.deviceId)?.hospitalId).filter(Boolean),
      ...periodicParts.map(p => devices.find(d => d.id === p.deviceId)?.hospitalId).filter(Boolean),
    ]);
    return hospitals.filter(h => labIds.has(h.id));
  }, [hospitals, devices, maintenancePlans, periodicParts]);

  const filteredPlans = useMemo(() => {
    let result = enrichedPlans;
    if (selectedLabFilter !== 'all') {
      result = result.filter(p => {
        const device = devices.find(d => d.id === p.deviceId);
        return device?.hospitalId === selectedLabFilter;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.taskName.toLowerCase().includes(q) ||
        p.deviceName.toLowerCase().includes(q) ||
        p.hospitalName.toLowerCase().includes(q)
      );
    }
    return result;
  }, [enrichedPlans, searchQuery, selectedLabFilter, devices]);

  const filteredParts = useMemo(() => {
    let result = enrichedParts;
    if (selectedLabFilter !== 'all') {
      result = result.filter(p => {
        const device = devices.find(d => d.id === p.deviceId);
        return device?.hospitalId === selectedLabFilter;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.stokAdi.toLowerCase().includes(q) ||
        p.stokKodu.toLowerCase().includes(q) ||
        p.deviceName.toLowerCase().includes(q) ||
        p.hospitalName.toLowerCase().includes(q)
      );
    }
    return result;
  }, [enrichedParts, searchQuery, selectedLabFilter, devices]);

  const handleDeleteClick = (id: string, type: 'plan' | 'part', name: string) => {
    setItemToDelete({ id, type, name });
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    try {
      const collectionName = itemToDelete.type === 'plan' ? 'maintenancePlans' : 'periodicPartChanges';
      await deleteDoc(doc(db, collectionName, itemToDelete.id));

      // Also delete related logs
      const logCollection = itemToDelete.type === 'plan' ? 'maintenanceLogs' : 'periodicPartChangeLogs';
      const logField = itemToDelete.type === 'plan' ? 'planId' : 'periodicPartChangeId';
      const logsQuery = scopedQuery(logCollection, currentCompanyId, isSuperAdmin, where(logField, '==', itemToDelete.id));
      const logsSnap = await getDocsResilient(logsQuery);
      for (const logDoc of logsSnap.docs) {
        await deleteDoc(doc(db, logCollection, logDoc.id));
      }

      toast({ title: 'Silindi', description: `${itemToDelete.name} ve ilgili loglar silindi.` });
      setDeleteConfirmOpen(false);
      setItemToDelete(null);
      fetchData();
    } catch (err) {
      console.error('Delete error:', err);
      toast({ title: 'Hata', description: 'Silme işlemi başarısız.', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="cihaz-shell flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
          <p className="text-sm text-[var(--dashboard-muted)]">Periyodik bakım verileri yükleniyor&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cihaz-shell px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BackButton fallbackUrl="/cihaz-tanimlamalari" />
        <div>
          <h1 className="text-xl font-bold text-[var(--dashboard-text)]">Periyodik Bakım Yönetimi</h1>
          <p className="text-sm text-[var(--dashboard-muted)]">
            Tüm periyodik iş listeleri ve yedek parça değişimlerini yönetin
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--dashboard-muted)]" />
          <Input
            placeholder="İş adı, cihaz veya laboratuvar ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedLabFilter} onValueChange={setSelectedLabFilter}>
          <SelectTrigger className="w-full sm:w-[240px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Laboratuvar Filtresi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Laboratuvarlar</SelectItem>
            {hospitalOptions.map(h => (
              <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-4 text-center">
          <Wrench className="h-5 w-5 mx-auto mb-1 text-blue-500" />
          <p className="text-2xl font-bold text-[var(--dashboard-text)]">{filteredPlans.length}</p>
          <p className="text-xs text-[var(--dashboard-muted)]">Periyodik İş</p>
        </div>
        <div className="rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-4 text-center">
          <Package className="h-5 w-5 mx-auto mb-1 text-emerald-500" />
          <p className="text-2xl font-bold text-[var(--dashboard-text)]">{filteredParts.length}</p>
          <p className="text-xs text-[var(--dashboard-muted)]">Yedek Parça Değişimi</p>
        </div>
        <div className="rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-4 text-center">
          <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-red-500" />
          <p className="text-2xl font-bold text-[var(--dashboard-text)]">
            {filteredPlans.filter(p => p.isOverdue).length + filteredParts.filter(p => p.isOverdue).length}
          </p>
          <p className="text-xs text-[var(--dashboard-muted)]">Süresi Geçmiş</p>
        </div>
        <div className="rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-4 text-center">
          <Calendar className="h-5 w-5 mx-auto mb-1 text-amber-500" />
          <p className="text-2xl font-bold text-[var(--dashboard-text)]">
            {filteredPlans.filter(p => p.daysRemaining !== null && p.daysRemaining <= 7 && p.daysRemaining >= 0).length +
             filteredParts.filter(p => p.daysRemaining !== null && p.daysRemaining <= 7 && p.daysRemaining >= 0).length}
          </p>
          <p className="text-xs text-[var(--dashboard-muted)]">Bu Hafta</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="plans" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="plans" className="flex-1">
            <Wrench className="h-4 w-4 mr-2" />
            Periyodik İşler ({filteredPlans.length})
          </TabsTrigger>
          <TabsTrigger value="parts" className="flex-1">
            <Package className="h-4 w-4 mr-2" />
            Yedek Parça Değişimleri ({filteredParts.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plans">
          <ScrollArea className="h-[calc(100vh-460px)]">
            <div className="space-y-2">
              {filteredPlans.length === 0 ? (
                <p className="text-center text-[var(--dashboard-muted)] py-12">
                  {searchQuery ? 'Arama sonucu bulunamadı.' : 'Henüz periyodik iş tanımlanmamış.'}
                </p>
              ) : (
                filteredPlans.map(plan => (
                  <div
                    key={plan.id}
                    className={`rounded-2xl p-4 bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] ${
                      plan.isOverdue ? 'border border-red-300' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-[var(--dashboard-text)]">{plan.taskName}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            plan.type === 'teknik_servis'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}>
                            {plan.type === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}
                          </span>
                          {plan.isOverdue && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                              Gecikmiş ({Math.abs(plan.daysRemaining!)} gün)
                            </span>
                          )}
                          {plan.daysRemaining !== null && plan.daysRemaining >= 0 && plan.daysRemaining <= 7 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              {plan.daysRemaining} gün kaldı
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--dashboard-muted)] mt-1">
                          <Building2 className="inline h-3 w-3 mr-1" />
                          {plan.hospitalName} &middot; {plan.deviceName}
                        </p>
                        <p className="text-xs text-[var(--dashboard-muted)]">
                          Periyot: {plan.periodValue} {PERIOD_UNIT_LABELS[plan.periodUnit] || plan.periodUnit}
                        </p>
                        {plan.lastLog && (
                          <p className="text-xs text-[var(--dashboard-muted)]">
                            Son yapılan: {format(plan.lastLog.completedAt, 'dd.MM.yyyy', { locale: tr })} - {plan.lastLog.completedByName}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleDeleteClick(plan.id, 'plan', plan.taskName)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="parts">
          <ScrollArea className="h-[calc(100vh-460px)]">
            <div className="space-y-2">
              {filteredParts.length === 0 ? (
                <p className="text-center text-[var(--dashboard-muted)] py-12">
                  {searchQuery ? 'Arama sonucu bulunamadı.' : 'Henüz periyodik parça değişimi tanımlanmamış.'}
                </p>
              ) : (
                filteredParts.map(part => (
                  <div
                    key={part.id}
                    className={`rounded-2xl p-4 bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] ${
                      part.isOverdue ? 'border border-red-300' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-[var(--dashboard-text)]">{part.stokAdi}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {part.stokKodu}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            part.responsibilityType === 'teknik_servis'
                              ? 'bg-blue-100 text-blue-700'
                              : part.responsibilityType === 'aplikasyon'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-teal-100 text-teal-700'
                          }`}>
                            {part.responsibilityType === 'teknik_servis' ? 'Teknik' : part.responsibilityType === 'aplikasyon' ? 'Aplikasyon' : 'Her İkisi'}
                          </span>
                          {part.isOverdue && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                              Gecikmiş ({Math.abs(part.daysRemaining!)} gün)
                            </span>
                          )}
                          {part.daysRemaining !== null && part.daysRemaining >= 0 && part.daysRemaining <= 7 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              {part.daysRemaining} gün kaldı
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--dashboard-muted)] mt-1">
                          <Building2 className="inline h-3 w-3 mr-1" />
                          {part.hospitalName} &middot; {part.deviceName}
                        </p>
                        {part.lastLog && (
                          <p className="text-xs text-[var(--dashboard-muted)]">
                            Son değişim: {format(part.lastLog.completedAt, 'dd.MM.yyyy', { locale: tr })} - {part.lastLog.completedByName}
                          </p>
                        )}
                        <div className="flex gap-2 mt-1">
                          {part.requiresSerialTracking && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">Seri No Takibi</span>
                          )}
                          {part.requiresOutgoingPartInfo && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">Çıkan Parça Bilgisi</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleDeleteClick(part.id, 'part', part.stokAdi)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Silme Onayı</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong>{itemToDelete?.name}</strong> {itemToDelete?.type === 'plan' ? 'periyodik işi' : 'periyodik parça değişimini'} ve
            tüm ilgili logları silmek istediğinize emin misiniz?
          </p>
          <p className="text-xs text-red-500">Bu işlem geri alınamaz.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={isDeleting}>
              İptal
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Sil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
