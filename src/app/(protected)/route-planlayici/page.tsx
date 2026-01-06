// app/(protected)/route-planlayici/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { MapIcon, History, Flag, LogOut, Plus, Truck, ListOrdered, MapPin, Eye, Navigation, Wifi, WifiOff, Locate, LocateOff, AlertCircle } from 'lucide-react';
import RouteProgressView from './route-progress-view';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import {
  collection, doc, getDocs, onSnapshot, query,
  serverTimestamp, Timestamp, updateDoc, where
} from 'firebase/firestore';
import type { User as AppUser } from '@/lib/types';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useGeofencing, type GeofenceStop } from '@/hooks/useGeofencing';
import { cn } from '@/lib/utils';

// Yönetim yetkisi olan roller
const MANAGEMENT_ROLES = ['admin', 'lojistik_sorumlusu'];

// Google Maps Directions URL helpers
type LatLng = { lat: number; lng: number };
const enc = (v: string) => encodeURIComponent(v);

function gmDirectionsWeb(origin: LatLng, destination: LatLng, waypoints: LatLng[] = []) {
  const base = 'https://www.google.com/maps/dir/?api=1';
  const originStr = `${origin.lat},${origin.lng}`;
  const destStr = `${destination.lat},${destination.lng}`;
  const wp = waypoints.length ? `&waypoints=${enc(waypoints.map(w => `${w.lat},${w.lng}`).join('|'))}` : '';
  return `${base}&travelmode=driving&origin=${enc(originStr)}&destination=${enc(destStr)}${wp}`;
}

function splitIntoSegments(points: LatLng[], maxPointsPerSegment = 25): LatLng[][] {
  if (points.length <= maxPointsPerSegment) return [points];
  const segments: LatLng[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const endExclusive = Math.min(start + maxPointsPerSegment, points.length);
    const slice = points.slice(start, endExclusive);
    segments.push(slice);
    if (endExclusive === points.length) break;
    start = endExclusive - 1;
  }
  return segments;
}

