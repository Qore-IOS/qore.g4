
'use client';
import React, { useState, useEffect } from 'react';
import {
  collection, getDocs, setDoc, doc, deleteDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Device, Hospital } from '@/lib/types';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose
} from '@/components/ui/dialog';
import BackButton from '@/components/BackButton';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { ScrollArea } from './ui/scroll-area';

interface Props {
  images: string[];
  hospitals: Hospital[];
}

export default function CihazTanimlamaClient({ images, hospitals }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [current, setCurrent] = useState<Partial<Device>>({});
  const [customPath, setCustomPath] = useState('');
  const { toast } = useToast();

  const fetchDevices = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'devices'));
    setDevices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Device)));
    setLoading(false);
  };
  useEffect(() => { fetchDevices(); }, []);

  const save = async () => {
    const imageUrl = current.imageUrl || customPath.trim();
    if (!current.brand || !current.model || !imageUrl || !current.seriNumarasi || !current.hospitalId || !current.order) {
      toast({
        title: 'Eksik bilgi',
        description: 'Marka, model, seri numarası, laboratuvar, dizilim sırası ve resim seçilmeli veya yol girilmeli.',
        variant: 'destructive'
      });
      return;
    }
    const id = current.id
      ?? `${current.brand}-${current.model}-${current.seriNumarasi}`.toLowerCase().replace(/\s+/g, '-');
      
    await setDoc(doc(db, 'devices', id), { 
      brand: current.brand,
      model: current.model,
      imageUrl,
      cihazAdi: current.cihazAdi,
      seriNumarasi: current.seriNumarasi,
      hospitalId: current.hospitalId,
      order: current.order
    }, { merge: true });

    toast({ title: 'Kaydedildi', description: 'Cihaz tanımı kaydedildi.' });
    setModalOpen(false);
    fetchDevices();
  };

  const remove = async (id: string) => {
    if (confirm('Bu tanımı silmek istediğinize emin misiniz?')) {
      await deleteDoc(doc(db, 'devices', id));
      toast({ title: 'Silindi', description: 'Cihaz tanımı silindi.', variant: 'destructive' });
      fetchDevices();
    }
  };

  const effectiveImageUrl = current.imageUrl || customPath;

  return (
    <div className="p-8 space-y-6">
      <BackButton fallback="/cihaz-yonetimi-ana"/>
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-headline">Cihaz Tanımlamaları</h1>
        <Button onClick={() => { setCurrent({}); setCustomPath(''); setModalOpen(true); }}>
          + Yeni Cihaz
        </Button>
      </div>

      <ScrollArea className="h-[70vh]">
        <Table>
          <TableHeader>
          <TableRow>
            <TableHead>Marka</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Cihaz Adı</TableHead>
            <TableHead>Seri Numarası</TableHead>
            <TableHead>Laboratuvar</TableHead>
            <TableHead>Sıra</TableHead>
            <TableHead>Resim</TableHead>
            <TableHead>İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && devices.map(dev => (
              <TableRow key={dev.id}>
                <TableCell>{dev.brand}</TableCell>
                <TableCell>{dev.model}</TableCell>
                <TableCell>{dev.cihazAdi}</TableCell>
                <TableCell>{dev.seriNumarasi}</TableCell>
                <TableCell>{hospitals.find(h => h.id === dev.hospitalId)?.name}</TableCell>
                <TableCell>{dev.order}</TableCell>
                <TableCell>
                  {dev.imageUrl ? (
                  <Image
                    src={`/${dev.imageUrl}`}
                    alt={`${dev.brand} ${dev.model}`}
                    width={100}
                    height={100}
                    className="w-24 h-24 object-cover rounded-md"
                  />
                  ) : "Resim Yok"}
                </TableCell>
                <TableCell className="space-x-2">
                  <Button size="sm" onClick={() => {
                    setCurrent(dev);
                    setCustomPath('');
                    setModalOpen(true);
                  }}>Düzenle</Button>
                  <Button variant="destructive" size="sm" onClick={() => remove(dev.id)}>
                    Sil
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{current.id ? 'Cihaz Düzenle' : 'Yeni Cihaz'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Marka"
              value={current.brand || ''}
              onChange={e => setCurrent({ ...current, brand: e.target.value })}
            />
            <Input
              placeholder="Model"
              value={current.model || ''}
              onChange={e => setCurrent({ ...current, model: e.target.value })}
            />
            <Input
              placeholder="Cihaz Adı"
              value={current.cihazAdi || ''}
              onChange={e => setCurrent({ ...current, cihazAdi: e.target.value })}
            />
             <Input
              placeholder="Seri Numarası"
              value={current.seriNumarasi || ''}
              onChange={e => setCurrent({ ...current, seriNumarasi: e.target.value })}
            />
            <Select
              value={current.imageUrl || ''}
              onValueChange={val => {
                setCurrent({ ...current, imageUrl: val });
                setCustomPath('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Mevcut Resimlerden Seçin" />
              </SelectTrigger>
              <SelectContent>
                {images.map(img => (
                  <SelectItem key={img} value={img}>{img}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Veya özel resim yolu girin (örn: devices/xyz.png)"
              value={customPath}
              onChange={e => {
                setCustomPath(e.target.value);
                setCurrent({ ...current, imageUrl: undefined });
              }}
            />
            {effectiveImageUrl && (
              <div className="flex justify-center">
                 <Image
                    src={`/${effectiveImageUrl}`}
                    alt="Preview"
                    width={200}
                    height={200}
                    className="w-48 h-48 object-cover rounded-lg"
                  />
              </div>
            )}
             <Select
              value={current.hospitalId || ''}
              onValueChange={val => setCurrent({ ...current, hospitalId: val })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Laboratuvar Seçin" />
              </SelectTrigger>
              <SelectContent>
                {hospitals.map(h => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(current.order || '')}
              onValueChange={val => setCurrent({ ...current, order: Number(val) })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Dizilim Sırası Seçin" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(i => (
                  <SelectItem key={i} value={String(i)}>{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="space-x-2">
            <DialogClose asChild><Button variant="outline">İptal</Button></DialogClose>
            <Button onClick={save}>{current.id ? 'Güncelle' : 'Oluştur'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
