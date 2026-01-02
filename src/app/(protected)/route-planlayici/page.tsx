
// app/(protected)/route-planlayici/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { MapIcon, CalendarDays, Plus, Trash2, Loader2, History, Play, Flag, Eye, LogOut, ListChecks, Route, Map } from 'lucide-react';
import RouteProgressView from './route-progress-view';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import {
  collection, doc, getDoc, getDocs, onSnapshot, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, increment
} from 'firebase/firestore';
import type { Hospital, User as AppUser } from '@/lib/types';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';


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
const atStartOfDayISO = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();

function getHospitalLatLng(h: any): { lat?: number; lng?: number } {
  if (h?.location && typeof h.location.lat === 'number' && typeof h.location.lng === 'number') return { lat: h.location.lat, lng: h.location.lng };
  if (typeof h?.lat === 'number' && typeof h?.lng === 'number') return { lat: h.lat, lng: h.lng };
  return {};
}

function dist(a: {lat:number,lng:number}, b:{lat:number,lng:number}) {
  const R = 6371e3, φ1=a.lat*Math.PI/180, φ2=b.lat*Math.PI/180, dφ=(b.lat-a.lat)*Math.PI/180, dλ=(b.lng-a.lng)*Math.PI/180;
  const s = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

function autoOrder(stops: RouteStop[], startId: string): RouteStop[] {
  if (stops.length <= 1) return stops.map((s,i)=>({ ...s, order: i+1 }));
  const pool = stops.map(s => ({...s}));
  const startIdx = Math.max(0, pool.findIndex(s => s.hospitalId === startId));
  const ordered: RouteStop[] = [];
  let current = pool.splice(startIdx >= 0 ? startIdx : 0, 1)[0];
  ordered.push(current);
  while (pool.length) {
    let bestIdx = 0, bestD = Infinity;
    for (let i=0;i<pool.length;i++){
      const d = dist(current, pool[i]);
      if (d < bestD){ bestD = d; bestIdx = i; }
    }
    current = pool.splice(bestIdx,1)[0];
    ordered.push(current);
  }
  return ordered.map((s,i)=>({ ...s, order: i+1 }));
}
const cloneStops = (stops: RouteStop[]) => stops.map(s=>({ ...s }));

export default function RoutePlanlayiciPage() {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  
  const [myUid, setMyUid] = useState<string>('');
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [drivers, setDrivers] = useState<AppUser[]>([]);
  const [viewDriverId, setViewDriverId] = useState<string>('');
  const [viewDate, setViewDate] = useState<Date>(new Date());
  const [activeRoute, setActiveRoute] = useState<RouteDoc | null>(null);
  const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const [planDriverId, setPlanDriverId] = useState<string>('');
  const [planDate, setPlanDate] = useState<Date>(new Date());
  const [search, setSearch] = useState('');
  const [draftStops, setDraftStops] = useState<RouteStop[]>([]);
  const [startStopId, setStartStopId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [scheduled, setScheduled] = useState<RouteDoc[]>([]);
  const [preview, setPreview] = useState<RouteDoc | null>(null);
  
  const [routesOpen, setRoutesOpen] = useState(false);
  const [myAssignedRoutes, setMyAssignedRoutes] = useState<RouteDoc[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  
  const modalRoutes = useMemo(() => {
    const map = new Map<string, RouteDoc>();
    [...scheduled, ...myAssignedRoutes]
      .filter(r => r.status !== 'completed')
      .forEach(r => { map.set(r.id, r); });
    return Array.from(map.values())
      .sort((a,b) => a.date === b.date ? (a.sequence||0)-(b.sequence||0) : a.date-b.date);
  }, [scheduled, myAssignedRoutes]);

  useEffect(() => {
    setMyUid(currentUser?.uid || '');
  }, [currentUser]);

  useEffect(() => {
    (async () => {
      try {
        const [hSnap, uSnap] = await Promise.all([
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'users')),
        ]);
        setHospitals(hSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Hospital[]);
        const ds = uSnap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)).filter(u => (u as any).role === 'driver');
        setDrivers(ds);
      } catch {
        toast({ title: 'Veri Hatası', description: 'Sürücüler veya laboratuvarlar alınamadı.', variant: 'destructive' });
      }
    })();
  }, [toast]);
  
  useEffect(() => {
    if (!viewDriverId) { setScheduled([]); return; }
    const qy = query(collection(db, 'routes'), where('driverId','==', viewDriverId));
    const unsub = onSnapshot(qy, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as RouteDoc[];
      const upcoming = rows.filter(r => r.status !== 'completed');
      upcoming.sort((a,b)=> a.date === b.date ? (a.sequence||0)-(b.sequence||0) : a.date-b.date);
      setScheduled(upcoming);
    });
    return () => unsub();
  }, [viewDriverId]);

  useEffect(() => {
    if (!myUid) { setMyAssignedRoutes([]); return; }
    const qy = query(collection(db, 'routes'), where('driverId','==', myUid));
    const unsub = onSnapshot(qy, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as RouteDoc[];
      const mine = rows.filter(r => r.status !== 'completed');
      mine.sort((a,b)=> a.date === b.date ? (a.sequence||0)-(b.sequence||0) : a.date-b.date);
      setMyAssignedRoutes(mine);
    });
    return () => unsub();
  }, [myUid]);

  useEffect(() => {
    if (!activeRouteId) {
      if(activeRoute) setActiveRoute(null); // Clear if ID is removed
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
  }, [activeRouteId, activeRoute]); // Dependency on `activeRoute` needed to avoid stale closure

  const fetchRoute = useCallback(async (driverId: string, day: Date) => {
    if (!driverId) { setActiveRoute(null); setActiveRouteId(null); return; }
    const dayKey = toDayKey(day);
    const qy = query(collection(db, 'routes'), where('driverId','==',driverId), where('date','==',dayKey));
    const snap = await getDocs(qy);
    if (snap.empty) { setActiveRoute(null); setActiveRouteId(null); return; }
    const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as RouteDoc[];
    const active = rows.find(r => r.isActive && r.status !== 'completed');
    const open = rows.filter(r => r.status !== 'completed').sort((a,b)=>(a.sequence||0)-(b.sequence||0))[0];
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

  const openPlanner = () => {
    setPlanDriverId(viewDriverId || drivers[0]?.id || '');
    setPlanDate(viewDate || new Date());
    const base = (activeRoute?.stops || []).map(s => ({ ...s, departedAt: null, arrivedAt: null }));
    setDraftStops(base);
    setStartStopId(base[0]?.hospitalId || '');
    setIsPlannerOpen(true);
  };

  const hospitalsFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hospitals;
    return hospitals.filter(h => (((h as any).name || (h as any).ad || '') as string).toLowerCase().includes(q));
  }, [hospitals, search]);

  const addStop = (h: Hospital) => {
    const { lat, lng } = getHospitalLatLng(h);
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      toast({ title: 'Konum Eksik', description: 'Seçtiğiniz laboratuvarın konumu tanımlanmamış.', variant: 'destructive' });
      return;
    }
    if (draftStops.some(s => s.hospitalId === (h as any).id)) return;
    setDraftStops(prev => [...prev, { order: prev.length + 1, hospitalId: (h as any).id!, name: (h as any).name || (h as any).ad || 'Laboratuvar', lat, lng, departedAt: null, arrivedAt: null }]);
    if (!startStopId) setStartStopId((h as any).id!);
  };
  const moveStop = (id: string, dir: -1 | 1) => {
    setDraftStops(prev => {
      const idx = prev.findIndex(s => s.hospitalId === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr.map((s, i) => ({ ...s, order: i + 1 }));
    });
  };
  const removeStop = (id: string) => {
    setDraftStops(prev => prev.filter(s => s.hospitalId !== id).map((s, i) => ({ ...s, order: i + 1 })));
    if (startStopId === id) setStartStopId('');
  };

  const makeAutoRoute = () => {
    if (draftStops.length < 2 || !startStopId) {
      toast({ title: 'Yetersiz durak', description: 'Otomatik rota için en az 2 durak ve bir başlangıç seçin.', variant: 'destructive' });
      return;
    }
    setDraftStops(autoOrder(draftStops, startStopId));
    toast({ title: 'Otomatik rota', description: 'Sıralamayı isterseniz el ile de değiştirebilirsiniz.' });
  };

  const savePlan = async () => {
    if (!planDriverId) { toast({ title: 'Sürücü seçiniz', description: 'Plan kaydetmek için sürücü seçmelisiniz.' }); return; }
    if (draftStops.length === 0) { toast({ title: 'Durak ekleyin', description: 'En az bir laboratuvar seçmelisiniz.', variant: 'destructive' }); return; }
    setIsSaving(true);
    try {
      const dayKey = toDayKey(planDate);
      const counterRef = doc(db, 'routeSequences', `${planDriverId}_${dayKey}`);
      await setDoc(counterRef, { seq: increment(1), updatedAt: serverTimestamp() }, { merge: true });
      const seqSnap = await getDoc(counterRef);
      const sequence = Math.max(1, Number((seqSnap.data() as any)?.seq || 1));
      
      const routeId = `${planDriverId}_${dayKey}_${sequence}`;
      const driver = drivers.find(d => d.id === planDriverId);

      const payload: RouteDoc = {
        id: routeId, runId: routeId, sequence, date: dayKey, dateISO: atStartOfDayISO(planDate), driverId: planDriverId,
        driverName: (driver as any)?.displayName || (driver as any)?.name || (driver as any)?.email || 'Sürücü',
        status: 'open', isActive: false, activatedAt: null, activatedBy: null,
        stops: draftStops.map((s, i) => ({ ...s, order: i + 1 })),
        createdAt: serverTimestamp() as any, updatedAt: serverTimestamp() as any,
      } as any;

      await setDoc(doc(db, 'routes', routeId), payload, { merge: false });
      setIsPlannerOpen(false);
      setViewDriverId(planDriverId);
      setViewDate(planDate);
      toast({ title: 'Rota eklendi', description: `${format(planDate, 'dd MMMM yyyy', { locale: tr })} • Sıra #${sequence}` });
    } catch (e:any) {
      console.error(e);
      toast({ title: 'Kayıt Hatası', description: `Rota kaydedilemedi. ${e?.code||''}`, variant: 'destructive' });
    } finally { setIsSaving(false); }
  };

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
      const to = activeRoute!.stops[i+1];
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

  const activateRoute = async (r: RouteDoc) => {
    if (myUid !== r.driverId) { setPreview(r); return; }
    try {
      await updateDoc(doc(db, 'routes', r.id), { isActive: true, activatedAt: serverTimestamp(), activatedBy: myUid, updatedAt: serverTimestamp() });
      setActiveRouteId(r.id);
      setViewDriverId(r.driverId);
      setViewDate(new Date(r.dateISO));
      toast({ title: 'Rota aktif', description: `${format(new Date(r.dateISO),'dd.MM.yyyy')} • #${r.sequence} • ${r.stops?.length||0} durak` });
    } catch {
      toast({ title: 'Hata', description: 'Rota aktifleştirilemedi.', variant: 'destructive' });
    }
  };

  return (
    <Card className="shadow-lg">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <CardTitle className="text-base sm:text-lg md:text-xl">Route Planlayıcı</CardTitle>
        </div>
        {/* Action Buttons - Grid on mobile */}
        <div className="grid grid-cols-3 sm:flex sm:items-center gap-2 w-full sm:w-auto">
            <Link href="/route-planlayici/gecmis" className="col-span-1">
                <Button variant="outline" size="sm" className="w-full text-xs sm:text-sm">
                    <History className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Geçmiş</span>
                </Button>
            </Link>
            <Button onClick={openPlanner} size="sm" className="col-span-1 text-xs sm:text-sm">
                <CalendarDays className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Planla</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRoutesOpen(true)} title="Şoföre atanan rotalar" className="col-span-1 text-xs sm:text-sm">
                <ListChecks className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Rotalar</span>
            </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 sm:space-y-4 relative">
        {/* Driver Selection - Mobile Responsive */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 w-full sm:w-auto">
            <span className="text-xs sm:text-sm text-muted-foreground">Şoför (görüntüleme):</span>
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

        {/* Route Action Buttons - Mobile Responsive */}
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
                  const ordered = (activeRoute.stops || []).slice().sort((a,b)=>a.order-b.order);
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
              <Map className="h-4 w-4" />
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

      <Dialog open={isPlannerOpen} onOpenChange={setIsPlannerOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Rota Planla</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">Başlangıç seçin, otomatik sırala ya da el ile düzenleyin.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <div className="border rounded-lg p-2 sm:p-3">
              <div className="grid grid-cols-2 gap-2 mb-2 sm:mb-3">
                <div>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">Tarih</span>
                  <Input type="date" value={format(planDate, 'yyyy-MM-dd')} onChange={(e) => setPlanDate(new Date(e.target.value))} className="mt-1 text-xs sm:text-sm" />
                </div>
                <div>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">Şoför</span>
                  <Select value={planDriverId} onValueChange={setPlanDriverId}>
                    <SelectTrigger className="mt-1 text-xs sm:text-sm"><SelectValue placeholder="Sürücü seçiniz" /></SelectTrigger>
                    <SelectContent>
                      {drivers.filter(d => d.id).map(d => (<SelectItem key={d.id} value={d.id!}>{(d as any).displayName || (d as any).name || (d as any).email}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 mb-2">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Select value={startStopId} onValueChange={setStartStopId}>
                    <SelectTrigger className="w-full text-xs sm:text-sm"><SelectValue placeholder="Başlangıç durağı seçin" /></SelectTrigger>
                    <SelectContent>
                      {draftStops.sort((a,b)=>a.order-b.order).map(s => (<SelectItem key={s.hospitalId} value={s.hospitalId}>{s.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" onClick={makeAutoRoute} size="sm" className="text-xs sm:text-sm whitespace-nowrap">Route belirle</Button>
                </div>
              </div>
              <Input placeholder="Laboratuvar ara…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2 text-xs sm:text-sm" />
              <div className="h-[200px] sm:h-[280px] md:h-[320px] overflow-auto space-y-2 pr-1">
                {hospitalsFiltered.map(h => {
                  const name = (h as any).name || (h as any).ad || h.id;
                  return (
                    <div key={(h as any).id} className="flex items-center justify-between rounded-md border px-2 sm:px-3 py-1.5 sm:py-2 hover:bg-accent/30 gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-medium truncate">{name}</div>
                        <div className="text-[10px] sm:text-xs text-muted-foreground truncate">{(h as any).address || (h as any).adres || '-'}</div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => addStop(h)} className="text-xs flex-shrink-0">
                        <Plus className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-1" />
                        <span className="hidden sm:inline">Ekle</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="border rounded-lg p-2 sm:p-3">
              <div className="text-xs sm:text-sm font-medium mb-2">Seçilen Duraklar (Sıralı)</div>
              <div className="h-[200px] sm:h-[300px] md:h-[370px] overflow-auto space-y-2 pr-1">
                {draftStops.sort((a,b)=>a.order-b.order).map((s, idx) => (
                  <div key={s.hospitalId} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="w-7 justify-center">{idx+1}</Badge>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground">({s.lat.toFixed(5)}, {s.lng.toFixed(5)})</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" onClick={() => moveStop(s.hospitalId, -1)} disabled={idx===0}>↑</Button>
                      <Button variant="outline" size="icon" onClick={() => moveStop(s.hospitalId, +1)} disabled={idx===draftStops.length-1}>↓</Button>
                      <Button variant="destructive" size="icon" onClick={() => removeStop(s.hospitalId)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
                {draftStops.length===0 && <div className="text-sm text-muted-foreground px-2">Henüz durak yok. Soldan ekleyin.</div>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={()=>setIsPlannerOpen(false)}>İptal</Button>
            <Button onClick={savePlan} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={routesOpen} onOpenChange={setRoutesOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Aktif Rotalar</DialogTitle>
            <DialogDescription>Seçili şoförün ve size atanmış açık rotalar listelenir.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {modalRoutes.length === 0 ? (
              <div className="text-sm text-muted-foreground">Listelenecek rota yok.</div>
            ) : modalRoutes.map(r => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {format(new Date(r.dateISO),'dd.MM.yyyy', { locale: tr })} • #{r.sequence} • {r.stops?.length||0} durak
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.driverName}</div>
                </div>
                <div className="flex items-center gap-2">
                  {r.isActive && <Badge variant="secondary">Aktif</Badge>}
                  <Button variant="outline" size="sm" onClick={() => setPreview(r)}>Önizle</Button>
                  <Button size="sm" onClick={() => { setRoutesOpen(false); activateRoute(r); }} disabled={myUid !== r.driverId} title={myUid !== r.driverId ? 'Sadece atanmış şoför uygulayabilir' : 'Ana haritaya aktar'}>
                    Ana haritaya aktar
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRoutesOpen(false)}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {preview ? `${preview.driverName} • ${format(new Date(preview.dateISO),'dd.MM.yyyy')} • #${preview.sequence} • ${preview.stops?.length||0} durak` : 'Önizleme'}
            </DialogTitle>
            <DialogDescription>Bu görünüm yalnızca önizlemedir.</DialogDescription>
          </DialogHeader>
          <div className="h-[60vh] w-full rounded-xl overflow-hidden border border-white/10">
            <LeafletRouteMap
              key={preview?.id || 'preview-map'}
              stops={(preview?.stops || []).slice().sort((a,b)=>a.order-b.order)}
              segmentStates={[]}
            />
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
