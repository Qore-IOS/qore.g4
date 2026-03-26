'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Building2, Users, Wrench, FlaskConical, Search, X, ChevronsUpDown, ArrowLeft, Settings2, CalendarDays } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import type { Hospital, LabPool, User } from '@/lib/types';
import type { DateRange } from 'react-day-picker';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';

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
  closedAt: Date | null;
}

interface LabOption {
  id: string;
  name: string;
  memberIds: string[];
  type: 'group' | 'lab';
}

interface PersonnelVisitDetail {
  institutionName: string;
  visitCount: number;
  visitType: 'teknik_servis' | 'aplikasyon';
  records: PersonnelVisitRecord[];
}

interface PersonnelVisitRecord {
  id: string;
  institutionName: string;
  visitType: 'teknik_servis' | 'aplikasyon';
  date: Date | null;
  source: 'form' | 'fault';
}

function logFirestoreIndexHint(error: unknown, context: string) {
  const err = (error as { message?: string; code?: string; name?: string } | null) || {};
  const message = err.message || '';
  const code = err.code || 'unknown';
  const name = err.name || 'UnknownError';
  const indexUrlMatch = message.match(/https:\/\/console\.firebase\.google\.com\/[^\s]+/);

  console.error(`[${context}] Firestore sorgu hatası`, { code, name, message });

  if (indexUrlMatch) {
    console.error(`[${context}] Firestore index gerekli. Oluşturma linki: ${indexUrlMatch[0]}`);
    return;
  }

  if (code === 'failed-precondition') {
    console.error(`[${context}] Firestore sorgusu index bekliyor. Hata:`, error);
    console.error(`[${context}] Hata mesajında otomatik index linki bulunamadı. Firebase Console > Firestore > Indexes bölümünden kontrol edin.`);
    return;
  }

  if (code.includes('cors') || message.toLowerCase().includes('cors') || message.includes('ERR_FAILED') || message.includes('302')) {
    console.error(`[${context}] Bu hata index değil, ağ/CORS/proxy kaynaklı görünüyor. Index linki bu yüzden üretilemiyor.`);
  }
}

