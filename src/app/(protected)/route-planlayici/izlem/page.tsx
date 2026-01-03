// app/(protected)/route-planlayici/izlem/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Eye, Truck, MapPin, Navigation, Check, Clock, LogOut, Flag, Car } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import type { User as AppUser } from '@/lib/types';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

type Vehicle = {
  id: string;
  marka: string;
  model: string;
  yil?: string;
  plaka: string;
  assignedDriverId?: string;
};

type RouteStop = {
  order: number;
  hospitalId: string;
  name: string;
  lat: number;
  lng: number;
  departedAt?: Timestamp | null;
  arrivedAt?: Timestamp | null;
};

type RouteDoc = {
  id: string;
  runId: string;
  sequence: number;
  date: number;
  dateISO: string;
  driverId: string;
  driverName: string;
  status: 'open' | 'in_progress' | 'completed';
  isActive?: boolean;
  stops: RouteStop[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
};

type DriverWithRoute = {
  driver: AppUser;
  activeRoute: RouteDoc | null;
  vehicle: Vehicle | null;
};

const toDayKey = (d: Date) => Number(format(d, 'yyyyMMdd'));

export default function SoforIzlemPage() {
  const [driversWithRoutes, setDriversWithRoutes] = useState<DriverWithRoute[]>([]);
  const [loading, setLoading] = useState(true);

  // Şoförleri ve aktif rotalarını getir
  useEffect(() => {
    const fetchDriversAndRoutes = async () => {
      try {
        // Tüm şoförleri ve araçları getir
        const [usersSnap, vehiclesSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'vehicles')),
        ]);

        const drivers = usersSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as AppUser))
          .filter(u => (u as any).role === 'driver');

        // Araçları şoför ID'sine göre map'e dönüştür
        const vehiclesByDriverId = new Map<string, Vehicle>();
        vehiclesSnap.docs.forEach(d => {
          const vehicle = { id: d.id, ...d.data() } as Vehicle;
          if (vehicle.assignedDriverId) {
            vehiclesByDriverId.set(vehicle.assignedDriverId, vehicle);
          }
        });

        // Bugünün tarihini al
        const today = toDayKey(new Date());

        // Her şoför için aktif rotayı getir
        const driverRoutePromises = drivers.map(async (driver) => {
          const routeQuery = query(
            collection(db, 'routes'),
            where('driverId', '==', driver.id),
            where('date', '==', today),
            where('status', 'in', ['open', 'in_progress'])
          );
          const routeSnap = await getDocs(routeQuery);

          let activeRoute: RouteDoc | null = null;
          if (!routeSnap.empty) {
            const routes = routeSnap.docs.map(d => ({ id: d.id, ...d.data() } as RouteDoc));
            // Aktif olan rotayı veya ilk açık rotayı seç
            activeRoute = routes.find(r => r.isActive) || routes[0] || null;
          }

          // Şoföre atanmış aracı bul
          const vehicle = vehiclesByDriverId.get(driver.id!) || null;

          return { driver, activeRoute, vehicle };
        });

        const results = await Promise.all(driverRoutePromises);
        setDriversWithRoutes(results);
      } catch (error) {
        console.error('Şoförler yüklenirken hata:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDriversAndRoutes();

    // Real-time güncellemeler için routes koleksiyonunu dinle
    const today = toDayKey(new Date());
    const routesQuery = query(
      collection(db, 'routes'),
      where('date', '==', today),
      where('status', 'in', ['open', 'in_progress'])
    );

    const unsubscribe = onSnapshot(routesQuery, () => {
      // Rotalar değiştiğinde yeniden yükle
      fetchDriversAndRoutes();
    });

    return () => unsubscribe();
  }, []);

  // İstatistikler
  const stats = useMemo(() => {
    const total = driversWithRoutes.length;
    const activeDrivers = driversWithRoutes.filter(d => d.activeRoute?.status === 'in_progress').length;
    const waitingDrivers = driversWithRoutes.filter(d => d.activeRoute?.status === 'open').length;
    const idleDrivers = driversWithRoutes.filter(d => !d.activeRoute).length;
    return { total, activeDrivers, waitingDrivers, idleDrivers };
  }, [driversWithRoutes]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <Card className="shadow-lg">
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/route-planlayici">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              <CardTitle className="text-base sm:text-lg md:text-xl">Şoför İzlem Paneli</CardTitle>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {format(new Date(), 'dd MMMM yyyy, HH:mm', { locale: tr })}
          </div>
        </CardHeader>
        <CardContent>
          {/* Stats Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-primary">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Toplam Şoför</div>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.activeDrivers}</div>
              <div className="text-xs text-muted-foreground">Aktif Rotada</div>
            </div>
            <div className="bg-yellow-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-yellow-600">{stats.waitingDrivers}</div>
              <div className="text-xs text-muted-foreground">Beklemede</div>
            </div>
            <div className="bg-gray-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-500">{stats.idleDrivers}</div>
              <div className="text-xs text-muted-foreground">Rotasız</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Driver Cards Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : driversWithRoutes.length === 0 ? (
        <Card className="shadow-lg">
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Truck className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Sistemde kayıtlı şoför bulunamadı.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {driversWithRoutes.map(({ driver, activeRoute, vehicle }) => (
            <DriverKPICard key={driver.id} driver={driver} activeRoute={activeRoute} vehicle={vehicle} />
          ))}
        </div>
      )}
    </div>
  );
}

// Şoför KPI Kartı Bileşeni
function DriverKPICard({ driver, activeRoute, vehicle }: { driver: AppUser; activeRoute: RouteDoc | null; vehicle: Vehicle | null }) {
  const driverName = (driver as any).displayName || (driver as any).name || (driver as any).email || 'İsimsiz Şoför';

  // Segment durumlarını hesapla
  const segmentStates = useMemo(() => {
    if (!activeRoute?.stops?.length) return [];
    const sortedStops = [...activeRoute.stops].sort((a, b) => a.order - b.order);
    const arr: ('completed' | 'current' | 'future')[] = [];
    for (let i = 0; i < Math.max(0, sortedStops.length - 1); i++) {
      const from = sortedStops[i];
      const to = sortedStops[i + 1];
      const completed = !!from.departedAt && !!to.arrivedAt;
      const current = !!from.departedAt && !to.arrivedAt;
      arr.push(completed ? 'completed' : current ? 'current' : 'future');
    }
    return arr;
  }, [activeRoute]);

  // Mevcut durak bilgileri
  const currentStopInfo = useMemo(() => {
    if (!activeRoute?.stops?.length) return null;
    const sortedStops = [...activeRoute.stops].sort((a, b) => a.order - b.order);

    // Aktif olarak gidilen durak
    for (let i = 0; i < sortedStops.length - 1; i++) {
      if (sortedStops[i].departedAt && !sortedStops[i + 1].arrivedAt) {
        return {
          from: sortedStops[i],
          to: sortedStops[i + 1],
          currentIndex: i + 1,
          total: sortedStops.length
        };
      }
    }

    // Henüz başlamamış
    if (!sortedStops[0].departedAt) {
      return {
        from: null,
        to: sortedStops[0],
        currentIndex: 0,
        total: sortedStops.length,
        waiting: true
      };
    }

    return null;
  }, [activeRoute]);

  // Tamamlanan durak sayısı
  const completedStops = useMemo(() => {
    if (!activeRoute?.stops?.length) return 0;
    return activeRoute.stops.filter(s => s.arrivedAt || (s.order === 1 && s.departedAt)).length;
  }, [activeRoute]);

  // Son aktivite zamanı
  const lastActivity = useMemo(() => {
    if (!activeRoute?.stops?.length) return null;
    const sortedStops = [...activeRoute.stops].sort((a, b) => b.order - a.order);

    for (const stop of sortedStops) {
      if (stop.arrivedAt) {
        return { type: 'arrived', time: stop.arrivedAt, stopName: stop.name };
      }
      if (stop.departedAt) {
        return { type: 'departed', time: stop.departedAt, stopName: stop.name };
      }
    }
    return null;
  }, [activeRoute]);

  return (
    <Card className={cn(
      "shadow-lg transition-all duration-300 relative",
      activeRoute?.status === 'in_progress' && "ring-2 ring-blue-500/50",
      !activeRoute && "opacity-60"
    )}>
      {/* Vehicle Info - Sol Üst */}
      {vehicle && (
        <div className="absolute top-2 left-2 z-10">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800/80 text-white text-[10px]">
            <Car className="h-3 w-3" />
            <span className="font-medium">{vehicle.marka} {vehicle.model}</span>
            <span className="opacity-70">|</span>
            <span className="font-mono">{vehicle.plaka}</span>
          </div>
        </div>
      )}

      {/* Driver Header */}
      <CardHeader className={cn("pb-2", vehicle && "pt-10")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center",
              activeRoute?.status === 'in_progress' && "bg-blue-500 text-white",
              activeRoute?.status === 'open' && "bg-yellow-500 text-white",
              !activeRoute && "bg-muted text-muted-foreground"
            )}>
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">{driverName}</h3>
              {activeRoute && (
                <span className="text-xs text-muted-foreground">
                  {format(new Date(activeRoute.dateISO), 'dd MMM yyyy', { locale: tr })}
                </span>
              )}
            </div>
          </div>
          <Badge variant={
            activeRoute?.status === 'in_progress' ? 'default' :
            activeRoute?.status === 'open' ? 'secondary' : 'outline'
          } className={cn(
            activeRoute?.status === 'in_progress' && "bg-blue-500"
          )}>
            {activeRoute?.status === 'in_progress' ? 'Aktif' :
             activeRoute?.status === 'open' ? 'Bekliyor' : 'Rotasız'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {activeRoute ? (
          <>
            {/* Progress Bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">İlerleme</span>
                <span className="text-xs font-medium">
                  {completedStops} / {activeRoute.stops?.length || 0} durak
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all duration-500",
                    activeRoute.status === 'in_progress'
                      ? "bg-gradient-to-r from-blue-500 to-blue-400"
                      : "bg-gradient-to-r from-yellow-500 to-yellow-400"
                  )}
                  style={{ width: `${activeRoute.stops?.length ? (completedStops / activeRoute.stops.length) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* Current Status */}
            {currentStopInfo && (
              <div className={cn(
                "rounded-lg p-3 border",
                currentStopInfo.waiting
                  ? "bg-yellow-500/10 border-yellow-500/20"
                  : "bg-blue-500/10 border-blue-500/20"
              )}>
                {currentStopInfo.waiting ? (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-yellow-600" />
                    <span className="text-sm">
                      <span className="font-medium">{currentStopInfo.to.name}</span>
                      <span className="text-muted-foreground ml-1">- Çıkış bekleniyor</span>
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Navigation className="h-4 w-4 text-blue-600 animate-pulse" />
                      <span className="text-sm font-medium text-blue-600">
                        {currentStopInfo.to.name}&apos;a gidiyor
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <LogOut className="h-3 w-3" />
                      <span>{currentStopInfo.from?.name}&apos;den çıktı</span>
                      {currentStopInfo.from?.departedAt && (
                        <span className="ml-auto">
                          {format(currentStopInfo.from.departedAt.toDate(), 'HH:mm', { locale: tr })}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Last Activity */}
            {lastActivity && (
              <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
                <div className="flex items-center gap-2">
                  {lastActivity.type === 'arrived' ? (
                    <Flag className="h-3 w-3 text-green-500" />
                  ) : (
                    <LogOut className="h-3 w-3 text-blue-500" />
                  )}
                  <span>
                    {lastActivity.type === 'arrived' ? 'Varış:' : 'Çıkış:'} {lastActivity.stopName}
                  </span>
                </div>
                <span>{format(lastActivity.time.toDate(), 'HH:mm', { locale: tr })}</span>
              </div>
            )}

            {/* Mini Metro View */}
            <div className="border-t pt-3">
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {activeRoute.stops?.sort((a, b) => a.order - b.order).map((stop, index) => {
                  const isCompleted = stop.arrivedAt || (index === 0 && stop.departedAt);
                  const isCurrent = !isCompleted && (
                    (index === 0 && !stop.departedAt) ||
                    (index > 0 && segmentStates[index - 1] === 'current')
                  );
                  const isLast = index === activeRoute.stops.length - 1;

                  return (
                    <React.Fragment key={stop.hospitalId}>
                      <div className="flex flex-col items-center flex-shrink-0" title={stop.name}>
                        <div className={cn(
                          "w-4 h-4 rounded-full flex items-center justify-center text-[8px]",
                          isCompleted && "bg-green-500 text-white",
                          isCurrent && "bg-blue-500 text-white animate-pulse",
                          !isCompleted && !isCurrent && "bg-muted border border-border"
                        )}>
                          {isCompleted && <Check className="h-2.5 w-2.5" />}
                          {isCurrent && <Navigation className="h-2.5 w-2.5" />}
                          {!isCompleted && !isCurrent && <span>{stop.order}</span>}
                        </div>
                      </div>
                      {!isLast && (
                        <div className={cn(
                          "h-0.5 w-4 flex-shrink-0",
                          segmentStates[index] === 'completed' && "bg-green-500",
                          segmentStates[index] === 'current' && "bg-blue-500",
                          segmentStates[index] === 'future' && "bg-muted"
                        )} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Bugün için atanmış rota yok</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
