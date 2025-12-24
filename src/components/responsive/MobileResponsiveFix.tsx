'use client';
import React from 'react';

/**
 * Global Mobile UI Fix Component
 *
 * Bu komponent tüm uygulamaya global mobile CSS kuralları uygular.
 * Panel-spesifik değişiklik gerektirmez - CSS selektörleri ile otomatik çalışır.
 *
 * Özellikler:
 * - Safe zone padding (notch, dynamic island, bottom bar)
 * - Responsive KPI kartları
 * - Responsive butonlar ve buton grupları
 * - Grid/flex layout otomatik stack
 * - Responsive typography
 * - Touch-friendly minimum boyutlar
 */
export default function MobileResponsiveFix() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
/* ================================================================
   GLOBAL MOBILE CSS - TÜM PANELLERE OTOMATİK UYGULANIR
   ================================================================ */

/* ================================================================
   1. CSS DEĞİŞKENLERİ - MOBILE SAFE ZONES & SPACING
   ================================================================ */
:root {
  /* Device safe areas - notch, dynamic island, bottom bar için */
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);

  /* Mobile padding değerleri */
  --mobile-padding-page: 1rem;      /* 16px - sayfa kenar boşluğu */
  --mobile-padding-card: 0.875rem;  /* 14px - kart içi padding */
  --mobile-gap: 0.75rem;            /* 12px - elemanlar arası boşluk */
  --mobile-gap-sm: 0.5rem;          /* 8px - küçük boşluk */

  /* Touch target minimum boyut */
  --touch-min: 44px;

  /* Bottom dock yüksekliği */
  --dock-height: 80px;
}

/* ================================================================
   2. MOBILE BREAKPOINT (<= 768px) - ANA KURALLAR
   ================================================================ */
