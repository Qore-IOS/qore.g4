'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Search, Building2, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import type { Hospital } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { getScopedDocs } from '@/lib/firestore-helpers';
import {
  ClayPage, PageHead, Card, CardHead, KpiTile, MiniInfo, Pill, GhostBtn,
  ClaySearch, HBar, ClayLoader, C, PAL, useMode, fmtInt,
} from '@/components/cihaz-yonetimi/clay-kit';

interface TransferLog {
  id: string;
  action: string;
  stokKodu: string;
  stokAdi: string;
  serialNumber?: string;
  quantity: number;
  deviceId?: string;
  deviceName?: string;
  createdByUid: string;
  createdByName: string;
  createdAt: Date;
  formType?: 'teknik_servis' | 'aplikasyon' | string;
  companyId?: string;
  personalStockId?: string;
  poolStockId?: string;
  borrowedPartId?: string;
  sourceCollection?: string;
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
  quantity: number;
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
  const mode = useMode();
  const mobile = mode === 'mobile';
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
        // Legacy-aware: getScopedDocs companyId'si eksik ya da __legacy__ etiketli
        // eski sparePartTransferLogs/hospitals/devices kayıtlarını da getirir.
        // scopedQuery'nin server-side where('companyId', '==', X) filtresi bu
        // kayıtları dışarıda bırakıp panelde "sadece son birkaç" değişim
        // görünmesine yol açıyordu (eski form+arıza işlemleri görünmez kalıyordu).
        const [useOnDeviceDocs, borrowedPartDocs, useFromPoolDocs, usedPersonalStockDocs, usedPoolStockDocs, hospitalDocs, assignmentDocs, deviceDocs] = await Promise.all([
          getScopedDocs('sparePartTransferLogs', currentCompanyId, isSuperAdmin, where('action', '==', 'use_on_device')),
          getScopedDocs('sparePartTransferLogs', currentCompanyId, isSuperAdmin, where('action', '==', 'borrowed_part')),
          getScopedDocs('sparePartTransferLogs', currentCompanyId, isSuperAdmin, where('action', '==', 'use_from_pool')),
          getScopedDocs('personalStock', currentCompanyId, isSuperAdmin, where('status', '==', 'used')),
          getScopedDocs('poolWarehouseStock', currentCompanyId, isSuperAdmin, where('status', '==', 'used')),
          getScopedDocs('hospitals', currentCompanyId, isSuperAdmin),
          getScopedDocs('hospitalDeviceAssignments', currentCompanyId, isSuperAdmin),
          getScopedDocs('devices', currentCompanyId, isSuperAdmin),
        ]);

        const scopedHospitals = filterByCompanyScope(
          hospitalDocs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
          currentCompanyId,
          isSuperAdmin
        );
        const hMap = new Map<string, Hospital>();
        scopedHospitals.forEach((h) => { hMap.set(h.id, h); });

