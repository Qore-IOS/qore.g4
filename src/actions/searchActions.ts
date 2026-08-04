'use server';
import { adminDb } from '@/lib/firebase-admin';
import type { DepoStokItem, Shipment, ConsumptionRecord, Depot, ProductCode, User, Transfer } from '@/lib/types';
import { filterByCompanyScope, normalizeCompanyId } from '@/lib/company-scope';

// İşlem tipi - tüm alt türleri dahil
export type IslemTipi =
  | 'Mal Kabul'
  | 'Karşılanan Sipariş'
  | 'Direkt Transfer'
  | 'Kullanım'
  | 'İmha'
  | 'Sayımdan Düşüm'
  | 'Laboratuvardan İade';

// Consolidated row type for the ledger
export interface LedgerRow {
  id: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: string;
  islemTipi: IslemTipi;
  actor?: string;
  tarih: Date;
  adet: number;
  seriNolar: string[];
  konum: string;
  hedefKonum?: string;
  postAdetDepo?: number;
  postAdetHedef?: number;
}

export interface StockSummary {
  konum: string;
  /** 'borc' = borç verilen (sevk edilmiş, laboratuvara bağlı olmayan) stok */
  konumTipi: 'depo' | 'laboratuvar' | 'borc';
  adet: number;
  birim: string;
}

export interface ProductMatch {
  stokKodu: string;
  stokAdi: string;
  anaBirim?: string;
}

/**
 * Seri No Defteri'ndeki (serialLedger) güncel satır.
 *
 * Arama sonucunda bir seri numarasının ŞU AN nerede olduğunu ve son hangi
 * işlemden geçtiğini tek bakışta gösterir. Defter `ürün kodu + seri no`
 * başına tek satır tuttuğu için aynı seri numarası birden çok üründe geçiyorsa
 * her biri ayrı satır olarak döner.
 */
export interface SerialLedgerSummary {
  id: string;
  stokKodu: string;
  stokAdi: string;
  seriNumarasi: string;
  lotNumarasi: string;
  miad: string;
  status: string;
  locationType: string;
  locationName: string;
  lastEventType: string;
  lastEventAt: Date | null;
  eventCount: number;
}

export interface SearchResult {
  ledgerRows: LedgerRow[];
  stockSummary: StockSummary[];
  searchType: 'product' | 'lot' | 'serial';
  /** Seri aramasında bulunan defter satırları (birimin güncel durumu). */
  serialLedger?: SerialLedgerSummary[];
  /** When set, the UI must let the user pick one of these products before loading details. */
  productMatches?: ProductMatch[];
  /** True when the result is just a list of products to choose from (no ledger fetched yet). */
  needsProductSelection?: boolean;
}

// --- Helpers ---

const serialsOfDepoStok = (d: any): string[] =>
  Array.from(new Set([d?.seriNumarasi, d?.seriNo, d?.serialNumber, d?.serialNo].filter(Boolean) as string[]));

const serialsOfShipmentItem = (it: any): string[] =>
  Array.from(new Set((it?.serialNumbers || it?.seriNolar || it?.seriNoList || []) as string[]));

const serialOfConsumption = (rec: any): string | null =>
  rec?.seriNumarasi || rec?.seriNo || rec?.serialNumber || null;

const normDate = (d: any): Date => {
  if (!d) return new Date(0);
  if (d?.toDate) return d.toDate();
  if (d?.seconds) return new Date(d.seconds * 1000);
  if (d instanceof Date) return d;
  if (typeof d === 'string') {
    const parts = d.split('.');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(parsed.getTime())) return parsed;
    }
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  if (typeof d === 'number') return new Date(d);
  return new Date(0);
};

const formatMiad = (d: any): string => {
  if (!d) return '-';
  if (typeof d === 'string') {
    const parts = d.split('.');
    if (parts.length === 3 && parts[0].length <= 2 && parts[1].length <= 2 && parts[2].length === 4) {
      return d;
    }
    const date = normDate(d);
    if (date.getTime() === 0 || isNaN(date.getTime())) return d;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }
  const date = normDate(d);
  if (date.getTime() === 0 || isNaN(date.getTime())) return '-';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
};

function getConsumptionIslemTipi(consumptionType?: string): IslemTipi {
  switch (consumptionType) {
    case 'sayimdan_dusum': return 'Sayımdan Düşüm';
    case 'imha_dogrulama_sonrasi_dusum': return 'İmha';
    case 'lab_to_depot_return': return 'Laboratuvardan İade';
    default: return 'Kullanım';
  }
}

type TransferItem = {
  transferId: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi?: string;
};

type TransferWithId = Transfer & { id: string };

