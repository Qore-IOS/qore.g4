// File: /hooks/useLabCountMissingStock.ts
'use client';

import { useCallback, useMemo, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  where,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import type { DepoStokItem, ProductCode } from '@/lib/types';
import { parseAnyBarcode, resolveProductFromParsed } from '@/lib/barcode';
import type { ParsedGeneric, BarcodeFormat } from '@/lib/barcode';

type NewFromCount = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi: string;
  persisted?: boolean;
};

export function useLabCountMissingStock(params: {
  labId: string;
  labName: string;
  existingLabSerials: Set<string>;
  productCodes: ProductCode[];
  barcodeFormats: BarcodeFormat[];
  toast?: (o: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
}) {
  const { labId, labName, existingLabSerials, productCodes, barcodeFormats, toast } = params;

  const [newFromCount, setNewFromCount] = useState<NewFromCount[]>([]);

  const productNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    productCodes.forEach(p => {
      if (p.stokKodu) m[p.stokKodu] = p.stokAdi || p.stokKodu;
    });
    return m;
  }, [productCodes]);

  const isNewSerial = useCallback(
    (serial: string) => newFromCount.some(n => n.seriNumarasi === serial),
    [newFromCount]
  );

  const groupRowClass = useCallback(
    (stokKodu: string, lotNumarasi: string, miad: string) =>
      newFromCount.some(
        n => n.stokKodu === stokKodu && n.lotNumarasi === lotNumarasi && n.miad === miad
      )
        ? 'bg-blue-100 dark:bg-blue-900/30'
        : '',
    [newFromCount]
  );

  const serialTextClass = useCallback(
    (serial: string) => (isNewSerial(serial) ? 'text-blue-600 dark:text-blue-400 font-medium' : ''),
    [isNewSerial]
  );

  const transferFromDepotToLab = useCallback(
    async (parsed: ParsedGeneric) => {
      const isSerial = !!parsed?.seriNumarasi?.trim();
      const stokKodu = parsed?.stokKodu || '';
      const lot = parsed?.lotNumarasi || '';
      const serial = parsed?.seriNumarasi || '';

      const stokRef = collection(db, 'depoStok');
      const candidates: any[] = [];

      if (isSerial) {
        const snap = await getDocs(
          query(stokRef, where('seriNumarasi', '==', serial), limit(5))
        );
        candidates.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } else if (stokKodu && lot) {
        const snap = await getDocs(
          query(stokRef, where('stokKodu', '==', stokKodu), where('lotNumarasi', '==', lot), limit(10))
        );
        candidates.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } else if (stokKodu) {
        const snap = await getDocs(
          query(stokRef, where('stokKodu', '==', stokKodu), limit(10))
        );
        candidates.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }

      const depotSource = candidates.find((c: any) => c?.depotId && !c?.isShipped);
      if (!depotSource) return null;

      const batch = writeBatch(db);

      // CRITICAL FIX: Only update the existing record, don't create a duplicate
      // Transfer the item by marking it as shipped and assigning to the lab
      const oldRef = doc(db, 'depoStok', depotSource.id);
      batch.update(oldRef, {
        isShipped: true,
        hedefKurum: labName,
        hedefKurumId: labId,
        sevkTarihi: serverTimestamp(),
        depotId: null,   // Clear depot-specific info since it's now in lab
        rafAdresi: null, // Clear shelf location
      });

      await batch.commit();

      // Return the updated document
      return {
        id: depotSource.id,
        ...depotSource,
        isShipped: true,
        hedefKurumId: labId,
        hedefKurum: labName,
        depotId: null,
        rafAdresi: null,
      };
    },
    [labId, labName]
  );

  const onScanAndStageIfMissing = useCallback(
    async (rawBarcode: string) => {
      const parsed = parseAnyBarcode(rawBarcode, barcodeFormats);
      if (!parsed) {
        toast?.({ title: 'Hata', description: 'Geçersiz barkod formatı.', variant: 'destructive' });
        return { parsed: null, stagedNew: false, staged: null, createdLabDoc: null };
      }

      const resolved = resolveProductFromParsed(parsed, productCodes);
      if (!resolved.product || !resolved.stokKodu) {
          toast?.({ title: 'Hata', description: 'Barkod bir ürünle eşleşmedi.', variant: 'destructive' });
          return { parsed: null, stagedNew: false, staged: null, createdLabDoc: null };
      }

      const finalParsed = resolved;
      const serial = finalParsed.seriNumarasi || '';

      if (serial && existingLabSerials.has(serial)) {
        return { parsed: finalParsed, stagedNew: false, staged: null, createdLabDoc: null };
      }

      let createdLabDoc: any = null;
      try {
        createdLabDoc = await transferFromDepotToLab(finalParsed);
      } catch (e) {
        createdLabDoc = null;
        console.error("Transfer from depot failed:", e);
        toast?.({title: 'Transfer Hatası', description: 'Ürün depodan laboratuvara aktarılamadı.', variant: 'destructive'});
      }

      const staged: NewFromCount = {
        stokKodu: finalParsed.stokKodu,
        stokAdi: productNameMap[finalParsed.stokKodu] || finalParsed.stokKodu,
        lotNumarasi: finalParsed.lotNumarasi || '',
        miad: finalParsed.miadFormatted || '',
        seriNumarasi: serial,
        persisted: !!createdLabDoc,
      };

      setNewFromCount(prev => (prev.some(p => p.seriNumarasi === staged.seriNumarasi) ? prev : [...prev, staged]));

      if (createdLabDoc) {
        toast?.({ title: 'Depodan Aktarıldı', description: `${staged.stokAdi} • ${serial || staged.lotNumarasi}` });
        return { parsed: finalParsed, stagedNew: true, staged, createdLabDoc };
      }

      toast?.({ title: 'Sayıma Eklendi', description: `${staged.stokAdi} • ${serial || staged.lotNumarasi} (Depoda Bulunamadı)` });
      return { parsed: finalParsed, stagedNew: true, staged, createdLabDoc: null };
    },
    [existingLabSerials, productNameMap, toast, transferFromDepotToLab, barcodeFormats, productCodes]
  );

  const commitNewItems = useCallback(async () => {
    const pending = newFromCount.filter(n => !n.persisted);
    if (pending.length === 0) return 0;

    const batch = writeBatch(db);
    pending.forEach(n => {
      const ref = doc(collection(db, 'depoStok'));
      const data: Omit<DepoStokItem, 'id'> = {
        stokKodu: n.stokKodu,
        stokAdi: n.stokAdi || n.stokKodu,
        lotNumarasi: n.lotNumarasi,
        miad: n.miad,
        seriNumarasi: n.seriNumarasi,
        isShipped: true,
        hedefKurumId: labId,
        hedefKurum: labName,
        eklenmeTarihi: new Date(),
      };
      batch.set(ref, data as any);
    });
    await batch.commit();
    const created = pending.length;
    setNewFromCount(prev => prev.filter(n => n.persisted));
    return created;
  }, [labId, labName, newFromCount]);

  return {
    newFromCount,
    onScanAndStageIfMissing,
    commitNewItems,
    groupRowClass,
    serialTextClass,
    isNewSerial,
  };
}
