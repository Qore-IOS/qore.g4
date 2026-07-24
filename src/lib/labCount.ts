'use client';
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  setDoc,
  Timestamp,
  type WriteBatch,
} from 'firebase/firestore';

export type DepoStokItem = {
  id: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string; // "dd.MM.yyyy" or ISO; keep as string for report
  seriNumarasi: string;
  hedefKurum?: string; // laboratory name on stock item
  marka?: string;
  [k: string]: any;
};

export type LabCountItem = {
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  marka: string | null; // Always provide a safe value
  expected: number;
  counted: number;
  verifiedSerials: string[];
  unscannedSerials: string[];
  /** Open/device tests recorded during count; informational and not physical stock. */
  openTestQty?: number;
  /** Package-derived tests plus open/device tests at the time of count. */
  totalTests?: number;
  /** Calculated product cost snapshot for count history. */
  costAmount?: number;
  currency?: 'EUR' | 'USD' | 'TRY';
};

export type LabCountScopeProduct = {
  stokKodu: string;
  stokAdi: string;
  laboratuvarGrubu?: string;
  laboratuvarGruplari?: string[];
  ambalajDegeri?: number;
};

export type LabCountSession = {
  laboratoryId: string;
  laboratoryName: string;
  startedAt: Date | null;
  finishedAt: Date;
  createdById: string;
  createdByName: string;
  items: LabCountItem[];
  period?: string;
  month?: number;
  year?: number;
  /** Product/group scope snapshot used for reliable historical completion. */
  scopeProducts?: LabCountScopeProduct[];
  cihazUstuUploaded?: boolean;
  kumulatifUploaded?: boolean;
};

/**
 * Build lot-level items from a lab's current stock and the set of scanned/verified serials.
 * This does NOT mutate inventory — purely for reconciliation & reporting.
 */
export function buildCountItemsFromStock(
  stockItemsForLab: DepoStokItem[],
  scannedSerials: Iterable<string>
): LabCountItem[] {
  const scanned = new Set(scannedSerials);
  const map = new Map<string, LabCountItem>(); // key: stokKodu|lot|miad

  for (const it of stockItemsForLab) {
    // Ensure all keys are non-null strings before creating the map key
    const stokKodu = it.stokKodu || '';
    const lotNumarasi = it.lotNumarasi || '';
    const miad = typeof it.miad === 'string' ? it.miad : '';
    const key = `${stokKodu}|${lotNumarasi}|${miad}`;
    
    if (!map.has(key)) {
      map.set(key, {
        stokKodu: stokKodu,
        stokAdi: it.stokAdi || '',
        lotNumarasi: lotNumarasi,
        miad: miad,
        marka: it.marka || null, // Ensure marka is null, not undefined
        expected: 0,
        counted: 0,
        verifiedSerials: [],
        unscannedSerials: [],
      });
    }
    const node = map.get(key)!;
    node.expected += 1;
    if (it.seriNumarasi && scanned.has(it.seriNumarasi)) {
      node.counted += 1;
      node.verifiedSerials.push(it.seriNumarasi);
    } else if (it.seriNumarasi) {
      node.unscannedSerials.push(it.seriNumarasi);
    }
  }

  // Stable, readable order
  return Array.from(map.values()).sort((a, b) => {
    if (a.stokKodu !== b.stokKodu) return a.stokKodu.localeCompare(b.stokKodu);
    if (a.lotNumarasi !== b.lotNumarasi) return a.lotNumarasi.localeCompare(b.lotNumarasi);
    return (a.miad || '').localeCompare(b.miad || '');
  });
}

/**
 * Persist a Lab Count Session to Firestore under hospitals/{labId}/stockCounts/{autoId}.
 * You can provide either (items) directly or (stockItemsForLab + scannedSerials) to compute items.
 * Returns the created sessionId.
 */
export async function saveLabCountSession(opts: {
  laboratoryId: string;
  laboratoryName: string;
  user: { id: string; name: string };
  startedAt?: Date | null;
  finishedAt?: Date;
  // Option A: pass finalized items
  items?: LabCountItem[];
  // Option B: or pass stock + scanned serials to compute items
  stockItemsForLab?: DepoStokItem[];
  scannedSerials?: string[] | Set<string>;
  period?: string;
  month?: number;
  year?: number;
  scopeProducts?: LabCountScopeProduct[];
  cihazUstuUploaded?: boolean;
  kumulatifUploaded?: boolean;
  /** Optional existing batch so inventory reconciliation and history are atomic. */
  batch?: WriteBatch;
}): Promise<string> {
  const {
    laboratoryId,
    laboratoryName,
    user,
    startedAt,
    finishedAt,
    items,
    stockItemsForLab,
    scannedSerials,
    period,
    month,
    year,
    scopeProducts,
    cihazUstuUploaded,
    kumulatifUploaded,
    batch,
  } = opts;

  if (!laboratoryId) throw new Error('laboratoryId is required');
  if (!laboratoryName) throw new Error('laboratoryName is required');
  if (!user?.id) throw new Error('user.id is required');

  let finalItems: LabCountItem[] = items ?? [];
  if ((!finalItems || finalItems.length === 0) && stockItemsForLab && scannedSerials) {
    finalItems = buildCountItemsFromStock(stockItemsForLab, scannedSerials);
  }
  if (!finalItems || finalItems.length === 0) {
    throw new Error('No count items to save');
  }

  const sessionRef = doc(collection(db, 'hospitals', laboratoryId, 'stockCounts'));
  
  // Ensure payload values are Firestore-compatible (null instead of undefined)
  const payload: LabCountSession = {
    laboratoryId,
    laboratoryName,
    startedAt: startedAt ?? null, // Use null as Firestore-safe fallback
    finishedAt: finishedAt ?? new Date(),
    createdById: user.id,
    createdByName: user.name || '—',
    items: finalItems,
    period,
    month,
    year,
    scopeProducts: scopeProducts ?? [],
    cihazUstuUploaded: cihazUstuUploaded ?? false,
    kumulatifUploaded: kumulatifUploaded ?? false,
  };

  // Create a version of the payload with Firestore Timestamps, safely handling nulls
  const firestorePayload = {
      ...payload,
      startedAt: payload.startedAt ? Timestamp.fromDate(payload.startedAt) : null,
      finishedAt: Timestamp.fromDate(payload.finishedAt),
  };

  if (batch) {
    batch.set(sessionRef, firestorePayload);
  } else {
    await setDoc(sessionRef, firestorePayload);
  }

  return sessionRef.id;
}
