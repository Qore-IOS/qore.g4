
"use client";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import type { Hospital, ProductCode, ConsumptionRecord } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  LineChart,
  Filter,
  CalendarDays,
  BarChartHorizontalBig,
  X,
  Search,
  Loader2,
  ChevronUp,
  ChevronDown,
  FileSpreadsheet,
  Eye, // Added Eye icon
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, isValid, addDays, endOfDay } from "date-fns";
import { tr } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import TimestampText from "./TimestampText";
import { toDateFromAny } from "@/lib/time";
import { exportDataToExcel } from "@/lib/utils";
import { Badge } from "./ui/badge";

interface MonthlyAverage {
  stokKodu: string;
  stokAdi: string;
  ortalamaAylikTuketim: number;
  toplamTuketim: number;
  aySayisi: number;
}

type SortKey =
  | "consumptionTimestamp"
  | "stokKodu"
  | "stokAdi"
  | "lotNumarasi"
  | "seriNumarasi"
  | "userName"
  | "laboratoryName";

const SortableHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  currentSortKey: SortKey;
  sortOrder: "asc" | "desc";
  setSort: (key: SortKey) => void;
}> = ({ label, sortKey, currentSortKey, sortOrder, setSort }) => {
  const isActive = currentSortKey === sortKey;
  return (
    <TableHead
      onClick={() => setSort(sortKey)}
      className="cursor-pointer hover:bg-muted/50"
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive &&
          (sortOrder === "asc" ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          ))}
      </div>
    </TableHead>
  );
};

interface TuketimIstatistikleriPanelProps {
  hospitals: Hospital[];
  productCodes: ProductCode[];
  urunKullanimKayitlari: ConsumptionRecord[];
  toast: (options: {
    title: string;
    description: string;
    variant?: "default" | "destructive";
  }) => void;
}

