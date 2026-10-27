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
import { PlusCircle, Trash2, Loader2, Car, Edit3, UserCheck, ImageIcon, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, addDoc, deleteDoc, doc, setDoc, query, where } from '../../../../../lib/data/client';
import { db } from '../../../../../lib/data/client';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/document-helpers';
import BackButton from '@/components/BackButton';
import type { User as AppUser } from '@/lib/types';
import Image from 'next/image';
import { cn } from '@/lib/utils';

// Kullanılabilir araç ikonları - /public/vehicles/ klasöründen
const VEHICLE_ICONS = [
  { id: 'custom-van', src: '/vehicles/custom_van.png', label: 'Custom Van' },
  { id: 'transit-van', src: '/vehicles/transit_van.png', label: 'Transit Van' },
];

interface Vehicle {
  id: string;
  marka: string;
  model: string;
  yil: string;
  plaka: string;
  kapasite?: number; // Araç kapasitesi (litre cinsinden, örn: 550, 900)
  icon?: string; // Araç ikonu yolu
  assignedDriverId?: string;
  assignedDriverName?: string;
  createdAt?: any;
}

export default function AraclarPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Partial<Vehicle>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [vehiclesSnap, usersSnap] = await Promise.all([
        getDocs(scopedQuery('vehicles', currentCompanyId, isSuperAdmin)),
        getDocs(scopedQuery('users', currentCompanyId, isSuperAdmin)),
      ]);

      setVehicles(
        filterByCompanyScope(
          vehiclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Vehicle)),
          currentCompanyId,
          isSuperAdmin
        )
          .sort((a, b) => a.plaka.localeCompare(b.plaka))
      );

      const driverUsers = filterByCompanyScope(
        usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)),
        currentCompanyId,
        isSuperAdmin
      )
        .filter(u => (u as any).role === 'driver');
      setDrivers(driverUsers);
    } catch (e) {
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, currentCompanyId]);

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
      kapasite: editingVehicle.kapasite || null,
      icon: editingVehicle.icon || null,
      assignedDriverId: editingVehicle.assignedDriverId || null,
      assignedDriverName: assignedDriverName || null,
    };

    try {
      if (editingVehicle.id) {
        await setDoc(doc(db, 'vehicles', editingVehicle.id), withCompanyScope(dataToSave as Record<string, any>, currentCompanyId), { merge: true });
      } else {
        await addDoc(collection(db, 'vehicles'), withCompanyScope({
          ...dataToSave,
          createdAt: new Date(),
        } as Record<string, any>, currentCompanyId));
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
                      <TableHead className="w-16">İkon</TableHead>
                      <TableHead>Plaka</TableHead>
                      <TableHead>Marka</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Yıl</TableHead>
                      <TableHead>Kapasite</TableHead>
                      <TableHead>Atanan Şoför</TableHead>
                      <TableHead className="text-right">İşlemler</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vehicles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8">
                          Henüz araç kaydı bulunmuyor.
                        </TableCell>
                      </TableRow>
                    ) : (
                      vehicles.map(vehicle => (
                        <TableRow key={vehicle.id}>
                          <TableCell>
                            {vehicle.icon ? (
                              <div className="w-10 h-10 relative">
                                <Image
                                  src={vehicle.icon}
                                  alt={`${vehicle.marka} ${vehicle.model}`}
                                  fill
                                  className="object-contain"
                                />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                <Car className="h-5 w-5 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-mono font-bold">{vehicle.plaka}</TableCell>
                          <TableCell>{vehicle.marka}</TableCell>
                          <TableCell>{vehicle.model}</TableCell>
                          <TableCell>{vehicle.yil || '-'}</TableCell>
                          <TableCell>
                            {vehicle.kapasite ? (
                              <Badge variant="outline" className="font-mono">
                                {vehicle.kapasite} L
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingVehicle.id ? 'Araç Düzenle' : 'Yeni Araç Ekle'}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Araç İkonu Seçimi */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Araç İkonu
              </label>
              <div className="grid grid-cols-4 gap-2 p-3 border rounded-lg bg-muted/30">
                {/* İkon yok seçeneği */}
                <button
                  type="button"
                  onClick={() => setEditingVehicle({ ...editingVehicle, icon: undefined })}
                  className={cn(
                    "relative aspect-square rounded-lg border-2 flex items-center justify-center transition-all hover:bg-accent",
                    !editingVehicle.icon
                      ? "border-primary bg-primary/10"
                      : "border-transparent bg-background"
                  )}
                >
                  <Car className="h-8 w-8 text-muted-foreground" />
                  {!editingVehicle.icon && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                      <Check className="h-3 w-3 text-primary-foreground" />
                    </div>
                  )}
                </button>
                {VEHICLE_ICONS.map(icon => (
                  <button
                    key={icon.id}
                    type="button"
                    onClick={() => setEditingVehicle({ ...editingVehicle, icon: icon.src })}
                    className={cn(
                      "relative aspect-square rounded-lg border-2 p-1 transition-all hover:bg-accent overflow-hidden",
                      editingVehicle.icon === icon.src
                        ? "border-primary bg-primary/10"
                        : "border-transparent bg-background"
                    )}
                    title={icon.label}
                  >
                    <Image
                      src={icon.src}
                      alt={icon.label}
                      fill
                      className="object-contain p-1"
                      onError={(e) => {
                        // Resim yüklenemezse gizle
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    {editingVehicle.icon === icon.src && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center z-10">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                İkonlar /public/vehicles/ klasöründen yüklenir. Yeni ikon eklemek için PNG dosyası ekleyin.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Marka *</label>
                <Input
                  placeholder="örn: Ford"
                  value={editingVehicle.marka || ''}
                  onChange={e => setEditingVehicle({ ...editingVehicle, marka: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Model *</label>
                <Input
                  placeholder="örn: Transit"
                  value={editingVehicle.model || ''}
                  onChange={e => setEditingVehicle({ ...editingVehicle, model: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Araç Kapasitesi (Litre)</label>
              <Input
                type="number"
                placeholder="örn: 550, 900"
                value={editingVehicle.kapasite || ''}
                onChange={e => setEditingVehicle({ ...editingVehicle, kapasite: e.target.value ? Number(e.target.value) : undefined })}
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Araç yükleme kapasitesi litre cinsinden. İleride doluluk oranı hesaplamalarında kullanılacak.
              </p>
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
                  {drivers.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                      Sistemde kayıtlı şoför bulunamadı.<br />
                      <span className="text-xs">Kullanıcı yönetiminden &quot;Driver&quot; rolü atayın.</span>
                    </div>
                  ) : (
                    drivers.map(driver => (
                      <SelectItem key={driver.id} value={driver.id!}>
                        {(driver as any).displayName || (driver as any).name || (driver as any).email}
                      </SelectItem>
                    ))
                  )}
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
