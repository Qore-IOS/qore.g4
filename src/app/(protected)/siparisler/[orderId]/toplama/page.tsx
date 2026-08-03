/**
 * @fileoverview Order Picking Page
 * @description Handles the barcode scanning and product picking process for orders.
 * Supports serial and lot-based tracking, FEFO validation, and shipment creation.
 * @module app/siparisler/[orderId]/toplama
 * @version 2.0.0
 *
 * @features
 * - HID barcode scanner integration
 * - FEFO (First Expired First Out) validation with override option
 * - Serial number and lot-based tracking
 * - Real-time picking progress display
 * - Automatic shipment creation on completion
 * - Lab transfer date tracking
 * - Custom product order support per hospital
 *
 * @accessibility
 * - ARIA labels for all interactive elements
 * - Screen reader announcements for scan results
 * - Keyboard accessible controls
 * - Visual feedback for picking progress
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Order, OrderItem, DepoStokItem, ProductCode, PickingListItem as PickingListItemType, Shipment, ShipmentItem, DeviceGroup, Hospital, Depot, ConsumptionRecord } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, writeBatch, serverTimestamp, query, where, getDocs, Timestamp, setDoc, limit } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
import { useAuth } from '@/contexts/auth-context';
import { matchesCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { archiveCompletedOrderInBatch, getOrderDocWithArchiveFallback } from '@/lib/orders-archive';
import { useLoading } from '@/contexts/loading-context';
import { parse as parseDate, compareAsc } from 'date-fns';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';

import { Loader2, Truck, Trash2, ChevronLeft, CheckCircle2, AlertTriangle, Package, ScanBarcode, ChevronDown, ChevronUp, MoreHorizontal, XCircle } from 'lucide-react';
import Image from 'next/image';
import { resolveImageSrc } from '@/lib/image-utils';
import { cn, generateId, playFeedback } from '@/lib/utils';
import { maybeAutoPrintTutanak } from '@/lib/tutanak-autoprint';
import { formatMiad, toDateFromAny } from '@/lib/date';
import { resolveDefaultTrackingMode, resolveEffectiveTrackingMode } from '@/lib/tracking';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { siparisToplamaLogger } from '@/lib/logger';
import { getStockItemQuantity, sumStockItemQuantities } from '@/lib/stock-quantity';
import {
  aggregateOrderItemsByProduct,
  decodeLotPickingIdentifier,
  encodeLotPickingIdentifier,
  findAvailableStockForQuantityScan,
} from '@/lib/siparisler/picking';


function LastTransferLine({
  date,
  className,
}: {
  date?: any; // Can be Timestamp, Date, string, or number from Firestore
  className?: string;
}) {
  const jsDate = toDateFromAny(date);

  if (!jsDate) {
    return (
      <div className={cn("text-xs text-orange-500 font-medium", className)}>
        Son transfer bilgisi yok
      </div>
    );
  }

  // Calculate days ago
  const now = new Date();
  const diffMs = now.getTime() - jsDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let displayText: string;
  if (diffDays === 0) {
    displayText = "Son transfer: bugün";
  } else if (diffDays === 1) {
    displayText = "Son transfer: dün";
  } else if (diffDays < 30) {
    displayText = `Son transfer: ${diffDays} gün önce`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    displayText = `Son transfer: ${months} ay önce`;
  } else {
    const years = Math.floor(diffDays / 365);
    displayText = `Son transfer: ${years} yıl önce`;
  }

  return (
    <div className={cn("text-xs text-blue-600 font-medium", className)}>
      {displayText}
    </div>
  );
}


const SimpleProductThumb: React.FC<{ src?: string | null; alt: string; size?: number; className?: string }> = ({
  src,
  alt,
  size = 40,
  className,
}) => {
  const safeSrc = resolveImageSrc(src, '/lab_diorama.png');
  return (
    <div className={cn('relative rounded-md overflow-hidden', className)} style={{ width: size, height: size }}>
      <Image
        src={safeSrc}
        alt={alt}
        fill
        sizes={`${size}px`}
        className="object-contain"
      />
    </div>
  );
};


export default function ToplamaPage() {
  const params = useParams();
  const orderId = (params?.orderId as string) ?? '';
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode, formats: barcodeFormats } = useBarcodeParser();
  const { suppressGlobalLoading } = useLoading();

  // Suppress global loading overlay - it interferes with barcode scanning
  useEffect(() => {
    const unsuppress = suppressGlobalLoading();
    return unsuppress;
  }, [suppressGlobalLoading]);

  // Scan processing lock to prevent race conditions from rapid sequential scans
  const scanLockRef = useRef(false);

  const [order, setOrder] = useState<Order | null>(null);
  const [pickingList, setPickingList] = useState<PickingListItemType[]>([]);
  const [depoStok, setDepoStok] = useState<DepoStokItem[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [currentDepot, setCurrentDepot] = useState<Depot | null>(null);
  // Last transfer dates per stokKodu to the target hospital (from labTransferDates collection)
  const [lastTransferDates, setLastTransferDates] = useState<Record<string, Date>>({});

  const [scannedSerials, setScannedSerials] = useState<Record<string, string[]>>({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Scan feed state
  type ScanEvent = { id: string; ts: number; ok: boolean; message: string; stokKodu?: string };
  const [scanFeed, setScanFeed] = useState<ScanEvent[]>([]);
  const pushScanEvent = useCallback((ok: boolean, message: string, stokKodu?: string) => {
    setScanFeed(prev => [{ id: generateId(), ts: Date.now(), ok, message, stokKodu }, ...prev].slice(0, 20));
  }, []);

  // Filter state for group cards
  const [groupFilter, setGroupFilter] = useState<'all' | 'remaining' | 'done'>('all');
  // Collapsed done groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Confirm-delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const targetHospital = useMemo(() => {
    return hospitals.find(h => h.id === order?.labId);
  }, [hospitals, order?.labId]);
  
  // Refactored Data Fetching Logic
  useEffect(() => {
    if (!orderId) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        // 1. Fetch Order — canlı `orders`'ta yoksa `ordersArchive`'a düş.
        // Tamamlanan siparişler arşive taşındığından `orders`'ta artık yoktur.
        const orderSnap = await getOrderDocWithArchiveFallback(orderId);

        if (!orderSnap.exists()) {
          toast({ title: 'Hata', description: 'Sipariş bulunamadı.', variant: 'destructive' });
          router.push('/siparisler');
          return;
        }

        const orderData = { id: orderSnap.id, ...orderSnap.data() } as Order;
        setOrder(orderData);

        if (!orderData.depotId) {
            throw new Error("Order is missing depotId.");
        }

        // 2. Fetch Dependent Data via Admin SDK server action.
        // Replaces 4× getScopedDocs (≈10 Firestore reads through IndexedDB) with
        // 4–6 parallel Admin SDK queries — no IndexedDB, ~1–2 s vs 10–15 s.
        // Sadece siparişteki stok kodlarına ait depo stoğunu çek — tüm depo
        // stoğunu taşımak açılışı 20 sn+ yavaşlatıyordu.
        const orderStokKodlari = Array.from(
          new Set((orderData.items || []).map(i => i.stokKodu).filter(Boolean) as string[])
        );
        const [bootstrapData, depotSnap] = await Promise.all([
          import('@/actions/stokActions').then(m =>
            m.getToplamaBootstrapData(orderData.depotId, currentCompanyId, isSuperAdmin, orderStokKodlari)
          ),
          getDoc(doc(db, 'depots', orderData.depotId)),
        ]);

        const productsData = bootstrapData.productCodes as ProductCode[];
        const depoStokData = bootstrapData.depoStok;
        const deviceGroupsData = bootstrapData.deviceGroups as DeviceGroup[];
        const hospitalsData = bootstrapData.hospitals as Hospital[];

        // Determine effective labId - try order.labId first, then find by kurumAdi
        let effectiveLabId = orderData.labId;
        siparisToplamaLogger.debug('Sipariş verileri yüklendi', {
          labId: orderData.labId,
          kurumAdi: orderData.kurumAdi,
          depotId: orderData.depotId,
        });

        if (!effectiveLabId && orderData.kurumAdi) {
          const matchedHospital = hospitalsData.find(
            h => h.name === orderData.kurumAdi || h.ad === orderData.kurumAdi
          );
          siparisToplamaLogger.debug('Hastane eşleştirmesi yapıldı', {
            matchedHospitalId: matchedHospital?.id,
            matchedHospitalName: matchedHospital?.name,
          });
          effectiveLabId = matchedHospital?.id;
        }
        siparisToplamaLogger.debug('Efektif laboratuvar ID belirlendi', { effectiveLabId });

        // Fetch labTransferDates for this lab-depot combination
        const transferDates: Record<string, Date> = {};
        if (effectiveLabId && orderData.depotId) {
          const labTransferDocId = `${effectiveLabId}_${orderData.depotId}`;
          siparisToplamaLogger.debug('Transfer tarihleri yükleniyor', { labTransferDocId });
          const labTransferSnap = await getDoc(doc(db, 'labTransferDates', labTransferDocId));
          siparisToplamaLogger.debug('Transfer tarihleri sorgusu tamamlandı', {
            exists: labTransferSnap.exists(),
          });

          if (labTransferSnap.exists()) {
            const labTransferData = labTransferSnap.data();
            siparisToplamaLogger.debug('Transfer verileri alındı', {
              transferCount: Object.keys(labTransferData?.transfers || {}).length,
            });
            const transfers = labTransferData?.transfers as Record<string, { lastTransferDate: any }> | undefined;
            if (transfers) {
              Object.entries(transfers).forEach(([stokKodu, info]) => {
                const parsedDate = toDateFromAny(info.lastTransferDate);
                if (parsedDate) {
                  transferDates[stokKodu] = parsedDate;
                }
              });
            }
          }
        } else {
          siparisToplamaLogger.debug('Transfer tarihleri yüklenemiyor - eksik veri', {
            effectiveLabId,
            depotId: orderData.depotId,
          });
        }
        siparisToplamaLogger.debug('Transfer tarihleri hazırlandı', {
          transferDatesCount: Object.keys(transferDates).length,
        });
        setLastTransferDates(transferDates);

        if (depotSnap && depotSnap.exists()) {
            setCurrentDepot({ id: depotSnap.id, ...depotSnap.data() } as Depot);
        } else {
            siparisToplamaLogger.warn('Depo bulunamadı', { depotId: orderData.depotId });
        }

        setProductCodes(productsData);
        setDepoStok(depoStokData);
        setDeviceGroups(deviceGroupsData);
        setHospitals(hospitalsData);

        // Generate picking list
        const pickingListItems: PickingListItemType[] = [];
        const availableWarehouseStock = depoStokData;

        const requestedByProduct = aggregateOrderItemsByProduct(orderData.items || []);

        for (const orderItem of requestedByProduct) {
          const productInfo = productsData.find(p => p.stokKodu === orderItem.stokKodu);
          const availableItemsForProduct = availableWarehouseStock
            .filter(ds => ds.stokKodu === orderItem.stokKodu)
            .sort((a,b) => {
              try {
                  return compareAsc(parseDate(a.miad as string, 'dd.MM.yyyy', new Date()), parseDate(b.miad as string, 'dd.MM.yyyy', new Date()))
              } catch { return 0; }
            });
          const suggestedStock = availableItemsForProduct[0];
          const dgMatch = deviceGroupsData.find(dg => dg.name === productInfo?.cihazGrubu);

          pickingListItems.push({
            id: generateId(),
            orderId: orderData.id,
            stokKodu: orderItem.stokKodu || '',
            stokAdi: productInfo?.stokAdi || orderItem.stokAdi || suggestedStock?.stokAdi || '',
            lotNumarasi: suggestedStock ? (suggestedStock.lotNumarasi || '') : 'STOK YOK',
            miad: (suggestedStock?.miad as string) || '-',
            rafAdresiOnerilen: suggestedStock?.rafAdresi || '-',
            adetIstenen: orderItem.adet ?? 0,
            toplananSeriNumaralari: [],
            cihazGrubu: productInfo?.cihazGrubu || 'Diğer',
            cihazGrubuImageUrl: (dgMatch as any)?.imageUrl,
          } as any);
        }
        
        // Get target hospital for custom sorting
        const targetHospitalForSort = orderData.labId
          ? hospitalsData.find(h => h.id === orderData.labId)
          : hospitalsData.find(h => h.name === orderData.kurumAdi || h.ad === orderData.kurumAdi);

        // Check if hospital has custom product order
        const customOrder = (targetHospitalForSort as any)?.customProductOrder as string[] | undefined;

        if (customOrder && customOrder.length > 0) {
          // Use custom product order
          const orderMap = new Map<string, number>();
          customOrder.forEach((code: string, idx: number) => {
            orderMap.set(code, idx);
          });

          pickingListItems.sort((a, b) => {
            const orderA = orderMap.has(a.stokKodu || '') ? orderMap.get(a.stokKodu || '')! : 99999;
            const orderB = orderMap.has(b.stokKodu || '') ? orderMap.get(b.stokKodu || '')! : 99999;
            if (orderA !== orderB) return orderA - orderB;
            // Fallback to device group + name sort for items not in custom order
            const groupA = (a as any).cihazGrubu || 'zzz';
            const groupB = (b as any).cihazGrubu || 'zzz';
            if (groupA !== groupB) return groupA.localeCompare(groupB);
            return (a.stokAdi || '').localeCompare(b.stokAdi || '');
          });
        } else {
          // Default sorting: cihazGrubu then stokAdi alphabetically
          pickingListItems.sort((a, b) => {
            const groupA = (a as any).cihazGrubu || 'zzz';
            const groupB = (b as any).cihazGrubu || 'zzz';
            if (groupA !== groupB) {
              return groupA.localeCompare(groupB);
            }
            return (a.stokAdi || '').localeCompare(b.stokAdi || '');
          });
        }

        setPickingList(pickingListItems);

      } catch (error) {
        siparisToplamaLogger.error('Toplama sayfası verileri yüklenirken hata oluştu', error, { orderId });
        toast({ title: 'Hata', description: 'Veriler yüklenirken bir hata oluştu.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [orderId, router, toast, currentCompanyId, isSuperAdmin]);

  const addScannedSerial = useCallback((orderItemStokKodu: string, serialOrIdentifier: string) => {
    setScannedSerials(prev => {
        const currentScanned = prev[orderItemStokKodu] || [];
        return {
            ...prev,
            [orderItemStokKodu]: [...currentScanned, serialOrIdentifier],
        };
    });
    playFeedback();
    const product = productCodes.find(p => p.stokKodu === orderItemStokKodu);
    const totalNeeded = pickingList.filter(it => it.stokKodu === orderItemStokKodu).reduce((s, i) => s + (i.adetIstenen ?? 0), 0);
    const currentCount = (scannedSerials[orderItemStokKodu] || []).length + 1;
    pushScanEvent(true, `${product?.stokAdi || orderItemStokKodu} → +1 (${currentCount}/${totalNeeded})`, orderItemStokKodu);
  }, [productCodes, pickingList, scannedSerials, pushScanEvent]);

  const handleScan = useCallback(async (code: string) => {
    // Scan lock to prevent race conditions from rapid sequential scans
    if (scanLockRef.current) {
      siparisToplamaLogger.debug('Tarama kilidi aktif, barkod atlandı', { code });
      return;
    }
    scanLockRef.current = true;
    try {
      const resolveResult = parseAndResolveBarcode(code, barcodeFormats, productCodes);

      if (!resolveResult || !resolveResult.parsed) {
          const stockItem = depoStok.find(item => item.seriNumarasi === code && item.depotId === order?.depotId && !item.isShipped);
          if (stockItem) {
              const pickItem = pickingList.find(it => it.stokKodu === stockItem.stokKodu);
              if (!pickItem) {
                   pushScanEvent(false, `${stockItem.stokAdi || code} – listede değil`);
                   return;
              }
              if (Object.values(scannedSerials).flat().includes(code)) {
                   pushScanEvent(false, `Seri ${code} – zaten okutulmuş`);
                   return;
              }
              siparisToplamaLogger.info('Ham barkod seri eşleşmesi ile ürün okutuldu', {
                orderId: order?.id,
                stokKodu: stockItem.stokKodu,
                seriNumarasi: code,
                stockDocId: stockItem.id,
              });
              addScannedSerial(stockItem.stokKodu || '', code);
          } else {
              pushScanEvent(false, `Tanınmayan barkod: ${code.slice(0, 20)}…`);
          }
          return;
      }

      const resolved = resolveResult.parsed;
      const product = resolveResult.product;
      const { stokKodu, seriNumarasi, lotNumarasi } = resolved;

      if (!product || !stokKodu) {
          pushScanEvent(false, `Barkod eşleşmedi: ${code.slice(0, 20)}…`);
          return;
      }

      const pickItemForProduct = pickingList.find(it => it.stokKodu === stokKodu);
      if (!pickItemForProduct) {
          pushScanEvent(false, `${product.stokAdi} – listede değil`);
          return;
      }

      // Use effective tracking mode based on actual barcode content (like direct transfer)
      const matchedFormat = resolved.matchedFormatId
        ? barcodeFormats.find(f => f.id === resolved.matchedFormatId)
        : undefined;
      const mode = resolveEffectiveTrackingMode(resolved, matchedFormat, product as any);

      if (mode === 'serial' || (mode as string) === 'serial_and_lot') {
        if (!seriNumarasi) {
          pushScanEvent(false, `${product.stokAdi} – seri no eksik`);
          return;
        }
        const stockEntry = depoStok.find(item =>
          item.seriNumarasi === seriNumarasi &&
          item.stokKodu === stokKodu &&
          item.depotId === order?.depotId &&
          !item.isShipped
        );
        if (!stockEntry) {
          pushScanEvent(false, `Seri ${seriNumarasi} – ürün/seri eşleşmesi stokta yok veya sevk edilmiş`);
          return;
        }
        if (Object.values(scannedSerials).flat().includes(seriNumarasi)) {
          pushScanEvent(false, `Seri ${seriNumarasi} – zaten okutulmuş`);
          return;
        }
        const totalNeededForProduct = pickingList.filter(it => it.stokKodu === stokKodu).reduce((sum, item) => sum + (item.adetIstenen ?? 0), 0);
        const currentScannedForProduct = scannedSerials[stokKodu] || [];
        if (currentScannedForProduct.length >= totalNeededForProduct) {
          pushScanEvent(false, `${product.stokAdi} – istenen adete ulaşıldı`);
          return;
        }

        // FEFO check: show info in scan feed but DO NOT block scanning.
        const suggestion = pickingList.find(pl => pl.stokKodu === stokKodu);
        const expectedLot = suggestion?.lotNumarasi;
        if (expectedLot && stockEntry.lotNumarasi !== expectedLot) {
          siparisToplamaLogger.info('FEFO uyarısı: farklı lot okutuldu (engellenmedi)', {
            stokKodu,
            seriNumarasi,
            scannedLot: stockEntry.lotNumarasi,
            suggestedLot: expectedLot,
          });
        }
        siparisToplamaLogger.info('Seri takipli ürün okutuldu', {
          orderId: order?.id,
          stokKodu,
          stokAdi: product.stokAdi,
          seriNumarasi,
          lotNumarasi: stockEntry.lotNumarasi || null,
          stockDocId: stockEntry.id,
          trackingMode: mode,
        });
        addScannedSerial(stokKodu, seriNumarasi);
      } else { // Lot/Quantity logic
          const totalNeededForProduct = pickingList.filter(it => it.stokKodu === stokKodu).reduce((sum, item) => sum + (item.adetIstenen ?? 0), 0);
          const currentScannedForProduct = (scannedSerials[stokKodu] || []);
          if (currentScannedForProduct.length >= totalNeededForProduct) {
            pushScanEvent(false, `${product.stokAdi} – istenen adete ulaşıldı`);
            return;
          }

          const availableStockForProduct = depoStok
            .filter(item =>
              item.stokKodu === stokKodu &&
              item.depotId === order?.depotId &&
              !item.isShipped &&
              (!lotNumarasi || item.lotNumarasi === lotNumarasi)
            )
            .sort((a, b) => {
              try {
                return compareAsc(parseDate(a.miad as string, 'dd.MM.yyyy', new Date()), parseDate(b.miad as string, 'dd.MM.yyyy', new Date()));
              } catch { return 0; }
            });
          const stockToPick = findAvailableStockForQuantityScan(
            availableStockForProduct,
            currentScannedForProduct,
            lotNumarasi,
          );

          if (!stockToPick) {
              pushScanEvent(false, lotNumarasi
                ? `${product.stokAdi} – ${lotNumarasi} lotunda yeterli stok yok`
                : `${product.stokAdi} – depoda yeterli stok yok`);
              return;
          }

          const actualLot = stockToPick.lotNumarasi || '';
          const scannedCountForLot = currentScannedForProduct.filter(identifier => decodeLotPickingIdentifier(identifier) === actualLot).length;
          siparisToplamaLogger.info('Lot/adet takipli ürün okutuldu', {
            orderId: order?.id,
            stokKodu,
            stokAdi: product.stokAdi,
            lotNumarasi: actualLot,
            suggestedLot: pickItemForProduct.lotNumarasi,
            okutulanAdet: scannedCountForLot + 1,
            trackingMode: mode,
          });
          addScannedSerial(stokKodu, encodeLotPickingIdentifier(actualLot, scannedCountForLot + 1));
      }
    } finally {
      scanLockRef.current = false;
    }
  }, [order, scannedSerials, depoStok, pickingList, addScannedSerial, parseAndResolveBarcode, productCodes, barcodeFormats, pushScanEvent]);
  
  useHidScanner({
    enabled: true,
    onScan: ({raw}) => handleScan(raw)
  });

  const deletePickingItem = (itemStokKodu: string) => {
    setPickingList(prev => prev.filter(item => item.stokKodu !== itemStokKodu));
    setScannedSerials(prev => {
        const newScanned = { ...prev };
        delete newScanned[itemStokKodu];
        return newScanned;
    });
    toast({ title: 'Ürün Kaldırıldı', description: `${itemStokKodu} toplama listesinden çıkarıldı.` });
  };

  const commitTransfer = async () => {
    if (!order || !currentUser || !currentUserProfile) {
        toast({ title: 'Hata', description: 'Gerekli bilgiler (sipariş, kullanıcı) eksik.', variant: 'destructive' });
        setIsProcessing(false);
        return;
    }

    const flatScannedSerials: string[] = Object.keys(scannedSerials).reduce<string[]>((acc, key) => {
      acc.push(...scannedSerials[key]);
      return acc;
    }, []);
    if (flatScannedSerials.length === 0) {
      toast({ title: 'Uyarı', description: 'Transfer edilecek ürün okutulmadı.', variant: 'default' });
      return;
    }

    if (!currentDepot) {
        toast({ title: 'Hata', description: 'Depo bilgisi yüklenemedi. Sayfayı yenileyiniz.', variant: 'destructive' });
        setIsProcessing(false);
        return;
    }

    setIsProcessing(true);
    let success = false;
    let itemsShippedCount = 0;

    try {
      const batch = writeBatch(db);

      // Find target hospital early - needed for transfer record
      const targetHospital = order.labId
        ? hospitals.find(h => h.id === order.labId)
        : hospitals.find(h => h.name === order.kurumAdi || h.ad === order.kurumAdi);
      const effectiveLabId = order.labId || targetHospital?.id || null;
      const trackingDisabled = !!effectiveLabId && targetHospital?.consumptionTrackingEnabled === false;
      const targetName = order.kurumAdi;
      const depotName = currentDepot.name || '';

      // Create transfer record (like direkt-transfer-panel)
      const transferRef = doc(collection(db, 'transfers'));

      const itemsToShipByStockId = new Map<string, DepoStokItem & { transferAdet: number }>();
      const createdConsumptionDocIds: string[] = [];
      const allocatedQuantitiesByStockId = new Map<string, number>();
      const getAllocatedQuantity = (stockId?: string) => stockId ? (allocatedQuantitiesByStockId.get(stockId) || 0) : 0;
      const getRemainingQuantity = (item: DepoStokItem) => getStockItemQuantity(item) - getAllocatedQuantity(item.id);
      const addTransferAllocation = (item: DepoStokItem, qty: number) => {
        if (!item.id || qty <= 0) return;
        const existing = itemsToShipByStockId.get(item.id);
        if (existing) {
          existing.transferAdet += qty;
        } else {
          itemsToShipByStockId.set(item.id, { ...item, transferAdet: qty });
        }
        allocatedQuantitiesByStockId.set(item.id, getAllocatedQuantity(item.id) + qty);
      };
      const scannedMatrix = Object.entries(scannedSerials);

      siparisToplamaLogger.info('Transfer hazırlığı başlatıldı', {
        orderId: order.id,
        depotId: order.depotId,
        effectiveLabId,
        trackingDisabled,
        scannedByProduct: scannedMatrix,
      });

      for (const [stokKodu, identifiers] of scannedMatrix) {
        const product = productCodes.find(p => p.stokKodu === stokKodu);
        const trackingMode = resolveDefaultTrackingMode(product || {});

        for (const serialOrIdentifier of identifiers) {
          let stockItem: DepoStokItem | undefined;

          if (trackingMode === 'serial') {
            stockItem = depoStok.find(item =>
              item.seriNumarasi === serialOrIdentifier &&
              item.stokKodu === stokKodu &&
              item.depotId === order.depotId &&
              !item.isShipped &&
              getRemainingQuantity(item) > 0
            );
          } else if (trackingMode === 'lot_barcode' || trackingMode === 'lot_manual') {
            const lot = decodeLotPickingIdentifier(serialOrIdentifier);
            stockItem = depoStok.find(item =>
              item.lotNumarasi === lot &&
              item.stokKodu === stokKodu &&
              item.depotId === order.depotId &&
              !item.isShipped &&
              getRemainingQuantity(item) > 0
            );
          } else {
            const lotFromScan = decodeLotPickingIdentifier(serialOrIdentifier);
            stockItem = depoStok.find(item =>
              item.stokKodu === stokKodu &&
              item.depotId === order.depotId &&
              !item.isShipped &&
              getRemainingQuantity(item) > 0 &&
              (!!lotFromScan ? item.lotNumarasi === lotFromScan : true)
            );
            if (!stockItem) {
              stockItem = depoStok.find(item =>
                item.stokKodu === stokKodu &&
                item.depotId === order.depotId &&
                !item.isShipped &&
                getRemainingQuantity(item) > 0
              );
            }
          }

          if (stockItem) {
            addTransferAllocation(stockItem, 1);
            siparisToplamaLogger.info('Okutulan ürün transfer adayına eşlendi', {
              orderId: order.id,
              stokKodu,
              trackingMode,
              scannedIdentifier: serialOrIdentifier,
              matchedStockDocId: stockItem.id,
              matchedSerial: stockItem.seriNumarasi || null,
              matchedLot: stockItem.lotNumarasi || null,
            });
          } else {
            siparisToplamaLogger.warn('Okutulan ürün için eşleşen stok kaydı bulunamadı', {
              orderId: order.id,
              stokKodu,
              trackingMode,
              scannedIdentifier: serialOrIdentifier,
            });
          }
        }
      }

      const itemsToShip = Array.from(itemsToShipByStockId.values());

      if (itemsToShip.length === 0) {
        toast({ title: 'Hata', description: 'Transfer edilecek geçerli stok kalemi bulunamadı.', variant: 'destructive' });
        setIsProcessing(false);
        return;
      }

      const shipmentItems: ShipmentItem[] = [];
      const shippedQuantities: Record<string, number> = {};

      itemsToShip.filter(item => item.stokKodu).forEach(item => {
          const key = item.stokKodu!;
          shippedQuantities[key] = (shippedQuantities[key] || 0) + item.transferAdet;
      });

      const totalShippedAdet = Object.values(shippedQuantities).reduce((sum, qty) => sum + qty, 0);

      Object.keys(shippedQuantities).forEach(stokKodu => {
          const productInfo = itemsToShip.find(i => i.stokKodu === stokKodu);
          if (productInfo) {
              shipmentItems.push({
                  stokKodu: stokKodu,
                  stokAdi: productInfo.stokAdi,
                  lotNumarasi: productInfo.lotNumarasi || 'N/A',
                  miad: productInfo.miad as string || 'N/A',
                  quantity: shippedQuantities[stokKodu],
                  serialNumbers: itemsToShip.filter(i => i.stokKodu === stokKodu && i.seriNumarasi).map(i => i.seriNumarasi as string),
              });
          }
      });

      // Create shipment record (backward compatible)
      const shipmentDocRef = doc(collection(db, 'shipments'));
      const newShipment: Omit<Shipment, 'id'> = {
          orderId: order.id,
          depotId: order.depotId!,
          depotName: depotName,
          recipientHospital: targetName,
          userId: currentUser?.uid || 'unknown_user',
          userName: currentUserProfile?.name || currentUser?.email || 'Unknown User',
          timestamp: new Date(),
          items: shipmentItems,
      };
      batch.set(shipmentDocRef, { ...newShipment, timestamp: Timestamp.fromDate(newShipment.timestamp as Date) });

      // Create transfers record (like direkt-transfer-panel for consistency)
      batch.set(transferRef, withCompanyScope({
        id: transferRef.id,
        timestamp: serverTimestamp(),
        sourceDepotId: order.depotId,
        sourceDepotName: depotName,
        targetName: targetName,
        targetHospitalId: effectiveLabId,
        mode: 'order_picking',
        orderId: order.id,
        itemCount: totalShippedAdet,
        createdByUid: currentUser.uid ?? '',
        createdByName: currentUserProfile.name ?? currentUser?.email ?? '',
      }, currentCompanyId));

      // Update depoStok items: full documents are marked shipped; partial lot/qty picks
      // decrement the source document and create a shipped target document for the picked quantity.
      itemsToShip.filter(item => item.id).forEach(item => {
          const transferQty = item.transferAdet;
          const originalQty = getStockItemQuantity(item);
          const isPartial = transferQty < originalQty;
          const stokRef = doc(db, 'depoStok', item.id!);
          const targetRef = isPartial ? doc(collection(db, 'depoStok')) : stokRef;
          const targetDocId = targetRef.id;

          if (trackingDisabled && effectiveLabId) {
            if (isPartial) {
              batch.update(stokRef, { adet: originalQty - transferQty });
            } else {
              batch.delete(stokRef);
            }
            const consumptionRef = doc(collection(db, 'tuketimKayitlari'));
            const consumptionRecord: Omit<ConsumptionRecord, 'id'> & {
              transferId: string;
              orderId: string;
              sourceDepotId?: string;
              sourceDepotName?: string;
              stockDocId?: string;
              adet?: number;
            } = {
              stokKodu: item.stokKodu,
              stokAdi: item.stokAdi,
              lotNumarasi: item.lotNumarasi || '',
              miad: String(item.miad || ''),
              seriNumarasi: item.seriNumarasi || '',
              laboratoryId: effectiveLabId,
              laboratoryName: targetName,
              consumptionTimestamp: new Date(),
              consumptionType: 'normal_kullanim',
              userId: currentUser.uid ?? 'unknown',
              userName: currentUserProfile.name ?? currentUser?.email ?? 'Unknown User',
              transferId: transferRef.id,
              orderId: order.id,
              sourceDepotId: order.depotId,
              sourceDepotName: depotName,
              stockDocId: item.id,
              adet: transferQty,
            };
            batch.set(consumptionRef, consumptionRecord);
            createdConsumptionDocIds.push(consumptionRef.id);
          } else if (isPartial) {
            batch.update(stokRef, { adet: originalQty - transferQty });
            const targetData = {
              ...item,
              id: targetDocId,
              adet: transferQty,
              isShipped: true,
              hedefKurum: targetName,
              hedefKurumId: effectiveLabId,
              sevkTarihi: serverTimestamp(),
              transferId: transferRef.id,
              sourceDepotId: order.depotId,
              sourceDepotName: depotName,
            };
            delete (targetData as any).transferAdet;
            batch.set(targetRef, targetData);
          } else {
            batch.update(stokRef, {
                isShipped: true,
                hedefKurum: targetName,
                hedefKurumId: effectiveLabId,
                sevkTarihi: serverTimestamp(),
                transferId: transferRef.id,
                sourceDepotId: order.depotId,
                sourceDepotName: depotName,
            });
          }

          // Create serial history for serial-tracked items
          if (item.seriNumarasi) {
            const histRef = doc(collection(db, `serialHistory/${item.seriNumarasi}/events`));
            batch.set(histRef, {
              type: 'transfer',
              transferId: transferRef.id,
              orderId: order.id,
              details: {
                sourceDepotId: order.depotId,
                sourceDepotName: depotName,
                targetName: targetName,
                targetHospitalId: effectiveLabId,
                stokKodu: item.stokKodu,
                stokAdi: item.stokAdi,
                lotNumarasi: item.lotNumarasi,
                miad: item.miad,
                adet: transferQty,
              },
              timestamp: Timestamp.now(),
            });
          }

          // Create transfer item record
          const itemRef = doc(db, 'transfers', transferRef.id, 'items', targetDocId);
          batch.set(itemRef, {
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            lotNumarasi: item.lotNumarasi || '',
            miad: item.miad || '',
            seriNumarasi: item.seriNumarasi || '',
            adet: transferQty,
          });
      });

      // Calculate remaining order items
      const remainingByProduct = { ...shippedQuantities };
      const remainingItems = (order.items || []).map(item => {
          const code = item.stokKodu || '';
          const availableToSubtract = remainingByProduct[code] || 0;
          const subtractQty = Math.min(item.adet ?? 0, availableToSubtract);
          if (subtractQty > 0) {
            remainingByProduct[code] = availableToSubtract - subtractQty;
          }
          return {
              ...item,
              adet: (item.adet ?? 0) - subtractQty,
          };
      }).filter(item => item.adet > 0);

      siparisToplamaLogger.info('Sipariş kalan kalem hesaplaması', {
        orderId: order.id,
        originalItems: order.items?.map(i => ({ stokKodu: i.stokKodu, adet: i.adet })),
        shippedQuantities,
        remainingItems: remainingItems.map(i => ({ stokKodu: i.stokKodu, adet: i.adet })),
        itemsToShipCount: itemsToShip.length,
      });

      if (remainingItems.length === 0 && order.id) {
          // Tamamlanan sipariş canlı `orders`'ta bırakılmaz; aynı batch içinde
          // `ordersArchive`'a taşınır (kopyala + sil). `orders` yalnızca aktif
          // siparişleri tutar, süresiz büyümez.
          archiveCompletedOrderInBatch(batch, order.id, order as unknown as Record<string, unknown>, {
              transferredAt: serverTimestamp(),
              transferredById: currentUser?.uid,
              transferredBy: currentUserProfile?.name || currentUser?.email || 'Bilinmeyen Kullanıcı',
              completedAt: serverTimestamp(),
          });
      } else if (order.id) {
          // Partial transfer: mark as 'kismi' so the Kısmi Tamamlanan tab picks it up
          batch.update(doc(db, 'orders', order.id), {
              items: remainingItems,
              status: 'kismi',
              partialTransferAt: serverTimestamp(),
          });
      }

      await batch.commit();
      itemsShippedCount = totalShippedAdet;

      // ── 2-Step Verification ──
      // Step 1: Verify source depot stock was properly deducted (isShipped = true)
      const verificationErrors: string[] = [];
      const verifySourcePromises = itemsToShip.filter(item => item.id).map(async (item) => {
        const verifySnap = await getDoc(doc(db, 'depoStok', item.id!));
        if (trackingDisabled) {
          if (verifySnap.exists()) {
            verificationErrors.push(`Tüketim takibi kapalı lab için stok silinmeliydi: ${item.stokAdi} (${item.id})`);
          }
          return;
        }
        if (!verifySnap.exists()) {
          verificationErrors.push(`Stok kaydı bulunamadı: ${item.stokKodu} (${item.seriNumarasi || item.lotNumarasi || item.id})`);
          return;
        }
        const verifyData = verifySnap.data();
        if (!matchesCompanyScope(verifyData as any, currentCompanyId, isSuperAdmin)) {
          verificationErrors.push(`Kapsam dışı stok kaydı: ${item.stokKodu} (${item.seriNumarasi || item.lotNumarasi || item.id})`);
          return;
        }
        const originalQty = getStockItemQuantity(item);
        const transferQty = item.transferAdet;
        const isPartial = transferQty < originalQty;
        if (isPartial) {
          const expectedRemainingQty = originalQty - transferQty;
          const actualRemainingQty = getStockItemQuantity(verifyData as any);
          if (actualRemainingQty !== expectedRemainingQty || verifyData.isShipped) {
            verificationErrors.push(`Kaynak depoda kalan adet uyuşmadı: ${item.stokAdi} - beklenen: ${expectedRemainingQty}, bulunan: ${actualRemainingQty}`);
          }
        } else {
          if (!verifyData.isShipped) {
            verificationErrors.push(`Kaynak depodan düşülmedi: ${item.stokAdi} (${item.seriNumarasi || item.lotNumarasi || ''})`);
          }
          if (verifyData.hedefKurumId !== effectiveLabId) {
            verificationErrors.push(`Hedef kurum eşleşmedi: ${item.stokAdi} - beklenen: ${effectiveLabId}, bulunan: ${verifyData.hedefKurumId}`);
          }
        }
      });
      await Promise.all(verifySourcePromises);

      // Step 1b: Verify target stock/consumption reflection
      const transferDocItemsSnap = await getDocs(scopedQuery('depoStok', currentCompanyId, isSuperAdmin, where('transferId', '==', transferRef.id)));
      if (!trackingDisabled) {
        const matchedTargetStockCount = sumStockItemQuantities(transferDocItemsSnap.docs
          .filter(d => matchesCompanyScope(d.data() as any, currentCompanyId, isSuperAdmin))
          .filter(d => (d.data().hedefKurumId || null) === effectiveLabId)
          .map(d => d.data() as any));
        if (matchedTargetStockCount !== totalShippedAdet) {
          verificationErrors.push(`Hedef laboratuvar stoğuna yansıyan ürün adedi uyuşmuyor: beklenen ${totalShippedAdet}, bulunan ${matchedTargetStockCount}`);
        }
      } else {
        const consumptionDocs = await Promise.all(
          createdConsumptionDocIds.map(async (id) => {
            const snap = await getDoc(doc(db, 'tuketimKayitlari', id));
            if (!snap.exists()) {
              verificationErrors.push(`Tüketim kaydı bulunamadı: ${id}`);
              return null;
            }
            return snap.data() as Partial<ConsumptionRecord> & { transferId?: string; orderId?: string };
          })
        );

        const expectedConsumptionKeyCounts = itemsToShip.reduce<Record<string, number>>((acc, item) => {
          const key = `${item.stokKodu}|${item.seriNumarasi || ''}|${item.lotNumarasi || ''}`;
          acc[key] = (acc[key] || 0) + item.transferAdet;
          return acc;
        }, {});

        const actualConsumptionKeyCounts = consumptionDocs.reduce<Record<string, number>>((acc, data) => {
          if (!data) return acc;

          if (data.transferId !== transferRef.id) {
            verificationErrors.push(`Tüketim kaydı transferId uyuşmuyor: beklenen ${transferRef.id}, bulunan ${data.transferId || 'yok'}`);
          }
          if (data.orderId !== order.id) {
            verificationErrors.push(`Tüketim kaydı orderId uyuşmuyor: beklenen ${order.id}, bulunan ${data.orderId || 'yok'}`);
          }
          if (data.laboratoryId !== effectiveLabId) {
            verificationErrors.push(`Tüketim kaydı laboratoryId uyuşmuyor: beklenen ${effectiveLabId}, bulunan ${data.laboratoryId || 'yok'}`);
          }

          const key = `${data.stokKodu || ''}|${data.seriNumarasi || ''}|${data.lotNumarasi || ''}`;
          if (expectedConsumptionKeyCounts[key]) {
            acc[key] = (acc[key] || 0) + getStockItemQuantity(data as any);
          }
          return acc;
        }, {});

        Object.entries(expectedConsumptionKeyCounts).forEach(([key, expectedCount]) => {
          const actualCount = actualConsumptionKeyCounts[key] || 0;
          if (actualCount < expectedCount) {
            verificationErrors.push(`Tüketim takibi kapalı laboratuvar için tüketim kaydı eksik (${key}): beklenen ${expectedCount}, bulunan ${actualCount}`);
          }
        });

        if (Object.keys(expectedConsumptionKeyCounts).length === 0) {
          verificationErrors.push('Tüketim doğrulaması için beklenen ürün bulunamadı');
        }
      }

      // Step 2: Verify order was properly updated. Tamamlanmışsa sipariş artık
      // `ordersArchive`'tadır; fallback okuyucu canlı→arşiv sırasıyla bulur.
      if (order.id) {
        const orderVerifySnap = await getOrderDocWithArchiveFallback(order.id);
        if (orderVerifySnap.exists()) {
          const orderVerifyData = orderVerifySnap.data();
          if (remainingItems.length === 0 && orderVerifyData.status !== 'completed') {
            verificationErrors.push(`Sipariş durumu 'completed' olarak güncellenemedi (mevcut: ${orderVerifyData.status})`);
          } else if (remainingItems.length > 0) {
            const updatedItems = orderVerifyData.items as OrderItem[] | undefined;
            if (updatedItems) {
              const totalRemainingInDb = updatedItems.reduce((sum: number, it: OrderItem) => sum + (it.adet ?? 0), 0);
              const expectedRemaining = remainingItems.reduce((sum, it) => sum + (it.adet ?? 0), 0);
              if (totalRemainingInDb !== expectedRemaining) {
                verificationErrors.push(`Kalan adet uyuşmazlığı: beklenen ${expectedRemaining}, veritabanında ${totalRemainingInDb}`);
              }
            }
          }
        }
      }

      if (verificationErrors.length > 0) {
        siparisToplamaLogger.error('Transfer doğrulama hataları', null, {
          orderId: order.id,
          transferId: transferRef.id,
          errors: verificationErrors,
        });
        toast({
          title: 'Transfer Doğrulama Uyarısı',
          description: `Transfer kaydedildi ancak ${verificationErrors.length} doğrulama sorunu tespit edildi. Lütfen stok durumunu kontrol edin.`,
          variant: 'destructive',
        });
      }

      success = verificationErrors.length === 0;

      await maybeAutoPrintTutanak(db, targetHospital, shipmentDocRef.id, currentUserProfile?.name || currentUser?.email || '');

      // Update labTransferDates collection with last transfer dates (direct client-side write)
      if (effectiveLabId && order.depotId && shipmentItems.length > 0) {
        try {
          const labTransferDocId = `${effectiveLabId}_${order.depotId}`;
          const labTransferRef = doc(db, 'labTransferDates', labTransferDocId);
          const now = new Date();
          const userName = currentUserProfile?.name || currentUser?.email || '';

          // Build transfers map
          const transfersUpdate: Record<string, any> = {};
          shipmentItems.forEach((item) => {
            if (item.stokKodu) {
              transfersUpdate[item.stokKodu] = {
                lastTransferDate: Timestamp.fromDate(now),
                lastTransferBy: userName,
              };
            }
          });

          // Use setDoc with merge to create or update
          await setDoc(labTransferRef, {
            labId: effectiveLabId,
            depotId: order.depotId,
            labName: order.kurumAdi,
            depotName: depotName,
            transfers: transfersUpdate,
            updatedAt: serverTimestamp(),
          }, { merge: true });

          siparisToplamaLogger.info('Transfer tarihleri güncellendi', {
            labTransferDocId,
            updatedProductsCount: Object.keys(transfersUpdate).length,
          });
        } catch (transferError) {
          siparisToplamaLogger.error('Transfer tarihleri güncellenirken hata oluştu', transferError);
        }
      }

      siparisToplamaLogger.info('Sipariş toplama transferi tamamlandı', {
        orderId: order.id,
        transferId: transferRef.id,
        shipmentId: shipmentDocRef.id,
        itemsShipped: itemsShippedCount,
        remainingItemsCount: remainingItems.length,
        orderCompleted: remainingItems.length === 0,
        trackingDisabled,
        shippedItems: itemsToShip.map(item => ({
          id: item.id,
          stokKodu: item.stokKodu,
          stokAdi: item.stokAdi,
          lotNumarasi: item.lotNumarasi || null,
          seriNumarasi: item.seriNumarasi || null,
        })),
      });

    } catch (e) {
      siparisToplamaLogger.error('Transfer işlemi sırasında hata oluştu', e, {
        orderId: order?.id,
        itemsCount: Object.values(scannedSerials).flat().length,
      });
      toast({ title: 'Hata', description: 'Transfer sırasında bir veritabanı hatası oluştu.', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
      if (success) {
        toast({ title: 'Transfer Tamamlandı', description: `${itemsShippedCount} kalem sevk edildi. Sipariş güncellendi.` });
        router.push('/siparisler');
      } else if (itemsShippedCount > 0) {
        // Transfer committed but verification had issues - still navigate back
        router.push('/siparisler');
      }
    }
  };

  /* ───────── Derived / computed values ───────── */
  const totalNeeded = useMemo(() => pickingList.reduce((s, i) => s + (i.adetIstenen ?? 0), 0), [pickingList]);
  const totalScanned = useMemo(() => Object.values(scannedSerials).flat().length, [scannedSerials]);
  const overallPct = totalNeeded > 0 ? Math.round((totalScanned / totalNeeded) * 100) : 0;

  // Stok yeterliliği lot önerisinden bağımsız olarak ürünün depodaki toplam miktarıdır.
  const depotStockQtyByProduct = useMemo(() => {
    const byStok = new Map<string, number>();
    const depotId = order?.depotId;
    for (const stockItem of depoStok) {
      if (stockItem.isShipped || !stockItem.stokKodu || stockItem.depotId !== depotId) continue;
      byStok.set(stockItem.stokKodu, (byStok.get(stockItem.stokKodu) ?? 0) + getStockItemQuantity(stockItem));
    }
    return byStok;
  }, [depoStok, order?.depotId]);

  const enrichedList = useMemo(() => pickingList.map(item => {
    const scannedForProduct = scannedSerials[item.stokKodu] || [];
    const scannedCount = scannedForProduct.length;
    const needed = item.adetIstenen ?? 0;
    const isComplete = scannedCount >= needed;
    const isOutOfStock = item.lotNumarasi === 'STOK YOK';
    const totalInDepot = depotStockQtyByProduct.get(item.stokKodu) ?? 0;
    const isInsufficient = !isOutOfStock && totalInDepot < needed;
    const status: 'done' | 'blocked' | 'active' | 'idle' = isComplete ? 'done' : isOutOfStock ? 'blocked' : scannedCount > 0 ? 'active' : 'idle';
    const pct = needed > 0 ? Math.round((scannedCount / needed) * 100) : 0;
    return { ...item, scannedCount, needed, isComplete, isOutOfStock, totalInDepot, isInsufficient, status, pct, cihazGrubu: (item as any).cihazGrubu, cihazGrubuImageUrl: (item as any).cihazGrubuImageUrl };
  }), [pickingList, scannedSerials, depotStockQtyByProduct]);

  const filteredList = useMemo(() => {
    if (groupFilter === 'remaining') return enrichedList.filter(i => !i.isComplete);
    if (groupFilter === 'done') return enrichedList.filter(i => i.isComplete);
    return enrichedList;
  }, [enrichedList, groupFilter]);

  const doneCount = enrichedList.filter(i => i.isComplete).length;
  const remainingCount = enrichedList.length - doneCount;

  const orderDate = useMemo(() => {
    const d = toDateFromAny(order?.createdAt) || toDateFromAny(order?.olusturmaTarihi);
    return d ? format(d, 'd MMM yyyy', { locale: tr }) : null;
  }, [order?.createdAt, order?.olusturmaTarihi]);

  const isTransferReady = totalScanned > 0 && !isProcessing;

  /* ───────── Loading state ───────── */
  if (isLoading || !order) {
    return (
      <div className="cihaz-shell flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <div className="cihaz-card-strong p-8 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--dashboard-accent)' }} />
          <span style={{ color: 'var(--dashboard-text)' }} className="text-sm font-medium">Toplama listesi hazırlanıyor…</span>
        </div>
      </div>
    );
  }

  /* ───────── Status badge helper ───────── */
  const statusBadge = (status: 'done' | 'blocked' | 'active' | 'idle') => {
    const map = {
      done:    { label: 'Tamamlandı', bg: 'rgba(22,163,74,.12)', color: '#16A34A', icon: <CheckCircle2 className="w-3 h-3" /> },
      blocked: { label: 'Stok Yok',   bg: 'rgba(185,28,28,.10)', color: '#B91C1C', icon: <XCircle className="w-3 h-3" /> },
      active:  { label: 'Toplanıyor', bg: 'rgba(245,158,11,.12)', color: '#D97706', icon: <ScanBarcode className="w-3 h-3" /> },
      idle:    { label: 'Bekliyor',   bg: 'rgba(107,114,128,.10)', color: '#6B7280', icon: <Package className="w-3 h-3" /> },
    };
    const s = map[status];
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: s.bg, color: s.color }}>
        {s.icon} {s.label}
      </span>
    );
  };

  // ── Design tokens for visual refresh ──
  const T = {
    surface: 'var(--qc-surface)',
    surface2: 'var(--qc-surface2)',
    ink1: 'var(--qc-ink1)',
    ink2: 'var(--qc-ink2)',
    ink3: 'var(--qc-ink3)',
    accent: 'var(--qc-accent)',
    accentLight: '#E0B776',
    accentGlow: 'rgba(201,138,87,0.24)',
    water: 'rgba(124,191,140,0.22)',
    waterSolid: 'var(--qc-water-solid)',
    clay: 'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 7px rgba(178,160,128,0.14), 0 10px 24px -12px rgba(150,128,96,0.34), 0 2px 6px -2px rgba(150,128,96,0.16)',
    clayInset: 'inset 0 2px 5px rgba(178,160,128,0.30), inset 0 -1px 0 rgba(255,255,255,0.55)',
    clayFlat: 'inset 0 1px 1px rgba(255,255,255,0.85), 0 4px 12px -7px rgba(150,128,96,0.28)',
    ease: 'cubic-bezier(.22, 1, .36, 1)',
    r: '24px',
    rsm: '16px',
    rpill: '999px',
  };

  return (
    <>
    <style>{`
      @keyframes tplWaterRise { from { opacity: 0; } to { opacity: 1; } }
      @keyframes tplScanPop { 0% { opacity:0; transform:translateY(-6px) scale(0.96); } 100% { opacity:1; transform:none; } }
    `}</style>
    {/* Full-bleed cream backdrop — PageShell kenar boşluklarındaki gri zeminin
        görünmesini engeller, ekranı tek renk krem sarar. */}
    <div aria-hidden style={{ position: 'fixed', inset: 0, background: T.surface2, zIndex: 0 }} />
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', background: T.surface2 }} className="px-3 py-4 sm:px-5 sm:py-6 pb-28 sm:pb-6">

      {/* ── Back ── */}
      <button
        onClick={() => router.push('/siparisler')}
        style={{
          all: 'unset', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', marginBottom: 16, borderRadius: T.rpill,
          background: `linear-gradient(180deg, #fff, ${T.surface2})`,
          boxShadow: T.clayFlat,
          color: T.ink2, fontSize: 12.5, fontWeight: 700,
        }}
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Siparişler
      </button>

      {/* ── Sticky header ── */}
      <header style={{
        borderRadius: T.r, marginBottom: 18,
        background: `linear-gradient(180deg, ${T.surface} 0%, ${T.surface2} 100%)`,
        boxShadow: T.clay, overflow: 'hidden',
      }}>
        {/* Top bar: title + last scan + CTA */}
        <div style={{ padding: '18px 22px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em', color: T.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {order.kurumAdi}
              </h1>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginTop: 4 }}>
                {order.depotName && (
                  <span style={{ fontSize: 11.5, color: T.ink2, fontWeight: 600 }}>Depo: {order.depotName}</span>
                )}
                {order.createdBy && (
                  <span style={{ fontSize: 11.5, color: T.ink2 }}>Açan: {order.createdBy}</span>
                )}
                {orderDate && (
                  <span style={{ fontSize: 11.5, color: T.ink3 }}>{orderDate}</span>
                )}
                <span style={{ fontSize: 11.5, color: T.ink3 }}>{pickingList.length} grup · {totalNeeded} adet</span>
              </div>
            </div>

            {/* Desktop CTA */}
            <button
              onClick={commitTransfer}
              disabled={!isTransferReady}
              className="hidden sm:flex"
              style={{
                all: 'unset', cursor: isTransferReady ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: T.rsm, flexShrink: 0,
                background: isTransferReady
                  ? 'linear-gradient(180deg, #8FD3A6 0%, #6FB585 100%)'
                  : T.surface2,
                boxShadow: isTransferReady
                  ? 'inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 20px -8px rgba(111,181,133,0.5)'
                  : T.clayInset,
                color: isTransferReady ? '#fff' : T.ink3,
                fontSize: 13.5, fontWeight: 800,
                transition: `all 300ms ${T.ease}`,
                opacity: isTransferReady ? 1 : 0.7,
              }}
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck style={{ width: 15, height: 15 }} />}
              Transfer Et & Kapat
            </button>
          </div>

          {/* Son Okutulan card (shown when scan feed has items) */}
          {scanFeed.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: T.rsm,
              background: scanFeed[0].ok ? 'rgba(111,181,133,0.12)' : 'rgba(192,121,106,0.10)',
              border: `1px solid ${scanFeed[0].ok ? 'rgba(111,181,133,0.28)' : 'rgba(192,121,106,0.22)'}`,
              animation: `tplScanPop 300ms ${T.ease}`,
            }}>
              {scanFeed[0].ok
                ? <CheckCircle2 style={{ width: 15, height: 15, flexShrink: 0, color: '#4E9E6B' }} />
                : <XCircle style={{ width: 15, height: 15, flexShrink: 0, color: '#B91C1C' }} />
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: scanFeed[0].ok ? '#4E9E6B' : '#B91C1C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {scanFeed[0].message}
                </p>
                <p style={{ margin: 0, fontSize: 10.5, color: T.ink3 }}>
                  Son okutma · {new Date(scanFeed[0].ts).toLocaleTimeString('tr-TR')}
                </p>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: T.ink2, flexShrink: 0 }}>
                {totalScanned}/{totalNeeded}
              </span>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div style={{ padding: '14px 22px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Genel İlerleme
            </span>
            <span style={{
              fontSize: 13, fontWeight: 800,
              color: overallPct === 100 ? '#4E9E6B' : T.ink1,
              transition: `color 400ms ${T.ease}`,
            }}>
              {totalScanned}/{totalNeeded} <span style={{ fontWeight: 600, fontSize: 12, color: T.ink2 }}>({overallPct}%)</span>
            </span>
          </div>
          <div style={{
            height: 10, borderRadius: T.rpill,
            background: T.surface2, boxShadow: T.clayInset,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: T.rpill,
              width: `${overallPct}%`,
              background: overallPct === 100
                ? 'linear-gradient(90deg, #8FD3A6, #4E9E6B)'
                : `linear-gradient(90deg, ${T.accentLight}, ${T.accent})`,
              transition: `width 600ms ${T.ease}`,
              boxShadow: overallPct > 0 ? `0 0 10px -3px ${overallPct === 100 ? 'rgba(78,158,107,0.5)' : T.accentGlow}` : 'none',
            }} />
          </div>
        </div>
      </header>

      {/* ── 2-column desktop layout ── */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-5">

        {/* LEFT COLUMN: Group list */}
        <div className="flex-1 min-w-0 space-y-3">

          {/* Scanner status + filter chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', borderRadius: T.rpill,
              background: `linear-gradient(180deg, #fff, ${T.surface2})`,
              boxShadow: T.clayFlat,
              fontSize: 12, fontWeight: 700, color: '#4E9E6B',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6FB585', display: 'inline-block', animation: 'pulse 2s infinite' }} />
              Barkod okuyucu aktif
            </div>

            <div style={{
              display: 'inline-flex', padding: 3, borderRadius: T.rpill,
              background: T.surface2, boxShadow: T.clayInset, gap: 2,
            }}>
              {(['all', 'remaining', 'done'] as const).map(f => {
                const labels = { all: 'Tümü', remaining: 'Eksik', done: 'Tamamlanan' };
                const counts = { all: enrichedList.length, remaining: remainingCount, done: doneCount };
                const isActive = groupFilter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setGroupFilter(f)}
                    style={{
                      all: 'unset', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      height: 34, padding: '0 14px', borderRadius: T.rpill,
                      background: isActive ? `linear-gradient(180deg, #fff, ${T.surface2})` : 'transparent',
                      boxShadow: isActive ? T.clay : 'none',
                      color: isActive ? T.ink1 : T.ink3,
                      fontSize: 12.5, fontWeight: 700,
                      transition: `color 200ms ${T.ease}`,
                    }}
                  >
                    {labels[f]}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                      background: isActive ? T.accent : 'rgba(150,128,96,0.16)',
                      color: isActive ? '#fff' : T.ink3, fontSize: 10, fontWeight: 800,
                    }}>
                      {counts[f]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Group section label */}
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Toplanacak Gruplar</p>

          {/* Group cards */}
          {filteredList.length === 0 ? (
            <div style={{
              padding: '40px 24px', textAlign: 'center', borderRadius: T.r,
              background: `linear-gradient(180deg, ${T.surface}, ${T.surface2})`,
              boxShadow: T.clay, color: T.ink3,
            }}>
              <Package style={{ width: 40, height: 40, margin: '0 auto 10px', opacity: 0.35 }} />
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.ink2 }}>
                {groupFilter === 'done' ? 'Henüz tamamlanan grup yok.' : groupFilter === 'remaining' ? 'Tüm gruplar tamamlandı!' : 'Toplanacak ürün bulunamadı.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredList.map(item => {
                const isCollapsed = item.isComplete && collapsedGroups.has(item.id);
                const isLastScanned = scanFeed[0]?.stokKodu === item.stokKodu && Date.now() - (scanFeed[0]?.ts ?? 0) < 2000;
                const borderColor = item.status === 'blocked' ? '#B91C1C' : item.status === 'active' ? T.accent : item.status === 'done' ? '#6FB585' : 'transparent';

                return (
                  <article
                    key={item.id}
                    style={{
                      position: 'relative', overflow: 'hidden',
                      borderRadius: T.r, padding: '16px 18px',
                      background: `linear-gradient(180deg, ${T.surface} 0%, ${T.surface2} 100%)`,
                      boxShadow: isLastScanned
                        ? `${T.clay}, 0 0 0 2px ${T.accent}`
                        : T.clay,
                      borderLeft: `3px solid ${borderColor}`,
                      opacity: item.isComplete ? 0.82 : 1,
                      transition: `opacity 400ms ${T.ease}, box-shadow 300ms ${T.ease}`,
                    }}
                  >
                    {/* Water fill — rises from bottom as pct increases */}
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'absolute', left: 0, right: 0, bottom: 0,
                        height: `${item.pct}%`,
                        background: item.isComplete
                          ? 'rgba(111,181,133,0.18)'
                          : item.isInsufficient
                            ? 'rgba(217,119,6,0.10)'
                            : 'rgba(124,191,140,0.16)',
                        transition: `height 600ms ${T.ease}`,
                        pointerEvents: 'none',
                      }}
                    />

                    {/* Top row: name + status badge + actions */}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <h3 style={{
                            margin: 0, fontSize: 14.5, fontWeight: 700, color: T.ink1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {item.stokAdi}
                          </h3>
                          {statusBadge(item.status)}
                        </div>
                        <p style={{ margin: '3px 0 0', fontSize: 11, fontFamily: 'monospace', color: T.ink3 }}>
                          {item.stokKodu}
                        </p>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {item.isComplete && (
                          <button
                            onClick={() => setCollapsedGroups(prev => {
                              const next = new Set(prev);
                              next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                              return next;
                            })}
                            style={{ all: 'unset', cursor: 'pointer', padding: 4, borderRadius: 8, color: T.ink3 }}
                          >
                            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                          </button>
                        )}
                        {/* More menu with delete confirm */}
                        <div style={{ position: 'relative' }}>
                          <button
                            onClick={() => setConfirmDeleteId(confirmDeleteId === item.id ? null : item.id)}
                            style={{ all: 'unset', cursor: 'pointer', padding: 4, borderRadius: 8, color: T.ink3 }}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                          {confirmDeleteId === item.id && (
                            <div style={{
                              position: 'absolute', right: 0, top: 32, zIndex: 20,
                              borderRadius: 14, padding: 12, width: 180,
                              background: `linear-gradient(180deg, ${T.surface}, ${T.surface2})`,
                              boxShadow: T.clay,
                            }}>
                              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: T.ink1 }}>Bu grubu kaldır?</p>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  onClick={() => { deletePickingItem(item.stokKodu); setConfirmDeleteId(null); }}
                                  style={{
                                    all: 'unset', cursor: 'pointer', flex: 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                    padding: '7px 0', borderRadius: T.rsm, fontSize: 12, fontWeight: 700,
                                    background: '#B91C1C', color: '#fff',
                                  }}
                                >
                                  <Trash2 className="w-3 h-3" /> Kaldır
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  style={{
                                    all: 'unset', cursor: 'pointer', flex: 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: '7px 0', borderRadius: T.rsm, fontSize: 12, fontWeight: 600,
                                    background: T.surface2, boxShadow: T.clayInset, color: T.ink2,
                                  }}
                                >
                                  İptal
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Collapsible content */}
                    {!isCollapsed && (
                      <div style={{ position: 'relative' }}>
                        {/* Counters + image */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
                            {[
                              { label: 'Gerekli', value: item.needed, color: T.ink1 },
                              { label: 'Toplanan', value: item.scannedCount, color: item.scannedCount > 0 ? '#4E9E6B' : T.ink1 },
                              { label: 'Depoda', value: item.totalInDepot, color: item.totalInDepot === 0 ? '#B91C1C' : T.ink1 },
                            ].map(stat => (
                              <div key={stat.label} style={{
                                padding: '8px 12px', textAlign: 'center', borderRadius: 12,
                                background: T.surface2, boxShadow: T.clayInset, minWidth: 64, flex: 1,
                              }}>
                                <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.label}</p>
                                <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: stat.color, lineHeight: 1.3 }}>{stat.value}</p>
                              </div>
                            ))}
                          </div>
                          {item.cihazGrubuImageUrl && (
                            <div className="flex-shrink-0 hidden sm:block">
                              <SimpleProductThumb src={item.cihazGrubuImageUrl} alt={item.cihazGrubu || ''} size={56} />
                            </div>
                          )}
                        </div>

                        {/* Recommendation chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                          {item.lotNumarasi !== 'STOK YOK' && (item.lotNumarasi || (item.miad && item.miad !== '-')) && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: T.rpill, fontSize: 11, fontWeight: 600, background: 'rgba(224,163,62,0.12)', color: '#B45309' }}>
                              Öneri:
                              {item.lotNumarasi && ` Lot ${item.lotNumarasi}`}
                              {item.lotNumarasi && item.miad && item.miad !== '-' && ' • '}
                              {item.miad && item.miad !== '-' && `Miad ${formatMiad(item.miad)}`}
                            </span>
                          )}
                          {item.rafAdresiOnerilen && item.rafAdresiOnerilen !== '-' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: T.rpill, fontSize: 11, fontWeight: 600, background: 'rgba(144,136,114,0.10)', color: T.ink2 }}>
                              Raf: {item.rafAdresiOnerilen}
                            </span>
                          )}
                          {item.isInsufficient && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: T.rpill, fontSize: 11, fontWeight: 700, background: 'rgba(185,28,28,0.10)', color: '#B91C1C' }}>
                              <AlertTriangle className="w-3 h-3" /> Yetersiz: {item.totalInDepot}
                            </span>
                          )}
                        </div>

                        {/* Last transfer meta */}
                        <div style={{ marginTop: 8 }}>
                          <LastTransferLine date={lastTransferDates[item.stokKodu]} className="!text-[11px]" />
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Scan feed (desktop only) */}
        <aside className="hidden lg:block w-80 xl:w-96 flex-shrink-0 space-y-3">
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Son Okutmalar</p>
          <div style={{
            borderRadius: T.r, padding: 16,
            background: `linear-gradient(180deg, ${T.surface}, ${T.surface2})`,
            boxShadow: T.clay,
            maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {scanFeed.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: T.ink3 }}>
                <ScanBarcode style={{ width: 30, height: 30, margin: '0 auto 8px', opacity: 0.3 }} />
                <p style={{ margin: 0, fontSize: 12 }}>Henüz okutma yok</p>
                <p style={{ margin: '4px 0 0', fontSize: 11 }}>Barkod okuyucu ile taramaya başlayın</p>
              </div>
            ) : (
              scanFeed.map(evt => (
                <div
                  key={evt.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: T.rsm,
                    background: evt.ok ? 'rgba(111,181,133,0.10)' : 'rgba(185,28,28,0.07)',
                  }}
                >
                  {evt.ok ? (
                    <CheckCircle2 style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: '#4E9E6B' }} />
                  ) : (
                    <XCircle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, color: '#B91C1C' }} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: evt.ok ? '#4E9E6B' : '#B91C1C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {evt.message}
                    </p>
                    <p style={{ margin: 0, fontSize: 10.5, color: T.ink3 }}>
                      {new Date(evt.ts).toLocaleTimeString('tr-TR')}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Issues / exceptions summary */}
          {enrichedList.some(i => i.isOutOfStock || i.isInsufficient) && (
            <>
              <p style={{ margin: '14px 0 6px', fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Sorunlar</p>
              <div style={{
                borderRadius: T.rsm, padding: '10px 14px',
                background: `linear-gradient(180deg, ${T.surface}, ${T.surface2})`,
                boxShadow: T.clay, display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                {enrichedList.filter(i => i.isOutOfStock).map(i => (
                  <div key={`issue-${i.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: T.rsm, background: 'rgba(185,28,28,.06)' }}>
                    <XCircle style={{ width: 13, height: 13, flexShrink: 0, color: '#B91C1C' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#B91C1C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.stokAdi} – Stok yok</span>
                  </div>
                ))}
                {enrichedList.filter(i => i.isInsufficient && !i.isOutOfStock).map(i => (
                  <div key={`issue-${i.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: T.rsm, background: 'rgba(217,119,6,.08)' }}>
                    <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, color: '#D97706' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#D97706', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.stokAdi} – Yetersiz ({i.totalInDepot}/{i.needed})</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ── Mobile sticky bottom CTA ── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 sm:hidden"
        style={{
          background: T.surface,
          borderTop: `1px solid rgba(90,72,40,0.08)`,
          boxShadow: '0 -8px 28px rgba(150,128,96,0.16)',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
          <div>
            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: T.ink2 }}>
              {remainingCount > 0 ? `${remainingCount} grup kaldı` : 'Tüm gruplar tamam'}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 800, color: T.ink1 }}>
              {totalScanned}/{totalNeeded} toplanan
            </p>
          </div>
          <button
            onClick={commitTransfer}
            disabled={!isTransferReady}
            style={{
              all: 'unset', cursor: isTransferReady ? 'pointer' : 'not-allowed',
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '11px 20px', borderRadius: 20, fontSize: 13.5, fontWeight: 800,
              background: isTransferReady
                ? 'linear-gradient(180deg, #8FD3A6 0%, #6FB585 100%)'
                : T.surface2,
              boxShadow: isTransferReady
                ? 'inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 20px -8px rgba(111,181,133,0.5)'
                : 'inset 0 2px 5px rgba(178,160,128,0.30)',
              color: isTransferReady ? '#fff' : T.ink3,
              opacity: isTransferReady ? 1 : 0.7,
              transition: `all 300ms cubic-bezier(.22,1,.36,1)`,
            }}
          >
            {isProcessing ? <Loader2 style={{ width: 15, height: 15, animation: 'tplWaterRise 1s linear infinite' }} /> : <Truck style={{ width: 15, height: 15 }} />}
            Transfer Et
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