export default function TuketimIstatistikleriPanel({
  hospitals,
  productCodes,
  urunKullanimKayitlari,
  toast,
}: TuketimIstatistikleriPanelProps) {
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>("");
  const [filterStokKoduAdi, setFilterStokKoduAdi] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: addDays(new Date(), -30),
    to: new Date(),
  });

  const [sortKey, setSortKey] = useState<SortKey>("consumptionTimestamp");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const [isAverageModalOpen, setIsAverageModalOpen] = useState(false);
  const [monthlyAverages, setMonthlyAverages] = useState<MonthlyAverage[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [labFilter, setLabFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("");

  const uniqueLabs = useMemo(
    () =>
      Array.from(
        new Set(
          urunKullanimKayitlari.map((r) => r.laboratoryName).filter(Boolean)
        )
      ),
    [urunKullanimKayitlari]
  );

  const filteredData = useMemo(() => {
    let data = urunKullanimKayitlari;

    if (!showAll) {
      if (!selectedHospitalId) return [];
      const selectedLabName = hospitals.find(
        (h) => h.id === selectedHospitalId
      )?.name;
      if (!selectedLabName) return [];
      data = data.filter((record) => record.laboratoryName === selectedLabName);
    }

    return data.filter((record) => {
      const consumptionDate = toDateFromAny(record.consumptionTimestamp);
      const isInDateRange =
        !dateRange?.from ||
        !consumptionDate ||
        (consumptionDate >= dateRange.from &&
          consumptionDate <= endOfDay(dateRange.to || dateRange.from));

      const matchesSearch =
        filterStokKoduAdi === "" ||
        (record.stokKodu &&
          record.stokKodu
            .toLowerCase()
            .includes(filterStokKoduAdi.toLowerCase())) ||
        (record.stokAdi &&
          record.stokAdi
            .toLowerCase()
            .includes(filterStokKoduAdi.toLowerCase()));

      const matchesLab = showAll
        ? labFilter === "all" || record.laboratoryName === labFilter
        : true;

      const matchesUser =
        userFilter === "" ||
        (record.userName &&
          record.userName.toLowerCase().includes(userFilter.toLowerCase()));

      return (
        (showAll || isInDateRange) && matchesSearch && matchesLab && matchesUser
      );
    });
  }, [
    urunKullanimKayitlari,
    selectedHospitalId,
    hospitals,
    dateRange,
    filterStokKoduAdi,
    showAll,
    labFilter,
    userFilter,
  ]);

  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      const vA = a[sortKey];
      const vB = b[sortKey];
      let cmp = 0;
      if (vA == null) cmp = 1;
      else if (vB == null) cmp = -1;
      else if (sortKey === "consumptionTimestamp") {
        cmp =
          toDateFromAny(vA as any)!.getTime() -
          toDateFromAny(vB as any)!.getTime();
      } else {
        cmp = String(vA).localeCompare(String(vB));
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [filteredData, sortKey, sortOrder]);

  const totalPages = Math.ceil(sortedData.length / rowsPerPage);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return sortedData.slice(start, start + rowsPerPage);
  }, [sortedData, currentPage, rowsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    selectedHospitalId,
    filterStokKoduAdi,
    dateRange,
    rowsPerPage,
    showAll,
    labFilter,
    userFilter,
  ]);

  const calculateMonthlyAverages = useCallback(() => {
    if (filteredData.length === 0) {
      setMonthlyAverages([]);
      setIsAverageModalOpen(true);
      return;
    }
    
    const consumptionsByProduct: Record<
      string,
      { total: number; months: Set<string> }
    > = {};
    filteredData.forEach((record) => {
      const consumptionDate = new Date(record.consumptionTimestamp);
      if (!consumptionDate || !isValid(consumptionDate)) return;
      const monthYear = format(consumptionDate, "yyyy-MM");

      if (!consumptionsByProduct[record.stokKodu]) {
        consumptionsByProduct[record.stokKodu] = { total: 0, months: new Set() };
      }
      consumptionsByProduct[record.stokKodu].total += 1; // Assuming 1 item is 1 unit
      consumptionsByProduct[record.stokKodu].months.add(monthYear);
    });

    const averages: MonthlyAverage[] = Object.keys(consumptionsByProduct)
      .map((stokKodu) => {
        const product = productCodes.find((p) => p.stokKodu === stokKodu);
        const data = consumptionsByProduct[stokKodu];
        const aySayisi = data.months.size || 1;
        return {
          stokKodu,
          stokAdi: product?.stokAdi || "Bilinmeyen Ürün",
          ortalamaAylikTuketim:
            aySayisi > 0 ? parseFloat((data.total / aySayisi).toFixed(2)) : 0,
          toplamTuketim: data.total,
          aySayisi: aySayisi,
        };
      })
      .sort((a, b) => a.stokAdi.localeCompare(b.stokAdi));

    setMonthlyAverages(averages);
    setIsAverageModalOpen(true);
  }, [filteredData, productCodes]);

  const clearFilters = () => {
    setFilterStokKoduAdi("");
    setDateRange({ from: addDays(new Date(), -30), to: new Date() });
    setShowAll(false);
    setLabFilter("all");
    setUserFilter("");
    setCurrentPage(1);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
    setCurrentPage(1);
  };

  const handleExport = () => {
    if (sortedData.length === 0) {
      toast({
        title: "Veri Yok",
        description: "Dışa aktarılacak tüketim kaydı bulunmuyor.",
        variant: "default",
      });
      return;
    }

    const dataToExport = sortedData.map((record) => ({
      Laboratuvar: record.laboratoryName,
      "Stok Kodu": record.stokKodu,
      "Stok Adı": record.stokAdi,
      "Lot Numarası": record.lotNumarasi,
      Miad: record.miad,
      "Seri Numarası": record.seriNumarasi,
      "Tüketim Zamanı": format(
        toDateFromAny(record.consumptionTimestamp)!,
        "dd.MM.yyyy HH:mm:ss",
        { locale: tr }
      ),
      "Tüketim Tipi":
        record.consumptionType === "normal_kullanim"
          ? "Normal Kullanım"
          : "Sayımdan Düşüm",
      Kullanıcı: record.userName,
    }));

    const labName = showAll
      ? "Tum_Tuketimler"
      : hospitals.find((h) => h.id === selectedHospitalId)?.name ||
        "Tuketimler";
    const fileName = `${labName}_Tuketim_Raporu`;
    exportDataToExcel(dataToExport, fileName, "Tüketimler", toast);
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-md rounded-lg">
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <CardTitle className="text-xl flex items-center"><LineChart className="mr-2 h-6 w-6 text-primary" />Tüketim İstatistikleri</CardTitle>
            <CardDescription>Laboratuvar bazlı ürün tüketim geçmişi ve analizleri.</CardDescription>
          </div>
          <Button
            onClick={calculateMonthlyAverages}
            variant="outline"
            className="rounded-md"
            disabled={!selectedHospitalId && !showAll}
          >
            <BarChartHorizontalBig className="mr-2 h-4 w-4" /> Aylık Ortalama
            Tüketim
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <label
              htmlFor="laboratory-select-stats"
              className="block text-sm font-medium mb-1"
            >
              Laboratuvar Seçin
            </label>
            <Select
              value={selectedHospitalId}
              onValueChange={(v) => {
                setSelectedHospitalId(v);
                setShowAll(false);
              }}
            >
              <SelectTrigger
                id="laboratory-select-stats"
                className="w-full md:w-1/2 lg:w-1/3 rounded-md"
              >
                <SelectValue placeholder="Analiz için laboratuvar seçin..." />
              </SelectTrigger>
              <SelectContent>
                {hospitals.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card className="border-border dark:border-input rounded-lg p-4 mt-4">
            <CardTitle className="text-lg mb-3 flex items-center">
              <Filter className="mr-2 h-5 w-5 text-foreground/80" />
              Filtreler
            </CardTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <label
                  htmlFor="filter-stok"
                  className="block text-sm font-medium mb-1"
                >
                  Stok Kodu/Adı
                </label>
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
                  <label
                    htmlFor="filter-start-date"
                    className="block text-sm font-medium mb-1"
                  >
                    Tarih Aralığı
                  </label>
                  <DatePickerWithRange
                    date={dateRange}
                    setDate={setDateRange}
                    className="w-full"
                    disabled={showAll}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    onClick={clearFilters}
                    variant="ghost"
                    className="rounded-md self-end mt-2 sm:mt-0"
                  >
                    <X className="mr-2 h-4 w-4" /> Temizle
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowAll((s) => !s)}
                  >
                    <Eye className="mr-2 h-4 w-4" />{" "}
                    {showAll ? "Filtreye Dön" : "Tümünü Göster"}
                  </Button>
                  <Button
                    onClick={handleExport}
                    variant="outline"
                    className="rounded-md self-end mt-2 sm:mt-0"
                    disabled={sortedData.length === 0}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'e Aktar
                  </Button>
                </div>
              </div>
            </div>

            <h4 className="text-md font-semibold mt-6 mb-2 flex items-center gap-2">
              Tüketim Kayıtları ({sortedData.length})
              {showAll && <Badge variant="secondary">TÜMÜ GÖSTERİLİYOR</Badge>}
            </h4>

            <>
              <ScrollArea className="h-[500px] border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {showAll && (
                        <TableHead>
                          <Select
                            value={labFilter}
                            onValueChange={setLabFilter}
                          >
                            <SelectTrigger className="border-none p-0 h-auto font-semibold bg-transparent focus:ring-0 focus:ring-offset-0 [&>span]:line-clamp-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">
                                Laboratuvar (Tümü)
                              </SelectItem>
                              {uniqueLabs.map((lab) => (
                                <SelectItem key={lab} value={lab}>
                                  {lab}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableHead>
                      )}
                      <SortableHeader
                        label="Stok Kodu"
                        sortKey="stokKodu"
                        currentSortKey={sortKey}
                        sortOrder={sortOrder}
                        setSort={handleSort}
                      />
                      <SortableHeader
                        label="Stok Adı"
                        sortKey="stokAdi"
                        currentSortKey={sortKey}
                        sortOrder={sortOrder}
                        setSort={handleSort}
                      />
                      <SortableHeader
                        label="Lot No"
                        sortKey="lotNumarasi"
                        currentSortKey={sortKey}
                        sortOrder={sortOrder}
                        setSort={handleSort}
                      />
                      <TableHead>Miad</TableHead>
                      <SortableHeader
                        label="Seri No"
                        sortKey="seriNumarasi"
                        currentSortKey={sortKey}
                        sortOrder={sortOrder}
                        setSort={handleSort}
                      />
                      <SortableHeader
                        label="Tüketim Zamanı"
                        sortKey="consumptionTimestamp"
                        currentSortKey={sortKey}
                        sortOrder={sortOrder}
                        setSort={handleSort}
                      />
                      <TableHead>Tüketim Tipi</TableHead>
                      <TableHead>
                        <Input
                          placeholder="Kullanıcı..."
                          value={userFilter}
                          onChange={(e) => setUserFilter(e.target.value)}
                          className="h-8 p-1 border-none bg-transparent focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-6">
                          Kayıt bulunamadı.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedData.map((record) => (
                        <TableRow key={record.id}>
                          {showAll && (
                            <TableCell>{record.laboratoryName}</TableCell>
                          )}
                          <TableCell className="font-mono text-xs">
                            {record.stokKodu}
                          </TableCell>
                          <TableCell>{record.stokAdi}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {record.lotNumarasi}
                          </TableCell>
                          <TableCell>
                            <TimestampText value={record.miad} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {record.seriNumarasi}
                          </TableCell>
                          <TableCell>
                            <TimestampText
                              value={record.consumptionTimestamp}
                              format="dd.MM.yyyy HH:mm"
                            />
                          </TableCell>
                          <TableCell>
                            {record.consumptionType === "normal_kullanim"
                              ? "Normal Kullanım"
                              : "Sayımdan Düşüm"}
                          </TableCell>
                          <TableCell>{record.userName}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
              <div className="flex items-center justify-between pt-4">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-muted-foreground">
                    Satır/sayfa:
                  </span>
                  <Select
                    value={String(rowsPerPage)}
                    onValueChange={(val) => setRowsPerPage(Number(val))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[50, 100, 200].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center space-x-2 text-sm">
                  <span>
                    Sayfa {currentPage} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    Önceki
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                  >
                    Sonraki
                  </Button>
                </div>
              </div>
            </>
          </Card>
        </CardContent>
      </Card>

      <Dialog open={isAverageModalOpen} onOpenChange={setIsAverageModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Aylık Ortalama Tüketim Raporu</DialogTitle>
            <CardDescription>
              {selectedHospitalId
                ? hospitals.find((h) => h.id === selectedHospitalId)?.name
                : ""}{" "}
              laboratuvarı için ürün bazlı ortalama aylık tüketim miktarları.
              {dateRange?.from || dateRange?.to
                ? ` (Filtre: ${
                    dateRange.from
                      ? format(dateRange.from, "dd.MM.yy")
                      : "Başlangıç"
                  } - ${
                    dateRange.to ? format(dateRange.to, "dd.MM.yy") : "Bitiş"
                  })`
                : "(Tüm zamanlar)"}
            </CardDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto">
            {monthlyAverages.length === 0 ? (
              <p className="text-muted-foreground text-center">
                Bu laboratuvar için hesaplanacak tüketim verisi bulunamadı.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stok Adı (Kodu)</TableHead>
                    <TableHead className="text-right">
                      Ort. Aylık Tüketim
                    </TableHead>
                    <TableHead className="text-right">Toplam Tüketim</TableHead>
                    <TableHead className="text-right">
                      Tüketim Olan Ay Sayısı
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyAverages.map((avg) => (
                    <TableRow key={avg.stokKodu}>
                      <TableCell>
                        {avg.stokAdi}
                        <span className="block text-xs text-muted-foreground font-mono">
                          ({avg.stokKodu})
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {avg.ortalamaAylikTuketim}
                      </TableCell>
                      <TableCell className="text-right">
                        {avg.toplamTuketim}
                      </TableCell>
                      <TableCell className="text-right">
                        {avg.aySayisi}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="rounded-md">
                Kapat
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
