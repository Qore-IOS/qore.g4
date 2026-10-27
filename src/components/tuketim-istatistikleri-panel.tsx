
"use client";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import type { Hospital, ProductCode, ConsumptionRecord } from "@/lib/types";
import {
  TrendingUp,
  Filter,
  BarChartHorizontalBig,
  X,
  Search,
  Loader2,
  ChevronUp,
  ChevronDown,
  FileSpreadsheet,
  Eye,
  Download,
  Archive,
  Hash,
  Building2,
  CalendarClock,
  User as UserIcon,
} from "lucide-react";
import { fetchConsumptionByDateRange } from "@/hooks/useDatabaseQueries";
import { format, isValid, addDays, endOfDay } from "date-fns";
import { tr } from "date-fns/locale";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import TimestampText from "./TimestampText";
import { toDateFromAny } from "@/lib/time";
import { exportDataToExcel } from "@/lib/utils";
import {
  C, AC, ClayPage, useMode, Card, RaporHead, SoftBtn, PrimaryBtn,
  ClayInput, Dropdown, FieldLabel, Pill, EmptyBlock, HBar,
  Modal, ModalHead,
} from "@/components/raporlama/rapor-kit";

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

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

// ── small typographic helpers (match demo Mono / Strong / Muted) ───────────────
const Mono: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <span
    title={title}
    style={{
      fontSize: 13, fontWeight: 600, color: C.ink2,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', minWidth: 0,
    }}
  >
    {children}
  </span>
);
const Strong: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <span
    title={title}
    style={{ fontSize: 13.5, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', minWidth: 0 }}
  >
    {children}
  </span>
);
const Muted: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', minWidth: 0 }}>
    {children}
  </span>
);

// ── tüketim tipi badge ─────────────────────────────────────────────────────────
const ConsumeBadge: React.FC<{ type?: string }> = ({ type }) => {
  const isNormal = type === "normal_kullanim";
  const label = isNormal ? "Normal Kullanım" : "Sayımdan Düşüm";
  const style: React.CSSProperties = isNormal
    ? {
        color: '#fff',
        background: `linear-gradient(180deg, #CE8978, ${C.danger})`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)',
      }
    : {
        color: '#5582C0',
        background: 'rgba(124,168,222,0.18)',
      };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '4px 11px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', maxWidth: '100%',
      overflow: 'hidden', textOverflow: 'ellipsis', ...style,
    }}>{label}</span>
  );
};

