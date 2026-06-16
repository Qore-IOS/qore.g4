'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Order } from '@/lib/types';
import { db } from '@/lib/firebase';
import {
  collection, query, where, orderBy, limit,
  onSnapshot, updateDoc, doc, deleteDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { useDepots } from '@/hooks/useFirebaseQueries';
import { useToast } from '@/hooks/use-toast';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import LojistikSiparisView from '@/components/LojistikSiparisView';
import { siparislerLogger } from '@/lib/logger';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  Loader2, Plus, ArrowRight, Trash2, MoreHorizontal,
  ClipboardPlus, Undo, FileSpreadsheet, ShoppingCart,
  Package, CheckCircle2, Search, X, Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ─── Design tokens (exact match to demo) ─────────────────────────────────────
const C = {
  surface: '#FCFAF5',
  surface2: '#F5F1E8',
  surfaceHi: '#FFFFFF',
  bg: '#EFEAE0',
  ink1: '#3D382F',
  ink2: '#908872',
  ink3: '#BBB2A0',
  line: 'rgba(90,72,40,0.07)',
  accent: '#C98A57',
  accentLight: '#E0B776',
  accentGlow: 'rgba(201,138,87,0.24)',
  water: 'rgba(124,191,140,0.30)',
  waterSolid: '#6FB585',
  waterDeep: '#4E9E6B',
  amber: '#E0A33E',
  clay: 'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16)',
  clayInset: 'inset 0 2px 5px rgba(178,160,128,0.30), inset 0 -1px 0 rgba(255,255,255,0.55)',
  clayFlat: 'inset 0 1px 1px rgba(255,255,255,0.85), 0 4px 12px -7px rgba(150,128,96,0.28)',
  ease: 'cubic-bezier(.22, 1, .36, 1)',
  r: '24px',
  rsm: '16px',
  rpill: '999px',
};

const ACTIVE_ORDERS_LISTEN_LIMIT = 300;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
      padding: '8px 14px', borderRadius: C.rsm,
      background: C.surface2, boxShadow: C.clayInset,
      minWidth: 52,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 17, fontWeight: 800, color: C.ink1, lineHeight: 1.2 }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status, label, tone }: { status: string; label: string; tone: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 12px', borderRadius: C.rpill,
      background: tone + '22', color: tone,
      fontSize: 12, fontWeight: 700,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function PrimaryBtn({
  onClick, disabled, loading, children, color = C.accent,
}: {
  onClick?: () => void; disabled?: boolean; loading?: boolean;
  children: React.ReactNode; color?: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        all: 'unset', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
        width: '100%', height: 52, borderRadius: C.rsm,
        background: disabled
          ? C.surface2
          : `linear-gradient(180deg, ${color === C.accent ? C.accentLight : '#8FD3A6'} 0%, ${color} 100%)`,
        boxShadow: disabled
          ? C.clayInset
          : pressed
            ? 'inset 0 3px 7px rgba(120,80,30,0.28)'
            : `inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 22px -10px ${C.accentGlow}`,
        color: disabled ? C.ink3 : '#fff',
        fontWeight: 800, fontSize: 14.5,
        transition: `all 240ms ${C.ease}`,
        transform: pressed ? 'translateY(1px)' : 'none',
      }}
    >
      {loading ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : children}
    </button>
  );
}