        const dlMap = new Map<string, { labId: string; labName: string }>();
        filterByCompanyScope(
          deviceDocs.map((d) => ({ id: d.id, ...d.data() } as any)),
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
          assignmentDocs.map((d) => ({ id: d.id, ...d.data() } as any)),
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

        const mapLog = (d: any) => {
          const data = d.data();
          return {
            id: d.id, action: data.action, stokKodu: data.stokKodu || '', stokAdi: data.stokAdi || '',
            serialNumber: data.serialNumber,
            quantity: Math.max(1, Number(data.quantity) || 1),
            deviceId: data.deviceId, deviceName: data.deviceName,
            createdByUid: data.createdByUid || '', createdByName: data.createdByName || 'Bilinmiyor',
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(data.createdAt),
            formType: data.formType,
            companyId: data.companyId,
            borrowedPartId: data.borrowedPartId,
            personalStockId: data.personalStockId,
            poolStockId: data.poolStockId,
            sourceCollection: 'sparePartTransferLogs',
          };
        };

        const toDate = (value: any) => value instanceof Timestamp ? value.toDate() : value ? new Date(value) : new Date(0);

        // use_on_device: tüm onaylı parça değişimleri (form + arıza kaynaklı)
        const useOnDeviceLogs = useOnDeviceDocs.map(mapLog);

        // borrowed_part: arızadan kaynaklanan ama henüz onaylanmamış veya hücre değişimleri
        // use_on_device ile zaten referans edilen borrowedPartId'leri çıkar (mükerrer sayımı önlemek için)
        const approvedBorrowedIds = new Set(useOnDeviceLogs.map(l => l.borrowedPartId).filter(Boolean));
        const arizaBorrowedLogs = borrowedPartDocs
          .map(mapLog)
          .filter(l => l.formType === 'ariza_yonetimi' && !approvedBorrowedIds.has(l.id));

        const useFromPoolLogs = useFromPoolDocs.map(mapLog);

        const loggedPersonalStockIds = new Set(useOnDeviceLogs.map(l => l.personalStockId).filter(Boolean));
        const loggedPoolStockIds = new Set(useFromPoolLogs.map(l => l.poolStockId).filter(Boolean));

        // Eski/kapanış sonrası kayıtlarda stok satırı 'used' yapılmış olsa bile
        // sparePartTransferLogs'a kullanım logu yazılmamış olabiliyor. Analiz
        // panelinde gerçek adet yerine sadece loglanmış birkaç satırın görünmesinin
        // ana sebebi buydu. Bu nedenle logu olmayan kullanılmış stok satırlarını
        // sentetik kullanım kaydı olarak ekliyoruz; logu olanları ise mükerrer
        // saymamak için personalStockId/poolStockId ile eliyoruz.
        const usedPersonalStockLogs: TransferLog[] = usedPersonalStockDocs
          .map((d: any) => {
            const data = d.data();
            return {
              id: `personalStock:${d.id}`,
              action: 'used_personal_stock',
              stokKodu: data.stokKodu || '',
              stokAdi: data.stokAdi || '',
              serialNumber: data.serialNumber,
              quantity: Math.max(1, Number(data.quantity) || 1),
              deviceId: data.usedOnDeviceId,
              deviceName: data.usedOnDeviceName,
              createdByUid: data.usedByUid || data.ownerUid || '',
              createdByName: data.usedByName || data.ownerName || 'Bilinmiyor',
              createdAt: toDate(data.usedAt || data.updatedAt || data.createdAt),
              formType: data.usedOnFormType,
              companyId: data.companyId,
              personalStockId: d.id,
              sourceCollection: 'personalStock',
            };
          })
          .filter((l) => l.stokKodu && !loggedPersonalStockIds.has(l.personalStockId));

        const usedPoolStockLogs: TransferLog[] = usedPoolStockDocs
          .map((d: any) => {
            const data = d.data();
            return {
              id: `poolWarehouseStock:${d.id}`,
              action: 'used_pool_stock',
              stokKodu: data.stokKodu || '',
              stokAdi: data.stokAdi || '',
              serialNumber: data.serialNumber,
              quantity: Math.max(1, Number(data.quantity) || 1),
              deviceId: data.usedOnDeviceId,
              deviceName: data.usedOnDeviceName,
              createdByUid: data.usedByUid || '',
              createdByName: data.usedByName || 'Bilinmiyor',
              createdAt: toDate(data.usedAt || data.updatedAt || data.createdAt),
              formType: data.usedOnFormType,
              companyId: data.companyId,
              poolStockId: d.id,
              sourceCollection: 'poolWarehouseStock',
            };
          })
          .filter((l) => l.stokKodu && !loggedPoolStockIds.has(l.poolStockId));

        const allLogs = [...useOnDeviceLogs, ...useFromPoolLogs, ...arizaBorrowedLogs, ...usedPersonalStockLogs, ...usedPoolStockLogs];

        // Transfer loglarını şirketin cihazlarına göre filtrele (eski kayıtlarda companyId olmayabilir)
        // companyId boş/__legacy__ kayıtlar getScopedDocs üzerinden geliyor; burada
        // ek olarak deviceId şirket cihazlarıyla eşleşenleri de tutarak şirket dışı
        // bir cihaza ait legacy log sızmasını engelliyoruz.
        setTransferLogs(
          isSuperAdmin
            ? allLogs
            : allLogs.filter((log) => {
                const tag = (log.companyId || '').trim();
                if (!tag || tag === '__legacy__') return dlMap.has(log.deviceId || '');
                return tag === currentCompanyId;
              })
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
        existing.usageCount += log.quantity;
        if (!existing.lastUsedAt || log.createdAt > existing.lastUsedAt) existing.lastUsedAt = log.createdAt;
      } else {
        map.set(log.stokKodu, { stokKodu: log.stokKodu, stokAdi: log.stokAdi, usageCount: log.quantity, lastUsedAt: log.createdAt });
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
        if (existing) existing.count += log.quantity;
        else deviceMap.set(log.deviceId, { deviceId: log.deviceId, deviceName: log.deviceName || 'Bilinmiyor', labId: labInfo?.labId, labName, count: log.quantity });
      }

      const personnelMap = new Map<string, { uid: string; name: string; count: number }>();
      for (const log of usageLogs) {
        if (!log.createdByUid) continue;
        const existing = personnelMap.get(log.createdByUid);
        if (existing) existing.count += log.quantity;
        else personnelMap.set(log.createdByUid, { uid: log.createdByUid, name: log.createdByName, count: log.quantity });
      }

      const changeHistory: ChangeHistoryEntry[] = usageLogs.map((log) => {
        const labInfo = deviceLabMap.get(log.deviceId || '');
        return { id: log.id, date: log.createdAt, deviceName: log.deviceName || 'Bilinmiyor', labId: labInfo?.labId, labName: labInfo?.labName || 'Bilinmiyor', personnelUid: log.createdByUid, personnelName: log.createdByName, serialNumber: log.serialNumber, quantity: log.quantity, formType: log.formType };
      }).sort((a, b) => b.date.getTime() - a.date.getTime());

      const [depoDocs, personalDocs] = await Promise.all([
        getScopedDocs('yedekParcaDepoStok', currentCompanyId, isSuperAdmin, where('stokKodu', '==', part.stokKodu)),
        getScopedDocs('personalStock', currentCompanyId, isSuperAdmin, where('stokKodu', '==', part.stokKodu), where('status', '==', 'in_stock')),
      ]);

      let depoStokCount = 0;
      for (const doc of filterByCompanyScope(
        depoDocs.map((d) => ({ id: d.id, ...d.data() } as any)),
        currentCompanyId,
        isSuperAdmin
      )) { depoStokCount += doc.quantity || 1; }

      const personnelStokMap = new Map<string, { uid: string; name: string; count: number }>();
      let totalPersonnelStok = 0;
      for (const data of filterByCompanyScope(
        personalDocs.map((d) => ({ id: d.id, ...d.data() } as any)),
        currentCompanyId,
        isSuperAdmin
      )) {
        totalPersonnelStok++;
        const existing = personnelStokMap.get(data.ownerUid);
        if (existing) existing.count++;
        else personnelStokMap.set(data.ownerUid, { uid: data.ownerUid, name: data.ownerName || 'Bilinmiyor', count: 1 });
      }

      setPartDetail({
        totalUsageCount: usageLogs.reduce((sum, l) => sum + l.quantity, 0), lastUsedAt,
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
      if (existing) existing.count += entry.quantity;
      else personnelMap.set(uid, { uid, name: entry.personnelName || 'Bilinmiyor', count: entry.quantity });
    }

    let lastUsedAt: Date | null = null;
    for (const entry of filteredChangeHistory) {
      if (!lastUsedAt || entry.date > lastUsedAt) lastUsedAt = entry.date;
    }

    return {
      ...partDetail,
      totalUsageCount: filteredChangeHistory.reduce((sum, e) => sum + e.quantity, 0),
      lastUsedAt,
      devices: filteredDevices,
      personnel: Array.from(personnelMap.values()).sort((a, b) => b.count - a.count),
      changeHistory: filteredChangeHistory,
    };
  }, [partDetail, selectedDetailLabKeys, getDetailLabKey]);

