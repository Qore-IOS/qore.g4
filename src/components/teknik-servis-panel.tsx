'use client';
import React, { useState, useMemo, useEffect } from 'react';
import type { Hospital, Device, AssignedDevice, CihazYonetimiSubView, LabPool } from '@/lib/types';
import {
  Wrench, ArrowLeft, Layers, ChevronRight, FileText,
  Loader2, Eye, Calendar, Clock, AlertTriangle, Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import BackButton from './BackButton';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import TeknikServisTutanakPDFButton from '@/components/exports/TeknikServisTutanakPDFButton';

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

type ActionFormRecord = {
  id: string;
  deviceId: string;
  cihazAdi?: string;
  seriNumarasi?: string;
  hospitalId?: string;
  labName?: string;
  aciklama?: string;
  islemTipi?: string;
  islemTuru?: string;
  createdAt: Timestamp;
  createdByName: string;
  createdByUid?: string;
  baslangicSaati?: string;
  bitisSaati?: string;
  cihazDurumu?: string;
  cihazDurumuAciklama?: string;
  actions?: any[];
  selectedFaultId?: string;
  selectedFaultName?: string;
  isCustomFault?: boolean;
  selectedTests?: string[];
  eslikEdenPersonel?: { uid: string; name: string; role: string }[];
  personnelSignature?: string;
  technicianSignature?: string;
  technicianName?: string;
  selectedMaintenanceTasks?: { id: string; taskName: string }[];
};

/* ─── Label maps ─── */

const ISLEM_TIPI_LABELS: Record<string, string> = {
  cihaz: 'Cihaz',
  ups: 'UPS',
  su_sistemi: 'Su Sistemi',
};

const ISLEM_TURU_LABELS: Record<string, string> = {
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  cihaz_kurulumu: 'Cihaz Kurulumu',
  ariza: 'Arıza',
  sw_update: 'SW Update',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};

const CIHAZ_DURUMU_LABELS: Record<string, string> = {
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

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
  hospitals, devices, hospitalDeviceAssignments, labPools = [], userAssignedLabs = [], userRole = '', toast, setSubView
}: TeknikServisPanelProps) {
  const router = useRouter();
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null);

  /* ── Open fault reports ── */
  const [faultyDeviceIds, setFaultyDeviceIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchOpenFaults = async () => {
      try {
        const q = query(
          collection(db, 'deviceFaultReports'),
          where('status', 'in', ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'])
        );
        const snap = await getDocs(q);
        const ids = new Set<string>();
        snap.docs.forEach(d => {
          const data = d.data();
          if (data.deviceId) ids.add(data.deviceId);
        });
        setFaultyDeviceIds(ids);
      } catch (err) {
        console.error('Error fetching open fault reports:', err);
      }
    };
    fetchOpenFaults();
  }, []);

  /* ── All forms dialog state ── */
  const [isAllFormsDialogOpen, setIsAllFormsDialogOpen] = useState(false);
  const [allForms, setAllForms] = useState<ActionFormRecord[]>([]);
  const [isLoadingForms, setIsLoadingForms] = useState(false);
  const [selectedFormDetail, setSelectedFormDetail] = useState<ActionFormRecord | null>(null);

  const fetchAllForms = async () => {
    setIsLoadingForms(true);
    try {
      const q = query(collection(db, 'teknikServisActionForms'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setAllForms(snap.docs.map(d => ({ id: d.id, ...d.data() })) as ActionFormRecord[]);
    } catch (err) {
      console.error("Error fetching forms:", err);
      toast({ title: 'Hata', description: 'Formlar yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoadingForms(false);
    }
  };

  const openAllFormsDialog = () => {
    setIsAllFormsDialogOpen(true);
    fetchAllForms();
  };

  /* ── Device helpers ── */

  const getDevicesForHospital = (hospitalId: string): Device[] =>
    devices.filter(d => (d as any).hospitalId === hospitalId).sort((a, b) => (Number(a.order ?? 99)) - (Number(b.order ?? 99)));

  const getDevicesForHospitals = (hospitalIds: string[]): Device[] =>
    devices.filter(d => hospitalIds.includes((d as any).hospitalId)).sort((a, b) => (Number(a.order ?? 99)) - (Number(b.order ?? 99)));

  const isAdmin = userRole === 'admin';

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
        .filter((h): h is Hospital => h !== undefined);

      if (memberLabs.length > 0) {
        poolGroups.push({ pool, mainLab, memberLabs });
        accessibleMembers.forEach(id => labsInPools.add(id));
      }
    }

    const standaloneLabs = filteredHospitals.filter(h => !labsInPools.has(h.id));
    return { poolGroups, standaloneLabs };
  }, [filteredHospitals, labPools, userAssignedLabs, isAdmin]);

  const isDeviceFaulty = (d: Device) =>
    (d.arizaDurumu !== undefined && d.arizaDurumu !== 'yok') || faultyDeviceIds.has(d.id);

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
          <button
            onClick={() => setExpandedPoolId(null)}
            className="cihaz-focus-ring flex items-center gap-1.5 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Geri
          </button>

          <div className="cihaz-card-strong p-5 sm:p-7">
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
          </div>

          {/* Member lab cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {poolGroup.memberLabs.map(hospital => {
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
        <BackButton fallback="/cihaz-yonetimi-ana" />

        {/* ── Header card ── */}
        <div className="cihaz-card-strong p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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

            {/* Action buttons */}
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-2.5 w-full sm:w-auto">
              <button
                onClick={openAllFormsDialog}
                className="cihaz-tool-item cihaz-focus-ring flex items-center gap-2.5 px-4 py-2.5 text-sm"
              >
                <FileText className="h-4 w-4 text-[var(--dashboard-accent)]" />
                <span className="text-[var(--dashboard-text)] font-medium">İşlem Formları</span>
              </button>
              <button
                onClick={() => router.push('/direkt-transfer/yedek-parca-transfer')}
                className="cihaz-tool-item cihaz-focus-ring flex items-center gap-2.5 px-4 py-2.5 text-sm"
              >
                <Package className="h-4 w-4 text-[var(--dashboard-accent)]" />
                <span className="text-[var(--dashboard-text)] font-medium">Yedek Parça</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Lab pools section ── */}
        {poolGroups.length > 0 && (
          <section>
            <SectionLabel>Laboratuvar Havuzları</SectionLabel>
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
                        <h3 className="text-sm sm:text-[15px] font-semibold text-[var(--dashboard-text)] truncate leading-snug" title={mainLab.name}>
                          {mainLab.name}
                        </h3>
                        {pool.name && pool.name !== mainLab.name && (
                          <p className="text-xs text-[var(--dashboard-muted)] mt-0.5 truncate">{pool.name}</p>
                        )}
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
            <SectionLabel>Kurumlar</SectionLabel>
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

      {/* ═══ All Forms Dialog ═══ */}
      <Dialog open={isAllFormsDialogOpen} onOpenChange={setIsAllFormsDialogOpen}>
        <DialogContent className="cihaz-card-strong border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[var(--dashboard-text)]">
              <FileText className="h-5 w-5 text-[var(--dashboard-accent)]" />
              Teknik Servis İşlem Formları
            </DialogTitle>
          </DialogHeader>

          {isLoadingForms ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-7 w-7 animate-spin text-[var(--dashboard-accent)]" />
              <p className="text-sm text-[var(--dashboard-muted)]">Formlar yükleniyor&hellip;</p>
            </div>
          ) : selectedFormDetail ? (
            /* ── Form Detail View ── */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setSelectedFormDetail(null)}
                  className="cihaz-focus-ring flex items-center gap-1.5 text-sm text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Listeye Dön
                </button>
                <TeknikServisTutanakPDFButton
                  device={{ id: selectedFormDetail.deviceId, cihazAdi: selectedFormDetail.cihazAdi, seriNumarasi: selectedFormDetail.seriNumarasi, hospitalId: selectedFormDetail.hospitalId } as Device}
                  hospital={selectedFormDetail.labName ? { id: selectedFormDetail.hospitalId || '', name: selectedFormDetail.labName } as Hospital : null}
                  actionRecord={selectedFormDetail as any}
                  className="ml-auto"
                />
              </div>

              <div className="cihaz-card p-5 space-y-4">
                {/* Device header */}
                <div className="pb-3 border-b border-[var(--dashboard-stroke)]">
                  <h3 className="text-base font-semibold text-[var(--dashboard-text)]">
                    {selectedFormDetail.cihazAdi || 'Cihaz'}
                  </h3>
                  <p className="text-xs text-[var(--dashboard-muted)] mt-0.5">
                    Seri No: {selectedFormDetail.seriNumarasi || '-'} &middot; {selectedFormDetail.labName || '-'}
                  </p>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <InfoField label="Form ID" value={selectedFormDetail.id.substring(0, 8) + '...'} mono />
                  <InfoField label="Oluşturan" value={selectedFormDetail.createdByName} />
                  <InfoField
                    label="Tarih"
                    value={selectedFormDetail.createdAt?.toDate ? format(selectedFormDetail.createdAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}
                  />
                  {selectedFormDetail.islemTipi && (
                    <InfoField label="İşlem Tipi" value={ISLEM_TIPI_LABELS[selectedFormDetail.islemTipi] || selectedFormDetail.islemTipi} />
                  )}
                  {selectedFormDetail.islemTuru && (
                    <InfoField label="İşlem Türü" value={ISLEM_TURU_LABELS[selectedFormDetail.islemTuru] || selectedFormDetail.islemTuru} />
                  )}
                  {selectedFormDetail.cihazDurumu && (
                    <InfoField label="Cihaz Durumu" value={CIHAZ_DURUMU_LABELS[selectedFormDetail.cihazDurumu] || selectedFormDetail.cihazDurumu} />
                  )}
                  {selectedFormDetail.baslangicSaati && (
                    <InfoField label="Başlangıç" value={selectedFormDetail.baslangicSaati} icon={<Clock className="h-3.5 w-3.5 text-[var(--dashboard-muted)]" />} />
                  )}
                  {selectedFormDetail.bitisSaati && (
                    <InfoField label="Bitiş" value={selectedFormDetail.bitisSaati} icon={<Clock className="h-3.5 w-3.5 text-[var(--dashboard-muted)]" />} />
                  )}
                </div>

                {/* Fault info */}
                {selectedFormDetail.selectedFaultName && (
                  <div className="pt-3 border-t border-[var(--dashboard-stroke)]">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      <span className="text-sm font-medium text-[var(--dashboard-text)]">Tespit Edilen Arıza</span>
                    </div>
                    <p className="text-sm text-red-600">{selectedFormDetail.selectedFaultName}</p>
                  </div>
                )}

                {/* Tests */}
                {selectedFormDetail.selectedTests && selectedFormDetail.selectedTests.length > 0 && (
                  <div className="pt-3 border-t border-[var(--dashboard-stroke)]">
                    <span className="text-sm font-medium text-[var(--dashboard-text)] block mb-2">İlişkili Testler</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedFormDetail.selectedTests.map((test, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)] font-medium">
                          {test}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description */}
                {selectedFormDetail.aciklama && (
                  <div className="pt-3 border-t border-[var(--dashboard-stroke)]">
                    <span className="text-sm font-medium text-[var(--dashboard-text)] block mb-1.5">Açıklama</span>
                    <p className="text-sm text-[var(--dashboard-muted)] whitespace-pre-wrap leading-relaxed">{selectedFormDetail.aciklama}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Forms List View ── */
            <ScrollArea className="h-[60vh]">
              {allForms.length === 0 ? (
                <div className="text-center py-12 text-[var(--dashboard-muted)]">
                  Henüz işlem formu bulunmuyor.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-[var(--dashboard-stroke)]">
                      <TableHead className="text-[var(--dashboard-muted)]">Tarih</TableHead>
                      <TableHead className="text-[var(--dashboard-muted)]">Cihaz</TableHead>
                      <TableHead className="text-[var(--dashboard-muted)]">Laboratuvar</TableHead>
                      <TableHead className="text-[var(--dashboard-muted)]">İşlem Türü</TableHead>
                      <TableHead className="text-[var(--dashboard-muted)]">Oluşturan</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allForms.map(form => (
                      <TableRow
                        key={form.id}
                        className="cursor-pointer border-[var(--dashboard-stroke)] hover:bg-[var(--dashboard-surface-2)]/50 transition-colors"
                        onClick={() => setSelectedFormDetail(form)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 text-[var(--dashboard-muted)]" />
                            <span className="text-sm text-[var(--dashboard-text)]">
                              {form.createdAt?.toDate ? format(form.createdAt.toDate(), 'dd.MM.yyyy', { locale: tr }) : '-'}
                            </span>
                          </div>
                          <span className="text-xs text-[var(--dashboard-muted)] ml-[18px]">
                            {form.createdAt?.toDate ? format(form.createdAt.toDate(), 'HH:mm', { locale: tr }) : ''}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium text-[var(--dashboard-text)]">{form.cihazAdi || '-'}</div>
                          <div className="text-xs text-[var(--dashboard-muted)] font-mono">{form.seriNumarasi || '-'}</div>
                        </TableCell>
                        <TableCell className="text-sm text-[var(--dashboard-text)]">{form.labName || '-'}</TableCell>
                        <TableCell>
                          <span className={cn(
                            'text-xs px-2.5 py-1 rounded-full font-medium',
                            form.islemTuru === 'ariza'
                              ? 'bg-red-50 text-red-700 border border-red-200/60'
                              : form.islemTuru === 'periyodik_bakim'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                                : 'bg-[var(--dashboard-surface-2)] text-[var(--dashboard-text)]'
                          )}>
                            {ISLEM_TURU_LABELS[form.islemTuru || ''] || '-'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-[var(--dashboard-text)]">{form.createdByName || '-'}</TableCell>
                        <TableCell>
                          <button
                            className="cihaz-focus-ring p-1.5 rounded-lg hover:bg-[var(--dashboard-surface-2)] transition-colors"
                            onClick={(e) => { e.stopPropagation(); setSelectedFormDetail(form); }}
                          >
                            <Eye className="h-4 w-4 text-[var(--dashboard-muted)]" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Small helper for form detail info rows ─── */

function InfoField({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--dashboard-muted)] font-medium">{label}</span>
      <span className={cn('text-sm text-[var(--dashboard-text)]', mono && 'font-mono text-xs', icon && 'flex items-center gap-1.5')}>
        {icon}
        {value}
      </span>
    </div>
  );
}
