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
import { parseAnyBarcode, resolveProductFromParsed, parseAndResolveBarcode } from '@/lib/barcode';
import type { ParsedGeneric, BarcodeFormat } from '@/lib/barcode';
import { useAuth } from '@/contexts/auth-context';
import { withCompanyScope, matchesCompanyScope } from '@/lib/company-scope';

type NewFromCount = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi: string;
  persisted?: boolean;
  transferSource?: 'depot' | 'pool_lab';
  sourceLabName?: string;
};

export function useLabCountMissingStock(params: {
  labId: string;
  labName: string;
  existingLabSerials: Set<string>;
  productCodes: ProductCode[];
  barcodeFormats: BarcodeFormat[];
  toast?: (o: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
  poolMemberIds?: string[];
  poolMemberNames?: string[];
}) {
  const {
    labId,
    labName,
    existingLabSerials,
    productCodes,
    barcodeFormats,
    toast,
    poolMemberIds = [],
    poolMemberNames = [],
  } = params;

  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();

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
    (stokKodu: string, lotNumarasi: string, miad: string) => {
      const item = newFromCount.find(
        n => n.stokKodu === stokKodu && n.lotNumarasi === lotNumarasi && n.miad === miad
      );
      if (!item) return '';
      if (item.transferSource === 'pool_lab') return 'bg-purple-100 dark:bg-purple-900/30';
      return 'bg-blue-100 dark:bg-blue-900/30';
    },
    [newFromCount]
  );

  const serialTextClass = useCallback(
    (serial: string) => {
      const item = newFromCount.find(n => n.seriNumarasi === serial);
      if (!item) return '';
      if (item.transferSource === 'pool_lab') return 'text-purple-600 dark:text-purple-400 font-medium';
      return 'text-blue-600 dark:text-blue-400 font-medium';
    },
    [newFromCount]
  );

  const isPoolTransferSerial = useCallback(
    (serial: string) => newFromCount.some(n => n.seriNumarasi === serial && n.transferSource === 'pool_lab'),
    [newFromCount]
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

      const depotSource = candidates.find((c: any) =>
        c?.depotId && !c?.isShipped && matchesCompanyScope(c, currentCompanyId, isSuperAdmin)
      );
      if (!depotSource) return null;

      const batch = writeBatch(db);
      const sourceDepotId = depotSource.depotId;
      const sourceDepotName = depotSource.depotName || '';

      // Update the existing record - transfer from depot to lab
      const oldRef = doc(db, 'depoStok', depotSource.id);
      batch.update(oldRef, {
        isShipped: true,
        hedefKurum: labName,
        hedefKurumId: labId,
        sevkTarihi: serverTimestamp(),
        depotId: null,   // Clear depot-specific info since it's now in lab
        rafAdresi: null, // Clear shelf location
      });

      // Create transfer record for traceability
      const transferRef = doc(collection(db, 'transfers'));
      batch.set(transferRef, {
        id: transferRef.id,
        timestamp: serverTimestamp(),
        sourceDepotId: sourceDepotId,
        sourceDepotName: sourceDepotName,
        targetHospitalId: labId,
        targetName: labName,
        mode: 'depot_to_lab',
        itemCount: 1,
        createdByUid: 'system',
        createdByName: 'Sayım Otomatik Transfer',
      });

      // Add item to transfer subcollection
      const transferItemRef = doc(collection(db, 'transfers', transferRef.id, 'items'), depotSource.id);
      batch.set(transferItemRef, {
        stokKodu: depotSource.stokKodu,
        stokAdi: depotSource.stokAdi || '',
        lotNumarasi: depotSource.lotNumarasi || '',
        miad: depotSource.miad || '',
        seriNumarasi: serial,
      });

      // Add serial history if serial exists
      if (serial) {
        const histRef = doc(collection(db, `serialHistory/${serial}/events`));
        batch.set(histRef, {
          type: 'depot_to_lab_transfer',
          transferId: transferRef.id,
          details: {
            sourceDepotId,
            sourceDepotName,
            targetLabId: labId,
            targetLabName: labName,
            stokKodu: depotSource.stokKodu,
            stokAdi: depotSource.stokAdi || '',
            lotNumarasi: depotSource.lotNumarasi || '',
            miad: depotSource.miad || '',
          },
          timestamp: serverTimestamp(),
        });
      }

      await batch.commit();

      // Return the updated document
      return {
        doc: {
          id: depotSource.id,
          ...depotSource,
          isShipped: true,
          hedefKurumId: labId,
          hedefKurum: labName,
          depotId: null,
          rafAdresi: null,
        },
        transferSource: 'depot' as const,
      };
    },
    [labId, labName, currentCompanyId, isSuperAdmin]
  );

  const transferFromPoolLabToLab = useCallback(
    async (parsed: ParsedGeneric) => {
      // Only serial-tracked items can be transferred from pool labs
      const serial = parsed?.seriNumarasi?.trim();
      if (!serial) return null;

      const stokRef = collection(db, 'depoStok');

      // Search for the serial in pool member labs
      const snap = await getDocs(
        query(
          stokRef,
          where('seriNumarasi', '==', serial),
          where('isShipped', '==', true),
          limit(5)
        )
      );

      // Find an item that belongs to a pool member lab
      const poolSource = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .find((item: any) =>
          matchesCompanyScope(item, currentCompanyId, isSuperAdmin) && (
            poolMemberIds.includes(item.hedefKurumId) ||
            poolMemberNames.includes(item.hedefKurum)
          )
        );

      if (!poolSource) return null;

      // Determine source lab
      const sourceLabId = (poolSource as any).hedefKurumId;
      const sourceLabName = (poolSource as any).hedefKurum || '';

      const batch = writeBatch(db);

      // Transfer from pool lab to current lab
      const itemRef = doc(db, 'depoStok', (poolSource as any).id);
      batch.update(itemRef, {
        hedefKurumId: labId,
        hedefKurum: labName,
        sevkTarihi: serverTimestamp(),
      });

      // Create inter-lab transfer record
      const transferRef = doc(collection(db, 'transfers'));
      batch.set(transferRef, {
        id: transferRef.id,
        timestamp: serverTimestamp(),
        sourceLabId: sourceLabId,
        sourceLabName: sourceLabName,
        targetHospitalId: labId,
        targetName: labName,
        mode: 'inter_lab',
        itemCount: 1,
        createdByUid: 'system',
        createdByName: 'Sayım Otomatik Transfer',
      });

      // Add item to transfer subcollection
      const transferItemRef = doc(collection(db, 'transfers', transferRef.id, 'items'), (poolSource as any).id);
      batch.set(transferItemRef, {
        stokKodu: (poolSource as any).stokKodu,
        stokAdi: (poolSource as any).stokAdi || '',
        lotNumarasi: (poolSource as any).lotNumarasi || '',
        miad: (poolSource as any).miad || '',
        seriNumarasi: serial,
      });

      // Add serial history
      if (serial) {
        const histRef = doc(collection(db, `serialHistory/${serial}/events`));
        batch.set(histRef, {
          type: 'inter_lab_transfer',
          transferId: transferRef.id,
          details: {
            sourceLabId,
            sourceLabName,
            targetLabId: labId,
            targetLabName: labName,
            stokKodu: (poolSource as any).stokKodu,
            stokAdi: (poolSource as any).stokAdi || '',
            lotNumarasi: (poolSource as any).lotNumarasi || '',
            miad: (poolSource as any).miad || '',
          },
          timestamp: serverTimestamp(),
        });
      }

      await batch.commit();

      return {
        doc: {
          id: (poolSource as any).id,
          ...poolSource,
          hedefKurumId: labId,
          hedefKurum: labName,
        },
        transferSource: 'pool_lab' as const,
        sourceLabName,
      };
    },
    [labId, labName, poolMemberIds, poolMemberNames, currentCompanyId, isSuperAdmin]
  );

  const onScanAndStageIfMissing = useCallback(
    async (rawBarcode: string) => {
      const resolveResult = parseAndResolveBarcode(rawBarcode, barcodeFormats, productCodes);
      if (!resolveResult || !resolveResult.parsed) {
        toast?.({ title: 'Hata', description: 'Geçersiz barkod formatı.', variant: 'destructive' });
        return { parsed: null, stagedNew: false, staged: null, createdLabDoc: null };
      }

      if (!resolveResult.product || !resolveResult.parsed.stokKodu) {
          toast?.({ title: 'Hata', description: 'Barkod bir ürünle eşleşmedi.', variant: 'destructive' });
          return { parsed: null, stagedNew: false, staged: null, createdLabDoc: null };
      }

      const finalParsed = resolveResult.parsed;
      const serial = finalParsed.seriNumarasi || '';

      if (serial && existingLabSerials.has(serial)) {
        return { parsed: finalParsed, stagedNew: false, staged: null, createdLabDoc: null };
      }

      let transferResult: { doc: any; transferSource: 'depot' | 'pool_lab'; sourceLabName?: string } | null = null;

      try {
        // First, try to transfer from depot
        transferResult = await transferFromDepotToLab(finalParsed);

        // If not found in depot and poolMemberIds exist, try pool labs (serial only)
        if (!transferResult && poolMemberIds.length > 0 && serial) {
          transferResult = await transferFromPoolLabToLab(finalParsed);
        }
      } catch (e) {
        transferResult = null;
        console.error("Transfer failed:", e);
        toast?.({title: 'Transfer Hatası', description: 'Ürün aktarılamadı.', variant: 'destructive'});
      }

      const staged: NewFromCount = {
        stokKodu: finalParsed.stokKodu,
        stokAdi: productNameMap[finalParsed.stokKodu] || finalParsed.stokKodu,
        lotNumarasi: finalParsed.lotNumarasi || '',
        miad: finalParsed.miadFormatted || '',
        seriNumarasi: serial,
        persisted: !!transferResult,
        transferSource: transferResult?.transferSource,
        sourceLabName: transferResult?.sourceLabName,
      };

      // Check for duplicates: use serial for serial-tracked items, or stokKodu+lot+miad for lot-tracked items
      setNewFromCount(prev => {
        const isDuplicate = prev.some(p => {
          // If both have serials, compare by serial (for serial-tracked items)
          if (staged.seriNumarasi && p.seriNumarasi) {
            return p.seriNumarasi === staged.seriNumarasi;
          }
          // For lot-tracked items (no serial), compare by stokKodu + lot + miad
          if (!staged.seriNumarasi && !p.seriNumarasi) {
            return p.stokKodu === staged.stokKodu &&
                   p.lotNumarasi === staged.lotNumarasi &&
                   p.miad === staged.miad;
          }
          return false;
        });
        return isDuplicate ? prev : [...prev, staged];
      });

      if (transferResult) {
        if (transferResult.transferSource === 'depot') {
          toast?.({ title: 'Depodan Aktarıldı', description: `${staged.stokAdi} • ${serial || staged.lotNumarasi}` });
        } else {
          toast?.({ title: 'Havuzdan Aktarıldı', description: `${staged.stokAdi} • ${serial}\n${transferResult.sourceLabName} → ${labName}` });
        }
        return { parsed: finalParsed, stagedNew: true, staged, createdLabDoc: transferResult.doc };
      }

      toast?.({ title: 'Sayıma Eklendi', description: `${staged.stokAdi} • ${serial || staged.lotNumarasi} (Bulunamadı)` });
      return { parsed: finalParsed, stagedNew: true, staged, createdLabDoc: null };
    },
    [existingLabSerials, productNameMap, toast, transferFromDepotToLab, transferFromPoolLabToLab, barcodeFormats, productCodes, poolMemberIds, labName]
  );

  const commitNewItems = useCallback(async () => {
    const pending = newFromCount.filter(n => !n.persisted);
    if (pending.length === 0) return 0;

    const batch = writeBatch(db);
    pending.forEach(n => {
      const ref = doc(collection(db, 'depoStok'));
      const data: Omit<DepoStokItem, 'id'> = withCompanyScope({
        stokKodu: n.stokKodu,
        stokAdi: n.stokAdi || n.stokKodu,
        lotNumarasi: n.lotNumarasi,
        miad: n.miad,
        seriNumarasi: n.seriNumarasi,
        isShipped: true,
        hedefKurumId: labId,
        hedefKurum: labName,
        eklenmeTarihi: new Date(),
      }, currentUserProfile?.companyId);
      batch.set(ref, data as any);
    });
    await batch.commit();
    const created = pending.length;
    setNewFromCount(prev => prev.filter(n => n.persisted));
    return created;
  }, [labId, labName, newFromCount, currentUserProfile?.companyId]);

  return {
    newFromCount,
    onScanAndStageIfMissing,
    commitNewItems,
    groupRowClass,
    serialTextClass,
    isNewSerial,
    isPoolTransferSerial,
  };
}
