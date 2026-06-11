// app/(protected)/route-planlayici/olustur/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Loader2, ArrowLeft, ListChecks, MapPin, ChevronLeft, ChevronRight, Check, Navigation, Eye, Warehouse, FlaskConical } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import {
  collection, doc, getDoc, getDocs, onSnapshot, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, increment
} from 'firebase/firestore';
import { getDocsResilient, getDocResilient } from '@/lib/firestore-network-recovery';
import type { Hospital, User as AppUser, Depot } from '@/lib/types';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

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

export default function RotaOlusturPage() {
  const { toast } = useToast();
  const { currentUser, currentCompanyId, isSuperAdmin } = useAuth();
  const router = useRouter();

  const [myUid, setMyUid] = useState<string>('');
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [drivers, setDrivers] = useState<AppUser[]>([]);

  // Lokasyon listesi filtresi (laboratuvar/depo)
  const [locationFilter, setLocationFilter] = useState<'all' | 'labs' | 'depots'>('all');

  // Planlama state'leri
  const [planDriverId, setPlanDriverId] = useState<string>('');
  const [planDate, setPlanDate] = useState<Date>(new Date());
  const [search, setSearch] = useState('');
  const [draftStops, setDraftStops] = useState<RouteStop[]>([]);
  const [startStopId, setStartStopId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Rotalar state'leri
  const [scheduled, setScheduled] = useState<RouteDoc[]>([]);
  const [myAssignedRoutes, setMyAssignedRoutes] = useState<RouteDoc[]>([]);
  const [previewRoute, setPreviewRoute] = useState<RouteDoc | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'olustur' | 'rotalar'>('olustur');

  const allRoutes = useMemo(() => {
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
        const [hSnap, uSnap, dSnap] = await Promise.all([
          getDocsResilient(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
          getDocsResilient(scopedQuery('users', currentCompanyId, isSuperAdmin)),
          getDocsResilient(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
        ]);
        setHospitals(hSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Hospital[]);
        setDepots(dSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Depot[]);
        const ds = uSnap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)).filter(u => (u as any).role === 'driver');
        setDrivers(ds);
        if (ds.length > 0 && !planDriverId) {
          setPlanDriverId(ds[0].id || '');
        }
      } catch {
        toast({ title: 'Veri Hatası', description: 'Veriler alınamadı.', variant: 'destructive' });
      }
    })();
  }, [toast, planDriverId, currentCompanyId, isSuperAdmin]);

  // Tüm açık rotaları dinle
  useEffect(() => {
    if (!myUid) return;
    const qy = scopedQuery('routes', currentCompanyId, isSuperAdmin, where('status', '!=', 'completed'));
    const unsub = onSnapshot(qy, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as RouteDoc[];
      rows.sort((a,b)=> a.date === b.date ? (a.sequence||0)-(b.sequence||0) : a.date-b.date);
      setScheduled(rows);
    });
    return () => unsub();
  }, [myUid]);

  useEffect(() => {
    if (!myUid) { setMyAssignedRoutes([]); return; }
    const qy = scopedQuery('routes', currentCompanyId, isSuperAdmin, where('driverId','==', myUid));
    const unsub = onSnapshot(qy, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as RouteDoc[];
      const mine = rows.filter(r => r.status !== 'completed');
      mine.sort((a,b)=> a.date === b.date ? (a.sequence||0)-(b.sequence||0) : a.date-b.date);
      setMyAssignedRoutes(mine);
    });
    return () => unsub();
  }, [myUid]);

  // Birleştirilmiş lokasyon listesi (laboratuvarlar + depolar)
  type LocationItem = { id: string; name: string; address?: string; lat?: number; lng?: number; type: 'lab' | 'depot' };

  const allLocations = useMemo((): LocationItem[] => {
    const labs: LocationItem[] = hospitals.map(h => ({
      id: h.id,
      name: (h as any).name || (h as any).ad || h.id,
      address: (h as any).address || (h as any).adres,
      lat: h.lat,
      lng: h.lng,
      type: 'lab' as const,
    }));
    const deps: LocationItem[] = depots.map(d => ({
      id: d.id,
      name: d.name,
      address: d.address,
      lat: d.lat,
      lng: d.lng,
      type: 'depot' as const,
    }));
    return [...deps, ...labs]; // Depolar önce gösterilsin
  }, [hospitals, depots]);

  const locationsFiltered = useMemo(() => {
    let list = allLocations;

    // Filtre uygula
    if (locationFilter === 'labs') {
      list = list.filter(l => l.type === 'lab');
    } else if (locationFilter === 'depots') {
      list = list.filter(l => l.type === 'depot');
    }

    // Arama uygula
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(l => l.name.toLowerCase().includes(q) || (l.address || '').toLowerCase().includes(q));
    }

    return list;
  }, [allLocations, locationFilter, search]);

  const addStopFromLocation = (loc: LocationItem) => {
    if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      toast({
        title: 'Konum Eksik',
        description: `${loc.type === 'depot' ? 'Seçtiğiniz deponun' : 'Seçtiğiniz laboratuvarın'} konumu tanımlanmamış.`,
        variant: 'destructive'
      });
      return;
    }
    if (draftStops.some(s => s.hospitalId === loc.id)) return;
    setDraftStops(prev => [...prev, {
      order: prev.length + 1,
      hospitalId: loc.id,
      name: loc.name,
      lat: loc.lat!,
      lng: loc.lng!,
      departedAt: null,
      arrivedAt: null
    }]);
    if (!startStopId) setStartStopId(loc.id);
  };

  // Eski fonksiyon - geriye uyumluluk için
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
      const seqSnap = await getDocResilient(counterRef);
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

      await setDoc(doc(db, 'routes', routeId), withCompanyScope(payload, currentCompanyId), { merge: false });

      // Formu temizle
      setDraftStops([]);
      setStartStopId('');

      toast({ title: 'Rota eklendi', description: `${format(planDate, 'dd MMMM yyyy', { locale: tr })} • Sıra #${sequence}` });

      // Rotalar sekmesine geç
      setActiveTab('rotalar');
    } catch (e:any) {
      console.error(e);
      toast({ title: 'Kayıt Hatası', description: `Rota kaydedilemedi. ${e?.code||''}`, variant: 'destructive' });
    } finally { setIsSaving(false); }
  };

  const activateRoute = async (r: RouteDoc) => {
    if (myUid !== r.driverId) {
      toast({ title: 'Yetki Hatası', description: 'Sadece atanmış şoför rotayı aktifleştirebilir.', variant: 'destructive' });
      return;
    }
    // Tarih kontrolü - rota sadece planlanan gün aktif edilebilir
    const today = Number(format(new Date(), 'yyyyMMdd'));
    if (r.date !== today) {
      const routeDateStr = format(new Date(r.dateISO), 'dd MMMM yyyy', { locale: tr });
      toast({
        title: 'Tarih Uyumsuzluğu',
        description: `Bu rota ${routeDateStr} için planlanmış. Rota sadece planlanan günde aktif edilebilir.`,
        variant: 'destructive'
      });
      return;
    }
    try {
      await updateDoc(doc(db, 'routes', r.id), { isActive: true, activatedAt: serverTimestamp(), activatedBy: myUid, updatedAt: serverTimestamp() });
      toast({ title: 'Rota aktif', description: `${format(new Date(r.dateISO),'dd.MM.yyyy')} • #${r.sequence} • ${r.stops?.length||0} durak` });
      router.push('/route-planlayici');
    } catch {
      toast({ title: 'Hata', description: 'Rota aktifleştirilemedi.', variant: 'destructive' });
    }
  };

  return (
    <div className="container mx-auto p-2 sm:p-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/route-planlayici')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-lg sm:text-xl font-semibold">Rota Yönetimi</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Yeni rota oluştur veya mevcut rotaları yönet</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'olustur' | 'rotalar')} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="olustur" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            <span>Yeni Rota</span>
          </TabsTrigger>
          <TabsTrigger value="rotalar" className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            <span>Rotalar ({allRoutes.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* Yeni Rota Oluştur */}
        <TabsContent value="olustur" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Sol Panel - Laboratuvar Seçimi */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm sm:text-base">Rota Ayarları & Laboratuvarlar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Tarih ve Şoför */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Tarih</label>
                    <Input
                      type="date"
                      value={format(planDate, 'yyyy-MM-dd')}
                      onChange={(e) => setPlanDate(new Date(e.target.value))}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Şoför</label>
                    <Select value={planDriverId} onValueChange={setPlanDriverId}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Sürücü seçiniz" /></SelectTrigger>
                      <SelectContent>
                        {drivers.filter(d => d.id).map(d => (
                          <SelectItem key={d.id} value={d.id!}>
                            {(d as any).displayName || (d as any).name || (d as any).email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Başlangıç ve Otomatik Rota */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select value={startStopId} onValueChange={setStartStopId}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Başlangıç durağı seçin" /></SelectTrigger>
                    <SelectContent>
                      {draftStops.sort((a,b)=>a.order-b.order).map(s => (
                        <SelectItem key={s.hospitalId} value={s.hospitalId}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" onClick={makeAutoRoute} size="sm" className="whitespace-nowrap">
                    Route belirle
                  </Button>
                </div>

                {/* Filtre Butonları */}
                <div className="flex gap-2">
                  <Button
                    variant={locationFilter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setLocationFilter('all')}
                    className="flex-1"
                  >
                    Tümü
                  </Button>
                  <Button
                    variant={locationFilter === 'depots' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setLocationFilter('depots')}
                    className="flex-1"
                  >
                    <Warehouse className="h-4 w-4 mr-1" />
                    Depolar
                  </Button>
                  <Button
                    variant={locationFilter === 'labs' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setLocationFilter('labs')}
                    className="flex-1"
                  >
                    <FlaskConical className="h-4 w-4 mr-1" />
                    Lablar
                  </Button>
                </div>

                {/* Arama */}
                <Input
                  placeholder="Lokasyon ara…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />

                {/* Lokasyon Listesi (Depolar + Laboratuvarlar) */}
                <div className="h-[240px] sm:h-[280px] overflow-auto space-y-2 pr-1">
                  {locationsFiltered.map(loc => {
                    const isAdded = draftStops.some(s => s.hospitalId === loc.id);
                    const hasLocation = typeof loc.lat === 'number' && typeof loc.lng === 'number';
                    return (
                      <div key={loc.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 transition-colors ${isAdded ? 'bg-primary/10 border-primary/30' : 'hover:bg-accent/30'}`}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${loc.type === 'depot' ? 'bg-orange-500/10' : 'bg-green-500/10'}`}>
                            {loc.type === 'depot' ? (
                              <Warehouse className="h-4 w-4 text-orange-500" />
                            ) : (
                              <FlaskConical className="h-4 w-4 text-green-500" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate flex items-center gap-1">
                              {loc.name}
                              {!hasLocation && (
                                <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1 rounded">Konum yok</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{loc.address || '-'}</div>
                          </div>
                        </div>
                        <Button
                          variant={isAdded ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => addStopFromLocation(loc)}
                          disabled={isAdded || !hasLocation}
                          className="flex-shrink-0"
                        >
                          {isAdded ? '✓' : <><Plus className="h-4 w-4 mr-1" />Ekle</>}
                        </Button>
                      </div>
                    );
                  })}
                  {locationsFiltered.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
                      <MapPin className="h-8 w-8 mb-2 opacity-50" />
                      <p className="text-sm">Lokasyon bulunamadı</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Sağ Panel - Seçilen Duraklar */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm sm:text-base">Seçilen Duraklar ({draftStops.length})</CardTitle>
                {draftStops.length > 0 && (
                  <Button onClick={savePlan} disabled={isSaving} size="sm">
                    {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Kaydet
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <div className="h-[380px] sm:h-[420px] overflow-auto space-y-2 pr-1">
                  {draftStops.sort((a,b)=>a.order-b.order).map((s, idx) => (
                    <div key={s.hospitalId} className="flex items-center justify-between rounded-lg border px-3 py-2 bg-card">
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant="secondary" className="w-8 h-8 justify-center text-sm flex-shrink-0">
                          {idx+1}
                        </Badge>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{s.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => moveStop(s.hospitalId, -1)} disabled={idx===0} className="h-8 w-8">
                          <ChevronLeft className="h-4 w-4 rotate-90" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => moveStop(s.hospitalId, +1)} disabled={idx===draftStops.length-1} className="h-8 w-8">
                          <ChevronRight className="h-4 w-4 rotate-90" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => removeStop(s.hospitalId)} className="h-8 w-8 text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {draftStops.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <MapPin className="h-12 w-12 mb-2 opacity-50" />
                      <p className="text-sm">Henüz durak eklenmedi</p>
                      <p className="text-xs">Soldan laboratuvar seçin</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Mevcut Rotalar */}
        <TabsContent value="rotalar" className="mt-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm sm:text-base">Aktif Rotalar</CardTitle>
            </CardHeader>
            <CardContent>
              {previewRoute ? (
                // Önizleme Modu - Metro tarzı durak listesi
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">
                        {format(new Date(previewRoute.dateISO), 'dd MMMM yyyy', { locale: tr })} • #{previewRoute.sequence}
                      </h3>
                      <p className="text-sm text-muted-foreground">{previewRoute.driverName} • {previewRoute.stops?.length || 0} durak</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPreviewRoute(null)}>
                        Geri
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => activateRoute(previewRoute)}
                        disabled={myUid !== previewRoute.driverId}
                      >
                        Aktifleştir
                      </Button>
                    </div>
                  </div>
                  {/* Metro tarzı durak listesi */}
                  <div className="h-[400px] rounded-xl overflow-y-auto border bg-card/50 p-4">
                    {(previewRoute.stops || []).slice().sort((a,b)=>a.order-b.order).map((stop, idx, arr) => (
                      <div key={stop.hospitalId} className="relative">
                        <div className="flex items-start gap-4">
                          {/* Metro node ve çizgi */}
                          <div className="flex flex-col items-center flex-shrink-0">
                            <div className="w-10 h-10 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center text-sm font-bold text-primary">
                              {idx + 1}
                            </div>
                            {idx < arr.length - 1 && (
                              <div className="w-1 h-12 bg-primary/30 my-1" />
                            )}
                          </div>
                          {/* Durak bilgisi */}
                          <div className="flex-1 pb-4">
                            <div className="rounded-lg border bg-card p-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{stop.name}</span>
                                {idx === 0 && (
                                  <Badge variant="outline" className="text-xs">Başlangıç</Badge>
                                )}
                                {idx === arr.length - 1 && (
                                  <Badge variant="outline" className="text-xs text-orange-500 border-orange-500">Bitiş</Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                // Liste Modu
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {allRoutes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <ListChecks className="h-12 w-12 mb-2 opacity-50" />
                      <p className="text-sm">Henüz aktif rota yok</p>
                    </div>
                  ) : allRoutes.map(r => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border px-4 py-3 hover:bg-accent/30 transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {format(new Date(r.dateISO), 'dd.MM.yyyy', { locale: tr })}
                          </span>
                          <Badge variant="outline" className="text-xs">#{r.sequence}</Badge>
                          <Badge variant="secondary" className="text-xs">{r.stops?.length || 0} durak</Badge>
                          {r.isActive && <Badge className="text-xs bg-green-500">Aktif</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{r.driverName}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button variant="outline" size="sm" onClick={() => setPreviewRoute(r)}>
                          <Eye className="h-4 w-4 mr-1" />
                          Önizle
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => activateRoute(r)}
                          disabled={myUid !== r.driverId}
                          title={myUid !== r.driverId ? 'Sadece atanmış şoför aktifleştirebilir' : ''}
                        >
                          Aktifleştir
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