function GhostBtn({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  const [p, setP] = useState(false);
  return (
    <button
      onClick={onClick}
      onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      style={{
        all: 'unset', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
        width: '100%', height: 48, borderRadius: C.rsm,
        background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
        boxShadow: p ? 'inset 0 2px 5px rgba(178,160,128,0.32)' : C.clayFlat,
        color: C.ink2, fontWeight: 700, fontSize: 14,
        transition: `all 240ms ${C.ease}`,
        transform: p ? 'translateY(1px)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({
  order,
  isProcessing,
  onStart,
  onView,
  onDelete,
  variant = 'acik',
}: {
  order: Order;
  isProcessing: boolean;
  onStart: (o: Order) => void;
  onView: (o: Order) => void;
  onDelete: (id: string) => void;
  variant?: 'acik' | 'kismi' | 'tamamlanan';
}) {
  // Tamamlanan listesinde items taşınmaz; sunucu kalem/adet sayısını hesaplar.
  const totalAdet = (order as any).adetCount ?? (order.items ?? []).reduce((s, i) => s + (Number(i.adet) || 0), 0);
  const totalKalem = (order as any).kalemCount ?? (order.items ?? []).length;
  const isPicking = order.status === 'toplaniyor';
  const isPerifer = !order.depotId || order.isPeripheral;

  const statusMap: Record<string, { label: string; tone: string }> = {
    pending:    { label: 'Bekliyor',  tone: C.accent },
    toplaniyor: { label: 'Toplanıyor', tone: '#7CA8DE' },
    kismi:      { label: 'Kısmi',     tone: C.amber },
    eksik:      { label: 'Eksik',     tone: '#C0796A' },
    completed:  { label: 'Tamamlandı', tone: C.waterSolid },
  };
  const badge = statusMap[order.status] ?? { label: order.status, tone: C.ink3 };

  const createdStr = order.createdAt instanceof Date
    ? formatDate(order.createdAt, 'dd.MM.yyyy HH:mm', { locale: tr })
    : '';
  const transferredStr = order.transferredAt instanceof Date
    ? formatDate(order.transferredAt, 'dd.MM.yyyy', { locale: tr })
    : '';

  // Partial fill % for kismi cards (original adet might not be stored,
  // so we don't show a bar — just show remaining items)
  const isKismi = variant === 'kismi';

  return (
    <article style={{
      borderRadius: C.r,
      background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
      boxShadow: C.clay,
      padding: '20px 22px',
      display: 'flex', flexDirection: 'column', gap: 14,
      animation: 'sipPopIn 280ms var(--sip-ease, cubic-bezier(.22,1,.36,1))',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {order.kurumAdi}
          </h3>
          <p style={{ margin: 0, marginTop: 3, fontSize: 12.5, color: C.ink2, fontWeight: 600 }}>
            {order.createdBy || '—'} · {createdStr}
          </p>
          {variant === 'tamamlanan' && transferredStr && (
            <p style={{ margin: 0, marginTop: 2, fontSize: 12, color: C.waterDeep, fontWeight: 600 }}>
              Teslim: {transferredStr}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <StatusBadge status={order.status} label={isPerifer ? 'Perifer' : badge.label} tone={isPerifer ? '#9B86D6' : badge.tone} />
          {variant !== 'tamamlanan' && (
            <button
              onClick={() => window.confirm('Siparişi silmek istediğinizden emin misiniz?') && onDelete(order.id ?? '')}
              aria-label="Sil"
              style={{
                all: 'unset', cursor: 'pointer',
                width: 34, height: 34, borderRadius: '50%',
                display: 'grid', placeItems: 'center',
                background: C.surface2, boxShadow: C.clayFlat, color: '#C0796A',
              }}
            >
              <Trash2 style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>
      </div>

      {/* KPI chips */}
      <div style={{ display: 'flex', gap: 10 }}>
        <StatChip label="Kalem" value={totalKalem} />
        <StatChip label="Adet" value={totalAdet} />
        {isKismi && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', padding: '8px 14px',
            borderRadius: C.rsm, background: C.amber + '14', color: C.amber,
            fontSize: 12, fontWeight: 700,
          }}>
            Kalan kalemler gösteriliyor
          </div>
        )}
      </div>

      {/* CTA */}
      {variant !== 'tamamlanan' ? (
        isPerifer ? (
          <PrimaryBtn onClick={() => onView(order)} disabled={isProcessing} color="#9B86D6">
            <ArrowRight style={{ width: 16, height: 16 }} />
            Siparişi Gör
          </PrimaryBtn>
        ) : (
          <PrimaryBtn onClick={() => onStart(order)} disabled={isProcessing} loading={isProcessing}>
            <ArrowRight style={{ width: 16, height: 16 }} />
            {isKismi ? 'Kalan Kısmı Topla' : isPicking ? 'Toplamaya Devam Et' : 'Toplamayı Başla'}
          </PrimaryBtn>
        )
      ) : (
        <GhostBtn onClick={() => onView(order)}>
          <ArrowRight style={{ width: 16, height: 16 }} />
          Siparişi Görüntüle
        </GhostBtn>
      )}
    </article>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 14, padding: '56px 24px', borderRadius: C.r,
      background: C.surface2, boxShadow: C.clayInset,
      color: C.ink3, textAlign: 'center',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '28%', display: 'grid', placeItems: 'center',
        background: C.surface, boxShadow: C.clay,
      }}>
        <Package style={{ width: 26, height: 26 }} />
      </div>
      <span style={{ fontSize: 15, fontWeight: 700, color: C.ink2 }}>{label}</span>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function SiparislerPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();

  const { data: allDepotsData = [] } = useDepots();
  const depots = useMemo(
    // id'siz depo → Radix SelectItem boş value ile patlar; ele.
    () => filterOperationalSourceDepots(allDepotsData, currentUserProfile).filter(d => !!d.id),
    [allDepotsData, currentUserProfile],
  );

  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [peripheralOrders, setPeripheralOrders] = useState<Order[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Aktif sekme URL'den okunur (?tab=) — Tamamlanan'a geçince URL değişir.
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams?.get('tab');
  const initialTab: 'acik' | 'kismi' | 'tamamlanan' =
    tabFromUrl === 'kismi' || tabFromUrl === 'tamamlanan' ? tabFromUrl : 'acik';
  const [activeTab, setActiveTab] = useState<'acik' | 'kismi' | 'tamamlanan'>(initialTab);
  const [tamamlananOrders, setTamamlananOrders] = useState<Record<string, any>[]>([]);
  const [tamamlananHasMore, setTamamlananHasMore] = useState(false);
  const [tamamlananLoading, setTamamlananLoading] = useState(false);
  // Cursor (sonraki sayfa için zaman sınırı) ref'te tutulur: yalnızca görüntülenen
  // satır kadar veri çekilir, "Daha Fazla Yükle" bu cursor'ı geri gönderir.
  const tamamlananCursorRef = useRef<{ ms: number } | null>(null);
  const tamamlananReqRef = useRef(0);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Tamamlanan filtreleri: metin arama, tarih aralığı, laboratuvar seçimi.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState(''); // YYYY-MM-DD string (input[type=date])
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterKurum, setFilterKurum] = useState(''); // seçili laboratuvar (recipientHospital tam eşleşme)
  const [labOptions, setLabOptions] = useState<string[]>([]); // seçici için ayrık lab listesi
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Sekme değiştir + URL'i güncelle (geçmişi kirletmeden replace).
  const changeTab = useCallback((tab: 'acik' | 'kismi' | 'tamamlanan') => {
    setActiveTab(tab);
    const qs = tab === 'acik' ? '/siparisler' : `/siparisler?tab=${tab}`;
    router.replace(qs, { scroll: false });
  }, [router]);

  // URL sekme parametresi dışarıdan değişirse (geri/ileri) state'i eşitle.
  useEffect(() => {
    if (initialTab !== activeTab) setActiveTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl]);

  // Metin aramasını debounce ederek uygulanan terime aktar.
  useEffect(() => {
    const t = setTimeout(() => { setSearchQuery(searchInput.trim()); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Filtre durumu hesapla (badge için).
  const activeFilterCount = [filterDateFrom, filterDateTo, filterKurum].filter(Boolean).length;

  const clearFilters = useCallback(() => {
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterKurum('');
    setSearchInput('');
    setSearchQuery('');
  }, []);

  // Seçili depo için ayrık laboratuvar listesini (sevkiyat geçmişinden) yükle —
  // laboratuvar seçici bu listeden beslenir.
  useEffect(() => {
    if (activeTab !== 'tamamlanan' || !selectedDepotId) { setLabOptions([]); return; }
    let canceled = false;
    import('@/actions/stokActions')
      .then(m => m.getShipmentLabs(selectedDepotId, currentCompanyId, isSuperAdmin ?? false))
      .then(labs => { if (!canceled) setLabOptions(labs); })
      .catch(() => { if (!canceled) setLabOptions([]); });
    return () => { canceled = true; };
  }, [activeTab, selectedDepotId, currentCompanyId, isSuperAdmin]);

  // Lojistik sorumlusu: only perifer orders, no create/depot flow
  const isLojistikSorumlusu = currentUserProfile?.role === 'lojistik_sorumlusu';

  const assignedLabIdSet = useMemo(() => {
    const s = new Set<string>();
    (currentUserProfile?.assignedLaboratories ?? []).forEach(id => { if (id) s.add(id); });
    return s;
  }, [currentUserProfile?.assignedLaboratories]);

  // ── Real-time order listener for selected depot ──
  useEffect(() => {
    if (!selectedDepotId) { setAllOrders([]); return; }
    const mapSnapshot = (snap: any) => {
      const rows = snap.docs.map((d: any) => {
        const data = d.data();
        return {
          ...data, id: d.id,
          createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date(),
          transferredAt: data.transferredAt ? (data.transferredAt as Timestamp).toDate() : null,
        } as Order;
      });
      rows.sort((a: Order, b: Order) => {
        const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        const at = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        return bt - at;
      });
      setAllOrders(rows);
    };

    let unsub: (() => void) | null = null;
    const start = () => {
      try {
        const q1 = scopedQuery(
          'orders', currentCompanyId, isSuperAdmin,
          where('depotId', '==', selectedDepotId),
          orderBy('createdAt', 'desc'),
          limit(ACTIVE_ORDERS_LISTEN_LIMIT),
        );
        unsub = onSnapshot(q1, mapSnapshot, (err: any) => {
          siparislerLogger.warn('Sipariş dinleyici index olmadan fallback yapıyor', { depotId: selectedDepotId, errorMessage: String(err) });
          if (unsub) unsub();
          const q2 = scopedQuery('orders', currentCompanyId, isSuperAdmin, where('depotId', '==', selectedDepotId), limit(ACTIVE_ORDERS_LISTEN_LIMIT));
          unsub = onSnapshot(q2, mapSnapshot);
        });
      } catch {
        const q2 = scopedQuery('orders', currentCompanyId, isSuperAdmin, where('depotId', '==', selectedDepotId), limit(ACTIVE_ORDERS_LISTEN_LIMIT));
        unsub = onSnapshot(q2, mapSnapshot);
      }
    };
    start();
    return () => { if (unsub) unsub(); };
  }, [selectedDepotId, currentCompanyId, isSuperAdmin]);

  // ── Peripheral order listener ──
  useEffect(() => {
    const mapSnap = (snap: any) => {
      const rows = snap.docs
        .map((d: any) => {
          const data = d.data();
          return { ...data, id: d.id, createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date() } as Order;
        })
        .filter((o: Order) => !o.depotId);
      rows.sort((a: Order, b: Order) => {
        const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        const at = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        return bt - at;
      });
      setPeripheralOrders(rows);
    };
    const q = scopedQuery('orders', currentCompanyId, isSuperAdmin, where('isPeripheral', '==', true));
    const unsub = onSnapshot(q, mapSnap, () => {});
    return () => unsub();
  }, []);

  // ── Auto-select first depot ──
  useEffect(() => {
    if (depots.length > 0 && !selectedDepotId && !isLojistikSorumlusu) {
      setSelectedDepotId(depots[0].id);
    }
  }, [depots, selectedDepotId, isLojistikSorumlusu]);

  // ── Tamamlanan (sipariş geçmişi): SHIPMENTS tabanlı server-side cursor sayfalama ──
  // Tam geçmiş `shipments` koleksiyonundan gelir (her tamamlama bir sevkiyat
  // oluşturur). `reset` true ise baştan, false ise mevcut cursor'dan sonrasını
  // yükler. Yalnızca pageSize kayıt çekilir; items detayı listede taşınmaz.
  const loadTamamlanan = useCallback(async (reset: boolean) => {
    if (!selectedDepotId) return;
    const reqId = ++tamamlananReqRef.current;
    if (reset) tamamlananCursorRef.current = null;
    setTamamlananLoading(true);
    try {
      const m = await import('@/actions/stokActions');
      const res = await m.getCompletedShipments(
        selectedDepotId, currentCompanyId, isSuperAdmin ?? false,
        20, tamamlananCursorRef.current,
        {
          searchTerm: searchQuery || null,
          dateFrom: filterDateFrom || null,
          dateTo: filterDateTo || null,
          recipientHospital: filterKurum || null,
        },
      );
      if (reqId !== tamamlananReqRef.current) return; // stale isteği yoksay
      const mapped = res.shipments.map((o: any) => ({
        ...o,
        createdAt: o.createdAt instanceof Date ? o.createdAt : o.createdAt ? new Date(o.createdAt) : new Date(),
        transferredAt: o.transferredAt instanceof Date ? o.transferredAt : o.transferredAt ? new Date(o.transferredAt) : null,
      }));
      tamamlananCursorRef.current = res.nextCursor ?? null;
      setTamamlananOrders(prev => (reset ? mapped : [...prev, ...mapped]));
      setTamamlananHasMore(res.hasMore);
    } catch {
      /* yut: liste boş kalır */
    } finally {
      if (reqId === tamamlananReqRef.current) setTamamlananLoading(false);
    }
  }, [selectedDepotId, currentCompanyId, isSuperAdmin, searchQuery, filterDateFrom, filterDateTo, filterKurum]);

  // Depo değişince filtreleri ve listeyi sıfırla.
  useEffect(() => {
    clearFilters();
    setTamamlananOrders([]);
    tamamlananCursorRef.current = null;
  }, [selectedDepotId, clearFilters]);

  // Sekme/depo/filtre değişince baştan yükle.
  useEffect(() => {
    if (activeTab !== 'tamamlanan' || !selectedDepotId) return;
    setTamamlananOrders([]);
    loadTamamlanan(true);
  }, [activeTab, selectedDepotId, searchQuery, filterDateFrom, filterDateTo, filterKurum, loadTamamlanan]);

  // ── Order actions ──
  const startPickingProcess = useCallback(async (order: Order) => {
    if (!order.id) return;
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        status: 'toplaniyor',
        pickingStartedAt: serverTimestamp(),
        pickingStartedById: currentUser?.uid ?? null,
        pickingStartedBy: currentUserProfile?.name ?? currentUser?.email ?? null,
      });
      router.push(`/siparisler/${order.id}/toplama`);
    } catch {
      toast({ title: 'Hata', description: 'Toplama işlemi başlatılamadı.', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  }, [currentUser, currentUserProfile, router, toast]);

  const openPeripheralOrder = useCallback((order: Order) => {
    if (!order.id) return;
    router.push(`/siparisler/${order.id}/perifer`);
  }, [router]);

  const handleDeleteOrder = useCallback(async (orderId: string) => {
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      toast({ title: 'Başarılı', description: 'Sipariş silindi.' });
    } catch {
      toast({ title: 'Hata', description: 'Sipariş silinemedi.', variant: 'destructive' });
    }
  }, [toast]);

  const isOrderPeripheral = useCallback((order: Order) => {
    if (order.depotId) return false;
    return order.isPeripheral === true || (order as any).perifer === true;
  }, []);

  // ── Computed tab data ──
  const { acikOrders, kismiOrders } = useMemo(() => {
    const seen = new Set<string>();
    const acik: Order[] = [];
    const kismi: Order[] = [];

    const sources = isLojistikSorumlusu ? [peripheralOrders] : [allOrders, peripheralOrders];
    sources.flat().forEach(o => {
      if (!o?.id || seen.has(o.id) || o.status === 'completed') return;
      if (isLojistikSorumlusu && o.labId && !assignedLabIdSet.has(o.labId)) return;
      seen.add(o.id);
      if (o.status === 'kismi') kismi.push(o);
      else acik.push(o);
    });

    return { acikOrders: acik, kismiOrders: kismi };
  }, [allOrders, peripheralOrders, isLojistikSorumlusu, assignedLabIdSet]);

  const depotName = useMemo(
    () => depots.find(d => d.id === selectedDepotId)?.name ?? '',
    [depots, selectedDepotId],
  );

  // ── Lojistik sorumlusu: hand off to dedicated view ──
  if (isLojistikSorumlusu) return <LojistikSiparisView />;

  const tabDef = [
    { id: 'acik' as const, label: 'Açık', count: acikOrders.length, tone: C.accent },
    { id: 'kismi' as const, label: 'Kısmi Tamamlanan', count: kismiOrders.length, tone: C.amber },
    { id: 'tamamlanan' as const, label: 'Tamamlanan', count: null, tone: C.waterSolid },
  ];

  const currentList = activeTab === 'acik'
    ? acikOrders
    : activeTab === 'kismi'
      ? kismiOrders
      : (tamamlananOrders as unknown as Order[]);

  return (
    <>
      <style>{`
        @keyframes sipPopIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes sipSpin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Full-bleed cream backdrop — paneli toplama ekranıyla aynı krem tonla
          baştan başa sarar, arkadaki gri tema zemini görünmez. */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, background: C.surface2, zIndex: 0 }} />

      <div className="sp-shell" style={{
        position: 'relative', zIndex: 1,
        maxWidth: 860, margin: '0 auto',
        padding: '28px 20px 90px',
        minHeight: '100vh',
      }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: C.ink1, display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShoppingCart style={{ width: 22, height: 22, color: C.accent }} />
              Siparişler
            </h1>
            <p style={{ margin: 0, marginTop: 2, fontSize: 13, color: C.ink2, fontWeight: 600 }}>
              {depotName || 'Depo seçin'}
            </p>
          </div>

          {/* More menu */}
          <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
            <PopoverTrigger asChild>
              <button style={{
                all: 'unset', cursor: 'pointer',
                width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center',
                background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
                boxShadow: C.clayFlat, color: C.ink2,
              }}>
                <MoreHorizontal style={{ width: 18, height: 18 }} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-1" align="end">
              {[
                { label: 'Ürün Talep', icon: <ClipboardPlus className="h-4 w-4" />, href: '/urun-talep' },
                { label: 'Ürün İade', icon: <Undo className="h-4 w-4" />, href: '/urun-iade' },
                { label: 'Toplu Sipariş', icon: <FileSpreadsheet className="h-4 w-4" />, href: '/merkez-siparis' },
              ].map(item => (
                <button key={item.href}
                  onClick={() => { router.push(item.href); setMoreMenuOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {item.icon} {item.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>

        {/* ── Depot selector ── */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Çalışma Deposu
          </label>
          <div style={{
            background: C.surface2, boxShadow: C.clayInset,
            borderRadius: C.rsm, overflow: 'hidden',
          }}>
            <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
              <SelectTrigger className="w-full border-0 shadow-none bg-transparent h-11 text-sm font-semibold">
                <SelectValue placeholder="Depo seçin..." />
              </SelectTrigger>
              <SelectContent>
                {depots.map(d => <SelectItem key={d.id} value={d.id ?? ''}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Yeni Sipariş button ── */}
        <button
          onClick={() => router.push('/siparisler/olustur')}
          style={{
            all: 'unset', cursor: 'pointer', boxSizing: 'border-box', width: '100%',
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '18px 22px', marginBottom: 22, borderRadius: C.r,
            background: `linear-gradient(180deg, ${C.accentLight} 0%, ${C.accent} 100%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -5px 12px rgba(120,80,30,0.18), 0 14px 28px -10px ${C.accentGlow}`,
            color: '#fff',
            transition: `transform 260ms ${C.ease}`,
          }}
          onPointerDown={(e) => { e.currentTarget.style.transform = 'translateY(1px) scale(0.992)'; }}
          onPointerUp={(e) => { e.currentTarget.style.transform = ''; }}
          onPointerLeave={(e) => { e.currentTarget.style.transform = ''; }}
        >
          <span style={{
            width: 44, height: 44, borderRadius: 14, flexShrink: 0,
            background: 'rgba(255,255,255,0.22)', display: 'grid', placeItems: 'center',
            boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.4)',
          }}>
            <Plus style={{ width: 22, height: 22 }} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>Yeni Sipariş Oluştur</div>
            <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.9 }}>Lab seç, ürün ekle ve siparişi başlat</div>
          </div>
          <ArrowRight style={{ width: 20, height: 20, opacity: 0.9 }} />
        </button>

        {/* ── Tabs ── */}
        <div style={{
          display: 'inline-flex', gap: 4, padding: 4, marginBottom: 20,
          borderRadius: C.rpill, background: C.surface2, boxShadow: C.clayInset,
          flexWrap: 'wrap',
        }}>
          {tabDef.map(tb => {
            const on = activeTab === tb.id;
            return (
              <button
                key={tb.id}
                onClick={() => changeTab(tb.id)}
                style={{
                  all: 'unset', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  height: 42, padding: '0 18px', borderRadius: C.rpill,
                  background: on ? `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})` : 'transparent',
                  boxShadow: on ? C.clay : 'none',
                  color: on ? C.ink1 : C.ink2, fontSize: 14, fontWeight: 700,
                  transition: `color 200ms ${C.ease}`,
                }}
              >
                {tb.label}
                {tb.count !== null && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999,
                    background: on ? tb.tone : 'rgba(150,128,96,0.16)',
                    color: on ? '#fff' : C.ink2, fontSize: 12, fontWeight: 800,
                  }}>
                    {tb.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tamamlanan: arama + filtreler ── */}
        {activeTab === 'tamamlanan' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {/* Arama + filtre toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '0 14px', height: 50, borderRadius: C.rsm,
              background: C.surface2, boxShadow: C.clayInset,
            }}>
              <Search style={{ width: 17, height: 17, color: C.ink3, flexShrink: 0 }} />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Kuruma, kişiye göre ara…"
                style={{ all: 'unset', flex: 1, height: '100%', fontSize: 14, fontWeight: 600, color: C.ink1 }}
              />
              {searchInput && (
                <button onClick={() => setSearchInput('')} aria-label="Aramayı temizle" style={{
                  all: 'unset', cursor: 'pointer', flexShrink: 0,
                  width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  background: C.surface, boxShadow: C.clayFlat, color: C.ink2,
                }}>
                  <X style={{ width: 13, height: 13 }} />
                </button>
              )}
              {/* Filtre toggle butonu */}
              <button
                onClick={() => setFiltersOpen(o => !o)}
                aria-label="Filtreler"
                style={{
                  all: 'unset', cursor: 'pointer', flexShrink: 0, position: 'relative',
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: C.rsm,
                  background: filtersOpen || activeFilterCount > 0 ? C.accent + '18' : 'transparent',
                  color: activeFilterCount > 0 ? C.accent : C.ink2,
                  fontSize: 13, fontWeight: 700,
                }}
              >
                <Filter style={{ width: 14, height: 14 }} />
                Filtre
                {activeFilterCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 16, height: 16, borderRadius: '50%',
                    background: C.accent, color: '#fff',
                    fontSize: 10, fontWeight: 800,
                    display: 'grid', placeItems: 'center',
                  }}>{activeFilterCount}</span>
                )}
              </button>
            </div>

            {/* Genişletilebilir filtre satırı */}
            {filtersOpen && (
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10,
                padding: '14px 16px', borderRadius: C.rsm,
                background: C.surface, boxShadow: C.clayFlat,
              }}>
                {/* Laboratuvar seçici */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.ink3, marginBottom: 5, letterSpacing: '0.05em' }}>LABORATUVAR</label>
                  <select
                    value={filterKurum}
                    onChange={e => setFilterKurum(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '0 10px', height: 38, borderRadius: C.rsm,
                      background: C.surface2, boxShadow: C.clayInset,
                      border: 'none', outline: 'none', appearance: 'none',
                      fontSize: 13, fontWeight: 600, color: filterKurum ? C.ink1 : C.ink3,
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">Tüm laboratuvarlar</option>
                    {labOptions.map(lab => (
                      <option key={lab} value={lab}>{lab}</option>
                    ))}
                  </select>
                </div>
                {/* Başlangıç tarihi */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.ink3, marginBottom: 5, letterSpacing: '0.05em' }}>BAŞLANGIÇ</label>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={e => setFilterDateFrom(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '0 10px', height: 38, borderRadius: C.rsm,
                      background: C.surface2, boxShadow: C.clayInset,
                      border: 'none', outline: 'none',
                      fontSize: 13, fontWeight: 600, color: C.ink1,
                    }}
                  />
                </div>
                {/* Bitiş tarihi */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.ink3, marginBottom: 5, letterSpacing: '0.05em' }}>BİTİŞ</label>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={e => setFilterDateTo(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '0 10px', height: 38, borderRadius: C.rsm,
                      background: C.surface2, boxShadow: C.clayInset,
                      border: 'none', outline: 'none',
                      fontSize: 13, fontWeight: 600, color: C.ink1,
                    }}
                  />
                </div>
                {/* Filtreleri sıfırla */}
                {activeFilterCount > 0 && (
                  <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={clearFilters} style={{
                      all: 'unset', cursor: 'pointer',
                      fontSize: 12, fontWeight: 700, color: C.ink3,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <X style={{ width: 12, height: 12 }} /> Filtreleri Temizle
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Order list ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {activeTab === 'tamamlanan' && tamamlananLoading && tamamlananOrders.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: C.ink3 }}>
              <Loader2 style={{ width: 28, height: 28, margin: '0 auto 8px', animation: 'sipSpin 1s linear infinite' }} />
            </div>
          ) : currentList.length === 0 ? (
            <EmptyState label={
              activeTab === 'acik' ? 'Açık sipariş yok' :
              activeTab === 'kismi' ? 'Kısmi tamamlanan sipariş yok' :
              (searchQuery || activeFilterCount > 0) ? 'Filtreyle eşleşen sipariş yok' :
              'Tamamlanan sipariş bulunamadı'
            } />
          ) : (
            <>
              {currentList.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  isProcessing={isProcessing}
                  variant={activeTab}
                  onStart={startPickingProcess}
                  onView={
                    activeTab === 'tamamlanan'
                      // Tamamlanan kayıtları sevkiyattır → sevkiyat detayına git.
                      ? (o) => router.push(`/siparis-gecmis/${o.id}?depotId=${selectedDepotId}`)
                      : order.isPeripheral ? openPeripheralOrder : (o) => router.push(`/siparisler/${o.id}/toplama`)
                  }
                  onDelete={handleDeleteOrder}
                />
              ))}
              {activeTab === 'tamamlanan' && tamamlananHasMore && (
                <button
                  onClick={() => loadTamamlanan(false)}
                  disabled={tamamlananLoading}
                  style={{
                    all: 'unset', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    height: 48, borderRadius: C.rsm,
                    background: `linear-gradient(180deg, ${C.surfaceHi}, ${C.surface2})`,
                    boxShadow: C.clayFlat, color: C.ink2,
                    fontSize: 14, fontWeight: 700,
                  }}
                >
                  {tamamlananLoading ? <Loader2 style={{ width: 16, height: 16, animation: 'sipSpin 1s linear infinite' }} /> : 'Daha Fazla Yükle'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
