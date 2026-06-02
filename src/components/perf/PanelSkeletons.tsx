'use client';

/**
 * PanelSkeletons — Faz 6 (mobil ilk-boya)
 *
 * Ağır paneller eskiden TÜM sorgular çözülene kadar boş ekran + ortada spinner
 * gösteriyordu. Mobilde (zayıf CPU + yavaş ağ) bu, saniyelerce "boş/geç açılma"
 * hissi veriyordu. Bu skeleton'lar panelin gerçek layout'unu (cihaz-shell +
 * max-w-5xl konteyner + responsive kart grid) taklit eder; veri gelince gerçek
 * içerik aynı yapıya oturur (layout shift yok). Profesyonel "instant shell" deneyimi.
 */

import { Skeleton } from '@/components/ui/skeleton';

/** Hastane/havuz kart-grid'li paneller (teknik-servis, aplikasyon) için iskelet. */
export function HospitalGridPanelSkeleton() {
  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-5xl mx-auto space-y-5 p-4 sm:p-6">
        {/* Başlık satırı */}
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-56 max-w-[55vw]" />
          </div>
          <Skeleton className="h-9 w-24 rounded-lg shrink-0" />
        </div>

        {/* Arama + sekmeler */}
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>

        {/* Kart grid — panelin grid-cols-1 md:2 xl:3 yapısıyla aynı */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] p-4 space-y-3"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Adım-adım işlem-formu (wizard) sayfaları için iskelet. */
export function WizardFormSkeleton() {
  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-3xl mx-auto space-y-5 p-4 sm:p-6">
        {/* Üst bar: geri + başlık + aksiyon */}
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>

        {/* Cihaz kartı */}
        <div className="rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] p-5 flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>

        {/* Adım göstergesi */}
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-2 flex-1 rounded-full" />
          ))}
        </div>

        {/* Form alanları */}
        <div className="rounded-2xl border border-[var(--dashboard-stroke)] bg-[var(--dashboard-surface)] p-5 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
