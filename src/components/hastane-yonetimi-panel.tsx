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
import { collection, getDocs, query, where, doc, deleteDoc, writeBatch, getDoc } from 'firebase/firestore';
import type { DepoStokItem, Laboratory } from '@/lib/types';
import { Loader2, Search, ChevronUp, ChevronDown, ListChecks, History, FileSpreadsheet, MoreVertical, Trash2, Eye, AlertCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { exportDataToExcel } from '@/lib/utils';
import { formatMiad } from '@/lib/date';

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
  const { toast } = useToast();
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
  const [isDeletingGroup, setIsDeletingGroup] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      const [labsSnap, stokSnap, productsSnap] = await Promise.all([
        getDocs(collection(db, 'hospitals')),
        getDocs(query(collection(db, 'depoStok'), where('isShipped', '==', true))),
        getDocs(collection(db, 'productCodes'))
      ]);
      setLaboratories(labsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Laboratory)));
      setDepoStok(stokSnap.docs.map(d => ({ id: d.id, ...d.data() } as DepoStokItem)));
      
      const names: Record<string, string> = {};
      productsSnap.docs.forEach(d => {
        const p = d.data();
        if (p.stokKodu) names[p.stokKodu] = p.stokAdi || p.stokKodu;
      });
      setProductNames(names);

      setIsLoading(false);
    }
    fetchData();
  }, []);

  const selectedLabName = useMemo(() => {
    return laboratories.find(l => l.id === selectedLabId)?.name || '';
  }, [laboratories, selectedLabId]);

  // CRITICAL FIX: Filter by both hedefKurumId and hedefKurum (name) to include legacy records
  const labStocks = useMemo(() => {
    const labName = laboratories.find(l => l.id === selectedLabId)?.name || '';
    return depoStok.filter(item =>
      item.hedefKurumId === selectedLabId ||
      (!item.hedefKurumId && item.hedefKurum === labName)
    );
  }, [depoStok, selectedLabId, laboratories]);

  const groupedMap = useMemo(() => {
    const map: Record<string, {
      stokKodu: string; stokAdi: string; lot: string; miad: string; items: DepoStokItem[]
    }> = {};
    labStocks.forEach(item => {
      const stokKodu = item.stokKodu ?? '';
      const lot = item.lotNumarasi ?? '';
      const miadText = formatMiad(item.miad);
      const key = `${stokKodu}_${lot}_${miadText}`;

      if (!map[key]) {
        const adi = productNames[stokKodu] ?? item.stokAdi ?? stokKodu;
        map[key] = { stokKodu, stokAdi: adi, lot, miad: miadText, items: [] };
      }
      map[key].items.push(item);
    });
    return map;
  }, [labStocks, productNames]);

  const summaryList: GroupedStockItem[] = useMemo(
    () => Object.entries(groupedMap).map(([groupKey, grp]) => {
      const firstValidId = grp.items.find(it => typeof it.id === 'string' && it.id.length > 0)?.id ?? '';
      return {
        groupKey,
        stokKodu: grp.stokKodu,
        stokAdi: grp.stokAdi,
        lot: grp.lot,
        miad: grp.miad,
        quantity: grp.items.length,
        firstId: firstValidId
      };
    }),
    [groupedMap]
  );

  const filtered = useMemo(() => {
    if (!searchQuery) return summaryList;
    const q = searchQuery.toLowerCase();
    return summaryList.filter(row =>
      row.stokKodu.toLowerCase().includes(q) ||
      row.stokAdi.toLowerCase().includes(q) ||
      row.lot.toLowerCase().includes(q) ||
      (row.miad ?? '').toLowerCase().includes(q) ||
      groupedMap[row.groupKey].items.some(item =>
        (item.seriNumarasi ?? '').toLowerCase().includes(q)
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
        cmp = String(valA ?? '').localeCompare(String(valB ?? ''));
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

  // Delete all items in a group directly (for incorrectly entered items)
  const handleDeleteGroup = async (groupKey: string) => {
    const group = groupedMap[groupKey];
    if (!group || group.items.length === 0) {
      toast({ title: 'Hata', description: 'Silinecek kayıt bulunamadı.', variant: 'destructive' });
      return;
    }

    const confirmMessage = `${group.stokAdi} - Lot: ${group.lot}\n\n${group.items.length} adet kayıt KALICI OLARAK SİLİNECEK.\nTüketim kaydı oluşturulmayacak.\n\nDevam etmek istiyor musunuz?`;
    if (!confirm(confirmMessage)) {
      return;
    }

    setIsDeletingGroup(groupKey);
    console.log(`[LAB-GROUP-DELETE] Starting deletion for group: ${groupKey}, ${group.items.length} items`);

    try {
      // Collect valid item IDs
      const itemsToDelete = group.items.filter(item => item.id);

      if (itemsToDelete.length === 0) {
        toast({ title: 'Hata', description: 'Silinecek geçerli kayıt bulunamadı.', variant: 'destructive' });
        return;
      }

      // Delete items one by one to handle errors individually
      let successCount = 0;
      let failCount = 0;
      const failedIds: string[] = [];

      for (const item of itemsToDelete) {
        try {
          console.log(`[LAB-GROUP-DELETE] Deleting item: ${item.id}`);
          await deleteDoc(doc(db, 'depoStok', item.id!));

          // Verify deletion by trying to read the document
          const verifySnap = await getDoc(doc(db, 'depoStok', item.id!));
          if (verifySnap.exists()) {
            console.error(`[LAB-GROUP-DELETE] VERIFICATION FAILED: Item ${item.id} still exists after delete!`);
            failCount++;
            failedIds.push(item.id!);
          } else {
            console.log(`[LAB-GROUP-DELETE] Verified: Item ${item.id} successfully deleted`);
            successCount++;
          }
        } catch (itemErr: unknown) {
          const itemError = itemErr as Error;
          console.error(`[LAB-GROUP-DELETE] Error deleting item ${item.id}:`, itemError);
          failCount++;
          failedIds.push(item.id!);
        }
      }

      console.log(`[LAB-GROUP-DELETE] Deletion complete. Success: ${successCount}, Failed: ${failCount}`);

      if (failCount > 0 && successCount === 0) {
        // All deletions failed
        toast({
          title: 'Silme Başarısız',
          description: `Kayıtlar silinemedi. Firebase Security Rules silme işlemine izin vermiyor olabilir. Lütfen yönetici ile iletişime geçin.`,
          variant: 'destructive'
        });
      } else if (failCount > 0) {
        // Partial success
        const deletedIds = new Set(
          itemsToDelete.filter(item => !failedIds.includes(item.id!)).map(item => item.id)
        );
        setDepoStok(prev => prev.filter(item => !deletedIds.has(item.id)));
        toast({
          title: 'Kısmi Başarı',
          description: `${successCount} kayıt silindi, ${failCount} kayıt silinemedi. Firebase Security Rules kontrol edin.`,
          variant: 'default'
        });
      } else {
        // All successful
        const deletedIds = new Set(itemsToDelete.map(item => item.id));
        setDepoStok(prev => prev.filter(item => !deletedIds.has(item.id)));
        toast({
          title: 'Silindi',
          description: `${successCount} kayıt kalıcı olarak silindi.`
        });
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[LAB-GROUP-DELETE] Error in deletion process:`, error);
      toast({
        title: 'Silme Hatası',
        description: `İşlem sırasında hata: ${error.message || 'Bilinmeyen hata'}. Firebase Security Rules kontrol edin.`,
        variant: 'destructive'
      });
    } finally {
      setIsDeletingGroup(null);
    }
  };

  const handleExport = () => {
    if (summaryList.length === 0) {
      toast({
        title: "Veri Yok",
        description: "Dışa aktarılacak laboratuvar stoğu bulunmuyor.",
        variant: "default",
      });
      return;
    }
    const dataToExport = summaryList.map(item => ({
      'Stok Kodu': item.stokKodu,
      'Stok Adı': item.stokAdi,
      'Lot Numarası': item.lot,
      'Miad': item.miad,
      'Adet': item.quantity,
    }));
    exportDataToExcel(dataToExport, `${selectedLabName}_Stok_Ozeti`, "Stok Özeti", toast);
  };


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
                    <SelectItem key={l.id ?? String(l.name)} value={l.id ?? ''}>
                      {l.name}
                    </SelectItem>
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
                <div className="flex justify-between items-center">
                    <CardTitle>{selectedLabName} - Özet Stok Durumu</CardTitle>
                    <Button onClick={handleExport} variant="outline" size="sm">
                        <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'e Aktar
                    </Button>
                </div>
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
                            <TableHead className="w-12">İşlem</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginated.map(row => (
                            <TableRow
                              key={row.groupKey}
                              className="hover:bg-muted"
                            >
                              <TableCell
                                onClick={() => { if (row.firstId) goToDetail(row.firstId); }}
                                className={`cursor-pointer ${row.firstId ? '' : 'opacity-60'}`}
                              >
                                {row.stokKodu}
                              </TableCell>
                              <TableCell
                                onClick={() => { if (row.firstId) goToDetail(row.firstId); }}
                                className={`cursor-pointer ${row.firstId ? '' : 'opacity-60'}`}
                              >
                                {row.stokAdi}
                              </TableCell>
                              <TableCell
                                onClick={() => { if (row.firstId) goToDetail(row.firstId); }}
                                className={`cursor-pointer ${row.firstId ? '' : 'opacity-60'}`}
                              >
                                {row.lot}
                              </TableCell>
                              <TableCell
                                onClick={() => { if (row.firstId) goToDetail(row.firstId); }}
                                className={`cursor-pointer ${row.firstId ? '' : 'opacity-60'}`}
                              >
                                {row.miad}
                              </TableCell>
                              <TableCell
                                onClick={() => { if (row.firstId) goToDetail(row.firstId); }}
                                className={`cursor-pointer text-right font-semibold ${row.firstId ? '' : 'opacity-60'}`}
                              >
                                {row.quantity}
                              </TableCell>
                              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isDeletingGroup === row.groupKey}>
                                      {isDeletingGroup === row.groupKey ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <MoreVertical className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => { if (row.firstId) goToDetail(row.firstId); }}
                                      disabled={!row.firstId}
                                    >
                                      <Eye className="mr-2 h-4 w-4" />
                                      Detayları Görüntüle
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleDeleteGroup(row.groupKey)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <AlertCircle className="mr-2 h-4 w-4" />
                                      Hatalı Kayıt - Tümünü Sil
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          ))}
                          {paginated.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">
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
