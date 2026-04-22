
'use client';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, PlusCircle, Trash2, ClipboardPlus, Check, ChevronsUpDown, Unplug, CalendarDays, Wrench, FlaskConical, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import type { Depot, Hospital, ProductCode, MinMaxRule, OrderItem } from '@/lib/types';
import { generateId, playNotificationSound, cn } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { emitOrderCreatedFromRequest } from '@/lib/notifications';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useActiveDutyShifts, useUpcomingDutyShifts } from '@/hooks/useFirebaseQueries';
import type { DutyShift } from '@/lib/types';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';

function formatShiftDate(date: unknown): string {
  const d = date instanceof Date ? date : new Date(date as any);
  return formatDate(d, 'd MMM yyyy', { locale: tr });
}

function DutyScheduleModal({ open, onOpenChange, selectedLabId }: { open: boolean; onOpenChange: (open: boolean) => void; selectedLabId: string | null }) {
  const { data: upcomingShifts = [], isLoading } = useUpcomingDutyShifts(selectedLabId);

  const teknikServisShifts = React.useMemo(() =>
    upcomingShifts.filter((s: DutyShift) => s.role === 'teknik_servis'),
    [upcomingShifts]
  );
  const aplikasyonShifts = React.useMemo(() =>
    upcomingShifts.filter((s: DutyShift) => s.role === 'aplikasyon'),
    [upcomingShifts]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Nöbet Takvimi - Gelecek 30 Gün
          </DialogTitle>
          <DialogDescription>
            Seçili laboratuvara atanmış nöbetçi personel listesi
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Yükleniyor...</span>
            </div>
          ) : upcomingShifts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>Gelecek 30 gün için nöbet kaydı bulunamadı.</p>
            </div>
          ) : (
            <div className="space-y-6 pr-3">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Wrench className="h-4 w-4 text-blue-400" />
                  <h3 className="font-semibold text-sm text-blue-400 uppercase tracking-wider">Teknik Servis</h3>
                </div>
                {teknikServisShifts.length === 0 ? (
                  <p className="text-sm text-muted-foreground pl-6">Atanmış nöbetçi yok</p>
                ) : (
                  <div className="space-y-2 pl-6">
                    {teknikServisShifts.map((shift: DutyShift) => (
                      <div key={shift.id} className="flex items-center justify-between rounded-lg border p-3 bg-blue-500/5 border-blue-500/20">
                        <span className="font-medium text-sm">{shift.userName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatShiftDate(shift.startDate)} - {formatShiftDate(shift.endDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FlaskConical className="h-4 w-4 text-purple-400" />
                  <h3 className="font-semibold text-sm text-purple-400 uppercase tracking-wider">Aplikasyon</h3>
                </div>
                {aplikasyonShifts.length === 0 ? (
                  <p className="text-sm text-muted-foreground pl-6">Atanmış nöbetçi yok</p>
                ) : (
                  <div className="space-y-2 pl-6">
                    {aplikasyonShifts.map((shift: DutyShift) => (
                      <div key={shift.id} className="flex items-center justify-between rounded-lg border p-3 bg-purple-500/5 border-purple-500/20">
                        <span className="font-medium text-sm">{shift.userName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatShiftDate(shift.startDate)} - {formatShiftDate(shift.endDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function DutyInfo({ selectedLabId }: { selectedLabId: string | null }) {
  const { data: activeShifts = [] } = useActiveDutyShifts();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const dutyPersonnel = React.useMemo(() => {
    if (!selectedLabId || !activeShifts.length) return { teknikServis: null, aplikasyon: null };

    const labShifts = activeShifts.filter(shift => shift.laboratoryIds.includes(selectedLabId));
    const teknikServisShift = labShifts.find(s => s.role === 'teknik_servis');
    const aplikasyonShift = labShifts.find(s => s.role === 'aplikasyon');

    return {
      teknikServis: teknikServisShift ? { name: teknikServisShift.userName } : null,
      aplikasyon: aplikasyonShift ? { name: aplikasyonShift.userName } : null,
    };
  }, [selectedLabId, activeShifts]);

  if (!selectedLabId) return null;

  const hasDutyPersonnel = dutyPersonnel.teknikServis || dutyPersonnel.aplikasyon;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="hidden md:flex items-center gap-4 text-foreground cursor-pointer hover:opacity-80 transition-opacity rounded-lg px-3 py-1.5 hover:bg-white/5"
      >
        <span className="text-base opacity-70 font-semibold text-foreground">Nöbetçi</span>
        {hasDutyPersonnel ? (
          <>
            {dutyPersonnel.teknikServis && (
              <div className="flex items-center gap-2 duty-glow-text">
                <Wrench className="h-5 w-5 text-blue-400 flex-shrink-0" />
                <span className="whitespace-nowrap font-bold text-xl tracking-wide">{dutyPersonnel.teknikServis.name}</span>
              </div>
            )}
            {dutyPersonnel.teknikServis && dutyPersonnel.aplikasyon && (
              <span className="opacity-30 text-xl">|</span>
            )}
            {dutyPersonnel.aplikasyon && (
              <div className="flex items-center gap-2 duty-glow-text">
                <FlaskConical className="h-5 w-5 text-purple-400 flex-shrink-0" />
                <span className="whitespace-nowrap font-bold text-xl tracking-wide">{dutyPersonnel.aplikasyon.name}</span>
              </div>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground italic">Atanmış nöbetçi yok</span>
        )}
      </button>
      <DutyScheduleModal open={isModalOpen} onOpenChange={setIsModalOpen} selectedLabId={selectedLabId} />
    </>
  );
}


export default function UrunTalepPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, currentUserProfile } = useAuth();
  const [loading, setLoading] = useState(true);

  // Master Data
  const [depots, setDepots] = useState<Depot[]>([]);
  const [allHospitals, setAllHospitals] = useState<Hospital[]>([]);
  const [allProducts, setAllProducts] = useState<ProductCode[]>([]);

  // Selections
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [labMinMaxRules, setLabMinMaxRules] = useState<MinMaxRule[]>([]);

  // Order Basket
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);


  // Derived Data
  const userHospitals = React.useMemo(() => {
    if (currentUserProfile?.role === 'admin') return allHospitals;
    return allHospitals.filter(h => currentUserProfile?.assignedLaboratories?.includes(h.id));
  }, [allHospitals, currentUserProfile]);

  const selectedLab = React.useMemo(
    () => userHospitals.find(h => h.id === selectedLabId) ?? null,
    [userHospitals, selectedLabId]
  );

  const isPeripheralFlow = selectedLab?.perifer === true;

  // Auto-select: if the user is assigned to exactly one lab and it is perifer,
  // pick it immediately so the user never sees the lab picker.
  useEffect(() => {
    if (selectedLabId) return;
    if (userHospitals.length !== 1) return;
    const only = userHospitals[0];
    if (only?.perifer && only.id) {
      setSelectedLabId(only.id);
    }
  }, [userHospitals, selectedLabId]);

  const availableProducts = React.useMemo(() => {
    const ruleStockCodes = new Set(labMinMaxRules.map(r => r.stokKodu));
    return allProducts.filter(p => ruleStockCodes.has(p.stokKodu));
  }, [labMinMaxRules, allProducts]);
  
  // Data Fetching
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [depotSnap, hospitalSnap, productSnap] = await Promise.all([
        getDocs(collection(db, 'depots')),
        getDocs(collection(db, 'hospitals')),
        getDocs(collection(db, 'productCodes')),
      ]);
      setDepots(depotSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)));
      setAllHospitals(hospitalSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
      setAllProducts(productSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
    } catch (err) {
      console.error('Error fetching initial data:', err);
      toast({ title: 'Hata', description: 'Gerekli veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch Min-Max rules when a lab is selected
  useEffect(() => {
    if (!selectedLabId) {
      setLabMinMaxRules([]);
      setOrderItems([]);
      return;
    }
    const fetchRules = async () => {
      setLoading(true);
      try {
        const rulesSnap = await getDocs(
          collection(db, 'hospitals', selectedLabId, 'minMaxRules')
        );
        setLabMinMaxRules(rulesSnap.docs.map(d => d.data() as MinMaxRule));
      } catch (err) {
        console.error('Error fetching min-max rules:', err);
        setLabMinMaxRules([]);
        toast({ title: 'Hata', description: 'Bu laboratuvar için Min-Max kuralları alınamadı.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    fetchRules();
  }, [selectedLabId, toast]);

  // Handlers
  const addOrderItem = () => {
    const product = allProducts.find(p => p.id === selectedProductId);
    if (!product || quantity <= 0) {
      toast({ title: 'Geçersiz Giriş', description: 'Lütfen ürün seçin ve geçerli bir adet girin.', variant: 'destructive' });
      return;
    }
    
    setOrderItems(prev => {
      const existing = prev.find(item => item.stokKodu === product.stokKodu);
      if (existing) {
        return prev.map(item =>
          item.stokKodu === product.stokKodu
            ? { ...item, adet: item.adet + quantity }
            : item
        );
      }
      return [
        ...prev,
        { id: product.id, stokKodu: product.stokKodu, stokAdi: product.stokAdi, adet: quantity },
      ];
    });
    
    setSelectedProductId('');
    setQuantity(1);
  };
  
  const removeOrderItem = (productId: string) => {
    setOrderItems(prev => prev.filter(item => item.id !== productId));
  };
  
  const createOrderRequest = async () => {
    if (!selectedLabId || orderItems.length === 0) {
      toast({ title: 'Eksik Bilgi', description: 'Laboratuvar ve en az bir ürün seçmelisiniz.', variant: 'destructive' });
      return;
    }
    if (!isPeripheralFlow && !selectedDepotId) {
      toast({ title: 'Eksik Bilgi', description: 'Depo, laboratuvar ve en az bir ürün seçmelisiniz.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const orderId = generateId();
      const labName = allHospitals.find(h => h.id === selectedLabId)?.name || 'Bilinmeyen Kurum';
      const depotName = depots.find(d => d.id === selectedDepotId)?.name || '';

      // Perifer talepleri depo ataması yapmadan kayıt edilir; hangi depoya
      // yönlendirileceğine ofis lojistik sorumlusu karar verir.
      const newOrder: Record<string, any> = {
        id: orderId,
        labId: selectedLabId,
        kurumAdi: labName,
        items: orderItems,
        status: 'pending' as const,
        createdAt: serverTimestamp(),
        createdBy: currentUserProfile?.name || currentUser?.email || 'Unknown User',
        createdById: currentUser?.uid || 'unknown',
        requestSource: isPeripheralFlow ? ('lab_to_office' as const) : ('lab_to_depot' as const),
        isPeripheral: isPeripheralFlow,
        transferredAt: null,
      };
      if (!isPeripheralFlow) {
        newOrder.depotId = selectedDepotId;
        newOrder.depotName = depotName || 'Bilinmeyen Depo';
      } else {
        newOrder.depotId = null;
        newOrder.depotName = null;
      }

      await setDoc(doc(db, 'orders', orderId), newOrder);

      await emitOrderCreatedFromRequest({
        actor: { uid: currentUserProfile?.uid || '', name: currentUserProfile?.name || ''},
        orderId: orderId,
        labId: selectedLabId,
        depotId: isPeripheralFlow ? '' : selectedDepotId,
        audienceHint: {
          userId: currentUserProfile?.uid,
          role: currentUserProfile?.role,
          views: currentUserProfile?.accessibleViews,
          labIds: currentUserProfile?.assignedLaboratories,
          depotIds: currentUserProfile?.assignedDepots,
        }
      });

      playNotificationSound();
      toast({
        title: 'Talep Oluşturuldu',
        description: isPeripheralFlow
          ? 'Talebiniz ofis lojistiğine iletildi.'
          : `Siparişiniz "${depotName}" deposuna iletildi.`,
      });

      // Reset form — but keep the auto-selected peripheral lab so the user can
      // immediately create another request without re-picking it.
      setOrderItems([]);
      if (!(userHospitals.length === 1 && userHospitals[0]?.perifer)) {
        setSelectedLabId('');
        setLabMinMaxRules([]);
      }

    } catch (err) {
      console.error('Error creating order request:', err);
      toast({ title: 'Hata', description: 'Sipariş talebi oluşturulamadı.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/urun-kullanim" />
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardPlus className="h-6 w-6 text-primary" />
                Ürün Talep Paneli
              </CardTitle>
              <CardDescription>
                Yetkili olduğunuz laboratuvarlar için ürün talebi oluşturun.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <DutyInfo selectedLabId={selectedLabId || null} />
              <Button variant="outline" onClick={() => router.push('/urun-talep/gecmis')}>
                <History className="mr-2 h-4 w-4" /> Geçmiş
              </Button>
              <Button variant="outline" onClick={() => router.push('/cihazdan-cikan-kit')}>
                <Unplug className="mr-2 h-4 w-4" /> Cihazdan Çıkan Kit
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {(() => {
            const singleAutoLab =
              userHospitals.length === 1 && userHospitals[0]?.perifer ? userHospitals[0] : null;
            const showLabPicker = !singleAutoLab;
            const showDepotPicker = !isPeripheralFlow;

            if (!showLabPicker && !showDepotPicker && singleAutoLab) {
              return (
                <div className="rounded-md border border-purple-500/30 bg-purple-500/5 px-3 py-2 text-sm">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <FlaskConical className="h-4 w-4 text-purple-400" />
                    {singleAutoLab.name}
                    <span className="text-[10px] font-bold uppercase tracking-wide text-purple-500 px-1.5 py-0.5 rounded bg-purple-500/10">
                      Perifer
                    </span>
                  </span>
                </div>
              );
            }

            return (
              <div
                className={cn(
                  'grid gap-4',
                  showDepotPicker && showLabPicker ? 'md:grid-cols-2' : 'md:grid-cols-1'
                )}
              >
                {showDepotPicker && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Kaynak Depo</label>
                    <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={loading}>
                      <SelectTrigger><SelectValue placeholder="Depo seçin..." /></SelectTrigger>
                      <SelectContent>
                        {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {showLabPicker && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Hedef Laboratuvar</label>
                    <Select value={selectedLabId} onValueChange={setSelectedLabId} disabled={loading || userHospitals.length === 0}>
                      <SelectTrigger><SelectValue placeholder="Laboratuvar seçin..." /></SelectTrigger>
                      <SelectContent>
                        {userHospitals.map(h => (
                          <SelectItem key={h.id} value={h.id}>
                            {h.name}
                            {h.perifer ? ' · Perifer' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            );
          })()}
          
          <Card className="border">
            <CardHeader>
                <CardTitle className="text-lg">Talep Kalemleri</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex gap-2 items-end">
                    <div className="flex-grow">
                        <label className="block text-sm font-medium mb-1">Ürün</label>
                        <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={isProductPopoverOpen}
                              className="w-full justify-between font-normal"
                              disabled={!selectedLabId || availableProducts.length === 0}
                            >
                              {selectedProductId
                                ? availableProducts.find((product) => product.id === selectedProductId)?.stokAdi
                                : "Min-Max tanımlı ürün seçin..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                            <Command>
                              <CommandInput placeholder="Ürün ara..." />
                              <CommandList>
                                <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                                <CommandGroup>
                                  {availableProducts.map((product) => (
                                    <CommandItem
                                      key={product.id}
                                      value={product.stokAdi}
                                      onSelect={() => {
                                        setSelectedProductId(product.id);
                                        setIsProductPopoverOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          selectedProductId === product.id ? "opacity-100" : "opacity-0"
                                        )}
                                      />
                                      {product.stokAdi}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                    </div>
                    <div className="w-24">
                        <label className="block text-sm font-medium mb-1">Adet</label>
                        <Input type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} min="1" />
                    </div>
                    <Button onClick={addOrderItem} disabled={!selectedProductId}><PlusCircle className="h-4 w-4" /></Button>
                </div>

                <ScrollArea className="h-48 mt-4 border rounded-md">
                    <Table>
                        <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead>Adet</TableHead><TableHead></TableHead></TableRow></TableHeader>
                        <TableBody>
                        {orderItems.length === 0 ? (
                            <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Talep listesi boş.</TableCell></TableRow>
                        ) : (
                            orderItems.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>{item.stokAdi} <span className="text-xs text-muted-foreground">({item.stokKodu})</span></TableCell>
                                    <TableCell>{item.adet}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => removeOrderItem(item.id)}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </CardContent>
            <CardFooter>
                <Button onClick={createOrderRequest} disabled={loading || orderItems.length === 0} className="w-full">
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isPeripheralFlow ? 'Talep Oluştur ve Lojistiğe İlet' : 'Talep Oluştur ve Depoya İlet'}
                </Button>
            </CardFooter>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
