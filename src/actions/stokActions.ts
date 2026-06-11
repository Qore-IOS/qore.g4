
'use server';

import { adminDb } from '@/lib/firebase-admin';
import { Timestamp as AdminTimestamp, FieldValue } from 'firebase-admin/firestore';
import type { DepoStokItem, ProductCode } from '@/lib/types';
import { safeCompareByMiad, toDateSafe } from "@/lib/date";
import { differenceInDays, parse, isValid, compareAsc } from 'date-fns';
import { filterByCompanyScope, matchesCompanyScope } from '@/lib/company-scope';
import fs from 'fs/promises';
import path from 'path';

/*
 * STABİLİZASYON: bu dosyadaki bazı server action'lar daha önce CLIENT
 * Firebase SDK'sını ('@/lib/firebase' → getDocs/updateDoc) SUNUCUDA
 * çağırıyordu. Sunucuda client SDK'nın oturumu yoktur → security rules
 * (`isSignedIn()`) tüm bu okuma/yazmaları reddediyordu: miad sayacı hep 0
 * dönüyor, lab transfer tarihleri hiç yazılmıyordu — üstelik hatalar
 * catch'lerde yutulduğu için kimse görmüyordu. Tamamı Admin SDK'ya taşındı.
 */

// Helper: convert Firestore Timestamps → JS Dates (Admin SDK dokümanları)
function processAdminDoc(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): DepoStokItem {
  const data = doc.data();
  Object.keys(data).forEach(key => {
    const v = data[key];
    if (v && typeof v === 'object' && typeof (v as any).toDate === 'function') {
      data[key] = (v as any).toDate();
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
    const snap = await adminDb
      .collection('depoStok')
      .where('depotId', '==', depotId)
      .get();
    const items = filterByCompanyScope(snap.docs.map(processAdminDoc), companyId, isSuperAdmin);
    return { items };
  } catch (err) {
    console.error('Error fetching full depot stock:', err);
    throw new Error('Failed to fetch full depot stock.');
  }
}

/**
 * Compact serial index for a depot — used by Mal Kabul duplicate detection.
 *
 * Mal Kabul only needs the SET of serial numbers already present in a depot to
 * reject duplicate scans; it does not need the full DepoStokItem documents.
 * Previously the panel downloaded the entire `depoStok` collection for the
 * selected depot (via the `useDepoStokByDepot` client hook) just to build this
 * set. Running thousands of docs through the Firestore web SDK + IndexedDB
 * persistence layer was the main cause of the panel's slow open and per-scan
 * main-thread contention.
 *
 * This server action instead:
 *   1. Reads `depoStok` with the Admin SDK (no client persistence layer), and
 *   2. Projects ONLY `stokKodu` / `seriNumarasi` / `companyId` via `.select()`,
 *      so Firestore returns a fraction of each document, and
 *   3. Returns a de-duplicated `Record<stokKodu, string[]>` map — a tiny
 *      payload compared to the full dataset.
 *
 * Behaviour matches the old client query (all stock for the depot, regardless
 * of `isShipped`) so duplicate detection is unchanged.
 */
export type DepotSerialIndex = Record<string, string[]>;

export async function getDepotSerialIndex(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<DepotSerialIndex> {
  if (!depotId) return {};
  try {
    const snap = await adminDb
      .collection('depoStok')
      .where('depotId', '==', depotId)
      .select('stokKodu', 'seriNumarasi', 'companyId')
      .get();

    const serialsByProduct = new Map<string, Set<string>>();
    snap.forEach((docSnap) => {
      const data = docSnap.data() as {
        stokKodu?: string;
        seriNumarasi?: string;
        companyId?: string | null;
      };
      // Defense-in-depth company scoping (mirrors filterByCompanyScope, but
      // per-item so we never materialize an intermediate array).
      if (!matchesCompanyScope(data, companyId, isSuperAdmin)) return;
      const stokKodu = data.stokKodu;
      const serial = data.seriNumarasi;
      if (!stokKodu || !serial) return;
      let set = serialsByProduct.get(stokKodu);
      if (!set) {
        set = new Set<string>();
        serialsByProduct.set(stokKodu, set);
      }
      set.add(serial);
    });

    const index: DepotSerialIndex = {};
    for (const [stokKodu, serials] of serialsByProduct) {
      index[stokKodu] = Array.from(serials);
    }
    return index;
  } catch (err) {
    console.error('[getDepotSerialIndex] Error for depot', depotId, ':', err);
    return {};
  }
}

export async function getExpiringItems(
  depotId: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<DepoStokItem[]> {
    const snapshot = await adminDb
      .collection('depoStok')
      .where('depotId', '==', depotId)
      .where('isShipped', '==', false)
      .get();
    const allItems = filterByCompanyScope(snapshot.docs.map(processAdminDoc), companyId, isSuperAdmin);

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

export async function getExpiringProductsCountServer(
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<number> {
  try {
    // select() projeksiyonu: sayaç için dokümanların yalnız 4 alanı gerekir.
    const snapshot = await adminDb
      .collection('depoStok')
      .where('isShipped', '==', false)
      .select('stokKodu', 'lotNumarasi', 'miad', 'companyId')
      .get();
    const allItems = filterByCompanyScope(
      snapshot.docs.map(d => ({ stokKodu: d.data().stokKodu, lotNumarasi: d.data().lotNumarasi, miad: d.data().miad, companyId: d.data().companyId })),
      companyId,
      isSuperAdmin
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const seenKeys = new Set<string>();
    let count = 0;

    allItems.forEach(data => {
      const miadStr = typeof data.miad === 'string' ? data.miad : '';
      if (!miadStr) return;
      const miadDate = parse(miadStr, 'dd.MM.yyyy', new Date());
      if (!isValid(miadDate)) return;
      const days = differenceInDays(miadDate, today);
      if (days <= 45) {
        const key = `${data.stokKodu}-${data.lotNumarasi || ''}-${miadStr}`;
        if (!seenKeys.has(key)) { seenKeys.add(key); count++; }
      }
    });

    return count;
  } catch (err) {
    console.error('Error getting expiring products count:', err);
    return 0;
  }
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
    const hospitalRef = adminDb.collection('hospitals').doc(hospitalId);
    const updatePayload: Record<string, Date> = {};
    const now = new Date();

    items.forEach((item) => {
      if (item.stokKodu) {
        // "Dot notation" allows updating a nested field without overwriting the whole map
        updatePayload[`lastProductTransfers.${item.stokKodu}`] = now;
      }
    });

    if (Object.keys(updatePayload).length > 0) {
      await hospitalRef.update(updatePayload);
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
    const docRef = adminDb.collection('labTransferDates').doc(docId);
    const now = new Date();

    // Check if document exists
    const existingDoc = await docRef.get();

    if (existingDoc.exists) {
      // Update existing document with dot notation
      const updatePayload: Record<string, any> = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      items.forEach((item) => {
        if (item.stokKodu) {
          updatePayload[`transfers.${item.stokKodu}`] = {
            lastTransferDate: AdminTimestamp.fromDate(now),
            lastTransferBy: transferredBy ?? null,
          };
        }
      });

      await docRef.update(updatePayload);
    } else {
      // Create new document
      const transfers: Record<string, { lastTransferDate: any; lastTransferBy?: string | null }> = {};

      items.forEach((item) => {
        if (item.stokKodu) {
          transfers[item.stokKodu] = {
            lastTransferDate: AdminTimestamp.fromDate(now),
            lastTransferBy: transferredBy ?? null,
          };
        }
      });

      await docRef.set({
        labId,
        depotId,
        labName,
        depotName,
        transfers,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (error) {
    console.error('Error updating lab transfer dates:', error);
  }
}

/* ================================================================
   Ürün kataloğu sunucu önbelleği
   ================================================================
   getPaginatedDepotStock ve getPaginatedProductCodes her sayfa/sıralama/
   filtre değişiminde TÜM productCodes koleksiyonunu yeniden okuyordu.
   Katalog dakikalar içinde değişmez; kısa TTL'li instance içi önbellek
   tablo gezinmesini Firestore'a tekrar tekrar tam tarama yaptırmaktan
   kurtarır. (Serverless instance başına ayrı önbellek — kabul edilebilir
   bayatlık: en fazla TTL kadar.) */

type CatalogDoc = { id: string; data: Record<string, any> };

const PRODUCT_CATALOG_TTL_MS = 60_000;
let productCatalogCache: { at: number; docs: CatalogDoc[] } | null = null;
let productCatalogInFlight: Promise<CatalogDoc[]> | null = null;

async function getProductCatalogDocs(): Promise<CatalogDoc[]> {
  const now = Date.now();
  if (productCatalogCache && now - productCatalogCache.at < PRODUCT_CATALOG_TTL_MS) {
    return productCatalogCache.docs;
  }
  // Eşzamanlı istekler tek okuma paylaşır (request coalescing).
  if (productCatalogInFlight) return productCatalogInFlight;
  productCatalogInFlight = (async () => {
    try {
      const snap = await adminDb.collection('productCodes').get();
      const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      productCatalogCache = { at: Date.now(), docs };
      return docs;
    } finally {
      productCatalogInFlight = null;
    }
  })();
  return productCatalogInFlight;
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
  /** Brand from productCodes — used by the marka column filter. */
  marka?: string;
  // Server-computed risk metadata (populated when minMaxRules are available).
  miadDays?: number;
  miadSeverity?: 'normal' | 'notice' | 'caution' | 'warning' | 'critical' | 'expired';
  coverageDays?: number;
  coverageSeverity?: 'good' | 'warning' | 'critical' | 'unknown';
  coverageLabel?: string;
  dailyNeed?: number;
  riskyBoxes?: number;
  /** True when an active minMax rule says quantity is at or below the minimum. */
  belowMin?: boolean;
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
    /** Stok Adı options carry the matching stokKodu so the filter UI can show
     *  the product code and search by it. The `value` field is what the server
     *  matches against `r.stokAdi` when the filter is applied. */
    stokAdi: Array<{ value: string; code: string }>;
    lotNumarasi: string[];
    miad: string[];
    rafAdresi: string[];
    /** Distinct brands present in the depot, used by the marka filter. */
    marka: string[];
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
    columnValues: { stokAdi: [], lotNumarasi: [], miad: [], rafAdresi: [], marka: [] },
  };

  if (!depotId) {
    return emptyResult;
  }

  try {

  // Önce depo dokümanını oku — ceomedEnabled ise akış değişir (ceomedDepoStok'tan oku)
  const depotDoc = await adminDb.collection('depots').doc(depotId).get();
  const isCeomedDepot = !!(depotDoc.exists && (depotDoc.data() as any)?.ceomedEnabled);

  let allItems: DepoStokItem[] = [];
  let rulesSnap: FirebaseFirestore.QuerySnapshot;
  let productDocs: CatalogDoc[];

  if (isCeomedDepot) {
    // Ceomed entegre depo: ceomedDepoStok/{depotId} dokümanından oku
    const [ceomedDoc, rules, products] = await Promise.all([
      adminDb.collection('ceomedDepoStok').doc(depotId).get(),
      adminDb.collection('depots').doc(depotId).collection('minMaxRules').get(),
      getProductCatalogDocs(),
    ]);
    rulesSnap = rules;
    productDocs = products;

    if (ceomedDoc.exists) {
      const data = ceomedDoc.data() as any;
      const items = (data.items || []) as Array<{
        stokKodu: string; stokAdi: string; lot: string; miyat: string; adet: number;
      }>;
      // Ceomed itemleri DepoStokItem şekline normalize et
      allItems = items.map((it, idx) => ({
        id: `ceomed-${depotId}-${idx}`,
        depotId,
        stokKodu: it.stokKodu || '',
        stokAdi: it.stokAdi || '',
        lotNumarasi: it.lot || '',
        miad: it.miyat || '',
        adet: Number(it.adet) || 0,
        rafAdresi: '',
        isShipped: false,
      } as unknown as DepoStokItem));
    }
  } else {
    // Fetch stock + depot rules + product catalog in parallel using Admin SDK
    const [snapshot, rules, products] = await Promise.all([
      adminDb.collection('depoStok')
        .where('depotId', '==', depotId)
        .where('isShipped', '==', false)
        .get(),
      adminDb.collection('depots').doc(depotId).collection('minMaxRules').get(),
      getProductCatalogDocs(),
    ]);
    rulesSnap = rules;
    productDocs = products;
    allItems = filterByCompanyScope(
      snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)),
      companyId,
      isSuperAdmin,
    );
  }

  // Build helper maps from the side-loaded master data
  const minMaxRules: Record<string, { max?: number; maxGun?: number; min?: number }> = {};
  rulesSnap.forEach((d) => {
    const rule = d.data() as { stokKodu?: string; max?: number; maxGun?: number; min?: number };
    if (rule.stokKodu) minMaxRules[rule.stokKodu] = rule;
  });

  const productByCode = new Map<string, { anaBirim?: string; trackingMode?: string; defaultTrackingMode?: string; marka?: string }>();
  const lotTrackedStokCodes = new Set<string>();
  for (const d of productDocs) {
    const data = d.data as Record<string, any>;
    const stokKodu: string | undefined = data.stokKodu;
    if (!stokKodu) continue;
    productByCode.set(stokKodu, data);
    // Mirror resolveDefaultTrackingMode without importing client-only utilities.
    const trackingMode = data.defaultTrackingMode || data.trackingMode || data.takipModu;
    if (trackingMode === 'serial' || trackingMode === 'lot_barcode' || trackingMode === 'lot_manual') {
      lotTrackedStokCodes.add(stokKodu);
    }
  }

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
      const product = productByCode.get(item.stokKodu || '');
      grouped[key] = {
        key,
        stokKodu: item.stokKodu || '',
        stokAdi: item.stokAdi || '',
        lotNumarasi: lot,
        miad,
        anaBirim: product?.anaBirim || 'Adet',
        rafAdresi: item.rafAdresi || '',
        quantity: 0,
        itemIds: [],
        marka: product?.marka || '',
      };
    }
    const qty = (item.adet && typeof item.adet === 'number') ? item.adet : 1;
    grouped[key].quantity += qty;
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

    // Below-min flag — drives the "Min. Stok" legend chip and slate row stripe.
    const belowMin = !!(rule && rule.min !== undefined && row.quantity <= rule.min);

    return {
      ...row,
      miadDays: Number.isFinite(miadDays) ? miadDays : undefined,
      miadSeverity,
      coverageDays,
      coverageSeverity,
      coverageLabel,
      dailyNeed,
      riskyBoxes,
      belowMin,
    };
  });

  // Risky aggregates over the unfiltered, ungrouped-by-page rows.
  const riskyRowsCount = rows.reduce((acc, r) => acc + ((r.riskyBoxes ?? 0) > 0 ? 1 : 0), 0);
  const riskyBoxesTotal = rows.reduce((acc, r) => acc + (r.riskyBoxes ?? 0), 0);

  // Collect unique column values BEFORE filtering (so filter dropdowns show all options).
  // For stokAdi we also collect the matching stokKodu(s) so the filter dropdown can
  // show the product code beside the name and let users search by either.
  const stokAdiToCodes = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.stokAdi) continue;
    if (!stokAdiToCodes.has(r.stokAdi)) stokAdiToCodes.set(r.stokAdi, new Set());
    if (r.stokKodu) stokAdiToCodes.get(r.stokAdi)!.add(r.stokKodu);
  }
  const stokAdiOptions = Array.from(stokAdiToCodes.entries())
    .map(([stokAdi, codes]) => ({
      value: stokAdi,
      code: Array.from(codes).sort().join(', '),
    }))
    .sort((a, b) => a.value.localeCompare(b.value, 'tr'));

  const columnValues: PaginatedStockResult['columnValues'] = {
    stokAdi: stokAdiOptions,
    lotNumarasi: [...new Set(rows.map(r => r.lotNumarasi).filter(Boolean))].sort(),
    miad: [...new Set(rows.map(r => r.miad).filter(Boolean))].sort(),
    rafAdresi: [...new Set(rows.map(r => r.rafAdresi).filter(Boolean))].sort(),
    marka: [...new Set(rows.map(r => r.marka).filter((m): m is string => !!m))].sort((a, b) => a.localeCompare(b, 'tr')),
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
      const aStr = String(aVal).trim();
      const bStr = String(bVal).trim();
      const dateA = aStr ? parse(aStr, 'dd.MM.yyyy', new Date()) : null;
      const dateB = bStr ? parse(bStr, 'dd.MM.yyyy', new Date()) : null;
      const validA = !!dateA && isValid(dateA);
      const validB = !!dateB && isValid(dateB);
      // "Blanks last": rows with no parseable miad sink to the bottom
      // regardless of sort direction, so the nearest expiries always lead.
      if (!validA && !validB) return 0;
      if (!validA) return 1;
      if (!validB) return -1;
      return sortDirection === 'asc' ? compareAsc(dateA!, dateB!) : compareAsc(dateB!, dateA!);
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
    const snapshot = await adminDb
      .collection('depoStok')
      .where('isShipped', '==', false)
      .select('stokKodu', 'lotNumarasi', 'miad', 'companyId')
      .get();
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

/* ================================================================
   Paginated Product Codes – returned from server-side pagination
   ================================================================ */

export interface PaginatedProductCodesResult {
  rows: ProductCode[];
  totalRows: number;
  totalPages: number;
  currentPage: number;
  /** Unique values per column – used for Excel-like column filters */
  columnValues: {
    marka: string[];
    urunGrubu: string[];
    testGrubu: string[];
    cihazGrubu: string[];
    laboratuvarGrubu: string[];
  };
  /** Brand → count map for the brand tab chips (computed from ALL products, not just the page). */
  brandCounts: Record<string, number>;
}

/**
 * Server-side paginated product codes.
 * Fetches the entire productCodes collection via Admin SDK, applies search/filter/sort,
 * and returns only the requested page to the client.
 *
 * This mirrors getPaginatedDepotStock's pattern so that large product catalogs
 * don't need to be shipped to the client in full just to render a table.
 */
export async function getPaginatedProductCodes(params: {
  page: number;
  pageSize: number;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  searchTerm?: string;
  /** Column filters: key = field name on ProductCode, values = allowed values. */
  columnFilters?: Record<string, string[]>;
  /** When set, acts as a brand tab filter (equivalent to columnFilters.marka). */
  brandTab?: string;
  companyId?: string | null;
  isSuperAdmin?: boolean;
}): Promise<PaginatedProductCodesResult> {
  const {
    page, pageSize, sortField, sortDirection,
    searchTerm, columnFilters, brandTab,
    companyId, isSuperAdmin,
  } = params;

  const emptyResult: PaginatedProductCodesResult = {
    rows: [], totalRows: 0, totalPages: 0, currentPage: 1,
    columnValues: { marka: [], urunGrubu: [], testGrubu: [], cihazGrubu: [], laboratuvarGrubu: [] },
    brandCounts: {},
  };

  try {
    // Fetch all product codes via Admin SDK (TTL'li instance önbelleği —
    // sayfa/sıralama/filtre geçişleri tam koleksiyonu yeniden okutmaz)
    const catalogDocs = await getProductCatalogDocs();

    let allProducts: ProductCode[] = catalogDocs.map(d => {
      const data = { ...d.data };
      // Convert Firestore Timestamps → plain values (same as processDoc)
      Object.keys(data).forEach(key => {
        if (data[key] && typeof data[key] === 'object' && typeof data[key].toDate === 'function') {
          data[key] = data[key].toDate();
        }
      });
      return { id: d.id, ...data } as ProductCode;
    });

    // Company scope filtering
    allProducts = filterByCompanyScope(allProducts, companyId, isSuperAdmin);

    // ─── Brand counts (before any filtering, so tabs always show full counts) ───
    const brandCounts: Record<string, number> = {};
    allProducts.forEach(p => {
      const brand = p.marka || 'Diğer';
      brandCounts[brand] = (brandCounts[brand] || 0) + 1;
    });

    // ─── Collect unique column values BEFORE filtering ───
    const columnValues: PaginatedProductCodesResult['columnValues'] = {
      marka: [...new Set(allProducts.map(p => p.marka).filter((m): m is string => !!m))].sort((a, b) => a.localeCompare(b, 'tr')),
      urunGrubu: [...new Set(allProducts.map(p => p.urunGrubu).filter((u): u is string => !!u))].sort(),
      testGrubu: [...new Set(allProducts.map(p => p.testGrubu).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, 'tr')),
      cihazGrubu: [...new Set(allProducts.map(p => p.cihazGrubu).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'tr')),
      laboratuvarGrubu: [...new Set(allProducts.map(p => p.laboratuvarGrubu).filter((l): l is string => !!l))].sort((a, b) => a.localeCompare(b, 'tr')),
    };

    let rows = allProducts;

    // ─── Brand tab filter ───
    if (brandTab && brandTab !== 'ALL') {
      if (brandTab === 'Diğer') {
        rows = rows.filter(p => !p.marka);
      } else {
        rows = rows.filter(p => p.marka === brandTab);
      }
    }

    // ─── Column filters ───
    if (columnFilters) {
      for (const [col, values] of Object.entries(columnFilters)) {
        if (values.length === 0) continue;
        rows = rows.filter(r => {
          const fieldVal = (r as any)[col];
          return values.includes(String(fieldVal ?? ''));
        });
      }
    }

    // ─── Search ───
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      rows = rows.filter(p =>
        p.stokKodu.toLowerCase().includes(lower) ||
        p.stokAdi.toLowerCase().includes(lower)
      );
    }

    // ─── Sort ───
    rows.sort((a, b) => {
      const aVal = (a as any)[sortField] ?? '';
      const bVal = (b as any)[sortField] ?? '';

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      return sortDirection === 'asc'
        ? String(aVal).localeCompare(String(bVal), 'tr')
        : String(bVal).localeCompare(String(aVal), 'tr');
    });

    // ─── Paginate ───
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
      brandCounts,
    };
  } catch (err) {
    console.error('[getPaginatedProductCodes] Error:', err);
    return emptyResult;
  }
}
