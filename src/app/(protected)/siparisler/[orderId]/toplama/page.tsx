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
import { collection, doc, getDoc, writeBatch, serverTimestamp, query, where, getDocs, Timestamp, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, matchesCompanyScope, withCompanyScope } from '@/lib/company-scope';
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
        // 1. Fetch Order First to get depotId
        const orderSnap = await getDoc(doc(db, 'orders', orderId));

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

        // 2. Fetch Dependent Data (Depot specific stock, etc.)
        const [productsSnap, depoStokSnap, deviceGroupsSnap, hospitalsSnap, depotSnap] = await Promise.all([
          getDocs(collection(db, 'productCodes')),
          getDocs(query(collection(db, 'depoStok'), where('depotId', '==', orderData.depotId), where('isShipped', '==', false))),
          getDocs(collection(db, 'def_deviceGroups')),
          getDocs(collection(db, 'hospitals')),
          getDoc(doc(db, 'depots', orderData.depotId)),
        ]);

        const productsData = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode));
        const depoStokData = filterByCompanyScope(
          depoStokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
          currentCompanyId,
          isSuperAdmin,
        );
        const deviceGroupsData = deviceGroupsSnap.docs.map(d => ({id: d.id, ...d.data()} as DeviceGroup));
        const hospitalsData = hospitalsSnap.docs.map(d => ({id: d.id, ...d.data()} as Hospital));

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

        for (const orderItem of (orderData.items || [])) {
          const productInfo = productsData.find(p => p.stokKodu === orderItem.stokKodu);
          let neededForThisOrderItem = orderItem.adet ?? 0;
          const availableItemsForProduct = availableWarehouseStock
            .filter(ds => ds.stokKodu === orderItem.stokKodu)
            .sort((a,b) => {
              try {
                  return compareAsc(parseDate(a.miad as string, 'dd.MM.yyyy', new Date()), parseDate(b.miad as string, 'dd.MM.yyyy', new Date()))
              } catch { return 0; }
            });
          
          if (availableItemsForProduct.length === 0) {
            const dgMatch = deviceGroupsData.find(dg => dg.name === productInfo?.cihazGrubu);
            pickingListItems.push({
              id: generateId(), orderId: orderData.id, stokKodu: orderItem.stokKodu || '', stokAdi: orderItem.stokAdi || '', lotNumarasi: 'STOK YOK', miad: '-', rafAdresiOnerilen: '-', adetIstenen: orderItem.adet ?? 0, toplananSeriNumaralari: [], cihazGrubu: productInfo?.cihazGrubu || 'Diğer', cihazGrubuImageUrl: (dgMatch as any)?.imageUrl,
            } as any);
            continue;
          }
          
          const stockGroups = availableItemsForProduct.reduce((acc, item) => {
            const key = `${item.lotNumarasi || ''}-${item.miad || ''}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(item);
            return acc;
          }, {} as Record<string, DepoStokItem[]>);

          const sortedGroupKeys = Object.keys(stockGroups).sort((a, b) => {
            const miadA = a.split('-')[1];
            const miadB = b.split('-')[1];
            try {
              return compareAsc(parseDate(miadA, 'dd.MM.yyyy', new Date()), parseDate(miadB, 'dd.MM.yyyy', new Date()));
            } catch { return 0; }
          });
            
          for (const groupKey of sortedGroupKeys) {
            if ((neededForThisOrderItem ?? 0) <= 0) break;
            const itemsInGroup = stockGroups[groupKey];
            const availableQuantityInGroup = sumStockItemQuantities(itemsInGroup);
            const itemsToTakeCount = Math.min(neededForThisOrderItem ?? 0, availableQuantityInGroup);

            if (itemsToTakeCount > 0) {
              const firstItem = itemsInGroup[0];
              const dgMatch = deviceGroupsData.find(dg => dg.name === productInfo?.cihazGrubu);
              pickingListItems.push({
                id: generateId(), orderId: orderData.id, stokKodu: firstItem.stokKodu || '', stokAdi: productInfo?.stokAdi || firstItem.stokAdi || '', lotNumarasi: firstItem.lotNumarasi || '', miad: (firstItem.miad as string) || '', rafAdresiOnerilen: firstItem.rafAdresi || '', adetIstenen: itemsToTakeCount, toplananSeriNumaralari: [], cihazGrubu: productInfo?.cihazGrubu || 'Diğer', cihazGrubuImageUrl: (dgMatch as any)?.imageUrl,
              } as any);
              neededForThisOrderItem = (neededForThisOrderItem ?? 0) - itemsToTakeCount;
            }
          }
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

          const groupToIncrement = pickingList.find(pl =>
              pl.stokKodu === stokKodu &&
              currentScannedForProduct.filter(s => s.startsWith(`${pl.lotNumarasi}-`)).length < (pl.adetIstenen ?? 0)
          );

          if (!groupToIncrement) {
              pushScanEvent(false, `${product.stokAdi} – uygun toplama grubu yok`);
              return;
          }

          const scannedCount = currentScannedForProduct.filter(s => s.startsWith(`${groupToIncrement.lotNumarasi}-`)).length;
          siparisToplamaLogger.info('Lot/adet takipli ürün okutuldu', {
            orderId: order?.id,
            stokKodu,
            stokAdi: product.stokAdi,
            lotNumarasi: groupToIncrement.lotNumarasi,
            okutulanAdet: scannedCount + 1,
            trackingMode: mode,
          });
          addScannedSerial(stokKodu, `${groupToIncrement.lotNumarasi}-${scannedCount + 1}`);
      }
    } finally {
      scanLockRef.current = false;
    }
  }, [order, scannedSerials, depoStok, pickingList, addScannedSerial, parseAndResolveBarcode, productCodes, barcodeFormats, pushScanEvent]);
  
  useHidScanner({
    enabled: true,
    onScan: ({raw}) => handleScan(raw)
  });

  const deletePickingItem = (itemStokKodu: string, itemLot: string) => {
    setPickingList(prev => prev.filter(item => !(item.stokKodu === itemStokKodu && item.lotNumarasi === itemLot)));
    setScannedSerials(prev => {
        const newScanned = { ...prev };
        delete newScanned[itemStokKodu];
        return newScanned;
    });
    toast({ title: 'Ürün Kaldırıldı', description: `${itemStokKodu} (${itemLot}) toplama listesinden çıkarıldı.` });
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
            const lastDashIdx = serialOrIdentifier.lastIndexOf('-');
            const lot = lastDashIdx > 0 ? serialOrIdentifier.substring(0, lastDashIdx) : serialOrIdentifier;
            stockItem = depoStok.find(item =>
              item.lotNumarasi === lot &&
              item.stokKodu === stokKodu &&
              item.depotId === order.depotId &&
              !item.isShipped &&
              getRemainingQuantity(item) > 0
            );
          } else {
            const lastDashIdx = serialOrIdentifier.lastIndexOf('-');
            const lotFromScan = lastDashIdx > 0 ? serialOrIdentifier.substring(0, lastDashIdx) : null;
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
          batch.update(doc(db, 'orders', order.id), {
              status: 'completed',
              transferredAt: serverTimestamp(),
              transferredById: currentUser?.uid,
              transferredBy: currentUserProfile?.name || currentUser?.email || 'Bilinmeyen Kullanıcı'
          });
      } else if (order.id) {
          batch.update(doc(db, 'orders', order.id), {
              items: remainingItems,
              status: 'toplaniyor'
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
      const transferDocItemsSnap = await getDocs(query(collection(db, 'depoStok'), where('transferId', '==', transferRef.id)));
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

      // Step 2: Verify order was properly updated
      if (order.id) {
        const orderVerifySnap = await getDoc(doc(db, 'orders', order.id));
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

  const enrichedList = useMemo(() => pickingList.map(item => {
    const scannedForProduct = scannedSerials[item.stokKodu] || [];
    const scannedCount = scannedForProduct.length;
    const needed = item.adetIstenen ?? 0;
    const isComplete = scannedCount >= needed;
    const isOutOfStock = item.lotNumarasi === 'STOK YOK';
    const availableInLot = sumStockItemQuantities(depoStok.filter(s => s.depotId === order?.depotId && !s.isShipped && s.stokKodu === item.stokKodu && s.lotNumarasi === item.lotNumarasi));
    const totalInDepot = sumStockItemQuantities(depoStok.filter(s => s.depotId === order?.depotId && !s.isShipped && s.stokKodu === item.stokKodu));
    const isInsufficient = !isOutOfStock && availableInLot < needed;
    const status: 'done' | 'blocked' | 'active' | 'idle' = isComplete ? 'done' : isOutOfStock ? 'blocked' : scannedCount > 0 ? 'active' : 'idle';
    const pct = needed > 0 ? Math.round((scannedCount / needed) * 100) : 0;
    return { ...item, scannedCount, needed, isComplete, isOutOfStock, availableInLot, totalInDepot, isInsufficient, status, pct, cihazGrubu: (item as any).cihazGrubu, cihazGrubuImageUrl: (item as any).cihazGrubuImageUrl };
  }), [pickingList, scannedSerials, depoStok, order?.depotId]);

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

  return (
    <div className="cihaz-shell px-3 py-4 sm:px-5 sm:py-6 pb-28 sm:pb-6" style={{ minHeight: '100dvh' }}>

      {/* ── Back + Header ── */}
      <button
        onClick={() => router.push('/siparisler')}
        className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium mb-4"
        style={{ color: 'var(--dashboard-muted)' }}
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Siparişler
      </button>

      <header className="cihaz-card-strong p-4 sm:p-5 mb-4 sm:mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold truncate" style={{ color: 'var(--dashboard-text)' }}>
              Toplama: {order.kurumAdi}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              {order.depotName && (
                <span className="text-xs font-medium" style={{ color: 'var(--dashboard-muted)' }}>
                  Depo: {order.depotName}
                </span>
              )}
              {order.createdBy && (
                <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                  Açan: {order.createdBy}
                </span>
              )}
              {orderDate && (
                <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                  {orderDate}
                </span>
              )}
              <span className="text-xs" style={{ color: 'var(--dashboard-muted)' }}>
                {pickingList.length} grup · {totalNeeded} adet
              </span>
            </div>
          </div>

          {/* Desktop CTA (hidden on mobile — sticky bar handles it) */}
          <button
            onClick={commitTransfer}
            disabled={!isTransferReady}
            className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: isTransferReady ? '#16A34A' : '#9CA3AF', boxShadow: isTransferReady ? 'var(--dashboard-raised-soft)' : 'none' }}
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            Transfer Et & Kapat
          </button>
        </div>

        {/* Overall progress */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs font-medium mb-1">
            <span style={{ color: 'var(--dashboard-muted)' }}>Genel İlerleme</span>
            <span style={{ color: overallPct === 100 ? '#16A34A' : 'var(--dashboard-text)' }}>
              {totalScanned}/{totalNeeded} ({overallPct}%)
            </span>
          </div>
          <div className="cihaz-pressed h-2.5 overflow-hidden" style={{ borderRadius: 8 }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${overallPct}%`,
                background: overallPct === 100 ? '#16A34A' : 'var(--dashboard-accent)',
              }}
            />
          </div>
        </div>
      </header>

      {/* ── 2-column desktop layout ── */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-5">

        {/* LEFT COLUMN: Group list */}
        <div className="flex-1 min-w-0 space-y-3">

          {/* Scanner status + filter chips */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="cihaz-pressed inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium" style={{ borderRadius: 12, color: '#16A34A' }}>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Barkod okuyucu aktif
            </div>

            <div className="flex gap-1.5">
              {(['all', 'remaining', 'done'] as const).map(f => {
                const labels = { all: 'Tümü', remaining: 'Eksik', done: 'Tamamlanan' };
                const counts = { all: enrichedList.length, remaining: remainingCount, done: doneCount };
                const isActive = groupFilter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setGroupFilter(f)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: isActive ? 'var(--dashboard-surface)' : 'transparent',
                      color: isActive ? 'var(--dashboard-text)' : 'var(--dashboard-muted)',
                      boxShadow: isActive ? 'var(--dashboard-raised-soft)' : 'none',
                    }}
                  >
                    {labels[f]} ({counts[f]})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Group section label */}
          <p className="cihaz-section-label">Toplanacak Gruplar</p>

          {/* Group cards */}
          {filteredList.length === 0 ? (
            <div className="cihaz-card p-8 text-center" style={{ color: 'var(--dashboard-muted)' }}>
              <Package className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">
                {groupFilter === 'done' ? 'Henüz tamamlanan grup yok.' : groupFilter === 'remaining' ? 'Tüm gruplar tamamlandı!' : 'Toplanacak ürün bulunamadı.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredList.map(item => {
                const isCollapsed = item.isComplete && collapsedGroups.has(item.id);
                const isLastScanned = scanFeed[0]?.stokKodu === item.stokKodu && Date.now() - (scanFeed[0]?.ts ?? 0) < 2000;

                return (
                  <article
                    key={item.id}
                    className={cn(
                      'cihaz-card p-3 sm:p-4 transition-all duration-300 relative overflow-hidden',
                      isLastScanned && 'ring-2 ring-offset-1',
                    )}
                    style={{
                      borderLeft: item.status === 'blocked' ? '3px solid #B91C1C' : item.status === 'active' ? '3px solid var(--dashboard-accent)' : item.status === 'done' ? '3px solid #16A34A' : '3px solid transparent',
                      opacity: item.isComplete ? 0.7 : 1,
                      ...(isLastScanned ? { '--tw-ring-color': 'var(--dashboard-accent)' } as any : {}),
                    }}
                  >
                    {/* Top row: name + status badge + actions */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm sm:text-base font-semibold truncate" style={{ color: 'var(--dashboard-text)' }}>
                            {item.stokAdi}
                          </h3>
                          {statusBadge(item.status)}
                        </div>
                        <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--dashboard-muted)' }}>
                          {item.stokKodu}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        {item.isComplete && (
                          <button
                            onClick={() => setCollapsedGroups(prev => {
                              const next = new Set(prev);
                              next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                              return next;
                            })}
                            className="p-1 rounded-lg hover:bg-black/5 transition"
                          >
                            {isCollapsed ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--dashboard-muted)' }} /> : <ChevronUp className="w-4 h-4" style={{ color: 'var(--dashboard-muted)' }} />}
                          </button>
                        )}
                        {/* More menu with delete confirm */}
                        <div className="relative">
                          <button
                            onClick={() => setConfirmDeleteId(confirmDeleteId === item.id ? null : item.id)}
                            className="p-1 rounded-lg hover:bg-black/5 transition"
                          >
                            <MoreHorizontal className="w-4 h-4" style={{ color: 'var(--dashboard-muted)' }} />
                          </button>
                          {confirmDeleteId === item.id && (
                            <div className="absolute right-0 top-8 z-20 cihaz-card-strong p-3 w-48 space-y-2" style={{ borderRadius: 14 }}>
                              <p className="text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>Bu grubu kaldır?</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => { deletePickingItem(item.stokKodu, item.lotNumarasi); setConfirmDeleteId(null); }}
                                  className="flex-1 px-2 py-1.5 rounded-xl text-xs font-semibold text-white"
                                  style={{ background: '#B91C1C' }}
                                >
                                  <Trash2 className="w-3 h-3 inline mr-1" /> Kaldır
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="flex-1 px-2 py-1.5 rounded-xl text-xs font-medium cihaz-pressed"
                                  style={{ color: 'var(--dashboard-muted)' }}
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
                      <>
                        {/* Progress bar */}
                        <div className="mt-2.5">
                          <div className="flex items-center justify-between text-[11px] font-medium mb-1">
                            <span style={{ color: 'var(--dashboard-muted)' }}>Toplanan / Gerekli</span>
                            <span style={{ color: item.isComplete ? '#16A34A' : 'var(--dashboard-text)' }}>
                              {item.scannedCount} / {item.needed}
                            </span>
                          </div>
                          <div className="cihaz-pressed h-1.5 overflow-hidden" style={{ borderRadius: 6 }}>
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${item.pct}%`,
                                background: item.isComplete ? '#16A34A' : item.isInsufficient ? '#D97706' : 'var(--dashboard-accent)',
                              }}
                            />
                          </div>
                        </div>

                        {/* Counters + image */}
                        <div className="flex items-center gap-3 mt-2.5">
                          <div className="flex gap-2 flex-1">
                            <div className="cihaz-pressed px-3 py-1.5 text-center" style={{ borderRadius: 10, minWidth: 70 }}>
                              <p className="text-[10px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>Gerekli</p>
                              <p className="text-lg font-bold" style={{ color: 'var(--dashboard-text)' }}>{item.needed}</p>
                            </div>
                            <div className="cihaz-pressed px-3 py-1.5 text-center" style={{ borderRadius: 10, minWidth: 70 }}>
                              <p className="text-[10px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>Toplanan</p>
                              <p className="text-lg font-bold" style={{ color: item.scannedCount > 0 ? '#16A34A' : 'var(--dashboard-text)' }}>{item.scannedCount}</p>
                            </div>
                            <div className="cihaz-pressed px-3 py-1.5 text-center" style={{ borderRadius: 10, minWidth: 70 }}>
                              <p className="text-[10px] font-medium" style={{ color: 'var(--dashboard-muted)' }}>Depoda</p>
                              <p className="text-lg font-bold" style={{ color: item.totalInDepot === 0 ? '#B91C1C' : 'var(--dashboard-text)' }}>{item.totalInDepot}</p>
                            </div>
                          </div>
                          {item.cihazGrubuImageUrl && (
                            <div className="flex-shrink-0 hidden sm:block">
                              <SimpleProductThumb src={item.cihazGrubuImageUrl} alt={item.cihazGrubu || ''} size={56} />
                            </div>
                          )}
                        </div>

                        {/* Recommendation chips */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                          {item.lotNumarasi && item.lotNumarasi !== 'STOK YOK' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium" style={{ background: 'rgba(245,158,11,.10)', color: '#B45309' }}>
                              Lot: {item.lotNumarasi}
                            </span>
                          )}
                          {item.miad && item.miad !== '-' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium" style={{ background: 'rgba(37,99,235,.08)', color: '#2563EB' }}>
                              Miad: {formatMiad(item.miad)}
                            </span>
                          )}
                          {item.rafAdresiOnerilen && item.rafAdresiOnerilen !== '-' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium" style={{ background: 'rgba(107,114,128,.08)', color: '#6B7280' }}>
                              Raf: {item.rafAdresiOnerilen}
                            </span>
                          )}
                          {item.isInsufficient && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold" style={{ background: 'rgba(185,28,28,.10)', color: '#B91C1C' }}>
                              <AlertTriangle className="w-3 h-3" /> Yetersiz: {item.availableInLot}
                            </span>
                          )}
                        </div>

                        {/* Last transfer meta */}
                        <div className="mt-1.5">
                          <LastTransferLine date={lastTransferDates[item.stokKodu]} className="!text-[11px]" />
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Scan feed (desktop only) */}
        <aside className="hidden lg:block w-80 xl:w-96 flex-shrink-0 space-y-3">
          <p className="cihaz-section-label">Son Okutmalar</p>
          <div className="cihaz-card-strong p-4 space-y-2" style={{ maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto' }}>
            {scanFeed.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--dashboard-muted)' }}>
                <ScanBarcode className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Henüz okutma yok</p>
                <p className="text-[10px] mt-1">Barkod okuyucu ile taramaya başlayın</p>
              </div>
            ) : (
              scanFeed.map(evt => (
                <div
                  key={evt.id}
                  className="flex items-start gap-2 p-2 rounded-xl transition-all"
                  style={{ background: evt.ok ? 'rgba(22,163,74,.06)' : 'rgba(185,28,28,.06)' }}
                >
                  {evt.ok ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#16A34A' }} />
                  ) : (
                    <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#B91C1C' }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" style={{ color: evt.ok ? '#16A34A' : '#B91C1C' }}>
                      {evt.message}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--dashboard-muted)' }}>
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
              <p className="cihaz-section-label">Sorunlar</p>
              <div className="cihaz-card p-3 space-y-2">
                {enrichedList.filter(i => i.isOutOfStock).map(i => (
                  <div key={`issue-${i.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded-xl" style={{ background: 'rgba(185,28,28,.06)' }}>
                    <XCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#B91C1C' }} />
                    <span className="text-xs font-medium truncate" style={{ color: '#B91C1C' }}>{i.stokAdi} – Stok yok</span>
                  </div>
                ))}
                {enrichedList.filter(i => i.isInsufficient && !i.isOutOfStock).map(i => (
                  <div key={`issue-${i.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded-xl" style={{ background: 'rgba(245,158,11,.08)' }}>
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#D97706' }} />
                    <span className="text-xs font-medium truncate" style={{ color: '#D97706' }}>{i.stokAdi} – Yetersiz ({i.availableInLot}/{i.needed})</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ── Mobile scan feed (single last event, shown above sticky CTA) ── */}
      {scanFeed.length > 0 && (
        <div className="fixed bottom-[72px] left-3 right-3 z-30 lg:hidden">
          <div
            className="cihaz-card p-2.5 flex items-center gap-2 animate-in slide-in-from-bottom-2 duration-300"
            style={{ borderRadius: 14 }}
          >
            {scanFeed[0].ok ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#16A34A' }} />
            ) : (
              <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#B91C1C' }} />
            )}
            <p className="text-xs font-medium flex-1 truncate" style={{ color: scanFeed[0].ok ? '#16A34A' : '#B91C1C' }}>
              {scanFeed[0].message}
            </p>
          </div>
        </div>
      )}

      {/* ── Mobile sticky bottom CTA ── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 sm:hidden"
        style={{
          background: 'var(--dashboard-surface)',
          borderTop: '1px solid var(--dashboard-stroke)',
          boxShadow: '0 -4px 20px rgba(0,0,0,.08)',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--dashboard-muted)' }}>
              {remainingCount > 0 ? `${remainingCount} grup kaldı` : 'Tüm gruplar tamam'}
            </p>
            <p className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>
              {totalScanned}/{totalNeeded} toplanan
            </p>
          </div>
          <button
            onClick={commitTransfer}
            disabled={!isTransferReady}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: isTransferReady ? '#16A34A' : '#9CA3AF' }}
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            Transfer Et
          </button>
        </div>
      </div>
    </div>
  );
}
