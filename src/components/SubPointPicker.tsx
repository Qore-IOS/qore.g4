'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export interface SubPointOption {
  id: string;
  name: string;
  isActive?: boolean;
}

export default function SubPointPicker({
  labId,
  label = 'Alt Tüketim Noktası (opsiyonel)',
  value,
  onChange,
  disabled
}: {
  labId?: string;
  label?: string;
  value?: string | null;
  onChange: (val: string | null) => void;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<SubPointOption[]>([]);
  const isDisabled = disabled || !labId;

  useEffect(() => {
    if (!labId) { setItems([]); return; }
    const q = query(collection(db, 'hospitals', labId, 'subPoints'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as SubPointOption[];
      setItems(list.filter(i => i.isActive ?? true));
    });
    return () => unsub();
  }, [labId]);

  const current = useMemo(() => items.find(i => i.id === value) || null, [items, value]);

  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      <Select
        value={current?.id ?? '__none__'}
        onValueChange={(v) => onChange(v === '__none__' ? null : v)}
        disabled={isDisabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Alt tüketim noktası seçin" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Alt nokta yok —</SelectItem>
          {items.map(sp => (<SelectItem key={sp.id} value={sp.id}>{sp.name}</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );
}