@media (max-width: 768px) {

  /* Yatay scroll engelle */
  html, body {
    overflow-x: hidden !important;
    -webkit-overflow-scrolling: touch;
  }

  /* ============================================================
     2.1 PAGE SHELL - GLOBAL SAFE ZONE PADDING
     ============================================================ */
  .page-shell {
    padding-top: max(var(--safe-top), 1rem) !important;
    padding-left: max(var(--safe-left), var(--mobile-padding-page)) !important;
    padding-right: max(var(--safe-right), var(--mobile-padding-page)) !important;
    padding-bottom: calc(var(--dock-height) + var(--safe-bottom) + 1rem) !important;
  }

  /* ============================================================
     2.1.1 KPI KARTLARI - EŞİT GENİŞLİK
     ============================================================ */
  /* KPI kartları içeren grid'ler 2 kolon olsun ve eşit genişlik */
  .page-shell [class*="grid"][class*="gap"] {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    gap: var(--mobile-gap) !important;
  }

  /* Tek KPI kartı varsa tam genişlik */
  .page-shell [class*="grid"][class*="gap"] > *:only-child {
    grid-column: 1 / -1 !important;
  }

  /* Tek sayıda KPI varsa sonuncusu tam genişlik */
  .page-shell [class*="grid"][class*="gap"] > *:last-child:nth-child(odd) {
    grid-column: 1 / -1 !important;
  }

  /* KPI kartları eşit yükseklik ve genişlik */
  .page-shell [class*="grid"][class*="gap"] > [class*="Card"],
  .page-shell [class*="grid"][class*="gap"] > [class*="rounded"],
  .page-shell [class*="grid"][class*="gap"] > div {
    width: 100% !important;
    min-width: 0 !important;
    box-sizing: border-box !important;
  }

  /* ============================================================
     2.2 GRID LAYOUTS - OTOMATİK TEK KOLON
     ============================================================ */
  /* 2+ kolonlu tüm gridler mobile'da tek kolona düşer */
  [class*="grid-cols-2"],
  [class*="grid-cols-3"],
  [class*="grid-cols-4"],
  [class*="md:grid-cols"],
  [class*="lg:grid-cols"],
  [class*="xl:grid-cols"] {
    grid-template-columns: 1fr !important;
    gap: var(--mobile-gap) !important;
  }

  /* xl:col-span-2 gibi span'lar mobile'da kaldırılır */
  [class*="col-span-2"],
  [class*="col-span-3"],
  [class*="col-span-4"] {
    grid-column: span 1 !important;
  }

  /* ============================================================
     2.3 CARD BİLEŞENLERİ - RESPONSIVE PADDING
     ============================================================ */
  /* Tüm kartlara responsive padding */
  [class*="rounded-"][class*="shadow"],
  [class*="rounded-2xl"],
  [class*="rounded-xl"],
  [class*="glass-card"],
  .card,
  [class*="Card"] > div:first-child {
    overflow: hidden;
  }

  /* CardHeader, CardContent, CardFooter padding */
  [class*="p-6"],
  [class*="p-5"] {
    padding: var(--mobile-padding-card) !important;
  }

  [class*="pt-0"] {
    padding-top: 0 !important;
  }

  /* Gap değerlerini küçült */
  [class*="gap-6"],
  [class*="gap-8"] {
    gap: var(--mobile-gap) !important;
  }

  [class*="gap-4"],
  [class*="gap-5"] {
    gap: var(--mobile-gap-sm) !important;
  }

  [class*="space-y-6"] > * + *,
  [class*="space-y-8"] > * + * {
    margin-top: var(--mobile-gap) !important;
  }

  [class*="space-y-4"] > * + *,
  [class*="space-y-5"] > * + * {
    margin-top: var(--mobile-gap-sm) !important;
  }

  /* ============================================================
     2.4 TYPOGRAPHY - RESPONSIVE FONT BOYUTLARI
     ============================================================ */
  /* Büyük başlıklar */
  [class*="text-4xl"],
  [class*="text-3xl"] {
    font-size: 1.5rem !important;     /* 24px */
    line-height: 1.3 !important;
  }

  [class*="text-2xl"] {
    font-size: 1.25rem !important;    /* 20px */
    line-height: 1.35 !important;
  }

  [class*="text-xl"] {
    font-size: 1.125rem !important;   /* 18px */
  }

  [class*="text-lg"] {
    font-size: 1rem !important;       /* 16px */
  }

  /* CardTitle özel */
  h3[class*="text-2xl"],
  [class*="CardTitle"],
  .card-title {
    font-size: 1.125rem !important;
    line-height: 1.4 !important;
  }

  /* Tüm metinlerde word-break */
  h1, h2, h3, h4, h5, h6,
  p, span, label, div {
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  /* ============================================================
     2.5 BUTONLAR - TOUCH-FRIENDLY & RESPONSIVE
     ============================================================ */
  /* Tüm butonlara minimum touch target - DOCK HARİÇ */
  .page-shell button,
  .page-shell [role="button"],
  .page-shell [type="button"],
  .page-shell [type="submit"],
  .page-shell .btn,
  .page-shell [class*="Button"] {
    min-height: var(--touch-min) !important;
    font-size: 0.875rem !important;  /* 14px - daha okunur */
    padding-left: 0.75rem !important;
    padding-right: 0.75rem !important;
    /* Buton metinlerinin kesilmesini engelle */
    overflow: visible !important;
    text-overflow: clip !important;
    white-space: normal !important;
    line-height: 1.2 !important;
  }

  /* Icon butonları - DOCK HARİÇ */
  .page-shell button[class*="h-10"][class*="w-10"],
  .page-shell button[class*="size-icon"],
  .page-shell [class*="size-icon"] {
    min-width: var(--touch-min) !important;
    min-height: var(--touch-min) !important;
    width: var(--touch-min) !important;
    height: var(--touch-min) !important;
  }

  /* Küçük butonlar biraz büyüt - DOCK HARİÇ */
  .page-shell [class*="h-7"],
  .page-shell [class*="h-8"],
  .page-shell [class*="h-9"] {
    min-height: 36px !important;
  }

  /* ============================================================
     2.5.1 MOBİL DOCK - ÖZEL KORUMA
     ============================================================ */
  /* Mobil dock'un global CSS'den etkilenmemesi için */
  .fixed[class*="bottom-0"][class*="z-40"] {
    overflow: visible !important;
    z-index: 40 !important;
  }

  /* Dock inner container - logo için overflow visible */
  .fixed[class*="bottom-0"] > div {
    overflow: visible !important;
  }

  .fixed[class*="bottom-0"] > div > div {
    overflow: visible !important;
  }

  /* Dock içindeki butonlar orijinal boyutlarını korusun */
  .fixed[class*="bottom-0"] button {
    min-height: unset !important;
    font-size: unset !important;
    padding: unset !important;
    overflow: visible !important;
  }

  /* Dock içindeki bildirim butonu - görünür olsun */
  .fixed[class*="bottom-0"] button[class*="w-10"],
  .fixed[class*="bottom-0"] button[class*="h-10"],
  .fixed[class*="bottom-0"] [class*="w-10"],
  .fixed[class*="bottom-0"] [class*="h-10"] {
    width: 2.5rem !important;
    height: 2.5rem !important;
    min-width: 2.5rem !important;
    min-height: 2.5rem !important;
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  /* Logo butonu container - overflow ve z-index düzeltmesi */
  .fixed[class*="bottom-0"] .absolute {
    overflow: visible !important;
    z-index: 50 !important;
  }

  /* Logo butonu - tam görünürlük */
  .fixed[class*="bottom-0"] button[class*="w-20"],
  .fixed[class*="bottom-0"] [class*="w-20"][class*="h-20"] {
    width: 5rem !important;
    height: 5rem !important;
    min-height: 5rem !important;
    overflow: visible !important;
    display: flex !important;
    visibility: visible !important;
  }

  /* Logo image */
  .fixed[class*="bottom-0"] img {
    width: 5rem !important;
    height: 5rem !important;
    object-fit: contain !important;
    visibility: visible !important;
  }

  /* ============================================================
     2.6 BUTON GRUPLARI - DÜZGÜN HİZALAMA & GRID
     ============================================================ */
  /* Tüm buton grupları grid layout ile düzgün hizala - DOCK HARİÇ */
  .page-shell .flex[class*="gap"]:has(button),
  .page-shell .flex[class*="gap"]:has(a[class*="Button"]),
  .page-shell .flex[class*="space-x"]:has(button) {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    gap: var(--mobile-gap-sm) !important;
    width: 100% !important;
    align-items: stretch !important;
  }

  /* Tek buton varsa tam genişlik */
  .page-shell .flex[class*="gap"]:has(button) > button:only-child,
  .page-shell .flex[class*="gap"]:has(a) > a:only-child {
    grid-column: 1 / -1 !important;
  }

  /* Tek sayıda buton varsa sonuncusu tam genişlik */
  .page-shell .flex[class*="gap"] > button:last-child:nth-child(odd),
  .page-shell .flex[class*="gap"] > a:last-child:nth-child(odd) {
    grid-column: 1 / -1 !important;
  }

  /* Butonlar eşit boyut ve ortalanmış içerik */
  .page-shell .flex[class*="gap"] > button,
  .page-shell .flex[class*="gap"] > a[class*="Button"],
  .page-shell .flex[class*="space-x"] > button {
    width: 100% !important;
    min-width: 0 !important;
    justify-content: center !important;
    text-align: center !important;
  }

  /* space-x'leri gap'e çevir */
  .page-shell [class*="space-x-2"],
  .page-shell [class*="space-x-3"],
  .page-shell [class*="space-x-4"] {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    gap: var(--mobile-gap-sm) !important;
  }

  .page-shell [class*="space-x-2"] > * + *,
  .page-shell [class*="space-x-3"] > * + *,
  .page-shell [class*="space-x-4"] > * + * {
    margin-left: 0 !important;
  }

  /* ============================================================
     2.7 FLEX LAYOUT - MOBİL HİZALAMA
     ============================================================ */
  /* justify-between flex'ler düzgün hizala - DOCK HARİÇ */
  .page-shell .flex[class*="justify-between"][class*="items-center"] {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: var(--mobile-gap-sm) !important;
  }

  /* Header içindeki flex'ler - tam genişlik ve ortalanmış */
  .page-shell [class*="CardHeader"] > .flex,
  .page-shell [class*="CardHeader"] > div > .flex {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: var(--mobile-gap-sm) !important;
    width: 100% !important;
  }

  /* Genel flex container hizalama */
  .page-shell .flex {
    align-items: center !important;
  }

  /* Flex içi elemanlar ortalanmış */
  .page-shell .flex > * {
    text-align: center !important;
  }

  /* ============================================================
     2.8 FORM ELEMANLARI - TOUCH-FRIENDLY
     ============================================================ */
  .page-shell input,
  .page-shell select,
  .page-shell textarea,
  .page-shell [role="combobox"],
  .page-shell [class*="SelectTrigger"],
  .page-shell [class*="Input"] {
    min-height: var(--touch-min) !important;
    font-size: 16px !important; /* iOS zoom engelle */
  }

  /* Select genişliği ve metin görünürlüğü */
  .page-shell [class*="SelectTrigger"] {
    width: 100% !important;
    height: auto !important;
    min-height: var(--touch-min) !important;
    padding-top: 0.5rem !important;
    padding-bottom: 0.5rem !important;
  }

  /* SelectTrigger içindeki span - line-clamp kaldır, metin tam görünsün */
  .page-shell [class*="SelectTrigger"] > span,
  .page-shell [data-radix-select-trigger] > span,
  .page-shell button[role="combobox"] > span {
    display: block !important;
    overflow: visible !important;
    text-overflow: clip !important;
    white-space: normal !important;
    -webkit-line-clamp: unset !important;
    line-clamp: unset !important;
    -webkit-box-orient: unset !important;
    line-height: 1.3 !important;
    max-height: none !important;
  }

  /* Label küçült */
  .page-shell label,
  .page-shell [class*="Label"] {
    font-size: 0.75rem !important;
  }

  /* ============================================================
     2.9 TABS - COMPACT MOBİL GÖRÜNÜM
     ============================================================ */
  [role="tablist"] {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 0.25rem !important;
    width: 100% !important;
  }

  [role="tab"] {
    flex: 1 1 auto !important;
    min-width: fit-content !important;
    padding: 0.5rem 0.5rem !important;
    font-size: 0.6875rem !important; /* 11px */
  }

  /* TabsList background */
  [class*="TabsList"] {
    width: 100% !important;
    padding: 0.25rem !important;
  }

  /* ============================================================
     2.10 TABLOLAR - KART GÖRÜNÜMÜNE DÖNÜŞÜM
     ============================================================ */
  table,
  .q-table,
  [class*="Table"] {
    display: block !important;
    width: 100% !important;
  }

  thead,
  [class*="TableHeader"] {
    display: none !important;
  }

  tbody,
  [class*="TableBody"] {
    display: block !important;
  }

  tr,
  [class*="TableRow"] {
    display: block !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 0.75rem !important;
    margin-bottom: var(--mobile-gap) !important;
    padding: var(--mobile-gap-sm) !important;
    background: hsl(var(--background) / 0.5) !important;
  }

  td,
  [class*="TableCell"] {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    padding: var(--mobile-gap-sm) !important;
    border: none !important;
    font-size: 0.8125rem !important;
  }

  td::before,
  [class*="TableCell"]::before {
    content: attr(data-label);
    font-weight: 600;
    margin-right: 0.5rem;
    flex-shrink: 0;
  }

  /* ============================================================
     2.11 DIALOG/MODAL - MOBİL OPTİMİZE
     ============================================================ */
  [role="dialog"],
  [class*="DialogContent"],
  [data-state="open"][class*="Dialog"] {
    width: calc(100vw - 2rem) !important;
    max-width: calc(100vw - 2rem) !important;
    max-height: calc(100vh - var(--safe-top) - var(--safe-bottom) - 2rem) !important;
    margin: 1rem !important;
    border-radius: 1rem !important;
    overflow-y: auto !important;
  }

  [class*="DialogHeader"],
  [class*="DialogFooter"] {
    padding: var(--mobile-padding-card) !important;
  }

  /* ============================================================
     2.12 SCROLLABLE AREAS
     ============================================================ */
  [class*="ScrollArea"],
  .scroll-area {
    max-height: calc(100vh - var(--dock-height) - var(--safe-bottom) - 8rem) !important;
  }

  /* Chart container yüksekliği */
  [class*="h-\\[250px\\]"],
  [class*="h-\\[300px\\]"] {
    height: 180px !important;
  }

  /* Map container */
  [class*="h-\\[55vh\\]"],
  [class*="h-\\[50vh\\]"] {
    height: 45vh !important;
    min-height: 280px !important;
  }

  /* ============================================================
     2.13 İKONLAR - MOBİL BOYUTLARI
     ============================================================ */
  [class*="h-6"][class*="w-6"],
  [class*="h-7"][class*="w-7"] {
    width: 1.25rem !important;
    height: 1.25rem !important;
  }

  [class*="h-5"][class*="w-5"] {
    width: 1rem !important;
    height: 1rem !important;
  }

  /* Buton içi ikonlar margin */
  button > svg[class*="mr-2"],
  [role="button"] > svg[class*="mr-2"] {
    margin-right: 0.375rem !important;
  }

  /* ============================================================
     2.14 BADGE/CHIP - COMPACT
     ============================================================ */
  [class*="Badge"],
  .badge {
    font-size: 0.625rem !important; /* 10px */
    padding: 0.125rem 0.375rem !important;
  }

  /* ============================================================
     2.15 ACCORDION - COMPACT PADDING
     ============================================================ */
  [class*="AccordionTrigger"],
  [class*="AccordionContent"] {
    padding: var(--mobile-padding-card) !important;
  }

  /* ============================================================
     2.16 SELECT/DROPDOWN POPOVER
     ============================================================ */
  [class*="SelectContent"],
  [class*="PopoverContent"],
  [class*="DropdownMenuContent"] {
    max-height: 50vh !important;
  }

  /* ============================================================
     2.17 ÖZEL MOBİL UTILITY CLASS'LARI
     ============================================================ */
  /* Masaüstünde gizle, mobilde göster */
  .mobile-only {
    display: flex !important;
  }

  .desktop-only {
    display: none !important;
  }

  /* Mobilde metin gizle, sadece ikon göster */
  .mobile-icon-only > span:not([class*="sr-only"]),
  .mobile-icon-only > .btn-text {
    display: none !important;
  }

  /* Mobilde tek satır (truncate) */
  .mobile-truncate {
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }

  /* Mobilde 2 kolonlu grid zorla */
  .mobile-grid-2 {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    gap: var(--mobile-gap-sm) !important;
  }
}

/* ================================================================
   3. ÇOK KÜÇÜK EKRANLAR (<= 380px) - EXTRA COMPACT
   ================================================================ */
@media (max-width: 380px) {
  :root {
    --mobile-padding-page: 0.75rem;
    --mobile-padding-card: 0.625rem;
    --mobile-gap: 0.5rem;
  }

  [class*="text-4xl"],
  [class*="text-3xl"] {
    font-size: 1.25rem !important;
  }

  [class*="text-2xl"] {
    font-size: 1.125rem !important;
  }

  button,
  [role="button"] {
    font-size: 0.75rem !important;
    padding-left: 0.5rem !important;
    padding-right: 0.5rem !important;
  }

  [role="tab"] {
    font-size: 0.625rem !important;
    padding: 0.375rem 0.375rem !important;
  }
}

/* ================================================================
   4. MASAÜSTÜ (>= 769px) - MOBİL OVERRIDE'LARI KALDIR
   ================================================================ */
@media (min-width: 769px) {
  .mobile-only {
    display: none !important;
  }

  .desktop-only {
    display: flex !important;
  }
}

/* ================================================================
   5. TOUCH TARGET HELPER CLASS
   ================================================================ */
.touch-target {
  min-height: 44px;
  min-width: 44px;
}

/* ================================================================
   6. İOS SAFE AREA SUPPORT
   ================================================================ */
@supports (padding: env(safe-area-inset-bottom)) {
  .page-shell {
    padding-bottom: calc(var(--dock-height) + env(safe-area-inset-bottom) + 1rem) !important;
  }
}
`
      }}
    />
  );
}
