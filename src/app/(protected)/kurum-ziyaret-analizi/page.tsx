'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { collection, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Building2, Users, Wrench, FlaskConical, Search, X, ChevronsUpDown, ArrowLeft } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import type { Hospital, LabPool, User } from '@/lib/types';

interface ActionForm {
  id: string;
  createdByUid?: string;
  createdByName: string;
  hospitalId?: string;
  labName?: string;
  formType: 'teknik_servis' | 'aplikasyon';
  createdAt: Date;
}

interface FaultReport {
  id: string;
  interventionType?: 'telefon' | 'kurum_ziyaret' | null;
  faultType: 'teknik_servis' | 'aplikasyon';
  assignedToUid?: string;
  assignedToName?: string;
  labId?: string;
  labName?: string;
  status: string;
}

interface LabOption {
  id: string;
  name: string;
  memberIds: string[];
}

interface PersonnelVisitDetail {
  institutionName: string;
  visitCount: number;
  visitType: 'teknik_servis' | 'aplikasyon';
}

export default function KurumZiyaretAnaliziPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [teknikForms, setTeknikForms] = useState<ActionForm[]>([]);
  const [aplikasyonForms, setAplikasyonForms] = useState<ActionForm[]>([]);
  const [faultReports, setFaultReports] = useState<FaultReport[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
  const [labOptions, setLabOptions] = useState<LabOption[]>([]);
  const [hospitalNamesMap, setHospitalNamesMap] = useState<Map<string, string>>(new Map());

  const [selectedLabIds, setSelectedLabIds] = useState<Set<string>>(new Set());
  const [selectedPersonnelUids, setSelectedPersonnelUids] = useState<Set<string>>(new Set());
  const [labSearchTerm, setLabSearchTerm] = useState('');
  const [personnelSearchTerm, setPersonnelSearchTerm] = useState('');
  const [labPopoverOpen, setLabPopoverOpen] = useState(false);
  const [personnelPopoverOpen, setPersonnelPopoverOpen] = useState(false);
  const [selectedChartPersonnelUid, setSelectedChartPersonnelUid] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [teknikSnap, appSnap, faultSnap, usersSnap, hospitalsSnap, labPoolsSnap] = await Promise.all([
          getDocs(query(collection(db, 'teknikServisActionForms'), orderBy('createdAt', 'desc'))),
          getDocs(query(collection(db, 'aplikasyonActionForms'), orderBy('createdAt', 'desc'))),
          getDocs(query(collection(db, 'deviceFaultReports'), orderBy('openedAt', 'desc'))),
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'labPools')),
        ]);

        const uMap = new Map<string, User>();
        usersSnap.docs.forEach((d) => {
          const data = d.data();
          uMap.set(d.id, { uid: d.id, ...data } as User);
        });
        setUsersMap(uMap);

        const hospitalsMap = new Map<string, Hospital>();
        const hospitalsNameMap = new Map<string, string>();
        hospitalsSnap.docs.forEach((d) => {
          const hospital = { id: d.id, ...d.data() } as Hospital;
          hospitalsMap.set(d.id, hospital);
          hospitalsNameMap.set(d.id, hospital.name || 'Bilinmiyor');
        });
        setHospitalNamesMap(hospitalsNameMap);

        const pools: LabPool[] = labPoolsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as LabPool))
          .filter((p) => p.active !== false);

        const labsInPools = new Set<string>();
        const options: LabOption[] = [];

        for (const pool of pools) {
          if (!pool.memberIds?.length) continue;
          const mainLabId = pool.mainLabId || pool.memberIds[0];
          const mainLab = hospitalsMap.get(mainLabId);
          const name = mainLab?.name || pool.name || 'Bilinmiyor';
          pool.memberIds.forEach((id) => labsInPools.add(id));
          options.push({ id: mainLabId, name, memberIds: [...pool.memberIds] });
        }

        hospitalsMap.forEach((h, id) => {
          if (!labsInPools.has(id)) {
            options.push({ id, name: h.name || 'Bilinmiyor', memberIds: [id] });
          }
        });

        options.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        setLabOptions(options);

        setTeknikForms(
          teknikSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id, createdByUid: data.createdByUid, createdByName: data.createdByName || 'Bilinmiyor',
              hospitalId: data.hospitalId, labName: data.labName, formType: 'teknik_servis' as const,
              createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(data.createdAt),
            };
          })
        );

        setAplikasyonForms(
          appSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id, createdByUid: data.createdByUid, createdByName: data.createdByName || 'Bilinmiyor',
              hospitalId: data.hospitalId, labName: data.labName, formType: 'aplikasyon' as const,
              createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(data.createdAt),
            };
          })
        );

        setFaultReports(
          faultSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id, interventionType: data.interventionType, faultType: data.faultType,
              assignedToUid: data.assignedToUid, assignedToName: data.assignedToName,
              labId: data.labId, labName: data.labName, status: data.status,
            };
          })
        );
      } catch (error) {
        console.error('Kurum ziyaret analizi veri hatası:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const selectedLabIdsFull = useMemo(() => {
    if (selectedLabIds.size === 0) return null;
    const set = new Set<string>();
    for (const opt of labOptions) {
      if (selectedLabIds.has(opt.id)) {
        opt.memberIds.forEach((id) => set.add(id));
      }
    }
    return set;
  }, [selectedLabIds, labOptions]);

  const filteredData = useMemo(() => {
    let filteredTeknik = teknikForms;
    let filteredApp = aplikasyonForms;
    let filteredFaults = faultReports;

    if (selectedLabIdsFull) {
      filteredTeknik = filteredTeknik.filter((f) => f.hospitalId && selectedLabIdsFull.has(f.hospitalId));
      filteredApp = filteredApp.filter((f) => f.hospitalId && selectedLabIdsFull.has(f.hospitalId));
      filteredFaults = filteredFaults.filter((f) => f.labId && selectedLabIdsFull.has(f.labId));
    }

    if (selectedPersonnelUids.size > 0) {
      filteredTeknik = filteredTeknik.filter((f) => f.createdByUid && selectedPersonnelUids.has(f.createdByUid));
      filteredApp = filteredApp.filter((f) => f.createdByUid && selectedPersonnelUids.has(f.createdByUid));
      filteredFaults = filteredFaults.filter((f) => f.assignedToUid && selectedPersonnelUids.has(f.assignedToUid));
    }

    return { filteredTeknik, filteredApp, filteredFaults };
  }, [teknikForms, aplikasyonForms, faultReports, selectedLabIdsFull, selectedPersonnelUids]);

  const analysis = useMemo(() => {
    const { filteredTeknik, filteredApp, filteredFaults } = filteredData;

    const teknikFormCount = filteredTeknik.length;
    const appFormCount = filteredApp.length;

    const teknikFaultVisits = filteredFaults.filter((f) => f.interventionType === 'kurum_ziyaret' && f.faultType === 'teknik_servis');
    const appFaultVisits = filteredFaults.filter((f) => f.interventionType === 'kurum_ziyaret' && f.faultType === 'aplikasyon');

    const totalTeknik = teknikFormCount + teknikFaultVisits.length;
    const totalApp = appFormCount + appFaultVisits.length;

    const personnelMap = new Map<string, { name: string; role: string; visitCount: number }>();

    const addVisit = (uid: string | undefined, name: string, visitType: 'teknik_servis' | 'aplikasyon') => {
      if (!uid) return;
      const user = usersMap.get(uid);
      const userRole = user?.role || '';
      const isTeknikPerson = userRole === 'teknik_servis' || userRole === 'teknisyen';
      const isAppPerson = userRole === 'aplikasyon';
      if (isTeknikPerson && visitType !== 'teknik_servis') return;
      if (isAppPerson && visitType !== 'aplikasyon') return;
      const existing = personnelMap.get(uid) || { name: name || user?.name || 'Bilinmiyor', role: userRole, visitCount: 0 };
      existing.visitCount++;
      personnelMap.set(uid, existing);
    };

    filteredTeknik.forEach((f) => addVisit(f.createdByUid, f.createdByName, 'teknik_servis'));
    filteredApp.forEach((f) => addVisit(f.createdByUid, f.createdByName, 'aplikasyon'));
    teknikFaultVisits.forEach((f) => addVisit(f.assignedToUid, f.assignedToName || 'Bilinmiyor', 'teknik_servis'));
    appFaultVisits.forEach((f) => addVisit(f.assignedToUid, f.assignedToName || 'Bilinmiyor', 'aplikasyon'));

    const personnelList = Array.from(personnelMap.entries()).map(([uid, data]) => ({ uid, ...data })).sort((a, b) => b.visitCount - a.visitCount);
    const chartData = personnelList.slice(0, 15).map((p) => ({
      uid: p.uid,
      name: p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name,
      fullName: p.name, role: p.role, ziyaret: p.visitCount,
    }));

    return { totalTeknik, totalApp, teknikFormCount, appFormCount, teknikFaultVisitCount: teknikFaultVisits.length, appFaultVisitCount: appFaultVisits.length, personnelList, chartData };
  }, [filteredData, usersMap]);

  const availablePersonnel = useMemo(() => {
    const personSet = new Map<string, string>();
    const addPerson = (uid?: string, name?: string) => {
      if (uid && !personSet.has(uid)) {
        const user = usersMap.get(uid);
        personSet.set(uid, user?.name || name || 'Bilinmiyor');
      }
    };
    teknikForms.forEach((f) => addPerson(f.createdByUid, f.createdByName));
    aplikasyonForms.forEach((f) => addPerson(f.createdByUid, f.createdByName));
    faultReports.forEach((f) => addPerson(f.assignedToUid, f.assignedToName));
    return Array.from(personSet.entries()).map(([uid, name]) => ({ uid, name })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [teknikForms, aplikasyonForms, faultReports, usersMap]);

  const filteredLabOptions = useMemo(() => {
    if (!labSearchTerm.trim()) return labOptions;
    const lower = labSearchTerm.toLowerCase();
    return labOptions.filter((l) => l.name.toLowerCase().includes(lower));
  }, [labOptions, labSearchTerm]);

  const filteredPersonnelOptions = useMemo(() => {
    if (!personnelSearchTerm.trim()) return availablePersonnel;
    const lower = personnelSearchTerm.toLowerCase();
    return availablePersonnel.filter((p) => p.name.toLowerCase().includes(lower));
  }, [availablePersonnel, personnelSearchTerm]);

  const toggleLab = (id: string) => {
    setSelectedLabIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const togglePersonnel = (uid: string) => {
    setSelectedPersonnelUids((prev) => { const next = new Set(prev); if (next.has(uid)) next.delete(uid); else next.add(uid); return next; });
  };

  const getRoleLabel = (role: string) => {
    if (role === 'teknik_servis' || role === 'teknisyen') return 'Teknik';
    if (role === 'aplikasyon') return 'Aplikasyon';
    if (role === 'admin') return 'Admin';
    return role || '-';
  };

  const getRoleBadgeColor = (role: string) => {
    if (role === 'teknik_servis' || role === 'teknisyen') return 'bg-blue-500/20 text-blue-400';
    if (role === 'aplikasyon') return 'bg-green-500/20 text-green-400';
    return 'bg-gray-500/20 text-gray-400';
  };

  const selectedPersonnelVisitDetails = useMemo(() => {
    if (!selectedChartPersonnelUid) return [] as PersonnelVisitDetail[];

    const detailsMap = new Map<string, PersonnelVisitDetail>();
    const addDetail = (institutionName: string, visitType: 'teknik_servis' | 'aplikasyon') => {
      const normalizedName = institutionName || 'Bilinmeyen Kurum';
      const detailKey = `${visitType}_${normalizedName}`;
      const current = detailsMap.get(detailKey) || { institutionName: normalizedName, visitType, visitCount: 0 };
      current.visitCount += 1;
      detailsMap.set(detailKey, current);
    };

    filteredData.filteredTeknik
      .filter((f) => f.createdByUid === selectedChartPersonnelUid)
      .forEach((f) => addDetail(f.labName || (f.hospitalId ? hospitalNamesMap.get(f.hospitalId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'), 'teknik_servis'));

    filteredData.filteredApp
      .filter((f) => f.createdByUid === selectedChartPersonnelUid)
      .forEach((f) => addDetail(f.labName || (f.hospitalId ? hospitalNamesMap.get(f.hospitalId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'), 'aplikasyon'));

    filteredData.filteredFaults
      .filter((f) => f.interventionType === 'kurum_ziyaret' && f.assignedToUid === selectedChartPersonnelUid)
      .forEach((f) => addDetail(f.labName || (f.labId ? hospitalNamesMap.get(f.labId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'), f.faultType));

    return Array.from(detailsMap.values()).sort((a, b) => b.visitCount - a.visitCount || a.institutionName.localeCompare(b.institutionName, 'tr'));
  }, [selectedChartPersonnelUid, filteredData, hospitalNamesMap]);

  const selectedChartPersonnel = useMemo(() => {
    if (!selectedChartPersonnelUid) return null;
    return analysis.personnelList.find((p) => p.uid === selectedChartPersonnelUid) || null;
  }, [selectedChartPersonnelUid, analysis.personnelList]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Veriler yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="device-module-page container max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/cihaz-yonetimi-ana')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Geri
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            Kurum Ziyaret Analizi
          </h1>
          <p className="text-sm text-muted-foreground">Teknik servis ve aplikasyon personellerinin kurum ziyaret analizi</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Popover open={labPopoverOpen} onOpenChange={setLabPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 h-9">
              <Building2 className="h-4 w-4" />
              {selectedLabIds.size === 0 ? 'Tüm Kurumlar' : `${selectedLabIds.size} Kurum`}
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Kurum ara..." value={labSearchTerm} onChange={(e) => setLabSearchTerm(e.target.value)} className="pl-8 h-8 text-sm" />
              </div>
            </div>
            <ScrollArea className="h-[250px]">
              <div className="p-1">
                {filteredLabOptions.map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer" onClick={() => toggleLab(opt.id)}>
                    <Checkbox checked={selectedLabIds.has(opt.id)} />
                    <span className="text-sm truncate">{opt.name}</span>
                    {opt.memberIds.length > 1 && <Badge variant="secondary" className="ml-auto text-xs shrink-0">{opt.memberIds.length} lab</Badge>}
                  </div>
                ))}
                {filteredLabOptions.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sonuç bulunamadı</p>}
              </div>
            </ScrollArea>
            {selectedLabIds.size > 0 && (
              <div className="p-2 border-t">
                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setSelectedLabIds(new Set())}>
                  <X className="h-3 w-3 mr-1" /> Filtreyi Temizle
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Popover open={personnelPopoverOpen} onOpenChange={setPersonnelPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 h-9">
              <Users className="h-4 w-4" />
              {selectedPersonnelUids.size === 0 ? 'Tüm Personel' : `${selectedPersonnelUids.size} Personel`}
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Personel ara..." value={personnelSearchTerm} onChange={(e) => setPersonnelSearchTerm(e.target.value)} className="pl-8 h-8 text-sm" />
              </div>
            </div>
            <ScrollArea className="h-[250px]">
              <div className="p-1">
                {filteredPersonnelOptions.map((p) => (
                  <div key={p.uid} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer" onClick={() => togglePersonnel(p.uid)}>
                    <Checkbox checked={selectedPersonnelUids.has(p.uid)} />
                    <span className="text-sm truncate">{p.name}</span>
                    {usersMap.get(p.uid)?.role && (
                      <Badge className={cn('ml-auto text-xs shrink-0', getRoleBadgeColor(usersMap.get(p.uid)!.role))}>{getRoleLabel(usersMap.get(p.uid)!.role)}</Badge>
                    )}
                  </div>
                ))}
                {filteredPersonnelOptions.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sonuç bulunamadı</p>}
              </div>
            </ScrollArea>
            {selectedPersonnelUids.size > 0 && (
              <div className="p-2 border-t">
                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setSelectedPersonnelUids(new Set())}>
                  <X className="h-3 w-3 mr-1" /> Filtreyi Temizle
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {selectedLabIds.size > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            {Array.from(selectedLabIds).map((id) => {
              const opt = labOptions.find((o) => o.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1 text-xs">
                  {opt?.name || id}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => toggleLab(id)} />
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><Wrench className="h-5 w-5 text-blue-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Teknik Servis Ziyaretleri</p>
                <p className="text-2xl font-bold">{analysis.totalTeknik}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{analysis.teknikFormCount} form + {analysis.teknikFaultVisitCount} arıza</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><FlaskConical className="h-5 w-5 text-green-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Aplikasyon Ziyaretleri</p>
                <p className="text-2xl font-bold">{analysis.totalApp}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{analysis.appFormCount} form + {analysis.appFaultVisitCount} arıza</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10"><Building2 className="h-5 w-5 text-purple-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Toplam Kurum Ziyareti</p>
                <p className="text-2xl font-bold">{analysis.totalTeknik + analysis.totalApp}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10"><Users className="h-5 w-5 text-orange-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Aktif Personel</p>
                <p className="text-2xl font-bold">{analysis.personnelList.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {analysis.chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Personel Bazlı Kurum Ziyaret Sayıları</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analysis.chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const data = payload[0]?.payload;
                      return (
                        <div className="glass-card p-3 text-sm">
                          <p className="font-semibold mb-1">{data?.fullName}</p>
                          <Badge className={cn('text-xs mb-1', getRoleBadgeColor(data?.role || ''))}>{getRoleLabel(data?.role || '')}</Badge>
                          <p className="font-semibold mt-1">Ziyaret: {data?.ziyaret}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="ziyaret"
                    fill="#8884d8"
                    name="Ziyaret Sayısı"
                    radius={[0, 4, 4, 0]}
                    onClick={(barData) => {
                      const payload = barData?.payload as { uid?: string } | undefined;
                      if (payload?.uid) {
                        setSelectedChartPersonnelUid(payload.uid);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    {analysis.chartData.map((entry, i) => (
                      <Cell key={`cell-${i}`} fill={entry.role === 'teknik_servis' || entry.role === 'teknisyen' ? '#60a5fa' : entry.role === 'aplikasyon' ? '#34d399' : '#a78bfa'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Personnel Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Personel Detay Tablosu</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Personel</TableHead>
                <TableHead className="text-center">Birim</TableHead>
                <TableHead className="text-center">Ziyaret Sayısı</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.personnelList.map((p, i) => (
                <TableRow key={p.uid}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-center">
                    <Badge className={cn('text-xs', getRoleBadgeColor(p.role))}>{getRoleLabel(p.role)}</Badge>
                  </TableCell>
                  <TableCell className="text-center font-semibold">{p.visitCount}</TableCell>
                </TableRow>
              ))}
              {analysis.personnelList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">Kurum ziyaret verisi bulunamadı</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedChartPersonnelUid)} onOpenChange={(open) => !open && setSelectedChartPersonnelUid(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedChartPersonnel?.name || 'Personel'} - Ziyaret Edilen Kurumlar
            </DialogTitle>
            <DialogDescription>
              Grafikte seçilen personelin kurum ziyaretlerinin kurum bazlı listesi.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[420px] overflow-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kurum</TableHead>
                  <TableHead className="text-center">Tür</TableHead>
                  <TableHead className="text-center">Ziyaret</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedPersonnelVisitDetails.map((detail) => (
                  <TableRow key={`${detail.visitType}-${detail.institutionName}`}>
                    <TableCell className="font-medium">{detail.institutionName}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={cn('text-xs', getRoleBadgeColor(detail.visitType))}>{getRoleLabel(detail.visitType)}</Badge>
                    </TableCell>
                    <TableCell className="text-center font-semibold">{detail.visitCount}</TableCell>
                  </TableRow>
                ))}
                {selectedPersonnelVisitDetails.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      Bu personel için kurum ziyareti bulunamadı.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
