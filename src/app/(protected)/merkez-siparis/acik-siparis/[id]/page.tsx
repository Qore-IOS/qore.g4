'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';

interface CentralOrderItem {
  stokKodu: string;
  stokAdi: string;
  orderedQty: number;
  receivedQty: number;
  locationType: 'depot' | 'hospital';
  locationId: string;
  locationName: string;
  status?: 'ok' | 'eksik' | 'fazla';
  discrepancyResolved?: boolean;
}

interface CentralOrder {
  id: string;
  status: 'open' | 'completed';
  items: CentralOrderItem[];
  discrepancySummary?: { eksik: number; fazla: number };
}

export default function MerkezSiparisDetayPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<CentralOrder | null>(null);
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [logsCount, setLogsCount] = useState(0);

  useEffect(() => {
    const fetchOrder = async () => {
      if (!params.id) return;
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'centralOrders', params.id));
        if (!snap.exists()) {
          toast({ title: 'Hata', description: 'Sipariş bulunamadı.', variant: 'destructive' });
          return;
        }
        const data = snap.data() as CentralOrder;
        setOrder({ ...data, id: snap.id });

        const logsSnap = await getDocs(collection(db, 'centralOrders', params.id, 'logs'));
        setLogsCount(logsSnap.size);
      } catch (error) {
        console.error(error);
        toast({ title: 'Hata', description: 'Sipariş detayı yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [params.id, toast]);

  const filteredItems = useMemo(() => {
    if (!order) return [];
    return order.items.filter(item => {
      const text = `${item.stokKodu} ${item.stokAdi}`.toLowerCase();
      const matchesSearch = text.includes(search.toLowerCase());
      if (!matchesSearch) return false;
      if (!onlyMissing) return true;
      return item.receivedQty < item.orderedQty;
    });
  }, [order, search, onlyMissing]);

  const updateItemReceived = (index: number, value: string) => {
    if (!order) return;
    const parsed = Number(value);
    const nextItems = [...order.items];
    nextItems[index] = {
      ...nextItems[index],
      receivedQty: Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
    };
    setOrder({ ...order, items: nextItems });
  };

  const writeLog = async (action: string, payload: Record<string, unknown>) => {
    if (!params.id) return;
    await addDoc(collection(db, 'centralOrders', params.id, 'logs'), {
      action,
      payload,
      timestamp: serverTimestamp(),
    });
    setLogsCount(prev => prev + 1);
  };

  const handleAllArrived = async () => {
    if (!order) return;
    const updatedItems = order.items.map(item => ({
      ...item,
      receivedQty: item.orderedQty,
      status: 'ok' as const,
    }));
    const updatedOrder = { ...order, items: updatedItems };
    setOrder(updatedOrder);
    await updateDoc(doc(db, 'centralOrders', order.id), { items: updatedItems });
    await writeLog('all_arrived', { itemCount: updatedItems.length });
    toast({ title: 'Başarılı', description: 'Tüm ürünler teslim alındı olarak işaretlendi.' });
  };

  const handleSaveProgress = async () => {
    if (!order) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'centralOrders', order.id), { items: order.items });
      await writeLog('progress_saved', { itemCount: order.items.length });
      toast({ title: 'Kaydedildi', description: 'Gelen adetler güncellendi.' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Hata', description: 'Güncelleme kaydedilemedi.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleMarkResolved = async (index: number) => {
    if (!order) return;
    const nextItems = [...order.items];
    const item = nextItems[index];
    nextItems[index] = { ...item, discrepancyResolved: true };
    setOrder({ ...order, items: nextItems });
    await updateDoc(doc(db, 'centralOrders', order.id), { items: nextItems });
    await writeLog('discrepancy_resolved', { stokKodu: item.stokKodu });
    toast({ title: 'İşlendi', description: `${item.stokKodu} farkı çözüldü olarak işaretlendi.` });
  };

  const handleCompleteOrder = async () => {
    if (!order) return;

    let eksik = 0;
    let fazla = 0;

    const finalizedItems = order.items.map(item => {
      if (item.receivedQty < item.orderedQty) {
        eksik += 1;
        return { ...item, status: 'eksik' as const };
      }
      if (item.receivedQty > item.orderedQty) {
        fazla += 1;
        return { ...item, status: 'fazla' as const };
      }
      return { ...item, status: 'ok' as const };
    });

    const nextOrder: CentralOrder = {
      ...order,
      status: 'completed',
      items: finalizedItems,
      discrepancySummary: { eksik, fazla },
    };

    setOrder(nextOrder);
    await updateDoc(doc(db, 'centralOrders', order.id), {
      status: 'completed',
      items: finalizedItems,
      discrepancySummary: { eksik, fazla },
      completedAt: serverTimestamp(),
    });
    await writeLog('order_completed', { eksik, fazla });
    toast({ title: 'Tamamlandı', description: 'Sipariş tamamlananlar sekmesine alındı.' });
  };

  if (loading) return <p className="text-sm text-muted-foreground">Yükleniyor...</p>;
  if (!order) return <p className="text-sm text-muted-foreground">Sipariş bulunamadı.</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Merkez Sipariş / Açık Sipariş #{order.id}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleAllArrived}>Tamamı Geldi</Button>
            <Button variant="outline" onClick={handleSaveProgress} disabled={saving}>Ara Kaydet</Button>
            <Button variant="default" onClick={handleCompleteOrder}>Siparişi Tamamla</Button>
            <span className="text-sm text-muted-foreground self-center">Log kaydı: {logsCount}</span>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label>Ürün Ara</Label>
              <Input placeholder="Stok kodu / ürün adı" value={search} onChange={e => setSearch(e.target.value)} className="w-72" />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2">
              <Checkbox checked={onlyMissing} onCheckedChange={v => setOnlyMissing(Boolean(v))} />
              Sadece eksikleri göster
            </label>
          </div>

          <div className="border rounded-md">
            <ScrollArea className="h-[560px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ürün Kodu</TableHead>
                    <TableHead>Ürün Adı</TableHead>
                    <TableHead>Verilen Sipariş</TableHead>
                    <TableHead>Gelen</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const idx = order.items.findIndex(i => i.stokKodu === item.stokKodu && i.locationId === item.locationId);
                    const status = item.receivedQty < item.orderedQty ? 'Eksik' : item.receivedQty > item.orderedQty ? 'Fazla' : 'Tam';
                    return (
                      <TableRow key={`${item.locationType}:${item.locationId}:${item.stokKodu}`}>
                        <TableCell>{item.stokKodu}</TableCell>
                        <TableCell>{item.stokAdi}</TableCell>
                        <TableCell>{item.orderedQty}</TableCell>
                        <TableCell>
                          <Input type="number" min="0" value={item.receivedQty} onChange={e => updateItemReceived(idx, e.target.value)} className="w-28" />
                        </TableCell>
                        <TableCell>{status}{item.discrepancyResolved ? ' (Düzeltildi)' : ''}</TableCell>
                        <TableCell>
                          {(status !== 'Tam' && !item.discrepancyResolved) ? (
                            <Button size="sm" variant="outline" onClick={() => handleMarkResolved(idx)}>Eksik/Fazla Düzeltildi</Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Filtreye uygun ürün bulunamadı.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
