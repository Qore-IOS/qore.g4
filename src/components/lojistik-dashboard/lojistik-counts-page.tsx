'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  PackageSearch,
  RefreshCcw,
  Search,
  Upload,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { useLojistikCountOverview } from '@/hooks/use-lojistik-count-overview';
import {
  buildCalculationPeriodKey,
  formatCalculationPeriod,
  parseCalculationPeriod,
  type LogisticsCountProductRow,
  type LogisticsLabCountOverview,
} from '@/lib/lojistik/count-overview';
import { LOJISTIK_HOME_PATH } from '@/lib/lojistik/navigation';
import {
  savePendingCalculationFiles,
  type PendingCalculationKind,
} from '@/lib/qore-hesaplama/pending-calculation-files';
import { exportDataToExcel } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CountStatusChip, UploadStatusChip } from './count-status';

type ProductStatusFilter = 'all' | 'counted' | 'uncounted';
const PRODUCT_PAGE_SIZE = 100;

interface UploadTarget {
  labId: string;
  labName: string;
  kind: PendingCalculationKind;
}

const panelClass =
  'rounded-[26px] border border-emerald-950/10 bg-white/85 shadow-[0_24px_55px_-32px_rgba(6,78,59,0.35)] backdrop-blur-xl dark:border-fuchsia-400/15 dark:bg-[#160e1e]/80 dark:shadow-[0_28px_65px_-34px_rgba(0,0,0,0.85)]';

