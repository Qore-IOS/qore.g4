'use client';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  onSnapshot,
  query,
  where,
  Timestamp,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import type { Order, Hospital, ProductCode, DepoStokItem, PeripheralFulfillmentItem } from '@/lib/types';
import { format as formatDate, compareAsc, parse as parseDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import {
  ShoppingCart,
  Package,
  CheckCircle2,
  Trash2,
  Search,
  Loader2,
  History,
  MoreHorizontal,
  ClipboardPlus,
  ArrowRight,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { toDateFromAny } from '@/lib/date';

type LojFilter = 'all' | 'pending' | 'eksik';

type RowState = {
  itemId: string;
  stokKodu: string;
  stokAdi: string;
  requestedAdet: number;
  sentAdet: number;
  fulfilled: boolean;
};

type LabStockInfo = {
  totalAdet: number;
  closestLot: {
    lotNumarasi: string;
    miad: string;
    adet: number;
  } | null;
  lastTransfer: {
    date: Date;
    depotName?: string;
  } | null;
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

export default function LojistikSiparisView() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile } = useAuth();
  const [peripheralOrders, setPeripheralOrders] = useState<Order[]>([]);
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LojFilter>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const [rows, setRows] = useState<RowState[]>([]);
  const [labStock, setLabStock] = useState<DepoStokItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const assignedLabIds = useMemo(() => {
    const s = new Set<string>();
    (currentUserProfile?.assignedLaboratories ?? []).forEach((id) => {
      if (id) s.add(id);
    });
    return s;
  }, [currentUserProfile?.assignedLaboratories]);

  // Fetch hospitals & products
  useEffect(() => {
    (async () => {
      const [hSnap, pSnap] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'productCodes')),
      ]);
      setHospitals(hSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)));
      setProductCodes(pSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ProductCode)));
    })();
  }, []);

  // Listen peripheral orders
  useEffect(() => {
    const q = query(collection(db, 'orders'), where('isPeripheral', '==', true));
    const unsub = onSnapshot(q, (snap) => {
      const rowsData = snap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          id: d.id,
          createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date(),
        } as Order;
      });
      const active: Order[] = [];
      const completed: Order[] = [];
      rowsData.forEach((o) => {
        if (!o.labId || !assignedLabIds.has(o.labId)) return;
        if (o.status === 'completed') completed.push(o);
        else active.push(o);
      });
      active.sort(
        (a, b) =>
          ((b.createdAt as Date)?.getTime?.() ?? 0) - ((a.createdAt as Date)?.getTime?.() ?? 0)
      );
      completed.sort(
        (a, b) =>
          ((b.createdAt as Date)?.getTime?.() ?? 0) - ((a.createdAt as Date)?.getTime?.() ?? 0)
      );
      setPeripheralOrders(active);
      setCompletedOrders(completed);
      setIsLoading(false);
    });
    return () => unsub();
  }, [assignedLabIds]);

  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null;
    return peripheralOrders.find((o) => o.id === selectedOrderId) ?? null;
  }, [selectedOrderId, peripheralOrders]);

  // Load selected order details and stock
  useEffect(() => {
    if (!selectedOrder) {
      setRows([]);
      setLabStock([]);
      return;
    }

    // Initialize rows
    const existingByItemId = new Map<string, any>();
    (selectedOrder.peripheralFulfillment?.items || []).forEach((it: any) => {
      existingByItemId.set(it.itemId, it);
    });

    const newRows: RowState[] = (selectedOrder.items || []).map((it) => {
      const existing = existingByItemId.get(it.id);
      return {
        itemId: it.id,
        stokKodu: it.stokKodu,
        stokAdi: it.stokAdi,
        requestedAdet: Number(it.adet) || 0,
        sentAdet: existing ? Number(existing.sentAdet) : Number(it.adet) || 0,
        fulfilled: existing ? !!existing.fulfilled : false,
      };
    });
    setRows(newRows);

    // Fetch lab stock (shipped items to this hospital)
    (async () => {
      const hospital =
        hospitals.find((h) => h.id === selectedOrder.labId) ||
        hospitals.find((h) => h.name === selectedOrder.kurumAdi || h.ad === selectedOrder.kurumAdi);

      if (hospital) {
        const q = query(
          collection(db, 'depoStok'),
          where('isShipped', '==', true)
        );
        const snap = await getDocs(q);
        const allShipped = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DepoStokItem));
        const filtered = allShipped.filter(st => {
          if (st.hedefKurumId && st.hedefKurumId === hospital.id) return true;
          if (!st.hedefKurumId && st.hedefKurum && (hospital.name === st.hedefKurum || hospital.ad === st.hedefKurum)) return true;
          return false;
        });
        setLabStock(filtered);
      }
    })();
  }, [selectedOrderId, hospitals]); // Only depend on selectedOrderId and hospitals list

  const labStockByStokKodu = useMemo(() => {
    const groups = new Map<string, DepoStokItem[]>();
    labStock.forEach((item) => {
      const key = item.stokKodu || '';
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });
    return groups;
  }, [labStock]);

  const computeLabInfo = useCallback(
    (stokKodu: string): LabStockInfo => {
      const items = labStockByStokKodu.get(stokKodu) || [];
      const totalAdet = items.length;

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
        const firstMiad =
          first.miad instanceof Timestamp
            ? formatDate(first.miad.toDate(), 'dd.MM.yyyy')
            : String(first.miad || '-');
        const lotCount = items.filter(
          (x) =>
            (x.lotNumarasi ?? '') === firstLot &&
            (x.miad instanceof Timestamp
              ? formatDate(x.miad.toDate(), 'dd.MM.yyyy')
              : String(x.miad || '-')) === firstMiad
        ).length;
        closestLot = { lotNumarasi: firstLot || '-', miad: firstMiad, adet: lotCount };
      }

      let lastTransfer: LabStockInfo['lastTransfer'] = null;
      const withDates = items
        .map((it) => ({ it, d: toDateFromAny(it.sevkTarihi as any) ?? null }))
        .filter((x) => x.d) as { it: DepoStokItem; d: Date }[];
      if (withDates.length > 0) {
        withDates.sort((a, b) => b.d.getTime() - a.d.getTime());
        const top = withDates[0];
        lastTransfer = { date: top.d, depotName: top.it.depotName };
      }

      return { totalAdet, closestLot, lastTransfer };
    },
    [labStockByStokKodu]
  );

  const filteredOrders = useMemo(() => {
    let list = peripheralOrders;
    if (filter === 'pending') list = list.filter((o) => o.status === 'pending' || o.status === 'toplaniyor');
    else if (filter === 'eksik') list = list.filter((o) => o.status === 'eksik');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (o) => o.kurumAdi?.toLowerCase().includes(q) || o.createdBy?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [peripheralOrders, filter, search]);

  const productNameMap = useMemo(() => {
    const m = new Map<string, string>();
    productCodes.forEach((p) => {
      if (p.stokKodu && p.stokAdi) m.set(p.stokKodu, p.stokAdi);
    });
    return m;
  }, [productCodes]);

  const handleDelete = async (orderId: string) => {
    if (!window.confirm('Bu siparişi silmek istediğinizden emin misiniz?')) return;
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      if (selectedOrderId === orderId) setSelectedOrderId(null);
      toast({ title: 'Silindi', description: 'Sipariş silindi.' });
    } catch {
      toast({ title: 'Hata', description: 'Sipariş silinemedi.', variant: 'destructive' });
    }
  };

  const handleApprove = async () => {
    if (!selectedOrder?.id) return;
    setIsSaving(true);
    try {
      const fulfillmentItems: PeripheralFulfillmentItem[] = rows.map((r) => ({
        itemId: r.itemId,
        stokKodu: r.stokKodu,
        requestedAdet: r.requestedAdet,
        sentAdet: r.sentAdet,
        fulfilled: r.fulfilled,
      }));

      const isComplete = fulfillmentItems.length > 0 && fulfillmentItems.every((it) => it.fulfilled);
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
      }

      await updateDoc(doc(db, 'orders', selectedOrder.id), payload);

      toast({
        title: isComplete ? 'Sipariş Tamamlandı' : 'Sipariş Onaylandı',
        description: isComplete
          ? 'Sipariş tamamlanan siparişlere taşındı.'
          : 'Sipariş eksik kalemler ile bekleyen listede güncellendi.',
      });
      // Optionally deselect if completed
      if (isComplete) setSelectedOrderId(null);
    } catch (e) {
      console.error(e);
      toast({ title: 'Hata', description: 'Sipariş kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleRowFulfilled = (itemId: string) => {
    setRows((prev) =>
      prev.map((r) => (r.itemId === itemId ? { ...r, fulfilled: !r.fulfilled } : r))
    );
  };

  const setRowSentAdet = (itemId: string, val: string) => {
    const n = parseInt(val, 10);
    const safe = isNaN(n) ? 0 : Math.max(0, n);
    setRows((prev) => (prev.map((r) => (r.itemId === itemId ? { ...r, sentAdet: safe } : r))));
  };

  const getStatusInfo = (order: Order) => {
    const s = order.status;
    if (s === 'eksik')
      return {
        label: 'Eksik',
        cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      };
    if (s === 'toplaniyor')
      return {
        label: 'Onaylandı',
        cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      };
    if (s === 'completed')
      return {
        label: 'Teslim',
        cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      };
    return {
      label: 'Beklemede',
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    };
  };

  const totalOrders = peripheralOrders.length + completedOrders.length;
  const activeCount = peripheralOrders.length;
  const completedCount = completedOrders.length;

  const progressValue = useMemo(() => {
    if (rows.length === 0) return 0;
    const fulfilled = rows.filter((r) => r.fulfilled).length;
    return (fulfilled / rows.length) * 100;
  }, [rows]);

  if (isLoading) {
    return (
      <div className="loj-shell flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--loj-accent)' }} />
      </div>
    );
  }

  return (
    <div className="loj-shell px-4 py-5 sm:px-6 sm:py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1
            className="text-lg sm:text-xl font-bold flex items-center gap-2"
            style={{ color: 'var(--loj-text)' }}
          >
            <ShoppingCart className="h-5 w-5" style={{ color: 'var(--loj-accent)' }} />
            Siparişler
          </h1>
          <p className="text-xs" style={{ color: 'var(--loj-muted)' }}>
            Perifer siparişler · {activeCount} aktif
          </p>
        </div>
        <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
          <PopoverTrigger asChild>
            <button className="loj-btn-outline" style={{ padding: '0.5rem' }}>
              <MoreHorizontal className="h-4 w-4" style={{ color: 'var(--loj-muted)' }} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-1" align="end">
            <button
              onClick={() => {
                router.push('/urun-talep');
                setMoreMenuOpen(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
            >
              <ClipboardPlus className="h-4 w-4" style={{ color: 'var(--loj-muted)' }} /> Ürün Talep
            </button>
            <button
              onClick={() => {
                router.push('/siparis-gecmis');
                setMoreMenuOpen(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
            >
              <History className="h-4 w-4" style={{ color: 'var(--loj-muted)' }} /> Geçmiş
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="loj-kpi">
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--loj-muted)' }}
            >
              Toplam Sipariş
            </span>
            <ShoppingCart className="h-4 w-4" style={{ color: 'var(--loj-accent)' }} />
          </div>
          <p className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--loj-text)' }}>
            {totalOrders}
          </p>
        </div>
        <div className="loj-kpi">
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--loj-muted)' }}
            >
              Bekleyen
            </span>
            <Package className="h-4 w-4" style={{ color: 'var(--loj-accent)' }} />
          </div>
          <p className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--loj-accent)' }}>
            {activeCount}
          </p>
        </div>
        <div className="loj-kpi">
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--loj-muted)' }}
            >
              Geçmiş
            </span>
            <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--loj-accent)' }} />
          </div>
          <p className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--loj-text)' }}>
            {completedCount}
          </p>
        </div>
      </div>

      {/* Master-Detail Split */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* LEFT: Order List */}
        <div className="loj-list-panel">
          {/* Filter Chips */}
          <div
            className="flex flex-wrap gap-1.5 px-4 py-3 border-b"
            style={{ borderColor: 'var(--loj-stroke)' }}
          >
            {([
              ['all', 'Tümü'],
              ['pending', 'Bekleyen'],
              ['eksik', 'Eksik'],
            ] as [LojFilter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn('loj-chip', filter === key && 'active')}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Search */}
          <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
                style={{ color: 'var(--loj-muted)' }}
              />
              <input
                placeholder="Kurum ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-8 pl-8 pr-3 rounded-lg text-xs border-0 outline-none"
                style={{ background: 'var(--loj-surface-2)', color: 'var(--loj-text)' }}
              />
            </div>
          </div>
          {/* List */}
          <ScrollArea className="flex-1" style={{ maxHeight: 'calc(100vh - 380px)' }}>
            {filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Package
                  className="h-8 w-8 mb-2"
                  style={{ color: 'var(--loj-muted)', opacity: 0.4 }}
                />
                <p className="text-sm font-medium" style={{ color: 'var(--loj-muted)' }}>
                  Sipariş bulunamadı
                </p>
              </div>
            ) : (
              filteredOrders.map((order) => {
                const status = getStatusInfo(order);
                const totalAdet = (order.items ?? []).reduce(
                  (s, i) => s + (Number(i.adet) || 0),
                  0
                );
                const isSelected = selectedOrderId === order.id;
                const firstItem = order.items?.[0];
                return (
                  <button
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.id ?? null)}
                    className={cn('loj-order-item', isSelected && 'loj-selected')}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--loj-text)' }}>
                        {order.kurumAdi}
                      </p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--loj-muted)' }}>
                        {firstItem
                          ? productNameMap.get(firstItem.stokKodu ?? '') ??
                            firstItem.stokAdi ??
                            firstItem.stokKodu
                          : '-'}
                        {(order.items?.length ?? 0) > 1 &&
                          ` +${(order.items?.length ?? 1) - 1}`}
                      </p>
                      <span
                        className={cn(
                          'inline-flex items-center mt-1 px-2 py-0.5 rounded text-[10px] font-semibold',
                          status.cls
                        )}
                      >
                        {status.label}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold" style={{ color: 'var(--loj-text)' }}>
                        {totalAdet}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--loj-muted)' }}>
                        adet
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </ScrollArea>
        </div>

        {/* RIGHT: Detail Panel */}
        <div className="loj-detail-panel">
          {!selectedOrder ? (
            <div className="flex flex-col items-center justify-center h-full py-20 px-4 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: 'var(--loj-surface-2)' }}
              >
                <Package className="h-7 w-7" style={{ color: 'var(--loj-muted)' }} />
              </div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--loj-text)' }}>
                Sipariş seçin
              </p>
              <p className="text-xs" style={{ color: 'var(--loj-muted)' }}>
                Detayları görmek için sol listeden bir sipariş seçin
              </p>
            </div>
          ) : (() => {
            const order = selectedOrder;
            const totalRequestedAdet = rows.reduce((s, r) => s + r.requestedAdet, 0);
            const totalKalem = rows.length;
            const createdAtStr = order.createdAt
              ? formatDate(order.createdAt as Date, 'dd MMM · HH:mm', { locale: tr })
              : '-';

            return (
              <div className="flex flex-col h-full">
                {/* Detail Header */}
                <div
                  className="flex items-start justify-between gap-3 p-5 border-b"
                  style={{ borderColor: 'var(--loj-stroke)' }}
                >
                  <div className="min-w-0">
                    <p className="text-xs" style={{ color: 'var(--loj-muted)' }}>
                      {createdAtStr} · {order.createdBy || '-'}
                    </p>
                    <h2
                      className="text-base sm:text-lg font-bold mt-0.5"
                      style={{ color: 'var(--loj-text)' }}
                    >
                      {order.kurumAdi}
                    </h2>
                  </div>
                  <div className="text-right">
                    <p
                      className="text-xl sm:text-2xl font-bold shrink-0"
                      style={{ color: 'var(--loj-accent)' }}
                    >
                      {totalRequestedAdet}{' '}
                      <span className="text-sm font-medium" style={{ color: 'var(--loj-muted)' }}>
                        adet
                      </span>
                    </p>
                    <button
                      onClick={handleApprove}
                      disabled={isSaving}
                      className="loj-btn-primary mt-2"
                      style={{ fontSize: 11, padding: '0.35rem 0.75rem' }}
                    >
                      {isSaving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>Onayla <CheckCircle2 className="h-3.5 w-3.5" /></>
                      )}
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold" style={{ color: 'var(--loj-muted)' }}>
                      Hazırlanma Oranı
                    </span>
                    <span className="text-xs font-bold" style={{ color: 'var(--loj-accent)' }}>
                      %{Math.round(progressValue)}
                    </span>
                  </div>
                  <Progress value={progressValue} className="h-2 loj-progress" />
                </div>

                {/* Order Items */}
                <ScrollArea
                  className="flex-1 px-5 py-3"
                  style={{ maxHeight: 'calc(100vh - 520px)' }}
                >
                  <div className="space-y-3">
                    {rows.map((row, idx) => {
                      const pName = productNameMap.get(row.stokKodu) || row.stokAdi || row.stokKodu;
                      const info = computeLabInfo(row.stokKodu);
                      return (
                        <div
                          key={row.itemId ?? idx}
                          className={cn(
                            'loj-product-row rounded-xl flex-col items-stretch p-4',
                            row.fulfilled && 'fulfilled'
                          )}
                        >
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <Checkbox
                                checked={row.fulfilled}
                                onCheckedChange={() => toggleRowFulfilled(row.itemId)}
                                className="h-5 w-5 border-2"
                              />
                              <div className="min-w-0">
                                <p
                                  className="text-sm font-bold truncate"
                                  style={{ color: 'var(--loj-text)' }}
                                >
                                  {pName}
                                </p>
                                <p
                                  className="text-[10px] font-mono"
                                  style={{ color: 'var(--loj-muted)' }}
                                >
                                  {row.stokKodu}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex flex-col items-end">
                                <span className="text-[10px] text-[var(--loj-muted)] uppercase">Talep</span>
                                <span className="text-sm font-bold" style={{ color: 'var(--loj-text)' }}>{row.requestedAdet}</span>
                              </div>
                              <div className="h-8 w-[1px] bg-black/5 dark:bg-white/5 mx-1" />
                              <div className="flex flex-col items-end">
                                <span className="text-[10px] text-[var(--loj-muted)] uppercase">Onaylanan</span>
                                <input
                                  type="number"
                                  value={row.sentAdet}
                                  onChange={(e) => setRowSentAdet(row.itemId, e.target.value)}
                                  className="w-14 h-8 text-center text-sm font-bold rounded-lg border-0 outline-none focus:ring-1 ring-[var(--loj-accent)]"
                                  style={{ background: 'var(--loj-surface-2)', color: 'var(--loj-text)' }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Extra Stock Info */}
                          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-black/5 dark:border-white/5">
                            <div className="flex flex-col">
                              <span className="text-[9px] text-[var(--loj-muted)] uppercase tracking-tight">Son Transfer</span>
                              <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--loj-text)' }}>
                                {info.lastTransfer ? formatDate(info.lastTransfer.date, 'dd.MM.yyyy') : '-'}
                              </p>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-[var(--loj-muted)] uppercase tracking-tight">E.Y. Miadlı Lot</span>
                              <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--loj-text)' }}>
                                {info.closestLot?.lotNumarasi ?? '-'} ({info.closestLot?.miad ?? '-'})
                              </p>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-[var(--loj-muted)] uppercase tracking-tight">Lot Adedi</span>
                              <p className="text-[11px] font-semibold" style={{ color: 'var(--loj-text)' }}>
                                {info.closestLot?.adet ?? 0} adet
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                {/* Meta Info */}
                <div className="px-5 py-3 border-t" style={{ borderColor: 'var(--loj-stroke)' }}>
                  <div className="loj-meta-grid">
                    <div>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--loj-muted)' }}
                      >
                        Kurum
                      </span>
                      <p className="text-xs font-bold" style={{ color: 'var(--loj-text)' }}>
                        {order.kurumAdi}
                      </p>
                    </div>
                    <div>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--loj-muted)' }}
                      >
                        Kalem
                      </span>
                      <p className="text-xs font-bold" style={{ color: 'var(--loj-text)' }}>
                        {totalKalem} kalem
                      </p>
                    </div>
                    <div>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--loj-muted)' }}
                      >
                        Oluşturan
                      </span>
                      <p className="text-xs font-bold" style={{ color: 'var(--loj-text)' }}>
                        {order.createdBy || '-'}
                      </p>
                    </div>
                    <div>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--loj-muted)' }}
                      >
                        Tarih
                      </span>
                      <p className="text-xs font-bold" style={{ color: 'var(--loj-text)' }}>
                        {order.createdAt
                          ? formatDate(order.createdAt as Date, 'dd.MM.yyyy', { locale: tr })
                          : '-'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div
                  className="flex items-center gap-2 px-5 py-3 border-t"
                  style={{ borderColor: 'var(--loj-stroke)' }}
                >
                  <div className="flex-1 text-xs" style={{ color: 'var(--loj-muted)' }}>
                    Siparişi düzenlemek için satırları işaretleyin ve &quot;Onayla&quot; butonuna basın.
                  </div>
                  <button
                    onClick={() => handleDelete(order.id ?? '')}
                    className="loj-btn-outline"
                    style={{ color: '#B91C1C' }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
