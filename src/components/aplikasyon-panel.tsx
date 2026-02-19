'use client';
import React, { useState, useMemo, useEffect } from 'react';
import type { Hospital, Device, AssignedDevice, CihazYonetimiSubView, LabPool } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FlaskConical, ArrowLeft, Layers, ChevronRight, FileText, Loader2, Eye, Calendar, Clock, AlertTriangle, Package } from 'lucide-react';
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
import AplikasyonTutanakPDFButton from '@/components/exports/AplikasyonTutanakPDFButton';

interface AplikasyonPanelProps {
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
  islemTuru?: string;
  createdAt: Timestamp;
  createdByName: string;
  createdByUid?: string;
  baslangicSaati?: string;
  bitisSaati?: string;
  cihazDurumu?: string;
  cihazDurumuAciklama?: string;
  faultName?: string;
  selectedFaultId?: string;
  selectedFaultName?: string;
  isCustomFault?: boolean;
  selectedTests?: string[];
  actions?: any[];
  eslikEdenPersonel?: { uid: string; name: string; role: string }[];
  personnelSignature?: string;
  technicianSignature?: string;
  technicianName?: string;
};

const ISLEM_TURU_LABELS: Record<string, string> = {
  rutin_kurum_ziyareti: 'Rutin Kurum Ziyareti',
  periyodik_bakim: 'Periyodik Bakım',
  ariza: 'Arıza',
  alis: 'ALIS',
  roche_bilgisayar_arizasi: 'Roche Bilgisayar Arızası',
};

const CIHAZ_DURUMU_LABELS: Record<string, string> = {
  calisiyor: 'Çalışıyor',
  arizali: 'Arızalı',
  denemede: 'Denemede',
  diger: 'Diğer',
};