function openRouteInGoogleMaps(stopsOrdered: { lat:number; lng:number }[]) {
  if (!stopsOrdered || stopsOrdered.length < 2) return;
  const points = stopsOrdered.map(s => ({ lat: Number(s.lat), lng: Number(s.lng) }));
  const segments = splitIntoSegments(points, 25);

  const openSegment = (seg: LatLng[]) => {
    const origin = seg[0];
    const destination = seg[seg.length - 1];
    const waypoints = seg.slice(1, seg.length - 1);
    const url = gmDirectionsWeb(origin, destination, waypoints);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  openSegment(segments[0]);
  return segments;
}


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
  activatedAt?: Timestamp | null;
  activatedBy?: string | null;
  stops: RouteStop[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
};

const toDayKey = (d: Date) => Number(format(d, 'yyyyMMdd'));
const cloneStops = (stops: RouteStop[]) => stops.map(s => ({ ...s }));

export default function RoutePlanlayiciPage() {
  const { toast } = useToast();
  const { currentUser, currentUserProfile } = useAuth();

  const [myUid, setMyUid] = useState<string>('');
  const [myRole, setMyRole] = useState<string>('');
  const [drivers, setDrivers] = useState<AppUser[]>([]);
  const [viewDriverId, setViewDriverId] = useState<string>('');
  const [viewDate, setViewDate] = useState<Date>(new Date());
  const [activeRoute, setActiveRoute] = useState<RouteDoc | null>(null);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);

  // Şoför için atanmış rotalar modalı
  const [showRoutesModal, setShowRoutesModal] = useState(false);
  const [assignedRoutes, setAssignedRoutes] = useState<RouteDoc[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  // Canlı konum takibi
  const [liveTrackingEnabled, setLiveTrackingEnabled] = useState(false);

  // Yönetim yetkisi kontrolü
  const canManageRoutes = useMemo(() => {
    return MANAGEMENT_ROLES.includes(myRole);
  }, [myRole]);

  // Kullanıcının şoför olup olmadığını kontrol et
  const isDriver = myRole === 'driver';

  // Şoför harici tüm kullanıcılar basitleştirilmiş görünümü görecek
  const showSimplifiedView = myRole && !isDriver;

  useEffect(() => {
    setMyUid(currentUser?.uid || '');
    setMyRole((currentUserProfile as any)?.role || '');
  }, [currentUser, currentUserProfile]);

  // Şoför girişinde otomatik olarak kendi rotasını yükle
  useEffect(() => {
    if (isDriver && myUid && !viewDriverId) {
      setViewDriverId(myUid);
    }
  }, [isDriver, myUid, viewDriverId]);

  useEffect(() => {
    // Sadece yöneticiler şoför listesini çeksin
    if (!canManageRoutes) return;

    (async () => {
      try {
        const uSnap = await getDocs(collection(db, 'users'));
        const ds = uSnap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)).filter(u => (u as any).role === 'driver');
        setDrivers(ds);
      } catch {
        toast({ title: 'Veri Hatası', description: 'Sürücüler alınamadı.', variant: 'destructive' });
      }
    })();
  }, [toast, canManageRoutes]);

  useEffect(() => {
    if (!activeRouteId) {
      if (activeRoute) setActiveRoute(null);
      return;
    }
    const ref = doc(db, 'routes', activeRouteId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setActiveRoute({ id: snap.id, ...(snap.data() as any) } as RouteDoc);
      } else {
        setActiveRoute(null);
      }
    });
    return () => unsub();
  }, [activeRouteId, activeRoute]);

  const fetchRoute = useCallback(async (driverId: string, day: Date) => {
    if (!driverId) { setActiveRoute(null); setActiveRouteId(null); return; }
    const dayKey = toDayKey(day);
    const qy = query(collection(db, 'routes'), where('driverId', '==', driverId), where('date', '==', dayKey));
    const snap = await getDocs(qy);
    if (snap.empty) { setActiveRoute(null); setActiveRouteId(null); return; }
    const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as RouteDoc[];
    const active = rows.find(r => r.isActive && r.status !== 'completed');
    const open = rows.filter(r => r.status !== 'completed').sort((a, b) => (a.sequence || 0) - (b.sequence || 0))[0];
    const choose = active || open || null;
    if (choose) {
      setActiveRouteId(choose.id);
    } else {
      setActiveRoute(null);
      setActiveRouteId(null);
    }
  }, []);

  useEffect(() => {
    if (viewDriverId) fetchRoute(viewDriverId, viewDate);
    else { setActiveRoute(null); setActiveRouteId(null); }
  }, [viewDriverId, viewDate, fetchRoute]);

  const lastArrivedIndex = useMemo(() => {
    if (!activeRoute?.stops?.length) return -1;
    let idx = -1;
    activeRoute.stops.forEach((s, i) => { if (s.arrivedAt) idx = i; });
    return idx;
  }, [activeRoute]);

  const currentLegIndex = useMemo(() => {
    if (!activeRoute?.stops?.length) return -1;
    for (let i = 0; i < activeRoute.stops.length - 1; i++) {
      if (activeRoute.stops[i].departedAt && !activeRoute.stops[i + 1].arrivedAt) return i;
    }
    return -1;
  }, [activeRoute]);

  const segmentStates: ('completed' | 'current' | 'future')[] = useMemo(() => {
    const n = activeRoute?.stops?.length || 0;
    const arr: ('completed' | 'current' | 'future')[] = [];
    for (let i = 0; i < Math.max(0, n - 1); i++) {
      const from = activeRoute!.stops[i];
      const to = activeRoute!.stops[i + 1];
      const completed = !!from.departedAt && !!to.arrivedAt;
      const current = !!from.departedAt && !to.arrivedAt;
      arr.push(completed ? 'completed' : current ? 'current' : 'future');
    }
    return arr;
  }, [activeRoute]);

  const canStartLeg = useMemo(() => {
    if (!activeRoute?.stops || activeRoute.stops.length < 2) return false;
    if (currentLegIndex >= 0) return false;
    const k = lastArrivedIndex >= 0 ? lastArrivedIndex : 0;
    return k < activeRoute.stops.length - 1;
  }, [activeRoute, currentLegIndex, lastArrivedIndex]);

  const canArrive = useMemo(() => currentLegIndex >= 0, [currentLegIndex]);
  const isDriverOwner = !!(activeRoute && myUid && activeRoute.driverId === myUid && activeRoute.status !== 'completed');

  // Geofencing için durakları hazırla
  const geofenceStops: GeofenceStop[] = useMemo(() => {
    if (!activeRoute?.stops) return [];
    return activeRoute.stops.map((s, i) => ({
      id: s.hospitalId,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      order: s.order,
      hasArrived: !!s.arrivedAt,
      hasDeparted: !!s.departedAt,
    }));
  }, [activeRoute?.stops]);

  // Şu anki hedef durak indeksi (varış için)
  const currentTargetIndex = useMemo(() => {
    if (!activeRoute?.stops?.length) return -1;

    // Yolda: bir sonraki durak (currentLegIndex + 1)
    if (currentLegIndex >= 0) return currentLegIndex + 1;

    // İlk durağa henüz varılmadıysa: ilk durak hedef
    if (lastArrivedIndex === -1) {
      const firstStop = activeRoute.stops[0];
      if (!firstStop?.arrivedAt) return 0;
    }

    // Bir durağa varılmış ve çıkış bekliyor: bir sonraki durak hedef
    if (canStartLeg && lastArrivedIndex >= 0) {
      const nextIdx = lastArrivedIndex + 1;
      if (nextIdx < activeRoute.stops.length) return nextIdx;
    }

    return -1;
  }, [activeRoute?.stops, currentLegIndex, canStartLeg, lastArrivedIndex]);

  // Şu an bir durakta mı (varış yapılmış ama ayrılma yapılmamış)
  const isCurrentlyAtStop = useMemo(() => {
    if (!activeRoute?.stops?.length) return false;
    const k = lastArrivedIndex >= 0 ? lastArrivedIndex : 0;
    const stop = activeRoute.stops[k];
    return !!(stop?.arrivedAt && !stop?.departedAt);
  }, [activeRoute?.stops, lastArrivedIndex]);

  // Otomatik varış handler
  const handleAutoArrival = useCallback(async (stop: GeofenceStop) => {
    if (!activeRoute || !isDriverOwner) return;

    // Hedef durak indeksini belirle
    let toIdx = -1;

    // Yoldaysa: currentLegIndex + 1
    if (currentLegIndex >= 0) {
      toIdx = currentLegIndex + 1;
    }
    // İlk durağa henüz varılmadıysa: ilk durak
    else if (lastArrivedIndex === -1 && !activeRoute.stops[0]?.arrivedAt) {
      toIdx = 0;
    }
    // Bir durağa varılmış, çıkış yapılmış, yoldaysa
    else if (lastArrivedIndex >= 0 && activeRoute.stops[lastArrivedIndex]?.departedAt) {
      toIdx = lastArrivedIndex + 1;
    }

    if (toIdx < 0 || toIdx >= activeRoute.stops.length) return;
    if (activeRoute.stops[toIdx]?.hospitalId !== stop.id) return; // Doğru durak değil
    if (activeRoute.stops[toIdx]?.arrivedAt) return; // Zaten varılmış

    toast({
      title: '📍 Otomatik Varış',
      description: `${stop.name} konumuna ulaştınız!`,
    });

    // Varış işlemini gerçekleştir
    const isFinal = toIdx === activeRoute.stops.length - 1;
    const newStops = cloneStops(activeRoute.stops);
    newStops[toIdx] = { ...newStops[toIdx], arrivedAt: Timestamp.now() };

    try {
      const update: Record<string, any> = { status: isFinal ? 'completed' : 'in_progress', stops: newStops, updatedAt: serverTimestamp() };
      if (isFinal) {
        update.completedAt = serverTimestamp();
        update.isActive = false;
      }
      await updateDoc(doc(db, 'routes', activeRoute.id), update);
      if (isFinal) {
        setActiveRoute(null);
        setActiveRouteId(null);
        toast({ title: '🎉 Rota tamamlandı', description: 'Tüm duraklara ulaşıldı!' });
      }
    } catch {
      toast({ title: 'Hata', description: 'Otomatik varış kaydedilemedi.', variant: 'destructive' });
    }
  }, [activeRoute, isDriverOwner, currentLegIndex, lastArrivedIndex, toast]);

  // Otomatik ayrılma handler
  const handleAutoDeparture = useCallback(async (stop: GeofenceStop) => {
    if (!activeRoute || !isDriverOwner || !canStartLeg) return;
    const k = lastArrivedIndex >= 0 ? lastArrivedIndex : 0;
    if (activeRoute.stops[k]?.hospitalId !== stop.id) return; // Doğru durak değil

    toast({
      title: '🚗 Otomatik Çıkış',
      description: `${stop.name} konumundan ayrıldınız!`,
    });

    // Çıkış işlemini gerçekleştir
    const newStops = cloneStops(activeRoute.stops);
    newStops[k] = { ...newStops[k], departedAt: Timestamp.now() };

    try {
      await updateDoc(doc(db, 'routes', activeRoute.id), { status: 'in_progress', stops: newStops, updatedAt: serverTimestamp() });
    } catch {
      toast({ title: 'Hata', description: 'Otomatik çıkış kaydedilemedi.', variant: 'destructive' });
    }
  }, [activeRoute, isDriverOwner, canStartLeg, lastArrivedIndex, toast]);

  // Geofencing hook
  const geofencing = useGeofencing(
    geofenceStops,
    currentTargetIndex,
    isCurrentlyAtStop,
    { enabled: liveTrackingEnabled && isDriverOwner },
    {
      onAutoArrival: handleAutoArrival,
      onAutoDeparture: handleAutoDeparture,
    }
  );

  // Mesafeyi Firestore'a kaydet (izlem panelinde göstermek için)
  const lastDistanceUpdateRef = React.useRef<number>(0);
  useEffect(() => {
    if (!liveTrackingEnabled || !activeRoute || !isDriverOwner) return;
    if (geofencing.distanceToTarget === null) return;

    // Her 5 saniyede bir güncelle (çok sık yazma yapmamak için)
    const now = Date.now();
    if (now - lastDistanceUpdateRef.current < 5000) return;
    lastDistanceUpdateRef.current = now;

    // Sadece yolda iken veya ilk durağa yaklaşırken güncelle
    const targetIdx = currentTargetIndex >= 0 ? currentTargetIndex : 0;
    if (targetIdx >= activeRoute.stops.length) return;

    const targetStopName = activeRoute.stops[targetIdx]?.name || '';

    // Firestore'a kaydet
    updateDoc(doc(db, 'routes', activeRoute.id), {
      liveTracking: {
        distanceToTarget: geofencing.distanceToTarget,
        targetStopIndex: targetIdx,
        targetStopName,
        isApproaching: geofencing.isApproaching,
        isInRange: geofencing.isInRange,
        lastUpdate: serverTimestamp(),
      },
    }).catch(() => {
      // Hata olursa sessizce geç (offline durumunda otomatik senkronize edilecek)
    });
  }, [liveTrackingEnabled, activeRoute, isDriverOwner, geofencing.distanceToTarget, geofencing.isApproaching, geofencing.isInRange, currentTargetIndex]);

  // Canlı takip toggle
  const toggleLiveTracking = useCallback(async () => {
    if (liveTrackingEnabled) {
      geofencing.stopTracking();
      setLiveTrackingEnabled(false);
      toast({ title: 'Konum takibi durduruldu' });
    } else {
      const success = await geofencing.startTracking();
      if (success) {
        setLiveTrackingEnabled(true);
        toast({
          title: 'Konum takibi başlatıldı',
          description: 'Konumlara yaklaştığınızda otomatik varış/ayrılma kaydedilecek.',
        });
      } else {
        toast({
          title: 'Konum izni gerekli',
          description: 'Lütfen tarayıcı ayarlarından konum iznini etkinleştirin.',
          variant: 'destructive',
        });
      }
    }
  }, [liveTrackingEnabled, geofencing, toast]);

  const departFromLabel = useMemo(() => {
    if (!activeRoute?.stops?.length) return '—';
    if (currentLegIndex >= 0) {
      const s = activeRoute.stops[currentLegIndex];
      return `${s?.name || '—'}'den çıkıldı`;
    }
    const k = lastArrivedIndex >= 0 ? lastArrivedIndex : 0;
    if (k >= activeRoute.stops.length - 1) return '—';
    return `${activeRoute.stops[k].name}'den ayrıl`;
  }, [activeRoute, currentLegIndex, lastArrivedIndex]);

  const arriveToLabel = useMemo(() => {
    if (!activeRoute?.stops?.length || currentLegIndex < 0) return '—';
    const target = activeRoute.stops[currentLegIndex + 1];
    return `${target?.name || '—'}'ye varıldı`;
  }, [activeRoute, currentLegIndex]);

  const handleDepart = async () => {
    if (!activeRoute || !isDriverOwner || !canStartLeg) return;
    const k = lastArrivedIndex >= 0 ? lastArrivedIndex : 0;
    const newStops = cloneStops(activeRoute.stops);
    newStops[k] = { ...newStops[k], departedAt: Timestamp.now() };
    try {
      await updateDoc(doc(db, 'routes', activeRoute.id), { status: 'in_progress', stops: newStops, updatedAt: serverTimestamp() });
    } catch { toast({ title: 'İşlem Hatası', description: 'Çıkış kaydedilemedi.', variant: 'destructive' }); }
  };

  const handleArrive = async () => {
    if (!activeRoute || !isDriverOwner || currentLegIndex < 0) return;
    const toIdx = currentLegIndex + 1;
    const isFinal = toIdx === activeRoute.stops.length - 1;
    const newStops = cloneStops(activeRoute.stops);
    newStops[toIdx] = { ...newStops[toIdx], arrivedAt: Timestamp.now() };
    try {
      const update: Record<string, any> = { status: isFinal ? 'completed' : 'in_progress', stops: newStops, updatedAt: serverTimestamp() };
      if (isFinal) {
        update.completedAt = serverTimestamp();
        update.isActive = false;
      }
      await updateDoc(doc(db, 'routes', activeRoute.id), update);
      if (isFinal) {
        setActiveRoute(null);
        setActiveRouteId(null);
        toast({ title: 'Rota tamamlandı', description: 'Tüm duraklara ulaşıldı.' });
      }
    } catch { toast({ title: 'İşlem Hatası', description: 'Varış kaydedilemedi.', variant: 'destructive' }); }
  };

  // Şoförün atanmış rotalarını getir
  const fetchAssignedRoutes = useCallback(async () => {
    if (!myUid) return;
    setLoadingRoutes(true);
    try {
      const qy = query(
        collection(db, 'routes'),
        where('driverId', '==', myUid),
        where('status', 'in', ['open', 'in_progress'])
      );
      const snap = await getDocs(qy);
      const routes = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }) as RouteDoc)
        .sort((a, b) => b.date - a.date); // En yeni tarih önce
      setAssignedRoutes(routes);
    } catch {
      toast({ title: 'Hata', description: 'Rotalar yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoadingRoutes(false);
    }
  }, [myUid, toast]);

  // Modal açıldığında rotaları getir
  const handleOpenRoutesModal = () => {
    setShowRoutesModal(true);
    fetchAssignedRoutes();
  };

  // Rota seç ve önizlemeye yükle
  const handleSelectRoute = (route: RouteDoc) => {
    setActiveRouteId(route.id);
    setShowRoutesModal(false);
  };

  // Şoför harici tüm kullanıcılar için basitleştirilmiş görünüm (3 büyük buton)
  if (showSimplifiedView) {
    return (
      <Card className="shadow-lg">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2">
            <MapIcon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            <CardTitle className="text-base sm:text-lg md:text-xl">Route Planlayıcı</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center items-center py-8 sm:py-12">
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 w-full max-w-3xl justify-center">
              <Link href="/route-planlayici/olustur" className="block sm:w-1/5 min-w-[140px]">
                <Button size="lg" className="w-full h-28 sm:h-36 flex flex-col gap-3 text-base sm:text-lg">
                  <Plus className="h-10 w-10 sm:h-12 sm:w-12" />
                  Rota Oluştur
                </Button>
              </Link>
              <Link href="/route-planlayici/gecmis" className="block sm:w-1/5 min-w-[140px]">
                <Button variant="outline" size="lg" className="w-full h-28 sm:h-36 flex flex-col gap-3 text-base sm:text-lg">
                  <History className="h-10 w-10 sm:h-12 sm:w-12" />
                  Geçmiş
                </Button>
              </Link>
              <Link href="/route-planlayici/izlem" className="block sm:w-1/5 min-w-[140px]">
                <Button variant="secondary" size="lg" className="w-full h-28 sm:h-36 flex flex-col gap-3 text-base sm:text-lg">
                  <Eye className="h-10 w-10 sm:h-12 sm:w-12" />
                  Şoför İzlem
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sadece şoförler bu görünümü görecek
  return (
    <Card className="shadow-lg">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <CardTitle className="text-base sm:text-lg md:text-xl">Rotam</CardTitle>
        </div>
        {/* Şoförler için rota seçim butonu */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenRoutesModal}
          className="text-xs sm:text-sm"
        >
          <ListOrdered className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Rotalarım</span>
        </Button>
      </CardHeader>

      <CardContent className="space-y-3 sm:space-y-4 relative">
        {/* Canlı Konum Takibi Durumu */}
        {activeRoute && isDriverOwner && (
          <div className={cn(
            "rounded-xl p-3 border transition-all",
            liveTrackingEnabled
              ? !geofencing.isOnline
                ? "bg-red-500/10 border-red-500/30"
                : geofencing.isBackgroundMode
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-emerald-500/10 border-emerald-500/30"
              : "bg-muted/50 border-border"
          )}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                  liveTrackingEnabled
                    ? !geofencing.isOnline
                      ? "bg-red-500/20"
                      : geofencing.isBackgroundMode
                        ? "bg-amber-500/20"
                        : "bg-emerald-500/20"
                    : "bg-muted"
                )}>
                  {liveTrackingEnabled ? (
                    !geofencing.isOnline ? (
                      <WifiOff className="h-5 w-5 text-red-600" />
                    ) : geofencing.isBackgroundMode ? (
                      <WifiOff className="h-5 w-5 text-amber-600" />
                    ) : (
                      <Navigation className="h-5 w-5 text-emerald-600 animate-pulse" />
                    )
                  ) : (
                    <LocateOff className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm">
                    {liveTrackingEnabled ? 'Konum Takibi Aktif' : 'Konum Takibi Kapalı'}
                  </div>
                  {liveTrackingEnabled && (
                    <div className="text-xs text-muted-foreground truncate">
                      {geofencing.error ? (
                        <span className="text-amber-600">{geofencing.error}</span>
                      ) : geofencing.distanceToTarget !== null ? (
                        <>
                          Hedefe mesafe: <span className="font-mono font-semibold">{geofencing.distanceToTarget}m</span>
                          {geofencing.isInRange ? (
                            <span className="ml-1 text-emerald-600 font-medium">(Menzilde!)</span>
                          ) : geofencing.isApproaching ? (
                            <span className="ml-1 text-amber-600">(Yaklaşıldı)</span>
                          ) : null}
                        </>
                      ) : (
                        'Konum alınıyor...'
                      )}
                    </div>
                  )}
                  {!liveTrackingEnabled && (
                    <div className="text-xs text-muted-foreground">
                      Varış/ayrılma otomatik kaydedilsin
                    </div>
                  )}
                </div>
              </div>
              <Button
                variant={liveTrackingEnabled ? "outline" : "default"}
                size="sm"
                onClick={toggleLiveTracking}
                className={cn(
                  "flex-shrink-0",
                  liveTrackingEnabled && "border-red-500/50 text-red-600 hover:bg-red-500/10"
                )}
              >
                {liveTrackingEnabled ? (
                  <>
                    <LocateOff className="h-4 w-4 mr-1" />
                    Durdur
                  </>
                ) : (
                  <>
                    <Locate className="h-4 w-4 mr-1" />
                    Başlat
                  </>
                )}
              </Button>
            </div>

            {/* Arka plan uyarısı */}
            {liveTrackingEnabled && geofencing.isBackgroundMode && (
              <div className="mt-2 pt-2 border-t border-amber-500/20 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  Uygulama arka planda. Tam doğruluk için bu sayfayı açık tutun.
                </p>
              </div>
            )}

            {/* Çevrimdışı uyarısı */}
            {liveTrackingEnabled && !geofencing.isOnline && (
              <div className="mt-2 pt-2 border-t border-red-500/20 flex items-start gap-2">
                <WifiOff className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="text-red-600 font-medium">İnternet bağlantısı yok</p>
                  <p className="text-muted-foreground">
                    GPS takibi devam ediyor. Varış/çıkış kayıtları bağlantı geldiğinde otomatik senkronize edilecek.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Şoförler için rota durumu badge */}
        {activeRoute && (
          <div className="flex items-center gap-2">
            <Badge variant={activeRoute.status === 'completed' ? 'default' : 'secondary'} className="w-fit">
              {activeRoute.status === 'completed' ? 'Tamamlandı' : (activeRoute.status === 'in_progress' ? 'Devam Ediyor' : 'Bekliyor')}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {format(new Date(activeRoute.dateISO), 'dd MMMM yyyy', { locale: tr })} • {activeRoute.stops?.length || 0} durak
            </span>
          </div>
        )}

        {/* Route Action Buttons - Prominent with colors and lab names */}
        {activeRoute?.stops?.length ? (
          <div className="space-y-3">
            {/* Main action buttons - horizontal, colorful */}
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Departure Button - Green/Emerald */}
              <button
                type="button"
                onClick={handleDepart}
                disabled={!isDriverOwner || !canStartLeg}
                className="flex-1 h-14 sm:h-16 px-4 sm:px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-500 text-white font-semibold shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none flex items-center justify-start gap-3 sm:gap-4"
              >
                <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <LogOut className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="flex flex-col items-start text-left min-w-0">
                  <span className="text-[10px] sm:text-xs uppercase tracking-wide opacity-80">Çıkış Yap</span>
                  <span className="text-sm sm:text-base font-bold truncate max-w-full">
                    {canStartLeg ? (lastArrivedIndex >= 0 ? activeRoute.stops[lastArrivedIndex]?.name : activeRoute.stops[0]?.name) : '—'}
                  </span>
                </div>
              </button>

              {/* Arrival Button - Blue */}
              <button
                type="button"
                onClick={handleArrive}
                disabled={!isDriverOwner || !canArrive}
                className="flex-1 h-14 sm:h-16 px-4 sm:px-6 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-semibold shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none flex items-center justify-start gap-3 sm:gap-4"
              >
                <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <Flag className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="flex flex-col items-start text-left min-w-0">
                  <span className="text-[10px] sm:text-xs uppercase tracking-wide opacity-80">Varış Bildir</span>
                  <span className="text-sm sm:text-base font-bold truncate max-w-full">
                    {currentLegIndex >= 0 ? activeRoute.stops[currentLegIndex + 1]?.name : '—'}
                  </span>
                </div>
              </button>
            </div>

            {/* Google Maps Button - Secondary */}
            <Button
              onClick={() => {
                const ordered = (activeRoute.stops || []).slice().sort((a, b) => a.order - b.order);
                const segments = openRouteInGoogleMaps(ordered);
                if (segments && segments.length > 1) {
                  toast({
                    title: 'Rota bölündü',
                    description: `Rota ${segments.length} parçaya ayrıldı. İlk parça açıldı, kalan parçaları Google Maps içinde devam ettirebilirsiniz.`,
                  });
                }
              }}
              disabled={!isDriverOwner}
              variant="outline"
              className="w-full h-11 rounded-xl text-sm"
            >
              <MapIcon className="h-4 w-4 mr-2" />
              Google Maps&apos;te Rotayı Aç
            </Button>
          </div>
        ) : null}

        {/* Route Progress Summary */}
        <div className="h-[45vh] sm:h-[50vh] md:h-[55vh] w-full rounded-xl overflow-hidden border border-white/10 bg-card/50 backdrop-blur">
          <RouteProgressView
            stops={(activeRoute?.stops || []).sort((a, b) => a.order - b.order)}
            segmentStates={segmentStates}
            status={activeRoute?.status}
          />
        </div>
      </CardContent>

      {/* Şoför için atanmış rotalar modalı */}
      <Dialog open={showRoutesModal} onOpenChange={setShowRoutesModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListOrdered className="h-5 w-5" />
              Atanmış Rotalarım
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {loadingRoutes ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : assignedRoutes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Atanmış rota bulunamadı.
              </div>
            ) : (
              assignedRoutes.map((route) => (
                <button
                  key={route.id}
                  onClick={() => handleSelectRoute(route)}
                  className={`w-full p-3 rounded-lg border text-left transition-all hover:bg-accent/50 ${
                    activeRouteId === route.id ? 'border-primary bg-accent/30' : 'border-border'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">
                          {format(new Date(route.dateISO), 'dd MMMM yyyy', { locale: tr })}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {route.stops?.length || 0} durak
                        </span>
                      </div>
                    </div>
                    <Badge variant={route.status === 'in_progress' ? 'default' : 'secondary'} className="text-xs">
                      {route.status === 'in_progress' ? 'Devam Ediyor' : 'Bekliyor'}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
