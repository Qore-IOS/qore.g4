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
    // Gerçek panelin (teknik-servis / aplikasyon) shell'iyle BİREBİR aynı sarmalayıcı:
    // cihaz-shell → max-w-5xl konteyner → cihaz-card-strong başlık kartı → cihaz-card grid.
    // Böylece veri gelince içerik aynı yere oturur (layout shift olmaz).
    <div className="cihaz-shell px-4 py-6 sm:px-8 sm:py-10">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Başlık KARTI — ikon + başlık + alt yazı + sağ üst aksiyon butonları (Nöbet/Harita) */}
        <div className="cihaz-card-strong p-5 sm:p-7 bg-white/40 backdrop-blur-md border border-white/50 shadow-sm relative">
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <Skeleton className="h-8 w-16 rounded-lg" />
            <Skeleton className="h-8 w-16 rounded-lg" />
          </div>
          <div className="flex items-center gap-2.5 pr-32">
            <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-48 max-w-[50vw]" />
            </div>
          </div>
        </div>

        {/* Hastane/havuz kart grid'i — gerçek cihaz-card yapısıyla aynı
            (başlık + chevron + ayraç + "N cihaz" + durum rozetleri) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="cihaz-card w-full p-4 sm:p-5 flex flex-col bg-white/40 backdrop-blur-sm border border-white/40 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-4 rounded shrink-0" />
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--dashboard-stroke)] space-y-2">
                <Skeleton className="h-3 w-16" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-12 rounded-full" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
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