export default function AplikasyonPanel({
  hospitals, devices, hospitalDeviceAssignments, labPools = [], userAssignedLabs = [], userRole = '', toast
}: AplikasyonPanelProps & { toast?: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void }) {
  const router = useRouter();
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null);

  // Open fault reports - deviceIds with active faults
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

  // All forms dialog state
  const [isAllFormsDialogOpen, setIsAllFormsDialogOpen] = useState(false);
  const [allForms, setAllForms] = useState<ActionFormRecord[]>([]);
  const [isLoadingForms, setIsLoadingForms] = useState(false);
  const [selectedFormDetail, setSelectedFormDetail] = useState<ActionFormRecord | null>(null);

  // Fetch all aplikasyon forms
  const fetchAllForms = async () => {
    setIsLoadingForms(true);
    try {
      const q = query(
        collection(db, 'aplikasyonActionForms'),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const forms = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as ActionFormRecord[];
      setAllForms(forms);
    } catch (err) {
      console.error("Error fetching forms:", err);
      toast?.({ title: 'Hata', description: 'Formlar yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoadingForms(false);
    }
  };

  const openAllFormsDialog = () => {
    setIsAllFormsDialogOpen(true);
    fetchAllForms();
  };

  const getDevicesForHospital = (hospitalId: string): Device[] => {
    return devices
      .filter(d => (d as any).hospitalId === hospitalId)
      .sort((a, b) => (Number(a.order ?? 99)) - (Number(b.order ?? 99)));
  };

  // Get devices for multiple hospitals (for pool summary)
  const getDevicesForHospitals = (hospitalIds: string[]): Device[] => {
    return devices
      .filter(d => hospitalIds.includes((d as any).hospitalId))
      .sort((a, b) => (Number(a.order ?? 99)) - (Number(b.order ?? 99)));
  };

  // Filter hospitals based on user's assigned laboratories
  // Admin users see all labs
  const isAdmin = userRole === 'admin';
  const filteredHospitals = useMemo(() => {
    if (isAdmin || userAssignedLabs.length === 0) {
      return hospitals;
    }
    return hospitals.filter(h => userAssignedLabs.includes(h.id));
  }, [hospitals, userAssignedLabs, isAdmin]);

  // Organize hospitals into pools and standalone
  const { poolGroups, standaloneLabs } = useMemo(() => {
    const poolGroups: { pool: LabPool; mainLab: Hospital; memberLabs: Hospital[] }[] = [];
    const labsInPools = new Set<string>();

    // Process each pool
    for (const pool of labPools) {
      // Get member labs that the user has access to
      const accessibleMembers = pool.memberIds.filter(id =>
        isAdmin || userAssignedLabs.length === 0 || userAssignedLabs.includes(id)
      );

      if (accessibleMembers.length === 0) continue;

      // Determine main lab - prefer mainLabId, otherwise use first accessible member
      const mainLabId = pool.mainLabId && accessibleMembers.includes(pool.mainLabId)
        ? pool.mainLabId
        : accessibleMembers[0];

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

    // Standalone labs are those not in any pool
    const standaloneLabs = filteredHospitals.filter(h => !labsInPools.has(h.id));

    return { poolGroups, standaloneLabs };
  }, [filteredHospitals, labPools, userAssignedLabs, isAdmin]);

  // Helper: is device faulty? Check both device field AND open fault reports
  const isDeviceFaulty = (d: Device) =>
    (d.arizaDurumu !== undefined && d.arizaDurumu !== 'yok') || faultyDeviceIds.has(d.id);

  // Calculate device stats for a hospital
  const getHospitalStats = (hospitalId: string) => {
    const hospitalDevices = getDevicesForHospital(hospitalId);
    const arizaSayisi = hospitalDevices.filter(isDeviceFaulty).length;
    return {
      cihazSayisi: hospitalDevices.length,
      arizaSayisi,
      devices: hospitalDevices
    };
  };

  // Calculate combined stats for a pool
  const getPoolStats = (memberIds: string[]) => {
    const poolDevices = getDevicesForHospitals(memberIds);
    const arizaSayisi = poolDevices.filter(isDeviceFaulty).length;
    return {
      cihazSayisi: poolDevices.length,
      arizaSayisi,
      devices: poolDevices
    };
  };

  // Reusable device dot indicators
  const DeviceDots = ({ devices: devs }: { devices: Device[] }) => {
    if (devs.length === 0) return null;
    return (
      <div className="flex items-center justify-center flex-wrap gap-1.5 mt-3 pt-3 border-t">
        {devs.map((device) => {
          const faulty = isDeviceFaulty(device);
          return (
            <span
              key={device.id}
              className={cn(
                "h-2.5 w-2.5 rounded-full transition-all",
                faulty
                  ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]'
                  : 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
              )}
              title={`${device.cihazAdi || device.model} - ${faulty ? 'Arızalı' : 'Sağlıklı'}`}
            ></span>
          );
        })}
      </div>
    );
  };

  // If a pool is expanded, show labs in that pool
  if (expandedPoolId) {
    const poolGroup = poolGroups.find(pg => pg.pool.id === expandedPoolId);
    if (!poolGroup) {
      setExpandedPoolId(null);
      return null;
    }

    return (
      <div className={"device-module-page space-y-6 p-4 sm:p-6"}>
        <Button variant="ghost" onClick={() => setExpandedPoolId(null)} className="mb-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Geri
        </Button>
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-2xl font-headline flex items-center text-primary">
                <Layers className="mr-3 h-7 w-7" />
                {poolGroup.pool.name || poolGroup.mainLab.name}
              </CardTitle>
            </div>
            <CardDescription>
              Bu havuzdaki laboratuvarlar ({poolGroup.memberLabs.length} laboratuvar)
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="overflow-y-auto max-h-[calc(100vh-20rem)] p-4 -m-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {poolGroup.memberLabs.map(hospital => {
              const stats = getHospitalStats(hospital.id);
              return (
                <Card
                  key={hospital.id}
                  onClick={() => router.push(`/aplikasyon-paneli/${hospital.id}`)}
                  className={cn(
                    "cursor-pointer hover:shadow-lg transition-shadow"
                  )}
                >
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-base font-headline text-primary truncate" title={hospital.name}>
                      {hospital.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-4">
                    <DeviceDots devices={stats.devices} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Main view - show pools and standalone labs
  return (
    <div className={"space-y-6 p-4 sm:p-6"}>
      <BackButton fallback="/cihaz-yonetimi-ana" />
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
            <CardTitle className="text-2xl font-headline flex items-center text-primary"><FlaskConical className="mr-3 h-7 w-7" />Aplikasyon Paneli</CardTitle>
            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <Button variant="outline" onClick={openAllFormsDialog} className="w-full sm:w-auto">
                <FileText className="mr-2 h-4 w-4" />
                Tüm İşlem Formlarını Göster
              </Button>
              <Button variant="outline" onClick={() => router.push('/direkt-transfer/yedek-parca-transfer')} className="w-full sm:w-auto">
                <Package className="mr-2 h-4 w-4" />
                Yedek Parça Stokları
              </Button>
            </div>
          </div>
          <CardDescription>Hastanelerdeki cihazların aplikasyon durumlarını görüntüleyin.</CardDescription>
        </CardHeader>
      </Card>

      <div className="overflow-y-auto max-h-[calc(100vh-20rem)] p-4 -m-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Pool cards - show main lab as representative */}
          {poolGroups.map(({ pool, mainLab, memberLabs }) => {
            const stats = getPoolStats(memberLabs.map(l => l.id));
            return (
              <Card
                key={pool.id}
                onClick={() => setExpandedPoolId(pool.id)}
                className={cn(
                  "cursor-pointer hover:shadow-lg transition-shadow border-2 border-primary/20"
                )}
              >
                <CardHeader className="pb-2 pt-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-headline text-primary truncate" title={mainLab.name}>
                      {mainLab.name}
                    </CardTitle>
                    <div className="flex items-center text-muted-foreground">
                      <Layers className="h-4 w-4 mr-1" />
                      <span className="text-xs">{memberLabs.length}</span>
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </div>
                  </div>
                  {pool.name && pool.name !== mainLab.name && (
                    <p className="text-xs text-muted-foreground">{pool.name}</p>
                  )}
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <DeviceDots devices={stats.devices} />
                </CardContent>
              </Card>
            );
          })}

          {/* Standalone lab cards */}
          {standaloneLabs.map(hospital => {
            const stats = getHospitalStats(hospital.id);
            return (
              <Card
                key={hospital.id}
                onClick={() => router.push(`/aplikasyon-paneli/${hospital.id}`)}
                className={cn(
                  "cursor-pointer hover:shadow-lg transition-shadow"
                )}
              >
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-base font-headline text-primary truncate" title={hospital.name}>{hospital.name}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <DeviceDots devices={stats.devices} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* All Forms Dialog */}
      <Dialog open={isAllFormsDialogOpen} onOpenChange={setIsAllFormsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Tüm Aplikasyon İşlem Formları
            </DialogTitle>
          </DialogHeader>
          {isLoadingForms ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : selectedFormDetail ? (
            // Form Detail View
            <div className="device-module-page space-y-4">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setSelectedFormDetail(null)}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Listeye Dön
                </Button>
                <AplikasyonTutanakPDFButton
                  device={{ id: selectedFormDetail.deviceId, cihazAdi: selectedFormDetail.cihazAdi, seriNumarasi: selectedFormDetail.seriNumarasi, hospitalId: selectedFormDetail.hospitalId } as Device}
                  hospital={selectedFormDetail.labName ? { id: selectedFormDetail.hospitalId || '', name: selectedFormDetail.labName } as Hospital : null}
                  actionRecord={selectedFormDetail as any}
                  className="ml-auto"
                />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{selectedFormDetail.cihazAdi || 'Cihaz'}</CardTitle>
                  <CardDescription>
                    Seri No: {selectedFormDetail.seriNumarasi || '-'} | {selectedFormDetail.labName || '-'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Form ID:</span>
                      <span className="ml-2 font-mono text-xs">{selectedFormDetail.id.substring(0, 8)}...</span>
                    </div>
                    <div>
                      <span className="font-medium">Oluşturan:</span>
                      <span className="ml-2">{selectedFormDetail.createdByName}</span>
                    </div>
                    <div>
                      <span className="font-medium">Tarih:</span>
                      <span className="ml-2">
                        {selectedFormDetail.createdAt?.toDate
                          ? format(selectedFormDetail.createdAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: tr })
                          : '-'}
                      </span>
                    </div>
                    {selectedFormDetail.islemTuru && (
                      <div>
                        <span className="font-medium">İşlem Türü:</span>
                        <span className="ml-2">{ISLEM_TURU_LABELS[selectedFormDetail.islemTuru] || selectedFormDetail.islemTuru}</span>
                      </div>
                    )}
                    {selectedFormDetail.cihazDurumu && (
                      <div>
                        <span className="font-medium">Cihaz Durumu:</span>
                        <span className="ml-2">{CIHAZ_DURUMU_LABELS[selectedFormDetail.cihazDurumu] || selectedFormDetail.cihazDurumu}</span>
                      </div>
                    )}
                    {(selectedFormDetail.selectedFaultName || selectedFormDetail.faultName) && (
                      <div>
                        <span className="font-medium">Arıza:</span>
                        <span className="ml-2 text-red-600">{selectedFormDetail.selectedFaultName || selectedFormDetail.faultName}</span>
                      </div>
                    )}
                    {selectedFormDetail.baslangicSaati && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Başlangıç:</span>
                        <span className="ml-2">{selectedFormDetail.baslangicSaati}</span>
                      </div>
                    )}
                    {selectedFormDetail.bitisSaati && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Bitiş:</span>
                        <span className="ml-2">{selectedFormDetail.bitisSaati}</span>
                      </div>
                    )}
                  </div>
                  {selectedFormDetail.selectedFaultName && (
                    <div className="pt-4 border-t">
                      <span className="font-medium flex items-center gap-1 mb-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        Tespit Edilen Arıza:
                      </span>
                      <p className="text-sm text-red-600 dark:text-red-400">{selectedFormDetail.selectedFaultName}</p>
                    </div>
                  )}
                  {selectedFormDetail.selectedTests && selectedFormDetail.selectedTests.length > 0 && (
                    <div className="pt-2">
                      <span className="font-medium block mb-2">İlişkili Testler:</span>
                      <div className="flex flex-wrap gap-1">
                        {selectedFormDetail.selectedTests.map((test: string, i: number) => (
                          <span key={i} className="text-xs px-2 py-1 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 rounded-full">{test}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedFormDetail.aciklama && (
                    <div className="pt-4 border-t">
                      <span className="font-medium block mb-2">Açıklama:</span>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedFormDetail.aciklama}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            // Forms List View
            <ScrollArea className="h-[60vh]">
              {allForms.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  Henüz işlem formu bulunmuyor.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tarih</TableHead>
                      <TableHead>Cihaz</TableHead>
                      <TableHead>Laboratuvar</TableHead>
                      <TableHead>İşlem Türü</TableHead>
                      <TableHead>Oluşturan</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allForms.map(form => (
                      <TableRow
                        key={form.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedFormDetail(form)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">
                              {form.createdAt?.toDate
                                ? format(form.createdAt.toDate(), 'dd.MM.yyyy', { locale: tr })
                                : '-'}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {form.createdAt?.toDate
                              ? format(form.createdAt.toDate(), 'HH:mm', { locale: tr })
                              : ''}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{form.cihazAdi || '-'}</div>
                          <div className="text-xs text-muted-foreground font-mono">{form.seriNumarasi || '-'}</div>
                        </TableCell>
                        <TableCell className="text-sm">{form.labName || '-'}</TableCell>
                        <TableCell>
                          <span className={cn(
                            "text-xs px-2 py-1 rounded-full",
                            form.islemTuru === 'ariza' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                            form.islemTuru === 'periyodik_bakim' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                            'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                          )}>
                            {ISLEM_TURU_LABELS[form.islemTuru || ''] || '-'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{form.createdByName || '-'}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setSelectedFormDetail(form); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
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
