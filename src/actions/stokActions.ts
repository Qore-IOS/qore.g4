
'use server';

import { adminDb } from '@/lib/firebase-admin';
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
import { filterByCompanyScope } from '@/lib/company-scope';
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
export async function getFullDepotStock(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<{ items: DepoStokItem[] }> {
  try {
    const ref = collection(db, 'depoStok');
    const q = query(ref, where('depotId', '==', depotId));
    const snap = await getDocs(q);
    const items = filterByCompanyScope(snap.docs.map(processDoc), companyId, isSuperAdmin);
    return { items };
  } catch (err) {
    console.error('Error fetching full depot stock:', err);
    throw new Error('Failed to fetch full depot stock.');
  }
}

export async function getExpiringItems(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<DepoStokItem[]> {
    const depoStokRef = collection(db, 'depoStok');
    const q = query(
        depoStokRef,
        where('depotId', '==', depotId),
        where('isShipped', '==', false)
    );

    const snapshot = await getDocs(q);
    const allItems = filterByCompanyScope(snapshot.docs.map(processDoc), companyId, isSuperAdmin);

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
  // Server-computed risk metadata (populated when minMaxRules are available).
  miadDays?: number;
  miadSeverity?: 'normal' | 'notice' | 'caution' | 'warning' | 'critical' | 'expired';
  coverageDays?: number;
  coverageSeverity?: 'good' | 'warning' | 'critical' | 'unknown';
  coverageLabel?: string;
  dailyNeed?: number;
  riskyBoxes?: number;
}

export interface PaginatedStockResult {
  rows: GroupedStockRow[];
  totalRows: number;
  totalPages: number;
  currentPage: number;
  /** Total grouped rows that have riskyBoxes > 0 (for the unfiltered set). */
  riskyRowsCount: number;
  /** Sum of riskyBoxes across all rows (used by the rescue banner). */
  riskyBoxesTotal: number;
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
 *
 * Risk metadata (miadDays, coverageDays, riskyBoxes, severities) is computed
 * server-side using the depot's minMaxRules and the global productCodes catalog.
 * The client therefore only ships paint-ready data per page.
 */
export async function getPaginatedDepotStock(params: {
  depotId: string;
  page: number;
  pageSize: number;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  columnFilters?: Record<string, string[]>;
  /** When true, only rows with riskyBoxes > 0 are returned. */
  riskyOnly?: boolean;
  companyId?: string | null;
  isSuperAdmin?: boolean;
}): Promise<PaginatedStockResult> {
  const {
    depotId, page, pageSize, sortField, sortDirection,
    columnFilters, riskyOnly, companyId, isSuperAdmin,
  } = params;

  const emptyResult: PaginatedStockResult = {
    rows: [], totalRows: 0, totalPages: 0, currentPage: 1,
    riskyRowsCount: 0, riskyBoxesTotal: 0,
    columnValues: { stokAdi: [], lotNumarasi: [], miad: [], rafAdresi: [] },
  };

  if (!depotId) {
    return emptyResult;
  }

  try {

  // Fetch stock + depot rules + product catalog in parallel using Admin SDK
  const [snapshot, rulesSnap, productsSnap] = await Promise.all([
    adminDb.collection('depoStok')
      .where('depotId', '==', depotId)
      .where('isShipped', '==', false)
      .get(),
    adminDb.collection('depots').doc(depotId).collection('minMaxRules').get(),
    adminDb.collection('productCodes').get(),
  ]);

  const allItems = filterByCompanyScope(
    snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
    companyId,
    isSuperAdmin,
  );

  // Build helper maps from the side-loaded master data
  const minMaxRules: Record<string, { max?: number; maxGun?: number; min?: number }> = {};
  rulesSnap.forEach((d) => {
    const rule = d.data() as { stokKodu?: string; max?: number; maxGun?: number; min?: number };
    if (rule.stokKodu) minMaxRules[rule.stokKodu] = rule;
  });

  const productByCode = new Map<string, { anaBirim?: string; trackingMode?: string; defaultTrackingMode?: string }>();
  const lotTrackedStokCodes = new Set<string>();
  productsSnap.forEach((d) => {
    const data = d.data() as Record<string, any>;
    const stokKodu: string | undefined = data.stokKodu;
    if (!stokKodu) return;
    productByCode.set(stokKodu, data);
    // Mirror resolveDefaultTrackingMode without importing client-only utilities.
    const trackingMode = data.defaultTrackingMode || data.trackingMode || data.takipModu;
    if (trackingMode === 'serial' || trackingMode === 'lot_barcode' || trackingMode === 'lot_manual') {
      lotTrackedStokCodes.add(stokKodu);
    }
  });

  // Group by (stokKodu, lotNumarasi, miad)
  const grouped: Record<string, GroupedStockRow> = {};
  for (const item of allItems) {
    const lot = item.lotNumarasi || '';
    const rawMiad = item.miad;
    // Admin SDK may return miad as a Firestore Timestamp or a string — normalize.
    let miad = '';
    if (typeof rawMiad === 'string') {
      miad = rawMiad;
    } else if (rawMiad && typeof rawMiad === 'object' && typeof (rawMiad as any).toDate === 'function') {
      const d = (rawMiad as any).toDate() as Date;
      miad = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    }
    const key = `${item.stokKodu}-${lot}-${miad}`;
    if (!grouped[key]) {
      grouped[key] = {
        key,
        stokKodu: item.stokKodu || '',
        stokAdi: item.stokAdi || '',
        lotNumarasi: lot,
        miad,
        anaBirim: productByCode.get(item.stokKodu || '')?.anaBirim || 'Adet',
        rafAdresi: item.rafAdresi || '',
        quantity: 0,
        itemIds: [],
      };
    }
    grouped[key].quantity += 1;
    if (item.id) grouped[key].itemIds.push(item.id);
  }

  let rows = Object.values(grouped);

  // ─── Risk metadata: miad + coverage + riskyBoxes ───
  // Mirrors getMiadInfoFromString / getCoverageInfoForRow / getRiskyBoxes from the panel.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Pre-aggregate "total quantity by stokKodu" so non-lot-tracked coverage uses
  // the depot-wide stock for the same stok code (matches client behaviour).
  const totalByStokKodu = new Map<string, number>();
  rows.forEach((r) => {
    totalByStokKodu.set(r.stokKodu, (totalByStokKodu.get(r.stokKodu) ?? 0) + r.quantity);
  });

  rows = rows.map((row) => {
    // Miad info
    let miadDays = Number.POSITIVE_INFINITY;
    let miadSeverity: GroupedStockRow['miadSeverity'] = 'normal';
    if (row.miad) {
      const miadDate = parse(row.miad, 'dd.MM.yyyy', new Date());
      if (isValid(miadDate)) {
        miadDays = differenceInDays(miadDate, today);
        if (miadDays < 0) miadSeverity = 'expired';
        else if (miadDays <= 3) miadSeverity = 'critical';
        else if (miadDays <= 10) miadSeverity = 'warning';
        else if (miadDays < 45) miadSeverity = 'caution';
        else if (miadDays < 60) miadSeverity = 'notice';
      }
    }

    // Coverage info
    let coverageSeverity: GroupedStockRow['coverageSeverity'] = 'unknown';
    let coverageLabel = 'Min/Max tanımsız';
    let coverageDays = 0;
    let dailyNeed = 0;
    const rule = minMaxRules[row.stokKodu];
    if (rule && rule.max && rule.maxGun) {
      const stockForCoverage = lotTrackedStokCodes.has(row.stokKodu)
        ? row.quantity
        : (totalByStokKodu.get(row.stokKodu) ?? row.quantity);
      const periodDays = Math.floor(rule.maxGun);
      if (periodDays > 0) {
        dailyNeed = rule.max / periodDays;
        if (dailyNeed > 0) {
          coverageDays = Math.floor(stockForCoverage / dailyNeed);
          if (coverageDays <= 3) { coverageSeverity = 'critical'; coverageLabel = `${coverageDays} gün`; }
          else if (coverageDays <= 10) { coverageSeverity = 'warning'; coverageLabel = `${coverageDays} gün`; }
          else { coverageSeverity = 'good'; coverageLabel = `${coverageDays} gün yeter`; }
        } else {
          coverageLabel = 'Hesaplanamadı';
        }
      } else {
        coverageLabel = 'Hesaplanamadı';
      }
    }

    // Risky boxes (only meaningful when coverage outruns expiry)
    let riskyBoxes = 0;
    if (
      coverageSeverity !== 'unknown' &&
      Number.isFinite(miadDays) &&
      miadDays > 0 &&
      coverageDays > miadDays
    ) {
      const riskyDays = coverageDays - miadDays;
      riskyBoxes = Math.max(0, Math.ceil(riskyDays * dailyNeed));
    }

    return {
      ...row,
      miadDays: Number.isFinite(miadDays) ? miadDays : undefined,
      miadSeverity,
      coverageDays,
      coverageSeverity,
      coverageLabel,
      dailyNeed,
      riskyBoxes,
    };
  });

  // Risky aggregates over the unfiltered, ungrouped-by-page rows.
  const riskyRowsCount = rows.reduce((acc, r) => acc + ((r.riskyBoxes ?? 0) > 0 ? 1 : 0), 0);
  const riskyBoxesTotal = rows.reduce((acc, r) => acc + (r.riskyBoxes ?? 0), 0);

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

  // Risky-only filter (applied after column filters, before sort+paginate)
  if (riskyOnly) {
    rows = rows.filter((r) => (r.riskyBoxes ?? 0) > 0);
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
    riskyRowsCount,
    riskyBoxesTotal,
    columnValues,
  };

  } catch (err) {
    console.error('[getPaginatedDepotStock] Error for depot', depotId, ':', err);
    return emptyResult;
  }
}

/**
 * Returns the count of unique product groups (stokKodu+lot+miad)
 * whose miad is within the next `thresholdDays` days,
 * across ALL depots. Server-side computation – only the count is returned.
 */
export async function getExpiringProductsCount(
  thresholdDays: number = 45,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<number> {
  try {
    // Composite query: isShipped (requires Firestore index)
    const stockQuery = query(
      collection(db, 'depoStok'),
      where('isShipped', '==', false)
    );
    const snapshot = await getDocs(stockQuery);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const seenKeys = new Set<string>();
    let count = 0;

    const scopedDocs = isSuperAdmin
      ? snapshot.docs
      : snapshot.docs.filter((d) => {
          const data = d.data();
          return filterByCompanyScope([data], companyId, isSuperAdmin).length > 0;
        });

    for (const docSnap of scopedDocs) {
      const data = docSnap.data();
      const miadStr = typeof data.miad === 'string' ? data.miad : '';
      if (!miadStr) continue;
      const miadDate = parse(miadStr, 'dd.MM.yyyy', new Date());
      if (!isValid(miadDate)) continue;

      const days = differenceInDays(miadDate, today);
      if (days <= thresholdDays && days >= 0) {
        const key = `${data.stokKodu}-${data.lotNumarasi || ''}-${miadStr}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          count += 1;
        }
      }
    }

    return count;
  } catch (error) {
    console.error('Error counting expiring products:', error);
    return 0;
  }
}
