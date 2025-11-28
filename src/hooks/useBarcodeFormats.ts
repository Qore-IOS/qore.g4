// /hooks/useBarcodeFormats.ts
'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { BarcodeFormat } from '@/lib/barcode';

export function useBarcodeFormats() {
  const [formats, setFormats] = useState<BarcodeFormat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'barcodeFormats'),
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
