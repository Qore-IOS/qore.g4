import type * as DocumentStore from '../lib/data/admin';
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
} from '../lib/data/client';
import { db } from '../lib/data/client';
import { useAuth } from '@/contexts/auth-context';
import { getScopedDocs, scopedQuery } from '@/lib/document-helpers';
import { ORDERS_ARCHIVE_COLLECTION, mergeOrdersById } from '@/lib/orders-archive';
import { useHospitals, useProductCodes, useDepots } from '@/hooks/useDatabaseQueries';
import { useToast } from '@/hooks/use-toast';
import type { Order, Hospital, ProductCode, DepoStokItem, PeripheralFulfillmentItem, Depot } from '@/lib/types';
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
  Clock3,
  Download,
  Truck,
  Heart,
  Zap,
  Hourglass,
  XCircle,
  Building2,
  Sparkles,
  ArrowRight,
  AlertCircle,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toDateFromAny } from '@/lib/date';
import OrderConfirmAnimation from '@/components/lojistik-terminal/order-confirm-animation';
import DeliveryHistory, { type PartialDelivery } from '@/components/lojistik-terminal/delivery-history';
import { exportOrdersToExcel } from '@/lib/lojistik/export-orders';
import { sumStockItemQuantities } from '@/lib/stock-quantity';

type LojFilter = 'all' | 'pending' | 'toplaniyor' | 'eksik';

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

const MemoizedLojOrderCard = React.memo(function LojOrderCard({
  order,
  isSelected,
  productNameMap,
  onSelect,
}: {
  order: Order;
  isSelected: boolean;
  productNameMap: Map<string, string>;
  onSelect: () => void;
}) {
  const s = order.status;
  const status = s === 'pending'
    ? { label: 'Beklemede', cls: 'loj-status-badge loj-status-badge--warning', Icon: Hourglass }
    : s === 'eksik'
      ? { label: 'Eksik', cls: 'loj-status-badge loj-status-badge--danger', Icon: AlertCircle }
      : s === 'toplaniyor'
        ? { label: 'Hazırlanıyor', cls: 'loj-status-badge loj-status-badge--info', Icon: Truck }
        : s === 'completed'
          ? { label: 'Teslim', cls: 'loj-status-badge loj-status-badge--success', Icon: CheckCircle2 }
          : s === 'cancelled'
            ? { label: 'İptal', cls: 'loj-status-badge loj-status-badge--danger', Icon: XCircle }
            : { label: 'İşlemde', cls: 'loj-status-badge loj-status-badge--info', Icon: Clock3 };

  const StatusIcon = status.Icon;
  const totalAdet = (order.items ?? []).reduce((sum, i) => sum + (Number(i.adet) || 0), 0);
  const firstItem = order.items?.[0];

  return (
    <button
      key={order.id}
      onClick={onSelect}
      className={cn('loj-order-item', isSelected && 'loj-selected')}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate flex items-center gap-1.5" style={{ color: 'var(--loj-text)' }}>
          <Building2 className="h-3.5 w-3.5 opacity-70 shrink-0" />
          <span className="truncate">{order.kurumAdi}</span>
        </p>
        <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--loj-muted)' }}>
          {firstItem
            ? productNameMap.get(firstItem.stokKodu ?? '') ??
              firstItem.stokAdi ??
              firstItem.stokKodu
            : '-'}
          {(order.items?.length ?? 0) > 1 &&
            ` +${(order.items?.length ?? 1) - 1}`}
        </p>
        <span className={cn(status.cls, 'mt-1.5')}>
          <StatusIcon className="h-3 w-3" />
          {status.label}
        </span>
      </div>
      <div className="text-right shrink-0 w-14 sm:w-16">
        <p className="text-base font-extrabold" style={{ color: 'var(--loj-accent)' }}>
          {totalAdet}
        </p>
        <p
          className="text-[10px] uppercase tracking-wide whitespace-nowrap"
          style={{ color: 'var(--loj-muted)' }}
        >
          adet
        </p>
      </div>
    </button>
  );
}, (prevProps, nextProps) => {
  return prevProps.order.id === nextProps.order.id &&
         prevProps.order.status === nextProps.order.status &&
         prevProps.isSelected === nextProps.isSelected &&
         (prevProps.order.items?.length ?? 0) === (nextProps.order.items?.length ?? 0);
});

