'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PlusCircle, Trash2, Loader2, MapPin } from 'lucide-react';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { AddressDefinition } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { YonetimShell, YonetimHeader, YonetimCard } from '@/components/yonetim-ui/YonetimHub';

export default function AdresTanimlariPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();
  const [addresses, setAddresses] = useState<AddressDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAddress, setNewAddress] = useState({ addressBarcode: '', addressName: '' });

  const fetchAddresses = useCallback(async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'addressDefinitions'));
      setAddresses(filterByCompanyScope(
        snap.docs.map(d => ({ id: d.id, ...d.data() } as AddressDefinition)),
        currentCompanyId,
        isSuperAdmin
      ));
    } catch (e) {
      toast({ title: 'Hata', description: 'Adresler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const handleSave = async () => {
    if (!newAddress.addressBarcode || !newAddress.addressName) {
      toast({ title: 'Hata', description: 'Tüm alanlar zorunludur.', variant: 'destructive' });
      return;
    }
    await addDoc(collection(db, 'addressDefinitions'), withCompanyScope(newAddress, currentUserProfile?.companyId));
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
    <YonetimShell>
      <YonetimHeader
        title="Adres Tanımları"
        description="Depo içindeki raf adreslerini ve barkod karşılıklarını tanımlayın."
        backHref="/yonetim/tanimlar"
        rightAction={
          <Button
            onClick={() => setIsModalOpen(true)}
            disabled={isLoading}
            size="sm"
            style={{
              background: 'var(--mg-accent)',
              color: '#0a0a0c',
              border: 'none',
              fontWeight: 700,
            }}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Yeni Adres
          </Button>
        }
      />

      <YonetimCard padding={0}>
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--mg-border)' }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'var(--mg-danger-soft)',
              color: 'var(--mg-danger)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MapPin size={14} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Tanımlı Adresler
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 7px',
              borderRadius: 6,
              background: 'var(--mg-surface-2)',
              color: 'var(--mg-muted)',
            }}
          >
            {addresses.length}
          </span>
        </div>

        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mg-muted)' }}>
            <Loader2 className="h-6 w-6 animate-spin inline-block" />
          </div>
        ) : addresses.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mg-muted)', fontSize: 13 }}>
            Henüz adres tanımı yok.
          </div>
        ) : (
          <div style={{ maxHeight: 480, overflow: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Adres Barkodu</TableHead>
                  <TableHead>Adres Adı</TableHead>
                  <TableHead className="text-right w-[100px]">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {addresses.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.addressBarcode}</TableCell>
                    <TableCell>{a.addressName}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(a.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </YonetimCard>

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
    </YonetimShell>
  );
}
