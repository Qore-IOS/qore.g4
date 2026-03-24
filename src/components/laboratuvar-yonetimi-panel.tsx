
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent
} from '@/components/ui/card';
import {
  Table, TableHeader, TableHead, TableBody, TableRow, TableCell
} from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { DepoStokItem, Laboratory, ProductCode } from '@/lib/types';
import { Loader2, Search, ChevronUp, ChevronDown, ListChecks, History } from 'lucide-react';
import { formatMiad } from '@/lib/date';
import { useAuth } from '@/contexts/auth-context';
import { companyQuery } from '@/lib/company-filter';

const SortableHeader: React.FC<{
  label: string;
  field: keyof GroupedStockItem;
  sortField: keyof GroupedStockItem;
  sortAsc: boolean;
  onClick: (field: keyof GroupedStockItem) => void;
}> = ({ label, field, sortField, sortAsc, onClick }) => {
  const isActive = sortField === field;
  return (
    <TableHead onClick={() => onClick(field)} className="cursor-pointer hover:bg-muted/50">
      <div className="flex items-center">
        {label}
        {isActive && (sortAsc ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />)}
      </div>
    </TableHead>
  );
};


type GroupedStockItem = {
    groupKey: string;
    stokKodu: string;
    stokAdi: string;
    lot: string;
    miad: string;
    quantity: number;
    firstId: string;
};

