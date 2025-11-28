
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, collectionGroup, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DepoStokItem, Shipment, ConsumptionRecord, Depot, ProductCode, Transfer, EventRow } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import MainSearch from '@/components/MainSearch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Loader2, ChevronDown, ChevronRight, FileSpreadsheet, Package, ChevronUp } from 'lucide-react';
import { exportDataToExcel } from '@/lib/utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { toDateSafe, formatMiad } from '@/lib/date';
import { cn } from '@/lib/utils';


// -----------------------------------------------------
// Types & Helper Components
// -----------------------------------------------------

type SearchType = 'product' | 'lot' | 'serial';
type SortKey = keyof EventRow | 'hedefKonum';

type TransferItem = {
  transferId: string;
  stokKodu: string;
  stokAdi: string;
  lotNumarasi: string;
  miad: string;
  seriNumarasi?: string;
};

const SortableHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  isAsc: boolean;
  onClick: (key: SortKey) => void;
  className?: string;
}> = ({ label, sortKey, currentSort, isAsc, onClick, className }) => (
  <TableHead onClick={() => onClick(sortKey)} className={cn("cursor-pointer", className)}>
    <div className="flex items-center gap-1">
      {label}
      {currentSort === sortKey && (isAsc ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}
    </div>
  </TableHead>
);

// -----------------------------------------------------
// Panel Component
// -----------------------------------------------------

export default function AramaPanel() {
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [depoStok, setDepoStok] = useState<DepoStokItem[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [tuketimKayitlari, setTuketimKayitlari] = useState<ConsumptionRecord[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, { name?: string }>>({});
  const [verificationReports, setVerificationReports] = useState<any[]>([]);

  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('product');
  const [results, setResults] = useState<(EventRow & { hedefKonum?: string })[]>([]);

  // Sort & Filter State
  const [sortKey, setSortKey] = useState<SortKey>('tarih');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [filterIslemTipi, setFilterIslemTipi] = useState<string>('all');
  const [filterKonum, setFilterKonum] = useState<string>('all');

  // Pagination
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  

  // UI row expand
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleRow = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  // Serial helpers (varying field names)
  const serialsOfDepoStok = (d: any): string[] => Array.from(new Set([d?.seriNumarasi, d?.seriNo, d?.serialNumber, d?.serialNo].filter(Boolean) as string[]));
  const serialsOfShipmentItem = (it: any): string[] => Array.from(new Set((it?.serialNumbers || it?.seriNolar || it?.seriNoList || []) as string[]));
  const serialOfConsumption = (rec: any): string | null => rec?.seriNumarasi || rec?.seriNo || rec?.serialNumber || null;

  // ---------------------------------------------------
  // Data load
  // ---------------------------------------------------
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [
            depotsSnap, pcSnap, stokSnap, shipSnap, consSnap,
            transfersSnap, transferItemsSnap, reportsSnap, usersSnap
        ] = await Promise.all([
            getDocs(collection(db, 'depots')),
            getDocs(collection(db, 'productCodes')),
            getDocs(collection(db, 'depoStok')),
            getDocs(collection(db, 'shipments')),
            getDocs(collection(db, 'tuketimKayitlari')),
            getDocs(collection(db, 'transfers')),
            getDocs(collectionGroup(db, 'items')),
            getDocs(collection(db, 'verificationReports')),
            getDocs(collection(db, 'users')),
        ]);
        setDepots(depotsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Depot[]);
        setProductCodes(pcSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ProductCode[]);
        setDepoStok(stokSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as DepoStokItem[]);
        setShipments(shipSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Shipment[]);
        setTuketimKayitlari(consSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ConsumptionRecord[]);
        setTransfers(transfersSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Transfer)));
        setTransferItems(transferItemsSnap.docs.map(d => ({ transferId: d.ref.parent.parent!.id, ...(d.data() as any) })) as TransferItem[]);
        setVerificationReports(reportsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        setUsersMap(Object.fromEntries(usersSnap.docs.map(d => [d.id, { name: (d.data() as any).name || (d.data() as any).displayName }])));
      } catch (e) {
        console.error(e);
        toast({ title: 'Veri Yükleme Hatası', description: 'Arama paneli için veriler alınamadı.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [toast]);

  // ---------------------------------------------------
  // Helpers
  // ---------------------------------------------------
  const normDate = (d: any): Date => toDateSafe(d) ?? new Date(0);
  const productOf = (stokKodu?: string) => productCodes.find(p => p.stokKodu === stokKodu);

  const detectType = useCallback((q: string): SearchType => {
    const s = q.trim().toLowerCase();
    if (!s) return 'product';
    const serialHit =
      depoStok.some(i => serialsOfDepoStok(i).some(sn => sn.toLowerCase() === s)) ||
      tuketimKayitlari.some(i => (serialOfConsumption(i) || '').toLowerCase() === s) ||
      shipments.some(sh => (sh.items || []).some(it => serialsOfShipmentItem(it).some(sn => sn.toLowerCase() === s))) ||
      transferItems.some(i => (i.seriNumarasi || '').toLowerCase() === s) ||
      verificationReports.some(r => r.raporTipi === 'mal_kabul' && (r.seriNumarasi || '').toLowerCase() === s);
    if (serialHit) return 'serial';
    const lotHit =
      depoStok.some(i => (i.lotNumarasi || '').toLowerCase() === s) ||
      shipments.some(sh => (sh.items || []).some(it => (it.lotNumarasi || '').toLowerCase() === s)) ||
      transferItems.some(i => (i.lotNumarasi || '').toLowerCase() === s);
    if (lotHit) return 'lot';
    return 'product';
  }, [depoStok, tuketimKayitlari, shipments, transferItems, verificationReports]);


  // ---------------------------------------------------
  // Search
  // ---------------------------------------------------
  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    const type = detectType(q);
    setSearchType(type);

    const needle = q.trim().toLowerCase();
    const matchProduct = (x: { stokKodu?: string; stokAdi?: string; lotNumarasi?: string; }) => {
      if (type === 'serial') return true;
      if (type === 'lot') return (x.lotNumarasi || '').toLowerCase() === needle;
      if (type === 'product') {
        return (x.stokKodu || '').toLowerCase().includes(needle) || (x.stokAdi || '').toLowerCase().includes(needle);
      }
      return true;
    };
    
    // 1) Mal Kabul (depoStok & verificationReports)
    const malKabulFromDepoStok: EventRow[] = depoStok
      .filter(d => matchProduct(d) || (type === 'serial' && serialsOfDepoStok(d).some(sn => sn.toLowerCase() === needle)))
      .map(d => ({
        id: `mk_ds_${d.id ?? crypto.randomUUID()}`,
        stokKodu: d.stokKodu ?? '',
        stokAdi: d.stokAdi ?? '',
        lotNumarasi: d.lotNumarasi ?? undefined,
        miad: formatMiad(d.miad),
        islemTipi: 'Mal Kabul',
        actor: (d as any).createdByName || (d as any).userName || (d as any).ekleyenKullanici || usersMap[(d as any).createdByUid]?.name || '-',
        tarih: normDate((d as any).eklenmeTarihi),
        adet: 1,
        seriNolar: serialsOfDepoStok(d) ?? [],
        konum: d.depotName || 'Depo',
      }));

    const malKabulFromReports: EventRow[] = verificationReports
      .filter(r => r.raporTipi === 'mal_kabul' && (type !== 'serial' ? matchProduct(r) : (r.seriNumarasi || '').toLowerCase() === needle))
      .map(r => ({
        id: `mk_vr_${r.id}`,
        stokKodu: r.stokKodu || '',
        stokAdi: r.stokAdi || '',
        lotNumarasi: r.lotNumarasi || undefined,
        miad: formatMiad(r.miad),
        islemTipi: 'Mal Kabul',
        actor: r.createdByName || r.userName || (r.createdByUid && usersMap[r.createdByUid]?.name) || '-',
        tarih: normDate(r.islemTarihi),
        adet: 1,
        seriNolar: r.seriNumarasi ? [r.seriNumarasi] : [],
        konum: r.depotName || 'Depo',
      }));

    const mkMap = new Map<string, EventRow>();
    [...malKabulFromDepoStok, ...malKabulFromReports].forEach(ev => {
      const key = `MK|${ev.stokKodu}|${ev.lotNumarasi || ''}|${ev.miad}|${ev.tarih.toISOString()}|${ev.konum}|${ev.seriNolar.join(',')}`;
      if (!mkMap.has(key)) mkMap.set(key, ev);
    });
    const malKabulEvents = Array.from(mkMap.values());

    // 2) Sevkiyat
    const shipmentEvents: EventRow[] = (shipments || []).flatMap(sh =>
      (sh.items || []).filter(it => matchProduct(it) || (type === 'serial' && serialsOfShipmentItem(it).some(sn => sn.toLowerCase() === needle)))
        .map(it => ({
          id: `sh_${sh.id}_${it.stokKodu || ''}_${it.lotNumarasi || ''}_${it.miad || ''}`,
          stokKodu: it.stokKodu || '',
          stokAdi: it.stokAdi || '',
          lotNumarasi: it.lotNumarasi || undefined,
          miad: formatMiad(it.miad),
          islemTipi: 'Karşılanan Sipariş',
          actor: (sh as any).userName || '-',
          tarih: normDate((sh as any).timestamp),
          adet: it.quantity || (serialsOfShipmentItem(it).length || 0),
          seriNolar: serialsOfShipmentItem(it),
          konum: (sh as any).depotName || 'Depo',
        }))
    );
    
    // 3) Direkt Transfer
    const transferMeta = new Map(transfers.map(t => [t.id, t]));
    const filteredTItems = transferItems.filter(it => matchProduct(it) || (type === 'serial' && (it.seriNumarasi || '').toLowerCase() === needle));
    const transferGroups = new Map<string, { t: Transfer; items: TransferItem[] }>();
    for (const it of filteredTItems) {
      const t = transferMeta.get(it.transferId);
      if (!t) continue;
      const key = `${it.transferId}|${it.stokKodu}|${it.lotNumarasi}|${it.miad}`;
      const g = transferGroups.get(key) || { t, items: [] };
      g.items.push(it);
      transferGroups.set(key, g);
    }
    const transferEvents = Array.from(transferGroups.values()).map(g => {
      const sample = g.items[0];
      const sourceName = g.t.sourceDepotName || depots.find(d => d.id === g.t.sourceDepotId)?.name || 'Depo';
      return {
        id: `tr_${g.t.id}_${sample.stokKodu}_${sample.lotNumarasi}_${sample.miad}`,
        stokKodu: sample.stokKodu,
        stokAdi: sample.stokAdi,
        lotNumarasi: sample.lotNumarasi,
        miad: formatMiad(sample.miad),
        islemTipi: 'Direkt Transfer',
        actor: g.t.userName || '-',
        tarih: normDate(g.t.timestamp),
        adet: g.items.length,
        seriNolar: g.items.map(x => x.seriNumarasi).filter(Boolean) as string[],
        konum: sourceName,
        hedefKonum: g.t.targetName // NEW FIELD
      };
    });

    // 4) Kullanım
    const kullanims: EventRow[] = (tuketimKayitlari || [])
      .filter(rec => matchProduct(rec) || (type === 'serial' && (serialOfConsumption(rec) || '').toLowerCase() === needle))
      .map(rec => ({
        id: `tk_${(rec as any).id}`,
        stokKodu: (rec as any).stokKodu || '',
        stokAdi: (rec as any).stokAdi || '',
        lotNumarasi: (rec as any).lotNumarasi || undefined,
        miad: formatMiad((rec as any).miad),
        islemTipi: 'Kullanım',
        actor: (rec as any).userName || '-',
        tarih: normDate((rec as any).consumptionTimestamp || (rec as any).sevkTarihi),
        adet: 1,
        seriNolar: serialOfConsumption(rec) ? [serialOfConsumption(rec)!] : [],
        konum: (rec as any).laboratoryName || (rec as any).hedefKurum || 'Laboratuvar',
      }));

    let all: EventRow[] = [...malKabulEvents, ...shipmentEvents, ...transferEvents, ...kullanims];
    if (type === 'serial') all = all.filter(e => e.seriNolar.map(s => s.toLowerCase()).includes(needle));

    setPage(1);
    setResults(all as any);
    if (all.length === 0) toast({ title: 'Sonuç bulunamadı', description: 'Arama kriterlerine uygun hareket yok.', variant: 'default' });
  }, [detectType, depoStok, shipments, tuketimKayitlari, transfers, transferItems, depots, productCodes, verificationReports, usersMap, toast]);

  const stockSummary = useMemo(() => {
    if (!query) return [];
    const type = searchType;
    const needle = query.trim().toLowerCase();

    if (type === 'serial') {
      const inStock = depoStok.find(s => serialsOfDepoStok(s).some(sn => sn.toLowerCase() === needle));
      if (inStock) {
        const product = productOf(inStock.stokKodu);
        const location = inStock.isShipped ? inStock.hedefKurum : inStock.depotName;
        return [{ label: location || 'Bilinmeyen Konum', adet: 1, birim: product?.anaBirim || 'Adet' }];
      }
      const consumed = tuketimKayitlari.find(t => (serialOfConsumption(t) || '').toLowerCase() === needle);
      if (consumed) return [{ label: 'Tüketildi', adet: 0, birim: 'Adet' }];
      return [];
    }

    let stokKodu: string | undefined;
    let lot: string | undefined;
    if (type === 'lot') {
      const d = depoStok.find(x => (x.lotNumarasi || '').toLowerCase() === needle) || transferItems.find(x => (x.lotNumarasi || '').toLowerCase() === needle);
      stokKodu = d?.stokKodu; lot = (d as any)?.lotNumarasi || needle;
    } else {
      stokKodu = productCodes.find(p => p.stokKodu?.toLowerCase() === needle)?.stokKodu ?? productCodes.find(p => p.stokAdi?.toLowerCase().includes(needle))?.stokKodu;
    }
    if (!stokKodu) return [];

    const matchLot = (x: DepoStokItem) => !lot || x.lotNumarasi?.toLowerCase() === lot;
    const anaBirim = productOf(stokKodu)?.anaBirim || 'Adet';
    const byDepot: Record<string, number> = {};
    const byHospital: Record<string, number> = {};
    depoStok.forEach(x => {
      if (x.stokKodu !== stokKodu || !matchLot(x)) return;
      if (!x.isShipped) byDepot[x.depotName || 'Depo'] = (byDepot[x.depotName || 'Depo'] || 0) + 1;
      else if (x.hedefKurum) byHospital[x.hedefKurum] = (byHospital[x.hedefKurum] || 0) + 1;
    });
    return [
      ...Object.entries(byDepot).map(([k, v]) => ({ label: k, adet: v, birim: anaBirim })),
      ...Object.entries(byHospital).map(([k, v]) => ({ label: k, adet: v, birim: anaBirim })),
    ];
  }, [query, searchType, depoStok, productCodes, tuketimKayitlari, transferItems, serialsOfDepoStok, serialOfConsumption]);

  const handleExport = () => {
    const data = filteredAndSorted.map(ev => ({
      'Stok Kodu': ev.stokKodu, 'Stok Adı': ev.stokAdi, 'Lot': ev.lotNumarasi, 'Miad': ev.miad,
      'İşlem Tipi': ev.islemTipi, 'İşlemi Yapan': ev.actor, 'Tarih/Saat': format(ev.tarih, 'dd.MM.yyyy HH:mm', { locale: tr }),
      'İşlem Adedi': ev.adet, 'Kaynak Konum': ev.konum,
      'Hedef Konum': (ev as any).hedefKonum || '-', // NEW
      'Seri Numaraları': ev.seriNolar.join(', '),
    }));
    exportDataToExcel(data, `Arama_Ekstre_${query.replace(/\s+/g, '_')}`, 'Ekstre', toast);
  };
  
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(asc => !asc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'tarih' ? false : true); // Default to descending for date
    }
  };

  const uniqueIslemTipleri = useMemo(() => Array.from(new Set(results.map(r => r.islemTipi).filter(Boolean))) as string[], [results]);
  const uniqueKonumlar = useMemo(() => Array.from(new Set(results.map(r => r.konum).filter(Boolean))) as string[], [results]);

  const filteredAndSorted = useMemo(() => {
    let items = [...results];
    // Filter
    if (filterIslemTipi !== 'all') {
      items = items.filter(r => r.islemTipi === filterIslemTipi);
    }
    if (filterKonum !== 'all') {
      items = items.filter(r => r.konum === filterKonum);
    }
    // Sort
    items.sort((a, b) => {
      const valA = a[sortKey as keyof EventRow];
      const valB = b[sortKey as keyof EventRow];
      if (valA instanceof Date && valB instanceof Date) {
        return sortAsc ? valA.getTime() - valB.getTime() : valB.getTime() - valA.getTime();
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc
        ? String(valA || '').localeCompare(String(valB || ''))
        : String(valB || '').localeCompare(String(valA || ''));
    });
    return items;
  }, [results, sortKey, sortAsc, filterIslemTipi, filterKonum]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAndSorted.slice(start, start + pageSize);
  }, [filteredAndSorted, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [filterIslemTipi, filterKonum, sortKey, sortAsc, pageSize]);


  return (
    <div className="min-h-[80vh]">
      <MainSearch onSearch={handleSearch} />
      <div className="pt-24 px-3 md:px-6">
        <Card className="glass-card border border-white/10 backdrop-blur">
          <CardHeader className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-lg md:text-xl">Qore Search</CardTitle>
              <CardDescription>Stok kodu, stok adı, lot veya seri numarası ile arayın. Liste en yeni işlemlerden başlar.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={handleExport} disabled={filteredAndSorted.length === 0}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'e Aktar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mr-2"/>Yükleniyor…</div>
            ) : (
              <>
                {stockSummary.length > 0 && (
                  <div className="mb-4 p-3 rounded-lg border bg-background/50">
                    <div className="flex items-center gap-2 mb-2 text-sm font-medium"><Package size={16}/> Aranan ürün stok dağılımı</div>
                    <div className="flex flex-wrap gap-2">
                      {stockSummary.map((s, i) => (
                        <div key={i} className="px-3 py-1 rounded-full text-xs bg-gradient-to-r from-primary to-accent text-white shadow">{s.label}: {s.adet} {s.birim}</div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
                  <div className="text-sm text-muted-foreground">Toplam <strong>{filteredAndSorted.length}</strong> işlem • Sayfa {page} / {totalPages}</div>
                  <div className="flex items-center gap-2">
                    <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                      <SelectTrigger className="h-8 w-[160px]"><SelectValue placeholder="Sayfa başına" /></SelectTrigger>
                      <SelectContent>
                        {[10,20,50,100].map(n => (<SelectItem key={n} value={String(n)}>{n} / sayfa</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}>Önceki</Button>
                      <Input value={page} onChange={(e)=>{
                        const val = Number(e.target.value)||1; setPage(Math.min(Math.max(1,val), totalPages));
                      }} className="w-16 h-8 text-center" />
                      <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}>Sonraki</Button>
                    </div>
                  </div>
                </div>

                <ScrollArea className="h-[60vh] border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <SortableHeader label="Stok Kodu" sortKey="stokKodu" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <SortableHeader label="Stok Adı" sortKey="stokAdi" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <SortableHeader label="Lot" sortKey="lotNumarasi" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <SortableHeader label="Miad" sortKey="miad" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <TableHead>
                           <Select value={filterIslemTipi} onValueChange={setFilterIslemTipi}>
                              <SelectTrigger className="border-none p-0 h-auto font-semibold bg-transparent focus:ring-0 focus:ring-offset-0 [&>span]:line-clamp-1">
                                <SelectValue/>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">İşlem Tipi (Tümü)</SelectItem>
                                {uniqueIslemTipleri.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                              </SelectContent>
                           </Select>
                        </TableHead>
                        <SortableHeader label="İşlemi Yapan" sortKey="actor" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <SortableHeader label="Tarih / Saat" sortKey="tarih" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <SortableHeader label="İşlem Adedi" sortKey="adet" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <TableHead>
                          <Select value={filterKonum} onValueChange={setFilterKonum}>
                              <SelectTrigger className="border-none p-0 h-auto font-semibold bg-transparent focus:ring-0 focus:ring-offset-0 [&>span]:line-clamp-1">
                                <SelectValue/>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">Konum (Tümü)</SelectItem>
                                {uniqueKonumlar.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                              </SelectContent>
                           </Select>
                        </TableHead>
                        <SortableHeader label="Hedef Konum" sortKey="hedefKonum" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paged.length === 0 ? (
                        <TableRow><TableCell colSpan={11} className="text-center py-10 text-muted-foreground">Liste boş.</TableCell></TableRow>
                      ) : (
                        paged.map(ev => {
                          const isOpen = !!expanded[ev.id];
                          return (
                            <React.Fragment key={ev.id}>
                              <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => toggleRow(ev.id)}>
                                <TableCell className="w-8">{isOpen ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}</TableCell>
                                <TableCell className="font-mono text-xs">{ev.stokKodu}</TableCell>
                                <TableCell className="truncate">{ev.stokAdi}</TableCell>
                                <TableCell className="font-mono text-xs">{ev.lotNumarasi}</TableCell>
                                <TableCell>{ev.miad}</TableCell>
                                <TableCell>{ev.islemTipi}</TableCell>
                                <TableCell>{ev.actor}</TableCell>
                                <TableCell>{format(ev.tarih, 'dd.MM.yyyy HH:mm', { locale: tr })}</TableCell>
                                <TableCell className="text-right font-semibold">{ev.adet}</TableCell>
                                <TableCell>{ev.konum}</TableCell>
                                <TableCell>{(ev as any).hedefKonum || '-'}</TableCell>
                              </TableRow>
                              {isOpen && (
                                <TableRow className="bg-background/50">
                                  <TableCell colSpan={11} className="p-0">
                                    <Accordion type="single" collapsible defaultValue={`row-${ev.id}`}>
                                      <AccordionItem value={`row-${ev.id}`} className="border-b-0">
                                        <AccordionTrigger className="px-4 py-2 text-sm">İşlemdeki Seri Numaraları ({ev.seriNolar.length})</AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4">
                                          {ev.seriNolar.length === 0 ? (
                                            <div className="text-xs text-muted-foreground">Seri numarası yok.</div>
                                          ) : (
                                            <ul className="text-xs font-mono columns-1 sm:columns-2 md:columns-3 gap-2 list-disc pl-5">
                                              {ev.seriNolar.map((s, i) => (<li key={i}>{s}</li>))}
                                            </ul>
                                          )}
                                        </AccordionContent>
                                      </AccordionItem>
                                    </Accordion>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

    