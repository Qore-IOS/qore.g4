// /hooks/useBarcodeFormats.ts
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { BarcodeFormat } from '@/lib/barcode';
import { scopedQuery } from '@/lib/firestore-helpers';

export function useBarcodeFormats() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [formats, setFormats] = useState<BarcodeFormat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      scopedQuery('barcodeFormats', currentCompanyId, isSuperAdmin),
      where('active', '==', true),
      orderBy('priority', 'asc')
    );
    const unsub = onSnapshot(q, snap => {
      const arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
      setFormats(arr);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  return { formats, loading };
}
