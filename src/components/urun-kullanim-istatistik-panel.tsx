/**
 * @fileoverview Consumption Statistics Panel Component
 * @description Enterprise-grade panel for viewing and analyzing product consumption
 * statistics with filtering, sorting, pagination, and monthly average calculations.
 * @module components/urun-kullanim-istatistik-panel
 * @version 2.0.0
 */

'use client';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { Hospital, ProductCode, ConsumptionRecord, DepoStokItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogFooter } from '@/components/ui/dialog';
import { LineChart, Filter, CalendarDays, BarChartHorizontalBig, X, Search, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { format, isValid, addDays, endOfDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import { toDateSafe } from '@/lib/date';
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from '@/components/ui/scroll-area';
import { DateRange } from 'react-day-picker';
import TimestampText from './TimestampText';
import { tuketimIstatistikLogger } from '@/lib/logger';


/**
 * Monthly average consumption data structure
 */
interface MonthlyAverage {
  /** Stock code */
  stokKodu: string;
  /** Stock name */
  stokAdi: string;
  /** Average monthly consumption */
  ortalamaAylikTuketim: number;
  /** Total consumption in period */
  toplamTuketim: number;
  /** Number of months with consumption */
  aySayisi: number;
}

/** Sort keys for consumption table */
type SortKey = 'consumptionTimestamp' | 'stokKodu' | 'stokAdi' | 'lotNumarasi' | 'seriNumarasi' | 'userName';

/**
 * Sortable table header component
 * Displays column header with sort indicator and click handler
 */
const SortableHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  currentSortKey: SortKey;
  sortOrder: 'asc' | 'desc';
  setSort: (key: SortKey) => void;
}> = ({ label, sortKey, currentSortKey, sortOrder, setSort }) => {
  const isActive = currentSortKey === sortKey;
  return (
    <TableHead
      onClick={() => setSort(sortKey)}
      className="cursor-pointer hover:bg-muted/50"
      role="columnheader"
      aria-sort={isActive ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSort(sortKey); }}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive && (sortOrder === 'asc' ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />)}
      </div>
    </TableHead>
  );
};

/**
 * Props for TuketimIstatistikleriPanel component
 */
interface TuketimIstatistikleriPanelProps {
  /** List of hospitals/laboratories */
  hospitals: Hospital[];
  /** List of product codes */
  productCodes: ProductCode[];
  /** Consumption records */
  urunKullanimKayitlari: ConsumptionRecord[];
  /** Toast notification function */
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
}

/**
 * Consumption Statistics Panel Component
 *
 * Displays consumption records with filtering, sorting, and pagination.
 * Provides monthly average calculations for consumption analysis.
 *
 * @param props - Component props
 * @returns Statistics panel component
 *
 * @example
 * ```tsx
 * <TuketimIstatistikleriPanel
 *   hospitals={hospitals}
 *   productCodes={productCodes}
 *   urunKullanimKayitlari={consumptionRecords}
 *   toast={toast}
 * />
 * ```
 */
