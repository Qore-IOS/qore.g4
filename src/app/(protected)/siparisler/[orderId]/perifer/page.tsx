/**
 * @fileoverview Peripheral Order Office Logistics Page
 * @description Office-side logistics view for orders created by peripheral labs.
 * Unlike the warehouse picking flow, this screen is driven by confirmation
 * checkboxes rather than barcode scanning. It shows, per requested product,
 * how much stock the peripheral lab currently holds, the last transfer, the
 * closest-miad lot, and lets the office mark rows as fulfilled (optionally
 * adjusting the sent quantity when it differs from the requested amount).
 *
 * Workflow:
 *  - All rows fulfilled  → order moves to "completed".
 *  - At least one partial/unfulfilled row → order stays in "bekleyen" with
 *    status="eksik" so the office can continue following up.
 */
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from '../../../../../lib/data/client';
import { compareAsc, format as formatDateFns, parse as parseDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  CheckCircle2,
  ChevronLeft,
  Edit3,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Save,
  Send,
  Share2,
  Truck,
} from 'lucide-react';

import { db } from '../../../../../lib/data/client';
import { archiveCompletedOrderInBatch } from '@/lib/orders-archive';
import type {
  Depot,
  DepoStokItem,
  Hospital,
  Order,
  ProductCode,
} from '@/lib/types';
import { exportDataToExcel } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type PeripheralFulfillmentItem = {
  itemId: string;
  stokKodu: string;
  requestedAdet: number;
  sentAdet: number;
  fulfilled: boolean;
};
import { cn } from '@/lib/utils';
import { formatMiad, toDateFromAny } from '@/lib/date';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/document-helpers';
import { useToast } from '@/hooks/use-toast';

type LabStockInfo = {
  totalAdet: number;
  closestLot: {
    lotNumarasi: string;
    miad: string;
    adet: number;
  } | null;
  lastTransfer: {
    date: Date;
    depotId?: string;
    depotName?: string;
  } | null;
};

type RowState = {
  itemId: string;
  stokKodu: string;
  stokAdi: string;
  requestedAdet: number;
  sentAdet: number;
  fulfilled: boolean;
};

