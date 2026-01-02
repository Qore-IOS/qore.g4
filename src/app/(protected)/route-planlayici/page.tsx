// app/(protected)/route-planlayici/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { MapIcon, Loader2, History, Flag, LogOut, Plus, Route, Map as MapViewIcon } from 'lucide-react';
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

const LeafletRouteMap = dynamic(() => import('./route-map-client'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[55vh] rounded-xl bg-muted/30">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <span className="ml-2 text-sm text-muted-foreground">Harita yükleniyor…</span>
    </div>
  ),
});

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
  const { currentUser } = useAuth();

  const [myUid, setMyUid] = useState<string>('');
  const [drivers, setDrivers] = useState<AppUser[]>([]);
  const [viewDriverId, setViewDriverId] = useState<string>('');
  const [viewDate, setViewDate] = useState<Date>(new Date());
  const [activeRoute, setActiveRoute] = useState<RouteDoc | null>(null);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);

  useEffect(() => {
    setMyUid(currentUser?.uid || '');
  }, [currentUser]);

  useEffect(() => {
    (async () => {
      try {
        const uSnap = await getDocs(collection(db, 'users'));
        const ds = uSnap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)).filter(u => (u as any).role === 'driver');
        setDrivers(ds);
      } catch {
        toast({ title: 'Veri Hatası', description: 'Sürücüler alınamadı.', variant: 'destructive' });
      }
    })();
  }, [toast]);

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

  return (
    <Card className="shadow-lg">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <CardTitle className="text-base sm:text-lg md:text-xl">Route Planlayıcı</CardTitle>
        </div>
        {/* Action Buttons */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
          <Link href="/route-planlayici/gecmis" className="col-span-1">
            <Button variant="outline" size="sm" className="w-full text-xs sm:text-sm">
              <History className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Geçmiş</span>
            </Button>
          </Link>
          <Link href="/route-planlayici/olustur" className="col-span-1">
            <Button size="sm" className="w-full text-xs sm:text-sm">
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Rota Oluştur</span>
              <span className="sm:hidden">Oluştur</span>
            </Button>
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 sm:space-y-4 relative">
        {/* Driver Selection */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 w-full sm:w-auto">
            <span className="text-xs sm:text-sm text-muted-foreground">Şoför:</span>
            <Select value={viewDriverId} onValueChange={setViewDriverId}>
              <SelectTrigger className="w-full sm:w-[200px] md:w-[240px]"><SelectValue placeholder="Sürücü seçiniz" /></SelectTrigger>
              <SelectContent>
                {drivers.filter(d => d.id).map(d => (<SelectItem key={d.id} value={d.id!}>{(d as any).displayName || (d as any).name || (d as any).email}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          {activeRoute && (
            <Badge variant={activeRoute.status === 'completed' ? 'default' : 'secondary'} className="w-fit">
              {activeRoute.status === 'completed' ? 'Tamamlandı' : (activeRoute.status === 'in_progress' ? 'Devam Ediyor' : 'Açık')}
            </Badge>
          )}
        </div>

        {/* Route Action Buttons */}
        {activeRoute?.stops?.length ? (
          <div className="grid grid-cols-3 sm:flex sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
            <div className="flex flex-col items-center">
              <button type="button" onClick={handleDepart} disabled={!isDriverOwner || !canStartLeg}
                className="w-full h-10 sm:h-12 px-3 sm:px-4 rounded-xl bg-white/10 border border-white/15 backdrop-blur shadow-lg ring-1 ring-white/10 hover:bg-white/20 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center">
                <LogOut className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
              <div className="mt-1 text-[10px] sm:text-xs text-center max-w-[6rem] sm:max-w-[9rem] text-white/90 truncate">{departFromLabel}</div>
            </div>
            <div className="flex flex-col items-center">
              <button type="button" onClick={handleArrive} disabled={!isDriverOwner || !canArrive}
                className="h-10 sm:h-12 px-3 sm:px-5 rounded-xl sm:rounded-2xl bg-white/10 border border-white/15 backdrop-blur shadow-lg ring-1 ring-white/10 hover:bg-white/20 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 sm:gap-2">
                <Flag className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="max-w-[4rem] sm:max-w-[12rem] truncate text-xs sm:text-sm">{arriveToLabel}</span>
              </button>
            </div>
            <div className="flex flex-col items-center">
              <Button onClick={() => {
                const ordered = (activeRoute.stops || []).slice().sort((a, b) => a.order - b.order);
                const segments = openRouteInGoogleMaps(ordered);
                if (segments && segments.length > 1) {
                  toast({
                    title: 'Rota bölündü',
                    description: `Rota ${segments.length} parçaya ayrıldı. İlk parça açıldı, kalan parçaları Google Maps içinde devam ettirebilirsiniz.`,
                  });
                }
              }}
                disabled={!isDriverOwner} variant="outline" size="sm" className="h-10 sm:h-12 px-2 sm:px-4 rounded-xl text-xs sm:text-sm">
                <span className="hidden sm:inline">Google Maps'te Aç</span>
                <span className="sm:hidden">Maps</span>
              </Button>
            </div>
          </div>
        ) : null}

        {/* View Tabs - Summary (default) and Map */}
        <Tabs defaultValue="ozet" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-3">
            <TabsTrigger value="ozet" className="flex items-center gap-2">
              <Route className="h-4 w-4" />
              <span>Özet</span>
            </TabsTrigger>
            <TabsTrigger value="harita" className="flex items-center gap-2">
              <MapViewIcon className="h-4 w-4" />
              <span>Harita</span>
            </TabsTrigger>
          </TabsList>

          {/* Summary View - Metro Style Progress */}
          <TabsContent value="ozet" className="mt-0">
            <div className="h-[45vh] sm:h-[50vh] md:h-[55vh] w-full rounded-xl overflow-hidden border border-white/10 bg-card/50 backdrop-blur">
              <RouteProgressView
                stops={(activeRoute?.stops || []).sort((a, b) => a.order - b.order)}
                segmentStates={segmentStates}
                status={activeRoute?.status}
              />
            </div>
          </TabsContent>

          {/* Map View */}
          <TabsContent value="harita" className="mt-0">
            <div className="h-[45vh] sm:h-[50vh] md:h-[55vh] w-full rounded-xl overflow-hidden border border-white/10 route-map">
              <LeafletRouteMap
                stops={(activeRoute?.stops || []).sort((a, b) => a.order - b.order)}
                segmentStates={segmentStates}
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
