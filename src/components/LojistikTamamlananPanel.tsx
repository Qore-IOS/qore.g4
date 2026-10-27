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
} from '../lib/data/client';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import { db } from '../lib/data/client';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/document-helpers';
import { ORDERS_ARCHIVE_COLLECTION, mergeOrdersById } from '@/lib/orders-archive';
import type { Order, ProductCode } from '@/lib/types';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Download,
  Loader2,
  Search,
  Truck,
  ShoppingCart,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import DeliveryHistory, {
  type PartialDelivery,
} from '@/components/lojistik-terminal/delivery-history';
import { exportOrdersToExcel } from '@/lib/lojistik/export-orders';
import { cn } from '@/lib/utils';

export default function LojistikTamamlananPanel() {
  const router = useRouter();
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  // Tamamlanan siparişler iki kaynaktan gelir: arşiv (`ordersArchive`, yeni
  // tamamlananlar) + canlı `orders`'ta status==completed kalanlar (backfill
  // öncesi). id'ye göre birleştirilir → geçişte veri kaybı olmaz.
  const [liveCompleted, setLiveCompleted] = useState<Order[]>([]);
  const [archivedOrders, setArchivedOrders] = useState<Order[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const assignedLabIds = useMemo(() => {
    const s = new Set<string>();
    (currentUserProfile?.assignedLaboratories ?? []).forEach((id) => {
      if (id) s.add(id);
    });
    return s;
  }, [currentUserProfile?.assignedLaboratories]);

  // Product codes for name lookup
  useEffect(() => {
    (async () => {
      const snap = await getDocs(scopedQuery('productCodes', currentCompanyId, isSuperAdmin));
      setProductCodes(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ProductCode))
      );
    })();
  }, [currentCompanyId, isSuperAdmin]);

  // Listen to completed peripheral orders — arşiv + (geçiş için) canlı kalanlar.
  useEffect(() => {
    const mapDocs = (snap: any): Order[] =>
      snap.docs.map((d: any) => {
        const data = d.data();
        return {
          ...data,
          id: d.id,
          createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date(),
        } as Order;
      });
    const unsubLive = onSnapshot(
      query(scopedQuery('orders', currentCompanyId, isSuperAdmin), where('isPeripheral', '==', true), where('status', '==', 'completed')),
      (snap) => { setLiveCompleted(mapDocs(snap)); setLoading(false); }
    );
    const unsubArchive = onSnapshot(
      query(collection(db, ORDERS_ARCHIVE_COLLECTION), where('isPeripheral', '==', true)),
      (snap) => { setArchivedOrders(mapDocs(snap)); setLoading(false); }
    );
    return () => { unsubLive(); unsubArchive(); };
  }, []);

  const orders = useMemo(() => {
    return mergeOrdersById(archivedOrders, liveCompleted)
      .filter((o) => !!o.labId && assignedLabIds.has(o.labId as string))
      .sort((a, b) => {
        const at = (a.transferredAt as any)?.toDate?.()?.getTime?.() ?? (a.createdAt as Date)?.getTime?.() ?? 0;
        const bt = (b.transferredAt as any)?.toDate?.()?.getTime?.() ?? (b.createdAt as Date)?.getTime?.() ?? 0;
        return bt - at;
      });
  }, [archivedOrders, liveCompleted, assignedLabIds]);

  const productNameMap = useMemo(() => {
    const m = new Map<string, string>();
    productCodes.forEach((p) => {
      if (p.stokKodu && p.stokAdi) m.set(p.stokKodu, p.stokAdi);
    });
    return m;
  }, [productCodes]);

  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) =>
        o.kurumAdi?.toLowerCase().includes(q) ||
        o.id?.toLowerCase().includes(q) ||
        o.createdBy?.toLowerCase().includes(q)
    );
  }, [orders, search]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const totalDelivered = orders.length;
  const totalAdetDelivered = orders.reduce(
    (s, o) => s + ((o.items ?? []).reduce((a, it) => a + (Number(it.adet) || 0), 0)),
    0
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
              <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--loj-success)' }} />
              Tamamlanan Siparişler
            </h1>
            <p className="text-xs" style={{ color: 'var(--loj-muted)' }}>
              İrsaliye ile eksiksiz teslim edilen siparişler · {totalDelivered} sipariş
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              exportOrdersToExcel(filtered, {
                fileBaseName: 'tamamlanan_siparisler',
                productNameByStokKodu: productNameMap,
              })
            }
            disabled={filtered.length === 0}
            className="loj-btn-primary"
            title={`${filtered.length} tamamlanan siparişi Excel olarak indir`}
          >
            <Download className="h-4 w-4" />
            Excel İndir
            <span className="opacity-80 font-medium ml-1">({filtered.length})</span>
          </button>
        </div>

        {/* KPI mini */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <div className="loj-kpi loj-kpi--success">
            <div className="flex items-center justify-between mb-2 relative z-[1]">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
                Tamamlanan
              </span>
              <span className="loj-kpi__icon"><CheckCircle2 className="h-[18px] w-[18px]" /></span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold relative z-[1]" style={{ color: 'var(--loj-text)' }}>
              {totalDelivered}
            </p>
          </div>
          <div className="loj-kpi loj-kpi--accent">
            <div className="flex items-center justify-between mb-2 relative z-[1]">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
                Toplam Adet
              </span>
              <span className="loj-kpi__icon"><ShoppingCart className="h-[18px] w-[18px]" /></span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold relative z-[1]" style={{ color: 'var(--loj-text)' }}>
              {totalAdetDelivered}
            </p>
          </div>
          <div className="loj-kpi loj-kpi--info">
            <div className="flex items-center justify-between mb-2 relative z-[1]">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>
                Lab
              </span>
              <span className="loj-kpi__icon"><Building2 className="h-[18px] w-[18px]" /></span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold relative z-[1]" style={{ color: 'var(--loj-text)' }}>
              {assignedLabIds.size}
            </p>
          </div>
        </div>

        {/* Master-Detail Split */}
        <div className="grid grid-cols-1 xl:grid-cols-[440px_minmax(0,1fr)] gap-4">
          <div className="loj-list-panel">
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
            <ScrollArea className="flex-1" style={{ maxHeight: 'calc(100vh - 360px)' }}>
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <CheckCircle2
                    className="h-8 w-8 mb-2"
                    style={{ color: 'var(--loj-muted)', opacity: 0.4 }}
                  />
                  <p className="text-sm font-medium" style={{ color: 'var(--loj-muted)' }}>
                    Tamamlanan sipariş bulunamadı
                  </p>
                </div>
              ) : (
                filtered.map((order) => {
                  const totalAdet = (order.items ?? []).reduce(
                    (s, i) => s + (Number(i.adet) || 0),
                    0
                  );
                  const isSelected = selectedOrderId === order.id;
                  const transferredAt =
                    (order.transferredAt as any)?.toDate?.() ?? null;
                  const orderNo = (order.id ?? '').slice(-6).toUpperCase();
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
                          {transferredAt
                            ? formatDate(transferredAt, 'dd.MM.yyyy', { locale: tr })
                            : (order.createdAt
                                ? formatDate(order.createdAt as Date, 'dd.MM.yyyy', { locale: tr })
                                : '-')}
                        </p>
                        <span className="loj-status-badge loj-status-badge--success mt-1.5">
                          <CheckCircle2 className="h-3 w-3" />
                          Teslim
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-extrabold" style={{ color: 'var(--loj-success)' }}>
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
                  <CheckCircle2 className="h-7 w-7" style={{ color: 'var(--loj-muted)' }} />
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
                const orderNo = (order.id ?? '').slice(-6).toUpperCase();
                const transferredAt = (order.transferredAt as any)?.toDate?.() ?? null;
                const createdAt = order.createdAt as Date | null;
                const totalAdet = (order.items ?? []).reduce(
                  (s, i) => s + (Number(i.adet) || 0),
                  0
                );
                const deliveries = ((order.peripheralFulfillment as any)?.partialDeliveries ?? []) as PartialDelivery[];

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
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="loj-status-badge loj-status-badge--success">
                            <CheckCircle2 className="h-3 w-3" /> Teslim Edildi
                          </span>
                          <p className="text-2xl sm:text-3xl font-extrabold mt-1.5" style={{ color: 'var(--loj-success)' }}>
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
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>Oluşturma</span>
                          <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--loj-text)' }}>
                            {createdAt ? formatDate(createdAt, 'dd.MM.yyyy', { locale: tr }) : '-'}
                          </p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>Teslim</span>
                          <p className="text-xs font-bold mt-0.5" style={{ color: 'var(--loj-success)' }}>
                            {transferredAt ? formatDate(transferredAt, 'dd.MM.yyyy', { locale: tr }) : '-'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <ScrollArea className="flex-1 px-5 py-3" style={{ maxHeight: 'calc(100vh - 460px)' }}>
                      {/* Order items */}
                      <div className="space-y-2 mb-4">
                        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--loj-text)' }}>
                          Sipariş Kalemleri
                        </p>
                        {(order.items ?? []).map((it, idx) => {
                          const name = productNameMap.get(it.stokKodu) || it.stokAdi || it.stokKodu;
                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                              style={{
                                background: 'var(--loj-surface-3)',
                                border: '1px solid var(--loj-stroke)',
                              }}
                            >
                              <div className="min-w-0">
                                <p className="font-bold truncate" style={{ color: 'var(--loj-text)' }}>{name}</p>
                                <p className="font-mono text-[10px]" style={{ color: 'var(--loj-muted)' }}>{it.stokKodu}</p>
                              </div>
                              <p className="text-sm font-extrabold ml-2 shrink-0" style={{ color: 'var(--loj-success)' }}>
                                {it.adet}
                              </p>
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
