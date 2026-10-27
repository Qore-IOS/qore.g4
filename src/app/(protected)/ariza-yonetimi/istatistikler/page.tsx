
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, orderBy, query, Timestamp, getDocs, limit } from '../../../../lib/data/client';
import { db } from '../../../../lib/data/client';
import type { Device, Hospital, ProductCode } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { differenceInMinutes, subMonths, format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/document-helpers';
import { useDateRangeFilter } from '@/hooks/useDateRangeFilter';
import { DateRangeFilterBar } from '@/components/common/DateRangeFilterBar';
import { filterByCompanyScope } from '@/lib/company-scope';
import { classifyStopFault, type StopFaultType } from '@/lib/stop-fault';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Building, ChevronsUpDown, Check as CheckIcon } from 'lucide-react';
import {
  ClayPage,
  PageHead,
  Card,
  CardHead,
  KpiTile,
  Pill,
  Segmented,
  GhostBtn,
  HBar,
  Donut,
  LineChart,
  Legend,
  StatNum,
  ClayLoader,
  C,
  AC,
  PAL,
  useMode,
  fmtInt,
} from '@/components/cihaz-yonetimi/clay-kit';

// Fault definition type
interface FaultDefinition {
  id: string;
  name: string;
  type: 'teknik_servis' | 'aplikasyon';
}

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

