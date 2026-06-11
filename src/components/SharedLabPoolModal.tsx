'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/firebase';
import { addDoc, collection, getDocs, Timestamp } from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LabSelector } from '@/components/common/LabSelector';
import { useToast } from '@/hooks/use-toast';
import type { Laboratory } from '@/lib/types';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export default function SharedLabPoolModal({ open, onOpenChange }: Props) {
  const { currentUserProfile, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [labs, setLabs] = useState<Laboratory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState<string>('');

  useEffect(() => {
    (async () => {
      const snap = await getDocsResilient(scopedQuery('hospitals', currentCompanyId, isSuperAdmin));
      setLabs(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    })();
  }, []);

  const canSave = selected.size >= 2;

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onSave = async () => {
    if (!canSave) {
      toast({ title: 'Seçim Eksik', description: 'En az iki laboratuvar seçin.', variant: 'destructive' });
      return;
    }
    const now = new Date();
    const docName = name?.trim() || `Ortak Havuz - ${now.toLocaleDateString('tr-TR')} ${now.toLocaleTimeString('tr-TR')}`;

    await addDoc(collection(db, 'labPools'), {
      name: docName,
      memberIds: Array.from(selected),
      active: true,
      createdAt: Timestamp.now(),
      createdByUid: currentUserProfile?.uid || '',
      createdByName: currentUserProfile?.name || currentUserProfile?.email || '—',
    });

    toast({ title: 'Oluşturuldu', description: 'Ortak havuz başarıyla kaydedildi.' });
    setSelected(new Set());
    setName('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ortak Laboratuvar Oluştur</DialogTitle>
          <DialogDescription>Birden fazla laboratuvarı tek bir sanal stok havuzunda birleştirin. Min/Max ve sipariş akışları etkilenmez.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Havuz Adı (opsiyonel)</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Örn: Kadıköy Bölge Havuzu" />
          </div>

          <LabSelector
            mode="multi"
            label="Laboratuvarlar"
            labs={labs.map(l => ({ id: l.id, name: l.name, kod: l.kod, meta: l.address || undefined }))}
            values={Array.from(selected)}
            onValuesChange={(ids) => setSelected(new Set(ids))}
            placeholder="Laboratuvar seçin"
            helperText="* En az iki laboratuvar seçin. Bu havuz sadece Kullanım ekranında geçerlidir."
            showChips
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button onClick={onSave} disabled={!canSave}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
