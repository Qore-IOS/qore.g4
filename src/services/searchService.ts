'use client';

import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  limit,
} from 'firebase/firestore';
import type { DepoStokItem, Shipment, ConsumptionRecord, Depot, ProductCode, Transfer } from '@/lib/types';
import { filterByCompanyScope } from '@/lib/company-scope';

// İşlem tipi
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
  konumTipi: 'depo' | 'laboratuvar';
  adet: number;
  birim: string;
}

export interface SearchResult {
  ledgerRows: LedgerRow[];
  stockSummary: StockSummary[];
  searchType: 'product' | 'lot' | 'serial';
}

// Helper functions
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
    // Handle "dd.MM.yyyy" format
    const parts = d.split('.');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(parsed.getTime())) return parsed;
    }
    // Try ISO format
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  if (typeof d === 'number') return new Date(d);
  return new Date(0);
};

const formatMiad = (d: any): string => {
  if (!d) return '-';

  // If already a formatted string like "dd.MM.yyyy", return it
  if (typeof d === 'string') {
    // Check if it's already in dd.MM.yyyy format
    const parts = d.split('.');
    if (parts.length === 3 && parts[0].length <= 2 && parts[1].length <= 2 && parts[2].length === 4) {
      return d;
    }
    // Try to parse and format
    const date = normDate(d);
    if (date.getTime() === 0 || isNaN(date.getTime())) return d; // Return original if can't parse
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

/**
 * Client-side search function for the product ledger.
 * Groups results by session for product/lot searches, shows individual items for serial searches.
 */
export async function searchProductLedger(
  q: string,
  productCodes: ProductCode[],
  depots: Depot[],
  companyId?: string | null,
  isSuperAdmin?: boolean,
): Promise<SearchResult> {
  if (!q || q.trim().length < 2) {
    return { ledgerRows: [], stockSummary: [], searchType: 'product' };
  }

  const needle = q.trim().toLowerCase();
  const needleOriginal = q.trim();

  // --- Detect Search Type ---
  let searchType: 'product' | 'lot' | 'serial' = 'product';

  // Check for serial number (usually longer than 6 chars)
  const isPotentiallySerial = needle.length > 6;

  if (isPotentiallySerial) {
    const serialQueries = await Promise.all([
      getDocs(query(collection(db, 'depoStok'), where('seriNumarasi', '==', needleOriginal), limit(1))),
      getDocs(query(collection(db, 'tuketimKayitlari'), where('seriNumarasi', '==', needleOriginal), limit(1))),
    ]);
    if (serialQueries.some(snap => !snap.empty)) {
      searchType = 'serial';
    }
  }

  // Check for lot number if not serial
  if (searchType === 'product') {
    const lotSnap = await getDocs(query(collection(db, 'depoStok'), where('lotNumarasi', '==', needleOriginal), limit(1)));
    if (!lotSnap.empty) searchType = 'lot';
  }

  // --- Determine stock codes to search ---
  const stockCodesToSearch: string[] = [];
  let targetLotNumarasi: string | undefined;

  if (searchType === 'serial') {
    // Try to find product info from depoStok first
    const productFromSerialSnap = await getDocs(
      query(collection(db, 'depoStok'), where('seriNumarasi', '==', needleOriginal), limit(1))
    );
    if (!productFromSerialSnap.empty) {
      const data = productFromSerialSnap.docs[0].data();
      stockCodesToSearch.push(data.stokKodu);
      targetLotNumarasi = data.lotNumarasi;
    } else {
      // If not found in depoStok, try tuketimKayitlari (for consumed items)
      const productFromConsumptionSnap = await getDocs(
        query(collection(db, 'tuketimKayitlari'), where('seriNumarasi', '==', needleOriginal), limit(1))
      );
      if (!productFromConsumptionSnap.empty) {
        const data = productFromConsumptionSnap.docs[0].data();
        stockCodesToSearch.push(data.stokKodu);
        targetLotNumarasi = data.lotNumarasi;
      }
    }
  } else if (searchType === 'lot') {
    targetLotNumarasi = needleOriginal;
    const productsFromLotSnap = await getDocs(
      query(collection(db, 'depoStok'), where('lotNumarasi', '==', needleOriginal))
    );
    productsFromLotSnap.forEach(doc => stockCodesToSearch.push(doc.data().stokKodu));
  } else {
    // Product search - find matching products
    const matchingProducts = productCodes.filter(p =>
      p.stokKodu?.toLowerCase().includes(needle) ||
      p.stokAdi?.toLowerCase().includes(needle)
    );
    matchingProducts.forEach(p => p.stokKodu && stockCodesToSearch.push(p.stokKodu));
  }

  const uniqueStockCodes = Array.from(new Set(stockCodesToSearch));

  if (uniqueStockCodes.length === 0 && searchType !== 'serial') {
    return { ledgerRows: [], stockSummary: [], searchType };
  }

  // --- Fetch relevant data based on search type ---
  let depoStokSnap: any;
  let consumptionSnap: any;

  if (searchType === 'serial') {
    // First, get consumption records and depoStok by serial
    const [depoStokBySerial, consumptionBySerial] = await Promise.all([
      getDocs(query(collection(db, 'depoStok'), where('seriNumarasi', '==', needleOriginal))),
      getDocs(query(collection(db, 'tuketimKayitlari'), where('seriNumarasi', '==', needleOriginal))),
    ]);

    consumptionSnap = consumptionBySerial;

    // If depoStok has the serial, use it directly
    if (!depoStokBySerial.empty) {
      depoStokSnap = depoStokBySerial;
    } else if (targetLotNumarasi && uniqueStockCodes.length > 0) {
      // If not found by serial but we have stokKodu and lotNumarasi from consumption,
      // fetch depoStok by stokKodu and lotNumarasi to show mal kabul records
      depoStokSnap = await getDocs(
        query(
          collection(db, 'depoStok'),
          where('stokKodu', '==', uniqueStockCodes[0]),
          where('lotNumarasi', '==', targetLotNumarasi)
        )
      );
    } else {
      depoStokSnap = depoStokBySerial; // Empty but valid structure
    }
  } else if (searchType === 'lot') {
    [depoStokSnap, consumptionSnap] = await Promise.all([
      getDocs(query(collection(db, 'depoStok'), where('lotNumarasi', '==', needleOriginal))),
      getDocs(query(collection(db, 'tuketimKayitlari'), where('lotNumarasi', '==', needleOriginal))),
    ]);
  } else if (uniqueStockCodes.length > 0 && uniqueStockCodes.length <= 30) {
    [depoStokSnap, consumptionSnap] = await Promise.all([
      getDocs(query(collection(db, 'depoStok'), where('stokKodu', 'in', uniqueStockCodes))),
      getDocs(query(collection(db, 'tuketimKayitlari'), where('stokKodu', 'in', uniqueStockCodes))),
    ]);
  } else {
    return { ledgerRows: [], stockSummary: [], searchType };
  }

  // Fetch shipments, transfers, and destroyedKits
  const [shipmentsSnap, transfersSnap, destroyedKitsSnap] = await Promise.all([
    getDocs(collection(db, 'shipments')),
    getDocs(collection(db, 'transfers')),
    getDocs(collection(db, 'destroyedKitsReports')),
  ]);

  // Process fetched data
  const depoStok: DepoStokItem[] = filterByCompanyScope(
    depoStokSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as DepoStokItem[],
    companyId,
    isSuperAdmin,
  );
  const allShipments: Shipment[] = shipmentsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const allTransfers: Transfer[] = transfersSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const consumptionRecords: ConsumptionRecord[] = consumptionSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const allDestroyedKits: any[] = destroyedKitsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

  // Fetch transfer items from subcollection for each transfer
  const transfersWithItems: (Transfer & { items: any[] })[] = await Promise.all(
    allTransfers.map(async (tr) => {
      const itemsSnap = await getDocs(collection(db, 'transfers', tr.id, 'items'));
      const items = itemsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      return { ...tr, items };
    })
  );

  // Filter shipments by stock code/lot/serial
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

  // Filter transfers by stock code/lot/serial (using transfersWithItems that has items loaded)
  const filteredTransfers = transfersWithItems.filter(tr => {
    if (!tr.items || tr.items.length === 0) return false;
    return tr.items.some((it: any) => {
      if (searchType === 'serial') {
        return (it.seriNumarasi || '').toLowerCase() === needle;
      } else if (searchType === 'lot') {
        return (it.lotNumarasi || '').toLowerCase() === needle;
      } else {
        return uniqueStockCodes.includes(it.stokKodu);
      }
    });
  });

  // Filter destroyed kits by stock code/lot/serial
  const filteredDestroyedKits = allDestroyedKits.filter(kit => {
    if (searchType === 'serial') {
      return (kit.seriNumarasi || '').toLowerCase() === needle;
    } else if (searchType === 'lot') {
      return (kit.lotNumarasi || '').toLowerCase() === needle;
    } else {
      return uniqueStockCodes.includes(kit.stokKodu);
    }
  });

  // --- Build Ledger Rows based on search type ---
  const ledgerRows: LedgerRow[] = [];

  if (searchType === 'serial') {
    // SERIAL SEARCH: Show individual items
    buildSerialSearchRows(ledgerRows, depoStok, filteredShipments, filteredTransfers, consumptionRecords, filteredDestroyedKits, needle);
  } else {
    // PRODUCT/LOT SEARCH: Group by session
    buildGroupedSearchRows(ledgerRows, depoStok, filteredShipments, filteredTransfers, consumptionRecords, filteredDestroyedKits, uniqueStockCodes, searchType, needle);
  }

  // Sort by date descending
  ledgerRows.sort((a, b) => b.tarih.getTime() - a.tarih.getTime());

  // --- Calculate Stock Summary ---
  const stockSummary: StockSummary[] = [];
  const stokKodu = uniqueStockCodes[0];
  const product = productCodes.find(p => p.stokKodu === stokKodu);
  const birim = product?.anaBirim || 'Kutu';

  if (searchType === 'serial') {
    const inStockItem = depoStok.find(s => serialsOfDepoStok(s).some(sn => sn.toLowerCase() === needle));
    if (inStockItem) {
      if (inStockItem.isShipped) {
        stockSummary.push({
          konum: inStockItem.hedefKurum || 'Laboratuvar',
          konumTipi: 'laboratuvar',
          adet: 1,
          birim
        });
      } else {
        stockSummary.push({
          konum: inStockItem.depotName || 'Depo',
          konumTipi: 'depo',
          adet: 1,
          birim
        });
      }
    } else {
      const consumed = consumptionRecords.find(c => (serialOfConsumption(c) || '').toLowerCase() === needle);
      if (consumed) {
        stockSummary.push({
          konum: 'Tüketildi',
          konumTipi: 'laboratuvar',
          adet: 0,
          birim
        });
      }
    }
  } else {
    // Calculate current stock by location for product/lot search
    const stockByLocation: Record<string, { adet: number; konumTipi: 'depo' | 'laboratuvar' }> = {};

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
          const konum = item.isShipped
            ? (item.hedefKurum || 'Laboratuvar')
            : (item.depotName || 'Depo');
          const konumTipi = item.isShipped ? 'laboratuvar' : 'depo';

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
          birim
        });
      }
    });
  }

  return { ledgerRows, stockSummary, searchType };
}

