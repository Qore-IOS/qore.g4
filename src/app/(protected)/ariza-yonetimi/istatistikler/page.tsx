
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, orderBy, query, Timestamp, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, CheckCircle, BarChart, Server, Clock, ShieldCheck, RotateCcw, Building, ChevronsUpDown, Check as CheckIcon, Calendar, Package, ChevronDown, ChevronUp, Wrench, FlaskConical } from 'lucide-react';
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


export default function ArizaIstatistikleriPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  const [selectedLabId, setSelectedLabId] = useState<string>('all');
  const [isLabPopoverOpen, setIsLabPopoverOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Product statistics state
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [selectedProductGroup, setSelectedProductGroup] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);
  const [expandedLabs, setExpandedLabs] = useState<Set<string>>(new Set());
  const [hospitalMinMaxRules, setHospitalMinMaxRules] = useState<Map<string, Set<string>>>(new Map()); // hospitalId -> Set<stokKodu>

  const TARGET_RESOLUTION_TIME = 480; // 8 hours in minutes

  useEffect(() => {
    const reportsQuery = query(collection(db, 'deviceFaultReports'), orderBy('openedAt', 'desc'));
    const devicesQuery = query(collection(db, 'devices'));
    const hospitalsQuery = query(collection(db, 'hospitals'), orderBy('name', 'asc'));
    
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
            setReports(reportList);
        }, 
        (error) => {
            console.error('Error fetching fault reports:', error);
            toast({ title: 'Hata', description: 'Arıza raporları yüklenemedi.', variant: 'destructive' });
        }
    );

    const unsubDevices = onSnapshot(devicesQuery,
        (snapshot) => {
            setDevices(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Device)));
        },
        (error) => {
            console.error('Error fetching devices:', error);
            toast({ title: 'Hata', description: 'Cihaz listesi yüklenemedi.', variant: 'destructive' });
        }
    );

    const unsubHospitals = onSnapshot(hospitalsQuery,
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

    return () => {
        unsubReports();
        unsubDevices();
        unsubHospitals();
    };
  }, [toast]);

  // Fetch minMaxRules for all hospitals to determine which products are used in which labs
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
      return filtered;
  }, [reports, selectedLabId, dateRange]);

  const stats = useMemo(() => {
    if (filteredReports.length === 0) {
      return { topDevices: [], avgResolutionTime: 0, openFaults: 0, closedFaults: 0 };
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

    const closedReports = filteredReports.filter(r => r.status === 'closed' && r.openedAt && r.closedAt);
    const totalResolutionTime = closedReports.reduce((sum, r) => {
        return sum + differenceInMinutes(r.closedAt!, r.openedAt!);
    }, 0);
    const avgResolutionTime = closedReports.length > 0 ? totalResolutionTime / closedReports.length : 0;

    const openFaults = filteredReports.filter(r => r.status === 'open').length;
    const closedFaults = filteredReports.filter(r => r.status === 'closed').length;

    return { topDevices, avgResolutionTime, openFaults, closedFaults };
  }, [filteredReports, devices, hospitals]);

  const handleResetAverageTime = () => {
    // This would typically trigger a Cloud Function or server-side process
    // to clear the relevant fields on the fault reports.
    alert("Bu özellik için sunucu tarafında bir işlem gereklidir.");
  };

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

  // Get unique brands and product groups
  const uniqueBrands = useMemo(() => {
    const brands = new Set(productCodes.map(p => p.marka).filter(Boolean));
    return Array.from(brands).sort() as string[];
  }, [productCodes]);

  const uniqueProductGroups = useMemo(() => {
    const groups = new Set(productCodes.map(p => p.urunGrubu).filter(Boolean));
    return Array.from(groups).sort() as string[];
  }, [productCodes]);

  // Filter products based on selected brand and product group
  const filteredProducts = useMemo(() => {
    return productCodes.filter(p => {
      const matchesBrand = selectedBrand === 'all' || p.marka === selectedBrand;
      const matchesGroup = selectedProductGroup === 'all' || p.urunGrubu === selectedProductGroup;
      return matchesBrand && matchesGroup;
    });
  }, [productCodes, selectedBrand, selectedProductGroup]);

  // Get selected product
  const selectedProduct = useMemo(() => {
    return productCodes.find(p => p.id === selectedProductId);
  }, [productCodes, selectedProductId]);

  // Calculate product statistics per lab
  const productLabStats = useMemo(() => {
    if (!selectedProduct) return [];

    // Find hospitals that have this product in their minMaxRules
    const hospitalsWithProduct: string[] = [];
    for (const [hospitalId, stokKodulari] of hospitalMinMaxRules) {
      if (stokKodulari.has(selectedProduct.stokKodu)) {
        hospitalsWithProduct.push(hospitalId);
      }
    }

    // Get devices in those hospitals
    const matchingDevices = devices.filter(d =>
      d.hospitalId && hospitalsWithProduct.includes(d.hospitalId)
    );

    // Group by hospital
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

    // First, create entries for all hospitals with the product
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

    // Add devices and count faults
    for (const device of matchingDevices) {
      if (!device.hospitalId) continue;

      const labData = labMap.get(device.hospitalId);
      if (!labData) continue;

      labData.devices.push(device);

      // Count faults for this device
      const deviceFaults = reports.filter(r => r.deviceId === device.id);

      for (const fault of deviceFaults) {
        if (fault.faultType === 'teknik_servis') {
          labData.teknikServisFaults++;
          if (fault.status !== 'closed') labData.openTeknikServis++;
        } else {
          labData.aplikasyonFaults++;
          if (fault.status !== 'closed') labData.openAplikasyon++;
        }
      }
    }

    // Also count faults that have relatedTests matching this product's testAdi
    if (selectedProduct.testAdi) {
      for (const [hospitalId, labData] of labMap) {
        const testRelatedFaults = reports.filter(r =>
          r.hospitalId === hospitalId &&
          r.relatedTests &&
          r.relatedTests.includes(selectedProduct.testAdi)
        );

        for (const fault of testRelatedFaults) {
          // Avoid double counting if already counted via device
          const alreadyCounted = labData.devices.some(d =>
            reports.some(r => r.deviceId === d.id && r.id === fault.id)
          );

          if (!alreadyCounted) {
            if (fault.faultType === 'teknik_servis') {
              labData.teknikServisFaults++;
              if (fault.status !== 'closed') labData.openTeknikServis++;
            } else {
              labData.aplikasyonFaults++;
              if (fault.status !== 'closed') labData.openAplikasyon++;
            }
          }
        }
      }
    }

    // Calculate 6 months history for each lab
    for (const [hospitalId, labData] of labMap) {
      const deviceIds = labData.devices.map(d => d.id);

      // Get faults from devices OR related to this product's test
      const labFaults = reports.filter(r =>
        r.openedAt &&
        r.openedAt >= sixMonthsAgo &&
        (
          deviceIds.includes(r.deviceId) ||
          (r.hospitalId === hospitalId && selectedProduct.testAdi && r.relatedTests?.includes(selectedProduct.testAdi))
        )
      );

      // Group by month
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
  }, [selectedProduct, devices, hospitals, reports, hospitalMinMaxRules]);

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


  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">İstatistikler yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <BackButton fallback="/ariza-yonetimi" />
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="glass-card flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Server className="text-primary"/>En Çok Arıza Veren 5 Cihaz</CardTitle>
          </CardHeader>
          <CardContent className="flex-grow">
            <ul className="space-y-2">
                {stats.topDevices.map(d => (
                    <li key={d.id} className="text-sm flex justify-between items-center">
                        <div>
                            <p className="font-medium">{d.name}</p>
                            <p className="text-xs text-muted-foreground">{d.lab}</p>
                        </div>
                        <span className="font-bold text-lg text-destructive">{d.count as number}</span>
                    </li>
                ))}
            </ul>
          </CardContent>
           {isAdmin && (
            <CardFooter>
                <Button variant="secondary" size="sm" onClick={() => alert("Bu özellik için sunucu tarafında bir işlem gereklidir.")} className="w-full">
                    <RotateCcw className="mr-2 h-4 w-4" /> İstatistikleri Sıfırla
                </Button>
            </CardFooter>
          )}
        </Card>
        <Card className="glass-card flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="text-primary"/>Ortalama Çözüm Süresi</CardTitle>
             <CardDescription>Hedef: {TARGET_RESOLUTION_TIME} dakika</CardDescription>
          </CardHeader>
          <CardContent className="text-center flex-grow flex flex-col justify-center gap-4">
            <div>
              <p className="text-5xl font-bold">{stats.avgResolutionTime.toFixed(0)}</p>
              <p className="text-muted-foreground">dakika</p>
            </div>
            <div className="relative h-4 w-full bg-muted rounded-full">
                <div 
                    className={cn("h-4 rounded-full transition-all duration-500", performanceData.colorClass)}
                    style={{ width: `${Math.min(100, (stats.avgResolutionTime / (TARGET_RESOLUTION_TIME * 1.5)) * 100)}%` }}
                />
            </div>
            <p className={cn("text-sm font-semibold", performanceData.isOver ? "text-red-500" : "text-green-500")}>
              {performanceData.isOver 
                ? `Hedefin %${performanceData.deviation.toFixed(1)} üzerinde`
                : `Hedefin %${Math.abs(performanceData.deviation).toFixed(1)} altında`
              }
            </p>
          </CardContent>
          {isAdmin && (
            <CardFooter>
              <Button variant="destructive" size="sm" onClick={handleResetAverageTime} className="w-full">
                <RotateCcw className="mr-2 h-4 w-4" /> Süreyi Sıfırla
              </Button>
            </CardFooter>
          )}
        </Card>
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="text-primary"/>Arıza Durumları</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center text-lg">
                <span className="flex items-center gap-2"><AlertTriangle className="text-destructive"/>Açık Arıza Sayısı</span>
                <span className="font-bold text-destructive">{stats.openFaults}</span>
            </div>
            <div className="flex justify-between items-center text-lg">
                <span className="flex items-center gap-2"><CheckCircle className="text-green-500"/>Giderilen Toplam Arıza</span>
                <span className="font-bold text-green-500">{stats.closedFaults}</span>
            </div>
          </CardContent>
        </Card>
      </div>

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
