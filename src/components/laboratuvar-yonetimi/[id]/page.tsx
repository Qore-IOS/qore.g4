
'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import type { DepoStokItem, ConsumptionRecord } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { formatMiad } from "@/lib/date";
import TimestampText from '@/components/TimestampText';
import { AlertTriangle } from 'lucide-react';

export default function LabStockDetailPage() {
  const params = useParams();
  const firstId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { toast } = useToast();
  const { currentUserProfile } = useAuth();

  const [items, setItems] = useState<DepoStokItem[]>([]);
  const [parentItem, setParentItem] = useState<DepoStokItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [orphanedId, setOrphanedId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!firstId) {
        setLoading(false);
        return;
    }
    setLoading(true);
    try {
        const firstItemSnap = await getDoc(doc(db, 'depoStok', firstId));
        if (!firstItemSnap.exists()) {
            setOrphanedId(firstId);
            setLoading(false);
            return;
        }
        const parent = { id: firstItemSnap.id, ...firstItemSnap.data() } as DepoStokItem;
        setParentItem(parent);

        // Query using hedefKurumId if available, otherwise fall back to hedefKurum (name)
        const baseConstraints = [
            where('stokKodu', '==', parent.stokKodu),
            where('lotNumarasi', '==', parent.lotNumarasi),
            where('miad', '==', parent.miad),
            where('isShipped', '==', true)
        ];

        let fetchedItems: DepoStokItem[] = [];

        if (parent.hedefKurumId) {
            const q = query(collection(db, 'depoStok'), ...baseConstraints, where('hedefKurumId', '==', parent.hedefKurumId));
            const snap = await getDocs(q);
            fetchedItems = snap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));
        }

        // Also query by hedefKurum (name) for legacy records
        if (parent.hedefKurum) {
            const legacyQ = query(collection(db, 'depoStok'), ...baseConstraints, where('hedefKurum', '==', parent.hedefKurum));
            const legacySnap = await getDocs(legacyQ);
            const legacyItems = legacySnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem));

            const existingIds = new Set(fetchedItems.map(item => item.id));
            legacyItems.forEach(item => {
                if (!existingIds.has(item.id)) {
                    fetchedItems.push(item);
                }
            });
        }

        // CRITICAL FIX: Always include the parent item in the list if it's not already there
        // This ensures orphaned items (with inconsistent data) can still be deleted
        const parentInList = fetchedItems.some(item => item.id === parent.id);
        if (!parentInList) {
            fetchedItems.unshift(parent);
        }

        setItems(fetchedItems);

    } catch (err) {
      console.error("Error fetching lab stock details:", err);
      toast({ title: 'Hata', description: 'Stok detayları yüklenemedi.', variant: 'destructive'});
    } finally {
      setLoading(false);
    }
  }, [firstId, toast]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleForceDeleteOrphan = async () => {
    if (!orphanedId || !currentUserProfile) return;

    if (!confirm('Bu kayıt veritabanında bulunamadı. Referansı temizlemek ve bu sayfadan çıkmak ister misiniz?')) {
      return;
    }

    setIsDeleting(orphanedId);
    try {
      await deleteDoc(doc(db, 'depoStok', orphanedId));
      toast({ title: 'Başarılı', description: 'Kayıt temizlendi.' });
      window.location.href = '/laboratuvar-yonetimi';
    } catch (err) {
      console.error("Error force deleting orphan:", err);
      toast({ title: 'Hata', description: 'Kayıt temizlenemedi.', variant: 'destructive' });
    } finally {
      setIsDeleting(null);
    }
  };

  const handleDeductFromStock = async (itemToDeduct: DepoStokItem) => {
    if (!currentUserProfile) {
        toast({ title: 'Hata', description: 'Bu işlemi yapmak için giriş yapmalısınız.', variant: 'destructive'});
        return;
    }

    const itemIdentifier = itemToDeduct.seriNumarasi
      ? `${itemToDeduct.seriNumarasi} seri numaralı`
      : `${itemToDeduct.lotNumarasi || 'Lot bilgisi yok'} lotlu`;

    if (!confirm(`${itemIdentifier} ürünü stoktan düşmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`)) {
      return;
    }

    const id = itemToDeduct?.id;
    if (!id) {
        toast({
            title: "Kayıt ID bulunamadı",
            description: "Seçilen stok kaleminin kimliği eksik. Lütfen kaydı kontrol edin.",
            variant: "destructive",
        });
        return;
    }

    setIsDeleting(id);

    try {
      const newConsumptionRecord: Omit<ConsumptionRecord, 'id'> = {
        stokKodu: itemToDeduct.stokKodu,
        stokAdi: itemToDeduct.stokAdi,
        lotNumarasi: itemToDeduct.lotNumarasi ?? '',
        miad: formatMiad(itemToDeduct.miad),
        seriNumarasi: itemToDeduct.seriNumarasi ?? '',
        laboratoryId: '', // We don't have the lab ID here, just the name. This might need refinement.
        laboratoryName: itemToDeduct.hedefKurum || 'Bilinmeyen Lab.',
        consumptionTimestamp: new Date(),
        consumptionType: 'sayimdan_dusum', // Or a new type like 'manuel_düşüm'
        userId: currentUserProfile.uid,
        userName: currentUserProfile.name || 'Bilinmeyen Kullanıcı',
      };
      
      const batch = writeBatch(db);
      const consumptionRef = doc(collection(db, 'tuketimKayitlari'));
      const stockRef = doc(db, 'depoStok', id);

      batch.set(consumptionRef, newConsumptionRecord);
      batch.delete(stockRef);

      await batch.commit();
      setItems(prev => prev.filter(item => item.id !== id));
      toast({ title: 'Başarılı', description: `${itemToDeduct.stokAdi} stoktan düşüldü.` });
    } catch (err) {
      console.error("Error deducting stock:", err);
      toast({ title: 'Hata', description: 'Stoktan düşme işlemi sırasında bir hata oluştu.', variant: 'destructive'});
    } finally {
      setIsDeleting(null);
    }
  };


  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary"/></div>;
  }
  
  if (orphanedId) {
    return (
        <div className="p-4 space-y-4">
          <BackButton fallback="/laboratuvar-yonetimi" />
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Hatalı Kayıt Tespit Edildi
              </CardTitle>
              <CardDescription>
                Kayıt ID: <code className="bg-muted px-1 rounded">{orphanedId}</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Bu kayıt veritabanında bulunamadı ancak sistemde referansı hala mevcut.
                Bu durum genellikle veri tutarsızlığından kaynaklanır.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={handleForceDeleteOrphan}
                  disabled={isDeleting === orphanedId}
                >
                  {isDeleting === orphanedId ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Siliniyor...</>
                  ) : (
                    <><Trash2 className="h-4 w-4 mr-2" /> Kaydı Zorla Sil</>
                  )}
                </Button>
                <Button onClick={() => window.location.href = '/laboratuvar-yonetimi'} variant="outline">
                  Geri Dön
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
    );
  }

  if (!parentItem) {
    return (
        <div className="p-4 space-y-4">
          <BackButton fallback="/laboratuvar-yonetimi" />
          <Card>
            <CardContent className="py-8">
              <div className="flex flex-col items-center justify-center text-center space-y-4">
                <div className="text-destructive text-lg font-medium">
                  Ürün bilgisi yüklenemedi veya bulunamadı.
                </div>
                <p className="text-muted-foreground text-sm max-w-md">
                  Bu ürün silinmiş veya stoktan düşürülmüş olabilir.
                  Sayfa yenilenmediği için eski veriler görüntüleniyor olabilir.
                </p>
                <Button onClick={() => window.location.href = '/laboratuvar-yonetimi'} variant="outline">
                  Laboratuvar Yönetimine Dön
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/laboratuvar-yonetimi" />
      <Card>
        <CardHeader>
          <CardTitle className="truncate max-w-full">{parentItem.stokAdi}</CardTitle>
          <CardDescription>
            Stok Kodu: {parentItem.stokKodu} | Lot: {parentItem.lotNumarasi} | Miad: {formatMiad(parentItem.miad)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Bu lot için stok bulunamadı.</p>
          ) : (
            <ScrollArea className="h-[70vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seri Numarası</TableHead>
                    <TableHead>Raf Adresi (Depo)</TableHead>
                    <TableHead>Sevk Tarihi</TableHead>
                    <TableHead className="text-right">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">
                        {item.seriNumarasi || <span className="text-muted-foreground italic">(Seri no yok)</span>}
                      </TableCell>
                      <TableCell>{item.rafAdresi || '-'}</TableCell>
                      <TableCell><TimestampText value={item.sevkTarihi} /></TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeductFromStock(item)}
                          disabled={isDeleting === item.id}
                          title="Stoktan Düş"
                        >
                          {isDeleting === item.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4 text-destructive" />}
                        </Button>
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
  );
}