export default function KurumZiyaretAnaliziPage() {
  const router = useRouter();
  const { currentCompanyId, isSuperAdmin } = useAuth();
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
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [shiftFilter, setShiftFilter] = useState<'all' | 'inside' | 'outside'>('all');
  const [workStartTime, setWorkStartTime] = useState('09:00');
  const [workEndTime, setWorkEndTime] = useState('18:00');
  const [workSettingsOpen, setWorkSettingsOpen] = useState(false);
  const [selectedVisitDetail, setSelectedVisitDetail] = useState<PersonnelVisitDetail | null>(null);

  const toDateValue = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate();
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const isDateInRange = (date: Date | null) => {
    if (!date) return false;
    if (!dateRange?.from) return true;
    const start = new Date(dateRange.from);
    start.setHours(0, 0, 0, 0);
    if (date < start) return false;
    if (dateRange.to) {
      const end = new Date(dateRange.to);
      end.setHours(23, 59, 59, 999);
      return date <= end;
    }
    return true;
  };

  const getMinutes = (hhmm: string) => {
    const [hours, minutes] = hhmm.split(':').map(Number);
    return (hours * 60) + minutes;
  };

  const isWithinWorkHours = (date: Date | null) => {
    if (!date) return false;
    const currentMinute = date.getHours() * 60 + date.getMinutes();
    const start = getMinutes(workStartTime);
    const end = getMinutes(workEndTime);
    if (start <= end) {
      return currentMinute >= start && currentMinute <= end;
    }
    return currentMinute >= start || currentMinute <= end;
  };

  const matchesShiftFilter = (date: Date | null) => {
    if (shiftFilter === 'all') return true;
    const inShift = isWithinWorkHours(date);
    return shiftFilter === 'inside' ? inShift : !inShift;
  };

  const formatDateTime = (date: Date | null) => {
    if (!date) return '-';
    return new Intl.DateTimeFormat('tr-TR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  useEffect(() => {
    const fetchWorkHours = async () => {
      try {
        const settingsRef = doc(db, 'appSettings', 'kurumZiyaretAnalizi');
        const settingsSnap = await getDoc(settingsRef);
        if (!settingsSnap.exists()) return;
        const data = settingsSnap.data();
        if (typeof data.workStartTime === 'string') {
          setWorkStartTime(data.workStartTime);
        }
        if (typeof data.workEndTime === 'string') {
          setWorkEndTime(data.workEndTime);
        }
      } catch (error) {
        console.error('Mesai saati ayarları alınamadı:', error);
      }
    };

    fetchWorkHours();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [teknikSnap, appSnap, faultSnap, usersSnap, hospitalsSnap, deviceLabPoolsSnap] = await Promise.all([
          getDocs(companyQuery(db, 'teknikServisActionForms', currentCompanyId, orderBy('createdAt', 'desc'))),
          getDocs(companyQuery(db, 'aplikasyonActionForms', currentCompanyId, orderBy('createdAt', 'desc'))),
          getDocs(companyQuery(db, 'deviceFaultReports', currentCompanyId, orderBy('openedAt', 'desc'))),
          getDocs(companyQuery(db, 'users', currentCompanyId)),
          getDocs(companyQuery(db, 'hospitals', currentCompanyId)),
          getDocs(companyQuery(db, 'deviceLabPools', currentCompanyId)),
        ]);

        const uMap = new Map<string, User>();
        filterByCompanyScope(
          usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() } as User)),
          currentCompanyId,
          isSuperAdmin
        ).forEach((user) => {
          uMap.set(user.uid, user);
        });
        setUsersMap(uMap);

        const scopedHospitals = filterByCompanyScope(
          hospitalsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
          currentCompanyId,
          isSuperAdmin
        );
        const hospitalsMap = new Map<string, Hospital>();
        const hospitalsNameMap = new Map<string, string>();
        scopedHospitals.forEach((hospital) => {
          hospitalsMap.set(hospital.id, hospital);
          hospitalsNameMap.set(hospital.id, hospital.name || 'Bilinmiyor');
        });
        setHospitalNamesMap(hospitalsNameMap);

        const pools: LabPool[] = filterByCompanyScope(
          deviceLabPoolsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LabPool)),
          currentCompanyId,
          isSuperAdmin
        ).filter((p) => p.active !== false);

        const options: LabOption[] = [];

        for (const pool of pools) {
          if (!pool.memberIds?.length) continue;
          const memberIds = pool.memberIds.filter((id, idx, arr) => id && arr.indexOf(id) === idx && hospitalsMap.has(id));
          if (memberIds.length === 0) continue;
          options.push({
            id: pool.id,
            name: pool.name || 'Bilinmiyor',
            memberIds,
            type: 'group',
          });
        }

        hospitalsMap.forEach((h, id) => {
          options.push({ id, name: h.name || 'Bilinmiyor', memberIds: [id], type: 'lab' });
        });

        options.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        setLabOptions(options);

        setTeknikForms(
          filterByCompanyScope(teknikSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id, createdByUid: data.createdByUid, createdByName: data.createdByName || 'Bilinmiyor',
              hospitalId: data.hospitalId, labName: data.labName, formType: 'teknik_servis' as const,
              createdAt: toDateValue(data.createdAt) || new Date(0),
            };
          }), currentCompanyId, isSuperAdmin)
        );

        setAplikasyonForms(
          filterByCompanyScope(appSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id, createdByUid: data.createdByUid, createdByName: data.createdByName || 'Bilinmiyor',
              hospitalId: data.hospitalId, labName: data.labName, formType: 'aplikasyon' as const,
              createdAt: toDateValue(data.createdAt) || new Date(0),
            };
          }), currentCompanyId, isSuperAdmin)
        );

        setFaultReports(
          filterByCompanyScope(faultSnap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id, interventionType: data.interventionType, faultType: data.faultType,
              assignedToUid: data.assignedToUid, assignedToName: data.assignedToName,
              labId: data.labId, labName: data.labName, status: data.status,
              closedAt: toDateValue(data.closedAt),
            };
          }), currentCompanyId, isSuperAdmin)
        );
      } catch (error) {
        logFirestoreIndexHint(error, 'kurum-ziyaret-analizi/fetchData');
        console.error('Kurum ziyaret analizi veri hatası:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentCompanyId, isSuperAdmin]);

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

    filteredTeknik = filteredTeknik.filter((f) => isDateInRange(f.createdAt) && matchesShiftFilter(f.createdAt));
    filteredApp = filteredApp.filter((f) => isDateInRange(f.createdAt) && matchesShiftFilter(f.createdAt));
    filteredFaults = filteredFaults.filter((f) => isDateInRange(f.closedAt) && matchesShiftFilter(f.closedAt));

    return { filteredTeknik, filteredApp, filteredFaults };
  }, [teknikForms, aplikasyonForms, faultReports, selectedLabIdsFull, selectedPersonnelUids, dateRange, shiftFilter, workStartTime, workEndTime]);

  const analysis = useMemo(() => {
    const { filteredTeknik, filteredApp, filteredFaults } = filteredData;

    const teknikFormCount = filteredTeknik.length;
    const appFormCount = filteredApp.length;

    const teknikFaultVisits = filteredFaults.filter((f) => f.interventionType === 'kurum_ziyaret' && f.faultType === 'teknik_servis');
    const appFaultVisits = filteredFaults.filter((f) => f.interventionType === 'kurum_ziyaret' && f.faultType === 'aplikasyon');

    const totalTeknik = teknikFormCount + teknikFaultVisits.length;
    const totalApp = appFormCount + appFaultVisits.length;

    const personnelMap = new Map<string, { name: string; role: string; visitCount: number; formVisitCount: number; faultVisitCount: number }>();

    const addVisit = (uid: string | undefined, name: string, visitType: 'teknik_servis' | 'aplikasyon', source: 'form' | 'fault') => {
      if (!uid) return;
      const user = usersMap.get(uid);
      const userRole = user?.role || '';
      const isTeknikPerson = userRole === 'teknik_servis' || userRole === 'teknisyen';
      const isAppPerson = userRole === 'aplikasyon';
      if (isTeknikPerson && visitType !== 'teknik_servis') return;
      if (isAppPerson && visitType !== 'aplikasyon') return;
      const existing = personnelMap.get(uid) || { name: name || user?.name || 'Bilinmiyor', role: userRole, visitCount: 0, formVisitCount: 0, faultVisitCount: 0 };
      existing.visitCount++;
      if (source === 'form') existing.formVisitCount++;
      if (source === 'fault') existing.faultVisitCount++;
      personnelMap.set(uid, existing);
    };

    filteredTeknik.forEach((f) => addVisit(f.createdByUid, f.createdByName, 'teknik_servis', 'form'));
    filteredApp.forEach((f) => addVisit(f.createdByUid, f.createdByName, 'aplikasyon', 'form'));
    teknikFaultVisits.forEach((f) => addVisit(f.assignedToUid, f.assignedToName || 'Bilinmiyor', 'teknik_servis', 'fault'));
    appFaultVisits.forEach((f) => addVisit(f.assignedToUid, f.assignedToName || 'Bilinmiyor', 'aplikasyon', 'fault'));

    const personnelList = Array.from(personnelMap.entries()).map(([uid, data]) => ({ uid, ...data })).sort((a, b) => b.visitCount - a.visitCount);
    const chartData = personnelList.slice(0, 15).map((p) => ({
      uid: p.uid,
      name: p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name,
      fullName: p.name, role: p.role, ziyaret: p.visitCount, formVisitCount: p.formVisitCount, faultVisitCount: p.faultVisitCount,
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
    const lower = labSearchTerm.trim().toLowerCase();
    const options = lower
      ? labOptions.filter((l) => l.name.toLowerCase().includes(lower))
      : labOptions;

    return [...options].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'group' ? -1 : 1;
      return a.name.localeCompare(b.name, 'tr');
    });
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
    const addDetail = (
      institutionName: string,
      visitType: 'teknik_servis' | 'aplikasyon',
      record: Omit<PersonnelVisitRecord, 'institutionName' | 'visitType'>,
    ) => {
      const normalizedName = institutionName || 'Bilinmeyen Kurum';
      const detailKey = `${visitType}_${normalizedName}`;
      const current = detailsMap.get(detailKey) || { institutionName: normalizedName, visitType, visitCount: 0, records: [] };
      current.visitCount += 1;
      current.records.push({
        ...record,
        institutionName: normalizedName,
        visitType,
      });
      detailsMap.set(detailKey, current);
    };

    filteredData.filteredTeknik
      .filter((f) => f.createdByUid === selectedChartPersonnelUid)
      .forEach((f) => addDetail(
        f.labName || (f.hospitalId ? hospitalNamesMap.get(f.hospitalId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'),
        'teknik_servis',
        {
          id: f.id,
          date: f.createdAt,
          source: 'form',
        },
      ));

    filteredData.filteredApp
      .filter((f) => f.createdByUid === selectedChartPersonnelUid)
      .forEach((f) => addDetail(
        f.labName || (f.hospitalId ? hospitalNamesMap.get(f.hospitalId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'),
        'aplikasyon',
        {
          id: f.id,
          date: f.createdAt,
          source: 'form',
        },
      ));

    filteredData.filteredFaults
      .filter((f) => f.interventionType === 'kurum_ziyaret' && f.assignedToUid === selectedChartPersonnelUid)
      .forEach((f) => addDetail(
        f.labName || (f.labId ? hospitalNamesMap.get(f.labId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'),
        f.faultType,
        {
          id: f.id,
          date: f.closedAt,
          source: 'fault',
        },
      ));

    return Array.from(detailsMap.values())
      .map((detail) => ({
        ...detail,
        records: detail.records.sort((a, b) => {
          const first = a.date ? a.date.getTime() : 0;
          const second = b.date ? b.date.getTime() : 0;
          return second - first;
        }),
      }))
      .sort((a, b) => b.visitCount - a.visitCount || a.institutionName.localeCompare(b.institutionName, 'tr'));
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
              {selectedLabIds.size === 0 ? 'Tüm Kurumlar ve Gruplar' : `${selectedLabIds.size} Seçim`}
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Grup / kurum ara..." value={labSearchTerm} onChange={(e) => setLabSearchTerm(e.target.value)} className="pl-8 h-8 text-sm" />
              </div>
            </div>
            <ScrollArea className="h-[250px]">
              <div className="p-1">
                {filteredLabOptions.map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer" onClick={() => toggleLab(opt.id)}>
                    <Checkbox checked={selectedLabIds.has(opt.id)} />
                    <span className="text-sm truncate">{opt.name}</span>
                    <Badge variant="secondary" className="ml-auto text-xs shrink-0">
                      {opt.type === 'group' ? `Grup · ${opt.memberIds.length} lab` : 'Tekli'}
                    </Badge>
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

        <DatePickerWithRange date={dateRange} setDate={setDateRange} className="w-[280px]" />

        <Select value={shiftFilter} onValueChange={(value: 'all' | 'inside' | 'outside') => setShiftFilter(value)}>
          <SelectTrigger className="w-[220px] h-9">
            <SelectValue placeholder="Mesai filtresi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Zamanlar</SelectItem>
            <SelectItem value="inside">Mesai İçi</SelectItem>
            <SelectItem value="outside">Mesai Dışı</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" className="gap-2 h-9" onClick={() => setWorkSettingsOpen(true)}>
          <Settings2 className="h-4 w-4" />
          Mesai Ayarı
        </Button>

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
                          <p className="text-xs text-muted-foreground">{data?.formVisitCount || 0} form + {data?.faultVisitCount || 0} arıza</p>
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
                  <TableCell className="text-center font-semibold">
                    {p.visitCount}
                    <p className="text-xs text-muted-foreground font-normal">{p.formVisitCount} form + {p.faultVisitCount} arıza</p>
                  </TableCell>
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

      <Dialog open={Boolean(selectedChartPersonnelUid)} onOpenChange={(open) => {
        if (!open) {
          setSelectedChartPersonnelUid(null);
          setSelectedVisitDetail(null);
        }
      }}>
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
                    <TableCell className="text-center font-semibold">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto p-0 font-semibold text-primary hover:text-primary"
                        onClick={() => setSelectedVisitDetail(detail)}
                      >
                        {detail.visitCount}
                      </Button>
                    </TableCell>
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

      <Dialog open={workSettingsOpen} onOpenChange={setWorkSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Mesai Saatleri
            </DialogTitle>
            <DialogDescription>
              Mesai içi/dışı filtreleri bu başlangıç ve bitiş saatine göre çalışır.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="work-start-time">Başlangıç</Label>
              <Input id="work-start-time" type="time" value={workStartTime} onChange={(e) => setWorkStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="work-end-time">Bitiş</Label>
              <Input id="work-end-time" type="time" value={workEndTime} onChange={(e) => setWorkEndTime(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                try {
                  await setDoc(doc(db, 'appSettings', 'kurumZiyaretAnalizi'), {
                    workStartTime,
                    workEndTime,
                    updatedAt: serverTimestamp(),
                  }, { merge: true });
                } catch (error) {
                  console.error('Mesai ayarı kaydedilemedi:', error);
                } finally {
                  setWorkSettingsOpen(false);
                }
              }}
            >
              Kaydet
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedVisitDetail)} onOpenChange={(open) => !open && setSelectedVisitDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedVisitDetail?.institutionName || 'Kurum'} - İşlem Detayları
            </DialogTitle>
            <DialogDescription>
              Seçilen ziyaret kaydına ait işlem tarihleri ve bitiş saatleri.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[420px] overflow-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">#</TableHead>
                  <TableHead>Tür</TableHead>
                  <TableHead>Kaynak</TableHead>
                  <TableHead className="text-right">Tarih / Bitiş Saati</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedVisitDetail?.records.map((record, index) => (
                  <TableRow key={`${record.source}-${record.id}-${index}`}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      <Badge className={cn('text-xs', getRoleBadgeColor(record.visitType))}>{getRoleLabel(record.visitType)}</Badge>
                    </TableCell>
                    <TableCell>{record.source === 'fault' ? 'Arıza Kapanış' : 'Form Kaydı'}</TableCell>
                    <TableCell className="text-right font-medium">{formatDateTime(record.date)}</TableCell>
                  </TableRow>
                ))}
                {!selectedVisitDetail?.records.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      Detay kayıt bulunamadı.
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
