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
import type { Order, DepoStokItem, ProductCode, PickingListItem as PickingListItemType, Shipment, ShipmentItem, DeviceGroup, Hospital, Depot } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, updateDoc, writeBatch, serverTimestamp, query, where, getDocs, Timestamp, addDoc, limit, orderBy, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
import { useAuth } from '@/contexts/auth-context';
import { useLoading } from '@/contexts/loading-context';
import { parse as parseDate, compareAsc } from 'date-fns';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';

import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Info, Truck, Trash2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { cn, generateId, playFeedback } from '@/lib/utils';
import { emitFefoOverride } from '@/lib/notifications';
import { maybeAutoPrintTutanak } from '@/lib/tutanak-autoprint';
import { formatMiad, toDateFromAny } from '@/lib/date';
import { resolveEffectiveTrackingMode, TrackingMode } from '@/lib/tracking';
import type { ParsedGeneric } from '@/lib/barcode';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { siparisToplamaLogger } from '@/lib/logger';


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
  const safeSrc = src ? (src.startsWith('/') ? src : `/${src}`) : '/images/placeholders/product.png';
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
  const { currentUser, currentUserProfile } = useAuth();
  const { parseAnyBarcode, resolveProductFromParsed, formats: barcodeFormats } = useBarcodeParser();
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
        const depoStokData = depoStokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
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
            const itemsToTakeCount = Math.min(neededForThisOrderItem ?? 0, itemsInGroup.length);

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
  }, [orderId, router, toast]);

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
    toast({ title: 'Okutuldu', description: `${product?.stokAdi || orderItemStokKodu}` });
  }, [toast, productCodes]);

  const handleScan = useCallback(async (code: string) => {
    // Scan lock to prevent race conditions from rapid sequential scans
    if (scanLockRef.current) {
      siparisToplamaLogger.debug('Tarama kilidi aktif, barkod atlandı', { code });
      return;
    }
    scanLockRef.current = true;
    try {
      const parsed = parseAnyBarcode(code, barcodeFormats);

      if (!parsed) {
          const stockItem = depoStok.find(item => item.seriNumarasi === code && item.depotId === order?.depotId && !item.isShipped);
          if (stockItem) {
              const pickItem = pickingList.find(it => it.stokKodu === stockItem.stokKodu);
              if (!pickItem) {
                   toast({ title: 'Hata', description: `Bu ürün (${stockItem.stokAdi}) toplama listesinde değil.`, variant: 'destructive' });
                   return;
              }
              addScannedSerial(stockItem.stokKodu || '', code);
          } else {
              toast({ title: 'Hata', description: 'Barkod formatı geçersiz veya tanınmıyor.', variant: 'destructive' });
          }
          return;
      }

      const resolved = resolveProductFromParsed(parsed, productCodes);
      const { product, stokKodu, seriNumarasi, lotNumarasi } = resolved;

      if (!product || !stokKodu) {
          toast({ title: 'Hata', description: 'Barkod bir ürünle eşleşmedi.', variant: 'destructive' });
          return;
      }

      const pickItemForProduct = pickingList.find(it => it.stokKodu === stokKodu);
      if (!pickItemForProduct) {
          toast({ title: 'Hata', description: `Bu ürün (${product.stokAdi}) toplama listesinde değil.`, variant: 'destructive' });
          return;
      }

      // Use effective tracking mode based on actual barcode content (like direct transfer)
      const matchedFormat = parsed.matchedFormatId
        ? barcodeFormats.find(f => f.id === parsed.matchedFormatId)
        : undefined;
      const mode = resolveEffectiveTrackingMode(resolved, matchedFormat, product as any);

      if (mode === 'serial' || (mode as string) === 'serial_and_lot') {
        if (!seriNumarasi) {
          toast({ title: 'Hata', description: 'Seri no takipli ürün için barkod seri no içermiyor.', variant: 'destructive' });
          return;
        }
        const stockEntry = depoStok.find(item =>
          item.seriNumarasi === seriNumarasi && item.depotId === order?.depotId && !item.isShipped
        );
        if (!stockEntry) {
          toast({ title: 'Hata', description: `Seri ${seriNumarasi} stoğu bulunamadı veya sevk edilmiş.`, variant: 'destructive' });
          return;
        }
        if (Object.values(scannedSerials).flat().includes(seriNumarasi)) {
          toast({ title: 'Uyarı', description: 'Bu seri numarası zaten okutulmuş.', variant: 'default' });
          return;
        }
        const totalNeededForProduct = pickingList.filter(it => it.stokKodu === stokKodu).reduce((sum, item) => sum + (item.adetIstenen ?? 0), 0);
        const currentScannedForProduct = scannedSerials[stokKodu] || [];
        if (currentScannedForProduct.length >= totalNeededForProduct) {
          toast({ title: 'Uyarı', description: `Bu ürün için istenen adete ulaşıldı.`, variant: 'default' });
          return;
        }

        // FEFO check: show info toast but DO NOT block scanning.
        // The suggested lot is just a recommendation - accept any lot/serial.
        const suggestion = pickingList.find(pl => pl.stokKodu === stokKodu);
        const expectedLot = suggestion?.lotNumarasi;
        if (expectedLot && stockEntry.lotNumarasi !== expectedLot) {
          siparisToplamaLogger.info('FEFO uyarısı: farklı lot okutuldu (engellenmedi)', {
            stokKodu,
            seriNumarasi,
            scannedLot: stockEntry.lotNumarasi,
            suggestedLot: expectedLot,
          });
          toast({
            title: 'FEFO Bilgi',
            description: `Önerilen lot: ${expectedLot}, okutulan lot: ${stockEntry.lotNumarasi}. Ürün eklendi.`,
            variant: 'default',
          });
        }
        addScannedSerial(stokKodu, seriNumarasi);
      } else { // Lot/Quantity logic
          // Accept any lot - first try to find a matching picking group,
          // then fall back to any group for this product that still needs items
          const totalNeededForProduct = pickingList.filter(it => it.stokKodu === stokKodu).reduce((sum, item) => sum + (item.adetIstenen ?? 0), 0);
          const currentScannedForProduct = (scannedSerials[stokKodu] || []);
          if (currentScannedForProduct.length >= totalNeededForProduct) {
            toast({ title: 'Uyarı', description: `Bu ürün için istenen adete ulaşıldı.`, variant: 'default' });
            return;
          }

          // Find any group for this product that still has capacity
          const groupToIncrement = pickingList.find(pl =>
              pl.stokKodu === stokKodu &&
              currentScannedForProduct.filter(s => s.startsWith(`${pl.lotNumarasi}-`)).length < (pl.adetIstenen ?? 0)
          );

          if (!groupToIncrement) {
              toast({ title: 'Hata', description: `Bu ürün (${stokKodu}) için uygun veya adeti eksik bir toplama grubu bulunamadı.`, variant: 'destructive' });
              return;
          }

          const scannedCount = currentScannedForProduct.filter(s => s.startsWith(`${groupToIncrement.lotNumarasi}-`)).length;
          addScannedSerial(stokKodu, `${groupToIncrement.lotNumarasi}-${scannedCount + 1}`);
      }
    } finally {
      scanLockRef.current = false;
    }
  }, [order, scannedSerials, toast, depoStok, pickingList, addScannedSerial, parseAnyBarcode, productCodes, resolveProductFromParsed, barcodeFormats]);
  
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
  
    const flatScannedSerials = Object.values(scannedSerials).flat();
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
    
      const itemsToShip: DepoStokItem[] = [];
      for (const serialOrIdentifier of flatScannedSerials) {
          let stockItem = depoStok.find(item => item.seriNumarasi === serialOrIdentifier && item.depotId === order.depotId);
          if (!stockItem) {
              const [lot, _] = serialOrIdentifier.split('-');
              stockItem = depoStok.find(item => 
                  item.lotNumarasi === lot &&
                  item.depotId === order.depotId &&
                  !itemsToShip.some(shipped => shipped.id === item.id)
              );
          }
          if (stockItem) {
              itemsToShip.push(stockItem);
          }
      }
      
      const shipmentItems: ShipmentItem[] = [];
      const shippedQuantities: Record<string, number> = {};
  
      itemsToShip.filter(item => item.stokKodu).forEach(item => {
          const key = item.stokKodu!;
          shippedQuantities[key] = (shippedQuantities[key] || 0) + 1;
      });
  
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
  
      const shipmentDocRef = doc(collection(db, 'shipments'));
      const newShipment: Omit<Shipment, 'id'> = {
          orderId: order.id,
          depotId: order.depotId!,
          depotName: currentDepot.name || '',
          recipientHospital: order.kurumAdi,
          userId: currentUser?.uid || 'unknown_user',
          userName: currentUserProfile?.name || currentUser?.email || 'Unknown User',
          timestamp: new Date(),
          items: shipmentItems,
      };
      batch.set(shipmentDocRef, { ...newShipment, timestamp: Timestamp.fromDate(newShipment.timestamp as Date) });
    
      itemsToShip.filter(item => item.id).forEach(item => {
          const stokRef = doc(db, 'depoStok', item.id!);
          batch.update(stokRef, {
              isShipped: true,
              hedefKurum: order.kurumAdi,
              hedefKurumId: order.labId,
              sevkTarihi: serverTimestamp(),
          });
      });
    
      const remainingItems = (order.items || []).map(item => {
          const shippedCount = item.stokKodu ? (shippedQuantities[item.stokKodu] || 0) : 0;
          return {
              ...item,
              adet: (item.adet ?? 0) - shippedCount,
          };
      }).filter(item => item.adet > 0);
  
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
      itemsShippedCount = itemsToShip.length;
      success = true;

      // Find target hospital - try by labId first, then by kurumAdi
      const targetHospital = order.labId
        ? hospitals.find(h => h.id === order.labId)
        : hospitals.find(h => h.name === order.kurumAdi || h.ad === order.kurumAdi);

      await maybeAutoPrintTutanak(db, targetHospital, shipmentDocRef.id, currentUserProfile?.name || currentUser?.email || '');

      // Update labTransferDates collection with last transfer dates (direct client-side write)
      const effectiveLabId = order.labId || targetHospital?.id;
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
            depotName: currentDepot?.name || '',
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
      }
    }
  };

  if (isLoading || !order) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Toplama listesi hazırlanıyor...</span>
      </div>
    );
  }
  
  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/siparisler" />
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
                <CardTitle className="font-headline text-2xl">Toplama İşlemi: {order?.kurumAdi}</CardTitle>
                <CardDescription>Okutulan ürünler otomatik olarak aşağıdaki ilgili gruplara eklenecektir.</CardDescription>
            </div>
            <Button 
                onClick={commitTransfer} 
                disabled={isProcessing || pickingList.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white"
            >
                {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Truck className="mr-2 h-5 w-5" />
                Transfer Et ve Siparişi Kapat
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <h3 className="font-semibold mb-2">Toplanacak Gruplar:</h3>
          <p className="text-sm text-muted-foreground p-2 border rounded-md bg-accent/10 mb-3">
              <Info className="inline h-4 w-4 mr-1 text-primary"/>
              Barkod okuyucu aktif. Toplama listesindeki ürün gruplarına ait barkodları okutarak doğrulayın.
          </p>
          <ScrollArea className="h-[60vh] pr-4">
            <div className="space-y-3">
              {pickingList.length === 0 ? <p className="text-muted-foreground text-center p-4">Bu sipariş için toplanacak ürün bulunamadı veya hepsi toplandı.</p> :
                pickingList.map(item => {
                  const currentScannedForProduct = scannedSerials[(item as any).stokKodu] || [];
                  const scannedCount = currentScannedForProduct.length;
                  
                  const neededForGroup = (item as any).adetIstenen;
                  const isComplete = scannedCount >= neededForGroup;
                  const isOutOfStock = (item as any).lotNumarasi === 'STOK YOK';
                  
                  const availableInLot = depoStok.filter(s => s.depotId === order.depotId && !s.isShipped && s.stokKodu === (item as any).stokKodu && s.lotNumarasi === (item as any).lotNumarasi).length;
                  const totalInDepot = depoStok.filter(s => s.depotId === order.depotId && !s.isShipped && s.stokKodu === (item as any).stokKodu).length;
                  const isInsufficient = !isOutOfStock && availableInLot < neededForGroup;

                  return (
                      <div key={(item as any).id} className={cn(
                          "border rounded-lg p-3 transition-all",
                          isComplete ? "bg-green-500/10 border-green-500/50" :
                          isOutOfStock ? "bg-red-500/10 border-red-500/50 opacity-70" :
                          isInsufficient ? "bg-orange-500/10 border-orange-500/50" : "bg-card"
                      )}>
                          <div className="flex justify-between items-center">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-lg font-semibold">{(item as any).stokAdi}</h4>
                                   <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deletePickingItem((item as any).stokKodu, (item as any).lotNumarasi)}>
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                                  <p className="text-xs text-muted-foreground font-mono">{(item as any).stokKodu}</p>
                                  <div className="mt-1">
                                    <LastTransferLine
                                      date={lastTransferDates[(item as any).stokKodu]}
                                    />
                                  </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-center p-2 border rounded-md min-w-[90px]">
                                  <p className="text-xs text-muted-foreground">Toplanacak</p>
                                  <p className="text-2xl font-bold">{neededForGroup}</p>
                                  <p className="text-xs text-muted-foreground font-mono mt-1">Depo Toplam: {totalInDepot}</p>
                                </div>
                                <div className="text-center p-2 border rounded-md min-w-[90px]">
                                    <p className="text-xs text-muted-foreground">Toplanan</p>
                                    <p className="text-2xl font-bold text-primary">{scannedCount}</p>
                                </div>
                              </div>
                              <div className="flex-shrink-0 w-24 h-24 relative mx-4">
                                {(item as any).cihazGrubuImageUrl && (
                                  <SimpleProductThumb src={(item as any).cihazGrubuImageUrl} alt={(item as any).cihazGrubu || ''} size={96} />
                                )}
                              </div>
                          </div>
                          <div className="text-xs text-muted-foreground mt-2">
                              Öneri: Lot <span className="font-mono">{(item as any).lotNumarasi}</span> | Miad <span className="font-mono">{formatMiad((item as any).miad)}</span> | Raf <span className="font-mono">{(item as any).rafAdresiOnerilen}</span>
                              {isInsufficient && <span className="text-orange-500 font-semibold ml-2"> (Yetersiz Stok: {availableInLot})</span>}
                          </div>
                      </div>
                  )
                })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

    </div>
  );
}