export default function LojistikSiparisView() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const [peripheralOrders, setPeripheralOrders] = useState<Order[]>([]);
  // Tamamlananlar `ordersArchive`'tan (+ backfill öncesi canlı kalanlar) gelir.
  const [liveCompleted, setLiveCompleted] = useState<Order[]>([]);
  const [archivedCompleted, setArchivedCompleted] = useState<Order[]>([]);
  const completedOrders = useMemo(
    () => mergeOrdersById(archivedCompleted, liveCompleted),
    [archivedCompleted, liveCompleted],
  );
  // TanStack Query — AppLayout prefetch sayesinde anında cache'den gelir, 0ms bekleme
  const { data: hospitals = [] } = useHospitals();
  const { data: productCodes = [] } = useProductCodes();
  const { data: depots = [] } = useDepots();

  const [maxByStokKodu, setMaxByStokKodu] = useState<Map<string, { max: number; maxGun?: number }>>(new Map());
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LojFilter>('all');
  const [search, setSearch] = useState('');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const [rows, setRows] = useState<RowState[]>([]);
  const [labStock, setLabStock] = useState<DepoStokItem[]>([]);
  const [isLabStockLoading, setIsLabStockLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveFx, setShowSaveFx] = useState(false);
  const [isRouteDialogOpen, setIsRouteDialogOpen] = useState(false);
  const [routeDepotId, setRouteDepotId] = useState<string>('');
  const [isRouting, setIsRouting] = useState(false);

  const assignedLabIds = useMemo(() => {
    const s = new Set<string>();
    (currentUserProfile?.assignedLaboratories ?? []).forEach((id) => {
      if (id) s.add(id);
    });
    return s;
  }, [currentUserProfile?.assignedLaboratories]);

  const [labGroupNamesById, setLabGroupNamesById] = useState<Map<string, string>>(new Map());

  // Build the set of group names the current user (lojistik sorumlusu) is responsible for.
  // assignedLabGroups can contain either definition document IDs or legacy group names.
  const userGroupNames = useMemo(() => {
    const out = new Set<string>();
    const ids = currentUserProfile?.assignedLabGroups ?? [];
    if (!ids.length) return out;
    for (const entry of ids) {
      const trimmed = String(entry || '').trim();
      if (!trimmed) continue;
      const byId = labGroupNamesById.get(trimmed);
      out.add(byId || trimmed);
    }
    return out;
  }, [currentUserProfile?.assignedLabGroups, labGroupNamesById]);

  // stokKodu -> laboratuvarGrubu (name) lookup from productCodes
  const stokKoduToGrup = useMemo(() => {
    const m = new Map<string, string>();
    productCodes.forEach((p) => {
      const code = (p.stokKodu || '').trim();
      const grup = (p as any).laboratuvarGrubu;
      if (code && grup) m.set(code, String(grup).trim());
    });
    return m;
  }, [productCodes]);

  // True when the current user has at least one assigned lab group; if so, list/detail
  // views are scoped to items whose product group is in `userGroupNames`.
  const groupFilteringActive = (currentUserProfile?.assignedLabGroups?.length ?? 0) > 0 && userGroupNames.size > 0;

  const itemBelongsToUserGroup = useCallback(
    (stokKodu: string | undefined | null): boolean => {
      if (!groupFilteringActive) return true;
      const code = (stokKodu || '').trim();
      if (!code) return false;
      const grup = stokKoduToGrup.get(code);
      if (!grup) return false;
      return userGroupNames.has(grup);
    },
    [groupFilteringActive, stokKoduToGrup, userGroupNames]
  );

  // def_labGroups: sadece lab grup isimleri için hâlâ manuel çekme (TanStack Query'de yok)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lgResult = await getScopedDocs('def_labGroups', currentCompanyId, isSuperAdmin).catch(() => null);
      if (cancelled || !lgResult) return;
      const lgMap = new Map<string, string>();
      lgResult.forEach((d) => {
        const name = (d.data() as any)?.name;
        if (name) lgMap.set(d.id, String(name).trim());
      });
      setLabGroupNamesById(lgMap);
    })();
    return () => { cancelled = true; };
  }, [currentCompanyId, isSuperAdmin]);

  // Listen peripheral orders. Aktif siparişler canlı `orders`'tan; tamamlananlar
  // `ordersArchive`'tan (+ backfill öncesi canlı kalanlar) okunur.
  useEffect(() => {
    // Visibility rules:
    // - Lojistik users with assignedLabGroups: show orders that contain at least
    //   one item whose product is in one of their groups.
    // - Otherwise fall back to legacy lab-ID-based filtering.
    const isVisible = (o: Order): boolean => {
      if (groupFilteringActive) {
        const items = Array.isArray(o.items) ? o.items : [];
        return items.some((it: any) => itemBelongsToUserGroup(it?.stokKodu));
      }
      return !!o.labId && assignedLabIds.has(o.labId);
    };
    const byCreatedDesc = (a: Order, b: Order) =>
      ((b.createdAt as Date)?.getTime?.() ?? 0) - ((a.createdAt as Date)?.getTime?.() ?? 0);
    const mapDocs = (snap: any): Order[] =>
      snap.docs.map((d: any) => {
        const data = d.data();
        return { ...data, id: d.id, createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date() } as Order;
      });
    const onError = (error: unknown) => {
      console.error('Lojistik sipariş dinleyici hatası:', error);
      toast({
        title: 'Siparişler yüklenemedi',
        description: 'Yetki veya bağlantı nedeniyle sipariş verileri alınamadı.',
        variant: 'destructive',
      });
    };

    // Canlı `orders`: aktif (+ backfill öncesi kalan completed) ayrıştırılır.
    const unsubLive = onSnapshot(
      scopedQuery('orders', currentCompanyId, isSuperAdmin, where('isPeripheral', '==', true)),
      (snap) => {
        const visible = mapDocs(snap).filter(isVisible);
        setPeripheralOrders(visible.filter((o) => o.status !== 'completed').sort(byCreatedDesc));
        setLiveCompleted(visible.filter((o) => o.status === 'completed').sort(byCreatedDesc));
      },
      onError,
    );
    // Arşiv: tüm tamamlananlar.
    const unsubArchive = onSnapshot(
      scopedQuery(ORDERS_ARCHIVE_COLLECTION, currentCompanyId, isSuperAdmin, where('isPeripheral', '==', true)),
      (snap) => {
        setArchivedCompleted(mapDocs(snap).filter(isVisible).sort(byCreatedDesc));
      },
      onError,
    );
    return () => { unsubLive(); unsubArchive(); };
  }, [assignedLabIds, currentCompanyId, groupFilteringActive, isSuperAdmin, itemBelongsToUserGroup, toast]);

  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null;
    return peripheralOrders.find((o) => o.id === selectedOrderId) ?? null;
  }, [selectedOrderId, peripheralOrders]);

  // Load selected order details and stock
  useEffect(() => {
    if (!selectedOrder) {
      setRows([]);
      setLabStock([]);
      setIsLabStockLoading(false);
      return;
    }

    // Initialize rows
    const existingByItemId = new Map<string, any>();
    (selectedOrder.peripheralFulfillment?.items || []).forEach((it: any) => {
      existingByItemId.set(it.itemId, it);
    });

    // Only display rows whose product is in the current lojistik user's groups.
    // When the user has no group assignment, fall back to the legacy "all items" view.
    const newRows: RowState[] = (selectedOrder.items || [])
      .filter((it) => itemBelongsToUserGroup(it.stokKodu))
      .map((it) => {
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
    let cancelled = false;
    (async () => {
      setIsLabStockLoading(true);
      const hospital =
        hospitals.find((h) => h.id === selectedOrder.labId) ||
        hospitals.find((h) => h.name === selectedOrder.kurumAdi || h.ad === selectedOrder.kurumAdi);

      if (!hospital) {
        if (!cancelled) {
          setLabStock([]);
          setIsLabStockLoading(false);
        }
        return;
      }

      try {
        // Use indexed queries instead of scanning the entire depoStok collection.
        // Primary key: hedefKurumId. Fallback for legacy docs missing that field:
        // match by hedefKurum (hospital name or 'ad' alias). isShipped filter is
        // applied client-side so no composite index is required.
        const queryPromises: Array<Promise<DocumentStore.QuerySnapshot> | null> = [];
        queryPromises.push(
          getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('hedefKurumId', '==', hospital.id))) as any
        );
        if (hospital.name) {
          queryPromises.push(
            getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('hedefKurum', '==', hospital.name))) as any
          );
        }
        if (hospital.ad && hospital.ad !== hospital.name) {
          queryPromises.push(
            getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('hedefKurum', '==', hospital.ad))) as any
          );
        }
        const snaps = await Promise.all(queryPromises as any[]);
        const deduped = new Map<string, DepoStokItem>();
        snaps.forEach((snap: any) => {
          snap.docs.forEach((d: any) => {
            const item = { id: d.id, ...d.data() } as DepoStokItem;
            if (!item.isShipped) return;
            // Honour the legacy fallback rules so we don't surface stock for a
            // different hospital that happens to share an id/name field.
            if (item.hedefKurumId) {
              if (item.hedefKurumId !== hospital.id) return;
            } else if (item.hedefKurum) {
              if (item.hedefKurum !== hospital.name && item.hedefKurum !== hospital.ad) return;
            } else {
              return;
            }
            deduped.set(d.id, item);
          });
        });
        if (!cancelled) setLabStock(Array.from(deduped.values()));
      } finally {
        if (!cancelled) setIsLabStockLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // itemBelongsToUserGroup also influences which rows we render.
  }, [selectedOrderId, hospitals, itemBelongsToUserGroup]);

  useEffect(() => {
    if (!selectedOrder?.labId) {
      setMaxByStokKodu(new Map());
      return;
    }
    (async () => {
      try {
        const rulesSnap = await getDocs(collection(db, 'hospitals', selectedOrder.labId!, 'minMaxRules'));
        const next = new Map<string, { max: number; maxGun?: number }>();
        rulesSnap.docs.forEach((d) => {
          const data = d.data() as { stokKodu?: string; max?: number; maxGun?: number };
          const code = data.stokKodu || d.id;
          const max = Number(data.max);
          if (code && Number.isFinite(max) && max > 0) {
            next.set(code, { max, maxGun: data.maxGun });
          }
        });
        setMaxByStokKodu(next);
      } catch {
        setMaxByStokKodu(new Map());
      }
    })();
  }, [selectedOrder?.id, selectedOrder?.labId]);

  // Product ambalaj lookup by stokKodu
  const productAmbalajMap = useMemo(() => {
    const m = new Map<string, number>();
    productCodes.forEach((p) => {
      if (p.stokKodu && p.ambalajDegeri && p.ambalajDegeri > 0) m.set(p.stokKodu, p.ambalajDegeri);
    });
    return m;
  }, [productCodes]);

  /**
   * 30 günlük normalize max adet hesaplama:
   * 1. max (kutu) × ambalajDegeri = toplam max test
   * 2. toplam max test ÷ maxGun = günlük max test
   * 3. günlük max test × 30 = 30 günlük max test
   * 4. 30 günlük max test ÷ ambalajDegeri = 30 günlük kutu (ceil)
   * Basitleştirilmiş: Math.ceil(max × 30 / maxGun)
   */
  const compute30DayMax = useCallback(
    (stokKodu: string): number | null => {
      const rule = maxByStokKodu.get(stokKodu);
      if (!rule || rule.max <= 0) return null;
      const ambalaj = productAmbalajMap.get(stokKodu) ?? 0;
      const maxGun = rule.maxGun;
      // maxGun tanımlı değilse veya 0 ise hesaplama yapılamaz, ham max göster
      if (!maxGun || maxGun <= 0 || ambalaj <= 0) return rule.max;
      // Formül: ceil((max * ambalaj / maxGun * 30) / ambalaj) = ceil(max * 30 / maxGun)
      return Math.ceil((rule.max * ambalaj / maxGun * 30) / ambalaj);
    },
    [maxByStokKodu, productAmbalajMap]
  );

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
      const totalAdet = sumStockItemQuantities(items);

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
        const lotItems = items.filter(
          (x) =>
            (x.lotNumarasi ?? '') === firstLot &&
            (x.miad instanceof Timestamp
              ? formatDate(x.miad.toDate(), 'dd.MM.yyyy')
              : String(x.miad || '-')) === firstMiad
        );
        closestLot = { lotNumarasi: firstLot || '-', miad: firstMiad, adet: sumStockItemQuantities(lotItems) };
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
    if (filter === 'pending') list = list.filter((o) => o.status === 'pending');
    else if (filter === 'toplaniyor') list = list.filter((o) => o.status === 'toplaniyor');
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
    if (rows.length === 0) {
      toast({
        title: 'Eksik Kalem',
        description: 'Siparişte size atanmış bir kalem yok.',
        variant: 'destructive',
      });
      return;
    }
    setIsSaving(true);
    try {
      // Per-group approval: the lojistik user can only modify rows belonging to
      // their assigned lab groups. Items outside those groups must be preserved
      // verbatim so that the other group's lojistik responsible can later approve
      // them. The displayed `rows` is already filtered to user's groups.
      const rowsByItemId = new Map(rows.map((r) => [r.itemId, r] as const));
      const existingFulfillmentByItemId = new Map<string, any>();
      (selectedOrder.peripheralFulfillment?.items || []).forEach((it: any) => {
        existingFulfillmentByItemId.set(it.itemId, it);
      });

      const updatedOrderItems = (selectedOrder.items || []).map((it: any) => {
        const row = rowsByItemId.get(it.id);
        if (row) {
          return {
            id: row.itemId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            adet: row.sentAdet,
          };
        }
        return it;
      });

      const allItemIds = new Set<string>();
      (selectedOrder.items || []).forEach((it: any) => { if (it?.id) allItemIds.add(it.id); });
      existingFulfillmentByItemId.forEach((_, k) => allItemIds.add(k));

      const fulfillmentItems: PeripheralFulfillmentItem[] = Array.from(allItemIds).map((itemId) => {
        const row = rowsByItemId.get(itemId);
        if (row) {
          return {
            itemId: row.itemId,
            stokKodu: row.stokKodu,
            requestedAdet: row.sentAdet,
            sentAdet: row.sentAdet,
            fulfilled: row.fulfilled,
          } as PeripheralFulfillmentItem;
        }
        const existing = existingFulfillmentByItemId.get(itemId);
        if (existing) return existing as PeripheralFulfillmentItem;
        // Items the user can't see (other groups) but no prior fulfillment record:
        // seed a defaults row from the order item so the order keeps full coverage.
        const item = (selectedOrder.items || []).find((it: any) => it.id === itemId);
        return {
          itemId,
          stokKodu: item?.stokKodu || '',
          requestedAdet: Number(item?.adet) || 0,
          sentAdet: Number(item?.adet) || 0,
          fulfilled: false,
        } as PeripheralFulfillmentItem;
      });

      const payload: Record<string, any> = {
        peripheralFulfillment: {
          items: fulfillmentItems,
          updatedAt: serverTimestamp(),
          updatedById: currentUser?.uid || null,
          updatedBy: currentUserProfile?.name || currentUser?.email || null,
        },
        items: updatedOrderItems,
        // Saving an order always moves it to "Hazırlanıyor" (toplaniyor).
        // "completed" is only set when a stock-arrival (irsaliye / depoStok)
        // reconciliation confirms the items were delivered.
        // "eksik" is set only by that reconciliation when items are missing.
        status: 'toplaniyor',
        approvedAt: serverTimestamp(),
        approvedById: currentUser?.uid || null,
        approvedBy: currentUserProfile?.name || currentUser?.email || null,
      };

      await updateDoc(doc(db, 'orders', selectedOrder.id), payload);
      setShowSaveFx(true);

      toast({
        title: 'Sipariş Hazırlanıyor',
        description: 'Sipariş hazırlanan listesine taşındı; teslimat irsaliye/stok girişi ile tamamlanacak.',
      });
    } catch (e) {
      console.error(e);
      toast({ title: 'Hata', description: 'Sipariş kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRouteToDepot = async () => {
    if (!selectedOrder?.id || !routeDepotId) return;
    const depot = depots.find((d) => d.id === routeDepotId);
    if (!depot) return;
    setIsRouting(true);
    try {
      // Preserve items belonging to other lab groups; only update the user's rows.
      const rowsByItemId = new Map(rows.map((r) => [r.itemId, r] as const));
      const existingFulfillmentByItemId = new Map<string, any>();
      (selectedOrder.peripheralFulfillment?.items || []).forEach((it: any) => {
        existingFulfillmentByItemId.set(it.itemId, it);
      });

      const updatedOrderItems = (selectedOrder.items || []).map((it: any) => {
        const row = rowsByItemId.get(it.id);
        if (row) {
          return {
            id: row.itemId,
            stokKodu: row.stokKodu,
            stokAdi: row.stokAdi,
            adet: row.sentAdet,
          };
        }
        return it;
      });

      const allItemIds = new Set<string>();
      (selectedOrder.items || []).forEach((it: any) => { if (it?.id) allItemIds.add(it.id); });
      existingFulfillmentByItemId.forEach((_, k) => allItemIds.add(k));
      const fulfillmentItems: PeripheralFulfillmentItem[] = Array.from(allItemIds).map((itemId) => {
        const row = rowsByItemId.get(itemId);
        if (row) {
          return {
            itemId: row.itemId,
            stokKodu: row.stokKodu,
            requestedAdet: row.sentAdet,
            sentAdet: row.sentAdet,
            fulfilled: row.fulfilled,
          } as PeripheralFulfillmentItem;
        }
        const existing = existingFulfillmentByItemId.get(itemId);
        if (existing) return existing as PeripheralFulfillmentItem;
        const item = (selectedOrder.items || []).find((it: any) => it.id === itemId);
        return {
          itemId,
          stokKodu: item?.stokKodu || '',
          requestedAdet: Number(item?.adet) || 0,
          sentAdet: Number(item?.adet) || 0,
          fulfilled: false,
        } as PeripheralFulfillmentItem;
      });

      await updateDoc(doc(db, 'orders', selectedOrder.id), {
        depotId: depot.id,
        depotName: depot.name ?? null,
        status: 'pending',
        items: updatedOrderItems,
        'peripheralFulfillment.items': fulfillmentItems,
        routedToDepotAt: serverTimestamp(),
        routedToDepotById: currentUser?.uid || null,
        routedToDepotBy: currentUserProfile?.name || currentUser?.email || null,
      });
      toast({
        title: 'Depoya Yönlendirildi',
        description: `Sipariş ${depot.name} deposuna yönlendirildi.`,
      });
      setIsRouteDialogOpen(false);
      setRouteDepotId('');
    } catch {
      toast({ title: 'Hata', description: 'Sipariş depoya yönlendirilemedi.', variant: 'destructive' });
    } finally {
      setIsRouting(false);
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

  const removeRow = (itemId: string) => {
    setRows((prev) => prev.filter((r) => r.itemId !== itemId));
  };

  const handleSaveRowAmount = async (itemId: string, newAdet: number) => {
    if (!selectedOrder?.id) return;
    try {
      const updatedOrderItems = rows.map((r) => ({
        id: r.itemId,
        stokKodu: r.stokKodu,
        stokAdi: r.stokAdi,
        adet: r.itemId === itemId ? newAdet : r.sentAdet,
      }));

      const fulfillmentItems: PeripheralFulfillmentItem[] = rows.map((r) => ({
        itemId: r.itemId,
        stokKodu: r.stokKodu,
        requestedAdet: r.itemId === itemId ? newAdet : r.sentAdet,
        sentAdet: r.itemId === itemId ? newAdet : r.sentAdet,
        fulfilled: r.fulfilled,
      }));

      await updateDoc(doc(db, 'orders', selectedOrder.id), {
        items: updatedOrderItems,
        'peripheralFulfillment.items': fulfillmentItems,
      });
      
      setRows((prev) => prev.map(r => r.itemId === itemId ? { ...r, requestedAdet: newAdet } : r));
      toast({ title: 'Başarılı', description: 'Adet kaydedildi.' });
    } catch (e) {
      toast({ title: 'Hata', description: 'Adet kaydedilemedi.', variant: 'destructive' });
    }
  };

  const getStatusInfo = (order: Order) => {
    const s = order.status;
    if (s === 'pending')
      return {
        label: 'Beklemede',
        cls: 'loj-status-badge loj-status-badge--warning',
        Icon: Hourglass,
      };
    if (s === 'eksik')
      return {
        label: 'Eksik',
        cls: 'loj-status-badge loj-status-badge--danger',
        Icon: AlertCircle,
      };
    if (s === 'toplaniyor')
      return {
        label: 'Hazırlanıyor',
        cls: 'loj-status-badge loj-status-badge--info',
        Icon: Truck,
      };
    if (s === 'completed')
      return {
        label: 'Teslim',
        cls: 'loj-status-badge loj-status-badge--success',
        Icon: CheckCircle2,
      };
    if (s === 'cancelled')
      return {
        label: 'İptal',
        cls: 'loj-status-badge loj-status-badge--danger',
        Icon: XCircle,
      };
    return {
      label: 'İşlemde',
      cls: 'loj-status-badge loj-status-badge--info',
      Icon: Clock3,
    };
  };

  const getOrderStage = (order: Order | null): number => {
    if (!order) return 0;
    const s = String(order.status || '');
    if (s === 'completed') return 3;
    if (s === 'toplaniyor') return 2;
    if (s === 'eksik') return 2;
    if (s === 'pending') return 1;
    return 0;
  };

  const totalOrders = peripheralOrders.length + completedOrders.length;
  const activeCount = peripheralOrders.length;
  const completedCount = completedOrders.length;
  const waitingApprovalCount = peripheralOrders.filter((o) => o.status === 'pending').length;
  const missingCount = peripheralOrders.filter((o) => o.status === 'eksik').length;

  const progressValue = useMemo(() => {
    if (rows.length === 0) return 0;
    const fulfilled = rows.filter((r) => r.fulfilled).length;
    return (fulfilled / rows.length) * 100;
  }, [rows]);

  // isLoading spinner kaldırıldı — artık TanStack Query cache'den anında geliyor.
  // Siparişler listesi onSnapshot ile birkaç 100ms içinde dolar; bekleme ekranı yok.

  return (
    <div className="loj-shell min-h-screen">
      <div className="max-w-[1700px] mx-auto px-4 py-5 sm:px-6 sm:py-6 space-y-5">
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
          <p className="text-xs flex items-center gap-2" style={{ color: 'var(--loj-muted)' }}>
            <Sparkles className="h-3.5 w-3.5" />
            Lojistik iş terminali · {activeCount} aktif sipariş
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
              <button
                onClick={() => {
                  exportOrdersToExcel(
                    [...peripheralOrders, ...completedOrders],
                  {
                    fileBaseName: 'aktif_siparisler',
                    productNameByStokKodu: productNameMap,
                  }
                );
                setMoreMenuOpen(false);
              }}
              disabled={peripheralOrders.length + completedOrders.length === 0}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" style={{ color: 'var(--loj-muted)' }} /> Excel İndir
            </button>
            <button
              onClick={() => {
                if (!selectedOrder) return;
                const orderNo = ((selectedOrder.id ?? '').slice(-6) || '').toUpperCase();
                exportOrdersToExcel([selectedOrder], {
                  fileBaseName: orderNo ? `siparis_${orderNo}` : 'siparis_detayi',
                  productNameByStokKodu: productNameMap,
                });
                setMoreMenuOpen(false);
              }}
              disabled={!selectedOrder}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" style={{ color: 'var(--loj-muted)' }} /> Seçili Sipariş Excel
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="loj-kpi loj-kpi--accent">
          <div className="flex items-center justify-between mb-2 relative z-[1]">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
              Açık Sipariş
            </span>
            <span className="loj-kpi__icon"><Zap className="h-[18px] w-[18px]" /></span>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold relative z-[1]" style={{ color: 'var(--loj-text)' }}>{activeCount}</p>
          <div className="flex items-center gap-1.5 mt-2 relative z-[1]">
            <span className="loj-kpi__trend">
              <TrendingUp className="h-3 w-3" />
              {waitingApprovalCount} bekleyen
            </span>
          </div>
        </div>
        <div className="loj-kpi loj-kpi--success">
          <div className="flex items-center justify-between mb-2 relative z-[1]">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
              Toplam Sipariş
            </span>
            <span className="loj-kpi__icon"><ShoppingCart className="h-[18px] w-[18px]" /></span>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold relative z-[1]" style={{ color: 'var(--loj-text)' }}>
            {totalOrders}
          </p>
          <div className="flex items-center gap-1.5 mt-2 relative z-[1]">
            <span className="loj-kpi__trend">
              <TrendingUp className="h-3 w-3" />
              bu hafta
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/siparis-gecmis')}
          className="loj-kpi loj-kpi--info loj-kpi--clickable text-left w-full"
          aria-label="Geçmiş siparişler paneline git"
        >
          <div className="flex items-center justify-between mb-2 relative z-[1]">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
              Geçmiş Sipariş
            </span>
            <span className="loj-kpi__icon"><History className="h-[18px] w-[18px]" /></span>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold relative z-[1]" style={{ color: 'var(--loj-text)' }}>
            {totalOrders}
          </p>
          <div className="flex items-center gap-1.5 mt-2 relative z-[1]">
            <span className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--loj-muted)' }}>
              tüm siparişler <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </button>
        <button
          type="button"
          onClick={() => router.push('/siparisler/tamamlanan')}
          className="loj-kpi loj-kpi--warning loj-kpi--clickable text-left w-full"
          aria-label="Tamamlanan siparişler paneline git"
        >
          <div className="flex items-center justify-between mb-2 relative z-[1]">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
              Tamamlanan
            </span>
            <span className="loj-kpi__icon"><Heart className="h-[18px] w-[18px]" /></span>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold relative z-[1]" style={{ color: 'var(--loj-text)' }}>
            {completedCount}
          </p>
          <div className="flex items-center gap-1.5 mt-2 relative z-[1]">
            {missingCount > 0 ? (
              <span className="loj-kpi__trend loj-kpi__trend--down">
                <TrendingDown className="h-3 w-3" />
                {missingCount} eksik
              </span>
            ) : (
              <span className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--loj-muted)' }}>
                liste <ArrowRight className="h-3 w-3" />
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Master-Detail Split */}
      <div className="grid grid-cols-1 xl:grid-cols-[390px_minmax(0,1fr)] gap-4">
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
              ['toplaniyor', 'Hazırlanan'],
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
              filteredOrders.map((order) => (
                <MemoizedLojOrderCard
                  key={order.id}
                  order={order}
                  isSelected={selectedOrderId === order.id}
                  productNameMap={productNameMap}
                  onSelect={() => setSelectedOrderId(order.id ?? null)}
                />
              ))
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
            const orderNo = (order.id ?? '').slice(-6).toUpperCase() || '------';
            const stage = getOrderStage(order);
            const headerStatus = getStatusInfo(order);
            const HeaderStatusIcon = headerStatus.Icon;
            const stageNames = ['Beklemede', 'Hazırlanıyor', 'Teslim Edildi'];

            return (
              <div className="flex flex-col h-full">
                {/* Detail Header */}
                <div
                  className="flex items-start justify-between gap-3 p-5 border-b"
                  style={{ borderColor: 'var(--loj-stroke)' }}
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
                      Sipariş No
                    </p>
                    <h2
                      className="text-xl sm:text-2xl font-extrabold mt-0.5 tracking-tight"
                      style={{ color: 'var(--loj-text)' }}
                    >
                      ORD-{orderNo}
                    </h2>
                    <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--loj-muted)' }}>
                      <Building2 className="h-3 w-3" /> {order.kurumAdi}
                      <span className="opacity-50">·</span>
                      {createdAtStr}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={headerStatus.cls}>
                      <HeaderStatusIcon className="h-3 w-3" /> {headerStatus.label}
                    </span>
                    {order.depotId && (
                      <p className="text-[11px] mt-1 font-medium" style={{ color: 'var(--loj-muted)' }}>
                        Depo: {order.depotName || order.depotId}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const orderNo = ((order.id ?? '').slice(-6) || '').toUpperCase();
                        exportOrdersToExcel([order], {
                          fileBaseName: orderNo ? `siparis_${orderNo}` : 'siparis_detayi',
                          productNameByStokKodu: productNameMap,
                        });
                      }}
                      className="loj-btn-outline mt-2 ml-auto"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Excel
                    </button>
                    <p
                      className="text-2xl sm:text-3xl font-extrabold mt-1.5"
                      style={{ color: 'var(--loj-accent)' }}
                    >
                      {totalRequestedAdet}
                      <span className="text-sm font-medium ml-1" style={{ color: 'var(--loj-muted)' }}>
                        adet
                      </span>
                    </p>
                  </div>
                </div>

                {/* Status Timeline */}
                <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--loj-text)' }}>
                      Sipariş Durumu
                    </span>
                    <button
                      type="button"
                      onClick={handleApprove}
                      disabled={isSaving}
                      className="loj-btn-ghost-accent"
                    >
                      {isSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>İlerle <ArrowRight className="h-3 w-3" /></>
                      )}
                    </button>
                  </div>
                  <div className="loj-stepper-track">
                    {stageNames.map((name, idx) => {
                      const stepIdx = idx + 1;
                      const isDone = stepIdx < stage || (stepIdx === stage && stage === 3);
                      const isActive = stepIdx === stage && stage !== 3;
                      const stepCls = isDone ? 'done' : isActive ? 'active' : 'pending';
                      return (
                        <React.Fragment key={name}>
                          <div className={cn('loj-step', stepCls)}>
                            <div className={cn('loj-step-circle', stepCls)}>
                              {isDone ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                stepIdx
                              )}
                            </div>
                            <span className="loj-step-label">{name}</span>
                          </div>
                          {idx < stageNames.length - 1 && (
                            <div className={cn('loj-step-line', stepIdx < stage && 'done')} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
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

                {/* Delivery History */}
                {(() => {
                  const deliveries = ((order.peripheralFulfillment as any)?.partialDeliveries ?? []) as PartialDelivery[];
                  if (deliveries.length === 0) return null;
                  return (
                    <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--loj-text)' }}>
                          İrsaliye Teslim Geçmişi
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--loj-muted)' }}>
                          {deliveries.length} teslim
                        </span>
                      </div>
                      <DeliveryHistory deliveries={deliveries} productNameMap={productNameMap} compact />
                    </div>
                  );
                })()}

                {/* Order Items */}
                <ScrollArea
                  className="flex-1 px-5 py-3"
                  style={{ maxHeight: 'calc(100vh - 520px)' }}
                >
                  <div className="space-y-3">
                    {rows.map((row, idx) => {
                      const pName = productNameMap.get(row.stokKodu) || row.stokAdi || row.stokKodu;
                      const info = computeLabInfo(row.stokKodu);
                      const productMax30 = compute30DayMax(row.stokKodu);
                      return (
                        <div
                          key={row.itemId ?? idx}
                          className={cn(
                            'loj-product-row !flex-col !items-stretch !p-4',
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
                                {typeof productMax30 === 'number' && productMax30 > 0 && (
                                  <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                    30g Max: {productMax30}
                                  </span>
                                )}
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
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    value={row.sentAdet}
                                    onChange={(e) => setRowSentAdet(row.itemId, e.target.value)}
                                    className="w-14 h-8 text-center text-sm font-bold rounded-lg border-0 outline-none focus:ring-1 ring-[var(--loj-accent)]"
                                    style={{ background: 'var(--loj-surface-2)', color: 'var(--loj-text)' }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSaveRowAmount(row.itemId, row.sentAdet)}
                                    className="loj-btn-outline h-8 px-2"
                                    title="Adedi Kaydet"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                  </button>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeRow(row.itemId)}
                                className="loj-btn-outline h-8 px-2"
                                title="Kalemi siparişten sil"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Extra Stock Info */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-black/5 dark:border-white/5">
                            <div className="flex flex-col">
                              <span className="text-[9px] text-[var(--loj-muted)] uppercase tracking-tight">Son Transfer</span>
                              {isLabStockLoading ? (
                                <p className="text-[11px] font-semibold inline-flex items-center gap-1.5 animate-pulse" style={{ color: 'var(--loj-muted)' }}>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Yükleniyor...
                                </p>
                              ) : (
                                <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--loj-text)' }}>
                                  {info.lastTransfer ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Truck className="h-3 w-3" />
                                      {formatDate(info.lastTransfer.date, 'dd.MM.yyyy')}
                                    </span>
                                  ) : '-'}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-[var(--loj-muted)] uppercase tracking-tight">E.Y. Miadlı Lot</span>
                              {isLabStockLoading ? (
                                <p className="text-[11px] font-semibold inline-flex items-center gap-1.5 animate-pulse" style={{ color: 'var(--loj-muted)' }}>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Yükleniyor...
                                </p>
                              ) : (
                                <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--loj-text)' }}>
                                  {info.closestLot?.lotNumarasi ?? '-'} ({info.closestLot?.miad ?? '-'})
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-[var(--loj-muted)] uppercase tracking-tight">Lot Adedi</span>
                              {isLabStockLoading ? (
                                <p className="text-[11px] font-semibold inline-flex items-center gap-1.5 animate-pulse" style={{ color: 'var(--loj-muted)' }}>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Yükleniyor...
                                </p>
                              ) : (
                                <p className="text-[11px] font-semibold" style={{ color: 'var(--loj-text)' }}>
                                  {info.closestLot?.adet ?? 0} adet
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-[var(--loj-muted)] uppercase tracking-tight">Toplam Ürün</span>
                              {isLabStockLoading ? (
                                <p className="text-[11px] font-semibold inline-flex items-center gap-1.5 animate-pulse" style={{ color: 'var(--loj-muted)' }}>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Yükleniyor...
                                </p>
                              ) : (
                                <p className="text-[11px] font-semibold" style={{ color: 'var(--loj-text)' }}>
                                  {info.totalAdet} adet
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] text-[var(--loj-muted)] uppercase tracking-tight">Toplam Ürün</span>
                              <p className="text-[11px] font-semibold" style={{ color: 'var(--loj-text)' }}>
                                {info.totalAdet} adet
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
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--loj-muted)' }}
                      >
                        Kurum
                      </span>
                      <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--loj-text)' }}>
                        {order.kurumAdi}
                      </p>
                    </div>
                    <div>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--loj-muted)' }}
                      >
                        Kalem
                      </span>
                      <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--loj-text)' }}>
                        {totalKalem} kalem · {totalRequestedAdet} adet
                      </p>
                    </div>
                    <div>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--loj-muted)' }}
                      >
                        Oluşturan
                      </span>
                      <p className="text-xs font-bold mt-0.5 truncate" style={{ color: 'var(--loj-text)' }}>
                        {order.createdBy || '-'}
                      </p>
                    </div>
                    <div>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--loj-muted)' }}
                      >
                        Tarih
                      </span>
                      <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--loj-text)' }}>
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
                    Satırları işaretleyin ve &quot;Siparişi Kaydet&quot; butonuna basın.
                  </div>
                  <button
                    onClick={() => {
                      if (order.depotId) return;
                      setRouteDepotId('');
                      setIsRouteDialogOpen(true);
                    }}
                    disabled={!!order.depotId}
                    className="loj-btn-outline"
                    title={order.depotId ? 'Sipariş zaten depoya yönlendirildi' : 'Siparişi depoya yönlendir'}
                  >
                    <Truck className="h-4 w-4" />
                    {order.depotId ? 'Yönlendirildi' : 'Depoya Yönlendir'}
                  </button>
                  <button
                    onClick={() => handleDelete(order.id ?? '')}
                    className="loj-btn-outline"
                    title="Siparişi Sil"
                    aria-label="Siparişi Sil"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={isSaving}
                    className="loj-btn-primary"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Kaydediliyor
                      </>
                    ) : (
                      <>
                        Siparişi Kaydet
                        <CheckCircle2 className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
      </div>
      <Dialog open={isRouteDialogOpen} onOpenChange={setIsRouteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Siparişi Depoya Yönlendir</DialogTitle>
            <DialogDescription>
              Sipariş depoya yönlendirildiğinde depo toplama/okutma akışına geçer. Tamamlandığında sipariş otomatik olarak tamamlananlara taşınır.
            </DialogDescription>
          </DialogHeader>
          <Select value={routeDepotId} onValueChange={setRouteDepotId}>
            <SelectTrigger>
              <SelectValue placeholder="Depo seçin..." />
            </SelectTrigger>
            <SelectContent>
              {depots.map((d) => (
                <SelectItem key={d.id} value={d.id ?? ''}>
                  {d.name || d.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <button type="button" className="loj-btn-outline" onClick={() => setIsRouteDialogOpen(false)}>
              İptal
            </button>
            <button type="button" className="loj-btn-primary" onClick={handleRouteToDepot} disabled={!routeDepotId || isRouting}>
              {isRouting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
              Yönlendir
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OrderConfirmAnimation
        open={showSaveFx}
        label="Sipariş Kaydedildi"
        variant="success"
        onClose={() => setShowSaveFx(false)}
      />
    </div>
  );
}
