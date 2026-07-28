'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FlaskConical,
  Loader2,
  RefreshCcw,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useLojistikCountOverview } from '@/hooks/use-lojistik-count-overview';
import {
  useSupplierOrdersOverview,
  type SupplierOrderSummary,
  type SupplierOrdersOverview,
} from '@/hooks/use-supplier-orders-overview';
import {
  buildCalculationPeriodKey,
  formatCalculationPeriod,
} from '@/lib/lojistik/count-overview';
import {
  LOJISTIK_COUNTS_PATH,
  LOJISTIK_SEVKIYAT_PATH,
  LOJISTIK_TEDARIKCI_SIPARIS_PATH,
} from '@/lib/lojistik/navigation';
import { CountStatusChip, UploadStatusChip } from './count-status';

const cardClass =
  'rounded-[26px] border border-emerald-950/10 bg-white/85 shadow-[0_24px_55px_-32px_rgba(6,78,59,0.35)] backdrop-blur-xl dark:border-fuchsia-400/15 dark:bg-[#160e1e]/80 dark:shadow-[0_28px_65px_-34px_rgba(0,0,0,0.85)]';

function FeatureCard({
  title,
  description,
  icon: Icon,
  accentClass,
  onOpen,
  bodyTitle,
  bodyDescription,
}: {
  title: string;
  description: string;
  icon: typeof FlaskConical;
  accentClass: string;
  onOpen?: () => void;
  bodyTitle: string;
  bodyDescription: string;
}) {
  const interactive = Boolean(onOpen);

  return (
    <section
      className={`${cardClass} flex min-h-[520px] flex-col p-5 sm:p-6${
        interactive
          ? ' group cursor-pointer transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-emerald-400/45 hover:shadow-[0_30px_65px_-34px_rgba(5,150,105,0.48)] dark:hover:border-fuchsia-300/35'
          : ''
      }`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${accentClass}`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold tracking-[-0.02em] text-[#0f2a24] dark:text-[#f4ecfa]">
              {title}
            </h2>
            <p className="mt-1 text-sm font-medium text-[#587169] dark:text-[#a994b5]">
              {description}
            </p>
          </div>
        </div>
        {onOpen ? (
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-950/10 bg-white/70 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/50 dark:border-fuchsia-300/15 dark:bg-white/5 dark:text-fuchsia-200 dark:group-hover:bg-fuchsia-500 dark:focus-visible:ring-fuchsia-300/30"
            aria-label={`${title} sayfasını aç`}
            onClick={event => {
              event.stopPropagation();
              onOpen();
            }}
          >
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="my-5 h-px bg-emerald-950/10 dark:bg-fuchsia-300/15" />
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-xs rounded-3xl border border-dashed border-emerald-950/15 bg-emerald-50/45 p-8 text-center dark:border-fuchsia-300/20 dark:bg-fuchsia-300/5">
          <Boxes
            className="mx-auto h-8 w-8 text-emerald-600/70 dark:text-fuchsia-300/70"
            aria-hidden="true"
          />
          <p className="mt-4 text-base font-bold text-[#29473f] dark:text-[#d6bfe3]">
            {bodyTitle}
          </p>
          <p className="mt-2 text-sm leading-6 text-[#587169] dark:text-[#a994b5]">
            {bodyDescription}
          </p>
        </div>
      </div>
    </section>
  );
}

function OrderRow({
  order,
  showCompletion,
}: {
  order: SupplierOrderSummary;
  showCompletion?: boolean;
}) {
  const date = showCompletion ? order.completedAt : order.createdAt;
  // Ceomed girişleriyle kısmen karşılanmış siparişlerde ilerleme gösterilir.
  const partial =
    !showCompletion && order.alinanAdet > 0 && order.alinanAdet < order.toplamAdet;

  return (
    <div className="border-t border-emerald-950/5 px-3 py-2.5 first:border-t-0 dark:border-fuchsia-300/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#29473f] dark:text-[#d6bfe3]">
            {order.markaAdi}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-[#70857e] dark:text-[#8e7c9a]">
            {order.donem} · {order.toplamKalem} kalem · {order.toplamAdet} adet
          </p>
        </div>
        <div className="shrink-0 text-right">
          {showCompletion ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/15 dark:text-emerald-200">
              {order.autoCompleted ? 'Otomatik' : 'Tamamlandı'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/15 dark:text-amber-200">
              Bekliyor
            </span>
          )}
          {date && (
            <p className="mt-1 text-[10px] font-semibold text-[#70857e] dark:text-[#8e7c9a]">
              {date.toLocaleDateString('tr-TR')}
            </p>
          )}
        </div>
      </div>
      {partial && (
        <p className="mt-1 text-[10px] font-bold text-sky-700 dark:text-sky-300">
          Giriş: {order.alinanAdet}/{order.toplamAdet} adet
        </p>
      )}
    </div>
  );
}

function SupplierOrderCard({
  onOpen,
  data,
  isLoading,
  isError,
}: {
  onOpen: () => void;
  data: SupplierOrdersOverview;
  isLoading: boolean;
  isError: boolean;
}) {
  const { openOrders, recentOrders, openCount, openTotalAdet } = data;

  return (
    <section
      className={`${cardClass} group flex min-h-[520px] cursor-pointer flex-col p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-emerald-400/45 hover:shadow-[0_30px_65px_-34px_rgba(5,150,105,0.48)] dark:hover:border-fuchsia-300/35 sm:p-6`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold tracking-[-0.02em] text-[#0f2a24] dark:text-[#f4ecfa]">
              Tedarikçi Sipariş
            </h2>
            <p className="mt-1 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
              {openCount > 0
                ? `${openCount} açık sipariş · ${openTotalAdet} adet`
                : 'Markalara otomatik sipariş'}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-950/10 bg-white/70 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/50 dark:border-fuchsia-300/15 dark:bg-white/5 dark:text-fuchsia-200 dark:group-hover:bg-fuchsia-500 dark:focus-visible:ring-fuchsia-300/30"
          aria-label="Tedarikçi Sipariş sayfasını aç"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="my-5 h-px bg-emerald-950/10 dark:bg-fuchsia-300/15" />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Siparişler hazırlanıyor…
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p className="text-sm font-bold text-rose-700 dark:text-rose-300">
            Tedarikçi siparişleri alınamadı.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Açık siparişler */}
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#587169] dark:text-[#a994b5]">
              Açık Siparişler
            </p>
            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-emerald-950/10 bg-white/55 dark:border-fuchsia-300/15 dark:bg-white/[0.035]">
              {openOrders.length === 0 ? (
                <div className="flex h-full min-h-24 flex-col items-center justify-center p-4 text-center">
                  <Boxes className="h-6 w-6 text-emerald-500/60 dark:text-fuchsia-300/60" aria-hidden="true" />
                  <p className="mt-2 text-xs font-bold text-[#29473f] dark:text-[#d6bfe3]">
                    Bekleyen sipariş yok
                  </p>
                </div>
              ) : (
                <div className="max-h-[190px] overflow-y-auto">
                  {openOrders.map(order => (
                    <OrderRow key={order.id} order={order} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Son siparişler */}
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#587169] dark:text-[#a994b5]">
              Son Siparişler
            </p>
            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-emerald-950/10 bg-white/55 dark:border-fuchsia-300/15 dark:bg-white/[0.035]">
              {recentOrders.length === 0 ? (
                <div className="flex h-full min-h-24 flex-col items-center justify-center p-4 text-center">
                  <p className="text-xs font-bold text-[#29473f] dark:text-[#d6bfe3]">
                    Tamamlanan sipariş yok
                  </p>
                </div>
              ) : (
                <div className="max-h-[190px] overflow-y-auto">
                  {recentOrders.slice(0, 20).map(order => (
                    <OrderRow key={order.id} order={order} showCompletion />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function LojistikDashboard() {
  const router = useRouter();
  const { currentUserProfile } = useAuth();
  const [period, setPeriod] = useState(() =>
    buildCalculationPeriodKey(new Date()),
  );
  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useLojistikCountOverview(period);
  const {
    data: supplierOrders,
    isLoading: supplierOrdersLoading,
    isError: supplierOrdersError,
  } = useSupplierOrdersOverview();

  useEffect(() => {
    if (
      currentUserProfile?.role &&
      currentUserProfile.role !== 'lojistik_sorumlusu'
    ) {
      router.replace('/dashboard');
    }
  }, [currentUserProfile?.role, router]);

  useEffect(() => {
    const refreshCurrentPeriod = () => {
      const nextPeriod = buildCalculationPeriodKey(new Date());
      setPeriod((currentPeriod) =>
        currentPeriod === nextPeriod ? currentPeriod : nextPeriod,
      );
    };
    const intervalId = window.setInterval(refreshCurrentPeriod, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const completedLabs =
    data?.labs.filter((lab) => lab.countStatus === 'complete').length || 0;
  const totalLabs = data?.labs.length || 0;
  const periodLabel = data?.periodLabel || formatCalculationPeriod(period);

  const openCounts = () => router.push(LOJISTIK_COUNTS_PATH);

  return (
    <div className="mx-auto w-full max-w-[1700px] px-1 py-2 sm:px-2 sm:py-4">
      <header className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-fuchsia-300">
            <Building2 className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-extrabold uppercase tracking-[0.18em]">
              Lojistik çalışma alanı
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-[#0f2a24] dark:text-[#f4ecfa] sm:text-4xl">
            Ana Sayfa
          </h1>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#587169] dark:text-[#a994b5] sm:text-base">
            Yetkili laboratuvarlarınızdaki dönemsel sayım ve rapor hazırlıklarını
            tek ekrandan izleyin.
          </p>
        </div>
        <div className="inline-flex min-h-11 items-center gap-2 self-start rounded-2xl border border-emerald-950/10 bg-white/75 px-4 py-2 text-sm font-bold text-[#29473f] shadow-sm backdrop-blur dark:border-fuchsia-300/15 dark:bg-[#160e1e]/70 dark:text-[#d6bfe3] sm:self-auto">
          <CalendarDays className="h-4 w-4 text-emerald-600 dark:text-fuchsia-300" />
          {periodLabel} dönemi
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <section
          className={`${cardClass} group flex min-h-[520px] cursor-pointer flex-col p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-emerald-400/45 hover:shadow-[0_30px_65px_-34px_rgba(5,150,105,0.48)] dark:hover:border-fuchsia-300/35 sm:p-6`}
          onClick={openCounts}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-fuchsia-400/15 dark:text-fuchsia-200">
                <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-2xl font-black tracking-[-0.025em] text-[#0f2a24] dark:text-[#f4ecfa]">
                  Sayımlar
                </h2>
                <p className="mt-1 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
                  {totalLabs > 0
                    ? `${completedLabs}/${totalLabs} laboratuvar tamamlandı`
                    : 'Yetkili laboratuvar özeti'}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-950/10 bg-white/70 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/50 dark:border-fuchsia-300/15 dark:bg-white/5 dark:text-fuchsia-200 dark:group-hover:bg-fuchsia-500 dark:focus-visible:ring-fuchsia-300/30"
              aria-label="Sayımlar sayfasını aç"
              onClick={(event) => {
                event.stopPropagation();
                openCounts();
              }}
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="my-5 h-px bg-emerald-950/10 dark:bg-fuchsia-300/15" />

          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-emerald-950/10 bg-white/55 dark:border-fuchsia-300/15 dark:bg-white/[0.035]">
            {isLoading ? (
              <div className="flex h-full min-h-72 items-center justify-center gap-2 text-sm font-semibold text-[#587169] dark:text-[#a994b5]">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                Sayım durumu hazırlanıyor…
              </div>
            ) : isError ? (
              <div className="flex h-full min-h-72 flex-col items-center justify-center p-6 text-center">
                <p className="text-sm font-bold text-rose-700 dark:text-rose-300">
                  Sayım verileri alınamadı.
                </p>
                <button
                  type="button"
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-950/10 bg-white px-4 py-2 text-sm font-bold text-[#29473f] hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/50 dark:border-fuchsia-300/20 dark:bg-white/5 dark:text-[#d6bfe3]"
                  onClick={(event) => {
                    event.stopPropagation();
                    void refetch();
                  }}
                >
                  <RefreshCcw
                    className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
                  />
                  Yeniden dene
                </button>
              </div>
            ) : data?.labs.length ? (
              <div className="max-h-[365px] overflow-y-auto">
                <table className="w-full table-fixed border-separate border-spacing-0 text-left">
                  <thead className="sticky top-0 z-10 bg-[#f7fcf9]/95 text-[10px] font-extrabold uppercase tracking-[0.04em] text-[#587169] backdrop-blur dark:bg-[#160e1e]/95 dark:text-[#a994b5]">
                    <tr>
                      <th className="w-[37%] px-3 py-3">Lab Adı</th>
                      <th className="w-[21%] px-1.5 py-3">Sayım</th>
                      <th className="w-[21%] px-1.5 py-3">Kümülatif</th>
                      <th className="w-[21%] px-1.5 py-3">Cihaz Üstü</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.labs.map((lab) => (
                      <tr
                        key={lab.id}
                        className="border-t border-emerald-950/5 text-sm dark:border-fuchsia-300/10"
                      >
                        <td className="border-t border-emerald-950/5 px-3 py-3 font-bold text-[#29473f] dark:border-fuchsia-300/10 dark:text-[#d6bfe3]">
                          <span className="block truncate" title={lab.name}>
                            {lab.name}
                          </span>
                          <span className="mt-1 block text-xs font-semibold text-[#70857e] dark:text-[#8e7c9a]">
                            {lab.countedProductCount}/{lab.requiredProductCount}{' '}
                            ürün
                          </span>
                        </td>
                        <td className="border-t border-emerald-950/5 px-1.5 py-3 dark:border-fuchsia-300/10">
                          <CountStatusChip
                            status={lab.countStatus}
                            showIcon={false}
                            className="max-w-full px-2 text-[10px]"
                          />
                        </td>
                        <td className="border-t border-emerald-950/5 px-1.5 py-3 dark:border-fuchsia-300/10">
                          <UploadStatusChip
                            uploaded={lab.kumulatifUploaded}
                            showIcon={false}
                            className="max-w-full px-2 text-[10px]"
                          />
                        </td>
                        <td className="border-t border-emerald-950/5 px-1.5 py-3 dark:border-fuchsia-300/10">
                          <UploadStatusChip
                            uploaded={lab.cihazUstuUploaded}
                            showIcon={false}
                            className="max-w-full px-2 text-[10px]"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-full min-h-72 flex-col items-center justify-center p-7 text-center">
                <ClipboardCheck
                  className="h-8 w-8 text-emerald-500/60 dark:text-fuchsia-300/60"
                  aria-hidden="true"
                />
                <p className="mt-4 text-sm font-bold text-[#29473f] dark:text-[#d6bfe3]">
                  Atanmış laboratuvar bulunamadı
                </p>
                <p className="mt-2 max-w-xs text-sm leading-6 text-[#587169] dark:text-[#a994b5]">
                  Yönetim panelinden laboratuvar ve laboratuvar grubu ataması
                  yapıldığında özet burada görünecek.
                </p>
              </div>
            )}
          </div>

          {data?.sourceWarnings.length ? (
            <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
              Bazı rapor yükleme durumları geçici olarak alınamadı.
            </p>
          ) : null}
        </section>

        <FeatureCard
          title="Sevkiyatlar"
          description="Laboratuvar talepleri ve sevk hazırlığı"
          icon={FlaskConical}
          accentClass="bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200"
          onOpen={() => router.push(LOJISTIK_SEVKIYAT_PATH)}
          bodyTitle="Hastane sevkiyat planı"
          bodyDescription="Tedarikçi sipariş algoritmasıyla her laboratuvarın ihtiyacını hesaplar, ana depo stoğunu aciliyete göre dağıtır."
        />
        <SupplierOrderCard
          onOpen={() => router.push(LOJISTIK_TEDARIKCI_SIPARIS_PATH)}
          data={supplierOrders}
          isLoading={supplierOrdersLoading}
          isError={supplierOrdersError}
        />
      </div>
    </div>
  );
}
