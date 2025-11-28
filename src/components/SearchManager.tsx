
'use client';

import React, { useMemo, useState } from 'react';
import type {
  DepoStokItem,
  ConsumptionRecord,
  Shipment,
  ProductCode,
  Depot,
  LedgerData,
} from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import ProductLedger from './ProductLedger';
import MainSearch from './MainSearch';
import { toDateFromAny } from '@/lib/time';

type Props = Partial<{
  productCodes: ProductCode[];
  depoStok: DepoStokItem[];
  tuketimKayitlari: ConsumptionRecord[];
  shipments: Shipment[];
  depots: Depot[];
}>;

export default function SearchManager({
  productCodes = [],
  depoStok = [],
  tuketimKayitlari = [],
  shipments = [],
  depots = [],
}: Props) {
  const [query, setQuery] = useState('');

  const ledgerData: LedgerData = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      return { header: { sorgu: '', stokBilgisi: [] }, items: [] };
    }

    // --- Search by Serial Number (Highest Priority) ---
    const serialMatches = [
        ...depoStok.filter(s => s.seriNumarasi?.toLowerCase() === q),
        ...tuketimKayitlari.filter(c => c.seriNumarasi?.toLowerCase() === q)
    ];

    if (serialMatches.length > 0) {
        const firstMatch = serialMatches[0];
        const product = productCodes.find(p => p.stokKodu === firstMatch.stokKodu);
        
        const history = serialMatches.map(item => {
            if ('consumptionTimestamp' in item) { // It's a ConsumptionRecord
                const cr = item as ConsumptionRecord;
                return {
                    id: cr.id,
                    date: toDateFromAny(cr.consumptionTimestamp),
                    type: 'TÜKETİM',
                    source: cr.laboratoryName,
                    target: 'Tüketildi',
                    details: `Kullanıcı: ${cr.userName || ''}`,
                };
            } else { // It's a DepoStokItem
                const ds = item as DepoStokItem;
                if (ds.isShipped) {
                    return {
                        id: ds.id,
                        date: toDateFromAny(ds.sevkTarihi),
                        type: 'SEVKİYAT',
                        source: ds.depotName,
                        target: ds.hedefKurum,
                        details: `Lot: ${ds.lotNumarasi}`,
                    };
                }
                return {
                    id: ds.id,
                    date: toDateFromAny(ds.eklenmeTarihi),
                    type: 'STOK GİRİŞİ',
                    source: ds.irsaliyeNumarasi || 'Bilinmiyor',
                    target: ds.depotName,
                    details: `Lot: ${ds.lotNumarasi} | Raf: ${ds.rafAdresi}`,
                };
            }
        }).sort((a,b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));

        return {
            header: {
              sorgu: q,
              stokKodu: firstMatch.stokKodu,
              stokAdi: firstMatch.stokAdi || product?.stokAdi,
            },
            items: history,
        };
    }

    // --- Search by Lot or Product Code ---
    const productByCode = productCodes.find(p => p.stokKodu?.toLowerCase() === q);
    const relevantStock = depoStok.filter(s => 
        s.lotNumarasi?.toLowerCase() === q || s.stokKodu?.toLowerCase() === q
    );

    if (productByCode || relevantStock.length > 0) {
        const targetStockCode = productByCode?.stokKodu || relevantStock[0].stokKodu;
        const finalProduct = productByCode || productCodes.find(p => p.stokKodu === targetStockCode);

        const stockSummary = depots.map(depot => {
            const count = depoStok.filter(s => 
                s.depotId === depot.id &&
                s.stokKodu === targetStockCode &&
                (productByCode ? true : s.lotNumarasi?.toLowerCase() === q) && // if searching lot, filter by it
                !s.isShipped
            ).length;
            return { depoAdi: depot.name, adet: count, birim: finalProduct?.anaBirim || 'Adet' };
        }).filter(s => s.adet > 0);

        const labSummary = Array.from(new Set(depoStok.filter(s=>s.hedefKurum).map(s=>s.hedefKurum))).map(labName => {
            const count = depoStok.filter(s => 
                s.hedefKurum === labName &&
                s.stokKodu === targetStockCode &&
                (productByCode ? true : s.lotNumarasi?.toLowerCase() === q) &&
                s.isShipped && 
                !tuketimKayitlari.some(t => t.seriNumarasi === s.seriNumarasi)
            ).length;
            return { depoAdi: labName, adet: count, birim: finalProduct?.anaBirim || 'Adet' };
        }).filter(s => s.adet > 0);

        return {
            header: {
                sorgu: q,
                stokKodu: targetStockCode,
                stokAdi: finalProduct?.stokAdi,
                stokBilgisi: [...stockSummary, ...labSummary],
            },
            items: [], // Grouped view is handled by header, items can be empty
        };
    }

    return { header: { sorgu: q, stokBilgisi: [] }, items: [] };

  }, [query, depoStok, tuketimKayitlari, shipments, productCodes, depots]);
  
  const ledgerType = useMemo(() => {
    const isSerialSearch = ledgerData.items.length > 0 && ledgerData.header.stokKodu && !ledgerData.header.stokBilgisi?.length;
    return isSerialSearch ? 'serial' : 'product';
  }, [ledgerData]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Arama</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden md:block">
            <MainSearch onSearch={setQuery} />
          </div>
          <div className="md:hidden">
            <Input
              placeholder="Ürün, Lot veya Seri No ile Ekstre Ara..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
      
      {query && (
          <Card className="p-2">
            <CardHeader>
              <CardTitle className="text-base">Arama Sonuçları: "{query}"</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductLedger data={ledgerData as any} type={ledgerType} onClose={() => setQuery('')}/>
            </CardContent>
          </Card>
      )}
    </div>
  );
}
