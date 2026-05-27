'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import type { Hospital, Order, ProductCode } from '@/lib/types';
import {
  ArrowLeft,
  AlertCircle,
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  History as HistoryIcon,
  Hourglass,
  Loader2,
  Search,
  Truck,
  XCircle,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LabSelector } from '@/components/common/LabSelector';
import DeliveryHistory, {
  type PartialDelivery,
} from '@/components/lojistik-terminal/delivery-history';
import { exportOrdersToExcel } from '@/lib/lojistik/export-orders';
import { cn } from '@/lib/utils';

type StatusFilter =
  | 'all'
  | 'pending'
  | 'toplaniyor'
  | 'completed'
  | 'eksik'
  | 'cancelled';

function getStatusInfo(order: Order) {
  const s = String(order.status || '');
  if (s === 'completed')
    return { label: 'Teslim', cls: 'loj-status-badge loj-status-badge--success', Icon: CheckCircle2 };
  if (s === 'toplaniyor')
    return { label: 'Hazırlanıyor', cls: 'loj-status-badge loj-status-badge--info', Icon: Truck };
  if (s === 'eksik')
    return { label: 'Eksik', cls: 'loj-status-badge loj-status-badge--danger', Icon: AlertCircle };
  if (s === 'pending')
    return { label: 'Beklemede', cls: 'loj-status-badge loj-status-badge--warning', Icon: Hourglass };
  if (s === 'cancelled')
    return { label: 'İptal', cls: 'loj-status-badge loj-status-badge--danger', Icon: XCircle };
  return { label: 'İşlemde', cls: 'loj-status-badge loj-status-badge--info', Icon: Clock3 };
}