export default function TuketimIstatistikleriPanel({
  hospitals,
  productCodes,
  urunKullanimKayitlari,
  toast,
}: TuketimIstatistikleriPanelProps) {
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
  const [filterStokKoduAdi, setFilterStokKoduAdi] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: addDays(new Date(), -30),
    to: new Date(),
  });
  
  const [sortKey, setSortKey] = useState<SortKey>('consumptionTimestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  
  const [isAverageModalOpen, setIsAverageModalOpen] = useState(false);
  const [monthlyAverages, setMonthlyAverages] = useState<MonthlyAverage[]>([]);


  const filteredData = useMemo(() => {
    if (!selectedHospitalId) return [];
    const selectedLabName = hospitals.find(h => h.id === selectedHospitalId)?.name;
    if (!selectedLabName) return [];

    return urunKullanimKayitlari.filter(record => {
        if(record.laboratoryName !== selectedLabName) return false;

        const consumptionDate = toDateSafe(record.consumptionTimestamp);
        if (!consumptionDate || !isValid(consumptionDate)) return false;

        const isInDateRange = 
            (!dateRange?.from || consumptionDate >= dateRange.from) &&
            (!dateRange?.to || consumptionDate <= endOfDay(dateRange.to));
        
        const matchesSearch = 
            filterStokKoduAdi === '' ||
            record.stokKodu.toLowerCase().includes(filterStokKoduAdi.toLowerCase()) ||
            record.stokAdi.toLowerCase().includes(filterStokKoduAdi.toLowerCase());
            
        return isInDateRange && matchesSearch;
    });
  }, [urunKullanimKayitlari, selectedHospitalId, hospitals, dateRange, filterStokKoduAdi]);
  
  const sortedData = useMemo(() => {
    return [...filteredData].sort((a,b) => {
        const vA = a[sortKey];
        const vB = b[sortKey];
        let cmp = 0;
        if (vA == null) cmp = 1;
        else if (vB == null) cmp = -1;
        else if (sortKey === 'consumptionTimestamp') {
          cmp = new Date(vA as any).getTime() - new Date(vB as any).getTime();
        } else {
          cmp = String(vA).localeCompare(String(vB));
        }
        return sortOrder === 'asc' ? cmp : -cmp;
      });
  }, [filteredData, sortKey, sortOrder]);
  
  const totalPages = Math.ceil(sortedData.length / rowsPerPage);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return sortedData.slice(start, start + rowsPerPage);
  }, [sortedData, currentPage, rowsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedHospitalId, filterStokKoduAdi, dateRange, rowsPerPage]);
  

  /**
   * Calculates monthly average consumption for all products
   * Groups consumption by month and calculates averages per product
   */
  const calculateMonthlyAverages = useCallback(() => {
    const startTime = performance.now();

    if (filteredData.length === 0) {
      tuketimIstatistikLogger.debug('Aylık ortalama hesaplaması - veri yok');
      setMonthlyAverages([]);
      setIsAverageModalOpen(true);
      return;
    }

    const consumptionsByProduct: Record<string, { total: number; months: Set<string> }> = {};
    filteredData.forEach(record => {
      const consumptionDate = toDateSafe(record.consumptionTimestamp);
      if (!consumptionDate || !isValid(consumptionDate)) return;
      const monthYear = format(consumptionDate, 'yyyy-MM');

      if (!consumptionsByProduct[record.stokKodu]) {
        consumptionsByProduct[record.stokKodu] = { total: 0, months: new Set() };
      }
      consumptionsByProduct[record.stokKodu].total += 1; // Assuming 1 item is 1 unit
      consumptionsByProduct[record.stokKodu].months.add(monthYear);
    });

    const averages: MonthlyAverage[] = Object.keys(consumptionsByProduct).map(stokKodu => {
      const product = productCodes.find(p => p.stokKodu === stokKodu);
      const data = consumptionsByProduct[stokKodu];
      const aySayisi = data.months.size || 1;
      return {
        stokKodu,
        stokAdi: product?.stokAdi || 'Bilinmeyen Ürün',
        ortalamaAylikTuketim: aySayisi > 0 ? parseFloat((data.total / aySayisi).toFixed(2)) : 0,
        toplamTuketim: data.total,
        aySayisi: aySayisi,
      };
    }).sort((a,b) => a.stokAdi.localeCompare(b.stokAdi));

    const duration = performance.now() - startTime;
    tuketimIstatistikLogger.performance('Aylık ortalamalar hesaplandı', duration, {
      productCount: averages.length,
      recordsProcessed: filteredData.length,
    });

    setMonthlyAverages(averages);
    setIsAverageModalOpen(true);
  }, [filteredData, productCodes]);

  const clearFilters = () => {
    setFilterStokKoduAdi('');
    setDateRange({ from: addDays(new Date(), -30), to: new Date() });
    setCurrentPage(1);
  };
  
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };


  return (
    <div className="space-y-6" role="main" aria-label="Tüketim istatistikleri paneli">
      <Card className="shadow-md rounded-lg" role="region" aria-labelledby="stats-title">
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <CardTitle id="stats-title" className="text-xl flex items-center">
              <LineChart className="mr-2 h-6 w-6 text-primary" aria-hidden="true" />
              Tüketim İstatistikleri
            </CardTitle>
            <CardDescription>Laboratuvar bazlı ürün tüketim geçmişi ve analizleri.</CardDescription>
          </div>
          <Button
            onClick={calculateMonthlyAverages}
            variant="outline"
            className="rounded-md"
            disabled={!selectedHospitalId}
            aria-label="Aylık ortalama tüketim hesapla"
          >
            <BarChartHorizontalBig className="mr-2 h-4 w-4" aria-hidden="true" /> Aylık Ortalama Tüketim
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <label htmlFor="laboratory-select-stats" className="block text-sm font-medium mb-1">Laboratuvar Seçin</label>
            <Select value={selectedHospitalId} onValueChange={setSelectedHospitalId}>
              <SelectTrigger id="laboratory-select-stats" className="w-full md:w-1/2 lg:w-1/3 rounded-md" aria-label="Analiz için laboratuvar seçin">
                <SelectValue placeholder="Analiz için laboratuvar seçin..." />
              </SelectTrigger>
              <SelectContent>
                {hospitals.map(h => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedHospitalId && (
            <Card className="border-border dark:border-input rounded-lg p-4 mt-4" role="region" aria-label="Filtreler ve sonuçlar">
              <CardTitle className="text-lg mb-3 flex items-center">
                <Filter className="mr-2 h-5 w-5 text-foreground/80" aria-hidden="true" />
                Filtreler
              </CardTitle>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label htmlFor="filter-stok" className="block text-sm font-medium mb-1">Stok Kodu/Adı</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        id="filter-stok"
                        placeholder="Ara..."
                        value={filterStokKoduAdi}
                        onChange={(e) => setFilterStokKoduAdi(e.target.value)}
                        className="rounded-md pl-8"
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 col-span-1 md:col-span-2">
                    <div className="flex-1">
                        <label htmlFor="filter-start-date" className="block text-sm font-medium mb-1">Tarih Aralığı</label>
                        <DatePickerWithRange date={dateRange} setDate={setDateRange} className="w-full"/>
                    </div>
                     <Button onClick={clearFilters} variant="ghost" className="rounded-md self-end mt-2 sm:mt-0" aria-label="Filtreleri temizle">
                        <X className="mr-2 h-4 w-4" aria-hidden="true" /> Temizle
                    </Button>
                </div>
              </div>
            
              <h4 className="text-md font-semibold mt-6 mb-2">Tüketim Kayıtları ({sortedData.length})</h4>
              
                <>
                <ScrollArea className="h-[500px] border rounded-md">
                  <Table aria-label="Tüketim kayıtları tablosu">
                    <TableHeader>
                      <TableRow role="row">
                        <SortableHeader label="Stok Kodu" sortKey="stokKodu" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort}/>
                        <SortableHeader label="Stok Adı" sortKey="stokAdi" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort}/>
                        <SortableHeader label="Lot No" sortKey="lotNumarasi" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort}/>
                        <TableHead>Miad</TableHead>
                        <SortableHeader label="Seri No" sortKey="seriNumarasi" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort}/>
                        <SortableHeader label="Tüketim Zamanı" sortKey="consumptionTimestamp" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort}/>
                        <TableHead>Tüketim Tipi</TableHead>
                        <SortableHeader label="Kullanıcı" sortKey="userName" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort}/>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                        {paginatedData.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="text-center py-6">Kayıt bulunamadı.</TableCell></TableRow>
                        ) : paginatedData.map(record => (
                        <TableRow key={record.id}>
                          <TableCell className="font-mono text-xs">{record.stokKodu}</TableCell>
                          <TableCell>{record.stokAdi}</TableCell>
                          <TableCell className="font-mono text-xs">{record.lotNumarasi}</TableCell>
                          <TableCell><TimestampText value={record.miad} /></TableCell>
                          <TableCell className="font-mono text-xs">{record.seriNumarasi}</TableCell>
                          <TableCell><TimestampText value={record.consumptionTimestamp} format="dd.MM.yyyy HH:mm" /></TableCell>
                          <TableCell>{record.consumptionType === 'normal_kullanim' ? 'Normal Kullanım' : 'Sayımdan Düşüm'}</TableCell>
                          <TableCell>{record.userName}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                <div className="flex items-center justify-between pt-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-muted-foreground">Satır/sayfa:</span>
                    <Select value={String(rowsPerPage)} onValueChange={val => setRowsPerPage(Number(val))}>
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[50, 100, 200].map(n => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <span>Sayfa {currentPage} / {totalPages}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    >
                      Önceki
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    >
                      Sonraki
                    </Button>
                  </div>
                </div>
                </>
              
            </Card>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAverageModalOpen} onOpenChange={setIsAverageModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Aylık Ortalama Tüketim Raporu</DialogTitle>
            <CardDescription>
              {hospitals.find(h => h.id === selectedHospitalId)?.name || '-'} laboratuvarı için ürün bazlı ortalama aylık tüketim miktarları.
              {dateRange?.from || dateRange?.to ? ` (Filtre: ${dateRange.from ? format(dateRange.from, "dd.MM.yy") : 'Başlangıç'} - ${dateRange.to ? format(dateRange.to, "dd.MM.yy") : 'Bitiş'})` : '(Tüm zamanlar)'}
            </CardDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto">
            {monthlyAverages.length === 0 ? (
              <p className="text-muted-foreground text-center">Bu laboratuvar için hesaplanacak tüketim verisi bulunamadı.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stok Adı (Kodu)</TableHead>
                    <TableHead className="text-right">Ort. Aylık Tüketim</TableHead>
                    <TableHead className="text-right">Toplam Tüketim</TableHead>
                    <TableHead className="text-right">Tüketim Olan Ay Sayısı</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyAverages.map(avg => (
                    <TableRow key={avg.stokKodu}>
                      <TableCell>
                        {avg.stokAdi}
                        <span className="block text-xs text-muted-foreground font-mono">({avg.stokKodu})</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{avg.ortalamaAylikTuketim}</TableCell>
                      <TableCell className="text-right">{avg.toplamTuketim}</TableCell>
                      <TableCell className="text-right">{avg.aySayisi}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" className="rounded-md">Kapat</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