// ── sortable header cell (grid table) ──────────────────────────────────────────
const SortHead: React.FC<{
  label: string;
  sortKey?: SortKey;
  currentSortKey: SortKey;
  sortOrder: "asc" | "desc";
  setSort?: (key: SortKey) => void;
}> = ({ label, sortKey, currentSortKey, sortOrder, setSort }) => {
  const active = sortKey != null && currentSortKey === sortKey;
  const clickable = sortKey != null && setSort != null;
  return (
    <button
      type="button"
      onClick={clickable ? () => setSort!(sortKey!) : undefined}
      style={{
        all: 'unset', cursor: clickable ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 10.5, fontWeight: 700, color: active ? AC.primary : C.ink3,
        letterSpacing: '0.05em', textTransform: 'uppercase', minWidth: 0,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {active && (sortOrder === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
    </button>
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
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const mode = useMode();
  const mobile = mode === 'mobile';

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

  // Dynamic data fetching state
  const [fetchedData, setFetchedData] = useState<ConsumptionRecord[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isDataFetched, setIsDataFetched] = useState(false);

  // Determine which data to use - fetched data if available, otherwise initial 500
  const activeData = useMemo(() => {
    if (isDataFetched && fetchedData.length > 0) {
      return fetchedData;
    }
    return urunKullanimKayitlari;
  }, [isDataFetched, fetchedData, urunKullanimKayitlari]);

  // Function to fetch data for selected date range
  const handleFetchDateRange = useCallback(async () => {
    if (!dateRange?.from || !dateRange?.to) {
      toast({
        title: "Tarih Seçin",
        description: "Lütfen başlangıç ve bitiş tarihi seçin.",
        variant: "destructive",
      });
      return;
    }

    setIsFetching(true);
    try {
      const endOfDayDate = endOfDay(dateRange.to);
      const data = await fetchConsumptionByDateRange(dateRange.from, endOfDayDate, currentCompanyId, isSuperAdmin);
      setFetchedData(data);
      setIsDataFetched(true);
      toast({
        title: "Veriler Yüklendi",
        description: `${data.length} tüketim kaydı yüklendi.`,
      });
    } catch (error) {
      console.error("Error fetching consumption data:", error);
      toast({
        title: "Hata",
        description: "Veriler yüklenirken bir hata oluştu.",
        variant: "destructive",
      });
    } finally {
      setIsFetching(false);
    }
  }, [dateRange, toast, currentCompanyId, isSuperAdmin]);

  // Function to toggle show all - fetches all data if not already fetched
  const handleShowAllToggle = useCallback(async () => {
    if (showAll) {
      // Switching back to filtered mode
      setShowAll(false);
      return;
    }

    // Switching to show all mode - fetch data for current date range
    setShowAll(true);

    if (!isDataFetched && dateRange?.from && dateRange?.to) {
      setIsFetching(true);
      try {
        const endOfDayDate = endOfDay(dateRange.to);
        const data = await fetchConsumptionByDateRange(dateRange.from, endOfDayDate, currentCompanyId, isSuperAdmin);
        setFetchedData(data);
        setIsDataFetched(true);
        toast({
          title: "Veriler Yüklendi",
          description: `${data.length} tüketim kaydı yüklendi.`,
        });
      } catch (error) {
        console.error("Error fetching consumption data:", error);
        toast({
          title: "Hata",
          description: "Veriler yüklenirken bir hata oluştu.",
          variant: "destructive",
        });
      } finally {
        setIsFetching(false);
      }
    }
  }, [showAll, isDataFetched, dateRange, toast]);

  const uniqueLabs = useMemo(
    () =>
      Array.from(
        new Set(
          activeData.map((r) => r.laboratoryName).filter(Boolean)
        )
      ),
    [activeData]
  );

  const filteredData = useMemo(() => {
    let data = activeData;

    // If data was explicitly fetched for date range, show all data (with optional lab filter)
    // Otherwise, require hospital selection when not in showAll mode
    if (!showAll && !isDataFetched) {
      if (!selectedHospitalId) return [];
      const selectedLabName = hospitals.find(
        (h) => h.id === selectedHospitalId
      )?.name;
      if (!selectedLabName) return [];
      data = data.filter((record) => record.laboratoryName === selectedLabName);
    } else if (!showAll && isDataFetched && selectedHospitalId) {
      // If data was fetched and a hospital is selected, filter by that hospital
      const selectedLabName = hospitals.find(
        (h) => h.id === selectedHospitalId
      )?.name;
      if (selectedLabName) {
        data = data.filter((record) => record.laboratoryName === selectedLabName);
      }
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

      const matchesLab = (showAll || isDataFetched)
        ? labFilter === "all" || record.laboratoryName === labFilter
        : true;

      const matchesUser =
        userFilter === "" ||
        (record.userName &&
          record.userName.toLowerCase().includes(userFilter.toLowerCase()));

      return (
        (showAll || isDataFetched || isInDateRange) && matchesSearch && matchesLab && matchesUser
      );
    });
  }, [
    activeData,
    selectedHospitalId,
    hospitals,
    dateRange,
    filterStokKoduAdi,
    showAll,
    isDataFetched,
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
    // Reset fetched data to use initial 500 records
    setFetchedData([]);
    setIsDataFetched(false);
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

  // ── derived view data ─────────────────────────────────────────────────────────
  const hospitalOptions = useMemo(
    () => hospitals.map((h) => ({ value: h.id, label: h.kod ? `${h.name} (${h.kod})` : h.name })),
    [hospitals]
  );

  const labFilterOptions = useMemo(
    () => [
      { value: 'all', label: 'Laboratuvar (Tümü)' },
      ...uniqueLabs.map((lab) => ({ value: lab as string, label: lab as string })),
    ],
    [uniqueLabs]
  );

  const showLabColumn = showAll || isDataFetched;

  // Monthly-average top products → HBar items (overflow-proof chart)
  const avgChartItems = useMemo(
    () =>
      [...monthlyAverages]
        .sort((a, b) => b.ortalamaAylikTuketim - a.ortalamaAylikTuketim)
        .slice(0, 8)
        .map((a) => ({ label: a.stokAdi, v: a.ortalamaAylikTuketim, color: AC.primary })),
    [monthlyAverages]
  );

  // grid template for tablet/wide table (lab column optional)
  const cols = showLabColumn
    ? 'minmax(0,1.1fr) 110px minmax(0,1.4fr) 100px 110px 120px 130px minmax(0,0.9fr)'
    : '110px minmax(0,1.6fr) 100px 110px 120px 130px minmax(0,0.9fr)';

  const labelCol = { fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.03em', textTransform: 'uppercase' as const };

  return (
    <ClayPage>
      <div style={{ animation: `cyRise 360ms ${EASE} both` }}>
        <RaporHead
          icon={TrendingUp}
          title="Tüketim İstatistikleri"
          desc="Laboratuvar bazlı ürün tüketim geçmişi ve analizleri."
          mobile={mobile}
          right={
            <SoftBtn
              tone={AC.primary}
              onClick={calculateMonthlyAverages}
              disabled={!selectedHospitalId && !showAll}
            >
              <BarChartHorizontalBig size={18} /> Aylık Ortalama Tüketim
            </SoftBtn>
          }
        />

        {/* Laboratuvar seçimi */}
        <Card style={{ marginBottom: 16 }}>
          <FieldLabel>Laboratuvar Seçin</FieldLabel>
          <div style={{ maxWidth: 460 }}>
            <Dropdown
              value={selectedHospitalId}
              onChange={(v) => {
                setSelectedHospitalId(v);
                setShowAll(false);
              }}
              options={hospitalOptions}
              placeholder="Analiz için laboratuvar seçin…"
              icon={<Archive size={17} />}
            />
          </div>
        </Card>

        {/* Filtreler + Kayıtlar */}
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18 }}>
            <Filter size={20} color={AC.primary} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.ink1 }}>Filtreler</h2>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20 }}>
            <div style={{ flex: 1, minWidth: mobile ? '100%' : 220 }}>
              <FieldLabel>Stok Kodu / Adı</FieldLabel>
              <ClayInput
                value={filterStokKoduAdi}
                onChange={setFilterStokKoduAdi}
                placeholder="Ara…"
                icon={<Search size={17} />}
              />
            </div>
            <div style={{ flex: mobile ? '1 1 100%' : '0 0 auto', minWidth: mobile ? '100%' : 240 }}>
              <FieldLabel>Tarih Aralığı</FieldLabel>
              <DatePickerWithRange
                date={dateRange}
                setDate={(newRange) => {
                  setDateRange(newRange);
                  // Reset fetched data when date range changes
                  if (isDataFetched) {
                    setFetchedData([]);
                    setIsDataFetched(false);
                  }
                }}
                className="w-full"
                disabled={showAll}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', width: mobile ? '100%' : 'auto' }}>
              <PrimaryBtn
                onClick={handleFetchDateRange}
                disabled={isFetching || !dateRange?.from || !dateRange?.to}
              >
                {isFetching ? <Loader2 size={18} style={{ animation: 'cySpin 1s linear infinite' }} /> : <Download size={18} />}
                Verileri Getir
              </PrimaryBtn>
              <SoftBtn onClick={clearFilters}>
                <X size={16} /> Temizle
              </SoftBtn>
              <SoftBtn onClick={handleShowAllToggle} disabled={isFetching}>
                {isFetching ? <Loader2 size={17} style={{ animation: 'cySpin 1s linear infinite' }} /> : <Eye size={17} />}
                {showAll ? "Filtreye Dön" : "Tümünü Göster"}
              </SoftBtn>
              <SoftBtn
                tone={C.waterDeep}
                onClick={handleExport}
                disabled={sortedData.length === 0 || isFetching}
              >
                <FileSpreadsheet size={18} /> Excel&apos;e Aktar
              </SoftBtn>
            </div>
          </div>

          {/* Lab filter + user filter (only when showing across labs) */}
          {showLabColumn && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 18 }}>
              <div style={{ flex: 1, minWidth: mobile ? '100%' : 220 }}>
                <FieldLabel>Laboratuvar Filtresi</FieldLabel>
                <Dropdown
                  value={labFilter}
                  onChange={setLabFilter}
                  options={labFilterOptions}
                  placeholder="Laboratuvar (Tümü)"
                  icon={<Building2 size={17} />}
                />
              </div>
              <div style={{ flex: 1, minWidth: mobile ? '100%' : 220 }}>
                <FieldLabel>Kullanıcı Filtresi</FieldLabel>
                <ClayInput
                  value={userFilter}
                  onChange={setUserFilter}
                  placeholder="Kullanıcı…"
                  icon={<UserIcon size={17} />}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.ink1 }}>
              Tüketim Kayıtları <span style={{ color: C.ink3 }}>({sortedData.length})</span>
            </h3>
            {showAll && <Pill tone="amber">TÜMÜ GÖSTERİLİYOR</Pill>}
            {!isDataFetched && <Pill>Son 500 kayıt gösteriliyor</Pill>}
            {isDataFetched && <Pill tone="ok">Tarih aralığı yüklendi ({activeData.length} kayıt)</Pill>}
            {isFetching && (
              <Pill>
                <Loader2 size={13} style={{ animation: 'cySpin 1s linear infinite' }} /> Yükleniyor…
              </Pill>
            )}
          </div>

          {/* ── records ──────────────────────────────────────────────────────── */}
          {mobile ? (
            // Mobile: stacked clay cards, one per record
            paginatedData.length === 0 ? (
              <EmptyBlock text="Kayıt bulunamadı." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {paginatedData.map((record) => (
                  <div
                    key={record.id}
                    style={{
                      background: C.surfaceHi, boxShadow: C.clayFlat, borderRadius: C.radiusSm,
                      padding: 14, display: 'flex', flexDirection: 'column', gap: 9,
                    }}
                  >
                    <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink1, lineHeight: 1.3 }}>
                      {record.stokAdi}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {showLabColumn && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <span style={labelCol}>Laboratuvar</span>
                          <Muted>{record.laboratoryName}</Muted>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={labelCol}>Stok Kodu</span>
                        <Mono>{record.stokKodu}</Mono>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={labelCol}>Lot No</span>
                        <Mono>{record.lotNumarasi}</Mono>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={labelCol}>Miad</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2 }}><TimestampText value={record.miad} /></span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={labelCol}>Seri No</span>
                        <Mono>{record.seriNumarasi}</Mono>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={labelCol}>Zaman</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2 }}>
                          <TimestampText value={record.consumptionTimestamp} format="dd.MM.yyyy HH:mm" />
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                        <span style={labelCol}>Tip</span>
                        <ConsumeBadge type={record.consumptionType} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={labelCol}>Kullanıcı</span>
                        <Muted>{record.userName}</Muted>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            // Tablet / wide: clay grid table
            <div style={{ borderRadius: C.radius, background: C.surface2, boxShadow: C.clayInset, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '14px 20px', borderBottom: `1px solid ${C.line}`, alignItems: 'center' }}>
                {showLabColumn && (
                  <SortHead label="Laboratuvar" sortKey="laboratoryName" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                )}
                <SortHead label="Stok Kodu" sortKey="stokKodu" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                <SortHead label="Stok Adı" sortKey="stokAdi" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                <SortHead label="Lot No" sortKey="lotNumarasi" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                <SortHead label="Miad" currentSortKey={sortKey} sortOrder={sortOrder} />
                <SortHead label="Seri No" sortKey="seriNumarasi" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                <SortHead label="Tüketim Zamanı" sortKey="consumptionTimestamp" currentSortKey={sortKey} sortOrder={sortOrder} setSort={handleSort} />
                <SortHead label="Tip / Kullanıcı" currentSortKey={sortKey} sortOrder={sortOrder} />
              </div>
              {paginatedData.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: C.ink3, fontWeight: 600 }}>Kayıt bulunamadı.</div>
              ) : (
                <div style={{ maxHeight: 460, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {paginatedData.map((record) => (
                    <div
                      key={record.id}
                      style={{
                        display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center',
                        padding: '12px 14px', borderRadius: C.radiusSm, background: C.surfaceHi, boxShadow: C.clayFlat,
                      }}
                    >
                      {showLabColumn && <Muted>{record.laboratoryName}</Muted>}
                      <Mono title={record.stokKodu}>{record.stokKodu}</Mono>
                      <Strong title={record.stokAdi}>{record.stokAdi}</Strong>
                      <Mono title={record.lotNumarasi}>{record.lotNumarasi}</Mono>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        <TimestampText value={record.miad} />
                      </span>
                      <Mono title={record.seriNumarasi}>{record.seriNumarasi}</Mono>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        <TimestampText value={record.consumptionTimestamp} format="dd.MM.yyyy HH:mm" />
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                        <ConsumeBadge type={record.consumptionType} />
                        <Muted>{record.userName}</Muted>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2 }}>Satır/sayfa:</span>
              <div style={{ width: 90 }}>
                <Dropdown
                  value={String(rowsPerPage)}
                  onChange={(v) => setRowsPerPage(Number(v))}
                  options={[50, 100, 200].map((n) => String(n))}
                  icon={<Hash size={15} />}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink2 }}>
                Sayfa {currentPage} / {totalPages || 1}
              </span>
              <SoftBtn
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ height: 42, padding: '0 14px' }}
              >
                Önceki
              </SoftBtn>
              <SoftBtn
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                style={{ height: 42, padding: '0 14px' }}
              >
                Sonraki
              </SoftBtn>
            </div>
          </div>
        </Card>
      </div>

      {/* Aylık Ortalama Tüketim modal */}
      <Modal open={isAverageModalOpen} onClose={() => setIsAverageModalOpen(false)} width={720}>
        <ModalHead
          icon={BarChartHorizontalBig}
          title="Aylık Ortalama Tüketim Raporu"
          desc={`${
            selectedHospitalId
              ? hospitals.find((h) => h.id === selectedHospitalId)?.name + " — "
              : ""
          }ürün bazlı ortalama aylık tüketim miktarları.${
            dateRange?.from || dateRange?.to
              ? ` (Filtre: ${dateRange?.from ? format(dateRange.from, "dd.MM.yy") : "Başlangıç"} – ${dateRange?.to ? format(dateRange.to, "dd.MM.yy") : "Bitiş"})`
              : " (Tüm zamanlar)"
          }`}
          onClose={() => setIsAverageModalOpen(false)}
        />
        <div style={{ padding: '18px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {monthlyAverages.length === 0 ? (
            <EmptyBlock text="Bu laboratuvar için hesaplanacak tüketim verisi bulunamadı." />
          ) : (
            <>
              {/* Top products chart (overflow-proof) */}
              {avgChartItems.length > 0 && (
                <div>
                  <FieldLabel>En Yüksek Ortalama Aylık Tüketim</FieldLabel>
                  <div style={{ background: C.surface2, boxShadow: C.clayInset, borderRadius: C.radius, padding: 16 }}>
                    <HBar items={avgChartItems} labelW={mobile ? 110 : 160} />
                  </div>
                </div>
              )}

              {/* Detail list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 1fr 1fr 1fr', gap: 10, padding: '0 14px' }}>
                  {['Stok Adı (Kodu)', 'Ort. Aylık', 'Toplam', 'Ay Sayısı'].map((h, i) => (
                    <div key={h} style={{ ...labelCol, textAlign: i === 0 ? 'left' : 'right' }}>{h}</div>
                  ))}
                </div>
                {monthlyAverages.map((avg) => (
                  <div
                    key={avg.stokKodu}
                    style={{
                      display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 1fr 1fr 1fr', gap: 10, alignItems: 'center',
                      padding: '11px 14px', borderRadius: C.radiusSm, background: C.surfaceHi, boxShadow: C.clayFlat,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{avg.stokAdi}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.ink3, fontFamily: 'ui-monospace, monospace' }}>({avg.stokKodu})</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 800, color: AC.primary, fontVariantNumeric: 'tabular-nums' }}>{avg.ortalamaAylikTuketim}</div>
                    <div style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 700, color: C.ink1, fontVariantNumeric: 'tabular-nums' }}>{avg.toplamTuketim}</div>
                    <div style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>{avg.aySayisi}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div style={{ padding: '16px 22px', borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'flex-end' }}>
          <SoftBtn onClick={() => setIsAverageModalOpen(false)}>Kapat</SoftBtn>
        </div>
      </Modal>
    </ClayPage>
  );
}
