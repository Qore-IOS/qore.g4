'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2, Package, Search, ArrowLeft, Monitor, Users, Warehouse, UserCheck, ChevronRight, Clock, CalendarClock, Building2, ChevronsUpDown, X } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import type { Hospital } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';

interface TransferLog {
  id: string;
  action: string;
  stokKodu: string;
  stokAdi: string;
  serialNumber?: string;
  deviceId?: string;
  deviceName?: string;
  createdByUid: string;
  createdByName: string;
  createdAt: Date;
  formType?: 'teknik_servis' | 'aplikasyon';
}

interface PartSummary {
  stokKodu: string;
  stokAdi: string;
  usageCount: number;
  lastUsedAt: Date | null;
}

interface ChangeHistoryEntry {
  id: string;
  date: Date;
  deviceName: string;
  labId?: string;
  labName: string;
  personnelUid?: string;
  personnelName: string;
  serialNumber?: string;
  formType?: string;
}

interface PartDetail {
  totalUsageCount: number;
  lastUsedAt: Date | null;
  devices: { deviceId: string; deviceName: string; labId?: string; labName: string; count: number }[];
  personnel: { uid: string; name: string; count: number }[];
  depoStokCount: number;
  personnelStokCount: number;
  personnelStokByPerson: { uid: string; name: string; count: number }[];
  changeHistory: ChangeHistoryEntry[];
}

function logFirestoreIndexHint(error: unknown, context: string) {
  const err = (error as { message?: string; code?: string; name?: string } | null) || {};
  const message = err.message || '';
  const code = err.code || 'unknown';
  const name = err.name || 'UnknownError';
  const indexUrlMatch = message.match(/https:\/\/console\.firebase\.google\.com\/[^\s]+/);

  console.error(`[${context}] Firestore sorgu hatası`, { code, name, message });

  if (indexUrlMatch) {
    console.error(`[${context}] Firestore index gerekli. Oluşturma linki: ${indexUrlMatch[0]}`);
    return;
  }

  if (code === 'failed-precondition') {
    console.error(`[${context}] Firestore sorgusu index bekliyor. Hata:`, error);
    console.error(`[${context}] Hata mesajında otomatik index linki bulunamadı. Firebase Console > Firestore > Indexes bölümünden kontrol edin.`);
    return;
  }

  if (code.includes('cors') || message.toLowerCase().includes('cors') || message.includes('ERR_FAILED') || message.includes('302')) {
    console.error(`[${context}] Bu hata index değil, ağ/CORS/proxy kaynaklı görünüyor. Index linki bu yüzden üretilemiyor.`);
  }
}

