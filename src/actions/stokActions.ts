
'use server';

import { db } from '@/lib/firebase';
import type { DepoStokItem } from '@/lib/types';
import {
  collection,
  query,
  where,
  getDocs,
  getCountFromServer,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
  doc,
  updateDoc,
  setDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { safeCompareByMiad, toDateSafe } from "@/lib/date";
import { differenceInDays, parse, isValid, compareAsc } from 'date-fns';
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
 * @deprecated Use updateLabTransferDates instead
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

/**
 * Updates the labTransferDates collection with last transfer dates.
 * Document ID format: {labId}_{depotId}
 * Uses dot notation to partial update individual product transfer dates.
 */
export async function updateLabTransferDates(
  labId: string,
  depotId: string,
  labName: string,
  depotName: string,
  items: Array<{ stokKodu: string }>,
  transferredBy?: string
) {
  if (!labId || !depotId || !items || items.length === 0) return;

  try {
    const docId = `${labId}_${depotId}`;
    const docRef = doc(db, 'labTransferDates', docId);
    const now = new Date();

    // Check if document exists
    const existingDoc = await getDoc(docRef);

    if (existingDoc.exists()) {
      // Update existing document with dot notation
      const updatePayload: Record<string, any> = {
        updatedAt: serverTimestamp(),
      };

      items.forEach((item) => {
        if (item.stokKodu) {
          updatePayload[`transfers.${item.stokKodu}`] = {
            lastTransferDate: Timestamp.fromDate(now),
            lastTransferBy: transferredBy || undefined,
          };
        }
      });

      await updateDoc(docRef, updatePayload);
    } else {
      // Create new document
      const transfers: Record<string, { lastTransferDate: any; lastTransferBy?: string }> = {};

      items.forEach((item) => {
        if (item.stokKodu) {
          transfers[item.stokKodu] = {
            lastTransferDate: Timestamp.fromDate(now),
            lastTransferBy: transferredBy || undefined,
          };
        }
      });

      await setDoc(docRef, {
        labId,
        depotId,
        labName,
        depotName,
        transfers,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.error('Error updating lab transfer dates:', error);
  }
}

/* ================================================================
   Grouped Stock Row – returned from server-side pagination
   ================================================================ */
export interface GroupedStockRow {
  key: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  anaBirim: string;
  rafAdresi: string;
  quantity: number;
  itemIds: string[];
}

export interface PaginatedStockResult {
  rows: GroupedStockRow[];
  totalRows: number;
  totalPages: number;
  currentPage: number;
  /** Unique values per column – used for Excel-like column filters */
  columnValues: {
    stokAdi: string[];
    lotNumarasi: string[];
    miad: string[];
    rafAdresi: string[];
  };
}

/**
 * Server-side paginated + grouped depot stock.
 * Groups individual DepoStokItem docs by (stokKodu, lotNumarasi, miad).
 * Only the requested page of grouped rows is returned to the client.
 */
export async function getPaginatedDepotStock(params: {
  depotId: string;
  page: number;
  pageSize: number;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  columnFilters?: Record<string, string[]>;
}): Promise<PaginatedStockResult> {
  const { depotId, page, pageSize, sortField, sortDirection, columnFilters } = params;

  if (!depotId) {
    return { rows: [], totalRows: 0, totalPages: 0, currentPage: 1, columnValues: { stokAdi: [], lotNumarasi: [], miad: [], rafAdresi: [] } };
  }

  // Composite query: depotId + isShipped (requires Firestore composite index)
  const stockQuery = query(
    collection(db, 'depoStok'),
    where('depotId', '==', depotId),
    where('isShipped', '==', false)
  );
  const snapshot = await getDocs(stockQuery);
  const allItems = snapshot.docs.map(processDoc);

  // Group by (stokKodu, lotNumarasi, miad)
  const grouped: Record<string, GroupedStockRow> = {};
  for (const item of allItems) {
    const lot = item.lotNumarasi || '';
    const miad = typeof item.miad === 'string' ? item.miad : '';
    const key = `${item.stokKodu}-${lot}-${miad}`;
    if (!grouped[key]) {
      grouped[key] = {
        key,
        stokKodu: item.stokKodu || '',
        stokAdi: item.stokAdi || '',
        lotNumarasi: lot,
        miad,
        anaBirim: 'Kutu',
        rafAdresi: item.rafAdresi || '',
        quantity: 0,
        itemIds: [],
      };
    }
    grouped[key].quantity += 1;
    if (item.id) grouped[key].itemIds.push(item.id);
  }

  let rows = Object.values(grouped);

  // Collect unique column values BEFORE filtering (so filter dropdowns show all options)
  const columnValues = {
    stokAdi: [...new Set(rows.map(r => r.stokAdi))].sort(),
    lotNumarasi: [...new Set(rows.map(r => r.lotNumarasi).filter(Boolean))].sort(),
    miad: [...new Set(rows.map(r => r.miad).filter(Boolean))].sort(),
    rafAdresi: [...new Set(rows.map(r => r.rafAdresi).filter(Boolean))].sort(),
  };

  // Apply column filters
  if (columnFilters) {
    for (const [col, values] of Object.entries(columnFilters)) {
      if (values.length === 0) continue;
      rows = rows.filter(r => {
        const fieldVal = (r as any)[col];
        return values.includes(String(fieldVal ?? ''));
      });
    }
  }

  // Sort
  rows.sort((a, b) => {
    const aVal = (a as any)[sortField] ?? '';
    const bVal = (b as any)[sortField] ?? '';

    if (sortField === 'miad') {
      const dateA = parse(String(aVal), 'dd.MM.yyyy', new Date());
      const dateB = parse(String(bVal), 'dd.MM.yyyy', new Date());
      if (isValid(dateA) && isValid(dateB)) {
        return sortDirection === 'asc' ? compareAsc(dateA, dateB) : compareAsc(dateB, dateA);
      }
    }

    if (sortField === 'quantity') {
      return sortDirection === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    }

    return sortDirection === 'asc'
      ? String(aVal).localeCompare(String(bVal), 'tr')
      : String(bVal).localeCompare(String(aVal), 'tr');
  });

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    rows: pageRows,
    totalRows,
    totalPages,
    currentPage: safePage,
    columnValues,
  };
}

/**
 * Returns the count of unique product groups (stokKodu+lot+miad)
 * whose miad is within the next `thresholdDays` days,
 * across ALL depots. Server-side computation – only the count is returned.
 */
/**
 * Server-side: Toplam depo stok maliyetini hesaplar.
 * depoStok koleksiyonundaki her ürün için productCodes'taki cost ile çarpıp toplar.
 * Lot/miad ayrımı yapmaz — sadece stokKodu bazında adet * birim maliyet.
 */
export async function getTotalStockCost(): Promise<{ total: number; stockCount: number; productCount: number; matchedCount: number }> {
  try {
    // isShipped alanı olmayan dokümanları da kapsamak için tüm koleksiyonu çekip client-side filtrele
    const [productSnap, stockSnap] = await Promise.all([
      getDocs(collection(db, 'productCodes')),
      getDocs(collection(db, 'depoStok')),
    ]);

    const costMap = new Map<string, number>();
    productSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.cost && data.stokKodu) costMap.set(data.stokKodu, data.cost);
    });

    let total = 0;
    let matchedCount = 0;
    stockSnap.docs.forEach((d) => {
      const data = d.data();
      // isShipped === true olanları atla
      if (data.isShipped === true) return;
      const cost = costMap.get(data.stokKodu);
      if (cost) {
        total += cost;
        matchedCount++;
      }
    });

    return { total, stockCount: stockSnap.docs.length, productCount: productSnap.docs.length, matchedCount };
  } catch (error) {
    console.error('Error calculating total stock cost:', error);
    return { total: 0, stockCount: 0, productCount: 0, matchedCount: 0 };
  }
}

export async function getExpiringProductsCount(thresholdDays: number = 45): Promise<number> {
  try {
    // Tüm depo stoklarını çek, isShipped === true olanları atla
    const snapshot = await getDocs(collection(db, 'depoStok'));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const seenKeys = new Set<string>();
    let count = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      if (data.isShipped === true) continue;

      const miadStr = typeof data.miad === 'string' ? data.miad : '';
      if (!miadStr) continue;
      const miadDate = parse(miadStr, 'dd.MM.yyyy', new Date());
      if (!isValid(miadDate)) continue;

      const days = differenceInDays(miadDate, today);
      if (days <= thresholdDays) {
        const key = `${data.stokKodu}-${data.lotNumarasi || ''}-${miadStr}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          count += 1;
        }
      }
    }

    console.log(`[getExpiringProductsCount] Total docs: ${snapshot.docs.length}, expiring: ${count}`);
    return count;
  } catch (error) {
    console.error('Error counting expiring products:', error);
    return 0;
  }
}
