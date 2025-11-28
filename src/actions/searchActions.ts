'use server';
import { adminDb } from '@/lib/firebase-admin';
import type { DepoStokItem, Shipment, ConsumptionRecord, Depot, ProductCode, User, Transfer } from '@/lib/types';
import { Timestamp } from 'firebase-admin/firestore';


// Consolidated row type for the ledger
export interface LedgerRow {
  id: string;
  stokKodu?: string;
  stokAdi?: string;
  lotNumarasi?: string;
  miad?: string;
  islemTipi?: 'Mal Kabul' | 'Karşılanan Sipariş' | 'Direkt Transfer' | 'Kullanım';
  actor?: string;
  tarih?: Date;
  adet?: number;
  seriNolar: string[];
  konum?: string;
  postAdet?: number;
}

export interface StockSummary {
    label: string;
    adet: number;
    birim: string;
}

type SearchType = 'product' | 'lot' | 'serial';

// Serial Number normalization helpers
const serialsOfDepoStok = (d: any): string[] => Array.from(new Set([d?.seriNumarasi, d?.seriNo, d?.serialNumber, d?.serialNo].filter(Boolean) as string[]));
const serialsOfShipmentItem = (it: any): string[] => Array.from(new Set((it?.serialNumbers || it?.seriNolar || it?.seriNoList || []) as string[]));
const serialOfConsumption = (rec: any): string | null => rec?.seriNumarasi || rec?.seriNo || rec?.serialNumber || null;

// Date normalization
const normDate = (d: any): Date => (d?.toDate ? d.toDate() : new Date(d || 0));

/**
 * Server Action to perform an indexed search on the product ledger.
 * @param q The search query string.
 * @returns An object containing ledger rows and a stock summary.
 */