export default function YedekParcaAnaliziPage() {
  const router = useRouter();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [transferLogs, setTransferLogs] = useState<TransferLog[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPart, setSelectedPart] = useState<PartSummary | null>(null);
  const [partDetail, setPartDetail] = useState<PartDetail | null>(null);
  const [deviceLabMap, setDeviceLabMap] = useState<Map<string, { labId: string; labName: string }>>(new Map());
  const [detailLabFilterOpen, setDetailLabFilterOpen] = useState(false);
  const [detailLabSearchTerm, setDetailLabSearchTerm] = useState('');
  const [selectedDetailLabKeys, setSelectedDetailLabKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [transferSnap, hospitalsSnap, assignmentsSnap, devicesSnap] = await Promise.all([
          getDocs(query(collection(db, 'sparePartTransferLogs'), where('action', '==', 'use_on_device'))),
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'hospitalDeviceAssignments')),
          getDocs(collection(db, 'devices')),
        ]);

        const scopedHospitals = filterByCompanyScope(
          hospitalsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
          currentCompanyId,
          isSuperAdmin
        );
        const hMap = new Map<string, Hospital>();
        scopedHospitals.forEach((h) => { hMap.set(h.id, h); });

        const dlMap = new Map<string, { labId: string; labName: string }>();
        filterByCompanyScope(
          devicesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          currentCompanyId,
          isSuperAdmin
        ).forEach((data) => {
          const labId = data.hospitalId || data.hastaneId || '';
          if (labId) {
            const lab = hMap.get(labId);
            dlMap.set(data.id, { labId, labName: lab?.name || 'Bilinmiyor' });
          }
        });
        filterByCompanyScope(
          assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          currentCompanyId,
          isSuperAdmin
        ).forEach((data) => {
          const labId = data.hastaneId || '';
          if (!labId) return;
          const lab = hMap.get(labId);
          const entry = { labId, labName: lab?.name || 'Bilinmiyor' };
          if (!dlMap.has(data.id)) dlMap.set(data.id, entry);
          if (data.cihazId && !dlMap.has(data.cihazId)) dlMap.set(data.cihazId, entry);
          if (data.deviceId && !dlMap.has(data.deviceId)) dlMap.set(data.deviceId, entry);
        });
        setDeviceLabMap(dlMap);

        // Transfer loglarını şirketin cihazlarına göre filtrele (eski kayıtlarda companyId olmayabilir)
        const allLogs = transferSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id, action: data.action, stokKodu: data.stokKodu || '', stokAdi: data.stokAdi || '',
            serialNumber: data.serialNumber, deviceId: data.deviceId, deviceName: data.deviceName,
            createdByUid: data.createdByUid || '', createdByName: data.createdByName || 'Bilinmiyor',
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(data.createdAt),
            formType: data.formType,
            companyId: data.companyId,
          };
        });
        setTransferLogs(
          isSuperAdmin
            ? allLogs
            : allLogs.filter((log) => log.companyId === currentCompanyId || dlMap.has(log.deviceId))
        );
      } catch (error) {
        logFirestoreIndexHint(error, 'yedek-parca-analizi/fetchData');
        console.error('Yedek parça analizi veri hatası:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [currentCompanyId, isSuperAdmin]);

  const partSummaries = useMemo(() => {
    const map = new Map<string, PartSummary>();
    for (const log of transferLogs) {
      if (!log.stokKodu) continue;
      const existing = map.get(log.stokKodu);
      if (existing) {
        existing.usageCount++;
        if (!existing.lastUsedAt || log.createdAt > existing.lastUsedAt) existing.lastUsedAt = log.createdAt;
      } else {
        map.set(log.stokKodu, { stokKodu: log.stokKodu, stokAdi: log.stokAdi, usageCount: 1, lastUsedAt: log.createdAt });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.usageCount - a.usageCount);
  }, [transferLogs]);

  const filteredParts = useMemo(() => {
    if (!searchTerm.trim()) return partSummaries;
    const lower = searchTerm.toLowerCase();
    return partSummaries.filter((p) => p.stokKodu.toLowerCase().includes(lower) || p.stokAdi.toLowerCase().includes(lower));
  }, [partSummaries, searchTerm]);

  const chartData = useMemo(() => {
    return partSummaries.slice(0, 15).map((p) => ({
      name: p.stokAdi.length > 20 ? p.stokAdi.substring(0, 20) + '...' : p.stokAdi,
      fullName: p.stokAdi, stokKodu: p.stokKodu, count: p.usageCount,
    }));
  }, [partSummaries]);

  const selectPart = useCallback(async (part: PartSummary) => {
    setSelectedPart(part);
    setSelectedDetailLabKeys(new Set());
    setDetailLabSearchTerm('');
    setDetailLoading(true);
    try {
      const usageLogs = transferLogs.filter((l) => l.stokKodu === part.stokKodu);
      let lastUsedAt: Date | null = null;
      for (const log of usageLogs) { if (!lastUsedAt || log.createdAt > lastUsedAt) lastUsedAt = log.createdAt; }

      const deviceMap = new Map<string, { deviceId: string; deviceName: string; labId?: string; labName: string; count: number }>();
      for (const log of usageLogs) {
        if (!log.deviceId) continue;
        const existing = deviceMap.get(log.deviceId);
        const labInfo = deviceLabMap.get(log.deviceId);
        const labName = labInfo?.labName || 'Bilinmiyor';
        if (existing) existing.count++;
        else deviceMap.set(log.deviceId, { deviceId: log.deviceId, deviceName: log.deviceName || 'Bilinmiyor', labId: labInfo?.labId, labName, count: 1 });
      }

      const personnelMap = new Map<string, { uid: string; name: string; count: number }>();
      for (const log of usageLogs) {
        if (!log.createdByUid) continue;
        const existing = personnelMap.get(log.createdByUid);
        if (existing) existing.count++;
        else personnelMap.set(log.createdByUid, { uid: log.createdByUid, name: log.createdByName, count: 1 });
      }

      const changeHistory: ChangeHistoryEntry[] = usageLogs.map((log) => {
        const labInfo = deviceLabMap.get(log.deviceId || '');
        return { id: log.id, date: log.createdAt, deviceName: log.deviceName || 'Bilinmiyor', labId: labInfo?.labId, labName: labInfo?.labName || 'Bilinmiyor', personnelUid: log.createdByUid, personnelName: log.createdByName, serialNumber: log.serialNumber, formType: log.formType };
      }).sort((a, b) => b.date.getTime() - a.date.getTime());

      const [depoSnap, personalSnap] = await Promise.all([
        getDocs(query(collection(db, 'yedekParcaDepoStok'), where('stokKodu', '==', part.stokKodu))),
        getDocs(query(collection(db, 'personalStock'), where('stokKodu', '==', part.stokKodu), where('status', '==', 'in_stock'))),
      ]);

      let depoStokCount = 0;
      for (const doc of filterByCompanyScope(
        depoSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        currentCompanyId,
        isSuperAdmin
      )) { depoStokCount += doc.quantity || 1; }

      const personnelStokMap = new Map<string, { uid: string; name: string; count: number }>();
      let totalPersonnelStok = 0;
      for (const data of filterByCompanyScope(
        personalSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        currentCompanyId,
        isSuperAdmin
      )) {
        totalPersonnelStok++;
        const existing = personnelStokMap.get(data.ownerUid);
        if (existing) existing.count++;
        else personnelStokMap.set(data.ownerUid, { uid: data.ownerUid, name: data.ownerName || 'Bilinmiyor', count: 1 });
      }

      setPartDetail({
        totalUsageCount: usageLogs.length, lastUsedAt,
        devices: Array.from(deviceMap.values()).sort((a, b) => b.count - a.count),
        personnel: Array.from(personnelMap.values()).sort((a, b) => b.count - a.count),
        depoStokCount, personnelStokCount: totalPersonnelStok,
        personnelStokByPerson: Array.from(personnelStokMap.values()).sort((a, b) => b.count - a.count),
        changeHistory,
      });
    } catch (error) {
      logFirestoreIndexHint(error, 'yedek-parca-analizi/selectPart');
      console.error('Parça detay hatası:', error);
    } finally {
      setDetailLoading(false);
    }
  }, [transferLogs, deviceLabMap, currentCompanyId, isSuperAdmin]);

  const formatDate = (date: Date | null) => {
    if (!date) return '-';
    try { return format(date, 'dd MMM yyyy HH:mm', { locale: tr }); } catch { return '-'; }
  };

  const formatDateShort = (date: Date | null) => {
    if (!date) return '-';
    try { return format(date, 'dd.MM.yyyy', { locale: tr }); } catch { return '-'; }
  };

  const getDetailLabKey = useCallback((entry: { labId?: string; labName: string }) => {
    if (entry.labId) return `id:${entry.labId}`;
    return `name:${entry.labName || 'Bilinmiyor'}`;
  }, []);

  const detailLabOptions = useMemo(() => {
    if (!partDetail) return [] as { key: string; name: string }[];
    const map = new Map<string, string>();
    for (const entry of partDetail.changeHistory) {
      const key = getDetailLabKey(entry);
      if (!map.has(key)) map.set(key, entry.labName || 'Bilinmiyor');
    }
    return Array.from(map.entries())
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [partDetail, getDetailLabKey]);

  const filteredDetailLabOptions = useMemo(() => {
    if (!detailLabSearchTerm.trim()) return detailLabOptions;
    const lower = detailLabSearchTerm.toLowerCase();
    return detailLabOptions.filter((opt) => opt.name.toLowerCase().includes(lower));
  }, [detailLabOptions, detailLabSearchTerm]);

  const filteredPartDetail = useMemo(() => {
    if (!partDetail) return null;
    if (selectedDetailLabKeys.size === 0) return partDetail;

    const filteredChangeHistory = partDetail.changeHistory.filter((entry) => selectedDetailLabKeys.has(getDetailLabKey(entry)));
    const filteredDevices = partDetail.devices.filter((d) => selectedDetailLabKeys.has(getDetailLabKey(d)));

    const personnelMap = new Map<string, { uid: string; name: string; count: number }>();
    for (const entry of filteredChangeHistory) {
      const uid = entry.personnelUid || entry.personnelName;
      const existing = personnelMap.get(uid);
      if (existing) existing.count += 1;
      else personnelMap.set(uid, { uid, name: entry.personnelName || 'Bilinmiyor', count: 1 });
    }

    let lastUsedAt: Date | null = null;
    for (const entry of filteredChangeHistory) {
      if (!lastUsedAt || entry.date > lastUsedAt) lastUsedAt = entry.date;
    }

    return {
      ...partDetail,
      totalUsageCount: filteredChangeHistory.length,
      lastUsedAt,
      devices: filteredDevices,
      personnel: Array.from(personnelMap.values()).sort((a, b) => b.count - a.count),
      changeHistory: filteredChangeHistory,
    };
  }, [partDetail, selectedDetailLabKeys, getDetailLabKey]);

  const detailView = filteredPartDetail;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Veriler yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        {selectedPart ? (
          <Button variant="ghost" size="sm" onClick={() => { setSelectedPart(null); setPartDetail(null); setSelectedDetailLabKeys(new Set()); setDetailLabSearchTerm(''); }}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Geri
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => router.push('/cihaz-yonetimi-ana')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Geri
          </Button>
        )}
        <div>
          {selectedPart ? (
            <>
              <h1 className="text-xl font-bold">{selectedPart.stokAdi}</h1>
              <p className="text-sm text-muted-foreground font-mono">{selectedPart.stokKodu}</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Package className="h-6 w-6 text-primary" />
                Yedek Parça Analizi
              </h1>
              <p className="text-sm text-muted-foreground">En çok değişen yedek parçalar ve detaylı parça ekstresi</p>
            </>
          )}
        </div>
      </div>

      {selectedPart ? (
        /* DETAIL VIEW */
        detailLoading ? (
          <div className="flex items-center justify-center min-h-[40vh]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Parça detayları yükleniyor...</span>
          </div>
        ) : detailView ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Popover open={detailLabFilterOpen} onOpenChange={setDetailLabFilterOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2 h-9">
                    <Building2 className="h-4 w-4" />
                    {selectedDetailLabKeys.size === 0 ? 'Tüm Kurumlar' : `${selectedDetailLabKeys.size} Kurum`}
                    <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input placeholder="Kurum ara..." value={detailLabSearchTerm} onChange={(e) => setDetailLabSearchTerm(e.target.value)} className="pl-8 h-8 text-sm" />
                    </div>
                  </div>
                  <ScrollArea className="h-[240px]">
                    <div className="p-1">
                      {filteredDetailLabOptions.map((opt) => (
                        <div
                          key={opt.key}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer"
                          onClick={() => setSelectedDetailLabKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(opt.key)) next.delete(opt.key);
                            else next.add(opt.key);
                            return next;
                          })}
                        >
                          <Checkbox checked={selectedDetailLabKeys.has(opt.key)} />
                          <span className="text-sm truncate">{opt.name}</span>
                        </div>
                      ))}
                      {filteredDetailLabOptions.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sonuç bulunamadı</p>}
                    </div>
                  </ScrollArea>
                  {selectedDetailLabKeys.size > 0 && (
                    <div className="p-2 border-t">
                      <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setSelectedDetailLabKeys(new Set())}>
                        <X className="h-3 w-3 mr-1" /> Filtreyi Temizle
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Card><CardContent className="pt-3 pb-2 px-3"><div className="flex items-center gap-2"><Package className="h-4 w-4 text-primary" /><div><p className="text-xs text-muted-foreground">Toplam Kullanım</p><p className="text-xl font-bold">{detailView.totalUsageCount}</p></div></div></CardContent></Card>
              <Card><CardContent className="pt-3 pb-2 px-3"><div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-yellow-500" /><div><p className="text-xs text-muted-foreground">Son Değişim</p><p className="text-sm font-semibold">{formatDateShort(detailView.lastUsedAt)}</p></div></div></CardContent></Card>
              <Card><CardContent className="pt-3 pb-2 px-3"><div className="flex items-center gap-2"><Monitor className="h-4 w-4 text-blue-500" /><div><p className="text-xs text-muted-foreground">Cihaz Sayısı</p><p className="text-xl font-bold">{detailView.devices.length}</p></div></div></CardContent></Card>
              <Card><CardContent className="pt-3 pb-2 px-3"><div className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-green-500" /><div><p className="text-xs text-muted-foreground">Depo Stok</p><p className="text-xl font-bold">{detailView.depoStokCount}</p></div></div></CardContent></Card>
              <Card><CardContent className="pt-3 pb-2 px-3"><div className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-orange-500" /><div><p className="text-xs text-muted-foreground">Personel Stok</p><p className="text-xl font-bold">{detailView.personnelStokCount}</p></div></div></CardContent></Card>
            </div>

            {/* Change History */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" />Değişim Ekstresi ({detailView.changeHistory.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>Cihaz</TableHead><TableHead>Laboratuvar</TableHead><TableHead>Personel</TableHead><TableHead>Seri No</TableHead><TableHead className="text-center">Tip</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detailView.changeHistory.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(entry.date)}</TableCell>
                        <TableCell className="font-medium text-sm">{entry.deviceName}</TableCell>
                        <TableCell className="text-sm"><span className="flex items-center gap-1"><Building2 className="h-3 w-3 text-muted-foreground shrink-0" />{entry.labName}</span></TableCell>
                        <TableCell className="text-sm">{entry.personnelName}</TableCell>
                        <TableCell className="font-mono text-xs">{entry.serialNumber || '-'}</TableCell>
                        <TableCell className="text-center">
                          {entry.formType === 'teknik_servis' ? <Badge className="bg-blue-500/20 text-blue-400 text-xs">Teknik</Badge>
                            : entry.formType === 'aplikasyon' ? <Badge className="bg-green-500/20 text-green-400 text-xs">App</Badge>
                            : <span className="text-xs text-muted-foreground">-</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {detailView.changeHistory.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">Değişim kaydı bulunamadı</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Devices Table */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Monitor className="h-4 w-4" />Kullanıldığı Cihazlar</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Cihaz</TableHead><TableHead>Laboratuvar</TableHead><TableHead className="text-center">Kullanım Sayısı</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detailView.devices.map((d) => (
                      <TableRow key={d.deviceId}>
                        <TableCell className="font-medium">{d.deviceName}</TableCell>
                        <TableCell><span className="flex items-center gap-1 text-sm"><Building2 className="h-3 w-3 text-muted-foreground shrink-0" />{d.labName}</span></TableCell>
                        <TableCell className="text-center">{d.count}</TableCell>
                      </TableRow>
                    ))}
                    {detailView.devices.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">Cihaz verisi yok</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Personnel Usage */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />Personel Bazlı Kullanım</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Personel</TableHead><TableHead className="text-center">Kullanım Sayısı</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detailView.personnel.map((p) => (<TableRow key={p.uid}><TableCell className="font-medium">{p.name}</TableCell><TableCell className="text-center">{p.count}</TableCell></TableRow>))}
                    {detailView.personnel.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-4">Personel verisi yok</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Personnel Stock */}
            {detailView.personnelStokByPerson.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><UserCheck className="h-4 w-4" />Personel Stok Dağılımı</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Personel</TableHead><TableHead className="text-center">Elindeki Adet</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detailView.personnelStokByPerson.map((p) => (<TableRow key={p.uid}><TableCell className="font-medium">{p.name}</TableCell><TableCell className="text-center">{p.count}</TableCell></TableRow>))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        ) : null
      ) : (
        /* LIST VIEW */
        <>
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">En Çok Değişen Yedek Parçalar (Top 15)</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 11 }} />
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0]?.payload;
                        return (<div className="glass-card p-3 text-sm"><p className="font-semibold mb-1">{data?.fullName}</p><p className="text-muted-foreground text-xs">{data?.stokKodu}</p><p className="text-primary font-semibold mt-1">Kullanım: {data?.count}</p></div>);
                      }} />
                      <Bar dataKey="count" fill="#8884d8" name="Kullanım Sayısı" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Parça Listesi</CardTitle>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Stok kodu veya adı ile ara..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Stok Kodu</TableHead>
                    <TableHead>Stok Adı</TableHead>
                    <TableHead className="text-center">Kullanım</TableHead>
                    <TableHead className="text-center">Son Değişim</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredParts.map((p, i) => (
                    <TableRow key={p.stokKodu} className="cursor-pointer hover:bg-accent/50" onClick={() => selectPart(p)}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{p.stokKodu}</TableCell>
                      <TableCell className="font-medium">{p.stokAdi}</TableCell>
                      <TableCell className="text-center font-semibold">{p.usageCount}</TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">{formatDateShort(p.lastUsedAt)}</TableCell>
                      <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                    </TableRow>
                  ))}
                  {filteredParts.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{searchTerm ? 'Arama sonucu bulunamadı' : 'Yedek parça verisi bulunamadı'}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
