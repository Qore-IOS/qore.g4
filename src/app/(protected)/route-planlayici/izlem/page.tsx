// app/(protected)/route-planlayici/izlem/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Eye, Truck, MapPin, Navigation, Check, Clock, LogOut, Flag, Car, Search, X, Building2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import type { User as AppUser, Hospital } from '@/lib/types';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

type Vehicle = {
  id: string;
  marka: string;
  model: string;
  yil?: string;
  plaka: string;
  icon?: string;
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
  todayRoute: RouteDoc | null; // Bugünkü rota (aktif/bekleyen/tamamlanmış)
  lastCompletedRoute: RouteDoc | null; // Son tamamlanan rota
  nextAssignedRoute: RouteDoc | null; // Atanan en yakın gelecek rota
  allRoutes: RouteDoc[]; // Şoföre ait tüm rotalar (arama için)
  vehicle: Vehicle | null;
};

const toDayKey = (d: Date) => Number(format(d, 'yyyyMMdd'));

export default function SoforIzlemPage() {
  const [driversWithRoutes, setDriversWithRoutes] = useState<DriverWithRoute[]>([]);
  const [loading, setLoading] = useState(true);

  // Laboratuvar arama state'leri
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);
  const [hospitalSearchTerm, setHospitalSearchTerm] = useState('');
  const [isHospitalDropdownOpen, setIsHospitalDropdownOpen] = useState(false);

  // Laboratuvarları getir
  useEffect(() => {
    const fetchHospitals = async () => {
      try {
        const hospitalsSnap = await getDocs(collection(db, 'hospitals'));
        const hospitalsList = hospitalsSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Hospital))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
        setHospitals(hospitalsList);
      } catch (error) {
        console.error('Laboratuvarlar yüklenirken hata:', error);
      }
    };
    fetchHospitals();
  }, []);

  // Şoförleri ve aktif rotalarını getir
  useEffect(() => {
    const fetchDriversAndRoutes = async () => {
      try {
        // Tüm şoförleri ve araçları getir
        const [usersSnap, vehiclesSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'vehicles')),
        ]);

        // Debug: Tüm kullanıcıları ve rollerini logla
        const allUsers = usersSnap.docs.map(d => {
          const data = d.data();
          return { ...data, id: d.id, uid: data.uid || d.id };
        });
        console.log('Tüm kullanıcılar:', allUsers.map(u => ({ id: u.id, name: (u as any).name, role: (u as any).role })));

        // Şoförleri filtrele - role 'driver' olanlar (case-insensitive ve çeşitli varyasyonlar)
        const drivers = allUsers.filter(u => {
          const role = ((u as any).role || '').toString().toLowerCase().trim();
          // driver, Driver, DRIVER, şoför, sofor varyasyonlarını kontrol et
          return role === 'driver' || role === 'şoför' || role === 'sofor' || role === 'sürücü' || role === 'surucu';
        }) as AppUser[];

        console.log('Bulunan şoförler:', drivers.length, drivers.map(d => ({ id: d.id, name: (d as any).name, role: (d as any).role })));

        // Araçları şoför ID'sine göre map'e dönüştür (hem id hem uid ile eşleştir)
        const vehiclesByDriverId = new Map<string, Vehicle>();
        vehiclesSnap.docs.forEach(d => {
          const vehicle = { id: d.id, ...d.data() } as Vehicle;
          if (vehicle.assignedDriverId) {
            vehiclesByDriverId.set(vehicle.assignedDriverId, vehicle);
          }
        });

        // Bugünün tarihini al
        const today = toDayKey(new Date());

        // Her şoför için rotaları getir (tek sorgu ile tüm rotaları çek, client-side filtrele)
        const driverRoutePromises = drivers.map(async (driver) => {
          // Şoför ID'si - hem id hem uid kullan
          const driverId = driver.id || (driver as any).uid;

          // Şoföre ait tüm rotaları tek sorguda getir (index gerektirmez)
          const allRoutesQuery = query(
            collection(db, 'routes'),
            where('driverId', '==', driverId)
          );
          const allRoutesSnap = await getDocs(allRoutesQuery);
          const allRoutes = allRoutesSnap.docs.map(d => ({ id: d.id, ...d.data() } as RouteDoc));

          // Bugünkü rotalar
          const todayRoutes = allRoutes.filter(r => r.date === today);
          let activeRoute: RouteDoc | null = null;
          let todayRoute: RouteDoc | null = null;

          if (todayRoutes.length > 0) {
            // Bugünkü rotayı seç (öncelik: aktif > in_progress > open > completed)
            todayRoute = todayRoutes.find(r => r.isActive) ||
                        todayRoutes.find(r => r.status === 'in_progress') ||
                        todayRoutes.find(r => r.status === 'open') ||
                        todayRoutes.find(r => r.status === 'completed') ||
                        todayRoutes[0] || null;
            // Aktif rota sadece open veya in_progress olanlar
            activeRoute = todayRoutes.find(r => r.isActive && r.status !== 'completed') ||
                         todayRoutes.find(r => r.status === 'in_progress') ||
                         todayRoutes.find(r => r.status === 'open') || null;
          }

          // Son tamamlanan rota (client-side filtreleme)
          const completedRoutes = allRoutes
            .filter(r => r.status === 'completed')
            .sort((a, b) => {
              // Önce tarihe göre, sonra completedAt'e göre sırala
              if (b.date !== a.date) return b.date - a.date;
              const aTime = a.completedAt?.toMillis() || 0;
              const bTime = b.completedAt?.toMillis() || 0;
              return bTime - aTime;
            });
          const lastCompletedRoute = completedRoutes[0] || null;

          // En yakın gelecek rota (client-side filtreleme) - tamamlanmış rotalar hariç
          const futureRoutes = allRoutes
            .filter(r => r.date > today && r.status !== 'completed')
            .sort((a, b) => a.date - b.date);
          const nextAssignedRoute = futureRoutes[0] || null;

          // Şoföre atanmış aracı bul (hem id hem uid ile ara)
          const vehicle = vehiclesByDriverId.get(driverId) || vehiclesByDriverId.get((driver as any).uid) || null;

          return { driver, activeRoute, todayRoute, lastCompletedRoute, nextAssignedRoute, allRoutes, vehicle };
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
    const completedDrivers = driversWithRoutes.filter(d => d.todayRoute?.status === 'completed' && !d.activeRoute).length;
    const idleDrivers = driversWithRoutes.filter(d => !d.todayRoute).length;
    return { total, activeDrivers, waitingDrivers, completedDrivers, idleDrivers };
  }, [driversWithRoutes]);

  // Seçili laboratuvar bilgisi
  const selectedHospital = useMemo(() => {
    if (!selectedHospitalId) return null;
    return hospitals.find(h => h.id === selectedHospitalId) || null;
  }, [selectedHospitalId, hospitals]);

  // Filtrelenmiş laboratuvar listesi (arama için)
  const filteredHospitals = useMemo(() => {
    if (!hospitalSearchTerm.trim()) return hospitals;
    const term = hospitalSearchTerm.toLowerCase().trim();
    return hospitals.filter(h => (h.name || '').toLowerCase().includes(term));
  }, [hospitals, hospitalSearchTerm]);

  // Laboratuvar seçimine göre filtrelenmiş şoförler ve gösterilecek rotalar
  const filteredDriversData = useMemo(() => {
    if (!selectedHospitalId) {
      // Filtre yok - tüm şoförleri normal şekilde göster
      return driversWithRoutes.map(d => ({
        ...d,
        displayRoute: null as RouteDoc | null, // Normal görünüm
        highlightHospitalId: null as string | null,
      }));
    }

    const today = toDayKey(new Date());
    const results: Array<typeof driversWithRoutes[0] & { displayRoute: RouteDoc | null; highlightHospitalId: string | null }> = [];

    for (const driverData of driversWithRoutes) {
      const { activeRoute, todayRoute, lastCompletedRoute, nextAssignedRoute, allRoutes } = driverData;

      // Seçili laboratuvarı içeren rotaları bul
      const routesWithHospital = allRoutes
        .filter(r => r.stops?.some(s => s.hospitalId === selectedHospitalId))
        .sort((a, b) => a.date - b.date);

      if (routesWithHospital.length === 0) continue; // Bu şoförün rotalarında bu laboratuvar yok

      // Hangi rotayı göstereceğimizi belirle
      let displayRoute: RouteDoc | null = null;

      // 1. Aktif rotada mı kontrol et
      if (activeRoute && activeRoute.stops?.some(s => s.hospitalId === selectedHospitalId)) {
        // Aktif rotada ve henüz uğranmamış mı?
        const stopInActiveRoute = activeRoute.stops.find(s => s.hospitalId === selectedHospitalId);
        if (stopInActiveRoute && !stopInActiveRoute.arrivedAt) {
          displayRoute = activeRoute;
        } else {
          // Aktif rotada ama zaten uğranılmış, sonraki rotaya bak
          displayRoute = activeRoute;
        }
      }
      // 2. Bugünkü rotada mı (tamamlanmış dahil)
      else if (todayRoute && todayRoute.stops?.some(s => s.hospitalId === selectedHospitalId)) {
        displayRoute = todayRoute;
      }
      // 3. Son tamamlanan rotada mı
      else if (lastCompletedRoute && lastCompletedRoute.stops?.some(s => s.hospitalId === selectedHospitalId)) {
        displayRoute = lastCompletedRoute;
      }
      // 4. En yakın gelecek rotada mı
      else if (nextAssignedRoute && nextAssignedRoute.stops?.some(s => s.hospitalId === selectedHospitalId)) {
        displayRoute = nextAssignedRoute;
      }
      // 5. Daha ileri bir tarihte mi
      else {
        const futureRoute = routesWithHospital.find(r => r.date > today && r.status !== 'completed');
        if (futureRoute) {
          displayRoute = futureRoute;
        }
      }

      if (displayRoute) {
        results.push({
          ...driverData,
          displayRoute,
          highlightHospitalId: selectedHospitalId,
        });
      }
    }

    return results;
  }, [driversWithRoutes, selectedHospitalId]);

  // Filtre temizle
  const clearHospitalFilter = () => {
    setSelectedHospitalId(null);
    setHospitalSearchTerm('');
    setIsHospitalDropdownOpen(false);
  };

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
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
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
            <div className="bg-green-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.completedDrivers}</div>
              <div className="text-xs text-muted-foreground">Tamamladı</div>
            </div>
            <div className="bg-gray-500/10 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-500">{stats.idleDrivers}</div>
              <div className="text-xs text-muted-foreground">Rotasız</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Laboratuvar Arama */}
      <Card className="shadow-lg">
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span>Laboratuvar Ara:</span>
            </div>
            <div className="relative flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Laboratuvar adı yazın..."
                  value={selectedHospital ? selectedHospital.name : hospitalSearchTerm}
                  onChange={(e) => {
                    setHospitalSearchTerm(e.target.value);
                    setSelectedHospitalId(null);
                    setIsHospitalDropdownOpen(true);
                  }}
                  onFocus={() => setIsHospitalDropdownOpen(true)}
                  className="pl-9 pr-9"
                />
                {(selectedHospitalId || hospitalSearchTerm) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={clearHospitalFilter}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {/* Dropdown */}
              {isHospitalDropdownOpen && !selectedHospitalId && (
                <div className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredHospitals.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Laboratuvar bulunamadı</div>
                  ) : (
                    filteredHospitals.map(hospital => (
                      <button
                        key={hospital.id}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                        onClick={() => {
                          setSelectedHospitalId(hospital.id!);
                          setHospitalSearchTerm('');
                          setIsHospitalDropdownOpen(false);
                        }}
                      >
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{hospital.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {selectedHospital && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {selectedHospital.name}
                <button onClick={clearHospitalFilter} className="ml-1 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
          {selectedHospitalId && (
            <div className="mt-2 text-xs text-muted-foreground">
              {filteredDriversData.length} şoförün rotasında bu laboratuvar bulunuyor
            </div>
          )}
        </CardContent>
      </Card>

      {/* Driver Cards Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : filteredDriversData.length === 0 ? (
        <Card className="shadow-lg">
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Truck className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{selectedHospitalId ? 'Bu laboratuvarı içeren rota bulunamadı.' : 'Sistemde kayıtlı şoför bulunamadı.'}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredDriversData.map(({ driver, activeRoute, todayRoute, lastCompletedRoute, nextAssignedRoute, vehicle, displayRoute, highlightHospitalId }) => (
            <DriverKPICard
              key={driver.id}
              driver={driver}
              activeRoute={activeRoute}
              todayRoute={todayRoute}
              lastCompletedRoute={lastCompletedRoute}
              nextAssignedRoute={nextAssignedRoute}
              vehicle={vehicle}
              displayRoute={displayRoute}
              highlightHospitalId={highlightHospitalId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Rota Özet Kartı - Geçmiş/Gelecek rotalar için
function RouteSummaryMini({ route, label, variant, highlightHospitalId }: { route: RouteDoc; label: string; variant: 'past' | 'future'; highlightHospitalId?: string | null }) {
  const sortedStops = [...(route.stops || [])].sort((a, b) => a.order - b.order);
  const dateStr = route.dateISO ? format(new Date(route.dateISO), 'dd MMM yyyy', { locale: tr }) : '-';

  return (
    <div className={cn(
      "rounded-lg p-3 border",
      variant === 'past' ? "bg-green-500/5 border-green-500/20" : "bg-purple-500/5 border-purple-500/20"
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className={cn(
          "text-xs font-medium",
          variant === 'past' ? "text-green-600" : "text-purple-600"
        )}>{label}</span>
        <span className="text-xs text-muted-foreground">{dateStr}</span>
      </div>
      {/* Duraklar - Alt alta liste */}
      <div className="space-y-1">
        {sortedStops.map((stop, idx) => {
          const isHighlighted = highlightHospitalId && stop.hospitalId === highlightHospitalId;
          return (
            <div
              key={stop.hospitalId}
              className={cn(
                "flex items-center gap-2 text-xs rounded px-1 -mx-1 transition-all",
                isHighlighted && "bg-amber-500/20 ring-2 ring-amber-500/50"
              )}
            >
              <div
                className={cn(
                  "w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[8px] font-medium",
                  isHighlighted
                    ? "bg-amber-500 text-white"
                    : variant === 'past' ? "bg-green-500/20 text-green-700" : "bg-purple-500/20 text-purple-700"
                )}
              >
                {stop.order}
              </div>
              <span className={cn(
                "flex-1",
                isHighlighted ? "text-amber-700 font-semibold" : "text-muted-foreground"
              )}>
                {stop.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Tamamlanmış Rota Detay Görünümü
function CompletedRouteView({ route, highlightHospitalId }: { route: RouteDoc; highlightHospitalId?: string | null }) {
  const sortedStops = [...(route.stops || [])].sort((a, b) => a.order - b.order);

  // Rota tamamlama süresini hesapla
  const routeDuration = useMemo(() => {
    if (!sortedStops.length) return null;
    const firstDeparture = sortedStops[0]?.departedAt;
    const lastArrival = sortedStops[sortedStops.length - 1]?.arrivedAt;
    if (!firstDeparture || !lastArrival) return null;

    const durationMs = lastArrival.toMillis() - firstDeparture.toMillis();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return { hours, minutes, totalMinutes: Math.round(durationMs / (1000 * 60)) };
  }, [sortedStops]);

  return (
    <div className="space-y-3">
      {/* Tamamlanma Özeti */}
      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium text-green-600">Rota Tamamlandı</span>
          </div>
          {route.completedAt && (
            <span className="text-xs text-muted-foreground">
              {format(route.completedAt.toDate(), 'HH:mm', { locale: tr })}
            </span>
          )}
        </div>
        {routeDuration && (
          <div className="text-xs text-muted-foreground">
            Toplam süre: {routeDuration.hours > 0 ? `${routeDuration.hours} saat ` : ''}{routeDuration.minutes} dakika
          </div>
        )}
      </div>

      {/* Durak Detayları - Tümü gösterilir */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium border-b">
          Durak Detayları ({sortedStops.length} durak)
        </div>
        <div>
          {sortedStops.map((stop, idx) => {
            const isHighlighted = highlightHospitalId && stop.hospitalId === highlightHospitalId;
            return (
              <div
                key={stop.hospitalId}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-0 transition-all",
                  isHighlighted && "bg-amber-500/20 ring-2 ring-inset ring-amber-500/50"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full text-white flex items-center justify-center text-[8px] flex-shrink-0",
                  isHighlighted ? "bg-amber-500" : "bg-green-500"
                )}>
                  {stop.order}
                </div>
                <span className={cn("flex-1", isHighlighted && "text-amber-700 font-semibold")}>{stop.name}</span>
                <div className="flex items-center gap-2 text-muted-foreground flex-shrink-0">
                  {stop.arrivedAt && (
                    <span className="flex items-center gap-1">
                      <Flag className="h-2.5 w-2.5 text-green-500" />
                      {format(stop.arrivedAt.toDate(), 'HH:mm')}
                    </span>
                  )}
                  {stop.departedAt && idx < sortedStops.length - 1 && (
                    <span className="flex items-center gap-1">
                      <LogOut className="h-2.5 w-2.5 text-blue-500" />
                      {format(stop.departedAt.toDate(), 'HH:mm')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Bekleyen (Aktif Edilmemiş) Rota Görünümü
function PendingRouteView({ route, highlightHospitalId }: { route: RouteDoc; highlightHospitalId?: string | null }) {
  const sortedStops = [...(route.stops || [])].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-3">
      {/* Aktif Değil Uyarısı */}
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-yellow-600" />
          <span className="text-sm font-medium text-yellow-600">Rota Aktif Edilmedi</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Bu rota bugün için planlanmış ancak henüz başlatılmadı.
        </p>
      </div>

      {/* Planlanan Duraklar - Tümü gösterilir */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium border-b">
          Planlanan Duraklar ({sortedStops.length} durak)
        </div>
        <div>
          {sortedStops.map((stop) => {
            const isHighlighted = highlightHospitalId && stop.hospitalId === highlightHospitalId;
            return (
              <div
                key={stop.hospitalId}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-0 transition-all",
                  isHighlighted && "bg-amber-500/20 ring-2 ring-inset ring-amber-500/50"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full flex items-center justify-center text-[8px] flex-shrink-0 border",
                  isHighlighted
                    ? "bg-amber-500 text-white border-amber-600"
                    : "bg-yellow-500/20 text-yellow-700 border-yellow-500/30"
                )}>
                  {stop.order}
                </div>
                <span className={cn("flex-1", isHighlighted && "text-amber-700 font-semibold")}>{stop.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Bugün Rota Yok - Geçmiş ve Gelecek Rota Bilgisi
function NoRouteView({ lastCompletedRoute, nextAssignedRoute, highlightHospitalId }: { lastCompletedRoute: RouteDoc | null; nextAssignedRoute: RouteDoc | null; highlightHospitalId?: string | null }) {
  return (
    <div className="space-y-3">
      <div className="text-center py-2 text-muted-foreground">
        <MapPin className="h-6 w-6 mx-auto mb-1 opacity-50" />
        <p className="text-xs">Bugün için atanmış rota yok</p>
      </div>

      {lastCompletedRoute && (
        <RouteSummaryMini route={lastCompletedRoute} label="Son Tamamlanan Rota" variant="past" highlightHospitalId={highlightHospitalId} />
      )}

      {nextAssignedRoute && (
        <RouteSummaryMini route={nextAssignedRoute} label="Sonraki Atanan Rota" variant="future" highlightHospitalId={highlightHospitalId} />
      )}

      {!lastCompletedRoute && !nextAssignedRoute && (
        <div className="text-center text-xs text-muted-foreground py-2">
          Geçmiş veya gelecek rota kaydı bulunamadı.
        </div>
      )}
    </div>
  );
}

// Şoför KPI Kartı Bileşeni
function DriverKPICard({
  driver,
  activeRoute,
  todayRoute,
  lastCompletedRoute,
  nextAssignedRoute,
  vehicle,
  displayRoute,
  highlightHospitalId
}: {
  driver: AppUser;
  activeRoute: RouteDoc | null;
  todayRoute: RouteDoc | null;
  lastCompletedRoute: RouteDoc | null;
  nextAssignedRoute: RouteDoc | null;
  vehicle: Vehicle | null;
  displayRoute?: RouteDoc | null;
  highlightHospitalId?: string | null;
}) {
  const driverName = (driver as any).displayName || (driver as any).name || (driver as any).email || 'İsimsiz Şoför';

  // Filtre aktifse ve farklı bir rota gösterilecekse
  const isFilteredView = !!highlightHospitalId && !!displayRoute;
  const routeToShow = isFilteredView ? displayRoute : activeRoute;

  // Segment durumlarını hesapla (sadece aktif rotalar için)
  const segmentStates = useMemo(() => {
    if (!routeToShow?.stops?.length) return [];
    const sortedStops = [...routeToShow.stops].sort((a, b) => a.order - b.order);
    const arr: ('completed' | 'current' | 'future')[] = [];
    for (let i = 0; i < Math.max(0, sortedStops.length - 1); i++) {
      const from = sortedStops[i];
      const to = sortedStops[i + 1];
      const completed = !!from.departedAt && !!to.arrivedAt;
      const current = !!from.departedAt && !to.arrivedAt;
      arr.push(completed ? 'completed' : current ? 'current' : 'future');
    }
    return arr;
  }, [routeToShow]);

  // Mevcut durak bilgileri (sadece aktif rotalar için)
  const currentStopInfo = useMemo(() => {
    if (!activeRoute?.stops?.length) return null;
    const sortedStops = [...activeRoute.stops].sort((a, b) => a.order - b.order);

    // Aktif olarak gidilen durak (yolda)
    for (let i = 0; i < sortedStops.length - 1; i++) {
      if (sortedStops[i].departedAt && !sortedStops[i + 1].arrivedAt) {
        return {
          from: sortedStops[i],
          to: sortedStops[i + 1],
          currentIndex: i + 1,
          total: sortedStops.length,
          onTheRoad: true // Yolda
        };
      }
    }

    // Bir durağa varılmış ama çıkış yapılmamış (çıkış bekleniyor)
    for (let i = 0; i < sortedStops.length - 1; i++) {
      if (sortedStops[i].arrivedAt && !sortedStops[i].departedAt) {
        return {
          from: null,
          to: sortedStops[i],
          nextStop: sortedStops[i + 1],
          currentIndex: i,
          total: sortedStops.length,
          waitingDeparture: true // Çıkış bekleniyor
        };
      }
    }

    // Henüz başlamamış (ilk duraktan çıkış bekleniyor)
    if (!sortedStops[0].departedAt) {
      return {
        from: null,
        to: sortedStops[0],
        nextStop: sortedStops[1] || null,
        currentIndex: 0,
        total: sortedStops.length,
        waitingStart: true // İlk çıkış bekleniyor
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

  // Durum belirleme
  const routeStatus = useMemo(() => {
    if (activeRoute?.status === 'in_progress') return 'active';
    if (activeRoute?.status === 'open') return 'waiting';
    if (todayRoute?.status === 'completed') return 'completed';
    if (todayRoute?.status === 'open') return 'pending'; // Bugün için atanmış ama aktif değil
    return 'noRoute';
  }, [activeRoute, todayRoute]);

  return (
    <Card className={cn(
      "shadow-lg transition-all duration-300 relative overflow-visible",
      vehicle && "mt-16", // Araç ikonu için üst boşluk (büyük ikon)
      routeStatus === 'active' && "ring-2 ring-blue-500/50",
      routeStatus === 'completed' && "ring-2 ring-green-500/30",
      routeStatus === 'pending' && "ring-2 ring-yellow-500/30",
      routeStatus === 'noRoute' && "opacity-70"
    )}>
      {/* Vehicle Icon - Sol Üst, yarısı kartın dışında + Şoför ismi ve plaka sağda */}
      {vehicle && (
        <div className="absolute -top-12 left-4 z-10 flex items-end gap-3">
          {vehicle.icon ? (
            <div className="relative w-32 h-32 drop-shadow-lg flex-shrink-0">
              <Image
                src={vehicle.icon}
                alt={`${vehicle.marka} ${vehicle.model}`}
                fill
                className="object-contain"
              />
            </div>
          ) : (
            <div
              className="w-32 h-32 rounded-full bg-slate-800 flex items-center justify-center shadow-lg border-2 border-background flex-shrink-0"
            >
              <Car className="h-16 w-16 text-white" />
            </div>
          )}
          {/* Şoför ismi ve plaka - resmin sağında */}
          <div className="pb-4 flex flex-col gap-1">
            <span className="text-base font-semibold text-foreground whitespace-nowrap">
              {driverName}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-900/90 text-white text-xs font-mono whitespace-nowrap shadow w-fit">
              {vehicle.plaka}
            </span>
          </div>
        </div>
      )}

      {/* Driver Header */}
      <CardHeader className={cn("pb-2", vehicle && "pt-20 pl-4")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Kamyonet ikonu sadece araç resmi yoksa göster */}
            {!vehicle?.icon && (
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                routeStatus === 'active' && "bg-blue-500 text-white",
                routeStatus === 'waiting' && "bg-yellow-500 text-white",
                routeStatus === 'completed' && "bg-green-500 text-white",
                routeStatus === 'pending' && "bg-yellow-500/50 text-yellow-700",
                routeStatus === 'noRoute' && "bg-muted text-muted-foreground"
              )}>
                <Truck className="h-5 w-5" />
              </div>
            )}
            {/* Şoför ismi sadece araç resmi yoksa burada göster */}
            {!vehicle?.icon && (
              <div>
                <h3 className="font-semibold text-base">{driverName}</h3>
                {(todayRoute || activeRoute) && (
                  <span className="text-xs text-muted-foreground">
                    {format(new Date((todayRoute || activeRoute)!.dateISO), 'dd MMM yyyy', { locale: tr })}
                  </span>
                )}
              </div>
            )}
          </div>
          <Badge variant={
            routeStatus === 'active' ? 'default' :
            routeStatus === 'completed' ? 'default' :
            routeStatus === 'waiting' || routeStatus === 'pending' ? 'secondary' : 'outline'
          } className={cn(
            routeStatus === 'active' && "bg-blue-500",
            routeStatus === 'completed' && "bg-green-500",
            routeStatus === 'pending' && "bg-yellow-500/50 text-yellow-800"
          )}>
            {routeStatus === 'active' ? 'Aktif' :
             routeStatus === 'waiting' ? 'Bekliyor' :
             routeStatus === 'completed' ? 'Tamamlandı' :
             routeStatus === 'pending' ? 'Aktif Değil' : 'Rotasız'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Aktif Rota Görünümü */}
        {(routeStatus === 'active' || routeStatus === 'waiting') && activeRoute && (
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
                    routeStatus === 'active'
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
                "rounded-lg p-3 border relative overflow-hidden",
                (currentStopInfo.waitingDeparture || currentStopInfo.waitingStart)
                  ? "bg-yellow-500/10 border-yellow-500/20"
                  : "bg-blue-500/10 border-blue-500/20"
              )}>
                {/* Flow animation for on the road state */}
                {currentStopInfo.onTheRoad && (
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-400/20 to-transparent animate-flow" />
                  </div>
                )}

                {currentStopInfo.waitingDeparture ? (
                  <div className="relative z-10 space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-yellow-600" />
                      <span className="text-sm">
                        <span className="text-muted-foreground">Çıkış bekleniyor: </span>
                        <span className="font-medium text-yellow-700">{currentStopInfo.to.name}</span>
                      </span>
                    </div>
                    {currentStopInfo.nextStop && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Navigation className="h-3 w-3" />
                        <span>Sonraki durak: {currentStopInfo.nextStop.name}</span>
                      </div>
                    )}
                  </div>
                ) : currentStopInfo.waitingStart ? (
                  <div className="relative z-10 space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-yellow-600" />
                      <span className="text-sm">
                        <span className="text-muted-foreground">Başlangıç bekleniyor: </span>
                        <span className="font-medium text-yellow-700">{currentStopInfo.to.name}</span>
                      </span>
                    </div>
                    {currentStopInfo.nextStop && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Navigation className="h-3 w-3" />
                        <span>Sonraki durak: {currentStopInfo.nextStop.name}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="relative z-10 space-y-2">
                    <div className="flex items-center gap-2">
                      <Navigation className="h-4 w-4 text-blue-600 animate-pulse" />
                      <span className="text-sm font-medium text-blue-600">
                        Varış: {currentStopInfo.to.name}
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

            {/* Durak Listesi - Tümü alt alta gösterilir, varış ve çıkış saatleriyle */}
            <div className="border-t pt-3">
              <div className="space-y-1">
                {activeRoute.stops?.sort((a, b) => a.order - b.order).map((stop, index, sortedStops) => {
                  const isCompleted = stop.arrivedAt || (index === 0 && stop.departedAt);
                  const isCurrent = !isCompleted && (
                    (index === 0 && !stop.departedAt) ||
                    (index > 0 && segmentStates[index - 1] === 'current')
                  );
                  const isHighlighted = highlightHospitalId && stop.hospitalId === highlightHospitalId;
                  const isLastStop = index === sortedStops.length - 1;

                  return (
                    <div
                      key={stop.hospitalId}
                      className={cn(
                        "flex items-center gap-2 text-xs rounded px-1 -mx-1 transition-all",
                        isHighlighted && "bg-amber-500/20 ring-2 ring-amber-500/50"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded-full flex items-center justify-center text-[8px] flex-shrink-0",
                        isHighlighted && "bg-amber-500 text-white",
                        !isHighlighted && isCompleted && "bg-green-500 text-white",
                        !isHighlighted && isCurrent && "bg-blue-500 text-white animate-pulse",
                        !isHighlighted && !isCompleted && !isCurrent && "bg-muted border border-border"
                      )}>
                        {isCompleted && !isHighlighted && <Check className="h-2.5 w-2.5" />}
                        {isCurrent && !isHighlighted && <Navigation className="h-2.5 w-2.5" />}
                        {((!isCompleted && !isCurrent) || isHighlighted) && <span>{stop.order}</span>}
                      </div>
                      <span className={cn(
                        "flex-1",
                        isHighlighted && "text-amber-700 font-semibold",
                        !isHighlighted && isCompleted && "text-green-600",
                        !isHighlighted && isCurrent && "text-blue-600 font-medium",
                        !isHighlighted && !isCompleted && !isCurrent && "text-muted-foreground"
                      )}>
                        {stop.name}
                      </span>
                      {/* Varış ve Çıkış saatleri */}
                      <div className="flex items-center gap-2 text-muted-foreground flex-shrink-0">
                        {stop.arrivedAt && (
                          <span className="flex items-center gap-0.5 text-[10px]">
                            <Flag className="h-2.5 w-2.5 text-green-500" />
                            {format(stop.arrivedAt.toDate(), 'HH:mm')}
                          </span>
                        )}
                        {stop.departedAt && !isLastStop && (
                          <span className="flex items-center gap-0.5 text-[10px]">
                            <LogOut className="h-2.5 w-2.5 text-blue-500" />
                            {format(stop.departedAt.toDate(), 'HH:mm')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Filtreli Rota Görünümü - Aktif rota dışındaki bir rota gösterilecekse */}
        {isFilteredView && displayRoute && displayRoute.id !== activeRoute?.id && (
          <div className="space-y-3">
            {/* Filtre bilgisi */}
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-600">Filtrelenmiş Rota</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {format(new Date(displayRoute.dateISO), 'dd MMMM yyyy', { locale: tr })} tarihli rota
              </p>
            </div>

            {/* Duraklar */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium border-b">
                Rota Durakları ({displayRoute.stops?.length || 0} durak)
              </div>
              <div>
                {displayRoute.stops?.sort((a, b) => a.order - b.order).map((stop) => {
                  const isHighlighted = highlightHospitalId && stop.hospitalId === highlightHospitalId;
                  return (
                    <div
                      key={stop.hospitalId}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-0 transition-all",
                        isHighlighted && "bg-amber-500/20 ring-2 ring-inset ring-amber-500/50"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded-full flex items-center justify-center text-[8px] flex-shrink-0",
                        isHighlighted
                          ? "bg-amber-500 text-white"
                          : "bg-purple-500/20 text-purple-700"
                      )}>
                        {stop.order}
                      </div>
                      <span className={cn("flex-1", isHighlighted && "text-amber-700 font-semibold")}>{stop.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Tamamlanmış Rota Görünümü */}
        {routeStatus === 'completed' && todayRoute && !isFilteredView && (
          <CompletedRouteView route={todayRoute} highlightHospitalId={highlightHospitalId} />
        )}

        {/* Bekleyen (Aktif Edilmemiş) Rota Görünümü */}
        {routeStatus === 'pending' && todayRoute && !isFilteredView && (
          <PendingRouteView route={todayRoute} highlightHospitalId={highlightHospitalId} />
        )}

        {/* Bugün Rota Yok Görünümü */}
        {routeStatus === 'noRoute' && !isFilteredView && (
          <NoRouteView lastCompletedRoute={lastCompletedRoute} nextAssignedRoute={nextAssignedRoute} highlightHospitalId={highlightHospitalId} />
        )}
      </CardContent>
    </Card>
  );
}