export async function searchProductLedger(q: string): Promise<{ ledgerRows: LedgerRow[], summary: StockSummary[], searchType: SearchType }> {
    if (!q || q.trim().length < 3) {
        return { ledgerRows: [], summary: [], searchType: 'product' };
    }
    const needle = q.trim().toLowerCase();

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

    // --- Detect Search Type ---
    let searchType: SearchType = 'product';
    const isPotentiallySerial = needle.length > 8;
    
    if (isPotentiallySerial) {
        const serialQueries = [
            adminDb.collection('depoStok').where('seriNumarasi', '==', needle).limit(1).get(),
            adminDb.collection('tuketimKayitlari').where('seriNumarasi', '==', needle).limit(1).get(),
            adminDb.collection('verificationReports').where('seriNumarasi', '==', needle).limit(1).get()
        ];
        const serialResults = await Promise.all(serialQueries);
        if (serialResults.some(snap => !snap.empty)) {
            searchType = 'serial';
        }
    }
    
    if (searchType === 'product') {
        const lotQuery = adminDb.collection('depoStok').where('lotNumarasi', '==', needle).limit(1);
        const lotSnap = await lotQuery.get();
        if (!lotSnap.empty) searchType = 'lot';
    }

    // --- Perform Queries based on Type ---
    const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
    const stockCodesToSearch: string[] = [];

    if (searchType === 'serial') {
        const productFromSerialSnap = await adminDb.collection('depoStok').where('seriNumarasi', '==', needle).limit(1).get();
        if(!productFromSerialSnap.empty) {
            stockCodesToSearch.push(productFromSerialSnap.docs[0].data().stokKodu);
        }
    } else if (searchType === 'lot') {
        const productsFromLotSnap = await adminDb.collection('depoStok').where('lotNumarasi', '==', needle).get();
        productsFromLotSnap.forEach(doc => stockCodesToSearch.push(doc.data().stokKodu));
    } else { // product search
        const matchingProducts = productCodes.filter(p => 
            p.stokKodu?.toLowerCase().includes(needle) || 
            p.stokAdi?.toLowerCase().includes(needle)
        );
        matchingProducts.forEach(p => p.stokKodu && stockCodesToSearch.push(p.stokKodu));
    }

    const uniqueStockCodes = Array.from(new Set(stockCodesToSearch));

    // Now, query collections based on determined stock codes or serial/lot numbers
    if (searchType === 'serial') {
        queries.push(adminDb.collection('depoStok').where('seriNumarasi', '==', needle).get());
        queries.push(adminDb.collection('shipments').where('items', 'array-contains-any', [{serialNumbers: [needle]}]).get());
        queries.push(adminDb.collection('tuketimKayitlari').where('seriNumarasi', '==', needle).get());
        queries.push(adminDb.collection('verificationReports').where('seriNumarasi', '==', needle).where('raporTipi', '==', 'mal_kabul').get());
        queries.push(adminDb.collectionGroup('items').where('seriNumarasi', '==', needle).get());
    } else if (uniqueStockCodes.length > 0) {
        if(searchType === 'lot') {
            queries.push(adminDb.collection('depoStok').where('lotNumarasi', '==', needle).get());
        } else {
             queries.push(adminDb.collection('depoStok').where('stokKodu', 'in', uniqueStockCodes).get());
        }
    }
    
    const [
        depoStokSnap, 
        shipmentsSnap, 
        consSnap, 
        verifSnap, 
        transferItemsSnap
    ] = await Promise.all(queries);

    const depoStok = depoStokSnap ? depoStokSnap.docs.map(d => ({id: d.id, ...d.data()}) as DepoStokItem) : [];

    const malKabulEvents: LedgerRow[] = [];
    
    // Process depoStok for Mal Kabul
    depoStok.forEach(d => {
        malKabulEvents.push({
            id: `mk_${d.id}`,
            stokKodu: d.stokKodu,
            stokAdi: d.stokAdi,
            lotNumarasi: d.lotNumarasi,
            miad: d.miad as string,
            islemTipi: 'Mal Kabul',
            actor: (d as any).createdByName || (d as any).userName || (d as any).ekleyenKullanici || usersMap[(d as any).createdByUid]?.name || '-',
            tarih: normDate((d as any).eklenmeTarihi),
            adet: 1,
            seriNolar: serialsOfDepoStok(d),
            konum: d.depotName || 'Depo',
        });
    });

    // Process verificationReports for Mal Kabul
    if(verifSnap){
        verifSnap.forEach(doc => {
            const r = doc.data();
            malKabulEvents.push({
                id: `mk_vr_${doc.id}`,
                stokKodu: r.stokKodu,
                stokAdi: r.stokAdi,
                lotNumarasi: r.lotNumarasi,
                miad: r.miad,
                islemTipi: 'Mal Kabul',
                actor: r.createdByName || r.userName || usersMap[r.createdByUid]?.name || '-',
                tarih: normDate(r.islemTarihi),
                adet: 1,
                seriNolar: [r.seriNumarasi],
                konum: r.depotName || 'Depo',
            });
        });
    }

    let allEvents: LedgerRow[] = [...malKabulEvents];
    
    allEvents.sort((a, b) => (b.tarih?.getTime() ?? 0) - (a.tarih?.getTime() ?? 0));

    // --- Summary calculation ---
    const summary: StockSummary[] = [];
    if(searchType === 'serial'){
        const inStock = depoStok.find(s => serialsOfDepoStok(s).some(sn => sn.toLowerCase() === needle));
        if (inStock) {
            const product = productOf(inStock.stokKodu);
            const location = inStock.isShipped ? inStock.hedefKurum : inStock.depotName;
            summary.push({ label: location || 'Bilinmeyen Konum', adet: 1, birim: product?.anaBirim || 'Adet' });
        } else {
            const consumed = consSnap && !consSnap.empty ? consSnap.docs[0].data() : null;
            if (consumed) summary.push({ label: 'Tüketildi', adet: 0, birim: 'Adet' });
        }
    } else if (uniqueStockCodes.length > 0) {
        // Handle product/lot summary
    }

    return { ledgerRows: allEvents, summary, searchType };
}
    