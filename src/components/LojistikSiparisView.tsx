'use client';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, where, Timestamp, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import type { Order, Hospital, ProductCode } from '@/lib/types';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { ShoppingCart, Package, CheckCircle2, ArrowRight, Trash2, Search, Loader2, History, MoreHorizontal, ClipboardPlus, FileSpreadsheet } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toDateFromAny } from '@/lib/date';
import { siparislerLogger } from '@/lib/logger';

type LojFilter = 'all' | 'pending' | 'eksik' | 'toplaniyor';

export default function LojistikSiparisView() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();
  const [peripheralOrders, setPeripheralOrders] = useState<Order[]>([]);
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LojFilter>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const assignedLabIds = useMemo(() => {
    const s = new Set<string>();
    (currentUserProfile?.assignedLaboratories ?? []).forEach(id => { if (id) s.add(id); });
    return s;
  }, [currentUserProfile?.assignedLaboratories]);

  // Fetch hospitals & products
  useEffect(() => {
    (async () => {
      const [hSnap, pSnap] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'productCodes')),
      ]);
      setHospitals(hSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
      setProductCodes(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
    })();
  }, []);

  // Listen peripheral orders
  useEffect(() => {
    const q = query(collection(db, 'orders'), where('isPeripheral', '==', true));
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => {
        const data = d.data();
        return { ...data, id: d.id, createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date(), transferredAt: data.transferredAt ? (data.transferredAt as Timestamp).toDate() : null } as Order;
      });
      const active: Order[] = [];
      const completed: Order[] = [];
      rows.forEach(o => {
        if (!o.labId || !assignedLabIds.has(o.labId)) return;
        if (o.status === 'completed') completed.push(o);
        else active.push(o);
      });
      active.sort((a, b) => ((b.createdAt as Date)?.getTime?.() ?? 0) - ((a.createdAt as Date)?.getTime?.() ?? 0));
      completed.sort((a, b) => ((b.createdAt as Date)?.getTime?.() ?? 0) - ((a.createdAt as Date)?.getTime?.() ?? 0));
      setPeripheralOrders(active);
      setCompletedOrders(completed);
      setIsLoading(false);
    });
    return () => unsub();
  }, [assignedLabIds]);

  const filteredOrders = useMemo(() => {
    let list = peripheralOrders;
    if (filter === 'pending') list = list.filter(o => o.status === 'pending');
    else if (filter === 'eksik') list = list.filter(o => o.status === 'eksik');
    else if (filter === 'toplaniyor') list = list.filter(o => o.status === 'toplaniyor');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(o => o.kurumAdi?.toLowerCase().includes(q) || o.createdBy?.toLowerCase().includes(q));
    }
    return list;
  }, [peripheralOrders, filter, search]);

  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null;
    return peripheralOrders.find(o => o.id === selectedOrderId) ?? null;
  }, [selectedOrderId, peripheralOrders]);

  const productNameMap = useMemo(() => {
    const m = new Map<string, string>();
    productCodes.forEach(p => { if (p.stokKodu && p.stokAdi) m.set(p.stokKodu, p.stokAdi); });
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

  const getStatusInfo = (order: Order) => {
    const s = order.status;
    if (s === 'eksik') return { label: 'Eksik', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    if (s === 'toplaniyor') return { label: 'Hazırlanıyor', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    if (s === 'completed') return { label: 'Teslim', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
    return { label: 'Beklemede', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
  };

  const totalOrders = peripheralOrders.length + completedOrders.length;
  const activeCount = peripheralOrders.length;
  const completedCount = completedOrders.length;

  const stepIndex = useCallback((order: Order) => {
    const s = order.status;
    if (s === 'completed') return 4;
    if (s === 'toplaniyor') return 2;
    if (s === 'eksik') return 1;
    return 1;
  }, []);

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
          <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2" style={{ color: 'var(--loj-text)' }}>
            <ShoppingCart className="h-5 w-5" style={{ color: 'var(--loj-accent)' }} />
            Siparişler
          </h1>
          <p className="text-xs" style={{ color: 'var(--loj-muted)' }}>Perifer siparişler · {activeCount} aktif</p>
        </div>
        <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
          <PopoverTrigger asChild>
            <button className="loj-btn-outline" style={{ padding: '0.5rem' }}>
              <MoreHorizontal className="h-4 w-4" style={{ color: 'var(--loj-muted)' }} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-1" align="end">
            <button onClick={() => { router.push('/urun-talep'); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
              <ClipboardPlus className="h-4 w-4" style={{ color: 'var(--loj-muted)' }} /> Ürün Talep
            </button>
            <button onClick={() => { router.push('/siparis-gecmis'); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
              <History className="h-4 w-4" style={{ color: 'var(--loj-muted)' }} /> Geçmiş
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="loj-kpi">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>Toplam Sipariş</span>
            <ShoppingCart className="h-4 w-4" style={{ color: 'var(--loj-accent)' }} />
          </div>
          <p className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--loj-text)' }}>{totalOrders}</p>
        </div>
        <div className="loj-kpi">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>Aktif Siparişler</span>
            <Package className="h-4 w-4" style={{ color: 'var(--loj-accent)' }} />
          </div>
          <p className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--loj-accent)' }}>{activeCount}</p>
        </div>
        <div className="loj-kpi">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--loj-muted)' }}>Geçmiş Siparişler</span>
            <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--loj-accent)' }} />
          </div>
          <p className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--loj-text)' }}>{completedCount}</p>
        </div>
      </div>

      {/* Master-Detail Split */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* LEFT: Order List */}
        <div className="loj-list-panel">
          {/* Filter Chips */}
          <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
            {([['all', 'Tümü'], ['pending', 'Bekleyen'], ['eksik', 'Eksik'], ['toplaniyor', 'Hazırlanan']] as [LojFilter, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)} className={cn('loj-chip', filter === key && 'active')}>
                {label}
              </button>
            ))}
          </div>
          {/* Search */}
          <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--loj-muted)' }} />
              <input placeholder="Kurum ara..." value={search} onChange={e => setSearch(e.target.value)} className="w-full h-8 pl-8 pr-3 rounded-lg text-xs border-0 outline-none" style={{ background: 'var(--loj-surface-2)', color: 'var(--loj-text)' }} />
            </div>
          </div>
          {/* List */}
          <ScrollArea className="flex-1" style={{ maxHeight: 'calc(100vh - 380px)' }}>
            {filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Package className="h-8 w-8 mb-2" style={{ color: 'var(--loj-muted)', opacity: 0.4 }} />
                <p className="text-sm font-medium" style={{ color: 'var(--loj-muted)' }}>Sipariş bulunamadı</p>
              </div>
            ) : (
              filteredOrders.map(order => {
                const status = getStatusInfo(order);
                const totalAdet = (order.items ?? []).reduce((s, i) => s + (Number(i.adet) || 0), 0);
                const isSelected = selectedOrderId === order.id;
                const firstItem = order.items?.[0];
                return (
                  <button key={order.id} onClick={() => setSelectedOrderId(order.id ?? null)} className={cn('loj-order-item', isSelected && 'loj-selected')}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--loj-text)' }}>{order.kurumAdi}</p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--loj-muted)' }}>
                        {firstItem ? (productNameMap.get(firstItem.stokKodu ?? '') ?? firstItem.stokAdi ?? firstItem.stokKodu) : '-'}
                        {(order.items?.length ?? 0) > 1 && ` +${(order.items?.length ?? 1) - 1}`}
                      </p>
                      <span className={cn('inline-flex items-center mt-1 px-2 py-0.5 rounded text-[10px] font-semibold', status.cls)}>{status.label}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold" style={{ color: 'var(--loj-text)' }}>{totalAdet}</p>
                      <p className="text-[10px]" style={{ color: 'var(--loj-muted)' }}>adet</p>
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
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--loj-surface-2)' }}>
                <Package className="h-7 w-7" style={{ color: 'var(--loj-muted)' }} />
              </div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--loj-text)' }}>Sipariş seçin</p>
              <p className="text-xs" style={{ color: 'var(--loj-muted)' }}>Detayları görmek için sol listeden bir sipariş seçin</p>
            </div>
          ) : (() => {
            const order = selectedOrder;
            const items = order.items ?? [];
            const totalAdet = items.reduce((s, i) => s + (Number(i.adet) || 0), 0);
            const totalKalem = items.length;
            const createdAtStr = order.createdAt ? formatDate(order.createdAt as Date, 'dd MMM · HH:mm', { locale: tr }) : '-';
            const step = stepIndex(order);
            const steps = [
              { label: 'Beklemede', num: 1 },
              { label: 'Hazırlanıyor', num: 2 },
              { label: 'Yolda', num: 3 },
              { label: 'Teslim Edildi', num: 4 },
            ];

            return (
              <div className="flex flex-col h-full">
                {/* Detail Header */}
                <div className="flex items-start justify-between gap-3 p-5 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
                  <div className="min-w-0">
                    <p className="text-xs" style={{ color: 'var(--loj-muted)' }}>{createdAtStr} · {order.createdBy || '-'}</p>
                    <h2 className="text-base sm:text-lg font-bold mt-0.5" style={{ color: 'var(--loj-text)' }}>{order.kurumAdi}</h2>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold shrink-0" style={{ color: 'var(--loj-accent)' }}>{totalAdet} <span className="text-sm font-medium" style={{ color: 'var(--loj-muted)' }}>adet</span></p>
                </div>

                {/* Progress Stepper */}
                <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--loj-stroke)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold" style={{ color: 'var(--loj-muted)' }}>Sipariş Durumu</span>
                    <button onClick={() => router.push(`/siparisler/${order.id}/perifer`)} className="loj-btn-primary" style={{ fontSize: 11, padding: '0.35rem 0.75rem' }}>
                      İleri →
                    </button>
                  </div>
                  <div className="loj-stepper-track">
                    {steps.map((s, i) => (
                      <React.Fragment key={s.num}>
                        {i > 0 && <div className={cn('loj-step-line', step > s.num - 1 && 'done')} />}
                        <div className="flex flex-col items-center gap-1">
                          <div className={cn('loj-step-circle', step > s.num ? 'done' : step === s.num ? 'active' : 'pending')}>
                            {step > s.num ? <CheckCircle2 className="h-4 w-4" /> : s.num}
                          </div>
                          <span className="text-[9px] font-medium whitespace-nowrap" style={{ color: step >= s.num ? 'var(--loj-accent)' : 'var(--loj-muted)' }}>{s.label}</span>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Order Items */}
                <ScrollArea className="flex-1 px-5 py-3" style={{ maxHeight: 'calc(100vh - 520px)' }}>
                  <div className="space-y-2">
                    {items.map((item, idx) => {
                      const pName = productNameMap.get(item.stokKodu ?? '') ?? item.stokAdi ?? item.stokKodu;
                      const fulfilled = (order as any).peripheralFulfillment?.items?.find((f: any) => f.itemId === item.id)?.fulfilled ?? false;
                      return (
                        <div key={item.id ?? idx} className={cn('loj-product-row rounded-xl', fulfilled && 'fulfilled')}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: 'var(--loj-text)' }}>{pName}</p>
                            <p className="text-[10px] font-mono" style={{ color: 'var(--loj-muted)' }}>{item.stokKodu}</p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <span className="text-sm font-bold" style={{ color: 'var(--loj-text)' }}>{item.adet}</span>
                              <span className="text-[10px] ml-1" style={{ color: 'var(--loj-muted)' }}>adet</span>
                            </div>
                            {fulfilled && <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--loj-accent)' }} />}
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
                      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--loj-muted)' }}>Kurum</span>
                      <p className="text-xs font-bold" style={{ color: 'var(--loj-text)' }}>{order.kurumAdi}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--loj-muted)' }}>Kalem</span>
                      <p className="text-xs font-bold" style={{ color: 'var(--loj-text)' }}>{totalKalem} kalem</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--loj-muted)' }}>Oluşturan</span>
                      <p className="text-xs font-bold" style={{ color: 'var(--loj-text)' }}>{order.createdBy || '-'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--loj-muted)' }}>Tarih</span>
                      <p className="text-xs font-bold" style={{ color: 'var(--loj-text)' }}>{order.createdAt ? formatDate(order.createdAt as Date, 'dd.MM.yyyy', { locale: tr }) : '-'}</p>
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="flex items-center gap-2 px-5 py-3 border-t" style={{ borderColor: 'var(--loj-stroke)' }}>
                  <button onClick={() => router.push(`/siparisler/${order.id}/perifer`)} className="loj-btn-primary flex-1 justify-center">
                    <ArrowRight className="h-4 w-4" /> Siparişi Gör
                  </button>
                  <button onClick={() => handleDelete(order.id ?? '')} className="loj-btn-outline" style={{ color: '#B91C1C' }}>
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
