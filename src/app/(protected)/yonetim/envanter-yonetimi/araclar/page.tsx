'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, Trash2, Loader2, Car, Edit3, UserCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, addDoc, deleteDoc, doc, setDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import BackButton from '@/components/BackButton';
import type { User as AppUser } from '@/lib/types';

interface Vehicle {
  id: string;
  marka: string;
  model: string;
  yil: string;
  plaka: string;
  assignedDriverId?: string;
  assignedDriverName?: string;
  createdAt?: any;
}

export default function AraclarPage() {
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Partial<Vehicle>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [vehiclesSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'vehicles')),
        getDocs(collection(db, 'users')),
      ]);

      setVehicles(
        vehiclesSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Vehicle))
          .sort((a, b) => a.plaka.localeCompare(b.plaka))
      );

      const driverUsers = usersSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as AppUser))
        .filter(u => (u as any).role === 'driver');
      setDrivers(driverUsers);
    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenModal = (vehicle?: Vehicle) => {
    setEditingVehicle(vehicle || {});
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!editingVehicle.marka || !editingVehicle.model || !editingVehicle.plaka) {
      toast({ title: 'Eksik Bilgi', description: 'Marka, model ve plaka alanları zorunludur.', variant: 'destructive' });
      return;
    }

    setLoading(true);

    // Şoför atandıysa ismini de kaydet
    let assignedDriverName = '';
    if (editingVehicle.assignedDriverId) {
      const driver = drivers.find(d => d.id === editingVehicle.assignedDriverId);
      assignedDriverName = (driver as any)?.displayName || (driver as any)?.name || (driver as any)?.email || '';
    }

    const dataToSave: Partial<Vehicle> = {
      marka: editingVehicle.marka,
      model: editingVehicle.model,
      yil: editingVehicle.yil || '',
      plaka: editingVehicle.plaka.toUpperCase(),
      assignedDriverId: editingVehicle.assignedDriverId || null,
      assignedDriverName: assignedDriverName || null,
    };

    try {
      if (editingVehicle.id) {
        await setDoc(doc(db, 'vehicles', editingVehicle.id), dataToSave, { merge: true });
      } else {
        await addDoc(collection(db, 'vehicles'), {
          ...dataToSave,
          createdAt: new Date(),
        });
      }
      toast({ title: 'Başarılı', description: 'Araç kaydedildi.' });
      setIsModalOpen(false);
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Kayıt sırasında bir hata oluştu.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu aracı silmek istediğinizden emin misiniz?')) {
      setLoading(true);
      try {
        await deleteDoc(doc(db, 'vehicles', id));
        toast({ title: 'Silindi', description: 'Araç kaydı silindi.', variant: 'destructive' });
        fetchData();
      } catch (e) {
        toast({ title: 'Hata', description: 'Silme işlemi başarısız oldu.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <BackButton fallback="/yonetim/envanter-yonetimi" />
          <Button onClick={() => handleOpenModal()} size="sm" disabled={loading}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Yeni Araç Ekle
          </Button>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Car className="h-6 w-6 text-primary" />
              <CardTitle className="text-2xl font-headline">Araç Yönetimi</CardTitle>
            </div>
            <CardDescription>Şirket araçlarını yönetin ve şoförlere atayın.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <ScrollArea className="h-[60vh] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plaka</TableHead>
                      <TableHead>Marka</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Yıl</TableHead>
                      <TableHead>Atanan Şoför</TableHead>
                      <TableHead className="text-right">İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vehicles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8">
                          Henüz araç kaydı bulunmuyor.
                        </TableCell>
                      </TableRow>
                    ) : (
                      vehicles.map(vehicle => (
                        <TableRow key={vehicle.id}>
                          <TableCell className="font-mono font-bold">{vehicle.plaka}</TableCell>
                          <TableCell>{vehicle.marka}</TableCell>
                          <TableCell>{vehicle.model}</TableCell>
                          <TableCell>{vehicle.yil || '-'}</TableCell>
                          <TableCell>
                            {vehicle.assignedDriverId ? (
                              <Badge variant="default" className="flex items-center gap-1 w-fit">
                                <UserCheck className="h-3 w-3" />
                                {vehicle.assignedDriverName || 'Atandı'}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">
                                Atanmadı
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenModal(vehicle)}
                                disabled={loading}
                              >
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(vehicle.id)}
                                disabled={loading}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingVehicle.id ? 'Araç Düzenle' : 'Yeni Araç Ekle'}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Marka *</label>
              <Input
                placeholder="örn: Ford, Mercedes, Volkswagen"
                value={editingVehicle.marka || ''}
                onChange={e => setEditingVehicle({ ...editingVehicle, marka: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Model *</label>
              <Input
                placeholder="örn: Transit, Sprinter, Crafter"
                value={editingVehicle.model || ''}
                onChange={e => setEditingVehicle({ ...editingVehicle, model: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Yıl</label>
              <Input
                placeholder="örn: 2023"
                value={editingVehicle.yil || ''}
                onChange={e => setEditingVehicle({ ...editingVehicle, yil: e.target.value })}
                maxLength={4}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Plaka *</label>
              <Input
                placeholder="örn: 34 ABC 123"
                value={editingVehicle.plaka || ''}
                onChange={e => setEditingVehicle({ ...editingVehicle, plaka: e.target.value.toUpperCase() })}
                className="uppercase"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Atanan Şoför</label>
              <Select
                value={editingVehicle.assignedDriverId || 'none'}
                onValueChange={value =>
                  setEditingVehicle({
                    ...editingVehicle,
                    assignedDriverId: value === 'none' ? undefined : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Şoför seçin..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Atama Yapılmadı</SelectItem>
                  {drivers.map(driver => (
                    <SelectItem key={driver.id} value={driver.id!}>
                      {(driver as any).displayName || (driver as any).name || (driver as any).email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">İptal</Button>
            </DialogClose>
            <Button onClick={handleSave} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
