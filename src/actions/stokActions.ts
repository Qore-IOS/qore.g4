
'use server';

import { db } from '@/lib/firebase';
import type { DepoStokItem } from '@/lib/types';
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
  doc,
  updateDoc,
  limit,
  startAfter,
  orderBy,
  getCountFromServer,
} from 'firebase/firestore';
import { safeCompareByMiad, toDateSafe } from "@/lib/date";
import fs from 'fs/promises';
import path from 'path';


// Helper: convert Firestore Timestamps → JS Dates
function processDoc(doc: QueryDocumentSnapshot<DocumentData>): DepoStokItem {
  const data = doc.data();
  // Firestore'dan gelen Timestamp'ları Date objesine çevir
  Object.keys(data).forEach(key => {
    if (data[key] instanceof Timestamp) {
      data[key] = data[key].toDate();
    }
  });
  return { id: doc.id, ...data } as DepoStokItem;
}

/**
 * Fetch _all_ items for a depot.
 * We will filter for un-shipped items on the client-side to avoid needing a composite index.
 * This is intended for panels that need the full list, like DepoSayim.
 */
export async function getFullDepotStock(depotId: string): Promise<{ items: DepoStokItem[] }> {
  try {
    const ref = collection(db, 'depoStok');
    const q = query(ref, where('depotId', '==', depotId));
    const snap = await getDocs(q);
    const items = snap.docs.map(processDoc);
    return { items };
  } catch (err) {
    console.error('Error fetching full depot stock:', err);
    throw new Error('Failed to fetch full depot stock.');
  }
}

export async function getExpiringItems(depotId: string): Promise<DepoStokItem[]> {
    const depoStokRef = collection(db, 'depoStok');
    const q = query(
        depoStokRef,
        where('depotId', '==', depotId),
        where('isShipped', '==', false)
    );

    const snapshot = await getDocs(q);
    const allItems = snapshot.docs.map(processDoc);

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to the start of the day

    const expiringItems = allItems.filter(item => {
        const miadDate = toDateSafe(item.miad);
        if (!miadDate) {
            console.warn(`Could not parse date for item ${item.id}: ${item.miad}`);
            return false;
        }

        const diffDays = Math.ceil((miadDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
        return diffDays <= 90; // Warning for items expiring in 90 days or less
    }).sort((a, b) => safeCompareByMiad(a.miad, b.miad));

    return expiringItems;
}

export async function getDeviceImages(): Promise<string[]> {
  try {
    const publicPath = path.join(process.cwd(), 'public');
    const allFiles = await fs.readdir(publicPath, { recursive: true });
    
    // Filter for common image extensions and format the path for URL usage
    const imageFiles = allFiles
      .filter(file => /\.(png|jpg|jpeg|webp|svg)$/i.test(String(file)))
      .map(file => String(file).replace(/\\/g, '/')); // Ensure forward slashes

    return imageFiles;
  } catch (error) {
    console.error("Could not read device images from /public directory:", error);
    // Return an empty array if reading fails.
    return [];
  }
}

/**
 * Paginated stock query for inventory management panel.
 * Fetches stock items for a specific depot with pagination support.
 * Groups are created client-side, but we limit raw items fetched.
 */
export interface PaginatedStockResult {
  items: DepoStokItem[];
  totalCount: number;
  hasMore: boolean;
}

export async function getPaginatedDepotStock(
  depotId: string,
  pageSize: number = 20,
  lastDocId?: string | null,
  fetchAll: boolean = false
): Promise<PaginatedStockResult> {
  try {
    const ref = collection(db, 'depoStok');

    // Base query: filter by depotId and isShipped=false
    let q = query(
      ref,
      where('depotId', '==', depotId),
      where('isShipped', '==', false)
    );

    // Get total count for pagination info
    const countSnap = await getCountFromServer(q);
    const totalCount = countSnap.data().count;

    // If fetchAll is true, get all items (for exports, etc.)
    if (fetchAll) {
      const snap = await getDocs(q);
      const items = snap.docs.map(processDoc);
      return { items, totalCount, hasMore: false };
    }

    // For paginated queries, we need to fetch enough items to fill groups
    // Since grouping happens client-side, fetch more raw items to ensure enough groups
    // Multiplier accounts for items that may group together
    const fetchLimit = pageSize * 5; // Fetch 5x to account for grouping

    if (lastDocId) {
      // Get the last document for cursor-based pagination
      const lastDocRef = doc(db, 'depoStok', lastDocId);
      const lastDocSnap = await getDocs(query(ref, where('depotId', '==', depotId), where('isShipped', '==', false)));
      const lastDoc = lastDocSnap.docs.find(d => d.id === lastDocId);

      if (lastDoc) {
        q = query(
          ref,
          where('depotId', '==', depotId),
          where('isShipped', '==', false),
          startAfter(lastDoc),
          limit(fetchLimit)
        );
      }
    } else {
      q = query(
        ref,
        where('depotId', '==', depotId),
        where('isShipped', '==', false),
        limit(fetchLimit)
      );
    }

    const snap = await getDocs(q);
    const items = snap.docs.map(processDoc);
    const hasMore = items.length === fetchLimit || snap.docs.length < totalCount;

    return { items, totalCount, hasMore };
  } catch (err) {
    console.error('Error fetching paginated depot stock:', err);
    throw new Error('Failed to fetch paginated depot stock.');
  }
}

/**
 * Get stock items for a depot with offset-based pagination.
 * More suitable for UI pagination with page numbers.
 */
export async function getDepotStockPage(
  depotId: string,
  page: number = 1,
  pageSize: number = 100
): Promise<{ items: DepoStokItem[]; totalCount: number }> {
  try {
    const ref = collection(db, 'depoStok');

    // Query for this depot's unshipped items
    const q = query(
      ref,
      where('depotId', '==', depotId),
      where('isShipped', '==', false)
    );

    // Get total count
    const countSnap = await getCountFromServer(q);
    const totalCount = countSnap.data().count;

    // Fetch all items for this depot (Firestore doesn't support offset)
    // We filter/paginate client-side after grouping
    const snap = await getDocs(q);
    const items = snap.docs.map(processDoc);

    return { items, totalCount };
  } catch (err) {
    console.error('Error fetching depot stock page:', err);
    throw new Error('Failed to fetch depot stock page.');
  }
}

/**
 * Updates the 'lastProductTransfers' map in the Hospital document.
 * Uses dot notation (e.g., 'lastProductTransfers.STK001') to partial update.
 */
export async function updateHospitalLastTransferDates(
  hospitalId: string,
  items: Array<{ stokKodu: string }>
) {
  if (!hospitalId || !items || items.length === 0) return;

  try {
    const hospitalRef = doc(db, 'hospitals', hospitalId);
    const updatePayload: Record<string, Date> = {};
    const now = new Date();

    items.forEach((item) => {
      if (item.stokKodu) {
        // "Dot notation" allows updating a nested field without overwriting the whole map
        updatePayload[`lastProductTransfers.${item.stokKodu}`] = now;
      }
    });

    if (Object.keys(updatePayload).length > 0) {
      await updateDoc(hospitalRef, updatePayload);
    }
  } catch (error) {
    // This is an auxiliary update, so it shouldn't crash the main flow.
    console.error('Error updating hospital last transfer dates:', error);
  }
}
