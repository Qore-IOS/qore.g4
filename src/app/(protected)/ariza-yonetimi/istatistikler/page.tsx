
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, orderBy, query, Timestamp, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { companyQuery, safeOnSnapshot, safeGetDocs } from '@/lib/company-filter';
import type { Device, Hospital, ProductCode } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, CheckCircle, Server, Clock, ShieldCheck, RotateCcw, Building, ChevronsUpDown, Check as CheckIcon, Calendar, Package, ChevronDown, ChevronUp, Wrench, FlaskConical, Phone, MapPin, Timer, TrendingUp, Layers } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { differenceInMinutes, startOfDay, endOfDay, subMonths, format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

// Fault definition type
interface FaultDefinition {
  id: string;
  name: string;
  type: 'teknik_servis' | 'aplikasyon';
}

// Chart colors
const COLORS = {
  teknik: '#3b82f6', // blue
  aplikasyon: '#a855f7', // purple
  kurum: '#22c55e', // green
  telefon: '#f59e0b', // amber
};

const PIE_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#8b5cf6'];

export default function ArizaIstatistikleriPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [faultDefinitions, setFaultDefinitions] = useState<FaultDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { isAdmin, currentCompanyId } = useAuth();

  const [selectedLabId, setSelectedLabId] = useState<string>('all');
  const [isLabPopoverOpen, setIsLabPopoverOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Global fault type filter
  const [selectedFaultType, setSelectedFaultType] = useState<'all' | 'teknik_servis' | 'aplikasyon'>('all');

  // Product statistics state
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [selectedProductGroup, setSelectedProductGroup] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);
  const [expandedLabs, setExpandedLabs] = useState<Set<string>>(new Set());
  const [hospitalMinMaxRules, setHospitalMinMaxRules] = useState<Map<string, Set<string>>>(new Map());

  const TARGET_RESOLUTION_TIME = 480; // 8 hours in minutes

  useEffect(() => {
    const unsubReports = safeOnSnapshot(
        companyQuery(db, 'deviceFaultReports', currentCompanyId, orderBy('openedAt', 'desc')),
        (snapshot) => {
            const reportList: any[] = snapshot.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id, ...data,
                    openedAt: data.openedAt ? (data.openedAt as Timestamp).toDate() : null,
                    closedAt: data.closedAt ? (data.closedAt as Timestamp).toDate() : null,
                };
            });
            setReports(reportList);
        },
        (error) => {
            console.error('Error fetching fault reports:', error);
            toast({ title: 'Hata', description: 'Arıza raporları yüklenemedi.', variant: 'destructive' });
        }
    );

    const unsubDevices = safeOnSnapshot(
        companyQuery(db, 'devices', currentCompanyId),
        (snapshot) => {
            setDevices(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Device)));
        },
        (error) => {
            console.error('Error fetching devices:', error);
            toast({ title: 'Hata', description: 'Cihaz listesi yüklenemedi.', variant: 'destructive' });
        }
    );

    const unsubHospitals = safeOnSnapshot(
        companyQuery(db, 'hospitals', currentCompanyId, orderBy('name', 'asc')),
        (snapshot) => {
            setHospitals(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
            setLoading(false);
        },
        (error) => {
            console.error('Error fetching hospitals:', error);
            toast({ title: 'Hata', description: 'Laboratuvar listesi yüklenemedi.', variant: 'destructive' });
            setLoading(false);
        }
    );

    // Fetch product codes
    getDocs(collection(db, 'productCodes')).then(snapshot => {
      setProductCodes(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
    }).catch(err => {
      console.error('Error fetching product codes:', err);
    });

    // Fetch fault definitions (company filtered)
    safeGetDocs(companyQuery(db, 'faultDefinitions', currentCompanyId)).then(snapshot => {
      setFaultDefinitions(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as FaultDefinition)));
    }).catch(err => {
      console.error('Error fetching fault definitions:', err);
    });

    return () => {
        unsubReports();
        unsubDevices();
        unsubHospitals();
    };
  }, [toast, currentCompanyId]);

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
      if (dateRange?.from) {
          const from = startOfDay(dateRange.from);
          filtered = filtered.filter(report => report.openedAt && report.openedAt >= from);
      }
      if (dateRange?.to) {
          const to = endOfDay(dateRange.to);
          filtered = filtered.filter(report => report.openedAt && report.openedAt <= to);
      }
      if (selectedFaultType !== 'all') {
          filtered = filtered.filter(report => report.faultType === selectedFaultType);
      }
      return filtered;
  }, [reports, selectedLabId, dateRange, selectedFaultType]);

  // Main statistics
  const stats = useMemo(() => {
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
      if (report.deviceId) {
        acc[report.deviceId] = (acc[report.deviceId] || 0) + 1;
      }
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

    const openFaults = filteredReports.filter(r => r.status !== 'closed' && r.status !== 'cozuldu').length;
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
      { name: 'Teknik Servis', value: stats.teknikCount, color: COLORS.teknik },
      { name: 'Aplikasyon', value: stats.aplikasyonCount, color: COLORS.aplikasyon },
    ];
  }, [stats.teknikCount, stats.aplikasyonCount]);

  // Intervention type pie chart data
  const interventionTypePieData = useMemo(() => {
    if (stats.kurumCount === 0 && stats.telefonCount === 0) return [];
    return [
      { name: 'Kurum Ziyareti', value: stats.kurumCount, color: COLORS.kurum },
      { name: 'Telefonla', value: stats.telefonCount, color: COLORS.telefon },
    ];
  }, [stats.kurumCount, stats.telefonCount]);

  // Fault definitions bar chart data - uses faultName field from fault definitions
  const faultDefinitionsBarData = useMemo(() => {
    const countByFaultName: Record<string, number> = {};

    filteredReports.forEach(r => {
        // Use faultName (from faultDefinitions) instead of title (which includes lab/device info)
        const faultName = r.faultName || 'Belirtilmemiş';
        countByFaultName[faultName] = (countByFaultName[faultName] || 0) + 1;
      });

    return Object.entries(countByFaultName)
      .map(([name, count]) => ({ name: name.length > 25 ? name.substring(0, 25) + '...' : name, fullName: name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [filteredReports, selectedFaultType]);

  // Faults exceeding target time list - uses faultName field from fault definitions
  const faultsExceedingTargetList = useMemo(() => {
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
      byFaultName[faultName].count++;
      byFaultName[faultName].totalExceed += exceedMinutes;
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

  // Custom tooltip for bar chart
  const CustomBarTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-sm">{payload[0].payload.fullName}</p>
          <p className="text-sm text-muted-foreground">{payload[0].value} arıza</p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">İstatistikler yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="device-module-page p-4 space-y-6">
      {/* Header with filters */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <BackButton fallback="/cihaz-yonetimi-ana" />
        <div className="flex items-center gap-2 flex-wrap">
          <Popover open={isLabPopoverOpen} onOpenChange={setIsLabPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={isLabPopoverOpen}
                className="w-[250px] justify-between"
              >
                {selectedLabId === 'all'
                  ? 'Tüm Laboratuvarlar'
                  : hospitals.find((lab) => lab.id === selectedLabId)?.name || 'Laboratuvar Seç...'}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[250px] p-0">
              <Command>
                <CommandInput placeholder="Laboratuvar ara..." />
                <CommandList>
                  <CommandEmpty>Laboratuvar bulunamadı.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      key="all"
                      value="all"
                      onSelect={() => {
                        setSelectedLabId('all');
                        setIsLabPopoverOpen(false);
                      }}
                    >
                      <CheckIcon className={cn("mr-2 h-4 w-4", selectedLabId === 'all' ? "opacity-100" : "opacity-0")} />
                      Tüm Laboratuvarlar
                    </CommandItem>
                    {hospitals.map((lab) => (
                      <CommandItem
                        key={lab.id}
                        value={lab.name}
                        onSelect={() => {
                          setSelectedLabId(lab.id ?? 'all');
                          setIsLabPopoverOpen(false);
                        }}
                      >
                        <CheckIcon className={cn("mr-2 h-4 w-4", selectedLabId === lab.id ? "opacity-100" : "opacity-0")} />
                        {lab.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <DatePickerWithRange date={dateRange} setDate={setDateRange} />
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Faults */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Toplam Arıza Sayısı
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{stats.totalFaults}</div>
            <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                {stats.openFaults} açık
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="h-4 w-4 text-green-500" />
                {stats.closedFaults} çözüldü
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Average Resolution Time */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-5 w-5 text-primary" />
              Ortalama Çözüm Süresi
            </CardTitle>
            <CardDescription>Hedef: {TARGET_RESOLUTION_TIME} dakika</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{stats.avgResolutionTime.toFixed(0)}</div>
            <p className="text-sm text-muted-foreground">dakika</p>
            <div className="relative h-2 w-full bg-muted rounded-full mt-2">
              <div
                className={cn("h-2 rounded-full transition-all duration-500", performanceData.colorClass)}
                style={{ width: `${Math.min(100, (stats.avgResolutionTime / (TARGET_RESOLUTION_TIME * 1.5)) * 100)}%` }}
              />
            </div>
            <p className={cn("text-xs mt-1", performanceData.isOver ? "text-red-500" : "text-green-500")}>
              {performanceData.isOver
                ? `Hedefin %${performanceData.deviation.toFixed(1)} üzerinde`
                : `Hedefin %${Math.abs(performanceData.deviation).toFixed(1)} altında`
              }
            </p>
          </CardContent>
        </Card>

        {/* Faults Exceeding Target */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Timer className="h-5 w-5 text-destructive" />
              Hedef Süreyi Aşan
            </CardTitle>
            <CardDescription>8 saati aşan arızalar</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-destructive">{stats.faultsExceedingTarget}</div>
            <p className="text-sm text-muted-foreground">
              {stats.closedFaults > 0
                ? `Çözülen arızaların %${((stats.faultsExceedingTarget / stats.closedFaults) * 100).toFixed(1)}'i`
                : 'Henüz çözülen arıza yok'
              }
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Fault Type Toggle */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-lg p-1 bg-muted">
          <Button
            variant={selectedFaultType === 'all' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setSelectedFaultType('all')}
            className="gap-2"
          >
            <Layers className="h-4 w-4" />
            Tümü
          </Button>
          <Button
            variant={selectedFaultType === 'teknik_servis' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setSelectedFaultType('teknik_servis')}
            className="gap-2"
          >
            <Wrench className="h-4 w-4" />
            Teknik Servis
          </Button>
          <Button
            variant={selectedFaultType === 'aplikasyon' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setSelectedFaultType('aplikasyon')}
            className="gap-2"
          >
            <FlaskConical className="h-4 w-4" />
            Aplikasyon
          </Button>
        </div>
      </div>

      {/* Charts Row 1: Fault Type Pie + Fault Definitions Bar */}
      <div className="grid grid-cols-10 gap-6">
        {/* Fault Type Pie Chart - 30% */}
        <Card className="col-span-10 md:col-span-3 glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-5 w-5 text-primary" />
              Arıza Tipi Dağılımı
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {faultTypePieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={faultTypePieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {faultTypePieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`${value} arıza`, '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Veri yok
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fault Definitions Bar Chart - 70% */}
        <Card className="col-span-10 md:col-span-7 glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {selectedFaultType === 'teknik_servis' ? (
                <Wrench className="h-5 w-5 text-blue-500" />
              ) : selectedFaultType === 'aplikasyon' ? (
                <FlaskConical className="h-5 w-5 text-purple-500" />
              ) : (
                <Layers className="h-5 w-5 text-primary" />
              )}
              {selectedFaultType === 'teknik_servis'
                ? 'Teknik Servis'
                : selectedFaultType === 'aplikasyon'
                  ? 'Aplikasyon'
                  : 'Tümü'} Arıza Başlıkları
            </CardTitle>
            <CardDescription>En sık karşılaşılan arıza tanımlamaları</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {faultDefinitionsBarData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={faultDefinitionsBarData} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                  <XAxis type="number" />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Bar
                    dataKey="count"
                    fill={selectedFaultType === 'teknik_servis'
                      ? COLORS.teknik
                      : selectedFaultType === 'aplikasyon'
                        ? COLORS.aplikasyon
                        : '#64748b'}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Bu tipte arıza kaydı yok
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2: Intervention Type Pie + Exceeding Target List */}
      <div className="grid grid-cols-10 gap-6">
        {/* Intervention Type Pie Chart - 30% */}
        <Card className="col-span-10 md:col-span-3 glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-5 w-5 text-primary" />
              Müdahale Tipi Dağılımı
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {interventionTypePieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={interventionTypePieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {interventionTypePieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`${value} müdahale`, '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Veri yok
              </div>
            )}
          </CardContent>
        </Card>

        {/* Faults Exceeding Target Table - 70% */}
        <Card className="col-span-10 md:col-span-7 glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Hedef Sürede Çözülemeyen Arızalar
            </CardTitle>
            <CardDescription>8 saat hedef süresini aşan arıza başlıkları</CardDescription>
          </CardHeader>
          <CardContent>
            {faultsExceedingTargetList.length > 0 ? (
              <ScrollArea className="h-56">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arıza Başlığı</TableHead>
                      <TableHead className="text-center">Adet</TableHead>
                      <TableHead className="text-center">Ort. Aşım (dk)</TableHead>
                      <TableHead className="text-center">Aşım Oranı</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {faultsExceedingTargetList.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium max-w-[200px] truncate" title={item.title}>
                          {item.title}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="destructive">{item.count}</Badge>
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          +{item.avgExceedMinutes} dk
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-destructive font-medium">+%{item.avgExceedPercent}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <div className="flex items-center justify-center h-56 text-muted-foreground">
                <CheckCircle className="h-8 w-8 mr-2 text-green-500" />
                Tüm arızalar hedef sürede çözülmüş
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Devices Card */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="text-primary" />
            En Çok Arıza Veren 5 Cihaz
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.topDevices.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {stats.topDevices.map((d, idx) => (
                <div key={d.id} className="p-4 rounded-lg bg-muted/50 text-center">
                  <div className="text-3xl font-bold text-destructive">{d.count as number}</div>
                  <p className="font-medium mt-1 text-sm">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{d.lab}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground">Henüz arıza kaydı yok</p>
          )}
        </CardContent>
      </Card>

      {/* Product Statistics Section */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="text-primary" />
            Ürün İstatistikleri
          </CardTitle>
          <CardDescription>
            Marka ve ürün grubu seçerek ilgili ürünlerin laboratuvarlardaki arıza istatistiklerini görüntüleyin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Selectors */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Brand Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Marka</label>
              <Select value={selectedBrand} onValueChange={(val) => {
                setSelectedBrand(val);
                setSelectedProductId('');
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Marka seçin..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  {uniqueBrands.map(brand => (
                    <SelectItem key={brand} value={brand}>{brand}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Product Group Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Ürün Grubu</label>
              <Select value={selectedProductGroup} onValueChange={(val) => {
                setSelectedProductGroup(val);
                setSelectedProductId('');
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Ürün grubu seçin..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  {uniqueProductGroups.map(group => (
                    <SelectItem key={group} value={group}>{group}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Product Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Ürün</label>
              <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                    disabled={filteredProducts.length === 0}
                  >
                    {selectedProduct
                      ? `${selectedProduct.stokKodu} - ${selectedProduct.stokAdi?.substring(0, 30)}...`
                      : 'Ürün seçin...'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0">
                  <Command>
                    <CommandInput placeholder="Ürün kodu veya adı ara..." />
                    <CommandList>
                      <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                      <CommandGroup>
                        {filteredProducts.slice(0, 50).map(product => (
                          <CommandItem
                            key={product.id}
                            value={`${product.stokKodu} ${product.stokAdi}`}
                            onSelect={() => {
                              setSelectedProductId(product.id);
                              setIsProductPopoverOpen(false);
                            }}
                          >
                            <CheckIcon className={cn("mr-2 h-4 w-4", selectedProductId === product.id ? "opacity-100" : "opacity-0")} />
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

          {/* Product Lab Statistics */}
          {selectedProduct && (
            <div className="mt-6">
              <div className="mb-4 p-4 bg-muted/50 rounded-lg">
                <h4 className="font-semibold">{selectedProduct.stokAdi}</h4>
                <p className="text-sm text-muted-foreground font-mono">{selectedProduct.stokKodu}</p>
                {selectedProduct.testAdi && (
                  <Badge variant="secondary" className="mt-2">Test: {selectedProduct.testAdi}</Badge>
                )}
              </div>

              {productLabStats.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Building className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>Bu ürünü kullanan laboratuvar bulunamadı.</p>
                </div>
              ) : (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Laboratuvar</TableHead>
                        <TableHead>Cihaz Sayısı</TableHead>
                        <TableHead>Teknik Servis</TableHead>
                        <TableHead>Aplikasyon</TableHead>
                        <TableHead>Toplam Arıza</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productLabStats.map(lab => (
                        <Collapsible key={lab.hospitalId} asChild>
                          <>
                            <TableRow className="hover:bg-muted/50">
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Building className="h-4 w-4 text-muted-foreground" />
                                  <span className="font-medium">{lab.hospitalName}</span>
                                </div>
                              </TableCell>
                              <TableCell>{lab.devices.length}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Wrench className="h-4 w-4 text-blue-500" />
                                  <span>{lab.teknikServisFaults}</span>
                                  {lab.openTeknikServis > 0 && (
                                    <Badge variant="destructive" className="text-xs">
                                      {lab.openTeknikServis} açık
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <FlaskConical className="h-4 w-4 text-purple-500" />
                                  <span>{lab.aplikasyonFaults}</span>
                                  {lab.openAplikasyon > 0 && (
                                    <Badge variant="destructive" className="text-xs">
                                      {lab.openAplikasyon} açık
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="font-bold">{lab.teknikServisFaults + lab.aplikasyonFaults}</span>
                              </TableCell>
                              <TableCell>
                                <CollapsibleTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => toggleLabExpand(lab.hospitalId)}
                                  >
                                    {expandedLabs.has(lab.hospitalId) ? (
                                      <ChevronUp className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                  </Button>
                                </CollapsibleTrigger>
                              </TableCell>
                            </TableRow>
                            <CollapsibleContent asChild>
                              <TableRow className="bg-muted/30">
                                <TableCell colSpan={6}>
                                  <div className="p-4">
                                    <h5 className="font-medium mb-3 flex items-center gap-2">
                                      <Calendar className="h-4 w-4" />
                                      Son 6 Ay Arıza Geçmişi
                                    </h5>
                                    <div className="grid grid-cols-6 gap-2">
                                      {lab.last6MonthsFaults.map((m, idx) => (
                                        <div
                                          key={idx}
                                          className={cn(
                                            "text-center p-3 rounded-lg border",
                                            m.count === 0 ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800" :
                                            m.count <= 2 ? "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800" :
                                            "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                                          )}
                                        >
                                          <p className="text-xs text-muted-foreground">{m.month}</p>
                                          <p className={cn(
                                            "text-2xl font-bold",
                                            m.count === 0 ? "text-green-600" :
                                            m.count <= 2 ? "text-yellow-600" :
                                            "text-red-600"
                                          )}>
                                            {m.count}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                    {/* Device list */}
                                    <div className="mt-4">
                                      <h5 className="font-medium mb-2 text-sm">Cihazlar:</h5>
                                      <div className="flex flex-wrap gap-2">
                                        {lab.devices.map(device => (
                                          <Badge key={device.id} variant="outline" className="text-xs">
                                            {device.cihazAdi || device.model}
                                            {device.seriNumarasi && ` (${device.seriNumarasi})`}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            </CollapsibleContent>
                          </>
                        </Collapsible>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
