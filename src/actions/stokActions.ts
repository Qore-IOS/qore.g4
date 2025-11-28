
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
