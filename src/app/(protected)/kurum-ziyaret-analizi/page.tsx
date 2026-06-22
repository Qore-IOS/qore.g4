'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Building2, Users, Search, X, ChevronsUpDown, Settings2, CalendarDays } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import type { Hospital, LabPool, User } from '@/lib/types';
import type { DateRange } from 'react-day-picker';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { DateRangeFilterBar } from '@/components/common/DateRangeFilterBar';
import { filterByCompanyScope } from '@/lib/company-scope';
import {
  ClayPage, PageHead, Card, CardHead, KpiTile, Pill, GhostBtn,
  HBar, RoleChip, ClayLoader, C, PAL, useMode, fmtInt,
} from '@/components/cihaz-yonetimi/clay-kit';

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

interface VisitEvent {
  id: string;
  institutionName: string;
  visitType: 'teknik_servis' | 'aplikasyon';
  source: 'form' | 'fault';
  personnelUid?: string;
  personnelName: string;
  date: Date | null;
}

interface AggregatedVisit {
  id: string;
  institutionName: string;
  visitType: 'teknik_servis' | 'aplikasyon';
  personnelUid?: string;
  personnelName: string;
  dayKey: string;
  date: Date | null;
  source: 'form' | 'fault' | 'mixed';
  records: PersonnelVisitRecord[];
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
  const mode = useMode();
  const mobile = mode === 'mobile';

  // Ziyaret analizi penceresi — varsayılan son 365 gün.
  const dateFilter = useDateRangeFilter({
    defaultDays: 365,
    storageKey: 'kurum-ziyaret-analizi:range',
  });
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


