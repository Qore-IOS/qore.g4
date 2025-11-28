
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
import { Loader2, PlusCircle, Trash2, ClipboardPlus, Check, ChevronsUpDown } from 'lucide-react';
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
import { generateId } from '@/lib/utils';
import BackButton from '@/components/BackButton';
import { emitOrderCreatedFromRequest } from '@/lib/notifications';
import { cn } from '@/lib/utils';


export default function UrunTalepPanel() {
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
    if (!selectedDepotId || !selectedLabId || orderItems.length === 0) {
      toast({ title: 'Eksik Bilgi', description: 'Depo, laboratuvar ve en az bir ürün seçmelisiniz.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const orderId = generateId();
      const labName = allHospitals.find(h => h.id === selectedLabId)?.name || 'Bilinmeyen Lab';
      const depotName = depots.find(d => d.id === selectedDepotId)?.name || 'Bilinmeyen Depo';
      
      const newOrder = {
        id: orderId,
        depotId: selectedDepotId,
        depotName: depotName,
        labId: selectedLabId,
        kurumAdi: labName,
        items: orderItems,
        status: 'pending' as const,
        createdAt: serverTimestamp(),
        createdBy: currentUserProfile?.name || currentUser?.email || 'Unknown User',
        createdById: currentUser?.uid || 'unknown',
        requestSource: 'lab_to_depot' as const,
        transferredAt: null,
      };
      
      await setDoc(doc(db, 'orders', orderId), newOrder);
      
      await emitOrderCreatedFromRequest({
        actor: { uid: currentUserProfile?.uid || '', name: currentUserProfile?.name || ''},
        orderId: orderId,
        labId: selectedLabId,
        depotId: selectedDepotId,
        audienceHint: {
          userId: currentUserProfile?.uid,
          role: currentUserProfile?.role,
          views: currentUserProfile?.accessibleViews,
          labIds: currentUserProfile?.assignedLaboratories,
          depotIds: currentUserProfile?.assignedDepots,
        }
      });
      
      toast({ title: 'Talep Oluşturuldu', description: `Siparişiniz "${depotName}" deposuna iletildi.` });
      
      // Reset form
      setOrderItems([]);
      setSelectedLabId('');
      setLabMinMaxRules([]);

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
          <CardTitle className="flex items-center gap-2">
            <ClipboardPlus className="h-6 w-6 text-primary" />
            Ürün Talep Paneli
          </CardTitle>
          <CardDescription>
            Yetkili olduğunuz laboratuvarlar için ürün talebi oluşturun.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Kaynak Depo</label>
              <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={loading}>
                <SelectTrigger><SelectValue placeholder="Depo seçin..." /></SelectTrigger>
                <SelectContent>
                  {depots.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Hedef Laboratuvar</label>
              <Select value={selectedLabId} onValueChange={setSelectedLabId} disabled={loading || userHospitals.length === 0}>
                <SelectTrigger><SelectValue placeholder="Laboratuvar seçin..." /></SelectTrigger>
                <SelectContent>
                  {userHospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          
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
                    Talep Oluştur ve Depoya İlet
                </Button>
            </CardFooter>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