// Timeout wrapper - prevents queries from hanging indefinitely
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Sorgu zaman aşımına uğradı (${ms}ms)`)), ms)
    )
  ]);
}

const QUERY_TIMEOUT = 30_000; // 30 seconds per query group
const TRANSFER_ITEMS_FETCH_LIMIT = 250;

async function fetchTransferItemsNoIndex(params: {
  transfers: TransferWithId[];
  searchType: 'product' | 'lot' | 'serial';
  needle: string;
  needleOriginal: string;
  uniqueStockCodes: string[];
}): Promise<TransferItem[]> {
  const { transfers, searchType, needle, needleOriginal, uniqueStockCodes } = params;
  if (!transfers.length) return [];

  const selectedTransfers = transfers
    .sort((a, b) => normDate((b as any).timestamp).getTime() - normDate((a as any).timestamp).getTime())
    .slice(0, TRANSFER_ITEMS_FETCH_LIMIT);

  const itemSnaps = await Promise.all(
    selectedTransfers.map(tr =>
      adminDb.collection('transfers').doc(tr.id).collection('items').get()
    )
  );

  const filtered: TransferItem[] = [];

  itemSnaps.forEach((snap, idx) => {
    const transferId = selectedTransfers[idx]?.id;
    if (!transferId) return;

    snap.docs.forEach((d: any) => {
      const data = d.data();
      const item: TransferItem = {
        transferId,
        stokKodu: data.stokKodu,
        stokAdi: data.stokAdi,
        lotNumarasi: data.lotNumarasi,
        miad: data.miad,
        seriNumarasi: data.seriNumarasi,
      };

      if (searchType === 'serial') {
        if ((item.seriNumarasi || '').toLowerCase() === needle || (item.seriNumarasi || '') === needleOriginal) {
          filtered.push(item);
        }
        return;
      }

      if (searchType === 'lot') {
        if ((item.lotNumarasi || '').toLowerCase() === needle || (item.lotNumarasi || '') === needleOriginal) {
          filtered.push(item);
        }
        return;
      }

      if (uniqueStockCodes.includes(item.stokKodu)) {
        filtered.push(item);
      }
    });
  });

  return filtered;
}

/**
 * Server Action - Optimized product ledger search.
 *
 * Optimizations vs client-side version:
 * 1. Server-side Firestore access (low latency, no bandwidth to browser)
 * 2. Shipments filtered by depotId (not fetching ALL shipments)
 * 3. Only referenced transfers fetched (not ALL transfers)
 * 4. Eliminates N+1 subcollection queries via collectionGroup
 * 5. Redundant serial detection queries removed
 * 6. Mal Kabul records grouped for product/lot searches
 * 7. Timeout protection on all query groups
 */
export async function searchProductLedger(
  q: string,
  companyId?: string | null,
  isSuperAdmin?: boolean,
  selectedStokKodu?: string | null,
): Promise<SearchResult> {
  if (!q || q.trim().length < 2) {
    return { ledgerRows: [], stockSummary: [], searchType: 'product' };
  }

  const needle = q.trim().toLowerCase();
  const needleOriginal = q.trim();

  // --- Phase 0: Fetch master data ---
  const [depotsSnap, pcSnap, usersSnap, hospitalsSnap] = await withTimeout(
    Promise.all([
      adminDb.collection('depots').get(),
      adminDb.collection('productCodes').get(),
      adminDb.collection('users').get(),
      adminDb.collection('hospitals').get(),
    ]),
    QUERY_TIMEOUT
  );

  const depots = depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
  // Sevk edilmiş stoğun gerçek laboratuvar adını çözmek için (hedefKurum boş
  // olduğunda önceden düz "Laboratuvar" yazılıyordu).
  const hospitalNameById = new Map<string, string>(
    hospitalsSnap.docs.map(d => [d.id, String((d.data() as any)?.name || '')]),
  );
  const productCodes = pcSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode));
  const usersMap = Object.fromEntries(usersSnap.docs.map(d => [d.id, d.data() as User]));

  const productOf = (code?: string) => productCodes.find(p => p.stokKodu === code);

  // --- Phase 1: Detect search type + determine stock codes ---
  // Optimized: reuse query results from detection phase (no redundant queries)
  let searchType: 'product' | 'lot' | 'serial' = 'product';
  const stockCodesToSearch: string[] = [];
  let targetLotNumarasi: string | undefined;
  let cachedDepoStokDocs: any[] | null = null; // Cache for main depoStok results

  const isPotentiallySerial = needle.length > 6;

  if (isPotentiallySerial) {
    // Check serial in depoStok and tuketimKayitlari in parallel
    const [depoStokBySerial, consumptionBySerial] = await withTimeout(
      Promise.all([
        adminDb.collection('depoStok').where('seriNumarasi', '==', needleOriginal).get(),
        adminDb.collection('tuketimKayitlari').where('seriNumarasi', '==', needleOriginal).limit(1).get(),
      ]),
      QUERY_TIMEOUT
    );

    if (!depoStokBySerial.empty || !consumptionBySerial.empty) {
      searchType = 'serial';
      // Cache the depoStok results - reuse in main fetch
      cachedDepoStokDocs = depoStokBySerial.docs;

      // Extract product info
      if (!depoStokBySerial.empty) {
        const data = depoStokBySerial.docs[0].data();
        stockCodesToSearch.push(data.stokKodu);
        targetLotNumarasi = data.lotNumarasi;
      } else if (!consumptionBySerial.empty) {
        const data = consumptionBySerial.docs[0].data();
        stockCodesToSearch.push(data.stokKodu);
        targetLotNumarasi = data.lotNumarasi;
      }
    }
  }

  // Check for lot number if not serial
  if (searchType === 'product') {
    const lotSnap = await adminDb.collection('depoStok').where('lotNumarasi', '==', needleOriginal).get();
    if (!lotSnap.empty) {
      searchType = 'lot';
      targetLotNumarasi = needleOriginal;
      // Cache the depoStok results
      cachedDepoStokDocs = lotSnap.docs;
      lotSnap.forEach(doc => stockCodesToSearch.push(doc.data().stokKodu));
    }
  }

  // Product search - find matching products
  if (searchType === 'product') {
    const matchingProducts = productCodes.filter(p =>
      p.stokKodu?.toLowerCase().includes(needle) ||
      p.stokAdi?.toLowerCase().includes(needle)
    );

    // If a specific product was picked from the disambiguation list, restrict to it.
    if (selectedStokKodu) {
      const picked = matchingProducts.find(p => p.stokKodu === selectedStokKodu)
        || productCodes.find(p => p.stokKodu === selectedStokKodu);
      if (picked?.stokKodu) {
        stockCodesToSearch.push(picked.stokKodu);
      }
    } else if (matchingProducts.length > 1) {
      // Multiple matches: ask the UI to disambiguate first. Don't load mixed data.
      return {
        ledgerRows: [],
        stockSummary: [],
        searchType: 'product',
        productMatches: matchingProducts
          .filter(p => !!p.stokKodu)
          .map(p => ({
            stokKodu: p.stokKodu!,
            stokAdi: p.stokAdi || p.stokKodu!,
            anaBirim: p.anaBirim,
          }))
          .sort((a, b) => a.stokAdi.localeCompare(b.stokAdi, 'tr')),
        needsProductSelection: true,
      };
    } else {
      matchingProducts.forEach(p => p.stokKodu && stockCodesToSearch.push(p.stokKodu));
    }
  }

  const uniqueStockCodes = Array.from(new Set(stockCodesToSearch));

  if (uniqueStockCodes.length === 0 && searchType !== 'serial') {
    return { ledgerRows: [], stockSummary: [], searchType };
  }

  // --- Phase 2: Fetch core data (parallel) ---
  // depoStok, transferItems, consumptionRecords, destroyedKits, verificationReports
  const corePromises: Promise<any>[] = [];

  // [0] DepoStok - reuse cached results if available, otherwise fetch
  if (cachedDepoStokDocs !== null) {
    corePromises.push(Promise.resolve({ docs: cachedDepoStokDocs }));
  } else if (searchType === 'serial') {
    corePromises.push(adminDb.collection('depoStok').where('seriNumarasi', '==', needleOriginal).get());
  } else if (searchType === 'lot') {
    corePromises.push(adminDb.collection('depoStok').where('lotNumarasi', '==', needleOriginal).get());
  } else if (uniqueStockCodes.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueStockCodes.length; i += 30) {
      chunks.push(uniqueStockCodes.slice(i, i + 30));
    }
    corePromises.push(
      Promise.all(chunks.map(chunk =>
        adminDb.collection('depoStok').where('stokKodu', 'in', chunk).get()
      )).then(snaps => ({ docs: snaps.flatMap(s => s.docs) }))
    );
  } else {
    corePromises.push(Promise.resolve({ docs: [] }));
  }

  // [1] Verification Reports (index-safe: single where + in-memory filter)
  if (searchType === 'serial') {
    corePromises.push(
      adminDb.collection('verificationReports')
        .where('seriNumarasi', '==', needleOriginal)
        .get()
    );
  } else if (searchType === 'lot') {
    corePromises.push(
      adminDb.collection('verificationReports')
        .where('lotNumarasi', '==', needleOriginal)
        .get()
    );
  } else {
    corePromises.push(Promise.resolve({ docs: [] }));
  }

  // [2] Transfer Items (index-safe path; fetched in phase 3 from transfer subcollections)
  corePromises.push(Promise.resolve({ docs: [] }));

  // [3] Consumption Records
  if (searchType === 'serial') {
    corePromises.push(
      adminDb.collection('tuketimKayitlari').where('seriNumarasi', '==', needleOriginal).get()
    );
  } else if (searchType === 'lot') {
    corePromises.push(
      adminDb.collection('tuketimKayitlari').where('lotNumarasi', '==', needleOriginal).get()
    );
  } else if (uniqueStockCodes.length > 0 && uniqueStockCodes.length <= 30) {
    corePromises.push(
      adminDb.collection('tuketimKayitlari').where('stokKodu', 'in', uniqueStockCodes).get()
    );
  } else {
    corePromises.push(Promise.resolve({ docs: [] }));
  }

  // [4] Destroyed Kits Reports
  if (searchType === 'serial') {
    corePromises.push(
      adminDb.collection('destroyedKitsReports').where('seriNumarasi', '==', needleOriginal).get()
    );
  } else if (searchType === 'lot') {
    corePromises.push(
      adminDb.collection('destroyedKitsReports').where('lotNumarasi', '==', needleOriginal).get()
    );
  } else if (uniqueStockCodes.length > 0 && uniqueStockCodes.length <= 30) {
    corePromises.push(
      adminDb.collection('destroyedKitsReports').where('stokKodu', 'in', uniqueStockCodes).get()
    );
  } else {
    corePromises.push(Promise.resolve({ docs: [] }));
  }

  // [5] Serial history (only for serial search) - canonical event log per serial.
  // Used to recover Mal Kabul / Transfer rows when depoStok was deleted on consumption.
  if (searchType === 'serial') {
    corePromises.push(
      adminDb.collection('serialHistory').doc(needleOriginal).collection('events').get()
    );
  } else {
    corePromises.push(Promise.resolve({ docs: [] }));
  }

  // [6] Seri No Defteri — birimin GÜNCEL durumu (nerede, son işlem ne).
  // `serialHistory` yalnızca olay akışıdır ve şirket etiketi taşımaz; defter
  // ise her `ürün kodu + seri no` çifti için tek, kapsamlı bir satır tutar.
  if (searchType === 'serial') {
    let ledgerQuery: FirebaseFirestore.Query = adminDb
      .collection('serialLedger')
      .where('seriNumarasi', '==', needleOriginal);
    if (!isSuperAdmin) ledgerQuery = ledgerQuery.where('companyId', '==', normalizeCompanyId(companyId));
    corePromises.push(ledgerQuery.get());
  } else {
    corePromises.push(Promise.resolve({ docs: [] }));
  }

  const [
    depoStokSnap,
    verifSnap,
    ,
    consumptionSnap,
    destroyedKitsSnap,
    serialHistorySnap,
    serialLedgerSnap,
  ] = await withTimeout(Promise.all(corePromises), QUERY_TIMEOUT);

  // Process core data
  const depoStok: DepoStokItem[] = filterByCompanyScope(
    (depoStokSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || []) as DepoStokItem[],
    companyId,
    isSuperAdmin,
  );
  const verificationReports: any[] = (verifSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [])
    .filter((r: any) => r.raporTipi === 'mal_kabul');
  const consumptionRecords: ConsumptionRecord[] = consumptionSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];
  const destroyedKits: any[] = destroyedKitsSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];
  const serialHistoryEvents: any[] = serialHistorySnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];
  const serialLedger: SerialLedgerSummary[] = (serialLedgerSnap?.docs || []).map((d: any) => {
    const data = d.data() || {};
    return {
      id: d.id,
      stokKodu: String(data.stokKodu ?? ''),
      stokAdi: String(data.stokAdi ?? ''),
      seriNumarasi: String(data.seriNumarasi ?? ''),
      lotNumarasi: String(data.lotNumarasi ?? ''),
      miad: String(data.miad ?? ''),
      status: String(data.status ?? ''),
      locationType: String(data.locationType ?? ''),
      locationName: String(data.locationName ?? ''),
      lastEventType: String(data.lastEventType ?? ''),
      lastEventAt: typeof data.lastEventAt?.toDate === 'function' ? data.lastEventAt.toDate() : null,
      eventCount: Number(data.eventCount) || 0,
    };
  });

  // For serial search: if depoStok is empty (item was fully consumed and the doc deleted),
  // fetch other items in the same lot to recover depotIds. Use stokKodu/lot from history
  // events or consumption records as the source of truth.
  let auxLotDepoStok: DepoStokItem[] = [];
  if (searchType === 'serial' && depoStok.length === 0) {
    let lotForLookup = (serialHistoryEvents.find(e => e?.details?.lotNumarasi)?.details?.lotNumarasi)
      || (consumptionRecords.find(c => c.lotNumarasi)?.lotNumarasi)
      || null;
    let stokForLookup = uniqueStockCodes[0]
      || (serialHistoryEvents.find(e => e?.details?.stokKodu)?.details?.stokKodu)
      || (consumptionRecords.find(c => c.stokKodu)?.stokKodu)
      || null;
    if (lotForLookup && stokForLookup) {
      try {
        const auxSnap = await adminDb.collection('depoStok')
          .where('stokKodu', '==', stokForLookup)
          .where('lotNumarasi', '==', lotForLookup)
          .get();
        auxLotDepoStok = filterByCompanyScope(
          auxSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as DepoStokItem[],
          companyId,
          isSuperAdmin,
        );
      } catch (err) {
        // Best-effort recovery; ignore failures here.
        auxLotDepoStok = [];
      }
    }
  }

  // --- Phase 3: Fetch shipments (filtered by depotId) + referenced transfers ---
  const phase3Promises: Promise<any>[] = [];

  // Extract depotIds from depoStok (and recovery sources for serial search) for shipment filtering.
  const depotIdsFromHistory: string[] = serialHistoryEvents
    .map((e: any) => e?.details?.depotId || e?.details?.sourceDepotId)
    .filter((x: any): x is string => typeof x === 'string' && x.length > 0);
  const depotIds = Array.from(new Set([
    ...depoStok.map(d => d.depotId).filter(Boolean) as string[],
    ...auxLotDepoStok.map(d => d.depotId).filter(Boolean) as string[],
    ...depotIdsFromHistory,
  ]));

  // [0] Shipments - filtered by depotId instead of fetching ALL
  if (depotIds.length > 0 && depotIds.length <= 30) {
    phase3Promises.push(
      adminDb.collection('shipments').where('depotId', 'in', depotIds).get()
    );
  } else if (depotIds.length > 30) {
    // Batch depotId queries
    const depotChunks: string[][] = [];
    for (let i = 0; i < depotIds.length; i += 30) {
      depotChunks.push(depotIds.slice(i, i + 30));
    }
    phase3Promises.push(
      Promise.all(depotChunks.map(chunk =>
        adminDb.collection('shipments').where('depotId', 'in', chunk).get()
      )).then(snaps => ({ docs: snaps.flatMap(s => s.docs) }))
    );
  } else {
    phase3Promises.push(Promise.resolve({ docs: [] }));
  }

  // [1] Candidate transfers (index-safe; no collectionGroup dependency)
  if (depotIds.length > 0) {
    const depotChunks: string[][] = [];
    for (let i = 0; i < depotIds.length; i += 30) {
      depotChunks.push(depotIds.slice(i, i + 30));
    }
    phase3Promises.push(
      Promise.all(depotChunks.map(chunk =>
        adminDb.collection('transfers').where('sourceDepotId', 'in', chunk).get()
      )).then(snaps => ({ docs: snaps.flatMap(s => s.docs) }))
    );
  } else {
    phase3Promises.push(
      adminDb.collection('transfers').limit(300).get()
    );
  }

  const [shipmentsSnap, candidateTransfersSnap] = await withTimeout(
    Promise.all(phase3Promises),
    QUERY_TIMEOUT
  );

  const allShipments: Shipment[] = shipmentsSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];
  const candidateTransfers: TransferWithId[] = candidateTransfersSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];

  const transferItemsFromSubcollections = await fetchTransferItemsNoIndex({
    transfers: candidateTransfers,
    searchType,
    needle,
    needleOriginal,
    uniqueStockCodes,
  });

  const filteredTransferItems = transferItemsFromSubcollections;
  const transferMap = new Map<string, Transfer>(
    candidateTransfers.map((t: TransferWithId) => [t.id, t])
  );

  // --- Filter shipments by content ---
  const filteredShipments = allShipments.filter(sh => {
    if (!sh.items || sh.items.length === 0) return false;
    return sh.items.some(it => {
      if (searchType === 'serial') {
        return serialsOfShipmentItem(it).some(sn => sn.toLowerCase() === needle);
      } else if (searchType === 'lot') {
        return (it.lotNumarasi || '').toLowerCase() === needle;
      } else {
        return uniqueStockCodes.includes(it.stokKodu);
      }
    });
  });

  // Transfer items were filtered during subcollection fetch.

  // --- Build Ledger Rows based on search type ---
  const ledgerRows: LedgerRow[] = [];

  if (searchType === 'serial') {
    buildSerialLedger(
      ledgerRows, depoStok, verificationReports, filteredShipments,
      filteredTransferItems, transferMap, consumptionRecords, destroyedKits,
      needle, usersMap, serialHistoryEvents
    );
  } else {
    buildGroupedLedger(
      ledgerRows, depoStok, verificationReports, filteredShipments,
      filteredTransferItems, transferMap, consumptionRecords, destroyedKits,
      uniqueStockCodes, searchType, needle, usersMap
    );
  }

  // Sort by date descending (newest first)
  ledgerRows.sort((a, b) => b.tarih.getTime() - a.tarih.getTime());

  // --- Calculate Stock Summary ---
  const stockSummary = calculateStockSummary(
    depoStok, consumptionRecords, uniqueStockCodes,
    searchType, needle, productCodes, hospitalNameById
  );

  return { ledgerRows, stockSummary, searchType, serialLedger };
}

// =========================================================
// Serial search: individual rows with postAdet tracking
// =========================================================
function buildSerialLedger(
  ledgerRows: LedgerRow[],
  depoStok: DepoStokItem[],
  verificationReports: any[],
  shipments: Shipment[],
  transferItems: TransferItem[],
  transferMap: Map<string, Transfer>,
  consumptions: ConsumptionRecord[],
  destroyedKits: any[],
  needle: string,
  usersMap: Record<string, User>,
  serialHistoryEvents: any[] = []
) {
  const stockByLocationLot: Record<string, number> = {};
  const getKey = (konum: string, stokKodu: string, lotNumarasi?: string) =>
    `${konum}|${stokKodu}|${lotNumarasi || ''}`;

  interface Event { tarih: Date; type: string; data: any; }
  const events: Event[] = [];

  // Mal Kabul from depoStok
  depoStok.forEach(d => {
    events.push({ tarih: normDate((d as any).eklenmeTarihi), type: 'malKabul', data: d });
  });

  // Mal Kabul from verification reports (deduplicate)
  verificationReports.forEach((r: any) => {
    const hasDuplicate = depoStok.some(d =>
      d.stokKodu === r.stokKodu &&
      d.lotNumarasi === r.lotNumarasi &&
      serialsOfDepoStok(d).includes(r.seriNumarasi)
    );
    if (!hasDuplicate) {
      events.push({ tarih: normDate(r.islemTarihi), type: 'verifMalKabul', data: r });
    }
  });

  // Shipments
  shipments.forEach(sh => {
    (sh.items || []).forEach(it => {
      if (serialsOfShipmentItem(it).some(sn => sn.toLowerCase() === needle)) {
        events.push({ tarih: normDate(sh.timestamp), type: 'shipment', data: { shipment: sh, item: it } });
      }
    });
  });

  // Transfers
  transferItems.forEach(it => {
    const tr = transferMap.get(it.transferId);
    if (tr && (it.seriNumarasi || '').toLowerCase() === needle) {
      events.push({ tarih: normDate(tr.timestamp), type: 'transfer', data: { transfer: tr, item: it } });
    }
  });

  // Consumptions
  consumptions.forEach(rec => {
    events.push({ tarih: normDate(rec.consumptionTimestamp), type: 'consumption', data: rec });
  });

  // Destroyed kits
  destroyedKits.forEach(kit => {
    if ((kit.seriNumarasi || '').toLowerCase() === needle) {
      events.push({ tarih: normDate(kit.resolvedAt || kit.timestamp || kit.createdAt), type: 'destroyed', data: kit });
    }
  });

  // Recover events from serialHistory for actions whose primary records were deleted
  // (e.g. depoStok deleted on consumption, leaving the Mal Kabul row missing).
  if (serialHistoryEvents && serialHistoryEvents.length > 0) {
    const hasDepoStokIntake = depoStok.length > 0;
    const hasVerifIntake = verificationReports.some(r => (r.seriNumarasi || '').toLowerCase() === needle);
    const knownTransferIds = new Set<string>(
      [
        ...transferItems.map(it => it.transferId),
        ...shipments.map(sh => sh.id),
      ].filter(Boolean) as string[]
    );

    serialHistoryEvents.forEach((he: any) => {
      const heType = he?.type;
      if (heType === 'intake') {
        if (!hasDepoStokIntake && !hasVerifIntake) {
          events.push({ tarih: normDate(he.timestamp), type: 'historyIntake', data: he });
        }
      } else if (heType === 'transfer' || heType === 'depot_to_lab_transfer' || heType === 'inter_lab_transfer') {
        const txId = he.transferId;
        const alreadyKnown = txId ? knownTransferIds.has(txId) : false;
        if (!alreadyKnown) {
          events.push({ tarih: normDate(he.timestamp), type: 'historyTransfer', data: he });
        }
      }
    });
  }

  // Sort chronologically
  events.sort((a, b) => a.tarih.getTime() - b.tarih.getTime());

  // Process events and calculate postAdet
  events.forEach(ev => {
    if (ev.type === 'malKabul') {
      const d = ev.data as DepoStokItem;
      const key = getKey(d.depotName || 'Depo', d.stokKodu, d.lotNumarasi);
      stockByLocationLot[key] = (stockByLocationLot[key] || 0) + 1;

      ledgerRows.push({
        id: `mk_${d.id}`,
        stokKodu: d.stokKodu,
        stokAdi: d.stokAdi,
        lotNumarasi: d.lotNumarasi,
        miad: formatMiad(d.miad),
        islemTipi: 'Mal Kabul',
        actor: (d as any).createdByName || (d as any).userName || (d as any).ekleyenKullanici || usersMap[(d as any).createdByUid]?.name || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: serialsOfDepoStok(d),
        konum: d.depotName || 'Depo',
        postAdetDepo: stockByLocationLot[key],
      });
    } else if (ev.type === 'verifMalKabul') {
      const r = ev.data;
      const key = getKey(r.depotName || 'Depo', r.stokKodu, r.lotNumarasi);
      stockByLocationLot[key] = (stockByLocationLot[key] || 0) + 1;

      ledgerRows.push({
        id: `mk_vr_${r.id}`,
        stokKodu: r.stokKodu || '',
        stokAdi: r.stokAdi || '',
        lotNumarasi: r.lotNumarasi,
        miad: formatMiad(r.miad),
        islemTipi: 'Mal Kabul',
        actor: r.createdByName || r.userName || usersMap[r.createdByUid]?.name || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: r.seriNumarasi ? [r.seriNumarasi] : [],
        konum: r.depotName || 'Depo',
        postAdetDepo: stockByLocationLot[key],
      });
    } else if (ev.type === 'shipment') {
      const { shipment: sh, item: it } = ev.data;
      const depoKey = getKey(sh.depotName || 'Depo', it.stokKodu, it.lotNumarasi);
      const labKey = getKey(sh.recipientHospital, it.stokKodu, it.lotNumarasi);

      stockByLocationLot[depoKey] = (stockByLocationLot[depoKey] || 0) - 1;
      stockByLocationLot[labKey] = (stockByLocationLot[labKey] || 0) + 1;

      ledgerRows.push({
        id: `sh_${sh.id}_${it.stokKodu}_${it.lotNumarasi}`,
        stokKodu: it.stokKodu,
        stokAdi: it.stokAdi,
        lotNumarasi: it.lotNumarasi,
        miad: formatMiad(it.miad),
        islemTipi: 'Karşılanan Sipariş',
        actor: sh.userName || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: serialsOfShipmentItem(it).filter(sn => sn.toLowerCase() === needle),
        konum: sh.depotName || 'Depo',
        hedefKonum: sh.recipientHospital,
        postAdetDepo: Math.max(0, stockByLocationLot[depoKey] || 0),
        postAdetHedef: stockByLocationLot[labKey] || 0,
      });
    } else if (ev.type === 'transfer') {
      const { transfer: tr, item: it } = ev.data;
      const sourceKey = getKey(tr.sourceDepotName || 'Depo', it.stokKodu, it.lotNumarasi);
      const targetKey = getKey(tr.targetName, it.stokKodu, it.lotNumarasi);

      stockByLocationLot[sourceKey] = (stockByLocationLot[sourceKey] || 0) - 1;
      stockByLocationLot[targetKey] = (stockByLocationLot[targetKey] || 0) + 1;

      ledgerRows.push({
        id: `tr_${tr.id}_${it.seriNumarasi}`,
        stokKodu: it.stokKodu,
        stokAdi: it.stokAdi,
        lotNumarasi: it.lotNumarasi,
        miad: formatMiad(it.miad),
        islemTipi: 'Direkt Transfer',
        actor: tr.userName || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: it.seriNumarasi ? [it.seriNumarasi] : [],
        konum: tr.sourceDepotName || 'Depo',
        hedefKonum: tr.targetName,
        postAdetDepo: Math.max(0, stockByLocationLot[sourceKey] || 0),
        postAdetHedef: stockByLocationLot[targetKey] || 0,
      });
    } else if (ev.type === 'consumption') {
      const rec = ev.data as ConsumptionRecord;
      const labKey = getKey(rec.laboratoryName || 'Laboratuvar', rec.stokKodu, rec.lotNumarasi);
      stockByLocationLot[labKey] = (stockByLocationLot[labKey] || 0) - 1;

      ledgerRows.push({
        id: `tk_${rec.id}`,
        stokKodu: rec.stokKodu,
        stokAdi: rec.stokAdi,
        lotNumarasi: rec.lotNumarasi,
        miad: formatMiad(rec.miad),
        islemTipi: getConsumptionIslemTipi((rec as any).consumptionType),
        actor: rec.userName || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: rec.seriNumarasi ? [rec.seriNumarasi] : [],
        konum: rec.laboratoryName || 'Laboratuvar',
        postAdetHedef: Math.max(0, stockByLocationLot[labKey] || 0),
      });
    } else if (ev.type === 'destroyed') {
      const kit = ev.data;
      const labKey = getKey(kit.laboratoryName || 'Laboratuvar', kit.stokKodu, kit.lotNumarasi);
      stockByLocationLot[labKey] = (stockByLocationLot[labKey] || 0) - 1;

      ledgerRows.push({
        id: `imha_${kit.id}`,
        stokKodu: kit.stokKodu,
        stokAdi: kit.stokAdi,
        lotNumarasi: kit.lotNumarasi,
        miad: formatMiad(kit.miad),
        islemTipi: 'İmha',
        actor: kit.userName || kit.resolvedByName || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: kit.seriNumarasi ? [kit.seriNumarasi] : [],
        konum: kit.laboratoryName || 'Laboratuvar',
        postAdetHedef: Math.max(0, stockByLocationLot[labKey] || 0),
      });
    } else if (ev.type === 'historyIntake') {
      // Synthetic Mal Kabul row reconstructed from serialHistory event
      // (used when the original depoStok doc was deleted on consumption).
      const he = ev.data;
      const det = he.details || {};
      const stokKodu = det.stokKodu || consumptions.find(c => c.stokKodu)?.stokKodu || '';
      const stokAdi = det.stokAdi || consumptions.find(c => c.stokAdi)?.stokAdi || stokKodu;
      const lotNumarasi = det.lotNumarasi || consumptions.find(c => c.lotNumarasi)?.lotNumarasi;
      const miad = det.miad || consumptions.find(c => c.miad)?.miad;
      const depotName = det.depotName || 'Depo';
      const key = getKey(depotName, stokKodu, lotNumarasi);
      stockByLocationLot[key] = (stockByLocationLot[key] || 0) + 1;

      ledgerRows.push({
        id: `mk_hist_${he.id}`,
        stokKodu,
        stokAdi,
        lotNumarasi,
        miad: formatMiad(miad),
        islemTipi: 'Mal Kabul',
        actor: det.userName || det.createdByName || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: [needle],
        konum: depotName,
        postAdetDepo: stockByLocationLot[key],
      });
    } else if (ev.type === 'historyTransfer') {
      // Synthetic Transfer / Karşılanan Sipariş row from serialHistory event.
      const he = ev.data;
      const det = he.details || {};
      const stokKodu = det.stokKodu || consumptions.find(c => c.stokKodu)?.stokKodu || '';
      const stokAdi = det.stokAdi || consumptions.find(c => c.stokAdi)?.stokAdi || stokKodu;
      const lotNumarasi = det.lotNumarasi || consumptions.find(c => c.lotNumarasi)?.lotNumarasi;
      const miad = det.miad || consumptions.find(c => c.miad)?.miad;
      const sourceName = det.sourceDepotName || det.sourceLabName || 'Depo';
      const targetName = det.targetName || det.targetLabName || 'Laboratuvar';
      const islemTipi: IslemTipi = he.orderId ? 'Karşılanan Sipariş' : 'Direkt Transfer';

      const sourceKey = getKey(sourceName, stokKodu, lotNumarasi);
      const targetKey = getKey(targetName, stokKodu, lotNumarasi);
      stockByLocationLot[sourceKey] = (stockByLocationLot[sourceKey] || 0) - 1;
      stockByLocationLot[targetKey] = (stockByLocationLot[targetKey] || 0) + 1;

      ledgerRows.push({
        id: `tr_hist_${he.id}`,
        stokKodu,
        stokAdi,
        lotNumarasi,
        miad: formatMiad(miad),
        islemTipi,
        actor: det.userName || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: [needle],
        konum: sourceName,
        hedefKonum: targetName,
        postAdetDepo: Math.max(0, stockByLocationLot[sourceKey] || 0),
        postAdetHedef: stockByLocationLot[targetKey] || 0,
      });
    }
  });
}

// =========================================================
// Product/Lot search: grouped rows with postAdet tracking
// =========================================================
function buildGroupedLedger(
  ledgerRows: LedgerRow[],
  depoStok: DepoStokItem[],
  verificationReports: any[],
  shipments: Shipment[],
  transferItems: TransferItem[],
  transferMap: Map<string, Transfer>,
  consumptions: ConsumptionRecord[],
  destroyedKits: any[],
  stockCodes: string[],
  searchType: 'product' | 'lot',
  needle: string,
  usersMap: Record<string, User>
) {
  const filterItem = (item: any) => {
    if (searchType === 'lot') {
      return (item.lotNumarasi || '').toLowerCase() === needle;
    }
    return stockCodes.includes(item.stokKodu);
  };

  const stockByLocationLot: Record<string, number> = {};
  const getKey = (konum: string, stokKodu: string, lotNumarasi?: string) =>
    `${konum}|${stokKodu}|${lotNumarasi || ''}`;

  interface GroupedEvent {
    tarih: Date;
    type: string;
    data: any;
    groupKey: string;
  }
  const events: GroupedEvent[] = [];

  // --- Group Mal Kabul by session (same minute, user, depot, product, lot) ---
  const malKabulGroups = new Map<string, DepoStokItem[]>();
  depoStok.forEach(d => {
    if (!filterItem(d)) return;
    const tarih = normDate((d as any).eklenmeTarihi);
    const tarihKey = `${Math.floor(tarih.getTime() / 60000)}`;
    const actor = (d as any).createdByName || (d as any).userName || (d as any).ekleyenKullanici || usersMap[(d as any).createdByUid]?.name || '';
    const groupKey = `mk|${tarihKey}|${actor}|${d.depotName || ''}|${d.stokKodu}|${d.lotNumarasi || ''}`;

    if (!malKabulGroups.has(groupKey)) malKabulGroups.set(groupKey, []);
    malKabulGroups.get(groupKey)!.push(d);
  });

  malKabulGroups.forEach((items, groupKey) => {
    const first = items[0];
    events.push({
      tarih: normDate((first as any).eklenmeTarihi),
      type: 'malKabul',
      data: items,
      groupKey,
    });
  });

  // Verification reports (no grouping, deduplicate with depoStok)
  verificationReports.forEach((r: any) => {
    if (!filterItem(r)) return;
    const hasDuplicate = depoStok.some(d =>
      d.stokKodu === r.stokKodu &&
      d.lotNumarasi === r.lotNumarasi &&
      serialsOfDepoStok(d).includes(r.seriNumarasi)
    );
    if (!hasDuplicate) {
      events.push({
        tarih: normDate(r.islemTarihi),
        type: 'verifMalKabul',
        data: r,
        groupKey: `mk_vr_${r.id}`,
      });
    }
  });

  // --- Group Shipments by shipment + product + lot ---
  shipments.forEach(sh => {
    const relevantItems = (sh.items || []).filter(filterItem);
    if (relevantItems.length === 0) return;

    const itemGroups = new Map<string, any[]>();
    relevantItems.forEach(it => {
      const key = `${it.stokKodu}|${it.lotNumarasi || ''}`;
      if (!itemGroups.has(key)) itemGroups.set(key, []);
      itemGroups.get(key)!.push(it);
    });

    itemGroups.forEach((items, itemKey) => {
      events.push({
        tarih: normDate(sh.timestamp),
        type: 'shipment',
        data: { shipment: sh, items },
        groupKey: `sh|${sh.id}|${itemKey}`,
      });
    });
  });

  // --- Group Transfers by transfer + product + lot ---
  const transferItemsByTransfer = new Map<string, TransferItem[]>();
  transferItems.forEach(it => {
    if (!filterItem(it)) return;
    const key = `${it.transferId}|${it.stokKodu}|${it.lotNumarasi || ''}`;
    if (!transferItemsByTransfer.has(key)) transferItemsByTransfer.set(key, []);
    transferItemsByTransfer.get(key)!.push(it);
  });

  transferItemsByTransfer.forEach((items, key) => {
    const first = items[0];
    const tr = transferMap.get(first.transferId);
    if (!tr) return;

    events.push({
      tarih: normDate(tr.timestamp),
      type: 'transfer',
      data: { transfer: tr, items },
      groupKey: `tr|${key}`,
    });
  });

  // Consumptions (individual)
  consumptions.forEach(rec => {
    if (!filterItem(rec)) return;
    events.push({
      tarih: normDate(rec.consumptionTimestamp),
      type: 'consumption',
      data: rec,
      groupKey: `tk|${rec.id}`,
    });
  });

  // Destroyed kits (individual)
  destroyedKits.forEach(kit => {
    if (!filterItem(kit)) return;
    events.push({
      tarih: normDate(kit.resolvedAt || kit.timestamp || kit.createdAt),
      type: 'destroyed',
      data: kit,
      groupKey: `imha|${kit.id}`,
    });
  });

  // Sort chronologically
  events.sort((a, b) => a.tarih.getTime() - b.tarih.getTime());

  // Process events and calculate postAdet
  events.forEach(ev => {
    if (ev.type === 'malKabul') {
      const items = ev.data as DepoStokItem[];
      const first = items[0];
      const key = getKey(first.depotName || 'Depo', first.stokKodu, first.lotNumarasi);
      stockByLocationLot[key] = (stockByLocationLot[key] || 0) + items.length;

      const allSerials = items.flatMap(d => serialsOfDepoStok(d));
      const actor = (first as any).createdByName || (first as any).userName || (first as any).ekleyenKullanici || usersMap[(first as any).createdByUid]?.name || '-';

      ledgerRows.push({
        id: `mk_grp_${ev.groupKey}`,
        stokKodu: first.stokKodu,
        stokAdi: first.stokAdi,
        lotNumarasi: first.lotNumarasi,
        miad: formatMiad(first.miad),
        islemTipi: 'Mal Kabul',
        actor,
        tarih: ev.tarih,
        adet: items.length,
        seriNolar: allSerials,
        konum: first.depotName || 'Depo',
        postAdetDepo: stockByLocationLot[key],
      });
    } else if (ev.type === 'verifMalKabul') {
      const r = ev.data;
      const key = getKey(r.depotName || 'Depo', r.stokKodu, r.lotNumarasi);
      stockByLocationLot[key] = (stockByLocationLot[key] || 0) + 1;

      ledgerRows.push({
        id: `mk_vr_${r.id}`,
        stokKodu: r.stokKodu || '',
        stokAdi: r.stokAdi || '',
        lotNumarasi: r.lotNumarasi,
        miad: formatMiad(r.miad),
        islemTipi: 'Mal Kabul',
        actor: r.createdByName || r.userName || usersMap[r.createdByUid]?.name || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: r.seriNumarasi ? [r.seriNumarasi] : [],
        konum: r.depotName || 'Depo',
        postAdetDepo: stockByLocationLot[key],
      });
    } else if (ev.type === 'shipment') {
      const { shipment: sh, items } = ev.data;
      const first = items[0];
      const qty = items.reduce((sum: number, it: any) => sum + (it.quantity || serialsOfShipmentItem(it).length || 1), 0);

      const depoKey = getKey(sh.depotName || 'Depo', first.stokKodu, first.lotNumarasi);
      const labKey = getKey(sh.recipientHospital, first.stokKodu, first.lotNumarasi);

      stockByLocationLot[depoKey] = (stockByLocationLot[depoKey] || 0) - qty;
      stockByLocationLot[labKey] = (stockByLocationLot[labKey] || 0) + qty;

      const allSerials = items.flatMap((it: any) => serialsOfShipmentItem(it));

      ledgerRows.push({
        id: `sh_grp_${ev.groupKey}`,
        stokKodu: first.stokKodu,
        stokAdi: first.stokAdi,
        lotNumarasi: first.lotNumarasi,
        miad: formatMiad(first.miad),
        islemTipi: 'Karşılanan Sipariş',
        actor: sh.userName || '-',
        tarih: ev.tarih,
        adet: qty,
        seriNolar: allSerials,
        konum: sh.depotName || 'Depo',
        hedefKonum: sh.recipientHospital,
        postAdetDepo: Math.max(0, stockByLocationLot[depoKey] || 0),
        postAdetHedef: stockByLocationLot[labKey] || 0,
      });
    } else if (ev.type === 'transfer') {
      const { transfer: tr, items } = ev.data;
      const first = items[0];
      const qty = items.length;

      const sourceKey = getKey(tr.sourceDepotName || 'Depo', first.stokKodu, first.lotNumarasi);
      const targetKey = getKey(tr.targetName, first.stokKodu, first.lotNumarasi);

      stockByLocationLot[sourceKey] = (stockByLocationLot[sourceKey] || 0) - qty;
      stockByLocationLot[targetKey] = (stockByLocationLot[targetKey] || 0) + qty;

      const allSerials = items.map((it: TransferItem) => it.seriNumarasi).filter(Boolean) as string[];

      ledgerRows.push({
        id: `tr_grp_${ev.groupKey}`,
        stokKodu: first.stokKodu,
        stokAdi: first.stokAdi,
        lotNumarasi: first.lotNumarasi,
        miad: formatMiad(first.miad),
        islemTipi: 'Direkt Transfer',
        actor: tr.userName || '-',
        tarih: ev.tarih,
        adet: qty,
        seriNolar: allSerials,
        konum: tr.sourceDepotName || 'Depo',
        hedefKonum: tr.targetName,
        postAdetDepo: Math.max(0, stockByLocationLot[sourceKey] || 0),
        postAdetHedef: stockByLocationLot[targetKey] || 0,
      });
    } else if (ev.type === 'consumption') {
      const rec = ev.data as ConsumptionRecord;
      const labKey = getKey(rec.laboratoryName || 'Laboratuvar', rec.stokKodu, rec.lotNumarasi);
      stockByLocationLot[labKey] = (stockByLocationLot[labKey] || 0) - 1;

      ledgerRows.push({
        id: `tk_${rec.id}`,
        stokKodu: rec.stokKodu,
        stokAdi: rec.stokAdi,
        lotNumarasi: rec.lotNumarasi,
        miad: formatMiad(rec.miad),
        islemTipi: getConsumptionIslemTipi((rec as any).consumptionType),
        actor: rec.userName || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: rec.seriNumarasi ? [rec.seriNumarasi] : [],
        konum: rec.laboratoryName || 'Laboratuvar',
        postAdetHedef: Math.max(0, stockByLocationLot[labKey] || 0),
      });
    } else if (ev.type === 'destroyed') {
      const kit = ev.data;
      const labKey = getKey(kit.laboratoryName || 'Laboratuvar', kit.stokKodu, kit.lotNumarasi);
      stockByLocationLot[labKey] = (stockByLocationLot[labKey] || 0) - 1;

      ledgerRows.push({
        id: `imha_${kit.id}`,
        stokKodu: kit.stokKodu,
        stokAdi: kit.stokAdi,
        lotNumarasi: kit.lotNumarasi,
        miad: formatMiad(kit.miad),
        islemTipi: 'İmha',
        actor: kit.userName || kit.resolvedByName || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: kit.seriNumarasi ? [kit.seriNumarasi] : [],
        konum: kit.laboratoryName || 'Laboratuvar',
        postAdetHedef: Math.max(0, stockByLocationLot[labKey] || 0),
      });
    }
  });
}

// =========================================================
// Stock Summary calculation
// =========================================================
function calculateStockSummary(
  depoStok: DepoStokItem[],
  consumptionRecords: ConsumptionRecord[],
  uniqueStockCodes: string[],
  searchType: 'product' | 'lot' | 'serial',
  needle: string,
  productCodes: ProductCode[],
  /**
   * labId -> laboratuvar adı. Sevk edilmiş stoğun konumunu çözmek için
   * gerekir; çağıran hastaneleri zaten okuduğu için buraya parametre olarak
   * geçilir (daha önce çağıranın yerel değişkenine erişilmeye çalışılıyordu,
   * o da bu kapsamda tanımlı olmadığı için çalışma anında hata veriyordu).
   */
  hospitalNameById: Map<string, string> = new Map()
): StockSummary[] {
  const stockSummary: StockSummary[] = [];
  const stokKodu = uniqueStockCodes[0];
  const product = productCodes.find(p => p.stokKodu === stokKodu);
  const birim = product?.anaBirim || 'Adet';

  if (searchType === 'serial') {
    const inStockItem = depoStok.find(s => serialsOfDepoStok(s).some(sn => sn.toLowerCase() === needle));
    if (inStockItem) {
      if (inStockItem.isShipped) {
        const hedefId = String((inStockItem as any).hedefKurumId || (inStockItem as any).labId || '').trim();
        const hedefAd = String(inStockItem.hedefKurum || '').trim();
        stockSummary.push({
          konum: hospitalNameById.get(hedefId) || hedefAd || 'Bilinmeyen konum',
          konumTipi: hedefId ? 'laboratuvar' : 'borc',
          adet: 1,
          birim,
        });
      } else {
        stockSummary.push({
          konum: inStockItem.depotName || 'Depo',
          konumTipi: 'depo',
          adet: 1,
          birim,
        });
      }
    } else {
      const consumed = consumptionRecords.find(c => (serialOfConsumption(c) || '').toLowerCase() === needle);
      if (consumed) {
        stockSummary.push({
          konum: 'Tüketildi',
          konumTipi: 'laboratuvar',
          adet: 0,
          birim,
        });
      }
    }
  } else {
    const stockByLocation: Record<string, { adet: number; konumTipi: 'depo' | 'laboratuvar' | 'borc' }> = {};

    depoStok.forEach(item => {
      const matchesLot = searchType === 'lot'
        ? (item.lotNumarasi || '').toLowerCase() === needle
        : true;
      const matchesProduct = uniqueStockCodes.includes(item.stokKodu);

      if (matchesProduct && matchesLot) {
        const isConsumed = consumptionRecords.some(c =>
          c.seriNumarasi === item.seriNumarasi && item.seriNumarasi
        );

        if (!isConsumed) {
          // Sevk edilmiş stok: gerçek laboratuvar adını hedefKurumId'den çöz.
          // hedefKurumId yoksa bu stok borç olarak verilmiştir (direkt transfer
          // borç modu hedefKurumId'yi boş bırakır).
          const hedefId = String((item as any).hedefKurumId || (item as any).labId || '').trim();
          const hedefAd = String(item.hedefKurum || '').trim();
          const konum = item.isShipped
            ? (hospitalNameById.get(hedefId) || hedefAd || 'Bilinmeyen konum')
            : (item.depotName || 'Depo');
          const konumTipi: 'depo' | 'laboratuvar' | 'borc' = !item.isShipped
            ? 'depo'
            : (hedefId ? 'laboratuvar' : 'borc');

          if (!stockByLocation[konum]) {
            stockByLocation[konum] = { adet: 0, konumTipi };
          }
          stockByLocation[konum].adet += 1;
        }
      }
    });

    Object.entries(stockByLocation).forEach(([konum, data]) => {
      if (data.adet > 0) {
        stockSummary.push({
          konum,
          konumTipi: data.konumTipi,
          adet: data.adet,
          birim,
        });
      }
    });
  }

  return stockSummary;
}
