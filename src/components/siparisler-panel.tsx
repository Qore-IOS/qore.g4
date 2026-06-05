/**
 * @fileoverview Orders Panel Component
 * @description Main orders management panel for creating, viewing, and managing
 * orders in the medical supply chain system. Supports manual order creation,
 * Min/Max based automatic ordering, and bulk order Excel generation.
 * @module components/siparisler-panel
 * @version 2.0.0
 *
 * @features
 * - Order creation with laboratory selection
 * - Min/Max rule-based automatic order calculation
 * - Bulk order Excel generation for multiple depots/labs
 * - Real-time order status updates via Firestore listeners
 * - Order picking process initiation
 * - Order deletion with confirmation
 *
 * @accessibility
 * - ARIA labels for all interactive elements
 * - Keyboard navigation support
 * - Screen reader announcements for status changes
 */

'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, ChangeEvent, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type {
  Depot,
  Hospital,
  ProductCode,
  DepoStokItem,
  MinMaxRule,
  Order,
  OrderItem,
  PickingListItem,
  Shipment,
  ShipmentItem,
  DeviceGroup,
} from '@/lib/types';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  doc,
  setDoc,
  orderBy,
  Timestamp,
  limit,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  deleteDoc,
} from 'firebase/firestore';
import { generateId, parseBarcode, exportDataToExcel, readExcelData, playFeedback, sanitizeGS1 } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format as formatDate, parse, compareAsc, isValid } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Loader2, PlusCircle, Trash2, Check, FileSpreadsheet, History, Calculator, ChevronsUpDown, Undo, ClipboardPlus, ShoppingCart, Package, Plus, Minus, MoreHorizontal, ArrowRight, Search, CheckCircle2, Edit3, Save, Send, Share2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useDepots, useHospitals, useProductCodes, useDepoStok, useInvalidateQueries } from '@/hooks/useFirebaseQueries';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import * as XLSX from 'xlsx';
import { useRowFocus } from '@/hooks/useRowFocus';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { LabSelector } from '@/components/common/LabSelector';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMiad, toDateFromAny } from '@/lib/date';

type LojRowState = {
  itemId: string;
  stokKodu: string;
  stokAdi: string;
  requestedAdet: number;
  sentAdet: number;
  fulfilled: boolean;
};

type PeripheralFulfillmentItem = {
  itemId: string;
  stokKodu: string;
  requestedAdet: number;
  sentAdet: number;
  fulfilled: boolean;
};
import { emitOrderCreatedFromRequest } from '@/lib/notifications';
import { filterOperationalSourceDepots } from '@/lib/depot-access';
import { getStockItemQuantity } from '@/lib/stock-quantity';
import { siparislerLogger } from '@/lib/logger';
import LojistikSiparisView from '@/components/LojistikSiparisView';
import { formatUnitMultiplier, normalizeUnitLabel } from '@/lib/product-unit';


function SiparislerSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6 animate-pulse">
      <div className="flex justify-between items-center mb-4">
        <div className="h-10 w-48 bg-muted rounded" />
        <div className="h-10 w-64 bg-muted rounded" />
      </div>
      <div className="h-20 bg-muted rounded-xl mb-4" />
      <div className="flex gap-1 h-12 bg-muted/20 rounded-xl mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        <div className="h-[500px] bg-muted rounded-xl" />
        <div className="h-[700px] bg-muted rounded-xl" />
      </div>
    </div>
  );
}

const MemoizedOrderCard = React.memo(function OrderCard({
  order,
  isProcessing,
  openPeripheralOrder,
  startPickingProcess,
  handleDeleteOrder,
}: {
  order: Order;
  isProcessing: boolean;
  openPeripheralOrder: (o: Order) => void;
  startPickingProcess: (o: Order) => void;
  handleDeleteOrder: (id: string) => void;
}) {
  const isOrderPeripheral = (o: Order) => o.isPeripheral === true || o.perifer === true;
  const totalAdet = (order.items ?? []).reduce((sum, it) => sum + (Number(it.adet) || 0), 0);
  const totalKalem = (order.items ?? []).length;
  const isPicking = order.status === 'toplaniyor';
  const isEksik = order.status === 'eksik';
  const isPerifer = isOrderPeripheral(order);

  const statusLabel = isEksik
    ? 'Eksik'
    : isPicking
      ? 'Toplanıyor'
      : isPerifer
        ? 'Perifer'
        : 'Bekliyor';
  const statusClass = isEksik
    ? "bg-red-100 text-red-700"
    : isPicking
      ? "bg-blue-100 text-blue-700"
      : isPerifer
        ? "bg-purple-100 text-purple-700"
        : "bg-amber-100 text-amber-700";

  return (
    <article
      data-row-id={order.id}
      className="cihaz-card-strong overflow-hidden"
    >
      <div className="p-4 sm:p-5 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-[var(--dashboard-text)] truncate">{order.kurumAdi}</h3>
            <p className="text-[11px] text-[var(--dashboard-muted)]">
              {order.createdBy || '-'} · {order.createdAt ? formatDate(order.createdAt as Date, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}
            </p>
          </div>
          {/* Status badge */}
          <span className={cn(
            "shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-semibold",
            statusClass
          )}>
            {statusLabel}
          </span>
        </div>

        {/* KPI chips */}
        <div className="flex gap-3">
          <div className="cihaz-pressed px-3 py-1.5 rounded-lg">
            <span className="text-[10px] text-[var(--dashboard-muted)] block">Kalem</span>
            <span className="text-sm font-bold text-[var(--dashboard-text)]">{totalKalem}</span>
          </div>
          <div className="cihaz-pressed px-3 py-1.5 rounded-lg">
            <span className="text-[10px] text-[var(--dashboard-muted)] block">Adet</span>
            <span className="text-sm font-bold text-[var(--dashboard-text)]">{totalAdet}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {isPerifer ? (
            <button
              onClick={() => openPeripheralOrder(order)}
              disabled={isProcessing}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all",
                !isProcessing
                  ? "bg-purple-600 text-white shadow-[var(--dashboard-raised-soft)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[var(--dashboard-pressed)]"
                  : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] cursor-not-allowed"
              )}
            >
              <ArrowRight className="h-4 w-4" />
              Siparişi Gör
            </button>
          ) : (
            <button
              onClick={() => startPickingProcess(order)}
              disabled={isProcessing}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all",
                !isProcessing
                  ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[var(--dashboard-pressed)]"
                  : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] cursor-not-allowed"
              )}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {isPicking ? 'Toplamaya Devam Et' : 'Toplamayı Başlat'}
            </button>
          )}
          <button
            onClick={() => handleDeleteOrder(order.id ?? '')}
            disabled={isProcessing}
            className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-red-100 transition-colors cihaz-tool-item"
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </button>
        </div>
      </div>
    </article>
  );
}, (prevProps, nextProps) => {
  return prevProps.order.id === nextProps.order.id &&
         prevProps.order.status === nextProps.order.status &&
         prevProps.order.updatedAt === nextProps.order.updatedAt &&
         prevProps.isProcessing === nextProps.isProcessing &&
         (prevProps.order.items?.length ?? 0) === (nextProps.order.items?.length ?? 0);
});