export default function LojistikSiparisGecmisPanel() {
  const router = useRouter();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [labFilter, setLabFilter] = useState<string>('all');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const assignedLabIds = useMemo(() => {
    const s = new Set<string>();
    (currentUserProfile?.assignedLaboratories ?? []).forEach((id) => {
      if (id) s.add(id);
    });
    return s;
  }, [currentUserProfile?.assignedLaboratories]);

  // One-time loads: products + hospitals
  useEffect(() => {
    (async () => {
      const [pSnap, hSnap] = await Promise.all([
        getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin)),
      ]);
      setProductCodes(
        pSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ProductCode))
      );
      setHospitals(hSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Hospital)));
    })();
  }, []);

  // Listen to ALL peripheral orders the user has access to
  useEffect(() => {
    const q = scopedQuery('orders', currentCompanyId, isSuperAdmin, where('isPeripheral', '==', true));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            ...data,
            id: d.id,
            createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date(),
          } as Order;
        })
        .filter((o) => !!o.labId && assignedLabIds.has(o.labId as string))
        .sort((a, b) => {
          const at = (a.createdAt as Date)?.getTime?.() ?? 0;
          const bt = (b.createdAt as Date)?.getTime?.() ?? 0;
          return bt - at;
        });
      setOrders(list);
      setLoading(false);
    });
    return () => unsub();
  }, [assignedLabIds]);

  const productNameMap = useMemo(() => {
    const m = new Map<string, string>();
    productCodes.forEach((p) => {
      if (p.stokKodu && p.stokAdi) m.set(p.stokKodu, p.stokAdi);
    });
    return m;
  }, [productCodes]);

  const hospitalNameById = useMemo(() => {
    const m = new Map<string, string>();
    hospitals.forEach((h) => {
      if (h.id) m.set(h.id, (h.name || (h as any).ad || '') as string);
    });
    return m;
  }, [hospitals]);

  const visibleHospitals = useMemo(
    () => hospitals.filter((h) => assignedLabIds.has(h.id ?? '')),
    [hospitals, assignedLabIds]
  );

  const filteredOrders = useMemo(() => {
    let list = orders;
    if (labFilter !== 'all') {
      list = list.filter((o) => o.labId === labFilter);
    }
    if (filter !== 'all') {
      list = list.filter((o) => o.status === filter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (o) =>
          o.kurumAdi?.toLowerCase().includes(q) ||
          o.id?.toLowerCase().includes(q) ||
          o.createdBy?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [orders, filter, labFilter, search]);

  const counts = useMemo(() => {
    const c = {
      all: orders.length,
      pending: 0,
      toplaniyor: 0,
      completed: 0,
      eksik: 0,
      cancelled: 0,
    };
    orders.forEach((o) => {
      const s = String(o.status || '');
      if (s in c) (c as any)[s]++;
    });
    return c;
  }, [orders]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  if (loading) {
    return (
      <div className="loj-shell flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--loj-accent)' }} />
      </div>
    );
  }

  return (
    <div className="loj-shell min-h-screen">
      <div className="max-w-[1700px] mx-auto px-4 py-5 sm:px-6 sm:py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/siparisler')}
            className="loj-btn-outline"
            aria-label="Sipariş paneline dön"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1
              className="text-lg sm:text-xl font-bold flex items-center gap-2"
              style={{ color: 'var(--loj-text)' }}
            >
              <HistoryIcon className="h-5 w-5" style={{ color: 'var(--loj-accent)' }} />
              Geçmiş Siparişler
            </h1>
            <p className="text-xs" style={{ color: 'var(--loj-muted)' }}>
              {assignedLabIds.size > 0
                ? `${assignedLabIds.size} laboratuvar · ${orders.length} sipariş`
                : 'Atanmış laboratuvar yok'}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              exportOrdersToExcel(filteredOrders, {
                fileBaseName: 'siparis_gecmisi',
                hospitalNameById,
                productNameByStokKodu: productNameMap,
              })
            }
            disabled={filteredOrders.length === 0}
            className="loj-btn-primary"
            title={`${filteredOrders.length} siparişi Excel olarak indir`}
          >
            <Download className="h-4 w-4" />
            Excel İndir
            <span className="opacity-80 font-medium ml-1">({filteredOrders.length})</span>
          </button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          <KpiTile label="Toplam" value={counts.all} tone="accent" Icon={HistoryIcon} />
          <KpiTile label="Bekleyen" value={counts.pending} tone="warning" Icon={Hourglass} />
          <KpiTile label="Hazırlanan" value={counts.toplaniyor} tone="info" Icon={Truck} />
          <KpiTile label="Tamamlanan" value={counts.completed} tone="success" Icon={CheckCircle2} />
          <KpiTile label="Eksik" value={counts.eksik} tone="danger" Icon={AlertCircle} />
        </div>

        {/* Master-Detail Split */}
        <div className="grid grid-cols-1 xl:grid-cols-[440px_minmax(0,1fr)] gap-4">
          <div className="loj-list-panel">
            <div
              className="flex flex-wrap gap-1.5 px-4 py-3 border-b"
              style={{ borderColor: 'var(--loj-stroke)' }}
            >
              {([
                ['all', 'Tümü'],
                ['pending', 'Bekleyen'],
                ['toplaniyor', 'Hazırlanan'],
                ['completed', 'Tamamlanan'],
                ['eksik', 'Eksik'],
                ['cancelled', 'İptal'],
              ] as [StatusFilter, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn('loj-chip', filter === key && 'active')}
                >
                  {label}
                </button>
              ))}
            </div>

            {visibleHospitals.length > 1 && (
              <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
                <LabSelector
                  size="sm"
                  labs={visibleHospitals.map(h => ({ id: h.id, name: h.name || h.ad || h.id, kod: h.kod }))}
                  value={labFilter}
                  onChange={setLabFilter}
                  placeholder="Tüm laboratuvarlar"
                  allOption={{ value: 'all', label: 'Tüm laboratuvarlar' }}
                  icon={false}
                />
              </div>
            )}

            <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
                  style={{ color: 'var(--loj-muted)' }}
                />
                <input
                  placeholder="Kurum, sipariş no veya kullanıcı ara..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 rounded-lg text-xs border-0 outline-none"
                  style={{ background: 'var(--loj-surface-2)', color: 'var(--loj-text)' }}
                />
              </div>
            </div>

            <ScrollArea className="flex-1" style={{ maxHeight: 'calc(100vh - 460px)' }}>
              {filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <HistoryIcon
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
                  const StatusIcon = status.Icon;
                  const totalAdet = (order.items ?? []).reduce(
                    (s, i) => s + (Number(i.adet) || 0),
                    0
                  );
                  const isSelected = selectedOrderId === order.id;
                  const orderNo = (order.id ?? '').slice(-6).toUpperCase();
                  const deliveriesCount =
                    ((order.peripheralFulfillment as any)?.partialDeliveries ?? []).length;
                  return (
                    <button
                      key={order.id}
                      onClick={() => setSelectedOrderId(order.id ?? null)}
                      className={cn('loj-order-item', isSelected && 'loj-selected')}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate flex items-center gap-1.5" style={{ color: 'var(--loj-text)' }}>
                          <Building2 className="h-3.5 w-3.5 opacity-70 shrink-0" />
                          <span className="truncate">{order.kurumAdi}</span>
                        </p>
                        <p className="text-[11px] truncate mt-0.5 flex items-center gap-1" style={{ color: 'var(--loj-muted)' }}>
                          <span className="font-mono">ORD-{orderNo}</span>
                          <span className="opacity-50">·</span>
                          {order.createdAt
                            ? formatDate(order.createdAt as Date, 'dd.MM.yyyy', { locale: tr })
                            : '-'}
                          {deliveriesCount > 0 ? (
                            <>
                              <span className="opacity-50">·</span>
                              <span className="inline-flex items-center gap-0.5" style={{ color: 'var(--loj-accent)' }}>
                                <Truck className="h-3 w-3" /> {deliveriesCount}
                              </span>
                            </>
                          ) : null}
                        </p>
                        <span className={cn(status.cls, 'mt-1.5')}>
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-extrabold" style={{ color: 'var(--loj-accent)' }}>
                          {totalAdet}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--loj-muted)' }}>
                          adet
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </ScrollArea>
          </div>

          {/* Detail */}
          <div className="loj-detail-panel">
            {!selectedOrder ? (
              <div className="flex flex-col items-center justify-center h-full py-20 px-4 text-center">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: 'var(--loj-surface-2)' }}
                >
                  <HistoryIcon className="h-7 w-7" style={{ color: 'var(--loj-muted)' }} />
                </div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--loj-text)' }}>
                  Sipariş seçin
                </p>
                <p className="text-xs" style={{ color: 'var(--loj-muted)' }}>
                  Detayları görmek için sol listeden bir sipariş seçin
                </p>
              </div>
            ) : (
              (() => {
                const order = selectedOrder;
                const status = getStatusInfo(order);
                const StatusIcon = status.Icon;
                const orderNo = (order.id ?? '').slice(-6).toUpperCase();
                const createdAt = order.createdAt as Date | null;
                const transferredAt = (order.transferredAt as any)?.toDate?.() ?? null;
                const totalAdet = (order.items ?? []).reduce(
                  (s, i) => s + (Number(i.adet) || 0),
                  0
                );
                const fulfillment = order.peripheralFulfillment as any;
                const deliveries = (fulfillment?.partialDeliveries ?? []) as PartialDelivery[];
                const fulfillmentItems = (fulfillment?.items ?? []) as Array<{
                  itemId: string;
                  stokKodu: string;
                  sentAdet?: number;
                  deliveredAdet?: number;
                  missingAdet?: number;
                  fulfilled?: boolean;
                }>;
                const fulfillmentByItemId = new Map(
                  fulfillmentItems.map((it) => [it.itemId, it])
                );

                return (
                  <div className="flex flex-col h-full">
                    <div className="p-5 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
                            Sipariş No
                          </p>
                          <h2 className="text-xl sm:text-2xl font-extrabold mt-0.5 tracking-tight" style={{ color: 'var(--loj-text)' }}>
                            ORD-{orderNo}
                          </h2>
                          <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--loj-muted)' }}>
                            <Building2 className="h-3 w-3" /> {order.kurumAdi}
                            <span className="opacity-50">·</span>
                            {createdAt ? formatDate(createdAt, 'dd MMM · HH:mm', { locale: tr }) : '-'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={status.cls}>
                            <StatusIcon className="h-3 w-3" /> {status.label}
                          </span>
                          <p className="text-2xl sm:text-3xl font-extrabold mt-1.5" style={{ color: 'var(--loj-accent)' }}>
                            {totalAdet}
                            <span className="text-sm font-medium ml-1" style={{ color: 'var(--loj-muted)' }}>adet</span>
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
                      <div className="loj-meta-grid">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>Kurum</span>
                          <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--loj-text)' }}>{order.kurumAdi}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>Kalem</span>
                          <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--loj-text)' }}>
                            {(order.items ?? []).length} kalem · {totalAdet} adet
                          </p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>Oluşturan</span>
                          <p className="text-xs font-bold mt-0.5 truncate" style={{ color: 'var(--loj-text)' }}>{order.createdBy || '-'}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>Teslim</span>
                          <p className="text-xs font-bold mt-0.5" style={{ color: transferredAt ? 'var(--loj-success)' : 'var(--loj-muted)' }}>
                            {transferredAt ? formatDate(transferredAt, 'dd.MM.yyyy', { locale: tr }) : '-'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <ScrollArea className="flex-1 px-5 py-3" style={{ maxHeight: 'calc(100vh - 480px)' }}>
                      {/* Order items + fulfillment summary */}
                      <div className="space-y-2 mb-4">
                        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--loj-text)' }}>
                          Sipariş Kalemleri
                        </p>
                        {(order.items ?? []).map((it, idx) => {
                          const itemId = it.id ?? `${order.id}-${idx}`;
                          const f = fulfillmentByItemId.get(itemId);
                          const name = productNameMap.get(it.stokKodu) || it.stokAdi || it.stokKodu;
                          const delivered = Number(f?.deliveredAdet ?? 0);
                          const missing = Number(f?.missingAdet ?? 0);
                          const sent = Number(f?.sentAdet ?? it.adet) || 0;
                          return (
                            <div
                              key={idx}
                              className="rounded-lg px-3 py-2"
                              style={{
                                background: 'var(--loj-surface-3)',
                                border: '1px solid var(--loj-stroke)',
                              }}
                            >
                              <div className="flex items-center justify-between text-xs">
                                <div className="min-w-0 flex-1">
                                  <p className="font-bold truncate" style={{ color: 'var(--loj-text)' }}>{name}</p>
                                  <p className="font-mono text-[10px]" style={{ color: 'var(--loj-muted)' }}>{it.stokKodu}</p>
                                </div>
                                <div className="text-right ml-3 shrink-0">
                                  <p className="text-sm font-extrabold" style={{ color: 'var(--loj-accent)' }}>{sent}</p>
                                  <p className="text-[10px] uppercase" style={{ color: 'var(--loj-muted)' }}>onaylanan</p>
                                </div>
                              </div>
                              {f && (delivered > 0 || missing > 0) ? (
                                <div className="mt-1.5 pt-1.5 border-t flex items-center gap-3 text-[10px]" style={{ borderColor: 'var(--loj-stroke)' }}>
                                  <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--loj-success)' }}>
                                    <CheckCircle2 className="h-3 w-3" /> teslim {delivered}
                                  </span>
                                  {missing > 0 ? (
                                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--loj-warning)' }}>
                                      <AlertCircle className="h-3 w-3" /> eksik {missing}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      {/* Delivery history */}
                      <div className="mb-2">
                        <p className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--loj-text)' }}>
                          <Truck className="h-3.5 w-3.5" /> İrsaliye Eşleşmeleri
                        </p>
                        <DeliveryHistory deliveries={deliveries} productNameMap={productNameMap} />
                      </div>
                    </ScrollArea>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: 'accent' | 'success' | 'warning' | 'info' | 'danger';
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className={cn('loj-kpi', `loj-kpi--${tone === 'danger' ? 'warning' : tone}`)}>
      <div className="flex items-center justify-between mb-2 relative z-[1]">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
          {label}
        </span>
        <span className="loj-kpi__icon"><Icon className="h-[18px] w-[18px]" /></span>
      </div>
      <p className="text-2xl sm:text-3xl font-extrabold relative z-[1]" style={{ color: 'var(--loj-text)' }}>
        {value}
      </p>
    </div>
  );
}
