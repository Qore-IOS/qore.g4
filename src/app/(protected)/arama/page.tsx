'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import MainSearch from '@/components/MainSearch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronDown, ChevronRight, FileSpreadsheet, Package, ChevronUp, Warehouse, Building2, Search, ArrowRight } from 'lucide-react';
import { exportDataToExcel } from '@/lib/utils';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { searchProductLedger, type LedgerRow, type StockSummary, type SearchResult } from '@/actions/searchActions';

// -----------------------------------------------------
// Types & Helper Components
// -----------------------------------------------------

type SortKey = keyof LedgerRow | 'hedefKonum';

const SortableHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  isAsc: boolean;
  onClick: (key: SortKey) => void;
  className?: string;
}> = ({ label, sortKey, currentSort, isAsc, onClick, className }) => (
  <TableHead onClick={() => onClick(sortKey)} className={cn("cursor-pointer select-none", className)}>
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

  // Search state
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchType, setSearchType] = useState<'product' | 'lot' | 'serial'>('product');

  // Results
  const [results, setResults] = useState<LedgerRow[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummary[]>([]);

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

  // ---------------------------------------------------
  // Search Handler - Only fetches data when search is performed
  // ---------------------------------------------------
  const handleSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) {
      toast({
        title: 'Arama Çok Kısa',
        description: 'En az 2 karakter girmeniz gerekiyor.',
        variant: 'default'
      });
      return;
    }

    setQuery(q);
    setIsSearching(true);
    setHasSearched(true);
    setPage(1);

    try {
      const result: SearchResult = await searchProductLedger(q);

      setResults(result.ledgerRows);
      setStockSummary(result.stockSummary);
      setSearchType(result.searchType);

      if (result.ledgerRows.length === 0) {
        toast({
          title: 'Sonuç Bulunamadı',
          description: 'Arama kriterlerine uygun kayıt bulunamadı.',
          variant: 'default'
        });
      } else {
        toast({
          title: 'Arama Tamamlandı',
          description: `${result.ledgerRows.length} işlem kaydı bulundu.`,
        });
      }
    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: 'Arama Hatası',
        description: 'Arama sırasında bir hata oluştu. Lütfen tekrar deneyin.',
        variant: 'destructive'
      });
    } finally {
      setIsSearching(false);
    }
  }, [toast]);

  // ---------------------------------------------------
  // Sorting & Filtering
  // ---------------------------------------------------
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(asc => !asc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'tarih' ? false : true);
    }
  };

  const uniqueIslemTipleri = useMemo(() =>
    Array.from(new Set(results.map(r => r.islemTipi).filter(Boolean))) as string[],
    [results]
  );

  const uniqueKonumlar = useMemo(() =>
    Array.from(new Set(results.map(r => r.konum).filter(Boolean))) as string[],
    [results]
  );

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
      const valA = a[sortKey as keyof LedgerRow];
      const valB = b[sortKey as keyof LedgerRow];
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

  // ---------------------------------------------------
  // Export Handler
  // ---------------------------------------------------
  const handleExport = () => {
    if (filteredAndSorted.length === 0) {
      toast({
        title: 'Veri Yok',
        description: 'Dışa aktarılacak veri bulunmuyor.',
        variant: 'default'
      });
      return;
    }

    const data = filteredAndSorted.map(ev => ({
      'Stok Kodu': ev.stokKodu,
      'Stok Adı': ev.stokAdi,
      'Lot': ev.lotNumarasi || '-',
      'Miad': ev.miad || '-',
      'İşlem Tipi': ev.islemTipi,
      'İşlemi Yapan': ev.actor || '-',
      'Tarih/Saat': format(ev.tarih, 'dd.MM.yyyy HH:mm', { locale: tr }),
      'İşlem Adedi': ev.adet,
      'Kaynak Konum': ev.konum,
      'Hedef Konum': ev.hedefKonum || '-',
      'Sonrası Depo': ev.postAdetDepo ?? '-',
      'Sonrası Hedef': ev.postAdetHedef ?? '-',
      'Seri Numaraları': ev.seriNolar.join(', ') || '-',
    }));
    exportDataToExcel(data, `Arama_Ekstre_${query.replace(/\s+/g, '_')}`, 'Ekstre', toast);
  };

  // Reset page when filters change
  React.useEffect(() => {
    setPage(1);
  }, [filterIslemTipi, filterKonum, sortKey, sortAsc, pageSize]);

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------
  return (
    <div className="min-h-[80vh]">
      <MainSearch onSearch={handleSearch} />
      <div className="pt-24 px-3 md:px-6">
        <Card className="glass-card border border-white/10 backdrop-blur">
          <CardHeader className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                <Search className="h-5 w-5" />
                Qore Search
              </CardTitle>
              <CardDescription>
                Stok kodu, stok adı, lot veya seri numarası ile arayın.
                {hasSearched && searchType === 'serial' && (
                  <Badge variant="secondary" className="ml-2">Seri No Araması</Badge>
                )}
                {hasSearched && searchType === 'lot' && (
                  <Badge variant="secondary" className="ml-2">Lot Araması</Badge>
                )}
                {hasSearched && searchType === 'product' && (
                  <Badge variant="secondary" className="ml-2">Ürün Araması</Badge>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={handleExport} disabled={filteredAndSorted.length === 0}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'e Aktar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Initial state - no search yet */}
            {!hasSearched && !isSearching && (
              <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                <Search className="h-16 w-16 mb-4 opacity-30" />
                <h3 className="text-lg font-medium mb-2">Aramaya Başlayın</h3>
                <p className="text-sm max-w-md">
                  Yukarıdaki arama çubuğuna stok kodu, stok adı, lot numarası veya seri numarası girerek arama yapabilirsiniz.
                </p>
              </div>
            )}

            {/* Loading state */}
            {isSearching && (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Aranıyor...
              </div>
            )}

            {/* Results */}
            {hasSearched && !isSearching && (
              <>
                {/* Stock Summary */}
                {stockSummary.length > 0 && (
                  <div className="mb-4 p-4 rounded-lg border bg-background/50">
                    <div className="flex items-center gap-2 mb-3 text-sm font-medium">
                      <Package size={18} />
                      Güncel Stok Dağılımı
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {stockSummary.map((s, i) => (
                        <div
                          key={i}
                          className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shadow-sm",
                            s.konumTipi === 'depo'
                              ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"
                              : "bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20"
                          )}
                        >
                          {s.konumTipi === 'depo' ? (
                            <Warehouse className="h-4 w-4" />
                          ) : (
                            <Building2 className="h-4 w-4" />
                          )}
                          <span>{s.konum}:</span>
                          <span className="font-bold">{s.adet}</span>
                          <span className="text-xs opacity-75">{s.birim}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Results info and pagination controls */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
                  <div className="text-sm text-muted-foreground">
                    Toplam <strong>{filteredAndSorted.length}</strong> işlem
                    {query && <span className="ml-1">(&quot;{query}&quot; için)</span>}
                    {' '}• Sayfa {page} / {totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                      <SelectTrigger className="h-8 w-[160px]"><SelectValue placeholder="Sayfa başına" /></SelectTrigger>
                      <SelectContent>
                        {[10, 20, 50, 100].map(n => (<SelectItem key={n} value={String(n)}>{n} / sayfa</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                        Önceki
                      </Button>
                      <Input
                        value={page}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 1;
                          setPage(Math.min(Math.max(1, val), totalPages));
                        }}
                        className="w-16 h-8 text-center"
                      />
                      <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                        Sonraki
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Results Table */}
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
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">İşlem Tipi (Tümü)</SelectItem>
                              {uniqueIslemTipleri.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableHead>
                        <SortableHeader label="İşlemi Yapan" sortKey="actor" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <SortableHeader label="Tarih / Saat" sortKey="tarih" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <SortableHeader label="Adet" sortKey="adet" currentSort={sortKey} isAsc={sortAsc} onClick={handleSort} />
                        <TableHead>
                          <Select value={filterKonum} onValueChange={setFilterKonum}>
                            <SelectTrigger className="border-none p-0 h-auto font-semibold bg-transparent focus:ring-0 focus:ring-offset-0 [&>span]:line-clamp-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Kaynak (Tümü)</SelectItem>
                              {uniqueKonumlar.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableHead>
                        <TableHead>Hedef</TableHead>
                        <TableHead className="text-center">Sonrası</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paged.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                            Liste boş.
                          </TableCell>
                        </TableRow>
                      ) : (
                        paged.map(ev => {
                          const isOpen = !!expanded[ev.id];
                          return (
                            <React.Fragment key={ev.id}>
                              <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => toggleRow(ev.id)}>
                                <TableCell className="w-8">
                                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{ev.stokKodu}</TableCell>
                                <TableCell className="truncate max-w-[150px]">{ev.stokAdi}</TableCell>
                                <TableCell className="font-mono text-xs">{ev.lotNumarasi || '-'}</TableCell>
                                <TableCell>{ev.miad || '-'}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      ev.islemTipi === 'Mal Kabul' ? 'default' :
                                        ev.islemTipi === 'Kullanım' ? 'destructive' :
                                          'secondary'
                                    }
                                    className="text-xs"
                                  >
                                    {ev.islemTipi}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm">{ev.actor || '-'}</TableCell>
                                <TableCell className="text-sm whitespace-nowrap">
                                  {format(ev.tarih, 'dd.MM.yyyy HH:mm', { locale: tr })}
                                </TableCell>
                                <TableCell className="text-right font-semibold">{ev.adet}</TableCell>
                                <TableCell className="text-sm">{ev.konum}</TableCell>
                                <TableCell className="text-sm">
                                  {ev.hedefKonum ? (
                                    <span className="flex items-center gap-1">
                                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                      {ev.hedefKonum}
                                    </span>
                                  ) : '-'}
                                </TableCell>
                                <TableCell className="text-center">
                                  {(ev.postAdetDepo !== undefined || ev.postAdetHedef !== undefined) ? (
                                    <div className="flex flex-col items-center text-xs">
                                      {ev.postAdetDepo !== undefined && (
                                        <span className="text-blue-600 dark:text-blue-400">
                                          D: {ev.postAdetDepo}
                                        </span>
                                      )}
                                      {ev.postAdetHedef !== undefined && (
                                        <span className="text-green-600 dark:text-green-400">
                                          L: {ev.postAdetHedef}
                                        </span>
                                      )}
                                    </div>
                                  ) : '-'}
                                </TableCell>
                              </TableRow>
                              {isOpen && (
                                <TableRow className="bg-background/50">
                                  <TableCell colSpan={12} className="p-0">
                                    <Accordion type="single" collapsible defaultValue={`row-${ev.id}`}>
                                      <AccordionItem value={`row-${ev.id}`} className="border-b-0">
                                        <AccordionTrigger className="px-4 py-2 text-sm">
                                          İşlemdeki Seri Numaraları ({ev.seriNolar.length})
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4">
                                          {ev.seriNolar.length === 0 ? (
                                            <div className="text-xs text-muted-foreground">Seri numarası yok.</div>
                                          ) : (
                                            <ul className="text-xs font-mono columns-1 sm:columns-2 md:columns-3 gap-2 list-disc pl-5">
                                              {ev.seriNolar.map((s, i) => (<li key={i}>{s}</li>))}
                                            </ul>
                                          )}
                                          {/* Post-operation summary for expanded row */}
                                          {(ev.postAdetDepo !== undefined || ev.postAdetHedef !== undefined) && (
                                            <div className="mt-3 pt-3 border-t text-xs">
                                              <p className="font-medium mb-1">İşlem Sonrası Stok:</p>
                                              <div className="flex flex-wrap gap-3">
                                                {ev.postAdetDepo !== undefined && (
                                                  <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                                    <Warehouse className="h-3 w-3" />
                                                    {ev.konum}: {ev.postAdetDepo} adet
                                                  </span>
                                                )}
                                                {ev.postAdetHedef !== undefined && ev.hedefKonum && (
                                                  <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                                    <Building2 className="h-3 w-3" />
                                                    {ev.hedefKonum}: {ev.postAdetHedef} adet
                                                  </span>
                                                )}
                                                {ev.postAdetHedef !== undefined && !ev.hedefKonum && ev.islemTipi === 'Kullanım' && (
                                                  <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                                    <Building2 className="h-3 w-3" />
                                                    {ev.konum}: {ev.postAdetHedef} adet kaldı
                                                  </span>
                                                )}
                                              </div>
                                            </div>
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
