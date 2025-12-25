
'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Order, DepoStokItem, ProductCode, PickingListItem as PickingListItemType, Shipment, ShipmentItem, DeviceGroup, Hospital, Depot } from '@/lib/types';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, updateDoc, writeBatch, serverTimestamp, query, where, getDocs, Timestamp, addDoc, limit, orderBy } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import useHidScanner from '@/hooks/useHidScanner';
import { useAuth } from '@/contexts/auth-context';
import { parse as parseDate, compareAsc } from 'date-fns';
import { useBarcodeParser } from '@/hooks/useBarcodeParser';

import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, AlertTriangle, CheckCircle2, Info, Truck, Trash2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import Image from 'next/image';
import { cn, generateId, playFeedback } from '@/lib/utils';
import { emitFefoOverride } from '@/lib/notifications';
import { maybeAutoPrintTutanak } from '@/lib/tutanak-autoprint';
import { formatMiad, toDateFromAny } from '@/lib/date';
import { resolveDefaultTrackingMode, TrackingMode } from '@/lib/tracking';
import type { ParsedGeneric } from '@/lib/barcode';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { updateLabTransferDates } from '@/actions/stokActions';


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
  const orderId = params.orderId as string;
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile } = useAuth();
  const { parseAnyBarcode, resolveProductFromParsed, formats: barcodeFormats } = useBarcodeParser();

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
  const [fefoWarning, setFefoWarning] = useState<{ scannedItem: DepoStokItem, suggestedLot: string, onConfirm: () => void } | null>(null);
  
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
        // Also fetch labTransferDates for this lab-depot combination
        const labTransferDocId = orderData.labId ? `${orderData.labId}_${orderData.depotId}` : null;

        const [productsSnap, depoStokSnap, deviceGroupsSnap, hospitalsSnap, depotSnap, labTransferSnap] = await Promise.all([
          getDocs(collection(db, 'productCodes')),
          getDocs(query(collection(db, 'depoStok'), where('depotId', '==', orderData.depotId), where('isShipped', '==', false))),
          getDocs(collection(db, 'def_deviceGroups')),
          getDocs(collection(db, 'hospitals')),
          getDoc(doc(db, 'depots', orderData.depotId)),
          // Fetch labTransferDates document for this lab-depot combination
          labTransferDocId
            ? getDoc(doc(db, 'labTransferDates', labTransferDocId))
            : Promise.resolve(null),
        ]);

        const productsData = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode));
        const depoStokData = depoStokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
        const deviceGroupsData = deviceGroupsSnap.docs.map(d => ({id: d.id, ...d.data()} as DeviceGroup));
        const hospitalsData = hospitalsSnap.docs.map(d => ({id: d.id, ...d.data()} as Hospital));

        // Get transfer dates from labTransferDates collection (single source of truth)
        const transferDates: Record<string, Date> = {};
        if (labTransferSnap && labTransferSnap.exists()) {
          const labTransferData = labTransferSnap.data();
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
        setLastTransferDates(transferDates);

        if (depotSnap && depotSnap.exists()) {
            setCurrentDepot({ id: depotSnap.id, ...depotSnap.data() } as Depot);
        } else {
            console.warn(`Depot with ID ${orderData.depotId} not found.`);
        }

        setProductCodes(productsData);
        setDepoStok(depoStokData);
        setDeviceGroups(deviceGroupsData);
        setHospitals(hospitalsData);

        // Generate picking list
        const pickingListItems: PickingListItemType[] = [];
        const availableWarehouseStock = depoStokData;

        for (const orderItem of orderData.items) {
          const productInfo = productsData.find(p => p.stokKodu === orderItem.stokKodu);
          let neededForThisOrderItem = orderItem.adet;
          const availableItemsForProduct = availableWarehouseStock
            .filter(ds => ds.stokKodu === orderItem.stokKodu)
            .sort((a,b) => {
              try {
                  return compareAsc(parseDate(a.miad as string, 'dd.MM.yyyy', new Date()), parseDate(b.miad as string, 'dd.MM.yyyy', new Date()))
              } catch { return 0; }
            });
          
          if (availableItemsForProduct.length === 0) {
            pickingListItems.push({
              id: generateId(), orderId: orderData.id, stokKodu: orderItem.stokKodu, stokAdi: orderItem.stokAdi, lotNumarasi: 'STOK YOK', miad: '-', rafAdresiOnerilen: '-', adetIstenen: orderItem.adet, toplananSeriNumaralari: [], cihazGrubu: productInfo?.cihazGrubu || 'Diğer', cihazGrubuImageUrl: deviceGroupsData.find(dg => dg.name === productInfo?.cihazGrubu)?.imageUrl,
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
            if (neededForThisOrderItem <= 0) break;
            const itemsInGroup = stockGroups[groupKey];
            const itemsToTakeCount = Math.min(neededForThisOrderItem, itemsInGroup.length);
                
            if (itemsToTakeCount > 0) {
              const firstItem = itemsInGroup[0];
              pickingListItems.push({
                id: generateId(), orderId: orderData.id, stokKodu: firstItem.stokKodu, stokAdi: productInfo?.stokAdi || firstItem.stokAdi, lotNumarasi: firstItem.lotNumarasi, miad: firstItem.miad as string, rafAdresiOnerilen: firstItem.rafAdresi, adetIstenen: itemsToTakeCount, toplananSeriNumaralari: [], cihazGrubu: productInfo?.cihazGrubu || 'Diğer', cihazGrubuImageUrl: deviceGroupsData.find(dg => dg.name === productInfo?.cihazGrubu)?.imageUrl,
              } as any);
              neededForThisOrderItem -= itemsToTakeCount;
            }
          }
        }
        
        pickingListItems.sort((a, b) => {
            const groupA = (a as any).cihazGrubu || 'zzz';
            const groupB = (b as any).cihazGrubu || 'zzz';
            if (groupA !== groupB) {
                return groupA.localeCompare(groupB);
            }
            return a.stokAdi.localeCompare(b.stokAdi);
        });

        setPickingList(pickingListItems);

      } catch (error) {
        console.error("Error fetching data for picking page:", error);
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
    const parsed = parseAnyBarcode(code, barcodeFormats);
  
    if (!parsed) {
        const stockItem = depoStok.find(item => item.seriNumarasi === code && item.depotId === order?.depotId && !item.isShipped);
        if (stockItem) {
            const pickItem = pickingList.find(it => it.stokKodu === stockItem.stokKodu);
            if (!pickItem) {
                 toast({ title: 'Hata', description: `Bu ürün (${stockItem.stokAdi}) toplama listesinde değil.`, variant: 'destructive' });
                 return;
            }
            addScannedSerial(stockItem.stokKodu, code);
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
  
    const mode = resolveDefaultTrackingMode(product as any);
  
    if (mode === 'serial' || mode === 'serial_and_lot') {
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
      const totalNeededForProduct = pickingList.filter(it => it.stokKodu === stokKodu).reduce((sum, item) => sum + item.adetIstenen, 0);
      const currentScannedForProduct = scannedSerials[stokKodu] || [];
      if (currentScannedForProduct.length >= totalNeededForProduct) {
        toast({ title: 'Uyarı', description: `Bu ürün için istenen adete ulaşıldı.`, variant: 'default' });
        return;
      }
      const suggestion = pickingList.find(pl => pl.stokKodu === stokKodu);
      const expectedLot = suggestion?.lotNumarasi;
      if (stockEntry.lotNumarasi !== expectedLot) {
        setFefoWarning({
          scannedItem: stockEntry,
          suggestedLot: expectedLot || 'Bilinmiyor',
          onConfirm: () => addScannedSerial(stokKodu, seriNumarasi),
        });
        return;
      }
      addScannedSerial(stokKodu, seriNumarasi);
    } else { // Lot/Quantity logic
        const groupToIncrement = pickingList.find(pl => 
            pl.stokKodu === stokKodu &&
            (scannedSerials[stokKodu] || []).filter(s => s.startsWith(`${pl.lotNumarasi}-`)).length < pl.adetIstenen
        );

        if (!groupToIncrement) {
            toast({ title: 'Hata', description: `Bu ürün (${stokKodu}) için uygun veya adeti eksik bir toplama grubu bulunamadı.`, variant: 'destructive' });
            return;
        }

        const scannedCount = (scannedSerials[stokKodu] || []).filter(s => s.startsWith(`${groupToIncrement.lotNumarasi}-`)).length;
        addScannedSerial(stokKodu, `${groupToIncrement.lotNumarasi}-${scannedCount + 1}`);
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
  
      itemsToShip.forEach(item => {
          const key = item.stokKodu;
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
    
      itemsToShip.forEach(item => {
          const stokRef = doc(db, 'depoStok', item.id);
          batch.update(stokRef, {
              isShipped: true,
              hedefKurum: order.kurumAdi,
              hedefKurumId: order.labId,
              sevkTarihi: serverTimestamp(),
          });
      });
    
      const remainingItems = order.items.map(item => {
          const shippedCount = shippedQuantities[item.stokKodu] || 0;
          return {
              ...item,
              adet: item.adet - shippedCount,
          };
      }).filter(item => item.adet > 0);
  
      if (remainingItems.length === 0) {
          batch.update(doc(db, 'orders', order.id), {
              status: 'completed',
              transferredAt: serverTimestamp(),
              transferredById: currentUser?.uid,
              transferredBy: currentUserProfile?.name || currentUser?.email || 'Bilinmeyen Kullanıcı'
          });
      } else {
          batch.update(doc(db, 'orders', order.id), {
              items: remainingItems,
              status: 'toplaniyor'
          });
      }

      await batch.commit();
      itemsShippedCount = itemsToShip.length;
      success = true;
      
      const targetHospital = hospitals.find(h => h.id === order.labId);
      await maybeAutoPrintTutanak(db, targetHospital, shipmentDocRef.id, currentUserProfile?.name || currentUser?.email || '');
      
      // Update labTransferDates collection with last transfer dates
      if (order.labId && order.depotId && shipmentItems.length > 0) {
        await updateLabTransferDates(
          order.labId,
          order.depotId,
          order.kurumAdi,
          currentDepot.name || '',
          shipmentItems,
          currentUserProfile?.name || currentUser?.email
        );
      }

    } catch (e) {
      console.error("Transfer error:", e);
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

      <Dialog open={!!fefoWarning} onOpenChange={(open) => !open && setFefoWarning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="text-amber-500" />FEFO Uyarısı</DialogTitle>
            <DialogDescription>
              Okutulan ürünün miadı, depodaki aynı ürüne ait başka bir lottan daha ileri bir tarihe sahip. Önce miadı yakın olan ürünün tüketilmesi önerilir.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <p><strong>Okutulan Lot:</strong> {fefoWarning?.scannedItem.lotNumarasi} (Miad: {formatMiad(fefoWarning?.scannedItem.miad)})</p>
            <p><strong>Önerilen Lot:</strong> {fefoWarning?.suggestedLot}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFefoWarning(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => { fefoWarning?.onConfirm(); setFefoWarning(null); }}>Yine de Devam Et</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