  const detailView = filteredPartDetail;

  const chartItems = useMemo(
    () => chartData.map((d) => ({ label: d.fullName, v: d.count })),
    [chartData]
  );

  const labelW = mobile ? 110 : 200;

  // ── table styles ──────────────────────────────────────────────────────────
  const thStyle: React.CSSProperties = {
    textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.ink3,
    letterSpacing: '0.04em', textTransform: 'uppercase', padding: '0 12px 10px',
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: C.ink1, padding: '11px 12px',
    borderTop: `1px solid ${C.line}`, verticalAlign: 'middle',
  };

  const TipChip = ({ formType }: { formType?: string }) => {
    if (formType === 'teknik_servis') {
      return <span style={{ padding: '3px 10px', borderRadius: C.radiusPill, background: 'rgba(124,168,222,0.18)', color: PAL.sky, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>Teknik</span>;
    }
    if (formType === 'aplikasyon') {
      return <span style={{ padding: '3px 10px', borderRadius: C.radiusPill, background: 'rgba(78,158,107,0.18)', color: C.waterDeep, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>App</span>;
    }
    return <span style={{ fontSize: 12, color: C.ink3 }}>-</span>;
  };

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <ClayPage>
        <ClayLoader label="Veriler yükleniyor…" />
      </ClayPage>
    );
  }

  // ── DETAIL VIEW ───────────────────────────────────────────────────────────
  if (selectedPart) {
    return (
      <ClayPage>
        <PageHead
          ico="box"
          title={selectedPart.stokAdi}
          sub={selectedPart.stokKodu}
          mobile={mobile}
          onBack={() => { setSelectedPart(null); setPartDetail(null); setSelectedDetailLabKeys(new Set()); setDetailLabSearchTerm(''); }}
        />

        {detailLoading ? (
          <ClayLoader label="Parça detayları yükleniyor…" />
        ) : detailView ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 12 : 16 }}>
            {/* Lab filter */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Popover open={detailLabFilterOpen} onOpenChange={setDetailLabFilterOpen}>
                <PopoverTrigger asChild>
                  <span style={{ display: 'inline-flex' }}>
                    <GhostBtn active={selectedDetailLabKeys.size > 0}>
                      <Building2 size={16} />
                      {selectedDetailLabKeys.size === 0 ? 'Tüm Kurumlar' : `${selectedDetailLabKeys.size} Kurum`}
                      <span style={{ opacity: 0.5 }}>▾</span>
                    </GhostBtn>
                  </span>
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
                      <button
                        type="button"
                        className="w-full text-xs flex items-center justify-center gap-1 py-1.5 rounded-md hover:bg-accent/50"
                        onClick={() => setSelectedDetailLabKeys(new Set())}
                      >
                        <X className="h-3 w-3" /> Filtreyi Temizle
                      </button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: mobile ? 10 : 14 }}>
              <KpiTile ico="box" label="Toplam Kullanım" value={detailView.totalUsageCount} delay={0} />
              <MiniInfo ico="calendar" label="Son Değişim" text={formatDateShort(detailView.lastUsedAt)} delay={40} />
              <KpiTile ico="monitor" label="Cihaz Sayısı" value={detailView.devices.length} tone="tech" delay={80} />
              <KpiTile ico="warehouse" label="Depo Stok" value={detailView.depoStokCount} tone="ok" delay={120} />
              <KpiTile ico="users" label="Personel Stok" value={detailView.personnelStokCount} tone="amber" delay={160} />
            </div>

            {/* Change history */}
            <Card>
              <CardHead ico="clock" title={`Değişim Ekstresi (${detailView.changeHistory.length})`} />
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <div style={{ minWidth: 720 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Tarih</th>
                        <th style={thStyle}>Cihaz</th>
                        <th style={thStyle}>Laboratuvar</th>
                        <th style={thStyle}>Personel</th>
                        <th style={thStyle}>Seri No</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Tip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailView.changeHistory.map((entry) => (
                        <tr key={entry.id}>
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: 12, color: C.ink2 }}>{formatDate(entry.date)}</td>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{entry.deviceName}</td>
                          <td style={tdStyle}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Building2 size={12} style={{ color: C.ink3, flexShrink: 0 }} />{entry.labName}
                            </span>
                          </td>
                          <td style={tdStyle}>{entry.personnelName}</td>
                          <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: C.ink2 }}>{entry.serialNumber || '-'}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}><TipChip formType={entry.formType} /></td>
                        </tr>
                      ))}
                      {detailView.changeHistory.length === 0 && (
                        <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: C.ink3, padding: '24px 12px' }}>Değişim kaydı bulunamadı</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            {/* Devices */}
            <Card>
              <CardHead ico="monitor" title="Kullanıldığı Cihazlar" />
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <div style={{ minWidth: 720 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Cihaz</th>
                        <th style={thStyle}>Laboratuvar</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Kullanım Sayısı</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailView.devices.map((d) => (
                        <tr key={d.deviceId}>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{d.deviceName}</td>
                          <td style={tdStyle}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Building2 size={12} style={{ color: C.ink3, flexShrink: 0 }} />{d.labName}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 800 }}>{d.count}</td>
                        </tr>
                      ))}
                      {detailView.devices.length === 0 && (
                        <tr><td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: C.ink3, padding: '24px 12px' }}>Cihaz verisi yok</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            {/* Personnel usage */}
            <Card>
              <CardHead ico="users" title="Personel Bazlı Kullanım" />
              {detailView.personnel.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <HBar
                    items={detailView.personnel.map((p) => ({ label: p.name, v: p.count }))}
                    color={PAL.tech}
                    labelW={labelW}
                  />
                </div>
              ) : (
                <div style={{ fontSize: 13, color: C.ink3, padding: '14px 4px' }}>Personel verisi yok</div>
              )}
            </Card>

            {/* Personnel stock distribution */}
            {detailView.personnelStokByPerson.length > 0 && (
              <Card>
                <CardHead ico="users" title="Personel Stok Dağılımı" />
                <div style={{ marginTop: 12 }}>
                  <HBar
                    items={detailView.personnelStokByPerson.map((p) => ({ label: p.name, v: p.count }))}
                    color={PAL.amber}
                    labelW={labelW}
                  />
                </div>
              </Card>
            )}
          </div>
        ) : null}
      </ClayPage>
    );
  }

  // ── LIST VIEW ─────────────────────────────────────────────────────────────
  return (
    <ClayPage>
      <PageHead
        ico="box"
        title="Yedek Parça Analizi"
        sub="En çok değişen yedek parçalar ve detaylı parça ekstresi"
        mobile={mobile}
        onBack={() => router.push('/cihaz-yonetimi-ana')}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 12 : 16 }}>
        {chartItems.length > 0 && (
          <Card>
            <CardHead ico="chart" title="En Çok Değişen Yedek Parçalar (Top 15)" />
            <div style={{ marginTop: 14 }}>
              <HBar items={chartItems} color={PAL.admin} labelW={labelW} />
            </div>
          </Card>
        )}

        <Card>
          <CardHead
            ico="package"
            title="Parça Listesi"
            right={<Pill>{fmtInt(filteredParts.length)} parça</Pill>}
          />
          <div style={{ marginTop: 12 }}>
            <ClaySearch value={searchTerm} onChange={setSearchTerm} placeholder="Stok kodu veya adı ile ara..." />
          </div>

          {/* Desktop header row */}
          {!mobile && filteredParts.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '40px 150px 1fr 100px 130px 40px', gap: 10, alignItems: 'center', padding: '14px 14px 8px', ...{} }}>
              {['#', 'Stok Kodu', 'Stok Adı', 'Kullanım', 'Son Değişim', ''].map((h, i) => (
                <span key={i} style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase', textAlign: i >= 3 && i <= 4 ? 'center' : 'left' }}>{h}</span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 10 : 6, marginTop: mobile ? 12 : 0 }}>
            {filteredParts.map((p, i) => (
              mobile ? (
                <button
                  key={p.stokKodu}
                  type="button"
                  onClick={() => selectPart(p)}
                  style={{
                    all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12,
                    padding: 14, borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.stokAdi}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink3, marginTop: 3, fontFamily: 'monospace' }}>{p.stokKodu} · {formatDateShort(p.lastUsedAt)}</div>
                  </div>
                  <span style={{ padding: '5px 12px', borderRadius: C.radiusPill, background: C.accent + '16', color: C.accent, fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0 }}>{p.usageCount}</span>
                </button>
              ) : (
                <div
                  key={p.stokKodu}
                  className="cy-row-hover"
                  onClick={() => selectPart(p)}
                  style={{
                    display: 'grid', gridTemplateColumns: '40px 150px 1fr 100px 130px 40px', gap: 10, alignItems: 'center',
                    padding: '12px 14px', borderRadius: C.radiusSm, cursor: 'pointer',
                    borderTop: `1px solid ${C.line}`,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.ink3 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.stokKodu}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.stokAdi}</span>
                  <span style={{ textAlign: 'center' }}>
                    <span style={{ padding: '4px 12px', borderRadius: C.radiusPill, background: C.accent + '16', color: C.accent, fontSize: 13, fontWeight: 800 }}>{p.usageCount}</span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.ink3, textAlign: 'center' }}>{formatDateShort(p.lastUsedAt)}</span>
                  <span style={{ display: 'grid', placeItems: 'center', color: C.ink3 }}>›</span>
                </div>
              )
            ))}
            {filteredParts.length === 0 && (
              <div style={{ textAlign: 'center', color: C.ink3, fontSize: 13.5, fontWeight: 600, padding: '40px 12px' }}>
                {searchTerm ? 'Arama sonucu bulunamadı' : 'Yedek parça verisi bulunamadı'}
              </div>
            )}
          </div>
        </Card>
      </div>
    </ClayPage>
  );
}
