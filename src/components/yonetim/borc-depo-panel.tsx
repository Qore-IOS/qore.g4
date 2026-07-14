'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit3, Trash2, Loader2, Building } from 'lucide-react';
import { collection, getDocs, addDoc, setDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { Depot } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { YonetimShell, YonetimHeader, YonetimCard } from '@/components/yonetim-ui/YonetimHub';

export default function BorcDepoPanel() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();
  const [borcDepots, setBorcDepots] = useState<Depot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentDepot, setCurrentDepot] = useState<Partial<Depot> & { companiesInput?: string }>({});

  const fetchBorcDepots = useCallback(async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(scopedQuery('borcDepots', currentCompanyId, isSuperAdmin));
      setBorcDepots(filterByCompanyScope(
        snap.docs.map(d => ({ id: d.id, ...d.data() } as Depot)),
        currentCompanyId,
        isSuperAdmin
      ));
    } catch (e) {
      toast({ title: 'Hata', description: 'Borç depoları yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    fetchBorcDepots();
  }, [fetchBorcDepots]);

  const openModal = (depot?: Depot) => {
    if (depot) {
      setCurrentDepot({ ...depot, companiesInput: depot.companies?.join(', ') || '' });
    } else {
      setCurrentDepot({ name: '', companiesInput: '' });
    }
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!currentDepot.name) {
      toast({ title: 'Hata', description: 'Depo adı boş olamaz.', variant: 'destructive' });
      return;
    }
    const companies = currentDepot.companiesInput?.split(',').map(c => c.trim()).filter(Boolean) || [];
    const depotData: Omit<Depot, 'id'> = { name: currentDepot.name, companies };

    setIsLoading(true);
    try {
      if (currentDepot.id) {
        await setDoc(doc(db, 'borcDepots', currentDepot.id), depotData);
      } else {
        await addDoc(collection(db, 'borcDepots'), withCompanyScope(depotData, currentUserProfile?.companyId));
      }
      toast({ title: 'Başarılı', description: 'Borç deposu kaydedildi.' });
      fetchBorcDepots();
      setIsModalOpen(false);
    } catch (error) {
      toast({ title: 'Hata', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu borç depoyu silmek istediğinizden emin misiniz?')) {
      setIsLoading(true);
      try {
        await deleteDoc(doc(db, 'borcDepots', id));
        toast({ title: 'Silindi', description: 'Borç deposu silindi.', variant: 'destructive' });
        fetchBorcDepots();
      } catch (error) {
        toast({ title: 'Hata', description: 'Silme işlemi başarısız oldu.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <YonetimShell>
      <YonetimHeader
        title="Borç Depo Tanımlama"
        description="Firmalara borç verilen ürünlerin takibi için sanal depolar oluşturun."
        backHref="/yonetim/tanimlar"
        rightAction={
          <Button
            onClick={() => openModal()}
            size="sm"
            disabled={isLoading}
            style={{ background: 'var(--mg-accent)', color: '#0a0a0c', border: 'none', fontWeight: 700 }}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Yeni Borç Depo
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
              background: 'rgba(167,139,250,0.18)',
              color: '#a78bfa',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Building size={14} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Borç Depoları
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 6, background: 'var(--mg-surface-2)', color: 'var(--mg-muted)' }}>
            {borcDepots.length}
          </span>
        </div>

        {isLoading && borcDepots.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Loader2 className="h-6 w-6 animate-spin inline-block" style={{ color: 'var(--mg-muted)' }} />
          </div>
        ) : borcDepots.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mg-muted)', fontSize: 13 }}>
            Henüz borç depo tanımı yok.
          </div>
        ) : (
          <div style={{ maxHeight: 480, overflow: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Depo Adı</TableHead>
                  <TableHead>İlişkili Firmalar</TableHead>
                  <TableHead className="text-right w-[120px]">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {borcDepots.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.companies?.join(', ')}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" onClick={() => openModal(d)}>
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)}>
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
          <DialogHeader>
            <DialogTitle>{currentDepot.id ? 'Borç Depo Düzenle' : 'Yeni Borç Depo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Depo Adı"
              value={currentDepot.name || ''}
              onChange={(e) => setCurrentDepot({ ...currentDepot, name: e.target.value })}
            />
            <Input
              placeholder="İlişkili Firmalar (virgülle ayırın)"
              value={currentDepot.companiesInput || ''}
              onChange={(e) => setCurrentDepot({ ...currentDepot, companiesInput: e.target.value })}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading ? <Loader2 className="animate-spin mr-2" /> : null} Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </YonetimShell>
  );
}