function buildPeriodOptions(): Array<{ value: string; label: string }> {
  const currentYear = new Date().getFullYear();
  const values: string[] = [];
  for (let year = currentYear - 3; year <= currentYear + 3; year += 1) {
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      values.push(
        `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
      );
    }
  }
  return values
    .sort((left, right) => right.localeCompare(left))
    .map((value) => ({ value, label: formatCalculationPeriod(value) }));
}

function formatDate(date: Date | null): string {
  return date
    ? date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
}

function normalizeSearch(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR');
}

function ProductCountChip({ counted }: { counted: boolean }) {
  return (
    <span
      className={
        counted
          ? 'inline-flex min-h-7 items-center rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/15 dark:text-emerald-200'
          : 'inline-flex min-h-7 items-center rounded-full border border-rose-200 bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/15 dark:text-rose-200'
      }
    >
      {counted ? 'Sayıldı' : 'Sayılmadı'}
    </span>
  );
}

function UploadCell({
  uploaded,
  label,
  onUpload,
}: {
  uploaded: boolean;
  label: string;
  onUpload: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <UploadStatusChip uploaded={uploaded} />
      {!uploaded && (
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-extrabold text-emerald-700 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 dark:border-fuchsia-300/20 dark:bg-white/5 dark:text-fuchsia-200 dark:hover:bg-fuchsia-300/10 dark:focus-visible:ring-fuchsia-300/30"
          aria-label={`${label} dosyası yükle`}
          onClick={(event) => {
            event.stopPropagation();
            onUpload();
          }}
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          Yükle
        </button>
      )}
    </div>
  );
}

export default function LojistikCountsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const {
    currentUserProfile,
    currentCompanyId,
  } = useAuth();
  const [period, setPeriod] = useState(() =>
    buildCalculationPeriodKey(new Date()),
  );
  const periodOptions = useMemo(buildPeriodOptions, []);
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useLojistikCountOverview(period);

  const [selectedLabId, setSelectedLabId] = useState<string | null>(null);
  const [detailSearch, setDetailSearch] = useState('');
  const [detailStatus, setDetailStatus] =
    useState<ProductStatusFilter>('all');
  const [detailGroup, setDetailGroup] = useState('all');
  const [detailVisibleCount, setDetailVisibleCount] =
    useState(PRODUCT_PAGE_SIZE);

  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [productVisibleCount, setProductVisibleCount] =
    useState(PRODUCT_PAGE_SIZE);
  const [selectedProductCode, setSelectedProductCode] = useState<string | null>(
    null,
  );

  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (
      currentUserProfile?.role &&
      currentUserProfile.role !== 'lojistik_sorumlusu'
    ) {
      router.replace('/dashboard');
    }
  }, [currentUserProfile?.role, router]);

  useEffect(() => {
    setSelectedLabId(null);
    setSelectedProductCode(null);
    setDetailSearch('');
    setDetailStatus('all');
    setDetailGroup('all');
  }, [period]);

  const selectedLab = useMemo(
    () => data?.labs.find((lab) => lab.id === selectedLabId) || null,
    [data?.labs, selectedLabId],
  );

  const detailGroupOptions = useMemo(() => {
    if (!selectedLab) return [];
    return Array.from(
      new Set(
        selectedLab.products.flatMap((product) => product.labGroups).filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right, 'tr'));
  }, [selectedLab]);

  const filteredDetailProducts = useMemo(() => {
    if (!selectedLab) return [];
    const query = normalizeSearch(detailSearch);
    return selectedLab.products.filter((product) => {
      const matchesQuery =
        !query ||
        normalizeSearch(product.stokKodu).includes(query) ||
        normalizeSearch(product.stokAdi).includes(query) ||
        normalizeSearch(product.labGroupLabel).includes(query);
      const matchesStatus =
        detailStatus === 'all' ||
        (detailStatus === 'counted' && product.isCounted) ||
        (detailStatus === 'uncounted' && !product.isCounted);
      const matchesGroup =
        detailGroup === 'all' || product.labGroups.includes(detailGroup);
      return matchesQuery && matchesStatus && matchesGroup;
    });
  }, [selectedLab, detailSearch, detailStatus, detailGroup]);
  const visibleDetailProducts = useMemo(
    () => filteredDetailProducts.slice(0, detailVisibleCount),
    [detailVisibleCount, filteredDetailProducts],
  );

  const uniqueCountedProducts = useMemo(() => {
    const productsByCode = new Map<
      string,
      { stokKodu: string; stokAdi: string; labCount: number }
    >();
    (data?.labs || []).forEach((lab) => {
      lab.products.forEach((product) => {
        if (!product.isCounted) return;
        const current = productsByCode.get(product.stokKodu);
        if (current) {
          current.labCount += 1;
        } else {
          productsByCode.set(product.stokKodu, {
            stokKodu: product.stokKodu,
            stokAdi: product.stokAdi,
            labCount: 1,
          });
        }
      });
    });
    return Array.from(productsByCode.values()).sort(
      (left, right) =>
        left.stokAdi.localeCompare(right.stokAdi, 'tr') ||
        left.stokKodu.localeCompare(right.stokKodu, 'tr'),
    );
  }, [data?.labs]);

  const filteredUniqueProducts = useMemo(() => {
    const query = normalizeSearch(productQuery);
    if (!query) return uniqueCountedProducts;
    return uniqueCountedProducts.filter(
      (product) =>
        normalizeSearch(product.stokAdi).includes(query) ||
        normalizeSearch(product.stokKodu).includes(query),
    );
  }, [productQuery, uniqueCountedProducts]);
  const visibleUniqueProducts = useMemo(
    () => filteredUniqueProducts.slice(0, productVisibleCount),
    [filteredUniqueProducts, productVisibleCount],
  );

  useEffect(() => {
    setDetailVisibleCount(PRODUCT_PAGE_SIZE);
  }, [selectedLabId, detailSearch, detailStatus, detailGroup]);

  useEffect(() => {
    setProductVisibleCount(PRODUCT_PAGE_SIZE);
  }, [productQuery, productSearchOpen]);

  const selectedProductRows = useMemo(() => {
    if (!selectedProductCode) return [];
    return (data?.labs || [])
      .map((lab) => {
        const product = lab.products.find(
          (candidate) =>
            candidate.stokKodu === selectedProductCode && candidate.isCounted,
        );
        return product ? { lab, product } : null;
      })
      .filter(
        (
          entry,
        ): entry is {
          lab: LogisticsLabCountOverview;
          product: LogisticsCountProductRow;
        } => Boolean(entry),
      );
  }, [data?.labs, selectedProductCode]);

  const openLabDetail = useCallback((labId: string) => {
    setDetailSearch('');
    setDetailStatus('all');
    setDetailGroup('all');
    setDetailVisibleCount(PRODUCT_PAGE_SIZE);
    setSelectedLabId(labId);
  }, []);

  const closeUploadDialog = () => {
    if (isUploading) return;
    setUploadTarget(null);
    setUploadFiles([]);
  };

  const handleUpload = async () => {
    if (!uploadTarget || uploadFiles.length === 0) return;
    const parsed = parseCalculationPeriod(period);
    if (!parsed) {
      toast({
        title: 'Geçersiz dönem',
        description: 'Dosya yüklemek için geçerli bir dönem seçin.',
        variant: 'destructive',
      });
      return;
    }
    const invalidFile = uploadFiles.find(
      (file) => !/\.(pdf|txt|csv)$/i.test(file.name),
    );
    if (invalidFile) {
      toast({
        title: 'Desteklenmeyen dosya',
        description: `${invalidFile.name} yerine PDF, TXT veya CSV dosyası seçin.`,
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    try {
      await savePendingCalculationFiles({
        kind: uploadTarget.kind,
        hospitalId: uploadTarget.labId,
        hospitalName: uploadTarget.labName,
        month: parsed.monthIndex,
        year: parsed.year,
        source: 'lojistik-sayimlar',
        files: uploadFiles,
        currentCompanyId,
        user: {
          id: currentUserProfile?.uid,
          name: currentUserProfile?.name,
          email: currentUserProfile?.email,
        },
      });
      toast({
        title: 'Dosya yüklendi',
        description: `${uploadTarget.labName} için ${
          uploadTarget.kind === 'kumulatif' ? 'kümülatif' : 'cihaz üstü'
        } dosyası ${formatCalculationPeriod(period)} dönemine hazırlandı.`,
      });
      setUploadTarget(null);
      setUploadFiles([]);
      await refetch();
    } catch (uploadError: any) {
      toast({
        title: 'Dosya yüklenemedi',
        description:
          uploadError?.message || 'Dosya yüklenirken beklenmeyen bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const exportAllCounts = () => {
    if (!data) return;
    const summary = data.labs.map((lab) => ({
      'Laboratuvar': lab.name,
      'Dönem': data.periodLabel,
      'Sayım Durumu':
        lab.countStatus === 'complete'
          ? 'Tamamlandı'
          : lab.countStatus === 'partial'
            ? 'Eksik'
            : lab.countStatus === 'not_started'
              ? 'Yapılmadı'
              : 'Kapsam yok',
      'Sayılan Ürün': lab.countedProductCount,
      'Kapsamdaki Ürün': lab.requiredProductCount,
      'Kümülatif': lab.kumulatifUploaded ? 'Yüklendi' : 'Yüklenmedi',
      'Cihaz Üstü': lab.cihazUstuUploaded ? 'Yüklendi' : 'Yüklenmedi',
    }));
    const details = data.labs.flatMap((lab) =>
      lab.products.map((product) => ({
        'Laboratuvar': lab.name,
        'Dönem': data.periodLabel,
        'Stok Kodu': product.stokKodu,
        'Stok Adı': product.stokAdi,
        'Laboratuvar Grubu': product.labGroupLabel,
        'Sayım Durumu': product.isCounted ? 'Sayıldı' : 'Sayılmadı',
        'Sayılan Adet': product.countedQuantity ?? '',
        'Sistem Stoku': product.systemQuantity,
        'Fark': product.difference ?? '',
        'Cihaz Üstü': product.openTestQuantity ?? '',
        'Toplam Test': product.totalTests ?? '',
        'Son Kayıt': formatDate(product.countedAt),
      })),
    );
    exportDataToExcel(
      { 'Laboratuvar Özeti': summary, 'Ürün Detayları': details },
      `Lojistik_Sayimlari_${period}`,
      toast,
    );
  };

  const exportLabDetail = () => {
    if (!selectedLab || !data) return;
    const rows = filteredDetailProducts.map((product) => ({
      'Laboratuvar': selectedLab.name,
      'Dönem': data.periodLabel,
      'Stok Kodu': product.stokKodu,
      'Stok Adı': product.stokAdi,
      'Laboratuvar Grubu': product.labGroupLabel,
      'Sayım Durumu': product.isCounted ? 'Sayıldı' : 'Sayılmadı',
      'Sayılan Adet': product.countedQuantity ?? '',
      'Sistem Stoku': product.systemQuantity,
      'Fark': product.difference ?? '',
      'Cihaz Üstü': product.openTestQuantity ?? '',
      'Toplam Test': product.totalTests ?? '',
      'Son Kayıt': formatDate(product.countedAt),
    }));
    exportDataToExcel(
      rows,
      `Sayim_Detayi_${selectedLab.name}_${period}`,
      'Sayım Detayı',
      toast,
    );
  };

  const exportProductDetail = () => {
    if (!selectedProductCode || selectedProductRows.length === 0 || !data) return;
    const selectedProduct =
      uniqueCountedProducts.find(
        (product) => product.stokKodu === selectedProductCode,
      ) || null;
    exportDataToExcel(
      selectedProductRows.map(({ lab, product }) => ({
        'Stok Kodu': product.stokKodu,
        'Stok Adı': product.stokAdi,
        'Dönem': data.periodLabel,
        'Laboratuvar': lab.name,
        'Sayılan Adet': product.countedQuantity ?? 0,
        'Sistem Stoku': product.systemQuantity,
        'Fark': product.difference ?? 0,
        'Cihaz Üstü': product.openTestQuantity ?? '',
        'Toplam Test': product.totalTests ?? '',
        'Son Kayıt': formatDate(product.countedAt),
      })),
      `Urun_Arama_${selectedProduct?.stokAdi || selectedProductCode}_${period}`,
      'Ürün Arama',
      toast,
    );
  };

  const periodLabel = data?.periodLabel || formatCalculationPeriod(period);

  return (
    <div className="mx-auto w-full max-w-[1700px] px-1 py-2 sm:px-2 sm:py-4">
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-[#587169] transition-colors hover:bg-white/60 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 dark:text-[#a994b5] dark:hover:bg-white/5 dark:hover:text-fuchsia-200 dark:focus-visible:ring-fuchsia-300/30"
            onClick={() => router.push(LOJISTIK_HOME_PATH)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Lojistik ana sayfa
          </button>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-[#0f2a24] dark:text-[#f4ecfa] sm:text-4xl">
            Sayımlar
          </h1>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[#587169] dark:text-[#a994b5] sm:text-base">
            Yetkili laboratuvarlarınızın ürün grubu kapsamını, sayım ilerlemesini
            ve raporlama dosyalarını dönem bazında yönetin.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-[210px]">
            <label
              htmlFor="logistics-count-period"
              className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.08em] text-[#587169] dark:text-[#a994b5]"
            >
              Dönem
            </label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger
                id="logistics-count-period"
                className="min-h-11 rounded-xl border-emerald-950/10 bg-white/85 font-bold text-[#29473f] dark:border-fuchsia-300/20 dark:bg-[#160e1e]/85 dark:text-[#d6bfe3]"
              >
                <SelectValue placeholder="Dönem seçin" />
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            className="min-h-11 rounded-xl border-emerald-950/10 bg-white/80 font-bold text-[#29473f] hover:bg-emerald-50 dark:border-fuchsia-300/20 dark:bg-white/5 dark:text-[#d6bfe3] dark:hover:bg-fuchsia-300/10"
            onClick={() => {
              setProductQuery('');
              setSelectedProductCode(null);
              setProductSearchOpen(true);
            }}
            disabled={isLoading}
          >
            <PackageSearch className="mr-2 h-4 w-4" />
            Ürün Arama
          </Button>
          <Button
            className="min-h-11 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700 dark:bg-fuchsia-500 dark:hover:bg-fuchsia-600"
            onClick={exportAllCounts}
            disabled={!data || data.labs.length === 0}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Sayımları Excel&apos;e Aktar
          </Button>
        </div>
      </header>

      {data?.assignedGroupNames.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-950/10 bg-white/65 px-4 py-3 text-sm dark:border-fuchsia-300/15 dark:bg-white/[0.035]">
          <span className="font-bold text-[#29473f] dark:text-[#d6bfe3]">
            Ürün kapsamı:
          </span>
          {data.assignedGroupNames.map((group) => (
            <span
              key={group}
              className="rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 dark:border-fuchsia-300/20 dark:bg-fuchsia-300/10 dark:text-fuchsia-200"
            >
              {group}
            </span>
          ))}
        </div>
      ) : data?.labs.length ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
          Bu kullanıcıya laboratuvar grubu atanmadığı için ürün kapsamı
          hesaplanamıyor. Yönetim panelinden en az bir grup atayın.
        </div>
      ) : null}

      {data?.sourceWarnings.length ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
          Bazı rapor yükleme kaynakları okunamadı. Sayım verileri gösteriliyor;
          dosya durumları için yenilemeyi deneyin.
        </div>
      ) : null}

      <section className={`${panelClass} overflow-hidden`}>
        <div className="flex flex-col gap-2 border-b border-emerald-950/10 px-5 py-4 dark:border-fuchsia-300/15 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-[#0f2a24] dark:text-[#f4ecfa]">
              {periodLabel} laboratuvar durumu
            </h2>
            <p className="mt-1 text-sm font-medium text-[#587169] dark:text-[#a994b5]">
              Bir satıra tıklayarak ürün bazlı sayım detayını açın.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl border border-emerald-950/10 bg-white/70 px-3 py-2 text-sm font-bold text-[#29473f] hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 disabled:opacity-50 dark:border-fuchsia-300/20 dark:bg-white/5 dark:text-[#d6bfe3] dark:hover:bg-fuchsia-300/10 dark:focus-visible:ring-fuchsia-300/30 sm:self-auto"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCcw
              className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
            />
            Yenile
          </button>
        </div>

        {isLoading ? (
          <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Yetkili laboratuvarlar hazırlanıyor…
          </div>
        ) : isError ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <p className="font-bold text-rose-700 dark:text-rose-300">
              Sayım verileri alınamadı
            </p>
            <p className="mt-2 max-w-lg text-sm text-[#587169] dark:text-[#a994b5]">
              {error instanceof Error
                ? error.message
                : 'Beklenmeyen bir veri hatası oluştu.'}
            </p>
            <Button
              variant="outline"
              className="mt-4 min-h-11 rounded-xl"
              onClick={() => void refetch()}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Yeniden dene
            </Button>
          </div>
        ) : data?.labs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] border-separate border-spacing-0 text-left">
              <thead className="bg-[#f7fcf9]/95 text-xs font-extrabold uppercase tracking-[0.07em] text-[#587169] dark:bg-white/[0.035] dark:text-[#a994b5]">
                <tr>
                  <th className="px-5 py-4">Lab Adı</th>
                  <th className="px-4 py-4">Sayım</th>
                  <th className="px-4 py-4">Kümülatif</th>
                  <th className="px-4 py-4">Cihaz Üstü</th>
                  <th className="w-14 px-4 py-4">
                    <span className="sr-only">Detay</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.labs.map((lab) => (
                  <tr
                    key={lab.id}
                    className="cursor-pointer text-sm transition-colors hover:bg-emerald-50/70 dark:hover:bg-fuchsia-300/[0.055]"
                    onClick={() => openLabDetail(lab.id)}
                  >
                    <td className="border-t border-emerald-950/10 px-5 py-4 dark:border-fuchsia-300/15">
                      <span className="block max-w-[340px] truncate font-extrabold text-[#29473f] dark:text-[#d6bfe3]">
                        {lab.name}
                      </span>
                      <span className="mt-1 block text-xs font-semibold text-[#70857e] dark:text-[#8e7c9a]">
                        {lab.countedProductCount}/{lab.requiredProductCount} ürün
                        · {lab.sessionCount} kayıt
                      </span>
                    </td>
                    <td className="border-t border-emerald-950/10 px-4 py-4 dark:border-fuchsia-300/15">
                      <CountStatusChip status={lab.countStatus} />
                    </td>
                    <td className="border-t border-emerald-950/10 px-4 py-4 dark:border-fuchsia-300/15">
                      <UploadCell
                        uploaded={lab.kumulatifUploaded}
                        label="Kümülatif"
                        onUpload={() =>
                          setUploadTarget({
                            labId: lab.id,
                            labName: lab.name,
                            kind: 'kumulatif',
                          })
                        }
                      />
                    </td>
                    <td className="border-t border-emerald-950/10 px-4 py-4 dark:border-fuchsia-300/15">
                      <UploadCell
                        uploaded={lab.cihazUstuUploaded}
                        label="Cihaz üstü"
                        onUpload={() =>
                          setUploadTarget({
                            labId: lab.id,
                            labName: lab.name,
                            kind: 'cihazUstu',
                          })
                        }
                      />
                    </td>
                    <td className="border-t border-emerald-950/10 px-4 py-4 text-right dark:border-fuchsia-300/15">
                      <button
                        type="button"
                        className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl text-emerald-600 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 dark:text-fuchsia-300 dark:hover:bg-fuchsia-300/10 dark:focus-visible:ring-fuchsia-300/30"
                        aria-label={`${lab.name} sayım detayını aç`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openLabDetail(lab.id);
                        }}
                      >
                        <ChevronRight
                          className="h-5 w-5"
                          aria-hidden="true"
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <PackageSearch
              className="h-9 w-9 text-emerald-500/65 dark:text-fuchsia-300/65"
              aria-hidden="true"
            />
            <p className="mt-4 font-bold text-[#29473f] dark:text-[#d6bfe3]">
              Yetkili laboratuvar bulunamadı
            </p>
            <p className="mt-2 max-w-lg text-sm leading-6 text-[#587169] dark:text-[#a994b5]">
              Yönetim panelindeki kullanıcı kaydına laboratuvar ve laboratuvar
              grubu atandığında bu dönem tablosu otomatik oluşur.
            </p>
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(selectedLab)}
        onOpenChange={(open) => {
          if (!open) setSelectedLabId(null);
        }}
      >
        <DialogContent className="flex h-[88vh] w-[96vw] max-w-[1280px] flex-col overflow-hidden border-emerald-950/10 bg-[#f7fcf9] p-0 dark:border-fuchsia-300/20 dark:bg-[#120b19]">
          <DialogHeader className="border-b border-emerald-950/10 px-5 py-4 text-left dark:border-fuchsia-300/15 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <DialogTitle className="text-xl font-black text-[#0f2a24] dark:text-[#f4ecfa]">
                  {selectedLab?.name}
                </DialogTitle>
                <DialogDescription className="mt-1 text-[#587169] dark:text-[#a994b5]">
                  {periodLabel} · {selectedLab?.countedProductCount || 0}/
                  {selectedLab?.requiredProductCount || 0} ürün sayıldı
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                className="min-h-11 self-start rounded-xl border-emerald-950/10 bg-white/80 font-bold dark:border-fuchsia-300/20 dark:bg-white/5"
                onClick={exportLabDetail}
                disabled={!filteredDetailProducts.length}
              >
                <Download className="mr-2 h-4 w-4" />
                Filtreleneni Excel&apos;e Aktar
              </Button>
            </div>
          </DialogHeader>

          <div className="grid gap-3 border-b border-emerald-950/10 bg-white/55 px-5 py-4 dark:border-fuchsia-300/15 dark:bg-white/[0.025] md:grid-cols-[minmax(260px,1fr)_190px_220px] sm:px-6">
            <div>
              <label
                htmlFor="lab-detail-search"
                className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.07em] text-[#587169] dark:text-[#a994b5]"
              >
                Ürün ara
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#70857e]" />
                <Input
                  id="lab-detail-search"
                  value={detailSearch}
                  onChange={(event) => setDetailSearch(event.target.value)}
                  placeholder="Stok kodu, ürün veya grup"
                  className="min-h-11 rounded-xl border-emerald-950/10 bg-white pl-10 dark:border-fuchsia-300/20 dark:bg-white/5"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="lab-detail-status"
                className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.07em] text-[#587169] dark:text-[#a994b5]"
              >
                Sayım durumu
              </label>
              <Select
                value={detailStatus}
                onValueChange={(value) =>
                  setDetailStatus(value as ProductStatusFilter)
                }
              >
                <SelectTrigger
                  id="lab-detail-status"
                  className="min-h-11 rounded-xl border-emerald-950/10 bg-white dark:border-fuchsia-300/20 dark:bg-white/5"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="counted">Sayıldı</SelectItem>
                  <SelectItem value="uncounted">Sayılmadı</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label
                htmlFor="lab-detail-group"
                className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.07em] text-[#587169] dark:text-[#a994b5]"
              >
                Laboratuvar grubu
              </label>
              <Select value={detailGroup} onValueChange={setDetailGroup}>
                <SelectTrigger
                  id="lab-detail-group"
                  className="min-h-11 rounded-xl border-emerald-950/10 bg-white dark:border-fuchsia-300/20 dark:bg-white/5"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm gruplar</SelectItem>
                  {detailGroupOptions.map((group) => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-left">
              <thead className="sticky top-0 z-10 bg-[#edf8f2]/95 text-xs font-extrabold uppercase tracking-[0.06em] text-[#587169] backdrop-blur dark:bg-[#1b1025]/95 dark:text-[#a994b5]">
                <tr>
                  <th className="px-5 py-3">Ürün</th>
                  <th className="px-4 py-3">Lab Grubu</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3 text-right">Sayılan</th>
                  <th className="px-4 py-3 text-right">Sistem Stoku</th>
                  <th className="px-4 py-3 text-right">Fark</th>
                  <th className="px-4 py-3 text-right">Cihaz Üstü</th>
                  <th className="px-4 py-3 text-right">Toplam Test</th>
                  <th className="px-4 py-3">Son Kayıt</th>
                </tr>
              </thead>
              <tbody>
                {filteredDetailProducts.length ? (
                  visibleDetailProducts.map((product) => (
                    <tr key={product.stokKodu} className="text-sm">
                      <td className="border-t border-emerald-950/10 px-5 py-3 dark:border-fuchsia-300/15">
                        <span className="block max-w-[300px] truncate font-bold text-[#29473f] dark:text-[#d6bfe3]">
                          {product.stokAdi}
                        </span>
                        <span className="mt-1 block font-mono text-xs text-[#70857e] dark:text-[#8e7c9a]">
                          {product.stokKodu}
                        </span>
                      </td>
                      <td className="max-w-[220px] border-t border-emerald-950/10 px-4 py-3 text-[#587169] dark:border-fuchsia-300/15 dark:text-[#a994b5]">
                        {product.labGroupLabel}
                      </td>
                      <td className="border-t border-emerald-950/10 px-4 py-3 dark:border-fuchsia-300/15">
                        <ProductCountChip counted={product.isCounted} />
                      </td>
                      <td className="border-t border-emerald-950/10 px-4 py-3 text-right font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                        {product.countedQuantity ?? '—'}
                      </td>
                      <td className="border-t border-emerald-950/10 px-4 py-3 text-right dark:border-fuchsia-300/15">
                        {product.systemQuantity}
                      </td>
                      <td
                        className={`border-t border-emerald-950/10 px-4 py-3 text-right font-bold dark:border-fuchsia-300/15 ${
                          product.difference == null || product.difference === 0
                            ? 'text-[#587169] dark:text-[#a994b5]'
                            : product.difference > 0
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {product.difference == null
                          ? '—'
                          : product.difference > 0
                            ? `+${product.difference}`
                            : product.difference}
                      </td>
                      <td className="border-t border-emerald-950/10 px-4 py-3 text-right font-semibold dark:border-fuchsia-300/15">
                        {product.openTestQuantity ?? '—'}
                      </td>
                      <td className="border-t border-emerald-950/10 px-4 py-3 text-right font-semibold dark:border-fuchsia-300/15">
                        {product.totalTests ?? '—'}
                      </td>
                      <td className="whitespace-nowrap border-t border-emerald-950/10 px-4 py-3 text-xs text-[#587169] dark:border-fuchsia-300/15 dark:text-[#a994b5]">
                        {formatDate(product.countedAt)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-6 py-16 text-center text-sm font-semibold text-[#587169] dark:text-[#a994b5]"
                    >
                      Seçili filtrelere uygun ürün bulunamadı.
                    </td>
                  </tr>
                )}
                {visibleDetailProducts.length < filteredDetailProducts.length && (
                  <tr>
                    <td
                      colSpan={9}
                      className="border-t border-emerald-950/10 px-5 py-4 text-center dark:border-fuchsia-300/15"
                    >
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 rounded-xl font-bold"
                        onClick={() =>
                          setDetailVisibleCount((count) =>
                            count + PRODUCT_PAGE_SIZE,
                          )
                        }
                      >
                        Daha fazla ürün göster (
                        {filteredDetailProducts.length -
                          visibleDetailProducts.length}
                        )
                      </Button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={productSearchOpen}
        onOpenChange={(open) => {
          setProductSearchOpen(open);
          if (!open) {
            setProductQuery('');
            setSelectedProductCode(null);
          }
        }}
      >
        <DialogContent className="flex h-[86vh] w-[96vw] max-w-[1200px] flex-col overflow-hidden border-emerald-950/10 bg-[#f7fcf9] p-0 dark:border-fuchsia-300/20 dark:bg-[#120b19]">
          <DialogHeader className="border-b border-emerald-950/10 px-5 py-4 text-left dark:border-fuchsia-300/15 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <DialogTitle className="text-xl font-black text-[#0f2a24] dark:text-[#f4ecfa]">
                  Ürün Arama
                </DialogTitle>
                <DialogDescription className="mt-1 text-[#587169] dark:text-[#a994b5]">
                  {periodLabel} döneminde sayılmış benzersiz ürünleri ve
                  laboratuvar dağılımını görüntüleyin.
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                className="min-h-11 self-start rounded-xl border-emerald-950/10 bg-white/80 font-bold dark:border-fuchsia-300/20 dark:bg-white/5"
                onClick={exportProductDetail}
                disabled={!selectedProductCode || selectedProductRows.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Detayı Excel&apos;e Aktar
              </Button>
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[350px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b border-emerald-950/10 bg-white/55 p-4 dark:border-fuchsia-300/15 dark:bg-white/[0.025] md:border-b-0 md:border-r">
              <label
                htmlFor="count-product-search"
                className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.07em] text-[#587169] dark:text-[#a994b5]"
              >
                Sayılmış ürünler
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#70857e]" />
                <Input
                  id="count-product-search"
                  value={productQuery}
                  onChange={(event) => setProductQuery(event.target.value)}
                  placeholder="Ürün adı veya stok kodu"
                  className="min-h-11 rounded-xl border-emerald-950/10 bg-white pl-10 dark:border-fuchsia-300/20 dark:bg-white/5"
                />
              </div>
              <p className="mt-3 text-xs font-semibold text-[#70857e] dark:text-[#8e7c9a]">
                {filteredUniqueProducts.length} benzersiz ürün
              </p>
              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {filteredUniqueProducts.length ? (
                  visibleUniqueProducts.map((product) => {
                    const selected =
                      selectedProductCode === product.stokKodu;
                    return (
                      <button
                        key={product.stokKodu}
                        type="button"
                        className={`flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 dark:focus-visible:ring-fuchsia-300/30 ${
                          selected
                            ? 'border-emerald-300 bg-emerald-100/80 text-emerald-900 dark:border-fuchsia-300/35 dark:bg-fuchsia-300/10 dark:text-fuchsia-100'
                            : 'border-emerald-950/10 bg-white/70 text-[#29473f] hover:bg-emerald-50 dark:border-fuchsia-300/15 dark:bg-white/[0.035] dark:text-[#d6bfe3] dark:hover:bg-fuchsia-300/[0.07]'
                        }`}
                        onClick={() =>
                          setSelectedProductCode(product.stokKodu)
                        }
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">
                            {product.stokAdi}
                          </span>
                          <span className="mt-1 block font-mono text-xs opacity-70">
                            {product.stokKodu}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-xs font-extrabold dark:bg-white/10">
                          {product.labCount} lab
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-emerald-950/15 p-6 text-center text-sm font-semibold text-[#587169] dark:border-fuchsia-300/20 dark:text-[#a994b5]">
                    Bu dönemde sayılmış ürün bulunamadı.
                  </div>
                )}
                {visibleUniqueProducts.length < filteredUniqueProducts.length && (
                  <button
                    type="button"
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-950/10 bg-white/70 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 dark:border-fuchsia-300/15 dark:bg-white/[0.035] dark:text-fuchsia-200 dark:hover:bg-fuchsia-300/[0.07] dark:focus-visible:ring-fuchsia-300/30"
                    onClick={() =>
                      setProductVisibleCount((count) =>
                        count + PRODUCT_PAGE_SIZE,
                      )
                    }
                  >
                    Daha fazla ürün göster (
                    {filteredUniqueProducts.length -
                      visibleUniqueProducts.length}
                    )
                  </button>
                )}
              </div>
            </aside>

            <div className="min-h-0 overflow-auto">
              {selectedProductCode ? (
                <table className="w-full min-w-[700px] border-separate border-spacing-0 text-left">
                  <thead className="sticky top-0 z-10 bg-[#edf8f2]/95 text-xs font-extrabold uppercase tracking-[0.06em] text-[#587169] backdrop-blur dark:bg-[#1b1025]/95 dark:text-[#a994b5]">
                    <tr>
                      <th className="px-5 py-3">Hastane / Laboratuvar</th>
                      <th className="px-4 py-3 text-right">Sayılan</th>
                      <th className="px-4 py-3 text-right">Sistem Stoku</th>
                      <th className="px-4 py-3 text-right">Fark</th>
                      <th className="px-4 py-3 text-right">Cihaz Üstü</th>
                      <th className="px-4 py-3">Son Kayıt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedProductRows.map(({ lab, product }) => (
                      <tr key={lab.id} className="text-sm">
                        <td className="border-t border-emerald-950/10 px-5 py-4 font-bold text-[#29473f] dark:border-fuchsia-300/15 dark:text-[#d6bfe3]">
                          {lab.name}
                        </td>
                        <td className="border-t border-emerald-950/10 px-4 py-4 text-right font-extrabold dark:border-fuchsia-300/15">
                          {product.countedQuantity ?? 0}
                        </td>
                        <td className="border-t border-emerald-950/10 px-4 py-4 text-right dark:border-fuchsia-300/15">
                          {product.systemQuantity}
                        </td>
                        <td
                          className={`border-t border-emerald-950/10 px-4 py-4 text-right font-bold dark:border-fuchsia-300/15 ${
                            product.difference == null ||
                            product.difference === 0
                              ? 'text-[#587169] dark:text-[#a994b5]'
                              : product.difference > 0
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {product.difference == null
                            ? '—'
                            : product.difference > 0
                              ? `+${product.difference}`
                              : product.difference}
                        </td>
                        <td className="border-t border-emerald-950/10 px-4 py-4 text-right dark:border-fuchsia-300/15">
                          {product.openTestQuantity ?? '—'}
                        </td>
                        <td className="whitespace-nowrap border-t border-emerald-950/10 px-4 py-4 text-xs text-[#587169] dark:border-fuchsia-300/15 dark:text-[#a994b5]">
                          {formatDate(product.countedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center p-8 text-center">
                  <PackageSearch
                    className="h-9 w-9 text-emerald-500/65 dark:text-fuchsia-300/65"
                    aria-hidden="true"
                  />
                  <p className="mt-4 font-bold text-[#29473f] dark:text-[#d6bfe3]">
                    Bir ürün seçin
                  </p>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-[#587169] dark:text-[#a994b5]">
                    Seçtiğiniz ürünün hangi hastane veya laboratuvarda kaç adet
                    sayıldığı burada gösterilecek.
                  </p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(uploadTarget)}
        onOpenChange={(open) => {
          if (!open) closeUploadDialog();
        }}
      >
        <DialogContent className="border-emerald-950/10 bg-[#f7fcf9] dark:border-fuchsia-300/20 dark:bg-[#120b19]">
          <DialogHeader>
            <DialogTitle className="text-[#0f2a24] dark:text-[#f4ecfa]">
              {uploadTarget?.kind === 'kumulatif'
                ? 'Kümülatif dosyası yükle'
                : 'Cihaz üstü dosyası yükle'}
            </DialogTitle>
            <DialogDescription className="text-[#587169] dark:text-[#a994b5]">
              {uploadTarget?.labName} · {periodLabel}. Dosya, ilgili raporlama
              panelinde aynı laboratuvar ve dönem seçildiğinde hazır görünecek.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label
              htmlFor="logistics-calculation-files"
              className="block text-sm font-bold text-[#29473f] dark:text-[#d6bfe3]"
            >
              PDF, TXT veya CSV dosyaları
            </label>
            <Input
              id="logistics-calculation-files"
              type="file"
              multiple
              accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv"
              className="min-h-11 rounded-xl border-emerald-950/10 bg-white dark:border-fuchsia-300/20 dark:bg-white/5"
              onChange={(event) =>
                setUploadFiles(Array.from(event.target.files || []))
              }
              disabled={isUploading}
            />
            {uploadFiles.length > 0 && (
              <div className="max-h-36 overflow-y-auto rounded-2xl border border-emerald-950/10 bg-white/70 p-3 text-sm dark:border-fuchsia-300/15 dark:bg-white/[0.035]">
                {uploadFiles.map((file) => (
                  <div
                    key={`${file.name}-${file.size}`}
                    className="flex items-center justify-between gap-3 py-1"
                  >
                    <span className="truncate font-semibold text-[#29473f] dark:text-[#d6bfe3]">
                      {file.name}
                    </span>
                    <span className="shrink-0 text-xs text-[#70857e] dark:text-[#8e7c9a]">
                      {(file.size / 1024).toLocaleString('tr-TR', {
                        maximumFractionDigits: 1,
                      })}{' '}
                      KB
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 rounded-xl"
              onClick={closeUploadDialog}
              disabled={isUploading}
            >
              Vazgeç
            </Button>
            <Button
              className="min-h-11 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700 dark:bg-fuchsia-500 dark:hover:bg-fuchsia-600"
              onClick={() => void handleUpload()}
              disabled={isUploading || uploadFiles.length === 0}
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {isUploading ? 'Yükleniyor…' : 'Raporlamaya Yükle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