function safeParseMiad(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    try {
      const d = parseDate(value, 'dd.MM.yyyy', new Date());
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  return toDateFromAny(value as any) ?? null;
}

export default function PeripheralOrderPage() {
  const params = useParams();
  const orderId = (params?.orderId as string) ?? '';
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const [order, setOrder] = useState<Order | null>(null);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [labStock, setLabStock] = useState<DepoStokItem[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);

  const [rows, setRows] = useState<RowState[]>([]);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [isRouteDialogOpen, setIsRouteDialogOpen] = useState(false);
  const [routeDepotId, setRouteDepotId] = useState<string>('');
  const [isRouting, setIsRouting] = useState(false);

  // ── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        const orderSnap = await getDoc(doc(db, 'orders', orderId));
        if (!orderSnap.exists()) {
          toast({ title: 'Hata', description: 'Sipariş bulunamadı.', variant: 'destructive' });
          router.push('/siparisler');
          return;
        }
        const orderData = { id: orderSnap.id, ...orderSnap.data() } as Order;
        if (cancelled) return;
        setOrder(orderData);

        const [hospitalsSnap, depotsSnap, productsSnap] = await Promise.all([
          getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('depots', currentCompanyId, isSuperAdmin)),
          getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
        ]);
        const hospitals = hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital));
        const depotList = depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
        const products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode));

        const targetHospital =
          hospitals.find(h => h.id === orderData.labId) ||
          hospitals.find(h => h.name === orderData.kurumAdi || h.ad === orderData.kurumAdi) ||
          null;

        // Lab stock = depoStok that was shipped to this hospital
        const shippedSnap = await getDocs(
          scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('isShipped', '==', true))
        );
        const shippedAll = filterByCompanyScope(
          shippedSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
          currentCompanyId,
          isSuperAdmin,
        );
        const shippedToLab = shippedAll.filter(st => {
          if (!targetHospital) return false;
          if (st.hedefKurumId && st.hedefKurumId === targetHospital.id) return true;
          if (!st.hedefKurumId && st.hedefKurum && targetHospital.name && st.hedefKurum === targetHospital.name) return true;
          return false;
        });

        if (cancelled) return;
        setHospital(targetHospital);
        setDepots(depotList);
        setProductCodes(products);
        setLabStock(shippedToLab);

        // Seed rows from order.items, respecting any existing fulfillment
        const existingByItemId = new Map<string, PeripheralFulfillmentItem>();
        (orderData.peripheralFulfillment?.items || []).forEach(it => {
          if (it.itemId) existingByItemId.set(it.itemId, it);
        });
        const initialRows: RowState[] = (orderData.items || []).map(it => {
          const prior = existingByItemId.get(it.id);
          return {
            itemId: it.id,
            stokKodu: it.stokKodu,
            stokAdi: it.stokAdi,
            requestedAdet: Number(it.adet) || 0,
            sentAdet: prior?.sentAdet ?? (Number(it.adet) || 0),
            fulfilled: prior?.fulfilled ?? false,
          };
        });
        setRows(initialRows);
      } catch (e) {
        console.error(e);
        toast({ title: 'Hata', description: 'Sipariş verileri yüklenemedi.', variant: 'destructive' });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, toast, router, currentCompanyId, isSuperAdmin]);

  // ── Derived: per-product lab stock summary ─────────────────────────────
  const depotNameById = useMemo(() => {
    const m = new Map<string, string>();
    depots.forEach(d => {
      if (d.id) m.set(d.id, d.name ?? d.id);
    });
    return m;
  }, [depots]);

  const productMetaByCode = useMemo(() => {
    const m = new Map<string, ProductCode>();
    productCodes.forEach(p => {
      if (p.stokKodu) m.set(p.stokKodu, p);
    });
    return m;
  }, [productCodes]);

  const labStockByStokKodu = useMemo(() => {
    const groups = new Map<string, DepoStokItem[]>();
    labStock.forEach(item => {
      const key = item.stokKodu || '';
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });
    return groups;
  }, [labStock]);

  const computeLabInfo = useCallback((stokKodu: string): LabStockInfo => {
    const items = labStockByStokKodu.get(stokKodu) || [];

    // Total on hand at the lab
    const totalAdet = items.length;

    // Closest-miad lot
    let closestLot: LabStockInfo['closestLot'] = null;
    if (items.length > 0) {
      const sortedByMiad = [...items].sort((a, b) => {
        const da = safeParseMiad(a.miad);
        const db = safeParseMiad(b.miad);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return compareAsc(da, db);
      });
      const first = sortedByMiad[0];
      const firstLot = first.lotNumarasi ?? '';
      const firstMiad = formatMiad(first.miad as any, '-');
      const lotCount = items.filter(
        x => (x.lotNumarasi ?? '') === firstLot && formatMiad(x.miad as any, '-') === firstMiad
      ).length;
      closestLot = { lotNumarasi: firstLot || '-', miad: firstMiad, adet: lotCount };
    }

    // Last transfer from depoStok's sevkTarihi + depotId
    let lastTransfer: LabStockInfo['lastTransfer'] = null;
    const withDates = items
      .map(it => ({ it, d: toDateFromAny(it.sevkTarihi as any) ?? null }))
      .filter(x => x.d) as { it: DepoStokItem; d: Date }[];
    if (withDates.length > 0) {
      withDates.sort((a, b) => b.d.getTime() - a.d.getTime());
      const top = withDates[0];
      const depotId = top.it.depotId;
      const depotName = top.it.depotName || (depotId ? depotNameById.get(depotId) : undefined);
      lastTransfer = { date: top.d, depotId, depotName };
    }

    return { totalAdet, closestLot, lastTransfer };
  }, [labStockByStokKodu, depotNameById]);

  // ── Row helpers ────────────────────────────────────────────────────────
  const toggleRowFulfilled = (itemId: string) => {
    setRows(prev => prev.map(r => (r.itemId === itemId ? { ...r, fulfilled: !r.fulfilled } : r)));
  };

  const setRowSentAdet = (itemId: string, adet: number) => {
    const safe = Math.max(0, Math.floor(Number.isFinite(adet) ? adet : 0));
    setRows(prev => prev.map(r => (r.itemId === itemId ? { ...r, sentAdet: safe } : r)));
  };

  const allFulfilled = rows.length > 0 && rows.every(r => r.fulfilled);
  const toggleAllFulfilled = () => {
    const next = !allFulfilled;
    setRows(prev => prev.map(r => ({ ...r, fulfilled: next })));
  };

  // ── Save ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!order?.id) return;
    setIsSaving(true);
    try {
      const fulfillmentItems: PeripheralFulfillmentItem[] = rows.map(r => ({
        itemId: r.itemId,
        stokKodu: r.stokKodu,
        requestedAdet: r.requestedAdet,
        sentAdet: r.sentAdet,
        fulfilled: r.fulfilled,
      }));

      const isComplete = fulfillmentItems.length > 0 && fulfillmentItems.every(it => it.fulfilled);
      const payload: Record<string, any> = {
        peripheralFulfillment: {
          items: fulfillmentItems,
          updatedAt: serverTimestamp(),
          updatedById: currentUser?.uid || null,
          updatedBy: currentUserProfile?.name || currentUser?.email || null,
        },
        status: isComplete ? 'completed' : 'eksik',
      };
      if (isComplete) {
        payload.transferredAt = serverTimestamp();
        payload.transferredById = currentUser?.uid || null;
        payload.transferredBy = currentUserProfile?.name || currentUser?.email || null;
        payload.completedAt = serverTimestamp();
      }

      if (isComplete) {
        // Tamamlanan sipariş `ordersArchive`'a taşınır (kopyala + sil); merge
        // alanları tam dokümana yedirilir. `orders` yalnızca aktif/eksik tutar.
        const { status: _omitStatus, ...completionFields } = payload;
        const batch = writeBatch(db);
        archiveCompletedOrderInBatch(batch, order.id, order as unknown as Record<string, unknown>, completionFields);
        await batch.commit();
      } else {
        await setDoc(doc(db, 'orders', order.id), payload, { merge: true });
      }

      toast({
        title: isComplete ? 'Sipariş Tamamlandı' : 'Eksik Olarak Kaydedildi',
        description: isComplete
          ? 'Sipariş tamamlanan siparişlere taşındı.'
          : 'Eksik kalemler ile sipariş bekleyen listede güncellendi.',
      });
      router.push('/siparisler');
    } catch (e) {
      console.error(e);
      toast({ title: 'Hata', description: 'Sipariş kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Route to depot ─────────────────────────────────────────────────────
  // Ofis lojistik sorumlusu siparişi bir depoya yönlendirebilir; bu durumda
  // sipariş artık perifer UI'dan çıkar ve ilgili deponun bekleyen siparişler
  // sekmesinde normal bir lab talebi olarak görünür (barkod okutmaya hazır).
  const handleRouteToDepot = async () => {
    if (!order?.id || !routeDepotId) return;
    const depot = depots.find(d => d.id === routeDepotId);
    if (!depot) return;
    setIsRouting(true);
    try {
      await setDoc(
        doc(db, 'orders', order.id),
        {
          depotId: depot.id,
          depotName: depot.name ?? null,
          status: 'pending',
          routedToDepotAt: serverTimestamp(),
          routedToDepotById: currentUser?.uid || null,
          routedToDepotBy: currentUserProfile?.name || currentUser?.email || null,
        },
        { merge: true },
      );
      toast({
        title: 'Depoya Yönlendirildi',
        description: `Sipariş "${depot.name}" deposuna iletildi; toplama akışı başlayabilir.`,
      });
      setIsRouteDialogOpen(false);
      router.push('/siparisler');
    } catch (e) {
      console.error(e);
      toast({ title: 'Hata', description: 'Sipariş yönlendirilemedi.', variant: 'destructive' });
    } finally {
      setIsRouting(false);
    }
  };

  // ── Excel export ───────────────────────────────────────────────────────
  const handleExportExcel = () => {
    if (!order) return;
    const createdAt = toDateFromAny(order.createdAt as any);
    const data = rows.map(row => {
      const info = computeLabInfo(row.stokKodu);
      return {
        'Stok Kodu': row.stokKodu,
        'Ürün Adı': row.stokAdi,
        'Talep Adet': row.requestedAdet,
        'Gönderilen Adet': row.sentAdet,
        'Labdaki Stok': info.totalAdet,
        'En Yakın Miadlı Lot': info.closestLot?.lotNumarasi ?? '-',
        'En Yakın Miad': info.closestLot?.miad ?? '-',
        'Lot Adeti': info.closestLot?.adet ?? 0,
        'Son Transfer Tarihi': info.lastTransfer
          ? formatDateFns(info.lastTransfer.date, 'dd.MM.yyyy', { locale: tr })
          : '-',
        'Transferi Yapan Depo': info.lastTransfer?.depotName ?? '-',
        'Karşılandı': row.fulfilled ? 'Evet' : 'Hayır',
      };
    });
    const fileName = `Perifer_Siparis_${hospital?.kod || hospital?.name || order.kurumAdi || order.id}${
      createdAt ? '_' + formatDateFns(createdAt, 'yyyyMMdd', { locale: tr }) : ''
    }`;
    exportDataToExcel(data, fileName, 'Perifer Sipariş', toast);
  };

  const createdAtStr = useMemo(() => {
    const d = toDateFromAny(order?.createdAt as any);
    return d ? formatDateFns(d, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-';
  }, [order?.createdAt]);

  const totalRequested = useMemo(() => rows.reduce((s, r) => s + r.requestedAdet, 0), [rows]);
  const totalFulfilled = useMemo(() => rows.filter(r => r.fulfilled).length, [rows]);

  if (isLoading) {
    return (
      <div className="cihaz-shell flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <div className="cihaz-card-strong p-8 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
          <span style={{ color: 'var(--dashboard-text)' }} className="text-sm font-medium">
            Perifer sipariş yükleniyor…
          </span>
        </div>
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 pb-28 sm:pb-6" style={{ minHeight: '100dvh' }}>
      <button
        onClick={() => router.push('/siparisler')}
        className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium mb-4"
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Siparişler
      </button>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="cihaz-card-strong p-4 sm:p-5 mb-4 sm:mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-100 text-purple-700">
                PERİFER
              </span>
              <h1 className="text-lg sm:text-xl font-bold truncate" style={{ color: 'var(--dashboard-text)' }}>
                {order.kurumAdi}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                {order.createdBy || '-'} · {createdAtStr}
              </span>
              {hospital?.kod && (
                <span className="text-xs font-mono" style={{ color: 'var(--dashboard-muted)' }}>
                  {hospital.kod}
                </span>
              )}
              <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                Talep: {totalRequested} adet · {rows.length} kalem
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportExcel}
              disabled={rows.length === 0}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all',
                rows.length === 0
                  ? 'cihaz-pressed text-[var(--dashboard-muted)] cursor-not-allowed'
                  : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              )}
              title="Siparişin tüm detaylarını Excel olarak dışa aktar"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Excel
            </button>
            <button
              onClick={() => {
                setRouteDepotId('');
                setIsRouteDialogOpen(true);
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all bg-blue-100 text-blue-700 hover:bg-blue-200"
              title="Siparişi bir depoya yönlendir (barkod okutma akışı)"
            >
              <Share2 className="w-4 h-4" />
              Depoya Yönlendir
            </button>
            <button
              onClick={toggleAllFulfilled}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                allFulfilled
                  ? 'bg-green-100 text-green-700'
                  : 'cihaz-pressed text-[var(--dashboard-text)]'
              )}
              title="Tüm satırları karşılandı olarak işaretle"
            >
              <CheckCircle2 className="w-4 h-4" />
              {allFulfilled ? 'Tümü Karşılandı' : 'Tümünü Karşılandı İşaretle'}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={cn(
                'inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold text-white transition-all',
                isSaving ? 'opacity-60 cursor-not-allowed bg-purple-500' : 'bg-purple-600 hover:bg-purple-700'
              )}
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Kaydet
            </button>
          </div>
        </div>

        {/* Progress strip */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs font-medium mb-1">
            <span style={{ color: 'var(--dashboard-muted)' }}>Karşılanan</span>
            <span style={{ color: 'var(--dashboard-text)' }}>
              {totalFulfilled} / {rows.length}
            </span>
          </div>
          <div className="cihaz-pressed h-2.5 overflow-hidden" style={{ borderRadius: 8 }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${rows.length === 0 ? 0 : (totalFulfilled / rows.length) * 100}%`,
                background: 'linear-gradient(90deg, #a855f7, #7c3aed)',
              }}
            />
          </div>
        </div>
      </header>

      {/* ── Rows ────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="cihaz-card p-8 text-center" style={{ color: 'var(--dashboard-muted)' }}>
          <Package className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium">Bu siparişte kalem bulunmuyor.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map(row => {
            const info = computeLabInfo(row.stokKodu);
            const meta = productMetaByCode.get(row.stokKodu);
            const isEditing = editingRowId === row.itemId;
            const qtyDiffers = row.sentAdet !== row.requestedAdet;
            const lastTransferDate = info.lastTransfer?.date;
            const lastTransferStr = lastTransferDate
              ? formatDateFns(lastTransferDate, 'dd.MM.yyyy', { locale: tr })
              : null;

            return (
              <article
                key={row.itemId}
                className={cn(
                  'cihaz-card p-3 sm:p-4 transition-all duration-300',
                  row.fulfilled && 'ring-1 ring-green-400/50'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: product info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-semibold truncate" style={{ color: 'var(--dashboard-text)' }}>
                      {row.stokAdi || meta?.stokAdi || row.stokKodu}
                    </h3>
                    <p className="text-[11px] font-mono" style={{ color: 'var(--dashboard-muted)' }}>
                      {row.stokKodu}
                    </p>

                    {/* Talep + lab stock row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                      <div className="flex items-baseline gap-1">
                        <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--dashboard-muted)' }}>
                          Talep
                        </span>
                        <span className="text-lg font-bold" style={{ color: 'var(--dashboard-text)' }}>
                          {row.requestedAdet}
                        </span>
                        {(() => {
                          const itemAmbalaj = meta?.ambalajDegeri ?? 0;
                          const itemBirim = meta?.anaBirim || '';
                          const itemTotal = itemAmbalaj > 0 ? itemAmbalaj * row.requestedAdet : 0;
                          return itemBirim && itemTotal > 0 ? (
                            <span className="text-xs font-medium" style={{ color: 'var(--dashboard-muted)' }}>
                              {itemBirim} ({itemTotal.toLocaleString('tr-TR')} adet)
                            </span>
                          ) : null;
                        })()}
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--dashboard-muted)' }}>
                          Labdaki Stok
                        </span>
                        <span
                          className={cn(
                            'text-lg font-bold',
                            info.totalAdet === 0
                              ? 'text-red-600'
                              : info.totalAdet < row.requestedAdet
                                ? 'text-amber-600'
                                : ''
                          )}
                          style={info.totalAdet >= row.requestedAdet ? { color: 'var(--dashboard-text)' } : undefined}
                        >
                          {info.totalAdet}
                        </span>
                      </div>
                      {isEditing ? (
                        <div className="flex items-baseline gap-1">
                          <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--dashboard-muted)' }}>
                            Gönderilen
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={row.sentAdet}
                            onChange={e => setRowSentAdet(row.itemId, Number(e.target.value))}
                            className="w-20 h-8 px-2 rounded-md border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] text-sm font-bold text-center"
                            autoFocus
                          />
                          <button
                            onClick={() => setEditingRowId(null)}
                            className="ml-1 text-xs text-purple-600 font-semibold underline"
                          >
                            Bitti
                          </button>
                        </div>
                      ) : qtyDiffers ? (
                        <div className="flex items-baseline gap-1">
                          <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--dashboard-muted)' }}>
                            Gönderilen
                          </span>
                          <span className="text-lg font-bold text-purple-700">{row.sentAdet}</span>
                        </div>
                      ) : null}
                    </div>

                    {/* Transfer info */}
                    <div className="mt-2 text-[12px]" style={{ color: 'var(--dashboard-muted)' }}>
                      {info.lastTransfer ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="inline-flex items-center gap-1">
                            <Truck className="w-3.5 h-3.5" />
                            Son transfer: {lastTransferStr}
                          </span>
                          {info.lastTransfer.depotName && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5" />
                              Transferi yapan depo: {info.lastTransfer.depotName}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-orange-500">
                          <Truck className="w-3.5 h-3.5" />
                          Son transfer bilgisi yok
                        </span>
                      )}
                    </div>

                    {/* Closest-miad lot info */}
                    <div className="mt-1 text-[12px]" style={{ color: 'var(--dashboard-muted)' }}>
                      {info.closestLot ? (
                        <span className="inline-flex items-center gap-1">
                          <Package className="w-3.5 h-3.5" />
                          En yakın miadlı lot:{' '}
                          <span className="font-mono" style={{ color: 'var(--dashboard-text)' }}>
                            {info.closestLot.lotNumarasi}
                          </span>{' '}
                          ({info.closestLot.miad}) — {info.closestLot.adet} adet
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-500">
                          <Package className="w-3.5 h-3.5" />
                          Labda bu üründen stok yok
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <button
                      onClick={() => toggleRowFulfilled(row.itemId)}
                      className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center transition-all',
                        row.fulfilled
                          ? 'bg-green-500 text-white shadow-[var(--dashboard-raised-soft)]'
                          : 'cihaz-pressed text-[var(--dashboard-muted)]'
                      )}
                      title={row.fulfilled ? 'Karşılandı' : 'Karşılandı olarak işaretle'}
                      aria-pressed={row.fulfilled}
                    >
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => setEditingRowId(isEditing ? null : row.itemId)}
                      className="cihaz-tool-item inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium"
                      title="Gönderilen adedi düzenle"
                    >
                      {isEditing ? <Pencil className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
                      {isEditing ? 'Düzenleniyor' : 'Düzenle'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Sticky footer save (mobile) */}
      <div className="fixed sm:hidden bottom-0 left-0 right-0 px-3 py-3 bg-[var(--dashboard-surface)] border-t border-[var(--dashboard-stroke)] z-40">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={cn(
            'w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold text-white transition-all',
            isSaving ? 'opacity-60 cursor-not-allowed bg-purple-500' : 'bg-purple-600'
          )}
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {allFulfilled ? 'Tamamla ve Kaydet' : 'Eksik Olarak Kaydet'}
        </button>
      </div>

      {/* ── Depoya yönlendirme dialog'u ──────────────────────────────── */}
      <Dialog open={isRouteDialogOpen} onOpenChange={setIsRouteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-blue-600" />
              Siparişi Depoya Yönlendir
            </DialogTitle>
            <DialogDescription>
              Sipariş artık seçtiğiniz deponun bekleyen siparişlerinde
              &quot;Toplamayı Başlat&quot; akışı ile açılacak; toplama barkod
              okutmaya hazır normal lab talebi gibi ilerleyecek.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-2">
            <label className="text-sm font-medium">Hedef Depo</label>
            <Select value={routeDepotId} onValueChange={setRouteDepotId}>
              <SelectTrigger>
                <SelectValue placeholder="Depo seçin..." />
              </SelectTrigger>
              <SelectContent>
                {depots.map(d => (
                  <SelectItem key={d.id} value={d.id ?? ''}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <button
              onClick={() => setIsRouteDialogOpen(false)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cihaz-pressed text-[var(--dashboard-text)]"
            >
              Vazgeç
            </button>
            <button
              onClick={handleRouteToDepot}
              disabled={!routeDepotId || isRouting}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white',
                !routeDepotId || isRouting ? 'opacity-60 cursor-not-allowed bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'
              )}
            >
              {isRouting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              Yönlendir
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