export default function LaboratuvarYonetimiPanel() {
  const router = useRouter();
  const { currentCompanyId } = useAuth();
  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [depoStok, setDepoStok] = useState<DepoStokItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<keyof GroupedStockItem>('stokAdi');
  const [sortAsc, setSortAsc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      const [labsSnap, stokSnap, productsSnap] = await Promise.all([
        getDocs(companyQuery(db, 'hospitals', currentCompanyId)),
        getDocs(companyQuery(db, 'depoStok', currentCompanyId, where('isShipped', '==', true))),
        getDocs(collection(db, 'productCodes'))
      ]);
      setLaboratories(labsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Laboratory)));
      setDepoStok(stokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)));
      
      const names: Record<string, string> = {};
      productsSnap.docs.forEach(d => {
        const p = d.data() as ProductCode;
        if (p.stokKodu) names[p.stokKodu] = p.stokAdi || p.stokKodu;
      });
      setProductNames(names);

      setIsLoading(false);
    }
    fetchData();
  }, [currentCompanyId]);

  const labStocks = useMemo(() => {
    if (!selectedLabId) return [];
    const selectedLab = laboratories.find(l => l.id === selectedLabId);
    const selectedLabName = selectedLab?.name || '';

    // Filter by hedefKurumId OR by hedefKurum (name) for legacy records
    // that may have hedefKurum set but hedefKurumId is null/undefined
    // CRITICAL: Also check isShipped to ensure only transferred items are shown
    return depoStok.filter(item =>
      item.isShipped === true &&
      (item.hedefKurumId === selectedLabId ||
      (!item.hedefKurumId && item.hedefKurum === selectedLabName))
    );
  }, [depoStok, selectedLabId, laboratories]);

  const groupedMap = useMemo(() => {
    const map: Record<string, {
      stokKodu: string; stokAdi: string; lot: string; miad: string; items: DepoStokItem[]
    }> = {};
    labStocks.forEach(item => {
      const key = `${item.stokKodu}_${item.lotNumarasi}_${item.miad}`;
      if (!map[key]) {
        map[key] = {
          stokKodu: item.stokKodu,
          stokAdi: productNames[item.stokKodu] || item.stokAdi || item.stokKodu,
          lot: item.lotNumarasi ?? '',
          miad: formatMiad(item.miad),
          items: []
        };
      }
      map[key].items.push(item);
    });
    return map;
  }, [labStocks, productNames]);

  const summaryList = useMemo(
    () => Object.entries(groupedMap).map(([groupKey, grp]) => ({
      groupKey,
      stokKodu: grp.stokKodu,
      stokAdi: grp.stokAdi,
      lot: grp.lot,
      miad: grp.miad,
      quantity: grp.items.length,
      firstId: grp.items[0].id
    })),
    [groupedMap]
  );

  const filtered = useMemo(() => {
    if (!searchQuery) return summaryList;
    const q = searchQuery.toLowerCase();
    return summaryList.filter(row =>
      row.stokKodu.toLowerCase().includes(q) ||
      row.stokAdi.toLowerCase().includes(q) ||
      row.lot.toLowerCase().includes(q) ||
      row.miad.toLowerCase().includes(q) ||
      groupedMap[row.groupKey].items.some(item =>
        item.seriNumarasi?.toLowerCase().includes(q)
      )
    );
  }, [searchQuery, summaryList, groupedMap]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB));
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [filtered, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return sorted.slice(start, start + rowsPerPage);
  }, [sorted, currentPage, rowsPerPage]);

  const onHeaderClick = (field: keyof GroupedStockItem) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
    setCurrentPage(1);
  };
  const goToDetail = (id: string) => router.push(`/laboratuvar-yonetimi/${id}`);
  
  const selectedLabName = useMemo(() => {
    return laboratories.find(l => l.id === selectedLabId)?.name || '';
  }, [laboratories, selectedLabId]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Laboratuvar Stokları</CardTitle>
          <CardDescription>Laboratuvarlardaki mevcut stokları özet halinde görüntüleyebilirsiniz.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-grow">
              <label className="block text-sm font-medium mb-1">Laboratuvar Seçin</label>
              <Select value={selectedLabId} onValueChange={setSelectedLabId} disabled={isLoading}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Bir laboratuvar seçin" />
                </SelectTrigger>
                <SelectContent>
                  {laboratories.map(l => (
                    <SelectItem key={l.id} value={l.id!}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedLabId && (
                <div className="flex items-end gap-2">
                    <Button
                        onClick={() => router.push(`/laboratuvar/sayim/${selectedLabId}`)}
                        disabled={!selectedLabId}
                        className="w-full sm:w-auto"
                        >
                        <ListChecks className="mr-2 h-5 w-5" /> Sayım Başlat
                    </Button>
                     <Button
                        onClick={() => router.push(`/laboratuvar/sayim/${selectedLabId}/history`)}
                        disabled={!selectedLabId}
                        variant="outline"
                        className="w-full sm:w-auto"
                        >
                        <History className="mr-2 h-5 w-5" /> Sayım Geçmişi
                    </Button>
                </div>
            )}
            <div className="flex-grow">
              <label className="block text-sm font-medium mb-1">Ara</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Stok Kodu, Adı, Lot, Miad veya Seri No"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.currentTarget.value); setCurrentPage(1); }}
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {selectedLabId && (
            <Card className="shadow mt-4">
              <CardHeader>
                <CardTitle>{selectedLabName} - Özet Stok Durumu</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : (
                  <>
                    <ScrollArea className="h-[400px] border rounded-md">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm">
                          <TableRow>
                            <SortableHeader label="Stok Kodu" field="stokKodu" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                            <SortableHeader label="Stok Adı" field="stokAdi" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                            <SortableHeader label="Lot" field="lot" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                            <SortableHeader label="Miad" field="miad" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                            <SortableHeader label="Adet" field="quantity" sortField={sortField} sortAsc={sortAsc} onClick={onHeaderClick} />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginated.map(row => (
                            <TableRow
                              key={row.groupKey}
                              onClick={() => goToDetail(row.firstId)}
                              className="cursor-pointer hover:bg-muted"
                            >
                              <TableCell>{row.stokKodu}</TableCell>
                              <TableCell>{row.stokAdi}</TableCell>
                              <TableCell>{row.lot}</TableCell>
                              <TableCell>{row.miad}</TableCell>
                              <TableCell className="text-right font-semibold">{row.quantity}</TableCell>
                            </TableRow>
                          ))}
                          {paginated.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                                Kayıt bulunamadı.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center space-x-2 text-sm">
                        <span>Satır / sayfa:</span>
                        <Select value={String(rowsPerPage)} onValueChange={val => { setRowsPerPage(Number(val)); setCurrentPage(1); }}>
                          <SelectTrigger className="w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[20, 50, 100].map(n => (
                              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={currentPage === 1}
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        >
                          Önceki
                        </Button>
                        <span className="text-sm">{currentPage} / {pageCount}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={currentPage === pageCount}
                          onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}
                        >
                          Sonraki
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
