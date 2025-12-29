
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Device, Hospital } from '@/lib/types';
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
import { Loader2, AlertTriangle, CheckCircle, BarChart, Server, Clock, ShieldCheck, RotateCcw, Building, ChevronsUpDown, Check as CheckIcon, Calendar } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { differenceInMinutes, startOfDay, endOfDay } from 'date-fns';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';


export default function ArizaIstatistikleriPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  
  const [selectedLabId, setSelectedLabId] = useState<string>('all');
  const [isLabPopoverOpen, setIsLabPopoverOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  
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

    return () => {
        unsubReports();
        unsubDevices();
        unsubHospitals();
    };
  }, [toast]);
  
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
    </div>
  );
}
