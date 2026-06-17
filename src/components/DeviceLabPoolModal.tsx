'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { LabSelector } from '@/components/common/LabSelector';
import { Loader2, Users, FlaskConical, Trash2, Edit3, Plus, ArrowLeft, Server } from 'lucide-react';
import { collection, getDocs, addDoc, deleteDoc, updateDoc, doc, Timestamp, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import type { Hospital, Device, DeviceLabPool } from '@/lib/types';

interface DeviceLabPoolModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hospitals: Hospital[];
  devices: Device[];
}

type ModalView = 'list' | 'create' | 'edit' | 'details';

export default function DeviceLabPoolModal({ open, onOpenChange, hospitals, devices }: DeviceLabPoolModalProps) {
  const { toast } = useToast();
  const { currentUser, currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pools, setPools] = useState<DeviceLabPool[]>([]);
  const [view, setView] = useState<ModalView>('list');

  // Create/Edit form state
  const [poolName, setPoolName] = useState('');
  const [selectedLabIds, setSelectedLabIds] = useState<Set<string>>(new Set());
  const [editingPool, setEditingPool] = useState<DeviceLabPool | null>(null);
  const [detailPool, setDetailPool] = useState<DeviceLabPool | null>(null);

  // Labs that have at least one device assigned
  const labsWithDevices = hospitals.filter(h =>
    devices.some(d => d.hospitalId === h.id)
  ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const fetchPools = useCallback(async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(scopedQuery('deviceLabPools', currentCompanyId, isSuperAdmin, orderBy('createdAt', 'desc')));
      setPools(snap.docs.map(d => ({ id: d.id, ...d.data() } as DeviceLabPool)));
    } catch (error) {
      console.error('Error fetching device lab pools:', error);
      toast({ title: 'Hata', description: 'Cihaz laboratuvar grupları yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      fetchPools();
      setView('list');
    }
  }, [open, fetchPools]);

  const getDeviceCountForLab = (labId: string) => {
    return devices.filter(d => d.hospitalId === labId).length;
  };

  const handleStartCreate = () => {
    setPoolName('');
    setSelectedLabIds(new Set());
    setEditingPool(null);
    setView('create');
  };

  const handleStartEdit = (pool: DeviceLabPool) => {
    setPoolName(pool.name);
    setSelectedLabIds(new Set(pool.memberIds));
    setEditingPool(pool);
    setView('edit');
  };

  const handleShowDetails = (pool: DeviceLabPool) => {
    setDetailPool(pool);
    setView('details');
  };

  const handleLabSelect = (labId: string, checked: boolean) => {
    setSelectedLabIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(labId);
      } else {
        newSet.delete(labId);
      }
      return newSet;
    });
  };

  const handleSave = async () => {
    if (!poolName.trim()) {
      toast({ title: 'Hata', description: 'Grup adı boş olamaz.', variant: 'destructive' });
      return;
    }
    if (selectedLabIds.size === 0) {
      toast({ title: 'Hata', description: 'En az bir laboratuvar seçmelisiniz.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      if (editingPool) {
        // Update existing
        await updateDoc(doc(db, 'deviceLabPools', editingPool.id), {
          name: poolName.trim(),
          memberIds: Array.from(selectedLabIds),
        });
        toast({ title: 'Başarılı', description: 'Cihaz laboratuvar grubu güncellendi.' });
      } else {
        // Create new
        const poolData: Omit<DeviceLabPool, 'id'> = {
          name: poolName.trim(),
          memberIds: Array.from(selectedLabIds),
          active: true,
          createdAt: Timestamp.now(),
          createdByUid: currentUser?.uid || '',
          createdByName: currentUserProfile?.name || currentUser?.email || 'Bilinmeyen',
        };
        await addDoc(collection(db, 'deviceLabPools'), poolData);
        toast({ title: 'Başarılı', description: 'Cihaz laboratuvar grubu oluşturuldu.' });
      }

      fetchPools();
      setView('list');
    } catch (error) {
      console.error('Error saving device lab pool:', error);
      toast({ title: 'Hata', description: 'Grup kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (poolId: string) => {
    if (!confirm('Bu grubu silmek istediğinizden emin misiniz?')) return;

    setIsLoading(true);
    try {
      await deleteDoc(doc(db, 'deviceLabPools', poolId));
      toast({ title: 'Silindi', description: 'Cihaz laboratuvar grubu silindi.' });
      fetchPools();
      if (view === 'details') setView('list');
    } catch (error) {
      console.error('Error deleting device lab pool:', error);
      toast({ title: 'Hata', description: 'Grup silinemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const renderListView = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Server className="h-5 w-5 text-primary" />
          Cihaz Laboratuvar Grupları
        </DialogTitle>
        <p className="text-sm text-muted-foreground">
          Cihazları laboratuvar kümelerine ayırarak toplu planlama ve filtreleme işlemlerini kolaylaştırın.
        </p>
      </DialogHeader>

      <div className="py-4">
        <div className="flex justify-end mb-4">
          <Button onClick={handleStartCreate} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Yeni Grup
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : pools.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Server className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Henüz cihaz laboratuvar grubu oluşturulmadı.</p>
            <p className="text-xs mt-1">Yeni bir grup oluşturarak laboratuvarları gruplandırabilirsiniz.</p>
          </div>
        ) : (
          <ScrollArea className="h-72">
            <div className="space-y-3">
              {pools.map(pool => (
                <div
                  key={pool.id}
                  className="flex items-center justify-between p-4 border rounded-xl hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleShowDetails(pool)}
                >
                  <div className="space-y-1">
                    <p className="font-semibold">{pool.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pool.memberIds.length} laboratuvar · {pool.memberIds.reduce((sum, labId) => sum + getDeviceCountForLab(labId), 0)} cihaz
                    </p>
                    <p className="text-xs text-muted-foreground truncate max-w-[360px]">
                      {pool.memberIds.slice(0, 4).map(labId => hospitals.find(h => h.id === labId)?.name).filter(Boolean).join(', ')}
                      {pool.memberIds.length > 4 ? '…' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleStartEdit(pool); }}
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleDelete(pool.id); }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Kapat</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );

  const renderFormView = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setView('list')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {editingPool ? 'Grubu Düzenle' : 'Yeni Cihaz Laboratuvar Grubu'}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div>
          <Label htmlFor="device-pool-name">Grup Adı</Label>
          <Input
            id="device-pool-name"
            value={poolName}
            onChange={(e) => setPoolName(e.target.value)}
            placeholder="Örn: Biyokimya Grubu"
          />
        </div>

        <div>
          <LabSelector
            mode="multi"
            label="Laboratuvar Seçimi"
            helperText="Gruba dahil edilecek laboratuvarları seçin. Sadece cihaz atanmış laboratuvarlar listelenir."
            labs={labsWithDevices.map(l => ({
              id: l.id,
              name: l.name,
              kod: l.kod,
              meta: `${getDeviceCountForLab(l.id)} cihaz`,
            }))}
            values={Array.from(selectedLabIds)}
            onValuesChange={(ids) => setSelectedLabIds(new Set(ids))}
            placeholder={
              labsWithDevices.length === 0
                ? 'Cihaz atanmış laboratuvar bulunamadı.'
                : 'Laboratuvar seçin'
            }
            disabled={labsWithDevices.length === 0}
            showChips
            popoverModal
            contentClassName="z-[10000]"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => setView('list')} disabled={isSaving}>
          İptal
        </Button>
        <Button onClick={handleSave} disabled={isSaving || isLoading}>
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {editingPool ? 'Güncelle' : 'Oluştur'}
        </Button>
      </DialogFooter>
    </>
  );

  const renderDetailsView = () => {
    if (!detailPool) return null;
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setView('list')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {detailPool.name}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-3">
          <h4 className="font-medium">Dahil Laboratuvarlar</h4>
          <ScrollArea className="h-48">
            <div className="space-y-2">
              {detailPool.memberIds.map(labId => {
                const lab = hospitals.find(h => h.id === labId);
                const deviceCount = getDeviceCountForLab(labId);
                return (
                  <div key={labId} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                    <span className="text-sm flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-green-500" />
                      {lab?.name || 'Bilinmeyen Lab'}
                      {lab?.kod && <span className="text-xs font-mono text-muted-foreground">({lab.kod})</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{deviceCount} cihaz</span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="flex justify-between">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleDelete(detailPool.id)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Grubu Sil
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleStartEdit(detailPool)}>
              <Edit3 className="h-4 w-4 mr-2" />
              Düzenle
            </Button>
            <Button variant="outline" size="sm" onClick={() => setView('list')}>
              Geri
            </Button>
          </div>
        </DialogFooter>
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {view === 'list' && renderListView()}
        {(view === 'create' || view === 'edit') && renderFormView()}
        {view === 'details' && renderDetailsView()}
      </DialogContent>
    </Dialog>
  );
}
