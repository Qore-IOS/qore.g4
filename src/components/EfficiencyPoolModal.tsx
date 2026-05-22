'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { LabSelector } from '@/components/common/LabSelector';
import { Loader2, Users, Building2, Crown } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { collection, getDocs, addDoc, Timestamp, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import type { Hospital, LabPool, EfficiencyPool } from '@/lib/types';

interface EfficiencyPoolModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPoolCreated?: () => void;
}

export default function EfficiencyPoolModal({ open, onOpenChange, onPoolCreated }: EfficiencyPoolModalProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [poolName, setPoolName] = useState('');
  const [selectedLabIds, setSelectedLabIds] = useState<Set<string>>(new Set());
  const [centerLabId, setCenterLabId] = useState<string>('');

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [hospitalsSnap, poolsSnap] = await Promise.all([
        getDocs(query(collection(db, 'hospitals'), orderBy('name', 'asc'))),
        getDocs(collection(db, 'labPools')),
      ]);

      setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
      setLabPools(poolsSnap.docs.map(d => ({ id: d.id, ...d.data() } as LabPool)));
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLabValuesChange = (nextIds: string[]) => {
    setSelectedLabIds(prev => {
      const nextSet = new Set(nextIds);
      // Eğer seçilen laboratuvar bir ortak havuzun ana laboratuvarı ise,
      // o havuzdaki tüm laboratuvarları da seç
      for (const id of nextIds) {
        if (!prev.has(id)) {
          const pool = labPools.find(p => p.mainLabId === id);
          if (pool) pool.memberIds.forEach(m => nextSet.add(m));
        }
      }
      // Eğer silinen lab merkez lab ise, merkez lab seçimini temizle
      if (centerLabId && !nextSet.has(centerLabId)) {
        setCenterLabId('');
      }
      return nextSet;
    });
  };

  const handleSave = async () => {
    if (!poolName.trim()) {
      toast({ title: 'Hata', description: 'Havuz adı boş olamaz.', variant: 'destructive' });
      return;
    }
    if (selectedLabIds.size === 0) {
      toast({ title: 'Hata', description: 'En az bir laboratuvar seçmelisiniz.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const poolData: Omit<EfficiencyPool, 'id'> = {
        name: poolName.trim(),
        memberIds: Array.from(selectedLabIds),
        centerLabId: centerLabId || undefined,
        active: true,
        createdAt: Timestamp.now(),
        createdByUid: currentUser?.uid || '',
        createdByName: currentUser?.name || currentUser?.email || 'Bilinmeyen',
      };

      await addDoc(collection(db, 'efficiencyPools'), poolData);

      toast({ title: 'Başarılı', description: 'Verimlilik havuzu oluşturuldu.' });
      onOpenChange(false);
      setPoolName('');
      setSelectedLabIds(new Set());
      setCenterLabId('');
      onPoolCreated?.();
    } catch (error) {
      console.error('Error saving pool:', error);
      toast({ title: 'Hata', description: 'Havuz kaydedilemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  // Laboratuvarı bir ortak havuzun parçası mı kontrol et
  const getPoolInfo = (labId: string) => {
    const pool = labPools.find(p => p.memberIds.includes(labId));
    if (!pool) return null;
    return {
      poolName: pool.name,
      isMainLab: pool.mainLabId === labId,
      memberCount: pool.memberIds.length,
    };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Verimlilik Havuzu Oluştur
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="pool-name">Havuz Adı</Label>
            <Input
              id="pool-name"
              value={poolName}
              onChange={(e) => setPoolName(e.target.value)}
              placeholder="Örn: Biyokimya Laboratuvarları"
            />
          </div>

          <div>
            <LabSelector
              mode="multi"
              label="Laboratuvar Seçimi"
              helperText="Havuza dahil edilecek laboratuvarları seçin. Ortak laboratuvar havuzuna dahil bir ana laboratuvar seçildiğinde, o havuzdaki tüm laboratuvarların min-max listesi birleştirilecektir."
              labs={hospitals.map(lab => {
                const info = getPoolInfo(lab.id);
                return {
                  id: lab.id,
                  name: lab.name,
                  kod: lab.kod,
                  meta: info ? `${info.poolName}${info.isMainLab ? ' (Ana Lab)' : ''}` : undefined,
                };
              })}
              values={Array.from(selectedLabIds)}
              onValuesChange={handleLabValuesChange}
              loading={isLoading}
              placeholder="Laboratuvar seçin"
              showChips
            />
          </div>

          {selectedLabIds.size > 0 && (
            <div className="space-y-3">
              {/* Merkez Laboratuvar Seçimi */}
              <div className="p-3 border rounded-md bg-amber-50/50 dark:bg-amber-950/20">
                <Label className="flex items-center gap-2 mb-2">
                  <Crown className="h-4 w-4 text-amber-600" />
                  Merkez Laboratuvar (İsteğe Bağlı)
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Diğer laboratuvarlardan merkeze gönderilen testler için hak ediş hesaplamasında kullanılır.
                </p>
                <LabSelector
                  labs={hospitals
                    .filter(h => selectedLabIds.has(h.id))
                    .map(l => ({ id: l.id, name: l.name, kod: l.kod }))}
                  value={centerLabId || '__none__'}
                  onChange={(val) => setCenterLabId(val === '__none__' ? '' : val)}
                  placeholder="Merkez laboratuvar seçin..."
                  allOption={{ value: '__none__', label: 'Seçilmedi' }}
                  icon={<Crown className="h-4 w-4" />}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isSaving}>İptal</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Havuz Oluştur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
