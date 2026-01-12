'use server';
import { adminDb } from '@/lib/firebase-admin';
import type { DepoStokItem, Shipment, ConsumptionRecord, Depot, ProductCode, User, Transfer } from '@/lib/types';

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
  // İşlem sonrası kalan adet bilgileri
  postAdetDepo?: number;      // İşlem sonrası depoda kalan adet
  postAdetHedef?: number;     // İşlem sonrası hedef konumda kalan adet (lab/hastane)
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

// Serial Number normalization helpers
const serialsOfDepoStok = (d: any): string[] =>
  Array.from(new Set([d?.seriNumarasi, d?.seriNo, d?.serialNumber, d?.serialNo].filter(Boolean) as string[]));

const serialsOfShipmentItem = (it: any): string[] =>
  Array.from(new Set((it?.serialNumbers || it?.seriNolar || it?.seriNoList || []) as string[]));

const serialOfConsumption = (rec: any): string | null =>
  rec?.seriNumarasi || rec?.seriNo || rec?.serialNumber || null;

// Date normalization
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
 * Server Action to perform an optimized search on the product ledger.
 * Only fetches data when search is performed - no initial data load.
 */
export async function searchProductLedger(q: string): Promise<SearchResult> {
  if (!q || q.trim().length < 2) {
    return { ledgerRows: [], stockSummary: [], searchType: 'product' };
  }

  const needle = q.trim().toLowerCase();
  const needleOriginal = q.trim();

  // Fetch master data required for processing
  const [depotsSnap, pcSnap, usersSnap] = await Promise.all([
    adminDb.collection('depots').get(),
    adminDb.collection('productCodes').get(),
    adminDb.collection('users').get(),
  ]);

  const depots = depotsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Depot));
  const productCodes = pcSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode));
  const usersMap = Object.fromEntries(usersSnap.docs.map(d => [d.id, d.data() as User]));

  const productOf = (code?: string) => productCodes.find(p => p.stokKodu === code);
  const depotOf = (id?: string) => depots.find(d => d.id === id);

  // --- Detect Search Type ---
  let searchType: 'product' | 'lot' | 'serial' = 'product';

  // Check for serial number (usually longer than 8 chars)
  const isPotentiallySerial = needle.length > 6;

  if (isPotentiallySerial) {
    const serialQueries = [
      adminDb.collection('depoStok').where('seriNumarasi', '==', needleOriginal).limit(1).get(),
      adminDb.collection('tuketimKayitlari').where('seriNumarasi', '==', needleOriginal).limit(1).get(),
      adminDb.collection('verificationReports').where('seriNumarasi', '==', needleOriginal).limit(1).get()
    ];
    const serialResults = await Promise.all(serialQueries);
    if (serialResults.some(snap => !snap.empty)) {
      searchType = 'serial';
    }
  }

  // Check for lot number if not serial
  if (searchType === 'product') {
    const lotQuery = adminDb.collection('depoStok').where('lotNumarasi', '==', needleOriginal).limit(1);
    const lotSnap = await lotQuery.get();
    if (!lotSnap.empty) searchType = 'lot';
  }

  // --- Determine stock codes to search ---
  const stockCodesToSearch: string[] = [];
  let targetLotNumarasi: string | undefined;
  let targetSeriNumarasi: string | undefined;

  if (searchType === 'serial') {
    targetSeriNumarasi = needleOriginal;
    // Find product code from serial
    const productFromSerialSnap = await adminDb.collection('depoStok').where('seriNumarasi', '==', needleOriginal).limit(1).get();
    if (!productFromSerialSnap.empty) {
      const data = productFromSerialSnap.docs[0].data();
      stockCodesToSearch.push(data.stokKodu);
      targetLotNumarasi = data.lotNumarasi;
    }
  } else if (searchType === 'lot') {
    targetLotNumarasi = needleOriginal;
    const productsFromLotSnap = await adminDb.collection('depoStok').where('lotNumarasi', '==', needleOriginal).get();
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

  // --- Fetch all relevant data ---
  const fetchPromises: Promise<any>[] = [];

  // DepoStok - for Mal Kabul and current stock
  if (searchType === 'serial') {
    fetchPromises.push(adminDb.collection('depoStok').where('seriNumarasi', '==', needleOriginal).get());
  } else if (searchType === 'lot') {
    fetchPromises.push(adminDb.collection('depoStok').where('lotNumarasi', '==', needleOriginal).get());
  } else if (uniqueStockCodes.length > 0) {
    // Firestore 'in' query supports max 30 items
    const chunks = [];
    for (let i = 0; i < uniqueStockCodes.length; i += 30) {
      chunks.push(uniqueStockCodes.slice(i, i + 30));
    }
    const chunkPromises = chunks.map(chunk =>
      adminDb.collection('depoStok').where('stokKodu', 'in', chunk).get()
    );
    fetchPromises.push(Promise.all(chunkPromises).then(snaps => ({
      docs: snaps.flatMap(s => s.docs)
    })));
  }

  // Verification Reports - for Mal Kabul records
  if (searchType === 'serial') {
    fetchPromises.push(
      adminDb.collection('verificationReports')
        .where('seriNumarasi', '==', needleOriginal)
        .where('raporTipi', '==', 'mal_kabul')
        .get()
    );
  } else if (searchType === 'lot') {
    fetchPromises.push(
      adminDb.collection('verificationReports')
        .where('lotNumarasi', '==', needleOriginal)
        .where('raporTipi', '==', 'mal_kabul')
        .get()
    );
  } else {
    fetchPromises.push(Promise.resolve({ docs: [] })); // Placeholder
  }

  // Shipments - fetch all and filter
  fetchPromises.push(adminDb.collection('shipments').get());

  // Transfers
  fetchPromises.push(adminDb.collection('transfers').get());

  // Transfer Items (subcollection)
  if (searchType === 'serial') {
    fetchPromises.push(
      adminDb.collectionGroup('items').where('seriNumarasi', '==', needleOriginal).get()
    );
  } else if (searchType === 'lot') {
    fetchPromises.push(
      adminDb.collectionGroup('items').where('lotNumarasi', '==', needleOriginal).get()
    );
  } else if (uniqueStockCodes.length > 0 && uniqueStockCodes.length <= 30) {
    fetchPromises.push(
      adminDb.collectionGroup('items').where('stokKodu', 'in', uniqueStockCodes).get()
    );
  } else {
    fetchPromises.push(adminDb.collectionGroup('items').get());
  }

  // Consumption Records
  if (searchType === 'serial') {
    fetchPromises.push(
      adminDb.collection('tuketimKayitlari').where('seriNumarasi', '==', needleOriginal).get()
    );
  } else if (searchType === 'lot') {
    fetchPromises.push(
      adminDb.collection('tuketimKayitlari').where('lotNumarasi', '==', needleOriginal).get()
    );
  } else if (uniqueStockCodes.length > 0 && uniqueStockCodes.length <= 30) {
    fetchPromises.push(
      adminDb.collection('tuketimKayitlari').where('stokKodu', 'in', uniqueStockCodes).get()
    );
  } else {
    fetchPromises.push(Promise.resolve({ docs: [] }));
  }

  const [
    depoStokSnap,
    verifSnap,
    shipmentsSnap,
    transfersSnap,
    transferItemsSnap,
    consumptionSnap
  ] = await Promise.all(fetchPromises);

  // Process fetched data
  const depoStok: DepoStokItem[] = depoStokSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];
  const verificationReports = verifSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];
  const allShipments: Shipment[] = shipmentsSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];
  const allTransfers: Transfer[] = transfersSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];
  const transferItems: TransferItem[] = transferItemsSnap?.docs?.map((d: any) => ({
    transferId: d.ref.parent.parent?.id || '',
    ...d.data()
  })) || [];
  const consumptionRecords: ConsumptionRecord[] = consumptionSnap?.docs?.map((d: any) => ({ id: d.id, ...d.data() })) || [];

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

  // Filter transfer items
  const filteredTransferItems = transferItems.filter(it => {
    if (searchType === 'serial') {
      return (it.seriNumarasi || '').toLowerCase() === needle;
    } else if (searchType === 'lot') {
      return (it.lotNumarasi || '').toLowerCase() === needle;
    } else {
      return uniqueStockCodes.includes(it.stokKodu);
    }
  });

  // Build a map of transfers for quick lookup
  const transferMap = new Map(allTransfers.map(t => [t.id, t]));

  // --- Calculate postAdet for each event ---
  // We need to track stock levels chronologically

  interface StockEvent {
    tarih: Date;
    stokKodu: string;
    lotNumarasi?: string;
    seriNumarasi?: string;
    islemTipi: string;
    konum: string;
    hedefKonum?: string;
    adet: number;  // positive = increase, negative = decrease
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

  // 2. Shipment events (depo -> lab)
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
        // Decrease from depot
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
        // Increase in lab
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
  filteredTransferItems.forEach(it => {
    const transfer = transferMap.get(it.transferId);
    if (!transfer) return;
    const tarih = normDate(transfer.timestamp);

    // Decrease from source
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
    // Increase in target
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

  // Calculate running totals per location and lot
  const stockByLocationLot: Record<string, number> = {};
  const getKey = (konum: string, stokKodu: string, lotNumarasi?: string) =>
    `${konum}|${stokKodu}|${lotNumarasi || ''}`;

  const eventPostAdet: Map<string, { postDepo: number; postHedef: number }> = new Map();

  allEvents.forEach((ev, idx) => {
    const key = getKey(ev.konum, ev.stokKodu, ev.lotNumarasi);
    stockByLocationLot[key] = (stockByLocationLot[key] || 0) + ev.adet;

    // Store post-operation amounts
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
      actor: (d as any).createdByName || (d as any).userName || (d as any).ekleyenKullanici || usersMap[(d as any).createdByUid]?.name || '-',
      tarih: normDate((d as any).eklenmeTarihi),
      adet: 1,
      seriNolar: serialsOfDepoStok(d),
      konum: d.depotName || 'Depo',
      postAdetDepo: postAdet?.postDepo ?? undefined,
    });
  });

  // 2. Mal Kabul from verification reports
  verificationReports.forEach((r: any) => {
    // Avoid duplicates with depoStok
    const hasDuplicate = ledgerRows.some(row =>
      row.islemTipi === 'Mal Kabul' &&
      row.stokKodu === r.stokKodu &&
      row.lotNumarasi === r.lotNumarasi &&
      row.seriNolar.includes(r.seriNumarasi)
    );
    if (hasDuplicate) return;

    const eventId = `Mal Kabul|${normDate(r.islemTarihi).getTime()}|${r.stokKodu}|${r.lotNumarasi || ''}|${r.seriNumarasi || ''}|${r.depotName || 'Depo'}`;
    const postAdet = eventPostAdet.get(eventId);

    ledgerRows.push({
      id: `mk_vr_${r.id}`,
      stokKodu: r.stokKodu || '',
      stokAdi: r.stokAdi || '',
      lotNumarasi: r.lotNumarasi,
      miad: formatMiad(r.miad),
      islemTipi: 'Mal Kabul',
      actor: r.createdByName || r.userName || usersMap[r.createdByUid]?.name || '-',
      tarih: normDate(r.islemTarihi),
      adet: 1,
      seriNolar: r.seriNumarasi ? [r.seriNumarasi] : [],
      konum: r.depotName || 'Depo',
      postAdetDepo: postAdet?.postDepo ?? undefined,
    });
  });

  // 3. Shipments
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

  // 4. Transfers - Group by transfer + stock + lot
  const transferGroups = new Map<string, { transfer: Transfer; items: TransferItem[] }>();
  filteredTransferItems.forEach(it => {
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

  // 5. Consumption
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
      postAdetHedef: postAdet?.postDepo ?? undefined, // Lab count after consumption
    });
  });

  // Sort by date descending (newest first)
  ledgerRows.sort((a, b) => b.tarih.getTime() - a.tarih.getTime());

  // --- Calculate Stock Summary ---
  const stockSummary: StockSummary[] = [];
  const stokKodu = uniqueStockCodes[0];
  const product = productOf(stokKodu);
  const birim = product?.anaBirim || 'Adet';

  if (searchType === 'serial') {
    // For serial search, find current location
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
      // Check if consumed
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
    // For product/lot search, calculate current stock by location
    const stockByLocation: Record<string, { adet: number; konumTipi: 'depo' | 'laboratuvar' }> = {};

    depoStok.forEach(item => {
      const matchesLot = searchType === 'lot'
        ? (item.lotNumarasi || '').toLowerCase() === needle
        : true;
      const matchesProduct = uniqueStockCodes.includes(item.stokKodu);

      if (matchesProduct && matchesLot) {
        // Check consumption - item is still in stock
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