// Helper to determine işlem tipi from consumptionType
function getConsumptionIslemTipi(consumptionType?: string): IslemTipi {
  switch (consumptionType) {
    case 'sayimdan_dusum':
      return 'Sayımdan Düşüm';
    case 'imha_dogrulama_sonrasi_dusum':
      return 'İmha';
    case 'lab_to_depot_return':
      return 'Laboratuvardan İade';
    default:
      return 'Kullanım';
  }
}

/**
 * Build rows for serial number search - individual items
 */
function buildSerialSearchRows(
  ledgerRows: LedgerRow[],
  depoStok: DepoStokItem[],
  shipments: Shipment[],
  transfers: (Transfer & { items: any[] })[],
  consumptions: ConsumptionRecord[],
  destroyedKits: any[],
  needle: string
) {
  // Calculate running totals for postAdet
  const stockByLocationLot: Record<string, number> = {};
  const getKey = (konum: string, stokKodu: string, lotNumarasi?: string) =>
    `${konum}|${stokKodu}|${lotNumarasi || ''}`;

  // Collect all events chronologically
  interface Event {
    tarih: Date;
    type: string;
    data: any;
  }
  const events: Event[] = [];

  // Add depoStok events (Mal Kabul)
  depoStok.forEach(d => {
    events.push({ tarih: normDate((d as any).eklenmeTarihi), type: 'malKabul', data: d });
  });

  // Add shipment events
  shipments.forEach(sh => {
    (sh.items || []).forEach(it => {
      if (serialsOfShipmentItem(it).some(sn => sn.toLowerCase() === needle)) {
        events.push({ tarih: normDate(sh.timestamp), type: 'shipment', data: { shipment: sh, item: it } });
      }
    });
  });

  // Add transfer events
  transfers.forEach(tr => {
    (tr.items || []).forEach((it: any) => {
      if ((it.seriNumarasi || '').toLowerCase() === needle) {
        events.push({ tarih: normDate(tr.timestamp), type: 'transfer', data: { transfer: tr, item: it } });
      }
    });
  });

  // Add consumption events
  consumptions.forEach(rec => {
    events.push({ tarih: normDate(rec.consumptionTimestamp), type: 'consumption', data: rec });
  });

  // Add destroyed kit events
  destroyedKits.forEach(kit => {
    if ((kit.seriNumarasi || '').toLowerCase() === needle) {
      events.push({ tarih: normDate(kit.resolvedAt || kit.timestamp || kit.createdAt), type: 'destroyed', data: kit });
    }
  });

  // Sort by date
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
        actor: (d as any).createdByName || (d as any).userName || (d as any).ekleyenKullanici || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: serialsOfDepoStok(d),
        konum: d.depotName || 'Depo',
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
        id: `tr_${tr.id}_${it.stokKodu}_${it.lotNumarasi}_${it.seriNumarasi}`,
        stokKodu: it.stokKodu,
        stokAdi: it.stokAdi,
        lotNumarasi: it.lotNumarasi,
        miad: formatMiad(it.miad),
        islemTipi: 'Direkt Transfer',
        actor: tr.userName || '-',
        tarih: ev.tarih,
        adet: 1,
        seriNolar: [it.seriNumarasi].filter(Boolean),
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

/**
 * Build grouped rows for product/lot search - session based grouping
 */
function buildGroupedSearchRows(
  ledgerRows: LedgerRow[],
  depoStok: DepoStokItem[],
  shipments: Shipment[],
  transfers: (Transfer & { items: any[] })[],
  consumptions: ConsumptionRecord[],
  destroyedKits: any[],
  stockCodes: string[],
  searchType: 'product' | 'lot',
  needle: string
) {
  // Filter items based on search type
  const filterItem = (item: any) => {
    if (searchType === 'lot') {
      return (item.lotNumarasi || '').toLowerCase() === needle;
    }
    return stockCodes.includes(item.stokKodu);
  };

  // Calculate running totals
  const stockByLocationLot: Record<string, number> = {};
  const getKey = (konum: string, stokKodu: string, lotNumarasi?: string) =>
    `${konum}|${stokKodu}|${lotNumarasi || ''}`;

  // Collect all events chronologically
  interface GroupedEvent {
    tarih: Date;
    type: string;
    data: any;
    groupKey: string;
  }
  const events: GroupedEvent[] = [];

  // Group Mal Kabul by session (same timestamp, user, depot, product, lot)
  const malKabulGroups = new Map<string, DepoStokItem[]>();
  depoStok.forEach(d => {
    if (!filterItem(d)) return;
    const tarih = normDate((d as any).eklenmeTarihi);
    // Round to minute for grouping
    const tarihKey = `${Math.floor(tarih.getTime() / 60000)}`;
    const groupKey = `mk|${tarihKey}|${(d as any).createdByName || (d as any).userName || ''}|${d.depotName || ''}|${d.stokKodu}|${d.lotNumarasi || ''}`;

    if (!malKabulGroups.has(groupKey)) {
      malKabulGroups.set(groupKey, []);
    }
    malKabulGroups.get(groupKey)!.push(d);
  });

  malKabulGroups.forEach((items, groupKey) => {
    const first = items[0];
    events.push({
      tarih: normDate((first as any).eklenmeTarihi),
      type: 'malKabul',
      data: items,
      groupKey
    });
  });

  // Group Shipments by session
  shipments.forEach(sh => {
    const relevantItems = (sh.items || []).filter(filterItem);
    if (relevantItems.length === 0) return;

    // Group by product+lot within the shipment
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
        groupKey: `sh|${sh.id}|${itemKey}`
      });
    });
  });

  // Group Transfers by session
  transfers.forEach(tr => {
    const relevantItems = (tr.items || []).filter(filterItem);
    if (relevantItems.length === 0) return;

    // Group by product+lot within the transfer
    const itemGroups = new Map<string, any[]>();
    relevantItems.forEach((it: any) => {
      const key = `${it.stokKodu}|${it.lotNumarasi || ''}`;
      if (!itemGroups.has(key)) itemGroups.set(key, []);
      itemGroups.get(key)!.push(it);
    });

    itemGroups.forEach((items, itemKey) => {
      events.push({
        tarih: normDate(tr.timestamp),
        type: 'transfer',
        data: { transfer: tr, items },
        groupKey: `tr|${tr.id}|${itemKey}`
      });
    });
  });

  // Consumptions are always individual (each usage is separate)
  consumptions.forEach(rec => {
    if (!filterItem(rec)) return;
    events.push({
      tarih: normDate(rec.consumptionTimestamp),
      type: 'consumption',
      data: rec,
      groupKey: `tk|${rec.id}`
    });
  });

  // Destroyed kits
  destroyedKits.forEach(kit => {
    if (!filterItem(kit)) return;
    events.push({
      tarih: normDate(kit.resolvedAt || kit.timestamp || kit.createdAt),
      type: 'destroyed',
      data: kit,
      groupKey: `imha|${kit.id}`
    });
  });

  // Sort by date
  events.sort((a, b) => a.tarih.getTime() - b.tarih.getTime());

  // Process events and calculate postAdet
  events.forEach(ev => {
    if (ev.type === 'malKabul') {
      const items = ev.data as DepoStokItem[];
      const first = items[0];
      const key = getKey(first.depotName || 'Depo', first.stokKodu, first.lotNumarasi);
      stockByLocationLot[key] = (stockByLocationLot[key] || 0) + items.length;

      const allSerials = items.flatMap(d => serialsOfDepoStok(d));

      ledgerRows.push({
        id: `mk_grp_${ev.groupKey}`,
        stokKodu: first.stokKodu,
        stokAdi: first.stokAdi,
        lotNumarasi: first.lotNumarasi,
        miad: formatMiad(first.miad),
        islemTipi: 'Mal Kabul',
        actor: (first as any).createdByName || (first as any).userName || (first as any).ekleyenKullanici || '-',
        tarih: ev.tarih,
        adet: items.length,
        seriNolar: allSerials,
        konum: first.depotName || 'Depo',
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

      const allSerials = items.map((it: any) => it.seriNumarasi).filter(Boolean);

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
