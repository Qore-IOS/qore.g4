'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PlusCircle, Trash2, Loader2, MapPin } from 'lucide-react';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { AddressDefinition } from '@/lib/types';
import BackButton from '@/components/BackButton';

export default function AdresTanimlariPanel() {
  const { toast } = useToast();
  const [addresses, setAddresses] = useState<AddressDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAddress, setNewAddress] = useState({ addressBarcode: '', addressName: '' });

  const fetchAddresses = useCallback(async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'addressDefinitions'));
      setAddresses(snap.docs.map(d => ({ id: d.id, ...d.data() } as AddressDefinition)));
    } catch (e) {
      toast({ title: 'Hata', description: 'Adresler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const handleSave = async () => {
    if (!newAddress.addressBarcode || !newAddress.addressName) {
      toast({ title: 'Hata', description: 'Tüm alanlar zorunludur.', variant: 'destructive' });
      return;
    }
    await addDoc(collection(db, 'addressDefinitions'), newAddress);
    toast({ title: 'Başarılı', description: 'Adres tanımı eklendi.' });
    fetchAddresses();
    setIsModalOpen(false);
    setNewAddress({ addressBarcode: '', addressName: '' });
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu adresi silmek istediğinizden emin misiniz?')) {
      await deleteDoc(doc(db, 'addressDefinitions', id));
      toast({ title: 'Silindi', description: 'Adres tanımı silindi.', variant: 'destructive' });
      fetchAddresses();
    }
  };

  return (
    <>
      <div className="p-4 space-y-4">
        <BackButton fallback="/yonetim" />
        <Card className="shadow-lg">
          <CardHeader className="flex flex-row justify-between items-center">
            <div>
              <CardTitle className="text-xl font-headline flex items-center">
                <MapPin className="mr-2 h-6 w-6 text-red-500" />
                Adres Tanımları Yönetimi
              </CardTitle>
              <CardDescription>Depo içindeki raf adreslerini ve barkod karşılıklarını tanımlayın.</CardDescription>
            </div>
            <Button onClick={() => setIsModalOpen(true)} size="sm" disabled={isLoading}>
              <PlusCircle className="mr-2 h-4 w-4" />Yeni Adres
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <ScrollArea className="h-[300px] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Adres Barkodu</TableHead>
                      <TableHead>Adres Adı</TableHead>
                      <TableHead className="text-right">İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {addresses.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono">{a.addressBarcode}</TableCell>
                        <TableCell>{a.addressName}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Yeni Adres Tanımı</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Adres Barkodu"
              value={newAddress.addressBarcode}
              onChange={(e) => setNewAddress({ ...newAddress, addressBarcode: e.target.value })}
            />
            <Input
              placeholder="Adres Adı (Örn: Soğuk Oda - Raf 3)"
              value={newAddress.addressName}
              onChange={(e) => setNewAddress({ ...newAddress, addressName: e.target.value })}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSave}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
