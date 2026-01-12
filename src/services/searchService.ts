'use client';

import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  collectionGroup,
  limit,
} from 'firebase/firestore';
import type { DepoStokItem, Shipment, ConsumptionRecord, Depot, ProductCode, Transfer } from '@/lib/types';

// Consolidated row type for the ledger
export interface LedgerRow {
  id: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi?: string;
  miad?: string;
  islemTipi: 'Mal Kabul' | 'Karşılanan Sipariş' | 'Direkt Transfer' | 'Kullanım';
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
  return new Date(d);
};

const formatMiad = (d: any): string => {
  const date = normDate(d);
  if (date.getTime() === 0) return '-';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
};

type TransferItem = {
  transferId: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi?: string;
};

/**
 * Client-side search function for the product ledger.
 * Only fetches data when search is performed - no initial data load.
 */
export async function searchProductLedger(
  q: string,
  productCodes: ProductCode[],
  depots: Depot[]
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
    const productFromSerialSnap = await getDocs(
      query(collection(db, 'depoStok'), where('seriNumarasi', '==', needleOriginal), limit(1))
    );
    if (!productFromSerialSnap.empty) {
      const data = productFromSerialSnap.docs[0].data();
      stockCodesToSearch.push(data.stokKodu);
      targetLotNumarasi = data.lotNumarasi;
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
    [depoStokSnap, consumptionSnap] = await Promise.all([
      getDocs(query(collection(db, 'depoStok'), where('seriNumarasi', '==', needleOriginal))),
      getDocs(query(collection(db, 'tuketimKayitlari'), where('seriNumarasi', '==', needleOriginal))),
    ]);
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
    // Too many stock codes, return empty
    return { ledgerRows: [], stockSummary: [], searchType };
  }

  // Fetch shipments and transfers
  const [shipmentsSnap, transfersSnap] = await Promise.all([
    getDocs(collection(db, 'shipments')),
    getDocs(collection(db, 'transfers')),
  ]);

  // Process fetched data
  const depoStok: DepoStokItem[] = depoStokSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const allShipments: Shipment[] = shipmentsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const allTransfers: Transfer[] = transfersSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  const consumptionRecords: ConsumptionRecord[] = consumptionSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

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

  // Get transfer items from transfers
  const transferItems: TransferItem[] = [];
  for (const transfer of allTransfers) {
    if (transfer.items && Array.isArray(transfer.items)) {
      for (const item of transfer.items) {
        const shouldInclude =
          searchType === 'serial'
            ? (item.seriNumarasi || '').toLowerCase() === needle
            : searchType === 'lot'
              ? (item.lotNumarasi || '').toLowerCase() === needle
              : uniqueStockCodes.includes(item.stokKodu);

        if (shouldInclude) {
          transferItems.push({
            transferId: transfer.id,
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            lotNumarasi: item.lotNumarasi,
            miad: item.miad,
            seriNumarasi: item.seriNumarasi,
          });
        }
      }
    }
  }

  const transferMap = new Map(allTransfers.map(t => [t.id, t]));

  // --- Calculate postAdet for each event ---
  interface StockEvent {
    tarih: Date;
    stokKodu: string;
    lotNumarasi?: string;
    seriNumarasi?: string;
    islemTipi: string;
    konum: string;
    hedefKonum?: string;
    adet: number;
    konumTipi: 'depo' | 'lab';
  }

  const allEvents: StockEvent[] = [];

  // 1. Mal Kabul events from depoStok
  depoStok.forEach(d => {
    const tarih = normDate((d as any).eklenmeTarihi);
    allEvents.push({
      tarih,
      stokKodu: d.stokKodu,
      lotNumarasi: d.lotNumarasi,
      seriNumarasi: d.seriNumarasi,
      islemTipi: 'Mal Kabul',
      konum: d.depotName || 'Depo',
      adet: 1,
      konumTipi: 'depo'
    });
  });

  // 2. Shipment events
  filteredShipments.forEach(sh => {
    const tarih = normDate(sh.timestamp);
    (sh.items || []).forEach(it => {
      const shouldInclude = searchType === 'serial'
        ? serialsOfShipmentItem(it).some(sn => sn.toLowerCase() === needle)
        : searchType === 'lot'
          ? (it.lotNumarasi || '').toLowerCase() === needle
          : uniqueStockCodes.includes(it.stokKodu);

      if (shouldInclude) {
        const qty = it.quantity || serialsOfShipmentItem(it).length || 1;
        allEvents.push({
          tarih,
          stokKodu: it.stokKodu,
          lotNumarasi: it.lotNumarasi,
          islemTipi: 'Karşılanan Sipariş',
          konum: sh.depotName || 'Depo',
          hedefKonum: sh.recipientHospital,
          adet: -qty,
          konumTipi: 'depo'
        });
        allEvents.push({
          tarih,
          stokKodu: it.stokKodu,
          lotNumarasi: it.lotNumarasi,
          islemTipi: 'Karşılanan Sipariş',
          konum: sh.recipientHospital,
          adet: qty,
          konumTipi: 'lab'
        });
      }
    });
  });

  // 3. Transfer events
  transferItems.forEach(it => {
    const transfer = transferMap.get(it.transferId);
    if (!transfer) return;
    const tarih = normDate(transfer.timestamp);

    allEvents.push({
      tarih,
      stokKodu: it.stokKodu,
      lotNumarasi: it.lotNumarasi,
      seriNumarasi: it.seriNumarasi,
      islemTipi: 'Direkt Transfer',
      konum: transfer.sourceDepotName || 'Depo',
      hedefKonum: transfer.targetName,
      adet: -1,
      konumTipi: 'depo'
    });
    allEvents.push({
      tarih,
      stokKodu: it.stokKodu,
      lotNumarasi: it.lotNumarasi,
      seriNumarasi: it.seriNumarasi,
      islemTipi: 'Direkt Transfer',
      konum: transfer.targetName,
      adet: 1,
      konumTipi: 'lab'
    });
  });

  // 4. Consumption events
  consumptionRecords.forEach(rec => {
    const tarih = normDate(rec.consumptionTimestamp);
    allEvents.push({
      tarih,
      stokKodu: rec.stokKodu,
      lotNumarasi: rec.lotNumarasi,
      seriNumarasi: rec.seriNumarasi,
      islemTipi: 'Kullanım',
      konum: rec.laboratoryName || 'Laboratuvar',
      adet: -1,
      konumTipi: 'lab'
    });
  });

  // Sort events by date
  allEvents.sort((a, b) => a.tarih.getTime() - b.tarih.getTime());

  // Calculate running totals
  const stockByLocationLot: Record<string, number> = {};
  const getKey = (konum: string, stokKodu: string, lotNumarasi?: string) =>
    `${konum}|${stokKodu}|${lotNumarasi || ''}`;

  const eventPostAdet: Map<string, { postDepo: number; postHedef: number }> = new Map();

  allEvents.forEach((ev) => {
    const key = getKey(ev.konum, ev.stokKodu, ev.lotNumarasi);
    stockByLocationLot[key] = (stockByLocationLot[key] || 0) + ev.adet;

    const eventId = `${ev.islemTipi}|${ev.tarih.getTime()}|${ev.stokKodu}|${ev.lotNumarasi || ''}|${ev.seriNumarasi || ''}|${ev.konum}`;
    const postDepo = stockByLocationLot[key] || 0;
    let postHedef = 0;

    if (ev.hedefKonum) {
      const hedefKey = getKey(ev.hedefKonum, ev.stokKodu, ev.lotNumarasi);
      postHedef = stockByLocationLot[hedefKey] || 0;
    }

    eventPostAdet.set(eventId, { postDepo: Math.max(0, postDepo), postHedef: Math.max(0, postHedef) });
  });

  // --- Build Ledger Rows ---
  const ledgerRows: LedgerRow[] = [];

  // 1. Mal Kabul from depoStok
  depoStok.forEach(d => {
    const eventId = `Mal Kabul|${normDate((d as any).eklenmeTarihi).getTime()}|${d.stokKodu}|${d.lotNumarasi || ''}|${d.seriNumarasi || ''}|${d.depotName || 'Depo'}`;
    const postAdet = eventPostAdet.get(eventId);

    ledgerRows.push({
      id: `mk_ds_${d.id}`,
      stokKodu: d.stokKodu,
      stokAdi: d.stokAdi,
      lotNumarasi: d.lotNumarasi,
      miad: formatMiad(d.miad),
      islemTipi: 'Mal Kabul',
      actor: (d as any).createdByName || (d as any).userName || (d as any).ekleyenKullanici || '-',
      tarih: normDate((d as any).eklenmeTarihi),
      adet: 1,
      seriNolar: serialsOfDepoStok(d),
      konum: d.depotName || 'Depo',
      postAdetDepo: postAdet?.postDepo ?? undefined,
    });
  });

  // 2. Shipments
  filteredShipments.forEach(sh => {
    (sh.items || []).forEach(it => {
      const shouldInclude = searchType === 'serial'
        ? serialsOfShipmentItem(it).some(sn => sn.toLowerCase() === needle)
        : searchType === 'lot'
          ? (it.lotNumarasi || '').toLowerCase() === needle
          : uniqueStockCodes.includes(it.stokKodu);

      if (shouldInclude) {
        const serials = searchType === 'serial'
          ? serialsOfShipmentItem(it).filter(sn => sn.toLowerCase() === needle)
          : serialsOfShipmentItem(it);
        const qty = searchType === 'serial' ? serials.length : (it.quantity || serialsOfShipmentItem(it).length || 1);

        const eventId = `Karşılanan Sipariş|${normDate(sh.timestamp).getTime()}|${it.stokKodu}|${it.lotNumarasi || ''}||${sh.depotName || 'Depo'}`;
        const postAdet = eventPostAdet.get(eventId);

        ledgerRows.push({
          id: `sh_${sh.id}_${it.stokKodu}_${it.lotNumarasi || ''}_${it.miad || ''}`,
          stokKodu: it.stokKodu,
          stokAdi: it.stokAdi,
          lotNumarasi: it.lotNumarasi,
          miad: formatMiad(it.miad),
          islemTipi: 'Karşılanan Sipariş',
          actor: sh.userName || '-',
          tarih: normDate(sh.timestamp),
          adet: qty,
          seriNolar: serials,
          konum: sh.depotName || 'Depo',
          hedefKonum: sh.recipientHospital,
          postAdetDepo: postAdet?.postDepo ?? undefined,
          postAdetHedef: postAdet?.postHedef ?? undefined,
        });
      }
    });
  });

  // 3. Transfers
  const transferGroups = new Map<string, { transfer: Transfer; items: TransferItem[] }>();
  transferItems.forEach(it => {
    const transfer = transferMap.get(it.transferId);
    if (!transfer) return;
    const key = `${it.transferId}|${it.stokKodu}|${it.lotNumarasi}|${it.miad}`;
    const group = transferGroups.get(key) || { transfer, items: [] };
    group.items.push(it);
    transferGroups.set(key, group);
  });

  transferGroups.forEach(({ transfer, items }) => {
    const sample = items[0];
    const serials = items.map(x => x.seriNumarasi).filter(Boolean) as string[];

    const eventId = `Direkt Transfer|${normDate(transfer.timestamp).getTime()}|${sample.stokKodu}|${sample.lotNumarasi || ''}|${sample.seriNumarasi || ''}|${transfer.sourceDepotName || 'Depo'}`;
    const postAdet = eventPostAdet.get(eventId);

    ledgerRows.push({
      id: `tr_${transfer.id}_${sample.stokKodu}_${sample.lotNumarasi}_${sample.miad}`,
      stokKodu: sample.stokKodu,
      stokAdi: sample.stokAdi,
      lotNumarasi: sample.lotNumarasi,
      miad: formatMiad(sample.miad),
      islemTipi: 'Direkt Transfer',
      actor: transfer.userName || '-',
      tarih: normDate(transfer.timestamp),
      adet: items.length,
      seriNolar: serials,
      konum: transfer.sourceDepotName || 'Depo',
      hedefKonum: transfer.targetName,
      postAdetDepo: postAdet?.postDepo ?? undefined,
      postAdetHedef: postAdet?.postHedef ?? undefined,
    });
  });

  // 4. Consumption
  consumptionRecords.forEach(rec => {
    const eventId = `Kullanım|${normDate(rec.consumptionTimestamp).getTime()}|${rec.stokKodu}|${rec.lotNumarasi || ''}|${rec.seriNumarasi || ''}|${rec.laboratoryName || 'Laboratuvar'}`;
    const postAdet = eventPostAdet.get(eventId);

    ledgerRows.push({
      id: `tk_${rec.id}`,
      stokKodu: rec.stokKodu,
      stokAdi: rec.stokAdi,
      lotNumarasi: rec.lotNumarasi,
      miad: formatMiad(rec.miad),
      islemTipi: 'Kullanım',
      actor: rec.userName || '-',
      tarih: normDate(rec.consumptionTimestamp),
      adet: 1,
      seriNolar: rec.seriNumarasi ? [rec.seriNumarasi] : [],
      konum: rec.laboratoryName || 'Laboratuvar',
      postAdetDepo: undefined,
      postAdetHedef: postAdet?.postDepo ?? undefined,
    });
  });

  // Sort by date descending
  ledgerRows.sort((a, b) => b.tarih.getTime() - a.tarih.getTime());

  // --- Calculate Stock Summary ---
  const stockSummary: StockSummary[] = [];
  const stokKodu = uniqueStockCodes[0];
  const product = productCodes.find(p => p.stokKodu === stokKodu);
  const birim = product?.anaBirim || 'Adet';

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
