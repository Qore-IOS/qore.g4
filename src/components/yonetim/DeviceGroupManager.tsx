'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Edit, Trash2, Loader2, Server } from 'lucide-react';
import { collection, getDocs, addDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { getDeviceImages } from '@/actions/stokActions';
import Image from 'next/image';
import { resolveImageSrc } from '@/lib/image-utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DeviceGroup {
  id: string;
  name: string;
  imageUrl?: string;
}

export default function DeviceGroupManager() {
  const { toast } = useToast();
  const [items, setItems] = useState<DeviceGroup[]>([]);
  const [availableImages, setAvailableImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<Partial<DeviceGroup>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [snap, images] = await Promise.all([
          getDocs(collection(db, 'def_deviceGroups')),
          getDeviceImages()
      ]);
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as DeviceGroup)).sort((a, b) => a.name.localeCompare(b.name)));
      setAvailableImages(images);
    } catch (e) {
      toast({ title: 'Hata', description: `Cihaz grupları yüklenemedi.`, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenModal = (item?: DeviceGroup) => {
    setCurrentItem(item || {});
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!currentItem.name?.trim()) {
        toast({ title: 'Hata', description: 'Grup adı boş olamaz.', variant: 'destructive' });
        return;
    }
    setLoading(true);
    try {
      const dataToSave = {
        name: currentItem.name.trim(),
        imageUrl: currentItem.imageUrl || null,
      };
      if (currentItem.id) {
        await setDoc(doc(db, 'def_deviceGroups', currentItem.id), dataToSave, { merge: true });
      } else {
        await addDoc(collection(db, 'def_deviceGroups'), dataToSave);
      }
      toast({ title: 'Başarılı', description: 'Cihaz grubu kaydedildi.' });
      setNewItemName('');
      fetchData();
      setIsModalOpen(false);
    } catch (e) {
      toast({ title: 'Hata', description: 'Tanım kaydedilemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'def_deviceGroups', id));
      toast({ title: 'Silindi', description: 'Cihaz grubu silindi.', variant: 'destructive' });
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Tanım silinemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };
  
  const [newItemName, setNewItemName] = useState(''); // This state is local to the add functionality now

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Cihaz Grupları</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="flex gap-2 mb-4">
              <Input
                placeholder="Yeni cihaz grubu..."
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                disabled={loading}
              />
              <Button onClick={() => handleOpenModal({ name: newItemName })} disabled={loading || !newItemName.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <ScrollArea className="h-48 border rounded-md p-2">
            {loading && items.length === 0 ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> :
                items.length === 0 ? <p className="text-sm text-center text-muted-foreground p-4">Tanım bulunmuyor.</p> :
                items.map(item => (
                <div key={item.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                    <div className="flex items-center gap-2">
                        {item.imageUrl && <Image src={resolveImageSrc(item.imageUrl)} alt={item.name} width={24} height={24} className="rounded-sm object-contain" />}
                        <span className="text-sm">{item.name}</span>
                    </div>
                    <div className="flex items-center">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenModal(item)} disabled={loading}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} disabled={loading}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                </div>
                ))
            }
            </ScrollArea>
        </CardContent>
      </Card>
      
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentItem.id ? 'Cihaz Grubu Düzenle' : 'Yeni Cihaz Grubu'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label>Grup Adı</label>
              <Input 
                value={currentItem.name || ''} 
                onChange={e => setCurrentItem(p => ({...p, name: e.target.value}))} 
              />
            </div>
            <div>
              <label>Resim</label>
              <Select 
                value={currentItem.imageUrl || ''}
                onValueChange={val => setCurrentItem(p => ({...p, imageUrl: val === 'none' ? undefined : val}))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Resim seçin (opsiyonel)..."/>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Resim Yok —</SelectItem>
                  {availableImages.map(img => (
                    <SelectItem key={img} value={img}>
                      <div className="flex items-center gap-2">
                        <Image src={resolveImageSrc(img)} alt={img} width={20} height={20} className="object-contain" />
                        <span>{img}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {currentItem.imageUrl && (
              <div className="flex justify-center p-2 border rounded-md bg-muted">
                <Image src={resolveImageSrc(currentItem.imageUrl)} alt="Önizleme" width={100} height={100} className="object-contain"/>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={handleSave} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin"/> : "Kaydet"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