/**
 * Orders Panel Component
 * @description Main panel for order management including creation, viewing,
 * and processing of orders in the medical supply chain system
 * @returns {JSX.Element} The rendered orders panel
 */
export default function SiparislerPanel(): JSX.Element {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  useRowFocus('focus');

  // Optimized Fetching — isPending: sadece hiç cache yoksa true.
  // Prefetch (AppLayout) sayesinde depots/hospitals/productCodes zaten cache'de olur.
  // stokLoading KASIT LI olarak çıkarıldı: tüm depo stoğu yüklenmeden panel açılabilmeli.
  const { data: allDepotsData = [] } = useDepots();
  const { data: hospitals = [] } = useHospitals();
  const { data: productCodes = [] } = useProductCodes();
  const { data: depoStok = [] } = useDepoStok();

  const depots = useMemo(() => filterOperationalSourceDepots(allDepotsData, currentUserProfile), [allDepotsData, currentUserProfile]);

  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [peripheralOrders, setPeripheralOrders] = useState<Order[]>([]);

  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [manualStockCode, setManualStockCode] = useState<string>('');
  const [manualQty, setManualQty] = useState<number | string>(1);

  const [isProcessing, setIsProcessing] = useState(false);

  const [showBulk, setShowBulk] = useState(false);
  const [selectedBulkDepots, setSelectedBulkDepots] = useState<string[]>([]);
  const [selectedBulkLabs, setSelectedBulkLabs] = useState<string[]>([]);

  // Listen to orders in real-time for the selected depot
  useEffect(() => {
    if (!selectedDepotId) {
      setAllOrders([]);
      return;
    }
    const mapSnapshot = (snap: any) => {
      const updatedOrders = snap.docs.map((d: any) => {
        const data = d.data();
        return {
          ...data,
          id: d.id,
          createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date(),
          transferredAt: data.transferredAt ? (data.transferredAt as Timestamp).toDate() : null,
        } as Order;
      });
      updatedOrders.sort((a: Order, b: Order) => {
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        return bTime - aTime;
      });
      setAllOrders(updatedOrders);
    };

    let unsubscribe: (() => void) | null = null;

    const startListener = () => {
      try {
        const q1 = scopedQuery(
          'orders',
          currentCompanyId,
          isSuperAdmin,
          where('depotId', '==', selectedDepotId),
          orderBy('createdAt', 'desc')
        );
        unsubscribe = onSnapshot(
          q1,
          (snapshot) => mapSnapshot(snapshot),
          (error) => {
            siparislerLogger.warn('Sipariş dinleyici index olmadan fallback yapıyor', {
              depotId: selectedDepotId,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            if (unsubscribe) unsubscribe();
            const q2 = scopedQuery('orders', currentCompanyId, isSuperAdmin, where('depotId', '==', selectedDepotId));
            unsubscribe = onSnapshot(q2, (snapshot) => mapSnapshot(snapshot));
          }
        );
      } catch (e) {
        siparislerLogger.warn('Sipariş dinleyici başlatma hatası', {
          depotId: selectedDepotId,
          error: e instanceof Error ? e.message : String(e),
        });
        const q2 = scopedQuery('orders', currentCompanyId, isSuperAdmin, where('depotId', '==', selectedDepotId));
        unsubscribe = onSnapshot(q2, (snapshot) => mapSnapshot(snapshot));
      }
    };

    startListener();
    return () => { if (unsubscribe) unsubscribe(); };
  }, [selectedDepotId, currentCompanyId, isSuperAdmin]);


  // Perifer — depo atanmamış siparişleri dinle. Bu liste, seçili depodan
  // bağımsız olarak ofis lojistik görünümünde her zaman gösterilir.
  useEffect(() => {
    const mapSnap = (snap: any) => {
      const rows = snap.docs
        .map((d: any) => {
          const data = d.data();
          return {
            ...data,
            id: d.id,
            createdAt: (data.createdAt as Timestamp)?.toDate?.() ?? new Date(),
            transferredAt: data.transferredAt ? (data.transferredAt as Timestamp).toDate() : null,
          } as Order;
        })
        // Only un-routed peripheral orders; routed ones already appear under
        // their destination depot via the depot-filtered listener above.
        .filter((o: Order) => !o.depotId);
      rows.sort((a: Order, b: Order) => {
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        return bTime - aTime;
      });
      setPeripheralOrders(rows);
    };

    const qPerif = scopedQuery('orders', currentCompanyId, isSuperAdmin, where('isPeripheral', '==', true));
    const unsub = onSnapshot(qPerif, mapSnap, (err) => {
      siparislerLogger.warn('Perifer sipariş dinleyici hatası', {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    });
    return () => unsub();
  }, []);


  // Auto-select first depot
  useEffect(() => {
    if (depots.length > 0 && !selectedDepotId && currentUserProfile?.role !== 'lojistik_sorumlusu') {
      setSelectedDepotId(depots[0].id);
    }
  }, [depots, selectedDepotId, currentUserProfile]);


  const addManualItem = () => {
    if (!manualStockCode || !(Number(manualQty) > 0)) {
      toast({ title: 'Hata', description: 'Stok kodu ve geçerli bir adet girin.', variant: 'destructive' });
      return;
    }
    const prod = productCodes.find(p => p.stokKodu === manualStockCode);
    if (!prod) {
      toast({ title: 'Hata', description: 'Geçersiz stok kodu.', variant: 'destructive' });
      return;
    }
    setOrderItems(prev => [
      ...prev,
      { id: generateId(), stokKodu: manualStockCode, stokAdi: prod.stokAdi, adet: Number(manualQty) },
    ]);
    setManualStockCode('');
    setManualQty(1);
  };

  const removeItem = (id: string) => setOrderItems(prev => prev.filter(i => i.id !== id));

  const prepareOrder = async () => {
    if (!selectedDepotId || !selectedLabId || orderItems.length === 0) {
      toast({ title: 'Hata', description: 'Depo, laboratuvar seçimi ve sipariş kalemleri eksiksiz olmalıdır.', variant: 'destructive' });
      return;
    }
    const orderId = generateId();
    const selectedHospital = hospitals.find(h => h.id === selectedLabId);
    const hospitalName = selectedHospital?.name || 'Bilinmeyen Kurum';
    const newOrder: Omit<Order, 'id'> = {
      depotId: selectedDepotId,
      labId: selectedLabId,
      kurumAdi: hospitalName,
      items: orderItems,
      createdAt: new Date(),
      status: 'pending',
      isPeripheral: selectedHospital?.perifer ?? false,
      createdBy: currentUserProfile?.name || currentUser?.email || 'Bilinmeyen Kullanıcı',
      createdById: currentUser?.uid || 'unknown',
      transferredAt: null,
    };
    await setDoc(doc(db, 'orders', orderId), withCompanyScope({
      ...newOrder,
      id: orderId,
      createdAt: Timestamp.fromDate(newOrder.createdAt as Date),
    }, currentCompanyId));

    // Bildirim için kısa ürün özeti: ilk 3 ürünü "Ad x adet" formatıyla, fazlasını "+N kalem" olarak göster.
    const totalAdetForNotif = orderItems.reduce((s, it) => s + (Number(it.adet) || 0), 0);
    const preview = orderItems
      .slice(0, 3)
      .map(it => `${it.stokAdi} x${it.adet}`)
      .join(', ');
    const extra = orderItems.length > 3 ? ` (+${orderItems.length - 3} kalem)` : '';
    const itemsSummary = `${preview}${extra}`;

    await emitOrderCreatedFromRequest({
      actor: { uid: currentUserProfile?.uid ?? '', name: currentUserProfile?.name ?? '' },
      orderId: orderId,
      labId: selectedLabId,
      labName: hospitalName,
      depotId: selectedDepotId,
      isPeripheral: selectedHospital?.perifer ?? false,
      itemsSummary,
      itemsCount: orderItems.length,
      totalAdet: totalAdetForNotif,
      audienceHint: {
        userId: currentUserProfile?.uid ?? undefined,
        role: currentUserProfile?.role ?? undefined,
        views: currentUserProfile?.accessibleViews ?? undefined,
        labIds: currentUserProfile?.assignedLaboratories ?? undefined,
        depotIds: currentUserProfile?.assignedDepots ?? undefined,
      }
    });

    toast({ title: 'Sipariş Oluşturuldu', description: 'Siparişiniz "Bekleyen Siparişler" listesine eklendi.' });

    setOrderItems([]);
    setSelectedLabId('');

  };

  const startPickingProcess = async (order: Order) => {
    if (!order.id) return;
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, "orders", order.id), {
        status: 'toplaniyor',
        pickingStartedAt: serverTimestamp(),
        pickingStartedById: currentUser?.uid ?? null,
        pickingStartedBy: currentUserProfile?.name ?? currentUser?.email ?? null,
      });
      router.push(`/siparisler/${order.id}/toplama`);
    } catch (e) {
      toast({ title: 'Hata', description: 'Toplama işlemi başlatılamadı.', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleSelect = (id: string, list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>) => {
    setList(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // PERF (Faz 4): Min-Max / toplu sipariş hesapları her kural için tüm depoStok'u
  // .filter ile tarıyordu → O(kural×lokasyon×|depoStok|) senkron yük (Siparişler INP'si).
  // Stok BİR KEZ adet-toplamlı Map'lere indekslenir; sonuçlar sumStockItemQuantities ile
  // birebir aynıdır (getStockItemQuantity aynı adet mantığı). Lab tarafındaki legacy isim
  // fallback'i (hedefKurumId yoksa hedefKurum adına göre) ayrı bir Map ile korunur.
  const { depotQtyMap, labQtyByIdMap, labQtyByNameMap } = useMemo(() => {
    const depotMap = new Map<string, number>();
    const labById = new Map<string, number>();
    const labByName = new Map<string, number>();
    for (const st of depoStok) {
      if (!st.stokKodu) continue;
      const qty = getStockItemQuantity(st);
      if (!st.isShipped) {
        if (st.depotId) {
          const k = `${st.depotId}|${st.stokKodu}`;
          depotMap.set(k, (depotMap.get(k) ?? 0) + qty);
        }
      } else if (st.hedefKurumId) {
        const k = `${st.hedefKurumId}|${st.stokKodu}`;
        labById.set(k, (labById.get(k) ?? 0) + qty);
      } else if (st.hedefKurum) {
        const k = `${st.hedefKurum}|${st.stokKodu}`;
        labByName.set(k, (labByName.get(k) ?? 0) + qty);
      }
    }
    return { depotQtyMap: depotMap, labQtyByIdMap: labById, labQtyByNameMap: labByName };
  }, [depoStok]);

  const getDepotStockQty = (depotId: string | undefined, stokKodu: string) =>
    depotId ? (depotQtyMap.get(`${depotId}|${stokKodu}`) ?? 0) : 0;

  const getLabStockQty = (labId: string | undefined, labName: string | undefined | null, stokKodu: string) =>
    (labId ? (labQtyByIdMap.get(`${labId}|${stokKodu}`) ?? 0) : 0)
    + (labName ? (labQtyByNameMap.get(`${labName}|${stokKodu}`) ?? 0) : 0);

  const generateBulkOrder = async () => {
    if (selectedBulkDepots.length === 0 && selectedBulkLabs.length === 0) {
      return toast({ title: 'Hata', description: 'En az bir depo veya laboratuvar seçin.', variant: 'destructive' });
    }

    const sheets: Record<string, any[]> = {};

    const fetchRules = async (path: 'depots' | 'hospitals', id: string): Promise<Record<string, MinMaxRule>> => {
      const snap = await getDocs(collection(db, path, id, 'minMaxRules'));
      const rules: Record<string, MinMaxRule> = {};
      snap.forEach(doc => {
        const d = doc.data() as MinMaxRule;
        const stokKodu = d.stokKodu;
        if (stokKodu) rules[stokKodu] = d;
      });
      return rules;
    };

    for (const depotId of selectedBulkDepots) {
      const depot = depots.find(d => d.id === depotId)!;
      const rules = await fetchRules('depots', depotId);
      const rows = Object.values(rules).map(rule => {
        const have = getDepotStockQty(depotId, rule.stokKodu);
        const maxValue = rule.max ?? 0;
        const need = maxValue - have;
        return {
          'Stok Kodu': rule.stokKodu,
          'Stok Adı': productCodes.find(p => p.stokKodu === rule.stokKodu)?.stokAdi || rule.stokKodu,
          'Mevcut Stok': have,
          'Max Adedi': maxValue,
          'Sipariş Adeti': need > 0 ? need : 0,
        };
      }).filter(r => r['Sipariş Adeti'] > 0);
      const depotName = depot.name ?? depot.id ?? 'Depot';
      sheets[depotName] = rows;
    }

    for (const labId of selectedBulkLabs) {
      const lab = hospitals.find(h => h.id === labId)!;
      const rules = await fetchRules('hospitals', labId);
      const rows = Object.values(rules).map(rule => {
        const have = getLabStockQty(lab.id, lab.name, rule.stokKodu);
        const maxValue = rule.max ?? 0;
        const need = maxValue - have;
        return {
          'Stok Kodu': rule.stokKodu,
          'Stok Adı': productCodes.find(p => p.stokKodu === rule.stokKodu)?.stokAdi || rule.stokKodu,
          'Mevcut Stok': have,
          'Max Adedi': maxValue,
          'Sipariş Adeti': need > 0 ? need : 0,
        };
      }).filter(r => r['Sipariş Adeti'] > 0);
      const labName = lab.name ?? lab.id ?? 'Lab';
      sheets[labName] = rows;
    }

    const workbook = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, data]) => {
      const ws = XLSX.utils.json_to_sheet(data, {
        header: ['Stok Kodu', 'Stok Adı', 'Mevcut Stok', 'Max Adedi', 'Sipariş Adeti']
      });
      XLSX.utils.book_append_sheet(workbook, ws, name.substring(0, 31)); // Sheet names have a 31-char limit
    });
    XLSX.writeFile(workbook, 'Toplu_Siparis.xlsx');
  };

  const handleMinMaxOrder = async () => {
    if (!selectedLabId) {
      return toast({ title: 'Hata', description: 'Lütfen siparişin oluşturulacağı hedef laboratuvarı seçin.', variant: 'destructive' });
    }

    const hospital = hospitals.find(h => h.id === selectedLabId);
    if (!hospital || !hospital.id) return;

    const rulesSnap = await getDocs(collection(db, 'hospitals', hospital.id, 'minMaxRules'));
    const rules: Record<string, MinMaxRule> = {};
    rulesSnap.forEach(doc => {
      const d = doc.data() as MinMaxRule;
      const stokKodu = d.stokKodu;
      if (stokKodu) rules[stokKodu] = d;
    });

    const neededItems: OrderItem[] = [];

    for (const rule of Object.values(rules)) {
      const labStockCount = getLabStockQty(hospital.id, hospital.name, rule.stokKodu);
      const maxValue = rule.max ?? 0;
      const need = maxValue - labStockCount;

      if (need > 0) {
        const product = productCodes.find(p => p.stokKodu === rule.stokKodu);
        if (product) {
          const depotStockCount = getDepotStockQty(selectedDepotId, rule.stokKodu);

          neededItems.push({
            id: generateId(),
            stokKodu: rule.stokKodu,
            stokAdi: `${product.stokAdi} (Depo: ${depotStockCount})`,
            adet: need,
          });
        }
      }
    }

    if (neededItems.length > 0) {
      const consolidatedItems: Record<string, OrderItem> = {};
      [...orderItems, ...neededItems].forEach(item => {
        const key = item.stokKodu;
        if (!key) return;
        const existing = consolidatedItems[key];
        if (existing) {
          existing.adet = (existing.adet ?? 0) + (item.adet ?? 0);
        } else {
          consolidatedItems[key] = { ...item };
        }
      });
      setOrderItems(Object.values(consolidatedItems));
      toast({
        title: 'Sipariş Kalemleri Eklendi',
        description: `${neededItems.length} kalem Min/Max kurallarına göre siparişe eklendi/güncellendi.`
      });
    } else {
      toast({
        title: 'Sipariş Gerekmiyor',
        description: 'Seçili laboratuvar için Min/Max kurallarına göre sipariş gerektiren ürün bulunamadı.',
        variant: 'default'
      });
    }
  };

  /**
   * Handles order deletion with confirmation
   * @param orderId - ID of the order to delete
   */
  const handleDeleteOrder = async (orderId: string): Promise<void> => {
    if (window.confirm('Bu siparişi silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.')) {
      try {
        siparislerLogger.info('Sipariş silme işlemi başlatıldı', { orderId });
        await deleteDoc(doc(db, 'orders', orderId));
        siparislerLogger.info('Sipariş başarıyla silindi', { orderId });
        toast({ title: 'Başarılı', description: 'Sipariş silindi.' });
      } catch (error) {
        siparislerLogger.error('Sipariş silme hatası', error, { orderId });
        toast({ title: 'Hata', description: 'Sipariş silinirken bir hata oluştu.', variant: 'destructive' });
      }
    }
  };

  // ── Computed state ──
  const [activeTab, setActiveTab] = useState<'create' | 'pending'>('create');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);

  // Lojistik sorumlusu rolü: sipariş oluşturma ve depo seçim akışları gizlenir,
  // yalnızca kendisine atanan laboratuvarların perifer siparişlerini görür.
  const isLojistikSorumlusu = currentUserProfile?.role === 'lojistik_sorumlusu';

  const assignedLabIdSet = useMemo(() => {
    const set = new Set<string>();
    (currentUserProfile?.assignedLaboratories ?? []).forEach(id => { if (id) set.add(id); });
    return set;
  }, [currentUserProfile?.assignedLaboratories]);

  useEffect(() => {
    if (isLojistikSorumlusu && activeTab !== 'pending') {
      setActiveTab('pending');
    }
  }, [isLojistikSorumlusu, activeTab]);

  const selectedLabName = useMemo(
    () => hospitals.find(h => h.id === selectedLabId)?.name ?? '',
    [hospitals, selectedLabId]
  );

  const depotName = useMemo(
    () => depots.find(d => d.id === selectedDepotId)?.name ?? '',
    [depots, selectedDepotId]
  );

  const pendingOrders = useMemo(() => {
    const seen = new Set<string>();
    const merged: Order[] = [];
    // Lojistik sorumlusu sadece perifer akışını yönetir; depo bazlı
    // listeden gelen siparişler gösterilmez.
    const sources = isLojistikSorumlusu ? [peripheralOrders] : [allOrders, peripheralOrders];
    sources.flat().forEach(o => {
      if (!o?.id || seen.has(o.id)) return;
      if (o.status === 'completed') return;
      if (isLojistikSorumlusu) {
        // Kullanıcı yönetiminde atanan laboratuvarların dışındaki perifer
        // siparişleri bu kullanıcıya görünmez.
        if (!o.labId || !assignedLabIdSet.has(o.labId)) return;
      }
      seen.add(o.id);
      merged.push(o);
    });
    merged.sort((a, b) => {
      const at = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return bt - at;
    });
    return merged;
  }, [allOrders, peripheralOrders, isLojistikSorumlusu, assignedLabIdSet]);

  const peripheralLabIds = useMemo(() => {
    const set = new Set<string>();
    hospitals.forEach(h => { if (h?.perifer && h.id) set.add(h.id); });
    return set;
  }, [hospitals]);

  // Bir sipariş "perifer UI" gösterir ancak HENÜZ bir depoya yönlendirilmediyse:
  // - Ofisin "Siparişi Gör"/"Depoya Yönlendir" akışına uygundur
  // - Depoya yönlendirildiyse (`depotId` set edilmişse) normal toplama akışına geçer
  const isOrderPeripheral = useCallback((order: Order) => {
    if (order.depotId) return false;
    if (order.isPeripheral === true) return true;
    if (order.labId && peripheralLabIds.has(order.labId)) return true;
    return false;
  }, [peripheralLabIds]);

  const openPeripheralOrder = useCallback((order: Order) => {
    if (!order.id) return;
    router.push(`/siparisler/${order.id}/perifer`);
  }, [router]);

  const totalDraftItems = orderItems.length;
  const totalDraftAdet = orderItems.reduce((sum, i) => sum + (Number(i.adet) || 0), 0);
  const productMetaByCode = useMemo(() => {
    const map = new Map<string, ProductCode>();
    productCodes.forEach((p) => {
      if (p.stokKodu) map.set(p.stokKodu, p);
    });
    return map;
  }, [productCodes]);

  const isCreateReady = !!selectedDepotId && !!selectedLabId && orderItems.length > 0;

  // ── Stepper state ──
  const stepperState = useMemo(() => ({
    hasDepot: !!selectedDepotId,
    hasLab: !!selectedLabId,
    hasItems: orderItems.length > 0,
  }), [selectedDepotId, selectedLabId, orderItems]);

  // ── Lojistik Sorumlusu: completely different UI (skeleton yok, anında açılır) ──
  if (isLojistikSorumlusu) {
    return <LojistikSiparisView />;
  }

  return (
    <div
      className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 space-y-4 sm:space-y-5 min-h-screen"
      role="main"
      aria-label="Sipariş yönetimi paneli"
    >
      {/* ══════════════════════ HEADER ══════════════════════ */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-[var(--dashboard-text)] flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-[var(--dashboard-accent)]" />
            Siparişler
          </h1>
          <p className="text-[11px] sm:text-xs text-[var(--dashboard-muted)] truncate">
            {isLojistikSorumlusu
              ? `Perifer siparişler · ${pendingOrders.length}`
              : `${depotName || 'Depo seçin'}${selectedLabName ? ` · ${selectedLabName}` : ''}`}
          </p>
        </div>
        {/* Secondary actions - more menu */}
        <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
          <PopoverTrigger asChild>
            <button className="cihaz-tool-item flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10">
              <MoreHorizontal className="h-4 w-4 text-[var(--dashboard-muted)]" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="end">
            <button onClick={() => { router.push('/urun-talep'); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]">
              <ClipboardPlus className="h-4 w-4 text-[var(--dashboard-muted)]" /> Ürün Talep
            </button>
            <button onClick={() => { router.push(`/siparis-gecmis?depotId=${selectedDepotId}`); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]" disabled={!selectedDepotId}>
              <History className="h-4 w-4 text-[var(--dashboard-muted)]" /> Sipariş Geçmişi
            </button>
            <button onClick={() => { router.push('/urun-iade'); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]">
              <Undo className="h-4 w-4 text-[var(--dashboard-muted)]" /> Ürün İade
            </button>
            <button onClick={() => { router.push('/merkez-siparis'); setMoreMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-[var(--dashboard-surface-2)]">
              <FileSpreadsheet className="h-4 w-4 text-[var(--dashboard-muted)]" /> Toplu Sipariş
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* ══════════════════════ DEPOT SELECTOR ══════════════════════ */}
      {!isLojistikSorumlusu && (
        <div className="cihaz-card p-3 sm:p-4">
          <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1.5">Çalışma Deposu</label>
          <Select value={selectedDepotId} onValueChange={setSelectedDepotId}>
            <SelectTrigger className="w-full bg-[var(--dashboard-surface-2)] border-[var(--dashboard-stroke)] shadow-[var(--dashboard-pressed)] rounded-xl h-10">
              <SelectValue placeholder="Depo seçin..." />
            </SelectTrigger>
            <SelectContent>
              {depots.map(d => <SelectItem key={d.id} value={d.id ?? ''}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ══════════════════════ TAB SWITCHER ══════════════════════ */}
      {!isLojistikSorumlusu && (
        <div className="flex rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] p-1 gap-1">
          <button
            onClick={() => setActiveTab('create')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all",
              activeTab === 'create'
                ? "bg-[var(--dashboard-surface)] shadow-[var(--dashboard-raised-soft)] text-[var(--dashboard-text)]"
                : "text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
            )}
          >
            <PlusCircle className="h-4 w-4" />
            Oluştur
            {totalDraftItems > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md bg-[var(--dashboard-accent)] text-white text-[10px] font-bold">{totalDraftItems}</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all",
              activeTab === 'pending'
                ? "bg-[var(--dashboard-surface)] shadow-[var(--dashboard-raised-soft)] text-[var(--dashboard-text)]"
                : "text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
            )}
          >
            <Package className="h-4 w-4" />
            Bekleyen
            {pendingOrders.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md bg-amber-500 text-white text-[10px] font-bold">{pendingOrders.length}</span>
            )}
          </button>
        </div>
      )}

      {/* ══════════════════════ CREATE TAB ══════════════════════ */}
      {!isLojistikSorumlusu && activeTab === 'create' && (
        <div className="space-y-4">
          {/* ── Stepper ── */}
          <div className="flex items-center justify-center gap-0 px-2">
            {[
              { label: 'Lab Seç', done: stepperState.hasLab, num: 1 },
              { label: 'Ürün Ekle', done: stepperState.hasItems, num: 2 },
              { label: 'Oluştur', done: false, num: 3 },
            ].map((step, i) => (
              <React.Fragment key={step.num}>
                {i > 0 && (
                  <div className={cn(
                    "flex-1 h-[2px] max-w-[60px] sm:max-w-[80px] transition-colors",
                    step.done || (i === 1 && stepperState.hasLab)
                      ? "bg-[var(--dashboard-accent)]"
                      : "bg-[var(--dashboard-stroke)]"
                  )} />
                )}
                <div className="flex flex-col items-center gap-1">
                  <div className={cn(
                    "w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-all",
                    step.done
                      ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)]"
                      : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)]"
                  )}>
                    {step.done ? <Check className="h-4 w-4" /> : step.num}
                  </div>
                  <span className="text-[10px] sm:text-xs font-medium text-[var(--dashboard-muted)]">{step.label}</span>
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* ── 2-Column Layout ── */}
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 sm:gap-5">
            {/* ── LEFT: Config + Add ── */}
            <div className="space-y-4">
              {/* Lab selector */}
              <div className="cihaz-card-strong p-4 sm:p-5 space-y-3">
                <p className="cihaz-section-label">Hedef Laboratuvar</p>
                <LabSelector
                  labs={hospitals.map(h => ({ id: h.id ?? '', name: h.name, kod: h.kod }))}
                  value={selectedLabId}
                  onChange={(id) => setSelectedLabId(id)}
                  placeholder="Laboratuvar seçin..."
                  disabled={!selectedDepotId || hospitals.length === 0}
                />

                {/* Min/Max button */}
                <button
                  onClick={handleMinMaxOrder}
                  disabled={!selectedLabId}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all",
                    selectedLabId
                      ? "cihaz-action-tile text-[var(--dashboard-text)]"
                      : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] cursor-not-allowed"
                  )}
                  title={!selectedLabId ? 'Min/Max hesaplamak için laboratuvar seçmelisiniz' : undefined}
                >
                  <Calculator className="h-4 w-4 text-[var(--dashboard-accent)]" />
                  Min/Max'a Göre Hesapla
                </button>
              </div>

              {/* Manual product add */}
              <div className="cihaz-card p-4 sm:p-5 space-y-3">
                <p className="cihaz-section-label">Ürün Ekle</p>

                {/* Product combobox */}
                <div>
                  <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Ürün Seç</label>
                  <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "w-full flex items-center justify-between px-3 h-10 rounded-xl text-sm transition-all border border-[var(--dashboard-stroke)]",
                          manualStockCode
                            ? "bg-[var(--dashboard-surface)] shadow-[var(--dashboard-raised-soft)] font-medium text-[var(--dashboard-text)]"
                            : "bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)]"
                        )}
                      >
                        <span className="truncate">
                          {manualStockCode ? productCodes.find(p => p.stokKodu === manualStockCode)?.stokAdi : 'Ürün seçin...'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command>
                        <CommandInput placeholder="Ürün ara..." />
                        <CommandList>
                          <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                          <CommandGroup>
                            {productCodes
                              .sort((a, b) => (a.stokAdi ?? '').localeCompare(b.stokAdi ?? ''))
                              .map(p => (
                                <CommandItem
                                  key={p.id ?? p.stokKodu}
                                  value={`${p.stokAdi ?? ''} ${p.stokKodu ?? ''}`}
                                  onSelect={() => { setManualStockCode(p.stokKodu ?? ''); setIsProductPopoverOpen(false); }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", manualStockCode === p.stokKodu ? "opacity-100" : "opacity-0")} />
                                  <div className="flex flex-col">
                                    <span className="text-sm">{p.stokAdi}</span>
                                    <span className="text-[10px] text-[var(--dashboard-muted)]">{p.stokKodu}</span>
                                  </div>
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Qty + Add row */}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] block mb-1">Adet</label>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => setManualQty(Math.max(1, Number(manualQty) - 1))}
                        className="w-8 h-10 rounded-l-xl bg-[var(--dashboard-surface-2)] border border-[var(--dashboard-stroke)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <Input
                        type="number"
                        min="1"
                        value={manualQty}
                        onChange={e => setManualQty(e.target.value)}
                        className="h-10 text-center text-sm font-bold border-y border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] rounded-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        onClick={() => setManualQty(Number(manualQty) + 1)}
                        className="w-8 h-10 rounded-r-xl bg-[var(--dashboard-surface-2)] border border-[var(--dashboard-stroke)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={addManualItem}
                    disabled={!manualStockCode || !(Number(manualQty) > 0)}
                    className={cn(
                      "h-10 px-4 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
                      manualStockCode && Number(manualQty) > 0
                        ? "bg-[var(--dashboard-accent)] text-white shadow-[var(--dashboard-raised-soft)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[var(--dashboard-pressed)]"
                        : "bg-[var(--dashboard-surface-2)] text-[var(--dashboard-muted)] shadow-[var(--dashboard-pressed)] cursor-not-allowed"
                    )}
                  >
                    <Plus className="h-4 w-4" />
                    Ekle
                  </button>
                </div>
              </div>
            </div>

            {/* ── RIGHT: Draft List ── */}
            <div className="cihaz-card-strong flex flex-col overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center gap-2 sm:gap-3 px-4 py-3 sm:px-5 border-b border-[var(--dashboard-stroke)]">
                <div className="flex-shrink-0">
                  <h2 className="text-sm sm:text-base font-semibold text-[var(--dashboard-text)]">
                    Sipariş Kalemleri
                    <span className="ml-1.5 text-[var(--dashboard-muted)]">({totalDraftItems})</span>
                  </h2>
                  <p className="text-[10px] sm:text-xs text-[var(--dashboard-muted)]">
                    {totalDraftAdet} adet ürün sipariş edilecek
                  </p>
                </div>
                <div className="flex-1" />
                {orderItems.length > 0 && (
                  <button
                    onClick={() => setOrderItems([])}
                    className="cihaz-tool-item flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Temizle</span>
                  </button>
                )}
              </div>

              {/* Table header (desktop) */}
              {orderItems.length > 0 && (
                <div className="hidden sm:grid grid-cols-[2fr_1fr_80px_90px_40px] gap-1 px-4 sm:px-5 py-2 text-[10px] font-semibold tracking-wide uppercase text-[var(--dashboard-muted)] border-b border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface-2)]">
                  <span>Ürün</span>
                  <span>Stok Kodu</span>
                  <span className="text-center">Adet</span>
                  <span className="text-center">Birim</span>
                  <span></span>
                </div>
              )}

              {/* Table body */}
              <div className="flex-1 overflow-auto max-h-[50vh]">
                {orderItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[35vh] sm:h-[40vh] text-center px-4">
                    <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                      <Search className="h-6 w-6 text-[var(--dashboard-muted)]" />
                    </div>
                    <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Sipariş listesi boş</p>
                    <p className="text-xs text-[var(--dashboard-muted)] mb-4">Başlamak için:</p>
                    <div className="space-y-2 text-xs text-[var(--dashboard-muted)]">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold", stepperState.hasLab ? "bg-[var(--dashboard-accent)] text-white" : "bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]")}>1</span>
                        <span className={stepperState.hasLab ? "line-through" : ""}>Laboratuvar seçin</span>
                        {stepperState.hasLab && <Check className="h-3 w-3 text-green-600" />}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold", stepperState.hasItems ? "bg-[var(--dashboard-accent)] text-white" : "bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]")}>2</span>
                        <span>Ürün ekleyin veya Min/Max hesaplatın</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center text-[10px] font-bold">3</span>
                        <span>Siparişi oluşturun</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  orderItems.map((item, idx) => {
                    const meta = productMetaByCode.get(item.stokKodu || '');
                    const multiplier = formatUnitMultiplier(meta);
                    return (
                      <div key={item.id} className="border-b border-[var(--dashboard-stroke)] last:border-b-0">
                        {/* Desktop row */}
                        <div className="hidden sm:grid grid-cols-[2fr_1fr_80px_90px_40px] gap-1 items-center px-4 sm:px-5 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate">{item.stokAdi}</p>
                            <p className="text-[10px] text-[var(--dashboard-muted)]">{normalizeUnitLabel(meta?.anaBirim)}{multiplier ? ` (${multiplier})` : ''}</p>
                          </div>
                          <div>
                            <span className="text-[11px] text-[var(--dashboard-muted)]">{item.stokKodu}</span>
                          </div>
                          <div className="flex items-center justify-center">
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => {
                                  const newQty = Math.max(1, (item.adet ?? 1) - 1);
                                  setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: newQty } : i));
                                }}
                                className="w-6 h-6 rounded-md bg-[var(--dashboard-surface-2)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="text-center text-sm font-bold text-[var(--dashboard-text)] min-w-[72px]">{item.adet}</span>
                              <button
                                onClick={() => {
                                  setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: (i.adet ?? 1) + 1 } : i));
                                }}
                                className="w-6 h-6 rounded-md bg-[var(--dashboard-surface-2)] flex items-center justify-center hover:bg-[var(--dashboard-surface)] transition-colors"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <div className="flex justify-center">
                            <span className="text-[11px] text-[var(--dashboard-muted)]">{normalizeUnitLabel(meta?.anaBirim)}{multiplier ? ` (${multiplier})` : ''}</span>
                          </div>
                          <div className="flex justify-center">
                            <button
                              onClick={() => removeItem(item.id ?? '')}
                              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-100 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          </div>
                        </div>
                        {/* Mobile row */}
                        <div className="sm:hidden px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[var(--dashboard-text)] truncate">{item.stokAdi}</p>
                              <p className="text-[10px] text-[var(--dashboard-muted)]">{normalizeUnitLabel(meta?.anaBirim)}{multiplier ? ` (${multiplier})` : ''}</p>
                              <p className="text-[11px] text-[var(--dashboard-muted)]">{item.stokKodu}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={() => { const newQty = Math.max(1, (item.adet ?? 1) - 1); setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: newQty } : i)); }} className="w-7 h-7 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center">
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="text-center text-sm font-bold min-w-[92px]">{item.adet}</span>
                              <button onClick={() => { setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, adet: (i.adet ?? 1) + 1 } : i)); }} className="w-7 h-7 rounded-lg bg-[var(--dashboard-surface-2)] flex items-center justify-center">
                                <Plus className="h-3 w-3" />
                              </button>
                              <span className="text-[10px] text-[var(--dashboard-muted)]">{normalizeUnitLabel(meta?.anaBirim)}{multiplier ? ` (${multiplier})` : ''}</span>
                              <button onClick={() => removeItem(item.id ?? '')} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-100 ml-1">
                                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Sticky CTA bar */}
              <div className="sticky bottom-0 border-t border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] px-4 sm:px-5 py-3 flex items-center gap-3">
                <div className="flex gap-3 sm:gap-4 text-xs">
                  <div>
                    <span className="text-[var(--dashboard-muted)]">Kalem</span>
                    <span className="ml-1 font-bold text-[var(--dashboard-text)]">{totalDraftItems}</span>
                  </div>
                  <div>
                    <span className="text-[var(--dashboard-muted)]">Adet</span>
                    <span className="ml-1 font-bold text-[var(--dashboard-text)]">{totalDraftAdet}</span>
                  </div>
                </div>
                <div className="flex-1" />
                <button
                  onClick={prepareOrder}
                  disabled={!isCreateReady || isProcessing}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-bold transition-all",
                    isCreateReady && !isProcessing
                      ? "bg-green-600 text-white shadow-[var(--dashboard-raised)] hover:shadow-[var(--dashboard-raised-soft)] active:shadow-[var(--dashboard-pressed)] hover:-translate-y-0.5 active:translate-y-0"
                      : "cihaz-pressed text-[var(--dashboard-muted)] cursor-not-allowed"
                  )}
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-4 w-4" />
                  )}
                  {totalDraftItems > 0 ? `Siparişi Oluştur (${totalDraftItems})` : 'Siparişi Oluştur'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ PENDING TAB ══════════════════════ */}
      {(isLojistikSorumlusu || activeTab === 'pending') && (
        <div className="space-y-3">
          {pendingOrders.length === 0 ? (
            <div className="cihaz-card-strong flex flex-col items-center justify-center py-16 sm:py-20 text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] flex items-center justify-center mb-4">
                <Package className="h-6 w-6 text-[var(--dashboard-muted)]" />
              </div>
              <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Bekleyen sipariş yok</p>
              <p className="text-xs text-[var(--dashboard-muted)]">Yeni sipariş oluşturmak için &quot;Oluştur&quot; sekmesine geçin.</p>
            </div>
          ) : (
            pendingOrders.map(order => (
              <MemoizedOrderCard
                key={order.id}
                order={order}
                isProcessing={isProcessing}
                openPeripheralOrder={openPeripheralOrder}
                startPickingProcess={startPickingProcess}
                handleDeleteOrder={handleDeleteOrder}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
