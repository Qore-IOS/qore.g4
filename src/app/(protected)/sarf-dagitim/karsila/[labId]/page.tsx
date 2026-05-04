'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Building, Search, History, CheckCircle, Loader2 } from 'lucide-react';
import { collection, getDocs, query, where, onSnapshot, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital, Order, Depot, DepoStokItem, OrderItem } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { compareAsc, parse } from 'date-fns';

export default function SarfDagilimPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const [consumableHospitals, setConsumableHospitals] = useState<Hospital[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [fulfillmentModalOpen, setFulfillmentModalOpen] = useState(false);
  const [selectedLabForFulfillment, setSelectedLabForFulfillment] = useState<Hospital | null>(null);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState<string>('');
  const [depotStock, setDepotStock] = useState<DepoStokItem[]>([]);
  const [editedItems, setEditedItems] = useState<Record<string, Record<string, number>>>({});
  const [fulfilling, setFulfilling] = useState(false);

  useEffect(() => {
    const fetchHospitalsAndDepots = async () => {
      setLoading(true);
      try {
        const [hospitalsQuery, depotsQuery] = await Promise.all([
            getDocs(query(collection(db, 'hospitals'), where('isConsumablesHospital', '==', true))),
            getDocs(collection(db, 'depots'))
        ]);
        
        const labs = hospitalsQuery.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hospital));
        labs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setConsumableHospitals(labs);

        const depotList = depotsQuery.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
        setDepots(depotList);
        if (depotList.length > 0 && depotList[0].id) {
            setSelectedDepotId(depotList[0].id);
        }

      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: "Hata", description: "Veriler yüklenemedi.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    
    const unsubRequests = onSnapshot(
      query(collection(db, 'consumableRequests'), where('status', '==', 'pending')),
      (snapshot) => {
        setPendingRequests(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
      }
    );

    fetchHospitalsAndDepots();
    return () => unsubRequests();
  }, [toast]);
  
  useEffect(() => {
    if (!selectedDepotId) {
      setDepotStock([]);
      return;
    }
    const q = query(collection(db, 'depoStok'), where('depotId', '==', selectedDepotId), where('isShipped', '==', false));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setDepotStock(filterByCompanyScope(
        snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
        currentCompanyId,
        isSuperAdmin,
      ));
    }, (err) => {
      console.error(err);
      toast({ title: 'Hata', description: 'Depo stoğu güncellenemedi.', variant: 'destructive'});
    });
    return () => unsubscribe();
  }, [selectedDepotId, toast, currentCompanyId, isSuperAdmin]);

  
  const filteredHospitals = useMemo(() => {
    if (!searchTerm) return consumableHospitals;
    return consumableHospitals.filter(lab => 
      lab.name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [consumableHospitals, searchTerm]);
  
  const pendingRequestsByLab = useMemo(() => {
    return pendingRequests.reduce((acc, req) => {
        if (req.hospitalId) {
            if (!acc[req.hospitalId]) acc[req.hospitalId] = [];
            acc[req.hospitalId].push(req);
        }
        return acc;
    }, {} as Record<string, Order[]>);
  }, [pendingRequests]);

  const openFulfillmentModal = (lab: Hospital) => {
    setSelectedLabForFulfillment(lab);
    setEditedItems({});
    setFulfillmentModalOpen(true);
  };

  const getStockForProduct = (stokKodu: string) => {
    return depotStock.filter(s => s.stokKodu === stokKodu).length;
  };

  const handleQuantityChange = (orderId: string, itemId: string, value: string) => {
    const qty = parseInt(value, 10);
    setEditedItems(prev => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] || {}),
        [itemId]: isNaN(qty) ? 0 : Math.max(0, qty)
      }
    }));
  };

  const handleFulfillRequest = async (request: Order) => {
    if (!selectedDepotId) {
      toast({ title: 'Hata', description: 'Lütfen bir kaynak depo seçin.', variant: 'destructive' });
      return;
    }
    setFulfilling(true);
  
    if (!request.id) {
      toast({ title: 'Hata', description: 'Talep kimliği bulunamadı.', variant: 'destructive' });
      setFulfilling(false);
      return;
    }
    const itemsToFulfill = (request.items || []).filter(item => item.id).map(item => ({
      ...item,
      adet: editedItems[request.id!]?.[item.id!] ?? item.adet
    })).filter(item => item.adet > 0);
  
    if (itemsToFulfill.length === 0) {
      toast({ title: 'Uyarı', description: 'Karşılanacak ürün bulunmuyor.', variant: 'default' });
      setFulfilling(false);
      return;
    }
  
    const batch = writeBatch(db);
    let allocationError = false;
  
    for (const item of itemsToFulfill) {
      const availableItems = depotStock
        .filter(s => s.stokKodu === item.stokKodu)
        .sort((a,b) => {
            try {
                return compareAsc(parse(a.miad as string, 'dd.MM.yyyy', new Date()), parse(b.miad as string, 'dd.MM.yyyy', new Date()))
            } catch { return 0; }
        });
  
      if (availableItems.length < item.adet) {
        toast({ title: 'Yetersiz Stok', description: `${item.stokAdi} için depoda yeterli stok (${availableItems.length}) bulunmuyor. İstenen: ${item.adet}`, variant: 'destructive' });
        allocationError = true;
        break;
      }
  
      const itemsToUpdate = availableItems.slice(0, item.adet);
      itemsToUpdate.filter(s => s.id).forEach(stockItem => {
        batch.update(doc(db, 'depoStok', stockItem.id!), {
          isShipped: true,
          hedefKurum: selectedLabForFulfillment?.name,
          hedefKurumId: selectedLabForFulfillment?.id,
          sevkTarihi: serverTimestamp()
        });
      });
    }
  
    if (allocationError) {
      setFulfilling(false);
      return;
    }
  
    batch.update(doc(db, 'consumableRequests', request.id!), {
      status: 'completed',
      depotId: selectedDepotId,
      items: itemsToFulfill
    });
  
    try {
      await batch.commit();
      toast({ title: 'Başarılı', description: `${request.kurumAdi} talebi karşılandı ve stoktan düşüldü.` });
    } catch (error) {
      console.error("Error fulfilling request:", error);
      toast({ title: 'Hata', description: 'Talep karşılanırken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setFulfilling(false);
    }
  };

  return (
    <>
    <div className="p-4 md:p-6">
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Package className="h-6 w-6 text-primary" />
                            Hastane Sarf Dağıtım
                        </CardTitle>
                        <CardDescription>
                            Bu panel, "Hastane Sarf" olarak işaretlenmiş laboratuvarları listeler.
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                         <Button variant="outline" onClick={() => router.push('/sarf-dagitim/gecmis')}>
                            <History className="mr-2 h-4 w-4" /> Talep Geçmişi
                        </Button>
                        <div className="relative w-full sm:w-auto sm:max-w-xs">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Laboratuvar ara..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                ) : filteredHospitals.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                        {searchTerm ? 'Aramanızla eşleşen laboratuvar bulunamadı.' : '"Hastane Sarf" olarak işaretlenmiş laboratuvar bulunamadı.'}
                    </p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {filteredHospitals.filter(lab => lab.id).map(lab => {
                            const openRequests = pendingRequestsByLab[lab.id!] || [];
                            const openRequestCount = openRequests.length;
                            return (
                            <div key={lab.id} className="flex gap-0.5">
                                <Button
                                    variant="outline"
                                    className="flex-1 h-20 justify-start p-4 rounded-r-none"
                                    onClick={() => router.push(`/sarf-dagitim/${lab.id}`)}
                                >
                                    <Building className="h-6 w-6 mr-4 text-muted-foreground"/>
                                    <span className="text-base text-left">{lab.name}</span>
                                </Button>
                                {openRequestCount > 0 && (
                                    <Button 
                                        variant="secondary" 
                                        className="h-20 w-12 bg-green-500/20 text-green-600 hover:bg-green-500/30 rounded-l-none"
                                        onClick={() => openFulfillmentModal(lab)}
                                        aria-label={`${openRequestCount} açık talebi karşıla`}
                                    >
                                        <div className="flex flex-col items-center">
                                            <CheckCircle className="h-5 w-5"/>
                                            <span className="text-xs font-bold">{openRequestCount}</span>
                                        </div>
                                    </Button>
                                )}
                            </div>
                        )})}
                    </div>
                )}
            </CardContent>
        </Card>
    </div>
    
    <Dialog open={fulfillmentModalOpen} onOpenChange={setFulfillmentModalOpen}>
        <DialogContent className="max-w-4xl">
            <DialogHeader>
                <DialogTitle>Talep Karşılama: {selectedLabForFulfillment?.name}</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div>
                    <Label>Kaynak Depo</Label>
                    <Select value={selectedDepotId} onValueChange={setSelectedDepotId} disabled={loading}>
                        <SelectTrigger className="max-w-xs"><SelectValue placeholder="Depo Seç..." /></SelectTrigger>
                        <SelectContent>
                            {depots.filter(d => d.id).map(d => <SelectItem key={d.id} value={d.id!}>{d.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                
                {selectedLabForFulfillment?.id && (pendingRequestsByLab[selectedLabForFulfillment.id] || []).length > 0 ? (
                    <Accordion type="single" collapsible className="w-full">
                        {(pendingRequestsByLab[selectedLabForFulfillment.id] || []).filter(req => req.id).map(req => (
                            <AccordionItem value={req.id!} key={req.id}>
                                <AccordionTrigger>
                                    <div className="flex justify-between w-full pr-4">
                                        <span>{new Date(req.createdAt as Date).toLocaleString('tr-TR')}</span>
                                        <span>{(req.items || []).reduce((sum: number, i) => sum + (i.adet ?? 0), 0)} adet</span>
                                        <span>Açan: {req.createdBy}</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                   <Table>
                                    <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead>Depo Stoğu</TableHead><TableHead className="w-48">Karşılanacak Adet</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {(req.items || []).filter((item): item is OrderItem & { id: string; stokKodu: string } => !!(item.id && item.stokKodu)).map(item => (
                                            <TableRow key={item.id}>
                                                <TableCell>{item.stokAdi}</TableCell>
                                                <TableCell>{getStockForProduct(item.stokKodu)}</TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        value={editedItems[req.id!]?.[item.id] ?? item.adet}
                                                        onChange={e => handleQuantityChange(req.id!, item.id, e.target.value)}
                                                        min="0"
                                                        max={getStockForProduct(item.stokKodu)}
                                                        className="h-8"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                   </Table>
                                   <div className="text-right mt-4">
                                    <Button onClick={() => handleFulfillRequest(req)} disabled={fulfilling}>
                                        {fulfilling ? <Loader2 className="animate-spin h-4 w-4 mr-2"/> : null}
                                        Bu Talebi Karşıla
                                    </Button>
                                   </div>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                ) : (
                    <p className="text-center text-muted-foreground py-8">Bu laboratuvar için açık talep bulunmuyor.</p>
                )}
            </div>
        </DialogContent>
    </Dialog>
    </>
  );
}