export default function ArizaIstatistikleriPage() {
  const router = useRouter();
  const mode = useMode();
  const mobile = mode === 'mobile';
  const gap = mobile ? 12 : 16;

  const [reports, setReports] = useState<any[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [faultDefinitions, setFaultDefinitions] = useState<FaultDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { isAdmin, currentCompanyId, isSuperAdmin } = useAuth();

  // Arıza istatistik penceresi — varsayılan son 365 gün (yıllık trend için).
  const dateFilter = useDateRangeFilter({
    defaultDays: 365,
    storageKey: 'ariza-istatistik:range',
  });

  const [selectedLabId, setSelectedLabId] = useState<string>('all');
  const [isLabPopoverOpen, setIsLabPopoverOpen] = useState(false);

  // Global fault type filter
  const [selectedFaultType, setSelectedFaultType] = useState<'all' | 'teknik_servis' | 'aplikasyon'>('all');

  // Product statistics state
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [selectedProductGroup, setSelectedProductGroup] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);
  const [isBrandPopoverOpen, setIsBrandPopoverOpen] = useState(false);
  const [isGroupPopoverOpen, setIsGroupPopoverOpen] = useState(false);
  const [expandedLabs, setExpandedLabs] = useState<Set<string>>(new Set());
  const [selectedStopType, setSelectedStopType] = useState<StopFaultType>('e_stop');
  const [selectedStopLabId, setSelectedStopLabId] = useState<string | null>(null);
  const [hospitalMinMaxRules, setHospitalMinMaxRules] = useState<Map<string, Set<string>>>(new Map());

  const TARGET_RESOLUTION_TIME = 480; // 8 hours in minutes

  useEffect(() => {
    // Tarih penceresi + hard cap — yoksa firma 5 yıllık veriyi tek seferde indirir.
    const reportsQuery = scopedQuery(
      'deviceFaultReports',
      currentCompanyId,
      isSuperAdmin,
      ...dateFilter.constraints('openedAt'),
      orderBy('openedAt', 'desc'),
      limit(5000),
    );
    const devicesQuery = scopedQuery('devices', currentCompanyId, isSuperAdmin);
    const hospitalsQuery = scopedQuery('hospitals', currentCompanyId, isSuperAdmin, orderBy('name', 'asc'));

    const unsubReports = onSnapshot(reportsQuery,
        (snapshot) => {
            const reportList: any[] = snapshot.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id, ...data,
                    openedAt: data.openedAt ? (data.openedAt as Timestamp).toDate() : null,
                    closedAt: data.closedAt ? (data.closedAt as Timestamp).toDate() : null,
                };
            });
            setReports(filterByCompanyScope(reportList, currentCompanyId, isSuperAdmin));
        },
        (error) => {
            console.error('Error fetching fault reports:', error);
            toast({ title: 'Hata', description: 'Arıza raporları yüklenemedi.', variant: 'destructive' });
        }
    );

    const unsubDevices = onSnapshot(devicesQuery,
        (snapshot) => {
            setDevices(filterByCompanyScope(
              snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Device)),
              currentCompanyId,
              isSuperAdmin
            ));
        },
        (error) => {
            console.error('Error fetching devices:', error);
            toast({ title: 'Hata', description: 'Cihaz listesi yüklenemedi.', variant: 'destructive' });
        }
    );

    const unsubHospitals = onSnapshot(hospitalsQuery,
        (snapshot) => {
            setHospitals(filterByCompanyScope(
              snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)),
              currentCompanyId,
              isSuperAdmin
            ));
            setLoading(false);
        },
        (error) => {
            console.error('Error fetching hospitals:', error);
            toast({ title: 'Hata', description: 'Laboratuvar listesi yüklenemedi.', variant: 'destructive' });
            setLoading(false);
        }
    );

    // Fetch product codes
    getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)).then(snapshot => {
      setProductCodes(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
    }).catch(err => {
      console.error('Error fetching product codes:', err);
    });

    // Fetch fault definitions
    getDocs(scopedQuery('faultDefinitions', currentCompanyId, isSuperAdmin)).then(snapshot => {
      setFaultDefinitions(filterByCompanyScope(
        snapshot.docs.map(d => ({ id: d.id, ...d.data() } as FaultDefinition)),
        currentCompanyId,
        isSuperAdmin
      ));
    }).catch(err => {
      console.error('Error fetching fault definitions:', err);
    });

    return () => {
        unsubReports();
        unsubDevices();
        unsubHospitals();
    };
  }, [toast, currentCompanyId, isSuperAdmin, dateFilter.range]);

  // Fetch minMaxRules for all hospitals
  useEffect(() => {
    if (hospitals.length === 0) return;

    const fetchMinMaxRules = async () => {
      const rulesMap = new Map<string, Set<string>>();

      for (const hospital of hospitals) {
        try {
          const minMaxSnap = await getDocs(collection(db, 'hospitals', hospital.id, 'minMaxRules'));
          const stokKodulari = new Set(minMaxSnap.docs.map(d => d.id));
          rulesMap.set(hospital.id, stokKodulari);
        } catch (err) {
          console.error(`Error fetching minMaxRules for hospital ${hospital.id}:`, err);
        }
      }

      setHospitalMinMaxRules(rulesMap);
    };

    fetchMinMaxRules();
  }, [hospitals]);

  const filteredReports = useMemo(() => {
      let filtered = reports;
      if (selectedLabId !== 'all') {
          filtered = filtered.filter(report => report.hospitalId === selectedLabId);
      }
      if (selectedFaultType !== 'all') {
          filtered = filtered.filter(report => report.faultType === selectedFaultType);
      }
      return filtered;
  }, [reports, selectedLabId, selectedFaultType]);

  // Main statistics
  const stats = useMemo(() => {
    // NOTE: fault *record* counts (totalFaults, openFaults, closedFaults,
    // teknik/aplikasyon/kurum/telefon, faultsExceedingTarget) treat each
    // fault report as a single occurrence — matching the Arıza Yönetimi
    // page. The per-device impact multiplier is reserved for device-level
    // analytics (topDevices below) where attributing group faults to each
    // affected device is meaningful.
    const getImpactCount = (report: any) => {
      if (report?.affectsAllDevices && Array.isArray(report?.affectedDeviceIds)) {
        return Math.max(1, report.affectedDeviceIds.filter(Boolean).length);
      }
      return 1;
    };

    if (filteredReports.length === 0) {
      return {
        topDevices: [],
        avgResolutionTime: 0,
        openFaults: 0,
        closedFaults: 0,
        totalFaults: 0,
        faultsExceedingTarget: 0,
        teknikCount: 0,
        aplikasyonCount: 0,
        kurumCount: 0,
        telefonCount: 0,
      };
    }

    const faultCounts = filteredReports.reduce((acc, report) => {
      if (report?.affectsAllDevices && Array.isArray(report?.affectedDeviceIds)) {
        report.affectedDeviceIds.filter(Boolean).forEach((id: string) => {
          acc[id] = (acc[id] || 0) + 1;
        });
        return acc;
      }
      if (report.deviceId) acc[report.deviceId] = (acc[report.deviceId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topDevices = Object.entries(faultCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([deviceId, count]) => {
        const device = devices.find(d => d.id === deviceId);
        return {
          id: deviceId,
          name: device?.cihazAdi || device?.model || 'Bilinmeyen Cihaz',
          lab: hospitals.find(h => h.id === device?.hospitalId)?.name || 'Bilinmeyen Lab.',
          count,
        };
      });

    const closedReports = filteredReports.filter(r => (r.status === 'closed' || r.status === 'cozuldu') && r.openedAt && r.closedAt);
    const totalResolutionTime = closedReports.reduce((sum, r) => {
        return sum + differenceInMinutes(r.closedAt!, r.openedAt!);
    }, 0);
    const avgResolutionTime = closedReports.length > 0 ? totalResolutionTime / closedReports.length : 0;

    const openFaults = filteredReports
      .filter(r => r.status !== 'closed' && r.status !== 'cozuldu').length;
    const closedFaults = closedReports.length;

    // Count faults exceeding target time
    const faultsExceedingTarget = closedReports.filter(r => {
      const resolutionTime = differenceInMinutes(r.closedAt!, r.openedAt!);
      return resolutionTime > TARGET_RESOLUTION_TIME;
    }).length;

    // Count by fault type
    const teknikCount = filteredReports.filter(r => r.faultType === 'teknik_servis').length;
    const aplikasyonCount = filteredReports.filter(r => r.faultType === 'aplikasyon').length;

    // Count by intervention type
    const kurumCount = filteredReports.filter(r => r.interventionType === 'kurum_ziyaret').length;
    const telefonCount = filteredReports.filter(r => r.interventionType === 'telefon').length;

    return {
      topDevices,
      avgResolutionTime,
      openFaults,
      closedFaults,
      totalFaults: filteredReports.length,
      faultsExceedingTarget,
      teknikCount,
      aplikasyonCount,
      kurumCount,
      telefonCount,
    };
  }, [filteredReports, devices, hospitals]);

  // Fault type pie chart data
  const faultTypePieData = useMemo(() => {
    if (stats.teknikCount === 0 && stats.aplikasyonCount === 0) return [];
    return [
      { name: 'Teknik Servis', value: stats.teknikCount, color: PAL.tech },
      { name: 'Aplikasyon', value: stats.aplikasyonCount, color: PAL.app },
    ];
  }, [stats.teknikCount, stats.aplikasyonCount]);

  // Intervention type pie chart data
  const interventionTypePieData = useMemo(() => {
    if (stats.kurumCount === 0 && stats.telefonCount === 0) return [];
    return [
      { name: 'Kurum Ziyareti', value: stats.kurumCount, color: PAL.ready },
      { name: 'Telefonla', value: stats.telefonCount, color: PAL.amber },
    ];
  }, [stats.kurumCount, stats.telefonCount]);

  // Fault definitions bar chart data - uses faultName field from fault definitions
  const faultDefinitionsBarData = useMemo(() => {
    const countByFaultName: Record<string, number> = {};
    const getImpactCount = (report: any) =>
      report?.affectsAllDevices && Array.isArray(report?.affectedDeviceIds)
        ? Math.max(1, report.affectedDeviceIds.filter(Boolean).length)
        : 1;

    filteredReports.forEach(r => {
        // Use faultName (from faultDefinitions) instead of title (which includes lab/device info)
        const faultName = r.faultName || 'Belirtilmemiş';
        countByFaultName[faultName] = (countByFaultName[faultName] || 0) + getImpactCount(r);
      });

    return Object.entries(countByFaultName)
      .map(([name, count]) => ({ name: name.length > 25 ? name.substring(0, 25) + '...' : name, fullName: name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [filteredReports, selectedFaultType]);

  // Faults exceeding target time list - uses faultName field from fault definitions
  const faultsExceedingTargetList = useMemo(() => {
    const getImpactCount = (report: any) =>
      report?.affectsAllDevices && Array.isArray(report?.affectedDeviceIds)
        ? Math.max(1, report.affectedDeviceIds.filter(Boolean).length)
        : 1;

    const closedReports = filteredReports.filter(r =>
      (r.status === 'closed' || r.status === 'cozuldu') && r.openedAt && r.closedAt
    );

    const exceeding = closedReports.filter(r => {
      const resolutionTime = differenceInMinutes(r.closedAt!, r.openedAt!);
      return resolutionTime > TARGET_RESOLUTION_TIME;
    });

    // Group by faultName (from faultDefinitions) instead of title (which includes lab/device info)
    const byFaultName: Record<string, { count: number; totalExceed: number }> = {};

    exceeding.forEach(r => {
      // Use faultName (from faultDefinitions) instead of title
      const faultName = r.faultName || 'Belirtilmemiş';
      const resolutionTime = differenceInMinutes(r.closedAt!, r.openedAt!);
      const exceedMinutes = resolutionTime - TARGET_RESOLUTION_TIME;

      if (!byFaultName[faultName]) {
        byFaultName[faultName] = { count: 0, totalExceed: 0 };
      }
      const impactCount = getImpactCount(r);
      byFaultName[faultName].count += impactCount;
      byFaultName[faultName].totalExceed += exceedMinutes * impactCount;
    });

    return Object.entries(byFaultName)
      .map(([title, data]) => ({
        title,
        count: data.count,
        avgExceedMinutes: Math.round(data.totalExceed / data.count),
        avgExceedPercent: Math.round((data.totalExceed / data.count / TARGET_RESOLUTION_TIME) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [filteredReports]);

  const performanceData = useMemo(() => {
    const deviation = ((stats.avgResolutionTime - TARGET_RESOLUTION_TIME) / TARGET_RESOLUTION_TIME) * 100;
    const isOver = deviation > 0;

    let colorClass = 'bg-green-500';
    if (stats.avgResolutionTime > TARGET_RESOLUTION_TIME) {
        colorClass = 'bg-red-500';
    } else if (stats.avgResolutionTime > TARGET_RESOLUTION_TIME * 0.8) {
        colorClass = 'bg-yellow-500';
    }

    return {
        deviation: isNaN(deviation) ? 0 : deviation,
        isOver,
        colorClass
    };
  }, [stats.avgResolutionTime]);

  // Product statistics (keeping existing functionality)
  const uniqueBrands = useMemo(() => {
    const brands = new Set(productCodes.map(p => p.marka).filter(Boolean));
    return Array.from(brands).sort() as string[];
  }, [productCodes]);

  const uniqueProductGroups = useMemo(() => {
    const groups = new Set(productCodes.map(p => p.urunGrubu).filter(Boolean));
    return Array.from(groups).sort() as string[];
  }, [productCodes]);

  const filteredProducts = useMemo(() => {
    return productCodes.filter(p => {
      const matchesBrand = selectedBrand === 'all' || p.marka === selectedBrand;
      const matchesGroup = selectedProductGroup === 'all' || p.urunGrubu === selectedProductGroup;
      return matchesBrand && matchesGroup;
    });
  }, [productCodes, selectedBrand, selectedProductGroup]);

  const selectedProduct = useMemo(() => {
    return productCodes.find(p => p.id === selectedProductId);
  }, [productCodes, selectedProductId]);

  const productLabStats = useMemo(() => {
    if (!selectedProduct) return [];

    const hospitalsWithProduct: string[] = [];
    for (const [hospitalId, stokKodulari] of hospitalMinMaxRules) {
      if (stokKodulari.has(selectedProduct.stokKodu)) {
        hospitalsWithProduct.push(hospitalId);
      }
    }

    const matchingDevices = devices.filter(d =>
      d.hospitalId && hospitalsWithProduct.includes(d.hospitalId)
    );

    const labMap = new Map<string, {
      hospitalId: string;
      hospitalName: string;
      devices: Device[];
      teknikServisFaults: number;
      aplikasyonFaults: number;
      openTeknikServis: number;
      openAplikasyon: number;
      last6MonthsFaults: { month: string; count: number }[];
    }>();

    const sixMonthsAgo = subMonths(new Date(), 6);

    for (const hospitalId of hospitalsWithProduct) {
      const hospital = hospitals.find(h => h.id === hospitalId);
      if (!hospital) continue;

      labMap.set(hospitalId, {
        hospitalId: hospitalId,
        hospitalName: hospital.name || 'Bilinmeyen Lab.',
        devices: [],
        teknikServisFaults: 0,
        aplikasyonFaults: 0,
        openTeknikServis: 0,
        openAplikasyon: 0,
        last6MonthsFaults: [],
      });
    }

    for (const device of matchingDevices) {
      if (!device.hospitalId) continue;

      const labData = labMap.get(device.hospitalId);
      if (!labData) continue;

      labData.devices.push(device);

      const deviceFaults = filteredReports.filter(r => r.deviceId === device.id);

      for (const fault of deviceFaults) {
        if (fault.faultType === 'teknik_servis') {
          labData.teknikServisFaults++;
          if (fault.status !== 'closed' && fault.status !== 'cozuldu') labData.openTeknikServis++;
        } else {
          labData.aplikasyonFaults++;
          if (fault.status !== 'closed' && fault.status !== 'cozuldu') labData.openAplikasyon++;
        }
      }
    }

    if (selectedProduct.testAdi) {
      for (const [hospitalId, labData] of labMap) {
        const testRelatedFaults = filteredReports.filter(r =>
          r.hospitalId === hospitalId &&
          r.relatedTests &&
          r.relatedTests.includes(selectedProduct.testAdi)
        );

        for (const fault of testRelatedFaults) {
          const alreadyCounted = labData.devices.some(d =>
            filteredReports.some(r => r.deviceId === d.id && r.id === fault.id)
          );

          if (!alreadyCounted) {
            if (fault.faultType === 'teknik_servis') {
              labData.teknikServisFaults++;
              if (fault.status !== 'closed' && fault.status !== 'cozuldu') labData.openTeknikServis++;
            } else {
              labData.aplikasyonFaults++;
              if (fault.status !== 'closed' && fault.status !== 'cozuldu') labData.openAplikasyon++;
            }
          }
        }
      }
    }

    for (const [hospitalId, labData] of labMap) {
      const deviceIds = labData.devices.map(d => d.id);

      const labFaults = filteredReports.filter(r =>
        r.openedAt &&
        r.openedAt >= sixMonthsAgo &&
        (
          deviceIds.includes(r.deviceId) ||
          (r.hospitalId === hospitalId && selectedProduct.testAdi && r.relatedTests?.includes(selectedProduct.testAdi))
        )
      );

      const monthCounts = new Map<string, number>();
      for (let i = 5; i >= 0; i--) {
        const monthDate = subMonths(new Date(), i);
        const monthKey = format(monthDate, 'yyyy-MM');
        monthCounts.set(monthKey, 0);
      }

      for (const fault of labFaults) {
        if (fault.openedAt) {
          const monthKey = format(fault.openedAt, 'yyyy-MM');
          if (monthCounts.has(monthKey)) {
            monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
          }
        }
      }

      labData.last6MonthsFaults = Array.from(monthCounts.entries()).map(([month, count]) => ({
        month: format(new Date(month + '-01'), 'MMM yy', { locale: tr }),
        count,
      }));
    }

    return Array.from(labMap.values()).sort((a, b) =>
      (b.teknikServisFaults + b.aplikasyonFaults) - (a.teknikServisFaults + a.aplikasyonFaults)
    );
  }, [selectedProduct, devices, hospitals, filteredReports, hospitalMinMaxRules]);

  const toggleLabExpand = (hospitalId: string) => {
    setExpandedLabs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(hospitalId)) {
        newSet.delete(hospitalId);
      } else {
        newSet.add(hospitalId);
      }
      return newSet;
    });
  };

  const stopStats = useMemo(() => {
    const stopReports = filteredReports
      .map((report) => ({ report, type: classifyStopFault(report) }))
      .filter((row): row is { report: any; type: StopFaultType } => !!row.type);

    const counts = {
      e_stop: 0,
      s_stop: 0,
      normal_stop: 0,
    } as Record<StopFaultType, number>;

    const labMap: Record<StopFaultType, Map<string, { labId: string; labName: string; count: number }>> = {
      e_stop: new Map(),
      s_stop: new Map(),
      normal_stop: new Map(),
    };

    const deviceMap: Record<StopFaultType, Map<string, Map<string, { deviceId: string; model: string; count: number }>>> = {
      e_stop: new Map(),
      s_stop: new Map(),
      normal_stop: new Map(),
    };

    stopReports.forEach(({ report, type }) => {
      counts[type] += 1;
      const labId = report.hospitalId || 'unknown';
      const labName = hospitals.find(h => h.id === labId)?.name || report.labName || 'Bilinmeyen Laboratuvar';
      const existingLab = labMap[type].get(labId);
      labMap[type].set(labId, {
        labId,
        labName,
        count: (existingLab?.count || 0) + 1,
      });

      const byLab = deviceMap[type].get(labId) || new Map();
      const deviceId = report.deviceId || 'unknown-device';
      const deviceName = report.model || devices.find(d => d.id === deviceId)?.cihazAdi || devices.find(d => d.id === deviceId)?.model || 'Bilinmeyen Cihaz';
      const existingDevice = byLab.get(deviceId);
      byLab.set(deviceId, {
        deviceId,
        model: deviceName,
        count: (existingDevice?.count || 0) + 1,
      });
      deviceMap[type].set(labId, byLab);
    });

    return {
      counts,
      labsByType: {
        e_stop: Array.from(labMap.e_stop.values()).sort((a, b) => b.count - a.count),
        s_stop: Array.from(labMap.s_stop.values()).sort((a, b) => b.count - a.count),
        normal_stop: Array.from(labMap.normal_stop.values()).sort((a, b) => b.count - a.count),
      } as Record<StopFaultType, { labId: string; labName: string; count: number }[]>,
      devicesByTypeAndLab: deviceMap,
    };
  }, [filteredReports, hospitals, devices]);

  // ── derived presentation values ──────────────────────────────────────────────
  const selectedLabName = selectedLabId === 'all'
    ? 'Tüm Laboratuvarlar'
    : hospitals.find((lab) => lab.id === selectedLabId)?.name || 'Laboratuvar Seç…';

  const headSub = `${format(dateFilter.range.from, 'd MMM yyyy', { locale: tr })} – ${format(dateFilter.range.to, 'd MMM yyyy', { locale: tr })} · ${selectedLabName}`;

  const avgFillPct = Math.min(100, (stats.avgResolutionTime / (TARGET_RESOLUTION_TIME * 1.5)) * 100);
  const avgBarColor = stats.avgResolutionTime > TARGET_RESOLUTION_TIME
    ? C.danger
    : stats.avgResolutionTime > TARGET_RESOLUTION_TIME * 0.8
      ? C.amber
      : C.waterDeep;

  const stopTotal = stopStats.counts.e_stop + stopStats.counts.s_stop + stopStats.counts.normal_stop;
  const stopMaxKey = (['e_stop', 's_stop', 'normal_stop'] as StopFaultType[])
    .reduce((m, k) => (stopStats.counts[k] > stopStats.counts[m] ? k : m), 'e_stop' as StopFaultType);

  const interventionTotal = stats.kurumCount + stats.telefonCount;
  const kurumPct = interventionTotal > 0 ? Math.round((stats.kurumCount / interventionTotal) * 100) : 0;

  if (loading) {
    return (
      <ClayPage>
        <ClayLoader label="İstatistikler yükleniyor…" />
      </ClayPage>
    );
  }

  const STOP_LABELS: { key: StopFaultType; label: string }[] = [
    { key: 'e_stop', label: 'E Stop' },
    { key: 's_stop', label: 'S Stop' },
    { key: 'normal_stop', label: 'Normal Stop' },
  ];

  return (
    <ClayPage>
      <PageHead
        ico="alert"
        title="Arıza İstatistikleri"
        sub={headSub}
        onBack={() => router.push('/ariza-yonetimi')}
        mobile={mobile}
        right={
          <Segmented
            value={selectedFaultType}
            onChange={(v) => setSelectedFaultType(v)}
            options={[
              { v: 'all', l: 'Tümü' },
              { v: 'teknik_servis', l: 'Teknik' },
              { v: 'aplikasyon', l: 'Aplikasyon' },
            ]}
          />
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap }}>
        {/* Filters: date range + lab selector */}
        <Card pad={mobile ? 14 : 16}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <DateRangeFilterBar
                range={dateFilter.range}
                setRange={dateFilter.setRange}
                label="İstatistik penceresi"
              />
            </div>
            <Popover open={isLabPopoverOpen} onOpenChange={setIsLabPopoverOpen}>
              <PopoverTrigger asChild>
                <span>
                  <GhostBtn onClick={() => setIsLabPopoverOpen((o) => !o)} active={selectedLabId !== 'all'}>
                    <Building size={16} />
                    <span style={{ maxWidth: mobile ? 150 : 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedLabName}</span>
                    <ChevronsUpDown size={15} style={{ opacity: 0.5 }} />
                  </GhostBtn>
                </span>
              </PopoverTrigger>
              <PopoverContent className="w-[260px] p-0" align="end">
                <Command>
                  <CommandInput placeholder="Laboratuvar ara…" />
                  <CommandList>
                    <CommandEmpty>Laboratuvar bulunamadı.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        key="all"
                        value="all"
                        onSelect={() => { setSelectedLabId('all'); setIsLabPopoverOpen(false); }}
                      >
                        <CheckIcon className="mr-2 h-4 w-4" style={{ opacity: selectedLabId === 'all' ? 1 : 0 }} />
                        Tüm Laboratuvarlar
                      </CommandItem>
                      {hospitals.map((lab) => (
                        <CommandItem
                          key={lab.id}
                          value={lab.name}
                          onSelect={() => { setSelectedLabId(lab.id ?? 'all'); setIsLabPopoverOpen(false); }}
                        >
                          <CheckIcon className="mr-2 h-4 w-4" style={{ opacity: selectedLabId === lab.id ? 1 : 0 }} />
                          {lab.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </Card>

        {/* KPI Row */}
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(3,1fr)', gap }}>
          <KpiTile
            ico="shield"
            label="Toplam Arıza Sayısı"
            value={stats.totalFaults}
            unit="arıza"
            foot={
              <>
                <span style={{ color: '#9A6F1E' }}>{fmtInt(stats.openFaults)} açık</span>
                <span style={{ color: C.ink3 }}>·</span>
                <span style={{ color: C.waterDeep }}>{fmtInt(stats.closedFaults)} çözüldü</span>
              </>
            }
          />

          {/* Average resolution time — danger card with progress bar */}
          <Card tone="danger" pad={16} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Ortalama Çözüm Süresi</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink3, marginTop: 2 }}>Hedef: {TARGET_RESOLUTION_TIME} dakika</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <StatNum value={Math.round(stats.avgResolutionTime)} size={30} color={C.danger} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.ink3 }}>dakika</span>
            </div>
            <div style={{ height: 9, borderRadius: 99, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${avgFillPct}%`, borderRadius: 99, background: `linear-gradient(90deg, ${avgBarColor}cc, ${avgBarColor})`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)', transition: `width 500ms ${EASE}` }} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: performanceData.isOver ? C.danger : C.waterDeep }}>
              {performanceData.isOver
                ? `Hedefin %${performanceData.deviation.toFixed(1)} üzerinde`
                : `Hedefin %${Math.abs(performanceData.deviation).toFixed(1)} altında`}
            </div>
          </Card>

          <KpiTile
            ico="clock"
            label="Hedef Süreyi Aşan"
            value={stats.faultsExceedingTarget}
            unit="arıza"
            tone="danger"
            foot={
              <span>
                {stats.closedFaults > 0
                  ? `Çözülen arızaların %${((stats.faultsExceedingTarget / stats.closedFaults) * 100).toFixed(1)}'i`
                  : 'Henüz çözülen arıza yok'}
              </span>
            }
          />
        </div>

        {/* Stop stats + Intervention type donut */}
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0,1.4fr) minmax(0,1fr)', gap }}>
          {/* Stop fault statistics */}
          <Card tone="amber">
            <CardHead ico="alert" title="Stop Arızası İstatistikleri" sub="E Stop, S Stop ve Normal Stop kayıtları" tone="amber" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
              {STOP_LABELS.map((item) => {
                const active = selectedStopType === item.key;
                const highlight = item.key === stopMaxKey && stopStats.counts[item.key] > 0;
                const cnt = stopStats.counts[item.key];
                const pct = stopTotal > 0 ? Math.max(2, (cnt / stopTotal) * 100) : 2;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => { setSelectedStopType(item.key); setSelectedStopLabId(null); }}
                    style={{
                      all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'block', padding: '11px 14px',
                      borderRadius: C.radius,
                      background: active ? C.surfaceHi : 'transparent',
                      boxShadow: active ? C.clayInset : 'none',
                      transition: `all 180ms ${EASE}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: highlight ? '#9A6F1E' : C.ink1 }}>{item.label}</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: highlight ? '#9A6F1E' : C.ink1, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(cnt)}</span>
                    </div>
                    <div style={{ height: 14, borderRadius: 99, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: highlight ? `linear-gradient(90deg, ${C.amberA27}, ${C.amber})` : `linear-gradient(90deg, ${C.ink3A40}, ${C.ink3})`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)' }} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Lab + device distribution for the selected stop type */}
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 10, marginTop: 14 }}>
              <div style={{ borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayInset, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>Laboratuvar Dağılımı</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                  {stopStats.labsByType[selectedStopType].length === 0 && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.ink3 }}>Bu tipte kayıt yok.</span>
                  )}
                  {stopStats.labsByType[selectedStopType].map((lab) => {
                    const on = selectedStopLabId === lab.labId;
                    return (
                      <button
                        key={lab.labId}
                        type="button"
                        onClick={() => setSelectedStopLabId(lab.labId)}
                        style={{
                          all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                          padding: '7px 10px', borderRadius: C.radiusSm,
                          background: on ? C.surface2 : 'transparent',
                          fontSize: 12.5, fontWeight: 700, color: C.ink1,
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lab.labName}</span>
                        <Pill tone="amber">{lab.count}</Pill>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayInset, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>Cihaz Dağılımı</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                  {!selectedStopLabId && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.ink3 }}>Cihaz listesini görmek için soldan laboratuvar seçin.</span>
                  )}
                  {selectedStopLabId && (
                    Array.from(stopStats.devicesByTypeAndLab[selectedStopType].get(selectedStopLabId)?.values() || [])
                      .sort((a, b) => b.count - a.count)
                      .map((device) => (
                        <div key={device.deviceId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', borderRadius: C.radiusSm, fontSize: 12.5, fontWeight: 700, color: C.ink1 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.model}</span>
                          <Pill>{device.count}</Pill>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Intervention type donut */}
          <Card>
            <CardHead ico="pin" title="Müdahale Tipi Dağılımı" />
            {interventionTotal > 0 ? (
              <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', alignItems: 'center', gap: 18, marginTop: 8 }}>
                <Donut
                  size={mobile ? 130 : 150}
                  thickness={26}
                  segments={[
                    { v: stats.kurumCount, color: PAL.ready },
                    { v: stats.telefonCount, color: PAL.amber },
                  ]}
                  center={
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: C.ink1, lineHeight: 1 }}>%{kurumPct}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.ink3, marginTop: 3 }}>kurum</div>
                    </div>
                  }
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                  <Legend color={PAL.ready} label="Kurum Ziyareti" val={fmtInt(stats.kurumCount)} />
                  <Legend color={PAL.amber} label="Telefonla" val={fmtInt(stats.telefonCount)} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', minHeight: 150, color: C.ink3, fontSize: 13, fontWeight: 600 }}>Veri yok</div>
            )}
          </Card>
        </div>

        {/* Fault type donut + Fault definitions HBar */}
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0,1fr) minmax(0,1.5fr)', gap }}>
          <Card>
            <CardHead ico="trend" title="Arıza Tipi Dağılımı" />
            {faultTypePieData.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', alignItems: 'center', gap: 18, marginTop: 8 }}>
                <Donut
                  size={mobile ? 130 : 150}
                  thickness={26}
                  segments={faultTypePieData.map(d => ({ v: d.value, color: d.color }))}
                  center={
                    <div>
                      <StatNum value={stats.teknikCount + stats.aplikasyonCount} size={24} />
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.ink3, marginTop: 3 }}>arıza</div>
                    </div>
                  }
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                  <Legend color={PAL.tech} label="Teknik Servis" val={fmtInt(stats.teknikCount)} />
                  <Legend color={PAL.app} label="Aplikasyon" val={fmtInt(stats.aplikasyonCount)} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', minHeight: 150, color: C.ink3, fontSize: 13, fontWeight: 600 }}>Veri yok</div>
            )}
          </Card>

          <Card>
            <CardHead
              ico={selectedFaultType === 'teknik_servis' ? 'wrench' : selectedFaultType === 'aplikasyon' ? 'flask' : 'chart'}
              tone={selectedFaultType === 'teknik_servis' ? 'tech' : selectedFaultType === 'aplikasyon' ? 'app' : 'default'}
              title={`${selectedFaultType === 'teknik_servis' ? 'Teknik Servis' : selectedFaultType === 'aplikasyon' ? 'Aplikasyon' : 'Tümü'} Arıza Başlıkları`}
              sub="En sık karşılaşılan arıza tanımlamaları"
            />
            <div style={{ marginTop: 14 }}>
              {faultDefinitionsBarData.length > 0 ? (
                <HBar
                  labelW={mobile ? 96 : 200}
                  color={selectedFaultType === 'teknik_servis' ? PAL.tech : selectedFaultType === 'aplikasyon' ? PAL.app : C.accent}
                  items={faultDefinitionsBarData.map(d => ({ label: d.fullName, v: d.count }))}
                />
              ) : (
                <div style={{ display: 'grid', placeItems: 'center', minHeight: 150, color: C.ink3, fontSize: 13, fontWeight: 600 }}>Bu tipte arıza kaydı yok</div>
              )}
            </div>
          </Card>
        </div>

        {/* SLA-over table */}
        <Card tone="danger">
          <CardHead ico="clock" title="Hedef Sürede Çözülemeyen Arızalar" sub="8 saat hedef süresini aşan arıza başlıkları" tone="danger" />
          <div style={{ marginTop: 12 }}>
            {faultsExceedingTargetList.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 520 }}>
                  {/* header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 120px 110px', gap: 10, padding: '8px 14px', borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Arıza Başlığı</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center' }}>Adet</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center' }}>Ort. Aşım</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center' }}>Aşım Oranı</span>
                  </div>
                  {faultsExceedingTargetList.map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'grid', gridTemplateColumns: '1fr 90px 120px 110px', gap: 10, alignItems: 'center',
                        padding: '13px 14px', borderRadius: C.radius,
                        background: i % 2 ? 'transparent' : C.surfaceHi,
                        animation: `cyPopIn 420ms ${EASE} ${i * 45}ms both`,
                      }}
                    >
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</span>
                      <span style={{ textAlign: 'center' }}><Pill tone="danger">{item.count}</Pill></span>
                      <span style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>+{item.avgExceedMinutes} dk</span>
                      <span style={{ textAlign: 'center', fontSize: 13.5, fontWeight: 800, color: C.danger, fontVariantNumeric: 'tabular-nums' }}>+%{item.avgExceedPercent}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 120, color: C.waterDeep, fontSize: 13.5, fontWeight: 700 }}>
                Tüm arızalar hedef sürede çözülmüş
              </div>
            )}
          </div>
        </Card>

        {/* Top fault devices */}
        <Card>
          <CardHead ico="server" title="En Çok Arıza Veren 5 Cihaz" />
          {stats.topDevices.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 10, marginTop: 12 }}>
              {stats.topDevices.map((d, i) => (
                <div
                  key={d.id}
                  style={{
                    borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayInset,
                    padding: '16px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center',
                    animation: `cyPopIn 420ms ${EASE} ${i * 60}ms both`,
                  }}
                >
                  <StatNum value={d.count as number} size={30} color={C.danger} />
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink1, lineHeight: 1.25 }}>{d.name}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{d.lab}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: C.ink3, fontSize: 13.5, fontWeight: 600, padding: '20px 0' }}>Henüz arıza kaydı yok</div>
          )}
        </Card>

        {/* Product statistics */}
        <Card>
          <CardHead ico="package" title="Ürün İstatistikleri" sub="Marka ve ürün grubu seçerek ilgili ürünlerin laboratuvarlardaki arıza istatistiklerini görüntüleyin." />

          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(3,1fr)', gap: 12, marginTop: 14 }}>
            {/* Brand */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Marka</label>
              <Popover open={isBrandPopoverOpen} onOpenChange={setIsBrandPopoverOpen}>
                <PopoverTrigger asChild>
                  <span style={{ display: 'block' }}>
                    <GhostBtn onClick={() => setIsBrandPopoverOpen((o) => !o)} active={selectedBrand !== 'all'}>
                      <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedBrand === 'all' ? 'Tümü' : selectedBrand}</span>
                      <ChevronsUpDown size={15} style={{ opacity: 0.5 }} />
                    </GhostBtn>
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Marka ara…" />
                    <CommandList>
                      <CommandEmpty>Marka bulunamadı.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="all" onSelect={() => { setSelectedBrand('all'); setSelectedProductId(''); setIsBrandPopoverOpen(false); }}>
                          <CheckIcon className="mr-2 h-4 w-4" style={{ opacity: selectedBrand === 'all' ? 1 : 0 }} />Tümü
                        </CommandItem>
                        {uniqueBrands.map(brand => (
                          <CommandItem key={brand} value={brand} onSelect={() => { setSelectedBrand(brand); setSelectedProductId(''); setIsBrandPopoverOpen(false); }}>
                            <CheckIcon className="mr-2 h-4 w-4" style={{ opacity: selectedBrand === brand ? 1 : 0 }} />{brand}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Product Group */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Ürün Grubu</label>
              <Popover open={isGroupPopoverOpen} onOpenChange={setIsGroupPopoverOpen}>
                <PopoverTrigger asChild>
                  <span style={{ display: 'block' }}>
                    <GhostBtn onClick={() => setIsGroupPopoverOpen((o) => !o)} active={selectedProductGroup !== 'all'}>
                      <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedProductGroup === 'all' ? 'Tümü' : selectedProductGroup}</span>
                      <ChevronsUpDown size={15} style={{ opacity: 0.5 }} />
                    </GhostBtn>
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Ürün grubu ara…" />
                    <CommandList>
                      <CommandEmpty>Ürün grubu bulunamadı.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="all" onSelect={() => { setSelectedProductGroup('all'); setSelectedProductId(''); setIsGroupPopoverOpen(false); }}>
                          <CheckIcon className="mr-2 h-4 w-4" style={{ opacity: selectedProductGroup === 'all' ? 1 : 0 }} />Tümü
                        </CommandItem>
                        {uniqueProductGroups.map(group => (
                          <CommandItem key={group} value={group} onSelect={() => { setSelectedProductGroup(group); setSelectedProductId(''); setIsGroupPopoverOpen(false); }}>
                            <CheckIcon className="mr-2 h-4 w-4" style={{ opacity: selectedProductGroup === group ? 1 : 0 }} />{group}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Product */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Ürün</label>
              <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                <PopoverTrigger asChild>
                  <span style={{ display: 'block', opacity: filteredProducts.length === 0 ? 0.5 : 1, pointerEvents: filteredProducts.length === 0 ? 'none' : 'auto' }}>
                    <GhostBtn onClick={() => setIsProductPopoverOpen((o) => !o)} active={!!selectedProduct}>
                      <span style={{ maxWidth: mobile ? 200 : 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedProduct ? `${selectedProduct.stokKodu}` : 'Ürün seçin…'}
                      </span>
                      <ChevronsUpDown size={15} style={{ opacity: 0.5 }} />
                    </GhostBtn>
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0" align="end">
                  <Command>
                    <CommandInput placeholder="Ürün kodu veya adı ara…" />
                    <CommandList>
                      <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                      <CommandGroup>
                        {filteredProducts.slice(0, 50).map(product => (
                          <CommandItem
                            key={product.id}
                            value={`${product.stokKodu} ${product.stokAdi}`}
                            onSelect={() => { setSelectedProductId(product.id); setIsProductPopoverOpen(false); }}
                          >
                            <CheckIcon className="mr-2 h-4 w-4" style={{ opacity: selectedProductId === product.id ? 1 : 0 }} />
                            <div className="flex flex-col">
                              <span className="font-medium">{product.stokKodu}</span>
                              <span className="text-sm text-muted-foreground truncate">{product.stokAdi}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Product lab statistics */}
          {selectedProduct && (
            <div style={{ marginTop: 18 }}>
              <div style={{ borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayInset, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.ink1 }}>{selectedProduct.stokAdi}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink3, fontFamily: 'monospace', marginTop: 2 }}>{selectedProduct.stokKodu}</div>
                {selectedProduct.testAdi && (
                  <div style={{ marginTop: 8 }}><Pill tone="tech">Test: {String(selectedProduct.testAdi)}</Pill></div>
                )}
              </div>

              {productLabStats.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: C.ink3 }}>
                  <Building style={{ margin: '0 auto 12px', opacity: 0.3 }} className="h-12 w-12" />
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Bu ürünü kullanan laboratuvar bulunamadı.</div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ minWidth: 560 }}>
                    {/* header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 1fr 1fr 90px 44px', gap: 10, padding: '8px 14px', borderBottom: `1px solid ${C.line}` }}>
                      {['Laboratuvar', 'Cihaz', 'Teknik Servis', 'Aplikasyon', 'Toplam', ''].map((h, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: i === 0 ? 'left' : 'center' }}>{h}</span>
                      ))}
                    </div>
                    {productLabStats.map((lab, i) => {
                      const open = expandedLabs.has(lab.hospitalId);
                      const total = lab.teknikServisFaults + lab.aplikasyonFaults;
                      return (
                        <div key={lab.hospitalId} style={{ animation: `cyPopIn 420ms ${EASE} ${i * 45}ms both` }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 1fr 1fr 90px 44px', gap: 10, alignItems: 'center', padding: '13px 14px', borderRadius: C.radius, background: i % 2 ? 'transparent' : C.surfaceHi }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <Building className="h-4 w-4" style={{ color: C.ink3, flexShrink: 0 }} />
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lab.hospitalName}</span>
                            </div>
                            <span style={{ textAlign: 'center', fontSize: 13.5, fontWeight: 700, color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>{lab.devices.length}</span>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: PAL.tech, fontVariantNumeric: 'tabular-nums' }}>{lab.teknikServisFaults}</span>
                              {lab.openTeknikServis > 0 && <Pill tone="danger">{lab.openTeknikServis} açık</Pill>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: PAL.app, fontVariantNumeric: 'tabular-nums' }}>{lab.aplikasyonFaults}</span>
                              {lab.openAplikasyon > 0 && <Pill tone="danger">{lab.openAplikasyon} açık</Pill>}
                            </div>
                            <span style={{ textAlign: 'center', fontSize: 14, fontWeight: 800, color: C.ink1, fontVariantNumeric: 'tabular-nums' }}>{total}</span>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <button
                                type="button"
                                onClick={() => toggleLabExpand(lab.hospitalId)}
                                style={{ all: 'unset', cursor: 'pointer', width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', color: C.ink2, background: C.surface2, boxShadow: C.clayInset }}
                              >
                                <span style={{ display: 'inline-block', transition: `transform 200ms ${EASE}`, transform: open ? 'rotate(180deg)' : 'none', fontSize: 11 }}>▾</span>
                              </button>
                            </div>
                          </div>

                          {open && (
                            <div style={{ padding: '14px', borderRadius: C.radius, background: C.surface2, boxShadow: C.clayInset, margin: '4px 0 10px', animation: `cyFadeIn 280ms ${EASE} both` }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: C.ink2, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>Son 6 Ay Arıza Geçmişi</div>
                              <LineChart
                                data={lab.last6MonthsFaults.map(m => m.count)}
                                labels={lab.last6MonthsFaults.map(m => m.month)}
                                height={140}
                                yTicks
                              />
                              <div style={{ marginTop: 14 }}>
                                <div style={{ fontSize: 12, fontWeight: 800, color: C.ink2, marginBottom: 8 }}>Cihazlar</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                                  {lab.devices.map(device => (
                                    <Pill key={device.id}>
                                      {device.cihazAdi || device.model}{device.seriNumarasi ? ` (${device.seriNumarasi})` : ''}
                                    </Pill>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </ClayPage>
  );
}
