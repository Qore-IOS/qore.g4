
'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, ChangeEvent } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { format as formatDate, parse, compareAsc, isValid } from 'date-fns';
import { tr } from 'date-fns/locale';
import { LiquidGlass } from './ui/LiquidGlass';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Loader2, PlusCircle, Trash2, Download, Upload, Check, FileSpreadsheet, Camera, History, Calculator, Info, ChevronsUpDown, AlertTriangle, Undo } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from '@/contexts/auth-context';
import { Checkbox } from './ui/checkbox';
import * as XLSX from 'xlsx';
import { useRowFocus } from '@/hooks/useRowFocus';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { emitOrderCreatedFromRequest } from '@/lib/notifications';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';


export default function SiparislerPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser, currentUserProfile } = useAuth();
  useRowFocus('focus');

  const [depots, setDepots] = useState<Depot[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [depoStok, setDepoStok] = useState<DepoStokItem[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [manualStockCode, setManualStockCode] = useState<string>('');
  const [manualQty, setManualQty] = useState<number | string>(1);

  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [showBulk, setShowBulk] = useState(false);
  const [selectedBulkDepots, setSelectedBulkDepots] = useState<string[]>([]);
  const [selectedBulkLabs, setSelectedBulkLabs] = useState<string[]>([]);
  
  const [isLabPopoverOpen, setIsLabPopoverOpen] = useState(false);

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
        const q1 = query(
          collection(db, 'orders'),
          where('depotId', '==', selectedDepotId),
          orderBy('createdAt', 'desc')
        );
        unsubscribe = onSnapshot(
          q1,
          (snapshot) => mapSnapshot(snapshot),
          (error) => {
            console.warn('orders listener fallback (no index):', error);
            if (unsubscribe) unsubscribe();
            const q2 = query(collection(db, 'orders'), where('depotId', '==', selectedDepotId));
            unsubscribe = onSnapshot(q2, (snapshot) => mapSnapshot(snapshot));
          }
        );
      } catch (e) {
        console.warn('orders listener error:', e);
        const q2 = query(collection(db, 'orders'), where('depotId', '==', selectedDepotId));
        unsubscribe = onSnapshot(q2, (snapshot) => mapSnapshot(snapshot));
      }
    };
  
    startListener();
    return () => { if (unsubscribe) unsubscribe(); };
  }, [selectedDepotId]);
  

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const [dSnap, hSnap, pSnap, sSnap] = await Promise.all([
          getDocs(collection(db, 'depots')),
          getDocs(collection(db, 'hospitals')),
          getDocs(collection(db, 'productCodes')),
          getDocs(collection(db, 'depoStok')),
        ]);
        const depotList = dSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
        setDepots(depotList);
        setHospitals(hSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
        setProductCodes(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
        setDepoStok(sSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)));
        
        if (dSnap.docs.length > 0) setSelectedDepotId(dSnap.docs[0].id);
      } catch (e) {
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [toast]);


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
    const hospitalName = hospitals.find(h => h.id === selectedLabId)?.name || 'Bilinmeyen Kurum';
    const newOrder: Omit<Order, 'id'> = {
      depotId: selectedDepotId,
      labId: selectedLabId,
      kurumAdi: hospitalName,
      items: orderItems,
      createdAt: new Date(),
      status: 'pending',
      createdBy: currentUserProfile?.name || currentUser?.email || 'Bilinmeyen Kullanıcı',
      createdById: currentUser?.uid || 'unknown',
      transferredAt: null,
    };
    await setDoc(doc(db, 'orders', orderId), {
      ...newOrder,
      id: orderId,
      createdAt: Timestamp.fromDate(newOrder.createdAt as Date),
    });
    
    await emitOrderCreatedFromRequest({
      actor: { uid: currentUserProfile?.uid ?? '', name: currentUserProfile?.name ?? ''},
      orderId: orderId,
      labId: selectedLabId,
      depotId: selectedDepotId,
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
        const have = depoStok.filter(
          st => st.depotId === depotId && !st.isShipped && st.stokKodu === rule.stokKodu
        ).length;
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
        const have = depoStok.filter(
          st => st.isShipped && st.hedefKurum === lab.name && st.stokKodu === rule.stokKodu
        ).length;
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
        header: ['Stok Kodu','Stok Adı','Mevcut Stok','Max Adedi','Sipariş Adeti']
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
      const labStockCount = depoStok.filter(
        st => st.isShipped && st.hedefKurum === hospital.name && st.stokKodu === rule.stokKodu
      ).length;
      const maxValue = rule.max ?? 0;
      const need = maxValue - labStockCount;
  
      if (need > 0) {
        const product = productCodes.find(p => p.stokKodu === rule.stokKodu);
        if (product) {
          const depotStockCount = depoStok.filter(
            st => st.depotId === selectedDepotId && !st.isShipped && st.stokKodu === rule.stokKodu
          ).length;
          
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
  
  const handleDeleteOrder = async (orderId: string) => {
    if (window.confirm('Bu siparişi silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.')) {
      try {
        await deleteDoc(doc(db, 'orders', orderId));
        toast({ title: 'Başarılı', description: 'Sipariş silindi.' });
      } catch (error) {
        console.error('Error deleting order:', error);
        toast({ title: 'Hata', description: 'Sipariş silinirken bir hata oluştu.', variant: 'destructive' });
      }
    }
  };

  return (
    <>
      <div className="p-4 space-y-4">
        <Card>
            <CardHeader className="p-4 flex flex-row items-center gap-4">
                 <div className="flex-1">
                    <Label className="block text-sm font-medium mb-1">Çalışma Deposu</Label>
                    <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={isLoading}>
                        <SelectTrigger><SelectValue placeholder="Depo seçin..." /></SelectTrigger>
                        <SelectContent>
                        {depots.map(d => <SelectItem key={d.id} value={d.id ?? ''}>{d.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-end gap-2">
                    <Button onClick={() => router.push(`/siparis-gecmis?depotId=${selectedDepotId}`)} variant="outline" disabled={!selectedDepotId}>
                        <History className="mr-2 h-4 w-4"/> Geçmiş
                    </Button>
                    <Button onClick={() => router.push('/urun-iade')} variant="outline">
                        <Undo className="mr-2 h-4 w-4"/> Ürün İade
                    </Button>
                    <Button variant="outline" onClick={() => setShowBulk(!showBulk)}>Toplu Sipariş</Button>
                </div>
            </CardHeader>
        </Card>
      
      {showBulk && (
        <LiquidGlass className="p-4 mb-6">
          <CardHeader>
            <CardTitle>Toplu Sipariş</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Depolar</h3>
              <ScrollArea className="h-48 border rounded p-2">
                {depots.map(d => (
                  <div key={d.id} className="flex items-center mb-1">
                    <Checkbox
                      checked={selectedBulkDepots.includes(d.id ?? '')}
                      onCheckedChange={() => toggleSelect(d.id ?? '', selectedBulkDepots, setSelectedBulkDepots)}
                      id={`depot-${d.id ?? ''}`}
                    />
                    <label htmlFor={`depot-${d.id ?? ''}`} className="ml-2">{d.name}</label>
                  </div>
                ))}
              </ScrollArea>
            </div>
            <div>
              <h3 className="text-lg font-medium mb-2">Laboratuvarlar</h3>
              <ScrollArea className="h-48 border rounded p-2">
                {hospitals.map(h => (
                  <div key={h.id} className="flex items-center mb-1">
                    <Checkbox
                      checked={selectedBulkLabs.includes(h.id ?? '')}
                      onCheckedChange={() => toggleSelect(h.id ?? '', selectedBulkLabs, setSelectedBulkLabs)}
                      id={`lab-${h.id ?? ''}`}
                    />
                    <label htmlFor={`lab-${h.id ?? ''}`} className="ml-2">{h.name}</label>
                  </div>
                ))}
              </ScrollArea>
            </div>
          </CardContent>
          <CardFooter className="pt-4">
            <Button onClick={generateBulkOrder} className="w-full">
              Toplu Sipariş Oluştur
            </Button>
          </CardFooter>
        </LiquidGlass>
      )}

      <div className="flex flex-col md:flex-row gap-6">
        <LiquidGlass className="w-full md:w-1/3 p-4">
          <CardHeader className="p-2 flex flex-row justify-between items-center">
            <CardTitle>Sipariş Oluştur</CardTitle>
            <Button onClick={prepareOrder} disabled={orderItems.length === 0 || isProcessing}>
              Oluştur
            </Button>
          </CardHeader>
          <CardContent className="p-2 space-y-4">
            <div>
                <label className="block text-sm font-medium mb-1">Laboratuvar</label>
                <Popover open={isLabPopoverOpen} onOpenChange={setIsLabPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={isLabPopoverOpen}
                      className="w-full justify-between font-normal"
                      disabled={!selectedDepotId || hospitals.length === 0}
                    >
                      {selectedLabId
                        ? hospitals.find((hospital) => hospital.id === selectedLabId)?.name
                        : "Laboratuvar seçin..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Laboratuvar ara..." />
                      <CommandList>
                        <CommandEmpty>Laboratuvar bulunamadı.</CommandEmpty>
                        <CommandGroup>
                          {hospitals.sort((a,b) => (a.name ?? '').localeCompare(b.name ?? '')).map((hospital) => (
                            <CommandItem
                              key={hospital.id}
                              value={hospital.name ?? ''}
                              onSelect={() => {
                                setSelectedLabId(hospital.id ?? '');
                                setIsLabPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedLabId === hospital.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {hospital.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
            </div>
            <div className="space-y-2">
                 <Button onClick={handleMinMaxOrder} disabled={!selectedLabId} className="w-full">
                    <Calculator className="mr-2 h-4 w-4" />
                    Min/Max'a Göre Hesapla
                </Button>
            </div>
            <hr/>
            <div className="space-y-2">
                <Select value={manualStockCode} onValueChange={setManualStockCode}>
                    <SelectTrigger><SelectValue placeholder="Manuel ürün seçin..." /></SelectTrigger>
                    <SelectContent>{productCodes.map(p => <SelectItem key={p.id ?? ''} value={p.stokKodu ?? ''}>{p.stokAdi}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex gap-2">
                    <Input type="number" min="1" value={manualQty} onChange={e => setManualQty(e.target.value)} placeholder="Adet"/>
                    <Button onClick={addManualItem} size="icon"><PlusCircle className="h-4 w-4"/></Button>
                </div>
            </div>
            <ScrollArea className="h-40 border rounded-md p-2">
                {orderItems.map(i => (
                    <div key={i.id} className="flex justify-between items-center p-1 rounded hover:bg-muted">
                       <span className="text-sm truncate" title={i.stokAdi}>{i.stokAdi}</span>
                       <span className="text-sm font-bold">{i.adet}</span>
                       <Button variant="ghost" size="icon" onClick={() => removeItem(i.id ?? '')}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                    </div>
                ))}
            </ScrollArea>
          </CardContent>
        </LiquidGlass>

        <LiquidGlass className="w-full md:w-2/3 p-4">
          <CardHeader className="p-2">
            <CardTitle>Bekleyen Siparişler</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <ScrollArea className="h-[400px]">
              {allOrders.filter(o => o.status !== 'completed').length === 0 ? (
                <p className="text-center text-muted-foreground py-20">Bekleyen sipariş yok.</p>
              ) : (
                <div className="space-y-3">
                  {allOrders.filter(o => o.status !== 'completed').map(order => (
                    <div key={order.id} data-row-id={order.id} className="border p-3 rounded-md bg-background/50">
                      <div className="flex justify-between items-start">
                        <div className="space-y-0.5">
                          <p className="font-semibold">{order.kurumAdi}</p>
                          <p className="text-xs text-muted-foreground">
                            Açan: {order.createdBy || '-'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Oluşturma: {order.createdAt ? formatDate(order.createdAt as Date, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={order.status === 'toplaniyor' ? 'default' : 'secondary'} className="py-1 px-3">
                              {(order.items ?? []).reduce((sum, it) => sum + (Number(it.adet) || 0), 0)} Adet
                          </Badge>
                          <Button size="sm" variant="destructive" onClick={() => handleDeleteOrder(order.id ?? '')} disabled={isProcessing}>
                            <Trash2 className="h-4 w-4"/>
                          </Button>
                          <Button size="sm" onClick={() => startPickingProcess(order)} disabled={isProcessing}>
                            Toplama Başlat
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </LiquidGlass>
      </div>
      </div>
    </>
  );
}