  const getVisitDayKey = (date: Date | null) => {
    if (!date) return 'tarihsiz';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const aggregateVisitEvents = (events: VisitEvent[]) => {
    const grouped = new Map<string, AggregatedVisit>();

    events.forEach((event) => {
      const dayKey = getVisitDayKey(event.date);
      const aggregateKey = `${event.personnelUid || event.personnelName}|${event.visitType}|${event.institutionName}|${dayKey}`;
      const existing = grouped.get(aggregateKey);

      if (!existing) {
        grouped.set(aggregateKey, {
          id: aggregateKey,
          institutionName: event.institutionName || 'Bilinmeyen Kurum',
          visitType: event.visitType,
          personnelUid: event.personnelUid,
          personnelName: event.personnelName || 'Bilinmiyor',
          dayKey,
          date: event.date,
          source: event.source,
          records: [{
            id: event.id,
            institutionName: event.institutionName || 'Bilinmeyen Kurum',
            visitType: event.visitType,
            date: event.date,
            source: event.source,
          }],
        });
        return;
      }

      if ((event.date?.getTime() || 0) > (existing.date?.getTime() || 0)) {
        existing.date = event.date;
      }

      existing.source = existing.source === event.source ? existing.source : 'mixed';
      existing.records.push({
        id: event.id,
        institutionName: event.institutionName || 'Bilinmeyen Kurum',
        visitType: event.visitType,
        date: event.date,
        source: event.source,
      });
    });

    return Array.from(grouped.values()).map((visit) => ({
      ...visit,
      records: visit.records.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0)),
    }));
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
          getDocs(scopedQuery('teknikServisActionForms', currentCompanyId, isSuperAdmin,
            ...dateFilter.constraints('createdAt'), orderBy('createdAt', 'desc'), limit(5000))),
          getDocs(scopedQuery('aplikasyonActionForms', currentCompanyId, isSuperAdmin,
            ...dateFilter.constraints('createdAt'), orderBy('createdAt', 'desc'), limit(5000))),
          getDocs(scopedQuery('deviceFaultReports', currentCompanyId, isSuperAdmin,
            ...dateFilter.constraints('openedAt'), orderBy('openedAt', 'desc'), limit(5000))),
          getDocs(scopedQuery('users', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('deviceLabPools', currentCompanyId, isSuperAdmin)),
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
              companyId: data.companyId,
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
              companyId: data.companyId,
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
              companyId: data.companyId,
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
  }, [currentCompanyId, isSuperAdmin, dateFilter.range]);

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

    const teknikFaultVisits = filteredFaults.filter((f) => f.interventionType === 'kurum_ziyaret' && f.faultType === 'teknik_servis');
    const appFaultVisits = filteredFaults.filter((f) => f.interventionType === 'kurum_ziyaret' && f.faultType === 'aplikasyon');

    const allEvents: VisitEvent[] = [
      ...filteredTeknik.map((f) => ({
        id: f.id,
        institutionName: f.labName || (f.hospitalId ? hospitalNamesMap.get(f.hospitalId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'),
        visitType: 'teknik_servis' as const,
        source: 'form' as const,
        personnelUid: f.createdByUid,
        personnelName: f.createdByName || 'Bilinmiyor',
        date: f.createdAt,
      })),
      ...filteredApp.map((f) => ({
        id: f.id,
        institutionName: f.labName || (f.hospitalId ? hospitalNamesMap.get(f.hospitalId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'),
        visitType: 'aplikasyon' as const,
        source: 'form' as const,
        personnelUid: f.createdByUid,
        personnelName: f.createdByName || 'Bilinmiyor',
        date: f.createdAt,
      })),
      ...teknikFaultVisits.map((f) => ({
        id: f.id,
        institutionName: f.labName || (f.labId ? hospitalNamesMap.get(f.labId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'),
        visitType: 'teknik_servis' as const,
        source: 'fault' as const,
        personnelUid: f.assignedToUid,
        personnelName: f.assignedToName || 'Bilinmiyor',
        date: f.closedAt,
      })),
      ...appFaultVisits.map((f) => ({
        id: f.id,
        institutionName: f.labName || (f.labId ? hospitalNamesMap.get(f.labId) || 'Bilinmeyen Kurum' : 'Bilinmeyen Kurum'),
        visitType: 'aplikasyon' as const,
        source: 'fault' as const,
        personnelUid: f.assignedToUid,
        personnelName: f.assignedToName || 'Bilinmiyor',
        date: f.closedAt,
      })),
    ];

    const aggregatedVisits = aggregateVisitEvents(allEvents);
    const teknikVisits = aggregatedVisits.filter((v) => v.visitType === 'teknik_servis');
    const appVisits = aggregatedVisits.filter((v) => v.visitType === 'aplikasyon');

    const personnelMap = new Map<string, { name: string; role: string; visitCount: number; formVisitCount: number; faultVisitCount: number }>();
    aggregatedVisits.forEach((visit) => {
      if (!visit.personnelUid) return;
      const user = usersMap.get(visit.personnelUid);
      const userRole = user?.role || '';
      const isTeknikPerson = userRole === 'teknik_servis' || userRole === 'teknisyen';
      const isAppPerson = userRole === 'aplikasyon';
      if (isTeknikPerson && visit.visitType !== 'teknik_servis') return;
      if (isAppPerson && visit.visitType !== 'aplikasyon') return;
      const existing = personnelMap.get(visit.personnelUid) || { name: visit.personnelName || user?.name || 'Bilinmiyor', role: userRole, visitCount: 0, formVisitCount: 0, faultVisitCount: 0 };
      existing.visitCount += 1;
      if (visit.source === 'form') existing.formVisitCount += 1;
      else if (visit.source === 'fault') existing.faultVisitCount += 1;
      else {
        existing.formVisitCount += 1;
        existing.faultVisitCount += 1;
      }
      personnelMap.set(visit.personnelUid, existing);
    });

    const personnelList = Array.from(personnelMap.entries()).map(([uid, data]) => ({ uid, ...data })).sort((a, b) => b.visitCount - a.visitCount);
    const chartData = personnelList.slice(0, 15).map((p) => ({ uid: p.uid, name: p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name, fullName: p.name, role: p.role, ziyaret: p.visitCount, formVisitCount: p.formVisitCount, faultVisitCount: p.faultVisitCount }));

    return { totalTeknik: teknikVisits.length, totalApp: appVisits.length, teknikFormCount: teknikVisits.filter((v) => v.source !== 'fault').length, appFormCount: appVisits.filter((v) => v.source !== 'fault').length, teknikFaultVisitCount: teknikVisits.filter((v) => v.source !== 'form').length, appFaultVisitCount: appVisits.filter((v) => v.source !== 'form').length, personnelList, chartData, aggregatedVisits };
  }, [filteredData, usersMap, hospitalNamesMap]);

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

  // role/visit-type → clay kit role key ('tech' | 'app' | 'admin')
  const roleKey = (role: string): 'tech' | 'app' | 'admin' => {
    if (role === 'teknik_servis' || role === 'teknisyen') return 'tech';
    if (role === 'aplikasyon') return 'app';
    return 'admin';
  };
  const roleColor = (role: string) => PAL[roleKey(role)];

  const selectedPersonnelVisitDetails = useMemo(() => {
    if (!selectedChartPersonnelUid) return [] as PersonnelVisitDetail[];

    const visitsByInstitution = new Map<string, PersonnelVisitDetail>();

    analysis.aggregatedVisits
      .filter((v) => v.personnelUid === selectedChartPersonnelUid)
      .forEach((visit) => {
        const detailKey = `${visit.visitType}_${visit.institutionName}`;
        const current = visitsByInstitution.get(detailKey) || { institutionName: visit.institutionName, visitType: visit.visitType, visitCount: 0, records: [] };
        current.visitCount += 1;
        current.records.push({
          id: visit.id,
          institutionName: visit.institutionName,
          visitType: visit.visitType,
          date: visit.date,
          source: visit.source === 'fault' ? 'fault' : 'form',
        });
        visitsByInstitution.set(detailKey, current);
      });

    return Array.from(visitsByInstitution.values())
      .map((detail) => ({
        ...detail,
        records: detail.records.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0)),
      }))
      .sort((a, b) => b.visitCount - a.visitCount || a.institutionName.localeCompare(b.institutionName, 'tr'));
  }, [selectedChartPersonnelUid, analysis.aggregatedVisits]);

  const selectedChartPersonnel = useMemo(() => {
    if (!selectedChartPersonnelUid) return null;
    return analysis.personnelList.find((p) => p.uid === selectedChartPersonnelUid) || null;
  }, [selectedChartPersonnelUid, analysis.personnelList]);

  if (loading) {
    return (
      <ClayPage>
        <ClayLoader label="Veriler yükleniyor…" />
      </ClayPage>
    );
  }

  const totalVisits = analysis.totalTeknik + analysis.totalApp;
  const labelW = mobile ? 92 : 130;

  return (
    <ClayPage>
      <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 12 : 16 }}>
        <PageHead
          ico="building"
          title="Kurum Ziyaret Analizi"
          sub="Teknik servis ve aplikasyon personellerinin kurum ziyaret analizi"
          onBack={() => router.push('/cihaz-yonetimi-ana')}
          mobile={mobile}
        />

        {/* Analiz penceresi */}
        <Card pad={mobile ? 14 : 16}>
          <DateRangeFilterBar
            range={dateFilter.range}
            setRange={dateFilter.setRange}
            label="Analiz penceresi"
          />
        </Card>

        {/* Filters */}
        <Card pad={mobile ? 14 : 16}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Popover open={labPopoverOpen} onOpenChange={setLabPopoverOpen}>
              <PopoverTrigger asChild>
                <span>
                  <GhostBtn active={selectedLabIds.size > 0}>
                    <Building2 size={16} />
                    {selectedLabIds.size === 0 ? 'Tüm Kurumlar ve Gruplar' : `${selectedLabIds.size} Seçim`}
                    <ChevronsUpDown size={14} style={{ opacity: 0.5 }} />
                  </GhostBtn>
                </span>
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
                    <button type="button" className="flex items-center justify-center gap-1 w-full text-xs py-1.5 rounded-md hover:bg-accent/50" onClick={() => setSelectedLabIds(new Set())}>
                      <X className="h-3 w-3" /> Filtreyi Temizle
                    </button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            <Popover open={personnelPopoverOpen} onOpenChange={setPersonnelPopoverOpen}>
              <PopoverTrigger asChild>
                <span>
                  <GhostBtn active={selectedPersonnelUids.size > 0}>
                    <Users size={16} />
                    {selectedPersonnelUids.size === 0 ? 'Tüm Personel' : `${selectedPersonnelUids.size} Personel`}
                    <ChevronsUpDown size={14} style={{ opacity: 0.5 }} />
                  </GhostBtn>
                </span>
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
                    <button type="button" className="flex items-center justify-center gap-1 w-full text-xs py-1.5 rounded-md hover:bg-accent/50" onClick={() => setSelectedPersonnelUids(new Set())}>
                      <X className="h-3 w-3" /> Filtreyi Temizle
                    </button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            <DatePickerWithRange date={dateRange} setDate={setDateRange} className={mobile ? 'w-full' : 'w-[280px]'} />

            <Select value={shiftFilter} onValueChange={(value: 'all' | 'inside' | 'outside') => setShiftFilter(value)}>
              <SelectTrigger className={mobile ? 'w-full h-9' : 'w-[200px] h-9'}>
                <SelectValue placeholder="Mesai filtresi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tüm Zamanlar</SelectItem>
                <SelectItem value="inside">Mesai İçi</SelectItem>
                <SelectItem value="outside">Mesai Dışı</SelectItem>
              </SelectContent>
            </Select>

            <GhostBtn onClick={() => setWorkSettingsOpen(true)}>
              <Settings2 size={16} /> Mesai Ayarı
            </GhostBtn>

            {selectedLabIds.size > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {Array.from(selectedLabIds).map((id) => {
                  const opt = labOptions.find((o) => o.id === id);
                  return (
                    <Pill key={id}>
                      {opt?.name || id}
                      <X size={12} style={{ cursor: 'pointer' }} onClick={() => toggleLab(id)} />
                    </Pill>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* Summary KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: mobile ? 12 : 16 }}>
          <KpiTile
            ico="wrench"
            label="Teknik Servis Ziyaretleri"
            value={analysis.totalTeknik}
            tone="tech"
            foot={<span>{fmtInt(analysis.teknikFormCount)} form + {fmtInt(analysis.teknikFaultVisitCount)} arıza</span>}
          />
          <KpiTile
            ico="flask"
            label="Aplikasyon Ziyaretleri"
            value={analysis.totalApp}
            tone="app"
            foot={<span>{fmtInt(analysis.appFormCount)} form + {fmtInt(analysis.appFaultVisitCount)} arıza</span>}
          />
          <KpiTile
            ico="building"
            label="Toplam Kurum Ziyareti"
            value={totalVisits}
            tone="admin"
            foot={<span>tüm personel</span>}
          />
          <KpiTile
            ico="users"
            label="Aktif Personel"
            value={analysis.personnelList.length}
            foot={<span>sahada aktif</span>}
          />
        </div>

        {/* Personnel bar chart */}
        {analysis.chartData.length > 0 && (
          <Card pad={mobile ? 14 : 18}>
            <CardHead
              title="Personel Bazlı Kurum Ziyaret Sayıları"
              right={!mobile ? (
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.ink2 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: PAL.tech }} /> Teknik
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.ink2 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: PAL.app }} /> Aplikasyon
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.ink2 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: PAL.admin }} /> Admin
                  </span>
                </div>
              ) : undefined}
            />
            <div style={{ marginTop: 14 }}>
              {analysis.chartData.map((entry) => (
                <div
                  key={entry.uid}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  onClick={() => entry.uid && setSelectedChartPersonnelUid(entry.uid)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && entry.uid) setSelectedChartPersonnelUid(entry.uid); }}
                >
                  <HBar
                    items={[{ label: entry.fullName, v: entry.ziyaret, color: roleColor(entry.role) }]}
                    labelW={labelW}
                    max={Math.max(1, ...analysis.chartData.map((c) => c.ziyaret))}
                  />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Personnel detail table */}
        <Card pad={mobile ? 14 : 18}>
          <CardHead title="Personel Detay Tablosu" sub={`${analysis.personnelList.length} personel`} />
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <div style={{ minWidth: 520 }}>
              {/* header */}
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 120px 150px', gap: 10, padding: '0 12px 10px', fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                <span>#</span>
                <span>Personel</span>
                <span style={{ textAlign: 'center' }}>Rol</span>
                <span style={{ textAlign: 'right' }}>Ziyaret · Pay%</span>
              </div>
              {analysis.personnelList.map((p, i) => {
                const pay = totalVisits > 0 ? Math.round((p.visitCount / totalVisits) * 100) : 0;
                return (
                  <div
                    key={p.uid}
                    role="button"
                    tabIndex={0}
                    className="cy-row-hover"
                    onClick={() => setSelectedChartPersonnelUid(p.uid)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedChartPersonnelUid(p.uid); }}
                    style={{
                      display: 'grid', gridTemplateColumns: '40px 1fr 120px 150px', gap: 10, alignItems: 'center',
                      padding: '11px 12px', borderRadius: C.radiusSm, cursor: 'pointer',
                      background: i % 2 ? C.surfaceHi : 'transparent',
                      animation: `cyPopIn 420ms cubic-bezier(.22,1,.36,1) ${Math.min(i, 12) * 40}ms both`,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.ink3, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span style={{ textAlign: 'center' }}><RoleChip role={roleKey(p.role)} /></span>
                    <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: C.ink1, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtInt(p.visitCount)} <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>· {pay}%</span>
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.ink3 }}>{fmtInt(p.formVisitCount)} form + {fmtInt(p.faultVisitCount)} arıza</span>
                    </span>
                  </div>
                );
              })}
              {analysis.personnelList.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13.5, fontWeight: 600, color: C.ink3 }}>
                  Kurum ziyaret verisi bulunamadı
                </div>
              )}
            </div>
          </div>
        </Card>

      <Dialog open={Boolean(selectedChartPersonnelUid)} onOpenChange={(open) => {
        if (!open) {
          setSelectedChartPersonnelUid(null);
          setSelectedVisitDetail(null);
        }
      }}>
        <DialogContent className="max-w-2xl" style={{ background: C.surface, borderColor: C.line }}>
          <DialogHeader>
            <DialogTitle style={{ color: C.ink1 }}>
              {selectedChartPersonnel?.name || 'Personel'} - Ziyaret Edilen Kurumlar
            </DialogTitle>
            <DialogDescription style={{ color: C.ink2 }}>
              Grafikte seçilen personelin kurum ziyaretlerinin kurum bazlı listesi.
            </DialogDescription>
          </DialogHeader>

          <div style={{ maxHeight: 420, overflow: 'auto', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset, padding: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px', gap: 10, padding: '6px 12px', fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              <span>Kurum</span>
              <span style={{ textAlign: 'center' }}>Tür</span>
              <span style={{ textAlign: 'right' }}>Ziyaret</span>
            </div>
            {selectedPersonnelVisitDetails.map((detail) => (
              <div
                key={`${detail.visitType}-${detail.institutionName}`}
                style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: C.radiusSm, background: C.surfaceHi, marginBottom: 4 }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: C.ink1 }}>{detail.institutionName}</span>
                <span style={{ textAlign: 'center' }}><RoleChip role={roleKey(detail.visitType)} /></span>
                <span style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedVisitDetail(detail)}
                    style={{ all: 'unset', cursor: 'pointer', fontSize: 15, fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {fmtInt(detail.visitCount)}
                  </button>
                </span>
              </div>
            ))}
            {selectedPersonnelVisitDetails.length === 0 && (
              <div style={{ textAlign: 'center', padding: '28px 0', fontSize: 13.5, fontWeight: 600, color: C.ink3 }}>
                Bu personel için kurum ziyareti bulunamadı.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={workSettingsOpen} onOpenChange={setWorkSettingsOpen}>
        <DialogContent className="max-w-md" style={{ background: C.surface, borderColor: C.line }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: C.ink1 }}>
              <CalendarDays className="h-4 w-4" /> Mesai Saatleri
            </DialogTitle>
            <DialogDescription style={{ color: C.ink2 }}>
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
            <GhostBtn
              active
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
            </GhostBtn>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedVisitDetail)} onOpenChange={(open) => !open && setSelectedVisitDetail(null)}>
        <DialogContent className="max-w-2xl" style={{ background: C.surface, borderColor: C.line }}>
          <DialogHeader>
            <DialogTitle style={{ color: C.ink1 }}>
              {selectedVisitDetail?.institutionName || 'Kurum'} - İşlem Detayları
            </DialogTitle>
            <DialogDescription style={{ color: C.ink2 }}>
              Seçilen ziyaret kaydına ait işlem tarihleri ve bitiş saatleri.
            </DialogDescription>
          </DialogHeader>

          <div style={{ maxHeight: 420, overflow: 'auto', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset, padding: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '40px 130px 1fr auto', gap: 10, padding: '6px 12px', fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              <span>#</span>
              <span>Tür</span>
              <span>Kaynak</span>
              <span style={{ textAlign: 'right' }}>Tarih / Bitiş Saati</span>
            </div>
            {selectedVisitDetail?.records.map((record, index) => (
              <div
                key={`${record.source}-${record.id}-${index}`}
                style={{ display: 'grid', gridTemplateColumns: '40px 130px 1fr auto', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: C.radiusSm, background: C.surfaceHi, marginBottom: 4 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: C.ink3 }}>{index + 1}</span>
                <span><RoleChip role={roleKey(record.visitType)} /></span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2 }}>{record.source === 'fault' ? 'Arıza / Karma Gün' : 'Form / Karma Gün'}</span>
                <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.ink1 }}>{formatDateTime(record.date)}</span>
              </div>
            ))}
            {!selectedVisitDetail?.records.length && (
              <div style={{ textAlign: 'center', padding: '28px 0', fontSize: 13.5, fontWeight: 600, color: C.ink3 }}>
                Detay kayıt bulunamadı.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </ClayPage>
  );
}
